#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# conversion_odt.py — le passage .odt <-> .docx, par LibreOffice sans interface.
#
# Toute la chaîne (lecteur du nettoyeur, écrivain, annotation, import) ne parle que .docx.
# Un .odt est donc converti à la frontière : en .docx à l'entrée, en .odt à la sortie. Un seul
# moteur, et LibreOffice fait ce qu'il fait de mieux (décision de Robin, 29.09.2026 : paquet
# libreoffice-writer-nogui dans l'image WSL, plutôt qu'un lecteur et un écrivain ODT natifs à
# tenir en double). Révisions et commentaires traversent la conversion dans les deux sens.
#
# Utilisable en module (convertir()) et en ligne de commande, pour import-docx.sh :
#   python3 conversion_odt.py <source> <docx|odt> <dossier-sortie>   -> chemin écrit sur stdout
#
# $SZH_SOFFICE désigne un autre exécutable (soffice.exe de Windows pour un test hors WSL).
#
# stdlib seule.

import os
import shutil
import subprocess
import sys
import tempfile

FORMATS = {'docx': 'docx:MS Word 2007 XML', 'odt': 'odt:writer8'}
DELAI_S = 180


class ConversionImpossible(Exception):
    """LibreOffice absent, en échec ou muet : le message est fait pour la rédaction."""


def soffice():
    """Chemin de l'exécutable, ou None."""
    explicite = os.environ.get('SZH_SOFFICE')
    if explicite:
        return explicite if os.path.exists(explicite) else None
    for nom in ('soffice', 'libreoffice'):
        trouve = shutil.which(nom)
        if trouve:
            return trouve
    return None


def disponible():
    return soffice() is not None


def _url_fichier(chemin):
    chemin = os.path.abspath(chemin).replace('\\', '/')
    if not chemin.startswith('/'):
        chemin = '/' + chemin                 # C:/... -> /C:/... (file:///C:/...)
    return 'file://' + chemin


def convertir(source, format_cible, dossier_sortie, nom_sortie=None):
    """Convertit `source` en `format_cible` ('docx' | 'odt') dans `dossier_sortie` et rend
    le chemin écrit. `nom_sortie` (sans extension) remplace le nom de la source. Un profil
    LibreOffice jetable par appel : deux conversions simultanées ne se bloquent pas, et un
    profil corrompu du poste n'y entre jamais."""
    if format_cible not in FORMATS:
        raise ValueError('format inconnu : %r' % (format_cible,))
    exe = soffice()
    if exe is None:
        raise ConversionImpossible(
            "LibreOffice est introuvable dans l'environnement de fabrication : la conversion "
            "vers .%s est impossible. Lancez la mise à jour du poste." % format_cible)
    os.makedirs(dossier_sortie, exist_ok=True)
    base = os.path.splitext(os.path.basename(source))[0]
    profil = tempfile.mkdtemp(prefix='szh-lo-')
    travail = tempfile.mkdtemp(prefix='szh-conv-')
    try:
        # Travail dans un dossier à part : LibreOffice nomme la sortie d'après la source, et
        # écraserait un fichier homonyme du dossier de sortie avant qu'on ait pu choisir.
        commande = [exe, '-env:UserInstallation=' + _url_fichier(profil), '--headless',
                    '--norestore', '--convert-to', FORMATS[format_cible],
                    '--outdir', travail, source]
        try:
            r = subprocess.run(commande, capture_output=True, timeout=DELAI_S)
        except subprocess.TimeoutExpired:
            raise ConversionImpossible(
                'LibreOffice ne répond pas (plus de %d s) sur « %s ».'
                % (DELAI_S, os.path.basename(source)))
        produit = os.path.join(travail, base + '.' + format_cible)
        if r.returncode != 0 or not os.path.isfile(produit) or os.path.getsize(produit) == 0:
            detail = (r.stderr or r.stdout or b'').decode('utf-8', 'replace').strip()
            raise ConversionImpossible(
                "LibreOffice n'a pas su convertir « %s » en .%s%s."
                % (os.path.basename(source), format_cible,
                   (' (%s)' % detail.splitlines()[-1]) if detail else ''))
        cible = os.path.join(dossier_sortie, (nom_sortie or base) + '.' + format_cible)
        shutil.move(produit, cible)
        return cible
    finally:
        shutil.rmtree(profil, ignore_errors=True)
        shutil.rmtree(travail, ignore_errors=True)


def principal(argv):
    if len(argv) != 4 or argv[2] not in FORMATS:
        print('usage : conversion_odt.py <source> <docx|odt> <dossier-sortie>', file=sys.stderr)
        return 2
    try:
        print(convertir(argv[1], argv[2], argv[3]))
    except ConversionImpossible as e:
        print('[conversion] %s' % e, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
