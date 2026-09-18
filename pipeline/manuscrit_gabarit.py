#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_gabarit.py — l'ÉCRIVAIN du nettoyeur de manuscrit (article) : rend un Document du
# modèle riche (manuscrit_modele.py, §4 du contrat) en un .docx au gabarit « Pronto — modèle
# d'article ». Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §4, §5.3, §10, §11.
#
# Principe non négociable du §5.3 : on part d'une COPIE du gabarit livré et on la remplit —
# jamais un .docx fabriqué de zéro. Ce module NE TOUCHE PAS aux styles.xml, numbering.xml,
# settings.xml, theme, en-têtes ni pieds de page du gabarit : ils sont recopiés OCTET POUR
# OCTET dans le fichier de sortie. Seuls trois membres de l'archive sont réécrits
# (word/document.xml, word/_rels/document.xml.rels, [Content_Types].xml) et de nouveaux
# fichiers word/media/imageN.ext sont ajoutés — jamais retirés ni renommés.
#
# AUCUNE décision de classement ici (§3 du contrat : « manuscrit_gabarit.py ne sait rien des
# décisions ») : `document.niveau_retenu` et `document...forme` arrivent déjà TRANCHÉS par
# manuscrit_modele.classer_titres()/nettoyer_mise_en_forme(). Ce module ne fait que les
# TRADUIRE en styles Word (Titre1/2/3, Corps de texte) et en runs (w:b, w:i, w:u,
# w:vertAlign) — jamais les recalculer.
#
# Repris depuis manuscrit_docx.py, PAR COPIE et non par import (ce module ne lit pas de
# .docx, il en écrit — importer le lecteur pour deux constantes serait une dépendance dans
# le mauvais sens) : rien. En revanche RE_LEGENDE est recopié tel quel depuis docx-titres.py
# (§5.3 : « le lexique est celui de RE_LEGENDE dans docx-titres.py ») — ce fichier a un tiret
# dans son nom, `import docx-titres` est syntaxiquement impossible en Python, la copie est
# donc la seule option, comme pronto_modele.py l'a déjà fait pour normaliser().
#
# stdlib uniquement : zipfile, re, os — pas de python-docx, pas de lxml (§2 du contrat).
#
# ── Décisions prises ici, faute de préciser du contrat (à signaler, pas à corriger en silence) ─
#
# 1. Les deux tableaux fixes du gabarit (métadonnées de l'article, autrices et auteurs) sont
#    recopiés VERBATIM depuis le gabarit, vides, tels que livrés. Le Document du §4 ne porte
#    aucun champ titre/type/langue/auteur — ce n'est pas ce module qui les remplit (ça reste
#    le rôle du formulaire « Métadonnées des articles » du cockpit, inchangé). Ce module ne
#    produit donc que ce qui SUIT ces deux tableaux : le corps du manuscrit.
#
# 2. « Toujours un paragraphe vide entre deux blocs » (§5.3/§10) est appliqué à la lettre
#    entre un bloc figure/tableau et SON VOISIN QUEL QU'IL SOIT (bloc ou paragraphe simple) —
#    jamais entre deux paragraphes de corps ordinaires, qui n'ont jamais fait fondre quoi que
#    ce soit sous LibreOffice (le risque mesuré au §10 est spécifiquement DEUX TABLEAUX qui se
#    touchent). Semer une ligne vide entre CHAQUE paragraphe de texte aurait été une lecture
#    possible du mot « toujours », mais aurait dégradé la mise en page sans corriger aucun
#    défaut connu — non retenue.
#
# 3. Une image rencontrée DANS UNE CELLULE d'un tableau du manuscrit (donc pas au premier
#    niveau du document) est laissée EN PLACE, en ligne dans son paragraphe : elle n'est PAS
#    extraite dans un bloc figure séparé. Le §5.3 ne distingue pas explicitement les deux cas ;
#    imbriquer un bloc figure (donc un tableau) DANS une cellule de tableau ajoute une
#    complexité que le corpus mesuré ne justifie pas (aucune image dans une cellule de tableau
#    sur les onze manuscrits de lot-A ni sur le gabarit livré).
#
# 4. §5.4 (ajouté le 18.09.2026, décidé avec Robin après mesure) : la numérotation de liste
#    EST reportée, mais PAR CORRESPONDANCE — jamais par recopie du numId d'origine, qui
#    désigne une entrée d'un numbering.xml qui n'est pas celui qu'on écrit. Le lecteur
#    (manuscrit_docx.py) résout désormais le FORMAT ('puce'/'numero'/'') de chaque liste
#    depuis le numbering.xml du MANUSCRIT ; cet écrivain choisit alors, pour la SORTIE, une
#    définition du gabarit si elle est adéquate (aucun niveau lié à un style de titre — voir
#    _RegistreListes), et en injecte une sinon, en le disant dans la trace
#    ('liste_reportee'). Le gabarit livré ne définit aucune liste de corps (son seul num est
#    celui de la numérotation de Titre1/2/3) : l'injection est donc la voie normale
#    aujourd'hui. Un format non déterminé par le lecteur (numbering.xml du manuscrit absent,
#    ou format non catalogué) reçoit le repli déclaré de l'écrivain — puce, la forme la plus
#    commune — et la trace distingue explicitement « lu » de « deviné par défaut ».
#
# 5. Une image dont l'extension n'est pas reconnue (§ CONTENU_TYPES_IMAGE) reçoit tout de
#    même un [Content_Types].xml valide (Default générique 'application/octet-stream') plutôt
#    que d'échouer : Word l'ouvrira sans doute mal, mais le document entier reste utilisable
#    et le défaut est tracé ('image-extension-inconnue').
#
# 6. `document.notes` (notes de bas de page) n'est PAS écrit : le gabarit livré n'a pas de
#    mécanisme prévu par le contrat pour les recevoir (le §5.3 ne parle que du corps), et
#    réinjecter des w:footnoteReference dans document.xml sans repasser par footnotes.xml
#    produirait un fichier invalide. Hors mission ici (§12) — signalé, pas traité.

import os
import re
import zipfile

import manuscrit_modele as mm

# ---------------------------------------------------------------------------------
# Styles du gabarit — styleId réels, mesurés dans word/styles.xml de
# "revue-template/Pronto - modele d'article.docx" (18.09.2026) : Titre1/2/3 (w:name "heading
# 1/2/3"), Corpsdetexte (w:name "Body Text"), SZHCle (w:name "SZH Cle"). Le gabarit ne définit
# QUE trois niveaux de titre ("Titre de troisième rang (pas de niveau 4 !)") — ce qui tombe
# pile sur ce que `niveau_retenu` peut porter (1..3, jamais plus, voir manuscrit_modele.py).

STYLE_TITRE = {1: 'Titre1', 2: 'Titre2', 3: 'Titre3'}
STYLE_CORPS = 'Corpsdetexte'
STYLE_CLE = 'SZHCle'

# docx-titres.py, RE_LEGENDE : reconnaît une légende déjà écrite dans le manuscrit (« Figure
# 1 », « Abbildung 2 », « Tableau 3 »…) — copié tel quel, voir l'en-tête pour la raison (nom
# de fichier avec un tiret, non importable).
RE_LEGENDE = re.compile(
    r'^(?:figure|fig\.?|abbildung|abb\.?|illustration|grafik|tableau|tabelle|table)\s+\d+',
    re.I)

# Étiquettes des blocs figure/tableau — mêmes libellés que le gabarit lui-même (mesurés dans
# document.xml : « Légende : », « Texte alternatif : », « Crédit : », « Source : »), dans
# l'ORDRE où le gabarit les pose — LABELS_FIGURE de pronto_modele.py n'impose aucun ordre à la
# lecture (aplatir() compare chaque étiquette indépendamment), mais reproduire l'ordre du
# gabarit rend une sortie que Robin reconnaît à l'œil.
CHAMPS_BLOC = (('legende', 'Légende'), ('alt', 'Texte alternatif'),
               ('credit', 'Crédit'), ('source', 'Source'))

# Largeur de la table qui enveloppe un bloc figure/tableau, en vingtièmes de point (dxa) —
# mesurée sur le bloc figure d'exemple du gabarit livré (w:tblW w:w="8220").
LARGEUR_BLOC_DXA = 8220
# Largeur par défaut d'un tableau de contenu IMBRIQUÉ (le tableau du manuscrit lui-même, posé
# dans la rangée 1 d'un bloc tableau) — un peu moins que LARGEUR_BLOC_DXA pour tenir dans la
# marge intérieure de la cellule qui l'enveloppe (tblCellMar mesurée : 85 dxa de chaque côté).
LARGEUR_TABLEAU_INTERNE_DXA = 8000

# Bordures/marges du bloc figure/tableau — copiées telles quelles depuis le bloc figure
# d'exemple du gabarit (mesuré 18.09.2026) : gris clair BFBFBF, 4/8 pt, marges 57/85 dxa.
_BLOC_TBLPR = (
    '<w:tblPr><w:tblW w:w="%d" w:type="dxa"/>'
    '<w:tblBorders>'
    '<w:top w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    '<w:left w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    '<w:bottom w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    '<w:right w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    '<w:insideH w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    '<w:insideV w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>'
    '</w:tblBorders>'
    '<w:tblLayout w:type="fixed"/>'
    '<w:tblCellMar>'
    '<w:top w:w="57" w:type="dxa"/><w:left w:w="85" w:type="dxa"/>'
    '<w:bottom w:w="57" w:type="dxa"/><w:right w:w="85" w:type="dxa"/>'
    '</w:tblCellMar>'
    '<w:tblLook w:val="0000" w:firstRow="0" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" '
    'w:noHBand="0" w:noVBand="0"/></w:tblPr>')

PARAGRAPHE_VIDE = '<w:p/>'

# Extension -> type MIME reconnu par pandoc/Word pour un [Content_Types].xml valide. Une
# extension absente de cette table reçoit tout de même une entrée (décision n°5 de l'en-tête)
# mais avec un type générique, et le défaut est tracé.
CONTENU_TYPES_IMAGE = {
    'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif',
    'bmp': 'image/bmp', 'tif': 'image/tiff', 'tiff': 'image/tiff', 'emf': 'image/x-emf',
    'wmf': 'image/x-wmf', 'svg': 'image/svg+xml',
}

# Extent (wp:extent) par défaut quand une image n'a jamais déclaré de surface (0) — une image
# raisonnable, ~8x6cm en EMU (914400 EMU/pouce).
_EXTENT_DEFAUT = (2880000, 2160000)


def _echapper(t):
    """Échappement XML minimal pour du contenu texte (jamais un attribut) : & < > seuls, les
    guillemets n'ont pas besoin d'être échappés hors attribut."""
    return (t or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _extent_depuis_surface(surface):
    """(cx, cy) en EMU pour wp:extent. Le modèle riche (§4) ne porte que la SURFACE (EMU²,
    cx*cy) — jamais cx et cy séparément (même convention que docx-meta.py) — la largeur/
    hauteur affichées sont donc reconstruites sur un ratio 4:3 arbitraire quand une surface est
    connue. Purement cosmétique : aucun contrôle du §11 ne porte sur la taille affichée, tous
    portent sur les OCTETS (sha256) — voir manuscrit-gabarit.test.js."""
    if surface and surface > 0:
        cy = int((surface * 3 / 4) ** 0.5) or 1
        cx = max(int(surface / cy), 1)
        return cx, cy
    return _EXTENT_DEFAUT


class _Registre:
    """Accumule, pendant la traversée du Document, tout ce qu'il faudra ajouter à l'archive :
    les images à écrire sous word/media/ (avec leur relation), les hyperliens (une relation
    par URL distincte, jamais deux fois la même). `prochain_rid` doit démarrer au-delà du plus
    grand rId déjà présent dans le gabarit (mesuré : jusqu'à rId14 sur le gabarit livré) —
    calculé par l'appelant, jamais deviné ici."""

    def __init__(self, prochain_rid, numbering_xml=None):
        self._rid = prochain_rid
        self.images = []          # [(rid, nomfichier, extension, octets)]
        self._liens = {}          # url -> rid
        self._n_images = 0
        self.extensions_inconnues = set()
        self.listes = _RegistreListes(numbering_xml)

    def _nouveau_rid(self):
        rid = 'rId%d' % self._rid
        self._rid += 1
        return rid

    def enregistrer_image(self, image):
        self._n_images += 1
        ext = os.path.splitext(image.nom)[1].lstrip('.').lower() or 'png'
        if ext not in CONTENU_TYPES_IMAGE:
            self.extensions_inconnues.add(ext)
        nomfichier = 'image%d.%s' % (self._n_images, ext)
        rid = self._nouveau_rid()
        self.images.append((rid, nomfichier, ext, image.octets))
        return rid

    def enregistrer_lien(self, url):
        if url in self._liens:
            return self._liens[url]
        rid = self._nouveau_rid()
        self._liens[url] = rid
        return rid

    def liens(self):
        return dict(self._liens)


# ---------------------------------------------------------------------------------
# Listes (§5.4 du contrat, décidé avec Robin le 18.09.2026) — report PAR CORRESPONDANCE,
# jamais par recopie : une liste à puces du manuscrit vise la définition à puces de la
# sortie, une numérotée la définition numérotée, `ilvl` conservé. Le `numId` d'origine ne
# traverse JAMAIS — il désigne une entrée d'un numbering.xml qui n'est pas celui qu'on écrit.
#
# Ce qu'on écrit sur le paragraphe : LES DEUX FORMES à la fois — le style ET le w:numPr natif
# — parce que c'est ce que Word produit lui-même quand une autrice clique sur le bouton
# « puces » (§5.4). Le gabarit livré ne définit AUCUN style de liste ('SZH Cle'/'SZH Aide'
# n'en sont pas, et le seul style de paragraphe qui reste est Corps de texte) : c'est donc
# Corpsdetexte qui porte le style, le w:numPr faisant tout le travail de numérotation.

# Niveaux 0..8 : la profondeur par défaut d'une liste multi-niveaux Word — largement au-delà
# de ce que le corpus mesuré emploie (ilvl 0 et 1 seulement), mais c'est la même borne que
# Word pose lui-même, jamais une estimation locale à ce module.
NIVEAUX_LISTE_INJECTEE = 9


def _niveau_puce_xml(ilvl):
    indent = 720 * (ilvl + 1)
    return ('<w:lvl w:ilvl="' + str(ilvl) + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/>'
            '<w:lvlText w:val="•"/><w:lvlJc w:val="left"/>'
            '<w:pPr><w:ind w:left="' + str(indent) + '" w:hanging="360"/></w:pPr>'
            '<w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>'
            '</w:lvl>')


def _niveau_numero_xml(ilvl):
    indent = 720 * (ilvl + 1)
    lvltext = '%' + str(ilvl + 1) + '.'
    return ('<w:lvl w:ilvl="' + str(ilvl) + '"><w:start w:val="1"/><w:numFmt w:val="decimal"/>'
            '<w:lvlText w:val="' + lvltext + '"/><w:lvlJc w:val="left"/>'
            '<w:pPr><w:ind w:left="' + str(indent) + '" w:hanging="360"/></w:pPr></w:lvl>')


def _abstractnum_xml(aid, constructeur_niveau):
    niveaux = ''.join(constructeur_niveau(i) for i in range(NIVEAUX_LISTE_INJECTEE))
    return ('<w:abstractNum w:abstractNumId="' + str(aid) + '">'
            '<w:multiLevelType w:val="hybridMultilevel"/>' + niveaux + '</w:abstractNum>')


# Squelette minimal si le gabarit ne porte AUCUN word/numbering.xml — n'arrive jamais sur le
# gabarit livré (mesuré : il en a un, avec la numérotation de Titre1/2/3), gardé pour qu'un
# gabarit futur qui n'en aurait pas ne fasse pas planter l'écrivain.
_NUMBERING_XML_VIDE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '</w:numbering>')


class _RegistreListes:
    """Résout, au plus une fois par TYPE de liste ('puce'/'numero') et par document, le numId
    à employer en sortie : réutilise une définition ADÉQUATE du gabarit si elle en porte une,
    en injecte une sinon — et le dit dans `trace`, jamais en silence (§5.4). Une définition du
    gabarit est jugée adéquate quand AUCUN de ses niveaux n'est lié à un style de titre (un
    w:lvl qui porte w:pStyle) : mesuré sur le gabarit livré, son unique num (numId=1) est celui
    de la numérotation de Titre1/2/3 — s'en servir pour une liste de corps mélangerait les
    deux numérotations, un défaut que ce garde-fou empêche."""

    def __init__(self, numbering_xml):
        self._existant = numbering_xml
        self._num_vers_abstract = {}
        self._niveaux_abstraits = {}      # aid -> {ilvl: (numFmt, a_pstyle)}
        self._max_numid = 0
        self._max_abstractid = 0
        if numbering_xml:
            self._analyser(numbering_xml)
        self._resolus = {}                # 'puce'|'numero' -> numId choisi
        self._injections = []             # [(abstractNum_xml, num_xml), ...]
        self.trace = []

    def _analyser(self, xml):
        for m in re.finditer(r'<w:num\s+w:numId="(\d+)"[^>]*>(.*?)</w:num>', xml, re.S):
            numid, corps = m.group(1), m.group(2)
            self._max_numid = max(self._max_numid, int(numid))
            aid_m = re.search(r'<w:abstractNumId\s+w:val="(\d+)"', corps)
            if aid_m:
                self._num_vers_abstract[numid] = aid_m.group(1)
        for m in re.finditer(r'<w:abstractNum\s+w:abstractNumId="(\d+)".*?</w:abstractNum>',
                              xml, re.S):
            aid, bloc = m.group(1), m.group(0)
            self._max_abstractid = max(self._max_abstractid, int(aid))
            niveaux = {}
            for lm in re.finditer(r'<w:lvl\s+w:ilvl="(\d+)".*?</w:lvl>', bloc, re.S):
                ilvl, lvl_xml = lm.group(1), lm.group(0)
                fmt_m = re.search(r'<w:numFmt\s+w:val="([^"]+)"', lvl_xml)
                niveaux[ilvl] = (fmt_m.group(1) if fmt_m else '', '<w:pStyle' in lvl_xml)
            self._niveaux_abstraits[aid] = niveaux

    def _definition_reutilisable(self, formats_attendus):
        for numid, aid in self._num_vers_abstract.items():
            niveaux = self._niveaux_abstraits.get(aid, {})
            if not niveaux or any(a_pstyle for (_fmt, a_pstyle) in niveaux.values()):
                continue
            if all(fmt in formats_attendus for (fmt, _p) in niveaux.values()):
                return numid
        return None

    def numid_pour(self, type_liste):
        """`type_liste` : 'puce' ou 'numero' (jamais '' — c'est l'appelant qui choisit le
        repli, voir manuscrit_gabarit.ecrire())."""
        if type_liste in self._resolus:
            return self._resolus[type_liste]
        if type_liste == 'numero':
            formats, constructeur = ('decimal', 'decimalZero', 'lowerLetter', 'upperLetter',
                                      'lowerRoman', 'upperRoman'), _niveau_numero_xml
        else:
            formats, constructeur = ('bullet',), _niveau_puce_xml
        reutilise = self._definition_reutilisable(formats)
        if reutilise is not None:
            self._resolus[type_liste] = reutilise
            self.trace.append({'type': type_liste, 'voie': 'gabarit', 'numid': reutilise})
            return reutilise
        self._max_abstractid += 1
        self._max_numid += 1
        aid, numid = self._max_abstractid, self._max_numid
        self._injections.append((_abstractnum_xml(aid, constructeur),
                                  '<w:num w:numId="' + str(numid) + '"><w:abstractNumId w:val="'
                                  + str(aid) + '"/></w:num>'))
        self._resolus[type_liste] = numid
        self.trace.append({'type': type_liste, 'voie': 'injectee', 'numid': numid})
        return numid

    def a_injecte(self):
        return bool(self._injections)

    def xml_final(self):
        """word/numbering.xml définitif à écrire, ou None si rien n'a dû être ajouté (aucune
        liste dans le document, ou le gabarit portait déjà tout ce qu'il fallait)."""
        if not self._injections:
            return None
        base = self._existant or _NUMBERING_XML_VIDE
        abstracts = ''.join(a for a, _n in self._injections)
        nums = ''.join(n for _a, n in self._injections)
        # w:abstractNum doit précéder tout w:num dans le schéma OOXML — inséré juste avant le
        # premier w:num existant, ou avant la fermeture si le document n'en avait aucun.
        i_premier_num = base.find('<w:num ')
        if i_premier_num == -1:
            return base.replace('</w:numbering>', abstracts + nums + '</w:numbering>')
        return base[:i_premier_num] + abstracts + nums + base[i_premier_num:]


# ---------------------------------------------------------------------------------
# Runs — traduction de Fragment.forme (§4 du contrat) en w:rPr. Seules les valeurs À VRAI sont
# émises : par construction (manuscrit_modele.nettoyer_mise_en_forme() déjà passé), ce qui
# reste ici est soit True (déclaré actif, à rendre), soit None/False (rien à écrire) — ce
# module ne réécrit jamais un "off" explicite, il n'a aucune raison d'exister dans une sortie
# neuve. w:vertAlign est exclusif (§4) : exposant a priorité si les deux étaient vrais (ne
# devrait jamais arriver, _lire_vertalign côté lecteur les rend déjà exclusifs).

def _rpr_xml(forme):
    parties = []
    if forme.get('gras'):
        parties.append('<w:b/>')
    if forme.get('italique'):
        parties.append('<w:i/>')
    if forme.get('souligne'):
        parties.append('<w:u w:val="single"/>')
    if forme.get('exposant'):
        parties.append('<w:vertAlign w:val="superscript"/>')
    elif forme.get('indice'):
        parties.append('<w:vertAlign w:val="subscript"/>')
    if not parties:
        return ''
    return '<w:rPr>' + ''.join(parties) + '</w:rPr>'


def _drawing_xml(rid, image):
    """<w:drawing> minimal (wp:inline) référençant la relation `rid`. Les espaces de noms
    'a' (drawingml/main) et 'pic' (drawingml/picture) ne sont PAS déclarés sur la racine du
    gabarit livré (mesuré : aucune image dans ce gabarit avant ce module, Word ne les avait
    donc jamais ajoutés) — déclarés ici localement sur w:drawing plutôt que de toucher au
    préambule du document, qui doit rester un recopiage verbatim (voir l'en-tête)."""
    cx, cy = _extent_depuis_surface(image.surface)
    alt = _echapper(image.alt)
    return (
        '<w:drawing xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        '<wp:extent cx="%d" cy="%d"/>'
        '<wp:docPr id="0" name="Image" descr="%s"/>'
        '<a:graphic>'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic>'
        '<pic:nvPicPr><pic:cNvPr id="0" name="Image"/><pic:cNvPicPr/></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
    ) % (cx, cy, alt, rid, cx, cy)


def _run_xml(fragment, registre):
    if fragment.image is not None:
        rid = registre.enregistrer_image(fragment.image)
        return '<w:r>%s</w:r>' % _drawing_xml(rid, fragment.image)
    if not fragment.texte:
        return ''
    rpr = _rpr_xml(fragment.forme)
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, _echapper(fragment.texte))


def _runs_xml(fragments, registre):
    """Concatène les runs d'une liste de Fragment, en enveloppant dans <w:hyperlink> chaque
    séquence CONSÉCUTIVE de fragments qui partagent le même lien non nul — un lien porté par
    plusieurs runs voisins (mise en forme coupée en plusieurs w:r à la lecture, §4 du contrat)
    ne doit donner qu'un seul w:hyperlink, pas un par run."""
    morceaux = []
    i, n = 0, len(fragments)
    while i < n:
        lien = fragments[i].lien
        j = i + 1
        if lien is not None:
            while j < n and fragments[j].lien == lien:
                j += 1
        groupe_xml = ''.join(_run_xml(f, registre) for f in fragments[i:j])
        if lien and groupe_xml:
            rid = registre.enregistrer_lien(lien)
            morceaux.append('<w:hyperlink r:id="%s">%s</w:hyperlink>' % (rid, groupe_xml))
        else:
            morceaux.append(groupe_xml)
        i = j
    return ''.join(morceaux)


def _paragraphe_simple_xml(texte, style_id):
    """Un paragraphe à un seul run de texte plat, sans mise en forme — les lignes
    d'étiquette (« Légende : … ») des blocs figure/tableau."""
    return ('<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>'
            '<w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % (style_id, _echapper(texte)))


def _type_liste_effectif(liste):
    """'puce'|'numero' à partir de Paragraphe.liste (numId, ilvl, format) — le format résolu
    par le lecteur depuis numbering.xml (§5.4) s'il est déterminé ('puce'/'numero'), sinon le
    REPLI de l'écrivain : puce, la forme la plus commune — et JAMAIS en silence, voir l'appel
    à ce repli dans _convertir_niveau_racine(), qui le trace. Accepte aussi un couple
    (numId, ilvl) sans 3e élément (documents fabriqués avant le §5.4, ou fixtures de test) :
    même repli, même raison."""
    format_lu = liste[2] if len(liste) > 2 else ''
    return format_lu if format_lu in ('puce', 'numero') else 'puce'


def _numpr_xml(liste, registre):
    ilvl = liste[1] if len(liste) > 1 and liste[1] else 0
    numid = registre.listes.numid_pour(_type_liste_effectif(liste))
    return '<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%d"/></w:numPr>' % (ilvl, numid)


def _paragraphe_xml(paragraphe, style_id, registre):
    """Un paragraphe de corps ou de titre — `style_id` vide pour un paragraphe SANS pStyle
    (utilisé pour le contenu de cellule d'un tableau du manuscrit, jamais restylé, voir la
    décision n°3 de l'en-tête). Si `paragraphe.liste` est renseigné, porte AUSSI un w:numPr
    natif — jamais le numId d'origine (§5.4) : _numpr_xml() résout un numId de LA SORTIE par
    correspondance, via le registre."""
    runs = _runs_xml(paragraphe.fragments, registre)
    interieur = ('<w:pStyle w:val="%s"/>' % style_id) if style_id else ''
    if paragraphe.liste is not None:
        interieur += _numpr_xml(paragraphe.liste, registre)
    pPr = ('<w:pPr>%s</w:pPr>' % interieur) if interieur else ''
    return '<w:p>%s%s</w:p>' % (pPr, runs)


def _style_pour_paragraphe(paragraphe):
    return STYLE_TITRE.get(paragraphe.niveau_retenu, STYLE_CORPS)


# ---------------------------------------------------------------------------------
# Tableaux imbriqués (le tableau du manuscrit lui-même, posé dans la rangée 1 d'un bloc
# tableau, OU un tableau imbriqué dans une cellule) — colspan (w:gridSpan) ET rowspan
# (w:vMerge), miroir en écriture de _tableau_depuis()/_vmerge_continuation() de
# manuscrit_docx.py. Le premier rang d'un Tableau ne peut jamais porter de continuation de
# fusion verticale (rien avant lui) : le nombre de colonnes de la grille se calcule sur LUI
# SEUL, une fois pour tout le tableau — même hypothèse que _tableau_depuis() côté lecture.

def _grille_ecriture(rangees):
    """[[emplacement, ...], ...], ncols — un emplacement est {'type': 'cell', 'col', 'cellule'}
    ou {'type': 'continue', 'col'} (case masquée par une fusion verticale démarrée plus haut).
    """
    if not rangees:
        return [], 0
    ncols = sum(c.colspan for c in rangees[0]) or 1
    pending = {}
    lignes = []
    for rangee in rangees:
        emplacements = []
        col = 0
        idx = 0
        while col < ncols:
            if pending.get(col, 0) > 0:
                emplacements.append({'type': 'continue', 'col': col})
                pending[col] -= 1
                col += 1
                continue
            if idx >= len(rangee):
                break  # rangée plus courte que la grille (tableau mal formé) : rien à masquer
            cellule = rangee[idx]
            emplacements.append({'type': 'cell', 'col': col, 'cellule': cellule})
            if cellule.rowspan > 1:
                for c in range(col, min(col + cellule.colspan, ncols)):
                    pending[c] = max(pending.get(c, 0), cellule.rowspan - 1)
            col += cellule.colspan
            idx += 1
        lignes.append(emplacements)
    return lignes, ncols


def _fermer_sur_paragraphe(xml_contenu):
    """Word exige qu'une cellule (w:tc) se termine par un paragraphe, jamais par un tableau —
    ajoute un paragraphe vide si le dernier bloc écrit était un tableau."""
    return xml_contenu if xml_contenu.rstrip().endswith('</w:p>') or not xml_contenu \
        else xml_contenu + PARAGRAPHE_VIDE


def _contenu_cellule_xml(blocs, registre):
    morceaux = []
    for bloc in blocs:
        if isinstance(bloc, mm.Tableau):
            morceaux.append(_tableau_xml(bloc, registre))
        else:
            # Décision n°3 de l'en-tête : une image dans une cellule reste EN PLACE, en ligne
            # — jamais extraite dans un bloc figure imbriqué. Pas de restyle (style_id='') :
            # le contenu d'un tableau du manuscrit n'est pas retouché par §5.1/§5.2, qui ne
            # portent que sur les paragraphes de PREMIER NIVEAU (voir manuscrit_modele.py,
            # _paragraphes_premier_niveau).
            morceaux.append(_paragraphe_xml(bloc, '', registre))
    if not morceaux:
        return PARAGRAPHE_VIDE
    return _fermer_sur_paragraphe(''.join(morceaux))


def _ligne_xml(emplacements, largeur_col, registre):
    row_entete = any(e['cellule'].entete for e in emplacements if e['type'] == 'cell')
    trpr = '<w:trPr><w:tblHeader/></w:trPr>' if row_entete else ''
    cellules_xml = []
    for e in emplacements:
        if e['type'] == 'continue':
            cellules_xml.append(
                '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/><w:vMerge/></w:tcPr><w:p/></w:tc>'
                % largeur_col)
            continue
        cellule = e['cellule']
        largeur = largeur_col * cellule.colspan
        gridspan = ('<w:gridSpan w:val="%d"/>' % cellule.colspan) if cellule.colspan > 1 else ''
        vmerge = '<w:vMerge w:val="restart"/>' if cellule.rowspan > 1 else ''
        contenu = _contenu_cellule_xml(cellule.blocs, registre)
        cellules_xml.append(
            '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s%s</w:tcPr>%s</w:tc>'
            % (largeur, gridspan, vmerge, contenu))
    return '<w:tr>%s%s</w:tr>' % (trpr, ''.join(cellules_xml))


def _tableau_xml(tableau, registre):
    lignes, ncols = _grille_ecriture(tableau.rangees)
    largeur_col = max(LARGEUR_TABLEAU_INTERNE_DXA // max(ncols, 1), 1)
    grille = ''.join('<w:gridCol w:w="%d"/>' % largeur_col for _ in range(ncols))
    lignes_xml = ''.join(_ligne_xml(e, largeur_col, registre) for e in lignes)
    return ('<w:tbl>' + (_BLOC_TBLPR % (largeur_col * ncols)) + '<w:tblGrid>' + grille
             + '</w:tblGrid>' + lignes_xml + '</w:tbl>')


# ---------------------------------------------------------------------------------
# Blocs figure/tableau — §5.3 : une rangée de métadonnées (Légende/Texte alternatif/Crédit/
# Source, style SZH Cle) puis le contenu. Le gabarit livré ne pose qu'UNE colonne pour ce
# tableau (mesuré : tblGrid à un seul w:gridCol) — la « cellule fusionnée sur toute la
# largeur » du §5.3 est donc DÉJÀ acquise par construction, aucun w:gridSpan n'est nécessaire
# ici (à la différence du tableau du MANUSCRIT lui-même, qui peut avoir plusieurs colonnes,
# voir _tableau_xml ci-dessus).

def _rangee_meta_xml(champs):
    paras = []
    for cle, label in CHAMPS_BLOC:
        valeur = (champs.get(cle) or '').strip()
        texte = '%s : %s' % (label, valeur) if valeur else '%s : ' % label
        paras.append(_paragraphe_simple_xml(texte, STYLE_CLE))
    return ('<w:tr><w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc></w:tr>'
             % (LARGEUR_BLOC_DXA, ''.join(paras)))


def _rangee_image_xml(image, registre):
    rid = registre.enregistrer_image(image)
    p = '<w:p><w:r>%s</w:r></w:p>' % _drawing_xml(rid, image)
    return ('<w:tr><w:trPr><w:trHeight w:val="1701"/></w:trPr>'
             '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc></w:tr>'
             % (LARGEUR_BLOC_DXA, p))


def _rangee_tableau_interne_xml(tableau, registre):
    contenu = _fermer_sur_paragraphe(_tableau_xml(tableau, registre))
    return ('<w:tr><w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc></w:tr>'
             % (LARGEUR_BLOC_DXA, contenu))


def _bloc_xml(champs, rangee_contenu_xml):
    return ('<w:tbl>' + (_BLOC_TBLPR % LARGEUR_BLOC_DXA)
            + '<w:tblGrid><w:gridCol w:w="%d"/></w:tblGrid>' % LARGEUR_BLOC_DXA
            + _rangee_meta_xml(champs) + rangee_contenu_xml + '</w:tbl>')


# ---------------------------------------------------------------------------------
# Traversée du corps — extraction des images en blocs figure, des tableaux en blocs tableau,
# association d'une légende déjà écrite dans le manuscrit (§5.3), et le paragraphe vide
# obligatoire autour de chaque bloc (§10, décision n°2 de l'en-tête).

def _texte_paragraphe(paragraphe):
    return paragraphe.texte().strip()


def _cherche_legende(blocs, idx, consommes):
    """(indice, texte) du paragraphe voisin (suivant PUIS précédent) qui ressemble à une
    légende déjà écrite (RE_LEGENDE) et n'est pas déjà pris par un autre bloc — (None, '') si
    aucun des deux voisins ne convient. Le contrat ne dit pas si la légende attendue se trouve
    avant ou après le bloc qu'elle nomme : les deux sont acceptées, le suivant étant regardé
    en premier (convention la plus fréquente, légende sous la figure)."""
    for voisin in (idx + 1, idx - 1):
        if voisin < 0 or voisin >= len(blocs) or voisin in consommes:
            continue
        bloc = blocs[voisin]
        if not isinstance(bloc, mm.Paragraphe):
            continue
        if any(f.image is not None for f in bloc.fragments):
            continue
        texte = _texte_paragraphe(bloc)
        if texte and RE_LEGENDE.match(texte):
            return voisin, texte
    return None, ''


def _associer_legendes(blocs):
    """Précalcule, AVANT toute génération de XML, la légende éventuellement trouvée pour
    chaque bloc image/tableau, et l'ensemble complet des indices de paragraphe consommés en
    légende. Nécessaire en un passage séparé : un paragraphe-légende qui PRÉCÈDE son bloc
    (cas fréquent, légende écrite avant l'image) serait sinon déjà émis comme corps ordinaire
    au moment où le bloc qui le consomme est atteint, dans un simple passage en avant — la
    même légende apparaîtrait alors DEUX FOIS en sortie (une fois comme paragraphe de corps,
    une fois dans le champ « Légende : »), l'exact défaut que le §5.3 interdit (« retirée du
    corps »). Mesuré par sabotage inverse : sans ce pré-passage, un cas réel (légende avant
    l'image) double le texte de la légende dans le .docx produit."""
    n = len(blocs)
    consommes = set()
    legendes = {}          # indice du bloc image/tableau -> texte de légende trouvé
    for idx, bloc in enumerate(blocs):
        est_image = isinstance(bloc, mm.Paragraphe) and any(f.image is not None
                                                             for f in bloc.fragments)
        est_tableau = isinstance(bloc, mm.Tableau)
        if not (est_image or est_tableau):
            continue
        legende_idx, legende = _cherche_legende(blocs, idx, consommes)
        if legende_idx is not None:
            consommes.add(legende_idx)
            legendes[idx] = legende
    return legendes, consommes


def _convertir_niveau_racine(blocs, registre, trace):
    """Rend le XML du corps (hors les deux tableaux fixes) — liste de segments (est_bloc,
    xml), puis assemblage avec le paragraphe vide obligatoire autour de chaque bloc."""
    n = len(blocs)
    legendes, consommes = _associer_legendes(blocs)
    segments = []          # (est_bloc: bool, xml: str)

    idx = 0
    while idx < n:
        if idx in consommes:
            idx += 1
            continue
        bloc = blocs[idx]

        if isinstance(bloc, mm.Tableau):
            legende = legendes.get(idx, '')
            champs = {'legende': legende, 'alt': '', 'credit': '', 'source': ''}
            xml = _bloc_xml(champs, _rangee_tableau_interne_xml(bloc, registre))
            segments.append((True, xml))
            trace.append({'portee': 'bloc', 'source': bloc.source, 'decision': 'bloc_tableau',
                          'motif': 'tableau posé dans un bloc tableau ; légende %s'
                                   % ('reprise du manuscrit (« %s »)' % legende if legende
                                      else 'absente (champ laissé vide)')})

        elif isinstance(bloc, mm.Paragraphe):
            images = [f.image for f in bloc.fragments if f.image is not None]
            if images:
                fragments_texte = [f for f in bloc.fragments if f.image is None]
                if any(f.texte.strip() for f in fragments_texte):
                    p_texte = mm.Paragraphe(style=bloc.style, niveau_declare=bloc.niveau_declare,
                                             niveau_retenu=bloc.niveau_retenu,
                                             fragments=fragments_texte, source=bloc.source)
                    style_id = _style_pour_paragraphe(p_texte)
                    segments.append((False, _paragraphe_xml(p_texte, style_id, registre)))
                # La légende éventuellement trouvée pour ce paragraphe ne va QUE sur la
                # première image : un paragraphe portant plusieurs images est rare, et le
                # contrat n'envisage pas d'en répartir une seule légende entre plusieurs blocs.
                legende_paragraphe = legendes.get(idx, '')
                for k, image in enumerate(images):
                    champs = {'legende': legende_paragraphe if k == 0 else '',
                              'alt': image.alt, 'credit': '', 'source': ''}
                    xml = _bloc_xml(champs, _rangee_image_xml(image, registre))
                    segments.append((True, xml))
                    champs_vides = [label for cle, label in CHAMPS_BLOC if not champs.get(cle)]
                    trace.append({'portee': 'bloc', 'source': bloc.source,
                                  'decision': 'bloc_figure',
                                  'motif': 'image « %s » posée dans un bloc figure ; champs '
                                           'vides : %s' % (image.nom,
                                                            ', '.join(champs_vides) or 'aucun')})
            else:
                if bloc.liste is not None:
                    format_lu = bloc.liste[2] if len(bloc.liste) > 2 else ''
                    type_liste = _type_liste_effectif(bloc.liste)
                    if format_lu in ('puce', 'numero'):
                        motif = ('liste (%s, niveau %d) reportée par correspondance ; le '
                                  "numId d'origine (%r) n'est jamais recopié"
                                  % (type_liste, bloc.liste[1], bloc.liste[0]))
                    else:
                        motif = ('liste de format NON DÉTERMINÉ (niveau %d, numId d\'origine '
                                  '%r) : la nature (puce ou numérotée) n\'a pas pu être lue '
                                  'dans le manuscrit ; reportée par défaut comme liste à '
                                  'puces — vérifiez cette liste dans le document produit'
                                  % (bloc.liste[1], bloc.liste[0]))
                    trace.append({'portee': 'paragraphe', 'source': bloc.source,
                                  'decision': 'liste_reportee', 'type': type_liste,
                                  'format_determine': format_lu in ('puce', 'numero'),
                                  'motif': motif})
                style_id = _style_pour_paragraphe(bloc)
                segments.append((False, _paragraphe_xml(bloc, style_id, registre)))
        idx += 1

    morceaux = []
    precedent_est_bloc = False
    for i, (est_bloc, xml) in enumerate(segments):
        if i > 0 and _separateur_requis(est_bloc, precedent_est_bloc):
            morceaux.append(PARAGRAPHE_VIDE)
        morceaux.append(xml)
        precedent_est_bloc = est_bloc
    return ''.join(morceaux)


def _separateur_requis(est_bloc_courant, est_bloc_precedent):
    """§5.3/§10 : un bloc figure/tableau ne touche JAMAIS son voisin, quel qu'il soit — c'est
    précisément l'adjacence TABLEAU-TABLEAU que LibreOffice fond en un seul tableau (mesuré,
    §10 : 4 tableaux côté .docx, 3 côté .odt sur le gabarit réel). Un paragraphe de corps
    entre deux AUTRES paragraphes de corps, lui, n'a jamais montré ce défaut : on ne lui
    impose pas de ligne vide supplémentaire (décision n°2 de l'en-tête). Fonction unique
    délibérément séparée de l'assemblage : c'est LE point que le contrôle n°5 du §11 sabote
    pour prouver qu'il garde vraiment quelque chose."""
    return est_bloc_courant or est_bloc_precedent


# ---------------------------------------------------------------------------------
# Relations et types de contenu — ajout PUR (jamais de retrait) de ce que les images et les
# liens du document exigent, par simple manipulation de texte : le gabarit livré n'a besoin
# d'aucune de ces entrées aujourd'hui (aucune image, aucun hyperlien dans son propre exemple).

def _ajouter_relations(rels_xml, nouvelles):
    if not nouvelles:
        return rels_xml
    morceaux = ''.join(
        '<Relationship Id="%s" Type="%s" Target="%s"%s/>'
        % (rid, typ, cible, ' TargetMode="External"' if externe else '')
        for rid, typ, cible, externe in nouvelles)
    return rels_xml.replace('</Relationships>', morceaux + '</Relationships>')


def _ajouter_types_contenu(ct_xml, extensions):
    if not extensions:
        return ct_xml
    dejadeclarees = {e.lower() for e in re.findall(r'Extension="([^"]+)"', ct_xml)}
    manquantes = sorted(e for e in extensions if e.lower() not in dejadeclarees)
    if not manquantes:
        return ct_xml
    morceaux = ''.join(
        '<Default Extension="%s" ContentType="%s"/>'
        % (ext, CONTENU_TYPES_IMAGE.get(ext.lower(), 'application/octet-stream'))
        for ext in manquantes)
    return ct_xml.replace('</Types>', morceaux + '</Types>')


# ---------------------------------------------------------------------------------
# Point d'entrée.

def ecrire(document, chemin_gabarit, chemin_sortie, decisions=None):
    """Écrit un .docx au gabarit Pronto depuis un Document du §4, en PARTANT d'une copie du
    gabarit livré (`chemin_gabarit`) — jamais un .docx fabriqué de zéro (§5.3). `decisions` :
    les (stats, trace) déjà produits par manuscrit_modele.classer_titres()/
    nettoyer_mise_en_forme() sur CE document (facultatif, non réinterprété ici — voir l'en-
    tête : ce module ne prend AUCUNE décision, il ne fait que les traduire en styles Word) ;
    simplement recopié dans la trace rendue, pour qu'un seul objet porte tout l'historique
    d'un document au moment d'écrire le rapport. Rend un dict {'stats', 'trace', 'decisions'}.
    """
    with zipfile.ZipFile(chemin_gabarit) as zin:
        noms = zin.namelist()
        doc_xml = zin.read('word/document.xml').decode('utf-8')
        rels_xml = zin.read('word/_rels/document.xml.rels').decode('utf-8')
        ct_xml = zin.read('[Content_Types].xml').decode('utf-8')
        contenus = {nom: zin.read(nom) for nom in noms}

    numbering_xml_gabarit = (contenus['word/numbering.xml'].decode('utf-8')
                              if 'word/numbering.xml' in contenus else None)

    i_body = doc_xml.index('<w:body>')
    preambule = doc_xml[:i_body + len('<w:body>')]
    reste = doc_xml[i_body + len('<w:body>'):]
    i_fin_body = reste.rindex('</w:body>')
    interieur = reste[:i_fin_body]
    queue = reste[i_fin_body:]                     # '</w:body></w:document>'

    tables_fixes = list(re.finditer(r'<w:tbl\b.*?</w:tbl>', interieur, re.S))
    if len(tables_fixes) < 2:
        raise ValueError(
            "le gabarit ne porte pas ses deux tableaux fixes (métadonnées de l'article, "
            "autrices et auteurs) : ce n'est pas le gabarit « Pronto — modèle d'article » "
            "attendu (%s)" % chemin_gabarit)
    table1_xml = tables_fixes[0].group(0)
    table2_xml = tables_fixes[1].group(0)

    i_sect = interieur.rindex('<w:sectPr')
    sect_xml = interieur[i_sect:]

    rid_existants = [int(m) for m in re.findall(r'Id="rId(\d+)"', rels_xml)]
    registre = _Registre(max(rid_existants, default=0) + 1, numbering_xml_gabarit)

    trace = []
    corps_xml = _convertir_niveau_racine(document.blocs, registre, trace)

    nouveau_corps = (table1_xml + PARAGRAPHE_VIDE + table2_xml + PARAGRAPHE_VIDE
                      + corps_xml + sect_xml)
    nouveau_doc_xml = preambule + nouveau_corps + queue

    nouvelles_relations = [
        (rid, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
         'media/' + nomfichier, False)
        for rid, nomfichier, _ext, _octets in registre.images
    ] + [
        (rid, 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
         url, True)
        for url, rid in registre.liens().items()
    ]
    rels_xml_final = _ajouter_relations(rels_xml, nouvelles_relations)
    extensions = sorted({ext for _, _, ext, _ in registre.images})
    ct_xml_final = _ajouter_types_contenu(ct_xml, extensions)

    if registre.extensions_inconnues:
        trace.append({'portee': 'document', 'source': None,
                      'decision': 'image_extension_inconnue',
                      'motif': "extension(s) d'image non reconnue(s) (%s) : type MIME "
                               "générique posé, Word pourra mal les afficher"
                               % ', '.join(sorted(registre.extensions_inconnues))})

    # §5.4 : une définition de liste a été réutilisée ou injectée pour chaque TYPE
    # ('puce'/'numero') effectivement employé par le document — une ligne de trace par type,
    # jamais en silence sur la voie choisie.
    for ligne in registre.listes.trace:
        motif = (("réutilise la définition « %s » déjà adéquate du gabarit (numId %s)"
                  % (ligne['type'], ligne['numid'])) if ligne['voie'] == 'gabarit' else
                 ("aucune définition « %s » adéquate dans le gabarit (le gabarit livré n'en "
                  "définit aucune, seul son num sert la numérotation de Titre1/2/3) : une "
                  "nouvelle définition a été injectée (numId %s)"
                  % (ligne['type'], ligne['numid'])))
        trace.append({'portee': 'document', 'source': None, 'decision': 'liste_numerotation',
                      'type': ligne['type'], 'voie': ligne['voie'], 'motif': motif})

    numbering_xml_final = registre.listes.xml_final()
    if numbering_xml_final is not None:
        contenus['word/numbering.xml'] = numbering_xml_final.encode('utf-8')
        if numbering_xml_gabarit is None:
            # Filet de sécurité jamais exercé par le gabarit livré (il porte déjà ce fichier,
            # relié et déclaré) : un gabarit qui n'aurait AUCUN numbering.xml a aussi besoin
            # de sa relation et de son entrée [Content_Types].xml pour rester un .docx valide.
            if 'numbering.xml' not in rels_xml_final:
                rid_num = 'rId%d' % registre._rid
                registre._rid += 1
                rels_xml_final = _ajouter_relations(rels_xml_final, [
                    (rid_num,
                     'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
                     'numbering.xml', False)])
            if '/word/numbering.xml' not in ct_xml_final:
                ct_xml_final = ct_xml_final.replace(
                    '</Types>',
                    '<Override PartName="/word/numbering.xml" ContentType='
                    '"application/vnd.openxmlformats-officedocument.wordprocessingml.'
                    'numbering+xml"/></Types>')

    contenus['word/document.xml'] = nouveau_doc_xml.encode('utf-8')
    contenus['word/_rels/document.xml.rels'] = rels_xml_final.encode('utf-8')
    contenus['[Content_Types].xml'] = ct_xml_final.encode('utf-8')
    for rid, nomfichier, _ext, octets in registre.images:
        contenus['word/media/' + nomfichier] = octets

    dossier = os.path.dirname(os.path.abspath(chemin_sortie))
    if dossier and not os.path.isdir(dossier):
        os.makedirs(dossier)
    with zipfile.ZipFile(chemin_sortie, 'w', zipfile.ZIP_DEFLATED) as zout:
        for nom, data in contenus.items():
            zout.writestr(nom, data)

    stats = {
        'paragraphes': sum(1 for b in document.blocs if isinstance(b, mm.Paragraphe)
                           and not any(f.image for f in b.fragments)),
        'blocs_figure': sum(1 for l in trace if l['decision'] == 'bloc_figure'),
        'blocs_tableau': sum(1 for l in trace if l['decision'] == 'bloc_tableau'),
        'images': len(registre.images),
        'liens': len(registre.liens()),
        'listes_non_reportees': sum(1 for l in trace if l['decision'] == 'liste_non_reportee'),
    }
    return {'stats': stats, 'trace': trace, 'decisions': decisions}
