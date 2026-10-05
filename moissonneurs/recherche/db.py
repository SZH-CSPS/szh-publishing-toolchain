"""Base SQLite du moissonneur : projets, décisions, migrations, et la mémoire des refus 403. Voir LISEZMOI.md."""
import datetime
import os
import re
import sqlite3
import unicodedata

# `propose` : parti dans un lot de propositions. `exporte` ne vient que des bases d'avant les propositions (fiches
# écrites dans sortie/) et passe par migrer_exportes.
STATUTS = ('nouveau', 'hors-sujet', 'termine', 'existant', 'propose', 'exporte', 'ignore', 'doublon')

SCHEMA_PROJETS = """
CREATE TABLE IF NOT EXISTS projets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    source_id TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    langue TEXT NOT NULL DEFAULT '',
    institutions TEXT NOT NULL DEFAULT '',
    debut TEXT NOT NULL DEFAULT '',
    fin TEXT NOT NULL DEFAULT '',
    descriptif TEXT NOT NULL DEFAULT '',
    date_source TEXT NOT NULL DEFAULT '',
    extra TEXT NOT NULL DEFAULT '{}',
    cle TEXT NOT NULL DEFAULT '',
    statut TEXT NOT NULL DEFAULT 'nouveau',
    pertinence TEXT NOT NULL DEFAULT '',
    premiere_vue TEXT NOT NULL,
    derniere_vue TEXT NOT NULL,
    fiche_slug TEXT NOT NULL DEFAULT '',
    fiche_uuid TEXT NOT NULL DEFAULT '',
    fiche_chemin TEXT NOT NULL DEFAULT '',
    cle_proposition TEXT NOT NULL DEFAULT '',
    lot TEXT NOT NULL DEFAULT '',
    UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_projets_cle ON projets(cle);
CREATE INDEX IF NOT EXISTS idx_projets_statut ON projets(statut);
"""

# decisions : les décisions de la rédaction relues dans _Decisions\ ; `purgee` = fichier effacé par la purge, la
# décision vaut toujours. migrations : ce qui a été fait une fois sur la base, avec son bilan.
SCHEMA_AUTRES = """
CREATE INDEX IF NOT EXISTS idx_projets_cle_proposition ON projets(cle_proposition);
CREATE TABLE IF NOT EXISTS decisions (
    cle TEXT PRIMARY KEY,
    decision TEXT NOT NULL,
    motif TEXT NOT NULL DEFAULT '',
    fiche TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL DEFAULT '',
    lue_le TEXT NOT NULL,
    purgee INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS migrations (
    nom TEXT PRIMARY KEY,
    faite_le TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sources (
    source TEXT PRIMARY KEY,
    echecs_403_consecutifs INTEGER NOT NULL DEFAULT 0,
    desactivee_le TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS urls_refusees (
    url TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    echecs_consecutifs INTEGER NOT NULL DEFAULT 0,
    refusee_le TEXT NOT NULL DEFAULT ''
);
"""

# Passes consécutives en 403 qui désactivent une source, ou font refuser une page de détail.
PASSES_403 = 2


def connecter(chemin):
    """Ouvre la base ; une base d'avant les propositions reçoit ses colonnes `cle_proposition` et `lot`."""
    os.makedirs(os.path.dirname(chemin) or '.', exist_ok=True)
    con = sqlite3.connect(chemin)
    con.row_factory = sqlite3.Row
    con.executescript(SCHEMA_PROJETS)
    colonnes = {r[1] for r in con.execute('PRAGMA table_info(projets)')}
    for colonne in ('cle_proposition', 'lot'):
        if colonne not in colonnes:
            con.execute(f"ALTER TABLE projets ADD COLUMN {colonne} TEXT NOT NULL DEFAULT ''")
    con.executescript(SCHEMA_AUTRES)
    return con


def _horodatage():
    return datetime.datetime.now().isoformat(timespec='seconds')


def normaliser_cle(titre):
    """Titre normalisé : minuscules, sans accents ni ponctuation. Sert au rapprochement."""
    s = unicodedata.normalize('NFD', str(titre or '').lower())
    s = ''.join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r'[^a-z0-9]+', ' ', s).strip()
    return s


def normaliser_url(url):
    """URL normalisée pour rapprochement : sans schéma, sans www., sans / final, sans requête."""
    url = str(url or '').strip().lower()
    url = re.sub(r'^[a-z]+://', '', url)
    url = re.sub(r'^www\.', '', url)
    url = url.split('#', 1)[0].split('?', 1)[0]
    return url.rstrip('/')


def similarite_cles(cle_a, cle_b):
    """Coefficient de recouvrement des jetons entre deux cles (0..1). Rend 0 si l'une est vide
    ou trop courte (un seul jeton) pour éviter les faux positifs triviaux."""
    jetons_a = set(cle_a.split())
    jetons_b = set(cle_b.split())
    plus_petit = min(len(jetons_a), len(jetons_b))
    if plus_petit < 2:
        return 0.0
    intersection = jetons_a & jetons_b
    return len(intersection) / plus_petit


def rapprocher_titres(cle_a, cle_b):
    """« sur », « probable » ou None selon la ressemblance de deux cles (titres normalisés)."""
    if not cle_a or not cle_b:
        return None
    if cle_a == cle_b:
        return 'sur'
    if len(cle_a) >= 8 and len(cle_b) >= 8 and (cle_a in cle_b or cle_b in cle_a):
        return 'sur'
    score = similarite_cles(cle_a, cle_b)
    if score >= 0.7:
        return 'sur'
    if score >= 0.4:
        return 'probable'
    return None


def enregistrer(con, projet, statut, pertinence):
    """Insère le projet s'il est nouveau (source, source_id) ; sinon met à jour seulement
    derniere_vue (le statut n'est jamais changé par une ré-moisson). Rend (id, est_nouveau)."""
    maintenant = _horodatage()
    ligne = con.execute(
        'SELECT id FROM projets WHERE source = ? AND source_id = ?',
        (projet.source, projet.source_id)).fetchone()
    if ligne:
        con.execute('UPDATE projets SET derniere_vue = ? WHERE id = ?', (maintenant, ligne['id']))
        return ligne['id'], False

    import json
    cle = normaliser_cle(projet.title)
    curseur = con.execute(
        """INSERT INTO projets
           (source, source_id, url, title, langue, institutions, debut, fin, descriptif,
            date_source, extra, cle, statut, pertinence, premiere_vue, derniere_vue)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (projet.source, projet.source_id, projet.url, projet.title, projet.langue,
         projet.institutions, projet.debut, projet.fin, projet.descriptif, projet.date_source,
         json.dumps(projet.extra, ensure_ascii=False), cle, statut, pertinence or '',
         maintenant, maintenant))
    return curseur.lastrowid, True


def connus(con, source):
    """Les source_id déjà en base pour une source (pour éviter de retélécharger le détail)."""
    lignes = con.execute('SELECT source_id FROM projets WHERE source = ?', (source,)).fetchall()
    return {l['source_id'] for l in lignes}


def connus_prefixe(con, prefixe):
    """Comme connus(), mais pour toutes les sources dont le nom commence par prefixe (ex.
    « site: » pour sources/sites.py, qui utilise un statut par site : 'site:hfh'...)."""
    lignes = con.execute(
        'SELECT source_id FROM projets WHERE source LIKE ?', (prefixe + '%',)).fetchall()
    return {l['source_id'] for l in lignes}


def lister(con, statut=None, source=None):
    requete = 'SELECT * FROM projets WHERE 1=1'
    parametres = []
    if statut:
        requete += ' AND statut = ?'
        parametres.append(statut)
    if source:
        requete += ' AND source = ?'
        parametres.append(source)
    requete += ' ORDER BY debut DESC, id'
    return con.execute(requete, parametres).fetchall()


def par_id(con, id_):
    return con.execute('SELECT * FROM projets WHERE id = ?', (id_,)).fetchone()


def changer_statut(con, id_, statut):
    if statut not in STATUTS:
        raise ValueError(f'statut inconnu : {statut}')
    con.execute('UPDATE projets SET statut = ? WHERE id = ?', (statut, id_))


def marquer_fiche(con, id_, slug, uuid, chemin):
    con.execute(
        'UPDATE projets SET fiche_slug = ?, fiche_uuid = ?, fiche_chemin = ? WHERE id = ?',
        (slug, uuid, chemin, id_))


def chercher_dans_index(index, cle, url):
    """La fiche de la bibliothèque qui semble ce projet : (fiche, 'sur' | 'probable') ou (None, '').

    `index` vient de propositions.index_bibliotheque : lien normalisé d'abord, puis ressemblance des titres."""
    url_norm = normaliser_url(url)
    if url_norm and url_norm in index['url']:
        return index['url'][url_norm], 'sur'
    probable = None
    for cle_fiche, fiche in index['titres']:
        niveau = rapprocher_titres(cle, cle_fiche)
        if niveau == 'sur':
            return fiche, 'sur'
        if niveau == 'probable' and probable is None:
            probable = fiche
    return (probable, 'probable') if probable else (None, '')


def migrer_exportes(con, index):
    """Migration des bases d'avant les propositions : les projets `exporte` (fiches écrites dans sortie/, jamais versées
    dans la bibliothèque) et les `doublon` rattachés à ces fiches repassent `nouveau` s'ils sont absents de la
    bibliothèque, `existant` sinon ; la trace de la fiche locale est effacée. Rend {'nouveau': n, 'existant': n}.

    Rejouable : les projets migrés n'ont plus de `fiche_chemin`. Le bilan s'inscrit dans `migrations`."""
    bilan = {'nouveau': 0, 'existant': 0}
    lignes = con.execute("SELECT * FROM projets WHERE statut IN ('exporte', 'doublon') AND fiche_chemin != ''").fetchall()
    for ligne in lignes:
        _, niveau = chercher_dans_index(index, ligne['cle'], ligne['url'])
        statut = 'existant' if niveau == 'sur' else 'nouveau'
        con.execute("UPDATE projets SET statut = ?, fiche_slug = '', fiche_uuid = '', fiche_chemin = '' WHERE id = ?",
                    (statut, ligne['id']))
        bilan[statut] += 1
    if lignes or not con.execute("SELECT 1 FROM migrations WHERE nom = 'exportes-vers-nouveau'").fetchone():
        con.execute('INSERT OR REPLACE INTO migrations(nom, faite_le, detail) VALUES (?, ?, ?)',
                    ('exportes-vers-nouveau', _horodatage(), f"nouveau={bilan['nouveau']} existant={bilan['existant']}"))
    con.commit()
    return bilan


def marquer_proposition(con, id_, statut, cle_proposition, lot=''):
    """Statut et cle de proposition d'un projet ; la cle, une fois posée, ne change plus."""
    if statut not in STATUTS:
        raise ValueError(f'statut inconnu : {statut}')
    con.execute("UPDATE projets SET statut = ?, cle_proposition = CASE WHEN cle_proposition = '' THEN ? ELSE cle_proposition END, "
                "lot = CASE WHEN ? != '' THEN ? ELSE lot END WHERE id = ?", (statut, cle_proposition, lot, lot, id_))


# ---- Mémoire des refus 403 d'une passe à l'autre ---------------------------------------------------------------

def sources_desactivees(con):
    """{source: date de désactivation}."""
    return {r['source']: r['desactivee_le'] for r in con.execute("SELECT * FROM sources WHERE desactivee_le != ''")}


def noter_source(con, source, refus_403, jour):
    """Après une passe où `source` a été tentée : un 403 compte une passe de plus, sinon le compte revient à 0. Rend
    vrai si la source vient d'être désactivée."""
    ligne = con.execute('SELECT * FROM sources WHERE source = ?', (source,)).fetchone()
    avant = ligne['echecs_403_consecutifs'] if ligne else 0
    if not refus_403:
        if avant:
            con.execute('UPDATE sources SET echecs_403_consecutifs = 0 WHERE source = ?', (source,))
        return False
    n = avant + 1
    desactivee = jour if n >= PASSES_403 else ''
    con.execute('INSERT OR REPLACE INTO sources(source, echecs_403_consecutifs, desactivee_le) VALUES (?, ?, ?)',
                (source, n, desactivee))
    return bool(desactivee)


def urls_refusees(con):
    """Les pages de détail refusées deux passes de suite : on ne les demande plus."""
    return {r['url'] for r in con.execute("SELECT url FROM urls_refusees WHERE refusee_le != ''")}


def noter_urls(con, source, refusees, reussies, jour):
    """Pages de détail refusées (403) ou lues dans la passe : compte des passes consécutives en 403."""
    for url in dict.fromkeys(refusees):
        ligne = con.execute('SELECT echecs_consecutifs FROM urls_refusees WHERE url = ?', (url,)).fetchone()
        n = (ligne['echecs_consecutifs'] if ligne else 0) + 1
        con.execute('INSERT OR REPLACE INTO urls_refusees(url, source, echecs_consecutifs, refusee_le) VALUES (?, ?, ?, ?)',
                    (url, source, n, jour if n >= PASSES_403 else ''))
    for url in reussies:
        con.execute('DELETE FROM urls_refusees WHERE url = ?', (url,))


def reactiver(con, cible):
    """Réactive une source désactivée, ou une page refusée (une adresse http). Rend vrai si quelque chose a changé."""
    if cible.startswith(('http://', 'https://')):
        n = con.execute('DELETE FROM urls_refusees WHERE url = ?', (cible,)).rowcount
    else:
        n = con.execute('DELETE FROM sources WHERE source = ?', (cible,)).rowcount
    return bool(n)
