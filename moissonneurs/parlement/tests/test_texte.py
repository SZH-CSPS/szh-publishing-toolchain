"""Champ `texte_depose` : le document déposé, nettoyé (ni balisage, ni CSS, ni signataire en tête) et plafonné.
Noms et textes fictifs."""
import unittest

from parlement import texte as tx

CORPS = ('Der Regierungsrat wird beauftragt, die integrative Schule zu stärken. Kinder mit Behinderung brauchen '
         'Unterstützung im Unterricht und eine verlässliche Förderung. ')


def d(texte, nom='Vorstoss-de', langue='de'):
    return {'nom': nom, 'langue': langue, 'texte': texte}


class TestNettoyage(unittest.TestCase):
    def test_sans_balisage_ni_css_ni_entites(self):
        brut = ('<html><style>p { color: red; }</style><script>x()</script><p>Der&nbsp;Bericht&nbsp;:'
                ' <b>wichtig</b></p>[image: Logo]<div>Zweiter Absatz.</div>')
        t = tx.nettoyer(brut)
        for interdit in ('<', '>', 'color', '&nbsp;', 'x()', '[image', ' '):
            self.assertNotIn(interdit, t)
        self.assertIn('Der Bericht : wichtig', t)
        self.assertIn('Zweiter Absatz.', t)

    def test_ligne_coupee_recollee_et_pied_de_page_retire(self):
        t = tx.nettoyer('Die Schule braucht eine Lö-\n\nsung und mehr\nZeit,\n\nwie gefordert.\n\nSeite 2/5\n\n')
        self.assertEqual(t, 'Die Schule braucht eine Lösung und mehr\n\nZeit, wie gefordert.')

    def test_extraction_echouee_rend_vide(self):
        self.assertEqual(tx.texte_depose([d('[extraction_failed]')], 'BE'), '')


class TestEntete(unittest.TestCase):
    def test_signataire_et_adresse_en_tete_retires(self):
        brut = ('Erika Muster\n\nLandrätin\n\nMusterweg 1\n\n9999 Musterdorf\n\n'
                'Interpellation: Psychische Gesundheit an Schulen\n\n' + CORPS)
        t = tx.texte_depose([d(brut)], 'UR', 'Psychische Gesundheit an Schulen')
        self.assertTrue(t.startswith('Der Regierungsrat wird beauftragt'), t[:80])
        for nom in ('Erika', 'Muster', 'Musterweg'):
            self.assertNotIn(nom, t)

    def test_signataires_au_debut_du_corps_retires(self):
        brut = ('Hans Beispiel und Anna Muster namens der Fraktion vom 20. März 2026\n\n'
                'Eingereicht von: Hans Beispiel, Anna Muster\n\n' + CORPS)
        t = tx.texte_depose([d(brut)], 'LU', 'Integrative Schule stärken')
        self.assertNotIn('Beispiel', t)
        self.assertTrue(t.startswith('Der Regierungsrat'))

    def test_texte_sans_entete_intact(self):
        self.assertEqual(tx.texte_depose([d(CORPS)], 'CHE'), CORPS.strip())


class TestChoix(unittest.TestCase):
    def test_le_texte_depose_pas_la_reponse(self):
        docs = [d('Antwort des Regierungsrates. ' * 10, nom='Antwort der Regierung'), d(CORPS, nom='Motionstext')]
        self.assertEqual(tx.texte_depose(docs, 'AG'), CORPS.strip())

    def test_confederation_deux_documents_chacun_sous_son_nom(self):
        docs = [d('Réponse du Conseil fédéral. ' * 10, nom='Réponse CF / Bureau'),
                d('Le Conseil fédéral est chargé de renforcer la formation spécialisée des enseignants.', nom='Texte déposé'),
                d('Les écoles manquent de personnel formé pour accueillir chaque élève.', nom='Développement')]
        t = tx.texte_depose(docs, 'CHE')
        self.assertEqual(t, '[Document : Texte déposé]\nLe Conseil fédéral est chargé de renforcer la formation '
                            'spécialisée des enseignants.\n\n[Document : Développement]\nLes écoles manquent de '
                            'personnel formé pour accueillir chaque élève.')
        self.assertNotIn('Réponse', t)


class TestPlafond(unittest.TestCase):
    def test_plafond_a_vingt_mille_coupe_en_fin_de_phrase(self):
        self.assertEqual(tx.PLAFOND, 20000)
        long = CORPS * 300
        t = tx.texte_depose([d(long)], 'ZH')
        self.assertLessEqual(len(t), tx.PLAFOND)
        self.assertTrue(t.endswith('. […]'), t[-30:])
        self.assertEqual(tx.texte_depose([d(CORPS)], 'ZH'), CORPS.strip())


if __name__ == '__main__':
    unittest.main()
