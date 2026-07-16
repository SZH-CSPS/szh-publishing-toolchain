#!/usr/bin/env python3
# accent-css.py — expose la couleur annuelle (ausgabe.yaml `couleur`, M7/D56) en
# variables CSS d'accent pour les tableaux .szh-tableau (D57, T3).
#
#   python3 accent-css.py <ausgabe.yaml>   ->  bloc :root sur stdout
#
# Émet un :root qui SURCHARGE les gris de repli définis dans print.css UNIQUEMENT
# si une couleur valide de la palette est présente ; sinon un simple commentaire
# (le PDF d'un numéro SANS couleur reste alors identique — RT4). Variables :
#   --szh-accent        filets / séparateurs « couleur »
#   --szh-accent-clair  fond d'en-tête « fond », zébrage & total « couleur » (tint clair)
#   --szh-accent-fonce  en-tête « negatif » : foncé À CONTRASTE GARANTI (texte clair)
#
# stdlib uniquement. WeasyPrint 69 n'implémente PAS color-mix() (vérifié au spike) :
# les variantes clair/foncé sont donc PRÉ-CALCULÉES ici, pas en CSS.

import sys
import re

# Palette figée (COULEURS_NUMERO de l'extension). Toute autre valeur -> repli gris.
PALETTE = {'#D31932', '#EB5E51', '#C7CF1C', '#51A66D', '#5F9FBC', '#A98899'}


def lire_couleur(chemin):
    try:
        with open(chemin, encoding='utf-8') as f:
            contenu = f.read()
    except OSError:
        return None
    for ligne in contenu.splitlines():
        m = re.match(r'\s*couleur\s*:\s*(.*)$', ligne)
        if not m:
            continue
        v = m.group(1).strip()
        # commentaire de fin de ligne éventuel
        if v[:1] not in ('"', "'"):
            v = v.split('#')[0].strip() if v[:1] != '#' else v.split()[0]
        v = v.strip().strip('"').strip("'").strip()
        m2 = re.match(r'(#[0-9A-Fa-f]{6})', v)
        if m2:
            return m2.group(1).upper()
        return None
    return None


def vers_rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))


def vers_hex(rgb):
    return '#' + ''.join('%02X' % max(0, min(255, round(c))) for c in rgb)


def luminance(rgb):
    """Luminance relative WCAG (0..1)."""
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def clair(rgb):
    # 18 % couleur + 82 % blanc : tint discret, texte foncé lisible.
    return tuple(c * 0.18 + 255 * 0.82 for c in rgb)


def fonce(rgb):
    # Assombrit la couleur (en préservant la teinte) jusqu'à une luminance <= 0.16
    # -> contraste garanti avec du texte blanc (>= 4.5:1). Recherche dichotomique.
    if luminance(rgb) <= 0.16:
        return rgb
    bas, haut = 0.0, 1.0
    for _ in range(24):
        k = (bas + haut) / 2
        if luminance(tuple(c * k for c in rgb)) > 0.16:
            haut = k
        else:
            bas = k
    return tuple(c * bas for c in rgb)


def main(argv):
    chemin = argv[1] if len(argv) > 1 else 'ausgabe.yaml'
    hexa = lire_couleur(chemin)
    if hexa not in PALETTE:
        sys.stdout.write('/* Aucune couleur annuelle : accent = repli gris de print.css. */\n')
        return 0
    rgb = vers_rgb(hexa)
    sys.stdout.write(
        ':root {\n'
        '  --szh-accent: %s;\n'
        '  --szh-accent-clair: %s;\n'
        '  --szh-accent-fonce: %s;\n'
        '}\n' % (hexa, vers_hex(clair(rgb)), vers_hex(fonce(rgb)))
    )
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
