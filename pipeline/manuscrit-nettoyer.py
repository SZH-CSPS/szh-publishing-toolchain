#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit-nettoyer.py — la CLI du nettoyeur de manuscrit (article) : le CHAÎNON qui
# branche les six modules déjà écrits et éprouvés (manuscrit_docx, manuscrit_modele,
# manuscrit_typo, manuscrit_regles, manuscrit_gabarit), et rien d'autre. Contrat :
# outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §8 (cette CLI), §1 (les deux cas), §10
# (les pièges), §11 (les contrôles).
#
#   manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift --sortie <dossier>
#                         [--rapport <fichier.json>] [--analyse-seule] [--sans-typo]
#
# Convention du tiret (§3 du contrat) : ce fichier PORTE un tiret dans son nom, c'est une
# CLI, jamais un module importé par un autre fichier Python.
#
# stdlib seule : aucune dépendance nouvelle (§2 du contrat).
#
# ── Enchaînement (§8, dans l'ordre imposé par la mission) ──────────────────────────────────
#   lire -> reconnaître le cas -> classer les titres -> nettoyer la mise en forme ->
#   normaliser la typographie -> passer les règles -> écrire le gabarit -> écrire le rapport.
#
# ── Ce que le contrat ne précisait pas et qu'il a fallu décider ici (à signaler, pas à
#    corriger en silence dans les modules qui ne sont pas les deux fichiers de ce chantier) ─
#
# 1. Le rôle ('role') attendu par manuscrit_regles.py n'est fourni QUE dans deux cas, tous
#    deux à faible risque de faux positif (§7 du contrat : « un résumé deviné à tort ferait
#    crier une règle... quand tu ne sais pas, laisse '' ») :
#      - 'titre' : le tout premier bloc du document, SI c'est un Paragraphe et que
#        classer_titres() (ou, en cas A, le niveau déclaré) lui a retenu un niveau de titre.
#        Un manuscrit commence presque toujours par son propre titre ; au-delà de ce premier
#        bloc, aucun autre niveau de titre n'est jamais pris pour LE titre de l'article.
#      - 'bibliographie' : le DERNIER paragraphe de niveau de titre dont le texte, aplati,
#        tombe dans le lexique de TITRES_BIB (pipeline/filters/szh-citations.lua), ET tout ce
#        qui suit jusqu'à la fin du document ou jusqu'à un tableau — MÊME critère que
#        pronto_modele.etendue_biblio(), reconstruit ici sur le modèle RICHE avec les mêmes
#        briques PUBLIQUES (lire_titres_bib(), RE_NUM_TITRE_BIBLIO, PREFIXES_TITRE_BIBLIO,
#        aplatir()) : le lexique n'est jamais recopié, seule la petite comparaison est
#        réécrite ici parce que pronto_modele._titre_est_biblio() porte un tiret bas (privé
#        à son propre module dans les conventions de ce dépôt).
#    'sous_titre' et 'resume' ne sont JAMAIS déduits : rien, dans le modèle riche d'un
#    manuscrit quelconque (cas B), ne les distingue de façon fiable d'un titre de section ou
#    d'un paragraphe de corps ordinaire. Conséquence assumée : Forme.LongueurResume et les
#    règles de sous-titre du catalogue ne se déclenchent jamais sur la sortie de cette CLI —
#    c'est le comportement sûr que le contrat demande explicitement, pas un oubli.
#
# 2. Le nombre d'auteurs d'une entrée de bibliographie (bibliographie[i].nb_auteurs) reste
#    TOUJOURS 0 : dénombrer les auteurs d'une référence APA est un problème à part entière,
#    déjà pourvu de son propre harnais dans ce dépôt (le parser d'auteurs). Le réinventer ici
#    en trois lignes de regex ferait à coup sûr un compte faux sur les cas réels (particules,
#    « et al. », sigles d'auteur institutionnel...). nb_auteurs = 0 ne peut jamais dépasser
#    NB_AUTEURS_TRONCATURE : APA.NombreAuteursListes ne se déclenche donc jamais — sûr, pas
#    utile pour cette règle précise, signalé ici plutôt que tu.
#
# 3. Révision du 19.09.2026 : ce point est corrigé. manuscrit_typo.normaliser_paragraphes()
#    rend maintenant aussi les lignes stderr [typo-avertissement] d'un appel pandoc RÉUSSI
#    (avant : cette lecture ne se faisait que sur l'échec, et les lignes d'un succès étaient
#    capturées puis jetées en silence). Elles alimentent avertissements_typo du contexte passé
#    aux règles — plus jamais une liste vide codée en dur ici.
#
# 4. Cas A (§1) : aucun document réel n'existe pour l'éprouver (contrat, 18.09.2026). classer_
#    titres() n'est PAS appelé — niveau_retenu := niveau_declare, sans heuristique de
#    promotion/rétrogradation ('aucune restructuration' au sens des TITRES). nettoyer_mise_en_
#    forme() est appliqué dans les deux cas ('style de corps' — ce qui reste manuel dessus
#    part, dans les deux cas). ⚠ Risque connu, NON corrigé ici (hors des deux fichiers de ce
#    chantier) : manuscrit_gabarit.ecrire() insère TOUJOURS ses propres deux tableaux fixes
#    (métadonnées, autrices/auteurs), vides, recopiés depuis le gabarit pristine, AVANT le
#    corps qu'il construit depuis document.blocs. Un document de cas A porte pourtant DÉJÀ
#    ces deux tableaux, remplis, comme les deux premiers blocs de son propre document.blocs
#    (manuscrit_docx.lire() ne les filtre pas — rien dans le contrat ne le lui demande). Le
#    repasser tel quel dans ecrire() re-lirait donc CES tableaux remplis comme s'ils étaient
#    de simples tableaux du corps du manuscrit (probablement enveloppés dans un bloc tableau
#    avec sa propre rangée de métadonnées ajoutée), EN PLUS des deux tableaux fixes, VIDES,
#    que ecrire() insère lui-même. Signalé au rapport de chantier, non trafiqué en silence
#    ici : aucun document réel n'existe pour vérifier quelle correction serait la bonne.
#
# 5. Révision du 19.09.2026, trois décisions prises seul :
#    - la langue de traitement ('fr'/'de', passée au filtre ET aux règles ET au rapport) vient
#      DÉSORMAIS du produit (--produit revue -> fr, zeitschrift -> de), plus jamais de
#      `document.langue or 'fr'` : un article français déclaré `de-CH` recevait la
#      typographie allemande (mesuré sur lot-A). La langue déclarée du document ne sert plus
#      qu'à une alerte warning (Langue.DesaccordProduit) quand sa sous-étiquette primaire
#      (« fr » de « fr-CH ») diffère de celle du produit ;
#    - un repli typographique (pandoc/WSL indisponible) produit maintenant une alerte warning
#      (Typo.ApplicationImpossible) en plus de la trace enfouie dans le rapport, et la ligne
#      stdout porte `typographie: "appliquee" | "repli"`. --sans-typo compte aussi comme
#      "repli" sur cette ligne (rien n'a été tenté), mais ne lève PAS cette alerte : c'est un
#      choix explicite déjà visible via `sans_typo` dans le rapport, pas une panne d'outillage
#      à signaler à la rédaction ;
#    - un fichier `~$*.docx` (verrou temporaire de Word, un document ouvert dans Word en pose
#      un à côté) est désormais refusé proprement (code 2, code_refus='fichier-verrou') avant
#      toute lecture. Avant cette révision, `md.lire()` levait « File is not a zip file » et
#      le code de sortie était 3, sans message pour la rédaction.

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele
import manuscrit_docx as md
import manuscrit_modele as mm
import manuscrit_entete as me
import manuscrit_typo as mt
import manuscrit_regles as mr
import manuscrit_gabarit as mg

RACINE_DEPOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEMIN_GABARIT = os.path.join(RACINE_DEPOT, 'revue-template', "Pronto - modele d'article.docx")

PREFIXE = '[manuscrit-nettoyer]'

# Codes de sortie — mêmes valeurs que manuscrit_regles.principal() pour 0/1 (§7 : « code de
# sortie non nul dès la première alerte error »), deux valeurs propres à cette CLI en plus.
CODE_OK = 0
CODE_ALERTE_ERROR = 1
CODE_REFUS = 2
CODE_ECHEC_INTERNE = 3


def _forcer_utf8():
    """§8 du contrat, clause non négociable : sans elle, pronto-lire.py (déjà dans ce dépôt)
    plante sur un nom de fichier accentué dès que la console Windows est en cp1252. Ce
    module force ses DEUX flux, jamais un seul."""
    for flux in (sys.stdout, sys.stderr):
        try:
            flux.reconfigure(encoding='utf-8')
        except Exception:
            pass


def progres(message):
    """Une ligne de progression, sur stderr, jamais sur stdout (§8 : l'onglet du lanceur les
    affiche au fil de l'eau ; stdout ne porte QUE la ligne JSON finale)."""
    print('%s %s' % (PREFIXE, message), file=sys.stderr, flush=True)


def _ligne_stdout(objet):
    """LA seule ligne que ce script écrit sur stdout, quel que soit le chemin de sortie
    (succès, refus, échec) — §8 : « rien d'autre sur ce flux »."""
    print(json.dumps(objet, ensure_ascii=True))


# ---------------------------------------------------------------------------------
# Arguments — analyse manuelle, comme tous les CLI de pipeline/ (aucun n'utilise argparse :
# pronto-lire.py, docx-titres.py... ce fichier ne rompt pas cette convention).

def _analyser_args(argv):
    args = {'entree': None, 'produit': None, 'sortie': None, 'rapport': None,
            'analyse_seule': False, 'sans_typo': False}
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
        elif a == '--analyse-seule':
            args['analyse_seule'] = True
        elif a == '--sans-typo':
            args['sans_typo'] = True
        else:
            positionnels.append(a)
        i += 1
    if positionnels:
        args['entree'] = positionnels[0]
    return args


USAGE = ('usage : manuscrit-nettoyer.py <entree.docx|.odt> --produit revue|zeitschrift '
         '--sortie <dossier> [--rapport <fichier.json>] [--analyse-seule] [--sans-typo]')


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
        message = ("Le document est déclaré en %s alors qu'il est traité comme un article de "
                    "la Revue : vérifiez la langue de correction dans Word." % nom)
    else:
        nom = NOMS_LANGUE_DE.get(primaire, primaire)
        message = ("Das Dokument ist als %s markiert, wird aber als Artikel der Zeitschrift "
                    "behandelt: überprüfen Sie die Korrektursprache in Word." % nom)
    return {'rule': 'Langue.DesaccordProduit', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': document_langue, 'suggested': langue,
            'message': message}


def _alerte_repli_typo():
    """La typographie n'a pas pu être appliquée (pandoc/WSL indisponible) : une alerte visible
    dans le rapport, pas seulement une trace enfouie (point 5 de l'en-tête). Jamais levée pour
    --sans-typo, qui est un choix explicite et déjà visible via `sans_typo`, pas une panne."""
    return {'rule': 'Typo.ApplicationImpossible', 'severity': 'warning', 'action': 'report',
            'para': None, 'span': None, 'found': None, 'suggested': None,
            'message': "La typographie n'a pas pu être appliquée à ce document ; le texte "
                       "est rendu tel quel."}


# ---------------------------------------------------------------------------------
# Parcours du modèle riche — à toute profondeur (cellules de tableau comprises), pour les
# images/tableaux du rapport et pour la typographie ; UNIQUEMENT le premier niveau pour les
# paragraphes que voit le moteur de règles (même périmètre que
# manuscrit_modele.taille_dominante() / classer_titres()).

def _parcourir_blocs(blocs):
    """Rend chaque Paragraphe et chaque Tableau, à toute profondeur (corps + cellules)."""
    for bloc in blocs:
        yield bloc
        if isinstance(bloc, mm.Tableau):
            for rangee in bloc.rangees:
                for cellule in rangee:
                    for sous in _parcourir_blocs(cellule.blocs):
                        yield sous


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


def _collecter_images(document):
    """Une entrée par image trouvée à toute profondeur, avec sa source (celle de l'Image
    elle-même si le lecteur l'a posée, sinon celle du paragraphe qui la porte)."""
    images = []
    for bloc in _parcourir_blocs(document.blocs):
        if not isinstance(bloc, mm.Paragraphe):
            continue
        for f in bloc.fragments:
            if f.image is not None:
                img = f.image
                source = img.source if img.source is not None else bloc.source
                images.append({'nom': img.nom, 'source': source, 'alt': img.alt,
                                'largeur_px': img.largeur_px, 'hauteur_px': img.hauteur_px})
    return images


def _collecter_tableaux(document):
    tableaux = []
    for bloc in _parcourir_blocs(document.blocs):
        if isinstance(bloc, mm.Tableau):
            fusion = any(c.colspan > 1 or c.rowspan > 1
                         for rangee in bloc.rangees for c in rangee)
            tableaux.append({'fusion': fusion, 'source': bloc.source})
    return tableaux


# ---------------------------------------------------------------------------------
# Bibliographie — voir le point 1 de l'en-tête : mêmes briques PUBLIQUES que
# pronto_modele.etendue_biblio(), jamais une seconde liste de titres.

def _est_titre_biblio(texte, lexique):
    plat = pronto_modele.RE_NUM_TITRE_BIBLIO.sub('', pronto_modele.aplatir(texte))
    if plat in lexique:
        return True
    for prefixe in pronto_modele.PREFIXES_TITRE_BIBLIO:
        if plat.startswith(prefixe) and plat[len(prefixe):] in lexique:
            return True
    return False


def _indice_titre_biblio(document, lexique):
    """L'indice, dans document.blocs, du DERNIER paragraphe de titre reconnu comme titre de
    bibliographie — None si aucun. « Dernier » : la bibliographie est normalement la toute
    dernière section (même raison que pronto_modele.etendue_biblio)."""
    indice = None
    for i, bloc in enumerate(document.blocs):
        if not isinstance(bloc, mm.Paragraphe) or bloc.niveau_retenu not in (1, 2, 3):
            continue
        texte = bloc.texte().strip()
        if texte and _est_titre_biblio(texte, lexique):
            indice = i
    return indice


RE_ANNEE_BIBLIO = re.compile(r'((?:19|20)\d{2})')


def _entree_biblio(paragraphe):
    """Extraction minimale (nom, année) pour APA.OrdreAlphabetiqueBiblio — voir le point 2 de
    l'en-tête : nb_auteurs reste TOUJOURS 0, jamais deviné."""
    texte = paragraphe.texte().strip()
    m = RE_ANNEE_BIBLIO.search(texte)
    annee = int(m.group(1)) if m else None
    nom = None
    virgule = texte.find(',')
    if 0 < virgule <= 60:
        nom = texte[:virgule].strip()
    elif m:
        nom = texte[:m.start()].strip(' (').rstrip('.,') or None
    return {'texte': texte, 'source': paragraphe.source, 'nom': nom, 'annee': annee,
            'nb_auteurs': 0}


def _construire_bibliographie(document):
    """(sources_biblio, entrees) : `sources_biblio` = l'ensemble des Paragraphe.source qui
    appartiennent à la bibliographie (titre compris, pour le compte de signes du §7 —
    « références bibliographiques compris ») ; `entrees` = une par référence, hors le titre
    lui-même."""
    lexique = pronto_modele.lire_titres_bib()
    indice_titre = _indice_titre_biblio(document, lexique)
    if indice_titre is None:
        return set(), []
    sources = set()
    entrees = []
    for i in range(indice_titre, len(document.blocs)):
        bloc = document.blocs[i]
        if isinstance(bloc, mm.Tableau):
            break
        if not isinstance(bloc, mm.Paragraphe):
            continue
        sources.add(bloc.source)
        if i == indice_titre:
            continue
        if bloc.texte().strip():
            entrees.append(_entree_biblio(bloc))
    return sources, entrees


# ---------------------------------------------------------------------------------
# Rôle des paragraphes — voir le point 1 de l'en-tête : deux cas seulement, '' sinon.
#
# Révision du 19.09.2026 (§5.5) : le repli « premier bloc du document = titre » ne vaut plus
# qu'en CAS A. En cas B, le titre est désormais retiré du corps par
# manuscrit_entete.extraire_entete() AVANT cette fonction — le premier bloc restant n'est
# alors qu'un paragraphe de corps ordinaire (ou un intertitre), jamais LE titre de l'article ;
# le rôle 'titre' de cas B vient exclusivement de _paragraphes_entete_contexte() ci-dessous.

def _construire_paragraphes_contexte(document, sources_biblio, gabarit):
    paras = [b for b in document.blocs if isinstance(b, mm.Paragraphe)]
    premier_bloc = document.blocs[0] if document.blocs else None
    resultat = []
    for p in paras:
        if p.source in sources_biblio:
            role = 'bibliographie'
        elif gabarit == 'A' and p is premier_bloc and p.niveau_retenu > 0:
            role = 'titre'
        else:
            role = ''
        resultat.append({'source': p.source, 'texte': p.texte(), 'role': role,
                          'niveau_retenu': p.niveau_retenu})
    return resultat


# ---------------------------------------------------------------------------------
# En-tête (§5.5) — cas B seulement. Les paragraphes que manuscrit_entete.extraire_entete() a
# retirés du corps sont remis dans le contexte des règles, avec leur rôle : c'est ce dont
# Forme.LongueurResume/LongueurTitre ont besoin pour juger (ils lisent contexte['paragraphes'],
# jamais l'EnTete elle-même). 'doi'/'ligne_revue' n'appartiennent pas au vocabulaire de rôle
# que manuscrit_regles.py reconnaît (voir son en-tête) : ces deux-là ne sont donc jamais
# ajoutés ici — ils restent simplement absents du corps, sans qu'aucune règle les juge.
ROLES_ENTETE_POUR_REGLES = ('titre', 'sous_titre', 'resume', 'mots_cles', 'auteurs')


def _paragraphes_entete_contexte(document, indices_consommes):
    """Appelée AVANT le retrait des indices de document.blocs — elle a besoin des
    paragraphes encore en place pour lire leur texte."""
    resultat = []
    for i, role in indices_consommes.items():
        if role not in ROLES_ENTETE_POUR_REGLES:
            continue
        bloc = document.blocs[i]
        if not isinstance(bloc, mm.Paragraphe):
            continue
        resultat.append({'source': bloc.source, 'texte': bloc.texte(), 'role': role,
                          'niveau_retenu': 0})
    return resultat


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
# Le programme.

def principal(argv):
    _forcer_utf8()
    debut = time.perf_counter()
    args = _analyser_args(argv)

    if not args['entree'] or args['produit'] not in ('revue', 'zeitschrift') or not args['sortie']:
        print(USAGE, file=sys.stderr)
        return 2

    entree = args['entree']
    nom = os.path.splitext(os.path.basename(entree))[0]
    extension = os.path.splitext(entree)[1].lower()

    def refuser(code, message_fr):
        progres('refusé : %s' % message_fr)
        _ligne_stdout({'entree': entree, 'refus': True, 'code_refus': code,
                       'message': message_fr, 'code_sortie': CODE_REFUS})
        return CODE_REFUS

    progres('entrée : %s (produit=%s)' % (entree, args['produit']))

    # Refus, avant tout travail, sans rien écrire sur le disque (§8) : un verrou temporaire de
    # Word (le document est ouvert ailleurs), avant même de tenter une lecture qui échouerait
    # de façon opaque (§10, point 5 de l'en-tête).
    if os.path.basename(entree).startswith('~$'):
        return refuser('fichier-verrou',
                        "Ce fichier est un verrou temporaire de Word, pas un manuscrit. "
                        "Ouvrez le document original.")

    # Refus, avant tout travail, sans rien écrire sur le disque (§8) : extension inconnue,
    # ou .odt pour l'instant (pipeline/manuscrit_odt.py n'existe pas encore).
    if extension == '.odt':
        return refuser('format-odt-a-venir',
                        "le format .odt n'est pas encore pris en charge par ce nettoyeur "
                        "(pipeline/manuscrit_odt.py reste à écrire) ; réenregistrez ce "
                        "manuscrit en .docx, ou patientez.")
    if extension != '.docx':
        return refuser('extension-inconnue',
                        "extension « %s » non reconnue : ce nettoyeur ne lit que .docx "
                        "aujourd'hui (.odt refusé explicitement, en attente)." % extension)

    progres('lecture du manuscrit...')
    try:
        document = md.lire(entree)
    except Exception as e:
        progres('lecture impossible : %s' % e)
        _ligne_stdout({'entree': entree, 'refus': True, 'code_refus': 'lecture-impossible',
                       'message': str(e), 'code_sortie': CODE_ECHEC_INTERNE})
        return CODE_ECHEC_INTERNE

    # Refus, avant tout travail, sans rien écrire sur le disque (§8) : suivi de
    # modifications — un texte avec des w:ins/w:del n'a pas de contenu univoque.
    if document.revisions > 0:
        return refuser('suivi-modifications',
                        "ce document porte %d marque(s) de suivi de modifications "
                        "(w:ins/w:del) : son contenu n'est pas univoque, acceptez ou "
                        "refusez ces modifications dans Word avant de le soumettre au "
                        "nettoyeur." % document.revisions)

    # Un document porteur de commentaires n'est PAS refusé (§8) : compté, signalé, et le
    # rapport dit qu'ils ne survivent pas au nettoyage.
    note_commentaires = None
    if document.commentaires > 0:
        note_commentaires = ('%d commentaire(s) trouvé(s) dans ce document : ils ne '
                              'survivent pas au nettoyage, la sortie ne les porte pas.'
                              % document.commentaires)
        progres(note_commentaires)

    gabarit = mm.reconnaitre_gabarit(document)
    progres('gabarit reconnu : cas %s' % gabarit)

    # La langue de traitement vient du PRODUIT, jamais du document (point 5 de l'en-tête) :
    # c'est elle qui part au filtre (-M lang=), à l'en-tête (§5.5), aux règles et au rapport.
    # Calculée ICI (avant classer_titres) : extraire_entete() en a besoin.
    langue = 'fr' if args['produit'] == 'revue' else 'de'

    # En-tête (§5.5) — cas B seulement (§1 : « en cas A, rien de tout ceci, le gabarit est
    # déjà rempli »). Retire le titre/sous-titre/auteurs/résumé/mots-clés/DOI/ligne de revue
    # du corps AVANT le classement des titres de section, qui ne doit juger que ce qui reste.
    entete = None
    trace_entete = []
    indices_entete = {}
    paragraphes_entete_ctx = []
    if gabarit == 'B':
        progres("reconnaissance de l'en-tête...")
        entete, indices_entete, trace_entete = me.extraire_entete(document, langue)
        paragraphes_entete_ctx = _paragraphes_entete_contexte(document, indices_entete)
        document.blocs = [b for idx, b in enumerate(document.blocs)
                           if idx not in indices_entete]
        progres('en-tête : titre=%r, %d auteur(s), résumé=%d signe(s), %d mot(s)-clé(s)'
                % (entete.titre, len(entete.auteurs), len(entete.resume),
                   len(entete.mots_cles)))

    progres('classement des titres...')
    stats_titres, trace_titres = _classer_titres_selon_le_cas(document, gabarit)

    progres('nettoyage de la mise en forme...')
    stats_formatage, trace_formatage = mm.nettoyer_mise_en_forme(document)

    alertes_manuelles = []
    alerte_langue = _alerte_langue_produit(document.langue, langue)
    if alerte_langue:
        alertes_manuelles.append(alerte_langue)
        progres(alerte_langue['message'])

    if args['sans_typo']:
        progres('typographie désactivée (--sans-typo)')
        traces_typo = ['typographie désactivée (--sans-typo)']
        abandons_typo, avertissements_typo = [], []
        # "repli" sur la ligne stdout (rien n'a été tenté), mais SANS l'alerte de repli : un
        # choix explicite, déjà visible via sans_typo au rapport, pas une panne d'outillage.
        statut_typo = 'repli'
    else:
        progres('normalisation typographique (langue=%s)...' % langue)
        refs = _recueillir_refs_paragraphes(document.blocs)
        paras = [conteneur[i] for conteneur, i in refs]
        nouveaux, traces_typo, abandons_typo, avertissements_typo, statut_typo = (
            mt.normaliser_paragraphes(paras, langue, RACINE_DEPOT))
        for (conteneur, i), p in zip(refs, nouveaux):
            conteneur[i] = p
        for ligne in traces_typo:
            progres(ligne)
        if statut_typo == 'repli':
            alertes_manuelles.append(_alerte_repli_typo())

    progres('évaluation des règles éditoriales...')
    sources_biblio, entrees_biblio = _construire_bibliographie(document)
    paragraphes_ctx = (paragraphes_entete_ctx
                        + _construire_paragraphes_contexte(document, sources_biblio, gabarit))
    images = _collecter_images(document)
    tableaux_ctx = _collecter_tableaux(document)
    contexte = {
        'produit': args['produit'], 'langue': langue,
        'paragraphes': paragraphes_ctx, 'bibliographie': entrees_biblio,
        'images': [{'alt': i['alt'], 'source': i['source']} for i in images],
        'tableaux': tableaux_ctx,
        'avertissements_typo': avertissements_typo,
    }
    alertes = mr.evaluer(contexte) + alertes_manuelles
    groupes = mr.grouper(alertes)
    n_error = sum(1 for a in alertes if a['severity'] == 'error')
    n_warning = sum(1 for a in alertes if a['severity'] == 'warning')
    n_suggestion = sum(1 for a in alertes if a['severity'] == 'suggestion')
    progres('%d alerte(s) (%d error, %d warning, %d suggestion)'
            % (len(alertes), n_error, n_warning, n_suggestion))

    # Sorties — toujours à côté du manuscrit d'entrée, jamais une boîte de dialogue (§8).
    dossier = args['sortie']
    os.makedirs(dossier, exist_ok=True)
    sortie_docx = None
    resultat_ecriture = None
    if args['analyse_seule']:
        progres('analyse seule (--analyse-seule) : aucun .docx écrit')
    else:
        sortie_docx = os.path.join(dossier, nom + '-nettoye.docx')
        progres('écriture du gabarit -> %s' % sortie_docx)
        decisions = {'titres': {'stats': stats_titres, 'trace': trace_titres},
                     'formatage': {'stats': stats_formatage, 'trace': trace_formatage}}
        resultat_ecriture = mg.ecrire(document, CHEMIN_GABARIT, sortie_docx,
                                       decisions=decisions, entete=entete)

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
        'analyse_seule': args['analyse_seule'], 'sans_typo': args['sans_typo'],
        'sortie_docx': sortie_docx,
        'compteurs': {
            'signes_total': signes_total, 'signes_bibliographie': signes_biblio,
            'nb_references': len(entrees_biblio), 'commentaires': document.commentaires,
            'note_commentaires': note_commentaires,
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
        'alertes': {'total': len(alertes), 'error': n_error, 'warning': n_warning,
                    'suggestion': n_suggestion, 'liste': alertes, 'groupes': groupes},
    }

    code_sortie = CODE_ALERTE_ERROR if n_error > 0 else CODE_OK

    sortie_rapport = args['rapport'] or os.path.join(dossier, nom + '-rapport.json')
    progres('écriture du rapport -> %s' % sortie_rapport)
    with open(sortie_rapport, 'w', encoding='utf-8') as f:
        json.dump(rapport, f, ensure_ascii=False, indent=2)

    duree_ms = (time.perf_counter() - debut) * 1000
    progres('terminé en %.0f ms (code de sortie %d)' % (duree_ms, code_sortie))

    _ligne_stdout({'entree': entree, 'produit': args['produit'], 'gabarit': gabarit,
                   'sortie_docx': sortie_docx, 'sortie_rapport': sortie_rapport,
                   'typographie': statut_typo,
                   'alertes_total': len(alertes), 'alertes_error': n_error,
                   'alertes_warning': n_warning, 'alertes_suggestion': n_suggestion,
                   'duree_ms': round(duree_ms, 1), 'code_sortie': code_sortie})
    return code_sortie


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
