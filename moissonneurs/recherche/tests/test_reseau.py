"""Politesse réseau figée : User-Agent exact, robots.txt, délai par hôte, plafond et demande d'arrêt.

Un faux serveur local (127.0.0.1, http.server dans un thread) répond ; aucun réseau réel. L'horloge du module est
remplacée par une horloge factice : le délai se vérifie sans attendre.
"""
import os
import shutil
import tempfile
import threading
import tomllib
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from recherche import reseau

UA_ATTENDU = 'szh-harvest-research/0.1 (veille documentaire CSPS)'
REGLAGES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'reglages.toml')
ROBOTS = b'User-agent: *\nDisallow: /interdit/\n'


class Horloge:
    """time.monotonic et time.sleep factices : sleep avance l'horloge au lieu d'attendre."""

    def __init__(self):
        self.t = 1000.0

    def monotonic(self):
        return self.t

    def sleep(self, s):
        self.t += max(s, 0)

    def time(self):
        return self.t


class Serveur:
    """/refus/… répond 403 ; /trop/<n>/… répond 429 avec Retry-After: n à la première demande ; robots.txt répond 403
    si `robots_403`."""

    def __init__(self, horloge):
        recues = self.recues = []
        serveur = self
        self.robots_403 = False

        class Gestionnaire(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                recues.append({'chemin': self.path, 'hote': self.headers.get('Host'),
                               'ua': self.headers.get('User-Agent'), 't': horloge.t,
                               'en_tetes': {k: v for k, v in self.headers.items() if k != 'Host'}})
                if self.path.startswith('/refus/') or (self.path == '/robots.txt' and serveur.robots_403):
                    self.send_response(403)
                    self.end_headers()
                    return
                if self.path.startswith('/trop/') and sum(r['chemin'] == self.path for r in recues) == 1:
                    self.send_response(429)
                    self.send_header('Retry-After', self.path.split('/')[2])
                    self.end_headers()
                    return
                corps = ROBOTS if self.path == '/robots.txt' else b'<html><h1>page</h1></html>'
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('ETag', '"v1"')
                self.end_headers()
                self.wfile.write(corps)

        self.http = HTTPServer(('127.0.0.1', 0), Gestionnaire)
        self.port = self.http.server_port
        threading.Thread(target=self.http.serve_forever, daemon=True).start()

    def fermer(self):
        self.http.shutdown()
        self.http.server_close()


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.horloge = Horloge()
        self.vrai_time = reseau.time
        reseau.time = self.horloge
        self.addCleanup(setattr, reseau, 'time', self.vrai_time)
        self.serveur = Serveur(self.horloge)
        self.addCleanup(self.serveur.fermer)
        with open(REGLAGES, 'rb') as f:
            self.delai = tomllib.load(f)['delai']
        self.arret = os.path.join(self.tmp, 'arret')

    def reseau(self, **autres):
        config = {'delai': self.delai, 'cache': os.path.join(self.tmp, 'cache'), 'budget': 0}
        config.update(autres)
        return reseau.Reseau(config, fichier_arret=self.arret)

    def url(self, chemin, hote='127.0.0.1'):
        return f'http://{hote}:{self.serveur.port}{chemin}'


class TestReseau(Base):
    def test_user_agent_exact_sur_robots_et_page(self):
        self.reseau().get(self.url('/projet/a'))
        self.assertEqual([r['chemin'] for r in self.serveur.recues], ['/robots.txt', '/projet/a'])
        self.assertEqual({r['ua'] for r in self.serveur.recues}, {UA_ATTENDU})
        self.assertEqual(reseau.USER_AGENT, UA_ATTENDU)

    def test_en_tetes_figes(self):
        # Exactement ce qui part sur le réseau : le User-Agent identifié, rien d'autre que les en-têtes d'urllib ;
        # à la relecture d'une page en cache, la seule revalidation.
        r = self.reseau()
        r.get(self.url('/projet/a'))
        r.get(self.url('/projet/a'))
        base = {'Accept-Encoding': 'identity', 'User-Agent': UA_ATTENDU, 'Connection': 'close'}
        self.assertEqual([x['en_tetes'] for x in self.serveur.recues],
                         [base, base, dict(base, **{'If-None-Match': '"v1"'})])

    def test_robots_txt_respecte(self):
        r = self.reseau()
        with self.assertRaises(reseau.RobotsInterdit):
            r.get(self.url('/interdit/page'))
        self.assertNotIn('/interdit/page', [x['chemin'] for x in self.serveur.recues])

    def test_delai_par_hote(self):
        self.assertEqual(self.delai, 3)
        r = self.reseau()
        r.get(self.url('/a'))
        r.get(self.url('/b'))
        r.get(self.url('/c', hote='localhost'))    # autre hôte : pas d'attente due au premier
        meme = [x['t'] for x in self.serveur.recues if x['hote'].startswith('127.0.0.1')]
        self.assertEqual(len(meme), 3)
        for avant, apres in zip(meme, meme[1:]):
            self.assertGreaterEqual(apres - avant, self.delai)
        autre = [x['t'] for x in self.serveur.recues if x['hote'].startswith('localhost')]
        self.assertEqual(autre[0], meme[-1])

    def test_plafond(self):
        r = self.reseau(budget=2)
        r.get(self.url('/a'))                       # robots.txt et la page : 2 requêtes
        with self.assertRaises(reseau.BudgetEpuise):
            r.get(self.url('/b'))
        self.assertEqual(len(self.serveur.recues), 2)

    def test_plafond_nul_aucune_requete(self):
        # Un plafond de 0 (budget du mois tout juste atteint) interdit toute requête ; il ne vaut pas « sans limite ».
        r = self.reseau(budget=3000, plafond=0)
        with self.assertRaises(reseau.BudgetEpuise):
            r.get(self.url('/a'))
        self.assertEqual(self.serveur.recues, [])

    def test_plafond_sous_le_budget(self):
        r = self.reseau(budget=3000, plafond=2)
        r.get(self.url('/a'))
        with self.assertRaises(reseau.BudgetEpuise):
            r.get(self.url('/b'))
        self.assertEqual(len(self.serveur.recues), 2)

    def test_demande_d_arret_avant_toute_requete(self):
        open(self.arret, 'w').close()
        with self.assertRaises(reseau.ArretDemande):
            self.reseau().get(self.url('/a'))
        self.assertEqual(self.serveur.recues, [])

    def test_demande_d_arret_en_cours_de_route(self):
        r = self.reseau()
        r.get(self.url('/a'))
        open(self.arret, 'w').close()
        with self.assertRaises(reseau.ArretDemande):
            r.get(self.url('/b'))
        self.assertEqual([x['chemin'] for x in self.serveur.recues], ['/robots.txt', '/a'])
        self.assertEqual(r.requetes, 2)

    def test_sans_fichier_d_arret_configure(self):
        r = reseau.Reseau({'delai': 0, 'cache': os.path.join(self.tmp, 'cache')})
        r.get(self.url('/a'))
        self.assertEqual(len(self.serveur.recues), 2)


class TestRefus403(Base):
    def details(self, r, motif):
        """Demande une page de détail par lettre de `motif` (o : lue, x : refusée) ; rend les exceptions levées."""
        levees = []
        for i, c in enumerate(motif):
            chemin = f'/{"refus" if c == "x" else "ok"}/{i}'
            try:
                r.get(self.url(chemin), detail=True)
                levees.append(None)
            except (reseau.Refus403Page, reseau.Acces403) as e:
                levees.append(type(e).__name__)
        return levees

    def test_point_d_entree_en_403_ferme_l_hote(self):
        r = self.reseau()
        with self.assertRaises(reseau.Acces403):
            r.get(self.url('/refus/plan.xml'))
        n = len(self.serveur.recues)
        with self.assertRaises(reseau.Acces403):
            r.get(self.url('/ok/apres'))
        self.assertEqual(len(self.serveur.recues), n)      # plus aucune requête vers cet hôte

    def test_robots_txt_en_403_est_un_point_d_entree(self):
        self.serveur.robots_403 = True
        with self.assertRaises(reseau.Acces403):
            self.reseau().get(self.url('/ok/a'), detail=True)

    def test_une_page_de_detail_sur_une_en_403_est_sautee(self):
        r = self.reseau()
        r.source = 'site:essai'
        self.assertEqual(self.details(r, 'x'), ['Refus403Page'])
        r.get(self.url('/ok/suite'))                        # l'hôte reste ouvert
        self.assertEqual(r.details['site:essai']['refus'], [self.url('/refus/0')])

    def test_afflux_trois_details_dont_deux_en_403(self):
        r = self.reseau()
        self.assertEqual(self.details(r, 'xox'), ['Refus403Page', None, 'Acces403'])
        n = len(self.serveur.recues)
        with self.assertRaises(reseau.Acces403):
            r.get(self.url('/ok/apres'), detail=True)
        self.assertEqual(len(self.serveur.recues), n)

    def test_dix_details_dont_quatre_en_403_sans_arret(self):
        r = self.reseau()
        levees = self.details(r, 'ooxoxoxoxo')
        self.assertNotIn('Acces403', levees)
        self.assertEqual(levees.count('Refus403Page'), 4)

    def test_seuils_nommes(self):
        self.assertEqual((reseau.MIN_DETAILS_AFFLUX, reseau.PART_AFFLUX), (3, 0.5))

    def test_page_deja_refusee_n_est_plus_demandee(self):
        refusee = self.url('/ok/vieille')
        r = reseau.Reseau({'delai': 0, 'cache': os.path.join(self.tmp, 'cache')}, urls_refusees={refusee})
        with self.assertRaises(reseau.Refus403Page) as ctx:
            r.get(refusee, detail=True)
        self.assertTrue(ctx.exception.deja)
        self.assertEqual(self.serveur.recues, [])

    def test_attente_429_annoncee_au_dela_de_dix_secondes(self):
        lignes = []
        r = self.reseau()
        r.signaler = lignes.append
        r.source = 'site:essai'
        r.get(self.url('/trop/20/a'))
        attentes = [l for l in lignes if l['type'] == 'attente']
        self.assertEqual(len(attentes), 1)
        self.assertEqual({k: attentes[0][k] for k in ('source', 'secondes', 'motif')},
                         {'source': 'site:essai', 'secondes': 20, 'motif': '429'})
        self.assertTrue(attentes[0]['hote'].startswith('127.0.0.1'))

    def test_attente_429_courte_non_annoncee(self):
        lignes = []
        r = self.reseau()
        r.signaler = lignes.append
        r.get(self.url('/trop/5/a'))
        self.assertEqual([l for l in lignes if l['type'] == 'attente'], [])


if __name__ == '__main__':
    unittest.main()
