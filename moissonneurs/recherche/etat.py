"""État de la passe mensuelle : une base SQLite en mémoire, remplie depuis l'état partagé (partage.py) et vidée en
différentiel. Le code du moissonneur y tourne tel quel ; aucune base n'est écrite sur le dossier partagé."""
import partage

from . import db

NOM = 'recherche'
# Statuts qui l'emportent sur un simple « vu » quand deux postes ont appris la même chose.
STATUTS_FORTS = ('propose', 'doublon', 'existant', 'ignore', 'exporte')
# Tables publiées, avec leur clé et leur règle de fusion. Un projet se reconnaît à (source, source_id) : deux postes
# peuvent donner le même `id` à deux projets différents. `migrations` ne vaut que pour une base locale ancienne.
SCHEMA = {
    'projets': {'cle': ('source', 'source_id'), 'rang': {'champ': 'statut', 'valeurs': {s: 1 for s in STATUTS_FORTS}}},
    'decisions': {'cle': ('cle',), 'rang': {'champ': 'purgee', 'valeurs': {'1': 2}, 'defaut': 1}, 'rang_retrait': 1},
    'sources': {'cle': ('source',)},
    'urls_refusees': {'cle': ('url',)},
}
TABLES = {t: r['cle'] for t, r in SCHEMA.items()}
# Colonnes qui bougent sans rien apprendre à la passe suivante.
IGNOREES = {'derniere_vue'}

EtatAbsent = partage.EtatAbsent


def base_en_memoire():
    """Une base vide au schéma de db.py, en mémoire."""
    return db.connecter(':memory:')


def _inserer(con, table, ligne):
    colonnes = ', '.join(ligne)
    marques = ', '.join('?' for _ in ligne)
    con.execute(f'INSERT OR REPLACE INTO {table} ({colonnes}) VALUES ({marques})', list(ligne.values()))


def remplir(con, tables):
    """Insère {table: [lignes]} dans `con`. Les projets gardent leur ordre d'`id` ; un `id` déjà pris par un autre
    projet (deux postes en même temps) en reçoit un neuf. Une colonne ignorée qui manque reprend `premiere_vue`."""
    for table in TABLES:
        lignes = [dict(l) for l in tables.get(table, [])]
        if table == 'projets':
            lignes.sort(key=lambda l: (l.get('id') is None, l.get('id') or 0, l.get('premiere_vue', ''),
                                       l.get('source', ''), l.get('source_id', '')))
        for ligne in lignes:
            if table == 'projets':
                ligne.setdefault('derniere_vue', ligne.get('premiere_vue', ''))
                pris = ligne.get('id') is not None and con.execute(
                    'SELECT 1 FROM projets WHERE id = ? AND NOT (source = ? AND source_id = ?)',
                    (ligne['id'], ligne.get('source'), ligne.get('source_id'))).fetchone()
                if pris:
                    ligne.pop('id')
            _inserer(con, table, ligne)
    con.commit()
    return con


def charger_etat(racine):
    """Base en mémoire remplie depuis l'état partagé de `racine`. Lève EtatAbsent."""
    return remplir(base_en_memoire(), partage.charger_etat(racine, NOM, SCHEMA))


def publier_journal(racine, poste, delta):
    """Ajoute `delta` (voir differentiel) au journal de `poste` dans l'état partagé."""
    partage.publier_journal(racine, NOM, poste, delta, SCHEMA)


def _cle(table, ligne):
    cle = tuple(ligne[c] for c in TABLES[table])
    return cle[0] if len(cle) == 1 else cle


def instantane(con):
    """{table: {clé: ligne sans les colonnes ignorées}}."""
    sortie = {}
    for table in TABLES:
        lignes = {}
        for r in con.execute(f'SELECT * FROM {table}'):
            ligne = {k: r[k] for k in r.keys() if k not in IGNOREES}
            lignes[_cle(table, ligne)] = ligne
        sortie[table] = lignes
    return sortie


def differentiel(con, avant):
    """{table: [lignes nouvelles ou changées]} plus {'retirees': {table: [clés]}} ; les tables sans changement sont
    omises. Vide si la passe n'a rien appris."""
    apres = instantane(con)
    delta, retirees = {}, {}
    for table in TABLES:
        changees = [l for k, l in apres[table].items() if avant.get(table, {}).get(k) != l]
        parties = [k for k in avant.get(table, {}) if k not in apres[table]]
        if changees:
            delta[table] = changees
        if parties:
            retirees[table] = parties
    if retirees:
        delta['retirees'] = retirees
    return delta
