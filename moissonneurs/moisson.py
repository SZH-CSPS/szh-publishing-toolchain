"""Point d'entrée commun des moissonneurs : créneau, budget du mois, passe l'un après l'autre, événements.

    python3 -B moisson.py mensuelle --racine <_NewsUndActu> --poste <nom> --compte <nom> [--evenements json]

Le contrat pronto-moisson/1, les codes de sortie et le créneau sont décrits dans LISEZMOI.md.
"""
import argparse
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time

import console
import creneau
import evenements as ev
import partage

ICI = os.path.dirname(os.path.abspath(__file__))
ORDRE = ev.MOISSONNEURS
DOSSIER_LOCAL = '/tmp/pronto-moisson'
QUEUE_JOURNAL = 1000
CODE_REFUS = {'deja-en-cours': 4, 'budget-epuise': 4}


class Refus(Exception):
    def __init__(self, raison, detail):
        super().__init__(detail)
        self.raison, self.detail = raison, detail


class ArretForce(Exception):
    """Second Ctrl+C : l'enfant est tué, la passe s'arrête."""


def chemin_local(p):
    """`C:\\a\\b` ou `C:/a/b` → `/mnt/c/a/b` ; un chemin POSIX passe tel quel."""
    m = re.match(r'^([A-Za-z]):[\\/]?(.*)$', p)
    if not m:
        return p
    return '/mnt/' + m.group(1).lower() + '/' + m.group(2).replace('\\', '/')


# --------------------------------------------------------------------------- coutures remplaçables

def chemins_passe(args):
    """Les chemins partagés tirés de la racine active. Refuse si `_Moissons` n'existe pas : on ne devine rien."""
    racine = chemin_local(args.racine) if os.name == 'posix' else args.racine
    moissons = os.path.join(racine, '_Moissons')
    if not os.path.isdir(moissons):
        raise Refus('racine-absente', f'dossier {moissons} introuvable')
    return {'racine': racine, 'moissons': moissons, 'decisions': os.path.join(moissons, '_Decisions'),
            'fiches': os.path.join(racine, 'Fiches'), 'creneau': os.path.join(moissons, creneau.DOSSIER)}


def prendre_creneau(chemins, poste, compte, declencheur, moissonneurs, duree_estimee_s, attente_s, horloge,
                    signaler):
    """Rend le créneau pris, ou lève creneau.Occupe."""
    c = creneau.Creneau(creneau.DossierCreneau(chemins['creneau']), poste, compte, declencheur, moissonneurs,
                        duree_estimee_s=duree_estimee_s, horloge=horloge, attente_s=attente_s, signaler=signaler)
    c.prendre()
    return c


def lancer_enfant(argv, cwd, stderr):
    env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', PYTHONIOENCODING='utf-8')
    # Une session à part : le Ctrl+C du terminal n'atteint que moisson.py, qui le traduit en demande d'arrêt.
    return subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=stderr, stdin=subprocess.DEVNULL,
                            text=True, encoding='utf-8', errors='replace', bufsize=1, start_new_session=True,
                            env=env)


# --------------------------------------------------------------------------- ligne de commande

class Analyseur(argparse.ArgumentParser):
    def error(self, message):
        raise Refus('config-invalide', message)


def analyser(argv):
    commun = Analyseur(add_help=False)
    commun.add_argument('--racine')
    commun.add_argument('--poste')
    commun.add_argument('--compte')
    commun.add_argument('--declencheur', choices=ev.DECLENCHEURS, default='cli')
    commun.add_argument('--evenements', choices=('json', 'console'))
    commun.add_argument('--attente-creneau', type=float, default=creneau.ATTENTE_S)
    commun.add_argument('--racine-test', action='store_true')
    passe = Analyseur(add_help=False)
    passe.add_argument('--hors-ligne', action='store_true')
    passe.add_argument('--a-blanc', action='store_true')
    p = Analyseur(prog='moisson.py')
    sous = p.add_subparsers(dest='commande', required=True)
    s = sous.add_parser('mensuelle', parents=[commun, passe])
    s.add_argument('--seulement', choices=ORDRE)
    s = sous.add_parser('tout', parents=[commun, passe])
    s.add_argument('moissonneur')
    s = sous.add_parser('estimer', parents=[commun])
    s.add_argument('moissonneur')
    args = p.parse_args(argv)
    for option in ('racine', 'poste', 'compte'):
        if not getattr(args, option):
            raise Refus('config-invalide', f'option --{option} manquante')
    if args.commande == 'mensuelle':
        args.moissonneurs = [args.seulement] if args.seulement else list(ORDRE)
    else:
        if args.moissonneur not in ORDRE:
            raise Refus('config-invalide', f'moissonneur inconnu : {args.moissonneur}')
        args.moissonneurs = [args.moissonneur]
    for absent in ('hors_ligne', 'a_blanc'):
        setattr(args, absent, getattr(args, absent, False))
    return args


# --------------------------------------------------------------------------- sortie des événements

class Sortie:
    """JSON (une ligne par événement, rien d'autre sur stdout) ou rendu console."""

    def __init__(self, flux, mode, entree):
        self.flux, self.mode = flux, mode
        self.rendu = console.Rendu(flux, entree=entree) if mode == 'console' else None

    def __call__(self, evt):
        if self.rendu is not None:
            self.rendu.recevoir(evt)
        else:
            self.flux.write(json.dumps(evt, ensure_ascii=False) + '\n')
            self.flux.flush()

    def terminer(self, pause):
        if self.rendu is not None:
            self.rendu.terminer(pause=pause)


class Battement(threading.Thread):
    def __init__(self, c):
        super().__init__(daemon=True)
        self.c, self.arret = c, threading.Event()

    def run(self):
        while not self.arret.wait(creneau.BATTEMENT_S):
            try:
                self.c.battre()
            except OSError:
                pass       # le battement suivant réessaie ; l'annonce reste vivante quinze minutes

    def stopper(self):
        self.arret.set()
        self.join(timeout=5)


# --------------------------------------------------------------------------- la passe

class Passe:
    def __init__(self, args, emettre, horloge, maintenant, racine_code):
        self.args, self.emettre = args, emettre
        self.horloge, self.maintenant, self.racine_code = horloge, maintenant, racine_code
        self.cle = creneau.cle(args.poste, args.compte)
        self.enfant, self.courant = None, None
        self.sigints, self.arret_annonce = 0, False
        self.ecrits = {}

    def _python(self, m, commande, *opts):
        return [sys.executable, '-B', '-m', m, commande, '--racine', self.chemins['racine'], '--poste',
                self.args.poste, '--compte', self.args.compte, *opts]

    def present(self, m):
        return os.path.isfile(os.path.join(self.racine_code, m, '__main__.py'))

    def estimer(self, m):
        """(estimation, avertissements, ligne brute)."""
        try:
            p = subprocess.run(self._python(m, 'estimer', '--cache', self.cache), cwd=self.racine_code,
                               capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=300,
                               stdin=subprocess.DEVNULL, env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
        except (OSError, subprocess.TimeoutExpired) as e:
            return ev.estimation_de(None), [f'estimation impossible · {ev.citer(e)}'], None
        ligne = None
        for texte in p.stdout.splitlines():
            try:
                obj = json.loads(texte)
            except ValueError:
                continue
            if isinstance(obj, dict) and obj.get('type') == 'estimation':
                ligne = obj
        if ligne is None:
            return (ev.estimation_de(None),
                    [f'estimation illisible · {ev.citer(p.stdout or p.stderr or "sortie vide")}'], None)
        return ev.estimation_de(ligne), ev.avertissements_estimation(ligne), ligne

    # Ctrl+C : le premier pose la demande d'arrêt locale, le second tue l'enfant.
    def _sur_sigint(self, signum, frame):
        self.sigints += 1
        if self.sigints == 1:
            try:
                with open(self.arret, 'w', encoding='utf-8') as f:
                    f.write(creneau.iso(creneau.maintenant_utc()) + '\n')
            except OSError:
                pass
            self._annoncer_arret()
            return
        if self.enfant is not None and self.enfant.poll() is None:
            try:
                os.killpg(self.enfant.pid, signal.SIGKILL)
            except OSError:
                pass
        raise ArretForce()

    def _annoncer_arret(self):
        if self.arret_annonce:
            return
        try:
            self.emettre(ev.avertissement(self.courant, 'arrêt demandé… le moissonneur s’arrête avant sa '
                                                        'requête suivante (Ctrl+C encore pour couper net)'))
            self.arret_annonce = True
        except RuntimeError:
            pass        # écriture interrompue en plein milieu : l'annonce partira avec l'événement suivant

    def _compter(self, m, requetes):
        """Le compteur du mois de CE poste, après chaque étape et en fin de moissonneur."""
        if self.args.hors_ligne:
            return
        total = self.budgets[m]['propre'] + requetes
        if self.ecrits.get(m) == total:
            return
        try:
            creneau.ecrire_requetes(self.chemins['moissons'], m, self.mois, self.cle, total, self.maintenant())
            self.ecrits[m] = total
        except OSError as e:
            self.emettre(ev.avertissement(m, f'compteur de requêtes non écrit · {ev.citer(e)}'))

    def _queue_journal(self, journal):
        try:
            journal.flush()
            journal.seek(0, os.SEEK_END)
            taille = journal.tell()
            journal.seek(max(0, taille - 4 * QUEUE_JOURNAL))
            return journal.read().decode('utf-8', 'replace')[-QUEUE_JOURNAL:]
        except (OSError, ValueError):
            return ''

    def lancer(self, m):
        est, plafond = self.estimations[m][0], self.plafonds[m]
        trad = ev.Traducteur(m, dict(est, budget=plafond if plafond is not None else est['budget']),
                             horloge=self.horloge, a_blanc=self.args.a_blanc)
        opts = ['--arret', self.arret, '--cache', self.cache]
        if plafond is not None:
            opts += ['--plafond', str(plafond)]
        opts += ['--hors-ligne'] * self.args.hors_ligne + ['--a-blanc'] * self.args.a_blanc
        horodatage = self.maintenant().strftime('%Y%m%dT%H%M%S')
        os.makedirs(self.journaux, exist_ok=True)
        journal = open(os.path.join(self.journaux, f'{horodatage}-{os.getpid()}-{m}.log'), 'w+b')
        self.courant, force, code = m, False, 1
        try:
            proc = self.enfant = lancer_enfant(self._python(m, 'tout', *opts), self.racine_code, journal)
            try:
                for texte in proc.stdout:
                    for e in trad.ligne(texte):
                        self.emettre(e)
                        if e['type'] == 'etape':
                            self._compter(m, trad.requetes)
                    if self.sigints and not self.arret_annonce:
                        self._annoncer_arret()
            except ArretForce:
                force = True
            code = proc.wait()
            fin_m, = trad.terminer(code, force_arret=force)
            if fin_m['plantage']:
                queue = self._queue_journal(journal)
                self.emettre(ev.avertissement(m, f'fin du journal d’erreurs · {ev.citer(queue or "vide", QUEUE_JOURNAL)}'))
            self.emettre(fin_m)
        finally:
            self.enfant = None
            self._compter(m, trad.requetes)
            journal.close()
        if force:
            raise ArretForce()
        return ev.code_de_passe(fin_m)

    def _refuser(self, raison, detail):
        self.emettre(ev.refus(raison, detail))
        return CODE_REFUS.get(raison, 2)

    def executer(self):
        t0 = self.horloge()
        try:
            self.chemins = chemins_passe(self.args)
        except Refus as r:
            return self._refuser(r.raison, r.detail)
        id_passe = f"{self.maintenant().strftime('%Y%m%dT%H%M%S')}-{os.getpid()}"
        local = os.path.join(DOSSIER_LOCAL, id_passe)
        self.arret, self.cache = os.path.join(local, 'arret'), os.path.join(local, 'cache')
        self.journaux = os.path.join(DOSSIER_LOCAL, 'journaux')
        os.makedirs(self.cache, exist_ok=True)
        try:
            if self.args.commande == 'estimer':
                return self._estimer_seul()
            return self._passe(t0)
        except Exception as e:      # dernier filet : la passe dit sa panne au lieu de mourir en silence
            self.emettre(ev.avertissement(None, f'erreur inattendue · {ev.citer(f"{type(e).__name__}: {e}")}'))
            self.emettre(ev.fin(5, round(max(self.horloge() - t0, 0), 1)))
            return 5
        finally:
            shutil.rmtree(local, ignore_errors=True)

    def _estimer_seul(self):
        m = self.args.moissonneurs[0]
        if not self.present(m):
            return self._refuser('config-invalide', f'moissonneur {m} absent de cette installation')
        est, avert, ligne = self.estimer(m)
        if ligne is None:
            for a in avert:
                self.emettre(ev.avertissement(m, a))
            return 1
        if isinstance(self.emettre, Sortie) and self.emettre.rendu is None:
            self.emettre.flux.write(json.dumps(ligne, ensure_ascii=False) + '\n')
            self.emettre.flux.flush()
        else:
            bornes = ', '.join(f'{k} {v}' for k, v in est.items() if v is not None) or 'sans estimation'
            self.emettre(ev.avertissement(m, f'estimation · {bornes}'))
            for a in avert:
                self.emettre(ev.avertissement(m, a))
        return 0

    def _passe(self, t0):
        a = self.args
        avertissements = []
        presents = []
        for m in a.moissonneurs:
            if self.present(m):
                presents.append(m)
            else:
                avertissements.append((m, f'{m} absent de cette installation, passé'))
        # Sans socle publié depuis le poste de développement, un moissonneur ne part pas : il reprendrait tout de zéro.
        sans_etat = [m for m in presents if not partage.etat_present(self.chemins['racine'], m)]
        if presents and len(sans_etat) == len(presents):
            return self._refuser('etat-absent', f"état partagé absent · {', '.join(sans_etat)} : publier le socle "
                                                  "depuis le poste de développement")
        for m in sans_etat:
            presents.remove(m)
            avertissements.append((m, f'{m} passé · état partagé absent'))
        self.estimations = {m: self.estimer(m) for m in presents}
        for m in presents:
            avertissements += [(m, x) for x in self.estimations[m][1]]
        self.mois = creneau.mois_de(self.maintenant())
        self.budgets, self.plafonds = {}, {}
        for m in presents:
            budget = self.estimations[m][0]['budget']
            somme, propre = creneau.somme_mois(self.chemins['moissons'], m, self.mois, self.cle)
            self.budgets[m] = {'budget': budget, 'marge': creneau.MARGE_REQUETES, 'somme': somme,
                               'plafond': creneau.plafond_local(budget, somme), 'propre': propre}
            self.plafonds[m] = None if a.hors_ligne else self.budgets[m]['plafond']
        if not a.hors_ligne:
            epuises = [m for m in presents if creneau.epuise(self.budgets[m]['budget'], self.budgets[m]['somme'])]
            if presents and len(epuises) == len(presents):
                detail = '; '.join(f"{m} {self.budgets[m]['somme']}/{self.budgets[m]['budget']}" for m in epuises)
                return self._refuser('budget-epuise', f'budget du mois épuisé · {detail}')
            for m in epuises:
                presents.remove(m)
                avertissements.append((m, f"{m} passé · budget du mois épuisé "
                                          f"({self.budgets[m]['somme']}/{self.budgets[m]['budget']})"))
        duree = 0
        for m in presents:
            est = self.estimations[m][0]
            if est['requetes'] is None or est['delai_s'] is None:
                duree = None
                break
            n = est['requetes'] if self.plafonds[m] is None else min(est['requetes'], self.plafonds[m])
            duree += n * est['delai_s']

        def signaler(etat, annonce):
            self.emettre(ev.creneau(etat, annonce['poste'], annonce['compte'], annonce['debut']))
        try:
            pris = prendre_creneau(self.chemins, a.poste, a.compte, a.declencheur, presents, duree,
                                   a.attente_creneau, self.maintenant, signaler)
        except creneau.Occupe as o:
            autre = o.autre
            self.emettre(ev.creneau('refuse', autre.get('poste') or '?', autre.get('compte') or '?',
                                    autre.get('debut') or creneau.iso(self.maintenant())))
            return self._refuser('deja-en-cours', f"une moisson tourne déjà depuis {autre.get('poste')} "
                                                  f"({autre.get('compte')}), lancée à {autre.get('debut')}, "
                                                  f"fin prévue vers {autre.get('echeance')}")
        battement = Battement(pris)
        battement.start()
        ancien = None
        if threading.current_thread() is threading.main_thread():
            ancien = signal.signal(signal.SIGINT, self._sur_sigint)
        codes = []
        try:
            self.emettre(ev.debut(presents, {m: self.estimations[m][0] for m in presents}, a.declencheur,
                                  creneau.iso(self.maintenant()),
                                  {m: {k: v for k, v in self.budgets[m].items() if k != 'propre'}
                                   for m in presents}, a.racine_test))
            for m, message in avertissements:
                self.emettre(ev.avertissement(m, message))
            for m in presents:
                if os.path.exists(self.arret):
                    self.emettre(ev.avertissement(m, f'{m} non lancé · arrêt demandé'))
                    codes.append(3)
                    continue
                codes.append(self.lancer(m))
        except ArretForce:
            codes.append(3)
        except Exception as e:
            self.emettre(ev.avertissement(self.courant, f'erreur inattendue · {ev.citer(f"{type(e).__name__}: {e}")}'))
            codes.append(5)
        finally:
            if ancien is not None:
                signal.signal(signal.SIGINT, ancien)
            battement.stopper()
            annonce = pris.retirer()
            if annonce is not None:
                self.emettre(ev.creneau('retire', annonce['poste'], annonce['compte'], annonce['debut']))
        code = ev.plus_grave(codes)
        self.emettre(ev.fin(code, round(max(self.horloge() - t0, 0), 1)))
        return code


def principal(argv=None, sortie=None, entree=None, horloge=time.monotonic, maintenant=creneau.maintenant_utc,
              racine_code=ICI):
    sortie = sortie if sortie is not None else sys.stdout
    entree = entree if entree is not None else sys.stdin
    argv = sys.argv[1:] if argv is None else argv
    try:
        args = analyser(argv)
    except Refus as r:
        mode = 'console' if ('console' in argv and '--evenements' in argv) else 'json'
        s = Sortie(sortie, mode, entree)
        s(ev.refus(r.raison, r.detail))
        s.terminer(pause='raccourci' in argv)
        return 2
    mode = args.evenements or ('console' if sortie.isatty() else 'json')
    s = Sortie(sortie, mode, entree)
    try:
        return Passe(args, s, horloge, maintenant, racine_code).executer()
    finally:
        s.terminer(pause=args.declencheur == 'raccourci')


if __name__ == '__main__':
    sys.exit(principal())
