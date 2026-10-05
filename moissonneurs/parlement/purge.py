"""Purge à six mois des lots de propositions et des décisions de ce moissonneur.

Règles (FORMAT-PROPOSITIONS.md, « La purge ») : l'âge d'un lot se lit sur son nom AAAA-MM-JJ-<n> ou, à défaut, sur `recolte` dans son
contenu, jamais sur le mtime (OneDrive le réécrit) ; l'âge d'une décision se lit sur la ligne `Date:` du fichier. Une
date absente ou illisible ne fait jamais effacer. Une décision ne se purge que si la base l'a déjà reportée. On
n'efface que des fichiers, sous le dossier configuré (chemin résolu vérifié avant chaque suppression), jamais un
lien symbolique, jamais un dossier, et seulement les décisions dont la `cle` commence par `parlement:`.
"""
import commun
from commun import MOIS, RE_LOT, _date_du_lot, _date_iso, _supprimer, moins_mois  # noqa: F401  (lus ailleurs)

PREFIXE_CLE = 'parlement:'


def purger(config, base, aujourdhui=None, mois=MOIS):
    """Rend {'lots': [noms], 'decisions': [empreintes], 'echecs': [(chemin, raison)]}. Ne lève pas pour un fichier récalcitrant."""
    return commun.purger(config['sortie'].get('propositions'), config['sortie'].get('decisions'), PREFIXE_CLE, base.c,
                         aujourdhui=aujourdhui, mois=mois)
