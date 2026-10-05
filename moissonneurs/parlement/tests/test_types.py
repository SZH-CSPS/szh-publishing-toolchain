"""Rapport des catégories (03.10.2026) : types restreints à l'ancrage fort au titre, préfixes LU et VD, « Vorlage » de BL."""
import unittest

from parlement import classement, correspondances as corr, lexique


class TestPrefixesLuVd(unittest.TestCase):
    def test_lucerne_lit_le_type_dans_la_lettre_du_numero_quand_l_api_ne_le_donne_pas(self):
        for numero, jeton, harm in (('2026A 835', 'question', 12), ('2024P 328', 'postulat', 3), ('2025M 12', 'motion', 2),
                                    ('2026E 4', 'initiative-parlementaire', 4)):
            t = corr.type_effectif('LU', numero, {}, None)
            self.assertEqual((t['jeton'], t.get('harm'), t['origine']), (jeton, harm, 'prefixe-lu'), numero)
        b = corr.type_effectif('LU', '2025B 7', {}, None)
        self.assertEqual((b['jeton'], b['a_confirmer'], b.get('harm')), ('objet-gouvernement', True, None))

    def test_lucerne_le_type_harmonise_de_l_api_prime(self):
        t = corr.type_effectif('LU', '2026A 835', {'de': 'Anfrage'}, 12)
        self.assertEqual(t['origine'], 'harmonise')

    def test_vaud_lit_le_type_dans_le_numero(self):
        self.assertEqual(corr.type_effectif('VD', '25_PET_3', {}, None)['jeton'], 'petition')
        leg = corr.type_effectif('VD', '25_LEG_9', {}, None)
        self.assertEqual((leg['jeton'], leg['a_confirmer']), ('objet-gouvernement', True))
        det = corr.type_effectif('VD', '25_DET_6', {}, None)
        self.assertEqual((det['jeton'], det['libelle']), (None, 'Détermination'))
        self.assertEqual(corr.type_effectif('VD', '25_GRA_1', {}, None)['ecarte'], 'grâce')
        self.assertEqual(corr.type_effectif('VD', '25_INT_22', {'fr': 'Interpellation'}, 8)['origine'], 'harmonise')

    def test_autres_corps_inchanges(self):
        self.assertEqual(corr.type_effectif('ZH', '2026A 835', {}, None)['origine'], 'inconnu')


class TestVorlageBl(unittest.TestCase):
    def test_le_type_de_la_vorlage_se_lit_dans_le_document(self):
        txt = 'Parlamentarischer Vorstoss 2024/517 \n\n \nGeschäftstyp: Interpellation \n\nTitel: Digitale Lehrmittel\n'
        self.assertEqual(corr.type_corrige('BL', 9, txt), (8, {'de': 'Interpellation'}))
        self.assertEqual(corr.type_corrige('BL', '9', txt.replace('Interpellation', 'Postulat'))[0], 3)
        self.assertEqual(corr.type_corrige('BL', 9, txt.replace('Interpellation', 'Motion'))[0], 2)

    def test_sans_document_ou_hors_vorlage_rien_ne_change(self):
        txt = 'Geschäftstyp: Interpellation'
        self.assertIsNone(corr.type_corrige('BL', 9, ''))
        self.assertIsNone(corr.type_corrige('BL', 8, txt))
        self.assertIsNone(corr.type_corrige('ZH', 9, txt))
        self.assertIsNone(corr.type_corrige('BL', 9, 'Geschäftstyp: Teilrevision'))


class TestTypesRestreints(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def verdict(self, titre, harm=None, tn=None, corps='ZH', number='1', texte=''):
        a = dict(body_key=corps, number=number, title=titre, type_name=tn or {}, type_harmonized_id=harm)
        return classement.classer(self.lex, a, texte, candidat=True, ecole_generale=True, themes_elargis=True)

    def test_les_types_restreints_ne_gardent_que_l_ancrage_fort_au_titre(self):
        for harm in (4, 5, 7, 10, 15, 16):
            r = self.verdict('Revision der Volksschule', harm=harm)         # école ordinaire : écarté
            self.assertEqual(r.verdict, 'ecarte', harm)
            self.assertIn('type restreint', r.raison)
            fort = self.verdict('Sonderschulung für Kinder mit Behinderung', harm=harm)
            self.assertIn(fort.verdict, ('retenu', 'a-relire'), harm)

    def test_un_texte_dense_ne_sauve_pas_un_type_restreint(self):
        texte = 'Die Behinderung von Kindern. ' * 10
        self.assertEqual(self.verdict('Bericht zum Jahr', harm=16, texte=texte).verdict, 'ecarte')
        self.assertEqual(self.verdict('Bericht zum Jahr', harm=8, texte=texte).verdict, 'retenu')

    def test_geneve_pl_rd_in_r_et_standesinitiative(self):
        for pref in ('PL', 'RD', 'IN', 'R'):
            r = self.verdict('Statut enseignant : modification de la loi', corps='GE', number=f'{pref} 13562')
            self.assertEqual(r.verdict, 'ecarte', pref)
        self.assertEqual(self.verdict('Statut enseignant : révision', corps='GE', number='QUE 2268').verdict, 'a-relire')
        r = self.verdict('Standesinitiative zur Volksschule', tn={'de': 'Standesinitiative'})
        self.assertEqual(r.verdict, 'ecarte')

    def test_messages_gouvernementaux_sans_type_harmonise_ecartes_sauf_ancrage_fort(self):
        tn = {'it': 'Messaggio'}
        self.assertEqual(self.verdict('Messaggio sulla scuola media', corps='TI', tn=tn).verdict, 'ecarte')
        fort = self.verdict('Messaggio sul sostegno alle persone con disabilità', corps='TI', tn=tn)
        self.assertIn(fort.verdict, ('retenu', 'a-relire'))

    def test_les_types_gardes_ne_changent_pas(self):
        for harm in (8, 12, 2, 3, 11):
            self.assertEqual(self.verdict('Revision der Volksschule', harm=harm).verdict, 'a-relire', harm)
        # Regierungsgeschäft « garder » (Vorlage) : inchangé
        r = self.verdict('Revision der Volksschule', harm=9, tn={'de': 'Vorlage'})
        self.assertEqual(r.verdict, 'a-relire')


if __name__ == '__main__':
    unittest.main()
