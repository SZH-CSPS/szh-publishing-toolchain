"""Notes d'import de l'export FNS : `_Moissons/recherche/_partage/imports-fns/<AAAA-MM-JJ>-<poste>__<compte>.json`.

Un fichier par import et par poste, écrit par ce seul poste (docs/FORMAT-MOISSONS.md). Le cockpit lit le plus récent.
"""
import os

import commun
import partage

FORMAT = 'pronto-import-fns/1'
DOSSIER = 'imports-fns'


def dossier(racine):
    return os.path.join(partage.dossier(racine, 'recherche'), DOSSIER)


def derniere(racine):
    """La note la plus récente (par `heure`), ou None. Une note illisible ne compte pas."""
    d = dossier(racine)
    notes = []
    for nom in sorted(os.listdir(d)) if os.path.isdir(d) else []:
        if nom.endswith('.json'):
            n = partage.lire_json(os.path.join(d, nom))
            if isinstance(n, dict) and n.get('format') == FORMAT and isinstance(n.get('fichier'), dict):
                notes.append(n)
    return max(notes, key=lambda n: str(n.get('heure') or ''), default=None)


def plus_ancien(fichier, precedente):
    """Message (fr) si ce fichier semble plus ancien que celui du dernier import, sinon ''. L'indice est la dernière
    clôture d'appel, puis le nombre de lignes : l'export n'est pas daté."""
    if not precedente:
        return ''
    avant = precedente['fichier']
    cle = (fichier.get('max_call_end') or '', fichier.get('lignes') or 0)
    cle_avant = (avant.get('max_call_end') or '', avant.get('lignes') or 0)
    if cle >= cle_avant:
        return ''
    return (f"ce fichier semble plus ancien que celui du dernier import ({precedente.get('date')}, "
            f"{precedente.get('poste')}) : dernière clôture d’appel {cle[0] or '?'} contre {cle_avant[0] or '?'}, "
            f"{cle[1]} lignes contre {cle_avant[1]}")


def ecrire(racine, poste, compte, heure, fichier, nouvelles, lot, precedente=None):
    """Écrit la note de cet import ; rend son chemin. `heure` : ISO UTC. `appels_nouveaux` : les mois de clôture
    d'appel absents du fichier précédent, pour mesurer le délai réel entre clôture et publication."""
    vus = set(((precedente or {}).get('fichier') or {}).get('appels') or {})
    note = {'format': FORMAT, 'date': heure[:10], 'heure': heure, 'poste': poste, 'compte': compte,
            'fichier': fichier, 'appels_nouveaux': sorted(set(fichier.get('appels') or {}) - vus) if precedente else [],
            'nouvelles': nouvelles, 'lot': lot}
    chemin = os.path.join(dossier(racine), f'{heure[:10]}-{partage.cle_poste(poste, compte)}.json')
    commun.ecrire_json_atomique(chemin, note, indent=1)
    return chemin
