#!/usr/bin/env python3
# apca.py — contraste APCA et gradations de couleur en OKLab. Module partagé de la chaîne,
# importé par accent-css.py et par test/apca-check.py. stdlib uniquement : le pipeline
# tourne dans une image WSL minimale, sans numpy ni pip.
#
# APCA (Accessible Perceptual Contrast Algorithm, brouillon WCAG 3) donne une valeur Lc de
# 0 à ±108, signée selon la polarité (positive = texte sombre sur fond clair), et modélise
# la perception réelle là où le ratio WCAG 2 se trompe sur les teintes vives et les fonds
# sombres. OKLab sert aux gradations : espace perceptuellement uniforme, on y bouge la
# clarté à teinte constante, ce qu'un éclaircissement en sRGB ne sait pas faire sans
# délaver ni dévier la teinte.
#
# Version de référence : APCA-W3 0.1.9 (constantes ci-dessous). Ne pas les « moderniser »
# sans revalider tout styles/couleurs.css.

import math

# ─── APCA-W3 0.1.9 : constantes figées ────────────────────────────────────────────
_EXP_CANAL = 2.4                       # « simple gamma » APCA (pas la courbe sRGB !)
_COEFF = (0.2126729, 0.7151522, 0.0721750)
_SEUIL_NOIR, _EXP_NOIR = 0.022, 1.414  # « black soft clamp » : compense le voile écran
# Polarité normale (texte SOMBRE sur fond CLAIR)
_N_FOND, _N_TEXTE, _N_ECHELLE, _N_CLIP, _N_OFFSET = 0.56, 0.57, 1.14, 0.1, 0.027
# Polarité inverse (texte CLAIR sur fond SOMBRE)
_I_FOND, _I_TEXTE, _I_ECHELLE, _I_CLIP, _I_OFFSET = 0.65, 0.62, 1.14, -0.1, 0.027

NOIR, BLANC = '#000000', '#FFFFFF'

# ─── Les quatre niveaux d'APCA, et la taille qui va avec chacun ───────────────────
# Un seuil APCA ne vaut que pour un couple (taille, graisse) : le même Lc 75 est
# confortable sur un intertitre de 18 px et insuffisant sur une cellule de tableau de
# 13,6 px. Les seuils portent donc la taille dans leur nom, et le code ne compare jamais
# une mesure à un seuil sans passer par `seuil_pour()`. Ce sont les niveaux officiels
# d'APCA, pas un choix maison.
LC_TEXTE_14 = 90.0      # niveau préféré du texte courant, dès 14 px / graisse 400
LC_TEXTE_18 = 75.0      # niveau minimum du texte courant, et seulement dès 18 px / 400
LC_GROS_TITRE = 60.0    # gros texte : >= 24 px, ou >= 19 px en gras
LC_NON_TEXTUEL = 30.0   # plancher non textuel : filets, bordures, séparateurs
#
# Le seuil réel de cette maquette est donc 90 : le corps est à 14 px et le texte des
# tableaux à 13,6 px, tous deux sous les 18 px qu'exige le niveau 75.

# Tolérance appliquée à toute comparaison d'une mesure à un seuil. Les hex sont arrondis à
# l'octet : un Lc ne retombe jamais au centième sur une valeur ronde, et refuser 89,7 au
# motif qu'il n'est pas 90 serait une rigueur de façade. 0,5 laisse passer l'arrondi et
# rien d'autre ; c'est aussi la moitié de l'unité d'affichage (voir `lc_affiche`), de sorte
# qu'une valeur qui s'affiche « 90 » satisfait le seuil de 90.
TOLERANCE_SEUIL = 0.5


def seuil_pour(taille_px, gras=False):
    """Le |Lc| qu'exige APCA pour du texte de `taille_px` (graisse 400, ou 700 si `gras`).

    Les tests vont du plus permissif au plus strict : c'est la taille qui achète le droit à
    un seuil bas, et le gras ne vaut qu'environ 5 px. Sous 14 px, APCA ne documente aucun
    niveau — un texte plus petit demande davantage que 90, pas moins — donc on renvoie le
    plus exigeant des quatre, comme plancher et non comme autorisation."""
    if taille_px >= 24.0 or (gras and taille_px >= 19.0):
        return LC_GROS_TITRE
    if taille_px >= 18.0:
        return LC_TEXTE_18
    return LC_TEXTE_14


def tient(mesure, seuil):
    """La mesure satisfait-elle le seuil, TOLERANCE_SEUIL comprise ? Passage obligé de
    toute comparaison mesure/seuil : c'est ce qui garantit que le vérificateur, le CSS et
    la planche disent la même chose d'une même couleur. `mesure` peut être signée, la
    polarité n'entrant pas dans le jugement."""
    return abs(mesure) >= seuil - TOLERANCE_SEUIL


def lc_affiche(valeur, signe=False):
    """Le Lc tel qu'il s'écrit partout : arrondi à l'entier, sans décimale — un dixième de
    Lc n'est pas perceptible et ne se reproduit pas d'un arrondi hexadécimal à l'autre.
    `signe=True` conserve la polarité, avec le signe moins typographique (−, U+2212).
    Arrondi au demi supérieur explicite (floor(x+0,5)) et non `round()`, qui en Python 3
    arrondit 89,5 à 90 mais 90,5 à 90 lui aussi."""
    entier = int(math.floor(abs(valeur) + 0.5))
    if not signe:
        return '%d' % entier
    return '%s%d' % ('+' if valeur >= 0 else '−', entier)


# Libellés d'usage des crans : chacun est une clé de SEUIL_USAGE, donc dire l'usage d'un
# cran suffit à en déduire le seuil. La taille est dans le libellé, un cran ne portant pas
# « du texte courant » mais du texte courant à partir d'une certaine taille.
USAGE_TEXTE_14 = 'texte courant dès 14 px'
USAGE_TEXTE_18 = 'texte courant à partir de 18 px'
USAGE_GROS_TITRE = 'gros titre seulement'
USAGE_AUCUN = 'aucun texte (cran décoratif)'

SEUIL_USAGE = {
    USAGE_TEXTE_14: LC_TEXTE_14,
    USAGE_TEXTE_18: LC_TEXTE_18,
    USAGE_GROS_TITRE: LC_GROS_TITRE,
    USAGE_AUCUN: LC_NON_TEXTUEL,
}


# ═══ 1. Conversions élémentaires ══════════════════════════════════════════════════

def vers_rgb(hexa):
    """'#D31932' (ou '#abc') -> (211, 25, 50)."""
    h = hexa.strip().lstrip('#')
    if len(h) == 3:
        h = ''.join(c * 2 for c in h)
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def vers_hex(rgb):
    """(211.4, 25, 50) -> '#D31932' (arrondi + bornage 0-255)."""
    return '#' + ''.join('%02X' % max(0, min(255, int(round(c)))) for c in rgb)


# ═══ 2. Luminance et contraste APCA ═══════════════════════════════════════════════

def luminance(rgb):
    """Ys APCA d'un triplet 0-255. Ce n'est pas la luminance WCAG : puissance 2,4 simple,
    sans le segment linéaire près du noir, puis adoucissement des quasi-noirs."""
    y = sum(k * (c / 255.0) ** _EXP_CANAL for k, c in zip(_COEFF, rgb))
    if y < _SEUIL_NOIR:
        y = y + (_SEUIL_NOIR - y) ** _EXP_NOIR
    return y


def lc(texte, fond):
    """Contraste APCA signé entre une couleur de texte et une couleur de fond (hex) :
    positif pour du texte sombre sur fond clair, négatif pour l'inverse, 0 sous le
    plancher de bruit d'APCA. La polarité découle de qui est le plus clair."""
    y_texte = luminance(vers_rgb(texte))
    y_fond = luminance(vers_rgb(fond))
    if y_fond > y_texte:
        s = (y_fond ** _N_FOND - y_texte ** _N_TEXTE) * _N_ECHELLE
        return 0.0 if s < _N_CLIP else (s - _N_OFFSET) * 100.0
    s = (y_fond ** _I_FOND - y_texte ** _I_TEXTE) * _I_ECHELLE
    return 0.0 if s > _I_CLIP else (s + _I_OFFSET) * 100.0


def meilleure_polarite(fond):
    """Sur un aplat donné, renvoie (couleur_de_texte, Lc) de la polarité la plus lisible :
    noir ou blanc, celui qui maximise |Lc|."""
    lc_noir, lc_blanc = lc(NOIR, fond), lc(BLANC, fond)
    return (NOIR, lc_noir) if abs(lc_noir) >= abs(lc_blanc) else (BLANC, lc_blanc)


# ═══ 3. sRGB <-> OKLab (Björn Ottosson, 2020) ═════════════════════════════════════
# sRGB 8 bits -> sRGB linéaire -> LMS -> racine cubique -> OKLab. Matrices telles que
# publiées ; elles supposent le blanc D65 de sRGB.

def _vers_lineaire(c):
    """Décodage gamma sRGB (0-1 -> 0-1), vraie courbe avec son segment linéaire : c'est
    celle qu'exige OKLab, différente du gamma simple d'APCA."""
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def _depuis_lineaire(c):
    """Encodage gamma sRGB (0-1 -> 0-1)."""
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def srgb_vers_oklab(rgb):
    """(0-255)^3 -> (L, a, b) OKLab. L ~ 0 (noir) à ~1 (blanc)."""
    r, v, b = (_vers_lineaire(c / 255.0) for c in rgb)
    l = 0.4122214708 * r + 0.5363325363 * v + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * v + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * v + 0.6299787005 * b
    l_, m_, s_ = (math.copysign(abs(x) ** (1 / 3), x) for x in (l, m, s))
    return (
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    )


def _oklab_vers_lineaire(lab):
    """OKLab -> sRGB linéaire non borné : des canaux hors [0, 1] signalent une couleur
    hors gamut, et c'est ce test qui bride la chroma."""
    L, a, b = lab
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    return (
        +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    )


def oklab_vers_srgb(lab):
    """OKLab -> (0-255)^3, borné au gamut sRGB en linéaire, sans dévier la teinte."""
    lin = _oklab_vers_lineaire(lab)
    return tuple(255.0 * _depuis_lineaire(min(1.0, max(0.0, c))) for c in lin)


def dans_gamut(lab, tolerance=1e-4):
    """La couleur OKLab est-elle représentable en sRGB (sans écrêtage) ?"""
    return all(-tolerance <= c <= 1.0 + tolerance for c in _oklab_vers_lineaire(lab))


def vers_oklch(lab):
    """OKLab (L, a, b) -> OKLCh (L, chroma, teinte en radians)."""
    L, a, b = lab
    return (L, math.hypot(a, b), math.atan2(b, a))


def depuis_oklch(lch):
    """OKLCh (L, chroma, teinte rad) -> OKLab (L, a, b)."""
    L, c, h = lch
    return (L, c * math.cos(h), c * math.sin(h))


# ═══ 4. Gradations : la couleur la plus vive qui reste lisible ════════════════════

_EXP_AMORTI = 0.75   # < 1 : garde plus de couleur qu'un fondu linéaire vers blanc/noir


def _chroma_amortie(clarte, clarte_ref, chroma_ref):
    """Chroma visée à une clarté donnée, en partant de la couleur de marque. Elle n'est
    pas constante : à clarté extrême, une chroma maximale donne des tons criards et sort du
    gamut sRGB. Elle décroît donc vers le blanc et vers le noir, avec un exposant < 1 pour
    rester plus coloré qu'un simple fondu."""
    if clarte >= clarte_ref:
        t = (1.0 - clarte) / (1.0 - clarte_ref) if clarte_ref < 1.0 else 0.0
    else:
        t = clarte / clarte_ref if clarte_ref > 0.0 else 0.0
    return chroma_ref * max(0.0, min(1.0, t)) ** _EXP_AMORTI


def _chroma_gamut(clarte, chroma, teinte):
    """Ramène `chroma` dans le gamut sRGB à clarté et teinte constantes (dichotomie :
    la frontière du gamut n'a pas de forme analytique simple en OKLab)."""
    if dans_gamut(depuis_oklch((clarte, chroma, teinte))):
        return chroma
    bas, haut = 0.0, chroma
    for _ in range(30):
        milieu = (bas + haut) / 2.0
        if dans_gamut(depuis_oklch((clarte, milieu, teinte))):
            bas = milieu
        else:
            haut = milieu
    return bas


def variante(hexa, clarte):
    """Couleur de même teinte que `hexa`, à la clarté OKLab demandée, avec la chroma
    la plus élevée qui reste raisonnable et représentable en sRGB."""
    clarte_ref, chroma_ref, teinte = vers_oklch(srgb_vers_oklab(vers_rgb(hexa)))
    chroma = _chroma_gamut(clarte, _chroma_amortie(clarte, clarte_ref, chroma_ref), teinte)
    return vers_hex(oklab_vers_srgb(depuis_oklch((clarte, chroma, teinte))))


def _dichotomie(satisfait, clarte_ok, clarte_ko, iterations=40):
    """Cherche la clarté la plus proche de `clarte_ko`, donc la plus colorée, qui satisfait
    encore `satisfait`. `clarte_ok` est une clarté extrême (blanc ou noir) connue pour
    satisfaire le critère. Si la marque satisfait déjà, on la garde."""
    if satisfait(clarte_ko):
        return clarte_ko
    for _ in range(iterations):
        milieu = (clarte_ok + clarte_ko) / 2.0
        if satisfait(milieu):
            clarte_ok = milieu
        else:
            clarte_ko = milieu
    return clarte_ok


def _clarte(hexa):
    return srgb_vers_oklab(vers_rgb(hexa))[0]


def _resoudre(hexa, convient, clarte_extreme):
    """Renvoie `hexa` inchangé s'il convient déjà — l'aller-retour OKLab peut décaler un
    canal de 1/255 — sinon la variante la plus colorée qui convient."""
    depart = vers_hex(vers_rgb(hexa))
    if convient(depart):
        return depart
    return variante(hexa, _dichotomie(
        lambda l: convient(variante(hexa, l)), clarte_extreme, _clarte(hexa)))


def couleur_sur(hexa, fond, cible):
    """Variante de `hexa` utilisable en avant-plan (texte, filet, bordure) sur `fond` avec
    |Lc| >= cible ; on assombrit le moins possible. Sur fond blanc, une couleur vive ne
    dépasse jamais ~85-95 de Lc, le noir pur plafonnant à 106."""
    return _resoudre(hexa, lambda h: abs(lc(h, fond)) >= cible, 0.0)


# ═══ 5. L'échelle : 11 crans à clarté fixe, dont un est la couleur de charte ══════
# Le cran fixe la clarté, identique pour les six teintes, comme le font les générateurs
# OKLCH : un même numéro donne des crans comparables d'une couleur à l'autre, et le
# contraste devient une conséquence qu'on mesure (voir CONTRAT).
# La couleur de charte remplace le cran dont elle est la plus proche plutôt que de vivre à
# côté : un seul hex par teinte et par cran. Le prix est mesuré — sur ce cran-là, les six
# teintes n'ont plus exactement la même clarté (écart sous 0,015, sauf 0,035 pour le
# rouge), et l'écart est annoncé cran par cran dans styles/couleurs.css. Le cran remplacé
# est calculé et non codé en dur, pour qu'une retouche de charte le déplace toute seule.

CLARTES = (
    ('50', 0.97), ('100', 0.93), ('200', 0.87), ('300', 0.81), ('400', 0.74),
    ('500', 0.66), ('600', 0.59), ('700', 0.52),
    # 0,444 et non 0,45 : ne pas « rétablir » 0,45 en croyant corriger une coquille. À
    # 0,45, le |Lc| garanti du cran valait 89,51 et ne franchissait 90 que par la
    # tolérance, à neuf millièmes près — or ce cran est l'aplat le plus utilisé des
    # tableaux (alias -fonce) et il porte du texte de 13,6 px. Assombrir la cible de 0,006
    # porte la garantie à 90,19 pour un déplacement invisible.
    ('800', 0.444),
    ('900', 0.38), ('950', 0.31),
)

# Le cran 400 est décoratif : point de croisement où ni le noir ni le blanc n'atteint le
# seuil du gros titre. Toute échelle saturée en possède un ; on l'annote et on interdit
# d'y mettre du texte.

# Contrat de chaque cran : {cran: (couleur de texte admise, |Lc| garanti, usage)}. Le |Lc|
# est le pire des six teintes, mesuré ; test/apca-check.py le revérifie teinte par teinte
# et échoue si une valeur d'ici est fausse. L'usage porte une taille, puisque c'est elle
# qui fixe le seuil (voir seuil_pour) :
#   dès 14 px         -> |Lc| >= 90 : le corps de la maquette et les tableaux (13,6 px) ;
#   à partir de 18 px -> |Lc| >= 75 : intertitres et libellés, ni corps ni tableaux ;
#   gros titre        -> |Lc| >= 60 : >= 24 px, ou >= 19 px en gras ;
#   aucun texte       -> cran décoratif, vérifié au seul seuil non textuel (30).
# Trois garanties ne viennent pas d'un cran calculé : le 500 (60,9) et le 700 (79,7) sont
# fixés par les chartes bleu acier et rouge, le 800 (90,2) par le déplacement de clarté.
CONTRAT = {
    '50':  (NOIR,  99.8, USAGE_TEXTE_14),
    '100': (NOIR,  91.4, USAGE_TEXTE_14),
    '200': (NOIR,  79.6, USAGE_TEXTE_18),
    '300': (NOIR,  68.3, USAGE_GROS_TITRE),
    '400': (None,  56.3, USAGE_AUCUN),
    '500': (BLANC, 60.9, USAGE_GROS_TITRE),
    '600': (BLANC, 71.7, USAGE_GROS_TITRE),
    '700': (BLANC, 79.7, USAGE_TEXTE_18),
    '800': (BLANC, 90.2, USAGE_TEXTE_14),
    '900': (BLANC, 96.4, USAGE_TEXTE_14),
    '950': (BLANC, 102.0, USAGE_TEXTE_14),
}

# Dispersion de clarté tolérée à l'intérieur d'un cran (max - min des six teintes). Sans
# remplacement elle vaut 0,001 à 0,003, l'écart n'étant que l'arrondi à l'octet ; 0,02
# laisse passer cet arrondi et les remplacements serrés (300 avec la moutarde, 500 avec le
# bleu acier), rien d'autre.
DISPERSION_CLARTE = 0.02
# Exception documentée : la charte rouge tombe à mi-chemin entre les crans 600 et 700,
# donc le cran 700 porte inévitablement 0,035 de dispersion. On la nomme ici plutôt que
# d'élargir la tolérance générale, pour qu'une dérive sur les dix autres crans reste
# détectée.
DISPERSION_CLARTE_EXCEPTION = {'700': 0.04}

# Alias lus par accent-css.py (par expression régulière) et par les tableaux
# .szh-tableau. Les noms sont figés, seules leurs cibles suivent la grille :
#   normal -> 'marque', le cran de charte (accents, filets, aplats de couverture) ;
#   clair  -> 100 (fond à texte noir,  |Lc| garanti 91 : conforme dès 14 px) ;
#   fonce  -> 800 (fond à texte blanc, |Lc| garanti 90 : conforme dès 14 px).
# -clair et -fonce sont les fonds des tableaux, dont le texte est à 13,6 px : le seuil
# applicable est 90, or les crans 200 et 700 plafonnent à 80.
# ⚠ Conséquence : le rouge de charte quitte le rôle de fond « négatif » des tableaux, qui
# revient au cran 800 (#9F001F) ; il reste la couleur de la revue partout ailleurs.
ALIAS = (('normal', 'marque'), ('clair', '100'), ('fonce', '800'))

# Marge de quasi-égalité sur le |Lc|, pour le choix du cran remplacé. En dessous de cet
# écart, deux crans candidats sont perceptuellement indiscernables : le flottant ne doit
# pas décider seul, une refonte de `variante` d'un centième renverrait un autre cran.
MARGE_EGALITE_LC = 0.3


def cran_de_charte(hexa):
    """Le cran que la couleur de charte REMPLACE dans l'échelle de `hexa`.

    Règle : le cran dont le |Lc| calculé est le plus proche de celui de la charte, parmi
    les crans de même polarité de texte. La polarité est la contrainte dure — c'est elle
    qui envoie la moutarde (Lc +73,7, lue au noir) sur le 300 et non sur le 600, pourtant
    plus proche. Le cran décoratif (400) n'a pas de polarité (CONTRAT -> None) et n'est
    donc jamais candidat.

    Égalité : si plusieurs crans sont à moins de MARGE_EGALITE_LC du meilleur, on prend le
    plus sombre, dont le |Lc| est le plus élevé et l'usage le plus large. Cas réel, le
    rouge #D31932 : 700 à 3,9 d'écart et 600 à 4,1."""
    charte = vers_hex(vers_rgb(hexa))
    encre, lc_charte = meilleure_polarite(charte)
    cible = abs(lc_charte)
    candidats = [
        (abs(abs(lc(encre, variante(charte, clarte))) - cible), clarte, cran)
        for cran, clarte in CLARTES if CONTRAT[cran][0] == encre
    ]
    meilleur = min(ecart for ecart, _, _ in candidats)
    # clarte la plus basse = cran le plus sombre = |Lc| le plus élevé.
    return min((c for c in candidats if c[0] <= meilleur + MARGE_EGALITE_LC),
               key=lambda c: c[1])[2]


def echelle(hexa):
    """Échelle complète d'une couleur de charte : {cran: hex} pour les 11 crans, plus la
    clé 'marque'. Dix crans sont calculés (même teinte, clarté imposée par CLARTES, chroma
    la plus vive qui tienne dans le gamut sRGB) ; le onzième, désigné par
    `cran_de_charte`, vaut exactement le hex d'entrée. 'marque' est un alias vers ce
    cran."""
    charte = vers_hex(vers_rgb(hexa))
    out = {cran: variante(charte, clarte) for cran, clarte in CLARTES}
    out[cran_de_charte(charte)] = charte
    out['marque'] = charte
    return out


# ═══ 6. Auto-vérification, exécutée à l'import : une palette fausse doit casser ═══

def _autoverification():
    # Les deux valeurs de référence d'APCA-W3 0.1.9. Si elles bougent, l'implémentation
    # est fausse : tout le reste du fichier couleurs.css devient faux avec elle.
    assert abs(lc(NOIR, BLANC) - 106.0) < 0.1, lc(NOIR, BLANC)
    assert abs(lc(BLANC, NOIR) + 107.9) < 0.1, lc(BLANC, NOIR)
    # Aller-retour sRGB -> OKLab -> sRGB : la génération des gradations en dépend.
    for h in ('#000000', '#FFFFFF', '#D31932', '#EB5E51', '#C7CF1C', '#51A66D',
              '#5F9FBC', '#A98899', '#808080', '#0A0D14', '#123456', '#FEDCBA'):
        rgb = vers_rgb(h)
        retour = oklab_vers_srgb(srgb_vers_oklab(rgb))
        assert all(abs(a - b) <= 1.0 for a, b in zip(rgb, retour)), (h, retour)
    # La règle d'affichage (aucune décimale, signe conservé). Vérifiée ici parce qu'elle
    # est citée dans couleurs.css, dans la planche et dans le vérificateur : si elle
    # dérive, trois fichiers se mettent à mentir en même temps.
    assert lc_affiche(79.665) == '80', lc_affiche(79.665)
    assert lc_affiche(101.997) == '102', lc_affiche(101.997)
    assert lc_affiche(90.194) == '90', lc_affiche(90.194)
    assert lc_affiche(91.392, signe=True) == '+91', lc_affiche(91.392, signe=True)
    assert lc_affiche(-90.194, signe=True) == '−90', lc_affiche(-90.194, signe=True)
    # Arrondi au demi supérieur, y compris sur le demi exact (round() ferait autrement).
    assert lc_affiche(89.5) == '90' and lc_affiche(90.5) == '91'
    # La tolérance : « ce qui s'affiche 90 satisfait 90 ». C'est l'invariant qui lie la
    # règle d'affichage à la règle de contrôle ; sans lui, la planche pourrait afficher
    # « 90 » sur un cran que le vérificateur refuse.
    assert tient(89.5, LC_TEXTE_14) and not tient(89.49, LC_TEXTE_14)
    assert tient(-89.6, LC_TEXTE_14), 'la polarité ne doit pas entrer dans le jugement'
    # Les seuils par TAILLE, y compris les deux tailles réelles de la maquette.
    assert seuil_pour(13.6) == LC_TEXTE_14, 'texte de tableau (0,85rem) : 90, pas 75'
    assert seuil_pour(14.0) == LC_TEXTE_14, 'corps (--body-size 0,875rem) : 90'
    assert seuil_pour(18.0) == LC_TEXTE_18
    assert seuil_pour(19.0) == LC_TEXTE_18 and seuil_pour(19.0, gras=True) == LC_GROS_TITRE
    assert seuil_pour(24.0) == LC_GROS_TITRE
    # Tout usage du CONTRAT doit savoir déduire son seuil, sinon le vérificateur ne peut
    # pas juger le cran.
    for _cran, (_encre, _garanti, _usage) in CONTRAT.items():
        assert _usage in SEUIL_USAGE, (_cran, _usage)
        # Le |Lc| annoncé doit être cohérent avec l'usage annoncé : un cran qui promet
        # « dès 14 px » avec une garantie de 80 serait un contrat auto-contradictoire.
        # On l'interdit dès l'import.
        if _encre is not None:
            assert tient(_garanti, SEUIL_USAGE[_usage]), (_cran, _garanti, _usage)


_autoverification()


if __name__ == '__main__':
    # Générateur pour styles/couleurs.css :
    #     python3 apca.py '#D31932' rouge
    # imprime les 11 crans (Lc annoté, cran de charte signalé) puis l'alias -marque,
    # prêts à coller ou à comparer.
    import sys
    try:   # signe moins typographique : sortie UTF-8 même en console Windows
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, OSError):
        pass

    def _fr(x):
        """Le Lc au format de couleurs.css : entier signé, signe moins typographique.
        Simple relais nommé de `lc_affiche`."""
        return lc_affiche(x, signe=True)

    def _clarte_fr(clarte):
        """La clarté garde ses décimales : ce n'est pas un Lc mais une coordonnée OKLab,
        et le cran 800 vaut 0,444 — arrondi à deux décimales il s'écrirait 0,44 et ferait
        croire à une coquille (voir CLARTES). Trois décimales quand la troisième porte de
        l'information, deux sinon."""
        texte = ('%.3f' % clarte).rstrip('0')
        if len(texte.split('.')[1]) < 2:
            texte = '%.2f' % clarte
        return texte.replace('.', ',')

    hexa = sys.argv[1] if len(sys.argv) > 1 else '#D31932'
    nom = sys.argv[2] if len(sys.argv) > 2 else 'teinte'
    ech = echelle(hexa)
    charte = cran_de_charte(hexa)
    for cran, clarte in CLARTES:
        couleur = ech[cran]
        texte, garanti, usage = CONTRAT[cran]
        # Le cran de charte porte la clarté réelle de la charte, pas la clarté visée : on
        # imprime donc la mesure et l'écart, seule façon de coller ce cran dans le CSS
        # sans perdre l'information du compromis.
        if cran == charte:
            reelle = _clarte(couleur)
            note = (' — COULEUR DE CHARTE, clarté réelle %s pour %s visé (écart %s)'
                    % (_clarte_fr(reelle), _clarte_fr(clarte),
                       ('%+.3f' % (reelle - clarte)).replace('.', ',').replace('-', '−')))
        else:
            note = ''
        if texte is None:   # cran décoratif : on annonce la meilleure polarité, qui échoue
            gagnant, valeur = meilleure_polarite(couleur)
            print('  --c-%s-%s: %s;   /* L %s — %s (le mieux : %s à Lc %s)%s */' % (
                nom, cran, couleur, _clarte_fr(clarte), usage,
                'noir' if gagnant == NOIR else 'blanc', _fr(valeur), note))
            continue
        print('  --c-%s-%s: %s;   /* L %s — texte %s : Lc %s — %s%s */' % (
            nom, cran, couleur, _clarte_fr(clarte),
            'noir ' if texte == NOIR else 'blanc', _fr(lc(texte, couleur)), usage, note))
    # L'alias : un nom de plus sur le cran de charte, jamais un hex de plus.
    print('  --c-%s-marque: var(--c-%s-%s);   /* = le cran de charte ci-dessus */'
          % (nom, nom, charte))
