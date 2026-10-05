"""Purge à six mois des lots de propositions et des décisions de ce moissonneur.

Règles (FORMAT-PROPOSITIONS.md, « La purge ») : l'âge d'un lot se lit sur son nom AAAA-MM-JJ-<n> ou, à défaut, sur `recolte` dans son
contenu, jamais sur le mtime (OneDrive le réécrit) ; l'âge d'une décision se lit sur la ligne `Date:` du fichier. Une
date absente ou illisible ne fait jamais effacer. Une décision ne se purge que si la base l'a déjà reportée. On
n'efface que des fichiers, sous le dossier configuré (chemin résolu vérifié avant chaque suppression), jamais un
lien symbolique, jamais un dossier, et seulement les décisions dont la `cle` commence par `parlement:`.
"""
import datetime
import json
import os
import re

from . import kirby
from .decisions import empreinte_cle

MOIS = 6
RE_LOT = re.compile(r'^(\d{4}-\d{2}-\d{2})-\d+\.jsonl$')
PREFIXE_CLE = 'parlement:'


def moins_mois(jour, n):
    """`jour` (date) reculé de n mois civils, jour ramené à la fin du mois si besoin."""
    m = jour.month - 1 - n
    annee, mois = jour.year + m // 12, m % 12 + 1
    for j in (jour.day, 30, 29, 28):
        try:
            return datetime.date(annee, mois, j)
        except ValueError:
            continue
    return datetime.date(annee, mois, 28)


def _date_iso(texte):
    """date | None pour 'AAAA-MM-JJ' (heure éventuelle ignorée)."""
    m = re.match(r'^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$', str(texte or '').strip())
    if not m:
        return None
    try:
        return datetime.date.fromisoformat(m.group(1))
    except ValueError:
        return None


def _sous(dossier_reel, chemin):
    """Vrai si le chemin résolu de `chemin` est un fichier directement ou indirectement sous `dossier_reel`."""
    reel = os.path.realpath(chemin)
    return reel.startswith(dossier_reel + os.sep) and os.path.isfile(reel)


def _date_du_lot(chemin, nom):
    m = RE_LOT.match(nom)
    if m:
        d = _date_iso(m.group(1))
        if d:
            return d
    try:
        with open(chemin, encoding='utf-8') as f:
            for ligne in f:
                if ligne.strip():
                    return _date_iso(json.loads(ligne).get('recolte'))
    except (OSError, ValueError, AttributeError, UnicodeDecodeError):
        pass
    return None


def _supprimer(dossier_reel, chemin, echecs):
    if os.path.islink(chemin) or not _sous(dossier_reel, chemin):
        return False
    try:
        os.remove(chemin)
        return True
    except OSError as e:
        echecs.append((chemin, f'{type(e).__name__}: {e}'))
        return False


def purger(config, base, aujourdhui=None, mois=MOIS):
    """Rend {'lots': [noms], 'decisions': [empreintes], 'echecs': [(chemin, raison)]}. Ne lève pas pour un fichier récalcitrant."""
    jour = _date_iso(aujourdhui) if aujourdhui else datetime.date.today()
    limite = moins_mois(jour, mois)
    echecs, lots, decs = [], [], []

    dossier = config['sortie'].get('propositions')
    if dossier and os.path.isdir(dossier):
        reel = os.path.realpath(dossier)
        for nom in sorted(os.listdir(dossier)):
            chemin = os.path.join(dossier, nom)
            if not nom.endswith('.jsonl') or os.path.islink(chemin) or not os.path.isfile(chemin):
                continue
            d = _date_du_lot(chemin, nom)
            if d is not None and d < limite and os.path.dirname(os.path.realpath(chemin)) == reel:
                if _supprimer(reel, chemin, echecs):
                    lots.append(nom)

    dossier = config['sortie'].get('decisions')
    if dossier and os.path.isdir(dossier):
        reel = os.path.realpath(dossier)
        for racine, _, noms in os.walk(dossier, followlinks=False):
            for nom in sorted(noms):
                chemin = os.path.join(racine, nom)
                if not nom.endswith('.txt') or os.path.islink(chemin):
                    continue
                try:
                    with open(chemin, encoding='utf-8-sig') as f:
                        c = kirby.lire_txt(f.read())
                except (OSError, UnicodeDecodeError):
                    continue
                cle = (c.get('cle') or '').strip()
                d = _date_iso(c.get('date')) if re.match(r'^\d{4}-\d{2}-\d{2}$', (c.get('date') or '').strip()) else None
                if not cle.startswith(PREFIXE_CLE) or d is None or d >= limite:
                    continue
                if not base.c.execute('SELECT 1 FROM decisions WHERE cle=? AND purgee=0', (cle,)).fetchone():
                    continue              # pas encore reportée en base : jamais effacée
                if _supprimer(reel, chemin, echecs):
                    base.c.execute('UPDATE decisions SET purgee=1 WHERE cle=?', (cle,))
                    decs.append(empreinte_cle(cle))
        base.commit()
    return {'lots': lots, 'decisions': decs, 'echecs': echecs}
