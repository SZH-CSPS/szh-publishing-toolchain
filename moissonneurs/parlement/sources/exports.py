"""Exports en lot de files.openparldata.ch (NDJSON gzip, CC BY 4.0) : téléchargeur et lecteurs en flux.

Les exports aplatissent les champs multilingues (`title_de`, `title_fr`…) ; ce module les recompose dans la forme de
l'API (`title` = dict de langues) pour qu'un seul classement serve aux deux sources. Rien n'est jamais chargé en mémoire
d'un bloc : un fichier se lit ligne à ligne.
"""
import gzip
import json
import os
import re
import time
import urllib.request

from .openparldata import Affaire, vers_affaire

BASE_URL = 'https://files.openparldata.ch/exports/'
LANGUES = ('de', 'fr', 'it', 'rm', 'en')
RE_LANGUE = re.compile(r'^(.+)_(de|fr|it|rm|en)$')
TYPES_DOUBLON = {"titre de l'objet", 'titel des geschaeftes', 'titel des geschäftes', "titolo dell'oggetto"}
RE_BALISE = re.compile(r'<[^>]+>')
# Colonnes sans lesquelles un export n'est pas lisible : un renommage doit casser bruyamment, jamais en silence.
COLONNES_AFFAIRES = ('body_key', 'external_id', 'id', 'number', 'begin_date', 'updated_at', 'type_harmonized_id', 'title_de')
COLONNES_DOCS = ('id', 'affair_id', 'name', 'text')
COLONNES_TEXTES = ('id', 'affair_id', 'text_de')


class SchemaExport(Exception):
    """Une colonne attendue manque : l'export a changé de forme."""


class FichierAbsent(Exception):
    """Le fichier n'existe pas sur le serveur (404)."""


class ErreurExport(Exception):
    pass


def _ouvrir_urllib(url):
    """Réponse en flux. L'en-tête est celui d'urllib, tel quel : ni nom de projet ni imitation de navigateur."""
    try:
        return urllib.request.urlopen(urllib.request.Request(url), timeout=120)
    except urllib.error.HTTPError as e:
        if e.code == 404:
            raise FichierAbsent(url) from e
        raise ErreurExport(f'{url} : HTTP {e.code}') from e


class Telechargeur:
    """Télécharge chaque fichier une fois par passe, en flux, 5 s entre deux fichiers ; le supprime après le balayage."""

    def __init__(self, dossier, base_url=BASE_URL, delai=5.0, ouvrir=None, dormir=None, horloge=None):
        self.dossier = dossier
        self.base_url = base_url
        self.delai = float(delai)
        self._ouvrir = ouvrir or _ouvrir_urllib
        self._dormir = dormir or time.sleep
        self._horloge = horloge or time.monotonic
        self._dernier = None
        self.fichiers = 0
        self.octets = 0
        self.urls = []
        os.makedirs(dossier, exist_ok=True)

    def telecharger(self, relatif):
        """Chemin local du fichier `relatif` (ex. `docs/docs_JU.ndjson.gz`). Rend le fichier déjà là sans le retélécharger."""
        local = os.path.join(self.dossier, relatif.replace('/', '__'))
        if os.path.exists(local):
            return local
        if self._dernier is not None:
            reste = self.delai - (self._horloge() - self._dernier)
            if reste > 0:
                self._dormir(reste)
        url = self.base_url + relatif
        self.urls.append(url)
        tmp = local + '.part'
        try:
            reponse = self._ouvrir(url)
            try:
                with open(tmp, 'wb') as f:
                    while True:
                        bloc = reponse.read(1 << 20)
                        if not bloc:
                            break
                        f.write(bloc)
                        self.octets += len(bloc)
            finally:
                if hasattr(reponse, 'close'):
                    reponse.close()
            os.replace(tmp, local)
        finally:
            self._dernier = self._horloge()
            if os.path.exists(tmp):
                os.remove(tmp)
        self.fichiers += 1
        return local

    def supprimer(self, chemin):
        if chemin and os.path.exists(chemin):
            os.remove(chemin)


def lignes(chemin, colonnes=()):
    """Les enregistrements d'un NDJSON gzip, un par un. Lève SchemaExport si la première ligne n'a pas les colonnes."""
    premiere = True
    with gzip.open(chemin, 'rt', encoding='utf-8') as f:
        for brute in f:
            if not brute.strip():
                continue
            d = json.loads(brute)
            if premiere:
                manque = [c for c in colonnes if c not in d]
                if manque:
                    raise SchemaExport(f'{os.path.basename(chemin)} : colonnes absentes {manque}')
                premiere = False
            yield d


def aplatir_vers_api(d):
    """Recompose `title_de/fr/it/rm`, `type_name_*`, `url_external_*`… en dicts de langues, comme l'API."""
    sortie, groupes = {}, {}
    for cle, valeur in d.items():
        m = RE_LANGUE.match(cle)
        if m:
            g = groupes.setdefault(m.group(1), {})
            if valeur not in (None, ''):
                g[m.group(2)] = valeur
        else:
            sortie[cle] = valeur
    sortie.update(groupes)
    return sortie


def lire_affaires(chemin, corps=None, depuis=''):
    """Affaires de l'export, dans la forme de l'API. `corps` : ensemble de body_key ; `depuis` : date de dépôt minimale
    (une affaire sans date reste, comme avec l'API)."""
    for d in lignes(chemin, COLONNES_AFFAIRES):
        if corps is not None and str(d.get('body_key')) not in corps:
            continue
        api = aplatir_vers_api(d)
        a = vers_affaire(api)
        if a is None:
            continue
        if depuis and a.date_depot and a.date_depot < depuis:
            continue
        yield a


def lire_documents(chemin, ids):
    """(affair_id, document) des documents rattachés à une affaire de `ids` ; le reste est ignoré."""
    for d in lignes(chemin, COLONNES_DOCS):
        aid = d.get('affair_id')
        if aid in ids:
            yield aid, d


def texte_sans_balises(html):
    return re.sub(r'[ \t]+', ' ', RE_BALISE.sub(' ', html or '')).strip()


def lire_textes(chemin, ids):
    """(affair_id, document factice) des textes déposés, développements et réponses (texts_CHE), balises retirées ;
    le type « Titre de l'objet » est exclu (doublon du titre)."""
    for d in lignes(chemin, COLONNES_TEXTES):
        try:
            aid = int(d.get('affair_id'))
        except (TypeError, ValueError):
            continue
        if aid not in ids:
            continue
        typ = (d.get('type_fr') or d.get('type_de') or d.get('type_it') or '').strip()
        if typ.lower() in TYPES_DOUBLON:
            continue
        morceaux = [texte_sans_balises(d.get('text_' + lg)) for lg in ('de', 'fr', 'it') if d.get('text_' + lg)]
        texte = '\n'.join(m for m in morceaux if m)
        if not texte:
            continue
        yield aid, {'id': 'T' + str(d.get('id')), 'name': typ, 'text': texte, 'url': '', 'url_oparl': '', 'language': ''}
