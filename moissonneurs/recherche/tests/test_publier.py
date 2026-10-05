"""`python3 -B -m recherche publier` : le socle publié depuis une base de développement fictive, sous créneau, puis lu
par une passe mensuelle hors ligne ; refusé sous une passe ; identique à l'octet sans changement ; journaux absorbés."""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

import commun
import evenements as ev
import moisson
import partage
from recherche import db, etat
from recherche.modele import Projet

MOISSONNEURS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def projet(i, titre, source='site:essai'):
    return Projet(source=source, source_id=str(i), url=f'https://exemple.ch/{i}', title=titre, langue='de',
                  institutions='Universität Musterstadt', debut='2025', fin='2027', descriptif='Ein Projekt.')


class Fond(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp(prefix='publier-')
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.racine = os.path.join(self.tmp, '_NewsUndActu')
        for d in ('Fiches/forschung', '_Moissons/_Decisions'):
            os.makedirs(os.path.join(self.racine, d))
        self.base = os.path.join(self.tmp, 'dev', 'harvest.sqlite')
        con = db.connecter(self.base)
        db.enregistrer(con, projet(1, 'Autismus in der Schule'), 'nouveau', 'mot : autis')
        db.enregistrer(con, projet(2, 'Strassenbau im Kanton'), 'hors-sujet', '')
        i, _ = db.enregistrer(con, projet(3, 'Inklusion im Kindergarten'), 'nouveau', 'mot : inklusi')
        db.marquer_proposition(con, i, 'propose', 'recherche:site:essai:3', '2026-09-01-1.jsonl')
        db.noter_source(con, 'site:essai', True, '2026-10-01')
        con.commit()
        con.close()
        self.socle = os.path.join(partage.dossier(self.racine, 'recherche'), partage.SOCLE)

    def lancer(self, *args, passe=False):
        env = {k: v for k, v in os.environ.items() if k != partage.VARIABLE_PASSE}
        env['PYTHONDONTWRITEBYTECODE'] = '1'
        if passe:
            env[partage.VARIABLE_PASSE] = '1'
        return subprocess.run([sys.executable, '-B', '-m', 'recherche', *args], cwd=MOISSONNEURS, env=env,
                              capture_output=True, text=True, encoding='utf-8', timeout=120)

    def publier(self, passe=False):
        return self.lancer('publier', '--base', self.base, '--racine', self.racine, '--poste', 'Poste-Dev',
                           '--compte', 'dev', '--attente-creneau', '0', passe=passe)

    def octets(self):
        with open(self.socle, 'rb') as f:
            return f.read()

    def vieillir(self):
        """Recule l'heure de publication du socle : deux publications d'une même seconde ne prouvent rien. Rend ses
        octets."""
        with open(self.socle, encoding='utf-8') as f:
            contenu = json.load(f)
        contenu['publie_le'] = '2026-01-01T00:00:00Z'
        commun.ecrire_json_atomique(self.socle, contenu, compact=True)
        return self.octets()

    def creneaux(self):
        d = os.path.join(self.racine, '_Moissons', '_Creneau')
        return sorted(os.listdir(d)) if os.path.isdir(d) else []

    def dev(self):
        con = db.connecter(self.base)
        self.addCleanup(con.close)
        return con


class TestPublierPuisPasse(Fond):
    def test_la_passe_mensuelle_part_du_socle_publie(self):
        p = self.publier()
        self.assertEqual(p.returncode, 0, p.stderr)
        ligne = json.loads(p.stdout.splitlines()[-1])
        self.assertEqual((ligne['type'], ligne['tables']['projets']), ('socle', 3))
        self.assertEqual(self.creneaux(), [])                     # le créneau est rendu
        publie = self.octets()
        socle = partage.lire_socle(self.racine, 'recherche')
        self.assertEqual((socle['poste'], socle['compte']), ('Poste-Dev', 'dev'))
        self.assertTrue(all('derniere_vue' not in l for l in socle['tables']['projets']))

        sortie = io.StringIO()
        code = moisson.principal(['mensuelle', '--seulement', 'recherche', '--racine', self.racine, '--poste', 'p',
                                  '--compte', 'c', '--hors-ligne', '--attente-creneau', '0', '--evenements', 'json'],
                                 sortie=sortie, racine_code=MOISSONNEURS)
        evts = [json.loads(l) for l in sortie.getvalue().splitlines() if l.strip()]
        for e in evts:
            self.assertEqual(ev.valider(e), [], e)
        self.assertEqual([e['raison'] for e in evts if e['type'] == 'refus'], [])
        fins = {e['moissonneur']: e['code'] for e in evts if e['type'] == 'moissonneur_fin'}
        self.assertEqual(fins, {'recherche': 0}, evts)
        self.assertEqual(code, 0)
        lots = [e for e in evts if e['type'] == 'lot']
        self.assertEqual([l['propositions'] for l in lots], [1], evts)       # le seul projet « nouveau » du socle
        self.assertTrue(os.path.isfile(partage.chemin_journal(self.racine, 'recherche', 'p__c')))
        self.assertEqual(self.octets(), publie)                    # la passe n'écrit jamais le socle


class TestRefusSousUnePasse(Fond):
    def test_publier_est_refuse_sous_pronto_moisson_passe(self):
        p = self.publier(passe=True)
        self.assertEqual(p.returncode, 2, p.stderr)
        self.assertEqual(p.stdout, '')
        self.assertIn('passe mensuelle', p.stderr)
        self.assertFalse(os.path.exists(self.socle))
        self.assertEqual(self.creneaux(), [])

    def test_un_socle_present_n_est_pas_touche(self):
        self.assertEqual(self.publier().returncode, 0)
        avant = self.vieillir()
        con = db.connecter(self.base)
        db.enregistrer(con, projet(4, 'Gebärdensprache im Unterricht'), 'nouveau', 'mot : x')
        con.commit()
        con.close()
        partage.publier_journal(self.racine, 'recherche', 'poste-b__c', {'retirees': {'sources': ['site:essai']}},
                                etat.SCHEMA)
        self.assertEqual(self.publier(passe=True).returncode, 2)
        self.assertEqual(self.octets(), avant)
        self.assertEqual(self.creneaux(), [])
        dev = self.dev()                                   # refusé avant tout : la base n'a rien absorbé
        self.assertEqual(etat.absorbes(dev), {})
        self.assertIsNotNone(dev.execute('SELECT 1 FROM sources').fetchone())


class TestIdentiqueALOctet(Fond):
    def test_deux_publications_sans_changement(self):
        self.assertEqual(self.publier().returncode, 0)
        avant = self.vieillir()
        p = self.publier()
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(self.octets(), avant)

    def test_un_changement_change_le_socle(self):
        self.assertEqual(self.publier().returncode, 0)
        avant = self.octets()
        con = db.connecter(self.base)
        db.enregistrer(con, projet(4, 'Gebärdensprache im Unterricht'), 'nouveau', 'mot : x')
        con.commit()
        con.close()
        self.assertEqual(self.publier().returncode, 0)
        self.assertNotEqual(self.octets(), avant)
        self.assertEqual(len(partage.lire_socle(self.racine, 'recherche')['tables']['projets']), 4)

    def test_derniere_vue_ne_change_pas_le_socle(self):
        self.assertEqual(self.publier().returncode, 0)
        avant = self.vieillir()
        con = db.connecter(self.base)
        con.execute("UPDATE projets SET derniere_vue = '2099-01-01T00:00:00'")
        con.commit()
        con.close()
        self.assertEqual(self.publier().returncode, 0)
        self.assertEqual(self.octets(), avant)


class TestAbsorption(Fond):
    def test_les_journaux_entrent_dans_la_base_et_le_socle(self):
        self.assertEqual(self.publier().returncode, 0)
        dev = self.dev()
        id1 = dev.execute("SELECT id FROM projets WHERE source_id = '1'").fetchone()[0]
        ligne1 = etat.instantane(dev)['projets'][('site:essai', '1')]
        dev.close()
        neuf = dict(ligne1, id=id1, source_id='9', url='https://exemple.ch/9', title='Wohlbefinden', statut='propose')
        partage.publier_journal(self.racine, 'recherche', 'poste-b__c', {
            'projets': [dict(ligne1, id=99, statut='propose', lot='2026-11-01-1.jsonl'), neuf],
            'decisions': [{'cle': 'recherche:site:essai:3', 'decision': 'refuse', 'motif': 'autre', 'fiche': '',
                           'date': '2026-11-01', 'lue_le': '2026-11-01T08:00:00', 'purgee': 0}],
            'retirees': {'sources': ['site:essai']}}, etat.SCHEMA)
        self.assertEqual(self.publier().returncode, 0)

        dev = self.dev()
        un = dev.execute("SELECT id, statut, lot FROM projets WHERE source_id = '1'").fetchone()
        self.assertEqual(tuple(un), (id1, 'propose', '2026-11-01-1.jsonl'))       # l'id du poste de dev reste
        neuf_id = dev.execute("SELECT id FROM projets WHERE source_id = '9'").fetchone()[0]
        self.assertNotIn(neuf_id, (id1, 99))                                         # un id pris ne se reprend pas
        self.assertEqual(dev.execute('SELECT decision FROM decisions').fetchone()[0], 'refuse')
        self.assertEqual(db.sources_desactivees(dev), {})
        self.assertIsNone(dev.execute('SELECT 1 FROM sources').fetchone())
        socle = partage.lire_socle(self.racine, 'recherche')
        self.assertEqual(socle['absorbes'], {'poste-b__c': 4})
        self.assertEqual(len(socle['tables']['projets']), 4)
        self.assertEqual(socle['tables']['sources'], [])

        # Déjà absorbé : une troisième publication ne change rien, et le journal se vide à sa prochaine écriture.
        avant = self.vieillir()
        self.assertEqual(self.publier().returncode, 0)
        self.assertEqual(self.octets(), avant)
        partage.publier_journal(self.racine, 'recherche', 'poste-b__c', {}, etat.SCHEMA)
        self.assertEqual(partage.lire_journal(partage.chemin_journal(self.racine, 'recherche', 'poste-b__c')),
                         [])

    def test_absorber_seul(self):
        self.assertEqual(self.publier().returncode, 0)
        partage.publier_journal(self.racine, 'recherche', 'poste-b__c', {'retirees': {'sources': ['site:essai']}},
                                etat.SCHEMA)
        p = self.lancer('absorber', '--base', self.base, '--racine', self.racine)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout.splitlines()[-1]), {'type': 'absorption', 'journaux': 1, 'lignes': 1})
        self.assertIsNone(self.dev().execute('SELECT 1 FROM sources').fetchone())


class TestOptions(Fond):
    def test_options_manquantes(self):
        p = self.lancer('publier', '--base', self.base, '--racine', self.racine)
        self.assertEqual(p.returncode, 2)
        self.assertIn('--poste', p.stderr)
        self.assertFalse(os.path.exists(self.socle))


if __name__ == '__main__':
    unittest.main()
