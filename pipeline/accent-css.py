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
# Les crans de chaque couleur (grille à clarté fixe -50 … -950, dont l'un porte la
# couleur de CHARTE elle-même, plus les alias -marque/-normal/-clair/-fonce) sont
# ÉDITABLES dans styles/couleurs.css. Ce script lit la couleur choisie, la mappe à son
# nom, et émet un :root reprenant les 3 variations que consomment les tableaux. Sans
# couleur valide -> commentaire seul (le PDF d'un numéro SANS couleur reste identique,
# RT4). Repli si couleurs.css absent/incomplet : recalcul APCA par le module apca.py,
# avec les mêmes cibles que couleurs.css (donc les mêmes valeurs).
#   --szh-accent        filets / séparateurs / accents « couleur »
#   --szh-accent-clair  fond « fond » (texte noir), zébrage & total « couleur »
#   --szh-accent-fonce  en-tête « negatif » (texte blanc), foncé à contraste garanti
#
# TOUS les contrastes de ce fichier sont calculés en APCA (module apca.py, seuils dans
# styles/couleurs.css) : |Lc| >= 75 pour du texte, >= 60 pour un gros titre, >= 30 pour
# un filet. L'ancien ratio WCAG 2 « 4,5:1 » n'est plus utilisé nulle part.
#
# stdlib uniquement (apca.py est à côté, donc importable tel quel).

import sys
import os
import re

import apca

# Palette figée (COULEURS_NUMERO de l'extension) : hex -> nom (clé dans couleurs.css).
PALETTE = {
    '#D31932': 'rouge', '#EB5E51': 'capucine', '#C7CF1C': 'moutarde',
    '#51A66D': 'poireau', '#5F9FBC': 'bleuacier', '#A98899': 'mountbatten',
}


def lire_couleur(chemin):
    # 'utf-8-sig' : un ausgabe.yaml écrit par un outil Windows peut porter un BOM
    # UTF-8, qui collerait à la première clé du fichier et la rendrait invisible
    # (couleur annuelle silencieusement perdue). Le sérialiseur du cockpit préserve
    # un BOM existant : le cas est atteignable, pas théorique.
    try:
        with open(chemin, encoding='utf-8-sig') as f:
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


def couleurs_css():
    """Contenu de styles/couleurs.css (à côté de ce script), COMMENTAIRES RETIRÉS, ou
    '' si absent. Le fichier est très commenté (mode d'emploi + valeurs Lc annotées) et
    ses commentaires citent des noms de variables : les retirer évite qu'une phrase
    d'explication soit prise pour une déclaration."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'styles', 'couleurs.css')
    try:
        with open(chemin, encoding='utf-8') as f:
            return re.sub(r'/\*.*?\*/', '', f.read(), flags=re.S)
    except OSError:
        return ''


def resoudre_variable(css, nom, sauts=4):
    """Valeur hex d'une variable CSS de couleurs.css, en suivant les renvois
    `var(--autre)`. Les alias -normal/-clair/-fonce pointent vers un niveau de
    la grille, ou vers la marque (`--c-rouge-clair: var(--c-rouge-200)`) : un seul hex par
    cran et par teinte, donc aucun risque de désynchronisation quand la revue édite un
    cran. Renvoie None si
    la variable est absente ou si la chaîne de renvois n'aboutit pas à un hex."""
    for _ in range(sauts):
        m = re.search(re.escape(nom) + r'\s*:\s*([^;\n]+);', css)
        if not m:
            return None
        valeur = m.group(1).strip()
        m_hex = re.match(r'(#[0-9A-Fa-f]{3,6})$', valeur)
        if m_hex:
            return m_hex.group(1)
        m_var = re.match(r'var\(\s*(--[\w-]+)\s*\)$', valeur)
        if not m_var:
            return None
        nom = m_var.group(1)
    return None


def variations_depuis_css(nom):
    """Lit --c-<nom>-normal/-clair/-fonce dans styles/couleurs.css (renvois var()
    suivis). Renvoie {normal, clair, fonce} si les 3 sont trouvées, sinon None."""
    css = couleurs_css()
    out = {}
    for var in ('normal', 'clair', 'fonce'):
        hexa = resoudre_variable(css, '--c-%s-%s' % (nom, var))
        if hexa:
            out[var] = hexa
    return out if len(out) == 3 else None


def teintes_neutres_depuis_css():
    """Teintes NEUTRES des tableaux (--szh-gris-clair, --szh-zebre) éditées dans
    styles/couleurs.css. Indépendantes de la couleur annuelle : ré-émises telles
    quelles pour que les modifications de couleurs.css prennent effet dans le PDF.
    Renvoie un dict {var: hex} (vide si couleurs.css absent/incomplet -> repli de
    print.css)."""
    css = couleurs_css()
    out = {}
    for var in ('--szh-gris-clair', '--szh-zebre'):
        hexa = resoudre_variable(css, var)
        if hexa:
            out[var] = hexa
    return out


# ---- Repli : recalcul APCA (si couleurs.css absent/incomplet) ------------------------

def variations_calculees(hexa):
    """Mêmes valeurs que couleurs.css, recalculées sur la grille à clarté fixe :
      -normal = la CHARTE (hex d'entrée intact ; elle occupe l'un des crans, D80) ;
      -clair  = cran 200 (fond à texte noir,  Lc garanti +79,6) ;
      -fonce  = cran 700 (fond à texte blanc, Lc garanti −79,7 depuis que la charte
                rouge occupe ce cran — c'est elle qui fixe désormais le pire des six).
    La grille et les alias étant définis dans apca.py (CLARTES / ALIAS), ce repli ne peut
    pas divulguer une autre palette que celle du fichier CSS."""
    ech = apca.echelle(hexa)
    return {nom: ech[niveau] for nom, niveau in apca.ALIAS}


# ---- Jetons de la MAQUETTE (D72) : précalcul des color-mix() + contraste ----------
# WeasyPrint 69 n'implémente pas color-mix() et n'exécute pas le JS d'applyTweaks
# (contraste APCA). On précalcule donc, en Python, TOUS les jetons dérivés de la
# couleur annuelle consommés par print.css (couverture + corps). Les formules
# reprennent la maquette (base-finale-source.jsx / Pages export.html) à l'identique,
# et APCA sert de GARDE-FOU : on ne dévie de la maquette que lorsqu'une paire
# texte/fond n'atteint pas son seuil (voir test/apca-check.py).

def melange(hex_a, hex_b, poids_a):
    """color-mix(in srgb, A poids_a, B) : mélange sRGB par canal (gamma, comme CSS)."""
    a, b = apca.vers_rgb(hex_a), apca.vers_rgb(hex_b)
    return apca.vers_hex(tuple(a[i] * poids_a + b[i] * (1 - poids_a) for i in range(3)))


# Filet / bordure de couleur sur le papier blanc : le plancher APCA du non-textuel est
# 30 ; on vise 45 pour qu'un trait de 1 px reste franchement visible. Seule la moutarde
# (Lc 30,1 sur blanc, à la limite) est concernée : elle est légèrement assombrie.
LC_FILET_CONFORT = 45.0
# Texte de couleur sur le papier blanc : plancher texte 75, on vise 78 (petite marge).
LC_TEXTE_ANNUEL = 78.0


def jetons_annuels(hexa):
    """Tous les jetons --c-annual* / --annual-* dérivés de la couleur annuelle.

    Décisions de contraste en APCA (et non plus par un seuil de luminance WCAG) :
      --c-on-annual : noir OU blanc, la polarité qui maximise |Lc| sur l'aplat. Aucune
        des 6 teintes de marque n'atteint 75 dans un sens ou dans l'autre : ce jeton
        n'est valable que pour du GROS texte (>= 24 px, seuil 60) — c'est bien son
        usage (titres de couverture sur aplat), pas du texte courant.
      --c-annual-ui : les traits FINS d'une couleur trop pâle sur blanc sont assombris
        jusqu'à LC_FILET_CONFORT. Les barres ÉPAISSES gardent la couleur brute
        var(--c-annual), fidèle à la maquette.
      --c-annual-text : le mélange de la maquette (60 % couleur + 40 % encre) est gardé
        tel quel s'il tient le seuil texte, et seulement assombri sinon (cas moutarde,
        où le mélange plafonne à Lc 68,9)."""
    texte, _ = apca.meilleure_polarite(hexa)
    return [
        ('--c-annual',          hexa),
        # Cran 700, comme l'alias -fonce : UNE SEULE règle « fond sombre à texte blanc »
        # dans toute la chaîne, donc le fond négatif d'un tableau et celui de la maquette
        # sont exactement la même couleur (avant : 800 ici, 800 pour -fonce sur l'ancienne
        # échelle à cibles de contraste — la coïncidence était fortuite, elle est
        # maintenant construite).
        ('--c-annual-deep',     apca.echelle(hexa)['700']),
        ('--c-annual-text',     apca.couleur_sur(melange(hexa, '#0A0D14', 0.60),
                                                 '#FFFFFF', LC_TEXTE_ANNUEL)),
        ('--c-annual-ui',       apca.couleur_sur(hexa, '#FFFFFF', LC_FILET_CONFORT)),
        ('--c-on-annual',       texte.lower()),
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
