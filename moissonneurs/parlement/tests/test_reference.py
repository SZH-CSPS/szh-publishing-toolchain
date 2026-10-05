import os
import tempfile
import unittest

from parlement import classement, kirby, lexique, reference
from parlement.sources.openparldata import Affaire
from parlement.stockage import Base
from parlement.tests.outils_test import ecrire_fiche_prod

CFG = {'moisson': {'confederation': 'CHE'}}


def ecrire_fiche(racine, slug, langue='de', **champs):
    titre = champs.pop('title')
    ecrire_fiche_prod(racine, slug, titre, langue=langue, **champs)


class TestReference(unittest.TestCase):
    def setUp(self):
        self._t = tempfile.TemporaryDirectory()
        self.racine = self._t.name
        ecrire_fiche(self.racine, 'a', title='Sonderpädagogik im Kanton', canton='LU', categorie='postulat',
                     numero='25.356', date='2025-01-27', lien='https://x.invalid/a')
        ecrire_fiche(self.racine, 'b', title='Eine Frage ohne Nummer', canton='CH', categorie='motion',
                     date='2025-02-01', lien='https://x.invalid/b')
        ecrire_fiche(self.racine, 'c', title='Digitale Lehrmittel', canton='BL', categorie='motion',
                     numero='24.575', date='2025-03-01')
        self.base = Base(':memory:')
        for corps, ext, num, titre in (('LU', '1', '25.356', 'Anderer Titel'),
                                       ('CHE', '2', '25.9', 'Eine Frage ohne Nummer')):
            self.base.enregistrer_affaire(Affaire(body_key=corps, external_id=ext, id_api=ext, number=num,
                                                  title=titre, brut={'n': num}))

    def tearDown(self):
        self.base.fermer()
        self._t.cleanup()

    def test_lecture_de_la_reference(self):
        refs = reference.lire_reference(self.racine)
        self.assertEqual(len(refs), 3)
        self.assertEqual({r['canton'] for r in refs}, {'LU', 'CH', 'BL'})

    def test_appariement_par_numero_puis_par_titre(self):
        refs = reference.lire_reference(self.racine)
        res = {r['slug']: (a['external_id'] if a else None, m) for r, a, m in reference.apparier(refs, self.base, CFG)}
        self.assertEqual(res['a'], ('1', 'numero'))
        self.assertEqual(res['b'], ('2', 'titre'))     # CH -> CHE, pas de numéro : repli sur le titre
        self.assertEqual(res['c'], (None, ''))

    def test_cle_numero_ignore_espaces_et_casse(self):
        self.assertEqual(reference.cle_numero('M 2891'), reference.cle_numero('m2891'))

    def test_rappel_titres_seuls(self):
        lex = lexique.charger()
        refs = reference.lire_reference(self.racine)
        ok, n, manquees = reference.rappel_titres_seuls(refs, lex)
        self.assertEqual((ok, n), (1, 3))
        self.assertEqual({m['slug'] for m in manquees}, {'b', 'c'})
        ok2, _, _ = reference.rappel_titres_seuls(refs, lex, ecole_generale=True)
        self.assertEqual(ok2, 2)                        # « Digitale Lehrmittel » entre par le palier école

    def test_rappel_pipeline_explique_chaque_manquee(self):
        self.base.c.execute("INSERT INTO verdicts VALUES ('LU','1','retenu',8,'education','postulat','ancrage',"
                            "'2026-10-02T00:00:00')")
        refs = reference.lire_reference(self.racine)
        ok, n, lignes = reference.rappel_pipeline(refs, self.base, CFG)
        self.assertEqual((ok, n), (1, 3))
        statuts = {l['ref']['slug']: l['statut'] for l in lignes}
        self.assertEqual(statuts['a'], 'classée')
        self.assertEqual(statuts['b'], 'trouvée, jamais candidate')
        self.assertEqual(statuts['c'], 'absente de la base')
        for l in lignes:
            self.assertTrue(l['explication'])


class TestPalier(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lex = lexique.charger()

    def aff(self, titre):
        return dict(body_key='ZH', number='1', title=titre, type_name={}, type_harmonized_id=None)

    def test_palier_desactive_par_defaut(self):
        r = classement.classer(self.lex, self.aff('Hausaufgaben in der Primarschule'), '', candidat=False)
        self.assertEqual(r.verdict, 'ecarte')

    def test_palier_active_ne_retient_jamais(self):
        r = classement.classer(self.lex, self.aff('Hausaufgaben in der Primarschule'), '', candidat=False,
                               ecole_generale=True)
        self.assertEqual(r.verdict, 'a-relire')
        self.assertIn('ecole_generale', r.raison)

    def test_palier_n_agit_pas_sur_un_titre_hors_ecole(self):
        r = classement.classer(self.lex, self.aff('Strassenunterhalt'), '', candidat=False, ecole_generale=True)
        self.assertEqual(r.verdict, 'ecarte')


class TestKirbyLecture(unittest.TestCase):
    def test_lecture(self):
        txt = 'Title: Titre: avec deux-points\n\n----\n\nUuid: ' + 'A' * 16 + '\n\n----\n\nAusgabe: \n\n----\n\n' \
              'Descriptif:\n\n a\n\\----\nb\n'
        c = kirby.lire_txt(txt)
        self.assertEqual(c['title'], 'Titre: avec deux-points')
        self.assertEqual(c['uuid'], 'A' * 16)
        self.assertEqual(c['ausgabe'], '')
        self.assertEqual(c['descriptif'], ' a\n----\nb')

    def test_aucune_fonction_d_ecriture(self):
        for nom in ('ecrire_txt', 'generer_uuid', 'slug_unique', 'ecrire_fiche'):
            self.assertFalse(hasattr(kirby, nom), nom)


if __name__ == '__main__':
    unittest.main()
