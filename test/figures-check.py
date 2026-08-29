# Aucune légende de figure ne reste seule : contrôle sur la PAGINATION, pas sur le CSS.
#
#   /opt/weasyprint/bin/python3 test/figures-check.py out/*/[!.]*.html
#   (depuis WSL, distro SZH-Publishing — c'est là que vit WeasyPrint)
#
# Ce qui se casse, et que rien d'autre ne voit. Une <figure> plus haute qu'une page ne
# peut pas tenir d'un bloc : WeasyPrint abandonne alors son `break-inside: avoid` et coupe
# au premier point permis — juste sous la légende. On lit « Figure N — … » seul en haut
# d'une page presque vide, l'image à la suivante. Le PDF se compile, la porte PDF/UA passe,
# aucun avertissement n'est écrit : seul l'œil sur un PNG l'attrapait.
#
# `break-after: avoid` sur la <figcaption> n'y change rien — WeasyPrint 69 l'ignore
# (mesuré). Le seul levier est la hauteur des images, plafonnée par --plafond-figure dans
# socle.css. Ce script vérifie le RÉSULTAT de ce plafond, pas sa présence : une valeur trop
# généreuse, une marge de figure qui grossit, une légende de six lignes de crédits, et le
# défaut revient sans qu'une règle ait bougé.
#
# La règle tenue : la page qui porte la légende d'une figure doit aussi porter au moins un
# morceau de ce que cette figure montre.
import sys
from weasyprint import HTML

VISUELS = ('img', 'svg', 'video')


def _pages_par_boite(document):
    """{ id(boîte) : numéro de page } pour toutes les boîtes du document rendu."""
    pages = {}
    for numero, page in enumerate(document.pages, start=1):
        pile = [page._page_box]
        while pile:
            boite = pile.pop()
            pages[id(boite)] = numero
            pile.extend(getattr(boite, 'children', []))
    return pages


def _classes(boite):
    try:
        return (boite.element.get('class') or '').split()
    except Exception:
        return []


def _figures(document, pages):
    """[(clé de figure, pages de la légende, pages du visuel)] — une entrée par figure.

    Une figure fragmentée sur deux pages apparaît en plusieurs boîtes : on rassemble par
    élément source, sinon chaque fragment passerait pour une figure différente et le
    contrôle ne verrait jamais la coupure.
    """
    legendes, visuels, ordre = {}, {}, []
    for numero, page in enumerate(document.pages, start=1):
        pile = [(page._page_box, None)]
        while pile:
            boite, figure = pile.pop()
            tag = getattr(boite, 'element_tag', None)
            if tag == 'figure':
                figure = boite.element
                if figure not in ordre:
                    ordre.append(figure)
            if figure is not None:
                cible = None
                if tag == 'figcaption':
                    cible = legendes
                elif tag in VISUELS or 'szh-decor' in _classes(boite):
                    cible = visuels
                if cible is not None:
                    cible.setdefault(figure, set()).add(pages[id(boite)])
            for enfant in getattr(boite, 'children', []):
                pile.append((enfant, figure))
    return [(f, legendes.get(f, set()), visuels.get(f, set())) for f in ordre]


def _titre(element):
    """De quoi nommer la figure fautive dans le rapport : son numéro, ou son identifiant."""
    # L'arbre de WeasyPrint est un ElementTree : pas de .text_content(), on ramasse le
    # texte des descendants.
    texte = ' '.join(''.join(element.itertext()).split())
    return (texte[:60] + '…') if len(texte) > 60 else (texte or element.get('id') or '?')


def controler(chemin):
    document = HTML(filename=chemin).render()
    pages = _pages_par_boite(document)
    ecarts = []
    for element, p_legende, p_visuel in _figures(document, pages):
        if not p_legende or not p_visuel:
            continue                      # figure sans légende, ou sans visuel : rien à tenir
        seules = sorted(p_legende - p_visuel)
        if seules and not (p_legende & p_visuel):
            ecarts.append((sorted(p_legende), sorted(p_visuel), _titre(element)))
    return ecarts


def main(chemins):
    total = 0
    for chemin in chemins:
        ecarts = controler(chemin)
        total += len(ecarts)
        if ecarts:
            print(chemin)
            for p_legende, p_visuel, titre in ecarts:
                print('  ✗ légende page %s, image page %s — %s'
                      % (', '.join(map(str, p_legende)), ', '.join(map(str, p_visuel)), titre))
    if total:
        print('\n%d légende(s) de figure séparée(s) de leur image.' % total)
        print('Plafonner la hauteur des images : voir --plafond-figure dans '
              'pipeline/styles/socle.css.')
        return 1
    print('Aucune légende de figure orpheline sur %d document(s).' % len(chemins))
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__ or 'usage : figures-check.py <fichier.html> […]')
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
