"""Balisage hors texte (CSS de Word, <style>, commentaires) retiré des descriptifs. Exemples fictifs, hors réseau."""
import shutil
import tempfile
import unittest

from recherche import db, propositions
from recherche.nettoyage import retirer_balisage
from recherche.sources import snf
from recherche.sources._commun import texte_paragraphes, texte_simple
from recherche.tests import outils
from recherche.tests.test_propositions import MAINTENANT, projet

TEXTE = "Le projet étudie l'inclusion à l'école. Une seconde phrase suit."

BLOC_WORD = ('@font-face {font-family:"Cambria Math"; panose-1:2 4 5 3 5 4 6 3 2 4; mso-font-charset:0; '
             'mso-font-pitch:variable;}@font-face {font-family:Calibri; panose-1:2 15 5 2 2 2 4 3 2 4;}'
             'p.MsoNormal, li.MsoNormal, div.MsoNormal {mso-style-unhide:no; margin:0cm; font-size:12.0pt; '
             'font-family:"Calibri",sans-serif;}p {mso-style-priority:99; margin-right:0cm;}'
             '.MsoChpDefault {mso-style-type:export-only; font-family:"Calibri",sans-serif;}'
             'div.WordSection1 {page:WordSection1;}@page WordSection1 {size:21.0cm 29.7cm; margin:70.85pt;}')

LEGITIMES = ("Soit l'ensemble {a, b, c} et la fonction f(x) = {x | x > 0}. Le modèle {Prévenir ; Enseigner} "
             "reste cité. Style : p {sans propriété} et {font: libre}. Une option {mso} ou {margin} seule. "
             "Le sigle MsoNormal n'est pas du CSS.")


class TestRetirerBalisage(unittest.TestCase):
    def test_complet_et_repete(self):
        brut = TEXTE + ' \xa0    ' + BLOC_WORD + '    ' + BLOC_WORD
        self.assertEqual(retirer_balisage(brut), TEXTE)

    def test_tronque_en_fin_de_texte(self):
        for coupe in ('div.WordSection1 {page:WordS', '@font-face {font-family:"Cambria Ma',
                      '@page WordSection1 {size:21.0cm', 'p.MsoNormal {mso-style-unhide:no; margin:0c', '@font-face'):
            with self.subTest(coupe=coupe):
                self.assertEqual(retirer_balisage(TEXTE + ' ' + BLOC_WORD + ' ' + coupe), TEXTE)

    def test_au_milieu_du_texte(self):
        self.assertEqual(retirer_balisage('Avant. ' + BLOC_WORD + ' Après.'), 'Avant. Après.')

    def test_style_script_commentaires(self):
        brut = ('Un <style type="text/css">p {color:red}</style>texte <script>alert(1)</script>propre '
                '<!--[if gte mso 9]><xml><w:WordDocument/></xml><![endif]-->et <!-- note --> fini.')
        self.assertEqual(retirer_balisage(brut), 'Un texte propre et fini.')

    def test_commentaire_non_ferme(self):
        self.assertEqual(retirer_balisage('Début. <!--[if gte mso 9]><xml>'), 'Début.')

    def test_paragraphes_gardes(self):
        brut = 'Premier.\n\n' + BLOC_WORD + '\n\nSecond.'
        self.assertEqual(retirer_balisage(brut).split(), ['Premier.', 'Second.'])
        self.assertIn('\n', retirer_balisage(brut).strip('Premier.Second'))

    def test_accolades_legitimes_intactes(self):
        self.assertEqual(retirer_balisage(LEGITIMES), LEGITIMES)
        self.assertEqual(retirer_balisage(LEGITIMES + ' ' + BLOC_WORD), LEGITIMES)

    def test_sans_balisage_texte_identique(self):
        for t in ('', TEXTE, 'a  b\xa0\xa0c ', '  espaces  de bord '):
            self.assertEqual(retirer_balisage(t), t)


class TestCablage(unittest.TestCase):
    def test_snf(self):
        ligne = {'LaySummary_Fr': TEXTE + ' \xa0   ' + BLOC_WORD}
        self.assertEqual(snf._descriptif(ligne, 'fr'), TEXTE)

    def test_extraction_html(self):
        page = '<p>' + TEXTE + '</p><style>p {margin:0cm}</style><p>Fin.</p>'
        self.assertEqual(texte_paragraphes(page), TEXTE + '\n\nFin.')
        self.assertEqual(texte_simple('<b>Un</b> <style>.a {color:red}</style>texte'), 'Un texte')

    def test_export_d_une_base_deja_souillee(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, ignore_errors=True)
        config = outils.config(tmp)
        con = db.connecter(config['base'])
        self.addCleanup(con.close)
        db.enregistrer(con, projet(descriptif=TEXTE + ' \xa0    ' + BLOC_WORD), 'nouveau', 'autis')
        con.commit()
        propositions.exporter(config, con, maintenant=MAINTENANT)
        [ligne] = outils.lire_lot(config['propositions'] + '/2026-10-04-1.jsonl')[1]
        self.assertEqual(ligne['valeurs']['descriptif'], TEXTE)
        self.assertEqual(ligne['brut']['descriptif'], TEXTE)


if __name__ == '__main__':
    unittest.main()
