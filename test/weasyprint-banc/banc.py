"""Banc de non-régression des correctifs WeasyPrint.

Rend les cas de cas/ avec les correctifs de la production et avec tous ceux du dépôt, compare
veraPDF, pixels, arbre de structure, texte extrait, liens et métadonnées, vérifie les
invariants de cas/cas.toml, et désigne le correctif responsable de chaque changement.

    python3 test/weasyprint-banc/banc.py --mode rapide|complet [--paires] [--cas motif]

Dans la WSL ou en CI, jamais sous Windows. Le rapport est écrit dans <travail>/BANC.md et
<travail>/BANC.html (par défaut tmp/banc/). Codes de sortie : 0 aucune régression ni
invariant en échec hors des limites admises, 1 sinon, 2 panne d'outillage.

Piles de correctifs :
  production    les correctifs de la dernière version publiée, lus par git dans origin/main
                (sinon le dernier tag, sinon HEAD) ; --production les impose ;
  toutes        les .patch du dossier image/patches/weasyprint-<version>/ ;
  toutes-X      toutes sauf X : si le cas change, X est désigné ;
  toutes-X-Y    toutes sauf X et Y, avec --paires, quand aucun retrait seul n'explique ;
  vierge, production+N : en mode complet, pour la matrice des verdicts.
Mode rapide : production et toutes, puis le retrait de chaque correctif nouveau ou modifié
sur les seuls cas qui changent. Mode complet : toutes les piles, sur tous les cas.

Une pile est le paquet weasyprint du venv du banc recopié et patché dans
<travail>/piles/<clé>/, importé par PYTHONPATH. Venvs, piles, rendus et mesures sont
réutilisés tant que leurs sources ne changent pas.
"""
import argparse
import difflib
import fnmatch
import functools
import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys
import time
import tomllib
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(os.path.dirname(ICI))
# Même version que outils-dev/venv-dev.sh (test/js/weasyprint-banc.test.js le vérifie).
PYPDFIUM = 'pypdfium2==5.13.0'
VARIANTES_BALISEES = ('ua1', 'tags')
JETON = re.compile(r'(?<![0-9A-Za-z])Q\d\d(?!\d)')
METRIQUES = {
    'E': 'exception', 'V': 'veraPDF', 'P': 'pixels', 'A': 'arbre', 'T': 'texte',
    'L': 'liens', 'M': 'métadonnées', 'J': 'journal', 'I': 'invariants',
    'F': 'flux de contenu',
}
SCRIPTS_MESURE = [os.path.join(ICI, 'mesurer.py'), os.path.join(ICI, 'pixels.py')]


class Panne(Exception):
    """Panne d'outillage : le banc ne peut pas rendre de verdict (code 2)."""


class NeSAppliquePas(Exception):
    pass


def lancer(cmd, **kw):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, **kw)
    except OSError as e:
        raise Panne(f'{cmd[0]} : {e}') from e


def env_pile(pile=None):
    env = {k: v for k, v in os.environ.items() if k != 'PYTHONPATH'}
    if pile:
        env['PYTHONPATH'] = pile
    return env


def numero(chemin):
    return os.path.basename(chemin).split('-')[0]


# ── Version, correctifs et production ─────────────────────────────────────────────

def version_epinglee():
    with open(os.path.join(RACINE, 'image', 'requirements.txt'), encoding='utf-8') as f:
        m = re.search(r'^weasyprint==(\S+)\s*$', f.read(), re.M)
    if not m:
        raise Panne('weasyprint==<version> introuvable dans image/requirements.txt')
    return m.group(1)


def correctifs_locaux(dossier, suffixe='.patch'):
    """{numéro: chemin} des fichiers du dossier qui finissent par `suffixe` : les .patch
    actifs, ou les .patch.off désactivés."""
    if not os.path.isdir(dossier):
        raise Panne(f'{os.path.relpath(dossier, RACINE)} absent : aucun correctif pour '
                    'cette version de WeasyPrint')
    return {numero(f): os.path.join(dossier, f)
            for f in sorted(os.listdir(dossier)) if f.endswith(suffixe)}


@functools.cache
def trouver_git():
    """git du système, sinon celui de Windows : la WSL des postes n'a pas git, mais lance
    git.exe par l'interopérabilité. SZH_GIT en désigne un autre."""
    for g in (os.environ.get('SZH_GIT'), 'git', '/mnt/c/Program Files/Git/cmd/git.exe'):
        if g and shutil.which(g):
            return g
    raise Panne('git introuvable (variable SZH_GIT)')


def git_brut(*args):
    """Sortie binaire de git lancé dans le dépôt, ou None s'il échoue. Le dossier courant
    plutôt que -C : git.exe ne lit pas un chemin /mnt/c, mais l'interopérabilité de la WSL
    traduit le dossier courant."""
    r = subprocess.run([trouver_git(), *args], cwd=RACINE, capture_output=True)
    return r.stdout if r.returncode == 0 else None


def git(*args):
    sortie = git_brut(*args)
    return None if sortie is None else sortie.decode('utf-8', 'replace')


def reference_production():
    """Première référence git qui existe : origin/main, puis le dernier tag, puis HEAD."""
    tag = (git('describe', '--tags', '--abbrev=0') or '').strip()
    for ref in ('origin/main', tag, 'HEAD'):
        if ref and git('rev-parse', '--verify', '--quiet', ref + '^{commit}'):
            return ref
    raise Panne('aucune référence git lisible (ni origin/main, ni tag, ni HEAD)')


def correctifs_production(arg, version, dossier, locaux, travail):
    """({numéro: chemin}, description) des correctifs de la production.

    `arg` vaut une liste de numéros, pris dans le dossier local parmi les .patch puis les
    .patch.off, ou une référence git, dont les .patch sont extraits dans
    <travail>/production/."""
    if arg and re.fullmatch(r'\d+(,\d+)*', arg):
        connus = {**correctifs_locaux(dossier, '.patch.off'), **locaux}
        inconnus = [n for n in arg.split(',') if n not in connus]
        if inconnus:
            raise Panne(f'--production : correctif(s) absent(s) du dossier : {", ".join(inconnus)}')
        return {n: connus[n] for n in arg.split(',')}, f'liste {arg}'
    ref = arg or reference_production()
    sha = (git('rev-parse', '--short', ref + '^{commit}') or '').strip()
    if not sha:
        raise Panne(f'--production : référence git inconnue : {ref}')
    rel = f'image/patches/weasyprint-{version}'
    noms = [os.path.basename(n) for n in (git('ls-tree', '--name-only', ref, rel + '/') or '')
            .splitlines() if n.endswith('.patch')]
    dossier = os.path.join(travail, 'production', sha)
    os.makedirs(dossier, exist_ok=True)
    sortie = {}
    for nom in noms:
        contenu = git_brut('show', f'{ref}:{rel}/{nom}')
        if contenu is None:
            raise Panne(f'git show {ref}:{rel}/{nom} a échoué')
        chemin = os.path.join(dossier, nom)
        with open(chemin, 'wb') as f:
            f.write(contenu)
        sortie[numero(nom)] = chemin
    desc = f'{ref} ({sha})'
    if not noms:
        desc += f', sans dossier weasyprint-{version} : la production est WeasyPrint vierge'
    return sortie, desc


def lire_octets(chemin):
    with open(chemin, 'rb') as f:
        return f.read()


def corps_patch(chemin):
    """Le diff d'un correctif, sans son en-tête de texte libre : un en-tête réécrit ne
    change ni la pile ni le comportement."""
    octets = lire_octets(chemin)
    m = re.search(rb'^(diff |--- )', octets, re.M)
    return octets[m.start():] if m else octets


# ── Venv et piles ─────────────────────────────────────────────────────────────────

def preparer_python(args):
    """Python d'un venv sans correctif : WeasyPrint et pypdf d'image/requirements.txt,
    plus pypdfium2. Créé une fois dans <travail>/venvs/<empreinte>/."""
    if args.python:
        return args.python
    req = os.path.join(RACINE, 'image', 'requirements.txt')
    cle = hashlib.sha1(lire_octets(req) + PYPDFIUM.encode() +
                       sys.version.encode()).hexdigest()[:12]
    venv = os.path.join(args.travail, 'venvs', cle)
    python = os.path.join(venv, 'bin', 'python')
    if not os.path.exists(os.path.join(venv, '.pret')):
        print(f'banc : création du venv {os.path.relpath(venv, RACINE)}', flush=True)
        shutil.rmtree(venv, ignore_errors=True)
        for cmd in ([sys.executable, '-m', 'venv', venv],
                    [python, '-m', 'pip', 'install', '--quiet', '--disable-pip-version-check',
                     '-r', req, PYPDFIUM]):
            r = lancer(cmd)
            if r.returncode:
                raise Panne(f'venv du banc : {" ".join(cmd[:4])} a échoué\n{r.stdout}{r.stderr}')
        open(os.path.join(venv, '.pret'), 'w').close()
    return python


class Piles:
    def __init__(self, python, travail):
        r = lancer([python, '-c', 'import weasyprint, os; print(weasyprint.__version__); '
                    'print(os.path.dirname(weasyprint.__file__))'], env=env_pile())
        if r.returncode:
            raise Panne(f'{python} n\'importe pas weasyprint\n{r.stderr}')
        self.version, self.source = r.stdout.split()
        if os.path.exists(os.path.join(self.source, 'szh-patchs.txt')):
            raise Panne(f'{self.source} porte déjà des correctifs : il faut un WeasyPrint vierge')
        self.empreinte_source = hashlib.sha1(
            (self.version + self.source).encode()).hexdigest()
        self.dossier = os.path.join(travail, 'piles')
        self.piles = {}

    def construire(self, nom, chemins):
        """Pile `nom` faite des correctifs `chemins`, appliqués dans l'ordre de leur nom."""
        chemins = sorted(chemins, key=os.path.basename)
        h = hashlib.sha1(self.empreinte_source.encode())
        for c in chemins:
            h.update(os.path.basename(c).encode())
            h.update(corps_patch(c))
        cle = h.hexdigest()[:12]
        dossier = os.path.join(self.dossier, cle)
        if not os.path.exists(os.path.join(dossier, 'pile.json')):
            shutil.rmtree(dossier, ignore_errors=True)
            shutil.copytree(self.source, os.path.join(dossier, 'weasyprint'),
                            ignore=shutil.ignore_patterns('__pycache__'))
            for c in chemins:
                r = lancer(['patch', '-s', '-p1', '--forward', '--batch', '--fuzz=0',
                            '--no-backup-if-mismatch', '-i', c], cwd=dossier)
                if r.returncode:
                    shutil.rmtree(dossier, ignore_errors=True)
                    raise NeSAppliquePas(
                        f'pile {nom} : {os.path.basename(c)} ne s\'applique pas sur WeasyPrint '
                        f'{self.version} (--fuzz=0)\n{r.stdout}{r.stderr}')
            with open(os.path.join(dossier, 'weasyprint', 'szh-patchs.txt'), 'w') as f:
                f.write(''.join(os.path.basename(c) + '\n' for c in chemins))
            with open(os.path.join(dossier, 'pile.json'), 'w') as f:
                json.dump({'correctifs': [os.path.basename(c) for c in chemins]}, f)
        pile = {'nom': nom, 'numeros': [numero(c) for c in chemins], 'cle': cle,
                'dossier': dossier}
        self.piles[nom] = pile
        return pile


# ── Cas ───────────────────────────────────────────────────────────────────────────

class Texte(HTMLParser):
    """Jetons du texte visible d'un HTML (ni attributs, ni <title>, <style>, <script>)."""
    def __init__(self):
        super().__init__()
        self.jetons, self.ignore = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('title', 'style', 'script'):
            self.ignore += 1

    def handle_endtag(self, tag):
        if tag in ('title', 'style', 'script'):
            self.ignore -= 1

    def handle_data(self, data):
        if not self.ignore:
            self.jetons += JETON.findall(data)


def lire_cas(dossier, motifs):
    """{nom: spécification} des cas retenus par les motifs (préfixe ou glob)."""
    try:
        with open(os.path.join(dossier, 'cas.toml'), 'rb') as f:
            spec = tomllib.load(f)
    except (OSError, tomllib.TOMLDecodeError) as e:
        raise Panne(f'cas.toml illisible : {e}') from e
    commun = b''.join(lire_octets(os.path.join(dossier, f))
                      for f in sorted(os.listdir(dossier)) if f.endswith('.css'))
    commun += lire_octets(os.path.join(ICI, 'rendre.py'))
    cas = {}
    for f in sorted(os.listdir(dossier)):
        if not f.endswith('.html'):
            continue
        nom = f[:-5]
        if motifs and not any(nom.startswith(m) or fnmatch.fnmatch(nom, m) for m in motifs):
            continue
        source = lire_octets(os.path.join(dossier, f))
        t = Texte()
        t.feed(source.decode('utf-8'))
        cas[nom] = dict(spec.get(nom, {}))
        cas[nom]['jetons'] = t.jetons
        cas[nom]['empreinte_source'] = hashlib.sha1(source + commun).hexdigest()
    if not cas:
        raise Panne(f'aucun cas retenu dans {dossier}')
    return cas


# ── Rendu et mesures ──────────────────────────────────────────────────────────────

def rendre(args, pile, cas, variantes):
    sortie = os.path.join(args.travail, 'rendus', pile['cle'])
    os.makedirs(sortie, exist_ok=True)
    a_faire = []
    for nom, c in cas.items():
        for v in variantes:
            try:
                with open(os.path.join(sortie, f'{nom}.{v}.json')) as f:
                    if json.load(f).get('source') == c['empreinte_source']:
                        continue
            except (OSError, ValueError):
                pass
            a_faire.append((nom, v))
    noms = sorted({n for n, _ in a_faire})
    if noms:
        vs = sorted({v for _, v in a_faire})
        r = lancer([args.python, os.path.join(ICI, 'rendre.py'), args.cas, sortie, ','.join(vs),
                    *noms], env=env_pile(pile['dossier']))
        if r.returncode:
            raise Panne(f'rendre.py, pile {pile["nom"]}\n{r.stdout}{r.stderr}')
        for nom in noms:
            for v in vs:
                j = os.path.join(sortie, f'{nom}.{v}.json')
                with open(j) as f:
                    d = json.load(f)
                if not d['weasyprint'].startswith(pile['dossier']):
                    raise Panne(f'pile {pile["nom"]} : WeasyPrint importé depuis {d["weasyprint"]}')
                d['source'] = cas[nom]['empreinte_source']
                with open(j, 'w') as f:
                    json.dump(d, f, ensure_ascii=False, indent=1)
    return sortie


def verapdf(args, pdfs):
    """Écrit <pdf>.vera.json : clauses en échec (ua1 pour ua1 et tags, 3u pour a3u)."""
    par_saveur = {}
    for p in pdfs:
        if os.path.exists(p) and not p.endswith('.nu.pdf'):
            par_saveur.setdefault('3u' if p.endswith('.a3u.pdf') else 'ua1', []).append(p)
    env = dict(os.environ, JAVA_HOME=args.java)
    for saveur, liste in par_saveur.items():
        for i in range(0, len(liste), 80):
            lot = liste[i:i + 80]
            r = subprocess.run([args.verapdf, '--flavour', saveur, '--format', 'xml', *lot],
                               capture_output=True, env=env)
            try:
                racine = ET.fromstring(r.stdout)
            except ET.ParseError as e:
                raise Panne(f'veraPDF (code {r.returncode}) ne rend pas de rapport lisible\n'
                            f'{r.stderr.decode(errors="replace")[-2000:]}') from e
            vus = 0
            for job in racine.iter('job'):
                nom = job.find('item/name').text
                rapport = job.find('validationReport')
                if rapport is None:
                    raise Panne(f'veraPDF n\'a pas validé {nom}')
                echecs = sorted({f"{x.get('clause')}-{x.get('testNumber')}"
                                 for x in rapport.iter('rule') if x.get('status') == 'failed'})
                with open(nom + '.vera.json', 'w') as f:
                    json.dump({'saveur': saveur, 'echecs': echecs}, f)
                vus += 1
            if vus != len(lot):
                raise Panne(f'veraPDF a rendu {vus} verdict(s) pour {len(lot)} PDF')


def mesurer(args, pdfs):
    pdfs = [p for p in pdfs if os.path.exists(p)]
    for i in range(0, len(pdfs), 60):
        lot = pdfs[i:i + 60]
        for script in SCRIPTS_MESURE:
            r = lancer([args.python, script, *lot], env=env_pile())
            if r.returncode:
                raise Panne(f'{os.path.basename(script)}\n{r.stdout}{r.stderr}')


def perimes(pdfs, suffixe, scripts):
    """PDF dont la mesure manque, ou date d'avant le PDF ou le script de mesure."""
    sortie = []
    for p in pdfs:
        if not os.path.exists(p):
            continue
        m = p + suffixe
        ref = max([os.path.getmtime(p)] + [os.path.getmtime(s) for s in scripts])
        if not os.path.exists(m) or os.path.getmtime(m) < ref:
            sortie.append(p)
    return sortie


def passer(args, piles, cas, variantes):
    """Rend et mesure les cas avec chaque pile ; rend {nom de pile: dossier des rendus}."""
    uniques = {p['cle']: p for p in piles}
    with ThreadPoolExecutor(args.paralleles) as ex:
        dossiers = dict(zip(uniques, ex.map(lambda p: rendre(args, p, cas, variantes),
                                            uniques.values())))
    pdfs = sorted({os.path.join(d, f'{n}.{v}.pdf')
                   for d in dossiers.values() for n in cas for v in variantes})
    verapdf(args, perimes(pdfs, '.vera.json', []))
    mesurer(args, perimes(pdfs, '.mesure.json', SCRIPTS_MESURE))
    return {p['nom']: dossiers[p['cle']] for p in piles}


def charger(sortie, nom, v):
    base = os.path.join(sortie, f'{nom}.{v}')
    with open(base + '.json') as f:
        r = json.load(f)
    rec = {'exception': r['exception'], 'journal': r['journal'], 'pdf': base + '.pdf'}
    if r['exception']:
        return rec
    with open(base + '.pdf.mesure.json') as f:
        m = json.load(f)
    with open(base + '.pdf.pix.json') as f:
        px = json.load(f)
    vera = {'echecs': []}
    if os.path.exists(base + '.pdf.vera.json'):
        with open(base + '.pdf.vera.json') as f:
            vera = json.load(f)
    rec.update(mesure=m, pixels=px.get('pages', []), texte_pdfium=px.get('texte', ''),
               echec_pdfium=px.get('echec'), vera=vera['echecs'])
    return rec


# ── Invariants et empreintes ──────────────────────────────────────────────────────

def invariants(c, v, rec, pixels_autres):
    """{invariant: détail} pour chaque invariant en échec."""
    ko = {}
    if rec['exception']:
        ko['exception'] = rec['exception'].strip().splitlines()[-1]
        return ko
    m = rec['mesure']
    if 'echec_mesure' in m:
        ko['mesure'] = m['echec_mesure'].strip().splitlines()[-1]
        return ko
    if rec.get('echec_pdfium'):
        ko['pdfium'] = rec['echec_pdfium']
    if v == 'ua1':
        permis = set(c.get('vera_ua1', []))
        echecs = [e for e in rec['vera'] if e not in permis]
        if echecs:
            ko['veraPDF'] = ' '.join(echecs)
        manquants = [e for e in c.get('vera_ua1_exige', []) if e not in rec['vera']]
        if manquants:
            ko['veraPDF-echec-attendu-absent'] = ' '.join(manquants)
        alts = re.findall(r"^\s*Figure Alt='([^']*)'", m.get('arbre', ''), re.M)
        for alt, attendu in c.get('figures', {}).items():
            if attendu not in alts:
                ko[f'figure-{alt}'] = f'{alts}'
        sans_alt = len(re.findall(r'^\s*Figure$', m.get('arbre', ''), re.M))
        if sans_alt < c.get('figures_sans_alt', 0):
            ko['figure-sans-alt-masquee'] = f'{sans_alt} /Figure sans /Alt'
    # Texte extrait : chaque jeton du HTML une fois, et une seule.
    for outil, texte in (('pypdf', m.get('texte_pypdf', '')), ('pdfium', rec['texte_pdfium'])):
        compte = {}
        for j in JETON.findall(texte):
            compte[j] = compte.get(j, 0) + 1
        perdus = [j for j in c['jetons'] if j not in compte]
        doubles = [j for j, n in compte.items() if n > 1 and j not in c.get('doublons_admis', [])]
        if perdus:
            ko[f'extraction-{outil}-perte'] = ' '.join(perdus)
        if doubles:
            ko[f'extraction-{outil}-doublon'] = ' '.join(doubles)
    if v == 'ua1':
        diff = [w for w, p in pixels_autres.items() if p and p != rec['pixels']]
        if diff:
            ko['pixels-variantes'] = 'ua1 ≠ ' + ' '.join(diff)
        if 'info_author' in c and m.get('info', {}).get('/Author') != c['info_author']:
            ko['info-author'] = repr(m.get('info', {}).get('/Author'))
        if 'dc_language' in c and (m.get('xmp') or {}).get('language') != c['dc_language']:
            ko['dc-language'] = repr((m.get('xmp') or {}).get('language'))
        if m.get('xmp') and m['xmp'].get('rdf', 1) != 1:
            ko['xmp-rdf-multiple'] = str(m['xmp']['rdf'])
    if v not in VARIANTES_BALISEES:
        return ko
    for k, detail in m['erreurs'].items():
        if k in c.get('tolere', []):
            continue
        ko[f'arbre-{k}'] = '; '.join(map(str, detail[:4])) + (' …' if len(detail) > 4 else '')
    arbre = JETON.findall(m['texte_arbre'])
    for i, ordre in enumerate(c.get('ordres', []), 1):
        vu = [j for j in arbre if j in ordre]
        if vu != ordre:
            ko[f'ordre-{i}'] = ' '.join(vu)
    perdus = [j for j in c.get('dans_arbre', c['jetons']) if j not in arbre]
    if perdus:
        ko['arbre-perte'] = ' '.join(perdus)
    for j, lang in c.get('langues', {}).items():
        obtenu = m['jetons_chemin'].get(j, (None, None))[1]
        if obtenu != lang:
            ko[f'langue-{j}'] = f'{obtenu} au lieu de {lang}'
    for j, chemin in c.get('chemins', {}).items():
        obtenu = m['jetons_chemin'].get(j, ('', None))[0]
        if not re.search(r'(^|/)' + chemin + '$', obtenu):
            ko[f'chemin-{j}'] = f'{obtenu or "absent"} au lieu de …/{chemin}'
    for cible, contents in m['liens']:
        if not contents.strip():
            ko['lien-sans-contents'] = cible
    for cible, attendu in c.get('liens', {}).items():
        obtenus = [ct for cb, ct in m['liens'] if cb == cible]
        if attendu not in obtenus:
            ko[f'lien-{cible}'] = f'{obtenus} au lieu de {attendu!r}'
    return ko


def empreinte(rec):
    """Ce qui se compare d'une pile à l'autre, par métrique."""
    if rec['exception']:
        return {'E': rec['exception'].strip().splitlines()[-1]}
    m = rec['mesure']
    return {
        'E': None,
        'V': ' '.join(rec['vera']),
        'P': ' '.join(rec['pixels']),
        'A': m.get('arbre', ''),
        'T': '\n'.join((m.get('texte_arbre', ''), m.get('texte_pypdf', ''),
                        rec['texte_pdfium'])),
        'L': json.dumps(m.get('liens', []), ensure_ascii=False),
        'M': json.dumps([m.get('info'), m.get('xmp'), m.get('lang')], ensure_ascii=False),
        'J': '\n'.join(rec['journal']),
        'I': json.dumps(sorted(rec['invariants']), ensure_ascii=False),
        'F': ' '.join(m.get('flux', [])),
    }


def differences(e1, e2):
    return ''.join(k for k in METRIQUES if e1.get(k) != e2.get(k))


def resultats(dossier, cas, variantes):
    res = {}
    for nom, c in cas.items():
        recs = {v: charger(dossier, nom, v) for v in variantes}
        pix = {v: r.get('pixels') for v, r in recs.items() if v != 'ua1'}
        for v, r in recs.items():
            r['invariants'] = invariants(c, v, r, pix)
            res[(nom, v)] = r
    return res


# ── Programme ─────────────────────────────────────────────────────────────────────

def arguments():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('--mode', choices=('rapide', 'complet'), default='rapide')
    ap.add_argument('--paires', action='store_true',
                    help='retirer les correctifs deux à deux quand aucun retrait seul n\'explique')
    ap.add_argument('--cas', dest='motifs', default='',
                    help='cas retenus : préfixes ou globs séparés par des virgules')
    ap.add_argument('--production', default='',
                    help='référence git, ou numéros séparés par des virgules')
    ap.add_argument('--travail', default=os.path.join(RACINE, 'tmp', 'banc'))
    ap.add_argument('--python', default='',
                    help='Python d\'un venv WeasyPrint sans correctif, avec pypdf et pypdfium2')
    ap.add_argument('--variantes', default='ua1,tags,nu,a3u')
    ap.add_argument('--verapdf', default=os.environ.get('VERAPDF', '/opt/verapdf-cli/verapdf'))
    ap.add_argument('--java', default=os.environ.get('VERAPDF_JAVA', '/opt/jre-min'))
    ap.add_argument('--paralleles', type=int, default=max(2, os.cpu_count() or 2))
    args = ap.parse_args()
    args.cas = os.path.join(ICI, 'cas')
    args.travail = os.path.abspath(args.travail)
    return args


def main():
    args = arguments()
    debut = time.monotonic()
    os.makedirs(args.travail, exist_ok=True)
    if not os.access(args.verapdf, os.X_OK):
        raise Panne(f'veraPDF introuvable : {args.verapdf} (variable VERAPDF)')

    version = version_epinglee()
    dossier_patchs = os.path.join(RACINE, 'image', 'patches', f'weasyprint-{version}')
    locaux = correctifs_locaux(dossier_patchs)
    prod, desc_prod = correctifs_production(args.production, version, dossier_patchs, locaux,
                                            args.travail)
    tous = sorted(locaux, key=lambda n: os.path.basename(locaux[n]))
    nouveaux = [n for n in tous if n not in prod]
    modifies = [n for n in tous if n in prod and corps_patch(prod[n]) != corps_patch(locaux[n])]
    retires = sorted(n for n in prod if n not in locaux)
    changes = [n for n in tous if n in nouveaux or n in modifies]

    args.python = preparer_python(args)
    piles_ = Piles(args.python, args.travail)
    if piles_.version != version:
        raise Panne(f'le venv a WeasyPrint {piles_.version}, image/requirements.txt {version}')
    variantes = args.variantes.split(',')
    cas = lire_cas(args.cas, [m for m in args.motifs.split(',') if m])

    def construire(nom, chemins, obligatoire=False):
        try:
            return piles_.construire(nom, chemins)
        except NeSAppliquePas as e:
            if obligatoire:
                raise Panne(str(e)) from e
            sautees.append(str(e).splitlines()[0])
            return None

    sautees = []
    base = [construire('production', prod.values(), True),
            construire('toutes', locaux.values(), True)]
    if args.mode == 'complet':
        base.insert(0, construire('vierge', [], True))
        for n in changes:
            p = construire(f'production+{n}', {**prod, n: locaux[n]}.values())
            if p:
                base.append(p)
    t0 = time.monotonic()
    dossiers = passer(args, base, cas, variantes)
    R = {p['nom']: resultats(dossiers[p['nom']], cas, variantes) for p in base}
    E = {pn: {k: empreinte(r) for k, r in res.items()} for pn, res in R.items()}
    ecarts = {k: d for k in E['toutes'] if (d := differences(E['production'][k], E['toutes'][k]))}

    # Attribution. Chaque correctif de la pile complète est retiré (pile toutes-X), chaque
    # correctif retiré depuis la production est remis (pile toutes+X). Mode complet : sur
    # tous les cas. Mode rapide : les correctifs changés depuis la production sur les cas
    # qui changent, et tous sur les cas dont un invariant non admis échoue.
    if args.mode == 'complet':
        plan = {x: set(cas) for x in tous + retires}
    else:
        en_echec = {k[0] for k, r in R['toutes'].items()
                    if any(i not in connus_de(cas, k) for i in r['invariants'])}
        changent = {k[0] for k in ecarts}
        plan = {x: (changent if x in changes + retires else set()) | en_echec
                for x in tous + retires}
    groupes = {}
    for x in tous + retires:
        if not plan[x]:
            continue
        if x in locaux:
            p = construire(f'toutes-{x}', [locaux[n] for n in tous if n != x])
        else:
            p = construire(f'toutes+{x}', [*locaux.values(), prod[x]])
        if p:
            groupes.setdefault(frozenset(plan[x]), []).append(p)
    retraits = [p for liste in groupes.values() for p in liste]
    for noms, liste in groupes.items():
        sous_cas = {n: cas[n] for n in sorted(noms)}
        d = passer(args, liste, sous_cas, variantes)
        for p in liste:
            R[p['nom']] = resultats(d[p['nom']], sous_cas, variantes)
            E[p['nom']] = {k: empreinte(r) for k, r in R[p['nom']].items()}
    retraits.sort(key=lambda p: (tous + retires).index(p['nom'][7:]))
    attribution = {}
    for p in retraits:
        x = p['nom'][7:] if p['nom'][6] == '-' else '+' + p['nom'][7:]
        for k, e in E[p['nom']].items():
            if dd := differences(E['toutes'][k], e):
                attribution.setdefault(k, {})[x] = dd

    regressions = trouver_regressions(R, cas, base)
    if args.paires:
        orphelins = {k for k in ecarts if not attribution.get(k)}
        orphelins |= {k for k, pn, inv, _ in regressions if not coupables(R, k, inv, tous)}
        noms = sorted({k[0] for k in orphelins})
        candidats = changes if args.mode == 'rapide' and len(changes) >= 2 else tous
        paires = []
        if noms:
            for i, x in enumerate(candidats):
                for y in candidats[i + 1:]:
                    p = construire(f'toutes-{x}-{y}',
                                   [locaux[n] for n in tous if n not in (x, y)])
                    if p:
                        paires.append(p)
        if paires:
            sous_cas = {n: cas[n] for n in noms}
            d = passer(args, paires, sous_cas, variantes)
            for p in paires:
                R[p['nom']] = resultats(d[p['nom']], sous_cas, variantes)
                E[p['nom']] = {k: empreinte(r) for k, r in R[p['nom']].items()}
                xy = p['nom'].split('-', 1)[1].replace('-', '+')
                for k in orphelins:
                    if k in E[p['nom']] and (dd := differences(E['toutes'][k], E[p['nom']][k])):
                        attribution.setdefault(k, {})[xy] = dd
    t_rendu = time.monotonic() - t0

    contexte = {
        'version': version, 'mode': args.mode, 'production': desc_prod,
        'prod': sorted(prod, key=lambda n: os.path.basename(prod[n])), 'tous': tous,
        'nouveaux': nouveaux, 'modifies': modifies, 'retires': retires,
        'variantes': variantes, 'piles': list(R), 'sautees': sautees,
        'duree': time.monotonic() - debut, 'duree_rendu': t_rendu,
        'colonnes': [(p['nom'][6:].lstrip('-'), p['nom']) for p in retraits],
    }
    with open(os.path.join(args.travail, 'piles.json'), 'w') as f:
        json.dump({pn: {'cle': p['cle'], 'numeros': p['numeros']}
                   for pn, p in piles_.piles.items()}, f, indent=1)
    with open(os.path.join(args.travail, 'invariants.json'), 'w', encoding='utf-8') as f:
        json.dump({pn: {f'{k[0]}.{k[1]}': r['invariants'] for k, r in res.items()}
                   for pn, res in R.items()}, f, ensure_ascii=False, indent=1)
    bilan = analyser(R, E, cas, ecarts, attribution, regressions, tous)
    rapport = Rapport()
    ecrire_rapport(rapport, contexte, cas, R, E, ecarts, attribution, bilan)
    with open(os.path.join(args.travail, 'BANC.md'), 'w', encoding='utf-8') as f:
        f.write(rapport.markdown())
    with open(os.path.join(args.travail, 'BANC.html'), 'w', encoding='utf-8') as f:
        f.write(rapport.html(f'Banc WeasyPrint {version}'))
    print(f'banc : {bilan["resume"]} ; {contexte["duree"]:.0f} s ; '
          f'{os.path.join(args.travail, "BANC.html")}')
    for k, pn, inv, _ in bilan['regressions_non_admises']:
        print(f'banc : régression {k[0]} {k[1]} {inv} ({pn}) : correctif '
              f'{", ".join(coupables(R, k, inv, tous)) or "non désigné"}')
    for k, inv, _ in bilan['ko_toutes']:
        print(f'banc : en échec {k[0]} {k[1]} {inv} : retrait qui répare '
              f'{", ".join(coupables(R, k, inv, tous)) or "aucun"}')
    return 1 if bilan['echec'] else 0


def trouver_regressions(R, cas, base):
    """(clé, pile, invariant, détail) : invariant tenu en production, cassé dans une pile
    qui ajoute des correctifs (toutes, production+N)."""
    sortie = []
    for p in base:
        pn = p['nom']
        if pn not in ('toutes',) and not pn.startswith('production+'):
            continue
        for k, r in R[pn].items():
            avant = R['production'][k]['invariants']
            for inv, detail in r['invariants'].items():
                if inv not in avant:
                    sortie.append((k, pn, inv, detail))
    return sortie


def coupables(R, k, inv, tous):
    """Correctifs dont le retrait fait tenir l'invariant, dont l'ajout le casse, ou, pour
    un correctif retiré depuis la production, dont le retour le fait tenir ; à défaut, les
    paires dont le retrait le fait tenir."""
    noms = []
    casse = inv in R['toutes'][k]['invariants']
    for pn, res in R.items():
        m = re.fullmatch(r'toutes\+(\d+)', pn)
        if m and casse and k in res and inv not in res[k]['invariants']:
            noms.append(f'{m.group(1)} (retiré)')
    for x in tous:
        rx = R.get(f'toutes-{x}', {}).get(k)
        if rx is not None and casse and inv not in rx['invariants']:
            noms.append(x)
        ry = R.get(f'production+{x}', {}).get(k)
        if ry is not None and inv in ry['invariants'] and \
                inv not in R['production'][k]['invariants'] and x not in noms:
            noms.append(x)
    if not noms:
        for pn, res in R.items():
            m = re.fullmatch(r'toutes-(\d+)-(\d+)', pn)
            if m and k in res and inv not in res[k]['invariants'] and \
                    inv in R['toutes'][k]['invariants']:
                noms.append(f'{m.group(1)}+{m.group(2)}')
    return noms


def connus_de(cas, k):
    return cas[k[0]].get('connus', {}).get(k[1], [])


def analyser(R, E, cas, ecarts, attribution, regressions, tous):
    admises = [r for r in regressions if r[2] in connus_de(cas, r[0])]
    non_admises = [r for r in regressions if r[2] not in connus_de(cas, r[0])]
    deja = {(k, inv) for k, pn, inv, _ in regressions if pn == 'toutes'}
    ko_toutes = [(k, inv, d) for k, r in R['toutes'].items() for inv, d in r['invariants'].items()
                 if inv not in connus_de(cas, k) and (k, inv) not in deja]
    connus = [(k, inv, d) for k, r in R['toutes'].items() for inv, d in r['invariants'].items()
              if inv in connus_de(cas, k)]
    tenus = [(k, inv) for k in R['toutes'] for inv in connus_de(cas, k)
             if inv not in R['toutes'][k]['invariants']]
    repares = [(k, inv) for k, r in R['production'].items()
               for inv in r['invariants'] if inv not in R['toutes'][k]['invariants']]
    echec = bool(non_admises or ko_toutes)
    resume = (f'{"ÉCHEC" if echec else "OK"} : {len(non_admises)} régression(s), '
              f'{len(ko_toutes)} autre(s) invariant(s) en échec avec tous les correctifs, '
              f'{len(ecarts)} rendu(s) changé(s), {len(repares)} invariant(s) réparé(s)')
    return {'regressions_non_admises': non_admises, 'regressions_admises': admises,
            'ko_toutes': ko_toutes, 'connus': connus, 'tenus': tenus, 'repares': repares,
            'echec': echec, 'resume': resume}


# ── Rapport ───────────────────────────────────────────────────────────────────────

class Rapport:
    """Blocs du rapport, écrits en Markdown et en HTML autonome."""
    def __init__(self):
        self.blocs = []

    def titre(self, niveau, texte):
        self.blocs.append(('h', niveau, texte))

    def para(self, texte):
        self.blocs.append(('p', texte))

    def liste(self, items):
        self.blocs.append(('ul', items))

    def tableau(self, legende, entetes, lignes, ko=()):
        """Première colonne : en-tête de ligne. `ko` : indices des lignes à signaler."""
        self.blocs.append(('table', legende, entetes, lignes, set(ko)))

    def diff(self, resume, lignes):
        self.blocs.append(('diff', resume, lignes))

    def markdown(self):
        md = []
        for b in self.blocs:
            if b[0] == 'h':
                md += ['#' * b[1] + ' ' + b[2], '']
            elif b[0] == 'p':
                md += [b[1], '']
            elif b[0] == 'ul':
                md += [f'- {i}' for i in b[1]] + ['']
            elif b[0] == 'table':
                _, legende, entetes, lignes, _ = b
                md += [f'*{legende}*', '', '| ' + ' | '.join(entetes) + ' |',
                       '|' + '---|' * len(entetes)]
                md += ['| ' + ' | '.join(cellule_md(c) for c in l) + ' |' for l in lignes]
                md.append('')
            elif b[0] == 'diff':
                md += [f'<details><summary>{html.escape(b[1])}</summary>', '', '```diff']
                md += b[2] + ['```', '</details>', '']
        return '\n'.join(md)

    def html(self, titre):
        out = []
        for b in self.blocs:
            if b[0] == 'h':
                out.append(f'<h{b[1]}>{html.escape(b[2])}</h{b[1]}>')
            elif b[0] == 'p':
                out.append(f'<p>{html.escape(b[1])}</p>')
            elif b[0] == 'ul':
                out.append('<ul>' + ''.join(f'<li>{html.escape(i)}</li>' for i in b[1]) + '</ul>')
            elif b[0] == 'table':
                _, legende, entetes, lignes, ko = b
                t = [f'<div class="defile" role="region" tabindex="0" '
                     f'aria-label="{html.escape(legende)}"><table>',
                     f'<caption>{html.escape(legende)}</caption><thead><tr>']
                t += [f'<th scope="col">{html.escape(e)}</th>' for e in entetes]
                t.append('</tr></thead><tbody>')
                for i, ligne in enumerate(lignes):
                    cls = ' class="ko"' if i in ko else ''
                    t.append(f'<tr{cls}><th scope="row">{html.escape(str(ligne[0]))}</th>' +
                             ''.join(f'<td>{html.escape(str(c))}</td>' for c in ligne[1:]) +
                             '</tr>')
                t.append('</tbody></table></div>')
                out.append(''.join(t))
            elif b[0] == 'diff':
                lignes = []
                for l in b[2]:
                    cls = 'plus' if l.startswith('+') else 'moins' if l.startswith('-') else ''
                    lignes.append(f'<span class="{cls}">{html.escape(l)}</span>')
                out.append(f'<details><summary>{html.escape(b[1])}</summary>'
                           f'<pre>{"".join(lignes)}</pre></details>')
        return (f'<!doctype html>\n<html lang="fr"><head><meta charset="utf-8">'
                f'<meta name="viewport" content="width=device-width, initial-scale=1">'
                f'<title>{html.escape(titre)}</title><style>{CSS}</style></head>'
                f'<body><main>\n' + '\n'.join(out) + '\n</main></body></html>\n')


CSS = """
:root{--fond:#ffffff;--texte:#1b1b1b;--doux:#4a4a4a;--filet:#b8b8b8;--entete:#eeeeee;
--ko:#fbe3e3;--plus:#0b5a17;--moins:#9b1111;--code:#f5f5f5}
@media (prefers-color-scheme: dark){:root{--fond:#161616;--texte:#ececec;--doux:#c4c4c4;
--filet:#555555;--entete:#262626;--ko:#4d1f24;--plus:#8fe09a;--moins:#ff9c9c;--code:#202020}}
body{margin:0;background:var(--fond);color:var(--texte);font:15px/1.5 system-ui,sans-serif}
main{max-width:1280px;margin:0 auto;padding:16px}
h1{font-size:1.6em}h2{font-size:1.3em;margin-top:2em}h3{font-size:1.1em;margin-top:1.5em}
.defile{overflow-x:auto;margin:8px 0}
table{border-collapse:collapse;font-size:13px}
caption{text-align:left;color:var(--doux);padding:4px 0;font-style:italic}
th,td{border:1px solid var(--filet);padding:3px 7px;vertical-align:top;text-align:left}
thead th{background:var(--entete)}
tbody th{font-weight:600;white-space:nowrap}
tr.ko>*{background:var(--ko)}
details{margin:6px 0}summary{cursor:pointer}
pre{background:var(--code);padding:8px;overflow-x:auto;font-size:12px}
pre span{display:block;white-space:pre}.plus{color:var(--plus)}.moins{color:var(--moins)}
:focus-visible{outline:2px solid currentColor;outline-offset:2px}
"""


def cellule_md(c):
    return str(c).replace('|', '\\|').replace('\n', ' ')


def court(s, n=200):
    s = str(s).replace('\n', ' ')
    return s if len(s) <= n else s[:n] + ' …'


def lettres(d):
    return ', '.join(METRIQUES[c] for c in d)


def ecrire_rapport(r, ctx, cas, R, E, ecarts, attribution, bilan):
    tous = ctx['tous']
    r.titre(1, f'Banc des correctifs WeasyPrint {ctx["version"]}')
    r.para(bilan['resume'] + '.')
    infos = [
        f'Mode {ctx["mode"]} ; {len(cas)} cas ; variantes {", ".join(ctx["variantes"])} ; '
        f'durée {ctx["duree"]:.0f} s (rendus et mesures {ctx["duree_rendu"]:.0f} s).',
        f'Production : {ctx["production"]} : {", ".join(ctx["prod"]) or "aucun correctif"}.',
        f'Pile complète : {", ".join(tous)}.',
        f'Nouveaux : {", ".join(ctx["nouveaux"]) or "aucun"} ; modifiés : '
        f'{", ".join(ctx["modifies"]) or "aucun"} ; retirés : {", ".join(ctx["retires"]) or "aucun"}.',
        f'Piles rendues : {", ".join(ctx["piles"])}.',
    ]
    infos += [f'Pile écartée : {s}' for s in ctx['sautees']]
    r.liste(infos)

    r.titre(2, 'Régressions')
    r.para('Invariant tenu en production et cassé quand on ajoute des correctifs. Le '
           'correctif désigné est celui dont le retrait le fait tenir, ou dont l\'ajout le casse.')
    regs = bilan['regressions_non_admises'] + bilan['regressions_admises']
    if regs:
        r.tableau('Régressions', ['cas', 'variante', 'pile', 'invariant', 'détail',
                                  'correctif responsable', 'admise'],
                  [[k[0], k[1], pn, inv, court(d),
                    ', '.join(coupables(R, k, inv, tous)) or 'non désigné',
                    'oui' if (k, pn, inv, d) in bilan['regressions_admises'] else 'non']
                   for k, pn, inv, d in regs],
                  ko=range(len(bilan['regressions_non_admises'])))
    else:
        r.para('Aucune.')

    r.titre(2, 'Autres invariants en échec avec tous les correctifs')
    if bilan['ko_toutes']:
        r.tableau('Invariants en échec, hors limites admises',
                  ['cas', 'variante', 'invariant', 'détail', 'déjà en production',
                   'retrait qui répare'],
                  [[k[0], k[1], inv, court(d),
                    'oui' if inv in R['production'][k]['invariants'] else 'non',
                    ', '.join(coupables(R, k, inv, tous)) or '—']
                   for k, inv, d in bilan['ko_toutes']],
                  ko=range(len(bilan['ko_toutes'])))
    else:
        r.para('Aucun.')

    r.titre(2, 'Ce qui change entre la production et la pile complète')
    if ecarts:
        r.tableau('Rendus qui changent, et correctifs désignés par retrait',
                  ['cas', 'variante', 'ce qui change', 'correctifs désignés'],
                  [[k[0], k[1], lettres(d),
                    ', '.join(f'{x} ({lettres(dd)})' for x, dd in attribution.get(k, {}).items())
                    or 'non désigné']
                   for k, d in sorted(ecarts.items())])
    else:
        r.para('Aucun rendu ne change.')

    colonnes = ctx['colonnes']
    if colonnes:
        r.titre(2, 'Matrice cas × correctif')
        r.para('Chaque case dit ce qui change quand on retire ce correctif de la pile complète '
               '(colonne « +N » : quand on y remet le correctif N, retiré depuis la '
               'production). Lettres : ' + ', '.join(f'{k} {v}' for k, v in METRIQUES.items()) +
               '. Case vide : rien ne change. « — » : non essayé sur ce cas.')
        cles = sorted(set().union(*(E[pn] for _, pn in colonnes)))
        r.tableau('Matrice cas × correctif', ['cas', 'variante'] + [x for x, _ in colonnes],
                  [[k[0], k[1]] + [attribution.get(k, {}).get(x, '') if k in E[pn] else '—'
                                   for x, pn in colonnes]
                   for k in cles])

    vues = [p for p in ctx['piles'] if not re.match(r'toutes[-+]', p)]
    r.titre(2, 'Verdicts par pile (variante ua1)')
    r.para('« ok » : tous les invariants tiennent ; sinon le nombre d\'invariants en échec, '
           'limites admises comprises.')
    r.tableau('Invariants en échec par cas et par pile', ['cas'] + vues,
              [[n] + [('ok' if not R[pn][(n, 'ua1')]['invariants'] else
                       f'{len(R[pn][(n, "ua1")]["invariants"])} en échec')
                      if (n, 'ua1') in R[pn] else '—' for pn in vues] for n in cas])

    r.titre(2, 'Limites admises')
    r.para('Invariants déclarés « connus » dans cas.toml : ils ne font pas échouer le banc.')
    if bilan['connus']:
        r.tableau('Limites admises en échec avec tous les correctifs',
                  ['cas', 'variante', 'invariant', 'détail'],
                  [[k[0], k[1], inv, court(d)] for k, inv, d in bilan['connus']])
    if bilan['tenus']:
        r.para('Limites admises qui tiennent désormais (à retirer de « connus ») : ' +
               '; '.join(f'{k[0]} {k[1]} {inv}' for k, inv in bilan['tenus']) + '.')

    r.titre(2, 'Détail par cas')
    for n, c in cas.items():
        lignes = []
        for v in ctx['variantes']:
            for pn in vues:
                inv = R[pn][(n, v)]['invariants']
                if inv:
                    lignes.append(f'{v} / {pn} : ' + '; '.join(
                        f'{i} ({court(d, 120)})' for i, d in inv.items()))
        k = (n, 'ua1')
        changes = {kk: d for kk, d in ecarts.items() if kk[0] == n}
        if not lignes and not changes:
            continue
        r.titre(3, n)
        if c.get('titre'):
            r.para(c['titre'])
        if lignes:
            r.liste(lignes)
        if 'P' in changes.get(k, ''):
            p1 = E['production'][k].get('P', '').split()
            p2 = E['toutes'][k].get('P', '').split()
            pages = [str(i + 1) for i in range(max(len(p1), len(p2)))
                     if i >= len(p1) or i >= len(p2) or p1[i] != p2[i]]
            r.para(f'Pages ua1 qui changent de la production à la pile complète : '
                   f'{", ".join(pages)} (pages : {len(p1)} → {len(p2)}).')
        a1, a2 = E['production'][k].get('A', ''), E['toutes'][k].get('A', '')
        if a1 != a2:
            diff = list(difflib.unified_diff(a1.splitlines(), a2.splitlines(),
                                             'production', 'toutes', n=1, lineterm=''))
            if len(diff) > 200:
                diff = diff[:200] + [f'… {len(diff) - 200} lignes de plus']
            r.diff('Arbre de structure ua1 : production → pile complète', diff)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Panne as e:
        print(f'banc : panne d\'outillage : {e}', file=sys.stderr)
        sys.exit(2)
