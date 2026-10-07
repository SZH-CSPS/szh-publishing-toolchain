"""Chargement et recherche des lexiques (ancrage, domaines, exclusions). Voir lexique/*.toml.

Comparaison sans casse ni accents, apostrophes ramenées à l'espace ; les sigles (cs = true)
gardent leur casse. Le plus long terme l'emporte quand deux termes se recouvrent.
"""
import os
import re
import tomllib
import unicodedata
from dataclasses import dataclass, field

LANGUES = ('fr', 'de', 'it')
RE_SOURCE = re.compile(r'^(cdph:art([1-9]|[12][0-9]|3[0-3])|termdat|lhand|lai|concordat|edudoc|corpus|manuel)$')
MODES = ('debut', 'mot', 'sous')
DOSSIER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lexique')


def normaliser(texte, casse=False):
    """Forme de comparaison. casse=True : on garde majuscules et accents (sigles)."""
    s = unicodedata.normalize('NFC', str(texte or ''))
    s = s.replace('’', "'").replace('ʼ', "'").replace("'", ' ').replace(' ', ' ')
    if casse:
        return re.sub(r'\s+', ' ', s)
    s = s.replace('ß', 'ss').replace('œ', 'oe').replace('Œ', 'oe').replace('æ', 'ae').lower()
    s = ''.join(c for c in unicodedata.normalize('NFD', s) if not unicodedata.combining(c))
    return re.sub(r'\s+', ' ', s)


FLEXION_ITALIENNE = {'a': '[ae]', 'o': '[oi]', 'e': '[ei]'}


def _dernier_mot(mot, langue, cs):
    """Dernier mot du motif. Italien : le pluriel change la voyelle finale (a→e, o→i, e→i)."""
    if langue == 'it' and not cs and len(mot) >= 4 and mot[-1] in FLEXION_ITALIENNE:
        return re.escape(mot[:-1]) + FLEXION_ITALIENNE[mot[-1]]
    return re.escape(mot)


def _motif(texte, mode, cs, langue=''):
    mots = normaliser(texte, casse=cs).split(' ')
    if cs:
        base = r'\s+'.join(re.escape(m) for m in mots)
    else:
        # Dans un terme à plusieurs mots, les mots intérieurs tolèrent pluriel, féminin et déclinaison
        # (« chiens d'assistance », « écoles spécialisées », « integrativen Schule ») ; le dernier suit le mode.
        interieurs = []
        for m in mots[:-1]:
            if langue == 'it' and len(m) >= 4 and m[-1] in 'aoe':
                interieurs.append(re.escape(m[:-1]) + '[aeio]')      # scuola → scuole, speciale → speciali
                continue
            racine = re.sub(r'e?[sx]?$', '', m) if len(m) >= 5 else m
            interieurs.append(re.escape(racine) + ('[a-z]{0,3}' if len(m) >= 4 else ''))
        base = r'\s+'.join(interieurs + [_dernier_mot(mots[-1], langue, cs)])
    classe = 'A-Za-z0-9' if cs else 'a-z0-9'
    avant = '' if mode == 'sous' else f'(?<![{classe}])'
    apres = f'(?![{classe}])' if mode == 'mot' else ''
    return re.compile(avant + base + apres)


@dataclass
class Terme:
    texte: str
    langue: str
    source: str
    mode: str = 'debut'
    cs: bool = False
    ambigu: bool = False
    contexte: str = ''
    concept: str = ''
    titre_seul: bool = False      # compte dans le titre, jamais dans le texte ni dans la recherche serveur
    motif: object = field(default=None, repr=False)

    def __post_init__(self):
        self.motif = _motif(self.texte, self.mode, self.cs, self.langue)


@dataclass
class Theme:
    id: str
    libelle: dict
    sources: list
    termes: list



@dataclass
class Domaine:
    id: str
    rang: int
    articles: list
    libelle: dict
    termes: list


@dataclass
class Touche:
    terme: Terme
    debut: int
    fin: int


class Lexique:
    def __init__(self, termes, contextes, domaines, neutralisation, abaisse, regierung, types_ecartes,
                 types_a_relire, ecole_generale=(), themes=()):
        self.themes = list(themes)                    # [Theme] : périmètre élargi, toujours « à relire »
        self.ecole_generale = list(ecole_generale)    # [Terme] : école ordinaire, palier facultatif
        self.termes = termes
        self.contextes = contextes                    # nom -> [Terme]
        self.domaines = sorted(domaines, key=lambda d: d.rang)
        self.neutralisation = neutralisation          # [motif compilé]
        self.abaisse = abaisse                        # [Terme]
        self.regierung = regierung                    # {'garder': [...], 'jeter': [...]} normalisés
        self.types_ecartes = types_ecartes            # {id: motif}
        self.types_a_relire = types_a_relire
        self.contexte_theme = []                      # [Terme] : mot d'enfance ou d'école exigé au titre d'un thème
        self.hors_extrait = set()                     # termes normalisés ignorés dans l'extrait de recherche
        self.sans_serveur = set()                 # {(texte normalisé, langue)} : pas de recherche serveur

    # -- recherche -------------------------------------------------------

    def _neutraliser(self, texte):
        out = texte
        for m in self.neutralisation:
            out = m.sub(lambda mo: ' ' * len(mo.group(0)), out)
        return out

    def _toucher(self, termes, brut, norm):
        """Touches des termes. Sigles (cs) cherchés dans `brut`, les autres dans `norm` ; le plus long
        d'abord, une touche qui en recouvre une déjà prise est ignorée (dans la même forme)."""
        sortie = []
        for cs, cible in ((True, brut), (False, norm)):
            touches = []
            for t in termes:
                if t.cs == cs:
                    touches += [Touche(t, m.start(), m.end()) for m in t.motif.finditer(cible)]
            touches.sort(key=lambda x: (-(x.fin - x.debut), x.debut))
            pris = []
            for x in touches:
                if any(x.debut < p.fin and p.debut < x.fin for p in pris):
                    continue
                pris.append(x)
            sortie += pris
        return sorted(sortie, key=lambda x: x.debut)

    def _formes(self, texte):
        """(texte à casse gardée pour les sigles, forme de comparaison)."""
        return normaliser(texte, casse=True), normaliser(texte)

    def ancrages(self, texte):
        """Touches d'ancrage dans `texte`, sans les passages neutralisés ni les termes à contexte absent."""
        brut, norm = self._formes(texte)
        norm = self._neutraliser(norm)
        touches = self._toucher(self.termes, brut, norm)
        contextes_presents = {}
        sortie = []
        for x in touches:
            c = x.terme.contexte
            if c:
                if c not in contextes_presents:
                    contextes_presents[c] = bool(self._toucher(self.contextes.get(c, []), brut, norm))
                if not contextes_presents[c]:
                    continue
            sortie.append(x)
        return sortie

    def themes_dans(self, texte):
        """[(Theme, [Touche])] des thématiques élargies touchées par `texte`."""
        brut, norm = self._formes(texte)
        sortie = []
        for th in self.themes:
            t = self._toucher(th.termes, norm, norm)
            if t:
                sortie.append((th, t))
        return sortie

    def contexte_theme_dans(self, texte):
        """Touches des mots d'enfance, de jeunesse ou d'école : condition pour qu'un thème soit accepté."""
        brut, norm = self._formes(texte)
        norm = self._neutraliser(norm)         # « Entschuldigung », « Schulden » ne sont pas un mot d'école
        return self._toucher(self.contexte_theme, norm, norm)

    def ecole_generale_dans(self, texte):
        brut, norm = self._formes(texte)
        return self._toucher(self.ecole_generale, norm, norm)

    def abaissements(self, texte):
        brut, norm = self._formes(texte)
        return self._toucher(self.abaisse, norm, norm)

    def compter_domaines(self, texte):
        """{id domaine: nombre de touches} dans `texte`."""
        brut, norm = self._formes(texte)
        res = {}
        for d in self.domaines:
            n = len(self._toucher(d.termes, norm, norm))
            if n:
                res[d.id] = n
        return res

    def type_regierung(self, type_name):
        """'garder' | 'jeter' | None pour un libellé cantonal de Regierungsgeschäft."""
        s = normaliser(type_name)
        for cle in ('jeter', 'garder'):
            for p in self.regierung[cle]:
                if s.startswith(p):
                    return cle
        return None


# -- chargement ---------------------------------------------------------------

def _termes_de(liste, langue, defauts, concept):
    sortie = []
    for e in liste or []:
        d = dict(defauts)
        d.update({'t': e} if isinstance(e, str) else e)
        sortie.append(Terme(texte=d['t'], langue=langue, source=d.get('s', 'manuel'),
                            mode=d.get('m', 'debut'), cs=bool(d.get('cs', False)),
                            ambigu=bool(d.get('ambigu', False)), contexte=d.get('contexte', ''),
                            concept=concept, titre_seul=bool(d.get('ts', False))))
    return sortie


def charger(dossier=DOSSIER):
    def lire(nom):
        with open(os.path.join(dossier, nom), 'rb') as f:
            return tomllib.load(f)

    a = lire('ancrage.toml')
    termes = []
    for c in a.get('concept', []):
        defauts = {k: c[k] for k in ('s', 'm', 'cs', 'ambigu', 'contexte', 'ts') if k in c}
        for lang in LANGUES:
            termes += _termes_de(c.get(lang), lang, defauts, c['id'])
    contextes = {}
    for nom, par_langue in a.get('contexte', {}).items():
        contextes[nom] = [t for lang in LANGUES for t in _termes_de(par_langue.get(lang), lang, {'s': 'manuel'}, nom)]

    d = lire('domaines.toml')
    domaines = []
    for e in d.get('domaine', []):
        t = []
        for lang in LANGUES:
            t += _termes_de(e.get(lang), lang, {'s': e.get('s', 'manuel')}, e['id'])
        domaines.append(Domaine(e['id'], e['rang'], e.get('articles', []),
                                {lang: e.get(f'{lang}_libelle', '') for lang in LANGUES}, t))

    x = lire('exclusions.toml')
    neutr = [_motif(t, 'sous', False) for lang in LANGUES for t in x.get('neutralisation', {}).get(lang, [])]
    neutr += [re.compile(p) for lang in LANGUES for p in x.get('neutralisation_regex', {}).get(lang, [])]
    abaisse = [t for lang in LANGUES
               for t in _termes_de(x.get('abaisse', {}).get(lang), lang, {'s': 'manuel'}, 'abaisse')]
    rg = x.get('regierungsgeschaeft', {})
    regierung = {k: [normaliser(v) for v in rg.get(k, [])] for k in ('garder', 'jeter')}
    lex = Lexique(termes, contextes, domaines, neutr, abaisse, regierung,
                   {int(k): v for k, v in x.get('types_ecartes', {}).items()},
                   {int(k): v for k, v in x.get('types_a_relire', {}).items()},
                   [t for lang in LANGUES for t in _termes_de(a.get('ecole_generale', {}).get(lang), lang,
                                                              {'s': 'manuel'}, 'ecole_generale')],
                   _charger_themes(dossier))
    # Termes gardés dans le lexique local mais pas envoyés à la recherche serveur (voir exclusions.toml)
    rs = x.get('recherche_serveur', {}).get('exclure', {})
    lex.contexte_theme = _charger_contexte_theme(dossier)
    lex.hors_extrait = {normaliser(t) for t in x.get('hors_extrait', {}).get('termes', [])}
    lex.sans_serveur = {(normaliser(t), lang) for lang in LANGUES for t in rs.get(lang, [])}
    return lex


def verifier_structure(lex):
    """Liste des défauts du lexique (vide = sain) : sources invalides, langues manquantes, doublons."""
    defauts = []
    for t in lex.termes:
        if not RE_SOURCE.match(t.source):
            defauts.append(f'source invalide « {t.source} » pour {t.texte!r} ({t.langue})')
        if t.mode not in MODES:
            defauts.append(f'mode invalide {t.mode!r} pour {t.texte!r}')
    concepts = {}
    for t in lex.termes:
        concepts.setdefault(t.concept, set()).add(t.langue)
    for c, langues in concepts.items():
        for lang in LANGUES:
            if lang not in langues:
                defauts.append(f'concept {c} : aucun terme {lang}')
    vus = {}
    for t in lex.termes:
        cle = (t.langue, t.mode, t.cs, normaliser(t.texte, casse=t.cs))
        if cle in vus and vus[cle] != t.concept:
            defauts.append(f'terme en double {t.texte!r} ({t.langue}) : {vus[cle]} et {t.concept}')
        vus[cle] = t.concept
    for d in lex.domaines:
        langues = {t.langue for t in d.termes}
        for lang in LANGUES:
            if lang not in langues:
                defauts.append(f'domaine {d.id} : aucun terme {lang}')
        for t in d.termes:
            if not RE_SOURCE.match(t.source):
                defauts.append(f'domaine {d.id} : source invalide {t.source!r}')
    return defauts


def _charger_contexte_theme(dossier):
    chemin = os.path.join(dossier, 'thematiques.toml')
    if not os.path.exists(chemin):
        return []
    with open(chemin, 'rb') as f:
        c = tomllib.load(f).get('contexte_theme', {})
    return [t for lang in LANGUES for t in _termes_de(c.get(lang), lang, {'s': 'manuel', 'm': 'sous'}, 'contexte_theme')]


def _charger_themes(dossier):
    chemin = os.path.join(dossier, 'thematiques.toml')
    if not os.path.exists(chemin):
        return []
    with open(chemin, 'rb') as f:
        brut = tomllib.load(f)
    themes = []
    for e in brut.get('theme', []):
        termes = [t for lang in LANGUES for t in _termes_de(e.get(lang), lang, {'s': 'manuel'}, e['id'])]
        themes.append(Theme(e['id'], {lang: e.get(f'{lang}_libelle', '') for lang in LANGUES}, list(e.get('sources', [])),
                            termes))
    return themes
