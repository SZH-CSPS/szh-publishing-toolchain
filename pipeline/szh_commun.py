#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
szh_commun.py — ce que docx-meta.py, docx-tables.py, livre-scinder.py, reimporter.py,
couverture.py, portraits.py et cmyk-rgb.py refaisaient chacun de leur côté : le constat au
rédacteur (avertir), la lecture plate de buch.yaml/ausgabe.yaml (lire_yaml), la slugification
d'un nom de fichier (slugifier, alignée sur le Makefile) et l'écriture atomique d'un fichier
(ecrire_atomique). Stdlib uniquement : la WSL de production n'a pas PyYAML, et
portraits.py/cmyk-rgb.py tournent dans un venv séparé (/opt/portraits) qui n'a pas non plus
accès aux dépendances du reste du pipeline.

Chaque script importe ce module en s'ajoutant lui-même au chemin de recherche :

    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import szh_commun

Rien ici n'a d'effet de bord au chargement.
"""

import os
import re
import sys
import unicodedata

# ---------------------------------------------------------------------------------------
# Constat au rédacteur : une ligne, préfixe fixe (propre à l'appelant), deuxième champ un
# code stable, français puis allemand. Sur stderr et dans SZH_IMPORT_LOG si la variable est
# posée (append utf-8, LF, une OSError d'écriture est avalée — un journal illisible ne doit
# jamais faire échouer l'appelant). Recopiée avant ce module dans docx-meta.py (~l.716),
# docx-tables.py (~l.259), livre-scinder.py (~l.250) et, en méthode, dans reimporter.py
# (~l.194) : les quatre versions faisaient exactement la même chose, seul le préfixe changeait
# ('[import-avertissement]' pour les trois premiers, également pour reimporter.py).
# ---------------------------------------------------------------------------------------

def formater_avertissement(prefixe, code, champs, fr, de):
    """La ligne elle-même, sans l'écrire nulle part : reimporter.py s'en sert aussi pour
    garder sa propre liste de lignes (Voix.lignes) sans dupliquer ce format."""
    return ' | '.join([prefixe + ' ' + code] + list(champs) + [fr, '[de] ' + de])


def journaliser(ligne, journal):
    """Ajoute `ligne` à `journal` si un chemin est donné ; absent ou illisible, ne fait
    rien. Une erreur d'écriture (dossier disparu, droits, OneDrive...) est avalée : le
    journal est un confort de diagnostic, jamais une condition de réussite de l'appelant."""
    if not journal:
        return
    try:
        with open(journal, 'a', encoding='utf-8', newline='\n') as f:
            f.write(ligne + '\n')
    except OSError:
        pass


def avertir(prefixe, code, champs, fr, de, journal=None, flush=False):
    """Écrit le constat sur stderr et le journalise. `journal` : chemin explicite (c'est ce
    que passe reimporter.py, qui résout son propre journal indépendamment de la variable
    d'environnement) ; omis ou None, le journal est SZH_IMPORT_LOG (comportement des trois
    scripts d'origine). `flush` : reimporter.py imprime ses lignes avec flush=True, les
    trois autres non — un détail de tampon qui ne change jamais ce qui finit par s'afficher,
    gardé pour ne rien changer d'observable. Rend la ligne, que l'appelant peut garder."""
    if journal is None:
        journal = os.getenv('SZH_IMPORT_LOG')
    ligne = formater_avertissement(prefixe, code, champs, fr, de)
    print(ligne, file=sys.stderr, flush=flush)
    journaliser(ligne, journal)
    return ligne


# ---------------------------------------------------------------------------------------
# Lecture plate d'un YAML « maison » (buch.yaml, ausgabe.yaml) : une clé par ligne, listes
# en tirets ou en ligne, sous-blocs indentés d'un niveau. Ce n'est pas un analyseur YAML et
# ça n'essaie pas de l'être — voir lire_yaml() ci-dessous pour ce qu'il couvre.
# Recopiée de livre-assembler.py (~l.44-123), que couverture.py importait par chemin pour
# cette seule fonction (~l.51-52).
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


def lire_yaml(chemin):
    """Rend un dict. Une passe, trois formes, et rien d'autre :

        cle: valeur              -> chaîne, booléen
        cle: [a, b]              -> liste sur une ligne
        cle:                     -> bloc, suivi soit de « - item » (liste), soit de
          sous-cle: valeur          lignes indentées (dict)

    Ce n'est pas un analyseur YAML et cela n'essaie pas de l'être : c'est le lecteur du
    fichier que le cockpit écrit. Une construction qu'il ne connaît pas est ignorée en
    silence plutôt qu'inventée.
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

        # ⚠ Un item de liste s'écrit au fer à gauche dans les fiches de la maison —
        # `auteurs:` puis `- prenom: …` en colonne 0, comme dans les <slug>.meta.yaml de
        # la revue. Le tiret se teste donc avant l'indentation, sans quoi « - prenom »
        # passerait pour une clé de premier niveau et la liste des auteur·e·s se perdrait.
        if indent == 0 and not nu.startswith('- '):
            if ':' not in nu:
                continue
            c, _, v = nu.partition(':')
            cle, v = c.strip(), v.strip()
            conteneur = None
            if v == '':
                racine[cle] = None          # bloc : la ligne suivante dira lequel
            elif v.startswith('[') and v.endswith(']'):
                racine[cle] = [_valeur(x) for x in v[1:-1].split(',') if x.strip()]
            else:
                racine[cle] = _valeur(v)
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
                conteneur.append({c.strip(): _valeur(v)})
            else:
                conteneur.append(_valeur(item))
            continue

        if ':' in nu:
            c, _, v = nu.partition(':')
            # Ligne indentée sous un tiret : elle complète le dernier item de la liste.
            if isinstance(conteneur, list) and conteneur and isinstance(conteneur[-1], dict):
                conteneur[-1][c.strip()] = _valeur(v)
                continue
            if not isinstance(conteneur, dict):
                conteneur = {}
                racine[cle] = conteneur
            conteneur[c.strip()] = _valeur(v)
    return racine


# ---------------------------------------------------------------------------------------
# Slugification, alignée sur celle de la cible `import` du Makefile (~l.598-605) :
#   nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
# Recopiée de livre-scinder.py (~l.33-76). La garder alignée sur le Makefile est un invariant
# du projet, pas une préférence : un chapitre et un article doivent porter le même nom pour
# le même titre, quel que soit le maillon qui l'a créé.
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
    """Slug d'un chapitre : slugifier puis borner. Pas de complément de deux chiffres
    (c'est pour les articles, pas les chapitres)."""
    return borner_slug(slugifier(titre))


# ---------------------------------------------------------------------------------------
# Écriture atomique : jamais de fichier visible à moitié écrit (OneDrive, cockpit qui relit
# en même temps). Le contenu passe par un temporaire du même dossier — os.replace est
# atomique sur un même volume — supprimé si l'écriture échoue.
# Recopiée de portraits.py (~l.178-186, PNG) et cmyk-rgb.py (~l.63-74, JPEG+EXIF), qui
# diffèrent par le format écrit et par le préfixe du nom temporaire (« .~ » / « ~$ ») : ce
# n'est donc pas le contenu qui est partagé ici, mais le mécanisme (nom temporaire, écriture,
# remplacement, nettoyage sur exception). livre-scinder.py (ecrire_buch_yaml) écrit du texte,
# pas une image : `binaire=False` couvre ce cas.
# ---------------------------------------------------------------------------------------

def ecrire_atomique(chemin, ecrire, binaire=True, encoding=None, newline=None,
                     prefixe_tmp='.~'):
    """`ecrire(flux)` reçoit le fichier temporaire déjà ouvert et y écrit le contenu voulu.
    `binaire` choisit le mode d'ouverture ('wb' ou 'w', avec `encoding`/`newline` dans ce
    second cas). `prefixe_tmp` distingue portraits.py (« .~ ») de cmyk-rgb.py (« ~$ »),
    repris tels quels pour ne rien changer d'observable."""
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
