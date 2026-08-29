#!/usr/bin/env python3
# typo-check.py — vérifie la typographie des textes visibles par l'équipe et par le
# lectorat, dans les deux langues de la revue.
#
#   python3 test/typo-check.py              -> rapport ; sortie 0 si tout passe, 1 sinon
#   python3 test/typo-check.py --corriger   -> applique les corrections sûres
#   python3 test/typo-check.py --liste      -> les règles, sans rien lire
#
# Les règles ne sont pas inventées ici. Elles viennent de deux normes — le Guide du
# typographe (Groupe de Lausanne de l'AST) pour le français, le Duden et l'usage suisse
# alémanique pour l'allemand — et chacune a été confrontée aux 421 galleys DOCX réellement
# publiées sur ojs.szh.ch (2,4 M caractères en français, 6,1 M en allemand). docs/
# TYPOGRAPHIE.md donne le détail des mesures et tranche les deux points où la norme et
# l'usage maison divergeaient.
#
# Le fait dominant : français et allemand ont des règles OPPOSÉES sur l'espacement. Le
# français sépare la ponctuation haute et l'intérieur des guillemets par une insécable ;
# l'allemand suisse colle tout. Une règle appliquée aux deux langues est donc fausse pour
# l'une d'elles, et c'était le défaut de départ du programme.
#
# ⚠ Ce contrôle ne touche QUE les chaînes visibles. Les commentaires de code gardent
# l'apostrophe droite — c'est la convention du dépôt, délibérée — et les clés d'API (celles
# d'OJS en particulier) sont comparées octet pour octet à l'import : les retoucher casserait
# l'appariement. Voir la liste SURFACES pour ce qui est lu, et rien d'autre ne l'est.
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

# Les langues « collées » : allemand suisse et italien suivent la même mécanique
# d'espacement, opposée à celle du français.
COLLEES = ("de", "it")


# --------------------------------------------------------------------------- les règles
#
# Chaque règle sait se détecter et se corriger. `corriger` reçoit une valeur et rend la
# valeur corrigée ; quand elle vaut None, la règle signale sans réparer — c'est le cas des
# guillemets droits, qu'on ne peut pas apparier sans risque de casser une chaîne de code.

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


# A1 — apostrophe. L'élision seule : une apostrophe entre deux lettres. Celle qui ouvre ou
# ferme (l'anglais « '90s ») ne se devine pas et n'apparaît pas dans le corpus.
RE_ELISION = re.compile(r"([A-Za-zÀ-ÿ])'([A-Za-zÀ-ÿ])")


def _apostrophes(v):
    # Plusieurs passes : « l'enfant d'ici » a deux élisions qui se chevauchent par la
    # lettre qu'elles partagent, une seule passe n'en prend qu'une sur deux.
    for _ in range(4):
        neuf = RE_ELISION.sub(r"\1" + APO + r"\2", v)
        if neuf == v:
            break
        v = neuf
    return v


# E1/E2 — espacement. On ne fait que NORMALISER une espace déjà présente ; jamais en
# insérer une absente. Sans quoi « https://ror.org » et « 10:30 » deviendraient faux, et
# une chaîne allemande citant « Fehler: » se verrait couper en deux. Et une SUITE
# d'espaces est un alignement de colonne, pas de la ponctuation : « Detail   : {0} » se
# lit en face de « Schritt  : {0} », et la garde la laisse tranquille : elle bloque
# un espace PRÉCÉDÉ d'un espace, pas un fragment qui commence par une espace. Les
# messages des filtres Lua sont concaténés, et « »: keine » porte le sien en tête.
RE_FR_HAUTE = re.compile(r"(?<![ \t   ])[   ]([;:!?])")
RE_FR_GUILL_O = re.compile(r"«[   ]")
RE_FR_GUILL_F = re.compile(r"(?<![ \t   ])[   ]»")
RE_DE_HAUTE = re.compile(r"(?<![ \t   ])[    ]([;:!?])")
RE_DE_GUILL_O = re.compile(r"«[    ]")
RE_DE_GUILL_F = re.compile(r"(?<![ \t   ])[    ]»")
RE_POURCENT = re.compile(r"(?<=[0-9])[   ](%)(?![A-Za-z0-9%])")

# T1 — tiret d'incise. Le cadratin est proscrit dans les deux langues ; en français il est
# précédé d'une insécable, pour qu'il ne commence pas une ligne.
RE_INCISE_FR = re.compile(r"(?<![ \t   ])[   ](" + DEMI + r"|" + CAD + r")(?=[  ])")

# E4 — abréviations soudées par une insécable, des deux côtés de la Sarine.
ABREV_FR = [(re.compile(r"\bp\.[   ]?ex\."), "p." + NBSP + "ex.")]
ABREV_DE = [
    (re.compile(r"\bz\.[   ]?B\."), "z." + NBSP + "B."),
    (re.compile(r"\bd\.[   ]?h\."), "d." + NBSP + "h."),
    (re.compile(r"\bS\.[   ]?(?=\d)"), "S." + NBSP),
]

# S2 — ordinaux français. « 2ème » est fautif : la norme écrit « 2e ».
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

# Un code peut porter DEUX entrées — le français et les langues collées prescrivent
# l'inverse l'un de l'autre sur E1, E2 et T1 —, et c'est la langue qui les départage.
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
# reconstruit la ligne autour d'une valeur corrigée. Séparer ainsi le repérage de la
# réécriture évite la faute classique : toucher une clé au lieu de sa valeur.
#
# `remplacer` reçoit la ligne COURANTE et non celle d'origine, parce qu'une ligne porte
# parfois plusieurs fragments à corriger — « fr = '…', de = '…' » sur une seule ligne. Ils
# sont appliqués de droite à gauche par parcourir(), ce qui garde valides les décalages
# relevés à l'extraction.

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
            # PowerShell 5.1 traite ’ comme un délimiteur de chaîne au même titre que ' :
            # dans le fichier elle est doublée. On la déplie pour juger, on la redouble
            # pour écrire — sinon le script cesse de compiler.
            valeur = m.group(2).replace(APO + APO, APO)
            yield i, courante, valeur, (
                lambda v, _l, p=m.group(1), s=m.group(3):
                    p + v.replace(APO, APO + APO) + s)


def extraire_json(lignes, langue):
    for i, l in enumerate(lignes):
        m = RE_VAL_JSON.match(l)
        if m:
            yield i, langue, m.group(2), _refaire(m.group(1), m.group(3))


RE_LUA_OUVRE = re.compile(r"^(\s*)(fr|de|it|en)\s*=\s*\{\s*$")
RE_LUA_FERME = re.compile(r"^(\s*)\},?\s*$")
RE_LUA_COMMENT = re.compile(r"^\s*--")
RE_LITTERAL = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"")


def _est_prose(v):
    """Une chaîne de code n'a ni espace ni accent ; une phrase a l'un ou l'autre.

    Le tri compte : les filtres mêlent des phrases à des motifs Lua (« %s », « ... »,
    « %w+ ») et à des noms de classe. Les toucher casserait un gsub sans rien dire.
    """
    if not v:
        return False
    return " " in v or any(ord(c) > 127 for c in v)


def extraire_lua(lignes, _langue):
    """Les blocs de langue des filtres : tables plates ET fonctions de message.

    Les diagnostics de szh-maquette.lua ne sont pas des tables de chaînes mais des
    fonctions qui concatènent des fragments sur plusieurs lignes. Ne lire que la forme
    « fr = '…' » les laissait tous de côté — et ce sont exactement les phrases que la
    rédaction voit à chaque compilation. On suit donc l'indentation du bloc de langue et
    on prend tout littéral de prose qu'il contient, fragment par fragment.
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
            # dans un bloc de langue : tous les fragments de la ligne
            for m in RE_LITTERAL.finditer(l):
                v = m.group(1) if m.group(1) is not None else m.group(2)
                if _est_prose(v):
                    yield i, pile[-1][0], v, _remplacant_intervalle(
                        *(m.span(1) if m.group(1) is not None else m.span(2)))
            continue
        # hors bloc : la forme d'une ligne, « fr = '…', de = '…' »
        for m in RE_LUA_LANGUE.finditer(l):
            if _est_prose(m.group(2)):
                yield i, m.group(1), m.group(2), _remplacant_intervalle(*m.span(2))


# Les libellés bilingues du cockpit qui ne passent pas par i18n.js : les tâches
# éditoriales de lib/articles.js, les types d'article de lib/yaml.js. Même forme partout,
# « fr: '…', de: '…', it: '…' », et souvent plusieurs langues sur une ligne.
RE_JS_LANGUE = re.compile(r"\b(fr|de|it)\s*:\s*'((?:[^'\\]|\\.)*)'")


def extraire_js_bilingue(lignes, _langue):
    for i, l in enumerate(lignes):
        if l.lstrip().startswith("//"):
            continue
        for m in RE_JS_LANGUE.finditer(l):
            if _est_prose(m.group(2)):
                yield i, m.group(1), m.group(2), _remplacant_intervalle(*m.span(2))


def _remplacant_intervalle(debut, fin):
    """Recompose la ligne autour d'un seul fragment.

    Plusieurs langues cohabitent souvent sur la même ligne : remplacer par recherche de
    texte y écraserait la mauvaise. On tient les décalages.
    """
    return lambda v, ligne: ligne[:debut] + v + ligne[fin:]


RE_FENCE = re.compile(r"^\s*```")
RE_CODE_INLINE = re.compile(r"`[^`]*`")
JETON = ""


def extraire_texte(lignes, langue):
    """Markdown, YAML, texte brut : de la prose, hors blocs et segments de code.

    Les `segments entre accents graves` sont masqués par un jeton plutôt que découpés :
    découper coupe les mots à la frontière et « d'`articles-word` : » perdait à la fois son
    apostrophe et son insécable.
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


# Ce qui est lu, et rien d'autre. Chaque entrée : (chemin, extracteur, langue par défaut).
# La langue par défaut ne sert qu'aux surfaces monolingues ; les autres la portent dans
# leur structure.
SURFACES = [
    ("vscodium-extension/szh-cockpit/lib/i18n.js", extraire_js_i18n, None),
    ("vscodium-extension/szh-cockpit/package.nls.json", extraire_json, "fr"),
    ("vscodium-extension/szh-cockpit/package.nls.de.json", extraire_json, "de"),
    ("vscodium-extension/szh-cockpit/package.json", extraire_json, "fr"),
    ("windows/szh-common.ps1", extraire_ps, None),
    # Les deux jeux de libellés bilingues qui ne passent pas par i18n.js, parce qu'ils
    # sont des données du modèle et non des messages : les tâches éditoriales et les types
    # d'article. Ils s'affichent malgré tout dans les panneaux.
    ("vscodium-extension/szh-cockpit/lib/articles.js", extraire_js_bilingue, None),
    ("vscodium-extension/szh-cockpit/lib/yaml.js", extraire_js_bilingue, None),
    ("revue-template/BIENVENUE.md", extraire_texte, "fr"),
    ("revue-template/ausgabe.yaml", extraire_texte, "fr"),
    ("revue-template/articles-word/LISEZ-MOI.txt", extraire_texte, "fr"),
    ("userdoc.md", extraire_texte, "fr"),
    # La note qui pose les règles s'y tient elle-même : c'est le seul document de docs/
    # sous contrôle, les autres suivent la convention développeur du dépôt.
    ("docs/TYPOGRAPHIE.md", extraire_texte, "fr"),
    # Les deux notes de la rédaction : chacune est écrite dans sa langue et se compose
    # donc selon ses propres règles — c'est le meilleur exemple qu'elles puissent donner.
    ("docs/TYPOGRAPHIE-FR.md", extraire_texte, "fr"),
    ("docs/TYPOGRAPHIE-DE.md", extraire_texte, "de"),
]

# Les filtres Lua portent les libellés imprimés dans le PDF : licence, titres de rubrique,
# « Résumé »/« Zusammenfassung ». Ils sont ajoutés en bloc, chacun avec l'extracteur de
# tables bilingues.
for _nom in sorted(os.listdir(os.path.join(RACINE, "pipeline", "filters"))):
    if _nom.endswith(".lua"):
        SURFACES.append(("pipeline/filters/" + _nom, extraire_lua, None))

# L'anglais n'a pas de règle ici : il ne sert qu'au repli des raccourcis Windows, où seuls
# comptent les caractères ASCII.
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
        # De droite a gauche : les decalages releves a l'extraction restent valides.
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
