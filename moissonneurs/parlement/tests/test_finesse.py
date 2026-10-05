"""Finesse (FORMAT-PROPOSITIONS.md) : score par bandes, catégorie, termes avec note_sans, crans par langue figés par trimestre."""
import json
import os
import tempfile
import unittest

from parlement import export_propositions as ep, finesse, lexique, tout
from parlement.stockage import Base
from parlement.tests.outils_test import SourceFictive, config_pipeline
from parlement.tests.test_propositions import TestPropositions, aff
from parlement.tests.test_tout import TestPipeline, affaire


class Fond(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def cfg(self):
        return {'classement': {'ecole_generale': True, 'themes_elargis': True}}

    def ev(self, titre, texte='', extrait=False, harm=2, corps='ZH'):
        base = Base(':memory:')
        a = {'body_key': corps, 'external_id': 'x', 'id_api': '1', 'number': 'N', 'title': titre, 'type_name': json.dumps({'de': 'Motion'}),
             'type_harmonized_id': harm, 'date_depot': '2026-01-01', 'updated_at': '', 'url_externe': '', 'url_oparl': '',
             'empreinte': 'e', 'premiere_vue': '', 'derniere_vue': ''}
        base.c.execute("INSERT INTO bruts VALUES ('affaire:ZH:x','e','{}','now')")
        base.c.execute("INSERT INTO affaires(body_key, external_id, id_api, title, empreinte, premiere_vue, derniere_vue) "
                       "VALUES ('ZH','x','1',?, 'e','','')", (titre,))
        if texte:
            base.c.execute("INSERT INTO documents VALUES ('ZH','1','d','n','','','de',?,'e')", (texte,))
        if extrait:
            base.c.execute("UPDATE bruts SET charge=? WHERE cle='affaire:ZH:x'",
                           (json.dumps({'_search_meta': {'snippets': [{'text': extrait}]}}),))
        r = finesse.evaluer(self.lex, self.cfg(), base, a)
        base.fermer()
        return r


class TestBandes(Fond):
    def test_chaque_score_reste_dans_sa_bande_aux_extremes(self):
        for cat, (bas, haut) in finesse.BANDES.items():
            for v in (0.0, 1.0):
                comp = {k: v for k in finesse.POIDS[cat]}
                s = finesse.score_de(cat, comp)
                self.assertTrue(bas <= s <= haut, (cat, v, s))

    def test_les_bandes_ne_se_recouvrent_pas_et_les_poids_font_un(self):
        bandes = sorted(finesse.BANDES.values())
        for (a, b), (c, d) in zip(bandes, bandes[1:]):
            self.assertLess(b, c)
        for cat, p in finesse.POIDS.items():
            self.assertAlmostEqual(sum(p.values()), 1.0)

    def test_un_titre_fort_passe_avant_tout_texte_dense_ecole_et_theme(self):
        titre = self.ev('Sonderschulung für Kinder')
        ecole = self.ev('Volksschule und Unterricht')
        theme = self.ev('Mobbing unter Jugendlichen')
        self.assertEqual((titre['categorie'], ecole['categorie'], theme['categorie']), ('titre', 'ecole', 'theme'))
        self.assertGreater(titre['score'], 80 - 0.001)
        self.assertTrue(20 <= ecole['score'] <= 39 and 0 <= theme['score'] <= 19)

    def test_le_texte_dense_est_dans_sa_bande(self):
        r = self.ev('Bericht zum Jahr', texte='Die Behinderung von Kindern. ' * 10)
        self.assertEqual(r['categorie'], 'texte-dense')
        self.assertTrue(60 <= r['score'] <= 79)

    def test_la_modulation_departage_dans_la_bande(self):
        a = self.ev('Sonderschulung')
        b = self.ev('Sonderschulung, Autismus und Heilpädagogik')
        self.assertEqual((a['categorie'], b['categorie']), ('titre', 'titre'))
        self.assertGreater(b['score'], a['score'])


class TestTermes(Fond):
    def test_note_sans_est_le_score_de_la_proposition_privee_du_terme(self):
        deux = self.ev('Autismus und Sonderschulung')
        un = self.ev('Sonderschulung')
        n = {t['terme']: t['note_sans'] for t in deux['termes']}
        self.assertEqual(n['Autismus'], un['score'])              # sans Autismus : il reste Sonderschul
        self.assertTrue(all(t['role'] == 'ancrage' and t['ou'] == 'titre' and t['langue'] == 'de' for t in deux['termes']))
        self.assertEqual({t['terme'] for t in deux['termes']}, {'Autismus', 'Sonderschul'})

    def test_le_seul_terme_fait_tomber_la_proposition_note_sans_zero(self):
        (t,) = self.ev('Sonderschulung für alle')['termes']
        self.assertEqual((t['terme'], t['note_sans']), ('Sonderschul', 0.0))

    def test_un_terme_une_seule_fois_a_son_emplacement_le_plus_fort(self):
        r = self.ev('Sonderschulung', texte='Die Sonderschulung wird ausgebaut. ' * 3)
        self.assertEqual([t['terme'] for t in r['termes']].count('Sonderschul'), 1)
        self.assertEqual(next(t for t in r['termes'] if t['terme'] == 'Sonderschul')['ou'], 'titre')

    def test_extrait_texte_et_roles(self):
        r = self.ev('Rapport annuel', extrait='Eine Sonderschulung und Autismus werden erwähnt.')
        self.assertEqual({t['ou'] for t in r['termes']}, {'extrait'})
        self.assertEqual(r['categorie'], 'signal-faible')
        e = self.ev('Volksschule und Unterricht')
        self.assertEqual({(t['terme'], t['role'], t['ou']) for t in e['termes']},
                         {('Volksschule', 'ecole', 'titre'), ('Unterricht', 'ecole', 'titre')})
        th = self.ev('Mobbing unter Jugendlichen')
        self.assertIn(('Mobbing', 'de', 'theme', 'titre'), {(t['terme'], t['langue'], t['role'], t['ou']) for t in th['termes']})

    def test_forme_des_termes_sans_domaine_ni_neutralise(self):
        for t in self.ev('Autismus und Sonderschulung')['termes']:
            self.assertEqual(set(t), {'terme', 'langue', 'role', 'ou', 'note_sans'})
            self.assertIn(t['langue'], ('fr', 'de', 'it'))
            self.assertIn(t['role'], ('ancrage', 'ambigu', 'ecole', 'theme'))

    def test_une_affaire_ecartee_n_a_pas_de_finesse(self):
        self.assertIsNone(self.ev('Strassenunterhalt'))


class TestPlusHauteBande(Fond):
    TITRES = ['Mobbing an Schulen', 'Suizid an Schulen', 'Suizidprävention bei Kindern an Schulen', 'Mobbing unter Jugendlichen',
              'Volksschule und Unterricht', 'Autismus und Sonderschulung', 'Sonderschulung für Kinder an Schulen',
              'Gewalt an Schulen und Mobbing, Resilienz der Schüler', 'Rollstuhl im Unterricht', 'Kindergarten und Spielgruppe']

    def test_ecole_et_theme_sont_classes_ecole_avec_le_theme_en_modulation(self):
        a = self.ev('Mobbing an Schulen')
        b = self.ev('Mobbing und Resilienz an Schulen')
        seul = self.ev('Volksschule')
        self.assertEqual((a['categorie'], b['categorie']), ('ecole', 'ecole'))
        self.assertTrue(20 <= a['score'] <= 39)
        roles = {t['role'] for t in a['termes']}
        self.assertEqual(roles, {'ecole', 'theme'})
        self.assertGreater(b['score'], a['score'])                           # plus de thèmes : un peu plus haut, dans la bande
        self.assertTrue(20 <= seul['score'] <= 39)

    def test_le_verdict_ne_change_pas(self):
        from parlement import classement
        a = dict(body_key='ZH', number='1', title='Zentrum für Brückenangebote an Schulen', type_name={'de': 'Motion'},
                 type_harmonized_id=2)
        r = classement.classer(self.lex, a, '', candidat=True, ecole_generale=True, themes_elargis=True)
        self.assertIn(r.verdict, ('a-relire', 'ecarte'))                     # la règle thème/migration est celle du verdict, intacte

    def test_invariant_note_sans_jamais_au_dessus_du_score(self):
        for t in self.TITRES:
            r = self.ev(t)
            if r is None:
                continue
            for x in r['termes']:
                self.assertLessEqual(x['note_sans'], r['score'], (t, x))

    def test_termes_tries_titre_texte_extrait_puis_note_sans_croissante(self):
        r = self.ev('Autismus und Sonderschulung', texte='Der Rollstuhl und die Behinderung. ' * 3)
        ou = [t['ou'] for t in r['termes']]
        self.assertEqual(ou, sorted(ou, key=lambda x: {'titre': 0, 'texte': 1, 'extrait': 2}[x]))
        for o in ('titre', 'texte'):
            notes = [t['note_sans'] for t in r['termes'] if t['ou'] == o]
            self.assertEqual(notes, sorted(notes))


class TestCrans(unittest.TestCase):
    def pop(self, n, langues=('de',), debut=0.0, pas=0.1, mois='2026-05'):
        return [(debut + i * pas, langues, mois) for i in range(n)]

    def test_fenetre_et_trimestre(self):
        self.assertEqual(finesse.fenetre('2026-10-03'), ('2025-10-01', '2026-09-30'))
        self.assertEqual(finesse.fenetre('2026-01-15'), ('2025-01-01', '2025-12-31'))
        self.assertEqual((finesse.trimestre('2026-10-03'), finesse.trimestre('2026-12-31'), finesse.trimestre('2026-01-01')),
                         ('2026-T4', '2026-T4', '2026-T1'))

    def refs(self, n, haut=100.0):
        return [('de', haut - i * 0.05) for i in range(n)]

    def test_dix_crans_par_langue_seuils_strictement_croissants_et_aucun_cran_identique(self):
        pop = self.pop(300, ('de',)) + self.pop(300, ('fr',), debut=0.05)
        crans, source, _ = finesse.calculer_crans(pop, self.refs(40, 29.0), '2026-10-03')
        for lg in ('fr', 'de'):
            self.assertEqual([e['cran'] for e in crans[lg]], list(range(1, 11)))
            self.assertEqual(crans[lg][0]['seuil'], 0)
            seuils = [e['seuil'] for e in crans[lg]]
            self.assertTrue(all(a < b for a, b in zip(seuils, seuils[1:])), (lg, seuils))
            self.assertFalse(any(e['identique_au_cran_precedent'] for e in crans[lg]), lg)
            pm = [e['par_mois'] for e in crans[lg]]
            self.assertTrue(all(a >= b for a, b in zip(pm, pm[1:])), (lg, pm))
            self.assertEqual(set(crans[lg][0]['egalites']), {'objets', 'groupes', 'plus_grand'})
        self.assertEqual(crans['de'][0]['par_mois'], 25.0)                         # 300 sur 12 mois
        self.assertEqual(source, {'fr': 'langue', 'de': 'langue'})

    def test_les_egalites_ne_comptent_pas_pour_plusieurs_rangs_aucun_cran_identique(self):
        scores = [24.0] * 120 + [30.0] * 120 + [40.0 + i for i in range(60)] + [24.0 + 0.001 * i for i in range(1, 30)]
        pop = [(x, ('de',), '2026-05') for x in scores]
        crans, _, _ = finesse.calculer_crans(pop, [('de', 99.0 - i) for i in range(30)], '2026-10-03')
        seuils = [e['seuil'] for e in crans['de']]
        self.assertTrue(all(a < b for a, b in zip(seuils, seuils[1:])), seuils)
        self.assertFalse(any(e['identique_au_cran_precedent'] for e in crans['de']))

    @staticmethod
    def pas(crans):
        pm = [e['par_mois'] for e in crans]
        return [a - b for a, b in zip(pm[1:], pm[2:])], (pm[1] - pm[9]) / 8

    def test_pas_de_volume_reguliers_aucun_pas_ne_depasse_deux_fois_le_pas_moyen(self):
        scores = [5.0 + 95.0 * (i / 400) ** 2 for i in range(400)]                   # distincts, très inégalement répartis
        pop = [(x, ('de',), '2026-05') for x in scores]
        refs = [('de', x) for x in sorted(scores, reverse=True)[:40]]
        for profil in ('lineaire',):
            crans, _, _ = finesse.calculer_crans(pop, refs, '2026-10-03', 20, profil)
            pas, moyen = self.pas(crans['de'])
            self.assertTrue(all(p <= 2 * moyen for p in pas), (profil, pas, moyen))
            self.assertTrue(all(p > 0 for p in pas))                                   # et chaque cran retire quelque chose
            self.assertFalse(any(e['identique_au_cran_precedent'] for e in crans['de']))

    def test_un_plateau_d_egalites_peut_imposer_un_pas_plus_grand_et_le_test_le_documente(self):
        plateau = 150
        scores = [5.0 + i * 0.5 for i in range(100)] + [30.0] * plateau
        pop = [(x, ('de',), '2026-05') for x in scores]
        refs = [('de', x) for x in sorted(set(scores), reverse=True)[:40]]
        crans, _, _ = finesse.calculer_crans(pop, refs, '2026-10-03', 20, 'lineaire')
        pas, moyen = self.pas(crans['de'])
        # un seul score porte 150 objets : franchir ce plateau retire d'un coup 150/12 = 12,5 par mois, quelle que soit la cible.
        # Le pas peut donc dépasser deux fois le pas moyen, mais seulement du fait du plateau.
        self.assertTrue(max(pas) <= 2 * moyen or max(pas) >= plateau / 12 - 1e-9, (pas, moyen))
        self.assertFalse(any(e['identique_au_cran_precedent'] for e in crans['de']))

    def test_cran_dix_laisse_au_plus_la_cible_de_fiches_de_reference(self):
        pop = self.pop(300, ('de',))
        for cible in (5, 20, 33):
            crans, _, _ = finesse.calculer_crans(pop, self.refs(60, 29.0), '2026-10-03', rappel_strict=cible)
            self.assertLessEqual(crans['de'][9]['rappel'], cible)
            self.assertGreater(crans['de'][9]['rappel'], cible - 3)                # le plus bas seuil qui y satisfait
            self.assertEqual(crans['de'][9]['rappel_sur'], 60)

    def test_cran_dix_francais_prend_le_seuil_de_de_sans_fiche_fr(self):
        pop = self.pop(300, ('de',)) + self.pop(300, ('fr',), debut=0.05)
        crans, _, _ = finesse.calculer_crans(pop, self.refs(60, 29.0), '2026-10-03')
        self.assertEqual((crans['fr'][9]['rappel'], crans['fr'][9]['rappel_sur']), (0, 0))
        self.assertTrue(abs(crans['fr'][9]['seuil'] - crans['de'][9]['seuil']) <= 0.1)
        self.assertGreater(crans['fr'][9]['seuil'], crans['fr'][8]['seuil'])

    def test_une_proposition_multilingue_compte_dans_les_deux_langues(self):
        pop = self.pop(250, ('fr', 'de'))
        crans, _, _ = finesse.calculer_crans(pop, [], '2026-10-03')
        self.assertEqual(crans['fr'][0]['par_mois'], crans['de'][0]['par_mois'])
        self.assertEqual(crans['fr'][0]['par_mois'], round(250 / 12, 1))

    def test_repli_commun_sous_200_propositions_ou_plus_de_trois_crans_identiques(self):
        pop = self.pop(300, ('de',)) + self.pop(50, ('fr',))
        _, source, _ = finesse.calculer_crans(pop, [], '2026-10-03')
        self.assertEqual(source, {'fr': 'commun', 'de': 'langue'})
        plat = [(5.0, ('de',), '2026-05')] * 300 + [(7.0 + i, ('fr',), '2026-05') for i in range(300)]
        _, source, _ = finesse.calculer_crans(plat, [], '2026-10-03')
        self.assertEqual(source['de'], 'commun')                            # tous égaux : crans identiques

    def test_hors_fenetre_ne_compte_pas(self):
        pop = self.pop(300, ('de',), mois='2024-01')
        crans, _, _ = finesse.calculer_crans(pop, [], '2026-10-03')
        self.assertEqual(crans['de'][0]['par_mois'], 0.0)

    def test_egalites(self):
        self.assertEqual(finesse._egalites([1, 1, 1, 2, 2, 3], 2), {'objets': 2, 'groupes': 1, 'plus_grand': 2})
        self.assertEqual(finesse._egalites([1, 1, 1, 2, 2, 3], 0), {'objets': 0, 'groupes': 2, 'plus_grand': 3})

    def test_crans_figes_par_trimestre(self):
        with tempfile.TemporaryDirectory() as rep:
            chemin = os.path.join(rep, 'crans.json')
            appels = []

            def calcul():
                appels.append(1)
                return {'fr': [], 'de': []}, {'fr': 'langue', 'de': 'langue'}
            a = finesse.crans_figes(chemin, calcul, '2026-10-03')
            b = finesse.crans_figes(chemin, calcul, '2026-12-30')              # même trimestre : figé
            self.assertEqual(len(appels), 1)
            self.assertEqual(b['crans_calcules_le'], '2026-10-03')
            self.assertEqual(b['crans_fenetre'], {'du': '2025-10-01', 'au': '2026-09-30'})
            c = finesse.crans_figes(chemin, calcul, '2027-01-02')              # trimestre suivant : recalculé
            self.assertEqual(len(appels), 2)
            self.assertEqual(c['crans_calcules_le'], '2027-01-02')
            self.assertEqual(a['crans_source'], {'fr': 'langue', 'de': 'langue'})

    def test_des_crans_figes_d_une_autre_version_de_la_note_sont_recalcules(self):
        with tempfile.TemporaryDirectory() as rep:
            chemin = os.path.join(rep, 'crans.json')
            with open(chemin, 'w', encoding='utf-8') as f:
                json.dump({'version': finesse.VERSION - 1, 'crans': {}, 'crans_source': {}, 'crans_calcules_le': '2026-10-03',
                           'crans_fenetre': {}}, f)
            appels = []
            r = finesse.crans_figes(chemin, lambda: (appels.append(1), ({'fr': [], 'de': []}, {}))[1], '2026-10-04')
            self.assertEqual(len(appels), 1)
            self.assertEqual(r['crans_calcules_le'], '2026-10-04')

    def test_termes_etat_ref_et_ref_seul(self):
        t = ('Behinderung', 'de', 'ancrage')
        u = ('Autismus', 'de', 'ancrage')
        r = finesse.termes_etat([[t, u], [t]], [[t, u], [t]])
        par = {(e['terme']): e for e in r}
        self.assertEqual((par['Behinderung']['ref'], par['Behinderung']['ref_seul']), (2, 1))
        self.assertEqual((par['Autismus']['ref'], par['Autismus']['ref_seul']), (1, 0))
        self.assertEqual(set(r[0]), {'terme', 'langue', 'role', 'ref', 'ref_seul'})


class TestDansLeLot(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_finesse_dans_pertinence_quand_elle_est_demandee(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'finesse': True}
        self.cfg['classement'] = {'ecole_generale': True, 'themes_elargis': True}
        self.ajouter(aff('ZH', '1', 'Sonderschulung für Kinder'))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        per = p['pertinence']
        self.assertTrue(80 <= per['score'] <= 100)
        self.assertEqual(per['categorie'], 'titre')
        self.assertEqual([t['terme'] for t in per['termes']], ['Sonderschul'])
        self.assertEqual(set(per['termes'][0]), {'terme', 'langue', 'role', 'ou', 'note_sans'})
        self.assertNotIn('note_calibree', json.dumps(p))
        self.assertNotIn('domaine', per)
        self.assertNotIn('neutralise', json.dumps(per['termes']))

    def test_sans_la_demande_le_lot_ne_porte_pas_la_finesse(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire']}
        self.ajouter(aff('ZH', '1', 'Sonderschulung für Kinder'))
        (p,) = self.lot(ep.exporter(self.cfg, self.base))
        self.assertEqual(set(p['pertinence']), {'verdict', 'raison'})


class TestDansEtat(unittest.TestCase):
    setUp, tearDown, emit, source, lancer = (TestPipeline.setUp, TestPipeline.tearDown, TestPipeline.emit, TestPipeline.source,
                                             TestPipeline.lancer)

    def test_etat_json_porte_crans_termes_et_fenetre(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'finesse': True}
        r, code, _ = self.lancer(self.source())
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            etat = json.load(f)
        for lg in ('fr', 'de'):
            self.assertEqual([e['cran'] for e in etat['crans'][lg]], list(range(1, 11)))
            self.assertEqual(etat['crans_source'][lg], 'commun')          # trop peu de propositions : le commun
        self.assertEqual(set(etat['crans_fenetre']), {'du', 'au'})
        self.assertRegex(etat['crans_calcules_le'], r'^\d{4}-\d{2}-\d{2}$')
        self.assertIn('termes', etat)
        self.assertIn('rappel_sur', etat)
        self.assertNotIn('note_calibree', etat)
        self.assertTrue(os.path.exists(os.path.join(os.path.dirname(self.cfg['stockage']['base']), 'crans.json')))

    def test_sans_finesse_etat_json_reste_celui_d_avant(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire']}
        self.lancer(self.source())
        with open(os.path.join(self.cfg['sortie']['propositions'], 'etat.json'), encoding='utf-8') as f:
            etat = json.load(f)
        self.assertNotIn('crans', etat)
        self.assertNotIn('termes', etat)


if __name__ == '__main__':
    unittest.main()


class TestRecalculSansLot(unittest.TestCase):
    setUp, tearDown, emit, source, lancer = (TestPipeline.setUp, TestPipeline.tearDown, TestPipeline.emit, TestPipeline.source,
                                             TestPipeline.lancer)

    def test_recalcul_de_etat_json_ne_reecrit_ni_le_lot_ni_la_table_propositions(self):
        import hashlib
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'finesse': True}
        r, _, _ = self.lancer(self.source())
        dossier = self.cfg['sortie']['propositions']
        lots = sorted(f for f in os.listdir(dossier) if f.endswith('.jsonl'))
        empreintes = {f: hashlib.sha256(open(os.path.join(dossier, f), 'rb').read()).hexdigest() for f in lots}
        base = Base(self.cfg['stockage']['base'])
        avant = [tuple(x) for x in base.c.execute('SELECT * FROM propositions ORDER BY cle')]
        base.fermer()
        self.cfg['finesse'] = {'rappel_strict': 1}                       # réglage changé : les crans doivent bouger
        os.remove(os.path.join(os.path.dirname(self.cfg['stockage']['base']), 'crans.json'))
        tout.recalculer_etat(self.cfg, aujourdhui='2026-10-03')
        self.assertEqual({f: hashlib.sha256(open(os.path.join(dossier, f), 'rb').read()).hexdigest() for f in
                          sorted(f for f in os.listdir(dossier) if f.endswith('.jsonl'))}, empreintes)
        base = Base(self.cfg['stockage']['base'])
        self.assertEqual([tuple(x) for x in base.c.execute('SELECT * FROM propositions ORDER BY cle')], avant)
        base.fermer()
        with open(os.path.join(dossier, 'etat.json'), encoding='utf-8') as f:
            etat = json.load(f)
        self.assertEqual(etat['lot'], os.path.basename(r['lot']))             # le reste de l'état est conservé
        self.assertIn('crans', etat)
