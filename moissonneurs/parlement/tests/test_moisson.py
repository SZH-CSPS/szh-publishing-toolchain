import tempfile
import unittest

from parlement import moisson
from parlement.reseau import BudgetEpuise, CorpsAbandonne, Acces403
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import reseau_factice, config_test


class SourceFausse:
    """Un corps lève une erreur après sa première affaire ; les autres en rendent deux."""
    def __init__(self, erreurs):
        self.erreurs = erreurs
        self.appels = []

    def moissonner(self, config, reseau, connus, corps=None, repere=None, depuis='', etat=None):
        self.appels.append(corps)
        for i in (1, 2):
            yield Affaire(body_key=corps, external_id=str(i), updated_at=f'2026-01-0{i}T00:00:00',
                          brut={'i': i})
            if i == 1 and corps in self.erreurs:
                raise self.erreurs[corps]
        if etat is not None:
            etat['max_updated'] = '2026-01-02T00:00:00'


class TestMoisson(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.cfg = config_test(self._t.name)
        self.base = Base(':memory:')
        self.reseau, _ = reseau_factice([], self._t.name)

    def tearDown(self):
        self._t.cleanup()

    def test_un_corps_en_echec_n_arrete_pas_la_boucle(self):
        src = SourceFausse({'GE': CorpsAbandonne('429 cinq fois')})
        rapport, arret = moisson.moissonner_tous(self.cfg, self.base, self.reseau, src)
        self.assertIsNone(arret)
        self.assertEqual(src.appels, ['CHE', 'GE', 'VD'])
        statuts = {r[0]: r[1] for r in rapport}
        self.assertEqual(statuts, {'CHE': 'ok', 'GE': 'echec', 'VD': 'ok'})
        raison = self.base.c.execute("SELECT raison FROM executions WHERE corps='GE'").fetchone()[0]
        self.assertIn('429', raison)

    def test_format_inattendu_est_un_echec_de_corps(self):
        src = SourceFausse({'VD': KeyError('champ')})
        rapport, _ = moisson.moissonner_tous(self.cfg, self.base, self.reseau, src)
        self.assertEqual({r[0]: r[1] for r in rapport}['VD'], 'echec')

    def test_echec_sans_repere_et_reprise_au_tour_suivant(self):
        src = SourceFausse({'GE': CorpsAbandonne('x')})
        moisson.moissonner_tous(self.cfg, self.base, self.reseau, src)
        self.assertIsNone(self.base.repere('GE'))
        self.assertEqual(self.base.repere('CHE'), '2026-01-02T00:00:00')
        src2 = SourceFausse({})
        moisson.moissonner_tous(self.cfg, self.base, self.reseau, src2)
        self.assertEqual(src2.appels[0], 'GE')

    def test_budget_epuise_interrompt_proprement(self):
        src = SourceFausse({'GE': BudgetEpuise('plus de budget')})
        rapport, arret = moisson.moissonner_tous(self.cfg, self.base, self.reseau, src)
        self.assertEqual(arret, 'budget')
        self.assertEqual(src.appels, ['CHE', 'GE'])
        self.assertEqual(self.base.corps_en_echec(), ['GE'])

    def test_403_arrete_toute_la_moisson(self):
        src = SourceFausse({'CHE': Acces403(403, 'u')})
        rapport, arret = moisson.moissonner_tous(self.cfg, self.base, self.reseau, src)
        self.assertEqual(arret, '403')
        self.assertEqual(src.appels, ['CHE'])

    def test_villes_sans_cle_ne_sont_pas_moissonnees(self):
        self.cfg['villes'] = {'suivies': [{'nom': 'Zürich', 'canton': 'ZH', 'cle': ''},
                                          {'nom': 'Genève', 'canton': 'GE', 'cle': 'GE-city'}]}
        self.assertEqual(moisson.corps_suivis(self.cfg), ['CHE', 'GE', 'VD', 'GE-city'])


if __name__ == '__main__':
    unittest.main()


class TestApprofondir(unittest.TestCase):
    """Étendre la profondeur (`depuis` plus ancien) exige de rejouer la moisson initiale malgré le repère."""
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.cfg = config_test(self._t.name)
        self.base = Base(':memory:')
        self.reseau, _ = reseau_factice([], self._t.name)

    def tearDown(self):
        self._t.cleanup()

    def test_approfondir_ignore_le_repere_sans_le_perdre(self):
        class Espion(SourceFausse):
            def moissonner(self, config, reseau, connus, corps=None, repere=None, depuis='', etat=None):
                self.reperes = getattr(self, 'reperes', []) + [repere]
                yield from super().moissonner(config, reseau, connus, corps, repere, depuis, etat)
        src = Espion({})
        self.base.poser_repere('GE', '2026-12-31T00:00:00')
        moisson.moissonner_tous(self.cfg, self.base, self.reseau, src, ['GE'])
        moisson.moissonner_tous(self.cfg, self.base, self.reseau, src, ['GE'], approfondir=True)
        self.assertEqual(src.reperes, ['2026-12-31T00:00:00', None])
        self.assertEqual(self.base.repere('GE'), '2026-12-31T00:00:00')     # le repère le plus récent est gardé
