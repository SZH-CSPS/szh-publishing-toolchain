#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# moissonner-noms-publics.py — construit les DEUX index de fréquence PUBLICS du lexique :
#   pipeline/lexique/noms-frequents.txt     (noms de famille)
#   pipeline/lexique/prenoms-frequents.txt  (prénoms)
# lus par manuscrit_noms.BaseNoms en renfort de la base OJS du poste. Contrat :
# outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §5.5 quater. Brief de cadrage :
# outils-dev/BRIEF-lexique-noms-elargi.md.
#
# ⚠ CE SCRIPT N'EST PAS generer-noms.py, ET NE LE REMPLACE PAS.
# `noms-famille.txt` (les 1282 noms tirés des bibliographies du corpus local, fabriqué par
# generer-noms.py) reste un fichier DISTINCT, produit par un script distinct, régénéré
# séparément. Décision d'architecture prise ici, option (A) du §7 du brief, pour deux raisons
# mesurées : (1) les provenances ne se mélangent pas — chaque fichier porte sa source et sa
# licence en en-tête, ce qui est une CONDITION de la licence de l'OFS ; (2) generer-noms.py
# lancé sans corpus valide réécrit son fichier VIDE sans s'arrêter (piège documenté au §7 du
# brief) : avec deux fichiers, cet accident ne peut plus emporter que le sien.
#
# ---------------------------------------------------------------------------------
# LE PROBLÈME, ET POURQUOI « PLUS GROS » N'EST PAS « MEILLEUR »
#
# manuscrit_noms._signal_lexique() ne teste pas une appartenance, il COMPARE deux hypothèses :
#   score_direct  = (tête connue comme prénom) + (queue connue comme nom)
#   score_inverse = (tête connue comme nom)    + (queue connue comme prénom)
# Verser des noms de famille sans verser de prénoms ne renforce donc qu'un côté de la balance,
# et produit deux dégâts : l'EXTINCTION (les deux jetons connus des deux côtés -> égalité ->
# le signal se tait là où il tranchait juste) et l'INVERSION (« Thomas Aebischer » avec
# `thomas` en nom de famille et `aebischer` inconnu -> le signal répond « ordre inverse », une
# réponse FAUSSE, pas un silence). D'où les deux fichiers, et surtout le filtre ci-dessous.
#
# LE FILTRE DE DISCRIMINATION est ce qui fait la qualité du lot, pas le palier retenu.
# Les deux sources de l'OFS décrivent la MÊME population résidante : pour un jeton donné on
# dispose donc de son poids comme nom de famille ET de son poids comme prénom, sur la même
# échelle. Mesuré le 22.09.2026 sur les données 2025 : 14 750 jetons pliés apparaissent des
# deux côtés, et parmi le top 30 000 des noms de famille, 1 383 (4,6 %) pèsent plus lourd
# comme prénom que comme nom — dont, tout en haut du classement, martin, peter, michel,
# walter, simon, werner, richard, gabriel, ernst, rosa. Ce sont exactement les jetons qui
# fabriquent des inversions. Le filtre les ATTRIBUE (au côté qui domine) ou les ÉCARTE des
# deux côtés, selon --rapport ; le choix se règle au banc (outils-dev/lexique/banc-noms.py),
# jamais à l'intuition.
#
# ---------------------------------------------------------------------------------
# SOURCES, ET CE QUE LEUR LICENCE EXIGE
#
# Toutes publiques, toutes vérifiées sur pièce le 22.09.2026 (le brief les donnait de mémoire,
# sans les avoir ouvertes — trois de ses hypothèses se sont révélées fausses, voir les
# commentaires de SOURCES ci-dessous). AUCUNE ne dérive de C:\ProgramData\SZH\auteurs.json :
# ce script ne lit jamais ce fichier, et n'en a aucun moyen de le faire.
#
#   OFS  — obligation d'indiquer la source (opendata.swiss « terms_by »).
#   INSEE/Etalab — Licence Ouverte 2.0, mention de la paternité.
# Cette obligation est honorée dans l'EN-TÊTE DE CHAQUE FICHIER PRODUIT, pas seulement ici :
# c'est le fichier qui voyage, pas le script.
#
# ---------------------------------------------------------------------------------
# CE QUI VA DANS LE DÉPÔT, ET CE QUI N'Y VA PAS
# Le CSV brut téléchargé (38 Mo pour les quatre) reste dans tmp/ (déjà dans .gitignore).
# Seuls les deux fichiers pliés, filtrés, tronqués au palier et triés sont committés.
#
# stdlib seule (y compris pour lire un CSV : csv est de la stdlib). CLI à tiret analysée à la
# main, comme generer-noms.py et moissonner-ojs.py du même dossier.
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

# Le serveur de l'OFS (dam-api.bfs.admin.ch) rend 403 à une requête sans en-tête User-Agent —
# mesuré le 22.09.2026, l'urllib nu échoue et la même URL passe avec cet en-tête. Ce n'est pas
# une authentification, juste un filtre d'agent ; il est donc honnête d'annoncer qui appelle.
ENTETES = {'User-Agent': 'Mozilla/5.0 (compatible; szh-publishing-toolchain; +https://szh.ch)',
           'Accept': 'text/csv, */*'}


# ---------------------------------------------------------------------------------
# Les sources. Chaque entrée porte ce qu'il faut pour CITER la source dans l'en-tête du
# fichier produit — c'est une obligation de licence, pas une politesse.

SOURCES = [
    # ⚠ Le brief pointait la version « par région linguistique » publiée en 2022 (données
    # 2021). Vérifié le 22.09.2026 sur l'API CKAN d'opendata.swiss : une édition 2026 existe
    # (données 2025), c'est elle qui est prise. 238 962 noms distincts, 8 557 230 personnes.
    {'cle': 'ofs-noms', 'cible': 'nom',
     'url': 'https://dam-api.bfs.admin.ch/hub/api/dam/assets/36752522/master',
     'fichier': 'ofs-noms-2025.csv',
     'colonne': 'LASTNAME', 'poids': 'VALUE',
     'citation': "OFS, Noms de famille de la population résidante permanente par région "
                 "linguistique, état 2025 (publié le 21.08.2026) — opendata.swiss, "
                 "utilisation libre avec obligation d'indiquer la source"},
    # ⚠ Le brief supposait que l'OFS « supprime les noms trop rares » sans connaître le seuil,
    # et parlait de « plus d'un demi-million de noms distincts ». Les deux sont faux, mesuré
    # sur le fichier : le seuil de suppression vaut 3 (aucune ligne en dessous, ni pour les
    # noms ni pour les prénoms), et il reste 238 962 noms, pas 500 000. La « queue » que le
    # brief craignait est donc déjà coupée à la source.
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
    # ⚠ Le brief proposait aussi un jeu CC0 « 75 pays » (GitHub, popular-names-by-country) :
    # vérifié le 22.09.2026, il pèse 95 Ko et ne porte qu'une centaine de noms par pays —
    # entièrement contenu dans ce qui suit, sans intérêt ici. Écarté.
    #
    # La France, elle, apporte une VRAIE queue : 879 421 patronymes et 209 309 prénoms avec
    # leur nombre d'occurrences. Extraction de la base SIRENE, donc biaisée vers les personnes
    # inscrites au registre des entreprises, et l'éditeur prévient lui-même qu'« aucune
    # vérification du contenu n'est faite » — d'où SEUIL_BRUIT_INSEE plus bas, sans lequel le
    # fichier verse des chaînes comme « 838930E » ou « AAAAAA » dans le lexique.
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

# Seuil de bruit propre à la source INSEE (les sources de l'OFS n'en ont pas besoin : elles
# sont déjà coupées à 3 par le producteur, et vérifiées). Mesuré le 22.09.2026 : à 1
# occurrence le fichier verse des matricules et des saisies accidentelles ; à 50 il n'en
# reste plus dans un échantillon de 200 jetons tirés au hasard. Retenu 50, et non un chiffre
# rond plus haut, parce que la queue française utile (un patronyme porté par quelques dizaines
# de personnes) est précisément ce qu'on vient chercher dans cette source.
SEUIL_BRUIT_INSEE = 50

# Particules — le lexique compare un JETON, et manuscrit_noms teste le dernier jeton
# non-particule d'un nom (« da Silva » se teste sur « silva »). Recopiées ici plutôt
# qu'importées de pipeline/docx-meta.py : ce script tourne sur un poste de développement, la
# liste est courte et figée, et l'import par chemin d'un module à tiret pour treize mots
# coûterait plus cher en lignes qu'il n'en économise. Toute divergence serait sans effet : au
# pire un jeton de particule entre dans le lexique, où il n'est jamais interrogé.
PARTICULES = {
    'de', 'du', 'des', 'da', 'das', 'di', 'del', 'della', 'dos', 'do', 'van', 'von', 'der',
    'den', 'ten', 'ter', 'le', 'la', 'el', 'al', 'bin', 'ben', 'af', 'av', 'zu', 'vom', 'zum',
    'y', "d'", 'st', 'mac', 'mc',
}


# ---------------------------------------------------------------------------------
# Pliage — DOIT rester identique à manuscrit_noms._plier() (contrat, §3.2) : NFD, minuscules,
# combinants retirés, ponctuation de BORD seule retirée (jamais le tiret interne de
# « Anne-Françoise », qui porte le sens). Même duplication assumée que dans generer-noms.py,
# et pour la même raison : six lignes écrites noir sur blanc dans le contrat.
PONCTUATION_BORD = string.punctuation + '«»‘’“”…‑–—'


def plier(jeton):
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip(PONCTUATION_BORD)


def valide(jeton):
    """Même règle que generer-noms.valide() (§5.2, règle 1) : au moins 2 lettres, aucun
    chiffre, aucune arobase. `isalpha()` serait trop strict — il rejetterait
    « anne-francoise » et « sermier-dessemontet ». Une lettre de plus est exigée ici que la
    seule non-vacuité, parce que les deux sources contiennent des initiales isolées."""
    if not jeton or '@' in jeton or any(c.isdigit() for c in jeton):
        return False
    return sum(1 for c in jeton if c.isalpha()) >= 2


def jeton_de_nom(brut):
    """Le jeton qu'un nom de famille présentera à manuscrit_noms : son DERNIER mot
    non-particule (_candidat_fin du contrat, §3.2). Mesuré le 22.09.2026 sur la source OFS :
    297 528 noms d'un seul mot, 9 309 de deux, 527 de trois, 4 de quatre — la règle ne
    concerne donc que 3 % des entrées, mais ce sont les « da Silva » et les « von Arx », des
    noms très portés."""
    mots = [plier(m) for m in (brut or '').split()]
    mots = [m for m in mots if m]
    if not mots:
        return ''
    for m in reversed(mots):
        if m not in PARTICULES:
            return m
    return mots[-1]


def jeton_de_prenom(brut):
    """Le jeton qu'un prénom présentera : son PREMIER mot (_candidat_debut). Les deux sources
    de prénoms ne portent que des prénoms d'un seul mot (mesuré : 1 019 069 lignes de l'OFS,
    zéro espace), le `split()` est donc une garde, pas une règle active — mais la source
    française n'a pas été vérifiée sur ce point ligne à ligne."""
    mots = [plier(m) for m in (brut or '').split()]
    return mots[0] if mots else ''


# ---------------------------------------------------------------------------------
# Téléchargement et lecture.

def telecharger(cache, emettre):
    """Remplit le cache. Les fichiers déjà présents ne sont pas retéléchargés (38 Mo en tout,
    et les sources ne bougent qu'une fois l'an) — effacer le fichier force la reprise."""
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
    """Counter {jeton plié -> poids agrégé}. Les deux sources de l'OFS ventilent une même
    personne sur plusieurs lignes (par région linguistique pour les noms, par année de
    naissance pour les prénoms) : l'agrégation par jeton est donc indispensable, et elle
    absorbe au passage les variantes que le pliage réunit (« Müller » et « Muller » deviennent
    le même jeton, leurs poids s'ajoutent). Source absente -> Counter vide et un message ;
    jamais une exception (le script doit pouvoir tourner avec une source de moins et le dire)."""
    chemin = os.path.join(cache, src['fichier'])
    if not os.path.isfile(chemin):
        emettre('source absente : %s (lancer --telecharger)' % src['fichier'])
        return Counter(), 0
    compte = Counter()
    lignes = 0
    seuil = SEUIL_BRUIT_INSEE if src['cle'].startswith('insee') else 0
    extraire = jeton_de_nom if src['cible'] == 'nom' else jeton_de_prenom
    # encoding='utf-8-sig' : les quatre fichiers de l'OFS portent une BOM, la lire comme du
    # simple utf-8 collerait la BOM au nom de la première colonne et casserait le DictReader.
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
# Le filtre de discrimination (§5.3 du brief) — le cœur du lot.

def discriminer(poids_noms, poids_prenoms, rapport):
    """(noms_retenus, prenoms_retenus, ecartes) — trois Counter, chaque jeton dans au plus un
    des deux premiers.

    Règle : un jeton entre dans les NOMS si son poids de nom vaut au moins `rapport` fois son
    poids de prénom ; dans les PRÉNOMS si l'inverse ; nulle part si aucune des deux conditions
    n'est remplie (la « zone neutre », vide quand rapport vaut 1). Un jeton inconnu de l'autre
    côté (poids 0) satisfait toujours sa condition : la très grande majorité des jetons ne sont
    donc pas concernés par ce filtre.

    Pourquoi ATTRIBUER plutôt qu'ÉCARTER des deux côtés (ce que le §5.3 du brief demandait
    littéralement) : écarter « peter » des deux index le rend muet sur « Peter Müller »,
    l'attribuer aux prénoms le fait trancher juste, et ne peut pas mentir sur « Müller Peter »
    (qui tranche juste aussi, en ordre inverse). L'écart au brief est assumé, et il est
    mesurable : `--rapport` très grand se rapproche du comportement qu'il décrivait. C'est le
    banc qui arbitre, pas ce commentaire."""
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
    """Les `palier` jetons les plus lourds, rendus TRIÉS ALPHABÉTIQUEMENT (c'est la forme du
    fichier : un diff git lisible, et manuscrit_noms ne lit jamais l'ordre). Le classement par
    poids ne sert qu'à décider QUI entre, jamais dans quel ordre."""
    ordonne = sorted(compte.items(), key=lambda kv: (-kv[1], kv[0]))
    if palier and palier > 0:
        ordonne = ordonne[:palier]
    seuil = ordonne[-1][1] if ordonne else 0
    return sorted(j for j, _ in ordonne), seuil


# ---------------------------------------------------------------------------------
# Écriture.

def ecrire(chemin, jetons, titre, citations, seuil, rapport, emettre):
    """Un jeton par ligne, `#` en commentaire — la forme que _charger_fichier_lexique() lit.
    L'en-tête porte les citations de source : c'est une CONDITION des deux licences, et le
    fichier voyage seul (le dépôt a vocation à devenir public)."""
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
    # 0 = aucune troncature, et c'est le DÉFAUT — c'est aussi ce qui est committé. Mesuré au
    # banc le 22.09.2026, à rapport 2, sur les 1152 fiches réelles : chaque palier intermédiaire
    # est strictement moins bon que le suivant, sur les DEUX colonnes qui comptent.
    #   30 000 / 8 000    -> 1086 justes (94,3 %), 10 inversions, 25 muets, 105 Ko en dépôt
    #   30 000 / tous     -> 1095 (95,1 %),         9,            16,       227 Ko
    #   100 000 / 30 000  -> 1101 (95,6 %),         9,            13,       359 Ko
    #   tout (228k/55k)   -> 1110 (96,4 %),         7,             7,       816 Ko
    # Le palier complet corrige TROIS inversions réelles (« Ayala Borghini », « Kolja Ernst »,
    # « Simoni Symeonidou » — des prénoms et des noms rares en Suisse, absents des têtes de
    # classement) et n'en introduit AUCUNE. C'est le critère d'acceptation du §6 du brief,
    # appliqué : le plus grand palier qui ne fait pas monter « à l'envers » et fait baisser
    # « muet ». Le coût est en poids de dépôt, jamais en temps : le chargement de la base passe
    # de 19 à 133 ms, sur un nettoyage qui en prend 2300.
    # Tronquer reste possible (--palier-noms 30000 --palier-prenoms 8000) ; ce n'est pas le
    # défaut, pour qu'une régénération ne rétrécisse jamais le lexique sans qu'on l'ait demandé.
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
        # Même piège que celui documenté au §7 du brief pour generer-noms.py — ici on
        # REFUSE d'écrire plutôt que d'écrire un fichier vide. Un lexique vide ne se
        # distingue pas d'un lexique absent pour manuscrit_noms, mais il écrase le précédent.
        emettre('ERREUR : une des deux familles de sources est vide (%d source(s) manquante(s)). '
                'Rien n\'est écrit — lancer --telecharger.' % manquantes)
        return 1

    noms, prenoms, ecartes = discriminer(poids_noms, poids_prenoms, rapport)
    emettre('')
    emettre('discrimination (rapport %g) : %d jeton(s) de nom et %d de prénom au départ ; '
            '%d retenus côté nom, %d côté prénom, %d en zone neutre (écartés des deux).'
            % (rapport, len(poids_noms), len(poids_prenoms), len(noms), len(prenoms),
               len(ecartes)))
    # Les jetons DÉPLACÉS — présents comme nom de famille dans la source, mais versés aux
    # prénoms parce que leur poids de prénom domine. Ce sont eux qui, versés naïvement aux
    # noms, fabriqueraient les inversions du §3 du brief : les afficher est la mesure du
    # filtre, pas un ornement.
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
