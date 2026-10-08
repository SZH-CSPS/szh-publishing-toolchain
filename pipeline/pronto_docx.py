#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Lecteur .docx du gabarit « Pronto — modèle d'article » : lit le zip et rend le modèle
# neutre de pronto_modele.py (Par, Cellule, Tableau). Les règles du gabarit sont dans
# pronto_modele.py, qui ignore tout du format OOXML.
#
# Les styles se reconnaissent par leur nom (w:name), car un autre Word peut changer les
# styleId en réenregistrant. Si le nom est introuvable, le styleId brut sert de repli (voir
# famille() dans pronto_modele.py).
#
# Bibliothèque standard seule : la WSL n'a pas PyYAML.

import os
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele as pm
import ooxml_lecture
# Réexportés : manuscrit_docx.py, les tests et les outils les importent depuis ce module.
from ooxml_lecture import (W, A, R, ASVG, blocs_du_corps, charger_rels_images,
                           charger_styles, compter_marqueurs_page, images_de_paragraphe,
                           pstyle, resoudre_style, texte_paragraphe)


def variantes_images(chemin_docx):
    """{nom de l'aperçu -> [noms des variantes]} : les autres noms sous lesquels une même
    image peut apparaître dans le .md.

    Word range une image vectorielle deux fois : un aperçu bitmap, que pointe le a:blip
    (media/image1.png), et le SVG, dans son extension asvg:svgBlip (media/image2.svg).
    pandoc cite le SVG : sans cette table, l'instruction FI d'un bloc figure ne retrouverait
    pas son image.

    La table reste hors du modèle neutre : `Par.images` compte une entrée par image réelle,
    et doit rester égal à ce que rend manuscrit_docx.projeter_pronto()
    (test/js/manuscrit-docx.test.js).

    Toute erreur de lecture rend {}.
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
# Reconnaissance du gabarit : pipeline/import-docx.sh envoie un document au gabarit à ce
# lecteur, les autres à docx-meta.py.
#
# Premier critère : la propriété cachée SZH-Gabarit (docProps/custom.xml), qui survit aux
# enregistrements Word et LibreOffice et à la conversion .odt -> .docx.
#
# Repli, pour les documents issus d'un gabarit plus ancien : la déclaration dans styles.xml
# des deux styles « SZH Cle » et « SZH Aide ». Leur déclaration, et non leur emploi : elle
# reste même si les lignes d'aide ont été effacées. Les deux sont exigés : « SZH Cle » seul
# se trouve dans des documents produits par manuscrit_gabarit.py depuis un ancien gabarit.
# La règle est dans pronto_modele.est_gabarit(), que le nettoyeur appelle aussi.


def lire_cle_gabarit(z):
    """Valeur de la propriété personnalisée SZH-Gabarit (docProps/custom.xml), ou None."""
    return ooxml_lecture.propriete_personnalisee(z, pm.CLE_GABARIT_NOM)


def est_pronto(chemin_docx):
    """Vrai si ce .docx porte la clé cachée du gabarit, ou à défaut en déclare les styles.
    Toute erreur de lecture rend Faux : docx-meta.py signalera mieux le problème."""
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
    """`page` : numéro de page d'un tableau de premier niveau s'il est connu (voir lire()) ;
    None pour un tableau imbriqué."""
    rangees = []
    for tr in tbl:
        if tr.tag != W + 'tr':
            continue
        rangee = [_cellule_depuis(tc, styles, rels_images) for tc in tr if tc.tag == W + 'tc']
        rangees.append(rangee)
    return pm.Tableau(rangees=rangees, page=page)


def lire(chemin_docx):
    """Rend list[Par | Tableau] : les blocs de premier niveau du document, dans l'ordre. Les
    erreurs de lecture se propagent ; pronto-lire.py décide du repli.

    Tableau.page d'un tableau de premier niveau vaut 1 + le nombre de
    w:lastRenderedPageBreak qui le précèdent, si le document en porte au moins un. Sinon
    (document jamais ouvert par Word), elle reste None : une page fausse serait pire que pas
    de page (voir _avertir_bloc_mal_forme() dans pronto_modele.py)."""
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
