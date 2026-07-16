#!/usr/bin/env python3
# accent-css.py — expose la couleur annuelle (ausgabe.yaml `couleur`, M7/D56) en
# variables CSS d'accent pour les tableaux .szh-tableau (D57, T3).
#
#   python3 accent-css.py <ausgabe.yaml>   ->  bloc :root sur stdout
#
# Les 3 variations de chaque couleur (normal / clair / fonce) sont ÉDITABLES dans
# styles/couleurs.css (--c-<nom>-normal/-clair/-fonce). Ce script lit la couleur
# choisie, la mappe à son nom, et émet un :root reprenant ces 3 variations. Sans
# couleur valide -> commentaire seul (le PDF d'un numéro SANS couleur reste identique,
# RT4). Repli si couleurs.css absent/incomplet : calcul WCAG contraste-safe.
#   --szh-accent        filets / séparateurs / accents « couleur »
#   --szh-accent-clair  fond « fond » (texte noir), zébrage & total « couleur »
#   --szh-accent-fonce  en-tête « negatif » (texte blanc), foncé à contraste garanti
#
# stdlib uniquement.

import sys
import os
import re

# Palette figée (COULEURS_NUMERO de l'extension) : hex -> nom (clé dans couleurs.css).
PALETTE = {
    '#D31932': 'rouge', '#EB5E51': 'capucine', '#C7CF1C': 'moutarde',
    '#51A66D': 'poireau', '#5F9FBC': 'bleuacier', '#A98899': 'mountbatten',
}


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
        if v[:1] not in ('"', "'"):
            v = v.split('#')[0].strip() if v[:1] != '#' else v.split()[0]
        v = v.strip().strip('"').strip("'").strip()
        m2 = re.match(r'(#[0-9A-Fa-f]{6})', v)
        if m2:
            return m2.group(1).upper()
        return None
    return None


def _couleurs_css():
    """Contenu de styles/couleurs.css (à côté de ce script), ou '' si absent."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'styles', 'couleurs.css')
    try:
        with open(chemin, encoding='utf-8') as f:
            return f.read()
    except OSError:
        return ''


def variations_depuis_css(nom):
    """Lit --c-<nom>-normal/-clair/-fonce dans styles/couleurs.css. Renvoie
    {normal, clair, fonce} si les 3 sont trouvées, sinon None."""
    css = _couleurs_css()
    out = {}
    for var in ('normal', 'clair', 'fonce'):
        m = re.search(r'--c-' + re.escape(nom) + r'-' + var + r'\s*:\s*(#[0-9A-Fa-f]{6})', css)
        if m:
            out[var] = m.group(1)
    return out if len(out) == 3 else None


def teintes_neutres_depuis_css():
    """Teintes NEUTRES des tableaux (--szh-gris-clair, --szh-zebre) éditées dans
    styles/couleurs.css. Indépendantes de la couleur annuelle : ré-émises telles
    quelles pour que les modifications de couleurs.css prennent effet dans le PDF.
    Renvoie un dict {var: hex} (vide si couleurs.css absent/incomplet -> repli de
    print.css)."""
    css = _couleurs_css()
    out = {}
    for var in ('--szh-gris-clair', '--szh-zebre'):
        m = re.search(re.escape(var) + r'\s*:\s*(#[0-9A-Fa-f]{3,6})', css)
        if m:
            out[var] = m.group(1)
    return out


# ---- Repli : calcul WCAG contraste-safe (si couleurs.css absent/incomplet) ----------

def vers_rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) for i in (1, 3, 5))


def vers_hex(rgb):
    return '#' + ''.join('%02X' % max(0, min(255, round(c))) for c in rgb)


def luminance(rgb):
    def lin(c):
        c = c / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (lin(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def clair(rgb):
    # 18 % couleur + 82 % blanc : fond clair, texte noir lisible (contraste élevé).
    return tuple(c * 0.18 + 255 * 0.82 for c in rgb)


def fonce(rgb):
    # Assombrit (teinte préservée) jusqu'à luminance <= 0.16 -> texte blanc >= 4.5:1.
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


def variations_calculees(hexa):
    rgb = vers_rgb(hexa)
    return {'normal': hexa, 'clair': vers_hex(clair(rgb)), 'fonce': vers_hex(fonce(rgb))}


def main(argv):
    chemin = argv[1] if len(argv) > 1 else 'ausgabe.yaml'
    hexa = lire_couleur(chemin)
    neutres = teintes_neutres_depuis_css()   # --szh-gris-clair / --szh-zebre (éditables)
    lignes = []
    if hexa in PALETTE:
        v = variations_depuis_css(PALETTE[hexa]) or variations_calculees(hexa)
        lignes.append('  --szh-accent: %s;' % v['normal'])
        lignes.append('  --szh-accent-clair: %s;' % v['clair'])
        lignes.append('  --szh-accent-fonce: %s;' % v['fonce'])
    for var, hexv in neutres.items():
        lignes.append('  %s: %s;' % (var, hexv))
    if not lignes:
        sys.stdout.write('/* Aucune couleur annuelle : accent = repli gris de print.css. */\n')
        return 0
    if hexa not in PALETTE:
        sys.stdout.write('/* Aucune couleur annuelle : accent = repli gris de print.css ; teintes neutres ci-dessous. */\n')
    sys.stdout.write(':root {\n' + '\n'.join(lignes) + '\n}\n')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
