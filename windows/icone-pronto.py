#!/usr/bin/env python3
# icone-pronto.py : fabrique les deux icônes de l'application, à côté de ce script.
#
#     pronto.ico       raccourci « Pronto » du menu Démarrer, fenêtre du lanceur, « Ouvrir
#                      avec » et type .md, raccourcis de VSCodium (posée par patch-icone.ps1)
#     pronto-maj.ico   raccourci « Pronto (Updater) » du menu Démarrer
#
#     python3 windows/icone-pronto.py
#
# La source est le .svg voisin (pronto.svg, pronto-maj.svg) : un .ico retouché à la main
# serait écrasé à la prochaine exécution. Les icônes de produit sont faites par icone.py.
#
# Edge rend le SVG à chaque taille, sur une planche que Pillow découpe : un dessin rendu à
# 16 px est plus net qu'une image de 256 px réduite. Ce script tourne sous Windows, côté
# dépôt seulement ; les postes reçoivent les .ico déjà faits.
#
# Format .ico : DIB 32 bits jusqu'à 48 px, PNG au-delà. Les petites tailles en DIB sont
# lues par tous les logiciels.

import io
import os
import struct
import subprocess
import sys

from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))

# 16 et 20 pour la barre des tâches et les listes, 24 à 48 pour le menu Démarrer et Alt+Tab
# selon la mise à l'échelle, 64 à 256 pour les grandes tuiles et les propriétés de fichier.
TAILLES = (16, 20, 24, 32, 40, 48, 64, 128, 256)

# Le .svg et le .ico qu'il produit. szh-shell.ps1, update.ps1 et patch-icone.ps1 lisent
# ces noms : un changement se fait partout.
VARIANTES = (('pronto.svg', 'pronto.ico'),
             ('pronto-maj.svg', 'pronto-maj.ico'))

EDGE = (r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
        r'C:\Program Files\Microsoft\Edge\Application\msedge.exe')


def edge():
    for chemin in EDGE:
        if os.path.exists(chemin):
            return chemin
    raise SystemExit('Microsoft Edge introuvable : ' + ' ; '.join(EDGE))


def rendre(svg, travail):
    """Rend le SVG à chaque taille sur une page à fond transparent. Rend {taille: Image}."""
    source = open(os.path.join(ICI, svg), encoding='utf-8').read()
    blocs, y = [], 0
    for t in TAILLES:
        # Le conteneur impose la taille de rendu, à la place des width/height du SVG.
        blocs.append('<div style="position:absolute;left:0;top:%dpx;width:%dpx;height:%dpx">'
                     '<svg style="width:100%%;height:100%%" %s</div>'
                     % (y, t, t, source.split('<svg', 1)[1]))
        y += t + 8
    page = os.path.join(travail, 'planche.html')
    with open(page, 'w', encoding='utf-8') as f:
        f.write('<!doctype html><meta charset="utf-8">'
                '<body style="margin:0;background:transparent">'
                '<div style="position:relative;width:256px;height:%dpx">%s</div></body>'
                % (y, ''.join(blocs)))
    png = os.path.join(travail, 'planche.png')
    if os.path.exists(png):
        os.remove(png)
    subprocess.run([edge(), '--headless=new', '--disable-gpu', '--hide-scrollbars',
                    '--force-device-scale-factor=1', '--default-background-color=00000000',
                    '--window-size=256,%d' % y, '--screenshot=' + png,
                    'file:///' + page.replace('\\', '/')],
                   capture_output=True, check=False)
    if not os.path.exists(png):
        raise SystemExit('Edge n\'a rien rendu pour ' + svg)
    planche = Image.open(png).convert('RGBA')
    images, y = {}, 0
    for t in TAILLES:
        images[t] = planche.crop((0, y, t, y + t))
        y += t + 8
    return images


def dib(im):
    """Une entrée .ico au format BMP 32 bits : en-tête, pixels BGRA de bas en haut, puis le
    masque AND, laissé à zéro car l'alpha porte la transparence."""
    larg, haut = im.size
    px = im.load()
    xor = bytearray()
    for ligne in range(haut - 1, -1, -1):
        for col in range(larg):
            r, v, b, a = px[col, ligne]
            xor += bytes((b, v, r, a))
    octets_ligne = ((larg + 31) // 32) * 4      # 1 bit par pixel, lignes alignées sur 4 octets
    entete = struct.pack('<IiiHHIIiiII', 40, larg, haut * 2, 1, 32, 0, len(xor), 0, 0, 0, 0)
    return entete + bytes(xor) + bytes(octets_ligne * haut)


def ecrire(images, nom):
    entrees = []
    for t in TAILLES:
        if t <= 48:
            entrees.append((t, dib(images[t])))
        else:
            tampon = io.BytesIO()
            images[t].save(tampon, format='PNG')
            entrees.append((t, tampon.getvalue()))
    decalage = 6 + 16 * len(entrees)
    entetes, corps = b'', b''
    for taille, donnees in entrees:
        octet = 0 if taille >= 256 else taille        # 0 signifie 256 dans le répertoire
        entetes += struct.pack('<BBBBHHII', octet, octet, 0, 0, 1, 32, len(donnees), decalage)
        corps += donnees
        decalage += len(donnees)
    sortie = os.path.join(ICI, nom)
    with open(sortie, 'wb') as f:
        f.write(struct.pack('<HHH', 0, 1, len(entrees)) + entetes + corps)
    return sortie


def main():
    import tempfile
    for svg, ico in VARIANTES:
        if not os.path.exists(os.path.join(ICI, svg)):
            raise SystemExit('Source introuvable : ' + os.path.join(ICI, svg))
        with tempfile.TemporaryDirectory() as travail:
            sortie = ecrire(rendre(svg, travail), ico)
        print('Écrit : %s (%d octets, %d tailles)'
              % (sortie, os.path.getsize(sortie), len(TAILLES)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
