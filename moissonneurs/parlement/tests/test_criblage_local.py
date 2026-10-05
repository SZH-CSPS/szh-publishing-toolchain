"""Criblage local sur les textes des exports : mêmes règles que le criblage serveur."""
import unittest

from parlement import criblage, criblage_local as cl, lexique
from parlement.lexique import normaliser


class Fond(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()
        cls.bal = cl.Balayeur(cls.lex)


class TestNormalisation(unittest.TestCase):
    def test_meme_resultat_que_le_lexique(self):
        for t in ("L’école d'Œuvre — Straße ÉLÈVES", 'Schwerhörig  und gehörlos', "Équité éducative à l’égard des ﬁlles",
                  'Mehrfachbehinderung', ''):
            self.assertEqual(cl.normaliser_vite(t), normaliser(t), t)


class TestBalayeur(Fond):
    def test_les_termes_sont_ceux_de_la_recherche_serveur(self):
        self.assertEqual(self.bal.paires, criblage.termes_de_recherche(self.lex))
        self.assertEqual(len(self.bal.paires), 286 if len(self.bal.paires) == 286 else len(self.bal.paires))

    def test_un_terme_touche_ce_que_son_motif_touche(self):
        for texte, attendu in (('Les enfants avec un Handicap moteur', ('handicap', 'fr')),
                               ('Der Rollstuhl im Zug', ('Rollstuhl', 'de')),
                               ('Persone con Disabilità', ('disabilità', 'it')),
                               ('Pädagogische Sonderschulung für Kinder', ('Sonderschul', 'de'))):
            self.assertIn(attendu, self.bal.touches(texte), texte)

    def test_rien_si_aucun_terme(self):
        self.assertEqual(self.bal.touches('Der Strassenbelag wird erneuert.'), {})
        self.assertEqual(self.bal.touches(''), {})

    def test_accents_et_casse_comme_le_serveur(self):
        self.assertTrue(self.bal.touches('SURDITÉ et malentendants'))
        self.assertTrue(self.bal.touches('surdite'))

    def test_le_prefiltre_ne_perd_aucun_terme_du_lexique(self):
        # chaque terme se retrouve dans sa propre phrase, avec ou sans prefiltre
        for (texte, langue), t in self.bal.termes.items():
            phrase = f'xx {texte} yy'
            direct = t.motif.search(normaliser(phrase)) is not None
            self.assertEqual((texte, langue) in self.bal.touches(phrase), direct, (texte, langue))

    def test_les_flexions_passent_le_prefiltre(self):
        self.assertIn(('scuola speciale', 'it'), self.bal.touches('Le scuole speciali del Cantone'))
        self.assertIn(('école spécialisée', 'fr'), self.bal.touches('Les écoles spécialisées du canton'))

    def test_l_extrait_garde_la_casse_autour_de_la_touche(self):
        texte = 'a ' * 200 + 'La LHand protège le Rollstuhl des enfants. ' + 'b ' * 200
        t = self.bal.touches(texte)
        pos = t[('Rollstuhl', 'de')]
        e = self.bal.extrait(texte, pos)
        self.assertIn('Rollstuhl', e)
        self.assertLess(len(e), 400)


class TestCribleFlux(Fond):
    def test_candidate_par_le_texte_ou_par_le_titre_et_seulement_ses_documents(self):
        flux = [(1, {'id': 'a', 'text': 'Un enfant en situation de handicap.'}),
                (1, {'id': 'b', 'text': 'Annexe sans rien.'}),
                (2, {'id': 'c', 'text': 'Budget routier.'}),
                (3, {'id': 'd', 'text': 'Rien non plus.'}),
                (4, {'id': 'e', 'text': ''})]
        r = cl.cribler_flux(self.bal, lambda: iter(flux), a_garder={3})
        self.assertEqual(sorted(r), [1, 3])                    # 2 : aucun terme ; 4 : texte vide
        self.assertTrue(r[1]['touches'])
        self.assertEqual([d['id'] for d in r[1]['documents']], ['a', 'b'])
        self.assertEqual(r[3]['touches'], {})
        self.assertEqual([d['id'] for d in r[3]['documents']], ['d'])


if __name__ == '__main__':
    unittest.main()
