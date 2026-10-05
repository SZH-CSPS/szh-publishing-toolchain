"""Aides communes aux tests : un Reseau branché sur des fixtures, sans réseau."""
import os

from parlement.reseau import Reseau

FIXTURES = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixtures')


def fixture(nom):
    with open(os.path.join(FIXTURES, nom), 'rb') as f:
        return f.read()


class Serveur:
    """Rend une réponse selon un motif présent dans l'URL ; garde la trace des appels."""
    def __init__(self, routes):
        self.routes = routes     # liste de (motif, code, nom de fixture | octets | exception)
        self.urls = []

    def __call__(self, url, en_tetes):
        self.urls.append(url)
        for motif, code, corps in self.routes:
            if motif in url:
                if isinstance(corps, Exception):
                    raise corps
                if isinstance(corps, str):
                    corps = fixture(corps)
                return code, {}, corps
        return 404, {}, b''


def reseau_factice(routes, tmp, **kw):
    cfg = {'delai': 0.0, 'budget': kw.pop('budget', 1000), 'cache': os.path.join(tmp, 'cache'),
           'journal': os.path.join(tmp, 'req.jsonl')}
    srv = Serveur(routes)
    return Reseau(cfg, ouvrir=srv, dormir=lambda s: None), srv


def config_test(tmp):
    return {'moisson': {'depuis': '2025-01-01', 'limite': 2, 'confederation': 'CHE',
                        'cantons': ['GE', 'VD']},
            'reseau': {'base': 'https://api.example.invalid/v1'},
            'criblage': {'scope': 'all', 'limite': 2, 'date_min_fiche': '2025-01-01'},
            'villes': {'suivies': []}}


class SourceFictive:
    """Source en mémoire : mêmes méthodes que parlement.sources.openparldata, sans HTTP."""
    def __init__(self, affaires=None, recherche=None, docs=None, totaux=None, erreurs=None):
        self.affaires = affaires or {}      # corps -> [Affaire]
        self.recherche = recherche or {}    # terme -> [Affaire]
        self.docs = docs or {}              # id_api -> [dict de document]
        self.totaux = totaux or {}          # (terme, langue) -> int
        self.erreurs = erreurs or {}        # corps -> Exception
        self.appels_docs = []

    @staticmethod
    def localiser(v):
        return v if isinstance(v, str) else (v or '')

    def moissonner(self, config, reseau, connus, corps=None, repere=None, depuis='', etat=None):
        reseau.requetes += 1
        for i, a in enumerate(self.affaires.get(corps, [])):
            yield a
            if corps in self.erreurs and i == 0:
                raise self.erreurs[corps]
            if etat is not None and a.updated_at > etat.get('max_updated', ''):
                etat['max_updated'] = a.updated_at

    def rechercher(self, config, reseau, terme, langue, depuis='', etat=None, cache=True):
        reseau.requetes += 1
        if etat is not None:
            etat['total'] = self.totaux.get((terme, langue), len(self.recherche.get(terme, [])))
        yield from self.recherche.get(terme, [])

    def total_recherche(self, config, reseau, terme, langue):
        reseau.requetes += 1
        return self.totaux.get((terme, langue))

    def documents(self, config, reseau, id_api):
        reseau.requetes += 1
        self.appels_docs.append(id_api)
        d = self.docs.get(id_api, [])
        return {'data': d}, d


def config_pipeline(tmp):
    import os
    c = config_test(tmp)
    c['reseau'].update({'delai': 0.0, 'budget': 1000,
                        'cache': os.path.join(tmp, 'cache'), 'journal': os.path.join(tmp, 'req.jsonl')})
    c['moisson'].update({'cantons': ['GE', 'ZH']})
    c['stockage'] = {'base': os.path.join(tmp, 'donnees', 'p.sqlite')}
    c['sortie'] = {'dossier': os.path.join(tmp, 'sortie'), 'sauvegardes': os.path.join(tmp, 'sortie', 'sauvegardes'),
                   'propositions': os.path.join(tmp, 'sortie', 'propositions', 'parlement'),
                   'decisions': os.path.join(tmp, 'decisions')}
    c['bibliotheque'] = {'fiches': os.path.join(tmp, 'prod'), 'contrat': os.path.join(FIXTURES, 'contrat-min.json')}
    c['export'] = {'verdicts': ['retenu', 'a-relire']}      # les tests existants exportent les deux ; le défaut réel est ["retenu"]
    return c


def ecrire_fiche_prod(racine, slug, titre, uuid='U' * 16, langue='de', **champs):
    """Fiche de la bibliothèque de production, fabriquée pour un test (aucune donnée réelle)."""
    dossier = os.path.join(racine, 'vorstoesse', slug)
    os.makedirs(dossier, exist_ok=True)
    corps = [('Title', titre), ('Uuid', uuid), ('Ausgabe', '')] + [(k.capitalize(), v) for k, v in champs.items() if v]
    with open(os.path.join(dossier, f'intervention.{langue}.txt'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n\n----\n\n'.join(f'{k}: {v}' for k, v in corps) + '\n')
