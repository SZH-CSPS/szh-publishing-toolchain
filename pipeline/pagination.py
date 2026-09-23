#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Pagination continue d'un numéro : chaque article est compilé en un PDF séparé
(out/<slug>/<slug>.pdf) dont les folios repartent à 1. Ce script calcule le folio de
départ de chaque article dans le numéro et écrit, par article, une feuille de style que
WeasyPrint reçoit en feuille UTILISATEUR (-s) pour décaler ses folios.

    python3 pagination.py etat       --ordre slug1,slug2,slug3 [--dossier .]
    python3 pagination.py rafraichir --ordre slug1,slug2,slug3 [--dossier .]

`--dossier` est le dossier du numéro (celui qui porte ausgabe.yaml et articles/),
défaut '.'. `--ordre` est l'ordre de lecture du numéro, slugs séparés par des virgules.
`rafraichir` l'exige ; `etat` s'en passe et relit alors l'ordre de la dernière pagination.

**Pourquoi ce script ne reconstitue jamais l'ordre de lecture.** Il est décidé par le
cockpit, et pas seulement par `ordre-articles` : le cockpit trie le disque par collation
française (`localeCompare(…, 'fr')`), puis ramène en fin de numéro les articles sans DOI
— ceux de la clé `articles-sans-doi`, mais AUSSI ceux dont le type ne reçoit pas de DOI
selon la configuration OJS (extension.js, articlesSansDoi()). Une première version
reproduisait ici la seule clé : elle se serait trompée sans rien dire sur le premier
numéro portant un agenda ou un compte rendu. Le folio ne suivrait alors plus le DOI. D'où la
règle : l'ordre arrive par --ordre, depuis le cockpit, ou on ne pagine pas.

**Mesures faites avant d'écrire ceci, à ne pas refaire :**
  * `@page :first { counter-reset: page 11; }` passé à WeasyPrint 69 en feuille
    UTILISATEUR (`weasyprint -s decalage.css article.html article.pdf`) donne les folios
    11, 12, 13 : la valeur écrite est donc le départ lui-même, pas départ − 1.
  * Vérifié sur le patron de la maquette (pied courant en `position: running(piedCourant)`
    posé par `@bottom-center { content: element(piedCourant) }`, folio en
    `.folio::after { content: counter(page) }`) : le décalage traverse bien l'élément
    running.
  * `@page { counter-reset: page N }` SANS `:first` remet le compteur à N à CHAQUE page
    (toutes les pages affichent N) : piège mesuré, le `:first` est obligatoire.
  * `body { counter-reset: page N }` et `html { counter-reset: page N }` sont totalement
    inertes sous WeasyPrint 69.
  * Le python3 système de la WSL (3.13.5) n'a pas pypdf ; seul le venv de WeasyPrint l'a
    (pypdf 6.15.0) — `/usr/local/bin/weasyprint` est un script dont la première ligne est
    `#!/opt/weasyprint/bin/python3`, et c'est ce python-là qui porte le module.
  * Chercher `/Type /Page` à l'expression régulière dans un PDF produit par WeasyPrint 69
    rend 0 : ses objets sont écrits en flux compressés. D'où compter_pages() ci-dessous,
    qui ne lit jamais un PDF « à la main ».

stdlib seulement (json, os, sys, argparse, subprocess, shutil).
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
    """Erreur destinée à l'utilisateur : message déjà en français, code de sortie déjà
    décidé par l'appelant. Une seule sortie du programme (main), jamais un sys.exit épars
    au milieu du calcul — ce qui permettrait à `etat` de rester silencieux (JSON complet)
    même quand une partie du calcul échoue ailleurs."""

    def __init__(self, message, code):
        super().__init__(message)
        self.code = code


# ---- Comptage des pages : jamais deviné -------------------------------------------

def compter_pages(chemin_pdf):
    """Nombre de pages réel d'un PDF, jamais deviné. Essaie d'abord `import pypdf` dans
    l'interprète courant ; si absent (cas mesuré du python3 système de la WSL), retrouve
    l'interprète du venv WeasyPrint via le shebang de `shutil.which('weasyprint')` et
    compte par un sous-processus. Si ni l'un ni l'autre ne marche : message clair sur
    stderr et sortie 3 — jamais un compte deviné en repliant sur une regex sur le PDF
    (mesuré inefficace : WeasyPrint 69 écrit ses objets en flux compressés, `/Type /Page`
    n'y apparaît jamais en clair)."""
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
    """Contenu brut de .szh-pagination.json, ou None si absent ou illisible. Sert à la
    fois à `etat`/`rafraichir` (comparaison des pages) et à `feuilles` (reconstruction
    sans PDF) : un seul lecteur, une seule notion de « absent ou corrompu »."""
    chemin = chemin_json_pagination(dossier)
    try:
        with open(chemin, encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def lire_pagination_enregistree(dossier):
    """{slug: {'depart': N, 'pages': N}} tel qu'enregistré au dernier `rafraichir`, ou {}
    si le fichier est absent ou illisible. Un fichier illisible n'est PAS traité comme une
    erreur bloquante : rien à comparer, donc aucun article périmé signalé — le silence
    documenté par la règle des périmés (voir calculer_perimes) s'applique aussi à ce cas
    limite.

    Le départ est retenu autant que les pages : c'est lui qui trahit un article inséré,
    retiré ou déplacé, où aucun nombre de pages ne change alors que les folios, eux,
    glissent."""
    data = lire_pagination_json(dossier)
    if not data:
        return {}
    return {a.get('slug'): {'depart': a.get('depart'), 'pages': a.get('pages')}
            for a in data.get('articles', []) if a.get('slug')}


def ecrire_si_different(chemin, contenu):
    """N'écrit que si le contenu change (lu puis comparé). Pour .szh-folio.css : c'est un
    prérequis make du PDF, le réécrire à l'identique bougerait son mtime et referait tous
    les PDF du numéro à chaque rafraîchissement. Pour .szh-pagination.json, la même
    prudence évite un commit de diff vide. Retourne True si une écriture a eu lieu."""
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

    Un article dont le PDF n'est pas là compte, dans le cumul, pour le nombre de pages que
    .szh-pagination.json retient de lui — et pour 0 seulement s'il n'y est pas non plus.
    Mesuré : le faire compter pour 0 dans tous les cas rendait un `make clean` catastrophique,
    tous les départs retombant à 1 et le numéro entier se déclarant périmé alors que rien
    n'avait changé. La dernière longueur connue est la seule estimation honnête : elle rend
    exactement les départs enregistrés tant que personne n'a touché au texte.

    `pages` reste None et `pdf` reste False dans ce cas : on rapporte ce qu'on a MESURÉ, la
    valeur de repli ne sert qu'au cumul. C'est ce qui permet à `rafraichir` de refuser un
    numéro à trous plutôt que de figer une estimation."""
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
    """À partir du premier article qui ne correspond plus à ce que .szh-pagination.json
    retient, lui et tous les suivants. Lui, parce que ce qui est enregistré pour lui est
    faux — et c'est cela qui partirait dans le champ <pages> de l'export OJS ; les
    suivants, parce que leurs folios imprimés sont réellement faux. Les articles AVANT lui
    ne bougent pas et restent muets : les couvrir d'avertissements apprendrait à la
    rédaction à les ignorer.

    Trois façons de ne plus correspondre, et il en faut trois. Le nombre de pages a
    changé : l'article s'est allongé ou raccourci. Le départ a changé : l'article a
    glissé parce qu'un précédent a bougé, ou parce qu'un article a été inséré, retiré ou
    déplacé devant lui. L'article est absent de l'enregistrement : il est neuf, donc sans
    feuille de folio. Mesuré : sans la comparaison des départs, insérer un article au
    milieu décalait tous les suivants — départs 3 et 6 devenus 5 et 8 — sans qu'un seul
    nombre de pages ne change, et rien ne le signalait.

    Un numéro jamais paginé (pas de .szh-pagination.json) n'a rien de périmé : on n'a
    jamais rien promis. C'est `enregistre` qui porte ce cas, et non une liste de périmés
    longue comme le numéro.

    Un article sans PDF ne fait pas diverger à lui seul par ses pages — on ne sait rien de
    sa longueur — mais son départ, lui, reste comparable et le trahit s'il a glissé."""
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
    """L'ordre de la dernière pagination, tel que .szh-pagination.json le retient. C'est
    le seul ordre que ce script puisse connaître sans le cockpit : il sert au diagnostic
    (`etat` lancé à la main), jamais à décider d'une pagination — un article déplacé
    depuis ne s'y voit pas. Refuse si rien n'a jamais été paginé."""
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
    # L'état a été construit AVANT l'écriture : à la première pagination d'un numéro il
    # dirait encore « jamais paginé », et il n'y a plus rien de périmé une fois la
    # pagination posée. On rend donc l'état d'APRÈS, celui que le cockpit affichera.
    etat['enregistre'] = True
    etat['perimes'] = []
    print(json.dumps(etat, ensure_ascii=False))
    return 0


def commande_feuilles(dossier):
    """Régénère les out/<slug>/.szh-folio.css depuis .szh-pagination.json SEUL — aucun
    PDF regardé, aucun recalcul, pas de --ordre. Trou mesuré sur une vraie mini-revue :
    `make clean` efface out/, donc les feuilles de folio avec lui ; .szh-pagination.json
    survit, lui, puisqu'il vit dans le dossier du numéro. Sans cette sous-commande, une
    recompilation après `make clean` remettrait tous les folios à 1 en silence — la
    détection de péremption compare des nombres de PAGES, or les articles recompilés en
    ont exactement autant qu'avant, donc rien ne la déclencherait. `feuilles` rétablit
    l'état enregistré sans avoir besoin des PDF, ce que `rafraichir` ne peut pas faire
    (il exige que tous les PDF de l'ordre soient déjà là). C'est ce qui permet au
    Makefile de faire dépendre les feuilles de .szh-pagination.json sans fermer de cycle
    HTML -> PDF -> feuille -> HTML.

    Numéro jamais paginé (fichier absent ou illisible) : cas normal, pas une panne — on
    ne pagine pas un numéro qui n'a jamais été rafraîchi. Sortie 0, rien écrit.

    Écrit une feuille pour CHAQUE article listé, départ 1 compris : mesuré qu'effacer une
    feuille de folio ne fait pas revenir le PDF au folio 1 (make ne voit alors plus de
    prérequis modifié, le PDF garde le folio de sa dernière compilation) — sauter le
    premier article laisserait donc son folio dériver au silence exact que cette
    sous-commande existe pour combler."""
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
    try:  # console Windows en cp1252 : un accent combinant (nom venu du partage) y plante.
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
    # `feuilles` ne prend pas --ordre : elle ne lit que .szh-pagination.json, jamais
    # l'ordre du numéro, justement pour pouvoir tourner sans PDF ni ausgabe.yaml à jour.
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
