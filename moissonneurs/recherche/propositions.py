"""Propositions `pronto-proposition/1` (docs/FORMAT-PROPOSITIONS.md du dépôt) : un lot JSONL par exécution, écrit sous
un nom temporaire puis renommé. Un hors-sujet, un doublon sûr de la bibliothèque et une `cle` décidée ne partent jamais."""
import datetime
import json
import os
import re

import commun

from . import db, decisions, institutions, kirby, personnes
from .dates import couper_duree, fin_ouverte, lire_date_partielle, valide
from .nettoyage import retirer_balisage

FORMAT = 'pronto-proposition/1'
MOISSONNEUR = 'recherche'
TYPE = 'recherche'
LANGUES = ('fr', 'de')
CODES_DOUTE = ('date-illisible', 'langue-devinee', 'correspondance-incertaine', 'valeur-hors-liste', 'champ-introuvable',
               'texte-tronque', 'personne-nommee')
# Sources dont les partenaires viennent de couples « personne, institution » : la liste en base se renettoie à l'export.
ECOLES = {'site:phbern': 'Pädagogische Hochschule Bern', 'site:phfhnw': 'Pädagogische Hochschule FHNW'}
LIBELLES = {'title': 'le titre', 'institutions': 'les institutions'}


class ConfigurationInvalide(Exception):
    """Un réglage empêche toute exécution (code 2)."""


def verifier_config(config):
    if config.get('langue_par_defaut', 'de') not in LANGUES:
        raise ConfigurationInvalide(f"langue_par_defaut : fr ou de attendu, reçu {config.get('langue_par_defaut')!r}")
    # La base n'en est pas : la passe mensuelle n'en a pas, elle travaille sur l'état partagé chargé en mémoire.
    for cle in ('propositions', 'bibliotheque'):
        if not str(config.get(cle) or '').strip():
            raise ConfigurationInvalide(f'{cle} : chemin vide')


def cle_de(source, source_id):
    """`recherche:<source>:<identifiant>` : la source sans son préfixe « site: » (hfh, phbern…), l'identifiant de la
    source (n° de subside, n° SKBF, adresse de la page)."""
    jeton = source.split(':', 1)[1] if source.startswith('site:') else source
    return f'{MOISSONNEUR}:{jeton}:{source_id}'


def utc_maintenant():
    return datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _doute(champ, code, detail, suggestion=''):
    assert code in CODES_DOUTE, code
    d = {'champ': champ, 'code': code, 'detail': detail}
    if suggestion:
        d['suggestion'] = suggestion
    return d


def _extra(ligne):
    try:
        return json.loads(ligne['extra'] or '{}')
    except ValueError:
        return {}


def index_bibliotheque(racine):
    """Index de la bibliothèque (lecture seule) : {'url': {lien normalisé: fiche}, 'titres': [(titre normalisé, fiche)]}."""
    index = {'url': {}, 'titres': []}
    for slug, _, champs in kirby.fiches_existantes(racine):
        fiche = {'slug': slug, 'uuid': (champs.get('uuid') or '').strip(), 'title': champs.get('title', '')}
        lien = champs.get('lien', '')
        if lien:
            index['url'].setdefault(db.normaliser_url(lien), fiche)
        index['titres'].append((db.normaliser_cle(fiche['title']), fiche))
    return index


# ---- Langue ------------------------------------------------------------------------------------------------------

_MOTS = {
    'fr': {'le', 'la', 'les', 'du', 'de', 'et', 'pour', 'dans', 'sur', 'une', 'un', 'aux', 'au', 'en', 'chez', 'entre',
           'avec', 'par', 'vers', 'ou', 'leur', 'leurs', 'd', 'l'},
    'de': {'und', 'der', 'die', 'das', 'von', 'zur', 'zum', 'im', 'für', 'bei', 'auf', 'mit', 'eine', 'ein', 'einer',
           'als', 'wie', 'nach', 'bis', 'den', 'dem', 'über', 'zwischen', 'durch', 'vom', 'am', 'zu'},
    'en': {'the', 'and', 'of', 'for', 'on', 'with', 'to', 'a', 'from', 'through', 'among', 'between', 'towards', 'its',
           'their', 'how', 'what', 'why', 'study'},
}
_ACCENTS = {'fr': re.compile(r'[éèêàçùûôîœ]'), 'de': re.compile(r'[äöüß]')}


def langue_titre(titre):
    """(langue, sûre) d'après les mots-outils et les accents du titre. Sûre : fr ou de, au moins deux indices, et
    trois fois plus que toute autre langue. Rend ('', False) sans aucun indice."""
    mots = re.findall(r"[^\W\d_]+", str(titre or '').lower())
    scores = {}
    for langue, outils in _MOTS.items():
        scores[langue] = sum(m in outils for m in mots)
        if langue in _ACCENTS:
            scores[langue] += sum(1 for m in mots if _ACCENTS[langue].search(m))
    meilleure = max(scores, key=lambda l: (scores[l], l == 'de'))
    if scores[meilleure] == 0:
        return '', False
    autres = max(v for l, v in scores.items() if l != meilleure)
    return meilleure, meilleure in LANGUES and scores[meilleure] >= 2 and scores[meilleure] >= 3 * autres


def langue_de(groupe, defaut):
    """(langue, doute | None) : la langue d'une page d'école, sinon celle d'un titre sûr, sinon, pour un titre ni fr
    ni de, celle d'un descriptif sûr, sinon `defaut` ; ces deux derniers cas avec le doute `langue-devinee`. Jamais
    vide, jamais deux langues."""
    for ligne in groupe:
        if ligne['source'].startswith('site:') and ligne['langue'] in LANGUES:
            return ligne['langue'], None
    for ligne in groupe:
        langue, sure = langue_titre(ligne['title'])
        if sure:
            return langue, None
    langue, _ = langue_titre(groupe[0]['title'])
    detail = 'titre en anglais' if langue == 'en' else 'langue du titre incertaine'
    if langue not in LANGUES:       # titre ni fr ni de : repli sur un descriptif clairement fr ou de, toujours en doute
        for ligne in groupe:
            l_desc, sure = langue_titre(str(ligne['descriptif'] or '')[:600])
            if sure:
                return l_desc, _doute('langue', 'langue-devinee', f'{detail} : langue du descriptif retenue')
    return defaut, _doute('langue', 'langue-devinee', f'{detail} : langue par défaut retenue')


# ---- Pertinence --------------------------------------------------------------------------------------------------

def verdict(pertinence, config_filtre):
    """{'verdict', 'raison'} : `retenu` par le filtre, `a-relire` quand seul un mot courant du titre (`mots_titre`) l'a
    fait entrer."""
    pertinence = (pertinence or '').strip()
    if pertinence == 'institution':
        return {'verdict': 'retenu', 'raison': 'institution toujours retenue'}
    mots = [m.strip() for m in pertinence.split(',') if m.strip()]
    titre_seul = set(config_filtre.get('mots_titre', []))
    if mots and all(m in titre_seul for m in mots):
        return {'verdict': 'a-relire', 'raison': 'seulement un mot courant du titre : ' + ', '.join(mots)}
    return {'verdict': 'retenu', 'raison': ('mots du filtre : ' + ', '.join(mots)) if mots else 'retenu par le filtre'}


# ---- Regroupement ------------------------------------------------------------------------------------------------

def meme_projet(a, b):
    """Deux lignes de la base décrivent le même projet : même lien, ou titres rapprochés « sur »."""
    ua, ub = db.normaliser_url(a['url']), db.normaliser_url(b['url'])
    return bool(ua and ua == ub) or db.rapprocher_titres(a['cle'], b['cle']) == 'sur'


def grouper(lignes):
    """Groupes de lignes qui décrivent le même projet (fermeture transitive de meme_projet), dans l'ordre des id."""
    parent = list(range(len(lignes)))

    def racine(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(lignes)):
        for j in range(i + 1, len(lignes)):
            if meme_projet(lignes[i], lignes[j]):
                parent[racine(j)] = racine(i)
    groupes = {}
    for i, ligne in enumerate(lignes):
        groupes.setdefault(racine(i), []).append(ligne)
    return sorted(groupes.values(), key=lambda g: min(l['id'] for l in g))


def _premier_connu(ligne):
    return (ligne['premiere_vue'], ligne['id'])


def cle_du_groupe(groupe):
    """La cle déjà posée sur un membre, sinon celle du premier membre connu (premiere_vue, puis id)."""
    for ligne in sorted(groupe, key=_premier_connu):
        if ligne['cle_proposition']:
            return ligne['cle_proposition']
    premier = min(groupe, key=_premier_connu)
    return cle_de(premier['source'], premier['source_id'])


# ---- Une proposition ---------------------------------------------------------------------------------------------

def _dates_brutes(ligne):
    """(début, fin) tels que lus : *_brut de la source s'il existe, sinon la base ; une durée entière gardée dans
    `debut` (bases d'avant la correction PH FHNW) est coupée en deux."""
    ex = _extra(ligne)
    debut = str(ex.get('debut_brut') or ligne['debut'] or '').strip()
    fin = str(ex.get('fin_brut') or ligne['fin'] or '').strip()
    if debut and not valide(debut) and not fin:
        a, b = couper_duree(debut)
        if b or a != debut:
            debut, fin = a, b
    return debut, fin


def _institutions(ligne):
    """(valeur, nombre de partenaires retirés) : la liste de la base, renettoyée pour PHBern et PH FHNW."""
    valeur = ' '.join(str(ligne['institutions'] or '').split())
    retirees = int(_extra(ligne).get('institutions_retirees') or 0)
    ecole = ECOLES.get(ligne['source'])
    if ecole:
        valeur, autres = institutions.nettoyer_liste(valeur, ecole)
        retirees += len(autres)
    return valeur, retirees


def construire(groupe, cle, config, index, recolte):
    """(proposition, '', principal) ou (None, raison, principal). Le principal est la page d'une école de préférence ;
    les champs qu'il n'a pas viennent des autres membres."""
    ordre = sorted(groupe, key=lambda l: (0 if l['source'].startswith('site:') else 1, l['id']))
    principal = ordre[0]
    titre = ' '.join(str(principal['title'] or '').split())
    if not titre:
        return None, 'titre absent', principal

    for ligne in ordre:
        fiche, niveau = db.chercher_dans_index(index, ligne['cle'], ligne['url'])
        if niveau == 'sur':
            return None, f"doublon sûr de la bibliothèque : {fiche['slug']}", principal
    fiche, niveau = db.chercher_dans_index(index, principal['cle'], principal['url'])

    valeurs, doutes, brut = {'title': titre}, [], {'title': principal['title']}

    source_inst = next((l for l in ordre if (l['institutions'] or '').strip()), principal)
    inst, retirees = _institutions(source_inst)
    if inst:
        valeurs['institutions'] = brut['institutions'] = inst
        if retirees and inst == ECOLES.get(source_inst['source']):
            doutes.append(_doute('institutions', 'champ-introuvable',
                                 "partenaires de la source non reconnus comme institutions, retirés : seule l'école reste"))
    else:
        doutes.append(_doute('institutions', 'champ-introuvable', 'la source ne nomme aucune institution'))

    source_dates = next((l for l in ordre if any(_dates_brutes(l))), principal)
    debut_brut, fin_brut = _dates_brutes(source_dates)
    for champ, lu in (('debut', debut_brut), ('fin', fin_brut)):
        if not lu or (champ == 'fin' and fin_ouverte(lu)):
            continue
        brut[champ] = lu
        valeur, suggestion = lire_date_partielle(lu)
        if valeur:
            valeurs[champ] = valeur
        else:
            doutes.append(_doute(champ, 'date-illisible',
                                 f'forme non reconnue (AAAA, AAAA-MM ou AAAA-MM-JJ attendu) ; valeur lue dans brut.{champ}',
                                 suggestion))
    if not debut_brut and not fin_brut:
        doutes.append(_doute('debut', 'champ-introuvable', 'la source ne donne pas de durée'))
        doutes.append(_doute('fin', 'champ-introuvable', 'la source ne donne pas de durée'))
    elif not debut_brut:
        doutes.append(_doute('debut', 'champ-introuvable', 'la source ne donne pas de début'))

    if principal['url'].startswith(('http://', 'https://')):
        valeurs['lien'] = brut['lien'] = principal['url']

    # Le descriptif est repris tel que la source le donne, noms compris : la rédaction le reformule.
    # Le balisage qui n'est pas du texte (CSS de Word…) est retiré, y compris des bases déjà remplies.
    descriptif = next((d for d in (retirer_balisage(l['descriptif'] or '') for l in ordre) if d.strip()), '')
    if descriptif:
        valeurs['descriptif'] = brut['descriptif'] = descriptif
    else:
        doutes.append(_doute('descriptif', 'champ-introuvable', 'la source ne donne aucun résumé'))

    for champ in ('title', 'institutions'):
        noms = personnes.noms_possibles(valeurs.get(champ, ''))
        if noms:
            doutes.append(_doute(champ, 'personne-nommee', f'nom de personne possible dans {LIBELLES[champ]} : '
                                 + ' ; '.join(personnes.masque(n) for n in noms[:3])))

    langue, doute = langue_de(ordre, config.get('langue_par_defaut', 'de'))
    if doute:
        doutes.append(doute)
    brut['source'] = principal['source']
    if principal['langue']:
        brut['langue'] = principal['langue']
    if len(ordre) > 1:
        brut['autres_sources'] = [{'source': l['source'], 'lien': l['url']} for l in ordre[1:]]

    verdicts = [verdict(l['pertinence'], config.get('filtre', {})) for l in ordre]
    pertinence = next((v for v in verdicts if v['verdict'] == 'retenu'), verdicts[0])

    lien_source = _extra(principal).get('lien_skbf') or principal['url']
    p = {'format': FORMAT, 'cle': cle, 'moissonneur': MOISSONNEUR, 'type': TYPE, 'langue': langue, 'recolte': recolte,
         'lien_source': lien_source, 'valeurs': valeurs, 'doutes': doutes, 'brut': brut, 'pertinence': pertinence,
         'doublon': {'uuid': fiche['uuid'], 'slug': fiche['slug'], 'certitude': 'probable'} if niveau == 'probable' else None}
    return p, '', principal


# ---- Le lot : nom et écriture dans commun.py ---------------------------------------------------------------------

_nom_lot, ecrire_lot = commun.nom_lot, commun.ecrire_lot


def exporter(config, con, maintenant=None, a_blanc=False):
    """Écrit un lot des projets `nouveau`, après la migration des anciens `exporte` et la relecture des décisions.

    a_blanc : ni lot écrit ni statut changé ; `prevues` et `lot_prevu` disent ce qui serait parti.

    Un projet `sur` d'un groupe déjà proposé s'y rattache (`doublon`, même cle) sans repartir. Aucun lot vide. Rend
    {'lot', 'ecrites', 'decidees', 'existants', 'rattaches', 'ecartees', 'par_source', 'par_verdict', 'doutes',
    'migration', 'prevues', 'lot_prevu'}."""
    verifier_config(config)
    recolte = maintenant or utc_maintenant()
    index = index_bibliotheque(config['bibliotheque'])
    migration = db.migrer_exportes(con, index)
    decidees = decisions.appliquer(config.get('decisions'), con)

    connus = con.execute("SELECT * FROM projets WHERE cle_proposition != '' AND statut IN ('propose', 'doublon')").fetchall()
    libres, rattaches = [], []
    for ligne in con.execute("SELECT * FROM projets WHERE statut = 'nouveau' ORDER BY id").fetchall():
        cible = next((k for k in connus if meme_projet(ligne, k)), None)
        if cible is not None:
            rattaches.append((ligne, cible['cle_proposition']))
        else:
            libres.append(ligne)

    lignes, a_marquer, existants, ecartees, n_decidees = [], [], [], [], 0
    for groupe in grouper(libres):
        cle = cle_du_groupe(groupe)
        if cle in decidees:
            n_decidees += 1
            continue
        p, raison, principal = construire(groupe, cle, config, index, recolte)
        if p is None:
            if raison.startswith('doublon sûr'):
                existants += groupe
            else:
                ecartees.append((cle, raison))
            continue
        lignes.append(p)
        a_marquer.append((groupe, cle, principal['id']))

    lots_connus = [r[0] for r in con.execute("SELECT DISTINCT lot FROM projets WHERE lot != ''")]
    lot_prevu = os.path.basename(_nom_lot(config['propositions'], recolte[:10], lots_connus)) if lignes else ''
    if a_blanc:
        return _bilan(lignes, None, n_decidees, existants, rattaches, ecartees, migration, lot_prevu)
    chemin = ecrire_lot(config['propositions'], recolte[:10], lignes, lots_connus) if lignes else None
    lot = os.path.basename(chemin) if chemin else ''
    for ligne, cle in rattaches:
        db.marquer_proposition(con, ligne['id'], 'doublon', cle)
    for ligne in existants:
        db.changer_statut(con, ligne['id'], 'existant')
    for groupe, cle, id_principal in a_marquer:
        for ligne in groupe:
            db.marquer_proposition(con, ligne['id'], 'propose' if ligne['id'] == id_principal else 'doublon', cle, lot)
    con.commit()
    return _bilan(lignes, chemin, n_decidees, existants, rattaches, ecartees, migration, lot_prevu)


def _bilan(lignes, chemin, n_decidees, existants, rattaches, ecartees, migration, lot_prevu):
    par_source, doutes = {}, {}
    for p in lignes:
        par_source[p['brut']['source']] = par_source.get(p['brut']['source'], 0) + 1
        for d in p['doutes']:
            doutes[d['code']] = doutes.get(d['code'], 0) + 1
    return {'lot': chemin, 'ecrites': len(lignes) if chemin else 0, 'prevues': len(lignes), 'lot_prevu': lot_prevu,
            'decidees': n_decidees, 'existants': len(existants),
            'rattaches': len(rattaches), 'ecartees': ecartees, 'par_source': par_source,
            'par_verdict': {v: sum(1 for p in lignes if p['pertinence']['verdict'] == v) for v in ('retenu', 'a-relire')},
            'doutes': doutes, 'migration': migration}
