"""Lecture seule des fichiers .txt Kirby de Pronto (docs/FORMAT-DOCUMENTATION-KIRBY.md).

Sert au jeu de référence, au dédoublonnage et aux décisions. Ce moissonneur n'écrit jamais de fiche : seul le
cockpit de Pronto le fait (`lib/kirby-contenu.js`), après acceptation d'une proposition.
"""
import os
import re

from commun import lire_txt

DOSSIER_TYPE = 'vorstoesse'
TEMPLATE = 'intervention'


def fiches_existantes(racine_fiches):
    """[(slug, langue, champs)] des fiches `intervention` sous <racine_fiches>/vorstoesse/. Lecture seule."""
    dossier = os.path.join(racine_fiches, DOSSIER_TYPE)
    sortie = []
    if not os.path.isdir(dossier):
        return sortie
    for slug in sorted(os.listdir(dossier)):
        chemin = os.path.join(dossier, slug)
        if not os.path.isdir(chemin):
            continue
        for nom in sorted(os.listdir(chemin)):
            m = re.match(r'^' + TEMPLATE + r'\.([a-z]{2})\.txt$', nom)
            if m:
                with open(os.path.join(chemin, nom), encoding='utf-8-sig') as f:
                    sortie.append((slug, m.group(1), lire_txt(f.read())))
    return sortie
