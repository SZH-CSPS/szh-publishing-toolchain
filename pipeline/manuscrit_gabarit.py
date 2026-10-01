#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_gabarit.py — l'ÉCRIVAIN du nettoyeur de manuscrit (article) : rend un Document du
# modèle riche (manuscrit_modele.py, §4 du contrat) en un .docx au gabarit « Pronto — modèle
# d'article ». Contrat : docs/ARCHITECTURE-nettoyeur-manuscrit.md, §4, §5.3, §5.4, §10, §11.
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
# .docx, il en écrit). RE_LEGENDE est recopié tel quel depuis docx-titres.py (nom à tiret,
# `import docx-titres` est syntaxiquement impossible), comme pronto_modele.py l'a déjà fait
# pour normaliser().
#
# stdlib uniquement : zipfile, re, os — pas de python-docx, pas de lxml (§2 du contrat).
#
# `Fragment.note : int | None` — identifiant de la note appelée par ce fragment. `Document.
# notes : dict[int, list[Paragraphe|Tableau]]` — contenu de chaque note, par identifiant. Lus
# par `getattr(fragment, 'note', None)` et en vérifiant que `document.notes` est bien un dict
# (jamais en dur) : un Fragment ou un Document plus ancien, sans ces champs, traverse alors
# sans aucune note écrite plutôt que de lever une AttributeError.
#
# Pièges et décisions qui ne sont pas dans le contrat, à ne pas repayer :
#
# - Les deux tableaux fixes du gabarit (métadonnées, autrices et auteurs) sont recopiés
#   VERBATIM, vides, tels que livrés : ce module ne produit que ce qui SUIT ces deux tableaux.
# - « Toujours un paragraphe vide entre deux blocs » (§5.3/§10) ne s'applique qu'entre un bloc
#   figure/tableau et SON VOISIN, jamais entre deux paragraphes de corps ordinaires (le risque
#   mesuré est spécifiquement DEUX TABLEAUX qui se touchent, fondus en un seul par
#   LibreOffice). Des paragraphes vides déjà présents dans le manuscrit, collés à un bloc, ne
#   s'ajoutent pas au séparateur injecté — ils s'y substituent (`_separateur_requis()`, jamais
#   deux vides consécutifs autour d'un bloc, jamais zéro).
# - Une image DANS UNE CELLULE de tableau reste en ligne dans son paragraphe, jamais extraite
#   en bloc figure séparé (imbriquer un tableau dans une cellule est une complexité que le
#   corpus ne justifie pas — aucun cas mesuré).
# - §5.4, les listes : la numérotation est reportée PAR CORRESPONDANCE, jamais par recopie du
#   numId d'origine (qui désigne une entrée d'un numbering.xml qui n'est pas celui qu'on
#   écrit). Une définition du gabarit est réutilisée si elle convient (`_RegistreListes`),
#   sinon injectée, tracé ('liste_reportee') ; un format non déterminé par le lecteur reçoit
#   le repli — puce — et la trace distingue « lu » de « deviné par défaut ».
# - Une image d'extension non reconnue reçoit quand même un [Content_Types].xml valide
#   (Default générique) plutôt que d'échouer ; tracé ('image-extension-inconnue').
# - `document.notes` : chaque note appelée par un fragment du corps devient un `w:footnote`,
#   renuméroté à partir de 1 (ou après le plus grand id déjà présent). Style de renvoi et de
#   paragraphe de note pris dans le GABARIT s'il en définit (nom canonique anglais du style,
#   jamais un nom localisé) ; à défaut, simple exposant + Corpsdetexte — le gabarit livré n'a
#   ni l'un ni l'autre, ce repli est la voie normale. Une note appelée mais absente de
#   `document.notes` reçoit un contenu vide, tracé ; une note jamais appelée n'est pas écrite.
# - Table de correspondance : `ecrire()` rend `correspondance`, une liste de {'source':
#   Paragraphe.source du bloc d'origine, 'sortie': indice, parmi les <w:p> enfants DIRECTS de
#   w:body, du <w:p> qui le porte} — un couple par paragraphe de CORPS écrit comme <w:p> de
#   premier niveau (jamais pour un bloc figure/tableau, une cellule, une note, une légende
#   consommée ou un vide surnuméraire). `_convertir_niveau_racine()` calcule un indice RELATIF
#   au corps qu'elle écrit ; `ecrire()` y ajoute le nombre de <w:p> qui la précèdent (les deux
#   paragraphes vides après les tableaux fixes) pour obtenir l'indice ABSOLU.

import os
import re
import zipfile
from datetime import datetime, timezone

import manuscrit_modele as mm
import pronto_modele

# ---------------------------------------------------------------------------------
# Styles du gabarit — JAMAIS un styleId codé en dur : résolus depuis word/styles.xml DU
# GABARIT COURANT, par w:name, au début d'ecrire() (voir _StylesResolus plus bas). Depuis les
# gabarits V4 (29.09.2026, deux fichiers FR/DE), les styleId réels ne sont PLUS Titre1/2/3,
# Corpsdetexte : les deux gabarits ont été enregistrés par un Word allemand et portent
# berschrift1/2/3/4 (w:name "heading 1/2/3/4"), Textkrper (w:name "Body Text") — alors que les
# w:name, eux, restent les mêmes noms canoniques anglais des deux côtés. Coder un styleId en
# dur romprait donc silencieusement le gabarit DE (styles introuvables -> repli permanent).
#
# Les constantes ci-dessous restent : elles ne sont plus QUE le REPLI documenté (mesuré sur le
# gabarit FR tel que livré le 18.09.2026, avant la réédition en Word allemand) employé quand la
# résolution par nom échoue — jamais une exception, toujours tracé (_StylesResolus.trace).
_REPLI_STYLE_TITRE = {1: 'Titre1', 2: 'Titre2', 3: 'Titre3', 4: 'Titre4'}
_REPLI_STYLE_CORPS = 'Corpsdetexte'
_REPLI_STYLE_CLE = 'SZHCle'
# Révision du 21.09.2026 (décision de Robin) : les métadonnées d'un bloc figure/tableau ne
# vont plus dans un tableau enveloppe, mais dans des paragraphes de CE style, juste avant
# l'image ou le tableau — clone de SZHCle avec une bordure ouverte (haut/gauche/droite, pas en
# bas), ajoutée à word/styles.xml du gabarit. Les paragraphes consécutifs de ce style dessinent
# un seul cadre : Word fusionne les bordures de paragraphes adjacents identiques — c'est cette
# propriété du format qui rend inutile toute table enveloppe ici.
_REPLI_STYLE_CLE_ABB_TAB = 'SZHCleAbbTab'

# Les styles MAISON du gabarit : (nom w:name, styleId de repli), par nom normalisé
# (pronto_modele.normaliser_nom_style) — les deux gabarits V4 gardent ces styleId identiques à
# eux-mêmes (mesuré : SZHCle, SZHCleAbbTab... n'ont pas bougé avec la réédition allemande), mais
# résolus par nom quand même, comme tout le reste (jamais deux façons de faire dans ce module).
# Un paragraphe qui porte déjà l'un d'eux — document déjà au gabarit (cas A), ou manuscrit écrit
# dans une copie du gabarit — le GARDE : réécrit en Corps de texte, un encadré « SZH Important »
# perdait son cadre, et un bloc « SZH Cle Abb/Tab » ses étiquettes de figure (mesuré : un
# document déjà au gabarit sortait du nettoyeur avec ses clés en Corpsdetexte, suivies d'un
# second jeu de clés vides).
_REPLI_STYLES_MAISON = {
    pronto_modele.normaliser_nom_style(nom): (nom, style_id) for nom, style_id in (
        ('SZH Important', 'SZHImportant'), ('SZH Hervorhebung', 'SZHHervorhebung'),
        ('SZH Question (interview)', 'SZHQuestioninterview'), ('SZH Cle', _REPLI_STYLE_CLE),
        ('SZH Cle Abb/Tab', _REPLI_STYLE_CLE_ABB_TAB), ('SZH Aide', 'SZHAide'))
}


class _StylesResolus:
    """StyleId réels du gabarit COURANT, résolus UNE FOIS par ecrire() (voir son en-tête)
    depuis word/styles.xml, par w:name — via `_styleid_par_nom()`, la même résolution déjà
    employée pour les styles de note (_resoudre_styles_note). Une résolution manquante tombe
    sur le repli historique (_REPLI_*) et c'est tracé dans `self.trace`, jamais une exception :
    un style introuvable ne doit jamais interrompre l'écriture (§ en-tête du module)."""

    def __init__(self, styles_xml):
        self.trace = []
        self.titre = {n: self._resoudre(styles_xml, ('heading %d' % n,), repli,
                                         'titre de niveau %d' % n)
                      for n, repli in _REPLI_STYLE_TITRE.items()}
        self.corps = self._resoudre(styles_xml, ('Body Text',), _REPLI_STYLE_CORPS,
                                     'corps de texte')
        self.cle_abb_tab = self._resoudre(styles_xml, ('SZH Cle Abb/Tab',),
                                           _REPLI_STYLE_CLE_ABB_TAB,
                                           'clé de bloc figure/tableau')
        self.maison = {
            cle: self._resoudre(styles_xml, (nom,), repli, 'style maison « %s »' % nom)
            for cle, (nom, repli) in _REPLI_STYLES_MAISON.items()
        }
        # Citation : le style « Quote » du gabarit (styleId Zitat dans les V4), que pandoc
        # relit en bloc de citation à l'import. Sans lui, repli sur le corps de texte.
        self.citation = self._resoudre(styles_xml, ('Quote',), self.corps, 'citation')

    def _resoudre(self, styles_xml, noms, repli, motif):
        style_id = _styleid_par_nom(styles_xml, noms)
        if style_id is not None:
            return style_id
        self.trace.append({
            'portee': 'document', 'source': None, 'decision': 'style_introuvable',
            'motif': "style « %s » introuvable dans word/styles.xml du gabarit (w:name "
                     "cherché : %s) : repli sur l'identifiant « %s »"
                     % (motif, ' / '.join(noms), repli)})
        return repli


# docx-titres.py, RE_LEGENDE : reconnaît une légende déjà écrite dans le manuscrit (« Figure
# 1 », « Abbildung 2 », « Tableau 3 »…) — copié tel quel, voir l'en-tête pour la raison (nom
# de fichier avec un tiret, non importable).
RE_LEGENDE = re.compile(
    r'^(?:figure|fig\.?|abbildung|abb\.?|illustration|grafik|tableau|tabelle|table)\s+\d+',
    re.I)

# Étiquettes des blocs figure/tableau, PAR LANGUE — mêmes libellés que chaque gabarit lui-même
# (FR « Légende / Texte alternatif / Copyright / Source / Note », DE « Beschriftung /
# Alternativtext / Copyright / Quelle / Notiz » ; le FR écrivait « Crédit » avant le
# 30.09.2026, forme qui reste reconnue à la lecture), dans l'ORDRE où le gabarit les pose
# — CANON_FIGURE de pronto_modele.py n'impose aucun ordre à la LECTURE (identifier_cle()
# compare chaque étiquette indépendamment), mais reproduire l'ordre du gabarit rend une sortie
# que Robin reconnaît à l'œil. `ecrire(..., langue=...)` choisit le jeu à écrire ; la
# RECONNAISSANCE d'une clé déjà tapée par l'autrice ou l'auteur (_lire_cle plus bas), elle,
# reste indépendante de la langue : identifier_cle() contre CANON_FIGURE reconnaît déjà les
# deux jeux d'étiquettes à la fois.
_ORDRE_CHAMPS_BLOC = ('legende', 'alt', 'credit', 'source', 'note')
CHAMPS_BLOC = {
    'fr': tuple(zip(_ORDRE_CHAMPS_BLOC,
                    ('Légende', 'Texte alternatif', 'Copyright', 'Source', 'Note'))),
    'de': tuple(zip(_ORDRE_CHAMPS_BLOC,
                    ('Beschriftung', 'Alternativtext', 'Copyright', 'Quelle', 'Notiz'))),
}

# Séparateur entre l'étiquette et sa valeur, PAR LANGUE — celui que chaque gabarit écrit
# lui-même dans ses paragraphes SZH Cle Abb/Tab (mesuré dans document.xml le 30.09.2026) : le
# FR met l'insécable U+00A0 devant le deux-points (« Légende : », E2), le DE le colle à
# l'étiquette (« Beschriftung: »). La lecture reconnaît les deux formes et l'espace ordinaire.
_SEPARATEUR_CLE = {'fr': '\u00a0: ', 'de': ': '}

# Position de la clé « Texte alternatif : » parmi les paragraphes de clé d'un bloc
# (ajout du 22.09.2026, ancrage de A11y.TexteAlternatif.* dans `correspondance`, voir
# _convertir_niveau_racine) — calculée depuis _ORDRE_CHAMPS_BLOC (le même pour les deux
# langues, seuls les LIBELLÉS changent), jamais un « 1 » écrit en dur : un futur
# réordonnancement ne peut alors pas désaccorder les deux silencieusement.
_INDICE_CLE_ALT = _ORDRE_CHAMPS_BLOC.index('alt')

# Largeur par défaut d'un tableau de contenu d'un bloc tableau (le tableau du manuscrit
# lui-même — depuis le 21.09.2026, posé directement au premier niveau, plus jamais imbriqué
# dans une cellule d'enveloppe) ou d'un tableau imbriqué ailleurs (note, cellule) — mesurée sur
# le bloc figure d'exemple du gabarit livré (l'ancienne largeur de l'enveloppe, w:tblW
# w:w="8220", moins une marge raisonnable).
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


def _resoudre_styles_note(styles_xml, style_corps_resolu):
    """(style_car, style_para) : styleId de caractère pour l'appel de note (None si le
    gabarit n'en définit aucun — repli : vertAlign exposant posé directement sur le run) et
    styleId de paragraphe pour le corps de la note (`style_corps_resolu` — le corps DÉJÀ
    résolu par _StylesResolus pour CE gabarit, jamais le repli FR en dur : sur le gabarit DE,
    le style de corps s'appelle Textkrper, pas Corpsdetexte, et écrire ce dernier produirait
    une référence à un styleId qui n'existe pas dans le gabarit DE)."""
    style_car = _styleid_par_nom(styles_xml, _NOMS_STYLE_APPEL_NOTE)
    style_para = _styleid_par_nom(styles_xml, _NOMS_STYLE_TEXTE_NOTE) or style_corps_resolu
    return style_car, style_para


class _RegistreNotes:
    """Résout le numéro de SORTIE de chaque note appelée, construit le XML de son contenu
    (réutilisant `_runs_xml`/`_tableau_xml` du corps — italique, liens, exposants conservés,
    §11) au moment de sa PREMIÈRE résolution, et rend le word/footnotes.xml final. Une note
    listée dans `document.notes` mais jamais appelée par aucun fragment n'est PAS écrite
    (elle serait sans ancre dans le corps) ; un appel dont l'id ne correspond à aucun contenu
    connu reçoit un contenu vide — les deux cas sont tracés, jamais en silence (§5 : « aucune
    décision silencieuse, jamais »)."""

    def __init__(self, document_notes, styles_xml_gabarit, footnotes_xml_gabarit,
                 style_corps_resolu):
        # Contrat partagé pas encore livré (Document.notes toujours une liste, ou absent) :
        # ce registre se comporte alors comme s'il n'y avait aucune note connue — jamais une
        # exception, voir l'en-tête du module.
        self._contenus = document_notes if isinstance(document_notes, dict) else {}
        self._style_car, self._style_para = _resoudre_styles_note(styles_xml_gabarit,
                                                                    style_corps_resolu)
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
    à préserver (voir _meta_paragraphes_xml pour la Légende, seul champ qui peut en avoir)."""
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


def _style_pour_paragraphe(paragraphe, registre):
    styles = registre.styles
    if paragraphe.niveau_retenu in styles.titre:
        return styles.titre[paragraphe.niveau_retenu]
    # Une citation du manuscrit (« Quote », « Citation », « Zitat », « Intense Quote »…) garde
    # sa nature : réécrite en corps de texte, elle perdait son retrait et son bloc à l'import.
    if mm._est_style_citation(paragraphe.style):
        return styles.citation
    return styles.maison.get(pronto_modele.normaliser_nom_style(paragraphe.style), styles.corps)


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
            # — jamais extraite dans un bloc figure imbriqué. Pas de restyle : le contenu d'un
            # tableau du manuscrit n'est pas retouché par §5.1/§5.2, qui ne portent que sur les
            # paragraphes de PREMIER NIVEAU (voir manuscrit_modele.py,
            # _paragraphes_premier_niveau) — SAUF un style maison déjà posé (SZH Cle, SZH
            # Aide…), gardé tel quel : c'est lui que le lecteur du gabarit reconnaît, et un
            # tableau fixe recopié sans lui ne se relirait plus (voir _tableaux_fixes_du_
            # document).
            style_id = registre.styles.maison.get(
                pronto_modele.normaliser_nom_style(bloc.style), '')
            morceaux.append(_paragraphe_xml(bloc, style_id, registre, espace))
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
# Blocs figure/tableau — révision du 21.09.2026 (décision de Robin) : cinq paragraphes de
# métadonnées (Légende/Texte alternatif/Copyright/Source/Note, style SZH Cle Abb/Tab) puis le contenu
# — une image en ligne, ou le tableau du manuscrit directement. Plus de tableau enveloppe :
# c'est la bordure ouverte du style (haut/gauche/droite, pas en bas — voir word/styles.xml du
# gabarit) qui dessine seule le cadre, les paragraphes consécutifs de même bordure se
# fusionnant visuellement dans Word. Le risque mesuré au §10 du contrat (LibreOffice qui fond
# deux `w:tbl`/`table:table` adjacents) ne peut plus se produire pour un bloc FIGURE, qui n'a
# plus de tableau du tout ; pour un bloc TABLEAU, il ne peut plus se produire non plus, puisque
# son contenu est désormais TOUJOURS précédé d'au moins un paragraphe de clé — deux tableaux ne
# peuvent donc plus jamais se toucher directement à cause d'un bloc.

def _meta_paragraphes_xml(champs, registre):
    """Les paragraphes de métadonnées d'un bloc (cinq), en style SZH Cle Abb/Tab — remplace
    l'ancienne rangée de tableau (_rangee_meta_xml). `champs['legende']` peut être soit une
    chaîne (Copyright/Source/Note/Texte alternatif, ou Légende sans contenu retrouvé dans le manuscrit
    — jamais inventée), soit une LISTE DE FRAGMENTS (la légende déjà écrite dans le manuscrit,
    préservée avec sa mise en forme — voir _cherche_legende) : une légende aplatie en texte
    plat perdrait ses exposants, d'où la distinction. `registre.champs_bloc`/`registre.
    separateur_cle` : le jeu d'étiquettes et le séparateur de LA LANGUE demandée à ecrire()
    (voir CHAMPS_BLOC/_SEPARATEUR_CLE) — jamais le module-level CHAMPS_BLOC directement, qui
    est maintenant un dict PAR langue, pas une liste."""
    paras = []
    for cle, label in registre.champs_bloc:
        valeur = champs.get(cle)
        if isinstance(valeur, list) and valeur:
            runs = _runs_xml(valeur, registre)
            paras.append('<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr>'
                         '<w:r><w:t xml:space="preserve">%s%s</w:t></w:r>%s</w:p>'
                          % (registre.styles.cle_abb_tab, _echapper(label),
                             registre.separateur_cle, runs))
        else:
            texte_plat = valeur.strip() if isinstance(valeur, str) else ''
            texte = ('%s%s%s' % (label, registre.separateur_cle, texte_plat)) if texte_plat \
                else '%s%s' % (label, registre.separateur_cle)
            paras.append(_paragraphe_simple_xml(texte, registre.styles.cle_abb_tab))
    return ''.join(paras)


def _image_paragraphe_xml(image, registre):
    """Le contenu d'un bloc figure : un paragraphe ordinaire portant l'image, en ligne — plus
    de rangée de tableau autour (remplace _rangee_image_xml)."""
    rid = registre.enregistrer_image(image)
    docpr_id = registre.nouveau_docpr_id()
    return '<w:p><w:r>%s</w:r></w:p>' % _drawing_xml(rid, image, docpr_id,
                                                       registre.largeur_max_dxa)


def _meta_et_contenu_xml(champs, contenu_xml, registre):
    """Un bloc figure ou tableau complet : les paragraphes de clé suivis directement du
    contenu — remplace l'ancien _bloc_xml (qui enveloppait tout dans un <w:tbl>). `contenu_xml`
    est soit _image_paragraphe_xml(...), soit _tableau_xml(...) directement (le tableau du
    manuscrit n'est plus jamais imbriqué dans une cellule d'enveloppe, voir plus bas)."""
    return _meta_paragraphes_xml(champs, registre) + contenu_xml


# ---------------------------------------------------------------------------------
# Traversée du corps — extraction des images en blocs figure, des tableaux en blocs tableau,
# association d'une légende déjà écrite dans le manuscrit (§5.3), et le paragraphe vide
# obligatoire autour de chaque bloc (§10, décision n°2 de l'en-tête).

def _texte_paragraphe(paragraphe):
    return paragraphe.texte().strip()


def _cherche_legende(blocs, idx, consommes):
    """([indices consommés], fragments) d'une légende déjà écrite dans le manuscrit pour le
    bloc figure/tableau à `idx` — ([], None) si rien ne convient. Rend la liste de FRAGMENT
    (mise en forme comprise, jamais un texte déjà aplati — voir _meta_paragraphes_xml).

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
    sans_legende = []
    for idx, bloc in enumerate(blocs):
        est_image = isinstance(bloc, mm.Paragraphe) and any(f.image is not None
                                                             for f in bloc.fragments)
        est_tableau = isinstance(bloc, mm.Tableau)
        # Un bloc reconnu (voir _regrouper_blocs) cherche sa légende comme les autres — sauf
        # si l'autrice ou l'auteur en a TAPÉ une sous « Légende : » : on n'en prend alors
        # aucune autre, et un paragraphe « Figure 1 : … » voisin reste dans le texte, visible.
        est_bloc = isinstance(bloc, _Bloc) and not bloc.legende_saisie()
        if not (est_image or est_tableau or est_bloc):
            continue
        indices, fragments = _cherche_legende(blocs, idx, consommes)
        if fragments is not None:
            consommes.update(indices)
            legendes[idx] = fragments
        else:
            sans_legende.append(idx)

    # Second passage (29.09.2026) : une légende séparée de son bloc par un paragraphe VIDE
    # (« Abbildung 1: Schatzkarte… », ¶ vide, puis l'image) n'était jamais voisine, donc
    # jamais trouvée. On saute alors jusqu'à MAX_VIDES_LEGENDE vides — mais dans quel sens
    # d'abord ? Sauter les vides rend une légende atteignable depuis DEUX blocs (celui qu'elle
    # suit, celui qu'elle précède) : c'est la convention du document (légendes au-dessus ou
    # au-dessous, à la majorité ; à égalité, au-dessous comme le premier passage) qui tranche.
    if sans_legende:
        dessus = dessous = 0
        for idx in legendes:
            dessus += (idx - 1) in consommes
            dessous += (idx + 1) in consommes
        for idx in sans_legende:
            dessus += _legende_apres_vides(blocs, idx, -1, consommes) is not None
            dessous += _legende_apres_vides(blocs, idx, +1, consommes) is not None
        sens = (-1, +1) if dessus > dessous else (+1, -1)
        for idx in sans_legende:
            for pas in sens:
                trouve = _legende_apres_vides(blocs, idx, pas, consommes)
                if trouve is not None:
                    indices, fragments = trouve
                    consommes.update(indices)
                    legendes[idx] = fragments
                    break
    return legendes, consommes


MAX_VIDES_LEGENDE = 2


def _est_paragraphe_texte(bloc):
    return isinstance(bloc, mm.Paragraphe) and not any(f.image is not None
                                                        for f in bloc.fragments)


def _legende_apres_vides(blocs, idx, pas, consommes):
    """([indices], fragments) de la légende du bloc `idx` dans le sens `pas` (-1 au-dessus,
    +1 au-dessous), en sautant 1 à MAX_VIDES_LEGENDE paragraphes vides — None sinon. Mêmes
    deux formes que _cherche_legende() : un paragraphe qui matche RE_LEGENDE, ou le titre bref
    (« Abbildung 1 ») suivi de son texte sur le paragraphe d'après."""
    j, vides = idx + pas, 0
    while (0 <= j < len(blocs) and vides < MAX_VIDES_LEGENDE and _est_paragraphe_texte(blocs[j])
           and not _texte_paragraphe(blocs[j])):
        j += pas
        vides += 1
    if vides == 0 or not (0 <= j < len(blocs)) or j in consommes:
        return None
    if not _est_paragraphe_texte(blocs[j]):
        return None
    texte = _texte_paragraphe(blocs[j])

    def _titre_bref(t):
        return (RE_LEGENDE.match(t) and len(t) <= 20
                and not t.rstrip().endswith((':', '.', '!', '?')))

    # Forme à deux paragraphes : titre bref PUIS texte, dans l'ordre du document.
    i_titre, i_texte = (j - 1, j) if pas < 0 else (j, j + 1)
    if (0 <= i_titre and i_texte < len(blocs) and i_titre not in consommes
            and i_texte not in consommes
            and _est_paragraphe_texte(blocs[i_titre]) and _est_paragraphe_texte(blocs[i_texte])):
        t_titre, t_texte = _texte_paragraphe(blocs[i_titre]), _texte_paragraphe(blocs[i_texte])
        if t_titre and _titre_bref(t_titre) and t_texte and not RE_LEGENDE.match(t_texte):
            fragments = (list(blocs[i_titre].fragments)
                         + [mm.Fragment(texte=' ', image=None, forme={}, lien=None, source=None)]
                         + list(blocs[i_texte].fragments))
            return [i_titre, i_texte], fragments
    if texte and RE_LEGENDE.match(texte):
        return [j], list(blocs[j].fragments)
    return None


def _texte_legende_trace(fragments):
    return ''.join(f.texte for f in fragments) if fragments else ''


# ---------------------------------------------------------------------------------
# Figures et tableaux reconnus AVANT l'écriture (décision de Robin, 29.09.2026).
#
# Trois défauts mesurés sur le nettoyeur, que ce passage corrige ensemble :
#   1. les clés TAPÉES à la main juste avant une image (« Légende : … », « Crédit : … » en
#      style Normal, sans le style du gabarit) n'étaient pas reconnues : elles restaient en
#      corps de texte, et l'image recevait un second jeu de clés, vides ;
#   2. deux images dans un même paragraphe, ou plusieurs paragraphes d'images à la suite, ou
#      un tableau de mise en page qui ne porte que des images, donnaient DEUX blocs figure
#      vides (ou un bloc tableau vide) — là où l'autrice ou l'auteur montrait UNE figure ;
#   3. un document déjà au gabarit voyait ses clés « SZH Cle Abb/Tab » réécrites en corps de
#      texte, suivies d'un nouveau jeu de clés vides.
# Chaque contenu de figure (images) ou de tableau devient donc UN `_Bloc`, qui emporte les
# clés qui le précèdent. L'import (pronto_modele.py) relit ensuite un bloc à plusieurs images
# comme un groupe d'images (`::: {.szh-grille}`), un numéro, une légende.
#
# ⚠ Rien n'est jamais jeté ici : une clé reconnue part DANS le bloc (sa valeur y est écrite),
#   une clé dont l'étiquette n'est reconnue par rien reste un paragraphe du texte (cas B), ou
#   garde tel quel le jeu de clés du document (cas A, `cles_brutes`), que l'import dira.

class _Bloc:
    """Un bloc figure ou tableau à écrire d'un seul tenant. `rangees` : liste de listes
    d'Image (figure) — une rangée par paragraphe ou par rangée de tableau du manuscrit ;
    `tableau` : le Tableau du manuscrit (bloc tableau). `champs` : ce que les clés saisies
    disaient ('legende' en fragments, les autres en texte), '' pour une clé absente ou vide.
    `cles` : les paragraphes de clé consommés. `cles_brutes` : vrai quand une clé stylée du
    gabarit porte une étiquette que personne ne connaît — le jeu de clés est alors recopié tel
    quel, jamais « normalisé » en perdant cette ligne. `source` : celle du premier contenu."""

    __slots__ = ('nature', 'rangees', 'tableau', 'champs', 'cles', 'cles_brutes', 'source',
                 'note_reprise')

    def __init__(self, nature, rangees=None, tableau=None, champs=None, cles=None,
                 cles_brutes=False, source=None, note_reprise=None):
        self.nature = nature
        self.rangees = rangees or []
        self.tableau = tableau
        self.champs = champs or {}
        self.cles = cles or []
        self.cles_brutes = cles_brutes
        self.source = source
        # Le paragraphe « Note : … » qui suivait le contenu dans le manuscrit et que le bloc a
        # repris dans sa clé Note (le Paragraphe lui-même), ou None.
        self.note_reprise = note_reprise

    def images(self):
        return [img for rangee in self.rangees for img in rangee]

    def legende_saisie(self):
        return bool(self.champs.get('legende'))


MAX_VIDES_ENTRE_IMAGES = pronto_modele.MAX_VIDES_ENTRE_IMAGES


def _images_du_paragraphe(paragraphe):
    return [f.image for f in paragraphe.fragments if f.image is not None]


def _images_seules(bloc):
    """Un paragraphe qui ne porte que des images (ni texte, ni note, ni puce)."""
    return (isinstance(bloc, mm.Paragraphe) and bloc.liste is None
            and any(f.image is not None for f in bloc.fragments)
            and not any(f.texte.strip() or getattr(f, 'note', None) is not None
                        for f in bloc.fragments if f.image is None))


def _est_vide(bloc):
    return (isinstance(bloc, mm.Paragraphe) and bloc.liste is None
            and not any(f.image is not None or f.texte.strip()
                        or getattr(f, 'note', None) is not None for f in bloc.fragments))


def _rangees_tableau_images(tableau):
    """Les rangées d'images d'un tableau de MISE EN PAGE — chaque cellule ne porte que des
    images ou rien, au moins une image en tout — ou None pour tout autre tableau. Même
    décision que pronto_modele.est_tableau_images() : une cellule qui porte AUSSI un texte
    (« a) avant ») fait un vrai tableau, parce qu'un groupe d'images n'a nulle part où poser
    une sous-légende par image — voir sa docstring."""
    rangees = []
    for rangee in tableau.rangees:
        images = []
        for cellule in rangee:
            for b in cellule.blocs:
                if not isinstance(b, mm.Paragraphe):
                    return None
                if not (_images_seules(b) or _est_vide(b)):
                    return None
                images.extend(_images_du_paragraphe(b))
        if images:
            rangees.append(images)
    return rangees or None


def _fragments_apres_deux_points(paragraphe):
    """Les fragments de la VALEUR d'une clé « Étiquette : valeur », mise en forme comprise
    (une légende garde ses italiques), sans l'étiquette ni les blancs qui la suivent."""
    res, vu = [], False
    for f in paragraphe.fragments:
        if f.image is not None:
            continue
        texte = f.texte
        if not vu:
            k = texte.find(':')
            if k == -1:
                continue
            vu = True
            texte = texte[k + 1:]
        if not res:
            texte = texte.lstrip()
            if not texte:
                continue
        res.append(mm.Fragment(texte=texte, image=None, forme=f.forme, lien=f.lien,
                               source=f.source, note=getattr(f, 'note', None),
                               effectif=getattr(f, 'effectif', None)))
    return res


def _lire_cle(paragraphe):
    """(champ, paragraphe) pour un paragraphe de clé de figure/tableau : « Étiquette :
    valeur », l'étiquette reconnue par pronto_modele.identifier_cle() contre CANON_FIGURE —
    la MÊME reconnaissance que l'import, tolérance aux fautes comprise. Un paragraphe au style
    « SZH Cle Abb/Tab » dont l'étiquette n'est reconnue par rien rend ('?', paragraphe) : c'est
    une clé du gabarit, que le document porte telle quelle. None pour tout le reste."""
    if not isinstance(paragraphe, mm.Paragraphe) or paragraphe.liste is not None:
        return None
    if any(f.image is not None for f in paragraphe.fragments):
        return None
    texte = paragraphe.texte().strip()
    stylee = (pronto_modele.normaliser_nom_style(paragraphe.style)
              == pronto_modele.NOM_STYLE_CLE_BLOC)
    # « Abbildung 1: Schatzkarte » est une LÉGENDE déjà écrite, pas une clé : « abbildung »
    # est un alias de Légende dans CANON_FIGURE, et « Abbildung 1 » s'en approche assez pour
    # passer — la légende perdait alors son « Abbildung 1 » (mesuré sur tmp/docx-dev : un mot
    # de moins par figure). Elle suit la voie des légendes (_associer_legendes), entière.
    if not stylee and RE_LEGENDE.match(texte):
        return None
    if ':' in texte:
        etiquette = texte.partition(':')[0].strip()
        resultat = pronto_modele.identifier_cle(etiquette, pronto_modele.CANON_FIGURE)
        if resultat is not None and resultat[0] != '__ambigu__':
            return resultat[0], paragraphe
    if stylee and texte:
        return '?', paragraphe
    return None


def _cles_avant(blocs, idx, pris):
    """Les indices (ordre du document) des paragraphes de clé qui précèdent directement le
    contenu à `idx` : un paragraphe vide toléré juste avant le contenu (même fausse
    manipulation que l'import tolère), puis une suite de clés, chaque champ une seule fois,
    jamais un paragraphe déjà pris par un autre bloc."""
    j = idx - 1
    if j >= 0 and j not in pris and _est_vide(blocs[j]):
        j -= 1
    indices, vus = [], set()
    while j >= 0 and j not in pris and len(indices) < 6:
        lu = _lire_cle(blocs[j])
        if lu is None:
            break
        champ = lu[0]
        if champ != '?' and champ in vus:
            break
        vus.add(champ)
        indices.append(j)
        j -= 1
    return sorted(indices)


def _champs_des_cles(paragraphes):
    """({'legende': fragments, 'alt', 'credit', 'source', 'note': texte}, brutes)."""
    champs = {'legende': [], 'alt': '', 'credit': '', 'source': '', 'note': ''}
    brutes = False
    for p in paragraphes:
        champ, _ = _lire_cle(p)
        if champ == '?':
            brutes = True
            continue
        fragments = _fragments_apres_deux_points(p)
        if champ == 'legende':
            champs['legende'] = fragments
        else:
            champs[champ] = ''.join(f.texte for f in fragments).strip()
    return champs, brutes


# Étiquettes d'une note de figure ou de tableau TAPÉE sous le contenu, en clair : la note d'un
# tableau APA, « Note : … ». Reconnaissance STRICTE (pas de score de proximité) et réservée au
# paragraphe qui suit immédiatement le contenu — un « Note : » ailleurs dans le corps n'est
# jamais une note de bloc. La forme APA 7, « Note. » suivi du texte (et « Notiz. »,
# « Anmerkung. » en allemand), est reconnue aussi, au singulier seulement : c'est ainsi
# qu'APA l'écrit sous un tableau (demande du lot A, mesurée sur RV02_Redaction le 30.09.2026).
_RE_NOTE_ADJACENTE = re.compile(
    r'^\s*(?:(?:notes?|remarques?|notizen?|anmerkung(?:en)?|hinweis(?:e)?|nota)\s*:'
    r'|(?:note|notiz|anmerkung)\.)\s*(?=\S)', re.I)


def _note_adjacente(bloc):
    """(texte de la note sans l'étiquette) si `bloc` est un paragraphe de texte « Note : … »
    — ni image, ni liste, ni appel de note de bas de page (une note reprise dans une clé
    perdrait l'appel) —, sinon None."""
    if not isinstance(bloc, mm.Paragraphe) or bloc.liste is not None:
        return None
    if any(f.image is not None or getattr(f, 'note', None) is not None
           for f in bloc.fragments):
        return None
    texte = bloc.texte().strip()
    m = _RE_NOTE_ADJACENTE.match(texte)
    if not m:
        return None
    return re.sub(r'[ \t\r\n]+', ' ', texte[m.end():]).strip()


def _regrouper_blocs(blocs):
    """La liste « virtuelle » que _convertir_niveau_racine() écrit : chaque contenu de figure
    (images seules, groupe, tableau de mise en page) ou de tableau PRÉCÉDÉ DE CLÉS devient un
    `_Bloc` à la place de son premier contenu, ses clés et ses autres contenus en sont
    retirés. Une image seule sans clé, un tableau sans clé restent tels quels (voie de
    toujours) ; un paragraphe mêlant texte et images aussi, sauf qu'il n'y porte qu'UN bloc
    pour toutes ses images (voir _convertir_niveau_racine)."""
    n = len(blocs)
    pris = set()
    blocs_par_debut = {}
    i = 0
    while i < n:
        bloc = blocs[i]
        rangees, tableau, fin = None, None, i
        if isinstance(bloc, mm.Tableau):
            rangees = _rangees_tableau_images(bloc)
            if rangees is None:
                tableau = bloc
        elif _images_seules(bloc):
            # Décision de Robin (29.09.2026), la même qu'à l'import (pronto_modele.
            # MAX_VIDES_ENTRE_IMAGES) : les images qui se suivent, séparées de 0, 1 ou 2
            # paragraphes VIDES au plus, sont UNE figure ; un texte, une nouvelle série de
            # clés (un texte aussi) ou un troisième vide l'arrêtent. Les vides sautés sont
            # consommés avec le groupe — ils ne portent rien, rien ne se perd.
            rangees = [_images_du_paragraphe(bloc)]
            j = i + 1
            while j < n:
                k = j
                while k < n and k - j < MAX_VIDES_ENTRE_IMAGES and _est_vide(blocs[k]):
                    k += 1
                if k < n and _images_seules(blocs[k]):
                    rangees.append(_images_du_paragraphe(blocs[k]))
                    fin = k
                    j = k + 1
                else:
                    break
        if rangees is None and tableau is None:
            i += 1
            continue
        cles = _cles_avant(blocs, i, pris)
        groupe = rangees is not None and (len(rangees) > 1 or len(rangees[0]) > 1
                                           or isinstance(bloc, mm.Tableau))
        champs, brutes = _champs_des_cles([blocs[k] for k in cles])
        # Le paragraphe qui suit IMMÉDIATEMENT le contenu, s'il commence par « Note : » : c'est
        # la note du bloc. Il reste dans le texte quand une clé Note saisie la dit déjà, ou
        # quand le jeu de clés est recopié tel quel (aucune place où l'écrire).
        note_para = None
        if fin + 1 < n and (fin + 1) not in pris and not champs.get('note') and not brutes:
            note_texte = _note_adjacente(blocs[fin + 1])
            if note_texte is not None:
                note_para = blocs[fin + 1]
                champs['note'] = note_texte
                pris.add(fin + 1)
        if not cles and not groupe and note_para is None:
            i = fin + 1                   # image seule ou tableau sans clé : voie de toujours
            continue
        blocs_par_debut[i] = _Bloc('figure' if rangees is not None else 'tableau',
                                   rangees=rangees, tableau=tableau, champs=champs,
                                   cles=[blocs[k] for k in cles], cles_brutes=brutes,
                                   source=bloc.source, note_reprise=note_para)
        pris.update(cles)
        pris.update(range(i + 1, fin + 1))
        i = fin + 1
    virtuels = []
    for k, bloc in enumerate(blocs):
        if k in blocs_par_debut:
            virtuels.append(blocs_par_debut[k])
        elif k not in pris:
            virtuels.append(bloc)
    return virtuels


def blocs_figure(document):
    """Les `_Bloc` que l'écriture posera, vus AVANT elle — pour que le nettoyeur juge les
    images comme elles sortiront (texte alternatif saisi sous « Texte alternatif : » compris),
    sans refaire la reconnaissance ailleurs."""
    return [b for b in _regrouper_blocs(document.blocs) if isinstance(b, _Bloc)]


def _rangee_images_xml(images, registre):
    """Un paragraphe portant les images d'une rangée, en ligne, séparées d'une espace : c'est
    ce que l'import relit comme une rangée de groupe (deux images côte à côte = « 2 »)."""
    runs = []
    for k, image in enumerate(images):
        if k:
            runs.append('<w:r><w:t xml:space="preserve"> </w:t></w:r>')
        rid = registre.enregistrer_image(image)
        docpr_id = registre.nouveau_docpr_id()
        runs.append('<w:r>%s</w:r>' % _drawing_xml(rid, image, docpr_id,
                                                   registre.largeur_max_dxa))
    return '<w:p>%s</w:p>' % ''.join(runs)


def _bloc_xml(bloc, fragments_legende, registre):
    """(xml, n_wp, indice de la clé « Texte alternatif : » parmi les <w:p> du bloc)."""
    champs = dict(bloc.champs)
    if not champs.get('legende'):
        champs['legende'] = fragments_legende or ''
    if bloc.nature == 'figure' and not champs.get('alt'):
        # Rien de tapé : le texte alternatif de la première image, comme un bloc ordinaire.
        champs['alt'] = bloc.rangees[0][0].alt
    if bloc.cles_brutes:
        meta = ''.join(_paragraphe_xml(p, registre.styles.cle_abb_tab, registre)
                        for p in bloc.cles)
        n_cles = len(bloc.cles)
        indice_alt = next((k for k, p in enumerate(bloc.cles) if _lire_cle(p)[0] == 'alt'), 0)
    else:
        meta = _meta_paragraphes_xml(champs, registre)
        n_cles = len(registre.champs_bloc)
        indice_alt = _INDICE_CLE_ALT
    if bloc.nature == 'figure':
        contenu = ''.join(_rangee_images_xml(r, registre) for r in bloc.rangees)
        return meta + contenu, n_cles + len(bloc.rangees), indice_alt
    return meta + _tableau_xml(bloc.tableau, registre), n_cles, indice_alt


def _convertir_niveau_racine(blocs, registre, trace):
    """Rend (xml_du_corps, correspondance) — xml_du_corps hors les deux tableaux fixes.

    `correspondance` (ajout du 19.09.2026, pour un module d'annotation) : une liste de
    {'source': Paragraphe.source du bloc d'ORIGINE, 'sortie': indice RELATIF, parmi les <w:p>
    écrits ICI, du <w:p> qui le porte} — un couple par paragraphe de CORPS effectivement écrit
    comme <w:p> de premier niveau ; jamais pour un paragraphe consommé comme légende ou fondu
    comme vide surnuméraire, qui ne produit rien. `source` est le vrai `Paragraphe.source` du
    bloc, pas sa position dans `blocs` : les deux ne coïncident plus dès que l'appelant a retiré
    des blocs de la liste avant d'appeler cette fonction (l'en-tête, §5.5) — un `para` d'alerte
    porte toujours `Paragraphe.source`, jamais une position de liste. L'indice `sortie` est
    RELATIF à ce que cette fonction écrit seule : ecrire() y ajoute le nombre de <w:p> qui la
    précèdent dans le document final pour obtenir l'indice ABSOLU demandé.

    Entrée `'bloc'` (ajout du 22.09.2026, demande du coordinateur — ancrage de
    A11y.TexteAlternatif.*) : EN PLUS des entrées ci-dessus, une entrée par bloc figure/tableau,
    {'source': Paragraphe.source du paragraphe PORTEUR de l'image (bloc figure) ou
    Tableau.source (bloc tableau), 'sortie': indice du <w:p> de la clé « Texte alternatif : »,
    'bloc': 'figure'|'tableau'} — CE paragraphe-clé, lui, N'A PAS le texte de `source` (c'est le
    seul point d'ancrage réel qu'un bloc puisse offrir : ni l'image ni le tableau qu'il
    enveloppe ne sont eux-mêmes un texte). `manuscrit_annoter.py` reconnaît cette entrée à la
    présence de la clé `'bloc'` et ancre alors sur CE paragraphe entier (c'est l'endroit où la
    relectrice écrira l'alt), sans jamais y chercher un `found` littéral. Une entrée normale et
    une entrée `bloc` peuvent partager le même `source` (un paragraphe qui porte À LA FOIS du
    texte et une image) : la RÉSOLUTION entre les deux revient à l'appelant (manuscrit_annoter.
    py), pas à cette fonction, qui se contente de rendre les deux, honnêtement.
    """
    blocs = _regrouper_blocs(blocs)
    n = len(blocs)
    legendes, consommes = _associer_legendes(blocs)
    segments = []          # (est_bloc, xml, idx_source_ou_None, est_vide, n_wp, type_bloc)
    # `type_bloc` (ajout du 22.09.2026) : None pour un paragraphe de corps ordinaire,
    # 'figure'/'tableau' pour un bloc — c'est lui qui distingue, dans la boucle de
    # construction de `correspondance` plus bas, une entrée normale (`idx_source` = SA propre
    # source, `sortie` = SA position) d'une entrée `bloc` (`idx_source` = la source du
    # paragraphe/tableau qui porte le bloc, `sortie` = la position de sa clé « Texte
    # alternatif : », toujours DEUXIÈME des clés — voir CHAMPS_BLOC/_INDICE_CLE_ALT).
    # `n_wp` (ajouté le 21.09.2026, avec la nouvelle forme des blocs) : le nombre de <w:p>
    # RÉELLEMENT écrits par ce segment au premier niveau du corps — 1 pour un paragraphe de
    # corps ordinaire, comme avant ; pour un bloc, ce n'est PLUS zéro comme du temps de
    # l'enveloppe <w:tbl> unique : un bloc écrit désormais ses paragraphes de clé (SZH
    # Cle Abb/Tab) en <w:p> de plein droit, plus un cinquième pour l'image d'un bloc figure (le
    # contenu d'un bloc tableau, lui, est un <w:tbl>, qui n'en ajoute aucun). Sans ce compte
    # correct, `compteur_wp` déraille dès le premier bloc rencontré et toute la table de
    # correspondance qui le suit pointe le mauvais <w:p> — mesuré : le contrôle du corpus réel
    # (§11) rougissait entièrement après le premier bloc de chaque manuscrit illustré tant que
    # ce champ n'existait pas.

    idx = 0
    while idx < n:
        if idx in consommes:
            idx += 1
            continue
        bloc = blocs[idx]

        if isinstance(bloc, _Bloc):
            fragments_legende = legendes.get(idx)
            xml, n_wp, indice_alt = _bloc_xml(bloc, fragments_legende, registre)
            segments.append((True, xml, bloc.source, False, n_wp, bloc.nature, indice_alt))
            saisies = [label for cle, label in registre.champs_bloc
                       if bloc.champs.get(cle)] if not bloc.cles_brutes else ['recopiées telles quelles']
            if bloc.nature == 'figure':
                images = bloc.images()
                motif = ('%s posée(s) dans UN bloc figure (%s) ; clés saisies reprises : %s'
                         % (', '.join('« %s »' % im.nom for im in images),
                            'groupe de %d image(s) en %d rangée(s)' % (len(images),
                                                                        len(bloc.rangees))
                            if len(images) > 1 else 'image seule',
                            ', '.join(saisies) or 'aucune'))
                trace.append({'portee': 'bloc', 'source': bloc.source, 'decision': 'bloc_figure',
                              'images': len(images), 'motif': motif})
            else:
                trace.append({'portee': 'bloc', 'source': bloc.source,
                              'decision': 'bloc_tableau',
                              'motif': 'tableau posé dans un bloc tableau ; clés saisies '
                                       'reprises : %s' % (', '.join(saisies) or 'aucune')})
            if bloc.note_reprise is not None:
                trace.append({'portee': 'bloc', 'source': bloc.note_reprise.source,
                              'decision': 'note_reprise', 'nature': bloc.nature,
                              'motif': 'paragraphe « Note : » qui suivait le %s repris dans '
                                       'la clé Note du bloc : « %s »'
                                       % ('tableau' if bloc.nature == 'tableau' else 'figure',
                                          bloc.champs.get('note', ''))})

        elif isinstance(bloc, mm.Tableau):
            fragments_legende = legendes.get(idx)
            champs = {'legende': fragments_legende or '', 'alt': '', 'credit': '', 'source': '',
                      'note': ''}
            xml = _meta_et_contenu_xml(champs, _tableau_xml(bloc, registre), registre)
            segments.append((True, xml, bloc.source, False, len(registre.champs_bloc),
                             'tableau'))
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
                    style_id = _style_pour_paragraphe(p_texte, registre)
                    segments.append((False, _paragraphe_xml(p_texte, style_id, registre),
                                      bloc.source, False, 1, None))
                # Plusieurs images dans une phrase (29.09.2026) : UN bloc pour toutes, comme
                # pour un paragraphe d'images seules — deux blocs vides pour une figure qu'on
                # montrait d'un tenant, c'était le défaut mesuré. Le texte reste au-dessus.
                fragments_legende = legendes.get(idx)
                if len(images) > 1:
                    groupe = _Bloc('figure', rangees=[images], source=bloc.source)
                    xml, n_wp, indice_alt = _bloc_xml(groupe, fragments_legende, registre)
                    segments.append((True, xml, bloc.source, False, n_wp, 'figure', indice_alt))
                    trace.append({'portee': 'bloc', 'source': bloc.source,
                                  'decision': 'bloc_figure', 'images': len(images),
                                  'motif': '%s posée(s) dans UN bloc figure (groupe de %d '
                                           'image(s), tirées d\'un paragraphe de texte)'
                                           % (', '.join('« %s »' % im.nom for im in images),
                                              len(images))})
                    images = []
                for k, image in enumerate(images):
                    champs = {'legende': (fragments_legende if k == 0 else None) or '',
                              'alt': image.alt, 'credit': '', 'source': '', 'note': ''}
                    xml = _meta_et_contenu_xml(champs, _image_paragraphe_xml(image, registre),
                                                registre)
                    segments.append((True, xml, bloc.source, False,
                                     len(registre.champs_bloc) + 1, 'figure'))
                    champs_vides = [label for cle, label in registre.champs_bloc
                                     if not champs.get(cle)]
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
                style_id = _style_pour_paragraphe(bloc, registre)
                segments.append((False, _paragraphe_xml(bloc, style_id, registre),
                                  bloc.source, est_vide, 1, None))
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
    for i, seg in enumerate(segments_reduits):
        est_bloc, xml, idx_source, est_vide, n_wp, type_bloc = seg[:6]
        # Position de la clé « Texte alternatif : » dans le bloc : la deuxième des clés,
        # sauf pour un jeu de clés recopié tel quel (`_Bloc.cles_brutes`), qui la donne.
        indice_alt = seg[6] if len(seg) > 6 else _INDICE_CLE_ALT
        if (i > 0 and _separateur_requis(est_bloc, precedent_est_bloc)
                and not precedent_est_vide and not est_vide):
            morceaux.append(PARAGRAPHE_VIDE)
            compteur_wp += 1
        morceaux.append(xml)
        if not est_bloc and idx_source is not None:
            correspondance.append({'source': idx_source, 'sortie': compteur_wp})
        elif est_bloc and idx_source is not None:
            # La clé « Texte alternatif : » est la DEUXIÈME des paragraphes de clé
            # (CHAMPS_BLOC : légende, alt, crédit, source, note) — `compteur_wp` vise ici le premier
            # <w:p> du bloc (« Légende : »), +1 pour atteindre celui-ci. Vrai pour un bloc
            # figure ET un bloc tableau : les deux partagent _meta_paragraphes_xml().
            correspondance.append({'source': idx_source, 'sortie': compteur_wp + indice_alt,
                                    'bloc': type_bloc})
        compteur_wp += n_wp
        precedent_est_bloc = est_bloc
        precedent_est_vide = est_vide
    return ''.join(morceaux), correspondance


def alerte_notes_reprises(trace, langue):
    """L'avertissement du rapport quand des paragraphes « Note : » ont quitté le corps pour la
    clé Note d'un bloc (voir _note_adjacente) — None s'il n'y en a pas. `trace` : celle que
    ecrire() rend."""
    n = sum(1 for l in trace if l.get('decision') == 'note_reprise')
    if not n:
        return None
    if langue == 'de':
        message = ('%d Absatz/Absätze «Note:» unter einer Abbildung oder Tabelle wurde(n) in '
                   'das Feld «Notiz» des Blocks übernommen und aus dem Text entfernt. Prüfen '
                   'Sie, dass die Notiz zum richtigen Block gehört.' % n)
    else:
        message = ('%d paragraphe(s) «\u00a0Note\u00a0:\u00a0» placé(s) sous une figure ou un tableau '
                   'ont été repris dans la clé Note du bloc et retirés du corps du texte. '
                   'Vérifiez que chaque note est bien rattachée au bon bloc.' % n)
    return {'rule': 'Nettoyage.NoteReprise', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


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


# Seul retrait volontaire de ce module (voir ecrire()) : les parties du commentaire Word
# d'aide du gabarit (ancré sur son propre bloc figure d'exemple, jamais recopié — le corps
# écrit ici vient de `document.blocs`, pas du gabarit). Noms de fichier TELS QUE Word les
# écrit (mesurés sur les deux gabarits V4, 29.09.2026).
_NOMS_COMMENTAIRES_GABARIT = ('comments.xml', 'commentsExtended.xml', 'commentsIds.xml',
                               'commentsExtensible.xml', 'people.xml')
_PARTIES_COMMENTAIRES_GABARIT = tuple('word/' + n for n in _NOMS_COMMENTAIRES_GABARIT)


def _retirer_relations(rels_xml, noms_cibles):
    motif = re.compile(r'<Relationship\b[^>]*?\bTarget="(?:%s)"[^>]*/>'
                        % '|'.join(re.escape(n) for n in noms_cibles))
    return motif.sub('', rels_xml)


def _retirer_overrides(ct_xml, noms_parties):
    motif = re.compile(r'<Override\b[^>]*?PartName="/word/(?:%s)"[^>]*/>'
                        % '|'.join(re.escape(n) for n in noms_parties))
    return motif.sub('', ct_xml)


# ---------------------------------------------------------------------------------
# En-tête (§5.5 du contrat, ajouté le 19.09.2026) — remplissage des DEUX tableaux fixes
# (métadonnées, autrices et auteurs) depuis l'EnTete que manuscrit_entete.extraire_entete()
# a reconnue. Ce module reste un écrivain pur : `entete` arrive déjà TRANCHÉE, comme
# `decisions` — aucune reconnaissance ici, seulement la traduction en XML, exactement à
# l'endroit où pronto_docx.lire()/pronto_modele.extraire_table_metadonnees()/
# extraire_table_auteurs() vont la relire.
#
# Gabarits V4 (29.09.2026, deux fichiers FR/DE) : les étiquettes ne sont plus une seule forme
# figée (« Titre (FR) » quel que soit le produit) — le gabarit DE écrit « Titel (DE) »,
# « Vorname: », « E-Mail: »… La reconnaissance d'étiquette ne repose donc plus sur une poignée
# de regex françaises, mais sur `pronto_modele.identifier_cle()` contre CANON_METADONNEES /
# CANON_AUTEUR — LA MÊME table et LA MÊME tolérance (accent oublié, alias) que le LECTEUR
# (pronto_modele.extraire_table_metadonnees()/extraire_table_auteurs()) : un jeton reconnu à
# l'écriture est GARANTI reconnu à la relecture, par construction, sur les deux gabarits à la
# fois — jamais une deuxième table à tenir synchronisée avec la première.

_RE_TR_XML = re.compile(r'<w:tr\b.*?</w:tr>', re.S)
_RE_TC_XML = re.compile(r'<w:tc\b.*?</w:tc>', re.S)
_RE_P_XML = re.compile(r'<w:p\b.*?</w:p>', re.S)
_RE_T_XML = re.compile(r'<w:t\b[^>]*>(.*?)</w:t>', re.S)

# jeton CANON_METADONNEES -> attribut d'EnTete à écrire. « type » et « motscles » n'y figurent
# PAS : jamais déduits du texte du manuscrit (décision du brief de chantier — la relectrice les
# choisit dans le cockpit) ; reconnus quand même par identifier_cle() (ils sont dans la table),
# mais sans destination ici, comme avant ce chantier.
_JETON_VERS_CHAMP_METADONNEES = {'titre': 'titre', 'soustitre': 'sous_titre', 'resume': 'resume'}

# jeton CANON_AUTEUR -> champ du dict `auteur` (manuscrit_entete.CHAMPS_AUTEUR_ENTETE). Les
# clés CLES_AUTEUR_SANS_DESTINATION (adresse/biographie/telephone/photo) n'y figurent PAS :
# elles n'ont pas de champ dans EnTete.auteurs. `ror` n'est jamais lu dans le manuscrit, il
# vient de manuscrit_identifiants (et reste alors « à vérifier », voir ci-dessous).
# 'affiliation' est le seul jeton dont le NOM diffère du champ EnTete (`institution`).
_JETON_VERS_CHAMP_AUTEUR = {
    'prenom': 'prenom', 'nom': 'nom', 'fonction': 'fonction',
    'affiliation': 'institution', 'orcid': 'orcid', 'email': 'email', 'ror': 'ror',
}

# Auteur de révision des valeurs TROUVÉES par recherche (auteur['a_verifier']) : écrites en
# révision Word suivie, pour que la rédaction les voie et les accepte ou les rejette.
_AUTEUR_REVISION_IDENTIFIANTS = {'fr': 'Recherche ROR/ORCID — à vérifier',
                                 'de': 'ROR/ORCID-Suche — bitte prüfen'}
# `w:id` provisoire d'une de ces révisions : renuméroté dans ecrire() au-delà de tout `w:id`
# déjà présent dans le document, pour ne jamais coller avec ceux que pose manuscrit_annoter.
_ID_REVISION_PROVISOIRE = 'SZH-ID-A-RENUMEROTER'

LANGUE_PRODUIT_TEXTE = {'fr': 'français', 'de': 'deutsch'}

# Préfixe de la ligne « Mots-clés » écrite en tête du corps (voir ecrire()), PAR LANGUE — même
# convention de deux-points que _SEPARATEUR_CLE (FR : insécable avant, DE : collé).
_PREFIXE_MOTS_CLES = {'fr': 'Mots-clés\u00a0: ', 'de': 'Schlüsselwörter: '}


def _texte_xml_brut(fragment_xml):
    """Concatène tous les <w:t> d'un fragment XML brut (cellule ou paragraphe isolé),
    décodé au minimum — sert UNIQUEMENT à reconnaître une étiquette, jamais réinjecté."""
    texte = ''.join(_RE_T_XML.findall(fragment_xml))
    return (texte.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
            .replace('&apos;', "'").replace('&quot;', '"'))


def _etiquette_premiere_ligne(cellule_xml):
    """Le texte du PREMIER <w:p> d'une cellule — l'étiquette elle-même, jamais la ligne
    d'aide qui peut la suivre dans la même cellule (« facultatif », « 400 à 600 signes… ») :
    mesuré sur les deux gabarits, la cellule « Champ » du tableau de métadonnées porte deux
    paragraphes pour Sous-titre/Résumé/Type d'article. Passer les DEUX à identifier_cle()
    ferait exploser la longueur comparée (LONGUEUR_ETIQUETTE_SCORE) et effondrer le score."""
    p = _RE_P_XML.search(cellule_xml)
    return _texte_xml_brut(p.group(0)) if p else ''


def _inserer_dans_paragraphe(p_xml, valeur, revision=None):
    """Ajoute un <w:r> portant `valeur` juste avant le </w:p> qui referme `p_xml` — le
    paragraphe reste par ailleurs inchangé (style, langue). `p_xml` peut être un paragraphe
    isolé ou une cellule qui n'en contient qu'un seul (le tableau des métadonnées, mesuré :
    chaque cellule « valeur » est un unique paragraphe vide). `revision` : l'auteur de révision
    — le run est alors enveloppé dans un <w:ins> (révision suivie, id à renuméroter)."""
    if not valeur:
        return p_xml
    i = p_xml.rindex('</w:p>')
    run = '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % _echapper(valeur)
    if revision:
        run = '<w:ins w:id="%s" w:author="%s" w:date="%s">%s</w:ins>' % (
            _ID_REVISION_PROVISOIRE, _echapper_attribut(revision),
            datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'), run)
    return p_xml[:i] + run + p_xml[i:]


def _remplir_table_metadonnees(table_xml, entete):
    """Remplit les cellules « valeur » du tableau de métadonnées : Titre, Sous-titre, Résumé
    (dans la langue du PRODUIT — chaque gabarit ne porte qu'une ligne, « (FR) » ou « (DE) »
    selon le fichier) et Langue de l'article (français/deutsch). « Type d'article » reste
    toujours vide. L'étiquette est débarrassée d'un éventuel suffixe « (FR)/(DE)/(IT) »
    (RE_SUFFIXE_LANGUE) avant d'être reconnue — « Titel (DE) » vise le même jeton `titre` que
    « Titre (FR) ». Rend (xml, trace)."""
    trace = []
    lignes = _RE_TR_XML.findall(table_xml)
    if not lignes:
        return table_xml, trace
    nouveau_xml = table_xml
    for ligne in lignes[1:]:                 # [0] = rangée d'en-tête « Champ »/« Valeur »
        cellules = _RE_TC_XML.findall(ligne)
        if len(cellules) != 2:
            continue
        etiquette_brute = _etiquette_premiere_ligne(cellules[0])
        etiquette = pronto_modele.RE_SUFFIXE_LANGUE.sub('', etiquette_brute).strip()
        resultat = pronto_modele.identifier_cle(etiquette, pronto_modele.CANON_METADONNEES)
        if resultat is None or resultat[0] == '__ambigu__':
            continue
        champ = resultat[0]
        if champ == 'langue':
            valeur = LANGUE_PRODUIT_TEXTE.get(entete.langue_produit, '')
        elif champ in _JETON_VERS_CHAMP_METADONNEES:
            valeur = getattr(entete, _JETON_VERS_CHAMP_METADONNEES[champ])
        else:
            continue                          # 'type'/'motscles' : jamais remplis (brief)
        if not valeur:
            continue
        nouvelle_cellule = _inserer_dans_paragraphe(cellules[1], valeur)
        nouvelle_ligne = ligne.replace(cellules[1], nouvelle_cellule, 1)
        nouveau_xml = nouveau_xml.replace(ligne, nouvelle_ligne, 1)
        trace.append({'portee': 'document', 'source': None, 'decision': 'entete_meta',
                      'motif': "champ « %s » du tableau de métadonnées rempli depuis "
                               "l'en-tête reconnu" % champ})
    return nouveau_xml, trace


def _remplir_fiche_auteur(cellule_xml, auteur, langue='fr'):
    """(cellule remplie, nombre de champs remplis) — une ligne « Étiquette : » (FR) ou
    « Étiquette: » (DE, collée) par champ ; un champ de `auteur['a_verifier']` (trouvé par
    recherche, pas lu dans le manuscrit) est écrit en révision suivie. L'étiquette
    reconnue contre CANON_AUTEUR — même mécanisme que _remplir_table_metadonnees, jamais de
    suffixe de langue à retirer ici (« Vorname: », pas « Vorname (DE): »). Ne modifie QUE les
    paragraphes dont l'étiquette est reconnue ; toute ligne inconnue du gabarit reste telle
    quelle."""
    paragraphes = _RE_P_XML.findall(cellule_xml)
    nouvelle_cellule = cellule_xml
    rempli = 0
    for p_xml in paragraphes:
        texte = _texte_xml_brut(p_xml)
        etiquette = texte.partition(':')[0].strip()
        resultat = pronto_modele.identifier_cle(etiquette, pronto_modele.CANON_AUTEUR)
        if resultat is None or resultat[0] == '__ambigu__':
            continue
        champ = _JETON_VERS_CHAMP_AUTEUR.get(resultat[0])
        if champ is None:
            continue
        valeur = (auteur.get(champ) or '').strip()
        if not valeur:
            continue
        revision = (_AUTEUR_REVISION_IDENTIFIANTS.get(langue, _AUTEUR_REVISION_IDENTIFIANTS['fr'])
                    if champ in (auteur.get('a_verifier') or []) else None)
        nouveau_p = _inserer_dans_paragraphe(p_xml, valeur, revision)
        nouvelle_cellule = nouvelle_cellule.replace(p_xml, nouveau_p, 1)
        rempli += 1
    return nouvelle_cellule, rempli


def _remplir_table_auteurs(table_xml, entete, langue='fr'):
    """Une fiche par auteur reconnu, à l'endroit exact où pronto_modele.extraire_table_
    auteurs() va les relire. Plus d'auteurs que de fiches dans le gabarit : la DERNIÈRE fiche
    est dupliquée autant de fois que nécessaire (décision du brief). Moins d'auteurs : les
    fiches en trop restent vides, comme livrées. Rend (xml, trace)."""
    trace = []
    lignes = _RE_TR_XML.findall(table_xml)
    if len(lignes) < 2:
        return table_xml, trace
    entete_ligne, fiches_gabarit = lignes[0], lignes[1:]
    auteurs = list(entete.auteurs or [])
    if not auteurs:
        return table_xml, trace

    fiches_modele = list(fiches_gabarit)
    if fiches_gabarit and len(auteurs) > len(fiches_modele):
        n_manquantes = len(auteurs) - len(fiches_modele)
        fiches_modele = fiches_modele + [fiches_gabarit[-1]] * n_manquantes
        trace.append({'portee': 'document', 'source': None,
                      'decision': 'entete_fiche_dupliquee',
                      'motif': '%d fiche(s) supplémentaire(s) dupliquée(s) depuis la '
                               'dernière du gabarit (%d auteur(s) reconnu(s) pour %d '
                               'fiche(s) livrée(s))'
                               % (n_manquantes, len(auteurs), len(fiches_gabarit))})
    elif len(auteurs) > len(fiches_modele):
        trace.append({'portee': 'document', 'source': None,
                      'decision': 'entete_auteurs_sans_fiche',
                      'motif': "le gabarit ne porte aucune fiche d'autrice ou d'auteur : "
                               "%d auteur(s) reconnu(s) non écrits" % len(auteurs)})

    nouvelles_fiches = []
    for i, ligne in enumerate(fiches_modele):
        if i >= len(auteurs):
            nouvelles_fiches.append(ligne)
            continue
        cellules = _RE_TC_XML.findall(ligne)
        if len(cellules) != 2:
            nouvelles_fiches.append(ligne)
            continue
        nouvelle_cellule, rempli = _remplir_fiche_auteur(cellules[1], auteurs[i], langue)
        if rempli:
            ligne = ligne.replace(cellules[1], nouvelle_cellule, 1)
            trace.append({'portee': 'document', 'source': None, 'decision': 'entete_auteur',
                          'motif': 'fiche %d remplie depuis l\'en-tête reconnu (%d champ(s))'
                                   % (i + 1, rempli)})
        nouvelles_fiches.append(ligne)

    ancien_bloc = ''.join(lignes)
    nouveau_bloc = entete_ligne + ''.join(nouvelles_fiches)
    return table_xml.replace(ancien_bloc, nouveau_bloc, 1), trace


def _numeroter_revisions(doc_xml):
    """Remplace chaque `w:id` provisoire des révisions d'identifiants par un entier unique,
    au-delà du plus grand `w:id` déjà présent dans le document."""
    if _ID_REVISION_PROVISOIRE not in doc_xml:
        return doc_xml
    suivant = max([int(m) for m in re.findall(r'\bw:id="(\d+)"', doc_xml)], default=0) + 1
    morceaux = doc_xml.split('w:id="%s"' % _ID_REVISION_PROVISOIRE)
    sortie = [morceaux[0]]
    for i, morceau in enumerate(morceaux[1:]):
        sortie.append('w:id="%d"' % (suivant + i))
        sortie.append(morceau)
    return ''.join(sortie)


def _porte_szh_cle(tableau):
    for rangee in tableau.rangees:
        for cellule in rangee:
            for b in cellule.blocs:
                if (isinstance(b, mm.Paragraphe) and pronto_modele.normaliser_nom_style(b.style)
                        == pronto_modele.NOM_STYLE_CLE):
                    return True
    return False


def _tableaux_fixes_du_document(blocs):
    """{rang (0 = métadonnées, 1 = autrices et auteurs) : indice dans `blocs`} des tableaux
    fixes que le DOCUMENT porte déjà — cas A, document déjà au gabarit. Même règle que le
    lecteur du gabarit (pronto_modele.principal : les deux premiers tableaux, par position),
    plus une garde : le tableau doit porter des paragraphes « SZH Cle », sans quoi ce n'est
    pas un tableau fixe mais un tableau de contenu qui se trouve en tête.

    Défaut mesuré (29.09.2026) : un document déjà au gabarit ressortait du nettoyeur avec
    QUATRE tableaux de tête — les deux du gabarit, vides, puis les siens, remplis, recopiés
    dans le corps. À la réimportation, le lecteur prenait les deux vides comme tableaux fixes
    et imprimait les deux remplis au milieu de l'article."""
    tables = [i for i, b in enumerate(blocs) if isinstance(b, mm.Tableau)]
    return {rang: i for rang, i in enumerate(tables[:2]) if _porte_szh_cle(blocs[i])}


# ---------------------------------------------------------------------------------
# Point d'entrée.

def ecrire(document, chemin_gabarit, chemin_sortie, decisions=None, entete=None, langue='fr'):
    """Écrit un .docx au gabarit Pronto depuis un Document du §4, en PARTANT d'une copie du
    gabarit livré (`chemin_gabarit`) — jamais un .docx fabriqué de zéro (§5.3). `decisions` :
    les (stats, trace) déjà produits par manuscrit_modele.classer_titres()/
    nettoyer_mise_en_forme() sur CE document (facultatif, non réinterprété ici — voir l'en-
    tête : ce module ne prend AUCUNE décision, il ne fait que les traduire en styles Word) ;
    simplement recopié dans le retour, pour qu'un seul objet porte tout l'historique d'un
    document au moment d'écrire le rapport. `entete` : l'EnTete que manuscrit_entete.
    extraire_entete() a reconnue (§5.5 du contrat), déjà tranchée elle aussi — None en cas A
    (§1 : le gabarit est déjà rempli, rien à écrire ici) ou si l'appelant ne la fournit pas ;
    remplit alors les DEUX tableaux fixes (titre/sous-titre/résumé/langue, fiches d'autrices
    et auteurs) au lieu de les recopier vides. `langue` : 'fr' (défaut, compatibilité des
    appels existants) ou 'de' — choisit les LIBELLÉS écrits par ce module lui-même (étiquettes
    des blocs figure/tableau, ligne « Mots-clés »), PAS la reconnaissance des étiquettes déjà
    tapées par l'autrice ou l'auteur (identifier_cle() contre CANON_FIGURE/CANON_METADONNEES/
    CANON_AUTEUR reconnaît les deux jeux à la fois, quelle que soit cette valeur) ; une valeur
    inattendue retombe sur 'fr', tracé. Rend un dict {'stats', 'trace', 'decisions',
    'correspondance'} — voir la docstring de _convertir_niveau_racine pour ce dernier champ.
    """
    trace_langue = []
    if langue not in CHAMPS_BLOC:
        trace_langue.append({'portee': 'document', 'source': None, 'decision': 'langue_repli',
                              'motif': "langue %r inconnue de ecrire() : repli sur 'fr'"
                                       % (langue,)})
        langue = 'fr'

    with zipfile.ZipFile(chemin_gabarit) as zin:
        noms = zin.namelist()
        doc_xml = zin.read('word/document.xml').decode('utf-8')
        rels_xml = zin.read('word/_rels/document.xml.rels').decode('utf-8')
        ct_xml = zin.read('[Content_Types].xml').decode('utf-8')
        contenus = {nom: zin.read(nom) for nom in noms}

    # Le gabarit porte un commentaire Word d'aide, ancré sur son propre bloc figure d'exemple
    # (word/comments.xml + commentsExtended/Ids/Extensible.xml + people.xml, et leurs relations
    # / Override) — jamais recopié : le corps qu'écrit ce module est RECONSTRUIT depuis
    # `document.blocs` (voir plus bas), l'exemple du gabarit et son ancre disparaissent avec
    # lui. Sans ce retrait, ces cinq parties restent dans l'archive de sortie, ORPHELINES (plus
    # aucune commentRangeStart/End/commentReference nulle part dans le document produit) —
    # `manuscrit_annoter.py` ne sait ajouter un commentaire QUE si aucun comments.xml n'existe
    # déjà (sinon il tente d'ajouter à celui, périmé, du gabarit).
    parties_orphelines = [n for n in _PARTIES_COMMENTAIRES_GABARIT if n in contenus]
    for nom in parties_orphelines:
        del contenus[nom]
    rels_xml = _retirer_relations(rels_xml, _NOMS_COMMENTAIRES_GABARIT)
    ct_xml = _retirer_overrides(ct_xml, _NOMS_COMMENTAIRES_GABARIT)

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

    trace_entete = []
    if entete is not None:
        table1_xml, trace_meta = _remplir_table_metadonnees(table1_xml, entete)
        table2_xml, trace_auteurs = _remplir_table_auteurs(table2_xml, entete, langue)
        trace_entete = trace_meta + trace_auteurs

    i_sect = interieur.rindex('<w:sectPr')
    sect_xml = interieur[i_sect:]

    rid_existants = [int(m) for m in re.findall(r'Id="rId(\d+)"', rels_xml)]
    registre = _Registre(max(rid_existants, default=0) + 1, numbering_xml_gabarit)
    registre.largeur_max_dxa = _largeur_utile_page_dxa(sect_xml)
    # Styles réels du gabarit COURANT (voir _StylesResolus) — résolus AVANT tout XML écrit :
    # tout le reste de cette fonction, et tout ce qu'appelle _convertir_niveau_racine, lit
    # registre.styles/registre.champs_bloc/registre.separateur_cle, jamais une constante
    # module-level codée pour un seul gabarit.
    registre.styles = _StylesResolus(styles_xml_gabarit)
    registre.champs_bloc = CHAMPS_BLOC[langue]
    registre.separateur_cle = _SEPARATEUR_CLE[langue]
    registre.notes = _RegistreNotes(document.notes, styles_xml_gabarit, footnotes_xml_gabarit,
                                     registre.styles.corps)

    trace = list(trace_langue)
    if parties_orphelines:
        trace.append({'portee': 'document', 'source': None, 'decision': 'commentaire_retire',
                      'motif': "commentaire Word d'aide du gabarit retiré (%s) : son ancre "
                               "disparaît avec le corps du gabarit, jamais recopié — sans ce "
                               "retrait il resterait orphelin dans le document produit"
                               % ', '.join(sorted(n.rsplit('/', 1)[-1]
                                                   for n in parties_orphelines))})
    trace.extend(registre.styles.trace)
    # Cas A : les tableaux fixes du DOCUMENT remplacent ceux, vides, du gabarit — recopiés avec
    # leurs styles maison (SZH Cle, SZH Aide) et leurs photos, jamais dupliqués dans le corps.
    fixes = _tableaux_fixes_du_document(document.blocs) if entete is None else {}
    for rang, i in sorted(fixes.items()):
        xml_fixe = _tableau_xml(document.blocs[i], registre)
        if rang == 0:
            table1_xml = xml_fixe
        else:
            table2_xml = xml_fixe
        trace.append({'portee': 'document', 'source': document.blocs[i].source,
                      'decision': 'tableau_fixe_repris',
                      'motif': "tableau %s déjà au gabarit : repris à sa place, jamais recopié "
                               "dans le corps" % ('des métadonnées' if rang == 0
                                                  else 'des autrices et auteurs')})
    blocs_corps = [b for i, b in enumerate(document.blocs) if i not in fixes.values()]
    corps_xml, correspondance_relative = _convertir_niveau_racine(blocs_corps, registre, trace)
    trace.extend(trace_entete)

    # §5.5 : aucun des deux gabarits ne porte de champ mots-clés — repli documenté par le brief
    # de chantier : un paragraphe de Corps de texte en tête du corps, jamais un champ inventé
    # dans le tableau des métadonnées. Préfixe PAR LANGUE (FR « Mots-clés : », DE
    # « Schlüsselwörter: » — même convention de deux-points que les blocs figure/tableau).
    prefixe_mots_cles_xml = ''
    if entete is not None and entete.mots_cles:
        ligne_mc = _PREFIXE_MOTS_CLES[langue] + ', '.join(entete.mots_cles)
        prefixe_mots_cles_xml = (
            '<w:p><w:pPr><w:pStyle w:val="%s"/></w:pPr><w:r><w:t xml:space="preserve">%s'
            '</w:t></w:r></w:p>') % (registre.styles.corps, _echapper(ligne_mc))
        trace.append({'portee': 'document', 'source': None,
                      'decision': 'entete_mots_cles_corps',
                      'motif': "aucun champ mots-clés dans le gabarit : écrits en premier "
                               "paragraphe du corps (« %s »)" % ligne_mc})

    # Décision n°7 de l'en-tête : les deux <w:p/> qui séparent les deux tableaux fixes du
    # gabarit précèdent le corps — d'où le décalage entre l'indice RELATIF que rend
    # _convertir_niveau_racine (qui ignore tout ce qu'elle n'écrit pas elle-même) et
    # l'indice ABSOLU, parmi tous les <w:p> enfants directs de w:body, que demande le futur
    # module d'annotation. Le paragraphe des mots-clés, quand il existe, s'ajoute à ce
    # décalage : c'est un <w:p> de plus AVANT le premier paragraphe du corps proprement dit.
    PREFIXE_WP_TABLEAUX_FIXES = 2 + (1 if prefixe_mots_cles_xml else 0)
    correspondance = []
    for c in correspondance_relative:
        entree = {'source': c['source'], 'sortie': c['sortie'] + PREFIXE_WP_TABLEAUX_FIXES}
        if 'bloc' in c:  # entrée de bloc (§22.09.2026) : propagée telle quelle, jamais perdue.
            entree['bloc'] = c['bloc']
        correspondance.append(entree)

    nouveau_corps = (table1_xml + PARAGRAPHE_VIDE + table2_xml + PARAGRAPHE_VIDE
                      + prefixe_mots_cles_xml + corps_xml + sect_xml)
    nouveau_doc_xml = _numeroter_revisions(preambule + nouveau_corps + queue)

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
