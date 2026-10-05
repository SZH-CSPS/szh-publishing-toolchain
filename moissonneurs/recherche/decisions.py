"""Décisions de la rédaction (FORMAT-PROPOSITIONS.md, « Les décisions »), lues seulement : une `cle` décidée n'est
jamais reproposée, et les motifs de refus restent en base pour mesurer la précision du filtre."""
import datetime
import hashlib
import os

from . import kirby

DECISIONS = ('accepte', 'refuse')
MOTIFS = ('hors-sujet', 'doublon', 'autre')


def empreinte_cle(cle):
    return hashlib.sha256(cle.encode('utf-8')).hexdigest()[:16]


def lire(dossier):
    """{cle: {'decision', 'motif', 'fiche', 'date'}}. Un fichier illisible, sans `Cle` ou à décision inconnue est
    ignoré ; un motif inconnu se lit `autre`. Les liens symboliques ne sont pas suivis."""
    sortie = {}
    if not dossier or not os.path.isdir(dossier):
        return sortie
    for racine, _, noms in os.walk(dossier):
        for nom in sorted(noms):
            chemin = os.path.join(racine, nom)
            if not nom.endswith('.txt') or os.path.islink(chemin):
                continue
            try:
                with open(chemin, encoding='utf-8-sig') as f:
                    c = kirby.lire_txt(f.read())
            except (OSError, UnicodeDecodeError):
                continue
            cle, decision = (c.get('cle') or '').strip(), (c.get('decision') or '').strip().lower()
            if not cle or '\n' in cle or decision not in DECISIONS:
                continue
            motif = (c.get('motif') or '').strip().lower() if decision == 'refuse' else ''
            if motif and motif not in MOTIFS:
                motif = 'autre'
            sortie[cle] = {'decision': decision, 'motif': motif, 'fiche': (c.get('fiche') or '').strip(),
                           'date': (c.get('date') or '').strip()}
    return sortie


def appliquer(dossier, con):
    """Reporte les décisions lues dans la table `decisions` et rend l'ensemble des `cle` décidées.

    Une décision dont le fichier a été purgé (`purgee = 1`) reste décidée. Une décision dont le fichier a disparu sans
    purge (« Annuler » dans le cockpit) est oubliée : le projet redevient proposable."""
    lues = lire(dossier)
    maintenant = datetime.datetime.now().isoformat(timespec='seconds')
    for cle, d in lues.items():
        con.execute('INSERT OR REPLACE INTO decisions(cle, decision, motif, fiche, date, lue_le, purgee) VALUES (?,?,?,?,?,?,0)',
                    (cle, d['decision'], d['motif'], d['fiche'], d['date'], maintenant))
    for r in con.execute('SELECT cle FROM decisions WHERE purgee = 0').fetchall():
        if r['cle'] not in lues:
            con.execute('DELETE FROM decisions WHERE cle = ?', (r['cle'],))
    con.commit()
    return set(lues) | {r['cle'] for r in con.execute('SELECT cle FROM decisions WHERE purgee = 1')}


def bilan(con):
    """{'accepte': n, 'refuse': n, 'motifs': {motif: n}} : de quoi mesurer la précision du filtre."""
    res = {'accepte': 0, 'refuse': 0, 'motifs': {}}
    for r in con.execute('SELECT decision, motif, COUNT(*) n FROM decisions GROUP BY decision, motif'):
        res[r['decision']] += r['n']
        if r['motif']:
            res['motifs'][r['motif']] = r['n']
    return res
