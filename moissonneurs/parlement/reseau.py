"""Client HTTP poli : une requête à la fois, délai, cache disque, budget ; anonyme par défaut.

Aucune dépendance hors bibliothèque standard. Voir LISEZMOI.md.
"""
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request

ESSAIS_MAX = 5
ATTENTE_MAX = 300


class BudgetEpuise(Exception):
    """Le budget de requêtes de l'exécution est atteint : arrêt propre, reprise la fois suivante."""


class ArretDemande(BudgetEpuise):
    """Le fichier de demande d'arrêt existe : même arrêt propre qu'au budget, avant la requête suivante."""


class CorpsAbandonne(Exception):
    """Cinq échecs d'affilée (429, 503, réseau) sur une même adresse : on abandonne le corps."""


class ErreurHTTP(Exception):
    def __init__(self, code, url):
        super().__init__(f'HTTP {code} : {url}')
        self.code = code
        self.url = url


class Acces403(ErreurHTTP):
    """403 : le serveur refuse. Arrêt de toute la moisson, à signaler."""


def construire_url(base, chemin, params=None):
    """Adresse complète. Les paramètres sont encodés en UTF-8 explicitement (piège n° 3)."""
    url = base.rstrip('/') + '/' + chemin.lstrip('/')
    if params:
        pairs = [(k, str(v)) for k, v in params.items() if v is not None]
        url += '?' + urllib.parse.urlencode(pairs, quote_via=urllib.parse.quote, encoding='utf-8')
    return url


class Reseau:
    def __init__(self, cfg, *, user_agent=None, ouvrir=None, dormir=None, horloge=None):
        """cfg : section [reseau] des réglages (delai, budget, cache, timeout, journal, arret).

        Sans user_agent, les requêtes partent anonymes : urllib met son en-tête par défaut. `arret` : fichier de demande
        d'arrêt, regardé avant chaque requête réelle.
        """
        self.fichier_arret = cfg.get('arret') or ''
        self.delai = float(cfg.get('delai', 2.0))
        self.budget = int(cfg.get('budget', 3000))
        self.timeout = float(cfg.get('timeout', 30))
        self.dossier_cache = cfg.get('cache')
        self.chemin_journal = cfg.get('journal')
        self.user_agent = user_agent
        self._ouvrir = ouvrir or self._ouvrir_urllib
        self._dormir = dormir or time.sleep
        self._horloge = horloge or time.monotonic
        self._dernier = None
        self._delai_courant = self.delai
        self.requetes = 0        # requêtes réellement émises (essais compris)
        self.depuis_cache = 0
        self.echecs = 0
        if self.dossier_cache:
            os.makedirs(self.dossier_cache, exist_ok=True)

    # -- bas niveau -----------------------------------------------------

    def _ouvrir_urllib(self, url, en_tetes):
        req = urllib.request.Request(url, headers=en_tetes)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as rep:
                return rep.status, dict(rep.headers), rep.read()
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers or {}), b''

    def _attendre(self):
        if self._dernier is not None:
            reste = self._delai_courant - (self._horloge() - self._dernier)
            if reste > 0:
                self._dormir(reste)
        self._dernier = self._horloge()

    def _journaliser(self, url, code, octets, cache):
        if not self.chemin_journal:
            return
        os.makedirs(os.path.dirname(self.chemin_journal) or '.', exist_ok=True)
        ligne = {'t': time.strftime('%Y-%m-%dT%H:%M:%S'), 'url': url, 'code': code,
                 'octets': octets, 'cache': cache}
        with open(self.chemin_journal, 'a', encoding='utf-8', newline='\n') as f:
            f.write(json.dumps(ligne, ensure_ascii=False) + '\n')

    def _chemin_cache(self, url):
        if not self.dossier_cache:
            return None
        return os.path.join(self.dossier_cache, hashlib.sha256(url.encode('utf-8')).hexdigest() + '.corps')

    # -- API publique ----------------------------------------------------

    def get(self, url, cache=True):
        """Octets du corps. cache=True : jamais retéléchargé une fois obtenu."""
        chemin = self._chemin_cache(url) if cache else None
        if chemin and os.path.exists(chemin):
            with open(chemin, 'rb') as f:
                corps = f.read()
            self.depuis_cache += 1
            self._journaliser(url, 200, len(corps), True)
            return corps
        for essai in range(1, ESSAIS_MAX + 1):
            if self.fichier_arret and os.path.exists(self.fichier_arret):
                raise ArretDemande('arrêt demandé')
            if self.requetes >= self.budget:
                raise BudgetEpuise(f'budget de {self.budget} requêtes atteint')
            self._attendre()
            self.requetes += 1
            en_tetes_requete = {'Accept': 'application/json, */*;q=0.5'}
            if self.user_agent:
                en_tetes_requete['User-Agent'] = self.user_agent
            try:
                code, en_tetes, corps = self._ouvrir(url, en_tetes_requete)
            except (urllib.error.URLError, OSError) as e:
                self.echecs += 1
                self._journaliser(url, 'reseau:' + type(e).__name__, 0, False)
                self._delai_courant = min(self._delai_courant * 2, 120)
                if essai == ESSAIS_MAX:
                    raise CorpsAbandonne(f'{url} : {e}') from e
                continue
            self._journaliser(url, code, len(corps), False)
            if code == 200:
                self._delai_courant = self.delai
                if chemin:
                    tmp = chemin + '.tmp'
                    with open(tmp, 'wb') as f:
                        f.write(corps)
                    os.replace(tmp, chemin)
                return corps
            if code == 403:
                raise Acces403(code, url)
            if code in (429, 503):
                self.echecs += 1
                self._delai_courant = min(self._delai_courant * 2, 120)
                if essai == ESSAIS_MAX:
                    raise CorpsAbandonne(f'{url} : HTTP {code} cinq fois')
                try:
                    attente = float({k.lower(): v for k, v in en_tetes.items()}.get('retry-after', ''))
                except ValueError:
                    attente = self._delai_courant
                self._dormir(min(max(attente, 0), ATTENTE_MAX))
                continue
            raise ErreurHTTP(code, url)
        raise CorpsAbandonne(url)  # inatteignable

    def get_json(self, url, cache=True):
        return json.loads(self.get(url, cache=cache).decode('utf-8'))

    def get_texte(self, url, cache=True):
        corps = self.get(url, cache=cache)
        try:
            return corps.decode('utf-8')
        except UnicodeDecodeError:
            return corps.decode('cp1252', errors='replace')

    def compteurs(self):
        return {'requetes': self.requetes, 'depuis_cache': self.depuis_cache, 'echecs': self.echecs}
