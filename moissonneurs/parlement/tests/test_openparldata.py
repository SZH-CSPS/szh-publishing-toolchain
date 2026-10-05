import tempfile
import unittest

from parlement.sources import openparldata as op
from parlement.tests.outils_test import reseau_factice, config_test


class TestParsing(unittest.TestCase):
    def test_localiser_prefere_le_francais_puis_replie(self):
        self.assertEqual(op.localiser({'de': 'a', 'fr': 'b'}), 'b')
        self.assertEqual(op.localiser({'de': 'a'}), 'a')
        self.assertEqual(op.localiser('x'), 'x')
        self.assertEqual(op.localiser(None), '')

    def test_vers_affaire_lit_les_champs(self):
        a = op.vers_affaire({'id': 1, 'body_key': 'GE', 'external_id': 77, 'number': 'M 5',
                             'title': {'fr': 'Titre'}, 'begin_date': '2025-03-04T00:00:00',
                             'updated_at': '2026-01-01T00:00:00', 'url_external': 'u'})
        self.assertEqual((a.body_key, a.external_id, a.number, a.title, a.date_depot, a.url_externe),
                         ('GE', '77', 'M 5', 'Titre', '2025-03-04', 'u'))

    def test_sans_identite_rend_none(self):
        self.assertIsNone(op.vers_affaire({'body_key': 'GE'}))
        self.assertIsNone(op.vers_affaire({'external_id': '1'}))
        self.assertIsNone(op.vers_affaire('pas un dict'))

    def test_extraire_liste_enveloppee_ou_nue(self):
        self.assertEqual(op.extraire_liste({'data': [1]}), [1])
        self.assertEqual(op.extraire_liste([2]), [2])
        self.assertEqual(op.extraire_liste({'x': 1}), [])


class TestMoissonner(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = self._t.name
        self.cfg = config_test(self.tmp)

    def tearDown(self):
        self._t.cleanup()

    def routes(self):
        return [('offset=0', 200, 'affairs_che_p1.json'), ('offset=2', 200, 'affairs_che_p2.json')]

    def test_pagine_et_s_arrete_sous_la_date_de_depart(self):
        r, srv = reseau_factice(self.routes(), self.tmp)
        etat = {}
        affaires = list(op.moissonner(self.cfg, r, set(), 'CHE', depuis='2025-01-01', etat=etat))
        self.assertEqual([a.external_id for a in affaires], ['20254057', '20260100'])
        self.assertEqual(etat['max_updated'], '2026-09-18T03:37:51')
        self.assertIn('sort_by=-begin_date', srv.urls[0])
        self.assertIn('body_key=CHE', srv.urls[0])

    def test_s_arrete_au_repere_sans_charger_la_page_suivante(self):
        r, srv = reseau_factice(self.routes(), self.tmp)
        affaires = list(op.moissonner(self.cfg, r, set(), 'CHE', repere='2026-09-15T00:00:00'))
        self.assertEqual([a.external_id for a in affaires], ['20254057'])
        self.assertEqual(len(srv.urls), 1)

    def test_sans_filtre_de_date_cote_serveur(self):
        r, srv = reseau_factice(self.routes(), self.tmp)
        list(op.moissonner(self.cfg, r, set(), 'CHE', depuis='2025-01-01'))
        for u in srv.urls:
            self.assertNotIn('__gte', u)
            self.assertNotIn('updated_at=', u.replace('sort_by=-begin_date', ''))

    def test_fiche_sans_identite_ecartee_sans_casser_le_lot(self):
        r, _ = reseau_factice(self.routes(), self.tmp)
        affaires = list(op.moissonner(self.cfg, r, set(), 'CHE', depuis='2000-01-01'))
        self.assertEqual([a.external_id for a in affaires], ['20254057', '20260100', '20240999'])

    def test_pages_initiales_en_cache_pages_incrementales_fraiches(self):
        r, srv = reseau_factice(self.routes(), self.tmp)
        list(op.moissonner(self.cfg, r, set(), 'CHE', depuis='2025-01-01'))
        n = len(srv.urls)
        list(op.moissonner(self.cfg, r, set(), 'CHE', depuis='2025-01-01'))
        self.assertEqual(len(srv.urls), n)           # rejouée depuis le cache
        list(op.moissonner(self.cfg, r, set(), 'CHE', repere='2026-09-15T00:00:00'))
        self.assertEqual(len(srv.urls), n + 1)       # incrémentale : une page fraîche

    def test_rechercher_encode_les_accents_en_utf8(self):
        r, srv = reseau_factice([('search=', 200, 'affairs_che_p2.json')], self.tmp)
        etat = {}
        list(op.rechercher(self.cfg, r, 'pédagogie spécialisée', 'fr', depuis='2000-01-01', etat=etat))
        self.assertIn('p%C3%A9dagogie%20sp%C3%A9cialis%C3%A9e', srv.urls[0])
        self.assertIn('search_language=fr', srv.urls[0])
        self.assertEqual(etat['total'], 3)


if __name__ == '__main__':
    unittest.main()


class TestFormeReelle(unittest.TestCase):
    """Forme constatée sur les premières réponses réelles de /affairs/ (02.10.2026)."""
    REEL = {'id': 285058, 'url_api': 'https://api.openparldata.ch/v1/affairs/285058', 'body_key': 'CHE',
            'external_id': 'proj/2025/105/cons_1', 'number': '2025/105',
            'title': {'de': 'Revision', 'fr': 'Révision'}, 'type_harmonized_id': 5,
            'begin_date': '2025-11-19T11:18:36', 'updated_at': '2026-10-02T05:24:24',
            'type_name': {'de': 'Vernehmlassung'},
            'url_external': {'de': 'https://fedlex.example.invalid/de', 'fr': 'https://fedlex.example.invalid/fr'}}

    def test_url_externe_par_langue_devient_une_chaine(self):
        a = op.vers_affaire(self.REEL)
        self.assertEqual(a.url_externe, 'https://fedlex.example.invalid/fr')
        self.assertNotIn('{', a.url_externe)

    def test_url_api_n_est_pas_une_page_source(self):
        a = op.vers_affaire(self.REEL)
        self.assertNotIn('api.openparldata.ch', a.url_externe)
        self.assertEqual(a.url_oparl, '')

    def test_date_de_depot_avec_heure(self):
        self.assertEqual(op.vers_affaire(self.REEL).date_depot, '2025-11-19')

    def test_url_externe_chaine_simple(self):
        d = dict(self.REEL, url_external='https://x.example.invalid/a')
        self.assertEqual(op.vers_affaire(d).url_externe, 'https://x.example.invalid/a')


class TestDateDeDepot(unittest.TestCase):
    """Constaté sur l'API réelle : updated_at est rafraîchi sur d'anciennes affaires ; la profondeur se juge sur le dépôt."""
    def test_une_affaire_ancienne_mais_recemment_modifiee_n_est_pas_gardee(self):
        import json
        payload = {'meta': {'has_more': False}, 'data': [
            {'body_key': 'CHE', 'external_id': 'a', 'begin_date': '2026-03-01T10:00:00', 'updated_at': '2026-10-02T05:00:00'},
            {'body_key': 'CHE', 'external_id': 'b', 'begin_date': '2019-03-01T10:00:00', 'updated_at': '2026-10-02T04:00:00'},
            {'body_key': 'CHE', 'external_id': 'c', 'updated_at': '2026-10-02T03:00:00'}]}
        with tempfile.TemporaryDirectory() as tmp:
            r, _ = reseau_factice([('offset=0', 200, json.dumps(payload).encode())], tmp)
            etat = {}
            ids = [a.external_id for a in op.moissonner(config_test(tmp), r, set(), 'CHE', depuis='2025-01-01', repere='2026-10-01T00:00:00', etat=etat)]
        self.assertEqual(ids, ['a', 'c'])                      # 'c' sans date de dépôt : gardée, on ne devine pas
        self.assertEqual(etat['max_updated'], '2026-10-02T05:00:00')

    def test_meme_regle_pour_la_recherche_serveur(self):
        import json
        payload = {'meta': {'total_records': 2, 'has_more': False}, 'data': [
            {'body_key': 'CHE', 'external_id': 'b', 'begin_date': '2019-03-01', 'updated_at': '2026-10-02T04:00:00'}]}
        with tempfile.TemporaryDirectory() as tmp:
            r, _ = reseau_factice([('search=', 200, json.dumps(payload).encode())], tmp)
            self.assertEqual(list(op.rechercher(config_test(tmp), r, 'x', 'de', depuis='2025-01-01')), [])


class TestTriParDateDeDepot(unittest.TestCase):
    """Mesuré sur l'API réelle : -updated_at est quasi aléatoire dans l'historique (rafraîchi en bloc), -begin_date est fiable."""
    def pages(self):
        import json
        p1 = {'meta': {'has_more': True, 'total_records': 4}, 'data': [
            {'body_key': 'CHE', 'external_id': 'n', 'updated_at': '2026-10-02T05:00:00'},                      # sans date : en tête
            {'body_key': 'CHE', 'external_id': 'a', 'begin_date': '2026-09-24T00:00:00', 'updated_at': '2026-10-02T05:00:00'}]}
        p2 = {'meta': {'has_more': True, 'total_records': 4}, 'data': [
            {'body_key': 'CHE', 'external_id': 'b', 'begin_date': '2024-12-31T00:00:00', 'updated_at': '2026-10-02T05:00:00'}]}
        p3 = {'meta': {'has_more': False}, 'data': [{'body_key': 'CHE', 'external_id': 'z', 'begin_date': '2020-01-01'}]}
        return [('offset=0', 200, json.dumps(p1).encode()), ('offset=2', 200, json.dumps(p2).encode()),
                ('offset=3', 200, json.dumps(p3).encode())]

    def test_la_recherche_trie_par_depot_et_s_arrete_au_premier_depot_trop_ancien(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, srv = reseau_factice(self.pages(), tmp)
            ids = [a.external_id for a in op.rechercher(config_test(tmp), r, 'x', 'de', depuis='2025-01-01')]
        self.assertEqual(ids, ['n', 'a'])
        self.assertTrue(all('sort_by=-begin_date' in u for u in srv.urls))
        self.assertEqual(len(srv.urls), 2)                  # la page de 2020 n'est jamais demandée

    def test_moisson_initiale_triee_par_depot_incrementale_par_mise_a_jour(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, srv = reseau_factice(self.pages(), tmp)
            list(op.moissonner(config_test(tmp), r, set(), 'CHE', depuis='2025-01-01'))
            self.assertIn('sort_by=-begin_date', srv.urls[0])
            r2, srv2 = reseau_factice(self.pages(), tmp + '/b')
            list(op.moissonner(config_test(tmp), r2, set(), 'CHE', repere='2026-10-01T00:00:00', depuis='2025-01-01'))
            self.assertIn('sort_by=-updated_at', srv2.urls[0])
