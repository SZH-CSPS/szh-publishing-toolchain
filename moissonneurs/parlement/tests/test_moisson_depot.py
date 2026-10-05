"""Passe mensuelle : pages triées par date de dépôt, arrêt au repère de DÉPÔT, jamais sur updated_at (rafraîchi en bloc par la source).
Tout est faux : aucune requête réelle."""
import json
import tempfile
import unittest

from parlement import moisson
from parlement.sources import openparldata as op
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import config_test, reseau_factice


def page(lignes, suite):
    return json.dumps({'meta': {'has_more': suite}, 'data': lignes}).encode()


def aff(ext, depot=None, maj='2026-10-04T00:00:00'):
    d = {'body_key': 'GE', 'external_id': ext, 'updated_at': maj}
    if depot:
        d['begin_date'] = depot + 'T00:00:00'
    return d


class TestSourceParDepot(unittest.TestCase):
    def lancer(self, pages, connus=(), repere='2026-10-03'):
        with tempfile.TemporaryDirectory() as tmp:
            r, srv = reseau_factice([(f'offset={2 * i}', 200, p) for i, p in enumerate(pages)], tmp)
            etat = {}
            cfg = dict(config_test(tmp), mensuelle={'limite': 2})
            ids = [a.external_id for a in op.moissonner_depot(cfg, r, set(connus), 'GE', repere, etat)]
            return ids, srv.urls, etat

    def lancer_50(self, pages, repere='2026-10-03'):
        """Taille de page par défaut de la passe mensuelle (50) : pages de 50 affaires."""
        with tempfile.TemporaryDirectory() as tmp:
            r, srv = reseau_factice([(f'offset={50 * i}', 200, p) for i, p in enumerate(pages)], tmp)
            ids = [a.external_id for a in op.moissonner_depot(config_test(tmp), r, set(), 'GE', repere, {})]
            return ids, srv.urls

    def test_page_de_50_entierement_au_dessus_du_repere_la_suivante_est_demandee(self):
        p1 = page([aff(f'a{i}', '2026-10-05') for i in range(50)], True)
        p2 = page([aff('b0', '2026-10-04'), aff('vieille', '2026-09-01')], False)
        ids, urls = self.lancer_50([p1, p2])
        self.assertEqual(len(ids), 51)
        self.assertEqual(len(urls), 2)
        for u in urls:
            self.assertRegex(u, r'limit=50(&|$)')

    def test_page_de_50_avec_un_depot_anterieur_au_repere_arret(self):
        p1 = page([aff(f'a{i}', '2026-10-05') for i in range(49)] + [aff('vieille', '2026-09-01')], True)
        ids, urls = self.lancer_50([p1, page([aff('z', '2026-10-06')], False)])
        self.assertEqual(len(ids), 49)
        self.assertEqual(len(urls), 1)

    def test_la_limite_se_regle_dans_la_section_mensuelle(self):
        with tempfile.TemporaryDirectory() as tmp:
            r, srv = reseau_factice([('offset=0', 200, page([], False))], tmp)
            list(op.moissonner_depot(dict(config_test(tmp), mensuelle={'limite': 20}), r, set(), 'GE', '2026-10-03', {}))
        self.assertIn('limit=20', srv.urls[0])

    def test_tri_par_depot_jamais_par_mise_a_jour_et_pages_fraiches(self):
        ids, urls, _ = self.lancer([page([aff('n1', '2026-10-05')], False)])
        self.assertEqual(ids, ['n1'])
        self.assertIn('sort_by=-begin_date', urls[0])
        self.assertNotIn('updated_at', urls[0])

    def test_une_page_d_anciennes_rafraichies_ne_coupe_pas_avant_une_nouvelle(self):
        # les anciennes ont un updated_at tout récent ; la nouvelle (dépôt récent, updated_at ancien) vient avant au tri par dépôt
        ids, _, _ = self.lancer([page([aff('nouvelle', '2026-10-06', maj='2020-01-01T00:00:00'),
                                       aff('ancienne', '2019-05-01', maj='2026-10-04T05:00:00')], False)])
        self.assertEqual(ids, ['nouvelle'])

    def test_arret_au_repere_de_depot_sans_demander_la_page_suivante(self):
        pages = [page([aff('n1', '2026-10-05'), aff('trop_ancienne', '2026-10-02')], True), page([aff('z', '2019-01-01')], False)]
        ids, urls, _ = self.lancer(pages)
        self.assertEqual(ids, ['n1'])
        self.assertEqual(len(urls), 1)

    def test_le_jour_du_repere_est_relu_et_une_affaire_publiee_apres_la_moisson_est_trouvee(self):
        pages = [page([aff('meme_jour_nouvelle', '2026-10-03'), aff('meme_jour_connue', '2026-10-03')], True),
                 page([aff('veille', '2026-10-02')], False)]
        ids, urls, _ = self.lancer(pages, connus={'meme_jour_connue'})
        self.assertEqual(ids, ['meme_jour_nouvelle'])        # la connue est ignorée, la nouvelle est prise
        self.assertEqual(len(urls), 2)                        # le jour même ne coupe pas : on lit jusqu'au dépôt strictement antérieur

    def test_les_affaires_sans_date_sont_prises_une_fois_et_ne_comptent_pas_pour_l_arret(self):
        pages = [page([aff('sd_nouvelle'), aff('sd_connue')], True), page([aff('n1', '2026-10-05'), aff('vieille', '2020-01-01')], False)]
        ids, _, etat = self.lancer(pages, connus={'sd_connue'})
        self.assertEqual(ids, ['sd_nouvelle', 'n1'])
        self.assertEqual(etat['sans_date'], 1)
        self.assertFalse(etat['sans_date_plafonne'])

    def test_les_sans_date_sont_plafonnees_a_une_page(self):
        pages = [page([aff('s1'), aff('s2')], True), page([aff('s3'), aff('s4')], True), page([aff('n1', '2026-10-05')], False)]
        ids, urls, etat = self.lancer(pages)
        self.assertEqual(ids, ['s1', 's2', 's3', 's4'][:2])    # la deuxième page sans date n'est pas lue pour elle-même : arrêt
        self.assertEqual(len(urls), 2)
        self.assertTrue(etat['sans_date_plafonne'])

    def test_sans_repere_de_depot_aucune_requete(self):
        ids, urls, _ = self.lancer([page([aff('n1', '2026-10-05')], False)], repere=None)
        self.assertEqual((ids, urls), ([], []))


class SourceDepotFausse:
    def __init__(self, affaires):
        self.affaires = affaires

    def moissonner_depot(self, config, reseau, connus, corps, repere_depot, etat=None):
        self.repere_vu = repere_depot
        etat.update({'pages': 1, 'sans_date': 0, 'sans_date_plafonne': False})
        yield from [a for a in self.affaires if a.external_id not in connus]


class TestOrchestration(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.cfg = config_test(self._t.name)
        self.base = Base(':memory:')
        self.reseau, _ = reseau_factice([], self._t.name)

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def test_le_repere_de_depot_est_la_plus_grande_date_de_depot_connue_pas_updated_at(self):
        for ext, depot, maj in (('1', '2026-09-01', '2026-10-04T00:00:00'), ('2', '2026-09-20', '2020-01-01T00:00:00'), ('3', '', '2026-12-31T00:00:00')):
            self.base.enregistrer_affaire(Affaire(body_key='GE', external_id=ext, id_api=ext, title='x', date_depot=depot,
                                                  updated_at=maj, brut={'e': ext}))
        self.assertEqual(moisson.repere_depot(self.base, 'GE'), '2026-09-20')
        self.assertIsNone(moisson.repere_depot(self.base, 'VD'))

    def test_les_nouvelles_sont_enregistrees_les_connues_ne_changent_pas(self):
        self.base.enregistrer_affaire(Affaire(body_key='GE', external_id='1', id_api='1', title='ancien titre', date_depot='2026-09-20', brut={'a': 1}))
        src = SourceDepotFausse([Affaire(body_key='GE', external_id='1', id_api='1', title='titre modifie', date_depot='2026-09-20', brut={'a': 2}),
                                 Affaire(body_key='GE', external_id='2', id_api='2', title='nouvelle', date_depot='2026-10-02', brut={'a': 3})])
        statut, _, comptes = moisson.moissonner_corps_depot(self.cfg, self.base, self.reseau, src, 'GE')
        self.assertEqual((statut, comptes['nouvelles'], comptes['changees']), ('ok', 1, 0))
        self.assertEqual(src.repere_vu, '2026-09-20')
        titre = self.base.c.execute("SELECT title FROM affaires WHERE external_id='1'").fetchone()[0]
        self.assertEqual(titre, 'ancien titre')              # les changements d'état passent par le prochain `importer`


if __name__ == '__main__':
    unittest.main()
