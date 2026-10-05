"""Passe mensuelle /v1/ : tout est faux, aucune requête réelle (Reseau avec `ouvrir` factice)."""
import os
import tempfile
import unittest

from parlement import lexique, moisson, passe_mensuelle as pm
from parlement.reseau import Reseau
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import config_pipeline

import time
MOIS = time.strftime('%Y-%m-%d')


class SourceFausse:
    """Chaque appel de la source coûte une requête sur le Reseau (donc compte dans le budget)."""
    def __init__(self, reseau, affaires=None):
        self.reseau = reseau
        self.affaires = affaires or {}
        self.appels = []

    def _requete(self, nom):
        self.appels.append(nom)
        self.reseau.get('https://api.example.invalid/' + str(len(self.appels)), cache=False)

    @staticmethod
    def localiser(v):
        return v if isinstance(v, str) else ''

    def moissonner_depot(self, config, reseau, connus, corps, repere_depot, etat=None):
        self._requete(('liste', corps, repere_depot))
        etat.update({'pages': 1, 'sans_date': 0, 'sans_date_plafonne': False})
        for a in self.affaires.get(corps, []):
            if a.external_id not in connus:
                yield a

    def rechercher(self, config, reseau, terme, langue, depuis='', etat=None, cache=True):
        self._requete(('recherche', terme, depuis, cache))
        if etat is not None:
            etat['total'] = 0
        return iter(())

    def documents(self, config, reseau, id_api):
        self._requete(('docs', id_api))
        return {'data': []}, []


class Fond(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.cfg = config_pipeline(self._t.name)
        self.cfg['mensuelle'] = {'budget': 800, 'delai': 5.0}
        self.cfg['classement'] = {'ecole_generale': False, 'themes_elargis': False}
        self.base = Base(':memory:')

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def reseau(self, budget=800, delai=0.0):
        self.pauses = []
        return Reseau({'delai': delai, 'budget': budget, 'cache': os.path.join(self._t.name, 'c'),
                       'journal': os.path.join(self._t.name, 'j.jsonl')}, ouvrir=lambda u, h: (200, {}, b'{}'),
                      dormir=self.pauses.append)

    def faux(self):
        """Arguments qui coupent Reseau de tout vrai réseau et de tout vrai sommeil."""
        return {'ouvrir': lambda u, h: (200, {}, b'{}'), 'dormir': lambda s: None}

    def avec_reperes(self, *corps):
        """Un repère par corps, et des affaires déposées (CHE 3 > GE 2 > ZH 1 : l'ordre de passage) pour le repère de dépôt."""
        taille = {'CHE': 3, 'GE': 2, 'ZH': 1}
        for c in corps:
            self.base.poser_repere(c, '2026-10-01T00:00:00')
            for i in range(taille.get(c, 1)):
                self.base.enregistrer_affaire(Affaire(body_key=c, external_id=f'{c}{i}', id_api=f'{c}{i}', title='x',
                                                      date_depot=f'2026-0{taille.get(c, 1)}-01', brut={'i': f'{c}{i}'}))
        self.base.commit()


class TestPasse(Fond):
    def test_pages_de_liste_depuis_le_repere_et_recherche_che_depuis_le_repere_sans_cache(self):
        self.avec_reperes('CHE', 'GE', 'ZH')
        r = self.reseau()
        src = SourceFausse(r, {'GE': [Affaire(body_key='GE', external_id='1', id_api='1', title='Motion handicap',
                                              updated_at='2026-11-01T00:00:00', date_depot='2026-11-01', brut={'a': 1})]})
        rap = pm.passe(self.cfg, self.base, r, src, self.lex, aujourdhui=MOIS)
        self.assertEqual(rap['statut'], 'ok')
        listes = [a for a in src.appels if a[0] == 'liste']
        self.assertEqual([a[1] for a in listes], ['ZH', 'GE', 'CHE'])           # du plus petit au plus gros corps
        self.assertEqual({a[1]: a[2] for a in listes}, {'ZH': '2026-01-01', 'GE': '2026-02-01', 'CHE': '2026-03-01'})   # repère de dépôt
        rech = [a for a in src.appels if a[0] == 'recherche']
        self.assertEqual(len(rech), rap['recherche'])
        self.assertGreater(len(rech), 200)
        self.assertTrue(all(a[2] == '2026-03-01' and a[3] is False for a in rech))     # depuis le repère de dépôt de CHE, pages fraîches
        self.assertEqual(rap['corps']['GE']['nouvelles'], 1)
        self.assertEqual(self.base.repere('GE'), '2026-10-01T00:00:00')         # le repère updated_at n'avance plus
        self.assertEqual(moisson.repere_depot(self.base, 'GE'), '2026-11-01')   # celui du dépôt, oui

    def test_un_essai_sur_des_corps_choisis_ne_fait_ni_recherche_ni_textes(self):
        self.avec_reperes('CHE', 'GE', 'ZH')
        r = self.reseau()
        src = SourceFausse(r)
        rap = pm.passe(self.cfg, self.base, r, src, self.lex, aujourdhui=MOIS, corps=['GE', 'ZH'])
        self.assertEqual([a[1] for a in src.appels], ['GE', 'ZH'])
        self.assertEqual((rap['recherche'], rap['textes'], rap['statut']), (0, 0, 'ok'))

    def test_un_corps_sans_repere_n_est_jamais_moissonne_par_l_api(self):
        self.avec_reperes('CHE')
        r = self.reseau()
        src = SourceFausse(r)
        rap = pm.passe(self.cfg, self.base, r, src, self.lex, aujourdhui=MOIS)
        self.assertIn('GE', rap['sans_repere'])
        self.assertNotIn('GE', [a[1] for a in src.appels if a[0] == 'liste'])

    def test_arret_net_au_plafond_et_reprise_au_repere(self):
        self.avec_reperes('CHE', 'GE', 'ZH')
        r = self.reseau(budget=2)
        src = SourceFausse(r, {'GE': [Affaire(body_key='GE', external_id='1', id_api='1', title='x',
                                              updated_at='2026-11-01T00:00:00', brut={})]})
        rap = pm.passe(self.cfg, self.base, r, src, self.lex, aujourdhui=MOIS)
        self.assertEqual(rap['statut'], 'plafond')
        self.assertEqual(rap['requetes'], 2)
        self.assertEqual(r.requetes, 2)                                       # pas une requête de plus
        self.assertIsNone(self.base.c.execute(
            "SELECT 1 FROM executions WHERE commande='mensuelle' AND statut='en-cours'").fetchone())
        self.assertEqual(self.base.repere('ZH'), '2026-10-01T00:00:00')       # corps non terminé : repère inchangé

    def test_le_budget_est_mensuel_et_cumule_sur_les_passes(self):
        self.avec_reperes('CHE', 'GE', 'ZH')
        self.cfg['mensuelle']['budget'] = 5
        r, restant = pm.reseau_mensuel(self.cfg, self.base, aujourdhui=MOIS, **self.faux())
        self.assertEqual(restant, 5)
        pm.passe(self.cfg, self.base, r, SourceFausse(r), self.lex, aujourdhui=MOIS)
        r2, restant2 = pm.reseau_mensuel(self.cfg, self.base, aujourdhui=MOIS, **self.faux())
        self.assertEqual(restant2, 0)                                         # les 5 requêtes du mois sont dépensées
        rap = pm.passe(self.cfg, self.base, r2, SourceFausse(r2), self.lex, aujourdhui=MOIS)
        self.assertEqual((rap['statut'], rap['requetes']), ('plafond', 0))
        r3, restant3 = pm.reseau_mensuel(self.cfg, self.base, aujourdhui='2099-12-02', **self.faux())
        self.assertEqual(restant3, 5)                                         # le mois suivant repart à zéro

    def test_plafond_d_execution_borne_un_essai_sans_toucher_au_budget_du_mois(self):
        self.avec_reperes('CHE', 'GE', 'ZH')
        r, restant = pm.reseau_mensuel(self.cfg, self.base, aujourdhui=MOIS, plafond_execution=3, **self.faux())
        self.assertEqual((r.budget, restant), (3, 800))
        rap = pm.passe(self.cfg, self.base, r, SourceFausse(r), self.lex, aujourdhui=MOIS)
        self.assertEqual((rap['statut'], rap['requetes']), ('plafond', 3))
        _, restant2 = pm.reseau_mensuel(self.cfg, self.base, aujourdhui=MOIS, **self.faux())
        self.assertEqual(restant2, 797)                                       # l'essai compte dans le mois

    def test_delai_de_deux_secondes_et_requetes_anonymes(self):
        self.avec_reperes('CHE')
        del self.cfg['mensuelle']                  # sans réglage : les valeurs de la décision du 04.10.2026
        r, _ = pm.reseau_mensuel(self.cfg, self.base, aujourdhui=MOIS, **self.faux())
        self.assertEqual(r.delai, 2.0)
        self.assertIsNone(r.user_agent)
        self.assertEqual(r.budget, 800)

    def test_la_recherche_ne_redemande_pas_les_termes_deja_faits_ce_mois(self):
        self.avec_reperes('CHE')
        r = self.reseau()
        src = SourceFausse(r)
        pm.passe(self.cfg, self.base, r, src, self.lex, aujourdhui=MOIS)
        n1 = len([a for a in src.appels if a[0] == 'recherche'])
        r2 = self.reseau()
        src2 = SourceFausse(r2)
        pm.passe(self.cfg, self.base, r2, src2, self.lex, aujourdhui=MOIS)
        self.assertEqual(len([a for a in src2.appels if a[0] == 'recherche']), 0)
        self.assertGreater(n1, 200)


if __name__ == '__main__':
    unittest.main()
