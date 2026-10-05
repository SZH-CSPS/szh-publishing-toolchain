"""Compteur : requêtes de la passe mensuelle face au budget du mois."""
import unittest

from parlement import passe_mensuelle as pm
from parlement.stockage import Base


class TestCompteur(unittest.TestCase):
    def test_total_du_mois_budget_et_restant(self):
        base = Base(':memory:')
        for requetes in (10, 30):
            ident = base.debuter_execution('mensuelle')
            base.terminer_execution(ident, 'budget', '', requetes, 0)
        mois = base.c.execute("SELECT substr(debut, 1, 10) FROM executions").fetchone()[0]
        c = pm.compteur({'mensuelle': {'budget': 800}}, base, aujourdhui=mois)
        self.assertEqual((c['requetes'], c['budget'], c['restant']), (40, 800, 760))
        self.assertEqual(len(c['dernieres']), 2)
        self.assertEqual(pm.compteur({'mensuelle': {'budget': 800}}, base, aujourdhui='2099-01-01')['requetes'], 0)
        base.fermer()


if __name__ == '__main__':
    unittest.main()
