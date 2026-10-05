"""FNS : aucune colonne à nom de personne n'entre, ni dans le lot ni dans la base ; liste blanche des colonnes lues.
Un export fictif d'une ligne, hors réseau."""
import csv
import json
import os
import shutil
import tempfile
import types
import unittest

from recherche import db, personnes, tout
from recherche.sources import snf
from recherche.tests import outils

# Les colonnes que snf.py a le droit de lire. Une colonne de plus se décide ici, après avoir vérifié qu'elle ne porte
# aucun nom de personne.
COLONNES_LUES = {'GrantNumber', 'Title', 'TitleEnglish', 'ResearchInstitution', 'Institute', 'MainDiscipline',
                 'AllDisciplines', 'EffectiveGrantStartDate', 'EffectiveGrantEndDate', 'CallDecisionYear', 'State',
                 'Keywords', 'Abstract', 'LaySummary_De', 'LaySummary_En', 'LaySummary_Fr', 'LaySummary_It',
                 'CallEndDate'}   # la clôture de l'appel : l'indice de fraîcheur de l'export, noté à l'import
LIGNE = {
    'GrantNumber': '900001', 'Title': 'Autismus und Lesen im Zauberwald',
    'TitleEnglish': 'Autism and reading in the magic forest', 'ResponsibleApplicantName': 'Anna Beispiel',
    'ResearchInstitution': 'Hochschule Exempelstadt - HSE',
    'Institute': 'Lehrstuhl für Heilpädagogik Prof. Bruno Muster', 'MainDiscipline': 'Education and learning sciences',
    'AllDisciplines': '10500', 'EffectiveGrantStartDate': '2025-01-01T00:00:00Z',
    'EffectiveGrantEndDate': '2027-12-31T00:00:00Z', 'CallDecisionYear': '2024', 'State': 'ongoing',
    'Keywords': 'Lesen', 'Abstract': 'Ein erfundenes Abstract.', 'LaySummary_De': 'Ein erfundenes Projekt zum Lesen.',
    'LaySummary_En': '', 'LaySummary_Fr': '', 'LaySummary_It': '',
}


class Espion(dict):
    lues = set()

    def get(self, cle, *defaut):
        Espion.lues.add(cle)
        return super().get(cle, *defaut)

    def __getitem__(self, cle):
        Espion.lues.add(cle)
        return super().__getitem__(cle)


class LecteurEspion(csv.DictReader):
    def __next__(self):
        return Espion(super().__next__())


class TestSnf(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        chemin = os.path.join(self.tmp, 'grants.csv')
        with open(chemin, 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=list(LIGNE), delimiter=';')
            w.writeheader()
            w.writerow(LIGNE)
        self.config = outils.config(self.tmp, sources={'snf': {
            'actif': True, 'depuis': '2024-01-01', 'disciplines': ['Education and learning sciences'],
            'codes_disciplines': ['105'], 'fichier_local': chemin}})
        os.makedirs(os.path.join(self.config['bibliotheque'], 'forschung'))
        Espion.lues = set()
        vrai = snf.csv
        snf.csv = types.SimpleNamespace(DictReader=LecteurEspion)
        self.addCleanup(setattr, snf, 'csv', vrai)

    def passe(self):
        resume, code = tout.tout(self.config, lambda e: None, aujourdhui='2026-10-04',
                                 reseau=types.SimpleNamespace(requetes=0, details={}))
        self.assertEqual(code, 0)
        self.assertEqual(resume['propositions_ecrites'], 1)
        dossier = self.config['propositions']
        lot = ''.join(outils.lire_lot(os.path.join(dossier, n))[0] for n in outils.lots(dossier))
        con = db.connecter(self.config['base'])
        self.addCleanup(con.close)
        base = json.dumps([dict(r) for r in con.execute('SELECT * FROM projets')], ensure_ascii=False)
        return lot, base

    def test_aucun_nom_dans_le_lot_ni_dans_la_base(self):
        lot, base = self.passe()
        for nom in ('Beispiel', 'Muster'):
            self.assertEqual(lot.count(nom), 0, nom)
            self.assertEqual(base.count(nom), 0, nom)
        self.assertIn('Lehrstuhl für Heilpädagogik', base)

    def test_colonnes_lues_dans_la_liste_blanche(self):
        self.passe()
        self.assertTrue(Espion.lues)
        self.assertLessEqual(Espion.lues, COLONNES_LUES)
        self.assertNotIn('ResponsibleApplicantName', Espion.lues)


class TestRetirerNoms(unittest.TestCase):
    def test_cas(self):
        self.assertEqual(personnes.retirer_noms('Lehrstuhl für Heilpädagogik Prof. Bruno Muster'),
                         'Lehrstuhl für Heilpädagogik')
        self.assertEqual(personnes.retirer_noms('Prof. Dr. Anna Beispiel'), '')
        self.assertEqual(personnes.retirer_noms('Institut für Bildung'), 'Institut für Bildung')
        self.assertEqual(personnes.retirer_noms(''), '')


if __name__ == '__main__':
    unittest.main()
