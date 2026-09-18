#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_regles.py — le catalogue de règles et le moteur d'alertes du nettoyeur de
# manuscrit (article). Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §7.
#
# Source unique du catalogue : les deux PDF Redaktionsrichtlinien {Revue,Zeitschrift} 2025 —
# EUX SEULS font foi. Le fichier d'extraction (69 prescriptions, colonne « mécanisable »)
# n'est qu'une aide de travail ; les références de chapitre données ici les recopient.
#
# Ce module ne connaît NI Word NI OpenDocument (§3 : « Ne sait rien de : les formats »). Il
# reçoit un Contexte — un dict JSON simple, jamais les classes de manuscrit_modele.py — et ne
# regarde que des chaînes et des nombres déjà extraits par l'appelant. C'est délibéré : ce
# module ne devine JAMAIS quel paragraphe est le titre, le sous-titre ou le résumé de
# l'article — voir le schéma du Contexte plus bas, et la remarque du rapport de chantier sur
# ce trou du contrat.
#
# stdlib seule : re, json, collections.namedtuple. Aucune dépendance nouvelle.
#
# ── Ce que ce module NE fait PAS, et pourquoi (§7 et §10 du contrat) ───────────────────────
#
# 1. AUCUNE règle de typographie (famille Typo.* du fichier d'extraction : espace insécable,
#    apostrophe, guillemets, chevrons, nombres, tiret/cadratin, statistiques APA, raccourcis
#    clavier). C'est le travail de pipeline/filters/szh-typographie.lua, déjà écrit, déjà
#    éprouvé : en écrire une version Python serait un second moteur, que le contrat interdit
#    explicitement (§6). Les avertissements C1 (ß) et C2 (guillemets droits non appariés) que
#    ce filtre émet déjà sur stderr sont REPRIS tels quels comme alertes par
#    _reprendre_avertissements_typo() plus bas — jamais réimplémentés.
#
# 2. APA.SousTitre (extraction : « auto ») est écarté pour la MÊME raison bien qu'il ne soit
#    pas dans la famille Typo : la règle porte sur l'espace insécable avant « : », strictement
#    le métier du filtre lua.
#
# 3. Media.ResolutionImage et Media.TaillePortrait (extraction : « auto » côté allemand) sont
#    INMÉCANISABLES avec le modèle actuel : la classe Image du §4 du contrat ne porte qu'une
#    `surface` (EMU², une AIRE) et jamais une largeur/hauteur séparées ni le nombre de pixels
#    du fichier — impossible de calculer une résolution (px / pouce) à partir d'une aire seule
#    sans supposer un rapport largeur/hauteur qu'on ne connaît pas. C'est un trou du modèle
#    riche, pas de ce module ; signalé dans le rapport de chantier.
#
# 4. Ce qui exige un jugement sémantique plutôt qu'un motif (accord grammatical de proximité,
#    style passif/actif, choix d'un terme neutre vs un terme genré, contraste WCAG d'une
#    image, cohérence argumentative...) n'est PAS mécanisé : le classer « indice » puis
#    inventer une règle bruyante casserait le principe même du §7 (« le volume d'alertes est
#    un défaut »). Chaque renoncement de ce genre est listé dans le rapport de chantier, avec
#    sa raison précise — jamais juste tu.
#
# ── Le schéma du Contexte (JSON reçu par --diagnostiquer, sur stdin) ───────────────────────
#
#   {
#     "produit": "revue" | "zeitschrift",
#     "langue": "fr" | "de",
#     "paragraphes": [
#       {"source": 0, "texte": "…", "role": "titre", "niveau_retenu": 0}, ...
#     ],
#     "bibliographie": [
#       {"nom": "Dupont", "annee": 2020, "nb_auteurs": 3, "texte": "…", "source": 12}, ...
#     ],
#     "images": [ {"alt": "…", "source": 3}, ... ],
#     "tableaux": [ {"fusion": true, "source": 5}, ... ],
#     "avertissements_typo": [ "[typo-avertissement] eszett | article « … » | … | [de] …", ... ]
#   }
#
# `role` sur un paragraphe : '' (corps, valeur par défaut), 'titre', 'sous_titre', 'resume',
# 'bibliographie'. AUCUNE règle de ce module ne déduit ce rôle depuis le texte ou le style —
# c'est à l'appelant (manuscrit-nettoyer.py, ou le gabarit qui connaît les styles maison) de
# le fournir. Un rôle absent équivaut à '' : le paragraphe compte comme corps, jamais comme
# titre/sous-titre/résumé par défaut — un faux résumé mesuré serait pire qu'un résumé non
# mesuré.
#
# `niveau_retenu` reprend tel quel le champ de même nom rempli par
# manuscrit_modele.classer_titres() (0 = corps, 1..3 = titre). `bibliographie[i].texte` sert
# UNIQUEMENT à repérer une troncature déjà posée (« … » ou « ... ») — jamais à autre chose.
#
# ── La sortie d'une alerte (§7 du contrat, champs INCHANGÉS) ───────────────────────────────
#
#   {"rule": str, "severity": "error"|"warning"|"suggestion", "action": "fix"|"track"|
#    "comment"|"report", "para": int|None, "span": [int,int]|None, "found": str|None,
#    "suggested": str|None, "message": str}
#
# `chapitre` et `famille` ne sont PAS des champs d'alerte (le brief liste exactement 8 champs) —
# ils se retrouvent en cherchant la règle par `rule` dans CATALOGUE.

import json
import re
import sys
from collections import namedtuple

# ---------------------------------------------------------------------------------
# Seuils — TOUT nombre magique vit ici, avec sa provenance dans le fichier d'extraction
# (colonne « Seuils chiffrés »). La phase 2 de validation les fera bouger ; ils doivent
# bouger en un seul endroit (§11 du contrat).

# Forme.LongueurArticle : identique dans les deux documents, mais le PÉRIMÈTRE diffère —
# voir _signes_article_revue()/_signes_article_zeitschrift() : l'allemand inclut le résumé
# dans ce total, le français le traite à part (sa propre fourchette, ci-dessous).
LONGUEUR_ARTICLE_MAX = 18000

# Forme.LongueurResume : fourchette AVEC minimum en français, plafond SEUL en allemand.
RESUME_MIN_REVUE = 400
RESUME_MAX_REVUE = 600
RESUME_MAX_ZEITSCHRIFT = 700

# Forme.LongueurTitre / LongueurSousTitre / LongueurTitreChapitre : chiffrés UNIQUEMENT côté
# allemand (Checkliste) — le français reste qualitatif (« court et représentatif »), donc
# humain, jamais mécanisé ici pour la Revue.
TITRE_MAX_ZEITSCHRIFT = 100
SOUS_TITRE_MAX_ZEITSCHRIFT = 120
TITRE_CHAPITRE_MAX_ZEITSCHRIFT = 80

# Structure.NiveauxTitre : IDENTIQUE dans les deux documents (1.1 Mise en page / Checkliste).
NIVEAUX_TITRE_MAX = 3

# APA.NombreAuteursListes : identique (jusqu'à 20 nommés) ; au-delà, seul le français précise
# la procédure de troncature (19 premiers + « … » + dernier) — l'allemand ne dit rien, d'où
# la règle « signal » côté zeitschrift, qui ne peut que renvoyer à une décision humaine.
NB_AUTEURS_TRONCATURE = 20

# Forme.StyleNominal (allemand, indice) : nombre d'occurrences de suffixes de nominalisation
# (-ung/-heit/-keit) DANS UN MÊME PARAGRAPHE à partir duquel on juge le style trop nominal.
# Un seul mot en -ung est une langue allemande normale ; ce seuil borne le bruit — voir le
# principe anti-bruit du §7 (« deux cents signalements rendent l'outil détestable »).
SEUIL_STYLE_NOMINAL = 3


# ---------------------------------------------------------------------------------
# Une règle est une DONNÉE, pas une fonction (§7, forme imposée) : `detecter` est le seul
# champ appelable, et il porte la signature UNIQUE `detecter(contexte) -> [constat, ...]`,
# quelle que soit la nature de la règle (motif dans un paragraphe, seuil sur tout le
# document, cohérence d'une bibliographie...) — c'est ce qui permet à evaluer() de traiter
# tout le catalogue par une seule boucle, sans distinguer les familles.
Regle = namedtuple('Regle', ['id', 'famille', 'langue', 'produit', 'severite', 'action',
                              'chapitre', 'detecter', 'message_fr', 'message_de'])


# ---------------------------------------------------------------------------------
# Accès au Contexte — jamais direct : un champ manquant rend toujours '' / [] / 0, jamais
# une exception. Un Contexte incomplet doit produire MOINS d'alertes, jamais planter.

def _paragraphes(contexte):
    return contexte.get('paragraphes') or []


def _bibliographie(contexte):
    return contexte.get('bibliographie') or []


def _images(contexte):
    return contexte.get('images') or []


def _tableaux(contexte):
    return contexte.get('tableaux') or []


def _role(paragraphe):
    return paragraphe.get('role') or ''


def _signes_par_role(contexte, roles):
    return sum(len(p.get('texte') or '') for p in _paragraphes(contexte) if _role(p) in roles)


# ---------------------------------------------------------------------------------
# Forme — longueurs. Chaque seuil est comparé à un périmètre de rôles explicite ; voir la
# note en tête de fichier sur la divergence FR/DE du périmètre de l'article.

def _detecter_longueur_article_revue(contexte):
    # Revue (Essentiel en bref / 1 Aspects formels) : « 18 000 signes, références
    # bibliographiques et espaces compris » — le résumé n'est PAS mentionné, donc exclu.
    total = _signes_par_role(contexte, ('', 'corps', 'bibliographie'))
    if total > LONGUEUR_ARTICLE_MAX:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'réduire sous %d signes (résumé exclu de ce total)'
                               % LONGUEUR_ARTICLE_MAX}]
    return []


def _detecter_longueur_article_zeitschrift(contexte):
    # Zeitschrift (Checkliste) : « max. 18 000 signes, espaces, résumé et bibliographie
    # compris » — le résumé entre explicitement dans ce total, à la différence du français.
    total = _signes_par_role(contexte, ('', 'corps', 'bibliographie', 'resume'))
    if total > LONGUEUR_ARTICLE_MAX:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'réduire sous %d signes (résumé inclus dans ce total)'
                               % LONGUEUR_ARTICLE_MAX}]
    return []


def _detecter_longueur_resume_revue(contexte):
    total = _signes_par_role(contexte, ('resume',))
    if total == 0:
        return []  # aucun paragraphe étiqueté 'resume' : rien à juger, jamais deviné
    if total < RESUME_MIN_REVUE or total > RESUME_MAX_REVUE:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'entre %d et %d signes' % (RESUME_MIN_REVUE, RESUME_MAX_REVUE)}]
    return []


def _detecter_longueur_resume_zeitschrift(contexte):
    total = _signes_par_role(contexte, ('resume',))
    if total == 0:
        return []
    if total > RESUME_MAX_ZEITSCHRIFT:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'au plus %d signes' % RESUME_MAX_ZEITSCHRIFT}]
    return []


def _detecter_longueur_titre_zeitschrift(contexte):
    total = _signes_par_role(contexte, ('titre',))
    if total == 0:
        return []
    if total > TITRE_MAX_ZEITSCHRIFT:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'au plus %d signes' % TITRE_MAX_ZEITSCHRIFT}]
    return []


def _detecter_longueur_sous_titre_zeitschrift(contexte):
    total = _signes_par_role(contexte, ('sous_titre',))
    if total == 0:
        return []
    if total > SOUS_TITRE_MAX_ZEITSCHRIFT:
        return [{'para': None, 'span': None, 'found': '%d signes' % total,
                 'suggested': 'au plus %d signes' % SOUS_TITRE_MAX_ZEITSCHRIFT}]
    return []


def _detecter_longueur_titre_chapitre_zeitschrift(contexte):
    constats = []
    for p in _paragraphes(contexte):
        if (p.get('niveau_retenu') or 0) in (1, 2, 3):
            texte = p.get('texte') or ''
            if len(texte) > TITRE_CHAPITRE_MAX_ZEITSCHRIFT:
                constats.append({'para': p.get('source'), 'span': [0, len(texte)],
                                  'found': '%d signes' % len(texte),
                                  'suggested': 'au plus %d signes'
                                               % TITRE_CHAPITRE_MAX_ZEITSCHRIFT})
    return constats


# ---------------------------------------------------------------------------------
# Structure — niveaux de titre (identique FR/DE) et majuscule de renvoi (FR seul, chapitre
# 1.3 absent du document allemand).

def _detecter_niveaux_titre(contexte):
    constats = []
    for p in _paragraphes(contexte):
        niveau = p.get('niveau_retenu') or 0
        if niveau > NIVEAUX_TITRE_MAX:
            constats.append({'para': p.get('source'), 'span': None,
                              'found': 'niveau %d' % niveau,
                              'suggested': 'au plus %d niveaux de titre' % NIVEAUX_TITRE_MAX})
    return constats


# Renvoi à une figure/un tableau/un chapitre/une annexe : la première lettre est TOUJOURS en
# majuscule. Le motif est volontairement en minuscules littérales (sans re.IGNORECASE) : il
# ne doit matcher QUE la forme fautive, jamais « Figure 3 » déjà correct.
RE_RENVOI_MINUSCULE = re.compile(r'\b(figure|tableau|chapitre|annexe)\s+(\d+|[A-Z])\b')


def _detecter_majuscule_reference(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_RENVOI_MINUSCULE.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0),
                              'suggested': m.group(1).capitalize() + ' ' + m.group(2)})
    return constats


# ---------------------------------------------------------------------------------
# Épicène — LE FAIT QUI COMMANDE TOUT (voir le brief) : les deux revues prescrivent des
# solutions EXACTEMENT opposées. Une seule règle appliquée aux deux serait fausse à l'envers
# pour l'une des deux. Voici pourquoi le catalogue porte deux jeux de motifs disjoints,
# jamais un seul « forme contractée = faute » générique.
#
# Côté français (Revue, 2.2) : la barre oblique, la parenthèse et la majuscule intérieure
# sont explicitement proscrites — ET le deux-points, qui n'a pas d'exception dans ce
# document, tombe donc sous l'interdiction générale des « formes contractées ».
RE_FORME_SLASH = re.compile(r'\b([a-zà-öø-ÿ]{3,})/([a-zà-öø-ÿ]{1,8}s?)\b', re.IGNORECASE)
RE_FORME_PARENTHESE = re.compile(r'\b[a-zà-öø-ÿ]{3,}\((?:e|ne|le|trice|euse)\)s?\b',
                                  re.IGNORECASE)
RE_FORME_MAJUSCULE_INTERIEURE = re.compile(r'\b[a-zà-öø-ÿ]{2,}[A-ZÉÈ][a-zà-öø-ÿ]*s?\b')
RE_FORME_DEUXPOINTS = re.compile(r'\b[a-zà-öø-ÿ]{3,}(?::[a-zà-öø-ÿ]{1,6}){1,3}\b', re.IGNORECASE)

FORMES_INTERDITES_FR = (
    (RE_FORME_SLASH, 'barre oblique'),
    (RE_FORME_PARENTHESE, 'parenthèse'),
    (RE_FORME_MAJUSCULE_INTERIEURE, 'majuscule intérieure'),
    (RE_FORME_DEUXPOINTS,
     'deux-points (proscrit aussi en français : à la différence de l’allemand, ce '
     'document ne l’excepte pas de l’interdiction générale des formes contractées)'),
)


def _detecter_formes_contractees_fr(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for regex, nature in FORMES_INTERDITES_FR:
            for m in regex.finditer(texte):
                constats.append(
                    {'para': p.get('source'), 'span': [m.start(), m.end()], 'found': m.group(0),
                     'suggested': 'forme double complète, en toutes lettres, féminin en '
                                  'premier (ex. « éducatrice et éducateur ») — %s proscrite'
                                  % nature})
    return constats


# Trait d'union, point médian, point : ABSENTS des lignes directrices françaises. Détectables,
# jamais en `error` — on n'invente pas une interdiction que le PDF ne porte pas (brief, §
# épicène). Toujours en `suggestion`.
RE_FORME_TIRET = re.compile(r'\b[a-zà-öø-ÿ]{3,}-e(?:-s)?\b', re.IGNORECASE)
RE_FORME_POINT_MEDIAN = re.compile(r'\b[a-zà-öø-ÿ]{3,}·[a-zà-öø-ÿ]{1,8}(?:·s)?\b',
                                    re.IGNORECASE)
RE_FORME_POINT = re.compile(r'\b[a-zà-öø-ÿ]{3,}\.(?:e|es)\b')

FORMES_NON_LISTEES_FR = (
    (RE_FORME_TIRET, 'trait d’union'),
    (RE_FORME_POINT_MEDIAN, 'point médian'),
    (RE_FORME_POINT, 'point'),
)


def _detecter_formes_non_listees_fr(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for regex, nature in FORMES_NON_LISTEES_FR:
            for m in regex.finditer(texte):
                constats.append(
                    {'para': p.get('source'), 'span': [m.start(), m.end()], 'found': m.group(0),
                     'suggested': 'forme à %s : absente des lignes directrices françaises — '
                                  'à discuter avec la rédaction, jamais imposée comme faute'
                                  % nature})
    return constats


# Côté allemand (Zeitschrift, Geschlechtergerechte und inklusive Sprache) : le deux-points
# est la solution PRESCRITE (Schüler:innen) — aucun motif ci-dessous ne le reconnaît, donc
# aucune règle de ce module ne peut jamais le signaler en produit zeitschrift. Ce qui EST
# proscrit ici : la forme double avec « und », la forme à barre oblique, la majuscule
# intérieure (Binnen-I, motif volontairement SANS re.IGNORECASE : seul le grand I compte),
# l'astérisque de genre et le tiret bas de genre.
RE_PAARFORM_UND = re.compile(r'\bdie\s+[a-zäöüß]+innen\s+und\s+[a-zäöüß]+\b', re.IGNORECASE)
RE_PAARFORM_SLASH = re.compile(
    r'\b(?:der|die|des|dem|den)/(?:der|die|des|dem|den)\s+[a-zäöüß]+/in\b', re.IGNORECASE)
RE_PAARFORM_BINNEN_I = re.compile(r'\b[A-ZÄÖÜ][a-zäöüß]+I[a-zäöüß]*\b')
RE_PAARFORM_GENDERSTERN = re.compile(r'\b[a-zäöüßA-ZÄÖÜ]+\*(?:in|innen)\b')
RE_PAARFORM_GENDERGAP = re.compile(r'\b[a-zäöüßA-ZÄÖÜ]+_(?:in|innen)\b')

FORMES_INTERDITES_DE = (
    (RE_PAARFORM_UND, 'Paarform mit "und"'),
    (RE_PAARFORM_SLASH, 'Schrägstrich-Paarform'),
    (RE_PAARFORM_BINNEN_I, 'Binnen-I'),
    (RE_PAARFORM_GENDERSTERN, 'Genderstern'),
    (RE_PAARFORM_GENDERGAP, 'Gendergap'),
)


def _detecter_paarform_de(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for regex, nature in FORMES_INTERDITES_DE:
            for m in regex.finditer(texte):
                constats.append(
                    {'para': p.get('source'), 'span': [m.start(), m.end()], 'found': m.group(0),
                     'suggested': 'Schreibweise mit Doppelpunkt (z. B. « Schüler:innen ») '
                                  'statt %s' % nature})
    return constats


# ---------------------------------------------------------------------------------
# Vocabulaire — LE PIÈGE OQLF/CSPS nommé par le brief : « personne en situation de
# handicap » (recommandé par les lignes directrices CSPS/MDH-PPH) ne doit JAMAIS lever
# d'alerte. Le motif ci-dessous cible EXCLUSIVEMENT « personne(s) handicapée(s) » (le terme
# que l'OQLF privilégie) — la locution « en situation de » qui sépare « personne » de
# « handicap » dans la forme recommandée le rend structurellement inatteignable par ce motif.

RE_HANDICAP_OQLF = re.compile(r'\bpersonnes?\s+handicap[ée]e?s?\b', re.IGNORECASE)
RE_BESOIN_PARTICULIER = re.compile(
    r'\bélèves?\s+à\s+besoins?\s+éducatifs?\s+particuliers?\b', re.IGNORECASE)
RE_PLACE_HANDICAPES = re.compile(
    r'\bplaces?\s+(?:réservées?\s+)?pour\s+(?:les\s+)?handicapés?\b', re.IGNORECASE)

VOCABULAIRE_FR = (
    (RE_HANDICAP_OQLF, 'personne(s) en situation de handicap'),
    (RE_BESOIN_PARTICULIER, 'élèves bénéficiant d’un soutien éducatif'),
    (RE_PLACE_HANDICAPES, 'places accessibles'),
)


def _detecter_vocabulaire_handicap_fr(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for regex, suggestion in VOCABULAIRE_FR:
            for m in regex.finditer(texte):
                constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                                  'found': m.group(0), 'suggested': suggestion})
    return constats


RE_BEHINDERT = re.compile(r'\bbehinderte[nrs]?\s+(Mensch\w*|Kind\w*|Person\w*|Schüler\w*)\b',
                           re.IGNORECASE)


def _detecter_non_stigmatisant_de(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_BEHINDERT.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0), 'suggested': 'Menschen mit Behinderung(en)'})
    return constats


# ---------------------------------------------------------------------------------
# APA — références bibliographiques. Beaucoup de « auto » ici : ce sont des motifs textuels
# étroits, choisis pour ne jamais confondre une citation avec de la prose ordinaire.

RE_PARENTHESE = re.compile(r'\([^()]*\)')
RE_ANNEE = re.compile(r'(?:19|20)\d{2}')


def _spans_parentheses(texte):
    return [m.span() for m in RE_PARENTHESE.finditer(texte)]


def _dans_une_span(position, spans):
    return any(s[0] <= position < s[1] for s in spans)


def _fabriquer_detecteur_apa_liaison(mot_liaison):
    """APA.DeuxAuteurs : « et »/« und » dans le texte courant, « & » entre parenthèses —
    jamais l'inverse. Un seul détecteur, paramétré par le mot de liaison de la langue, pour
    ne pas dupliquer la logique entre le français et l'allemand."""
    motif_mot = re.compile(r'\b%s\b' % mot_liaison, re.IGNORECASE)

    def _detecter(contexte):
        constats = []
        for p in _paragraphes(contexte):
            texte = p.get('texte') or ''
            spans = _spans_parentheses(texte)
            for m in re.finditer(r'&', texte):
                if not _dans_une_span(m.start(), spans):
                    constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                                      'found': '&', 'suggested': mot_liaison})
            for s in spans:
                sous = texte[s[0]:s[1]]
                if RE_ANNEE.search(sous):
                    for m in motif_mot.finditer(sous):
                        constats.append({'para': p.get('source'),
                                          'span': [s[0] + m.start(), s[0] + m.end()],
                                          'found': m.group(0), 'suggested': '&'})
        return constats

    return _detecter


_detecter_apa_liaison_fr = _fabriquer_detecteur_apa_liaison('et')
_detecter_apa_liaison_de = _fabriquer_detecteur_apa_liaison('und')


# APA.TroisAuteursPlus, restreint à ce qui est mécanisable SANS connaître le nombre réel
# d'auteurs (donnée absente du texte courant) : la FORME de « et al. », qui doit porter son
# point final dans les deux documents.
RE_ET_AL_INCOMPLET = re.compile(r'\bet\s*al(?!\.)\b', re.IGNORECASE)


def _detecter_et_al(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_ET_AL_INCOMPLET.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0), 'suggested': m.group(0).rstrip() + '.'})
    return constats


# APA.MemeAuteurMemeAnnee : la lettre a/b/c colle à l'année, jamais d'espace intercalée.
RE_ANNEE_LETTRE_ESPACEE = re.compile(
    r'\(([A-ZÀ-Ý][\wÀ-ÿ\'-]*),\s*((?:19|20)\d{2})\s+([a-z])\)')


def _detecter_annee_lettre_espacee(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_ANNEE_LETTRE_ESPACEE.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0),
                              'suggested': '(%s, %s%s)' % (m.group(1), m.group(2), m.group(3))})
    return constats


# APA.CitationSecondeMain : la formule fixe, dans chaque langue.
RE_CITE_MAUVAIS_FR = re.compile(r'\bcité\s+(?:dans|in|chez)\b', re.IGNORECASE)
RE_ZIT_MAUVAIS_DE = re.compile(r'\bzit\.?\s*(?:in|bei)\b', re.IGNORECASE)


def _detecter_seconde_main_fr(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_CITE_MAUVAIS_FR.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0), 'suggested': 'cité par'})
    return constats


def _detecter_seconde_main_de(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_ZIT_MAUVAIS_DE.finditer(texte):
            constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                              'found': m.group(0), 'suggested': 'zit. nach'})
    return constats


# APA.CitationDirectePage : une citation directe entre guillemets, suivie d'une référence
# parenthétique qui porte une année mais aucun numéro de page (p./S.).
RE_CITATION_DIRECTE = re.compile(
    r'(«[^»]{3,200}»|“[^”]{3,200}”)\s*\(([^()]{0,120})\)')


def _detecter_citation_directe_page(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        for m in RE_CITATION_DIRECTE.finditer(texte):
            interieur = m.group(2)
            if RE_ANNEE.search(interieur) and not re.search(r'\b[pS]\.\s*\d', interieur):
                constats.append({'para': p.get('source'), 'span': [m.start(), m.end()],
                                  'found': m.group(0),
                                  'suggested': 'ajouter le numéro de page (p. / S.)'})
    return constats


# APA.OrdreAlphabetiqueBiblio / APA.NombreAuteursListes : nécessitent une bibliographie déjà
# extraite (nom, année, nombre d'auteurs) — donnée que ce module ne devine jamais, fournie
# par l'appelant dans contexte['bibliographie'].

def _detecter_ordre_biblio(contexte):
    constats = []
    precedent = None
    for e in _bibliographie(contexte):
        cle = (str(e.get('nom') or '').lower(), e.get('annee') or 0)
        if precedent is not None and cle < precedent:
            constats.append({'para': e.get('source'), 'span': None,
                              'found': '%s (%s)' % (e.get('nom'), e.get('annee')),
                              'suggested': 'reclasser par ordre alphabétique, puis '
                                           'chronologique pour un même auteur'})
        precedent = cle
    return constats


def _detecter_nb_auteurs_revue(contexte):
    constats = []
    for e in _bibliographie(contexte):
        nb = e.get('nb_auteurs') or 0
        texte = e.get('texte') or ''
        if nb > NB_AUTEURS_TRONCATURE and '…' not in texte and '...' not in texte:
            constats.append({'para': e.get('source'), 'span': None,
                              'found': '%d auteurs' % nb,
                              'suggested': 'tronquer : les 19 premiers, « … », puis le dernier'})
    return constats


def _detecter_nb_auteurs_zeitschrift(contexte):
    constats = []
    for e in _bibliographie(contexte):
        nb = e.get('nb_auteurs') or 0
        if nb > NB_AUTEURS_TRONCATURE:
            constats.append({'para': e.get('source'), 'span': None,
                              'found': '%d auteurs' % nb,
                              'suggested': 'règle non précisée au-delà de %d auteurs côté '
                                           'allemand — à trancher à la main'
                                           % NB_AUTEURS_TRONCATURE})
    return constats


# ---------------------------------------------------------------------------------
# Accessibilité — chapitre SANS équivalent allemand (§7 du brief). Actif en Revue, hérité en
# `suggestion` pour la Zeitschrift : deux entrées de catalogue par prescription, jamais une
# seule règle qui prétendrait tenir sa source des deux documents à la fois.

def _detecter_alt_manquant(contexte):
    constats = []
    for img in _images(contexte):
        if not (img.get('alt') or '').strip():
            constats.append({'para': img.get('source'), 'span': None,
                              'found': 'texte alternatif absent', 'suggested': None})
    return constats


def _detecter_tableau_fusionne(contexte):
    constats = []
    for tbl in _tableaux(contexte):
        if tbl.get('fusion'):
            constats.append({'para': tbl.get('source'), 'span': None,
                              'found': 'cellules fusionnées',
                              'suggested': 'tableau lisible linéairement, sans fusion'})
    return constats


# ---------------------------------------------------------------------------------
# Forme.StyleNominal (allemand, indice) : nominalisations concentrées dans un même paragraphe.

RE_NOMINALISATION = re.compile(r'\b\w+(?:ung|heit|keit)\b', re.IGNORECASE)


def _detecter_style_nominal_de(contexte):
    constats = []
    for p in _paragraphes(contexte):
        texte = p.get('texte') or ''
        occurrences = list(RE_NOMINALISATION.finditer(texte))
        if len(occurrences) >= SEUIL_STYLE_NOMINAL:
            constats.append({'para': p.get('source'),
                              'span': [occurrences[0].start(), occurrences[-1].end()],
                              'found': '%d nominalisations (-ung/-heit/-keit)'
                                       % len(occurrences),
                              'suggested': 'reformuler avec des verbes ou adjectifs'})
    return constats


# ---------------------------------------------------------------------------------
# LE CATALOGUE. Chaque `chapitre` recopie la colonne du fichier d'extraction (elle-même
# recopiée des PDF) — c'est la référence qui permet à la rédaction de contester une alerte.

CATALOGUE = [
    Regle('Forme.LongueurArticle.Revue', 'Forme', 'fr', 'revue', 'error', 'report',
          'Revue: Essentiel en bref / 1 Aspects formels', _detecter_longueur_article_revue,
          'Article trop long : %(found)s (résumé exclu, biblio et espaces compris).',
          ''),
    Regle('Forme.LongueurArticle.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_article_zeitschrift,
          '',
          'Artikel zu lang: %(found)s (Zusammenfassung und Literaturverzeichnis inklusive).'),
    Regle('Forme.LongueurResume.Revue', 'Forme', 'fr', 'revue', 'error', 'report',
          'Revue: Essentiel en bref', _detecter_longueur_resume_revue,
          'Résumé hors fourchette : %(found)s.', ''),
    Regle('Forme.LongueurResume.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_resume_zeitschrift,
          '', 'Zusammenfassung zu lang: %(found)s.'),
    Regle('Forme.LongueurTitre.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_titre_zeitschrift,
          '', 'Titel zu lang: %(found)s.'),
    Regle('Forme.LongueurSousTitre.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error', 'report',
          'Zeitschrift: Checkliste', _detecter_longueur_sous_titre_zeitschrift,
          '', 'Untertitel zu lang: %(found)s.'),
    Regle('Forme.LongueurTitreChapitre.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'error',
          'report', 'Zeitschrift: Checkliste', _detecter_longueur_titre_chapitre_zeitschrift,
          '', 'Kapitelüberschrift zu lang: %(found)s.'),
    Regle('Structure.NiveauxTitre', 'Structure', '', '', 'error', 'report',
          'Revue: 1.1 Mise en page / Zeitschrift: Checkliste', _detecter_niveaux_titre,
          'Niveau de titre non autorisé : %(found)s.',
          'Nicht erlaubte Titelebene: %(found)s.'),
    Regle('Structure.MajusculeReference', 'Structure', 'fr', 'revue', 'warning', 'fix',
          'Revue: 1.3 Références', _detecter_majuscule_reference,
          'Un renvoi commence par une majuscule : « %(found)s ».', ''),

    Regle('Epicene.FormesContracteesProscrites', 'Epicene', 'fr', 'revue', 'error', 'comment',
          'Revue: 2.2 Langage épicène', _detecter_formes_contractees_fr,
          'Forme épicène contractée proscrite : « %(found)s ».', ''),
    Regle('Epicene.FormesNonListeesSuggestion', 'Epicene', 'fr', 'revue', 'suggestion', 'comment',
          'Revue: 2.2 Langage épicène (forme non explicitement listée par le PDF)',
          _detecter_formes_non_listees_fr,
          'Forme épicène à vérifier (non listée par les lignes directrices) : « %(found)s ».',
          ''),
    Regle('Epicene.PaarformProscrites', 'Epicene', 'de', 'zeitschrift', 'error', 'comment',
          'Zeitschrift: Sprachliche Richtlinien / Geschlechtergerechte und inklusive Sprache',
          _detecter_paarform_de,
          '', 'Nicht empfohlene Paarform/Symbol: « %(found)s ».'),

    Regle('Vocabulaire.HandicapTermePreferentiel', 'Vocabulaire', 'fr', 'revue', 'suggestion',
          'comment', 'Revue: 2.3 Vocabulaire', _detecter_vocabulaire_handicap_fr,
          'Terme à reconsidérer : « %(found)s » (voir %(suggested)s).', ''),
    Regle('Vocabulaire.NonStigmatisantZeitschrift', 'Vocabulaire', 'de', 'zeitschrift',
          'warning', 'comment',
          'Zeitschrift: Sprachliche Richtlinien / Keine stigmatisierende Sprache',
          _detecter_non_stigmatisant_de,
          '', 'Stigmatisierende Formulierung: « %(found)s ».'),

    Regle('APA.DeuxAuteurs.Revue', 'APA', 'fr', 'revue', 'warning', 'fix',
          'Revue: 3.1.3', _detecter_apa_liaison_fr,
          '« %(found)s » à remplacer par « %(suggested)s » (citation à deux auteurs).', ''),
    Regle('APA.DeuxAuteurs.Zeitschrift', 'APA', 'de', 'zeitschrift', 'warning', 'fix',
          'Zeitschrift: Weitere Regeln', _detecter_apa_liaison_de,
          '', '« %(found)s » durch « %(suggested)s » ersetzen (Zitat mit zwei Autoren).'),
    Regle('APA.TroisAuteursPlus', 'APA', '', '', 'warning', 'fix',
          'Revue: 3.1.3 / Zeitschrift: Weitere Regeln', _detecter_et_al,
          '« et al. » doit porter son point final : « %(found)s ».',
          '« et al. » muss mit Punkt enden: « %(found)s ».'),
    Regle('APA.MemeAuteurMemeAnnee', 'APA', '', '', 'warning', 'fix',
          'Revue: 3.1.2 / 3.2.1 / Zeitschrift: Sinngemässe Zitate im Text / Anordnung',
          _detecter_annee_lettre_espacee,
          'La lettre colle à l’année, sans espace : « %(found)s ».',
          'Der Buchstabe klebt am Jahr, ohne Leerzeichen: « %(found)s ».'),
    Regle('APA.CitationSecondeMain.Revue', 'APA', 'fr', 'revue', 'warning', 'fix',
          'Revue: 3.1.3', _detecter_seconde_main_fr,
          'Formule de citation de seconde main non conforme : « %(found)s ».', ''),
    Regle('APA.CitationSecondeMain.Zeitschrift', 'APA', 'de', 'zeitschrift', 'warning', 'fix',
          'Zeitschrift: Weitere Regeln', _detecter_seconde_main_de,
          '', 'Nicht konforme Formel für Sekundärzitate: « %(found)s ».'),
    Regle('APA.CitationDirectePage', 'APA', '', '', 'warning', 'comment',
          'Revue: 3.1.1 / Zeitschrift: Wörtliche Zitate im Text',
          _detecter_citation_directe_page,
          'Citation directe sans numéro de page : « %(found)s ».',
          'Wörtliches Zitat ohne Seitenangabe: « %(found)s ».'),
    Regle('APA.OrdreAlphabetiqueBiblio', 'APA', '', '', 'warning', 'report',
          'Revue: 3.2.1 / Zeitschrift: Literaturverzeichnis / Anordnung',
          _detecter_ordre_biblio,
          'Référence mal classée : %(found)s.', 'Falsch eingeordnete Referenz: %(found)s.'),
    Regle('APA.NombreAuteursListes.Revue', 'APA', 'fr', 'revue', 'error', 'comment',
          'Revue: 3.2.2.1', _detecter_nb_auteurs_revue,
          'Liste d’auteurs non tronquée : %(found)s.', ''),
    Regle('APA.NombreAuteursListes.Zeitschrift', 'APA', 'de', 'zeitschrift', 'suggestion',
          'report', 'Zeitschrift: Literaturverzeichnis / Anordnung',
          _detecter_nb_auteurs_zeitschrift,
          '', 'Mehr als %d Autor:innen: %%(found)s.' % NB_AUTEURS_TRONCATURE),

    Regle('A11y.TexteAlternatif.Revue', 'A11y', 'fr', 'revue', 'warning', 'comment',
          'Revue: 2.4.2 Images et schéma', _detecter_alt_manquant,
          'Image sans texte alternatif.', ''),
    Regle('A11y.TexteAlternatif.ZeitschriftHeritee', 'A11y', '', 'zeitschrift', 'suggestion',
          'comment',
          'Revue: 2.4.2 (hérité — aucun chapitre équivalent dans le document allemand)',
          _detecter_alt_manquant,
          '', 'Bild ohne Alternativtext (aus der Revue übernommen, keine deutsche Quelle).'),
    Regle('A11y.TableauLineaire.Revue', 'A11y', 'fr', 'revue', 'warning', 'comment',
          'Revue: 2.4.3 Tableaux', _detecter_tableau_fusionne,
          'Tableau avec cellules fusionnées : lecture linéaire compromise.', ''),
    Regle('A11y.TableauLineaire.ZeitschriftHeritee', 'A11y', '', 'zeitschrift', 'suggestion',
          'comment',
          'Revue: 2.4.3 (hérité — aucun chapitre équivalent dans le document allemand)',
          _detecter_tableau_fusionne,
          '', 'Tabelle mit verschmolzenen Zellen (aus der Revue übernommen).'),

    Regle('Forme.StyleNominal.Zeitschrift', 'Forme', 'de', 'zeitschrift', 'suggestion',
          'comment', 'Zeitschrift: Sprachliche Richtlinien / Nominalstil vermeiden',
          _detecter_style_nominal_de,
          '', 'Möglicher Nominalstil: %(found)s in einem Absatz.'),
]

CATALOGUE_PAR_ID = {r.id: r for r in CATALOGUE}


# ---------------------------------------------------------------------------------
# Reprise des avertissements du filtre typographique — JAMAIS réimplémentés (§6/§7 du
# contrat), seulement redécoupés depuis la ligne stderr que szh-typographie.lua émet déjà :
#   [typo-avertissement] <code> | article « <slug> » | <phrase fr> | [de] <phrase de>

RE_TYPO_AVERTISSEMENT = re.compile(
    r'^\[typo-avertissement\]\s+(\S+)\s+\|\s+article\s+«[^»]*»\s+\|\s+(.*?)\s+\|\s+\[de\]\s+(.*)$')


def _reprendre_avertissements_typo(contexte, langue):
    alertes = []
    for ligne in contexte.get('avertissements_typo') or []:
        m = RE_TYPO_AVERTISSEMENT.match(ligne)
        if not m:
            continue
        code, phrase_fr, phrase_de = m.groups()
        message = phrase_de if langue == 'de' and phrase_de else phrase_fr
        alertes.append({'rule': 'Typo.' + code, 'severity': 'warning', 'action': 'report',
                         'para': None, 'span': None, 'found': code, 'suggested': None,
                         'message': message})
    return alertes


# ---------------------------------------------------------------------------------
# Le moteur. Une règle ne s'exécute que si son `produit`/sa `langue` correspond au Contexte
# (chaîne vide = les deux) — c'est LE mécanisme qui rend le sens d'une règle réversible entre
# les deux revues sans jamais faire tourner un motif hors de son produit.

def evaluer(contexte):
    produit = contexte.get('produit') or ''
    langue = contexte.get('langue') or ''
    alertes = []
    for regle in CATALOGUE:
        if regle.produit and regle.produit != produit:
            continue
        if regle.langue and regle.langue != langue:
            continue
        for constat in (regle.detecter(contexte) or []):
            gabarit_message = regle.message_de if (langue == 'de' and regle.message_de) \
                else regle.message_fr
            champs = {'found': constat.get('found'), 'suggested': constat.get('suggested')}
            try:
                message = gabarit_message % champs
            except (KeyError, ValueError, TypeError):
                message = gabarit_message
            alertes.append({
                'rule': regle.id,
                'severity': regle.severite,
                'action': regle.action,
                'para': constat.get('para'),
                'span': constat.get('span'),
                'found': constat.get('found'),
                'suggested': constat.get('suggested'),
                'message': message,
            })
    alertes.extend(_reprendre_avertissements_typo(contexte, langue))
    return alertes


# ---------------------------------------------------------------------------------
# Groupement par famille et compte par règle — §7/§10 du contrat : « le volume d'alertes est
# un défaut ». Au-delà de dix occurrences d'une même règle, on garde les dix premières et le
# total, jamais la liste complète.

MAX_EXEMPLES_PAR_REGLE = 10


def grouper(alertes):
    par_famille = {}
    par_regle = {}
    for a in alertes:
        regle = CATALOGUE_PAR_ID.get(a['rule'])
        famille = regle.famille if regle is not None else 'Typo'
        par_famille[famille] = par_famille.get(famille, 0) + 1
        par_regle.setdefault(a['rule'], []).append(a)

    resume_par_regle = {}
    for identifiant, lot in par_regle.items():
        resume_par_regle[identifiant] = {
            'total': len(lot),
            'exemples': lot[:MAX_EXEMPLES_PAR_REGLE],
        }
    return {'par_famille': par_famille, 'par_regle': resume_par_regle}


# ---------------------------------------------------------------------------------
# CLI de diagnostic — même patron que manuscrit_modele.py --diagnostic : JSON sur stdin,
# JSON ASCII pur sur stdout (ensure_ascii=True, console Windows non garantie en UTF-8).
# `--catalogue` sert aux tests qui vérifient le catalogue lui-même (référence de chapitre,
# comptage par famille/produit) sans avoir à fabriquer un Contexte.

def principal(argv):
    args = argv[1:]

    if '--catalogue' in args:
        try:
            sys.stdout.reconfigure(encoding='utf-8')
        except Exception:
            pass
        print(json.dumps([
            {'id': r.id, 'famille': r.famille, 'langue': r.langue, 'produit': r.produit,
             'severite': r.severite, 'action': r.action, 'chapitre': r.chapitre}
            for r in CATALOGUE], ensure_ascii=True))
        return 0

    if '--diagnostiquer' not in args:
        print('usage : manuscrit_regles.py --diagnostiquer   (Contexte JSON sur stdin)\n'
              '        manuscrit_regles.py --catalogue        (liste le catalogue)',
              file=sys.stderr)
        return 2

    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
        # stderr aussi : le message d'erreur JSON ci-dessous porte un accent, et la
        # console Windows (cp1252) plante sur un accent combinant venu du partage.
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    try:
        contexte = json.loads(sys.stdin.read())
    except Exception as e:
        print('[manuscrit_regles] JSON d\'entrée illisible : %s' % e, file=sys.stderr)
        return 1

    alertes = evaluer(contexte)
    resultat = {'alertes': alertes, 'groupes': grouper(alertes)}
    print(json.dumps(resultat, ensure_ascii=True))
    return 1 if any(a['severity'] == 'error' for a in alertes) else 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
