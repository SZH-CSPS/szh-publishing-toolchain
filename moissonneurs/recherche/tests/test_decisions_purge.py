"""Décisions de la rédaction (lecture seule) et purge à six mois, sur une arborescence jetable."""
import os
import shutil
import tempfile
import time
import unittest

from recherche import db, decisions, purge
from recherche.tests import outils

AUJOURDHUI = '2026-10-04'


class TestDecisions(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.dossier = os.path.join(self.tmp, 'decisions')

    def test_lecture(self):
        outils.ecrire_decision(self.dossier, 'recherche:snf:1', 'refuse', 'hors-sujet')
        outils.ecrire_decision(self.dossier, 'recherche:snf:2', 'refuse', 'nimporte')
        outils.ecrire_decision(self.dossier, 'recherche:snf:3', 'accepte', None)
        outils.ecrire_decision(self.dossier, 'recherche:snf:4', 'peut-etre', None)
        with open(os.path.join(self.dossier, 'illisible.txt'), 'wb') as f:
            f.write(b'\xff\xfe\x00garbage')
        with open(os.path.join(self.dossier, 'sans-cle.txt'), 'w', encoding='utf-8') as f:
            f.write('Decision: refuse\n')
        lues = decisions.lire(self.dossier)
        self.assertEqual(set(lues), {'recherche:snf:1', 'recherche:snf:2', 'recherche:snf:3'})
        self.assertEqual(lues['recherche:snf:1']['motif'], 'hors-sujet')
        self.assertEqual(lues['recherche:snf:2']['motif'], 'autre')
        self.assertEqual(lues['recherche:snf:3']['decision'], 'accepte')

    def test_dossier_vide_ou_absent(self):
        self.assertEqual(decisions.lire(''), {})
        self.assertEqual(decisions.lire(os.path.join(self.tmp, 'absent')), {})

    def test_empreinte(self):
        self.assertEqual(decisions.empreinte_cle('parlement:openparldata:CHE:2026-0412'),
                         __import__('hashlib').sha256('parlement:openparldata:CHE:2026-0412'.encode()).hexdigest()[:16])


class TestPurge(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.config = outils.config(self.tmp)
        self.con = db.connecter(self.config['base'])
        self.addCleanup(self.con.close)
        os.makedirs(self.config['propositions'])

    def lot(self, nom, mtime=None, dossier=None):
        chemin = os.path.join(dossier or self.config['propositions'], nom)
        with open(chemin, 'w', encoding='utf-8') as f:
            f.write('{"format": "pronto-proposition/1"}\n')
        if mtime is not None:
            os.utime(chemin, (mtime, mtime))
        return chemin

    def purger(self):
        return purge.purger(self.config, self.con, aujourdhui=AUJOURDHUI)

    def test_vieux_lot_efface_lot_recent_garde(self):
        vieux = self.lot('2026-03-01-1.jsonl')
        limite = self.lot('2026-04-04-1.jsonl')
        recent = self.lot('2026-09-01-2.jsonl')
        r = self.purger()
        self.assertEqual(r['lots'], ['2026-03-01-1.jsonl'])
        self.assertFalse(os.path.exists(vieux))
        self.assertTrue(os.path.exists(limite))
        self.assertTrue(os.path.exists(recent))

    def test_age_lu_sur_le_nom_jamais_sur_le_mtime(self):
        tres_vieux = time.mktime((2020, 1, 1, 0, 0, 0, 0, 0, -1))
        recent_mais_vieux_fichier = self.lot('2026-09-01-1.jsonl', mtime=tres_vieux)
        vieux_mais_fichier_neuf = self.lot('2026-01-01-1.jsonl', mtime=time.time())
        r = self.purger()
        self.assertTrue(os.path.exists(recent_mais_vieux_fichier))
        self.assertFalse(os.path.exists(vieux_mais_fichier_neuf))
        self.assertEqual(r['lots'], ['2026-01-01-1.jsonl'])

    def test_nom_illisible_jamais_efface(self):
        tres_vieux = time.mktime((2020, 1, 1, 0, 0, 0, 0, 0, -1))
        for nom in ('notes.jsonl', '2026-13-40-1.jsonl', '2020-01-01.jsonl'):
            self.lot(nom, mtime=tres_vieux)
        self.assertEqual(self.purger()['lots'], [])
        self.assertEqual(len(os.listdir(self.config['propositions'])), 3)

    def test_lien_symbolique_qui_sort_du_dossier(self):
        dehors = os.path.join(self.tmp, 'dehors')
        os.makedirs(dehors)
        cible = self.lot('2026-01-01-1.jsonl', dossier=dehors)
        os.symlink(cible, os.path.join(self.config['propositions'], '2026-01-02-1.jsonl'))
        r = self.purger()
        self.assertEqual(r['lots'], [])
        self.assertTrue(os.path.exists(cible))
        self.assertTrue(os.path.lexists(os.path.join(self.config['propositions'], '2026-01-02-1.jsonl')))

    def test_dossier_de_lots_qui_est_un_lien_vers_ailleurs(self):
        ailleurs = os.path.join(self.tmp, 'ailleurs')
        os.makedirs(ailleurs)
        cible = self.lot('2026-01-01-1.jsonl', dossier=ailleurs)
        lien = os.path.join(self.tmp, 'lien-recherche')
        os.symlink(ailleurs, lien)
        self.config['propositions'] = lien
        self.assertEqual(self.purger()['lots'], [])
        self.assertTrue(os.path.exists(cible))

    def decision(self, cle, date, reportee=True):
        chemin = outils.ecrire_decision(self.config['decisions'], cle, date=date)
        if reportee:
            decisions.appliquer(self.config['decisions'], self.con)
        return chemin

    def test_vieille_decision_reportee_effacee_puis_toujours_exclue(self):
        chemin = self.decision('recherche:snf:1', '2026-01-15')
        r = self.purger()
        self.assertFalse(os.path.exists(chemin))
        self.assertEqual(r['decisions'], [decisions.empreinte_cle('recherche:snf:1')])
        self.assertIn('recherche:snf:1', decisions.appliquer(self.config['decisions'], self.con))

    def test_decision_non_reportee_gardee(self):
        chemin = self.decision('recherche:snf:2', '2026-01-15', reportee=False)
        self.purger()
        self.assertTrue(os.path.exists(chemin))

    def test_decision_a_date_illisible_gardee(self):
        for i, date in enumerate(('15.01.2026', '', '2026-02-30', None)):
            self.decision(f'recherche:snf:d{i}', date)
        self.assertEqual(self.purger()['decisions'], [])
        self.assertEqual(len(os.listdir(self.config['decisions'])), 4)

    def test_decision_recente_ou_d_un_autre_moissonneur_gardee(self):
        recente = self.decision('recherche:snf:3', '2026-09-30')
        autre = self.decision('parlement:openparldata:CHE:1', '2026-01-15')
        self.assertEqual(self.purger()['decisions'], [])
        self.assertTrue(os.path.exists(recente))
        self.assertTrue(os.path.exists(autre))

    def test_decision_lien_symbolique_jamais_effacee(self):
        dehors = os.path.join(self.tmp, 'dehors-dec')
        cible = outils.ecrire_decision(dehors, 'recherche:snf:9', date='2026-01-15')
        os.makedirs(self.config['decisions'], exist_ok=True)
        os.symlink(cible, os.path.join(self.config['decisions'], 'lien.txt'))
        decisions.appliquer(self.config['decisions'], self.con)
        self.purger()
        self.assertTrue(os.path.exists(cible))


if __name__ == '__main__':
    unittest.main()
