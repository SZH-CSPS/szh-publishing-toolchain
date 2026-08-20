#!/usr/bin/env python3
# apca.py — contraste APCA + gradations de couleur en OKLab. Module PARTAGÉ de la
# chaîne (importé par accent-css.py et par test/apca-check.py). stdlib uniquement :
# le pipeline tourne dans une image WSL minimale (pas de numpy, pas de pip).
#
# POURQUOI APCA et pas WCAG 2 ?
#   Le ratio WCAG 2 (L1+0.05)/(L2+0.05) se trompe lourdement sur les teintes vives et
#   sur les fonds sombres : il déclare « conformes » des textes gris sur noir illisibles
#   et « non conformes » des jaunes parfaitement lisibles. APCA (Accessible Perceptual
#   Contrast Algorithm, brouillon WCAG 3) modélise la perception réelle : une seule
#   valeur Lc (« lightness contrast ») de 0 à ±108, SIGNÉE selon la polarité
#   (positive = texte sombre sur fond clair, négative = texte clair sur fond sombre).
#
# POURQUOI OKLab pour les gradations ?
#   Éclaircir/assombrir en sRGB (mélange avec du blanc, multiplication par un facteur)
#   délave ou dévie la teinte : le rouge tire vers le rose froid, le jaune vers le kaki.
#   OKLab est un espace perceptuellement uniforme : on y bouge la CLARTÉ (L) en gardant
#   la TEINTE (h) constante, ce qui donne une famille de nuances reconnaissable.
#
# Version de référence : APCA-W3 0.1.9 (constantes ci-dessous, ne pas « moderniser »
# sans revalider tout le fichier styles/couleurs.css).

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

# ─── Les quatre niveaux d'APCA, et la TAILLE qui va avec chacun ───────────────────
#
# POURQUOI un seuil ne peut PAS être une constante du projet.
#   Ce fichier a longtemps posé « LC_TEXTE = 75 = texte courant », et c'était FAUX. Un
#   seuil APCA n'a aucun sens tout seul : il ne vaut que pour un couple (taille, graisse).
#   Le même Lc 75 est confortable sur un intertitre de 18 px et nettement insuffisant sur
#   une cellule de tableau de 13,6 px. Poser 75 comme « le » seuil du texte courant, c'est
#   donc valider en bloc tout ce qui est plus petit que 18 px — c'est-à-dire, dans cette
#   maquette, le corps ET les tableaux.
#   Les seuils ci-dessous portent donc la taille DANS leur nom, et le code ne compare
#   jamais une mesure à un seuil sans être passé par `seuil_pour()`.
#
# POURQUOI ces niveaux-là (critères officiels d'APCA, et non un choix maison) :
LC_TEXTE_14 = 90.0      # niveau PRÉFÉRÉ du texte courant, dès 14 px / graisse 400
LC_TEXTE_18 = 75.0      # niveau MINIMUM du texte courant, et seulement dès 18 px / 400
LC_GROS_TITRE = 60.0    # gros texte : >= 24 px, ou >= 19 px en gras
LC_NON_TEXTUEL = 30.0   # plancher non textuel : filets, bordures, séparateurs
#
# POURQUOI 90 est le seuil réel de CETTE maquette, et non 75.
#   Le corps est à 14 px (print.css, --body-size: 0.875rem) et le texte des TABLEAUX à
#   0,85rem, soit 13,6 px. Les deux tombent sous les 18 px qu'exige le niveau 75 : le
#   seuil applicable est donc 90 partout où il y a du texte de lecture, aplats de tableau
#   compris. C'est tout l'objet de cette correction.
#   La revue est principalement NUMÉRIQUE : APCA, conçu pour les écrans auto-lumineux,
#   est pleinement dans son domaine ici.

# Tolérance appliquée à TOUTE comparaison d'une mesure à un seuil. Les hex sont arrondis
# à l'octet : un Lc ne retombe jamais au centième sur une valeur ronde, et refuser 89,7
# au motif qu'il n'est pas 90 serait une rigueur de façade — l'écart est très en dessous
# du seuil de perception. 0,5 laisse passer l'arrondi et rien d'autre ; c'est aussi, et
# ce n'est pas un hasard, la moitié de l'unité d'affichage (voir `lc_affiche`) : une
# valeur qui S'AFFICHE « 90 » SATISFAIT le seuil de 90.
TOLERANCE_SEUIL = 0.5


def seuil_pour(taille_px, gras=False):
    """Le |Lc| qu'exige APCA pour du texte de `taille_px` (graisse 400, ou 700 si `gras`).

    L'ordre des tests va du plus permissif au plus strict, parce que c'est la TAILLE qui
    achète le droit à un seuil bas : plus le texte est gros, moins il demande de
    contraste. Le gras ne vaut que 5 px environ, d'où le 19 px du second test.

    Sous 14 px, le modèle à quatre niveaux ne dit plus rien : APCA ne documente AUCUN
    niveau permissif en dessous — un texte plus petit que 14 px demande davantage que 90,
    pas moins. On renvoie donc le plus exigeant des quatre niveaux, faute de mieux, et
    c'est le cas du texte de TABLEAU à 13,6 px. Le seuil rendu ici est donc un PLANCHER
    pour ces tailles-là, jamais une autorisation."""
    if taille_px >= 24.0 or (gras and taille_px >= 19.0):
        return LC_GROS_TITRE
    if taille_px >= 18.0:
        return LC_TEXTE_18
    return LC_TEXTE_14


def tient(mesure, seuil):
    """La mesure satisfait-elle le seuil, TOLERANCE_SEUIL comprise ?

    Point de passage OBLIGÉ de toute comparaison mesure/seuil dans la chaîne : c'est ce
    qui garantit que le vérificateur, le CSS et la planche disent la même chose d'une même
    couleur. `mesure` peut être signée (la polarité n'entre pas dans le jugement)."""
    return abs(mesure) >= seuil - TOLERANCE_SEUIL


def lc_affiche(valeur, signe=False):
    """Le Lc tel qu'il doit S'ÉCRIRE partout : ARRONDI À L'ENTIER, SANS DÉCIMALE.

    POURQUOI pas de décimale. Un dixième de Lc n'est pas perceptible et ne se reproduit
    pas d'un arrondi hexadécimal à l'autre : l'afficher donnait une fausse précision et,
    pire, invitait à lire « 79,7 » comme « en dessous de 80 » alors que la différence est
    invisible. Un entier dit exactement ce que la mesure sait.
    `signe=True` conserve la polarité, avec le signe moins TYPOGRAPHIQUE (−, U+2212) et
    non le trait d'union : c'est le style de toute la chaîne.
    Arrondi au demi supérieur explicite (floor(x+0,5)) et non `round()`, qui en Python 3
    arrondit 89,5 à 90 mais 90,5 à 90 lui aussi (arrondi bancaire) — un affichage doit
    être prévisible."""
    entier = int(math.floor(abs(valeur) + 0.5))
    if not signe:
        return '%d' % entier
    return '%s%d' % ('+' if valeur >= 0 else '−', entier)


# Libellés d'usage des crans. Ils ne sont pas décoratifs : chacun est une CLÉ de
# SEUIL_USAGE, donc dire l'usage d'un cran suffit à en déduire le seuil à tenir. Écrire
# la taille dans le libellé est délibéré — un cran ne « porte pas du texte courant », il
# porte du texte courant À PARTIR D'UNE CERTAINE TAILLE, et c'est cette nuance que la
# version précédente perdait.
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
    """Ys APCA d'un triplet 0-255. Attention : ce n'est PAS la luminance WCAG
    (APCA applique une puissance 2,4 simple, sans le segment linéaire près du noir,
    puis « adoucit » les quasi-noirs — un écran réel ne rend jamais un noir parfait)."""
    y = sum(k * (c / 255.0) ** _EXP_CANAL for k, c in zip(_COEFF, rgb))
    if y < _SEUIL_NOIR:
        y = y + (_SEUIL_NOIR - y) ** _EXP_NOIR
    return y


def lc(texte, fond):
    """Contraste APCA SIGNÉ entre une couleur de texte et une couleur de fond (hex).

    Positif  : texte sombre sur fond clair  (polarité « normale »).
    Négatif  : texte clair sur fond sombre  (polarité « inverse »).
    0        : sous le plancher de bruit d'APCA (couleurs quasi identiques).
    La polarité n'est pas un paramètre : elle découle de qui est le plus clair."""
    y_texte = luminance(vers_rgb(texte))
    y_fond = luminance(vers_rgb(fond))
    if y_fond > y_texte:
        s = (y_fond ** _N_FOND - y_texte ** _N_TEXTE) * _N_ECHELLE
        return 0.0 if s < _N_CLIP else (s - _N_OFFSET) * 100.0
    s = (y_fond ** _I_FOND - y_texte ** _I_TEXTE) * _I_ECHELLE
    return 0.0 if s > _I_CLIP else (s + _I_OFFSET) * 100.0


def meilleure_polarite(fond):
    """Sur un aplat donné, renvoie (couleur_de_texte, Lc) de la polarité la plus
    lisible : noir ou blanc, celui qui maximise |Lc|. Remplace le vieux test WCAG
    « luminance > 0,5 », qui se trompait sur les teintes saturées."""
    lc_noir, lc_blanc = lc(NOIR, fond), lc(BLANC, fond)
    return (NOIR, lc_noir) if abs(lc_noir) >= abs(lc_blanc) else (BLANC, lc_blanc)


# ═══ 3. sRGB <-> OKLab (Björn Ottosson, 2020) ═════════════════════════════════════
# Chaîne : sRGB 8 bits -> sRGB linéaire -> LMS -> racine cubique -> OKLab. On garde
# les matrices telles que publiées (elles supposent le blanc D65 de sRGB).

def _vers_lineaire(c):
    """Décodage gamma sRGB (0-1 -> 0-1). Ici on utilise la VRAIE courbe sRGB, avec
    son segment linéaire : c'est celle qu'exige OKLab (≠ gamma simple d'APCA)."""
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
    """OKLab -> sRGB LINÉAIRE non borné. Des canaux hors [0, 1] signalent une
    couleur hors gamut sRGB (c'est ce test qui sert à brider la chroma)."""
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
    """OKLab -> (0-255)^3, borné au gamut sRGB (bornage fait en linéaire, donc sans
    dévier la teinte plus que nécessaire)."""
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


# ═══ 4. Gradations : la couleur la plus VIVE qui reste lisible ════════════════════

_EXP_AMORTI = 0.75   # < 1 : garde plus de couleur qu'un fondu linéaire vers blanc/noir


def _chroma_amortie(clarte, clarte_ref, chroma_ref):
    """Chroma visée à une clarté donnée, en partant de la couleur de marque.

    On ne garde PAS la chroma constante : à clarté extrême, une chroma maximale
    donne des tons criards (jaune fluo, bordeaux électrique) et surtout sort du
    gamut sRGB. On la fait donc décroître vers le blanc et vers le noir, mais avec
    un exposant < 1 pour rester nettement plus coloré qu'un simple fondu."""
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
    """Couleur de MÊME TEINTE que `hexa`, à la clarté OKLab demandée, avec la chroma
    la plus élevée qui reste raisonnable et représentable en sRGB."""
    clarte_ref, chroma_ref, teinte = vers_oklch(srgb_vers_oklab(vers_rgb(hexa)))
    chroma = _chroma_gamut(clarte, _chroma_amortie(clarte, clarte_ref, chroma_ref), teinte)
    return vers_hex(oklab_vers_srgb(depuis_oklch((clarte, chroma, teinte))))


def _dichotomie(satisfait, clarte_ok, clarte_ko, iterations=40):
    """Cherche la clarté la plus PROCHE de `clarte_ko` (donc la plus colorée, la plus
    proche de la couleur de marque) qui satisfait encore `satisfait`.

    `clarte_ok` est une clarté extrême connue pour satisfaire le critère (blanc ou
    noir), `clarte_ko` la clarté de la couleur de marque, a priori trop peu
    contrastée. Si la marque satisfait déjà le critère, on la garde telle quelle."""
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
    """Renvoie `hexa` INCHANGÉ s'il convient déjà (l'aller-retour OKLab peut décaler
    un canal de 1/255 : hors de question de « bouger » une couleur de marque pour
    rien), sinon la variante la plus colorée qui convient. `convient` juge un hex."""
    depart = vers_hex(vers_rgb(hexa))
    if convient(depart):
        return depart
    return variante(hexa, _dichotomie(
        lambda l: convient(variante(hexa, l)), clarte_extreme, _clarte(hexa)))


def couleur_sur(hexa, fond, cible):
    """Variante de `hexa` utilisable EN AVANT-PLAN (texte, filet, bordure) sur `fond`
    avec |Lc| >= cible. On assombrit le moins possible pour garder la couleur vive.
    N.B. : sur fond blanc, une couleur vive ne dépassera jamais ~85-95 de Lc — le
    noir pur plafonne déjà à 106."""
    return _resoudre(hexa, lambda h: abs(lc(h, fond)) >= cible, 0.0)


# ═══ 5. L'échelle : 11 crans à CLARTÉ FIXE, dont UN est la couleur de charte ══════
#
# POURQUOI une grille à clarté fixe, et non des crans ancrés sur des cibles de contraste ?
#   L'échelle précédente définissait chaque cran par un objectif de Lc (« le plus coloré
#   qui tienne encore Lc 82 »). Conséquence : un même numéro donnait une clarté DIFFÉRENTE
#   selon la teinte, parce qu'atteindre Lc 82 demande d'assombrir beaucoup un bleu et très
#   peu un jaune. Le « 500 » de la moutarde était donc bien plus clair que celui du rouge,
#   et deux couleurs annuelles au même cran ne se ressemblaient pas.
#   Ici on inverse la logique, comme le font tous les générateurs OKLCH (Tailwind, Radix,
#   Open Props) : le cran FIXE LA CLARTÉ, identique pour les six teintes. Un même numéro
#   = une même clarté = des crans comparables d'une couleur à l'autre. Le contraste n'est
#   plus une cible mais une CONSÉQUENCE, qu'on mesure et qu'on garantit (voir CONTRAT).
#
# POURQUOI la couleur de CHARTE remplace un cran au lieu de vivre à côté ?
#   Une charte est une contrainte EXTERNE : son hex est donné, sa clarté tombe où elle
#   tombe, et elle ne coïncide donc avec aucune clarté de la grille. L'étape précédente en
#   tirait la conclusion la plus rigoureuse : la sortir de la numérotation et lui donner un
#   jeton à part ('marque'). Rigoureux, mais coûteux à l'usage — chaque teinte portait DEUX
#   hex quasi identiques (mountbatten #A98899 la charte, #A88798 le cran 500 calculé, un
#   demi-point de Lc d'écart), et il fallait choisir entre les deux à chaque emploi. Un
#   lecteur de la maquette ne peut pas deviner que « le rouge SZH » n'est aucun des crans
#   nommés rouge.
#   On tranche donc dans l'autre sens : la charte REMPLACE le cran dont elle est la plus
#   proche. Un seul hex par teinte et par cran, et le hex de charte est atteignable par un
#   numéro de la grille. Le prix est explicite et mesuré : sur ce cran-là, les six teintes
#   n'ont plus EXACTEMENT la même clarté. L'écart reste sous 0,015 pour cinq des six
#   remplacements ; il monte à 0,035 pour le rouge, dont la charte tombe pile entre les
#   crans 600 et 700 (0,555 pour 0,59 et 0,52 visés — le même 0,035 quel que soit celui
#   des deux qu'on retienne : c'est la charte qui est entre deux crans, pas le code qui
#   choisit mal). Ces écarts sont ANNONCÉS cran par cran dans styles/couleurs.css et
#   vérifiés par test/apca-check.py, jamais dissimulés.
#
# POURQUOI le cran est CALCULÉ et non codé en dur ?
#   Pour qu'un changement de charte (nouvelle couleur annuelle, retouche d'un hex par le
#   graphiste) déplace tout seul le remplacement sur le bon cran. Coder « rouge -> 700 »
#   en dur, c'est garantir qu'un futur rouge légèrement plus clair restera collé au 700
#   alors que sa vraie place serait le 600, sans que rien ne proteste.

CLARTES = (
    ('50', 0.97), ('100', 0.93), ('200', 0.87), ('300', 0.81), ('400', 0.74),
    ('500', 0.66), ('600', 0.59), ('700', 0.52),
    # 0,444 et NON 0,45 — ne pas « rétablir » 0,45 en croyant corriger une coquille.
    # POURQUOI ce cran seul déroge à la progression régulière : à 0,45 le |Lc| garanti du
    # cran (le pire des six teintes, le poireau) valait 89,51. Il ne franchissait donc le
    # seuil de 90 que par la tolérance, avec 0,009 de marge — neuf MILLIÈMES, c'est-à-dire
    # qu'un simple redécoupage d'un canal au 1/255 aurait fait basculer le cran hors
    # contrat. Or ce cran-là est l'aplat le plus utilisé des tableaux (alias -fonce) et il
    # porte du texte de 13,6 px : sa garantie ne peut pas tenir à un cheveu.
    # Assombrir la cible de 0,006 porte la garantie à 90,19, soit 0,7 de marge SANS
    # recourir à la tolérance. Le déplacement est invisible à l'œil (un à deux niveaux par
    # canal : #A20020 -> #9F001F, #27633C -> #26613B, #575A00 -> #555900).
    # Le prix, assumé : les écarts de clarté voisins passent de 0,07 à 0,076 (700 -> 800)
    # et de 0,07 à 0,064 (800 -> 900). La progression régulière est une COMMODITÉ DE
    # LECTURE de l'échelle ; le seuil de 90 sur un fond de tableau est une PROMESSE
    # d'accessibilité. On sacrifie la première à la seconde.
    ('800', 0.444),
    ('900', 0.38), ('950', 0.31),
)

# Cran DÉCORATIF : le point de croisement où NI le noir NI le blanc n'atteint le seuil
# du gros titre (60). Ce n'est pas un défaut à corriger — toute échelle de couleur
# saturée en possède un : en descendant, le noir perd du contraste plus vite que le
# blanc n'en gagne, et les deux courbes se croisent sous le seuil. On le nomme, on
# l'annote, et on interdit d'y mettre du texte.

# Contrat de chaque cran : {cran: (couleur de texte admise, |Lc| garanti, usage)}.
# Le |Lc| est le PIRE des six teintes, MESURÉ (test/apca-check.py le revérifie cran par
# cran et teinte par teinte : si une valeur d'ici est fausse, le test échoue).
#
# L'USAGE PORTE UNE TAILLE, et c'est la correction de fond de ce lot. Un cran ne « porte
# pas du texte courant » : il en porte à partir d'une certaine taille, parce que c'est la
# taille qui fixe le seuil (voir seuil_pour). Ce que la lecture du contrat donne :
#   dès 14 px      -> |Lc| >= 90 : le corps de la maquette ET les tableaux (13,6 px).
#   à partir de 18 px -> |Lc| >= 75 : intertitres et libellés, PAS le corps ni les tableaux.
#   gros titre     -> |Lc| >= 60 : >= 24 px, ou >= 19 px en gras.
#   aucun texte    -> cran décoratif, vérifié au seul seuil non textuel (30).
# Trois crans ont ainsi CHANGÉ D'USAGE sans changer de couleur, parce que le seuil qui les
# jugeait était faux : 200 et 700 (79,6 et 79,7) passaient pour du « texte courant » alors
# qu'ils ne tiennent 90 dans aucune teinte — ils sont bons dès 18 px, pas à 13,6 px ; et
# 300 (68,3) reste au gros titre. Aucun hex n'a bougé pour eux : c'est l'étiquette qui
# était fausse, pas la couleur.
#
# Deux garanties sont fixées par un hex de CHARTE et non par un cran calculé — conséquence
# directe du remplacement, et elle est à la baisse :
#   500 : 61,1 -> 60,9 (charte bleu acier #5F9FBC). Le seuil gros titre (60) tient encore.
#   700 : 81,3 -> 79,7 (charte rouge #D31932). Le niveau des 18 px (75) tient encore.
# Une troisième vient d'un déplacement de clarté assumé, et elle est à la HAUSSE :
#   800 : 89,5 -> 90,2 (cible de clarté 0,45 -> 0,444, voir CLARTES). C'est ce qui rend le
#         cran 800 utilisable à 14 px sans dépendre de la tolérance.
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

# Dispersion de clarté TOLÉRÉE à l'intérieur d'un cran (max - min des six teintes).
# Sans remplacement elle vaut 0,001 à 0,003 : le seul écart est l'arrondi à l'octet.
# 0,02 laisse passer cet arrondi et les remplacements « serrés » (300 : 0,012 avec la
# moutarde ; 500 : 0,014 avec le bleu acier) et rien d'autre.
DISPERSION_CLARTE = 0.02
# L'exception documentée : la charte rouge tombe à mi-chemin entre les crans 600 et 700,
# donc le cran 700 porte 0,035 de dispersion, inévitablement (0,036 si l'on retenait le
# 600 à la place). On la nomme ici plutôt que d'élargir la tolérance générale, pour qu'une
# dérive sur les DIX autres crans reste détectée.
DISPERSION_CLARTE_EXCEPTION = {'700': 0.04}

# Alias historiques lus par accent-css.py (regex) et par les tableaux .szh-tableau.
# Les NOMS sont figés (accent-css.py et print.css les cherchent tels quels) ; seules
# leurs cibles suivent la grille :
#   normal -> 'marque', c'est-à-dire le CRAN de charte (accents « couleur », filets,
#             aplats de couverture) — le hex n'a pas changé, seul son statut a changé :
#             ce n'est plus un jeton hors grille mais un cran nommé ;
#   clair  -> 100 (fond à texte noir,  |Lc| garanti 91 : conforme dès 14 px) ;
#   fonce  -> 800 (fond à texte blanc, |Lc| garanti 90 : conforme dès 14 px).
#
# POURQUOI -clair et -fonce ont QUITTÉ les crans 200 et 700. Ces deux alias sont les fonds
# des TABLEAUX, et le texte d'un tableau est à 13,6 px (print.css, table { font-size:
# 0.85rem }). Le seuil applicable est donc 90. Or 200 et 700 plafonnent à 80 : ils étaient
# choisis du temps où le projet croyait que « texte courant = 75 », c'est-à-dire pour une
# taille que la maquette n'utilise nulle part. On monte donc d'un cran de chaque côté.
#
# ⚠ CONSÉQUENCE À CONNAÎTRE : le rouge de charte QUITTE le rôle de fond « négatif » des
# tableaux. C'est D80 qui l'y avait amené, en faisant occuper au #D31932 le cran 700, alors
# la cible de -fonce. Mais #D31932 plafonne à 80 avec du texte blanc — suffisant à 18 px,
# insuffisant à 13,6 px. Le fond négatif d'un tableau rouge devient donc le cran 800
# (#9F001F), plus sombre que la charte. La charte rouge reste évidemment partout ailleurs :
# -normal, -marque, --c-annual, filets et aplats de couverture. Elle perd un rôle, pas sa
# place. Aucune autre teinte n'est concernée (leur charte est au 500 ou au 300).
ALIAS = (('normal', 'marque'), ('clair', '100'), ('fonce', '800'))

# Marge de QUASI-ÉGALITÉ sur le |Lc|, pour le choix du cran remplacé. En dessous de cet
# écart, deux crans candidats sont perceptuellement indiscernables : le flottant ne doit
# pas décider seul (une refonte de `variante` d'un centième renverrait un autre cran).
MARGE_EGALITE_LC = 0.3


def cran_de_charte(hexa):
    """Le cran que la couleur de charte REMPLACE dans l'échelle de `hexa`.

    Règle : le cran dont le |Lc| calculé est le plus proche de celui de la charte, PARMI
    LES CRANS DE MÊME POLARITÉ DE TEXTE. La polarité est la contrainte dure — un cran
    « fond sombre à texte blanc » ne peut pas être remplacé par une couleur qui se lit au
    noir, quel que soit son |Lc|. C'est ce qui envoie la moutarde (Lc +73,7, elle se lit
    au NOIR) sur le 300 et non sur le 600, dont le |Lc| est pourtant plus proche.
    On compare des |Lc| plutôt que des clartés parce que c'est le contraste, et lui seul,
    qui décide de ce qu'un cran peut porter : remplacer un cran par une couleur de même
    clarté mais de contraste différent casserait le CONTRAT ; l'inverse le préserve.
    Le cran DÉCORATIF (400) n'a pas de polarité de texte (CONTRAT -> None) : il n'est
    jamais candidat, et c'est heureux — y loger une charte reviendrait à interdire tout
    texte sur la couleur même de la revue.

    Égalité : si plusieurs crans sont à moins de MARGE_EGALITE_LC du meilleur, on prend le
    plus SOMBRE. Cas réel, le rouge #D31932 : 700 à 3,9 d'écart et 600 à 4,1, soit 0,2 —
    sous la marge. Le plus sombre est aussi le meilleur choix éditorial, parce que le |Lc|
    monte quand on descend l'échelle : à 79,7 la charte rouge hérite du cran 700, donc de
    l'usage « texte courant à partir de 18 px », alors que sur le cran 600 elle serait
    limitée au gros titre. En cas de doute, la règle donne donc l'usage le plus large.
    (Elle ne va pas jusqu'à en faire un fond de TABLEAU : à 13,6 px il faut 90, et le 700
    n'y arrive pas — voir la conséquence notée sous ALIAS.)"""
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
    clé 'marque'.

    Dix crans sont calculés : même teinte que `hexa`, clarté imposée par CLARTES, chroma
    la plus vive qui reste dans le gamut sRGB (voir `variante`). Le onzième — celui que
    désigne `cran_de_charte` — vaut EXACTEMENT le hex d'entrée : la charte n'est pas
    approchée, elle est posée telle quelle, et c'est le cran qui adopte sa clarté.
    La clé 'marque' est un simple ALIAS vers ce cran (même hex, aucune nouvelle couleur) :
    elle survit parce que le nom reste utile — « la couleur de la revue » se dit mieux que
    « le cran 700 du rouge » — et parce que ALIAS et styles/couleurs.css l'exposent encore.
    Un seul hex de charte par teinte, atteignable par deux noms."""
    charte = vers_hex(vers_rgb(hexa))
    out = {cran: variante(charte, clarte) for cran, clarte in CLARTES}
    out[cran_de_charte(charte)] = charte
    out['marque'] = charte
    return out


# ═══ 6. Auto-vérification (exécutée à l'import : une palette fausse doit CASSER) ═══

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
    # La RÈGLE D'AFFICHAGE (aucune décimale, signe conservé). Elle est vérifiée ici parce
    # qu'elle est citée dans couleurs.css, dans la planche et dans le vérificateur : si
    # elle dérive, trois fichiers se mettent à mentir en même temps.
    assert lc_affiche(79.665) == '80', lc_affiche(79.665)
    assert lc_affiche(101.997) == '102', lc_affiche(101.997)
    assert lc_affiche(90.194) == '90', lc_affiche(90.194)
    assert lc_affiche(91.392, signe=True) == '+91', lc_affiche(91.392, signe=True)
    assert lc_affiche(-90.194, signe=True) == '−90', lc_affiche(-90.194, signe=True)
    # Arrondi au demi SUPÉRIEUR, y compris sur le demi exact (round() ferait autrement).
    assert lc_affiche(89.5) == '90' and lc_affiche(90.5) == '91'
    # La TOLÉRANCE : « ce qui s'affiche 90 satisfait 90 ». C'est l'invariant qui lie la
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
        # Le |Lc| annoncé doit être COHÉRENT avec l'usage annoncé : un cran qui promet
        # « dès 14 px » avec une garantie de 80 serait un contrat auto-contradictoire, et
        # c'est exactement l'erreur que ce lot corrige. On l'interdit à l'import.
        if _encre is not None:
            assert tient(_garanti, SEUIL_USAGE[_usage]), (_cran, _garanti, _usage)


_autoverification()


if __name__ == '__main__':
    # Générateur pour styles/couleurs.css :
    #     python3 apca.py '#D31932' rouge
    # imprime les 11 crans (Lc annoté, cran de charte signalé) puis l'alias -marque,
    # prêts à coller / comparer.
    import sys
    try:   # signe moins typographique : sortie UTF-8 même en console Windows
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, OSError):
        pass

    def _fr(x):
        """Le Lc au format de couleurs.css : entier signé, signe moins typographique.
        Aucune décimale — voir `lc_affiche`, dont c'est le simple relais nommé."""
        return lc_affiche(x, signe=True)

    def _clarte_fr(clarte):
        """La CLARTÉ, elle, garde ses décimales : ce n'est pas un Lc mais une coordonnée
        OKLab, et le cran 800 vaut 0,444 — un arrondi à deux décimales l'écrirait 0,44 et
        ferait croire à une coquille (voir CLARTES). On affiche donc trois décimales quand
        la troisième porte de l'information, deux sinon."""
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
        # Le cran de charte porte la clarté RÉELLE de la charte, pas la clarté visée : on
        # imprime donc la mesure et l'écart, seule façon de coller ce cran dans le CSS
        # sans perdre l'information du compromis.
        if cran == charte:
            reelle = _clarte(couleur)
            note = (' — COULEUR DE CHARTE, clarté réelle %s pour %s visé (écart %s)'
                    % (_clarte_fr(reelle), _clarte_fr(clarte),
                       ('%+.3f' % (reelle - clarte)).replace('.', ',').replace('-', '−')))
        else:
            note = ''
        if texte is None:   # cran décoratif : on annonce la MEILLEURE polarité, qui échoue
            gagnant, valeur = meilleure_polarite(couleur)
            print('  --c-%s-%s: %s;   /* L %s — %s (le mieux : %s à Lc %s)%s */' % (
                nom, cran, couleur, _clarte_fr(clarte), usage,
                'noir' if gagnant == NOIR else 'blanc', _fr(valeur), note))
            continue
        print('  --c-%s-%s: %s;   /* L %s — texte %s : Lc %s — %s%s */' % (
            nom, cran, couleur, _clarte_fr(clarte),
            'noir ' if texte == NOIR else 'blanc', _fr(lc(texte, couleur)), usage, note))
    # L'alias : un NOM de plus sur le cran de charte, jamais un hex de plus.
    print('  --c-%s-marque: var(--c-%s-%s);   /* = le cran de charte ci-dessus */'
          % (nom, nom, charte))
