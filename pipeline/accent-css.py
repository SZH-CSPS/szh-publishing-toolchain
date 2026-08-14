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
# styles/couleurs.css). Un seuil APCA dépend de la TAILLE du texte, il ne vaut jamais
# seul : |Lc| >= 90 pour du texte courant dès 14 px, >= 75 seulement à partir de 18 px,
# >= 60 pour un gros titre (>= 24 px, ou >= 19 px en gras), >= 30 pour un filet.
# Ce qui compte ici : le texte des TABLEAUX est à 13,6 px (print.css, table { font-size:
# 0.85rem }) et le corps à 14 px, donc les deux fonds d'accent (-clair et -fonce) se
# jugent à 90 — et non à 75, comme ce fichier l'a longtemps supposé.
# L'ancien ratio WCAG 2 « 4,5:1 » n'est plus utilisé nulle part.
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
      -clair  = cran 100 (fond à texte noir,  Lc garanti +91) ;
      -fonce  = cran 800 (fond à texte blanc, Lc garanti −90).
    Ces deux cibles ont MONTÉ d'un cran (avant : 200 et 700, garantis à 80). Raison : le
    texte d'un tableau est à 13,6 px, donc son seuil est 90 et non 75 — les crans 200 et
    700 avaient été retenus sous un seuil faux. Conséquence à connaître : pour le rouge,
    -fonce n'est plus la charte #D31932 (qui occupe le cran 700) mais le cran 800.
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
# (Lc 30 sur blanc, à la limite) est concernée : elle est légèrement assombrie.
# Ce seuil-ci ne dépend PAS de la taille : un filet n'est pas du texte.
LC_FILET_CONFORT = 45.0
# Texte de couleur sur le papier blanc.
# ⚠ CETTE VALEUR EST UN HÉRITAGE, et elle n'est pas défendable comme seuil de texte : 78
# avait été choisi comme « plancher texte 75 + petite marge », à l'époque où le projet
# croyait que 75 suffisait au texte courant. Le vrai seuil dépend de la taille, et vaut 90
# dès 14 px (voir apca.seuil_pour).
# Pourquoi elle n'a pourtant pas été relevée ici : --c-annual-text n'a AUCUN consommateur.
# Aucune règle de print.css ne fait `color: var(--c-annual-text)` — le jeton est déclaré
# (print.css § variables) et émis, mais rien ne l'applique. Il n'a donc pas de taille, donc
# pas de seuil déductible, et relever la cible ne changerait la couleur d'aucun texte rendu.
# SI un jour une règle le consomme : mesurer la taille de cette règle et porter la cible à
# apca.seuil_pour(taille) — pour du corps à 14 px, cela veut dire 90, ce qui assombrira
# nettement les six teintes. test/apca-check.py signale ce jeton « à arbitrer » tant que le
# point n'est pas tranché, plutôt que de le valider à un seuil qu'on sait faux.
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
        tel quel s'il tient LC_TEXTE_ANNUEL, et seulement assombri sinon (cas moutarde,
        où le mélange plafonne à Lc 69). Voir la mise en garde sur LC_TEXTE_ANNUEL : ce
        jeton n'a aucun consommateur, donc aucune taille, donc aucun seuil déductible.
      --c-kw-bg : fond des puces de mots-clés (.szh-kw), qui portent du texte noir de
        10 px — plus petit que tout ce que les quatre niveaux d'APCA couvrent. Le mélange
        de la maquette (22 % couleur) n'atteint 90 ni en rouge (82) ni en capucine (89).
        La corriger demanderait de toucher la maquette (taille des puces, print.css) ou
        d'éclaircir le mélange : hors du périmètre de ce lot, donc signalé « à arbitrer »
        par test/apca-check.py au lieu d'être validé à un seuil complaisant."""
    texte, _ = apca.meilleure_polarite(hexa)
    return [
        ('--c-annual',          hexa),
        # Cran 800, comme l'alias -fonce : UNE SEULE règle « fond sombre à texte blanc »
        # dans toute la chaîne, donc le fond négatif d'un tableau et celui de la maquette
        # sont exactement la même couleur. Le cran est lu dans apca.ALIAS plutôt qu'écrit
        # en dur : ces deux jetons doivent bouger ENSEMBLE ou pas du tout, et un numéro
        # recopié ici est précisément ce qui les avait laissés se désynchroniser.
        ('--c-annual-deep',     apca.echelle(hexa)[dict(apca.ALIAS)['fonce']]),
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
