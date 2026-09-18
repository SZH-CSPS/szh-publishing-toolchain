#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_docx.py — le lecteur .docx du nettoyeur de manuscrit (article) : rend le modèle
# riche de manuscrit_modele.py (§4 du contrat) et projeter_pronto(), qui rend EXACTEMENT ce
# que pronto_docx.lire() rend sur le même fichier (§3, « dette assumée »). AUCUNE décision
# ici — ni classement de titre, ni nettoyage de mise en forme : seulement de la lecture.
# Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §3, §4, §10, §11.
#
# Repris SANS LES MODIFIER de pronto_docx.py (interdiction du chantier — Robin valide ce
# lecteur la semaine du 22.09.2026) : la résolution de style (charger_styles / pstyle /
# resoudre_style), le comptage des marqueurs de page (compter_marqueurs_page) et la liste des
# blocs de premier niveau (blocs_du_corps). Les reprendre TELS QUELS plutôt que les récrire
# ici est ce qui rend projeter_pronto() fiable par construction : les deux lecteurs appellent
# alors littéralement le même code pour résoudre un style ou une page, et ne peuvent plus
# diverger sur ce point précis. Idem pour niveau_depuis_style() et normaliser(), repris de
# pronto_modele.py. Le reste — runs, mise en forme DIRECTE, hyperliens, images DrawingML,
# fusions verticales, révisions, commentaires, notes de bas de page — est écrit ici, parce
# que pronto_docx.py ne le lit pas.
#
# stdlib uniquement : zipfile, xml.etree.ElementTree, re, json, hashlib — pas de
# python-docx, pas de lxml (§2 du contrat).
#
# ── Ce que le contrat ne précisait pas et qu'il a fallu décider ────────────────────────────
#
# 1. Fragment.texte et la normalisation. Le §4 du contrat dit « texte est déjà normalisé par
#    le lecteur ». Mais pronto_modele.normaliser() se termine par ' '.join(t.split()), qui
#    ROGNE les espaces de tête et de queue — appliqué à CHAQUE Fragment séparément, un mot
#    coupé par Word exactement sur une espace de run («Bonjour[FIN DE RUN] le monde») perdrait
#    cette espace à la concaténation, ce qui casserait le contrôle n°1 du §11 (reconstruction
#    exacte d'un mot coupé). Fragment.texte ne reçoit donc QUE les trois substitutions de
#    tiret de normaliser() (le seul effet réel de cette fonction sur un texte français —
#    mesuré : ses trois substitutions d'espace sont, dans le fichier actuel, un remplacement
#    d'espace normale par espace normale, donc un no-op ; la vraie normalisation des espaces
#    spéciales vient du ' '.join(t.split()) final, parce que str.split() reconnaît l'espace
#    insécable comme un blanc). projeter_pronto() rappelle pronto_modele.normaliser() sur la
#    concaténation ENTIÈRE du paragraphe, exactement comme pronto_docx.lire() le fait sur le
#    texte brut : la substitution de tiret étant idempotente, appliquer une fois par Fragment
#    puis une fois de plus sur le tout ne change rien au résultat final — c'est ce qui rend
#    les deux lecteurs strictement égaux malgré la découpe en Fragment. Voir _normaliser_run().
#
# 2. Les ancrages flottants qui ne portent aucune image. Mesuré sur le corpus réel
#    (tmp/corpus-relecture/lot-A/4_La méthode Flip Flap.docx) : ses 10 « ancrages flottants »
#    sont des RECTANGLES et des GROUPES de formes (annotations posées sur une capture
#    d'écran), AUCUN ne porte de <a:blip> — ce ne sont pas des images au sens du §4 (rien à
#    reposer). Ce module ne leur fabrique donc pas d'Image : il les recense
#    ('forme_vectorielle_ignoree') et le déclare (§10), plutôt que de mentir sur un objet
#    Image sans octets ou de les faire disparaître en silence.
#
#    ⚠ Pour les voir DU TOUT, il a fallu déplier mc:AlternateContent (voir _enfants_utiles) :
#    ces 10 ancrages sont, mesuré, TOUS enveloppés dans un mc:AlternateContent deux niveaux
#    sous leur w:r (<w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing>…). Un
#    premier jet de ce module, qui ne regardait que les enfants DIRECTS d'un w:r, ne les
#    voyait pas — pas même comme « forme vectorielle ignorée » : ils disparaissaient sans
#    aucun avertissement, exactement le silence que le §10 interdit. Corrigé avant livraison,
#    voir _enfants_utiles ci-dessous ; mc:Fallback (la même forme, redite en VML) est
#    délibérément ignoré pour ne pas compter chaque dessin deux fois.
#
#    ⚠ Correction du 18.09.2026 (revue adverse) : cette hypothèse — « mc:Fallback ne fait que
#    redire la même forme » — est fausse pour 4 des 10 ancrages de ce même fichier. Leur
#    Fallback porte un VRAI groupe de 5 images embarquées (<v:imagedata>) que leur Choice, lui,
#    n'a pas (aucun <a:blip>). Ignorer tout le Fallback les aurait laissées hors de TOUT
#    recensement. Voir _images_fantomes_du_repli : on revisite le Fallback uniquement quand la
#    Choice correspondante n'a trouvé aucune image propre, pour ne rien compter deux fois.
#
# 3. Les images VML héritées (w:pict / v:imagedata) et les zones de texte, en-têtes, pieds de
#    page et champs Word (fldSimple/fldChar) : couverts par pronto_docx.py / docx-meta.py pour
#    le corpus des 486 Word HÉRITÉS, mais un manuscrit d'autrice ARRIVANT aujourd'hui est du
#    DrawingML moderne (mesuré sur les onze fichiers de lot-A et sur le gabarit livré). Ce
#    module ne les lit pas et le RECENSE (§10) plutôt que de dupliquer cette lecture pour un
#    cas que le corpus ne présente pas aujourd'hui.
#
# 4. projeter_pronto() ne re-lit AUCUN XML : il part du Document déjà construit par lire(),
#    dont chaque champ a été délibérément calculé pour coïncider avec pronto_docx.lire() (même
#    resoudre_style, même niveau_depuis_style, même règle de page — voir plus haut). Deux
#    clauses bornent cette égalité, aucune n'étant exercée par le gabarit livré ni par le
#    corpus réel (mesuré, les deux à zéro) : un document qui utiliserait une fusion verticale
#    (w:vMerge) — pronto_docx.lire() ne masque JAMAIS une telle cellule (bogue latent de ce
#    fichier, non touché ici), alors que le Document riche masque la continuation et augmente
#    rowspan de la cellule de départ, comme le §4 du contrat l'exige explicitement pour CE
#    lecteur — ou une image VML héritée (point 3 ci-dessus, absente du Document riche donc
#    absente de la projection, alors que pronto_docx.lire() la lirait).

import hashlib
import json
import os
import posixpath
import re
import struct
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun
import pronto_docx
import pronto_modele as pm
import manuscrit_modele as mm

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
PKG_RELS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'
V = '{urn:schemas-microsoft-com:vml}'

# Conteneurs qui enveloppent des w:r sans leur ajouter de texte ou de lien propres : les
# révisions (w:ins/w:del — comptées à part, voir _compter_revisions), les balises de contenu
# structuré et leur enveloppe. On y « passe à travers » plutôt que d'ignorer leur contenu, car
# un document en suivi de modifications (refusé plus tard par la CLI, §8) ne doit pas pour
# autant faire planter LA LECTURE : lire() doit rester utilisable sur les onze fichiers réels
# de lot-A, dont un porte des révisions ouvertes.
_CONTENEURS_PASSE_PLAT = (W + 'ins', W + 'del', W + 'smartTag', W + 'customXml',
                          W + 'sdt', W + 'sdtContent')

# w:t et w:delText (texte d'une suppression suivie) sont tous deux du texte visible au sens
# de ce lecteur — voir la note ci-dessus sur les révisions.
_TAGS_TEXTE = (W + 't', W + 'delText')
_TAGS_ESPACE = (W + 'tab', W + 'br', W + 'cr')

_TYPES_NOTE_TECHNIQUES = ('separator', 'continuationSeparator')

PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# ---------------------------------------------------------------------------------
# Texte d'un run — voir le point 1 de l'en-tête pour la raison du choix de NE PAS appliquer
# le compactage d'espaces de pronto_modele.normaliser() à cette échelle.

def _normaliser_run(t):
    """Les trois substitutions de tiret de pronto_modele.normaliser(), et RIEN d'autre —
    jamais le ' '.join(t.split()) final, qui casserait la reconstruction exacte d'un mot
    coupé sur une espace de run (§11 du contrat). Idempotente : projeter_pronto() peut
    rappeler normaliser() par-dessus sans changer le résultat."""
    for a, b in (('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return t


def _enfants_utiles(el):
    """Les enfants de `el` (un w:r), en dépliant tout mc:AlternateContent sur sa PREMIÈRE
    branche mc:Choice — jamais mc:Fallback, qui répète le MÊME contenu en VML pour la
    compatibilité avec les vieux Word : le compter aussi doublerait chaque dessin ou forme
    concerné. Mesuré sur le corpus réel (lot-A/4_La méthode Flip Flap.docx, 18.09.2026) : ses
    10 ancrages flottants sont TOUS enveloppés dans un mc:AlternateContent, deux niveaux sous
    le w:r — un simple r.findall(W+'drawing') (enfants DIRECTS seulement) ne les voit JAMAIS,
    ce qui les aurait fait disparaître sans le moindre avertissement, à l'exact endroit où le
    §10 du contrat interdit le silence."""
    resultat = []
    for enfant in el:
        if enfant.tag == MC + 'AlternateContent':
            choix = enfant.find(MC + 'Choice')
            if choix is not None:
                resultat.extend(list(choix))
        else:
            resultat.append(enfant)
    return resultat


def _texte_depuis_enfants(enfants):
    morceaux = []
    for e in enfants:
        if e.tag in _TAGS_TEXTE:
            morceaux.append(e.text or '')
        elif e.tag in _TAGS_ESPACE:
            morceaux.append(' ')
        elif e.tag == W + 'noBreakHyphen':
            morceaux.append('-')
        # w:softHyphen : invisible sauf en fin de ligne rendue, jamais un caractère du texte
        # normalisé — ignoré comme le fait déjà pronto_docx.texte_paragraphe pour tab/br/cr
        # devenus une espace, sans caractère propre à restituer ici.
    return _normaliser_run(''.join(morceaux))


# ---------------------------------------------------------------------------------
# Mise en forme DIRECTE d'un w:rPr — jamais la cascade des styles : le §5.2 du contrat ne
# parle que du formatage MANUEL, celui qu'un style seul ne porte pas. Une clé absente du XML
# vaut None (non déclaré) ; une balise présente avec w:val="0"/"false"/"off"/"none" vaut False
# (déclaré éteint) — jamais confondus (§4 du contrat, ⚠).

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
    """w:u porte une énumération (single, double, wave, none…), pas un simple on/off : val
    absent (rare) vaut « déclaré actif » (Word n'écrit alors aucun w:val, mais l'élément est
    bien présent) ; val="none" est la seule valeur qui éteint le soulignement."""
    if rpr is None:
        return None
    el = rpr.find(W + 'u')
    if el is None:
        return None
    val = (el.get(W + 'val') or '').lower()
    return val not in ('none', '0', 'false')


def _lire_vertalign(rpr):
    """(exposant, indice) : w:vertAlign est un exclusif à trois valeurs (baseline,
    superscript, subscript) — sa seule PRÉSENCE déclare les deux champs (baseline déclare
    les deux à False), son ABSENCE laisse les deux à None."""
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


# ---------------------------------------------------------------------------------
# Relations du paquet : médias ET hyperliens (pronto_docx.charger_rels_images ne garde que
# les médias, ce module a aussi besoin des cibles d'hyperlien, qui ne portent jamais
# 'media/').

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
# Dimensions en PIXELS du FICHIER image — jamais celles de sa boîte d'affichage (wp:extent,
# cx/cy, en EMU) : cx/cy disent à quelle taille Word AFFICHE l'image, pas la résolution du
# fichier qu'elle affiche. C'est cette dernière, et elle seule, qui dit si une image tiendra
# la qualité d'impression (§4 et §7 du contrat : ce module MESURE, `qualite-image.js` JUGE).
#
# Reconnaissance par SIGNATURE D'OCTETS, jamais par extension de nom de fichier (un nom peut
# mentir) — même principe que lib/medias.js#lireDimensionsImage côté JS, dont les décalages
# ci-dessous sont la contrepartie mesurée : PNG (readUInt32BE(16)/(20)), GIF
# (readUInt16LE(6)/(8)), JPEG (SOF hors DHT/JPG/DAC). BMP est ajouté ici, absent côté JS.
#
# Tout format non couvert (SVG, EMF, WMF — vectoriels, JAMAIS mesurés : un vectoriel est net
# à toute taille, prétendre lui donner une résolution serait faux) ou tout fichier tronqué/
# illisible rend (0, 0), SANS JAMAIS lever : une image abîmée ne doit pas faire échouer la
# lecture d'un manuscrit entier — voir _dimensions_image().

def _dimensions_png(octets):
    """PNG : signature fixe de 8 octets, puis le chunk IHDR — toujours le premier, la norme
    l'exige. Chunk = 4 octets de longueur, 4 octets de type ('IHDR'), puis sa charge : 4
    octets de largeur, 4 octets de hauteur, entiers 32 bits GROS-boutistes (réseau). D'où les
    octets 16 à 24 : 8 (signature) + 4 (longueur du chunk) + 4 (le mot 'IHDR') = 16.

    Ne vérifie PAS elle-même la longueur totale du buffer avant de trancher — un slicing
    Python sur un buffer trop court ne lève jamais (il rend simplement moins d'octets), donc
    la comparaison de signature reste sûre même sur un fichier tronqué très court ; seul le
    struct.unpack final peut lever sur un buffer coupé PLUS LOIN (signature et étiquette
    'IHDR' présentes, mais la charge de largeur/hauteur manque). C'est un choix délibéré :
    le SEUL filet de sécurité contre un fichier tronqué est le `try` de _dimensions_image()
    ci-dessous, qui encadre les quatre lecteurs — une garde locale ici serait redondante et,
    pire, rendrait ce filet invisible à un sabotage (il ne servirait jamais)."""
    if octets[:8] != b'\x89PNG\r\n\x1a\n' or octets[12:16] != b'IHDR':
        return 0, 0
    largeur, hauteur = struct.unpack('>II', octets[16:24])
    return largeur, hauteur


def _dimensions_gif(octets):
    """GIF : signature de 6 octets ('GIF87a' ou 'GIF89a'), puis le Logical Screen Descriptor
    commence immédiatement : 2 octets de largeur, 2 octets de hauteur, entiers 16 bits
    PETIT-boutistes — le seul des quatre formats à l'être pour ses dimensions. Même choix
    que _dimensions_png() pour la sécurité anti-troncature : voir sa note."""
    if octets[:3] != b'GIF':
        return 0, 0
    largeur, hauteur = struct.unpack('<HH', octets[6:10])
    return largeur, hauteur


def _dimensions_bmp(octets):
    """BMP : BITMAPFILEHEADER de 14 octets ('BM' + 12 octets ignorés), puis
    BITMAPINFOHEADER : 4 octets de taille d'en-tête (ignorés), puis largeur et hauteur en
    entiers 32 bits SIGNÉS petit-boutistes, à partir de l'octet 14 + 4 = 18. La hauteur peut
    être négative (bitmap 'top-down', rare) : on rend sa valeur absolue, une dimension en
    pixels n'étant jamais négative. Même choix que _dimensions_png() pour la sécurité
    anti-troncature : voir sa note."""
    if octets[:2] != b'BM':
        return 0, 0
    largeur, hauteur = struct.unpack('<ii', octets[18:26])
    return abs(largeur), abs(hauteur)


# JPEG : marqueurs de début de trame (Start Of Frame). La plage 0xFFC0-0xFFCF contient aussi
# trois marqueurs qui N'EN SONT PAS — le piège classique de ce parcours, explicitement rappelé
# par le contrat : 0xFFC4 (DHT, table de Huffman), 0xFFC8 (JPG, réservé, jamais émis en
# pratique) et 0xFFCC (DAC, table arithmétique). Les confondre avec un SOF lit la largeur/
# hauteur de la charge d'une table de Huffman : des dimensions absurdes, pas une panne — donc
# jamais détecté par un simple essai/exception, seulement par ce test explicite.
_SOF_JPEG_EXCLUS = (0xC4, 0xC8, 0xCC)


def _dimensions_jpeg(octets):
    """JPEG : après le SOI (0xFFD8), une suite de marqueurs 0xFF + 1 octet. Les marqueurs
    sans charge (SOI, RST0-7, TEM) sont sautés de 2 octets ; les autres portent une longueur
    16 bits GROS-boutiste juste après le marqueur (elle-même comptée dedans). Le SOF trouvé
    porte, après ses 2 octets de marqueur + 2 octets de longueur : 1 octet de précision, puis
    hauteur et largeur en 16 bits GROS-boutistes, DANS CET ORDRE (Y avant X) — d'où le
    décalage de 5 (2+2+1) avant les deux entiers demandés par l'énoncé."""
    n = len(octets)
    if n < 4 or octets[0:2] != b'\xff\xd8':
        return 0, 0
    i = 2
    # Garde-fou anti-boucle infinie : un fichier tronqué ou brouillé ne doit jamais faire
    # tourner ce parcours sans fin — aucun JPEG réel ne porte des milliers de segments.
    segments = 0
    while i + 4 <= n and segments < 4096:
        segments += 1
        if octets[i] != 0xFF:
            return 0, 0  # désynchronisé : en-tête illisible, on abandonne plutôt que deviner
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
            # Pas de vérification `i + 9 > n` ici : un SOF trouvé juste avant la fin d'un
            # fichier tronqué fait lever struct.unpack (buffer trop court), rattrapé par le
            # seul filet de _dimensions_image() — même choix que les trois autres formats.
            hauteur, largeur = struct.unpack('>HH', octets[i + 5:i + 9])
            return largeur, hauteur
        taille_segment = struct.unpack('>H', octets[i + 2:i + 4])[0]
        if taille_segment < 2:
            return 0, 0
        i += 2 + taille_segment
    return 0, 0


def _dimensions_image(octets):
    """Dispatch par signature d'octets vers l'un des quatre formats couverts ; (0, 0) pour
    tout le reste (SVG, EMF, WMF, ou un fichier tronqué/illisible/de format inconnu). Ce
    `try` est le SEUL filet de sécurité contre un fichier tronqué (voir les notes de
    _dimensions_png/_gif/_bmp/_jpeg : aucune des quatre ne se protège elle-même) : un
    struct.error ou un IndexError levé au milieu d'un des quatre lecteurs, sur un fichier
    coupé net, est rattrapé ici et rendu (0, 0) — jamais laissé remonter faire échouer la
    lecture du manuscrit entier pour une seule image abîmée."""
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
# Images DrawingML — voir le point 2 de l'en-tête pour les ancrages sans image.

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
    # Même convention que pronto_docx.charger_rels_images : une relation qui ne contient pas
    # 'media/' n'est pas une image reconnue — les deux lecteurs doivent s'accorder ici pour
    # que projeter_pronto() reste fiable.
    if 'media/' not in cible:
        recensement['image_sans_relation'] += 1
        return None
    nom = os.path.basename(cible.replace('\\', '/'))
    octets = b''
    try:
        octets = z.read(_chemin_media(cible))
    except KeyError:
        recensement['image_octets_introuvables'] += 1
    # cx/cy conservés SÉPARÉMENT (§4 du contrat) : leur produit reste `surface`, pour ne rien
    # casser chez qui lit déjà ce champ, mais le produit seul ne permet ni rapport largeur/
    # hauteur ni résolution — d'où largeur_px/hauteur_px ci-dessous, la vraie mesure.
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
            # Un fichier qu'on A LU (octets non vides) mais dont on n'a pas su tirer de
            # dimensions : format vectoriel (SVG/EMF/WMF, jamais mesurable) ou fichier
            # abîmé — les deux rendent (0, 0) sans lever (voir _dimensions_image), mais le
            # recensement doit le dire (§10 du contrat : jamais en silence). Une image dont
            # les OCTETS manquent est déjà comptée par 'image_octets_introuvables' plus haut ;
            # ne pas la recompter ici, sous peine de double alerte pour la même cause.
            recensement['image_dimensions_indisponibles'] += 1
    return mm.Image(nom=nom, octets=octets, surface=surface, alt=alt, flottante=flottante,
                     cx=cx, cy=cy, largeur_px=largeur_px, hauteur_px=hauteur_px)


# ---------------------------------------------------------------------------------
# Aplatissement d'un paragraphe en [(w:r, lien|None), ...] dans l'ordre du document — un
# w:hyperlink donne son lien à TOUS les runs qu'il enveloppe ; les conteneurs de
# _CONTENEURS_PASSE_PLAT n'apportent ni texte ni lien propres, on descend simplement dedans.
# Les marqueurs sans run (w:bookmarkStart/End, w:proofErr, w:commentRangeStart/End,
# w:commentReference…) ne produisent rien : ils ne portent aucun texte.

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


def _images_fantomes_du_repli(r, recensement):
    """Correction du 18.09.2026 (revue adverse, sur lot-A/4_La méthode Flip Flap.docx) :
    _enfants_utiles() ne regarde QUE la branche mc:Choice d'un mc:AlternateContent (voir sa
    note) pour ne pas compter deux fois le MÊME dessin redit en VML dans mc:Fallback — mais
    cette hypothèse (« la même forme, redite ») est fausse pour 4 des 10 ancrages flottants de
    ce fichier réel : leur branche Choice est un pur groupe de formes SANS <a:blip> (recensé
    en 'forme_vectorielle_ignoree', correctement), mais leur branche Fallback, elle, porte un
    VRAI groupe de 5 images embarquées (<v:imagedata>) chacune — mesuré : 5 relations média
    distinctes, aucune orpheline. Sans ce contrôle, ces images n'apparaissaient dans AUCUN
    recensement : ni ici (Fallback jamais visité), ni comme forme_vectorielle_ignoree (qui ne
    dit que « ceci est une forme sans image », ce qui devient franchement faux quand le même
    ancrage porte 5 photos dans son repli). On ne les compte QUE quand la branche Choice n'a
    trouvé aucune image propre — sinon ce serait exactement le double comptage que
    _enfants_utiles évite déjà pour les 6 autres ancrages, dont le Fallback ne fait que redire
    la même forme vide."""
    for alt in r.findall(MC + 'AlternateContent'):
        choix = alt.find(MC + 'Choice')
        repli = alt.find(MC + 'Fallback')
        if choix is None or repli is None:
            continue
        dessin = choix.find(W + 'drawing')
        if dessin is None or dessin.find('.//' + A + 'blip') is not None:
            continue  # pas un dessin, ou déjà une vraie image côté Choice : rien à ajouter
        n = sum(1 for _ in repli.iter(V + 'imagedata'))
        if n:
            recensement['image_vml_ignoree'] += n


def _fragments_de_run(r, lien, indice, rels, z, recensement):
    rpr = r.find(W + 'rPr')
    forme = _forme_directe(rpr)
    _images_fantomes_du_repli(r, recensement)
    enfants = _enfants_utiles(r)
    for enfant in enfants:
        if enfant.tag == W + 'pict':
            # Correction du 18.09.2026 (revue adverse) : un SEUL w:pict peut envelopper un
            # GROUPE de plusieurs v:imagedata. Compter l'enveloppe une fois (comme avant)
            # sous-comptait le nombre réel d'images ignorées — un chiffre qu'une relectrice lit
            # pour juger s'il faut aller rechercher une image à la main. On compte maintenant
            # les v:imagedata que le w:pict contient, à n'importe quelle profondeur (v:group
            # imbriqué compris) ; un w:pict SANS aucune image (pure forme vectorielle héritée,
            # sans <v:imagedata>) compte encore pour 1, comme avant — jamais 0, pour ne rien
            # faire disparaître du décompte.
            n_images_vml = sum(1 for _ in enfant.iter(V + 'imagedata'))
            recensement['image_vml_ignoree'] += n_images_vml if n_images_vml else 1
    images = []
    for enfant in enfants:
        if enfant.tag == W + 'drawing':
            img = _image_depuis_drawing(enfant, rels, z, recensement)
            if img is not None:
                img.source = indice
                images.append(img)
    texte = _texte_depuis_enfants(enfants)
    fragments = [mm.Fragment(texte='', image=img, forme=forme, lien=lien, source=indice)
                 for img in images]
    # Un run porte normalement du texte OU une image, jamais les deux (mesuré sur le corpus
    # réel) ; s'il porte quand même du texte en plus d'une image, ou ni l'un ni l'autre, on
    # rend tout de même un Fragment texte pour ne rien perdre et ne jamais rendre une liste
    # vide pour un run qui existe.
    if texte or not fragments:
        fragments.append(mm.Fragment(texte=texte, image=None, forme=forme, lien=lien,
                                      source=indice))
    return fragments


# ---------------------------------------------------------------------------------
# Numérotation des listes (word/numbering.xml) — résolution du FORMAT en trois sauts, ajoutée
# le 18.09.2026 (§5.4 du contrat, décidé avec Robin) : `w:numPr` du paragraphe donne un numId ;
# `word/numbering.xml` (`w:num`) donne l'abstractNumId correspondant ; `w:abstractNum` porte,
# PAR NIVEAU (`w:lvl`), le `w:numFmt` qui décide puce ou numérotée. Ce lecteur ne DEVINE
# jamais ce format : absent, introuvable ou inconnu, il rend '' — c'est l'ÉCRIVAIN
# (manuscrit_gabarit.py) qui choisit alors un repli, et qui le dit dans sa trace. Ce n'est pas
# une décision de lecture, donc pas une violation du §3 (« manuscrit_docx.py ne sait rien des
# décisions ») : ce module rapporte ce que le document déclare, rien de plus.

# Catalogue des w:numFmt numérotés reconnus par Word (au-delà, un format exotique ou 'none'
# n'est PAS supposé numéroté par défaut : '' plutôt qu'un choix inventé ici).
_FORMATS_NUMEROTES = ('decimal', 'decimalZero', 'lowerLetter', 'upperLetter', 'lowerRoman',
                       'upperRoman', 'ordinal', 'cardinalText', 'ordinalText', 'hex', 'chicago',
                       'decimalEnclosedCircle', 'decimalFullWidth', 'aiueo', 'iroha',
                       'ganada', 'chosung')


def _numfmt_vers_type(numfmt):
    """'puce' | 'numero' | '' à partir d'un w:numFmt brut — jamais un troisième choix
    inventé : un format hors des deux catalogues (par exemple 'none', qui signifie
    explicitement « pas de numérotation affichée ») rend '', comme un format absent."""
    if numfmt == 'bullet':
        return 'puce'
    if numfmt in _FORMATS_NUMEROTES:
        return 'numero'
    return ''


def _charger_numerotation(z):
    """{ (numId_brut, ilvl_brut): 'puce'|'numero'|'' }, une fois par document — voir la note
    ci-dessus. `word/numbering.xml` absent (mesuré : le cas de tout .docx fabriqué par script,
    sans aucune liste) rend {} ; chaque paragraphe listé résout alors sur '' via le repli de
    dict.get() dans _liste_depuis(), jamais une valeur choisie ici.

    w:lvlOverride : un `w:num` peut redéfinir le format d'un niveau donné SANS toucher à son
    abstractNum — Word s'en sert quand une autrice repart d'une liste existante en changeant la
    puce d'un niveau. S'il porte lui-même un `w:lvl` (donc un `w:numFmt` propre), IL L'EMPORTE
    pour ce niveau précis sur celui de l'abstractNum ; un simple `w:startOverride` (qui ne fait
    que relancer la numérotation à une valeur donnée) ne change, lui, jamais le format — il est
    ignoré ici à dessein, il ne porte pas de w:lvl."""
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
        # Copie : un w:lvlOverride ne doit JAMAIS muter la table de l'abstractNum, que
        # d'autres w:num peuvent référencer sans le moindre override.
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

def _liste_depuis(ppr, numerotation):
    if ppr is None:
        return None
    numpr = ppr.find(W + 'numPr')
    if numpr is None:
        return None
    numid_el = numpr.find(W + 'numId')
    if numid_el is None:
        return None
    numid_brut = numid_el.get(W + 'val')
    ilvl_brut = '0'
    ilvl_el = numpr.find(W + 'ilvl')
    if ilvl_el is not None and ilvl_el.get(W + 'val') is not None:
        ilvl_brut = ilvl_el.get(W + 'val')
    type_liste = numerotation.get((numid_brut, ilvl_brut), '')
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


def _paragraphe_depuis(p, styles, rels, z, recensement, indice, numerotation):
    style_resolu = pronto_docx.resoudre_style(pronto_docx.pstyle(p), styles)
    niveau_declare = pm.niveau_depuis_style(style_resolu)
    fragments = []
    for i, (r, lien) in enumerate(_runs_de_paragraphe(p, rels)):
        fragments.extend(_fragments_de_run(r, lien, i, rels, z, recensement))
    ppr = p.find(W + 'pPr')
    liste = _liste_depuis(ppr, numerotation)
    alignement, retrait = _alignement_retrait_depuis(ppr)
    return mm.Paragraphe(style=style_resolu, niveau_declare=niveau_declare, niveau_retenu=0,
                          fragments=fragments, liste=liste, alignement=alignement,
                          retrait=retrait, source=indice)


# ---------------------------------------------------------------------------------
# Tableaux — colspan (w:gridSpan, comme pronto_docx) ET rowspan (w:vMerge, que pronto_docx ne
# gère PAS : voir le point 4 de l'en-tête). Une cellule masquée par une fusion VERTICALE
# n'apparaît jamais dans `rangees` (§4 du contrat) ; le gridSpan, lui, ne masque jamais rien
# côté Word — il n'insère aucune cellule pour les colonnes qu'il couvre.

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
    """True si ce w:tc est la CONTINUATION d'une fusion verticale (masqué). w:vMerge sans
    w:val, ou w:val="continue", marque une continuation ; w:val="restart" démarre une nouvelle
    fusion — cette cellule-là n'est PAS masquée, c'est elle qui porte le rowspan."""
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


def _blocs_enfants(container, styles, rels, z, recensement, numerotation):
    """Les Paragraphe|Tableau enfants DIRECTS de `container` (un w:tc, un w:footnote…) —
    `source` = position locale dans CE conteneur, comme Cellule elle-même n'a pas de champ
    `source` (§4 du contrat) : pas de chemin complet, seulement une position locale."""
    resultat = []
    i = 0
    for enfant in container:
        if enfant.tag == W + 'p':
            resultat.append(_paragraphe_depuis(enfant, styles, rels, z, recensement, i,
                                                numerotation))
            i += 1
        elif enfant.tag == W + 'tbl':
            resultat.append(_tableau_depuis(enfant, styles, rels, z, recensement, i,
                                             numerotation))
            i += 1
    return resultat


def _cellule_depuis(tc, styles, rels, z, recensement, numerotation):
    return mm.Cellule(colspan=_colspan(tc), rowspan=1, entete=False,
                       blocs=_blocs_enfants(tc, styles, rels, z, recensement, numerotation))


def _tableau_depuis(tbl, styles, rels, z, recensement, indice, numerotation, page=None):
    """`page` : None pour un tableau imbriqué (jamais transmis par l'appelant récursif via
    _blocs_enfants) — seul l'appelant de premier niveau (lire()) le calcule, comme
    pronto_docx.lire()."""
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
                # Continuation sans cellule de départ connue (fichier mal formé — jamais vu
                # sur le corpus réel) : masquée sans faire planter la lecture pour autant.
                col += largeur
                continue
            cellule = _cellule_depuis(tc, styles, rels, z, recensement, numerotation)
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
    """Prise sur w:docDefaults/w:rPrDefault/w:rPr/w:lang de styles.xml — la langue de
    correction par défaut de tout run qui n'en déclare pas une à lui, donc la meilleure
    candidate à « la » langue du document ; repli sur w:themeFontLang de settings.xml
    (mesuré identique sur le corpus, mais peut différer sur un document retouché). '' si
    aucune des deux n'est présente."""
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


def _compter_revisions(racine):
    return sum(1 for _ in racine.iter(W + 'ins')) + sum(1 for _ in racine.iter(W + 'del'))


def _compter_commentaires(z):
    try:
        racine = ET.fromstring(z.read('word/comments.xml'))
    except Exception:
        return 0
    return sum(1 for _ in racine.iter(W + 'comment'))


def _lire_notes(z, styles, rels, recensement, numerotation):
    try:
        racine = ET.fromstring(z.read('word/footnotes.xml'))
    except Exception:
        return []
    notes = []
    for fn in racine.iter(W + 'footnote'):
        if fn.get(W + 'type') in _TYPES_NOTE_TECHNIQUES:
            continue
        notes.extend(_blocs_enfants(fn, styles, rels, z, recensement, numerotation))
    return notes


# ---------------------------------------------------------------------------------
# Point d'entrée n°1 : lire().

def lire(chemin):
    """Rend un manuscrit_modele.Document (§4 du contrat). Toute erreur de lecture (zip
    invalide, document.xml absent ou mal formé) se propage — même contrat que
    pronto_docx.lire()."""
    recensement = {'forme_vectorielle_ignoree': 0, 'image_sans_relation': 0,
                   'image_octets_introuvables': 0, 'image_vml_ignoree': 0,
                   'image_dimensions_indisponibles': 0}

    with zipfile.ZipFile(chemin) as z:
        noms = z.namelist()
        racine = ET.fromstring(z.read('word/document.xml'))
        styles_id_nom = pronto_docx.charger_styles(z)
        rels = charger_relations(z)
        langue = _langue_declaree(z)
        revisions = _compter_revisions(racine)
        commentaires = _compter_commentaires(z)
        numerotation = _charger_numerotation(z)
        notes = _lire_notes(z, styles_id_nom, rels, recensement, numerotation)

        elements = pronto_docx.blocs_du_corps(racine)
        marqueurs_total = sum(pronto_docx.compter_marqueurs_page(e) for e in elements)
        blocs = []
        cumul = 0
        for i, e in enumerate(elements):
            if e.tag == W + 'p':
                blocs.append(_paragraphe_depuis(e, styles_id_nom, rels, z, recensement, i,
                                                 numerotation))
            else:
                page = (1 + cumul) if marqueurs_total > 0 else None
                blocs.append(_tableau_depuis(e, styles_id_nom, rels, z, recensement, i,
                                              numerotation, page=page))
            cumul += pronto_docx.compter_marqueurs_page(e)

        n_entetes_pieds = sum(1 for n in noms if re.match(r'word/(header|footer)\d+\.xml$', n))
        n_txbx = sum(1 for _ in racine.iter(W + 'txbxContent'))
        n_fld = (sum(1 for _ in racine.iter(W + 'fldSimple'))
                 + sum(1 for _ in racine.iter(W + 'fldChar')))

    # §10 du contrat : « ce que tu ne sais pas lire, tu le déclares » — un avertissement par
    # famille, jamais un par occurrence (même esprit que le §10 « volume d'alertes »).
    if n_entetes_pieds:
        avertir('entetes-pieds-non-lus',
                ['article', 'fichiers %d' % n_entetes_pieds],
                'Ce document porte %d en-tête(s)/pied(s) de page : leur contenu n\'est pas '
                'lu par le nettoyeur, qui ne regarde que le corps du document.' % n_entetes_pieds,
                'Dieses Dokument enthält %d Kopf-/Fußzeile(n): ihr Inhalt wird vom Bereiniger '
                'nicht gelesen, der nur den Dokumentkörper betrachtet.' % n_entetes_pieds)
    if n_txbx:
        avertir('zones-de-texte-non-lues',
                ['article', 'occurrences %d' % n_txbx],
                'Ce document porte %d zone(s) de texte : leur contenu n\'est pas lu, il '
                'sera absent de la sortie.' % n_txbx,
                'Dieses Dokument enthält %d Textfeld(er): ihr Inhalt wird nicht gelesen und '
                'fehlt in der Ausgabe.' % n_txbx)
    if n_fld:
        avertir('champs-word-non-resolus',
                ['article', 'marqueurs %d' % n_fld],
                'Ce document porte %d marqueur(s) de champ Word (renvoi, sommaire, numéro '
                'de page…) : sa valeur affichée est lue comme du texte normal, mais elle ne '
                'sera jamais recalculée.' % n_fld,
                'Dieses Dokument enthält %d Word-Feldmarkierung(en) (Querverweis, '
                'Inhaltsverzeichnis, Seitenzahl…): ihr angezeigter Wert wird als normaler '
                'Text gelesen, aber nie neu berechnet.' % n_fld)
    if recensement['forme_vectorielle_ignoree']:
        avertir('formes-vectorielles-ignorees',
                ['article', 'occurrences %d' % recensement['forme_vectorielle_ignoree']],
                'Ce document porte %d dessin(s) flottant(s) ou en ligne sans image '
                'incorporée (rectangle, forme, groupe de formes) : ils ne sont pas '
                'repris.' % recensement['forme_vectorielle_ignoree'],
                'Dieses Dokument enthält %d schwebende oder eingebettete Zeichnung(en) ohne '
                'eingebettetes Bild (Rechteck, Form, Formengruppe): sie werden nicht '
                'übernommen.' % recensement['forme_vectorielle_ignoree'])
    if recensement['image_vml_ignoree']:
        avertir('images-vml-ignorees',
                ['article', 'occurrences %d' % recensement['image_vml_ignoree']],
                'Ce document porte %d image(s) au format hérité (VML, w:pict) : ce lecteur '
                'ne sait lire que les images modernes (DrawingML) ; elles ne sont pas '
                'reprises.' % recensement['image_vml_ignoree'],
                'Dieses Dokument enthält %d Bild(er) im veralteten Format (VML, w:pict): '
                'dieser Leser kann nur moderne Bilder (DrawingML) lesen; sie werden nicht '
                'übernommen.' % recensement['image_vml_ignoree'])
    if recensement['image_sans_relation'] or recensement['image_octets_introuvables']:
        avertir('images-introuvables',
                ['article', 'sans-relation %d' % recensement['image_sans_relation'],
                 'octets-introuvables %d' % recensement['image_octets_introuvables']],
                'Ce document référence une ou plusieurs images que ce lecteur n\'a pas pu '
                'retrouver dans l\'archive (relation absente ou fichier manquant, par '
                'exemple une image liée en externe) : elles ne sont pas reprises.',
                'Dieses Dokument verweist auf ein oder mehrere Bilder, die dieser Leser im '
                'Archiv nicht wiederfinden konnte (fehlende Beziehung oder fehlende Datei, '
                'zum Beispiel ein extern verknüpftes Bild): sie werden nicht übernommen.')
    if recensement['image_dimensions_indisponibles']:
        avertir('images-dimensions-indisponibles',
                ['article', 'occurrences %d' % recensement['image_dimensions_indisponibles']],
                'Ce document porte %d image(s) dont les dimensions en pixels n\'ont pas pu '
                'être lues (format vectoriel — SVG, EMF, WMF — ou fichier abîmé) : la '
                'qualité de ces images ne peut pas être évaluée.'
                % recensement['image_dimensions_indisponibles'],
                'Dieses Dokument enthält %d Bild(er), deren Pixelabmessungen nicht gelesen '
                'werden konnten (Vektorformat — SVG, EMF, WMF — oder beschädigte Datei): '
                'die Qualität dieser Bilder kann nicht beurteilt werden.'
                % recensement['image_dimensions_indisponibles'])

    return mm.Document(blocs=blocs, styles=list(styles_id_nom.values()), langue=langue,
                        revisions=revisions, commentaires=commentaires, notes=notes,
                        source=None)


# ---------------------------------------------------------------------------------
# Point d'entrée n°2 : projeter_pronto(). Voir le point 4 de l'en-tête pour ce qui borne
# l'égalité avec pronto_docx.lire().

def projeter_pronto(document):
    """Rend EXACTEMENT le modèle que rend pronto_docx.lire() sur le même fichier : une
    list[pronto_modele.Par | pronto_modele.Tableau] (§3 du contrat)."""

    def texte_paragraphe(p):
        # Concaténation brute des Fragment (tab/br/cr déjà remplacés par une espace à la
        # lecture, voir _texte_run), puis LE MÊME normaliser() que pronto_docx.lire() appelle
        # sur son propre texte brut — idempotent sur les substitutions déjà faites par
        # _normaliser_run (voir le point 1 de l'en-tête).
        brut = ''.join(f.texte for f in p.fragments if f.image is None)
        return pm.normaliser(brut)

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
# CLI de diagnostic — sur le modèle de manuscrit_modele.py --diagnostic (mais sur un fichier
# .docx réel, pas un JSON reçu sur stdin) : c'est elle que test/js/manuscrit-docx.test.js
# pilote, faute de pouvoir importer ce module directement depuis Node.

def _images_du_document(document):
    """Toutes les Image du document, en profondeur (corps ET notes, tableaux imbriqués
    compris) — pour --images, le seul mode qui vérifie les OCTETS (le JSON de --diagnostic,
    via manuscrit_modele.document_vers_json, n'expose que leur longueur)."""
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
    creuser_blocs(document.notes)
    return trouvees


def _pm_bloc_vers_json(bloc):
    """Sérialise un Par | Tableau de pronto_modele (aucun des deux _vers_json de
    manuscrit_modele.py ne les couvre, ils sont d'un module différent) — utilisé pour
    --projeter-pronto ET --pronto-brut, afin que le test compare deux JSON de MÊME forme."""
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
    # ensure_ascii=True : même clause que manuscrit_modele.py --diagnostic, la console
    # Windows n'est pas garantie en UTF-8.
    print(json.dumps(resultat, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
