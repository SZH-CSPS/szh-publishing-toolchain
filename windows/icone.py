#!/usr/bin/env python3
# icone.py : fabrique les icônes de produit du toolkit, à côté de ce script.
#
#     szh-revue.ico        boîte « Nouvelle revue… » (onglet « Revue »)
#     szh-zeitschrift.ico  boîte « Nouvelle Zeitschrift… » (onglet « Zeitschrift »)
#     szh-livre.ico        boîte « Nouveau livre… » (onglet « Book »)
#     szh-maj.ico          utilisée nulle part, encore fabriquée
#
#     python3 windows/icone.py
#
# Les icônes de l'application (pronto.ico, pronto-maj.ico) sont faites par icone-pronto.py.
#
# Le dessin, « l'étagère » : trois dos de fascicule couleur papier posés sur une tablette
# de la couleur du produit (capucine #EB5E51 pour la Revue, moutarde #C7CF1C pour la
# Zeitschrift, sarcelle #1B6E6A pour les livres), sur une tuile bleu nuit. Pas de lettre :
# à 16 px elle deviendrait une tache. Les trois couleurs de tablette diffèrent d'au moins
# 48 niveaux de gris deux à deux : les icônes se distinguent aussi en niveaux de gris et
# pour un œil qui confond le rouge et le vert.
#
# szh-maj.ico remplace les dos par une flèche vers le bas, sur une tablette bleu acier
# #5F9FBC. Ce bleu n'est qu'à 8 niveaux de gris de la capucine : c'est la flèche qui
# distingue l'icône.
#
# Les formes sont en unités d'un SVG de 256 × 256, ramenées à chaque taille au rendu.
#
# Bibliothèque standard seule : un ICO est un en-tête suivi d'images PNG, et un PNG un
# en-tête suivi de blocs zlib.

import os
import struct
import zlib

NUIT = (0x25, 0x2B, 0x46)
PAPIER = (0xF5, 0xF2, 0xEA)
CAPUCINE = (0xEB, 0x5E, 0x51)
MOUTARDE = (0xC7, 0xCF, 0x1C)
BLEUACIER = (0x5F, 0x9F, 0xBC)
SARCELLE = (0x1B, 0x6E, 0x6A)

# Deux sortes de formes, en unités du SVG : un rectangle à coins arrondis
# (x, y, largeur, hauteur, rayon) ou un triangle (ses trois sommets).
UNITE = 256.0
TUILE = (0, 0, 256, 256, 43.5)
DOS = ((52, 52, 40, 136, 5), (108, 40, 40, 148, 5), (164, 60, 40, 128, 5))
TABLETTE = (24, 188, 208, 48, 6)
# La flèche : hampe, puis pointe. Elle s'arrête 14 unités au-dessus de la tablette (presque
# un pixel à 16 px), pour garder un liseré de tuile entre les deux.
FLECHE_HAMPE = (104, 36, 48, 86, 6)
FLECHE_POINTE = ((64, 108), (192, 108), (128, 174))

# Un dessin : les formes dans l'ordre de priorité, chacune avec sa couleur (None : la
# couleur du produit). La tuile sert de fond (voir `couleur`).
ETAGERE = ((TABLETTE, None),) + tuple((d, PAPIER) for d in DOS)
FLECHE = ((TABLETTE, None), (FLECHE_HAMPE, PAPIER), (FLECHE_POINTE, PAPIER))

# Tailles demandées par Windows : 16 et 20 pour la barre des tâches et les listes, 24 à 48
# pour le menu Démarrer et Alt+Tab selon la mise à l'échelle, 64 à 256 pour les grandes
# tuiles et les propriétés de fichier.
TAILLES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
ICI = os.path.dirname(os.path.abspath(__file__))
# Noms de fichier lus par szh-produits.ps1 : un changement se fait aux deux endroits.
VARIANTES = (('szh-revue.ico', CAPUCINE, ETAGERE),
             ('szh-zeitschrift.ico', MOUTARDE, ETAGERE),
             ('szh-maj.ico', BLEUACIER, FLECHE),
             ('szh-livre.ico', SARCELLE, ETAGERE))


def dans_rectangle(rect, u, v):
    """Vrai si le point (u, v) est dans le rectangle à coins arrondis. Dans la zone d'un
    coin, on compare la distance au centre de l'arrondi."""
    x, y, larg, haut, r = rect
    if not (x <= u <= x + larg and y <= v <= y + haut):
        return False
    cx = x + r if u < x + r else (x + larg - r if u > x + larg - r else None)
    cy = y + r if v < y + r else (y + haut - r if v > y + haut - r else None)
    if cx is None or cy is None:
        return True
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r


def dans_triangle(tri, u, v):
    """Vrai si le point (u, v) est du même côté des trois arêtes du triangle, quel que soit
    l'ordre des sommets."""
    (x1, y1), (x2, y2), (x3, y3) = tri
    d1 = (u - x2) * (y1 - y2) - (x1 - x2) * (v - y2)
    d2 = (u - x3) * (y2 - y3) - (x2 - x3) * (v - y3)
    d3 = (u - x1) * (y3 - y1) - (x3 - x1) * (v - y1)
    return (d1 >= 0 and d2 >= 0 and d3 >= 0) or (d1 <= 0 and d2 <= 0 and d3 <= 0)


def dans(forme, u, v):
    """Trois sommets : un triangle. Cinq nombres : un rectangle à coins arrondis."""
    if len(forme) == 3:
        return dans_triangle(forme, u, v)
    return dans_rectangle(forme, u, v)


def couleur(u, v, accent, dessin):
    """Couleur du dessin au point (u, v), en unités du SVG, ou None hors de la tuile."""
    for forme, teinte in dessin:
        if dans(forme, u, v):
            return accent if teinte is None else teinte
    if dans(TUILE, u, v):
        return NUIT
    return None


def dessiner(n, accent, dessin):
    """Image RGBA de n×n pixels. Chaque pixel est la moyenne de plusieurs échantillons
    (anti-aliasing), plus nombreux aux petites tailles où un pixel porte un détail entier."""
    e = 8 if n <= 64 else 4
    echelle = UNITE / (n * e)
    n_sous = e * e
    pixels = []
    for y in range(n):
        ligne = []
        for x in range(n):
            r = v = b = a = 0
            for dy in range(e):
                for dx in range(e):
                    c = couleur((x * e + dx + 0.5) * echelle,
                                (y * e + dy + 0.5) * echelle, accent, dessin)
                    if c is None:
                        continue
                    r += c[0]
                    v += c[1]
                    b += c[2]
                    a += 255
            if a == 0:
                ligne.append((0, 0, 0, 0))
            else:
                couverts = a // 255
                ligne.append((r // couverts, v // couverts, b // couverts, a // n_sous))
        pixels.append(ligne)
    return pixels


def png(pixels):
    """Encode une image RGBA en PNG."""
    n = len(pixels)
    brut = b''.join(b'\x00' + bytes(v for px in ligne for v in px) for ligne in pixels)

    def bloc(nom, donnees):
        return (struct.pack('>I', len(donnees)) + nom + donnees
                + struct.pack('>I', zlib.crc32(nom + donnees) & 0xFFFFFFFF))

    return (b'\x89PNG\r\n\x1a\n'
            + bloc(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0))
            + bloc(b'IDAT', zlib.compress(brut, 9))
            + bloc(b'IEND', b''))


def ecrire(nom, accent, dessin):
    """Écrit le .ico multi-tailles `nom` dans ce dossier et rend son chemin."""
    images = [(t, png(dessiner(t, accent, dessin))) for t in TAILLES]
    entetes = b''
    corps = b''
    decalage = 6 + 16 * len(images)
    for taille, donnees in images:
        entetes += struct.pack('<BBBBHHII',
                               0 if taille >= 256 else taille,   # 0 = 256 px
                               0 if taille >= 256 else taille,
                               0, 0, 1, 32, len(donnees), decalage)
        corps += donnees
        decalage += len(donnees)
    sortie = os.path.join(ICI, nom)
    with open(sortie, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, len(images)) + entetes + corps)
    return sortie


def main():
    for nom, accent, dessin in VARIANTES:
        sortie = ecrire(nom, accent, dessin)
        print('Écrit : %s (%d octets, %d tailles)'
              % (sortie, os.path.getsize(sortie), len(TAILLES)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
