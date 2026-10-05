"""Filtre de pertinence, fin passée et paragraphes du FNS."""
import unittest

from recherche.filtre import pertinence
from recherche.modele import Projet

CFG = {'institutions_toujours': ['HfH'], 'mots': ['autis'], 'mots_titre': ['wellbeing', 'accessib']}


def projet(titre, descriptif='', institutions='Universität X'):
    return Projet(source='t', source_id='1', url='', title=titre, descriptif=descriptif, institutions=institutions)


class TestFiltre(unittest.TestCase):
    def test_mot_sur_dans_le_resume(self):
        self.assertEqual(pertinence(projet('Titre neutre', 'enfants autistes'), CFG), 'autis')

    def test_mot_courant_dans_le_resume_ne_compte_pas(self):
        self.assertIsNone(pertinence(projet('Titre neutre', 'data made accessible'), CFG))

    def test_mot_courant_dans_le_titre(self):
        self.assertEqual(pertinence(projet('Assessment for wellbeing'), CFG), 'wellbeing')

    def test_hors_domaine_le_mot_courant_du_titre_ne_compte_pas(self):
        self.assertIsNone(pertinence(projet('Making design accessible'), CFG, avec_descriptif=False))

    def test_hors_domaine_le_mot_sur_du_titre_compte(self):
        self.assertEqual(pertinence(projet('Autism and sleep', 'autism'), CFG, avec_descriptif=False), 'autis')

    def test_hors_domaine_le_resume_n_est_pas_lu(self):
        self.assertIsNone(pertinence(projet('Titre neutre', 'autism'), CFG, avec_descriptif=False))

    def test_institution(self):
        self.assertEqual(pertinence(projet('x', institutions='HfH Zürich'), CFG), 'institution')

    def test_accents_et_debut_de_mot(self):
        self.assertIsNone(pertinence(projet('Titre', 'nautisme'), CFG))


class TestTermine(unittest.TestCase):
    def test_dates(self):
        from recherche.cli import _termine
        self.assertTrue(_termine(Projet(source='t', source_id='1', url='', title='x', fin='2020-06')))
        self.assertTrue(_termine(Projet(source='t', source_id='1', url='', title='x', fin='2021')))
        self.assertFalse(_termine(Projet(source='t', source_id='1', url='', title='x', fin='2999')))
        self.assertFalse(_termine(Projet(source='t', source_id='1', url='', title='x', fin='')))


class TestParagraphesFns(unittest.TestCase):
    def test_paragraphes_colles(self):
        from recherche.sources.snf import _paragraphes
        self.assertEqual(_paragraphes('verbessern.Die Studien'), 'verbessern.' + chr(10) * 2 + 'Die Studien')
        self.assertEqual(_paragraphes('z.B. PHZH.Neu'), 'z.B. PHZH.Neu')


if __name__ == '__main__':
    unittest.main()
