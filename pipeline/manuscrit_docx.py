#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Lecteur .docx du nettoyeur de manuscrit. lire() rend le modèle riche de manuscrit_modele.py ;
# projeter_pronto() rend exactement ce que pronto_docx.lire() rend sur le même fichier. Ce
# module lit seulement : il ne classe pas les titres et ne nettoie pas la mise en forme. Voir
# docs/ARCHITECTURE-nettoyeur-manuscrit.md.
#
# Repris de ooxml_lecture.py, comme pronto_docx.py, pour que les deux lecteurs ne divergent
# pas : résolution de style (charger_styles, pstyle, resoudre_style), marqueurs de page
# (compter_marqueurs_page), blocs de premier niveau (blocs_du_corps). niveau_depuis_style() et
# normaliser() viennent de pronto_modele.py. Le reste (runs, mise en forme directe, liens,
# images DrawingML, fusions verticales, révisions, commentaires, notes) est propre à ce module.
# Bibliothèque standard seule, sans python-docx ni lxml.
#
# Points à connaître :
#
# - `Fragment.texte` garde les tirets du document (–, —, ‑). Seul projeter_pronto() les
#   normalise, comme pronto_docx.lire() ; sinon le filtre typographique (règle T2) ne les
#   verrait plus. Les espaces ne sont pas compactées fragment par fragment : un mot coupé sur
#   une espace de run la perdrait.
# - Un ancrage flottant sans `<a:blip>` (rectangle, groupe de formes) n'est pas une image : il
#   est compté dans `forme_vectorielle_ignoree`. Beaucoup sont dans un `mc:AlternateContent`
#   deux niveaux sous leur `w:r`, d'où le dépliage de `_enfants_utiles`. `mc:Fallback` est
#   ignoré (il répète `mc:Choice`), sauf quand la Choice n'a aucune image et que le Fallback
#   porte un `<v:imagedata>` (`_images_fantomes_du_repli`).
# - Les zones de texte, en-têtes et pieds de page et champs Word ne sont pas lus ici
#   (pronto_docx.py et docx-meta.py les couvrent pour les anciens fichiers) ; ils sont
#   recensés.
# - projeter_pronto() part du Document déjà construit. Il ne diverge de pronto_docx.lire() que
#   pour une fusion verticale (w:vMerge, masquée ici) et une image VML non résolue.
# - `w:noBreakHyphen` rend U+2011 ; `w:tab`, `w:br` et `w:cr` rendent '\t' et '\n', que le
#   nettoyage cherche en tête et en fin de paragraphe. `w:sym` est lu (`_rendu_sym`).
#   `w:fldSimple` est traversé comme conteneur. Les `w:sdt` de niveau bloc sont dépliés avant
#   tout parcours (`_deplier_sdt_niveau_bloc`), sinon leurs paragraphes disparaîtraient.
# - `word/endnotes.xml` se lit comme les notes de bas de page, avec un identifiant décalé
#   au-delà du plus grand id de footnote (`_decalage_notes_fin`). `Document.notes` est un
#   dict {id: contenu}.
# - Les images VML se comptent par identifiant distinct ; elles sont récupérées quand leur
#   relation mène à un média présent dans l'archive (`_images_depuis_vml`).
# - `Image.source` porte l'indice du `w:p` qui contient l'image, `Fragment.source` celui du
#   `w:r` (voir `indice_paragraphe` dans `_fragments_de_run`).
# - Une liste se résout aussi depuis un `numPr` hérité du style de paragraphe
#   (`_numpr_depuis_style`). `numId="0"` (Word : « retire la numérotation héritée ») rend None.
# - `_compter_revisions()` compte aussi footnotes.xml et endnotes.xml.
# - `Fragment.effectif` et `Paragraphe.alignement_effectif` : mise en forme effective, prise
#   dans la forme directe, sinon le style de caractère (w:rStyle), sinon la chaîne des styles
#   de paragraphe (w:pStyle → w:basedOn → …), sinon docDefaults (`_index_styles_complet`,
#   `_chaine_styles`, `_forme_effective`).

import hashlib
import json
import os
import posixpath
import re
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET
from collections import namedtuple

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun
import ooxml_lecture
import pronto_docx
import pronto_modele as pm
import manuscrit_modele as mm

# Contexte de lecture, calculé une fois par document par lire() et transmis aux fonctions
# qui en ont besoin, jusque dans les cellules et les notes.
#   numerotation        {(numId, ilvl): 'puce'|'numero'|''} : voir _charger_numerotation
#   index_styles        {styleId: {'basedOn', 'ppr', 'rpr'}} : voir _index_styles_complet
#   rpr_defaut, ppr_defaut   Element|None de w:docDefaults : voir _index_styles_complet
#   decalage_notes_fin  int à ajouter à l'identifiant brut d'une note de fin pour qu'il ne
#                        rencontre aucun identifiant de footnote (voir lire()).
Contexto = namedtuple('Contexto', ('numerotation', 'index_styles', 'rpr_defaut', 'ppr_defaut',
                                    'decalage_notes_fin'))

from ooxml_lecture import W, A, R, WP, PKG_RELS, MC, V

# Conteneurs de w:r qui n'ajoutent ni texte ni lien : révisions (w:ins, w:del, comptées à
# part par _compter_revisions), contenu structuré de niveau run (le niveau bloc est traité
# par _deplier_sdt_niveau_bloc) et w:fldSimple (sa valeur affichée est un w:r enfant). On les
# traverse : un document en suivi de modifications, que la CLI refusera ensuite, doit rester
# lisible.
_CONTENEURS_PASSE_PLAT = (W + 'ins', W + 'del', W + 'smartTag', W + 'customXml',
                          W + 'sdt', W + 'sdtContent', W + 'fldSimple')

# w:t et w:delText (texte d'une suppression suivie) comptent tous deux comme texte.
_TAGS_TEXTE = (W + 't', W + 'delText')

# Types de notes techniques, qui ne sont pas des notes. 'continuationNotice' est le « … suite »
# que Word pose en bas d'une page où une note continue. lire() écarte en outre toute note
# jamais appelée dans le corps.
_TYPES_NOTE_TECHNIQUES = ('separator', 'continuationSeparator', 'continuationNotice')

# w:sym (Insertion > Symbole) : pas de w:t, seulement w:char (point de code hexadécimal) et
# w:font. U+F0B7, la puce de Wingdings et Symbol, devient « • ». Tout autre symbole de ces
# polices est rendu tel quel et recensé dans 'symboles_police_speciale' (voir _rendu_sym).
_MAP_SYM_PUCES = {0xF0B7: '•'}
_POLICES_SYMBOLES = ('wingdings', 'wingdings2', 'wingdings3', 'symbol', 'webdings')

PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# ---------------------------------------------------------------------------------
# Texte d'un run, tirets du document conservés (voir l'en-tête).

def _rendu_sym(el, recensement):
    """Le caractère d'un w:sym (voir _MAP_SYM_PUCES). '' si w:char est illisible ou hors de
    la plage Unicode, pour ne pas faire échouer la lecture pour un symbole."""
    brut = el.get(W + 'char') or ''
    try:
        point = int(brut, 16)
    except ValueError:
        return ''
    if not (0 <= point <= 0x10FFFF):
        return ''
    police = (el.get(W + 'font') or '').lower()
    if police in _POLICES_SYMBOLES:
        if point in _MAP_SYM_PUCES:
            return _MAP_SYM_PUCES[point]
        # Police à correspondance non standard : caractère repris tel quel, et recensé.
        recensement['symboles_police_speciale'] += 1
        recensement.setdefault('polices_symboles_vues', set()).add(el.get(W + 'font') or police)
    return chr(point)


def _enfants_utiles(el):
    """Les enfants de `el` (un w:r), avec chaque mc:AlternateContent remplacé par le contenu
    de sa première branche mc:Choice. mc:Fallback répète le même contenu en VML pour les
    anciens Word : le lire aussi doublerait chaque dessin. Sans ce dépliage, un
    r.findall(W + 'drawing') ne verrait pas les ancrages enveloppés deux niveaux plus bas."""
    resultat = []
    for enfant in el:
        if enfant.tag == MC + 'AlternateContent':
            choix = enfant.find(MC + 'Choice')
            if choix is not None:
                resultat.extend(list(choix))
        else:
            resultat.append(enfant)
    return resultat


def _texte_depuis_enfants(enfants, recensement):
    """Texte des enfants d'un run. w:tab rend '\\t' et w:br/w:cr rendent '\\n', que
    nettoyer_mise_en_forme() cherche en tête et en fin de paragraphe. projeter_pronto() n'en
    est pas affecté : pronto_modele.normaliser() les ramène à une espace, comme
    pronto_docx.lire()."""
    morceaux = []
    for e in enfants:
        if e.tag in _TAGS_TEXTE:
            morceaux.append(e.text or '')
        elif e.tag == W + 'tab':
            morceaux.append('\t')
        elif e.tag in (W + 'br', W + 'cr'):
            morceaux.append('\n')
        elif e.tag == W + 'noBreakHyphen':
            morceaux.append('‑')  # trait d'union insécable U+2011
        elif e.tag == W + 'sym':
            morceaux.append(_rendu_sym(e, recensement))
        # w:softHyphen (césure facultative) est ignoré, comme dans pronto_docx.texte_paragraphe.
    return ''.join(morceaux)


# ---------------------------------------------------------------------------------
# Mise en forme directe d'un w:rPr, sans la cascade des styles : le nettoyage ne vise que la
# mise en forme manuelle. Une balise absente vaut None (non déclaré) ; une balise à
# w:val="0", "false", "off" ou "none" vaut False (déclaré éteint). Les deux ne se confondent
# pas.

def _lire_onoff(rpr, tag):
    if rpr is None:
        return None
    el = rpr.find(W + tag)
    if el is None:
        return None
    val = el.get(W + 'val')
    if val is None:
        return True
    return val.lower() not in ('0', 'false', 'off', 'none')


def _lire_souligne(rpr):
    """w:u porte une énumération (single, double, wave, none…). Sans w:val, le soulignement
    est actif ; "none" l'éteint."""
    if rpr is None:
        return None
    el = rpr.find(W + 'u')
    if el is None:
        return None
    val = (el.get(W + 'val') or '').lower()
    return val not in ('none', '0', 'false')


def _lire_vertalign(rpr):
    """(exposant, indice). w:vertAlign vaut baseline, superscript ou subscript : présent, il
    déclare les deux champs (baseline les met à False) ; absent, les deux restent None."""
    if rpr is None:
        return None, None
    el = rpr.find(W + 'vertAlign')
    if el is None:
        return None, None
    val = (el.get(W + 'val') or '').lower()
    return val == 'superscript', val == 'subscript'


def _lire_police(rpr):
    if rpr is None:
        return None
    el = rpr.find(W + 'rFonts')
    if el is None:
        return None
    return el.get(W + 'ascii') or el.get(W + 'hAnsi') or el.get(W + 'cs') or el.get(W + 'eastAsia')


def _lire_taille(rpr):
    if rpr is None:
        return None
    el = rpr.find(W + 'sz')
    if el is None:
        return None
    try:
        return int(el.get(W + 'val'))
    except (TypeError, ValueError):
        return None


def _lire_val_brut(rpr, tag):
    if rpr is None:
        return None
    el = rpr.find(W + tag)
    if el is None:
        return None
    return el.get(W + 'val')


def _forme_directe(rpr):
    exposant, indice = _lire_vertalign(rpr)
    return mm.nouvelle_forme(
        gras=_lire_onoff(rpr, 'b'),
        italique=_lire_onoff(rpr, 'i'),
        souligne=_lire_souligne(rpr),
        exposant=exposant,
        indice=indice,
        barre=_lire_onoff(rpr, 'strike'),
        petites_capitales=_lire_onoff(rpr, 'smallCaps'),
        majuscules=_lire_onoff(rpr, 'caps'),
        police=_lire_police(rpr),
        taille=_lire_taille(rpr),
        couleur=_lire_val_brut(rpr, 'color'),
        surlignage=_lire_val_brut(rpr, 'highlight'),
    )


def _lire_rstyle(rpr):
    """Le style de caractère (w:rStyle) de ce rPr, ou None. Le style de paragraphe (w:pStyle)
    se résout par ooxml_lecture.resoudre_style et pstyle."""
    if rpr is None:
        return None
    el = rpr.find(W + 'rStyle')
    return el.get(W + 'val') if el is not None else None


# ---------------------------------------------------------------------------------
# Mise en forme effective (Fragment.effectif) : directe (w:rPr du run), sinon style de
# caractère (w:rStyle), sinon chaîne des styles de paragraphe (w:pStyle → w:basedOn → …),
# sinon w:docDefaults/w:rPrDefault. Elle permet de comparer un corps sans taille déclarée et
# un faux titre déclaré à 12 pt, qui font tous deux 12 pt. `forme` reste la mise en forme
# directe, seule visée par le nettoyage.
#
# _index_styles_complet lit styles.xml une fois par document, pour les attributs hérités.
# pronto_docx.charger_styles ne garde que id → nom, ce qui sert aux noms affichés.

def _index_styles_complet(z):
    """{styleId: {'basedOn': styleId|None, 'ppr': Element|None, 'rpr': Element|None}}, plus
    (rPrDefault, pPrDefault) de w:docDefaults. Sert à la mise en forme effective et au numPr
    hérité d'un style (_numpr_depuis_style). Sans styles.xml : index vide et deux None, la
    mise en forme effective se réduit alors à la forme directe."""
    try:
        racine = ET.fromstring(z.read('word/styles.xml'))
    except Exception:
        return {}, None, None
    index = {}
    for st in racine.iter(W + 'style'):
        sid = st.get(W + 'styleId') or ''
        if not sid:
            continue
        based = st.find(W + 'basedOn')
        index[sid] = {'basedOn': based.get(W + 'val') if based is not None else None,
                      'ppr': st.find(W + 'pPr'), 'rpr': st.find(W + 'rPr')}
    dd = racine.find(W + 'docDefaults')
    rpr_defaut = ppr_defaut = None
    if dd is not None:
        rprdef = dd.find(W + 'rPrDefault')
        rpr_defaut = rprdef.find(W + 'rPr') if rprdef is not None else None
        pprdef = dd.find(W + 'pPrDefault')
        ppr_defaut = pprdef.find(W + 'pPr') if pprdef is not None else None
    return index, rpr_defaut, ppr_defaut


def _chaine_styles(style_id, index_styles):
    """[style_id, parent, grand-parent, ...] en remontant w:basedOn. Un styleId déjà vu
    arrête la remontée : une boucle basedOn (styles.xml corrompu) figerait la lecture."""
    chaine = []
    vus = set()
    while style_id and style_id not in vus and style_id in index_styles:
        vus.add(style_id)
        chaine.append(style_id)
        style_id = index_styles[style_id]['basedOn']
    return chaine


def _fusionner_forme(base, complement):
    """Remplit les clés encore None de `base` avec celles de `complement`. Un champ déjà
    déclaré est gardé : la source la plus proche l'emporte."""
    for cle in mm.FORME_CLES:
        if base.get(cle) is None and complement.get(cle) is not None:
            base[cle] = complement[cle]
    return base


def _forme_depuis_chaine(style_id, index_styles, base):
    """Comble les trous de `base` (modifié en place) en remontant la chaîne basedOn de
    `style_id`. S'arrête quand les 12 clés sont déclarées."""
    for sid in _chaine_styles(style_id, index_styles):
        rpr = index_styles.get(sid, {}).get('rpr')
        if rpr is not None:
            _fusionner_forme(base, _forme_directe(rpr))
        if all(base.get(c) is not None for c in mm.FORME_CLES):
            break
    return base


def _forme_effective(forme_directe, rstyle_id, pstyle_id, index_styles, rpr_defaut):
    """Directe, puis style de caractère, puis chaîne des styles de paragraphe, puis
    docDefaults."""
    effectif = dict(forme_directe)
    if any(effectif.get(c) is None for c in mm.FORME_CLES) and rstyle_id:
        _forme_depuis_chaine(rstyle_id, index_styles, effectif)
    if any(effectif.get(c) is None for c in mm.FORME_CLES) and pstyle_id:
        _forme_depuis_chaine(pstyle_id, index_styles, effectif)
    if any(effectif.get(c) is None for c in mm.FORME_CLES) and rpr_defaut is not None:
        _fusionner_forme(effectif, _forme_directe(rpr_defaut))
    return effectif


def _numpr_depuis_style(style_id, index_styles):
    """Le premier w:numPr trouvé en remontant la chaîne basedOn de `style_id`. Un style de
    liste porte son numPr dans son propre w:pPr, pas dans celui du paragraphe qui
    l'applique."""
    for sid in _chaine_styles(style_id, index_styles):
        ppr = index_styles.get(sid, {}).get('ppr')
        if ppr is not None:
            numpr = ppr.find(W + 'numPr')
            if numpr is not None:
                return numpr
    return None


def _alignement_depuis_style(style_id, index_styles, ppr_defaut):
    for sid in _chaine_styles(style_id, index_styles):
        ppr = index_styles.get(sid, {}).get('ppr')
        if ppr is not None:
            jc = ppr.find(W + 'jc')
            if jc is not None:
                return jc.get(W + 'val') or ''
    if ppr_defaut is not None:
        jc = ppr_defaut.find(W + 'jc')
        if jc is not None:
            return jc.get(W + 'val') or ''
    return ''


# ---------------------------------------------------------------------------------
# Relations du paquet : médias et liens (pronto_docx.charger_rels_images ne garde que les
# médias).

def charger_relations(z):
    rels = {}
    try:
        racine = ET.fromstring(z.read('word/_rels/document.xml.rels'))
    except Exception:
        return rels
    for rel in racine.iter(PKG_RELS + 'Relationship'):
        rels[rel.get('Id')] = rel.get('Target') or ''
    return rels


def _chemin_media(cible):
    """Chemin dans l'archive .docx d'une cible média : relative à word/, sauf si elle
    commence par '/' (rare, absolue depuis la racine du paquet)."""
    cible = cible.replace('\\', '/')
    if cible.startswith('/'):
        return cible.lstrip('/')
    return posixpath.normpath('word/' + cible)


def _resoudre_lien_hyperlink(el, rels):
    rid = el.get(R + 'id')
    if rid:
        return rels.get(rid) or None
    ancre = el.get(W + 'anchor')
    return ('#' + ancre) if ancre else None


# ---------------------------------------------------------------------------------
# Dimensions en pixels du fichier image, et non de sa boîte d'affichage (wp:extent, cx/cy en
# EMU, la taille à laquelle Word l'affiche). Seules les premières disent si l'image tiendra à
# l'impression ; ce module mesure, `qualite-image.js` juge.
#
# Le format se reconnaît à la signature des octets, pas à l'extension, comme dans
# lib/medias.js#lireDimensionsImage (mêmes décalages pour PNG, GIF et JPEG ; BMP en plus ici).
#
# Les formats vectoriels (SVG, EMF, WMF), qui n'ont pas de résolution, et les fichiers
# tronqués ou illisibles rendent (0, 0) sans lever (voir _dimensions_image()).

def _dimensions_png(octets):
    """PNG : signature de 8 octets, puis le chunk IHDR, toujours premier (4 octets de
    longueur, 4 octets 'IHDR', puis largeur et hauteur en 32 bits gros-boutistes). D'où les
    octets 16 à 24.

    Pas de contrôle de longueur ici : struct.unpack lève sur un fichier tronqué, et le `try`
    de _dimensions_image() est le seul filet, commun aux quatre lecteurs. Une garde locale
    rendrait ce filet impossible à éprouver."""
    if octets[:8] != b'\x89PNG\r\n\x1a\n' or octets[12:16] != b'IHDR':
        return 0, 0
    largeur, hauteur = struct.unpack('>II', octets[16:24])
    return largeur, hauteur


def _dimensions_gif(octets):
    """GIF : signature de 6 octets ('GIF87a' ou 'GIF89a'), puis largeur et hauteur en
    16 bits petit-boutistes. Fichier tronqué : voir _dimensions_png()."""
    if octets[:3] != b'GIF':
        return 0, 0
    largeur, hauteur = struct.unpack('<HH', octets[6:10])
    return largeur, hauteur


def _dimensions_bmp(octets):
    """BMP : en-tête de fichier de 14 octets ('BM'…), puis BITMAPINFOHEADER : 4 octets de
    taille, puis largeur et hauteur en 32 bits signés petit-boutistes, dès l'octet 18. Une
    hauteur négative (bitmap « top-down ») est rendue en valeur absolue. Fichier tronqué :
    voir _dimensions_png()."""
    if octets[:2] != b'BM':
        return 0, 0
    largeur, hauteur = struct.unpack('<ii', octets[18:26])
    return abs(largeur), abs(hauteur)


# JPEG : la plage des marqueurs SOF (0xFFC0-0xFFCF) contient trois marqueurs qui n'en sont
# pas : 0xFFC4 (DHT, table de Huffman), 0xFFC8 (JPG, réservé) et 0xFFCC (DAC, table
# arithmétique). Les prendre pour un SOF donnerait des dimensions absurdes, sans erreur.
_SOF_JPEG_EXCLUS = (0xC4, 0xC8, 0xCC)


def _dimensions_jpeg(octets):
    """JPEG : après le SOI (0xFFD8), une suite de marqueurs 0xFF + 1 octet. Les marqueurs
    sans charge (SOI, RST0-7, TEM) font 2 octets ; les autres sont suivis d'une longueur en
    16 bits gros-boutiste, qui se compte elle-même. Dans un SOF, après le marqueur (2) et la
    longueur (2) vient 1 octet de précision, puis la hauteur et la largeur en 16 bits
    gros-boutistes, dans cet ordre : d'où le décalage de 5."""
    n = len(octets)
    if n < 4 or octets[0:2] != b'\xff\xd8':
        return 0, 0
    i = 2
    # Borne contre un fichier brouillé : aucun JPEG réel n'a des milliers de segments.
    segments = 0
    while i + 4 <= n and segments < 4096:
        segments += 1
        if octets[i] != 0xFF:
            return 0, 0  # désynchronisé : en-tête illisible
        marqueur = octets[i + 1]
        if marqueur == 0xFF:
            i += 1  # bourrage : des 0xFF répétés avant le vrai marqueur, autorisés par la norme
            continue
        if marqueur in (0xD8, 0x01) or 0xD0 <= marqueur <= 0xD7:
            i += 2  # marqueurs sans charge utile (SOI redondant, RSTn, TEM)
            continue
        if marqueur in (0xD9, 0xDA):
            return 0, 0  # EOI ou SOS atteint sans avoir vu de SOF : image mal formée
        if 0xC0 <= marqueur <= 0xCF and marqueur not in _SOF_JPEG_EXCLUS:
            # Pas de contrôle `i + 9 > n` : voir _dimensions_png().
            hauteur, largeur = struct.unpack('>HH', octets[i + 5:i + 9])
            return largeur, hauteur
        taille_segment = struct.unpack('>H', octets[i + 2:i + 4])[0]
        if taille_segment < 2:
            return 0, 0
        i += 2 + taille_segment
    return 0, 0


def _dimensions_image(octets):
    """(largeur, hauteur) selon la signature des octets, pour PNG, JPEG, GIF et BMP ; (0, 0)
    pour tout le reste (SVG, EMF, WMF, fichier tronqué ou inconnu). Ce `try` est le seul
    filet contre un fichier tronqué : l'erreur d'un des quatre lecteurs donne (0, 0) au lieu
    de faire échouer la lecture du manuscrit."""
    try:
        if octets[:8] == b'\x89PNG\r\n\x1a\n':
            return _dimensions_png(octets)
        if octets[:2] == b'\xff\xd8':
            return _dimensions_jpeg(octets)
        if octets[:3] == b'GIF':
            return _dimensions_gif(octets)
        if octets[:2] == b'BM':
            return _dimensions_bmp(octets)
    except Exception:
        return 0, 0
    return 0, 0


# ---------------------------------------------------------------------------------
# Images DrawingML (ancrages sans image : voir l'en-tête).

def _image_depuis_drawing(dessin, rels, z, recensement):
    conteneur = dessin.find(WP + 'inline')
    flottante = False
    if conteneur is None:
        conteneur = dessin.find(WP + 'anchor')
        flottante = True
    if conteneur is None:
        return None
    blip = dessin.find('.//' + A + 'blip')
    if blip is None:
        recensement['forme_vectorielle_ignoree'] += 1
        return None
    rid = blip.get(R + 'embed') or ''
    cible = rels.get(rid, '')
    # Comme pronto_docx.charger_rels_images : une relation sans 'media/' n'est pas une image.
    # Les deux lecteurs doivent s'accorder pour que projeter_pronto() reste exact.
    if 'media/' not in cible:
        recensement['image_sans_relation'] += 1
        return None
    nom = os.path.basename(cible.replace('\\', '/'))
    octets = b''
    try:
        octets = z.read(_chemin_media(cible))
    except KeyError:
        recensement['image_octets_introuvables'] += 1
    # cx et cy sont gardés à part ; `surface` (leur produit) reste pour ses lecteurs. La
    # résolution se tire de largeur_px et hauteur_px.
    cx = cy = surface = 0
    extent = conteneur.find(WP + 'extent')
    if extent is not None:
        try:
            cx = int(extent.get('cx', '0'))
            cy = int(extent.get('cy', '0'))
            surface = cx * cy
        except (TypeError, ValueError):
            cx = cy = surface = 0
    docpr = conteneur.find(WP + 'docPr')
    alt = (docpr.get('descr') or '') if docpr is not None else ''
    largeur_px = hauteur_px = 0
    if octets:
        largeur_px, hauteur_px = _dimensions_image(octets)
        if largeur_px == 0 and hauteur_px == 0:
            # Fichier lu mais sans dimensions (vectoriel ou abîmé) : recensé. Une image sans
            # octets est déjà comptée dans 'image_octets_introuvables'.
            recensement['image_dimensions_indisponibles'] += 1
    return mm.Image(nom=nom, octets=octets, surface=surface, alt=alt, flottante=flottante,
                     cx=cx, cy=cy, largeur_px=largeur_px, hauteur_px=hauteur_px)


# ---------------------------------------------------------------------------------
# Aplatissement d'un paragraphe en [(w:r, lien ou None), ...], dans l'ordre du document. Un
# w:hyperlink donne son lien à tous les runs qu'il contient ; les conteneurs de
# _CONTENEURS_PASSE_PLAT sont traversés. Les marqueurs sans texte (signets, w:proofErr,
# bornes de commentaire…) ne produisent rien.

def _runs_de_paragraphe(p, rels):
    resultat = []

    def marcher(elements, lien_courant):
        for el in elements:
            if el.tag == W + 'r':
                resultat.append((el, lien_courant))
            elif el.tag == W + 'hyperlink':
                marcher(list(el), _resoudre_lien_hyperlink(el, rels))
            elif el.tag in _CONTENEURS_PASSE_PLAT:
                marcher(list(el), lien_courant)

    marcher(list(p), None)
    return resultat


# ---------------------------------------------------------------------------------
# Images VML (w:pict, mc:Fallback). Un même r:id peut se répéter dans un groupe : on compte
# et on récupère chaque r:id distinct dont la relation mène à un média présent dans
# l'archive. Une image irrécupérable rejoint les compteurs des images DrawingML
# ('image_sans_relation', 'image_octets_introuvables'), signalés par lire().

def _images_depuis_vml(conteneur, rels, z, recensement):
    """Images d'un conteneur VML (w:pict ou mc:Fallback), une par r:id distinct de
    v:imagedata. cx, cy et le texte alternatif restent à leur valeur par défaut (0, ''). Un
    conteneur sans v:imagedata (rectangle, connecteur…) compte une fois dans
    'image_vml_ignoree'."""
    images = []
    vus = set()
    trouve_imagedata = False
    for d in conteneur.iter(V + 'imagedata'):
        trouve_imagedata = True
        rid = d.get(R + 'id')
        if rid and rid in vus:
            continue  # même image déjà vue dans ce groupe
        cible = rels.get(rid, '') if rid else ''
        if not rid or 'media/' not in cible:
            recensement['image_sans_relation'] += 1
            continue
        vus.add(rid)
        try:
            octets = z.read(_chemin_media(cible))
        except KeyError:
            recensement['image_octets_introuvables'] += 1
            continue
        largeur_px, hauteur_px = _dimensions_image(octets) if octets else (0, 0)
        nom = os.path.basename(cible.replace('\\', '/'))
        images.append(mm.Image(nom=nom, octets=octets, largeur_px=largeur_px,
                                hauteur_px=hauteur_px))
    if not trouve_imagedata:
        recensement['image_vml_ignoree'] += 1
    return images


def _images_du_repli_fantome(r, rels, z, recensement):
    """Images portées par le seul mc:Fallback d'un mc:AlternateContent. _enfants_utiles() ne
    lit que mc:Choice, qui d'ordinaire redit le même dessin. Mais une Choice peut n'être
    qu'un groupe de formes sans <a:blip> alors que son Fallback porte de vraies images
    (<v:imagedata>). On lit donc le Fallback seulement quand la Choice n'a aucune image, pour
    ne rien compter deux fois."""
    images = []
    for alt in r.findall(MC + 'AlternateContent'):
        choix = alt.find(MC + 'Choice')
        repli = alt.find(MC + 'Fallback')
        if choix is None or repli is None:
            continue
        dessin = choix.find(W + 'drawing')
        if dessin is None or dessin.find('.//' + A + 'blip') is not None:
            continue  # pas un dessin, ou image déjà présente côté Choice
        images.extend(_images_depuis_vml(repli, rels, z, recensement))
    return images


def _note_depuis_enfants(enfants, decalage_notes_fin):
    """L'identifiant du premier appel de note de ce run (décalé pour une note de fin, voir
    Contexto), ou None. Word n'en pose jamais deux dans un run."""
    for e in enfants:
        if e.tag == W + 'footnoteReference':
            try:
                return int(e.get(W + 'id'))
            except (TypeError, ValueError):
                return None
        if e.tag == W + 'endnoteReference':
            try:
                return int(e.get(W + 'id')) + decalage_notes_fin
            except (TypeError, ValueError):
                return None
    return None


def _fragments_de_run(r, lien, indice, indice_paragraphe, rels, z, recensement, ctx, pstyle_id):
    """`indice` : position du w:r dans son paragraphe (Fragment.source).
    `indice_paragraphe` : position du w:p dans le corps (Image.source)."""
    rpr = r.find(W + 'rPr')
    forme = _forme_directe(rpr)
    effectif = _forme_effective(forme, _lire_rstyle(rpr), pstyle_id, ctx.index_styles,
                                 ctx.rpr_defaut)
    images = _images_du_repli_fantome(r, rels, z, recensement)
    enfants = _enfants_utiles(r)
    for enfant in enfants:
        if enfant.tag == W + 'pict':
            images.extend(_images_depuis_vml(enfant, rels, z, recensement))
        elif enfant.tag == W + 'drawing':
            img = _image_depuis_drawing(enfant, rels, z, recensement)
            if img is not None:
                images.append(img)
    for img in images:
        img.source = indice_paragraphe
    note_id = _note_depuis_enfants(enfants, ctx.decalage_notes_fin)
    texte = _texte_depuis_enfants(enfants, recensement)
    fragments = [mm.Fragment(texte='', image=img, forme=forme, lien=lien, source=indice,
                              effectif=effectif) for img in images]
    if note_id is not None:
        # Comme pour une image, un fragment de note a un texte vide.
        fragments.append(mm.Fragment(texte='', image=None, forme=forme, lien=lien,
                                      source=indice, note=note_id, effectif=effectif))
    # Un run porte d'ordinaire du texte ou une image ou une note. S'il a du texte en plus, ou
    # rien du tout, on rend un Fragment texte : rien ne se perd et la liste n'est jamais vide.
    if texte or not fragments:
        fragments.append(mm.Fragment(texte=texte, image=None, forme=forme, lien=lien,
                                      source=indice, effectif=effectif))
    return fragments


# ---------------------------------------------------------------------------------
# Numérotation des listes (word/numbering.xml), résolue en trois sauts : le `w:numPr` du
# paragraphe donne un numId, `w:num` donne l'abstractNumId, et `w:abstractNum` porte par
# niveau (`w:lvl`) le `w:numFmt` qui dit puce ou numéro. Un format absent ou inconnu rend '' :
# c'est l'écrivain (manuscrit_gabarit.py) qui choisit alors, et le dit dans sa trace.

# Les w:numFmt numérotés de Word. Tout autre format, 'none' compris, rend ''.
_FORMATS_NUMEROTES = ('decimal', 'decimalZero', 'lowerLetter', 'upperLetter', 'lowerRoman',
                       'upperRoman', 'ordinal', 'cardinalText', 'ordinalText', 'hex', 'chicago',
                       'decimalEnclosedCircle', 'decimalFullWidth', 'aiueo', 'iroha',
                       'ganada', 'chosung')


def _numfmt_vers_type(numfmt):
    """'puce', 'numero' ou '' d'après un w:numFmt brut. 'none' (« pas de numérotation
    affichée ») et tout format inconnu rendent ''."""
    if numfmt == 'bullet':
        return 'puce'
    if numfmt in _FORMATS_NUMEROTES:
        return 'numero'
    return ''


def _charger_numerotation(z):
    """{(numId brut, ilvl brut): 'puce'|'numero'|''}, une fois par document. Sans
    `word/numbering.xml` (cas d'un .docx sans liste) : {}, et _liste_depuis() rend ''.

    Un `w:lvlOverride` qui porte son propre `w:lvl` redéfinit le format de ce niveau et
    l'emporte sur l'abstractNum (Word le pose quand on change la puce d'un niveau d'une liste
    existante). Un `w:startOverride` seul ne change que le numéro de départ : ignoré."""
    try:
        racine = ET.fromstring(z.read('word/numbering.xml'))
    except Exception:
        return {}

    niveaux_abstraits = {}          # abstractNumId -> {ilvl: numFmt brut}
    for absnum in racine.findall(W + 'abstractNum'):
        aid = absnum.get(W + 'abstractNumId')
        if aid is None:
            continue
        niveaux = {}
        for lvl in absnum.findall(W + 'lvl'):
            ilvl = lvl.get(W + 'ilvl')
            fmt_el = lvl.find(W + 'numFmt')
            niveaux[ilvl] = (fmt_el.get(W + 'val') or '') if fmt_el is not None else ''
        niveaux_abstraits[aid] = niveaux

    resultat = {}
    for num in racine.findall(W + 'num'):
        numid = num.get(W + 'numId')
        if numid is None:
            continue
        aid_el = num.find(W + 'abstractNumId')
        aid = aid_el.get(W + 'val') if aid_el is not None else None
        # Copie : un w:lvlOverride ne doit pas modifier la table de l'abstractNum, que
        # d'autres w:num référencent.
        niveaux_num = dict(niveaux_abstraits.get(aid, {}))
        for override in num.findall(W + 'lvlOverride'):
            ilvl = override.get(W + 'ilvl')
            lvl_override = override.find(W + 'lvl')
            if lvl_override is None:
                continue                      # simple w:startOverride : ne change pas le format
            fmt_el = lvl_override.find(W + 'numFmt')
            if fmt_el is not None:
                niveaux_num[ilvl] = fmt_el.get(W + 'val') or ''
        for ilvl, fmt in niveaux_num.items():
            resultat[(numid, ilvl)] = _numfmt_vers_type(fmt)
    return resultat


# ---------------------------------------------------------------------------------
# Paragraphe.

def _liste_depuis(ppr, style_id, ctx):
    """(numId, ilvl, type) de la liste du paragraphe, ou None. Le `numPr` vient du
    paragraphe, sinon de son style (_numpr_depuis_style) : un style de liste ne pose pas
    toujours un numPr sur chaque paragraphe. numId="0" retire toute numérotation héritée :
    pas de liste, donc None."""
    numpr = ppr.find(W + 'numPr') if ppr is not None else None
    if numpr is None and style_id:
        numpr = _numpr_depuis_style(style_id, ctx.index_styles)
    if numpr is None:
        return None
    numid_el = numpr.find(W + 'numId')
    if numid_el is None:
        return None
    numid_brut = numid_el.get(W + 'val')
    if numid_brut == '0':
        return None
    ilvl_brut = '0'
    ilvl_el = numpr.find(W + 'ilvl')
    if ilvl_el is not None and ilvl_el.get(W + 'val') is not None:
        ilvl_brut = ilvl_el.get(W + 'val')
    type_liste = ctx.numerotation.get((numid_brut, ilvl_brut), '')
    try:
        numid = int(numid_brut)
    except (TypeError, ValueError):
        numid = numid_brut
    try:
        ilvl = int(ilvl_brut)
    except (TypeError, ValueError):
        ilvl = 0
    return (numid, ilvl, type_liste)


def _alignement_retrait_depuis(ppr):
    alignement, retrait = '', 0
    if ppr is None:
        return alignement, retrait
    jc = ppr.find(W + 'jc')
    if jc is not None:
        alignement = jc.get(W + 'val') or ''
    ind = ppr.find(W + 'ind')
    if ind is not None:
        for attr in ('left', 'start', 'firstLine'):
            v = ind.get(W + attr)
            if v:
                try:
                    retrait = int(v)
                except ValueError:
                    retrait = 0
                break
    return alignement, retrait


def _paragraphe_depuis(p, styles, rels, z, recensement, indice, ctx):
    pstyle_brut = ooxml_lecture.pstyle(p)
    style_resolu = ooxml_lecture.resoudre_style(pstyle_brut, styles)
    niveau_declare = pm.niveau_depuis_style(style_resolu)
    fragments = []
    for i, (r, lien) in enumerate(_runs_de_paragraphe(p, rels)):
        fragments.extend(_fragments_de_run(r, lien, i, indice, rels, z, recensement, ctx,
                                            pstyle_brut))
    ppr = p.find(W + 'pPr')
    liste = _liste_depuis(ppr, pstyle_brut, ctx)
    alignement, retrait = _alignement_retrait_depuis(ppr)
    alignement_effectif = alignement or _alignement_depuis_style(pstyle_brut, ctx.index_styles,
                                                                   ctx.ppr_defaut)
    return mm.Paragraphe(style=style_resolu, niveau_declare=niveau_declare, niveau_retenu=0,
                          fragments=fragments, liste=liste, alignement=alignement,
                          retrait=retrait, source=indice,
                          alignement_effectif=alignement_effectif)


# ---------------------------------------------------------------------------------
# Tableaux : colspan (w:gridSpan, comme pronto_docx) et rowspan (w:vMerge, que pronto_docx ne
# gère pas). Une cellule masquée par une fusion verticale n'apparaît pas dans `rangees`. Le
# gridSpan ne masque rien : Word n'écrit pas de cellule pour les colonnes couvertes.

def _colspan(tc):
    tcpr = tc.find(W + 'tcPr')
    if tcpr is None:
        return 1
    gs = tcpr.find(W + 'gridSpan')
    if gs is None:
        return 1
    try:
        return int(gs.get(W + 'val') or '1')
    except ValueError:
        return 1


def _vmerge_continuation(tc):
    """True si ce w:tc continue une fusion verticale (cellule masquée) : w:vMerge sans w:val
    ou à "continue". w:val="restart" ouvre une fusion ; cette cellule porte le rowspan."""
    tcpr = tc.find(W + 'tcPr')
    if tcpr is None:
        return False
    vm = tcpr.find(W + 'vMerge')
    if vm is None:
        return False
    return (vm.get(W + 'val') or 'continue').lower() == 'continue'


def _ligne_est_entete(tr):
    trpr = tr.find(W + 'trPr')
    if trpr is None:
        return False
    el = trpr.find(W + 'tblHeader')
    if el is None:
        return False
    val = el.get(W + 'val')
    return val is None or val.lower() not in ('0', 'false', 'off', 'none')


def _deplier_sdt_niveau_bloc(container):
    """Remplace en place chaque w:sdt enfant direct de `container` par les enfants de son
    w:sdtContent, récursivement. Un contrôle de contenu de niveau bloc (formulaire Word,
    citation Zotero…) qui enveloppe des w:p les cacherait à blocs_du_corps(), qui ne voit que
    les w:p et w:tbl directs. Le niveau run est traité par _CONTENEURS_PASSE_PLAT. Un sdt
    sans sdtContent disparaît."""
    nouveaux = []
    for enfant in list(container):
        if enfant.tag == W + 'sdt':
            contenu = enfant.find(W + 'sdtContent')
            if contenu is not None:
                _deplier_sdt_niveau_bloc(contenu)
                nouveaux.extend(list(contenu))
        else:
            nouveaux.append(enfant)
    container[:] = nouveaux
    return container


def _blocs_enfants(container, styles, rels, z, recensement, ctx):
    """Les Paragraphe et Tableau enfants directs de `container` (un w:tc, un w:footnote…).
    `source` est la position locale dans ce conteneur, pas un chemin complet."""
    _deplier_sdt_niveau_bloc(container)
    resultat = []
    i = 0
    for enfant in container:
        if enfant.tag == W + 'p':
            resultat.append(_paragraphe_depuis(enfant, styles, rels, z, recensement, i, ctx))
            i += 1
        elif enfant.tag == W + 'tbl':
            resultat.append(_tableau_depuis(enfant, styles, rels, z, recensement, i, ctx))
            i += 1
    return resultat


def _cellule_depuis(tc, styles, rels, z, recensement, ctx):
    return mm.Cellule(colspan=_colspan(tc), rowspan=1, entete=False,
                       blocs=_blocs_enfants(tc, styles, rels, z, recensement, ctx))


def _tableau_depuis(tbl, styles, rels, z, recensement, indice, ctx, page=None):
    """`page` : calculée par lire() pour un tableau de premier niveau, comme
    pronto_docx.lire() ; None pour un tableau imbriqué."""
    pending = {}          # colonne -> Cellule en cours de fusion verticale
    rangees = []
    for tr in tbl:
        if tr.tag != W + 'tr':
            continue
        entete_ligne = _ligne_est_entete(tr)
        col = 0
        nouvelle_pending = {}
        rangee = []
        for tc in tr:
            if tc.tag != W + 'tc':
                continue
            largeur = _colspan(tc)
            if _vmerge_continuation(tc):
                cible = pending.get(col)
                if cible is not None:
                    cible.rowspan += 1
                    nouvelle_pending[col] = cible
                # Continuation sans cellule de départ (fichier mal formé) : masquée.
                col += largeur
                continue
            cellule = _cellule_depuis(tc, styles, rels, z, recensement, ctx)
            if entete_ligne:
                cellule.entete = True
            rangee.append(cellule)
            nouvelle_pending[col] = cellule
            col += largeur
        pending = nouvelle_pending
        rangees.append(rangee)
    return mm.Tableau(rangees=rangees, page=page, source=indice)


# ---------------------------------------------------------------------------------
# Document — langue déclarée, révisions, commentaires, notes de bas de page.

def _langue_declaree(z):
    """Langue du document : w:docDefaults/w:rPrDefault/w:rPr/w:lang de styles.xml (langue de
    correction par défaut des runs), sinon w:themeFontLang de settings.xml, sinon ''."""
    try:
        racine = ET.fromstring(z.read('word/styles.xml'))
    except Exception:
        racine = None
    if racine is not None:
        dd = racine.find(W + 'docDefaults')
        rprdef = dd.find(W + 'rPrDefault') if dd is not None else None
        rpr = rprdef.find(W + 'rPr') if rprdef is not None else None
        lang = rpr.find(W + 'lang') if rpr is not None else None
        if lang is not None:
            val = lang.get(W + 'val')
            if val:
                return val
    try:
        settings = ET.fromstring(z.read('word/settings.xml'))
    except Exception:
        return ''
    tfl = settings.find(W + 'themeFontLang')
    if tfl is not None:
        val = tfl.get(W + 'val')
        if val:
            return val
    return ''


def _racine_ou_none(z, chemin):
    """Racine d'un fichier XML facultatif de l'archive (footnotes.xml, endnotes.xml,
    comments.xml…), ou None s'il est absent ou illisible."""
    try:
        return ET.fromstring(z.read(chemin))
    except Exception:
        return None


def _compter_revisions(racine):
    return sum(1 for _ in racine.iter(W + 'ins')) + sum(1 for _ in racine.iter(W + 'del'))


def _compter_commentaires(z):
    racine = _racine_ou_none(z, 'word/comments.xml')
    if racine is None:
        return 0
    return sum(1 for _ in racine.iter(W + 'comment'))


def _decalage_notes_fin(racine_footnotes):
    """Le plus grand identifiant de note de bas de page (hors notes techniques), ou 0. Une
    note de fin reçoit son identifiant brut plus ce décalage : notes de bas de page et notes
    de fin ont chacune leur numérotation dans Word, et ne doivent pas se rencontrer dans
    Document.notes."""
    if racine_footnotes is None:
        return 0
    ids = []
    for fn in racine_footnotes.iter(W + 'footnote'):
        if fn.get(W + 'type') in _TYPES_NOTE_TECHNIQUES:
            continue
        try:
            ids.append(int(fn.get(W + 'id')))
        except (TypeError, ValueError):
            continue
    return max(ids) if ids else 0


def _notes_depuis_racine(racine, tag_note, styles, rels, z, recensement, ctx, decalage=0):
    """{id_final: [Paragraphe|Tableau, ...]}. `tag_note` : W+'footnote' (decalage=0) ou
    W+'endnote' (decalage=_decalage_notes_fin(...), voir lire())."""
    if racine is None:
        return {}
    notes = {}
    for fn in racine.iter(tag_note):
        if fn.get(W + 'type') in _TYPES_NOTE_TECHNIQUES:
            continue
        try:
            id_final = int(fn.get(W + 'id')) + decalage
        except (TypeError, ValueError):
            continue
        notes[id_final] = _blocs_enfants(fn, styles, rels, z, recensement, ctx)
    return notes


def _ids_notes_appelees(blocs):
    """{id, ...} des notes appelées par un Fragment.note dans `blocs`, cellules comprises.
    Une note de footnotes.xml ou endnotes.xml que rien n'appelle n'est pas une note du
    document. lire() l'applique au corps, puis aux notes retenues (une note peut en appeler
    une autre)."""
    ids = set()
    for b in blocs:
        if isinstance(b, mm.Tableau):
            for rangee in b.rangees:
                for c in rangee:
                    ids |= _ids_notes_appelees(c.blocs)
        else:
            for f in b.fragments:
                if f.note is not None:
                    ids.add(f.note)
    return ids


# ---------------------------------------------------------------------------------
# Point d'entrée n°1 : lire().

def lire(chemin):
    """Rend un manuscrit_modele.Document. Une erreur de lecture (zip invalide, document.xml
    absent ou mal formé) se propage, comme dans pronto_docx.lire()."""
    recensement = {'forme_vectorielle_ignoree': 0, 'image_sans_relation': 0,
                   'image_octets_introuvables': 0, 'image_vml_ignoree': 0,
                   'image_dimensions_indisponibles': 0, 'symboles_police_speciale': 0,
                   'polices_symboles_vues': set()}

    with zipfile.ZipFile(chemin) as z:
        noms = z.namelist()
        racine = ET.fromstring(z.read('word/document.xml'))
        racine_footnotes = _racine_ou_none(z, 'word/footnotes.xml')
        racine_endnotes = _racine_ou_none(z, 'word/endnotes.xml')
        styles_id_nom = ooxml_lecture.charger_styles(z)
        cle_gabarit = pronto_docx.lire_cle_gabarit(z)
        index_styles, rpr_defaut, ppr_defaut = _index_styles_complet(z)
        rels = charger_relations(z)
        langue = _langue_declaree(z)
        revisions = _compter_revisions(racine)
        if racine_footnotes is not None:
            revisions += _compter_revisions(racine_footnotes)
        if racine_endnotes is not None:
            revisions += _compter_revisions(racine_endnotes)
        commentaires = _compter_commentaires(z)
        numerotation = _charger_numerotation(z)
        decalage = _decalage_notes_fin(racine_footnotes)
        ctx = Contexto(numerotation=numerotation, index_styles=index_styles,
                       rpr_defaut=rpr_defaut, ppr_defaut=ppr_defaut,
                       decalage_notes_fin=decalage)

        notes = _notes_depuis_racine(racine_footnotes, W + 'footnote', styles_id_nom, rels, z,
                                      recensement, ctx)
        notes.update(_notes_depuis_racine(racine_endnotes, W + 'endnote', styles_id_nom, rels,
                                           z, recensement, ctx, decalage=decalage))
        # Déplié avant blocs_du_corps(), qui ne verrait pas un w:sdt de niveau bloc (voir
        # _deplier_sdt_niveau_bloc).
        body = racine.find(W + 'body')
        if body is not None:
            _deplier_sdt_niveau_bloc(body)

        elements = ooxml_lecture.blocs_du_corps(racine)
        marqueurs_total = sum(ooxml_lecture.compter_marqueurs_page(e) for e in elements)
        blocs = []
        cumul = 0
        for i, e in enumerate(elements):
            if e.tag == W + 'p':
                blocs.append(_paragraphe_depuis(e, styles_id_nom, rels, z, recensement, i, ctx))
            else:
                page = (1 + cumul) if marqueurs_total > 0 else None
                blocs.append(_tableau_depuis(e, styles_id_nom, rels, z, recensement, i, ctx,
                                              page=page))
            cumul += ooxml_lecture.compter_marqueurs_page(e)

        # Retrait des notes que rien n'appelle (voir _ids_notes_appelees()). Propagation
        # jusqu'à stabilité : une note retenue peut en appeler une autre, retenue aussi.
        ids_appelees = _ids_notes_appelees(blocs)
        changement = True
        while changement:
            changement = False
            for id_note in list(ids_appelees):
                pour_cette_note = _ids_notes_appelees(notes.get(id_note, []))
                nouveaux = pour_cette_note - ids_appelees
                if nouveaux:
                    ids_appelees |= nouveaux
                    changement = True
        notes_orphelines = {i: c for i, c in notes.items() if i not in ids_appelees}
        notes = {i: c for i, c in notes.items() if i in ids_appelees}

        n_entetes_pieds = sum(1 for n in noms if re.match(r'word/(header|footer)\d+\.xml$', n))
        n_txbx = sum(1 for _ in racine.iter(W + 'txbxContent'))
        n_fld = (sum(1 for _ in racine.iter(W + 'fldSimple'))
                 + sum(1 for _ in racine.iter(W + 'fldChar')))

    # Ce qui n'a pas été lu est signalé : un avertissement par famille, pas par occurrence.
    if n_entetes_pieds:
        avertir('entetes-pieds-non-lus',
                ['article', 'fichiers %d' % n_entetes_pieds],
                'Ce document porte %d en-tête(s)/pied(s) de page\u00a0: leur contenu n’est pas '
                'lu par le nettoyeur, qui ne regarde que le corps du document.' % n_entetes_pieds,
                'Dieses Dokument enthält %d Kopf-/Fußzeile(n): ihr Inhalt wird vom Bereiniger '
                'nicht gelesen, der nur den Dokumentkörper betrachtet.' % n_entetes_pieds)
    if n_txbx:
        avertir('zones-de-texte-non-lues',
                ['article', 'occurrences %d' % n_txbx],
                'Ce document porte %d zone(s) de texte\u00a0: leur contenu n’est pas lu, il '
                'sera absent de la sortie.' % n_txbx,
                'Dieses Dokument enthält %d Textfeld(er): ihr Inhalt wird nicht gelesen und '
                'fehlt in der Ausgabe.' % n_txbx)
    if n_fld:
        avertir('champs-word-non-resolus',
                ['article', 'marqueurs %d' % n_fld],
                'Ce document porte %d marqueur(s) de champ Word (renvoi, sommaire, numéro '
                'de page…)\u00a0: sa valeur affichée est lue comme du texte normal, mais elle ne '
                'sera jamais recalculée.' % n_fld,
                'Dieses Dokument enthält %d Word-Feldmarkierung(en) (Querverweis, '
                'Inhaltsverzeichnis, Seitenzahl…): ihr angezeigter Wert wird als normaler '
                'Text gelesen, aber nie neu berechnet.' % n_fld)
    if recensement['forme_vectorielle_ignoree']:
        avertir('formes-vectorielles-ignorees',
                ['article', 'occurrences %d' % recensement['forme_vectorielle_ignoree']],
                'Ce document porte %d dessin(s) flottant(s) ou en ligne sans image '
                'incorporée (rectangle, forme, groupe de formes)\u00a0: ils ne sont pas '
                'repris.' % recensement['forme_vectorielle_ignoree'],
                'Dieses Dokument enthält %d schwebende oder eingebettete Zeichnung(en) ohne '
                'eingebettetes Bild (Rechteck, Form, Formengruppe): sie werden nicht '
                'übernommen.' % recensement['forme_vectorielle_ignoree'])
    if recensement['image_vml_ignoree']:
        avertir('images-vml-ignorees',
                ['article', 'occurrences %d' % recensement['image_vml_ignoree']],
                'Ce document porte %d image(s) au format hérité (VML, w:pict)\u00a0: ce lecteur '
                'ne sait lire que les images modernes (DrawingML)\u00a0; elles ne sont pas '
                'reprises.' % recensement['image_vml_ignoree'],
                'Dieses Dokument enthält %d Bild(er) im veralteten Format (VML, w:pict): '
                'dieser Leser kann nur moderne Bilder (DrawingML) lesen; sie werden nicht '
                'übernommen.' % recensement['image_vml_ignoree'])
    if recensement['image_sans_relation'] or recensement['image_octets_introuvables']:
        avertir('images-introuvables',
                ['article', 'sans-relation %d' % recensement['image_sans_relation'],
                 'octets-introuvables %d' % recensement['image_octets_introuvables']],
                'Ce document référence une ou plusieurs images que ce lecteur n’a pas pu '
                'retrouver dans l’archive (relation absente ou fichier manquant, par '
                'exemple une image liée en externe)\u00a0: elles ne sont pas reprises.',
                'Dieses Dokument verweist auf ein oder mehrere Bilder, die dieser Leser im '
                'Archiv nicht wiederfinden konnte (fehlende Beziehung oder fehlende Datei, '
                'zum Beispiel ein extern verknüpftes Bild): sie werden nicht übernommen.')
    if recensement['image_dimensions_indisponibles']:
        avertir('images-dimensions-indisponibles',
                ['article', 'occurrences %d' % recensement['image_dimensions_indisponibles']],
                'Ce document porte %d image(s) dont les dimensions en pixels n’ont pas pu '
                'être lues (format vectoriel\u00a0– SVG, EMF, WMF\u00a0– ou fichier abîmé)\u00a0: la '
                'qualité de ces images ne peut pas être évaluée.'
                % recensement['image_dimensions_indisponibles'],
                'Dieses Dokument enthält %d Bild(er), deren Pixelabmessungen nicht gelesen '
                'werden konnten (Vektorformat – SVG, EMF, WMF – oder beschädigte Datei): '
                'die Qualität dieser Bilder kann nicht beurteilt werden.'
                % recensement['image_dimensions_indisponibles'])
    if recensement['symboles_police_speciale']:
        polices = ', '.join(sorted(recensement['polices_symboles_vues'])) or '?'
        avertir('symboles-police-speciale',
                ['article', 'occurrences %d' % recensement['symboles_police_speciale'],
                 'polices ' + polices],
                'Ce document porte %d caractère(s) composé(s) via Insertion > Symbole, dans '
                'une police à correspondance non standard (%s)\u00a0: le caractère est repris tel '
                'quel, sa fidélité doit être vérifiée à l’écran.'
                % (recensement['symboles_police_speciale'], polices),
                'Dieses Dokument enthält %d über Einfügen > Symbol erstellte(s) Zeichen in '
                'einer Schriftart mit nicht standardisierter Zuordnung (%s): das Zeichen wird '
                'unverändert übernommen, seine Richtigkeit muss am Bildschirm geprüft werden.'
                % (recensement['symboles_police_speciale'], polices))
    if notes_orphelines:
        avertir('notes-orphelines',
                ['article', 'occurrences %d' % len(notes_orphelines)],
                'Ce document porte %d note(s) de bas de page ou de fin présente(s) dans le '
                'fichier mais jamais appelée(s) par un renvoi dans le texte\u00a0: elles ne sont '
                'pas reprises.' % len(notes_orphelines),
                'Dieses Dokument enthält %d Fuß- oder Endnote(n), die in der Datei vorhanden '
                'sind, aber im Text nie durch einen Verweis aufgerufen werden: sie werden '
                'nicht übernommen.' % len(notes_orphelines))

    return mm.Document(blocs=blocs, styles=list(styles_id_nom.values()), langue=langue,
                        revisions=revisions, commentaires=commentaires, notes=notes,
                        source=None, cle_gabarit=cle_gabarit)


# ---------------------------------------------------------------------------------
# Point d'entrée n°2 : projeter_pronto(). Les écarts avec pronto_docx.lire() sont décrits
# dans l'en-tête.

def projeter_pronto(document):
    """Rend le modèle que pronto_docx.lire() rend sur le même fichier : une
    list[pronto_modele.Par | pronto_modele.Tableau]."""

    def texte_paragraphe(p):
        # Fragments concaténés, puis pm.normaliser_valeur() comme dans pronto_docx.lire() :
        # tabulation et saut de ligne deviennent une espace ; insécables et tirets restent.
        brut = ''.join(f.texte for f in p.fragments if f.image is None and f.note is None)
        return pm.normaliser_valeur(brut)

    def images_paragraphe(p):
        return [(f.image.nom, f.image.surface) for f in p.fragments if f.image is not None]

    def projeter_bloc(bloc):
        if isinstance(bloc, mm.Tableau):
            rangees = [[pm.Cellule(colspan=c.colspan,
                                    blocs=[projeter_bloc(b) for b in c.blocs])
                        for c in rangee] for rangee in bloc.rangees]
            return pm.Tableau(rangees=rangees, page=bloc.page)
        return pm.Par(style=bloc.style, texte=texte_paragraphe(bloc),
                      niveau=bloc.niveau_declare, images=images_paragraphe(bloc))

    return [projeter_bloc(b) for b in document.blocs]


# ---------------------------------------------------------------------------------
# CLI de diagnostic, comme manuscrit_modele.py --diagnostic mais sur un fichier .docx. C'est
# par elle que test/js/manuscrit-docx.test.js teste ce module depuis Node.

def _images_du_document(document):
    """Toutes les Image du document (corps, notes, tableaux imbriqués), pour --images, seul
    mode qui expose les octets (--diagnostic n'en donne que la longueur)."""
    trouvees = []

    def creuser_blocs(blocs):
        for b in blocs:
            if isinstance(b, mm.Tableau):
                for rangee in b.rangees:
                    for c in rangee:
                        creuser_blocs(c.blocs)
            else:
                for f in b.fragments:
                    if f.image is not None:
                        trouvees.append(f.image)

    creuser_blocs(document.blocs)
    for blocs_note in document.notes.values():   # dict{id: [bloc, ...]}
        creuser_blocs(blocs_note)
    return trouvees


def _pm_bloc_vers_json(bloc):
    """Sérialise un Par ou un Tableau de pronto_modele, pour --projeter-pronto et
    --pronto-brut : le test compare ainsi deux JSON de même forme."""
    if isinstance(bloc, pm.Tableau):
        return {'type': 'tableau', 'page': bloc.page,
                'rangees': [[{'colspan': c.colspan,
                              'blocs': [_pm_bloc_vers_json(b) for b in c.blocs]}
                             for c in rangee] for rangee in bloc.rangees]}
    return {'type': 'par', 'style': bloc.style, 'texte': bloc.texte, 'niveau': bloc.niveau,
            'images': [list(t) for t in bloc.images]}


_MODES = ('--diagnostic', '--projeter-pronto', '--pronto-brut', '--images')


def principal(argv):
    if len(argv) < 3 or argv[1] not in _MODES:
        print('usage : manuscrit_docx.py %s <fichier.docx>' % '|'.join(_MODES),
              file=sys.stderr)
        return 2
    mode, chemin = argv[1], argv[2]
    try:
        if mode == '--pronto-brut':
            resultat = [_pm_bloc_vers_json(b) for b in pronto_docx.lire(chemin)]
        elif mode == '--projeter-pronto':
            resultat = [_pm_bloc_vers_json(b) for b in projeter_pronto(lire(chemin))]
        elif mode == '--images':
            resultat = [{'nom': img.nom, 'longueur': len(img.octets),
                        'sha256': hashlib.sha256(img.octets).hexdigest(),
                        'alt': img.alt, 'flottante': img.flottante, 'surface': img.surface,
                        'cx': img.cx, 'cy': img.cy, 'largeur_px': img.largeur_px,
                        'hauteur_px': img.hauteur_px}
                       for img in _images_du_document(lire(chemin))]
        else:
            document = lire(chemin)
            resultat = {'gabarit': mm.reconnaitre_gabarit(document),
                        'document': mm.document_vers_json(document)}
    except Exception as e:
        print('[manuscrit_docx] lecture impossible (%s) : %s' % (chemin, e), file=sys.stderr)
        return 1
    # ensure_ascii=True : la console Windows n'est pas forcément en UTF-8.
    print(json.dumps(resultat, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
