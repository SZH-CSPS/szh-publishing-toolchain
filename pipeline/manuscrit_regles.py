#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_regles.py — le catalogue de règles STRUCTURELLES et le moteur d'alertes du
# nettoyeur de manuscrit (article). Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md,
# §7.
#
# ⚠ Révision du 19.09.2026 : les familles LEXICALES et ÉDITORIALES (langage épicène,
# vocabulaire du handicap, casse maison, liaison et/&, citation directe, nom des éditions)
# ont déménagé vers Vale — pipeline/vale/ (règles YAML) et pipeline/manuscrit_vale.py (le
# pont). Ce module ne garde que le STRUCTUREL, ce qu'un motif lexical ne peut pas voir :
# longueurs (article, résumé, titres), niveaux de titre, cohérence d'une bibliographie déjà
# extraite (ordre, troncature, année dupliquée), accessibilité, style nominal allemand. La
# frontière est la même que celle du §7 du contrat : « chaque couche de règles, un seul
# propriétaire ». Voir pipeline/vale/LISEZMOI.md pour ce qui a déménagé et pourquoi.
#
# Ce module ne connaît NI Word NI OpenDocument (§3 : « Ne sait rien de : les formats »). Il
# reçoit un Contexte — un dict JSON simple, jamais les classes de manuscrit_modele.py — et ne
# regarde que des chaînes et des nombres déjà extraits par l'appelant. C'est délibéré : ce
# module ne devine JAMAIS quel paragraphe est le titre, le sous-titre ou le résumé de
# l'article — voir le schéma du Contexte plus bas.
#
# stdlib seule : re, json, collections.namedtuple. Aucune dépendance nouvelle.
#
# ── Ce que ce module NE fait PAS, et pourquoi (§7 et §10 du contrat) ───────────────────────
#
# 1. AUCUNE règle de typographie (espace insécable, apostrophe, guillemets, chevrons,
#    nombres, tiret/cadratin, statistiques APA, raccourcis clavier). C'est le travail de
#    pipeline/filters/szh-typographie.lua, déjà écrit, déjà éprouvé. Les avertissements C1
#    (le ß) et C2 (guillemets droits non appariés) que ce filtre émet déjà sur stderr sont
#    REPRIS tels quels comme alertes par _reprendre_avertissements_typo() plus bas — jamais
#    réimplémentés.
#
# 2. AUCUNE règle LEXICALE ou ÉDITORIALE (langage épicène, vocabulaire du handicap, casse,
#    liaison et/&, citation directe, nom des éditions) : voir pipeline/vale/ ci-dessus.
#
# 3. Media.ResolutionImage et Media.TaillePortrait sont INMÉCANISABLES avec le modèle actuel :
#    la classe Image du §4 du contrat ne porte qu'une `surface` (EMU², une AIRE) et jamais une
#    largeur/hauteur séparées ni le nombre de pixels du fichier — impossible de calculer une
#    résolution (px / pouce) à partir d'une aire seule sans supposer un rapport largeur/
#    hauteur qu'on ne connaît pas. C'est un trou du modèle riche, pas de ce module.
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
#     "langue": "fr" | "de" | "fr-CH" | "de-CH" ...,
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
# `langue` : la CLI passera des codes courts (fr/de) après le lot en cours, mais ce module
# reste robuste à une sous-étiquette longue (fr-CH, de-CH) — voir _langue_courte() plus bas.
# `regle.langue`, lui, est TOUJOURS court ('fr', 'de', '') : c'est la comparaison qui
# normalise le côté Contexte, jamais le côté Regle.
#
# `role` sur un paragraphe : '' (corps, valeur par défaut), 'titre', 'sous_titre', 'resume',
# 'auteurs', 'mots_cles', 'bibliographie'. AUCUNE règle de ce module ne déduit ce rôle depuis
# le texte ou le style — c'est à l'appelant de le fournir. Un rôle absent équivaut à '' : le
# paragraphe compte comme corps, jamais comme titre/sous-titre/résumé/auteurs/mots-clés par
# défaut.
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
# dans ce total, le français le traite à part (sa propre fourchette, ci-dessous). Les rôles
# 'titre', 'sous_titre', 'auteurs' et 'mots_cles' sont TOUJOURS hors du compte, des deux
# côtés — c'est l'effet du filtre par ALLOWLIST de _signes_par_role() : seuls les rôles
# explicitement nommés dans le tuple entrent dans le total, tout le reste (y compris un rôle
# qui n'existe pas encore) en est exclu par construction, jamais par un oubli à maintenir ici.
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
# Langue — la sous-étiquette PRIMAIRE seule compte (fr de fr-CH, de de de-CH). `regle.langue`
# est toujours courte ; c'est le côté Contexte qu'on normalise, jamais l'inverse.

def _langue_courte(langue):
    return (langue or '').split('-')[0].strip().lower()


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
# Structure — un saut de niveau de titre (identique FR/DE, 1.1 Mise en page / Checkliste).
#
# ⚠ Révision du 19.09.2026 : l'ancienne version signalait un `niveau_retenu > 3`, un cas
# QUI NE PEUT PAS ARRIVER — manuscrit_modele.classer_titres() borne déjà `niveau_retenu` à
# 0..3 par construction (§4 du contrat). Ce contrôle était donc du code mort, qui ne pouvait
# jamais s'allumer. Ce qui EST un vrai problème structurel, et que celui-ci ne voyait pas :
# un document qui passe directement d'un titre de niveau 1 à un titre de niveau 3, sans
# jamais poser de niveau 2 entre les deux — la table des matières en devient trompeuse même
# si chaque niveau prIs isolément est valide.

def _detecter_saut_niveau_titre(contexte):
    constats = []
    niveau_max_vu = 0
    for p in _paragraphes(contexte):
        niveau = p.get('niveau_retenu') or 0
        if niveau == 0:
            continue
        # Le tout premier titre du document fixe son propre niveau de départ : commencer à
        # H2 (jamais de H1) n'est pas un saut, c'est un choix éditorial valide.
        if niveau_max_vu > 0 and niveau > niveau_max_vu + 1:
            constats.append({'para': p.get('source'), 'span': None,
                              'found': 'niveau %d après %d (aucun niveau %d)'
                                       % (niveau, niveau_max_vu, niveau_max_vu + 1),
                              'suggested': 'ajouter les niveaux intermédiaires, ou '
                                           'renuméroter ce titre au niveau %d'
                                           % (niveau_max_vu + 1)})
        niveau_max_vu = max(niveau_max_vu, niveau)
    return constats


# ---------------------------------------------------------------------------------
# APA — références bibliographiques et cohérence de la liste, ce qui ne relève pas d'un
# motif lexical mais d'une COMPARAISON entre entrées (ordre, troncature, doublon d'année).

RE_ANNEE = re.compile(r'(?:19|20)\d{2}')

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


# APA.OrdreAlphabetiqueBiblio / APA.NombreAuteursListes : nécessitent une bibliographie déjà
# extraite (nom, année, nombre d'auteurs) — donnée que ce module ne devine jamais, fournie
# par l'appelant dans contexte['bibliographie'].

def _detecter_ordre_biblio(contexte):
    constats = []
    precedent = None
    precedent_repr = None
    for e in _bibliographie(contexte):
        nom = e.get('nom')
        annee = e.get('annee')
        cle = (str(nom or '').lower(), annee or 0)
        # ⚠ Bug corrigé le 19.09.2026 : une entrée sans nom/année produisait littéralement
        # « None (None) » dans le message — jamais utile à une relectrice. Une entrée
        # incomplète n'entre plus dans la comparaison (elle ne peut pas être mal classée par
        # rapport à ce qu'on ne connaît pas), et n'est jamais citée par un texte inventé.
        if nom is None or annee is None:
            continue
        repr_lisible = '%s (%s)' % (nom, annee)
        if precedent is not None and cle < precedent:
            constats.append({'para': e.get('source'), 'span': None,
                              'found': repr_lisible,
                              'suggested': 'reclasser par ordre alphabétique, puis '
                                           'chronologique pour un même auteur (après %s)'
                                           % precedent_repr})
        precedent = cle
        precedent_repr = repr_lisible
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
# Les familles lexicales (Epicene, Vocabulaire, Casse, la liaison et/& et la citation
# directe) vivent maintenant dans pipeline/vale/ — voir l'en-tête de ce fichier.

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

    Regle('Structure.NiveauxTitre', 'Structure', '', '', 'warning', 'report',
          'Revue: 1.1 Mise en page / Zeitschrift: Checkliste', _detecter_saut_niveau_titre,
          'Saut de niveau de titre : %(found)s.',
          'Sprung in der Titelebene: %(found)s.'),

    Regle('APA.TroisAuteursPlus', 'APA', '', '', 'warning', 'fix',
          'Revue: 3.1.3 / Zeitschrift: Weitere Regeln', _detecter_et_al,
          '« et al. » doit porter son point final : « %(found)s ».',
          '« et al. » muss mit Punkt enden: « %(found)s ».'),
    Regle('APA.MemeAuteurMemeAnnee', 'APA', '', '', 'warning', 'fix',
          'Revue: 3.1.2 / 3.2.1 / Zeitschrift: Sinngemässe Zitate im Text / Anordnung',
          _detecter_annee_lettre_espacee,
          'La lettre colle à l’année, sans espace : « %(found)s ».',
          'Der Buchstabe klebt am Jahr, ohne Leerzeichen: « %(found)s ».'),
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


def _reprendre_avertissements_typo(contexte, langue_courte):
    alertes = []
    for ligne in contexte.get('avertissements_typo') or []:
        m = RE_TYPO_AVERTISSEMENT.match(ligne)
        if not m:
            continue
        code, phrase_fr, phrase_de = m.groups()
        message = phrase_de if langue_courte == 'de' and phrase_de else phrase_fr
        alertes.append({'rule': 'Typo.' + code, 'severity': 'warning', 'action': 'report',
                         'para': None, 'span': None, 'found': code, 'suggested': None,
                         'message': message})
    return alertes


# ---------------------------------------------------------------------------------
# Le moteur. Une règle ne s'exécute que si son `produit`/sa `langue` correspond au Contexte
# (chaîne vide = les deux) — c'est LE mécanisme qui rend le sens d'une règle réversible entre
# les deux revues sans jamais faire tourner un motif hors de son produit. La comparaison de
# langue se fait sur la SOUS-ÉTIQUETTE PRIMAIRE du Contexte (fr-CH -> fr) : `regle.langue`
# est toujours court, c'est le seul côté qui a besoin d'être normalisé.

def evaluer(contexte):
    produit = contexte.get('produit') or ''
    langue_courte = _langue_courte(contexte.get('langue'))
    alertes = []
    for regle in CATALOGUE:
        if regle.produit and regle.produit != produit:
            continue
        if regle.langue and regle.langue != langue_courte:
            continue
        for constat in (regle.detecter(contexte) or []):
            gabarit_message = regle.message_de if (langue_courte == 'de' and regle.message_de) \
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
    alertes.extend(_reprendre_avertissements_typo(contexte, langue_courte))
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
