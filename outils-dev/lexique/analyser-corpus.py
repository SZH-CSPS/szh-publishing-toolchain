#!/usr/bin/env python3
# Analyse linguistique du corpus OJS (tmp/corpus-ojs, galleys DOCX publiées) pour préparer
# le lexique de pipeline/vale/lexique/. Bibliothèque standard seule. Se lance dans la WSL
# SZH-Publishing, qui a pandoc et vale.
#
# Écrit des brouillons dans tmp/lexique/ (hors git) : fréquences, termes du domaine, sigles,
# variantes, vocabulaire du handicap, faux positifs Vale, et un lexique candidat au format
# final (candidat-lexique-<langue>.csv). Le tri éditorial des lignes se fait ensuite à la main.
#
# L'italien (2 articles) est ignoré : trop peu de documents.
import argparse
import csv
import json
import re
import subprocess
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]
CORPUS_DEFAUT = RACINE / 'tmp' / 'corpus-ojs'
SORTIE_DEFAUT = RACINE / 'tmp' / 'lexique'
VALE_INI = RACINE / 'pipeline' / 'vale' / '.vale.ini'
VALE_BIN_DEFAUT = str(Path.home() / '.local' / 'bin' / 'vale')

LANGUES = ('fr', 'de')

# ---------------------------------------------------------------------------------------
# Titres de bibliographie : mêmes mots que pronto_modele.lire_titres_bib(), comparés sur le
# texte pandoc après aplatir() (sans style de paragraphe, sans accents ni casse).
TITRES_BIBLIO = {
    'references', 'bibliographie', 'bibliographieundquellen', 'literatur',
    'literaturverzeichnis', 'quellenverzeichnis', 'quellen',
}
RE_NUM_TITRE = re.compile(r'^\d+[.)]?\s*')
PREFIXES_TITRE_BIBLIO = ('listedes', 'listede', 'liste')

# Marqueurs de résumé et de mots-clés qui terminent le bloc d'auteurs à écarter. Paragraphe
# court (< 60 caractères) : un titre isolé ; plus long : pandoc a fusionné titre et résumé.
RE_RESUME = re.compile(r'^(résumé|resume|abstract|zusammenfassung)\s*:?\s*', re.IGNORECASE)
RE_MOTSCLES = re.compile(
    r'^(mots[\s-]?cl[ée]s?|schlüsselw[oö]rter|schlagw[oö]rter)\s*:?\s*', re.IGNORECASE)
LIMITE_PARAGRAPHES_ENTETE = 20

# ---------------------------------------------------------------------------------------
# Tokenisation : lettres Unicode (accents compris), jointes par apostrophe ou trait d'union
# internes. Les chiffres et la ponctuation ne font jamais partie d'un token.
RE_TOKEN = re.compile(r"[^\W\d_]+(?:[-'’][^\W\d_]+)+|[^\W\d_]+", re.UNICODE)
RE_SIGLE = re.compile(r'\b[A-ZÄÖÜ]{2,}\d{0,3}\b')
# chiffres romains et artefacts fréquents de l'export Word, qui ne sont pas des sigles
SIGLES_IGNORES = {
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV',
    'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'PDF', 'DOCX',
    # métadonnées/licence répétées à l'identique dans (presque) tous les galleys : pas des
    # sigles du domaine.
    'BY', 'CC', 'SA', 'ND', 'ISSN', 'ORCID', 'DOI', 'URL', 'ISBN',
}
RE_DEV_APRES = re.compile(
    r'([A-ZÀ-Ýa-zà-ÿ][\wÀ-ÿ\'’ -]{2,80}?)\s*\(\s*([A-ZÄÖÜ]{2,}\d{0,3})\s*\)')
RE_DEV_AVANT = re.compile(
    r'\b([A-ZÄÖÜ]{2,}\d{0,3})\s*\(\s*([A-ZÀ-Ýa-zà-ÿ][\wÀ-ÿ\'’ -]{2,80}?)\s*\)')

RE_PHRASE = re.compile(r'(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Þ0-9«"])')

# ---------------------------------------------------------------------------------------
# Mots-outils (grammaticaux) : exclus des n-grammes lexicaux. Listes courtes, écrites à la
# main.
STOPWORDS = {
    'fr': set("""
        le la les l un une des de du au aux et ou où mais donc or ni car ce cet cette ces
        cela ceci celui celle ceux celles son sa ses leur leurs notre nos votre vos mon ma
        mes ton ta tes je tu il elle on nous vous ils elles se te me lui y en qui que quoi
        dont comme si ne pas plus moins très bien mal aussi encore déjà toujours jamais
        alors ainsi ici là où quand comment pourquoi est sont était étaient été être avoir a
        ont eu avait avaient dans pour sur avec par sans sous vers chez depuis pendant après
        avant entre selon dès afin lors lorsque tout toute tous toutes autre autres même
        mêmes tel telle tels telles chaque plusieurs certains certaines quelque quelques
        cependant néanmoins toutefois pourtant ainsi donc par conséquent d'une d'un à
        d'ailleurs notamment ainsi surtout enfin puis ensuite d'abord
    """.split()),
    'de': set("""
        der die das den dem des ein eine einer eines einem einen und oder aber nicht ist
        sind war waren sein bin bist seid haben hat hatte hatten wird werden wurde wurden
        mit von zu zum zur auf für im in an am bei nach über unter durch um als wie wenn
        dass weil damit auch nur noch schon sehr mehr kann können muss müssen soll sollen
        diese dieser dieses diesem diesen es er sie wir ihr man sich ihre ihren ihrem seine
        seinen seinem dem den des ob ja nein so also dann dort hier wo wann warum welche
        welcher welches zwischen ohne bis seit während trotz statt wegen jede jeder jedes
        alle allem allen aller alles kein keine keiner keinem keinen keines
    """.split()),
}

# Vocabulaire générique et académique, fréquent partout mais pas propre au domaine : retiré
# des termes du domaine, pas des fréquences brutes.
MOTS_COURANTS = {
    'fr': set("""
        étude recherche résultats résultat exemple cas partir être fait fait font faut
        ordre sens façon manière point cadre niveau plan part sein cours égard terme
        nombre type forme travail travaux auteur auteurs article articles tableau
        tableaux figure figures chapitre chapitres partie parties question questions
        problème problèmes analyse analyses donnée données processus contexte objectif
        objectifs conclusion conclusions introduction discussion première premier
        deuxième troisième dernière dernier différentes différents plusieurs certain
        certains important importante importants générale général générales généraux
        vol pp doi
    """.split()),
    'de': set("""
        studie forschung ergebnis ergebnisse beispiel fall ausgehend sein gemacht ordnung
        sinn weise rahmen ebene plan teil hinsicht begriff zahl anzahl form arbeit arbeiten
        autor autoren artikel tabelle tabellen abbildung abbildungen abb kapitel teil frage
        fragen problem probleme analyse analysen daten prozess kontext ziel ziele
        schlussfolgerung einleitung diskussion erste zweite dritte letzte unterschiedliche
        unterschiedlichen mehrere wichtig wichtige allgemein allgemeine doch hinaus gerade
        daher stark weg besteht einzelnen anderem gilt bedeutet bd
    """.split()),
}

# Racines de classification des termes du domaine. Ordre de priorité :
# handicap > ecole > institution > methode > autre. Un n-gramme est classé dans la première
# catégorie dont une racine apparaît dans UN de ses tokens (sous-chaîne, accents aplatis).
RACINES_CATEGORIE = {
    'handicap': [
        'handicap', 'deficien', 'defician', 'trouble', 'incapacit', 'inclusi', 'accessib',
        'beeintrachtig', 'behinder', 'forderbedarf', 'autis', 'dys', 'sensoriel', 'moteur',
        'cognitif', 'cognitiv', 'mental', 'polyhandicap', 'invalid', 'deficit',
    ],
    'ecole': [
        'ecole', 'scolair', 'eleve', 'enseign', 'classe', 'pedagog', 'apprentissage',
        'schul', 'unterricht', 'lehr', 'schuler', 'klass', 'didaktik', 'didactique',
        'curriculum', 'lernen', 'apprenant',
    ],
    'institution': [
        'institution', 'association', 'office', 'service', 'centre', 'fondation', 'heim',
        'verband', 'amt', 'kanton', 'einrichtung', 'canton', 'conseil', 'commission',
        'departement', 'politique',
    ],
    'methode': [
        'methode', 'approche', 'dispositif', 'outil', 'evaluation', 'intervention',
        'programme', 'modell', 'verfahren', 'instrument', 'massnahme', 'mesure', 'demarche',
        'strategie', 'concept', 'modele',
    ],
}
ORDRE_CATEGORIES = ['handicap', 'ecole', 'institution', 'methode']

# Groupes de synonymes que la normalisation mécanique (accent, trait d'union, espace,
# pluriel, casse, point médian) ne réunit pas. Liste éditoriale, écrite à la main.
SYNONYMES_CONNUS = {
    'fr': [
        (['besoins éducatifs particuliers'], 'besoins particuliers'),
        (['personne handicapée', "personnes en situation d'handicap"],
         'personne en situation de handicap'),
    ],
    'de': [
        (['schülerinnen und schüler'], 'schüler:innen'),
    ],
}

# Vocabulaire du handicap à mesurer tel quel, motif -> libellé pour le rapport.
VOCAB_HANDICAP = {
    'fr': [
        (r'personnes? en situation de handicap', 'personne en situation de handicap'),
        (r'personnes? handicap[ée]e?s?', 'personne handicapée'),
        # Point médian obligatoire (\xb7 = « · ») : sans lui, le motif prend aussi
        # « handicapée(s) » et compte deux fois la ligne précédente.
        (r'handicap[ée]\xb7e\xb7s?\b', "handicapé·e·s"),
        (r'd[ée]ficiences?', 'déficience'),
        (r'troubles?\b', 'trouble'),
        (r'besoins? [ée]ducatifs? particuliers?', 'besoins éducatifs particuliers'),
        (r'[ée]l[èe]ves? à\s*bep\b', 'élève à BEP'),
    ],
    'de': [
        (r'menschen mit behinderung(?:en)?', 'Menschen mit Behinderung'),
        (r'behinderte[nrs]?\b', 'Behinderte'),
        (r'beeintr[aä]chtigung(?:en)?', 'Beeinträchtigung'),
        (r'f[oö]rderbedarf', 'Förderbedarf'),
    ],
}


def aplatir(texte):
    """Minuscules, sans accents, sans espaces ni ponctuation, comme pronto_modele.aplatir()."""
    nfkd = unicodedata.normalize('NFKD', texte.lower())
    sans_accents = ''.join(c for c in nfkd if not unicodedata.combining(c))
    return re.sub(r'[^a-z0-9]', '', sans_accents)


def cle_surete(terme):
    """Clé de regroupement qui ignore trait d'union, espace, deux-points, point médian et
    casse, mais pas les accents ni le pluriel. Seule clé assez sûre pour choisir
    automatiquement une forme privilégiée : sans accents, « élève » et « élevé » se
    confondraient (« coenseignement »/« co-enseignement » se réunissent)."""
    plat = terme.lower().replace('·', '').replace(':', '').replace('-', '')
    return re.sub(r'\s+', '', plat)


def cle_large(terme):
    """cle_surete() qui ignore aussi les accents et le pluriel simple : repère des groupes
    « à trancher », sans choisir de forme (voir cle_surete)."""
    nfkd = unicodedata.normalize('NFKD', terme.lower())
    sans_accents = ''.join(c for c in nfkd if not unicodedata.combining(c))
    sans_accents = sans_accents.replace('·', '').replace(':', '').replace('-', '')
    sans_accents = re.sub(r'\s+', '', sans_accents)
    if len(sans_accents) > 4 and sans_accents.endswith('s'):
        sans_accents = sans_accents[:-1]
    return sans_accents


def lire_inventaire(chemin_csv):
    lignes = []
    with open(chemin_csv, encoding='utf-8', newline='') as f:
        for row in csv.DictReader(f):
            lignes.append(row)
    return lignes


def extraire_texte(chemin_docx, pandoc='pandoc'):
    r = subprocess.run([pandoc, '-t', 'plain', '--wrap=none', str(chemin_docx)],
                        capture_output=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError('pandoc a échoué sur ' + str(chemin_docx) + ' : '
                            + r.stderr.decode('utf-8', 'replace')[:500])
    return r.stdout.decode('utf-8', 'replace')


def decouper_paragraphes(texte):
    return [p.strip() for p in re.split(r'\n\s*\n+', texte) if p.strip()]


def ecarter_entete_et_biblio(paragraphes):
    """(corps, diagnostic) — corps : liste de paragraphes sans bloc d'auteurs ni
    bibliographie. diagnostic : dict pour compter, dans le rapport, combien de documents sont
    passés par le repli plutôt que par les marqueurs (résumé/mots-clés, titre de biblio)."""
    diag = {'entete': 'marqueurs', 'biblio': 'titre_trouve'}
    debut = 0
    limite = min(LIMITE_PARAGRAPHES_ENTETE, len(paragraphes))
    i_resume = None
    for i in range(limite):
        if RE_RESUME.match(paragraphes[i]):
            i_resume = i
            break
    if i_resume is not None:
        # paragraphe court = titre isolé du résumé -> le résumé commence après ;
        # paragraphe long = résumé et titre déjà dans le même bloc pandoc.
        i_apres_resume = i_resume + 1 if len(paragraphes[i_resume]) < 60 else i_resume
        debut = i_apres_resume + 1
        for j in range(i_apres_resume + 1, min(i_apres_resume + 4, len(paragraphes))):
            if RE_MOTSCLES.match(paragraphes[j]):
                debut = j + 1
                break
    else:
        # repli : pas de marqueur résumé/mots-clés trouvé dans les vingt premiers paragraphes
        # (mise en forme atypique) -> on écarte seulement titre + auteurs présumés.
        diag['entete'] = 'repli'
        debut = min(2, len(paragraphes))

    fin = len(paragraphes)
    for i in range(len(paragraphes) - 1, debut - 1, -1):
        p = paragraphes[i]
        if len(p) > 80:
            continue
        plat = RE_NUM_TITRE.sub('', aplatir(p))
        trouve = plat in TITRES_BIBLIO
        if not trouve:
            for prefixe in PREFIXES_TITRE_BIBLIO:
                if plat.startswith(prefixe) and plat[len(prefixe):] in TITRES_BIBLIO:
                    trouve = True
                    break
        if trouve:
            fin = i
            break
    else:
        diag['biblio'] = 'non_trouve'

    return paragraphes[debut:fin], diag


def tokeniser(paragraphe):
    return RE_TOKEN.findall(paragraphe)


def construire_ngrammes(corps_paragraphes_id, stopwords):
    """corps_paragraphes_id : liste de (article_id, [paragraphes]). Rend
    {n: {cle_minuscule: {'freq': int, 'docs': set(article_id), 'surface': Counter,
    'exemples': [phrase, phrase]}}} pour n in (1, 2, 3)."""
    sortie = {1: defaultdict(lambda: {'freq': 0, 'docs': set(), 'surface': Counter(), 'exemples': []}),
              2: defaultdict(lambda: {'freq': 0, 'docs': set(), 'surface': Counter(), 'exemples': []}),
              3: defaultdict(lambda: {'freq': 0, 'docs': set(), 'surface': Counter(), 'exemples': []})}
    for article_id, paragraphes in corps_paragraphes_id:
        for p in paragraphes:
            tokens = tokeniser(p)
            phrases = RE_PHRASE.split(p)
            for n in (1, 2, 3):
                for i in range(len(tokens) - n + 1):
                    gram = tokens[i:i + n]
                    lows = [t.lower() for t in gram]
                    if any(w in stopwords or len(w) < 2 for w in lows):
                        continue
                    cle = ' '.join(lows)
                    entree = sortie[n][cle]
                    entree['freq'] += 1
                    entree['docs'].add(article_id)
                    entree['surface'][' '.join(gram)] += 1
                    if len(entree['exemples']) < 2:
                        surface_premier = gram[0]
                        for ph in phrases:
                            if surface_premier.lower() in ph.lower() and len(ph) < 300:
                                ph2 = ph.strip()
                                if ph2 and ph2 not in entree['exemples']:
                                    entree['exemples'].append(ph2)
                                    break
    return sortie


def surface_dominante(surface_counter):
    """Comme most_common(1), mais préfère la forme en minuscules si elle pèse au moins 30 %
    de la forme capitalisée (« Co-responsable » en début de phrase)."""
    classement = surface_counter.most_common()
    meilleure, n_meilleure = classement[0]
    for forme, n in classement[1:]:
        if forme.lower() == meilleure.lower() and forme[:1].islower() and n >= 0.3 * n_meilleure:
            return forme
    return meilleure


def categoriser(cle, langue):
    plat = aplatir(cle)
    for cat in ORDRE_CATEGORIES:
        for racine in RACINES_CATEGORIE[cat]:
            if racine in plat:
                return cat
    return 'autre'


def extraire_sigles_et_developpements(corps_paragraphes_id):
    """(occ, developpements, dev_docs). dev_docs[sigle] : les documents qui développent
    eux-mêmes le sigle. Cette proportion décide de la colonne `exiger_developpement` : un
    sigle établi (BEP, CUA…) que les textes publiés ne développent pas ne doit pas l'exiger."""
    occ = defaultdict(lambda: {'freq': 0, 'docs': set()})
    developpements = defaultdict(Counter)
    dev_docs = defaultdict(set)
    # Un vrai sigle n'apparaît presque jamais en minuscules : « QUOI » dans un titre est le
    # mot « quoi ». Ce filtre écarte les majuscules de titre sans dictionnaire.
    minuscules_vues = set()
    for _, paragraphes in corps_paragraphes_id:
        for p in paragraphes:
            for t in RE_TOKEN.findall(p):
                if t.islower() or (t[0].isupper() and t[1:].islower()):
                    minuscules_vues.add(t.lower())
    for article_id, paragraphes in corps_paragraphes_id:
        for p in paragraphes:
            for m in RE_SIGLE.finditer(p):
                s = m.group(0)
                if s in SIGLES_IGNORES or s.lower() in minuscules_vues:
                    continue
                occ[s]['freq'] += 1
                occ[s]['docs'].add(article_id)
            for m in RE_DEV_APRES.finditer(p):
                dev, sigle = m.group(1).strip(), m.group(2)
                if sigle in SIGLES_IGNORES or sigle.lower() in minuscules_vues:
                    continue
                developpements[sigle][dev] += 1
                dev_docs[sigle].add(article_id)
            for m in RE_DEV_AVANT.finditer(p):
                sigle, dev = m.group(1), m.group(2).strip()
                if sigle in SIGLES_IGNORES or sigle.lower() in minuscules_vues:
                    continue
                developpements[sigle][dev] += 1
                dev_docs[sigle].add(article_id)
    return occ, developpements, dev_docs


# Une forme épicène (trait d'union, point médian ou point) n'est pas une variante
# orthographique : « adolescent-e-s » et « adolescentes » n'ont pas le même sens, même si le
# regroupement par trait d'union les réunit. Même motif que la règle Vale
# CSPS.Epicene.FormesNonListees (voir le LISEZMOI du dossier Vale).
RE_EPICENE_SUFFIXE = re.compile(
    r'[a-zà-öø-ÿ]{3,}-e(?:-s)?$|[a-zà-öø-ÿ]{3,}·[a-zà-öø-ÿ]{1,8}(?:·s)?$'
    r'|[a-zà-öø-ÿ]{3,}\.(?:e|es)$'
    # Suffixes de genre que FormesNonListees.yml ne couvre pas (il s'arrête à « -e »/« -e-s ») :
    # « -le-s » (professionnel-le-s), « -ve-s » (actif-ve-s). Un vrai mot composé
    # (« burn-out », « socio-éducatif ») finit par plus de deux lettres.
    r'|[a-zà-öø-ÿ]{3,}-(?:le|ve)-s$', re.IGNORECASE)


def grouper_variantes(ngrammes_n1):
    """Deux regroupements. `orthographe` (membres qui ne diffèrent que par accent, trait
    d'union, espace, casse ou point médian) peut donner une forme privilégiée.
    `grammaticale` (réuni en ignorant le pluriel) reste « à trancher » : un pluriel n'est pas
    une faute du singulier."""
    groupes_stricts = defaultdict(list)
    for cle, entree in ngrammes_n1.items():
        if RE_EPICENE_SUFFIXE.search(cle):
            continue
        groupes_stricts[cle_surete(cle)].append((cle, entree))
    groupes_larges = defaultdict(list)
    for cle, entree in ngrammes_n1.items():
        if RE_EPICENE_SUFFIXE.search(cle):
            continue
        groupes_larges[cle_large(cle)].append((cle, entree))

    def resumer(membres, type_groupe):
        membres.sort(key=lambda m: -m[1]['freq'])
        forme, entree_forme = membres[0]
        surface_forme = surface_dominante(entree_forme['surface'])
        variantes = [m[0] for m in membres[1:]]
        docs, freq_totale = set(), 0
        for _, e in membres:
            docs |= e['docs']
            freq_totale += e['freq']
        return {'forme_privilegiee': surface_forme, 'variantes': variantes,
                'frequence': freq_totale, 'documents': len(docs), 'type': type_groupe}

    resultat = []
    dans_stricte = set()
    for _, membres in groupes_stricts.items():
        if len(membres) < 2:
            continue
        resultat.append(resumer(membres, 'orthographe'))
        dans_stricte.add(frozenset(m[0] for m in membres))
    for _, membres in groupes_larges.items():
        if len(membres) < 2:
            continue
        if frozenset(m[0] for m in membres) in dans_stricte:
            continue  # mêmes membres que le regroupement orthographique
        resultat.append(resumer(membres, 'grammaticale'))
    # Orthographe d'abord (seule à alimenter Coherence.yml) : sinon les paires
    # singulier/pluriel fréquentes (« personnes »/« personne ») rempliraient CAP_VARIANTES.
    resultat.sort(key=lambda r: (0 if r['type'] == 'orthographe' else 1, -r['frequence']))
    return resultat


def lire_swap_yaml(chemin):
    """Lit un bloc `swap:` de lignes `  "clé": valeur` ou `  clé: valeur`, la seule forme
    employée dans le dépôt. Pas un lecteur YAML général."""
    swap = {}
    dans_bloc = False
    try:
        texte = Path(chemin).read_text(encoding='utf-8')
    except OSError:
        return swap
    for ligne in texte.splitlines():
        if re.match(r'^swap:\s*$', ligne):
            dans_bloc = True
            continue
        if dans_bloc:
            if re.match(r'^\S', ligne) and not ligne.startswith(' '):
                break
            m = re.match(r"^\s+(['\"]?)(.+?)\1:\s*(['\"]?)(.+?)\3\s*(#.*)?$", ligne)
            if m:
                swap[m.group(2)] = m.group(4)
    return swap


def mesurer_vocabulaire_handicap(corps_paragraphes_id, langue, regles_swap):
    """Fait tourner chaque motif proscrit des règles Vale existantes sur les passages
    trouvés par VOCAB_HANDICAP. Un passage publié qui correspond à un motif proscrit est un
    faux positif de la règle (comparer deux motifs entre eux ne marche pas)."""
    fautifs_compiles = []
    for fautif in regles_swap:
        try:
            fautifs_compiles.append((fautif, re.compile(fautif, re.IGNORECASE)))
        except re.error:
            continue
    resultat = []
    for motif, libelle in VOCAB_HANDICAP[langue]:
        rx = re.compile(motif, re.IGNORECASE)
        freq, docs, exemples, passages = 0, set(), [], []
        for article_id, paragraphes in corps_paragraphes_id:
            for p in paragraphes:
                for m in rx.finditer(p):
                    freq += 1
                    docs.add(article_id)
                    if len(exemples) < 3:
                        exemples.append(p[:200])
                    if len(passages) < 40:
                        passages.append(m.group(0))
        contredit = None
        for fautif, rx_fautif in fautifs_compiles:
            if any(rx_fautif.search(passage) for passage in passages):
                contredit = fautif
                break
        resultat.append({
            'libelle': libelle, 'motif': motif, 'frequence': freq,
            'documents': len(docs), 'exemples': exemples,
            'contredit_regle_deconseillee': contredit,
        })
    return resultat


def ecrire_csv(chemin, entetes, lignes):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    with open(chemin, 'w', encoding='utf-8', newline='') as f:
        w = csv.writer(f, delimiter=';')
        w.writerow(entetes)
        for l in lignes:
            w.writerow(l)


def construire_candidats(ngrammes, sigles_occ, sigles_dev, dev_docs, variantes, vocab_handicap, langue):
    """Assemble les lignes candidates au format final du CSV, 300 à 800 lignes, dans cet
    ordre : vocabulaire du handicap, sigles connus, groupes de variantes, puis termes du
    domaine par fréquence décroissante jusqu'au budget."""
    lignes = []
    vus = set()

    def ajouter(terme, categorie, forme_priv, variantes_l, freq, docs, sigle_dev, statut,
                source, ex1, ex2, note, exiger_dev='non'):
        cle = aplatir(terme)
        if cle in vus:
            return
        vus.add(cle)
        lignes.append([terme, categorie, forme_priv, '|'.join(variantes_l), freq, docs,
                        sigle_dev or '', statut, source, ex1, ex2, note, exiger_dev])

    # 1. Vocabulaire du handicap, toujours inclus, même à fréquence nulle.
    for v in vocab_handicap:
        if v['contredit_regle_deconseillee']:
            statut = 'deconseille'
            source = ('CSPS.Vocabulaire.Handicap' if langue == 'fr' else 'SZH.Vokabular.Behinderung')
            note = 'usage publié contredit la règle Vale (faux positif probable)'
        elif v['frequence'] > 0:
            statut = 'privilegie' if langue == 'fr' and 'situation de handicap' in v['motif'] else 'neutre'
            source = ('CSPS.Vocabulaire.Handicap' if statut == 'privilegie' else '')
            note = ''
        else:
            statut = 'neutre'
            source, note = '', 'jamais rencontré dans le corpus publié'
        ex1 = v['exemples'][0] if v['exemples'] else ''
        ex2 = v['exemples'][1] if len(v['exemples']) > 1 else ''
        ajouter(v['libelle'], 'handicap', v['libelle'], [], v['frequence'], v['documents'],
                '', statut, source, ex1, ex2, note)

    # 2. Sigles vus dans au moins deux documents (un seul laisse passer des majuscules
    # isolées). Plafonnés pour laisser de la place aux termes du domaine ; priorité aux
    # sigles développés dans le corpus.
    CAP_SIGLES = 150
    sigles_retenus = [(s, c) for s, c in sigles_occ.items() if len(c['docs']) >= 2]
    sigles_retenus.sort(key=lambda sc: (0 if sigles_dev.get(sc[0]) else 1, -sc[1]['freq']))
    for sigle, compte in sigles_retenus[:CAP_SIGLES]:
        dev = ''
        if sigle in sigles_dev and sigles_dev[sigle]:
            dev = sigles_dev[sigle].most_common(1)[0][0]
        note = '' if dev else 'sigle jamais développé dans le corpus'
        # exiger_developpement : oui si plus de 75 % des documents où le sigle apparaît le
        # développent. À 50 %, des sigles développés « souvent » (CDPH 70 %, TSA 64 %)
        # donnaient trop d'alertes ; au-dessus de 75 %, l'alerte touche moins de 2 % des
        # documents.
        n_docs_sigle = len(compte['docs'])
        n_docs_dev = len(dev_docs.get(sigle, ()))
        SEUIL_EXIGER_DEV = 0.75
        exiger = 'oui' if dev and n_docs_sigle > 0 and (n_docs_dev / n_docs_sigle) > SEUIL_EXIGER_DEV else 'non'
        if not note:
            note = ('développé dans {}/{} documents où il apparaît'
                     .format(n_docs_dev, n_docs_sigle))
        ajouter(sigle, 'sigle', sigle, [], compte['freq'], len(compte['docs']), dev,
                'neutre', '', '', '', note, exiger_dev=exiger)

    # 3. Groupes de variantes, plafonnés eux aussi. Le type « orthographe » reçoit une forme
    # privilégiée ; le type « grammaticale » reste à trancher.
    CAP_VARIANTES = 150
    n_variantes_ajoutees = 0
    for grp in variantes:
        if grp['documents'] < 3:
            continue
        if n_variantes_ajoutees >= CAP_VARIANTES:
            break
        hyphenee = any('-' in v for v in grp['variantes'])
        if grp['type'] == 'orthographe' and not (langue == 'de' and hyphenee):
            statut, source, note = ('privilegie', 'lexique maison (variante orthographique '
                                     'mécanique : accent/trait d\'union/espace/casse/point '
                                     'médian, forme majoritaire du corpus)', '')
        elif grp['type'] == 'orthographe':
            # En allemand, un trait d'union isolé dans un mot est presque toujours une coupure
            # de justification du DOCX (« so-wie », « be-deutung ») : signalé, pas privilégié.
            statut, source, note = ('a_trancher', '',
                                     'trait d\'union isolé (allemand) : probable coupure de '
                                     'justification du document source, pas une variante '
                                     'éditoriale — à vérifier avant toute promotion')
        else:
            statut, source, note = ('a_trancher', '',
                                     'variantes de nombre (singulier/pluriel) — pas une '
                                     'substitution automatique, la grammaire décide, pas le lexique')
        ajouter(grp['forme_privilegiee'], categoriser(grp['forme_privilegiee'], langue),
                grp['forme_privilegiee'], grp['variantes'], grp['frequence'],
                grp['documents'], '', statut, source, '', '', note)
        n_variantes_ajoutees += 1

    # 3bis. Synonymes connus (liste éditoriale).
    for variantes_txt, forme in SYNONYMES_CONNUS.get(langue, []):
        ajouter(forme, categoriser(forme, langue), forme, variantes_txt, 0, 0, '',
                'a_trancher', 'brief 21.09.2026',
                '', '', 'synonymes cités par le brief, non comptés automatiquement')

    # 4. Termes du domaine, par fréquence décroissante, jusqu'au budget restant (300 à 800
    # lignes au total).
    BUDGET_TOTAL = 750
    BUDGET_MAX = max(BUDGET_TOTAL - len(lignes), 100)
    candidats_domaine = []
    for n in (1, 2, 3):
        for cle, e in ngrammes[n].items():
            if len(e['docs']) < 5:
                continue
            if cle in MOTS_COURANTS[langue]:
                continue
            if all(t in MOTS_COURANTS[langue] for t in cle.split()):
                continue
            surface = surface_dominante(e['surface'])
            candidats_domaine.append((e['freq'], len(e['docs']), surface, e))
    candidats_domaine.sort(key=lambda t: -t[0])
    for freq, docs, surface, e in candidats_domaine:
        if len(lignes) >= BUDGET_MAX:
            break
        cat = categoriser(surface, langue)
        ex = e['exemples']
        ajouter(surface, cat, surface, [], freq, docs, '', 'neutre', '',
                ex[0] if ex else '', ex[1] if len(ex) > 1 else '', '')

    # Si le minimum de 300 lignes n'est pas atteint : seuil de documents abaissé à 3.
    if len(lignes) < 300:
        for n in (1, 2, 3):
            for cle, e in ngrammes[n].items():
                if len(lignes) >= 300:
                    break
                if len(e['docs']) < 3 or len(e['docs']) >= 5:
                    continue
                if cle in MOTS_COURANTS[langue]:
                    continue
                surface = surface_dominante(e['surface'])
                cat = categoriser(surface, langue)
                ex = e['exemples']
                ajouter(surface, cat, surface, [], e['freq'], len(e['docs']), '', 'neutre',
                        '', ex[0] if ex else '', ex[1] if len(ex) > 1 else '',
                        'repli sous 5 documents pour atteindre le budget minimal')

    return lignes


def executer_vale(vale_bin, dossier, langue):
    fichiers = sorted(str(p) for p in dossier.glob('*-corps-' + langue + '.txt'))
    if not fichiers:
        return []
    resultats = []
    LOT = 60
    for i in range(0, len(fichiers), LOT):
        lot = fichiers[i:i + LOT]
        r = subprocess.run([vale_bin, '--output=JSON', '--config', str(VALE_INI)] + lot,
                            capture_output=True, timeout=180)
        if not r.stdout.strip():
            continue
        try:
            data = json.loads(r.stdout.decode('utf-8', 'replace'))
        except json.JSONDecodeError:
            continue
        resultats.append(data)
    return resultats


def agreger_vale(resultats_par_fichier):
    """resultats_par_fichier : liste de dicts {fichier: [alertes]} (sorties JSON brutes de
    vale, un dict par lot). Rend {regle: {'alertes': int, 'docs': set, 'exemples': [...]}}"""
    agg = defaultdict(lambda: {'alertes': 0, 'docs': set(), 'exemples': []})
    for lot in resultats_par_fichier:
        for fichier, alertes in lot.items():
            article_id = Path(fichier).name.split('-corps-')[0]
            for a in alertes:
                regle = a.get('Check', a.get('Rule', '?'))
                e = agg[regle]
                e['alertes'] += 1
                e['docs'].add(article_id)
                if len(e['exemples']) < 5:
                    e['exemples'].append({
                        'article': article_id, 'match': a.get('Match', ''),
                        'message': a.get('Message', ''),
                    })
    return agg


def regrouper_sigle_pour_bilan(agg):
    """Cumule les règles Vale par sigle (`CSPS.Lexique.Sigle-CUA`…) sous une clé
    `<Style>.Lexique.Sigle`, documents réunis (un document compte une fois). Le détail par
    sigle reste dans vale-faux-positifs-<langue>.csv."""
    fusion = defaultdict(lambda: {'alertes': 0, 'docs': set()})
    reste = {}
    for regle, e in agg.items():
        m = re.match(r'^(\w+)\.Lexique\.Sigle-', regle)
        if m:
            cle = m.group(1) + '.Lexique.Sigle'
            fusion[cle]['alertes'] += e['alertes']
            fusion[cle]['docs'] |= e['docs']
        else:
            reste[regle] = e
    sortie = {regle: {'alertes': e['alertes'], 'documents': len(e['docs'])}
              for regle, e in reste.items()}
    for cle, e in fusion.items():
        sortie[cle] = {'alertes': e['alertes'], 'documents': len(e['docs'])}
    return sortie


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--corpus', default=str(CORPUS_DEFAUT))
    ap.add_argument('--sortie', default=str(SORTIE_DEFAUT))
    ap.add_argument('--pandoc', default='pandoc')
    ap.add_argument('--vale-bin', default=VALE_BIN_DEFAUT)
    ap.add_argument('--sans-vale', action='store_true', help='saute le passage Vale (item 6)')
    ap.add_argument('--limite', type=int, default=0, help='0 = tout le corpus')
    args = ap.parse_args()

    corpus = Path(args.corpus)
    sortie = Path(args.sortie)
    sortie.mkdir(parents=True, exist_ok=True)
    vale_corpus_dir = sortie / 'vale-corpus'
    vale_corpus_dir.mkdir(parents=True, exist_ok=True)

    inventaire = lire_inventaire(corpus / 'inventaire.csv')
    par_langue = defaultdict(list)
    for row in inventaire:
        par_langue[row['langue']].append(row)

    n_it = len(par_langue.get('it', []))
    print('italien ignoré (hors périmètre) : {} article(s)'.format(n_it), file=sys.stderr)

    regles_swap = {
        'fr': lire_swap_yaml(RACINE / 'pipeline' / 'vale' / 'styles' / 'CSPS' / 'Vocabulaire' / 'Handicap.yml'),
        'de': lire_swap_yaml(RACINE / 'pipeline' / 'vale' / 'styles' / 'SZH' / 'Vokabular' / 'Behinderung.yml'),
    }

    bilan = {}
    for langue in LANGUES:
        lignes = par_langue.get(langue, [])
        if args.limite:
            lignes = lignes[:args.limite]
        corps_paragraphes_id = []
        diag_compte = Counter()
        n_ok, n_erreurs = 0, 0
        for row in lignes:
            chemin = corpus / row['fichier']
            article_id = row['article_id']
            if not chemin.exists():
                n_erreurs += 1
                continue
            try:
                texte = extraire_texte(chemin, args.pandoc)
            except (RuntimeError, subprocess.TimeoutExpired) as e:
                print('échec pandoc {} : {}'.format(article_id, e), file=sys.stderr)
                n_erreurs += 1
                continue
            paragraphes = decouper_paragraphes(texte)
            corps, diag = ecarter_entete_et_biblio(paragraphes)
            diag_compte['entete_' + diag['entete']] += 1
            diag_compte['biblio_' + diag['biblio']] += 1
            corps_paragraphes_id.append((article_id, corps))
            n_ok += 1
            if not args.sans_vale:
                nom = re.sub(r'[^A-Za-z0-9_-]', '_', article_id)
                (vale_corpus_dir / (nom + '-corps-' + langue + '.txt')).write_text(
                    '\n'.join(p.replace('\n', ' ') for p in corps) + '\n', encoding='utf-8')

        n_tokens = sum(len(tokeniser(p)) for _, ps in corps_paragraphes_id for p in ps)
        print('{} : {} documents lus, {} en échec, {} tokens'.format(
            langue, n_ok, n_erreurs, n_tokens), file=sys.stderr)

        ngrammes = construire_ngrammes(corps_paragraphes_id, STOPWORDS[langue])
        sigles_occ, sigles_dev, dev_docs = extraire_sigles_et_developpements(corps_paragraphes_id)
        variantes = grouper_variantes(ngrammes[1])
        vocab_handicap = mesurer_vocabulaire_handicap(corps_paragraphes_id, langue, regles_swap[langue])

        # brouillons (informationnels, hors git)
        for n in (1, 2, 3):
            top = sorted(ngrammes[n].items(), key=lambda kv: -kv[1]['freq'])[:2000]
            ecrire_csv(sortie / 'frequences-{}-{}gr.csv'.format(langue, n),
                       ['terme', 'frequence', 'documents', 'exemple_1', 'exemple_2'],
                       [[surface_dominante(e['surface']), e['freq'], len(e['docs']),
                         e['exemples'][0] if e['exemples'] else '',
                         e['exemples'][1] if len(e['exemples']) > 1 else '']
                        for _, e in top])

        ecrire_csv(sortie / 'sigles-{}.csv'.format(langue),
                   ['sigle', 'frequence', 'documents', 'documents_developpe', 'developpement'],
                   [[s, c['freq'], len(c['docs']), len(dev_docs.get(s, ())),
                     sigles_dev[s].most_common(1)[0][0] if sigles_dev.get(s) else '']
                    for s, c in sorted(sigles_occ.items(), key=lambda kv: -kv[1]['freq'])])

        ecrire_csv(sortie / 'variantes-{}.csv'.format(langue),
                   ['forme_privilegiee', 'variantes', 'frequence', 'documents'],
                   [[g['forme_privilegiee'], '|'.join(g['variantes']), g['frequence'], g['documents']]
                    for g in variantes])

        (sortie / 'handicap-{}.json'.format(langue)).write_text(
            json.dumps(vocab_handicap, ensure_ascii=False, indent=2), encoding='utf-8')

        candidats = construire_candidats(ngrammes, sigles_occ, sigles_dev, dev_docs, variantes,
                                          vocab_handicap, langue)
        ecrire_csv(sortie / 'candidat-lexique-{}.csv'.format(langue),
                   ['terme', 'categorie', 'forme_privilegiee', 'variantes', 'frequence',
                    'documents', 'sigle_developpement', 'statut', 'source_normative',
                    'exemple_1', 'exemple_2', 'note', 'exiger_developpement'],
                   candidats)

        bilan[langue] = {
            'documents': n_ok, 'echecs': n_erreurs, 'tokens': n_tokens,
            'diagnostic_entete_biblio': dict(diag_compte),
            'sigles_jamais_developpes': sorted(
                s for s in sigles_occ if not sigles_dev.get(s) and sigles_occ[s]['freq'] >= 2),
            'lignes_candidates': len(candidats),
        }

        if not args.sans_vale:
            resultats = executer_vale(args.vale_bin, vale_corpus_dir, langue)
            agg = agreger_vale(resultats)
            ecrire_csv(sortie / 'vale-faux-positifs-{}.csv'.format(langue),
                       ['regle', 'alertes', 'documents', 'exemples_json'],
                       [[regle, e['alertes'], len(e['docs']), json.dumps(e['exemples'], ensure_ascii=False)]
                        for regle, e in sorted(agg.items(), key=lambda kv: -kv[1]['alertes'])])
            bilan[langue]['vale_regles_touchees'] = regrouper_sigle_pour_bilan(agg)

    (sortie / 'bilan.json').write_text(json.dumps(bilan, ensure_ascii=False, indent=2),
                                        encoding='utf-8')
    print(json.dumps(bilan, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
