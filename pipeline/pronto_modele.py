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
#                                          vaut 1..6 pour un titre, 0 sinon. `images` est une
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

import difflib
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
    `texte` le texte déjà normalisé (normaliser()), `niveau` 1..6 pour un titre (0 sinon),
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


# La langue d'un article ne se lit PLUS dans le document (décision de Robin, 22.09.2026 : le
# champ « Langue de l'article » a quitté le tableau des métadonnées du gabarit) : elle vient du
# PRODUIT du numéro, comme partout ailleurs dans la chaîne — Revue suisse de pédagogie
# spécialisée -> fr, Schweizerische Zeitschrift für Heilpädagogik -> de. Même règle et mêmes
# jetons que derive_revue() de szh-maquette.lua et langue_de() de szh-rubrique.lua : le jeton
# canonique (« revue », « zeitschrift ») comme le nom complet de l'ancien ausgabe.yaml. Un
# article italien ne peut pas se déclarer dans le gabarit ; il se corrige à la main dans
# « Métadonnées des articles » après l'import, ce que la rédaction a explicitement accepté.
def langue_du_produit(produit):
    """'fr' | 'de' | '' — '' quand le produit est inconnu (clé `revue:` absente d'ausgabe.yaml,
    lecteur appelé hors d'un numéro) : c'est alors à l'appelant de décider du repli, et de le
    dire."""
    v = (produit or '').strip().lower()
    if 'zeitschrift' in v:
        return 'de'
    if 'revue' in v:
        return 'fr'
    return ''
# HUIT champs, `ror` compris : aligné sur CHAMPS_AUTEUR de lib/yaml.js (cockpit), PAS sur
# celui de docx-meta.py, qui ne porte pas `ror` — voir l'en-tête d'origine de docx-pronto.py
# (git log) : ce n'était pas un contrat à imiter, c'était l'absence de ce champ sur les Word
# hérités que docx-meta.py doit encore lire.
CHAMPS_AUTEUR = ('prenom', 'nom', 'fonction', 'affiliation', 'ror', 'orcid', 'email', 'photo')

# Les styles qui SIGNENT le gabarit, en minuscules (les deux lecteurs rendent des noms déjà
# minusculés). C'est sur eux que pipeline/import-docx.sh décide, document par document, si le
# lecteur Pronto ou l'ancien docx-meta.py lit ce qu'on vient de déposer — voir
# pronto_docx.est_pronto() pour le détail du critère et pourquoi les DEUX sont exigés.
STYLES_GABARIT = ('szh cle', 'szh aide')
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

# 1 à 6, et non 1 à 3 : le gabarit porte un rang 4 depuis sa v3 (22.09.2026), et famille()
# classait DÉJÀ « Titre 4 » en 'heading' (son motif accepte n'importe quel chiffre) — les deux
# se contredisaient. La borne à 6 est celle de szh-niveaux.lua, qui compacte le corps entre
# <h2> et <h6> : au-delà, pandoc dégraderait le titre en paragraphe, il n'y a donc rien à
# reconnaître.
RE_NIVEAU_TITRE = re.compile(r'^(?:heading|titre|titolo|berschrift)\s*([1-6])\b', re.I)


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
    """Niveau de titre 1..6 déduit du nom de style résolu, 0 sinon. Utilisé par LES DEUX
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
        # Tous les rangs de titre, pas seulement les trois premiers : une bibliographie
        # intitulée en rang 4 reste une bibliographie. C'est le LEXIQUE des titres qui
        # tranche, jamais le rang.
        if not isinstance(e, Par) or not e.texte or not e.niveau:
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
# Étiquettes du gabarit — reconnues avec un SCORE de proximité (voir « clés tolérantes »
# ci-dessous), jamais en comparant seulement leur forme aplatie : aplatir() (plus haut) retire
# TOUS les accents, donc « Resumé » et « Résumé » lui donnent déjà la MÊME clé, sans le moindre
# écart mesurable — exactement le silence qu'un score doit remplacer par un avertissement.

RE_SUFFIXE_LANGUE = re.compile(r'\s*\((fr|de|it)\)\s*$', re.I)

VALEURS_TYPE = {
    aplatir('dossier thématique'): 'article',
    aplatir('éditorial'): 'editorial',
    aplatir('edito'): 'editorial',
    aplatir('entretien'): 'interview',
    aplatir('varia'): 'varia',
    aplatir('tribune libre'): 'tribune-libre',
}
VALEURS_TYPE_CANONIQUES = {aplatir(t): t for t in TYPES_VALIDES}
# (Il n'y a plus de VALEURS_LANGUE : la valeur du champ « Langue de l'article » n'est plus
# interprétée du tout depuis le 22.09.2026 — voir langue_du_produit().)


# ---------------------------------------------------------------------------------
# Clés tolérantes : une étiquette mal tapée (accent oublié, espace changée, variante de mot,
# casse, deux-points en trop, pluriel) est reconnue avec un score de proximité contre les
# clés attendues de CANON_METADONNEES / CANON_AUTEUR / CANON_FIGURE — jamais en silence quand
# il a fallu tolérer quelque chose (voir identifier_cle()). La VALEUR d'une clé n'est JAMAIS
# comparée ici — seule l'étiquette l'est.

SEUIL_CLE = 0.75
# Trois valeurs successives, et chacune a été MESURÉE avant d'être posée.
#
# 0,85 (d'abord envisagée) : « Resumé » (un accent oublié, 0,833) et « Prenom » (0,833)
# restaient dehors — l'inverse de ce que la tolérance devait apporter.
# 0,80 : les admettait, avec les deux négatifs mesurés loin en dessous — « Résultats » (0,571
# contre Résumé) et « Nom de la revue » (0,400 contre Nom).
# 0,75 (décision de Robin, 22.09.2026) : mesurée sur 75 étiquettes (les vraies, des fautes de
# frappe plausibles, et des étiquettes qui doivent rester inconnues). **74 verdicts sur 75 sont
# identiques à 0,80** ; le seul qui change est un gain : « Prenoom » (0,769) devient `prenom`.
# AUCUNE étiquette ne part sur une mauvaise clé, AUCUNE de celles qui doivent rester inconnues
# ne passe la barre — la plus haute d'entre elles plafonne à 0,615 (« Photo » contre Fonction),
# ce qui laisse 0,135 de marge.
#
# ⚠ CE QUE LE SEUIL NE RATTRAPE PAS, et qu'il ne faut pas essayer de rattraper en le baissant
#   encore : une étiquette tapée SANS AUCUN accent quand la forme canonique en porte deux.
#   Mesuré AVANT les alias : « Resume » contre Résumé = 0,667, « Legandes » contre Légende =
#   0,714 — tous deux refusés, donc tous deux refusant l'import. Descendre à 0,65 pour les
#   admettre n'aurait laissé que 0,035 de marge au-dessus du premier faux positif : le
#   mécanisme serait devenu un tirage au sort. La réponse a donc été un jeu d'ALIAS explicites
#   dans les tables CANON_* (voir leur commentaire), et ces deux cas se lisent désormais 1,000
#   et 0,857. Refaire ce choix à chaque cas nouveau : un alias, jamais un seuil plus bas.
#
# ⚠ MARGE RESTANTE. Elle était mince : « Adresse » (une adresse postale) arrivait à 0,737
#   contre `email`, tirée par l'alias allemand « e-mail-adresse » — 0,013 sous le seuil, une
#   adresse postale à un cheveu du champ e-mail. La réponse n'a été ni le seuil ni un alias mais
#   une DÉCLARATION : « Adresse », comme « Biographie », « Téléphone » et « Photo », est
#   maintenant une clé reconnue SANS DESTINATION (CLES_AUTEUR_SANS_DESTINATION), donc à 1,000
#   sur elle-même et hors de toute concurrence. La plus proche étiquette étrangère restante
#   plafonne à 0,667, soit 0,083 de marge. Un contrôle la tient (test/js/pronto-lire.test.js,
#   « une étiquette étrangère au gabarit reste sous le seuil, avec de la marge ») et dit, quand
#   il tombe, laquelle des deux issues employer.
ECART_CLE = 0.08
LONGUEUR_ETIQUETTE_SCORE = 40  # au-delà, ce n'est plus une étiquette : jamais scoré (garde-fou).


def normaliser_cle(texte):
    """Étiquette prête à comparer à une clé attendue : espaces (déjà uniformisées par
    normaliser()) et ponctuation de repli retirées, minuscules, pluriel final toléré — les
    ACCENTS SONT CONSERVÉS (contrairement à aplatir()) : c'est justement l'écart d'accent que
    le score doit mesurer, pas l'effacer avant de mesurer."""
    t = normaliser(texte or '').lower()
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
    """Pour le test D'EXACTITUDE UNIQUEMENT (jamais pour le score) : espaces uniformisées par
    normaliser(), apostrophe courbe assimilée à l'apostrophe droite (les deux sortent du même
    clavier selon le correcteur automatique de l'autrice ou de l'auteur, jamais une faute à
    signaler — le gabarit réel écrit « d'article » à l'apostrophe courbe), casse ignorée."""
    return normaliser(t or '').replace('’', "'").casefold()


def identifier_cle(etiquette, table):
    """Résout `etiquette` (déjà débarrassée d'un éventuel suffixe de langue) contre les clés
    canoniques de `table` — un dict jeton -> (forme canonique affichée, alias...), la forme
    canonique étant toujours en position 0. Rend :
      - None si `etiquette` est vide, trop longue pour être une clé (LONGUEUR_ETIQUETTE_SCORE
        — la VALEUR d'un champ ne doit jamais être scorée), ou si aucune clé n'atteint
        SEUIL_CLE (clé inconnue, comme avant ce mécanisme) ;
      - ('__ambigu__', jeton1, jeton2, score1, score2) si les deux meilleures clés sont à moins
        de ECART_CLE l'une de l'autre : aucune n'est retenue ;
      - (jeton, score, exact) sinon. `exact` ne vaut vrai que si `etiquette` est égale à LA
        FORME CANONIQUE elle-même (espaces et casse ignorées) — un alias reconnu à 100 %
        (« E-mail » pour Email) n'est pas « le gabarit tapé juste », il doit donc avertir
        aussi."""
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
    exact = _sans_fioritures(etiquette) == _sans_fioritures(table[meilleur_jeton][0])
    return (meilleur_jeton, meilleur_score, exact)


def _avertir_cle_approximee(brute, table, jeton, score, slug, lieu):
    canonique = table[jeton][0]
    avertir(
        'cle-approximee',
        ['article « %s »' % slug, 'lieu « %s »' % lieu, 'clé « %s »' % brute,
         'reconnue « %s »' % canonique, 'proximite %.2f' % score],
        'Clé « %s » lue comme « %s » (proximité %.2f). Corrigez l\'étiquette dans le document '
        'si ce n\'était pas voulu.' % (brute, canonique, score),
        'Schlüssel « %s » als « %s » gelesen (Ähnlichkeit %.2f). Korrigieren Sie die '
        'Bezeichnung im Dokument, falls das nicht beabsichtigt war.' % (brute, canonique, score))


def _avertir_cle_ambigue(brute, table, jeton1, jeton2, slug, lieu):
    c1, c2 = table[jeton1][0], table[jeton2][0]
    avertir(
        'cle-ambigue',
        ['article « %s »' % slug, 'lieu « %s »' % lieu, 'clé « %s »' % brute],
        'La clé « %s » est ambiguë : elle ressemble presque autant à « %s » qu\'à « %s ». '
        'Aucune des deux n\'a été retenue, et l\'article n\'a PAS été importé : rien n\'a été '
        'créé, et le fichier Word reste en attente. Réécrivez l\'étiquette exactement comme '
        'dans le gabarit, puis enregistrez.' % (brute, c1, c2),
        'Der Schlüssel « %s » ist mehrdeutig: er ähnelt « %s » fast ebenso stark wie « %s ». '
        'Keiner von beiden wurde übernommen, und der Artikel wurde NICHT importiert: es wurde '
        'nichts angelegt, und die Word-Datei bleibt in der Warteschlange. Schreiben Sie die '
        'Bezeichnung genau wie in der Vorlage und speichern Sie.' % (brute, c1, c2))


def resoudre_cle(etiquette, table, slug, lieu, bloquants=None):
    """identifier_cle() + les avertissements qui vont avec : rend le jeton reconnu, ou None
    (clé inconnue OU ambiguë — dans les deux cas, rien n'est retenu, à l'appelant de se
    comporter comme si l'étiquette n'était reconnue par rien).

    N'est appelé par les trois lieux QUE lorsque la valeur associée n'est PAS vide (voir le
    garde-fou posé chez chaque appelant : une clé présente mais vide est traitée comme absente,
    jamais comme une clé « non reconnue » — § cle-attendue-absente). Une clé introuvable ou
    ambiguë est donc, par construction, une clé PRÉSENTE avec un contenu réel qu'on ne saurait
    pas où ranger : si `bloquants` est fourni (list), une entrée {'texte', 'lieu'} y est
    ajoutée — c'est ce qui fait échouer tout l'import, voir principal() et GRAVITE_CODES."""
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
# Gravité des codes émis par CE lecteur — indépendante de tout ce que le cockpit décidera plus
# tard (TONS_IMPORT de lib/journal.js : hors de portée ici, le cockpit n'est branché nulle
# part). Sert uniquement à pronto-lire.py pour décider si l'import doit échouer.
#
# GRAVITE_BLOQUANT : une clé PRÉSENTE (valeur non vide) n'a pu être rangée nulle part — son
# contenu serait perdu si l'import continuait. « etiquette-metadonnees-inconnue »,
# « auteur-etiquette-inconnue », « bloc-etiquette-inconnue » et « cle-ambigue » en sont : un
# document qui en déclenche un ne s'importe pas — principal() n'écrit alors ni meta.yaml, ni
# les instructions $SZH_META/$SZH_PHOTOS ; pronto-lire.py sort en échec (voir stats['bloquant']
# / stats['cles_non_reconnues'], alimentées par resoudre_cle() ci-dessus, ainsi que par
# extraire_table_metadonnees() pour le seul cas qu'il ne couvre pas — une clé RECONNUE mais
# sans destination, motscles ou langue manquante).
# GRAVITE_INFO : une clé attendue n'a rien à ranger (absente ou vide) — jamais bloquant.
# GRAVITE_AVERT : tout le reste, y compris « cle-approximee » — un avertissement ordinaire,
# comme avant ce mécanisme.
GRAVITE_BLOQUANT = 'bloquant'
GRAVITE_INFO = 'info'
GRAVITE_AVERT = 'avert'

GRAVITE_CODES = {
    'etiquette-metadonnees-inconnue': GRAVITE_BLOQUANT,
    'auteur-etiquette-inconnue': GRAVITE_BLOQUANT,
    'auteur-champ-hors-gabarit': GRAVITE_BLOQUANT,
    'bloc-etiquette-inconnue': GRAVITE_BLOQUANT,
    'cle-ambigue': GRAVITE_BLOQUANT,
    'cle-attendue-absente': GRAVITE_INFO,
    'cle-approximee': GRAVITE_AVERT,
}


def _avertir_cle_attendue_absente(canonique, slug, lieu):
    avertir(
        'cle-attendue-absente',
        ['article « %s »' % slug, 'lieu « %s »' % lieu, 'clé « %s »' % canonique],
        'Le champ « %s » attendu par le gabarit n\'a pas été trouvé, ou a été laissé vide : '
        'rien n\'est perdu, mais rien n\'a été rempli non plus.' % canonique,
        'Das von der Vorlage erwartete Feld « %s » wurde nicht gefunden oder leer gelassen: '
        'es geht nichts verloren, aber es wurde auch nichts ausgefüllt.' % canonique)


def _avertir_cles_attendues_absentes(table, jetons_attendus, cles_vues, slug, lieu):
    """Une info `cle-attendue-absente` par clé de `jetons_attendus` qui n'a jamais reçu de
    valeur (`cles_vues`) — une clé présente mais laissée vide compte comme absente ici : les
    trois appelants n'ajoutent JAMAIS à `cles_vues` une clé dont la valeur était vide."""
    for jeton in jetons_attendus:
        if jeton not in cles_vues:
            _avertir_cle_attendue_absente(table[jeton][0], slug, lieu)


# PAS motscles (voir CANON_METADONNEES), et PLUS langue depuis le 22.09.2026 : le champ a quitté
# le gabarit, son absence est donc la normale et n'a plus rien à signaler. Sa clé reste
# reconnaissable dans CANON_METADONNEES — un document rempli avant ce jour en porte encore une,
# et une clé PRÉSENTE non reconnue bloquerait tout l'import.
CLES_METADONNEES_ATTENDUES = ('type', 'titre', 'soustitre', 'resume')


CANON_METADONNEES = {
    # Les ALIAS ne sont pas de la décoration : chaque forme listée ici est comparée au score
    # maximum (voir identifier_cle), donc une étiquette qui tombe sur un alias est reconnue à
    # coup sûr, là où le seul seuil de proximité l'aurait laissée dehors — et c'est là qu'un
    # faux négatif coûte le plus cher, puisqu'une clé présente non reconnue REFUSE l'import.
    # Trois familles, posées le 22.09.2026 :
    #   * la forme SANS ACCENT de chaque forme canonique accentuée (« resume », « legende »,
    #     « prenom », « credit ») — perdre deux accents fait tomber le score sous le seuil, et
    #     baisser le seuil jusqu'à les rattraper supprimerait la marge (voir SEUIL_CLE) ;
    #   * les synonymes que la rédaction tape par réflexe (« Copyright », « Droits »,
    #     « Description », « Provenance », « Poste », « Adresse e-mail »…) ;
    #   * l'italien, aux côtés du français et de l'allemand déjà présents — la revue publie des
    #     articles italiens, même s'ils se corrigent à la main après l'import.
    # Un alias reconnu n'est JAMAIS silencieux : `exact` ne compare qu'à la forme canonique
    # (position 0), donc tout ce qui n'est pas tapé comme le gabarit avertit (cle-approximee).
    # ⚠ PAS d'alias « rubrique » ici, quoi qu'en dise l'intuition : dans la maison, une rubrique
    #   n'est pas un type d'article (voir szh-rubrique.lua). L'alias a été posé, mesuré — il
    #   faisait entrer « Rubrique » sur `type` avec un score de 1,000 — et retiré.
    'type': ("Type d'article", 'type', 'artikeltyp', 'tipo di articolo'),
    # Champ RETIRÉ du gabarit le 22.09.2026 : sa valeur n'est plus lue (la langue vient du
    # produit, voir langue_du_produit()), mais sa clé reste reconnue pour que le tableau d'un
    # document rempli avant ce jour ne bloque pas l'import — il avertit, voir la branche
    # 'langue' d'extraire_table_metadonnees().
    'langue': ("Langue de l'article", 'langue', 'sprache', 'language'),
    'titre': ('Titre', 'title', 'titel', 'titolo', 'titre de l\'article'),
    'soustitre': ('Sous-titre', 'sous titre', 'soustitre', 'subtitle', 'untertitel',
                  'sottotitolo'),
    'resume': ('Résumé', 'resume', 'abstract', 'zusammenfassung', 'riassunto',
               'résumé de l\'article'),
    # Décision prise seul (Robin absent) : le gabarit ne définit AUCUN champ « Mots-clés » —
    # voir serialiser_meta(), les mots-clés sont choisis dans le cockpit, jamais lus dans le
    # document, et ÇA NE CHANGE PAS ICI. Gardée quand même reconnaissable (la demande la cite
    # explicitement, et la rédaction tape parfois ce champ par réflexe, venu d'un autre
    # gabarit) : reconnue -> avertit « cle-approximee » (dit qu'on a compris l'intention), mais
    # ne rejoint aucune branche de dispatch dans extraire_table_metadonnees() -> avertit AUSSI
    # 'etiquette-metadonnees-inconnue', comme n'importe quelle étiquette sans destination. Les
    # deux avertissements ensemble disent exactement ce qui s'est passé : compris, mais gardé
    # nulle part.
    'motscles': ('Mots-clés', 'mots cles', 'mots clefs', 'keywords', 'schlagworter',
                 'schlusselworter', 'schlagwörter', 'schlüsselwörter'),
}

CANON_AUTEUR = {
    'prenom': ('Prénom', 'prenom', 'first name', 'firstname', 'vorname', 'nome'),
    'nom': ('Nom', 'name', 'nachname', 'last name', 'lastname', 'surname',
            'nom de famille', 'familienname', 'cognome'),
    'fonction': ('Fonction', 'position', 'funktion', 'poste', 'rôle', 'role', 'funzione',
                 'titre et fonction'),
    'affiliation': ('Institution', 'affiliation', 'institution / organisation', 'organisation',
                    'établissement', 'etablissement', 'einrichtung', 'istituzione'),
    'ror': ('ROR', 'ror id', 'identifiant ror'),
    'orcid': ('ORCID', 'orcid id', 'identifiant orcid'),
    # ⚠ « adresse mail » a été posé, mesuré, puis retiré : il faisait entrer « Adresse » (une
    #   adresse postale) sur `email` avec 0,778. « adresse e-mail », plus long, laisse
    #   « Adresse » à 0,737 — sous le seuil, donc dehors, ce qui est le bon verdict.
    'email': ('Email', 'e-mail', 'courriel', 'mail', 'adresse e-mail', 'e-mail-adresse'),
    # ── Champs que le gabarit NE PORTE PAS, déclarés exprès ────────────────────────────
    # Même procédé que « Mots-clés » dans CANON_METADONNEES : une clé qu'on sait que la
    # rédaction tape, reconnue pour qu'elle ne soit JAMAIS confondue avec un vrai champ, mais
    # sans destination — elle refuse donc l'import, avec un message qui dit ce qu'il en est
    # (voir CLES_AUTEUR_SANS_DESTINATION et _avertir_champ_hors_gabarit()).
    #
    # Ce n'est pas de la politesse : « Adresse » arrivait à 0,737 contre `email`, tirée par
    # l'alias allemand « e-mail-adresse », soit 0,013 sous le seuil. Une adresse postale à
    # 0,013 de finir dans le champ e-mail, c'est un tirage au sort qui attend son tour.
    # Déclarée, elle se reconnaît elle-même à 1,000 et la question ne se pose plus.
    'adresse': ('Adresse', 'adresse postale', 'anschrift'),
    'biographie': ('Biographie', 'notice biographique', 'bio', 'kurzbiografie'),
    'telephone': ('Téléphone', 'telephone', 'tél', 'tel', 'telefon'),
    'photo': ('Photo', 'portrait', 'foto', 'bild'),
}

# Les clés de CANON_AUTEUR qui n'ont pas de champ où aller. Tenue à part de la table plutôt
# que devinée (« tout ce qui n'est pas dans CHAMPS_AUTEUR ») : la liste se lit d'un regard, et
# ajouter une clé reconnue sans la ranger ici deviendrait une valeur perdue en silence.
CLES_AUTEUR_SANS_DESTINATION = ('adresse', 'biographie', 'telephone', 'photo')

# Ce qu'il faut faire, par champ, quand il n'a pas de place dans le gabarit. Le cas de la photo
# est le seul qui ait une VRAIE destination dans le document : la cellule de gauche.
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
    'legende': ('Légende', 'legende', 'caption', 'bildunterschrift', 'abbildung',
                'légende de la figure', 'didascalia'),
    'alt': ('Texte alternatif', 'texte alternatif', 'alt', 'alternativtext', 'alt text',
            'description', 'texte de remplacement', 'testo alternativo'),
    'credit': ('Crédit', 'credit', 'crédit photo', 'credit photo', 'photo credit', 'copyright',
               'droits', 'bildnachweis', 'credito'),
    'source': ('Source', 'quelle', 'provenance', 'fonte'),
}


# ---------------------------------------------------------------------------------
# Tableau 1 — métadonnées de l'article.

def _etiquette_szh_cle(cellule):
    """Texte des paragraphes de style SZH Cle d'une cellule, joints par un espace (il n'y en a
    normalement qu'un). Ne regarde que les Par directs de la cellule — un bloc n'a jamais de
    tableau imbriqué dans une cellule d'étiquette.

    Correction du 22.09.2026 : ne retient que le style SZH Cle — la version précédente
    acceptait n'importe quel paragraphe pourvu qu'il ne soit pas SZH Aide, ce qui faisait
    lire comme une « étiquette » la première colonne d'un tableau de contenu ORDINAIRE pris
    pour le tableau des métadonnées par la seule coïncidence de sa position en tête de
    document (piège déjà documenté dans TODO-BRANCHEMENT-PARSER-V2.md, « Les deux premiers
    tableaux sont pris PAR POSITION »). Mesuré sur tmp/corpus-relecture/lot-A (11 manuscrits
    réels, aucun au gabarit) : 3 documents sur 11 voyaient leur véritable tableau de données
    pris pour celui des métadonnées ; depuis qu'une clé présente mais non reconnue bloque tout
    l'import (§ clés bloquantes), ce piège serait devenu bien plus grave qu'un simple
    avertissement — d'où cette correction, au même endroit que le mécanisme qui la rendait
    dangereuse."""
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
    — les trois derniers étant des dict langue -> texte. `bloquants`, si fourni (list), reçoit
    une entrée {'texte', 'lieu'} pour chaque clé PRÉSENTE (valeur non vide) mais non reconnue,
    ou reconnue sans destination — voir resoudre_cle() et principal()."""
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
                    "Le champ « Type d'article » du tableau des métadonnées porte une "
                    'valeur que le gabarit ne reconnaît pas : « %s ». Le type n\'a pas '
                    'été rempli dans la fiche ; choisissez-le dans « Métadonnées des '
                    'articles ».' % valeur,
                    'Das Feld «Type d\'article» der Metadatentabelle enthält einen von '
                    'der Vorlage nicht erkannten Wert: « %s ». Der Typ wurde in den '
                    'Metadaten nicht gesetzt; wählen Sie ihn unter «Metadaten der '
                    'Artikel».' % valeur)
        elif jeton == 'langue':
            # Le champ a quitté le gabarit le 22.09.2026 et sa valeur n'est PLUS lue : la
            # langue vient du produit du numéro. Ne rien dire ferait sortir un article
            # italien en français sans que personne ne l'apprenne — d'où cette information,
            # qui nomme la seule voie restante.
            cles_vues.add('langue')
            avertir(
                'langue-du-document-ignoree',
                ['article « %s »' % slug, 'valeur « %s »' % valeur],
                'Le tableau des métadonnées de cet article porte encore un champ « Langue '
                'de l\'article » (« %s ») : il n\'est plus lu. La langue vient désormais de '
                'la revue du numéro — Revue en français, Zeitschrift en allemand. Si cet '
                'article est dans une autre langue, corrigez-la dans « Métadonnées des '
                'articles » ; vous pouvez retirer ce champ du document.' % valeur,
                'Die Metadatentabelle dieses Artikels enthält noch ein Feld « Langue de '
                'l\'article » (« %s »): es wird nicht mehr gelesen. Die Sprache ergibt sich '
                'jetzt aus der Zeitschrift der Ausgabe — Revue auf Französisch, Zeitschrift '
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
        else:
            consommee = False
            avertir(
                'etiquette-metadonnees-inconnue',
                ['article « %s »' % slug, 'etiquette « %s »' % etiquette,
                 'valeur « %s »' % valeur],
                'Le tableau des métadonnées de cet article porte une étiquette que le '
                'gabarit ne connaît pas : « %s » (valeur : « %s »). L\'article n\'a PAS '
                'été importé, pour ne pas perdre cette valeur : rien n\'a été créé, et le '
                'fichier Word reste en attente. Corrigez l\'étiquette dans le document, '
                'puis enregistrez.' % (etiquette, valeur),
                'Die Metadatentabelle dieses Artikels enthält eine der Vorlage '
                'unbekannte Bezeichnung: « %s » (Wert: « %s »). Der Artikel wurde NICHT '
                'importiert, damit dieser Wert nicht verloren geht: es wurde nichts '
                'angelegt, und die Word-Datei bleibt in der Warteschlange. Korrigieren Sie '
                'die Bezeichnung im Dokument und speichern Sie.' % (etiquette, valeur))
            if jeton is not None and bloquants is not None:
                # Résolu (motscles, ou langue manquante pour titre/sous-titre/résumé) mais
                # sans branche de dispatch : resoudre_cle() n'a rien ajouté à bloquants pour
                # ce cas précis (il n'a rien trouvé d'anormal), c'est ici qu'il faut le faire —
                # le contenu réel de cette rangée serait perdu si l'import continuait.
                bloquants.append({'texte': etiquette, 'lieu': 'tableau metadonnees'})
    _avertir_cles_attendues_absentes(CANON_METADONNEES, CLES_METADONNEES_ATTENDUES, cles_vues,
                                      slug, 'tableau metadonnees')
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


def extraire_table_auteurs(tableau, slug, bloquants=None):
    """(auteurs, consommee, photos_connues, photos_appariees). `bloquants`, si fourni (list),
    reçoit une entrée par clé PRÉSENTE (valeur non vide) mais non reconnue — voir
    resoudre_cle()."""
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
            # Correction du 22.09.2026 (même raison qu'_etiquette_szh_cle()) : seul le style
            # SZH Cle est un candidat « Étiquette : valeur » — sinon le second tableau d'un
            # document ORDINAIRE (jamais au gabarit), pris pour celui des auteurs par sa seule
            # position, verrait n'importe laquelle de ses lignes à deux-points comparée à une
            # clé, avec le risque de bloquer tout l'import pour un faux positif.
            if _style_par(p) != NOM_STYLE_CLE:
                continue
            texte = p.texte
            if not texte:
                continue
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
                # Champ RECONNU, mais que le gabarit ne porte pas : le schéma d'auteur n'a ni
                # adresse, ni biographie, ni téléphone, et la photo se dépose dans la cellule
                # de gauche. Bloquant comme une étiquette inconnue — sa valeur serait perdue —
                # mais avec un message qui dit la vérité, et surtout : reconnu, donc plus
                # jamais en concurrence de proximité avec un vrai champ (voir SEUIL_CLE, la
                # marge de 0,013 que « Adresse » frôlait contre Email avant cette déclaration).
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
        # Deux causes distinctes pour `ligne_ok` à faux, et un seul message ne peut pas dire
        # les deux : une ligne qu'on n'a PAS reconnue (ci-dessous), et un champ parfaitement
        # reconnu mais que le gabarit ne porte pas (déjà dit par _avertir_champ_hors_gabarit()).
        # D'où la condition sur `lignes_inconnues` et non sur `ligne_ok` : annoncer une
        # « étiquette inconnue » pour « Adresse : … » enverrait corriger une orthographe juste.
        if lignes_inconnues:
            avertir(
                'auteur-etiquette-inconnue',
                ['article « %s »' % slug] + ['ligne « %s »' % t for t in lignes_inconnues],
                'Le tableau des autrices et auteurs porte une ligne que le gabarit ne '
                'reconnaît pas (%s). L\'article n\'a PAS été importé, pour ne pas perdre '
                'ce que cette ligne contient : rien n\'a été créé, et le fichier Word reste '
                'en attente. Corrigez l\'étiquette dans le document, puis enregistrez.'
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
        if etiquette is None or not _ressemble_a_legende(etiquette):
            return 0
    return n // 2


def _ressemble_a_legende(etiquette):
    """`etiquette` se reconnaît-elle comme « Légende », exactement ou approximativement
    (accent oublié, casse...) ? Vérification structurelle PURE, sans avertir : la
    reconnaissance (et son avertissement éventuel) a lieu plus tard, quand _champs_bloc_meta()
    relira ce MÊME paragraphe pour de vrai — l'avertir ici aussi ferait un doublon."""
    resultat = identifier_cle(etiquette, CANON_FIGURE)
    return bool(resultat) and resultat[0] == 'legende'


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
                etiquette = p.texte.partition(':')[0].strip()
                resultat = identifier_cle(etiquette, CANON_FIGURE)
                if resultat and resultat[0] != '__ambigu__':
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


def _avertir_champ_hors_gabarit(champ, etiquette, valeur, slug):
    """Un champ RECONNU mais que le gabarit ne porte pas (voir CLES_AUTEUR_SANS_DESTINATION).
    Bloquant, comme une étiquette inconnue : sa valeur serait perdue. Le message dit ce qui est
    vrai — « ce champ n'existe pas dans le gabarit » — là où « étiquette inconnue » serait un
    mensonge, puisqu'on l'a parfaitement reconnue."""
    geste_fr, geste_de = GESTE_HORS_GABARIT.get(
        champ, ("Retirez cette ligne du document.",
                'Entfernen Sie diese Zeile aus dem Dokument.'))
    avertir(
        'auteur-champ-hors-gabarit',
        ['article « %s »' % slug, 'champ « %s »' % etiquette, 'valeur « %s »' % valeur],
        'Le tableau des autrices et auteurs porte un champ « %s » (« %s ») : le gabarit n\'en '
        'a pas. L\'article n\'a PAS été importé, pour ne pas perdre cette valeur — rien n\'a '
        'été créé, et le fichier Word reste en attente. %s'
        % (etiquette, valeur, geste_fr),
        'Die Tabelle der Autorinnen und Autoren enthält ein Feld « %s » (« %s »), das die '
        'Vorlage nicht kennt. Der Artikel wurde NICHT importiert, damit dieser Wert nicht '
        'verloren geht — es wurde nichts angelegt, und die Word-Datei bleibt in der '
        'Warteschlange. %s' % (etiquette, valeur, geste_de))


def _avertir_etiquette_bloc_inconnue(etiquette, valeur, slug):
    """Partagé par l'ancienne forme (_champs_bloc_meta) et la nouvelle
    (_champs_bloc_meta_paragraphes) : même code, même message, quelle que soit la forme du
    bloc — c'est le point que le test différentiel vérifie."""
    avertir(
        'bloc-etiquette-inconnue',
        ['article « %s »' % slug, 'etiquette « %s »' % etiquette, 'valeur « %s »' % valeur],
        'Un bloc figure ou tableau de cet article porte une étiquette que le gabarit ne '
        'connaît pas : « %s » (valeur : « %s »). L\'article n\'a PAS été importé : rien n\'a '
        'été créé, et le fichier Word reste en attente. Les quatre étiquettes attendues sont '
        '« Légende : », « Texte alternatif : », « Crédit : » et « Source : ».'
        % (etiquette, valeur),
        'Ein Abbildungs- oder Tabellenblock dieses Artikels enthält eine der Vorlage '
        'unbekannte Bezeichnung: « %s » (Wert: « %s »). Der Artikel wurde NICHT importiert: es '
        'wurde nichts angelegt, und die Word-Datei bleibt in der Warteschlange. Erwartet '
        'werden die vier Bezeichnungen «Légende :», «Texte alternatif :», «Crédit :» und '
        '«Source :».' % (etiquette, valeur))


def _decouper_champ_bloc(texte):
    """(etiquette, valeur) après le premier ':' d'UN paragraphe « Étiquette : valeur » ; None
    si `texte` ne porte pas de ':' du tout (paragraphe qui n'a simplement rien à dire — jamais
    un avertissement, voir les deux appelants). La RECONNAISSANCE de l'étiquette (exacte ou
    approximée) se fait chez l'appelant, qui seul connaît le `slug` à citer dans un
    avertissement."""
    if not texte or ':' not in texte:
        return None
    etiquette, _, valeur = texte.partition(':')
    return etiquette.strip(), valeur.strip()


def _champs_bloc_meta(row0, slug, bloquants=None):
    """(champs, consommee, cles_vues) — légende / texte alternatif / crédit / source lus sur
    TOUTES les cellules de la rangée 0, dans l'ordre. Ancienne forme (tableau enveloppe) ; voir
    _champs_bloc_meta_paragraphes() pour la nouvelle."""
    champs = {}
    consommee = True
    cles_vues = set()
    for tc in row0:
        for p in tc.blocs:
            if not isinstance(p, Par):
                continue
            # Correction du 22.09.2026 (même raison qu'_etiquette_szh_cle()) : seul SZH Cle
            # est un candidat « Étiquette : valeur ».
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
    """(champs, consommee, cles_vues, textes_pris) — même lecture que _champs_bloc_meta(), sur
    une liste de paragraphes SZH Cle Abb/Tab consécutifs (nouvelle forme, révision du
    21.09.2026) au lieu d'une rangée de cellules : plus de tableau autour, mais la même règle
    « Étiquette : valeur » et le même avertissement en cas d'étiquette inconnue.

    `textes_pris` est la liste des paragraphes dont l'étiquette a été RECONNUE — les seuls que
    la chaîne d'import a le droit de retirer du corps (lignes P, voir principal()). Un
    paragraphe laissé vide par l'autrice ou l'auteur (« Crédit : » tout seul, comme dans le
    gabarit livré) en fait partie : il n'apporte rien, mais il s'imprimerait. Un paragraphe
    dont l'étiquette n'est reconnue par rien n'en fait JAMAIS partie : on ne retire pas du
    texte qu'on n'a pas compris."""
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
            # Clé présente mais vide : traitée comme absente — jamais bloquante, donc jamais
            # passée à resoudre_cle(). Son étiquette est quand même identifiée, en silence,
            # pour savoir si ce paragraphe vide peut quitter le corps.
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


def extraire_bloc(tableau, slug, indice=0, bloquants=None):
    """(nature, champs, consommee, tbl_interne) pour LA PAIRE de rangées n° `indice` (0 pour
    le premier bloc, 1 pour le second si deux blocs sont collés dans le même tableau, etc.)
    d'un tableau reconnu par est_bloc_meta()/n_blocs_meta() — l'ANCIENNE forme (tableau
    enveloppe). Voie de REPLI depuis le 21.09.2026 (décision de Robin) : un document rempli
    depuis maintenant emploie _extraire_blocs_nouvelle_forme() ; celle-ci reste pour lire les
    documents déjà remplis à l'ancienne forme, jamais retirée — voir principal(), qui pose
    l'avertissement 'bloc-ancienne-forme' quand ce chemin est emprunté."""
    row0, row1 = tableau.rangees[indice * 2], tableau.rangees[indice * 2 + 1]
    champs, consommee, cles_vues = _champs_bloc_meta(row0, slug, bloquants)
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
    else:
        _avertir_cles_attendues_absentes(CANON_FIGURE, CANON_FIGURE.keys(), cles_vues, slug,
                                          'bloc')
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


def _extraire_blocs_nouvelle_forme(blocs, table1_elem, table2_elem, slug, bloquants=None,
                                    variantes=None):
    """Liste de dicts {'pos', 'nature', 'champs', 'consommee', 'tbl_interne'} — un par bloc
    figure/tableau à la NOUVELLE forme trouvé dans `blocs` (hors table1_elem/table2_elem, qui
    ne sont de toute façon jamais des Par et ne peuvent donc jamais démarrer un groupe de clés).
    `pos` est l'indice du PREMIER paragraphe de clé, dans `blocs` : il sert à `principal()` à
    fusionner cette liste avec celle de l'ancienne forme, dans l'ordre du document — jamais
    exposé dans stats['blocs'] (voir principal()), qui doit rendre la MÊME forme quelle que
    soit la forme d'entrée (c'est le test différentiel, pronto-gabarits.test.js)."""
    resultat = []
    # Rang de chaque tableau de PREMIER NIVEAU (1-based), par son indice dans `blocs` : c'est
    # la numérotation de docx-tables.py et de szh-tabelle-reference.lua, celle des lignes T. Un
    # bloc tableau la porte dans sa clé 'contenu', pour que ses champs aillent se poser sur le
    # bon tables/table-NN.html.
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
        while fin < n and fin - depart < 4 and _est_cle_bloc(blocs[fin]):
            fin += 1
        champs, consommee, cles_vues, textes_pris = _champs_bloc_meta_paragraphes(
            blocs[depart:fin], slug, bloquants)
        idx_contenu, nature = _cherche_contenu_bloc_nouvelle_forme(blocs, fin)
        if nature is None:
            _avertir_cles_sans_contenu(champs, slug)
            i = fin                       # les paragraphes de clé restent tels quels
            continue
        _avertir_cles_attendues_absentes(CANON_FIGURE, CANON_FIGURE.keys(), cles_vues, slug,
                                          'bloc')
        resultat.append({'pos': depart, 'nature': nature, 'champs': champs,
                         'consommee': consommee, 'tbl_interne': nature == 'table',
                         'cles': textes_pris,
                         'contenu': (rang_table.get(idx_contenu) if nature == 'table'
                                     else _images_du_bloc(blocs[idx_contenu], variantes))})
        i = idx_contenu + 1
    return resultat


def _images_du_bloc(par, variantes=None):
    """Les noms de fichier (sous media/) que l'image d'un bloc peut porter dans le .md, séparés
    par « | » et rangés de la plus grande surface déclarée à la plus petite, chacun suivi de ses
    variantes. Plusieurs noms parce qu'une même image peut en avoir deux : Word range un SVG
    derrière un aperçu bitmap, le lecteur voit l'aperçu et pandoc écrit le SVG (voir
    pronto_docx.variantes_images()). L'instruction FI les donne tous, et szh-legendes.lua pose
    les champs du bloc sur l'image qui répond à l'un d'eux — plutôt que sur un rang, qu'un
    paragraphe d'image de plus dans le document suffirait à décaler. '' si le paragraphe ne
    porte aucune image (jamais le cas ici : _cherche_contenu_bloc_nouvelle_forme() ne rend
    'image' que pour un paragraphe qui en porte)."""
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
# ⚠ CE QU'UNE LIGNE T ENGAGE (branchement du 22.09.2026). Une ligne T dit à la chaîne
# d'import de faire DISPARAÎTRE un tableau de premier niveau : docx-tables.py ne le rend pas,
# szh-meta.lua le retire de l'AST. Or docx-tables.py saute un tableau consommé ENTIÈREMENT et
# ne descend plus dedans (tableaux_de_premier_niveau() ne compte pas les imbriqués comme des
# tableaux séparés) : une ligne T posée sur l'enveloppe d'un bloc TABLEAU ferait disparaître
# le tableau qu'elle contient — ni rendu à part, ni rendu dans son parent, puisque le parent
# s'en va. Un tableau perdu sans un mot. D'où la règle, tenue par principal() : SEULS les deux
# tableaux fixes de la tête (métadonnées, autrices et auteurs) sont consommés. Jamais un bloc
# figure ou tableau, ni à la nouvelle forme (il n'y a pas d'enveloppe), ni à l'ancienne (elle
# s'imprime telle quelle, avec ses étiquettes — voir 'bloc-ancienne-forme').
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

def principal(blocs, chemin_source, slug, dossier, produit='', variantes=None):
    """`produit` est le jeton `revue:` du numéro (« revue » | « zeitschrift »), d'où vient la
    LANGUE de l'article depuis le 22.09.2026 — voir langue_du_produit(). Vide (lecteur appelé
    hors d'un numéro) : repli sur le français, dit par l'avertissement 'langue-deduite'.

    `variantes` : {nom d'image -> [autres noms]}, la table que le lecteur de format tient à
    côté du modèle neutre (pronto_docx.variantes_images()). Elle ne sert qu'à nommer l'image
    d'un bloc figure dans l'instruction FI, sous TOUS les noms qu'elle peut porter dans le .md."""
    stats = {'slug': slug, 'avertissements': []}
    # Une clé PRÉSENTE (valeur non vide) mais non reconnue est bloquante (décision de Robin,
    # 22.09.2026) : {'texte', 'lieu'} par occurrence, alimentée par resoudre_cle() et par le
    # seul cas qu'il ne couvre pas lui-même (métadonnées reconnues sans destination). Non vide
    # à la fin -> l'import échoue entièrement, voir plus bas.
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
            extraire_table_auteurs(table2_elem, slug, bloquants)
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
            '(un tableau à deux rangées), dépassée depuis le 21.09.2026 : il s\'imprimera tel '
            'quel, avec ses étiquettes (« Légende : », « Texte alternatif : »…), et sa légende '
            'ne sera ni numérotée ni reprise comme texte alternatif. Rien n\'est perdu. Pour '
            'que ce bloc redevienne une figure ou un tableau légendé, convertissez-le vers la '
            'nouvelle forme (quatre paragraphes « SZH Cle Abb/Tab » suivis de l\'image ou du '
            'tableau) puis réimportez l\'article.' % (k + 1),
            'Die Tabelle %d dieses Artikels verwendet die alte Form eines Abbildungs- oder '
            'Tabellenblocks (eine zweizeilige Tabelle), seit dem 21.09.2026 veraltet: sie wird '
            'so gedruckt, wie sie ist, mitsamt ihren Bezeichnungen («Légende :», «Texte '
            'alternatif :»…), und ihre Legende wird weder nummeriert noch als Alternativtext '
            'übernommen. Es geht nichts verloren. Damit dieser Block wieder eine beschriftete '
            'Abbildung oder Tabelle wird, wandeln Sie ihn in die neue Form um (vier Absätze '
            '«SZH Cle Abb/Tab», gefolgt vom Bild oder der Tabelle) und importieren Sie den '
            'Artikel neu.' % (k + 1))
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
        for p in range(n_paires):
            nature, champs, consommee, tbl_interne = extraire_bloc(tbl, slug, p, bloquants)
            # `cles` et `contenu` vides : un bloc à l'ancienne forme ne fait rien retirer du
            # corps et ne pose ses champs nulle part — son tableau enveloppe s'imprime tel
            # quel (voir tables_consommees et l'avertissement 'bloc-ancienne-forme').
            blocs_figtab.append({'pos': idx_bloc, 'k': k, 'nature': nature, 'champs': champs,
                                 'consommee': consommee, 'contenu': None, 'cles': [],
                                 'tbl_interne': tbl_interne is not None})

    # Nouvelle forme (révision du 21.09.2026) : jamais de tableau enveloppe, donc jamais rien
    # à ajouter à `tables_consommees` — il n'y a pas de tableau à faire sauter par la chaîne
    # d'import pour un bloc figure (le contenu est un simple paragraphe), et le tableau d'un
    # bloc tableau, n'étant plus imbriqué dans une enveloppe, n'a lui non plus RIEN à faire
    # sauter : il doit se rendre comme n'importe quel tableau de contenu ordinaire. C'est une
    # différence assumée avec l'ancienne forme (voir TODO-BRANCHEMENT-PARSER-V2.md, révision du
    # 21.09.2026) — stats['blocs'], lui, reste identique quelle que soit la forme d'entrée.
    blocs_nouvelle_forme = _extraire_blocs_nouvelle_forme(blocs, table1_elem, table2_elem, slug,
                                                            bloquants, variantes)
    blocs_figtab = sorted(blocs_figtab + blocs_nouvelle_forme, key=lambda b: b['pos'])

    # Un tableau « consommé » (ligne T) est un tableau que la chaîne d'import doit faire
    # DISPARAÎTRE du corps — docx-tables.py ne le rend pas, szh-meta.lua le retire de l'AST. Il
    # n'y en a que deux, et ce sont les deux tableaux fixes de la tête : métadonnées et
    # autrices/auteurs. JAMAIS un bloc figure ou tableau, quelle que soit sa forme :
    #
    #   * nouvelle forme — il n'y a pas de tableau enveloppe à faire sauter (le contenu est un
    #     paragraphe d'image, ou un tableau de premier niveau qui doit se rendre comme
    #     n'importe quel tableau de contenu) ;
    #   * ancienne forme — le tableau enveloppe reste, lui aussi. C'est la décision du
    #     22.09.2026, et elle supprime d'un coup le piège décrit dans
    #     TODO-BRANCHEMENT-PARSER-V2.md (étape 1) : consommer une enveloppe aurait fait
    #     disparaître le tableau qu'elle contient — ni rendu à part par docx-tables.py (qui
    #     saute le tableau consommé en entier), ni rendu dans son parent (puisque le parent
    #     s'en va). Un tableau perdu sans un mot. Ne rien consommer le rend impossible : le
    #     bloc s'imprime tel quel, avec ses étiquettes, et l'avertissement
    #     'bloc-ancienne-forme' dit ce qu'il faut faire pour retrouver une vraie figure.
    tables_consommees = []
    for k, (idx_bloc, tbl) in enumerate(tables):
        if tbl is table1_elem and table1_consommee:
            tables_consommees.append(k + 1)
        elif tbl is table2_elem and table2_consommee:
            tables_consommees.append(k + 1)

    # Verdict : une clé PRÉSENTE non reconnue bloque tout l'import (décision de Robin,
    # 22.09.2026) — rien n'est écrit (ni meta.yaml, ni $SZH_META/$SZH_PHOTOS), le document ne
    # s'importe pas. pronto-lire.py lit stats['bloquant'] pour sortir en échec, et
    # stats['cles_non_reconnues'] pour lister chaque clé (texte, emplacement) dans son message.
    if bloquants:
        stats['bloquant'] = True
        stats['cles_non_reconnues'] = bloquants
        return stats

    type_article = valeurs['type'] if valeurs['type'] in TYPES_VALIDES else ''
    # La langue vient du PRODUIT du numéro, jamais du document (voir langue_du_produit()).
    # `langue_deduite` ne vaut donc plus « devinée dans le texte » mais « pas de produit du
    # tout » — lecteur appelé hors d'un numéro, ausgabe.yaml sans clé `revue:` : on se rabat
    # sur le français, et l'avertissement le dit.
    langue = langue_du_produit(produit)
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
            "La langue de cet article n'a pas pu être établie : le numéro ne dit pas s'il "
            "s'agit de la Revue ou de la Zeitschrift, et la langue du document ne se lit "
            "plus dans le document lui-même. Le français a été posé par défaut ; "
            "vérifiez-le dans « Métadonnées des articles », la maquette et les résumés en "
            "dépendent.",
            'Die Sprache dieses Artikels konnte nicht bestimmt werden: die Ausgabe sagt '
            'nicht, ob es sich um die Revue oder die Zeitschrift handelt, und die Sprache '
            'steht nicht mehr im Dokument selbst. Ersatzweise wurde Französisch gesetzt; '
            'prüfen Sie es unter «Metadaten der Artikel» — Layout und Zusammenfassungen '
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
            # Les quatre paragraphes de clé d'un bloc quittent le corps (szh-meta.lua les
            # apparie sur leur texte, une ligne P retirant une occurrence), et leurs valeurs
            # vont se poser sur l'image (FI, szh-legendes.lua) ou sur le tableau (FT,
            # docx-tables.py). Sans ces lignes, « Légende : », « Texte alternatif : »,
            # « Crédit : » et « Source : » s'impriment tels quels au milieu de l'article et le
            # texte alternatif est perdu — mesuré sur le gabarit réel avant ce branchement.
            for b in blocs_figtab:
                for texte in b['cles']:
                    f.write('P\t%s\n' % texte)
            for b in blocs_figtab:
                if b['contenu'] is None:
                    continue
                champs = b['champs']
                queue = '\t'.join([champs.get('legende', ''), champs.get('alt', ''),
                                   champs.get('credit', ''), champs.get('source', '')])
                f.write('%s\t%s\t%s\n' % ('FT' if b['nature'] == 'table' else 'FI',
                                          b['contenu'], queue))
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
        'biblio': biblio,
        'meta_ecrit': meta_ecrit,
    })
    return stats
