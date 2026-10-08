#!/usr/bin/env python3
# Écrit la couleur annuelle du numéro (`couleur` d'ausgabe.yaml) en variables CSS, dans un
# bloc :root lu par les tableaux et par la maquette :
#   --szh-accent-clair         fond à texte noir : en-têtes, zébrage, total « couleur »
#   --szh-accent-fonce         fond « negatif » à texte blanc
#   --c-annual* / --annual-*   variables de la couverture et du corps
#
#   python3 accent-css.py <ausgabe.yaml>   ->  bloc :root sur stdout
#
# Les crans de chaque couleur se règlent dans styles/couleurs.css. S'il est absent ou
# incomplet, apca.py les recalcule avec les mêmes cibles. Sans couleur valide, le script
# n'écrit qu'un commentaire et les gris de print.css s'appliquent.
# WeasyPrint n'a pas color-mix() : toutes les valeurs dérivées sont calculées ici.
#
# Contrastes en APCA (apca.py). Le seuil dépend de la taille du texte : 13,6 px dans les
# tableaux, 14 px dans le corps, donc Lc 90 pour les deux fonds d'accent.

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
    # 'utf-8-sig' : un outil Windows peut avoir posé un BOM, qui collerait à la première clé.
    try:
        with open(chemin, encoding='utf-8-sig') as f:
            contenu = f.read()
    except OSError:
        return None
    for ligne in contenu.splitlines():
        # En début de ligne seulement : une clé `couleur:` indentée appartient à un autre bloc.
        m = re.match(r'couleur\s*:\s*(.*)$', ligne)
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
    """Contenu de styles/couleurs.css sans ses commentaires (qui citent des noms de
    variables), ou '' si absent."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'styles', 'couleurs.css')
    try:
        with open(chemin, encoding='utf-8') as f:
            return re.sub(r'/\*.*?\*/', '', f.read(), flags=re.S)
    except OSError:
        return ''


def resoudre_variable(css, nom, sauts=4):
    """Valeur hex d'une variable de couleurs.css, en suivant les renvois `var(--autre)`
    (les alias -normal/-clair/-fonce renvoient à un cran). None si la variable manque ou
    si les renvois n'aboutissent pas à un hex."""
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
    """Teintes neutres des tableaux (--szh-gris-clair, --szh-zebre) lues dans
    couleurs.css, indépendantes de la couleur annuelle. Dict {var: hex}, vide si
    couleurs.css manque (print.css a alors ses propres valeurs)."""
    css = couleurs_css()
    out = {}
    for var in ('--szh-gris-clair', '--szh-zebre'):
        hexa = resoudre_variable(css, var)
        if hexa:
            out[var] = hexa
    return out


# ---- Repli : recalcul APCA si couleurs.css est absent ou incomplet -------------------

def variations_calculees(hexa):
    """Mêmes valeurs que couleurs.css, recalculées sur la grille d'apca.py (CLARTES, ALIAS) :
      -normal = la couleur de la charte, inchangée ;
      -clair  = cran 100 (fond à texte noir,  Lc +91) ;
      -fonce  = cran 800 (fond à texte blanc, Lc −90).
    Le seuil 90 du texte des tableaux exclut les crans 200 et 700 (Lc 80 au plus)."""
    ech = apca.echelle(hexa)
    return {nom: ech[niveau] for nom, niveau in apca.ALIAS}


# ---- Variables de la maquette : color-mix() et contraste calculés ici ----------
# Les formules sont celles de la maquette ; on ne s'en écarte que si une paire texte/fond
# n'atteint pas son seuil APCA (test/apca-check.py).

def melange(hex_a, hex_b, poids_a):
    """color-mix(in srgb, A poids_a, B) : mélange sRGB par canal (gamma, comme CSS)."""
    a, b = apca.vers_rgb(hex_a), apca.vers_rgb(hex_b)
    return apca.vers_hex(tuple(a[i] * poids_a + b[i] * (1 - poids_a) for i in range(3)))


# Filet ou bordure de couleur sur blanc : le minimum APCA hors texte est 30, on vise 45
# pour qu'un trait de 1 px reste bien visible. Seule la moutarde (Lc 30) est assombrie.
LC_FILET_CONFORT = 45.0


def jetons_annuels(hexa):
    """Variables --c-annual* / --annual-* dérivées de la couleur annuelle.

      --c-annual-ui : couleur des traits fins, assombrie jusqu'à LC_FILET_CONFORT si elle
        est trop pâle ; les barres épaisses gardent --c-annual.
      --c-kw-bg : fond des mots-clés (.szh-kw, texte noir de 10 px). Le mélange à 22 %
        n'atteint pas Lc 90 en rouge (82) ni en capucine (89) : test/apca-check.py le
        signale « à arbitrer »."""
    texte, _ = apca.meilleure_polarite(hexa)
    return [
        ('--c-annual',          hexa),
        ('--c-annual-ui',       apca.couleur_sur(hexa, '#FFFFFF', LC_FILET_CONFORT)),
        ('--c-abstract-border', hexa),
        ('--c-kw-bg',           melange(hexa, '#FFFFFF', 0.22)),
        ('--annual-soft',       melange(hexa, '#FFFFFF', 0.12)),
        ('--annual-tint',       melange(hexa, '#FFFFFF', 0.13)),
    ]


def main(argv):
    chemin = argv[1] if len(argv) > 1 else 'ausgabe.yaml'
    hexa = lire_couleur(chemin)
    neutres = teintes_neutres_depuis_css()
    lignes = []
    if hexa in PALETTE:
        v = variations_depuis_css(PALETTE[hexa]) or variations_calculees(hexa)
        lignes.append('  --szh-accent-clair: %s;' % v['clair'])
        lignes.append('  --szh-accent-fonce: %s;' % v['fonce'])
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
