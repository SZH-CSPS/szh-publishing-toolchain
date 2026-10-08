#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Analyse de texte commune à l'import des Word hérités (docx-meta.py) et au nettoyeur, sans
# OOXML : déclencheurs de tête, DOI, e-mail, ORCID, noms d'auteurs, légendes.

import re
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pronto_modele import LANGUES_META

# Une légende (« Figure 1 : … », « Tableau 2 — … ») n'est pas un titre ; szh-legendes.lua la
# traite. Utilisé par docx-titres.py, manuscrit_modele.py et manuscrit_gabarit.py.
RE_LEGENDE = re.compile(
    r'^(?:figure|fig\.?|abbildung|abb\.?|illustration|grafik|tableau|tabelle|table)\s+\d+',
    re.I)


# ---------------------------------------------------------------------------------
# Déclencheurs multilingues en tête de paragraphe. La langue d'un résumé vient de son
# déclencheur ; celle des mots-clés, de la langue du document (« Keywords: » s'écrit dans
# toutes les langues).

RE_RESUME = re.compile(
    r'^\s*(r[ée]sum[ée]|zusammenfassung|riassunto|abstract)\b\s*[:.]?\s*', re.I)
LANG_RESUME = {'resume': 'fr', 'zusammenfassung': 'de', 'riassunto': 'it'}
RE_KEYWORDS = re.compile(
    r'^\s*(keywords?|mots[- ]cl[ée]s?|schl[üu]sselw[öo]rter|schlagw[öo]rte?r?|'
    r'parole chiave)\b\s*[:.]?\s*', re.I)
RE_DOI_LIGNE = re.compile(r'^\s*doi\b\s*:?\s*', re.I)
RE_DOI = re.compile(r'\b(10\.\d{4,9}/[^\s<>"\']+)')
RE_JOURNAL = re.compile(
    r'^\s*(revue\s+suisse\s+de\s+p[ée]dagogie|'
    r'schweizerische\s+zeitschrift\s+f[üu]r\s+heilp[äa]dagogik)', re.I)


def langue_resume(declencheur):
    d = re.sub(r'[^a-z]', '', declencheur.lower().replace('é', 'e').replace('è', 'e'))
    return LANG_RESUME.get(d)          # None pour « abstract » : langue du document


def nettoyer_doi(txt):
    m = RE_DOI.search(txt)
    if not m:
        return ''
    return m.group(1).rstrip('.,;:)]}')


def langue_du_doi(doi):
    """10.57161/r2023-03-08 -> fr ; 10.57161/z2026-03-01 -> de (préfixe de revue)."""
    m = re.search(r'/([rz])\d{4}-', doi)
    if not m:
        return None
    return 'fr' if m.group(1) == 'r' else 'de'


def decouper_keywords(texte, langue_doc):
    """Ligne de mots-clés -> {langue: [mots]}. Forme bilingue « kw fr, kw fr / kw de, kw de »
    (barre oblique entourée d'espaces, virgules des deux côtés) : la moitié gauche va à la
    langue du document, la droite à l'autre. Sinon tout va à la langue du document,
    découpé sur , ; · et « / »."""
    langue_doc = langue_doc if langue_doc in LANGUES_META else 'fr'
    moities = re.split(r'\s+/\s+', texte)
    if len(moities) == 2 and ',' in moities[0] and ',' in moities[1] \
            and langue_doc in ('fr', 'de'):
        autre = 'de' if langue_doc == 'fr' else 'fr'
        return {langue_doc: decouper_liste(moities[0]), autre: decouper_liste(moities[1])}
    return {langue_doc: decouper_liste(' ; '.join(moities))}


def decouper_liste(texte):
    mots = []
    for m in re.split(r'[;,·]', texte):
        m = m.strip().strip('.').strip()
        if m:
            mots.append(m)
    return mots


# ---------------------------------------------------------------------------------
# Titre à deux-points : le sous-titre suit souvent le titre sur la même ligne, sans style
# propre (« Inclusion scolaire : le rôle de l'enseignant »). On coupe au premier
# deux-points suivi d'une espace, ce qui écarte heures (« 10:30 ») et URL (« https:// »).
# Seul le premier deux-points est examiné : une heure en tête de titre empêche la coupe.

RE_TITRE_DEUX_POINTS = re.compile(r'^([^:]+?)\s*:\s+(\S.*)$')


def scinder_titre(titre):
    """(titre, sous-titre), le sous-titre valant '' si la ligne ne se coupe pas."""
    m = RE_TITRE_DEUX_POINTS.match(titre or '')
    if not m:
        return (titre or '').strip(), ''
    gauche, droite = m.group(1).strip(), m.group(2).strip()
    # Une numérotation n'est pas un titre : « 2 : Die Schule » reste d'une seule pièce.
    if not gauche or not droite or not re.search(r'[^\W\d_]', gauche, re.UNICODE):
        return (titre or '').strip(), ''
    return gauche, droite


# ---------------------------------------------------------------------------------
# Ligne d'auteurs (byline sous le titre) et cellules du tableau des auteurs.

CONNECTEURS = re.compile(
    r',?\s*(?:en\s+collaboration\s+avec|in\s+zusammenarbeit\s+mit|'
    r'unter\s+mitarbeit\s+von|avec\s+la\s+collaboration\s+de)\s+'
    r'|\s+(?:et|und|and|&|avec|mit)\s+'
    r'|\s*[,;]\s*', re.I)
PARTICULES = {'de', 'von', 'van', 'der', 'den', 'da', 'di', 'du', 'le', 'la', 'a',
              'ten', 'ter', 'te', 'zu', 'zur', 'vom', 'am', 'y', 'e', 'dos', 'del'}
TITRES_ACAD = {'dr', 'dre', 'drs', 'dott', 'ssa', 'prof', 'pd', 'dres', 'phil', 'lic', 'iur', 'med', 'rer', 'nat',
               'dipl', 'msc', 'ma', 'ba', 'bsc', 'phd', 'em', 'ém', 'emer', 'hab',
               'habil', 'des', 'theol', 'psych',
               'hc', 'mag', 'mlaw', 'blaw', 'msed', 'edd', 'mba', 'ms', 'mph', 'ing',
               'paed', 'päd', 'soz', 'pol', 'oec', 'hsg', 'msw', 'bsw', 'ded', 'sc',
               'h', 'c', 'univ', 'doz', 'priv'}
# Suffixe féminin autrichien collé au titre (« Dr.in », « Prof.in ») : admis seulement à
# côté d'un vrai titre dans le même jeton.
SUFFIXES_TITRE = {'in', 'innen'}
# Liants entre titres (« Dr. Dr. et Prof. h. c. ») : retirés seulement après un titre.
LIANTS_TITRE = {'et', 'und', 'and', '&', '/'}
RE_EMAIL = re.compile(r'\b([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b')
RE_ORCID = re.compile(r'\b(\d{4}-\d{4}-\d{4}-\d{3}[\dxX])\b')


def _est_titre_academique(jeton):
    """Vrai si tous les fragments du jeton (coupé sur . - /) sont des titres ou des
    suffixes, dont au moins un titre : « Univ.-Prof. », « Dipl.-Psych. », « Dr.in »."""
    fragments = [f for f in re.split(r'[.\-/]', jeton.strip('.,;')) if f]
    if not fragments:
        return False
    vrais = 0
    for f in fragments:
        f = f.lower()
        if f in TITRES_ACAD:
            vrais += 1
        elif f not in SUFFIXES_TITRE:
            return False
    return vrais > 0


def _oter_titres(jetons, gauche):
    """Retire les titres académiques d'un bout de la liste, liants compris dès qu'un titre
    a été retiré de ce côté. Rend le nombre de jetons retirés."""
    otes = 0
    while jetons:
        j = jetons[0] if gauche else jetons[-1]
        if _est_titre_academique(j):
            pass
        elif otes and j.strip('.,;').lower() in LIANTS_TITRE:
            pass
        else:
            break
        jetons.pop(0 if gauche else -1)
        otes += 1
    return otes


def _sans_titres_academiques(t):
    """Retire les titres académiques en tête (« Dr. phil. Romain Lanners »), et après la
    première virgule s'il n'y a que des titres (« L. Tönnissen, lic. phil. »)."""
    t = t.replace('†', ' ').strip().strip(',;').strip()
    morceaux = t.split(',', 1)
    if len(morceaux) == 2:
        queue = [x for x in morceaux[1].replace('/', ' ').split() if x]
        # « , M. A. » : un titre écrit lettre par lettre ne se lit pas jeton par jeton.
        colle = ''.join(queue).replace('.', '').lower()
        if queue and (all(_est_titre_academique(x) for x in queue)
                      or colle in TITRES_ACAD):
            t = morceaux[0]
    jetons = t.split()
    _oter_titres(jetons, True)
    _oter_titres(jetons, False)
    return ' '.join(jetons).strip().strip(',;').strip()


sans_titres_academiques = _sans_titres_academiques   # alias public (manuscrit_noms.py)


# Lignes de rôle dans les cellules du tableau des auteurs (« Article rédigé par »,
# « Entretien réalisé par »…), seules sur leur ligne avant le nom. Elles sont sautées : la
# fiche d'auteur n'a pas de champ rôle.
RE_ROLE = re.compile(
    r'^(article\s+r[ée]dig[ée]\s+par|en\s+collaboration\s+avec|'
    r'entretien\s+(r[ée]alis[ée]|men[ée])\s+par|propos\s+recueillis\s+par|'
    r'avec,?\s+comme\s+invit[ée]e?s?|interview\s+(gef[üu]hrt\s+von|mit)|'
    r'ein\s+interview\s+(mit|von)|im\s+gespr[äa]ch\s+mit|'
    r'unter\s+mitarbeit\s+von|in\s+zusammenarbeit\s+mit)\s*:?\s*$', re.I)


def decouper_ligne_nom(t):
    """(nom_nettoye, reste_fonction). Si la partie avant la première virgule est un nom
    plausible, la suite, sans ses titres de tête, devient le début de la fonction :
    « Sabrina Eigenmann, MA Studienleitung MAS IF » -> (« Sabrina Eigenmann »,
    « Studienleitung MAS IF »). ('', '') si aucun nom n'est trouvé."""
    nettoye = _sans_titres_academiques(t)
    if nom_plausible(nettoye):
        return nettoye, ''
    morceaux = t.split(',', 1)
    if len(morceaux) == 2:
        gauche = _sans_titres_academiques(morceaux[0])
        if nom_plausible(gauche):
            jetons = morceaux[1].split()
            _oter_titres(jetons, True)
            return gauche, ' '.join(jetons).strip()
    return '', ''


def nom_plausible(t):
    """« Prénom Nom » plausible : 2-6 jetons, capitalisés (particules tolérées),
    pas de chiffre, pas d'e-mail, longueur bornée."""
    if not t or len(t) > 60 or any(c.isdigit() for c in t) or '@' in t:
        return False
    jetons = t.split()
    if not 2 <= len(jetons) <= 6:
        return False
    capitalises = 0
    for j in jetons:
        base = j.strip('.,;«»"()')
        if not base:
            return False
        if base[0].isupper():
            capitalises += 1
        elif base.lower() not in PARTICULES:
            return False
    return capitalises >= 2


def decouper_prenom_nom(t):
    """Premier jeton = prénom, le reste = nom (« Anne-Françoise de Chambrier », « Rachel
    Sermier Dessemontet »). Un seul jeton : tout dans nom."""
    jetons = t.split()
    if len(jetons) >= 2:
        return jetons[0], ' '.join(jetons[1:])
    return '', t


def auteurs_depuis_byline(txt):
    """« A B, C D et E F » -> [{prenom, nom}] ; segment non plausible -> tout en nom."""
    auteurs = []
    for part in CONNECTEURS.split(txt):
        part = (part or '').strip().strip(',;').replace('†', '').strip()
        if not part:
            continue
        part = _sans_titres_academiques(part)
        if not part:
            continue
        if nom_plausible(part):
            prenom, nom = decouper_prenom_nom(part)
        else:
            prenom, nom = '', part
        auteurs.append({'prenom': prenom, 'nom': nom})
    return auteurs


def ressemble_a_une_reference(t):
    """Vrai si le paragraphe ressemble à une référence bibliographique. Sert seulement à
    décider s'il faut signaler une référence restée dans le texte (le style seul décide
    de ce qui est détaché) : une note ou une annexe après la liste ne déclenche pas
    d'alerte."""
    if len(t) < 25:
        return False
    if t.startswith('http'):
        return True
    if not (re.search(r'[(,\s][12][09]\d\d[a-z]?[).,;\s]', t)
            or any(x in t for x in ('sous presse', 'en préparation', 'in press',
                                    'im Druck'))):
        return False
    return bool(re.search(r'[A-Z]\.', t) or re.match(r"^[^\W\d_][\w'’-]*,", t)
                or 'http' in t)
