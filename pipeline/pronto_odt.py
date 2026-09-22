#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pronto_odt.py — le lecteur .odt du gabarit « Pronto — modèle d'article » : lit le zip et
# rend le modèle neutre de pronto_modele.py (Par, Cellule, Tableau). RIEN D'AUTRE — comme
# pronto_docx.py, aucune règle du gabarit ne vit ici.
#
# NE PAS lire ce fichier comme pronto_docx.py avec les noms de balises remplacés : le modèle
# OpenDocument diffère structurellement du modèle Word sur trois points mesurés sur le vrai
# gabarit (« Pronto — modèle d'article v2 », converti par
# `soffice --headless --convert-to odt --outdir <dossier> "<le .docx>"`) :
#
# 1. RÉSOLUTION DE STYLE EN DEUX ÉTAGES. @text:style-name désigne le plus souvent un style
#    AUTOMATIQUE (« P1 », « T3 »…), déclaré dans office:automatic-styles (de content.xml ET
#    de styles.xml) sans nom humain : il faut suivre @style:parent-style-name, parfois en
#    chaîne, jusqu'à un style COMMUN (déclaré dans office:styles de styles.xml), qui LUI porte
#    le nom humain — mais pas dans @style:name : dans @style:display-name. Mesuré : « SZH
#    Cle » s'écrit @style:name="SZH_20_Cle" @style:display-name="SZH Cle" — l'espace de « SZH
#    Cle » est encodé en _20_ dans le nom interne, mais le nom AFFICHÉ, lui, ne l'est pas.
#    Un style commun sans display-name (Standard, Quote, Header, Footer…) n'a simplement pas
#    besoin d'être décodé : son @style:name EST déjà son nom humain. decoder_nom_style() ne
#    sert donc que de filet pour ce cas rare où aucun display-name n'existe ET où le nom
#    interne porte quand même un caractère encodé.
#
# 2. LES TITRES SONT DES text:h, PAS DES text:p. @text:outline-level (1, 2, 3) y donne le
#    niveau structurellement — mais ce lecteur NE S'EN SERT PAS : le niveau d'un Par est
#    calculé par pronto_modele.niveau_depuis_style() sur le nom résolu, LA MÊME fonction que
#    pronto_docx.py, pour que les deux lecteurs s'accordent par construction plutôt que par
#    coïncidence entre deux mécanismes différents (voir pronto_modele.py). Un text:h est donc
#    traité par ce lecteur exactement comme un text:p — seule la balise diffère, jamais lue.
#
# 3. LE TEXTE PORTE SES ESPACES EXPLICITEMENT. En XML, plusieurs espaces consécutifs se
#    réduisent à un seul — Word contourne ça en mettant xml:space="preserve" sur le w:t
#    entier ; OpenDocument, lui, matérialise CHAQUE espace surnuméraire en un élément
#    text:s (@text:c en donne le nombre, 1 si absent). Il y a aussi text:tab (tabulation) et
#    text:line-break, sans équivalent texte propre. IGNORER text:s perd les espaces — « Email
#    : » deviendrait « Email: » par accident, alors que le gabarit teste justement les DEUX
#    formes (voir pronto_modele.py, LABELS_AUTEUR est comparé via aplatir(), qui ne voit ni
#    l'un ni l'autre espace — mais un autre appelant qui comparerait le texte brut, lui, s'y
#    tromperait).
#
# Tableaux : table:table / table:table-row / table:table-cell, fusion horizontale =
# @table:number-columns-spanned, et table:covered-table-cell (une cellule masquée par une
# fusion, colonne OU ligne) est sautée — c'est une place tenue dans la grille, pas une
# cellule. Tableaux imbriqués : un table:table dans un table:table-cell, comme en .docx.
# Images : draw:frame/draw:image@xlink:href, qui pointe dans Pictures/.
#
# ⚠ Ni le .docx ni le .odt du gabarit réel ne portent d'image (aucun dossier media/ ni
# Pictures/ dans l'un ou l'autre zip, mesuré) : le chemin image de ce lecteur suit la
# structure décrite par la consigne mais n'est exercé ni par les 12 contrôles de
# pronto-lire.test.js (qui ne fabriquent pas d'image non plus) ni par le contrôle de parité
# sur les gabarits réels. À vérifier sur un vrai document illustré avant de s'y fier en
# production.
#
# stdlib uniquement : pas de PyYAML dans la WSL de la flotte.

import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele as pm

OFFICE = '{urn:oasis:names:tc:opendocument:xmlns:office:1.0}'
TEXT = '{urn:oasis:names:tc:opendocument:xmlns:text:1.0}'
TABLE = '{urn:oasis:names:tc:opendocument:xmlns:table:1.0}'
STYLE = '{urn:oasis:names:tc:opendocument:xmlns:style:1.0}'
DRAW = '{urn:oasis:names:tc:opendocument:xmlns:drawing:1.0}'
XLINK = '{http://www.w3.org/1999/xlink}'
SVG = '{urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0}'


# ---------------------------------------------------------------------------------
# Résolution de style : automatique -> (parent -> …) -> commun, display-name si présent,
# sinon le nom décodé.

def decoder_nom_style(nom):
    """« SZH_20_Cle » -> « SZH Cle » : _XX_ = le caractère de code hexadécimal XX. Ne sert
    que de filet pour un style commun sans display-name mais au nom encodé — voir le point 1
    de l'en-tête."""
    if not nom:
        return nom
    return re.sub(r'_([0-9A-Fa-f]{2})_', lambda m: chr(int(m.group(1), 16)), nom)


def _charger_styles_paragraphe(racine, catalogue):
    """Ajoute au catalogue tout style:style de family paragraph rencontré dans `racine`
    (automatic-styles ou styles), sous la forme name -> (display_name_ou_None,
    parent_name_ou_None). Ne filtre que par famille : un style automatique ET un style commun
    peuvent porter le même nom sans se recouvrir dans la pratique (LibreOffice les nomme
    différemment), mais rien n'empêche de fusionner les deux catalogues d'un même fichier —
    ils ne se chevauchent jamais dans un .odt bien formé."""
    for st in racine.iter(STYLE + 'style'):
        if st.get(STYLE + 'family') != 'paragraph':
            continue
        nom = st.get(STYLE + 'name')
        if not nom:
            continue
        catalogue[nom] = (st.get(STYLE + 'display-name'), st.get(STYLE + 'parent-style-name'))


def charger_catalogue_styles(z):
    """Catalogue name -> (display_name, parent_name) des styles de paragraphe, tiré des
    styles AUTOMATIQUES de content.xml, et des styles AUTOMATIQUES et COMMUNS de styles.xml —
    les trois sources où un @text:style-name peut pointer. Fichier absent ou mal formé :
    catalogue vide (repli, comme charger_styles() côté .docx)."""
    # styles.xml d'abord, content.xml ensuite : les deux fichiers ont chacun leurs PROPRES
    # styles automatiques (ceux de styles.xml servent aux en-têtes/pieds de page, jamais au
    # corps), et un @text:style-name du corps ne référence jamais que ceux de content.xml.
    # En cas d'homonymie improbable entre les deux jeux, content.xml doit donc l'emporter —
    # c'est lui que ce lecteur résout.
    catalogue = {}
    for nom_entree in ('styles.xml', 'content.xml'):
        try:
            racine = ET.fromstring(z.read(nom_entree))
        except Exception:
            continue
        _charger_styles_paragraphe(racine, catalogue)
    return catalogue


def variantes_images(chemin_odt):
    """{} — OpenDocument n'a pas d'équivalent de l'aperçu bitmap que Word range derrière une
    image vectorielle (voir pronto_docx.variantes_images()) : LibreOffice écrit le SVG et rien
    d'autre. La fonction existe pour que les deux lecteurs offrent la même surface à
    pronto-lire.py, jamais pour deviner quoi que ce soit ici."""
    return {}


def est_pronto(chemin_odt):
    """Vrai si cet .odt déclare les styles du gabarit « Pronto — modèle d'article ». Même
    critère et même raison que pronto_docx.est_pronto() (voir son commentaire), sur le nom
    AFFICHÉ des styles communs : « SZH Cle » s'écrit @style:name="SZH_20_Cle"
    @style:display-name="SZH Cle" — c'est le display-name qui porte le nom humain, le nom
    interne étant encodé (point 1 de l'en-tête). Toute erreur de lecture rend Faux."""
    try:
        with zipfile.ZipFile(chemin_odt) as z:
            catalogue = charger_catalogue_styles(z)
    except Exception:
        return False
    noms = set()
    for nom, (affiche, _) in catalogue.items():
        noms.add((affiche or decoder_nom_style(nom)).lower())
    return all(nom in noms for nom in pm.STYLES_GABARIT)


def resoudre_style(nom_style, catalogue):
    """Nom humain résolu d'un @text:style-name : suit @style:parent-style-name jusqu'à
    trouver un display-name ; à défaut, décode le dernier nom atteint (_XX_). '' si
    `nom_style` est vide (paragraphe sans style — ne devrait pas arriver en ODT, un
    text:p/text:h porte toujours un @text:style-name, mais le repli reste sûr)."""
    if not nom_style:
        return ''
    vus = set()
    n = nom_style
    while n and n not in vus:
        vus.add(n)
        entree = catalogue.get(n)
        if entree is None:
            return decoder_nom_style(n)
        display, parent = entree
        if display:
            return display
        if not parent:
            return decoder_nom_style(n)
        n = parent
    # Chaîne de parents cyclique (ne devrait jamais arriver) : dernier nom vu, décodé.
    return decoder_nom_style(n)


# ---------------------------------------------------------------------------------
# Texte : nœuds texte + text:span (récursif) + text:s (espaces, @text:c) + text:tab +
# text:line-break -> espace. Toute autre balise inline (text:a, text:bookmark…) est
# descendue récursivement pour ne perdre aucun texte qu'elle porterait.

def _recueillir_texte(el, morceaux):
    if el.text:
        morceaux.append(el.text)
    for enfant in el:
        tag = enfant.tag
        if tag == TEXT + 's':
            brut = enfant.get(TEXT + 'c')
            try:
                n = int(brut) if brut not in (None, '') else 1
            except ValueError:
                n = 1
            if n > 0:
                morceaux.append(' ' * n)
        elif tag in (TEXT + 'tab', TEXT + 'line-break'):
            morceaux.append(' ')
        else:
            _recueillir_texte(enfant, morceaux)
        if enfant.tail:
            morceaux.append(enfant.tail)


def texte_de(el):
    morceaux = []
    _recueillir_texte(el, morceaux)
    return ''.join(morceaux)


# ---------------------------------------------------------------------------------
# Images : draw:frame/draw:image@xlink:href, sous Pictures/. Surface = largeur * hauteur du
# cadre (@svg:width/@svg:height, ex. "1.9688in") — la même unité vaut pour tout le document,
# la comparaison sert seulement à choisir la plus grande image d'UNE cellule, jamais entre
# fichiers.

def _valeur_numerique(s):
    m = re.match(r'[-+]?[0-9]*\.?[0-9]+', s or '')
    return float(m.group(0)) if m else 0.0


def images_de_paragraphe(p):
    trouvees = []
    for cadre in p.iter(DRAW + 'frame'):
        image = cadre.find(DRAW + 'image')
        if image is None:
            continue
        href = image.get(XLINK + 'href') or ''
        if not href:
            continue
        nom = os.path.basename(href)
        surface = _valeur_numerique(cadre.get(SVG + 'width')) \
            * _valeur_numerique(cadre.get(SVG + 'height'))
        trouvees.append((nom, surface))
    return trouvees


# ---------------------------------------------------------------------------------
# Conversion vers le modèle neutre.

def _par_depuis(el, catalogue):
    style_resolu = resoudre_style(el.get(TEXT + 'style-name'), catalogue)
    texte = pm.normaliser(texte_de(el))
    niveau = pm.niveau_depuis_style(style_resolu)
    images = images_de_paragraphe(el)
    return pm.Par(style=style_resolu, texte=texte, niveau=niveau, images=images)


def _cellule_depuis(tc, catalogue):
    colspan = 1
    brut = tc.get(TABLE + 'number-columns-spanned')
    if brut:
        try:
            colspan = int(brut)
        except ValueError:
            colspan = 1
    blocs = []
    for enfant in tc:
        if enfant.tag in (TEXT + 'p', TEXT + 'h'):
            blocs.append(_par_depuis(enfant, catalogue))
        elif enfant.tag == TABLE + 'table':
            blocs.append(_tableau_depuis(enfant, catalogue))
    return pm.Cellule(colspan=colspan, blocs=blocs)


def _tableau_depuis(tbl, catalogue):
    """Tableau.page reste toujours None ici : OpenDocument n'a pas d'équivalent au
    w:lastRenderedPageBreak que pronto_docx.py compte pour la calculer, et une page devinée
    (depuis un nombre de signes, par exemple) serait pire que pas de page du tout — voir
    Tableau.page dans pronto_modele.py."""
    rangees = []
    for tr in tbl:
        if tr.tag != TABLE + 'table-row':
            continue
        # table:covered-table-cell : une cellule masquée par une fusion (colonne ou ligne) —
        # sautée, sinon on compte des cellules fantômes qui décaleraient toutes les colonnes
        # réelles qui la suivent dans la rangée.
        rangee = [_cellule_depuis(tc, catalogue) for tc in tr if tc.tag == TABLE + 'table-cell']
        rangees.append(rangee)
    return pm.Tableau(rangees=rangees)


def _corps_texte(racine):
    body = racine.find(OFFICE + 'body')
    if body is None:
        return None
    return body.find(OFFICE + 'text')


def lire(chemin_odt):
    """Rend un list[Par | Tableau] : les blocs de premier niveau du document, dans l'ordre.
    Toute erreur de lecture se propage — voir pronto_docx.lire()."""
    with zipfile.ZipFile(chemin_odt) as z:
        racine = ET.fromstring(z.read('content.xml'))
        catalogue = charger_catalogue_styles(z)
    corps = _corps_texte(racine)
    if corps is None:
        return []
    blocs = []
    for e in corps:
        if e.tag in (TEXT + 'p', TEXT + 'h'):
            blocs.append(_par_depuis(e, catalogue))
        elif e.tag == TABLE + 'table':
            blocs.append(_tableau_depuis(e, catalogue))
    return blocs
