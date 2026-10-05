"""`estimer`, `tout` et etat.json : sortie JSON, codes de sortie, pannes locales. Sources factices, hors réseau."""
import contextlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest

from recherche import cli, tout
from recherche.modele import Projet
from recherche.reseau import Acces403, BudgetEpuise
from recherche.tests import outils

CHAMPS_ETAT = {'format', 'moissonneur', 'contrat', 'derniere_moisson', 'duree_s', 'requetes', 'propositions_ecrites', 'lot',
               'sources_en_echec', 'interrompu', 'erreur', 'purge'}


class ReseauFactice:
    requetes = 0


def projet(i, titre='Autismus in der Schule'):
    return Projet(source='faux', source_id=str(i), url=f'https://exemple.ch/{i}', title=titre, langue='de',
                  institutions='Universität Zürich', debut='2025', fin='2027', descriptif='Ein Projekt.')


def arborescence(racine):
    return sorted(os.path.relpath(os.path.join(r, n), racine) for r, ds, fs in os.walk(racine) for n in ds + fs)


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for nom in ('faux', 'autre'):
            self.addCleanup(sys.modules.pop, 'recherche.sources.' + nom, None)
        self.config = outils.config(self.tmp)
        self.evenements = []

    def tout(self, **kw):
        kw.setdefault('reseau', ReseauFactice())
        kw.setdefault('aujourdhui', '2026-10-04')
        return tout.tout(self.config, self.evenements.append, **kw)

    def etat(self):
        with open(os.path.join(self.config['propositions'], 'etat.json'), encoding='utf-8') as f:
            return json.load(f)


class TestEstimer(Base):
    def test_sans_requete_ni_ecriture(self):
        avant = arborescence(self.tmp)
        e = tout.estimer(self.config)
        self.assertEqual(arborescence(self.tmp), avant)
        self.assertEqual(e['type'], 'estimation')
        self.assertEqual(e['moissonneur'], 'recherche')
        self.assertEqual(e['contrat'], 1)
        for cle in ('pret', 'etapes', 'requetes_prevues', 'budget', 'depasse_le_budget', 'delai_s', 'duree_estimee_s',
                    'chemins', 'avertissements'):
            self.assertIn(cle, e)
        self.assertEqual(e['requetes_prevues'], sum(x['requetes_prevues'] for x in e['etapes']))
        self.assertEqual(e['chemins']['propositions'], self.config['propositions'])
        self.assertIn('decisions', e['chemins'])
        json.dumps(e)

    def test_bibliotheque_absente_bloque(self):
        e = tout.estimer(self.config)
        self.assertFalse(e['pret'])
        os.makedirs(os.path.join(self.config['bibliotheque'], 'forschung'))
        self.assertTrue(tout.estimer(self.config)['pret'])


class TestTout(Base):
    def setUp(self):
        super().setUp()
        os.makedirs(os.path.join(self.config['bibliotheque'], 'forschung'))

    def test_tout_bon(self):
        outils.injecter_source('faux', [[projet(1)]])
        resume, code = self.tout()
        self.assertEqual(code, 0)
        self.assertEqual(self.evenements[-1]['type'], 'resume')
        for ev in self.evenements:
            self.assertIn(ev['type'], ('progression', 'resume'))
            json.dumps(ev)
        self.assertTrue(all(ev['statut'] in ('ok', 'echec', 'budget') for ev in self.evenements[:-1]))
        etat = self.etat()
        self.assertLessEqual(CHAMPS_ETAT, set(etat))
        self.assertEqual(etat['format'], 'pronto-etat/1')
        self.assertEqual(etat['moissonneur'], 'recherche')
        self.assertEqual(etat['propositions_ecrites'], 1)
        self.assertEqual(etat['lot'], '2026-10-04-1.jsonl')
        self.assertEqual(etat['purge'], {'lots': [], 'decisions': []})
        self.assertIsNone(etat['interrompu'])
        self.assertNotIn('cran_defaut', etat)
        self.assertNotIn('crans', etat)
        self.assertEqual(resume['lot'], '2026-10-04-1.jsonl')

    def test_rien_de_neuf_pas_de_lot_mais_un_etat(self):
        outils.injecter_source('faux', [[]])
        resume, code = self.tout()
        self.assertEqual(code, 0)
        self.assertEqual(outils.lots(self.config['propositions']), [])
        self.assertEqual((self.etat()['propositions_ecrites'], self.etat()['lot']), (0, ''))

    def test_une_source_en_echec_n_arrete_pas_les_autres(self):
        self.config['sources'] = {'autre': {'actif': True}, 'faux': {'actif': True}}
        outils.injecter_source('autre', erreur=RuntimeError('page cassée'))
        outils.injecter_source('faux', [[projet(1)]])
        resume, code = self.tout()
        self.assertEqual(code, 1)
        self.assertEqual([s['source'] for s in self.etat()['sources_en_echec']], ['autre'])
        self.assertEqual(self.etat()['propositions_ecrites'], 1)

    def test_acces_refuse(self):
        outils.injecter_source('faux', erreur=Acces403('https://exemple.ch'))
        resume, code = self.tout()
        self.assertEqual(code, 3)
        self.assertEqual(self.etat()['interrompu'], '403')

    def test_budget_epuise(self):
        outils.injecter_source('faux', erreur=BudgetEpuise('budget'))
        resume, code = self.tout()
        self.assertEqual(code, 3)
        self.assertEqual(self.etat()['interrompu'], 'budget')
        self.assertEqual(self.evenements[0]['statut'], 'budget')

    def test_configuration_invalide(self):
        self.config['langue_par_defaut'] = 'en'
        resume, code = self.tout()
        self.assertEqual(code, 2)
        self.assertEqual(self.etat()['interrompu'], 'configuration')
        self.assertTrue(self.etat()['erreur'])

    def test_hors_ligne_n_appelle_aucune_source(self):
        outils.injecter_source('faux', erreur=AssertionError('appelée'))
        resume, code = self.tout(hors_ligne=True)
        self.assertEqual(code, 0)

    def test_purge_dans_le_resume(self):
        os.makedirs(self.config['propositions'])
        with open(os.path.join(self.config['propositions'], '2026-01-01-1.jsonl'), 'w', encoding='utf-8') as f:
            f.write('{}\n')
        outils.injecter_source('faux', [[]])
        self.tout()
        self.assertEqual(self.etat()['purge']['lots'], ['2026-01-01-1.jsonl'])


class TestCommandes(Base):
    def lancer(self, *args):
        racine = os.path.join(self.tmp, '_NewsUndActu')
        os.makedirs(os.path.join(racine, 'Fiches', 'forschung'), exist_ok=True)
        sortie = io.StringIO()
        with contextlib.redirect_stdout(sortie), contextlib.redirect_stderr(io.StringIO()):
            code = cli.main([*args, '--racine', racine, '--poste', 'p', '--compte', 'c',
                             '--base', os.path.join(self.tmp, 'base.sqlite')])
        lignes = [l for l in sortie.getvalue().split('\n') if l]
        return code, [json.loads(l) for l in lignes]

    @unittest.skipIf(os.name == 'nt', 'chemins Windows : la conversion /mnt/c ne vaut que dans la WSL')
    def test_chemin_windows_dans_la_wsl(self):
        self.assertEqual(cli.chemin_local('C:/Daten/x/Fiches', '/r'), '/mnt/c/Daten/x/Fiches')
        self.assertEqual(cli.chemin_local('C:\\Daten\\x', '/r'), '/mnt/c/Daten/x')
        self.assertEqual(cli.chemin_local('donnees/a', '/r'), '/r/donnees/a')
        self.assertEqual(cli.chemin_local('', '/r'), '')

    def test_estimer_une_ligne_json(self):
        code, objets = self.lancer('estimer')
        self.assertEqual(code, 0)
        self.assertEqual([o['type'] for o in objets], ['estimation'])

    def test_tout_hors_ligne_json_seulement(self):
        code, objets = self.lancer('tout', '--hors-ligne')
        self.assertEqual(code, 0)
        self.assertEqual(objets[-1]['type'], 'resume')
        self.assertTrue(os.path.isfile(os.path.join(self.tmp, '_NewsUndActu', '_Moissons', 'recherche', 'etat.json')))


if __name__ == '__main__':
    unittest.main()
