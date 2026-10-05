"""État de la passe mensuelle : une base SQLite en mémoire, remplie depuis l'état partagé (partage.py) et vidée en
différentiel. Le code du moissonneur y tourne tel quel ; aucune base n'est écrite sur le dossier partagé."""
import partage

from . import db

NOM = 'recherche'
# Tables publiées, avec leur clé. `migrations` n'en est pas : elle ne vaut que pour une base locale ancienne.
TABLES = {'projets': 'id', 'decisions': 'cle', 'sources': 'source', 'urls_refusees': 'url'}
# Colonnes qui bougent sans rien apprendre à la passe suivante.
IGNOREES = {'derniere_vue'}

EtatAbsent = partage.EtatAbsent


def base_en_memoire():
    """Une base vide au schéma de db.py, en mémoire."""
    return db.connecter(':memory:')


def remplir(con, tables):
    """Insère {table: [lignes]} dans `con` ; une colonne ignorée qui manque reprend la valeur de `premiere_vue`."""
    for table in TABLES:
        for ligne in tables.get(table, []):
            ligne = dict(ligne)
            if table == 'projets':
                ligne.setdefault('derniere_vue', ligne.get('premiere_vue', ''))
            colonnes = ', '.join(ligne)
            marques = ', '.join('?' for _ in ligne)
            con.execute(f'INSERT OR REPLACE INTO {table} ({colonnes}) VALUES ({marques})', list(ligne.values()))
    con.commit()
    return con


def charger_etat(racine):
    """Base en mémoire remplie depuis l'état partagé de `racine`. Lève EtatAbsent."""
    return remplir(base_en_memoire(), partage.charger_etat(racine, NOM))


def publier_journal(racine, poste, delta):
    """Ajoute `delta` (voir differentiel) au journal de `poste` dans l'état partagé."""
    partage.publier_journal(racine, NOM, poste, delta)


def instantane(con):
    """{table: {clé: ligne sans les colonnes ignorées}}."""
    sortie = {}
    for table, cle in TABLES.items():
        lignes = {}
        for r in con.execute(f'SELECT * FROM {table}'):
            ligne = {k: r[k] for k in r.keys() if k not in IGNOREES}
            lignes[ligne[cle]] = ligne
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
