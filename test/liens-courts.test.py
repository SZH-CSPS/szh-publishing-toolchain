#!/usr/bin/env python3
# test/liens-courts.test.py — pipeline/liens-courts.py contre un VRAI serveur HTTP, mais
# local (http.server, stdlib) : jamais le serveur Shlink réel de la maison, exactement
# comme pipeline/liens-courts.py lui-même le dit en tête. Couvre l'appel REST (en-tête
# X-Api-Key, corps JSON, champ "shortUrl" de la réponse), le repli sur l'URL longue (sans
# configuration, ou serveur en échec), le cache (lecture/écriture, round-trip), et
# l'extraction des liens `.qr` d'un dossier de chapitres.
#
#   python3 test/liens-courts.test.py
#   (ou : python -m unittest test.liens-courts.test — impossible, le nom porte des tirets ;
#   lancer le fichier directement, comme les autres *-check.py de test/.)
#
# ⚠ Comme test/filtres-pandoc.test.js : aucun de ces tests ne s'abstient. Si le module ne
#   se charge pas (importlib échoue), c'est une ERREUR de collecte, pas un test qui passe.

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

# Le nom de fichier porte un tiret : pas un identifiant Python valide pour `import
# liens-courts`. Chargement par chemin, comme un plugin — patron standard de la doc
# importlib, pas une bibliothèque de plus.
_spec = importlib.util.spec_from_file_location('liens_courts', CHEMIN_MODULE)
lc = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lc)

CLE_API_ATTENDUE = 'cle-de-test-1234'


class Gestionnaire(http.server.BaseHTTPRequestHandler):
    """Un Shlink miniature : POST /rest/v3/short-urls, une seule route. Le comportement
    (clé attendue, code de réponse) est lu sur la classe elle-même à chaque requête —
    modifiable par un test sans redémarrer le serveur."""

    cle_attendue = CLE_API_ATTENDUE
    code_reponse = 200
    # Fonction (dict_corps) -> dict de réponse ; None = shortUrl déterministe par défaut.
    fabrique_reponse = None

    def log_message(self, *_args):  # silence : sinon http.server écrit sur stderr à chaque requête
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
            # Lien court déterministe : dérivé de longUrl, pour vérifier sans ambiguïté
            # que c'est bien CETTE url qui a été envoyée.
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
    """Un http.server.HTTPServer sur un port éphémère (0 -> le système en choisit un
    libre), dans un thread démon — la même recette que le module standard documente pour
    un test qui n'a pas à gérer un cycle de vie de serveur en dur."""

    def __enter__(self):
        self.serveur = http.server.HTTPServer(('127.0.0.1', 0), Gestionnaire)
        self.port = self.serveur.server_address[1]
        self.base_url = 'http://127.0.0.1:%d' % self.port
        self.thread = threading.Thread(target=self.serveur.serve_forever, daemon=True)
        self.thread.start()
        # Pas de remise à zéro ICI : certains tests configurent Gestionnaire (cle_attendue,
        # fabrique_reponse…) AVANT `with ServeurTest()`, pour que le comportement soit en
        # place dès la première requête. La remise à zéro vit dans __exit__ — après le
        # test, pour le suivant, jamais avant.
        return self

    def __exit__(self, *_exc):
        self.serveur.shutdown()
        self.serveur.server_close()
        # Un test qui règle code_reponse=500 ou une fabrique_reponse ne doit pas laisser
        # ce comportement au test suivant.
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
        # Le bloc qr-link (cahier des charges, réutilisable seul ou embarqué dans un
        # falc-header) : filters/szh-qr-lister.lua le lit comme szh-qr.lua/szh-livre-
        # entete.lua le liraient à la compilation — pas un motif texte.
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
        # `tracked=false` (qr-link ou `.qr`) : listé par le filtre (il ne juge rien), mais
        # scanner_liens_qr() l'écarte lui-même — c'est lui qui décide ce qui part vers
        # Shlink, pas le filtre Lua.
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
        # --lecteur doit être CELUI de la compilation (livre.mk, LECTEUR) : un chapitre FALC
        # se lit en markdown+hard_line_breaks, pas en markdown nu — voir le en-tête du CLI.
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
        # Même bout-en-bout que ci-dessus, mais avec la forme de référence du cahier des
        # charges (bloc qr-link) plutôt que la forme courte `.qr`.
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
        # La preuve demandée : une fois le lien en cache, une compilation suivante ne doit
        # plus parler au serveur — ici poussé à l'extrême, sans même SZH_SHLINK_URL/CLE
        # posées au second appel (retirées après la 1re) : si liens-courts.py retentait un
        # appel, resoudre_liens() le verrait comme « non configuré » et écraserait l'entrée
        # avec l'URL longue — ce que ce test interdit.
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

            # 2e compilation : ni URL ni clé Shlink dans l'environnement, le serveur de test
            # n'écoute même plus (bloc `with` refermé) — l'entrée déjà en cache doit rester
            # identique, preuve qu'elle n'a pas été retraitée.
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
