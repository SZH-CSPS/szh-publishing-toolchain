"""Lecture seule des fiches Kirby : la bibliothèque, pour le dédoublonnage, et les décisions. Une fiche vit dans
<bibliothèque>/forschung/<slug>/recherche.<lang>.txt ; seul le cockpit en écrit."""
import os
import re

from commun import lire_txt

DOSSIER_TYPE = 'forschung'
TEMPLATE = 'recherche'


def fiches_existantes(racine_fiches):
    """[(slug, langue, champs)] des fiches déjà présentes sous <racine_fiches>/forschung/."""
    dossier = os.path.join(racine_fiches, DOSSIER_TYPE)
    sortie = []
    if not os.path.isdir(dossier):
        return sortie
    for slug in sorted(os.listdir(dossier)):
        chemin = os.path.join(dossier, slug)
        if not os.path.isdir(chemin):
            continue
        for nom in os.listdir(chemin):
            m = re.match(r'^' + TEMPLATE + r'\.([a-z]{2})\.txt$', nom)
            if m:
                with open(os.path.join(chemin, nom), encoding='utf-8-sig') as f:
                    sortie.append((slug, m.group(1), lire_txt(f.read())))
    return sortie
