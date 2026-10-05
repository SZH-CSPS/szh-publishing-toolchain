"""`moisson.py` avec les vrais moissonneurs, hors ligne, sur une racine jetable munie d'un socle pour chacun ; et le
fichier d'arrêt choisi par l'appelant (`--arret`). Aucune requête réseau."""
import io
import json
import os
import shutil
import tempfile
import unittest

import evenements as ev
import moisson
from tests.outils import Arbre, option, scenario_simple

RACINE_CODE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def socle(racine, m):
    chemin = os.path.join(racine, '_Moissons', m, '_partage', 'socle.json')
    os.makedirs(os.path.dirname(chemin))
    with open(chemin, 'w', encoding='utf-8') as f:
        json.dump({'format': 'pronto-socle/1', 'moissonneur': m, 'publie_le': '2026-10-01T08:00:00Z', 'poste': 'dev',
                   'compte': 'd', 'absorbes': {}, 'tables': {}}, f)


class TestMensuelleHorsLigne(unittest.TestCase):
    def test_les_deux_moissonneurs_finissent_en_zero_sur_l_etat_partage(self):
        tmp = tempfile.mkdtemp(prefix='passe-reelle-')
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        racine = os.path.join(tmp, '_NewsUndActu')
        for d in ('Fiches/forschung', 'Fiches/vorstoesse', '_Moissons/_Decisions'):
            os.makedirs(os.path.join(racine, d))
        for m in ('parlement', 'recherche'):
            socle(racine, m)
        sortie = io.StringIO()
        code = moisson.principal(['mensuelle', '--racine', racine, '--poste', 'p', '--compte', 'c', '--hors-ligne',
                                  '--attente-creneau', '0', '--evenements', 'json'], sortie=sortie,
                                 racine_code=RACINE_CODE)
        evts = [json.loads(l) for l in sortie.getvalue().splitlines() if l.strip()]
        for e in evts:
            self.assertEqual(ev.valider(e), [], e)
        fins = {e['moissonneur']: e for e in evts if e['type'] == 'moissonneur_fin'}
        self.assertEqual({m: f['code'] for m, f in fins.items()}, {'parlement': 0, 'recherche': 0}, evts)
        self.assertEqual(code, 0)


class TestFichierArret(unittest.TestCase):
    def test_le_fichier_de_l_appelant_passe_au_moissonneur_et_un_ancien_est_efface(self):
        a = Arbre({'recherche': scenario_simple('recherche')})
        self.addCleanup(a.effacer)
        arret = os.path.join(a.tmp, 'cockpit-arret')
        open(arret, 'w').close()          # reste d'une passe ancienne
        p = a.lancer('tout', 'recherche', *a.poste(), '--arret', arret)
        self.assertEqual(p.returncode, 0, p.stdout)
        self.assertEqual(option(a.argv_enfant('recherche'), '--arret'), arret)

    def test_le_creer_arrete_la_passe(self):
        sc = scenario_simple('recherche')
        sc['pas'].insert(0, {'poser_arret': True})
        sc['pas'].insert(1, {'requete': True})
        sc['sur_arret'] = [{'type': 'resume', 'moissonneur': 'recherche', 'contrat': 1, 'requetes': 0,
                            'propositions_ecrites': 0, 'lot': '', 'sources_en_echec': [], 'interrompu': 'arret',
                            'erreur': '', 'purge': {'lots': [], 'decisions': []}, 'etapes_en_echec': []}]
        a = Arbre({'recherche': sc})
        self.addCleanup(a.effacer)
        arret = os.path.join(a.tmp, 'cockpit-arret')
        p = a.lancer('tout', 'recherche', *a.poste(), '--arret', arret)
        self.assertEqual(p.returncode, 3, p.stdout)
        self.assertTrue(os.path.exists(arret))


if __name__ == '__main__':
    unittest.main()
