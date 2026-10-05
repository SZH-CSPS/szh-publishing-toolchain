"""Construction, validation et traduction des événements pronto-moisson/1."""
import json
import unittest

import evenements as ev
from tests import lignes_reelles


class Horloge:
    def __init__(self, pas=1.0):
        self.t, self.pas = 0.0, pas

    def __call__(self):
        self.t += self.pas
        return self.t


EST = {'requetes': 20, 'delai_s': 2.0, 'budget': 800}
BUDGET = {'budget': 800, 'marge': 50, 'somme': 100, 'plafond': 650}
HEURE = '2026-11-01T06:00:00Z'


def exemples():
    return {
        'creneau': ev.creneau('pris', 'poste-a', 'compte-a', HEURE),
        'debut': ev.debut(['parlement'], {'parlement': dict(EST)}, 'cli', HEURE, {'parlement': dict(BUDGET)},
                          False),
        'etape': ev.etape('parlement', 'GE', 4, 800, 32, 0.2),
        'attente': ev.attente('recherche', 'phbern', 120, '429', 'www.phbern.ch'),
        'avertissement': ev.avertissement('parlement', 'corps VD en échec'),
        'lot': ev.lot('parlement', 'parlement/2026-11-01-1.jsonl', 14),
        'moissonneur_fin': ev.moissonneur_fin('parlement', 0, None, [], {'lots': 1, 'decisions': 0}, ['snf']),
        'fin': ev.fin(0, 12.5),
        'refus': ev.refus('deja-en-cours', 'lancée par cockpit'),
    }


class Valider(unittest.TestCase):
    def test_chaque_type_construit_est_valide(self):
        for t, e in exemples().items():
            with self.subTest(t):
                self.assertEqual(e['format'], 'pronto-moisson/1')
                self.assertEqual(e['type'], t)
                self.assertEqual(ev.valider(e), [])

    def test_champ_manquant_signale_pour_chaque_type(self):
        for t, e in exemples().items():
            for champ in [c for c in e if c not in ('format', 'type')]:
                with self.subTest(t=t, champ=champ):
                    d = dict(e)
                    del d[champ]
                    self.assertTrue(any(champ in x for x in ev.valider(d)), ev.valider(d))

    def test_champ_en_trop_signale(self):
        for t, e in exemples().items():
            with self.subTest(t):
                self.assertTrue(ev.valider(dict(e, intrus=1)))

    def test_valeurs_hors_contrat(self):
        ex = exemples()
        mauvais = [
            dict(ex['creneau'], etat='vole'),
            dict(ex['creneau'], debut='hier'),
            dict(ex['debut'], declencheur='robot'),
            dict(ex['debut'], heure='hier'),
            dict(ex['debut'], estimation={'parlement': {'requetes': 'x', 'delai_s': 2, 'budget': 1}}),
            dict(ex['debut'], budget_mois={'parlement': {'budget': 800, 'marge': 50, 'somme': 1}}),
            dict(ex['debut'], racine_test='non'),
            dict(ex['attente'], secondes=-1),
            dict(ex['moissonneur_fin'], sources_desactivees='snf'),
            dict(ex['refus'], raison='donnees-absentes'),
            dict(ex['etape'], fraction=1.5),
            dict(ex['etape'], reste_s=2.5),
            dict(ex['etape'], requetes=-1),
            dict(ex['lot'], chemin='/absolu/lot.jsonl'),
            dict(ex['moissonneur_fin'], interrompu='panne'),
            dict(ex['moissonneur_fin'], code=5),
            dict(ex['moissonneur_fin'], purge={'lots': 1}),
            dict(ex['fin'], code=6),
            dict(ex['refus'], raison='autre'),
            dict(ex['etape'], format='pronto-moisson/2'),
            {'format': 'pronto-moisson/1', 'type': 'inconnu'},
            'pas un objet',
        ]
        for e in mauvais:
            with self.subTest(e=e):
                self.assertTrue(ev.valider(e))

    def test_nuls_admis_la_ou_le_contrat_les_admet(self):
        self.assertEqual(ev.valider(ev.etape('recherche', 'hfh', 0, None, None, None)), [])
        self.assertEqual(ev.valider(ev.avertissement(None, 'créneau périmé repris')), [])
        self.assertEqual(ev.valider(ev.debut([], {}, 'raccourci', HEURE, {}, True)), [])
        self.assertEqual(ev.valider(ev.debut(['recherche'], {'recherche': {'requetes': None, 'delai_s': None,
                                                                          'budget': None}},
                                             'cockpit', HEURE,
                                             {'recherche': {'budget': None, 'marge': 50, 'somme': 0,
                                                            'plafond': None}}, False)), [])
        self.assertEqual(ev.valider(ev.attente('recherche', 'phbern', 12, None, None)), [])
        for raison in ('deja-en-cours', 'budget-epuise', 'etat-absent', 'racine-absente', 'config-invalide'):
            self.assertEqual(ev.valider(ev.refus(raison, 'x')), [])
        for etat in ('pris', 'refuse', 'repris-perime', 'retire'):
            self.assertEqual(ev.valider(ev.creneau(etat, 'p', 'c', HEURE)), [])


class PlusGrave(unittest.TestCase):
    def test_ordre(self):
        self.assertEqual(ev.plus_grave([]), 0)
        self.assertEqual(ev.plus_grave([0, 3]), 3)
        self.assertEqual(ev.plus_grave([3, 2]), 2)
        self.assertEqual(ev.plus_grave([2, 1, 3]), 2)
        self.assertEqual(ev.plus_grave([1, 3]), 3)
        self.assertEqual(ev.plus_grave([0, 1]), 1)
        self.assertEqual(ev.plus_grave([2, 5, 3]), 5)
        self.assertEqual(ev.plus_grave([0, 0]), 0)


class Estimation(unittest.TestCase):
    def test_format_reel_requetes_prevues(self):
        self.assertEqual(ev.estimation_de(lignes_reelles.ESTIMATION_REELLE),
                         {'requetes': 40, 'delai_s': 2.0, 'budget': 800})

    def test_format_de_l_interface(self):
        self.assertEqual(ev.estimation_de({'type': 'estimation', 'requetes': 7, 'delai_s': 3, 'budget': 0}),
                         {'requetes': 7, 'delai_s': 3, 'budget': None})

    def test_illisible(self):
        self.assertEqual(ev.estimation_de(None), {'requetes': None, 'delai_s': None, 'budget': None})


class Traduction(unittest.TestCase):
    def verifier(self, nom, cas):
        for ligne, attendus in cas:
            with self.subTest(ligne=ligne):
                t = ev.Traducteur(nom, dict(EST), horloge=Horloge())
                sortie = t.ligne(json.dumps(ligne, ensure_ascii=False))
                self.assertEqual([e['type'] for e in sortie], attendus)
                for e in sortie:
                    self.assertEqual(ev.valider(e), [], e)
                    if 'moissonneur' in e:
                        self.assertEqual(e['moissonneur'], nom)

    def test_recherche(self):
        self.verifier('recherche', lignes_reelles.RECHERCHE)

    def test_parlement(self):
        self.verifier('parlement', lignes_reelles.PARLEMENT)

    def test_tables_couvrent_les_etapes_reelles(self):
        for nom, cas in (('recherche', lignes_reelles.RECHERCHE), ('parlement', lignes_reelles.PARLEMENT)):
            etapes = {l['etape'] for l, _ in cas if l['type'] == 'progression'}
            self.assertEqual(etapes - set(ev.TABLES[nom]['progression']), set())

    def test_libelle_corps_ou_source(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        e, = t.ligne(json.dumps({'type': 'progression', 'etape': 'moisson', 'corps': 'GE', 'statut': 'ok',
                                 'requetes': 4}))
        self.assertEqual((e['etape'], e['requetes'], e['budget']), ('GE', 4, 800))
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        e, = t.ligne(json.dumps({'type': 'progression', 'etape': 'moisson', 'source': 'hfh', 'statut': 'ok',
                                 'requetes': 4}))
        self.assertEqual(e['etape'], 'hfh')

    def test_compteur_porte_son_budget(self):
        t = ev.Traducteur('parlement', dict(EST, budget=None), horloge=Horloge())
        e, = t.ligne(json.dumps({'type': 'compteur', 'requetes': 412, 'budget': 800}))
        self.assertEqual((e['requetes'], e['budget']), (412, 800))

    def test_requetes_gardees_quand_la_ligne_ne_les_porte_pas(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        t.ligne(json.dumps({'type': 'progression', 'etape': 'moisson', 'corps': 'GE', 'statut': 'ok',
                            'requetes': 9}))
        e, = t.ligne(json.dumps({'type': 'progression', 'etape': 'moisson', 'corps': 'BE', 'statut': 'budget'}))
        self.assertEqual(e['requetes'], 9)

    def test_echec_cite_la_raison(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        e, = t.ligne(json.dumps({'type': 'progression', 'etape': 'moisson', 'corps': 'VD', 'statut': 'echec',
                                 'raison': 'HTTPError: 500'}))
        self.assertIn('VD', e['message'])
        self.assertIn('HTTPError: 500', e['message'])


class LigneInconnue(unittest.TestCase):
    def test_type_inconnu_devient_avertissement_qui_la_cite(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        e, = t.ligne('{"type": "nouveaute", "x": 1}')
        self.assertEqual(e['type'], 'avertissement')
        self.assertIn('nouveaute', e['message'])
        self.assertEqual(ev.valider(e), [])

    def test_etape_inconnue_devient_avertissement(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        e, = t.ligne('{"type": "progression", "etape": "teleportation", "statut": "ok"}')
        self.assertEqual(e['type'], 'avertissement')
        self.assertIn('teleportation', e['message'])

    def test_texte_non_json_devient_avertissement(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        e, = t.ligne('Traceback (most recent call last):')
        self.assertEqual(e['type'], 'avertissement')
        self.assertIn('Traceback', e['message'])

    def test_citation_tronquee(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        e, = t.ligne('x' * 5000)
        self.assertLess(len(e['message']), 400)
        self.assertIn('…', e['message'])

    def test_ligne_vide_ignoree(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        self.assertEqual(t.ligne('  \n'), [])


class Reste(unittest.TestCase):
    def ligne(self, r):
        return json.dumps({'type': 'progression', 'etape': 'moisson', 'corps': 'GE', 'statut': 'ok', 'requetes': r})

    def test_estimation_et_delai_puis_vitesse_mesuree(self):
        h = Horloge(pas=1.0)
        t = ev.Traducteur('parlement', {'requetes': 100, 'delai_s': 2.0, 'budget': 800}, horloge=h)
        e, = t.ligne(self.ligne(1))         # trop tôt pour mesurer : 99 × 2 s
        self.assertEqual(e['reste_s'], 198)
        self.assertAlmostEqual(e['fraction'], 0.01)
        h.pas = 0.1
        e, = t.ligne(self.ligne(50))         # mesurée : (50 requêtes en 1,1 s) → 50 × 0,022 s
        self.assertEqual(e['reste_s'], 2)
        self.assertAlmostEqual(e['fraction'], 0.5)

    def test_etape_hors_ligne_ne_fausse_pas_la_vitesse(self):
        h = Horloge(pas=1.0)
        t = ev.Traducteur('parlement', {'requetes': 100, 'delai_s': 2.0, 'budget': 800}, horloge=h)
        e1, = t.ligne(self.ligne(10))
        h.pas = 60
        e2, = t.ligne(json.dumps({'type': 'progression', 'etape': 'classement', 'statut': 'ok', 'requetes': 10}))
        e3, = t.ligne(json.dumps({'type': 'progression', 'etape': 'purge', 'statut': 'ok', 'requetes': 10}))
        self.assertEqual(e1['reste_s'], e2['reste_s'])
        self.assertEqual(e2['reste_s'], e3['reste_s'])

    def test_estimation_depassee_borne_au_budget(self):
        t = ev.Traducteur('parlement', {'requetes': 10, 'delai_s': 2.0, 'budget': 40}, horloge=Horloge(pas=0))
        e, = t.ligne(self.ligne(20))
        self.assertEqual(e['reste_s'], 40)
        self.assertAlmostEqual(e['fraction'], 0.5)

    def test_incalculable_donne_null(self):
        t = ev.Traducteur('parlement', {'requetes': None, 'delai_s': None, 'budget': None}, horloge=Horloge())
        e, = t.ligne(self.ligne(3))
        self.assertIsNone(e['reste_s'])
        self.assertIsNone(e['fraction'])
        t = ev.Traducteur('parlement', {'requetes': 10, 'delai_s': 2.0, 'budget': None}, horloge=Horloge())
        e, = t.ligne(self.ligne(30))
        self.assertIsNone(e['reste_s'])


class Terminer(unittest.TestCase):
    def test_fin_d_apres_le_resume(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        ligne, _ = lignes_reelles.PARLEMENT[-5]
        lot, = t.ligne(json.dumps(ligne))
        self.assertEqual(lot['chemin'], 'parlement/2026-11-01-1.jsonl')
        self.assertEqual(lot['propositions'], 14)
        f, = t.terminer(0)
        self.assertEqual(ev.valider(f), [])
        self.assertEqual(f['type'], 'moissonneur_fin')
        self.assertEqual(f['purge'], {'lots': 1, 'decisions': 2})
        self.assertEqual(f['sources_en_echec'], [{'source': 'VD', 'raison': 'HTTPError: 500'}])
        self.assertIsNone(f['interrompu'])
        self.assertEqual(f['sources_desactivees'], [])

    def test_sources_desactivees_et_403_qui_continue(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        self.assertEqual(t.ligne(json.dumps(lignes_reelles.RECHERCHE[-3][0])), [])
        a, = t.ligne(json.dumps(lignes_reelles.RECHERCHE[-2][0]))
        self.assertEqual(t.ligne(json.dumps(lignes_reelles.RECHERCHE[-1][0])), [])
        self.assertEqual(a['moissonneur'], 'recherche')
        self.assertEqual(a['message'], "PH St. Gallen a refusé l’accès (403)")
        f, = t.terminer(1)
        self.assertEqual(f['sources_desactivees'], ['phlu'])
        self.assertEqual(f['sources_en_echec'], [{'source': 'phsg', 'raison': '403'}])
        self.assertEqual((f['code'], f['plantage']), (1, False))

    def test_parlement_sans_avertissement_propre_garde_le_message(self):
        t = ev.Traducteur('parlement', dict(EST), horloge=Horloge())
        a, = t.ligne(json.dumps({'type': 'progression', 'etape': 'moisson', 'corps': 'BE', 'statut': 'echec',
                                 'raison': '403'}))
        self.assertIn('BE', a['message'])
        self.assertIn('403', a['message'])

    def test_attente(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        e, = t.ligne(json.dumps(lignes_reelles.RECHERCHE[-4][0]))
        self.assertEqual((e['etape'], e['secondes'], e['motif'], e['hote']),
                         ('phbern', 120, '429', 'www.phbern.example'))

    def test_a_blanc_ne_depose_pas_de_lot(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge(), a_blanc=True)
        ligne, _ = lignes_reelles.RECHERCHE[-6]
        e, = t.ligne(json.dumps(ligne))
        self.assertEqual(e['type'], 'avertissement')
        self.assertIn('2026-11-01-1.jsonl', e['message'])

    def test_sans_resume_et_arret_force(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        f, = t.terminer(-9, force_arret=True)
        self.assertEqual((f['code'], f['interrompu']), (3, 'arret'))
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        self.assertFalse(f['plantage'])
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        f, = t.terminer(-11)
        self.assertEqual((f['code'], f['interrompu'], f['plantage']), (1, None, True))
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        f, = t.terminer(1)
        self.assertTrue(f['plantage'])

    def test_code_1_avec_resume_n_est_pas_un_plantage(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        t.ligne(json.dumps(lignes_reelles.RECHERCHE[-1][0]))
        f, = t.terminer(1)
        self.assertEqual((f['code'], f['plantage']), (1, False))
        self.assertEqual(ev.code_de_passe(f), 1)
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        f, = t.terminer(1)
        self.assertEqual(ev.code_de_passe(f), 5)

    def test_source_site_lisible(self):
        t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
        e, = t.ligne(json.dumps({'type': 'progression', 'etape': 'moisson', 'source': 'site:phbern',
                                 'statut': 'ok', 'requetes': 3}))
        self.assertEqual(e['etape'], 'phbern')

    def test_interruptions_du_resume(self):
        for brut, attendu in (('budget', 'budget'), ('403', '403'), ('arret', 'arret'), ('configuration', None),
                              (None, None)):
            with self.subTest(brut):
                t = ev.Traducteur('recherche', dict(EST), horloge=Horloge())
                t.ligne(json.dumps({'type': 'resume', 'lot': '', 'interrompu': brut, 'erreur': '',
                                    'sources_en_echec': [], 'purge': {'lots': [], 'decisions': []}}))
                f, = t.terminer(3 if attendu else 0)
                self.assertEqual(f['interrompu'], attendu)


if __name__ == '__main__':
    unittest.main()
