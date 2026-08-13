#!/usr/bin/env python3
# apca-check.py — vérificateur de contraste APCA de TOUTE la palette.
#
#   python3 test/apca-check.py          -> tableau lisible + code de sortie
#   code de sortie 0 = toutes les paires passent ; 1 = au moins une échoue.
#
# À lancer après CHAQUE modification de pipeline/styles/couleurs.css (les niveaux sont
# calculés au plus juste : la couleur la plus vive qui tienne encore sa cible, donc les
# marges sont serrées) et après toute modification d'accent-css.py.
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

# Cibles annoncées par l'échelle : niveau -> (couleur de texte, |Lc| minimal).
NIVEAUX = ([(n, NOIR, cible) for n, cible in apca.NIVEAUX_CLAIRS]
           + [(n, BLANC, cible) for n, cible in apca.NIVEAUX_SOMBRES])

CSS = accent.couleurs_css()
lignes = []      # (libelle, texte, fond, lc, seuil, ok)
manquants = []   # variables introuvables dans couleurs.css


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


# ═══ 1. L'échelle de couleurs.css ═════════════════════════════════════════════════
titre("Échelle des 6 couleurs (pipeline/styles/couleurs.css)")
for nom, marque in COULEURS:
    for niveau, texte, cible in NIVEAUX:
        mesure('%s -%s (fond)' % (nom, niveau), texte, var('--c-%s-%s' % (nom, niveau)), cible)
    # Le niveau 500 est la couleur de MARQUE : intouchable, donc on ne lui impose pas le
    # seuil du texte courant (aucune des 6 ne l'atteint). On vérifie la MEILLEURE
    # polarité au seuil « gros titre » et on annonce laquelle gagne.
    fond = var('--c-%s-500' % nom)
    if fond is not None:
        gagnant, valeur = apca.meilleure_polarite(fond)
        mesure('%s -500 (marque, gros titre — %s gagne)'
               % (nom, 'noir' if gagnant == apca.NOIR else 'blanc'),
               gagnant, fond, GROS_TITRE)
    # Le 500 brut sert aussi de bordure ÉPAISSE sur le papier (--c-annual : filet de
    # couverture 6 px, bords d'encadré 4 px, --c-abstract-border 3 px) : non textuel.
    mesure('%s -500 (bordure épaisse sur papier)' % nom, fond, BLANC, NON_TEXTE)

# ═══ 2. Alias lus par accent-css.py pour les tableaux ═════════════════════════════
titre("Alias des tableaux (--szh-accent* = --c-<nom>-normal/-clair/-fonce)")
for nom, marque in COULEURS:
    mesure('%s -clair (fond « couleur », texte noir)' % nom,
           NOIR, var('--c-%s-clair' % nom), TEXTE)
    mesure('%s -fonce (fond « negatif », texte blanc)' % nom,
           BLANC, var('--c-%s-fonce' % nom), TEXTE)
    mesure('%s -normal (accent brut sur papier)' % nom,
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
    mesure('%s --c-annual-deep (fond, texte blanc)' % nom, BLANC, j['--c-annual-deep'], TEXTE)


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
        print('%-*s  %-7s  %-7s  %+8.1f  %6s  %s' % (
            largeur, libelle, texte.upper(), fond.upper(),
            valeur if valeur is not None else 0.0,
            '>= %d' % seuil, 'OK' if ok else 'ÉCHEC'))
    echecs = [l for l in lignes if l[5] is False]
    total = len([l for l in lignes if l[5] is not None])
    print()
    if manquants:
        print('Variables introuvables dans couleurs.css : %s' % ', '.join(sorted(set(manquants))))
    print('%d paires vérifiées, %d échec(s).' % (total, len(echecs)))
    for libelle, texte, fond, valeur, seuil, _ in echecs:
        print('  ÉCHEC  %s : %s sur %s -> Lc %+.1f (seuil %d)' % (
            libelle, texte.upper(), fond.upper(), valeur or 0.0, seuil))
    return 1 if echecs else 0


if __name__ == '__main__':
    sys.exit(afficher())
