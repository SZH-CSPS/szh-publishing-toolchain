"""Affiche l'arbre normalisé, les liens et les erreurs d'un rendu du banc, ou le diff des
arbres de deux piles.

    python3 test/weasyprint-banc/voir.py <pile> <cas> [variante] [--diff <autre pile>]
                                         [--travail <dossier>]

Les piles sont celles du dernier passage (<travail>/piles.json) : production, toutes,
toutes-85… Variante par défaut : ua1. Dossier de travail par défaut : tmp/banc.
"""
import argparse
import difflib
import json
import os

RACINE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

ap = argparse.ArgumentParser()
ap.add_argument('pile')
ap.add_argument('cas')
ap.add_argument('variante', nargs='?', default='ua1')
ap.add_argument('--diff', default='')
ap.add_argument('--travail', default=os.path.join(RACINE, 'tmp', 'banc'))
args = ap.parse_args()
with open(os.path.join(args.travail, 'piles.json')) as f:
    piles = json.load(f)


def lire(pile):
    base = os.path.join(args.travail, 'rendus', piles[pile]['cle'], f'{args.cas}.{args.variante}')
    with open(base + '.pdf.mesure.json') as f:
        return json.load(f), base


m, base = lire(args.pile)
if args.diff:
    m2, _ = lire(args.diff)
    print('\n'.join(difflib.unified_diff(m2['arbre'].splitlines(), m['arbre'].splitlines(),
                                         args.diff, args.pile, n=2, lineterm='')))
else:
    print(base + '.pdf')
    print(m['arbre'])
    print('liens', m['liens'])
    print('erreurs', json.dumps(m['erreurs'], ensure_ascii=False))
    print('info', m.get('info'), 'xmp', m.get('xmp'))
