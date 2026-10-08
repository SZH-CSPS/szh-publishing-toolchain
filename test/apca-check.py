#!/usr/bin/env python3
# Vérifie le contraste APCA de toute la palette.
#
#   python3 test/apca-check.py    -> tableau ; sortie 0 si tout passe, 1 sinon.
#
# À relancer après une retouche de pipeline/styles/couleurs.css, socle.css, print.css ou
# de pipeline/accent-css.py. Le script lit les couleurs et les tailles dans ces fichiers
# (renvois var() suivis) et les jetons émis par accent-css.py, puis mesure.
#
# Le seuil APCA dépend de la taille du texte : 90 dès 14 px, 75 dès 18 px, 60 pour un gros
# texte (24 px, ou 19 px en gras), 30 pour un élément non textuel. Chaque paire déclare sa
# taille et apca.seuil_pour en déduit le seuil ; aucun seuil n'est écrit en dur.
#
# pipeline/apca.py fixe l'affichage : Lc arrondis à l'entier (apca.lc_affiche), tolérance
# de 0,5 sur toute comparaison (apca.tient). Les lignes de diagnostic sous le tableau
# gardent une décimale pour juger des marges fines.
#
# Un filet sur un aplat de sa propre teinte n'est pas mesuré : il suffit qu'il se
# détache du papier ou du zébrage, tous deux mesurés.
#
# Bibliothèque standard seulement.

import importlib.util
import os
import re
import sys

# Sorties en UTF-8, pour que les accents restent lisibles dans une console Windows.
try:
    sys.stdout.reconfigure(encoding='utf-8')
    sys.stderr.reconfigure(encoding='utf-8')
except (AttributeError, OSError):   # flux non reconfigurable
    pass

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE = os.path.join(RACINE, 'pipeline')
sys.path.insert(0, PIPELINE)

import apca  # noqa: E402  (après l'insertion du chemin)


def _charger(nom_module, chemin):
    """Importe un fichier .py dont le nom contient un tiret (accent-css.py)."""
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


accent = _charger('accent_css', os.path.join(PIPELINE, 'accent-css.py'))

NOIR, BLANC = '#000000', '#FFFFFF'

# ---- socle.css + print.css, lus comme une seule feuille ----
# Les encres du hero, de l'en-tête et du pied courants ne viennent pas de la palette
# annuelle : elles sont écrites dans socle.css (jetons :root) ou dans print.css. On les lit
# sélecteur par sélecteur, pour qu'une règle modifiée ou supprimée fasse réagir le test.
#
# Les deux feuilles sont concaténées dans l'ordre du Makefile, car une règle de print.css
# renvoie souvent à un jeton de socle.css. Les tailles TAILLE_* sont lues de la même façon.
CHEMINS_CSS = [os.path.join(PIPELINE, 'styles', n) for n in ('socle.css', 'print.css')]
morceaux = []
for chemin in CHEMINS_CSS:
    try:
        with open(chemin, encoding='utf-8') as f:
            # Commentaires retirés : ils citent des hex et des jetons qui seraient pris
            # pour des déclarations.
            morceaux.append(re.sub(r'/\*.*?\*/', '', f.read(), flags=re.S))
    except OSError:
        pass
PRINT = '\n'.join(morceaux)

# (liste de sélecteurs, corps) pour chaque bloc de règles. Les blocs imbriqués de @page et
# de @media ressortent mal découpés, ce qui est sans effet sur les sélecteurs cherchés.
BLOCS = [(m.group(1), m.group(2)) for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', PRINT)]


def _un_seul_espace(texte):
    return re.sub(r'\s+', ' ', texte).strip()


def _declaration(selecteur, propriete):
    """Valeur brute que la feuille donne à `propriete` pour `selecteur`, ou None.

    Le dernier bloc l'emporte, comme dans la cascade à spécificité égale ; un sélecteur
    groupé (« a, b { … } ») compte pour chacun de ses membres. Le lookbehind empêche de
    trouver `color` dans `background-color`. Pour un jeton, le sélecteur est :root."""
    motif = re.compile(r'(?<![-\w])' + re.escape(propriete) + r'\s*:\s*([^;}]+)')
    cible = _un_seul_espace(selecteur)
    trouve = None
    for selecteurs, corps in BLOCS:
        if not any(_un_seul_espace(s) == cible for s in selecteurs.split(',')):
            continue
        for m in motif.finditer(corps):
            trouve = m.group(1)
    return trouve


# ---- Jetons de taille ----
REM_EN_PX = 16   # html { font-size: 100% } dans print.css : 1 rem = 16 px


def taille_depuis_jeton(jeton):
    """Valeur du jeton `--jeton` du :root, en px (ou en facteur pour % et em).

    Jeton absent, nombre illisible ou autre unité : RuntimeError."""
    brut = _declaration(':root', jeton)
    if brut is None:
        raise RuntimeError('%s introuvable dans le :root de socle.css/print.css' % jeton)
    brut = brut.strip()
    m = re.match(r'^(-?\d+(?:\.\d+)?)(px|rem|%|em)$', brut)
    if m is None:
        raise RuntimeError('%s vaut « %s » : nombre ou unité non reconnu' % (jeton, brut))
    nombre, unite = float(m.group(1)), m.group(2)
    if unite == 'px':
        return nombre
    if unite == 'rem':
        return nombre * REM_EN_PX
    if unite == '%':
        return nombre / 100
    return nombre   # em : facteur, à multiplier par la taille de référence


# ---- Tailles de la maquette, d'où viennent les seuils ----
# Une taille introuvable arrête le script : mesurer un contraste sur une taille devinée
# donnerait un résultat sans valeur.
try:
    TAILLE_TABLEAU = taille_depuis_jeton('--corps-tableau')       # texte de tableau
    TAILLE_CORPS = taille_depuis_jeton('--body-size')             # corps de texte
    TAILLE_KW = taille_depuis_jeton('--corps-mots-cles')          # puces .szh-kw
    TAILLE_GROS_TITRE = 24.0
    # Hero de couverture et pages courantes. Aucune de ces tailles n'est entre 19 et 24 px,
    # seule plage où la graisse change le seuil : `gras` n'est donc pas passé.
    TAILLE_HERO_ETIQUETTE = taille_depuis_jeton('--corps-etiquette-hero')  # .szh-hero-eyebrow / -dossier / -vol (700, capitales)
    TAILLE_HERO_TITRE = taille_depuis_jeton('--corps-titre-hero')          # .szh-title
    TAILLE_HERO_SOUSTITRE = taille_depuis_jeton('--corps-soustitre-hero')  # .szh-subtitle
    TAILLE_HERO_META = taille_depuis_jeton('--corps-meta-hero')            # ul.szh-authors et .szh-doi
    TAILLE_HERO_LICENCE = taille_depuis_jeton('--corps-licence-hero')      # .szh-licence
    TAILLE_COURANTE = taille_depuis_jeton('--corps-courante')              # .szh-entete-courante et .szh-pied-courant
except RuntimeError as exc:
    print('[apca-check] %s : contrôle abandonné plutôt que de mesurer un contraste sur '
          'une taille devinée.' % exc, file=sys.stderr)
    sys.exit(1)

# Les aplats d'accent sont d'abord des fonds de tableau.
SEUIL_TABLEAU = apca.seuil_pour(TAILLE_TABLEAU)      # 90
GROS_TITRE = apca.seuil_pour(TAILLE_GROS_TITRE)      # 60
NON_TEXTE = apca.LC_NON_TEXTUEL                      # 30, pour un filet ou un aplat

# Les 6 couleurs de marque (COULEURS_NUMERO du cockpit, PALETTE d'accent-css.py).
COULEURS = [('rouge', '#D31932'), ('capucine', '#EB5E51'), ('moutarde', '#C7CF1C'),
            ('poireau', '#51A66D'), ('bleuacier', '#5F9FBC'), ('mountbatten', '#A98899')]

# Crans du plus clair au plus sombre. apca.CONTRAT[cran] = (couleur de texte admise ou
# None, |Lc| garanti, libellé d'usage).
CRANS = [cran for cran, _ in apca.CLARTES]

# Tolérance de la chaîne, appliquée au |Lc| garanti comme au seuil d'usage.
MARGE_GARANTI = apca.TOLERANCE_SEUIL

CSS = accent.couleurs_css()
lignes = []      # (libelle, texte, fond, lc, seuil, ok)
manquants = []   # variables introuvables dans couleurs.css
ecarts = []      # (libelle, lc mesuré, |Lc| garanti annoncé) quand le contrat est en deçà
alterees = []    # (nom, cran, hex de charte, hex lu) si le cran de charte n'est pas la charte
alias_faux = []  # (nom, cran, hex de charte, hex lu) si -marque n'est plus l'alias du cran
dispersions = [] # (cran, min, max, dispersion, tolérance, ok) — une ligne par cran
arbitrages = []  # (libelle, lc mesuré, seuil, raison) — voir HORS_PERIMETRE

# ---- Paires hors périmètre ----
# Mesurées au bon seuil, mais un échec n'arrête pas le script : il est listé « à arbitrer »
# avec sa raison, car le corriger demande une décision de maquette.
HORS_PERIMETRE = {
    '--c-kw-bg': "puces .szh-kw à 10 px (print.css) : plus petit que tout ce que les "
                 "quatre niveaux d'APCA couvrent. Corriger = grossir la puce (print.css) "
                 "ou éclaircir le mélange à 22 % (accent-css.py).",
}


def var(nom):
    """Hex d'une variable de couleurs.css (renvois var() suivis) ; None si absente."""
    hexa = accent.resoudre_variable(CSS, nom)
    if hexa is None:
        manquants.append(nom)
    return hexa


regles_absentes = []   # (sélecteur, propriété) introuvables dans la feuille


def couleur_de(selecteur, propriete='color'):
    """Hex de `propriete` pour `selecteur`, renvois var() résolus dans la feuille puis dans
    couleurs.css. Lit aussi un raccourci (`border-top: 1px solid var(--c-rule)`).
    None si la règle ou la propriété manque : la paire compte alors pour un échec."""
    valeur = _declaration(selecteur, propriete)
    hexa = None
    if valeur is not None:
        renvoi = re.search(r'var\(\s*(--[\w-]+)\s*\)', valeur)
        if renvoi:
            hexa = (accent.resoudre_variable(PRINT, renvoi.group(1))
                    or accent.resoudre_variable(CSS, renvoi.group(1)))
        else:
            brut = re.search(r'#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{3})(?![0-9A-Fa-f])', valeur)
            hexa = brut.group(0) if brut else None
    if hexa is None:
        regles_absentes.append((selecteur, propriete))
    return hexa


def opacite(selecteur):
    """`opacity` de `selecteur` : elle change la couleur vue."""
    valeur = _declaration(selecteur, 'opacity')
    try:
        return float(valeur)
    except (TypeError, ValueError):
        regles_absentes.append((selecteur, 'opacity'))
        return 1.0


def melange(avant, fond, alpha):
    """Couleur vue d'un avant-plan translucide sur `fond` (mélange par canal en sRGB)."""
    if avant is None or fond is None:
        return None
    return apca.vers_hex([alpha * a + (1.0 - alpha) * b
                          for a, b in zip(apca.vers_rgb(avant), apca.vers_rgb(fond))])


def mesure(libelle, texte, fond, seuil, hors_perimetre=None):
    """Ajoute une paire au tableau. `texte` ou `fond` à None compte pour un échec.

    Toutes les comparaisons passent par ici, donc par apca.tient et sa tolérance.
    `hors_perimetre` est une clé de HORS_PERIMETRE : un échec va alors « à arbitrer »."""
    if texte is None or fond is None:
        lignes.append((libelle, texte or '?', fond or '?', None, seuil, False))
        return
    valeur = apca.lc(texte, fond)
    ok = apca.tient(valeur, seuil)
    if not ok and hors_perimetre:
        arbitrages.append((libelle, valeur, seuil, HORS_PERIMETRE[hors_perimetre]))
        ok = 'arbitrer'
    lignes.append((libelle, texte, fond, valeur, seuil, ok))


def titre(libelle):
    lignes.append((libelle, None, None, None, None, None))


def _nb(x, decimales=1):
    """Nombre à la française, sans zéros finaux : 13.6 -> « 13,6 », 14.0 -> « 14 »."""
    texte = ('%.*f' % (decimales, x)).rstrip('0').rstrip('.')
    return texte.replace('.', ',')


# ---- 1. La grille à clarté fixe de couleurs.css ----
# 11 crans x 6 teintes, deux contrôles par paire : le seuil de l'usage du cran
# (apca.SEUIL_USAGE) et le |Lc| garanti annoncé en tête de couleurs.css.
titre("Grille à clarté fixe : 11 crans x 6 couleurs (pipeline/styles/couleurs.css)")
for nom, marque in COULEURS:
    for cran in CRANS:
        texte, garanti, usage = apca.CONTRAT[cran]
        fond = var('--c-%s-%s' % (nom, cran))
        if texte is None:
            # Cran décoratif (400) : ni le noir ni le blanc n'y atteint le seuil du gros
            # titre. On exige seulement que l'aplat se distingue du papier.
            mesure('%s -%s (aplat décoratif / papier — aucun texte)' % (nom, cran),
                   fond, BLANC, NON_TEXTE)
            # Meilleure polarité affichée pour information : la garantie du cran est la
            # pire de ses six teintes, et elle reste sous 60.
            if fond is not None:
                gagnant, valeur = apca.meilleure_polarite(fond)
                lignes.append(('%s -%s (au mieux : %s — garantie du cran : %s < 60)'
                               % (nom, cran, 'noir' if gagnant == apca.NOIR else 'blanc',
                                  apca.lc_affiche(garanti)),
                               gagnant, fond, valeur, None, 'info'))
                # Le |Lc| annoncé doit être le plancher des six teintes.
                if not apca.tient(valeur, garanti):
                    ecarts.append(('%s -%s (meilleure polarité)' % (nom, cran),
                                   abs(valeur), garanti))
            continue
        # Seuil selon l'usage : « dès 14 px » -> 90, « à partir de 18 px » -> 75,
        # « gros titre » -> 60.
        seuil = apca.SEUIL_USAGE[usage]
        mesure('%s -%s (fond, texte %s — %s)'
               % (nom, cran, 'noir' if texte == NOIR else 'blanc', usage),
               texte, fond, seuil)
        # Second contrôle : le |Lc| garanti annoncé en tête de couleurs.css.
        if fond is not None:
            valeur = abs(apca.lc(texte, fond))
            if not apca.tient(valeur, garanti):
                ecarts.append(('%s -%s' % (nom, cran), valeur, garanti))

    # La couleur de charte (-marque) n'atteint le seuil du texte courant dans aucune
    # polarité : on la mesure au seuil du gros titre, son seul usage textuel.
    fond = var('--c-%s-marque' % nom)
    if fond is not None:
        gagnant, valeur = apca.meilleure_polarite(fond)
        mesure('%s -marque (= cran de charte, gros titre — %s gagne)'
               % (nom, 'noir' if gagnant == apca.NOIR else 'blanc'),
               gagnant, fond, GROS_TITRE)
    # Elle sert aussi de bordure épaisse sur le papier : seuil non textuel.
    mesure('%s -marque (bordure épaisse sur papier)' % nom, fond, BLANC, NON_TEXTE)

    # ---- 1bis. Le cran de charte porte-t-il le hex de la charte ? ----
    # Le cran est calculé par apca.cran_de_charte. Deux échecs distincts, qui se réparent
    # différemment : le cran ne porte pas le hex de la charte, ou -marque ne renvoie pas à
    # ce cran (il faut un seul hex par teinte).
    cran_charte = apca.cran_de_charte(marque)
    lu = var('--c-%s-%s' % (nom, cran_charte))
    if lu is None or lu.upper() != marque.upper():
        alterees.append((nom, cran_charte, marque, lu))
    if fond is None or fond.upper() != marque.upper():
        alias_faux.append((nom, cran_charte, marque, fond))

# ---- 1ter. Dispersion de clarté d'un cran ----
# Un cran a en principe la même clarté pour les six teintes ; celui qui porte une charte
# prend la clarté de la charte. L'écart est mesuré sur les hex du CSS et plafonné :
# apca.DISPERSION_CLARTE en général, apca.DISPERSION_CLARTE_EXCEPTION pour le cran 700,
# où la charte rouge tombe entre deux crans.
for cran in CRANS:
    clartes = []
    for nom, _ in COULEURS:
        hexa = var('--c-%s-%s' % (nom, cran))
        if hexa is not None:
            clartes.append(apca.srgb_vers_oklab(apca.vers_rgb(hexa))[0])
    if len(clartes) < 2:
        continue
    disp = max(clartes) - min(clartes)
    tolerance = apca.DISPERSION_CLARTE_EXCEPTION.get(cran, apca.DISPERSION_CLARTE)
    dispersions.append((cran, min(clartes), max(clartes), disp, tolerance,
                        disp <= tolerance))


# ---- 2. Alias lus par accent-css.py pour les tableaux ----
# Cibles données par apca.ALIAS : -normal = -marque (cran de charte), -clair = cran 100,
# -fonce = cran 800. -clair et -fonce sont des fonds de tableau, au texte de 13,6 px : les
# crans 200 et 700, qui plafonnent à 80, ne conviennent pas. On remesure en suivant les
# renvois var(), car un alias renvoyé vers un cran valable seulement dès 18 px passerait
# la section 1.
titre("Alias des tableaux : --szh-accent-clair et --szh-accent-fonce")
cran_clair, cran_fonce = dict(apca.ALIAS)['clair'], dict(apca.ALIAS)['fonce']


def cran_vise(nom, hexa):
    """Cran de la teinte `nom` qui porte le hex `hexa`, pour nommer le cran fautif."""
    if hexa is None:
        return '?'
    for cran in CRANS:
        if (var('--c-%s-%s' % (nom, cran)) or '').upper() == hexa.upper():
            return cran
    return 'hors grille'


for nom, marque in COULEURS:
    # Seuil du texte de tableau, pas celui du cran atteint.
    for alias, attendu, encre, role in (('clair', cran_clair, NOIR, 'couleur'),
                                        ('fonce', cran_fonce, BLANC, 'negatif')):
        hexa = var('--c-%s-%s' % (nom, alias))
        atteint = cran_vise(nom, hexa)
        # Le libellé nomme le cran atteint et signale l'écart au cran attendu.
        ecart = '' if atteint == attendu else ' — ATTENDU le cran %s' % attendu
        mesure('%s -%s (fond « %s », texte %s de %s px) -> cran %s%s'
               % (nom, alias, role, 'noir' if encre == NOIR else 'blanc',
                  _nb(TAILLE_TABLEAU), atteint, ecart),
               encre, hexa, SEUIL_TABLEAU)
    mesure('%s -normal (accent brut sur papier) = marque' % nom,
           var('--c-%s-normal' % nom), BLANC, NON_TEXTE)

# ---- 3. Teintes neutres et replis gris ----
# Fonds de texte de tableau : seuil du texte de tableau.
titre("Teintes neutres des tableaux + replis gris de print.css")
mesure('--szh-gris-clair (en-têtes/total gris)', NOIR, var('--szh-gris-clair'), SEUIL_TABLEAU)
mesure('--szh-zebre (zébrage, texte de corps)', NOIR, var('--szh-zebre'), SEUIL_TABLEAU)
mesure('repli --szh-accent-fonce #4a4a4a', BLANC, '#4a4a4a', SEUIL_TABLEAU)
mesure('repli --szh-accent-clair #ededed', NOIR, '#ededed', SEUIL_TABLEAU)
# Numéro sans couleur annuelle : les filets de tableau prennent ce gris (print.css).
mesure('repli --c-annual-ui #8f8f95 (filet sur papier)', '#8f8f95', BLANC, NON_TEXTE)
mesure('repli --c-annual-ui #8f8f95 (filet sur zébrage)', '#8f8f95', var('--szh-zebre'), NON_TEXTE)

# ---- 4. Jetons de la maquette émis par accent-css.py ----
titre("Jetons de la maquette (accent-css.py / jetons_annuels)")
for nom, marque in COULEURS:
    j = dict(accent.jetons_annuels(marque))
    # Hors périmètre : voir HORS_PERIMETRE.
    mesure('%s --c-kw-bg (puce .szh-kw, texte noir de %s px)' % (nom, _nb(TAILLE_KW)),
           NOIR, j['--c-kw-bg'], apca.seuil_pour(TAILLE_KW),
           hors_perimetre='--c-kw-bg')
    # Encadré et bande portent du corps de texte.
    mesure('%s --annual-soft (encadré, texte noir de %s px)' % (nom, _nb(TAILLE_CORPS)),
           NOIR, j['--annual-soft'], apca.seuil_pour(TAILLE_CORPS))
    mesure('%s --annual-tint (bande, texte noir de %s px)' % (nom, _nb(TAILLE_CORPS)),
           NOIR, j['--annual-tint'], apca.seuil_pour(TAILLE_CORPS))
    mesure('%s --c-annual-ui (filet sur papier)' % nom, j['--c-annual-ui'], BLANC, NON_TEXTE)
    # Les filets de tableau, en --c-annual-ui, passent souvent sur une rangée zébrée.
    mesure('%s --c-annual-ui (filet de tableau sur zébrage)' % nom,
           j['--c-annual-ui'], var('--szh-zebre'), NON_TEXTE)
    mesure('%s --c-abstract-border (bordure/papier)' % nom,
           j['--c-abstract-border'], BLANC, NON_TEXTE)

# ---- 5. Hero de couverture, en-tête courant, pied courant ----
# Encres écrites dans print.css, hors palette annuelle. Le hero est sur son bleu nuit,
# l'en-tête et le pied sur le papier blanc. L'`opacity` de deux marques du hero est
# composée sur le fond. Le filigrane .szh-book (blanc à 7 %) n'est pas mesuré : c'est une
# texture sans information.
titre("Couverture : encres du hero sur le bleu nuit (print.css §5)")
NUIT = couleur_de('.szh-hero', 'background')
SEUIL_HERO_ETIQUETTE = apca.seuil_pour(TAILLE_HERO_ETIQUETTE)
mesure('nom de revue .szh-hero-eyebrow (%s px)' % _nb(TAILLE_HERO_ETIQUETTE),
       couleur_de('.szh-hero-eyebrow'), NUIT, SEUIL_HERO_ETIQUETTE)
mesure('étiquette de dossier .szh-hero-dossier (%s px)' % _nb(TAILLE_HERO_ETIQUETTE),
       couleur_de('.szh-hero-dossier'), NUIT, SEUIL_HERO_ETIQUETTE)
mesure('ligne « Vol. X · N/année » .szh-hero-vol (%s px)' % _nb(TAILLE_HERO_ETIQUETTE),
       couleur_de('.szh-hero-vol'), NUIT, SEUIL_HERO_ETIQUETTE)
mesure('titre .szh-title (%s px : gros titre)' % _nb(TAILLE_HERO_TITRE),
       couleur_de('.szh-title'), NUIT, apca.seuil_pour(TAILLE_HERO_TITRE))
mesure('sous-titre .szh-subtitle (%s px)' % _nb(TAILLE_HERO_SOUSTITRE),
       couleur_de('.szh-subtitle'), NUIT, apca.seuil_pour(TAILLE_HERO_SOUSTITRE))
mesure('auteur·e·s ul.szh-authors (%s px)' % _nb(TAILLE_HERO_META),
       couleur_de('ul.szh-authors'), NUIT, apca.seuil_pour(TAILLE_HERO_META))
mesure('DOI .szh-doi (%s px)' % _nb(TAILLE_HERO_META),
       couleur_de('.szh-doi'), NUIT, apca.seuil_pour(TAILLE_HERO_META))
mesure('mention de licence .szh-licence (%s px)' % _nb(TAILLE_HERO_LICENCE),
       couleur_de('.szh-licence'), NUIT, apca.seuil_pour(TAILLE_HERO_LICENCE))
# DOI et licence sont des liens : `.szh-hero a[href]`, plus spécifique, décide de leur
# couleur. Les deux règles sont mesurées.
mesure('lien du hero .szh-hero a[href] (couleur effective du DOI et de la licence)',
       couleur_de('.szh-hero a[href]'), NUIT, apca.seuil_pour(TAILLE_HERO_LICENCE))
# Séparateur et icône du hero, opacité composée sur le fond.
for selecteur, quoi in (('.szh-authors li + li::before', 'point médian entre auteur·e·s'),
                        ('.szh-hero .szh-arrow', 'flèche « lien » du DOI et de la licence')):
    alpha = opacite(selecteur)
    mesure('%s (%s, opacité %d %%)' % (quoi, selecteur, round(100 * alpha)),
           melange(couleur_de(selecteur), NUIT, alpha), NUIT, NON_TEXTE)

# ---- 6. Appel de note ----
# ::footnote-call appartient à la note (GCPM) et hériterait de son gris --c-ink2 sans
# couleur propre. Il peut tomber sur le papier, une rangée zébrée, un encadré ou une bande.
titre("Appel de note (::footnote-call, print.css §4)")
TAILLE_APPEL = 0.54 * REM_EN_PX     # print.css : font-size: 0.54rem
SEUIL_APPEL = apca.seuil_pour(TAILLE_APPEL, gras=True)
APPEL = couleur_de('::footnote-call')
mesure('appel de note sur le papier (%s px, gras)' % _nb(TAILLE_APPEL), APPEL, BLANC, SEUIL_APPEL)
mesure('appel de note sur --szh-zebre', APPEL, var('--szh-zebre'), SEUIL_APPEL)
for nom, marque in COULEURS:
    j = dict(accent.jetons_annuels(marque))
    mesure('%s appel de note sur --annual-soft (encadré)' % nom, APPEL, j['--annual-soft'], SEUIL_APPEL)
    mesure('%s appel de note sur --annual-tint (bande)' % nom, APPEL, j['--annual-tint'], SEUIL_APPEL)

titre("Pages courantes : en-tête et pied sur le papier (print.css §3)")
SEUIL_COURANTE = apca.seuil_pour(TAILLE_COURANTE)
mesure('en-tête courant, dossier à gauche « .g » (%s px)' % _nb(TAILLE_COURANTE),
       couleur_de('.szh-entete-courante .g'), BLANC, SEUIL_COURANTE)
mesure('en-tête courant, Vol·numéro à droite « .d » (%s px)' % _nb(TAILLE_COURANTE),
       couleur_de('.szh-entete-courante .d'), BLANC, SEUIL_COURANTE)
mesure('filet sous l\'en-tête courant (1 px sur papier)',
       couleur_de('.szh-entete-courante', 'border-bottom'), BLANC, NON_TEXTE)
mesure('pied courant, ISSN (%s px)' % _nb(TAILLE_COURANTE),
       couleur_de('.szh-pied-courant'), BLANC, SEUIL_COURANTE)
mesure('pied courant, folio (%s px)' % _nb(TAILLE_COURANTE),
       couleur_de('.szh-pied-courant .folio'), BLANC, SEUIL_COURANTE)
mesure('filet au-dessus du pied courant (1 px sur papier)',
       couleur_de('.szh-pied-courant', 'border-top'), BLANC, NON_TEXTE)

# ---- 7. Livre FALC : pastilles d'étapes du falc-header ----
# Chiffre blanc à 0,8 em du corps FALC, sur le cran foncé de chaque couleur de chapitre
# (PALETTE_CHAPITRE_FONCE, profils/livre.mk) ; la pastille sur le gris de l'encadré. Hex
# et corps lus dans livre.mk et falc.css.
titre("Livre FALC : pastilles d'étapes du falc-header (livre/base.css §9)")
with open(os.path.join(PIPELINE, 'profils', 'livre.mk'), encoding='utf-8') as f:
    _mk = f.read()
_fonce = re.search(r'^PALETTE_CHAPITRE_FONCE\s*:=\s*(.+)$', _mk, re.M)
_falc = open(os.path.join(PIPELINE, 'styles', 'livre', 'falc.css'), encoding='utf-8').read()
_corps = re.search(r'--corps:\s*([\d.]+)pt', _falc)
_fond_encadre = re.search(r'--c-falc-resume-fond:\s*(#[0-9A-Fa-f]{6})', _falc)
if not (_fonce and _corps and _fond_encadre):
    sys.stderr.write('apca-check : PALETTE_CHAPITRE_FONCE, --corps ou --c-falc-resume-fond introuvable\n')
    sys.exit(2)
TAILLE_ETAPE = 0.8 * float(_corps.group(1)) * 96 / 72    # ::marker à 0.8em du corps
for hexa in _fonce.group(1).split():
    mesure('chiffre blanc sur la pastille #%s (%s px, demi-gras)' % (hexa, _nb(TAILLE_ETAPE)),
           BLANC, '#' + hexa, apca.seuil_pour(TAILLE_ETAPE))
    mesure('pastille #%s sur le gris de l\'encadré' % hexa, '#' + hexa, _fond_encadre.group(1), NON_TEXTE)


# ---- 8. Sortie ----

def afficher():
    largeur = max(len(l[0]) for l in lignes)
    entete = '%-*s  %-7s  %-7s  %6s  %6s  %s' % (
        largeur, 'PAIRE', 'TEXTE', 'FOND', 'Lc', 'SEUIL', 'VERDICT')
    print(entete)
    # Filets en ASCII, lisibles dans une console Windows (cp1252).
    print('-' * len(entete))
    for libelle, texte, fond, valeur, seuil, ok in lignes:
        if ok is None:                       # ligne de section
            print()
            print('-- %s ' % libelle + '-' * max(0, len(entete) - len(libelle) - 4))
            continue
        affiche = apca.lc_affiche(valeur, signe=True) if valeur is not None else '0'
        if ok == 'info':                     # mesure affichée, aucun seuil à tenir
            print('%-*s  %-7s  %-7s  %6s  %6s  %s' % (
                largeur, libelle, texte.upper(), fond.upper(), affiche, '-', 'info'))
            continue
        verdict = {True: 'OK', False: 'ÉCHEC', 'arbitrer': 'À ARBITRER'}[ok]
        print('%-*s  %-7s  %-7s  %6s  %6s  %s' % (
            largeur, libelle, texte.upper(), fond.upper(),
            affiche, '>= %d' % seuil, verdict))
    echecs = [l for l in lignes if l[5] is False]
    total = len([l for l in lignes if l[5] is not None and l[5] != 'info'])
    print()
    print('Rappel de lecture : les Lc du tableau sont arrondis à l\'entier (règle commune à')
    print('couleurs.css et à la planche). Les lignes de diagnostic ci-dessous gardent UNE')
    print('décimale, parce qu\'elles servent à juger des marges de l\'ordre du dixième.')
    print('Les seuils viennent de la TAILLE du texte : %s px -> %d, %s px -> %d, '
          '18 px -> %d, 24 px -> %d.'
          % (_nb(TAILLE_KW), apca.seuil_pour(TAILLE_KW), _nb(TAILLE_TABLEAU),
             SEUIL_TABLEAU, apca.LC_TEXTE_18, GROS_TITRE))
    print('Tolérance de %s sur toute comparaison mesure/seuil (apca.TOLERANCE_SEUIL).'
          % _nb(apca.TOLERANCE_SEUIL))
    print()
    if manquants:
        print('Variables introuvables dans couleurs.css : %s' % ', '.join(sorted(set(manquants))))
    if regles_absentes:
        print('Règles introuvables dans print.css : %s'
              % ', '.join('%s { %s }' % (s, p) for s, p in sorted(set(regles_absentes))))
    print('%d paires vérifiées, %d échec(s).' % (total, len(echecs)))
    for libelle, texte, fond, valeur, seuil, _ in echecs:
        print('  ÉCHEC  %s : %s sur %s -> Lc %+.1f (seuil %d, tolérance %.1f)' % (
            libelle, texte.upper(), fond.upper(), valeur or 0.0, seuil,
            apca.TOLERANCE_SEUIL))

    if arbitrages:
        print()
        print('%d paire(s) à arbitrer — mesurées au bon seuil, laissées en suspens :'
              % len(arbitrages))
        for libelle, valeur, seuil, raison in arbitrages:
            print('  ARBITRER  %s : Lc %+.1f pour un seuil de %d' % (libelle, valeur, seuil))
        # La raison est imprimée une fois par jeton, pas pour chaque teinte.
        for cle, raison in sorted(HORS_PERIMETRE.items()):
            if any(cle in l for l, _, _, _ in arbitrages):
                print('    %s -> %s' % (cle, raison))

    # Quatre autres sortes d'échec, qui font aussi échouer le script : |Lc| garanti non
    # tenu, hex de charte absent de son cran, alias -marque faux, dispersion de clarté.
    if ecarts:
        print('%d cran(s) EN DEÇÀ du |Lc| garanti annoncé dans couleurs.css :' % len(ecarts))
        for libelle, mesure_lc, garanti in ecarts:
            print('  CONTRAT  %s : mesuré %.1f, annoncé %.1f' % (libelle, mesure_lc, garanti))
    else:
        print('Contrat des |Lc| garantis : tenu par les %d paires de la grille.'
              % (len(CRANS) * len(COULEURS)))
        # Marge de chaque cran, imprimée même quand tout passe.
        print('Marge de chaque cran au seuil de son usage (|Lc| garanti - seuil) :')
        for cran in CRANS:
            encre, garanti, usage = apca.CONTRAT[cran]
            seuil = apca.SEUIL_USAGE[usage]
            marge = garanti - seuil
            alerte = ''
            if encre is not None and marge < 0:
                alerte = '  <- ne passe que par la tolérance de %s' % _nb(apca.TOLERANCE_SEUIL)
            print('  %-4s garanti %5.1f  seuil %3d  marge %+5.1f  (%s)%s'
                  % (cran, garanti, seuil, marge, usage, alerte))
    if alterees:
        print('Cran(s) de CHARTE qui ne portent PAS la charte — elle n\'est pas négociable :')
        for nom, cran, attendu, lu in alterees:
            print('  CHARTE  %s -%s : attendu %s, lu %s' % (nom, cran, attendu, lu))
    else:
        print('Cran de charte : les %d couleurs de charte sont posées telles quelles (%s).'
              % (len(COULEURS),
                 ', '.join('%s %s' % (nom, apca.cran_de_charte(m)) for nom, m in COULEURS)))
    if alias_faux:
        print('Alias -marque désynchronisé(s) — la dualité charte/cran est de retour :')
        for nom, cran, attendu, lu in alias_faux:
            print('  ALIAS  --c-%s-marque : attendu var(--c-%s-%s) = %s, lu %s'
                  % (nom, nom, cran, attendu, lu))
    else:
        print('Alias -marque : les %d pointent bien sur leur cran de charte '
              '(un seul hex par couleur).' % len(COULEURS))

    # Dispersion de clarté par cran, avec le nom des chartes qu'il porte.
    ratees = [d for d in dispersions if not d[5]]
    porteur = {}
    for nom, m in COULEURS:
        porteur.setdefault(apca.cran_de_charte(m), []).append(nom)
    print('Dispersion de clarté OKLab par cran (max - min des six teintes) :')
    for cran, mini, maxi, disp, tolerance, ok in dispersions:
        qui = porteur.get(cran)
        print('  %-4s %.3f-%.3f  écart %.3f  (tolérance %.2f) %-3s%s' % (
            cran, mini, maxi, disp, tolerance, 'OK' if ok else 'HORS',
            '  <- charte : %s' % '/'.join(qui) if qui else ''))
    if ratees:
        print('%d cran(s) au-delà de la dispersion de clarté tolérée :' % len(ratees))
        for cran, mini, maxi, disp, tolerance, _ in ratees:
            print('  CLARTÉ  cran %s : écart %.3f > %.3f toléré (de %.3f à %.3f)'
                  % (cran, disp, tolerance, mini, maxi))

    # Crans porteurs de texte, comptés deux fois : toutes tailles (il en faut au moins
    # trois par polarité) et à la taille du texte de tableau (seuil 90).
    def crans_pour(encre, usages):
        return [c for c in CRANS if apca.CONTRAT[c][0] == encre
                and apca.CONTRAT[c][2] in usages]

    texte_courant = (apca.USAGE_TEXTE_14, apca.USAGE_TEXTE_18)
    noirs, blancs = crans_pour(NOIR, texte_courant), crans_pour(BLANC, texte_courant)
    noirs_14 = crans_pour(NOIR, (apca.USAGE_TEXTE_14,))
    blancs_14 = crans_pour(BLANC, (apca.USAGE_TEXTE_14,))
    decoratifs = [c for c in CRANS if apca.CONTRAT[c][0] is None]
    print('Texte courant, toutes tailles : %d crans à texte noir (%s) et %d à texte blanc '
          '(%s) -- exigence « au moins 3 et 3 » : %s.'
          % (len(noirs), '/'.join(noirs), len(blancs), '/'.join(blancs),
             'tenue' if len(noirs) >= 3 and len(blancs) >= 3 else 'NON TENUE'))
    print('Utilisables pour du TEXTE DE TABLEAU (%s px, seuil %d) : %d à texte noir (%s) '
          'et %d à texte blanc (%s).'
          % (_nb(TAILLE_TABLEAU), SEUIL_TABLEAU, len(noirs_14), '/'.join(noirs_14),
             len(blancs_14), '/'.join(blancs_14)))
    print('  (les crans %s portent du texte dès 18 px seulement : ni corps, ni tableau.)'
          % '/'.join(c for c in CRANS if apca.CONTRAT[c][2] == apca.USAGE_TEXTE_18))
    print('Cran(s) décoratif(s), aucun texte autorisé : %s.' % '/'.join(decoratifs))
    # -clair et -fonce ont besoin d'au moins un cran de chaque polarité utilisable pour
    # du texte de tableau.
    if not noirs_14 or not blancs_14:
        print('AUCUN cran utilisable pour un fond de tableau dans une polarité : '
              'les alias -clair / -fonce n\'ont plus de cible valide.')
        return 1
    if len(noirs) < 3 or len(blancs) < 3:
        return 1
    return 1 if (echecs or ecarts or alterees or alias_faux or ratees) else 0


if __name__ == '__main__':
    sys.exit(afficher())
