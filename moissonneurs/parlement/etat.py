"""État partagé du parlement : ce qu'une passe mensuelle lit et écrit, sans la base de 2,4 Go du poste de développement.

Une passe charge le socle et les journaux (partage.py) dans une base SQLite en mémoire, au schéma de stockage.py, et
le code du moissonneur y tourne tel quel. Les affaires en attente d'un lot y entrent figées : leur verdict, leur note
et leur texte déposé ont été calculés au poste de développement, qui garde les textes. La passe publie dans son
journal ce qu'elle a appris. Le détail et les mesures sont dans docs/FORMAT-MOISSONS.md.
"""
import json

import partage

from . import export_propositions as ep, finesse, noms, reference
from . import correspondances as corr
from .stockage import Base, avant_date_min

NOM = 'parlement'
CHAMPS_DATE = ep.CHAMPS_DATE
EXPORTABLES = ('retenu', 'a-relire')

SCHEMA = {
    'corps': {'cle': ('body_key',), 'fusion': 'max'},
    'connues': {'cle': ('body_key',), 'fusion': 'union'},
    'affaires': {'cle': ('body_key', 'external_id'), 'leger': True},
    'bruts': {'cle': ('cle', 'empreinte'), 'leger': True},
    'candidats': {'cle': ('body_key', 'external_id', 'terme', 'langue'), 'leger': True},
    'textes_recuperes': {'cle': ('body_key', 'external_id'), 'leger': True},
    'verdicts': {'cle': ('body_key', 'external_id'), 'leger': True},
    'figees': {'cle': ('body_key', 'external_id'), 'leger': True},
    'finesse': {'cle': ('body_key', 'external_id')},
    'propositions': {'cle': ('cle',)},
    'decisions': {'cle': ('cle',), 'rang': {'champ': 'purgee', 'valeurs': {'1': 2}, 'defaut': 1}, 'rang_retrait': 1},
    'criblages': {'cle': ('terme', 'langue'), 'fusion': 'max'},
    'figes': {'cle': ('nom',)},
}
# Colonnes JSON : un objet dans le partage, un texte dans la base.
JSON = {'figees': 'donnees', 'finesse': 'donnees', 'figes': 'valeur'}
# Ce qu'une passe mensuelle publie ; `figes` (crans, noms, fiches appariées) ne vient que du poste de développement.
PUBLIES_PAR_UNE_PASSE = tuple(t for t in SCHEMA if t != 'figes')
POINT = ('connues', 'affaires', 'bruts', 'candidats', 'corps')

EtatAbsent = partage.EtatAbsent


def _cle(table, ligne):
    return tuple(str(ligne.get(c, '')) for c in SCHEMA[table]['cle'])


# --------------------------------------------------------------------------- chargement

def remplir(base, tables):
    """Insère l'état fusionné {table: [lignes]} dans `base` (stockage.Base)."""
    c = base.c
    for ligne in tables.get('connues', []):
        c.executemany('INSERT OR IGNORE INTO connues(body_key, external_id, date_depot) VALUES (?,?,?)',
                      [(ligne['body_key'], ext, d) for ext, d in (ligne.get('ids') or {}).items()])
    for table in SCHEMA:
        if table == 'connues':
            continue
        for ligne in tables.get(table, []):
            ligne = dict(ligne)
            if table in JSON:
                ligne[JSON[table]] = json.dumps(ligne[JSON[table]], ensure_ascii=False)
            if table == 'affaires':
                ligne.setdefault('derniere_vue', ligne.get('premiere_vue', ''))
            colonnes = ', '.join(ligne)
            c.execute(f'INSERT OR REPLACE INTO {table} ({colonnes}) VALUES ({", ".join("?" for _ in ligne)})',
                      list(ligne.values()))
    base.commit()
    return base


def charger(racine):
    """Base en mémoire remplie depuis l'état partagé de `racine`. Lève EtatAbsent."""
    return remplir(Base(':memory:'), partage.charger_etat(racine, NOM, SCHEMA))


# --------------------------------------------------------------------------- ce qui se publie

def _publiees(c):
    """Les affaires dont la ligne complète part dans le partage : figées, ou candidates pas encore classées."""
    return {(r[0], r[1]) for r in c.execute(
        """SELECT body_key, external_id FROM figees UNION
           SELECT DISTINCT k.body_key, k.external_id FROM candidats k JOIN affaires a USING (body_key, external_id)
           WHERE NOT EXISTS (SELECT 1 FROM verdicts v WHERE v.body_key=k.body_key AND v.external_id=k.external_id)""")}


def brut_reduit(base, body_key, external_id, empreinte, avec_extraits):
    """La charge d'une affaire réduite à ce que la suite lit : titres, dates et, pour une affaire à classer, les
    extraits de recherche de toutes ses versions."""
    cle = f'affaire:{body_key}:{external_id}'
    courant = base.brut(cle, empreinte) or {}
    reduit = {k: courant[k] for k in ('title',) + CHAMPS_DATE if k in courant}
    if avec_extraits:
        extraits = base.extraits_recherche(body_key, external_id)
        if extraits:
            reduit['_search_meta'] = {'snippets': [{'text': t} for t in extraits]}
    return {'cle': cle, 'empreinte': empreinte, 'charge': json.dumps(reduit, ensure_ascii=False, sort_keys=True),
            'recu_le': ''}


def instantane(base, tables=PUBLIES_PAR_UNE_PASSE):
    """{table: {clé: ligne au format du partage}} : ce que la base mettrait dans le partage."""
    c = base.c
    pub = _publiees(c)
    figees = {(r[0], r[1]) for r in c.execute('SELECT body_key, external_id FROM figees')}
    sortie = {}
    for table in tables:
        lignes = {}
        if table == 'connues':
            ids = {}
            for r in c.execute('SELECT body_key, external_id, date_depot FROM connues UNION '
                               'SELECT body_key, external_id, date_depot FROM affaires'):
                ids.setdefault(r[0], {})[r[1]] = r[2] or ''
            lignes = {(bk,): {'body_key': bk, 'ids': v} for bk, v in ids.items()}
        elif table == 'bruts':
            for r in c.execute('SELECT body_key, external_id, empreinte FROM affaires'):
                if (r[0], r[1]) in pub:
                    ligne = brut_reduit(base, r[0], r[1], r[2], (r[0], r[1]) not in figees)
                    lignes[_cle(table, ligne)] = ligne
        else:
            for r in c.execute(f'SELECT * FROM {table}'):
                ligne = {k: r[k] for k in r.keys()}
                if table in JSON:
                    ligne[JSON[table]] = json.loads(ligne[JSON[table]])
                if table == 'affaires':
                    ligne.pop('derniere_vue', None)
                if table in ('affaires', 'textes_recuperes', 'verdicts', 'candidats') \
                        and (ligne['body_key'], ligne['external_id']) not in pub:
                    continue
                if table == 'candidats' and (ligne['body_key'], ligne['external_id']) in figees:
                    continue
                lignes[_cle(table, ligne)] = ligne
        sortie[table] = lignes
    return sortie


def differentiel(avant, apres):
    """{table: [lignes nouvelles ou changées]} plus {'retirees': {table: [clés]}}. Pour `connues`, seuls les
    identifiants nouveaux partent : la fusion les réunit."""
    delta, retirees = {}, {}
    for table, lignes in apres.items():
        anciennes = avant.get(table, {})
        if table == 'connues':
            changees = []
            for k, l in lignes.items():
                vus = (anciennes.get(k) or {}).get('ids') or {}
                neufs = {e: d for e, d in l['ids'].items() if vus.get(e) != d}
                if neufs:
                    changees.append({'body_key': l['body_key'], 'ids': neufs})
        else:
            changees = [l for k, l in lignes.items() if anciennes.get(k) != l]
            parties = [list(k) for k in anciennes if k not in lignes]
            if parties:
                retirees[table] = parties
        if changees:
            delta[table] = changees
    if retirees:
        delta['retirees'] = retirees
    return delta


def publier_journal(racine, poste, delta):
    return partage.publier_journal(racine, NOM, poste, delta, SCHEMA)


# --------------------------------------------------------------------------- ce que le poste de dev fige

def en_attente(base, config):
    """Clés des affaires qu'un prochain lot peut proposer : exportables, ni décidées, ni déjà proposées telles quelles."""
    mini = config['criblage'].get('date_min_fiche', '')
    decidees = {r[0] for r in base.c.execute('SELECT cle FROM decisions')}
    deja = {r[0]: r[1] for r in base.c.execute('SELECT cle, empreinte FROM propositions')}
    sortie = []
    for r in base.c.execute("""SELECT a.body_key, a.external_id, a.empreinte, a.date_depot FROM verdicts v
                               JOIN affaires a USING (body_key, external_id) WHERE v.verdict IN ('retenu','a-relire')"""):
        cle = ep.cle_de(r[0], r[1])
        if cle in decidees or deja.get(cle) == r[2] or avant_date_min(r[3], mini):
            continue
        sortie.append((r[0], r[1]))
    return sortie


def figer(base, config, lex, recalculer=None):
    """Remplit `finesse` (toute affaire exportable) et `figees` (les affaires en attente) à partir des textes présents.

    Une affaire sans texte dans cette base garde ce qui y est déjà figé : il vient d'un journal, calculé par le poste
    qui avait son texte. `recalculer(clé)` dit si le texte est ici ; par défaut, des documents ou un texte récupéré."""
    c = base.c
    if recalculer is None:
        avec_texte = {(r[0], r[1]) for r in c.execute('SELECT body_key, external_id FROM textes_recuperes')}
        recalculer = avec_texte.__contains__
    lex_finesse = lex if (config.get('export') or {}).get('finesse') else None
    mini = config['criblage'].get('date_min_fiche', '')
    attente = set(en_attente(base, config))
    lignes = [dict(r) for r in c.execute("""SELECT a.* FROM verdicts v JOIN affaires a USING (body_key, external_id)
                                            WHERE v.verdict IN ('retenu','a-relire')""")]
    for a in lignes:
        k = (a['body_key'], a['external_id'])
        if avant_date_min(a['date_depot'], mini):
            continue
        a_texte = recalculer(k)
        if a_texte or base.donnees_figees('finesse', *k) is None:
            if a_texte:
                c.execute('DELETE FROM figees WHERE body_key=? AND external_id=?', k)
            f = finesse.finesse_de(config, base, lex, a)
            if f is None:
                c.execute('DELETE FROM finesse WHERE body_key=? AND external_id=?', k)
            else:
                c.execute('INSERT OR REPLACE INTO finesse(body_key, external_id, donnees) VALUES (?,?,?)',
                          (*k, json.dumps(f, ensure_ascii=False)))
        if k in attente and (a_texte or base.donnees_figees('figees', *k) is None):
            c.execute('DELETE FROM figees WHERE body_key=? AND external_id=?', k)
            lu = ep.lu_dans_les_documents(config, base, a, lex_finesse)
            c.execute('INSERT OR REPLACE INTO figees(body_key, external_id, donnees) VALUES (?,?,?)',
                      (*k, json.dumps(lu, ensure_ascii=False)))
    for k in {(r[0], r[1]) for r in c.execute('SELECT body_key, external_id FROM figees')} - attente:
        c.execute('DELETE FROM figees WHERE body_key=? AND external_id=?', k)
    base.commit()


def figer_valeurs(base, config, lex, aujourdhui, chemin_crans=None):
    """Les valeurs calculées sur toute la base : contexte des noms, fiches de référence appariées, crans du trimestre."""
    titres = [r[0] for r in base.c.execute('SELECT title FROM affaires WHERE title IS NOT NULL')]
    ctx = noms.contexte_de(titres, lambda t: corr.sans_personnes(corr.sans_reference_federale(t)))
    refs = reference.lire_reference(config['bibliotheque']['fiches'])
    appar = {f"{ref['slug']}|{ref['langue']}": ([a['body_key'], a['external_id']] if a else None)
             for ref, a, _ in reference.apparier(refs, base, config)}
    valeurs = {'noms': {'blanche': sorted(ctx.blanche), 'dure': sorted(ctx.dure), 'lieux': sorted(ctx.lieux)},
               'refs': appar}
    for nom, v in valeurs.items():
        base.c.execute('INSERT OR REPLACE INTO figes(nom, valeur) VALUES (?,?)', (nom, json.dumps(v, ensure_ascii=False)))
    if (config.get('export') or {}).get('finesse'):
        population, _, refs_scores, _, _ = finesse.collecter(config, base, lex)
        cfg = config.get('finesse', {})
        gele = finesse.crans_figes(chemin_crans, lambda: finesse.calculer_crans(
            population, refs_scores, aujourdhui, int(cfg.get('rappel_strict', finesse.RAPPEL_STRICT)),
            cfg.get('profil', finesse.PROFIL)), aujourdhui)
        base.c.execute('INSERT OR REPLACE INTO figes(nom, valeur) VALUES (?,?)',
                       ('crans', json.dumps(gele, ensure_ascii=False)))
    base.commit()


# --------------------------------------------------------------------------- fin de passe

def finaliser(base, config, lex):
    """Avant le dernier journal d'une passe : note et texte des affaires apprises, pendant que leurs documents sont en
    mémoire. Ce qui est déjà figé ne bouge pas : son texte n'est pas ici."""
    figees = {(r[0], r[1]) for r in base.c.execute('SELECT body_key, external_id FROM figees')}
    figer(base, config, lex, recalculer=lambda k: k not in figees)


# --------------------------------------------------------------------------- poste de développement

def absorber(base, racine):
    """Reprend dans la base du poste de dev les lignes de journaux qu'elle n'a pas encore lues. Rend (socle, journaux,
    lignes reprises). Un retrait d'une table légère dit seulement « plus besoin dans le partage » : la base de dev garde
    la ligne. Un texte récupéré ailleurs n'est pas repris : la base n'a pas ses documents."""
    socle = partage.lire_socle(racine, NOM)
    journaux = partage.lire_journaux(racine, NOM)
    c = base.c
    deja = {r[0]: r[1] for r in c.execute('SELECT journal, n FROM partage_absorbes')}
    reprises = 0
    for nom, lignes in sorted(journaux.items()):
        haut = deja.get(nom, 0)
        for l in sorted((l for l in lignes if isinstance(l.get('n'), int) and l['n'] > deja.get(nom, 0)),
                        key=lambda l: l['n']):
            haut = max(haut, l['n'])
            table, ligne = l.get('t'), l.get('r')
            if table not in SCHEMA or table == 'textes_recuperes':
                continue
            reprises += 1
            if ligne is None:
                if not SCHEMA[table].get('leger') and table != 'connues':
                    conditions = ' AND '.join(f'{col}=?' for col in SCHEMA[table]['cle'])
                    c.execute(f'DELETE FROM {table} WHERE {conditions}', list(l.get('k') or []))
                continue
            _reprendre(c, table, ligne)
        c.execute('INSERT OR REPLACE INTO partage_absorbes(journal, n) VALUES (?,?)', (nom, haut))
    base.commit()
    return socle, journaux, reprises


def _reprendre(c, table, ligne):
    if table == 'connues':
        c.executemany('INSERT OR IGNORE INTO connues(body_key, external_id, date_depot) VALUES (?,?,?)',
                      [(ligne['body_key'], e, d) for e, d in (ligne.get('ids') or {}).items()])
        return
    ligne = dict(ligne)
    if table in JSON:
        ligne[JSON[table]] = json.dumps(ligne[JSON[table]], ensure_ascii=False)
    if table == 'affaires':
        ligne.setdefault('derniere_vue', ligne.get('premiere_vue', ''))
    if table == 'corps':
        ancien = c.execute('SELECT * FROM corps WHERE body_key=?', (ligne['body_key'],)).fetchone()
        if ancien is not None:
            ligne = {k: partage._plus_grand(ancien[k], ligne.get(k)) for k in ancien.keys()}
    verbe = 'INSERT OR IGNORE' if table in ('affaires', 'bruts') else 'INSERT OR REPLACE'
    c.execute(f'{verbe} INTO {table} ({", ".join(ligne)}) VALUES ({", ".join("?" for _ in ligne)})',
              list(ligne.values()))


def tables_du_socle(base):
    """{table: [lignes]} : ce que la base de dev publie, toutes les tables du schéma."""
    return {t: list(lignes.values()) for t, lignes in instantane(base, tuple(SCHEMA)).items()}


def absorbes(base):
    return {r[0]: r[1] for r in base.c.execute('SELECT journal, n FROM partage_absorbes')}

