#!/usr/bin/env python3
# Complète les faces Open Sans livrées avec les six caractères que la maquette écrit
# et qu'Open Sans ne porte pas. Sans eux, fontconfig comble les trous au moment du build
# avec ce qu'il trouve sur la machine (DejaVu, Noto) : le PDF cesse alors d'être
# reproductible d'un poste à l'autre, et l'espace fine insécable se dégrade en espace
# ordinaire dans la couche texte du PDF — donc dans un copier-coller et pour un lecteur
# d'écran.
#
#   /opt/weasyprint/bin/python pipeline/fonts/glyphes-manquants.py [--verifier]
#
# Idempotent : un caractère déjà présent est laissé tel quel. À rejouer après toute
# reprise des faces depuis le master variable (voir la recette d'instanciation dans
# README.md) — l'instanciation repart de l'amont, qui n'a pas ces glyphes.
# `--verifier` ne réécrit rien et sort 1 si un caractère manque : c'est ce que
# test/polices-check.py appelle.
#
# Les six caractères, et d'où ils viennent :
#   U+202F fine insécable  — filters/szh-numerotation.lua, « Source : » en français.
#   U+25B8 triangle        — styles/print.css, la puce de toutes les listes à puces.
#   U+21A9 flèche à crochet— l'appel de retour de note, écrit par pandoc (« ↩ »).
#   U+FE0E sélecteur 15    — pandoc le colle derrière la flèche, pour interdire la
#                            présentation émoji. Invisible, mais sans glyphe il déclenche
#                            à lui seul un repli de police.
#   U+2010 trait d'union   — celui que WeasyPrint insère à chaque coupure de mot
#                            (`hyphens: auto`), et non le U+002D du clavier. C'est le plus
#                            coûteux des six : il touche toutes les pages de la revue.
#   U+2011 idem insécable  — écrit par les rédactions dans les noms propres et les sigles.
#
# Licences : Open Sans est sous OFL 1.1 sans Reserved Font Name (voir la ligne de
# copyright d'OFL-OpenSans.txt), la modification et la rediffusion sous le même nom sont
# donc permises. La flèche est reprise d'IBM Plex Mono, également OFL 1.1 et livrée ici :
# son nom réservé est « Plex », que la face dérivée n'emploie pas. Les deux licences sont
# livrées à côté des fichiers.

import sys
from pathlib import Path

from fontTools.misc.transform import Transform
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont

DOSSIER = Path(__file__).resolve().parent

# Face à compléter -> face d'où tirer la flèche à crochet, à graisse comparable.
CIBLES = {
    'OpenSans-SemiCondensed-Regular.ttf':  'IBMPlexMono-Regular.ttf',
    'OpenSans-SemiCondensed-Italic.ttf':   'IBMPlexMono-Regular.ttf',
    'OpenSans-SemiCondensed-SemiBold.ttf': 'IBMPlexMono-Medium.ttf',
    'OpenSans-SemiCondensed-Bold.ttf':     'IBMPlexMono-Medium.ttf',
}

ATTENDUS = (0x202F, 0x2010, 0x2011, 0x25B8, 0x21A9, 0xFE0E)


def couverture(font):
    """Points de code atteignables par le cmap, tous sous-tables confondues."""
    couvert = set()
    for t in font['cmap'].tables:
        couvert |= set(t.cmap.keys())
    return couvert


def nom_du_code(font, cp):
    for t in font['cmap'].tables:
        if cp in t.cmap:
            return t.cmap[cp]
    return None


def relier(font, cp, nom):
    """Ajoute cp -> nom dans toutes les sous-tables cmap (les six codes sont dans le BMP)."""
    for t in font['cmap'].tables:
        t.cmap[cp] = nom


def ajouter_glyphe(font, nom, glyphe, avance, lsb):
    """Ajoute un glyphe et sa métrique. maxp, hhea et post se recalculent à la compilation."""
    ordre = list(font.getGlyphOrder())
    if nom in ordre:
        return
    font.setGlyphOrder(ordre + [nom])
    font['glyf'].glyphOrder = font.getGlyphOrder()
    font['glyf'].glyphs[nom] = glyphe
    font['hmtx'].metrics[nom] = (avance, lsb)


def glyphe_vide():
    """Glyphe sans contour : c'est ce que porte une espace, ou un sélecteur de variante."""
    return TTGlyphPen(None).glyph()


def triangle(upem, hauteur_x):
    """▸ BLACK RIGHT-POINTING SMALL TRIANGLE : triangle isocèle plein, pointe à droite.

    Proportions du caractère telles que la maquette les rend depuis toujours (elle a été
    calée sur une face de repli qui le dessine sur un carré d'un demi-cadratin) : côté
    d'environ 0,5 em, centré en hauteur sur le milieu de la hauteur d'x, pour que la puce
    se lise à la même altitude que le texte de l'élément de liste. Le marqueur étant
    positionné en absolu par print.css, l'avance n'entre pas dans la mise en page.
    """
    cote = round(0.498 * upem)
    milieu = round(hauteur_x / 2)
    gauche = round(0.010 * upem)
    bas, haut = milieu - cote // 2, milieu - cote // 2 + cote
    pen = TTGlyphPen(None)
    pen.moveTo((gauche, bas))
    pen.lineTo((gauche, haut))
    pen.lineTo((gauche + cote, milieu))
    pen.closePath()
    glyphe = pen.glyph()
    return glyphe, gauche + cote + round(0.020 * upem), gauche


def fleche_reprise(chemin_source, upem_cible):
    """Reprend U+21A9 d'une face IBM Plex Mono livrée, mise à l'échelle du cadratin cible."""
    src = TTFont(chemin_source)
    nom = nom_du_code(src, 0x21A9)
    if nom is None:
        raise SystemExit('U+21A9 absent de %s' % chemin_source.name)
    facteur = upem_cible / src['head'].unitsPerEm
    pen = TTGlyphPen(None)
    src.getGlyphSet()[nom].draw(
        TransformPen(pen, Transform(facteur, 0, 0, facteur, 0, 0)))
    glyphe = pen.glyph()
    avance, lsb = src['hmtx'][nom]
    return glyphe, round(avance * facteur), round(lsb * facteur)


def completer(chemin, chemin_arrow, verifier_seulement):
    font = TTFont(chemin)
    couvert = couverture(font)
    manquants = [cp for cp in ATTENDUS if cp not in couvert]
    if verifier_seulement:
        return manquants
    if not manquants:
        print('%-40s deja complete' % chemin.name)
        return []

    upem = font['head'].unitsPerEm
    hauteur_x = font['OS/2'].sxHeight

    if 0x202F in manquants:
        # La fine insécable prend le dessin (vide) et la largeur de la fine sécable
        # U+2009 : c'est la convention des faces qui portent les deux (Source Serif 4
        # les fait pointer sur le même glyphe). Rien à dessiner, tout est dans la largeur.
        relier(font, 0x202F, nom_du_code(font, 0x2009))
    if 0x2010 in manquants:
        # Le trait d'union typographique prend le dessin du trait d'union-signe moins
        # U+002D : c'est la convention de la quasi-totalité des faces qui portent les
        # deux, et la coupure de mot ne doit rien changer au dessin du tiret.
        relier(font, 0x2010, nom_du_code(font, 0x002D))
    if 0x2011 in manquants:
        # Idem pour le trait d'union insécable, écrit dans les noms propres et les
        # sigles : le caractère porte lui-même sa propriété de non-coupure, la police
        # n'a qu'à le dessiner comme un trait d'union.
        relier(font, 0x2011, nom_du_code(font, 0x002D))
    if 0xFE0E in manquants:
        ajouter_glyphe(font, 'uniFE0E', glyphe_vide(), 0, 0)
        relier(font, 0xFE0E, 'uniFE0E')
    if 0x25B8 in manquants:
        glyphe, avance, lsb = triangle(upem, hauteur_x)
        ajouter_glyphe(font, 'uni25B8', glyphe, avance, lsb)
        relier(font, 0x25B8, 'uni25B8')
    if 0x21A9 in manquants:
        glyphe, avance, lsb = fleche_reprise(chemin_arrow, upem)
        ajouter_glyphe(font, 'uni21A9', glyphe, avance, lsb)
        relier(font, 0x21A9, 'uni21A9')

    for nom in ('uni25B8', 'uni21A9'):
        if nom in font['glyf'].glyphs:
            font['glyf'][nom].recalcBounds(font['glyf'])

    font.save(chemin)
    print('%-40s + %s' % (chemin.name, ' '.join('U+%04X' % c for c in manquants)))
    return []


def main():
    verifier = '--verifier' in sys.argv[1:]
    incomplets = []
    for face, source in CIBLES.items():
        restants = completer(DOSSIER / face, DOSSIER / source, verifier)
        if restants:
            incomplets.append((face, restants))
    if verifier:
        for face, restants in incomplets:
            print('%-40s MANQUE %s' % (face, ' '.join('U+%04X' % c for c in restants)))
        if incomplets:
            return 1
        print('Les %d faces Open Sans portent les %d caracteres attendus.'
              % (len(CIBLES), len(ATTENDUS)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
