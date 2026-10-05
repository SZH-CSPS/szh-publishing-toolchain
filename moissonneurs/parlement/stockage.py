"""Base SQLite : charges utiles brutes (jamais écrasées) et tout ce qu'on en dérive.

Chaque brique lit son entrée ici et y écrit sa sortie. Voir LISEZMOI.md.
"""
import hashlib
import json
import os
import sqlite3
import time

SCHEMA = """
CREATE TABLE IF NOT EXISTS bruts (
    cle TEXT NOT NULL,            -- 'affaire:<body_key>:<external_id>', 'docs:<body_key>:<id_api>', 'liste:<url>'
    empreinte TEXT NOT NULL,      -- SHA-256 de la charge utile
    charge TEXT NOT NULL,         -- JSON tel que reçu
    recu_le TEXT NOT NULL,
    PRIMARY KEY (cle, empreinte)
);
CREATE TABLE IF NOT EXISTS corps (
    body_key TEXT PRIMARY KEY,
    nom TEXT,
    nb_affaires INTEGER,
    repere TEXT,                  -- plus grand updated_at déjà vu : la moisson suivante s'arrête dessous
    vu_le TEXT
);
CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    commande TEXT NOT NULL,
    corps TEXT,
    debut TEXT NOT NULL,
    fin TEXT,
    statut TEXT NOT NULL,         -- 'ok' | 'echec' | 'budget' | 'en-cours'
    raison TEXT,
    requetes INTEGER DEFAULT 0,
    nouveautes INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS affaires (
    body_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    id_api TEXT,
    number TEXT,
    title TEXT,
    type_name TEXT,               -- JSON du libellé cantonal brut
    type_harmonized_id INTEGER,
    date_depot TEXT,
    updated_at TEXT,
    url_externe TEXT,
    url_oparl TEXT,
    empreinte TEXT NOT NULL,      -- renvoie à bruts('affaire:...')
    premiere_vue TEXT NOT NULL,
    derniere_vue TEXT NOT NULL,
    PRIMARY KEY (body_key, external_id)
);
CREATE TABLE IF NOT EXISTS candidats (
    body_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    terme TEXT NOT NULL,
    langue TEXT NOT NULL,
    vu_le TEXT NOT NULL,
    PRIMARY KEY (body_key, external_id, terme, langue)
);
CREATE TABLE IF NOT EXISTS criblages (
    terme TEXT NOT NULL,
    langue TEXT NOT NULL,
    total INTEGER,
    requetes INTEGER,
    fait_le TEXT NOT NULL,
    PRIMARY KEY (terme, langue)
);
CREATE TABLE IF NOT EXISTS documents (
    body_key TEXT NOT NULL,
    id_api TEXT NOT NULL,         -- affaire parente
    doc_id TEXT NOT NULL,
    nom TEXT,
    url TEXT,
    url_oparl TEXT,
    langue TEXT,
    texte TEXT,
    empreinte TEXT NOT NULL,
    PRIMARY KEY (body_key, id_api, doc_id)
);
CREATE TABLE IF NOT EXISTS textes_recuperes (   -- affaires dont /docs est déjà téléchargé
    body_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    nb_documents INTEGER,
    fait_le TEXT NOT NULL,
    PRIMARY KEY (body_key, external_id)
);
CREATE TABLE IF NOT EXISTS verdicts (
    body_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    verdict TEXT NOT NULL,        -- 'retenu' | 'a-relire' | 'ecarte'
    score REAL,
    domaine TEXT,
    categorie TEXT,
    raison TEXT,
    calcule_le TEXT NOT NULL,
    PRIMARY KEY (body_key, external_id)
);
CREATE TABLE IF NOT EXISTS propositions (   -- ce qui est parti dans un lot ; une cle revient si l'affaire a changé
    cle TEXT PRIMARY KEY,
    empreinte TEXT NOT NULL,      -- empreinte brute de l'affaire au moment de l'export
    lot TEXT NOT NULL,
    ecrit_le TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (      -- décisions de la rédaction lues dans le dossier de décisions
    cle TEXT PRIMARY KEY,
    decision TEXT NOT NULL,       -- 'accepte' | 'refuse'
    motif TEXT,                   -- 'hors-sujet' | 'doublon' | 'autre' (refus) : mesure de la précision
    fiche TEXT,
    date TEXT,
    lue_le TEXT NOT NULL,
    purgee INTEGER NOT NULL DEFAULT 0   -- 1 : le fichier de décision a été purgé, la base garde la mémoire
);
CREATE TABLE IF NOT EXISTS connues (     -- affaires connues sans leur ligne complète (état partagé)
    body_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    date_depot TEXT,
    PRIMARY KEY (body_key, external_id)
);
CREATE TABLE IF NOT EXISTS figees (      -- ce que l'export lit d'une affaire en attente dont le texte reste au poste de dev
    body_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    donnees TEXT NOT NULL,
    PRIMARY KEY (body_key, external_id)
);
CREATE TABLE IF NOT EXISTS finesse (     -- note, langues, mois et termes d'une affaire exportable, pour les crans et les termes
    body_key TEXT NOT NULL,
    external_id TEXT NOT NULL,
    donnees TEXT NOT NULL,
    PRIMARY KEY (body_key, external_id)
);
CREATE TABLE IF NOT EXISTS figes (       -- valeurs calculées au poste de dev : crans, contexte des noms, fiches appariées
    nom TEXT PRIMARY KEY,
    valeur TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS partage_absorbes (   -- poste de dev : lignes de journal déjà reprises
    journal TEXT PRIMARY KEY,
    n INTEGER NOT NULL
);
"""


def maintenant():
    return time.strftime('%Y-%m-%dT%H:%M:%S')


def empreinte(texte):
    return hashlib.sha256(texte.encode('utf-8')).hexdigest()


class Base:
    def __init__(self, chemin):
        if chemin != ':memory:':
            os.makedirs(os.path.dirname(chemin) or '.', exist_ok=True)
        self.chemin = chemin
        self.c = sqlite3.connect(chemin)
        self.c.row_factory = sqlite3.Row
        self.c.executescript(SCHEMA)
        colonnes = {r['name'] for r in self.c.execute('PRAGMA table_info(decisions)')}
        if 'purgee' not in colonnes:        # base créée avant la purge
            self.c.execute('ALTER TABLE decisions ADD COLUMN purgee INTEGER NOT NULL DEFAULT 0')

    def fermer(self):
        self.c.commit()
        self.c.close()

    def commit(self):
        self.c.commit()

    # -- bruts -----------------------------------------------------------

    def enregistrer_brut(self, cle, charge):
        """Garde la charge telle que reçue. Rend (empreinte, nouveau). Jamais d'écrasement."""
        texte = charge if isinstance(charge, str) else json.dumps(charge, ensure_ascii=False, sort_keys=True)
        emp = empreinte(texte)
        cur = self.c.execute('INSERT OR IGNORE INTO bruts(cle, empreinte, charge, recu_le) VALUES (?,?,?,?)',
                             (cle, emp, texte, maintenant()))
        return emp, cur.rowcount == 1

    def extraits_recherche(self, body_key, external_id):
        """Extraits de la recherche serveur (`_search_meta.snippets`) gardés dans toutes les versions du brut."""
        sortie = []
        for r in self.c.execute('SELECT charge FROM bruts WHERE cle=? ORDER BY recu_le',
                                (f'affaire:{body_key}:{external_id}',)):
            try:
                meta = json.loads(r['charge']).get('_search_meta') or {}
            except (ValueError, AttributeError):
                continue
            for s in meta.get('snippets') or []:
                t = s.get('text') if isinstance(s, dict) else None
                if t and t not in sortie:
                    sortie.append(t)
        return sortie

    def ajouter_extraits(self, body_key, external_id, extraits):
        """Ajoute des extraits `_search_meta.snippets` au brut courant de l'affaire (nouvelle version du brut)."""
        cle = f'affaire:{body_key}:{external_id}'
        r = self.c.execute('SELECT empreinte FROM affaires WHERE body_key=? AND external_id=?',
                           (body_key, external_id)).fetchone()
        if r is None or not extraits:
            return
        brut = self.brut(cle, r['empreinte']) or {}
        meta = dict(brut.get('_search_meta') or {})
        existants = list(meta.get('snippets') or [])
        vus = {s.get('text') for s in existants if isinstance(s, dict)}
        for t in extraits:
            if t and t not in vus:
                existants.append({'text': t, 'source_type': 'docs'})
                vus.add(t)
        meta['snippets'] = existants
        brut['_search_meta'] = meta
        emp, _ = self.enregistrer_brut(cle, brut)
        self.c.execute('UPDATE affaires SET empreinte=? WHERE body_key=? AND external_id=?', (emp, body_key, external_id))

    def brut(self, cle, emp):
        r = self.c.execute('SELECT charge FROM bruts WHERE cle=? AND empreinte=?', (cle, emp)).fetchone()
        return json.loads(r['charge']) if r else None

    # -- executions --------------------------------------------------------

    def debuter_execution(self, commande, corps=None):
        cur = self.c.execute('INSERT INTO executions(commande, corps, debut, statut) VALUES (?,?,?,?)',
                             (commande, corps, maintenant(), 'en-cours'))
        self.c.commit()
        return cur.lastrowid

    def terminer_execution(self, ident, statut, raison='', requetes=0, nouveautes=0):
        self.c.execute('UPDATE executions SET fin=?, statut=?, raison=?, requetes=?, nouveautes=? WHERE id=?',
                       (maintenant(), statut, raison, requetes, nouveautes, ident))
        self.c.commit()

    def corps_en_echec(self, commande='moissonner'):
        """Corps dont la dernière exécution n'est pas 'ok' : la moisson suivante les reprend."""
        lignes = self.c.execute(
            """SELECT corps, statut FROM executions e WHERE commande=? AND corps IS NOT NULL
               AND id=(SELECT MAX(id) FROM executions WHERE commande=e.commande AND corps=e.corps)""",
            (commande,)).fetchall()
        return sorted(l['corps'] for l in lignes if l['statut'] != 'ok')

    # -- repères -----------------------------------------------------------

    def repere(self, body_key):
        r = self.c.execute('SELECT repere FROM corps WHERE body_key=?', (body_key,)).fetchone()
        return r['repere'] if r and r['repere'] else None

    def poser_repere(self, body_key, repere):
        self.c.execute(
            """INSERT INTO corps(body_key, repere, vu_le) VALUES (?,?,?)
               ON CONFLICT(body_key) DO UPDATE SET repere=excluded.repere, vu_le=excluded.vu_le""",
            (body_key, repere, maintenant()))

    def enregistrer_corps(self, body_key, nom=None, nb_affaires=None):
        self.c.execute(
            """INSERT INTO corps(body_key, nom, nb_affaires, vu_le) VALUES (?,?,?,?)
               ON CONFLICT(body_key) DO UPDATE SET nom=COALESCE(excluded.nom, nom),
                   nb_affaires=COALESCE(excluded.nb_affaires, nb_affaires), vu_le=excluded.vu_le""",
            (body_key, nom, nb_affaires, maintenant()))

    # -- affaires ----------------------------------------------------------

    def connus(self, body_key):
        """Ensemble des external_id déjà en base pour ce corps, connues de l'état partagé comprises."""
        return {r['external_id'] for r in self.c.execute(
            'SELECT external_id FROM affaires WHERE body_key=? UNION SELECT external_id FROM connues WHERE body_key=?',
            (body_key, body_key))}

    def enregistrer_affaire(self, a):
        """a : parlement.sources.openparldata.Affaire. Rend 'nouvelle' | 'changee' | 'inchangee'."""
        cle = f'affaire:{a.body_key}:{a.external_id}'
        emp, nouveau_brut = self.enregistrer_brut(cle, a.brut)
        existant = self.c.execute('SELECT empreinte FROM affaires WHERE body_key=? AND external_id=?',
                                  (a.body_key, a.external_id)).fetchone()
        maint = maintenant()
        if existant is None:
            self.c.execute(
                """INSERT INTO affaires(body_key, external_id, id_api, number, title, type_name,
                   type_harmonized_id, date_depot, updated_at, url_externe, url_oparl, empreinte,
                   premiere_vue, derniere_vue) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (a.body_key, a.external_id, a.id_api, a.number, a.title,
                 json.dumps(a.type_name, ensure_ascii=False), a.type_harmonized_id, a.date_depot,
                 a.updated_at, a.url_externe, a.url_oparl, emp, maint, maint))
            return 'nouvelle'
        if existant['empreinte'] == emp:
            self.c.execute('UPDATE affaires SET derniere_vue=? WHERE body_key=? AND external_id=?',
                           (maint, a.body_key, a.external_id))
            return 'inchangee'
        self.c.execute(
            """UPDATE affaires SET id_api=?, number=?, title=?, type_name=?, type_harmonized_id=?,
               date_depot=?, updated_at=?, url_externe=?, url_oparl=?, empreinte=?, derniere_vue=?
               WHERE body_key=? AND external_id=?""",
            (a.id_api, a.number, a.title, json.dumps(a.type_name, ensure_ascii=False),
             a.type_harmonized_id, a.date_depot, a.updated_at, a.url_externe, a.url_oparl, emp, maint,
             a.body_key, a.external_id))
        return 'changee'

    def compte_affaires_par_corps(self):
        return {r['body_key']: r['n'] for r in self.c.execute(
            """SELECT body_key, COUNT(*) n FROM (SELECT body_key, external_id FROM affaires UNION
               SELECT body_key, external_id FROM connues) GROUP BY body_key ORDER BY body_key""")}

    def fige(self, nom, defaut=None):
        """Valeur JSON calculée au poste de développement (crans, contexte des noms, fiches appariées)."""
        r = self.c.execute('SELECT valeur FROM figes WHERE nom=?', (nom,)).fetchone()
        return json.loads(r['valeur']) if r else defaut

    def donnees_figees(self, table, body_key, external_id):
        """Dict de `figees` ou de `finesse` pour une affaire, ou None."""
        r = self.c.execute(f'SELECT donnees FROM {table} WHERE body_key=? AND external_id=?', (body_key, external_id)).fetchone()
        return json.loads(r['donnees']) if r else None


def avant_date_min(date, mini):
    """Vrai si `date` est une date ISO antérieure à `mini`. Une date absente ou illisible n'écarte jamais."""
    return bool(mini and date and len(date) >= 10 and date[4] == '-' and date[7] == '-' and date[:10] < mini)


def titres_toutes_langues(brut, repli=''):
    """« fr / de / it » : tous les titres déposés dans les langues de la source (le dépôt fédéral est trilingue)."""
    t = (brut or {}).get('title')
    if isinstance(t, dict):
        vus = []
        for lang in ('fr', 'de', 'it', 'rm', 'en'):
            v = (t.get(lang) or '').strip()
            if v and v not in vus:
                vus.append(v)
        for v in t.values():
            v = (v or '').strip() if isinstance(v, str) else ''
            if v and v not in vus:
                vus.append(v)
        if vus:
            return ' / '.join(vus)
    return repli


def _titre_complet(self, row):
    brut = self.brut(f"affaire:{row['body_key']}:{row['external_id']}", row['empreinte'])
    return titres_toutes_langues(brut, row['title'] or '')


Base.titre_complet = _titre_complet
