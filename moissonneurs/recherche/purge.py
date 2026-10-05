"""Purge à six mois des lots et des décisions de ce moissonneur (FORMAT-PROPOSITIONS.md, « La purge »). L'âge se lit
sur le nom du lot et sur la ligne `Date:`, jamais sur la date du fichier ; on n'efface qu'un fichier régulier du dossier."""
import commun
from commun import MOIS, RE_LOT, _supprimer, moins_mois  # noqa: F401  (lus ailleurs)

PREFIXE_CLE = 'recherche:'


def purger(config, con, aujourdhui=None, mois=MOIS, a_blanc=False):
    """Rend {'lots': [noms], 'decisions': [empreintes], 'echecs': [(chemin, raison)]}. Ne lève pas pour un fichier.

    a_blanc : rien n'est effacé ni noté en base ; les listes disent ce qui l'aurait été."""
    return commun.purger(config.get('propositions'), config.get('decisions'), PREFIXE_CLE, con, aujourdhui=aujourdhui,
                         mois=mois, a_blanc=a_blanc)
