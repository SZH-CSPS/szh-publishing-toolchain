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
# La couleur de MARQUE est hors grille (jeton -marque) : son hex est imposé par la charte,
# on ne lui applique donc aucun seuil de texte courant — seulement le seuil gros titre
# dans sa meilleure polarité, et le seuil non textuel comme bordure épaisse.
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
alterees = []    # (nom, hex de charte, hex lu) si un jeton -marque a été retouché


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

    # La couleur de MARQUE est HORS GRILLE : son hex est imposé par la charte, donc on ne
    # lui impose pas le seuil du texte courant (aucune des 6 ne l'atteint, dans aucune
    # polarité). On vérifie la MEILLEURE polarité au seuil « gros titre » et on annonce
    # laquelle gagne — c'est son seul usage textuel légitime (titres de couverture).
    fond = var('--c-%s-marque' % nom)
    if fond is not None:
        gagnant, valeur = apca.meilleure_polarite(fond)
        mesure('%s -marque (hors grille, gros titre — %s gagne)'
               % (nom, 'noir' if gagnant == apca.NOIR else 'blanc'),
               gagnant, fond, GROS_TITRE)
    # La marque brute sert aussi de bordure ÉPAISSE sur le papier (--c-annual : filet de
    # couverture 6 px, bords d'encadré 4 px, --c-abstract-border 3 px) : non textuel.
    mesure('%s -marque (bordure épaisse sur papier)' % nom, fond, BLANC, NON_TEXTE)
    # Le hex de marque doit être STRICTEMENT celui de la charte : c'est la seule valeur du
    # fichier qui ne se recalcule pas. Une retouche accidentelle doit faire échouer le test.
    if fond is None or fond.upper() != marque.upper():
        alterees.append((nom, marque, fond))

# ═══ 2. Alias lus par accent-css.py pour les tableaux ═════════════════════════════
# Noms figés, cibles nouvelles : -normal = la marque (hors grille), -clair = cran 200,
# -fonce = cran 700. On les remesure ICI, en suivant les renvois var(), au lieu de faire
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

    # Deux familles d'échec qui ne sont pas des « paires » : le |Lc| garanti que l'en-tête
    # de couleurs.css annonce, et l'intégrité des 6 hex de charte. Elles font échouer le
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
        print('Hex de MARQUE altéré(s) — la charte n\'est pas négociable :')
        for nom, attendu, lu in alterees:
            print('  MARQUE  %s : attendu %s, lu %s' % (nom, attendu, lu))
    else:
        print('Hex de marque : les %d couleurs de charte sont strictement inchangées.'
              % len(COULEURS))

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
    return 1 if (echecs or ecarts or alterees) else 0


if __name__ == '__main__':
    sys.exit(afficher())
