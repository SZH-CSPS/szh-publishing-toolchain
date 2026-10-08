#!/usr/bin/env python3
# Vérifie la typographie des textes que voient l'équipe et le lectorat, en français, en
# allemand et en italien.
#
#   python3 test/typo-check.py              -> rapport ; sortie 0 si tout passe, 1 sinon
#   python3 test/typo-check.py --corriger   -> applique les corrections sûres
#   python3 test/typo-check.py --liste      -> les règles, sans rien lire
#
# Les règles suivent le Guide du typographe (AST) pour le français, le Duden et l'usage
# suisse pour l'allemand ; docs/TYPOGRAPHIE.md les détaille. Français et allemand
# s'opposent sur l'espacement : le français met une insécable avant la ponctuation haute
# et à l'intérieur des guillemets, l'allemand suisse colle tout.
#
# Seules les chaînes visibles sont lues (liste SURFACES). Les commentaires de code gardent
# l'apostrophe droite, et les clés d'API (celles d'OJS) doivent rester identiques à
# l'octet près.
"""Contrôle et correction de la typographie des chaînes visibles."""

import io
import json
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

APO = "’"       # apostrophe typographique
NBSP = " "      # espace insécable
DEMI = "–"      # demi-cadratin, tiret d'incise
CAD = "—"       # cadratin : proscrit
ELL = "…"       # points de suspension

# Langues sans espace avant la ponctuation haute ni dans les guillemets.
COLLEES = ("de", "it")


# --------------------------------------------------------------------------- les règles
#
# Chaque règle détecte ses fautes et, si elle a une fonction `corriger`, les répare. Sans
# elle, la règle signale seulement (les guillemets, qu'on ne peut pas apparier sans risque).

class Regle:
    def __init__(self, code, langues, titre_fr, titre_de, detecter, corriger=None):
        self.code = code
        self.langues = langues
        self.titre_fr = titre_fr
        self.titre_de = titre_de
        self._detecter = detecter
        self._corriger = corriger

    def porte_sur(self, langue):
        return langue in self.langues

    def fautes(self, valeur):
        return self._detecter(valeur)

    def corriger(self, valeur):
        return valeur if self._corriger is None else self._corriger(valeur)

    @property
    def auto(self):
        return self._corriger is not None


# A1, apostrophe : seulement l'élision, une apostrophe entre deux lettres.
RE_ELISION = re.compile(r"([A-Za-zÀ-ÿ])'([A-Za-zÀ-ÿ])")


def _apostrophes(v):
    # Plusieurs passes : deux élisions séparées par une seule lettre se chevauchent, et une
    # passe n'en prend qu'une sur deux.
    for _ in range(4):
        neuf = RE_ELISION.sub(r"\1" + APO + r"\2", v)
        if neuf == v:
            break
        v = neuf
    return v


# E1/E2, espacement : on remplace une espace déjà présente, on n'en insère jamais (sinon
# « https://ror.org » et « 10:30 » seraient modifiés). Une suite d'espaces est un
# alignement de colonne (« Detail   : {0} ») et reste telle quelle : le lookbehind écarte
# une espace précédée d'une autre. Une espace en tête de fragment reste visée, car les
# messages des filtres Lua sont concaténés.
RE_FR_HAUTE = re.compile(r"(?<![ \t   ])[   ]([;:!?])")
RE_FR_GUILL_O = re.compile(r"«[   ]")
RE_FR_GUILL_F = re.compile(r"(?<![ \t   ])[   ]»")
RE_DE_HAUTE = re.compile(r"(?<![ \t   ])[    ]([;:!?])")
RE_DE_GUILL_O = re.compile(r"«[    ]")
RE_DE_GUILL_F = re.compile(r"(?<![ \t   ])[    ]»")
RE_POURCENT = re.compile(r"(?<=[0-9])[   ](%)(?![A-Za-z0-9%])")

# T1, tiret d'incise : demi-cadratin, jamais de cadratin. En français, une insécable le
# précède pour qu'il ne commence pas une ligne.
RE_INCISE_FR = re.compile(r"(?<![ \t   ])[   ](" + DEMI + r"|" + CAD + r")(?=[  ])")

# E4 : abréviations soudées par une insécable.
ABREV_FR = [(re.compile(r"\bp\.[   ]?ex\."), "p." + NBSP + "ex.")]
ABREV_DE = [
    (re.compile(r"\bz\.[   ]?B\."), "z." + NBSP + "B."),
    (re.compile(r"\bd\.[   ]?h\."), "d." + NBSP + "h."),
    (re.compile(r"\bS\.[   ]?(?=\d)"), "S." + NBSP),
]

# S2, ordinaux français : « 2e », pas « 2ème ».
RE_ORDINAL = re.compile(r"\b(\d+)(?:ème|ième|eme)\b")

RE_GUILL_COURBES = re.compile(r"[„“”‚‘]")
RE_TROIS_POINTS = re.compile(r"(?<!\.)\.\.\.(?!\.)")


def _fr_espaces(v):
    v = RE_FR_HAUTE.sub(NBSP + r"\1", v)
    v = RE_FR_GUILL_O.sub("«" + NBSP, v)
    v = RE_FR_GUILL_F.sub(NBSP + "»", v)
    return v


def _de_espaces(v):
    v = RE_DE_HAUTE.sub(r"\1", v)
    v = RE_DE_GUILL_O.sub("«", v)
    v = RE_DE_GUILL_F.sub("»", v)
    return v


def _incise_fr(v):
    return RE_INCISE_FR.sub(NBSP + DEMI, v.replace(CAD, DEMI))


def _abrev(paires):
    def f(v):
        for motif, remp in paires:
            v = motif.sub(remp, v)
        return v
    return f


def _trouve(motif):
    return lambda v: [m.group(0) for m in motif.finditer(v)]


def _contient(car):
    return lambda v: [car] * v.count(car)


REGLES = [
    Regle("A1", ("fr", "de", "it"),
          "apostrophe courbe ’ dans les élisions",
          "typografischer Apostroph ’ bei Auslassungen",
          lambda v: [m.group(0) for m in RE_ELISION.finditer(v)],
          _apostrophes),
    Regle("A2", ("fr", "de", "it"),
          "guillemets « » ; jamais „ “ ” ‚ ‘",
          "Anführungszeichen « » ; nie „ “ ” ‚ ‘",
          _trouve(RE_GUILL_COURBES)),
    Regle("E1", ("fr",),
          "insécable à l’intérieur des guillemets « … »",
          "geschütztes Leerzeichen innerhalb « … »",
          lambda v: (_trouve(RE_FR_GUILL_O)(v) + _trouve(RE_FR_GUILL_F)(v)),
          _fr_espaces),
    Regle("E1", COLLEES,
          "guillemets collés au texte : «…»",
          "Anführungszeichen ohne Leerschlag: «…»",
          lambda v: (_trouve(RE_DE_GUILL_O)(v) + _trouve(RE_DE_GUILL_F)(v)),
          _de_espaces),
    Regle("E2", ("fr",),
          "insécable avant ; : ! ?",
          "geschütztes Leerzeichen vor ; : ! ?",
          _trouve(RE_FR_HAUTE),
          _fr_espaces),
    Regle("E2", COLLEES,
          "ponctuation haute collée : pas d’espace avant ; : ! ?",
          "hohe Satzzeichen ohne Leerschlag vor ; : ! ?",
          _trouve(RE_DE_HAUTE),
          _de_espaces),
    Regle("E3", ("fr", "de", "it"),
          "insécable avant le signe % — dans toutes les langues",
          "geschütztes Leerzeichen vor dem Prozentzeichen – in allen Sprachen",
          _trouve(RE_POURCENT),
          lambda v: RE_POURCENT.sub(NBSP + r"\1", v)),
    Regle("T1", ("fr",),
          "tiret d’incise : demi-cadratin –, précédé d’une insécable",
          "Gedankenstrich: Halbgeviertstrich –, mit geschütztem Leerzeichen davor",
          lambda v: _contient(CAD)(v) + _trouve(RE_INCISE_FR)(v),
          _incise_fr),
    Regle("T1", COLLEES,
          "tiret d’incise : demi-cadratin –, entre deux espaces",
          "Gedankenstrich: Halbgeviertstrich – zwischen zwei Leerzeichen",
          _contient(CAD),
          lambda v: v.replace(CAD, DEMI)),
    Regle("S1", ("fr", "de", "it"),
          "points de suspension … en un seul caractère",
          "Auslassungspunkte … als ein Zeichen",
          _trouve(RE_TROIS_POINTS),
          lambda v: RE_TROIS_POINTS.sub(ELL, v)),
    Regle("S3", ("de",),
          "ß écrit ss (usage suisse)",
          "ß wird als ss geschrieben (Schweizer Usus)",
          _contient("ß"),
          lambda v: v.replace("ß", "ss")),
    Regle("E4", ("fr",),
          "abréviation soudée : p. ex. avec insécable",
          "Abkürzung mit geschütztem Leerzeichen: p. ex.",
          lambda v: [m.group(0) for motif, _ in ABREV_FR for m in motif.finditer(v)
                     if NBSP not in m.group(0)],
          _abrev(ABREV_FR)),
    Regle("E4", ("de",),
          "abréviations soudées : z. B., d. h., S. 12 avec insécable",
          "Abkürzungen mit geschütztem Leerzeichen: z. B., d. h., S. 12",
          lambda v: [m.group(0) for motif, _ in ABREV_DE for m in motif.finditer(v)
                     if NBSP not in m.group(0)],
          _abrev(ABREV_DE)),
    Regle("S2", ("fr",),
          "ordinaux : 1er, 1re, 2e ; jamais 2ème",
          "Ordnungszahlen: 1er, 1re, 2e; nie 2ème",
          _trouve(RE_ORDINAL),
          lambda v: RE_ORDINAL.sub(r"\1e", v)),
]

# E1, E2 et T1 ont deux entrées, l'une pour le français, l'autre pour les langues
# collées ; la langue choisit.
REGLES_PAR_CODE = {}
for _r in REGLES:
    REGLES_PAR_CODE.setdefault(_r.code, []).append(_r)


def regle_de(code, langue):
    """La règle `code` telle qu'elle s'applique à `langue`."""
    for r in REGLES_PAR_CODE.get(code, []):
        if r.porte_sur(langue):
            return r
    return REGLES_PAR_CODE.get(code, [None])[0]


def corriger_valeur(valeur, langue):
    """Applique à `valeur` toutes les règles automatiques de `langue`."""
    for regle in REGLES:
        if regle.porte_sur(langue) and regle.auto:
            valeur = regle.corriger(valeur)
    return valeur


def fautes_valeur(valeur, langue):
    """Rend [(code, exemple)] pour tout ce qui cloche dans `valeur`."""
    trouve = []
    for regle in REGLES:
        if not regle.porte_sur(langue):
            continue
        for ex in regle.fautes(valeur):
            trouve.append((regle.code, ex))
    return trouve


# ------------------------------------------------------------------ lecture des surfaces
#
# Un extracteur rend [(no_ligne, langue, valeur, remplacer)] où `remplacer(valeur, ligne)`
# reconstruit la ligne autour d'une valeur corrigée : seule la valeur est réécrite, jamais
# la clé.
#
# `remplacer` reçoit la ligne courante, car une ligne peut porter plusieurs fragments
# (« fr = '…', de = '…' »). parcourir() les applique de droite à gauche pour que les
# décalages relevés à l'extraction restent valides.

RE_CLE_JS = re.compile(r"^(\s*'[^']+':\s*')((?:[^'\\]|\\.)*)('\s*,?\s*)$")
RE_BLOC_LANGUE = re.compile(r"^\s*(fr|de|en|it):\s*\{\s*$")
RE_CLE_PS = re.compile(r"^(\s*'[^']+'\s*=\s*')(.*)('\s*)$")
RE_BLOC_PS = re.compile(r"^\s*(fr|de|en|it)\s*=\s*@\{\s*$")
RE_VAL_JSON = re.compile(r'^(\s*"[^"]+":\s*")((?:[^"\\]|\\.)*)("\s*,?\s*)$')
RE_LUA_LANGUE = re.compile(r"\b(fr|de|it|en)\s*=\s*'((?:[^'\\]|\\.)*)'")


def _refaire(prefixe, suffixe):
    return lambda v, _l: prefixe + v + suffixe


def extraire_js_i18n(lignes, _langue):
    """lib/i18n.js : un dictionnaire par langue, une clé par ligne."""
    courante = None
    for i, l in enumerate(lignes):
        bloc = RE_BLOC_LANGUE.match(l)
        if bloc:
            courante = bloc.group(1)
            continue
        if courante is None:
            continue
        m = RE_CLE_JS.match(l)
        if m:
            yield i, courante, m.group(2), _refaire(m.group(1), m.group(3))


def extraire_ps(lignes, _langue):
    """windows/szh-common.ps1 : la table $SzhTextes, une langue par sous-table."""
    courante = None
    dans_table = False
    for i, l in enumerate(lignes):
        if "SzhTextes = @{" in l:
            dans_table = True
            continue
        if not dans_table:
            continue
        bloc = RE_BLOC_PS.match(l)
        if bloc:
            courante = bloc.group(1)
            continue
        if courante is None:
            continue
        m = RE_CLE_PS.match(l)
        if m:
            # PowerShell 5.1 traite ’ comme un délimiteur de chaîne, comme ' : elle est
            # doublée dans le fichier. On la dédouble pour juger et on la redouble pour
            # écrire, sinon le script ne se charge plus.
            valeur = m.group(2).replace(APO + APO, APO)
            yield i, courante, valeur, (
                lambda v, _l, p=m.group(1), s=m.group(3):
                    p + v.replace(APO, APO + APO) + s)


# Clés de package.json dont la valeur est une expression de VS Code, pas du texte.
RE_CLE_CODE_JSON = re.compile(r'^\s*"(when|enablement)":')


def extraire_json(lignes, langue):
    for i, l in enumerate(lignes):
        m = RE_VAL_JSON.match(l)
        if m and not RE_CLE_CODE_JSON.match(l):
            yield i, langue, m.group(2), _refaire(m.group(1), m.group(3))


RE_LUA_OUVRE = re.compile(r"^(\s*)(fr|de|it|en)\s*=\s*\{\s*$")
RE_LUA_FERME = re.compile(r"^(\s*)\},?\s*$")
RE_LUA_COMMENT = re.compile(r"^\s*--")
RE_LITTERAL = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"")


def _est_prose(v):
    """Vrai pour une phrase : elle a une espace ou un caractère non ASCII.

    Les motifs Lua (« %w+ », « ... ») et les noms de classe n'en ont pas ; les corriger
    casserait un gsub sans erreur visible.
    """
    if not v:
        return False
    return " " in v or any(ord(c) > 127 for c in v)


def extraire_lua(lignes, _langue):
    """Filtres Lua : les formes « fr = '…' » et les blocs « fr = { … } ».

    Dans un bloc de langue (des fonctions de message qui concatènent des fragments sur
    plusieurs lignes, comme dans szh-maquette.lua), on suit l'indentation et on prend
    chaque littéral de prose.
    """
    pile = []
    for i, l in enumerate(lignes):
        ferme = RE_LUA_FERME.match(l)
        if ferme and pile and len(ferme.group(1)) <= pile[-1][1]:
            pile.pop()
            continue
        ouvre = RE_LUA_OUVRE.match(l)
        if ouvre:
            pile.append((ouvre.group(2), len(ouvre.group(1))))
            continue
        if RE_LUA_COMMENT.match(l):
            continue
        if pile:
            for m in RE_LITTERAL.finditer(l):
                v = m.group(1) if m.group(1) is not None else m.group(2)
                if _est_prose(v):
                    yield i, pile[-1][0], v, _remplacant_intervalle(
                        *(m.span(1) if m.group(1) is not None else m.span(2)))
            continue
        # Hors bloc : « fr = '…', de = '…' » sur une ligne.
        for m in RE_LUA_LANGUE.finditer(l):
            if _est_prose(m.group(2)):
                yield i, m.group(1), m.group(2), _remplacant_intervalle(*m.span(2))


# Libellés du cockpit hors i18n.js (tâches de lib/articles.js, types d'article de
# lib/yaml.js) : « fr: '…', de: '…', it: '…' », souvent sur une seule ligne.
RE_JS_LANGUE = re.compile(r"\b(fr|de|it)\s*:\s*'((?:[^'\\]|\\.)*)'")


def extraire_js_bilingue(lignes, _langue):
    for i, l in enumerate(lignes):
        if l.lstrip().startswith("//"):
            continue
        for m in RE_JS_LANGUE.finditer(l):
            if _est_prose(m.group(2)):
                yield i, m.group(1), m.group(2), _remplacant_intervalle(*m.span(2))


# nouveautes.json : la note « Quoi de neuf » montrée après une mise à jour, en fr et en de.
# Le fichier suit la mise en forme de JSON.stringify à deux espaces, ce qui permet de le
# lire ligne à ligne et de garder l'intervalle exact à réécrire.
#
# La langue vient du bloc englobant, "fr" ou "de". Toute autre clé ("_lisez-moi", un
# numéro de version "1.1") l'efface, pour qu'un texte de service ne soit pas jugé dans la
# langue du bloc précédent.
RE_JSON_LANGUE = re.compile(r'^\s*"(fr|de)"\s*:\s*\{')
RE_JSON_TITRE = re.compile(r'^\s*"titre"\s*:\s*"((?:[^"\\]|\\.)*)"')
RE_JSON_POINTS = re.compile(r'^\s*"points"\s*:')
RE_JSON_AUTRE_CLE = re.compile(r'^\s*"[^"]*"\s*:')
RE_JSON_POINT = re.compile(r'^\s*"((?:[^"\\]|\\.)*)"\s*,?\s*$')


def extraire_json_nouveautes(lignes, _langue):
    langue = None
    for i, l in enumerate(lignes):
        m = RE_JSON_LANGUE.match(l)
        if m:
            langue = m.group(1)
            continue
        m = RE_JSON_TITRE.match(l)
        if m:
            # Le titre porte sa valeur sur la même ligne que sa clé.
            if langue and _est_prose(m.group(1)):
                yield i, langue, m.group(1), _remplacant_intervalle(*m.span(1))
            continue
        # « points » ouvre un tableau de phrases : la langue est gardée.
        if RE_JSON_POINTS.match(l):
            continue
        if RE_JSON_AUTRE_CLE.match(l):
            langue = None
            continue
        if langue is None:
            continue
        m = RE_JSON_POINT.match(l)
        if m and _est_prose(m.group(1)):
            yield i, langue, m.group(1), _remplacant_intervalle(*m.span(1))


# Webviews du cockpit (media/*.js). Leur texte vient surtout de TXT.xxx, donc de
# lib/i18n.js ; on lit ici les quelques littéraux écrits en clair, tous en français. Ces
# fichiers n'ont pas de structure fr:/de:, d'où un extracteur à part.
RE_JS_STRING = re.compile(r"'((?:[^'\\]|\\.)*)'")


def _code_sans_commentaire(l):
    """Tronque une ligne à son commentaire `//` final (`https://` n'en est pas un)."""
    i = 0
    while True:
        j = l.find('//', i)
        if j == -1:
            return l
        if j > 0 and l[j - 1] == ':':
            i = j + 2
            continue
        return l[:j]


def extraire_js_media(lignes, langue):
    """media/*.js : littéraux JS visibles, hors ce que lib/i18n.js porte déjà.

    Les commentaires `//` sont écartés d'abord : ils gardent l'apostrophe droite et ne
    s'affichent pas.
    """
    for i, l in enumerate(lignes):
        if l.lstrip().startswith('//'):
            continue
        code = _code_sans_commentaire(l)
        for m in RE_JS_STRING.finditer(code):
            v = m.group(1)
            if _est_prose(v):
                yield i, langue, v, _remplacant_intervalle(*m.span(1))


def _remplacant_intervalle(debut, fin):
    """Recompose la ligne autour d'un seul fragment.

    Par décalages et non par recherche de texte : une ligne porte souvent plusieurs
    langues, et une recherche pourrait remplacer la mauvaise.
    """
    return lambda v, ligne: ligne[:debut] + v + ligne[fin:]


RE_FENCE = re.compile(r"^\s*```")
RE_CODE_INLINE = re.compile(r"`[^`]*`")
JETON = ""


def extraire_texte(lignes, langue):
    """Markdown, YAML, texte brut : de la prose, hors blocs et segments de code.

    Le code entre accents graves est remplacé par un marqueur, pas retiré : la ponctuation
    qui l'entoure reste ainsi contrôlée (« d'`articles-word` : »).
    """
    dans_code = False
    for i, l in enumerate(lignes):
        if RE_FENCE.match(l):
            dans_code = not dans_code
            continue
        if dans_code:
            continue
        codes = []

        def masquer(m, codes=codes):
            codes.append(m.group(0))
            return JETON + str(len(codes) - 1) + JETON

        masque = RE_CODE_INLINE.sub(masquer, l)
        yield i, langue, masque, _demasquer(codes)


def _demasquer(codes):
    motif = re.compile(JETON + r"(\d+)" + JETON)
    return lambda v, _l: motif.sub(lambda m: codes[int(m.group(1))], v)


RE_TWIG_TAG = re.compile(r"\{\{.*?\}\}|\{%.*?%\}|\{#.*?#\}")
RE_TWIG_LANGUE = re.compile(r"\{#\s*langue\s*:\s*(\w+)\s*#\}")


def extraire_twig(lignes, langue):
    """Gabarits Twig : le texte brut, hors constructions Twig.

    {{ expr }}, {% tag %} et {# commentaire #} sont masqués. La langue vient du nom de
    fichier (.fr., .de.) ou, à défaut, de la surface.

    Un commentaire {# … #} sur plusieurs lignes est sauté en entier, de la ligne qui
    l'ouvre à celle qui le ferme comprise. On suppose que ces deux lignes ne portent rien
    d'autre, ce qui est vrai dans les gabarits actuels.
    """
    dans_commentaire = False
    for i, l in enumerate(lignes):
        if dans_commentaire:
            if '#}' in l:
                dans_commentaire = False
            continue
        o = l.find('{#')
        if o != -1 and '#}' not in l[o:]:
            dans_commentaire = True
            continue
        # Dans un gabarit à deux langues, `{# langue : de #}` fixe la langue jusqu'à la
        # marque suivante.
        marque = RE_TWIG_LANGUE.search(l)
        if marque:
            langue = marque.group(1)
        codes = []

        def masquer(m, codes=codes):
            codes.append(m.group(0))
            return JETON + str(len(codes) - 1) + JETON

        masque = RE_TWIG_TAG.sub(masquer, l)
        yield i, langue, masque, _demasquer(codes)


RE_PY_CODE = re.compile(r"\{[^{}]*\}")


def extraire_py(lignes, langue):
    """moissonneurs/*.py : les littéraux de prose, hors docstrings et commentaires.

    Le code d'une f-string ({…}) est masqué comme le code du Markdown.
    """
    dans_doc = False
    for i, l in enumerate(lignes):
        s = l.strip()
        n = s.count('"""')
        if dans_doc:
            dans_doc = n % 2 == 0
            continue
        if s.startswith('"""') or s.startswith('#'):
            dans_doc = s.startswith('"""') and n % 2 == 1
            continue
        for m in RE_LITTERAL.finditer(l):
            groupe = 1 if m.group(1) is not None else 2
            v = m.group(groupe)
            if not _est_prose(v):
                continue
            codes = []

            def masquer(x, codes=codes):
                codes.append(x.group(0))
                return JETON + str(len(codes) - 1) + JETON

            masque = RE_PY_CODE.sub(masquer, v)
            demasquer = _demasquer(codes)
            placer = _remplacant_intervalle(*m.span(groupe))
            yield i, langue, masque, (lambda neuve, ligne, d=demasquer, p=placer: p(d(neuve, ligne), ligne))


# Fichiers lus : (chemin, extracteur, langue par défaut). La langue par défaut sert aux
# fichiers monolingues ; les autres la portent dans leur structure.
SURFACES = [
    ("vscodium-extension/szh-cockpit/lib/i18n.js", extraire_js_i18n, None),
    ("vscodium-extension/szh-cockpit/package.nls.json", extraire_json, "fr"),
    ("vscodium-extension/szh-cockpit/package.nls.de.json", extraire_json, "de"),
    ("vscodium-extension/szh-cockpit/package.json", extraire_json, "fr"),
    # La table $SzhTextes du lanceur.
    ("windows/szh-textes.ps1", extraire_ps, None),
    # Tâches éditoriales et types d'article : des données du modèle, affichées dans les
    # panneaux.
    ("vscodium-extension/szh-cockpit/lib/articles.js", extraire_js_bilingue, None),
    ("vscodium-extension/szh-cockpit/lib/yaml.js", extraire_js_bilingue, None),
    ("revue-template/BIENVENUE.md", extraire_texte, "fr"),
    ("revue-template/ausgabe.yaml", extraire_texte, "fr"),
    ("revue-template/articles-word/LISEZ-MOI.txt", extraire_texte, "fr"),
    ("userdoc.md", extraire_texte, "fr"),
    ("nouveautes.json", extraire_json_nouveautes, None),
    # Les notes de typographie suivent leurs propres règles ; le reste de docs/ n'est pas lu.
    ("docs/TYPOGRAPHIE.md", extraire_texte, "fr"),
    ("docs/TYPOGRAPHIE-FR.md", extraire_texte, "fr"),
    ("docs/TYPOGRAPHIE-DE.md", extraire_texte, "de"),
    # Messages des moissonneurs, affichés en console ou dans le cockpit.
    ("moissonneurs/console.py", extraire_py, "fr"),
    ("moissonneurs/moisson.py", extraire_py, "fr"),
    ("moissonneurs/evenements.py", extraire_py, "fr"),
]

# Les filtres Lua, qui portent les libellés imprimés dans le PDF.
for _nom in sorted(os.listdir(os.path.join(RACINE, "pipeline", "filters"))):
    if _nom.endswith(".lua"):
        SURFACES.append(("pipeline/filters/" + _nom, extraire_lua, None))

# Gabarits de courriel du cockpit : la langue se lit dans le nom (envoi-auteur.de.twig).
for _nom in sorted(os.listdir(os.path.join(RACINE, "vscodium-extension/szh-cockpit/mail-templates"))):
    if _nom.endswith(".twig"):
        _langue_gabarit = "de" if ".de." in _nom else "fr"
        SURFACES.append(("vscodium-extension/szh-cockpit/mail-templates/" + _nom, extraire_twig, _langue_gabarit))

# Gabarits de courriel du lanceur : même règle de nom, plus .en., qui n'est pas contrôlé
# (voir LANGUES_CONTROLEES).
for _nom in sorted(os.listdir(os.path.join(RACINE, "windows/mail-templates"))):
    if _nom.endswith(".twig"):
        if ".de." in _nom:
            _langue_gabarit = "de"
        elif ".en." in _nom:
            _langue_gabarit = "en"
        else:
            _langue_gabarit = "fr"
        SURFACES.append(("windows/mail-templates/" + _nom, extraire_twig, _langue_gabarit))

# Gabarits d'export du secrétariat : sans suffixe de langue, écrits en français.
for _nom in sorted(os.listdir(os.path.join(RACINE, "vscodium-extension/szh-cockpit/export-templates"))):
    if _nom.endswith(".twig"):
        SURFACES.append(("vscodium-extension/szh-cockpit/export-templates/" + _nom, extraire_twig, "fr"))

# Webviews du cockpit (voir extraire_js_media).
for _nom in sorted(os.listdir(os.path.join(RACINE, "vscodium-extension/szh-cockpit/media"))):
    if _nom.endswith(".js"):
        SURFACES.append(("vscodium-extension/szh-cockpit/media/" + _nom, extraire_js_media, "fr"))

# L'anglais n'est pas contrôlé : il ne sert qu'au repli des raccourcis Windows.
LANGUES_CONTROLEES = ("fr", "de", "it")


def lire(chemin):
    with io.open(os.path.join(RACINE, chemin), encoding="utf-8", newline="") as f:
        brut = f.read()
    fin = "\r\n" if "\r\n" in brut else "\n"
    return brut.split(fin), fin


def ecrire(chemin, lignes, fin):
    with io.open(os.path.join(RACINE, chemin), "w", encoding="utf-8", newline="") as f:
        f.write(fin.join(lignes))


def parcourir(corriger=False):
    """Rend (constats, n_corrigees). Un constat : (chemin, ligne, langue, code, exemple)."""
    constats = []
    n_corr = 0
    for chemin, extracteur, defaut in SURFACES:
        absolu = os.path.join(RACINE, chemin)
        if not os.path.exists(absolu):
            print("  absent, ignoré : " + chemin)
            continue
        lignes, fin = lire(chemin)
        touche = False
        a_faire = {}
        for no, langue, valeur, remplacer in list(extracteur(list(lignes), defaut)):
            if langue not in LANGUES_CONTROLEES:
                continue
            fautes = fautes_valeur(valeur, langue)
            if not fautes:
                continue
            for code, exemple in fautes:
                constats.append((chemin, no + 1, langue, code, exemple))
            if corriger:
                neuve = corriger_valeur(valeur, langue)
                if neuve != valeur:
                    a_faire.setdefault(no, []).append((neuve, remplacer))
        # De droite à gauche : les décalages relevés à l'extraction restent valides.
        for no, travaux in a_faire.items():
            for neuve, remplacer in reversed(travaux):
                lignes[no] = remplacer(neuve, lignes[no])
                n_corr += 1
            touche = True
        if corriger and touche:
            ecrire(chemin, lignes, fin)
    return constats, n_corr


def afficher(constats):
    par_fichier = {}
    par_regle = {}
    for chemin, no, langue, code, exemple in constats:
        par_fichier.setdefault(chemin, []).append((no, langue, code, exemple))
        par_regle.setdefault((code, langue), 0)
        par_regle[(code, langue)] += 1

    for chemin in sorted(par_fichier):
        entrees = par_fichier[chemin]
        print("\n" + chemin + "  (" + str(len(entrees)) + ")")
        for no, langue, code, exemple in entrees[:8]:
            montre = exemple.replace(NBSP, "·").replace(" ", "‸")
            print("   %5d  %-2s  %-4s  %s" % (no, langue, code, repr(montre)))
        if len(entrees) > 8:
            print("          … et %d autres" % (len(entrees) - 8))

    print("\n---- par règle " + "-" * 50)
    for (code, langue), n in sorted(par_regle.items(), key=lambda kv: -kv[1]):
        print("  %-5s %-3s %6d   %s" % (code, langue, n, regle_de(code, langue).titre_fr))


def lister():
    for r in REGLES:
        print("  %-5s %-10s %s" % (r.code, ",".join(r.langues), r.titre_fr))
        print("  %-5s %-10s %s" % ("", "", r.titre_de))


def main(argv):
    if "--liste" in argv:
        lister()
        return 0
    corriger = "--corriger" in argv
    constats, n = parcourir(corriger=corriger)
    if corriger:
        print("Corrigé : %d chaîne(s)." % n)
        constats, _ = parcourir(corriger=False)
    if not constats:
        print("Typographie conforme sur les %d surfaces contrôlées." % len(SURFACES))
        return 0
    afficher(constats)
    print("\n%d écart(s) sur %d surfaces." % (len(constats), len(SURFACES)))
    return 1


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main(sys.argv[1:]))
