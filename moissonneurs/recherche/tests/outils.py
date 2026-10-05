"""Outils communs aux tests : configuration jetable, bibliothèque factice, lecture d'un lot. Hors réseau."""
import json
import os
import sys
import types

CONFIG_FILTRE = {
    'institutions_toujours': ['Interkantonale Hochschule für Heilpädagogik', 'HfH'],
    'mots': ['wohlbefinden', 'handicap', 'autis', 'sonderpädagog'],
    'mots_titre': ['inklusi', 'inclusi', 'wellbeing'],
}


def config(tmp, **autres):
    c = {
        '_racine': tmp,
        'base': os.path.join(tmp, 'donnees', 'base.sqlite'),
        'cache': os.path.join(tmp, 'donnees', 'cache'),
        'propositions': os.path.join(tmp, 'sortie', 'propositions', 'recherche'),
        'decisions': os.path.join(tmp, 'decisions'),
        'bibliotheque': os.path.join(tmp, 'bibliotheque'),
        'langue_par_defaut': 'de',
        'delai': 0,
        'budget': 100,
        'filtre': CONFIG_FILTRE,
        'sources': {'faux': {'actif': True}},
    }
    c.update(autres)
    return c


def ecrire_fiche(racine, slug, langue, champs):
    """Une fiche « recherche » écrite à la main, au format Kirby : la bibliothèque factice des tests."""
    dossier = os.path.join(racine, 'forschung', slug)
    os.makedirs(dossier, exist_ok=True)
    parties = [f'{cle[0].upper() + cle[1:]}: {valeur}' for cle, valeur in champs.items()]
    with open(os.path.join(dossier, f'recherche.{langue}.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n\n----\n\n'.join(parties) + '\n')


def lots(dossier):
    return sorted(n for n in os.listdir(dossier) if n.endswith('.jsonl')) if os.path.isdir(dossier) else []


def lire_lot(chemin):
    with open(chemin, encoding='utf-8', newline='') as f:
        brut = f.read()
    return brut, [json.loads(l) for l in brut.split('\n') if l.strip()]


def ecrire_decision(dossier, cle, decision='refuse', motif='hors-sujet', date='2026-10-02', nom=None):
    import hashlib
    os.makedirs(dossier, exist_ok=True)
    nom = nom or hashlib.sha256(cle.encode('utf-8')).hexdigest()[:16] + '.txt'
    champs = [f'Cle: {cle}', f'Decision: {decision}']
    if motif:
        champs.append(f'Motif: {motif}')
    if date is not None:
        champs.append(f'Date: {date}')
    chemin = os.path.join(dossier, nom)
    with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n\n----\n\n'.join(champs) + '\n')
    return chemin


def injecter_source(nom, projets_par_appel=None, erreur=None):
    """recherche.sources.<nom> factice : rend, à chaque appel, la liste suivante ; ou lève `erreur`."""
    compteur = {'n': 0}
    projets_par_appel = projets_par_appel or [[]]

    def moissonner(config, reseau, connus):
        if erreur is not None:
            raise erreur
        i = min(compteur['n'], len(projets_par_appel) - 1)
        compteur['n'] += 1
        yield from projets_par_appel[i]

    module = types.ModuleType('recherche.sources.' + nom)
    module.moissonner = moissonner
    sys.modules['recherche.sources.' + nom] = module
    return module
