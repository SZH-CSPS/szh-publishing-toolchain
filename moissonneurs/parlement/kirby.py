"""Lecture seule des fichiers .txt Kirby de Pronto (docs/FORMAT-DOCUMENTATION-KIRBY.md).

Sert au jeu de référence, au dédoublonnage et aux décisions. Ce moissonneur n'écrit jamais de fiche : seul le
cockpit de Pronto le fait (`lib/kirby-contenu.js`), après acceptation d'une proposition.
"""
import os
import re

SEPARATEUR = '----'
DOSSIER_TYPE = 'vorstoesse'
TEMPLATE = 'intervention'


def lire_txt(texte):
    """{cle-minuscule: valeur}, title et uuid compris."""
    champs = {}
    for morceau in texte.replace('\r\n', '\n').rstrip('\n').split('\n\n' + SEPARATEUR + '\n\n'):
        if not morceau.strip():
            continue
        premiere, _, reste = morceau.partition('\n')
        m = re.match(r'^([A-Za-z0-9_]+):[ \t]?(.*)$', premiere)
        if not m:
            continue
        if '\n' not in morceau:
            valeur = m.group(2)
        elif m.group(2).strip() == '':
            valeur = reste[1:] if reste.startswith('\n') else reste
        else:
            valeur = m.group(2) + '\n' + reste
        champs[m.group(1).lower()] = '\n'.join(SEPARATEUR if l == '\\' + SEPARATEUR else l for l in valeur.split('\n'))
    return champs


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
