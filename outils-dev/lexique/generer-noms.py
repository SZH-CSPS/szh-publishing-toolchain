#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Construit pipeline/lexique/noms-famille.txt, base de noms de famille publique que
# manuscrit_noms.BaseNoms lit en plus de la base OJS du poste (absente en développement et
# sur la CI). Voir docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
# Source : les bibliographies des galleys publiées du corpus local (--corpus, tmp/docx-dev
# par défaut, hors dépôt). Une entrée APA commence par « Nom, P. » : la forme garantit que
# c'est un nom de famille.
#
# --base-auteurs (C:\ProgramData\SZH\auteurs.json) sert seulement au filtrage : un nom connu
# de la base OJS échappe au seuil de bruit (« Wu », vu une fois et court, est gardé). Rien de
# cette base n'est écrit dans le fichier produit, qui va dans un dépôt public.
#
# Bibliothèque standard seule. Le .docx se lit par zipfile + xml.etree ; le repérage de la
# bibliographie vient de pipeline/docx-meta.py (Classeur, pstyle, texte_paragraphe,
# etendue_biblio, detecter_type, PARTICULES…).
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
    """Charge un module de pipeline/ par son chemin : un nom à tiret (docx-meta.py) ne
    s'importe pas."""
    chemin = os.path.join(RACINE, 'pipeline', nom_fichier)
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dm = _charger_module_a_tiret('docx-meta.py', 'szh_docx_meta_pour_lexique_noms')


# ---------------------------------------------------------------------------------
# Pliage, identique à manuscrit_noms._plier() : NFD, minuscules, diacritiques retirés,
# ponctuation retirée aux bords seulement (le tiret de « Anne-Françoise » reste).
PONCTUATION_BORD = string.punctuation + '«»‘’“”…‑–—'


def plier(jeton):
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip(PONCTUATION_BORD)


def valide(jeton):
    """Au moins 2 lettres, sans chiffre ni arobase. `isalpha()` rejetterait
    « anne-francoise » ; `\\w` laisserait passer les chiffres."""
    if not jeton or '@' in jeton or any(c.isdigit() for c in jeton):
        return False
    return sum(1 for c in jeton if c.isalpha()) >= 2


# ---------------------------------------------------------------------------------
# Noms de famille tirés des bibliographies du corpus.

# Un auteur APA s'écrit « Nom, P. » ou « Nom Composé, P.-P. » : au plus trois mots
# capitalisés (« Hagmann-von Arx », « Wood de Wilde »), précédés au plus d'une particule
# (dm.PARTICULES), puis une virgule et une ou plusieurs initiales (« M. », « J.-P. »).
_PARTICULE_RE = '(?:' + '|'.join(sorted(re.escape(p) for p in dm.PARTICULES)) + ')'
_MOT_NOM = r"[A-ZÀ-ÖØ-Þ][\wÀ-ÖØ-öø-ÿ'’-]*"
_SURNOM = _PARTICULE_RE + r'\s+' + _MOT_NOM + r'(?:\s+' + _MOT_NOM + r'){0,2}' + \
    r'|' + _MOT_NOM + r'(?:\s+' + _MOT_NOM + r'){0,2}'
RE_AUTEUR_APA = re.compile(
    r'(?:' + _SURNOM + r'),\s*[A-ZÀ-ÖØ-Þ]\.(?:[\s-]?[A-ZÀ-ÖØ-Þ]\.)*')

# L'année (« (2020). », « (2020, 28. Juli): ») clôt la liste des auteurs : la recherche de
# noms s'arrête là. Au-delà, un « In A. Untel (Ed.), » écrit l'éditeur dans l'autre sens.
# Sans année (« s.d. »), on lit les 180 premiers signes.
RE_ANNEE_REFERENCE = re.compile(r'\((?:19|20)\d{2}[a-z]?[,)]')
SEGMENT_AUTEURS_MAX = 180

# Garde-fou : un auteur institutionnel s'écrit « SIGLE (2020). », sans virgule ni initiale,
# et ne passe donc pas le motif ci-dessus. Cette courte liste couvre une forme inattendue
# dans un corpus plus large.
MOTS_OUTILS_INSTITUTION = {
    'et', 'und', 'and', 'sowie', 'in', 'im', 'ed', 'eds', 'hrsg', 'hg', 'coll',
    'vol', 'dir', 'trad', 'szh', 'csps', 'edk', 'bfs', 'hfh', 'oecd', 'unesco',
    'who', 'oms', 'isb', 'msb', 'bkd', 'bks', 'bass', 'skbf', 'artiset', 'nrw',
}

# Seuil de bruit : un jeton vu dans une seule référence et de moins de 4 lettres est écarté
# ('ha', 'hu', 'mao'…). Sur 1301 jetons, 4 lettres en écarte 20 ; 5 lettres en écarterait
# 118, dont de vrais noms.
SEUIL_LONGUEUR_BRUIT = 4


def _blocs_du_corps(racine):
    """[w:p | w:tbl] de premier niveau, comme pronto_docx.blocs_du_corps()."""
    body = racine.find(dm.W + 'body')
    if body is None:
        return []
    return [e for e in body if e.tag in (dm.W + 'p', dm.W + 'tbl')]


def _segment_auteurs(texte):
    m = RE_ANNEE_REFERENCE.search(texte)
    return texte[:m.start()] if m else texte[:SEGMENT_AUTEURS_MAX]


def _jeton_stockage(surnom):
    """Le jeton que `BaseNoms.poids_nom()` cherche : le dernier mot non-particule du nom
    (« Sermier Dessemontet » -> « dessemontet »)."""
    mots = surnom.split()
    particules_pliees = {plier(p) for p in dm.PARTICULES}
    while len(mots) > 1 and plier(mots[0]) in particules_pliees:
        mots.pop(0)
    return plier(mots[-1]) if mots else ''


def _noms_de_reference(texte):
    """Les jetons distincts d'une référence (un ensemble : le seuil de bruit compte par
    référence)."""
    trouves = set()
    for m in RE_AUTEUR_APA.finditer(_segment_auteurs(texte)):
        surnom = m.group(0).split(',')[0].strip()
        j = _jeton_stockage(surnom)
        if j and j not in MOTS_OUTILS_INSTITUTION:
            trouves.add(j)
    return trouves


def moissonner_noms_famille(dossier_corpus, emettre):
    """(Counter jeton -> nombre de références qui le portent, stats) sur tout le corpus. Un
    fichier illisible est compté, signalé et sauté."""
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
            # Une documentation n'a pas de bibliographie séparée : sa liste est son contenu,
            # qu'on ne lit pas comme des références.
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
        # etendue_biblio() ne rend que des clés de comparaison tronquées : on ne lui prend
        # que ses statistiques. Le texte vient des paragraphes de style bibliographie
        # (Classeur.famille(pstyle(e)) == 'biblio'), sans les paragraphes non stylés
        # qu'etendue_biblio() ajoute entre deux paragraphes stylés.
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
    """Écarte les jetons invalides, les mots d'institution et le bruit (une seule référence
    et court). Un jeton de `jetons_connus_ojs` échappe au seul critère de bruit."""
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
# La base OJS du poste, pour le filtrage seulement. On y lit le `nom` des fiches propres ;
# le `prenom` sert à décider si une fiche est propre. Ni e-mail ni affiliation.

# Une fiche est écartée entière si son nom ou son prénom contient un chiffre, une arobase,
# une barre oblique, ou vaut un des mots d'institution ci-dessous (fiches « SZH/CSPS »,
# « Edition »).
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
    """[nom, ...] : le `nom` de chaque fiche propre de la base OJS (nom et prénom non vides,
    aucun des deux bruité), ou [] avec un message si le fichier est absent ou illisible.
    Sert seulement à filtrer_noms_famille()."""
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
    """_jeton_stockage() appliqué au `nom` d'une fiche OJS, pour filtrer_noms_famille()."""
    return _jeton_stockage(nom)


# ---------------------------------------------------------------------------------
# Écriture : en-tête commenté, un jeton par ligne, triés, sans doublon, fins de ligne LF
# (même corpus, mêmes octets).

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
# Ligne de commande.

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
