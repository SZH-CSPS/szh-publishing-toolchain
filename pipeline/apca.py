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

# ─── Seuils retenus pour ce projet (voir styles/couleurs.css) ─────────────────────
LC_TEXTE = 75.0        # texte courant : corps, cellules et en-têtes de tableau
LC_TEXTE_CONFORT = 90.0
LC_GROS_TITRE = 60.0   # texte >= 24 px (titres de couverture, aplats)
LC_NON_TEXTUEL = 30.0  # filets, bordures, séparateurs vs la surface adjacente


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


# ═══ 5. L'échelle : 11 crans à CLARTÉ FIXE ════════════════════════════════════════
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
# POURQUOI la couleur de marque n'est plus un cran ?
#   Une marque est une contrainte EXTERNE : son hex est donné, sa clarté tombe où elle
#   tombe. Elle ne peut donc pas être simultanément « le cran 500 » et « inchangée » pour
#   les six teintes. Elle sort de la numérotation et prend son propre jeton, 'marque'.
#   Fait notable : quatre des six marques (capucine 0,661 / poireau 0,657 / bleu acier
#   0,671 / mountbatten 0,663) vivent autour de la clarté du cran 500 (0,66). C'est
#   précisément pour ça que l'ancienne convention « la marque = 500 » PARAISSAIT juste :
#   elle l'était pour ces quatre-là, et fausse pour le rouge (0,555, entre 600 et 700) et
#   pour la moutarde (0,821, près de 300).

CLARTES = (
    ('50', 0.97), ('100', 0.93), ('200', 0.87), ('300', 0.81), ('400', 0.74),
    ('500', 0.66), ('600', 0.59), ('700', 0.52), ('800', 0.45), ('900', 0.38),
    ('950', 0.31),
)

# Cran DÉCORATIF : le point de croisement où NI le noir NI le blanc n'atteint le seuil
# du gros titre (60). Ce n'est pas un défaut à corriger — toute échelle de couleur
# saturée en possède un : en descendant, le noir perd du contraste plus vite que le
# blanc n'en gagne, et les deux courbes se croisent sous le seuil. On le nomme, on
# l'annote, et on interdit d'y mettre du texte.
CRAN_DECORATIF = '400'

# Contrat de chaque cran : {cran: (couleur de texte admise, |Lc| garanti, usage)}.
# Le |Lc| est le PIRE des six teintes, MESURÉ (test/apca-check.py le revérifie cran par
# cran et teinte par teinte : si une valeur d'ici est fausse, le test échoue).
#   texte courant  -> |Lc| >= 75 : corps, cellules et en-têtes de tableau.
#   gros titres    -> |Lc| >= 60 : texte >= 24 px seulement.
#   aucun texte    -> cran décoratif (aplat, bande, filet), vérifié au seuil non textuel.
CONTRAT = {
    '50':  (NOIR,  99.8, 'texte courant'),
    '100': (NOIR,  91.4, 'texte courant'),
    '200': (NOIR,  79.6, 'texte courant'),
    '300': (NOIR,  68.3, 'gros titres seulement'),
    '400': (None,  56.3, 'aucun texte (cran décoratif)'),
    '500': (BLANC, 61.1, 'gros titres seulement'),
    '600': (BLANC, 71.7, 'gros titres seulement'),
    '700': (BLANC, 81.3, 'texte courant'),
    '800': (BLANC, 89.5, 'texte courant'),
    '900': (BLANC, 96.4, 'texte courant'),
    '950': (BLANC, 102.0, 'texte courant'),
}

# Alias historiques lus par accent-css.py (regex) et par les tableaux .szh-tableau.
# Les NOMS sont figés (accent-css.py et print.css les cherchent tels quels) ; seules
# leurs cibles suivent la nouvelle grille :
#   normal -> la MARQUE (accents « couleur », filets, aplats de couverture) ;
#   clair  -> 200 (le plus coloré des fonds à texte noir : Lc garanti 79,6) ;
#   fonce  -> 700 (le plus clair des fonds à texte blanc : Lc garanti 81,3).
ALIAS = (('normal', 'marque'), ('clair', '200'), ('fonce', '700'))


def echelle(hexa):
    """Échelle complète d'une couleur de marque : {cran: hex} + la clé 'marque'.

    Les 11 crans sont TOUS calculés : même teinte que `hexa`, clarté imposée par
    CLARTES, chroma la plus vive qui reste dans le gamut sRGB (voir `variante`).
    La clé 'marque' rend le hex d'entrée INTACT : c'est la contrainte externe, elle
    ne tombe sur aucun cran et ne doit jamais être « recalculée »."""
    out = {cran: variante(hexa, clarte) for cran, clarte in CLARTES}
    out['marque'] = vers_hex(vers_rgb(hexa))
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


_autoverification()


if __name__ == '__main__':
    # Générateur pour styles/couleurs.css :
    #     python3 apca.py '#D31932' rouge
    # imprime le jeton de marque puis les 11 crans, Lc annoté, prêts à coller / comparer.
    import sys
    try:   # signe moins typographique : sortie UTF-8 même en console Windows
        sys.stdout.reconfigure(encoding='utf-8')
    except (AttributeError, OSError):
        pass

    def _fr(x):
        """Virgule décimale et signe moins typographique : le style de couleurs.css."""
        return ('%+.1f' % x).replace('.', ',').replace('-', '−')

    hexa = sys.argv[1] if len(sys.argv) > 1 else '#D31932'
    nom = sys.argv[2] if len(sys.argv) > 2 else 'teinte'
    ech = echelle(hexa)
    clarte_marque = _clarte(ech['marque'])
    proche = min(CLARTES, key=lambda c: abs(c[1] - clarte_marque))[0]
    print('  --c-%s-marque: %s;   /* MARQUE, hors grille — clarté %.3f, près du cran %s */'
          % (nom, ech['marque'], clarte_marque, proche))
    for cran, clarte in CLARTES:
        couleur = ech[cran]
        texte, garanti, usage = CONTRAT[cran]
        if texte is None:   # cran décoratif : on annonce la MEILLEURE polarité, qui échoue
            gagnant, valeur = meilleure_polarite(couleur)
            print('  --c-%s-%s: %s;   /* L %.2f — %s (le mieux : %s à Lc %s) */' % (
                nom, cran, couleur, clarte, usage,
                'noir' if gagnant == NOIR else 'blanc', _fr(valeur)))
            continue
        print('  --c-%s-%s: %s;   /* L %.2f — texte %s : Lc %s (%s) */' % (
            nom, cran, couleur, clarte,
            'noir ' if texte == NOIR else 'blanc', _fr(lc(texte, couleur)), usage))
