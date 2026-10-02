"""Modèles de couverture : couverture.modele de buch.yaml (falc, classique, recherche,
prospectrum), lu par modele_couverture() seule, et ce que chaque modèle compose.

Lancer :
    python3 test/couverture-modele.test.py
"""
import importlib.util
import os
import re
import tempfile
import unittest
from unittest import mock

ICI = os.path.dirname(os.path.abspath(__file__))
PIPELINE = os.path.join(ICI, '..', 'pipeline')
spec = importlib.util.spec_from_file_location(
    'couverture', os.path.join(PIPELINE, 'couverture.py'))
couverture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(couverture)
CSS = os.path.join(PIPELINE, 'styles', 'livre', 'couverture.css')
GABARIT = os.path.join(PIPELINE, 'templates', 'szh-couverture.html')

LIVRE = {
    'titre': 'Un titre // en deux lignes', 'sous-titre': 'Le sous-titre', 'lang': 'de',
    'maquette': 'normal', 'format': 'standard', 'couleur-impression': 'bleu-acier',
    'collection': 'Sonderpädagogische Forschung in der Schweiz', 'tome': '4',
    'isbn-print': '978-3-905890-00-0', 'isbn-ebook': '978-3-905890-00-1',
    'auteurs': [{'prenom': 'Banc', 'nom': 'Essai'}],
}


def pdf_minimal(pages):
    """Un PDF à table xref classique de `pages` pages, que compter_pages_pdf() sait lire."""
    objets = ['<< /Type /Catalog /Pages 2 0 R >>',
              '<< /Type /Pages /Kids [%s] /Count %d >>'
              % (' '.join('%d 0 R' % (3 + i) for i in range(pages)), pages)]
    objets += ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 10 10] >>'] * pages
    corps, offsets = b'%PDF-1.4\n', []
    for n, o in enumerate(objets, 1):
        offsets.append(len(corps))
        corps += ('%d 0 obj\n%s\nendobj\n' % (n, o)).encode('ascii')
    xref = len(corps)
    corps += ('xref\n0 %d\n0000000000 65535 f \n' % (len(objets) + 1)).encode('ascii')
    corps += b''.join(('%010d 00000 n \n' % o).encode('ascii') for o in offsets)
    corps += ('trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n'
              % (len(objets) + 1, xref)).encode('ascii')
    return corps


def livre(**cles):
    b = dict(LIVRE)
    couv = dict(cles.pop('couverture', {}))
    b.update(cles)
    b['couverture'] = couv
    return b


class Resolution(unittest.TestCase):
    def test_par_defaut_la_maquette_decide(self):
        self.assertEqual(couverture.modele_couverture({'maquette': 'falc'}), 'falc')
        self.assertEqual(couverture.modele_couverture({'maquette': 'normal'}), 'classique')
        self.assertEqual(couverture.modele_couverture({}), 'classique')
        self.assertEqual(couverture.modele_couverture({'couverture': {'modele': ''}}),
                         'classique')

    def test_valeur_explicite(self):
        for m in ('falc', 'classique', 'recherche', 'prospectrum'):
            self.assertEqual(couverture.modele_couverture(
                {'maquette': 'normal', 'couverture': {'modele': m}}), m)

    def test_valeur_inconnue_refusee(self):
        with self.assertRaises(couverture.ErreurCouverture) as e:
            couverture.modele_couverture({'couverture': {'modele': 'normal'}})
        self.assertIn('prospectrum', str(e.exception))

    def test_fond_par_defaut_selon_le_modele(self):
        self.assertEqual(couverture.fond_couverture({'maquette': 'falc'}), ('poireau', 9.0))
        self.assertEqual(couverture.fond_couverture({}), ('bleu-acier', 9.0))
        self.assertEqual(couverture.fond_couverture(
            {'couverture': {'modele': 'recherche'}}), ('bleu-acier', 20.0))
        self.assertEqual(couverture.fond_couverture(
            {'couverture': {'modele': 'recherche', 'fond': 'nuit', 'fond-teinte': 12}}),
            ('nuit', 12.0))


class Palette(unittest.TestCase):
    def test_couleurs_fixes_tirees_de_la_table(self):
        ref = couverture.charger_reference()
        self.assertIn('sapin', ref)
        imp = couverture.palette(livre(), ref, 'impression')
        ecr = couverture.palette(livre(), ref, 'ecran')
        for cle in ('rouge', 'capucine'):
            self.assertEqual(imp[cle], couverture._cmjn_css(ref[cle]['cmjn']))
            self.assertEqual(ecr[cle], ref[cle]['rgb'].upper())

    def test_voiles_du_modele_recherche(self):
        ref = couverture.charger_reference()
        imp = couverture.palette(livre(), ref, 'impression')
        self.assertEqual(imp['accent-voile'], 'device-cmyk(0.65 0.25 0.2 0 / 0.68)')
        self.assertEqual(imp['capucine-voile'], 'device-cmyk(0 0.74 0.64 0 / 0.85)')
        ecr = couverture.palette(livre(), ref, 'ecran')
        self.assertEqual(ecr['accent-voile'], 'rgb(95 159 188 / 0.68)')


class Blocs(unittest.TestCase):
    def blocs(self, modele, **cles):
        b = livre(couverture=dict({'modele': modele}, **cles.pop('couverture', {})), **cles)
        ref = couverture.charger_reference()
        p = couverture.palette(b, ref, 'impression')
        return couverture.blocs_maquette(b, b['lang'], modele, p, 'T', 'R')

    def test_tous_les_emplacements(self):
        for m in couverture.MODELES:
            self.assertEqual(set(self.blocs(m)),
                             {'pied', 'dos', '1re-haut', 'bandeau-extra', '4e-haut',
                              '4e-extra'}, m)

    def test_isbn_en_4e_hors_falc(self):
        self.assertEqual(self.blocs('falc')['4e-extra'], '')
        for m in ('classique', 'recherche', 'prospectrum'):
            x = self.blocs(m)['4e-extra']
            self.assertIn('978-3-905890-00-1', x, m)
            self.assertIn('978-3-905890-00-0', x, m)
            self.assertIn('ISBN E-Book: ', x, m)
        x = self.blocs('classique', lang='fr')['4e-extra']
        self.assertIn('ISBN E-Book : ', x)
        self.assertNotIn('class="szh-couv-isbn"', self.blocs(
            'classique', **{'isbn-print': '', 'isbn-ebook': ''})['4e-extra'])

    def test_recherche_collection_et_tome(self):
        pied = self.blocs('recherche')['pied']
        pc = lambda t: '<span class="szh-couv-pc">%s</span>' % t
        self.assertIn('S%s F%s %s %s S%s<br />B%s 4' % (
            pc('onderpädagogische'), pc('orschung'), pc('in'), pc('der'), pc('chweiz'),
            pc('and')), pied)

    def test_petites_capitales_composees(self):
        # La référence compose ses petites capitales en capitales à 70 % : une minuscule
        # devient une capitale réduite, une capitale garde son corps.
        self.assertEqual(couverture.petites_capitales('Band 4'),
                         'B<span class="szh-couv-pc">and</span> 4')
        self.assertEqual(couverture.petites_capitales('a&b'),
                         '<span class="szh-couv-pc">a</span>&amp;<span class="szh-couv-pc">b</span>')
        css = open(CSS, encoding='utf-8').read()
        self.assertRegex(css, r'\.szh-couv-pc\s*\{[^}]*text-transform:\s*uppercase;[^}]*font-size:\s*0?\.7em')

    def test_prospectrum_titre_second_et_sa_langue(self):
        x = self.blocs('prospectrum', couverture={'titre-2': 'La CDPH // en Suisse',
                                                  'sous-titre-2': 'Bilan'})
        self.assertIn('<p class="szh-couv-titre-2" lang="fr">La CDPH<br />en Suisse</p>',
                      x['bandeau-extra'])
        self.assertIn('lang="fr">Bilan</p>', x['bandeau-extra'])
        self.assertIn('Band 4\u200a/\u200aVolume 4', x['pied'])
        self.assertIn('Sonderpädagogische Forschung in der Schweiz', x['1re-haut'])
        sans = self.blocs('prospectrum')
        self.assertEqual(sans['bandeau-extra'], '')
        self.assertIn('Band 4<', sans['pied'])

    def test_illustration_pleine_classique_passe_le_logo_au_papier(self):
        ref = couverture.charger_reference()
        p = couverture.palette(livre(), ref, 'impression')
        plein = self.blocs('classique', couverture={'illustration-plein': True})['pied']
        libre = self.blocs('classique')['pied']
        self.assertNotEqual(plein, libre)
        self.assertIn(couverture.logo_uri('edition-szh-csps.svg', p['papier'], p['accent']),
                      plein)

    def test_aucune_couleur_litterale(self):
        for m in couverture.MODELES:
            for nom, x in self.blocs(m, couverture={'titre-2': 'X'}).items():
                sans_images = re.sub(r'src="data:[^"]*"', '', x)
                self.assertNotRegex(sans_images, r'#[0-9A-Fa-f]{3,8}\b|rgb\(|cmyk\(',
                                    '%s / %s' % (m, nom))


class Composition(unittest.TestCase):
    def setUp(self):
        self.dossier = tempfile.mkdtemp()
        self.pdf = os.path.join(self.dossier, 'livre.pdf')
        with open(self.pdf, 'wb') as f:
            f.write(pdf_minimal(12))
        self.quatrieme = os.path.join(self.dossier, 'q.html')
        with open(self.quatrieme, 'w', encoding='utf-8') as f:
            f.write('<p>Texte</p>')

    def composer(self, modele, mode='ecran'):
        opts = {'pdf-interieur': self.pdf, 'quatrieme': self.quatrieme, 'gabarit': GABARIT,
                'css': [], 'icc-dir': '/opt/icc'}
        return couverture.composer(opts, livre(couverture={'modele': modele}), mode)[0]

    def test_chaque_modele_compose_sans_jeton_restant(self):
        # Le fond ProSpectrum passe par Pillow et le profil ICC, absents de la CI (ni Pillow
        # ni /opt/icc) : build-render.sh le compose pour de vrai, dans l'image.
        with mock.patch.object(couverture, 'fond_uri', lambda *a: 'data:,'), \
                mock.patch.object(couverture, 'profil_icc', lambda *a: '/profil-factice.icc'):
            for m in couverture.MODELES:
                # Les commentaires du gabarit gardent leurs jetons, voulus.
                html = re.sub(r'<!--.*?-->', '', self.composer(m), flags=re.S)
                self.assertIn('szh-couv-%s' % m, html)
                self.assertNotRegex(html, r'\$[a-z0-9-]+\$', m)

    def test_la_feuille_a_une_section_par_modele(self):
        css = open(CSS, encoding='utf-8').read()
        for m in couverture.MODELES:
            self.assertIn('.szh-couv-%s ' % m, css, m)
        self.assertNotIn('.szh-couv-normal', css)

    def test_fond_prospectrum_livre_en_cmjn(self):
        chemin = os.path.join(PIPELINE, 'media', 'fonds', 'prospectrum.jpg')
        data = open(chemin, 'rb').read()
        sof = re.search(rb'\xff[\xc0\xc2](..)(.)(..)(..)(.)', data, re.S)
        self.assertIsNotNone(sof)
        self.assertEqual(sof.group(5), b'\x04', 'le fond ProSpectrum doit être un JPEG CMJN')


if __name__ == '__main__':
    unittest.main()
