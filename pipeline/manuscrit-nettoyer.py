#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# CLI du nettoyeur de manuscrit (article) : enchaîne les modules manuscrit_* sur un .docx ou
# un .odt et écrit le manuscrit au gabarit Pronto, annoté, avec son rapport. Voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
#   manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift --sortie <dossier>
#                         [--rapport <fichier.json>] [--format docx|odt] [--analyse-seule]
#                         [--sans-typo] [--sans-annotation] [--sans-reseau]
#
# Étapes : lire, reconnaître le cas (A : déjà au gabarit, B : manuscrit libre), lire l'en-tête
# et le bloc final des auteurs, classer les titres, nettoyer la mise en forme, appliquer la
# typographie, passer les règles (structurelles, Vale, bibliographie), écrire le gabarit,
# annoter le .docx écrit, écrire le rapport.
#
# Une entrée .odt est d'abord convertie en .docx dans un dossier temporaire : toute la chaîne
# travaille en .docx. `entree` désigne toujours le fichier d'origine (rapport, messages). En
# sortie .odt, le .docx final est converti puis supprimé ; si la conversion échoue, le .docx
# est gardé et une alerte le dit.
#
# Le nom porte un tiret : c'est une CLI, aucun module ne l'importe. Bibliothèque standard
# seulement.
#
# Points à connaître :
#
# - Le rôle ('role') passé à manuscrit_regles.py n'est pas deviné : 'titre' pour le premier
#   bloc s'il a un niveau de titre ; 'bibliographie' pour le dernier titre reconnu par
#   `pronto_modele.titre_est_biblio()` et ce qui le suit jusqu'à la fin ou un tableau.
#   'sous_titre' et 'resume' ne se déduisent que dans l'en-tête : ailleurs, rien ne les
#   distingue d'un intertitre ou d'un paragraphe.
# - `bibliographie[i].nb_auteurs` vaut 0 pour le moteur structurel ; c'est
#   `manuscrit_biblio.py` qui compte les auteurs.
# - Cas A : les tableaux fixes du document prennent la place de ceux du gabarit
#   (_tableaux_fixes_du_document), et ses clés « SZH Cle Abb/Tab » restent des clés
#   (_regrouper_blocs).
# - Contrôle de perte : mots et images sont comptés avant traitement puis dans le .docx écrit
#   (_controler_perte). Au-delà de PERTE_ALERTE, alerte `Nettoyage.ContenuPerdu` (error) ;
#   au-delà de PERTE_REFUS, la sortie n'est pas livrée (code 2, « perte-de-contenu »).
# - La langue de traitement vient du produit (`--produit revue` -> fr), pas de
#   `document.langue`. Un désaccord donne l'alerte `Langue.DesaccordProduit`.
# - Un repli typographique (pandoc ou WSL indisponible) donne `Typo.ApplicationImpossible` ;
#   `--sans-typo` est un choix et ne donne pas d'alerte.
# - Un fichier `~$*.docx` (verrou temporaire de Word) est refusé avant lecture (code 2,
#   `fichier-verrou`).
# - Vale et la bibliographie reçoivent deux corpus (corps et bibliographie), sans l'en-tête.
#   Vale reçoit aussi les cellules de tableau et les notes, qui ne peuvent pas recevoir de
#   révision (`source=None`, voir `_paragraphes_cellules_pour_vale()`).
# - `manuscrit_regles.grouper()` ne connaît que le catalogue structurel : toutes les alertes
#   sont regroupées par `_grouper_toutes_alertes()`.
# - `dans_docx` (`_marquer_dans_docx()`) recopie le verdict que `manuscrit_annoter.annoter()`
#   rend pour chaque alerte, dans le même processus.
# - Une révision qui touche la frontière d'un `<w:hyperlink>` peut produire un
#   `word/document.xml` mal formé sans exception. Chaque partie .xml/.rels est donc validée
#   après annotation (`_valider_docx_bien_forme()`), et la version non annotée est restaurée
#   si besoin.

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
# Noms ré-exportés : les tests et ce fichier les appellent par ce module.
from manuscrit_corpus import (
    ROLES_ENTETE_POUR_REGLES, _collecter_images, _collecter_tableaux,
    _construire_bibliographie, _construire_paragraphes_contexte, _entree_biblio,
    _marquer_notes_dans_alertes, _noms_de_bibliographie, _numeros_notes,
    _paragraphes_cellules_pour_vale, _paragraphes_entete_contexte,
    _paragraphes_notes_pour_vale, _parcourir_blocs)
from manuscrit_controle import (
    _controler_perte, _ecartes_par_entete, _mots_et_images, _valider_docx_bien_forme)

RACINE_DEPOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Un gabarit par produit : revue = FR, zeitschrift = DE.
CHEMINS_GABARIT = {
    'revue': os.path.join(RACINE_DEPOT, 'revue-template', "Pronto - modele d'article_FR.docx"),
    'zeitschrift': os.path.join(RACINE_DEPOT, 'revue-template', "Pronto - modele d'article_DE.docx"),
}

PREFIXE = '[manuscrit-nettoyer]'

# Codes de sortie. 0 et 1 comme manuscrit_regles.principal() (1 : au moins une alerte error).
CODE_OK = 0
CODE_ALERTE_ERROR = 1
CODE_REFUS = 2
CODE_ECHEC_INTERNE = 3
# Exception non rattrapée, donc défaut du logiciel ; le lanceur la distingue par ce code.
CODE_PLANTAGE = 4


def _forcer_utf8():
    """Force UTF-8 sur stdout et stderr : sous une console Windows en cp1252, un nom de
    fichier accentué ferait planter l'écriture."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8')
        except Exception:
            pass


AUTEUR_ANNOTATION = 'Relecture automatique'
# Les auteurs de révision que le nettoyeur pose lui-même : annotation, puis recherche ROR/ORCID.
AUTEURS_NETTOYEUR = {AUTEUR_ANNOTATION} | set(mg._AUTEUR_REVISION_IDENTIFIANTS.values())

# Les lignes de progression, gardées pour le rapport JSON.
_JOURNAL_PROGRES = []


def progres(message):
    """Écrit une ligne de progression sur stderr (stdout ne porte que la ligne JSON finale)
    et la garde dans `_JOURNAL_PROGRES` pour le rapport."""
    _JOURNAL_PROGRES.append(str(message))
    print('%s %s' % (PREFIXE, message), file=sys.stderr, flush=True)


# Les constats `[import-avertissement]` des modules de lecture passent par
# szh_commun.avertir, qui écrit sur stderr. Pendant un nettoyage, ils sont recueillis pour le
# rapport (JSON et HTML). SZH_IMPORT_LOG, s'il est posé, les reçoit aussi.
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
    """La seule ligne que ce script écrit sur stdout, en cas de succès, de refus ou
    d'échec."""
    print(json.dumps(objet, ensure_ascii=True))


# ---------------------------------------------------------------------------------
# Compteurs d'usage et plantages. Aucun texte du manuscrit n'y passe (ni nom de fichier, ni
# titre, ni auteur, ni message d'exception) : des noms de mesure d'une liste blanche, des
# entiers et un condensat du fichier d'entrée (`passage`). Le lanceur recopie l'objet tel
# quel dans un CSV partagé.

ETAPES = (
    'demarrage', 'controle-entree', 'conversion-odt', 'lecture', 'gabarit', 'noms', 'entete',
    'identifiants', 'titres', 'formatage', 'typographie', 'regles', 'vale', 'bibliographie',
    'ecriture', 'controle-perte', 'annotation', 'conversion-sortie', 'rapport', 'sortie',
)
_ETAT = {'etape': 'demarrage', 'entree': '', 'produit': '', 'format_entree': '', 'debut': 0.0,
         'etapes': False}

_RE_MESURE = re.compile(r'^[a-z0-9_.:-]{1,96}$')
_RE_ID_REGLE = re.compile(r'^[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+$')
_RE_MESURE_REGLE = re.compile(r'^regle:(Autre|[A-Z][A-Za-z0-9-]*(\.[A-Z][A-Za-z0-9-]*)+):'
                              r'(revision|commentaire|rapport)$')
_RE_CODE_REFUS = re.compile(r'^[a-z][a-z0-9-]{1,40}$')
MAX_ID_REGLE = 64
# Liste blanche, identique à MESURES_NETTOYEUR de lib/compteurs.js (un test les compare),
# plus deux familles à suffixe libre au motif étroit. Une mesure absente est écartée sans
# message, ici comme côté PowerShell et JS.
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
    """Pose l'étape en cours (un nom de ETAPES). Un plantage la rapporte, avec le fichier et
    la ligne du dépôt."""
    _ETAT['etape'] = nom if nom in ETAPES else 'inconnue'
    # Avec --etapes, le cockpit lit ce nom sur stderr pour suivre l'avancement ; il n'entre
    # pas dans le journal du rapport.
    if _ETAT.get('etapes'):
        print('%s etape %s' % (PREFIXE, _ETAT['etape']), file=sys.stderr, flush=True)


def _passage(chemin):
    """Les 12 premiers chiffres hexadécimaux du SHA-256 du fichier d'entrée : le même fichier
    donne le même passage."""
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
    Seuls restent les noms de la liste blanche dont la valeur est un entier positif ; les
    zéros sont omis."""
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
    """Les mesures d'un passage allé jusqu'au bout. Chaque valeur est un entier tiré d'un
    compte ou d'un statut."""
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
        # `_hors_service` signale une vraie panne du réseau ; stats['crossref']['indisponible']
        # devient vrai dès qu'un DOI ne répond pas, un 404 suffit.
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
    """`(type, lieu)` d'une exception : le nom de sa classe et le dernier cadre d'un fichier du
    dépôt (`fichier.py:ligne`). Ni message ni chemin, qui peuvent citer le document. Une
    valeur hors du motif attendu est remplacée par une valeur neutre."""
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
# Arguments, analysés à la main comme dans les autres CLI de pipeline/.

def _analyser_args(argv):
    args = {'entree': None, 'produit': None, 'sortie': None, 'rapport': None,
            'base_auteurs': None, 'format': 'docx', 'analyse_seule': False, 'sans_typo': False,
            'sans_annotation': False, 'sans_reseau': False, 'etapes': False}
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
            # Chemin de la base des auteurs OJS (format v2, mn.BaseNoms.charger()). Sans lui,
            # mn.BaseNoms.charger() cherche SZH_AUTEURS_CACHE, puis
            # /mnt/c/ProgramData/SZH/auteurs.json ou C:\ProgramData\SZH\auteurs.json.
            i += 1
            args['base_auteurs'] = reste[i]
        elif a == '--format' and i + 1 < len(reste):
            # Format de sortie, docx (défaut) ou odt, indépendant de celui de l'entrée. Une
            # valeur inconnue est refusée par le contrôle d'usage plus bas.
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
        elif a == '--etapes':
            args['etapes'] = True
        else:
            positionnels.append(a)
        i += 1
    if positionnels:
        args['entree'] = positionnels[0]
    return args


USAGE = ('usage : manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift '
         '--sortie <dossier> [--rapport <fichier.json>] [--base-auteurs <fichier>] '
         '[--format docx|odt] [--analyse-seule] [--sans-typo] [--sans-annotation] '
         '[--sans-reseau] [--etapes]')


# ---------------------------------------------------------------------------------
# Alertes propres à cette CLI. Elles ne sont pas dans le catalogue de manuscrit_regles.py et
# s'ajoutent aux alertes des moteurs.

NOMS_LANGUE_FR = {'fr': 'français', 'de': 'allemand', 'en': 'anglais', 'it': 'italien'}
NOMS_LANGUE_DE = {'fr': 'Französisch', 'de': 'Deutsch', 'en': 'Englisch', 'it': 'Italienisch'}


def _alerte_langue_produit(document_langue, langue):
    """Avertit quand la langue déclarée du document (« fr » de « fr-CH ») diffère de
    `langue`, celle du produit, qui pilote le traitement. Rend None sinon."""
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
    """La typographie n'a pas pu être appliquée (pandoc ou WSL indisponible). Pas utilisée
    pour --sans-typo, qui est un choix."""
    if langue == 'fr':
        message = ("La typographie n’a pas pu être appliquée à ce document\u00a0; le texte "
                   "est rendu tel quel.")
    else:
        message = ("Die Typografie konnte auf dieses Dokument nicht angewendet werden; der "
                   "Text wird unverändert wiedergegeben.")
    return {'rule': 'Typo.ApplicationImpossible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


def _alerte_vale_indisponible(langue):
    """Vale n'a pas pu tourner (binaire absent, wsl.exe injoignable, configuration cassée ;
    voir manuscrit_vale.analyser())."""
    if langue == 'fr':
        message = ("Le contrôle du vocabulaire et du langage n’a pas pu être effectué sur "
                   "ce document.")
    else:
        message = ("Die Prüfung von Wortschatz und Sprache konnte für dieses Dokument nicht "
                   "durchgeführt werden.")
    return {'rule': 'Vale.Indisponible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


def _alerte_annotation_impossible(langue):
    """manuscrit_annoter.annoter() a levé une exception : le .docx déjà écrit reste
    utilisable, sans révisions ni commentaires."""
    if langue == 'fr':
        message = ("Les corrections n’ont pas pu être posées dans le document\u00a0: "
                   "consultez le rapport pour la liste complète des remarques.")
    else:
        message = ("Die Korrekturen konnten nicht in das Dokument eingetragen werden: Die "
                   "vollständige Liste der Anmerkungen finden Sie im Bericht.")
    return {'rule': 'Annotation.Impossible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None, 'message': message}


def _alerte_conversion_odt_impossible(detail, langue):
    """La sortie .odt (--format odt) n'a pas pu être produite : le .docx écrit et annoté est
    livré à la place."""
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
# Regroupement des alertes des quatre moteurs. mr.CATALOGUE_PAR_ID ne connaît que les règles
# structurelles : les règles Vale (« CSPS.Epicene.… », « SZH.Vokabular.… »,
# « CSPS-Biblio.APA.… ») et celles de manuscrit_biblio.py (« APA.… ») n'y sont pas. Le lot
# fusionné passe donc par _grouper_toutes_alertes(), pas par manuscrit_regles.grouper().

def _famille_regle(identifiant_regle):
    if identifiant_regle.startswith('Typo.'):
        return 'Typo'
    regle = mr.CATALOGUE_PAR_ID.get(identifiant_regle)
    if regle is not None:
        return regle.famille
    # Règle Vale à trois segments (« CSPS.Epicene.FormesContractees ») : la famille est au
    # milieu. Règle à deux segments (« APA.CitationAbsente », « Vale.Indisponible ») : la
    # famille est le premier.
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
    """Pose `origine` sur chaque alerte du lot et rend le lot. `nettoyage` : les alertes que
    cette CLI émet elle-même."""
    for a in lot:
        a['origine'] = origine
    return lot


def _compter_origines(alertes):
    """Compte des alertes par origine ; la somme vaut le total. Une alerte sans origine valide
    devient `inconnue`, comptée et tracée dans le journal, plutôt que de faire planter le
    passage ; les tests, eux, échouent sur `inconnue`."""
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
    """Trie par sévérité puis par `para` ; une alerte sans `para` va en fin de son groupe."""
    alertes.sort(key=lambda a: (RANG_SEVERITE.get(a.get('severity'), 3),
                                 a.get('para') if a.get('para') is not None else float('inf')))
    return alertes


def _marquer_dans_docx(alertes, stats_annotation):
    """Ajoute `dans_docx` ('revision' | 'commentaire' | 'rapport') à chaque alerte.

    Le verdict vient de `stats['devenir']`, indexé comme `alertes`, rendu par
    `manuscrit_annoter.annoter()`. Il ne se déduit pas de `action` : une alerte `fix` peut
    être devenue un commentaire (chevauchement) ou rester au rapport (plafond)."""
    devenir = stats_annotation.get('devenir') or []
    for i, a in enumerate(alertes):
        verdict = devenir[i] if i < len(devenir) else None
        a['dans_docx'] = verdict if verdict in ('revision', 'commentaire') else 'rapport'


def _recueillir_refs_paragraphes(blocs):
    """[(liste_conteneur, indice), ...] pour chaque Paragraphe à toute profondeur : la
    typographie remplace ainsi un paragraphe à sa place dans la structure."""
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
    """Applique la typographie (manuscrit_typo) aux champs de l'en-tête avant leur écriture
    dans les tableaux du gabarit, car ils sont extraits avant la typographie du corps. Titre
    et sous-titre reçoivent les règles de titre ; un résumé en autre langue est traité dans
    sa langue, et une langue que le filtre ne connaît pas (en) reste intacte.
    Modifie `entete` ; rend (traces, avertissements)."""
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
# Classement des titres. Cas B : l'heuristique de manuscrit_modele.classer_titres(). Cas A :
# niveau_retenu = niveau_declare.

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
# Messages de refus, dans la langue du produit. Le lanceur les montre tels quels, précédés de
# « Refusé : ».

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
    """Lance `_principal` en recueillant les constats d'import (voir `_avertir_capture`) et
    les lignes de progression pour le rapport. L'état est remis à zéro à chaque appel et
    szh_commun.avertir est rétabli à la fin."""
    del _AVERTISSEMENTS_IMPORT[:]
    del _JOURNAL_PROGRES[:]
    szh_commun.avertir = _avertir_capture
    _ETAT.update({'etape': 'demarrage', 'entree': '', 'produit': '', 'format_entree': '',
                  'debut': time.perf_counter(), 'etapes': False})
    try:
        return _principal(argv)
    except Exception as e:
        return _plantage(e)
    finally:
        szh_commun.avertir = _avertir_original


def _plantage(exc):
    """Traite une exception non rattrapée, donc un défaut du logiciel. Écrit sur stdout une
    ligne JSON avec le type, le lieu dans le dépôt et l'étape, sans le message de
    l'exception, qui peut citer le document. La trace complète va sur stderr si
    SZH_NETTOYEUR_TRACE est posée."""
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
                  'format_entree': 'odt' if extension == '.odt' else 'docx',
                  'etapes': args['etapes']})
    _etape('controle-entree')

    def refuser(code, message_fr, **supplement):
        # `message_fr` peut être dans la langue du produit quand l'appelant la connaît.
        # `supplement` : champs ajoutés à la ligne stdout.
        progres('refusé : %s' % message_fr)
        ligne = {'entree': entree, 'refus': True, 'code_refus': code,
                 'message': message_fr, 'code_sortie': CODE_REFUS}
        ligne.update(supplement)
        ligne['compteurs'] = _compteurs(_passage(entree), _mesures_minimales(
            'refus:' + code, _duree_ms(debut), args['produit'], _ETAT['format_entree']))
        _ligne_stdout(ligne)
        return CODE_REFUS

    progres('entrée : %s (produit=%s)' % (entree, args['produit']))

    # Les refus arrivent avant tout travail et n'écrivent rien sur le disque. Ici : un verrou
    # temporaire de Word, dont la lecture échouerait sans message clair.
    if os.path.basename(entree).startswith('~$'):
        return refuser('fichier-verrou',
                        "Ce fichier est un verrou temporaire de Word, pas un manuscrit. "
                        "Ouvrez le document original.")

    if extension not in ('.docx', '.odt'):
        return refuser('extension-inconnue',
                        "extension « %s » non reconnue : ce nettoyeur ne lit que .docx et "
                        ".odt aujourd'hui." % extension)

    # Une entrée .odt est convertie en .docx dans un dossier temporaire avant la lecture.
    # `chemin_lecture` pointe ce .docx ; `entree` et `nom` restent ceux du fichier d'origine.
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
        # Le .docx temporaire n'est plus utile une fois le document en mémoire.
        if dossier_temp_odt is not None:
            shutil.rmtree(dossier_temp_odt, ignore_errors=True)

    # Référence du contrôle de perte (voir _controler_perte), prise avant que l'en-tête et le
    # bloc des auteurs ne retirent des blocs de document.blocs.
    empreinte_entree = _mots_et_images(document)

    # Refus : modifications suivies. Un texte avec des w:ins/w:del n'a pas de contenu univoque.
    if document.revisions > 0:
        sortie_nettoyeur = (nom.endswith('-nettoye')
                            or bool(_auteurs_revisions(chemin_lecture) & AUTEURS_NETTOYEUR))
        return refuser('suivi-modifications',
                        _message_suivi_modifications(document.revisions, sortie_nettoyeur,
                                                     args['produit']),
                        revisions=document.revisions, sortie_nettoyeur=sortie_nettoyeur)

    # Un document avec des commentaires est accepté ; le rapport dit qu'ils sont perdus.
    note_commentaires = None
    if document.commentaires > 0:
        note_commentaires = ('%d commentaire(s) trouvé(s) dans ce document : ils ne '
                              'survivent pas au nettoyage, la sortie ne les porte pas.'
                              % document.commentaires)
        progres(note_commentaires)

    _etape('gabarit')
    gabarit = mm.reconnaitre_gabarit(document)
    progres('gabarit reconnu : cas %s' % gabarit)

    # La langue de traitement vient du produit. Elle sert au filtre (-M lang=), à l'en-tête,
    # aux règles et au rapport.
    langue = 'fr' if args['produit'] == 'revue' else 'de'

    # Base de noms, chargée une fois pour l'en-tête et le bloc final des auteurs. Sans source
    # trouvée, la base est indisponible, sans exception.
    _etape('noms')
    progres('chargement de la base de noms...')
    base_noms = mn.BaseNoms.charger(chemin_base_auteurs=args['base_auteurs'])
    if base_noms.disponible:
        progres('base de noms : %s' % '; '.join(base_noms.sources))
    else:
        progres('base de noms indisponible (aucune source trouvée)')

    # En-tête, en cas B seulement (en cas A, le gabarit est déjà rempli). Titre, sous-titre,
    # auteurs, résumé, mots-clés, DOI et ligne de revue sont retirés du corps avant le
    # classement des titres de section.
    entete = None
    ecartes_entete = None
    trace_entete = []
    indices_entete = {}
    paragraphes_entete_ctx = []
    auteurs_ctx = []
    alertes_identifiants = []
    stats_identifiants = None
    if gabarit == 'B':
        # Noms de bibliographie, lus avant extraire_entete() sur le document encore complet
        # (voir _noms_de_bibliographie()).
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
        # contexte['auteurs'] pour les règles Entete.OrdreNomIncertain et
        # Entete.OrdreNomParDefaut de manuscrit_regles.py ; vide en cas A.
        auteurs_ctx = [{'prenom': a.get('prenom') or '', 'nom': a.get('nom') or '',
                         'ordre_confiance': a.get('ordre_confiance') or '',
                         'ordre_motif': a.get('ordre_motif') or '',
                         'ordre_conflit': bool(a.get('ordre_conflit')),
                         'texte_source': a.get('texte_source') or ''}
                        for a in entete.auteurs]
        # Ce que l'en-tête retire sans que le gabarit ait où l'écrire, mesuré avant le retrait
        # des blocs, sur les indices du document complet.
        ecartes_entete = _ecartes_par_entete(document, entete, indices_entete)
        document.blocs = [b for idx, b in enumerate(document.blocs)
                           if idx not in indices_entete]
        progres('en-tête : titre=%r, %d auteur(s), résumé=%d signe(s), %d mot(s)-clé(s)'
                % (entete.titre, len(entete.auteurs), len(entete.resume),
                   len(entete.mots_cles)))

        # ROR et ORCID des auteurs, cherchés en ligne et écrits en révision à vérifier par le
        # gabarit ; un nom seul ne suffit pas (voir manuscrit_identifiants).
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
    # Dans les deux cas : un titre ne garde pas la numérotation de son style comme une liste,
    # et un paragraphe numéroté par la liste des titres en est un.
    n_promus_plan, n_numeros_retires, trace_plan = mm.titres_du_plan(document)
    stats_titres['promus_plan'] = n_promus_plan
    stats_titres['numeros_titres_retires'] = n_numeros_retires
    trace_titres = trace_titres + trace_plan

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
        # "repli" sur la ligne stdout, sans l'alerte de repli : c'est un choix, visible par
        # sans_typo dans le rapport.
        statut_typo = 'repli'
    else:
        progres('normalisation typographique (langue=%s)...' % langue)
        # Le corps et les notes (Document.notes, rangées à part) passent dans le même appel.
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
    # mr.evaluer() rend dans une même liste les règles structurelles et la reprise des
    # avertissements C1/C2 du filtre typographique (préfixe 'Typo.') ; on les sépare pour que
    # `alertes.origine` compte chaque moteur.
    alertes_regles = _etiqueter([a for a in alertes_python if not a['rule'].startswith('Typo.')],
                                 'regles')
    alertes_typo_reprises = _etiqueter([a for a in alertes_python if a['rule'].startswith('Typo.')],
                                        'typographie')

    # Vale. Le titre de la bibliographie n'y passe pas : `entrees_biblio` l'exclut, et le
    # corps exclut le rôle 'bibliographie'. Les cellules de tableau et les notes s'y ajoutent,
    # sans ancrage possible (voir _paragraphes_cellules_pour_vale()).
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
        # Une alerte dont `para` est la `source` fictive d'un paragraphe de note (voir
        # _paragraphes_notes_pour_vale) reçoit `note_id`, `note_numero` et le `para` du
        # paragraphe qui porte l'appel. manuscrit_annoter.py l'ancre alors sur le mot qui
        # précède l'appel.
        _marquer_notes_dans_alertes(alertes_vale, correspondance_notes_vale)

    # Bibliographie : les mêmes deux corpus, sans le rôle. --sans-reseau sert aux essais et aux
    # tests ; le lanceur ne le pose pas.
    _etape('bibliographie')
    progres('contrôle de la bibliographie...')
    paragraphes_biblio_module = [{'texte': e['texte'], 'source': e['source']}
                                  for e in entrees_biblio]
    # Les citations des notes et des cellules comptent aussi (mêmes paragraphes que Vale),
    # sinon une référence citée seulement en note serait déclarée non citée.
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

    # Sorties, dans le dossier --sortie.
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

        # Contrôle de perte sur le .docx écrit, avant l'annotation, dont le texte barré
        # fausserait le compte.
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
            # La moitié du manuscrit ou plus manque : le fichier est supprimé pour ne pas être
            # importé par mégarde. Le rapport est écrit et le dit.
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
            # Copie en mémoire du .docx non annoté : si l'annotation échoue, par exception ou
            # en laissant un XML mal formé, cette version est restaurée.
            with open(sortie_docx, 'rb') as _f:
                octets_avant_annotation = _f.read()
            try:
                stats_annotation = ma.annoter(
                    sortie_docx, sortie_docx, alertes, resultat_ecriture['correspondance'],
                    langue=langue, auteur=AUTEUR_ANNOTATION, plafond_commentaires=25)
                # Une révision qui touche la frontière d'un <w:hyperlink> peut rendre
                # document.xml mal formé sans exception : la validité se vérifie ici.
                _valider_docx_bien_forme(sortie_docx)
            except Exception as e:
                # Une panne de l'annotation ne doit pas faire perdre le .docx écrit ni le
                # rapport : elle est traitée comme une indisponibilité, comme pour Vale, et le
                # .docx non annoté est restauré. Cas connu : `KeyError: 'texto'` dans
                # `_xml_del()` quand deux révisions d'un même paragraphe se touchent ou se
                # chevauchent (voir `_anotar_parrafo()`).
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

    # Sortie .odt (--format odt) : le .docx définitif, écrit, contrôlé et annoté, est converti
    # ici. En cas d'échec, le .docx est livré avec une alerte. `sortie` est le chemin livré,
    # quel que soit le format ; `sortie_docx` vaut le .docx s'il est livré, sinon None.
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

    # signes_total compte le corps sans l'en-tête (titre, sous-titre, résumé, mots-clés,
    # auteurs), bibliographie comprise ; signes_biblio en est une partie.
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
                      # Mots et images du manuscrit retrouvés dans le .docx écrit
                      # (None en --analyse-seule).
                      'perte_de_contenu': mesure_perte},
        'compteurs': {
            'signes_total': signes_total, 'signes_bibliographie': signes_biblio,
            'nb_references': len(entrees_biblio), 'commentaires': document.commentaires,
            'note_commentaires': note_commentaires,
            'notes': len(document.notes or {}),
            'revisions': stats_annotation['revisions'] if stats_annotation else 0,
            'commentaires_poses': stats_annotation['commentaires'] if stats_annotation else 0,
            'images': {'total': len(images), 'sans_alt': images_sans_alt,
                       # Dimensions en pixels seulement : le verdict de qualité est rendu par
                       # lib/qualite-image.js, au moment du rapport HTML.
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
        # Les constats de lecture (en-têtes et pieds non lus, zones de texte...) dans leurs
        # deux langues, et les lignes de progression.
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
