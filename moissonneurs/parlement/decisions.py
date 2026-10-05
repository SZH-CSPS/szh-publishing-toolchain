"""Décisions de la rédaction sur les propositions (docs/FORMAT-PROPOSITIONS.md, « Les décisions »), lues en lecture seule.

Un fichier par décision, `<empreinte>.txt`, l'empreinte étant les 16 premiers caractères hexadécimaux du SHA-256
de la `cle` ; la `cle` est écrite en clair dans le fichier (`Cle:`). Une `cle` décidée n'est jamais reproposée ;
les motifs de refus restent en base pour mesurer la précision du filtre. Dossier vide ou absent : aucune décision.
"""
import hashlib
import os

from . import kirby
from .stockage import maintenant

DECISIONS = ('accepte', 'refuse')
MOTIFS = ('hors-sujet', 'doublon', 'autre')


def empreinte_cle(cle):
    return hashlib.sha256(cle.encode('utf-8')).hexdigest()[:16]


def lire(dossier):
    """{cle: {'decision', 'motif', 'fiche', 'date'}}. Un fichier illisible ou sans `Cle` est ignoré."""
    sortie = {}
    if not dossier or not os.path.isdir(dossier):
        return sortie
    for racine, _, noms in os.walk(dossier):
        for nom in sorted(noms):
            if not nom.endswith('.txt'):
                continue
            try:
                with open(os.path.join(racine, nom), encoding='utf-8-sig') as f:
                    c = kirby.lire_txt(f.read())
            except (OSError, UnicodeDecodeError):
                continue
            cle, decision = (c.get('cle') or '').strip(), (c.get('decision') or '').strip().lower()
            if not cle or decision not in DECISIONS:
                continue
            motif = (c.get('motif') or '').strip().lower()
            if decision == 'refuse' and motif:
                motif = motif if motif in MOTIFS else 'autre'
            sortie[cle] = {'decision': decision, 'motif': motif if decision == 'refuse' else '',
                           'fiche': (c.get('fiche') or '').strip(), 'date': (c.get('date') or '').strip()}
    return sortie


def appliquer(dossier, base):
    """Enregistre les décisions lues dans `decisions` et rend l'ensemble des `cle` décidées.

    La base se souvient des décisions dont le fichier a été PURGÉ (`purgee = 1`) : elles restent exclues. Une décision
    dont le fichier a disparu sans purge (« Annuler » dans le cockpit) est oubliée : l'objet redevient proposable.
    """
    lues = lire(dossier)
    for cle, d in lues.items():
        base.c.execute('INSERT OR REPLACE INTO decisions(cle, decision, motif, fiche, date, lue_le, purgee) '
                       'VALUES (?,?,?,?,?,?,0)',
                       (cle, d['decision'], d['motif'], d['fiche'], d['date'], maintenant()))
    for r in base.c.execute('SELECT cle FROM decisions WHERE purgee=0').fetchall():
        if r['cle'] not in lues:
            base.c.execute('DELETE FROM decisions WHERE cle=?', (r['cle'],))
    base.commit()
    return set(lues) | {r['cle'] for r in base.c.execute('SELECT cle FROM decisions WHERE purgee=1')}


def bilan(base):
    """{'accepte': n, 'refuse': n, 'motifs': {motif: n}} : de quoi mesurer la précision."""
    res = {'accepte': 0, 'refuse': 0, 'motifs': {}}
    for r in base.c.execute('SELECT decision, motif, COUNT(*) n FROM decisions GROUP BY decision, motif'):
        res[r['decision']] += r['n']
        if r['motif']:
            res['motifs'][r['motif']] = r['n']
    return res
