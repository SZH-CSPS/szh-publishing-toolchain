"""Arbitrage du 03.10.2026 (superviseur 1c, scénario « 47 à relire par mois ») : texte absent, texte fort seul, thèmes."""
import unittest

from parlement import classement, lexique
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base


def aff(titre, **kw):
    d = dict(body_key='ZH', number='1', title=titre, type_name={'de': 'Motion'}, type_harmonized_id=2)
    d.update(kw)
    return d


class Fond(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def c(self, titre, texte='', candidat=True, extrait=False, eg=True, th=True):
        return classement.classer(self.lex, aff(titre), texte, candidat=candidat, ecole_generale=eg,
                                  themes_elargis=th, extrait=extrait)


class TestTexteAbsent(Fond):
    def test_candidat_sans_texte_ni_extrait_est_ecarte(self):
        r = self.c('Rapport annuel', texte='')
        self.assertEqual(r.verdict, 'ecarte')

    def test_extrait_de_recherche_avec_ancrage_fort_est_a_relire_jamais_retenu(self):
        extrait = 'Eidgenössische Volksinitiative für die Sonderschulung und den Nachteilsausgleich bei Autismus ' * 8
        r = self.c('Rapport annuel', texte=extrait, extrait=True)
        self.assertEqual(r.verdict, 'a-relire')
        self.assertIn('extrait', r.raison)

    def test_extrait_sans_ancrage_est_ecarte(self):
        r = self.c('Rapport annuel', texte='Der Strassenbelag wird erneuert. Voranschlag 2025.', extrait=True)
        self.assertEqual(r.verdict, 'ecarte')

    def test_extrait_avec_ancrage_ambigu_seulement_est_ecarte(self):
        r = self.c('Rapport annuel', texte='Liste AI, AR, BE. Teil IV. droits politiques ' * 5, extrait=True)
        self.assertEqual(r.verdict, 'ecarte')


class TestTexteFortSeul(Fond):
    def test_un_ancrage_fort_dans_le_texte_sans_densite_ne_propose_plus(self):
        texte = 'Verkehr und Strassen. ' * 2000 + ' Menschen mit Behinderung. Sonderschule.'
        self.assertEqual(self.c('Verkehrsplanung', texte=texte).verdict, 'ecarte')

    def test_un_texte_dense_retient_toujours(self):
        texte = 'Die Behinderung von Kindern. ' * 8
        r = self.c('Bericht zum Jahr', texte=texte)
        self.assertEqual(r.verdict, 'retenu')

    def test_ancrage_ambigu_repete_dans_le_texte_ne_propose_plus(self):
        self.assertEqual(self.c('Verkehrsplanung', texte='Integration der Systeme. ' * 20).verdict, 'ecarte')


class TestThemeSousContexte(Fond):
    def test_theme_sans_mot_d_enfance_ou_d_ecole_est_ecarte(self):
        for t in ('Stärkung der Medienkompetenz im Allgemeinen', 'Häusliche Gewalt: Massnahmen', 'Violence domestique : bilan',
                  'Salute mentale: servizi'):
            self.assertEqual(self.c(t).verdict, 'ecarte', t)

    def test_theme_avec_mot_d_enfance_ou_d_ecole_est_a_relire(self):
        for t in ('Medienkompetenz von Jugendlichen', 'Mobbing an Schulen', 'Violence domestique et enfants',
                  "Santé psychique à l'école", 'Salute mentale dei bambini', 'Häusliche Gewalt in Schulen',
                  'Lehrpersonenmangel an Schulen', 'Formation des enseignants', 'Prima infanzia e docenti'):
            self.assertEqual(self.c(t).verdict, 'a-relire', t)

    def test_un_ancrage_handicap_n_a_pas_besoin_de_contexte(self):
        self.assertEqual(self.c('Gewalt gegen Menschen mit Behinderung').verdict, 'retenu')


class TestExtraitsEnBase(unittest.TestCase):
    """classer_base : sans texte de document, juge les extraits de recherche gardés dans TOUS les bruts de l'affaire."""
    def setUp(self):
        from parlement.tests.outils_test import config_pipeline
        import tempfile
        self._t = tempfile.TemporaryDirectory()
        self.cfg = config_pipeline(self._t.name)
        self.cfg['classement'] = {'ecole_generale': False, 'themes_elargis': False}
        self.base = Base(':memory:')
        self.lex = lexique.charger()

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def affaire(self, ext, extraits):
        brut = {'title': {'de': 'Rapport'}}
        if extraits is not None:
            brut['_search_meta'] = {'snippets': [{'text': t, 'source_type': 'docs'} for t in extraits]}
        a = Affaire(body_key='ZH', external_id=ext, id_api=ext, number=ext, title='Rapport', type_name={'de': 'Motion'},
                    type_harmonized_id=2, date_depot='2026-01-01', updated_at='2026-02-01T00:00:00', brut=brut)
        self.base.enregistrer_affaire(a)
        self.base.c.execute("INSERT OR IGNORE INTO candidats VALUES ('ZH',?,'x','de','now')", (ext,))

    def verdict(self, ext):
        r = self.base.c.execute("SELECT verdict, raison FROM verdicts WHERE external_id=?", (ext,)).fetchone()
        return r['verdict'], r['raison']

    def test_extrait_garde_dans_une_ancienne_version_du_brut(self):
        self.affaire('1', ['Menschen mit Behinderung und Sonderschulung'])
        self.affaire('1', ['Bla bla Voranschlag'])         # recherche suivante : autre extrait, nouveau brut
        classement.classer_base(self.cfg, self.base, self.lex)
        v, raison = self.verdict('1')
        self.assertEqual(v, 'a-relire')
        self.assertIn('extrait', raison)

    def test_sans_extrait_ni_texte_ecarte(self):
        self.affaire('2', None)
        classement.classer_base(self.cfg, self.base, self.lex)
        self.assertEqual(self.verdict('2')[0], 'ecarte')

    def test_un_texte_de_document_prime_sur_l_extrait(self):
        self.affaire('3', ['Menschen mit Behinderung'])
        self.base.c.execute("INSERT INTO documents VALUES ('ZH','3','d1','n','','','de','Der Strassenbelag','e')")
        classement.classer_base(self.cfg, self.base, self.lex)
        self.assertEqual(self.verdict('3')[0], 'ecarte')


if __name__ == '__main__':
    unittest.main()


class TestSchulsozialarbeit(Fond):
    """Source : fiche de recherche forschung/schul-connect-eine-digitale-losung-zur/recherche.de.txt (_NewsUndActu)."""
    def test_le_travail_social_scolaire_est_a_relire_dans_les_trois_langues(self):
        for t in ('Ausbau der Schulsozialarbeit im Kanton', 'Schulsozialarbeiterinnen und Schulsozialarbeiter',
                  'Le travail social scolaire dans les écoles du canton', 'Travailleurs sociaux en milieu scolaire',
                  'Lavoro sociale scolastico nelle scuole medie', 'Assistenza sociale scolastica : bilancio'):
            r = self.c(t, eg=False)
            self.assertEqual(r.verdict, 'a-relire', t)
            self.assertIn('Travail social scolaire', r.raison, t)

    def test_la_source_est_nommee_et_sans_nom_de_personne(self):
        th = next(t for t in self.lex.themes if t.id == 'travail-social-scolaire')
        self.assertTrue(any('schul-connect' in s for s in th.sources))
