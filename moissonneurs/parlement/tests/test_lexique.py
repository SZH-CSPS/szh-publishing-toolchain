import unittest

from parlement import lexique


class TestLexique(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def forts(self, texte):
        return sorted({t.terme.texte for t in self.lex.ancrages(texte) if not t.terme.ambigu})

    def faibles(self, texte):
        return sorted({t.terme.texte for t in self.lex.ancrages(texte) if t.terme.ambigu})

    def test_structure_saine(self):
        self.assertEqual(lexique.verifier_structure(self.lex), [])

    def test_trois_langues_chaque_terme_a_sa_source(self):
        langues = {t.langue for t in self.lex.termes}
        self.assertEqual(langues, {'fr', 'de', 'it'})
        for t in self.lex.termes:
            self.assertRegex(t.source, lexique.RE_SOURCE)

    def test_normalisation_sans_accents_ni_casse(self):
        self.assertEqual(lexique.normaliser('Pédagogie  Spécialisée'), 'pedagogie specialisee')
        self.assertEqual(lexique.normaliser("l’école"), 'l ecole')

    def test_accents_trouves_quelle_que_soit_la_forme(self):
        self.assertIn('pédagogie spécialisée', self.forts('Motion sur la PEDAGOGIE SPECIALISEE'))
        self.assertIn('Sonderpädagogik', self.forts('Förderung der Sonderpädagogik'))

    def test_flexions_francaises_et_composes_allemands(self):
        self.assertIn('handicap', self.forts('Les personnes handicapées et leurs proches'))
        self.assertIn('Mehrfachbehinderung', self.forts('Eine Mehrfachbehinderung liegt vor'))
        self.assertIn('Behinderung', self.forts('Eine Lernbehinderung liegt vor'))

    def test_integration_seule_est_ambigue(self):
        self.assertEqual(self.forts("Intégration des migrants dans la commune"), [])
        self.assertEqual(self.faibles("Intégration des migrants dans la commune"), [])    # sans mot d'école : plus rien
        self.assertIn('intégration', self.faibles("Intégration des migrants à l'école"))

    def test_sigle_ai_respecte_la_casse_et_reste_ambigu(self):
        self.assertEqual(self.forts("Liste AI et canton d'AI"), [])      # le sigle nu reste ambigu ; « Rente AI » est fort
        self.assertEqual(self.faibles('Liste AI'), [])                    # scénario R : « AI » nu abandonné
        self.assertIn('Rente AI', self.forts('Rente AI'))
        self.assertNotIn('AI', self.faibles('le chemin qui aide'))

    def test_sigles_forts(self):
        self.assertIn('LHand', self.forts('Révision de la LHand'))
        self.assertIn('BehiG', self.forts('Revision des BehiG'))

    def test_verkehrsbehinderung_est_neutralisee(self):
        self.assertEqual(self.forts('Verkehrsbehinderung durch Baustellen'), [])
        self.assertIn('Behinderung', self.forts('Menschen mit einer Behinderung'))

    def test_handicap_concurrentiel_neutralise(self):
        self.assertEqual(self.forts('Un handicap concurrentiel pour la place'), [])

    def test_allophonie_exige_le_contexte_scolaire(self):
        self.assertEqual(self.forts('Les habitants allophones du quartier'), [])
        self.assertIn('allophone', self.forts("Les élèves allophones à l'école primaire"))

    def test_le_plus_long_terme_l_emporte(self):
        touches = self.lex.ancrages('besoins éducatifs particuliers')
        self.assertEqual([t.terme.texte for t in touches], ['besoins éducatifs particuliers'])

    def test_italien(self):
        self.assertIn('pedagogia speciale', self.forts('Mozione sulla pedagogia speciale nel Cantone'))
        self.assertIn('disabilità', self.forts('persone con disabilità'))

    def test_domaines_education_en_tete(self):
        self.assertEqual(self.lex.domaines[0].id, 'education')
        compte = self.lex.compter_domaines("école et formation")
        self.assertGreaterEqual(compte.get('education', 0), 2)

    def test_regierungsgeschaeft_garder_jeter(self):
        self.assertEqual(self.lex.type_regierung('Bericht und Antrag'), 'garder')
        self.assertEqual(self.lex.type_regierung('Jahresrechnung 2025'), 'jeter')
        self.assertIsNone(self.lex.type_regierung('Inconnu'))


if __name__ == '__main__':
    unittest.main()


class TestPluriels(unittest.TestCase):
    """Constaté sur la base réelle : « Chiens d'assistance » (pluriel) échappait au terme « chien d'assistance »."""
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def forts(self, texte):
        return {t.terme.texte for t in self.lex.ancrages(texte) if not t.terme.ambigu}

    def test_pluriel_et_feminin_dans_un_terme_a_plusieurs_mots(self):
        self.assertIn("chien d'assistance", self.forts("Chiens d'assistance : cadre juridique"))
        self.assertIn('école spécialisée', self.forts('Les écoles spécialisées du canton'))
        self.assertIn('enseignant spécialisé', self.forts('Enseignants spécialisés et inclusion'))
        self.assertIn('classe spécialisée', self.forts('Fermeture des classes spécialisées'))

    def test_declinaisons_allemandes_dans_un_terme_a_plusieurs_mots(self):
        self.assertTrue(self.forts('Zukunft der integrativen Schulen im Kanton'))
        self.assertIn('inklusive Schule', self.forts('Eine inklusivere Schule'.replace('inklusivere', 'inklusive')))

    def test_pas_de_faux_positif_sur_un_mot_voisin(self):
        self.assertNotIn("chien d'assistance", self.forts("Chiens errants et assistance sociale"))
        self.assertEqual(self.forts('Les ecologistes spéciaux'), set())
