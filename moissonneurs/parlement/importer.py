"""Import de base par les exports de files.openparldata.ch : affaires, criblage local, documents des candidates.

Remplace, pour la première moisson, la boucle de pages /v1/ : une requête par fichier (5 s entre deux), aucune vers
api.openparldata.ch. Les tables et le classement ne voient aucune différence avec la moisson par l'API.
"""
import itertools

from . import criblage, criblage_local, moisson
from .sources import exports
from .stockage import maintenant


def _noop(_):
    pass


def importer(config, base, telechargeur, lex, depuis=None, corps=None, emit=None, garder_fichiers=False,
             avec_textes_che=True):
    """Importe les affaires déposées depuis `depuis` des corps suivis. Rend un résumé {corps: {...}, 'total': {...}}."""
    emit = emit or _noop
    depuis = depuis or config['moisson']['depuis']
    suivis = [c for c in moisson.corps_suivis(config) if corps is None or c in corps]
    resume = {'corps': {}, 'fichiers': 0}

    # 1. Affaires : un fichier pour tous les corps
    chemin = telechargeur.telecharger('affairs.ndjson.gz')
    ids = {c: {} for c in suivis}              # corps -> {id_api (int) : external_id}
    reperes, nouvelles = {}, {c: 0 for c in suivis}
    try:
        for a in exports.lire_affaires(chemin, set(suivis), depuis):
            base.enregistrer_affaire(a)
            ids[a.body_key][int(a.id_api)] = a.external_id
            nouvelles[a.body_key] += 1
            if a.updated_at > reperes.get(a.body_key, ''):
                reperes[a.body_key] = a.updated_at
    finally:
        if not garder_fichiers:
            telechargeur.supprimer(chemin)
    base.commit()
    for c in suivis:
        if ids[c]:
            base.enregistrer_corps(c, None, len(ids[c]))
            base.poser_repere(c, reperes[c])
        resume['corps'][c] = {'affaires': nouvelles[c]}
    emit({'etape': 'import-affaires', 'affaires': sum(nouvelles.values())})

    # 2. Candidates par le titre (même règle que le criblage serveur) : leurs documents servent au classement
    resume['candidates_titre'] = criblage.candidats_par_titre(config, base, lex)
    base.commit()

    # 3. Documents : balayage de chaque fichier docs_<corps>, texts_CHE en plus pour la Confédération
    balayeur = criblage_local.Balayeur(lex)
    for c in suivis:
        if not ids[c]:
            continue
        fichiers = []
        try:
            try:
                docs = telechargeur.telecharger(f'docs/docs_{c}.ndjson.gz')
                fichiers.append(docs)
            except exports.FichierAbsent:
                docs = None
                resume['corps'][c]['sans_fichier_documents'] = True
            textes = None
            if c == config['moisson']['confederation'] and avec_textes_che:
                try:
                    textes = telechargeur.telecharger('texts/texts_CHE.ndjson.gz')
                    fichiers.append(textes)
                except exports.FichierAbsent:
                    resume['corps'][c]['sans_fichier_textes'] = True
            if docs is None and textes is None:
                continue
            garde = {int(r['id_api']) for r in base.c.execute(
                """SELECT a.id_api FROM candidats k JOIN affaires a ON a.body_key=k.body_key AND a.external_id=k.external_id
                   WHERE k.body_key=? AND k.terme='(titre)'""", (c,)) if r['id_api']}
            cles = set(ids[c])

            def flux(docs=docs, textes=textes, cles=cles):
                itr = []
                if docs:
                    itr.append(exports.lire_documents(docs, cles))
                if textes:
                    itr.append(exports.lire_textes(textes, cles))
                return itertools.chain(*itr)

            resultats = criblage_local.cribler_flux(balayeur, flux, garde & cles)
            n_cand = _enregistrer(base, c, resultats, ids[c])
            resume['corps'][c]['candidates'] = n_cand
            emit({'etape': 'import-documents', 'corps': c, 'candidates': n_cand})
        finally:
            if not garder_fichiers:
                for f in fichiers:
                    telechargeur.supprimer(f)
    # Les termes sont criblés : la recherche serveur ne les redemande pas pour la période importée
    for terme, langue in balayeur.paires:
        base.c.execute('INSERT OR IGNORE INTO criblages(terme, langue, total, requetes, fait_le) VALUES (?,?,?,?,?)',
                       (terme, langue, None, 0, maintenant()))
    base.commit()
    resume['fichiers'] = telechargeur.fichiers
    return resume


def _enregistrer(base, corps, resultats, id_vers_ext):
    """Écrit candidats, extraits, documents et marque le texte récupéré. Rend le nombre de candidates par le texte."""
    n = 0
    for aid, r in resultats.items():
        ext = id_vers_ext[aid]
        if r['touches']:
            n += 1
        for (terme, langue) in r['touches']:
            base.c.execute('INSERT OR IGNORE INTO candidats(body_key, external_id, terme, langue, vu_le) VALUES (?,?,?,?,?)',
                           (corps, ext, terme, langue, maintenant()))
        base.ajouter_extraits(corps, ext, list(dict.fromkeys(r['touches'].values()))[:5])
        docs = r['documents']
        emp, _ = base.enregistrer_brut(f'docs:{corps}:{aid}', {'data': docs})
        for d in docs:
            base.c.execute(
                """INSERT OR REPLACE INTO documents(body_key, id_api, doc_id, nom, url, url_oparl, langue, texte, empreinte)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (corps, str(aid), str(d.get('id')), str(d.get('name') or ''), str(d.get('url') or ''),
                 str(d.get('url_oparl') or ''), str(d.get('language') or ''), str(d.get('text') or ''), emp))
        base.c.execute('INSERT OR REPLACE INTO textes_recuperes(body_key, external_id, nb_documents, fait_le) VALUES (?,?,?,?)',
                       (corps, ext, len(docs), maintenant()))
        base.commit()
    return n
