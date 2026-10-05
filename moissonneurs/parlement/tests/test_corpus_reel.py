"""Sur un corpus réel gardé hors dépôt (tmp/corpus-moissons/parlement/, non suivi) : pages de l'API et lots déjà écrits.
On vérifie la forme et le contrôle des noms, jamais un contenu. Sans ce corpus, le test saute."""
import json
import os
import unittest

from parlement import correspondances as corr, noms
from parlement.sources import openparldata

CORPUS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '..', 'tmp', 'corpus-moissons', 'parlement')


def _fichiers(suffixe):
    return sorted(n for n in os.listdir(CORPUS) if n.endswith(suffixe)) if os.path.isdir(CORPUS) else []


@unittest.skipUnless(_fichiers('.json') or _fichiers('.jsonl'), 'corpus hors dépôt absent')
class TestCorpusReel(unittest.TestCase):
    def test_pages_de_l_api(self):
        for nom in _fichiers('.json'):
            with self.subTest(page=nom), open(os.path.join(CORPUS, nom), encoding='utf-8') as f:
                for d in openparldata.extraire_liste(json.load(f)):
                    a = openparldata.vers_affaire(d)
                    self.assertIsNotNone(a)
                    self.assertTrue(a.body_key and a.external_id)

    def test_lots_sans_nom_d_auteur_ni_texte_balise(self):
        vide = noms.Contexte(set(), set())
        for nom in _fichiers('.jsonl'):
            with open(os.path.join(CORPUS, nom), encoding='utf-8') as f:
                for ligne in f:
                    p = json.loads(ligne)
                    titres = [p['valeurs'].get('title') or ''] + list((p.get('titres') or {}).values())
                    with self.subTest(cle=p['cle']):
                        self.assertEqual(noms.analyser(titres, vide)[0], [])
                        for t in titres:
                            self.assertEqual(corr.sans_personnes(t), t)
                        self.assertNotIn('<', p.get('texte_depose', '')[:500])


if __name__ == '__main__':
    unittest.main()
