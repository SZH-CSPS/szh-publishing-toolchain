"""Institutions reconnues, noms de personnes, rubriques d'équipe, dates PH FHNW. Fixtures synthétiques, hors réseau."""
import unittest

from recherche import institutions, personnes, propositions
from recherche.sources import sites


class TestMotsInstitution(unittest.TestCase):
    def test_reconnues(self):
        for nom in ('Universität Zürich', 'Université de Genève', 'Wenzhou-Kean University', 'Pädagogische Hochschule Bern',
                    'Fachhochschule Nordwestschweiz', 'Mosaikschule Beispiel', 'Haute école pédagogique Fribourg',
                    'Institut für Bildung', 'Volksschulamt', 'Amt für Volksschule', 'Stiftung Kind', 'Verein Lesen',
                    'Zentrum für Lernen', 'Kanton Bern', 'PH Schwyz', 'HfH Zürich', 'PHBern', 'HEP Vaud',
                    'Departement für Sonderpädagogik der Universität Freiburg', 'Interkantonale Hochschule für Heilpädagogik'):
            self.assertTrue(institutions.est_institution(nom), nom)

    def test_non_reconnues(self):
        for nom in ('Anna Beispiel', 'Hans Schulermuster', 'Musterdorf', 'Spitalacker', 'Lea Amtmuster', 'Belp', ''):
            self.assertFalse(institutions.est_institution(nom), nom)

    def test_liste_versionnee(self):
        self.assertIsInstance(institutions.VERSION, int)
        self.assertGreater(len(institutions.MOTS), 10)

    def test_couples_personne_institution(self):
        retenues, retirees = institutions.depuis_couples(
            ['Anna Beispiel, Universität Musterstadt', 'Hans Muster, Musterdorf', 'Lea Probe'])
        self.assertEqual(retenues, ['Universität Musterstadt'])
        self.assertEqual(retirees, ['Musterdorf', 'Lea Probe'])

    def test_liste_stockee(self):
        garde, retirees = institutions.nettoyer_liste('Pädagogische Hochschule Bern, Musterdorf, PH Schwyz',
                                                      'Pädagogische Hochschule Bern')
        self.assertEqual(garde, 'Pädagogische Hochschule Bern, PH Schwyz')
        self.assertEqual(retirees, ['Musterdorf'])


PAGE_PHBERN = '''<html lang="de"><body><h1>Lesen lernen mit Autismus</h1>
<div class="grid__item lg-w-9/10 text-large"><p>Ein Projekt zum Lesen.</p></div>
<div class="double-field"><div class="double-field__item double-field__item--first"> Laufzeit </div>
<div class="double-field__item double-field__item--second"><time datetime="2025-10-01T00:00:00Z">1.10.2025</time> -
<time datetime="2027-09-30T00:00:00Z">30.9.2027</time></div> </div>
<div class="double-field"><div><div class="double-field__item double-field__item--first"> Kooperationen </div>
<div class="double-field__item double-field__item--second x">Anna Beispiel, Universität Musterstadt; Hans Muster, Musterdorf; Lea Probe</div> </div> </div>
</body></html>'''


def page_phfhnw(laufzeit, partner=''):
    champs = f'<dl><dt class="info__key">Laufzeit</dt><dd class="info__value"><div>{laufzeit}</div></dd>'
    if partner:
        champs += f'<dt class="info__key">Partner</dt><dd class="info__value"><div>{partner}</div></dd>'
    return (f'<html lang="de"><body><h1>Sprachen inklusiv<small>, Pädagogische Hochschule FHNW</small></h1>{champs}</dl>'
            '<div class="page__section-content"> <p>Ein Projekt.</p></div></body></html>')


class TestAnalyseurs(unittest.TestCase):
    def test_phbern_garde_l_institution_seulement(self):
        r = sites._analyser_phbern(PAGE_PHBERN, 'https://www.phbern.ch/forschung/projekte/x')
        self.assertEqual(r['institutions'], 'Pädagogische Hochschule Bern, Universität Musterstadt')
        self.assertEqual(r['institutions_retirees'], 2)
        texte = repr(r)
        for nom in ('Anna', 'Beispiel', 'Hans', 'Muster,', 'Lea', 'Probe', 'Musterdorf'):
            self.assertNotIn(nom, texte)

    def test_phfhnw_morceau_sans_virgule_retire(self):
        r = sites._analyser_phfhnw(page_phfhnw('2021 – 2024', 'Lea Probe / Anna Beispiel, Universität Musterstadt'), 'u')
        self.assertEqual(r['institutions'], 'Pädagogische Hochschule FHNW, Universität Musterstadt')
        self.assertNotIn('Probe', repr(r))
        self.assertEqual((r['debut'], r['fin']), ('2021', '2024'))

    def test_phfhnw_duree_d_une_autre_forme(self):
        r = sites._analyser_phfhnw(page_phfhnw('September 2022 - August 2026'), 'u')
        self.assertEqual((r['debut'], r['fin']), ('', ''))
        self.assertEqual((r['debut_brut'], r['fin_brut']), ('September 2022', 'August 2026'))
        r = sites._analyser_phfhnw(page_phfhnw('1.4.2020–31.3.2024'), 'u')
        self.assertEqual((r['debut_brut'], r['fin_brut']), ('1.4.2020', '31.3.2024'))

    def test_phfhnw_dates_textuelles_et_fin_ouverte(self):
        r = sites._analyser_phfhnw(page_phfhnw('1. Juli 2021 – 30. Juni 2024'), 'u')
        self.assertEqual((r['debut'], r['fin']), ('2021-07-01', '2024-06-30'))
        r = sites._analyser_phfhnw(page_phfhnw('2024 – offen'), 'u')
        self.assertEqual((r['debut'], r['fin'], r.get('fin_brut', '')), ('2024', '', ''))


class TestDates(unittest.TestCase):
    def test_suggestions(self):
        cas = {'September 2024': '2024-09', 'Juni 2021': '2021-06', 'septembre 2024': '2024-09', '1.4.2020': '2020-04-01',
               '1. Juli 2021': '2021-07-01', '03.2025': '2025-03', 'bientôt': '', '31.2.2024': ''}
        for brut, attendu in cas.items():
            self.assertEqual(propositions.lire_date_partielle(brut), ('', attendu), brut)

    def test_valeurs(self):
        for v in ('2024', '2024-09', '2024-02-29'):
            self.assertEqual(propositions.lire_date_partielle(v), (v, ''))
        self.assertEqual(propositions.lire_date_partielle('2023-02-29')[0], '')

    def test_fin_ouverte(self):
        for v in ('offen', 'laufend', 'en cours', 'ongoing', ''):
            self.assertTrue(propositions.fin_ouverte(v), v)
        self.assertFalse(propositions.fin_ouverte('2026'))


class TestPersonnes(unittest.TestCase):
    def test_masque(self):
        self.assertEqual(personnes.masque('Anna Beispiel'), 'A*** B***')
        self.assertEqual(personnes.masque('Paul-Claude Muster'), 'P*** M***')

    def test_detection(self):
        cas = {
            'geleitet von Prof. Dr. Anna Beispiel an der PH': ['Anna Beispiel'],
            'Leitung bei Dr. phil. Hans Muster an der PH': ['Hans Muster'],
            'avec Mme Lea Probe et M. Marc Exemple': ['Lea Probe', 'Marc Exemple'],
            'Frau Anna Beispiel und Herr Hans Muster': ['Anna Beispiel', 'Hans Muster'],
            'Prof. Beispiel leitet': ['Beispiel'],
            'Beispiel, A. (2022). Titel einer Arbeit.': ['Beispiel A.'],
            'Muster, H. & Probe, L. (2019). Titre.': ['Muster H.', 'Probe L.'],
        }
        for texte, attendus in cas.items():
            self.assertEqual(personnes.noms_possibles(texte), attendus, texte)

    def test_sans_signal(self):
        for texte in ('Pädagogische Hochschule Bern und Universität Zürich', 'Herr der Lage bleiben',
                      'Das Projekt Schul-Connect startet', 'Anna Beispiel arbeitet mit'):
            self.assertEqual(personnes.noms_possibles(texte), [], texte)


if __name__ == '__main__':
    unittest.main()
