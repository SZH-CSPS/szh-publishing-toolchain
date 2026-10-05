"""Propositions `pronto-proposition/1` : un lot JSONL par exécution, jamais de fiche Kirby.

Seul le cockpit de Pronto écrit les fiches, après acceptation (docs/FORMAT-PROPOSITIONS.md). Tout le format vit ici :
un changement de format reste local à ce module. Un lot s'écrit sous un nom temporaire puis se renomme, et n'est
plus jamais modifié. `ecarte` ne part jamais ; un doublon sûr non plus ; une `cle` décidée non plus.
"""
import datetime
import difflib
import json
import os
import re

import commun
from commun import moins_mois, nom_lot as _nom_lot

from . import correspondances as corr
from . import decisions, finesse, lexique, noms, reference, texte
from .stockage import avant_date_min, maintenant as horodatage

FORMAT = 'pronto-proposition/1'
MOISSONNEUR = 'parlement'
SOURCE = 'openparldata'
TYPE = 'intervention'
# Liste fermée (docs/FORMAT-PROPOSITIONS.md) : un autre code s'y fait ajouter, il ne s'invente pas.
CODES_DOUTE = ('date-illisible', 'langue-devinee', 'correspondance-incertaine', 'valeur-hors-liste', 'personne-nommee',
               'champ-introuvable', 'texte-tronque')
RAISON_NOM = 'nom de personne non coupé'
SEUIL_PROBABLE = 0.88
CHAMPS_DATE = ('begin_date', 'date', 'submitted_at', 'start_date', 'created_date')


def cle_de(body_key, external_id):
    return f'{MOISSONNEUR}:{SOURCE}:{body_key}:{external_id}'


def utc_maintenant():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _doute(champ, code, detail, suggestion=None):
    assert code in CODES_DOUTE, code
    d = {'champ': champ, 'code': code, 'detail': detail}
    if suggestion:
        d['suggestion'] = suggestion
    return d


def lire_date(brut):
    """(date AAAA-MM-JJ | '', doute | None). Une date lisible mais décorée (heure) ne fait pas de doute."""
    if not brut:
        return '', _doute('date', 'date-illisible', 'date de dépôt absente')
    s = str(brut).strip()
    m = re.match(r'^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$', s)
    if m:
        try:
            datetime.date.fromisoformat(m.group(1))
            return m.group(1), None
        except ValueError:
            pass
    m = re.match(r'^(\d{1,2})[./](\d{1,2})[./](\d{4})$', s)
    sugg = ''
    if m:
        try:
            sugg = datetime.date(int(m.group(3)), int(m.group(2)), int(m.group(1))).isoformat()
        except ValueError:
            sugg = ''
    return '', _doute('date', 'date-illisible', 'format non reconnu (AAAA-MM-JJ attendu) ; valeur lue dans brut.date', sugg)


def _titre_brut(brut_aff, titre):
    t = (brut_aff or {}).get('title')
    return t if t else titre


def _production(config):
    """Index de la bibliothèque de production (lecture seule)."""
    refs = reference.lire_reference(config['bibliotheque']['fiches'])
    return {'refs': refs,
            'numero': {(r['canton'], reference.cle_numero(r['numero'])): r for r in refs if r['numero']},
            'titre': {(r['canton'], reference.cle_titre(r['title'])): r for r in refs},
            'lien': {r['lien'].lower(): r for r in refs if r['lien']}}


def chercher_doublon(prod, canton, numero, titre, lien):
    """(fiche, certitude 'sur'|'probable', méthode) ou (None, '', '')."""
    r = prod['numero'].get((canton, reference.cle_numero(numero))) if numero else None
    if r:
        return r, 'sur', 'canton + numéro'
    r = prod['titre'].get((canton, reference.cle_titre(titre)))
    if r:
        return r, 'sur', 'canton + titre'
    r = prod['lien'].get(lien.lower()) if lien else None
    if r:
        return r, 'sur', 'lien'
    cible = reference.cle_titre(titre)
    meilleur, score = None, 0.0
    for ref in prod['refs']:
        if ref['canton'] != canton:
            continue
        s = difflib.SequenceMatcher(None, cible, reference.cle_titre(ref['title'])).ratio()
        if s > score:
            meilleur, score = ref, s
    if meilleur is not None and score >= SEUIL_PROBABLE:
        return meilleur, 'probable', f'titre voisin ({score:.2f})'
    return None, '', ''


def construire(config, contrat, prod, a, v, base, recolte, lex=None, noms_ctx=None):
    """Une proposition (dict) pour la ligne `a` (affaires) et `v` (verdicts), ou (None, raison)."""
    jetons_canton = {e['jeton'] for e in contrat['listes']['canton']}
    jetons_instr = {e['jeton'] for e in contrat['listes']['instrument']}
    titre = re.sub(r'\s+', ' ', a['title'] or '').strip()      # un titre tient sur une ligne
    if not titre:
        return None, 'titre absent'
    brut_aff = base.brut(f"affaire:{a['body_key']}:{a['external_id']}", a['empreinte']) or {}
    indice_type = None
    if a['body_key'] == 'CHE':      # « 21.498 n Iv.pa. <Nom>. <titre> » : titre seul (ni numéro ni nom d'auteur), l'abréviation indique le type
        titre, indice_type = corr.titre_federal(titre)
        if isinstance(brut_aff.get('title'), dict):
            propres = {lg: corr.titre_federal(s) for lg, s in brut_aff['title'].items() if isinstance(s, str)}
            brut_aff = dict(brut_aff, title={lg: p[0] for lg, p in propres.items()})
            indice_type = indice_type or next((p[1] for p in propres.values() if p[1]), None)
        elif isinstance(brut_aff.get('title'), str):
            brut_aff = dict(brut_aff, title=corr.titre_federal(brut_aff['title'])[0])
        if not titre:
            return None, 'titre absent'
    else:       # un titre cantonal ou communal qui cite une référence fédérale : sans le nom de l'auteur
        titre = corr.sans_reference_federale(titre)
        bt = brut_aff.get('title')
        if isinstance(bt, dict):
            brut_aff = dict(brut_aff, title={lg: corr.sans_reference_federale(s) if isinstance(s, str) else s for lg, s in bt.items()})
        elif isinstance(bt, str):
            brut_aff = dict(brut_aff, title=corr.sans_reference_federale(bt))
    titre = corr.sans_personnes(titre)       # ni auteur, ni signataire, ni élu dans le titre ni dans le brut
    bt = brut_aff.get('title')
    if isinstance(bt, dict):
        brut_aff = dict(brut_aff, title={lg: corr.sans_personnes(s) if isinstance(s, str) else s for lg, s in bt.items()})
    elif isinstance(bt, str):
        brut_aff = dict(brut_aff, title=corr.sans_personnes(bt))
    if not titre:
        return None, 'titre absent'
    doutes, valeurs = [], {'title': titre}

    canton = corr.canton_de(a['body_key'], config)
    if canton in jetons_canton:
        valeurs['canton'] = canton
    else:
        doutes.append(_doute('canton', 'valeur-hors-liste', f"corps « {a['body_key']} » absent de la liste canton"))

    tn = a['type_name']
    try:
        tn = json.loads(tn) if isinstance(tn, str) else tn
    except ValueError:
        pass
    harm = a['type_harmonized_id']
    lu = lu_dans_les_documents(config, base, a, lex)
    if lu['type_corrige']:      # BL « Vorlage » : le type vrai est dans le document (`Geschäftstyp:`)
        harm, tn = lu['type_corrige']
        a = dict(a, type_harmonized_id=harm, type_name=tn)
    t = corr.type_effectif(a['body_key'], a['number'], tn, harm)
    if indice_type in jetons_instr and (t['jeton'] != indice_type):
        t = dict(t, jeton=indice_type, a_confirmer=False)      # l'abréviation du titre vaut mieux qu'un type générique de l'export
    if t['jeton'] is None:
        doutes.append(_doute('categorie', 'correspondance-incertaine',
                             f"aucun jeton `instrument` pour « {t['libelle'] or 'type inconnu'} »"))
    elif t['jeton'] not in jetons_instr:
        doutes.append(_doute('categorie', 'valeur-hors-liste', f"jeton « {t['jeton']} » absent de la liste instrument"))
    else:
        valeurs['categorie'] = t['jeton']
        if t['a_confirmer']:
            doutes.append(_doute('categorie', 'correspondance-incertaine', f"type « {t['libelle']} » : jeton à confirmer"))

    numero = (a['number'] or '').strip()
    if re.search(r'\b(null|none)\b', numero, re.I):
        numero = ''                                           # « V null » : la source n'a pas de numéro
    if numero:
        valeurs['numero'] = numero
    else:
        doutes.append(_doute('numero', 'champ-introuvable', 'numéro absent de la source'))

    brut_date = next((str(brut_aff[c]) for c in CHAMPS_DATE if brut_aff.get(c)), a['date_depot'] or '')
    date, doute = lire_date(brut_date)
    if date:
        valeurs['date'] = date
    if doute:
        doutes.append(doute)

    lien = a['url_oparl'] or a['url_externe'] or ''
    if lien.startswith(('http://', 'https://')):
        valeurs['lien'] = lien
    else:
        doutes.append(_doute('lien', 'champ-introuvable', 'aucun lien utilisable'))
    valeurs['source'] = SOURCE

    if titre.endswith(('…', '...')):
        doutes.append(_doute('title', 'texte-tronque', 'le titre de la source paraît coupé'))

    titres = corr.titres_multilingues(a['body_key'], (brut_aff or {}).get('title'))
    if titres:        # FORMAT-PROPOSITIONS.md « Une proposition pour les deux revues » : `langues` et `titres`, ni `langue` ni `valeurs.title`
        del valeurs['title']
        langue = None
    else:
        langue, devinee, detail = corr.langue_proposition(a['body_key'], canton, _titre_brut(brut_aff, titre),
                                                          lu['langue_document'])
        if devinee:
            doutes.append(_doute('langue', 'langue-devinee', detail))

    fiche, certitude, methode = chercher_doublon(prod, canton, numero, titre, lien)
    if certitude == 'sur':
        return None, f"doublon sûr ({methode}) : {fiche['slug']}"
    doublon = {'uuid': fiche['uuid'], 'slug': fiche['slug'], 'certitude': 'probable'} if fiche else None

    # brut : une clé porte le nom du champ du contrat qu'elle éclaire (le cockpit pose la valeur lue à côté du
    # champ) ; un champ introuvable n'y laisse rien. Les clés sans champ sont libres.
    brut_champs = {'title': _titre_brut(brut_aff, titre), 'canton': a['body_key'],
                   'type_harmonized_id': a['type_harmonized_id']}
    if tn:
        brut_champs['categorie'] = tn
    if numero:
        brut_champs['numero'] = a['number']
    if brut_date:
        brut_champs['date'] = brut_date
    if lien:
        brut_champs['lien'] = lien

    p = {'format': FORMAT, 'cle': cle_de(a['body_key'], a['external_id']), 'moissonneur': MOISSONNEUR,
         'type': TYPE}
    if titres:
        p['langues'], p['titres'] = ['fr', 'de'], titres
    else:
        p['langue'] = langue
    p.update({'recolte': recolte, 'lien_source': a['url_externe'] or a['url_oparl'] or '',
              'valeurs': valeurs, 'doutes': doutes, 'brut': brut_champs,
              'pertinence': {'verdict': v['verdict'], 'raison': v['raison']}, 'doublon': doublon})
    if noms_ctx is not None:   # contrôle indépendant des règles de coupe : un nom d'auteur non coupé retient la ligne, un nom possible la signale
        defauts, possibles = noms.analyser(_textes_titre(p), noms_ctx)
        if defauts:
            return None, RAISON_NOM + ' : ' + ' ; '.join(noms.masque(s) for s in defauts)
        if possibles:
            doutes.append(_doute('title', 'personne-nommee',
                                 'nom de personne possible dans le titre : ' + ' ; '.join(noms.masque(s) for s in possibles[:3])))
    if lex is not None and lu['finesse']:      # finesse : score par bandes, catégorie, termes avec note_sans
        p['pertinence'].update(lu['finesse'])
    if lu['texte']:
        p['texte_depose'] = lu['texte']
    return p, ''


def lu_dans_les_documents(config, base, a, lex=None):
    """Ce que la proposition tire des documents : {type_corrige, langue_document, finesse, texte}.

    Une affaire figée (son texte est resté au poste de développement) le rend tel qu'il a été calculé là-bas, par cette
    même fonction : le lot sort identique sur les deux postes."""
    fige = base.donnees_figees('figees', a['body_key'], a['external_id'])
    if fige is not None:
        return {'type_corrige': fige.get('type_corrige'), 'langue_document': fige.get('langue_document') or '',
                'finesse': fige.get('finesse') if lex is not None else None, 'texte': fige.get('texte') or ''}
    docs = [dict(d) for d in base.c.execute('SELECT nom, langue, texte FROM documents WHERE body_key=? AND id_api=? '
                                            'ORDER BY doc_id', (a['body_key'], a['id_api']))]
    corrige = None
    if a['body_key'] == 'BL' and a['type_harmonized_id'] == 9:
        corrige = corr.type_corrige('BL', 9, '\n'.join(d['texte'] for d in docs if d['texte']))
        if corrige:
            a = dict(a, type_harmonized_id=corrige[0], type_name=corrige[1])
    fin = finesse.evaluer(lex, config, base, a) if lex is not None else None
    return {'type_corrige': list(corrige) if corrige else None, 'langue_document': docs[0]['langue'] if docs else '',
            'finesse': fin, 'texte': texte.texte_depose(docs, a['body_key'], a['title'] or '')}


def _textes_titre(p):
    """Tous les textes de titre d'une proposition : valeurs.title, titres par langue, brut.title."""
    textes = [p['valeurs']['title']] if p['valeurs'].get('title') else []
    textes += list((p.get('titres') or {}).values())
    b = (p.get('brut') or {}).get('title')
    textes += [s for s in (b.values() if isinstance(b, dict) else [b]) if isinstance(s, str)]
    return textes


def contexte_noms(base):
    """Listes blanches tirées des titres de la base (voir noms.py), réunies à celles que le poste de développement a
    figées sur tous les titres : un titre en plus ne fait qu'allonger une liste, l'union reste donc sous le calcul complet."""
    titres = [r[0] for r in base.c.execute('SELECT title FROM affaires WHERE title IS NOT NULL')]
    ctx = noms.contexte_de(titres, lambda t: corr.sans_personnes(corr.sans_reference_federale(t)))
    fige = base.fige('noms')
    if not fige:
        return ctx
    return noms.Contexte(set(ctx.blanche) | set(fige['blanche']), set(ctx.dure) | set(fige['dure']),
                         frozenset(ctx.lieux) | frozenset(fige['lieux']))


def exporter(config, base, maintenant=None, a_blanc=False):
    """Écrit un lot de propositions. Rend {'lot': chemin | None, 'ecrites': n, 'ecartees': [(clé affaire, raison)]}.

    `maintenant` : horodatage ISO UTC (tests). Aucun lot vide n'est écrit. `a_blanc` : ni lot ni marque en base ;
    `lot_prevu` dit le nom qu'il aurait pris.
    """
    with open(config["bibliotheque"]["contrat"], encoding="utf-8") as f:
        contrat = json.load(f)
    recolte = maintenant or utc_maintenant()
    dossier = config['sortie']['propositions']
    decidees = decisions.appliquer(config['sortie'].get('decisions'), base)
    prod = _production(config)
    mini = config['criblage'].get('date_min_fiche', '')
    deja = {r['cle']: r['empreinte'] for r in base.c.execute('SELECT cle, empreinte FROM propositions')}
    lignes, ecartees, ecrites = [], [], []
    autorises = verdicts_exportes(config)
    lex = lexique.charger() if (config.get('export') or {}).get('finesse') else None
    ctx_noms = contexte_noms(base)
    hors_filtre = hors_arriere = 0
    # Premier lot : aucune proposition n'a jamais été écrite (la table survit à la purge des fichiers de lot).
    n_arriere = arriere_a_relire_mois(config)
    limite_arriere = ''
    if n_arriere and base.c.execute('SELECT 1 FROM propositions LIMIT 1').fetchone() is None:
        limite_arriere = moins_mois(datetime.date.fromisoformat(recolte[:10]), n_arriere).isoformat()
    for r in base.c.execute(
            """SELECT a.*, v.verdict, v.raison FROM verdicts v JOIN affaires a
               ON a.body_key=v.body_key AND a.external_id=v.external_id
               WHERE v.verdict IN ('retenu','a-relire') ORDER BY a.body_key, a.external_id""").fetchall():
        a = dict(r)
        cle = cle_de(a['body_key'], a['external_id'])
        court = f"{a['body_key']}/{a['external_id']}"
        if cle in decidees:
            ecartees.append((court, 'déjà décidée par la rédaction'))
            continue
        if deja.get(cle) == a['empreinte']:
            continue                                   # inchangée depuis son dernier lot
        if avant_date_min(a['date_depot'], mini):
            ecartees.append((court, f'déposée avant {mini}'))
            continue
        if a['verdict'] not in autorises:
            hors_filtre += 1          # reste en base, jamais marquée exportée : elle pourra partir plus tard
            continue
        if limite_arriere and a['verdict'] == 'a-relire' and avant_date_min(a['date_depot'], limite_arriere):
            hors_arriere += 1         # arriéré du premier lot : classée, sans proposition, elle pourra partir plus tard
            continue
        try:
            p, raison = construire(config, contrat, prod, a, {'verdict': a['verdict'], 'raison': a['raison']}, base, recolte, lex, ctx_noms)
        except Exception as e:  # une affaire illisible est écartée, jamais le lot
            p, raison = None, f'{type(e).__name__}: {e}'
        if p is None:
            ecartees.append((court, raison))
            continue
        lignes.append(p)
        ecrites.append((cle, a['empreinte']))
    chemin = None
    lots_connus = [r['lot'] for r in base.c.execute('SELECT DISTINCT lot FROM propositions')]
    lot_prevu = os.path.basename(_nom_lot(dossier, recolte[:10], lots_connus)) if lignes else ''
    if lignes and not a_blanc:
        chemin = commun.ecrire_lot(dossier, recolte[:10], lignes, lots_connus)
        for cle, emp in ecrites:
            base.c.execute('INSERT OR REPLACE INTO propositions(cle, empreinte, lot, ecrit_le) VALUES (?,?,?,?)',
                           (cle, emp, os.path.basename(chemin), horodatage()))
    base.commit()
    return {'lot': chemin, 'ecrites': 0 if a_blanc else len(lignes), 'prevues': len(lignes), 'lot_prevu': lot_prevu,
            'ecartees': ecartees, 'hors_lot_filtre': hors_filtre,
            'hors_lot_arriere': hors_arriere,
            'controle_noms': {'defauts': sum(1 for _, r in ecartees if r.startswith(RAISON_NOM)),
                              'lignes_avec_doute': sum(1 for p in lignes if any(d['code'] == 'personne-nommee' for d in p['doutes']))},
            'par_verdict': {v: sum(1 for p in lignes if p['pertinence']['verdict'] == v) for v in ('retenu', 'a-relire')}}


class ConfigurationExport(Exception):
    """`[export] verdicts` contient une valeur inconnue : configuration invalide (code 2)."""


def verdicts_exportes(config):
    """Verdicts qui partent en proposition (`[export] verdicts`). Absent ou vide : ('retenu',).

    Filtre temporaire : les autres restent classés en base sans proposition écrite.
    """
    liste = (config.get('export') or {}).get('verdicts') or ['retenu']
    inconnus = [v for v in liste if v not in ('retenu', 'a-relire')]
    if inconnus:
        raise ConfigurationExport(f"[export] verdicts : valeur inconnue {inconnus!r} (attendu : retenu, a-relire)")
    return tuple(dict.fromkeys(liste))


def arriere_a_relire_mois(config):
    """`[export] arriere_a_relire_mois` : nombre de mois de profondeur des « à relire » au premier lot (0 : pas de limite)."""
    v = (config.get('export') or {}).get('arriere_a_relire_mois', 0)
    if isinstance(v, bool) or not isinstance(v, int) or v < 0:
        raise ConfigurationExport(f"[export] arriere_a_relire_mois : entier positif attendu, reçu {v!r}")
    return v
