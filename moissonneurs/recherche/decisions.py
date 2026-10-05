"""Décisions de la rédaction (FORMAT-PROPOSITIONS.md, « Les décisions »), lues seulement : une `cle` décidée n'est
jamais reproposée, et les motifs de refus restent en base pour mesurer la précision du filtre. La lecture est celle
de commun.py."""
from commun import (DECISIONS, MOTIFS, appliquer_decisions as appliquer, bilan_decisions as bilan,  # noqa: F401
                    empreinte_cle, lire_decisions as lire)
