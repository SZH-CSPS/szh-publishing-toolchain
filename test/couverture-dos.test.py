"""Épaisseur du dos : la formule du tableur de l'imprimeur (Buchrueckenberechnung_2022).

    dos = 4 × g_couv/2000 × vol_couv  +  pages × g_int/2000 × vol_int  +  colle

Le grammage de couverture n'est pas un réglage : il suit le dos. 250 g jusqu'à 19,99 mm,
300 g dès 20 mm (un 300 g ne se plie pas sur un dos étroit). Lancer :
    python3 test/couverture-dos.test.py
"""
import importlib.util
import os
import sys
import unittest

ICI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'couverture', os.path.join(ICI, '..', 'pipeline', 'couverture.py'))
couverture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(couverture)
calculer_dos = couverture.calculer_dos


class Dos(unittest.TestCase):
    def test_exemple_du_tableur(self):
        # La feuille telle que livrée : 46 pages, Mondi 90 g vol. 1,27, couverture 250 g vol. 1,3.
        r = calculer_dos(46, {})
        self.assertAlmostEqual(r['dos_mm'], 0.65 + 46 * 90 / 2000 * 1.27, places=6)
        self.assertEqual(r['grammage_couverture'], 250)

    def test_dos_etroit_reste_en_250(self):
        # Moins de 6 mm (cas BRK) : toujours le papier le plus léger.
        self.assertEqual(calculer_dos(52, {})['grammage_couverture'], 250)

    def test_juste_sous_20_mm(self):
        r = calculer_dos(338, {})
        self.assertAlmostEqual(r['dos_mm'], 0.65 + 338 * 0.05715, places=6)
        self.assertEqual(r['grammage_couverture'], 250)

    def test_des_20_mm_passe_en_300_et_recalcule(self):
        r = calculer_dos(340, {})
        self.assertEqual(r['grammage_couverture'], 300)
        self.assertAlmostEqual(r['dos_mm'], 4 * 300 / 2000 * 1.3 + 340 * 0.05715, places=6)

    def test_reglages_du_livre(self):
        imp = {'grammage': 100, 'main': 1.23, 'couverture-volume': 1.2, 'colle-mm': 0.4}
        r = calculer_dos(120, imp)
        self.assertAlmostEqual(r['dos_mm'], 4 * 250 / 2000 * 1.2 + 120 * 100 / 2000 * 1.23 + 0.4,
                               places=6)

    def test_grammage_couverture_impose(self):
        r = calculer_dos(46, {'couverture-grammage': 300})
        self.assertEqual(r['grammage_couverture'], 300)
        self.assertAlmostEqual(r['dos_mm'], 0.78 + 46 * 0.05715, places=6)

    def test_dos_impose_gagne(self):
        r = calculer_dos(46, {'dos-mm': 9.5})
        self.assertEqual(r['dos_mm'], 9.5)
        self.assertEqual(r['grammage_couverture'], 250)

    def test_dos_impose_large_prend_300(self):
        self.assertEqual(calculer_dos(46, {'dos-mm': 21})['grammage_couverture'], 300)


if __name__ == '__main__':
    unittest.main(verbosity=2)
