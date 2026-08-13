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
# Seuils (voir l'en-tête de couleurs.css) :
#   texte courant (corps, cellules et en-têtes de tableau)   |Lc| >= 75
#   gros titre / texte >= 24 px (aplat de couverture)        |Lc| >= 60
#   non textuel (filets, bordures, séparateurs)              |Lc| >= 30
#
# ═══ Ce que vérifie le §1 : le CONTRAT de la grille à clarté fixe ═════════════════
# La grille compte 11 crans, et un même numéro vise la MÊME CLARTÉ pour les six teintes.
# Le contraste n'est donc plus une cible mais une conséquence : chaque cran annonce un
# |Lc| GARANTI, qui est le pire des six teintes. Ce script vérifie ce contrat cran par
# cran ET teinte par teinte — 11 x 6 = 66 paires — de deux façons :
#   1. la paire tient le SEUIL D'USAGE du cran (75 texte courant / 60 gros titre) ;
#   2. la paire tient le |Lc| GARANTI annoncé en tête de couleurs.css, à 0,5 près.
# Le second point est le vrai filet de sécurité : sans lui, on pourrait éclaircir une
# teinte jusqu'à ras du seuil sans que rien ne proteste, et l'en-tête du CSS mentirait.
#
# LE CRAN 400 NE PORTE AUCUN TEXTE, ni noir ni blanc. C'est le point de croisement de
# l'échelle : le noir y est déjà tombé sous 60 et le blanc n'y est pas encore monté à 60.
# Toute échelle de couleur saturée possède ce cran — ce n'est pas un défaut. Il est donc
# vérifié comme DÉCORATIF : on n'exige que le seuil non textuel (30) contre le papier
# blanc, c'est-à-dire « l'aplat se distingue de la page ». Aucun texte n'y est permis :
# si vous cherchez un fond porteur de texte, prenez 200 (texte noir) ou 700 (texte blanc).
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
TEXTE = apca.LC_TEXTE               # 75
GROS_TITRE = apca.LC_GROS_TITRE     # 60
NON_TEXTE = apca.LC_NON_TEXTUEL     # 30

# Les 6 couleurs de marque (COULEURS_NUMERO de l'extension / PALETTE d'accent-css.py).
COULEURS = [('rouge', '#D31932'), ('capucine', '#EB5E51'), ('moutarde', '#C7CF1C'),
            ('poireau', '#51A66D'), ('bleuacier', '#5F9FBC'), ('mountbatten', '#A98899')]

# Ordre d'affichage des crans (du plus clair au plus sombre) et contrat de chacun :
# apca.CONTRAT[cran] = (couleur de texte admise ou None, |Lc| garanti, libellé d'usage).
CRANS = [cran for cran, _ in apca.CLARTES]

# Tolérance sur le |Lc| garanti : les hex de couleurs.css sont arrondis à l'octet, donc
# le Lc mesuré ne retombe jamais au centième sur la valeur annoncée. 0,5 laisse passer
# l'arrondi et rien d'autre.
MARGE_GARANTI = 0.5

CSS = accent.couleurs_css()
lignes = []      # (libelle, texte, fond, lc, seuil, ok)
manquants = []   # variables introuvables dans couleurs.css
ecarts = []      # (libelle, lc mesuré, |Lc| garanti annoncé) quand le contrat est en deçà
alterees = []    # (nom, cran, hex de charte, hex lu) si le cran de charte n'est pas la charte
alias_faux = []  # (nom, cran, hex de charte, hex lu) si -marque n'est plus l'alias du cran
dispersions = [] # (cran, min, max, dispersion, tolérance, ok) — une ligne par cran


def var(nom):
    """Hex d'une variable de couleurs.css (renvois var() suivis) ; None si absente."""
    hexa = accent.resoudre_variable(CSS, nom)
    if hexa is None:
        manquants.append(nom)
    return hexa


def mesure(libelle, texte, fond, seuil):
    """Ajoute une paire au tableau. `texte`/`fond` peuvent être None (variable absente
    de couleurs.css) : la paire est alors comptée en échec."""
    if texte is None or fond is None:
        lignes.append((libelle, texte or '?', fond or '?', None, seuil, False))
        return
    valeur = apca.lc(texte, fond)
    lignes.append((libelle, texte, fond, valeur, seuil, abs(valeur) >= seuil))


def titre(libelle):
    lignes.append((libelle, None, None, None, None, None))


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
            # gros titre (poireau, +60,5). Ce n'est pas une autorisation. Dans une grille à
            # clarté fixe, un cran doit signifier la MÊME chose pour les six teintes, et la
            # garantie est le PIRE des six (56,3 < 60). « Aucun texte » vaut donc pour tout
            # le cran, y compris la teinte qui s'en sortirait de justesse.
            if fond is not None:
                gagnant, valeur = apca.meilleure_polarite(fond)
                lignes.append(('%s -%s (au mieux : %s — garantie du cran : %.1f < 60)'
                               % (nom, cran, 'noir' if gagnant == apca.NOIR else 'blanc',
                                  garanti),
                               gagnant, fond, valeur, None, 'info'))
                # Le vrai contrôle du cran décoratif : le |Lc| annoncé (56,3) doit bien
                # être le PLANCHER des six teintes. Si une teinte descend en dessous,
                # l'en-tête de couleurs.css et la planche mentent.
                if abs(valeur) < garanti - MARGE_GARANTI:
                    ecarts.append(('%s -%s (meilleure polarité)' % (nom, cran),
                                   abs(valeur), garanti))
            continue
        seuil = TEXTE if usage == 'texte courant' else GROS_TITRE
        mesure('%s -%s (fond, texte %s — %s)'
               % (nom, cran, 'noir' if texte == NOIR else 'blanc', usage),
               texte, fond, seuil)
        # Second contrôle, le plus important : la paire tient-elle le |Lc| GARANTI annoncé
        # en tête de couleurs.css ? Sinon le CSS promet plus qu'il ne tient.
        if fond is not None:
            valeur = abs(apca.lc(texte, fond))
            if valeur < garanti - MARGE_GARANTI:
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
# rouge, 300 pour la moutarde, 500 pour les quatre autres) ; -clair = cran 200 ; -fonce =
# cran 700 — qui, pour le rouge, EST la charte : le fond « negatif » d'un tableau rouge et
# le --c-annual-deep d'un numéro rouge valent #D31932 et non plus le #C3112C calculé.
# On les remesure ICI, en suivant les renvois var(), au lieu de faire
# confiance au §1 : si quelqu'un repointe -clair vers le 300 ou le 400 (crans SANS texte
# courant), le §1 resterait vert et c'est cette section-là qui doit crier.
titre("Alias des tableaux (--szh-accent* = --c-<nom>-normal/-clair/-fonce)")
for nom, marque in COULEURS:
    mesure('%s -clair (fond « couleur », texte noir) = cran 200' % nom,
           NOIR, var('--c-%s-clair' % nom), TEXTE)
    mesure('%s -fonce (fond « negatif », texte blanc) = cran 700' % nom,
           BLANC, var('--c-%s-fonce' % nom), TEXTE)
    mesure('%s -normal (accent brut sur papier) = marque' % nom,
           var('--c-%s-normal' % nom), BLANC, NON_TEXTE)

# ═══ 3. Teintes neutres et replis gris ════════════════════════════════════════════
titre("Teintes neutres des tableaux + replis gris de print.css")
mesure('--szh-gris-clair (en-têtes/total gris)', NOIR, var('--szh-gris-clair'), TEXTE)
mesure('--szh-zebre (zébrage, texte de corps)', NOIR, var('--szh-zebre'), TEXTE)
mesure('repli --szh-accent-fonce #4a4a4a', BLANC, '#4a4a4a', TEXTE)
mesure('repli --szh-accent-clair #ededed', NOIR, '#ededed', TEXTE)
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
    mesure('%s --c-annual-text sur papier' % nom, j['--c-annual-text'], BLANC, TEXTE)
    mesure('%s --c-kw-bg (mots-clés, texte noir)' % nom, NOIR, j['--c-kw-bg'], TEXTE)
    mesure('%s --annual-soft (encadré, texte noir)' % nom, NOIR, j['--annual-soft'], TEXTE)
    mesure('%s --annual-tint (bande, texte noir)' % nom, NOIR, j['--annual-tint'], TEXTE)
    mesure('%s --c-annual-ui (filet sur papier)' % nom, j['--c-annual-ui'], BLANC, NON_TEXTE)
    # Les 3 filets de tableau (print.css § Bordures) portent --c-annual-ui et tombent
    # souvent sur une rangée zébrée : c'est la paire réellement utilisée, pas la couleur
    # de marque brute (qui n'atteignait que Lc +22 en moutarde).
    mesure('%s --c-annual-ui (filet de tableau sur zébrage)' % nom,
           j['--c-annual-ui'], var('--szh-zebre'), NON_TEXTE)
    mesure('%s --c-abstract-border (bordure/papier)' % nom,
           j['--c-abstract-border'], BLANC, NON_TEXTE)
    # --c-annual-deep = cran 700, le MÊME que l'alias -fonce des tableaux : une seule
    # règle « fond sombre à texte blanc » dans toute la chaîne.
    mesure('%s --c-annual-deep (fond, texte blanc) = cran 700' % nom,
           BLANC, j['--c-annual-deep'], TEXTE)


# ═══ 5. Sortie ════════════════════════════════════════════════════════════════════

def afficher():
    largeur = max(len(l[0]) for l in lignes)
    entete = '%-*s  %-7s  %-7s  %8s  %6s  %s' % (
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
        if ok == 'info':                     # mesure affichée, aucun seuil à tenir
            print('%-*s  %-7s  %-7s  %+8.1f  %6s  %s' % (
                largeur, libelle, texte.upper(), fond.upper(), valeur, '-', 'info'))
            continue
        print('%-*s  %-7s  %-7s  %+8.1f  %6s  %s' % (
            largeur, libelle, texte.upper(), fond.upper(),
            valeur if valeur is not None else 0.0,
            '>= %d' % seuil, 'OK' if ok else 'ÉCHEC'))
    echecs = [l for l in lignes if l[5] is False]
    total = len([l for l in lignes if l[5] is not None and l[5] != 'info'])
    print()
    if manquants:
        print('Variables introuvables dans couleurs.css : %s' % ', '.join(sorted(set(manquants))))
    print('%d paires vérifiées, %d échec(s).' % (total, len(echecs)))
    for libelle, texte, fond, valeur, seuil, _ in echecs:
        print('  ÉCHEC  %s : %s sur %s -> Lc %+.1f (seuil %d)' % (
            libelle, texte.upper(), fond.upper(), valeur or 0.0, seuil))

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

    # Le cahier des charges d'origine exige « au moins 3 et 3 » : au moins 3 crans portant
    # du texte courant NOIR et 3 du texte courant BLANC. On le recompte à partir du
    # contrat réel plutôt que de l'affirmer en commentaire.
    noirs = [c for c in CRANS if apca.CONTRAT[c][0] == NOIR
             and apca.CONTRAT[c][2] == 'texte courant']
    blancs = [c for c in CRANS if apca.CONTRAT[c][0] == BLANC
              and apca.CONTRAT[c][2] == 'texte courant']
    decoratifs = [c for c in CRANS if apca.CONTRAT[c][0] is None]
    print('Texte courant : %d crans à texte noir (%s) et %d à texte blanc (%s) '
          '-- exigence « au moins 3 et 3 » : %s.'
          % (len(noirs), '/'.join(noirs), len(blancs), '/'.join(blancs),
             'tenue' if len(noirs) >= 3 and len(blancs) >= 3 else 'NON TENUE'))
    print('Cran(s) décoratif(s), AUCUN TEXTE autorisé : %s.' % '/'.join(decoratifs))
    if len(noirs) < 3 or len(blancs) < 3:
        return 1
    return 1 if (echecs or ecarts or alterees or alias_faux or ratees) else 0


if __name__ == '__main__':
    sys.exit(afficher())
