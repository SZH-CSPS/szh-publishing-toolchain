#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Dans un segment déjà reconnu comme un nom de personne, dit quel mot est le prénom et
# lequel est le nom (« Guilley Edith » ou « Edith Guilley »). Savoir si une ligne est une
# ligne d'auteurs relève de docx-meta.nom_plausible(). Voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
# Le module ne connaît ni Word, ni le modèle riche, ni les alertes : il reçoit des chaînes et
# des dicts. L'appelant (manuscrit_entete.py) lui fournit les indices tirés d'ailleurs : casse
# mise en forme, e-mail du bloc, noms certifiés par la bibliographie du manuscrit.
# sans_titres_academiques() et PARTICULES viennent de pipeline/heritage_meta.py.
# Bibliothèque standard seule.

import json
import os
import re
import sys
import unicodedata

_ICI = os.path.dirname(os.path.abspath(__file__))
if _ICI not in sys.path:
    sys.path.insert(0, _ICI)
import szh_commun


import heritage_meta as hm


# ---------------------------------------------------------------------------------
# Pliage. Le module ne compare que des jetons pliés (minuscules, sans accents, sans
# ponctuation de bord). Les caractères internes, comme le tiret de « Anne-Françoise », restent.

_PONCTUATION_BORD = ".,;:!?()[]{}«»\u201c\u201d\u2018\u2019'\"-"


def _plier(jeton):
    """NFD, accents retirés, minuscules, ponctuation de bord retirée. Rend '' pour une
    entrée vide ou None."""
    t = unicodedata.normalize('NFD', (jeton or '').strip().lower())
    t = ''.join(c for c in t if not unicodedata.combining(c))
    return t.strip(_PONCTUATION_BORD)


PARTICULES = hm.PARTICULES


def _candidat_debut(jetons):
    """Le jeton de tête d'un segment, plié, pour les signaux email, biblio et lexique : le
    premier jeton, ou le suivant si le premier est une particule (« De Chambrier
    Anne-Françoise ») : une particule seule ne figure dans aucune base."""
    if not jetons:
        return ''
    if len(jetons) >= 2 and _plier(jetons[0]) in PARTICULES:
        return _plier(jetons[1])
    return _plier(jetons[0])


def _candidat_fin(jetons):
    """Le jeton de queue, plié : le dernier jeton qui n'est pas une particule. Un nom
    composé se teste ainsi sur son dernier mot (« Sermier Dessemontet », « de Chambrier »)."""
    for j in reversed(jetons):
        p = _plier(j)
        if p not in PARTICULES:
            return p
    return _plier(jetons[-1]) if jetons else ''


# ---------------------------------------------------------------------------------
# Base lexicale. Aucune source n'est obligatoire : une source absente ou illisible ne lève
# pas, elle laisse seulement `disponible` à False.

# Mots d'institution saisis par erreur dans le nom ou le prénom d'une fiche OJS (par exemple
# « Edition » / « SZH-CSPS »). Ils complètent le motif chiffre, @ ou / de _bruit_fiche(), qui
# ne voit pas « SZH-CSPS ».
INSTITUTIONS_BRUIT = {
    'szh', 'csps', 'szh/csps', 'edition', 'éditions', 'revue', 'zeitschrift',
    'universite', 'universitat', 'institut', 'hep', 'fondation', 'centre', 'redaction',
}


def _bruit_fiche(champ):
    """Vrai si le champ contient un chiffre, une arobase, une barre oblique, ou un mot de
    INSTITUTIONS_BRUIT. L'appelant écarte alors la fiche entière."""
    if re.search(r'[0-9@/]', champ or ''):
        return True
    for mot in (champ or '').split():
        if _plier(mot) in INSTITUTIONS_BRUIT:
            return True
    return False


def _resoudre_chemin_base_auteurs(chemin_fourni):
    """Chemin de la base d'auteurs : celui donné par l'appelant, sinon SZH_AUTEURS_CACHE
    (même variable que lib/auteurs-ojs.js), sinon la base du poste, vue de la WSL puis de
    Windows. None si rien n'existe."""
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
    """Enrichit `prenoms` et `noms` (jeton plié → poids) depuis la base OJS du poste, au
    format {"auteurs": [{"prenom": "...", "nom": "...", ...}, ...]}. Rend (n_retenues,
    n_ecartees), ou (None, None) si la source est absente ou illisible ; ne lève pas."""
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
        # Une fiche OJS sépare prénom et nom en deux champs : chacun vote pour son côté.
        jeton_nom = _candidat_fin(nom_brut.split())
        jeton_prenom = _candidat_debut(prenom_brut.split())
        if jeton_nom:
            noms[jeton_nom] = noms.get(jeton_nom, 0) + 1
        if jeton_prenom:
            prenoms[jeton_prenom] = prenoms.get(jeton_prenom, 0) + 1
        retenues += 1
    return retenues, ecartees


def _charger_fichier_lexique(dossier_fourni, nom_fichier, cible):
    """Lit un fichier de lexique (un jeton plié par ligne, `#` en commentaire) dans `cible`
    et rend le nombre de jetons lus ; 0 si le fichier manque."""
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
        # Raccourci : les fichiers sont déjà pliés, et une ligne ASCII en minuscules n'a rien
        # à replier. On évite ainsi la normalisation NFD, l'essentiel du temps de chargement
        # (environ 4 fois plus lent). Toute autre ligne repasse par _plier().
        if ligne.isascii() and ligne.islower():
            jeton = ligne
        else:
            jeton = _plier(ligne)
        if jeton:
            cible[jeton] = cible.get(jeton, 0) + 1
            n += 1
    return n


# Fichiers de lexique du dépôt, dans l'ordre de chargement : (fichier, côté alimenté,
# libellé pour la trace des sources). outils-dev/lexique/banc-noms.py lit cette constante
# pour mesurer exactement ce que la production charge.
FICHIERS_LEXIQUE = (
    ('noms-famille.txt', 'noms', 'noms de famille des bibliographies du corpus'),
    ('noms-frequents.txt', 'noms', 'noms de famille fréquents, sources publiques'),
    ('prenoms-frequents.txt', 'prenoms', 'prénoms fréquents, sources publiques'),
)


class BaseNoms:
    """Prénoms et noms connus, avec leur provenance : jeton plié → poids (nombre de fiches
    ou de lignes qui le portent ; les signaux ne regardent que s'il est positif). Une base
    vide rend 0 à toute question."""

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
        """Charge la base OJS du poste puis les fichiers de FICHIERS_LEXIQUE, tous
        facultatifs. C'est l'appelant (la CLI) qui décide quand charger la base.

          noms-famille.txt      noms certifiés par les bibliographies du corpus
                                (outils-dev/lexique/generer-noms.py) ;
          noms-frequents.txt    noms de famille les plus portés ;
          prenoms-frequents.txt prénoms les plus portés. Ces deux-là viennent de sources
                                publiques (OFS, INSEE), par
                                outils-dev/lexique/moissonner-noms-publics.py.

        Aucun fichier du dépôt ne dérive de la base d'auteurs OJS, qui n'a pas sa place dans
        un dépôt public. Prénoms et noms restent dans deux listes séparées : deux listes de
        mots ne reconstituent aucune personne, un couple prénom-nom oui.

        L'index de prénoms est nécessaire : _signal_lexique() compare deux hypothèses, et
        sans lui un côté de la comparaison reste vide. C'est lui qui tient le côté prénom sur
        un poste sans base OJS (poste neuf, CI)."""
        base = cls()
        prenoms, noms = {}, {}
        n_retenues, n_ecartees = _charger_base_auteurs(chemin_base_auteurs, prenoms, noms)
        if n_retenues is not None:
            base.sources.append(
                'base auteurs OJS (%d fiche(s) retenue(s), %d écartée(s) comme bruit)'
                % (n_retenues, n_ecartees))
        for nom_fichier, cote, libelle in FICHIERS_LEXIQUE:
            n = _charger_fichier_lexique(chemin_lexique, nom_fichier,
                                         noms if cote == 'noms' else prenoms)
            if n:
                base.sources.append('lexique du dépôt : %s — %s (%d jeton(s))'
                                    % (nom_fichier, libelle, n))
        base._prenoms, base._noms = prenoms, noms
        base.disponible = bool(base.sources)
        return base

    @classmethod
    def depuis_dict(cls, donnees):
        """Base fournie en données, sans disque : {"prenoms": [...], "noms": [...]}, jetons
        pliés ici. C'est la forme de `base` dans l'entrée du mode --diagnostic, pour que les
        tests se passent des fichiers du poste."""
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


_BASE_VIDE = BaseNoms()   # tient lieu de `base=None`, sans test de None dans chaque signal


# ---------------------------------------------------------------------------------
# Signaux. Chacun rend (ordre ou None, poids, motif) ; un signal muet rend (None, 0, '').
# Deux forces seulement, 3 = certaine et 2 = probable : trancher() ne connaît que ces paliers.

ORDRE_DIRECT = 'prenom_nom'     # « Edith Guilley »
ORDRE_INVERSE = 'nom_prenom'    # « Guilley Edith »

FORCE_CERTAINE = 3
FORCE_PROBABLE = 2

# Niveaux de confiance, du plus sûr au moins sûr.
CONFIANCE = ('certaine', 'probable', 'propagee', 'defaut')


def _jetons_marques_majuscule(jetons, indices):
    """Positions (à partir de 0) des jetons entièrement en capitales : tapés ainsi (au moins
    deux lettres) ou mis en forme. La mise en forme arrive par indices['majuscules'] et
    indices['petites_capitales'], positions que l'appelant tire de
    manuscrit_modele.FORME_CLES."""
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
    """Force certaine. Un bloc contigu de jetons en capitales, en tête ou en queue, quand
    les autres ne le sont pas : ce bloc est le nom. Muet si aucun ou tous les jetons sont
    marqués (un titre en capitales), ou si le bloc est au milieu."""
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
    """Force certaine. La partie locale de l'e-mail est découpée sur '.', '-' et '_'. Une
    adresse professionnelle abrège volontiers le prénom, rarement le nom : si un seul des
    jetons de tête et de queue s'y retrouve en entier, c'est le nom. Muet si les deux ou
    aucun s'y retrouvent. Une adresse institutionnelle (« redaction@szh.ch » : ni séparateur
    ni jeton du segment) est ignorée."""
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
        return None, 0, ''   # adresse institutionnelle
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
    """Force probable. `indices['noms_biblio']` : noms de famille que la bibliographie du
    manuscrit certifie (forme APA « Nom, P. »), fournis par l'appelant. Si un seul des
    jetons de tête et de queue y figure, c'est le nom."""
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


# Écart minimal entre les deux scores du signal lexique pour trancher. Mesurée sur la base
# d'auteurs OJS (chaque fiche jugée par le reste de la base), la marge 1 tranche juste dans
# environ 70 % des cas et à l'envers dans moins de 1 % ; la marge 2 ne tranche presque
# rien. Quand le lexique se tait, le repli est la convention prénom-nom, fausse sur tout
# nom écrit à l'envers : un signal à moins de 1 % d'erreur vaut mieux. Et la casse ou
# l'e-mail, de force certaine, l'emportent sur lui.
MARGE_LEXIQUE = 1


def _signal_lexique(jetons, base):
    """Force probable. `score_direct` = (jeton de tête connu comme prénom) + (jeton de queue
    connu comme nom) ; `score_inverse` est symétrique. Tranche dès qu'un score dépasse
    l'autre d'au moins MARGE_LEXIQUE ; muet en cas d'égalité. Le lexique ne rejette jamais
    un segment : une base muette rend seulement (None, 0, '')."""
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
# Décision : combinaison des signaux.

def trancher(jetons, indices=None, base=None):
    """Rend {'ordre', 'confiance', 'motif', 'conflit', 'signaux'}. `jetons` : les mots du
    segment tels que tapés (le signal casse a besoin de la casse), sans titres académiques
    (hm.sans_titres_academiques()). Moins de 2 jetons : ordre direct, sans signal."""
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

    # Des signaux certains tous d'accord donnent 'certaine', quoi que disent les signaux
    # plus faibles. Deux signaux certains en désaccord passent à la somme ci-dessous.
    forts = [s for s in signaux if s['poids'] >= FORCE_CERTAINE]
    if forts:
        ordres_forts = {s['ordre'] for s in forts}
        if len(ordres_forts) == 1:
            s = forts[0]
            return {'ordre': s['ordre'], 'confiance': 'certaine', 'motif': s['motif'],
                    'conflit': False, 'signaux': signaux}

    # Sinon, le côté dont la somme des poids est la plus forte donne 'probable'.
    somme_direct = sum(s['poids'] for s in signaux if s['ordre'] == ORDRE_DIRECT)
    somme_inverse = sum(s['poids'] for s in signaux if s['ordre'] == ORDRE_INVERSE)
    if somme_direct != somme_inverse:
        ordre = ORDRE_DIRECT if somme_direct > somme_inverse else ORDRE_INVERSE
        meilleur = max((s for s in signaux if s['ordre'] == ordre), key=lambda s: s['poids'])
        return {'ordre': ordre, 'confiance': 'probable', 'motif': meilleur['motif'],
                'conflit': False, 'signaux': signaux}

    # Sommes égales avec deux ordres présents : conflit, convention prénom-nom.
    ordres_presents = {s['ordre'] for s in signaux}
    if len(ordres_presents) > 1:
        noms_signaux = ', '.join(sorted(s['signal'] for s in signaux))
        return {'ordre': ORDRE_DIRECT, 'confiance': 'defaut',
                'motif': ('signaux contradictoires à poids égal (%s) : convention '
                          'prénom-nom appliquée par défaut' % noms_signaux),
                'conflit': True, 'signaux': signaux}

    return {'ordre': ORDRE_DIRECT, 'confiance': 'defaut',
            'motif': 'aucun indice, convention prénom-nom appliquée', 'conflit': False,
            'signaux': signaux}


def trancher_groupe(segments, base=None):
    """Une décision par segment (schéma de trancher()), après propagation. `segments` :
    [{'jetons': [...], 'indices': {...}}, ...] ; l'appelant choisit la portée (une ligne
    d'auteurs ou le document entier).

    Propagation : si les segments tranchés ('certaine' ou 'probable') s'accordent tous sur
    un ordre, les segments restés en 'defaut' sans conflit l'adoptent, avec la confiance
    'propagee' et un motif qui nomme le segment donneur. S'ils se contredisent, rien ne se
    propage."""
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
# Découpage.

def _est_initiale_pointee(jeton):
    # Une lettre suivie d'un point (« C. ») : l'initiale d'un second prénom, comme dans
    # « Susan C. A. Burkhardt » ou « Bernard N. Schumacher », jamais un nom à elle seule.
    return len(jeton) == 2 and jeton[1] == '.' and jeton[0].isalpha()


def _absorber_prenom_compose(jetons):
    """Rend (prenom_jetons, reste). Le premier jeton est toujours le prénom ; il se prolonge
    tant que le jeton suivant est un tiret isolé (« Anne - Françoise ») ou une initiale
    pointée (« Susan C. A. Burkhardt » → prénom « Susan C. A. »). Le dernier jeton reste au
    nom. `jetons` a au moins 2 éléments."""
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
    # Indice de début du prénom en ordre inverse. Seule la place du prénom change, pas son
    # ordre interne (« Burkhardt Susan C. A. ») : on ne peut donc pas retourner la liste. On
    # remonte depuis la fin à travers les initiales pointées ; le premier autre jeton est le
    # prénom. jetons[0] reste toujours au nom. Le tiret isolé n'est pas traité de ce côté.
    j = len(jetons) - 1
    while j > 1 and _est_initiale_pointee(jetons[j]):
        j -= 1
    return j


def _repartir(jetons, ordre):
    """Rend (prenom, nom) selon `ordre`. Direct : le prénom est en tête
    (_absorber_prenom_compose), le reste est le nom. Inverse : le prénom est en queue
    (_borne_prenom_inverse). Les particules restent du côté du nom : « Anne-Françoise de
    Chambrier » → nom « de Chambrier » ; « De Chambrier Anne-Françoise » → nom
    « De Chambrier ».

    Limite connue : un prénom composé séparé par une espace (« Laura Marie Maaß ») donne le
    prénom « Laura » et le nom « Marie Maaß ». Le texte seul ne le distingue pas d'un double
    nom de famille ; on garde cette coupe, fausse mais repérable, plutôt que de parier."""
    if ordre == ORDRE_INVERSE:
        j = _borne_prenom_inverse(jetons)
        return ' '.join(jetons[j:]), ' '.join(jetons[:j])
    prenom_j, reste = _absorber_prenom_compose(jetons)
    return ' '.join(prenom_j), ' '.join(reste)


# Nom public de la répartition, pour manuscrit_entete.py : il tranche l'ordre d'une ligne
# entière par trancher_groupe(), puis répartit segment par segment. Ne pas recopier cet
# algorithme ailleurs.
repartir = _repartir


def _jetons_depuis_texte(texte):
    """Les mots du texte, sans titres académiques (hm.sans_titres_academiques()) ni obèle
    (†)."""
    t = hm.sans_titres_academiques(texte) or ''
    t = t.replace('\u2020', ' ').strip()
    return t.split()


def decoupe(texte, indices=None, base=None):
    """Rend {'prenom', 'nom', 'ordre', 'confiance', 'motif', 'conflit'} pour un segment. Un
    seul mot va tout entier dans `nom`, avec la confiance 'defaut'."""
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
# Mode diagnostic, comme manuscrit_entete.py : --diagnostic, un JSON sur stdin, une ligne
# JSON sur stdout. `base` arrive dans le JSON, pour que les tests se passent des fichiers du
# poste. Les segments passent ensemble par trancher_groupe(), pour exercer la propagation.

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
