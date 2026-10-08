#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Lecture bas niveau d'un .docx : espaces de noms, styles, texte d'un paragraphe, images et
# blocs du corps. Aucune règle de gabarit ni d'import ; bibliothèque standard seulement.

import os
import xml.etree.ElementTree as ET

import szh_commun

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
V = '{urn:schemas-microsoft-com:vml}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'
ASVG = '{http://schemas.microsoft.com/office/drawing/2016/SVG/main}'
PKG_RELS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
CP = '{http://schemas.openxmlformats.org/officeDocument/2006/custom-properties}'


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
    """styleId du paragraphe (w:pStyle), '' s'il n'en porte pas."""
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return ''
    ps = ppr.find(W + 'pStyle')
    return ps.get(W + 'val') if ps is not None else ''


def resoudre_style(sid, styles):
    """Nom résolu d'un styleId : son w:name (déjà en minuscules, voir charger_styles) si
    connu, sinon le styleId brut lui-même, repli dont pronto_modele.famille() se sert pour
    les Word dont le styles.xml est absent ou incomplet. '' si le paragraphe ne porte aucun
    w:pStyle (paragraphe « Normal » implicite : Word n'écrit alors rien)."""
    if not sid:
        return ''
    nom = styles.get(sid, '')
    return nom if nom else sid


def texte_paragraphe(p, sauts=True, symboles=True):
    """Texte plat d'un w:p : t -> texte, tab -> espace, noBreakHyphen -> U+2011 (comme
    pandoc), softHyphen n'est pas du texte. `sauts` : br et cr -> espace, comme le
    stringify de pandoc rend LineBreak, dont dépend l'appariement Lua ; faux, ils sont
    ignorés. `symboles` : w:sym rend son caractère ; faux, il est ignoré."""
    morceaux = []
    for r in p.iter(W + 'r'):
        for e in r:
            if e.tag == W + 't':
                morceaux.append(e.text or '')
            elif e.tag == W + 'tab':
                morceaux.append(' ')
            elif e.tag in (W + 'br', W + 'cr'):
                if sauts:
                    morceaux.append(' ')
            elif e.tag == W + 'noBreakHyphen':
                morceaux.append(szh_commun.TRAIT_UNION_INSECABLE)
            elif e.tag == W + 'sym':
                if symboles:
                    morceaux.append(szh_commun.caractere_sym(e.get(W + 'char'),
                                                             e.get(W + 'font')))
    return ''.join(morceaux)


def charger_rels_images(z, sans_externes=False):
    """word/_rels/document.xml.rels : rId -> nom de fichier sous media/. pandoc extrait les
    médias en gardant leur basename (--extract-media), et docx-tables.py lit la même table
    pour fabriquer ses <img src="media/…"> : les trois restent alignés. `sans_externes`
    écarte une cible TargetMode="External" (une image liée, que pandoc n'extrait pas)."""
    rels = {}
    try:
        racine = ET.fromstring(z.read('word/_rels/document.xml.rels'))
    except Exception:
        return rels
    for rel in racine.iter(PKG_RELS + 'Relationship'):
        cible = (rel.get('Target') or '').replace('\\', '/')
        if sans_externes and rel.get('TargetMode') == 'External':
            continue
        if 'media/' in cible:
            rels[rel.get('Id')] = os.path.basename(cible)
    return rels


def images_de_paragraphe(p, rels_images):
    """[(nom sous media/, surface déclarée)] des images d'un élément, dans l'ordre. La
    surface vient de wp:extent (EMU²) ; elle vaut 0 quand la taille n'est pas déclarée, ce
    qui est le cas du VML hérité."""
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


def blocs_du_corps(racine):
    """Les w:p et w:tbl enfants directs de w:body, dans l'ordre."""
    body = racine.find(W + 'body')
    if body is None:
        return []
    return [e for e in body if e.tag in (W + 'p', W + 'tbl')]


def compter_marqueurs_page(e):
    """Nombre de w:lastRenderedPageBreak sous `e`, à toute profondeur. Word les pose à sa
    dernière repagination : un .docx jamais ouvert par Word n'en porte aucun."""
    return sum(1 for _ in e.iter(W + 'lastRenderedPageBreak'))


def propriete_personnalisee(z, nom):
    """Valeur de la propriété personnalisée `nom` (docProps/custom.xml), ou None."""
    try:
        racine = ET.fromstring(z.read('docProps/custom.xml'))
    except Exception:
        return None
    for prop in racine.iter(CP + 'property'):
        if prop.get('name') == nom:
            return ''.join(prop.itertext()).strip()
    return None
