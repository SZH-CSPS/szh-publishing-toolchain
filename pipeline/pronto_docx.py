#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pronto_docx.py — le lecteur .docx du gabarit « Pronto — modèle d'article » : lit le zip et
# rend le modèle neutre de pronto_modele.py (Par, Cellule, Tableau). RIEN D'AUTRE — aucune
# règle du gabarit ne vit ici (tableau des métadonnées, tableau des auteurs, blocs
# figure/tableau, bibliographie…) : tout ça vit dans pronto_modele.py, qui ne sait rien de
# `w:` et peut donc appliquer les mêmes règles à ce que rend pronto_odt.py.
#
# Reconnaissance des styles par NOM (w:name de styles.xml), jamais par styleId : un document
# réenregistré par un autre Word peut changer les id, jamais les noms affichés — voir
# pronto_modele.py pour ce que devient ce nom une fois résolu. Un style dont le nom est
# introuvable (styles.xml absent ou id inconnu) résout sur le styleId brut lui-même : c'est
# la seule façon de garder la reconnaissance de repli par identifiant que famille() attend
# encore (voir le point 1 de l'en-tête de pronto_modele.py).
#
# stdlib uniquement : pas de PyYAML dans la WSL de la flotte.

import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele as pm

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
V = '{urn:schemas-microsoft-com:vml}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'


# ---------------------------------------------------------------------------------
# Texte et images bruts — lecture du XML seul, aucune règle du gabarit.

def texte_paragraphe(p):
    """Texte plat d'un w:p : t -> texte, tab -> espace, br et cr -> espace. Le stringify de
    pandoc rend LineBreak par un espace, et l'appariement Lua en dépend."""
    morceaux = []
    for r in p.iter(W + 'r'):
        for e in r:
            if e.tag == W + 't':
                morceaux.append(e.text or '')
            elif e.tag in (W + 'tab', W + 'br', W + 'cr'):
                morceaux.append(' ')
    return ''.join(morceaux)


def charger_rels_images(z):
    """word/_rels/document.xml.rels : rId -> nom de fichier sous media/. pandoc extrait les
    médias en gardant leur basename (--extract-media), et docx-tables.py lit la même table
    pour fabriquer ses <img src="media/…"> : les trois restent alignés."""
    rels = {}
    try:
        racine = ET.fromstring(z.read('word/_rels/document.xml.rels'))
    except Exception:
        return rels
    ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    for rel in racine.iter(ns + 'Relationship'):
        cible = (rel.get('Target') or '').replace('\\', '/')
        if 'media/' in cible:
            rels[rel.get('Id')] = os.path.basename(cible)
    return rels


def images_de_paragraphe(p, rels_images):
    """[(nom sous media/, surface déclarée)] des images d'un w:p, dans l'ordre. La surface
    vient de wp:extent (EMU²) ; elle vaut 0 quand la taille n'est pas déclarée, ce qui est le
    cas du VML hérité."""
    trouvees = []
    for dessin in p.iter(W + 'drawing'):
        blip = dessin.find('.//' + A + 'blip')
        if blip is None:
            continue
        nom = rels_images.get(blip.get(R + 'embed') or '')
        if not nom:
            continue
        surface = 0
        extent = dessin.find('.//' + WP + 'extent')
        if extent is not None:
            try:
                surface = int(extent.get('cx', '0')) * int(extent.get('cy', '0'))
            except (TypeError, ValueError):
                surface = 0
        trouvees.append((nom, surface))
    for donnees in p.iter(V + 'imagedata'):
        nom = rels_images.get(donnees.get(R + 'id') or '')
        if nom:
            trouvees.append((nom, 0))
    return trouvees


def charger_styles(z):
    """id -> nom (minuscules). styles.xml absent : dictionnaire vide (repli)."""
    try:
        racine = ET.fromstring(z.read('word/styles.xml'))
    except Exception:
        return {}
    styles = {}
    for st in racine.iter(W + 'style'):
        sid = st.get(W + 'styleId') or ''
        nom = st.find(W + 'name')
        styles[sid] = (nom.get(W + 'val') or '').lower() if nom is not None else ''
    return styles


def pstyle(p):
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return ''
    ps = ppr.find(W + 'pStyle')
    return ps.get(W + 'val') if ps is not None else ''


def resoudre_style(sid, styles):
    """Nom résolu d'un styleId : son w:name (déjà en minuscules, voir charger_styles) si
    connu, sinon le styleId brut lui-même — c'est ce repli qui garde vivante, dans
    pronto_modele.famille(), la reconnaissance par identifiant que docx-meta.py fait pour
    les Word hérités dont le styles.xml est absent ou incomplet. '' si le paragraphe ne
    porte aucun w:pStyle (paragraphe « Normal » implicite : Word n'écrit alors rien)."""
    if not sid:
        return ''
    nom = styles.get(sid, '')
    return nom if nom else sid


def blocs_du_corps(racine):
    body = racine.find(W + 'body')
    if body is None:
        return []
    return [e for e in body if e.tag in (W + 'p', W + 'tbl')]


def compter_marqueurs_page(e):
    """Nombre de w:lastRenderedPageBreak sous `e`, à n'importe quelle profondeur — Word les
    pose dans un w:r, lui-même dans un w:p (jamais dans un w:tbl directement, mais un tableau
    peut en contenir dans les paragraphes de ses cellules). Posés par Word à sa DERNIÈRE
    repagination : absents d'un .docx jamais ouvert par Word (mesuré : 0 dans les .docx
    fabriqués par script) — voir Tableau.page dans pronto_modele.py pour ce que ça implique."""
    return sum(1 for _ in e.iter(W + 'lastRenderedPageBreak'))


# ---------------------------------------------------------------------------------
# Conversion vers le modèle neutre.

def _par_depuis(p, styles, rels_images):
    style_resolu = resoudre_style(pstyle(p), styles)
    texte = pm.normaliser(texte_paragraphe(p))
    niveau = pm.niveau_depuis_style(style_resolu)
    images = images_de_paragraphe(p, rels_images)
    return pm.Par(style=style_resolu, texte=texte, niveau=niveau, images=images)


def _cellule_depuis(tc, styles, rels_images):
    tcpr = tc.find(W + 'tcPr')
    colspan = 1
    if tcpr is not None:
        gs = tcpr.find(W + 'gridSpan')
        if gs is not None:
            try:
                colspan = int(gs.get(W + 'val') or '1')
            except ValueError:
                colspan = 1
    blocs = []
    for enfant in tc:
        if enfant.tag == W + 'p':
            blocs.append(_par_depuis(enfant, styles, rels_images))
        elif enfant.tag == W + 'tbl':
            blocs.append(_tableau_depuis(enfant, styles, rels_images))
    return pm.Cellule(colspan=colspan, blocs=blocs)


def _tableau_depuis(tbl, styles, rels_images, page=None):
    """`page` : le numéro de page de CE tableau s'il est de premier niveau et connaissable
    (voir lire() ci-dessous) — toujours None pour un tableau imbriqué (contenu d'un bloc
    tableau), qui n'en a jamais eu besoin."""
    rangees = []
    for tr in tbl:
        if tr.tag != W + 'tr':
            continue
        rangee = [_cellule_depuis(tc, styles, rels_images) for tc in tr if tc.tag == W + 'tc']
        rangees.append(rangee)
    return pm.Tableau(rangees=rangees, page=page)


def lire(chemin_docx):
    """Rend un list[Par | Tableau] : les blocs de premier niveau du document, dans l'ordre.
    Toute erreur de lecture (zip invalide, document.xml absent ou mal formé) se propage —
    c'est à l'appelant (pronto-lire.py) de décider du repli, le même quel que soit le
    format déposé.

    Le Tableau.page de chaque tableau de PREMIER NIVEAU est calculé ici : 1 + le nombre de
    w:lastRenderedPageBreak qui le précèdent dans le corps — mais SEULEMENT si le document en
    porte au moins un. Sans aucun marqueur nulle part (document jamais ouvert par Word), la
    page n'est pas devinée : elle reste None sur tous les tableaux. Une page fausse serait
    pire que pas de page — voir pronto_modele.py, Tableau.page et le garde-fou
    ressemble_a_un_bloc()/_avertir_bloc_mal_forme() qui la consomme."""
    with zipfile.ZipFile(chemin_docx) as z:
        racine = ET.fromstring(z.read('word/document.xml'))
        styles = charger_styles(z)
        rels_images = charger_rels_images(z)
    elements = blocs_du_corps(racine)
    marqueurs_total = sum(compter_marqueurs_page(e) for e in elements)
    resultat = []
    cumul = 0
    for e in elements:
        if e.tag == W + 'p':
            resultat.append(_par_depuis(e, styles, rels_images))
        else:
            page = (1 + cumul) if marqueurs_total > 0 else None
            resultat.append(_tableau_depuis(e, styles, rels_images, page=page))
        cumul += compter_marqueurs_page(e)
    return resultat
