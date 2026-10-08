#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pagination continue d'un numéro. Chaque article est compilé en un PDF séparé
(out/<slug>/<slug>.pdf) dont les folios partent de 1. Ce script calcule le folio de départ
de chaque article et écrit, par article, une feuille de style que WeasyPrint reçoit en
feuille utilisateur (-s) pour décaler ses folios.

    python3 pagination.py etat       --ordre slug1,slug2,slug3 [--dossier .]
    python3 pagination.py rafraichir --ordre slug1,slug2,slug3 [--dossier .]
    python3 pagination.py feuilles   [--dossier .]

`--dossier` est le dossier du numéro (celui qui porte ausgabe.yaml et articles/).
`--ordre` est l'ordre de lecture, slugs séparés par des virgules. `rafraichir` l'exige ;
`etat` s'en passe et relit l'ordre de la dernière pagination.

L'ordre de lecture vient du cockpit, qui seul le connaît : tri français des dossiers, puis
en fin de numéro les articles sans DOI (clé `articles-sans-doi` et types sans DOI selon la
configuration OJS, voir articlesSansDoi()). Ce script ne le reconstitue pas.

Comportement de WeasyPrint sur lequel repose la feuille de folio :
  * `@page :first { counter-reset: page 11; }` en feuille utilisateur donne les folios 11,
    12, 13 : la valeur est le départ lui-même. Le décalage atteint aussi le pied courant
    (élément running).
  * sans `:first`, le compteur est remis à N sur chaque page ;
  * `counter-reset: page` sur body ou html est sans effet.

Le python3 système de la WSL n'a pas pypdf, seul le venv de WeasyPrint l'a (voir
compter_pages()).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))

SCHEMA = 'szh-pagination/1'

NOM_JSON = '.szh-pagination.json'
NOM_FOLIO_CSS = '.szh-folio.css'


class ErreurPagination(Exception):
    """Erreur destinée à l'utilisateur, avec son message et son code de sortie. Seul main()
    la transforme en sortie du programme."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


# ---- Comptage des pages ------------------------------------------------------------

def compter_pages(chemin_pdf):
    """Nombre de pages d'un PDF, par pypdf. Si l'interprète courant n'a pas pypdf, compte
    dans un sous-processus avec l'interprète du venv WeasyPrint, lu dans le shebang de
    `weasyprint`. Sinon, ErreurPagination de code 3. Une expression régulière sur
    `/Type /Page` ne marche pas : WeasyPrint écrit ses objets en flux compressés."""
    try:
        from pypdf import PdfReader
        return len(PdfReader(chemin_pdf).pages)
    except ImportError:
        pass
    except Exception as e:
        raise ErreurPagination("lecture de %s par pypdf : %s" % (chemin_pdf, e), 3)

    weasy = shutil.which('weasyprint')
    if not weasy:
        raise ErreurPagination(
            "pypdf introuvable dans cet interprète et weasyprint absent du PATH : "
            "impossible de compter les pages de %s." % chemin_pdf, 3)
    try:
        with open(weasy, encoding='utf-8') as f:
            premiere_ligne = f.readline()
    except OSError as e:
        raise ErreurPagination("lecture de %s : %s" % (weasy, e), 3)
    if not premiere_ligne.startswith('#!'):
        raise ErreurPagination(
            "%s n'a pas de shebang exploitable : impossible d'en déduire l'interprète "
            "qui porte pypdf." % weasy, 3)
    interprete = premiere_ligne[2:].strip()
    if not interprete or not os.path.isfile(interprete):
        raise ErreurPagination(
            "l'interprète déduit du shebang de %s (%s) n'existe pas." % (weasy, interprete), 3)

    code = "from pypdf import PdfReader; import sys; print(len(PdfReader(sys.argv[1]).pages))"
    try:
        r = subprocess.run([interprete, '-c', code, chemin_pdf],
                            capture_output=True, text=True, encoding='utf-8')
    except OSError as e:
        raise ErreurPagination("appel de %s : %s" % (interprete, e), 3)
    if r.returncode != 0:
        raise ErreurPagination(
            "comptage des pages de %s par %s a échoué : %s"
            % (chemin_pdf, interprete, r.stderr.strip()), 3)
    try:
        return int(r.stdout.strip())
    except ValueError:
        raise ErreurPagination(
            "sortie inattendue de %s en comptant %s : %r"
            % (interprete, chemin_pdf, r.stdout), 3)


# ---- Chemins ------------------------------------------------------------------------

def chemin_pdf(dossier, slug):
    return os.path.join(dossier, 'out', slug, slug + '.pdf')


def chemin_folio_css(dossier, slug):
    return os.path.join(dossier, 'out', slug, NOM_FOLIO_CSS)


def chemin_json_pagination(dossier):
    return os.path.join(dossier, NOM_JSON)


# ---- Lecture / écriture de l'état enregistré -----------------------------------------

def lire_pagination_json(dossier):
    """Contenu brut de .szh-pagination.json, ou None si absent ou illisible."""
    chemin = chemin_json_pagination(dossier)
    try:
        with open(chemin, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def lire_pagination_enregistree(dossier):
    """{slug: {'depart': N, 'pages': N}} du dernier `rafraichir`, ou {} si le fichier est
    absent ou illisible (aucun article n'est alors signalé périmé).

    Le départ est retenu en plus des pages : il révèle un article inséré, retiré ou
    déplacé, cas où aucun nombre de pages ne change."""
    data = lire_pagination_json(dossier)
    if not data:
        return {}
    return {a.get('slug'): {'depart': a.get('depart'), 'pages': a.get('pages')}
            for a in data.get('articles', []) if a.get('slug')}


def ecrire_si_different(chemin, contenu):
    """N'écrit que si le contenu change ; rend True s'il y a eu écriture. .szh-folio.css est
    un prérequis make du PDF : le réécrire à l'identique ferait recompiler tout le
    numéro."""
    try:
        with open(chemin, encoding='utf-8') as f:
            ancien = f.read()
    except OSError:
        ancien = None
    if ancien == contenu:
        return False
    dossier_parent = os.path.dirname(chemin)
    if dossier_parent:
        os.makedirs(dossier_parent, exist_ok=True)
    with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
        f.write(contenu)
    return True


def contenu_folio_css(depart):
    return (
        '/* Folio de départ de cet article dans le numéro. Écrit par pipeline/pagination.py,\n'
        '   passé à WeasyPrint en feuille utilisateur (-s). Ne pas éditer à la main. */\n'
        '@page :first { counter-reset: page %d; }\n' % depart
    )


def contenu_json_pagination(articles):
    data = {
        'schema': SCHEMA,
        'articles': [{'slug': a['slug'], 'depart': a['depart'], 'pages': a['pages']}
                     for a in articles],
    }
    return json.dumps(data, indent=2, ensure_ascii=False) + '\n'


# ---- Calcul --------------------------------------------------------------------------

def calculer_articles(dossier, ordre, enregistrees):
    """Départs cumulés et pages réelles, dans l'ordre de lecture du numéro.

    Un article sans PDF compte, dans le cumul, pour le nombre de pages enregistré dans
    .szh-pagination.json (0 s'il n'y est pas). Ainsi, après un `make clean`, les départs
    restent ceux qui sont enregistrés. Pour cet article, `pages` vaut None et `pdf` False :
    la valeur de repli ne sert qu'au cumul, et `rafraichir` refuse un numéro à trous."""
    articles = []
    inconnus = []
    cumul = 0
    for slug in ordre:
        pdf = chemin_pdf(dossier, slug)
        depart = cumul + 1
        if os.path.isfile(pdf):
            pages = compter_pages(pdf)
            cumul += pages
        else:
            pages = None
            inconnus.append(slug)
            ref = enregistrees.get(slug)
            cumul += (ref.get('pages') or 0) if ref else 0
        articles.append({'slug': slug, 'depart': depart, 'pages': pages,
                         'pdf': pages is not None})
    return articles, inconnus


def calculer_perimes(articles, enregistrees, enregistre):
    """Les articles périmés : le premier qui ne correspond plus à .szh-pagination.json, et
    tous les suivants. Ce qui est enregistré pour le premier est faux (et partirait dans
    <pages> de l'export OJS) ; les folios des suivants sont faux. Les articles d'avant ne
    sont pas signalés.

    Un article ne correspond plus si son nombre de pages a changé, si son départ a changé
    (un article inséré, retiré ou déplacé devant lui) ou s'il est absent de
    l'enregistrement. Sans PDF, seul son départ est comparé.

    Un numéro jamais paginé n'a rien de périmé : `enregistre` porte ce cas."""
    if not enregistre:
        return []
    perimes = []
    divergence = False
    for a in articles:
        if not divergence:
            ref = enregistrees.get(a['slug'])
            if ref is None:
                divergence = True
            elif a['depart'] != ref.get('depart'):
                divergence = True
            elif a['pages'] is not None and a['pages'] != ref.get('pages'):
                divergence = True
        if divergence:
            perimes.append(a['slug'])
    return perimes


def construire_etat(dossier, ordre):
    """Le JSON commun à `etat` et `rafraichir`, sans rien écrire sur disque."""
    enregistrees = lire_pagination_enregistree(dossier)
    articles, inconnus = calculer_articles(dossier, ordre, enregistrees)
    enregistre = os.path.isfile(chemin_json_pagination(dossier))
    perimes = calculer_perimes(articles, enregistrees, enregistre)
    total = sum(a['pages'] for a in articles if a['pages'] is not None)
    return {
        'schema': SCHEMA,
        'articles': articles,
        'total': total,
        'perimes': perimes,
        'inconnus': inconnus,
        'enregistre': enregistre,
    }


def ordre_enregistre(dossier):
    """L'ordre de la dernière pagination, lu dans .szh-pagination.json. Sert au diagnostic
    (`etat` lancé à la main) : un article déplacé depuis n'y apparaît pas. Lève si rien n'a
    été paginé."""
    data = lire_pagination_json(dossier)
    if not data or not data.get('articles'):
        raise ErreurPagination(
            "--ordre manquant et aucune pagination enregistrée dans %s : rien à relire."
            % chemin_json_pagination(dossier), 2)
    return [a['slug'] for a in data['articles'] if a.get('slug')]


# ---- Sous-commandes -------------------------------------------------------------------

def commande_etat(dossier, ordre):
    etat = construire_etat(dossier, ordre)
    print(json.dumps(etat, ensure_ascii=False))
    return 0


def commande_rafraichir(dossier, ordre):
    manquants = [s for s in ordre if not os.path.isfile(chemin_pdf(dossier, s))]
    if manquants:
        raise ErreurPagination(
            "numéro à trous : aucun PDF compilé pour %s. On ne pagine pas un numéro tant "
            "qu'un article de l'ordre n'est pas compilé — compilez-le d'abord (make all)."
            % ', '.join(manquants), 2)

    etat = construire_etat(dossier, ordre)

    ecrites = []
    for a in etat['articles']:
        chemin = chemin_folio_css(dossier, a['slug'])
        if ecrire_si_different(chemin, contenu_folio_css(a['depart'])):
            ecrites.append(a['slug'])

    ecrire_si_different(chemin_json_pagination(dossier), contenu_json_pagination(etat['articles']))

    etat['ecrites'] = ecrites
    # L'état a été calculé avant l'écriture ; on rend celui d'après, que le cockpit affiche.
    etat['enregistre'] = True
    etat['perimes'] = []
    print(json.dumps(etat, ensure_ascii=False))
    return 0


def commande_feuilles(dossier):
    """Régénère les out/<slug>/.szh-folio.css depuis .szh-pagination.json seul, sans PDF
    ni --ordre. `make clean` efface out/ et donc les feuilles, mais pas
    .szh-pagination.json : sans cette commande, la recompilation remettrait les folios à 1
    sans que rien ne le signale. Le Makefile fait dépendre les feuilles de
    .szh-pagination.json, sans cycle HTML -> PDF -> feuille.

    Numéro jamais paginé : sortie 0, rien d'écrit.

    Une feuille est écrite pour chaque article, départ 1 compris : sans feuille, make ne
    voit aucun prérequis changé et le PDF garde son ancien folio."""
    data = lire_pagination_json(dossier)
    if not data:
        resultat = {'schema': SCHEMA, 'ecrites': [], 'articles': 0}
        print(json.dumps(resultat, ensure_ascii=False))
        return 0

    articles = data.get('articles', [])
    ecrites = []
    for a in articles:
        slug, depart = a.get('slug'), a.get('depart')
        if not slug or depart is None:
            continue
        if ecrire_si_different(chemin_folio_css(dossier, slug), contenu_folio_css(depart)):
            ecrites.append(slug)

    resultat = {'schema': SCHEMA, 'ecrites': ecrites, 'articles': len(articles)}
    print(json.dumps(resultat, ensure_ascii=False))
    return 0


# ---- CLI --------------------------------------------------------------------------

def main(argv):
    try:  # une console en cp1252 plante sur un accent combinant
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    p = argparse.ArgumentParser(
        description="Pagination continue d'un numéro (folios de départ par article).")
    sous = p.add_subparsers(dest='commande', required=True)
    for nom in ('etat', 'rafraichir'):
        sp = sous.add_parser(nom)
        sp.add_argument('--ordre', default=None,
                         help='slugs séparés par des virgules, dans l\'ordre de lecture '
                              'du numéro ; exigé par rafraichir')
        sp.add_argument('--dossier', default='.', help='dossier du numéro (défaut : .)')
    # `feuilles` ne lit que .szh-pagination.json, d'où l'absence de --ordre.
    sp_feuilles = sous.add_parser('feuilles')
    sp_feuilles.add_argument('--dossier', default='.', help='dossier du numéro (défaut : .)')

    args = p.parse_args(argv[1:])
    dossier = args.dossier

    try:
        if args.commande == 'feuilles':
            return commande_feuilles(dossier)

        if args.ordre is not None:
            ordre = [s.strip() for s in args.ordre.split(',') if s.strip()]
        elif args.commande == 'rafraichir':
            raise ErreurPagination(
                "--ordre manquant : seul le cockpit connaît l'ordre de lecture du numéro "
                "(règle du DOI comprise). Rafraîchissez la pagination depuis le cockpit, ou "
                "passez l'ordre à la main : make rafraichir-pagination ORDRE=a,b,c.", 2)
        else:
            ordre = ordre_enregistre(dossier)

        if args.commande == 'etat':
            return commande_etat(dossier, ordre)
        else:
            return commande_rafraichir(dossier, ordre)
    except ErreurPagination as e:
        sys.stderr.write('[pagination] ✗ %s\n' % e)
        return e.code


if __name__ == '__main__':
    sys.exit(main(sys.argv))
