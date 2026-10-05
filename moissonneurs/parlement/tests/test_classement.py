import unittest

from parlement import classement, lexique


def aff(titre, **kw):
    d = dict(body_key='BE', number='25.1', title=titre, type_name={'de': 'Motion'}, type_harmonized_id=2)
    d.update(kw)
    return d


class TestClassement(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def c(self, a, texte='', candidat=True):
        return classement.classer(self.lex, a, texte, candidat)

    def test_ancrage_dans_le_titre_retient(self):
        r = self.c(aff('Sonderpädagogik im Kanton Bern stärken'))
        self.assertEqual(r.verdict, 'retenu')
        self.assertEqual(r.jeton, 'motion')
        self.assertIn('Sonderpädagogik', r.raison)

    def test_domaine_education_classe_en_premier(self):
        r = self.c(aff('Schule und Behinderung: Unterricht an der Volksschule'))
        self.assertEqual(r.verdict, 'retenu')
        self.assertEqual(r.domaine, 'education')

    def test_integration_des_migrants_n_est_pas_retenue(self):
        r = self.c(aff('Integrationsförderung für Migranten', ), texte='Integration von Migranten ' * 10)
        self.assertEqual(r.verdict, 'ecarte')

    def test_integration_seule_dans_le_titre_est_a_relire(self):
        r = self.c(aff("Intégration à l'école"))
        self.assertEqual(r.verdict, 'a-relire')
        self.assertIn('ambigu', r.raison)

    def test_fragestunde_jamais_retenue(self):
        r = self.c(aff('Behindertengerechte Bahnhöfe', type_harmonized_id=10, type_name={'de': 'Fragestunde'}))
        self.assertEqual(r.verdict, 'a-relire')
        self.assertIn('plafonné', r.raison)

    def test_fragestunde_sans_ancrage_est_ecartee(self):
        r = self.c(aff('Parkplätze beim Bahnhof', type_harmonized_id=10), texte='x', candidat=True)
        self.assertEqual(r.verdict, 'ecarte')

    def test_informationsdokument_plafonne(self):
        r = self.c(aff('Bericht Inklusion Handicap', type_harmonized_id=15, type_name={'de': 'Informationsdokument'}))
        self.assertEqual(r.verdict, 'a-relire')

    def test_type_ecarte_election(self):
        r = self.c(aff('Wahl in die Behindertenkommission', type_harmonized_id=6))
        self.assertEqual(r.verdict, 'ecarte')
        self.assertIn('élection', r.raison)

    def test_regierungsgeschaeft_budget_ecarte(self):
        r = self.c(aff('Globalbudget der Verwaltung', type_harmonized_id=9, type_name={'de': 'Globalbudget'}))
        self.assertEqual(r.verdict, 'ecarte')

    def test_regierungsgeschaeft_gesetz_retenu(self):
        r = self.c(aff('Revision Gesetz über die Sonderschulung', type_harmonized_id=9,
                       type_name={'de': 'Gesetz'}))
        self.assertEqual(r.verdict, 'retenu')

    def test_regierungsgeschaeft_type_inconnu_plafonne(self):
        r = self.c(aff('Sonderpädagogik-Konzept', type_harmonized_id=9, type_name={'de': 'Etwas Neues'}))
        self.assertEqual(r.verdict, 'a-relire')

    def test_texte_seul_dense_retient(self):
        texte = 'Die Behinderung von Kindern. ' * 8
        r = self.c(aff('Bericht zum Jahr'), texte=texte)
        self.assertEqual(r.verdict, 'retenu')
        self.assertIn('texte', r.raison)

    def test_mention_en_passant_dans_un_long_texte_est_ecartee(self):
        texte = 'Verkehr und Strassen. ' * 2000 + ' Menschen mit Behinderung.'
        r = self.c(aff('Verkehrsplanung'), texte=texte)
        self.assertEqual(r.verdict, 'ecarte')

    def test_texte_absent_candidat_est_ecarte(self):
        r = self.c(aff('Rapport annuel'), texte='', candidat=True)
        self.assertEqual(r.verdict, 'ecarte')

    def test_aucun_ancrage_ecarte(self):
        r = self.c(aff('Strassenunterhalt'), texte='Der Strassenbelag wird erneuert.')
        self.assertEqual(r.verdict, 'ecarte')

    def test_standesinitiative_rattrapee_par_type_name(self):
        r = self.c(aff('Standesinitiative zur IV', body_key='CHE', type_harmonized_id=None,
                       type_name={'de': 'Standesinitiative'}))
        self.assertEqual(r.jeton, 'initiative-cantonale')

    def test_geneve_prefixe_du_numero(self):
        r = self.c(aff('Motion pour les élèves handicapés', body_key='GE', number='M 2891',
                       type_harmonized_id=None, type_name={}))
        self.assertEqual(r.jeton, 'motion')
        self.assertEqual(r.verdict, 'retenu')

    def test_geneve_election_ecartee(self):
        r = self.c(aff('Élection au comité handicap', body_key='GE', number='E 1234',
                       type_harmonized_id=None, type_name={}))
        self.assertEqual(r.verdict, 'ecarte')

    def test_chaque_verdict_a_une_raison(self):
        for titre in ('Sonderpädagogik', 'Intégration', 'Strassen'):
            r = self.c(aff(titre))
            self.assertIn(r.verdict, classement.VERDICTS)
            self.assertTrue(r.raison)


if __name__ == '__main__':
    unittest.main()


class TestThemesElargis(unittest.TestCase):
    """Périmètre élargi (décision du 02.10.2026) : thématiques de la Revue, toujours « à relire »."""
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def aff(self, titre, **kw):
        d = dict(body_key='ZH', number='1', title=titre, type_name={'de': 'Motion'}, type_harmonized_id=2)
        d.update(kw)
        return d

    def c(self, titre, themes=True, **kw):
        return classement.classer(self.lex, self.aff(titre, **kw), '', candidat=False, themes_elargis=themes)

    def test_theme_sans_ancrage_est_a_relire_jamais_retenu(self):
        r = self.c('Stärkung der Medienkompetenz von Jugendlichen')
        self.assertEqual(r.verdict, 'a-relire')
        self.assertIn('thématique', r.raison)

    def test_theme_desactive_ecarte(self):
        self.assertEqual(self.c('Stärkung der Medienkompetenz von Jugendlichen', themes=False).verdict, 'ecarte')

    def test_ancrage_handicap_reste_retenu(self):
        self.assertEqual(self.c('Medienkompetenz für Menschen mit Behinderung').verdict, 'retenu')

    def test_sans_theme_ni_ancrage_ecarte(self):
        self.assertEqual(self.c('Strassenunterhalt Kantonsstrasse 12').verdict, 'ecarte')

    def test_fragestunde_ecartee_sans_ancrage_fort_meme_avec_theme(self):
        r = self.c('Mobbing an Schulen', type_harmonized_id=10, type_name={'de': 'Fragestunde'})
        self.assertEqual(r.verdict, 'ecarte')
        self.assertIn('type restreint', r.raison)

    def test_type_ecarte_reste_ecarte_meme_avec_theme(self):
        self.assertEqual(self.c('Wahl in die Kommission Kinderschutz', type_harmonized_id=6).verdict, 'ecarte')

    def test_les_themes_citent_leur_source(self):
        r = self.c('Prévention de la maltraitance des enfants')
        self.assertEqual(r.verdict, 'a-relire')
        self.assertTrue(r.details['themes'])
        self.assertTrue(all(t['sources'] for t in r.details['themes']))

    def test_ecole_ordinaire_avec_fragestunde_ecartee(self):
        r = classement.classer(self.lex, self.aff('Hausaufgaben an der Primarschule', type_harmonized_id=10,
                                                  type_name={'de': 'Fragestunde'}), '', candidat=False,
                               ecole_generale=True)
        self.assertEqual(r.verdict, 'ecarte')


class TestStructureThemes(unittest.TestCase):
    def test_chaque_theme_a_trois_langues_et_des_sources(self):
        lex = lexique.charger()
        self.assertGreaterEqual(len(lex.themes), 10)
        ids = [t.id for t in lex.themes]
        self.assertEqual(len(ids), len(set(ids)))
        for t in lex.themes:
            self.assertTrue(t.sources, t.id)
            self.assertEqual({x.langue for x in t.termes}, {'fr', 'de', 'it'}, t.id)
            self.assertTrue(t.libelle['fr'] and t.libelle['de'], t.id)


class TestThemeContreAbaissement(unittest.TestCase):
    def test_un_theme_prime_sur_le_terme_de_migration(self):
        lex = lexique.charger()
        a = dict(body_key='BS', number='1', title='Zentrum für Brückenangebote für Jugendliche und Integrationsagenda',
                 type_name={'de': 'Anzug'}, type_harmonized_id=3)
        self.assertEqual(classement.classer(lex, a, '', candidat=False).verdict, 'ecarte')
        r = classement.classer(lex, a, '', candidat=False, themes_elargis=True)
        self.assertEqual(r.verdict, 'a-relire')


class TestRegierungsgeschaeftAvecAncrage(unittest.TestCase):
    def test_un_ancrage_fort_dans_le_titre_garde_l_objet(self):
        lex = lexique.charger()
        a = dict(body_key='BS', number='1', title='Globalbudget Sonderschulen', type_harmonized_id=9,
                 type_name={'de': 'Globalbudget'})
        self.assertEqual(classement.classer(lex, a, '').verdict, 'retenu')
