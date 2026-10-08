#!/usr/bin/env python3
# Liens courts Shlink pour les QR des livres : chaque QR encode un lien du type
# https://link.szh-csps.ch/BuchLS_01_click plutôt que l'URL longue. Les tests
# (test/liens-courts.test.py) ne parlent qu'à un http.server local.
#
# API REST Shlink v3 :
#   POST {base}/rest/v3/short-urls
#   en-tête  X-Api-Key: <clé>
#   corps    {"longUrl": "...", "findIfExists": true, "tags": [...]}
#   réponse  200, JSON, champ "shortUrl".
#
# Configuration par variables d'environnement seulement (la clé n'est ni dans le dépôt ni
# dans le livre) :
#   SZH_SHLINK_URL   base de l'instance (ex. https://link.szh-csps.ch)
#   SZH_SHLINK_CLE   clé d'API (X-Api-Key)
# Si l'une manque ou si l'appel échoue, l'URL longue est gardée avec un
# « [livre-avertissement] » : le livre se compile quand même.
#
# Cache liens-courts.yaml, à côté de buch.yaml : une paire « "longue": "courte" » par ligne,
# guillemets et barres obliques inverses échappés. C'est du YAML valide, écrit sans PyYAML ;
# szh-qr.lua le relit ligne à ligne. Une fois résolu, un lien ne demande plus le réseau.
#
#   python3 liens-courts.py <cache.yaml> [--scan CHAPITRES_DIR] [--lecteur LECTEUR] [URL...]
#
# Depuis livre.mk, si SZH_SHLINK_URL est posée :
#   python3 liens-courts.py liens-courts.yaml --scan chapitres --lecteur "$(LECTEUR)"
#
# --lecteur doit être celui de la compilation (LECTEUR dans livre.mk), pour lire les blocs
# de la même façon.

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

AVERT_ENTETE = '[livre-avertissement]'


def avertir(code, lieu, message_fr, message_de):
    print('%s %s | %s | %s | [de] %s' % (AVERT_ENTETE, code, lieu, message_fr, message_de),
          file=sys.stderr)


# ------------------------------------------------------------------------------------
# Cache : URL longue -> URL courte, un « "longue": "courte" » par ligne.
# ------------------------------------------------------------------------------------
def _echapper(s):
    return s.replace('\\', '\\\\').replace('"', '\\"')


def _deechapper(s):
    return re.sub(r'\\(["\\])', r'\1', s)


LIGNE_CACHE = re.compile(r'^"(.*)":\s*"(.*)"\s*$')


def lire_cache(chemin):
    cache = {}
    try:
        with open(chemin, 'r', encoding='utf-8') as fh:
            for ligne in fh:
                m = LIGNE_CACHE.match(ligne.rstrip('\n'))
                if m:
                    cache[_deechapper(m.group(1))] = _deechapper(m.group(2))
    except OSError:
        pass
    return cache


def ecrire_cache(chemin, cache):
    lignes = ['"%s": "%s"' % (_echapper(l), _echapper(c)) for l, c in sorted(cache.items())]
    with open(chemin, 'w', encoding='utf-8', newline='\n') as fh:
        if lignes:
            fh.write('\n'.join(lignes) + '\n')


# ------------------------------------------------------------------------------------
# Extraction des URL des blocs qr-link et .qr par pandoc lui-même
# (filters/szh-qr-lister.lua) : un motif texte prendrait aussi les exemples en bloc de code,
# et ne lirait pas comme la compilation.
# ------------------------------------------------------------------------------------
FILTRE_LISTER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'filters', 'szh-qr-lister.lua')


def scanner_liens_qr(dossier, lecteur='markdown', pandoc_bin='pandoc'):
    """URL des qr-link et .qr dont `tracked` n'est pas false, triées et sans doublon. Un
    appel pandoc par .md du dossier ; le filtre écrit une ligne JSON par lien dans le
    fichier SZH_QR_LISTE.
    La sortie de pandoc va sur stdout (capturée, ignorée) et non vers os.devnull : sous
    Windows, pandoc échoue sur « nul » (« withFile: invalid argument »)."""
    urls = set()
    for base, _dirs, fichiers in os.walk(dossier):
        for nom in sorted(fichiers):
            if not nom.endswith('.md'):
                continue
            chemin = os.path.join(base, nom)
            fd, sortie_liste = tempfile.mkstemp(suffix='.jsonl')
            os.close(fd)
            try:
                env = dict(os.environ)
                env['SZH_QR_LISTE'] = sortie_liste
                resultat = subprocess.run(
                    [pandoc_bin, chemin, '--from', lecteur, '--to', 'plain',
                     '--lua-filter', FILTRE_LISTER],
                    env=env, capture_output=True, text=True)
                if resultat.returncode != 0:
                    raise RuntimeError(
                        "pandoc (extraction des liens QR) a échoué sur %s : %s"
                        % (chemin, resultat.stderr))
                with open(sortie_liste, 'r', encoding='utf-8') as fh:
                    for ligne in fh:
                        ligne = ligne.strip()
                        if not ligne:
                            continue
                        obj = json.loads(ligne)
                        if obj.get('tracked', True) and obj.get('url'):
                            urls.add(obj['url'])
            finally:
                try:
                    os.unlink(sortie_liste)
                except OSError:
                    pass
    return sorted(urls)


# ------------------------------------------------------------------------------------
# L'appel Shlink lui-même.
# ------------------------------------------------------------------------------------
def obtenir_lien_court(url_longue, base_url, cle_api, tags=None, timeout=10):
    """POST {base_url}/rest/v3/short-urls ; rend le champ "shortUrl" de la réponse. Lève
    URLError/HTTPError (réseau, HTTP) ou ValueError (réponse invalide ou sans
    "shortUrl")."""
    corps = {'longUrl': url_longue, 'findIfExists': True}
    if tags:
        corps['tags'] = list(tags)
    donnees = json.dumps(corps).encode('utf-8')
    requete = urllib.request.Request(
        base_url.rstrip('/') + '/rest/v3/short-urls',
        data=donnees,
        method='POST',
        headers={
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-Api-Key': cle_api,
        },
    )
    with urllib.request.urlopen(requete, timeout=timeout) as reponse:
        corps_reponse = json.loads(reponse.read().decode('utf-8'))
    court = corps_reponse.get('shortUrl')
    if not court:
        raise ValueError('réponse Shlink sans "shortUrl" : %r' % (corps_reponse,))
    return court


def resoudre_liens(urls_longues, cache, base_url, cle_api, tags=None):
    """Complète `cache` en place pour chaque URL absente. Rend le nombre d'URL raccourcies ;
    les autres gardent l'URL longue, avec un avertissement."""
    resolues = 0
    for url in urls_longues:
        if url in cache:
            continue
        if not base_url or not cle_api:
            avertir(
                'lien-court-indisponible', 'lien « %s »' % url,
                "SZH_SHLINK_URL ou SZH_SHLINK_CLE absent : l'URL longue est gardée, le QR ne raccourcit rien.",
                'SZH_SHLINK_URL oder SZH_SHLINK_CLE fehlt: die lange URL bleibt erhalten, der QR-Code kürzt nichts.')
            cache[url] = url
            continue
        try:
            cache[url] = obtenir_lien_court(url, base_url, cle_api, tags=tags)
            resolues += 1
        except (urllib.error.URLError, ValueError, OSError, TimeoutError) as exc:
            avertir(
                'lien-court-echec', 'lien « %s »' % url,
                "Shlink injoignable ou en erreur (%s) : l'URL longue est gardée." % exc,
                'Shlink nicht erreichbar oder Fehler (%s): die lange URL bleibt erhalten.' % exc)
            cache[url] = url
    return resolues


def principal(argv):
    ap = argparse.ArgumentParser(
        description="Résout des URL longues en liens courts Shlink, avec cache local.")
    ap.add_argument('cache', help="chemin du cache liens-courts.yaml (lu et réécrit)")
    ap.add_argument('--scan', metavar='DOSSIER',
                     help="scanne DOSSIER (chapitres/) pour les URL des blocs qr-link/.qr du markdown")
    ap.add_argument('--lecteur', default='markdown',
                     help="lecteur pandoc utilisé pour --scan (markdown ou markdown+hard_line_breaks "
                          "selon la maquette — voir livre.mk, LECTEUR ; défaut markdown)")
    ap.add_argument('urls', nargs='*', help="URL longues à résoudre, en plus de --scan")
    ap.add_argument('--tags', default='',
                     help="tags Shlink séparés par des virgules (défaut : aucun)")
    args = ap.parse_args(argv)

    urls = list(args.urls)
    if args.scan:
        urls.extend(scanner_liens_qr(args.scan, lecteur=args.lecteur))
    urls = sorted(set(urls))
    if not urls:
        return 0

    cache = lire_cache(args.cache)
    base_url = os.environ.get('SZH_SHLINK_URL', '').strip()
    cle_api = os.environ.get('SZH_SHLINK_CLE', '').strip()
    tags = [t.strip() for t in args.tags.split(',') if t.strip()]

    resoudre_liens(urls, cache, base_url, cle_api, tags=tags)
    ecrire_cache(args.cache, cache)
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except (AttributeError, OSError):
        pass
    sys.exit(principal(sys.argv[1:]))
