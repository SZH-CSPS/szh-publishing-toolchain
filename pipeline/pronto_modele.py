#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# pronto_modele.py — le modèle neutre du gabarit « Pronto — modèle d'article » et TOUTES les
# règles qui le lisent : reconnaissance des styles maison (SZH Cle, SZH Aide), des deux
# tableaux fixes (métadonnées, autrices et auteurs), des blocs figure/tableau, de l'étendue
# de bibliographie, et la sérialisation en meta.yaml + instructions $SZH_META/$SZH_PHOTOS.
#
# AUCUNE trace de Word ni d'OpenDocument ici : pas de namespace `w:`, pas de `office:`. Ce
# fichier ne sait pas lire un .docx ni un .odt — il ne sait que raisonner sur trois classes :
#
#   Par(style, texte, niveau, images)   — un paragraphe. `style` est déjà résolu en son nom
#                                          humain (« SZH Cle », « heading 1», « Quote »…) ;
#                                          c'est le SEUL endroit où .docx et .odt diffèrent,
#                                          et c'est exactement pour ça qu'il vit dans le
#                                          lecteur (pronto_docx.py / pronto_odt.py), jamais
#                                          ici. `texte` est déjà normalisé (normaliser()) —
#                                          le lecteur ne rend jamais de texte brut. `niveau`
#                                          vaut 1..3 pour un titre, 0 sinon. `images` est une
#                                          liste de (nom de fichier sous media/ ou Pictures/,
#                                          surface déclarée — 0 si inconnue).
#   Cellule(colspan, blocs)             — `blocs` est une liste de Par | Tableau, dans l'ordre
#                                          du document (imbrication comprise : une cellule de
#                                          bloc tableau porte un Tableau parmi ses blocs).
#   Tableau(rangees)                    — `rangees` est une liste de listes de Cellule. Une
#                                          cellule masquée par une fusion (w:gridSpan côté
#                                          Word, table:covered-table-cell côté OpenDocument)
#                                          n'apparaît PAS ici : le lecteur l'a déjà sautée.
#
# Un « document » lu est simplement une list[Par | Tableau] — les blocs de premier niveau,
# dans l'ordre. pronto_docx.lire() et pronto_odt.lire() en rendent chacun un ; principal()
# ci-dessous les consomme sans jamais savoir d'où ils viennent.
#
# ── Ce qui a dû changer par rapport à docx-pronto.py pour accueillir l'ODT ─────────────────
#
# 1. Classeur perd son dict `styles` (styleId -> nom). Il n'en a plus besoin : le lecteur a
#    déjà résolu CHAQUE paragraphe en un seul nom humain avant que ce module ne le voie. Les
#    méthodes deviennent des fonctions de module (famille(), pandoc_mange()) qui prennent ce
#    nom résolu directement. Les DEUX familles de motifs que famille() testait avant (contre
#    le nom w:name ET contre le styleId brut — « titre », « berschrift1 », etc., hérités de
#    docx-meta.py pour des Word hérités où le nom affiché ment) sont maintenant testées
#    contre CE SEUL nom résolu, sous deux formes (avec espaces, et compactée sans espaces ni
#    tirets) : rien n'est perdu, c'est la même couverture, sur une seule entrée au lieu de
#    deux.
#
# 2. Le style de base (paragraphe sans mise en forme particulière) résout différemment selon
#    le format : '' côté .docx (un w:p sans w:pStyle n'a simplement pas de style — voir
#    pronto_docx.py), mais « Standard » côté .odt (le paragraphe SANS style particulier y
#    référence quand même explicitement le style racine de la feuille, remonté par la chaîne
#    de parents — voir pronto_odt.py). Mesuré : ça ne change AUCUN comportement observable,
#    puisque famille('') et famille('standard') rendent toutes deux '' (aucune classe
#    reconnue) — mais c'est bien une différence de valeur entre les deux lecteurs pour le
#    « même » paragraphe, qu'il fallait constater plutôt que suffixée en silence.
#
# 3. Word donne « Body Text » comme nom (w:name du style Corpsdetexte) là où LibreOffice
#    donne « Text body » (style:display-name de Text_20_body, même style, ordre des mots
#    inversé) pour le même style natif « corps de texte ». Mesuré sur le gabarit réel. Sans
#    conséquence ici : ce nom n'est reconnu par aucune règle de famille() (ni title, ni
#    heading, ni caption…) des deux côtés, les paragraphes de corps ne sont jamais classés —
#    mais une future règle qui voudrait un jour reconnaître le corps de texte PAR NOM devra
#    tester les deux formes, pas une seule.
#
# stdlib uniquement : pas de PyYAML dans la WSL de la flotte.

import os
import re
import sys
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun


# ---------------------------------------------------------------------------------
# Le modèle neutre — trois classes, rien d'autre.

class Par:
    """Un paragraphe (ou un titre). `style` est le nom humain déjà résolu par le lecteur,
    `texte` le texte déjà normalisé (normaliser()), `niveau` 1..3 pour un titre (0 sinon),
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
    """Un tableau. `rangees` est une liste de listes de Cellule — une cellule masquée par une
    fusion (w:gridSpan, table:covered-table-cell) n'y figure jamais : le lecteur l'a sautée.

    `page` est le numéro de page où ce tableau se trouve dans le document source, ou None
    quand il est inconnu — JAMAIS deviné. Seul pronto_docx.lire() le calcule (à partir des
    marqueurs w:lastRenderedPageBreak que Word pose à sa dernière repagination — absents d'un
    .docx jamais ouvert par Word, mesuré) ; pronto_odt.lire() le laisse toujours à None, faute
    d'équivalent OpenDocument. Ne vaut que pour les tableaux de PREMIER NIVEAU : un tableau
    imbriqué (contenu d'un bloc tableau) ne le porte jamais, rien n'en a besoin aujourd'hui."""

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
# HUIT champs, `ror` compris : aligné sur CHAMPS_AUTEUR de lib/yaml.js (cockpit), PAS sur
# celui de docx-meta.py, qui ne porte pas `ror` — voir l'en-tête d'origine de docx-pronto.py
# (git log) : ce n'était pas un contrat à imiter, c'était l'absence de ce champ sur les Word
# hérités que docx-meta.py doit encore lire.
CHAMPS_AUTEUR = ('prenom', 'nom', 'fonction', 'affiliation', 'ror', 'orcid', 'email', 'photo')
# Formats qu'accepte le dépôt de photo du cockpit (EXTENSIONS_PHOTO d'extension.js) et donc
# le pipeline de portraits : une image d'un autre format n'est pas appariée.
EXTENSIONS_PORTRAIT = ('png', 'jpg', 'jpeg', 'webp')


# ---------------------------------------------------------------------------------
# Texte : une seule fonction partagée, pure — les lecteurs l'appliquent à ce qu'ils
# extraient de leur propre XML avant de construire un Par.

def normaliser(t):
    """Espaces spéciaux -> espace, tirets spéciaux -> '-', espaces compactés, rogné."""
    for a, b in ((' ', ' '), (' ', ' '), (' ', ' '),
                 ('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


def aplatir(t):
    """Minuscules, accents repliés, tout ce qui n'est pas [a-z0-9] retiré. Sur les mots du
    lexique — tous ASCII — donne le même résultat que plat() de szh-citations.lua."""
    return ''.join(c for c in unicodedata.normalize('NFD', t.lower())
                   if c.isalnum() and ord(c) < 128)


def cle_comparaison(t):
    """Clé qui apparie un paragraphe du document source au bloc que pandoc en fera : les
    quarante premiers caractères [A-Za-z0-9], et rien d'autre. Voir l'en-tête d'origine
    (git log de docx-pronto.py) pour la justification complète — inchangée par ce chantier."""
    return re.sub(r'[^A-Za-z0-9]', '', t)[:40]


def slugifier_portrait(prenom, nom):
    """Nom de base d'un fichier de portrait. À garder aligné sur slugifier() de
    vscodium-extension/szh-cockpit/lib/slug.js — voir l'en-tête d'origine de docx-pronto.py."""
    s = re.sub(r'\.[^.]*$', '', (prenom + '-' + nom))
    for a, b in (('œ', 'oe'), ('Œ', 'oe'), ('æ', 'ae'), ('Æ', 'ae'), ('ß', 'ss')):
        s = s.replace(a, b)
    s = re.sub(r'[̀-ͯ]', '', unicodedata.normalize('NFD', s))
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s or 'article'


def citer(v):
    return '"' + re.sub(r'([\\"])', r'\\\1', str(v)) + '"'


# ---------------------------------------------------------------------------------
# Classement d'un nom de style résolu en famille : title, subtitle, author, abstract, biblio,
# caption, heading, ou rien. Voir le point 1 de l'en-tête pour ce qui a changé par rapport à
# l'original (un seul nom résolu en entrée, plus un dict styleId -> nom).

NOMS_PANDOC_META = {'title', 'subtitle', 'author', 'abstract', 'date'}

RE_NIVEAU_TITRE = re.compile(r'^(?:heading|titre|titolo|berschrift)\s*([1-3])\b', re.I)


def famille(nom_style):
    """Classe le nom de style DÉJÀ RÉSOLU d'un paragraphe. `n` = le nom tel quel, minuscules ;
    `ns` = la même chose compactée (espaces et tirets retirés), pour les formes de type
    identifiant (« titre1 », « berschrift2 ») qu'un styleId brut aurait portées."""
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
    # « EndNoteBibliography » est le style que le plugin EndNote pose sur la liste qu'il
    # génère — voir l'en-tête d'origine pour le chiffre mesuré sur le corpus.
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
    """pandoc mappe-t-il ce style en métadonnées (bloc absent du corps) ? Non appelé
    aujourd'hui (repris tel quel de docx-pronto.py, qui ne l'appelait pas non plus), gardé
    pour ne rien retirer d'un contrat existant."""
    return (nom_style or '').strip().lower() in NOMS_PANDOC_META


def niveau_depuis_style(nom_style):
    """Niveau de titre 1..3 déduit du nom de style résolu, 0 sinon. Utilisé par LES DEUX
    lecteurs (docx ET odt) — plutôt que de faire confiance à @text:outline-level côté ODT
    (qui existe et serait tout aussi valide), pour que les deux formats s'accordent par
    construction sur la même règle : si un style de titre s'appelle pareil des deux côtés
    (ce que mesure justement le contrôle de parité de structure), son niveau sera identique."""
    m = RE_NIVEAU_TITRE.match(normaliser(nom_style or ''))
    return int(m.group(1)) if m else 0


# ---------------------------------------------------------------------------------
# Styles maison du gabarit Pronto (« SZH Cle », « SZH Aide »…) : reconnus par leur nom
# résolu, jamais par un identifiant de style.

def normaliser_nom_style(nom):
    """Nom de style prêt à comparer : minuscules, espaces et tirets retirés. « SZH Cle »,
    « szhcle » et « SZH-Cle » tombent tous sur la même clé ; la ponctuation (parenthèses de
    « SZH Question (interview) ») n'est PAS retirée."""
    return re.sub(r'[\s\-]+', '', (nom or '').lower())


NOM_STYLE_CLE = normaliser_nom_style('SZH Cle')
NOM_STYLE_AIDE = normaliser_nom_style('SZH Aide')
# Révision du 21.09.2026 (décision de Robin) : les métadonnées d'un bloc figure/tableau ne
# vivent plus dans un tableau enveloppe mais dans des paragraphes ordinaires de CE style, juste
# avant l'image ou le tableau — voir n_blocs_meta()/extraire_bloc() pour l'ancienne forme,
# conservée en repli, et _extraire_blocs_nouvelle_forme() pour la nouvelle.
NOM_STYLE_CLE_BLOC = normaliser_nom_style('SZH Cle Abb/Tab')


def _style_par(par):
    return normaliser_nom_style(par.style)


def _est_cle_bloc(bloc):
    """Vrai pour un paragraphe SZH Cle Abb/Tab — jamais pour un SZH Cle ordinaire (qui ne
    forme un bloc que par l'ancienne forme, à l'intérieur d'un tableau enveloppe, jamais posé
    seul au premier niveau du document)."""
    return isinstance(bloc, Par) and _style_par(bloc) == NOM_STYLE_CLE_BLOC


# ---------------------------------------------------------------------------------
# Avertissement au rédacteur : même mécanisme que docx-meta.py (szh_commun.avertir), même
# préfixe — pour que journal.js, côté cockpit, n'ait qu'un seul format à reconnaître, quel
# que soit le lecteur qui a parlé.

PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# ---------------------------------------------------------------------------------
# Bibliographie : reconnaissance et étendue à détacher — même clé de comparaison, mêmes
# bornes que docx-meta.py : szh-biblio-detacher.lua les relit et ne doit pas voir de
# différence entre ce que produit l'un ou l'autre lecteur.

def lire_titres_bib():
    """Le lexique des titres de bibliographie, relu dans szh-citations.lua — qui le porte
    pour toute la chaîne, cockpit compris (voir lib/citations.js). Deux copies, ce seraient
    deux réponses. Filtre illisible : lexique vide, donc aucun titre reconnu, donc l'étendue
    commence au premier paragraphe stylé — on détache moins, jamais à côté."""
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


# Compléments tolérés devant un titre de bibliographie, une fois aplati : une numérotation
# de titre (« 5. Références ») est retirée par regex (les chiffres de tête ne font partie
# d'aucune entrée du lexique) ; un complément du type « Liste des références » est retiré
# par préfixe, mot à mot. Décision de la rédaction (voir en-tête du chantier) : le gabarit
# Pronto ne définit AUCUN style de bibliographie et n'en aura jamais — la reconnaissance ne
# peut donc reposer QUE sur le titre, et doit tolérer la façon dont les auteurs l'écrivent
# réellement.
RE_NUM_TITRE_BIBLIO = re.compile(r'^\d+')
PREFIXES_TITRE_BIBLIO = ('listedes', 'listede', 'liste')


def _titre_est_biblio(texte, lexique):
    """Ce titre (niveau 1 à 3) se reconnaît-il comme celui d'une bibliographie ? Comparé au
    même lexique que szh-citations.lua (lire_titres_bib()), sur le texte aplati (accents et
    casse indifférents, ponctuation et espaces déjà retirés par aplatir()) — après avoir
    retiré une numérotation de tête et, le cas échéant, un complément « Liste des » devant."""
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

    Le gabarit Pronto ne définit aucun style de bibliographie (mesuré sur le gabarit réel :
    aucun `w:style`/`style:style` de ce nom parmi les vingt qu'il porte) — la détection par
    STYLE de docx-meta.py (famille(e.style) == 'biblio') n'a donc RIEN à reconnaître ici.
    Mesuré sur le banc de 20 articles : c'est ce qui faisait détacher 0 paragraphe sur les
    19 articles non-documentation, alors que les originaux en détachaient 5 à 36.

    La bibliographie se reconnaît ici à son TITRE : le DERNIER paragraphe de niveau de
    titre (1 à 3) dont le texte tombe, une fois aplati, dans le lexique de
    lire_titres_bib() — le dernier, parce que la bibliographie est normalement la toute
    dernière section de l'article, et qu'un « Literatur » plus haut pourrait être une revue
    de littérature, pas la liste des références. Une fois ce titre trouvé, TOUT ce qui suit
    devient la bibliographie, un paragraphe = une entrée, jusqu'à la fin du document — sauf
    si un tableau est rencontré en chemin : ce n'est plus de la bibliographie, l'étendue
    s'arrête avant lui, et c'est dit par un avertissement (ce cas est louche, il ne devrait
    pas arriver).

    Une documentation est laissée entière : sa liste EST son contenu."""
    stats = {'voie': 'aucune', 'paragraphes': 0, 'titre': False}
    if type_article == 'documentation':
        stats['voie'] = 'documentation'
        return [], '', stats

    lexique = lire_titres_bib()
    titre = None
    for i, e in enumerate(blocs):
        if not isinstance(e, Par) or not e.texte or e.niveau not in (1, 2, 3):
            continue
        if _titre_est_biblio(e.texte, lexique):
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
                'titre (« %s ») : ce n\'est pas normal, la bibliographie ne s\'étend donc '
                'que jusqu\'à ce tableau. Ce qui le suit n\'a pas été examiné ; vérifiez la '
                'liste des références détachée.' % blocs[titre].texte,
                'In der Bibliografie dieses Artikels wurde nach ihrem Titel (« %s ») eine '
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
# Étiquettes du gabarit — comparées via aplatir() : accents, espaces et casse n'y font
# aucune différence.

RE_SUFFIXE_LANGUE = re.compile(r'\s*\((fr|de|it)\)\s*$', re.I)

CLE_CHAMP_TYPE = aplatir("Type d'article")
CLE_CHAMP_LANGUE = aplatir("Langue de l'article")
CLE_CHAMP_TITRE = aplatir('Titre')
CLE_CHAMP_SOUSTITRE = aplatir('Sous-titre')
CLE_CHAMP_RESUME = aplatir('Résumé')

VALEURS_TYPE = {
    aplatir('dossier thématique'): 'article',
    aplatir('éditorial'): 'editorial',
    aplatir('edito'): 'editorial',
    aplatir('entretien'): 'interview',
    aplatir('varia'): 'varia',
    aplatir('tribune libre'): 'tribune-libre',
}
VALEURS_TYPE_CANONIQUES = {aplatir(t): t for t in TYPES_VALIDES}
VALEURS_LANGUE = {
    aplatir('français'): 'fr',
    aplatir('francais'): 'fr',
    aplatir('deutsch'): 'de',
    aplatir('italiano'): 'it',
}

LABELS_AUTEUR = {
    aplatir('Prénom'): 'prenom',
    aplatir('Nom'): 'nom',
    aplatir('Fonction'): 'fonction',
    aplatir('Institution'): 'affiliation',
    aplatir('ROR'): 'ror',
    aplatir('ORCID'): 'orcid',
    aplatir('Email'): 'email',
}

LABELS_FIGURE = {
    aplatir('Légende'): 'legende',
    aplatir('Texte alternatif'): 'alt',
    aplatir('Crédit'): 'credit',
    aplatir('Source'): 'source',
}

LABELS_FIGURE_LEGENDE = aplatir('Légende')


# ---------------------------------------------------------------------------------
# Tableau 1 — métadonnées de l'article.

def _etiquette_szh_cle(cellule):
    """Texte des paragraphes SZH Cle d'une cellule, paragraphes SZH Aide ignorés, joints par
    un espace (il n'y en a normalement qu'un). Ne regarde que les Par directs de la cellule —
    un bloc n'a jamais de tableau imbriqué dans une cellule d'étiquette."""
    morceaux = []
    for b in cellule.blocs:
        if not isinstance(b, Par):
            continue
        if _style_par(b) == NOM_STYLE_AIDE:
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


def extraire_table_metadonnees(tableau, slug):
    """(valeurs, consommee). `valeurs` = {'type', 'langue', 'titre', 'soustitre', 'resume'}
    — les trois derniers étant des dict langue -> texte."""
    valeurs = {'type': '', 'langue': '', 'titre': {}, 'soustitre': {}, 'resume': {}}
    consommee = True
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
        cle = aplatir(base)

        if cle == CLE_CHAMP_TYPE:
            jeton = VALEURS_TYPE.get(aplatir(valeur)) or VALEURS_TYPE_CANONIQUES.get(aplatir(valeur))
            if jeton:
                valeurs['type'] = jeton
            elif valeur:
                avertir(
                    'type-article-non-reconnu',
                    ['article « %s »' % slug, 'valeur « %s »' % valeur],
                    "Le champ « Type d'article » du tableau des métadonnées porte une "
                    'valeur que le gabarit ne reconnaît pas : « %s ». Le type n\'a pas '
                    'été rempli dans la fiche ; choisissez-le dans « Métadonnées des '
                    'articles ».' % valeur,
                    'Das Feld «Type d\'article» der Metadatentabelle enthält einen von '
                    'der Vorlage nicht erkannten Wert: « %s ». Der Typ wurde in den '
                    'Metadaten nicht gesetzt; wählen Sie ihn unter «Metadaten der '
                    'Artikel».' % valeur)
        elif cle == CLE_CHAMP_LANGUE:
            code = VALEURS_LANGUE.get(aplatir(valeur))
            if code:
                valeurs['langue'] = code
        elif cle == CLE_CHAMP_TITRE and langue_champ:
            valeurs['titre'][langue_champ] = valeur
        elif cle == CLE_CHAMP_SOUSTITRE and langue_champ:
            valeurs['soustitre'][langue_champ] = valeur
        elif cle == CLE_CHAMP_RESUME and langue_champ:
            valeurs['resume'][langue_champ] = valeur
        else:
            consommee = False
            avertir(
                'etiquette-metadonnees-inconnue',
                ['article « %s »' % slug, 'etiquette « %s »' % etiquette,
                 'valeur « %s »' % valeur],
                'Le tableau des métadonnées de cet article porte une étiquette que le '
                'gabarit ne connaît pas : « %s » (valeur : « %s »). Rien n\'est perdu — '
                'le tableau reste imprimé dans le texte — mais cette valeur n\'est pas '
                'reprise dans la fiche. Corrigez l\'étiquette dans le document puis '
                'réimportez l\'article, ou complétez « Métadonnées des articles » à la '
                'main.' % (etiquette, valeur),
                'Die Metadatentabelle dieses Artikels enthält eine der Vorlage '
                'unbekannte Bezeichnung: « %s » (Wert: « %s »). Nichts geht verloren — '
                'die Tabelle bleibt im Text gedruckt — aber dieser Wert wird nicht in '
                'die Metadaten übernommen. Korrigieren Sie die Bezeichnung im Dokument '
                'und importieren Sie den Artikel neu, oder ergänzen Sie «Metadaten der '
                'Artikel» von Hand.' % (etiquette, valeur))
    return valeurs, consommee


# ---------------------------------------------------------------------------------
# Tableau 2 — autrices et auteurs.

def images_de_cellule(cellule):
    """[(nom, surface)] de toutes les images de la cellule, EN PROFONDEUR (un tableau
    imbriqué dans la cellule compte aussi), dans l'ordre du document."""
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
    """Nom du fichier de la photo d'une cellule : la plus grande image déclarée, et non la
    première — voir l'en-tête d'origine (docx-pronto.py, git log) pour la justification."""
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


def extraire_table_auteurs(tableau, slug):
    """(auteurs, consommee, photos_connues, photos_appariees)."""
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
        for p in tc_champs.blocs:
            if not isinstance(p, Par):
                continue
            if _style_par(p) == NOM_STYLE_AIDE:
                continue
            texte = p.texte
            if not texte:
                continue
            if ':' not in texte:
                ligne_ok = False
                lignes_inconnues.append(texte)
                continue
            etiquette, _, valeur = texte.partition(':')
            champ = LABELS_AUTEUR.get(aplatir(etiquette))
            valeur = valeur.strip()
            if champ is None:
                ligne_ok = False
                lignes_inconnues.append(texte)
                continue
            if valeur:
                champs[champ] = valeur

        nom_image = None
        if a_image_cellule(tc_photo):
            photos_connues.update(n for n, _ in images_de_cellule(tc_photo))
            nom_image = photo_de_cellule(tc_photo)

        if not champs and not nom_image:
            continue                      # rangée-modèle non remplie : aucun auteur

        if not ligne_ok:
            consommee = False
            avertir(
                'auteur-etiquette-inconnue',
                ['article « %s »' % slug] + ['ligne « %s »' % t for t in lignes_inconnues],
                'La fiche d\'une autrice ou d\'un auteur de cet article porte une ligne '
                'que le gabarit ne reconnaît pas (%s). Elle n\'a pas été reprise dans la '
                'fiche ; les autres champs de cette personne, eux, le sont.'
                % ' ; '.join('« %s »' % t for t in lignes_inconnues),
                'Der Eintrag einer Autorin oder eines Autors dieses Artikels enthält eine '
                'von der Vorlage nicht erkannte Zeile (%s). Sie wurde nicht in die '
                'Metadaten übernommen; die übrigen Felder dieser Person hingegen schon.'
                % ' ; '.join('« %s »' % t for t in lignes_inconnues))

        auteur = {c: champs.get(c, '') for c in ('prenom', 'nom', 'fonction', 'affiliation',
                                                  'ror', 'orcid', 'email')}
        auteur['photo'] = ''
        if nom_image:
            chemin_photo, base = _photo_appariee(nom_image, auteur['prenom'], auteur['nom'],
                                                  bases_vues, fichiers_vus, slug)
            if chemin_photo:
                auteur['photo'] = chemin_photo
                photos_appariees.append((base, nom_image))
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
    """Combien de blocs figure/tableau ce tableau Word empile-t-il, 0 s'il n'en est pas un.

    Le cas normal est 2 rangées (une paire méta/contenu) : c'est le seul que le gabarit
    produit quand un rédacteur suit la consigne. Mais rien n'empêche de « copier ce tableau
    entier pour chaque nouvelle figure » SANS laisser de paragraphe entre les copies — et
    LibreOffice, à la conversion en .odt, FUSIONNE deux `table:table` directement adjacents
    en un seul tableau de 2×N rangées (mesuré sur le gabarit réel, avec deux blocs figure
    collés : 2 tableaux .docx -> 1 tableau .odt de 4 rangées, silencieusement — aucun bloc
    n'était plus reconnu, aucune légende ni texte alternatif n'étaient plus lus). Un tableau
    de 2×N rangées (N >= 1) dont chaque rangée PAIRE (0, 2, 4…) porte, comme première
    étiquette SZH Cle, « Légende » est donc traité comme N blocs empilés, quelle que soit
    leur nature : figure+figure (le cas mesuré), mais tout aussi bien figure+tableau ou
    tableau+tableau — rien ici ne distingue les natures avant _contenu_bloc().

    Un nombre de rangées impair (3, 5…) n'est PAS un tel empilement : il reste, comme
    aujourd'hui, un tableau non reconnu, laissé tel quel dans le corps."""
    rangees = tableau.rangees
    n = len(rangees)
    if n < 2 or n % 2 != 0:
        return 0
    for i in range(0, n, 2):
        row_meta, row_contenu = rangees[i], rangees[i + 1]
        if not row_meta or not row_contenu:
            return 0
        etiquette = _premiere_etiquette_szh_cle(row_meta)
        if etiquette is None or aplatir(etiquette) != LABELS_FIGURE_LEGENDE:
            return 0
    return n // 2


def est_bloc_meta(tableau):
    """Au moins un bloc figure/tableau reconnu (voir n_blocs_meta) — 2 rangées dans le cas
    normal, le seul que docx-tables.py sait aujourd'hui déballer (voir la note au point
    d'intégration, plus bas) : c'est pourquoi principal() continue de poser une seule ligne
    T par TABLEAU Word, jamais une par bloc."""
    return n_blocs_meta(tableau) > 0


# ---------------------------------------------------------------------------------
# Garde-fou : un tableau qui PORTE les étiquettes d'un bloc mais n'a pas la forme attendue —
# donc n_blocs_meta() == 0 — reste aujourd'hui simplement ignoré : imprimé tel quel dans le
# corps, sa légende et son texte alternatif jamais lus, sans qu'on le dise nulle part. Cas
# réels qui produisent ce silence : une rangée ajoutée (nombre de rangées impair), la rangée
# de méta qui n'est plus en position paire, une rangée de méta sans rangée de contenu, des
# blocs collés puis retouchés au point que le motif à 2×N rangées ne tienne plus.

def _premier_par_etiquette_bloc(tableau):
    """Le premier paragraphe SZH Cle, n'importe où dans le tableau, dont l'ÉTIQUETTE (le
    texte avant le premier deux-points) est l'une des quatre du bloc figure/tableau — ou
    None. Ne regarde que les Par DIRECTS de chaque cellule (comme _premiere_etiquette_szh_cle
    et _champs_bloc_meta) : un tableau imbriqué dans une cellule n'est jamais lui-même une
    étiquette de bloc, inutile d'y descendre ici."""
    for rangee in tableau.rangees:
        for cellule in rangee:
            for p in cellule.blocs:
                if not isinstance(p, Par):
                    continue
                if _style_par(p) != NOM_STYLE_CLE:
                    continue
                if not p.texte or ':' not in p.texte:
                    continue
                etiquette = p.texte.partition(':')[0]
                if aplatir(etiquette) in LABELS_FIGURE:
                    return p
    return None


def ressemble_a_un_bloc(tableau):
    """Vrai quand ce tableau porte au moins un paragraphe SZH Cle dont l'ÉTIQUETTE vaut
    Légende, Texte alternatif, Crédit ou Source — même tolérance que partout ici (aplatir()) —
    SANS être reconnu comme un bloc bien formé par n_blocs_meta().

    ⚠ Volontairement restreint à l'ÉTIQUETTE d'un paragraphe SZH Cle (le motif « Étiquette :
    valeur » que _champs_bloc_meta() lit pour un bloc bien formé), jamais à un mot cherché
    n'importe où dans le tableau : un vrai tableau de CONTENU peut très bien porter une
    colonne intitulée « Légende » (un en-tête, en style Normal, pas SZH Cle) sans qu'aucun
    bloc n'ait jamais été voulu. Élargir ce test à « le mot Légende apparaît quelque part »
    ferait du garde-fou un faux-positif sur n'importe quel tableau de contenu du corps — c'est
    le seul point où ce contrôle peut devenir pénible s'il est trop large."""
    return _premier_par_etiquette_bloc(tableau) is not None


LONGUEUR_ETIQUETTE_AVERT = 60


def _tronquer_etiquette(texte):
    """« Légende : Répartition des élèves » — ce qu'on colle dans la recherche de Word pour
    tomber sur le tableau, tronqué à une longueur raisonnable."""
    t = (texte or '').strip()
    return t if len(t) <= LONGUEUR_ETIQUETTE_AVERT else t[:LONGUEUR_ETIQUETTE_AVERT].rstrip() + '…'


def _repere_bloc_mal_forme(page, rang, etiquette):
    """(fr, de) — la phrase du garde-fou, avec ou sans page connue (voir Tableau.page : None
    quand elle n'est pas connaissable, jamais devinée). Sans page, la phrase démarre par le
    rang ; sans étiquette (ne devrait pas arriver — ressemble_a_un_bloc() vrai en a toujours
    trouvé une), la parenthèse ne s'ouvre que si une page l'exige. Jamais de « page None » ni
    de parenthèse vide, dans aucune des quatre combinaisons possibles."""
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
    fr = (tete_fr + " porte les étiquettes d'une figure ou d'un tableau, mais pas la forme "
          "attendue : ses légendes et textes alternatifs n'ont pas été lus. Vérifiez ce "
          "tableau dans le document, puis réimportez l'article.")
    de = (tete_de + ' trägt die Kennungen eines Abbildungs- oder Tabellenblocks, aber nicht '
          'in der erwarteten Form: ihre Legenden und Alternativtexte wurden nicht gelesen. '
          'Prüfen Sie diese Tabelle im Dokument und importieren Sie den Artikel neu.')
    return fr, de


def _avertir_bloc_mal_forme(tableau, rang, slug):
    """Émet l'avertissement `bloc-mal-forme` pour `tableau` (déjà su : ressemble_a_un_bloc()
    vrai, n_blocs_meta() nul), `rang` son rang 1-based parmi les tableaux de premier niveau du
    document — la même numérotation que « blocs-colles » (tableau %d). Le nouveau code
    d'avertissement du garde-fou du point 1 de l'en-tête (git log de ce chantier) : voir le
    point d'intégration au dialogue, plus bas, pour ce qu'il faudra faire au branchement."""
    par = _premier_par_etiquette_bloc(tableau)
    etiquette = _tronquer_etiquette(par.texte) if par else ''
    fr, de = _repere_bloc_mal_forme(tableau.page, rang, etiquette)
    champs = ['article « %s »' % slug, 'tableau %d' % rang]
    if tableau.page:
        champs.append('page %d' % tableau.page)
    if etiquette:
        champs.append('etiquette « %s »' % etiquette)
    avertir('bloc-mal-forme', champs, fr, de)


# ---------------------------------------------------------------------------------
# Point d'intégration du DIALOGUE pour `bloc-mal-forme` — PAS IMPLÉMENTÉ ICI (le lecteur
# Pronto n'est branché nulle part : pipeline/import-docx.sh appelle encore l'ancienne chaîne,
# et le cockpit est en plein chantier par un autre agent, interdit d'accès ici). Ce qui suit
# est ce qu'il faudra faire au branchement, lu dans les trois fichiers concernés (lecture
# seule, aucun n'est modifié par ce chantier) :
#
# 1. RIEN N'EST STRICTEMENT REQUIS pour que ce code s'affiche dans le panneau des contrôles.
#    La ligne « [import-avertissement] bloc-mal-forme | … | <fr> | [de] <de> » que avertir()
#    écrit ici suit exactement le format des codes déjà SANS entrée dédiée (bloc-contenu-
#    absent, auteur-etiquette-inconnue…) : lib/journal.js (analyserJournal -> lireConstatCode)
#    lui donne le ton « attention » par défaut — un code absent de TONS_IMPORT prend le ton du
#    préfixe « import-avertissement », jamais « danger » — et affiche notre phrase française
#    ou allemande TELLE QUELLE en repli (constat.brut, faute d'entrée dans CLES_IMPORT). Et
#    lib/constats.js (entree()/phrase()) fait de même quand aucune ligne 'import/bloc-mal-
#    forme' n'existe dans sa TABLE : gravite() rend 'avert' (ambre), phrase() rend
#    String(constat.brut). Le message bilingue de _repere_bloc_mal_forme() ci-dessus — qui
#    porte déjà la page, le rang et l'étiquette — est donc, à lui seul, ce qui s'affichera.
#
# 2. CE QUI MANQUE VRAIMENT, c'est la MODALE que la rédaction demande : contrairement à la
#    plupart des avertissements d'import, qui se lisent tranquillement dans le panneau des
#    contrôles, celui-ci mérite d'interrompre — la personne doit rouvrir son Word avant de
#    continuer, sans quoi elle publie en croyant une légende lue alors qu'elle ne l'est pas.
#    lib/import-hote.js pose déjà le point d'accroche naturel : lancerConversion() appelle,
#    après une compilation réussie et juste avant de rendre la main, `await
#    ctx.ouvrirImportVerif(fournisseur, rafraichirTout, nouveaux)` — `nouveaux` est la liste
#    des slugs fraîchement importés, et une modale de vérification y est DÉJÀ levée aujourd'hui
#    (l'implémentation réelle de ouvrirImportVerif est câblée par configurer(), dans
#    extension.js — hors de portée ici). Il faudra, à cet endroit précis :
#      a. relire le journal d'import pour les codes 'bloc-mal-forme' dont le slug est dans
#         `nouveaux` — lib/journal.js expose déjà analyserJournal() et slugsCompiles() pour ça,
#         qui rendent chacun un constat { source: 'import', code: 'bloc-mal-forme', slug, … } ;
#      b. faire dépendre l'ouverture (ou le contenu) de cette modale de leur présence, pour
#         qu'elle les distingue des autres avertissements — pas une ligne de plus dans une
#         liste qu'on referme sans lire, mais un état qui arrête la personne, puisque c'est
#         justement le silence que ce garde-fou existe pour casser.
#
# 3. SI un jour ces mêmes codes traversent aussi le RÉIMPORT (reimporter.py, dont la réponse
#    JSON est lue par constatsReimport() dans lib/journal.js), il faudra alors AJOUTER une
#    entrée CLES_IMPORT['bloc-mal-forme'] (et sa clé i18n) : constatsReimport() FILTRE déjà
#    tout code dont la clé est vide — « un code sans clé d'i18n ne doit donc pas donner une
#    carte muette — il est écarté » (commentaire de journal.js lui-même) — sans cette entrée,
#    l'avertissement de ce garde-fou disparaîtrait silencieusement sur CE chemin-là
#    précisément, l'exact silence qu'il existe pour empêcher. Le chemin d'import ORDINAIRE
#    (point 1 ci-dessus) n'a pas ce problème : il ne filtre rien par défaut.
#
# 4. Si une clé i18n et une ligne TABLE de lib/constats.js sont ajoutées malgré tout (pour
#    poser un bouton sur la carte) : rester barrage: null (rien n'est bloqué, le tableau reste
#    simplement imprimé, comme le dit le message) et nature: 'defaut'. `lieu: 'word'`
#    (LIEUX.word -> commande szh.vueWord, la seule vue d'où l'on redépose un Word corrigé)
#    conviendrait, mais SANS focusChamp : ce garde-fou ne pose pas de champ « fichier » dans
#    ses champs d'avertissement (seulement article/tableau/page/etiquette, voir
#    _avertir_bloc_mal_forme ci-dessus) — en poser un supposerait de faire aussi porter le nom
#    du Word source à avertir(), ce que ce module ne fait pas aujourd'hui.


def _avertir_etiquette_bloc_inconnue(etiquette, valeur, slug):
    """Partagé par l'ancienne forme (_champs_bloc_meta) et la nouvelle
    (_champs_bloc_meta_paragraphes) : même code, même message, quelle que soit la forme du
    bloc — c'est le point que le test différentiel vérifie."""
    avertir(
        'bloc-etiquette-inconnue',
        ['article « %s »' % slug, 'etiquette « %s »' % etiquette, 'valeur « %s »' % valeur],
        'Un bloc figure ou tableau de cet article porte une étiquette que le gabarit ne '
        'connaît pas : « %s » (valeur : « %s »). Le tableau reste imprimé dans le texte.'
        % (etiquette, valeur),
        'Ein Abbildungs- oder Tabellenblock dieses Artikels enthält eine der Vorlage '
        'unbekannte Bezeichnung: « %s » (Wert: « %s »). Die Tabelle bleibt im Text gedruckt.'
        % (etiquette, valeur))


def _lire_champ_bloc(texte):
    """(champ, etiquette, valeur) | (None, etiquette, valeur) | None — découpe UN paragraphe
    « Étiquette : valeur » ; None si `texte` ne porte pas de ':' du tout (paragraphe qui n'a
    simplement rien à dire — jamais un avertissement, voir les deux appelants)."""
    if not texte or ':' not in texte:
        return None
    etiquette, _, valeur = texte.partition(':')
    return LABELS_FIGURE.get(aplatir(etiquette)), etiquette, valeur.strip()


def _champs_bloc_meta(row0, slug):
    """(champs, consommee) — légende / texte alternatif / crédit / source lus sur TOUTES
    les cellules de la rangée 0, dans l'ordre. Ancienne forme (tableau enveloppe) ; voir
    _champs_bloc_meta_paragraphes() pour la nouvelle."""
    champs = {}
    consommee = True
    for tc in row0:
        for p in tc.blocs:
            if not isinstance(p, Par):
                continue
            if _style_par(p) == NOM_STYLE_AIDE:
                continue
            lu = _lire_champ_bloc(p.texte)
            if lu is None:
                if p.texte:
                    consommee = False
                continue
            champ, etiquette, valeur = lu
            if champ is None:
                consommee = False
                _avertir_etiquette_bloc_inconnue(etiquette, valeur, slug)
                continue
            if valeur:
                champs[champ] = valeur
    return champs, consommee


def _champs_bloc_meta_paragraphes(paragraphes, slug):
    """(champs, consommee) — même lecture que _champs_bloc_meta(), sur une liste de
    paragraphes SZH Cle Abb/Tab consécutifs (nouvelle forme, révision du 21.09.2026) au lieu
    d'une rangée de cellules : plus de tableau autour, mais la même règle « Étiquette : valeur »
    et le même avertissement en cas d'étiquette inconnue."""
    champs = {}
    consommee = True
    for p in paragraphes:
        lu = _lire_champ_bloc(p.texte)
        if lu is None:
            if p.texte:
                consommee = False
            continue
        champ, etiquette, valeur = lu
        if champ is None:
            consommee = False
            _avertir_etiquette_bloc_inconnue(etiquette, valeur, slug)
            continue
        if valeur:
            champs[champ] = valeur
    return champs, consommee


def _contenu_bloc(row1):
    """('table', Tableau imbriqué) si une cellule de la rangée 1 porte un tableau imbriqué
    DIRECT ; ('image', None) si une cellule y porte une image et qu'aucun tableau n'a été
    trouvé ; (None, None) sinon."""
    for tc in row1:
        tbl_interne = next((b for b in tc.blocs if isinstance(b, Tableau)), None)
        if tbl_interne is not None:
            return 'table', tbl_interne
    for tc in row1:
        if a_image_cellule(tc):
            return 'image', None
    return None, None


def extraire_bloc(tableau, slug, indice=0):
    """(nature, champs, consommee, tbl_interne) pour LA PAIRE de rangées n° `indice` (0 pour
    le premier bloc, 1 pour le second si deux blocs sont collés dans le même tableau, etc.)
    d'un tableau reconnu par est_bloc_meta()/n_blocs_meta() — l'ANCIENNE forme (tableau
    enveloppe). Voie de REPLI depuis le 21.09.2026 (décision de Robin) : un document rempli
    depuis maintenant emploie _extraire_blocs_nouvelle_forme() ; celle-ci reste pour lire les
    documents déjà remplis à l'ancienne forme, jamais retirée — voir principal(), qui pose
    l'avertissement 'bloc-ancienne-forme' quand ce chemin est emprunté."""
    row0, row1 = tableau.rangees[indice * 2], tableau.rangees[indice * 2 + 1]
    champs, consommee = _champs_bloc_meta(row0, slug)
    nature, tbl_interne = _contenu_bloc(row1)
    if nature is None:
        avertir(
            'bloc-contenu-absent',
            ['article « %s »' % slug, 'legende « %s »' % champs.get('legende', '')],
            'Un bloc de cet article annonce une légende (« %s ») mais sa rangée de '
            'contenu ne porte ni image ni tableau : le dépôt est resté vide. Complétez-le '
            'dans le document puis réimportez l\'article.' % champs.get('legende', ''),
            'Ein Block dieses Artikels kündigt eine Legende an (« %s »), aber seine '
            'Inhaltszeile trägt weder Bild noch Tabelle: die Ablage ist leer geblieben. '
            'Ergänzen Sie sie im Dokument und importieren Sie den Artikel neu.'
            % champs.get('legende', ''))
    return nature, champs, consommee, tbl_interne


# ---------------------------------------------------------------------------------
# Blocs figure/tableau — NOUVELLE forme (révision du 21.09.2026, décision de Robin) : 1 à 4
# paragraphes SZH Cle Abb/Tab consécutifs, suivis à 1 ou 2 paragraphes de distance (un
# paragraphe vide toléré entre les deux — une fausse manipulation courante) par un paragraphe
# qui porte une image, ou par un tableau. Plus de tableau enveloppe : la bordure du style
# dessine seule le cadre, à l'écriture (manuscrit_gabarit.py) comme à la lecture (ici, rien à
# faire de la bordure elle-même — seul le STYLE compte pour reconnaître le bloc).

def _cherche_contenu_bloc_nouvelle_forme(blocs, depart):
    """(indice, 'image'|'table') du contenu d'un bloc à `depart` (le premier indice APRÈS le
    groupe de clés), ou (None, None). La fenêtre ne dépasse JAMAIS 2 paragraphes : le contenu
    est cherché à `depart`, puis — SEULEMENT si ce premier paragraphe est vide (ni texte ni
    image, la fausse manipulation tolérée par le contrat) — à `depart + 1`. Un paragraphe de
    corps bien réel (du texte, mais ni image ni tableau) arrête la recherche NET : il n'est
    jamais traversé, même s'il reste un paragraphe de marge dans la fenêtre — ce qui rend une
    fenêtre de 3 paragraphes (deux vides puis le contenu) non reconnue, comme le veut le
    contrat."""
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
                continue                  # paragraphe vide toléré : on tente le suivant
        return None, None
    return None, None


def _avertir_cles_sans_contenu(champs, slug):
    legende = champs.get('legende', '')
    avertir(
        'bloc-cles-sans-contenu',
        ['article « %s »' % slug, 'legende « %s »' % legende],
        'Une ou plusieurs clés de figure ou de tableau (« Légende : », « Texte alternatif : »,'
        ' « Crédit : », « Source : ») ont été trouvées dans cet article, mais ni une image ni '
        'un tableau ne les suit dans les un ou deux paragraphes qui viennent juste après : '
        'rien n\'a été reconnu comme un bloc, ces paragraphes restent tels quels dans le '
        'texte. Vérifiez leur position par rapport à l\'image ou au tableau dans le document.',
        'In diesem Artikel wurden Schlüsselabsätze eines Abbildungs- oder Tabellenblocks '
        'gefunden (« Légende : », « Texte alternatif : », « Crédit : », « Source : »), aber '
        'weder ein Bild noch eine Tabelle folgt in den ein oder zwei Absätzen unmittelbar '
        'danach: nichts wurde als Block erkannt, diese Absätze bleiben unverändert im Text. '
        'Prüfen Sie ihre Position gegenüber dem Bild oder der Tabelle im Dokument.')


def _extraire_blocs_nouvelle_forme(blocs, table1_elem, table2_elem, slug):
    """Liste de dicts {'pos', 'nature', 'champs', 'consommee', 'tbl_interne'} — un par bloc
    figure/tableau à la NOUVELLE forme trouvé dans `blocs` (hors table1_elem/table2_elem, qui
    ne sont de toute façon jamais des Par et ne peuvent donc jamais démarrer un groupe de clés).
    `pos` est l'indice du PREMIER paragraphe de clé, dans `blocs` : il sert à `principal()` à
    fusionner cette liste avec celle de l'ancienne forme, dans l'ordre du document — jamais
    exposé dans stats['blocs'] (voir principal()), qui doit rendre la MÊME forme quelle que
    soit la forme d'entrée (c'est le test différentiel, pronto-gabarits.test.js)."""
    resultat = []
    n = len(blocs)
    i = 0
    while i < n:
        elem = blocs[i]
        if elem is table1_elem or elem is table2_elem or not _est_cle_bloc(elem):
            i += 1
            continue
        depart = i
        fin = depart
        while fin < n and fin - depart < 4 and _est_cle_bloc(blocs[fin]):
            fin += 1
        champs, consommee = _champs_bloc_meta_paragraphes(blocs[depart:fin], slug)
        idx_contenu, nature = _cherche_contenu_bloc_nouvelle_forme(blocs, fin)
        if nature is None:
            _avertir_cles_sans_contenu(champs, slug)
            i = fin                       # les paragraphes de clé restent tels quels
            continue
        resultat.append({'pos': depart, 'nature': nature, 'champs': champs,
                         'consommee': consommee, 'tbl_interne': nature == 'table'})
        i = idx_contenu + 1
    return resultat


# ---------------------------------------------------------------------------------
# Sérialisation YAML : même façon que docx-meta.py (citer(), même ordre de clés), MOINS le
# bloc des mots-clés — ce contrat n'en écrit jamais.

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
# Point d'entrée neutre : `blocs` est déjà un list[Par | Tableau] rendu par un lecteur.
# `chemin_source` sert seulement au champ `source` de la fiche (son basename) — voir
# l'en-tête d'origine.
#
# ⚠ POINT D'INTÉGRATION À DOCUMENTER, PAS À CORRIGER ICI (aucun fichier existant n'est
# modifié par ce chantier) : pipeline/docx-tables.py saute ENTIÈREMENT tout tableau de
# premier niveau consommé (lignes T de $SZH_META) et ne descend alors plus du tout dans ce
# tableau. tableaux_de_premier_niveau() ne compte pas les imbriqués comme des tableaux
# séparés. Résultat : le jour où ce fichier posera une ligne T sur un bloc TABLEAU (pas
# figure), le tableau interne qu'il enveloppe ne sera plus jamais visité par
# docx-tables.py — ni rendu à part, ni rendu dans son parent, puisque le parent entier est
# sauté. Il faudra alors soit apprendre à docx-tables.py à déballer un bloc consommé pour en
# extraire le tableau interne comme s'il était de premier niveau, soit distinguer « T de bloc
# figure » (à sauter entièrement) de « T de bloc tableau » (dont seule la rangée 0 doit
# disparaître). Ce fichier-ci ne le fait pas : il se contente de le dire.
#
# Aucun mot-clé n'est jamais écrit dans la fiche : ils sont choisis dans le cockpit, jamais
# lus dans le document.
#
# ── Ce que pandoc perd aujourd'hui, dans les deux formats (mesuré sur pandoc 3.5) ──────────
# `pandoc -f docx+styles` existe et enveloppe chaque paragraphe dans un Div portant
# `custom-style` = le nom du style Word. `pandoc -f odt+styles` N'EXISTE PAS : « The
# extension styles is not supported for odt ». Et SANS `+styles` — la chaîne actuelle
# (pipeline/import-docx.sh) ne l'emploie pas — les styles de corps du gabarit (« SZH
# Important », « SZH Hervorhebung », « SZH Question (interview) », « Quote ») sont perdus
# par pandoc, en .docx COMME en .odt : ils sortent en Para nu. Un auteur qui emploie un
# encadré « SZH Important » dans le gabarit le perd donc aujourd'hui en silence, dans les
# deux formats. Le jour où l'on voudra les conserver, ce sera au LECTEUR (qui, lui, voit les
# styles dans le XML source, via ce module neutre) d'émettre des instructions pour ces
# paragraphes — pas à `docx+styles`, qui n'a pas d'équivalent OpenDocument et créerait deux
# chaînes différentes selon le format déposé. NE PAS L'IMPLÉMENTER ICI : ce n'est pas
# demandé, et ce parser n'est branché nulle part.

def principal(blocs, chemin_source, slug, dossier):
    stats = {'slug': slug, 'avertissements': []}

    tables = [(idx, e) for idx, e in enumerate(blocs) if isinstance(e, Tableau)]

    table1_elem = tables[0][1] if len(tables) >= 1 else None
    table2_elem = tables[1][1] if len(tables) >= 2 else None

    valeurs = {'type': '', 'langue': '', 'titre': {}, 'soustitre': {}, 'resume': {}}
    table1_consommee = False
    if table1_elem is not None:
        valeurs, table1_consommee = extraire_table_metadonnees(table1_elem, slug)
    else:
        avertir(
            'structure-inattendue',
            ['article « %s »' % slug, 'tableau metadonnees'],
            "Le premier tableau attendu (métadonnées) est introuvable : ce document ne "
            "suit pas la forme du gabarit « Pronto — modèle d'article ». Rien n'a été "
            "lu automatiquement ; complétez « Métadonnées des articles » à la main.",
            'Die erste erwartete Tabelle (Metadaten) fehlt: dieses Dokument folgt nicht '
            'der Form der Vorlage «Pronto — Artikelmodell». Es wurde nichts '
            'automatisch gelesen; ergänzen Sie «Metadaten der Artikel» von Hand.')

    auteurs = []
    table2_consommee = False
    photos_connues = set()
    photos_appariees = []
    if table2_elem is not None:
        auteurs, table2_consommee, photos_connues, photos_appariees = \
            extraire_table_auteurs(table2_elem, slug)
    else:
        avertir(
            'structure-inattendue',
            ['article « %s »' % slug, 'tableau auteurs'],
            "Le second tableau attendu (autrices et auteurs) est introuvable : ce "
            "document ne suit pas la forme du gabarit « Pronto — modèle d'article ». "
            "Complétez « Métadonnées des articles » à la main.",
            'Die zweite erwartete Tabelle (Autorinnen und Autoren) fehlt: dieses Dokument '
            'folgt nicht der Form der Vorlage «Pronto — Artikelmodell». Ergänzen Sie '
            '«Metadaten der Artikel» von Hand.')

    blocs_figtab = []
    k_pleinement_consomme = {}
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
            'Le tableau %d de cet article utilise l\'ancienne forme de bloc figure ou tableau '
            '(un tableau à deux rangées) : il a été lu normalement, mais cette forme est '
            'dépassée depuis le 21.09.2026. Convertissez-le vers la nouvelle forme (quatre '
            'paragraphes « SZH Cle Abb/Tab » suivis de l\'image ou du tableau) au prochain '
            'remaniement du document.' % (k + 1),
            'Die Tabelle %d dieses Artikels verwendet die alte Form eines Abbildungs- oder '
            'Tabellenblocks (eine zweizeilige Tabelle): sie wurde normal gelesen, ist aber '
            'seit dem 21.09.2026 veraltet. Wandeln Sie sie bei der nächsten Überarbeitung des '
            'Dokuments in die neue Form um (vier Absätze «SZH Cle Abb/Tab», gefolgt vom Bild '
            'oder der Tabelle).' % (k + 1))
        if n_paires > 1:
            # Deux (ou plus) blocs collés, fusionnés en un seul tableau Word — voir
            # n_blocs_meta(). Ne concerne pas que les figures : deux tableaux voisins, ou un
            # tableau suivi d'une figure, fusionnent tout aussi silencieusement.
            avertir(
                'blocs-colles',
                ['article « %s »' % slug, 'tableau %d' % (k + 1), 'blocs %d' % n_paires],
                'Un tableau de cet article empile %d blocs figure ou tableau collés l\'un à '
                'l\'autre (%d rangées) : deux blocs copiés à la suite, sans paragraphe entre '
                'eux, ont fusionné en un seul tableau à la conversion. Les %d blocs ont '
                'quand même été reconnus séparément ; pour éviter ce piège, laissez une '
                'ligne vide entre deux blocs dans le Word.'
                % (n_paires, n_paires * 2, n_paires),
                'Eine Tabelle dieses Artikels stapelt %d aneinandergeklebte Abbildungs- oder '
                'Tabellenblöcke (%d Zeilen): zwei ohne Absatz dazwischen kopierte Blöcke '
                'sind bei der Konvertierung zu einer einzigen Tabelle verschmolzen. Die %d '
                'Blöcke wurden trotzdem einzeln erkannt; lassen Sie im Word künftig eine '
                'leere Zeile zwischen zwei Blöcken, um das zu vermeiden.'
                % (n_paires, n_paires * 2, n_paires))
        sous_consommees = []
        for p in range(n_paires):
            nature, champs, consommee, tbl_interne = extraire_bloc(tbl, slug, p)
            blocs_figtab.append({'pos': idx_bloc, 'k': k, 'nature': nature, 'champs': champs,
                                 'consommee': consommee,
                                 'tbl_interne': tbl_interne is not None})
            sous_consommees.append(consommee)
        k_pleinement_consomme[k] = all(sous_consommees)

    # Nouvelle forme (révision du 21.09.2026) : jamais de tableau enveloppe, donc jamais rien
    # à ajouter à `tables_consommees` — il n'y a pas de tableau à faire sauter par la chaîne
    # d'import pour un bloc figure (le contenu est un simple paragraphe), et le tableau d'un
    # bloc tableau, n'étant plus imbriqué dans une enveloppe, n'a lui non plus RIEN à faire
    # sauter : il doit se rendre comme n'importe quel tableau de contenu ordinaire. C'est une
    # différence assumée avec l'ancienne forme (voir TODO-BRANCHEMENT-PARSER-V2.md, révision du
    # 21.09.2026) — stats['blocs'], lui, reste identique quelle que soit la forme d'entrée.
    blocs_nouvelle_forme = _extraire_blocs_nouvelle_forme(blocs, table1_elem, table2_elem, slug)
    blocs_figtab = sorted(blocs_figtab + blocs_nouvelle_forme, key=lambda b: b['pos'])

    tables_consommees = []
    for k, (idx_bloc, tbl) in enumerate(tables):
        if tbl is table1_elem and table1_consommee:
            tables_consommees.append(k + 1)
        elif tbl is table2_elem and table2_consommee:
            tables_consommees.append(k + 1)
        elif k_pleinement_consomme.get(k):
            tables_consommees.append(k + 1)

    type_article = valeurs['type'] if valeurs['type'] in TYPES_VALIDES else ''
    langue = valeurs['langue'] if valeurs['langue'] in LANGUES_META else ''
    langue_deduite = not langue

    lignes_b, ligne_bt, biblio = etendue_biblio(blocs, type_article or 'article', slug)

    meta = {
        'type': type_article,
        'lang': langue or 'fr',
        'source': os.path.basename(chemin_source),
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
            with open(chemin_meta_yaml, 'w', encoding='utf-8', newline='\n') as f:
                f.write(contenu)
            meta_ecrit = True

    if meta_ecrit and langue_deduite:
        avertir(
            'langue-deduite',
            ['article « %s »' % slug, 'langue « %s »' % meta['lang']],
            "La langue de cet article n'était pas indiquée dans le document : elle a "
            "été devinée. Vérifiez-la dans « Métadonnées des articles » : la maquette "
            "et les résumés en dépendent.",
            'Die Sprache dieses Artikels stand nicht im Dokument: sie wurde erraten. '
            'Prüfen Sie sie unter « Metadaten der Artikel » — Layout und '
            'Zusammenfassungen richten sich danach.')

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
            if ligne_bt:
                f.write('BT\t%s\n' % ligne_bt)
            for t in lignes_b:
                f.write('B\t%s\n' % t)

    stats.update({
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
        'biblio': biblio,
        'meta_ecrit': meta_ecrit,
    })
    return stats
