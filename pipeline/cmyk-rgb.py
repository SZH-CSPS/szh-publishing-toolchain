#!/usr/bin/env python3
# Convertit en RVB les JPEG livrés en CMJN, que navigateurs et WeasyPrint affichent mal
# (couleurs inversées) ou pas du tout.
#
#   /opt/portraits/bin/python cmyk-rgb.py <fichier.jpg>...
#
# La conversion passe par ImageCms si le fichier a un profil ICC (couleurs justes), sinon
# par `convert('RGB')`. Le fichier est réécrit sous son nom, par un temporaire : la
# référence du .md reste valide. Un JPEG déjà en RVB n'est pas touché.
# L'EXIF est gardé (WeasyPrint lit l'orientation). Le profil ICC source, qui décrit du
# CMJN, ne l'est pas.
#
# Sortie : une ligne JSON par fichier sur stdout, dans l'ordre des arguments :
#   {"chemin": ..., "ok": bool, "converti": bool, "mode": "CMYK"|"RGB"|null,
#    "profil": bool, "exif": bool, "erreur": null | str}
# Code de sortie : 0 sans échec, 1 si au moins un échec, 2 si les arguments manquent.
# Les messages de progression vont sur stderr.
#
# Dépend de Pillow, dans le venv /opt/portraits.

import io
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun

from PIL import Image

# Qualité de réencodage : à 95, la seconde compression ne se voit pas.
QUALITE = 95


def progression(message):
    print(message, file=sys.stderr, flush=True)


def en_rgb(img):
    """Image CMJN -> RVB, par ImageCms si un profil ICC est présent, sinon par Pillow.
    Rend (image, profil_utilise)."""
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
    """Réécrit le JPEG sous son nom, par un temporaire du même dossier, avec l'EXIF
    d'origine."""
    options = {'format': 'JPEG', 'quality': QUALITE, 'optimize': True}
    if exif:
        options['exif'] = exif
    szh_commun.ecrire_atomique(chemin, lambda flux: img.save(flux, **options),
                                prefixe_tmp='~$')


def traiter(chemin):
    """Traite un fichier et rend son résultat ; ne lève pas d'exception."""
    resultat = {'chemin': chemin, 'ok': False, 'converti': False,
                'mode': None, 'profil': False, 'exif': False, 'erreur': None}
    try:
        with Image.open(chemin) as brut:
            resultat['mode'] = brut.mode
            if brut.format != 'JPEG' or brut.mode not in ('CMYK', 'YCCK'):
                resultat['ok'] = True             # rien à faire
                return resultat
            brut.load()
            exif = brut.info.get('exif')
            img, profil = en_rgb(brut)
        ecrire_atomique(img, chemin, exif)
        resultat['profil'] = profil
        resultat['exif'] = bool(exif)
        resultat['converti'] = True
        resultat['ok'] = True
    except Exception as exc:                      # pas de traceback en sortie
        resultat['erreur'] = '%s: %s' % (type(exc).__name__, exc)
        progression('[cmyk] %s : ÉCHEC — %s' % (chemin, resultat['erreur']))
    return resultat


def principal(argv):
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
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
