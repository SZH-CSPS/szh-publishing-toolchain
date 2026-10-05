"""Rendu des événements dans un terminal, avec et sans TTY."""
import io
import os
import subprocess
import sys
import unittest

import console
import evenements as ev
from tests import outils

FIXTURE = os.path.join(outils.ICI, 'fixtures', 'passe-exemple.jsonl')


class Flux(io.StringIO):
    def __init__(self, tty):
        super().__init__()
        self._tty = tty

    def isatty(self):
        return self._tty


def passe():
    return [
        ev.debut(['parlement'], {'parlement': {'requetes': 800, 'delai_s': 2.0, 'budget': 800}}, 'cli',
                 '2026-11-01T06:00:00Z', {'parlement': {'budget': 800, 'marge': 50, 'somme': 0, 'plafond': 750}},
                 False),
        ev.etape('parlement', 'GE', 100, 800, 1400, 0.125),
        ev.etape('parlement', 'GE', 412, 800, 360, 0.515),
        ev.etape('parlement', 'BE', 500, 800, 300, 0.625),
        ev.avertissement('parlement', 'corps VD en échec (HTTPError: 500)'),
        ev.lot('parlement', 'parlement/2026-11-01-1.jsonl', 214),
        ev.moissonneur_fin('parlement', 0, None, [{'source': 'VD', 'raison': 'HTTPError: 500'}],
                           {'lots': 1, 'decisions': 2}),
        ev.fin(0, 723.4),
    ]


def rendre(evts, tty, pause=False, entree=None):
    sortie = Flux(tty)
    r = console.Rendu(sortie, entree=entree)
    for e in evts:
        r.recevoir(e)
    r.terminer(pause=pause)
    return sortie.getvalue(), r


class Rendu(unittest.TestCase):
    def test_ligne_d_etape(self):
        texte, _ = rendre(passe(), tty=False)
        ligne = next(l for l in texte.splitlines() if '412/800' in l)
        self.assertIn('GE', ligne)
        self.assertIn('█████░░░░░', ligne)
        self.assertIn('412/800 requêtes', ligne)
        self.assertIn('reste ≤ ~6 min', ligne)

    def test_sans_tty_une_ligne_par_evenement_sans_ansi(self):
        texte, _ = rendre(passe(), tty=False)
        self.assertNotIn('\r', texte)
        self.assertNotIn('\x1b', texte)
        self.assertGreaterEqual(len(texte.splitlines()), len(passe()))
        self.assertEqual(sum('GE' in l and 'requêtes' in l for l in texte.splitlines()), 2)

    def test_tty_reecrit_la_ligne_en_place(self):
        texte, _ = rendre(passe(), tty=True)
        self.assertIn('\r', texte)
        self.assertIn('\x1b[2K', texte)
        # Les deux états de GE partagent une ligne : un seul saut entre GE et BE.
        segment = texte[texte.index('100/800'):texte.index('500/800')]
        self.assertEqual(segment.count('\n'), 1)

    def test_bilan_final(self):
        texte, r = rendre(passe(), tty=False)
        bilan = texte[texte.index('Bilan'):]
        self.assertIn('parlement/2026-11-01-1.jsonl', bilan)
        self.assertIn('214 propositions', bilan)
        self.assertIn('VD', bilan)
        self.assertIn('purge', bilan)
        self.assertIn('Code de sortie 0', bilan)
        self.assertIn('tout s’est bien passé', bilan)
        self.assertEqual(r.code, 0)

    def test_codes_dits_en_clair(self):
        for code in (0, 1, 2, 3, 4, 5):
            self.assertTrue(console.CODES[code])
        texte, r = rendre([ev.refus('deja-en-cours', 'lancée par cockpit')], tty=False)
        self.assertIn('déjà en cours', texte)
        self.assertEqual(r.code, 4)

    def test_attente_dite_en_clair(self):
        texte, _ = rendre([ev.etape('recherche', 'phbern', 8, 3000, 60, 0.1),
                           ev.attente('recherche', 'phbern', 120, '429', 'www.phbern.example')], tty=False)
        self.assertIn('phbern demande d’attendre 120 s', texte)

    def test_creneau_et_refus(self):
        texte, r = rendre([ev.creneau('refuse', 'poste-b', 'compte-b', '2026-11-01T06:00:00Z'),
                           ev.refus('deja-en-cours', 'x')], tty=False)
        self.assertIn('poste-b', texte)
        self.assertIn('compte-b', texte)
        self.assertEqual(r.code, 4)
        texte, r = rendre([ev.refus('budget-epuise', 'x')], tty=False)
        self.assertEqual(r.code, 4)
        texte, r = rendre([ev.refus('racine-absente', 'x')], tty=False)
        self.assertEqual(r.code, 2)

    def test_plantage_dit(self):
        texte, _ = rendre([ev.moissonneur_fin('recherche', 1, None, [], {'lots': 0, 'decisions': 0}, [], True),
                           ev.fin(5, 3)], tty=False)
        self.assertIn('planté', texte)
        self.assertIn('Code de sortie 5', texte)

    def test_temps_comme_une_borne(self):
        self.assertEqual(console.duree(45), '45 s')
        self.assertEqual(console.duree(301), '6 min')
        self.assertEqual(console.duree(7260), '2 h 01')
        texte, _ = rendre([ev.etape('recherche', 'hfh', 3, None, None, None)], tty=False)
        self.assertNotIn('reste', texte)
        self.assertIn('3 requêtes', texte)


class Pause(unittest.TestCase):
    def test_pause_attend_entree(self):
        entree = io.StringIO('\nreste\n')
        texte, _ = rendre(passe(), tty=False, pause=True, entree=entree)
        self.assertIn('Entrée', texte)
        self.assertEqual(entree.read(), 'reste\n')

    def test_sans_pause_ne_lit_rien(self):
        entree = io.StringIO('\n')
        rendre(passe(), tty=False, pause=False, entree=entree)
        self.assertEqual(entree.read(), '\n')

    def test_pause_sur_entree_fermee(self):
        texte, _ = rendre(passe(), tty=False, pause=True, entree=io.StringIO(''))
        self.assertIn('Entrée', texte)


class Rejeu(unittest.TestCase):
    def test_rejouer_la_fixture(self):
        with open(FIXTURE, encoding='utf-8') as f:
            p = subprocess.run([sys.executable, '-B', os.path.join(outils.RACINE, 'console.py')], stdin=f,
                               capture_output=True, text=True, encoding='utf-8', timeout=30)
        self.assertEqual(p.stderr, '')
        self.assertEqual(p.returncode, 3)
        self.assertIn('Bilan', p.stdout)
        self.assertNotIn('\x1b', p.stdout)

    def test_ligne_illisible_dans_le_flux(self):
        sortie = Flux(False)
        code = console.principal([], io.StringIO('pas du json\n' + '{"format":"pronto-moisson/1","type":"fin",'
                                                 '"code":0,"duree_s":1}\n'), sortie)
        self.assertEqual(code, 0)
        self.assertIn('pas du json', sortie.getvalue())


if __name__ == '__main__':
    unittest.main()
