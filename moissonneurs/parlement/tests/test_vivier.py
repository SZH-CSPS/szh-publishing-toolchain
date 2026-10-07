"""Vivier élargi : texte-large, bande 0 à 4,99, jamais « retenu » ; crans, cran_defaut."""
import json
import os
import unittest

from parlement import classement, export_propositions as ep, finesse, lexique
from parlement.tests.test_finesse import Fond as FondFinesse, TestDansEtat as _  # noqa: F401  (Fond de finesse)
from parlement.tests.test_propositions import TestPropositions, aff
from parlement.tests.test_tout import TestPipeline


class Fond(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def c(self, titre, texte='', vivier=True, **kw):
        a = dict(body_key='ZH', number='1', title=titre, type_name={'de': 'Motion'}, type_harmonized_id=2)
        a.update(kw)
        return classement.classer(self.lex, a, texte, candidat=True, ecole_generale=True, themes_elargis=True, vivier_large=vivier)


# Texte à deux termes forts distincts, trop peu dense pour être « retenu »
TEXTE = 'Verkehr und Strassen. ' * 400 + ' Der Rollstuhl und die Sonderschulung werden erwähnt.'


class TestRegle(Fond):
    def test_deux_termes_forts_distincts_dans_le_texte_font_un_a_relire_texte_large(self):
        r = self.c('Verkehrsplanung', TEXTE)
        self.assertEqual(r.verdict, 'a-relire')
        self.assertTrue(r.raison.startswith(classement.PREFIXE_VIVIER))
        self.assertEqual(self.c('Verkehrsplanung', TEXTE, vivier=False).verdict, 'ecarte')

    def test_jamais_retenu(self):
        for texte in (TEXTE, 'Rollstuhl und Sonderschulung. ' * 400):
            self.assertNotEqual(self.c('Verkehrsplanung', texte).verdict if 'Strassen' in texte else 'a-relire', 'retenu')
        # un texte dense reste « retenu » par la règle ordinaire, pas par le vivier
        dense = self.c('Bericht zum Jahr', 'Die Behinderung von Kindern. ' * 10)
        self.assertEqual(dense.verdict, 'retenu')
        self.assertFalse(dense.raison.startswith(classement.PREFIXE_VIVIER))

    def test_un_seul_terme_ne_suffit_pas_ni_l_extrait_ni_un_type_ferme(self):
        self.assertEqual(self.c('Verkehrsplanung', 'Verkehr. ' * 300 + 'Der Rollstuhl.').verdict, 'ecarte')
        a = dict(body_key='ZH', number='1', title='Verkehrsplanung', type_name={'de': 'Motion'}, type_harmonized_id=2)
        r = classement.classer(self.lex, a, TEXTE, candidat=True, extrait=True, vivier_large=True)
        self.assertFalse(r.raison.startswith(classement.PREFIXE_VIVIER))          # extrait : règle de l'extrait, pas le vivier
        fragestunde = self.c('Verkehrsplanung', TEXTE, type_harmonized_id=10)
        self.assertEqual(fragestunde.verdict, 'ecarte')                      # type restreint : le vivier ne s'y applique pas

    def test_les_autres_categories_ne_changent_pas(self):
        for t in ('Sonderschulung für Kinder', 'Volksschule und Unterricht', 'Mobbing unter Jugendlichen'):
            self.assertEqual(self.c(t).verdict, self.c(t, vivier=False).verdict, t)
            self.assertEqual(self.c(t).raison, self.c(t, vivier=False).raison, t)


class TestBandeEtNote(FondFinesse):
    def cfg(self):
        return {'classement': {'ecole_generale': True, 'themes_elargis': True, 'vivier_large': True}}

    def test_texte_large_bande_zero_a_quatre_virgule_quatre_vingt_dix_neuf(self):
        r = self.ev('Verkehrsplanung', texte=TEXTE)
        self.assertEqual(r['categorie'], 'texte-large')
        self.assertTrue(0 <= r['score'] <= 4.99)
        self.assertNotIn('tres_large', json.dumps(r))

    def test_la_bande_du_vivier_est_sous_celle_du_theme(self):
        self.assertLess(finesse.BANDES[6][1], finesse.BANDES[5][0])
        theme = self.ev('Mobbing unter Jugendlichen')
        self.assertGreaterEqual(theme['score'], 5)

    def test_invariant_et_chute_a_zero_en_retirant_un_terme(self):
        r = self.ev('Verkehrsplanung', texte=TEXTE)
        self.assertEqual({t['terme'] for t in r['termes']}, {'Rollstuhl', 'Sonderschul'})
        for t in r['termes']:
            self.assertEqual(t['note_sans'], 0.0)                              # sans lui, un seul terme fort : l'objet tombe
            self.assertLessEqual(t['note_sans'], r['score'])
            self.assertEqual((t['role'], t['ou']), ('ancrage', 'texte'))
        trois = self.ev('Verkehrsplanung', texte=TEXTE + ' Auch Autismus wird erwähnt.')
        for t in trois['termes']:
            self.assertLessEqual(t['note_sans'], trois['score'])
            self.assertGreater(t['note_sans'], 0)                              # il en reste deux : toujours dans le vivier


class TestCransAvecVivier(unittest.TestCase):
    def pop(self, n_normal, n_large, langues=('de',), mois='2026-05'):
        normal = [(5.0 + i * 0.3, langues, mois, False) for i in range(n_normal)]
        large = [(i * 0.01, langues, mois, True) for i in range(n_large)]
        return normal + large

    def refs(self, n=40):
        return [('de', 5.0 + (299 - i) * 0.3) for i in range(n)]

    def test_cran_un_a_zero_cran_deux_au_plus_bas_du_normal_et_paliers_sur_valeurs_distinctes_du_normal(self):
        pop = self.pop(300, 100)
        crans, _, defaut = finesse.calculer_crans(pop, self.refs(), '2026-10-03')
        c = crans['de']
        self.assertEqual(defaut, 2)
        self.assertEqual(c[0]['seuil'], 0)
        self.assertEqual(c[1]['seuil'], 5.0)                                   # le plus bas du réglage normal
        self.assertEqual(c[0]['par_mois'], round(400 / 12, 1))                 # le vivier compte au cran 1
        self.assertEqual(c[1]['par_mois'], round(300 / 12, 1))                 # et plus au cran 2
        seuils = [e['seuil'] for e in c]
        self.assertTrue(all(a < b for a, b in zip(seuils, seuils[1:])))
        self.assertFalse(any(e['identique_au_cran_precedent'] for e in c))
        normaux = {round(s, 2) for s, _, _, large in pop if not large}
        self.assertTrue(all(e['seuil'] in normaux for e in c[1:]))             # chaque seuil est un score normal existant
        self.assertLessEqual(c[9]['rappel'], 20)

    def test_les_seuils_ignorent_le_vivier(self):
        avec = finesse.calculer_crans(self.pop(300, 150), self.refs(), '2026-10-03')[0]['de']
        sans = finesse.calculer_crans(self.pop(300, 0), self.refs(), '2026-10-03')[0]['de']
        self.assertEqual(avec[-1]['seuil'], sans[-1]['seuil'])                     # même cran 10 (cible de fiches), vivier ou non
        self.assertTrue(all(e['seuil'] >= 5.0 for e in avec[1:]))              # jamais un score du vivier

    def test_sans_vivier_cran_defaut_un_et_aucun_cran_identique(self):
        crans, _, defaut = finesse.calculer_crans(self.pop(300, 0), self.refs(), '2026-10-03')
        self.assertEqual(defaut, 1)
        self.assertEqual(crans['de'][0]['seuil'], 0)
        self.assertFalse(any(e['identique_au_cran_precedent'] for e in crans['de']))
        self.assertNotIn('tres_large', crans['de'][0])
        self.assertNotIn('defaut', crans['de'][0])

    def test_rappel_au_cran_un_compte_le_vivier_et_pas_au_cran_deux(self):
        pop = self.pop(300, 100)
        crans, _, _ = finesse.calculer_crans(pop, [('de', 2.0), ('de', 50.0), ('de', None)], '2026-10-03')
        self.assertEqual((crans['de'][0]['rappel'], crans['de'][0]['rappel_sur']), (2, 3))
        self.assertEqual(crans['de'][1]['rappel'], 1)                          # 2.0 est sous le seuil du cran 2

    def test_crans_figes_version_et_cran_defaut(self):
        import tempfile
        self.assertEqual(finesse.VERSION, 5)
        with tempfile.TemporaryDirectory() as rep:
            chemin = os.path.join(rep, 'crans.json')
            r = finesse.crans_figes(chemin, lambda: ({'fr': [], 'de': []}, {}, 2), '2026-10-03')
            self.assertEqual(r['cran_defaut'], 2)
            r1 = finesse.crans_figes(os.path.join(rep, 'c1.json'), lambda: ({'fr': [], 'de': []}, {}, 1), '2026-10-03')
            self.assertNotIn('cran_defaut', r1)


class TestDansLeLot(unittest.TestCase):
    setUp, tearDown, ajouter, lot = (TestPropositions.setUp, TestPropositions.tearDown, TestPropositions.ajouter,
                                     TestPropositions.lot)

    def test_texte_large_dans_le_lot_a_relire_sans_drapeau_et_soumis_a_l_arriere(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'finesse': True, 'arriere_a_relire_mois': 3}
        self.cfg['classement'] = {'ecole_generale': True, 'themes_elargis': True, 'vivier_large': True}
        self.ajouter(aff('ZH', '1', 'Verkehrsplanung', depot='2026-09-01'), verdict='a-relire',
                     raison=classement.PREFIXE_VIVIER + ' : x')
        self.ajouter(aff('ZH', '2', 'Strassenplanung', depot='2025-01-01'), verdict='a-relire',
                     raison=classement.PREFIXE_VIVIER + ' : x')
        for i in ('1', '2'):
            self.base.c.execute("INSERT INTO documents VALUES ('ZH',?,'d','n','','','de',?,'e')", (i, TEXTE))
        res = ep.exporter(self.cfg, self.base, maintenant='2026-10-03T08:00:00Z')
        lignes = self.lot(res)
        self.assertEqual([p['cle'].rsplit(':', 1)[1] for p in lignes], ['1'])    # le vieux est retenu hors lot (arriéré)
        per = lignes[0]['pertinence']
        self.assertEqual((per['categorie'], per['verdict']), ('texte-large', 'a-relire'))
        self.assertTrue(0 <= per['score'] <= 4.99)
        self.assertNotIn('tres_large', json.dumps(lignes[0]))


class TestEtatCranDefaut(unittest.TestCase):
    setUp, tearDown, emit, source, lancer = (TestPipeline.setUp, TestPipeline.tearDown, TestPipeline.emit, TestPipeline.source,
                                             TestPipeline.lancer)

    def test_cran_defaut_deux_avec_vivier_et_absent_sans(self):
        self.cfg['export'] = {'verdicts': ['retenu', 'a-relire'], 'finesse': True}
        self.cfg['classement'] = {'ecole_generale': False, 'themes_elargis': False}
        self.lancer(self.source())
        chemin = os.path.join(self.cfg['sortie']['propositions'], 'etat.json')
        with open(chemin, encoding='utf-8') as f:
            etat = json.load(f)
        self.assertNotIn('cran_defaut', etat)                                   # aucun objet texte-large : le cran 1 est le normal
        self.assertNotIn('tres_large', json.dumps(etat))
        self.assertNotIn('"defaut"', json.dumps(etat['crans']))


if __name__ == '__main__':
    unittest.main()
