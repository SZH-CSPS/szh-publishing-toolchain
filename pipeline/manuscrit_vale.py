#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_vale.py — le pont Vale du nettoyeur de manuscrit (article). Contrat :
# outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §7. Décision de Robin (18.09.2026) : les
# règles lexicales et éditoriales (langage épicène, vocabulaire du handicap, casse, APA)
# vivent en YAML dans pipeline/vale/, données que la rédaction édite sans coder. Vale
# lui-même est un binaire épinglé de l'image WSL (comme pandoc et veraPDF), jamais une
# entrée windows/apps.lock.
#
# Ce module NE RÉIMPLÉMENTE AUCUNE règle : il écrit des .txt (un paragraphe par ligne),
# lance `vale --output=JSON`, et traduit chaque constat Vale en alerte du contrat §7. Comme
# le pont typographique (manuscrit_typo.py) ne réimplémente pas szh-typographie.lua, celui-ci
# ne réimplémente pas les motifs de pipeline/vale/styles/ — voir ce dossier et son
# LISEZMOI.md pour les règles elles-mêmes.
#
# stdlib seule : json, os, re, subprocess, sys, tempfile, shutil. Aucune dépendance nouvelle.
#
# ── Ce que ce module ne sait pas faire avec un motif figé, et pourquoi (voir LISEZMOI.md) ──
#
# Vale (Go/RE2) ne supporte NI lookahead NI lookbehind. Quatre règles ont donc un motif YAML
# volontairement LARGE (il capture tout le contexte utile — une citation entière, une entrée
# bibliographique) et RAFFINEURS ci-dessous en extrait le found/suggested exact, ou REJETTE
# le constat quand le contexte le disqualifie (« et al. » n'est jamais une faute, un « & »
# déjà entre parenthèses n'en est pas une). Vale fait la détection ; ce module ne fait QUE
# la précision qu'un motif figé ne peut pas rendre — jamais une seconde détection.
#
# ── Le piège des URL/DOI dans le corps (mesuré) ──────────────────────────────────────────
#
# `downloads/sections`, `vaud/documents` : deux segments d'URL qui lèvent Epicene.
# FormesContractees (motif « mot/mot ») dans le corps. On MASQUE les URL/www/DOI du CORPS
# avant de l'envoyer à Vale — caractère pour caractère, remplacés par 'X' pour ne jamais
# décaler un Span — jamais dans la BIBLIOGRAPHIE, où APA.DoiForme a justement besoin de
# lire le DOI en clair.

import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

DISTRO = 'SZH-Publishing'
DELAI_SECONDES = 60


class _ValeIndisponible(Exception):
    """Interne : vale absent, wsl.exe injoignable, config cassée. Capturée par analyser(),
    qui rend alors (alertes=[], indisponible=True) — jamais une exception qui remonte."""


# ---------------------------------------------------------------------------------
# extraire() — un paragraphe par ligne, un index qui retrouve le paragraphe d'origine.
#
# ⚠ extraire() suppose que TOUS les paragraphes reçus portent le MÊME rôle du point de vue
# corps/bibliographie (tous `role != 'bibliographie'`, ou tous `role == 'bibliographie'`) —
# c'est analyser() qui reçoit `paragraphes_corps` et `paragraphes_biblio` déjà tranchés par
# l'appelant, et qui appelle extraire() une fois par liste. Un mélange produirait un `index`
# ambigu (une ligne 1 côté corps ET une ligne 1 côté bibliographie partageant la même clé) :
# plutôt que de laisser cette ambiguïté filer en silence, extraire() lève.

def extraire(paragraphes, langue):
    """Rend (texte_corps, texte_biblio, index). `langue` ('fr'/'de') est conservée pour la
    symétrie avec analyser() ; extraire() ne juge la langue de rien — un paragraphe par
    ligne, dans l'ordre, ne dépend jamais d'elle."""
    lignes_corps = []
    lignes_biblio = []
    index = {}
    for p in (paragraphes or []):
        # w:br déjà remplacés par le lecteur (§4 du contrat) : un \n résiduel serait un
        # défaut du lecteur, pas une raison de perdre l'invariant « une ligne = un
        # paragraphe » — on le neutralise sans jamais lever pour ça.
        texte = (p.get('texte') or '').replace('\r\n', ' ').replace('\n', ' ').replace('\r', ' ')
        role = p.get('role') or ''
        cible = lignes_biblio if role == 'bibliographie' else lignes_corps
        cible.append(texte)
        index[len(cible)] = p.get('source')

    if lignes_corps and lignes_biblio:
        raise ValueError(
            'extraire() a reçu un mélange de paragraphes corps et bibliographie : '
            'index ambigu. Séparer avant d\'appeler extraire() (voir analyser()).')

    return '\n'.join(lignes_corps), '\n'.join(lignes_biblio), index


# ---------------------------------------------------------------------------------
# Masquage des URL/DOI — CORPS SEULEMENT (jamais la bibliographie, voir l'en-tête).

_RE_URL_MASQUE = re.compile(r'\S+://\S+|www\.\S+|10\.\d{4,}/\S+')


def _masquer_urls(ligne):
    return _RE_URL_MASQUE.sub(lambda m: 'X' * len(m.group(0)), ligne)


# ---------------------------------------------------------------------------------
# Pont vers l'exécutable vale. Même détection que manuscrit_typo.py pour le PRINCIPE
# (sys.platform décide), mais réimplémentée ici, à dessein : ce module ne dépend d'aucun
# autre du pipeline (§3 du contrat, « ne sait rien de »), et manuscrit_typo.py est hors
# périmètre de ce chantier. Sous Linux (production : la CLI tourne DANS la WSL, §2 du
# contrat), vale s'appelle directement — jamais via wsl.exe, qui n'y existe pas. Sous
# Windows (postes de développement/tests), on passe par wsl.exe -d SZH-Publishing.

def _chemin_wsl_exe():
    racine = os.environ.get('WINDIR', 'C:\\Windows')
    chemin = os.path.join(racine, 'System32', 'wsl.exe')
    try:
        if os.path.exists(chemin):
            return chemin
    except OSError:
        pass
    return 'wsl.exe'


def _vers_wsl(wsl_exe, chemin_windows):
    # wsl.exe avale les antislashs d'un argument passé en tableau (mesuré ailleurs dans ce
    # chantier, manuscrit_typo.py) : convertir en barres obliques AVANT l'appel.
    chemin_windows = chemin_windows.replace('\\', '/')
    try:
        r = subprocess.run([wsl_exe, '-d', DISTRO, '--', 'wslpath', '-a', chemin_windows],
                            capture_output=True, timeout=DELAI_SECONDES)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise _ValeIndisponible('wslpath injoignable : %s' % e)
    if r.returncode != 0:
        raise _ValeIndisponible(
            'wslpath a échoué (%d) : %s' % (r.returncode, r.stderr.decode('utf-8', 'replace')))
    return r.stdout.decode('utf-8').strip()


def _executer(commande):
    try:
        r = subprocess.run(commande, capture_output=True, timeout=DELAI_SECONDES)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise _ValeIndisponible('vale introuvable ou injoignable : %s' % e)
    # ⚠ Mesuré le 19.09.2026, corrigeant une mesure du 18.09.2026 : le code de sortie de
    # `vale --output=JSON` ne dit RIEN de fiable (0 pour un --config absent, 2 pour une
    # règle YAML mal formée dans un style par ailleurs valide) — mais dans les DEUX cas,
    # l'erreur (un objet JSON portant une clé "Code", ex. "E100") atterrit sur STDERR,
    # jamais sur stdout, qui reste VIDE. Un stdout vide est donc le signal fiable, quel
    # que soit le code de sortie ou la nature de la panne.
    brut = r.stdout.decode('utf-8', 'replace').strip()
    try:
        sortie = json.loads(brut)
    except ValueError as e:
        # stdout vide (le cas le plus courant : configuration cassée, règle YAML mal
        # formée) tombe ici aussi — json.loads('') échoue déjà de lui-même, inutile de le
        # tester à part. Le diagnostic utile est sur stderr, jamais sur stdout dans ce cas.
        raise _ValeIndisponible(
            'sortie vale illisible : %s (stderr : %s)'
            % (e, r.stderr.decode('utf-8', 'replace')[:500]))
    return sortie


def _lancer_vale(fichiers, chemin_ini):
    if sys.platform.startswith('linux'):
        return _executer(['vale', '--output=JSON', '--config', chemin_ini] + list(fichiers))
    wsl_exe = _chemin_wsl_exe()
    ini_wsl = _vers_wsl(wsl_exe, chemin_ini)
    fichiers_wsl = [_vers_wsl(wsl_exe, f) for f in fichiers]
    # `bash -lc` (shell de CONNEXION), pas `--` nu : un poste de développement sans sudo
    # installe vale dans ~/.local/bin (mesuré le 18.09.2026), qui n'entre sur le PATH que
    # via .profile — jamais sourcé par une commande `wsl.exe -- vale` directe. L'image de
    # production (Containerfile, /usr/local/bin) fonctionnerait aussi bien sans ce détour,
    # mais un shell de connexion ne coûte rien de plus et rend le code robuste aux deux.
    commande = ' '.join(shlex.quote(a) for a in
                         ['vale', '--output=JSON', '--config', ini_wsl] + fichiers_wsl)
    return _executer([wsl_exe, '-d', DISTRO, '--', 'bash', '-lc', commande])


# ---------------------------------------------------------------------------------
# RAFFINEURS — la précision qu'un motif RE2 figé ne peut pas rendre (voir l'en-tête). Une
# fonction par Check Vale qui en a besoin, signature UNIQUE `f(constat, ligne_texte) ->
# dict|None` : `None` REJETTE le constat (rien n'est ajouté aux alertes, ce n'est pas une
# faute) ; un dict fournit found/suggested/action à la place de ce que Vale a rendu.

_RE_ET_AL = re.compile(r'\bet\s+al\b', re.IGNORECASE)
_RE_ET = re.compile(r'\bet\b')
_RE_DOI_CODE = re.compile(r'10\.\d{4,}\S*')
_RE_PARENTHESE = re.compile(r'\([^()]*\)')


def _raffiner_et_dans_parentheses(constat, ligne_texte):
    texte = constat['Match']
    if _RE_ET_AL.search(texte):
        return None  # « et al. » : jamais une faute, la forme est déjà correcte
    m = _RE_ET.search(texte)
    if not m:
        return None  # net large sans "et" isolé : rien à corriger (garde, ne devrait pas arriver)
    corrige = texte[:m.start()] + '&' + texte[m.end():]
    return {'found': 'et', 'suggested': '&', 'action': 'fix',
            'message': 'Citation à corriger (Revue : 3.1.3) : « %s » devient « %s ».'
                       % (texte, corrige)}


def _dans_une_parenthese(ligne_texte, position):
    return any(m.start() <= position < m.end() for m in _RE_PARENTHESE.finditer(ligne_texte))


def _raffiner_esperluette_hors_parentheses(constat, ligne_texte):
    debut = constat['_span0'][0]
    if _dans_une_parenthese(ligne_texte, debut):
        return None  # "&" correctement entre parenthèses : ce n'est pas cette règle-là
    return {'found': '&', 'suggested': 'et', 'action': 'fix'}


def _raffiner_doi_forme(constat, ligne_texte):
    m = _RE_DOI_CODE.search(constat['Match'])
    if not m:
        return None
    return {'found': constat['Match'], 'suggested': 'https://doi.org/' + m.group(0),
            'action': 'fix'}


def _raffiner_esperluette_biblio(constat, ligne_texte):
    texte = constat['Match']
    if ' et ' not in texte:
        return None
    return {'found': texte, 'suggested': texte.replace(' et ', ' & ', 1), 'action': 'fix'}


def _raffiner_cf(constat, ligne_texte):
    # ⚠ Vale (extends: substitution) ne peut pas capturer le point de « cf. » — borné au
    # token de mot par son propre analyseur, la ponctuation en est toujours exclue, quel que
    # soit le motif régulier demandé (mesuré : « cf\.? » ne rend jamais que "cf"). D'où
    # l'existence + ce raffinage : la majuscule d'origine décide seule de la forme suggérée,
    # jamais l'inverse.
    texte = constat['Match']  # "cf." ou "Cf."
    suggere = 'Voir' if texte[:1] == 'C' else 'voir'
    return {'found': texte, 'suggested': suggere, 'action': 'fix'}


RAFFINEURS = {
    'CSPS.APA.EtDansParentheses': _raffiner_et_dans_parentheses,
    'CSPS.APA.EsperluetteHorsParentheses': _raffiner_esperluette_hors_parentheses,
    'CSPS-Biblio.APA.DoiForme': _raffiner_doi_forme,
    'CSPS-Biblio.APA.Esperluette': _raffiner_esperluette_biblio,
    'CSPS.Vocabulaire.Cf': _raffiner_cf,
}


# ---------------------------------------------------------------------------------
# Conversion d'un constat Vale en alerte du contrat §7 (mêmes 7 champs que
# manuscrit_regles.evaluer(), plus `rule`).

def _convertir_alerte(constat, index, lignes):
    check = constat.get('Check')
    span_vale = constat.get('Span') or [0, 0]
    # ⚠ Mesuré le 18.09.2026 : Span de vale est [début 1-based, fin 1-based INCLUSE], pas
    # le [début, fin[ Python habituel. Conversion : début0 = début-1, fin0 = fin (le nombre
    # ne change pas, seule son INTERPRÉTATION passe d'« inclus » à « exclu »).
    span0 = [span_vale[0] - 1, span_vale[1]]
    ligne_num = constat.get('Line') or 0
    ligne_texte = lignes[ligne_num - 1] if 0 <= ligne_num - 1 < len(lignes) else ''

    action_vale = (constat.get('Action') or {}).get('Name')
    params = (constat.get('Action') or {}).get('Params') or []
    found = constat.get('Match')
    suggested = params[0] if action_vale == 'replace' and params else None
    action = 'fix' if action_vale == 'replace' else 'comment'
    message = constat.get('Message')

    raffineur = RAFFINEURS.get(check)
    if raffineur is not None:
        constat_enrichi = dict(constat)
        constat_enrichi['_span0'] = span0
        resultat = raffineur(constat_enrichi, ligne_texte)
        if resultat is None:
            return None
        found = resultat.get('found', found)
        suggested = resultat.get('suggested', suggested)
        action = resultat.get('action', action)
        message = resultat.get('message', message)

    return {
        'rule': check,
        'severity': constat.get('Severity'),
        'action': action,
        'para': index.get(ligne_num),
        'span': span0,
        'found': found,
        'suggested': suggested,
        'message': message,
    }


# ---------------------------------------------------------------------------------
# analyser() — le point d'entrée du module.

def analyser(paragraphes_corps, paragraphes_biblio, langue, racine_depot):
    """Rend (alertes, indisponible). `indisponible=True` <=> vale n'a pas pu tourner (absent,
    wsl.exe injoignable, config cassée) : `alertes` vaut alors [] et AUCUNE exception ne
    remonte — le rapport dit que le contrôle n'a pas été fait, jamais un plantage."""
    texte_corps, _vide1, index_corps = extraire(paragraphes_corps or [], langue)
    _vide2, texte_biblio, index_biblio = extraire(paragraphes_biblio or [], langue)

    lignes_corps = texte_corps.split('\n') if texte_corps else []
    lignes_biblio = texte_biblio.split('\n') if texte_biblio else []
    # Le masquage ne change JAMAIS la longueur d'une ligne (X pour X) : les Span calculés
    # sur le texte masqué restent valides sur `lignes_corps`, qui garde le texte D'ORIGINE
    # pour le raffinage et pour ce que l'alerte montre à la relectrice.
    lignes_corps_masquees = [_masquer_urls(l) for l in lignes_corps]

    dossier = tempfile.mkdtemp(prefix='szh-vale-')
    try:
        fichiers = []
        if lignes_corps:
            chemin = os.path.join(dossier, 'corps-%s.txt' % langue)
            with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
                f.write('\n'.join(lignes_corps_masquees))
            fichiers.append((chemin, index_corps, lignes_corps))
        if lignes_biblio:
            chemin = os.path.join(dossier, 'biblio-%s.txt' % langue)
            with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
                f.write('\n'.join(lignes_biblio))
            fichiers.append((chemin, index_biblio, lignes_biblio))

        if not fichiers:
            return [], False

        racine_vale = os.path.join(racine_depot, 'pipeline', 'vale')
        chemin_ini = os.path.join(racine_vale, '.vale.ini')

        try:
            sortie = _lancer_vale([f[0] for f in fichiers], chemin_ini)
        except _ValeIndisponible:
            return [], True

        alertes = []
        for chemin, index, lignes in fichiers:
            # vale rend ses clés dans le chemin qu'IL a vu (converti par wslpath côté
            # Windows) : jamais celui qu'on lui a passé côté appelant. On retrouve le bon
            # groupe de constats par le NOM DE FICHIER seul, pas par égalité de chemin.
            base = os.path.basename(chemin)
            for chemin_vale, constats in (sortie or {}).items():
                if os.path.basename(chemin_vale) == base:
                    for constat in constats:
                        alerte = _convertir_alerte(constat, index, lignes)
                        if alerte is not None:
                            alertes.append(alerte)
        return alertes, False
    finally:
        shutil.rmtree(dossier, ignore_errors=True)


# ---------------------------------------------------------------------------------
# CLI — trois modes, même patron que manuscrit_regles.py (--diagnostiquer/--catalogue) :
# jamais d'import direct depuis Node, toujours une CLI JSON sur stdin/stdout.
#
#   --texte <fichier.txt> --langue fr|de   essai à la main : un fichier déjà à un paragraphe
#                                           par ligne, chaque ligne non vide devient un
#                                           paragraphe de corps (role=''). Alertes en JSON
#                                           sur stdout, code de sortie non nul dès une error.
#
#   --extraire                             Contexte JSON {"paragraphes": [...], "langue":
#                                           "fr"} sur stdin -> {"texte_corps", "texte_biblio",
#                                           "index"} sur stdout. Sert aux tests de extraire()
#                                           sans fabriquer de fichier.
#
#   --analyser                             Contexte JSON {"paragraphes_corps": [...],
#                                           "paragraphes_biblio": [...], "langue": "fr"} sur
#                                           stdin -> {"alertes": [...], "indisponible": bool}
#                                           sur stdout. Sert aux tests d'analyser() : vale
#                                           absent, sabotage d'une règle YAML, etc.

def _reconfigurer_flux_utf8():
    # ⚠ Bug mesuré le 19.09.2026 : sans reconfigurer sys.stdin, sa lecture retombe sur
    # l'encodage par défaut du PROCESSUS APPELANT (la page de code active, pas forcément
    # UTF-8) — invisible depuis un terminal déjà basculé en UTF-8 (chcp 65001), mais un
    # appel depuis Node (child_process, page de code héritée, souvent cp1252) corrompait
    # silencieusement tout accent reçu sur stdin. Les trois flux se reconfigurent ensemble,
    # comme le fait déjà manuscrit_regles.py.
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass


def principal(argv):
    args = argv[1:]
    racine_depot = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    if '--extraire' in args:
        _reconfigurer_flux_utf8()
        try:
            entree = json.loads(sys.stdin.read())
        except Exception as e:
            print('[manuscrit_vale] JSON d\'entrée illisible : %s' % e, file=sys.stderr)
            return 1
        try:
            texte_corps, texte_biblio, index = extraire(
                entree.get('paragraphes') or [], entree.get('langue') or '')
        except ValueError as e:
            print('[manuscrit_vale] %s' % e, file=sys.stderr)
            return 1
        print(json.dumps({'texte_corps': texte_corps, 'texte_biblio': texte_biblio,
                           'index': index}, ensure_ascii=True))
        return 0

    if '--analyser' in args:
        _reconfigurer_flux_utf8()
        try:
            entree = json.loads(sys.stdin.read())
        except Exception as e:
            print('[manuscrit_vale] JSON d\'entrée illisible : %s' % e, file=sys.stderr)
            return 1
        alertes, indisponible = analyser(
            entree.get('paragraphes_corps') or [], entree.get('paragraphes_biblio') or [],
            entree.get('langue') or '', racine_depot)
        print(json.dumps({'alertes': alertes, 'indisponible': indisponible},
                          ensure_ascii=True))
        return 1 if any(a['severity'] == 'error' for a in alertes) else 0

    if '--texte' not in args or '--langue' not in args:
        print('usage : manuscrit_vale.py --texte <fichier.txt> --langue fr|de\n'
              '        manuscrit_vale.py --extraire   (Contexte JSON sur stdin)\n'
              '        manuscrit_vale.py --analyser   (Contexte JSON sur stdin)',
              file=sys.stderr)
        return 2

    chemin_texte = args[args.index('--texte') + 1]
    langue = args[args.index('--langue') + 1]
    _reconfigurer_flux_utf8()

    try:
        with open(chemin_texte, encoding='utf-8') as f:
            lignes = [l.rstrip('\n\r') for l in f]
    except OSError as e:
        print('[manuscrit_vale] fichier illisible : %s' % e, file=sys.stderr)
        return 1

    paragraphes = [{'source': i, 'texte': l, 'role': ''}
                   for i, l in enumerate(lignes) if l.strip()]

    alertes, indisponible = analyser(paragraphes, [], langue, racine_depot)
    if indisponible:
        print('[manuscrit_vale] vale indisponible : aucun contrôle effectué.', file=sys.stderr)
        return 0

    print(json.dumps(alertes, ensure_ascii=True, indent=2))
    return 1 if any(a['severity'] == 'error' for a in alertes) else 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
