#!/usr/bin/env python3
# accent-css.py — expose la couleur annuelle (ausgabe.yaml `couleur`, M7/D56) en
# variables CSS d'accent. UN SEUL bloc :root canonique (D72), consommé à la fois par :
#   - les TABLEAUX .szh-tableau  -> --szh-accent / -clair / -fonce (D57, T3) ;
#   - la MAQUETTE (couverture + corps) -> --c-annual* / --annual-* (D69–D71).
# WeasyPrint 69 n'implémente pas color-mix() et n'exécute pas le JS d'applyTweaks
# (contraste APCA) : tous les jetons dérivés sont donc PRÉCALCULÉS ici (voir
# jetons_annuels). Aucune couleur -> aucun jeton -> repli gris de print.css (D72).
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


# ---- Jetons de la MAQUETTE (D72) : précalcul des color-mix() + contraste ----------
# WeasyPrint 69 n'implémente pas color-mix() et n'exécute pas le JS d'applyTweaks
# (contraste APCA). On précalcule donc, en Python, TOUS les jetons dérivés de la
# couleur annuelle consommés par print.css (couverture + corps). Les formules
# reprennent la maquette (base-finale-source.jsx / Pages export.html) à l'identique.

def melange(hex_a, hex_b, poids_a):
    """color-mix(in srgb, A poids_a, B) : mélange sRGB par canal (gamma, comme CSS)."""
    a, b = vers_rgb(hex_a), vers_rgb(hex_b)
    return vers_hex(tuple(a[i] * poids_a + b[i] * (1 - poids_a) for i in range(3)))


def assombrir_vers(hexa, lum_cible):
    """Assombrit (teinte préservée) jusqu'à luminance <= lum_cible (quasi-noir)."""
    rgb = vers_rgb(hexa)
    if luminance(rgb) <= lum_cible:
        return hexa
    bas, haut = 0.0, 1.0
    for _ in range(24):
        k = (bas + haut) / 2
        if luminance(tuple(c * k for c in rgb)) > lum_cible:
            haut = k
        else:
            bas = k
    return vers_hex(tuple(c * bas for c in rgb))


def jetons_annuels(hexa):
    """Tous les jetons --c-annual* / --annual-* dérivés de la couleur annuelle.
    Cas particulier « couleur très claire » (moutarde #C7CF1C) : le texte sur aplat
    passe au noir et le filet fin (--c-annual-ui) devient quasi-noir (les barres
    ÉPAISSES gardent la couleur brute var(--c-annual), fidèle à la maquette)."""
    tres_claire = luminance(vers_rgb(hexa)) > 0.5
    return [
        ('--c-annual',          hexa),
        ('--c-annual-deep',     vers_hex(fonce(vers_rgb(hexa)))),
        ('--c-annual-text',     melange(hexa, '#0A0D14', 0.60)),   # texte annuel sur blanc
        ('--c-annual-ui',       assombrir_vers(hexa, 0.045) if tres_claire else hexa),
        ('--c-on-annual',       '#000000' if tres_claire else '#ffffff'),
        ('--c-abstract-border', hexa),
        ('--c-kw-bg',           melange(hexa, '#FFFFFF', 0.22)),
        ('--annual-soft',       melange(hexa, '#FFFFFF', 0.12)),
        ('--annual-tint',       melange(hexa, '#FFFFFF', 0.13)),
    ]


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
        # Jetons de la maquette (D72) : mêmes source (la couleur annuelle), un seul bloc.
        for var, hexv in jetons_annuels(hexa):
            lignes.append('  %s: %s;' % (var, hexv))
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
