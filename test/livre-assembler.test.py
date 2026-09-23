#!/usr/bin/env python3
# test/livre-assembler.test.py — deux mécanismes du chapitre 4 (« sommaire: non ») :
#
#   1. la lecture de `sommaire: non` / `false` dans un <slug>.meta.yaml, exactement le
#      motif sed que pipeline/profils/livre.mk applique (CHAPITRES_HORS_SOMMAIRE) — extrait
#      du Makefile ici, pas recopié à la main, pour ne jamais dériver de lui en silence ;
#   2. pipeline/livre-assembler.py : extraction (couleur, hauteur de case, numéro de
#      sommaire, retrait), le remplacement du numéro périmé (szh-num-section, posé par
#      SZH_CHAPITRE = le rang) par le numéro DU SOMMAIRE dans le h1 d'un chapitre, et
#      l'avertissement de case trop étroite.
#
#   python3 test/livre-assembler.test.py
#
# ⚠ Comme test/liens-courts.test.py : aucun test ne s'abstient. Un import qui échoue est
#   une ERREUR de collecte, jamais un succès silencieux.

import importlib.util
import io
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEMIN_ASSEMBLEUR = os.path.join(RACINE, 'pipeline', 'livre-assembler.py')
CHEMIN_LIVRE_MK = os.path.join(RACINE, 'pipeline', 'profils', 'livre.mk')

_spec = importlib.util.spec_from_file_location('livre_assembler', CHEMIN_ASSEMBLEUR)
la = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(la)


def _fragment(slug, niveau1_titre, rang=4, numero=None, couleur='#949A00',
              onglet_hauteur='22.857mm', hors_sommaire=False, h2_titre=None):
    """Un fragment de chapitre minimal, dans la forme exacte que szh-livre-chapitre.html
    écrit : la <section> porte --c-chapitre/--onglet-haut/--onglet-hauteur en style, et
    data-sommaire="non" pour un chapitre retiré ; le h1 porte le span szh-num-section que
    szh-sections.lua pose à partir du RANG (SZH_CHAPITRE), pas du numéro de sommaire —
    c'est tout l'écart que ce test vérifie."""
    style = '--c-chapitre: %s;' % couleur
    if not hors_sommaire:
        style += ' --onglet-haut: 30mm; --onglet-hauteur: %s;' % onglet_hauteur
    attrs = ' data-sommaire="non"' if hors_sommaire else ''
    pastille = str(numero) if numero is not None else ''
    h2 = ''
    if h2_titre:
        h2 = '<h2 id="%s-sous">%s</h2>' % (slug, h2_titre)
    return (
        '<section class="szh-chapitre" id="ch-%s" style="%s"%s data-rang="%d">'
        '<div class="szh-onglet" aria-hidden="true"></div>'
        '<div class="szh-pastille" aria-hidden="true">%s</div>'
        '<div class="szh-picto-entete" data-picto="" aria-hidden="true"></div>'
        '<h1 id="%s"><span class="szh-num-section">%d </span>%s</h1>'
        '%s'
        '</section>'
    ) % (slug, style, attrs, rang, pastille, slug, rang, niveau1_titre, h2)


class LectureSommaireMeta(unittest.TestCase):
    """Le motif sed de CHAPITRES_HORS_SOMMAIRE (livre.mk), extrait du fichier — pas
    recopié à la main, pour ne jamais dériver de lui en silence."""

    @classmethod
    def setUpClass(cls):
        with open(CHEMIN_LIVRE_MK, encoding='utf-8') as f:
            texte = f.read()
        # Le motif contient lui-même un guillemet échappé (`[\"']*`) : s'arrêter au
        # premier `"` rencontré (regex naïve) le tronquerait là. La suite `/\1/p` est le
        # seul endroit où le motif sed se termine réellement — bornage sans ambiguïté.
        m = re.search(r'sed -n "(s/\^\[\[:space:]]\*sommaire:.*?/\\1/p)"', texte)
        if not m:
            raise AssertionError(
                "le motif sed de CHAPITRES_HORS_SOMMAIRE est introuvable dans livre.mk — "
                "a-t-il changé de forme sans que ce test ne suive ?")
        cls.motif = m.group(1)
        if not shutil.which('sed'):
            raise unittest.SkipTest('sed introuvable sur ce poste (attendu sous WSL)')

    def _lu(self, contenu):
        # Le motif, tel qu'extrait, porte les échappements du SHELL du Makefile
        # (`\"` pour un guillemet littéral à l'intérieur de la chaîne entre doubles
        # guillemets) : il ne prend son sens qu'une fois repassé par un shell, exactement
        # comme make le fait pour lancer sa recette. Un appel direct à sed (liste argv,
        # sans shell) recevrait le `\` lui-même comme caractère de la classe — un défaut
        # de CE test, pas du motif : mesuré, `sed: unknown option to 's'`.
        with tempfile.NamedTemporaryFile('w', suffix='.meta.yaml', delete=False,
                                          encoding='utf-8') as f:
            f.write(contenu)
            chemin = f.name
        try:
            cmd = 'sed -n "%s" %s' % (self.motif, shlex.quote(chemin))
            r = subprocess.run(['sh', '-c', cmd], capture_output=True, text=True)
            lignes = [l for l in r.stdout.splitlines() if l]
            return lignes[0] if lignes else None
        finally:
            os.unlink(chemin)

    def _hors_sommaire(self, contenu):
        return self._lu(contenu) in ('non', 'false')

    def test_ligne_nue(self):
        self.assertTrue(self._hors_sommaire('sommaire: non\n'))

    def test_false(self):
        self.assertTrue(self._hors_sommaire('sommaire: false\n'))

    def test_guillemets_doubles(self):
        self.assertTrue(self._hors_sommaire('sommaire: "non"\n'))

    def test_guillemets_simples(self):
        self.assertTrue(self._hors_sommaire("sommaire: 'non'\n"))

    def test_commentaire_en_fin_de_ligne(self):
        self.assertTrue(self._hors_sommaire('sommaire: non  # provisoire\n'))

    def test_guillemets_et_commentaire(self):
        self.assertTrue(self._hors_sommaire('sommaire: "non"  # à revoir\n'))

    def test_indentation(self):
        self.assertTrue(self._hors_sommaire('  sommaire: non\n'))

    def test_valeur_oui_reste_au_sommaire(self):
        self.assertFalse(self._hors_sommaire('sommaire: oui\n'))

    def test_cle_absente_reste_au_sommaire(self):
        self.assertFalse(self._hors_sommaire(
            'lang: fr\ntitle:\n  fr: "Un chapitre"\n'))

    def test_fichier_vide_reste_au_sommaire(self):
        self.assertFalse(self._hors_sommaire(''))

    def test_autre_cle_nommee_sommaire_partiellement(self):
        # Une clé voisine ne doit pas matcher par accident.
        self.assertFalse(self._hors_sommaire('sommaire-alt: non\n'))


class ExtractionFragment(unittest.TestCase):
    def test_couleur(self):
        frag = _fragment('c', 'Titre', couleur='#4D869F')
        self.assertEqual(la.couleur_du_fragment(frag), '#4D869F')

    def test_onglet_hauteur(self):
        frag = _fragment('c', 'Titre', onglet_hauteur='16.000mm')
        self.assertEqual(la.onglet_hauteur_du_fragment(frag), '16.000mm')

    def test_onglet_hauteur_absente_hors_sommaire(self):
        frag = _fragment('c', 'Titre', hors_sommaire=True)
        self.assertIsNone(la.onglet_hauteur_du_fragment(frag))

    def test_numero_chapitre(self):
        frag = _fragment('c', 'Titre', numero=3)
        self.assertEqual(la.numero_chapitre_du_fragment(frag), '3')

    def test_numero_chapitre_absent_hors_sommaire(self):
        frag = _fragment('c', 'Titre', hors_sommaire=True)
        self.assertIsNone(la.numero_chapitre_du_fragment(frag))

    def test_hors_sommaire_detecte(self):
        self.assertTrue(la.hors_sommaire(_fragment('c', 'Titre', hors_sommaire=True)))
        self.assertFalse(la.hors_sommaire(_fragment('c', 'Titre', numero=1)))


class TitresDuFragment(unittest.TestCase):
    def test_chapitre_hors_sommaire_ne_rend_aucune_entree(self):
        frag = _fragment('c', 'Impressum', hors_sommaire=True, h2_titre='Sous-titre')
        self.assertEqual(la.titres_du_fragment(frag), [])

    def test_h1_reprend_le_numero_du_sommaire_pas_le_rang(self):
        # rang=4 (SZH_CHAPITRE, dans le span szh-num-section) mais numero=1 (devenu 1er
        # chapitre du sommaire après retrait des trois précédents) : le texte de
        # l'entrée doit dire « 1 », jamais « 4 ».
        frag = _fragment('c', 'Mit Mut und Zielstrebigkeit', rang=4, numero=1)
        entrees = la.titres_du_fragment(frag)
        self.assertEqual(len(entrees), 1)
        niveau, ancre, txt, couleur, onglet_h = entrees[0]
        self.assertEqual(niveau, 1)
        self.assertEqual(txt, '1 Mit Mut und Zielstrebigkeit')

    def test_h2_garde_sa_propre_numerotation_de_section(self):
        # Un sous-titre (h2) n'a pas de --numero-chapitre : son szh-num-section (numéro
        # de SECTION, pas de chapitre) doit traverser tel quel, comme avant ce chantier.
        frag = _fragment('c', 'Titre', rang=4, numero=1, h2_titre=
                          '<span class="szh-num-section">1.1 </span>Sous-partie')
        entrees = la.titres_du_fragment(frag)
        self.assertEqual(len(entrees), 2)
        h2 = [e for e in entrees if e[0] == 2][0]
        self.assertEqual(h2[2], '1.1 Sous-partie')

    def test_sans_numero_le_h1_garde_son_szh_num_section_tel_quel(self):
        # Maquette/scénario sans métadonnée numero-chapitre (ex. un fragment isolé, hors
        # chaîne) : comportement d'avant ce chantier, rien ne casse.
        frag = _fragment('c', 'Titre', rang=2, numero=None)
        entrees = la.titres_du_fragment(frag)
        self.assertEqual(entrees[0][2], '2 Titre')

    def test_couleur_et_hauteur_partagees_par_toutes_les_entrees(self):
        frag = _fragment('c', 'Titre', numero=5, couleur='#AE3E35',
                          onglet_hauteur='24.000mm', h2_titre='Sous-titre')
        entrees = la.titres_du_fragment(frag)
        for _n, _a, _t, couleur, onglet_h in entrees:
            self.assertEqual(couleur, '#AE3E35')
            self.assertEqual(onglet_h, '24.000mm')


class AvertissementCaseEtroite(unittest.TestCase):
    """verifier_hauteur_sommaire : n'écrit rien qui ne soit vérifiable — capture stderr
    plutôt que de supposer un format, et vérifie le code d'avertissement du dépôt."""

    def _avertissements(self, entrees):
        capture = io.StringIO()
        ancien = sys.stderr
        sys.stderr = capture
        try:
            la.verifier_hauteur_sommaire(entrees)
        finally:
            sys.stderr = ancien
        return [l for l in capture.getvalue().splitlines() if l.strip()]

    def test_case_confortable_aucun_avertissement(self):
        entrees = [(1, 'a', '1 Un titre court', '#000', '80.000mm')]
        self.assertEqual(self._avertissements(entrees), [])

    def test_case_trop_petite_meme_pour_une_ligne(self):
        entrees = [(1, 'a', '1 X', '#000', '10.000mm')]
        av = self._avertissements(entrees)
        self.assertEqual(len(av), 1)
        self.assertIn('[livre-avertissement]', av[0])
        self.assertIn('onglet-case-etroite', av[0])

    def test_titre_long_sous_le_seuil_deux_lignes_avertit(self):
        titre = '1 ' + 'x' * 50  # > SEUIL_RISQUE_DEUX_LIGNES caractères
        entrees = [(1, 'a', titre, '#000', '20.000mm')]
        av = self._avertissements(entrees)
        self.assertEqual(len(av), 1)

    def test_titre_court_sous_24mm_aucun_avertissement(self):
        entrees = [(1, 'a', '1 Court', '#000', '20.000mm')]
        self.assertEqual(self._avertissements(entrees), [])

    def test_h2_h3_jamais_verifies(self):
        entrees = [(2, 'a', 'x' * 80, '#000', '5.000mm')]
        self.assertEqual(self._avertissements(entrees), [])

    def test_sans_onglet_hauteur_ignore(self):
        entrees = [(1, 'a', 'x' * 80, '#000', None)]
        self.assertEqual(self._avertissements(entrees), [])


class SommaireHtml(unittest.TestCase):
    def test_onglet_hauteur_posee_une_fois_sur_la_section(self):
        entrees = [(1, 'c1', '1 Premier', '#111111', '20.000mm'),
                   (1, 'c2', '2 Second', '#222222', '20.000mm')]
        html = la.sommaire_html(entrees, 'Sommaire')
        self.assertIn('<section class="szh-sommaire" id="szh-sommaire"'
                       ' style="--onglet-hauteur: 20.000mm">', html)
        # --onglet-hauteur : une seule fois (sur la section), jamais répétée par <li>.
        self.assertEqual(html.count('--onglet-hauteur'), 1)

    def test_chaque_li_porte_sa_propre_couleur(self):
        entrees = [(1, 'c1', '1 Premier', '#111111', '20.000mm')]
        html = la.sommaire_html(entrees, 'Sommaire')
        self.assertIn('style="--c-chapitre: #111111"', html)

    def test_entree_sans_onglet_hauteur_aucun_style_sur_la_section(self):
        entrees = [(1, 'c1', 'Un titre', '#111111', None)]
        html = la.sommaire_html(entrees, 'Sommaire')
        self.assertIn('<section class="szh-sommaire" id="szh-sommaire">', html)


if __name__ == '__main__':
    unittest.main()
