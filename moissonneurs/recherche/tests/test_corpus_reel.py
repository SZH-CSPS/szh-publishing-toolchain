"""Les analyseurs sur des pages réelles enregistrées hors dépôt (tmp/corpus-moissons/recherche/, non suivi) : seule la
forme du résultat est vérifiée, pour voir qu'une école a changé son gabarit. Sans ce corpus, le test saute."""
import os
import re
import unittest
import xml.etree.ElementTree as ET

from recherche.dates import valide
from recherche.sources import sites, skbf

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'tmp', 'corpus-moissons', 'recherche')
ANALYSEURS = {'hfh': sites._analyser_hfh, 'phbern': sites._analyser_phbern, 'ehb': sites._analyser_ehb,
              'phsg': sites._analyser_phsg, 'phfhnw': sites._analyser_phfhnw, 'phzh': sites._analyser_phzh,
              'hepvd': sites._analyser_hepvd}
ECOLES = {'hfh': 'Interkantonale Hochschule für Heilpädagogik', 'phbern': 'Pädagogische Hochschule Bern',
          'ehb': 'Eidgenössische Hochschule für Berufsbildung', 'phsg': 'Pädagogische Hochschule St. Gallen',
          'phfhnw': 'Pädagogische Hochschule FHNW', 'phzh': 'Pädagogische Hochschule Zürich',
          'hepvd': 'Haute école pédagogique du canton de Vaud'}


def _pages():
    return sorted(os.listdir(CORPUS)) if os.path.isdir(CORPUS) else []


def _lire(nom):
    with open(os.path.join(CORPUS, nom), encoding='utf-8') as f:
        return f.read()


@unittest.skipUnless(_pages(), 'corpus hors dépôt absent')
class TestCorpusReel(unittest.TestCase):
    def test_pages_projet_des_sites(self):
        vues = 0
        for nom in _pages():
            prefixe = nom.split('_', 1)[0]
            if prefixe not in ANALYSEURS or not nom.endswith('.html'):
                continue
            vues += 1
            with self.subTest(page=nom):
                r = ANALYSEURS[prefixe](_lire(nom), 'https://exemple.invalid/projet')
                self.assertLessEqual({'title', 'langue', 'institutions', 'debut', 'fin', 'descriptif', 'manques'}, set(r))
                if not r['title']:          # page sans contenu : l'analyseur doit dire pourquoi
                    self.assertTrue(r['manques'])
                    continue
                self.assertTrue(r['institutions'].startswith(ECOLES[prefixe]), r['institutions'])
                self.assertIn(r['langue'], ('de', 'fr', 'en', 'it'))
                for champ in ('debut', 'fin'):
                    self.assertTrue(r[champ] == '' or valide(r[champ]), (champ, r[champ]))
                self.assertTrue(r['descriptif'] or r['manques'])
        self.assertGreater(vues, 0)

    def test_skbf(self):
        for nom in _pages():
            with self.subTest(page=nom):
                if nom.startswith('skbf_liste'):
                    lignes = skbf._parse_liste(_lire(nom))
                    self.assertEqual(len(lignes), skbf.TAILLE_PAGE)
                    numeros = [n for n, _, _ in lignes]
                    self.assertEqual(numeros, sorted(numeros, reverse=True))
                elif nom.startswith('skbf_detail'):
                    p = skbf._projet_depuis_detail('26:000', '1', 'secours', _lire(nom))
                    self.assertNotEqual(p.title, 'secours')
                    self.assertTrue(re.fullmatch(r'\d{4}', p.debut), p.debut)
                    self.assertTrue(p.institutions)
                    self.assertNotIn('Description du projet', p.descriptif)

    def test_plans_de_site(self):
        for nom in _pages():
            if nom.endswith('.xml'):
                with self.subTest(page=nom):
                    with open(os.path.join(CORPUS, nom), 'rb') as f:
                        racine = ET.fromstring(f.read())
                    self.assertIn(racine.tag.rsplit('}', 1)[-1], ('sitemapindex', 'urlset'))


if __name__ == '__main__':
    unittest.main()
