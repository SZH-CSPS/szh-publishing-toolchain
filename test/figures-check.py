# Une figure sort entière, et à son rapport : contrôle sur la PAGINATION, pas sur le CSS.
#
#   /opt/weasyprint/bin/python3 test/figures-check.py out/<slug>/<slug>.html […]
#   (depuis WSL, distro SZH-Publishing — c'est là que vit WeasyPrint)
#
# DEUX règles sont tenues ici, et la seconde vient d'un correctif qui s'est retourné.
#
# 1. La page qui porte la légende d'une figure doit aussi porter un morceau de ce que
#    cette figure montre. Une <figure> plus haute qu'une page ne peut pas tenir d'un
#    bloc : WeasyPrint abandonne alors son `break-inside: avoid` et coupe au premier
#    point permis — juste sous la légende. On lit « Figure N — … » seul en haut d'une
#    page presque vide, l'image à la suivante. Le PDF se compile, la porte PDF/UA passe,
#    aucun avertissement n'est écrit : seul l'œil sur un PNG l'attrapait.
#
#    `break-after: avoid` sur la <figcaption> n'y change rien — WeasyPrint 69 l'ignore
#    (mesuré). Le seul levier est la hauteur des images, plafonnée par --plafond-figure
#    dans socle.css.
#
# 2. Aucune image ne sort déformée. Le premier plafond posé — `max-height` sur une image
#    en `width: 100%` — a bien recollé les légendes, mais WeasyPrint 69 ÉCRASE alors
#    l'image au lieu de la rétrécir : un fichier 900 × 1400 sortait en 650 × 377. Rendre
#    la légende à son image en aplatissant les visages n'est pas un progrès, et la
#    planche contact ne le montrait pas. Dans une grille, le plafond se pose donc en
#    `max-width` sur la CASE, jamais en `max-height` sur l'image.
#
# Ce script vérifie le RÉSULTAT, pas la présence d'une règle : une valeur de plafond trop
# généreuse, une marge de figure qui grossit, une légende de six lignes de crédits, et le
# défaut revient sans qu'aucune règle ait bougé.
import sys
from weasyprint import HTML

VISUELS = ('img', 'svg', 'video')

# Une image reste « à son rapport » à 1 % près : en dessous c'est l'arrondi de la mise en
# page, au-dessus c'est une déformation qui se voit à l'œil sur un visage.
TOLERANCE = 0.01


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
    """[(élément figure, pages de la légende, pages du visuel)] — une entrée par figure.

    Une figure coupée en deux apparaît en plusieurs boîtes : on rassemble par élément
    source, sinon chaque fragment passerait pour une figure à part et le contrôle ne
    verrait jamais la coupure.
    """
    legendes, visuels, ordre = {}, {}, []
    for page in document.pages:
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


def _orphelines(document, pages):
    """[(pages de la légende, pages du visuel, titre)] pour chaque légende détachée."""
    ecarts = []
    for element, p_legende, p_visuel in _figures(document, pages):
        if not p_legende or not p_visuel:
            continue                      # figure sans légende, ou sans visuel : rien à tenir
        if not (p_legende & p_visuel):
            ecarts.append((sorted(p_legende), sorted(p_visuel), _titre(element)))
    return ecarts


def _deformees(document):
    """[(page, largeur, hauteur, rapport rendu, rapport naturel)] par image écrasée."""
    fautives = []
    for numero, page in enumerate(document.pages, start=1):
        pile = [page._page_box]
        while pile:
            boite = pile.pop()
            pile.extend(getattr(boite, 'children', []))
            if getattr(boite, 'element_tag', None) != 'img' or not boite.height:
                continue
            # `ratio` et non `intrinsic_ratio` : le nom de la propriété CSS n'est pas
            # celui de l'objet WeasyPrint. Écrit à côté, le contrôle passait à vide et
            # ne pouvait plus rien signaler — un contrôle qui ne peut pas échouer est mort.
            remplacement = getattr(boite, 'replacement', None)
            naturel = getattr(remplacement, 'ratio', None)
            if not naturel:
                continue                  # SVG sans dimensions : aucun rapport à tenir
            rendu = boite.width / boite.height
            if abs(rendu - naturel) / naturel > TOLERANCE:
                fautives.append((numero, boite.width, boite.height, rendu, naturel))
    return fautives


def controler(chemin):
    document = HTML(filename=chemin).render()
    pages = _pages_par_boite(document)
    return _orphelines(document, pages), _deformees(document)


def main(chemins):
    orphelines, ecrasees = 0, 0
    for chemin in chemins:
        ecarts, deformees = controler(chemin)
        orphelines += len(ecarts)
        ecrasees += len(deformees)
        if ecarts or deformees:
            print(chemin)
        for p_legende, p_visuel, titre in ecarts:
            print('  ✗ légende page %s, image page %s — %s'
                  % (', '.join(map(str, p_legende)), ', '.join(map(str, p_visuel)), titre))
        for numero, largeur, hauteur, rendu, naturel in deformees:
            print('  ✗ image écrasée page %d : %.0f × %.0f, rapport %.3f au lieu de %.3f'
                  % (numero, largeur, hauteur, rendu, naturel))
    if orphelines:
        print('')
        print('%d légende(s) de figure séparée(s) de leur image.' % orphelines)
        print('Plafonner la hauteur des images : voir --plafond-figure dans '
              'pipeline/styles/socle.css.')
    if ecrasees:
        print('')
        print('%d image(s) déformée(s) par le plafond de hauteur.' % ecrasees)
        print('Dans une grille, le plafond se pose en max-width sur la CASE : une '
              'max-height sur une image en width:100% l’écrase (WeasyPrint 69).')
    if orphelines or ecrasees:
        return 1
    print('Aucune légende orpheline ni image déformée sur %d document(s).' % len(chemins))
    return 0


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print('usage : figures-check.py <fichier.html> […]')
        sys.exit(2)
    sys.exit(main(sys.argv[1:]))
