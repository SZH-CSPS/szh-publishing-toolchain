#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Modèle neutre du gabarit « Pronto — modèle d'article » et règles qui le lisent : styles
# maison (SZH Cle, SZH Aide), les deux tableaux fixes (métadonnées, autrices et auteurs),
# blocs figure et tableau, étendue de la bibliographie, puis écriture du meta.yaml et des
# instructions $SZH_META / $SZH_PHOTOS.
#
# Ce module ne lit pas le format OOXML ; il travaille sur trois classes :
#
#   Par(style, texte, niveau, images)   — un paragraphe. `style` est le nom du style, déjà
#                                          résolu par le lecteur (« SZH Cle », « heading 1 »,
#                                          « Quote »…). `texte` est déjà normalisé
#                                          (normaliser_valeur()). `niveau` vaut 1..6 pour un
#                                          titre, 0 sinon. `images` : liste de (nom de
#                                          fichier sous media/, surface déclarée, 0 si
#                                          inconnue).
#   Cellule(colspan, blocs)             — `blocs` : liste de Par | Tableau, dans l'ordre (une
#                                          cellule de bloc tableau contient un Tableau).
#   Tableau(rangees)                    — `rangees` : liste de listes de Cellule. Une cellule
#                                          masquée par une fusion n'y figure pas.
#
# Un document lu est une list[Par | Tableau], les blocs de premier niveau dans l'ordre :
# pronto_docx.lire() le produit, principal() le consomme.
#
# famille() teste le nom résolu sous deux formes, telle quelle et compactée sans espaces ni
# tirets, pour reconnaître aussi les formes d'identifiant (« titre1 », « berschrift2 ») des
# Word dont le nom affiché est trompeur. Un paragraphe sans style a pour nom '' (ou
# « Standard » après conversion LibreOffice) : famille() rend '' dans les deux cas.
#
# Bibliothèque standard seule : la WSL n'a pas PyYAML.

import difflib
import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun


# ---------------------------------------------------------------------------------
# Le modèle neutre.

class Par:
    """Un paragraphe (ou un titre). `style` est le nom déjà résolu par le lecteur,
    `texte` le texte déjà normalisé (normaliser_valeur()), `niveau` 1..6 pour un titre (0 sinon),
    `images` la liste (nom_fichier, surface) des images qu'il porte, dans l'ordre."""

    __slots__ = ('style', 'texte', 'niveau', 'images')

    def __init__(self, style='', texte='', niveau=0, images=None):
        self.style = style or ''
        self.texte = texte or ''
        self.niveau = niveau or 0
        self.images = images or []

    def __repr__(self):
        return 'Par(%r, %r, niveau=%r, images=%r)' % (self.style, self.texte, self.niveau,
                                                        self.images)


class Cellule:
    """Une cellule de tableau. `blocs` est une liste de Par | Tableau (imbrication comprise :
    un bloc tableau de contenu porte un Tableau parmi les blocs de sa cellule de rangée 1).
    `colspan` est le nombre de colonnes fusionnées (1 si aucune fusion)."""

    __slots__ = ('colspan', 'blocs')

    def __init__(self, colspan=1, blocs=None):
        self.colspan = colspan or 1
        self.blocs = blocs or []

    def __repr__(self):
        return 'Cellule(colspan=%r, blocs=%r)' % (self.colspan, self.blocs)


class Tableau:
    """Un tableau. `rangees` est une liste de listes de Cellule ; une cellule masquée par une
    fusion n'y figure pas.

    `page` : numéro de page du tableau dans le document source, ou None s'il est inconnu.
    pronto_docx.lire() le calcule d'après les marqueurs w:lastRenderedPageBreak que Word pose
    en repaginant ; un .docx jamais ouvert par Word (ou converti depuis un .odt) n'en a pas.
    Seuls les tableaux de premier niveau le portent."""

    __slots__ = ('rangees', 'page')

    def __init__(self, rangees=None, page=None):
        self.rangees = rangees or []
        self.page = page

    def __repr__(self):
        return 'Tableau(rangees=%r, page=%r)' % (self.rangees, self.page)


# ---------------------------------------------------------------------------------
# Jetons de type reconnus par le cockpit (TYPES_ARTICLE de lib/yaml.js).
TYPES_VALIDES = ('article', 'editorial', 'interview', 'varia', 'tribune-libre',
                 'documentation')
LANGUES_META = ('fr', 'de', 'it')          # ordre d'écriture du YAML (cockpit)


# Langue d'un article selon le produit du numéro : Revue → fr, Zeitschrift → de, comme
# derive_revue() de szh-maquette.lua. Accepte le jeton (« revue », « zeitschrift ») comme le
# nom complet. Un article italien se corrige après l'import, dans « Métadonnées des
# articles ».
def langue_du_produit(produit):
    """'fr' | 'de' | '' ; '' si le produit est inconnu (hors d'un numéro). L'appelant décide
    alors du repli et le signale."""
    v = (produit or '').strip().lower()
    if 'zeitschrift' in v:
        return 'de'
    if 'revue' in v:
        return 'fr'
    return ''
# Champs d'un auteur, alignés sur CHAMPS_AUTEUR de lib/yaml.js (cockpit), `ror` compris.
CHAMPS_AUTEUR = ('prenom', 'nom', 'fonction', 'affiliation', 'ror', 'orcid', 'email', 'photo')

# Les styles qui signent le gabarit, en minuscules (voir pronto_docx.est_pronto()).
STYLES_GABARIT = ('szh cle', 'szh aide')
# La propriété personnalisée qui marque les gabarits livrés, posée par
# outils-dev/marquer-gabarit.py ; Word et LibreOffice la gardent à l'enregistrement. Elle
# prime sur les styles. Le suffixe est la version du gabarit ; seul le préfixe est testé.
CLE_GABARIT_NOM = 'SZH-Gabarit'
CLE_GABARIT_VALEUR = 'pronto-article-4'
_CLE_GABARIT_PREFIXE = 'pronto-article'


def est_cle_gabarit(valeur):
    """Vrai si `valeur` (celle de la propriété SZH-Gabarit, ou None) désigne un gabarit Pronto."""
    return (valeur or '').strip().lower().startswith(_CLE_GABARIT_PREFIXE)


def est_gabarit(noms_styles, cle=None):
    """Reconnaissance du gabarit, pour l'import comme pour le nettoyeur : la propriété
    cachée, sinon la déclaration des deux styles de STYLES_GABARIT, comparés par
    normaliser_nom_style() (« SZH-Cle » vaut « SZH Cle »), comme dans _style_par()."""
    if est_cle_gabarit(cle):
        return True
    presents = {normaliser_nom_style(n) for n in noms_styles}
    return all(normaliser_nom_style(s) in presents for s in STYLES_GABARIT)


# Formats acceptés pour une photo d'auteur, comme EXTENSIONS_PHOTO du cockpit ; une image
# d'un autre format n'est pas appariée.
EXTENSIONS_PORTRAIT = ('png', 'jpg', 'jpeg', 'webp')


# ---------------------------------------------------------------------------------
# Texte.

def normaliser(t):
    """Forme de comparaison : tous les blancs Unicode (insécables comprises) réduits à une
    espace, tirets spéciaux -> '-', rognée. Sert à reconnaître une clé ou un style ; pour une
    valeur, voir normaliser_valeur()."""
    for a, b in (('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


_RE_BLANCS_ASCII = re.compile(r'[ \t\r\n\f\v]+')


def normaliser_valeur(t):
    """Forme de valeur (Par.texte) : seuls les blancs ASCII sont réduits à une espace. Les
    insécables, l'espace fine, les tirets et U+2011 restent tels quels : szh-typographie.lua
    en a besoin, et « 1990–2000 » passé au trait d'union ne se reconstruit pas. Rognée de
    tout blanc Unicode, pour qu'un paragraphe fait d'une seule insécable reste vide."""
    return _RE_BLANCS_ASCII.sub(' ', t or '').strip()


def aplatir(t):
    """Minuscules, accents repliés, tout ce qui n'est pas [a-z0-9] retiré. Sur les mots du
    lexique — tous ASCII — donne le même résultat que plat() de szh-citations.lua."""
    return ''.join(c for c in unicodedata.normalize('NFD', t.lower())
                   if c.isalnum() and ord(c) < 128)


def cle_comparaison(t):
    """Clé qui apparie un paragraphe du document source au bloc que pandoc en fera : les
    quarante premiers caractères [A-Za-z0-9]. Le texte entier ne convient pas : pandoc et ce
    lecteur diffèrent sur le tiret insécable, la police Symbole, le tiret conditionnel ou un
    hyperlien sans cible. szh-biblio-detacher.lua calcule la même clé."""
    return re.sub(r'[^A-Za-z0-9]', '', t)[:40]


def slugifier_portrait(prenom, nom):
    """Nom de base d'un fichier de portrait, identique à slugifier() de
    vscodium-extension/szh-cockpit/lib/slug.js, qui recalcule ces noms."""
    return szh_commun.slugifier(prenom + '-' + nom)


def citer(v):
    return '"' + re.sub(r'([\\"])', r'\\\1', str(v)) + '"'


# ---------------------------------------------------------------------------------
# Classement d'un nom de style résolu en famille : title, subtitle, author, abstract, biblio,
# caption, heading, ou rien (voir l'en-tête).

NOMS_PANDOC_META = {'title', 'subtitle', 'author', 'abstract', 'date'}

# Niveaux 1 à 6, la borne de szh-niveaux.lua, qui range le corps entre <h2> et <h6>.
RE_NIVEAU_TITRE = re.compile(r'^(?:heading|titre|titolo|berschrift)\s*([1-6])\b', re.I)


def famille(nom_style):
    """Classe le nom de style résolu d'un paragraphe. `n` : le nom en minuscules ; `ns` : le
    même compacté (sans espaces ni tirets), pour les formes d'identifiant (« titre1 »,
    « berschrift2 »)."""
    if not nom_style:
        return ''
    n = normaliser(nom_style).lower()
    ns = re.sub(r'[\s\-]+', '', n)
    if n == 'title' or ns in ('titel', 'titre', 'title', 'titolo'):
        return 'title'
    if n == 'subtitle' or ns in ('untertitel', 'soustitre', 'subtitle', 'sottotitolo'):
        return 'subtitle'
    if n == 'author' or ns in ('author', 'auteur', 'autor'):
        return 'author'
    if n == 'abstract' or ns == 'abstract':
        return 'abstract'
    # « EndNoteBibliography » : le style que pose le module EndNote sur la liste qu'il génère.
    if n == 'bibliography' or ns.startswith('literaturverzeichnis') \
            or ns in ('bibliographie', 'bibliografia', 'bibliography', 'endnotebibliography'):
        return 'biblio'
    if 'beschriftung' in ns or n == 'caption' or 'beschriftung' in n \
            or 'légende' in n or 'legende' in n:
        return 'caption'
    if re.match(r'^heading\s*\d', n) or re.match(r'^(berschrift|heading|titre|titolo)\d', ns):
        return 'heading'
    return ''


def pandoc_mange(nom_style):
    """Vrai si pandoc range ce style en métadonnées (bloc absent du corps). Appelé nulle
    part dans ce module."""
    return (nom_style or '').strip().lower() in NOMS_PANDOC_META


def niveau_depuis_style(nom_style):
    """Niveau de titre 1..6 déduit du nom de style résolu, 0 sinon."""
    m = RE_NIVEAU_TITRE.match(normaliser(nom_style or ''))
    return int(m.group(1)) if m else 0


# ---------------------------------------------------------------------------------
# Styles maison du gabarit (« SZH Cle », « SZH Aide »…), reconnus par leur nom résolu.

def normaliser_nom_style(nom):
    """Nom de style prêt à comparer : minuscules, sans espaces ni tirets. « SZH Cle »,
    « szhcle » et « SZH-Cle » donnent la même clé ; la ponctuation (les parenthèses de
    « SZH Question (interview) ») reste."""
    return re.sub(r'[\s\-]+', '', (nom or '').lower())


NOM_STYLE_CLE = normaliser_nom_style('SZH Cle')
NOM_STYLE_AIDE = normaliser_nom_style('SZH Aide')
# Les métadonnées d'un bloc figure ou tableau sont des paragraphes de ce style, juste avant
# l'image ou le tableau (_extraire_blocs_nouvelle_forme()). L'ancienne forme, un tableau
# enveloppe, est encore lue en repli (n_blocs_meta(), extraire_bloc()).
NOM_STYLE_CLE_BLOC = normaliser_nom_style('SZH Cle Abb/Tab')


def _style_par(par):
    return normaliser_nom_style(par.style)


def _est_cle_bloc(bloc):
    """Vrai pour un paragraphe SZH Cle Abb/Tab, pas pour un SZH Cle ordinaire (qui ne forme
    un bloc que dans un tableau enveloppe)."""
    return isinstance(bloc, Par) and _style_par(bloc) == NOM_STYLE_CLE_BLOC


# ---------------------------------------------------------------------------------
# Avertissements : même format et même préfixe que docx-meta.py, pour que journal.js (cockpit)
# n'ait qu'un format à reconnaître.

PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# ---------------------------------------------------------------------------------
# Bibliographie : reconnaissance et étendue à détacher, avec la même clé de comparaison et
# les mêmes bornes que docx-meta.py, puisque szh-biblio-detacher.lua relit les deux.

def lire_titres_bib():
    """Le lexique des titres de bibliographie, lu dans szh-citations.lua, qui le tient pour
    toute la chaîne (voir aussi lib/citations.js). Filtre illisible : lexique vide, aucun
    titre reconnu, et l'étendue commence au premier paragraphe stylé (on détache moins,
    jamais à côté)."""
    chemin = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                          'filters', 'szh-citations.lua')
    try:
        with open(chemin, encoding='utf-8') as f:
            src = f.read()
    except Exception:
        return set()
    i = src.find('local TITRES_BIB = {')
    j = src.find('\n}', i) if i != -1 else -1
    if j == -1:
        return set()
    return {m for m in re.findall(r"'([a-z]+)'", src[i:j])}


# Compléments tolérés devant un titre de bibliographie aplati : une numérotation
# (« 5. Références »), retirée par expression régulière, et « Liste des », retiré par
# préfixe. Le gabarit n'a pas de style de bibliographie : la reconnaissance repose sur le
# seul titre, tel que les auteurs l'écrivent.
RE_NUM_TITRE_BIBLIO = re.compile(r'^\d+')
PREFIXES_TITRE_BIBLIO = ('listedes', 'listede', 'liste')

# Un complément entre parenthèses ou crochets en FIN de titre (« Literatur (gemäss
# Redaktionsrichtlinien) », « Références [sélection] »). Sert au nettoyeur de manuscrit ; la
# compilation garde la comparaison exacte de szh-citations.lua.
RE_COMPLEMENT_TITRE_BIBLIO = re.compile(r'\s*[(\[][^()\[\]]*[)\]]\s*$')


def sans_complement_titre(texte):
    return RE_COMPLEMENT_TITRE_BIBLIO.sub('', texte or '')


def titre_est_biblio(texte, lexique, tolerer_complement=False):
    """Ce titre se reconnaît-il comme celui d'une bibliographie ? Comparé au même lexique que
    szh-citations.lua (lire_titres_bib()), sur le texte aplati (accents et casse
    indifférents, ponctuation et espaces déjà retirés par aplatir()) — après avoir retiré une
    numérotation de tête et, le cas échéant, un complément « Liste des » devant.
    `tolerer_complement` retire d'abord un complément final entre parenthèses ou crochets :
    le nettoyeur, qui lit des titres d'autrices, le demande ; l'import, non."""
    if tolerer_complement:
        texte = sans_complement_titre(texte)
    plat = RE_NUM_TITRE_BIBLIO.sub('', aplatir(texte))
    if plat in lexique:
        return True
    for prefixe in PREFIXES_TITRE_BIBLIO:
        if plat.startswith(prefixe) and plat[len(prefixe):] in lexique:
            return True
    return False


def etendue_biblio(blocs, type_article, slug):
    """(lignes B, ligne BT, stats) — les clés des paragraphes à détacher, celle du titre à
    retirer, et de quoi rendre compte. `blocs` : list[Par | Tableau], les blocs de premier
    niveau du document, dans l'ordre.

    Le gabarit n'a pas de style de bibliographie : la bibliographie se reconnaît à son
    titre. C'est le dernier titre, de n'importe quel niveau, dont le texte aplati figure
    dans le lexique de lire_titres_bib() ; le dernier, car un « Literatur » plus haut peut
    être une revue de littérature. Tout ce qui suit est la bibliographie, un paragraphe par
    entrée, jusqu'à la fin du document ou jusqu'à un tableau, qui l'arrête avec un
    avertissement.

    Une documentation est laissée entière : sa liste est son contenu."""
    stats = {'voie': 'aucune', 'paragraphes': 0, 'titre': False}
    if type_article == 'documentation':
        stats['voie'] = 'documentation'
        return [], '', stats

    lexique = lire_titres_bib()
    titre = None
    for i, e in enumerate(blocs):
        # Tous les niveaux de titre : c'est le lexique qui décide, pas le niveau.
        if not isinstance(e, Par) or not e.texte or not e.niveau:
            continue
        if titre_est_biblio(e.texte, lexique):
            titre = i
    if titre is None:
        return [], '', stats

    lignes = []
    tableau_interrompu = False
    for i in range(titre + 1, len(blocs)):
        e = blocs[i]
        if isinstance(e, Tableau):
            tableau_interrompu = True
            avertir(
                'biblio-tableau-apres-titre',
                ['article « %s »' % slug, 'titre « %s »' % blocs[titre].texte],
                'Un tableau a été trouvé dans la bibliographie de cet article, après son '
                'titre («\u00a0%s\u00a0»)\u00a0: ce n’est pas normal, la bibliographie ne s’étend donc '
                'que jusqu’à ce tableau. Ce qui le suit n’a pas été examiné\u00a0; vérifiez la '
                'liste des références détachée.' % blocs[titre].texte,
                'In der Bibliografie dieses Artikels wurde nach ihrem Titel («%s») eine '
                'Tabelle gefunden: das ist ungewöhnlich, das Literaturverzeichnis reicht '
                'daher nur bis zu dieser Tabelle. Was danach folgt, wurde nicht geprüft; '
                'prüfen Sie die ausgelagerte Literaturliste.' % blocs[titre].texte)
            break
        if not isinstance(e, Par) or not e.texte:
            continue
        lignes.append(cle_comparaison(e.texte))

    stats.update({'voie': 'titre', 'paragraphes': len(lignes), 'titre': True,
                  'tableau_interrompu': tableau_interrompu})
    bt = cle_comparaison(blocs[titre].texte)
    return lignes, bt, stats


# ---------------------------------------------------------------------------------
# Étiquettes du gabarit, reconnues par un score de proximité (voir « Clés tolérantes »
# ci-dessous) et non par leur forme aplatie : aplatir() retire les accents, et « Resumé »
# passerait sans avertissement.

RE_SUFFIXE_LANGUE = re.compile(r'\s*\((fr|de|it)\)\s*$', re.I)

VALEURS_TYPE = {
    aplatir('dossier thématique'): 'article',
    aplatir('éditorial'): 'editorial',
    aplatir('edito'): 'editorial',
    aplatir('entretien'): 'interview',
    aplatir('varia'): 'varia',
    aplatir('tribune libre'): 'tribune-libre',
    # Gabarit allemand (« Themenschwerpunkt – Editorial – Interview – Varia – Tribune
    # Libre ») : les autres valeurs sont déjà des jetons canoniques.
    aplatir('themenschwerpunkt'): 'article',
}
VALEURS_TYPE_CANONIQUES = {aplatir(t): t for t in TYPES_VALIDES}


# ---------------------------------------------------------------------------------
# Clés tolérantes : une étiquette mal tapée (accent oublié, espace, variante, casse,
# deux-points, pluriel) est reconnue par un score de proximité contre les clés de
# CANON_METADONNEES, CANON_AUTEUR et CANON_FIGURE, avec un avertissement dès qu'il a fallu
# tolérer (voir identifier_cle()). Seule l'étiquette est comparée, jamais la valeur.

# Seuil mesuré sur 75 étiquettes (vraies, fautes de frappe plausibles, étiquettes qui
# doivent rester inconnues) : aucune ne tombe sur une mauvaise clé, et les étrangères
# plafonnent à 0,667. Le test « une étiquette étrangère au gabarit reste sous le seuil, avec
# de la marge » (test/js/pronto-lire.test.js) tient cette marge.
# Une forme sans accent (« Resume » : 0,667) reste sous le seuil : on la rattrape par un
# alias dans les tables CANON_*, pas en baissant le seuil, qui perdrait sa marge. De même,
# une étiquette étrangère trop proche d'une clé (« Adresse » contre `email`) se déclare comme
# clé sans destination (CLES_AUTEUR_SANS_DESTINATION).
SEUIL_CLE = 0.75
ECART_CLE = 0.08
LONGUEUR_ETIQUETTE_SCORE = 40  # au-delà, c'est une valeur, pas une étiquette : pas de score


def normaliser_cle(texte):
    """Étiquette prête à comparer : en NFC, minuscules, sans espaces ni ponctuation de
    séparation, pluriel final toléré. Les accents restent : c'est leur écart que le score
    mesure. La recomposition NFC évite qu'un « Légende » en NFD (Mac, copier-coller) soit
    pris pour une approximation."""
    t = unicodedata.normalize('NFC', normaliser(texte or '')).lower()
    t = re.sub(r"[\s:./_'’-]+", '', t)
    if len(t) > 1 and t.endswith('s'):
        t = t[:-1]
    return t


def _score_forme(candidat_norm, forme_brute):
    """1.0 si `forme_brute`, une fois normalisée, est identique à `candidat_norm` ; sinon le
    ratio de difflib.SequenceMatcher entre les deux formes normalisées."""
    forme_norm = normaliser_cle(forme_brute)
    if forme_norm == candidat_norm:
        return 1.0
    return difflib.SequenceMatcher(None, candidat_norm, forme_norm, autojunk=False).ratio()


def _sans_fioritures(t):
    """Forme pour le test d'exactitude seulement (pas pour le score) : espaces
    uniformisées, apostrophe courbe assimilée à la droite (la correction automatique les
    alterne ; le gabarit écrit « d’article »), casse ignorée."""
    return unicodedata.normalize('NFC', normaliser(t or '')).replace('’', "'").casefold()


def identifier_cle(etiquette, table):
    """Résout `etiquette` (sans suffixe de langue) contre `table`, un dict jeton -> (forme du
    gabarit français, forme du gabarit allemand, alias…). Rend :
      - None si `etiquette` est vide, plus longue que LONGUEUR_ETIQUETTE_SCORE, ou si aucune
        clé n'atteint SEUIL_CLE ;
      - ('__ambigu__', jeton1, jeton2, score1, score2) si les deux meilleures clés sont à
        moins de ECART_CLE l'une de l'autre ;
      - (jeton, score, exact) sinon. `exact` n'est vrai que si `etiquette` est l'une des deux
        formes du gabarit (espaces et casse ignorées) : un alias, même reconnu à 1,0
        (« E-mail » pour Email), avertit."""
    etiquette = (etiquette or '').strip()
    if not etiquette or len(etiquette) > LONGUEUR_ETIQUETTE_SCORE:
        return None
    candidat_norm = normaliser_cle(etiquette)
    scores = sorted(
        ((max(_score_forme(candidat_norm, forme) for forme in formes), jeton)
         for jeton, formes in table.items()),
        key=lambda p: p[0], reverse=True)
    meilleur_score, meilleur_jeton = scores[0]
    if meilleur_score < SEUIL_CLE:
        return None
    if len(scores) > 1 and (meilleur_score - scores[1][0]) < ECART_CLE:
        return ('__ambigu__', meilleur_jeton, scores[1][1], meilleur_score, scores[1][0])
    formes_exactes = list(table[meilleur_jeton][:2])
    if table is CANON_FIGURE:
        formes_exactes += FORMES_EXACTES_ANCIENNES.get(meilleur_jeton, ())
    exact = any(_sans_fioritures(etiquette) == _sans_fioritures(forme)
                for forme in formes_exactes)
    return (meilleur_jeton, meilleur_score, exact)


def _avertir_cle_approximee(brute, table, jeton, score, slug, lieu):
    canonique = table[jeton][0]
    avertir(
        'cle-approximee',
        ['article « %s »' % slug, 'lieu « %s »' % lieu, 'clé « %s »' % brute,
         'reconnue « %s »' % canonique, 'proximite %.2f' % score],
        'Clé «\u00a0%s\u00a0» lue comme «\u00a0%s\u00a0» (proximité %.2f). Corrigez l’étiquette dans le document '
        'si ce n’était pas voulu.' % (brute, canonique, score),
        'Schlüssel «%s» als «%s» gelesen (Ähnlichkeit %.2f). Korrigieren Sie die '
        'Bezeichnung im Dokument, falls das nicht beabsichtigt war.' % (brute, canonique, score))


def _avertir_cle_ambigue(brute, table, jeton1, jeton2, slug, lieu):
    c1, c2 = table[jeton1][0], table[jeton2][0]
    avertir(
        'cle-ambigue',
        ['article « %s »' % slug, 'lieu « %s »' % lieu, 'clé « %s »' % brute],
        'La clé «\u00a0%s\u00a0» est ambiguë\u00a0: elle ressemble presque autant à «\u00a0%s\u00a0» qu’à «\u00a0%s\u00a0». '
        'Aucune des deux n’a été retenue, et l’article n’a PAS été importé\u00a0: rien n’a été '
        'créé, et le fichier Word reste en attente. Réécrivez l’étiquette exactement comme '
        'dans le gabarit, puis enregistrez.' % (brute, c1, c2),
        'Der Schlüssel «%s» ist mehrdeutig: er ähnelt «%s» fast ebenso stark wie «%s». '
        'Keiner von beiden wurde übernommen, und der Artikel wurde NICHT importiert: es wurde '
        'nichts angelegt, und die Word-Datei bleibt in der Warteschlange. Schreiben Sie die '
        'Bezeichnung genau wie in der Vorlage und speichern Sie.' % (brute, c1, c2))


def resoudre_cle(etiquette, table, slug, lieu, bloquants=None):
    """identifier_cle() et ses avertissements : rend le jeton reconnu, ou None pour une clé
    inconnue ou ambiguë.

    Les appelants ne l'appellent que pour une valeur non vide (une clé vide compte comme
    absente). Une clé inconnue ou ambiguë a donc un contenu qu'on ne sait où ranger : si
    `bloquants` (list) est fourni, une entrée {'texte', 'lieu'} y est ajoutée, ce qui fait
    échouer l'import (voir principal() et GRAVITE_CODES)."""
    resultat = identifier_cle(etiquette, table)
    if resultat is None:
        if bloquants is not None:
            bloquants.append({'texte': etiquette, 'lieu': lieu})
        return None
    if resultat[0] == '__ambigu__':
        _, jeton1, jeton2, _, _ = resultat
        _avertir_cle_ambigue(etiquette, table, jeton1, jeton2, slug, lieu)
        if bloquants is not None:
            bloquants.append({'texte': etiquette, 'lieu': lieu})
        return None
    jeton, score, exact = resultat
    if not exact:
        _avertir_cle_approximee(etiquette, table, jeton, score, slug, lieu)
    return jeton


# ---------------------------------------------------------------------------------
# Gravité des codes émis par ce lecteur ; pronto-lire.py s'en sert pour faire échouer
# l'import. Le cockpit a sa propre table (TONS_IMPORT de lib/journal.js).
#
# GRAVITE_BLOQUANT : une clé remplie n'a pu être rangée nulle part, et son contenu serait
# perdu. principal() n'écrit alors ni meta.yaml ni instructions, et pronto-lire.py sort en
# échec (stats['bloquant'], stats['cles_non_reconnues'], alimentées par resoudre_cle() et
# par extraire_table_metadonnees() pour une clé reconnue mais sans destination).
# GRAVITE_INFO : une clé attendue est absente ou vide.
# GRAVITE_AVERT : le reste, dont « cle-approximee ».
GRAVITE_BLOQUANT = 'bloquant'
GRAVITE_INFO = 'info'
GRAVITE_AVERT = 'avert'

GRAVITE_CODES = {
    'etiquette-metadonnees-inconnue': GRAVITE_BLOQUANT,
    'auteur-etiquette-inconnue': GRAVITE_BLOQUANT,
    'auteur-champ-hors-gabarit': GRAVITE_BLOQUANT,
    'metadonnees-champ-hors-gabarit': GRAVITE_BLOQUANT,
    'bloc-etiquette-inconnue': GRAVITE_BLOQUANT,
    'cle-ambigue': GRAVITE_BLOQUANT,
    'cle-attendue-absente': GRAVITE_INFO,
    'cle-approximee': GRAVITE_AVERT,
}


def _avertir_cle_attendue_absente(canonique, slug, lieu, canonique_de=None):
    # `clé-de` : le nom du champ dans le gabarit allemand, pour le message en allemand.
    canonique_de = canonique_de or canonique
    avertir(
        'cle-attendue-absente',
        ['article « %s »' % slug, 'lieu « %s »' % lieu, 'clé « %s »' % canonique,
         'clé-de « %s »' % canonique_de],
        'Le champ «\u00a0%s\u00a0» attendu par le gabarit n’a pas été trouvé, ou a été laissé vide\u00a0: '
        'rien n’est perdu, mais rien n’a été rempli non plus.' % canonique,
        'Das von der Vorlage erwartete Feld «%s» wurde nicht gefunden oder leer gelassen: '
        'es geht nichts verloren, aber es wurde auch nichts ausgefüllt.' % canonique_de)


def _avertir_cles_attendues_absentes(table, jetons_attendus, cles_vues, slug, lieu):
    """Une info `cle-attendue-absente` par clé de `jetons_attendus` absente de `cles_vues`.
    Les appelants n'ajoutent pas à `cles_vues` une clé laissée vide."""
    for jeton in jetons_attendus:
        if jeton not in cles_vues:
            _avertir_cle_attendue_absente(table[jeton][0], slug, lieu, table[jeton][1])


# Ni motscles ni langue, qui ne sont pas des champs du gabarit (voir CANON_METADONNEES).
CLES_METADONNEES_ATTENDUES = ('type', 'titre', 'soustitre', 'resume')


CANON_METADONNEES = {
    # Position 0 : forme du gabarit français ; position 1 : forme du gabarit allemand ; puis
    # des alias, reconnus au score maximum. Une clé remplie mais non reconnue refuse
    # l'import : les alias évitent ces faux négatifs. Ils couvrent les formes sans accent
    # (« resume », « prenom »), les synonymes tapés par réflexe (« Copyright », « Droits »,
    # « Description », « Poste »…) et l'italien. Un alias avertit toujours (cle-approximee).
    # Pas d'alias « rubrique » : une rubrique n'est pas un type d'article (voir
    # szh-rubrique.lua).
    'type': ("Type d'article", 'Artikeltyp', 'type', 'tipo di articolo'),
    # Champ des anciens gabarits. Sa valeur est ignorée (la langue vient du produit, voir
    # langue_du_produit()) ; sa clé reste reconnue pour ne pas bloquer l'import, avec un
    # avertissement (voir extraire_table_metadonnees()).
    'langue': ("Langue de l'article", 'Sprache', 'langue', 'language'),
    'titre': ('Titre', 'Titel', 'title', 'titolo', 'titre de l\'article'),
    'soustitre': ('Sous-titre', 'Untertitel', 'sous titre', 'soustitre', 'subtitle',
                  'sottotitolo'),
    'resume': ('Résumé', 'Zusammenfassung', 'resume', 'abstract', 'riassunto',
               'résumé de l\'article'),
    # Le gabarit n'a pas de champ « Mots-clés » : ils se choisissent dans le cockpit (voir
    # serialiser_meta()). La clé reste reconnue, parce qu'elle est souvent tapée par
    # réflexe : elle lève 'metadonnees-champ-hors-gabarit' (bloquant), qui dit où vont les
    # mots-clés.
    'motscles': ('Mots-clés', 'Schlüsselwörter', 'mots cles', 'mots clefs', 'keywords',
                 'schlagworter', 'schlusselworter', 'schlagwörter'),
}

CANON_AUTEUR = {
    'prenom': ('Prénom', 'Vorname', 'prenom', 'first name', 'firstname', 'nome'),
    'nom': ('Nom', 'Name', 'nachname', 'last name', 'lastname', 'surname',
            'nom de famille', 'familienname', 'cognome'),
    'fonction': ('Fonction', 'Funktion', 'position', 'poste', 'rôle', 'role', 'funzione',
                 'titre et fonction'),
    'affiliation': ('Institution', 'Institution', 'affiliation', 'institution / organisation',
                    'organisation', 'établissement', 'etablissement', 'einrichtung',
                    'istituzione'),
    'ror': ('ROR', 'ROR', 'ror id', 'identifiant ror'),
    'orcid': ('ORCID', 'ORCID', 'orcid id', 'identifiant orcid'),
    # Pas d'alias « adresse mail » : « Adresse » (postale) passerait sur `email`.
    'email': ('Email', 'E-Mail', 'courriel', 'mail', 'adresse e-mail', 'e-mail-adresse'),
    # ── Champs absents du gabarit, déclarés exprès ──────────────────────────────────────
    # Comme « Mots-clés » : des clés souvent tapées, reconnues pour ne pas être confondues
    # avec un vrai champ (« Adresse » est proche de `email`), mais sans destination. Elles
    # refusent l'import avec un message qui dit quoi faire (voir
    # CLES_AUTEUR_SANS_DESTINATION et _avertir_champ_hors_gabarit()).
    'adresse': ('Adresse', 'Anschrift', 'adresse postale'),
    'biographie': ('Biographie', 'Kurzbiografie', 'notice biographique', 'bio'),
    'telephone': ('Téléphone', 'Telefon', 'telephone', 'tél', 'tel'),
    'photo': ('Photo', 'Porträt', 'portrait', 'foto', 'bild'),
}

# Les clés de CANON_AUTEUR sans champ de destination, listées explicitement.
CLES_AUTEUR_SANS_DESTINATION = ('adresse', 'biographie', 'telephone', 'photo')

# Ce qu'il faut faire, par champ absent du gabarit. La photo a sa place dans le document :
# la cellule de gauche.
GESTE_HORS_GABARIT = {
    'photo': ("La photo se dépose dans la cellule de gauche de cette rangée, pas dans une "
              "clé.",
              'Das Foto gehört in die linke Zelle dieser Zeile, nicht in einen Schlüssel.'),
    'adresse': ("Le gabarit ne porte pas d'adresse : retirez cette ligne du document.",
                'Die Vorlage sieht keine Adresse vor: entfernen Sie diese Zeile aus dem '
                'Dokument.'),
    'biographie': ("Le gabarit ne porte pas de notice biographique : retirez cette ligne du "
                   "document. Une notice en prose libre reste dans le corps de l'article.",
                   'Die Vorlage sieht keine Kurzbiografie vor: entfernen Sie diese Zeile aus '
                   'dem Dokument. Eine Biografie in Fließtext bleibt im Artikeltext.'),
    'telephone': ("Le gabarit ne porte pas de téléphone : retirez cette ligne du document.",
                  'Die Vorlage sieht keine Telefonnummer vor: entfernen Sie diese Zeile aus '
                  'dem Dokument.'),
}

CANON_FIGURE = {
    'legende': ('Légende', 'Beschriftung', 'legende', 'caption', 'bildunterschrift',
                'abbildung', 'légende de la figure', 'didascalia'),
    'alt': ('Texte alternatif', 'Alternativtext', 'texte alternatif', 'alt', 'alt text',
            'description', 'texte de remplacement', 'testo alternativo'),
    # Le gabarit écrit « Copyright » ; « Crédit », forme des anciens gabarits, est reconnu
    # sans avertissement (FORMES_EXACTES_ANCIENNES).
    'credit': ('Copyright', 'Copyright', 'Crédit', 'credit', 'crédit photo', 'credit photo',
               'photo credit', 'droits', 'bildnachweis', 'credito'),
    'source': ('Source', 'Quelle', 'provenance', 'fonte'),
    # La note imprimée sous la figure ou le tableau. Facultative : son absence n'est pas
    # signalée (voir CLES_BLOC_ATTENDUES).
    'note': ('Note', 'Notiz', 'notes', 'anmerkung', 'hinweis', 'remarque', 'nota'),
}

# Formes des anciens gabarits, reconnues comme exactes (sans avertissement). jeton -> formes.
FORMES_EXACTES_ANCIENNES = {'credit': ('Crédit',)}

# Les clés de bloc dont l'absence se signale (cle-attendue-absente) : toutes sauf la note.
CLES_BLOC_ATTENDUES = tuple(k for k in CANON_FIGURE if k != 'note')


# ---------------------------------------------------------------------------------
# Tableau 1 — métadonnées de l'article.

def _etiquette_szh_cle(cellule):
    """Texte des paragraphes SZH Cle d'une cellule (Par directs), joints par une espace ; il
    n'y en a normalement qu'un.

    Seul le style SZH Cle compte : les deux premiers tableaux sont pris par leur position,
    et un tableau de données ordinaire placé en tête ne doit pas voir sa première colonne
    lue comme des étiquettes, qui bloqueraient l'import."""
    morceaux = []
    for b in cellule.blocs:
        if not isinstance(b, Par):
            continue
        if _style_par(b) != NOM_STYLE_CLE:
            continue
        if b.texte:
            morceaux.append(b.texte)
    return ' '.join(morceaux)


def _valeur_cellule(cellule):
    """Texte de tous les paragraphes non vides d'une cellule, joints par un espace — un
    résumé peut occuper plusieurs paragraphes."""
    morceaux = []
    for b in cellule.blocs:
        if not isinstance(b, Par):
            continue
        if b.texte:
            morceaux.append(b.texte)
    return ' '.join(morceaux)


def extraire_table_metadonnees(tableau, slug, bloquants=None):
    """(valeurs, consommee). `valeurs` = {'type', 'titre', 'soustitre', 'resume'}
    (les trois derniers : dict langue -> texte). `bloquants` (list), s'il est fourni, reçoit
    {'texte', 'lieu'} pour chaque clé remplie non reconnue ou sans destination (voir
    resoudre_cle() et principal())."""
    valeurs = {'type': '', 'titre': {}, 'soustitre': {}, 'resume': {}}
    consommee = True
    cles_vues = set()
    for i, rangee in enumerate(tableau.rangees):
        if i == 0:
            continue                      # en-tête « Champ » / « Valeur », sautée
        if len(rangee) != 2:
            consommee = False
            continue
        etiquette = _etiquette_szh_cle(rangee[0])
        if not etiquette:
            continue                      # rangée vide (vestige de mise en forme)
        valeur = _valeur_cellule(rangee[1])
        m = RE_SUFFIXE_LANGUE.search(etiquette)
        base = RE_SUFFIXE_LANGUE.sub('', etiquette).strip()
        langue_champ = m.group(1).lower() if m else None
        if not valeur.strip():
            continue                      # clé présente mais vide : traitée comme absente
        jeton = resoudre_cle(base, CANON_METADONNEES, slug, 'tableau metadonnees', bloquants)

        if jeton == 'type':
            cles_vues.add('type')
            jeton_type = (VALEURS_TYPE.get(aplatir(valeur))
                          or VALEURS_TYPE_CANONIQUES.get(aplatir(valeur)))
            if jeton_type:
                valeurs['type'] = jeton_type
            else:
                avertir(
                    'type-article-non-reconnu',
                    ['article « %s »' % slug, 'valeur « %s »' % valeur],
                    "Le champ «\u00a0Type d’article\u00a0» du tableau des métadonnées porte une "
                    'valeur que le gabarit ne reconnaît pas\u00a0: «\u00a0%s\u00a0». Le type n’a pas '
                    'été rempli dans la fiche\u00a0; choisissez-le dans «\u00a0Métadonnées des '
                    'articles\u00a0».' % valeur,
                    'Das Feld «Type d\'article» der Metadatentabelle enthält einen von '
                    'der Vorlage nicht erkannten Wert: «%s». Der Typ wurde in den '
                    'Metadaten nicht gesetzt; wählen Sie ihn unter «Metadaten der '
                    'Artikel».' % valeur)
        elif jeton == 'langue':
            # Champ des anciens gabarits, ignoré : la langue vient du produit du numéro. On
            # le signale, sans quoi un article italien sortirait en français sans que
            # personne le sache.
            cles_vues.add('langue')
            avertir(
                'langue-du-document-ignoree',
                ['article « %s »' % slug, 'valeur « %s »' % valeur],
                'Le tableau des métadonnées de cet article porte encore un champ «\u00a0Langue '
                'de l’article\u00a0» («\u00a0%s\u00a0»)\u00a0: il n’est plus lu. La langue vient désormais de '
                'la revue du numéro\u00a0– Revue en français, Zeitschrift en allemand. Si cet '
                'article est dans une autre langue, corrigez-la dans «\u00a0Métadonnées des '
                'articles\u00a0»\u00a0; vous pouvez retirer ce champ du document.' % valeur,
                'Die Metadatentabelle dieses Artikels enthält noch ein Feld «Langue de '
                'l\'article» («%s»): es wird nicht mehr gelesen. Die Sprache ergibt sich '
                'jetzt aus der Zeitschrift der Ausgabe – Revue auf Französisch, Zeitschrift '
                'auf Deutsch. Ist dieser Artikel in einer anderen Sprache, korrigieren Sie '
                'sie unter «Metadaten der Artikel»; das Feld können Sie aus dem Dokument '
                'entfernen.' % valeur)
        elif jeton == 'titre' and langue_champ:
            cles_vues.add('titre')
            valeurs['titre'][langue_champ] = valeur
        elif jeton == 'soustitre' and langue_champ:
            cles_vues.add('soustitre')
            valeurs['soustitre'][langue_champ] = valeur
        elif jeton == 'resume' and langue_champ:
            cles_vues.add('resume')
            valeurs['resume'][langue_champ] = valeur
        elif jeton == 'motscles':
            # Reconnue mais sans case dans le gabarit : le message dit où vont les mots-clés.
            consommee = False
            _avertir_motscles_hors_gabarit(etiquette, valeur, slug)
            if bloquants is not None:
                bloquants.append({'texte': etiquette, 'lieu': 'tableau metadonnees'})
        else:
            consommee = False
            avertir(
                'etiquette-metadonnees-inconnue',
                ['article « %s »' % slug, 'etiquette « %s »' % etiquette,
                 'valeur « %s »' % valeur],
                'Le tableau des métadonnées de cet article porte une étiquette que le '
                'gabarit ne connaît pas\u00a0: «\u00a0%s\u00a0» (valeur\u00a0: «\u00a0%s\u00a0»). L’article n’a PAS '
                'été importé, pour ne pas perdre cette valeur\u00a0: rien n’a été créé, et le '
                'fichier Word reste en attente. Corrigez l’étiquette dans le document, '
                'puis enregistrez.' % (etiquette, valeur),
                'Die Metadatentabelle dieses Artikels enthält eine der Vorlage '
                'unbekannte Bezeichnung: «%s» (Wert: «%s»). Der Artikel wurde NICHT '
                'importiert, damit dieser Wert nicht verloren geht: es wurde nichts '
                'angelegt, und die Word-Datei bleibt in der Warteschlange. Korrigieren Sie '
                'die Bezeichnung im Dokument und speichern Sie.' % (etiquette, valeur))
            if jeton is not None and bloquants is not None:
                # Clé reconnue sans branche (titre, sous-titre ou résumé sans suffixe de
                # langue) : resoudre_cle() ne l'a pas mise dans bloquants, on le fait ici.
                bloquants.append({'texte': etiquette, 'lieu': 'tableau metadonnees'})
    _avertir_cles_attendues_absentes(CANON_METADONNEES, CLES_METADONNEES_ATTENDUES, cles_vues,
                                      slug, 'tableau metadonnees')
    return valeurs, consommee


# ---------------------------------------------------------------------------------
# Tableau 2 — autrices et auteurs.

def images_de_cellule(cellule):
    """[(nom, surface)] de toutes les images de la cellule, tableaux imbriqués compris, dans
    l'ordre du document."""
    trouvees = []
    for b in cellule.blocs:
        if isinstance(b, Par):
            trouvees.extend(b.images)
        elif isinstance(b, Tableau):
            for rangee in b.rangees:
                for c in rangee:
                    trouvees.extend(images_de_cellule(c))
    return trouvees


def a_image_cellule(cellule):
    return bool(images_de_cellule(cellule))


def photo_de_cellule(cellule):
    """Nom du fichier de la photo d'une cellule : la plus grande image déclarée."""
    trouvees = images_de_cellule(cellule)
    if not trouvees:
        return None
    return max(trouvees, key=lambda t: t[1])[0]


def _photo_appariee(nom_image, prenom, nom, bases_vues, fichiers_vus, slug):
    """(chemin `photo` pour la fiche, base du nom de portrait) — chemin '' si l'extension
    n'est pas acceptée ou si le fichier/la base est déjà pris."""
    ext = os.path.splitext(nom_image)[1].lstrip('.').lower()
    base = slugifier_portrait(prenom, nom)
    if ext not in EXTENSIONS_PORTRAIT or base in bases_vues or nom_image in fichiers_vus:
        return '', base
    bases_vues.add(base)
    fichiers_vus.add(nom_image)
    return 'portraits/%s.original.%s' % (base, ext), base


# L'en-tête de la colonne des fiches, dans les deux gabarits. « Autor:in » (gabarit
# allemand) serait sinon lu comme la clé « Autor » de valeur « in ».
ENTETES_TABLE_AUTEURS = frozenset(_sans_fioritures(t) for t in (
    'Autrice ou auteur', 'Autor:in', 'Autorin oder Autor', 'Autor/in', 'Autorin/Autor'))


def extraire_table_auteurs(tableau, slug, bloquants=None):
    """(auteurs, consommee, photos_connues, photos_appariees). `bloquants` (list), s'il est
    fourni, reçoit une entrée par clé remplie non reconnue (voir resoudre_cle())."""
    auteurs = []
    consommee = True
    photos_connues = set()
    photos_appariees = []
    bases_vues = set()
    fichiers_vus = set()
    for rangee in tableau.rangees:
        if len(rangee) != 2:
            consommee = False
            continue
        tc_photo, tc_champs = rangee
        champs = {}
        ligne_ok = True
        lignes_inconnues = []
        cles_vues = set()
        for p in tc_champs.blocs:
            if not isinstance(p, Par):
                continue
            # Seul le style SZH Cle porte « Étiquette : valeur » (même raison que dans
            # _etiquette_szh_cle()).
            if _style_par(p) != NOM_STYLE_CLE:
                continue
            texte = p.texte
            if not texte:
                continue
            if _sans_fioritures(texte) in ENTETES_TABLE_AUTEURS:
                continue                  # en-tête de colonne : « Autor:in » n'est pas une clé
            if ':' not in texte:
                ligne_ok = False
                lignes_inconnues.append(texte)
                continue
            etiquette, _, valeur = texte.partition(':')
            etiquette = etiquette.strip()
            valeur = valeur.strip()
            if not valeur:
                continue                  # clé présente mais vide : traitée comme absente
            champ = resoudre_cle(etiquette, CANON_AUTEUR, slug, 'auteur', bloquants)
            if champ is None:
                ligne_ok = False
                lignes_inconnues.append(texte)
                continue
            if champ in CLES_AUTEUR_SANS_DESTINATION:
                # Champ reconnu mais absent du gabarit (adresse, biographie, téléphone ; la
                # photo va dans la cellule de gauche). Bloquant, car sa valeur serait perdue,
                # avec un message qui dit quoi faire.
                ligne_ok = False
                _avertir_champ_hors_gabarit(champ, etiquette, valeur, slug)
                if bloquants is not None:
                    bloquants.append({'texte': etiquette, 'lieu': 'auteur'})
                continue
            champs[champ] = valeur
            cles_vues.add(champ)

        nom_image = None
        if a_image_cellule(tc_photo):
            photos_connues.update(n for n, _ in images_de_cellule(tc_photo))
            nom_image = photo_de_cellule(tc_photo)

        if not champs and not nom_image:
            continue                      # rangée-modèle non remplie : aucun auteur

        if not ligne_ok:
            consommee = False
        # Seules les lignes non reconnues lèvent « étiquette inconnue » ; un champ hors
        # gabarit a déjà son propre message.
        if lignes_inconnues:
            avertir(
                'auteur-etiquette-inconnue',
                ['article « %s »' % slug] + ['ligne « %s »' % t for t in lignes_inconnues],
                'Le tableau des autrices et auteurs porte une ligne que le gabarit ne '
                'reconnaît pas (%s). L’article n’a PAS été importé, pour ne pas perdre '
                'ce que cette ligne contient\u00a0: rien n’a été créé, et le fichier Word reste '
                'en attente. Corrigez l’étiquette dans le document, puis enregistrez.'
                % ' ; '.join('« %s »' % t for t in lignes_inconnues),
                'Die Tabelle der Autorinnen und Autoren enthält eine von der Vorlage nicht '
                'erkannte Zeile (%s). Der Artikel wurde NICHT importiert, damit ihr Inhalt '
                'nicht verloren geht: es wurde nichts angelegt, und die Word-Datei bleibt in '
                'der Warteschlange. Korrigieren Sie die Bezeichnung im Dokument und speichern '
                'Sie.' % ' ; '.join('« %s »' % t for t in lignes_inconnues))

        auteur = {c: champs.get(c, '') for c in ('prenom', 'nom', 'fonction', 'affiliation',
                                                  'ror', 'orcid', 'email')}
        auteur['photo'] = ''
        if nom_image:
            chemin_photo, base = _photo_appariee(nom_image, auteur['prenom'], auteur['nom'],
                                                  bases_vues, fichiers_vus, slug)
            if chemin_photo:
                auteur['photo'] = chemin_photo
                photos_appariees.append((base, nom_image))
        lieu_auteur = 'auteur %d (%s %s)' % (len(auteurs) + 1, auteur['prenom'] or '?',
                                              auteur['nom'] or '?')
        _avertir_cles_attendues_absentes(CANON_AUTEUR, CANON_AUTEUR.keys(), cles_vues, slug,
                                          lieu_auteur)
        auteurs.append(auteur)
    return auteurs, consommee, photos_connues, photos_appariees


# ---------------------------------------------------------------------------------
# Blocs figure et tableau de contenu.

def _premiere_etiquette_szh_cle(cellules):
    """Étiquette (avant le premier deux-points) du premier paragraphe SZH Cle non vide,
    cherché dans l'ordre des cellules puis des paragraphes de chacune — ou None."""
    for tc in cellules:
        for p in tc.blocs:
            if not isinstance(p, Par):
                continue
            if _style_par(p) != NOM_STYLE_CLE:
                continue
            if p.texte:
                return p.texte.partition(':')[0]
    return None


def n_blocs_meta(tableau):
    """Nombre de blocs figure ou tableau (ancienne forme, tableau enveloppe) que ce tableau
    empile ; 0 s'il n'en est pas un.

    Le cas normal est 2 rangées (métadonnées, contenu). Deux enveloppes copiées sans
    paragraphe entre elles sont fusionnées par LibreOffice en un seul tableau de 2×N
    rangées. Un tableau de 2×N rangées dont chaque rangée paire porte « Légende » en
    première étiquette SZH Cle compte donc pour N blocs, de toute nature.

    Un nombre impair de rangées n'est pas un bloc : le tableau reste tel quel dans le
    corps."""
    rangees = tableau.rangees
    n = len(rangees)
    if n < 2 or n % 2 != 0:
        return 0
    for i in range(0, n, 2):
        row_meta, row_contenu = rangees[i], rangees[i + 1]
        if not row_meta or not row_contenu:
            return 0
        etiquette = _premiere_etiquette_szh_cle(row_meta)
        if etiquette is None or not _ressemble_a_legende(etiquette):
            return 0
    return n // 2


def _ressemble_a_legende(etiquette):
    """Vrai si `etiquette` se reconnaît comme « Légende », même approximativement. N'avertit
    pas : _champs_bloc_meta() relit ce paragraphe et avertit, s'il le faut."""
    resultat = identifier_cle(etiquette, CANON_FIGURE)
    return bool(resultat) and resultat[0] == 'legende'


def est_bloc_meta(tableau):
    """Vrai si le tableau porte au moins un bloc (voir n_blocs_meta()). principal() pose une
    ligne T par tableau Word, pas par bloc."""
    return n_blocs_meta(tableau) > 0


# ---------------------------------------------------------------------------------
# Garde-fou : un tableau qui porte les étiquettes d'un bloc sans en avoir la forme
# (n_blocs_meta() == 0) serait imprimé tel quel, sa légende et son texte alternatif ignorés.
# Causes : une rangée ajoutée, une rangée de métadonnées décalée ou sans rangée de contenu,
# des blocs collés puis retouchés. On le signale.

def _premier_par_etiquette_bloc(tableau):
    """Le premier paragraphe SZH Cle du tableau dont l'étiquette (le texte avant le premier
    deux-points) est l'une des clés de bloc, ou None. Seuls les Par directs des cellules
    sont lus."""
    for rangee in tableau.rangees:
        for cellule in rangee:
            for p in cellule.blocs:
                if not isinstance(p, Par):
                    continue
                if _style_par(p) != NOM_STYLE_CLE:
                    continue
                if not p.texte or ':' not in p.texte:
                    continue
                etiquette = p.texte.partition(':')[0].strip()
                resultat = identifier_cle(etiquette, CANON_FIGURE)
                if resultat and resultat[0] != '__ambigu__':
                    return p
    return None


def ressemble_a_un_bloc(tableau):
    """Vrai si le tableau porte un paragraphe SZH Cle dont l'étiquette est une clé de bloc
    (Légende, Texte alternatif, Copyright, Source, Note).

    Le test porte sur l'étiquette d'un paragraphe SZH Cle, pas sur un mot présent
    n'importe où : un tableau de contenu peut avoir une colonne « Légende » sans être un
    bloc."""
    return _premier_par_etiquette_bloc(tableau) is not None


LONGUEUR_ETIQUETTE_AVERT = 60


def _tronquer_etiquette(texte):
    """« Légende : Répartition des élèves », à coller dans la recherche de Word pour trouver
    le tableau, tronqué à LONGUEUR_ETIQUETTE_AVERT caractères."""
    t = (texte or '').strip()
    return t if len(t) <= LONGUEUR_ETIQUETTE_AVERT else t[:LONGUEUR_ETIQUETTE_AVERT].rstrip() + '…'


def _repere_bloc_mal_forme(page, rang, etiquette):
    """(fr, de) : la phrase du garde-fou. Sans page connue, elle commence par le rang ; sans
    étiquette, la parenthèse ne s'ouvre que pour la page. Les quatre combinaisons donnent
    une phrase sans « page None » ni parenthèse vide."""
    rang_fr = '1er' if rang == 1 else '%dᵉ' % rang
    rang_de = '%d.' % rang
    if page:
        tete_fr = 'Le tableau de la page %d (%s tableau' % (page, rang_fr)
        tete_de = 'Die Tabelle auf Seite %d (die %s Tabelle' % (page, rang_de)
    else:
        tete_fr = 'Le %s tableau' % rang_fr
        tete_de = 'Die %s Tabelle' % rang_de
    if etiquette:
        if page:
            tete_fr += ', « %s »)' % etiquette
            tete_de += ', „%s“)' % etiquette
        else:
            tete_fr += ' (« %s »)' % etiquette
            tete_de += ' („%s“)' % etiquette
    elif page:
        tete_fr += ')'
        tete_de += ')'
    fr = (tete_fr + " porte les étiquettes d’une figure ou d’un tableau, mais pas la forme "
          "attendue\u00a0: ses légendes et textes alternatifs n’ont pas été lus. Vérifiez ce "
          "tableau dans le document, puis réimportez l’article.")
    de = (tete_de + ' trägt die Kennungen eines Abbildungs- oder Tabellenblocks, aber nicht '
          'in der erwarteten Form: ihre Legenden und Alternativtexte wurden nicht gelesen. '
          'Prüfen Sie diese Tabelle im Dokument und importieren Sie den Artikel neu.')
    return fr, de


def _avertir_bloc_mal_forme(tableau, rang, slug):
    """Émet `bloc-mal-forme` pour `tableau` (ressemble_a_un_bloc() vrai, n_blocs_meta()
    nul). `rang` : son rang, à partir de 1, parmi les tableaux de premier niveau, comme pour
    « blocs-colles »."""
    par = _premier_par_etiquette_bloc(tableau)
    etiquette = _tronquer_etiquette(par.texte) if par else ''
    fr, de = _repere_bloc_mal_forme(tableau.page, rang, etiquette)
    champs = ['article « %s »' % slug, 'tableau %d' % rang]
    if tableau.page:
        champs.append('page %d' % tableau.page)
    if etiquette:
        champs.append('etiquette « %s »' % etiquette)
    avertir('bloc-mal-forme', champs, fr, de)


# Côté cockpit, `bloc-mal-forme` a sa ligne de TABLE (lib/constats.js), sa clé CLES_IMPORT
# (lib/journal.js) et une modale après l'import (lib/import-hote.js).


def _avertir_champ_hors_gabarit(champ, etiquette, valeur, slug):
    """Un champ reconnu mais absent du gabarit (voir CLES_AUTEUR_SANS_DESTINATION).
    Bloquant, car sa valeur serait perdue ; le message dit que le gabarit n'a pas ce champ."""
    geste_fr, geste_de = GESTE_HORS_GABARIT.get(
        champ, ("Retirez cette ligne du document.",
                'Entfernen Sie diese Zeile aus dem Dokument.'))
    avertir(
        'auteur-champ-hors-gabarit',
        ['article « %s »' % slug, 'champ « %s »' % etiquette, 'valeur « %s »' % valeur],
        'Le tableau des autrices et auteurs porte un champ «\u00a0%s\u00a0» («\u00a0%s\u00a0»)\u00a0: le gabarit n’en '
        'a pas. L’article n’a PAS été importé, pour ne pas perdre cette valeur\u00a0– rien n’a '
        'été créé, et le fichier Word reste en attente. %s'
        % (etiquette, valeur, geste_fr),
        'Die Tabelle der Autorinnen und Autoren enthält ein Feld «%s» («%s»), das die '
        'Vorlage nicht kennt. Der Artikel wurde NICHT importiert, damit dieser Wert nicht '
        'verloren geht – es wurde nichts angelegt, und die Word-Datei bleibt in der '
        'Warteschlange. %s' % (etiquette, valeur, geste_de))


def _avertir_motscles_hors_gabarit(etiquette, valeur, slug):
    """Une ligne « Mots-clés » dans le tableau des métadonnées. Bloquant, comme une étiquette
    inconnue (sa valeur serait perdue), mais le message dit où vont les mots-clés."""
    avertir(
        'metadonnees-champ-hors-gabarit',
        ['article « %s »' % slug, 'champ « %s »' % etiquette, 'valeur « %s »' % valeur],
        'Le tableau des métadonnées porte une ligne « %s » (« %s ») : le gabarit '
        'n’en a pas, les mots-clés se choisissent dans le cockpit. L’article n’a PAS été '
        'importé, pour ne pas perdre cette valeur – rien n’a été créé, et le fichier Word '
        'reste en attente. Retirez cette ligne du document et enregistrez, puis reportez les '
        'mots-clés dans « Métadonnées des articles ».' % (etiquette, valeur),
        'Die Metadatentabelle enthält eine Zeile «%s» («%s»), die die Vorlage nicht hat: '
        'Schlüsselwörter werden im Cockpit gewählt. Der Artikel wurde NICHT importiert, damit '
        'dieser Wert nicht verloren geht – es wurde nichts angelegt, und die Word-Datei bleibt '
        'in der Warteschlange. Entfernen Sie diese Zeile aus dem Dokument und speichern Sie, '
        'dann tragen Sie die Schlüsselwörter unter «Metadaten der Artikel» ein.'
        % (etiquette, valeur))


def _avertir_etiquette_bloc_inconnue(etiquette, valeur, slug):
    """Même code et même message pour les deux formes de bloc (_champs_bloc_meta et
    _champs_bloc_meta_paragraphes), comme le vérifie le test différentiel."""
    avertir(
        'bloc-etiquette-inconnue',
        ['article « %s »' % slug, 'etiquette « %s »' % etiquette, 'valeur « %s »' % valeur],
        'Un bloc figure ou tableau de cet article porte une étiquette que le gabarit ne '
        'connaît pas\u00a0: «\u00a0%s\u00a0» (valeur\u00a0: «\u00a0%s\u00a0»). L’article n’a PAS été importé\u00a0: rien n’a '
        'été créé, et le fichier Word reste en attente. Les cinq étiquettes attendues sont '
        '«\u00a0Légende\u00a0:\u00a0», «\u00a0Texte alternatif\u00a0:\u00a0», «\u00a0Copyright\u00a0:\u00a0», «\u00a0Source\u00a0:\u00a0» et «\u00a0Note\u00a0:\u00a0».'
        % (etiquette, valeur),
        'Ein Abbildungs- oder Tabellenblock dieses Artikels enthält eine der Vorlage '
        'unbekannte Bezeichnung: «%s» (Wert: «%s»). Der Artikel wurde NICHT importiert: es '
        'wurde nichts angelegt, und die Word-Datei bleibt in der Warteschlange. Erwartet '
        'werden die fünf Bezeichnungen «Légende:», «Texte alternatif:», «Copyright:», '
        '«Source:» und «Note:».' % (etiquette, valeur))


def _decouper_champ_bloc(texte):
    """(etiquette, valeur) d'un paragraphe « Étiquette : valeur », coupé au premier ':' ;
    None sans ':'. L'appelant reconnaît l'étiquette et avertit."""
    if not texte or ':' not in texte:
        return None
    etiquette, _, valeur = texte.partition(':')
    return etiquette.strip(), valeur.strip()


def _champs_bloc_meta(row0, slug, bloquants=None):
    """(champs, consommee, cles_vues) : les champs du bloc lus sur toutes les cellules de la
    rangée 0, dans l'ordre. Ancienne forme (tableau enveloppe) ; voir
    _champs_bloc_meta_paragraphes() pour la nouvelle."""
    champs = {}
    consommee = True
    cles_vues = set()
    for tc in row0:
        for p in tc.blocs:
            if not isinstance(p, Par):
                continue
            # Seul SZH Cle porte « Étiquette : valeur » (voir _etiquette_szh_cle()).
            if _style_par(p) != NOM_STYLE_CLE:
                continue
            lu = _decouper_champ_bloc(p.texte)
            if lu is None:
                if p.texte:
                    consommee = False
                continue
            etiquette, valeur = lu
            if not valeur:
                continue               # clé présente mais vide : traitée comme absente
            champ = resoudre_cle(etiquette, CANON_FIGURE, slug, 'bloc', bloquants)
            if champ is None:
                consommee = False
                _avertir_etiquette_bloc_inconnue(etiquette, valeur, slug)
                continue
            champs[champ] = valeur
            cles_vues.add(champ)
    return champs, consommee, cles_vues


def _champs_bloc_meta_paragraphes(paragraphes, slug, bloquants=None):
    """(champs, consommee, cles_vues, textes_pris) : même lecture que _champs_bloc_meta(),
    sur des paragraphes SZH Cle Abb/Tab consécutifs (nouvelle forme).

    `textes_pris` : les paragraphes dont l'étiquette est reconnue, seuls à pouvoir être
    retirés du corps (ils suivent les lignes FI/FG/FT, et szh-legendes.lua les retire en
    posant les champs, voir principal()). Un paragraphe laissé vide (« Copyright : » seul)
    en fait partie, sinon il s'imprimerait. Un paragraphe à l'étiquette inconnue reste dans
    le texte."""
    champs = {}
    consommee = True
    cles_vues = set()
    textes_pris = []
    for p in paragraphes:
        lu = _decouper_champ_bloc(p.texte)
        if lu is None:
            if p.texte:
                consommee = False
            continue
        etiquette, valeur = lu
        if not valeur:
            # Clé vide : traitée comme absente, sans resoudre_cle(). Son étiquette est
            # identifiée sans avertir, pour savoir si le paragraphe peut quitter le corps.
            resolu = identifier_cle(etiquette, CANON_FIGURE)
            if resolu is not None and resolu[0] != '__ambigu__':
                textes_pris.append(p.texte)
            continue
        champ = resoudre_cle(etiquette, CANON_FIGURE, slug, 'bloc', bloquants)
        if champ is None:
            consommee = False
            _avertir_etiquette_bloc_inconnue(etiquette, valeur, slug)
            continue
        champs[champ] = valeur
        cles_vues.add(champ)
        textes_pris.append(p.texte)
    return champs, consommee, cles_vues, textes_pris


def _contenu_bloc(row1):
    """('table', Tableau imbriqué) si une cellule de la rangée 1 contient directement un
    tableau ; sinon ('image', None) si une cellule porte une image ; sinon (None, None)."""
    for tc in row1:
        tbl_interne = next((b for b in tc.blocs if isinstance(b, Tableau)), None)
        if tbl_interne is not None:
            return 'table', tbl_interne
    for tc in row1:
        if a_image_cellule(tc):
            return 'image', None
    return None, None


def extraire_bloc(tableau, slug, indice=0, bloquants=None):
    """(nature, champs, consommee, tbl_interne) pour la paire de rangées n° `indice` (0 pour
    le premier bloc, 1 pour le second bloc collé dans le même tableau…) d'un tableau
    enveloppe reconnu par n_blocs_meta(). Ancienne forme, lue en repli pour les documents
    déjà remplis ; principal() émet alors 'bloc-ancienne-forme'."""
    row0, row1 = tableau.rangees[indice * 2], tableau.rangees[indice * 2 + 1]
    champs, consommee, cles_vues = _champs_bloc_meta(row0, slug, bloquants)
    nature, tbl_interne = _contenu_bloc(row1)
    if nature is None:
        avertir(
            'bloc-contenu-absent',
            ['article « %s »' % slug, 'legende « %s »' % champs.get('legende', '')],
            'Un bloc de cet article annonce une légende («\u00a0%s\u00a0») mais sa rangée de '
            'contenu ne porte ni image ni tableau\u00a0: le dépôt est resté vide. Complétez-le '
            'dans le document puis réimportez l’article.' % champs.get('legende', ''),
            'Ein Block dieses Artikels kündigt eine Legende an («%s»), aber seine '
            'Inhaltszeile trägt weder Bild noch Tabelle: die Ablage ist leer geblieben. '
            'Ergänzen Sie sie im Dokument und importieren Sie den Artikel neu.'
            % champs.get('legende', ''))
    else:
        _avertir_cles_attendues_absentes(CANON_FIGURE, CLES_BLOC_ATTENDUES, cles_vues, slug,
                                          'bloc')
    return nature, champs, consommee, tbl_interne


# ---------------------------------------------------------------------------------
# Blocs figure et tableau, nouvelle forme : 1 à 5 paragraphes SZH Cle Abb/Tab consécutifs,
# suivis d'un paragraphe qui porte une image, ou d'un tableau, avec au plus un paragraphe
# vide entre les deux. Seul le style reconnaît le bloc ; sa bordure dessine le cadre dans
# Word.

def _cherche_contenu_bloc_nouvelle_forme(blocs, depart):
    """(indice, 'image'|'table') du contenu d'un bloc, cherché à `depart` (juste après les
    clés), ou (None, None). Si ce paragraphe est vide, on regarde le suivant, pas plus loin.
    Un paragraphe de texte arrête la recherche."""
    n = len(blocs)
    for decalage in (0, 1):
        idx = depart + decalage
        if idx >= n:
            return None, None
        candidat = blocs[idx]
        if isinstance(candidat, Tableau):
            return idx, 'table'
        if isinstance(candidat, Par):
            if any(candidat.images):
                return idx, 'image'
            if not candidat.texte:
                continue                  # paragraphe vide toléré
        return None, None
    return None, None


# ---------------------------------------------------------------------------------
# Groupes d'images. Des clés de figure suivies de plusieurs images (deux images dans un
# paragraphe, plusieurs paragraphes d'images, ou un tableau de mise en page qui ne contient
# que des images) forment une seule figure : un numéro, une légende, un crédit. C'est le
# groupe d'images (`::: {.szh-grille}`) que crée « Ajouter une image à côté » dans le
# panneau Médias.

def _par_images_seules(bloc):
    """Vrai pour un paragraphe qui porte au moins une image et aucun texte, seule forme
    admise dans un groupe : un texte n'aurait pas de place dans la grille."""
    return isinstance(bloc, Par) and bool(bloc.images) and not bloc.texte


# Entre deux images d'une même figure, au plus deux paragraphes vides. Au-delà, ou dès
# qu'un texte ou une clé s'intercale, la figure s'arrête. Même règle dans le nettoyeur
# (manuscrit_gabarit.MAX_VIDES_ENTRE_IMAGES).
MAX_VIDES_ENTRE_IMAGES = 2


def _par_vide(bloc):
    return isinstance(bloc, Par) and not bloc.texte and not bloc.images


def _etendue_images(blocs, idx):
    """Indices des paragraphes d'images qui forment le contenu d'un bloc : `idx` (rendu par
    _cherche_contenu_bloc_nouvelle_forme()), puis chaque paragraphe d'images seules qui suit,
    séparé du précédent par au plus MAX_VIDES_ENTRE_IMAGES paragraphes vides. Si le premier
    paragraphe porte aussi du texte, il reste seul."""
    indices = [idx]
    if not _par_images_seules(blocs[idx]):
        return indices
    j = idx + 1
    n = len(blocs)
    while j < n:
        k = j
        while k < n and k - j < MAX_VIDES_ENTRE_IMAGES and _par_vide(blocs[k]):
            k += 1
        if k < n and _par_images_seules(blocs[k]):
            indices.append(k)
            j = k + 1
            continue
        break
    return indices


def _paragraphes_de_tableau(tableau):
    """Tous les blocs des cellules d'un tableau, dans l'ordre de lecture, et None dès qu'une
    cellule porte un tableau imbriqué (ce n'est plus une mise en page d'images)."""
    tous = []
    for rangee in tableau.rangees:
        for cellule in rangee:
            for b in cellule.blocs:
                if not isinstance(b, Par):
                    return None
                tous.append(b)
    return tous


def est_tableau_images(tableau):
    """Vrai pour un tableau de mise en page : chaque cellule ne porte que des images ou rien,
    et il y a au moins une image.

    Une cellule avec une image et un texte (« a) avant ») exclut le tableau : un groupe
    d'images n'a qu'une légende (voir lib/references.js), et une sous-légende serait perdue.
    Le tableau reste un tableau, et `tableau-images-et-texte` dit comment en faire une
    figure."""
    pars = _paragraphes_de_tableau(tableau)
    if not pars:
        return False
    return any(p.images for p in pars) and all(not p.texte for p in pars)


def _tableau_images_et_texte(tableau):
    """Vrai quand chaque cellule non vide porte au moins une image, mais qu'une cellule au
    moins porte aussi du texte : une planche d'images sous-titrées, que est_tableau_images()
    refuse. Sert seulement à avertir."""
    vues = 0
    texte = False
    for rangee in tableau.rangees:
        for cellule in rangee:
            pars = [b for b in cellule.blocs if isinstance(b, Par)]
            if len(pars) != len(cellule.blocs):
                return False
            if not any(p.images or p.texte for p in pars):
                continue
            if not any(p.images for p in pars):
                return False
            vues += 1
            texte = texte or any(p.texte for p in pars)
    return vues > 0 and texte


def _avertir_tableau_images_et_texte(rang, slug):
    avertir(
        'tableau-images-et-texte',
        ['article « %s »' % slug, 'tableau %d' % rang],
        'Le tableau %d de cet article range des images avec des textes dans ses cases\u00a0: il a '
        'été importé comme un tableau, rien n’est perdu. Si c’est une planche d’images, '
        'retirez les textes des cases (reportez-les dans la légende) et réimportez\u00a0: il '
        'deviendra une figure à plusieurs images.' % rang,
        'Die Tabelle %d dieses Artikels ordnet Bilder zusammen mit Texten in ihren Zellen an: '
        'sie wurde als Tabelle importiert, es geht nichts verloren. Falls es sich um eine '
        'Bildtafel handelt, entfernen Sie die Texte aus den Zellen (übernehmen Sie sie in die '
        'Legende) und importieren Sie neu: sie wird dann eine Abbildung mit mehreren '
        'Bildern.' % rang)


def _avertir_cles_sans_contenu(champs, slug):
    legende = champs.get('legende', '')
    avertir(
        'bloc-cles-sans-contenu',
        ['article « %s »' % slug, 'legende « %s »' % legende],
        'Une ou plusieurs clés de figure ou de tableau («\u00a0Légende\u00a0:\u00a0», «\u00a0Texte alternatif\u00a0:\u00a0»,'
        ' «\u00a0Copyright\u00a0:\u00a0», «\u00a0Source\u00a0:\u00a0», «\u00a0Note\u00a0:\u00a0») ont été trouvées dans cet article, mais ni une image ni '
        'un tableau ne les suit dans les un ou deux paragraphes qui viennent juste après\u00a0: '
        'rien n’a été reconnu comme un bloc, ces paragraphes restent tels quels dans le '
        'texte. Vérifiez leur position par rapport à l’image ou au tableau dans le document.',
        'In diesem Artikel wurden Schlüsselabsätze eines Abbildungs- oder Tabellenblocks '
        'gefunden («Légende:», «Texte alternatif:», «Copyright:», «Source:», «Note:»), aber '
        'weder ein Bild noch eine Tabelle folgt in den ein oder zwei Absätzen unmittelbar '
        'danach: nichts wurde als Block erkannt, diese Absätze bleiben unverändert im Text. '
        'Prüfen Sie ihre Position gegenüber dem Bild oder der Tabelle im Dokument.')


def _extraire_blocs_nouvelle_forme(blocs, table1_elem, table2_elem, slug, bloquants=None,
                                    variantes=None):
    """Liste de dicts {'pos', 'nature', 'champs', 'consommee', 'tbl_interne', 'cles',
    'contenu'}, un par bloc de nouvelle forme trouvé dans `blocs`.
    `pos`, l'indice du premier paragraphe de clé, sert à principal() pour fusionner cette
    liste avec celle de l'ancienne forme dans l'ordre du document ; il n'apparaît pas dans
    stats['blocs'], qui doit être identique pour les deux formes
    (pronto-gabarits.test.js)."""
    resultat = []
    # Rang (à partir de 1) de chaque tableau de premier niveau, par son indice dans `blocs` :
    # la numérotation de docx-tables.py et de szh-tabelle-reference.lua. Un bloc tableau la
    # porte dans 'contenu', pour que ses champs aillent sur le bon tables/table-NN.html.
    rang_table = {}
    for idx, e in enumerate(blocs):
        if isinstance(e, Tableau):
            rang_table[idx] = len(rang_table) + 1
    n = len(blocs)
    i = 0
    while i < n:
        elem = blocs[i]
        if elem is table1_elem or elem is table2_elem or not _est_cle_bloc(elem):
            i += 1
            continue
        depart = i
        fin = depart
        while fin < n and fin - depart < 5 and _est_cle_bloc(blocs[fin]):
            fin += 1
        champs, consommee, cles_vues, textes_pris = _champs_bloc_meta_paragraphes(
            blocs[depart:fin], slug, bloquants)
        idx_contenu, nature = _cherche_contenu_bloc_nouvelle_forme(blocs, fin)
        if nature is None:
            _avertir_cles_sans_contenu(champs, slug)
            i = fin                       # les paragraphes de clé restent tels quels
            continue
        _avertir_cles_attendues_absentes(CANON_FIGURE, CLES_BLOC_ATTENDUES, cles_vues, slug,
                                          'bloc')
        fin_contenu = idx_contenu
        if nature == 'image':
            # Plusieurs images dans un paragraphe ou plusieurs paragraphes d'images : une
            # seule ligne FI, que szh-legendes.lua compose en groupe.
            indices_images = _etendue_images(blocs, idx_contenu)
            fin_contenu = indices_images[-1]
            contenu = _images_du_groupe([blocs[j] for j in indices_images], variantes)
        else:
            contenu = rang_table.get(idx_contenu)
            if est_tableau_images(blocs[idx_contenu]):
                nature = 'grille'         # tableau de mise en page d'images : ligne FG
            elif _tableau_images_et_texte(blocs[idx_contenu]):
                _avertir_tableau_images_et_texte(contenu, slug)
        resultat.append({'pos': depart, 'nature': nature, 'champs': champs,
                         'consommee': consommee, 'tbl_interne': nature == 'table',
                         'cles': textes_pris, 'contenu': contenu})
        i = fin_contenu + 1
    return resultat


def _images_du_groupe(pars, variantes=None):
    """La cible d'une ligne FI : pour une image, `_images_du_bloc()` (« nom|variante ») ;
    pour plusieurs, une entrée par image dans l'ordre, séparées par « ; », chacune avec ses
    variantes séparées par « | ». Word nomme ses médias imageN.ext : « ; » n'y figure pas."""
    images = [(nom, surface) for p in pars for nom, surface in p.images if nom]
    if len(images) <= 1:
        return _images_du_bloc(pars[0], variantes) if pars else ''
    variantes = variantes or {}
    entrees = []
    for nom, _ in images:
        noms = []
        for candidat in [nom] + list(variantes.get(nom, [])):
            if candidat not in noms:
                noms.append(candidat)
        entrees.append('|'.join(noms))
    return ';'.join(entrees)


def _images_du_bloc(par, variantes=None):
    """Les noms de fichier (sous media/) que l'image d'un bloc peut porter dans le .md,
    séparés par « | », de la plus grande surface déclarée à la plus petite, chacun suivi de
    ses variantes (un SVG derrière son aperçu bitmap, voir pronto_docx.variantes_images()).
    szh-legendes.lua pose les champs du bloc sur l'image qui porte l'un de ces noms, plutôt
    que sur un rang, qu'une image de plus décalerait. '' sans image."""
    variantes = variantes or {}
    noms = []
    for nom, _ in sorted(par.images, key=lambda t: t[1], reverse=True):
        if not nom:
            continue
        for candidat in [nom] + list(variantes.get(nom, [])):
            if candidat not in noms:
                noms.append(candidat)
    return '|'.join(noms)


# ---------------------------------------------------------------------------------
# Écriture du YAML, comme docx-meta.py (citer(), même ordre de clés), sans les mots-clés.

def serialiser_meta(meta):
    lignes = []
    if meta.get('type') in TYPES_VALIDES:
        lignes.append('type: ' + meta['type'])
    if meta.get('lang') in LANGUES_META:
        lignes.append('lang: ' + meta['lang'])
    if (meta.get('source') or '').strip():
        lignes.append('source: ' + citer(meta['source'].strip()))
    if (meta.get('doi') or '').strip():
        lignes.append('doi: ' + citer(meta['doi'].strip()))
    for cle in ('title', 'subtitle', 'resume'):
        table = meta.get(cle) or {}
        sous = ['  %s: %s' % (l, citer(table[l].strip()))
                for l in LANGUES_META if (table.get(l) or '').strip()]
        if sous:
            lignes.append(cle + ':')
            lignes.extend(sous)
    auteurs = []
    for a in meta.get('author') or []:
        propre = {c: str(a.get(c) or '').strip() for c in CHAMPS_AUTEUR}
        if any(propre.values()):
            auteurs.append(propre)
    if auteurs:
        lignes.append('author:')
        for a in auteurs:
            premiere = True
            for c in CHAMPS_AUTEUR:
                if not a[c]:
                    continue
                lignes.append(('- ' if premiere else '  ') + c + ': ' + citer(a[c]))
                premiere = False
    return '\n'.join(lignes) + '\n' if lignes else ''


# ---------------------------------------------------------------------------------
# Point d'entrée : `blocs` est le list[Par | Tableau] rendu par le lecteur.
# `chemin_source` sert seulement au champ `source` de la fiche (son basename).
#
# Une ligne T fait disparaître un tableau de premier niveau : docx-tables.py ne le rend pas,
# szh-meta.lua le retire de l'AST. docx-tables.py ne descend pas dans un tableau retiré :
# retirer l'enveloppe d'un bloc tableau ferait perdre le tableau qu'elle contient. Seuls les
# deux tableaux fixes de la tête (métadonnées, auteurs) reçoivent donc une ligne T ; un bloc
# à l'ancienne forme s'imprime tel quel (voir 'bloc-ancienne-forme').
#
# Les mots-clés ne sont pas écrits dans la fiche : ils se choisissent dans le cockpit.
#
# Les styles de corps du gabarit (« SZH Important », « SZH Hervorhebung », « SZH Question
# (interview) ») ne passent pas par ce module : pandoc les perd, et docx-styles-corps.py les
# marque dans une copie du .docx avant pandoc (étape 3 bis d'import-docx.sh).

def principal(blocs, chemin_source, slug, dossier, produit='', variantes=None):
    """`produit` : le jeton `revue:` du numéro (« revue » | « zeitschrift »), qui donne la
    langue (voir langue_du_produit()). Vide : français, avec l'avertissement
    'langue-deduite'.

    `variantes` : {nom d'image -> [autres noms]} (pronto_docx.variantes_images()), pour
    nommer l'image d'un bloc dans l'instruction FI sous tous ses noms possibles."""
    stats = {'slug': slug, 'avertissements': []}
    # Clés remplies mais non rangées : {'texte', 'lieu'} par occurrence. Non vide à la fin,
    # l'import échoue.
    bloquants = []

    tables = [(idx, e) for idx, e in enumerate(blocs) if isinstance(e, Tableau)]

    table1_elem = tables[0][1] if len(tables) >= 1 else None
    table2_elem = tables[1][1] if len(tables) >= 2 else None

    valeurs = {'type': '', 'titre': {}, 'soustitre': {}, 'resume': {}}
    table1_consommee = False
    if table1_elem is not None:
        valeurs, table1_consommee = extraire_table_metadonnees(table1_elem, slug, bloquants)
    else:
        avertir(
            'structure-inattendue',
            ['article « %s »' % slug, 'tableau metadonnees'],
            "Le premier tableau attendu (métadonnées) est introuvable\u00a0: ce document ne "
            "suit pas la forme du gabarit «\u00a0Pronto\u00a0– modèle d’article\u00a0». Rien n’a été "
            "lu automatiquement\u00a0; complétez «\u00a0Métadonnées des articles\u00a0» à la main.",
            'Die erste erwartete Tabelle (Metadaten) fehlt: dieses Dokument folgt nicht '
            'der Form der Vorlage «Pronto – Artikelmodell». Es wurde nichts '
            'automatisch gelesen; ergänzen Sie «Metadaten der Artikel» von Hand.')

    auteurs = []
    table2_consommee = False
    photos_connues = set()
    photos_appariees = []
    if table2_elem is not None:
        auteurs, table2_consommee, photos_connues, photos_appariees = \
            extraire_table_auteurs(table2_elem, slug, bloquants)
    else:
        avertir(
            'structure-inattendue',
            ['article « %s »' % slug, 'tableau auteurs'],
            "Le second tableau attendu (autrices et auteurs) est introuvable\u00a0: ce "
            "document ne suit pas la forme du gabarit «\u00a0Pronto\u00a0– modèle d’article\u00a0». "
            "Complétez «\u00a0Métadonnées des articles\u00a0» à la main.",
            'Die zweite erwartete Tabelle (Autorinnen und Autoren) fehlt: dieses Dokument '
            'folgt nicht der Form der Vorlage «Pronto – Artikelmodell». Ergänzen Sie '
            '«Metadaten der Artikel» von Hand.')

    blocs_figtab = []
    for k, (idx_bloc, tbl) in enumerate(tables):
        if tbl is table1_elem or tbl is table2_elem:
            continue
        n_paires = n_blocs_meta(tbl)
        if n_paires == 0:
            if ressemble_a_un_bloc(tbl):
                _avertir_bloc_mal_forme(tbl, k + 1, slug)
            continue
        avertir(
            'bloc-ancienne-forme',
            ['article « %s »' % slug, 'tableau %d' % (k + 1)],
            'Le tableau %d de cet article utilise l’ancienne forme de bloc figure ou tableau '
            '(un tableau à deux rangées), dépassée depuis le 21.09.2026\u00a0: il s’imprimera tel '
            'quel, avec ses étiquettes («\u00a0Légende\u00a0:\u00a0», «\u00a0Texte alternatif\u00a0:\u00a0»…), et sa légende '
            'ne sera ni numérotée ni reprise comme texte alternatif. Rien n’est perdu. Pour '
            'que ce bloc redevienne une figure ou un tableau légendé, convertissez-le vers la '
            'nouvelle forme (cinq paragraphes «\u00a0SZH Cle Abb/Tab\u00a0» suivis de l’image ou du '
            'tableau) puis réimportez l’article.' % (k + 1),
            'Die Tabelle %d dieses Artikels verwendet die alte Form eines Abbildungs- oder '
            'Tabellenblocks (eine zweizeilige Tabelle), seit dem 21.09.2026 veraltet: sie wird '
            'so gedruckt, wie sie ist, mitsamt ihren Bezeichnungen («Légende:», «Texte '
            'alternatif:»…), und ihre Legende wird weder nummeriert noch als Alternativtext '
            'übernommen. Es geht nichts verloren. Damit dieser Block wieder eine beschriftete '
            'Abbildung oder Tabelle wird, wandeln Sie ihn in die neue Form um (fünf Absätze '
            '«SZH Cle Abb/Tab», gefolgt vom Bild oder der Tabelle) und importieren Sie den '
            'Artikel neu.' % (k + 1))
        if n_paires > 1:
            # Plusieurs blocs collés, fusionnés en un seul tableau (voir n_blocs_meta()).
            avertir(
                'blocs-colles',
                ['article « %s »' % slug, 'tableau %d' % (k + 1), 'blocs %d' % n_paires],
                'Un tableau de cet article empile %d blocs figure ou tableau collés l’un à '
                'l’autre (%d rangées)\u00a0: deux blocs copiés à la suite, sans paragraphe entre '
                'eux, ont fusionné en un seul tableau à la conversion. Les %d blocs ont '
                'quand même été reconnus séparément\u00a0; pour éviter ce piège, laissez une '
                'ligne vide entre deux blocs dans le Word.'
                % (n_paires, n_paires * 2, n_paires),
                'Eine Tabelle dieses Artikels stapelt %d aneinandergeklebte Abbildungs- oder '
                'Tabellenblöcke (%d Zeilen): zwei ohne Absatz dazwischen kopierte Blöcke '
                'sind bei der Konvertierung zu einer einzigen Tabelle verschmolzen. Die %d '
                'Blöcke wurden trotzdem einzeln erkannt; lassen Sie im Word künftig eine '
                'leere Zeile zwischen zwei Blöcken, um das zu vermeiden.'
                % (n_paires, n_paires * 2, n_paires))
        for p in range(n_paires):
            nature, champs, consommee, tbl_interne = extraire_bloc(tbl, slug, p, bloquants)
            # `cles` et `contenu` vides : un bloc à l'ancienne forme ne retire rien du corps
            # et ne pose ses champs nulle part ; il s'imprime tel quel.
            blocs_figtab.append({'pos': idx_bloc, 'k': k, 'nature': nature, 'champs': champs,
                                 'consommee': consommee, 'contenu': None, 'cles': [],
                                 'tbl_interne': tbl_interne is not None})

    # Nouvelle forme : pas de tableau enveloppe, donc rien à ajouter à `tables_consommees` ;
    # le tableau d'un bloc tableau se rend comme tout tableau de contenu.
    blocs_nouvelle_forme = _extraire_blocs_nouvelle_forme(blocs, table1_elem, table2_elem, slug,
                                                            bloquants, variantes)
    blocs_figtab = sorted(blocs_figtab + blocs_nouvelle_forme, key=lambda b: b['pos'])

    # Un tableau de mise en page qui ne contient que des images devient un groupe d'images,
    # même sans clés au-dessus. Sont exclus les deux tableaux fixes et le contenu d'un bloc,
    # déjà traité.
    rangs_blocs = {b['contenu'] for b in blocs_nouvelle_forme
                   if b['nature'] in ('table', 'grille')}
    grilles_libres = []
    for k, (idx_bloc, tbl) in enumerate(tables):
        if tbl is table1_elem or tbl is table2_elem or (k + 1) in rangs_blocs:
            continue
        if est_tableau_images(tbl):
            grilles_libres.append(k + 1)

    # Tableaux consommés (lignes T), retirés du corps : seulement les deux tableaux fixes de
    # la tête, jamais un bloc (voir le commentaire au-dessus de principal()).
    tables_consommees = []
    for k, (idx_bloc, tbl) in enumerate(tables):
        if tbl is table1_elem and table1_consommee:
            tables_consommees.append(k + 1)
        elif tbl is table2_elem and table2_consommee:
            tables_consommees.append(k + 1)

    # Une clé remplie non rangée bloque l'import : rien n'est écrit. pronto-lire.py lit
    # stats['bloquant'] et liste stats['cles_non_reconnues'].
    if bloquants:
        stats['bloquant'] = True
        stats['cles_non_reconnues'] = bloquants
        return stats

    type_article = valeurs['type'] if valeurs['type'] in TYPES_VALIDES else ''
    # La langue vient du produit du numéro. `langue_deduite` : pas de produit (hors d'un
    # numéro, ou ausgabe.yaml sans `revue:`), d'où le français et un avertissement.
    langue = langue_du_produit(produit)
    langue_deduite = not langue

    lignes_b, ligne_bt, biblio = etendue_biblio(blocs, type_article or 'article', slug)

    meta = {
        'type': type_article,
        'lang': langue or 'fr',
        # $SZH_SOURCE (posée par import-docx.sh) donne le nom d'origine d'un .odt converti
        # en .docx ; sinon, le basename de `chemin_source`.
        'source': os.environ.get('SZH_SOURCE') or os.path.basename(chemin_source),
        'doi': '',
        'title': valeurs['titre'],
        'subtitle': valeurs['soustitre'],
        'resume': valeurs['resume'],
        'author': auteurs,
    }

    chemin_meta_yaml = os.path.join(dossier, slug + '.meta.yaml')
    meta_ecrit = False
    if os.path.exists(chemin_meta_yaml):
        stats['avertissements'].append('meta-existant-conserve')
    else:
        contenu = serialiser_meta(meta)
        if contenu:
            szh_commun.ecrire_atomique(chemin_meta_yaml, lambda f: f.write(contenu),
                                       binaire=False, encoding='utf-8', newline='\n')
            meta_ecrit = True

    if meta_ecrit and langue_deduite:
        avertir(
            'langue-deduite',
            ['article « %s »' % slug, 'langue « %s »' % meta['lang']],
            "La langue de cet article n’a pas pu être établie\u00a0: le numéro ne dit pas s’il "
            "s’agit de la Revue ou de la Zeitschrift, et la langue du document ne se lit "
            "plus dans le document lui-même. Le français a été posé par défaut\u00a0; "
            "vérifiez-le dans «\u00a0Métadonnées des articles\u00a0», la maquette et les résumés en "
            "dépendent.",
            'Die Sprache dieses Artikels konnte nicht bestimmt werden: die Ausgabe sagt '
            'nicht, ob es sich um die Revue oder die Zeitschrift handelt, und die Sprache '
            'steht nicht mehr im Dokument selbst. Ersatzweise wurde Französisch gesetzt; '
            'prüfen Sie es unter «Metadaten der Artikel» – Layout und Zusammenfassungen '
            'richten sich danach.')

    chemin_photos = os.getenv('SZH_PHOTOS')
    if chemin_photos:
        appariees = {nom for _, nom in photos_appariees}
        with open(chemin_photos, 'w', encoding='utf-8', newline='\n') as f:
            for base, nom_image in photos_appariees:
                f.write('A\t%s\t%s\n' % (base, nom_image))
            for nom_image in sorted(photos_connues - appariees):
                f.write('G\t%s\n' % nom_image)

    chemin_instr = os.getenv('SZH_META')
    if chemin_instr:
        with open(chemin_instr, 'w', encoding='utf-8', newline='\n') as f:
            f.write('Y\t%s\n' % type_article)
            f.write('L\t%s\n' % meta['lang'])
            for k in tables_consommees:
                f.write('T\t%d\n' % k)
            # Les valeurs des clés d'un bloc se posent sur l'image (FI, szh-legendes.lua), le
            # groupe d'images (FI à plusieurs images, FG pour un tableau d'images) ou le
            # tableau (FT, docx-tables.py).
            #
            # Format : FI|FG|FT <TAB> contenu <TAB> légende <TAB> alt <TAB> copyright <TAB>
            # source <TAB> note [<TAB> texte d'une clé à retirer du corps]… Les cinq champs
            # sont toujours présents (vides si absents), sur une ligne.
            #
            # Pas de ligne P pour un bloc : les textes des clés suivent en fin de ligne, et
            # szh-legendes.lua les retire du corps au moment où il pose leurs valeurs, juste
            # devant le contenu du bloc. Une ligne P retirerait la première occurrence du
            # texte dans le document, parfois celle d'un autre bloc, ou perdrait les valeurs
            # si l'image n'était pas trouvée. Une valeur non posée reste ainsi visible, et
            # szh-legendes.lua le signale (bloc-valeur-non-reprise).
            for b in blocs_figtab:
                if b['contenu'] is None:
                    continue
                champs = b['champs']
                queue = '\t'.join([champs.get('legende', ''), champs.get('alt', ''),
                                   champs.get('credit', ''), champs.get('source', ''),
                                   champs.get('note', '')])
                lettre = {'table': 'FT', 'grille': 'FG'}.get(b['nature'], 'FI')
                f.write('%s\t%s\t%s%s\n' % (lettre, b['contenu'], queue,
                                            ''.join('\t' + t for t in b['cles'])))
            # Tableaux d'images sans clés (grilles_libres) : groupe d'images sans légende.
            for k in grilles_libres:
                f.write('FG\t%d\t\t\t\t\t\n' % k)
            if ligne_bt:
                f.write('BT\t%s\n' % ligne_bt)
            for t in lignes_b:
                f.write('B\t%s\n' % t)

    stats.update({
        'bloquant': False,
        'type': type_article,
        'langue': meta['lang'], 'langue_deduite': langue_deduite,
        'titre_langues': sorted(valeurs['titre']),
        'soustitre_langues': sorted(valeurs['soustitre']),
        'resume_langues': sorted(valeurs['resume']),
        'tableau1_consomme': table1_consommee,
        'tableau2_consomme': table2_consommee,
        'auteurs': {'n': len(auteurs),
                    'emails': sum(1 for a in auteurs if a.get('email')),
                    'ror': sum(1 for a in auteurs if a.get('ror')),
                    'photos': sum(1 for a in auteurs if a.get('photo'))},
        'tableaux_consommes': tables_consommees,
        'blocs': [{'nature': b['nature'], 'legende': b['champs'].get('legende', ''),
                  'tbl_interne': b['tbl_interne'], 'consommee': b['consommee']}
                 for b in blocs_figtab],
        'grilles_tableau': grilles_libres,
        'biblio': biblio,
        'meta_ecrit': meta_ecrit,
    })
    return stats
