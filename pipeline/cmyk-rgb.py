#!/usr/bin/env python3
# cmyk-rgb.py — convertit en RVB les JPEG livrés en CMJN.
#
#   /opt/portraits/bin/python cmyk-rgb.py <fichier.jpg>...
#
# Pourquoi. Un JPEG CMJN vient d'une chaîne d'imprimerie ; ni les navigateurs ni WeasyPrint
# ne savent l'afficher correctement — au mieux les couleurs sont inversées, au pire l'image
# ne se charge pas. Le défaut ne se voit pas au dépôt : il se voit au PDF, trop tard.
#
# Comment. Pillow ouvre l'image, et la conversion passe par ImageCms quand le fichier porte
# un profil ICC : c'est la seule façon d'obtenir des couleurs justes, `convert('RGB')` ne
# faisant qu'une soustraction naïve. Sans profil, ou si littlecms manque, on retombe sur
# `convert('RGB')`, qui reste très préférable à un fichier illisible. Le fichier est réécrit
# sous son propre nom, par un temporaire puis os.replace : la référence du .md reste valide,
# et jamais de fichier à moitié écrit. Un JPEG déjà en RVB n'est pas touché.
#
# Ce qui est conservé, et ce qui ne l'est pas. Le bloc EXIF est réécrit tel quel : WeasyPrint
# honore l'étiquette d'orientation, et la perdre ferait pivoter l'image à la composition —
# une conversion de couleurs ne doit pas tourner une photo. Le profil ICC, lui, n'est pas
# transporté : celui du fichier source décrit un espace CMJN, il ne veut plus rien dire sur
# des données RVB. Les octets d'image, eux, sont réencodés : c'est le prix, et l'alternative
# est un fichier que ni le navigateur ni le PDF n'affichent.
#
# Sortie : une ligne JSON par fichier sur stdout, dans l'ordre des arguments —
#   {"chemin": ..., "ok": bool, "converti": bool, "mode": "CMYK"|"RGB"|null,
#    "profil": bool, "erreur": null | str}
# Code retour : 0 si aucun échec, 1 si au moins un, 2 si l'invocation est malformée.
# Les messages de progression vont sur stderr, stdout restant du JSON pur.
#
# Dépendances : Pillow, du venv /opt/portraits (comme portraits.py).

import io
import json
import os
import sys

from PIL import Image

# Qualité de réencodage. Le JPEG source a déjà été compressé une fois ; 95 rend la seconde
# passe invisible à l'œil, et l'alternative — garder du CMJN — est de ne rien afficher.
QUALITE = 95


def progression(message):
    print(message, file=sys.stderr, flush=True)


def en_rgb(img):
    """Image CMJN -> RVB. Par ImageCms si un profil ICC est embarqué, sinon par la
    conversion naïve de Pillow. Retourne (image, profil_utilise)."""
    profil = img.info.get('icc_profile')
    if profil:
        try:
            from PIL import ImageCms
            source = ImageCms.ImageCmsProfile(io.BytesIO(profil))
            return ImageCms.profileToProfile(
                img, source, ImageCms.createProfile('sRGB'), outputMode='RGB'), True
        except Exception as exc:         # littlecms absent, profil illisible…
            progression('[cmyk] profil ICC inutilisable (%s) : conversion simple' % exc)
    return img.convert('RGB'), False


def ecrire_atomique(img, chemin, exif):
    """Réécrit le JPEG sous son propre nom, par un temporaire du même dossier. L'EXIF
    d'origine est reposé : l'orientation en fait partie, et WeasyPrint la lit."""
    dossier = os.path.dirname(chemin) or '.'
    tmp = os.path.join(dossier, '~$%s.%d.tmp' % (os.path.basename(chemin), os.getpid()))
    options = {'format': 'JPEG', 'quality': QUALITE, 'optimize': True}
    if exif:
        options['exif'] = exif
    try:
        with open(tmp, 'wb') as flux:
            img.save(flux, **options)
        os.replace(tmp, chemin)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def traiter(chemin):
    """Toute la chaîne pour un fichier ; ne lève jamais."""
    resultat = {'chemin': chemin, 'ok': False, 'converti': False,
                'mode': None, 'profil': False, 'exif': False, 'erreur': None}
    try:
        with Image.open(chemin) as brut:
            resultat['mode'] = brut.mode
            if brut.format != 'JPEG' or brut.mode not in ('CMYK', 'YCCK'):
                resultat['ok'] = True             # rien à faire, et ce n'est pas un échec
                return resultat
            brut.load()
            exif = brut.info.get('exif')
            img, profil = en_rgb(brut)
        ecrire_atomique(img, chemin, exif)
        resultat['profil'] = profil
        resultat['exif'] = bool(exif)
        resultat['converti'] = True
        resultat['ok'] = True
    except Exception as exc:                      # jamais de traceback en sortie
        resultat['erreur'] = '%s: %s' % (type(exc).__name__, exc)
        progression('[cmyk] %s : ÉCHEC — %s' % (chemin, resultat['erreur']))
    return resultat


def principal(argv):
    if len(argv) < 2:
        progression('usage : cmyk-rgb.py <fichier.jpg>...')
        return 2
    echecs = 0
    for chemin in argv[1:]:
        resultat = traiter(chemin)
        print(json.dumps(resultat, ensure_ascii=False), flush=True)
        if not resultat['ok']:
            echecs += 1
    return 1 if echecs else 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
