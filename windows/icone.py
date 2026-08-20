#!/usr/bin/env python3
# icone.py — fabrique les deux icônes du toolkit, à côté de ce script :
#
#     szh-revue.ico        raccourci « Revues SZH » du menu Démarrer, entrée « Revue SZH »
#                          d'« Ouvrir avec » et type de fichier .md associé
#     szh-zeitschrift.ico  raccourci « Zeitschriften SZH » du menu Démarrer
#
#     python3 windows/icone.py        (réécrit les deux .ico à côté)
#
# Une icône à nous plutôt que celle de VSCodium : les deux entrées se suivent dans la
# boîte « Ouvrir avec », et l'utilisateur doit reconnaître d'un coup d'œil celle qu'il
# coche une fois pour toutes. Sans icône, le shell affiche celle de wscript.exe, qui ne
# dit rien à personne. Une par produit : épinglés à la barre des tâches, les raccourcis
# perdent leur libellé et l'icône devient le seul repère.
#
# Le dessin : tuile bleu nuit #252B46, celle du hero de couverture, barrée d'une couleur
# de la charte — rouge #D31932 pour la Revue, moutarde #C7CF1C pour la Zeitschrift. Deux
# aplats et une barre, c'est tout ce qui reste lisible à 16 px, la taille la plus vue ;
# aucune lettre, un glyphe y devient une tache. La moutarde est la couleur de la palette
# la plus éloignée du rouge en clarté comme en teinte, donc les deux icônes se
# distinguent en niveaux de gris et pour un œil qui confond le rouge et le vert.
#
# stdlib seule : un ICO n'est qu'un en-tête suivi d'images PNG, et un PNG un en-tête suivi
# de blocs zlib. Rien à installer, les icônes restent régénérables partout.

import os
import struct
import zlib

NUIT = (0x25, 0x2B, 0x46)
ROUGE = (0xD3, 0x19, 0x32)
MOUTARDE = (0xC7, 0xCF, 0x1C)
TAILLES = (16, 24, 32, 48, 64, 128, 256)
ICI = os.path.dirname(os.path.abspath(__file__))
# Un fichier par produit. Ces noms sont ceux que cherche update.ps1 : les changer ici
# sans les changer là-bas fait retomber les raccourcis sur l'icône de VSCodium.
VARIANTES = (('szh-revue.ico', ROUGE), ('szh-zeitschrift.ico', MOUTARDE))


def dessiner(n, accent):
    """Damier RGBA de n×n pixels, rendu à 4× puis moyenné — c'est le seul anti-aliasing
    possible sans bibliothèque graphique, et sans lui les bords arrondis crénellent.
    `accent` est la couleur de la barre, seule différence entre les deux produits."""
    e = 4
    N = n * e
    marge = N * 0.05                 # respiration autour de la tuile
    rayon = N * 0.17                 # arrondi des coins
    x0, y0, x1, y1 = marge, marge, N - marge, N - marge
    bande = (N * 0.60, N * 0.79)     # la barre d'accent, dans le tiers bas

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
                    couleur = accent if bande[0] <= sy < bande[1] else NUIT
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


def ecrire(nom, accent):
    """Assemble le .ico multi-tailles `nom` (dans ce dossier) avec la barre `accent`."""
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
