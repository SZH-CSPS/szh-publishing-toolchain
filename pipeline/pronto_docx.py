#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pronto_docx.py — le lecteur .docx du gabarit « Pronto — modèle d'article » : lit le zip et
# rend le modèle neutre de pronto_modele.py (Par, Cellule, Tableau). RIEN D'AUTRE — aucune
# règle du gabarit ne vit ici (tableau des métadonnées, tableau des auteurs, blocs
# figure/tableau, bibliographie…) : tout ça vit dans pronto_modele.py, qui ne sait rien de
# `w:` et peut donc appliquer ses règles sans connaître le format.
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
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele as pm
import ooxml_lecture
# La lecture bas niveau vit dans ooxml_lecture ; ses noms restent lisibles ici, où
# manuscrit_docx.py, les tests et les outils les cherchent.
from ooxml_lecture import (W, A, R, ASVG, blocs_du_corps, charger_rels_images,
                           charger_styles, compter_marqueurs_page, images_de_paragraphe,
                           pstyle, resoudre_style, texte_paragraphe)


def variantes_images(chemin_docx):
    """{nom de l'aperçu -> [noms des variantes]} — les AUTRES noms de fichier sous lesquels une
    même image peut apparaître dans le .md.

    Word range une image vectorielle DEUX fois : le SVG lui-même, et un aperçu bitmap pour les
    lecteurs qui ne savent pas l'afficher. Le a:blip pointe l'APERÇU (rId7 -> media/image1.png
    sur le gabarit réel) et le vrai SVG se cache dans son extension asvg:svgBlip (rId8 ->
    media/image2.svg). Or pandoc, lui, extrait et cite le SVG : un bloc figure du gabarit
    nommerait image1.png là où le .md porte image2.svg, et l'instruction FI (légende, texte
    alternatif, crédit, source) ne retrouverait jamais son image.

    ⚠ Cette table vit À CÔTÉ du modèle neutre, jamais dedans : `Par.images` doit continuer de
      dire « les images de ce paragraphe », une par image réelle. Y ajouter la variante ferait
      croire à deux images là où il n'y en a qu'une — et ferait diverger ce lecteur de
      manuscrit_docx.projeter_pronto(), dont un contrôle exige l'égalité stricte sur le gabarit
      livré (test/js/manuscrit-docx.test.js).

    Toute erreur de lecture rend {} : l'appariement se fera alors sur le seul nom principal.
    """
    variantes = {}
    try:
        with zipfile.ZipFile(chemin_docx) as z:
            racine = ET.fromstring(z.read('word/document.xml'))
            rels = charger_rels_images(z)
    except Exception:
        return variantes
    for blip in racine.iter(A + 'blip'):
        nom = rels.get(blip.get(R + 'embed') or '')
        if not nom:
            continue
        for svg in blip.iter(ASVG + 'svgBlip'):
            autre = rels.get(svg.get(R + 'embed') or '')
            if autre and autre != nom and autre not in variantes.setdefault(nom, []):
                variantes[nom].append(autre)
    return variantes


# ---------------------------------------------------------------------------------
# Reconnaissance du gabarit — c'est elle qui décide, dans pipeline/import-docx.sh, si un
# document déposé part à ce lecteur ou à docx-meta.py (le lecteur des Word hérités).
#
# Le premier critère est la clé cachée SZH-Gabarit (docProps/custom.xml, voir
# pm.CLE_GABARIT_NOM) : elle survit aux enregistrements Word et LibreOffice, et à la
# conversion .odt -> .docx de l'import. À défaut, ce qui suit vaut pour les documents partis
# d'un gabarit antérieur à la clé.
#
# Le critère de repli est la DÉCLARATION des deux styles maison dans styles.xml, pas leur
# emploi dans le corps : un document parti du gabarit les porte même si l'autrice ou l'auteur
# a effacé toutes les lignes d'aide, et un Word hérité ne peut pas les porter par accident. Un réglage
# de poste aurait été un pis-aller — la rédaction reçoit les deux sortes de documents, souvent
# le même jour.
#
# Les DEUX sont exigés, et non l'un ou l'autre : « SZH Cle » seul se retrouve dans un document
# fabriqué par manuscrit_gabarit.py à partir d'un gabarit ancien, « SZH Aide » seul n'existe
# nulle part. Exiger les deux, c'est exiger le gabarit entier. La règle elle-même vit dans
# pronto_modele.est_gabarit(), que le nettoyeur appelle aussi : les noms s'y comparent par
# forme normalisée (« SZH-Cle » vaut « SZH Cle »).


def lire_cle_gabarit(z):
    """Valeur de la propriété personnalisée SZH-Gabarit (docProps/custom.xml), ou None."""
    return ooxml_lecture.propriete_personnalisee(z, pm.CLE_GABARIT_NOM)


def est_pronto(chemin_docx):
    """Vrai si ce .docx porte la clé cachée du gabarit, ou à défaut en déclare les styles.
    Toute erreur de lecture (zip invalide, styles.xml absent) rend Faux : un document qu'on ne
    sait pas ouvrir n'est pas un document Pronto, et l'ancienne chaîne dira mieux que nous ce
    qui ne va pas."""
    try:
        with zipfile.ZipFile(chemin_docx) as z:
            return pm.est_gabarit(charger_styles(z).values(), cle=lire_cle_gabarit(z))
    except Exception:
        return False


# ---------------------------------------------------------------------------------
# Conversion vers le modèle neutre.

def _par_depuis(p, styles, rels_images):
    style_resolu = resoudre_style(pstyle(p), styles)
    texte = pm.normaliser_valeur(texte_paragraphe(p))
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
