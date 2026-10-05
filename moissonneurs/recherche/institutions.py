"""Reconnaître une institution parmi les partenaires « personne, institution » (PHBern, PH FHNW) : un morceau qu'aucun
mot de MOTS ne reconnaît est retiré. La liste est versionnée : un mot ajouté ou retiré change VERSION."""
import re
import unicodedata

VERSION = 1

# (nature, mot) : 'fin' = le mot termine un mot de la valeur (composés allemands : Mosaikschule, Volksschulamt) ;
# 'debut' = il le commence (Universität, Universitäts-) ; 'mot' = un mot entier ; 'sigle' = un sigle entier, casse comprise.
MOTS = (
    ('fin', 'hochschule'), ('fin', 'schule'), ('fin', 'schulen'), ('fin', 'amt'), ('fin', 'akademie'),
    ('fin', 'institut'), ('fin', 'zentrum'), ('fin', 'stiftung'), ('fin', 'verein'), ('fin', 'departement'),
    ('debut', 'universit'), ('debut', 'hochschul'), ('debut', 'fachhochschul'), ('debut', 'institut'),
    ('debut', 'zentrum'), ('debut', 'stiftung'), ('debut', 'verein'), ('debut', 'kanton'), ('debut', 'departement'),
    ('debut', 'akadem'), ('debut', 'academ'),
    ('mot', 'haute ecole'), ('mot', 'ecole'), ('mot', 'amt'), ('mot', 'canton'), ('mot', 'centre'), ('mot', 'center'),
    ('mot', 'fondation'), ('mot', 'association'), ('mot', 'office'), ('mot', 'college'), ('mot', 'school'),
    ('mot', 'service'), ('mot', 'bundesamt'), ('mot', 'direction'),
    ('sigle', 'PH'), ('sigle', 'HEP'), ('sigle', 'HfH'), ('sigle', 'PHBern'), ('sigle', 'PHSG'), ('sigle', 'PHZH'),
    ('sigle', 'PHLU'), ('sigle', 'FHNW'), ('sigle', 'ZHAW'), ('sigle', 'ETH'), ('sigle', 'EPFL'), ('sigle', 'UZH'),
    ('sigle', 'EHB'), ('sigle', 'SUPSI'), ('sigle', 'BFH'), ('sigle', 'HSLU'), ('sigle', 'EDK'), ('sigle', 'CDIP'),
    ('sigle', 'SBFI'), ('sigle', 'BAG'), ('sigle', 'BFS'),
)


def _plat(texte):
    s = unicodedata.normalize('NFD', str(texte or '').lower())
    return ''.join(c for c in s if not unicodedata.combining(c))


def _motifs():
    motifs = []
    for nature, mot in MOTS:
        if nature == 'sigle':
            motifs.append(re.compile(r'(?<![\w-])' + re.escape(mot) + r'(?![\w])'))
            continue
        m = re.escape(_plat(mot)).replace(r'\ ', r'\s+')
        if nature == 'fin':
            motifs.append(re.compile(m + r'(?![a-z])'))
        elif nature == 'debut':
            motifs.append(re.compile(r'(?<![a-z])' + m))
        else:
            motifs.append(re.compile(r'(?<![a-z])' + m + r'(?![a-z])'))
    return [(n == 'sigle', r) for (n, _), r in zip(MOTS, motifs)]


_MOTIFS = _motifs()


def est_institution(texte):
    """Vrai si un mot de MOTS reconnaît `texte` comme une institution."""
    texte = str(texte or '').strip()
    if not texte:
        return False
    plat = _plat(texte)
    return any(r.search(texte if sigle else plat) for sigle, r in _MOTIFS)


def depuis_couples(morceaux):
    """(retenues, retirées) depuis des morceaux « personne, institution » : la partie après la dernière virgule, ou
    le morceau entier sans virgule, gardée si elle est reconnue. Les retirées ne sortent jamais du moissonneur."""
    retenues, retirees = [], []
    for morceau in morceaux:
        morceau = ' '.join(str(morceau or '').split())
        if not morceau:
            continue
        candidat = morceau.rsplit(',', 1)[1].strip() if ',' in morceau else morceau
        if est_institution(candidat):
            if candidat not in retenues:
                retenues.append(candidat)
        elif candidat:
            retirees.append(candidat)
    return retenues, retirees


def nettoyer_liste(valeur, ecole):
    """(valeur gardée, retirées) pour une liste « École, A, B » déjà en base : les partenaires qui suivent l'école,
    séparés par « , », passent par est_institution. Une valeur qui ne commence pas par l'école reste telle quelle."""
    valeur = str(valeur or '').strip()
    if not valeur.startswith(ecole):
        return valeur, []
    reste = valeur[len(ecole):].lstrip(' ,')
    gardes, retirees = [], []
    for morceau in (m.strip() for m in reste.split(', ') if m.strip()):
        (gardes if est_institution(morceau) else retirees).append(morceau)
    return ', '.join([ecole] + gardes), retirees
