#!/usr/bin/env python3
# composition-check.py — mesure la composition des articles compilés d'un ou plusieurs
# numéros, pour comparer deux versions d'outils ou deux réglages de print.css sur pièces.
#
#   /opt/weasyprint/bin/python test/composition-check.py <numéro> [<numéro>…]
#       [--json SORTIE.json] [--reference REF.json]
#
# Lit out/<slug>/<slug>.html (jamais *.apercu.html) et le recompose avec l'API de
# WeasyPrint : un PDF ne dit pas où il a coupé un mot, les boîtes de ligne le disent.
# Par article :
#   pages, lignes
#   cesures              lignes qui finissent par le trait de césure U+2010
#   suites               suites de lignes coupées consécutives, par longueur « 2 », « 3 »,
#                        « 4+ ». Le Guide en tolère trois ; aucune propriété CSS ne le tient.
#   cesures_bas_de_page  pages dont la dernière ligne du texte courant est coupée, ce que
#                        le Guide proscrit aussi
#   blanc                px ajoutés à chaque espace d'une ligne justifiée : médiane,
#                        95e centile, max. C'est le prix d'une césure évitée.
#   langue               le lang de <html>
# Le total d'un numéro somme les articles ; seul le blanc est recalculé sur toutes les
# lignes. Les suites ne se somment pas à travers deux articles : chaque article est un
# document à part.
#
# --json écrit les mesures ; --reference les compare à un JSON ainsi écrit et rend 1 au
# premier écart, nommé. Un numéro sans HTML compilé rend 2 : ne rien mesurer n'est jamais
# un succès.

import argparse
import json
import logging
import re
import statistics
import sys
from pathlib import Path

from weasyprint import HTML
from weasyprint.formatting_structure import boxes

sys.stdout.reconfigure(encoding='utf-8')
# Les avertissements CSS de WeasyPrint sont ceux de la compilation, déjà lus là-bas.
logging.getLogger('weasyprint').setLevel(logging.ERROR)

COUPEE = re.compile(r'[A-Za-zÀ-ÿß]‐$')
MESURES = ('pages', 'lignes', 'cesures', 'suites', 'cesures_bas_de_page', 'blanc')


def texte(ligne):
    return ''.join(t.text for t in ligne.descendants()
                   if isinstance(t, boxes.TextBox)).rstrip()


def blanc(ligne):
    return max((getattr(t, 'justification_spacing', 0) or 0
                for t in ligne.descendants() if isinstance(t, boxes.TextBox)), default=0)


def lignes_de(boite, hors_marges=False):
    """Boîtes de ligne dans l'ordre du document. Hors marges : sans en-têtes ni pieds
    courants (MarginBox) ni zone de notes, pour trouver la dernière ligne du texte."""
    if hors_marges and (isinstance(boite, boxes.MarginBox)
                        or 'Footnote' in type(boite).__name__):
        return
    if isinstance(boite, boxes.LineBox):
        yield boite
        return
    for enfant in getattr(boite, 'children', []):
        yield from lignes_de(enfant, hors_marges)


def resume_blanc(valeurs):
    v = sorted(x for x in valeurs if x > 0)
    if not v:
        return {'median': 0.0, 'p95': 0.0, 'max': 0.0}
    return {'median': round(statistics.median(v), 2),
            'p95': round(v[int(0.95 * (len(v) - 1))], 2),
            'max': round(v[-1], 2)}


def mesurer(html):
    doc = HTML(filename=str(html)).render()
    coupees, blancs, bas = [], [], 0
    for page in doc.pages:
        for ligne in lignes_de(page._page_box):
            coupees.append(bool(COUPEE.search(texte(ligne))))
            blancs.append(blanc(ligne))
        derniere = None
        for derniere in lignes_de(page._page_box, hors_marges=True):
            pass
        if derniere is not None and COUPEE.search(texte(derniere)):
            bas += 1
    suites = {'2': 0, '3': 0, '4+': 0}
    n = 0
    for c in coupees + [False]:
        if c:
            n += 1
            continue
        if n >= 2:
            suites['4+' if n >= 4 else str(n)] += 1
        n = 0
    lang = re.search(r'<html[^>]*\slang="([^"]+)"', html.read_text(encoding='utf-8')[:2000])
    return {'pages': len(doc.pages), 'lignes': len(coupees), 'cesures': sum(coupees),
            'suites': suites, 'cesures_bas_de_page': bas,
            'blanc': resume_blanc(blancs), 'langue': lang.group(1) if lang else '',
            '_blancs': blancs}


def mesurer_numero(dossier):
    htmls = sorted(h for h in Path(dossier).glob('out/*/*.html')
                   if h.stem == h.parent.name)
    if not htmls:
        return None
    res = {h.parent.name: mesurer(h) for h in htmls}
    total = {'pages': 0, 'lignes': 0, 'cesures': 0, 'cesures_bas_de_page': 0,
             'suites': {'2': 0, '3': 0, '4+': 0}}
    blancs = []
    for m in res.values():
        for k in ('pages', 'lignes', 'cesures', 'cesures_bas_de_page'):
            total[k] += m[k]
        for k in total['suites']:
            total['suites'][k] += m['suites'][k]
        blancs += m.pop('_blancs')
    total['blanc'] = resume_blanc(blancs)
    res['_total'] = total
    return res


def afficher(nom, res):
    print(f'\n=== {nom} ===')
    print(f"{'article':40s} {'lang':4s} {'pages':>5s} {'lignes':>6s} {'césures':>7s} "
          f"{'suites 2/3/4+':>13s} {'bas de p.':>9s}  blanc méd/p95/max")
    for slug, m in res.items():
        if slug == '_total':
            print('-' * 104)
        s, b = m['suites'], m['blanc']
        print(f"{('TOTAL' if slug == '_total' else slug)[:40]:40s} {m.get('langue', ''):4s} "
              f"{m['pages']:5d} {m['lignes']:6d} {m['cesures']:7d} "
              f"{s['2']:>5d}/{s['3']}/{s['4+']:<5d} {m['cesures_bas_de_page']:9d}  "
              f"{b['median']:.2f} / {b['p95']:.2f} / {b['max']:.2f}")


def comparer(tout, ref):
    ecarts = 0
    for nom, res in tout.items():
        if nom not in ref:
            print(f'{nom} : absent de la référence'); ecarts += 1; continue
        for slug in sorted(set(res) | set(ref[nom])):
            a, b = ref[nom].get(slug), res.get(slug)
            if a is None or b is None:
                print(f"{nom}/{slug} : {'nouveau' if a is None else 'disparu'}"); ecarts += 1
                continue
            for k in MESURES:
                if a.get(k) != b.get(k):
                    print(f'{nom}/{slug} {k} : {a.get(k)} -> {b.get(k)}'); ecarts += 1
    print(f'\n{ecarts} écart(s) avec la référence.' if ecarts else '\nAucun écart avec la référence.')
    return ecarts


def main():
    p = argparse.ArgumentParser(description='Mesure la composition des articles compilés.')
    p.add_argument('numeros', nargs='+')
    p.add_argument('--json')
    p.add_argument('--reference')
    a = p.parse_args()
    tout = {}
    for d in a.numeros:
        res = mesurer_numero(d)
        if res is None:
            print(f'[composition] ✗ aucun HTML compilé sous {d}/out : compilez le numéro '
                  f'avant de le mesurer.', file=sys.stderr)
            return 2
        nom = Path(d).resolve().name
        tout[nom] = res
        afficher(nom, res)
    if a.json:
        Path(a.json).write_text(json.dumps(tout, ensure_ascii=False, indent=2, sort_keys=True)
                                + '\n', encoding='utf-8')
    if a.reference:
        ref = json.loads(Path(a.reference).read_text(encoding='utf-8'))
        return 1 if comparer(tout, ref) else 0
    return 0


if __name__ == '__main__':
    sys.exit(main())
