"""Passe mensuelle sur l'état partagé : le lot sort comme au poste de développement, sans ses textes ; arrêt au repère ;
plafond et demande d'arrêt ; le socle n'est jamais écrit par une passe. Tout est fictif, hors réseau."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

import partage

from parlement import classement, criblage, etat, export_propositions as ep, lexique, passe_mensuelle as pm, tout
from parlement.cli import CONTRAT
from parlement.reseau import Reseau
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import config_pipeline, ecrire_fiche_prod

MOISSONNEURS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
T = '2026-11-02T08:00:00Z'
ANNONCE = {'poste': 'dev', 'compte': 'd'}
SIGNATAIRES = 'Erika Muster\nLandrätin\nMusterweg 1\n9999 Musterdorf\n\n'
CORPS = ('Der Regierungsrat wird beauftragt, die integrative Schule zu stärken und die Sonderpädagogik auszubauen. '
         'Kinder mit Behinderung brauchen Unterstützung im Unterricht. ') * 3


def affaire(corps, ext, titre, depot, typ=2, **kw):
    d = dict(body_key=corps, external_id=ext, id_api=f'{corps}{ext}', number=f'M {ext}', title=titre,
             type_name={'de': 'Motion'}, type_harmonized_id=typ, date_depot=depot, updated_at=depot + 'T00:00:00',
             url_oparl=f'https://example.invalid/{corps}/{ext}', brut={'title': {'de': titre}, 'begin_date': depot})
    d.update(kw)
    return Affaire(**d)


def doc(texte, nom='Vorstoss-de'):
    return {'id': 'd1', 'name': nom, 'url': 'https://example.invalid/d', 'url_oparl': '', 'language': 'de', 'text': texte}


class Fond(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def setUp(self):
        # Aucune requête réelle : le Reseau que la passe construit elle-même répond 200 à vide.
        bouchon = mock.patch.object(Reseau, '_ouvrir_urllib', lambda self, url, en_tetes: (200, {}, b'{}'))
        bouchon.start()
        self.addCleanup(bouchon.stop)
        self._t = tempfile.TemporaryDirectory()
        self.addCleanup(self._t.cleanup)
        self.tmp = self._t.name
        self.racine = os.path.join(self.tmp, '_NewsUndActu')
        for d in ('Fiches', os.path.join('_Moissons', 'parlement'), os.path.join('_Moissons', '_Decisions')):
            os.makedirs(os.path.join(self.racine, d))
        self.cfg = self.config(os.path.join(self.racine, '_Moissons', 'parlement'))
        self.dev = Base(os.path.join(self.tmp, 'dev', 'p.sqlite'))
        self.addCleanup(self.dev.fermer)
        self.remplir_dev()

    def config(self, propositions):
        cfg = config_pipeline(self.tmp)
        cfg['moisson']['cantons'] = ['GE', 'ZH']
        cfg['criblage']['date_min_fiche'] = '2025-01-01'
        cfg['classement'] = {'ecole_generale': True, 'themes_elargis': True, 'vivier_large': True}
        cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'finesse': True}
        cfg['bibliotheque'] = {'fiches': os.path.join(self.racine, 'Fiches'), 'contrat': CONTRAT}
        cfg['sortie'].update({'propositions': propositions,
                              'decisions': os.path.join(self.racine, '_Moissons', '_Decisions')})
        cfg['exports'] = {'delai': 0.0}
        cfg['mensuelle'] = {'active': True, 'budget': 800, 'limite': 50, 'delai': 0.0}
        return cfg

    def remplir_dev(self):
        """Une base de dev : des affaires, leurs documents, classées ; une déjà proposée, une sans ancrage."""
        b = self.dev
        textes = {'1': SIGNATAIRES + 'Interpellation: Sonderpädagogik stärken\n\n' + CORPS,
                  '2': '<style>p{color:red;}</style><p>Der&nbsp;Bericht ' + CORPS + '</p>',
                  '3': 'Strassenunterhalt und Verkehr. ' * 20}
        for ext, titre, depot in (('1', 'Sonderpädagogik stärken', '2026-09-20'),
                                  ('2', 'Integrative Schule für Kinder mit Behinderung', '2026-09-25'),
                                  ('3', 'Strassenunterhalt', '2026-09-26'),
                                  ('4', 'Gebärdensprache an Schulen', '2026-08-10')):
            a = affaire('ZH', ext, titre, depot)
            b.enregistrer_affaire(a)
            if ext in textes:
                b.c.execute("INSERT INTO documents(body_key, id_api, doc_id, nom, url, url_oparl, langue, texte, empreinte) "
                            "VALUES (?,?,?,?,?,?,?,?,?)", ('ZH', a.id_api, 'd1', 'Vorstoss-de', '', '', 'de', textes[ext], 'e'))
                b.c.execute('INSERT INTO textes_recuperes VALUES (?,?,?,?)', ('ZH', ext, 1, '2026-10-01'))
        for c in ('ZH', 'GE', 'CHE'):
            b.poser_repere(c, '2026-10-01T00:00:00')
        b.enregistrer_affaire(affaire('GE', '10', 'Budget 2027', '2026-09-30'))
        b.commit()
        criblage.candidats_par_titre(self.cfg, b, self.lex)
        b.c.execute("INSERT OR IGNORE INTO candidats VALUES ('ZH','2','Behinderung','de','2026-10-01')")
        classement.classer_base(self.cfg, b, self.lex)
        emp = b.c.execute("SELECT empreinte FROM affaires WHERE external_id='4'").fetchone()[0]
        b.c.execute('INSERT INTO propositions VALUES (?,?,?,?)', (ep.cle_de('ZH', '4'), emp, '2026-10-04-1.jsonl', 'x'))
        b.commit()

    def publier(self):
        etat.figer(self.dev, self.cfg, self.lex)
        etat.figer_valeurs(self.dev, self.cfg, self.lex, '2026-11-02')
        with mock.patch.dict(os.environ, {k: v for k, v in os.environ.items() if k != partage.VARIABLE_PASSE}, clear=True):
            return partage.publier_socle(self.racine, 'parlement', 'dev', 'd', etat.tables_du_socle(self.dev),
                                         etat.absorbes(self.dev), ANNONCE, maintenant=T)

    def lot(self, dossier):
        noms = sorted(n for n in os.listdir(dossier) if n.endswith('.jsonl'))
        with open(os.path.join(dossier, noms[-1]), encoding='utf-8') as f:
            return f.read()


class TestLotIdentique(Fond):
    def test_le_lot_de_la_passe_egale_celui_du_poste_de_dev(self):
        self.publier()
        memoire = etat.charger(self.racine)
        self.assertEqual(memoire.c.execute('SELECT COUNT(*) FROM documents').fetchone()[0], 0)    # aucun texte partagé
        r1 = ep.exporter(self.cfg, memoire, maintenant=T)
        dev_props = os.path.join(self.tmp, 'dev-props')
        r2 = ep.exporter(self.config(dev_props), self.dev, maintenant=T)
        self.assertGreaterEqual(r1['ecrites'], 2)
        self.assertEqual(r1['ecrites'], r2['ecrites'])
        self.assertEqual(self.lot(self.cfg['sortie']['propositions']), self.lot(dev_props))
        self.assertNotIn(ep.cle_de('ZH', '4'), self.lot(dev_props))          # déjà proposée, inchangée

    def test_le_socle_ne_porte_que_les_affaires_en_attente(self):
        self.publier()
        socle = partage.lire_socle(self.racine, 'parlement')
        cles = {(l['body_key'], l['external_id']) for l in socle['tables']['affaires']}
        self.assertNotIn(('ZH', '3'), cles)       # écartée
        self.assertNotIn(('ZH', '4'), cles)       # déjà proposée
        self.assertNotIn(('GE', '10'), cles)      # pas candidate
        ids = {l['body_key']: l['ids'] for l in socle['tables']['connues']}
        self.assertEqual(set(ids['ZH']), {'1', '2', '3', '4'})
        self.assertEqual(ids['GE'], {'10': '2026-09-30'})
        self.assertTrue(all(set(json.loads(b['charge'])) <= {'title', 'begin_date'} for b in socle['tables']['bruts']))

    def test_une_seconde_passe_ne_repropose_rien(self):
        self.publier()
        lignes = []
        for _ in range(2):
            tout.tout(self.cfg, lignes.append, hors_ligne=True, ouvrir=lambda: etat.charger(self.racine),
                      publier=lambda d: etat.publier_journal(self.racine, 'poste-b__c', d), maintenant=T)
        resumes = [l for l in lignes if l['type'] == 'resume']
        self.assertGreaterEqual(resumes[0]['propositions_ecrites'], 2)
        self.assertEqual(resumes[1]['propositions_ecrites'], 0)
        memoire = etat.charger(self.racine)
        self.assertEqual(memoire.c.execute('SELECT COUNT(*) FROM figees').fetchone()[0], 0)     # le lot les a emportées


class SourceFausse:
    def __init__(self, nouvelles, docs=None):
        self.nouvelles, self.docs, self.appels = nouvelles, docs or {}, []

    @staticmethod
    def localiser(v):
        return v if isinstance(v, str) else ''

    def moissonner_depot(self, config, reseau, connus, corps, repere_depot, etat=None):
        reseau.get(f'https://api.example.invalid/{corps}', cache=False)
        self.appels.append((corps, repere_depot, set(connus)))
        etat.update({'pages': 1, 'sans_date': 0, 'sans_date_plafonne': False})
        for a in self.nouvelles.get(corps, []):
            if a.date_depot[:10] < (repere_depot or '')[:10]:
                return
            if a.external_id not in connus:
                yield a

    def rechercher(self, config, reseau, terme, langue, depuis='', etat=None, cache=True):
        if etat is not None:
            etat['total'] = 0
        return iter(())

    def documents(self, config, reseau, id_api):
        reseau.get(f'https://api.example.invalid/docs/{id_api}', cache=False)
        d = self.docs.get(id_api, [])
        return {'data': d}, d


class TestPasseMensuelle(Fond):
    def reseau(self, budget=800, arret=''):
        return Reseau({'delai': 0.0, 'budget': budget, 'cache': '', 'journal': '', 'arret': arret},
                      ouvrir=lambda u, h: (200, {}, b'{}'), dormir=lambda s: None)

    def test_arret_au_repere_de_depot_tire_des_seules_affaires_connues(self):
        self.publier()
        memoire = etat.charger(self.racine)
        src = SourceFausse({'ZH': [affaire('ZH', '7', 'Sonderschulung im Kanton', '2026-10-15'),
                                   affaire('ZH', '3', 'Strassenunterhalt', '2026-09-26'),
                                   affaire('ZH', '0', 'Alt', '2026-01-01')]},
                           docs={'ZH7': [doc(CORPS)]})
        r = pm.passe(self.cfg, memoire, self.reseau(), src, self.lex, '2026-11-02', corps=['ZH'])
        zh = [a for a in src.appels if a[0] == 'ZH'][0]
        self.assertEqual(zh[1], '2026-09-26')            # le plus grand dépôt connu, même sans la ligne complète
        self.assertIn('3', zh[2])                         # une affaire connue du seul partage n'est pas reprise
        self.assertEqual(r['corps']['ZH']['nouvelles'], 1)
        self.assertIsNone(memoire.c.execute("SELECT 1 FROM affaires WHERE external_id='0'").fetchone())

    def test_le_journal_rend_les_nouvelles_connues_a_la_passe_suivante(self):
        self.publier()
        src = SourceFausse({'ZH': [affaire('ZH', '7', 'Sonderschulung im Kanton', '2026-10-15')]},
                           docs={'ZH7': [doc(CORPS)]})
        cfg = dict(self.cfg, mensuelle=dict(self.cfg['mensuelle'], plafond=50))
        lignes = []
        _, code = tout.tout(cfg, lignes.append, source=src, ouvrir=lambda: etat.charger(self.racine),
                            publier=lambda d: etat.publier_journal(self.racine, 'poste-b__c', d), maintenant=T)
        self.assertEqual(code, 0, [l for l in lignes if l.get('statut') == 'echec'])
        lot = self.lot(self.cfg['sortie']['propositions'])
        self.assertIn(ep.cle_de('ZH', '7'), lot)
        self.assertIn('"texte_depose"', lot)
        suivante = etat.charger(self.racine)
        self.assertIn('7', suivante.connus('ZH'))
        self.assertIsNone(suivante.c.execute("SELECT 1 FROM affaires WHERE external_id='7'").fetchone())   # proposée
        self.assertIsNotNone(suivante.donnees_figees('finesse', 'ZH', '7'))                                   # pour les crans
        socle = os.path.join(self.racine, '_Moissons', 'parlement', '_partage', 'socle.json')
        self.assertEqual(partage.lire_json(socle)['publie_le'], T)

    def test_plafond_de_la_passe_au_lieu_du_compte_local(self):
        self.dev.c.execute("INSERT INTO executions(commande, debut, statut, requetes) VALUES "
                           "('mensuelle', strftime('%Y-%m-%d', 'now'), 'ok', 799)")
        cfg = dict(self.cfg, mensuelle=dict(self.cfg['mensuelle'], plafond=2))
        r, restant = pm.reseau_mensuel(cfg, self.dev, ouvrir=lambda u, h: (200, {}, b'{}'), dormir=lambda s: None)
        self.assertEqual((r.budget, restant), (2, 2))
        src = SourceFausse({})
        rapport = pm.passe(cfg, self.dev, r, src, self.lex, corps=['ZH', 'GE', 'CHE'])
        self.assertEqual((rapport['statut'], r.requetes), ('plafond', 2))
        r0, _ = pm.reseau_mensuel(dict(cfg, mensuelle=dict(cfg['mensuelle'], plafond=0)), self.dev)
        self.assertEqual(pm.passe(cfg, self.dev, r0, src, self.lex)['statut'], 'plafond')

    def test_demande_d_arret_avant_la_requete_suivante(self):
        arret = os.path.join(self.tmp, 'arret')
        open(arret, 'w').close()
        r = self.reseau(arret=arret)
        rapport = pm.passe(self.cfg, self.dev, r, SourceFausse({}), self.lex, corps=['ZH'])
        self.assertEqual((rapport['statut'], r.requetes), ('arret', 0))


class TestSocleJamaisEcritParUnePasse(Fond):
    def test_tout_en_passe_mensuelle_laisse_le_socle_intact(self):
        chemin = self.publier()
        with open(chemin, 'rb') as f:
            avant = f.read()
        env = dict(os.environ, PYTHONDONTWRITEBYTECODE='1', **{partage.VARIABLE_PASSE: '1'})
        p = subprocess.run([sys.executable, '-B', '-m', 'parlement', 'tout', '--hors-ligne', '--racine', self.racine,
                            '--poste', 'poste-b', '--compte', 'c'], cwd=MOISSONNEURS, env=env, capture_output=True,
                           text=True, timeout=300)
        self.assertIn(p.returncode, (0, 1), p.stderr)
        resume = json.loads(p.stdout.splitlines()[-1])
        self.assertEqual(resume['type'], 'resume')
        with open(chemin, 'rb') as f:
            self.assertEqual(f.read(), avant)
        self.assertTrue(os.path.isfile(partage.chemin_journal(self.racine, 'parlement', 'poste-b__c')))
        with mock.patch.dict(os.environ, {partage.VARIABLE_PASSE: '1'}):
            with self.assertRaises(partage.SocleInterdit):
                partage.publier_socle(self.racine, 'parlement', 'dev', 'd', {}, {}, ANNONCE)


class TestAbsorption(Fond):
    def test_le_poste_de_dev_reprend_les_journaux_une_seule_fois(self):
        self.publier()
        partage.publier_journal(self.racine, 'parlement', 'poste-b__c', {
            'connues': [{'body_key': 'GE', 'ids': {'11': '2026-10-20'}}],
            'decisions': [{'cle': 'parlement:openparldata:ZH:1', 'decision': 'refuse', 'motif': 'autre', 'fiche': '',
                           'date': '2026-11-01', 'lue_le': 'x', 'purgee': 1}],
            'retirees': {'affaires': [['ZH', '1']]}}, etat.SCHEMA)
        _, _, n = etat.absorber(self.dev, self.racine)
        self.assertEqual(n, 3)
        self.assertIn('11', self.dev.connus('GE'))
        self.assertIsNotNone(self.dev.c.execute("SELECT 1 FROM affaires WHERE external_id='1'").fetchone())   # gardée
        self.assertEqual(self.dev.c.execute('SELECT purgee FROM decisions').fetchone()[0], 1)
        self.assertEqual(etat.absorber(self.dev, self.racine)[2], 0)
        self.assertEqual(etat.absorbes(self.dev), {'poste-b__c': 3})


class TestNomsEtLots(Fond):
    def test_le_contexte_fige_rejoint_celui_des_titres_en_memoire(self):
        b = Base(':memory:')
        self.addCleanup(b.fermer)
        self.assertNotIn('musterwort', ep.contexte_noms(b).blanche)
        b.c.execute('INSERT INTO figes VALUES (?,?)', ('noms', json.dumps({'blanche': ['musterwort'], 'dure': ['x'],
                                                                           'lieux': ['musterdorf']})))
        ctx = ep.contexte_noms(b)
        self.assertIn('musterwort', ctx.blanche)
        self.assertIn('musterdorf', ctx.lieux)

    def test_numero_de_lot_au_dessus_du_plus_grand(self):
        d = os.path.join(self.tmp, 'lots')
        os.makedirs(d)
        for n in (1, 3):
            open(os.path.join(d, f'2026-11-01-{n}.jsonl'), 'w').close()
        self.assertTrue(ep._nom_lot(d, '2026-11-01').endswith('2026-11-01-4.jsonl'))
        self.assertTrue(ep._nom_lot(d, '2026-11-01', ['2026-11-01-5.jsonl']).endswith('2026-11-01-6.jsonl'))
        self.assertTrue(ep._nom_lot(d, '2026-11-02').endswith('2026-11-02-1.jsonl'))


if __name__ == '__main__':
    unittest.main()
