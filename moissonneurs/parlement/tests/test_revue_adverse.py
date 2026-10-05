"""Corrections de la revue adverse du 03.10.2026 (constats 1, 4, 5, 6, 8, 9, 10)."""
import unittest

from parlement import classement, criblage, lexique


def aff(titre, corps='ZH', numero='1', typ=2, tn=None, **kw):
    d = dict(body_key=corps, number=numero, title=titre, type_name=tn if tn is not None else {'de': 'Motion'},
             type_harmonized_id=typ)
    d.update(kw)
    return d


class Base(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def c(self, titre, texte='', eg=False, th=False, **kw):
        return classement.classer(self.lex, aff(titre, **kw), texte, candidat=False, ecole_generale=eg,
                                  themes_elargis=th)

    def forts(self, texte):
        return {t.terme.texte for t in self.lex.ancrages(texte) if not t.terme.ambigu}

    def faibles(self, texte):
        return {t.terme.texte for t in self.lex.ancrages(texte) if t.terme.ambigu}


class TestRechercheServeur(Base):
    VINGT = [('mesure renforcée', 'fr'), ('mesures renforcées', 'fr'), ('verstärkte Massnahmen', 'de'),
             ('classe spécialisée', 'fr'), ('Schulen für alle', 'de'), ("classe d'accueil", 'fr'),
             ('unterstützte Kommunikation', 'de'), ('inklusive Schule', 'de'), ('haut potentiel', 'fr'),
             ('aménagement raisonnable', 'fr'), ('intégration scolaire', 'fr'), ('inklusiven Schule', 'de'),
             ('aménagements raisonnables', 'fr'), ('Leichte Sprache', 'de'), ('schulische Integration', 'de'),
             ('assistenza personale', 'it'), ('integrazione professionale', 'it'), ('hauts potentiels', 'fr'),
             ('assistance personnelle', 'fr'), ('lingua seconda', 'it')]

    def test_les_vingt_termes_a_phrase_absente_ne_partent_plus_au_serveur(self):
        envoyes = set(criblage.termes_de_recherche(self.lex))
        for t in self.VINGT:
            self.assertNotIn(t, envoyes, t)

    def test_ils_restent_dans_le_lexique_local(self):
        self.assertIn('mesure renforcée', self.forts('Une mesure renforcée pour un élève'))
        self.assertIn('Leichte Sprache', self.forts('Dokumente in Leichter Sprache'.replace('Leichter', 'Leichte')))

    def test_les_termes_precis_restent_cribles(self):
        envoyes = set(criblage.termes_de_recherche(self.lex))
        for t in (('handicap', 'fr'), ('Behinderung', 'de'), ('école spécialisée', 'fr'), ('Sonderpädagogik', 'de')):
            self.assertIn(t, envoyes, t)


class TestSiglesAmbigusAuTitreSeulement(Base):
    def test_iv_et_ai_ne_comptent_plus_dans_le_texte(self):
        texte = 'Teil IV. Section IV. Annexe IV. Chapitre IV. Livre IV. ' * 10 + 'canton d\'AI, liste AI AI AI AI'
        r = self.c('Verkehrsplanung', texte)
        self.assertEqual(r.verdict, 'ecarte')

    def test_droits_politiques_et_inklusiv_ne_comptent_plus_dans_le_texte(self):
        for texte in ('loi sur les droits politiques ' * 8, 'politische Rechte ' * 8, 'diritti politici ' * 8,
                      'Rosenbergtunnel inklusive Zubringer ' * 8):
            self.assertEqual(self.c('Verkehrsplanung', texte).verdict, 'ecarte', texte[:30])

    def test_ils_sont_abandonnes_meme_dans_le_titre(self):          # scénario R : droits politiques, IV et AI nus
        self.assertEqual(self.c('Rapport sur les droits politiques').verdict, 'ecarte')
        self.assertEqual(self.c('Teil IV der Vorlage').verdict, 'ecarte')

    def test_formes_non_ambigues_retiennent(self):
        for titre in ("Rentes AI : assurance qualité des expertises", "Qualité des expertises médicales dans l'AI",
                      'IV-Stelle Aargau: Abklärungen', 'Anpassung der IV-Renten', "Réforme de l'intégration de l'AI",
                      "Revisione dell'AI e rendite AI", 'IV-Gutachten: Qualität'):
            self.assertEqual(self.c(titre).verdict, 'retenu', titre)

    def test_le_chiffre_romain_et_le_canton_ne_retiennent_pas(self):
        self.assertNotEqual(self.c('Section IV de la CJUS').verdict, 'retenu')
        self.assertNotEqual(self.c("Liste des cantons : AI, AR, BE").verdict, 'retenu')


class TestArriere(Base):
    def test_initiative_federale_historique_vis_est_ecartee_avec_sa_raison(self):
        r = self.c('Pour une meilleure protection des personnes handicapées', corps='CHE', numero='VIS 12 a')
        self.assertEqual(r.verdict, 'ecarte')
        self.assertIn('arriéré', r.raison)
        self.assertIn('VIS', r.raison)

    def test_numero_bernois_d_avant_2024_est_ecarte(self):
        r = self.c('Behinderung im Kanton Bern', corps='BE', numero='2013.RRGR.431')
        self.assertEqual(r.verdict, 'ecarte')
        self.assertIn('bernois', r.raison)

    def test_numeros_recents_ou_autres_corps_passent(self):
        self.assertEqual(self.c('Behinderung im Kanton Bern', corps='BE', numero='2025.GRPARL.212').verdict, 'retenu')
        self.assertEqual(self.c('Behinderung im Kanton Bern', corps='BE', numero='2024.GRPARL.12').verdict, 'retenu')
        self.assertEqual(self.c('Behinderung', corps='ZH', numero='2013.RRGR.431').verdict, 'retenu')
        self.assertEqual(self.c('Behinderung', corps='CHE', numero='26.4169').verdict, 'retenu')
        self.assertEqual(self.c('Behinderung', corps='BE', numero='24.GSI.709').verdict, 'retenu')


class TestRegierungsgeschaeft(Base):
    def test_jeter_sans_ancrage_fort_reste_ecarte(self):
        a = dict(tn={'de': 'Jahresrechnung'}, typ=9)
        self.assertEqual(self.c('Globalbudget der Verwaltung', **a).verdict, 'ecarte')

    def test_jeter_n_ecarte_plus_un_titre_a_ancrage_fort(self):
        a = dict(tn={'de': 'Geschäftsbericht'}, typ=9)
        r = self.c('Raumbedürfnisse des Heilpädagogischen Schulzentrums Olten', **a)
        self.assertEqual(r.verdict, 'retenu')


class TestNeutralisations(Base):
    def test_haute_ecole_specialisee(self):
        for t in ('Haute école spécialisée de Suisse occidentale', 'Les hautes écoles spécialisées du canton',
                  'Haute école spécialisée de Suisse'):
            self.assertEqual(self.forts(t), set(), t)
        self.assertIn('école spécialisée', self.forts('Une école spécialisée pour enfants'))

    def test_behindern_verbal(self):
        for t in ('Behindert SBB Cargo den Wettbewerb?', 'Das Bauvorhaben behindert den Verkehr',
                  'Hindernisse, die den Zugang behindern', 'Bäume behindern die Sicht'):
            self.assertEqual(self.forts(t), set(), t)
        self.assertIn('behindert', self.forts('Menschen mit einer geistigen Behinderung, behinderte Kinder'))

    def test_baurekurskommission(self):
        self.assertEqual(self.c('Entscheid der Baurekurskommission Basel-Landschaft').verdict, 'ecarte')

    def test_integrazione_professionale_devient_ambigue(self):
        self.assertEqual(self.forts("Integrazione professionale dei richiedenti l'asilo"), set())
        self.assertIn('integrazione professionale', self.faibles("Integrazione professionale dei rifugiati"))


class TestTermesAuTitre(Base):
    def test_termes_ajoutes_au_titre(self):
        titres = ['Abklärungen bei Verhaltens- und Entwicklungsauffälligkeiten von Kindern',
                  'Abklärungen im Rahmen von pädagogischen Massnahmen', 'Zentrum für Frühförderung Sanierung',
                  'Schul- und Förderzentrum Riehen', 'Auswirkungen auf beeinträchtigte und ältere Menschen',
                  'Accès pour les personnes à mobilité réduite', 'Des PMR laissé au bord de la route !',
                  'Pour des trains CFF inclusifs et accessibles', 'registro cantonale delle curatele private',
                  'Unterstützung für Angehörige psychisch erkrankter Personen', 'Enfants placés : qu\'en est-il ?',
                  'Kinderspitex-Unterversorgung', 'kinder- und jugendpsychiatrische Versorgung',
                  'Angebote mit Förder- und Schutzbedarf']
        for t in titres:
            self.assertTrue(self.lex.ancrages(t), t)
            self.assertNotEqual(self.c(t).verdict, 'ecarte', t)

    def test_ils_ne_comptent_pas_dans_le_texte_ni_au_serveur(self):
        self.assertEqual(self.c('Verkehrsplanung', 'Frühförderung PMR mobilité réduite Förderzentrum ' * 20).verdict,
                         'ecarte')
        envoyes = {t for t, _ in criblage.termes_de_recherche(self.lex)}
        for t in ('Frühförderung', 'Förderzentrum', 'mobilité réduite', 'Kinderspitex'):
            self.assertNotIn(t, envoyes)

    def test_pas_de_faux_positif_evident(self):
        for t in ('Tempo 30 auf der Hauptstrasse', 'Le PMU de la ville', 'Förderung der Landwirtschaft'):
            self.assertEqual(self.c(t).verdict, 'ecarte', t)


class TestFlexionItalienne(Base):
    def test_pluriels_en_a_o_e(self):
        cas = {'scuole speciali': 'scuola speciale', 'classi speciali': 'classe speciale',
               'scuole inclusive': 'scuola inclusiva', 'lingue dei segni': 'lingua dei segni',
               'sedie a rotelle': 'sedia a rotelle', 'cani di assistenza': 'cane di assistenza',
               'impianti cocleari': 'impianto cocleare', 'malattie rare': 'malattia rara'}
        for pluriel, singulier in cas.items():
            self.assertTrue(self.lex.ancrages(f'Per le {pluriel} del Cantone'), pluriel)
            self.assertTrue(self.lex.ancrages(f'Per la {singulier} del Cantone'), singulier)

    def test_le_francais_et_l_allemand_ne_sont_pas_touches(self):
        self.assertEqual(self.forts('Les écoles spéciali'), set())
        self.assertEqual(self.forts('Lingua dei segnix'), self.forts('Lingua dei segnix'))

    def test_pas_de_faux_positif_sur_un_mot_voisin(self):
        self.assertEqual(self.forts('Scuole speciose'), set())


class TestPalierEcole(Base):
    def test_francais(self):
        for t in ('Taille des classes dans le canton', 'Statut enseignant : révision', "Scolarité obligatoire prolongée",
                  "Interdiction du téléphone portable à l'école primaire"):
            self.assertEqual(self.c(t, eg=True).verdict, 'a-relire', t)
            self.assertEqual(self.c(t, eg=False).verdict, 'ecarte', t)

    def test_italien(self):
        for t in ('Direttive per la scuola media', "Scuola dell'obbligo : riforma", 'Dimensione delle classi',
                  'Scuola elementare e scuola pubblica'):
            self.assertEqual(self.c(t, eg=True).verdict, 'a-relire', t)

    def test_ecolo_n_est_pas_ecole(self):
        self.assertEqual(self.c('Ecologie et énergie', eg=True).verdict, 'ecarte')


if __name__ == '__main__':
    unittest.main()
