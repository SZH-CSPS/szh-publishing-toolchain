#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_modele.py — le modèle riche du nettoyeur de manuscrit (article) et TOUTES les
# décisions qui le lisent : classement des titres (promotion ET rétrogradation), nettoyage
# de la mise en forme manuelle, reconnaissance du gabarit (cas A / cas B), taille dominante
# du corps. Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §3, §4, §5, §11.
#
# AUCUNE trace de Word ni d'OpenDocument ici : pas de namespace `w:`, pas de `office:». Ce
# fichier ne lit ni .docx ni .odt — il ne raisonne que sur les six classes du §4 du contrat
# (Image, Fragment, Paragraphe, Cellule, Tableau, Document), construites par les lecteurs
# (manuscrit_docx.py, manuscrit_odt.py, pas encore écrits) ou, pour ce module et ses tests,
# depuis le JSON du mode --diagnostic documenté plus bas.
#
# stdlib uniquement : pas de PyYAML, pas de python-docx, pas de jinja2 — ils ne sont pas dans
# la WSL de la flotte (§2 du contrat).
#
# ── Ce que le contrat dit et que ce module a dû corriger en le CONSTATANT, pas en le taisant ─
#
# Le §4 du contrat écrit : « texte est déjà normalisé par le lecteur (normaliser() de
# szh_commun), comme le fait déjà pronto_modele. » Mesuré (grep) : szh_commun.py ne porte
# PAS de fonction normaliser() — elle est dupliquée, identique, dans pronto_modele.py,
# docx-titres.py, docx-meta.py et docx-tables.py. Ce module importe donc normaliser() (et
# normaliser_nom_style(), NOM_STYLE_CLE, NOM_STYLE_AIDE, déjà éprouvés pour reconnaître les
# styles maison) depuis pronto_modele — qui, comme celui-ci, ne sait rien de Word ni
# d'OpenDocument, donc l'importer ne viole pas la frontière du §3. avertir() vient bien de
# szh_commun, lui, comme le contrat le dit. Voir le rapport de chantier pour le détail.
#
# ── Schéma JSON du mode --diagnostic (lu sur stdin) ─────────────────────────────────────────
#
#   {
#     "styles": ["heading 1", "heading 2", "SZH Cle", ...],   // noms de word/styles.xml
#     "langue": "fr",                                          // ou "" si non déclarée
#     "revisions": 0, "commentaires": 0,
#     "notes": {"3": [ <bloc>, ... ], "12": [ <bloc>, ... ]},   // CHANGÉ le 19.09.2026 (§4) :
#                                              // dict identifiant -> contenu, jamais plus une
#                                              // liste plate qui fondait toutes les notes
#                                              // ensemble. Notes de bas de page ET de fin
#                                              // cohabitent (une note de fin porte un
#                                              // identifiant décalé, voir manuscrit_docx.py).
#     "blocs": [ <bloc>, ... ]                                  // blocs de premier niveau, en ordre
#   }
#
#   <bloc> est soit un paragraphe, soit un tableau — distingués par "type" :
#
#   <paragraphe> = {
#     "type": "paragraphe",              // optionnel : c'est le défaut si absent
#     "style": "heading 2",              // nom humain déjà résolu, "" si aucun
#     "niveau_declare": 2,               // 1..3 si le STYLE dit titre, 0 sinon — jamais déduit
#     "fragments": [ <fragment>, ... ],
#     "liste": [numId, ilvl, format] | null,  // format : 'puce'|'numero'|'' — ajouté le
#                                              // 18.09.2026 (§5.4) ; '' = non déterminé par
#                                              // le lecteur (numbering.xml absent, ou format
#                                              // inconnu), JAMAIS deviné ici
#     "alignement": "",                  // "" = non déclaré
#     "alignement_effectif": "",         // AJOUTÉ le 19.09.2026 (§4) : direct sinon cascade
#                                          // des styles ; "" si non déclaré nulle part
#     "retrait": 0,
#     "source": 3                        // index dans le corps ; laissé au décompte si absent
#   }
#
#   <fragment> = {
#     "texte": "…",                      // "" si le fragment ne porte qu'une image OU une note
#     "image": <image> | null,
#     "forme": {                         // dict figé : les 12 clés de FORME_CLES ; une clé
#       "gras": true, "italique": false, ...  // absente vaut None (« non déclaré »),
#     },                                  // à distinguer de false (« déclaré éteint »)
#     "effectif": { ... },                // AJOUTÉ le 19.09.2026 (§4) : même forme que
#                                          // "forme", mais la mise en forme EFFECTIVEMENT
#                                          // appliquée (directe, sinon cascade des styles)
#     "lien": "https://…" | null,
#     "source": 0,
#     "note": 3 | null                    // AJOUTÉ le 19.09.2026 (§4) : identifiant de la
#                                          // note appelée par ce fragment, ou null
#   }
#
#   <image> = {"nom": "image1.png", "surface": 0, "cx": 0, "cy": 0, "largeur_px": 0,
#              "hauteur_px": 0, "alt": "", "flottante": false, "octets_base64": "…"}
#              // cx/cy : la boîte d'affichage EMU, séparément (leur produit vaut `surface`).
#              // largeur_px/hauteur_px : dimensions du FICHIER en pixels, lues par le lecteur
#              // dans ses octets — 0 si non fourni ici (mode diagnostic ne relit aucun octet).
#              // octets_base64 optionnel ; "" par défaut en mode diagnostic, ce module
#              // n'écrivant jamais de .docx
#
#   <tableau> = {"type": "tableau", "page": null, "source": 5,
#                "rangees": [ [ <cellule>, ... ], ... ]}
#
#   <cellule> = {"colspan": 1, "rowspan": 1, "entete": false, "blocs": [ <bloc>, ... ]}
#
# Sortie sur stdout (JSON ASCII pur, ensure_ascii=True — le poste Windows dont la console
# n'est pas garantie en UTF-8 ne doit jamais faire échouer l'écriture) :
#
#   {"gabarit": "A"|"B", "taille_dominante": 24|null,
#    "titres": {"stats": {...}, "trace": [...]},
#    "formatage": {"stats": {...}, "trace": [...]},
#    "document": <document>}     // l'ÉTAT RÉEL après les deux passes (mêmes clés qu'en
#                                 // entrée, plus "niveau_retenu" rempli et "forme" nettoyée) —
#                                 // c'est lui qu'un test doit lire pour vérifier qu'un champ
#                                 // protégé a survécu, jamais seulement le texte d'un motif.

import base64
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun
import pronto_modele


# ---------------------------------------------------------------------------------
# Seuils — TOUT nombre magique vit ici, avec sa provenance. La phase 2 de validation
# (§11 du contrat) va les faire bouger ; ils doivent bouger en un seul endroit.
#
# Refonte du 18.09.2026 (§5.1 du contrat, réécrit ce jour) : l'ancienne conception jugeait
# chaque paragraphe SEUL contre des valeurs ABSOLUES (MAX_MOTS=12, SEUIL_TAILLE=1.2x, une
# ponctuation finale interdite). Mesurée sur le corpus réel, elle détruisait 4 vrais titres
# sur 4 fichiers pour n'en rattraper que 6/17 sur un article sans style. Tous ces seuils
# absolus disparaissent : la nouvelle conception ne compare plus un paragraphe qu'à SON
# PROPRE document — un groupement de paragraphes par SIGNATURE de mise en forme identique
# (taille, gras, italique, souligné, police, alignement, casse), jamais un score.

# §5.1 passe 2 : bornes de plausibilité d'un ÉTAT DÉCLARÉ de titres, mesurées sur les 58
# articles de tmp/corpus-relecture/manuscrits-par-article.csv — les 36 qui portent de vrais
# styles de titre en ont au minimum 2, en médiane 9, au maximum 21. Sert à décider si l'on
# fait confiance aux styles déjà posés (promotion désactivée aux niveaux déjà couverts) ou si
# on les ignore pour la recherche de nouveaux candidats (§5.1 : « la cohérence de l'état
# déclaré désactive la promotion, JAMAIS la rétrogradation » — la passe 4, elle, tourne dans
# tous les cas, cohérent ou non).
MIN_TITRES = 2
MAX_TITRES = 21

# Même mesure, même corpus : la médiane, gardée pour le SIGNAL du §5.1 (correction de Robin
# du 18.09.2026, pendant ce chantier — voir le commentaire dans classer_titres() : MAX_TITRES
# a cessé d'être un motif de rejet, il sert désormais à formuler ce message).
MEDIANE_TITRES_CORPUS = 9

# Lignes directrices de la maison (citées au §5.1 passe 2) : jamais plus de trois niveaux de
# titre. Techniquement déjà garanti par construction (niveau_declare ∈ {0,1,2,3}), gardé
# comme constante nommée et revérifié explicitement : c'est elle que la contrainte globale
# de fin de passe 3 cite dans son message, et c'est elle qu'un sabotage doit pouvoir viser.
MAX_NIVEAUX = 3

# §5.1 passe 3, critère « court relativement au corps de CE document » : mesuré, les
# paragraphes de corps de la Revue font 768 à 1525 signes, ses intertitres réels 17 à 19
# mots (~100-150 signes) — un rapport proche de 10. Le contrat n'impose pas de chiffre exact
# pour la coupure ; RATIO_LONGUEUR_TITRE=3 (le corps doit être au moins 3x plus long que le
# candidat) ne retient qu'une fraction prudente de la marge mesurée, pour ne pas coller au
# seul échantillon dont on dispose. À AJUSTER en phase 2 (§11) sur les dix documents validés
# par la rédaction — c'est très exactement ce que ce seuil nommé permet de faire en un point.
RATIO_LONGUEUR_TITRE = 3

# §5.1 passe 3, critère « longueurs homogènes entre elles » : à l'intérieur d'un groupe de
# même signature, le plus long candidat ne dépasse pas ce multiple du plus court (plancher à
# 1 mot pour éviter une division par zéro). Aucune mesure directe dans le contrat — posé par
# prudence : les deux seuls intertitres réels mesurés de même signature (l'italique de
# Chanier-Delorme) font 17 et 19 mots, un rapport de 1,1 seulement ; un plafond à 3x laisse
# une marge large sans laisser passer un groupe hétérogène (un titre de 3 mots mélangé à une
# phrase de corps de 30 aurait échappé faute de ce garde-fou).
SEUIL_HOMOGENEITE_MOTS = 3

# §5.1 passe 3, critère « occurrences réparties, pas toutes collées » : ce garde-fou ne joue
# qu'à partir de ce nombre d'occurrences dans un groupe (en dessous, juger une « répartition »
# n'a pas de sens statistique). Aucune mesure directe non plus — posé pour écarter un bloc de
# paragraphes consécutifs de même mise en forme (un extrait cité réparti sur plusieurs
# paragraphes, une légende multi-lignes) que leur seule position rend suspect.
SEUIL_DISPERSION_MIN = 3


# ---------------------------------------------------------------------------------
# Le modèle riche — six classes du §4 du contrat, __slots__ partout, aucune dépendance.
# Signatures et ORDRE des champs figés : d'autres modules écrits en parallèle en dépendent.

class Image:
    """Une image. `octets` est le contenu du fichier (l'écrivain en a besoin) ; `surface`
    en EMU², 0 si non déclarée (même convention que docx-meta.py) ; `alt` le texte
    alternatif déclaré, '' si absent ; `flottante` vraie si l'image est ancrée (w:anchor) et
    non en ligne (w:inline).

    `cx`, `cy` : la boîte d'affichage en EMU, séparément — leur produit vaut `surface`, mais
    le produit seul ne permet ni rapport largeur/hauteur ni résolution (§4 du contrat).
    `largeur_px`, `hauteur_px` : les dimensions du FICHIER, en pixels, lues par le lecteur
    dans ses octets (jamais dans le XML de Word, qui ne connaît que cx/cy) ; 0 si le format
    est inconnu ou vectoriel (SVG, EMF, WMF) ou si le fichier est illisible.

    ⚠ Ces quatre champs ont été AJOUTÉS le 18.09.2026, À LA FIN de __slots__ et de la
    signature, avec une valeur par défaut de 0 : l'ordre positionnel des six champs
    d'origine ne bouge pas, pour ne rien casser chez qui construit déjà une Image."""

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


# Les 12 clés du dict « figé » de Fragment.forme, dans l'ordre du §4 du contrat. Une clé
# absente d'un forme construit ailleurs vaut None (« non déclaré ») — jamais False, qui veut
# dire « déclaré éteint ». nouvelle_forme() ci-dessous est le seul constructeur à utiliser.
FORME_CLES = ('gras', 'italique', 'souligne', 'exposant', 'indice', 'barre',
              'petites_capitales', 'majuscules', 'police', 'taille', 'couleur', 'surlignage')


def nouvelle_forme(**valeurs):
    """Un dict `forme` figé : exactement les clés de FORME_CLES, None pour toute clé non
    fournie. Toute clé inconnue passée en trop est ignorée plutôt que de lever — un lecteur
    plus tard, plus complet, ne doit pas faire planter ce module-ci."""
    forme = dict.fromkeys(FORME_CLES)
    for cle, val in valeurs.items():
        if cle in forme:
            forme[cle] = val
    return forme


class Fragment:
    """Un fragment de texte (ou une image, ou un appel de note) au sein d'un paragraphe.
    `texte` n'est jamais None ('' si le fragment porte une image OU une note) ; `forme` est
    un dict FORME_CLES (voir nouvelle_forme()) ; `lien` une URL ou None.

    `note` : identifiant de la note appelée par ce fragment (w:footnoteReference/
    w:endnoteReference), ou None. Ajouté le 19.09.2026 (§4 du contrat) — même convention que
    `image` : `texte == ''` quand ce champ est rempli. Une note de fin est lue avec un
    identifiant DÉCALÉ au-delà du plus grand identifiant de note de bas de page (voir
    manuscrit_docx.py, qui seul sait distinguer les deux familles) : ce champ ne dit jamais
    lui-même de quelle famille vient la note, `Document.notes` fait foi.

    `effectif` : AJOUTÉ le 19.09.2026 (§4 du contrat), même forme que `forme` (les clés de
    FORME_CLES) mais la mise en forme EFFECTIVEMENT appliquée — directe (`forme`) sinon
    style de caractère, sinon chaîne des styles de paragraphe, sinon les valeurs par défaut
    du document. `forme`, elle, reste strictement la mise en forme DIRECTE (§5.2 : jamais la
    cascade des styles) — les deux champs coexistent, aucun ne remplace l'autre."""

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
    """Un paragraphe (ou un titre). `niveau_declare` : 1..3 si le STYLE dit titre, 0 sinon —
    jamais une déduction, c'est classer_titres() qui déduit. `niveau_retenu` : rempli par
    classer_titres(), 0 = corps ; c'est le SEUL champ que les décisions de ce module écrivent
    sur cette classe. `liste` : (numId, ilvl, format) ou None — `format` ('puce'|'numero'|'')
    ajouté le 18.09.2026 (§5.4 du contrat) : résolu par le lecteur depuis numbering.xml,
    JAMAIS deviné ('' si numbering.xml est absent ou si le format n'est pas reconnu). Le
    `numId` d'origine ne doit JAMAIS être recopié par un écrivain (§5.4) : il désigne une
    définition d'un numbering.xml qui n'est pas celui de la sortie."""

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
        # AJOUTÉ le 19.09.2026 (§4 du contrat) : direct (`alignement`) sinon la chaîne des
        # styles de paragraphe — même principe que Fragment.effectif, pour la même raison
        # (« corps sans taille déclarée » et « faux titre 12 pt déclaré » doivent pouvoir se
        # comparer sur ce qui s'affiche VRAIMENT, pas seulement sur ce qui est écrit en dur).
        self.alignement_effectif = alignement_effectif or ''

    def texte(self):
        """Concaténation des fragments — jamais stockée : c'est une dérivée, pas un champ du
        contrat, calculée à chaque besoin pour ne jamais désynchroniser deux copies."""
        return ''.join(f.texte for f in self.fragments)

    def __repr__(self):
        return 'Paragraphe(%r, declare=%r, retenu=%r, %d fragment(s), source=%r)' % (
            self.style, self.niveau_declare, self.niveau_retenu, len(self.fragments),
            self.source)


class Cellule:
    """Une cellule de tableau. `blocs` : liste de Paragraphe | Tableau, dans l'ordre,
    imbrication comprise. Pas de champ `source` — le contrat ne lui en donne pas."""

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
    """Un tableau. `rangees` : liste de listes de Cellule — une cellule masquée par une
    fusion n'y figure jamais. `page` : numéro de page ou None, JAMAIS deviné (§10)."""

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
    l'ordre. `styles` : noms des styles présents dans styles.xml — sert au cas A
    (reconnaitre_gabarit).

    `notes` : dict[int, list[Paragraphe | Tableau]], le contenu de CHAQUE note par
    identifiant — CHANGÉ le 19.09.2026 (§4 du contrat), c'était une liste plate qui fondait
    toutes les notes ensemble sans dire laquelle appelle quoi. Les notes de bas de page ET
    les notes de fin y cohabitent : une note de fin porte un identifiant décalé au-delà du
    plus grand identifiant de note de bas de page (manuscrit_docx.py), pour qu'aucune clé ne
    se percute jamais entre les deux familles."""

    __slots__ = ('blocs', 'styles', 'langue', 'revisions', 'commentaires', 'notes', 'source')

    def __init__(self, blocs=None, styles=None, langue='', revisions=0, commentaires=0,
                 notes=None, source=None):
        self.blocs = blocs if blocs is not None else []
        self.styles = styles if styles is not None else []
        self.langue = langue or ''
        self.revisions = revisions or 0
        self.commentaires = commentaires or 0
        self.notes = notes if notes is not None else {}
        self.source = source

    def __repr__(self):
        return 'Document(%d bloc(s), %d style(s), langue=%r, source=%r)' % (
            len(self.blocs), len(self.styles), self.langue, self.source)


# ---------------------------------------------------------------------------------
# Avertissement au rédacteur — même mécanisme que pronto_modele.py (szh_commun.avertir),
# même préfixe : journal.js n'a qu'un seul format à reconnaître, quel que soit le module qui
# a parlé. Sert aux DEUX signaux que le §5 du contrat demande explicitement : le style de
# titre généralisé (garde-fou 2) et le paragraphe entièrement gras/majuscule non retenu.

PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# ---------------------------------------------------------------------------------
# Reconnaissance du gabarit — §1 du contrat : cas A si SZH Cle ET SZH Aide sont présents
# dans styles.xml, cas B sinon. Comparaison tolérante (casse, espaces, tirets) via les
# constantes déjà éprouvées de pronto_modele — ne pas les réécrire ici en ferait deux copies.

def reconnaitre_gabarit(document):
    """'A' (gabarit déjà en place, aucune restructuration) ou 'B' (manuscrit quelconque)."""
    presents = {pronto_modele.normaliser_nom_style(s) for s in document.styles}
    if pronto_modele.NOM_STYLE_CLE in presents and pronto_modele.NOM_STYLE_AIDE in presents:
        return 'A'
    return 'B'


# ---------------------------------------------------------------------------------
# Taille dominante — base de toutes les comparaisons de §5.1. Ne regarde QUE les paragraphes
# de premier niveau (jamais les tableaux), comme docx-titres.py : c'est le même corpus que
# celui sur lequel les seuils MAX_MOTS/SEUIL_TAILLE ont été calibrés.

def _paragraphes_premier_niveau(document):
    return [b for b in document.blocs if isinstance(b, Paragraphe)]


def taille_dominante(document):
    """La taille de police (demi-points) la plus fréquente parmi les fragments porteurs de
    texte des paragraphes de premier niveau ; None si aucune taille n'est déclarée nulle
    part — comparer à None ne doit jamais lever, tout appelant le vérifie."""
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
# Classement des titres — §5.1, refonte du 18.09.2026. Quatre passes, JAMAIS un score :
#   1. exclusions (styles maison, citation, légende, liste, vide, étendue de bibliographie) ;
#   2. l'état déclaré décide QUELS niveaux la passe 3 a le droit de chercher ;
#   3. regroupement par SIGNATURE de mise en forme (jamais un paragraphe seul) ;
#   4. rétrogradation d'un titre déclaré dont la signature est celle du corps.
# Voir le §5.1 du contrat pour la justification complète de chaque règle.

def _mots(texte):
    return texte.split()


def _fragments_non_vides(paragraphe):
    return [f for f in paragraphe.fragments if f.texte]


def _taille_max(fragments_non_vides):
    tailles = [f.forme.get('taille') for f in fragments_non_vides
               if f.forme.get('taille') is not None]
    return max(tailles) if tailles else None


def _tout_forme(fragments_non_vides, cle):
    """True si TOUS les fragments non vides déclarent `cle` (gras/italique/souligne) à
    True — un paragraphe à la mise en forme mixte (un mot en gras au milieu d'une phrase de
    corps) n'est jamais « tout gras », donc jamais un candidat sur ce seul critère."""
    return bool(fragments_non_vides) and all(f.forme.get(cle) is True
                                              for f in fragments_non_vides)


def _police_dominante(fragments_non_vides):
    """La police si TOUS les fragments non vides s'accordent sur une seule ; None sinon
    (police non déclarée ou mélangée) — un champ de signature de plus qui ne doit jamais
    être deviné à partir d'un fragment isolé."""
    polices = {f.forme.get('police') for f in fragments_non_vides if f.forme.get('police')}
    return next(iter(polices)) if len(polices) == 1 else None


def _casse(texte):
    """'MAJ' si le texte ne porte aucune lettre minuscule (et au moins une lettre) — un
    signal visuel de titre indépendant de `forme.majuscules` (qui, lui, ne dit que si Word a
    DÉCLARÉ un style de casse forcée, pas si l'autrice a tapé directement en capitales)."""
    lettres = [c for c in texte if c.isalpha()]
    if not lettres:
        return ''
    return 'MAJ' if all(c == c.upper() for c in lettres) else ''


def _signature(paragraphe, fragments_non_vides, texte):
    """La signature de mise en forme d'un paragraphe, telle que le §5.1 passe 3 la définit :
    taille arrondie (déjà un entier en demi-points, rien à arrondir en pratique), gras,
    italique, souligné, police, alignement, casse. Deux paragraphes de MÊME signature
    tombent dans le MÊME groupe — c'est un tuple, comparable par égalité, jamais un score."""
    return (_taille_max(fragments_non_vides), _tout_forme(fragments_non_vides, 'gras'),
            _tout_forme(fragments_non_vides, 'italique'),
            _tout_forme(fragments_non_vides, 'souligne'),
            _police_dominante(fragments_non_vides), paragraphe.alignement, _casse(texte))


def _texte_signature(sig):
    """Un résumé lisible d'une signature, pour la trace — « c'est elle que Robin lira »
    (§5.1) : jamais un tuple brut dans un motif destiné à une relectrice."""
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
# Passe 1 — exclusions, AVANT toute heuristique (§5.1). Un style maison, de citation ou de
# légende, un paragraphe en liste ou vide ne peuvent JAMAIS devenir un titre par déduction.

def _est_style_citation(style):
    """Word pose 'Quote'/'IntenseQuote' (styleId), affichés 'Citation'/'Citation intense' en
    français, 'Zitat' en allemand — aucune table de correspondance officielle dans ce dépôt
    pour cette famille précise (contrairement à `famille()` de pronto_modele, qui couvre
    title/subtitle/author/abstract/biblio/caption/heading mais pas les citations) : ce test
    reste donc local à ce module, sur le nom déjà normalisé (normaliser_nom_style)."""
    n = pronto_modele.normaliser_nom_style(style)
    return bool(n) and ('quote' in n or n == 'citation' or 'zitat' in n)


def _est_titre_biblio(texte, lexique):
    """Un texte de paragraphe tombe-t-il dans le lexique TITRES_BIB (via
    pronto_modele.lire_titres_bib(), qui le RELIT dans szh-citations.lua, jamais recopié) ?
    Reprend l'exacte petite comparaison de pronto_modele._titre_est_biblio() et de
    manuscrit-nettoyer.py (numérotation de tête retirée, préfixe « Liste des » toléré) :
    cette fonction-là est privée à son propre module (convention du tiret bas du dépôt), donc
    non importable — seule la comparaison, minuscule, est réécrite ici sur les briques
    PUBLIQUES (lire_titres_bib, RE_NUM_TITRE_BIBLIO, PREFIXES_TITRE_BIBLIO, aplatir)."""
    plat = pronto_modele.RE_NUM_TITRE_BIBLIO.sub('', pronto_modele.aplatir(texte))
    if plat in lexique:
        return True
    for prefixe in pronto_modele.PREFIXES_TITRE_BIBLIO:
        if plat.startswith(prefixe) and plat[len(prefixe):] in lexique:
            return True
    return False


def _indices_etendue_bibliographie(document, paras):
    """Les indices (dans `paras`) STRICTEMENT APRÈS le DERNIER paragraphe de premier niveau
    dont le texte tombe dans TITRES_BIB — jamais le paragraphe de titre lui-même, qui reste un
    paragraphe ordinaire pour les passes 2/3/4 (il peut très bien être un vrai titre déclaré,
    ou se faire promouvoir comme n'importe quel autre intertitre : c'est SEULEMENT ce qui SUIT
    qui doit être protégé d'une fausse promotion, §5.1). L'étendue s'arrête à la fin du
    document ou au premier tableau rencontré — même borne que pronto_modele.etendue_biblio().

    ⚠ Diverge délibérément de pronto_modele.etendue_biblio(), qui ne considère QUE les
    paragraphes déjà reconnus comme titres (niveau 1-3) : cette passe-ci tourne AVANT que
    niveau_retenu existe, et doit donc pouvoir repérer une bibliographie même dans un
    manuscrit SANS AUCUN style de titre (22/58 du corpus, §5.1 passe 2) — un « Références »
    qui ne serait pas encore stylé Titre reste un texte assez spécifique (le lexique
    TITRES_BIB n'a que des entrées dédiées) pour qu'une comparaison de texte, sans exiger de
    style, reste sûre. Documenté ici plutôt que tu : c'est un endroit où le contrat ne
    tranchait pas explicitement entre « avant » et « après » la classification.

    ⚠ Deuxième mesure, sur 2-clairseme : cette étendue « jusqu'à la fin du document » (même
    borne que pronto_modele.etendue_biblio()) engloutissait, dans une PREMIÈRE version de
    cette fonction, « Informations sur les autrices et auteurs : », une VRAIE rubrique de la
    Revue placée APRÈS la bibliographie (mesuré : 27 entrées puis un paragraphe vide puis ce
    Heading1) — très exactement le titre réel que ce chantier a pour mission de ne plus
    détruire (§5.1, motivé par ce même texte). Corrigé, mais PAS ici : voir
    _exclusions_passe1(), qui n'applique cette exclusion qu'aux paragraphes SANS style de
    titre déclaré. Un paragraphe déjà déclaré titre (la rubrique « Informations… » comme, à
    front renversé, une entrée de bibliographie fabriquée à qui l'on a collé un style de
    titre) passe TOUJOURS par la passe 4 normale, qui le juge sur sa signature et sa longueur
    — jamais sur sa position dans cette étendue. Cette fonction-ci reste donc fidèle à
    l'étendue « jusqu'à la fin du document ou jusqu'à un tableau » de pronto_modele : c'est
    son PÉRIMÈTRE D'USAGE, pas sa définition, qui a changé."""
    lexique = pronto_modele.lire_titres_bib()
    if not lexique:
        return set()
    dernier = None
    idx = -1
    for bloc in document.blocs:
        if isinstance(bloc, Paragraphe):
            idx += 1
            if _est_titre_biblio(bloc.texte(), lexique):
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
    """{idx: (categorie, raison)} — un paragraphe présent dans ce dict ne peut JAMAIS être
    promu titre par déduction (passe 3). Catégories : style_maison, style_citation, legende,
    liste, vide, bibliographie.

    ⚠ Mesuré sur le corpus réel : l'exclusion « bibliographie » ne s'applique qu'aux
    paragraphes SANS style de titre déclaré (niveau_declare == 0), jamais à un paragraphe déjà
    déclaré titre. Un paragraphe DÉJÀ déclaré reste toujours jugé par la passe 4 (signature et
    longueur relative au corps), qu'il tombe ou non dans l'étendue détectée par
    _indices_etendue_bibliographie() — cette étendue s'arrête à la fin du document (même borne
    que pronto_modele.etendue_biblio()) et engloutirait sinon une VRAIE rubrique de la Revue
    placée après la bibliographie (« Informations sur les autrices et auteurs : »,
    2-clairseme), aussi sûrement qu'elle protégerait une entrée de bibliographie fabriquée à
    qui l'on a collé un style de titre. La passe 4, elle, sait distinguer les deux (elle a été
    conçue et mesurée pour ça, voir sa note) : mieux vaut la laisser juger un déclaré que de le
    faire taire ici par position."""
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
            exclus[idx] = ('liste', 'paragraphe en liste')
        elif not p.texte().strip():
            exclus[idx] = ('vide', 'paragraphe vide')
    for idx in _indices_etendue_bibliographie(document, paras):
        if paras[idx].niveau_declare != 0:
            continue
        exclus.setdefault(idx, ('bibliographie',
                                 'dans l\'étendue de bibliographie (lexique TITRES_BIB de '
                                 'szh-citations.lua)'))
    return exclus


# ---------------------------------------------------------------------------------
# Passe 2 — l'état déclaré décide de ce que la passe 3 a le droit de chercher (§5.1).

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
# Statistiques de corps — la signature et la longueur dominantes du corps de CE document,
# base de comparaison des passes 3 (« diffère du corps ») et 4 (« identique au corps »).
# Calculées UNIQUEMENT sur les paragraphes candidats (non déclarés titre, non exclus par la
# passe 1) : c'est la définition même du corps, et exclure titres/bibliographie/légendes de
# ce calcul évite qu'ils ne faussent la mesure qui sert justement à les juger.

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
# Passe 4 — rétrogradation (§5.1) : un paragraphe DÉCLARÉ titre dont la signature est celle
# du corps est rétrogradé, quel que soit son nombre de mots. Le seuil absolu de 12 mots et la
# ponctuation finale de l'ancienne conception ont disparu d'ici : ils détruisaient des
# intertitres réels un peu longs (13, 17, 19 mots) sans jamais regarder la mise en forme.
#
# ⚠ CORRECTION du 18.09.2026, mesurée sur le corpus réel APRÈS une première version qui ne
# comparait QUE la signature (fidèle à la lettre du §5.1) : elle détruisait 39 vrais titres
# sur seulement 4 fichiers — bien pire que les 4 de l'ancienne conception. Cause constatée en
# lisant le XML brut : un titre RÉEL, correctement stylé « Heading 1 »/« Heading 2 », NE PORTE
# QUASIMENT JAMAIS de mise en forme DIRECTE sur ses runs (pas de <w:b/>, pas de <w:sz/>) — son
# gras et sa taille visibles viennent de la CASCADE DE STYLE, que Fragment.forme ne capture
# JAMAIS (§4 du contrat : « Mise en forme DIRECTE... jamais la cascade des styles »). Un titre
# réel et un faux titre (paragraphe de corps auquel on a collé un pStyle de titre, comme le
# fait le corpus fabriqué 2-*) ont donc, l'un et l'autre, une signature directe QUASI VIDE —
# la comparer à celle du corps (également vide) ne distingue RIEN : mesuré, sig_egale=True
# pour la quasi-totalité des paragraphes déclarés titres du corpus, vrais et faux confondus.
# La signature seule ne suffit pas ; ce n'est écrit nulle part dans le §5.1 tel qu'il existait
# au moment d'écrire ce module, et c'est à signaler comme un point où le contrat s'est révélé
# incomplet en le mettant en œuvre (voir le rapport de chantier).
#
# Le signal qui, lui, sépare fiablement les deux sur ce corpus réel est la LONGUEUR relative
# au corps — le même principe que la passe 3 (« jamais l'absolu, toujours relatif à CE
# document »), mais avec un rapport bien plus indulgent que RATIO_LONGUEUR_TITRE (3, pensé
# pour une PROMOTION prudente) : ici, on ne rétrograde un titre DÉJÀ déclaré que s'il n'est
# même pas plus court que le corps lui-même. RATIO_RETROGRADATION_MIN=1 a été vérifié sur les
# quatre fichiers 2-* : les titres réels les plus longs mesurés (17 et 19 mots, 129 et 109
# signes, dans un document dont le corps médian ne fait que 179 signes) passent tous les deux
# ce test ; le plus court des faux titres restants (216 signes, dans ce même document) ne le
# passe pas. La signature reste un signal VALABLE quand elle diffère du corps (un titre en
# italique ou en gras DIRECT, sans ambiguïté) : dans ce cas on conserve sans même regarder la
# longueur. Mais quand elle ne diffère pas — le cas de la grande majorité des documents réels,
# faute de mise en forme directe — c'est la longueur qui décide, pas un silence qui rétrograde
# tout ce qui est déclaré.
RATIO_RETROGRADATION_MIN = 1


def _signature_typographique(sig):
    """La signature, MOINS l'alignement — mesuré sur le corpus réel : l'alignement seul
    (« both », justifié) est un attribut de PARAGRAPHE souvent hérité incidemment (un
    document entier justifié par défaut, par exemple), jamais un signal typographique
    délibéré comme le gras, l'italique ou une taille propre. Le laisser suffire, seul, à
    déclarer une signature « distincte du corps » a laissé passer plusieurs entrées de
    bibliographie fabriquées (57, 88 mots) dont le SEUL écart avec le corps était cet
    alignement — mesuré sur 2-dense. La comparaison qui décide de faire confiance
    INCONDITIONNELLEMENT à la signature (sans même regarder la longueur) ignore donc ce
    champ ; il reste dans la signature COMPLÈTE utilisée pour le regroupement de la passe 3
    et dans la trace, où il continue à compter."""
    taille, gras, italique, souligne, police, alignement, casse = sig
    return (taille, gras, italique, souligne, police, casse)


def _passe4_retrogradation(paras, exclus, corps_sig, corps_mediane):
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
        if _signature_typographique(sig) != _signature_typographique(corps_sig):
            resultats[idx] = (p.niveau_declare, 'conserve_signature_distincte',
                'conservé titre : signature (%s) typographiquement distincte de celle du '
                'corps (%s)' % (_texte_signature(sig), _texte_signature(corps_sig)))
            continue
        # Signature typographiquement identique à celle du corps (l'alignement seul peut
        # encore différer — voir _signature_typographique ; le cas de loin le plus fréquent
        # sur un document réel, voir la note ci-dessus) : la longueur décide, relativement au
        # corps de CE document, jamais un compte de mots absolu.
        court = (corps_mediane is not None
                 and len(texte) * RATIO_RETROGRADATION_MIN <= corps_mediane)
        if court:
            resultats[idx] = (p.niveau_declare, 'conserve_signature_corps_mais_court',
                'conservé titre : signature (%s) typographiquement identique à celle du corps, '
                'mais sa longueur (%d signes, %d mots) reste dans celle d\'un titre de ce '
                'document (corps médian %s signes) — la mise en forme directe ne distingue '
                'rien ici, la longueur si' % (_texte_signature(sig), len(texte),
                                              len(_mots(texte)), corps_mediane))
        else:
            resultats[idx] = (0, 'retrogradee_signature_corps',
                'rétrogradé au corps : signature (%s) typographiquement identique à celle du '
                'corps de ce document (%s), ET longueur (%d signes, %d mots) qui ne tient plus '
                'dans celle d\'un titre de ce document (corps médian %s signes)'
                % (_texte_signature(sig), _texte_signature(corps_sig), len(texte),
                   len(_mots(texte)), corps_mediane))
    return resultats


# ---------------------------------------------------------------------------------
# Passe 3 bis — adoption. Correction de Robin du 18.09.2026, pendant ce chantier : un titre
# déclaré fournit la SIGNATURE DE RÉFÉRENCE de son niveau ; un paragraphe NON stylé qui porte
# cette même signature est adopté À CE NIVEAU. Motivée par un mot de Robin : « typiquement
# quelqu'un balise 5 titres, le 6ème il le met juste italique + augmente la taille » — un
# oubli d'application de style, pas une absence de structure. La question que la passe 3
# « aveugle » laisse ouverte (quel niveau donner à un groupe retrouvé par mise en forme ?) ne
# se pose plus ici : le niveau est DONNÉ par le style survivant, jamais déduit.
#
# ⚠ L'ORDRE ci-dessous n'est pas une préférence, c'est une nécessité mesurée sur le cas
# d'ouverture du chantier (1_Résumé-article-revue-CSPS.docx, Titre 2 posé sur quatre
# paragraphes : un vrai titre, trois paragraphes de corps ramenés à la taille du corps et
# dégraissés). Calculée AVANT rétrogradation, la signature majoritaire de ces quatre survivants
# serait celle du CORPS (trois sur quatre) — on adopterait alors tout paragraphe du document
# portant la signature du corps, soit L'ARTICLE ENTIER promu en titre, silencieusement, sur le
# document même qui a motivé l'outil. D'où l'ordre imposé : 1. rétrograder (passe 4, déjà
# faite avant l'appel ci-dessous) ; 2. calculer la référence sur les seuls SURVIVANTS ; 3.
# adopter. Un appelant qui inverserait cet ordre (référence calculée sur les déclarés BRUTS,
# avant rétrogradation) doit voir le nombre de titres retenus EXPLOSER — c'est le sabotage
# naturel de ce mécanisme, et le contrôle qui le vérifie sur ce fichier réel.
#
# Deux garde-fous, indissociables :
#   - la référence doit être MAJORITAIRE parmi les survivants de son niveau (strictement plus
#     de la moitié) — cinq H2 en cinq mises en forme différentes ne donnent AUCUNE référence,
#     et on n'adopte rien plutôt que de deviner laquelle ferait foi ;
#   - la référence ne doit JAMAIS être celle du corps — le filet qui rattrape le cas
#     d'ouverture si la rétrogradation l'avait laissé passer.
#
# Comparaison sur la signature TYPOGRAPHIQUE (sans alignement, voir _signature_typographique
# et sa note dans la passe 4) : même lesson que la passe 4, mesurée sur le même corpus — un
# alignement hérité incidemment ne doit ni fonder une référence ni décider une adoption.

def _passe3bis_adoption(paras, exclus, resultats_p4, corps_sig):
    """(adoptions, references) — `adoptions` : idx (candidat non déclaré) -> (niveau, sig,
    effectif, total) ; `references` : niveau -> (sig, effectif, total) pour la trace, même
    quand aucun candidat ne correspond. Ne regarde QUE les paragraphes déclarés qui ont
    SURVÉCU à la passe 4 (resultats_p4[idx][0] > 0) — jamais les rétrogradés."""
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
# Passe 3 — regroupement par signature (§5.1) : jamais un paragraphe seul. Un groupe devient
# un niveau de titre quand TOUS ces faits tiennent : signature différente de celle du corps,
# longueur courte relativement au corps, occurrences réparties (pas toutes collées),
# longueurs homogènes entre elles. L'ORDRE des groupes qualifiés donne les niveaux : taille
# décroissante d'abord, puis le gras, puis l'italique (§5.1 : « l'italique compte autant que
# le gras » — motivé par 3_VF_Chanier-Delorme, dont les titres de niveau 2 sont en italique,
# presque sans changement de taille).

def _grouper_candidats(paras, exclus, niveaux_a_chercher, corps_sig, corps_mediane,
                        deja_adoptes=frozenset()):
    """{signature: [idx, ...]} des paragraphes candidats à la promotion (non déclarés titre,
    non exclus, non déjà ADOPTÉS par la passe 3 bis — voir _passe3bis_adoption) dont la
    signature diffère du corps ET la longueur est courte relativement au corps — les deux
    seuls critères qui NE dépendent PAS des autres membres du groupe. Les critères de
    dispersion et d'homogénéité, eux, ont besoin du groupe complet : voir _filtrer_groupes().
    Rend {} sans rien examiner si la passe 2 n'a désigné aucun niveau à chercher, ou si le
    corps n'a pas pu être caractérisé (document trop pauvre)."""
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
    """Ne garde que les groupes dont les occurrences sont réparties (pas toutes consécutives,
    à partir de SEUIL_DISPERSION_MIN occurrences) et dont les longueurs sont homogènes entre
    elles (le plus long ne dépasse pas SEUIL_HOMOGENEITE_MOTS fois le plus court)."""
    qualifies = {}
    for sig, indices in groupes.items():
        mots = [len(_mots(paras[i].texte().rstrip())) for i in indices]
        mn, mx = min(mots), max(mots)
        if mx > SEUIL_HOMOGENEITE_MOTS * max(mn, 1):
            continue
        if len(indices) >= SEUIL_DISPERSION_MIN:
            tries = sorted(indices)
            if tries[-1] - tries[0] + 1 == len(tries):
                continue  # tous consécutifs : pas « réparti », §5.1
        qualifies[sig] = sorted(indices)
    return qualifies


def _ordonner_groupes(groupes_qualifies):
    """Trie les groupes qualifiés : taille décroissante d'abord (None traité comme 0, un
    titre gras seul sans taille propre passe après tout titre dont la taille est connue),
    puis le gras, puis l'italique — exactement l'ordre que le §5.1 impose."""
    def cle(sig):
        taille, gras, italique, souligne, police, alignement, casse = sig
        return (-(taille or 0), 0 if gras else 1, 0 if italique else 1)
    return sorted(groupes_qualifies.items(), key=lambda kv: cle(kv[0]))


def classer_titres(document):
    """Remplit `niveau_retenu` sur chaque Paragraphe de premier niveau de `document`
    (mutation en place — c'est le contrat, §4 : « niveau_retenu... rempli par
    classer_titres() »). Rend (stats, trace) : `stats` un résumé chiffré, `trace` une ligne
    par paragraphe, lisible par un humain, signature et chiffres à l'appui — c'est elle que
    Robin lira pour valider chaque document (§11, phase 2)."""
    trace = []
    paras = _paragraphes_premier_niveau(document)
    total = len(paras)

    # Passe 1 — exclusions.
    exclus = _exclusions_passe1(document, paras)

    # Passe 2 — l'état déclaré décide des niveaux que la passe 3 a le droit de chercher.
    niveaux_a_chercher, total_declares, niveaux_utilises, motif_etat = _etat_declare(paras, exclus)
    trace.append({'portee': 'document', 'source': None, 'style': '',
                  'decision': 'etat_declare', 'motif': motif_etat})

    # Base de comparaison des passes 3 et 4 : la signature et la longueur dominantes du
    # corps de CE document, jamais une valeur absolue importée d'un autre article.
    corps_sig, corps_mediane = _corps_stats(paras, exclus)

    # Passe 4 — rétrogradation. INDÉPENDANTE de la passe 3 (voir sa docstring) : on la calcule
    # maintenant pour pouvoir, plus bas, évaluer la contrainte globale sur le total RÉEL de
    # titres retenus (déclarés conservés + nouvellement promus), pas sur une borne supérieure.
    resultats_p4 = _passe4_retrogradation(paras, exclus, corps_sig, corps_mediane)

    # Passe 3 bis — adoption (§5.1, correction de Robin du 18.09.2026). ORDRE IMPÉRATIF : sur
    # les SURVIVANTS de la passe 4 ci-dessus, jamais sur les déclarés bruts (voir la note de
    # _passe3bis_adoption — l'inverser fait exploser le nombre de titres retenus sur le cas
    # d'ouverture du chantier).
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

    # Passe 3 — regroupement par signature, restreint aux niveaux que la passe 2 autorise, et
    # qui ne revient jamais sur un paragraphe déjà ADOPTÉ ci-dessus.
    groupes_bruts = _grouper_candidats(paras, exclus, niveaux_a_chercher, corps_sig,
                                        corps_mediane, deja_adoptes=set(adoptions))
    groupes_qualifies = _filtrer_groupes(groupes_bruts, paras)
    groupes_ordonnes = _ordonner_groupes(groupes_qualifies)
    niveaux_disponibles = sorted(niveaux_a_chercher)

    assignation_p3 = {}   # idx -> (niveau, signature)
    groupes_retenus, groupes_ecartes_faute_de_niveau = [], []
    for i, (sig, indices) in enumerate(groupes_ordonnes):
        if i < len(niveaux_disponibles):
            niveau = niveaux_disponibles[i]
            groupes_retenus.append((sig, indices, niveau))
            for idx in indices:
                assignation_p3[idx] = (niveau, sig)
        else:
            groupes_ecartes_faute_de_niveau.append((sig, indices))

    # Contrainte globale, CORRIGÉE le 18.09.2026 par Robin pendant ce chantier (à relire dans
    # le message de correction, pas encore répercutée dans le texte figé du §5.1 au moment où
    # ceci est écrit — ce commentaire fait foi entre-temps) : sur l'entretien hors gabarit
    # (questions courtes, en gras, nombreuses, régulièrement réparties — la passe 1 ne le voit
    # pas, faute de style SZH), l'arbitrage est « c'est OK si les questions sont détectées
    # comme H2 par exemple, on fera avec ». Rejeter la promotion au-delà de MAX_TITRES aurait
    # donc produit LE PIRE des deux mondes sur ce cas précis : un entretien de 30 questions
    # aurait dépassé le plafond, tout le groupement aurait été écarté, et l'article serait
    # ressorti avec ZÉRO titre — pire que les questions promues en H2, ce que Robin vient
    # d'accepter. MAX_TITRES cesse donc d'être un motif de rejet : c'est désormais un SIGNAL
    # dans le rapport (voir plus bas), jamais une décision silencieuse. Seul le plafond de
    # trois niveaux (MAX_NIVEAUX, lignes directrices des deux revues) reste une contrainte
    # dure — et il ne peut de toute façon jamais être dépassé par construction ici : un niveau
    # de titre vaut 1, 2 ou 3 dans tout le modèle (Paragraphe.niveau_declare), et la passe 3 ne
    # promeut jamais en dehors de `niveaux_a_chercher`, lui-même un sous-ensemble de {1,2,3}.
    # Gardé explicite malgré cela : c'est la même prudence que le reste de ce module (un
    # invariant qui ne peut structurellement pas être violé aujourd'hui peut le devenir demain
    # si le modèle riche gagne un quatrième niveau).
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

    # Recalculé APRÈS l'éventuel rejet ci-dessus : le signal qui suit doit compter ce qui sera
    # RÉELLEMENT retenu, jamais une tentative qu'on vient d'annuler. Les adoptions de la passe
    # 3 bis comptent aussi : « une adoption qui multiplierait le nombre de titres du document
    # mérite le signal de la passe 3, au même titre qu'un groupe trop nombreux » (Robin,
    # 18.09.2026).
    total_final = n_conserves_p4 + len(assignation_p3) + len(adoptions)
    if total_final > MAX_TITRES:
        # Signal, jamais un rejet (voir le commentaire ci-dessus) : la relectrice tranche,
        # l'outil ne jette rien en silence et n'accepte rien sans le dire.
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'signal_nombre_titres_inhabituel',
                      'motif': ('%d titre(s) retenu(s), bien au-delà de ce qu\'on observe '
                               'habituellement (médiane %d, maximum %d sur les 36 articles '
                               'stylés du corpus de référence) — vérifiez qu\'il ne s\'agit '
                               'pas d\'un entretien ou d\'un glossaire'
                               % (total_final, MEDIANE_TITRES_CORPUS, MAX_TITRES))})
    if not rejet_contrainte and not groupes_retenus and niveaux_a_chercher and groupes_bruts:
        # « En cas de doute : rien, et on le dit » (§5.1). Des candidats existaient, aucun
        # groupe n'a convaincu (signature/longueur/dispersion/homogénéité) — jamais resserrer
        # les critères pour forcer un chiffre plausible.
        n_examines = sum(len(v) for v in groupes_bruts.values())
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'aucune_promotion_decelee',
                      'motif': ('aucune structure de titres décelable : %d candidat(s) '
                               'examiné(s) en %d groupe(s) de signature, aucun ne réunit '
                               'longueurs homogènes et répartition dans le document'
                               % (n_examines, len(groupes_bruts)))})

    # Trace des groupes examinés, retenus ou non — c'est elle que Robin lit pour juger
    # (§5.1 : « groupe : italique, 11 pt, 3 à 8 mots, 9 occurrences réparties → niveau 2 »).
    for sig, indices, niveau in groupes_retenus:
        mots = [len(_mots(paras[i].texte().rstrip())) for i in indices]
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'groupe_promu',
                      'motif': 'groupe : %s, %d à %d mots, %d occurrence(s) réparties → '
                               'niveau %d' % (_texte_signature(sig), min(mots), max(mots),
                                              len(indices), niveau)})
    for sig, indices in groupes_ecartes_faute_de_niveau:
        mots = [len(_mots(paras[i].texte().rstrip())) for i in indices]
        trace.append({'portee': 'document', 'source': None, 'style': '',
                      'decision': 'groupe_non_retenu',
                      'motif': 'groupe qualifiant mais écarté : %s, %d à %d mots, %d '
                               'occurrence(s) — aucun niveau disponible dans %s'
                               % (_texte_signature(sig), min(mots), max(mots), len(indices),
                                  sorted(niveaux_a_chercher) or '(aucun)')})

    # Assemblage final — une ligne de trace par paragraphe, dans l'ordre du document.
    n_promus = n_retrogrades = n_conserves_declares = n_non_promus = n_exclus = n_adoptes = 0
    stats_exclus = {}
    for idx, p in enumerate(paras):
        if idx in exclus:
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
              'total_titres_retenus': total_final,
              'rejet_contrainte_niveaux': bool(rejet_contrainte),
              'signal_nombre_inhabituel': bool(total_final > MAX_TITRES),
              'styles_exclus': []}
    return stats, trace


# ---------------------------------------------------------------------------------
# Nettoyage de la mise en forme manuelle — §5.2. Ce qui reste est aussi important que ce
# qui part : italique, exposant, indice et liens ne sont JAMAIS touchés ici.
#
# ⚠ Trou du contrat, constaté en écrivant ce module (voir le rapport de chantier) : le champ
# `barre` (barré) n'apparaît NI dans « ce qui part » NI dans « ce qui reste » du §5.2.
# Décision prise ici, faute de mieux : traité comme police/taille/couleur — retiré sans
# réserve de titre, un texte barré n'ayant normalement pas sa place dans un article publié.
FORME_RETIREE_TOUJOURS = ('police', 'taille', 'couleur', 'surlignage', 'petites_capitales',
                           'majuscules', 'barre')
# « gras et souligné du corps de texte » (§5.2, texte exact) : retirés SEULEMENT quand le
# paragraphe est resté corps (niveau_retenu == 0) — un titre garde son gras.
FORME_RETIREE_CORPS_SEUL = ('gras', 'souligne')
# italique, exposant, indice : jamais dans les deux listes ci-dessus, donc jamais touchés.
# `lien` (sur Fragment, pas dans `forme`) : jamais touché non plus, mêmes raisons.


def _paragraphe_vide(paragraphe):
    for f in paragraphe.fragments:
        if f.texte or f.image is not None:
            return False
    return True


def _nettoyer_fragments(paragraphe, est_corps):
    """Mute chaque Fragment.forme en place ; rend l'ensemble des clés effectivement retirées
    (pour le motif) et les deux signalements (gras intégral / majuscules intégrales),
    évalués sur la forme D'ORIGINE — avant tout retrait, sans quoi le signal disparaîtrait
    avec le champ qu'il regarde.

    ⚠ Correction du 19.09.2026 (§5.2, décision du superviseur) : « signalé sans être touché »
    (le texte même du contrat) était violé pour le gras — un paragraphe entièrement gras et
    non retenu comme titre voyait son gras RETIRÉ dans la même passe qui le SIGNALE (mesuré :
    16 paragraphes sur 3bis_CSPS_Revue3_2026_FLOW_Piloting_OFP.docx). Décision : le gras d'un
    paragraphe de corps ENTIÈREMENT gras est conservé (une relectrice doit pouvoir le voir),
    le signalement reste dans le rapport. Le gras PARTIEL du corps, lui, part normalement —
    seul le gras intégral déclenche cette exception. Les majuscules forcées, elles, restent
    retirées dans tous les cas (FORME_RETIREE_TOUJOURS) : la décision du superviseur ne
    portait que sur le gras."""
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


def _nettoyer_paragraphe(paragraphe):
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

    return a_change, {'portee': 'paragraphe', 'source': paragraphe.source,
                       'decision': 'nettoye' if a_change else 'inchange',
                       'signalements': signalements, 'motif': '; '.join(motif_parts)}


def _paragraphes_en_profondeur(blocs):
    """Chaque Paragraphe atteignable depuis `blocs` (Paragraphe | Tableau), à N'IMPORTE
    QUELLE PROFONDEUR de cellule — jamais les Tableau eux-mêmes. À ne pas confondre avec
    _paragraphes_premier_niveau() (réservée à classer_titres()/§5.1, qui ne doit statuer QUE
    sur le premier niveau : un paragraphe de cellule ne peut pas devenir un titre).

    Correction du 19.09.2026 (§5.2) : nettoyer_mise_en_forme() ne bouclait QUE sur
    document.blocs (premier niveau) — 171 paragraphes en cellule, mesurés sur le corpus réel,
    gardaient donc taille/police/couleur/gras alors que le §5.2 dit « tout le corps »."""
    for b in blocs:
        if isinstance(b, Tableau):
            for rangee in b.rangees:
                for c in rangee:
                    yield from _paragraphes_en_profondeur(c.blocs)
        else:
            yield b


def nettoyer_mise_en_forme(document):
    """Applique le §5.2 à chaque Paragraphe de `document`, à N'IMPORTE QUELLE PROFONDEUR —
    premier niveau, cellules de tableau (à toute profondeur d'imbrication) ET notes de bas de
    page / de fin (document.notes) — (mutation en place : formes de Fragment,
    alignement/retrait de Paragraphe, et la liste `blocs` elle-même pour la fusion des
    paragraphes vides consécutifs, celle-ci réservée au premier niveau : la notion de
    « paragraphes vides consécutifs » n'a de sens que dans le fil principal du texte).
    Suppose `classer_titres()` déjà passé : le retrait de gras/souligné dépend de
    `niveau_retenu` (toujours 0 pour un paragraphe de cellule ou de note, qui ne peut jamais
    devenir un titre). Rend (stats, trace)."""
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
            sources_retirees = []
            while (j < n and isinstance(blocs[j], Paragraphe) and _paragraphe_vide(blocs[j])):
                sources_retirees.append(blocs[j].source)
                j += 1
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
    for bloc in paragraphes_a_nettoyer:
        a_change, ligne = _nettoyer_paragraphe(bloc)
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
# Désérialisation JSON — voir le schéma documenté en tête de fichier. Une construction non
# reconnue est ignorée en silence plutôt qu'inventée, comme lire_yaml() de szh_commun.

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
    """`notes` : dict[int, list[bloc]] (§4, révision du 19.09.2026) — les clés JSON sont des
    chaînes (contrainte du format), reconverties en int ici. Une entrée dont la clé n'est pas
    un entier est ignorée en silence, comme le reste de cette désérialisation (voir l'en-tête
    du fichier) ; une ANCIENNE trace au format liste (avant cette révision) est acceptée en
    repli, toutes ses notes regroupées sous la clé 0 — mieux qu'une perte totale."""
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
                     source=obj.get('source'))


# ---------------------------------------------------------------------------------
# Sérialisation JSON — le sens inverse, pour que le mode --diagnostic rende non seulement
# les DÉCISIONS (trace) mais l'ÉTAT RÉEL du document une fois muté : sans ça, un test ne
# peut vérifier que ce qui doit survivre (italique, exposant, indice, liens) a vraiment
# survécu — il ne peut lire que ce que le module RACONTE avoir fait dans le motif, jamais ce
# qu'il a fait réellement. `octets` n'est jamais renvoyé (ce module n'écrit pas de .docx) ;
# seule sa longueur informe, pour ne pas prétendre transporter un contenu binaire silencieux.

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
    # `notes` : dict[int, list[bloc]] (§4, révision du 19.09.2026) — JSON n'a que des clés
    # chaîne, converties ici ; document_depuis_json() fait le chemin inverse.
    return {'styles': list(document.styles), 'langue': document.langue,
            'revisions': document.revisions, 'commentaires': document.commentaires,
            'notes': {str(id_note): [bloc_vers_json(b) for b in blocs]
                      for id_note, blocs in document.notes.items()},
            'blocs': [bloc_vers_json(b) for b in document.blocs], 'source': document.source}


# ---------------------------------------------------------------------------------
# Mode diagnostic — sur le modèle de la CLI de docx-titres.py (celle de pronto_modele.py,
# elle, n'a pas de CLI : principal() y est une fonction de bibliothèque). C'est ce mode qui
# rend ce module testable avant que manuscrit_docx.py / manuscrit_odt.py n'existent.

def principal(argv):
    if '--diagnostic' not in argv[1:]:
        print('usage : manuscrit_modele.py --diagnostic   (Document JSON sur stdin)',
              file=sys.stderr)
        return 2

    try:
        sys.stdin.reconfigure(encoding='utf-8')
        # stderr aussi : le message d'erreur JSON ci-dessous porte un accent, et la
        # console Windows (cp1252) plante sur un accent combinant venu du partage.
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
        # L'état RÉEL du document après les deux passes — pas seulement ce que la trace dit
        # avoir fait. C'est lui qu'un test doit lire pour vérifier qu'un champ protégé
        # (italique, exposant, indice, `lien`) a bien survécu, et non seulement que le motif
        # en parle. Voir document_vers_json().
        'document': document_vers_json(document),
    }
    # ensure_ascii=True : la console Windows n'est pas garantie en UTF-8 (§2 du contrat, même
    # piège que wsl.exe) — l'échappement \uXXXX se relit sans perte en JSON, dans les deux sens.
    print(json.dumps(resultat, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
