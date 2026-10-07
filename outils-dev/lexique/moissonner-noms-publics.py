#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Construit les deux index de fréquence publics du lexique :
#   pipeline/lexique/noms-frequents.txt     (noms de famille)
#   pipeline/lexique/prenoms-frequents.txt  (prénoms)
# que manuscrit_noms.BaseNoms lit en plus de la base OJS du poste. Voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
# noms-famille.txt (noms tirés des bibliographies du corpus, par generer-noms.py) reste un
# fichier séparé : chaque fichier porte sa source et sa licence en en-tête.
#
# Pourquoi deux index et un filtre. manuscrit_noms._signal_lexique() compare deux hypothèses :
#   score_direct  = (tête connue comme prénom) + (queue connue comme nom)
#   score_inverse = (tête connue comme nom)    + (queue connue comme prénom)
# Un jeton connu des deux côtés annule le signal ; un prénom rangé parmi les noms (« thomas »)
# le retourne (« Thomas Aebischer » lu à l'envers). Les sources de l'OFS donnent, pour un même
# jeton, son poids comme nom et comme prénom sur la même population : le filtre de
# discrimination (discriminer()) range chaque jeton du côté qui domine, ou l'écarte, selon
# --rapport. Les jetons concernés sont peu nombreux (environ 5 % des noms) mais très portés
# (martin, peter, michel, walter, simon…). Le réglage se mesure avec banc-noms.py.
#
# Sources, toutes publiques ; aucune ne vient de C:\ProgramData\SZH\auteurs.json :
#   OFS          obligation d'indiquer la source (opendata.swiss « terms_by ») ;
#   INSEE/Etalab Licence Ouverte 2.0, mention de la paternité.
# Les citations sont écrites dans l'en-tête de chaque fichier produit, qui voyage seul.
#
# Les CSV téléchargés (38 Mo) restent dans tmp/ ; seuls les deux fichiers produits sont
# versionnés. Bibliothèque standard seule.
#
#   python3 moissonner-noms-publics.py --telecharger          (remplit le cache tmp/, réseau)
#   python3 moissonner-noms-publics.py --statistiques         (n'écrit aucun fichier)
#   python3 moissonner-noms-publics.py --palier-noms 30000 --palier-prenoms 8000
#   python3 moissonner-noms-publics.py --sortie tmp/essai --palier-noms 15000 --rapport 2

import csv
import os
import string
import sys
import unicodedata
import urllib.request
from collections import Counter
from datetime import date

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
CACHE_DEFAUT = os.path.join(RACINE, 'tmp', 'lexique-sources')
SORTIE_DEFAUT = os.path.join(RACINE, 'pipeline', 'lexique')

# Le serveur de l'OFS (dam-api.bfs.admin.ch) répond 403 à une requête sans User-Agent.
ENTETES = {'User-Agent': 'Mozilla/5.0 (compatible; szh-publishing-toolchain; +https://szh.ch)',
           'Accept': 'text/csv, */*'}


# ---------------------------------------------------------------------------------
# Les sources. `citation` est recopiée dans l'en-tête du fichier produit (obligation de
# licence).

SOURCES = [
    # Édition 2026 (données 2025) : 238 962 noms distincts, 8 557 230 personnes.
    {'cle': 'ofs-noms', 'cible': 'nom',
     'url': 'https://dam-api.bfs.admin.ch/hub/api/dam/assets/36752522/master',
     'fichier': 'ofs-noms-2025.csv',
     'colonne': 'LASTNAME', 'poids': 'VALUE',
     'citation': "OFS, Noms de famille de la population résidante permanente par région "
                 "linguistique, état 2025 (publié le 21.08.2026) — opendata.swiss, "
                 "utilisation libre avec obligation d'indiquer la source"},
    # L'OFS ne publie pas les noms et prénoms portés par moins de 3 personnes.
    {'cle': 'ofs-prenoms-f', 'cible': 'prenom',
     'url': 'https://dam-api.bfs.admin.ch/hub/api/dam/assets/36752506/master',
     'fichier': 'ofs-prenoms-f-2025.csv',
     'colonne': 'firstname', 'poids': 'VALUE',
     'citation': "OFS, Prénoms féminins de la population selon l'année de naissance, "
                 "Suisse, état 2025 — opendata.swiss, utilisation libre avec obligation "
                 "d'indiquer la source"},
    {'cle': 'ofs-prenoms-m', 'cible': 'prenom',
     'url': 'https://dam-api.bfs.admin.ch/hub/api/dam/assets/36752513/master',
     'fichier': 'ofs-prenoms-m-2025.csv',
     'colonne': 'firstname', 'poids': 'VALUE',
     'citation': "OFS, Prénoms masculins de la population selon l'année de naissance, "
                 "Suisse, état 2025 — opendata.swiss, utilisation libre avec obligation "
                 "d'indiquer la source"},
    # La source française apporte les noms rares : 879 421 patronymes et 209 309 prénoms,
    # extraits de la base SIRENE (registre des entreprises), sans vérification par l'éditeur.
    # SEUIL_BRUIT_INSEE écarte les matricules et saisies accidentelles (« 838930E », « AAAAAA »).
    {'cle': 'insee-noms', 'cible': 'nom',
     'url': 'https://static.data.gouv.fr/resources/liste-de-prenoms-et-patronymes/'
            '20181014-162921/patronymes.csv',
     'fichier': 'insee-patronymes.csv',
     'colonne': 'patronyme', 'poids': 'count',
     'citation': "INSEE / data.gouv.fr, Liste de prénoms et patronymes extraite de la base "
                 "SIRENE, 2018 — Licence Ouverte 2.0 (Etalab)"},
    {'cle': 'insee-prenoms', 'cible': 'prenom',
     'url': 'https://static.data.gouv.fr/resources/liste-de-prenoms-et-patronymes/'
            '20181014-162752/prenom.csv',
     'fichier': 'insee-prenoms.csv',
     'colonne': 'prenom', 'poids': 'sum',
     'citation': "INSEE / data.gouv.fr, Liste de prénoms et patronymes extraite de la base "
                 "SIRENE, 2018 — Licence Ouverte 2.0 (Etalab)"},
]

# Seuil de bruit de la source INSEE. À 50 occurrences, un échantillon de 200 jetons ne
# contient plus de bruit ; plus haut, on perdrait les patronymes rares qu'on vient chercher.
SEUIL_BRUIT_INSEE = 50

# Particules : manuscrit_noms teste le dernier jeton non-particule d'un nom (« da Silva » se
# teste sur « silva »). Copie de la liste de pipeline/docx-meta.py ; une divergence ferait au
# pire entrer une particule dans le lexique, où elle n'est jamais cherchée.
PARTICULES = {
    'de', 'du', 'des', 'da', 'das', 'di', 'del', 'della', 'dos', 'do', 'van', 'von', 'der',
    'den', 'ten', 'ter', 'le', 'la', 'el', 'al', 'bin', 'ben', 'af', 'av', 'zu', 'vom', 'zum',
    'y', "d'", 'st', 'mac', 'mc',
}


# ---------------------------------------------------------------------------------
# Pliage, identique à manuscrit_noms._plier() : NFD, minuscules, diacritiques retirés,
# ponctuation retirée aux bords seulement (le tiret de « Anne-Françoise » reste).
PONCTUATION_BORD = string.punctuation + '«»‘’“”…‑–—'


def plier(jeton):
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip(PONCTUATION_BORD)


def valide(jeton):
    """Au moins 2 lettres, aucun chiffre, aucune arobase (comme generer-noms.valide(), qui
    n'exige qu'une lettre : les sources publiques contiennent des initiales isolées).
    `isalpha()` rejetterait « anne-francoise »."""
    if not jeton or '@' in jeton or any(c.isdigit() for c in jeton):
        return False
    return sum(1 for c in jeton if c.isalpha()) >= 2


def jeton_de_nom(brut):
    """Le jeton sous lequel manuscrit_noms cherche un nom de famille : son dernier mot
    non-particule (« da Silva » -> « silva »)."""
    mots = [plier(m) for m in (brut or '').split()]
    mots = [m for m in mots if m]
    if not mots:
        return ''
    for m in reversed(mots):
        if m not in PARTICULES:
            return m
    return mots[-1]


def jeton_de_prenom(brut):
    """Le jeton sous lequel manuscrit_noms cherche un prénom : son premier mot."""
    mots = [plier(m) for m in (brut or '').split()]
    return mots[0] if mots else ''


# ---------------------------------------------------------------------------------
# Téléchargement et lecture.

def telecharger(cache, emettre):
    """Remplit le cache. Un fichier déjà présent n'est pas retéléchargé : l'effacer pour
    le reprendre."""
    os.makedirs(cache, exist_ok=True)
    for src in SOURCES:
        chemin = os.path.join(cache, src['fichier'])
        if os.path.isfile(chemin) and os.path.getsize(chemin) > 0:
            emettre('déjà en cache : %s (%d octets)' % (src['fichier'], os.path.getsize(chemin)))
            continue
        emettre('téléchargement : %s' % src['url'])
        requete = urllib.request.Request(src['url'], headers=ENTETES)
        with urllib.request.urlopen(requete, timeout=300) as reponse:
            donnees = reponse.read()
        with open(chemin, 'wb') as f:
            f.write(donnees)
        emettre('  -> %s (%d octets)' % (src['fichier'], len(donnees)))


def lire_source(src, cache, emettre):
    """(Counter {jeton plié -> poids}, nombre de lignes). Les sources de l'OFS répartissent
    une même population sur plusieurs lignes (par région, par année de naissance) : les poids
    s'additionnent par jeton, ce qui réunit aussi « Müller » et « Muller ». Source absente :
    Counter vide et un message, sans exception."""
    chemin = os.path.join(cache, src['fichier'])
    if not os.path.isfile(chemin):
        emettre('source absente : %s (lancer --telecharger)' % src['fichier'])
        return Counter(), 0
    compte = Counter()
    lignes = 0
    seuil = SEUIL_BRUIT_INSEE if src['cle'].startswith('insee') else 0
    extraire = jeton_de_nom if src['cible'] == 'nom' else jeton_de_prenom
    # utf-8-sig : les fichiers de l'OFS ont un BOM, qui sinon se collerait au nom de la
    # première colonne.
    with open(chemin, encoding='utf-8-sig', newline='') as f:
        for ligne in csv.DictReader(f):
            lignes += 1
            try:
                poids = int(ligne[src['poids']])
            except (KeyError, TypeError, ValueError):
                continue
            if poids < seuil:
                continue
            jeton = extraire(ligne.get(src['colonne']) or '')
            if jeton:
                compte[jeton] += poids
    emettre('  %-16s %7d ligne(s) -> %6d jeton(s) distinct(s)%s'
            % (src['cle'], lignes, len(compte),
               '' if not seuil else ' (seuil de bruit %d)' % seuil))
    return compte, lignes


# ---------------------------------------------------------------------------------
# Le filtre de discrimination.

def discriminer(poids_noms, poids_prenoms, rapport):
    """(noms_retenus, prenoms_retenus, ecartes) — trois Counter, chaque jeton dans au plus un
    des deux premiers.

    Un jeton entre dans les noms si son poids de nom vaut au moins `rapport` fois son poids
    de prénom, dans les prénoms dans le cas inverse, nulle part sinon (zone neutre, vide quand
    rapport vaut 1). Un jeton absent de l'autre côté (poids 0) entre toujours.

    Ranger « peter » parmi les prénoms tranche juste sur « Peter Müller » comme sur
    « Müller Peter » ; l'écarter des deux côtés rendrait le signal muet. Un `--rapport` très
    grand se rapproche de l'écart pur."""
    noms, prenoms, ecartes = Counter(), Counter(), Counter()
    for jeton, pn in poids_noms.items():
        pp = poids_prenoms.get(jeton, 0)
        if pn >= rapport * pp:
            noms[jeton] = pn
        elif pp < rapport * pn:            # ni l'un ni l'autre ne domine : zone neutre.
            ecartes[jeton] = pn
    for jeton, pp in poids_prenoms.items():
        pn = poids_noms.get(jeton, 0)
        if pp >= rapport * pn:
            prenoms[jeton] = pp
        elif pn < rapport * pp:
            ecartes[jeton] = max(ecartes.get(jeton, 0), pp)
    return noms, prenoms, ecartes


def tete(compte, palier):
    """(les `palier` jetons les plus lourds triés alphabétiquement, poids du dernier retenu).
    L'ordre alphabétique rend le diff lisible ; manuscrit_noms ne lit pas l'ordre."""
    ordonne = sorted(compte.items(), key=lambda kv: (-kv[1], kv[0]))
    if palier and palier > 0:
        ordonne = ordonne[:palier]
    seuil = ordonne[-1][1] if ordonne else 0
    return sorted(j for j, _ in ordonne), seuil


# ---------------------------------------------------------------------------------
# Écriture.

def ecrire(chemin, jetons, titre, citations, seuil, rapport, emettre):
    """Un jeton par ligne, `#` en commentaire, la forme que lit _charger_fichier_lexique().
    L'en-tête porte les citations de source exigées par les licences."""
    os.makedirs(os.path.dirname(chemin) or '.', exist_ok=True)
    with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
        f.write('# %s — jetons pliés, un par ligne, triés.\n' % os.path.basename(chemin))
        f.write('# %s\n' % titre)
        f.write('# %d jeton(s), retenus par fréquence décroissante puis triés ; le moins\n'
                '# fréquent retenu pèse %d personne(s). Filtre de discrimination prénom/nom :\n'
                '# rapport %g (un jeton n\'entre ici que si son poids de ce côté vaut au moins\n'
                '# %g fois son poids de l\'autre côté).\n' % (len(jetons), seuil, rapport, rapport))
        f.write('#\n# Sources et licences — la citation est une obligation de licence :\n')
        for c in citations:
            f.write('#   %s\n' % c)
        f.write('#\n# Aucune donnée personnelle : des jetons de noms nus, jamais un couple\n'
                '# prénom↔nom, jamais un e-mail, une affiliation ou un ORCID. Aucune dérivée\n'
                '# de la base d\'auteurs de la maison — ce fichier est moissonné sur des\n'
                '# sources publiques et sur elles seules (contrat, §5.5 quater).\n')
        f.write('# Fabriqué le %s par outils-dev/lexique/moissonner-noms-publics.py — ne pas\n'
                '# éditer à la main.\n' % date.today().isoformat())
        for j in jetons:
            f.write(j + '\n')
    emettre('écrit : %s (%d jeton(s), %d octets)'
            % (chemin, len(jetons), os.path.getsize(chemin)))


# ---------------------------------------------------------------------------------

def _usage():
    print('usage : moissonner-noms-publics.py [--telecharger] [--cache DOSSIER]')
    print('            [--sortie DOSSIER] [--palier-noms N] [--palier-prenoms N]')
    print('            [--rapport R] [--statistiques] [--exemples N]')
    return 2


def main(argv):
    cache = CACHE_DEFAUT
    sortie = SORTIE_DEFAUT
    # Palier 0 = pas de troncature, ce qui est versionné. Au banc (banc-noms.py, rapport 2),
    # chaque palier plus grand donne plus de noms justes et moins d'inversions :
    #   30 000 / 8 000    -> 94,3 % justes, 10 inversions, 25 muets, 105 Ko
    #   tout (228k/55k)   -> 96,4 % justes,  7 inversions,  7 muets, 816 Ko
    # Le coût est en taille de fichier ; le chargement passe de 19 à 133 ms, sur un
    # nettoyage de 2,3 s.
    palier_noms = 0
    palier_prenoms = 0
    rapport = 1.0
    faire_telecharger = False
    statistiques = False
    n_exemples = 0

    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--telecharger':
            faire_telecharger = True; i += 1
        elif a == '--cache' and i + 1 < len(argv):
            cache = argv[i + 1]; i += 2
        elif a == '--sortie' and i + 1 < len(argv):
            sortie = argv[i + 1]; i += 2
        elif a == '--palier-noms' and i + 1 < len(argv):
            palier_noms = int(argv[i + 1]); i += 2
        elif a == '--palier-prenoms' and i + 1 < len(argv):
            palier_prenoms = int(argv[i + 1]); i += 2
        elif a == '--rapport' and i + 1 < len(argv):
            rapport = float(argv[i + 1]); i += 2
        elif a == '--statistiques':
            statistiques = True; i += 1
        elif a == '--exemples' and i + 1 < len(argv):
            n_exemples = int(argv[i + 1]); i += 2
        elif a in ('-h', '--aide', '--help'):
            return _usage()
        else:
            print('option inconnue : %s' % a)
            return _usage()

    def emettre(msg):
        print(msg)

    if faire_telecharger:
        telecharger(cache, emettre)

    emettre('lecture des sources (cache %s) :' % cache)
    poids_noms, poids_prenoms = Counter(), Counter()
    citations_noms, citations_prenoms = [], []
    manquantes = 0
    for src in SOURCES:
        compte, lignes = lire_source(src, cache, emettre)
        if not lignes:
            manquantes += 1
            continue
        if src['cible'] == 'nom':
            poids_noms.update(compte)
            citations_noms.append(src['citation'])
        else:
            poids_prenoms.update(compte)
            citations_prenoms.append(src['citation'])

    if not poids_noms or not poids_prenoms:
        # Rien n'est écrit : un lexique vide écraserait le précédent.
        emettre('ERREUR : une des deux familles de sources est vide (%d source(s) manquante(s)). '
                'Rien n\'est écrit — lancer --telecharger.' % manquantes)
        return 1

    noms, prenoms, ecartes = discriminer(poids_noms, poids_prenoms, rapport)
    emettre('')
    emettre('discrimination (rapport %g) : %d jeton(s) de nom et %d de prénom au départ ; '
            '%d retenus côté nom, %d côté prénom, %d en zone neutre (écartés des deux).'
            % (rapport, len(poids_noms), len(poids_prenoms), len(noms), len(prenoms),
               len(ecartes)))
    # Jetons présents comme nom de famille mais rangés parmi les prénoms : ceux qui, parmi les
    # noms, produiraient des inversions.
    deplaces = sorted(((poids_noms[j], j) for j in poids_noms if j in prenoms), reverse=True)
    emettre('  dont %d jeton(s) présents comme NOM dans la source mais versés aux PRÉNOMS '
            '(leur poids de prénom domine) ;' % len(deplaces))
    if n_exemples and deplaces:
        for pn, j in deplaces[:n_exemples]:
            emettre('     %-18s nom %7d / prénom %7d' % (j, pn, poids_prenoms[j]))

    jetons_noms, seuil_noms = tete(noms, palier_noms)
    jetons_prenoms, seuil_prenoms = tete(prenoms, palier_prenoms)
    emettre('paliers : %d nom(s) (le dernier pèse %d), %d prénom(s) (le dernier pèse %d).'
            % (len(jetons_noms), seuil_noms, len(jetons_prenoms), seuil_prenoms))

    jetons_noms = [j for j in jetons_noms if valide(j)]
    jetons_prenoms = [j for j in jetons_prenoms if valide(j)]

    if statistiques:
        emettre('--statistiques : aucun fichier écrit.')
        return 0

    emettre('')
    ecrire(os.path.join(sortie, 'noms-frequents.txt'), jetons_noms,
           'Noms de famille les plus portés, Suisse puis France.',
           citations_noms, seuil_noms, rapport, emettre)
    ecrire(os.path.join(sortie, 'prenoms-frequents.txt'), jetons_prenoms,
           'Prénoms les plus portés, Suisse puis France.',
           citations_prenoms, seuil_prenoms, rapport, emettre)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
