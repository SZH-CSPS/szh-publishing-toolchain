"""GET poli : User-Agent, délai par hôte, cache disque, robots.txt, plafond, demande d'arrêt. Un 403 de point d'entrée
lève Acces403 et ferme l'hôte pour la passe ; un 403 de page de détail lève Refus403Page, sauf afflux."""
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser

USER_AGENT = 'szh-harvest-research/0.1 (veille documentaire CSPS)'
TIMEOUT = 30
TENTATIVES = 3
# Afflux de 403 de détail : à partir de MIN_DETAILS_AFFLUX pages demandées, plus de PART_AFFLUX refusées ferment la source.
MIN_DETAILS_AFFLUX = 3
PART_AFFLUX = 0.5
# Une attente plus longue que ce seuil (secondes) est annoncée par une ligne `attente`.
ATTENTE_ANNONCEE = 10


class RobotsInterdit(Exception):
    """Le robots.txt de l'hôte interdit cette URL pour notre User-Agent."""


class ErreurReseau(Exception):
    """Échec réseau après toutes les tentatives."""


class Acces403(Exception):
    """Un point d'entrée de la source refuse l'accès (403), ou un afflux de pages refusées : la source s'arrête."""


class Refus403Page(Exception):
    """Une page de détail refuse l'accès (403), ou a déjà été refusée deux passes de suite : on la saute."""

    def __init__(self, url, deja=False):
        super().__init__(f'{url} : 403')
        self.url = url
        self.deja = deja


class BudgetEpuise(Exception):
    """Le plafond de requêtes de l'exécution est atteint : `tout` s'arrête, interrompu « budget »."""


class ArretDemande(Exception):
    """Le fichier de demande d'arrêt existe : `tout` s'arrête avant la requête suivante, interrompu « arret »."""


def afflux(bilan):
    """Assez de pages de détail demandées, et plus de la part admise refusées : la source est bloquée."""
    return bool(bilan) and bilan['demandes'] >= MIN_DETAILS_AFFLUX and len(bilan['refus']) > PART_AFFLUX * bilan['demandes']


class Reseau:
    def __init__(self, config, fichier_arret=None, signaler=None, urls_refusees=(), borne=None):
        self.delai = float(config.get('delai', 1.0))
        self.dossier_cache = config['cache']
        os.makedirs(self.dossier_cache, exist_ok=True)
        self._dernier_acces = {}
        self._delai_hote = {}  # délai propre à un hôte, doublé à chaque 429
        self._robots = {}
        self.requetes = 0      # requêtes réellement émises, robots.txt compris
        # Le budget des réglages (0 : sans limite) et le plafond de la passe, reçu de moisson.py (0 : aucune requête).
        bornes = [int(config.get('budget', 0) or 0) or None, config.get('plafond')]
        self.limite = min((b for b in bornes if b is not None), default=None)
        # La limite du budget partagé entre postes (partage.BudgetPartage), qui peut baisser en route.
        self.borne = borne
        self.fichier_arret = fichier_arret or ''
        self.signaler = signaler or (lambda evenement: None)
        self.source = ''       # la source en cours, posée par l'appelant : elle range les refus et les attentes
        self.hotes_fermes = set()
        self.urls_refusees = set(urls_refusees)
        self.details = {}      # source -> {'demandes': n, 'refus': [urls], 'reussies': [urls]}

    def _compter(self):
        if self.fichier_arret and os.path.exists(self.fichier_arret):
            raise ArretDemande(f'demande d\'arrêt : {self.fichier_arret}')
        limite = self.limite
        if self.borne is not None:
            partagee = self.borne(self.requetes)
            limite = partagee if limite is None else min(limite, partagee)
        if limite is not None and self.requetes >= limite:
            raise BudgetEpuise(f'plafond de {limite} requêtes atteint')
        self.requetes += 1

    def _bilan(self):
        return self.details.setdefault(self.source, {'demandes': 0, 'refus': [], 'reussies': []})

    # -- politesse ---------------------------------------------------

    def _hote(self, url):
        return urllib.parse.urlsplit(url).netloc

    def _dormir(self, secondes, hote):
        if secondes > ATTENTE_ANNONCEE:
            self.signaler({'type': 'attente', 'source': self.source, 'hote': hote, 'secondes': round(secondes),
                           'motif': '429'})
        time.sleep(secondes)

    def _attendre(self, hote):
        dernier = self._dernier_acces.get(hote)
        if dernier is not None:
            reste = self._delai_hote.get(hote, self.delai) - (time.monotonic() - dernier)
            if reste > 0:
                self._dormir(reste, hote)
        self._dernier_acces[hote] = time.monotonic()

    def _fermer(self, hote, url):
        self.hotes_fermes.add(hote)
        return Acces403(f'{url} : 403')

    def _verifier_ouvert(self, url):
        if self._hote(url) in self.hotes_fermes:
            raise Acces403(f'{url} : hôte fermé pour cette passe après un 403')

    def _verifier_robots(self, url):
        hote = self._hote(url)
        rp = self._robots.get(hote)
        if rp is None:
            rp = urllib.robotparser.RobotFileParser()
            robots_url = urllib.parse.urlunsplit(
                (urllib.parse.urlsplit(url).scheme, hote, '/robots.txt', '', ''))
            self._compter()
            try:
                self._attendre(hote)
                requete = urllib.request.Request(robots_url, headers={'User-Agent': USER_AGENT})
                with urllib.request.urlopen(requete, timeout=TIMEOUT) as reponse:
                    lignes = reponse.read().decode('utf-8', errors='replace').splitlines()
                rp.parse(lignes)
            except urllib.error.HTTPError as e:
                if e.code == 403:
                    raise self._fermer(hote, robots_url) from e
                rp.parse([])  # pas de robots.txt : tout autorisé
            except Exception:
                rp.parse([])  # robots.txt inaccessible : tout autorisé
            self._robots[hote] = rp
        if not rp.can_fetch(USER_AGENT, url):
            raise RobotsInterdit(f'robots.txt interdit : {url}')

    # -- cache disque --------------------------------------------------

    def _cle_cache(self, url):
        return hashlib.sha256(url.encode('utf-8')).hexdigest()

    def _chemins_cache(self, url):
        cle = self._cle_cache(url)
        return (os.path.join(self.dossier_cache, cle + '.corps'),
                os.path.join(self.dossier_cache, cle + '.meta'))

    def _lire_meta(self, chemin_meta):
        if os.path.exists(chemin_meta):
            with open(chemin_meta, encoding='utf-8') as f:
                return json.load(f)
        return None

    def _ecrire(self, chemin_corps, chemin_meta, corps, meta):
        tmp = chemin_corps + '.tmp'
        with open(tmp, 'wb') as f:
            f.write(corps)
        os.replace(tmp, chemin_corps)
        with open(chemin_meta, 'w', encoding='utf-8') as f:
            json.dump(meta, f)

    # -- requête avec tentatives ----------------------------------------

    def _ouvrir(self, url, en_tetes, detail=False):
        requete = urllib.request.Request(url, headers=en_tetes)
        derniere_erreur = None
        for tentative in range(1, TENTATIVES + 1):
            self._compter()
            try:
                return urllib.request.urlopen(requete, timeout=TIMEOUT)
            except urllib.error.HTTPError as e:
                if e.code == 304:
                    raise
                if e.code == 403:
                    raise (self._refus_detail(url) if detail else self._fermer(self._hote(url), url)) from e
                if e.code == 429 and tentative < TENTATIVES:
                    # Trop de requêtes : on ralentit cet hôte pour tout le reste de la moisson
                    # et on attend ce que le serveur demande (Retry-After), borné à 2 min.
                    hote = self._hote(url)
                    self._delai_hote[hote] = min(self._delai_hote.get(hote, self.delai) * 2, 30)
                    try:
                        attente = float(e.headers.get('Retry-After', ''))
                    except ValueError:
                        attente = self._delai_hote[hote] * 2
                    self._dormir(min(max(attente, 1), 120), hote)
                    derniere_erreur = e
                    continue
                if e.code < 500 or tentative == TENTATIVES:
                    raise
                derniere_erreur = e
            except (urllib.error.URLError, OSError) as e:
                derniere_erreur = e
                if tentative == TENTATIVES:
                    raise ErreurReseau(f'{url} : {e}') from e
            time.sleep(min(2 ** tentative, 10))
        raise ErreurReseau(f'{url} : {derniere_erreur}')

    def _refus_detail(self, url):
        """403 sur une page de détail : Refus403Page, sauf afflux, qui ferme l'hôte comme un point d'entrée."""
        bilan = self._bilan()
        bilan['refus'].append(url)
        if afflux(bilan):
            return self._fermer(self._hote(url), url)
        return Refus403Page(url)

    # -- API publique ----------------------------------------------------

    def get(self, url, cache=True, detail=False):
        """GET url, rend les octets du corps. Cache disque avec revalidation si cache=True.

        detail : une page de détail d'un projet, dont un 403 ne fait sauter qu'elle-même."""
        self._verifier_ouvert(url)
        if detail and url in self.urls_refusees:
            raise Refus403Page(url, deja=True)
        self._verifier_robots(url)
        chemin_corps, chemin_meta = self._chemins_cache(url)
        meta = self._lire_meta(chemin_meta) if cache else None
        en_tetes = {'User-Agent': USER_AGENT}
        if meta:
            if meta.get('etag'):
                en_tetes['If-None-Match'] = meta['etag']
            if meta.get('derniere_modif'):
                en_tetes['If-Modified-Since'] = meta['derniere_modif']

        self._attendre(self._hote(url))
        if detail:
            self._bilan()['demandes'] += 1
        try:
            with self._ouvrir(url, en_tetes, detail=detail) as reponse:
                corps = reponse.read()
                nouveau_meta = {
                    'etag': reponse.headers.get('ETag', ''),
                    'derniere_modif': reponse.headers.get('Last-Modified', ''),
                    'content_type': reponse.headers.get('Content-Type', ''),
                }
        except urllib.error.HTTPError as e:
            if e.code == 304 and meta is not None and os.path.exists(chemin_corps):
                with open(chemin_corps, 'rb') as f:
                    corps = f.read()
                if detail:
                    self._bilan()['reussies'].append(url)
                return corps
            raise

        if cache:
            self._ecrire(chemin_corps, chemin_meta, corps, nouveau_meta)
        if detail:
            self._bilan()['reussies'].append(url)
        return corps

    def get_texte(self, url, cache=True, detail=False):
        """Comme get(), mais décodé en texte (charset de l'en-tête, repli utf-8 puis cp1252)."""
        chemin_corps, chemin_meta = self._chemins_cache(url)
        corps = self.get(url, cache=cache, detail=detail)
        meta = self._lire_meta(chemin_meta) if cache else None
        charset = None
        if meta and meta.get('content_type'):
            for morceau in meta['content_type'].split(';'):
                morceau = morceau.strip()
                if morceau.lower().startswith('charset='):
                    charset = morceau.split('=', 1)[1].strip('"\'')
        if charset:
            try:
                return corps.decode(charset)
            except (LookupError, UnicodeDecodeError):
                pass
        try:
            return corps.decode('utf-8')
        except UnicodeDecodeError:
            return corps.decode('cp1252', errors='replace')

    def telecharger(self, url, chemin):
        """Téléchargement en flux vers chemin (gros fichiers). Conditionnel : ne retélécharge
        pas si le serveur répond 304. Rend True si un nouveau contenu a été écrit."""
        self._verifier_ouvert(url)
        self._verifier_robots(url)
        os.makedirs(os.path.dirname(chemin) or '.', exist_ok=True)
        chemin_meta = chemin + '.meta'
        meta = self._lire_meta(chemin_meta)
        en_tetes = {'User-Agent': USER_AGENT}
        if meta and os.path.exists(chemin):
            if meta.get('etag'):
                en_tetes['If-None-Match'] = meta['etag']
            if meta.get('derniere_modif'):
                en_tetes['If-Modified-Since'] = meta['derniere_modif']

        self._attendre(self._hote(url))
        try:
            with self._ouvrir(url, en_tetes) as reponse:
                tmp = chemin + '.tmp'
                with open(tmp, 'wb') as f:
                    while True:
                        bloc = reponse.read(1024 * 1024)
                        if not bloc:
                            break
                        f.write(bloc)
                os.replace(tmp, chemin)
                nouveau_meta = {
                    'etag': reponse.headers.get('ETag', ''),
                    'derniere_modif': reponse.headers.get('Last-Modified', ''),
                    'content_type': reponse.headers.get('Content-Type', ''),
                }
            with open(chemin_meta, 'w', encoding='utf-8') as f:
                json.dump(nouveau_meta, f)
            return True
        except urllib.error.HTTPError as e:
            if e.code == 304 and os.path.exists(chemin):
                return False
            raise
