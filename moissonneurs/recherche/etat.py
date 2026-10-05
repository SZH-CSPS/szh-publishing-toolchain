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


# --------------------------------------------------------------------------- poste de développement

def tables_du_socle(con):
    """{table: [lignes]} : ce que la base de dev publie, triées par clé ; `derniere_vue` n'y est pas."""
    return {t: [l for _, l in sorted(lignes.items(), key=lambda kv: partage.cle_de(SCHEMA[t], kv[1]))]
            for t, lignes in instantane(con).items()}


def absorbes(con):
    return {r[0]: r[1] for r in con.execute('SELECT journal, n FROM partage_absorbes')}


def absorber(con, racine):
    """Reprend dans la base de dev les lignes de journaux qu'elle n'a pas encore lues. Rend (socle, journaux, lignes
    reprises). La base tient lieu de socle dans partage.fusionner : elle sort dans l'état qu'une passe verrait. Un
    projet déjà en base garde son `id` et sa `derniere_vue`. Lève EtatAbsent sans socle."""
    socle = partage.lire_socle(racine, NOM)
    journaux = partage.lire_journaux(racine, NOM)
    deja = absorbes(con)
    avant = instantane(con)
    fusion = partage.fusionner({'absorbes': deja, 'tables': {t: list(l.values()) for t, l in avant.items()}},
                               journaux, SCHEMA)
    reprises = sum(1 for nom, lignes in journaux.items() for l in lignes
                   if l.get('t') in SCHEMA and isinstance(l.get('n'), int) and l['n'] > int(deja.get(nom, 0)))
    a_ecrire = {}
    for table in TABLES:
        presentes = {partage._texte_cle(partage.cle_de(SCHEMA[table], l)): l for l in avant[table].values()}
        for cle, ligne in fusion[table].items():
            ancienne = presentes.get(cle)
            if ligne == ancienne:
                continue
            ligne = dict(ligne)
            if table == 'projets' and ancienne is not None:
                ligne['id'] = ancienne['id']
                ligne['derniere_vue'] = con.execute('SELECT derniere_vue FROM projets WHERE id = ?',
                                                    (ancienne['id'],)).fetchone()[0]
            a_ecrire.setdefault(table, []).append(ligne)
        for cle, ligne in presentes.items():
            if cle not in fusion[table]:
                conditions = ' AND '.join(f'{c} = ?' for c in TABLES[table])
                con.execute(f'DELETE FROM {table} WHERE {conditions}', [ligne[c] for c in TABLES[table]])
    remplir(con, a_ecrire)
    for nom, n in partage.absorbes_de({'absorbes': deja}, journaux).items():
        con.execute('INSERT OR REPLACE INTO partage_absorbes(journal, n) VALUES (?, ?)', (nom, n))
    con.commit()
    return socle, journaux, reprises
