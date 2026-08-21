#!/usr/bin/env python3
# docx-meta.py — pré-pass d'import : extrait les métadonnées d'un .docx avant pandoc.
#
#   python3 docx-meta.py <fichier.docx> <slug> <dossier-article>
#
# Produit <dossier-article>/<slug>.meta.yaml — seulement s'il n'existe pas déjà, ce fichier
# appartenant au formulaire du cockpit — une ligne JSON de stats sur stdout, et, si la
# variable $SZH_META est posée, un fichier d'instructions pour les autres maillons de la
# chaîne d'import, une par ligne, « LETTRE<TAB>valeur » :
#   Y  type d'article détecté (article|editorial|documentation)
#   L  langue du document
#   P  paragraphe consommé à retirer du corps, et seulement ceux que pandoc ne mange pas
#      déjà (les styles Title/Subtitle/Author/Abstract partent d'eux-mêmes)
#   G  nombre de paragraphes-image de tête à retirer (logo licence CC)
#   T  k-ième tableau de premier niveau consommé (tableau des auteurs), lu par
#      docx-tables.py et par szh-meta.lua : lisant la même liste, ils restent alignés
#   F  légende de figure détectée par style et voisine d'une image, pour szh-legendes.lua
#
# Écrit aussi, si $SZH_PHOTOS est posée, ce qu'il a compris des photos du tableau des
# auteurs, une instruction par ligne, pour import-medias.py :
#   A  <slug-auteur><TAB><nom dans media/>  photo appariée : à ranger dans portraits/ et à
#      détourer. Le champ `photo` du meta.yaml, écrit ici, pointe l'original ; c'est
#      import-medias.py qui le promeut en .sans-fond.png quand le détourage réussit.
#   G  <nom dans media/>                    image reconnue comme photo d'auteur mais non
#      appariée : à garder, la purge des images inutilisées ne doit pas l'effacer. Le
#      tableau des auteurs étant consommé du corps, ces images ne sont citées nulle part.
#
# Détection par style d'abord (w:styleId et nom localisé de styles.xml), repli heuristique
# sinon : gras et taille pour le titre, motif « liste de noms » pour les auteurs. Patron de
# tête des deux revues : Titel [Untertitel] Author Abstract(Résumé)
# Abstract(Zusammenfassung) « Keywords: … » « DOI: … » ligne de revue [logo CC], puis le
# corps ; tableau des auteurs en fin de document.
#
# Règle d'or : ne jamais perdre de texte — un bloc incertain reste dans le corps. Le YAML
# suit l'ordre canonique du cockpit, guillemets échappés comme dans lib/yaml.js.
# stdlib uniquement : pas de PyYAML dans la WSL.

import json
import os
import re
import sys
import unicodedata
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
V = '{urn:schemas-microsoft-com:vml}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'

# Jetons de type reconnus par le cockpit (TYPES_ARTICLE de lib/yaml.js).
TYPES_VALIDES = ('article', 'editorial', 'interview', 'varia', 'tribune-libre',
                 'documentation')
LANGUES_META = ('fr', 'de', 'it')          # ordre d'écriture du YAML (cockpit)
CHAMPS_AUTEUR = ('prenom', 'nom', 'fonction', 'affiliation', 'orcid', 'email', 'photo')
# Formats qu'accepte le dépôt de photo du cockpit (EXTENSIONS_PHOTO d'extension.js) et donc
# le pipeline de portraits : une image d'un autre format n'est pas appariée.
EXTENSIONS_PORTRAIT = ('png', 'jpg', 'jpeg', 'webp')

# rId -> nom du fichier tel que pandoc l'extrait sous media/. Rempli dans principal(), le
# zip étant refermé ensuite.
RELS_IMAGES = {}

# ---------------------------------------------------------------------------------
# Texte et normalisation. normaliser() doit rester identique à celle de docx-titres.py et
# de szh-titres.lua : c'est elle qui apparie les paragraphes dans les filtres.


def normaliser(t):
    """Espaces spéciaux -> espace, tirets spéciaux -> '-', espaces compactés, rogné."""
    for a, b in ((' ', ' '), (' ', ' '), (' ', ' '),
                 ('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


def texte_paragraphe(p):
    """Texte plat d'un w:p : t -> texte, tab -> espace, br et cr -> espace. Le stringify
    de pandoc rend LineBreak par un espace, et l'appariement Lua en dépend."""
    morceaux = []
    for r in p.iter(W + 'r'):
        for e in r:
            if e.tag == W + 't':
                morceaux.append(e.text or '')
            elif e.tag in (W + 'tab', W + 'br', W + 'cr'):
                morceaux.append(' ')
    return ''.join(morceaux)


def actif(prop):
    if prop is None:
        return False
    return prop.get(W + 'val') not in ('false', '0', 'none')


def a_image(el):
    """L'élément contient-il une image (DrawingML ou VML hérité) ?"""
    return (next(el.iter(A + 'blip'), None) is not None
            or next(el.iter(W + 'drawing'), None) is not None
            or next(el.iter(W + 'pict'), None) is not None)


def charger_rels_images(z):
    """word/_rels/document.xml.rels : rId -> nom de fichier sous media/. pandoc extrait
    les médias en gardant leur basename (--extract-media), et docx-tables.py lit la même
    table pour fabriquer ses <img src="media/…"> : les trois restent alignés."""
    rels = {}
    try:
        racine = ET.fromstring(z.read('word/_rels/document.xml.rels'))
    except Exception:
        return rels
    ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    for rel in racine.iter(ns + 'Relationship'):
        cible = (rel.get('Target') or '').replace('\\', '/')
        if 'media/' in cible:
            rels[rel.get('Id')] = os.path.basename(cible)
    return rels


def images_de(el):
    """[(nom sous media/, surface déclarée)] des images de `el`, dans l'ordre du document.
    La surface vient de wp:extent (EMU²) ; elle vaut 0 quand la taille n'est pas déclarée,
    ce qui est le cas du VML hérité."""
    trouvees = []
    for dessin in el.iter(W + 'drawing'):
        blip = dessin.find('.//' + A + 'blip')
        if blip is None:
            continue
        nom = RELS_IMAGES.get(blip.get(R + 'embed') or '')
        if not nom:
            continue
        surface = 0
        extent = dessin.find('.//' + WP + 'extent')
        if extent is not None:
            try:
                surface = int(extent.get('cx', '0')) * int(extent.get('cy', '0'))
            except (TypeError, ValueError):
                surface = 0
        trouvees.append((nom, surface))
    for donnees in el.iter(V + 'imagedata'):
        nom = RELS_IMAGES.get(donnees.get(R + 'id') or '')
        if nom:
            trouvees.append((nom, 0))
    return trouvees


def photo_de(el):
    """Nom du fichier de la photo d'une cellule : la plus grande image déclarée, et non la
    première. Une cellule de portrait porte parfois un fragment décoratif en plus du visage
    (filet, icône, morceau d'image recadré), et prendre la première donnerait la vignette
    pour le portrait — puis la purge effacerait le portrait, que rien ne citerait plus."""
    trouvees = images_de(el)
    if not trouvees:
        return None
    return max(trouvees, key=lambda t: t[1])[0]


def slugifier_portrait(prenom, nom):
    """Nom de base d'un fichier de portrait. À garder aligné sur slugifier() de
    vscodium-extension/szh-cockpit/lib/slug.js : c'est le cockpit qui relit ces noms
    (decomposerPhoto) et qui les recalcule quand on redépose une photo — une divergence
    laisserait deux jeux de fichiers pour la même personne. Même ordre qu'en JS :
    retrait d'une pseudo-extension, ligatures, NFD sans diacritiques, minuscules, puis
    tout ce qui n'est pas [a-z0-9] en tiret."""
    s = re.sub(r'\.[^.]*$', '', (prenom + '-' + nom))
    for a, b in (('œ', 'oe'), ('Œ', 'oe'), ('æ', 'ae'), ('Æ', 'ae'), ('ß', 'ss')):
        s = s.replace(a, b)
    s = re.sub(r'[\u0300-\u036f]', '', unicodedata.normalize('NFD', s))
    s = re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')
    return s or 'article'


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
# Styles : classification par styleId et par nom localisé (styles.xml). pandoc mappe en
# métadonnées les paragraphes dont le nom de style est Title, Subtitle, Author, Abstract
# ou Date : ces blocs disparaissent du corps sans notre aide, aucune ligne P à émettre.

NOMS_PANDOC_META = {'title', 'subtitle', 'author', 'abstract', 'date'}


def charger_styles(z):
    """id -> nom (minuscules). styles.xml absent : dictionnaire vide (repli)."""
    try:
        racine = ET.fromstring(z.read('word/styles.xml'))
    except Exception:
        return {}
    styles = {}
    for st in racine.iter(W + 'style'):
        sid = st.get(W + 'styleId') or ''
        nom = st.find(W + 'name')
        styles[sid] = (nom.get(W + 'val') or '').lower() if nom is not None else ''
    return styles


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
        if nom == 'bibliography' or i.startswith('literaturverzeichnis') \
                or i in ('bibliographie', 'bibliografia', 'bibliography'):
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
        """pandoc mappe-t-il ce style en métadonnées (bloc absent du corps) ?"""
        return self.nom(sid) in NOMS_PANDOC_META


def pstyle(p):
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return ''
    ps = ppr.find(W + 'pStyle')
    return ps.get(W + 'val') if ps is not None else ''


# ---------------------------------------------------------------------------------
# Déclencheurs multilingues en tête de paragraphe. La langue d'un résumé vient de son
# déclencheur ; celle des mots-clés vient de la langue du document, les deux revues
# écrivant « Keywords: » quel que soit l'idiome.

RE_RESUME = re.compile(
    r'^\s*(r[ée]sum[ée]|zusammenfassung|riassunto|abstract)\b\s*[:.]?\s*', re.I)
LANG_RESUME = {'resume': 'fr', 'zusammenfassung': 'de', 'riassunto': 'it'}
RE_KEYWORDS = re.compile(
    r'^\s*(keywords?|mots[- ]cl[ée]s?|schl[üu]sselw[öo]rter|schlagw[öo]rte?r?|'
    r'parole chiave)\b\s*[:.]?\s*', re.I)
RE_DOI_LIGNE = re.compile(r'^\s*doi\b\s*:?\s*', re.I)
RE_DOI = re.compile(r'\b(10\.\d{4,9}/[^\s<>"\']+)')
RE_JOURNAL = re.compile(
    r'^\s*(revue\s+suisse\s+de\s+p[ée]dagogie|'
    r'schweizerische\s+zeitschrift\s+f[üu]r\s+heilp[äa]dagogik)', re.I)


def langue_resume(declencheur):
    d = re.sub(r'[^a-z]', '', declencheur.lower().replace('é', 'e').replace('è', 'e'))
    return LANG_RESUME.get(d)          # None pour « abstract » (résolu en langue doc)


def nettoyer_doi(txt):
    m = RE_DOI.search(txt)
    if not m:
        return ''
    return m.group(1).rstrip('.,;:)]}')


def langue_du_doi(doi):
    """10.57161/r2023-03-08 -> fr ; 10.57161/z2026-03-01 -> de (préfixe de revue)."""
    m = re.search(r'/([rz])\d{4}-', doi)
    if not m:
        return None
    return 'fr' if m.group(1) == 'r' else 'de'


def decouper_keywords(texte, langue_doc):
    """Ligne de mots-clés -> map langue -> [mots]. Cas bilingue des deux revues :
    « kw fr, kw fr / kw de, kw de » — un slash espacé, des virgules des deux côtés — donne
    la moitié gauche à la langue du document et la droite à l'autre. Sinon tout va dans la
    langue du document, découpé sur , ; · et « / » espacé."""
    langue_doc = langue_doc if langue_doc in LANGUES_META else 'fr'
    moities = re.split(r'\s+/\s+', texte)
    if len(moities) == 2 and ',' in moities[0] and ',' in moities[1] \
            and langue_doc in ('fr', 'de'):
        autre = 'de' if langue_doc == 'fr' else 'fr'
        return {langue_doc: decouper_liste(moities[0]), autre: decouper_liste(moities[1])}
    return {langue_doc: decouper_liste(' ; '.join(moities))}


def decouper_liste(texte):
    mots = []
    for m in re.split(r'[;,·]', texte):
        m = m.strip().strip('.').strip()
        if m:
            mots.append(m)
    return mots


# ---------------------------------------------------------------------------------
# Ligne d'auteurs (byline sous le titre) et cellules du tableau des auteurs.

CONNECTEURS = re.compile(
    r',?\s*(?:en\s+collaboration\s+avec|in\s+zusammenarbeit\s+mit|'
    r'unter\s+mitarbeit\s+von|avec\s+la\s+collaboration\s+de)\s+'
    r'|\s+(?:et|und|and|&|avec|mit)\s+'
    r'|\s*[,;]\s*', re.I)
PARTICULES = {'de', 'von', 'van', 'der', 'den', 'da', 'di', 'du', 'le', 'la', 'a',
              'ten', 'ter', 'te', 'zu', 'zur', 'vom', 'am', 'y', 'e', 'dos', 'del'}
TITRES_ACAD = {'dr', 'dre', 'drs', 'dott', 'ssa', 'prof', 'pd', 'dres', 'phil', 'lic', 'iur', 'med', 'rer', 'nat',
               'dipl', 'msc', 'ma', 'ba', 'bsc', 'phd', 'em', 'hab', 'habil', 'des',
               'hc', 'mag', 'mlaw', 'blaw', 'msed', 'edd', 'mba', 'ms', 'mph', 'ing',
               'paed', 'päd', 'soz', 'pol', 'oec', 'hsg', 'msw', 'bsw', 'ded', 'sc',
               'h', 'c', 'univ', 'doz', 'priv'}
RE_EMAIL = re.compile(r'\b([\w.+-]+@[\w-]+(?:\.[\w-]+)+)\b')
RE_ORCID = re.compile(r'\b(\d{4}-\d{4}-\d{4}-\d{3}[\dxX])\b')


def _sans_titres_academiques(t):
    """Retire les titres académiques en tête (« Dr. phil. Romain Lanners »), et après la
    première virgule s'il n'y a que des titres (« L. Tönnissen, lic. phil. »)."""
    t = t.replace('†', ' ').strip().strip(',;').strip()
    morceaux = t.split(',', 1)
    if len(morceaux) == 2:
        queue = [x.strip('. ').lower() for x in morceaux[1].replace('/', ' ').split()]
        if queue and all(x in TITRES_ACAD for x in queue if x):
            t = morceaux[0]
    jetons = t.split()
    while jetons and jetons[0].rstrip('.').lower() in TITRES_ACAD:
        jetons.pop(0)
    while jetons and jetons[-1].rstrip('.').lower() in TITRES_ACAD:
        jetons.pop()
    return ' '.join(jetons).strip().strip(',;').strip()


# Lignes-préfixes de rôle dans les cellules du tableau des auteurs (« Article rédigé
# par », « En collaboration avec », « Entretien réalisé par »…) : elles précèdent le nom
# sur leur propre ligne et sont sautées, le schéma d'auteur n'ayant pas de champ rôle.
RE_ROLE = re.compile(
    r'^(article\s+r[ée]dig[ée]\s+par|en\s+collaboration\s+avec|'
    r'entretien\s+(r[ée]alis[ée]|men[ée])\s+par|propos\s+recueillis\s+par|'
    r'avec,?\s+comme\s+invit[ée]e?s?|interview\s+(gef[üu]hrt\s+von|mit)|'
    r'ein\s+interview\s+(mit|von)|im\s+gespr[äa]ch\s+mit|'
    r'unter\s+mitarbeit\s+von|in\s+zusammenarbeit\s+mit)\s*:?\s*$', re.I)


def _decouper_ligne_nom(t):
    """(nom_nettoye, reste_fonction) : si la partie avant la première virgule est un nom
    plausible, la queue, débarrassée des titres académiques de tête, amorce la fonction —
    « Sabrina Eigenmann, MA Studienleitung MAS IF » donne (« Sabrina Eigenmann »,
    « Studienleitung MAS IF »)."""
    nettoye = _sans_titres_academiques(t)
    if nom_plausible(nettoye):
        return nettoye, ''
    morceaux = t.split(',', 1)
    if len(morceaux) == 2:
        gauche = _sans_titres_academiques(morceaux[0])
        if nom_plausible(gauche):
            jetons = morceaux[1].split()
            while jetons and jetons[0].rstrip('.').lower() in TITRES_ACAD:
                jetons.pop(0)
            return gauche, ' '.join(jetons).strip()
    return '', ''


def nom_plausible(t):
    """« Prénom Nom » plausible : 2-6 jetons, capitalisés (particules tolérées),
    pas de chiffre, pas d'e-mail, longueur bornée."""
    if not t or len(t) > 60 or any(c.isdigit() for c in t) or '@' in t:
        return False
    jetons = t.split()
    if not 2 <= len(jetons) <= 6:
        return False
    capitalises = 0
    for j in jetons:
        base = j.strip('.,;«»"()')
        if not base:
            return False
        if base[0].isupper():
            capitalises += 1
        elif base.lower() not in PARTICULES:
            return False
    return capitalises >= 2


def decouper_prenom_nom(t):
    """Découpe prudente : premier jeton = prénom, le reste = nom (« Anne-Françoise de
    Chambrier », « Rachel Sermier Dessemontet »). Un seul jeton : tout dans nom."""
    jetons = t.split()
    if len(jetons) >= 2:
        return jetons[0], ' '.join(jetons[1:])
    return '', t


def auteurs_depuis_byline(txt):
    """« A B, C D et E F » -> [{prenom, nom}] ; segment non plausible -> tout en nom."""
    auteurs = []
    for part in CONNECTEURS.split(txt):
        part = (part or '').strip().strip(',;').replace('†', '').strip()
        if not part:
            continue
        part = _sans_titres_academiques(part)
        if not part:
            continue
        if nom_plausible(part):
            prenom, nom = decouper_prenom_nom(part)
        else:
            prenom, nom = '', part
        auteurs.append({'prenom': prenom, 'nom': nom})
    return auteurs


# --- cellules du tableau des auteurs -----------------------------------------------

def lignes_cellule(tc):
    """Lignes de texte d'une cellule : chaque w:p et chaque w:br découpe. Retourne
    [(texte, sep)] où sep vaut 'p' (nouveau paragraphe) ou 'br' (saut de ligne interne),
    pour joindre une affiliation multi-lignes sans fausse virgule."""
    lignes = []
    for enfant in tc:
        if enfant.tag != W + 'p':
            continue                      # tableau imbriqué : cellule non-auteur ailleurs
        sep = 'p'
        courant = []
        for r in enfant.iter(W + 'r'):
            for e in r:
                if e.tag == W + 't':
                    courant.append(e.text or '')
                elif e.tag == W + 'tab':
                    courant.append(' ')
                elif e.tag in (W + 'br', W + 'cr'):
                    t = normaliser(''.join(courant))
                    if t:
                        lignes.append((t, sep))
                        sep = 'br'
                    courant = []
        t = normaliser(''.join(courant))
        if t:
            lignes.append((t, sep))
    return lignes


def cellule_auteur(tc):
    """Cellule « auteur » : lignes de rôle sautées, puis 1ʳᵉ ligne = nom plausible (titres
    académiques tolérés, queue « , MA Fonction » acceptée) et (e-mail présent ou au moins
    2 lignes). Retourne le dict auteur, ou None."""
    lignes = lignes_cellule(tc)
    while lignes and RE_ROLE.match(lignes[0][0]):
        lignes.pop(0)                     # « Article rédigé par », « En collab. avec »…
    if not lignes:
        return None
    premier, amorce_fonction = _decouper_ligne_nom(lignes[0][0])
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
            # e-mail collé en fin de ligne (« PH Luzern bruno.zobrist@phlu.ch ») : le
            # reste de la ligne est une info à part entière.
            reste = normaliser(txt.replace(m.group(1), ' '))
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
    # fonction = 1ʳᵉ ligne d'info, complétée par la suivante si elle reste en suspens
    # (& / et / und / virgule) ou si la suivante commence en minuscule (« Parent d'un
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


def _apparier(sans_photo, libres):
    """Apparie des cellules-photos à des auteurs sans photo, dans l'ordre, et seulement
    si les comptes concordent : mieux vaut aucune photo qu'une photo sur la mauvaise
    personne."""
    if not libres or len(libres) != len(sans_photo):
        return
    for a, nom in zip(sans_photo, libres):
        a['_image'] = nom


def analyser_table_auteurs(tbl):
    """(est_tableau_auteurs, [auteurs], nb_photos, {images des cellules-photos}). Strict :
    toute cellule non vide doit être soit une image seule (photo), soit une cellule auteur —
    une seule cellule de prose libre suffit à laisser le tableau dans le corps.

    Chaque auteur reçoit dans '_image' le nom du fichier de sa photo sous media/ quand
    l'appariement est sûr : l'image de sa propre cellule d'abord, sinon les cellules-photos
    de la même rangée prises dans l'ordre, sinon celles du tableau entier (patron d'une
    rangée d'images au-dessus d'une rangée de textes). Rien n'est posé si les comptes ne
    concordent pas.

    Le quatrième membre porte TOUTES les images des cellules qui tiennent une photo, pas
    seulement celles retenues : le tableau part du corps, ces fichiers ne sont donc plus
    cités nulle part, et la purge des images inutilisées ne doit pas pouvoir emporter un
    portrait sur une erreur d'appariement."""
    auteurs = []
    photos = 0
    libres_table = []
    connues = set()
    for tr in (x for x in tbl if x.tag == W + 'tr'):
        rangee_auteurs = []
        rangee_libres = []
        for tc in (x for x in tr if x.tag == W + 'tc'):
            if next(tc.iter(W + 'tbl'), None) is not None:
                return False, [], 0, set()   # tableau imbriqué : pas un bloc auteurs
            texte = normaliser(' '.join(texte_paragraphe(p)
                                        for p in tc if p.tag == W + 'p'))
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
                return False, [], 0, set()
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
    return (len(auteurs) > 0), auteurs, photos, connues


# ---------------------------------------------------------------------------------
# Type d'article — conservateur : documentation/editorial sur signaux explicites.

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
# Sérialisation YAML, à garder alignée sur lib/yaml.js (serialiserMeta, citerFrontmatter) :
# tout est cité "…", \ et " échappés, fins de ligne LF, clés vides omises.

def citer(v):
    return '"' + re.sub(r'([\\"])', r'\\\1', str(v)) + '"'


def serialiser_meta(meta):
    lignes = []
    if meta.get('type') in TYPES_VALIDES:
        lignes.append('type: ' + meta['type'])
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

def blocs_du_corps(racine):
    body = racine.find(W + 'body')
    if body is None:
        return []
    return [e for e in body if e.tag in (W + 'p', W + 'tbl')]


def principal(argv):
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
        # Non bloquant : l'import continue sans métadonnées (comme docx-titres.py).
        print('[docx-meta] lecture impossible de %s : %s' % (chemin_docx, e),
              file=sys.stderr)
        chemin_meta = os.getenv('SZH_META')
        if chemin_meta:
            open(chemin_meta, 'w', encoding='utf-8', newline='\n').close()
        print(json.dumps({'slug': slug, 'erreur': str(e)}, ensure_ascii=False))
        return 0

    classeur = Classeur(styles)
    blocs = blocs_du_corps(racine)
    nblocs = max(1, len(blocs))

    # ---- 1) Machine de tête : consomme les blocs de métadonnées jusqu'au corps ----
    titre_parts, sous_titre_parts = [], []
    byline = ''
    resumes = {}                          # lang -> texte (None = langue doc, résolue après)
    keywords_brut = None                  # texte après déclencheur
    doi = ''
    langue = None
    consommes_p = []                      # lignes P (texte normalisé)
    logos = 0
    dernier_resume = None                 # langue du dernier résumé (continuations)
    titre_source = ''
    i = 0
    while i < len(blocs) and i < 25:
        e = blocs[i]
        if e.tag == W + 'tbl':
            break
        sid = pstyle(e)
        fam = classeur.famille(sid)
        txt = normaliser(texte_paragraphe(e))
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
            titre_parts.append(txt)
            titre_source = 'style'
            consommer()
        elif fam == 'subtitle':
            if not titre_parts:
                # « Dokumentation » : Untertitel en tout premier bloc = titre de fait.
                titre_parts.append(txt)
                titre_source = 'style-sous-titre'
            else:
                sous_titre_parts.append(txt)
            consommer()
        elif fam == 'author':
            byline = (byline + ', ' + txt) if byline else txt
            consommer()
        elif RE_KEYWORDS.match(txt):
            keywords_brut = RE_KEYWORDS.sub('', txt, count=1).strip()
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
                corps_resume = RE_RESUME.sub('', txt, count=1).strip()
                cle = lang                # None (« Abstract ») = langue doc
                if cle in resumes and resumes[cle]:
                    resumes[cle] += ' ' + corps_resume
                else:
                    resumes[cle] = corps_resume
                dernier_resume = cle
            elif dernier_resume is not None or dernier_resume in resumes:
                resumes[dernier_resume] = (resumes.get(dernier_resume, '')
                                           + ' ' + txt).strip()
            else:
                resumes[None] = txt
                dernier_resume = None
            consommer()
        else:
            break                         # premier bloc non reconnu : le corps commence
        i += 1
    fin_tete = i

    # ---- 1bis) Repli heuristique du titre, si aucun style Title/Subtitle n'est trouvé --
    if not titre_parts:
        # taille dominante du corps pour situer « nettement plus grand »
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
                titre_parts.append(txt)
                titre_source = 'heuristique'
                if not classeur.pandoc_mange(pstyle(e)):
                    consommes_p.append(txt)
                # sous-titre heuristique : bloc suivant, plus grand que le corps
                # mais plus petit que le titre, court, non byline
                if j + 1 < len(blocs) and blocs[j + 1].tag == W + 'p':
                    e2 = blocs[j + 1]
                    txt2 = normaliser(texte_paragraphe(e2))
                    t2 = taille_max(e2)
                    if txt2 and len(txt2.split()) <= 30 and t2 and t and t2 < t \
                            and taille_corps and t2 > taille_corps \
                            and not auteurs_depuis_byline(txt2):
                        sous_titre_parts.append(txt2)
                        if not classeur.pandoc_mange(pstyle(e2)):
                            consommes_p.append(txt2)
            break

    # ---- 1ter) Repli heuristique de la byline, si aucun style Author --------------
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
        # Dernier recours, pour les documents sans revue, DOI ni résumé : sondage de
        # mots-outils sur les premiers paragraphes, fiable entre fr et de.
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
    if not langue:
        langue = 'fr'
        langue_source = 'defaut'
        stats['avertissements'].append('langue-indeterminee')
    if None in resumes:                   # « Abstract » sans langue -> langue du doc
        texte = resumes.pop(None)
        if langue not in resumes or not resumes[langue]:
            resumes[langue] = texte
        else:
            stats['avertissements'].append('resume-abstract-ignore')

    # ---- 3) Tableau(x) des auteurs en fin de document ----------------------------
    tables = [(idx, e) for idx, e in enumerate(blocs) if e.tag == W + 'tbl']
    tables_consommees = []                # ordinaux 1-based (ordre du document)
    auteurs_table = []
    photos = 0
    photos_connues = set()                # images des cellules-photos, à ne pas purger
    premier_tbl_consomme = None           # indice de bloc du 1er tableau consommé
    for k in range(len(tables) - 1, -1, -1):
        idx_bloc, tbl = tables[k]
        if idx_bloc / nblocs < 0.4:       # jamais un bloc auteurs si tôt (corpus : >= 0.53)
            break
        ok, auteurs, nb_photos, connues = analyser_table_auteurs(tbl)
        if not ok:
            break
        tables_consommees.insert(0, k + 1)
        auteurs_table = auteurs + auteurs_table
        photos += nb_photos
        photos_connues |= connues
        premier_tbl_consomme = idx_bloc

    # L'en-tête de section au-dessus du tableau consommé (« Autrices et auteurs »,
    # « Zur Person »…) partirait orphelin : on le consomme aussi. Uniquement un titre
    # stylé, court, au lexique auteurs et collé au tableau, paragraphes vides enjambés —
    # szh-meta.lua apparie aussi les Header.
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

    # ---- 4) Fusion byline / tableau ----------------------------------------------
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

    # ---- 4b) Photos des auteur·e·s ------------------------------------------------
    # Le champ `photo` désigne le fichier tel qu'il sera après le déplacement fait par
    # import-medias.py, qui lit le fichier d'appariement écrit plus bas. Il pointe
    # l'original, seul fichier certain d'exister ; le détourage réussi le promeut en
    # .sans-fond.png, la version que le formulaire du cockpit propose par défaut.
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
            continue                      # deux fois le même nom : on s'abstient
        if nom_image in fichiers_vus:
            # Word réutilise un seul fichier pour deux insertions identiques : le déplacer
            # deux fois laisserait le second auteur avec un `photo` qui ne désigne rien.
            stats['avertissements'].append('photo-fichier-partage-ignore')
            continue
        bases_vues.add(base)
        fichiers_vus.add(nom_image)
        a['photo'] = 'portraits/%s.original.%s' % (base, ext)
        photos_appariees.append((base, nom_image))
    for a in auteurs_table:
        a.pop('_image', None)             # jamais sérialisé, mais rien ne traîne

    # ---- 5) Type d'article --------------------------------------------------------
    # La liste de références n'est pas touchée ici : elle reste dans le corps, telle que la
    # rédaction l'a écrite. C'est szh-citations.lua qui l'ancre à la compilation.
    type_article, type_regle = detecter_type(
        chemin_docx, ' '.join(titre_parts), doi)

    # ---- 6) Légendes de figures par STYLE (voisines d'une image) -----------------
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

    # ---- 7) meta.yaml (jamais écrasé), $SZH_META et stats ------------------------
    meta = {
        'type': type_article,
        'doi': doi,
        'title': {langue: ' '.join(titre_parts)} if titre_parts else {},
        'subtitle': {langue: ' '.join(sous_titre_parts)} if sous_titre_parts else {},
        'resume': {k: v for k, v in resumes.items() if k and v},
        'keywords': decouper_keywords(keywords_brut, langue) if keywords_brut else {},
        'author': author,
    }
    chemin_meta_yaml = os.path.join(dossier, slug + '.meta.yaml')
    meta_ecrit = False
    if os.path.exists(chemin_meta_yaml):
        # Réimport forcé : ce fichier appartient au formulaire du cockpit, on ne le
        # réécrit pas ; les instructions de retrait restent émises, pour un corps propre.
        stats['avertissements'].append('meta-existant-conserve')
    else:
        contenu = serialiser_meta(meta)
        if contenu:
            with open(chemin_meta_yaml, 'w', encoding='utf-8', newline='\n') as f:
                f.write(contenu)
            meta_ecrit = True

    # Ce que import-medias.py doit savoir des photos, écrit dans tous les cas : sur un
    # meta.yaml conservé (ré-import), aucun champ `photo` n'a été posé, mais les photos
    # doivent quand même quitter media/ — sinon la purge les effacerait, et le premier
    # import les avait déjà rangées sous les mêmes noms. Les lignes G protègent les images
    # reconnues comme photos sans avoir été appariées.
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

    stats.update({
        'type': type_article, 'type_regle': type_regle,
        'langue': langue, 'langue_source': langue_source,
        'titre': bool(titre_parts), 'titre_source': titre_source or 'aucun',
        'sous_titre': bool(sous_titre_parts),
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
        'legendes_figures_style': len(lignes_f),
        'logo': logos,
        'paragraphes_retires': len(consommes_p),
        'meta_ecrit': meta_ecrit,
    })
    print(json.dumps(stats, ensure_ascii=False))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
