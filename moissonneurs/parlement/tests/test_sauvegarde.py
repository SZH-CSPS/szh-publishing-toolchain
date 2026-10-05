import gzip
import os
import sqlite3
import tempfile
import unittest
from unittest import mock

from parlement import sauvegarde
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base


def base_remplie(chemin=':memory:', n=5):
    b = Base(chemin)
    for i in range(n):
        b.enregistrer_affaire(Affaire(body_key='GE', external_id=str(i), id_api=str(i), title=f'titre {i}',
                                      brut={'i': i}))
    b.commit()
    return b


class TestSauvegarde(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.rep = self._t.name

    def tearDown(self):
        self._t.cleanup()

    def test_copie_coherente_et_restauration(self):
        b = base_remplie(os.path.join(self.rep, 'p.sqlite'))
        gz = sauvegarde.sauvegarder(b, os.path.join(self.rep, 's'), date='2026-10-02')
        self.assertRegex(os.path.basename(gz), r'^parlement-2026-10-02T\d{6}\.sqlite\.gz$')
        b.fermer()
        cible = os.path.join(self.rep, 'restauree.sqlite')
        sauvegarde.restaurer(gz, cible)
        c = sqlite3.connect(cible)
        self.assertEqual(c.execute('SELECT COUNT(*) FROM affaires').fetchone()[0], 5)
        self.assertEqual(c.execute('PRAGMA integrity_check').fetchone()[0], 'ok')
        self.assertEqual(c.execute('SELECT COUNT(*) FROM bruts').fetchone()[0], 5)
        c.close()

    def test_sauvegarde_pendant_ecriture_en_attente_est_coherente(self):
        b = base_remplie(os.path.join(self.rep, 'p.sqlite'), n=3)
        b.enregistrer_affaire(Affaire(body_key='GE', external_id='99', id_api='99', title='non validé', brut={}))
        gz = sauvegarde.sauvegarder(b, os.path.join(self.rep, 's'), date='2026-10-02')   # commit avant copie
        cible = os.path.join(self.rep, 'r.sqlite')
        sauvegarde.restaurer(gz, cible)
        self.assertEqual(sqlite3.connect(cible).execute('SELECT COUNT(*) FROM affaires').fetchone()[0], 4)

    def test_rotation_garde_les_trois_dernieres(self):
        b = base_remplie()
        dossier = os.path.join(self.rep, 's')
        for jour in ('2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'):
            sauvegarde.sauvegarder(b, dossier, date=jour)
        jours = sorted(os.path.basename(p)[10:20] for p in sauvegarde.lister(dossier))
        self.assertEqual(jours, ['2026-09-30', '2026-10-01', '2026-10-02'])

    def test_rotation_ne_touche_pas_aux_autres_fichiers(self):
        b = base_remplie()
        dossier = os.path.join(self.rep, 's')
        os.makedirs(dossier)
        for nom in ('liste-2026-10.md', 'notes.txt'):
            open(os.path.join(dossier, nom), 'w').close()
        for jour in ('2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04'):
            sauvegarde.sauvegarder(b, dossier, date=jour)
        self.assertTrue(os.path.exists(os.path.join(dossier, 'liste-2026-10.md')))
        self.assertTrue(os.path.exists(os.path.join(dossier, 'notes.txt')))

    def test_aucun_fichier_temporaire_ne_reste_si_la_compression_echoue(self):
        b = base_remplie()
        dossier = os.path.join(self.rep, 's')
        with mock.patch('parlement.sauvegarde.shutil.copyfileobj', side_effect=OSError('disque plein')):
            with self.assertRaises(OSError):
                sauvegarde.sauvegarder(b, dossier, date='2026-10-02')
        self.assertEqual(os.listdir(dossier), [])

    def test_une_sauvegarde_incomplete_n_est_jamais_listee(self):
        dossier = os.path.join(self.rep, 's')
        os.makedirs(dossier)
        open(os.path.join(dossier, 'parlement-2026-10-02.sqlite.gz.tmp'), 'w').close()
        self.assertEqual(sauvegarde.lister(dossier), [])
        self.assertIsNone(sauvegarde.derniere(dossier))

    def test_restauration_refuse_une_sauvegarde_corrompue(self):
        mauvais = os.path.join(self.rep, 'parlement-2026-10-02.sqlite.gz')
        with gzip.open(mauvais, 'wb') as f:
            f.write(b'ceci n est pas une base sqlite' * 50)
        cible = os.path.join(self.rep, 'c.sqlite')
        with self.assertRaises(Exception):
            sauvegarde.restaurer(mauvais, cible)
        self.assertFalse(os.path.exists(cible))
        self.assertEqual([n for n in os.listdir(self.rep) if n.endswith('.restauration')], [])

    def test_deux_sauvegardes_le_meme_jour_la_premiere_n_est_pas_ecrasee(self):
        b = base_remplie()
        dossier = os.path.join(self.rep, 's')
        premiere = sauvegarde.sauvegarder(b, dossier, date='2026-10-02')
        with open(premiere, 'rb') as f:
            contenu = f.read()
        b.enregistrer_affaire(Affaire(body_key='GE', external_id='x', id_api='x', title='t', brut={}))
        with mock.patch('parlement.sauvegarde.time.strftime', return_value='120000'):
            a = sauvegarde.sauvegarder(b, dossier, date='2026-10-02')
            c = sauvegarde.sauvegarder(b, dossier, date='2026-10-02')      # même seconde : suffixe -2, -3
            d = sauvegarde.sauvegarder(b, dossier, date='2026-10-02')
        self.assertEqual([os.path.basename(x) for x in (a, c, d)],
                         ['parlement-2026-10-02T120000.sqlite.gz', 'parlement-2026-10-02T120000-2.sqlite.gz',
                          'parlement-2026-10-02T120000-3.sqlite.gz'])
        self.assertEqual(len(sauvegarde.lister(dossier)), 3)        # la rotation garde trois sauvegardes
        self.assertTrue(os.path.exists(c) and os.path.exists(d))
        self.assertTrue(contenu)          # la première (de la rotation) a pu partir, jamais être remplacée : voir le test suivant

    def test_aucun_ecrasement_meme_a_la_seconde_pres(self):
        b = base_remplie()
        dossier = os.path.join(self.rep, 's')
        with mock.patch('parlement.sauvegarde.time.strftime', return_value='120000'):
            un = sauvegarde.sauvegarder(b, dossier, date='2026-10-02', garder=10)
            with open(un, 'rb') as f:
                contenu = f.read()
            b.enregistrer_affaire(Affaire(body_key='GE', external_id='x', id_api='x', title='t', brut={}))
            deux = sauvegarde.sauvegarder(b, dossier, date='2026-10-02', garder=10)
        self.assertNotEqual(un, deux)
        with open(un, 'rb') as f:
            self.assertEqual(f.read(), contenu)

    def test_le_tri_melange_anciens_noms_sans_heure_horodates_et_suffixes(self):
        dossier = os.path.join(self.rep, 's')
        os.makedirs(dossier)
        for nom in ('parlement-2026-10-02.sqlite.gz', 'parlement-2026-10-02T080000.sqlite.gz',
                    'parlement-2026-10-02T080000-2.sqlite.gz', 'parlement-2026-10-02T080000-10.sqlite.gz',
                    'parlement-2026-10-01T235959.sqlite.gz', 'parlement-2026-10-03.sqlite.gz'):
            open(os.path.join(dossier, nom), 'w').close()
        self.assertEqual([os.path.basename(p) for p in sauvegarde.lister(dossier)],
                         ['parlement-2026-10-03.sqlite.gz', 'parlement-2026-10-02T080000-10.sqlite.gz',
                          'parlement-2026-10-02T080000-2.sqlite.gz', 'parlement-2026-10-02T080000.sqlite.gz',
                          'parlement-2026-10-02.sqlite.gz', 'parlement-2026-10-01T235959.sqlite.gz'])
        self.assertTrue(sauvegarde.derniere(dossier).endswith('parlement-2026-10-03.sqlite.gz'))


if __name__ == '__main__':
    unittest.main()
