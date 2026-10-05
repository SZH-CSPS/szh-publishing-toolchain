"""La passe mensuelle : demande d'arrêt, `--a-blanc`, 403 par source et désactivation, pages refusées, état en mémoire
publié en différentiel, sources par défaut et ligne de commande `python3 -B -m recherche`. Hors réseau."""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
import unittest
from types import SimpleNamespace

from recherche import cli, db, etat, tout
from recherche.modele import Projet
from recherche.reseau import Acces403, ArretDemande
from recherche.tests import outils

JOUR = '2026-10-04'
MOISSONNEURS = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def projet(i, titre='Autismus in der Schule'):
    return Projet(source='faux', source_id=str(i), url=f'https://exemple.ch/{i}', title=titre, langue='de',
                  institutions='Universität Musterstadt', debut='2025', fin='2027', descriptif='Ein Projekt.')


def injecter(nom, *comportements):
    """recherche.sources.<nom> factice : l'appel i suit comportements[i] (le dernier se répète) : une liste de projets,
    une exception, ou une fonction(reseau) qui rend une liste. Rend le module, qui compte ses appels."""
    module = types.ModuleType('recherche.sources.' + nom)
    module.appels = 0

    def moissonner(config, reseau, connus):
        c = comportements[min(module.appels, len(comportements) - 1)]
        module.appels += 1
        if isinstance(c, BaseException):
            raise c
        yield from (c(reseau) if callable(c) else c)

    module.moissonner = moissonner
    sys.modules['recherche.sources.' + nom] = module
    return module


class ReseauFactice:
    def __init__(self):
        self.requetes = 0
        self.details = {}


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        for nom in ('faux', 'autre'):
            self.addCleanup(sys.modules.pop, 'recherche.sources.' + nom, None)
        self.config = outils.config(self.tmp)
        os.makedirs(os.path.join(self.config['bibliotheque'], 'forschung'))
        self.evenements = []

    def tout(self, **kw):
        kw.setdefault('reseau', ReseauFactice())
        kw.setdefault('aujourdhui', JOUR)
        self.evenements = []
        return tout.tout(self.config, self.evenements.append, **kw)

    def etat_json(self):
        chemin = os.path.join(self.config['propositions'], 'etat.json')
        if not os.path.exists(chemin):
            return None
        with open(chemin, encoding='utf-8') as f:
            return json.load(f)

    def de_type(self, t):
        return [e for e in self.evenements if e['type'] == t]

    def vieux_lot(self):
        os.makedirs(self.config['propositions'], exist_ok=True)
        chemin = os.path.join(self.config['propositions'], '2026-01-01-1.jsonl')
        with open(chemin, 'w', encoding='utf-8') as f:
            f.write('{}\n')
        return chemin

    def base(self):
        return db.connecter(self.config['base'])


class TestArret(Base):
    def test_arret_lot_partiel_purge_etat_code_3(self):
        self.config['sources'] = {'faux': {'actif': True}, 'autre': {'actif': True}}
        injecter('faux', [projet(1)])
        autre = injecter('autre', ArretDemande('demande'))
        vieux = self.vieux_lot()
        resume, code = self.tout()
        self.assertEqual(code, 3)
        self.assertEqual(resume['interrompu'], 'arret')
        self.assertEqual(autre.appels, 1)
        self.assertEqual(outils.lots(self.config['propositions']), ['2026-10-04-1.jsonl'])
        self.assertFalse(os.path.exists(vieux))
        self.assertEqual(self.etat_json()['interrompu'], 'arret')
        self.assertEqual([e['statut'] for e in self.de_type('progression') if e['etape'] == 'moisson'], ['ok', 'arret'])
        self.assertEqual([n for n in os.listdir(self.config['propositions']) if n.endswith('.tmp')], [])


class TestABlanc(Base):
    def test_rien_d_ecrit_le_resume_dit_ce_qui_l_aurait_ete(self):
        injecter('faux', [projet(1)])
        vieux = self.vieux_lot()
        publies = []
        resume, code = self.tout(a_blanc=True, publier=publies.append)
        self.assertEqual(code, 0)
        self.assertEqual(outils.lots(self.config['propositions']), ['2026-01-01-1.jsonl'])
        self.assertTrue(os.path.exists(vieux))
        self.assertIsNone(self.etat_json())
        self.assertEqual(publies, [])
        self.assertEqual(resume['propositions_ecrites'], 0)
        self.assertEqual(resume['a_blanc'], {'propositions': 1, 'lot': '2026-10-04-1.jsonl',
                                             'purge': {'lots': ['2026-01-01-1.jsonl'], 'decisions': []}})
        con = self.base()
        self.addCleanup(con.close)
        self.assertEqual([r['statut'] for r in db.lister(con)], ['nouveau'])


class TestEstimerInterface(Base):
    def test_champs_de_l_interface(self):
        e = tout.estimer(self.config)
        self.assertEqual(e['type'], 'estimation')
        self.assertEqual(e['moissonneur'], 'recherche')
        self.assertEqual(e['requetes'], e['requetes_prevues'])
        self.assertEqual((e['budget'], e['delai_s']), (self.config['budget'], float(self.config['delai'])))


class Test403ParSource(Base):
    def setUp(self):
        super().setUp()
        self.config['sources'] = {'autre': {'actif': True}, 'faux': {'actif': True}}

    def test_un_403_n_arrete_que_sa_source(self):
        injecter('autre', Acces403('https://exemple.ch/plan.xml : 403'))
        injecter('faux', [projet(1)])
        resume, code = self.tout()
        self.assertEqual(code, 1)
        self.assertIsNone(resume['interrompu'])
        self.assertEqual(resume['sources_en_echec'], [{'source': 'autre', 'raison': '403'}])
        self.assertEqual(resume['propositions_ecrites'], 1)
        self.assertEqual(self.de_type('avertissement'),
                         [{'type': 'avertissement', 'source': 'autre', 'code': '403',
                           'message': "autre a refusé l’accès (403)"}])

    def test_afflux_constate_en_fin_de_source(self):
        # Deux pages sur trois refusées, la dernière lue : l'afflux ne se voit qu'au bilan, et compte comme un blocage.
        def afflux(reseau):
            reseau.details[reseau.source] = {'demandes': 3, 'refus': ['https://exemple.ch/1', 'https://exemple.ch/2'],
                                             'reussies': ['https://exemple.ch/3']}
            return []
        injecter('autre', afflux)
        injecter('faux', [projet(1)])
        resume, code = self.tout()
        self.assertEqual(code, 1)
        self.assertEqual(resume['sources_en_echec'], [{'source': 'autre', 'raison': '403'}])
        con = self.base()
        self.addCleanup(con.close)
        ligne = con.execute("SELECT echecs_403_consecutifs FROM sources WHERE source = 'autre'").fetchone()
        self.assertEqual(ligne[0], 1)
        self.assertEqual([e['statut'] for e in self.de_type('progression') if e.get('source') == 'autre'], ['echec'])

    def test_une_page_refusee_sur_trois_n_est_pas_un_afflux(self):
        def une(reseau):
            reseau.details[reseau.source] = {'demandes': 3, 'refus': ['https://exemple.ch/1'],
                                             'reussies': ['https://exemple.ch/2', 'https://exemple.ch/3']}
            return []
        injecter('autre', une)
        injecter('faux', [])
        resume, code = self.tout()
        self.assertEqual((code, resume['sources_en_echec']), (0, []))

    def test_toutes_les_sources_en_403_interrompent(self):
        injecter('autre', Acces403('x'))
        injecter('faux', Acces403('y'))
        resume, code = self.tout()
        self.assertEqual(code, 3)
        self.assertEqual(resume['interrompu'], '403')

    def test_deux_passes_en_403_desactivent_puis_plus_d_appel(self):
        autre = injecter('autre', Acces403('x'))
        injecter('faux', [])
        self.tout()
        con = self.base()
        self.assertEqual(db.sources_desactivees(con), {})
        con.close()
        self.tout()
        con = self.base()
        self.assertEqual(db.sources_desactivees(con), {'autre': JOUR})
        con.close()
        resume, code = self.tout()
        self.assertEqual(autre.appels, 2)
        self.assertEqual(code, 0)
        self.assertEqual(resume['sources_desactivees'], [{'source': 'autre', 'depuis': JOUR}])
        self.assertEqual(self.etat_json()['sources_desactivees'], [{'source': 'autre', 'depuis': JOUR}])
        avert = self.de_type('avertissement')
        self.assertEqual(len(avert), 1)
        self.assertEqual(avert[0]['code'], 'desactivee')
        self.assertEqual(avert[0]['message'], 'autre est désactivée depuis le 04.10.2026\xa0: réactivation en dev')

    def test_une_passe_reussie_remet_le_compte_a_zero(self):
        injecter('autre', Acces403('x'), [], Acces403('x'))
        injecter('faux', [])
        for _ in range(3):
            self.tout()
        con = self.base()
        self.addCleanup(con.close)
        self.assertEqual(db.sources_desactivees(con), {})
        ligne = con.execute("SELECT echecs_403_consecutifs FROM sources WHERE source = 'autre'").fetchone()
        self.assertEqual(ligne[0], 1)

    def test_reactiver_en_dev(self):
        con = self.base()
        db.noter_source(con, 'site:essai', True, JOUR)
        db.noter_source(con, 'site:essai', True, JOUR)
        con.commit()
        con.close()
        racine = os.path.join(self.tmp, 'racine')
        os.makedirs(racine)
        code = cli.main(['reactiver', 'site:essai', '--base', self.config['base']])
        self.assertEqual(code, 0)
        con = self.base()
        self.addCleanup(con.close)
        self.assertEqual(db.sources_desactivees(con), {})


class TestPagesRefusees(Base):
    URL = 'https://exemple.ch/refusee'

    def refuser(self, reseau):
        reseau.details[reseau.source] = {'demandes': 1, 'refus': [self.URL], 'reussies': []}
        return []

    def lire(self, reseau):
        reseau.details[reseau.source] = {'demandes': 1, 'refus': [], 'reussies': [self.URL]}
        return []

    def refusee(self):
        con = self.base()
        self.addCleanup(con.close)
        return db.urls_refusees(con)

    def test_deux_passes_refusent_la_page_sans_toucher_la_source(self):
        injecter('faux', self.refuser)
        _, code = self.tout()
        self.assertEqual(code, 0)
        self.assertEqual(self.de_type('avertissement')[0]['message'], "une page de faux refuse l’accès (403)")
        self.assertEqual(self.refusee(), set())
        self.tout()
        self.assertEqual(self.refusee(), {self.URL})
        con = self.base()
        self.addCleanup(con.close)
        self.assertEqual(db.sources_desactivees(con), {})

    def test_une_page_relue_sort_de_la_table(self):
        injecter('faux', self.refuser, self.lire)
        self.tout()
        self.tout()
        con = self.base()
        self.addCleanup(con.close)
        self.assertIsNone(con.execute('SELECT 1 FROM urls_refusees').fetchone())


class TestEtatEnMemoire(Base):
    def test_ouvrir_et_publier_le_differentiel(self):
        memoire = etat.base_en_memoire()
        db.enregistrer(memoire, projet(7, 'Gebärdensprache im Unterricht'), 'hors-sujet', '')
        memoire.commit()
        injecter('faux', [projet(1)])
        publies = []
        resume, code = self.tout(ouvrir=lambda: memoire, publier=publies.append)
        self.assertEqual(code, 0)
        self.assertFalse(os.path.exists(self.config['base']))
        lignes = [l for d in publies for l in d.get('projets', [])]
        self.assertEqual({l['source_id'] for l in lignes}, {'1'})
        self.assertEqual(lignes[-1]['statut'], 'propose')
        self.assertTrue(all('derniere_vue' not in l for l in lignes))

    def test_etat_absent_bloque(self):
        def absent():
            raise etat.EtatAbsent('non branché')
        resume, code = self.tout(ouvrir=absent)
        self.assertEqual(code, 2)
        self.assertEqual(resume['interrompu'], 'configuration')

    def test_remplir_rend_l_etat_publie(self):
        source = etat.base_en_memoire()
        db.enregistrer(source, projet(3), 'propose', 'mot : autis')
        db.noter_source(source, 'site:essai', True, JOUR)
        db.noter_urls(source, 'site:essai', ['https://exemple.ch/r'], [], JOUR)
        source.commit()
        tables = {t: list(lignes.values()) for t, lignes in etat.instantane(source).items()}
        copie = etat.remplir(etat.base_en_memoire(), tables)
        self.assertEqual(etat.instantane(copie), etat.instantane(source))
        self.assertEqual(db.urls_refusees(copie), set())        # une seule passe en 403 : pas encore refusée

    def test_etat_partage_non_branche(self):
        with self.assertRaises(etat.EtatAbsent):
            etat.charger_etat(self.tmp)
        with self.assertRaises(etat.EtatAbsent):
            etat.publier_journal(self.tmp, 'p__c', {'projets': []})

    def test_differentiel(self):
        con = etat.base_en_memoire()
        avant = etat.instantane(con)
        self.assertEqual(etat.differentiel(con, avant), {})
        db.noter_source(con, 'skbf', True, JOUR)
        self.assertEqual(etat.differentiel(con, avant)['sources'],
                         [{'source': 'skbf', 'echecs_403_consecutifs': 1, 'desactivee_le': ''}])
        avant = etat.instantane(con)
        db.reactiver(con, 'skbf')
        self.assertEqual(etat.differentiel(con, avant), {'retirees': {'sources': ['skbf']}})


class TestConfiguration(unittest.TestCase):
    def args(self, **kw):
        valeurs = dict(racine='/r', base=None, cache=None, arret=None, plafond=None, sources=None, fichier_snf=None)
        valeurs.update(kw)
        return SimpleNamespace(**valeurs)

    def test_chemins_tires_de_la_racine(self):
        c = cli.construire_config(self.args())
        self.assertEqual(c['propositions'], os.path.join('/r', '_Moissons', 'recherche'))
        self.assertEqual(c['decisions'], os.path.join('/r', '_Moissons', '_Decisions'))
        self.assertEqual(c['bibliotheque'], os.path.join('/r', 'Fiches'))

    def test_le_fns_hors_de_la_passe_par_defaut(self):
        c = cli.construire_config(self.args())
        self.assertEqual({n: s['actif'] for n, s in c['sources'].items()}, {'snf': False, 'skbf': True, 'sites': True})
        c = cli.construire_config(self.args(sources='snf,skbf'))
        self.assertEqual({n: s['actif'] for n, s in c['sources'].items()}, {'snf': True, 'skbf': True, 'sites': False})

    def test_plafond(self):
        c = cli.construire_config(self.args(plafond=7))
        self.assertEqual(c['plafond'], 7)
        self.assertEqual(c['budget'], 3000)       # le budget du mois reste celui des réglages
        self.assertIsNone(cli.construire_config(self.args())['plafond'])
        self.assertEqual(cli.construire_config(self.args(plafond=0))['plafond'], 0)

    def test_reglages_sans_chemin(self):
        with open(cli.REGLAGES, encoding='utf-8') as f:
            texte = f.read()
        for cle in ('base', 'cache', 'propositions', 'decisions', 'bibliotheque', 'fichier_local'):
            self.assertNotRegex(texte, rf'(?m)^\s*{cle}\s*=')


class TestLigneDeCommande(unittest.TestCase):
    """`python3 -B -m recherche`, lancé depuis moissonneurs/ comme le fera moisson.py."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.racine = os.path.join(self.tmp, '_NewsUndActu')
        os.makedirs(os.path.join(self.racine, 'Fiches', 'forschung'))

    def lancer(self, *args):
        r = subprocess.run([sys.executable, '-B', '-m', 'recherche', *args], cwd=MOISSONNEURS, capture_output=True,
                           text=True, encoding='utf-8', timeout=120)
        return r.returncode, r.stdout, r.stderr

    def test_tout_hors_ligne_rien_que_du_json(self):
        code, sortie, _ = self.lancer('tout', '--racine', self.racine, '--poste', 'p', '--compte', 'c', '--hors-ligne',
                                      '--base', os.path.join(self.tmp, 'base.sqlite'))
        self.assertEqual(code, 0)
        objets = [json.loads(l) for l in sortie.splitlines()]
        self.assertEqual(objets[-1]['type'], 'resume')
        self.assertTrue(os.path.isfile(os.path.join(self.racine, '_Moissons', 'recherche', 'etat.json')))

    def test_estimer(self):
        code, sortie, _ = self.lancer('estimer', '--racine', self.racine)
        self.assertEqual(code, 0)
        lignes = sortie.splitlines()
        self.assertEqual(len(lignes), 1)
        e = json.loads(lignes[0])
        self.assertEqual(e['type'], 'estimation')
        self.assertEqual(e['budget'], 3000)       # le budget du mois, d'où moisson.py tire le plafond
        self.assertLessEqual({'moissonneur', 'requetes', 'delai_s', 'budget'}, set(e))
        self.assertNotIn('snf', [x.get('source') for x in e['etapes']])

    def test_option_manquante(self):
        code, sortie, erreur = self.lancer('tout', '--hors-ligne')
        self.assertEqual(code, 2)
        self.assertEqual(sortie, '')
        self.assertIn('--racine', erreur)

    def test_sans_base_l_etat_partage_non_branche(self):
        code, sortie, _ = self.lancer('tout', '--racine', self.racine, '--poste', 'p', '--compte', 'c', '--hors-ligne')
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(sortie.splitlines()[-1])['interrompu'], 'configuration')


if __name__ == '__main__':
    unittest.main()
