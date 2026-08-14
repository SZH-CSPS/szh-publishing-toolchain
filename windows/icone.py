#!/usr/bin/env python3
# icone.py — fabrique windows/szh-revue.ico, l'icône de l'entrée « Revue SZH » dans
# « Ouvrir avec » et du type de fichier .md associé.
#
#     python3 windows/icone.py        (réécrit szh-revue.ico à côté)
#
# POURQUOI UNE ICÔNE À NOUS, et pas celle de VSCodium : dans la boîte « Ouvrir avec »,
# l'entrée « Revue SZH » et l'entrée « VSCodium » se suivent. Leur donner la même icône
# rendrait le choix impossible à faire d'un coup d'œil — or c'est précisément ce choix
# que l'utilisateur doit réussir une fois pour toutes (D18 : Windows scelle son
# « Toujours »). Sans icône du tout, le shell affiche celle de wscript.exe, l'hôte de
# scripts, ce qui est encore pire : ni parlant, ni rassurant.
#
# LE DESSIN : une tuile bleu nuit (#252B46, la couleur permanente du hero de couverture,
# D70) barrée du rouge de charte (#D31932). Deux aplats et une barre : c'est tout ce qui
# reste lisible à 16 px, la taille où l'icône sera le plus souvent vue. Aucune lettre —
# à 16 px, un glyphe devient une tache.
#
# stdlib uniquement (struct + zlib) : le format ICO n'est qu'un en-tête suivi d'images
# PNG, et PNG n'est qu'un en-tête suivi de blocs zlib. Aucune dépendance à installer,
# donc l'icône reste régénérable sur n'importe quel poste.

import os
import struct
import zlib

NUIT = (0x25, 0x2B, 0x46)
ROUGE = (0xD3, 0x19, 0x32)
TAILLES = (16, 24, 32, 48, 64, 128, 256)
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'szh-revue.ico')


def dessiner(n):
    """Damier RGBA de n×n pixels, rendu à 4× puis moyenné — c'est le seul anti-aliasing
    possible sans bibliothèque graphique, et sans lui les bords arrondis crénellent."""
    e = 4
    N = n * e
    marge = N * 0.05                 # respiration autour de la tuile
    rayon = N * 0.17                 # arrondi des coins
    x0, y0, x1, y1 = marge, marge, N - marge, N - marge
    bande = (N * 0.60, N * 0.79)     # la barre rouge, dans le tiers bas

    def dans_tuile(x, y):
        """Rectangle à coins arrondis : hors du cadre -> non ; dans la zone d'un coin ->
        test de distance au centre de l'arrondi ; ailleurs -> oui."""
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return False
        cx = x0 + rayon if x < x0 + rayon else (x1 - rayon if x > x1 - rayon else None)
        cy = y0 + rayon if y < y0 + rayon else (y1 - rayon if y > y1 - rayon else None)
        if cx is None or cy is None:
            return True              # bord droit, pas un coin
        return (x - cx) ** 2 + (y - cy) ** 2 <= rayon ** 2

    pixels = []
    for y in range(n):
        ligne = []
        for x in range(n):
            r = v = b = a = 0
            for dy in range(e):
                for dx in range(e):
                    sx, sy = x * e + dx + 0.5, y * e + dy + 0.5
                    if not dans_tuile(sx, sy):
                        continue
                    couleur = ROUGE if bande[0] <= sy < bande[1] else NUIT
                    r += couleur[0]
                    v += couleur[1]
                    b += couleur[2]
                    a += 255
            n_sous = e * e
            if a == 0:
                ligne.append((0, 0, 0, 0))
            else:
                couverts = a // 255
                ligne.append((r // couverts, v // couverts, b // couverts, a // n_sous))
        pixels.append(ligne)
    return pixels


def png(pixels):
    """Encode un damier RGBA en PNG (stdlib : c'est 3 blocs et un CRC)."""
    n = len(pixels)
    brut = b''.join(b'\x00' + bytes(v for px in ligne for v in px) for ligne in pixels)

    def bloc(nom, donnees):
        return (struct.pack('>I', len(donnees)) + nom + donnees
                + struct.pack('>I', zlib.crc32(nom + donnees) & 0xFFFFFFFF))

    return (b'\x89PNG\r\n\x1a\n'
            + bloc(b'IHDR', struct.pack('>IIBBBBB', n, n, 8, 6, 0, 0, 0))
            + bloc(b'IDAT', zlib.compress(brut, 9))
            + bloc(b'IEND', b''))


def main():
    images = [(t, png(dessiner(t))) for t in TAILLES]
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
    with open(SORTIE, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, len(images)) + entetes + corps)
    print('Écrit : %s (%d octets, %d tailles)'
          % (SORTIE, os.path.getsize(SORTIE), len(images)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
