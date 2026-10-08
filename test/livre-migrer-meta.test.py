#!/usr/bin/env python3
# Teste pipeline/livre-migrer-meta.py : le titre et les auteur·e·s d'un chapitre passent
# du .md à sa fiche <slug>.meta.yaml.
#
#   python3 test/livre-migrer-meta.test.py
#
# Un import qui échoue est une erreur, pas un test sauté.

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(RACINE, 'pipeline', 'livre-migrer-meta.py')
sys.path.insert(0, os.path.join(RACINE, 'pipeline'))
import szh_commun  # noqa: E402

_spec = importlib.util.spec_from_file_location('livre_migrer_meta', SCRIPT)
lm = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(lm)


class Banc(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def livre(self, locked=False, lang='fr'):
        with open(os.path.join(self.tmp, 'buch.yaml'), 'w', encoding='utf-8', newline='\n') as f:
            f.write('titre: "Banc"\nlang: %s\nouvrage: collectif\nlocked: %s\n'
                    % (lang, 'true' if locked else 'false'))

    def chapitre(self, slug, md, fiche=None, eol='\n'):
        d = os.path.join(self.tmp, 'chapitres', slug)
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, slug + '.md'), 'wb') as f:
            f.write(md.replace('\n', eol).encode('utf-8'))
        if fiche is not None:
            with open(os.path.join(d, slug + '.meta.yaml'), 'wb') as f:
                f.write(fiche.replace('\n', eol).encode('utf-8'))

    def md(self, slug):
        with open(os.path.join(self.tmp, 'chapitres', slug, slug + '.md'), 'rb') as f:
            return f.read().decode('utf-8')

    def fiche_texte(self, slug):
        with open(os.path.join(self.tmp, 'chapitres', slug, slug + '.meta.yaml'),
                  'rb') as f:
            return f.read().decode('utf-8')

    def fiche(self, slug):
        return szh_commun.lire_yaml(
            os.path.join(self.tmp, 'chapitres', slug, slug + '.meta.yaml'))

    def lancer(self, *args):
        return lm.migrer_livre(self.tmp, *args)


MD_A = '# Le titre\n\n::: {.szh-auteurs}\n%s\n:::\n\nUn paragraphe.\\\nDeuxième ligne.\n'


class Auteurs(Banc):
    def test_a_esperluette_b(self):
        self.livre()
        self.chapitre('c1', MD_A % 'Lena E. & Tabea Ullmann')
        code, _ = self.lancer()
        self.assertEqual(code, 0)
        a = self.fiche('c1')['author']
        self.assertEqual([(p['prenom'], p['nom']) for p in a],
                         [('Lena', 'E.'), ('Tabea', 'Ullmann')])
        self.assertEqual(self.fiche('c1')['title'], {'fr': 'Le titre'})
        # le .md ne garde que le corps, retours durs compris
        self.assertEqual(self.md('c1'), 'Un paragraphe.\\\nDeuxième ligne.\n')

    def test_a_virgule_b_et_c(self):
        self.livre()
        self.chapitre('c1', MD_A % 'Anne Martin, Paul Durand et Eva Roth')
        self.lancer()
        noms = [(p['prenom'], p['nom']) for p in self.fiche('c1')['author']]
        self.assertEqual(noms, [('Anne', 'Martin'), ('Paul', 'Durand'), ('Eva', 'Roth')])

    def test_a_und_b(self):
        self.livre(lang='de')
        self.chapitre('c1', MD_A % 'Anna Keller und Beat Meier')
        self.lancer()
        noms = [(p['prenom'], p['nom']) for p in self.fiche('c1')['author']]
        self.assertEqual(noms, [('Anna', 'Keller'), ('Beat', 'Meier')])
        self.assertEqual(self.fiche('c1')['title'], {'de': 'Le titre'})

    def test_a_e_b_italien(self):
        self.livre(lang='it')
        self.chapitre('c1', MD_A % 'Anna Rossi e Luca Bianchi')
        self.lancer()
        noms = [(p['prenom'], p['nom']) for p in self.fiche('c1')['author']]
        self.assertEqual(noms, [('Anna', 'Rossi'), ('Luca', 'Bianchi')])

    def test_auteurs_deja_en_fiche_identiques(self):
        self.livre()
        self.chapitre('c1', MD_A % 'Anne Martin',
                      'author:\n- prenom: "Anne"\n  nom: "Martin"\n')
        _, rapport = self.lancer()
        self.assertEqual(len(self.fiche('c1')['author']), 1)
        self.assertNotIn('szh-auteurs', self.md('c1'))
        self.assertTrue(any('identiques' in l for l in rapport))

    def test_auteurs_differents_jamais_ecrases(self):
        self.livre()
        self.chapitre('c1', MD_A % 'Anne Martin',
                      'author:\n- prenom: "Paul"\n  nom: "Durand"\n')
        _, rapport = self.lancer()
        self.assertEqual(self.fiche('c1')['author'][0]['nom'], 'Durand')
        self.assertIn('szh-auteurs', self.md('c1'))
        self.assertTrue(any('auteurs-conflit' in l for l in rapport))

    def test_author_vide_est_remplace(self):
        self.livre()
        self.chapitre('c1', MD_A % 'Anne Martin', 'lang: fr\nauthor: []\nsommaire: oui\n')
        self.lancer()
        f = self.fiche('c1')
        self.assertEqual(f['author'][0]['nom'], 'Martin')
        self.assertEqual(f['sommaire'], 'oui')

    def test_cle_auteurs_signalee(self):
        self.livre()
        self.chapitre('c1', 'Du texte.\n', 'auteurs:\n- prenom: "A"\n  nom: "B"\n')
        _, rapport = self.lancer()
        self.assertTrue(any('cle-auteurs' in l for l in rapport))


class Titre(Banc):
    def test_titre_deja_en_fiche_identique(self):
        self.livre()
        self.chapitre('c1', '# Le titre\n\nTexte.\n', 'lang: fr\ntitle:\n  fr: "Le titre"\n')
        self.lancer()
        self.assertEqual(self.md('c1'), 'Texte.\n')
        self.assertEqual(self.fiche_texte('c1'), 'lang: fr\ntitle:\n  fr: "Le titre"\n')

    def test_titre_different_jamais_ecrase(self):
        self.livre()
        self.chapitre('c1', '# Autre titre\n\nTexte.\n', 'title:\n  fr: "Le titre"\n')
        _, rapport = self.lancer()
        self.assertEqual(self.fiche('c1')['title']['fr'], 'Le titre')
        self.assertTrue(self.md('c1').startswith('# Autre titre'))
        self.assertTrue(any('titre-conflit' in l for l in rapport))

    def test_autre_langue_dans_title_est_completee(self):
        self.livre()
        self.chapitre('c1', '# Le titre\n\nTexte.\n', 'title:\n  de: "Der Titel"\nlang: fr\n')
        self.lancer()
        t = self.fiche('c1')['title']
        self.assertEqual(t, {'de': 'Der Titel', 'fr': 'Le titre'})
        self.assertEqual(self.fiche('c1')['lang'], 'fr')

    def test_fiche_absente_est_creee(self):
        self.livre()
        self.chapitre('c1', '# Le titre\n\nTexte.\n')
        self.lancer()
        self.assertEqual(self.fiche('c1')['title'], {'fr': 'Le titre'})

    def test_commentaires_de_la_fiche_gardes(self):
        self.livre()
        fiche = '# Fiche du chapitre\nlang: fr\n'
        self.chapitre('c1', '# Le titre\n\nTexte.\n', fiche)
        self.lancer()
        self.assertTrue(self.fiche_texte('c1').startswith(fiche))

    def test_guillemets_dans_le_titre(self):
        self.livre()
        self.chapitre('c1', '# Le « mot » "cité"\n\nTexte.\n')
        self.lancer()
        self.assertEqual(self.fiche('c1')['title']['fr'], 'Le « mot » "cité"')

    def test_titre_pas_en_tete_laisse(self):
        self.livre()
        self.chapitre('c1', 'Avant.\n\n# Titre\n\nTexte.\n')
        _, rapport = self.lancer()
        self.assertTrue(self.md('c1').startswith('Avant.'))
        self.assertTrue(any('titre-pas-en-tete' in l for l in rapport))

    def test_manuscrit_a_scinder_laisse(self):
        self.livre()
        brut = '# Un\n\nA.\n\n# Deux\n\nB.\n'
        self.chapitre('c1', brut)
        _, rapport = self.lancer()
        self.assertEqual(self.md('c1'), brut)
        self.assertTrue(any('scinder' in l for l in rapport))

    def test_code_ne_compte_pas_comme_titre(self):
        self.livre()
        self.chapitre('c1', '# Titre\n\n```\n# commentaire\n```\n')
        self.lancer()
        self.assertEqual(self.fiche('c1')['title']['fr'], 'Titre')
        self.assertIn('# commentaire', self.md('c1'))

    def test_fins_de_ligne_crlf_gardees(self):
        self.livre()
        self.chapitre('c1', '# Titre\n\nTexte.\n', 'lang: fr\n', eol='\r\n')
        self.lancer()
        self.assertEqual(self.md('c1'), 'Texte.\r\n')
        self.assertNotIn('\n', self.fiche_texte('c1').replace('\r\n', ''))


class Garde(Banc):
    def test_livre_verrouille_refuse(self):
        self.livre(locked=True)
        brut = '# Titre\n\nTexte.\n'
        self.chapitre('c1', brut)
        code, rapport = self.lancer()
        self.assertEqual(code, 1)
        self.assertEqual(self.md('c1'), brut)
        self.assertFalse(os.path.exists(
            os.path.join(self.tmp, 'chapitres', 'c1', 'c1.meta.yaml')))
        self.assertTrue(any('livre-verrouille' in l for l in rapport))

    def test_pas_un_livre(self):
        code, _ = self.lancer()
        self.assertEqual(code, 1)

    def test_simuler_n_ecrit_rien(self):
        self.livre()
        brut = MD_A % 'Anne Martin'
        self.chapitre('c1', brut)
        code, rapport = self.lancer(True)
        self.assertEqual(code, 0)
        self.assertEqual(self.md('c1'), brut)
        self.assertFalse(os.path.exists(
            os.path.join(self.tmp, 'chapitres', 'c1', 'c1.meta.yaml')))
        self.assertTrue(any('title.fr' in l for l in rapport))

    def test_idempotent(self):
        self.livre()
        self.chapitre('c1', MD_A % 'Anne Martin et Paul Durand')
        self.lancer()
        apres_md, apres_fiche = self.md('c1'), self.fiche_texte('c1')
        _, rapport = self.lancer()
        self.assertEqual(self.md('c1'), apres_md)
        self.assertEqual(self.fiche_texte('c1'), apres_fiche)
        self.assertTrue(any('rien à migrer' in l for l in rapport))

    def test_chapitre_prefixe_underscore_ignore(self):
        self.livre()
        self.chapitre('_piece', '# Titre\n\nTexte.\n')
        self.lancer()
        self.assertTrue(self.md('_piece').startswith('# Titre'))

    def test_option_chapitre(self):
        self.livre()
        self.chapitre('c1', '# Un\n\nA.\n')
        self.chapitre('c2', '# Deux\n\nB.\n')
        lm.migrer_livre(self.tmp, False, 'c2')
        self.assertTrue(self.md('c1').startswith('# Un'))
        self.assertEqual(self.fiche('c2')['title']['fr'], 'Deux')

    def test_ligne_de_commande(self):
        self.livre()
        self.chapitre('c1', '# Un\n\nA.\n')
        r = subprocess.run([sys.executable, SCRIPT, self.tmp, '--simuler'],
                           capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('title.fr', r.stdout)


class Scission(Banc):
    """livre-scinder.py écrit la fiche de chaque morceau au lieu de « # Titre » dans le .md."""

    def test_scinder_range_titre_et_auteurs_en_fiche(self):
        self.livre()
        self.chapitre('ms',
                      '# Premier\n\n::: {.szh-auteurs}\nAnne Martin et Paul Durand\n:::\n\n'
                      'Texte un.\n\n# Second\n\nTexte deux.\n')
        r = subprocess.run([sys.executable,
                            os.path.join(RACINE, 'pipeline', 'livre-scinder.py'),
                            self.tmp, 'ms'],
                           capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(self.fiche('01-premier')['title'], {'fr': 'Premier'})
        self.assertEqual([p['nom'] for p in self.fiche('01-premier')['author']],
                         ['Martin', 'Durand'])
        self.assertEqual(self.md('01-premier').replace('\r\n', '\n'), 'Texte un.\n')
        self.assertEqual(self.fiche('02-second')['title'], {'fr': 'Second'})
        self.assertEqual(self.md('02-second').replace('\r\n', '\n'), 'Texte deux.\n')


if __name__ == '__main__':
    unittest.main()
