#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_gabarit.py — l'ÉCRIVAIN du nettoyeur de manuscrit (article) : rend un Document du
# modèle riche (manuscrit_modele.py, §4 du contrat) en un .docx au gabarit « Pronto — modèle
# d'article ». Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §4, §5.3, §5.4, §10, §11.
#
# Principe non négociable du §5.3 : on part d'une COPIE du gabarit livré et on la remplit —
# jamais un .docx fabriqué de zéro. Ce module NE TOUCHE PAS aux styles.xml, numbering.xml,
# settings.xml, theme, en-têtes ni pieds de page du gabarit : ils sont recopiés OCTET POUR
# OCTET dans le fichier de sortie (settings.xml, theme, en-têtes/pieds de page, seulement lus
# pour styles.xml/numbering.xml/footnotes.xml, jamais réécrits sans raison). Seuls quelques
# membres de l'archive sont réécrits (word/document.xml, word/_rels/document.xml.rels,
# [Content_Types].xml, et désormais word/numbering.xml, word/footnotes.xml,
# word/_rels/footnotes.xml.rels QUAND le document en a besoin) et de nouveaux fichiers
# word/media/imageN.ext sont ajoutés — jamais retirés ni renommés.
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
# ── Contrat partagé du 19.09.2026 (notes de bas de page, décidé avec le superviseur) ────────
# `Fragment.note : int | None` — identifiant de la note appelée par ce fragment. `Document.
# notes : dict[int, list[Paragraphe|Tableau]]` — contenu de chaque note, par identifiant.
# Au moment d'écrire ce module, manuscrit_modele.py ne portait PAS encore ces deux champs
# (Fragment n'a pas de slot `note`, Document.notes était une simple liste) : ce module lit
# donc `fragment.note` par `getattr(fragment, 'note', None)`, JAMAIS `fragment.note` en dur
# (lèverait AttributeError sur un Fragment pas encore mis à jour), et n'utilise
# `document.notes` que s'il est bien un dict — sinon (ancienne forme liste, ou le champ
# n'existe pas encore côté lecteur) le document traverse sans aucune note écrite, comme
# avant ce chantier. Rien à corriger ici si l'autre module n'a pas encore livré : le
# comportement s'active tout seul dès qu'il le fait, sans aucun redéploiement de CE fichier.
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
#    défaut connu — non retenue. Correctif du 19.09.2026 : un ou plusieurs paragraphes VIDES
#    déjà présents dans le manuscrit, collés à un bloc, ne s'ajoutent plus au séparateur
#    injecté — ils s'y substituent (jamais deux paragraphes vides consécutifs autour d'un
#    bloc, jamais zéro non plus). Voir _separateur_requis() et le fondu des vides consécutifs
#    dans _convertir_niveau_racine().
#
# 3. Une image rencontrée DANS UNE CELLULE d'un tableau du manuscrit (donc pas au premier
#    niveau du document) est laissée EN PLACE, en ligne dans son paragraphe : elle n'est PAS
#    extraite dans un bloc figure séparé. Le §5.3 ne distingue pas explicitement les deux cas ;
#    imbriquer un bloc figure (donc un tableau) DANS une cellule de tableau ajoute une
#    complexité que le corpus mesuré ne justifie pas (aucune image dans une cellule de tableau
#    sur les onze manuscrits de lot-A ni sur le gabarit livré).
#
# 4. §5.4 : la numérotation de liste EST reportée, mais PAR CORRESPONDANCE — jamais par
#    recopie du numId d'origine, qui désigne une entrée d'un numbering.xml qui n'est pas
#    celui qu'on écrit. Le lecteur (manuscrit_docx.py) résout le FORMAT ('puce'/'numero'/'')
#    de chaque liste depuis le numbering.xml du MANUSCRIT ; cet écrivain choisit alors, pour
#    la SORTIE, une définition du gabarit si elle est adéquate (aucun niveau lié à un style de
#    titre — voir _RegistreListes), et en injecte une sinon, en le disant dans la trace
#    ('liste_reportee'). Un format non déterminé par le lecteur reçoit le repli déclaré de
#    l'écrivain — puce, la forme la plus commune — et la trace distingue explicitement « lu »
#    de « deviné par défaut ».
#
# 5. Une image dont l'extension n'est pas reconnue (§ CONTENU_TYPES_IMAGE) reçoit tout de
#    même un [Content_Types].xml valide (Default générique 'application/octet-stream') plutôt
#    que d'échouer : Word l'ouvrira sans doute mal, mais le document entier reste utilisable
#    et le défaut est tracé ('image-extension-inconnue').
#
# 6. `document.notes` (notes de bas de page) EST maintenant écrit (correctif du 19.09.2026,
#    voir le contrat partagé plus haut) : chaque note appelée par un fragment du corps devient
#    un `w:footnote` de word/footnotes.xml, renuméroté à partir de 1 (ou après le plus grand
#    id positif déjà présent dans le gabarit, s'il en avait — jamais sur le gabarit livré,
#    qui n'a que ses deux notes techniques séparateur/continuation). Le style de renvoi
#    (rStyle) et le style de paragraphe de note sont ceux du GABARIT s'il en définit (recherche
#    par le nom canonique anglais du style, « footnote reference »/« footnote text », comme
#    ailleurs dans ce module pour 'heading 1'/'Body Text' — jamais par un nom localisé qui
#    varierait selon la langue de Word) ; à défaut, un simple exposant (vertAlign) pour le
#    renvoi et Corpsdetexte pour le paragraphe — le gabarit livré n'a ni l'un ni l'autre, ce
#    repli est donc la voie normale aujourd'hui, comme pour les listes (décision n°4). Une
#    note appelée par le corps mais absente de `document.notes` (ne devrait jamais arriver
#    depuis un vrai lecteur) reçoit un contenu vide, tracé ; une note présente mais jamais
#    appelée n'est PAS écrite (elle serait sans ancre), et c'est tracé aussi.
#
# 7. Table de correspondance (ajoutée le 19.09.2026 à la demande du superviseur, pour un futur
#    module d'annotation) : `ecrire()` rend aussi `correspondance`, une liste de
#    {'source': indice du bloc dans document.blocs, 'sortie': indice, parmi les <w:p> enfants
#    DIRECTS de w:body, du <w:p> qui porte ce paragraphe dans la sortie} — un couple par
#    paragraphe de CORPS effectivement écrit comme <w:p> de premier niveau (jamais pour un
#    bloc figure/tableau — ce sont des <w:tbl>, pas des <w:p> — jamais pour le contenu d'une
#    cellule, jamais pour une note, jamais pour un paragraphe consommé comme légende ou fondu
#    comme vide surnuméraire : aucun de ceux-là ne produit de <w:p> de premier niveau à
#    pointer). _convertir_niveau_racine() calcule un indice RELATIF au corps qu'elle écrit ;
#    ecrire() y ajoute le nombre de <w:p> qui la précèdent dans le document final (les deux
#    paragraphes vides après les tableaux fixes du gabarit) pour obtenir l'indice ABSOLU.

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

# Extent (wp:extent) par défaut quand une image n'a jamais déclaré ni cx/cy ni pixels ni
# surface (0 partout) — une image raisonnable, ~8x6cm en EMU (914400 EMU/pouce).
_EXTENT_DEFAUT = (2880000, 2160000)

REL_IMAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
REL_LIEN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'
REL_NUMBERING = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering'
REL_FOOTNOTES = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes'


def _echapper(t):
    """Échappement XML minimal pour du contenu texte (jamais un attribut) : & < > seuls, les
    guillemets n'ont pas besoin d'être échappés hors attribut."""
    return (t or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _echapper_attribut(t):
    """Échappement XML pour une valeur D'ATTRIBUT : & < > ET le guillemet double, qui termine
    l'attribut prématurément sinon. Défaut mesuré : un lien portant un '&' non échappé
    ('https://doi.org/10.1000/x?q=a&r=b') ou un texte alternatif portant un guillemet droit
    ('Schéma "A"') produisaient un word/document.xml ou un word/_rels/document.xml.rels
    malformé — Word refuse le fichier, mais rien dans la chaîne d'écriture ne le détectait
    (code de sortie 0 malgré tout). `_echapper` seul ne suffit PAS ici : il ne touche pas au
    guillemet, qui est le caractère qui compte dans un attribut."""
    return _echapper(t).replace('"', '&quot;')


def _extent_depuis_surface(image, largeur_max_dxa=None):
    """(cx, cy) en EMU pour wp:extent — dans l'ordre de préférence du §4/§10 du contrat :
    1. `image.cx`/`image.cy` (la boîte d'affichage RÉELLE, ajoutée au modèle riche le
       18.09.2026) quand les deux sont renseignés ;
    2. à défaut, le rapport largeur/hauteur du FICHIER lui-même (`largeur_px`/`hauteur_px`),
       appliqué à une largeur d'affichage par défaut raisonnable — jamais un ratio 4:3
       arbitraire quand le vrai rapport est connu (défaut mesuré : 38 images du corpus,
       ratios d'entrée 0,66 à 20,4, toutes écrasées à 1,33 par l'ancienne version) ;
    3. à défaut, la seule SURFACE connue (EMU², cx*cy) sur un ratio 4:3 arbitraire, faute de
       mieux — la moins mauvaise information disponible ;
    4. à défaut de tout, `_EXTENT_DEFAUT`.
    Puis plafonné à `largeur_max_dxa` (converti en EMU, 1 dxa = 635 EMU) en conservant le
    rapport, si fourni — jamais None : `ecrire()` ne le pose que s'il a pu le lire dans le
    sectPr du gabarit (§10 : jamais deviner une mesure de page)."""
    if image.cx and image.cy:
        cx, cy = image.cx, image.cy
    elif image.largeur_px and image.hauteur_px:
        cx = _EXTENT_DEFAUT[0]
        cy = max(int(cx * image.hauteur_px / image.largeur_px), 1)
    elif image.surface and image.surface > 0:
        cy = int((image.surface * 3 / 4) ** 0.5) or 1
        cx = max(int(image.surface / cy), 1)
    else:
        cx, cy = _EXTENT_DEFAUT
    if largeur_max_dxa:
        largeur_max_emu = largeur_max_dxa * 635
        if largeur_max_emu > 0 and cx > largeur_max_emu:
            cy = max(int(cy * largeur_max_emu / cx), 1)
            cx = largeur_max_emu
    return cx, cy


def _attributs(balise_xml):
    """{nom: valeur} des attributs d'UNE balise XML donnée déjà isolée (ex: '<w:pgSz .../>')
    — plus robuste qu'un regex par attribut nommé, insensible à leur ORDRE (Word ne le
    garantit pas d'une version à l'autre)."""
    return dict(re.findall(r'([\w:]+)="([^"]*)"', balise_xml))


def _largeur_utile_page_dxa(sect_xml):
    """Largeur utile de page (dxa) depuis le sectPr du gabarit : w:pgSz w:w moins les marges
    gauche et droite de w:pgMar (§10 : jamais estimer une mesure de page, mais LIRE celle du
    gabarit est la mesure elle-même, pas une estimation). None si l'un des deux est absent ou
    mal formé — l'appelant ne plafonne alors aucune image plutôt que d'inventer une largeur."""
    m_pgsz = re.search(r'<w:pgSz\b[^>]*/>', sect_xml)
    m_pgmar = re.search(r'<w:pgMar\b[^>]*/>', sect_xml)
    if not m_pgsz or not m_pgmar:
        return None
    a_pgsz, a_pgmar = _attributs(m_pgsz.group(0)), _attributs(m_pgmar.group(0))
    try:
        largeur = (int(a_pgsz['w:w'])
                   - int(a_pgmar.get('w:left', a_pgmar.get('w:start', 0)))
                   - int(a_pgmar.get('w:right', a_pgmar.get('w:end', 0))))
    except (KeyError, ValueError):
        return None
    return largeur if largeur > 0 else None


class _Registre:
    """Accumule, pendant la traversée du Document, tout ce qu'il faudra ajouter à l'archive :
    les images à écrire sous word/media/ (avec leur relation), les hyperliens (une relation
    par URL distincte, jamais deux fois la même), les identifiants uniques de wp:docPr, et la
    liste des identifiants de note (voir `notes`, posé par ecrire()). `prochain_rid` doit
    démarrer au-delà du plus grand rId déjà présent dans le gabarit CÔTÉ document.xml.rels
    (mesuré : jusqu'à rId14 sur le gabarit livré) — calculé par l'appelant, jamais deviné ici.

    Deux ESPACES de relations, JAMAIS confondus : 'document' (word/_rels/document.xml.rels,
    où vivent les images/liens du CORPS) et 'notes' (word/_rels/footnotes.xml.rels, une
    partie DIFFÉRENTE de l'archive, avec son PROPRE espace de rId — un rId n'a de sens que
    DANS la partie qui le déclare). Un lien ou une image posé dans une note doit donc résoudre
    sa relation dans le second espace, jamais dans le premier : les confondre produirait un
    r:id qui ne correspond à rien dans les relations de la bonne partie."""

    def __init__(self, prochain_rid, numbering_xml=None):
        self._rid_document = prochain_rid
        self._rid_notes = 1
        self.images = []           # [(rid, nomfichier, extension, octets)] -> document.xml.rels
        self.images_notes = []     # même forme -> footnotes.xml.rels
        self._liens = {}           # url -> rid, document.xml.rels
        self._liens_notes = {}     # url -> rid, footnotes.xml.rels
        self._n_images = 0
        self._docpr_id = 0
        self.extensions_inconnues = set()
        self.listes = _RegistreListes(numbering_xml)
        self.notes = None          # posé par ecrire() une fois document.notes/styles connus
        self.largeur_max_dxa = None  # posé par ecrire() depuis le sectPr du gabarit

    def _nouveau_rid(self, espace='document'):
        if espace == 'notes':
            rid = 'rId%d' % self._rid_notes
            self._rid_notes += 1
        else:
            rid = 'rId%d' % self._rid_document
            self._rid_document += 1
        return rid

    def nouveau_docpr_id(self):
        """Identifiant croissant, unique dans TOUT le document — défaut mesuré :
        wp:docPr id="0" partout, ce que Word répare en silence à l'ouverture (identifiants
        dupliqués), un défaut qu'aucun contrôle de ce chantier ne voyait puisque le fichier
        s'ouvrait quand même."""
        self._docpr_id += 1
        return self._docpr_id

    def enregistrer_image(self, image, espace='document'):
        self._n_images += 1
        ext = os.path.splitext(image.nom)[1].lstrip('.').lower() or 'png'
        if ext not in CONTENU_TYPES_IMAGE:
            self.extensions_inconnues.add(ext)
        nomfichier = 'image%d.%s' % (self._n_images, ext)
        rid = self._nouveau_rid(espace)
        cible = self.images_notes if espace == 'notes' else self.images
        cible.append((rid, nomfichier, ext, image.octets))
        return rid

    def enregistrer_lien(self, url, espace='document'):
        d = self._liens_notes if espace == 'notes' else self._liens
        if url in d:
            return d[url]
        rid = self._nouveau_rid(espace)
        d[url] = rid
        return rid

    def liens(self, espace='document'):
        return dict(self._liens_notes if espace == 'notes' else self._liens)


# ---------------------------------------------------------------------------------
# Listes (§5.4 du contrat) — report PAR CORRESPONDANCE, jamais par recopie : une liste à
# puces du manuscrit vise la définition à puces de la sortie, une numérotée la définition
# numérotée, `ilvl` conservé. Le `numId` d'origine ne traverse JAMAIS — il désigne une entrée
# d'un numbering.xml qui n'est pas celui qu'on écrit.
#
# Ce qu'on écrit sur le paragraphe : LES DEUX FORMES à la fois — le style ET le w:numPr natif
# — parce que c'est ce que Word produit lui-même quand une autrice clique sur le bouton
# « puces » (§5.4). Le gabarit livré ne définit AUCUN style de liste : c'est donc Corpsdetexte
# qui porte le style, le w:numPr faisant tout le travail de numérotation.

# Niveaux 0..8 : la profondeur par défaut d'une liste multi-niveaux Word — largement au-delà
# de ce que le corpus mesuré emploie (ilvl 0 et 1 seulement), mais c'est la même borne que
# Word pose lui-même, jamais une estimation locale à ce module.
NIVEAUX_LISTE_INJECTEE = 9


def _niveau_puce_xml(ilvl):
    """w:lvlText porte U+F0B7 (zone d'usage privé), PAS U+2022 (« • ») : c'est ce que Word
    écrit lui-même pour une liste à puces en police Symbol, où U+F0B7 est mappé sur le glyphe
    rond plein. Symbol ne connaît PAS U+2022 : une puce U+2022 en police Symbol s'affiche en
    case vide (☐) dans Word — défaut mesuré, invisible tant qu'on ne l'ouvre pas dans Word
    lui-même (pandoc, lui, résout le numFmt sans jamais regarder le glyphe)."""
    indent = 720 * (ilvl + 1)
    return ('<w:lvl w:ilvl="' + str(ilvl) + '"><w:start w:val="1"/><w:numFmt w:val="bullet"/>'
            '<w:lvlText w:val="&#xF0B7;"/><w:lvlJc w:val="left"/>'
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

# Squelettes minimaux pour word/footnotes.xml et footnotes.xml.rels — n'arrivent jamais sur le
# gabarit livré (mesuré : il a déjà un footnotes.xml avec ses deux notes techniques, mais
# aucun footnotes.xml.rels, cette partie n'étant nécessaire QUE si une note porte un lien ou
# une image), gardés pour qu'un gabarit futur différent ne fasse pas planter l'écrivain.
_FOOTNOTES_XML_VIDE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '</w:footnotes>')
_RELS_VIDE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '</Relationships>')


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
# Notes de bas de page (contrat partagé du 19.09.2026) — voir l'en-tête. Une note appelée
# reçoit un numéro de SORTIE (jamais l'id d'origine, qui vise une entrée de footnotes.xml OU
# endnotes.xml du manuscrit — voir Document.notes — qui n'est pas la partie qu'on écrit),
# assigné dans l'ORDRE DE PREMIÈRE RENCONTRE pendant l'écriture du corps (donc l'ordre naturel
# de lecture, cellules de tableau comprises) : c'est `numero_pour`/`_resoudre`, appelé depuis
# `_run_xml`, qui assigne — jamais un pré-calcul séparé qui pourrait diverger de l'ordre réel
# d'écriture.

_NOMS_STYLE_APPEL_NOTE = ('footnote reference', 'endnote reference')
_NOMS_STYLE_TEXTE_NOTE = ('footnote text', 'endnote text')


def _styleid_par_nom(styles_xml, noms):
    """Le premier styleId dont le w:name RÉSOLU correspond (insensible à la casse) à l'un de
    `noms` — même convention que 'heading 1'/'Body Text' ailleurs dans ce module : le w:name
    reste en anglais canonique même dans un gabarit francophone, c'est lui qu'on compare,
    jamais un nom localisé qui varierait selon la langue de Word. None si aucun ne correspond
    (mesuré : le gabarit livré n'en a aucun) — c'est l'appelant qui pose alors le repli."""
    if not styles_xml:
        return None
    noms_lower = {n.lower() for n in noms}
    for m in re.finditer(r'<w:style\b[^>]*w:styleId="([^"]*)"[^>]*>(.*?)</w:style>',
                          styles_xml, re.S):
        sid, corps = m.group(1), m.group(2)
        nm = re.search(r'<w:name\s+w:val="([^"]*)"', corps)
        if nm and nm.group(1).lower() in noms_lower:
            return sid
    return None


def _resoudre_styles_note(styles_xml):
    """(style_car, style_para) : styleId de caractère pour l'appel de note (None si le
    gabarit n'en définit aucun — repli : vertAlign exposant posé directement sur le run) et
    styleId de paragraphe pour le corps de la note (STYLE_CORPS si le gabarit n'en définit
    aucun)."""
    style_car = _styleid_par_nom(styles_xml, _NOMS_STYLE_APPEL_NOTE)
    style_para = _styleid_par_nom(styles_xml, _NOMS_STYLE_TEXTE_NOTE) or STYLE_CORPS
    return style_car, style_para


class _RegistreNotes:
    """Résout le numéro de SORTIE de chaque note appelée, construit le XML de son contenu
    (réutilisant `_runs_xml`/`_tableau_xml` du corps — italique, liens, exposants conservés,
    §11) au moment de sa PREMIÈRE résolution, et rend le word/footnotes.xml final. Une note
    listée dans `document.notes` mais jamais appelée par aucun fragment n'est PAS écrite
    (elle serait sans ancre dans le corps) ; un appel dont l'id ne correspond à aucun contenu
    connu reçoit un contenu vide — les deux cas sont tracés, jamais en silence (§5 : « aucune
    décision silencieuse, jamais »)."""

    def __init__(self, document_notes, styles_xml_gabarit, footnotes_xml_gabarit):
        # Contrat partagé pas encore livré (Document.notes toujours une liste, ou absent) :
        # ce registre se comporte alors comme s'il n'y avait aucune note connue — jamais une
        # exception, voir l'en-tête du module.
        self._contenus = document_notes if isinstance(document_notes, dict) else {}
        self._style_car, self._style_para = _resoudre_styles_note(styles_xml_gabarit)
        ids_existants = [int(m) for m in
                          re.findall(r'<w:footnote\s+w:id="(-?\d+)"', footnotes_xml_gabarit or '')]
        self._depart = max([i for i in ids_existants if i > 0] or [0])
        self._resolus = {}          # id d'origine -> id de sortie
        self._xml_par_id = {}       # id de sortie -> XML intérieur du <w:footnote>
        self.trace = []
        self.notes_ecrites = 0

    def style_appel(self):
        return self._style_car

    def style_paragraphe(self):
        return self._style_para

    def _rpr_appel(self):
        if self._style_car:
            return '<w:rPr><w:rStyle w:val="%s"/></w:rPr>' % self._style_car
        return '<w:rPr><w:vertAlign w:val="superscript"/></w:rPr>'

    def run_appel_xml(self, id_origine, registre):
        """Le run à poser dans le CORPS à l'endroit où le fragment appelle la note —
        w:footnoteReference, jamais w:footnoteRef (réservé au premier paragraphe DE la note,
        voir _contenu_note_xml)."""
        id_sortie = self._resoudre(id_origine, registre)
        return '<w:r>%s<w:footnoteReference w:id="%d"/></w:r>' % (self._rpr_appel(), id_sortie)

    def _resoudre(self, id_origine, registre):
        if id_origine in self._resolus:
            return self._resolus[id_origine]
        id_sortie = self._depart + len(self._resolus) + 1
        self._resolus[id_origine] = id_sortie
        blocs = self._contenus.get(id_origine)
        if blocs is None:
            self.trace.append({
                'portee': 'document', 'source': None, 'decision': 'note_introuvable',
                'motif': "un appel de note (identifiant %r) ne correspond à aucun contenu lu "
                         "dans le manuscrit : une note vide a été écrite à sa place, à "
                         "vérifier dans le document produit" % (id_origine,)})
            blocs = []
        self._xml_par_id[id_sortie] = self._contenu_note_xml(blocs, registre)
        self.notes_ecrites += 1
        return id_sortie

    def _contenu_note_xml(self, blocs, registre):
        prefixe = ('<w:r>%s<w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> </w:t></w:r>'
                   % self._rpr_appel())
        morceaux = []
        for i, bloc in enumerate(blocs):
            tete = prefixe if i == 0 else ''
            if isinstance(bloc, mm.Tableau):
                if tete:
                    # Le repère de note ne peut pas se poser DANS un tableau : un paragraphe
                    # dédié, qui le porte seul, précède le tableau — seule façon de rester un
                    # document valide (Word exige un w:p, jamais un w:tbl, en premier enfant
                    # d'un w:footnote).
                    morceaux.append('<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>%s</w:p>'
                                     % (self._style_para, tete))
                    tete = ''
                morceaux.append(_tableau_xml(bloc, registre, 'notes'))
            else:
                runs = tete + _runs_xml(bloc.fragments, registre, 'notes')
                morceaux.append('<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>%s</w:p>'
                                 % (self._style_para, runs))
        if not morceaux:
            morceaux.append('<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>%s</w:p>'
                             % (self._style_para, prefixe))
        return ''.join(morceaux)

    def orphelines(self):
        """Ids d'origine présents dans document.notes mais jamais appelés par un fragment du
        corps — non écrits (voir la docstring de la classe), mais signalés."""
        return sorted(set(self._contenus) - set(self._resolus))

    def footnotes_xml_final(self, footnotes_xml_gabarit):
        if not self._xml_par_id:
            return None
        base = footnotes_xml_gabarit or _FOOTNOTES_XML_VIDE
        nouveaux = ''.join('<w:footnote w:id="%d">%s</w:footnote>' % (i, self._xml_par_id[i])
                            for i in sorted(self._xml_par_id))
        return base.replace('</w:footnotes>', nouveaux + '</w:footnotes>')


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


def _drawing_xml(rid, image, docpr_id, largeur_max_dxa=None):
    """<w:drawing> minimal (wp:inline) référençant la relation `rid`. Les espaces de noms
    'a' (drawingml/main) et 'pic' (drawingml/picture) ne sont PAS déclarés sur la racine du
    gabarit livré (mesuré : aucune image dans ce gabarit avant ce module, Word ne les avait
    donc jamais ajoutés) — déclarés ici localement sur w:drawing plutôt que de toucher au
    préambule du document, qui doit rester un recopiage verbatim (voir l'en-tête).
    `docpr_id` : identifiant UNIQUE dans tout le document (défaut mesuré : wp:docPr id="0"
    partout, que Word répare en silence à l'ouverture — voir _Registre.nouveau_docpr_id)."""
    cx, cy = _extent_depuis_surface(image, largeur_max_dxa)
    alt = _echapper_attribut(image.alt)
    return (
        '<w:drawing xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" '
        'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<wp:inline distT="0" distB="0" distL="0" distR="0">'
        '<wp:extent cx="%d" cy="%d"/>'
        '<wp:docPr id="%d" name="Image" descr="%s"/>'
        '<a:graphic>'
        '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
        '<pic:pic>'
        '<pic:nvPicPr><pic:cNvPr id="%d" name="Image"/><pic:cNvPicPr/></pic:nvPicPr>'
        '<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
        '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
        '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>'
        '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>'
    ) % (cx, cy, docpr_id, alt, docpr_id, rid, cx, cy)


def _run_xml(fragment, registre, espace='document'):
    if fragment.image is not None:
        rid = registre.enregistrer_image(fragment.image, espace)
        docpr_id = registre.nouveau_docpr_id()
        return '<w:r>%s</w:r>' % _drawing_xml(rid, fragment.image, docpr_id,
                                               registre.largeur_max_dxa)
    id_note = getattr(fragment, 'note', None)
    if id_note is not None and registre.notes is not None:
        return registre.notes.run_appel_xml(id_note, registre)
    if not fragment.texte:
        return ''
    rpr = _rpr_xml(fragment.forme)
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, _echapper(fragment.texte))


def _runs_xml(fragments, registre, espace='document'):
    """Concatène les runs d'une liste de Fragment, en enveloppant dans <w:hyperlink> chaque
    séquence CONSÉCUTIVE de fragments qui partagent le même lien non nul — un lien porté par
    plusieurs runs voisins (mise en forme coupée en plusieurs w:r à la lecture, §4 du contrat)
    ne doit donner qu'un seul w:hyperlink, pas un par run. `espace` : 'document' ou 'notes' —
    voir _Registre, jamais confondre les deux parties d'une relation."""
    morceaux = []
    i, n = 0, len(fragments)
    while i < n:
        lien = fragments[i].lien
        j = i + 1
        if lien is not None:
            while j < n and fragments[j].lien == lien:
                j += 1
        groupe_xml = ''.join(_run_xml(f, registre, espace) for f in fragments[i:j])
        if lien and groupe_xml:
            rid = registre.enregistrer_lien(lien, espace)
            morceaux.append('<w:hyperlink r:id="%s">%s</w:hyperlink>' % (rid, groupe_xml))
        else:
            morceaux.append(groupe_xml)
        i = j
    return ''.join(morceaux)


def _paragraphe_simple_xml(texte, style_id):
    """Un paragraphe à un seul run de texte plat, sans mise en forme — les lignes
    d'étiquette (« Texte alternatif : … ») des blocs figure/tableau qui n'ont pas de fragments
    à préserver (voir _rangee_meta_xml pour la Légende, seul champ qui peut en avoir)."""
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


def _paragraphe_xml(paragraphe, style_id, registre, espace='document'):
    """Un paragraphe de corps ou de titre — `style_id` vide pour un paragraphe SANS pStyle
    (utilisé pour le contenu de cellule d'un tableau du manuscrit, jamais restylé, voir la
    décision n°3 de l'en-tête). Si `paragraphe.liste` est renseigné, porte AUSSI un w:numPr
    natif — jamais le numId d'origine (§5.4) : _numpr_xml() résout un numId de LA SORTIE par
    correspondance, via le registre."""
    runs = _runs_xml(paragraphe.fragments, registre, espace)
    interieur = ('<w:pStyle w:val="%s"/>' % style_id) if style_id else ''
    if paragraphe.liste is not None:
        interieur += _numpr_xml(paragraphe.liste, registre)
    pPr = ('<w:pPr>%s</w:pPr>' % interieur) if interieur else ''
    return '<w:p>%s%s</w:p>' % (pPr, runs)


def _style_pour_paragraphe(paragraphe):
    return STYLE_TITRE.get(paragraphe.niveau_retenu, STYLE_CORPS)


# ---------------------------------------------------------------------------------
# Tableaux imbriqués (le tableau du manuscrit lui-même, posé dans la rangée 1 d'un bloc
# tableau, OU un tableau imbriqué dans une cellule, OU un tableau qui ouvre une note) —
# colspan (w:gridSpan) ET rowspan (w:vMerge), miroir en écriture de _tableau_depuis()/
# _vmerge_continuation() de manuscrit_docx.py.

def _grille_ecriture(rangees):
    """[[emplacement, ...], ...], ncols — un emplacement est {'type': 'cell', 'col', 'cellule'}
    ou {'type': 'continue', 'col', 'colspan'} (case(s) masquée(s) par une fusion verticale
    démarrée plus haut ; `colspan` reprend EXACTEMENT celui de la cellule de départ).

    Deux défauts mesurés, corrigés ici :
    - `ncols` se calculait sur la SEULE rangée 0 : une rangée plus large plus loin dans le
      tableau se faisait tronquer, ses cellules en trop simplement jetées. Corrigé : le
      MAXIMUM sur toutes les rangées ;
    - une fusion à la fois verticale ET horizontale perdait son gridSpan sur les lignes de
      continuation (une continuation par COLONNE individuelle au lieu d'une seule, large de
      `colspan`) — ce qui désynchronisait le nombre de <w:tc> de la ligne par rapport au
      tblGrid. Corrigé : `pending` retient la paire (colspan, rowspan_restant) d'un seul
      tenant, jamais colonne par colonne."""
    if not rangees:
        return [], 0
    ncols = max((sum(c.colspan for c in rangee) for rangee in rangees), default=0) or 1
    pending = {}   # col_debut -> [colspan, rowspan_restant]
    lignes = []
    for rangee in rangees:
        emplacements = []
        col = 0
        idx = 0
        while col < ncols:
            p = pending.get(col)
            if p and p[1] > 0:
                emplacements.append({'type': 'continue', 'col': col, 'colspan': p[0]})
                p[1] -= 1
                if p[1] <= 0:
                    del pending[col]
                col += p[0]
                continue
            if idx >= len(rangee):
                break  # rangée plus courte que la grille (tableau mal formé) : rien à masquer
            cellule = rangee[idx]
            emplacements.append({'type': 'cell', 'col': col, 'cellule': cellule})
            if cellule.rowspan > 1:
                pending[col] = [cellule.colspan, cellule.rowspan - 1]
            col += cellule.colspan
            idx += 1
        lignes.append(emplacements)
    return lignes, ncols


def _fermer_sur_paragraphe(xml_contenu):
    """Word exige qu'une cellule (w:tc) se termine par un paragraphe, jamais par un tableau —
    ajoute un paragraphe vide si le dernier bloc écrit était un tableau."""
    return xml_contenu if xml_contenu.rstrip().endswith('</w:p>') or not xml_contenu \
        else xml_contenu + PARAGRAPHE_VIDE


def _contenu_cellule_xml(blocs, registre, espace='document'):
    morceaux = []
    for bloc in blocs:
        if isinstance(bloc, mm.Tableau):
            morceaux.append(_tableau_xml(bloc, registre, espace))
        else:
            # Décision n°3 de l'en-tête : une image dans une cellule reste EN PLACE, en ligne
            # — jamais extraite dans un bloc figure imbriqué. Pas de restyle (style_id='') :
            # le contenu d'un tableau du manuscrit n'est pas retouché par §5.1/§5.2, qui ne
            # portent que sur les paragraphes de PREMIER NIVEAU (voir manuscrit_modele.py,
            # _paragraphes_premier_niveau).
            morceaux.append(_paragraphe_xml(bloc, '', registre, espace))
    if not morceaux:
        return PARAGRAPHE_VIDE
    return _fermer_sur_paragraphe(''.join(morceaux))


def _ligne_xml(emplacements, largeur_col, registre, espace='document'):
    row_entete = any(e['cellule'].entete for e in emplacements if e['type'] == 'cell')
    trpr = '<w:trPr><w:tblHeader/></w:trPr>' if row_entete else ''
    cellules_xml = []
    for e in emplacements:
        if e['type'] == 'continue':
            largeur = largeur_col * e['colspan']
            gridspan = ('<w:gridSpan w:val="%d"/>' % e['colspan']) if e['colspan'] > 1 else ''
            cellules_xml.append(
                '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s<w:vMerge/></w:tcPr><w:p/></w:tc>'
                % (largeur, gridspan))
            continue
        cellule = e['cellule']
        largeur = largeur_col * cellule.colspan
        gridspan = ('<w:gridSpan w:val="%d"/>' % cellule.colspan) if cellule.colspan > 1 else ''
        vmerge = '<w:vMerge w:val="restart"/>' if cellule.rowspan > 1 else ''
        contenu = _contenu_cellule_xml(cellule.blocs, registre, espace)
        cellules_xml.append(
            '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s%s</w:tcPr>%s</w:tc>'
            % (largeur, gridspan, vmerge, contenu))
    return '<w:tr>%s%s</w:tr>' % (trpr, ''.join(cellules_xml))


def _tableau_xml(tableau, registre, espace='document'):
    lignes, ncols = _grille_ecriture(tableau.rangees)
    largeur_col = max(LARGEUR_TABLEAU_INTERNE_DXA // max(ncols, 1), 1)
    grille = ''.join('<w:gridCol w:w="%d"/>' % largeur_col for _ in range(ncols))
    lignes_xml = ''.join(_ligne_xml(e, largeur_col, registre, espace) for e in lignes)
    return ('<w:tbl>' + (_BLOC_TBLPR % (largeur_col * ncols)) + '<w:tblGrid>' + grille
             + '</w:tblGrid>' + lignes_xml + '</w:tbl>')


# ---------------------------------------------------------------------------------
# Blocs figure/tableau — §5.3 : une rangée de métadonnées (Légende/Texte alternatif/Crédit/
# Source, style SZH Cle) puis le contenu. Le gabarit livré ne pose qu'UNE colonne pour ce
# tableau (mesuré : tblGrid à un seul w:gridCol) — la « cellule fusionnée sur toute la
# largeur » du §5.3 est donc DÉJÀ acquise par construction, aucun w:gridSpan n'est nécessaire
# ici (à la différence du tableau du MANUSCRIT lui-même, qui peut avoir plusieurs colonnes,
# voir _tableau_xml ci-dessus).

def _rangee_meta_xml(champs, registre):
    """`champs['legende']` peut être soit une chaîne (Crédit/Source/Texte alternatif, ou
    Légende sans contenu retrouvé dans le manuscrit — jamais inventée), soit une LISTE DE
    FRAGMENTS (la légende déjà écrite dans le manuscrit, préservée avec sa mise en forme —
    voir _cherche_legende). Défaut mesuré, corrigé ici : une légende aplatie en texte plat
    perdait ses exposants (2 occurrences sur 2 dans le corpus), l'ancienne version ne
    produisant qu'un texte brut pour les quatre champs sans distinction."""
    paras = []
    for cle, label in CHAMPS_BLOC:
        valeur = champs.get(cle)
        if isinstance(valeur, list) and valeur:
            runs = _runs_xml(valeur, registre)
            paras.append('<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>'
                         '<w:r><w:t xml:space="preserve">%s : </w:t></w:r>%s</w:p>'
                          % (STYLE_CLE, _echapper(label), runs))
        else:
            texte_plat = valeur.strip() if isinstance(valeur, str) else ''
            texte = '%s : %s' % (label, texte_plat) if texte_plat else '%s : ' % label
            paras.append(_paragraphe_simple_xml(texte, STYLE_CLE))
    return ('<w:tr><w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc></w:tr>'
             % (LARGEUR_BLOC_DXA, ''.join(paras)))


def _rangee_image_xml(image, registre):
    rid = registre.enregistrer_image(image)
    docpr_id = registre.nouveau_docpr_id()
    p = '<w:p><w:r>%s</w:r></w:p>' % _drawing_xml(rid, image, docpr_id, registre.largeur_max_dxa)
    return ('<w:tr><w:trPr><w:trHeight w:val="1701"/></w:trPr>'
             '<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc></w:tr>'
             % (LARGEUR_BLOC_DXA, p))


def _rangee_tableau_interne_xml(tableau, registre):
    contenu = _fermer_sur_paragraphe(_tableau_xml(tableau, registre))
    return ('<w:tr><w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc></w:tr>'
             % (LARGEUR_BLOC_DXA, contenu))


def _bloc_xml(champs, rangee_contenu_xml, registre):
    return ('<w:tbl>' + (_BLOC_TBLPR % LARGEUR_BLOC_DXA)
            + '<w:tblGrid><w:gridCol w:w="%d"/></w:tblGrid>' % LARGEUR_BLOC_DXA
            + _rangee_meta_xml(champs, registre) + rangee_contenu_xml + '</w:tbl>')


# ---------------------------------------------------------------------------------
# Traversée du corps — extraction des images en blocs figure, des tableaux en blocs tableau,
# association d'une légende déjà écrite dans le manuscrit (§5.3), et le paragraphe vide
# obligatoire autour de chaque bloc (§10, décision n°2 de l'en-tête).

def _texte_paragraphe(paragraphe):
    return paragraphe.texte().strip()


def _cherche_legende(blocs, idx, consommes):
    """([indices consommés], fragments) d'une légende déjà écrite dans le manuscrit pour le
    bloc figure/tableau à `idx` — ([], None) si rien ne convient. Rend la liste de FRAGMENT
    (mise en forme comprise, jamais un texte déjà aplati — voir _rangee_meta_xml).

    Deux formes reconnues :
    - un titre bref (« Tableau 1 », SANS ponctuation finale, ≤ 20 caractères) qui matche
      RE_LEGENDE à lui seul, immédiatement suivi d'un paragraphe qui porte le texte de la
      légende proprement dit — mesuré sur un manuscrit réel (« Le coenseignement
      développemental… ») où le gabarit de l'autrice sépare le numéro du tableau et son
      texte sur deux paragraphes ; cherchée en PRIORITÉ pour ne pas laisser le titre seul se
      faire consommer sans son texte par la forme à un seul paragraphe ci-dessous ;
    - à défaut, un seul paragraphe voisin (suivant PUIS précédent, convention la plus
      fréquente : légende sous la figure) qui matche RE_LEGENDE à lui seul — le contrat ne dit
      pas si la légende attendue se trouve avant ou après le bloc qu'elle nomme, les deux sont
      acceptées."""
    i_titre, i_texte = idx - 2, idx - 1
    if (i_titre >= 0 and i_titre not in consommes and i_texte not in consommes
            and i_texte < len(blocs)):
        titre, texte_bloc = blocs[i_titre], blocs[i_texte]
        if (isinstance(titre, mm.Paragraphe) and isinstance(texte_bloc, mm.Paragraphe)
                and not any(f.image is not None for f in titre.fragments)
                and not any(f.image is not None for f in texte_bloc.fragments)):
            txt_titre = _texte_paragraphe(titre)
            txt_texte = _texte_paragraphe(texte_bloc)
            if (txt_titre and RE_LEGENDE.match(txt_titre) and len(txt_titre) <= 20
                    and not txt_titre.rstrip().endswith((':', '.', '!', '?'))
                    and txt_texte and not RE_LEGENDE.match(txt_texte)):
                fragments = (list(titre.fragments)
                             + [mm.Fragment(texte=' ', image=None, forme={}, lien=None,
                                            source=None)]
                             + list(texte_bloc.fragments))
                return [i_titre, i_texte], fragments

    for voisin in (idx + 1, idx - 1):
        if voisin < 0 or voisin >= len(blocs) or voisin in consommes:
            continue
        bloc = blocs[voisin]
        if not isinstance(bloc, mm.Paragraphe) or any(f.image is not None for f in bloc.fragments):
            continue
        texte = _texte_paragraphe(bloc)
        if texte and RE_LEGENDE.match(texte):
            return [voisin], list(bloc.fragments)
    return [], None


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
    consommes = set()
    legendes = {}          # indice du bloc image/tableau -> liste de Fragment
    for idx, bloc in enumerate(blocs):
        est_image = isinstance(bloc, mm.Paragraphe) and any(f.image is not None
                                                             for f in bloc.fragments)
        est_tableau = isinstance(bloc, mm.Tableau)
        if not (est_image or est_tableau):
            continue
        indices, fragments = _cherche_legende(blocs, idx, consommes)
        if fragments is not None:
            consommes.update(indices)
            legendes[idx] = fragments
    return legendes, consommes


def _texte_legende_trace(fragments):
    return ''.join(f.texte for f in fragments) if fragments else ''


def _convertir_niveau_racine(blocs, registre, trace):
    """Rend (xml_du_corps, correspondance) — xml_du_corps hors les deux tableaux fixes.

    `correspondance` (ajout du 19.09.2026, pour un futur module d'annotation) : une liste de
    {'source': indice du bloc dans `blocs`, 'sortie': indice RELATIF, parmi les <w:p> écrits
    ICI, du <w:p> qui le porte} — un couple par paragraphe de CORPS effectivement écrit comme
    <w:p> de premier niveau (jamais pour un bloc figure/tableau, qui produit un <w:tbl>, pas
    un <w:p> ; jamais pour un paragraphe consommé comme légende ou fondu comme vide
    surnuméraire, aucun des deux ne produisant de <w:p>). L'indice est RELATIF à ce que cette
    fonction écrit seule : ecrire() y ajoute le nombre de <w:p> qui la précèdent dans le
    document final pour obtenir l'indice ABSOLU demandé.
    """
    n = len(blocs)
    legendes, consommes = _associer_legendes(blocs)
    segments = []          # (est_bloc, xml, idx_source_ou_None, est_vide)

    idx = 0
    while idx < n:
        if idx in consommes:
            idx += 1
            continue
        bloc = blocs[idx]

        if isinstance(bloc, mm.Tableau):
            fragments_legende = legendes.get(idx)
            champs = {'legende': fragments_legende or '', 'alt': '', 'credit': '', 'source': ''}
            xml = _bloc_xml(champs, _rangee_tableau_interne_xml(bloc, registre), registre)
            segments.append((True, xml, None, False))
            texte_legende = _texte_legende_trace(fragments_legende)
            trace.append({'portee': 'bloc', 'source': bloc.source, 'decision': 'bloc_tableau',
                          'motif': 'tableau posé dans un bloc tableau ; légende %s'
                                   % ('reprise du manuscrit (« %s »)' % texte_legende
                                      if fragments_legende else 'absente (champ laissé vide)')})

        elif isinstance(bloc, mm.Paragraphe):
            images = [f.image for f in bloc.fragments if f.image is not None]
            if images:
                fragments_texte = [f for f in bloc.fragments if f.image is None]
                if any(f.texte.strip() for f in fragments_texte):
                    p_texte = mm.Paragraphe(style=bloc.style, niveau_declare=bloc.niveau_declare,
                                             niveau_retenu=bloc.niveau_retenu,
                                             fragments=fragments_texte, source=bloc.source)
                    style_id = _style_pour_paragraphe(p_texte)
                    segments.append((False, _paragraphe_xml(p_texte, style_id, registre),
                                      idx, False))
                # La légende éventuellement trouvée pour ce paragraphe ne va QUE sur la
                # première image : un paragraphe portant plusieurs images est rare, et le
                # contrat n'envisage pas d'en répartir une seule légende entre plusieurs blocs.
                fragments_legende = legendes.get(idx)
                for k, image in enumerate(images):
                    champs = {'legende': (fragments_legende if k == 0 else None) or '',
                              'alt': image.alt, 'credit': '', 'source': ''}
                    xml = _bloc_xml(champs, _rangee_image_xml(image, registre), registre)
                    segments.append((True, xml, None, False))
                    champs_vides = [label for cle, label in CHAMPS_BLOC if not champs.get(cle)]
                    trace.append({'portee': 'bloc', 'source': bloc.source,
                                  'decision': 'bloc_figure',
                                  'motif': 'image « %s » posée dans un bloc figure ; champs '
                                           'vides : %s' % (image.nom,
                                                            ', '.join(champs_vides) or 'aucun')})
            else:
                est_vide = bloc.liste is None and not any(f.texte.strip() for f in bloc.fragments)
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
                segments.append((False, _paragraphe_xml(bloc, style_id, registre), idx, est_vide))
        idx += 1

    # Défaut mesuré (§10, décision n°2 de l'en-tête) : des paragraphes vides consécutifs —
    # venus du manuscrit, ou de plusieurs blocs voisins ajoutant chacun leur propre demande de
    # séparateur — pouvaient s'empiler à deux ou trois autour d'un même bloc. Fondus ici à UN
    # SEUL au maximum, jamais zéro.
    segments_reduits = []
    for seg in segments:
        if seg[3] and segments_reduits and segments_reduits[-1][3]:
            continue
        segments_reduits.append(seg)

    morceaux = []
    correspondance = []
    compteur_wp = 0
    precedent_est_bloc = False
    precedent_est_vide = False
    for i, (est_bloc, xml, idx_source, est_vide) in enumerate(segments_reduits):
        if (i > 0 and _separateur_requis(est_bloc, precedent_est_bloc)
                and not precedent_est_vide and not est_vide):
            morceaux.append(PARAGRAPHE_VIDE)
            compteur_wp += 1
        morceaux.append(xml)
        if not est_bloc:
            if idx_source is not None:
                correspondance.append({'source': idx_source, 'sortie': compteur_wp})
            compteur_wp += 1
        precedent_est_bloc = est_bloc
        precedent_est_vide = est_vide
    return ''.join(morceaux), correspondance


def _separateur_requis(est_bloc_courant, est_bloc_precedent):
    """§5.3/§10 : un bloc figure/tableau ne touche JAMAIS son voisin, quel qu'il soit — c'est
    précisément l'adjacence TABLEAU-TABLEAU que LibreOffice fond en un seul tableau (mesuré,
    §10 : 4 tableaux côté .docx, 3 côté .odt sur le gabarit réel). Un paragraphe de corps
    entre deux AUTRES paragraphes de corps, lui, n'a jamais montré ce défaut : on ne lui
    impose pas de ligne vide supplémentaire (décision n°2 de l'en-tête). Fonction unique
    délibérément séparée de l'assemblage : c'est LE point que le contrôle n°5 du §11 sabote
    pour prouver qu'il garde vraiment quelque chose. Le fondu des vides consécutifs (voir
    l'appelant) décide ENSUITE s'il faut vraiment injecter ce séparateur, ou si un paragraphe
    vide du manuscrit lui-même en tient déjà lieu."""
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
        % (rid, typ, _echapper_attribut(cible), ' TargetMode="External"' if externe else '')
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
        % (_echapper_attribut(ext), CONTENU_TYPES_IMAGE.get(ext.lower(),
                                                             'application/octet-stream'))
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
    simplement recopié dans le retour, pour qu'un seul objet porte tout l'historique d'un
    document au moment d'écrire le rapport. Rend un dict {'stats', 'trace', 'decisions',
    'correspondance'} — voir la docstring de _convertir_niveau_racine pour ce dernier champ.
    """
    with zipfile.ZipFile(chemin_gabarit) as zin:
        noms = zin.namelist()
        doc_xml = zin.read('word/document.xml').decode('utf-8')
        rels_xml = zin.read('word/_rels/document.xml.rels').decode('utf-8')
        ct_xml = zin.read('[Content_Types].xml').decode('utf-8')
        contenus = {nom: zin.read(nom) for nom in noms}

    numbering_xml_gabarit = (contenus['word/numbering.xml'].decode('utf-8')
                              if 'word/numbering.xml' in contenus else None)
    styles_xml_gabarit = (contenus['word/styles.xml'].decode('utf-8')
                           if 'word/styles.xml' in contenus else None)
    footnotes_xml_gabarit = (contenus['word/footnotes.xml'].decode('utf-8')
                              if 'word/footnotes.xml' in contenus else None)

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
    registre.largeur_max_dxa = _largeur_utile_page_dxa(sect_xml)
    registre.notes = _RegistreNotes(document.notes, styles_xml_gabarit, footnotes_xml_gabarit)

    trace = []
    corps_xml, correspondance_relative = _convertir_niveau_racine(document.blocs, registre, trace)

    # Décision n°7 de l'en-tête : les deux <w:p/> qui séparent les deux tableaux fixes du
    # gabarit précèdent le corps — d'où le décalage entre l'indice RELATIF que rend
    # _convertir_niveau_racine (qui ignore tout ce qu'elle n'écrit pas elle-même) et
    # l'indice ABSOLU, parmi tous les <w:p> enfants directs de w:body, que demande le futur
    # module d'annotation.
    PREFIXE_WP_TABLEAUX_FIXES = 2
    correspondance = [{'source': c['source'], 'sortie': c['sortie'] + PREFIXE_WP_TABLEAUX_FIXES}
                       for c in correspondance_relative]

    nouveau_corps = (table1_xml + PARAGRAPHE_VIDE + table2_xml + PARAGRAPHE_VIDE
                      + corps_xml + sect_xml)
    nouveau_doc_xml = preambule + nouveau_corps + queue

    nouvelles_relations = [
        (rid, REL_IMAGE, 'media/' + nomfichier, False)
        for rid, nomfichier, _ext, _octets in registre.images
    ] + [
        (rid, REL_LIEN, url, True)
        for url, rid in registre.liens().items()
    ]
    rels_xml_final = _ajouter_relations(rels_xml, nouvelles_relations)
    extensions = sorted({ext for _, _, ext, _ in registre.images + registre.images_notes})
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
                rid_num = registre._nouveau_rid('document')
                rels_xml_final = _ajouter_relations(rels_xml_final, [
                    (rid_num, REL_NUMBERING, 'numbering.xml', False)])
            if '/word/numbering.xml' not in ct_xml_final:
                ct_xml_final = ct_xml_final.replace(
                    '</Types>',
                    '<Override PartName="/word/numbering.xml" ContentType='
                    '"application/vnd.openxmlformats-officedocument.wordprocessingml.'
                    'numbering+xml"/></Types>')

    # Notes de bas de page (contrat partagé du 19.09.2026) — voir l'en-tête, décision n°6.
    for ligne in registre.notes.trace:
        trace.append(ligne)
    orphelines = registre.notes.orphelines()
    if orphelines:
        trace.append({'portee': 'document', 'source': None, 'decision': 'notes_orphelines',
                      'motif': "note(s) lue(s) dans le manuscrit mais jamais appelée(s) par un "
                               "fragment du corps, donc non écrites (%s)" % (orphelines,)})
    if registre.notes.notes_ecrites:
        style_appel = registre.notes.style_appel()
        trace.append({'portee': 'document', 'source': None, 'decision': 'notes_ecrites',
                      'motif': '%d note(s) de bas de page reportée(s) depuis le manuscrit ; '
                               'renvoi en %s, paragraphe en style « %s »'
                               % (registre.notes.notes_ecrites,
                                  ('style « %s » du gabarit' % style_appel) if style_appel
                                  else 'exposant simple (le gabarit ne définit aucun style '
                                       'd\'appel de note)',
                                  registre.notes.style_paragraphe())})

    footnotes_xml_final = registre.notes.footnotes_xml_final(footnotes_xml_gabarit)
    if footnotes_xml_final is not None:
        contenus['word/footnotes.xml'] = footnotes_xml_final.encode('utf-8')
        if footnotes_xml_gabarit is None:
            # Filet de sécurité jamais exercé par le gabarit livré (il porte déjà ce fichier,
            # relié et déclaré) — même logique que pour numbering.xml plus haut.
            if 'footnotes.xml' not in rels_xml_final:
                rid_fn = registre._nouveau_rid('document')
                rels_xml_final = _ajouter_relations(rels_xml_final, [
                    (rid_fn, REL_FOOTNOTES, 'footnotes.xml', False)])
            if '/word/footnotes.xml' not in ct_xml_final:
                ct_xml_final = ct_xml_final.replace(
                    '</Types>',
                    '<Override PartName="/word/footnotes.xml" ContentType='
                    '"application/vnd.openxmlformats-officedocument.wordprocessingml.'
                    'footnotes+xml"/></Types>')

    # Relations propres à footnotes.xml (une note qui porte une image ou un lien) : une
    # PARTIE différente de l'archive, avec son PROPRE fichier .rels — jamais mélangées à
    # celles de document.xml (voir _Registre).
    nouvelles_relations_notes = [
        (rid, REL_IMAGE, 'media/' + nomfichier, False)
        for rid, nomfichier, _ext, _octets in registre.images_notes
    ] + [
        (rid, REL_LIEN, url, True) for url, rid in registre.liens('notes').items()
    ]
    if nouvelles_relations_notes:
        rels_notes_gabarit = (contenus['word/_rels/footnotes.xml.rels'].decode('utf-8')
                               if 'word/_rels/footnotes.xml.rels' in contenus else None)
        contenus['word/_rels/footnotes.xml.rels'] = _ajouter_relations(
            rels_notes_gabarit or _RELS_VIDE, nouvelles_relations_notes).encode('utf-8')

    contenus['word/document.xml'] = nouveau_doc_xml.encode('utf-8')
    contenus['word/_rels/document.xml.rels'] = rels_xml_final.encode('utf-8')
    contenus['[Content_Types].xml'] = ct_xml_final.encode('utf-8')
    for rid, nomfichier, _ext, octets in registre.images + registre.images_notes:
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
        'images': len(registre.images) + len(registre.images_notes),
        'liens': len(registre.liens()) + len(registre.liens('notes')),
        'listes_non_reportees': sum(1 for l in trace if l['decision'] == 'liste_non_reportee'),
        'notes_ecrites': registre.notes.notes_ecrites,
    }
    return {'stats': stats, 'trace': trace, 'decisions': decisions,
            'correspondance': correspondance}
