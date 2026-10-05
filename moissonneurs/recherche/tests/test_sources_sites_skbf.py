"""Analyseurs des sites et de la SKBF, sur des pages fictives qui reproduisent la structure HTML lue (tests/fixtures).
Un faux `reseau` sert ces pages ; aucun accès réseau. Les pages réelles se jouent dans test_corpus_reel.py."""
import os
import unittest

from recherche.sources import sites, skbf

FIXTURES = os.path.join(os.path.dirname(__file__), 'fixtures')


def _lire(nom):
    with open(os.path.join(FIXTURES, nom), encoding='utf-8') as f:
        return f.read()


def _lire_bytes(nom):
    with open(os.path.join(FIXTURES, nom), 'rb') as f:
        return f.read()


class ReseauFixe:
    """Faux reseau : {url exacte: bytes}. Une URL absente rend un urlset XML vide."""

    URLSET_VIDE = (b'<?xml version="1.0" encoding="UTF-8"?>'
                   b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>')

    def __init__(self, pages):
        self.pages = pages
        self.demandes = []

    def get(self, url, **_):
        self.demandes.append(url)
        if url in self.pages:
            v = self.pages[url]
            return v if isinstance(v, bytes) else v.encode('utf-8')
        return self.URLSET_VIDE

    def get_texte(self, url, **kw):
        return self.get(url, **kw).decode('utf-8')


class TestSkbfListe(unittest.TestCase):
    def setUp(self):
        self.page = _lire('fictif_skbf_liste.html')

    def test_25_lignes_dans_lordre_decroissant(self):
        lignes = skbf._parse_liste(self.page)
        self.assertEqual(len(lignes), 25)
        numeros = [n for n, _id, _t in lignes]
        self.assertEqual(numeros, sorted(numeros, reverse=True))

    def test_premiere_ligne(self):
        numero, id_, titre = skbf._parse_liste(self.page)[0]
        self.assertEqual(numero, '26:096')
        self.assertEqual(id_, '900100')
        self.assertIn('Lesefreude im Zauberwald', titre)

    def test_entites_decodees(self):
        self.assertIn('&', skbf._parse_liste(self.page)[1][2])
        self.assertNotIn('&amp;', skbf._parse_liste(self.page)[1][2])


class TestSkbfDetail(unittest.TestCase):
    def setUp(self):
        self.html = _lire('fictif_skbf_detail.html')
        self.projet = skbf._projet_depuis_detail('26:096', '900100', 'titre de secours', self.html)

    def test_dates(self):
        self.assertEqual(self.projet.debut, '2022')
        self.assertEqual(self.projet.fin, '2024')

    def test_titre_original_seul(self):
        # le titre ne déborde pas sur la section « Titel, Thema übersetzt » qui le suit
        self.assertIn('Lesefreude im Zauberwald', self.projet.title)
        self.assertNotIn('übersetzt', self.projet.title)
        self.assertNotIn('forêt', self.projet.title)
        self.assertNotIn('Description du projet', self.projet.descriptif)

    def test_institutions_sans_le_lien_commente(self):
        # une ligne <tr> entière est laissée en commentaire HTML (lien dupliqué)
        self.assertEqual(self.projet.institutions, 'Hochschule Musterstadt (HSM), Musterstadt')

    def test_url_externe_preferee_lien_skbf_en_extra(self):
        self.assertEqual(self.projet.url, 'https://hochschule-musterstadt.example/projekte/lesefreude/')
        self.assertIn('lien_skbf', self.projet.extra)
        self.assertIn('_id=900100', self.projet.extra['lien_skbf'])

    def test_descriptif_langue_allemande_seule(self):
        # le résumé allemand, jamais la « Description du projet » française qui suit dans la même page
        self.assertTrue(self.projet.descriptif.startswith('Die Studie'))
        self.assertNotIn('Les résultats montrent', self.projet.descriptif)

    def test_aucun_nom_de_la_direction(self):
        self.assertNotIn('Beispiel', repr(self.projet))


class TestSitesDecouverteSitemap(unittest.TestCase):
    """Plan de site fictif : un index et une page de trois <url>."""

    def setUp(self):
        self.reseau = ReseauFixe({
            'https://www.hfh.ch/sitemap.xml': _lire_bytes('fictif_sitemap_index.xml'),
            'https://www.hfh.ch/sitemap.xml?page=1': _lire_bytes('fictif_sitemap_page1.xml'),
        })

    def test_filtre_motif_et_lastmod(self):
        urls = sites._decouvrir_par_sitemap(sites.SITES['hfh'], self.reseau, '2024-01-01')
        # la page /person/ ne suit pas le motif ; le projet de 2023 est trop vieux
        self.assertEqual(urls, [
            ('https://www.hfh.ch/projekt/fiktives-projekt-lesefreude-im-zauberwald', '2026-03-19T19:35:31+01:00'),
        ])

    def test_suit_l_index(self):
        sites._decouvrir_par_sitemap(sites.SITES['hfh'], self.reseau, '2024-01-01')
        self.assertIn('https://www.hfh.ch/sitemap.xml?page=1', self.reseau.demandes)
        self.assertIn('https://www.hfh.ch/sitemap.xml?page=2', self.reseau.demandes)
        self.assertIn('https://www.hfh.ch/sitemap.xml?page=3', self.reseau.demandes)


class TestAnalyseHfh(unittest.TestCase):
    def test_projet(self):
        r = sites._analyser_hfh(_lire('fictif_hfh_projet.html'), 'https://www.hfh.ch/projekt/fiktives-projekt')
        self.assertEqual(r['title'], 'Lesefreude im Zauberwald: ein fiktives Projekt')
        self.assertEqual(r['institutions'], 'Interkantonale Hochschule für Heilpädagogik, HfH')
        self.assertEqual(r['debut'], '2024-11')
        self.assertEqual(r['fin'], '2028-08')
        self.assertTrue(r['descriptif'].startswith('Die Kinder im Zauberwald'))
        self.assertIn('Leitfaden', r['descriptif'])        # le <div> imbriqué ne coupe pas le chapeau
        self.assertEqual(r['manques'], [])
        self.assertNotIn('Muster', repr(r))                 # l'équipe n'entre pas

    def test_cooperations_sans_le_soutien_financier(self):
        r = sites._analyser_hfh(_lire('fictif_hfh_cooperations.html'), 'https://www.hfh.ch/projekt/wolkenschloss')
        self.assertIn('Interkantonale Hochschule für Heilpädagogik, HfH', r['institutions'])
        self.assertIn('Universität Musterstadt', r['institutions'])
        self.assertIn('Hochschule Beispielhausen (HBH)', r['institutions'])
        self.assertNotIn('Stiftung Musterdorf', r['institutions'])

    def test_page_protegee_par_connexion_est_robuste(self):
        r = sites._analyser_hfh(_lire('fictif_hfh_connexion.html'), 'https://www.hfh.ch/projekt/protegee')
        self.assertEqual(r['title'], '')
        self.assertTrue(r['manques'])
        self.assertIn('connexion', r['manques'][0])


class TestAnalysePhbern(unittest.TestCase):
    def test_projet(self):
        r = sites._analyser_phbern(_lire('fictif_phbern.html'), 'https://www.phbern.ch/forschung/projekte/brueckenbau')
        self.assertIn('Brückenbau', r['title'])
        self.assertEqual(r['debut'], '2025-10-01')
        self.assertEqual(r['fin'], '2027-09-30')
        self.assertTrue(r['institutions'].startswith('Pädagogische Hochschule Bern'))
        self.assertIn('Universität Musterstadt', r['institutions'])
        self.assertEqual(r['descriptif'], 'Ein erfundenes Projekt über Brücken zwischen Klassen.')
        for nom in ('Muster,', 'Probe', 'Exemple', 'Beispiel'):
            self.assertNotIn(nom, repr(r))


class TestAnalyseEhb(unittest.TestCase):
    def test_projet(self):
        r = sites._analyser_ehb(_lire('fictif_ehb.html'), 'https://www.ehb.swiss/forschung/projekte/werkstatt')
        self.assertEqual(r['title'], 'Werkstatt für alle: ein fiktives Projekt der EHB')
        self.assertEqual(r['institutions'], 'Eidgenössische Hochschule für Berufsbildung, EHB')
        self.assertEqual(r['debut'], '2025-03-01')
        self.assertEqual(r['fin'], '2026-06-01')
        self.assertTrue(r['descriptif'].startswith('Werkstätten für alle'))
        self.assertNotIn('Interviews', r['descriptif'])


class TestAnalysePhsg(unittest.TestCase):
    def test_projet(self):
        r = sites._analyser_phsg(_lire('fictif_phsg.html'), 'https://www.phsg.ch/de/forschung-entwicklung/projekte/lik')
        self.assertEqual(r['institutions'], 'Pädagogische Hochschule St. Gallen')
        self.assertEqual(r['debut'], '2025')
        self.assertEqual(r['fin'], '2029')
        self.assertTrue(r['descriptif'].startswith('Lesefreude'))
        self.assertNotIn('Gesucht werden', r['descriptif'])    # la barre « Auf einen Blick » n'est pas le descriptif


class TestAnalysePhfhnw(unittest.TestCase):
    def test_projet(self):
        r = sites._analyser_phfhnw(_lire('fictif_phfhnw.html'),
                                   'https://www.fhnw.ch/de/ph/forschung-entwicklung/forschung/projekte/wortschatz')
        self.assertEqual(r['title'], 'Wortschatz – ein fiktives Projekt')
        self.assertEqual(r['debut'], '2021')
        self.assertEqual(r['fin'], '2024')
        self.assertEqual(r['institutions'], 'Pädagogische Hochschule FHNW, Universität Musterstadt')
        self.assertTrue(r['descriptif'].startswith('Wörter lernen'))
        self.assertNotIn('Probe', repr(r))


class TestAnalysePhzh(unittest.TestCase):
    def test_projet(self):
        r = sites._analyser_phzh(_lire('fictif_phzh.html'), 'https://phzh.ch/projekte/spiel-und-sprache')
        self.assertIn('FIKTIV', r['title'])
        self.assertEqual(r['debut'], '2025-01-01')
        self.assertEqual(r['fin'], '2028-12-31')
        self.assertIn('Pädagogische Hochschule Zürich', r['institutions'])
        self.assertIn('PH Musterland', r['institutions'])
        self.assertTrue(r['descriptif'].startswith('Im frühen Schulalter'))
        self.assertNotIn('Klicken', r['descriptif'])


class TestAnalyseHepvd(unittest.TestCase):
    def test_projet(self):
        r = sites._analyser_hepvd(_lire('fictif_hepvd.html'), 'https://www.hepl.ch/projet-fictif.html')
        self.assertIn('LIJA', r['title'])
        self.assertEqual(r['langue'], 'fr')
        self.assertTrue(r['descriptif'].startswith('Lire ensemble'))
        self.assertIn('école imaginaire', r['descriptif'])


class TestSitesDesactives(unittest.TestCase):
    def test_phzh_phlu_hepbejune_hepfr_desactives_avec_raison(self):
        for nom in ('phzh', 'phlu', 'hepbejune', 'hepfr'):
            site = sites.SITES[nom]
            self.assertFalse(site['actif'])
            self.assertTrue(site['raison'])

    def test_sites_actifs_ont_un_analyseur_et_un_libelle(self):
        for nom, site in sites.SITES.items():
            self.assertTrue(site.get('libelle'), nom)
            if site['actif']:
                self.assertIsNotNone(site.get('analyser'), nom)


if __name__ == '__main__':
    unittest.main()
