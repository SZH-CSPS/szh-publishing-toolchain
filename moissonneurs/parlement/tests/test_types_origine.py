"""Types d'origine sans type harmonisé : le libellé de la source donne le jeton d'instrument."""
import unittest

from parlement import correspondances as corr, export_propositions as ep
from parlement.tests.test_propositions import TestPropositions, aff

CAS = [
    ('BS', 'Regierungsratsbeschluss', None, 'objet-gouvernement'),
    ('NE', 'Rapport', None, 'objet-gouvernement'),
    ('SH', 'Vorlage', None, 'objet-gouvernement'),
    ('SH', 'Vorlage Parlament', None, 'objet-gouvernement'),
    ('AI', 'Bericht', 16, 'objet-gouvernement'),
    ('NW', 'Oberaufsicht', 16, 'objet-gouvernement'),
    ('FR', "Rapport d'activité", None, 'objet-gouvernement'),
    ('6621', 'Proposition CA au CM', None, 'objet-gouvernement'),
    ('TI', 'Messaggio', None, 'objet-gouvernement'),
    ('TI', 'Rapporti vari', None, 'objet-gouvernement'),
    ('6621', 'Pétition', None, 'petition'),
    ('SZ', 'Kleine Anfrage', None, 'question'),
    ('VD', 'Détermination', None, 'question'),
]
RESTE_VIDE = [('SO', 'Volksauftrag', 7), ('NE', 'Motion populaire', None), ('NE', 'Recommandation', None)]


class TestTypesOrigine(unittest.TestCase):
    def test_un_jeton_par_libelle(self):
        for corps, lib, harm, jeton in CAS:
            with self.subTest(libelle=lib):
                t = corr.type_effectif(corps, 'x', {'de': lib}, harm)
                self.assertEqual(t['jeton'], jeton)
                self.assertFalse(t['a_confirmer'])

    def test_le_reste_reste_vide(self):
        for corps, lib, harm in RESTE_VIDE:
            with self.subTest(libelle=lib):
                self.assertIsNone(corr.type_effectif(corps, 'x', {'de': lib}, harm)['jeton'])

    def test_un_type_harmonise_garde_la_priorite(self):
        self.assertEqual(corr.type_effectif('ZH', 'x', {'de': 'Rapport'}, 2)['jeton'], 'motion')


class TestDansLeLot(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_la_categorie_est_posee_sans_doute(self):
        self.ajouter(aff('BS', 'r1', 'Titre sans nom', number='1', harm=None, tn={'de': 'Regierungsratsbeschluss'}))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(p['valeurs']['categorie'], 'objet-gouvernement')
        self.assertNotIn('categorie', [d['champ'] for d in p['doutes']])


if __name__ == '__main__':
    unittest.main()
