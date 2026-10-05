import unittest

from parlement.sources.openparldata import Affaire
from parlement.stockage import Base


def affaire(**kw):
    d = dict(body_key='GE', external_id='42', id_api='7', number='M 1', title='t',
             type_name={'fr': 'Motion'}, type_harmonized_id=2, date_depot='2026-01-01',
             updated_at='2026-02-01T00:00:00', brut={'a': 1})
    d.update(kw)
    return Affaire(**d)


class TestStockage(unittest.TestCase):
    def setUp(self):
        self.b = Base(':memory:')

    def test_identite_est_corps_plus_identifiant_externe(self):
        self.assertEqual(self.b.enregistrer_affaire(affaire(body_key='GE', number='M 1')), 'nouvelle')
        self.assertEqual(self.b.enregistrer_affaire(affaire(body_key='VD', number='M 1')), 'nouvelle')
        n = self.b.c.execute('SELECT COUNT(*) FROM affaires').fetchone()[0]
        self.assertEqual(n, 2)

    def test_deuxieme_passage_identique_ne_change_rien(self):
        self.b.enregistrer_affaire(affaire())
        self.assertEqual(self.b.enregistrer_affaire(affaire()), 'inchangee')

    def test_brut_jamais_ecrase(self):
        self.b.enregistrer_affaire(affaire(brut={'v': 1}))
        self.assertEqual(self.b.enregistrer_affaire(affaire(brut={'v': 2})), 'changee')
        n = self.b.c.execute("SELECT COUNT(*) FROM bruts WHERE cle='affaire:GE:42'").fetchone()[0]
        self.assertEqual(n, 2)
        emp = self.b.c.execute('SELECT empreinte FROM affaires').fetchone()[0]
        self.assertEqual(self.b.brut('affaire:GE:42', emp), {'v': 2})

    def test_empreinte_sha256(self):
        emp, nouveau = self.b.enregistrer_brut('x', '{"a": 1}')
        self.assertEqual(len(emp), 64)
        self.assertTrue(nouveau)
        self.assertFalse(self.b.enregistrer_brut('x', '{"a": 1}')[1])

    def test_repere(self):
        self.assertIsNone(self.b.repere('GE'))
        self.b.poser_repere('GE', '2026-01-01T00:00:00')
        self.assertEqual(self.b.repere('GE'), '2026-01-01T00:00:00')

    def test_corps_en_echec_reprend_la_derniere_execution(self):
        i = self.b.debuter_execution('moissonner', 'VD')
        self.b.terminer_execution(i, 'echec', 'boum')
        i = self.b.debuter_execution('moissonner', 'GE')
        self.b.terminer_execution(i, 'ok')
        self.assertEqual(self.b.corps_en_echec(), ['VD'])
        i = self.b.debuter_execution('moissonner', 'VD')
        self.b.terminer_execution(i, 'ok')
        self.assertEqual(self.b.corps_en_echec(), [])


if __name__ == '__main__':
    unittest.main()
