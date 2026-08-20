#!/usr/bin/env python3
# accent-css.py — expose la couleur annuelle (`couleur` d'ausgabe.yaml) en variables CSS
# d'accent, dans un unique bloc :root consommé à la fois par les tableaux .szh-tableau et
# par la maquette :
#   --szh-accent-clair  fond à texte noir : en-têtes, zébrage et total « couleur »
#   --szh-accent-fonce  fond « negatif » à texte blanc
#   --c-annual* / --annual-*   jetons de la couverture et du corps
#
#   python3 accent-css.py <ausgabe.yaml>   ->  bloc :root sur stdout
#
# Les crans de chaque couleur sont éditables dans styles/couleurs.css ; ce script y lit la
# couleur choisie et réémet les variations que consomment les tableaux. Sans couleur
# valide, il n'écrit qu'un commentaire : le repli gris de print.css s'applique et le PDF
# d'un numéro sans couleur reste identique. Si couleurs.css est absent ou incomplet, les
# valeurs sont recalculées par apca.py, avec les mêmes cibles donc les mêmes résultats.
# WeasyPrint 69 n'implémente pas color-mix() et n'exécute aucun JS : tous les jetons
# dérivés sont précalculés ici.
#
# Les contrastes sont calculés en APCA (module apca.py) et un seuil APCA dépend de la
# taille du texte : celui des tableaux est à 13,6 px et le corps à 14 px, donc les deux
# fonds d'accent se jugent à 90, pas à 75.
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
    # 'utf-8-sig' : un ausgabe.yaml écrit par un outil Windows peut porter un BOM UTF-8,
    # qui collerait à la première clé et la rendrait invisible, perdant silencieusement la
    # couleur annuelle. Le sérialiseur du cockpit préserve un BOM existant, donc le cas
    # est atteignable.
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
    """Contenu de styles/couleurs.css (à côté de ce script), commentaires retirés, ou
    '' si absent. Ses commentaires citent des noms de variables : les retirer évite
    qu'une phrase d'explication soit prise pour une déclaration."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'styles', 'couleurs.css')
    try:
        with open(chemin, encoding='utf-8') as f:
            return re.sub(r'/\*.*?\*/', '', f.read(), flags=re.S)
    except OSError:
        return ''


def resoudre_variable(css, nom, sauts=4):
    """Valeur hex d'une variable de couleurs.css, en suivant les renvois `var(--autre)`.
    Les alias -normal/-clair/-fonce pointent vers un cran de la grille ou vers la marque,
    donc un seul hex par cran et par teinte : la revue peut éditer un cran sans risque de
    désynchronisation. None si la variable est absente ou si la chaîne de renvois
    n'aboutit pas à un hex."""
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
    """Teintes neutres des tableaux (--szh-gris-clair, --szh-zebre), éditées dans
    styles/couleurs.css et indépendantes de la couleur annuelle : ré-émises telles
    quelles pour qu'une modification de couleurs.css atteigne le PDF. Dict {var: hex},
    vide si couleurs.css est absent ou incomplet — c'est alors le repli de print.css."""
    css = couleurs_css()
    out = {}
    for var in ('--szh-gris-clair', '--szh-zebre'):
        hexa = resoudre_variable(css, var)
        if hexa:
            out[var] = hexa
    return out


# ---- Repli : recalcul APCA si couleurs.css est absent ou incomplet -------------------

def variations_calculees(hexa):
    """Mêmes valeurs que couleurs.css, recalculées sur la grille à clarté fixe :
      -normal = la charte (hex d'entrée intact, elle occupe l'un des crans) ;
      -clair  = cran 100 (fond à texte noir,  Lc garanti +91) ;
      -fonce  = cran 800 (fond à texte blanc, Lc garanti −90).
    Le texte d'un tableau étant à 13,6 px, son seuil est 90 : c'est ce qui exclut les
    crans 200 et 700, qui plafonnent à 80. Pour le rouge, -fonce n'est donc plus la charte
    #D31932 mais le cran 800. La grille et les alias vivent dans apca.py (CLARTES,
    ALIAS) : ce repli ne peut pas produire une autre palette que celle du fichier CSS."""
    ech = apca.echelle(hexa)
    return {nom: ech[niveau] for nom, niveau in apca.ALIAS}


# ---- Jetons de la maquette : précalcul des color-mix() et du contraste ----------
# WeasyPrint 69 n'implémente pas color-mix() et n'exécute aucun JS : tous les jetons
# dérivés de la couleur annuelle que consomme print.css sont donc précalculés ici. Les
# formules reprennent la maquette à l'identique et APCA sert de garde-fou — on ne s'en
# écarte que lorsqu'une paire texte/fond n'atteint pas son seuil (test/apca-check.py).

def melange(hex_a, hex_b, poids_a):
    """color-mix(in srgb, A poids_a, B) : mélange sRGB par canal (gamma, comme CSS)."""
    a, b = apca.vers_rgb(hex_a), apca.vers_rgb(hex_b)
    return apca.vers_hex(tuple(a[i] * poids_a + b[i] * (1 - poids_a) for i in range(3)))


# Filet ou bordure de couleur sur le papier blanc : le plancher APCA du non-textuel est
# 30, on vise 45 pour qu'un trait de 1 px reste franchement visible. Seule la moutarde
# (Lc 30 sur blanc) est concernée et elle est légèrement assombrie. Ce seuil ne dépend pas
# de la taille : un filet n'est pas du texte.
LC_FILET_CONFORT = 45.0


def jetons_annuels(hexa):
    """Tous les jetons --c-annual* / --annual-* dérivés de la couleur annuelle.

    Contraste jugé en APCA :
      --c-annual-ui : les traits fins d'une couleur trop pâle sur blanc sont assombris
        jusqu'à LC_FILET_CONFORT ; les barres épaisses gardent var(--c-annual).
      --c-kw-bg : fond des puces de mots-clés (.szh-kw), qui portent du texte noir de
        10 px. Le mélange de la maquette (22 % couleur) n'atteint 90 ni en rouge (82) ni en
        capucine (89) ; corriger demanderait de toucher la maquette, donc
        test/apca-check.py le signale « à arbitrer » plutôt que de le valider à un seuil
        complaisant."""
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
    neutres = teintes_neutres_depuis_css()   # --szh-gris-clair / --szh-zebre (éditables)
    lignes = []
    if hexa in PALETTE:
        v = variations_depuis_css(PALETTE[hexa]) or variations_calculees(hexa)
        lignes.append('  --szh-accent-clair: %s;' % v['clair'])
        lignes.append('  --szh-accent-fonce: %s;' % v['fonce'])
        # Jetons de la maquette : même source, un seul bloc.
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
