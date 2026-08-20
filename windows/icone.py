#!/usr/bin/env python3
# icone.py — fabrique les deux icônes du toolkit, à côté de ce script :
#
#     szh-revue.ico        raccourci « Revues SZH » du menu Démarrer, fenêtres du lanceur,
#                          entrée « Revue SZH » d'« Ouvrir avec » et type de fichier .md
#     szh-zeitschrift.ico  raccourci « Zeitschriften SZH » et fenêtres de ce lanceur
#
#     python3 windows/icone.py        (réécrit les deux .ico à côté)
#
# Une icône à nous plutôt que celle de VSCodium : les deux entrées se suivent dans la
# boîte « Ouvrir avec », et l'utilisateur doit reconnaître d'un coup d'œil celle qu'il
# coche une fois pour toutes. Sans icône, le shell affiche celle de wscript.exe, qui ne
# dit rien à personne. Une par produit : épinglés à la barre des tâches, les raccourcis
# perdent leur libellé et l'icône devient le seul repère.
#
# Le dessin, « l'étagère » : trois dos de fascicule couleur papier, de hauteurs inégales,
# posés sur une tablette de la couleur du produit — capucine #EB5E51 pour la Revue,
# moutarde #C7CF1C pour la Zeitschrift — sur la tuile bleu nuit du hero de couverture.
# Aucune lettre : à 16 px un glyphe devient une tache. Les deux couleurs de tablette sont
# séparées de 69 niveaux de gris, donc les icônes se distinguent aussi en niveaux de gris
# et pour un œil qui confond le rouge et le vert.
#
# La géométrie est la transcription du SVG livré (viewBox 0 0 256 256) : les rectangles y
# gardent leurs coordonnées d'origine, et le rendu ne fait que ramener ces 256 unités à la
# taille demandée. Changer le dessin, c'est changer ce tableau, rien d'autre.
#
# stdlib seule : un ICO n'est qu'un en-tête suivi d'images PNG, et un PNG un en-tête suivi
# de blocs zlib. Rien à installer, les icônes restent régénérables partout.

import os
import struct
import zlib

NUIT = (0x25, 0x2B, 0x46)
PAPIER = (0xF5, 0xF2, 0xEA)
CAPUCINE = (0xEB, 0x5E, 0x51)
MOUTARDE = (0xC7, 0xCF, 0x1C)

# (x, y, largeur, hauteur, rayon) en unités du SVG, dans l'ordre de peinture.
UNITE = 256.0
TUILE = (0, 0, 256, 256, 43.5)
DOS = ((52, 52, 40, 136, 5), (108, 40, 40, 148, 5), (164, 60, 40, 128, 5))
TABLETTE = (24, 188, 208, 48, 6)

# Les tailles que Windows demande : 16 et 20 pour la barre des tâches et les listes, 24 à
# 48 pour le menu Démarrer et Alt+Tab selon la mise à l'échelle, 64 à 256 pour les grandes
# tuiles et les propriétés de fichier.
TAILLES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
ICI = os.path.dirname(os.path.abspath(__file__))
# Un fichier par produit. Ces noms sont ceux que cherchent update.ps1 et open-revue.ps1 :
# les changer ici sans les changer là-bas fait retomber les raccourcis sur VSCodium.
VARIANTES = (('szh-revue.ico', CAPUCINE), ('szh-zeitschrift.ico', MOUTARDE))


def dans(rect, u, v):
    """Le point (u, v) est-il dans ce rectangle à coins arrondis ? Hors du cadre : non.
    Dans la zone d'un coin : distance au centre de l'arrondi. Ailleurs : oui."""
    x, y, larg, haut, r = rect
    if not (x <= u <= x + larg and y <= v <= y + haut):
        return False
    cx = x + r if u < x + r else (x + larg - r if u > x + larg - r else None)
    cy = y + r if v < y + r else (y + haut - r if v > y + haut - r else None)
    if cx is None or cy is None:
        return True
    return (u - cx) ** 2 + (v - cy) ** 2 <= r * r


def couleur(u, v, accent):
    """Couleur du dessin au point (u, v), en unités du SVG, ou None hors de la tuile."""
    if dans(TABLETTE, u, v):
        return accent
    for d in DOS:
        if dans(d, u, v):
            return PAPIER
    if dans(TUILE, u, v):
        return NUIT
    return None


def dessiner(n, accent):
    """Damier RGBA de n×n pixels, échantillonné puis moyenné — c'est le seul anti-aliasing
    possible sans bibliothèque graphique, et sans lui les arrondis crénellent et les
    intervalles entre les dos disparaissent. L'échantillonnage est plus fin aux petites
    tailles, où un pixel porte un détail entier."""
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
                                (y * e + dy + 0.5) * echelle, accent)
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
    """Encode un damier RGBA en PNG : trois blocs et un CRC."""
    n = len(pixels)
    brut = b''.join(b'\x00' + bytes(v for px in ligne for v in px) for ligne in pixels)

    def bloc(nom, donnees):
        return (struct.pack('>I', len(donnees)) + nom + donnees
                + struct.pack('>I', zlib.crc32(nom + donnees) & 0xFFFFFFFF))

    return (b'\x89PNG\r\n\x1a\n'
            + bloc(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0))
            + bloc(b'IDAT', zlib.compress(brut, 9))
            + bloc(b'IEND', b''))


def ecrire(nom, accent):
    """Assemble le .ico multi-tailles `nom`, dans ce dossier, avec cette tablette."""
    images = [(t, png(dessiner(t, accent))) for t in TAILLES]
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
    for nom, accent in VARIANTES:
        sortie = ecrire(nom, accent)
        print('Écrit : %s (%d octets, %d tailles)'
              % (sortie, os.path.getsize(sortie), len(TAILLES)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
