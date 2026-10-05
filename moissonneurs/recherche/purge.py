"""Purge à six mois des lots et des décisions de ce moissonneur (FORMAT-PROPOSITIONS.md, « La purge »). L'âge se lit
sur le nom du lot et sur la ligne `Date:`, jamais sur la date du fichier ; on n'efface qu'un fichier régulier du dossier."""
import datetime
import os
import re

from . import kirby
from .decisions import empreinte_cle

MOIS = 6
RE_LOT = re.compile(r'^(\d{4}-\d{2}-\d{2})-\d+\.jsonl$')
PREFIXE_CLE = 'recherche:'


def moins_mois(jour, n):
    """`jour` reculé de n mois civils, ramené au dernier jour du mois si besoin."""
    m = jour.month - 1 - n
    annee, mois = jour.year + m // 12, m % 12 + 1
    for j in (jour.day, 30, 29, 28):
        try:
            return datetime.date(annee, mois, j)
        except ValueError:
            continue
    return datetime.date(annee, mois, 28)


def _date(texte):
    """date | None pour une valeur exactement AAAA-MM-JJ."""
    if not re.match(r'^\d{4}-\d{2}-\d{2}$', str(texte or '').strip()):
        return None
    try:
        return datetime.date.fromisoformat(str(texte).strip())
    except ValueError:
        return None


def _dans(dossier_reel, chemin):
    """Vrai si `chemin` est un fichier régulier, pas un lien, dont le chemin réel est sous `dossier_reel`."""
    if os.path.islink(chemin) or not os.path.isfile(chemin):
        return False
    return os.path.realpath(chemin).startswith(dossier_reel + os.sep)


def _supprimer(dossier_reel, chemin, echecs, a_blanc=False):
    if not _dans(dossier_reel, chemin):
        return False
    if a_blanc:
        return True
    try:
        os.remove(chemin)
        return True
    except OSError as e:
        echecs.append((chemin, f'{type(e).__name__}: {e}'))
        return False


def purger(config, con, aujourdhui=None, mois=MOIS, a_blanc=False):
    """Rend {'lots': [noms], 'decisions': [empreintes], 'echecs': [(chemin, raison)]}. Ne lève pas pour un fichier.

    a_blanc : rien n'est effacé ni noté en base ; les listes disent ce qui l'aurait été."""
    jour = _date(aujourdhui) if aujourdhui else datetime.date.today()
    limite = moins_mois(jour, mois)
    echecs, lots, decs = [], [], []

    dossier = config.get('propositions')
    # Le dossier des lots ne doit pas être lui-même un lien : la purge n'efface que dans le dossier configuré.
    if dossier and os.path.isdir(dossier) and not os.path.islink(dossier):
        reel = os.path.realpath(dossier)
        for nom in sorted(os.listdir(dossier)):
            m = RE_LOT.match(nom)
            d = _date(m.group(1)) if m else None
            if d is None or d >= limite:
                continue
            if _supprimer(reel, os.path.join(dossier, nom), echecs, a_blanc):
                lots.append(nom)

    dossier = config.get('decisions')
    if dossier and os.path.isdir(dossier) and not os.path.islink(dossier):
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
                d = _date(c.get('date'))
                if not cle.startswith(PREFIXE_CLE) or d is None or d >= limite:
                    continue
                if not con.execute('SELECT 1 FROM decisions WHERE cle = ? AND purgee = 0', (cle,)).fetchone():
                    continue          # pas encore reportée en base : jamais effacée
                if _supprimer(reel, chemin, echecs, a_blanc):
                    if not a_blanc:
                        con.execute('UPDATE decisions SET purgee = 1 WHERE cle = ?', (cle,))
                    decs.append(empreinte_cle(cle))
        con.commit()
    return {'lots': lots, 'decisions': decs, 'echecs': echecs}
