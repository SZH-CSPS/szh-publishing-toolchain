"""Détecteur de noms de personnes, indépendant des règles de coupe de `correspondances.sans_personnes` et sans liste de prénoms.

Il lit le texte tel qu'il sortira et cherche des séquences de deux ou trois mots capitalisés qui suivent (ou précèdent) un signal :
- Défaut (la ligne ne part pas) : un marqueur d'auteur ou de signataire juste avant (Unterzeichner, M., Mme, Frau, anstelle…).
- Doute, signal fort : un déclencheur explicite (fondée par, gegründet von, de feu, à la mémoire de, zu Ehren von, in memoria di…) ou
  une fonction (Stadtrat, conseiller, député…) avant la séquence, ou une fonction après (« X Y, ancien conseiller national ») ;
  la liste blanche est alors resserrée aux mots très fréquents, parce qu'un nom de famille peut être un mot commun (« Piazza »).
- Doute, signal faible : « de », « von », « da », « di », « du », « par » avant la séquence, hors liste blanche ; en allemand, qui
  capitalise tous ses noms, la séquence ne doit ni suivre un article ni contenir un mot composé.
Une paire de mots capitalisés sans signal n'est jamais signalée : les titres en sont pleins (organisations, projets, événements)."""
import collections
import re
import unicodedata

_TOK = r"(?:[A-ZÀ-ÖØ-Ý][A-Za-zÀ-ÖØ-öø-ÿ'’\-]+|[A-Z]\.)"
_PARTICULES = ('de', 'von', 'van', 'der', 'di', 'da', 'du', 'le', 'la')
_SEQ = re.compile(_TOK + r"(?:\s+(?:(?:de|von|van|der|di|da|du|le|la)\s+)?" + _TOK + r")+")
_MOT = re.compile(r"[A-Za-zÀ-ÖØ-öø-ÿ'’\-]+")
_FORT = re.compile(
    r"(?i:\b(?:firmatari\w*|signataires?|unterzeichne\w*|promoss[ao] da|déposée? par|eingereicht von|deposto da|presentat[ao] da|"
    r"ripres[ao] da|anstelle|Nachfolge|remplacement|succession|M\.|Mme|Monsieur|Madame|Herrn?|Frau)\s*:?\s*)$")
_DECLENCHEUR = re.compile(
    r"(?i:\b(?:fondat[ao] da|fondée? par|gegründet von|de feu|à la mémoire de|in memoria di|zu Ehren von|en hommage à|in omaggio a|"
    r"nome di|au nom de M\.?|in Erinnerung an|ehemaliger?|Hommage à|Hommage au|Nachruf auf|Gedenken an|en souvenir de)\s*:?\s*)$")
_FONCTIONS = (r"(?:Stadtrat|Stadträtin|Regierungsrat|Regierungsrätin|Gemeinderat|Gemeinderätin|Kantonsrat|Kantonsrätin|Nationalrat|"
              r"Nationalrätin|Ständerat|Ständerätin|Bundesrat|Bundesrätin|Landrat|Landrätin|Grossrat|Grossrätin|conseiller\w*|conseillère|"
              r"syndic|maire|député\w*|président|présidente|ministre|sindaco|consigliere|consigliera|deputat[oa]|presidente|direttore|"
              r"direttrice|directeur|directrice|professeur|professore|Prof\.|Dr\.|dott\.|ancien|ancienne|alt|ex)")
_FONCTION_AVANT = re.compile(rf"(?i:\b{_FONCTIONS}\s+(?:(?:national|nationale|fédéral|fédérale|cantonal|cantonale)\s+)?)$")
_FONCTION_APRES = re.compile(rf"^\s*,\s*(?i:{_FONCTIONS})\b")
# mots capitalisés qui suivent une indication de lieu : « in Winterthur », « commune de Crissier », « Kanton Zug »
_CONTEXTE_LIEU = re.compile(r"\b(?:in|nach|bei|en|ville de|commune de|canton de|comune di|città di|Gemeinde|Stadt|Kantons?|Cantone|Region)\s+"
                            r"(" + _TOK + r"(?:[ \-]" + _TOK + r"){0,2})")
_PREPOSITION = re.compile(r"(?i:\b(?:von|vom|de|du|da|di|par|d['’])\s*)$")
_MOTS_FORTS = {'unterzeichner', 'unterzeichnerin', 'erstunterzeichner', 'erstunterzeichnerin', 'mitunterzeichner', 'mitunterzeichnerin',
               'frau', 'herr', 'herrn', 'madame', 'monsieur', 'mme', 'signor', 'signora'}
_MOTS_FONCTION = {'stadtrat', 'stadträtin', 'regierungsrat', 'regierungsrätin', 'gemeinderat', 'gemeinderätin', 'kantonsrat', 'kantonsrätin',
                  'nationalrat', 'nationalrätin', 'ständerat', 'ständerätin', 'bundesrat', 'bundesrätin', 'landrat', 'landrätin',
                  'grossrat', 'grossrätin', 'staatsrat', 'landammann', 'professor', 'prof.'}
_ARTICLE_DE = re.compile(r"(?i:\b(?:der|die|das|den|dem|des|ein|eine|einer|einen|einem|im|am|zum|zur|vom|beim|ins|aufs|für|mit|und)\s*)$")
_SUFFIXE_NOM_DE = re.compile(
    r"(?i:(?:ung|ungen|keit|heit|schaft|ität|ismus|zentrum|platz|strasse|gesetz|dienst|wesen|stelle|amt|werk|modell|projekt|"
    r"konzept|bericht|system|angebot|programm|plan|raum|haus|schule|kasse|fonds|recht|beitrag|kredit|mittel|politik|logie|ie|ik|tum)"
    r"(?:e|en|er|es|s)?)$")
_SUFFIXE_NOM_FR_IT = re.compile(r"(?i:(?:tion|tions|ment|ments|age|ité|ités|eur|euse|ence|ance|zione|zioni|mento|menti|ità|ura|ure|eria))$")
_MOIS = {m.casefold() for m in (
    'janvier février mars avril mai juin juillet août septembre octobre novembre décembre januar februar märz april juni juli august '
    'september oktober november dezember gennaio febbraio marzo aprile maggio giugno luglio agosto settembre ottobre novembre dicembre').split()}
_STOP = {'der', 'die', 'das', 'und', 'von', 'für', 'mit', 'im', 'zur', 'zum', 'bei', 'auf', 'ist', 'wird', 'sind', 'nicht', 'den', 'dem', 'des'}
_STOP_FR = {'le', 'la', 'les', 'des', 'du', 'de', 'et', 'pour', 'dans', 'sur', 'une', 'un', 'est', 'que', 'qui', 'au', 'aux', 'en'}
_STOP_IT = {'il', 'la', 'le', 'gli', 'di', 'del', 'della', 'dei', 'e', 'per', 'con', 'una', 'un', 'che', 'nel', 'nella', 'sul', 'sulla', 'al', 'alla'}
SEUIL_DUR = 40            # documents : au-delà, un mot capitalisé est un lieu, une institution ou un nom commun, même après un déclencheur

Contexte = collections.namedtuple('Contexte', 'blanche dure lieux', defaults=(frozenset(),))


def _plat(s):
    return unicodedata.normalize('NFC', s).casefold()


def mots(texte):
    return _MOT.findall(texte or '')


def langue_probable(texte):
    """'de', 'fr' ou 'it' d'après les mots-outils ; 'de' par défaut (le cas le plus strict)."""
    m = [_plat(w) for w in mots(texte) if w[0].islower()]
    n = {'de': sum(w in _STOP for w in m), 'fr': sum(w in _STOP_FR for w in m), 'it': sum(w in _STOP_IT for w in m)}
    return max(n, key=lambda k: (n[k], k == 'de'))


def contexte_de(titres_bruts, nettoyer, seuil=15):
    """Listes blanches d'une base. `blanche` : mots fréquents (au moins `seuil` titres) ou vus en minuscules ; `dure` : au moins
    SEUIL_DUR titres. Calculées sur les titres déjà nettoyés (`nettoyer` : la coupe d'un titre)."""
    docs, bas = {}, set()
    for t in titres_bruts:
        if not t:
            continue
        vus = set()
        for m in mots(nettoyer(' '.join(t.split()))):
            k = _plat(m)
            if m[0].islower():
                bas.add(k)
            vus.add(k)
        for k in vus:
            docs[k] = docs.get(k, 0) + 1
    lieux = collections.Counter()
    for t in titres_bruts:
        for m in _CONTEXTE_LIEU.finditer(nettoyer(' '.join((t or '').split()))):
            for w in m.group(1).split():
                lieux[_plat(w)] += 1
    return Contexte({k for k, n in docs.items() if n >= seuil} | bas | _MOIS, {k for k, n in docs.items() if n >= SEUIL_DUR} | _MOIS,
                    frozenset(k for k, n in lieux.items() if n >= 2))


def _majuscules(texte):
    lettres = [c for c in texte if c.isalpha()]
    return bool(lettres) and sum(c.isupper() for c in lettres) / len(lettres) > 0.6


def _candidats(texte, blanche):
    """[(séquence, avant, après, début)] : deux ou trois mots capitalisés consécutifs hors `blanche`."""
    sortie = []
    for m in _SEQ.finditer(texte):
        pos, courant, morceaux, force_c, force_suivant = m.start(), [], [], None, None
        for w in m.group(0).split():
            i = texte.index(w, pos)
            pos = i + len(w)
            if w.lower() in _PARTICULES:
                if courant:
                    courant.append((w, i))
                continue
            if w.lower().rstrip('.') in _MOTS_FORTS:       # « Unterzeichner Prénom Nom » : le marqueur est dans la séquence
                morceaux.append((courant, force_c)); courant, force_c, force_suivant = [], None, 'fort'
                continue
            if w.lower() in _MOTS_FONCTION:                # « Stadtrat Prénom Nom »
                morceaux.append((courant, force_c)); courant, force_c, force_suivant = [], None, 'fonction'
                continue
            if _plat(w.rstrip('.')) not in blanche:
                if not courant:
                    force_c, force_suivant = force_suivant, None
                courant.append((w, i))
            else:
                morceaux.append((courant, force_c)); courant, force_c, force_suivant = [], None, None
        morceaux.append((courant, force_c))
        for mc, force_c in morceaux:
            while mc and mc[-1][0].lower() in _PARTICULES:
                mc = mc[:-1]
            # la suite entière, puis chaque suite qui suit une particule (« Ehren von Anna Dubois » : « Anna Dubois » après « von »)
            departs = [0] + [j + 1 for j, (w, _) in enumerate(mc) if w.lower() in _PARTICULES and j + 1 < len(mc)]
            for k, j in enumerate(departs):
                sous = mc[j:]
                if 2 <= sum(1 for w, _ in sous if w.lower() not in _PARTICULES) <= 3:
                    debut, fin = sous[0][1], sous[-1][1] + len(sous[-1][0])
                    sortie.append((texte[debut:fin], texte[max(0, debut - 40):debut], texte[fin:fin + 40], debut, force_c if k == 0 else None))
    return sortie


def _ressemble_a_un_nom(seq):
    """Allemand : pas de mot composé ni de suffixe de nom commun, mots courts."""
    for w in seq.split():
        if w.lower() in _PARTICULES or re.fullmatch(r"[A-Z]\.", w):
            continue
        if len(w) > 14 or _SUFFIXE_NOM_DE.search(w):
            return False
    return True


def analyser(textes, ctx):
    """(défauts, doutes) : séquences sans doublon, en clair (à masquer avant tout message)."""
    defauts, doutes = [], []

    def noter(liste, seq):
        if seq not in liste:
            liste.append(seq)

    for t in textes:
        if not t or _majuscules(t):
            continue
        langue = langue_probable(t)
        for seq, avant, apres, debut, force_c in _candidats(t, ctx.dure):          # signaux forts : liste blanche resserrée
            if force_c == 'fort' or _FORT.search(avant):
                noter(defauts, seq)
            elif force_c == 'fonction' or _DECLENCHEUR.search(avant) or _FONCTION_AVANT.search(avant) or _FONCTION_APRES.match(apres):
                if not re.search(r"(?<!van )\bder\b", seq):                  # « Regierungsrat der Komfort der … » : un groupe nominal
                    noter(doutes, seq)
        for seq, avant, apres, debut, force_c in _candidats(t, ctx.blanche):       # signal faible : préposition + liste blanche, avec les filtres de lieu, de sigle et d'allemand
            if force_c == 'fort' or _FORT.search(avant):
                noter(defauts, seq)
            elif _PREPOSITION.search(avant):
                mots_seq = [_plat(w) for w in re.split(r"[\s\-]+", seq) if w]
                if any(w in ctx.lieux for w in mots_seq) or re.match(r"[A-ZÀ-ÖØ-Ý]{2,}\b", seq):
                    continue                                                    # un lieu, ou un sigle (« HC Fribourg »)
                if re.search(r"(?<!van )\bder\b", seq):
                    continue                                                    # « Komfort der Velofahrer » : un groupe nominal, pas un nom
                if langue == 'de' and (not _ressemble_a_un_nom(seq) or _ARTICLE_DE.search(t[max(0, debut - 12):debut])):
                    continue
                if langue != 'de' and any(_SUFFIXE_NOM_FR_IT.search(w) for w in seq.split() if w.lower() not in _PARTICULES):
                    continue                                                    # « Épuration de Sierre » : un nom commun en tête
                noter(doutes, seq)
    return defauts, doutes


def masque(seq):
    """« Hans Keller » devient « H*** K*** » : jamais un nom en clair dans un message."""
    return ' '.join(w[0] + '***' if w[0].isupper() else w for w in seq.split())
