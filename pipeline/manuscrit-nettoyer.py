#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit-nettoyer.py — la CLI du nettoyeur de manuscrit (article) : le CHAÎNON qui
# branche les six modules déjà écrits et éprouvés (manuscrit_docx, manuscrit_modele,
# manuscrit_typo, manuscrit_regles, manuscrit_gabarit), et rien d'autre. Contrat :
# docs/ARCHITECTURE-nettoyeur-manuscrit.md, §8 (cette CLI), §1 (les deux cas), §10
# (les pièges), §11 (les contrôles).
#
#   manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift --sortie <dossier>
#                         [--rapport <fichier.json>] [--format docx|odt] [--analyse-seule]
#                         [--sans-typo] [--sans-annotation] [--sans-reseau]
#
# Entrée .odt (point 2 du chantier « gabarits Pronto FR/DE + ODT », 29.09.2026) : convertie en
# .docx par conversion_odt.convertir() dans un dossier temporaire, AVANT md.lire() -- le reste
# de la chaîne ne parle que .docx (décision de Robin : un seul moteur). `entree` continue de
# désigner le chemin D'ORIGINE partout (rapport, messages, refus), jamais le .docx temporaire.
# Sortie .odt (point 3) : tout se fait en .docx comme aujourd'hui, puis le .docx final est
# converti en .odt et l'intermédiaire supprimé ; un échec de conversion garde le .docx, avec
# une alerte, jamais une perte.
#
# Convention du tiret (§3 du contrat) : ce fichier PORTE un tiret dans son nom, c'est une
# CLI, jamais un module importé par un autre fichier Python.
#
# stdlib seule : aucune dépendance nouvelle (§2 du contrat).
#
# Enchaînement (§8) : lire -> reconnaître le cas -> reconnaître l'en-tête (et le bloc final
# d'autrices/auteurs, §5.5) -> classer les titres -> nettoyer la mise en forme -> normaliser
# la typographie -> passer les règles (structurel + Vale + bibliographie) -> écrire le
# gabarit -> annoter le .docx écrit -> écrire le rapport.
#
# Pièges et décisions qui ne sont pas dans le contrat, à ne pas repayer :
#
# - Le rôle ('role') passé à manuscrit_regles.py n'est jamais deviné : 'titre' seulement pour
#   le tout premier bloc du document s'il porte un niveau de titre ; 'bibliographie' pour le
#   DERNIER paragraphe de titre reconnu par le lexique TITRES_BIB (szh-citations.lua) et tout
#   ce qui suit jusqu'à la fin ou un tableau (même critère que pronto_modele.etendue_biblio(),
#   reconstruit ici sur le modèle riche — le lexique et la comparaison viennent de
#   `pronto_modele.titre_est_biblio()`). 'sous_titre' et
#   'resume' ne sont jamais déduits en dehors de l'en-tête : rien ne les distingue de façon
#   fiable d'un intertitre ou d'un paragraphe de corps.
# - `bibliographie[i].nb_auteurs` reste TOUJOURS 0 pour le moteur STRUCTUREL
#   (`contexte['bibliographie']`) : dénombrer les auteurs d'une référence APA a son propre
#   harnais ailleurs dans ce dépôt, pas réinventé ici en trois lignes de regex.
#   `manuscrit_biblio.py`, lui, compte les auteurs pour de vrai et n'a jamais eu ce défaut.
# - Cas A : `manuscrit_gabarit.ecrire()` insérait toujours ses deux tableaux fixes, vides,
#   AVANT le corps — et recopiait dans le corps ceux, remplis, du document. Corrigé le
#   29.09.2026 (mesuré sur un document déjà au gabarit) : les tableaux fixes du document
#   prennent la place de ceux du gabarit (_tableaux_fixes_du_document), et ses clés « SZH Cle
#   Abb/Tab » restent des clés (_regrouper_blocs), au lieu de devenir du corps de texte.
# - Garde-fou « rien ne se perd » (29.09.2026) : les mots et les images du manuscrit sont
#   comptés avant tout traitement et recomptés dans le .docx écrit (_controler_perte). Une
#   perte au-delà de PERTE_ALERTE lève `Nettoyage.ContenuPerdu` (error) ; au-delà de
#   PERTE_REFUS, la sortie n'est pas livrée (code 2, code_refus « perte-de-contenu »).
# - La langue de traitement ('fr'/'de', pour le filtre, les règles et le rapport) vient
#   TOUJOURS du produit (`--produit revue` -> fr), jamais de `document.langue` : un article
#   français déclaré `de-CH` recevait sinon la typographie allemande. La langue déclarée ne
#   sert qu'à une alerte `Langue.DesaccordProduit` en cas de désaccord.
# - Un repli typographique (pandoc/WSL indisponible) lève `Typo.ApplicationImpossible` ;
#   `--sans-typo` compte comme "repli" sur la ligne stdout mais ne lève PAS cette alerte —
#   c'est un choix explicite, pas une panne.
# - Un fichier `~$*.docx` (verrou temporaire de Word) est refusé (code 2,
#   `code_refus='fichier-verrou'`) avant toute lecture, plutôt que de laisser `md.lire()`
#   échouer sans message pour la rédaction.
# - Vale et la bibliographie reçoivent chacun DEUX corpus (corps / bibliographie) — les
#   paragraphes de premier niveau, moins l'en-tête déjà retiré. Vale reçoit EN PLUS les
#   cellules de tableau et le contenu des notes, à toute profondeur, jamais ancrables dans le
#   .docx produit (`source=None`, voir `_paragraphes_cellules_pour_vale()`) : Vale doit les
#   voir quand même, même sans pouvoir y poser une révision.
# - `manuscrit_regles.grouper()` ne connaît que le catalogue structurel : les alertes Vale et
#   bibliographie ont leur propre regroupement ici (`_grouper_toutes_alertes()`).
# - `dans_docx` sur chaque alerte (`_marquer_dans_docx()`) est déduit PAR IDENTITÉ D'OBJET
#   (`id()`) des listes que `manuscrit_annoter.annoter()` rend, dans le MÊME processus —
#   jamais recalculé, jamais un aller-retour JSON.
# - Une révision dont le span touche la frontière d'un `<w:hyperlink>` peut rendre un
#   `word/document.xml` mal formé SANS lever d'exception (mesuré, 3 fichiers sur 12 du
#   corpus). La CLI valide donc elle-même chaque partie .xml/.rels après annotation
#   (`_valider_docx_bien_forme()`) et restaure la version pré-annotation si besoin, plutôt que
#   de livrer un .docx corrompu.

import collections
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import traceback
import unicodedata
import xml.etree.ElementTree as ET
import zipfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele
import conversion_odt
import manuscrit_docx as md
import manuscrit_modele as mm
import manuscrit_noms as mn
import manuscrit_entete as me
import manuscrit_typo as mt
import manuscrit_regles as mr
import manuscrit_vale as mv
import manuscrit_biblio as mb
import manuscrit_identifiants as mi
import manuscrit_gabarit as mg
import manuscrit_annoter as ma
import szh_commun
import manuscrit_controle as mc
# Le métier déplacé hors de la CLI (corpus des moteurs, garde-fou de perte) : noms ré-exportés
# ici, les tests et le reste de ce fichier les appellent sous leur nom d'origine.
from manuscrit_corpus import (
    ROLES_ENTETE_POUR_REGLES, _collecter_images, _collecter_tableaux,
    _construire_bibliographie, _construire_paragraphes_contexte, _entree_biblio,
    _marquer_notes_dans_alertes, _noms_de_bibliographie, _numeros_notes,
    _paragraphes_cellules_pour_vale, _paragraphes_entete_contexte,
    _paragraphes_notes_pour_vale, _parcourir_blocs)
from manuscrit_controle import (
    _controler_perte, _ecartes_par_entete, _mots_et_images, _valider_docx_bien_forme)

RACINE_DEPOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Un gabarit par produit (revue = FR, zeitschrift = DE, décision de Robin 29.09.2026) --
# jamais un chemin unique codé en dur : voir le point 1 du chantier « gabarits Pronto FR/DE
# + ODT ». `langue` (calculée plus bas depuis `--produit`) sélectionne la MÊME clé.
CHEMINS_GABARIT = {
    'revue': os.path.join(RACINE_DEPOT, 'revue-template', "Pronto - modele d'article_FR.docx"),
    'zeitschrift': os.path.join(RACINE_DEPOT, 'revue-template', "Pronto - modele d'article_DE.docx"),
}

PREFIXE = '[manuscrit-nettoyer]'

# Codes de sortie — mêmes valeurs que manuscrit_regles.principal() pour 0/1 (§7 : « code de
# sortie non nul dès la première alerte error »), deux valeurs propres à cette CLI en plus.
CODE_OK = 0
CODE_ALERTE_ERROR = 1
CODE_REFUS = 2
CODE_ECHEC_INTERNE = 3
# Une exception Python non rattrapée (défaut du logiciel) : rattrapée par principal(), jamais un
# code 1 (alertes error) ni 3 (lecture impossible) — le lanceur les distingue sans JSON à deviner.
CODE_PLANTAGE = 4


def _forcer_utf8():
    """§8 du contrat, clause non négociable : sans elle, pronto-lire.py (déjà dans ce dépôt)
    plante sur un nom de fichier accentué dès que la console Windows est en cp1252. Ce
    module force ses DEUX flux, jamais un seul."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8')
        except Exception:
            pass


AUTEUR_ANNOTATION = 'Relecture automatique'
# Les auteurs de révision que le nettoyeur pose lui-même : annotation, puis recherche ROR/ORCID.
AUTEURS_NETTOYEUR = {AUTEUR_ANNOTATION} | set(mg._AUTEUR_REVISION_IDENTIFIANTS.values())

# Les lignes de progression, gardées pour le rapport JSON : le lanceur ne les montre plus,
# elles n'existent plus que là (et sur stderr pour qui lance la CLI à la main).
_JOURNAL_PROGRES = []


def progres(message):
    """Une ligne de progression, sur stderr, jamais sur stdout (§8 : stdout ne porte QUE la
    ligne JSON finale). Gardée aussi dans `_JOURNAL_PROGRES`, pour le rapport."""
    _JOURNAL_PROGRES.append(str(message))
    print('%s %s' % (PREFIXE, message), file=sys.stderr, flush=True)


# Les constats `[import-avertissement]` émis par les modules de lecture (manuscrit_docx,
# manuscrit_modele...) passent par szh_commun.avertir, qui écrit sur stderr. Pendant un
# nettoyage, on les recueille au lieu de les laisser fuir : ils vont dans le rapport (JSON et
# HTML). SZH_IMPORT_LOG, s'il est posé, les reçoit toujours.
_AVERTISSEMENTS_IMPORT = []
_avertir_original = szh_commun.avertir


def _avertir_capture(prefixe, code, champs, fr, de, journal=None, flush=False):
    if mc._capture_suspendue:
        return _avertir_original(prefixe, code, champs, fr, de, journal=journal, flush=flush)
    ligne = szh_commun.formater_avertissement(prefixe, code, champs, fr, de)
    _AVERTISSEMENTS_IMPORT.append({'code': code, 'champs': list(champs), 'fr': fr, 'de': de})
    szh_commun.journaliser(ligne, journal if journal is not None else os.getenv('SZH_IMPORT_LOG'))
    return ligne


def _ligne_stdout(objet):
    """LA seule ligne que ce script écrit sur stdout, quel que soit le chemin de sortie
    (succès, refus, échec) — §8 : « rien d'autre sur ce flux »."""
    print(json.dumps(objet, ensure_ascii=True))


# ---------------------------------------------------------------------------------
# Compteurs d'usage et plantages (§8). Aucun texte du manuscrit n'y passe : ni nom de
# fichier, ni titre, ni auteur, ni message d'exception -- des noms de mesure d'une liste
# blanche, des entiers, un condensat du fichier d'entrée (`passage`). Le lanceur recopie
# l'objet tel quel dans un CSV partagé sans rien analyser.

ETAPES = (
    'demarrage', 'controle-entree', 'conversion-odt', 'lecture', 'gabarit', 'noms', 'entete',
    'identifiants', 'titres', 'formatage', 'typographie', 'regles', 'vale', 'bibliographie',
    'ecriture', 'controle-perte', 'annotation', 'conversion-sortie', 'rapport', 'sortie',
)
_ETAT = {'etape': 'demarrage', 'entree': '', 'produit': '', 'format_entree': '', 'debut': 0.0}

_RE_MESURE = re.compile(r'^[a-z0-9_.:-]{1,96}$')
_RE_ID_REGLE = re.compile(r'^[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+$')
_RE_MESURE_REGLE = re.compile(r'^regle:(Autre|[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+):'
                              r'(revision|commentaire|rapport)$')
_RE_CODE_REFUS = re.compile(r'^[a-z][a-z0-9-]{1,40}$')
MAX_ID_REGLE = 64
# La liste blanche du contrat : MESURES_NETTOYEUR de lib/compteurs.js (un test de parité la
# compare), plus deux familles à suffixe libre au motif étroit. Une mesure qui n'y est pas est
# écartée en silence, ici comme chez l'écrivain PowerShell et l'écrivain JS.
MESURES_NETTOYEUR = (
    'issue.ok', 'issue.alertes', 'issue.plantage', 'issue.interrompu', 'produit.revue',
    'produit.zeitschrift', 'cas.a', 'cas.b', 'format.entree.odt', 'format.sortie.odt',
    'langue.desaccord', 'signes', 'signes_biblio', 'paragraphes', 'references', 'notes', 'images',
    'images_sans_alt', 'duree_ms', 'plafond_commentaires_atteint', 'perte_mots', 'ecartes',
    'vale.indisponible', 'typo.repli', 'annotation.restauree', 'reseau.crossref.panne',
    'reseau.ror.panne', 'reseau.orcid.panne', 'doi.proposes', 'ror.proposes', 'orcid.proposes',
    'orcid.candidats', 'entete.auteurs', 'entete.champs_vides', 'entete.ordre_incertain')
_MOTIFS_MESURE_LIBRE = (re.compile(r'^issue\.refus:[a-z0-9_-]{1,48}$'),
                        re.compile(r'^titres\.[a-z0-9_]{1,40}$'))
_RE_TYPE_EXCEPTION = re.compile(r'^[A-Za-z_][A-Za-z0-9_]{0,63}$')
_RE_LIEU = re.compile(r'^[A-Za-z0-9_.-]{1,80}\.py:\d{1,6}$')
DEVENIRS = ('revision', 'commentaire', 'rapport')


def _etape(nom):
    """Pose l'étape en cours (un nom de la liste ETAPES) : c'est tout ce qu'un plantage dira
    de l'endroit où il est survenu, avec le fichier et la ligne du dépôt."""
    _ETAT['etape'] = nom if nom in ETAPES else 'inconnue'


def _passage(chemin):
    """Les 12 premiers hexadécimaux du SHA-256 du fichier d'entrée : le même fichier redonne le
    même passage, sans que rien du fichier ne se lise dans le condensat."""
    try:
        h = hashlib.sha256()
        with open(chemin, 'rb') as f:
            for bloc in iter(lambda: f.read(1 << 20), b''):
                h.update(bloc)
        return h.hexdigest()[:12]
    except Exception:
        return '0' * 12


def _mesure_regle(identifiant, devenir):
    """`regle:<Id>:<devenir>` ; un identifiant qui ne suit pas le motif des règles du catalogue
    devient `Autre`, un devenir inconnu devient `rapport`."""
    ident = (identifiant if isinstance(identifiant, str) and len(identifiant) <= MAX_ID_REGLE
             and _RE_ID_REGLE.fullmatch(identifiant) else 'Autre')
    return 'regle:%s:%s' % (ident, devenir if devenir in DEVENIRS else 'rapport')


def _compteurs(passage, mesures):
    """L'objet `compteurs` de la ligne stdout : `{'passage': 12 hex, 'mesures': {nom: entier}}`.
    Liste blanche par le NOM (motif du contrat) et par le TYPE : tout ce qui n'est pas un
    entier positif ou nul, ou dont le nom sort du motif, est écarté ; les zéros sont omis."""
    propres = {}
    for nom, valeur in mesures.items():
        if not isinstance(valeur, int) or isinstance(valeur, bool) or valeur <= 0:
            continue
        if not isinstance(nom, str):
            continue
        if nom.startswith('regle:'):
            if not _RE_MESURE_REGLE.fullmatch(nom):
                continue
        elif not (_RE_MESURE.fullmatch(nom) and (
                nom in MESURES_NETTOYEUR or any(m.fullmatch(nom) for m in _MOTIFS_MESURE_LIBRE))):
            continue
        propres[nom] = propres.get(nom, 0) + valeur
    return {'passage': passage if re.fullmatch(r'[0-9a-f]{12}', passage or '') else '0' * 12,
            'mesures': dict(sorted(propres.items()))}


def _duree_ms(debut=None):
    return int(round((time.perf_counter() - (debut if debut is not None else _ETAT['debut'])) * 1000))


def _mesures_minimales(issue, duree_ms, produit='', format_entree=''):
    """Les mesures d'un passage qui n'est pas allé au bout : l'issue, le produit et la durée."""
    mesures = {'issue.' + issue: 1, 'duree_ms': duree_ms}
    if produit in ('revue', 'zeitschrift'):
        mesures['produit.' + produit] = 1
    if format_entree == 'odt':
        mesures['format.entree.odt'] = 1
    return mesures


def _mesures_passage(issue, duree_ms, args, gabarit, format_entree, format_sortie, alertes,
                     alerte_langue, signes_total, signes_biblio, n_paragraphes, n_references,
                     n_notes, images, images_sans_alt, stats_annotation, annotation_restauree,
                     mesure_perte, ecartes_entete, vale_indisponible, statut_typo,
                     stats_biblio, stats_identifiants, entete, stats_titres):
    """Les mesures d'un passage qui a couru jusqu'au bout. Chaque valeur est un entier tiré d'un
    compte ou d'un statut, jamais d'un texte du manuscrit."""
    m = _mesures_minimales(issue, duree_ms, args['produit'], format_entree)
    m['cas.' + gabarit.lower()] = 1
    if format_sortie == 'odt':
        m['format.sortie.odt'] = 1
    if alerte_langue:
        m['langue.desaccord'] = 1
    m.update({'signes': signes_total, 'signes_biblio': signes_biblio,
              'paragraphes': n_paragraphes, 'references': n_references, 'notes': n_notes,
              'images': images, 'images_sans_alt': images_sans_alt})
    for a in alertes:
        nom = _mesure_regle(a.get('rule'), a.get('dans_docx') or 'rapport')
        m[nom] = m.get(nom, 0) + 1
    if stats_annotation and stats_annotation.get('plafond_global'):
        m['plafond_commentaires_atteint'] = 1
    if mesure_perte:
        m['perte_mots'] = int(mesure_perte.get('mots_manquants') or 0)
    if ecartes_entete:
        m['ecartes'] = len(ecartes_entete.get('elements') or [])
    if vale_indisponible:
        m['vale.indisponible'] = 1
    if statut_typo == 'repli' and not args['sans_typo']:
        m['typo.repli'] = 1
    if annotation_restauree:
        m['annotation.restauree'] = 1
    if stats_biblio:
        # `_hors_service` : une vraie panne du réseau. stats['crossref']['indisponible'] devient
        # vrai dès qu'un DOI ne répond pas (un 404 suffit) : mesuré le 01.10.2026 sur un manuscrit
        # réel, 4 DOI consultés dont 2 confirmés, `indisponible` vrai, `_hors_service` faux.
        if not args['sans_reseau'] and mb._hors_service:
            m['reseau.crossref.panne'] = 1
        m['doi.proposes'] = int(stats_biblio.get('doi_retrouves') or 0)
    if stats_identifiants:
        en_panne = stats_identifiants.get('en_panne') or []
        for service in ('ror', 'orcid'):
            if service in en_panne:
                m['reseau.%s.panne' % service] = 1
        m['ror.proposes'] = int(stats_identifiants.get('ror_trouves') or 0)
        m['orcid.proposes'] = int(stats_identifiants.get('orcid_trouves') or 0)
        m['orcid.candidats'] = int(stats_identifiants.get('orcid_candidats') or 0)
    if entete is not None:
        auteurs = entete.auteurs or []
        m['entete.auteurs'] = len(auteurs)
        m['entete.champs_vides'] = sum(
            1 for v in (entete.titre, entete.resume, entete.mots_cles, auteurs) if not v)
        m['entete.ordre_incertain'] = sum(
            1 for a in auteurs if a.get('ordre_confiance') == 'defaut' or a.get('ordre_conflit'))
    for feuille, valeur in (stats_titres or {}).items():
        if (isinstance(valeur, int) and not isinstance(valeur, bool)
                and re.fullmatch(r'[a-z0-9_]{1,40}', str(feuille))):
            m['titres.' + feuille] = valeur
    return m


def _description_plantage(exc):
    """`(type, lieu)` d'une exception : le nom de sa classe et le DERNIER cadre d'un fichier du
    dépôt (`fichier.py:ligne`). Jamais son message, jamais un chemin : ils citent le
    document. Une valeur qui sort du motif attendu est remplacée par une valeur neutre."""
    dossier = os.path.dirname(os.path.abspath(__file__))
    lieu = ''
    try:
        for cadre in traceback.extract_tb(exc.__traceback__):
            if os.path.dirname(os.path.abspath(cadre.filename)) == dossier:
                lieu = '%s:%d' % (os.path.basename(cadre.filename), cadre.lineno)
    except Exception:
        lieu = ''
    nom = type(exc).__name__
    return (nom if _RE_TYPE_EXCEPTION.fullmatch(nom) else 'Exception',
            lieu if _RE_LIEU.fullmatch(lieu) else 'inconnu')


# ---------------------------------------------------------------------------------
# Arguments — analyse manuelle, comme tous les CLI de pipeline/ (aucun n'utilise argparse :
# pronto-lire.py, docx-titres.py... ce fichier ne rompt pas cette convention).

def _analyser_args(argv):
    args = {'entree': None, 'produit': None, 'sortie': None, 'rapport': None,
            'base_auteurs': None, 'format': 'docx', 'analyse_seule': False, 'sans_typo': False,
            'sans_annotation': False, 'sans_reseau': False}
    positionnels = []
    reste = argv[1:]
    i = 0
    while i < len(reste):
        a = reste[i]
        if a == '--produit' and i + 1 < len(reste):
            i += 1
            args['produit'] = reste[i]
        elif a == '--sortie' and i + 1 < len(reste):
            i += 1
            args['sortie'] = reste[i]
        elif a == '--rapport' and i + 1 < len(reste):
            i += 1
            args['rapport'] = reste[i]
        elif a == '--base-auteurs' and i + 1 < len(reste):
            # §6.1 du contrat de lot D (CONTRAT-noms.md) : chemin explicite de la base OJS
            # (format v2, mn.BaseNoms.charger()). Absent -> recherche automatique de
            # mn.BaseNoms.charger() (SZH_AUTEURS_CACHE, puis /mnt/c/ProgramData/SZH/
            # auteurs.json ou C:\ProgramData\SZH\auteurs.json) — le lanceur PowerShell n'est
            # PAS modifié, cette détection automatique le couvre déjà.
            i += 1
            args['base_auteurs'] = reste[i]
        elif a == '--format' and i + 1 < len(reste):
            # docx (défaut, rétrocompatible) ou odt -- voir le point 3 du chantier « gabarits
            # Pronto FR/DE + ODT » (29.09.2026) : le format de SORTIE, indépendant de celui de
            # l'entrée. Une valeur inconnue tombe dans le contrôle d'usage plus bas, comme
            # --produit.
            i += 1
            args['format'] = reste[i]
        elif a == '--analyse-seule':
            args['analyse_seule'] = True
        elif a == '--sans-typo':
            args['sans_typo'] = True
        elif a == '--sans-annotation':
            args['sans_annotation'] = True
        elif a == '--sans-reseau':
            args['sans_reseau'] = True
        else:
            positionnels.append(a)
        i += 1
    if positionnels:
        args['entree'] = positionnels[0]
    return args


USAGE = ('usage : manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift '
         '--sortie <dossier> [--rapport <fichier.json>] [--base-auteurs <fichier>] '
         '[--format docx|odt] [--analyse-seule] [--sans-typo] [--sans-annotation] '
         '[--sans-reseau]')


# ---------------------------------------------------------------------------------
# Langue de traitement et ses deux alertes manuelles (point 5 de l'en-tête) — pas dans le
# catalogue de manuscrit_regles.py (hors des fichiers de ce chantier) : construites ici et
# simplement concaténées aux alertes du moteur avant mr.grouper().

NOMS_LANGUE_FR = {'fr': 'français', 'de': 'allemand', 'en': 'anglais', 'it': 'italien'}
NOMS_LANGUE_DE = {'fr': 'Französisch', 'de': 'Deutsch', 'en': 'Englisch', 'it': 'Italienisch'}


def _alerte_langue_produit(document_langue, langue):
    """Avertit quand la sous-étiquette primaire de la langue DÉCLARÉE du document (« fr » de
    « fr-CH ») diffère de `langue` (celle du produit, qui seule pilote le traitement — voir
    le point 5 de l'en-tête). Rend None si rien à signaler."""
    if not document_langue:
        return None
    primaire = document_langue.split('-')[0].lower()
    if primaire == langue:
        return None
    if langue == 'fr':
        nom = NOMS_LANGUE_FR.get(primaire, primaire)
        message = ("Le document est déclaré en %s alors qu’il est traité comme un article de "
                    "la Revue\u00a0: vérifiez la langue de correction dans Word." % nom)
    else:
        nom = NOMS_LANGUE_DE.get(primaire, primaire)
        message = ("Das Dokument ist als %s markiert, wird aber als Artikel der Zeitschrift "
                    "behandelt: überprüfen Sie die Korrektursprache in Word." % nom)
    return {'rule': 'Langue.DesaccordProduit', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': document_langue, 'suggested': langue,
            'message': message}


def _alerte_recherche_impossible(crossref_en_panne, identifiants_en_panne, langue):
    """Une recherche en ligne n'a pas abouti (pas de connexion, service muet) : le nettoyage
    est fait, mais « aucun DOI/ROR/ORCID trouvé » ne veut alors rien dire. Rend None sinon."""
    if not (crossref_en_panne or identifiants_en_panne):
        return None
    if langue == 'fr':
        quoi = [q for q, panne in (('DOI', crossref_en_panne),
                                   ('ROR et ORCID', identifiants_en_panne)) if panne]
        message = ("La recherche en ligne des %s n’a pas abouti (pas de connexion ou service "
                   "indisponible) : le manuscrit est nettoyé, mais ces identifiants n’ont "
                   "pas été vérifiés. Relancez plus tard." % ' et des '.join(quoi))
    else:
        quoi = [q for q, panne in (('DOI', crossref_en_panne),
                                   ('ROR und ORCID', identifiants_en_panne)) if panne]
        message = ("Die Online-Suche nach %s ist fehlgeschlagen (keine Verbindung oder Dienst "
                   "nicht erreichbar): Das Manuskript ist bereinigt, diese Kennungen wurden aber "
                   "nicht geprüft. Versuchen Sie es später erneut." % ' sowie '.join(quoi))
    return {'rule': 'Reseau.RechercheImpossible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


def _alerte_repli_typo(langue):
    """La typographie n'a pas pu être appliquée (pandoc/WSL indisponible) : une alerte visible
    dans le rapport, pas seulement une trace enfouie (point 5 de l'en-tête). Jamais levée pour
    --sans-typo, qui est un choix explicite et déjà visible via `sans_typo`, pas une panne."""
    if langue == 'fr':
        message = ("La typographie n’a pas pu être appliquée à ce document\u00a0; le texte "
                   "est rendu tel quel.")
    else:
        message = ("Die Typografie konnte auf dieses Dokument nicht angewendet werden; der "
                   "Text wird unverändert wiedergegeben.")
    return {'rule': 'Typo.ApplicationImpossible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


def _alerte_vale_indisponible(langue):
    """vale n'a pas pu tourner (binaire absent, wsl.exe injoignable, config cassée — voir
    manuscrit_vale.analyser()) : une alerte unique, jamais un plantage de la CLI."""
    if langue == 'fr':
        message = ("Le contrôle du vocabulaire et du langage n’a pas pu être effectué sur "
                   "ce document.")
    else:
        message = ("Die Prüfung von Wortschatz und Sprache konnte für dieses Dokument nicht "
                   "durchgeführt werden.")
    return {'rule': 'Vale.Indisponible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


def _alerte_annotation_impossible(langue):
    """manuscrit_annoter.annoter() a levé une exception (défaut connu, voir le commentaire à
    son point d'appel) : le .docx déjà écrit reste utilisable, sans révisions ni commentaires
    posés — une alerte le dit, jamais un plantage silencieux de la CLI."""
    if langue == 'fr':
        message = ("Les corrections n’ont pas pu être posées dans le document\u00a0: "
                   "consultez le rapport pour la liste complète des remarques.")
    else:
        message = ("Die Korrekturen konnten nicht in das Dokument eingetragen werden: Die "
                   "vollständige Liste der Anmerkungen finden Sie im Bericht.")
    return {'rule': 'Annotation.Impossible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


def _alerte_conversion_odt_impossible(detail, langue):
    """La sortie .odt demandée (point 3, --format odt) n'a pas pu être produite : le .docx
    déjà écrit et annoté est gardé tel quel (jamais de perte), cette alerte dit pourquoi."""
    if langue == 'fr':
        message = ("Le document .odt demandé n’a pas pu être produit\u00a0; le fichier .docx est "
                   "livré à la place (%s)." % detail)
    else:
        message = ("Das angeforderte .odt-Dokument konnte nicht erstellt werden; stattdessen "
                   "wird die .docx-Datei geliefert (%s)." % detail)
    return {'rule': 'Nettoyage.ConversionOdtImpossible', 'severity': 'warning',
            'action': 'report', 'para': None, 'span': None, 'found': None, 'suggested': None,
            'message': message}


# ---------------------------------------------------------------------------------
# Fusion des quatre moteurs (point 4 du brief de branchement) — CATALOGUE_PAR_ID ne connaît
# que les règles structurelles Python : les règles Vale (« CSPS.Epicene.… »,
# « SZH.Vokabular.… », « CSPS-Biblio.APA.… ») et celles de manuscrit_biblio.py (« APA.… », à
# deux segments) n'y figurent jamais. `manuscrit_regles.grouper()` reste donc CORRECT pour son
# propre périmètre (règles structurelles + reprise Typo.*) mais ne doit pas être appelé sur le
# lot fusionné : cette fonction-ci le remplace ICI, dans la CLI, sans toucher à
# manuscrit_regles.py au-delà du retrait des doublons (discipline du brief de ce lot).

def _famille_regle(identifiant_regle):
    if identifiant_regle.startswith('Typo.'):
        return 'Typo'
    regle = mr.CATALOGUE_PAR_ID.get(identifiant_regle)
    if regle is not None:
        return regle.famille
    # Une règle Vale (« CSPS.Epicene.FormesContractees », « CSPS-Biblio.APA.DoiForme »,
    # « SZH.Vokabular.Behinderung ») porte sa famille au segment du MILIEU ; une règle de
    # manuscrit_biblio.py ou une alerte manuelle de cette CLI (« APA.CitationAbsente »,
    # « Langue.DesaccordProduit », « Vale.Indisponible ») n'a que deux segments, la famille
    # est alors le premier.
    parties = identifiant_regle.split('.')
    return parties[1] if len(parties) >= 3 else parties[0]


def _grouper_toutes_alertes(alertes):
    par_famille = {}
    par_regle = {}
    for a in alertes:
        famille = _famille_regle(a['rule'])
        par_famille[famille] = par_famille.get(famille, 0) + 1
        par_regle.setdefault(a['rule'], []).append(a)
    resume_par_regle = {identifiant: {'total': len(lot), 'exemples': lot[:mr.MAX_EXEMPLES_PAR_REGLE]}
                         for identifiant, lot in par_regle.items()}
    return {'par_famille': par_famille, 'par_regle': resume_par_regle}


ORIGINES_ALERTE = ('regles', 'vale', 'bibliographie', 'identifiants', 'typographie', 'nettoyage')


def _etiqueter(lot, origine):
    """Pose `origine` sur chaque alerte du lot au moment où il rejoint la liste, et rend le lot
    (même liste, même ordre). `nettoyage` : les alertes que cette CLI émet elle-même."""
    for a in lot:
        a['origine'] = origine
    return lot


def _compter_origines(alertes):
    """Compte des alertes par origine ; la somme vaut toujours le total. Une alerte sans origine
    valide (étiquette oubliée à un site rare) devient `inconnue` : comptée, tracée dans le
    journal, et la clé n'apparaît qu'alors. Un plantage ici perdrait tout le passage pour un
    défaut d'étiquette ; ce sont les tests qui échouent sur `inconnue`, pas la production."""
    inconnues = [a for a in alertes if a.get('origine') not in ORIGINES_ALERTE]
    for a in inconnues:
        progres('alerte sans origine valide (%r) : %s' % (a.get('origine'), a.get('rule')))
        a['origine'] = 'inconnue'
    compte = collections.Counter(a['origine'] for a in alertes)
    resultat = {o: compte[o] for o in ORIGINES_ALERTE}
    if inconnues:
        resultat['inconnue'] = len(inconnues)
    return resultat


RANG_SEVERITE = {'error': 0, 'warning': 1, 'suggestion': 2}


def _trier_alertes(alertes):
    """Triées par sévérité puis par `para` (point 4 du brief) — une alerte sans `para` (None)
    va en dernier de son groupe de sévérité, jamais avant une alerte ancrée."""
    alertes.sort(key=lambda a: (RANG_SEVERITE.get(a.get('severity'), 3),
                                 a.get('para') if a.get('para') is not None else float('inf')))
    return alertes


def _marquer_dans_docx(alertes, stats_annotation):
    """Ajoute `dans_docx` ('revision' | 'commentaire' | 'rapport') à chaque alerte (point 5 du
    brief) — SANS retoucher aux autres clés.

    Révision du 21.09.2026 ter : ne déduit plus rien de `action`. Une alerte `fix`/`track` avec
    `suggested` n'est PAS forcément devenue une révision — le chevauchement (§7 ter, point
    « 2 bis ») peut l'avoir démotée en commentaire, et le plafond (point 3) peut avoir renvoyé
    ce commentaire au rapport. Seul `manuscrit_annoter.annoter()` sait ce qu'il a vraiment
    écrit : `stats['devenir']`, une liste indexée EXACTEMENT comme `alertes` (même appel, même
    ordre), porte ce verdict alerte par alerte — recopié ici tel quel, jamais recalculé."""
    devenir = stats_annotation.get('devenir') or []
    for i, a in enumerate(alertes):
        verdict = devenir[i] if i < len(devenir) else None
        a['dans_docx'] = verdict if verdict in ('revision', 'commentaire') else 'rapport'


def _recueillir_refs_paragraphes(blocs):
    """[(liste_conteneur, indice), ...] pour chaque Paragraphe à toute profondeur — permet à
    la typographie de remplacer un paragraphe par sa version normalisée sans perdre sa place
    dans la structure (une liste Python se mute par indice, jamais par la valeur elle-même)."""
    refs = []

    def parcours(liste):
        for i, bloc in enumerate(liste):
            if isinstance(bloc, mm.Paragraphe):
                refs.append((liste, i))
            elif isinstance(bloc, mm.Tableau):
                for rangee in bloc.rangees:
                    for cellule in rangee:
                        parcours(cellule.blocs)

    parcours(blocs)
    return refs


def _normaliser_entete(entete, langue):
    """Les champs de l'en-tête passent par le MÊME pont que le corps (manuscrit_typo) avant
    d'être écrits dans les tableaux du gabarit : ils étaient extraits avant la typographie et
    écrits tels quels (« L'école … et après ? », mesuré le 30.09.2026). Titre et sous-titre
    reçoivent les règles de titre ; un résumé en autre langue se normalise dans SA langue.
    Mute `entete` ; rend (traces, avertissements). Une langue que le filtre ne connaît pas
    (« abstract », en) laisse son texte intact."""
    par_langue = {}

    def ajouter(texte, niveau, poser, lang=langue):
        if texte and texte.strip() and lang in ('fr', 'de', 'it'):
            par_langue.setdefault(lang, []).append(((texte, niveau), poser))

    ajouter(entete.titre, 1, lambda v: setattr(entete, 'titre', v))
    ajouter(entete.sous_titre, 2, lambda v: setattr(entete, 'sous_titre', v))
    ajouter(entete.resume, 0, lambda v: setattr(entete, 'resume', v),
            (entete.langue_resume or langue)[:2].lower())
    for i, mot in enumerate(entete.mots_cles):
        ajouter(mot, 0, lambda v, i=i: entete.mots_cles.__setitem__(i, v))
    for auteur in entete.auteurs:
        for cle in ('fonction', 'institution'):
            ajouter(auteur.get(cle) or '', 0,
                    lambda v, a=auteur, c=cle: a.__setitem__(c, v))
    for lang, texte in list((entete.resumes_autres or {}).items()):
        ajouter(texte, 0, lambda v, l=lang: entete.resumes_autres.__setitem__(l, v),
                (lang or '')[:2].lower())

    traces, avertissements = [], []
    for lang in sorted(par_langue):
        champs = par_langue[lang]
        normalises, t, a, _statut = mt.normaliser_textes([c for c, _ in champs], lang,
                                                         RACINE_DEPOT)
        for (_, poser), valeur in zip(champs, normalises):
            poser(valeur)
        traces.extend(t)
        avertissements.extend(a)
    return traces, avertissements


def _alerte_ecartes(ecartes, langue):
    """L'avertissement qui dit ce que l'en-tête a mis de côté (voir _ecartes_par_entete)."""
    if not ecartes or not ecartes['elements']:
        return None
    if langue == 'fr':
        message = ("Le document nettoyé ne porte pas\u00a0: %s. Le gabarit n’a pas de place pour "
                   "ces éléments de l’en-tête\u00a0; reportez-les à la main si l’article en a besoin."
                   % ', '.join(fr for fr, _ in ecartes['elements']))
    else:
        message = ("Das bereinigte Dokument enthält nicht: %s. Die Vorlage hat für diese Teile "
                   "des Kopfbereichs keinen Platz; übertragen Sie sie von Hand, falls der Artikel "
                   "sie braucht." % ', '.join(de for _, de in ecartes['elements']))
    return {'rule': 'Nettoyage.ContenuEcarte', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


# ---------------------------------------------------------------------------------
# Classement des titres — cas B : l'heuristique de manuscrit_modele.classer_titres(). Cas A
# (§1, point 4 de l'en-tête) : niveau_retenu := niveau_declare, sans heuristique.

def _classer_titres_selon_le_cas(document, gabarit):
    if gabarit == 'B':
        return mm.classer_titres(document)
    trace = []
    n_conserves = 0
    for p in document.blocs:
        if not isinstance(p, mm.Paragraphe):
            continue
        p.niveau_retenu = p.niveau_declare
        if p.niveau_declare > 0:
            n_conserves += 1
        trace.append({'portee': 'paragraphe', 'source': p.source, 'style': p.style,
                      'decision': 'conserve_cas_a',
                      'niveau_declare': p.niveau_declare, 'niveau_retenu': p.niveau_declare,
                      'motif': 'cas A (gabarit déjà en place) : structure conservée telle '
                               'que déclarée, aucune reclassification heuristique (§1 du '
                               'contrat, délibérément conservateur — aucun document réel ne '
                               'valide ce cas)'})
    stats = {'mode': 'cas_a_aucune_reclassification', 'niveaux_conserves': n_conserves,
              'total_paragraphes': sum(1 for p in document.blocs
                                        if isinstance(p, mm.Paragraphe))}
    return stats, trace


# ---------------------------------------------------------------------------------
# Refus : des phrases courtes, dans la langue du produit, qui disent quoi faire. Le lanceur
# les montre telles quelles (précédées de « Refusé : »).

def _auteurs_revisions(chemin):
    """Les w:author des w:ins/w:del du document (corps et notes) ; vide si illisible."""
    auteurs = set()
    try:
        with zipfile.ZipFile(chemin) as z:
            for partie in ('word/document.xml', 'word/footnotes.xml', 'word/endnotes.xml'):
                if partie not in z.namelist():
                    continue
                for el in ET.fromstring(z.read(partie)).iter():
                    if el.tag in (md.W + 'ins', md.W + 'del'):
                        auteurs.add(el.get(md.W + 'author') or '')
    except Exception:
        return set()
    return auteurs


def _message_suivi_modifications(n, sortie_nettoyeur, produit):
    if sortie_nettoyeur:
        if produit == 'zeitschrift':
            return ('Diese Datei ist bereits das Ergebnis der Bereinigung: '
                    'Öffnen Sie das ursprüngliche Manuskript.')
        return ('Ce fichier est déjà la sortie du nettoyeur : '
                'ouvrez le manuscrit d’origine.')
    if produit == 'zeitschrift':
        return ('%d nachverfolgte Änderung(en) nicht angenommen. Nehmen Sie sie in Word an '
                'oder lehnen Sie sie ab und starten Sie dann erneut.' % n)
    return ('%d modification(s) suivie(s) non acceptée(s). Acceptez-les ou refusez-les dans '
            'Word, puis relancez.' % n)


def _message_lecture_impossible(produit):
    if produit == 'zeitschrift':
        return ('Die Datei konnte nicht gelesen werden. Prüfen Sie, ob sie sich in Word '
                'öffnen lässt, und starten Sie dann erneut.')
    return ('Le fichier n’a pas pu être lu. Vérifiez qu’il s’ouvre dans Word, puis '
            'relancez.')


# ---------------------------------------------------------------------------------
# Le programme.

def principal(argv):
    """`_principal` dans un cadre qui recueille les constats d'import (voir
    `_avertir_capture`) et les lignes de progression pour le rapport ; l'état est remis à
    zéro à chaque appel, et le branchement de szh_commun.avertir toujours défait."""
    del _AVERTISSEMENTS_IMPORT[:]
    del _JOURNAL_PROGRES[:]
    szh_commun.avertir = _avertir_capture
    _ETAT.update({'etape': 'demarrage', 'entree': '', 'produit': '', 'format_entree': '',
                  'debut': time.perf_counter()})
    try:
        return _principal(argv)
    except Exception as e:
        return _plantage(e)
    finally:
        szh_commun.avertir = _avertir_original


def _plantage(exc):
    """Une exception Python que rien n'a rattrapée : un défaut du logiciel, pas du manuscrit.
    Une ligne JSON sur stdout qui dit seulement le type, le lieu dans le dépôt et l'étape --
    JAMAIS le message de l'exception, qui cite le document -- et un code de sortie à part. La
    trace complète n'est montrée que sur demande (SZH_NETTOYEUR_TRACE), sur stderr."""
    type_exc, lieu = _description_plantage(exc)
    etape = _ETAT['etape'] if _ETAT['etape'] in ETAPES else 'inconnue'
    try:
        progres('plantage : %s à %s (étape %s)' % (type_exc, lieu, etape))
        if os.environ.get('SZH_NETTOYEUR_TRACE'):
            traceback.print_exception(type(exc), exc, exc.__traceback__)
        mesures = _mesures_minimales('plantage', _duree_ms(), _ETAT['produit'],
                                     _ETAT['format_entree'])
        _ligne_stdout({'plantage': True, 'type': type_exc, 'lieu': lieu, 'etape': etape,
                       'code_sortie': CODE_PLANTAGE,
                       'compteurs': _compteurs(_passage(_ETAT['entree']), mesures)})
    except Exception:
        pass
    return CODE_PLANTAGE


def _principal(argv):
    _forcer_utf8()
    debut = time.perf_counter()
    args = _analyser_args(argv)

    if (not args['entree'] or args['produit'] not in ('revue', 'zeitschrift')
            or not args['sortie'] or args['format'] not in ('docx', 'odt')):
        print(USAGE, file=sys.stderr)
        return 2

    entree = args['entree']
    nom = os.path.splitext(os.path.basename(entree))[0]
    extension = os.path.splitext(entree)[1].lower()
    _ETAT.update({'entree': entree, 'produit': args['produit'],
                  'format_entree': 'odt' if extension == '.odt' else 'docx'})
    _etape('controle-entree')

    def refuser(code, message_fr, **supplement):
        # `message_fr` : le nom reste, mais le texte est dans la langue du produit quand
        # l'appelant la connaît (suivi de modifications) ; `supplement` : champs en plus
        # sur la ligne stdout.
        progres('refusé : %s' % message_fr)
        ligne = {'entree': entree, 'refus': True, 'code_refus': code,
                 'message': message_fr, 'code_sortie': CODE_REFUS}
        ligne.update(supplement)
        ligne['compteurs'] = _compteurs(_passage(entree), _mesures_minimales(
            'refus:' + code, _duree_ms(debut), args['produit'], _ETAT['format_entree']))
        _ligne_stdout(ligne)
        return CODE_REFUS

    progres('entrée : %s (produit=%s)' % (entree, args['produit']))

    # Refus, avant tout travail, sans rien écrire sur le disque (§8) : un verrou temporaire de
    # Word (le document est ouvert ailleurs), avant même de tenter une lecture qui échouerait
    # de façon opaque (§10, point 5 de l'en-tête).
    if os.path.basename(entree).startswith('~$'):
        return refuser('fichier-verrou',
                        "Ce fichier est un verrou temporaire de Word, pas un manuscrit. "
                        "Ouvrez le document original.")

    # Refus, avant tout travail, sans rien écrire sur le disque (§8) : extension inconnue.
    if extension not in ('.docx', '.odt'):
        return refuser('extension-inconnue',
                        "extension « %s » non reconnue : ce nettoyeur ne lit que .docx et "
                        ".odt aujourd'hui." % extension)

    # Entrée .odt (point 2, décision de Robin 29.09.2026) : convertie en .docx dans un dossier
    # temporaire par conversion_odt.convertir(), AVANT toute lecture -- le reste de la chaîne
    # (md.lire(), l'écriture du gabarit, l'annotation) ne parle QUE .docx, un seul moteur.
    # `nom` (calculé plus haut sur `entree`) et `entree` lui-même restent ceux de l'ORIGINE
    # partout ailleurs (rapport, messages, refus) : la conversion ne change jamais ce que la
    # rédaction reconnaît comme "son" fichier. `chemin_lecture` seul pointe le .docx temporaire.
    format_entree = 'odt' if extension == '.odt' else 'docx'
    chemin_lecture = entree
    dossier_temp_odt = None
    if extension == '.odt':
        _etape('conversion-odt')
        progres("conversion de l'entrée .odt en .docx...")
        dossier_temp_odt = tempfile.mkdtemp(prefix='szh-manuscrit-odt-')
        try:
            chemin_lecture = conversion_odt.convertir(entree, 'docx', dossier_temp_odt)
        except conversion_odt.ConversionImpossible as e:
            shutil.rmtree(dossier_temp_odt, ignore_errors=True)
            return refuser('conversion-impossible', str(e))

    _etape('lecture')
    progres('lecture du manuscrit...')
    try:
        document = md.lire(chemin_lecture)
    except Exception as e:
        progres('lecture impossible : %s' % e)
        _ligne_stdout({'entree': entree, 'refus': True, 'code_refus': 'lecture-impossible',
                       'message': _message_lecture_impossible(args['produit']),
                       'detail': str(e), 'code_sortie': CODE_ECHEC_INTERNE,
                       'compteurs': _compteurs(_passage(entree), _mesures_minimales(
                           'refus:lecture-impossible', _duree_ms(debut), args['produit'],
                           format_entree))})
        return CODE_ECHEC_INTERNE
    finally:
        # Le .docx temporaire (conversion .odt -> .docx, ci-dessus) n'est plus utile une fois
        # le document en mémoire -- nettoyé dans tous les cas, succès ou échec de lecture.
        if dossier_temp_odt is not None:
            shutil.rmtree(dossier_temp_odt, ignore_errors=True)

    # Ce que le manuscrit porte AVANT tout traitement — l'étalon du garde-fou « rien ne se
    # perd » (voir _controler_perte), pris ici parce que l'en-tête et le bloc d'autrices vont
    # retirer des blocs de document.blocs.
    empreinte_entree = _mots_et_images(document)

    # Refus, avant tout travail, sans rien écrire sur le disque (§8) : suivi de
    # modifications — un texte avec des w:ins/w:del n'a pas de contenu univoque.
    if document.revisions > 0:
        sortie_nettoyeur = (nom.endswith('-nettoye')
                            or bool(_auteurs_revisions(chemin_lecture) & AUTEURS_NETTOYEUR))
        return refuser('suivi-modifications',
                        _message_suivi_modifications(document.revisions, sortie_nettoyeur,
                                                     args['produit']),
                        revisions=document.revisions, sortie_nettoyeur=sortie_nettoyeur)

    # Un document porteur de commentaires n'est PAS refusé (§8) : compté, signalé, et le
    # rapport dit qu'ils ne survivent pas au nettoyage.
    note_commentaires = None
    if document.commentaires > 0:
        note_commentaires = ('%d commentaire(s) trouvé(s) dans ce document : ils ne '
                              'survivent pas au nettoyage, la sortie ne les porte pas.'
                              % document.commentaires)
        progres(note_commentaires)

    _etape('gabarit')
    gabarit = mm.reconnaitre_gabarit(document)
    progres('gabarit reconnu : cas %s' % gabarit)

    # La langue de traitement vient du PRODUIT, jamais du document (point 5 de l'en-tête) :
    # c'est elle qui part au filtre (-M lang=), à l'en-tête (§5.5), aux règles et au rapport.
    # Calculée ICI (avant classer_titres) : extraire_entete() en a besoin.
    langue = 'fr' if args['produit'] == 'revue' else 'de'

    # Base de noms (§6.1 du contrat de lot D) — chargée UNE FOIS ici, passée telle quelle à
    # me.extraire_entete() et me.extraire_bloc_auteurs_final() ci-dessous. --base-auteurs
    # absent -> mn.BaseNoms.charger() fait sa recherche automatique ; silencieuse de bout en
    # bout (aucune source trouvée = base indisponible, jamais une exception).
    _etape('noms')
    progres('chargement de la base de noms...')
    base_noms = mn.BaseNoms.charger(chemin_base_auteurs=args['base_auteurs'])
    if base_noms.disponible:
        progres('base de noms : %s' % '; '.join(base_noms.sources))
    else:
        progres('base de noms indisponible (aucune source trouvée)')

    # En-tête (§5.5) — cas B seulement (§1 : « en cas A, rien de tout ceci, le gabarit est
    # déjà rempli »). Retire le titre/sous-titre/auteurs/résumé/mots-clés/DOI/ligne de revue
    # du corps AVANT le classement des titres de section, qui ne doit juger que ce qui reste.
    entete = None
    ecartes_entete = None
    trace_entete = []
    indices_entete = {}
    paragraphes_entete_ctx = []
    auteurs_ctx = []
    alertes_identifiants = []
    stats_identifiants = None
    if gabarit == 'B':
        # Noms de bibliographie (§6.1) — AVANT extraire_entete(), sur le document ENCORE
        # complet (voir _noms_de_bibliographie() plus haut pour le pourquoi).
        _etape('entete')
        progres('repérage des noms de bibliographie...')
        noms_biblio = _noms_de_bibliographie(document)
        progres('%d jeton(s) de nom retenu(s) depuis la bibliographie' % len(noms_biblio))

        progres("reconnaissance de l'en-tête...")
        entete, indices_entete, trace_entete = me.extraire_entete(
            document, langue, base_noms=base_noms, noms_biblio=noms_biblio)
        progres("reconnaissance du bloc d'autrices et auteurs en fin de document...")
        indices_final, trace_final = me.extraire_bloc_auteurs_final(
            document, entete, langue, indices_entete,
            base_noms=base_noms, noms_biblio=noms_biblio)
        indices_entete.update(indices_final)
        trace_entete = trace_entete + trace_final
        paragraphes_entete_ctx = _paragraphes_entete_contexte(document, indices_entete)
        # §6.2 du contrat de lot D (étendu par le superviseur le 22.09.2026 : `ordre_conflit`
        # est un TROISIÈME champ de la fiche EnTete.auteurs, pas une inspection de
        # `ordre_motif`) : contexte['auteurs'] pour manuscrit_regles.py
        # (Entete.OrdreNomIncertain / Entete.OrdreNomParDefaut) — vide en cas A par
        # construction (cette liste n'est remplie que dans la branche gabarit == 'B').
        auteurs_ctx = [{'prenom': a.get('prenom') or '', 'nom': a.get('nom') or '',
                         'ordre_confiance': a.get('ordre_confiance') or '',
                         'ordre_motif': a.get('ordre_motif') or '',
                         'ordre_conflit': bool(a.get('ordre_conflit')),
                         'texte_source': a.get('texte_source') or ''}
                        for a in entete.auteurs]
        # Ce que l'en-tête met de côté sans que le gabarit ait où l'écrire — mesuré AVANT le
        # retrait des blocs, sur les indices du document complet (garde-fou « rien ne se perd »).
        ecartes_entete = _ecartes_par_entete(document, entete, indices_entete)
        document.blocs = [b for idx, b in enumerate(document.blocs)
                           if idx not in indices_entete]
        progres('en-tête : titre=%r, %d auteur(s), résumé=%d signe(s), %d mot(s)-clé(s)'
                % (entete.titre, len(entete.auteurs), len(entete.resume),
                   len(entete.mots_cles)))

        # ROR et ORCID des autrices et auteurs : cherchés en réseau, écrits en révision
        # « à vérifier » par le gabarit, jamais sur la foi du seul nom (manuscrit_identifiants).
        _etape('identifiants')
        progres('recherche des ROR et ORCID des autrices et auteurs...')
        alertes_identifiants, stats_identifiants = mi.enrichir_auteurs(
            entete.auteurs, langue, reseau=not args['sans_reseau'])
        _etiqueter(alertes_identifiants, 'identifiants')
        progres('identifiants : %d ROR et %d ORCID trouvé(s), %d candidat(s), %d requête(s) '
                'en panne' % (stats_identifiants['ror_trouves'],
                              stats_identifiants['orcid_trouves'],
                              stats_identifiants['orcid_candidats'],
                              stats_identifiants['indisponible']))

    _etape('titres')
    progres('classement des titres...')
    stats_titres, trace_titres = _classer_titres_selon_le_cas(document, gabarit)

    _etape('formatage')
    progres('nettoyage de la mise en forme...')
    stats_formatage, trace_formatage = mm.nettoyer_mise_en_forme(document)

    alertes_manuelles = list(alertes_identifiants)
    alerte_langue = _alerte_langue_produit(document.langue, langue)
    if alerte_langue:
        alertes_manuelles.append(_etiqueter([alerte_langue], 'nettoyage')[0])
        progres(alerte_langue['message'])

    _etape('typographie')
    if args['sans_typo']:
        progres('typographie désactivée (--sans-typo)')
        traces_typo = ['typographie désactivée (--sans-typo)']
        abandons_typo, avertissements_typo = [], []
        # "repli" sur la ligne stdout (rien n'a été tenté), mais SANS l'alerte de repli : un
        # choix explicite, déjà visible via sans_typo au rapport, pas une panne d'outillage.
        statut_typo = 'repli'
    else:
        progres('normalisation typographique (langue=%s)...' % langue)
        # Le corps ET les notes (bas de page et fin), dans le même appel : les notes vivent à
        # part (Document.notes) et restaient sans typographie (mesuré le 30.09.2026 : 23
        # apostrophes droites sur 23 dans les notes de 2-fin-de-document, 1 sur 75 au corps).
        refs = _recueillir_refs_paragraphes(document.blocs)
        for cle in sorted(document.notes):
            refs.extend(_recueillir_refs_paragraphes(document.notes[cle]))
        paras = [conteneur[i] for conteneur, i in refs]
        nouveaux, traces_typo, abandons_typo, avertissements_typo, statut_typo = (
            mt.normaliser_paragraphes(paras, langue, RACINE_DEPOT))
        for (conteneur, i), p in zip(refs, nouveaux):
            conteneur[i] = p
        if entete is not None and statut_typo == 'appliquee':
            traces_entete_typo, avert_entete = _normaliser_entete(entete, langue)
            traces_typo = traces_typo + traces_entete_typo
            avertissements_typo = avertissements_typo + avert_entete
        for ligne in traces_typo:
            progres(ligne)
        if statut_typo == 'repli':
            alertes_manuelles.append(_etiqueter([_alerte_repli_typo(langue)], 'typographie')[0])

    _etape('regles')
    progres('évaluation des règles éditoriales...')
    sources_biblio, entrees_biblio = _construire_bibliographie(document)
    paragraphes_corps_biblio = _construire_paragraphes_contexte(document, sources_biblio, gabarit)
    paragraphes_ctx = paragraphes_entete_ctx + paragraphes_corps_biblio
    images = _collecter_images(document)
    tableaux_ctx = _collecter_tableaux(document)
    contexte = {
        'produit': args['produit'], 'langue': langue,
        'paragraphes': paragraphes_ctx, 'bibliographie': entrees_biblio,
        'images': [{'alt': i['alt'], 'source': i['source']} for i in images],
        'tableaux': tableaux_ctx,
        'avertissements_typo': avertissements_typo,
        'auteurs': auteurs_ctx,
    }
    alertes_python = mr.evaluer(contexte)
    # mr.evaluer() rend les règles STRUCTURELLES du catalogue ET la reprise des avertissements
    # C1/C2 du filtre typographique (préfixe 'Typo.') mélangés dans une seule liste — on les
    # sépare ICI pour que `alertes.origine` (point 4 de la consigne de branchement) compte
    # chaque moteur pour de vrai, sans toucher à manuscrit_regles.evaluer() lui-même.
    alertes_regles = _etiqueter([a for a in alertes_python if not a['rule'].startswith('Typo.')],
                                 'regles')
    alertes_typo_reprises = _etiqueter([a for a in alertes_python if a['rule'].startswith('Typo.')],
                                        'typographie')

    # Vale (point 1) — le titre de la bibliographie n'y passe pas : `entrees_biblio` l'exclut
    # déjà (voir _construire_bibliographie()), et le corps de Vale ci-dessous exclut tout
    # paragraphe de rôle 'bibliographie' (donc aussi ce titre). Les cellules de tableau et le
    # contenu des notes s'y ajoutent, à toute profondeur, jamais ancrables (voir
    # _paragraphes_cellules_pour_vale()/_paragraphe_source_appelant_note() plus haut).
    _etape('vale')
    progres('contrôle du vocabulaire et du langage...')
    numeros_notes = _numeros_notes(document)
    paragraphes_vale_biblio = [{'texte': e['texte'], 'source': e['source'], 'role': 'bibliographie'}
                                for e in entrees_biblio]
    paragraphes_vale_notes, correspondance_notes_vale = _paragraphes_notes_pour_vale(
        document, numeros_notes)
    paragraphes_vale_corps = (
        [p for p in paragraphes_corps_biblio if p['role'] != 'bibliographie']
        + _paragraphes_cellules_pour_vale(document.blocs)
        + paragraphes_vale_notes)
    alertes_vale, vale_indisponible = mv.analyser(
        paragraphes_vale_corps, paragraphes_vale_biblio, langue, RACINE_DEPOT)
    _etiqueter(alertes_vale, 'vale')
    if vale_indisponible:
        alertes_vale = _etiqueter([_alerte_vale_indisponible(langue)], 'vale')
        progres("contrôle du vocabulaire indisponible")
    else:
        # §7 ter du contrat (traçabilité note -> appel) : une alerte dont `para` est le
        # `source` SYNTHÉTIQUE d'un paragraphe de note (voir _paragraphes_notes_pour_vale)
        # reçoit ICI `note_id`/`note_numero` et son `para` RÉEL (le paragraphe de corps qui
        # porte l'appel) — manuscrit_annoter.py ancre alors sur le mot qui précède l'appel,
        # jamais sur ce paragraphe entier.
        _marquer_notes_dans_alertes(alertes_vale, correspondance_notes_vale)

    # Bibliographie (point 2) — mêmes deux corpus, sans le rôle (manuscrit_biblio.py ne le lit
    # pas, il reçoit déjà deux listes séparées). --sans-reseau : choix explicite du lanceur
    # d'essai ou d'un test, jamais posé par le lanceur en production (point 2 de la consigne).
    _etape('bibliographie')
    progres('contrôle de la bibliographie...')
    paragraphes_biblio_module = [{'texte': e['texte'], 'source': e['source']}
                                  for e in entrees_biblio]
    # Les citations des notes et des cellules comptent aussi (mêmes paragraphes que Vale) :
    # sans elles, une référence citée seulement en note était déclarée « jamais citée »
    # (mesuré sur gzdf_Huttner : Hedderich, Kaiser-Mantel et Nonn, cités dans la note 1).
    paragraphes_corps_module = [{'texte': p['texte'], 'source': p['source']}
                                 for p in paragraphes_vale_corps]
    alertes_biblio, stats_biblio = mb.analyser_bibliographie(
        paragraphes_corps_module, paragraphes_biblio_module, langue, reseau=not args['sans_reseau'])
    _etiqueter(alertes_biblio, 'bibliographie')
    _marquer_notes_dans_alertes(alertes_biblio, correspondance_notes_vale)
    alerte_reseau = _alerte_recherche_impossible(
        mb._hors_service, bool(stats_identifiants and stats_identifiants['indisponible']), langue)
    if alerte_reseau:
        alertes_manuelles.append(_etiqueter([alerte_reseau], 'nettoyage')[0])
        progres(alerte_reseau['message'])

    alertes = _trier_alertes(alertes_regles + alertes_vale + alertes_biblio
                              + alertes_typo_reprises + alertes_manuelles)
    progres('%d alerte(s) avant écriture' % len(alertes))

    # Sorties — toujours à côté du manuscrit d'entrée, jamais une boîte de dialogue (§8).
    _etape('ecriture')
    dossier = args['sortie']
    os.makedirs(dossier, exist_ok=True)
    sortie_docx = None
    resultat_ecriture = None
    stats_annotation = None
    annotation_restauree = False
    mesure_perte = None
    if args['analyse_seule']:
        progres('analyse seule (--analyse-seule) : aucun .docx écrit')
    else:
        sortie_docx = os.path.join(dossier, nom + '-nettoye.docx')
        progres('écriture du gabarit -> %s' % sortie_docx)
        decisions = {'titres': {'stats': stats_titres, 'trace': trace_titres},
                     'formatage': {'stats': stats_formatage, 'trace': trace_formatage}}
        resultat_ecriture = mg.ecrire(document, CHEMINS_GABARIT[args['produit']], sortie_docx,
                                       decisions=decisions, entete=entete, langue=langue)

        # Garde-fou « rien ne se perd », sur le .docx tel qu'écrit, AVANT l'annotation (qui
        # ajoute des révisions dont le texte barré fausserait le compte).
        _etape('controle-perte')
        alerte_perte, mesure_perte = _controler_perte(empreinte_entree, sortie_docx, langue,
                                                      ecartes_entete)
        for alerte in (alerte_perte, _alerte_ecartes(ecartes_entete, langue),
                       mg.alerte_notes_reprises(resultat_ecriture['trace'], langue)):
            if alerte is not None:
                alertes.append(_etiqueter([alerte], 'nettoyage')[0])
                progres(alerte['message'])
        _trier_alertes(alertes)
        if mesure_perte.get('refus'):
            # La moitié du manuscrit ou plus manque : le fichier n'est pas livré, pour qu'il ne
            # puisse pas être importé par mégarde. Le rapport, lui, est écrit et le dit.
            try:
                os.remove(sortie_docx)
            except OSError:
                pass
            progres('sortie refusée : %s supprimé' % sortie_docx)
            sortie_docx = None

        if sortie_docx is None:
            pass
        elif args['sans_annotation']:
            progres('annotation désactivée (--sans-annotation)')
        else:
            _etape('annotation')
            progres('annotation du document...')
            # Sauvegarde du .docx PRÉ-annotation (déjà écrit, déjà valide) en mémoire : si
            # l'annotation échoue — par exception OU en laissant un XML mal formé, voir plus
            # bas — c'est cette version qui est restituée, jamais un fichier à moitié annoté.
            with open(sortie_docx, 'rb') as _f:
                octets_avant_annotation = _f.read()
            try:
                stats_annotation = ma.annoter(
                    sortie_docx, sortie_docx, alertes, resultat_ecriture['correspondance'],
                    langue=langue, auteur=AUTEUR_ANNOTATION, plafond_commentaires=25)
                # ⚠ Deuxième défaut RÉEL, PLUS SOURNOIS que le premier (voir ci-dessous) : une
                # révision dont le span touche la frontière d'un <w:hyperlink> peut rendre un
                # document.xml mal formé SANS lever d'exception (mesuré sur 3 fichiers du
                # corpus réel sur 12 — voir le rapport de chantier). annoter() « réussit »,
                # code de sortie 0, et livre pourtant un .docx que Word ne rouvrirait pas
                # proprement. Validée ici, explicitement, plutôt que supposée.
                _valider_docx_bien_forme(sortie_docx)
            except Exception as e:
                # ⚠ Premier défaut RÉEL, trouvé sur le corpus réel en branchant ce module
                # (mesuré, signalé, PAS corrigé ici — manuscrit_annoter.py est hors des deux
                # fichiers autorisés pour ce lot, voir le rapport de chantier) :
                # `2-grappes_En Route pour Apprendre.docx` fait lever un `KeyError: 'texto'`
                # dans `_xml_del()` — un atome déjà FUSIONNÉ par une révision précédente (donc
                # sans clé 'texto', voir `_anotar_parrafo()`) est repris par une seconde
                # révision du même paragraphe dont le span touche ou chevauche le premier. Une
                # panne d'un moteur optionnel ne doit jamais faire perdre le .docx déjà écrit
                # ni le rapport : capturée ici comme une indisponibilité, au même principe que
                # Vale (§7) et le repli typographique (§8) — jamais un plantage de la CLI, et
                # jamais un .docx corrompu au repos (restauration ci-dessous).
                with open(sortie_docx, 'wb') as _f:
                    _f.write(octets_avant_annotation)
                stats_annotation = None
                annotation_restauree = True
                progres('annotation impossible : %s' % e)
                alertes.append(_etiqueter([_alerte_annotation_impossible(langue)], 'nettoyage')[0])
                _trier_alertes(alertes)
            else:
                _marquer_dans_docx(alertes, stats_annotation)
                progres('annotation : %d révision(s), %d commentaire(s), %d renvoyée(s) au '
                        'rapport' % (stats_annotation['revisions'],
                                     stats_annotation['commentaires'],
                                     len(stats_annotation['renvoyees_au_rapport'])))

    # Sortie .odt (point 3, --format odt) : le .docx ci-dessus reste le seul moteur d'écriture
    # -- écriture, contrôle de perte, annotation, validation XML s'y font TOUJOURS d'abord.
    # Ce n'est qu'ICI, une fois le .docx définitif posé, qu'il est converti en .odt ; l'échec
    # garde le .docx (jamais de perte), avec une alerte qui dit pourquoi. `sortie` porte le
    # chemin réellement livré, quel que soit le format ; `sortie_docx` reste, pour compat, le
    # .docx s'il est livré, sinon None.
    sortie = sortie_docx
    format_sortie = 'docx' if sortie_docx is not None else None
    if sortie_docx is not None and args['format'] == 'odt':
        _etape('conversion-sortie')
        progres('conversion du .docx écrit en .odt...')
        try:
            sortie_odt = conversion_odt.convertir(sortie_docx, 'odt', dossier,
                                                   nom_sortie=nom + '-nettoye')
        except conversion_odt.ConversionImpossible as e:
            progres('conversion en .odt impossible, le .docx est conservé : %s' % e)
            alertes.append(_etiqueter([_alerte_conversion_odt_impossible(str(e), langue)],
                                      'nettoyage')[0])
            _trier_alertes(alertes)
        else:
            try:
                os.remove(sortie_docx)
            except OSError:
                pass
            sortie_docx = None
            sortie = sortie_odt
            format_sortie = 'odt'

    groupes = _grouper_toutes_alertes(alertes)
    alertes_origine = _compter_origines(alertes)
    n_error = sum(1 for a in alertes if a['severity'] == 'error')
    n_warning = sum(1 for a in alertes if a['severity'] == 'warning')
    n_suggestion = sum(1 for a in alertes if a['severity'] == 'suggestion')
    progres('%d alerte(s) (%d error, %d warning, %d suggestion)'
            % (len(alertes), n_error, n_warning, n_suggestion))

    # §5.5 : l'en-tête (titre, sous-titre, résumé, mots-clés, auteurs) n'est plus dans le
    # corps de l'article — signes_total ne doit pas le recompter. La bibliographie, elle,
    # reste comptée dans ce total, comme avant ce chantier (signes_bibliographie n'en est
    # qu'une VENTILATION, jamais une exclusion).
    signes_total = sum(len(p['texte']) for p in paragraphes_ctx
                        if p['role'] not in ROLES_ENTETE_POUR_REGLES)
    signes_biblio = sum(len(p['texte']) for p in paragraphes_ctx if p['role'] == 'bibliographie')
    images_sans_alt = sum(1 for i in images if not (i['alt'] or '').strip())

    rapport = {
        'entree': entree, 'produit': args['produit'], 'langue': langue, 'gabarit': gabarit,
        'format_entree': format_entree,
        'analyse_seule': args['analyse_seule'], 'sans_typo': args['sans_typo'],
        'sans_annotation': args['sans_annotation'], 'sans_reseau': args['sans_reseau'],
        'sortie': sortie, 'format_sortie': format_sortie, 'sortie_docx': sortie_docx,
        'controles': {'vale': 'indisponible' if vale_indisponible else 'effectue',
                      # Garde-fou « rien ne se perd » : mots et images du manuscrit
                      # retrouvés dans le .docx écrit (None en --analyse-seule).
                      'perte_de_contenu': mesure_perte},
        'compteurs': {
            'signes_total': signes_total, 'signes_bibliographie': signes_biblio,
            'nb_references': len(entrees_biblio), 'commentaires': document.commentaires,
            'note_commentaires': note_commentaires,
            'notes': len(document.notes or {}),
            'revisions': stats_annotation['revisions'] if stats_annotation else 0,
            'commentaires_poses': stats_annotation['commentaires'] if stats_annotation else 0,
            'images': {'total': len(images), 'sans_alt': images_sans_alt,
                       # dimensions en pixels, JAMAIS un verdict (§7 du contrat) : le verdict
                       # de qualité vient de lib/qualite-image.js, au moment du rapport HTML.
                       'details': [{'nom': i['nom'], 'source': i['source'],
                                    'largeur_px': i['largeur_px'], 'hauteur_px': i['hauteur_px'],
                                    'alt_absent': not bool((i['alt'] or '').strip())}
                                   for i in images]},
        },
        'decisions': {
            'entete': ({'donnees': me.entete_vers_json(entete),
                        'indices_consommes': {str(k): v for k, v in indices_entete.items()},
                        'trace': trace_entete} if entete is not None else None),
            'titres': {'stats': stats_titres, 'trace': trace_titres},
            'formatage': {'stats': stats_formatage, 'trace': trace_formatage},
            'typographie': {'traces': traces_typo, 'abandons': abandons_typo,
                             'avertissements': avertissements_typo, 'statut': statut_typo},
            'ecriture': resultat_ecriture,
        },
        'bibliographie': stats_biblio,
        'identifiants': stats_identifiants,
        'annotation': stats_annotation,
        # Ce que le lanceur ne montre plus : les constats de lecture (en-têtes et pieds non
        # lus, zones de texte...) avec leurs deux langues, et les lignes de progression.
        'avertissements_import': list(_AVERTISSEMENTS_IMPORT),
        'journal': list(_JOURNAL_PROGRES),
        'alertes': {'total': len(alertes), 'error': n_error, 'warning': n_warning,
                    'suggestion': n_suggestion, 'liste': alertes, 'groupes': groupes,
                    'origine': alertes_origine},
    }

    code_sortie = CODE_ALERTE_ERROR if n_error > 0 else CODE_OK

    _etape('rapport')
    sortie_rapport = args['rapport'] or os.path.join(dossier, nom + '-rapport.json')
    progres('écriture du rapport -> %s' % sortie_rapport)
    with open(sortie_rapport, 'w', encoding='utf-8') as f:
        json.dump(rapport, f, ensure_ascii=False, indent=2)

    duree_ms = (time.perf_counter() - debut) * 1000
    refus_perte = bool(mesure_perte and mesure_perte.get('refus'))
    issue = ('refus:perte-de-contenu' if refus_perte
             else 'alertes' if code_sortie == CODE_ALERTE_ERROR else 'ok')
    compteurs = _compteurs(_passage(entree), _mesures_passage(
        issue, int(round(duree_ms)), args, gabarit, format_entree, format_sortie, alertes,
        alerte_langue, signes_total, signes_biblio,
        sum(1 for p in paragraphes_ctx if p['role'] not in ROLES_ENTETE_POUR_REGLES),
        len(entrees_biblio), len(document.notes or {}), len(images), images_sans_alt,
        stats_annotation, annotation_restauree, mesure_perte, ecartes_entete,
        vale_indisponible, statut_typo, stats_biblio, stats_identifiants, entete, stats_titres))
    if refus_perte:
        # Même forme que les refus d'entrée (refuser(), plus haut), le rapport en plus : il
        # dit ce qui manquait.
        progres('terminé en %.0f ms (refus : perte de contenu)' % duree_ms)
        _ligne_stdout({'entree': entree, 'refus': True, 'code_refus': 'perte-de-contenu',
                       'message': alerte_perte['message'], 'sortie_rapport': sortie_rapport,
                       'code_sortie': CODE_REFUS, 'compteurs': compteurs})
        return CODE_REFUS
    progres('terminé en %.0f ms (code de sortie %d)' % (duree_ms, code_sortie))

    _ligne_stdout({'entree': entree, 'produit': args['produit'], 'gabarit': gabarit,
                   'sortie': sortie, 'format_sortie': format_sortie, 'sortie_docx': sortie_docx,
                   'sortie_rapport': sortie_rapport,
                   'typographie': statut_typo,
                   'alertes_total': len(alertes), 'alertes_error': n_error,
                   'alertes_warning': n_warning, 'alertes_suggestion': n_suggestion,
                   'duree_ms': round(duree_ms, 1), 'code_sortie': code_sortie,
                   'compteurs': compteurs})
    return code_sortie


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
