#!/usr/bin/env python3
# test/livre-assembler.test.py — deux mécanismes du chapitre 4 (« sommaire: non ») :
#
#   1. la lecture de `sommaire: non` / `false` dans un <slug>.meta.yaml, par
#      szh-lire-config.lua, le lecteur que pipeline/profils/livre.mk appelle
#      (CHAPITRES_HORS_SOMMAIRE) — le test vérifie aussi que livre.mk l'appelle bien ;
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
CHEMIN_FILTRES_MK = os.path.join(RACINE, 'pipeline', 'filtres.mk')
CHEMIN_LIRE_CONFIG =os.path.join(RACINE, 'pipeline', 'filters', 'szh-lire-config.lua')

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
    """CHAPITRES_HORS_SOMMAIRE (livre.mk) lit la clé par szh-lire-config.lua : le test
    vérifie que livre.mk passe bien par ce lecteur, avec cette clé et ces valeurs, puis
    fait lire chaque fiche par le même script."""

    @classmethod
    def setUpClass(cls):
        with open(CHEMIN_LIVRE_MK, encoding='utf-8') as f:
            texte = f.read()
        m = re.search(r'^CHAPITRES_HORS_SOMMAIRE :=(.*?)\n\S', texte, re.M | re.S)
        if not m:
            raise AssertionError('CHAPITRES_HORS_SOMMAIRE est introuvable dans livre.mk')
        regle = m.group(1)
        if not re.search(r'\$\(filter non false,.*\$\(PANDOC\) lua \$\(LIRE_CONFIG\)\s*\\?\s*'
                         r'\$\(CH_DIR\)/\$\(c\)/\$\(c\)\.meta\.yaml sommaire', regle, re.S):
            raise AssertionError(
                "CHAPITRES_HORS_SOMMAIRE ne lit plus `sommaire` par szh-lire-config.lua, "
                "ou ne retient plus « non » et « false » — ce test ne suit plus livre.mk")
        if not shutil.which('pandoc'):
            raise unittest.SkipTest('pandoc introuvable sur ce poste (attendu sous WSL)')

    def _lu(self, contenu):
        with tempfile.NamedTemporaryFile('w', suffix='.meta.yaml', delete=False,
                                          encoding='utf-8') as f:
            f.write(contenu)
            chemin = f.name
        try:
            r = subprocess.run(['pandoc', 'lua', CHEMIN_LIRE_CONFIG, chemin, 'sommaire'],
                               capture_output=True, text=True)
            return r.stdout.strip() or None
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

    def test_le_lien_n_est_jamais_enfant_direct_du_li(self):
        # Le <li> du sommaire FALC est un flex : un <a> qui en est l'enfant direct n'a
        # aucune annotation /Link dans le PDF (WeasyPrint 70).
        entrees = [(1, 'c1', '1 Premier', '#111111', '20.000mm')]
        html = la.sommaire_html(entrees, 'Sommaire')
        self.assertNotRegex(html, r'<li\b[^>]*><a\b')
        self.assertIn('<li class="niveau-1" style="--c-chapitre: #111111">'
                      '<span><a href="#c1">1 Premier</a></span></li>', html)

    def test_entree_sans_onglet_hauteur_aucun_style_sur_la_section(self):
        entrees = [(1, 'c1', 'Un titre', '#111111', None)]
        html = la.sommaire_html(entrees, 'Sommaire')
        self.assertIn('<section class="szh-sommaire" id="szh-sommaire">', html)


class ChapitreSeul(unittest.TestCase):
    """--sans-liminaires : le chapitre seul de `make livre-chapitre-pdf`."""

    def _assembler(self, *extra):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        meta = os.path.join(tmp, 'buch.yaml')
        with open(meta, 'w', encoding='utf-8') as f:
            f.write('titre: "Le livre"\nlang: de\nliminaires: [demi-titre, page-titre, sommaire]\n')
        frag = os.path.join(tmp, 'c.frag.html')
        with open(frag, 'w', encoding='utf-8') as f:
            f.write(_fragment('c', 'Teilhabe', rang=2, numero=2))
        sortie = os.path.join(tmp, 'sortie.html')
        gabarit = os.path.join(RACINE, 'pipeline', 'templates', 'szh-livre.html')
        tampon = io.StringIO()
        ancien = sys.stderr
        sys.stderr = tampon
        try:
            code = la.main(['x', '--meta', meta, '--gabarit', gabarit, '--sortie', sortie,
                            '--out', tmp, *extra, frag])
        finally:
            sys.stderr = ancien
        self.assertEqual(code, 0, tampon.getvalue())
        with open(sortie, encoding='utf-8') as f:
            return f.read()

    def test_livre_complet_garde_ses_liminaires(self):
        html = self._assembler()
        self.assertIn('szh-sommaire', html)
        self.assertIn('szh-page-titre', html)

    def test_chapitre_seul_sans_liminaires_ni_sommaire(self):
        html = self._assembler('--sans-liminaires')
        self.assertNotIn('szh-sommaire', html)
        self.assertNotIn('szh-page-titre', html)
        self.assertNotIn('szh-demi-titre', html)
        self.assertIn('<section class="szh-chapitre" id="ch-c"', html)

    def test_chapitre_seul_titre_du_document(self):
        html = self._assembler('--sans-liminaires')
        self.assertIn('<title>2 Teilhabe — Le livre</title>', html)


class ChaineDeFiltres(unittest.TestCase):
    """filtres.mk : le titre et le sous-titre viennent de la fiche, dans le bon ordre. La
    chaîne est celle que make développe, lue par make lui-même."""

    def setUp(self):
        if not shutil.which('make'):
            raise unittest.SkipTest('make introuvable sur ce poste (attendu sous WSL)')
        r = subprocess.run(['make', '-s', '-f', CHEMIN_FILTRES_MK, 'PIPELINE_DIR=/P', '--eval',
                            'montrer: ; @echo $(CHAINE_CHAPITRE)', 'montrer'],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.ordre = ['szh-' + f for f in r.stdout.split()]

    def test_titre_en_tete(self):
        # szh-contexte ouvre toute chaîne ; le titre vient aussitôt après, avant tout le reste.
        self.assertEqual(self.ordre[0], 'szh-contexte')
        self.assertEqual(self.ordre[1], 'szh-livre-titre')

    def test_sous_titre_apres_auteurs_et_encadre(self):
        o = self.ordre
        self.assertGreater(len(o) - 1 - o[::-1].index('szh-livre-sous-titre'), o.index('szh-livre-entete'))
        self.assertGreater(o.index('szh-livre-entete'), o.index('szh-livre-auteurs'))
        self.assertGreater(o.index('szh-livre-auteurs'), o.index('szh-sections'))


class SautDeLigneDansLeTitre(unittest.TestCase):
    """« // » dans un titre : <br> là où le titre se compose en bloc, espace ailleurs."""

    META = {'titre': 'La CDPH // en <Suisse>', 'sous-titre': 'Un // deux // trois',
            'auteurs': [], 'lang': 'fr'}

    def test_page_et_demi_titre_en_lignes(self):
        for composer in (la.page_titre, la.demi_titre):
            h = composer(self.META, 'fr')
            self.assertIn('<p class="szh-titre">La CDPH<br>en &lt;Suisse&gt;</p>', h)
            self.assertIn('<p class="szh-sous-titre">Un<br>deux<br>trois</p>', h)

    def test_demi_titre_normal_titre_d_un_trait(self):
        # Maquette normal : le « // » du titre vaut pour la page de titre seule ; le
        # sous-titre se coupe au même endroit sur les deux pages.
        h = la.demi_titre(self.META, 'fr', normal=True)
        self.assertIn('<p class="szh-titre">La CDPH en &lt;Suisse&gt;</p>', h)
        self.assertIn('<p class="szh-sous-titre">Un<br>deux<br>trois</p>', h)
        p = la.page_titre(self.META, 'fr', normal=True)
        self.assertIn('<p class="szh-titre">La CDPH<br>en &lt;Suisse&gt;</p>', p)
        self.assertIn('<p class="szh-sous-titre">Un<br>deux<br>trois</p>', p)

    def test_titre_sans_saut_inchange(self):
        h = la.page_titre({'titre': 'A & B', 'sous-titre': ''}, 'fr')
        self.assertIn('<p class="szh-titre">A &amp; B</p>', h)

    def test_metadonnees_epub_a_plat(self):
        y = la.metadonnees_epub(self.META)
        self.assertIn('title: "La CDPH en <Suisse>"', y)
        self.assertIn('subtitle: "Un deux trois"', y)
        self.assertNotIn('//', y)

    def test_sommaire_lit_le_br_comme_une_espace(self):
        frag = _fragment('c', 'Titre<br />\nsuite<br>fin', rang=1, numero=1)
        self.assertEqual(la.titres_du_fragment(frag)[0][2], '1 Titre suite fin')

    def test_filtres_lua(self):
        pandoc = shutil.which('pandoc')
        self.assertTrue(pandoc, 'pandoc introuvable')
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        fiche = os.path.join(tmp, 'c.meta.yaml')
        with open(fiche, 'w', encoding='utf-8') as f:
            f.write('lang: fr\nslug: c\ntitle:\n  fr: "Un titre // sur deux lignes"\n'
                    'subtitle:\n  fr: "Sous // titre & co"\n')
        entree = os.path.join(tmp, 'c.md')
        with open(entree, 'w', encoding='utf-8') as f:
            f.write('Texte.\n')
        env = dict(os.environ, SZH_LIVRE='1', SZH_CHAPITRE='1')
        filtres = [os.path.join(RACINE, 'pipeline', 'filters', n)
                   for n in ('szh-livre-titre.lua', 'szh-livre-sous-titre.lua',
                             'szh-typographie.lua', 'szh-livre-sous-titre.lua')]
        cmd = [pandoc, entree, '-f', 'markdown', '-t', 'html', '--metadata-file', fiche]
        for fl in filtres:
            cmd += ['--lua-filter', fl]
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(r.returncode, 0, r.stderr)
        sortie = r.stdout
        self.assertRegex(sortie, r'<h1 id="un-titre-sur-deux-lignes">Un.titre<br\s*/>\s*sur.deux lignes</h1>')
        self.assertIn('<p class="szh-sous-titre">Sous<br>titre &amp; co</p>', sortie)
        self.assertNotIn('//', sortie)
        self.assertNotIn('SZHSAUTLIGNE', sortie)
        # La même fiche sans « // » : un seul bloc, pas de <br>.
        with open(fiche, 'w', encoding='utf-8') as f:
            f.write('lang: fr\nslug: c\ntitle:\n  fr: "Un titre"\n')
        r = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding='utf-8')
        self.assertRegex(r.stdout, r'<h1 id="un-titre">Un.titre</h1>')
        # Le sous-titre reçoit la typographie maison : fr, insécable avant « ? » ; de, l'espace est retirée.
        for lang, attendu in (('fr', '\u00a0?'), ('de', '?')):
            with open(fiche, 'w', encoding='utf-8') as f:
                f.write('lang: %s\nslug: c\ntitle:\n  %s: "T"\nsubtitle:\n  %s: "Que faut-il ?"\n'
                        % (lang, lang, lang))
            r = subprocess.run(cmd, env=env, capture_output=True, text=True, encoding='utf-8')
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertRegex(r.stdout, r'<p class="szh-sous-titre">[^<]*il' + re.escape(attendu) +'</p>')
            self.assertNotIn('szh-sous-titre-attente', r.stdout)


class BadgeDeLicence(unittest.TestCase):
    """Une licence connue de LICENCES sans bouton livré dans media/logos est refusée."""

    def test_chaque_licence_a_son_badge(self):
        for cle in la.LICENCES:
            self.assertEqual(la.verifier_impressum({'licence': cle}, RACINE), [], cle)

    def test_licence_sans_badge_refusee(self):
        la.LICENCES['cc-essai-9.9'] = 'Creative Commons CC ESSAI 9.9 International'
        self.addCleanup(la.LICENCES.pop, 'cc-essai-9.9')
        erreurs = la.verifier_impressum({'licence': 'cc-essai-9.9'}, RACINE)
        self.assertEqual(len(erreurs), 1, erreurs)
        champs = erreurs[0].split(' | ')
        self.assertEqual(champs[:2], ['[livre-blocage] licence-badge-absent', 'licence'])
        self.assertIn('cc-essai-9.9', champs[2])
        self.assertTrue(champs[3].startswith('[de] ') and 'cc-essai-9.9' in champs[3], erreurs[0])

    def test_licence_inconnue_sans_refus(self):
        self.assertEqual(la.verifier_impressum({'licence': 'cc-by-99'}, RACINE), [])


class ActeDeLicence(unittest.TestCase):
    """Le badge mène à l'acte de la licence, dont la phrase imprime l'adresse."""

    def test_chaque_licence_a_son_acte(self):
        self.assertEqual(sorted(la.ACTES_LICENCE), sorted(la.LICENCES))

    def test_lien_vide_vers_l_acte_et_adresse_dans_la_phrase(self):
        for lang, label in (('fr', 'Résumé de la licence'), ('de', 'Zusammenfassung der Lizenz'),
                            ('it', 'Riassunto della licenza')):
            for cle, adresse in la.ACTES_LICENCE.items():
                s = la.impressum({'lang': lang, 'licence': cle}, RACINE, normal=True)
                self.assertIn('<a class="szh-impressum-badge" href="https://%s/" aria-label="%s %s" '
                              % (adresse, label, la.LICENCES[cle]), s)
                self.assertRegex(s, r'<p class="szh-impressum-licence"><a [^>]*></a></p>')
                self.assertIn(' (%s).</p>' % adresse, s)
                self.assertNotIn('https://%s)' % adresse, s)
                falc = la.impressum({'lang': lang, 'licence': cle}, RACINE)
                self.assertIn(' (%s).</p>' % adresse, falc)
                self.assertNotIn('<a ', falc)


if __name__ == '__main__':
    unittest.main()
