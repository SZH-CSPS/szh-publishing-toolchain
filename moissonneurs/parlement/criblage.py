"""Étage 1 : criblage par la recherche plein texte du serveur, puis texte des candidats.

Deux voies mènent à un candidat : la recherche serveur (terme d'ancrage fort, sur titres ET documents) et le
titre moissonné (ancrage local, voir `candidats_par_titre`). Les deux sont stockées dans `candidats`.
"""
from .reseau import BudgetEpuise
from .lexique import normaliser
from .stockage import avant_date_min, maintenant

# Paires (terme accentué, même terme sans accents) : le premier doit rendre PLUS de résultats (piège n° 3).
SONDES_ACCENTS = [('Sonderpädagogik', 'Sonderpadagogik', 'de'), ('pédagogie spécialisée', 'pedagogie specialisee', 'fr')]


class AccentsMutiles(Exception):
    """Les termes accentués rendent autant ou moins que leur version sans accent : l'encodage est suspect."""


def termes_de_recherche(lex):
    """[(terme, langue)] interrogés côté serveur : termes forts, 4 caractères au moins, hors sigles et radicaux."""
    vus, sortie = set(), []
    for t in lex.termes:
        if (t.ambigu or t.cs or t.titre_seul or len(t.texte) < 4
                or t.mode == 'sous' and ' ' not in t.texte and len(t.texte) < 8
                or (normaliser(t.texte), t.langue) in lex.sans_serveur):
            continue
        cle = (t.texte, t.langue)
        if cle not in vus:
            vus.add(cle)
            sortie.append(cle)
    return sortie


def total_recherche(config, reseau, source, terme, langue):
    """Total déclaré par le serveur pour un terme (une requête, limite 1)."""
    return source.total_recherche(config, reseau, terme, langue)


def verifier_accents(config, reseau, source, sondes=SONDES_ACCENTS):
    """Lève AccentsMutiles si un terme accentué ne rend pas plus que sa version sans accent."""
    res = []
    for accentue, nu, langue in sondes:
        a = total_recherche(config, reseau, source, accentue, langue)
        b = total_recherche(config, reseau, source, nu, langue)
        res.append((accentue, a, nu, b))
        if a is None or b is None or a <= b:
            raise AccentsMutiles(f'« {accentue} » rend {a}, « {nu} » rend {b}')
    return res


def cribler(config, base, reseau, source, lex, termes=None, rejouer=False, suivis=None, progression=None,
            depuis=None, cache=True):
    """Interroge le serveur terme par terme. Un terme déjà criblé n'est pas redemandé (sauf rejouer).

    Rend la liste des lignes {terme, langue, total, candidats, requetes, statut}. Un terme en échec est
    consigné et n'arrête pas les autres ; le budget épuisé arrête proprement.

    `depuis` : borne de dépôt de la recherche (défaut : [moisson] depuis) ; `cache=False` : pages toujours fraîches
    (passe mensuelle).
    """
    termes = termes if termes is not None else termes_de_recherche(lex)
    suivis = set(suivis) if suivis is not None else None
    rapport = []
    deja = {(r['terme'], r['langue']) for r in base.c.execute('SELECT terme, langue FROM criblages')}
    for terme, langue in termes:
        if (terme, langue) in deja and not rejouer:
            continue
        avant = reseau.requetes
        etat, n = {}, 0
        try:
            for a in source.rechercher(config, reseau, terme, langue, depuis=depuis or config['moisson']['depuis'],
                                       etat=etat, cache=cache):
                if suivis is not None and a.body_key not in suivis:
                    continue
                base.enregistrer_affaire(a)
                base.c.execute('INSERT OR IGNORE INTO candidats(body_key, external_id, terme, langue, vu_le) '
                               'VALUES (?,?,?,?,?)', (a.body_key, a.external_id, terme, langue, maintenant()))
                n += 1
            base.c.execute('INSERT OR REPLACE INTO criblages(terme, langue, total, requetes, fait_le) VALUES (?,?,?,?,?)',
                           (terme, langue, etat.get('total'), reseau.requetes - avant, maintenant()))
            ligne = dict(terme=terme, langue=langue, total=etat.get('total'), candidats=n,
                         requetes=reseau.requetes - avant, statut='ok')
        except BudgetEpuise:
            base.commit()
            raise
        except Exception as e:  # un terme en échec ne bloque pas les autres
            ligne = dict(terme=terme, langue=langue, total=None, candidats=n,
                         requetes=reseau.requetes - avant, statut=f'echec: {type(e).__name__}: {e}')
        base.commit()
        rapport.append(ligne)
        if progression:
            progression(ligne)
    return rapport


def candidats_par_titre(config, base, lex):
    """Ajoute comme candidats les affaires moissonnées dont le TITRE porte un ancrage (fort ou ambigu).

    Aucun réseau. Rend le nombre d'affaires ajoutées. Date de dépôt antérieure à `date_min_fiche` : ignorée.
    """
    mini = config['criblage'].get('date_min_fiche', '')
    eg = bool(config.get('classement', {}).get('ecole_generale', False))
    th = bool(config.get('classement', {}).get('themes_elargis', False))
    n = 0
    for r in base.c.execute('SELECT * FROM affaires').fetchall():
        if avant_date_min(r['date_depot'], mini):
            continue
        titre = base.titre_complet(r)
        if lex.ancrages(titre) or (eg and lex.ecole_generale_dans(titre)) or (th and lex.themes_dans(titre)):
            cur = base.c.execute('INSERT OR IGNORE INTO candidats(body_key, external_id, terme, langue, vu_le) '
                                 'VALUES (?,?,?,?,?)', (r['body_key'], r['external_id'], '(titre)', '-', maintenant()))
            n += cur.rowcount
    base.commit()
    return n


def recuperer_textes_pour(config, base, reseau, source, cles, progression=None):
    """Comme `recuperer_textes`, pour des affaires données [(body_key, external_id)] candidates ou non (mesure du rappel)."""
    return recuperer_textes(config, base, reseau, source, progression, cles=cles)


def recuperer_textes(config, base, reseau, source, progression=None, cles=None):
    """Télécharge /docs une seule fois pour chaque candidat sans texte récupéré.

    Rend {'faits', 'echecs'} ; une affaire sans id_api ou en erreur est consignée, jamais bloquante.
    """
    mini = config['criblage'].get('date_min_fiche', '')
    faits, echecs = 0, []
    if cles is None:
        lignes = base.c.execute(
            """SELECT DISTINCT a.body_key, a.external_id, a.id_api, a.date_depot FROM candidats c
               JOIN affaires a ON a.body_key=c.body_key AND a.external_id=c.external_id
               LEFT JOIN textes_recuperes t ON t.body_key=a.body_key AND t.external_id=a.external_id
               WHERE t.external_id IS NULL ORDER BY a.body_key, a.external_id""").fetchall()
    else:
        lignes = [r for k, e in cles for r in base.c.execute(
            """SELECT a.body_key, a.external_id, a.id_api, a.date_depot FROM affaires a
               LEFT JOIN textes_recuperes t ON t.body_key=a.body_key AND t.external_id=a.external_id
               WHERE a.body_key=? AND a.external_id=? AND t.external_id IS NULL""", (k, e)).fetchall()]
    for r in lignes:
        if avant_date_min(r['date_depot'], mini):
            continue
        if not r['id_api']:
            echecs.append((r['body_key'], r['external_id'], 'identifiant API absent'))
            continue
        try:
            payload, docs = source.documents(config, reseau, r['id_api'])
            emp, _ = base.enregistrer_brut(f"docs:{r['body_key']}:{r['id_api']}", payload)
            for d in docs:
                if not isinstance(d, dict):
                    continue
                base.c.execute(
                    """INSERT OR REPLACE INTO documents(body_key, id_api, doc_id, nom, url, url_oparl, langue, texte,
                       empreinte) VALUES (?,?,?,?,?,?,?,?,?)""",
                    (r['body_key'], r['id_api'], str(d.get('id') or d.get('name') or len(docs)),
                     source.localiser(d.get('name')), str(d.get('url') or ''), str(d.get('url_oparl') or ''),
                     str(d.get('language') or ''), str(d.get('text') or ''), emp))
            base.c.execute('INSERT OR REPLACE INTO textes_recuperes(body_key, external_id, nb_documents, fait_le) '
                           'VALUES (?,?,?,?)', (r['body_key'], r['external_id'], len(docs), maintenant()))
            faits += 1
        except BudgetEpuise:
            base.commit()
            raise
        except Exception as e:
            echecs.append((r['body_key'], r['external_id'], f'{type(e).__name__}: {e}'))
        base.commit()
        if progression:
            progression({'body_key': r['body_key'], 'external_id': r['external_id']})
    return {'faits': faits, 'echecs': echecs}
