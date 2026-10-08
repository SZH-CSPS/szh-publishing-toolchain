# Vérifie sur la pagination rendue qu'une figure reste avec sa légende et garde ses
# proportions.
#
#   /opt/weasyprint/bin/python3 test/figures-check.py out/<slug>/<slug>.html […]
#   (dans la WSL SZH-Publishing, où vit WeasyPrint)
#
# 1. La page qui porte la légende d'une figure porte aussi une partie du visuel. Une
#    <figure> plus haute qu'une page fait abandonner `break-inside: avoid` à WeasyPrint,
#    qui coupe juste sous la légende : « Figure N — … » reste seule sur une page presque vide, l'image
#    passe à la suivante, sans aucun avertissement. `break-after: avoid` sur la
#    <figcaption> est sans effet dans WeasyPrint ; seule la hauteur des images, plafonnée
#    par --plafond-figure dans socle.css, l'évite.
#
# 2. Aucune image n'est déformée. Un `max-height` sur une image en `width: 100%` la fait
#    écraser par WeasyPrint au lieu de la réduire. Dans une grille, le plafond se pose
#    donc en `max-width` sur la case, pas en `max-height` sur l'image.
#
# On vérifie le résultat et non les règles CSS : un plafond trop grand, une marge qui
# grossit ou une longue légende suffisent à faire revenir le défaut.
import sys
from weasyprint import HTML

VISUELS = ('img', 'svg', 'video')

# Écart de proportions toléré : 1 %, l'arrondi de la mise en page. Au-delà, la
# déformation se voit.
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

    Une figure coupée apparaît en plusieurs boîtes : on les regroupe par élément source,
    sinon la coupure ne se verrait pas.
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
    """Nom de la figure fautive pour le rapport : son texte, ou son identifiant."""
    # Arbre ElementTree : pas de .text_content(), on assemble le texte des descendants.
    texte = ' '.join(''.join(element.itertext()).split())
    return (texte[:60] + '…') if len(texte) > 60 else (texte or element.get('id') or '?')


def _orphelines(document, pages):
    """[(pages de la légende, pages du visuel, titre)] pour chaque légende détachée."""
    ecarts = []
    for element, p_legende, p_visuel in _figures(document, pages):
        if not p_legende or not p_visuel:
            continue                      # figure sans légende ou sans visuel
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
            # L'attribut WeasyPrint s'appelle `ratio`, pas `intrinsic_ratio`. Avec un
            # mauvais nom, getattr rend None et le contrôle ne trouve jamais rien.
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
