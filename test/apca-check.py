#!/usr/bin/env python3
# apca-check.py — vérifie le contraste APCA de toute la palette.
#
#   python3 test/apca-check.py    -> tableau lisible ; sortie 0 si tout passe, 1 sinon.
#
# À relancer après toute retouche de pipeline/styles/couleurs.css, de
# pipeline/styles/print.css ou de pipeline/accent-css.py. Le script ne recalcule rien : il
# lit les hex réellement écrits dans couleurs.css et dans les règles de print.css (renvois
# var() suivis) et les jetons réellement émis par accent-css.py, puis il mesure.
#
# Un seuil APCA dépend de la taille du texte : 90 dès 14 px, 75 seulement à partir de
# 18 px, 60 en gros texte (>= 24 px, ou >= 19 px en gras), 30 pour le non textuel. Presque
# tout ici est sous 18 px — corps à 14 px, texte de tableau à 13,6 px, étiquettes du hero
# et de l'en-tête courant à 9 et 9,5 px —, donc tout texte de lecture se juge à 90 ; seul
# le titre de couverture (28 px) relève du gros titre. ⚠ Aucun nombre de seuil n'est écrit
# en dur dans ce fichier : chaque paire déclare sa taille et apca.seuil_pour en déduit le
# niveau (voir TAILLE_* plus bas).
#
# Deux règles d'affichage communes à toute la chaîne, tenues par pipeline/apca.py : les Lc
# s'affichent arrondis à l'entier (apca.lc_affiche), et une tolérance de 0,5 joue sur toute
# comparaison mesure/seuil (apca.tient). Seules les lignes de diagnostic qui suivent le
# tableau gardent une décimale, parce qu'elles servent à juger des marges du dixième.
#
# Paire volontairement exclue : un filet contre un aplat de la même teinte. Un séparateur
# n'a besoin de se détacher que d'un de ses deux voisins — papier ou zébrage, tous deux
# testés — et sur un en-tête rempli c'est le remplissage qui marque la limite.
#
# stdlib uniquement.

import importlib.util
import os
import re
import sys

# Sortie en UTF-8 même dans une console Windows : le tableau contient des accents.
try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):   # flux non reconfigurable
    pass

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE = os.path.join(RACINE, 'pipeline')
sys.path.insert(0, PIPELINE)

import apca  # noqa: E402  (après l'insertion du chemin)


def _charger(nom_module, chemin):
    """Importe un fichier .py dont le nom n'est pas un identifiant Python : accent-css.py
    porte un tiret, donc aucun import classique ne le charge."""
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


accent = _charger('accent_css', os.path.join(PIPELINE, 'accent-css.py'))

NOIR, BLANC = '#000000', '#FFFFFF'

# ---- Tailles réelles de la maquette : la seule source des seuils ----
# On déclare la taille du texte d'une paire, apca.seuil_pour en déduit le niveau. Une
# constante « TEXTE = 75 » se recopierait sans qu'on se demande à quelle taille elle
# s'applique ; une taille, non.
TAILLE_TABLEAU = 13.6   # print.css : table { font-size: 0.85rem } -> 13,6 px
TAILLE_CORPS = 14.0     # print.css : --body-size: 0.875rem -> 14 px
TAILLE_KW = 10.0        # print.css : .szh-kw { font-size: 10px } (puces de mots-clés)
TAILLE_GROS_TITRE = 24.0
# Hero de couverture et pages courantes (print.css §3 et §5). Aucune de ces tailles ne
# tombe dans la bande 19-24 px, la seule où la graisse change le niveau APCA : `gras` est
# donc inutile ici, et il faudra le passer le jour où un texte s'y installera.
TAILLE_HERO_ETIQUETTE = 9.5    # .szh-hero-eyebrow / -dossier / -vol (700, capitales)
TAILLE_HERO_TITRE = 28.0       # .szh-title
TAILLE_HERO_SOUSTITRE = 14.5   # .szh-subtitle
TAILLE_HERO_META = 12.5        # ul.szh-authors et .szh-doi
TAILLE_HERO_LICENCE = 11.5     # .szh-licence — le plus petit texte du hero avec l'étiquette
TAILLE_COURANTE = 9.0          # .szh-entete-courante et .szh-pied-courant

# Seuil de référence du script : les aplats d'accent sont d'abord des fonds de tableau.
SEUIL_TABLEAU = apca.seuil_pour(TAILLE_TABLEAU)      # 90
GROS_TITRE = apca.seuil_pour(TAILLE_GROS_TITRE)      # 60
NON_TEXTE = apca.LC_NON_TEXTUEL                      # 30 — un filet n'a pas de taille

# Les 6 couleurs de marque (COULEURS_NUMERO de l'extension / PALETTE d'accent-css.py).
COULEURS = [('rouge', '#D31932'), ('capucine', '#EB5E51'), ('moutarde', '#C7CF1C'),
            ('poireau', '#51A66D'), ('bleuacier', '#5F9FBC'), ('mountbatten', '#A98899')]

# Crans du plus clair au plus sombre ; le contrat de chacun est dans
# apca.CONTRAT[cran] = (couleur de texte admise ou None, |Lc| garanti, libellé d'usage).
CRANS = [cran for cran, _ in apca.CLARTES]

# Relais lisible vers la tolérance unique de la chaîne : apca.tient l'applique aussi bien
# au |Lc| garanti qu'au seuil d'usage, le même arrondi hexadécimal pesant sur les deux.
MARGE_GARANTI = apca.TOLERANCE_SEUIL

CSS = accent.couleurs_css()
lignes = []      # (libelle, texte, fond, lc, seuil, ok)
manquants = []   # variables introuvables dans couleurs.css
ecarts = []      # (libelle, lc mesuré, |Lc| garanti annoncé) quand le contrat est en deçà
alterees = []    # (nom, cran, hex de charte, hex lu) si le cran de charte n'est pas la charte
alias_faux = []  # (nom, cran, hex de charte, hex lu) si -marque n'est plus l'alias du cran
dispersions = [] # (cran, min, max, dispersion, tolérance, ok) — une ligne par cran
arbitrages = []  # (libelle, lc mesuré, seuil, raison) — voir HORS_PERIMETRE

# ---- Paires mesurées hors périmètre ----
# Une seule entrée aujourd'hui, --c-kw-bg. Elle est mesurée et affichée au bon seuil comme
# les autres, mais son échec ne fait pas tomber le script : il est reporté dans la section
# « à arbitrer », avec sa raison écrite, parce que le corriger demande une décision de
# maquette. Toute autre paire qui échoue fait tomber le script.
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


# ---- print.css : les couleurs lues là où elles servent ----
# Le hero de couverture, l'en-tête courant et le pied ne passent pas par la palette
# annuelle : leurs encres sont écrites dans print.css, tantôt en jeton :root, tantôt en hex
# dans la règle. On les lit donc dans le fichier, sélecteur par sélecteur, plutôt que de les
# recopier ici : une règle éclaircie ou supprimée doit faire réagir le test, pas le laisser
# mesurer une couleur qui n'est plus à l'écran.
CHEMIN_PRINT = os.path.join(PIPELINE, 'styles', 'print.css')
try:
    with open(CHEMIN_PRINT, encoding='utf-8') as f:
        # Commentaires retirés, comme pour couleurs.css : ceux de print.css citent des hex
        # et des noms de jetons, qui seraient pris pour des déclarations.
        PRINT = re.sub(r'/\*.*?\*/', '', f.read(), flags=re.S)
except OSError:
    PRINT = ''

# (liste de sélecteurs, corps) pour chaque bloc de règles. Les blocs imbriqués de @page et
# de @media ressortent en vrac : sans effet ici, on ne cherche que des sélecteurs nommés.
BLOCS = [(m.group(1), m.group(2)) for m in re.finditer(r'([^{}]+)\{([^{}]*)\}', PRINT)]

regles_absentes = []   # (sélecteur, propriété) que print.css ne déclare pas / plus


def _un_seul_espace(texte):
    return re.sub(r'\s+', ' ', texte).strip()


def _declaration(selecteur, propriete):
    """Valeur brute que print.css donne à `propriete` pour `selecteur`, ou None.

    Le dernier bloc l'emporte, comme la cascade à spécificité égale, et un sélecteur groupé
    (« a, b { … } ») compte pour chacun de ses membres. Le lookbehind empêche `color` d'être
    trouvé dans `background-color` et `background` dans `background-image`."""
    motif = re.compile(r'(?<![-\w])' + re.escape(propriete) + r'\s*:\s*([^;}]+)')
    cible = _un_seul_espace(selecteur)
    trouve = None
    for selecteurs, corps in BLOCS:
        if not any(_un_seul_espace(s) == cible for s in selecteurs.split(',')):
            continue
        for m in motif.finditer(corps):
            trouve = m.group(1)
    return trouve


def couleur_de(selecteur, propriete='color'):
    """Hex écrit dans print.css pour `propriete` de `selecteur`, renvois var() résolus
    d'abord dans print.css, ensuite dans couleurs.css. La recherche du hex n'est pas ancrée
    en fin de valeur, pour lire aussi un raccourci (`border-top: 1px solid var(--c-rule)`).
    None si la règle ou la propriété manque : la paire compte alors pour un échec, jamais
    pour un oubli silencieux."""
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
    """`opacity` déclarée par print.css pour `selecteur`. Elle fait partie de la couleur
    réellement vue : une marque blanche à 50 % ne contraste pas comme du blanc."""
    valeur = _declaration(selecteur, 'opacity')
    try:
        return float(valeur)
    except (TypeError, ValueError):
        regles_absentes.append((selecteur, 'opacity'))
        return 1.0


def melange(avant, fond, alpha):
    """Couleur effectivement vue d'un avant-plan translucide sur `fond` : interpolation par
    canal en sRGB, comme la composition d'un moteur de rendu."""
    if avant is None or fond is None:
        return None
    return apca.vers_hex([alpha * a + (1.0 - alpha) * b
                          for a, b in zip(apca.vers_rgb(avant), apca.vers_rgb(fond))])


def mesure(libelle, texte, fond, seuil, hors_perimetre=None):
    """Ajoute une paire au tableau. `texte`/`fond` à None (variable absente de
    couleurs.css) compte pour un échec.

    Seul point du script où mesure et seuil se rencontrent, et il ne doit pas y en avoir
    d'autre : la comparaison passe par apca.tient, donc avec la tolérance de la chaîne.
    `hors_perimetre` est la clé du jeton dans HORS_PERIMETRE ; un échec est alors dérouté
    vers la section « à arbitrer » au lieu de faire tomber le script."""
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
    """Nombre à la française, zéros de queue retirés : 13.6 -> « 13,6 », 14.0 -> « 14 ».
    Sert aux tailles et aux marges de diagnostic ; les Lc du tableau, eux, passent par
    apca.lc_affiche, qui n'a pas de décimale."""
    texte = ('%.*f' % (decimales, x)).rstrip('0').rstrip('.')
    return texte.replace('.', ',')


# ---- 1. La grille à clarté fixe, telle qu'écrite dans couleurs.css ----
# 11 crans x 6 teintes, deux contrôles par paire : le seuil de l'usage annoncé par le cran
# (apca.SEUIL_USAGE, puisque l'usage porte la taille), et le |Lc| garanti écrit en tête de
# couleurs.css. Le second est le vrai filet : sans lui, on pourrait éclaircir une teinte
# jusqu'à ras du seuil sans que rien ne proteste et l'en-tête du CSS mentirait.
titre("Grille à clarté fixe : 11 crans x 6 couleurs (pipeline/styles/couleurs.css)")
for nom, marque in COULEURS:
    for cran in CRANS:
        texte, garanti, usage = apca.CONTRAT[cran]
        fond = var('--c-%s-%s' % (nom, cran))
        if texte is None:
            # Cran décoratif (400) : point de croisement de l'échelle, où ni le noir ni le
            # blanc n'atteint le seuil du gros titre. On n'exige donc que le seuil non
            # textuel contre le papier — l'aplat doit se distinguer de la page.
            mesure('%s -%s (aplat décoratif / papier — aucun texte)' % (nom, cran),
                   fond, BLANC, NON_TEXTE)
            # La meilleure polarité est affichée sans seuil à tenir : c'est le chiffre qui
            # justifie l'interdiction écrite dans couleurs.css. Une teinte peut y frôler
            # les 60 du gros titre sans que cela l'autorise — la garantie d'un cran est le
            # pire de ses six teintes, et elle reste sous 60.
            if fond is not None:
                gagnant, valeur = apca.meilleure_polarite(fond)
                lignes.append(('%s -%s (au mieux : %s — garantie du cran : %s < 60)'
                               % (nom, cran, 'noir' if gagnant == apca.NOIR else 'blanc',
                                  apca.lc_affiche(garanti)),
                               gagnant, fond, valeur, None, 'info'))
                # Contrôle réel du cran décoratif : le |Lc| annoncé doit être le plancher
                # des six teintes, sinon couleurs.css et la planche mentent.
                if not apca.tient(valeur, garanti):
                    ecarts.append(('%s -%s (meilleure polarité)' % (nom, cran),
                                   abs(valeur), garanti))
            continue
        # Le seuil se déduit de l'usage annoncé par le contrat, l'usage portant la taille
        # (« dès 14 px » -> 90, « à partir de 18 px » -> 75, « gros titre » -> 60).
        seuil = apca.SEUIL_USAGE[usage]
        mesure('%s -%s (fond, texte %s — %s)'
               % (nom, cran, 'noir' if texte == NOIR else 'blanc', usage),
               texte, fond, seuil)
        # Second contrôle : la paire tient-elle le |Lc| garanti annoncé en tête de
        # couleurs.css ? Sinon le CSS promet plus qu'il ne tient.
        if fond is not None:
            valeur = abs(apca.lc(texte, fond))
            if not apca.tient(valeur, garanti):
                ecarts.append(('%s -%s' % (nom, cran), valeur, garanti))

    # La charte prise comme « marque » : aucune des six n'atteint le seuil du texte
    # courant, dans aucune polarité. On mesure donc sa meilleure polarité au seuil du gros
    # titre, son seul usage textuel légitime (titres de couverture). Son cran, lui, reste
    # soumis au contrat de la grille comme tous les autres.
    fond = var('--c-%s-marque' % nom)
    if fond is not None:
        gagnant, valeur = apca.meilleure_polarite(fond)
        mesure('%s -marque (= cran de charte, gros titre — %s gagne)'
               % (nom, 'noir' if gagnant == apca.NOIR else 'blanc'),
               gagnant, fond, GROS_TITRE)
    # La charte brute sert aussi de bordure épaisse sur le papier (--c-annual en filet de
    # couverture, --c-abstract-border) : seuil non textuel.
    mesure('%s -marque (bordure épaisse sur papier)' % nom, fond, BLANC, NON_TEXTE)

    # ---- 1bis. Le cran de charte porte-t-il bien le hex de la charte ? ----
    # Le cran est calculé (apca.cran_de_charte) et non récité : si une charte change, le
    # test ira chercher le hex au nouvel endroit tout seul. Deux échecs distincts parce
    # qu'ils se réparent différemment : le cran ne porte pas la charte (une valeur du
    # graphiste a été recalculée) ou -marque n'aboutit pas au cran (retour de la dualité
    # « charte à côté du cran », alors qu'on veut un seul hex par teinte et par cran).
    cran_charte = apca.cran_de_charte(marque)
    lu = var('--c-%s-%s' % (nom, cran_charte))
    if lu is None or lu.upper() != marque.upper():
        alterees.append((nom, cran_charte, marque, lu))
    if fond is None or fond.upper() != marque.upper():
        alias_faux.append((nom, cran_charte, marque, fond))

# ---- 1ter. Dispersion de clarté : ce que coûte le cran de charte ----
# Un cran est censé être une clarté unique, la même pour les six teintes ; celui qui
# accueille une charte adopte la clarté de cette charte et s'écarte du barreau. On mesure
# l'écart au lieu de le supposer, et on le plafonne : apca.DISPERSION_CLARTE couvre
# l'arrondi hexadécimal et les remplacements serrés, apca.DISPERSION_CLARTE_EXCEPTION
# nomme le seul cas large (le cran 700, où la charte rouge tombe entre deux crans). Une
# exception nommée vaut mieux qu'une tolérance élargie qui masquerait les dix autres.
# Les hex sont lus dans le CSS et non recalculés : c'est le fichier édité qui est jugé.
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
# Noms figés, cibles données par apca.ALIAS : -normal = -marque, donc le cran de charte ;
# -clair = cran 100 ; -fonce = cran 800. Ces deux derniers sont les fonds des tableaux,
# dont le texte est à 13,6 px : les crans 200 et 700, qui plafonnent à 80, ne conviennent
# pas. Conséquence pour le rouge : -fonce est le cran 800 (#9F001F) et non la charte.
# On remesure ici en suivant les renvois var() plutôt que de faire confiance au §1 : un
# alias repointé vers un cran valide « à partir de 18 px » laisserait le §1 vert, et c'est
# cette section-là qui doit alerter.
titre("Alias des tableaux : --szh-accent-clair et --szh-accent-fonce")
cran_clair, cran_fonce = dict(apca.ALIAS)['clair'], dict(apca.ALIAS)['fonce']


def cran_vise(nom, hexa):
    """Sur quel cran de la teinte `nom` l'alias aboutit-il réellement ?

    Le cran est retrouvé par son hex plutôt que déduit de l'intention, pour qu'un échec
    puisse nommer le cran fautif au lieu de ne donner que la mesure."""
    if hexa is None:
        return '?'
    for cran in CRANS:
        if (var('--c-%s-%s' % (nom, cran)) or '').upper() == hexa.upper():
            return cran
    return 'hors grille'


for nom, marque in COULEURS:
    # Seuil du texte de tableau, et non celui du cran visé : un alias mal repointé doit
    # échouer même si le cran, pris en lui-même, est conforme à sa propre étiquette.
    for alias, attendu, encre, role in (('clair', cran_clair, NOIR, 'couleur'),
                                        ('fonce', cran_fonce, BLANC, 'negatif')):
        hexa = var('--c-%s-%s' % (nom, alias))
        atteint = cran_vise(nom, hexa)
        # Le libellé porte le cran atteint et signale l'écart : c'est là que se lit la
        # régression, pas dans le Lc.
        ecart = '' if atteint == attendu else ' — ATTENDU le cran %s' % attendu
        mesure('%s -%s (fond « %s », texte %s de %s px) -> cran %s%s'
               % (nom, alias, role, 'noir' if encre == NOIR else 'blanc',
                  _nb(TAILLE_TABLEAU), atteint, ecart),
               encre, hexa, SEUIL_TABLEAU)
    mesure('%s -normal (accent brut sur papier) = marque' % nom,
           var('--c-%s-normal' % nom), BLANC, NON_TEXTE)

# ---- 3. Teintes neutres et replis gris ----
# Tous ces fonds portent du texte de tableau, donc se jugent au seuil de 13,6 px.
titre("Teintes neutres des tableaux + replis gris de print.css")
mesure('--szh-gris-clair (en-têtes/total gris)', NOIR, var('--szh-gris-clair'), SEUIL_TABLEAU)
mesure('--szh-zebre (zébrage, texte de corps)', NOIR, var('--szh-zebre'), SEUIL_TABLEAU)
mesure('repli --szh-accent-fonce #4a4a4a', BLANC, '#4a4a4a', SEUIL_TABLEAU)
mesure('repli --szh-accent-clair #ededed', NOIR, '#ededed', SEUIL_TABLEAU)
# Numéro sans couleur annuelle : les filets de tableau tombent sur ce gris (print.css).
mesure('repli --c-annual-ui #8f8f95 (filet sur papier)', '#8f8f95', BLANC, NON_TEXTE)
mesure('repli --c-annual-ui #8f8f95 (filet sur zébrage)', '#8f8f95', var('--szh-zebre'), NON_TEXTE)

# ---- 4. Jetons de la maquette émis par accent-css.py ----
titre("Jetons de la maquette (accent-css.py / jetons_annuels)")
for nom, marque in COULEURS:
    j = dict(accent.jetons_annuels(marque))
    # Seul jeton hors périmètre (voir HORS_PERIMETRE) : mesuré au bon seuil, mais son
    # échec est reporté « à arbitrer » et ne fait pas tomber le script.
    mesure('%s --c-kw-bg (puce .szh-kw, texte noir de %s px)' % (nom, _nb(TAILLE_KW)),
           NOIR, j['--c-kw-bg'], apca.seuil_pour(TAILLE_KW),
           hors_perimetre='--c-kw-bg')
    # Encadré et bande portent du corps de texte : seuil de 14 px.
    mesure('%s --annual-soft (encadré, texte noir de %s px)' % (nom, _nb(TAILLE_CORPS)),
           NOIR, j['--annual-soft'], apca.seuil_pour(TAILLE_CORPS))
    mesure('%s --annual-tint (bande, texte noir de %s px)' % (nom, _nb(TAILLE_CORPS)),
           NOIR, j['--annual-tint'], apca.seuil_pour(TAILLE_CORPS))
    mesure('%s --c-annual-ui (filet sur papier)' % nom, j['--c-annual-ui'], BLANC, NON_TEXTE)
    # Les filets de tableau (print.css, section Bordures) portent --c-annual-ui et tombent
    # souvent sur une rangée zébrée : c'est la paire réellement utilisée, pas la couleur de
    # marque brute.
    mesure('%s --c-annual-ui (filet de tableau sur zébrage)' % nom,
           j['--c-annual-ui'], var('--szh-zebre'), NON_TEXTE)
    mesure('%s --c-abstract-border (bordure/papier)' % nom,
           j['--c-abstract-border'], BLANC, NON_TEXTE)

# ---- 5. Hero de couverture, en-tête courant, pied courant ----
# Ces encres-là ne viennent pas de la palette annuelle et n'étaient mesurées par personne :
# elles sont écrites en clair dans print.css. Le fond est lu comme le texte — le hero sur
# son bleu nuit, l'en-tête et le pied sur le papier, qui n'a aucun fond déclaré et reste
# donc le blanc de la page.
# Deux marques du hero portent une `opacity` : elle est lue et composée sur le fond, sinon
# on mesurerait une couleur que personne ne voit.
# Exclusion volontaire : le filigrane .szh-book, blanc à 7 % d'opacité. C'est une texture
# qui ne porte aucune information — la mesurer reviendrait à exiger qu'on la voie.
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
# DOI et licence sont des liens : `.szh-hero a[href]` est plus spécifique que
# `.szh-doi, .szh-licence` et c'est lui qui décide de la couleur à l'écran. Les deux règles
# sont mesurées, sinon éclaircir l'une des deux seulement passerait inaperçu.
mesure('lien du hero .szh-hero a[href] (couleur effective du DOI et de la licence)',
       couleur_de('.szh-hero a[href]'), NUIT, apca.seuil_pour(TAILLE_HERO_LICENCE))
# Les deux marques décoratives du hero, séparateur et icône : leur `opacity` entre dans la
# couleur vue, donc dans le libellé — la baisser revient à éclaircir la marque.
for selecteur, quoi in (('.szh-authors li + li::before', 'point médian entre auteur·e·s'),
                        ('.szh-hero .szh-arrow', 'flèche « lien » du DOI et de la licence')):
    alpha = opacite(selecteur)
    mesure('%s (%s, opacité %d %%)' % (quoi, selecteur, round(100 * alpha)),
           melange(couleur_de(selecteur), NUIT, alpha), NUIT, NON_TEXTE)

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


# ---- 6. Sortie ----

def afficher():
    largeur = max(len(l[0]) for l in lignes)
    entete = '%-*s  %-7s  %-7s  %6s  %6s  %s' % (
        largeur, 'PAIRE', 'TEXTE', 'FOND', 'Lc', 'SEUIL', 'VERDICT')
    print(entete)
    # Filets en ASCII pur : la sortie doit rester lisible dans une console Windows
    # (cp1252) comme dans le terminal WSL.
    print('-' * len(entete))
    for libelle, texte, fond, valeur, seuil, ok in lignes:
        if ok is None:                       # ligne de section
            print()
            print('-- %s ' % libelle + '-' * max(0, len(entete) - len(libelle) - 4))
            continue
        # Lc arrondi à l'entier, signe conservé : la règle d'affichage de toute la chaîne
        # (apca.lc_affiche).
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

    # Les paires hors périmètre qui ne tiennent pas leur seuil : elles ne font pas tomber
    # le script mais s'affichent avec leur raison, pour être tranchées et non oubliées.
    if arbitrages:
        print()
        print('%d paire(s) à arbitrer — mesurées au bon seuil, laissées en suspens :'
              % len(arbitrages))
        for libelle, valeur, seuil, raison in arbitrages:
            print('  ARBITRER  %s : Lc %+.1f pour un seuil de %d' % (libelle, valeur, seuil))
        # La raison est imprimée une fois par jeton et non par teinte : six lignes
        # identiques noieraient l'information.
        for cle, raison in sorted(HORS_PERIMETRE.items()):
            if any(cle in l for l, _, _, _ in arbitrages):
                print('    %s -> %s' % (cle, raison))

    # Quatre familles d'échec qui ne sont pas des paires : le |Lc| garanti annoncé par
    # couleurs.css, l'intégrité des six hex de charte sur leur cran, l'alias -marque et la
    # dispersion de clarté d'un cran. Toutes font échouer le script au même titre qu'un
    # seuil manqué : un fichier qui promet plus qu'il ne tient est aussi faux qu'illisible.
    if ecarts:
        print('%d cran(s) EN DEÇÀ du |Lc| garanti annoncé dans couleurs.css :' % len(ecarts))
        for libelle, mesure_lc, garanti in ecarts:
            print('  CONTRAT  %s : mesuré %.1f, annoncé %.1f' % (libelle, mesure_lc, garanti))
    else:
        print('Contrat des |Lc| garantis : tenu par les %d paires de la grille.'
              % (len(CRANS) * len(COULEURS)))
        # Marge de chaque cran au seuil de son usage, avec une décimale, imprimée même
        # quand tout passe : un contrat tenu de justesse est une information.
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

    # Dispersion de clarté par cran, affichée et plafonnée. Le cran de charte est nommé sur
    # la ligne pour qu'elle se lise sans aller-retour avec le CSS.
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

    # Recomptage des crans porteurs de texte à partir du contrat réel. Deux comptes, parce
    # que n'en montrer qu'un tromperait : « texte courant » toutes tailles confondues, qui
    # répond à l'exigence du cahier des charges (au moins trois crans par polarité) ; et
    # les crans utilisables en fond de tableau, plus rares puisqu'ils se jugent à 90.
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
    # Exigence structurelle : les alias -clair et -fonce ont besoin d'au moins un cran de
    # chaque polarité utilisable à la taille du texte de tableau, sinon aucun fond de
    # tableau coloré n'est possible.
    if not noirs_14 or not blancs_14:
        print('AUCUN cran utilisable pour un fond de tableau dans une polarité : '
              'les alias -clair / -fonce n\'ont plus de cible valide.')
        return 1
    if len(noirs) < 3 or len(blancs) < 3:
        return 1
    return 1 if (echecs or ecarts or alterees or alias_faux or ratees) else 0


if __name__ == '__main__':
    sys.exit(afficher())
