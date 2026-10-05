"""État partagé d'un moissonneur dans `_Moissons/<m>/_partage/` : un socle, un journal par poste, fusionnés à la lecture.

Interface seulement : la fusion et l'écriture ne sont pas encore branchées. D'ici là, une passe sans base locale
s'arrête sur EtatAbsent, et rien du partage n'est écrit.
"""
import os
import re
import unicodedata

SOCLE = 'socle.json'


class EtatAbsent(Exception):
    """L'état partagé n'est pas disponible : rien ne part."""


def dossier(racine, m):
    return os.path.join(racine, '_Moissons', m, '_partage')


def etat_present(racine, m):
    """Vrai si le socle de `m` a été publié depuis le poste de développement."""
    return os.path.isfile(os.path.join(dossier(racine, m), SOCLE))


def charger_etat(racine, m):
    """{table: [lignes]} : le socle plus les journaux de tous les postes, fusionnés. Lève EtatAbsent."""
    raise EtatAbsent("état partagé non branché : passer --base <fichier.sqlite> pour travailler sur une base locale")


def publier_journal(racine, m, poste, delta):
    """Ajoute `delta` ({table: [lignes]}, plus `retirees`) au seul journal de `poste` (`poste__compte`)."""
    raise EtatAbsent('état partagé non branché : le journal ne peut pas être publié')


def normaliser(nom):
    """Minuscules sans accents ; tout ce qui n'est ni lettre, ni chiffre, ni `.` ni `_` devient `-`."""
    nom = unicodedata.normalize('NFKD', str(nom)).encode('ascii', 'ignore').decode().lower().strip()
    return re.sub(r'[^a-z0-9._]+', '-', nom).strip('-') or '-'


def cle_poste(poste, compte):
    """`poste__compte` : le nom des fichiers qu'un seul poste écrit (créneau, compteur, journal)."""
    return f'{normaliser(poste)}__{normaliser(compte)}'
