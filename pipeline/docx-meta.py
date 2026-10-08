#!/usr/bin/env python3
# Étape d'import : extrait les métadonnées d'un Word hérité (hors gabarit Pronto) avant
# pandoc.
#
#   python3 docx-meta.py <fichier.docx> <slug> <dossier-article>
#
# Écrit <dossier-article>/<slug>.meta.yaml s'il n'existe pas (sinon il appartient au
# cockpit), une ligne JSON de statistiques sur stdout et, si $SZH_META est posée, des
# instructions pour les étapes suivantes, une par ligne, « LETTRE<TAB>valeur » :
#   Y  type d'article détecté (article|editorial|documentation)
#   L  langue du document
#   P  paragraphe à retirer du corps (seulement ceux que pandoc ne retire pas déjà : les
#      styles Title/Subtitle/Author/Abstract partent seuls)
#   G  nombre de paragraphes-image de tête à retirer (logo de licence CC)
#   T  rang du tableau de premier niveau consommé (tableau des auteurs), lu par
#      docx-tables.py et szh-meta.lua, qui restent ainsi alignés
#   F  légende de figure reconnue par son style, voisine d'une image (szh-legendes.lua)
#   B  paragraphe de la bibliographie, en clé de comparaison (szh-biblio-detacher.lua) :
#      le premier et le dernier bornent l'étendue, leur nombre dit combien de paragraphes
#      partent
#   BT titre de la bibliographie, en clé de comparaison : il quitte le corps, et la
#      compilation le repose dans la langue de l'article
#
# Si $SZH_PHOTOS est posée, écrit pour import-medias.py, une instruction par ligne :
#   A  <slug-auteur><TAB><nom dans media/>  photo associée, à ranger dans portraits/ et à
#      détourer. Le champ `photo` écrit ici désigne l'original ; import-medias.py le
#      remplace par .sans-fond.png si le détourage réussit.
#   G  <nom dans media/>                    photo d'auteur reconnue mais non associée, à
#      garder : le tableau des auteurs ayant quitté le corps, rien ne la cite.
#
# Deux champs de la fiche ne viennent que d'ici :
#   lang    langue de l'article, toujours écrite : sans elle, un article allemand dans un
#           numéro français n'aurait pas de titre et la compilation s'arrêterait. Si elle
#           est déduite (langue_source `contenu` ou `defaut`), un avertissement le dit.
#   source  nom du fichier Word d'origine, qui permet à la cible `import` de distinguer
#           deux articles homonymes d'un article redéposé, et au réimport d'apparier.
#
# Détection par style d'abord (w:styleId et nom localisé de styles.xml), puis par indices :
# gras et taille pour le titre, liste de noms pour les auteurs. Ordre habituel de la tête :
# Titel [Untertitel] Author Abstract(Résumé) Abstract(Zusammenfassung) « Keywords: … »
# « DOI: … » ligne de revue [logo CC], puis le corps ; tableau des auteurs en fin de
# document.
#
# Aucun texte n'est perdu : un bloc incertain reste dans le corps. Le YAML suit l'ordre du
# cockpit, guillemets échappés comme dans lib/yaml.js.

import json
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun
from pronto_modele import (langue_du_produit, aplatir, citer, cle_comparaison, lire_titres_bib,
                           slugifier_portrait)
# Tous les noms, pas seulement ceux utilisés ici : livre-migrer-meta.py et
# outils-dev/lexique/generer-noms.py les cherchent dans ce module.
from heritage_meta import (
    RE_RESUME, LANG_RESUME, RE_KEYWORDS, RE_DOI_LIGNE, RE_DOI, RE_JOURNAL, langue_resume,
    nettoyer_doi, langue_du_doi, decouper_keywords, decouper_liste, RE_TITRE_DEUX_POINTS,
    scinder_titre, CONNECTEURS, PARTICULES, TITRES_ACAD, SUFFIXES_TITRE, LIANTS_TITRE,
    RE_EMAIL, RE_ORCID, sans_titres_academiques, RE_ROLE, decouper_ligne_nom, nom_plausible,
    decouper_prenom_nom, auteurs_depuis_byline, ressemble_a_une_reference,
)
import ooxml_lecture
from ooxml_lecture import (W, A, blocs_du_corps, charger_rels_images, charger_styles, pstyle,
                           texte_paragraphe)

# Jetons de type reconnus par le cockpit (TYPES_ARTICLE de lib/yaml.js).
TYPES_VALIDES = ('article', 'editorial', 'interview', 'varia', 'tribune-libre',
                 'documentation')
LANGUES_META = ('fr', 'de', 'it')          # ordre d'écriture du YAML (cockpit)
CHAMPS_AUTEUR = ('prenom', 'nom', 'fonction', 'affiliation', 'orcid', 'email', 'photo')
# Formats acceptés par le dépôt de photo du cockpit (EXTENSIONS_PHOTO d'extension.js) ; une
# image d'un autre format n'est pas associée.
EXTENSIONS_PORTRAIT = ('png', 'jpg', 'jpeg', 'webp')

# rId -> nom du fichier tel que pandoc l'extrait sous media/. Rempli dans principal().
RELS_IMAGES = {}

# ---------------------------------------------------------------------------------
# Texte et normalisation. normaliser() doit rester identique à celle de docx-titres.py et
# de szh-titres.lua, qui comparent les paragraphes.


def normaliser(t):
    """Forme de comparaison : blancs Unicode (insécables comprises) regroupés, tirets
    -> '-', bords rognés. Pas pour une valeur : voir valeur()."""
    for a, b in (('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


_RE_BLANCS_ASCII = re.compile(r'[ \t\r\n\f\v]+')


def valeur(t):
    """Forme de valeur (titre, sous-titre, résumé, mots-clés, champs d'auteur) : seuls les
    blancs ASCII sont regroupés ; insécables, espace fine, tirets et U+2011 restent tels
    quels pour szh-typographie.lua. Même règle que pronto_modele.normaliser_valeur()."""
    return _RE_BLANCS_ASCII.sub(' ', t or '').strip()


def actif(prop):
    if prop is None:
        return False
    return prop.get(W + 'val') not in ('false', '0', 'none')


def a_image(el):
    """Vrai si l'élément contient une image (DrawingML ou VML)."""
    return (next(el.iter(A + 'blip'), None) is not None
            or next(el.iter(W + 'drawing'), None) is not None
            or next(el.iter(W + 'pict'), None) is not None)


def images_de(el):
    """[(nom sous media/, surface déclarée)] des images de `el`, dans l'ordre du document."""
    return ooxml_lecture.images_de_paragraphe(el, RELS_IMAGES)


def photo_de(el):
    """Nom du fichier de la photo d'une cellule : la plus grande image, pas la première.
    Une cellule de portrait contient parfois aussi un petit élément décoratif (filet,
    icône), qui serait pris pour le portrait."""
    trouvees = images_de(el)
    if not trouvees:
        return None
    return max(trouvees, key=lambda t: t[1])[0]


def paragraphe_tout_gras(p):
    vu = False
    for r in p.iter(W + 'r'):
        if not any(e.tag == W + 't' and (e.text or '') for e in r):
            continue
        vu = True
        rpr = r.find(W + 'rPr')
        if rpr is None or not actif(rpr.find(W + 'b')):
            return False
    return vu


def taille_max(p):
    ts = []
    for r in p.iter(W + 'r'):
        rpr = r.find(W + 'rPr')
        if rpr is None:
            continue
        sz = rpr.find(W + 'sz')
        if sz is not None:
            try:
                ts.append(int(sz.get(W + 'val')))
            except (TypeError, ValueError):
                pass
    return max(ts) if ts else None


# ---------------------------------------------------------------------------------
# Styles : classement par styleId et par nom localisé (styles.xml). pandoc met en
# métadonnées les paragraphes de style Title, Subtitle, Author, Abstract ou Date : ils
# quittent le corps seuls, sans ligne P.

NOMS_PANDOC_META = {'title', 'subtitle', 'author', 'abstract', 'date'}


class Classeur:
    """Classe un styleId en famille : title, subtitle, author, abstract, biblio, caption,
    heading, ou rien. L'id et le nom localisé sont tous deux testés (Titel|Title,
    Titre|Title, Untertitel|Subtitle, Literaturverzeichnis|Bibliography,
    AbbildungBeschriftung, TabelleBeschriftung…)."""

    def __init__(self, styles):
        self.styles = styles

    def famille(self, sid):
        if not sid:
            return ''
        nom = self.styles.get(sid, '')
        i = sid.lower()
        if nom == 'title' or i in ('titel', 'titre', 'title', 'titolo'):
            return 'title'
        if nom == 'subtitle' or i in ('untertitel', 'sous-titre', 'soustitre',
                                      'subtitle', 'sottotitolo'):
            return 'subtitle'
        if nom == 'author' or i in ('author', 'auteur', 'autor'):
            return 'author'
        if nom == 'abstract' or i == 'abstract':
            return 'abstract'
        # « EndNoteBibliography » : style que le module EndNote pose sur la liste qu'il
        # génère.
        if nom == 'bibliography' or i.startswith('literaturverzeichnis') \
                or i in ('bibliographie', 'bibliografia', 'bibliography',
                         'endnotebibliography'):
            return 'biblio'
        if 'beschriftung' in i.lower() or nom == 'caption' \
                or 'beschriftung' in nom or 'légende' in nom or 'legende' in nom:
            return 'caption'
        if re.match(r'^heading\s*\d', nom) or re.match(
                r'^(berschrift|heading|titre|titolo|berschrift)\d', i.lower()):
            return 'heading'
        return ''

    def nom(self, sid):
        return self.styles.get(sid or '', '')

    def pandoc_mange(self, sid):
        """Vrai si pandoc met ce style en métadonnées (bloc absent du corps)."""
        return self.nom(sid) in NOMS_PANDOC_META


# --- cellules du tableau des auteurs -----------------------------------------------

def lignes_cellule(tc):
    """Lignes de texte d'une cellule, coupées à chaque w:p et w:br. Rend [(texte, sep)],
    sep valant 'p' (nouveau paragraphe) ou 'br' (saut de ligne), pour joindre une
    affiliation sur plusieurs lignes sans virgule en trop."""
    lignes = []
    for enfant in tc:
        if enfant.tag != W + 'p':
            continue                      # tableau imbriqué ignoré
        sep = 'p'
        courant = []
        for r in enfant.iter(W + 'r'):
            for e in r:
                if e.tag == W + 't':
                    courant.append(e.text or '')
                elif e.tag == W + 'tab':
                    courant.append(' ')
                elif e.tag == W + 'noBreakHyphen':
                    courant.append(szh_commun.TRAIT_UNION_INSECABLE)
                elif e.tag == W + 'sym':
                    courant.append(szh_commun.caractere_sym(e.get(W + 'char'), e.get(W + 'font')))
                elif e.tag in (W + 'br', W + 'cr'):
                    t = valeur(''.join(courant))
                    if t:
                        lignes.append((t, sep))
                        sep = 'br'
                    courant = []
        t = valeur(''.join(courant))
        if t:
            lignes.append((t, sep))
    return lignes


def cellule_auteur(tc):
    """Cellule « auteur » : lignes de rôle sautées, puis première ligne = nom plausible
    (titres académiques admis, suite « , MA Fonction » acceptée), et e-mail ou au moins
    deux lignes. Rend le dict auteur, ou None."""
    lignes = lignes_cellule(tc)
    while lignes and RE_ROLE.match(lignes[0][0]):
        lignes.pop(0)                     # « Article rédigé par », « En collab. avec »…
    if not lignes:
        return None
    premier, amorce_fonction = decouper_ligne_nom(lignes[0][0])
    # Ligne de titres seuls, le nom à la ligne suivante (« Prof. Dr. phil. » puis
    # « Angelika Schöllhorn ») : la ligne est sautée. Seulement si elle ne contient que
    # des titres : sinon un encadré de contenu passerait pour un bloc auteurs.
    if not premier and len(lignes) > 1 and not sans_titres_academiques(lignes[0][0]):
        lignes.pop(0)
        premier, amorce_fonction = decouper_ligne_nom(lignes[0][0])
    if not premier:
        return None
    email = ''
    orcid = ''
    infos = []                            # lignes hors nom / e-mail / orcid
    if amorce_fonction:
        infos.append((amorce_fonction, 'p'))
    for txt, sep in lignes[1:]:
        m = RE_EMAIL.search(txt)
        if m and not email:
            email = m.group(1)
            # e-mail en fin de ligne (« PH Luzern bruno.zobrist@phlu.ch ») : le reste de
            # la ligne est une information à part.
            reste = valeur(txt.replace(m.group(1), ' '))
            if reste:
                infos.append((reste, sep))
            continue
        m = RE_ORCID.search(txt)
        if m and not orcid:
            orcid = m.group(1)
            continue
        infos.append((txt, sep))
    if not email and not infos:
        return None
    prenom, nom = decouper_prenom_nom(premier)
    # fonction = première ligne d'information, prolongée par la suivante si elle finit par
    # & / et / und / virgule, ou si la suivante commence par une minuscule (« Parent d'un
    # adolescent » + « polyhandicapé »).
    fonction = ''
    i = 0
    if infos:
        fonction = infos[0][0]
        i = 1
        while i < len(infos) and (
                re.search(r'([&,]|\bet|\bund|\band)$', fonction)
                or infos[i][0][:1].islower()):
            fonction = fonction + ' ' + infos[i][0]
            i += 1
    # affiliation = le reste, joint par ', ' entre paragraphes et par ' ' après un simple
    # saut de ligne (« Interkantonale Hochschule für / Heilpädagogik » reste entier).
    affiliation = ''
    for txt, sep in infos[i:]:
        if not affiliation:
            affiliation = txt
        else:
            affiliation += (' ' if sep == 'br' else ', ') + txt
    return {'prenom': prenom, 'nom': nom, 'fonction': fonction,
            'affiliation': affiliation, 'orcid': orcid, 'email': email}


# Crédit sous le portrait, dans la cellule de l'image (« © Franca Pedrazetti »,
# « @ ARC Sieber ») : la cellule reste une cellule-photo. La fiche d'auteur n'ayant pas de
# champ crédit, analyser_table_auteurs() rend ces crédits pour qu'ils soient signalés.
RE_CREDIT_PHOTO = re.compile(
    r'^(?:[©@]|\(c\)|cr[ée]dits?\b|photos?\s*:'
    r'|foto(?:grafie)?\s*:|bild(?:quelle)?\s*:)', re.I)


def _apparier(sans_photo, libres):
    """Associe dans l'ordre des cellules-photos à des auteurs sans photo, seulement si les
    nombres sont égaux : mieux vaut aucune photo qu'une photo sur la mauvaise personne."""
    if not libres or len(libres) != len(sans_photo):
        return
    for a, nom in zip(sans_photo, libres):
        a['_image'] = nom


def analyser_table_auteurs(tbl):
    """(est_tableau_auteurs, [auteurs], nb_photos, {images}, [crédits de photo]). Strict :
    chaque cellule non vide doit être une image seule (photo) ou une cellule auteur ; une
    seule cellule de texte libre laisse le tableau dans le corps.

    Chaque auteur reçoit dans '_image' le nom de sa photo sous media/ quand l'association
    est sûre : l'image de sa propre cellule, sinon les cellules-photos de la même rangée
    dans l'ordre, sinon celles du tableau entier (rangée d'images au-dessus d'une rangée de
    textes). Rien si les nombres diffèrent.

    {images} contient toutes les images des cellules-photos, retenues ou non : le tableau
    quitte le corps, et ces fichiers doivent être protégés de la suppression."""
    auteurs = []
    photos = 0
    libres_table = []
    connues = set()
    credits = []
    for tr in (x for x in tbl if x.tag == W + 'tr'):
        rangee_auteurs = []
        rangee_libres = []
        for tc in (x for x in tr if x.tag == W + 'tc'):
            if next(tc.iter(W + 'tbl'), None) is not None:
                return False, [], 0, set(), []   # tableau imbriqué : pas un bloc auteurs
            texte = normaliser(' '.join(texte_paragraphe(p)
                                        for p in tc if p.tag == W + 'p'))
            if texte and len(texte) <= 80 and a_image(tc)                     and RE_CREDIT_PHOTO.match(texte):
                credits.append(texte)
                texte = ''                # cellule-photo malgré son crédit
            if not texte:
                if a_image(tc):
                    photos += 1
                    connues.update(n for n, _ in images_de(tc))
                    nom = photo_de(tc)
                    if nom:
                        rangee_libres.append(nom)
                continue
            a = cellule_auteur(tc)
            if a is None:
                return False, [], 0, set(), []
            if a_image(tc):
                photos += 1
                connues.update(n for n, _ in images_de(tc))
                nom = photo_de(tc)
                if nom:
                    a['_image'] = nom
            rangee_auteurs.append(a)
        _apparier([a for a in rangee_auteurs if not a.get('_image')], rangee_libres)
        libres_table.extend(n for n in rangee_libres
                            if not any(a.get('_image') == n for a in rangee_auteurs))
        auteurs.extend(rangee_auteurs)
    _apparier([a for a in auteurs if not a.get('_image')], libres_table)
    return (len(auteurs) > 0), auteurs, photos, connues, credits


# ---------------------------------------------------------------------------------
# Type d'article : documentation ou editorial seulement sur un signe explicite.

def detecter_type(nom_fichier, titre, doi):
    base = (os.path.basename(nom_fichier) or '').lower()
    t = (titre or '').lower()
    for chaine in (t, base):
        if 'documentation' in chaine or 'dokumentation' in chaine \
                or 'actualité et ressources' in chaine or 'actualite et ressources' in chaine:
            return 'documentation', 'titre/fichier'
        if re.search(r'\b(editorial|édito(rial)?|edito(rial)?)\b', chaine):
            return 'editorial', 'titre/fichier'
    # Les deux revues numérotent l'éditorial « -00 » (10.57161/r2023-03-00).
    if re.search(r'-00$', doi or ''):
        return 'editorial', 'doi-00'
    return 'article', 'defaut'


# ---------------------------------------------------------------------------------
# Avertissement pour la rédaction : une ligne, préfixe fixe, deuxième champ = code stable,
# français puis allemand, sur stderr et dans $SZH_IMPORT_LOG (szh_commun.avertir(), commun
# à docx-tables.py, livre-scinder.py et reimporter.py).
PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# Sérialisation YAML, alignée sur lib/yaml.js (serialiserMeta, citerFrontmatter) : valeurs
# entre "…" par pronto_modele.citer(), fins de ligne LF, clés vides omises. Diffère de
# pronto_modele.serialiser_meta() : mots-clés écrits, pas de champ ror.
def serialiser_meta(meta):
    lignes = []
    if meta.get('type') in TYPES_VALIDES:
        lignes.append('type: ' + meta['type'])
    # Sans guillemets, comme serialiserMeta() de lib/yaml.js : szh-maquette.lua relit
    # cette ligne hors pandoc.
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
    km = meta.get('keywords') or {}
    sous = []
    for l in LANGUES_META:
        mots = [m.strip() for m in (km.get(l) or []) if m.strip()]
        if mots:
            sous.append('  %s:' % l)
            sous.extend('  - ' + citer(m) for m in mots)
    if sous:
        lignes.append('keywords:')
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
# Bibliographie : quelle partie du corps détacher.
#
# Le style seul décide : les deux revues marquent leurs références « Literaturverzeichnis »,
# « Bibliographie », « Bibliography » ou « EndNoteBibliography ». Le titre de section ne
# sert qu'à trouver le haut de la liste.
#
# L'étendue va du titre (exclu) au dernier paragraphe stylé : les références dont le
# paragraphe a perdu son style, au milieu de la liste, partent avec les autres. Rien n'est
# pris après le dernier paragraphe stylé (des notices d'auteurs suivent parfois la liste).
#
# aplatir(), cle_comparaison() et lire_titres_bib() viennent de pronto_modele : les deux
# lecteurs écrivent les mêmes clés B/BT, relues par szh-biblio-detacher.lua. Un lexique
# illisible donne un ensemble vide : l'étendue commence alors au premier paragraphe stylé.


def references_restees(blocs, fin):
    """Nombre de paragraphes ressemblant à des références qui suivent l'étendue, avant le
    prochain titre ou tableau. Ils ne sont pas détachés (pas de style), mais signalés."""
    n = 0
    for i in range(fin + 1, len(blocs)):
        e = blocs[i]
        if e.tag != W + 'p':
            break
        txt = normaliser(texte_paragraphe(e))
        if not txt:
            continue
        if not ressemble_a_une_reference(txt):
            break
        n += 1
    return n


def etendue_biblio(blocs, classeur, type_article):
    """(lignes B, ligne BT, stats) : clés des paragraphes à détacher, clé du titre à
    retirer, statistiques.

    Une documentation est laissée entière : sa liste est son contenu (le style de
    bibliographie y est souvent posé sur le sommaire de tête)."""
    stats = {'voie': 'aucune', 'paragraphes': 0, 'styles': 0, 'titre': False}
    if type_article == 'documentation':
        stats['voie'] = 'documentation'
        return [], '', stats
    lexique = lire_titres_bib()
    styles = [i for i, e in enumerate(blocs)
              if e.tag == W + 'p' and classeur.famille(pstyle(e)) == 'biblio'
              and normaliser(texte_paragraphe(e))]
    if not styles:
        # Aucun style, mais un titre de bibliographie : le document en a une qu'on ne sait
        # pas borner, ce qui sera signalé (un éditorial sans références ne l'est pas).
        for e in blocs:
            if e.tag != W + 'p' or classeur.famille(pstyle(e)) != 'heading':
                continue
            if aplatir(normaliser(texte_paragraphe(e))) in lexique:
                stats['voie'] = 'titre-seul'
                break
        return [], '', stats

    # Haut de l'étendue : on remonte jusqu'au premier titre. S'il est dans le lexique,
    # l'étendue commence après lui ; sinon au premier paragraphe stylé.
    titre = None
    vus = 0
    j = styles[0] - 1
    while j >= 0 and vus < 15:
        e = blocs[j]
        if e.tag != W + 'p':
            break
        txt = normaliser(texte_paragraphe(e))
        if txt:
            vus += 1
            if classeur.famille(pstyle(e)) == 'heading':
                if aplatir(txt) in lexique:
                    titre = j
                break
        j -= 1

    debut = (titre + 1) if titre is not None else styles[0]
    fin = styles[-1]
    # Un tableau dans l'étendue : on se limite aux paragraphes stylés, pour ne pas
    # emporter le tableau.
    if any(blocs[i].tag == W + 'tbl' for i in range(debut, fin + 1)):
        debut, titre = styles[0], None

    lignes = []
    for i in range(debut, fin + 1):
        e = blocs[i]
        if e.tag != W + 'p':
            continue
        txt = normaliser(texte_paragraphe(e))
        if txt:
            lignes.append(cle_comparaison(txt))
    stats.update({'voie': 'style', 'paragraphes': len(lignes), 'styles': len(styles),
                  'titre': titre is not None, 'restees': references_restees(blocs, fin)})
    bt = cle_comparaison(normaliser(texte_paragraphe(blocs[titre]))) \
        if titre is not None else ''
    return lignes, bt, stats


def principal(argv):
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(argv) != 4:
        print('usage : docx-meta.py <fichier.docx> <slug> <dossier-article>',
              file=sys.stderr)
        return 2
    chemin_docx, slug, dossier = argv[1], argv[2], argv[3]
    stats = {'slug': slug, 'avertissements': []}
    try:
        with zipfile.ZipFile(chemin_docx) as z:
            racine = ET.fromstring(z.read('word/document.xml'))
            styles = charger_styles(z)
            RELS_IMAGES.update(charger_rels_images(z))
    except Exception as e:
        # Bloquant : sans lecture il n'y a ni fiche ni instructions, et import-docx.sh
        # refuse l'import (le Word reste en attente).
        print('[docx-meta] lecture impossible de %s : %s' % (chemin_docx, e),
              file=sys.stderr)
        avertir(
            'fichier-illisible',
            ['article « %s »' % slug, 'erreur « %s »' % e],
            "Le fichier Word n’a pas pu être ouvert\u00a0: il est peut-être tronqué ou "
            "endommagé. Rien n’a été importé. Ouvrez-le dans Word, enregistrez-le de "
            "nouveau, puis relancez la conversion.",
            "Die Word-Datei konnte nicht geöffnet werden: sie ist möglicherweise "
            "abgeschnitten oder beschädigt. Es wurde nichts importiert. Öffnen Sie sie in "
            "Word, speichern Sie sie erneut und starten Sie die Konvertierung noch einmal.")
        chemin_meta = os.getenv('SZH_META')
        if chemin_meta:
            open(chemin_meta, 'w', encoding='utf-8', newline='\n').close()
        print(json.dumps({'slug': slug, 'erreur': str(e)}, ensure_ascii=False))
        return 1

    classeur = Classeur(styles)
    blocs = blocs_du_corps(racine)
    nblocs = max(1, len(blocs))

    # ---- 1) Tête du document : lit les blocs de métadonnées jusqu'au corps ----
    titre_parts, sous_titre_parts = [], []
    byline = ''
    resumes = {}                          # lang -> texte (None = langue du document)
    keywords_brut = None                  # texte après l'étiquette
    doi = ''
    langue = None
    consommes_p = []                      # lignes P (texte normalisé)
    logos = 0
    dernier_resume = None                 # langue du dernier résumé (pour sa suite)
    titre_source = ''
    sous_titre_source = ''
    i = 0
    while i < len(blocs) and i < 25:
        e = blocs[i]
        if e.tag == W + 'tbl':
            break
        sid = pstyle(e)
        fam = classeur.famille(sid)
        brut = texte_paragraphe(e)
        txt = normaliser(brut)            # pour reconnaître
        val = valeur(brut)                # pour écrire dans la fiche
        mange = classeur.pandoc_mange(sid)

        def consommer():
            if txt and not mange:
                consommes_p.append(txt)

        if not txt:
            # Paragraphe sans texte : logo de licence CC (image seule) dans la tête.
            if a_image(e) and (titre_parts or byline or doi):
                logos += 1
            i += 1
            continue
        if fam == 'title':
            titre_parts.append(val)
            titre_source = 'style'
            consommer()
        elif fam == 'subtitle':
            if not titre_parts:
                # « Dokumentation » : Untertitel en tout premier bloc = titre de fait.
                titre_parts.append(val)
                titre_source = 'style-sous-titre'
            else:
                sous_titre_parts.append(val)
                sous_titre_source = 'style'
            consommer()
        elif fam == 'author':
            byline = (byline + ', ' + val) if byline else val
            consommer()
        elif RE_KEYWORDS.match(txt):
            # L'étiquette se reconnaît sur la forme de comparaison (« Mots‑clés » avec un
            # trait d'union insécable), la valeur se prend sur la forme tapée.
            source_mc = val if RE_KEYWORDS.match(val) else txt
            keywords_brut = RE_KEYWORDS.sub('', source_mc, count=1).strip()
            consommer()
        elif RE_DOI_LIGNE.match(txt) and RE_DOI.search(txt):
            doi = nettoyer_doi(txt)
            consommer()
        elif RE_JOURNAL.match(txt):
            langue = 'fr' if txt.lower().lstrip().startswith('revue') else 'de'
            consommer()
        elif fam == 'abstract' or RE_RESUME.match(txt):
            m = RE_RESUME.match(txt)
            if m:
                lang = langue_resume(m.group(1))
                corps_resume = RE_RESUME.sub('', val if RE_RESUME.match(val) else txt,
                                             count=1).strip()
                cle = lang                # None (« Abstract ») = langue du document
                if cle in resumes and resumes[cle]:
                    resumes[cle] += ' ' + corps_resume
                else:
                    resumes[cle] = corps_resume
                dernier_resume = cle
            elif dernier_resume is not None or dernier_resume in resumes:
                resumes[dernier_resume] = (resumes.get(dernier_resume, '')
                                           + ' ' + val).strip()
            else:
                resumes[None] = val
                dernier_resume = None
            consommer()
        else:
            break                         # premier bloc non reconnu : le corps commence
        i += 1
    fin_tete = i

    # ---- 1bis) Titre deviné, si aucun style Title/Subtitle n'est trouvé ----------
    if not titre_parts:
        # taille la plus fréquente du corps, pour juger « nettement plus grand »
        freq = {}
        for p in (b for b in blocs if b.tag == W + 'p'):
            t = taille_max(p)
            if t:
                freq[t] = freq.get(t, 0) + 1
        taille_corps = max(freq, key=freq.get) if freq else None
        for j, e in enumerate(blocs[:6]):
            if e.tag != W + 'p':
                break
            txt = normaliser(texte_paragraphe(e))
            if not txt:
                continue
            t = taille_max(e)
            grand = t is not None and taille_corps is not None and t >= taille_corps * 1.2
            if len(txt.split()) <= 30 and (grand or paragraphe_tout_gras(e)):
                titre_parts.append(valeur(texte_paragraphe(e)))
                titre_source = 'heuristique'
                if not classeur.pandoc_mange(pstyle(e)):
                    consommes_p.append(txt)
                # sous-titre deviné : bloc suivant, court, plus grand que le corps mais
                # plus petit que le titre, et qui n'est pas une ligne d'auteurs
                if j + 1 < len(blocs) and blocs[j + 1].tag == W + 'p':
                    e2 = blocs[j + 1]
                    txt2 = normaliser(texte_paragraphe(e2))
                    t2 = taille_max(e2)
                    if txt2 and len(txt2.split()) <= 30 and t2 and t and t2 < t \
                            and taille_corps and t2 > taille_corps \
                            and not auteurs_depuis_byline(txt2):
                        sous_titre_parts.append(valeur(texte_paragraphe(e2)))
                        sous_titre_source = 'heuristique'
                        if not classeur.pandoc_mange(pstyle(e2)):
                            consommes_p.append(txt2)
            break

    # ---- 1ter) Ligne d'auteurs devinée, si aucun style Author --------------------
    if not byline and titre_source == 'heuristique':
        for e in blocs[1:5]:
            if e.tag != W + 'p':
                break
            txt = normaliser(texte_paragraphe(e))
            if not txt or txt in consommes_p:
                continue
            candidats = auteurs_depuis_byline(txt)
            if candidats and all(a['prenom'] for a in candidats) \
                    and len(txt) <= 160:
                byline = txt
                if not classeur.pandoc_mange(pstyle(e)):
                    consommes_p.append(txt)
            break

    # ---- 2) Langue du document : ligne de revue > DOI (r/z) > premier résumé -----
    langue_source = 'journal' if langue else ''
    if not langue and doi:
        langue = langue_du_doi(doi)
        langue_source = 'doi' if langue else ''
    if not langue:
        for cle in resumes:
            if cle:
                langue = cle
                langue_source = 'premier-resume'
                break
    if not langue:
        # Dernier recours (ni revue, ni DOI, ni résumé) : comptage de mots-outils dans les
        # premiers paragraphes, fiable entre fr et de.
        de_mots = (' der ', ' die ', ' das ', ' und ', ' für ', ' mit ', ' im ',
                   ' ein ', ' eine ', ' zum ', ' von ')
        fr_mots = (' le ', ' la ', ' les ', ' et ', ' pour ', ' dans ', ' des ',
                   ' un ', ' une ', ' du ', ' de la ')
        nde = nfr = 0
        for e in blocs[:80]:
            if e.tag != W + 'p':
                continue
            t = ' ' + normaliser(texte_paragraphe(e)).lower() + ' '
            nde += sum(t.count(m) for m in de_mots)
            nfr += sum(t.count(m) for m in fr_mots)
        if abs(nde - nfr) >= 5:
            langue = 'de' if nde > nfr else 'fr'
            langue_source = 'contenu'
    # Le produit du numéro décide, comme pour pronto-lire.py ($SZH_PRODUIT, posé par
    # import-docx.sh). La langue détectée ci-dessus ne sert qu'à signaler un désaccord : un
    # article de la Zeitschrift commence souvent par un résumé français. Sans produit
    # (appel hors d'un numéro), la langue détectée est gardée.
    langue_detectee, source_detectee = langue, langue_source
    langue_produit = langue_du_produit(os.getenv('SZH_PRODUIT', ''))
    if langue_produit:
        langue, langue_source = langue_produit, 'produit'
    if not langue:
        langue = 'fr'
        langue_source = 'defaut'
        stats['avertissements'].append('langue-indeterminee')
    if None in resumes:                   # « Abstract » sans langue -> langue du document
        texte = resumes.pop(None)
        if langue not in resumes or not resumes[langue]:
            resumes[langue] = texte
        else:
            stats['avertissements'].append('resume-abstract-ignore')

    # ---- 3) Tableau(x) des auteurs en fin de document ----------------------------
    tables = [(idx, e) for idx, e in enumerate(blocs) if e.tag == W + 'tbl']
    tables_consommees = []                # rangs à partir de 1 (ordre du document)
    auteurs_table = []
    photos = 0
    photos_connues = set()                # images des cellules-photos, à protéger
    premier_tbl_consomme = None           # indice de bloc du 1er tableau consommé
    credits_photo = []                    # crédits partis avec les tableaux consommés
    refuses_parlants = 0                  # tableaux de fin refusés contenant un e-mail
    for k in range(len(tables) - 1, -1, -1):
        idx_bloc, tbl = tables[k]
        if idx_bloc / nblocs < 0.4:       # pas de bloc auteurs avant 40 % du document
            break
        ok, auteurs, nb_photos, connues, credits = analyser_table_auteurs(tbl)
        if not ok:
            # On continue vers le haut : un encadré en fin d'article ne doit pas masquer
            # le bloc auteurs juste avant. Le tableau refusé reste dans le corps. S'il
            # contient un e-mail, c'est sans doute un bloc auteurs illisible : signalé
            # plus bas.
            if RE_EMAIL.search(' '.join(texte_paragraphe(p)
                                        for p in tbl.iter(W + 'p'))):
                refuses_parlants += 1
            continue
        tables_consommees.insert(0, k + 1)
        auteurs_table = auteurs + auteurs_table
        photos += nb_photos
        photos_connues |= connues
        credits_photo.extend(credits)
        premier_tbl_consomme = idx_bloc

    # Le titre de section juste au-dessus du tableau consommé (« Autrices et auteurs »,
    # « Zur Person »…) part aussi : seulement un titre stylé, court, du vocabulaire des
    # auteurs, collé au tableau (lignes vides sautées). szh-meta.lua compare aussi les
    # Header.
    if premier_tbl_consomme is not None:
        j = premier_tbl_consomme - 1
        while j >= 0 and blocs[j].tag == W + 'p' \
                and not normaliser(texte_paragraphe(blocs[j])):
            j -= 1
        if j >= 0 and blocs[j].tag == W + 'p' \
                and classeur.famille(pstyle(blocs[j])) == 'heading':
            txt = normaliser(texte_paragraphe(blocs[j]))
            if txt and len(txt.split()) <= 5 and re.search(
                    r'(autrice|auteur|autor|zur? person|zu den personen)', txt, re.I):
                consommes_p.append(txt)

    # ---- 4) Auteurs : tableau, sinon ligne d'auteurs -----------------------------
    auteurs_byline = auteurs_depuis_byline(byline) if byline else []
    if auteurs_table:
        author = auteurs_table
        auteurs_source = 'tableau'
        noms_t = {normaliser((a['prenom'] + ' ' + a['nom']).strip()).lower()
                  for a in auteurs_table}
        noms_b = {normaliser((a['prenom'] + ' ' + a['nom']).strip()).lower()
                  for a in auteurs_byline}
        if auteurs_byline and not noms_b.issubset(noms_t):
            stats['avertissements'].append('byline-differente-du-tableau')
    else:
        author = auteurs_byline
        auteurs_source = 'byline' if auteurs_byline else 'aucun'

    # ---- 4b) Photos des auteurs -------------------------------------------------
    # Le champ `photo` désigne le fichier après son déplacement par import-medias.py :
    # l'original, seul fichier sûr d'exister. Un détourage réussi le remplace par
    # .sans-fond.png.
    photos_appariees = []                 # (slug-auteur, nom du fichier dans media/)
    bases_vues = set()
    fichiers_vus = set()
    for a in author:
        nom_image = a.pop('_image', None)
        if not nom_image:
            continue
        base = slugifier_portrait(a.get('prenom', ''), a.get('nom', ''))
        ext = os.path.splitext(nom_image)[1].lstrip('.').lower()
        if ext not in EXTENSIONS_PORTRAIT:
            stats['avertissements'].append('photo-format-ignore')
            continue
        if base in bases_vues:
            stats['avertissements'].append('photo-homonyme-ignoree')
            continue                      # deux auteurs du même nom : aucune photo
        if nom_image in fichiers_vus:
            # Word réutilise un fichier pour deux insertions identiques : le second auteur
            # aurait un `photo` vers un fichier déjà déplacé.
            stats['avertissements'].append('photo-fichier-partage-ignore')
            continue
        bases_vues.add(base)
        fichiers_vus.add(nom_image)
        a['photo'] = 'portraits/%s.original.%s' % (base, ext)
        photos_appariees.append((base, nom_image))
    for a in auteurs_table:
        a.pop('_image', None)             # champ interne, retiré

    # ---- 5) Type d'article --------------------------------------------------------
    type_article, type_regle = detecter_type(
        chemin_docx, ' '.join(titre_parts), doi)

    # ---- 6) Bibliographie : l'étendue à détacher, d'après les styles -------------
    lignes_b, ligne_bt, biblio = etendue_biblio(blocs, classeur, type_article)

    # ---- 7) Légendes de figures par style (voisines d'une image) -----------------
    lignes_f = []
    for idx, e in enumerate(blocs):
        if e.tag != W + 'p' or classeur.famille(pstyle(e)) != 'caption':
            continue
        txt = normaliser(texte_paragraphe(e))
        if not txt:
            continue
        for j in (idx - 1, idx + 1):
            if 0 <= j < len(blocs) and blocs[j].tag == W + 'p' \
                    and a_image(blocs[j]) and not normaliser(texte_paragraphe(blocs[j])):
                lignes_f.append(txt)
                break

    # ---- 7bis) Titre à deux-points, faute de sous-titre ---------------------------
    # Après la détection du type, qui lit le titre entier (« Aktuelles: Dokumentation »).
    # Les lignes P ne changent pas : le paragraphe entier quitte le corps ; seule la fiche
    # reçoit deux champs.
    if titre_parts and not sous_titre_parts:
        gauche, droite = scinder_titre(' '.join(titre_parts))
        if droite:
            titre_parts, sous_titre_parts = [gauche], [droite]
            sous_titre_source = 'deux-points'

    # ---- 8) meta.yaml (pas écrasé), $SZH_META et statistiques ---------------------
    meta = {
        'type': type_article,
        'lang': langue if langue in LANGUES_META else '',
        # Nom du Word déposé, que la cible `import` compare au prochain dépôt.
        # $SZH_SOURCE donne le nom d'origine quand ce .docx vient d'un .odt converti.
        'source': os.environ.get('SZH_SOURCE') or os.path.basename(chemin_docx),
        # Le DOI du Word n'est pas repris : le cockpit le calcule (lib/export-ojs.js), et
        # seul un DOI saisi à la main vit dans la fiche. Le DOI lu sert à deviner la
        # langue et le type (éditorial en -00), et aux statistiques.
        'doi': '',
        'title': {langue: ' '.join(titre_parts)} if titre_parts else {},
        'subtitle': {langue: ' '.join(sous_titre_parts)} if sous_titre_parts else {},
        'resume': {k: v for k, v in resumes.items() if k and v},
        'keywords': decouper_keywords(keywords_brut, langue) if keywords_brut else {},
        'author': author,
    }
    chemin_meta_yaml = os.path.join(dossier, slug + '.meta.yaml')
    meta_ecrit = False
    if os.path.exists(chemin_meta_yaml):
        # La fiche existe (réimport) : elle appartient au cockpit et n'est pas réécrite.
        # Les instructions de retrait sont quand même écrites.
        stats['avertissements'].append('meta-existant-conserve')
    else:
        contenu = serialiser_meta(meta)
        if contenu:
            szh_commun.ecrire_atomique(chemin_meta_yaml, lambda f: f.write(contenu),
                                       binaire=False, encoding='utf-8', newline='\n')
            meta_ecrit = True

    # Langue imposée par le produit ou devinée : écrite (un champ vide bloquerait la
    # composition) et signalée. Rien à signaler sur une fiche existante, non modifiée.
    if (meta_ecrit and langue_source == 'produit' and langue_detectee
            and langue_detectee != langue):
        avertir(
            'langue-desaccord-produit',
            ['article « %s »' % slug, 'langue « %s »' % langue,
             'document « %s » (%s)' % (langue_detectee, source_detectee)],
            "Le document semble écrit en «\u00a0%s\u00a0», mais l’article est composé en "
            "«\u00a0%s\u00a0», la langue du numéro. Si c’est voulu, rien à faire\u00a0; "
            "sinon, corrigez la langue dans «\u00a0Métadonnées des articles\u00a0»."
            % (langue_detectee, langue),
            'Das Dokument scheint auf «%s» geschrieben, der Artikel wird aber auf «%s» '
            'gesetzt, der Sprache der Ausgabe. Ist das gewollt, ist nichts zu tun; sonst '
            'korrigieren Sie die Sprache unter «Metadaten der Artikel».'
            % (langue_detectee, langue))
    if meta_ecrit and langue_source in ('contenu', 'defaut'):
        avertir(
            'langue-deduite',
            ['article « %s »' % slug, 'langue « %s »' % langue],
            "La langue de cet article n’était pas indiquée dans le document\u00a0: elle a "
            "été devinée. Vérifiez-la dans «\u00a0Métadonnées des articles\u00a0»\u00a0: la maquette "
            "et les résumés en dépendent.",
            'Die Sprache dieses Artikels stand nicht im Dokument: sie wurde erraten. '
            'Prüfen Sie sie unter «Metadaten der Artikel» – Layout und '
            'Zusammenfassungen richten sich danach.')

    # Sous-titre tiré d'un deux-points : coupe visible à l'impression, signalée pour être
    # vérifiée.
    if meta_ecrit and sous_titre_source == 'deux-points':
        avertir(
            'sous-titre-deduit',
            ['article « %s »' % slug, 'titre « %s »' % ' '.join(titre_parts),
             'soustitre « %s »' % ' '.join(sous_titre_parts)],
            "Le document ne donnait qu’un titre, avec un deux-points au milieu\u00a0: ce qui "
            'suit a été repris comme sous-titre. Vérifiez la coupe dans «\u00a0Métadonnées des '
            "articles\u00a0»\u00a0– titre et sous-titre ne se composent pas de la même façon.",
            'Das Dokument enthielt nur einen Titel, mit einem Doppelpunkt darin: was '
            'darauf folgt, wurde als Untertitel übernommen. Prüfen Sie die Trennung unter '
            '«Metadaten der Artikel» – Titel und Untertitel werden nicht gleich '
            'gesetzt.')

    # Tableau de fin avec des e-mails, non lu, et aucun auteur venu d'un tableau : la fiche
    # n'aura que des noms (ni fonction, ni affiliation, ni e-mail, ni portrait). Le
    # tableau reste dans le corps ; c'est signalé.
    if refuses_parlants and not auteurs_table:
        avertir(
            'tableau-auteurs-non-lu',
            ['article « %s »' % slug, 'tableaux %d' % refuses_parlants],
            "Le tableau des autrices et auteurs de cet article n’a pas pu être lu\u00a0: la "
            'fiche ne porte que les noms lus sous le titre, sans fonction, affiliation, '
            'e-mail ni portrait, et le tableau reste imprimé dans le texte. Vérifiez '
            '«\u00a0Métadonnées des articles\u00a0» et complétez à la main, ou remettez chaque '
            'personne dans sa propre cellule (nom, fonction, e-mail) dans le Word puis '
            "réimportez l’article.",
            'Die Tabelle der Autorinnen und Autoren dieses Artikels konnte nicht '
            'gelesen werden: die Metadaten enthalten nur die Namen aus der Titelzeile, '
            'ohne Funktion, Institution, E-Mail und Porträt, und die Tabelle bleibt im '
            'Text gedruckt. Prüfen Sie «Metadaten der Artikel» und ergänzen Sie von '
            'Hand, oder setzen Sie im Word jede Person in ihre eigene Zelle (Name, '
            'Funktion, E-Mail) und importieren Sie den Artikel neu.')

    # Crédit de photo parti avec le tableau des auteurs : la fiche n'a pas de champ pour
    # lui, il ne s'imprimera plus. Signalé.
    if credits_photo:
        avertir(
            'credit-photo-non-repris',
            ['article « %s »' % slug] + ['crédit « %s »' % c for c in credits_photo],
            'Le tableau des autrices et auteurs portait %d crédit(s) de photo (%s)\u00a0: la '
            "fiche n’a pas de champ pour les reprendre et ils ne s’imprimeront plus. "
            'Reportez-les où ils doivent paraître si le numéro doit les mentionner.'
            % (len(credits_photo), ' ; '.join(credits_photo)),
            'Die Tabelle der Autorinnen und Autoren enthielt %d Bildnachweis(e) (%s): '
            'die Metadaten haben kein Feld dafür, und sie werden nicht mehr gedruckt. '
            'Übertragen Sie sie dorthin, wo sie erscheinen sollen, falls die Ausgabe '
            'sie nennen muss.' % (len(credits_photo), ' ; '.join(credits_photo)))

    # Références après la liste, sans son style : elles restent dans le texte, ni ancrées
    # ni exportées avec les autres. À corriger dans le Word.
    if biblio.get('restees'):
        avertir(
            'biblio-references-restees',
            ['article « %s »' % slug, 'references %d' % biblio['restees']],
            '%d référence(s) suivent la bibliographie sans porter son style dans le '
            'document Word\u00a0: elles restent dans le texte, à part de la liste. Pour les '
            'rattacher\u00a0: appliquez-leur le style de bibliographie dans le Word, puis '
            "réimportez l’article." % biblio['restees'],
            '%d Einträge folgen dem Literaturverzeichnis, ohne im Word-Dokument dessen '
            'Formatvorlage zu tragen: sie bleiben im Text, ausserhalb der Liste. So '
            'hängen Sie sie an: weisen Sie ihnen im Word die Formatvorlage für '
            'Literaturverzeichnisse zu und importieren Sie den Artikel neu.'
            % biblio['restees'])

    # Bibliographie annoncée par un titre, mais sans paragraphe stylé : elle reste dans le
    # corps, et l'export OJS partira sans références. Signalé.
    if biblio['voie'] == 'titre-seul':
        avertir(
            'biblio-non-detachee',
            ['article « %s »' % slug],
            "La bibliographie de cet article n’a pas pu être mise à part\u00a0: ses "
            'références ne portent pas le style de bibliographie dans le document Word. '
            "Elle reste dans le texte et s’imprimera normalement\u00a0; en revanche l’export "
            "vers la plateforme partira sans liste de références. Pour la corriger\u00a0: "
            'appliquez le style de bibliographie aux références dans le Word, puis '
            "réimportez l’article.",
            'Das Literaturverzeichnis dieses Artikels konnte nicht ausgelagert werden: '
            'seine Einträge tragen im Word-Dokument nicht die Formatvorlage für '
            'Literaturverzeichnisse. Es bleibt im Text und wird normal gedruckt; der '
            'Export auf die Plattform geht dagegen ohne Literaturliste. So korrigieren '
            'Sie es: weisen Sie den Einträgen im Word die Formatvorlage für '
            'Literaturverzeichnisse zu und importieren Sie den Artikel neu.')

    # Instructions pour import-medias.py, écrites même si la fiche existait : les photos
    # doivent quitter media/, sinon elles seraient supprimées. Les lignes G protègent les
    # photos reconnues mais non associées.
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
            f.write('L\t%s\n' % langue)
            for t in consommes_p:
                f.write('P\t%s\n' % t)
            if logos:
                f.write('G\t%d\n' % logos)
            for k in tables_consommees:
                f.write('T\t%d\n' % k)
            for t in lignes_f:
                f.write('F\t%s\n' % t)
            if ligne_bt:
                f.write('BT\t%s\n' % ligne_bt)
            for t in lignes_b:
                f.write('B\t%s\n' % t)

    stats.update({
        'type': type_article, 'type_regle': type_regle,
        'langue': langue, 'langue_source': langue_source,
        'langue_detectee': langue_detectee or '',
        'titre': bool(titre_parts), 'titre_source': titre_source or 'aucun',
        'sous_titre': bool(sous_titre_parts),
        'sous_titre_source': sous_titre_source or 'aucun',
        'resumes': sorted(k for k in resumes if k and resumes[k]),
        'keywords': {k: len(v) for k, v in meta['keywords'].items()},
        'doi': doi,
        'auteurs': {'n': len(author), 'source': auteurs_source,
                    'emails': sum(1 for a in author if a.get('email')),
                    'fonctions': sum(1 for a in author if a.get('fonction')),
                    'photos': photos,
                    'photos_appariees': len(photos_appariees),
                    'photos_gardees': len(photos_connues) - len(photos_appariees)},
        'tableaux_consommes': tables_consommees,
        'tableaux_refuses_parlants': refuses_parlants,
        'credits_photo': credits_photo,
        'legendes_figures_style': len(lignes_f),
        'biblio': biblio,
        'logo': logos,
        'paragraphes_retires': len(consommes_p),
        'meta_ecrit': meta_ecrit,
    })
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
