"""Faux moissonneurs et arbre jetable pour éprouver moisson.py sans réseau."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
MODULES = ('moisson.py', 'evenements.py', 'console.py', 'creneau.py', 'partage.py', 'commun.py')
SOCLE_FICTIF = {'format': 'socle-fictif', 'note': 'publié par le poste de développement'}

# Le faux moissonneur rejoue `<racine>/_Moissons/<nom>/scenario.json`. Avant chaque pas marqué `requete`, il
# regarde la demande d'arrêt puis son plafond, comme la couche réseau d'un vrai moissonneur.
FAUX_MAIN = r'''
import json, os, sys, time

def main():
    a = sys.argv[1:]
    def opt(n):
        return a[a.index(n) + 1] if n in a else None
    commande, nom = a[0], __package__
    ici = os.path.join(opt('--racine'), '_Moissons', nom)
    with open(os.path.join(ici, 'scenario.json'), encoding='utf-8') as f:
        sc = json.load(f)
    if commande == 'estimer':
        print(json.dumps(sc['estimation'], ensure_ascii=False), flush=True)
        return sc.get('code_estimer', 0)
    with open(os.path.join(ici, 'argv.json'), 'w', encoding='utf-8') as f:
        json.dump(a, f)
    sys.stderr.write(sc.get('stderr', ''))
    sys.stderr.flush()
    arret = opt('--arret')
    plafond = int(opt('--plafond')) if opt('--plafond') is not None else None
    faites = 0

    def sortir(cle):
        for ligne in sc.get(cle, []):
            ligne = {k: (faites if v == '$faites' else v) for k, v in ligne.items()}
            print(json.dumps(ligne, ensure_ascii=False), flush=True)
        return 3

    for pas in sc.get('pas', []):
        if pas.get('pret'):
            open(os.path.join(ici, 'pret'), 'w').close()
        if pas.get('poser_arret'):
            open(arret, 'w').close()
        if 'attendre_arret' in pas:
            fin = time.time() + pas['attendre_arret']
            while time.time() < fin and not os.path.exists(arret):
                time.sleep(0.05)
        if 'dormir' in pas:
            time.sleep(pas['dormir'])
        if pas.get('requete'):
            if arret and os.path.exists(arret):
                return sortir('sur_arret')
            if plafond is not None and faites >= plafond:
                return sortir('sur_plafond')
            faites += 1
        if 'brut' in pas:
            sys.stdout.write(pas['brut'] + '\n')
            sys.stdout.flush()
        if 'ligne' in pas:
            print(json.dumps(pas['ligne'], ensure_ascii=False), flush=True)
    return sc.get('code', 0)

sys.exit(main())
'''


def estimation(nom, requetes=20, budget=800, delai_s=2.0):
    return {'type': 'estimation', 'moissonneur': nom, 'contrat': 1, 'pret': True, 'requetes': requetes,
            'requetes_prevues': requetes, 'budget': budget, 'delai_s': delai_s, 'avertissements': []}


def resume(nom, lot='', propositions=0, interrompu=None, echecs=(), purge=None, requetes=0):
    return {'type': 'resume', 'moissonneur': nom, 'contrat': 1, 'requetes': requetes,
            'propositions_ecrites': propositions, 'lot': lot, 'sources_en_echec': list(echecs),
            'interrompu': interrompu, 'erreur': '', 'purge': purge or {'lots': [], 'decisions': []},
            'etapes_en_echec': []}


def scenario_simple(nom, code=0, lot='2026-11-01-1.jsonl', propositions=2):
    """Un pas réel, puis le résumé, puis la sortie avec `code`."""
    pas = {'type': 'progression', 'etape': 'moisson', 'statut': 'ok', 'requetes': 3}
    pas['corps' if nom == 'parlement' else 'source'] = 'GE' if nom == 'parlement' else 'hfh'
    return {'estimation': estimation(nom), 'code': code,
            'pas': [{'requete': True, 'ligne': pas},
                    {'ligne': resume(nom, lot=lot, propositions=propositions,
                                     interrompu='budget' if code == 3 else None)}]}


class Arbre:
    """Une copie des modules avec de faux paquets, et une racine `_NewsUndActu` jetable."""

    def __init__(self, scenarios, moissons=True, sans_socle=()):
        self.tmp = tempfile.mkdtemp(prefix='moisson-test-')
        self.code = os.path.join(self.tmp, 'moissonneurs')
        self.racine = os.path.join(self.tmp, 'NewsUndActu')
        self.moissons = os.path.join(self.racine, '_Moissons')
        os.makedirs(self.code)
        os.makedirs(self.moissons if moissons else self.racine)
        for m in MODULES:
            shutil.copy(os.path.join(RACINE, m), self.code)
        for nom, sc in scenarios.items():
            paquet = os.path.join(self.code, nom)
            os.makedirs(paquet)
            open(os.path.join(paquet, '__init__.py'), 'w').close()
            with open(os.path.join(paquet, '__main__.py'), 'w', encoding='utf-8') as f:
                f.write(FAUX_MAIN)
            os.makedirs(os.path.join(self.moissons, nom), exist_ok=True)
            with open(os.path.join(self.moissons, nom, 'scenario.json'), 'w', encoding='utf-8') as f:
                json.dump(sc, f, ensure_ascii=False)
            if nom not in sans_socle:
                os.makedirs(os.path.join(self.moissons, nom, '_partage'))
                with open(self.socle(nom), 'w', encoding='utf-8') as f:
                    json.dump(SOCLE_FICTIF, f)

    def chemin(self, *p):
        return os.path.join(self.moissons, *p)

    def socle(self, nom):
        return os.path.join(self.moissons, nom, '_partage', 'socle.json')

    def poste(self, poste='poste-a', compte='compte-a'):
        return ['--racine', self.racine, '--poste', poste, '--compte', compte, '--attente-creneau', '0']

    def argv(self, *args):
        return [sys.executable, '-B', os.path.join(self.code, 'moisson.py'), *args]

    def lancer(self, *args, timeout=60):
        return subprocess.run(self.argv(*args), capture_output=True, text=True, encoding='utf-8',
                              stdin=subprocess.DEVNULL, timeout=timeout)

    def ouvrir(self, *args):
        return subprocess.Popen(self.argv(*args), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                encoding='utf-8', stdin=subprocess.DEVNULL)

    def argv_enfant(self, nom):
        with open(self.chemin(nom, 'argv.json'), encoding='utf-8') as f:
            return json.load(f)

    def attendre(self, chemin, delai=20):
        fin = time.time() + delai
        while time.time() < fin:
            if os.path.exists(chemin):
                return True
            time.sleep(0.05)
        return False

    def creneaux(self):
        d = self.chemin('_Creneau')
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def effacer(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


def option(argv, nom):
    return argv[argv.index(nom) + 1] if nom in argv else None


def evenements(texte):
    return [json.loads(l) for l in texte.splitlines() if l.strip()]


def de_type(evts, t):
    return [e for e in evts if e.get('type') == t]
