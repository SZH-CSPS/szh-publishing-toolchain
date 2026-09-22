#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# generer-noms.py — construit pipeline/lexique/noms-famille.txt : la base lexicale PUBLIQUE
# que manuscrit_noms.BaseNoms (lot A) lit en renfort de la base OJS du poste (absente sur un
# poste de développement sans C:\ProgramData\SZH, et TOUJOURS absente sur les runners CI —
# contrat, §3.2 et §2 bis). Contrat du lot : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §5.
#
# UNE seule source écrite sur disque (§5.1 du contrat — confidentialité : ce dépôt est destiné
# à devenir public) : noms-famille.txt <- les bibliographies des galleys PUBLIÉES du corpus
# local (--corpus, tmp/docx-dev par défaut — HORS DÉPÔT, tmp/ est dans .gitignore). Une entrée
# APA commence par « Nom, P. » / « Nom, P., & Autre, Q. » : le nom de famille y est CERTIFIÉ
# par la forme elle-même, jamais deviné.
#
# ⚠ Décision de Robin, 22.09.2026 : prenoms.txt (le champ `prenom` de la base OJS du poste,
# --base-auteurs) N'EST PLUS PRODUIT — retiré de pipeline/lexique/. Motif : ce fichier n'était
# que la COPIE d'une donnée déjà présente et à jour sur le poste
# (C:\ProgramData\SZH\auteurs.json, lui-même dérivé de la base d'auteurs OJS de la maison) ;
# il ne servait que de REPLI pour manuscrit_noms.BaseNoms quand cette base est absente — repli
# devenu inutile puisque le moissonnage de la base OJS est désormais déclenché au lancement de
# l'application (voir le rapport de livraison de ce lot). Un dépôt destiné à devenir public n'a
# pas à porter la copie d'une donnée maison qui n'apporte rien de plus que l'original.
#
# --base-auteurs SUBSISTE malgré tout, pour un usage bien plus étroit qu'avant : le filtrage de
# noms-famille.txt (§5.2, règle 4 — « ne jamais écarter un jeton présent dans la base OJS »)
# a besoin de savoir quels jetons de NOM la base connaît, pour immuniser contre le seuil de
# bruit (règle 3) un nom de famille rare mais réel (« Wu », vu une seule fois dans le corpus
# ET court, mais présent comme nom dans auteurs.json -> gardé). Le champ `prenom` d'une fiche
# n'est plus LU pour lui-même ; il ne sert plus qu'à la définition d'une fiche « propre »
# (charger_noms_ojs_propres() ci-dessous — INCHANGÉE : nom ET prénom non vides, comme avant
# cette suppression, pour ne pas élargir au passage le périmètre de l'immunité en même temps
# qu'on retire prenoms.txt — un élargissement séparé, à décider et mesurer à part, jamais un
# effet de bord de cette suppression).
#
# stdlib seule. Patron repris de deux scripts voisins :
#   - outils-dev/lexique/generer-lexique.py : CLI à tiret, arguments analysés à la main
#     (pas d'argparse dans CE script précis — cohérence avec le reste du dossier lexique/,
#     qui n'en a pas besoin : cinq options, aucune validation croisée).
#   - outils-dev/lexique/moissonner-ojs.py : commentaires denses, chaque seuil chiffré
#     justifié par une mesure DATÉE, jamais par intuition.
# Lecture du .docx en stdlib (zipfile + xml.etree), patron de pipeline/pronto_docx.py — pas
# de lecteur complet réécrit, seul le texte des paragraphes est nécessaire ici. Le repérage
# de la bibliographie réutilise pipeline/docx-meta.py (chargé par chemin, comme le fait déjà
# pipeline/manuscrit_entete.py pour ce même fichier — son nom porte un tiret, `import
# docx-meta` est syntaxiquement impossible) : Classeur, pstyle, texte_paragraphe,
# normaliser, ressemble_a_une_reference, etendue_biblio, detecter_type, PARTICULES — rien de
# tout cela n'est ré-écrit ici.
#
#   python3 generer-noms.py --corpus tmp/docx-dev --base-auteurs C:\ProgramData\SZH\auteurs.json --sortie pipeline/lexique
#   python3 generer-noms.py --corpus tmp/docx-dev --statistiques   (n'écrit rien)

import glob
import importlib.util
import json
import os
import re
import string
import sys
import unicodedata
import zipfile
from collections import Counter
from datetime import date

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CORPUS_DEFAUT = os.path.join(RACINE, 'tmp', 'docx-dev')
SORTIE_DEFAUT = os.path.join(RACINE, 'pipeline', 'lexique')


def _charger_module_a_tiret(nom_fichier, nom_module):
    """docx-meta.py porte un tiret : pas un module importable par son nom (convention du
    dépôt, §3 du contrat). Chargé par chemin, exactement comme manuscrit_entete.py et
    manuscrit_biblio.py le font déjà pour ce même fichier."""
    chemin = os.path.join(RACINE, 'pipeline', nom_fichier)
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dm = _charger_module_a_tiret('docx-meta.py', 'szh_docx_meta_pour_lexique_noms')


# ---------------------------------------------------------------------------------
# Pliage d'un jeton — DOIT rester identique à celui que manuscrit_noms.BaseNoms appliquera
# aux jetons qu'elle lit dans ces fichiers (contrat, §3.2) : NFD, minuscules, combinants
# retirés, ponctuation de bord seule retirée (jamais un tiret interne, qui porte le sens
# dans « Anne-Françoise » ou « Sermier-Dessemontet »). Dupliqué ici (ce script ne peut pas
# importer manuscrit_noms.py, qui n'existe pas encore au moment où ce lot tourne — lot A,
# en parallèle) : la duplication est le pliage lui-même, six lignes, décrit noir sur blanc
# au §3.2 du contrat, pas une improvisation.
PONCTUATION_BORD = string.punctuation + '«»‘’“”…‑–—'


def plier(jeton):
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip(PONCTUATION_BORD)


def valide(jeton):
    """Règle commune aux deux fichiers (§5.2, règle 1) : au moins 2 lettres, sans chiffre,
    sans arobase. `isalpha()` est trop strict (rejette Anne-Françoise, Sermier-Dessemontet,
    Wood de Wilde une fois réduit) : on compte les lettres réelles (Unicode) et on refuse
    séparément chiffre et arobase, jamais un `\\w` qui les laisserait passer."""
    if not jeton or '@' in jeton or any(c.isdigit() for c in jeton):
        return False
    return sum(1 for c in jeton if c.isalpha()) >= 2


# ---------------------------------------------------------------------------------
# Source 1 — noms de famille depuis les bibliographies du corpus (§5.1, source 1).

# Un auteur ou une autrice APA s'écrit « Nom, P. » ou « Nom Compose, P.-P. » : au plus trois
# mots capitalisés (mesuré sur le corpus tmp/docx-dev, 22.09.2026 — « Sahli Lozano »,
# « Hagmann-von Arx », « Wood de Wilde » couvrent le cas le plus long observé, jamais 4),
# précédé le cas échéant d'UNE particule (dm.PARTICULES), suivi d'une virgule puis d'une ou
# plusieurs initiales (« M. », « J.-P. », « M. A. »).
_PARTICULE_RE = '(?:' + '|'.join(sorted(re.escape(p) for p in dm.PARTICULES)) + ')'
_MOT_NOM = r"[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'’-]*"
_SURNOM = _PARTICULE_RE + r'\s+' + _MOT_NOM + r'(?:\s+' + _MOT_NOM + r'){0,2}' + \
    r'|' + _MOT_NOM + r'(?:\s+' + _MOT_NOM + r'){0,2}'
RE_AUTEUR_APA = re.compile(
    r'(?:' + _SURNOM + r'),\s*[A-ZÀ-ÖØ-Þ]\.(?:[\s-]?[A-ZÀ-ÖØ-Þ]\.)*')

# Année de publication : marque la fin de la liste d'autrices/auteurs dans une référence
# APA (« (2020). » ou « (2020, 28. Juli): »), jamais franchie par la recherche de noms — au-
# delà commencent le titre, l'éditeur, les pages, un « In A. Untel (Ed.), » dont le nom de
# l'éditeur est écrit dans l'AUTRE sens (Prénom Nom) et ne doit jamais être confondu avec un
# auteur. Repli à 180 signes si aucune parenthèse d'année n'est trouvée (référence sans
# année identifiable, "s.d."/"n.d.") : large pour une liste de 3-4 auteurs, borné pour ne
# jamais dériver dans le corps d'une longue référence.
RE_ANNEE_REFERENCE = re.compile(r'\((?:19|20)\d{2}[a-z]?[,)]')
SEGMENT_AUTEURS_MAX = 180

# Défense en profondeur (§5.2, règle 2) : sur le corpus mesuré (tmp/docx-dev, 77 fichiers,
# 22.09.2026), AUCUN auteur institutionnel (ISB, MSB NRW, BFS, EDK, HfH, UNESCO, OECD,
# SKBF, BASS, BKS, ARTISET, Robert Bosch Stiftung…) n'a jamais franchi le filtre ci-dessus :
# une référence institutionnelle s'écrit « SIGLE (2020). » ou « Nom complet (2020). »,
# jamais « SIGLE, X. (2020) » — la virgule + initiale ne matche pas. Cette liste ne sert
# donc à rien sur CE corpus ; elle reste en gardienne fermée et courte pour un corpus futur
# plus large (toutes les galleys, pas seulement les 77 de ce poste) qui pourrait un jour
# produire une forme qu'on n'a pas encore vue — jamais pour rejeter un nom de famille réel.
MOTS_OUTILS_INSTITUTION = {
    'et', 'und', 'and', 'sowie', 'in', 'im', 'ed', 'eds', 'hrsg', 'hg', 'coll',
    'vol', 'dir', 'trad', 'szh', 'csps', 'edk', 'bfs', 'hfh', 'oecd', 'unesco',
    'who', 'oms', 'isb', 'msb', 'bkd', 'bks', 'bass', 'skbf', 'artiset', 'nrw',
}

# Seuil de bruit (§5.2, règle 3) : un jeton vu dans UNE SEULE référence de tout le corpus
# ET de moins de 4 lettres. Mesuré sur tmp/docx-dev (77 fichiers, 22.09.2026, jeton de
# STOCKAGE = dernier mot non-particule d'un nom capté, compté par RÉFÉRENCE distincte, pas
# par occurrence) : 1301 jetons distincts au total : le seuil à 4 lettres en écarte 20
# ('ha', 'hu', 'wu', 'yu', 'mao', 'rao'…, très probablement des fragments d'OCR ou de
# translittération tronquée) ; le même calcul à 5 lettres en écarterait 118 — un saut de
# 20 à 118 pour une seule lettre de plus est le signe que 4 est le seuil qui sépare le bruit
# du signal ici, pas un chiffre choisi à l'intuition.
SEUIL_LONGUEUR_BRUIT = 4


def _blocs_du_corps(racine):
    """[w:p | w:tbl] de premier niveau — patron de pronto_docx.blocs_du_corps() (même
    fichier justifié en tête : lecture stdlib, aucun lecteur complet réécrit)."""
    body = racine.find(dm.W + 'body')
    if body is None:
        return []
    return [e for e in body if e.tag in (dm.W + 'p', dm.W + 'tbl')]


def _segment_auteurs(texte):
    m = RE_ANNEE_REFERENCE.search(texte)
    return texte[:m.start()] if m else texte[:SEGMENT_AUTEURS_MAX]


def _jeton_stockage(surnom):
    """Le jeton qui sera effectivement testé par `BaseNoms.poids_nom()` : le DERNIER mot
    non-particule d'un nom composé (§3.2 du contrat — « Sermier Dessemontet », « de
    Chambrier » se testent sur leur dernier jeton non-particule). Stocker la phrase entière
    stockerait un jeton (« sermier dessemontet ») que personne n'interroge jamais : le seul
    jeton qu'un appelant construit, c'est celui-ci."""
    mots = surnom.split()
    particules_pliees = {plier(p) for p in dm.PARTICULES}
    while len(mots) > 1 and plier(mots[0]) in particules_pliees:
        mots.pop(0)
    return plier(mots[-1]) if mots else ''


def _noms_de_reference(texte):
    """{jeton de stockage} distincts trouvés dans UNE référence — un set, pas une liste :
    une référence qui citerait deux fois le même nom (rare, jamais vu) ne doit compter que
    pour UNE occurrence dans le comptage par référence du seuil de bruit ci-dessus."""
    trouves = set()
    for m in RE_AUTEUR_APA.finditer(_segment_auteurs(texte)):
        surnom = m.group(0).split(',')[0].strip()
        j = _jeton_stockage(surnom)
        if j and j not in MOTS_OUTILS_INSTITUTION:
            trouves.add(j)
    return trouves


def moissonner_noms_famille(dossier_corpus, emettre):
    """(Counter jeton->nb de références distinctes qui le portent, stats) sur tout le
    corpus. N'échoue jamais sur UN fichier illisible (zip corrompu, document.xml absent) :
    le compte, avertit, continue — un lot de 77 fichiers ne doit pas s'arrêter sur le
    premier accroc (même prudence que docx-meta.principal())."""
    compte = Counter()
    stats = {'fichiers': 0, 'illisibles': 0, 'documentation_ecartes': 0,
             'avec_biblio_stylee': 0, 'paragraphes_biblio': 0, 'references_reconnues': 0,
             'references_sans_nom_extrait': 0}
    chemins = sorted(glob.glob(os.path.join(dossier_corpus, '**', '*.docx'), recursive=True))
    for chemin in chemins:
        stats['fichiers'] += 1
        nom_fichier = os.path.basename(chemin)
        type_article, _ = dm.detecter_type(nom_fichier, '', '')
        if type_article == 'documentation':
            # etendue_biblio() traite lui-même ce cas : une documentation N'A PAS de
            # bibliographie détachable, sa liste EST son contenu (commentaire de
            # docx-meta.etendue_biblio()) — la sauter ici évite de moissonner cent
            # cinquante paragraphes de texte comme s'ils étaient des références.
            stats['documentation_ecartes'] += 1
            continue
        try:
            with zipfile.ZipFile(chemin) as z:
                racine = dm.ET.fromstring(z.read('word/document.xml'))
                styles = dm.charger_styles(z)
        except Exception as e:
            stats['illisibles'] += 1
            emettre('  illisible : %s (%s)' % (nom_fichier, e))
            continue
        classeur = dm.Classeur(styles)
        blocs = _blocs_du_corps(racine)
        # etendue_biblio() ne rend que des CLÉS DE COMPARAISON tronquées (cle_comparaison,
        # pour l'appariement pandoc) — jamais le texte brut, inutilisable ici pour lire un
        # nom. On l'appelle malgré tout pour ses STATS (voie, nombre de paragraphes stylés,
        # titre reconnu ou non — §5.1 : « lire_titres_bib(), ressemble_a_une_reference(),
        # etendue_biblio() existent déjà, sers-t'en ») ; le TEXTE des paragraphes de
        # bibliographie, lui, vient du même critère qu'elle utilise en interne pour les
        # repérer (Classeur.famille(pstyle(e)) == 'biblio') — un sous-ensemble STRICT de
        # l'étendue qu'elle borne (elle élargit ensuite aux paragraphes non stylés compris
        # entre deux paragraphes stylés) : plus prudent, jamais plus large.
        _, _, stats_biblio = dm.etendue_biblio(blocs, classeur, type_article)
        if stats_biblio['voie'] == 'style':
            stats['avec_biblio_stylee'] += 1
        paragraphes_biblio = [
            dm.normaliser(dm.texte_paragraphe(e)) for e in blocs
            if e.tag == dm.W + 'p' and classeur.famille(dm.pstyle(e)) == 'biblio'
        ]
        paragraphes_biblio = [t for t in paragraphes_biblio if t]
        stats['paragraphes_biblio'] += len(paragraphes_biblio)
        for texte in paragraphes_biblio:
            if not dm.ressemble_a_une_reference(texte):
                continue
            stats['references_reconnues'] += 1
            noms = _noms_de_reference(texte)
            if not noms:
                stats['references_sans_nom_extrait'] += 1
                continue
            for j in noms:
                compte[j] += 1
    return compte, stats


def filtrer_noms_famille(compte, jetons_connus_ojs):
    """Applique les règles 1-3 du §5.2. Règle 4 (« ne jamais écarter un jeton présent dans
    la base OJS ») : `jetons_connus_ojs` (les jetons de NOM — dernier mot non-particule —
    des fiches propres de la base OJS, JAMAIS écrits dans un fichier, juste consultés ici
    pour lever le filtre de bruit) rend un jeton immunisé contre la seule règle 3 (occurrence
    unique + court) ; les règles 1 (validité) et 2 (mots-outils) restent absolues — un jeton
    invalide (chiffre, arobase) resterait invalide même connu de la base OJS."""
    retenus = set()
    for jeton, n_refs in compte.items():
        if not valide(jeton):
            continue
        if jeton in MOTS_OUTILS_INSTITUTION:
            continue
        if n_refs == 1 and len(jeton) < SEUIL_LONGUEUR_BRUIT and jeton not in jetons_connus_ojs:
            continue
        retenus.add(jeton)
    return retenus


# ---------------------------------------------------------------------------------
# La base OJS du poste (§5.1, source 2 jusqu'au 22.09.2026 ; ne sert plus qu'au FILTRAGE de
# noms-famille.txt depuis cette date — voir l'en-tête). On y lit encore le `nom` de chaque
# fiche propre, jamais l'e-mail, jamais l'affiliation ; le `prenom` n'est plus lu QUE pour
# décider si une fiche compte comme propre (voir charger_noms_ojs_propres() plus bas).

# Une fiche est écartée ENTIÈREMENT (nom ET prénom, même si un seul des deux champs est en
# cause — §3.2 du contrat : « écarter la fiche entière, ne rien deviner ») si l'un de ses
# deux champs contient un chiffre, une arobase, une barre oblique, ou vaut exactement un mot
# de la liste d'institutions ci-dessous. Mesuré sur C:\ProgramData\SZH\auteurs.json le
# 22.09.2026 (1157 fiches) : 4 fiches écartées par cette règle (toutes liées à
# « SZH/CSPS » / « Edition » portés dans le champ nom OU prénom — la fiche générique de
# l'institution elle-même, entrée plusieurs fois avec des champs inversés), 1153 fiches
# propres restantes.
MOTS_INSTITUTION_AUTEURS = {
    'szh', 'csps', 'szh-csps', 'szh/csps', 'edition', 'edition szh/csps',
    'zeitschrift', 'revue', 'redaction', 'rédaction', 'redaktion',
    'secretariat', 'secrétariat', 'sekretariat',
}


def _champ_bruite(valeur):
    v = (valeur or '').strip()
    if not v:
        return False
    if any(c.isdigit() for c in v) or '@' in v or '/' in v:
        return True
    return v.lower() in MOTS_INSTITUTION_AUTEURS


def charger_noms_ojs_propres(chemin_base_auteurs, emettre):
    """[nom, ...] — le champ `nom` de chaque fiche PROPRE de la base OJS, ou [] si le fichier
    est absent ou illisible — silencieux (cette base est un à-côté, pas une dépendance dure :
    ce script écrit ce qu'il peut, jamais une erreur bloquante pour un fichier facultatif).
    N'alimente plus AUCUN fichier écrit sur disque depuis le 22.09.2026 (prenoms.txt retiré,
    voir l'en-tête) : sert uniquement à construire l'ensemble d'immunité de la règle 4
    (filtrer_noms_famille() plus bas). Une fiche compte comme propre si nom ET prénom sont
    non vides ET aucun des deux n'est bruité (_champ_bruite ci-dessus) — l'exigence du prénom
    est CONSERVÉE telle quelle bien qu'il ne soit plus lu nulle part ailleurs : c'est la même
    définition de fiche « propre » qu'avant la suppression de prenoms.txt, pour ne pas élargir
    au passage le périmètre de l'immunité — un élargissement séparé, à décider et mesurer à
    part, jamais un effet de bord de cette suppression."""
    if not chemin_base_auteurs or not os.path.isfile(chemin_base_auteurs):
        emettre('base OJS introuvable : %s (aucune immunité de la règle 4 pour ce lot)'
                % chemin_base_auteurs)
        return []
    try:
        with open(chemin_base_auteurs, encoding='utf-8') as f:
            donnees = json.load(f)
    except Exception as e:
        emettre('base OJS illisible : %s (%s)' % (chemin_base_auteurs, e))
        return []
    brutes = donnees.get('auteurs') or []
    propres = []
    for a in brutes:
        if _champ_bruite(a.get('nom')) or _champ_bruite(a.get('prenom')):
            continue
        prenom, nom = (a.get('prenom') or '').strip(), (a.get('nom') or '').strip()
        if prenom and nom:
            propres.append(nom)
    emettre('base OJS : %d fiche(s) au total, %d propre(s) retenue(s) (immunité de la règle 4 '
            'seulement — voir l\'en-tête)' % (len(brutes), len(propres)))
    return propres


def dernier_jeton_nom(nom):
    """Même règle que _jeton_stockage() ci-dessus, appliquée au champ `nom` d'une fiche OJS
    plutôt qu'à une référence bibliographique — utilisée UNIQUEMENT pour construire
    l'ensemble d'immunité de filtrer_noms_famille() (règle 4), jamais écrite dans un
    fichier : le champ `nom` d'auteurs.json n'alimente jamais noms-famille.txt (§5.1)."""
    return _jeton_stockage(nom)


# ---------------------------------------------------------------------------------
# Écriture — en-tête commenté, un jeton par ligne, triés, jamais de doublon, fin de ligne LF
# (idempotent : même corpus, mêmes octets).

def _ecrire_lexique(chemin, jetons, commentaires):
    lignes = ['# ' + c + '\n' for c in commentaires]
    lignes.append('# Fabriqué par outils-dev/lexique/generer-noms.py — ne pas éditer à la main.\n')
    for j in sorted(jetons):
        lignes.append(j + '\n')
    with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
        f.writelines(lignes)


def ecrire_noms_famille(dossier_sortie, jetons, n_fichiers_corpus, n_avec_biblio):
    chemin = os.path.join(dossier_sortie, 'noms-famille.txt')
    _ecrire_lexique(chemin, jetons, [
        'noms-famille.txt — noms de famille pliés, un par ligne, triés.',
        'Source : bibliographies de %d article(s) publié(s) (Revue + Zeitschrift), '
        'corpus de %d fichier(s) dont %d avec une bibliographie stylée, %s.'
        % (n_avec_biblio, n_fichiers_corpus, n_avec_biblio, date.today().isoformat()),
    ])
    return chemin


# ---------------------------------------------------------------------------------
# CLI — à tiret, arguments analysés à la main (patron de generer-lexique.py).

USAGE = (
    'usage : generer-noms.py --corpus <dossier> [--base-auteurs <fichier>] '
    '--sortie <dossier>\n'
    '        generer-noms.py --corpus <dossier> [--base-auteurs <fichier>] --statistiques\n'
)


def _analyser_args(argv):
    args = {'corpus': CORPUS_DEFAUT, 'base_auteurs': None, 'sortie': SORTIE_DEFAUT,
            'statistiques': False}
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == '--corpus' and i + 1 < len(argv):
            args['corpus'] = argv[i + 1]; i += 2
        elif a == '--base-auteurs' and i + 1 < len(argv):
            args['base_auteurs'] = argv[i + 1]; i += 2
        elif a == '--sortie' and i + 1 < len(argv):
            args['sortie'] = argv[i + 1]; i += 2
        elif a == '--statistiques':
            args['statistiques'] = True; i += 1
        elif a in ('-h', '--help'):
            print(USAGE); sys.exit(0)
        else:
            print('argument inconnu : ' + a, file=sys.stderr)
            print(USAGE, file=sys.stderr)
            sys.exit(2)
    return args


def principal(argv):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    args = _analyser_args(argv)

    def emettre(msg):
        print(msg, flush=True)

    if not os.path.isdir(args['corpus']):
        emettre('corpus introuvable : %s — noms-famille.txt ne sera pas produit '
                 '(source hors dépôt, tmp/ — voir §5.1 du contrat)' % args['corpus'])
        compte, stats = Counter(), {
            'fichiers': 0, 'illisibles': 0, 'documentation_ecartes': 0,
            'avec_biblio_stylee': 0, 'paragraphes_biblio': 0, 'references_reconnues': 0,
            'references_sans_nom_extrait': 0}
    else:
        emettre('moisson des bibliographies : ' + args['corpus'])
        compte, stats = moissonner_noms_famille(args['corpus'], emettre)

    noms_ojs_propres = charger_noms_ojs_propres(args['base_auteurs'], emettre)
    jetons_noms_ojs = {dernier_jeton_nom(nom) for nom in noms_ojs_propres}
    noms_famille = filtrer_noms_famille(compte, jetons_noms_ojs)

    emettre('--- statistiques ---')
    emettre('fichiers du corpus       : %d (illisibles : %d, documentation écartée : %d)'
            % (stats['fichiers'], stats['illisibles'], stats['documentation_ecartes']))
    emettre('fichiers avec biblio stylée : %d' % stats['avec_biblio_stylee'])
    emettre('paragraphes de biblio lus  : %d' % stats['paragraphes_biblio'])
    emettre('références reconnues       : %d (sans nom extrait : %d — auteurs '
            'institutionnels, sans forme "Nom, P.")'
            % (stats['references_reconnues'], stats['references_sans_nom_extrait']))
    emettre('jetons de nom distincts (bruts)    : %d' % len(compte))
    emettre('jetons de nom retenus (filtrés)    : %d' % len(noms_famille))
    emettre('fiches OJS propres (immunité règle 4 seulement) : %d' % len(noms_ojs_propres))

    if args['statistiques']:
        return 0

    os.makedirs(args['sortie'], exist_ok=True)
    chemin_noms = ecrire_noms_famille(args['sortie'], noms_famille, stats['fichiers'],
                                       stats['avec_biblio_stylee'])
    emettre('écrit : ' + chemin_noms)
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
