"""`moisson.py import-fns` : l'export FNS téléchargé à la main, contrôlé avant tout, lu sous créneau sans aucune requête,
dédoublonné contre l'état partagé. Un CSV fictif, avec un nom fictif qui ne doit apparaître nulle part."""
import csv
import io
import json
import os
import shutil
import tempfile
import unittest
from unittest import mock

import evenements as ev
import moisson
from recherche import import_fns
from recherche.sources import snf

RACINE_CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NOM_FICTIF = 'Zorglub Fictivus'
COLONNES = ['GrantNumber', 'Title', 'TitleEnglish', 'ResponsibleApplicantName', 'ResearchInstitution', 'Institute',
            'MainDiscipline', 'AllDisciplines', 'EffectiveGrantStartDate', 'EffectiveGrantEndDate', 'CallDecisionYear',
            'CallEndDate', 'State', 'Keywords', 'Abstract', 'LaySummary_De', 'LaySummary_En', 'LaySummary_Fr',
            'LaySummary_It']
PERTINENTE = {
    'GrantNumber': '900001', 'Title': 'Autismus und inklusive Schule im Zauberwald',
    'TitleEnglish': 'Autism and inclusive schooling in the magic forest', 'ResponsibleApplicantName': NOM_FICTIF,
    'ResearchInstitution': 'Hochschule Exempelstadt - HSE', 'Institute': 'Lehrstuhl für Heilpädagogik Prof. Bruno Muster',
    'MainDiscipline': 'Education and learning sciences', 'AllDisciplines': '10500',
    'EffectiveGrantStartDate': '2025-01-01T00:00:00Z', 'EffectiveGrantEndDate': '2027-12-31T00:00:00Z',
    'CallDecisionYear': '2024', 'CallEndDate': '2024-04-01T00:00:00Z', 'State': 'ongoing', 'Keywords': 'Autismus',
    'Abstract': 'Ein erfundenes Abstract zur Sonderpädagogik.', 'LaySummary_De': 'Ein erfundenes Projekt zu Autismus.',
    'LaySummary_En': '', 'LaySummary_Fr': '', 'LaySummary_It': ''}


def hors_sujet(i):
    return dict(PERTINENTE, GrantNumber=str(800000 + i), Title=f'Quantenoptik in Kristallen {i}',
                TitleEnglish=f'Quantum optics in crystals {i}', Institute='Physikalisches Institut',
                MainDiscipline='Condensed matter physics', AllDisciplines='20202', Keywords='Optik',
                Abstract='Laser.', LaySummary_De='Laser.', CallEndDate='2025-10-01T00:00:00Z')


def ecrire_csv(chemin, lignes, colonnes=COLONNES, sep=';', abimees=0):
    with open(chemin, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=colonnes, delimiter=sep, extrasaction='ignore')
        w.writeheader()
        for l in lignes:
            w.writerow(l)
        for _ in range(abimees):
            f.write('999;trop;court\r\n')


class Fond(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='import-fns-')
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.racine = os.path.join(self.tmp, '_NewsUndActu')
        self.moissons = os.path.join(self.racine, '_Moissons')
        for d in ('Fiches/forschung', '_Moissons/recherche/_partage', '_Moissons/_Decisions'):
            os.makedirs(os.path.join(self.racine, d))
        with open(os.path.join(self.moissons, 'recherche', '_partage', 'socle.json'), 'w', encoding='utf-8') as f:
            json.dump({'format': 'pronto-socle/1', 'moissonneur': 'recherche', 'publie_le': '2026-10-01T08:00:00Z',
                       'poste': 'dev', 'compte': 'd', 'absorbes': {}, 'tables': {}}, f)
        self.csv = os.path.join(self.tmp, 'grants_with_abstracts.csv')
        ecrire_csv(self.csv, [PERTINENTE] + [hors_sujet(i) for i in range(30)])
        for nom, valeur in (('TAILLE_MIN', 0), ('LIGNES_MIN', 20)):
            p = mock.patch.object(snf, nom, valeur)
            p.start()
            self.addCleanup(p.stop)

    def importer(self, fichier=None):
        sortie = io.StringIO()
        code = moisson.principal(['import-fns', '--fichier', fichier or self.csv, '--racine', self.racine,
                                  '--poste', 'Poste A', '--compte', 'compte-a', '--attente-creneau', '0',
                                  '--evenements', 'json'], sortie=sortie, racine_code=RACINE_CODE)
        evts = [json.loads(l) for l in sortie.getvalue().splitlines() if l.strip()]
        for e in evts:
            self.assertEqual(ev.valider(e), [], e)
        return code, evts

    def de_type(self, evts, t):
        return [e for e in evts if e['type'] == t]

    def textes_partages(self):
        """Tout ce que l'import a écrit dans _Moissons, mis bout à bout."""
        morceaux = []
        for racine, _, noms in os.walk(self.moissons):
            for n in noms:
                with open(os.path.join(racine, n), encoding='utf-8') as f:
                    morceaux.append(f.read())
        return '\n'.join(morceaux)


class TestImport(Fond):
    def test_import_sans_requete_ni_nom(self):
        code, evts = self.importer()
        self.assertEqual(code, 0, evts)
        debut, = self.de_type(evts, 'debut')
        self.assertEqual(debut['declencheur'], 'import-fns')
        self.assertEqual(debut['moissonneurs'], ['recherche'])
        self.assertEqual(debut['budget_mois'], {})
        self.assertEqual([c['etat'] for c in self.de_type(evts, 'creneau')], ['pris', 'retire'])
        lot, = self.de_type(evts, 'lot')
        self.assertEqual(lot['propositions'], 1)
        self.assertTrue(all(e['requetes'] == 0 for e in self.de_type(evts, 'etape')))
        self.assertFalse(os.path.exists(os.path.join(self.moissons, 'recherche', '_partage', 'requetes')))
        partage_texte = self.textes_partages()
        self.assertIn('900001', partage_texte)
        self.assertEqual(partage_texte.count('Zorglub'), 0)
        self.assertEqual(partage_texte.count('Muster'), 0)
        note = import_fns.derniere(self.racine)
        self.assertEqual((note['poste'], note['compte'], note['nouvelles'], note['lot']),
                         ('Poste A', 'compte-a', 1, lot['chemin']))
        self.assertEqual(note['fichier']['lignes'], 31)
        self.assertEqual(note['fichier']['max_call_end'], '2025-10')
        self.assertEqual(note['fichier']['appels'], {'2024-04': 1, '2025-10': 30})
        nom = os.listdir(import_fns.dossier(self.racine))
        self.assertEqual(nom, [f"{note['date']}-poste-a__compte-a.json"])

    def test_un_second_import_ne_repropose_rien(self):
        self.importer()
        code, evts = self.importer()
        self.assertEqual(code, 0, evts)
        self.assertEqual(self.de_type(evts, 'lot'), [])
        self.assertEqual(import_fns.derniere(self.racine)['nouvelles'], 0)
        self.assertFalse([a for a in self.de_type(evts, 'avertissement') if 'plus ancien' in a['message']])

    def test_un_fichier_plus_ancien_est_signale_sans_refus(self):
        self.importer()
        ancien = os.path.join(self.tmp, 'ancien.csv')
        ecrire_csv(ancien, [PERTINENTE] + [dict(hors_sujet(i), CallEndDate='2025-04-01') for i in range(30)])
        code, evts = self.importer(ancien)
        self.assertEqual(code, 0, evts)
        self.assertTrue([a for a in self.de_type(evts, 'avertissement') if 'plus ancien' in a['message']])

    def test_etat_absent(self):
        os.remove(os.path.join(self.moissons, 'recherche', '_partage', 'socle.json'))
        code, evts = self.importer()
        self.assertEqual((code, [e['raison'] for e in self.de_type(evts, 'refus')]), (2, ['etat-absent']))


class TestRefus(Fond):
    def refus(self, fichier=None):
        code, evts = self.importer(fichier)
        self.assertEqual(code, 2)
        self.assertEqual([e['type'] for e in evts], ['refus'])
        self.assertEqual(evts[0]['raison'], 'fichier-invalide')
        self.assertFalse(os.path.exists(os.path.join(self.moissons, '_Creneau')))
        return evts[0]['detail']

    def test_fichier_introuvable(self):
        self.assertIn('introuvable', self.refus(os.path.join(self.tmp, 'absent.csv')))

    def test_export_sans_resumes(self):
        ecrire_csv(self.csv, [PERTINENTE] * 30, colonnes=[c for c in COLONNES if c not in snf.RESUMES])
        self.assertIn('sans résumés', self.refus())

    def test_colonnes_manquantes(self):
        ecrire_csv(self.csv, [PERTINENTE] * 30, colonnes=[c for c in COLONNES if c not in ('Title', 'Abstract')])
        detail = self.refus()
        self.assertIn('colonnes manquantes', detail)
        self.assertIn('Title', detail)

    def test_mauvais_separateur(self):
        ecrire_csv(self.csv, [PERTINENTE] * 30, sep=',')
        self.assertIn('séparées par', self.refus())

    def test_trop_petit(self):
        with mock.patch.object(snf, 'TAILLE_MIN', 50_000_000):
            self.assertIn('trop petit', self.refus())

    def test_trop_peu_de_lignes(self):
        ecrire_csv(self.csv, [PERTINENTE] * 5)
        self.assertIn('5 lignes seulement', self.refus())

    def test_trop_de_lignes_illisibles(self):
        ecrire_csv(self.csv, [hors_sujet(i) for i in range(100)], abimees=2)
        self.assertIn('2 lignes illisibles sur 102', self.refus())

    def test_une_ligne_illisible_sur_cent_passe(self):
        ecrire_csv(self.csv, [PERTINENTE] + [hors_sujet(i) for i in range(99)], abimees=1)
        code, evts = self.importer()
        self.assertEqual(code, 0, evts)
        self.assertTrue([a for a in self.de_type(evts, 'avertissement') if '1 ligne(s) illisible(s)' in a['message']])


class TestPasseSansBase(unittest.TestCase):
    """La passe mensuelle de la recherche n'a pas de base locale : seul le poste de dev en exige une."""

    def test_sans_base_seulement_avec_l_etat_partage(self):
        from recherche import etat, tout
        from recherche.tests import outils as outils_recherche
        with tempfile.TemporaryDirectory() as d:
            config = outils_recherche.config(d, base='', sources={})
            os.makedirs(os.path.join(config['bibliotheque'], 'forschung'))
            _, code = tout.tout(config, lambda e: None, hors_ligne=True, ouvrir=etat.base_en_memoire)
            self.assertEqual(code, 0)
            resume, code = tout.tout(config, lambda e: None, hors_ligne=True)
            self.assertEqual((code, resume['erreur']), (2, 'ConfigurationInvalide: base : chemin vide'))


class TestColonnes(unittest.TestCase):
    def test_liste_blanche_figee(self):
        self.assertEqual(set(snf.COLONNES_LUES), {
            'GrantNumber', 'Title', 'TitleEnglish', 'ResearchInstitution', 'Institute', 'MainDiscipline',
            'AllDisciplines', 'EffectiveGrantStartDate', 'EffectiveGrantEndDate', 'State', 'Keywords',
            'CallDecisionYear', 'CallEndDate', 'Abstract', 'LaySummary_De', 'LaySummary_Fr', 'LaySummary_En',
            'LaySummary_It'})
        self.assertNotIn('ResponsibleApplicantName', snf.COLONNES_LUES)

    def test_une_ligne_ne_porte_que_la_liste_blanche(self):
        with tempfile.TemporaryDirectory() as d:
            chemin = os.path.join(d, 'g.csv')
            ecrire_csv(chemin, [PERTINENTE])
            ligne, = list(snf.lignes(chemin))
        self.assertLessEqual(set(ligne), set(snf.COLONNES_LUES))
        self.assertNotIn(NOM_FICTIF, json.dumps(ligne, ensure_ascii=False))


if __name__ == '__main__':
    unittest.main()
