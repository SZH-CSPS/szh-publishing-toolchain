#!/usr/bin/env python3
# Accessibilité des sorties du livre :
#
#   1. livre-assembler.py : identifiants préfixés par chapitre (prefixer_identifiants),
#      sommaire imbriqué (parties, chapitres, intertitres), repères du HTML web (--web),
#      métadonnées d'accessibilité de l'EPUB ;
#   2. livre-epub-prepare.py : tableaux mis de côté en XHTML (proteger_tableaux), data-partie
#      et data-chapitre sur le titre d'un chapitre ;
#   3. livre-epub-finir.py : navigation par parties, repères, <title> des documents,
#      couverture nommée ;
#   4. la chaîne EPUB entière sur un petit livre (prepare, pandoc et szh-livre-epub-brut.lua,
#      finir) : un tableau complexe y garde ses <th> de rangée et ses renvois ;
#   5. deux chapitres à deux tableaux complexes, compilés par szh-numerotation.lua et
#      szh-tableau-boite.lua (szh-cN-tM-…) puis préfixés par le slug : aucun id en double,
#      et chaque renvoi reste dans son tableau, dans le HTML du PDF, le web et l'EPUB.
#
#   python3 test/livre-accessibilite.test.py

import importlib.util
import io
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
import zipfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE = os.path.join(RACINE, 'pipeline')


def _charger(nom, fichier):
    spec = importlib.util.spec_from_file_location(nom, os.path.join(PIPELINE, fichier))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


la = _charger('livre_assembler', 'livre-assembler.py')
prep = _charger('livre_epub_prepare', 'livre-epub-prepare.py')
fin = _charger('livre_epub_finir', 'livre-epub-finir.py')

XHTML = '{http://www.w3.org/1999/xhtml}'


def _tableau(numero_note=1):
    """Boîte de tableau telle que la chaîne d'un chapitre l'écrit : identifiants bruts,
    numérotés par chapitre, non préfixés par pandoc."""
    return (
        '<div class="szh-tableau-boite">\n'
        '<table class="szh-tableau" data-alt="Desc" aria-describedby="szh-tabelle-desc-1 '
        'szh-bloc-note-%d">\n'
        '<caption><span class="szh-numero">Tabelle 1:</span> Titel&nbsp;A</caption>\n'
        '<thead><tr><th id="szh-th-r0c0" scope="col">Massnahme</th>'
        '<th id="szh-th-r0c1" scope="col">2024</th></tr></thead>\n'
        '<tbody><tr><th id="szh-th-r1c0" scope="rowgroup" colspan="2">Primarstufe</th></tr>\n'
        '<tr><th id="szh-th-r2c0" scope="row">Logopädie</th>'
        '<td headers="szh-th-r0c1 szh-th-r1c0 szh-th-r2c0" data-align="right">412<br>x</td>'
        '</tr></tbody>\n</table>\n'
        '<p class="szh-bloc-note" id="szh-bloc-note-%d"><span class="szh-bloc-note-etiquette">'
        'Notiz</span>: Leer.</p>\n'
        '<div class="szh-description" id="szh-tabelle-desc-1">Desc</div>\n'
        '</div>\n' % (numero_note, numero_note))


def _chapitre(slug, titre, corps='', partie=None):
    attr_partie = ' data-partie="%d"' % partie if partie else ''
    return ('<section class="szh-chapitre"%s id="ch-%s" data-rang="1">\n'
            '<div class="szh-onglet" aria-hidden="true"></div>\n'
            '<div class="szh-pastille" aria-hidden="true">1</div>\n'
            '<div class="szh-picto-entete" data-picto aria-hidden="true"></div>\n'
            '<h1 id="%s-titre">%s</h1>\n%s<p>Text.</p>\n</section>\n'
            % (attr_partie, slug, slug, titre, corps))


class IdentifiantsParChapitre(unittest.TestCase):
    def test_deux_chapitres_n_ont_plus_d_identifiant_commun(self):
        a = la.prefixer_identifiants(_chapitre('02-a', 'A', _tableau()), '02-a')
        b = la.prefixer_identifiants(_chapitre('04-b', 'B', _tableau()), '04-b')
        ids_a = set(re.findall(r'\sid="([^"]+)"', a))
        ids_b = set(re.findall(r'\sid="([^"]+)"', b))
        self.assertFalse(ids_a & ids_b, ids_a & ids_b)
        self.assertIn('id="04-b-szh-tabelle-desc-1"', b)
        self.assertIn('id="04-b-szh-bloc-note-1"', b)
        self.assertIn('id="04-b-szh-th-r2c0"', b)

    def test_les_renvois_suivent(self):
        b = la.prefixer_identifiants(_chapitre('04-b', 'B', _tableau()), '04-b')
        self.assertIn('aria-describedby="04-b-szh-tabelle-desc-1 04-b-szh-bloc-note-1"', b)
        self.assertIn('headers="04-b-szh-th-r0c1 04-b-szh-th-r1c0 04-b-szh-th-r2c0"', b)
        ids = set(re.findall(r'\sid="([^"]+)"', b))
        for liste in re.findall(r'(?:headers|aria-describedby)="([^"]+)"', b):
            for ident in liste.split():
                self.assertIn(ident, ids)

    def test_identifiants_de_pandoc_et_de_la_section_inchanges(self):
        b = la.prefixer_identifiants(_chapitre('04-b', 'B', '<a href="#04-b-titre">x</a>'
                                               '<a href="#ailleurs">y</a>'), '04-b')
        self.assertIn('id="ch-04-b"', b)
        self.assertIn('<h1 id="04-b-titre">', b)
        self.assertIn('href="#04-b-titre"', b)
        # Un renvoi vers un identifiant absent du fragment n'est pas touché.
        self.assertIn('href="#ailleurs"', b)

    def test_le_texte_et_les_svg_ne_bougent_pas(self):
        corps = ('<p id="x">Le code id="x" reste.</p>'
                 '<svg><defs><clipPath id="c"/></defs><g clip-path="url(#c)"/></svg>')
        b = la.prefixer_identifiants(_chapitre('s', 'S', corps), 's')
        self.assertIn('<p id="s-x">Le code id="x" reste.</p>', b)
        self.assertIn('<clipPath id="c"/>', b)


class SommaireImbrique(unittest.TestCase):
    ENTREES = [
        (1, 'vorwort', 'Vorwort', None, None),
        (1, 'c1', 'Einleitung', None, None),
        (2, 'c1-a', 'Fragen', None, None),
        (0, 'partie-1-titre', 'Teil', None, None, {'classes': ('partie-seule',), 'numero': ''}),
        (1, 'c2', 'Konzepte', None, None, {'classes': ('dans-partie',)}),
        (2, 'c2-a', 'Teilhabe', None, None),
        (1, 'c3', 'Schluss', None, None, {'classes': ('dans-partie',)}),
        (1, 'c4', 'Tabellen', None, None),
    ]

    def _arbre(self, html):
        racine = ET.fromstring(html.replace('<section', '<div').replace('</section>', '</div>'))
        return racine.find('ol')

    def test_les_chapitres_d_une_partie_sont_dans_sa_sous_liste(self):
        ol = self._arbre(la.sommaire_html(self.ENTREES, 'Inhalt', cases=False))
        premiers = [li.find('span/a').get('href') for li in ol.findall('li')]
        self.assertEqual(premiers, ['#vorwort', '#c1', '#partie-1-titre', '#c4'])
        partie = ol.findall('li')[2]
        self.assertIn('szh-sommaire-groupe', partie.get('class'))
        enfants = [li.find('span/a').get('href') for li in partie.find('ol').findall('li')]
        self.assertEqual(enfants, ['#c2', '#c3'])
        # Les intertitres d'un chapitre sont dans la sous-liste du chapitre.
        c2 = partie.find('ol').findall('li')[0]
        self.assertEqual([li.find('span/a').get('href') for li in c2.find('ol').findall('li')],
                         ['#c2-a'])
        c1 = ol.findall('li')[1]
        self.assertEqual([li.find('span/a').get('href') for li in c1.find('ol').findall('li')],
                         ['#c1-a'])

    def test_une_entree_sans_sous_liste_reste_telle_quelle(self):
        html = la.sommaire_html(self.ENTREES, 'Inhalt', cases=False)
        self.assertIn('<li class="niveau-1"><span><a href="#c4">Tabellen</a></span></li>', html)

    def test_hierarchique_parties_et_chapitres(self):
        html = la.sommaire_html(self.ENTREES, 'Inhalt', hierarchique=True, cases=False)
        self.assertNotIn('c2-a', html)
        ol = self._arbre(html)
        partie = ol.findall('li')[2]
        self.assertEqual(len(partie.find('ol').findall('li')), 2)

    def test_nav_pour_le_web(self):
        html = la.sommaire_html(self.ENTREES, 'Inhalt', cases=False, balise='nav')
        self.assertTrue(html.startswith('<nav class="szh-sommaire" id="szh-sommaire" '
                                        'aria-labelledby="szh-sommaire-titre">'), html)
        self.assertIn('<h1 id="szh-sommaire-titre">Inhalt</h1>', html)
        self.assertTrue(html.endswith('</nav>'))


class Assemblage(unittest.TestCase):
    def _assembler(self, *extra, meta='titre: "Buch"\nlang: de\nliminaires: [sommaire]\n'):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        chemin_meta = os.path.join(tmp, 'buch.yaml')
        with open(chemin_meta, 'w', encoding='utf-8') as f:
            f.write(meta)
        frags = []
        for slug in ('02-a', '04-b'):
            frags.append(os.path.join(tmp, slug + '.frag.html'))
            with open(frags[-1], 'w', encoding='utf-8') as f:
                f.write(_chapitre(slug, slug.upper(), _tableau()))
        sortie = os.path.join(tmp, 'sortie.html')
        meta_epub = os.path.join(tmp, 'epub.yaml')
        tampon, ancien = io.StringIO(), sys.stderr
        sys.stderr = tampon
        try:
            code = la.main(['x', '--meta', chemin_meta, '--gabarit',
                            os.path.join(PIPELINE, 'templates', 'szh-livre.html'),
                            '--sortie', sortie, '--out', tmp, '--metadonnees-epub', meta_epub,
                            *extra, *frags])
        finally:
            sys.stderr = ancien
        self.assertEqual(code, 0, tampon.getvalue())
        with open(sortie, encoding='utf-8') as f, open(meta_epub, encoding='utf-8') as g:
            return f.read(), g.read()

    def test_livre_assemble_sans_identifiant_en_double(self):
        html, _ = self._assembler()
        ids = re.findall(r'\sid="([^"]+)"', html)
        doubles = sorted({i for i in ids if ids.count(i) > 1})
        self.assertEqual(doubles, [])

    def test_web_main_et_nav(self):
        html, _ = self._assembler('--web')
        self.assertEqual(html.count('<main>'), 1)
        self.assertEqual(html.count('</main>'), 1)
        self.assertLess(html.index('<main>'), html.index('<nav class="szh-sommaire"'))
        self.assertLess(html.index('id="ch-04-b"'), html.index('</main>'))

    def test_pdf_sans_main_ni_nav(self):
        html, _ = self._assembler()
        self.assertNotIn('<main>', html)
        self.assertIn('<section class="szh-sommaire"', html)

    def test_metadonnees_epub_d_accessibilite(self):
        _, y = self._assembler()
        self.assertIn('toc-title: "Inhaltsverzeichnis"', y)
        self.assertIn('accessModes: [textual]', y)
        self.assertIn('longDescription', y)
        self.assertIn('accessibilityHazards: [none]', y)
        self.assertIn('accessibilitySummary: "Dieses EPUB', y)
        self.assertNotIn('conformsTo', y)

    def test_metadonnees_epub_avec_images(self):
        y = la.metadonnees_epub({'titre': 'T', 'lang': 'fr'}, images=True)
        self.assertIn('accessModes: [textual, visual]', y)
        self.assertIn('accessModeSufficient: [textual, "textual,visual"]', y)
        self.assertIn('alternativeText', y)
        self.assertIn('accessibilitySummary: "Cet EPUB', y)


class PreparationEpub(unittest.TestCase):
    def test_tableau_mis_de_cote_en_xhtml_bien_forme(self):
        b = la.prefixer_identifiants(_chapitre('04-b', 'B', _tableau()), '04-b')
        h = prep.prepare_for_epub(b)
        self.assertNotIn('<table', h)
        m = re.search(r'<div data-szh-brut="([^"]*)"></div>', h)
        self.assertTrue(m, h)
        import html as html_mod
        xhtml = html_mod.unescape(m.group(1))
        racine = ET.fromstring(xhtml)  # XML bien formé, ou exception
        self.assertEqual(racine.get('class'), 'szh-tableau-boite')
        # Un identifiant qui commence par un chiffre prend « id_ », comme chez pandoc, et
        # ses renvois le suivent.
        self.assertIn('id="id_04-b-szh-th-r2c0"', xhtml)
        self.assertIn('headers="id_04-b-szh-th-r0c1 id_04-b-szh-th-r1c0 id_04-b-szh-th-r2c0"',
                      xhtml)
        self.assertIn('id="id_04-b-szh-bloc-note-1"', xhtml)
        self.assertIn('<br />', xhtml)
        self.assertIn('Titel A', xhtml)

    def test_tableau_avec_image_laisse_a_pandoc(self):
        corps = _tableau().replace('Leer.', 'Leer. <img src="data:image/png;base64,AA" alt="x" />')
        h = prep.prepare_for_epub(_chapitre('c', 'C', corps))
        self.assertIn('<table', h)
        self.assertNotIn('data-szh-brut', h)

    def test_titre_de_chapitre_marque(self):
        h = prep.prepare_for_epub(_chapitre('02-a', 'A') + _chapitre('03-b', 'B', partie=1))
        self.assertIn('<h1 data-chapitre="02-a" id="02-a-titre">', h)
        self.assertIn('<h1 data-chapitre="03-b" data-partie="1" id="03-b-titre">', h)


# --------------------------------------------------------------------------------------
# livre-epub-finir.py, sur une archive écrite à la main dans la forme de pandoc.
# --------------------------------------------------------------------------------------
OPF = '''<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="i">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="i">x</dc:identifier>
    <dc:title id="epub-title-1">Buch</dc:title>
    <dc:language>de</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="cover_xhtml" href="text/cover.xhtml" media-type="application/xhtml+xml" properties="svg" />
    <item id="title_page_xhtml" href="text/title_page.xhtml" media-type="application/xhtml+xml" />
    <item id="ch001_xhtml" href="text/ch001.xhtml" media-type="application/xhtml+xml" />
    <item id="ch002_xhtml" href="text/ch002.xhtml" media-type="application/xhtml+xml" />
    <item id="ch003_xhtml" href="text/ch003.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="cover_xhtml" />
    <itemref idref="title_page_xhtml" />
    <itemref idref="ch001_xhtml" />
    <itemref idref="ch002_xhtml" />
    <itemref idref="ch003_xhtml" />
  </spine>
</package>
'''


def _doc(titre, corps):
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n'
            '<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">\n'
            '<head>\n  <title>%s</title>\n</head>\n<body>\n%s\n</body>\n</html>\n' % (titre, corps))


NAV = _doc('Buch', '<nav epub:type="toc" role="doc-toc" id="toc"><h1 id="toc-title">Inhalt</h1>'
           '<ol class="toc"><li id="toc-li-1"><a href="text/ch001.xhtml#partie-1-titre">Teil</a></li>'
           '<li id="toc-li-2"><a href="text/ch002.xhtml#id_02-a-titre">A</a><ol class="toc">'
           '<li id="toc-li-3"><a href="text/ch002.xhtml#id_02-a-x">X</a></li></ol></li>'
           '<li id="toc-li-4"><a href="text/ch003.xhtml#id_03-b-titre">B</a></li></ol></nav>\n'
           '<nav epub:type="landmarks" id="landmarks" hidden="hidden">\n  <ol>\n    <li>\n'
           '      <a href="text/title_page.xhtml" epub:type="titlepage">Title Page</a>\n    </li>\n'
           '    <li>\n      <a href="text/cover.xhtml" epub:type="cover">Cover</a>\n    </li>\n'
           '  </ol>\n</nav>')
NCX = ('<?xml version="1.0" encoding="UTF-8"?>\n<ncx version="2005-1" '
       'xmlns="http://www.daisy.org/z3986/2005/ncx/">\n<navMap>\n'
       '<navPoint id="navPoint-1"><navLabel><text>Teil</text></navLabel>'
       '<content src="text/ch001.xhtml#partie-1-titre" /></navPoint>\n'
       '<navPoint id="navPoint-2"><navLabel><text>A</text></navLabel>'
       '<content src="text/ch002.xhtml#id_02-a-titre" /></navPoint>\n'
       '<navPoint id="navPoint-3"><navLabel><text>B</text></navLabel>'
       '<content src="text/ch003.xhtml#id_03-b-titre" /></navPoint>\n'
       '</navMap>\n</ncx>\n')


class FinitionEpub(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        self.epub = os.path.join(tmp, 'b.epub')
        fichiers = [
            ('mimetype', 'application/epub+zip'),
            ('EPUB/content.opf', OPF),
            ('EPUB/nav.xhtml', NAV),
            ('EPUB/toc.ncx', NCX),
            ('EPUB/text/cover.xhtml', _doc('Buch', '<div id="cover-image"><svg xmlns="http://www.w3.org/2000/svg" '
                                          'viewBox="0 0 1 1"><image width="1" height="1" /></svg></div>')),
            ('EPUB/text/title_page.xhtml', _doc('Buch', '<section epub:type="titlepage"><h1 class="title">Buch</h1></section>')),
            ('EPUB/text/ch001.xhtml', _doc('ch001.xhtml', '<section id="partie-1-titre" class="level1">\n'
                                           '<h1>Teil</h1>\n</section>')),
            ('EPUB/text/ch002.xhtml', _doc('ch002.xhtml', '<section id="id_02-a-titre" class="level1" '
                                           'data-chapitre="02-a" data-partie="1">\n<h1 data-chapitre="02-a" '
                                           'data-partie="1">A &amp; <em>a</em></h1>\n</section>')),
            ('EPUB/text/ch003.xhtml', _doc('ch003.xhtml', '<section id="id_03-b-titre" class="level1" '
                                           'data-chapitre="03-b">\n<h1 data-chapitre="03-b">B</h1>\n</section>')),
        ]
        with zipfile.ZipFile(self.epub, 'w') as z:
            for nom, contenu in fichiers:
                z.writestr(nom, contenu, compress_type=zipfile.ZIP_STORED if nom == 'mimetype'
                           else zipfile.ZIP_DEFLATED)
        fin.finir(self.epub)
        self.z = zipfile.ZipFile(self.epub)
        self.addCleanup(self.z.close)

    def lire(self, nom):
        return self.z.read(nom).decode('utf-8')

    def test_archive_epub(self):
        infos = self.z.infolist()
        self.assertEqual(infos[0].filename, 'mimetype')
        self.assertEqual(infos[0].compress_type, zipfile.ZIP_STORED)

    def test_navigation_par_parties(self):
        nav = ET.fromstring(self.lire('EPUB/nav.xhtml'))
        toc = nav.find('.//%snav' % XHTML).find(XHTML + 'ol')
        hauts = toc.findall(XHTML + 'li')
        self.assertEqual([li.find(XHTML + 'a').get('href') for li in hauts],
                         ['text/ch001.xhtml#partie-1-titre', 'text/ch003.xhtml#id_03-b-titre'])
        sous = hauts[0].find(XHTML + 'ol').findall(XHTML + 'li')
        self.assertEqual([li.find(XHTML + 'a').get('href') for li in sous],
                         ['text/ch002.xhtml#id_02-a-titre'])
        # Le chapitre garde ses intertitres.
        self.assertEqual(len(sous[0].find(XHTML + 'ol').findall(XHTML + 'li')), 1)

    def test_ncx_par_parties(self):
        ncx = ET.fromstring(self.lire('EPUB/toc.ncx'))
        ns = '{http://www.daisy.org/z3986/2005/ncx/}'
        hauts = ncx.find(ns + 'navMap').findall(ns + 'navPoint')
        self.assertEqual([p.get('id') for p in hauts], ['navPoint-1', 'navPoint-3'])
        self.assertEqual([p.get('id') for p in hauts[0].findall(ns + 'navPoint')], ['navPoint-2'])

    def test_reperes_en_allemand(self):
        nav = self.lire('EPUB/nav.xhtml')
        self.assertIn('epub:type="cover">Umschlag</a>', nav)
        self.assertIn('epub:type="titlepage">Titelseite</a>', nav)
        self.assertIn('<a href="nav.xhtml#toc" epub:type="toc">Inhaltsverzeichnis</a>', nav)
        self.assertIn('<a href="text/ch002.xhtml#id_02-a-titre" epub:type="bodymatter">'
                      'Textbeginn</a>', nav)
        self.assertNotIn('Title Page', nav)

    def test_titres_des_documents(self):
        self.assertIn('<title>Teil</title>', self.lire('EPUB/text/ch001.xhtml'))
        self.assertIn('<title>A &amp; a</title>', self.lire('EPUB/text/ch002.xhtml'))

    def test_couverture_nommee(self):
        c = self.lire('EPUB/text/cover.xhtml')
        self.assertRegex(c, r'<svg [^>]*role="img" aria-label="Umschlag: Buch"><title>Umschlag: Buch</title>')
        ET.fromstring(c)


# Tableau complexe tel que l'éditeur du cockpit l'écrit dans tables/*.html : identifiants
# sans préfixe, description longue et note en attributs.
TABLEAU_EDITEUR = (
    '<table class="szh-tableau" data-entete-lignes="2" data-entete-colonnes="1" '
    'data-alt="Beschreibung." data-note="Notiz.">\n'
    '<caption>Titel</caption>\n<thead>\n<tr>\n'
    '<th id="szh-th-r0c0" scope="col" rowspan="2">X</th>\n'
    '<th id="szh-th-r0c1" scope="colgroup" colspan="2">2024</th>\n</tr>\n<tr>\n'
    '<th id="szh-th-r1c1" scope="col">F</th>\n<th id="szh-th-r1c2" scope="col">G</th>\n'
    '</tr>\n</thead>\n<tbody>\n<tr>\n<th id="szh-th-r2c0" scope="row">L1</th>\n'
    '<td headers="szh-th-r0c1 szh-th-r1c1 szh-th-r2c0">1</td>\n'
    '<td headers="szh-th-r0c1 szh-th-r1c2 szh-th-r2c0">2</td>\n'
    '</tr>\n</tbody>\n</table>\n')

RE_RENVOIS = re.compile(r'\s(?:headers|aria-describedby|aria-labelledby)="([^"]+)"')


def _verifier_tableaux(test, html, nb_boites):
    """Aucun id en double ; chaque headers=, aria-describedby et aria-labelledby d'une
    boîte de tableau vise un élément de cette même boîte ; chaque href="#…" a sa cible."""
    ids = re.findall(r'\sid="([^"]+)"', html)
    test.assertEqual(sorted({i for i in ids if ids.count(i) > 1}), [])
    for cible in re.findall(r'\shref="#([^"]+)"', html):
        test.assertIn(cible, ids)
    boites = html.split('<div class="szh-tableau-boite"')[1:]
    test.assertEqual(len(boites), nb_boites)
    for boite in boites:
        locaux = set(re.findall(r'\sid="([^"]+)"', boite))
        renvois = [r for liste in RE_RENVOIS.findall(boite) for r in liste.split()]
        test.assertTrue(renvois, boite)
        for r in renvois:
            test.assertIn(r, locaux, 'le renvoi %s sort de son tableau' % r)


class TableauxCompilesParChapitre(unittest.TestCase):
    """Deux chapitres, chacun avec deux tableaux complexes, compilés par les vrais filtres
    (rang du chapitre et du tableau dans les id), puis préfixés par le slug à l'assemblage :
    les id restent uniques et chaque renvoi reste dans son tableau, dans le HTML du PDF,
    le HTML web et l'EPUB."""

    CHAPITRES = (('02-a', 2), ('04-b', 4))

    def setUp(self):
        self.pandoc = shutil.which('pandoc')
        self.assertTrue(self.pandoc, 'pandoc introuvable')
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        md = ('---\nlang: de\n---\n\n```{=html}\n' + TABLEAU_EDITEUR + '```\n\nText.\n\n'
              '```{=html}\n' + TABLEAU_EDITEUR + '```\n')
        self.frags = []
        for slug, rang in self.CHAPITRES:
            env = dict(os.environ, SZH_LIVRE='1', SZH_CHAPITRE=str(rang))
            r = subprocess.run([self.pandoc, '--from=markdown', '--to=html5'] + [
                '--lua-filter=' + os.path.join(PIPELINE, 'filters', f)
                for f in ('szh-numerotation.lua', 'szh-tableau-boite.lua')],
                input=md, capture_output=True, text=True, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertIn('id="szh-c%d-t2-th-r0c1"' % rang, r.stdout)
            chemin = os.path.join(self.tmp, slug + '.frag.html')
            with open(chemin, 'w', encoding='utf-8') as f:
                f.write(_chapitre(slug, slug.upper(), r.stdout))
            self.frags.append(chemin)

    def _assembler(self, *extra):
        meta = os.path.join(self.tmp, 'buch.yaml')
        with open(meta, 'w', encoding='utf-8') as f:
            f.write('titre: "Buch"\nlang: de\nliminaires: [sommaire]\n')
        sortie = os.path.join(self.tmp, 'sortie.html')
        tampon, ancien = io.StringIO(), sys.stderr
        sys.stderr = tampon
        try:
            code = la.main(['x', '--meta', meta, '--gabarit',
                            os.path.join(PIPELINE, 'templates', 'szh-livre.html'),
                            '--sortie', sortie, '--out', self.tmp,
                            '--metadonnees-epub', os.path.join(self.tmp, 'epub.yaml'),
                            *extra, *self.frags])
        finally:
            sys.stderr = ancien
        self.assertEqual(code, 0, tampon.getvalue())
        with open(sortie, encoding='utf-8') as f:
            return f.read()

    def test_html_du_pdf(self):
        html = self._assembler()
        _verifier_tableaux(self, html, 4)
        self.assertIn('id="04-b-szh-c4-t2-th-r0c1"', html)
        self.assertIn('headers="04-b-szh-c4-t2-th-r0c1 04-b-szh-c4-t2-th-r1c1 '
                      '04-b-szh-c4-t2-th-r2c0"', html)

    def test_html_web(self):
        _verifier_tableaux(self, self._assembler('--web'), 4)

    def test_epub(self):
        corps = ''
        for (slug, _), chemin in zip(self.CHAPITRES, self.frags):
            with open(chemin, encoding='utf-8') as f:
                corps += la.prefixer_identifiants(f.read(), slug)
        entree = os.path.join(self.tmp, 'livre-epub.html')
        with open(entree, 'w', encoding='utf-8') as f:
            f.write(prep.prepare_for_epub(
                '<!DOCTYPE html><html lang="de"><head><title>Buch</title></head><body>\n'
                + corps + '</body></html>'))
        meta = os.path.join(self.tmp, 'meta.yaml')
        with open(meta, 'w', encoding='utf-8') as f:
            f.write(la.metadonnees_epub({'titre': 'Buch', 'lang': 'de'}, descriptions=True))
        epub = os.path.join(self.tmp, 'livre.epub')
        r = subprocess.run([self.pandoc, entree, '--from=html', '--to=epub3', '--split-level=1',
                            '--metadata-file=' + meta, '--lua-filter=' +
                            os.path.join(PIPELINE, 'filters', 'szh-livre-epub-brut.lua'),
                            '--output=' + epub], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        fin.finir(epub)
        with zipfile.ZipFile(epub) as z:
            textes = [z.read(n).decode('utf-8') for n in sorted(z.namelist())
                      if n.startswith('EPUB/text/ch')]
        # Un chapitre par document : les renvois se vérifient dans le sien, et les id
        # restent uniques sur tout le livre.
        ids = [i for t in textes for i in re.findall(r'\sid="([^"]+)"', t)]
        self.assertEqual(sorted({i for i in ids if ids.count(i) > 1}), [])
        nb = 0
        for t in textes:
            n = t.count('<div class="szh-tableau-boite"')
            if n:
                _verifier_tableaux(self, t, n)
                nb += n
        self.assertEqual(nb, 4)


class ChaineEpub(unittest.TestCase):
    """prepare, pandoc --to=epub3 avec szh-livre-epub-brut.lua, puis finir : la commande de
    profils/livre.mk, sur deux chapitres qui portent chacun un tableau complexe."""

    def test_tableau_complexe_intact_dans_l_epub(self):
        pandoc = shutil.which('pandoc')
        self.assertTrue(pandoc, 'pandoc introuvable')
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        a, b = (la.prefixer_identifiants(_chapitre(s, s.upper(), _tableau(), p), s)
                for s, p in (('02-a', None), ('04-b', 1)))
        html = ('<!DOCTYPE html><html lang="de"><head><title>Buch</title></head><body>\n' + a
                + '<section class="szh-partie" id="partie-1" data-page-seule="oui">\n'
                '<h1 id="partie-1-titre">Teil</h1>\n</section>\n' + b + '</body></html>')
        entree = os.path.join(tmp, 'livre-epub.html')
        with open(entree, 'w', encoding='utf-8') as f:
            f.write(prep.prepare_for_epub(html))
        meta = os.path.join(tmp, 'meta.yaml')
        with open(meta, 'w', encoding='utf-8') as f:
            f.write(la.metadonnees_epub({'titre': 'Buch', 'lang': 'de'}, descriptions=True))
        epub = os.path.join(tmp, 'livre.epub')
        r = subprocess.run([pandoc, entree, '--from=html', '--to=epub3', '--split-level=1',
                            '--metadata-file=' + meta, '--lua-filter=' +
                            os.path.join(PIPELINE, 'filters', 'szh-livre-epub-brut.lua'),
                            '--output=' + epub], capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        fin.finir(epub)
        r = subprocess.run([sys.executable, os.path.join(RACINE, 'test', 'epub-check.py'), epub],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        with zipfile.ZipFile(epub) as z:
            textes = [z.read(n).decode('utf-8') for n in z.namelist() if n.startswith('EPUB/text/ch')]
            opf = z.read('EPUB/content.opf').decode('utf-8')
        tout = '\n'.join(textes)
        self.assertEqual(tout.count('scope="row"'), 2)
        self.assertNotIn('<td scope', tout)
        self.assertIn('<p class="szh-bloc-note" id="id_04-b-szh-bloc-note-1">', tout)
        self.assertIn('aria-describedby="id_04-b-szh-tabelle-desc-1 id_04-b-szh-bloc-note-1"', tout)
        self.assertIn('<meta property="schema:accessibilitySummary">', opf)
        self.assertIn('<meta property="schema:accessibilityFeature">longDescription</meta>', opf)


if __name__ == '__main__':
    unittest.main()
