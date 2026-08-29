#!/usr/bin/env python3
# icone.py — fabrique les quatre icônes du toolkit, à côté de ce script :
#
#     szh-revue.ico        raccourci « Revues SZH » du menu Démarrer, fenêtres du lanceur,
#                          entrée « Revue SZH » d'« Ouvrir avec » et type de fichier .md
#     szh-zeitschrift.ico  raccourci « Zeitschriften SZH » et fenêtres de ce lanceur
#     szh-maj.ico          les deux raccourcis de mise à jour du menu Démarrer
#     szh-livre.ico        raccourci « Books SZH-CSPS » et fenêtres de ce lanceur
#
#     python3 windows/icone.py        (réécrit les quatre .ico à côté)
#
# Une icône à nous plutôt que celle de VSCodium : les entrées se suivent dans la
# boîte « Ouvrir avec », et l'utilisateur doit reconnaître d'un coup d'œil celle qu'il
# coche une fois pour toutes. Sans icône, le shell affiche celle de wscript.exe, qui ne
# dit rien à personne. Une par produit : épinglés à la barre des tâches, les raccourcis
# perdent leur libellé et l'icône devient le seul repère.
#
# Le dessin, « l'étagère » : trois dos de fascicule couleur papier, de hauteurs inégales,
# posés sur une tablette de la couleur du produit — capucine #EB5E51 pour la Revue,
# moutarde #C7CF1C pour la Zeitschrift, sarcelle #1B6E6A pour les livres — sur la tuile
# bleu nuit du hero de couverture. Aucune lettre : à 16 px un glyphe devient une tache. Les
# trois couleurs de tablette sont séparées d'au moins 48 niveaux de gris deux à deux, donc
# les icônes se distinguent aussi en niveaux de gris et pour un œil qui confond le rouge et
# le vert — la sarcelle a été choisie contre les deux autres, pas seulement contre l'une.
#
# La mise à jour, elle, garde la tuile et la tablette — la famille — mais remplace les dos
# par une grosse flèche vers le bas, le signe attendu pour « installer ». Ici la différence
# est portée par le dessin et non par la couleur : la tablette prend le bleu acier #5F9FBC
# de la charte, qui dit « l'outil » plutôt que l'un des produits, mais il ne s'écarte que de
# 8 niveaux de gris de la capucine. C'est la flèche, pas la teinte, qui distingue cette
# icône à 16 px et en niveaux de gris.
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
BLEUACIER = (0x5F, 0x9F, 0xBC)
SARCELLE = (0x1B, 0x6E, 0x6A)

# Deux sortes de formes, en unités du SVG : un rectangle à coins arrondis
# (x, y, largeur, hauteur, rayon), cinq nombres, ou un triangle — ses trois sommets.
UNITE = 256.0
TUILE = (0, 0, 256, 256, 43.5)
DOS = ((52, 52, 40, 136, 5), (108, 40, 40, 148, 5), (164, 60, 40, 128, 5))
TABLETTE = (24, 188, 208, 48, 6)
# La flèche : sa hampe, puis sa pointe. Elle s'arrête 14 unités au-dessus de la tablette,
# soit presque un pixel à 16 px : de quoi garder un liseré de tuile entre les deux.
FLECHE_HAMPE = (104, 36, 48, 86, 6)
FLECHE_POINTE = ((64, 108), (192, 108), (128, 174))

# Un dessin : les formes à peindre dans l'ordre, chacune avec sa couleur — None voulant
# dire « la couleur du produit ». La tuile est peinte en dernier, par `couleur`, pour
# servir de fond à tout le reste. Changer le dessin, c'est changer ces deux lignes.
ETAGERE = ((TABLETTE, None),) + tuple((d, PAPIER) for d in DOS)
FLECHE = ((TABLETTE, None), (FLECHE_HAMPE, PAPIER), (FLECHE_POINTE, PAPIER))

# Les tailles que Windows demande : 16 et 20 pour la barre des tâches et les listes, 24 à
# 48 pour le menu Démarrer et Alt+Tab selon la mise à l'échelle, 64 à 256 pour les grandes
# tuiles et les propriétés de fichier.
TAILLES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
ICI = os.path.dirname(os.path.abspath(__file__))
# Un fichier par usage. Ces noms sont ceux que cherchent szh-common.ps1, open-revue.ps1 et
# open-livre.ps1 : les changer ici sans les changer là-bas fait retomber les raccourcis sur
# VSCodium.
VARIANTES = (('szh-revue.ico', CAPUCINE, ETAGERE),
             ('szh-zeitschrift.ico', MOUTARDE, ETAGERE),
             ('szh-maj.ico', BLEUACIER, FLECHE),
             ('szh-livre.ico', SARCELLE, ETAGERE))


def dans_rectangle(rect, u, v):
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


def dans_triangle(tri, u, v):
    """Le point (u, v) est-il dans ce triangle ? Il l'est s'il tombe du même côté des
    trois arêtes, quel que soit le sens dans lequel les sommets ont été donnés."""
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


def ecrire(nom, accent, dessin):
    """Assemble le .ico multi-tailles `nom`, dans ce dossier, avec ce dessin et cette
    couleur de tablette."""
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
