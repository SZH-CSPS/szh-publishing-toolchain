"""« behindert » verbal (entraver) neutralisé, « behindert » adjectif du champ conservé (arbitrage 1c du 03.10.2026)."""
import unittest

from parlement import classement, lexique


class TestBehindern(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def verdict(self, titre, texte='', extrait=False):
        a = dict(body_key='ZH', number='1', title=titre, type_name={'de': 'Motion'}, type_harmonized_id=2)
        return classement.classer(self.lex, a, texte, candidat=True, extrait=extrait).verdict

    def ancres(self, texte):
        return [t.terme.texte for t in self.lex.ancrages(texte)]

    def test_usage_verbal_dans_des_titres_reels_est_neutralise(self):
        for t in ('Behindert SBB Cargo den Wettbewerb?', 'Warum werden in der Schweiz Balkonkraftwerke behindert?',
                  'Die Biodiversitätsförderung in Liechtenstein wird offenbar durch Verträge behindert',
                  'Wird der Wettbewerb behindert?', 'Der Bund hat den Ausbau behindert'):
            self.assertEqual(self.verdict(t), 'ecarte', t)

    def test_usage_verbal_dans_un_extrait_est_neutralise(self):
        for t in ('Die Bautätigkeit wird behindert und verteuert.', 'Investitionen werden massiv behindert werden.',
                  'Das Mieterschutz behindert zudem die Sanierung.', 'Sie wollen nicht behindert.', 'Das Gesetz behinderte den Handel.'):
            self.assertEqual(self.ancres(t), [], t)

    def test_adjectif_et_noms_du_champ_restent_ancres(self):
        for t in ('Entlastung für Familien mit behinderten Kindern', 'Kinder mit Behinderung in der Volksschule',
                  'Behindertengleichstellung im öffentlichen Verkehr', 'Bessere Schule für behinderte Kinder',
                  'Parkkarte für gehbehinderte Personen', 'Kinder, die behindert sind', 'Das Kind ist behindert.', 'Wer ist behindert und braucht Hilfe?'):
            self.assertEqual(self.verdict(t), 'retenu', t)


if __name__ == '__main__':
    unittest.main()
