"""Budget du mois partagé pendant la passe : les compteurs des autres postes sont relus toutes les 50 requêtes, et la
passe s'arrête net quand la somme atteint budget − marge. Bilan de chaque passe dans `_partage/passes/`."""
import datetime
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import creneau
import partage
from parlement import cli as cli_parlement
from parlement.reseau import BudgetEpuise as EpuiseParlement, Reseau as ReseauParlement
from recherche import cli as cli_recherche
from recherche.reseau import BudgetEpuise as EpuiseRecherche, Reseau as ReseauRecherche
from tests.outils import Arbre, de_type, evenements, scenario_simple

MOIS = '2026-11'


class Fond(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='budget-')
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)

    def compteur(self, cle, n, m='parlement'):
        partage.ecrire_requetes(self.tmp, m, MOIS, cle, n, datetime.datetime(2026, 11, 2, tzinfo=datetime.timezone.utc))

    def budget(self, plafond, **kw):
        return partage.BudgetPartage(self.tmp, 'parlement', MOIS, 'moi__a', 800, 120, plafond, **kw)


class TestBudgetPartage(Fond):
    def test_les_autres_postes_sont_relus_toutes_les_cinquante_requetes(self):
        self.compteur('autre__b', 300)
        b = self.budget(380)
        self.assertEqual(b(0), 380)
        self.compteur('autre__b', 500)            # l'autre poste dépense 200 pendant la passe
        self.assertEqual(b(49), 380)              # pas encore relu
        self.assertEqual(b(50), 180)              # 800 − 120 − 500
        self.compteur('autre__b', 700)
        self.assertEqual(b(99), 180)
        self.assertEqual(b(100), 0)               # la somme dépasse budget − marge : arrêt net

    def test_le_compteur_de_ce_poste_n_est_lu_qu_au_depart(self):
        self.compteur('moi__a', 100)
        self.compteur('autre__b', 200)
        b = self.budget(380)
        self.assertEqual(b(0), 380)
        self.compteur('moi__a', 150)              # moisson.py compte la passe en cours : rien n'est retranché deux fois
        self.assertEqual(b(50), 380)

    def test_jamais_au_dessus_du_plafond_recu(self):
        b = self.budget(10)
        self.assertEqual(b(0), 10)
        self.assertEqual(b(50), 10)

    def test_sans_plafond_ni_budget_aucune_borne(self):
        self.assertIsNone(partage.budget_partage(self.tmp, 'parlement', 'p', 'c', 800, 120, None))
        self.assertIsNone(partage.budget_partage(self.tmp, 'parlement', 'p', 'c', 0, 120, 10))


class TestReseaux(Fond):
    def test_parlement_s_arrete_a_la_borne(self):
        r = ReseauParlement({'delai': 0, 'budget': 1000}, ouvrir=lambda url, h: (200, {}, b'{}'),
                            dormir=lambda s: None, borne=lambda n: 3)
        for i in range(3):
            r.get(f'https://exemple.invalid/{i}', cache=False)
        with self.assertRaises(EpuiseParlement):
            r.get('https://exemple.invalid/4', cache=False)
        self.assertEqual(r.requetes, 3)

    def test_recherche_s_arrete_a_la_borne(self):
        r = ReseauRecherche({'cache': os.path.join(self.tmp, 'cache'), 'budget': 0, 'plafond': None},
                            borne=lambda n: 2)
        r._compter()
        r._compter()
        with self.assertRaises(EpuiseRecherche):
            r._compter()


class TestBranchement(Fond):
    def test_chaque_moissonneur_recoit_la_borne_en_passe(self):
        racine = os.path.join(self.tmp, 'NewsUndActu')
        os.makedirs(os.path.join(racine, '_Moissons'))
        recus = {}
        for nom, module, cli in (('parlement', 'parlement.tout.tout', cli_parlement),
                                 ('recherche', 'recherche.tout.tout', cli_recherche)):
            def faux(*a, borne=None, **k):
                recus[nom] = borne
                return {}, 0
            with mock.patch(module, faux):
                cli.main(['tout', '--racine', racine, '--poste', 'p', '--compte', 'c', '--cache',
                          os.path.join(self.tmp, 'cache'), '--plafond', '40'])
        self.assertIsInstance(recus['parlement'], partage.BudgetPartage)
        self.assertEqual((recus['parlement'].budget, recus['parlement'].marge, recus['parlement'].plafond),
                         (800, creneau.MARGE_REQUETES, 40))
        self.assertIsInstance(recus['recherche'], partage.BudgetPartage)


class TestBilanDePasse(unittest.TestCase):
    def test_un_bilan_par_moissonneur_et_par_passe(self):
        sc = scenario_simple('recherche')
        sc['pas'][-1]['ligne']['requetes'] = 3          # le résumé donne les requêtes réelles de la passe
        a = Arbre({'recherche': sc})
        self.addCleanup(a.effacer)
        p = a.lancer('tout', 'recherche', *a.poste('Poste A', 'compte-a'))
        self.assertEqual(p.returncode, 0, p.stdout)
        debut, = de_type(evenements(p.stdout), 'debut')
        d = a.chemin('recherche', '_partage', 'passes', debut['heure'][:7])
        nom, = os.listdir(d)
        self.assertTrue(nom.startswith('poste-a__compte-a-'), nom)
        with open(os.path.join(d, nom), encoding='utf-8') as f:
            bilan = json.load(f)
        self.assertEqual({k: bilan[k] for k in ('format', 'moissonneur', 'poste', 'compte', 'debut', 'code', 'lot',
                                                'propositions', 'requetes', 'a_blanc')},
                         {'format': 'pronto-passe/1', 'moissonneur': 'recherche', 'poste': 'Poste A',
                          'compte': 'compte-a', 'debut': debut['heure'], 'code': 0,
                          'lot': 'recherche/2026-11-01-1.jsonl', 'propositions': 2, 'requetes': 3, 'a_blanc': False})


if __name__ == '__main__':
    unittest.main()
