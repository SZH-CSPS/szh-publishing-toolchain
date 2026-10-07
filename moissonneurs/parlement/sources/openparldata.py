"""Source OpenParlData.ch (api.openparldata.ch/v1, CC BY 4.0). Seul module qui connaît ses champs.

Les champs que l'API ne documente pas clairement (date de dépôt, listes enveloppées) sont lus avec des replis,
établis sur des réponses réelles. Voir moissonneurs/LISEZMOI.md.
"""
from dataclasses import dataclass, field

from ..reseau import construire_url

LANGUES = ('de', 'fr', 'it', 'rm', 'en')
# Champs possibles de la date de dépôt, par ordre de préférence.
LIMITE_MENSUELLE = 50          # taille des pages de la passe mensuelle (`[mensuelle] limite`)
CHAMPS_DATE = ('begin_date', 'date', 'submitted_at', 'start_date', 'created_date')


@dataclass
class Affaire:
    body_key: str
    external_id: str
    id_api: str = ''
    number: str = ''
    title: str = ''
    type_name: object = None
    type_harmonized_id: object = None
    date_depot: str = ''
    updated_at: str = ''
    url_externe: str = ''
    url_oparl: str = ''
    brut: dict = field(default_factory=dict)


def localiser(valeur, preferences=('fr', 'de', 'it', 'en', 'rm')):
    """Texte d'un champ qui peut être une chaîne ou un dict {langue: texte}."""
    if valeur is None:
        return ''
    if isinstance(valeur, str):
        return valeur
    if isinstance(valeur, dict):
        for lang in preferences:
            if valeur.get(lang):
                return str(valeur[lang])
        for v in valeur.values():
            if v:
                return str(v)
        return ''
    return str(valeur)


def extraire_liste(payload):
    """La liste d'enregistrements d'une réponse, enveloppée ou non."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for cle in ('data', 'results', 'items'):
            if isinstance(payload.get(cle), list):
                return payload[cle]
    return []


def total_declare(payload):
    if isinstance(payload, dict):
        meta = payload.get('meta') or {}
        for cle in ('total_records', 'total', 'count'):
            if isinstance(meta.get(cle), int):
                return meta[cle]
    return None


def a_suite(payload, recus, limite):
    """Reste-t-il une page ? Se fie à `has_more` si l'API le donne, sinon à la page pleine."""
    if isinstance(payload, dict):
        meta = payload.get('meta') or {}
        if isinstance(meta.get('has_more'), bool):
            return meta['has_more']
    return recus >= limite


def vers_affaire(d, corps_defaut=''):
    """Un enregistrement JSON -> Affaire, ou None s'il manque l'identité (body_key + external_id)."""
    if not isinstance(d, dict):
        return None
    body_key = str(d.get('body_key') or corps_defaut or '').strip()
    ext = d.get('external_id')
    if not body_key or ext in (None, ''):
        return None
    date = ''
    for cle in CHAMPS_DATE:
        if d.get(cle):
            date = str(d[cle])[:10]
            break
    titre = localiser(d.get('title')) or localiser(d.get('title_long'))
    return Affaire(
        body_key=body_key, external_id=str(ext), id_api=str(d.get('id') or ''),
        number=str(d.get('number') or ''), title=titre.strip(),
        type_name=d.get('type_name'), type_harmonized_id=d.get('type_harmonized_id'),
        date_depot=date, updated_at=str(d.get('updated_at') or ''),
        url_externe=localiser(d.get('url_external') or d.get('url')).strip(),
        url_oparl=localiser(d.get('url_oparl')).strip(), brut=d)


def avant_depuis(date_depot, depuis):
    """Vrai si la date de dépôt (ISO) précède `depuis`. Une date absente ne fait jamais écarter l'affaire."""
    return bool(date_depot and date_depot[:10] < depuis)


def _page(config, reseau, chemin, params, cache):
    url = construire_url(config['reseau']['base'], chemin, params)
    return reseau.get_json(url, cache=cache)


def lister_corps(config, reseau):
    """[(body_key, nb_affaires)] d'après /affairs/group_by/body_key."""
    payload = _page(config, reseau, '/affairs/group_by/body_key', {}, True)
    sortie = []
    for ligne in extraire_liste(payload):
        cle = ligne.get('body_key') if isinstance(ligne, dict) else None
        if not cle:
            continue
        n = next((ligne[k] for k in ('count', 'n', 'total', 'affairs', 'total_records')
                  if isinstance(ligne.get(k), int)), None)
        sortie.append((str(cle), n))
    return sortie


def moissonner(config, reseau, connus, corps, repere=None, depuis='', etat=None):
    """Rend les affaires de `corps` par updated_at décroissant, jusqu'au repère (exclu) ou à `depuis`.

    `etat['max_updated']` reçoit le plus grand updated_at vu : le repère de la fois suivante.
    Sans repère (moisson initiale), les pages passent par le cache disque : un budget épuisé
    se reprend sans rien retélécharger. Avec un repère, elles sont toujours fraîches.
    """
    etat = etat if etat is not None else {}
    limite = int(config['moisson']['limite'])
    offset = 0
    initiale = repere is None
    # Mesuré (02.10.2026) : updated_at est rafraîchi en bloc sur d'anciennes affaires, donc inutilisable pour
    # borner la profondeur. Moisson initiale : tri par date de dépôt, arrêt au premier dépôt antérieur à `depuis`.
    # Moisson incrémentale : tri par mise à jour, arrêt au repère.
    tri = '-begin_date' if initiale else '-updated_at'
    while True:
        payload = _page(config, reseau, '/affairs/',
                        {'body_key': corps, 'sort_by': tri, 'limit': limite, 'offset': offset}, cache=initiale)
        lignes = extraire_liste(payload)
        for d in lignes:
            maj = str((d or {}).get('updated_at') or '') if isinstance(d, dict) else ''
            if not initiale and maj and maj < repere:
                return
            a = vers_affaire(d, corps)
            if a is None:
                continue
            if maj and maj > etat.get('max_updated', ''):
                etat['max_updated'] = maj
            if depuis and avant_depuis(a.date_depot, depuis):
                if initiale:
                    return        # trié par dépôt décroissant : tout ce qui suit est plus ancien
                continue
            yield a
        if not lignes or not a_suite(payload, len(lignes), limite):
            return
        offset += len(lignes)


def rechercher(config, reseau, terme, langue, depuis='', etat=None, cache=True):
    """Étage 1 : recherche plein texte côté serveur, tous corps. Rend des Affaire.

    `etat['total']` reçoit le total déclaré. Tri par date de dépôt ; s'arrête au premier dépôt antérieur à `depuis`.
    """
    etat = etat if etat is not None else {}
    limite = int(config['criblage']['limite'])
    offset = 0
    while True:
        payload = _page(config, reseau, '/affairs/',
                        {'search': terme, 'search_language': langue,
                         'search_scope': config['criblage']['scope'],
                         'sort_by': '-begin_date', 'limit': limite, 'offset': offset}, cache=cache)
        if offset == 0:
            etat['total'] = total_declare(payload)
        lignes = extraire_liste(payload)
        for d in lignes:
            a = vers_affaire(d)
            if a is None:
                continue
            if depuis and avant_depuis(a.date_depot, depuis):
                return            # trié par dépôt décroissant (les sans-date viennent en tête) : fin utile
            yield a
        if not lignes or not a_suite(payload, len(lignes), limite):
            return
        offset += len(lignes)


def total_recherche(config, reseau, terme, langue):
    """Total déclaré par le serveur pour une recherche (limite 1), ou None si l'enveloppe n'en donne pas."""
    payload = _page(config, reseau, '/affairs/',
                    {'search': terme, 'search_language': langue, 'search_scope': config['criblage']['scope'],
                     'limit': 1}, cache=True)
    return total_declare(payload)


def documents(config, reseau, id_api):
    """(charge brute, [dict de document]) pour /affairs/{id}/docs. Jamais retéléchargé (cache)."""
    payload = _page(config, reseau, f'/affairs/{id_api}/docs', {'limit': 200}, True)
    return payload, extraire_liste(payload)


def moissonner_depot(config, reseau, connus, corps, repere_depot, etat=None):
    """Passe mensuelle d'un corps : affaires NOUVELLES par date de dépôt décroissante, pages toujours fraîches.

    Arrêt à la première affaire dont le dépôt est STRICTEMENT antérieur à `repere_depot` (la plus grande date de dépôt connue en
    base) : celles du jour du repère sont relues et ignorées si déjà connues. Les affaires sans date de dépôt viennent en tête :
    elles sont prises une fois si inconnues, ne comptent pas pour l'arrêt, et au plus une page entière en sert (deux pages de suite
    sans aucune date : arrêt, `etat['sans_date_plafonne']`). Sans repère de dépôt, rien n'est demandé.
    `etat` reçoit `pages`, `sans_date`, `sans_date_plafonne`."""
    etat = etat if etat is not None else {}
    etat.update({'pages': 0, 'sans_date': 0, 'sans_date_plafonne': False})
    if not repere_depot:
        return
    limite = int((config.get('mensuelle') or {}).get('limite', LIMITE_MENSUELLE))        # pages courtes : un corps s'arrête souvent à la première
    offset, pages_sans_date = 0, 0
    while True:
        payload = _page(config, reseau, '/affairs/', {'body_key': corps, 'sort_by': '-begin_date', 'limit': limite, 'offset': offset},
                        cache=False)
        etat['pages'] += 1
        lignes = extraire_liste(payload)
        affaires = [a for a in (vers_affaire(d, corps) for d in lignes) if a is not None]
        if affaires and not any(a.date_depot for a in affaires):
            pages_sans_date += 1
            if pages_sans_date >= 2:             # une page de sans-date suffit : la deuxième n'est pas traitée
                etat['sans_date_plafonne'] = True
                return
        for a in affaires:
            if not a.date_depot:
                if a.external_id not in connus:
                    etat['sans_date'] += 1
                    yield a
                continue
            if a.date_depot[:10] < repere_depot[:10]:
                return
            if a.external_id not in connus:
                yield a
        if not lignes or not a_suite(payload, len(lignes), limite):
            return
        offset += len(lignes)
