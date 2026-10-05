"""Sauvegarde compressée de la base : copie cohérente (Connection.backup) + gzip, nom temporaire puis renommage.

`parlement-AAAA-MM-JJTHHMMSS.sqlite.gz` (suffixe -2, -3 si deux la même seconde ; jamais d'écrasement), les trois dernières
gardées ; les anciens noms sans heure restent lus et triés. La reprise depuis la dernière sauvegarde
(base absente au lancement) passe par `restaurer`.
"""
import gzip
import os
import re
import shutil
import sqlite3
import tempfile
import time

PREFIXE = 'parlement-'
# Anciens noms sans heure (`parlement-AAAA-MM-JJ`) et nouveaux horodatés à la seconde, avec suffixe -2, -3 si besoin.
RE_NOM = re.compile(r'^parlement-(\d{4}-\d{2}-\d{2})(?:T(\d{6}))?(?:-(\d+))?\.sqlite\.gz$')
GARDER = 3


def nom_sauvegarde(date=None, suffixe=1):
    """`parlement-AAAA-MM-JJTHHMMSS[-n].sqlite.gz` ; `date` (AAAA-MM-JJ) fixe le jour, l'heure est celle de l'appel."""
    jour = date or time.strftime('%Y-%m-%d')
    fin = f'-{suffixe}' if suffixe > 1 else ''
    return f"{PREFIXE}{jour}T{time.strftime('%H%M%S')}{fin}.sqlite.gz"


def _cle(nom):
    m = RE_NOM.match(nom)
    return (m.group(1), m.group(2) or '', int(m.group(3) or 1))     # sans heure : avant toute heure du même jour


def lister(dossier):
    """Sauvegardes présentes, de la plus récente à la plus ancienne : [chemin]."""
    if not os.path.isdir(dossier):
        return []
    noms = sorted((n for n in os.listdir(dossier) if RE_NOM.match(n)), key=_cle, reverse=True)
    return [os.path.join(dossier, n) for n in noms]


def derniere(dossier):
    s = lister(dossier)
    return s[0] if s else None


def sauvegarder(base, dossier, date=None, garder=GARDER):
    """Écrit la sauvegarde du jour dans `dossier` et applique la rotation. Rend le chemin final.

    `base` : parlement.stockage.Base ouverte. La copie passe par un fichier SQLite temporaire (jamais la base
    en cours de lecture), puis gzip vers un nom `.tmp` renommé seulement une fois complet.
    """
    os.makedirs(dossier, exist_ok=True)
    base.commit()
    n = 1
    while True:        # une sauvegarde existante n'est jamais écrasée : suffixe -2, -3…
        final = os.path.join(dossier, nom_sauvegarde(date, n))
        if not os.path.exists(final):
            break
        n += 1
    tmp_gz = final + '.tmp'
    with tempfile.TemporaryDirectory() as rep:
        copie = os.path.join(rep, 'copie.sqlite')
        dest = sqlite3.connect(copie)
        try:
            base.c.backup(dest)
        finally:
            dest.close()
        try:
            with open(copie, 'rb') as src, gzip.open(tmp_gz, 'wb', compresslevel=6) as out:
                shutil.copyfileobj(src, out)
            os.replace(tmp_gz, final)
        finally:
            if os.path.exists(tmp_gz):
                os.remove(tmp_gz)
    for ancienne in lister(dossier)[garder:]:
        os.remove(ancienne)
    return final


def restaurer(chemin_gz, chemin_base):
    """Décompresse une sauvegarde vers `chemin_base` (nom temporaire puis renommage) après contrôle d'intégrité."""
    os.makedirs(os.path.dirname(chemin_base) or '.', exist_ok=True)
    tmp = chemin_base + '.restauration'
    try:
        with gzip.open(chemin_gz, 'rb') as src, open(tmp, 'wb') as out:
            shutil.copyfileobj(src, out)
        c = sqlite3.connect(tmp)
        try:
            ok = c.execute('PRAGMA integrity_check').fetchone()[0]
        finally:
            c.close()
        if ok != 'ok':
            raise ValueError(f'sauvegarde corrompue ({ok})')
        os.replace(tmp, chemin_base)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    return chemin_base
