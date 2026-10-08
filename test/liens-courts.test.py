#!/usr/bin/env python3
# Teste pipeline/liens-courts.py contre un serveur HTTP local (http.server), jamais contre
# le Shlink réel. Couvre l'appel REST (en-tête X-Api-Key, corps JSON, champ "shortUrl"),
# le repli sur l'URL longue (sans configuration ou serveur en échec), le cache, et
# l'extraction des liens `.qr` d'un dossier de chapitres.
#
#   python3 test/liens-courts.test.py
#
# Un module qui ne se charge pas est une erreur, pas un test sauté.

import http.server
import importlib.util
import io
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEMIN_MODULE = os.path.join(RACINE, 'pipeline', 'liens-courts.py')

# Chargement par chemin : le nom du fichier contient un tiret.
_spec = importlib.util.spec_from_file_location('liens_courts', CHEMIN_MODULE)
lc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lc)

CLE_API_ATTENDUE = 'cle-de-test-1234'


class Gestionnaire(http.server.BaseHTTPRequestHandler):
    """Shlink miniature, une seule route : POST /rest/v3/short-urls. Le comportement (clé
    attendue, code de réponse) est lu sur la classe à chaque requête, pour qu'un test le
    change sans redémarrer le serveur."""

    cle_attendue = CLE_API_ATTENDUE
    code_reponse = 200
    # Fonction (dict_corps) -> dict de réponse ; None = shortUrl déterministe par défaut.
    fabrique_reponse = None

    def log_message(self, *_args):  # http.server écrirait sur stderr à chaque requête
        pass

    def do_POST(self):
        if self.path != '/rest/v3/short-urls':
            self.send_response(404)
            self.end_headers()
            return
        longueur = int(self.headers.get('Content-Length', '0'))
        corps = json.loads(self.rfile.read(longueur).decode('utf-8')) if longueur else {}
        cle_recue = self.headers.get('X-Api-Key')

        if cle_recue != type(self).cle_attendue:
            self.send_response(401)
            self.send_header('Content-Type', 'application/problem+json')
            self.end_headers()
            self.wfile.write(json.dumps({'title': 'Invalid API key', 'status': 401}).encode('utf-8'))
            return

        if type(self).code_reponse != 200:
            self.send_response(type(self).code_reponse)
            self.end_headers()
            return

        if type(self).fabrique_reponse:
            reponse = type(self).fabrique_reponse(corps)
        else:
            # Lien court dérivé de longUrl, pour vérifier quelle URL a été envoyée.
            reponse = {
                'shortUrl': 'https://link.szh-csps.ch/T' + str(abs(hash(corps.get('longUrl', '')))  % 10000),
                'longUrl': corps.get('longUrl'),
                'shortCode': 'T0000',
            }
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(reponse).encode('utf-8'))


class ServeurTest:
    """HTTPServer sur un port libre choisi par le système, dans un thread démon."""

    def __enter__(self):
        self.serveur = http.server.HTTPServer(('127.0.0.1', 0), Gestionnaire)
        self.port = self.serveur.server_address[1]
        self.base_url = 'http://127.0.0.1:%d' % self.port
        self.thread = threading.Thread(target=self.serveur.serve_forever, daemon=True)
        self.thread.start()
        # Gestionnaire n'est pas remis à zéro ici : certains tests le configurent avant
        # `with ServeurTest()`. La remise à zéro se fait dans __exit__.
        return self

    def __exit__(self, *_exc):
        self.serveur.shutdown()
        self.serveur.server_close()
        # Rend au test suivant le comportement par défaut.
        Gestionnaire.cle_attendue = CLE_API_ATTENDUE
        Gestionnaire.code_reponse = 200
        Gestionnaire.fabrique_reponse = None


class ObtenirLienCourt(unittest.TestCase):
    def test_appel_reussi_rend_shortUrl(self):
        with ServeurTest() as s:
            court = lc.obtenir_lien_court('https://exemple.ch/x', s.base_url, CLE_API_ATTENDUE)
            self.assertTrue(court.startswith('https://link.szh-csps.ch/'))

    def test_cle_api_fausse_leve_httperror(self):
        with ServeurTest() as s:
            with self.assertRaises(urllib.error.HTTPError):
                lc.obtenir_lien_court('https://exemple.ch/x', s.base_url, 'mauvaise-cle')

    def test_reponse_sans_shortUrl_leve_valueerror(self):
        Gestionnaire.fabrique_reponse = lambda corps: {'longUrl': corps.get('longUrl')}
        with ServeurTest() as s:
            with self.assertRaises(ValueError):
                lc.obtenir_lien_court('https://exemple.ch/x', s.base_url, CLE_API_ATTENDUE)

    def test_le_corps_envoye_porte_bien_longUrl_et_findIfExists(self):
        recu = {}

        def capter(corps):
            recu.update(corps)
            return {'shortUrl': 'https://link.szh-csps.ch/CAPTE'}
        Gestionnaire.fabrique_reponse = capter
        with ServeurTest() as s:
            lc.obtenir_lien_court('https://exemple.ch/capte-moi', s.base_url, CLE_API_ATTENDUE,
                                   tags=['livre-test'])
        self.assertEqual(recu.get('longUrl'), 'https://exemple.ch/capte-moi')
        self.assertIs(recu.get('findIfExists'), True)
        self.assertEqual(recu.get('tags'), ['livre-test'])


class ResoudreLiens(unittest.TestCase):
    def test_sans_configuration_url_longue_gardee_avec_avertissement(self):
        cache = {}
        erreurs = io.StringIO()
        ancien_stderr, sys.stderr = sys.stderr, erreurs
        try:
            n = lc.resoudre_liens(['https://exemple.ch/x'], cache, '', '')
        finally:
            sys.stderr = ancien_stderr
        self.assertEqual(n, 0)
        self.assertEqual(cache['https://exemple.ch/x'], 'https://exemple.ch/x')
        self.assertIn('[livre-avertissement]', erreurs.getvalue())
        self.assertIn('lien-court-indisponible', erreurs.getvalue())

    def test_serveur_en_echec_url_longue_gardee_avec_avertissement(self):
        # Rien n'écoute sur ce port (fermé aussitôt) : la connexion échoue franchement.
        srv = http.server.HTTPServer(('127.0.0.1', 0), Gestionnaire)
        port_libre = srv.server_address[1]
        srv.server_close()
        cache = {}
        erreurs = io.StringIO()
        ancien_stderr, sys.stderr = sys.stderr, erreurs
        try:
            n = lc.resoudre_liens(['https://exemple.ch/x'], cache,
                                   'http://127.0.0.1:%d' % port_libre, CLE_API_ATTENDUE)
        finally:
            sys.stderr = ancien_stderr
        self.assertEqual(n, 0)
        self.assertEqual(cache['https://exemple.ch/x'], 'https://exemple.ch/x')
        self.assertIn('[livre-avertissement]', erreurs.getvalue())
        self.assertIn('lien-court-echec', erreurs.getvalue())

    def test_appel_reussi_peuple_le_cache_et_compte_les_resolutions(self):
        with ServeurTest() as s:
            cache = {}
            n = lc.resoudre_liens(['https://exemple.ch/a', 'https://exemple.ch/b'],
                                   cache, s.base_url, CLE_API_ATTENDUE)
            self.assertEqual(n, 2)
            self.assertTrue(cache['https://exemple.ch/a'].startswith('https://link.szh-csps.ch/'))
            self.assertNotEqual(cache['https://exemple.ch/a'], 'https://exemple.ch/a')

    def test_url_deja_en_cache_nest_pas_re_resolue(self):
        with ServeurTest() as s:
            cache = {'https://exemple.ch/a': 'https://link.szh-csps.ch/DEJA'}
            n = lc.resoudre_liens(['https://exemple.ch/a'], cache, s.base_url, CLE_API_ATTENDUE)
            self.assertEqual(n, 0)
            self.assertEqual(cache['https://exemple.ch/a'], 'https://link.szh-csps.ch/DEJA')


class Cache(unittest.TestCase):
    def test_ecriture_puis_lecture_rend_le_meme_dict(self):
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, 'liens-courts.yaml')
            original = {
                'https://exemple.ch/x': 'https://link.szh-csps.ch/A1',
                'https://exemple.ch/y?a=1&b=2': 'https://link.szh-csps.ch/A2',
            }
            lc.ecrire_cache(chemin, original)
            relu = lc.lire_cache(chemin)
            self.assertEqual(relu, original)

    def test_guillemet_et_antislash_dans_une_url_survivent_au_round_trip(self):
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, 'liens-courts.yaml')
            original = {'https://exemple.ch/x?q="a"\\b': 'https://link.szh-csps.ch/A3'}
            lc.ecrire_cache(chemin, original)
            self.assertEqual(lc.lire_cache(chemin), original)

    def test_fichier_absent_rend_un_cache_vide(self):
        self.assertEqual(lc.lire_cache('/chemin/qui-n-existe-pas.yaml'), {})

    def test_format_ecrit_est_du_yaml_bloc_lisible_ligne_a_ligne(self):
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, 'liens-courts.yaml')
            lc.ecrire_cache(chemin, {'https://exemple.ch/x': 'https://link.szh-csps.ch/A1'})
            with open(chemin, 'r', encoding='utf-8') as fh:
                contenu = fh.read()
            self.assertEqual(contenu, '"https://exemple.ch/x": "https://link.szh-csps.ch/A1"\n')


class ScannerLiensQr(unittest.TestCase):
    def test_extrait_les_url_des_liens_qr_seulement(self):
        with tempfile.TemporaryDirectory() as d:
            chap = os.path.join(d, 'chap1')
            os.makedirs(chap)
            with open(os.path.join(chap, 'chap1.md'), 'w', encoding='utf-8') as fh:
                fh.write(
                    "Un lien ordinaire : [texte](https://exemple.ch/normal)\n\n"
                    '[Écouter](https://exemple.ch/x){.qr}\n\n'
                    '[Écouter aussi](https://exemple.ch/y){.qr taille="30mm"}\n'
                )
            urls = lc.scanner_liens_qr(d)
            self.assertEqual(urls, ['https://exemple.ch/x', 'https://exemple.ch/y'])

    def test_dedoublonne_et_trie(self):
        with tempfile.TemporaryDirectory() as d:
            for i, nom in enumerate(('a', 'b')):
                sous = os.path.join(d, nom)
                os.makedirs(sous)
                with open(os.path.join(sous, nom + '.md'), 'w', encoding='utf-8') as fh:
                    fh.write('[Écouter](https://exemple.ch/meme){.qr}\n')
            urls = lc.scanner_liens_qr(d)
            self.assertEqual(urls, ['https://exemple.ch/meme'])

    def test_dossier_sans_liens_qr_rend_une_liste_vide(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, 'rien.md'), 'w', encoding='utf-8') as fh:
                fh.write('Rien ici.\n')
            self.assertEqual(lc.scanner_liens_qr(d), [])

    def test_extrait_aussi_les_url_du_bloc_qr_link(self):
        # Bloc qr-link, seul ou dans un falc-header : filters/szh-qr-lister.lua le lit avec
        # pandoc, comme la compilation, et non par un motif de texte.
        with tempfile.TemporaryDirectory() as d:
            chap = os.path.join(d, 'chap1')
            os.makedirs(chap)
            with open(os.path.join(chap, 'chap1.md'), 'w', encoding='utf-8') as fh:
                fh.write(
                    '::: {.qr-link}\nhttps://exemple.ch/bloc\n:::\n\n'
                    ':::: falc-header\nTexte.\n\n::: qr-link\nhttps://exemple.ch/embarque\n:::\n::::\n'
                )
            urls = lc.scanner_liens_qr(d)
            self.assertEqual(urls, ['https://exemple.ch/bloc', 'https://exemple.ch/embarque'])

    def test_tracked_false_est_liste_mais_pas_resolu(self):
        # `tracked=false` : le filtre Lua liste le lien, scanner_liens_qr() l'écarte. C'est
        # lui qui décide ce qui part vers Shlink.
        with tempfile.TemporaryDirectory() as d:
            chap = os.path.join(d, 'chap1')
            os.makedirs(chap)
            with open(os.path.join(chap, 'chap1.md'), 'w', encoding='utf-8') as fh:
                fh.write(
                    '::: {.qr-link tracked=false}\nhttps://exemple.ch/non-suivi\n:::\n\n'
                    '[Suivi](https://exemple.ch/suivi){.qr}\n'
                )
            urls = lc.scanner_liens_qr(d)
            self.assertEqual(urls, ['https://exemple.ch/suivi'])

    def test_lecteur_hard_line_breaks_lit_aussi_le_bloc(self):
        # --lecteur est celui de la compilation (LECTEUR dans livre.mk) : un chapitre FALC
        # se lit en markdown+hard_line_breaks.
        with tempfile.TemporaryDirectory() as d:
            chap = os.path.join(d, 'chap1')
            os.makedirs(chap)
            with open(os.path.join(chap, 'chap1.md'), 'w', encoding='utf-8') as fh:
                fh.write('::: {.qr-link}\nhttps://exemple.ch/falc\n:::\n')
            urls = lc.scanner_liens_qr(d, lecteur='markdown+hard_line_breaks')
            self.assertEqual(urls, ['https://exemple.ch/falc'])


class Principal(unittest.TestCase):
    """Le point d'entrée CLI de bout en bout : --scan + cache, contre le serveur local."""

    def test_scan_et_resolution_de_bout_en_bout(self):
        with tempfile.TemporaryDirectory() as d:
            chap = os.path.join(d, 'chapitres', 'chap1')
            os.makedirs(chap)
            with open(os.path.join(chap, 'chap1.md'), 'w', encoding='utf-8') as fh:
                fh.write('[Écouter](https://exemple.ch/bout-en-bout){.qr}\n')
            cache_path = os.path.join(d, 'liens-courts.yaml')

            with ServeurTest() as s:
                ancien_url = os.environ.get('SZH_SHLINK_URL')
                ancienne_cle = os.environ.get('SZH_SHLINK_CLE')
                os.environ['SZH_SHLINK_URL'] = s.base_url
                os.environ['SZH_SHLINK_CLE'] = CLE_API_ATTENDUE
                try:
                    code = lc.principal([cache_path, '--scan', os.path.join(d, 'chapitres')])
                finally:
                    if ancien_url is None:
                        os.environ.pop('SZH_SHLINK_URL', None)
                    else:
                        os.environ['SZH_SHLINK_URL'] = ancien_url
                    if ancienne_cle is None:
                        os.environ.pop('SZH_SHLINK_CLE', None)
                    else:
                        os.environ['SZH_SHLINK_CLE'] = ancienne_cle

            self.assertEqual(code, 0)
            cache = lc.lire_cache(cache_path)
            self.assertIn('https://exemple.ch/bout-en-bout', cache)
            self.assertTrue(cache['https://exemple.ch/bout-en-bout'].startswith('https://link.szh-csps.ch/'))

    def test_scan_lit_aussi_le_bloc_qr_link(self):
        # Comme ci-dessus, avec le bloc qr-link au lieu de la forme courte `.qr`.
        with tempfile.TemporaryDirectory() as d:
            chap = os.path.join(d, 'chapitres', 'chap1')
            os.makedirs(chap)
            with open(os.path.join(chap, 'chap1.md'), 'w', encoding='utf-8') as fh:
                fh.write('::: {.qr-link}\nhttps://exemple.ch/bloc-bout-en-bout\n:::\n')
            cache_path = os.path.join(d, 'liens-courts.yaml')

            with ServeurTest() as s:
                os.environ['SZH_SHLINK_URL'] = s.base_url
                os.environ['SZH_SHLINK_CLE'] = CLE_API_ATTENDUE
                try:
                    code = lc.principal([cache_path, '--scan', os.path.join(d, 'chapitres')])
                finally:
                    os.environ.pop('SZH_SHLINK_URL', None)
                    os.environ.pop('SZH_SHLINK_CLE', None)

            self.assertEqual(code, 0)
            cache = lc.lire_cache(cache_path)
            self.assertIn('https://exemple.ch/bloc-bout-en-bout', cache)
            self.assertTrue(cache['https://exemple.ch/bloc-bout-en-bout'].startswith('https://link.szh-csps.ch/'))

    def test_deuxieme_compilation_ne_rappelle_plus_le_serveur(self):
        # Au second appel, SZH_SHLINK_URL et SZH_SHLINK_CLE sont retirées : si le lien en
        # cache était retraité, resoudre_liens() le jugerait « non configuré » et
        # l'écraserait par l'URL longue.
        with tempfile.TemporaryDirectory() as d:
            chap = os.path.join(d, 'chapitres', 'chap1')
            os.makedirs(chap)
            with open(os.path.join(chap, 'chap1.md'), 'w', encoding='utf-8') as fh:
                fh.write('::: {.qr-link}\nhttps://exemple.ch/deux-fois\n:::\n')
            cache_path = os.path.join(d, 'liens-courts.yaml')

            with ServeurTest() as s:
                os.environ['SZH_SHLINK_URL'] = s.base_url
                os.environ['SZH_SHLINK_CLE'] = CLE_API_ATTENDUE
                try:
                    code1 = lc.principal([cache_path, '--scan', os.path.join(d, 'chapitres')])
                finally:
                    os.environ.pop('SZH_SHLINK_URL', None)
                    os.environ.pop('SZH_SHLINK_CLE', None)

            self.assertEqual(code1, 0)
            court = lc.lire_cache(cache_path)['https://exemple.ch/deux-fois']
            self.assertTrue(court.startswith('https://link.szh-csps.ch/'))

            # Seconde compilation, sans URL ni clé et serveur arrêté : l'entrée reste.
            code2 = lc.principal([cache_path, '--scan', os.path.join(d, 'chapitres')])
            self.assertEqual(code2, 0)
            self.assertEqual(lc.lire_cache(cache_path)['https://exemple.ch/deux-fois'], court)

    def test_sans_url_qr_ne_cree_rien(self):
        with tempfile.TemporaryDirectory() as d:
            cache_path = os.path.join(d, 'liens-courts.yaml')
            code = lc.principal([cache_path, '--scan', d])
            self.assertEqual(code, 0)
            self.assertFalse(os.path.exists(cache_path))


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except (AttributeError, OSError):
        pass
    unittest.main()
