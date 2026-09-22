#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_noms.py — attribution prénom/nom au sein d'un segment de nom DÉJÀ reconnu.
# Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §3 ; périmètre exact fixé par le
# contrat de lot (lot A, CONTRAT-noms.md, non committé — voir le rapport de livraison).
#
# Le nettoyeur confondait deux questions distinctes :
#   (a) segmentation — cette ligne est-elle une ligne d'auteurs, quels segments sont des
#       personnes ? Répondu par docx-meta.nom_plausible(), test purement typographique — ce
#       module n'y touche pas.
#   (b) attribution — dans un segment déjà reconnu comme un nom, qui est le prénom, qui est
#       le nom ? Répondu jusqu'ici par docx-meta.decouper_prenom_nom() : « premier jeton =
#       prénom », une convention posée qui ne consulte aucun indice et ne peut jamais échouer
#       bruyamment (« Guilley Edith » rend prénom=Guilley, nom=Edith, à l'envers, en silence).
# Ce module possède le problème (b), et lui seul.
#
# Module PUR, comme manuscrit_modele.py : ne sait rien de Word, ni du modèle riche, ni des
# alertes. Il reçoit des CHAÎNES et des DICTS, rien d'autre — c'est l'appelant (manuscrit_
# entete.py, ou tout autre) qui lui fait remonter les indices tirés d'ailleurs (casse mise en
# forme du modèle riche, e-mail du bloc, noms certifiés par la bibliographie du manuscrit).
#
# Réutilisé depuis pipeline/docx-meta.py (chargé par chemin comme le fait déjà
# manuscrit_entete.py — le nom porte un tiret, `import docx-meta` est syntaxiquement
# impossible) : sans_titres_academiques() (alias public de _sans_titres_academiques, posé
# pour ce module par ce même lot) et PARTICULES. Rien n'est recopié.
#
# stdlib seule.

import importlib.util
import json
import os
import re
import sys
import unicodedata

_ICI = os.path.dirname(os.path.abspath(__file__))


def _charger_module_a_tiret(nom_fichier, nom_module):
    """docx-meta.py porte un tiret : pas un module importable par son nom (convention du
    dépôt). Chargé par chemin, comme manuscrit_entete.py et manuscrit_biblio.py le font déjà
    pour ce même fichier."""
    chemin = os.path.join(_ICI, nom_fichier)
    spec = importlib.util.spec_from_file_location(nom_module, chemin)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


dm = _charger_module_a_tiret('docx-meta.py', 'szh_docx_meta_pour_noms')


# ---------------------------------------------------------------------------------
# Le pliage — un jeton (minuscule, accents retirés, ponctuation de bord retirée) est la
# seule unité que ce module compare : à la base lexicale, à un autre jeton, à une partie
# locale d'e-mail. Les caractères INTERNES (le tiret d'un prénom composé, « Anne-Françoise »)
# ne sont jamais touchés — seule la ponctuation de BORD (§3.2 du contrat) l'est.

_PONCTUATION_BORD = ".,;:!?()[]{}«»\u201c\u201d\u2018\u2019'\"-"


def _plier(jeton):
    """Pliage d'un jeton (§3.2 du contrat) : NFD puis retrait des marques combinantes
    (accents), casse ramenée au minuscule, ponctuation de bord retirée. Jamais d'exception
    sur une entrée vide ou None — rend '' dans ce cas, comme toute question sans réponse
    dans ce module (§2 de la maison : « en cas de doute, rien »)."""
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip(_PONCTUATION_BORD)


PARTICULES = dm.PARTICULES  # réutilisées telles quelles, jamais recopiées (docx-meta.py).


def _candidat_debut(jetons):
    """Le jeton de TÊTE d'un segment, pour les signaux email/biblio/lexique — le premier
    jeton, SAUF s'il s'agit d'une particule isolée (« De Chambrier Anne-Françoise », ordre
    inverse À PARTICULE, mesuré comme motif réel — voir _repartir() plus bas pour le même cas
    en sens du découpage) : une particule seule n'est jamais un nom de famille reconnu par
    une base ou une bibliographie, c'est le jeton SUIVANT qui porte l'information. Sans cette
    garde, « De Chambrier » testait « de » contre la base — toujours muet, jamais faux, mais
    jamais utile non plus."""
    if not jetons:
        return ''
    if len(jetons) >= 2 and _plier(jetons[0]) in PARTICULES:
        return _plier(jetons[1])
    return _plier(jetons[0])


def _candidat_fin(jetons):
    """Le jeton de QUEUE, DERNIER jeton NON-particule (§3.2 du contrat : un nom composé se
    teste sur son dernier jeton non-particule, « Sermier Dessemontet », « de Chambrier »)."""
    for j in reversed(jetons):
        p = _plier(j)
        if p not in PARTICULES:
            return p
    return _plier(jetons[-1]) if jetons else ''


# ---------------------------------------------------------------------------------
# La base lexicale — silencieuse de bout en bout : aucune source n'est obligatoire, une
# source absente ou illisible ne lève jamais, elle réduit seulement `disponible`.

# Mots d'institution qui polluent parfois le champ nom/prénom d'une fiche OJS (une ligne mal
# saisie au dépôt) — liste FERMÉE et courte, mesurée le 22.09.2026 sur les 1157 fiches de
# C:\ProgramData\SZH\auteurs.json : 4 fiches écartées en tout (« Edition »/« SZH/CSPS » dans
# les deux champs, sous trois graphies : « SZH/CSPS », « SZH-CSPS », « Edition SZH/CSPS »),
# dont 3 déjà interceptées par le seul motif chiffre/@// ci-dessus et UNE (« Edition »
# / « SZH-CSPS », aucun chiffre ni arobase ni barre oblique) qui n'existe QUE grâce à cette
# liste de mots — c'est elle qui justifie de la garder en plus du motif chiffre/@//. Moins que
# les 12 jetons annoncés par le contrat de lot (§3.2), écart signalé dans le rapport de
# livraison plutôt que corrigé en silence. Quelques mots plausibles pour d'autres postes/
# exports sont ajoutés par prudence (jamais mesurés faux positifs sur CE corpus, gardés pour
# la robustesse du filtre).
INSTITUTIONS_BRUIT = {
    'szh', 'csps', 'szh/csps', 'edition', 'éditions', 'revue', 'zeitschrift',
    'universite', 'universitat', 'institut', 'hep', 'fondation', 'centre', 'redaction',
}


def _bruit_fiche(champ):
    """Une fiche est écartée EN ENTIER (jamais un champ deviné à sa place, §2 de la maison)
    si son nom OU son prénom contient un chiffre, une arobase, une barre oblique, ou vaut,
    une fois plié, un mot de la liste d'institutions ci-dessus (§3.2 du contrat)."""
    if re.search(r'[0-9@/]', champ or ''):
        return True
    for mot in (champ or '').split():
        if _plier(mot) in INSTITUTIONS_BRUIT:
            return True
    return False


def _resoudre_chemin_base_auteurs(chemin_fourni):
    """Ordre de recherche, chacun facultatif (§3.2 du contrat) : le chemin donné par
    l'appelant, sinon SZH_AUTEURS_CACHE (même nom de variable que lib/auteurs-ojs.js côté
    cockpit), sinon la base de production, WSL puis Windows — jamais l'inverse : un test qui
    n'en fournit AUCUN des trois doit tomber sur `disponible=False`, jamais sur une exception,
    d'où le `try` autour de chaque essai d'ouverture plus bas plutôt qu'ici."""
    if chemin_fourni:
        return chemin_fourni
    variable = os.environ.get('SZH_AUTEURS_CACHE')
    if variable:
        return variable
    for candidat in ('/mnt/c/ProgramData/SZH/auteurs.json', 'C:\\ProgramData\\SZH\\auteurs.json'):
        if os.path.exists(candidat):
            return candidat
    return None


def _charger_base_auteurs(chemin_fourni, prenoms, noms):
    """Enrichit `prenoms`/`noms` (dict jeton plié -> poids entier) depuis la base OJS du
    poste, format v2 : {"auteurs": [{"prenom": "...", "nom": "...", ...}, ...]} — mesuré le
    22.09.2026 : 1157 fiches, 601 prénoms distincts, 1043 noms distincts. Rend (n_retenues,
    n_ecartees) ou (None, None) si la source est absente ou illisible — jamais d'exception qui
    sort de cette fonction, une base de production mal formée ne doit jamais faire tomber un
    module qui ne fait QUE la lire."""
    chemin = _resoudre_chemin_base_auteurs(chemin_fourni)
    if not chemin:
        return None, None
    try:
        with open(chemin, encoding='utf-8') as f:
            donnees = json.load(f)
    except (OSError, ValueError, UnicodeDecodeError):
        return None, None
    fiches = donnees.get('auteurs') if isinstance(donnees, dict) else None
    if not isinstance(fiches, list):
        return None, None
    retenues = ecartees = 0
    for fiche in fiches:
        if not isinstance(fiche, dict):
            continue
        nom_brut = (fiche.get('nom') or '').strip()
        prenom_brut = (fiche.get('prenom') or '').strip()
        if _bruit_fiche(nom_brut) or _bruit_fiche(prenom_brut):
            ecartees += 1
            continue
        if not nom_brut or not prenom_brut:
            continue   # fiche incomplète : n'enrichit ni l'un ni l'autre dictionnaire.
        # Le couple prénom/nom d'une fiche OJS est STRUCTUREL (deux champs distincts, jamais
        # deviné) — d'où la confiance de cette source par rapport au lexique de bibliographie
        # (§3.2 du contrat) : chaque fiche vote pour SON prénom ET SON nom, jamais l'inverse.
        jeton_nom = _candidat_fin(nom_brut.split())
        jeton_prenom = _candidat_debut(prenom_brut.split())
        if jeton_nom:
            noms[jeton_nom] = noms.get(jeton_nom, 0) + 1
        if jeton_prenom:
            prenoms[jeton_prenom] = prenoms.get(jeton_prenom, 0) + 1
        retenues += 1
    return retenues, ecartees


def _charger_fichier_lexique(dossier_fourni, nom_fichier, cible):
    """Un jeton plié par ligne, `#` en commentaire (§3.2 du contrat) — fabriqué par le lot C
    (outils-dev/lexique/generer-noms.py), ce module se contente de le lire s'il existe.
    Absent -> 0, jamais une exception."""
    dossier = dossier_fourni or os.path.join(_ICI, 'lexique')
    chemin = os.path.join(dossier, nom_fichier)
    try:
        with open(chemin, encoding='utf-8') as f:
            lignes = f.readlines()
    except OSError:
        return 0
    n = 0
    for ligne in lignes:
        ligne = ligne.split('#', 1)[0].strip()
        if not ligne:
            continue
        jeton = _plier(ligne)
        if jeton:
            cible[jeton] = cible.get(jeton, 0) + 1
            n += 1
    return n


class BaseNoms:
    """Prénoms et noms connus, avec leur provenance. Un JETON PLIÉ (minuscule, accents
    retirés) -> un poids entier (le nombre de fiches/lignes qui le portent — seule sa
    positivité compte pour les signaux, jamais sa valeur exacte). Absente = toutes les
    questions rendent 0, jamais une erreur (§3.2 du contrat)."""

    __slots__ = ('disponible', 'sources', '_prenoms', '_noms')

    def __init__(self):
        self.disponible = False
        self.sources = []
        self._prenoms = {}
        self._noms = {}

    def __repr__(self):
        return 'BaseNoms(disponible=%r, %d source(s), %d prenom(s), %d nom(s))' % (
            self.disponible, len(self.sources), len(self._prenoms), len(self._noms))

    @classmethod
    def charger(cls, chemin_base_auteurs=None, chemin_lexique=None):
        """Charge, dans l'ordre, les sources du §3.2 du contrat — toutes facultatives et
        silencieuses si absentes ou illisibles. Jamais appelée d'elle-même par ce module :
        c'est l'appelant (la CLI, §6.1 du contrat) qui décide quand la base est chargée — un
        module PUR ne va jamais chercher un fichier de production tout seul.

        ⚠ Décision de Robin, 22.09.2026 : le lexique du dépôt ne porte plus que
        `noms-famille.txt` — `prenoms.txt` a été retiré de `pipeline/lexique/` (dérivé de la
        base OJS du poste, il n'apportait rien de plus qu'elle et son seul rôle, servir de
        repli quand elle est absente, est désormais couvert par le moissonnage déclenché au
        lancement de l'application). Conséquence honnête : côté PRÉNOM, le signal lexique ne
        vient donc plus que de la base OJS elle-même (`_charger_base_auteurs` ci-dessus) —
        sans elle (poste neuf, runner CI), `poids_prenom()` est toujours 0 et
        `score_direct`/`score_inverse` (`_signal_lexique`, plus bas) ne peuvent plus valoir
        que 0 ou 1, jamais 2. Le signal s'affaiblit (il peut trancher sur un seul jeton
        connu au lieu de deux) mais ne devient jamais FAUX pour autant : MARGE_LEXIQUE reste
        à 1 (inchangée), un score de 1 tranchait déjà avant cette suppression, et les trois
        autres signaux (casse, e-mail, biblio) n'en dépendent pas et restent intacts."""
        base = cls()
        prenoms, noms = {}, {}
        n_retenues, n_ecartees = _charger_base_auteurs(chemin_base_auteurs, prenoms, noms)
        if n_retenues is not None:
            base.sources.append(
                'base auteurs OJS (%d fiche(s) retenue(s), %d écartée(s) comme bruit)'
                % (n_retenues, n_ecartees))
        n = _charger_fichier_lexique(chemin_lexique, 'noms-famille.txt', noms)
        if n:
            base.sources.append('lexique du dépôt : noms-famille.txt (%d jeton(s))' % n)
        base._prenoms, base._noms = prenoms, noms
        base.disponible = bool(base.sources)
        return base

    @classmethod
    def depuis_dict(cls, donnees):
        """Base EN LIGNE, sans toucher au disque : {"prenoms": [...], "noms": [...]}, des
        jetons déjà pliés ou non (pliés ici de toute façon). C'est la forme que prend `base`
        dans l'entrée du mode --diagnostic (§3.7 du contrat) — pour qu'un test n'ait JAMAIS
        besoin d'un fichier du poste, jamais du chemin de production."""
        base = cls()
        donnees = donnees or {}
        for jeton in donnees.get('prenoms') or []:
            p = _plier(jeton)
            if p:
                base._prenoms[p] = base._prenoms.get(p, 0) + 1
        for jeton in donnees.get('noms') or []:
            p = _plier(jeton)
            if p:
                base._noms[p] = base._noms.get(p, 0) + 1
        if base._prenoms or base._noms:
            base.sources.append('base en ligne (--diagnostic)')
        base.disponible = bool(base.sources)
        return base

    def poids_prenom(self, jeton):
        return self._prenoms.get(_plier(jeton), 0)

    def poids_nom(self, jeton):
        return self._noms.get(_plier(jeton), 0)


_BASE_VIDE = BaseNoms()   # rendue par toute question posée à `base=None` — jamais un test de
                          # None dispersé dans chaque signal ci-dessous.


# ---------------------------------------------------------------------------------
# Les signaux — chacun rend (ordre | None, poids, motif). Un signal muet rend (None, 0, '').
# Forces nommées (§3.3 du contrat) : 3 = certaine, 2 = probable. Aucune autre valeur n'existe
# dans ce module — un signal qui inventerait sa propre force casserait la règle de
# combinaison de trancher() ci-dessous, qui ne connaît que ces deux paliers.

ORDRE_DIRECT = 'prenom_nom'     # « Edith Guilley »
ORDRE_INVERSE = 'nom_prenom'    # « Guilley Edith »

FORCE_CERTAINE = 3
FORCE_PROBABLE = 2

# Niveaux de confiance, du plus sûr au moins sûr (§3.4 du contrat).
CONFIANCE = ('certaine', 'probable', 'propagee', 'defaut')


def _jetons_marques_majuscule(jetons, indices):
    """Positions (0-based) dont la casse EFFECTIVE est intégralement capitale — tapée (le
    jeton lui-même est en MAJUSCULES, au moins 2 lettres, pour ignorer un jeton d'une seule
    lettre ou sans lettre du tout) OU mise en forme (indices['majuscules'] /
    indices['petites_capitales'], deux ensembles de positions fournis par l'appelant depuis
    manuscrit_modele.FORME_CLES — ce module ne sait pas lire un fragment de modèle riche, il
    ne connaît que la position qu'on lui donne)."""
    marques = set()
    for i, j in enumerate(jetons):
        lettres = [c for c in j if c.isalpha()]
        if len(lettres) >= 2 and j == j.upper() and j != j.lower():
            marques.add(i)
    indices = indices or {}
    n = len(jetons)
    for cle in ('majuscules', 'petites_capitales'):
        for i in indices.get(cle) or ():
            if isinstance(i, int) and 0 <= i < n:
                marques.add(i)
    return marques


def _signal_casse(jetons, indices):
    """casse — force certaine (§3.3 du contrat) : un jeton (ou un bloc de jetons CONTIGU, en
    tête ou en queue) en majuscules ou en petites capitales quand les autres ne le sont pas
    -> ce bloc est le NOM. Ne joue JAMAIS si AUCUN jeton n'est marqué, si TOUS le sont (un
    titre en capitales n'est pas un nom marqué), ou si le bloc marqué n'est ni en tête ni en
    queue (une marque isolée au milieu d'un nom à trois jetons ne permet pas de trancher
    sûrement de quel côté est le nom — silence plutôt qu'un pari, §2 de la maison)."""
    n = len(jetons)
    marques = _jetons_marques_majuscule(jetons, indices)
    if not marques or len(marques) >= n:
        return None, 0, ''
    if marques == set(range(len(marques))):
        bloc = ' '.join(jetons[i] for i in sorted(marques))
        return ORDRE_INVERSE, FORCE_CERTAINE, 'nom marqué par les capitales (%s)' % bloc
    if marques == set(range(n - len(marques), n)):
        bloc = ' '.join(jetons[i] for i in sorted(marques))
        return ORDRE_DIRECT, FORCE_CERTAINE, 'nom marqué par les capitales (%s)' % bloc
    return None, 0, ''


def _signal_email(jetons, indices):
    """email — force certaine (§3.3 du contrat). La partie locale est découpée sur '.', '-'
    et '_' en sous-parties pliées ; le nom de famille y apparaît d'ordinaire EN ENTIER (une
    adresse professionnelle abrège volontiers le prénom, rarement le nom) — c'est cette
    asymétrie qui tranche : un seul des deux jetons candidats (tête/queue du segment, §3.2 —
    une particule de tête ne compte jamais, _candidat_debut) retrouvé ENTIER dans la partie
    locale, l'autre absent (même réduit à une initiale) -> celui qui est retrouvé est le nom.
    Les deux retrouvés (une adresse « prenom.nom » complète des deux côtés) ou aucun -> aucune
    façon sûre de savoir lequel joue quel rôle, silence (§2 de la maison). Une adresse
    institutionnelle (aucun séparateur ET aucun jeton du segment dedans — « redaction@szh.ch »)
    est écartée avant tout : ce n'est l'adresse de personne."""
    email = (indices or {}).get('email') or ''
    if '@' not in email:
        return None, 0, ''
    locale = email.split('@', 1)[0]
    subs = [_plier(s) for s in re.split(r'[._-]+', locale) if s]
    subs = [s for s in subs if s]
    if not subs:
        return None, 0, ''
    tous_pliés = {_plier(j) for j in jetons if _plier(j)}
    a_separateur = ('.' in locale) or ('-' in locale)
    if not a_separateur and not (tous_pliés & set(subs)):
        return None, 0, ''   # adresse institutionnelle : aucun repère, jamais celle d'un nom.
    j0 = _candidat_debut(jetons)
    jn = _candidat_fin(jetons)
    e0 = bool(j0) and j0 in subs
    en = bool(jn) and jn in subs
    if e0 and not en:
        return ORDRE_INVERSE, FORCE_CERTAINE, "partie locale de l'e-mail (%s)" % j0
    if en and not e0:
        return ORDRE_DIRECT, FORCE_CERTAINE, "partie locale de l'e-mail (%s)" % jn
    return None, 0, ''


def _signal_biblio(jetons, indices):
    """biblio — force probable (§3.3 du contrat) : `indices['noms_biblio']`, un ensemble de
    jetons DÉJÀ PLIÉS certifiés noms de famille par la bibliographie du manuscrit lui-même
    (forme APA « Nom, P. », que ce module ne sait pas lire — c'est l'appelant qui les fournit,
    §4.2 du contrat de lot). Un seul des deux jetons candidats (tête/queue, mêmes candidats
    que le signal email ci-dessus) présent dans l'ensemble -> il est le nom."""
    certifies = (indices or {}).get('noms_biblio') or ()
    certifies = {_plier(j) for j in certifies if _plier(j)}
    if not certifies:
        return None, 0, ''
    j0 = _candidat_debut(jetons)
    jn = _candidat_fin(jetons)
    dans_j0 = bool(j0) and j0 in certifies
    dans_jn = bool(jn) and jn in certifies
    if dans_j0 and not dans_jn:
        return ORDRE_INVERSE, FORCE_PROBABLE, 'nom certifié par la bibliographie (%s)' % j0
    if dans_jn and not dans_j0:
        return ORDRE_DIRECT, FORCE_PROBABLE, 'nom certifié par la bibliographie (%s)' % jn
    return None, 0, ''


# Marge minimale entre les deux scores du signal lexique pour trancher. TRANCHÉ le 22.09.2026
# par le superviseur, après mesure — la formule d'origine du contrat (marge = 2, « les deux
# jetons concordants d'un côté et rien de l'autre ») a été essayée puis ÉCARTÉE : elle ne
# tranche presque rien. Leave-one-out sur les 1155 fiches de C:\ProgramData\SZH\auteurs.json
# (chaque auteur retiré avant d'être jugé par le reste de la base ; mesuré indépendamment par
# ce lot et par le superviseur, chiffres accordés à l'arrondi près) :
#
#   marge | tranché juste  | à l'envers   | indécis      | muet
#   ------|----------------|--------------|--------------|-------------
#     1   | 792 (68,6 %)   | 9   (0,8 %)  | 34  (2,9 %)  | 320 (27,7 %)
#     2   | 139 (12,0 %)   | 3   (0,3 %)  | 693 (60,0 %) | 320 (27,7 %)
#
# Avec pipeline/lexique/noms-famille.txt en renfort (seule source du lot C mesurable ici —
# prenoms.txt est dérivé de cette même base et fuiterait la mesure), toujours à marge 1 :
# 834 juste (72,2 %), 12 à l'envers (1,0 %), 280 muet (24,2 %).
#
# Pourquoi marge = 1 malgré son 0,8-1,0 % d'erreur : quand le lexique se TAIT, le repli n'est
# pas « aucune décision » — c'est la convention prénom-nom (§3.4, étape 5), laquelle est
# FAUSSE sur tout manuscrit écrit à l'envers, exactement le cas que ce lot existe pour
# corriger. Un signal qui se trompe à moins de 1 % bat donc la convention partout où il
# parle. Et le lexique pèse FORCE_PROBABLE (2) : la casse et l'e-mail, à FORCE_CERTAINE (3),
# le recouvrent dès qu'ils sont présents (§3.4, étape 2) — une erreur lexicale n'est donc
# jamais le dernier mot, seulement un repli meilleur que la convention aveugle.
MARGE_LEXIQUE = 1


def _signal_lexique(jetons, base):
    """lexique — force probable (§3.3 du contrat). `score_direct` = (le candidat de tête
    connu comme prénom) + (le candidat de queue connu comme nom) ; `score_inverse`,
    symétrique. Tranche dès que l'un des deux scores dépasse STRICTEMENT l'autre
    (MARGE_LEXIQUE = 1, voir la mesure au-dessus de la constante) : un seul jeton concordant
    d'un côté et rien de l'autre suffit déjà — la marge plus stricte (2, les deux jetons
    concordants d'un côté) a été mesurée et écartée, elle ne tranchait presque rien. Une
    égalité stricte (score_direct == score_inverse, par exemple les deux jetons connus à la
    fois comme prénom ET comme nom ailleurs dans la base) reste muette : c'est le seul cas
    réellement indécis à cette marge. Le lexique n'est JAMAIS un filtre (§3.3) : une base
    absente ou muette sur ces deux jetons ne rejette jamais le segment, elle rend seulement
    (None, 0, '') comme tout autre signal silencieux."""
    if base is None or not base.disponible:
        return None, 0, ''
    j0 = _candidat_debut(jetons)
    jn = _candidat_fin(jetons)
    score_direct = (1 if base.poids_prenom(j0) > 0 else 0) + (1 if base.poids_nom(jn) > 0 else 0)
    score_inverse = (1 if base.poids_nom(j0) > 0 else 0) + (1 if base.poids_prenom(jn) > 0 else 0)
    if abs(score_direct - score_inverse) < MARGE_LEXIQUE:
        return None, 0, ''
    if score_direct > score_inverse:
        return (ORDRE_DIRECT, FORCE_PROBABLE,
                'la base connaît « %s » comme prénom et « %s » comme nom, dans cet ordre'
                % (j0, jn))
    return (ORDRE_INVERSE, FORCE_PROBABLE,
            'la base connaît « %s » comme prénom et « %s » comme nom, ordre inverse'
            % (jn, j0))


# ---------------------------------------------------------------------------------
# La décision — règle de combinaison explicite et traçable (§3.4 du contrat).

def trancher(jetons, indices=None, base=None):
    """{'ordre', 'confiance', 'motif', 'conflit', 'signaux'} — voir le §3.4 du contrat pour
    la règle de combinaison exacte, reprise ici pas à pas. `jetons` : la liste BRUTE (telle
    que tapée, casse conservée — le signal casse en a besoin) des mots du segment, déjà
    débarrassé des titres académiques par l'appelant (dm.sans_titres_academiques(), §3.6).
    Moins de 2 jetons : aucun ordre à trancher, rendu directement sans consulter aucun
    signal (même esprit que le « un seul jeton » de decoupe(), §3.6 — appliqué ici aussi par
    prudence, pour qu'un appelant qui invoquerait trancher() seul sur un jeton isolé ne
    tombe jamais sur un signal mal formé)."""
    if len(jetons) < 2:
        return {'ordre': ORDRE_DIRECT, 'confiance': 'defaut',
                'motif': 'un seul jeton, aucun ordre à trancher', 'conflit': False,
                'signaux': []}

    base = base if base is not None else _BASE_VIDE
    bruts = (
        ('casse', ) + _signal_casse(jetons, indices),
        ('email', ) + _signal_email(jetons, indices),
        ('biblio', ) + _signal_biblio(jetons, indices),
        ('lexique', ) + _signal_lexique(jetons, base),
    )
    signaux = [{'signal': nom, 'ordre': ordre, 'poids': poids, 'motif': motif}
               for nom, ordre, poids, motif in bruts if ordre is not None]

    if not signaux:
        return {'ordre': ORDRE_DIRECT, 'confiance': 'defaut',
                'motif': 'aucun indice, convention prénom-nom appliquée', 'conflit': False,
                'signaux': []}

    # 2. Le meilleur poids d'un côté est CERTAINE (>= 3) et rien de poids >= 3 ne dit le
    # contraire -> confiance='certaine'. Un signal plus faible qui contredirait ne bloque
    # jamais cette branche (§3.4 : seuls deux signaux de poids >= 3 en désaccord la font
    # tomber au conflit plus bas).
    forts = [s for s in signaux if s['poids'] >= FORCE_CERTAINE]
    if forts:
        ordres_forts = {s['ordre'] for s in forts}
        if len(ordres_forts) == 1:
            s = forts[0]
            return {'ordre': s['ordre'], 'confiance': 'certaine', 'motif': s['motif'],
                    'conflit': False, 'signaux': signaux}

    # 3. Sinon, si la somme d'un côté dépasse STRICTEMENT celle de l'autre -> 'probable'.
    somme_direct = sum(s['poids'] for s in signaux if s['ordre'] == ORDRE_DIRECT)
    somme_inverse = sum(s['poids'] for s in signaux if s['ordre'] == ORDRE_INVERSE)
    if somme_direct != somme_inverse:
        ordre = ORDRE_DIRECT if somme_direct > somme_inverse else ORDRE_INVERSE
        meilleur = max((s for s in signaux if s['ordre'] == ordre), key=lambda s: s['poids'])
        return {'ordre': ordre, 'confiance': 'probable', 'motif': meilleur['motif'],
                'conflit': False, 'signaux': signaux}

    # 4. Sommes égales : soit des signaux se contredisent à poids égal (deux ordres présents)
    # -> conflit=True, ordre=DIRECT (la convention), confiance='defaut' ; soit (cas qui ne se
    # présente pas en pratique avec des poids > 0 sur un seul ordre) rien à trancher non plus.
    ordres_presents = {s['ordre'] for s in signaux}
    if len(ordres_presents) > 1:
        noms_signaux = ', '.join(sorted(s['signal'] for s in signaux))
        return {'ordre': ORDRE_DIRECT, 'confiance': 'defaut',
                'motif': ('signaux contradictoires à poids égal (%s) : convention '
                          'prénom-nom appliquée par défaut' % noms_signaux),
                'conflit': True, 'signaux': signaux}

    # 5. Aucun signal (déjà rendu plus haut) ou signaux d'un seul côté qui s'annulent
    # trivialement : convention par défaut, sans conflit.
    return {'ordre': ORDRE_DIRECT, 'confiance': 'defaut',
            'motif': 'aucun indice, convention prénom-nom appliquée', 'conflit': False,
            'signaux': signaux}


def trancher_groupe(segments, base=None):
    """[decision, ...] — une decision par segment (même schéma que trancher()), après
    propagation (§3.5 du contrat). `segments` : [{'jetons': [...], 'indices': {...}}, ...] —
    la même fonction sert au groupe « ligne de byline » et au groupe « document entier »,
    c'est l'appelant qui choisit la portée en construisant cette liste.

    Propagation : si au moins un segment est tranché ('certaine' ou 'probable') et
    qu'AUCUN autre segment tranché ne dit l'ordre contraire, tous les segments restés en
    'defaut' SANS CONFLIT adoptent cet ordre avec confiance='propagee' et un motif qui nomme
    le segment donneur. Deux segments tranchés qui se contredisent -> AUCUNE propagation, les
    deux gardent leur décision propre (et aucun 'defaut' n'est touché non plus : sans
    consensus, rien ne se propage)."""
    decisions = []
    for seg in segments:
        jetons = seg.get('jetons') or []
        indices = seg.get('indices') or {}
        if len(jetons) < 2:
            decisions.append({'ordre': ORDRE_DIRECT, 'confiance': 'defaut',
                              'motif': 'un seul jeton, aucun ordre à trancher',
                              'conflit': False, 'signaux': []})
        else:
            decisions.append(trancher(jetons, indices, base))

    tranches = [(i, d) for i, d in enumerate(decisions)
                if d['confiance'] in ('certaine', 'probable')]
    ordres_tranches = {d['ordre'] for _, d in tranches}
    if tranches and len(ordres_tranches) == 1:
        i_donneur, d_donneur = tranches[0]
        ordre_donneur = d_donneur['ordre']
        libelle_donneur = ' '.join(segments[i_donneur].get('jetons') or [])
        for i, d in enumerate(decisions):
            if d['confiance'] == 'defaut' and not d['conflit']:
                decisions[i] = dict(d, ordre=ordre_donneur, confiance='propagee',
                                    motif='ordre propagé depuis « %s » (%s)'
                                          % (libelle_donneur, d_donneur['motif']))
    return decisions


# ---------------------------------------------------------------------------------
# Le découpage proprement dit (§3.6 du contrat).

def _est_initiale_pointee(jeton):
    # Un jeton reduit a une seule lettre suivie d'un point ("C.", "E." accentue ou non,
    # casse indifferente) : jamais un nom de famille a lui seul, toujours l'initiale d'un
    # second prenom intercalaire. Ajout du 22.09.2026, mesure en leave-one-out sur la base
    # reelle (C:\ProgramData\SZH\auteurs.json, 1155 fiches) : 8 fiches sur 1155 (0,7 %) ont
    # un prenom OJS de la forme "Susan C. A.", "Bernard N.", "Markus P."... - une initiale
    # intercalaire qu'un decoupage "premier jeton = prenom" ne pouvait pas representer avant
    # cet ajout. Convention anglo-saxonne (second prenom reduit a l'initiale), probablement
    # plus frequente encore dans les manuscrits reels que dans cette base : les co-autrices
    # et coauteurs anglo-saxons l'emploient couramment dans leur signature.
    return len(jeton) == 2 and jeton[1] == '.' and jeton[0].isalpha()


def _absorber_prenom_compose(jetons):
    """(prenom_jetons, reste) : le premier jeton — l'ANCRE, toujours incluse, jamais testée
    elle-meme — prolonge tant que le jeton SUIVANT est un tiret isole ou une INITIALE
    POINTEE (_est_initiale_pointee ci-dessus, ajout du 22.09.2026 : "Susan C. A. Burkhardt"
    -> prenom "Susan C. A.", nom "Burkhardt"). Ne consomme jamais le dernier jeton de la
    liste : il en reste toujours au moins un pour le nom.
    Le tiret isolé (un prénom composé tapé avec des espaces autour du tiret — rare, mais
    chaque jeton restant qu'il laisse derrière lui garde les particules attachées au nom
    SANS code dédié : elles font simplement partie de `reste`) et l'initiale pointée
    s'absorbent l'un et l'autre de la même façon, un jeton (ou une paire tiret+mot) à la
    fois. `jetons` a au moins 2 éléments (garanti par l'appelant, decoupe()/_repartir()
    ci-dessous)."""
    i = 1
    while i < len(jetons) - 1:
        if jetons[i] in ('-', '\u2013', '\u2014'):
            i += 2
        elif _est_initiale_pointee(jetons[i]):
            i += 1
        else:
            break
    return jetons[:i], jetons[i:]


def _borne_prenom_inverse(jetons):
    # Index de debut (inclus) du bloc prenom en ordre inverse. PAS un simple renversement de
    # la liste puis reemploi de _absorber_prenom_compose : la structure interne du prenom
    # (ancre puis initiales) ne s'inverse jamais elle-meme, seule SA PLACE dans le segment
    # change ("Susan C. A. Burkhardt" en direct <-> "Burkhardt Susan C. A." en inverse,
    # jamais "Burkhardt A. C. Susan"). On remonte donc depuis la fin, en absorbant les
    # initiales pointees une a une ; le premier jeton non-initiale rencontre est l'ancre du
    # prenom (le vrai prenom donne, jamais lui-meme une initiale dans les cas mesures) et
    # arrete la remontee. La boucle ne descend jamais en dessous de l'index 1, ce qui laisse
    # toujours au moins jetons[0] pour le nom. Pas de symetrie pour le tiret isole ici : aucun
    # cas mesure ne le reclame cote inverse, et deviner sans preuve casserait plus que ca ne
    # repare (contrat, "en cas de doute, rien, et on le dit").
    j = len(jetons) - 1
    while j > 1 and _est_initiale_pointee(jetons[j]):
        j -= 1
    return j


def _repartir(jetons, ordre):
    """(prenom, nom) selon `ordre` — direct : premier jeton, prolongé à travers un tiret
    isolé ou une chaîne d'initiales pointées (_absorber_prenom_compose ci-dessus) = prénom,
    le RESTE (particules comprises, §3.6) = nom. Inverse : symétrique depuis la fin
    (_borne_prenom_inverse ci-dessus) = prénom, le reste = nom. Les particules ne réclament
    aucun traitement séparé : elles restent naturellement du côté du nom, quel que soit
    l'ordre, puisqu'elles ne sont jamais l'ancre absorbée comme prénom (« Anne-Françoise de
    Chambrier » -> prénom Anne-Françoise, nom "de Chambrier" ; « De Chambrier Anne-
    Françoise » -> nom "De Chambrier", prénom Anne-Françoise, §3.6 du contrat, les deux
    exemples de référence).

    ⚠ LIMITE CONNUE, documentée et non corrigée (mesurée le 22.09.2026, même leave-one-out
    que _est_initiale_pointee ci-dessus, sur les mêmes 1155 fiches) : 12 fiches sur 1155
    (1,0 %) ont un VRAI prénom composé à l'ESPACE, sans initiale ni tiret — « Salomé Calina »
    (nom Schneiter), « Laura Marie » (nom Maaß), « Dennis Christian », « Barbara Maria »…
    Rien, dans le texte seul, ne distingue « Laura Marie Maaß » (prénom composé « Laura
    Marie », nom « Maaß ») de « Laura Marie-Maaß » tapé sans son trait d'union, ou d'un
    troisième jeton qui serait en réalité un second nom de famille : les trois se présentent
    EXACTEMENT de la même façon à cette fonction (plusieurs jetons, aucun n'est une initiale
    pointée, aucun tiret isolé). Deviner ici romprait la propriété de sûreté mesurée sur la
    base réelle (les signaux ne fabriquent jamais une inversion à tort, §0 du rapport de
    livraison) sans rien garantir en échange — cette découpe-là reste donc « ancre + le
    reste = nom », comme avant cet ajout : faux sur ces 12 fiches, mais faux de façon
    repérable (une coupe optimiste, jamais un prénom et un nom permutés) plutôt qu'un pari
    qui tomberait aussi souvent à faux qu'à juste. Seule une base qui connaît le prénom
    composé EN ENTIER (le signal lexique, §3.3) pourrait lever ce doute un jour — hors du
    périmètre de cette fonction, qui ne voit que du texte (§5.1 du contrat : « en cas de
    doute, rien, et on le dit »)."""
    if ordre == ORDRE_INVERSE:
        j = _borne_prenom_inverse(jetons)
        return ' '.join(jetons[j:]), ' '.join(jetons[:j])
    prenom_j, reste = _absorber_prenom_compose(jetons)
    return ' '.join(prenom_j), ' '.join(reste)


# Alias PUBLIC de la répartition, pour l'appelant qui a déjà tranché l'ordre par
# trancher_groupe() et n'a donc plus besoin de decoupe() (manuscrit_entete.py : la
# propagation §3.5 décide l'ordre pour TOUTE la ligne, la répartition se fait ensuite segment
# par segment). Même convention que docx-meta.sans_titres_academiques : un alias plutôt qu'un
# appel au nom souligné par-dessus la frontière du module.
#
# ⚠ Posé le 22.09.2026 par le superviseur pour SUPPRIMER une copie, pas par goût de symétrie :
# manuscrit_entete.py portait sa propre réimplémentation de cet algorithme, et les deux
# avaient DÉJÀ divergé au moment où on l'a mesuré — la copie ignorait les initiales pointées
# (« Bernard N. Schumacher » -> prénom « Bernard », nom « N. Schumacher ») et renversait
# naïvement la liste en ordre inverse (« Burkhardt Susan C. A. » -> prénom « A. », nom
# « Burkhardt Susan C. »), c'est-à-dire exactement la variante que _borne_prenom_inverse()
# ci-dessus documente comme fausse. Les deux fichiers de test étaient verts : aucun ne
# croisait les deux modules sur une initiale. Une décision, un seul propriétaire (§3 du
# contrat d'architecture) — la duplication d'un algorithme de décision n'est pas négociable.
repartir = _repartir


def _jetons_depuis_texte(texte):
    """Titres académiques ôtés (dm.sans_titres_academiques(), c'est ce qui manque à
    docx-meta.auteurs_depuis_byline() côté cellules — voir §3.6 du contrat), l'obèle qui
    accompagne parfois un nom (†, même convention que docx-meta.py) retiré, puis découpage
    sur l'espace."""
    t = dm.sans_titres_academiques(texte) or ''
    t = t.replace('\u2020', ' ').strip()
    return t.split()


def decoupe(texte, indices=None, base=None):
    """{'prenom', 'nom', 'ordre', 'confiance', 'motif', 'conflit'} (§3.6 du contrat) — un
    seul segment. `texte` passe d'abord par dm.sans_titres_academiques(). Un seul jeton :
    tout dans `nom`, confiance='defaut', comme le faisait déjà docx-meta.decouper_prenom_nom()
    (jamais de régression sur ce cas, seulement sur celui à 2 jetons ou plus qu'il tranchait
    à l'aveugle)."""
    jetons = _jetons_depuis_texte(texte)
    if len(jetons) < 2:
        return {'prenom': '', 'nom': ' '.join(jetons), 'ordre': ORDRE_DIRECT,
                'confiance': 'defaut',
                'motif': 'un seul jeton : tout dans le nom, comme la convention par défaut',
                'conflit': False}
    decision = trancher(jetons, indices or {}, base)
    prenom, nom = _repartir(jetons, decision['ordre'])
    return {'prenom': prenom, 'nom': nom, 'ordre': decision['ordre'],
            'confiance': decision['confiance'], 'motif': decision['motif'],
            'conflit': decision['conflit']}


# ---------------------------------------------------------------------------------
# Mode diagnostic — patron EXACT de manuscrit_entete.py (voir sa fonction principal()) :
# --diagnostic, un JSON sur stdin, une ligne JSON sur stdout. `base` voyage EN LIGNE (§3.7 du
# contrat) : un test n'a ainsi jamais besoin d'un fichier du poste. Les segments passent par
# trancher_groupe() (jamais des decoupe() indépendants) : c'est la seule façon, depuis cette
# CLI, d'exercer la propagation (§3.5) sur plusieurs segments reçus ensemble — decoupe() lui-
# même, à un seul segment, ne peut jamais la déclencher.

def principal(argv):
    if '--diagnostic' not in argv[1:]:
        print('usage : manuscrit_noms.py --diagnostic   '
              '({"segments": [{"texte": "...", "indices": {...}}, ...], '
              '"base": {"prenoms": [...], "noms": [...]}} JSON sur stdin)', file=sys.stderr)
        return 2

    try:
        sys.stdin.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

    try:
        donnees = json.loads(sys.stdin.read())
    except Exception as e:
        print('[manuscrit_noms] JSON d\'entrée illisible : %s' % e, file=sys.stderr)
        return 1

    base = BaseNoms.depuis_dict(donnees.get('base') or {})
    segments_entree = donnees.get('segments') or []
    prepares = []
    for seg in segments_entree:
        texte = seg.get('texte') or ''
        indices = seg.get('indices') or {}
        prepares.append({'jetons': _jetons_depuis_texte(texte), 'indices': indices})

    decisions = trancher_groupe(prepares, base)
    resultats = []
    for prep, decision in zip(prepares, decisions):
        jetons = prep['jetons']
        if len(jetons) < 2:
            prenom, nom = '', ' '.join(jetons)
        else:
            prenom, nom = _repartir(jetons, decision['ordre'])
        resultats.append({'prenom': prenom, 'nom': nom, 'ordre': decision['ordre'],
                          'confiance': decision['confiance'], 'motif': decision['motif'],
                          'conflit': decision['conflit']})

    print(json.dumps({'resultats': resultats}, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
