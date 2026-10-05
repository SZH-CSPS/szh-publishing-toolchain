"""Décisions de la rédaction sur les propositions (docs/FORMAT-PROPOSITIONS.md, « Les décisions »), lues en lecture seule.

Un fichier par décision, `<empreinte>.txt` ; la `cle` y est écrite en clair (`Cle:`). La lecture est celle de
commun.py ; ce module la branche sur la base du parlement.
"""
import commun
from commun import DECISIONS, MOTIFS, empreinte_cle, lire_decisions as lire  # noqa: F401  (lus par les tests)


def appliquer(dossier, base):
    """Enregistre les décisions lues dans la table `decisions` de `base` (stockage.Base) ; rend les `cle` décidées."""
    return commun.appliquer_decisions(dossier, base.c)


def bilan(base):
    return commun.bilan_decisions(base.c)
