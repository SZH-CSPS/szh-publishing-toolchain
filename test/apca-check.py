#!/usr/bin/env python3
# apca-check.py — vérificateur de contraste APCA de TOUTE la palette.
#
#   python3 test/apca-check.py          -> tableau lisible + code de sortie
#   code de sortie 0 = toutes les paires passent ; 1 = au moins une échoue.
#
# À lancer après CHAQUE modification de pipeline/styles/couleurs.css et après toute
# modification d'accent-css.py.
#
# Ce script ne recalcule PAS la palette : il LIT les hex réellement écrits dans
# couleurs.css (renvois `var()` suivis, comme le fait accent-css.py) et les jetons
# réellement émis par accent-css.py, puis il mesure. C'est donc bien le fichier édité à
# la main qui est validé, pas une théorie.
#
# ═══ Les seuils dépendent de la TAILLE : c'est tout l'objet de cette version ══════
# Ce script a longtemps comparé le texte courant à |Lc| >= 75. C'était FAUX pour nos
# tailles. Les quatre niveaux d'APCA (apca.py) et la taille qui va avec chacun :
#   |Lc| >= 90   texte courant, dès 14 px / graisse 400
#   |Lc| >= 75   texte courant, mais seulement à partir de 18 px
#   |Lc| >= 60   gros texte : >= 24 px, ou >= 19 px en gras
#   |Lc| >= 30   non textuel : filet, bordure, séparateur
# Les DEUX tailles réelles de la maquette sont sous 18 px : le corps est à 14 px
# (print.css, --body-size: 0.875rem) et le texte des TABLEAUX à 0,85rem = 13,6 px. Le seuil
# de tout texte de lecture de cette chaîne est donc 90. Aucune paire de ce script ne compare
# plus à un seuil écrit en dur : chaque paire déclare sa TAILLE, et apca.seuil_pour en
# déduit le niveau (voir TAILLE_* plus bas). La revue étant principalement numérique, APCA
# est pleinement dans son domaine.
#
# DEUX RÈGLES D'AFFICHAGE ET DE CONTRÔLE, communes à toute la chaîne (définies dans apca.py
# pour que CSS, planche et vérificateur ne puissent pas diverger) :
#   1. les Lc s'affichent SANS DÉCIMALE, arrondis (apca.lc_affiche) ;
#   2. une TOLÉRANCE de 0,5 joue à chaque comparaison mesure/seuil (apca.tient), de sorte
#      qu'une valeur qui s'affiche « 90 » satisfait le seuil de 90.
# EXCEPTION ASSUMÉE ET SIGNALÉE : les lignes de DIAGNOSTIC de ce script (écarts au |Lc|
# garanti, dispersion de clarté, marges) gardent UNE décimale, parce qu'elles servent
# justement à juger des marges de l'ordre du dixième — c'est là qu'on veut voir « 90,2 »
# plutôt que « 90 ». Le tableau principal, lui, suit la règle commune. La sortie le redit
# noir sur blanc, pour qu'un lecteur ne croie pas à une incohérence.
#
# ═══ Ce que vérifie le §1 : le CONTRAT de la grille à clarté fixe ═════════════════
# La grille compte 11 crans, et un même numéro vise la MÊME CLARTÉ pour les six teintes.
# Le contraste n'est donc plus une cible mais une conséquence : chaque cran annonce un
# |Lc| GARANTI, qui est le pire des six teintes. Ce script vérifie ce contrat cran par
# cran ET teinte par teinte — 11 x 6 = 66 paires — de deux façons :
#   1. la paire tient le SEUIL D'USAGE du cran, et cet usage PORTE UNE TAILLE : « dès
#      14 px » -> 90, « à partir de 18 px » -> 75, « gros titre » -> 60 (apca.SEUIL_USAGE) ;
#   2. la paire tient le |Lc| GARANTI annoncé en tête de couleurs.css, à 0,5 près.
# Le second point est le vrai filet de sécurité : sans lui, on pourrait éclaircir une
# teinte jusqu'à ras du seuil sans que rien ne proteste, et l'en-tête du CSS mentirait.
# La tolérance de 0,5 s'applique désormais aux DEUX contrôles. Elle ne jouait que sur le
# second, ce qui était incohérent : le même arrondi hexadécimal pèse dans les deux cas.
#
# LE CRAN 400 NE PORTE AUCUN TEXTE, ni noir ni blanc. C'est le point de croisement de
# l'échelle : le noir y est déjà tombé sous 60 et le blanc n'y est pas encore monté à 60.
# Toute échelle de couleur saturée possède ce cran — ce n'est pas un défaut. Il est donc
# vérifié comme DÉCORATIF : on n'exige que le seuil non textuel (30) contre le papier
# blanc, c'est-à-dire « l'aplat se distingue de la page ». Aucun texte n'y est permis.
# Si vous cherchez un fond porteur de TEXTE DE TABLEAU (13,6 px, donc seuil 90), il n'y en
# a que CINQ dans toute la grille : 50 et 100 au texte noir, 800, 900 et 950 au texte blanc.
# Les crans 200 et 700 n'en font PAS partie, malgré leur ancienne étiquette « texte
# courant » : ils plafonnent à 80, ce qui vaut à partir de 18 px et pas en dessous.
#
# ═══ Ce que vérifie le §1bis : le CRAN DE CHARTE ══════════════════════════════════
# La couleur de charte n'est plus hors grille : elle REMPLACE le cran dont le |Lc| calculé
# était le plus proche du sien, dans la même polarité de texte (apca.cran_de_charte). Trois
# contrôles, tous éliminatoires :
#   a) le cran désigné porte EXACTEMENT le hex de la charte (sinon quelqu'un a recalculé une
#      valeur qui vient du graphiste, et la revue n'imprime plus sa propre couleur) ;
#   b) `--c-<nom>-marque` est bien un ALIAS de ce cran et non un second hex ressuscité —
#      c'est précisément la dualité que ce lot a supprimée ;
#   c) la DISPERSION DE CLARTÉ à l'intérieur de chaque cran reste sous tolérance. C'est le
#      prix du remplacement, et le seul endroit où il se paie : un cran est censé signifier
#      une clarté unique pour les six teintes, et celui qui accueille une charte s'en écarte.
#      apca.DISPERSION_CLARTE (0,02) couvre l'arrondi à l'octet et les remplacements serrés ;
#      apca.DISPERSION_CLARTE_EXCEPTION nomme le seul cas large, le cran 700 du rouge (0,035,
#      charte à mi-chemin entre deux crans). On préfère une exception NOMMÉE à une tolérance
#      élargie : sur les dix autres crans, une dérive de 0,02 doit encore faire échouer.
# Aucun seuil de texte courant n'est imposé au hex de charte lui-même en tant que « marque » :
# on mesure sa meilleure polarité au seuil gros titre, et le seuil non textuel comme bordure
# épaisse. Son cran, lui, est vérifié comme tous les autres au §1 — et c'est nouveau : la
# charte est désormais soumise au contrat de la grille.
#
# Paire volontairement EXCLUE : un filet contre un aplat de la MÊME teinte (en-tête
# « couleur » ou « negatif »). Un séparateur n'a besoin de se détacher que d'UN de ses
# deux voisins — ici le papier ou le zébrage, tous deux testés — et sur un en-tête rempli
# c'est le remplissage lui-même qui marque la limite. Exiger 30 des deux côtés
# obligerait à des filets blancs, hors maquette.
#
# stdlib uniquement.

import importlib.util
import os
import sys

# Sortie en UTF-8 même dans une console Windows (le tableau contient des accents et des
# guillemets français ; le pipeline lui-même tourne en UTF-8 sous WSL).
try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):   # flux non reconfigurable (redirection exotique)
    pass

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PIPELINE = os.path.join(RACINE, 'pipeline')
sys.path.insert(0, PIPELINE)

import apca  # noqa: E402  (après l'insertion du chemin)


def _charger(nom_module, chemin):
    """Importe un fichier .py dont le nom n'est pas un identifiant Python
    (accent-css.py contient un tiret : pas d'import classique possible)."""
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


accent = _charger('accent_css', os.path.join(PIPELINE, 'accent-css.py'))

NOIR, BLANC = '#000000', '#FFFFFF'

# ─── Les TAILLES réelles de la maquette, seule source des seuils ───────────────────
# Aucun nombre de seuil n'est écrit dans ce fichier : on déclare la taille du texte de
# chaque paire et apca.seuil_pour en déduit le niveau. C'est ce qui empêche le retour de
# l'erreur corrigée ici — une constante « TEXTE = 75 » se recopie sans qu'on se demande à
# quelle taille elle s'applique, une taille ne se recopie pas sans le dire.
TAILLE_TABLEAU = 13.6   # print.css : table { font-size: 0.85rem } -> 13,6 px
TAILLE_CORPS = 14.0     # print.css : --body-size: 0.875rem -> 14 px
TAILLE_KW = 10.0        # print.css : .szh-kw { font-size: 10px } (puces de mots-clés)
TAILLE_GROS_TITRE = 24.0

# Seuil du texte de TABLEAU (13,6 px) : c'est le seuil de référence de tout ce script,
# puisque les aplats d'accent sont d'abord des fonds de tableau.
SEUIL_TABLEAU = apca.seuil_pour(TAILLE_TABLEAU)      # 90
GROS_TITRE = apca.seuil_pour(TAILLE_GROS_TITRE)      # 60
NON_TEXTE = apca.LC_NON_TEXTUEL                      # 30 — un filet n'a pas de taille

# Les 6 couleurs de marque (COULEURS_NUMERO de l'extension / PALETTE d'accent-css.py).
COULEURS = [('rouge', '#D31932'), ('capucine', '#EB5E51'), ('moutarde', '#C7CF1C'),
            ('poireau', '#51A66D'), ('bleuacier', '#5F9FBC'), ('mountbatten', '#A98899')]

# Ordre d'affichage des crans (du plus clair au plus sombre) et contrat de chacun :
# apca.CONTRAT[cran] = (couleur de texte admise ou None, |Lc| garanti, libellé d'usage).
CRANS = [cran for cran, _ in apca.CLARTES]

# La tolérance ne vit plus ici : elle est UNIQUE pour toute la chaîne (apca.TOLERANCE_SEUIL
# = 0,5) et s'applique par apca.tient, aussi bien au |Lc| garanti qu'au seuil d'usage. Ce
# script en avait sa propre copie, appliquée au seul |Lc| garanti — d'où l'incohérence que
# ce lot corrige : le même arrondi hexadécimal était toléré sur une comparaison et pas sur
# l'autre. Le nom est conservé comme simple relais lisible.
MARGE_GARANTI = apca.TOLERANCE_SEUIL

CSS = accent.couleurs_css()
lignes = []      # (libelle, texte, fond, lc, seuil, ok)
manquants = []   # variables introuvables dans couleurs.css
ecarts = []      # (libelle, lc mesuré, |Lc| garanti annoncé) quand le contrat est en deçà
alterees = []    # (nom, cran, hex de charte, hex lu) si le cran de charte n'est pas la charte
alias_faux = []  # (nom, cran, hex de charte, hex lu) si -marque n'est plus l'alias du cran
dispersions = [] # (cran, min, max, dispersion, tolérance, ok) — une ligne par cran
arbitrages = []  # (libelle, lc mesuré, seuil, raison) — voir HORS_PERIMETRE

# ─── Paires mesurées mais HORS PÉRIMÈTRE de ce lot ─────────────────────────────────
# Ces paires sont mesurées et affichées comme les autres, au bon seuil ; simplement, leur
# échec ne fait pas tomber le script — il est reporté dans une section « À ARBITRER ».
# POURQUOI cette catégorie existe, et pourquoi elle est nommée plutôt qu'implicite : en
# appliquant enfin le bon seuil, on découvre des manquements dans des jetons de MAQUETTE que
# ce lot n'a pas mandat de retoucher (la corriger demanderait de changer la taille d'un
# élément dans print.css, ou l'aspect d'un jeton annuel). Les taire serait malhonnête ; les
# compter en échec rendrait le vérificateur rouge en permanence et le ferait ignorer. On les
# isole donc, avec la raison écrite, pour qu'elles soient tranchées et non oubliées.
# Toute autre paire qui échoue fait tomber le script, comme avant.
HORS_PERIMETRE = {
    '--c-kw-bg': "puces .szh-kw à 10 px (print.css) : plus petit que tout ce que les "
                 "quatre niveaux d'APCA couvrent. Corriger = grossir la puce (print.css) "
                 "ou éclaircir le mélange à 22 % (accent-css.py).",
    '--c-annual-text': "aucun consommateur : nulle règle de print.css ne fait "
                       "`color: var(--c-annual-text)`. Sans taille, pas de seuil "
                       "déductible — le jeton est mesuré à titre indicatif.",
}


def var(nom):
    """Hex d'une variable de couleurs.css (renvois var() suivis) ; None si absente."""
    hexa = accent.resoudre_variable(CSS, nom)
    if hexa is None:
        manquants.append(nom)
    return hexa


def mesure(libelle, texte, fond, seuil, hors_perimetre=None):
    """Ajoute une paire au tableau. `texte`/`fond` peuvent être None (variable absente
    de couleurs.css) : la paire est alors comptée en échec.

    La comparaison passe par apca.tient, donc avec la TOLÉRANCE de 0,5 : c'est le point
    unique où mesure et seuil se rencontrent dans ce script, et il ne doit pas y en avoir
    d'autre. `hors_perimetre` est la clé du jeton dans HORS_PERIMETRE : un échec y est
    dérouté vers la section « à arbitrer » au lieu de faire tomber le script."""
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
    """Nombre à la française (virgule décimale), zéros de queue retirés : 13.6 -> « 13,6 »,
    14.0 -> « 14 », 0.5 -> « 0,5 ». Sert aux TAILLES et aux marges de diagnostic, jamais aux
    Lc du tableau — ceux-là passent par apca.lc_affiche, qui n'a pas de décimale du tout."""
    texte = ('%.*f' % (decimales, x)).rstrip('0').rstrip('.')
    return texte.replace('.', ',')


# ═══ 1. La grille à clarté fixe, telle qu'écrite dans couleurs.css ════════════════
titre("Grille à clarté fixe : 11 crans x 6 couleurs (pipeline/styles/couleurs.css)")
for nom, marque in COULEURS:
    for cran in CRANS:
        texte, garanti, usage = apca.CONTRAT[cran]
        fond = var('--c-%s-%s' % (nom, cran))
        if texte is None:
            # Cran DÉCORATIF (400) : aucun texte, ni noir ni blanc. On vérifie donc
            # seulement qu'il se distingue du PAPIER BLANC au seuil non textuel — un
            # aplat, une bande, une pastille. Mettre du texte ici, même gros, est une
            # erreur : le vérificateur ne l'autorise nulle part.
            mesure('%s -%s (aplat décoratif / papier — AUCUN TEXTE)' % (nom, cran),
                   fond, BLANC, NON_TEXTE)
            # On AFFICHE quand même la meilleure polarité (sans en faire un seuil à tenir) :
            # c'est ce chiffre qui justifie l'interdiction écrite dans couleurs.css.
            # Attention à la lecture : la teinte la plus favorable peut FRÔLER les 60 du
            # gros titre (poireau, +60). Ce n'est pas une autorisation. Dans une grille à
            # clarté fixe, un cran doit signifier la MÊME chose pour les six teintes, et la
            # garantie est le PIRE des six (56 < 60). « Aucun texte » vaut donc pour tout
            # le cran, y compris la teinte qui s'en sortirait de justesse.
            if fond is not None:
                gagnant, valeur = apca.meilleure_polarite(fond)
                lignes.append(('%s -%s (au mieux : %s — garantie du cran : %s < 60)'
                               % (nom, cran, 'noir' if gagnant == apca.NOIR else 'blanc',
                                  apca.lc_affiche(garanti)),
                               gagnant, fond, valeur, None, 'info'))
                # Le vrai contrôle du cran décoratif : le |Lc| annoncé (56) doit bien
                # être le PLANCHER des six teintes. Si une teinte descend en dessous,
                # l'en-tête de couleurs.css et la planche mentent.
                if not apca.tient(valeur, garanti):
                    ecarts.append(('%s -%s (meilleure polarité)' % (nom, cran),
                                   abs(valeur), garanti))
            continue
        # Le seuil se DÉDUIT de l'usage annoncé par le contrat, parce que l'usage porte la
        # taille (« dès 14 px » -> 90, « à partir de 18 px » -> 75, « gros titre » -> 60).
        # Aucun seuil n'est choisi ici : c'est apca.py qui décide, et couleurs.css l'annonce.
        seuil = apca.SEUIL_USAGE[usage]
        mesure('%s -%s (fond, texte %s — %s)'
               % (nom, cran, 'noir' if texte == NOIR else 'blanc', usage),
               texte, fond, seuil)
        # Second contrôle, le plus important : la paire tient-elle le |Lc| GARANTI annoncé
        # en tête de couleurs.css ? Sinon le CSS promet plus qu'il ne tient.
        if fond is not None:
            valeur = abs(apca.lc(texte, fond))
            if not apca.tient(valeur, garanti):
                ecarts.append(('%s -%s' % (nom, cran), valeur, garanti))

    # La couleur de CHARTE, prise en tant que « marque » (accent brut de la maquette) : on
    # ne lui impose pas le seuil du texte courant (aucune des 6 ne l'atteint, dans aucune
    # polarité). On vérifie la MEILLEURE polarité au seuil « gros titre » et on annonce
    # laquelle gagne — c'est son seul usage textuel légitime (titres de couverture).
    fond = var('--c-%s-marque' % nom)
    if fond is not None:
        gagnant, valeur = apca.meilleure_polarite(fond)
        mesure('%s -marque (= cran de charte, gros titre — %s gagne)'
               % (nom, 'noir' if gagnant == apca.NOIR else 'blanc'),
               gagnant, fond, GROS_TITRE)
    # La charte brute sert aussi de bordure ÉPAISSE sur le papier (--c-annual : filet de
    # couverture 6 px, bords d'encadré 4 px, --c-abstract-border 3 px) : non textuel.
    mesure('%s -marque (bordure épaisse sur papier)' % nom, fond, BLANC, NON_TEXTE)

    # ── §1bis : le cran de CHARTE porte-t-il le hex de la charte ? ────────────────────
    # Le cran est CALCULÉ ici (apca.cran_de_charte), pas récité : si la charte d'une teinte
    # change un jour, le test cherchera le hex au nouvel endroit tout seul. Deux échecs
    # distincts, parce qu'ils se réparent différemment :
    #   - le cran ne porte pas la charte  -> une valeur du graphiste a été recalculée ;
    #   - -marque n'aboutit pas au cran   -> la dualité « charte à côté du cran » revient.
    cran_charte = apca.cran_de_charte(marque)
    lu = var('--c-%s-%s' % (nom, cran_charte))
    if lu is None or lu.upper() != marque.upper():
        alterees.append((nom, cran_charte, marque, lu))
    if fond is None or fond.upper() != marque.upper():
        alias_faux.append((nom, cran_charte, marque, fond))

# ═══ 1ter. Dispersion de clarté : ce que COÛTE le cran de charte ══════════════════
# Un cran est censé être UNE clarté, la même pour les six teintes. Dix crans sur onze le
# sont à l'octet près (dispersion 0,001 à 0,003, c'est l'arrondi hexadécimal et rien
# d'autre) ; celui qui accueille une charte adopte la clarté de cette charte et s'écarte
# donc du barreau. On mesure l'écart au lieu de le supposer : c'est la contrepartie du choix
# éditorial « un seul hex par couleur », et elle doit rester chiffrée et sous plafond.
# On lit les hex du CSS (pas ceux qu'apca recalculerait) : c'est le fichier édité qui est
# jugé, comme partout ailleurs dans ce script.
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


# ═══ 2. Alias lus par accent-css.py pour les tableaux ═════════════════════════════
# Noms figés, cibles nouvelles : -normal = -marque, donc le CRAN de charte (700 pour le
# rouge, 300 pour la moutarde, 500 pour les quatre autres) ; -clair = cran 100 ; -fonce =
# cran 800.
# CES DEUX CIBLES ONT MONTÉ D'UN CRAN (avant : 200 et 700). Raison : ce sont les fonds des
# TABLEAUX, et le texte d'un tableau est à 13,6 px, donc son seuil est 90 — les crans 200 et
# 700 plafonnent à 80 et avaient été retenus sous l'ancien seuil, faux, de 75.
# Conséquence pour le ROUGE : -fonce n'est plus la charte #D31932 (cran 700) mais #9F001F
# (cran 800). Le rouge de charte quitte le rôle de fond « négatif » des tableaux.
# On remesure ICI, en suivant les renvois var(), au lieu de faire confiance au §1 : si
# quelqu'un repointe -clair ou -fonce vers un cran qui ne tient pas le seuil du texte de
# tableau — les crans 200 à 700 en font tous partie, y compris ceux que le §1 déclare bons
# « à partir de 18 px » —, le §1 resterait VERT et c'est cette section-là qui doit crier.
titre("Alias des tableaux (--szh-accent* = --c-<nom>-normal/-clair/-fonce)")
cran_clair, cran_fonce = dict(apca.ALIAS)['clair'], dict(apca.ALIAS)['fonce']


def cran_vise(nom, hexa):
    """Sur QUEL cran de la teinte `nom` l'alias aboutit-il réellement ?

    On retrouve le cran par son hex, au lieu de croire l'intention : c'est ce qui permet à
    un échec de dire « pointe sur le cran 700 » plutôt que le seul « Lc trop faible ». Un
    message qui nomme le cran fautif se répare en une ligne ; un message qui ne donne que
    la mesure oblige à rouvrir le CSS et à comparer six hex à la main."""
    if hexa is None:
        return '?'
    for cran in CRANS:
        if (var('--c-%s-%s' % (nom, cran)) or '').upper() == hexa.upper():
            return cran
    return 'hors grille'


for nom, marque in COULEURS:
    # Seuil du texte de TABLEAU (13,6 px) = 90, et non le seuil d'usage du cran visé : un
    # alias mal repointé doit échouer même si le cran, pris en lui-même, est conforme à sa
    # propre étiquette. C'est exactement le cas des crans 200 et 700.
    for alias, attendu, encre, role in (('clair', cran_clair, NOIR, 'couleur'),
                                        ('fonce', cran_fonce, BLANC, 'negatif')):
        hexa = var('--c-%s-%s' % (nom, alias))
        atteint = cran_vise(nom, hexa)
        # Le libellé porte le cran ATTEINT, et signale l'écart quand ce n'est pas celui
        # qu'on attendait : c'est là que se lit la régression, pas dans le Lc.
        ecart = '' if atteint == attendu else ' — ATTENDU le cran %s' % attendu
        mesure('%s -%s (fond « %s », texte %s de %s px) -> cran %s%s'
               % (nom, alias, role, 'noir' if encre == NOIR else 'blanc',
                  _nb(TAILLE_TABLEAU), atteint, ecart),
               encre, hexa, SEUIL_TABLEAU)
    mesure('%s -normal (accent brut sur papier) = marque' % nom,
           var('--c-%s-normal' % nom), BLANC, NON_TEXTE)

# ═══ 3. Teintes neutres et replis gris ════════════════════════════════════════════
# Tous ces fonds portent du texte de TABLEAU (13,6 px), donc tous se jugent à 90. Bonne
# nouvelle du relèvement : les quatre passent sans retouche — les gris de repli de print.css
# étaient déjà largement au-dessus (95 et 95), et les deux neutres aussi (91 et 98). Le
# seuil faux n'avait donc jamais rien coûté ICI ; il ne coûtait que sur les aplats COLORÉS.
titre("Teintes neutres des tableaux + replis gris de print.css")
mesure('--szh-gris-clair (en-têtes/total gris)', NOIR, var('--szh-gris-clair'), SEUIL_TABLEAU)
mesure('--szh-zebre (zébrage, texte de corps)', NOIR, var('--szh-zebre'), SEUIL_TABLEAU)
mesure('repli --szh-accent-fonce #4a4a4a', BLANC, '#4a4a4a', SEUIL_TABLEAU)
mesure('repli --szh-accent-clair #ededed', NOIR, '#ededed', SEUIL_TABLEAU)
mesure('repli --szh-accent #9a9a9a (accent brut)', '#9a9a9a', BLANC, NON_TEXTE)
# Numéro SANS couleur annuelle : les filets de tableau tombent sur ce gris (print.css).
mesure('repli --c-annual-ui #8f8f95 (filet sur papier)', '#8f8f95', BLANC, NON_TEXTE)
mesure('repli --c-annual-ui #8f8f95 (filet sur zébrage)', '#8f8f95', var('--szh-zebre'), NON_TEXTE)

# ═══ 4. Jetons de la maquette émis par accent-css.py ══════════════════════════════
titre("Jetons de la maquette (accent-css.py / jetons_annuels)")
for nom, marque in COULEURS:
    j = dict(accent.jetons_annuels(marque))
    # Texte sur l'aplat annuel : GROS titre uniquement (cf. §1, niveau 500).
    mesure('%s --c-on-annual sur --c-annual' % nom,
           j['--c-on-annual'], j['--c-annual'], GROS_TITRE)
    # Deux jetons HORS PÉRIMÈTRE (voir HORS_PERIMETRE) : mesurés au bon seuil, mais leur
    # échec est reporté « à arbitrer » et ne fait pas tomber le script.
    mesure('%s --c-annual-text sur papier (aucun consommateur)' % nom,
           j['--c-annual-text'], BLANC, apca.seuil_pour(TAILLE_CORPS),
           hors_perimetre='--c-annual-text')
    mesure('%s --c-kw-bg (puce .szh-kw, texte noir de %s px)' % (nom, _nb(TAILLE_KW)),
           NOIR, j['--c-kw-bg'], apca.seuil_pour(TAILLE_KW),
           hors_perimetre='--c-kw-bg')
    # Encadré et bande portent du corps de texte à 14 px : seuil 90, tenu par les six.
    mesure('%s --annual-soft (encadré, texte noir de %s px)' % (nom, _nb(TAILLE_CORPS)),
           NOIR, j['--annual-soft'], apca.seuil_pour(TAILLE_CORPS))
    mesure('%s --annual-tint (bande, texte noir de %s px)' % (nom, _nb(TAILLE_CORPS)),
           NOIR, j['--annual-tint'], apca.seuil_pour(TAILLE_CORPS))
    mesure('%s --c-annual-ui (filet sur papier)' % nom, j['--c-annual-ui'], BLANC, NON_TEXTE)
    # Les 3 filets de tableau (print.css § Bordures) portent --c-annual-ui et tombent
    # souvent sur une rangée zébrée : c'est la paire réellement utilisée, pas la couleur
    # de marque brute (qui n'atteignait que Lc +22 en moutarde).
    mesure('%s --c-annual-ui (filet de tableau sur zébrage)' % nom,
           j['--c-annual-ui'], var('--szh-zebre'), NON_TEXTE)
    mesure('%s --c-abstract-border (bordure/papier)' % nom,
           j['--c-abstract-border'], BLANC, NON_TEXTE)
    # --c-annual-deep = le MÊME cran que l'alias -fonce des tableaux (800) : une seule règle
    # « fond sombre à texte blanc » dans toute la chaîne. Le cran est lu dans apca.ALIAS des
    # deux côtés, donc les deux jetons ne peuvent plus se désynchroniser.
    mesure('%s --c-annual-deep (fond, texte blanc) = cran %s' % (nom, cran_fonce),
           BLANC, j['--c-annual-deep'], SEUIL_TABLEAU)


# ═══ 5. Sortie ════════════════════════════════════════════════════════════════════

def afficher():
    largeur = max(len(l[0]) for l in lignes)
    entete = '%-*s  %-7s  %-7s  %6s  %6s  %s' % (
        largeur, 'PAIRE', 'TEXTE', 'FOND', 'Lc', 'SEUIL', 'VERDICT')
    print(entete)
    # Filets en ASCII pur : la sortie doit rester lisible dans une console Windows
    # (cp1252) comme dans le terminal WSL du pipeline.
    print('-' * len(entete))
    for libelle, texte, fond, valeur, seuil, ok in lignes:
        if ok is None:                       # ligne de section
            print()
            print('-- %s ' % libelle + '-' * max(0, len(entete) - len(libelle) - 4))
            continue
        # Lc SANS DÉCIMALE, signe conservé : la règle d'affichage de toute la chaîne
        # (apca.lc_affiche). Les seules décimales de cette sortie sont dans les lignes de
        # diagnostic qui suivent le tableau, et elles s'annoncent comme telles.
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
    print('Rappel de lecture : les Lc du tableau sont ARRONDIS À L\'ENTIER (règle commune à')
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
    print('%d paires vérifiées, %d échec(s).' % (total, len(echecs)))
    for libelle, texte, fond, valeur, seuil, _ in echecs:
        print('  ÉCHEC  %s : %s sur %s -> Lc %+.1f (seuil %d, tolérance %.1f)' % (
            libelle, texte.upper(), fond.upper(), valeur or 0.0, seuil,
            apca.TOLERANCE_SEUIL))

    # Les paires HORS PÉRIMÈTRE qui ne tiennent pas leur seuil. Elles ne font pas tomber le
    # script (voir HORS_PERIMETRE), mais elles s'affichent en clair avec leur raison : ce
    # sont des décisions à prendre, pas des détails à ranger sous le tapis.
    if arbitrages:
        print()
        print('%d paire(s) À ARBITRER — mesurées au bon seuil, hors périmètre de ce lot :'
              % len(arbitrages))
        for libelle, valeur, seuil, raison in arbitrages:
            print('  ARBITRER  %s : Lc %+.1f pour un seuil de %d' % (libelle, valeur, seuil))
        # La raison est imprimée UNE fois par jeton et non par teinte : six lignes
        # identiques noieraient l'information au lieu de la porter.
        for cle, raison in sorted(HORS_PERIMETRE.items()):
            if any(cle in l for l, _, _, _ in arbitrages):
                print('    %s -> %s' % (cle, raison))

    # Quatre familles d'échec qui ne sont pas des « paires » : le |Lc| garanti que l'en-tête
    # de couleurs.css annonce, l'intégrité des 6 hex de charte sur leur cran, l'alias
    # -marque, et la dispersion de clarté à l'intérieur d'un cran. Toutes font échouer le
    # script au même titre qu'un seuil manqué — un fichier qui promet plus qu'il ne tient
    # est aussi faux qu'un fichier illisible.
    if ecarts:
        print('%d cran(s) EN DEÇÀ du |Lc| garanti annoncé dans couleurs.css :' % len(ecarts))
        for libelle, mesure_lc, garanti in ecarts:
            print('  CONTRAT  %s : mesuré %.1f, annoncé %.1f' % (libelle, mesure_lc, garanti))
    else:
        print('Contrat des |Lc| garantis : tenu par les %d paires de la grille.'
              % (len(CRANS) * len(COULEURS)))
        # La MARGE de chaque cran au seuil de son usage, en clair et avec une décimale :
        # c'est le tableau qui aurait montré tout de suite que le cran 800 ne tenait ses 90
        # que par la tolérance (marge 0,0). Il est imprimé même quand tout passe — un
        # contrat tenu « de justesse » est une information, pas un non-événement.
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

    # Dispersion de clarté par cran : le PRIX du remplacement, affiché et plafonné. Le cran
    # de charte apparaît en clair pour que la ligne se lise sans aller-retour avec le CSS.
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

    # Recomptage des crans porteurs de texte, à partir du contrat réel et non d'une
    # affirmation en commentaire. Deux comptes, parce que la correction de ce lot les a
    # SÉPARÉS et que ne montrer que l'un des deux tromperait :
    #   - « texte courant », toutes tailles confondues : c'est l'exigence historique du
    #     cahier des charges (« au moins 3 et 3 »), et elle reste tenue ;
    #   - utilisables pour du TEXTE DE TABLEAU (13,6 px, seuil 90) : c'est le compte qui
    #     compte désormais, et il est plus maigre — deux crans noirs, trois blancs.
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
    print('Cran(s) décoratif(s), AUCUN TEXTE autorisé : %s.' % '/'.join(decoratifs))
    # Les alias -clair et -fonce ont besoin d'AU MOINS un cran de chaque polarité utilisable
    # à la taille du texte de tableau. C'est la vraie exigence structurelle depuis que le
    # seuil est passé à 90 : sans elle, aucun fond de tableau coloré n'est possible.
    if not noirs_14 or not blancs_14:
        print('AUCUN cran utilisable pour un fond de tableau dans une polarité : '
              'les alias -clair / -fonce n\'ont plus de cible valide.')
        return 1
    if len(noirs) < 3 or len(blancs) < 3:
        return 1
    return 1 if (echecs or ecarts or alterees or alias_faux or ratees) else 0


if __name__ == '__main__':
    sys.exit(afficher())
