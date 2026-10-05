"""Scénario R du rapport des mots-clés (03.10.2026) : blocs d'abandon, restrictions et ajouts."""
import unittest

from parlement import classement, lexique


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def c(self, titre, texte='', extrait=False, eg=True, th=True, **kw):
        a = dict(body_key='ZH', number='1', title=titre, type_name={'de': 'Motion'}, type_harmonized_id=2)
        a.update(kw)
        return classement.classer(self.lex, a, texte, candidat=True, ecole_generale=eg, themes_elargis=th, extrait=extrait)

    def propose(self, titre, **kw):
        return self.c(titre, **kw).verdict in ('retenu', 'a-relire')


class TestEcoleGenerique(Base):
    def test_les_mots_generiques_ne_proposent_plus(self):
        for t in ("École de commerce de La Neuveville", 'Vacances scolaires hivernales', 'Les élèves à haut débit',
                  'Nomine al DECS : scuola e scuole', "Un docente e gli insegnanti", 'Lernende : Mindestlohn', 'Die Schule im Dorf',
                  'Gli allievi e le scuole', 'Ecole de police de Hitzkirch'):
            self.assertFalse(self.propose(t), t)

    def test_schulen_est_garde_et_les_mots_de_l_ecole_obligatoire_aussi(self):
        for t in ('Rückzugsorte für Lernende an öffentlichen Schulen', 'Neue Schulen im Kanton', 'Volksschule 2030',
                  'Ressourcen im Kindergarten', 'Lehrmittel für die Primarschule', 'Hausaufgaben und Unterricht'):
            self.assertTrue(self.propose(t), t)


class TestThemesAbandonnes(Base):
    def test_les_themes_non_ne_proposent_plus_meme_avec_un_mot_d_enfance(self):
        for t in ('Förderung der Berufsbildung für Jugendliche', 'Kinderbetreuung im Kanton', 'Kita-Tarife für Kinder',
                  'Pädagogische Hochschule Luzern', 'Jugendschutz und Alkohol bei Kindern', 'Gleichstellung der Kinder',
                  'Sozialhilfe für Familien mit Kindern', 'Les crèches et les enfants', "Droits de l'enfant",
                  'Formation professionnelle des jeunes', 'Fachkräftemangel bei Lehrpersonen'):
            r = self.c(t, eg=False)
            self.assertEqual(r.verdict, 'ecarte', t)

    def test_les_themes_gardes_restent(self):
        for t in ('Mobbing an Schulen', 'Santé psychique des enfants', 'Schulsozialarbeit', 'Resilienz bei Schülerinnen'):
            self.assertTrue(self.propose(t, eg=False), t)

    def test_eleve_n_est_plus_un_mot_de_contexte(self):
        self.assertFalse(self.propose('Violence domestique : coût élevé', eg=False))




class TestAmbigusAbandonnes(Base):
    def test_droits_politiques_autodetermination_siglés_et_faux_sens_ne_proposent_plus(self):
        for t in ('Stimmrechtsalter 16', 'Loi sur les droits politiques', 'Gesetz über die politischen Rechte (GPR)',
                  'Diritto di voto per gli stranieri', 'Diritti politici : revisione', 'Selbstbestimmung am Lebensende',
                  "Autodétermination des cantons", 'Handlungsfähigkeit der Kantonsregierung', 'Wahl in die KESB : Erwachsenenschutz',
                  "Protection de l'adulte : budget", 'IV. Nachtrag zum Personalgesetz', 'EU AI Act und Cloud AI Development Act',
                  'Inklusiv geplanter Tunnel', "Invalidation de l'initiative", 'Hat die Armee Invalide?', 'Ein blinder Fleck der OST',
                  'Blinde Flecken', 'Hindernisfreie Gestaltung des Bahnhofs', 'Zugänglichkeit zu e.Tax', 'Hilfsmittel für Suizid',
                  "Accessibilità del quartiere"):
            self.assertFalse(self.propose(t, eg=False, th=False), t)

    def test_les_voisins_gardes_restent(self):
        for t in ('Barrierefreiheit im Spital', 'Beistandschaft für Kinder', 'Urteilsfähigkeit von Minderjährigen'):
            self.assertTrue(self.propose(t, eg=False, th=False), t)


class TestFamilleHandicapHorsExtrait(Base):
    def test_hors_extrait_la_famille_ai_ne_compte_pas(self):
        for t in ('Die Mehrwertsteuer und die Invalidenversicherung belasten die Kassen.',
                  'Robotern wird die Behinderung des Lieferverkehrs zugeschrieben.', 'Eine IV-Rente und die IV-Stelle.',
                  'invalidité et berufliche Eingliederung, ADHS, Rollstuhl, Geburtsgebrechen, Hilflosenentschädigung',
                  'Verhaltensauffälligkeit und kognitive Beeinträchtigung, Invalidenrente, Invalidität, der IV, zur IV'):
            r = self.c('Rapport annuel', texte=t, extrait=True)
            self.assertEqual(r.verdict, 'ecarte', t)

    def test_les_autres_ancrages_restent_dans_l_extrait(self):
        r = self.c('Rapport annuel', texte='Sonderschulung und Nachteilsausgleich pour Autismus.', extrait=True)
        self.assertEqual(r.verdict, 'a-relire')

    def test_au_titre_et_en_texte_dense_la_famille_compte_toujours(self):
        self.assertEqual(self.c('Entlastung für Menschen mit Behinderung', eg=False).verdict, 'retenu')
        self.assertEqual(self.c('Bericht zum Jahr', texte='Die Invalidenversicherung zahlt. ' * 8).verdict, 'retenu')


class TestSeulementAvecUnMotDEcole(Base):
    def test_integration_inklusion_foerderbedarf_sans_mot_d_ecole_ne_proposent_plus(self):
        for t in ('Integration der Photovoltaik in Gebäude', 'Inklusion im öffentlichen Verkehr', 'Förderbedarf im Strommarkt',
                  'Integrazione dei rifugiati ucraini', "L'inclusion des personnes sur le marché", 'Integrative Medizin',
                  "Les EPI : intégration des états financiers", 'Inclusione nel mondo del lavoro'):
            self.assertFalse(self.propose(t, eg=False, th=False), t)

    def test_avec_un_mot_d_ecole_ils_proposent(self):
        for t in ('Integration an der Schule', 'Inklusion in Volksschulen', 'Förderbedarf im Unterricht',
                  "Inclusion à l'école", 'Integrazione nella scuola', 'Integrative Schule: Kosten'):
            self.assertTrue(self.propose(t, eg=False, th=False), t)


class TestFauxSensForts(Base):
    def test_verstaerkte_massnahmen_ivg_et_brk_nus_abandonnes(self):
        for t in ('Verstärkte Massnahmen gegen die organisierte Kriminalität', 'IVG gratuite : pourquoi cette décision ?',
                  'Baurekurskommission (BRK) Basel-Landschaft'):
            self.assertFalse(self.propose(t, eg=False, th=False), t)

    def test_un_brk_et_la_convention_restent(self):
        self.assertTrue(self.propose('Umsetzung der UN-BRK im Kanton', eg=False, th=False))
        self.assertTrue(self.propose('Behindertenrechtskonvention : Stand', eg=False, th=False))


class TestAjoutsValides(Base):
    def test_institutions_specialisees_ne_dependent_plus_du_mot_ecoles(self):
        for t in ("Listes d'attente dans les écoles et institutions spécialisées", 'Sonderpädagogische Institutionen im Kanton',
                  'Lunghe liste di attesa nelle istituzioni specializzate'):
            self.assertTrue(self.propose(t, eg=False, th=False), t)

    def test_le_contexte_formation_est_un_mot_entier(self):
        self.assertFalse(self.propose('Violence domestique et transformation numérique', eg=False))
        self.assertTrue(self.propose('Violence domestique dans la formation', eg=False))

    def test_entschuldigung_et_schulden_ne_sont_pas_un_contexte_d_ecole(self):
        self.assertFalse(self.propose('Häusliche Gewalt : Entschuldigung', eg=False))
        self.assertFalse(self.propose('Häusliche Gewalt und Schuldenprävention', eg=False))
        self.assertTrue(self.propose('Häusliche Gewalt an der Berufsschule', eg=False))
        self.assertTrue(self.propose('Häusliche Gewalt in Volksschulen', eg=False))

    def test_exclusion_du_droit_de_vote_et_curatelle_generale_sont_des_ancrages_forts(self):
        for t in ('Aufhebung Stimmrechtsausschluss', 'Suppression de la curatelle de portée générale',
                  'Abschaffung der umfassenden Beistandschaft', "Esclusione dal diritto di voto"):
            r = self.c(t, eg=False, th=False)
            self.assertIn(r.verdict, ('retenu', 'a-relire'), t)


class TestDecisionPlafond(Base):
    """Décision du 03.10.2026 : « Zentrum für Brückenangebote » sans contexte et « permis » qui n'abaisse plus.
    Deux fiches de référence (BS 24.5517, GE 25.2194) ont servi à écrire le vocabulaire : le gain est un défaut de règle réparé."""
    def test_zentrum_fuer_brueckenangebote_est_un_theme_sans_mot_d_enfance(self):
        r = self.c('Das Zentrum für Brückenangebote (ZBA)', eg=False)
        self.assertEqual(r.verdict, 'a-relire')
        self.assertIn('thématique', r.raison)

    def test_les_autres_themes_gardent_leur_contexte(self):
        self.assertFalse(self.propose('Berufswahl im Kanton', eg=False))

    def test_permis_n_abaisse_plus_une_affaire_d_ecole(self):
        r = self.c("Quelle école voulons-nous ? Le statut enseignant", texte='Le permis de construire des bâtiments. ' * 3)
        self.assertEqual(r.verdict, 'a-relire')
        self.assertNotIn('permis', r.details['abaisse'])

    def test_les_autres_termes_de_migration_abaissent_toujours(self):
        r = self.c("Cours d'intégration à l'école", eg=True)
        self.assertEqual(r.verdict, 'ecarte')


if __name__ == '__main__':
    unittest.main()
