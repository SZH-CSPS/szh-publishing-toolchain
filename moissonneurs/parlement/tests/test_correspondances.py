import unittest

from parlement import correspondances as c


class TestCorrespondances(unittest.TestCase):
    def test_types_harmonises_vers_jetons(self):
        for hid, jeton in ((2, 'motion'), (3, 'postulat'), (8, 'interpellation'), (12, 'question'),
                           (10, 'question-heure'), (4, 'initiative-parlementaire'), (11, 'petition')):
            self.assertEqual(c.type_effectif('BE', '1', {}, hid)['jeton'], jeton)

    def test_type_sans_jeton_n_est_pas_invente(self):
        t = c.type_effectif('BE', '1', {'de': 'Recommandation'}, 16)
        self.assertIsNone(t['jeton'])

    def test_standesinitiative_si_harmonise_nul(self):
        t = c.type_effectif('CHE', '1', {'fr': 'Initiative déposée par un canton'}, None)
        self.assertEqual(t['jeton'], 'initiative-cantonale')

    def test_standesinitiative_ne_prime_pas_sur_un_type_harmonise(self):
        t = c.type_effectif('CHE', '1', {'de': 'Standesinitiative'}, 2)
        self.assertEqual(t['jeton'], 'motion')

    def test_prefixes_geneve(self):
        attendu = {'M': 'motion', 'PO': 'postulat', 'IUE': 'interpellation', 'QUE': 'question',
                   'Q': 'question', 'P': 'petition', 'PL': 'objet-gouvernement'}
        for pref, jeton in attendu.items():
            self.assertEqual(c.type_effectif('GE', f'{pref} 123', {}, None)['jeton'], jeton, pref)
        t = c.type_effectif('GE', 'C 36194', {}, None)      # consultation cantonale (constaté sur l'API : C 36194)
        self.assertEqual(t['jeton'], 'objet-gouvernement')
        self.assertTrue(t['a_confirmer'])

    def test_prefixe_geneve_ignore_hors_geneve(self):
        self.assertIsNone(c.type_effectif('VD', 'M 5', {}, None)['jeton'])

    def test_canton(self):
        cfg = {'moisson': {'confederation': 'CHE'},
               'villes': {'suivies': [{'nom': 'Zürich', 'canton': 'ZH', 'cle': 'ZH-city'}]}}
        self.assertEqual(c.canton_de('CHE', cfg), 'CH')
        self.assertEqual(c.canton_de('BE', cfg), 'BE')
        self.assertEqual(c.canton_de('ZH-city', cfg), 'ZH')

    def test_langue_fiche(self):
        self.assertEqual(c.langue_fiche('TI', 'TI', 'Mozione', ''), ('fr', 'it'))
        self.assertEqual(c.langue_fiche('ZH', 'ZH', 'x', ''), ('de', 'de'))
        self.assertEqual(c.langue_fiche('GE', 'GE', 'x', ''), ('fr', 'fr'))
        self.assertEqual(c.langue_fiche('CHE', 'CH', {'de': 'Titel'}, ''), ('de', 'de'))
        self.assertEqual(c.langue_fiche('CHE', 'CH', {'fr': 'Titre'}, ''), ('fr', 'fr'))
        self.assertEqual(c.langue_fiche('CHE', 'CH', {'fr': 'a', 'de': 'b'}, 'de'), ('de', 'de'))
        self.assertEqual(c.langue_fiche('BE', 'BE', 'Pour les élèves de la ville', '')[0], 'fr')


if __name__ == '__main__':
    unittest.main()
