import os
import tempfile
import unittest
import urllib.error

from parlement import reseau
from parlement.reseau import (Reseau, BudgetEpuise, CorpsAbandonne,
                              Acces403, ErreurHTTP, construire_url)


class Faux:
    """Serveur scripté : une liste de (code, en-têtes, corps) rendue dans l'ordre."""
    def __init__(self, *reponses):
        self.reponses = list(reponses)
        self.appels = []

    def __call__(self, url, en_tetes):
        self.appels.append((url, en_tetes))
        r = self.reponses.pop(0)
        if isinstance(r, Exception):
            raise r
        return r


def cfg(tmp, **kw):
    c = {'delai': 2.0, 'budget': 10, 'cache': os.path.join(tmp, 'cache'),
         'journal': os.path.join(tmp, 'req.jsonl')}
    c.update(kw)
    return c


class Horloge:
    def __init__(self):
        self.t = 0.0
        self.pauses = []

    def now(self):
        return self.t

    def dormir(self, s):
        self.pauses.append(s)
        self.t += s


class TestReseau(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.tmp = self._t.name
        self.h = Horloge()

    def tearDown(self):
        self._t.cleanup()

    def r(self, faux, **kw):
        return Reseau(cfg(self.tmp, **kw), ouvrir=faux, dormir=self.h.dormir, horloge=self.h.now)

    def test_requete_anonyme_sans_user_agent_maison(self):
        faux = Faux((200, {}, b'{}'))
        self.r(faux).get('http://x/a')
        self.assertNotIn('User-Agent', faux.appels[0][1])

    def test_delai_de_deux_secondes_entre_requetes(self):
        faux = Faux((200, {}, b'1'), (200, {}, b'2'))
        r = self.r(faux)
        r.get('http://x/a')
        r.get('http://x/b')
        self.assertEqual(len(self.h.pauses), 1)
        self.assertAlmostEqual(self.h.pauses[0], 2.0)

    def test_cache_jamais_retelecharge(self):
        faux = Faux((200, {}, b'corps'))
        r = self.r(faux)
        self.assertEqual(r.get('http://x/a'), b'corps')
        self.assertEqual(r.get('http://x/a'), b'corps')
        self.assertEqual(r.requetes, 1)
        self.assertEqual(r.depuis_cache, 1)
        # un autre client sur le même dossier de cache ne retélécharge pas non plus
        r2 = self.r(Faux())
        self.assertEqual(r2.get('http://x/a'), b'corps')
        self.assertEqual(r2.requetes, 0)

    def test_sans_cache_retelecharge(self):
        faux = Faux((200, {}, b'1'), (200, {}, b'2'))
        r = self.r(faux)
        r.get('http://x/a', cache=False)
        self.assertEqual(r.get('http://x/a', cache=False), b'2')
        self.assertEqual(r.requetes, 2)

    def test_budget_epuise_arrete_proprement(self):
        faux = Faux((200, {}, b'1'), (200, {}, b'2'))
        r = self.r(faux, budget=2)
        r.get('http://x/a')
        r.get('http://x/b')
        with self.assertRaises(BudgetEpuise):
            r.get('http://x/c')
        self.assertEqual(len(faux.appels), 2)

    def test_429_respecte_retry_after(self):
        faux = Faux((429, {'Retry-After': '7'}, b''), (200, {}, b'ok'))
        r = self.r(faux)
        self.assertEqual(r.get('http://x/a'), b'ok')
        self.assertIn(7.0, self.h.pauses)

    def test_503_sans_retry_after_double_le_delai(self):
        faux = Faux((503, {}, b''), (200, {}, b'ok'))
        r = self.r(faux)
        r.get('http://x/a')
        self.assertIn(4.0, self.h.pauses)

    def test_cinq_echecs_abandonnent_le_corps(self):
        faux = Faux(*[(429, {}, b'')] * 5)
        r = self.r(faux)
        with self.assertRaises(CorpsAbandonne):
            r.get('http://x/a')
        self.assertEqual(r.requetes, 5)

    def test_erreur_reseau_compte_comme_echec(self):
        faux = Faux(*[urllib.error.URLError('coupé')] * 5)
        with self.assertRaises(CorpsAbandonne):
            self.r(faux).get('http://x/a')

    def test_403_leve_acces403(self):
        with self.assertRaises(Acces403):
            self.r(Faux((403, {}, b''))).get('http://x/a')

    def test_404_leve_erreur_http(self):
        with self.assertRaises(ErreurHTTP) as c:
            self.r(Faux((404, {}, b''))).get('http://x/a')
        self.assertEqual(c.exception.code, 404)

    def test_journal_ecrit_une_ligne_par_requete(self):
        faux = Faux((200, {}, b'12345'))
        r = self.r(faux)
        r.get('http://x/a')
        r.get('http://x/a')
        with open(os.path.join(self.tmp, 'req.jsonl'), encoding='utf-8') as f:
            lignes = f.read().splitlines()
        self.assertEqual(len(lignes), 2)
        self.assertIn('"cache": true', lignes[1])

    def test_user_agent_explicite_pour_sources_publiques(self):
        faux = Faux((200, {}, b'x'))
        r = Reseau(cfg(self.tmp), user_agent='moissonneur-essai/0.1',
                   ouvrir=faux, dormir=self.h.dormir, horloge=self.h.now)
        r.get('http://x/a')
        self.assertEqual(faux.appels[0][1]['User-Agent'], 'moissonneur-essai/0.1')

    def test_url_encodee_en_utf8(self):
        u = construire_url('http://h/v1', '/affairs/', {'search': 'Sonderpädagogik', 'limit': 5})
        self.assertIn('Sonderp%C3%A4dagogik', u)
        self.assertIn('limit=5', u)
        u = construire_url('http://h/v1', 'affairs', {'search': 'pédagogie spécialisée'})
        self.assertIn('p%C3%A9dagogie%20sp%C3%A9cialis%C3%A9e', u)


if __name__ == '__main__':
    unittest.main()
