#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Fonctions communes aux scripts Python du pipeline : avertissement à la rédaction
(avertir), lecture simple de buch.yaml et ausgabe.yaml (lire_yaml), slug d'un nom de
fichier (slugifier, identique au Makefile), écriture atomique (ecrire_atomique), texte d'un
run Word, requête HTTP et chargement d'un module à tiret. Bibliothèque standard seule : la
WSL n'a pas PyYAML, et portraits.py et cmyk-rgb.py tournent dans un venv séparé
(/opt/portraits).

Chaque script importe ce module en s'ajoutant lui-même au chemin de recherche :

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import szh_commun

Rien ici n'a d'effet de bord au chargement.
"""

import os
import re
import sys
import unicodedata
import urllib.request

# ---------------------------------------------------------------------------------------
# Avertissement à la rédaction : une ligne « préfixe code | champs… | fr | [de] de », le
# préfixe venant de l'appelant et le code étant stable. Écrite sur stderr, et ajoutée à
# SZH_IMPORT_LOG si la variable est posée ; une erreur d'écriture du journal est ignorée.
# ---------------------------------------------------------------------------------------

def formater_avertissement(prefixe, code, champs, fr, de):
    """La ligne seule, sans l'écrire (reimporter.py la garde dans Voix.lignes)."""
    return ' | '.join([prefixe + ' ' + code] + list(champs) + [fr, '[de] ' + de])


def journaliser(ligne, journal):
    """Ajoute `ligne` à `journal` si un chemin est donné. Une erreur d'écriture (dossier
    disparu, droits, OneDrive…) est ignorée : le journal ne doit pas faire échouer
    l'appelant."""
    if not journal:
        return
    try:
        with open(journal, 'a', encoding='utf-8', newline='\n') as f:
            f.write(ligne + '\n')
    except OSError:
        pass


def avertir(prefixe, code, champs, fr, de, journal=None, flush=False):
    """Écrit l'avertissement sur stderr et dans le journal, et rend la ligne. `journal` :
    chemin explicite (reimporter.py) ; à défaut, SZH_IMPORT_LOG. `flush` : vidage immédiat
    de stderr."""
    if journal is None:
        journal = os.getenv('SZH_IMPORT_LOG')
    ligne = formater_avertissement(prefixe, code, champs, fr, de)
    print(ligne, file=sys.stderr, flush=flush)
    journaliser(ligne, journal)
    return ligne


# ---------------------------------------------------------------------------------------
# Lecture simple d'un YAML de la maison (buch.yaml, ausgabe.yaml) : une clé par ligne,
# listes en tirets ou en ligne, sous-blocs indentés d'un niveau (voir lire_yaml()).
# ---------------------------------------------------------------------------------------

def _valeur(brut):
    v = brut.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in ('"', "'"):
        v = v[1:-1]
    if v in ('true', 'True'):
        return True
    if v in ('false', 'False'):
        return False
    return v


def _valeur_ou_liste(brut):
    """Comme _valeur, mais « [a, b] » rend une liste : la forme en ligne d'une liste."""
    v = brut.strip()
    if v.startswith('[') and v.endswith(']'):
        return [_valeur(x) for x in v[1:-1].split(',') if x.strip()]
    return _valeur(v)


def lire_yaml(chemin):
    """Rend un dict. Trois formes sont lues :

        cle: valeur              -> chaîne, booléen
        cle: [a, b]              -> liste sur une ligne (aussi sous un tiret ou en sous-clé)
        cle:                     -> bloc, suivi soit de « - item » (liste), soit de
          sous-cle: valeur          lignes indentées (dict)

    Ce n'est pas un analyseur YAML : il lit les fichiers qu'écrit le cockpit et ignore les
    autres constructions.
    """
    racine = {}
    try:
        lignes = open(chemin, encoding='utf-8-sig').read().splitlines()
    except OSError:
        return racine
    cle = None          # la clé de premier niveau en cours de remplissage
    conteneur = None    # la liste ou le dict qu'elle porte, quand elle en porte un
    for ligne in lignes:
        if not ligne.strip() or ligne.lstrip().startswith('#'):
            continue
        indent = len(ligne) - len(ligne.lstrip())
        nu = ligne.strip()

        # Dans les fiches de la maison, un item de liste commence en colonne 0 (`author:`
        # puis `- prenom: …`). Le tiret se teste donc avant l'indentation, sinon
        # « - prenom » serait pris pour une clé de premier niveau.
        if indent == 0 and not nu.startswith('- '):
            if ':' not in nu:
                continue
            c, _, v = nu.partition(':')
            cle, v = c.strip(), v.strip()
            conteneur = None
            if v == '':
                racine[cle] = None          # bloc : la ligne suivante dira lequel
            else:
                racine[cle] = _valeur_ou_liste(v)
            continue

        if cle is None:
            continue

        if nu.startswith('- '):
            if not isinstance(conteneur, list):
                conteneur = []
                racine[cle] = conteneur
            item = nu[2:]
            if ':' in item:
                c, _, v = item.partition(':')
                conteneur.append({c.strip(): _valeur_ou_liste(v)})
            else:
                conteneur.append(_valeur(item))
            continue

        if ':' in nu:
            c, _, v = nu.partition(':')
            # Ligne indentée sous un tiret : elle complète le dernier item de la liste.
            if isinstance(conteneur, list) and conteneur and isinstance(conteneur[-1], dict):
                conteneur[-1][c.strip()] = _valeur_ou_liste(v)
                continue
            if not isinstance(conteneur, dict):
                conteneur = {}
                racine[cle] = conteneur
            conteneur[c.strip()] = _valeur_ou_liste(v)
    return racine


# ---------------------------------------------------------------------------------------
# Slug, identique à celui de la cible `import` du Makefile :
#   nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
# Les deux doivent rester alignés : un même titre donne le même nom de dossier, quel que
# soit le script qui l'a créé.
# ---------------------------------------------------------------------------------------

def slugifier(nom_fichier: str) -> str:
    """
    nom sans extension | ligatures françaises | NFD sans diacritiques | minuscules |
    [^a-z0-9]+ -> '-' | trim '-'. Vide -> 'article'.
    """
    s = re.sub(r'\.[^.]*$', '', nom_fichier)

    s = s.replace('œ', 'oe').replace('Œ', 'oe')
    s = s.replace('æ', 'ae').replace('Æ', 'ae')
    s = s.replace('ß', 'ss')

    s = unicodedata.normalize('NFD', s)
    s = re.sub(r'[̀-ͯ]', '', s)

    s = s.lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    s = re.sub(r'^-+|-+$', '', s)

    return s or 'article'


LONGUEUR_MAX_SLUG = 39


def borner_slug(s: str) -> str:
    """
    Coupe au dernier mot entier plutôt qu'au caractère près.
    Retire les segments orphelins d'une lettre à la fin (élisions comme « d-enseignement »).
    """
    if len(s) <= LONGUEUR_MAX_SLUG:
        return s

    coupe = s[:LONGUEUR_MAX_SLUG]
    i = coupe.rfind('-')
    court = coupe[:i] if i > 0 else coupe

    sans_orphelin = re.sub(r'(-[a-z0-9])+$', '', court)
    if '-' in sans_orphelin:
        court = sans_orphelin

    return court


def slugifier_chapitre(titre: str) -> str:
    """Slug d'un chapitre : slugifier puis borner, sans le complément de deux chiffres des
    articles."""
    return borner_slug(slugifier(titre))


# ---------------------------------------------------------------------------------------
# Écriture atomique : OneDrive et le cockpit ne voient jamais un fichier à moitié écrit. Le
# contenu passe par un temporaire du même dossier, remplacé par os.replace (atomique sur un
# même volume) et supprimé si l'écriture échoue.
# ---------------------------------------------------------------------------------------

def ecrire_atomique(chemin, ecrire, binaire=True, encoding=None, newline=None,
                     prefixe_tmp='.~'):
    """`ecrire(flux)` reçoit le fichier temporaire déjà ouvert et y écrit le contenu voulu.
    `binaire` choisit le mode d'ouverture ('wb' ou 'w', avec `encoding`/`newline` dans ce
    second cas). `prefixe_tmp` : préfixe du nom temporaire (cmyk-rgb.py passe « ~$ »)."""
    dossier = os.path.dirname(chemin) or '.'
    tmp = os.path.join(dossier, '%s%s.%d.tmp' % (prefixe_tmp, os.path.basename(chemin),
                                                  os.getpid()))
    mode = 'wb' if binaire else 'w'
    kwargs = {} if binaire else {'encoding': encoding, 'newline': newline}
    try:
        with open(tmp, mode, **kwargs) as flux:
            ecrire(flux)
        os.replace(tmp, chemin)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


# ---------------------------------------------------------------------------------------
# Texte d'un run Word : les deux éléments qui portent un caractère hors de w:t
# (w:noBreakHyphen, w:sym). Sans eux, « Jean<w:noBreakHyphen/>Éric » devient « JeanÉric ».
# Servent à pronto_docx.py et docx-meta.py ; manuscrit_docx.py a sa propre version, qui
# recense aussi les polices de symboles.
# ---------------------------------------------------------------------------------------

TRAIT_UNION_INSECABLE = '\u2011'
_SYM_PUCES = {0xF0B7: '\u2022'}
_POLICES_SYMBOLES = ('wingdings', 'wingdings2', 'wingdings3', 'symbol', 'webdings')


def caractere_sym(code_hex, police=''):
    """Le caractère d'un w:sym (w:char en hexadécimal, w:font). La puce U+F0B7 des polices
    de symboles devient U+2022 ; le reste est rendu tel quel. Code illisible : ''."""
    try:
        point = int(code_hex or '', 16)
    except ValueError:
        return ''
    if not (0 < point <= 0x10FFFF):
        return ''
    if (police or '').lower() in _POLICES_SYMBOLES and point in _SYM_PUCES:
        return _SYM_PUCES[point]
    return chr(point)


# Retour à la ligne forcé dans un titre de livre ou de chapitre : « // », espaces autour
# ignorés. Composé en bloc, il devient un saut ; partout ailleurs, une espace.
_SAUT_TITRE = re.compile(r'\s*//\s*')


def titre_lignes(titre):
    """« A // B » -> ['A', 'B'] ; lignes vides retirées."""
    return [x for x in _SAUT_TITRE.split(str(titre or '').strip()) if x]


def titre_plat(titre):
    """« A // B » -> « A B »."""
    return ' '.join(titre_lignes(titre))


# ---------------------------------------------------------------------------------------
# Requête HTTP : le seul GET du nettoyeur (Crossref, ROR, ORCID). Chaque appelant garde son
# propre `_requete(url, delai)`, point d'injection des tests, et y passe son User-Agent.
# ---------------------------------------------------------------------------------------

def requete_http(url, delai, user_agent):
    """Les octets de la réponse JSON attendue. Ne lève rien de plus que urllib : un code HTTP
    est une HTTPError, un délai dépassé ou une connexion refusée une OSError. L'analyse du
    corps reste à l'appelant."""
    req = urllib.request.Request(url, headers={'User-Agent': user_agent,
                                               'Accept': 'application/json'})
    with urllib.request.urlopen(req, timeout=delai) as reponse:
        return reponse.read()


# ---------------------------------------------------------------------------------------
# Module à tiret (docx-meta.py, docx-titres.py) : pas importable par son nom, donc chargé
# par chemin, une seule fois par processus (rangé dans sys.modules).
# ---------------------------------------------------------------------------------------

def charger_module_a_tiret(nom_fichier):
    """Le module `pipeline/<nom_fichier>`, chargé une fois puis rendu depuis sys.modules
    sous le nom `szh_<nom sans .py, tirets en _>`."""
    import importlib.util
    nom = 'szh_' + os.path.splitext(nom_fichier)[0].replace('-', '_')
    if nom in sys.modules:
        return sys.modules[nom]
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)), nom_fichier)
    spec = importlib.util.spec_from_file_location(nom, chemin)
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    try:
        spec.loader.exec_module(module)
    except BaseException:
        del sys.modules[nom]
        raise
    return module
