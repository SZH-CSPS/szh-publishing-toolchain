#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Modèle de document du nettoyeur de manuscrit (article) et décisions qui le lisent :
# classement des titres (promotion et rétrogradation), nettoyage de la mise en forme
# manuelle, reconnaissance du gabarit (cas A / cas B), taille dominante du corps. Voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
# Ce module ne lit ni .docx ni .odt. Il travaille sur six classes (Image, Fragment,
# Paragraphe, Cellule, Tableau, Document), construites par manuscrit_docx.py ou, pour les
# tests, depuis le JSON du mode --diagnostic décrit plus bas. Bibliothèque standard
# seulement. `normaliser_nom_style()` et les noms de styles maison viennent de pronto_modele,
# `avertir()` de szh_commun.
#
# ── Schéma JSON du mode --diagnostic (lu sur stdin) ─────────────────────────────────────────
#
#   {
#     "styles": ["heading 1", "heading 2", "SZH Cle", ...],   // noms de word/styles.xml
#     "langue": "fr",                                          // ou "" si non déclarée
#     "revisions": 0, "commentaires": 0,
#     "notes": {"3": [ <bloc>, ... ], "12": [ <bloc>, ... ]},   // identifiant -> contenu.
#                                              // Notes de bas de page et de fin ensemble ; une
#                                              // note de fin porte un identifiant décalé (voir
#                                              // manuscrit_docx.py).
#     "blocs": [ <bloc>, ... ]                                  // blocs de premier niveau, en ordre
#   }
#
#   <bloc> est un paragraphe ou un tableau, selon "type" :
#
#   <paragraphe> = {
#     "type": "paragraphe",              // optionnel : c'est le défaut
#     "style": "heading 2",              // nom humain déjà résolu, "" si aucun
#     "niveau_declare": 2,               // 1..3 si le style dit titre, 0 sinon
#     "fragments": [ <fragment>, ... ],
#     "liste": [numId, ilvl, format] | null,  // format : 'puce'|'numero'|'' ; '' quand le
#                                              // lecteur n'a pas pu le déterminer
#     "alignement": "",                  // "" = non déclaré
#     "alignement_effectif": "",         // direct, sinon cascade des styles ; "" si non
#                                          // déclaré
#     "retrait": 0,
#     "source": 3                        // index dans le corps ; compté si absent
#   }
#
#   <fragment> = {
#     "texte": "…",                      // "" si le fragment ne porte qu'une image ou une note
#     "image": <image> | null,
#     "forme": {                         // les 12 clés de FORME_CLES ; une clé absente vaut
#       "gras": true, "italique": false, ...  // None (« non déclaré »), à distinguer de
#     },                                  // false (« déclaré éteint »)
#     "effectif": { ... },                // mêmes clés, mise en forme effectivement appliquée
#                                          // (directe, sinon cascade des styles)
#     "lien": "https://…" | null,
#     "source": 0,
#     "note": 3 | null                    // identifiant de la note appelée, ou null
#   }
#
#   <image> = {"nom": "image1.png", "surface": 0, "cx": 0, "cy": 0, "largeur_px": 0,
#              "hauteur_px": 0, "alt": "", "flottante": false, "octets_base64": "…"}
#              // cx/cy : boîte d'affichage en EMU (leur produit vaut `surface`).
#              // largeur_px/hauteur_px : dimensions du fichier en pixels ; 0 en mode
#              // diagnostic, qui ne lit pas les octets. octets_base64 est facultatif.
#
#   <tableau> = {"type": "tableau", "page": null, "source": 5,
#                "rangees": [ [ <cellule>, ... ], ... ]}
#
#   <cellule> = {"colspan": 1, "rowspan": 1, "entete": false, "blocs": [ <bloc>, ... ]}
#
# Sortie sur stdout, en JSON ASCII (ensure_ascii=True) car la console Windows n'est pas
# forcément en UTF-8 :
#
#   {"gabarit": "A"|"B", "taille_dominante": 24|null,
#    "titres": {"stats": {...}, "trace": [...]},
#    "formatage": {"stats": {...}, "trace": [...]},
#    "document": <document>}     // l'état après les deux passes (mêmes clés qu'en entrée,
#                                 // avec "niveau_retenu" rempli et "forme" nettoyée). Les
#                                 // tests vérifient les champs protégés sur cet objet.

import base64
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun
import pronto_modele
# Lexique des légendes (« Tableau 1 », « Figure 2 »), que la passe 1 exclut des titres.
from heritage_meta import RE_LEGENDE


# ---------------------------------------------------------------------------------
# Seuils du classement des titres, tous réunis ici. Le classement compare chaque paragraphe
# à son propre document : il groupe les paragraphes de même signature de mise en forme
# (taille, gras, italique, souligné, police, alignement, casse), sans score.

# Passe 2 : bornes d'un état déclaré plausible. Sur 58 articles de la Revue, ceux qui ont de
# vrais styles de titre en portent de 2 à 21 (médiane 9). Un état cohérent désactive la
# promotion aux niveaux déjà couverts ; la rétrogradation (passe 4) tourne dans tous les cas.
MIN_TITRES = 2
MAX_TITRES = 21

# Médiane du même corpus, citée dans le signal de classer_titres() quand MAX_TITRES est
# dépassé.
MEDIANE_TITRES_CORPUS = 9

# Trois niveaux de titre au plus (lignes directrices de la Revue). Déjà garanti par
# niveau_declare ∈ {0,1,2,3}, mais vérifié et cité par la contrainte de fin de passe 3.
MAX_NIVEAUX = 3

# Passe 3, « court par rapport au corps du document » : le corps doit être au moins 3 fois
# plus long que le candidat. Dans la Revue, un paragraphe de corps fait 768 à 1525 signes et
# un intertitre 100 à 150 ; la marge est donc large.
RATIO_LONGUEUR_TITRE = 3

# Passe 3, « longueurs homogènes » : dans un groupe, le plus long candidat ne dépasse pas ce
# multiple du plus court. Écarte un groupe qui mêle un titre de 3 mots et une phrase de 30.
SEUIL_HOMOGENEITE_MOTS = 3

# Plancher du dénominateur de ce rapport. Des titres d'un mot (« Résumé », « Références »)
# côtoient des titres de dix : sans plancher, le rapport rejetterait le groupe entier. Avec
# 4, un membre de 30 mots échoue toujours (30 > 3×4).
PLANCHER_HOMOGENEITE_MOTS = 4

# Passe 3, « occurrences réparties » : vérifié à partir de ce nombre d'occurrences dans un
# groupe. Écarte un bloc de paragraphes consécutifs de même mise en forme (citation longue,
# légende sur plusieurs lignes).
SEUIL_DISPERSION_MIN = 3


# ---------------------------------------------------------------------------------
# Le modèle : six classes à __slots__. L'ordre des champs est fixe, d'autres modules
# construisent ces objets par position.

class Image:
    """Une image. `octets` est le contenu du fichier ; `surface` en EMU², 0 si non déclarée ;
    `alt` le texte alternatif, '' si absent ; `flottante` vraie si l'image est ancrée
    (w:anchor) et non en ligne (w:inline).

    `cx`, `cy` : la boîte d'affichage en EMU ; leur produit vaut `surface`.
    `largeur_px`, `hauteur_px` : dimensions du fichier en pixels, lues dans ses octets ; 0 si
    le format est inconnu ou vectoriel (SVG, EMF, WMF) ou si le fichier est illisible."""

    __slots__ = ('nom', 'octets', 'surface', 'alt', 'flottante', 'source',
                 'cx', 'cy', 'largeur_px', 'hauteur_px')

    def __init__(self, nom='', octets=b'', surface=0, alt='', flottante=False, source=None,
                 cx=0, cy=0, largeur_px=0, hauteur_px=0):
        self.nom = nom or ''
        self.octets = octets or b''
        self.surface = surface or 0
        self.alt = alt or ''
        self.flottante = bool(flottante)
        self.source = source
        self.cx = cx or 0
        self.cy = cy or 0
        self.largeur_px = largeur_px or 0
        self.hauteur_px = hauteur_px or 0

    def __repr__(self):
        return ('Image(%r, %d octets, surface=%r, cx=%r, cy=%r, %rx%rpx, alt=%r, '
                'flottante=%r, source=%r)') % (
            self.nom, len(self.octets), self.surface, self.cx, self.cy,
            self.largeur_px, self.hauteur_px, self.alt, self.flottante, self.source)


# Les 12 clés de Fragment.forme. Une clé non déclarée vaut None ; False veut dire « déclaré
# éteint ». Construire une forme avec nouvelle_forme().
FORME_CLES = ('gras', 'italique', 'souligne', 'exposant', 'indice', 'barre',
              'petites_capitales', 'majuscules', 'police', 'taille', 'couleur', 'surlignage')


def nouvelle_forme(**valeurs):
    """Un dict `forme` avec exactement les clés de FORME_CLES, None pour toute clé non
    fournie. Une clé inconnue est ignorée."""
    forme = dict.fromkeys(FORME_CLES)
    for cle, val in valeurs.items():
        if cle in forme:
            forme[cle] = val
    return forme


class Fragment:
    """Un fragment de texte, une image ou un appel de note dans un paragraphe.
    `texte` n'est jamais None ('' si le fragment porte une image ou une note) ; `forme` est
    un dict FORME_CLES (voir nouvelle_forme()) ; `lien` une URL ou None.

    `note` : identifiant de la note appelée (w:footnoteReference/w:endnoteReference), ou
    None ; `texte` vaut alors ''. Une note de fin a un identifiant décalé au-delà des notes
    de bas de page (voir manuscrit_docx.py).

    `forme` est la mise en forme directe seule. `effectif` a les mêmes clés et donne la mise
    en forme effectivement appliquée : directe, sinon style de caractère, sinon styles de
    paragraphe, sinon valeurs par défaut du document."""

    __slots__ = ('texte', 'image', 'forme', 'lien', 'source', 'note', 'effectif')

    def __init__(self, texte='', image=None, forme=None, lien=None, source=None, note=None,
                 effectif=None):
        self.texte = texte or ''
        self.image = image
        self.forme = forme if forme is not None else nouvelle_forme()
        self.lien = lien
        self.source = source
        self.note = note
        self.effectif = effectif if effectif is not None else nouvelle_forme()

    def __repr__(self):
        return 'Fragment(%r, image=%r, lien=%r, source=%r, note=%r)' % (
            self.texte, self.image, self.lien, self.source, self.note)


class Paragraphe:
    """Un paragraphe ou un titre. `niveau_declare` : 1..3 si le style dit titre, 0 sinon.
    `niveau_retenu` : rempli par classer_titres(), 0 = corps. `liste` : (numId, ilvl, format)
    ou None ; `format` ('puce'|'numero'|'') vient de numbering.xml, '' s'il est absent ou
    inconnu. Un écrivain ne recopie pas le `numId` d'origine : il désigne une définition du
    numbering.xml d'entrée, pas de celui de la sortie."""

    __slots__ = ('style', 'niveau_declare', 'niveau_retenu', 'fragments', 'liste',
                 'alignement', 'retrait', 'source', 'alignement_effectif')

    def __init__(self, style='', niveau_declare=0, niveau_retenu=0, fragments=None,
                 liste=None, alignement='', retrait=0, source=None, alignement_effectif=''):
        self.style = style or ''
        self.niveau_declare = niveau_declare or 0
        self.niveau_retenu = niveau_retenu or 0
        self.fragments = fragments if fragments is not None else []
        self.liste = liste
        self.alignement = alignement or ''
        self.retrait = retrait or 0
        self.source = source
        # Alignement direct, sinon celui des styles de paragraphe (comme Fragment.effectif).
        self.alignement_effectif = alignement_effectif or ''

    def texte(self):
        """Concaténation des fragments, recalculée à chaque appel."""
        return ''.join(f.texte for f in self.fragments)

    def __repr__(self):
        return 'Paragraphe(%r, declare=%r, retenu=%r, %d fragment(s), source=%r)' % (
            self.style, self.niveau_declare, self.niveau_retenu, len(self.fragments),
            self.source)


class Cellule:
    """Une cellule de tableau. `blocs` : liste de Paragraphe | Tableau, dans l'ordre,
    imbrication comprise. Pas de champ `source`."""

    __slots__ = ('colspan', 'rowspan', 'entete', 'blocs')

    def __init__(self, colspan=1, rowspan=1, entete=False, blocs=None):
        self.colspan = colspan or 1
        self.rowspan = rowspan or 1
        self.entete = bool(entete)
        self.blocs = blocs if blocs is not None else []

    def __repr__(self):
        return 'Cellule(colspan=%r, rowspan=%r, entete=%r, %d bloc(s))' % (
            self.colspan, self.rowspan, self.entete, len(self.blocs))


class Tableau:
    """Un tableau. `rangees` : liste de listes de Cellule ; une cellule masquée par une
    fusion n'y figure pas. `page` : numéro de page déclaré, ou None."""

    __slots__ = ('rangees', 'page', 'source')

    def __init__(self, rangees=None, page=None, source=None):
        self.rangees = rangees if rangees is not None else []
        self.page = page
        self.source = source

    def __repr__(self):
        return 'Tableau(%d rangee(s), page=%r, source=%r)' % (
            len(self.rangees), self.page, self.source)


class Document:
    """Le document entier. `blocs` : liste de Paragraphe | Tableau, premier niveau, dans
    l'ordre. `styles` : noms des styles présents dans styles.xml, et `cle_gabarit` : valeur
    de la propriété cachée SZH-Gabarit ou None ; servent au cas A (reconnaitre_gabarit).

    `notes` : dict[int, list[Paragraphe | Tableau]], le contenu de chaque note par
    identifiant. Notes de bas de page et de fin y sont ensemble ; une note de fin a un
    identifiant décalé au-delà des notes de bas de page (manuscrit_docx.py), pour que les
    clés ne se recouvrent pas."""

    __slots__ = ('blocs', 'styles', 'langue', 'revisions', 'commentaires', 'notes', 'source',
                 'cle_gabarit')

    def __init__(self, blocs=None, styles=None, langue='', revisions=0, commentaires=0,
                 notes=None, source=None, cle_gabarit=None):
        self.blocs = blocs if blocs is not None else []
        self.styles = styles if styles is not None else []
        self.langue = langue or ''
        self.revisions = revisions or 0
        self.commentaires = commentaires or 0
        self.notes = notes if notes is not None else {}
        self.source = source
        self.cle_gabarit = cle_gabarit

    def __repr__(self):
        return 'Document(%d bloc(s), %d style(s), langue=%r, source=%r)' % (
            len(self.blocs), len(self.styles), self.langue, self.source)


# ---------------------------------------------------------------------------------
# Avertissements à la rédaction, au même format que pronto_modele.py (szh_commun.avertir),
# que lib/journal.js sait lire. Deux signaux : un style de titre posé sur presque tout le
# document, et un paragraphe entièrement gras ou en majuscules non retenu comme titre.

PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# ---------------------------------------------------------------------------------
# Reconnaissance du gabarit : cas A si le document porte la clé cachée SZH-Gabarit, ou à
# défaut SZH Cle et SZH Aide dans styles.xml ; cas B sinon. Même décision qu'à l'import
# (pronto_modele.est_gabarit()).

def reconnaitre_gabarit(document):
    """'A' (gabarit déjà en place, aucune restructuration) ou 'B' (manuscrit quelconque)."""
    return 'A' if pronto_modele.est_gabarit(document.styles, cle=document.cle_gabarit) else 'B'


# ---------------------------------------------------------------------------------
# Taille dominante du corps, lue sur les paragraphes de premier niveau seulement (pas les
# tableaux), comme docx-titres.py.

def _paragraphes_premier_niveau(document):
    return [b for b in document.blocs if isinstance(b, Paragraphe)]


def taille_dominante(document):
    """La taille de police (demi-points) la plus fréquente parmi les fragments porteurs de
    texte des paragraphes de premier niveau ; None si aucune taille n'est déclarée, cas que
    tout appelant vérifie."""
    freq = {}
    for p in _paragraphes_premier_niveau(document):
        for f in p.fragments:
            if not f.texte:
                continue
            taille = f.forme.get('taille')
            if taille is not None:
                freq[taille] = freq.get(taille, 0) + 1
    return max(freq, key=freq.get) if freq else None


# ---------------------------------------------------------------------------------
# Classement des titres, en quatre passes et sans score :
#   1. exclusions (styles maison, citation, légende, liste, vide, étendue de bibliographie) ;
#   2. l'état déclaré décide quels niveaux la passe 3 peut chercher ;
#   3. regroupement par signature de mise en forme (jamais un paragraphe seul) ;
#   4. rétrogradation d'un titre déclaré dont la signature est celle du corps.
# Voir docs/ARCHITECTURE-nettoyeur-manuscrit.md.

def _mots(texte):
    return texte.split()


def _fragments_non_vides(paragraphe):
    return [f for f in paragraphe.fragments if f.texte]


# Les signatures se lisent sur la mise en forme effective : un corps sans taille déclarée
# (héritée du style) et un faux titre déclaré en 12 pt font tous deux 12 pt à l'écran.
# `effectif` d'abord, puis `forme` clé par clé ; un Fragment construit sans `effectif` (dans
# un test) retombe donc sur `forme`.
def _valeur_effective(fragment, cle):
    val = fragment.effectif.get(cle) if fragment.effectif else None
    return val if val is not None else fragment.forme.get(cle)


def _taille_max(fragments_non_vides):
    tailles = [_valeur_effective(f, 'taille') for f in fragments_non_vides]
    tailles = [t for t in tailles if t is not None]
    return max(tailles) if tailles else None


def _tout_forme(fragments_non_vides, cle):
    """True si tous les fragments non vides ont `cle` (gras/italique/souligne) à True en
    mise en forme effective. Un mot en gras dans une phrase ne rend pas le paragraphe
    « tout gras »."""
    return bool(fragments_non_vides) and all(_valeur_effective(f, cle) is True
                                              for f in fragments_non_vides)


def _police_dominante(fragments_non_vides):
    """La police si tous les fragments non vides ont la même (mise en forme effective) ; None
    si elle n'est pas déclarée ou varie."""
    polices = {_valeur_effective(f, 'police') for f in fragments_non_vides
               if _valeur_effective(f, 'police')}
    return next(iter(polices)) if len(polices) == 1 else None


def _casse(texte):
    """'MAJ' si le texte a au moins une lettre et aucune minuscule. Complète
    `forme.majuscules`, qui ne voit que la casse forcée par Word, pas un texte tapé en
    capitales."""
    lettres = [c for c in texte if c.isalpha()]
    if not lettres:
        return ''
    return 'MAJ' if all(c == c.upper() for c in lettres) else ''


def _signature(paragraphe, fragments_non_vides, texte):
    """La signature de mise en forme d'un paragraphe : taille (en demi-points), gras,
    italique, souligné, police, alignement, casse, sur la mise en forme effective. Un tuple :
    deux paragraphes de même signature tombent dans le même groupe."""
    alignement = paragraphe.alignement_effectif or paragraphe.alignement
    return (_taille_max(fragments_non_vides), _tout_forme(fragments_non_vides, 'gras'),
            _tout_forme(fragments_non_vides, 'italique'),
            _tout_forme(fragments_non_vides, 'souligne'),
            _police_dominante(fragments_non_vides), alignement, _casse(texte))


def _texte_signature(sig):
    """Une signature en clair, pour la trace lue par la rédaction."""
    taille, gras, italique, souligne, police, alignement, casse = sig
    morceaux = [('%s pt' % (taille / 2)) if taille else 'taille non déclarée']
    if gras:
        morceaux.append('gras')
    if italique:
        morceaux.append('italique')
    if souligne:
        morceaux.append('souligné')
    if police:
        morceaux.append('police %s' % police)
    if alignement:
        morceaux.append('alignement %s' % alignement)
    if casse == 'MAJ':
        morceaux.append('MAJUSCULES')
    return ', '.join(morceaux)


# ---------------------------------------------------------------------------------
# Passe 1 : exclusions, avant toute heuristique. Un style maison, de citation ou de légende,
# un paragraphe en liste ou vide ne deviennent pas un titre par déduction.

def _est_style_citation(style):
    """Style de citation : Word pose 'Quote'/'IntenseQuote' (styleId), affichés 'Citation'
    en français et 'Zitat' en allemand. `famille()` de pronto_modele ne couvre pas cette
    famille, d'où ce test sur le nom normalisé."""
    n = pronto_modele.normaliser_nom_style(style)
    return bool(n) and ('quote' in n or n == 'citation' or 'zitat' in n)


# Autres exclusions de la passe 1 : un séparateur visuel (« ──────── », sans lettre), une
# ligne de coordonnées (courriel, téléphone, URL) et une légende déjà écrite (« Tableau 1 »,
# reconnue par RE_LEGENDE).
RE_EMAIL = re.compile(r'[^\s@]+@[^\s@]+\.[^\s@]+')
RE_TELEPHONE = re.compile(r'\+?\d[\d\s]{8,}')
RE_URL = re.compile(r'(?:https?://|www\.)\S+', re.I)


def _sans_aucune_lettre(texte):
    """Un paragraphe non vide sans aucune lettre : une ligne de tirets, d'astérisques ou de
    soulignés servant de séparateur. Le paragraphe vide a sa propre catégorie ('vide')."""
    return bool(texte.strip()) and not any(c.isalpha() for c in texte)


def _porte_des_coordonnees(texte):
    """Un courriel, un numéro de téléphone (au moins 9 chiffres, espaces tolérés) ou une URL.
    Fréquent dans un encadré de coordonnées, que la mise en forme seule ne distingue pas
    toujours d'un intertitre."""
    return bool(RE_EMAIL.search(texte) or RE_TELEPHONE.search(texte) or RE_URL.search(texte))


def _indices_etendue_bibliographie(document, paras):
    """Les indices (dans `paras`) situés après le dernier paragraphe de premier niveau dont
    le texte est dans TITRES_BIB, jusqu'à la fin du document ou au premier tableau (même
    borne que pronto_modele.etendue_biblio()). Le titre lui-même n'en fait pas partie : il
    reste jugé comme les autres paragraphes.

    Contrairement à pronto_modele.etendue_biblio(), le titre n'a pas besoin d'un style de
    titre : cette passe tourne avant le classement et doit trouver une bibliographie même
    dans un manuscrit sans style de titre. Le lexique TITRES_BIB est assez spécifique pour
    que la comparaison de texte suffise.

    L'étendue peut contenir une vraie rubrique placée après la bibliographie (« Informations
    sur les autrices et auteurs »). _exclusions_passe1() n'exclut donc que les paragraphes
    sans style de titre ; un titre déclaré est jugé par la passe 4."""
    lexique = pronto_modele.lire_titres_bib()
    if not lexique:
        return set()
    dernier = None
    idx = -1
    for bloc in document.blocs:
        if isinstance(bloc, Paragraphe):
            idx += 1
            if pronto_modele.titre_est_biblio(bloc.texte(), lexique, tolerer_complement=True):
                dernier = idx
    if dernier is None:
        return set()
    exclus = set()
    idx = -1
    dans_etendue = False
    for bloc in document.blocs:
        if isinstance(bloc, Tableau):
            if dans_etendue:
                break
            continue
        idx += 1
        if dans_etendue:
            exclus.add(idx)
        if idx == dernier:
            dans_etendue = True
    return exclus


def _exclusions_passe1(document, paras):
    """{idx: (categorie, raison)} : un paragraphe de ce dict ne peut pas être promu titre par
    la passe 3. Catégories : style_maison, style_citation, legende, liste, vide, sans_lettre,
    coordonnees, legende_lexique, bibliographie.

    L'exclusion « bibliographie » ne vaut que pour les paragraphes sans style de titre
    (niveau_declare == 0). Un titre déclaré est jugé par la passe 4 sur sa signature et sa
    longueur : l'étendue de bibliographie, qui va jusqu'à la fin du document, peut contenir
    une vraie rubrique (« Informations sur les autrices et auteurs »)."""
    exclus = {}
    for idx, p in enumerate(paras):
        style_n = pronto_modele.normaliser_nom_style(p.style)
        if style_n.startswith('szh'):
            exclus[idx] = ('style_maison', 'style maison « %s »' % p.style)
        elif _est_style_citation(p.style):
            exclus[idx] = ('style_citation', 'style de citation « %s »' % p.style)
        elif pronto_modele.famille(p.style) == 'caption':
            exclus[idx] = ('legende', 'style de légende « %s »' % p.style)
        elif p.liste is not None:
            # Un élément de liste numérotée peut devenir un titre de section : il est exclu
            # ici, puis _detecter_titres_liste le reprend dans la catégorie 'liste'. Les puces
            # ne sont jamais candidates.
            exclus[idx] = ('liste', 'paragraphe en liste')
        elif not p.texte().strip():
            exclus[idx] = ('vide', 'paragraphe vide')
        elif _sans_aucune_lettre(p.texte()):
            exclus[idx] = ('sans_lettre',
                            'paragraphe sans aucune lettre (séparateur visuel, ex. une ligne '
                            'de tirets)')
        elif _porte_des_coordonnees(p.texte()):
            exclus[idx] = ('coordonnees',
                            'porte une adresse courriel, un numéro de téléphone ou une URL')
        elif RE_LEGENDE.match(p.texte().strip()):
            exclus[idx] = ('legende_lexique',
                            'commence par le lexique de légende (« Tableau 1 », « Figure 2 »… '
                            '— RE_LEGENDE de docx-titres.py)')
    for idx in _indices_etendue_bibliographie(document, paras):
        if paras[idx].niveau_declare != 0:
            continue
        exclus.setdefault(idx, ('bibliographie',
                                 'dans l\'étendue de bibliographie (lexique TITRES_BIB de '
                                 'szh-citations.lua)'))
    return exclus


# ---------------------------------------------------------------------------------
# Passe 2 : l'état déclaré décide de ce que la passe 3 peut chercher.

def _etat_declare(paras, exclus):
    comptes = {1: 0, 2: 0, 3: 0}
    for idx, p in enumerate(paras):
        if idx in exclus:
            continue
        if p.niveau_declare in (1, 2, 3):
            comptes[p.niveau_declare] += 1
    total = sum(comptes.values())
    niveaux_utilises = {n for n, c in comptes.items() if c > 0}
    coherent = (MIN_TITRES <= total <= MAX_TITRES) and len(niveaux_utilises) <= MAX_NIVEAUX

    if total == 0:
        niveaux_a_chercher = {1, 2, 3}
        motif = ('aucun style de titre déclaré : recherche des trois niveaux par mise en '
                 'forme (passe 3)')
    elif coherent:
        niveaux_a_chercher = {1, 2, 3} - niveaux_utilises
        if niveaux_a_chercher:
            motif = ('état déclaré cohérent (%d titre(s) déclaré(s) sur %d niveau(x), bornes '
                     '[%d, %d]) : promotion désactivée aux niveaux déjà couverts, recherche '
                     'limitée aux niveaux manquants %s' % (total, len(niveaux_utilises),
                                                            MIN_TITRES, MAX_TITRES,
                                                            sorted(niveaux_a_chercher)))
        else:
            motif = ('état déclaré cohérent (%d titre(s) déclaré(s) sur %d niveau(x)) : tous '
                     'les niveaux sont déjà couverts, aucune promotion recherchée'
                     % (total, len(niveaux_utilises)))
    else:
        niveaux_a_chercher = set()
        motif = ('état déclaré incohérent (%d titre(s) déclaré(s), %d niveau(x) utilisés, '
                 'bornes de plausibilité [%d, %d] sur au plus %d niveaux) : aucune promotion '
                 'recherchée — seule la rétrogradation (passe 4) s\'applique encore'
                 % (total, len(niveaux_utilises), MIN_TITRES, MAX_TITRES, MAX_NIVEAUX))
    return niveaux_a_chercher, total, niveaux_utilises, motif


# ---------------------------------------------------------------------------------
# Signature dominante et longueur médiane du corps du document, référence des passes 3 et 4.
# Calculées sur les seuls paragraphes non déclarés titre et non exclus par la passe 1, pour
# que titres, bibliographie et légendes ne faussent pas la mesure qui sert à les juger.

def _corps_stats(paras, exclus):
    pool = []
    for idx, p in enumerate(paras):
        if idx in exclus or p.niveau_declare != 0:
            continue
        texte = p.texte().rstrip()
        if not texte:
            continue
        pool.append((p, texte))
    if not pool:
        return None, None
    comptes_sig = {}
    longueurs = []
    for p, texte in pool:
        sig = _signature(p, _fragments_non_vides(p), texte)
        comptes_sig[sig] = comptes_sig.get(sig, 0) + 1
        longueurs.append(len(texte))
    signature_dominante = max(comptes_sig, key=comptes_sig.get)
    longueurs.sort()
    n = len(longueurs)
    mediane = (longueurs[n // 2] if n % 2 == 1
               else (longueurs[n // 2 - 1] + longueurs[n // 2]) / 2)
    return signature_dominante, mediane


# ---------------------------------------------------------------------------------
# Titres en liste numérotée. Certains manuscrits posent leurs titres de section comme
# éléments d'une liste numérotée (style Listenabsatz, gras). Un élément isolé qui a une
# signature de titre est donc promu. Les puces ne sont jamais candidates.
#
# Pour un titre ainsi promu, le numéro manuel de tête (« 2.1 Titre », « I. Titre ») est
# retiré du premier fragment, car le gabarit numérote lui-même les Titre1, et la liste est
# retirée du paragraphe (`liste = None`). Ce sont les seules décisions de ce module qui
# modifient autre chose que `niveau_retenu`.
RE_NUM_MANUEL = re.compile(r'^\s*(\d+(?:\.\d+)*|[IVX]+)[.)]?\s+')


def _voisin_non_vide(paras, idx, pas):
    """Le paragraphe non vide le plus proche dans la direction `pas` (+1 ou -1), ou None en
    bout de séquence."""
    i = idx + pas
    while 0 <= i < len(paras):
        if paras[i].texte().strip():
            return paras[i]
        i += pas
    return None


def _item_numerote_isole(paras, idx):
    """Un élément de liste numérotée (pas une puce) dont ni le paragraphe non vide précédent
    ni le suivant n'appartient à la même liste (numId). Deux éléments adjacents de la même
    liste échouent donc tous deux : une vraie liste n'est jamais prise pour des titres."""
    p = paras[idx]
    if p.liste is None or p.liste[2] != 'numero':
        return False
    numid = p.liste[0]
    for voisin in (_voisin_non_vide(paras, idx, -1), _voisin_non_vide(paras, idx, 1)):
        if voisin is not None and voisin.liste is not None and voisin.liste[0] == numid:
            return False
    return True


def _profondeur_numero_manuel(numero):
    """La profondeur d'un numéro manuel : 1 pour un chiffre romain, sinon le nombre de
    segments séparés par un point (« 2 » → 1, « 2.1 » → 2, « 2.1.3 » → 3)."""
    if re.fullmatch(r'[IVX]+', numero):
        return 1
    return numero.count('.') + 1


def _detecter_titres_liste(paras, exclus, corps_sig):
    """{idx: (niveau, motif, prefixe_numero_a_retirer)} : les éléments isolés de liste
    numérotée qui ont une signature de titre : gras, ou taille supérieure à celle du corps,
    ou italique quand tous les autres candidats le sont aussi. Ne regarde que les
    paragraphes exclus par la passe 1 dans la catégorie 'liste'."""
    def _admissible(idx):
        texte = paras[idx].texte()
        # Légende, séparateur ou coordonnées restent exclus, en liste ou non.
        return not (RE_LEGENDE.match(texte.strip()) or _sans_aucune_lettre(texte)
                    or _porte_des_coordonnees(texte))

    candidats = [idx for idx in range(len(paras))
                 if exclus.get(idx, (None,))[0] == 'liste' and _item_numerote_isole(paras, idx)
                 and _admissible(idx)]
    if not candidats:
        return {}

    tous_italiques = all(_tout_forme(_fragments_non_vides(paras[i]), 'italique')
                          for i in candidats)
    taille_corps = corps_sig[0] if corps_sig is not None else None

    retenus = []
    for idx in candidats:
        fragments = _fragments_non_vides(paras[idx])
        if not fragments:
            continue
        gras = _tout_forme(fragments, 'gras')
        taille = _taille_max(fragments)
        plus_grand = (taille is not None and taille_corps is not None
                      and taille > taille_corps)
        italique = _tout_forme(fragments, 'italique')
        if gras or plus_grand or (italique and tous_italiques):
            retenus.append(idx)
    if not retenus:
        return {}

    # Niveau : profondeur du numéro manuel s'il y en a un, sinon profondeur de la liste
    # (ilvl + 1), sinon ordre des signatures parmi ces candidats (comme en passe 3 : taille
    # décroissante, gras, italique).
    resultats = {}
    sans_signal = []
    for idx in retenus:
        p = paras[idx]
        texte = p.texte()
        m = RE_NUM_MANUEL.match(texte)
        if m:
            niveau = min(MAX_NIVEAUX, _profondeur_numero_manuel(m.group(1)))
            resultats[idx] = [niveau, 'numéro manuel « %s » retiré' % m.group(1), m.group(0)]
        elif p.liste[1]:
            niveau = min(MAX_NIVEAUX, p.liste[1] + 1)
            resultats[idx] = [niveau, 'profondeur de liste (niveau %d)' % p.liste[1], None]
        else:
            sans_signal.append(idx)

    if sans_signal:
        # Groupé sur la signature typographique, sans l'alignement : un alignement justifié
        # hérité par une partie des titres ne doit pas les répartir sur deux niveaux.
        groupes = {}
        representant = {}
        for idx in sans_signal:
            texte = paras[idx].texte().rstrip()
            sig = _signature(paras[idx], _fragments_non_vides(paras[idx]), texte)
            cle = _signature_typographique(sig)
            groupes.setdefault(cle, []).append(idx)
            representant.setdefault(cle, sig)
        groupes_pour_ordre = {representant[cle]: indices for cle, indices in groupes.items()}
        for rang, (sig, indices) in enumerate(_ordonner_groupes(groupes_pour_ordre)):
            niveau = min(MAX_NIVEAUX, rang + 1)
            for idx in indices:
                resultats[idx] = [niveau, 'ordre des signatures parmi les titres de liste '
                                          'numérotée', None]

    sortie = {}
    for idx, (niveau, motif_niveau, prefixe) in resultats.items():
        motif = ('promu titre (niveau %d) depuis une liste numérotée ; %s'
                 % (niveau, motif_niveau))
        sortie[idx] = (niveau, motif, prefixe)
    return sortie


# ---------------------------------------------------------------------------------
# Passe 4 : rétrogradation d'un paragraphe déclaré titre qui ressemble au corps.
#
# La signature seule ne suffit pas : un vrai titre stylé « Heading 1 » n'a presque jamais de
# mise en forme directe (son gras et sa taille viennent du style), et un faux titre (corps
# auquel on a collé un style de titre) non plus. Si la signature diffère de celle du corps,
# le titre est conservé. Sinon, la longueur décide : un titre déclaré n'est rétrogradé que
# s'il n'est pas plus court que la médiane du corps (RATIO_RETROGRADATION_MIN = 1, bien plus
# indulgent que RATIO_LONGUEUR_TITRE, qui sert à promouvoir).
RATIO_RETROGRADATION_MIN = 1


def _signature_typographique(sig):
    """La signature sans l'alignement. Un alignement justifié est souvent hérité de tout le
    document et ne distingue pas un titre ; s'il suffisait, des paragraphes longs ne
    différant du corps que par lui seraient pris pour des titres. L'alignement reste dans la
    signature complète, utilisée par le regroupement de la passe 3 et la trace."""
    taille, gras, italique, souligne, police, alignement, casse = sig
    return (taille, gras, italique, souligne, police, casse)


def _signature_directe(paragraphe, fragments_non_vides, texte):
    """La signature sur la mise en forme directe seule (Fragment.forme), sans la cascade des
    styles. Utilisée par la passe 4 seulement (voir _passe4_retrogradation)."""
    tailles = [f.forme.get('taille') for f in fragments_non_vides
               if f.forme.get('taille') is not None]
    taille = max(tailles) if tailles else None
    def _tout_direct(cle):
        return bool(fragments_non_vides) and all(f.forme.get(cle) is True
                                                  for f in fragments_non_vides)
    polices = {f.forme.get('police') for f in fragments_non_vides if f.forme.get('police')}
    police = next(iter(polices)) if len(polices) == 1 else None
    return (taille, _tout_direct('gras'), _tout_direct('italique'), _tout_direct('souligne'),
            police, paragraphe.alignement, _casse(texte))


def _corps_signature_directe(paras, exclus):
    """La signature dominante du corps sur la mise en forme directe seule, sur les mêmes
    paragraphes que _corps_stats. Référence de la passe 4."""
    comptes = {}
    for idx, p in enumerate(paras):
        if idx in exclus or p.niveau_declare != 0:
            continue
        texte = p.texte().rstrip()
        if not texte:
            continue
        sig = _signature_directe(p, _fragments_non_vides(p), texte)
        comptes[sig] = comptes.get(sig, 0) + 1
    return max(comptes, key=comptes.get) if comptes else None


def _passe4_retrogradation(paras, exclus, corps_sig, corps_mediane):
    # Un titre est conservé sans regarder sa longueur seulement si sa signature diffère de
    # celle du corps à la fois en effectif et en direct. L'effectif seul ne suffit pas : un
    # faux titre obtenu en changeant seulement w:pStyle a la signature effective d'un vrai
    # titre. Le direct seul ne suffit pas non plus : un corps qui hérite ses 12 pt du style
    # et un faux titre qui les déclare seraient jugés différents.
    corps_sig_directe = _corps_signature_directe(paras, exclus)
    resultats = {}
    for idx, p in enumerate(paras):
        if idx in exclus or p.niveau_declare not in (1, 2, 3):
            continue
        texte = p.texte().rstrip()
        sig = _signature(p, _fragments_non_vides(p), texte)
        if corps_sig is None:
            resultats[idx] = (p.niveau_declare, 'conserve_corps_indetermine',
                'conservé titre : aucun corps de comparaison n\'a pu être établi dans ce '
                'document (aucun paragraphe candidat), le niveau déclaré fait foi par défaut')
            continue
        sig_directe = _signature_directe(p, _fragments_non_vides(p), texte)
        distinct_effectif = _signature_typographique(sig) != _signature_typographique(corps_sig)
        distinct_direct = (corps_sig_directe is None or
                           _signature_typographique(sig_directe) != _signature_typographique(corps_sig_directe))
        if distinct_effectif and distinct_direct:
            resultats[idx] = (p.niveau_declare, 'conserve_signature_distincte',
                'conservé titre : signature (%s) typographiquement distincte de celle du '
                'corps (%s)' % (_texte_signature(sig), _texte_signature(corps_sig)))
            continue
        # Signature identique à celle du corps, ou distincte seulement par la cascade de
        # style : la longueur décide, par rapport au corps de ce document.
        if distinct_effectif:
            qualif = ('distincte SEULEMENT par la cascade de style — aucun réglage direct ne '
                      'la démarque du corps (%s)' % _texte_signature(sig))
        else:
            qualif = 'typographiquement identique à celle du corps'
        court = (corps_mediane is not None
                 and len(texte) * RATIO_RETROGRADATION_MIN <= corps_mediane)
        if court:
            resultats[idx] = (p.niveau_declare, 'conserve_signature_corps_mais_court',
                'conservé titre : signature (%s) %s, mais sa longueur (%d signes, %d mots) '
                'reste dans celle d\'un titre de ce document (corps médian %s signes) — la '
                'mise en forme directe ne distingue rien ici, la longueur si'
                % (_texte_signature(sig), qualif, len(texte), len(_mots(texte)), corps_mediane))
        else:
            resultats[idx] = (0, 'retrogradee_signature_corps',
                'rétrogradé au corps : signature (%s) %s de ce document, ET longueur (%d '
                'signes, %d mots) qui ne tient plus dans celle d\'un titre de ce document '
                '(corps médian %s signes)'
                % (_texte_signature(sig), qualif, len(texte), len(_mots(texte)), corps_mediane))
    return resultats


# ---------------------------------------------------------------------------------
# Passe 3 bis : adoption. Les titres déclarés d'un niveau donnent la signature de référence
# de ce niveau ; un paragraphe non stylé qui a cette signature est adopté à ce niveau. Cas
# typique : cinq titres stylés, le sixième seulement mis en italique et agrandi.
#
# L'ordre compte : rétrograder d'abord (passe 4), puis calculer la référence sur les seuls
# titres conservés, puis adopter. Si un style de titre est posé sur des paragraphes de corps,
# la référence calculée avant rétrogradation serait celle du corps, et tout l'article serait
# adopté comme titre.
#
# Deux conditions pour qu'une référence existe :
#   - elle est majoritaire parmi les titres conservés de son niveau (plus de la moitié) ;
#   - elle diffère de la signature du corps.
#
# La comparaison se fait sur la signature typographique, sans l'alignement (voir
# _signature_typographique).

def _passe3bis_adoption(paras, exclus, resultats_p4, corps_sig):
    """(adoptions, references) — `adoptions` : idx (candidat non déclaré) -> (niveau, sig,
    effectif, total) ; `references` : niveau -> (sig, effectif, total) pour la trace, même
    quand aucun candidat ne correspond. Les références viennent des seuls titres conservés
    par la passe 4 (resultats_p4[idx][0] > 0)."""
    survivants_par_niveau = {1: [], 2: [], 3: []}
    for idx, p in enumerate(paras):
        info = resultats_p4.get(idx)
        if info is None or info[0] <= 0:
            continue
        texte = p.texte().rstrip()
        sig = _signature(p, _fragments_non_vides(p), texte)
        survivants_par_niveau[info[0]].append(sig)

    corps_typo = _signature_typographique(corps_sig) if corps_sig is not None else None
    references = {}
    for niveau, sigs in survivants_par_niveau.items():
        if not sigs:
            continue
        comptes = {}
        for s in sigs:
            cle = _signature_typographique(s)
            comptes[cle] = comptes.get(cle, 0) + 1
        cle_dominante = max(comptes, key=comptes.get)
        effectif, total = comptes[cle_dominante], len(sigs)
        majoritaire = effectif * 2 > total
        distincte_du_corps = (corps_typo is None) or (cle_dominante != corps_typo)
        if majoritaire and distincte_du_corps:
            references[niveau] = (cle_dominante, effectif, total)

    adoptions = {}
    if references:
        for idx, p in enumerate(paras):
            if idx in exclus or p.niveau_declare != 0:
                continue
            texte = p.texte().rstrip()
            if not texte:
                continue
            sig = _signature(p, _fragments_non_vides(p), texte)
            cle = _signature_typographique(sig)
            for niveau, (cle_ref, effectif, total) in references.items():
                if cle == cle_ref:
                    adoptions[idx] = (niveau, sig, effectif, total)
                    break
    return adoptions, references


# ---------------------------------------------------------------------------------
# Passe 3 : regroupement par signature, jamais un paragraphe seul. Un groupe devient un
# niveau de titre si sa signature diffère de celle du corps, si ses paragraphes sont courts
# par rapport au corps, répartis dans le document et de longueurs homogènes. L'ordre des
# groupes donne les niveaux : taille décroissante, puis gras, puis italique (des titres de
# niveau 2 peuvent n'être distingués que par l'italique).

def _grouper_candidats(paras, exclus, niveaux_a_chercher, corps_sig, corps_mediane,
                        deja_adoptes=frozenset()):
    """{signature: [idx, ...]} des paragraphes candidats à la promotion (non déclarés titre,
    non exclus, non déjà adoptés) dont la signature diffère du corps et qui sont courts par
    rapport au corps. Dispersion et homogénéité demandent le groupe complet : voir
    _filtrer_groupes(). Rend {} si la passe 2 n'autorise aucun niveau ou si le corps n'a pas
    pu être caractérisé."""
    groupes = {}
    if not niveaux_a_chercher or corps_sig is None or not corps_mediane:
        return groupes
    for idx, p in enumerate(paras):
        if idx in exclus or idx in deja_adoptes or p.niveau_declare != 0:
            continue
        texte = p.texte().rstrip()
        if not texte:
            continue
        sig = _signature(p, _fragments_non_vides(p), texte)
        if sig == corps_sig:
            continue
        if len(texte) * RATIO_LONGUEUR_TITRE > corps_mediane:
            continue
        groupes.setdefault(sig, []).append(idx)
    return groupes


def _filtrer_groupes(groupes, paras):
    """Garde les groupes dont les occurrences sont réparties (pas toutes consécutives, à
    partir de SEUIL_DISPERSION_MIN occurrences) et de longueurs homogènes (le plus long ne
    dépasse pas SEUIL_HOMOGENEITE_MOTS fois le plus court, ce dernier compté au moins
    PLANCHER_HOMOGENEITE_MOTS)."""
    qualifies = {}
    for sig, indices in groupes.items():
        mots = [len(_mots(paras[i].texte().rstrip())) for i in indices]
        mn, mx = min(mots), max(mots)
        if mx > SEUIL_HOMOGENEITE_MOTS * max(mn, PLANCHER_HOMOGENEITE_MOTS):
            continue
        if len(indices) >= SEUIL_DISPERSION_MIN:
            tries = sorted(indices)
            if tries[-1] - tries[0] + 1 == len(tries):
                continue  # tous consécutifs : pas répartis
        qualifies[sig] = sorted(indices)
    return qualifies


def _ordonner_groupes(groupes_qualifies):
    """Trie les groupes qualifiés : taille décroissante (None compte comme 0), puis le gras,
    puis l'italique."""
    def cle(sig):
        taille, gras, italique, souligne, police, alignement, casse = sig
        return (-(taille or 0), 0 if gras else 1, 0 if italique else 1)
    return sorted(groupes_qualifies.items(), key=lambda kv: cle(kv[0]))


def classer_titres(document):
    """Remplit `niveau_retenu` sur chaque Paragraphe de premier niveau de `document`, en
    place. Rend (stats, trace) : `stats` un résumé chiffré, `trace` une ligne par paragraphe,
    lisible par la rédaction, avec signature et chiffres."""
    trace = []
    paras = _paragraphes_premier_niveau(document)
    total = len(paras)

    # Passe 1 : exclusions.
    exclus = _exclusions_passe1(document, paras)

    # Passe 2 : l'état déclaré décide des niveaux que la passe 3 peut chercher.
    niveaux_a_chercher, total_declares, niveaux_utilises, motif_etat = _etat_declare(paras, exclus)
    trace.append({'portee': 'document', 'source': None, 'style': '',
                  'decision': 'etat_declare', 'motif': motif_etat})

    # Référence des passes 3 et 4 : signature et longueur dominantes du corps de ce document.
    corps_sig, corps_mediane = _corps_stats(paras, exclus)

    # Titres en liste numérotée. Ces paragraphes ont niveau_declare == 0 et ne sont donc pas
    # touchés par la passe 4. Leur trace est ajoutée plus bas, dans l'ordre du document.
    assignation_liste = _detecter_titres_liste(paras, exclus, corps_sig)

    # Passe 4 : rétrogradation. Calculée avant la passe 3 pour que la contrainte globale
    # porte sur le total réel des titres retenus.
    resultats_p4 = _passe4_retrogradation(paras, exclus, corps_sig, corps_mediane)

    # Passe 3 bis : adoption, sur les titres conservés par la passe 4 (voir
    # _passe3bis_adoption pour l'ordre).
    adoptions, references_adoption = _passe3bis_adoption(paras, exclus, resultats_p4, corps_sig)
    for niveau in sorted(references_adoption):
        cle_ref, effectif, total_niveau = references_adoption[niveau]
        taille, gras, italique, souligne, police, casse = cle_ref
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'reference_adoption',
                      'motif': ('niveau %d : référence adoptée sur %d/%d titres déclarés '
                               'survivants (%s), %d candidat(s) non stylé(s) adopté(s) à ce '
                               'niveau' % (niveau, effectif, total_niveau,
                                           _texte_signature((taille, gras, italique, souligne,
                                                             police, '', casse)),
                                           sum(1 for (n, *_r) in adoptions.values() if n == niveau)))})

    # Passe 3 : regroupement par signature, aux niveaux autorisés par la passe 2, sans les
    # paragraphes déjà adoptés ou promus depuis une liste numérotée.
    groupes_bruts = _grouper_candidats(paras, exclus, niveaux_a_chercher, corps_sig,
                                        corps_mediane,
                                        deja_adoptes=set(adoptions) | set(assignation_liste))
    groupes_qualifies = _filtrer_groupes(groupes_bruts, paras)
    groupes_ordonnes = _ordonner_groupes(groupes_qualifies)
    niveaux_disponibles = sorted(niveaux_a_chercher)

    # Au-delà de MAX_NIVEAUX groupes qualifiés, les groupes en trop sont rabattus sur le
    # niveau 3 s'il est autorisé, plutôt que rejetés : un glossaire ou un dossier à rubriques
    # peut avoir plus de trois mises en forme de titre. Les trois premiers groupes dans
    # l'ordre de _ordonner_groupes gardent leur niveau.
    groupes_rabattus = set()
    if len(groupes_ordonnes) > MAX_NIVEAUX and 3 in niveaux_a_chercher:
        groupes_a_niveau, groupes_a_rabattre = (groupes_ordonnes[:MAX_NIVEAUX],
                                                 groupes_ordonnes[MAX_NIVEAUX:])
    else:
        groupes_a_niveau, groupes_a_rabattre = groupes_ordonnes, []

    assignation_p3 = {}   # idx -> (niveau, signature)
    groupes_retenus, groupes_ecartes_faute_de_niveau = [], []
    for i, (sig, indices) in enumerate(groupes_a_niveau):
        if i < len(niveaux_disponibles):
            niveau = niveaux_disponibles[i]
            groupes_retenus.append((sig, indices, niveau))
            for idx in indices:
                assignation_p3[idx] = (niveau, sig)
        else:
            groupes_ecartes_faute_de_niveau.append((sig, indices))
    for sig, indices in groupes_a_rabattre:
        groupes_retenus.append((sig, indices, 3))
        groupes_rabattus.add(sig)
        for idx in indices:
            assignation_p3[idx] = (3, sig)

    if groupes_rabattus:
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'groupes_rabattus_niveau3',
                      'motif': ('%d groupe(s) qualifiant(s) au-delà des %d niveaux des lignes '
                               'directrices : rabattus sur le niveau 3 plutôt que rejetés — '
                               'vérifiez qu\'il ne s\'agit pas d\'un glossaire ou d\'un dossier '
                               'à rubriques' % (len(groupes_rabattus), MAX_NIVEAUX))})

    # Contrainte globale. Dépasser MAX_TITRES ne rejette rien : c'est un signal dans le
    # rapport (plus bas). Un entretien aux questions en gras peut ainsi avoir ses questions
    # promues en titres, ce qui vaut mieux qu'aucun titre. Seul le plafond de MAX_NIVEAUX
    # niveaux est une contrainte dure. Il ne peut pas être dépassé aujourd'hui (les niveaux
    # valent 1, 2 ou 3), mais la vérification reste au cas où le modèle changerait.
    n_conserves_p4 = sum(1 for (niveau, _d, _m) in resultats_p4.values() if niveau > 0)
    n_promus_tentes = sum(len(indices) for (_s, indices, _n) in groupes_retenus)
    niveaux_finaux = {niveau for (niveau, _d, _m) in resultats_p4.values() if niveau > 0}
    niveaux_finaux |= {niveau for (_s, _i, niveau) in groupes_retenus}
    niveaux_finaux |= {niveau for (niveau, *_r) in adoptions.values()}
    rejet_contrainte = len(niveaux_finaux) > MAX_NIVEAUX

    if rejet_contrainte and groupes_retenus:
        motif = ('contrainte de niveaux dépassée : %d niveau(x) de titre au total (%d '
                 'déclaré(s) conservé(s) + %d promu(s) tenté(s)), au-delà des %d niveaux des '
                 'lignes directrices — la promotion de cette passe 3 est intégralement '
                 'rejetée (la rétrogradation de la passe 4, elle, s\'applique quand même)'
                 % (len(niveaux_finaux), n_conserves_p4, n_promus_tentes, MAX_NIVEAUX))
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'promotion_rejetee_contrainte_niveaux', 'motif': motif})
        groupes_ecartes_faute_de_niveau = groupes_retenus + groupes_ecartes_faute_de_niveau
        groupes_retenus = []
        assignation_p3 = {}

    # Compté après l'éventuel rejet ci-dessus, adoptions de la passe 3 bis comprises.
    total_final = n_conserves_p4 + len(assignation_p3) + len(adoptions) + len(assignation_liste)
    if total_final > MAX_TITRES:
        # Un signal pour la rédaction, pas un rejet.
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'signal_nombre_titres_inhabituel',
                      'motif': ('%d titre(s) retenu(s), bien au-delà de ce qu\'on observe '
                               'habituellement (médiane %d, maximum %d sur les 36 articles '
                               'stylés du corpus de référence) — vérifiez qu\'il ne s\'agit '
                               'pas d\'un entretien ou d\'un glossaire'
                               % (total_final, MEDIANE_TITRES_CORPUS, MAX_TITRES))})
    if not rejet_contrainte and not groupes_retenus and niveaux_a_chercher and groupes_bruts:
        # En cas de doute, rien n'est promu et la trace le dit : des candidats existaient,
        # aucun groupe n'a rempli les critères.
        n_examines = sum(len(v) for v in groupes_bruts.values())
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'aucune_promotion_decelee',
                      'motif': ('aucune structure de titres décelable : %d candidat(s) '
                               'examiné(s) en %d groupe(s) de signature, aucun ne réunit '
                               'longueurs homogènes et répartition dans le document'
                               % (n_examines, len(groupes_bruts)))})

    # Trace des groupes examinés, retenus ou non (« groupe : italique, 11 pt, 3 à 8 mots,
    # 9 occurrences réparties → niveau 2 »).
    for sig, indices, niveau in groupes_retenus:
        mots = [len(_mots(paras[i].texte().rstrip())) for i in indices]
        rabattu = ' (rabattu, plafond de %d groupes dépassé)' % MAX_NIVEAUX if sig in groupes_rabattus else ''
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'groupe_promu',
                      'motif': 'groupe : %s, %d à %d mots, %d occurrence(s) réparties → '
                               'niveau %d%s' % (_texte_signature(sig), min(mots), max(mots),
                                                len(indices), niveau, rabattu)})
    for sig, indices in groupes_ecartes_faute_de_niveau:
        mots = [len(_mots(paras[i].texte().rstrip())) for i in indices]
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'groupe_non_retenu',
                      'motif': 'groupe qualifiant mais écarté : %s, %d à %d mots, %d '
                               'occurrence(s) — aucun niveau disponible dans %s'
                               % (_texte_signature(sig), min(mots), max(mots), len(indices),
                                  sorted(niveaux_a_chercher) or '(aucun)')})

    # Assemblage final : une ligne de trace par paragraphe, dans l'ordre du document.
    n_promus = n_retrogrades = n_conserves_declares = n_non_promus = n_exclus = n_adoptes = 0
    n_promus_liste = 0
    stats_exclus = {}
    for idx, p in enumerate(paras):
        if idx in assignation_liste:
            # Titre en liste numérotée. Testé avant `idx in exclus`, où il figure sous
            # 'liste'. La liste est retirée (le gabarit numérote les Titre1), ainsi que le
            # numéro manuel de tête.
            niveau, motif, prefixe = assignation_liste[idx]
            p.niveau_retenu = niveau
            p.liste = None
            if prefixe and p.fragments and p.fragments[0].texte.startswith(prefixe):
                p.fragments[0].texte = p.fragments[0].texte[len(prefixe):]
            n_promus_liste += 1
            trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                          'decision': 'promue_liste', 'niveau_declare': 0,
                          'niveau_retenu': niveau, 'motif': motif})
        elif idx in exclus:
            categorie, raison = exclus[idx]
            p.niveau_retenu = 0
            n_exclus += 1
            stats_exclus[categorie] = stats_exclus.get(categorie, 0) + 1
            trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                          'decision': 'exclu_' + categorie,
                          'niveau_declare': p.niveau_declare, 'niveau_retenu': 0,
                          'motif': 'jamais un titre par déduction : ' + raison})
        elif idx in resultats_p4:
            niveau, decision, motif = resultats_p4[idx]
            p.niveau_retenu = niveau
            if decision == 'retrogradee_signature_corps':
                n_retrogrades += 1
            else:
                n_conserves_declares += 1
            trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                          'decision': decision, 'niveau_declare': p.niveau_declare,
                          'niveau_retenu': niveau, 'motif': motif})
        elif idx in adoptions:
            niveau, sig, effectif, total_niveau = adoptions[idx]
            p.niveau_retenu = niveau
            n_adoptes += 1
            texte = p.texte().rstrip()
            trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                          'decision': 'adoptee', 'niveau_declare': 0, 'niveau_retenu': niveau,
                          'motif': 'adopté titre (niveau %d) : signature (%s) de %d/%d titres '
                                   'déclarés survivants de ce niveau, %d mot(s)'
                                   % (niveau, _texte_signature(sig), effectif, total_niveau,
                                      len(_mots(texte)))})
        elif idx in assignation_p3:
            niveau, sig = assignation_p3[idx]
            p.niveau_retenu = niveau
            n_promus += 1
            texte = p.texte().rstrip()
            trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                          'decision': 'promue', 'niveau_declare': 0, 'niveau_retenu': niveau,
                          'motif': 'promu titre (niveau %d) : groupe %s, %d mot(s)'
                                   % (niveau, _texte_signature(sig), len(_mots(texte)))})
        else:
            p.niveau_retenu = 0
            n_non_promus += 1
            trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                          'decision': 'non_promue', 'niveau_declare': p.niveau_declare,
                          'niveau_retenu': 0,
                          'motif': 'conservé au corps : aucun groupe qualifiant ne le '
                                   'retient (signature égale au corps, trop long relativement '
                                   'au corps, ou groupe écarté)'})

    stats = {'total_paragraphes': total, 'total_declares': total_declares,
              'niveaux_utilises': sorted(niveaux_utilises),
              'niveaux_recherches': sorted(niveaux_a_chercher),
              'promus': n_promus, 'adoptes': n_adoptes, 'retrogrades': n_retrogrades,
              'conserves_declares': n_conserves_declares, 'non_promus': n_non_promus,
              'exclus': n_exclus, 'exclus_par_categorie': stats_exclus,
              'promus_liste': n_promus_liste,
              'total_titres_retenus': total_final,
              'rejet_contrainte_niveaux': bool(rejet_contrainte),
              'groupes_rabattus_niveau3': len(groupes_rabattus),
              'signal_nombre_inhabituel': bool(total_final > MAX_TITRES),
              'styles_exclus': []}
    return stats, trace


def titres_du_plan(document):
    """Après classer_titres() (ou le cas A), sur les paragraphes de premier niveau. Rend
    (n_promus, n_numeros_retires, trace).

    La numérotation d'un titre Word (« 1 », « 1.1 ») vient de son style, et le lecteur la lit
    comme une liste (_liste_depuis remonte le numPr hérité). Un titre retenu perd sa liste,
    sinon l'écrivain poserait une liste « 1. », « 2. » à la place de la numérotation du
    gabarit.

    Un paragraphe de corps numéroté par la même liste que les titres déclarés est un titre
    dont le style n'a pas été posé. Il prend le niveau que ce cran de liste a chez les titres
    déclarés, à défaut le cran + 1, au plus 3."""
    paras = _paragraphes_premier_niveau(document)
    niveau_par_cran = {}
    for p in paras:
        if p.niveau_declare in (1, 2, 3) and p.liste is not None:
            niveau_par_cran.setdefault((p.liste[0], p.liste[1]), p.niveau_declare)
    listes_du_plan = {numid for (numid, _ilvl) in niveau_par_cran}
    trace = []
    n_promus = n_retires = 0
    for p in paras:
        if p.liste is None:
            continue
        if p.niveau_retenu == 0 and p.liste[0] in listes_du_plan:
            cran = p.liste[1] or 0
            niveau = min(niveau_par_cran.get((p.liste[0], cran), cran + 1), MAX_NIVEAUX)
            p.niveau_retenu = niveau
            n_promus += 1
            trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                          'decision': 'promue_plan', 'niveau_declare': p.niveau_declare,
                          'niveau_retenu': niveau,
                          'motif': 'promu titre (niveau %d) : numéroté par la liste des titres '
                                   'déclarés (numId %s, cran %d)' % (niveau, p.liste[0], cran)})
        elif p.niveau_retenu == 0:
            continue
        else:
            n_retires += 1
        p.liste = None
    return n_promus, n_retires, trace


# ---------------------------------------------------------------------------------
# Nettoyage de la mise en forme manuelle. Italique, exposant, indice et liens sont conservés.
# Le barré est retiré comme la police, la taille ou la couleur : il n'a pas sa place dans un
# article publié.
FORME_RETIREE_TOUJOURS = ('police', 'taille', 'couleur', 'surlignage', 'petites_capitales',
                           'majuscules', 'barre')
# Gras et souligné ne sont retirés que du corps (niveau_retenu == 0) : un titre garde son gras.
FORME_RETIREE_CORPS_SEUL = ('gras', 'souligne')


def _paragraphe_vide(paragraphe):
    for f in paragraphe.fragments:
        if f.texte or f.image is not None:
            return False
    return True


def _images_seules(bloc):
    """Un paragraphe qui ne porte que des images ; même définition que
    manuscrit_gabarit._images_seules()."""
    return (isinstance(bloc, Paragraphe)
            and any(f.image is not None for f in bloc.fragments)
            and not any(f.texte.strip() for f in bloc.fragments if f.image is None))


def _nettoyer_fragments(paragraphe, est_corps):
    """Modifie chaque Fragment.forme en place ; rend les clés retirées (pour le motif) et les
    signalements (gras intégral, majuscules intégrales), évalués sur la forme d'origine,
    avant tout retrait.

    Un paragraphe de corps entièrement gras est signalé et garde son gras, pour que la
    rédaction le voie ; le gras partiel est retiré. Les majuscules forcées sont retirées dans
    tous les cas."""
    fragments_non_vides = _fragments_non_vides(paragraphe)
    signalements = []
    gras_integral = False
    if fragments_non_vides and est_corps:
        gras_integral = all(f.forme.get('gras') is True for f in fragments_non_vides)
        if gras_integral:
            signalements.append('gras intégral')
        if all(f.forme.get('majuscules') is True for f in fragments_non_vides):
            signalements.append('majuscules intégrales')

    champs_corps_seul = (FORME_RETIREE_CORPS_SEUL if not gras_integral
                          else tuple(c for c in FORME_RETIREE_CORPS_SEUL if c != 'gras'))

    champs_retires = set()
    for f in paragraphe.fragments:
        for cle in FORME_RETIREE_TOUJOURS:
            if f.forme.get(cle) is not None:
                champs_retires.add(cle)
            f.forme[cle] = None
        if est_corps:
            for cle in champs_corps_seul:
                if f.forme.get(cle) is not None:
                    champs_retires.add(cle)
                f.forme[cle] = None
    return champs_retires, signalements


def _nettoyer_paragraphe(paragraphe, source_tableau=None):
    """`source_tableau` : `.source` du Tableau qui porte ce paragraphe (None au premier
    niveau). Un paragraphe de cellule a un `.source` local à sa cellule (0, 1, …), ambigu
    dans la trace : celle-ci porte donc le `.source` du tableau, avec `dans_tableau=True`."""
    est_corps = (paragraphe.niveau_retenu == 0)
    champs_retires, signalements = _nettoyer_fragments(paragraphe, est_corps)

    alignement_retire = paragraphe.alignement != ''
    retrait_retire = bool(paragraphe.retrait)
    paragraphe.alignement = ''
    paragraphe.retrait = 0

    saut_retire = False
    tab_retire = False
    if paragraphe.fragments:
        dernier = paragraphe.fragments[-1]
        if dernier.texte.endswith('\n'):
            dernier.texte = dernier.texte.rstrip('\n')
            saut_retire = True
        premier = paragraphe.fragments[0]
        if premier.texte.startswith('\t'):
            premier.texte = premier.texte.lstrip('\t')
            tab_retire = True

    if signalements:
        motif_fr = ('Un paragraphe de cette taille (« %s ») n\'a pas été retenu comme '
                    'titre. Vérifiez si ce n\'est pas un intertitre manqué.'
                    % ' et '.join(signalements))
        motif_de = ('Ein Absatz mit dieser Formatierung (« %s ») wurde nicht als Titel '
                    'erkannt. Prüfen Sie, ob es sich nicht um eine übersehene '
                    'Zwischenüberschrift handelt.' % ' und '.join(signalements))
        avertir('mise-en-forme-suspecte', ['paragraphe %r' % paragraphe.source] + signalements,
                motif_fr, motif_de)

    motif_parts = []
    if champs_retires:
        motif_parts.append('mise en forme manuelle retirée (%s)' % ', '.join(sorted(champs_retires)))
    if alignement_retire or retrait_retire:
        motif_parts.append('alignement/retrait manuels retirés')
    if saut_retire:
        motif_parts.append('saut de ligne manuel en fin de paragraphe retiré')
    if tab_retire:
        motif_parts.append("tabulation d'indentation en tête retirée")
    a_change = bool(motif_parts)
    if signalements:
        motif_parts.append('signalé sans être touché : %s, non retenu comme titre'
                            % ' et '.join(signalements))
    if not motif_parts:
        motif_parts.append('rien à nettoyer')

    source = source_tableau if source_tableau is not None else paragraphe.source
    return a_change, {'portee': 'paragraphe', 'source': source, 'dans_tableau': source_tableau is not None,
                       'decision': 'nettoye' if a_change else 'inchange',
                       'signalements': signalements, 'motif': '; '.join(motif_parts)}


def _paragraphes_en_profondeur(blocs, source_tableau=None):
    """Chaque (Paragraphe, source_tableau) atteignable depuis `blocs` (Paragraphe | Tableau), à
    toute profondeur de cellule, sans les Tableau eux-mêmes. `source_tableau` est le
    `.source` du tableau le plus proche qui contient la cellule, None au premier niveau.
    classer_titres() utilise _paragraphes_premier_niveau() : un paragraphe de cellule ne
    devient pas un titre."""
    for b in blocs:
        if isinstance(b, Tableau):
            for rangee in b.rangees:
                for c in rangee:
                    yield from _paragraphes_en_profondeur(c.blocs, b.source)
        else:
            yield b, source_tableau


def nettoyer_mise_en_forme(document):
    """Nettoie la mise en forme de chaque Paragraphe de `document` : premier niveau, cellules
    de tableau à toute profondeur et notes (document.notes). Modifie en place les formes,
    l'alignement et le retrait, et, au premier niveau seulement, fusionne les paragraphes
    vides consécutifs. Suppose `classer_titres()` déjà passé : le retrait du gras dépend de
    `niveau_retenu` (0 pour une cellule ou une note). Rend (stats, trace)."""
    trace = []
    n_vides_retires = 0

    blocs = document.blocs
    nouveaux_blocs = []
    i, n = 0, len(blocs)
    while i < n:
        bloc = blocs[i]
        if isinstance(bloc, Paragraphe) and _paragraphe_vide(bloc):
            nouveaux_blocs.append(bloc)
            j = i + 1
            while j < n and isinstance(blocs[j], Paragraphe) and _paragraphe_vide(blocs[j]):
                j += 1
            # Entre deux paragraphes d'images, le nombre de vides compte : jusqu'à
            # pronto_modele.MAX_VIDES_ENTRE_IMAGES, les deux images forment une même figure ;
            # au-delà, deux figures. On garde donc un vide de plus que ce plafond, pour que
            # manuscrit_gabarit._regrouper_blocs voie la coupure ; l'écriture ramène ensuite
            # les vides consécutifs à un seul.
            garder = 1
            if (j - i > pronto_modele.MAX_VIDES_ENTRE_IMAGES and nouveaux_blocs[:-1]
                    and _images_seules(nouveaux_blocs[-2]) and j < n
                    and _images_seules(blocs[j])):
                garder = pronto_modele.MAX_VIDES_ENTRE_IMAGES + 1
            nouveaux_blocs.extend(blocs[i + 1:i + garder])
            sources_retirees = [b.source for b in blocs[i + garder:j]]
            if sources_retirees:
                n_vides_retires += len(sources_retirees)
                trace.append({'portee': 'document', 'source': bloc.source,
                              'decision': 'paragraphes_vides_fusionnes',
                              'motif': '%d paragraphe(s) vide(s) consécutif(s) retiré(s) '
                                       'après le paragraphe %r (sources %r)'
                                       % (len(sources_retirees), bloc.source, sources_retirees)})
            i = j
        else:
            nouveaux_blocs.append(bloc)
            i += 1
    document.blocs = nouveaux_blocs

    n_nettoyes = n_inchanges = n_signalements = 0
    paragraphes_a_nettoyer = list(_paragraphes_en_profondeur(document.blocs))
    for blocs_note in document.notes.values():
        paragraphes_a_nettoyer.extend(_paragraphes_en_profondeur(blocs_note))
    for bloc, source_tableau in paragraphes_a_nettoyer:
        a_change, ligne = _nettoyer_paragraphe(bloc, source_tableau)
        if a_change:
            n_nettoyes += 1
        else:
            n_inchanges += 1
        if ligne['signalements']:
            n_signalements += 1
        trace.append(ligne)

    stats = {'paragraphes_nettoyes': n_nettoyes, 'paragraphes_inchanges': n_inchanges,
              'paragraphes_vides_retires': n_vides_retires, 'signalements': n_signalements}
    return stats, trace


# ---------------------------------------------------------------------------------
# Lecture du JSON décrit en tête de fichier. Une construction non reconnue est ignorée, comme
# dans lire_yaml() de szh_commun.

def image_depuis_json(obj):
    octets = b''
    b64 = obj.get('octets_base64')
    if b64:
        try:
            octets = base64.b64decode(b64)
        except Exception:
            octets = b''
    return Image(nom=obj.get('nom', ''), octets=octets, surface=obj.get('surface', 0) or 0,
                 alt=obj.get('alt', ''), flottante=bool(obj.get('flottante')),
                 source=obj.get('source'), cx=obj.get('cx', 0) or 0, cy=obj.get('cy', 0) or 0,
                 largeur_px=obj.get('largeur_px', 0) or 0,
                 hauteur_px=obj.get('hauteur_px', 0) or 0)


def fragment_depuis_json(obj):
    image = image_depuis_json(obj['image']) if obj.get('image') else None
    forme = nouvelle_forme(**(obj.get('forme') or {}))
    effectif = nouvelle_forme(**(obj.get('effectif') or {}))
    return Fragment(texte=obj.get('texte', ''), image=image, forme=forme,
                     lien=obj.get('lien'), source=obj.get('source'), note=obj.get('note'),
                     effectif=effectif)


def paragraphe_depuis_json(obj):
    fragments = [fragment_depuis_json(f) for f in (obj.get('fragments') or [])]
    liste = obj.get('liste')
    return Paragraphe(style=obj.get('style', ''),
                       niveau_declare=obj.get('niveau_declare', 0) or 0,
                       niveau_retenu=obj.get('niveau_retenu', 0) or 0,
                       fragments=fragments,
                       liste=tuple(liste) if liste is not None else None,
                       alignement=obj.get('alignement', ''),
                       retrait=obj.get('retrait', 0) or 0,
                       source=obj.get('source'),
                       alignement_effectif=obj.get('alignement_effectif', ''))


def cellule_depuis_json(obj):
    blocs = [bloc_depuis_json(b) for b in (obj.get('blocs') or [])]
    return Cellule(colspan=obj.get('colspan', 1) or 1, rowspan=obj.get('rowspan', 1) or 1,
                    entete=bool(obj.get('entete')), blocs=blocs)


def tableau_depuis_json(obj):
    rangees = [[cellule_depuis_json(c) for c in rangee]
               for rangee in (obj.get('rangees') or [])]
    return Tableau(rangees=rangees, page=obj.get('page'), source=obj.get('source'))


def bloc_depuis_json(obj):
    return tableau_depuis_json(obj) if obj.get('type') == 'tableau' else paragraphe_depuis_json(obj)


def document_depuis_json(obj):
    """`notes` : dict[int, list[bloc]] ; les clés JSON sont des chaînes, converties en int.
    Une clé non entière est ignorée. Une liste plate est acceptée, ses notes regroupées sous
    la clé 0."""
    blocs = [bloc_depuis_json(b) for b in (obj.get('blocs') or [])]
    notes_brutes = obj.get('notes')
    notes = {}
    if isinstance(notes_brutes, dict):
        for cle, valeur in notes_brutes.items():
            try:
                id_note = int(cle)
            except (TypeError, ValueError):
                continue
            notes[id_note] = [bloc_depuis_json(b) for b in (valeur or [])]
    elif isinstance(notes_brutes, list) and notes_brutes:
        notes[0] = [bloc_depuis_json(b) for b in notes_brutes]
    return Document(blocs=blocs, styles=list(obj.get('styles') or []),
                     langue=obj.get('langue', ''), revisions=obj.get('revisions', 0) or 0,
                     commentaires=obj.get('commentaires', 0) or 0, notes=notes,
                     source=obj.get('source'), cle_gabarit=obj.get('cle_gabarit'))


# ---------------------------------------------------------------------------------
# Écriture en JSON : le mode --diagnostic rend l'état du document après traitement, pour que
# les tests vérifient ce qui a réellement survécu (italique, exposant, indice, liens). Les
# octets des images ne sont pas renvoyés, seulement leur nombre.

def image_vers_json(image):
    return {'nom': image.nom, 'octets_taille': len(image.octets), 'surface': image.surface,
            'cx': image.cx, 'cy': image.cy, 'largeur_px': image.largeur_px,
            'hauteur_px': image.hauteur_px, 'alt': image.alt, 'flottante': image.flottante,
            'source': image.source}


def fragment_vers_json(fragment):
    return {'texte': fragment.texte,
            'image': image_vers_json(fragment.image) if fragment.image is not None else None,
            'forme': dict(fragment.forme), 'effectif': dict(fragment.effectif),
            'lien': fragment.lien, 'source': fragment.source, 'note': fragment.note}


def paragraphe_vers_json(paragraphe):
    return {'type': 'paragraphe', 'style': paragraphe.style,
            'niveau_declare': paragraphe.niveau_declare,
            'niveau_retenu': paragraphe.niveau_retenu,
            'fragments': [fragment_vers_json(f) for f in paragraphe.fragments],
            'liste': list(paragraphe.liste) if paragraphe.liste is not None else None,
            'alignement': paragraphe.alignement, 'retrait': paragraphe.retrait,
            'source': paragraphe.source,
            'alignement_effectif': paragraphe.alignement_effectif}


def cellule_vers_json(cellule):
    return {'colspan': cellule.colspan, 'rowspan': cellule.rowspan, 'entete': cellule.entete,
            'blocs': [bloc_vers_json(b) for b in cellule.blocs]}


def tableau_vers_json(tableau):
    return {'type': 'tableau', 'page': tableau.page, 'source': tableau.source,
            'rangees': [[cellule_vers_json(c) for c in rangee] for rangee in tableau.rangees]}


def bloc_vers_json(bloc):
    return tableau_vers_json(bloc) if isinstance(bloc, Tableau) else paragraphe_vers_json(bloc)


def document_vers_json(document):
    # Les clés de `notes` deviennent des chaînes, seules admises en JSON.
    obj = {'styles': list(document.styles), 'langue': document.langue,
           'revisions': document.revisions, 'commentaires': document.commentaires,
           'notes': {str(id_note): [bloc_vers_json(b) for b in blocs]
                     for id_note, blocs in document.notes.items()},
           'blocs': [bloc_vers_json(b) for b in document.blocs], 'source': document.source}
    if document.cle_gabarit is not None:
        obj['cle_gabarit'] = document.cle_gabarit
    return obj


# ---------------------------------------------------------------------------------
# Mode diagnostic, sur le modèle de la CLI de docx-titres.py : lit un Document JSON sur stdin
# et rend les décisions et l'état final. Il permet de tester ce module sans fichier Word.

def principal(argv):
    if '--diagnostic' not in argv[1:]:
        print('usage : manuscrit_modele.py --diagnostic   (Document JSON sur stdin)',
              file=sys.stderr)
        return 2

    try:
        sys.stdin.reconfigure(encoding='utf-8')
        # stderr aussi : le message d'erreur ci-dessous peut porter un accent combinant, sur
        # lequel une console Windows en cp1252 plante.
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    try:
        donnees = json.loads(sys.stdin.read())
    except Exception as e:
        print('[manuscrit_modele] JSON d\'entrée illisible : %s' % e, file=sys.stderr)
        return 1

    document = document_depuis_json(donnees)
    gabarit = reconnaitre_gabarit(document)
    dominante = taille_dominante(document)
    stats_titres, trace_titres = classer_titres(document)
    stats_formatage, trace_formatage = nettoyer_mise_en_forme(document)

    resultat = {
        'gabarit': gabarit,
        'taille_dominante': dominante,
        'titres': {'stats': stats_titres, 'trace': trace_titres},
        'formatage': {'stats': stats_formatage, 'trace': trace_formatage},
        # L'état du document après les deux passes, où les tests vérifient les champs
        # protégés (italique, exposant, indice, `lien`).
        'document': document_vers_json(document),
    }
    # ensure_ascii=True : la console Windows n'est pas forcément en UTF-8 ; les \uXXXX se
    # relisent sans perte.
    print(json.dumps(resultat, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
