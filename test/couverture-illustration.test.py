"""Décalage de l'illustration de couverture : couverture.illustration-x-mm / -y-mm.

Le décalage est posé en propriétés CSS sur <html>, identiques pour les quatre sorties
(impression, écran, PNG de 1re et de 4e), et couverture.css les applique par translate.
Lancer :
    python3 test/couverture-illustration.test.py
"""
import importlib.util
import os
import re
import unittest

ICI = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location(
    'couverture', os.path.join(ICI, '..', 'pipeline', 'couverture.py'))
couverture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(couverture)
CSS = os.path.join(ICI, '..', 'pipeline', 'styles', 'livre', 'couverture.css')


class Decalage(unittest.TestCase):
    def test_css_produit(self):
        buch = {'couverture': {'illustration-x-mm': 12.5, 'illustration-y-mm': -4}}
        self.assertEqual(couverture.variables_illustration(buch),
                         '--szh-couv-illus-x: 12.5mm; --szh-couv-illus-y: -4mm;')

    def test_valeurs_lues_en_texte(self):
        buch = {'couverture': {'illustration-x-mm': '12.5', 'illustration-y-mm': '-4'}}
        self.assertEqual(couverture.decalage_illustration(buch), (12.5, -4.0))

    def test_sans_cle_pas_de_decalage(self):
        for buch in ({}, {'couverture': None}, {'couverture': {'illustration-x-mm': ''}}):
            self.assertEqual(couverture.variables_illustration(buch),
                             '--szh-couv-illus-x: 0mm; --szh-couv-illus-y: 0mm;')

    def test_la_feuille_applique_les_deux_variables(self):
        css = open(CSS, encoding='utf-8').read()
        self.assertRegex(css, r'transform:\s*translate\(var\(--szh-couv-illus-x\),\s*'
                              r'var\(--szh-couv-illus-y\)\)')
        # Le cadre qui coupe au fond perdu du plat de 1re.
        self.assertTrue(re.search(r'\.szh-couv-1re-cadre\s*\{[^}]*overflow:\s*hidden', css))


if __name__ == '__main__':
    unittest.main(verbosity=2)
