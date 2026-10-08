#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Pont Vale du nettoyeur de manuscrit (voir docs/ARCHITECTURE-nettoyeur-manuscrit.md).
# Les règles (épicène, vocabulaire du handicap, casse, APA) sont en YAML dans pipeline/vale/
# (voir son LISEZMOI.md). Vale est un binaire de l'image WSL.
#
# Le module écrit le texte dans des .txt (un paragraphe par ligne), lance
# `vale --output=JSON` et traduit chaque constat Vale en alerte du nettoyeur.
#
# Vale (Go, RE2) n'a ni lookahead ni lookbehind. Certaines règles ont donc un motif YAML
# large (une citation entière, une entrée bibliographique) ; les RAFFINEURS ci-dessous en
# tirent le mot exact à corriger, ou rejettent le constat quand le contexte l'écarte
# (« et al. », un « & » déjà entre parenthèses).
#
# Les URL et DOI du corps sont masqués avant Vale (remplacés par des X, à longueur égale
# pour garder les positions) : « downloads/sections » lèverait la règle des formes
# contractées « mot/mot ». La bibliographie reste en clair pour APA.DoiForme.

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

DELAI_SECONDES = 60


class _ValeIndisponible(Exception):
    """vale absent, wsl.exe injoignable ou configuration cassée. analyser() la capture et
    rend (alertes=[], indisponible=True)."""


def extraire(paragraphes, langue):
    """Rend (texte_corps, texte_biblio, index) : un paragraphe par ligne, et l'index qui
    associe chaque numéro de ligne (à partir de 1) à la source du paragraphe.

    Tous les paragraphes doivent être du corps, ou tous de la bibliographie : un mélange
    rendrait l'index ambigu, et lève ValueError. `langue` n'est pas utilisée."""
    lignes_corps = []
    lignes_biblio = []
    index = {}
    for p in (paragraphes or []):
        # Un saut de ligne résiduel casserait « une ligne = un paragraphe ».
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


# Masquage des URL et DOI du corps (voir l'en-tête).
_RE_URL_MASQUE = re.compile(r'\S+://\S+|www\.\S+|10\.\d{4,}/\S+')


def _masquer_urls(ligne):
    return _RE_URL_MASQUE.sub(lambda m: 'X' * len(m.group(0)), ligne)


# Lancement de vale, dans la WSL.
#
# Hors shell de connexion, ~/.local/bin n'est pas sur le PATH (.profile n'est pas lu). On
# cherche donc vale dans le PATH, puis dans /usr/local/bin (image de production), puis dans
# ~/.local/bin (poste de développement sans sudo).
#
# Ce module n'écrit rien sur stderr : l'appelant pourrait recopier la ligne telle quelle
# dans le journal. Le chemin retenu se lit avec --resoudre-vale-bin.

def _resoudre_vale_bin(repertoire_personnel=None):
    """Chemin du binaire vale. `repertoire_personnel` remplace le domicile dans les tests :
    sous Windows, os.path.expanduser('~') ignore HOME."""
    chemin = shutil.which('vale')
    if chemin:
        return chemin
    domicile = repertoire_personnel if repertoire_personnel is not None else os.path.expanduser('~')
    for candidat in ('/usr/local/bin/vale', os.path.join(domicile, '.local', 'bin', 'vale')):
        if os.path.isfile(candidat) and os.access(candidat, os.X_OK):
            return candidat
    return 'vale'  # introuvable : _executer() échouera avec son message


def _executer(commande):
    try:
        r = subprocess.run(commande, capture_output=True, timeout=DELAI_SECONDES)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise _ValeIndisponible('vale introuvable ou injoignable : %s' % e)
    # Le code de sortie de vale n'est pas fiable (0 pour un --config absent, 2 pour une règle
    # mal formée). En cas de panne, stdout reste vide et l'erreur part sur stderr : c'est
    # stdout qui fait foi.
    brut = r.stdout.decode('utf-8', 'replace').strip()
    try:
        sortie = json.loads(brut)
    except ValueError as e:
        # Couvre aussi le stdout vide ; le diagnostic est sur stderr.
        raise _ValeIndisponible(
            'sortie vale illisible : %s (stderr : %s)'
            % (e, r.stderr.decode('utf-8', 'replace')[:500]))
    return sortie


def _lancer_vale(fichiers, chemin_ini):
    vale_bin = _resoudre_vale_bin()
    return _executer([vale_bin, '--output=JSON', '--config', chemin_ini] + list(fichiers))


# RAFFINEURS : une fonction par règle Vale qui en a besoin, `f(constat, ligne_texte)`.
# None rejette le constat ; un dict remplace found, suggested, action, message ou span.
# constat['_span0'] est la position du motif dans la ligne, en [début, fin[.

_RE_ET_AL = re.compile(r'\bet\s+al\b', re.IGNORECASE)
_RE_ET = re.compile(r'\bet\b')
_RE_DOI_CODE = re.compile(r'10\.\d{4,}\S*')
_RE_PARENTHESE = re.compile(r'\([^()]*\)')


def _raffiner_et_dans_parentheses(constat, ligne_texte):
    texte = constat['Match']
    if _RE_ET_AL.search(texte):
        return None  # « et al. » est correct
    m = _RE_ET.search(texte)
    if not m:
        return None
    corrige = texte[:m.start()] + '&' + texte[m.end():]
    # `found` ne vise que « et » : le span doit viser ce mot seul, en position dans le
    # paragraphe. Sinon manuscrit_annoter.py ne retrouve pas le mot et commente tout le
    # paragraphe.
    debut_motif = constat['_span0'][0]
    return {'found': 'et', 'suggested': '&', 'action': 'fix',
            'span': [debut_motif + m.start(), debut_motif + m.end()],
            'message': 'Citation à corriger (Revue : 3.1.3) : « %s » devient « %s ».'
                       % (texte, corrige)}


def _dans_une_parenthese(ligne_texte, position):
    return any(m.start() <= position < m.end() for m in _RE_PARENTHESE.finditer(ligne_texte))


# Forme d'une entrée de bibliographie, « Nom, I., [Nom, I. &] … (2021) », en tête de ligne.
# Le « & » y est la norme APA. Sert quand l'intitulé de la bibliographie n'a pas été
# reconnu et que ses entrées sont analysées comme du corps.
_RE_LIGNE_REFERENCE = re.compile(
    r"^\s*[A-ZÀ-ÞŒ][\w'’\- ]{0,40},\s*(?:[A-ZÀ-ÞŒ]\.[\s\-]*)+.{0,300}?"
    r"\((?:19|20)\d{2}[a-z]?[^()]*\)")


def _raffiner_esperluette_hors_parentheses(constat, ligne_texte):
    debut = constat['_span0'][0]
    if _dans_une_parenthese(ligne_texte, debut):
        return None  # « & » entre parenthèses : correct
    if _RE_LIGNE_REFERENCE.match(ligne_texte):
        return None  # une référence, pas du texte courant
    return {'found': '&', 'suggested': 'et', 'action': 'fix'}


def _raffiner_doi_forme(constat, ligne_texte):
    m = _RE_DOI_CODE.search(constat['Match'])
    if not m:
        return None
    return {'found': constat['Match'], 'suggested': 'https://doi.org/' + m.group(0),
            'action': 'fix'}


# Zeitschrift : « und » dans le texte courant, « & » dans la référence entre parenthèses.
# Même mécanisme que la paire française EtDansParentheses / EsperluetteHorsParentheses.
_RE_UND = re.compile(r'\bund\b')


def _raffiner_und_in_klammern(constat, ligne_texte):
    texte = constat['Match']
    if _RE_ET_AL.search(texte):
        return None  # « et al. » est correct, en allemand aussi
    m = _RE_UND.search(texte)
    if not m:
        return None
    corrige = texte[:m.start()] + '&' + texte[m.end():]
    # Span recalculé sur « und » seul, comme dans _raffiner_et_dans_parentheses.
    debut_motif = constat['_span0'][0]
    return {'found': 'und', 'suggested': '&', 'action': 'fix',
            'span': [debut_motif + m.start(), debut_motif + m.end()],
            'message': 'Zitation korrigieren (Zeitschrift: Literaturverzeichnis): «%s» wird'
                       ' «%s».' % (texte, corrige)}


def _raffiner_kaufmannsund_ausserhalb_klammern(constat, ligne_texte):
    debut = constat['_span0'][0]
    if _dans_une_parenthese(ligne_texte, debut):
        return None  # « & » entre parenthèses : correct
    if _RE_LIGNE_REFERENCE.match(ligne_texte):
        return None  # une référence, pas du texte courant
    return {'found': '&', 'suggested': 'und', 'action': 'fix'}


# Revue : les abréviations etc., min. et max. vont entre parenthèses ou en note. Le motif
# YAML les attrape toutes ; on écarte celles déjà entre parenthèses.
def _raffiner_abreviation_hors_parentheses(constat, ligne_texte):
    debut = constat['_span0'][0]
    if _dans_une_parenthese(ligne_texte, debut):
        return None
    return {}


# Revue : le nom propre d'un texte légal ou d'une institution ne se corrige pas (« Convention
# relative aux droits des personnes handicapées (CDPH) », « Bureau fédéral de l'égalité pour
# les personnes handicapées »). Le motif YAML attrape « personne(s) handicapée(s) » ; on
# écarte le constat si un mot comme loi, convention, bureau, office… le précède de peu, ou
# si un sigle entre parenthèses le suit.
_RE_NOM_LOI_AVANT = re.compile(
    r'\b(?:loi|convention|ordonnance|comit[ée]|bureau|conseil|office|d[ée]partement|'
    r'session|association|fondation)\b', re.IGNORECASE)
_RE_SIGLE_APRES = re.compile(r'^[\s,]{0,5}\([A-ZÉÈÀÇ][\wÉÈÀÇ.\'-]{0,15}\)')


# En APA, une communication personnelle (« persönliche Kommunikation ») n'a pas de page.
_RE_PERSOENLICHE_KOMMUNIKATION = re.compile(
    r'pers(?:önliche|\.)\s*Komm', re.IGNORECASE)


def _raffiner_woertliches_zitat_seite(constat, ligne_texte):
    if _RE_PERSOENLICHE_KOMMUNIKATION.search(constat['Match']):
        return None
    return {}


def _raffiner_handicap_personne(constat, ligne_texte):
    debut, fin = constat['_span0']
    avant = ligne_texte[max(0, debut - 90):debut]
    apres = ligne_texte[fin:fin + 25]
    if _RE_NOM_LOI_AVANT.search(avant) or _RE_SIGLE_APRES.match(apres):
        return None  # nom propre officiel
    return {'suggested': 'personne(s) en situation de handicap', 'action': 'fix'}


def _raffiner_esperluette_biblio(constat, ligne_texte):
    texte = constat['Match']
    if ' et ' not in texte:
        return None
    return {'found': texte, 'suggested': texte.replace(' et ', ' & ', 1), 'action': 'fix'}


def _raffiner_cf(constat, ligne_texte):
    # Une règle Vale de type substitution s'arrête au mot et ne capture pas le point de
    # « cf. » (« cf\.? » ne rend que « cf »). La règle est donc de type existence, et la
    # suggestion se fait ici, en gardant la majuscule d'origine.
    texte = constat['Match']  # "cf." ou "Cf."
    suggere = 'Voir' if texte[:1] == 'C' else 'voir'
    return {'found': texte, 'suggested': suggere, 'action': 'fix'}


RAFFINEURS = {
    'CSPS.APA.EtDansParentheses': _raffiner_et_dans_parentheses,
    'CSPS.APA.EsperluetteHorsParentheses': _raffiner_esperluette_hors_parentheses,
    'CSPS-Biblio.APA.DoiForme': _raffiner_doi_forme,
    'CSPS-Biblio.APA.Esperluette': _raffiner_esperluette_biblio,
    'CSPS.Vocabulaire.Cf': _raffiner_cf,
    'CSPS.Vocabulaire.HandicapPersonne': _raffiner_handicap_personne,
    'CSPS.Forme.AbreviationHorsParentheses': _raffiner_abreviation_hors_parentheses,
    'SZH.APA.UndInKlammern': _raffiner_und_in_klammern,
    'SZH.APA.KaufmannsUndAusserhalbKlammern': _raffiner_kaufmannsund_ausserhalb_klammern,
    'SZH.APA.WoertlichesZitatSeite': _raffiner_woertliches_zitat_seite,
}


# Convertit un constat Vale en alerte du nettoyeur : les mêmes champs que
# manuscrit_regles.evaluer(), plus `rule`.

def _convertir_alerte(constat, index, lignes):
    check = constat.get('Check')
    span_vale = constat.get('Span') or [0, 0]
    # Le Span de Vale compte à partir de 1, fin incluse ; on le passe en [début, fin[ à
    # partir de 0.
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
        # Un raffineur qui réduit `found` fournit aussi le span correspondant :
        # manuscrit_annoter.py exige que le span recouvre exactement `found`.
        span0 = resultat.get('span', span0)

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


def analyser(paragraphes_corps, paragraphes_biblio, langue, racine_depot):
    """Point d'entrée du module. Rend (alertes, indisponible). Si vale n'a pas pu tourner,
    rend ([], True) sans lever : le rapport dit que le contrôle n'a pas été fait."""
    texte_corps, _vide1, index_corps = extraire(paragraphes_corps or [], langue)
    _vide2, texte_biblio, index_biblio = extraire(paragraphes_biblio or [], langue)

    lignes_corps = texte_corps.split('\n') if texte_corps else []
    lignes_biblio = texte_biblio.split('\n') if texte_biblio else []
    # Le masquage garde la longueur des lignes : les positions de Vale restent valables sur
    # `lignes_corps`, le texte d'origine, qui sert au raffinage et aux alertes.
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
            # Vale peut écrire le chemin autrement qu'on le lui a passé : on apparie par le
            # nom de fichier seul.
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


# Ligne de commande, JSON sur stdin et stdout :
#
#   --texte <fichier.txt> --langue fr|de   essai à la main : chaque ligne non vide est un
#                                           paragraphe de corps. Alertes en JSON ; code de
#                                           sortie non nul s'il y a une erreur.
#   --extraire                             {"paragraphes", "langue"} -> {"texte_corps",
#                                           "texte_biblio", "index"}. Pour les tests.
#   --analyser                             {"paragraphes_corps", "paragraphes_biblio",
#                                           "langue"} -> {"alertes", "indisponible"}.
#   --resoudre-vale-bin                    affiche le binaire vale retenu, sans le lancer.

def _reconfigurer_flux_utf8():
    # Sans cela, stdin se lit dans la page de code héritée du processus appelant (souvent
    # cp1252 depuis Node), et les accents sont corrompus.
    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass


def principal(argv):
    args = argv[1:]
    racine_depot = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

    if '--resoudre-vale-bin' in args:
        # --domicile-factice (tests) remplace le domicile pour le repli ~/.local/bin.
        _reconfigurer_flux_utf8()
        domicile_factice = None
        if '--domicile-factice' in args:
            domicile_factice = args[args.index('--domicile-factice') + 1]
        print(_resoudre_vale_bin(domicile_factice))
        return 0

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
              '        manuscrit_vale.py --analyser   (Contexte JSON sur stdin)\n'
              '        manuscrit_vale.py --resoudre-vale-bin   (chemin choisi, sans lancer vale)',
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
