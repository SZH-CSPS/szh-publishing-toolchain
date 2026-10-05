"""État partagé : fusion commutative et idempotente, journaux, socle réservé au poste de développement, budget sommé.

La fixture `fixtures/partage-exemple/` est commune : le cockpit la lit aussi (même résultat attendu, attendu.json)."""
import datetime
import json
import os
import random
import shutil
import tempfile
import unittest
from unittest import mock

import partage

FIXTURE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures', 'partage-exemple')
M = 'exemple'


def lire(nom):
    with open(os.path.join(FIXTURE, nom), encoding='utf-8') as f:
        return json.load(f)


SCHEMA = lire('schema.json')
ATTENDU = lire('attendu.json')


class Base(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.racine = self._t.name
        self.addCleanup(self._t.cleanup)
        shutil.copytree(os.path.join(FIXTURE, '_partage'), partage.dossier(self.racine, M))

    def socle_et_journaux(self):
        return partage.lire_socle(self.racine, M), partage.lire_journaux(self.racine, M)


class TestFixtureCommune(Base):
    def test_fusion_attendue(self):
        etat, _, _ = partage.charger(self.racine, M, SCHEMA)
        self.assertEqual(etat, ATTENDU['etat'])

    def test_absorbes_apres_lecture(self):
        socle, journaux = self.socle_et_journaux()
        self.assertEqual(partage.absorbes_de(socle, journaux), ATTENDU['absorbes_apres_lecture'])

    def test_budget_somme_tous_les_postes(self):
        r = ATTENDU['requetes']
        moissons = os.path.join(self.racine, '_Moissons')
        self.assertEqual(partage.somme_mois(moissons, M, r['mois'], 'poste-a__x'), (r['somme'], r['propre_poste_a']))
        self.assertEqual(partage.somme_mois(moissons, M, '2026-12', 'poste-a__x'), (0, 0))


class TestFusion(Base):
    def test_commutative(self):
        socle, journaux = self.socle_et_journaux()
        attendu = partage.fusionner(socle, journaux, SCHEMA)
        hasard = random.Random(7)
        for _ in range(20):
            noms = list(journaux)
            hasard.shuffle(noms)
            melange = {n: hasard.sample(journaux[n], len(journaux[n])) for n in noms}
            self.assertEqual(partage.fusionner(socle, melange, SCHEMA), attendu)

    def test_idempotente(self):
        socle, journaux = self.socle_et_journaux()
        attendu = partage.fusionner(socle, journaux, SCHEMA)
        double = {n: l + l for n, l in journaux.items()}
        self.assertEqual(partage.fusionner(socle, double, SCHEMA), attendu)
        copie = dict(journaux, **{'poste-b__y-conflit': journaux['poste-b__y']})
        self.assertEqual(partage.fusionner(socle, copie, SCHEMA), attendu)

    def test_le_statut_fort_l_emporte_sur_l_heure(self):
        etat = partage.fusionner(None, {'a': [{'n': 1, 'maj': '2026-11-01T00:00:00Z', 't': 'projets', 'k': ['9'],
                                                'r': {'id': '9', 'statut': 'propose'}}],
                                         'b': [{'n': 1, 'maj': '2026-11-09T00:00:00Z', 't': 'projets', 'k': ['9'],
                                                'r': {'id': '9', 'statut': 'vu'}}]}, SCHEMA)
        self.assertEqual(etat['projets']['["9"]']['statut'], 'propose')

    def test_un_socle_plus_ancien_n_efface_pas_un_journal(self):
        """Le poste de dev publie un socle qui n'a pas lu la dernière ligne d'un journal : elle reste."""
        socle = {'publie_le': '2026-11-05T00:00:00Z', 'absorbes': {'a': 1},
                 'tables': {'projets': [{'id': '4', 'statut': 'vu', 'titre': 'socle'}]}}
        journaux = {'a': [{'n': 1, 'maj': '2026-11-01T00:00:00Z', 't': 'projets', 'k': ['4'],
                           'r': {'id': '4', 'statut': 'vu', 'titre': 'absorbe'}},
                          {'n': 2, 'maj': '2026-11-04T00:00:00Z', 't': 'projets', 'k': ['4'],
                           'r': {'id': '4', 'statut': 'vu', 'titre': 'journal'}}]}
        self.assertEqual(partage.fusionner(socle, journaux, SCHEMA)['projets']['["4"]']['titre'], 'journal')
        socle['absorbes'] = {'a': 2}
        self.assertEqual(partage.fusionner(socle, journaux, SCHEMA)['projets']['["4"]']['titre'], 'socle')

    def test_le_socle_le_plus_recent_fait_foi(self):
        d = partage.dossier(self.racine, M)
        socle = lire(os.path.join('_partage', 'socle.json'))
        socle.update(publie_le='2026-11-04T00:00:00Z', tables={'projets': [{'id': '7', 'statut': 'vu'}]})
        with open(os.path.join(d, 'socle-POSTE-B.json'), 'w', encoding='utf-8') as f:
            json.dump(socle, f)
        self.assertEqual(partage.lire_socle(self.racine, M)['publie_le'], '2026-11-04T00:00:00Z')

    def test_sans_socle_etat_absent(self):
        with self.assertRaises(partage.EtatAbsent):
            partage.charger_etat(os.path.join(self.racine, 'vide'), M, SCHEMA)
        self.assertFalse(partage.etat_present(os.path.join(self.racine, 'vide'), M))
        self.assertTrue(partage.etat_present(self.racine, M))


class TestJournal(Base):
    def test_publier_ajoute_au_seul_journal_du_poste(self):
        autre = os.path.join(partage.dossier(self.racine, M), 'journal', 'poste-b__y.jsonl')
        with open(autre, 'rb') as f:
            avant = f.read()
        n = partage.publier_journal(self.racine, M, 'poste-a__x',
                                    {'projets': [{'id': '5', 'statut': 'vu'}], 'retirees': {'decisions': [['k9']]}},
                                    SCHEMA, maintenant='2026-11-06T00:00:00Z')
        self.assertEqual(n, 2)
        lignes = partage.lire_journal(os.path.join(partage.dossier(self.racine, M), 'journal', 'poste-a__x.jsonl'))
        # les lignes déjà absorbées par le socle (n ≤ 2) sont sorties ; la suite continue la numérotation
        self.assertEqual([l['n'] for l in lignes], [3, 4, 5, 6, 7])
        self.assertEqual(lignes[-1], {'n': 7, 'maj': '2026-11-06T00:00:00Z', 't': 'decisions', 'k': ['k9'], 'r': None})
        with open(autre, 'rb') as f:
            self.assertEqual(f.read(), avant)
        etat, _, _ = partage.charger(self.racine, M, SCHEMA)
        self.assertIn('["5"]', etat['projets'])

    def test_rien_a_publier_rien_d_ecrit(self):
        chemin = os.path.join(partage.dossier(self.racine, M), 'journal', 'poste-z__w.jsonl')
        self.assertEqual(partage.publier_journal(self.racine, M, 'poste-z__w', {}, SCHEMA), 0)
        self.assertFalse(os.path.exists(chemin))

    def test_sans_socle_pas_de_journal(self):
        with self.assertRaises(partage.EtatAbsent):
            partage.publier_journal(os.path.join(self.racine, 'vide'), M, 'p__c', {'projets': []}, SCHEMA)


class TestSocleReserveAuPosteDeDev(Base):
    ANNONCE = {'poste': 'Poste-Dev', 'compte': 'Dev'}

    def test_une_passe_mensuelle_ne_l_ecrit_jamais(self):
        chemin = os.path.join(partage.dossier(self.racine, M), 'socle.json')
        with open(chemin, 'rb') as f:
            avant = f.read()
        with mock.patch.dict(os.environ, {partage.VARIABLE_PASSE: '1'}):
            with self.assertRaises(partage.SocleInterdit):
                partage.publier_socle(self.racine, M, 'Poste-Dev', 'Dev', {}, {}, self.ANNONCE)
        with open(chemin, 'rb') as f:
            self.assertEqual(f.read(), avant)

    def test_sans_creneau_ou_sous_celui_d_un_autre_refuse(self):
        env = {k: v for k, v in os.environ.items() if k != partage.VARIABLE_PASSE}
        with mock.patch.dict(os.environ, env, clear=True):
            for annonce in (None, {'poste': 'Autre', 'compte': 'Dev'}):
                with self.assertRaises(partage.SocleInterdit):
                    partage.publier_socle(self.racine, M, 'Poste-Dev', 'Dev', {}, {}, annonce)
            chemin = partage.publier_socle(self.racine, M, 'Poste-Dev', 'Dev', {'projets': []}, {'a': 3}, self.ANNONCE,
                                           maintenant='2026-11-07T00:00:00Z')
        s = partage.lire_socle(self.racine, M)
        self.assertEqual((s['format'], s['publie_le'], s['absorbes']), (partage.FORMAT_SOCLE, '2026-11-07T00:00:00Z',
                                                                       {'a': 3}))
        self.assertFalse(os.path.exists(chemin + '.tmp'))


class TestMoissonMarqueLaPasse(unittest.TestCase):
    def test_chaque_moissonneur_lance_porte_la_variable_de_passe(self):
        import moisson
        with mock.patch('subprocess.Popen') as popen:
            moisson.lancer_enfant(['x'], '.', None)
        self.assertEqual(popen.call_args.kwargs['env'][partage.VARIABLE_PASSE], '1')


class TestCompteur(unittest.TestCase):
    def test_ecrire_requetes_puis_somme(self):
        with tempfile.TemporaryDirectory() as tmp:
            t = datetime.datetime(2026, 11, 3, 10, tzinfo=datetime.timezone.utc)
            partage.ecrire_requetes(tmp, M, '2026-11', 'p__c', 40, t)
            partage.ecrire_requetes(tmp, M, '2026-11', 'q__c', 2, t)
            self.assertEqual(partage.somme_mois(tmp, M, '2026-11', 'p__c'), (42, 40))


if __name__ == '__main__':
    unittest.main()
