"""Lecture seule des fiches Kirby : la bibliothèque, pour le dédoublonnage, et les décisions. Une fiche vit dans
<bibliothèque>/forschung/<slug>/recherche.<lang>.txt ; seul le cockpit en écrit."""
import os
import re

SEPARATEUR = '----'
DOSSIER_TYPE = 'forschung'
TEMPLATE = 'recherche'


def lire_txt(texte):
    """Parseur minimal : {cle-minuscule: valeur}, title et uuid compris."""
    champs = {}
    for morceau in texte.replace('\r\n', '\n').rstrip('\n').split('\n\n' + SEPARATEUR + '\n\n'):
        m = re.match(r'^([A-Za-z0-9_]+):[ \t]?(.*)$', morceau.split('\n', 1)[0])
        if not m:
            continue
        reste = morceau.split('\n', 1)[1] if '\n' in morceau else None
        if reste is None:
            valeur = m.group(2)
        elif m.group(2).strip() == '':
            valeur = reste[1:] if reste.startswith('\n') else reste
        else:
            valeur = m.group(2) + '\n' + reste
        champs[m.group(1).lower()] = '\n'.join(
            SEPARATEUR if l == '\\' + SEPARATEUR else l for l in valeur.split('\n'))
    return champs


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
