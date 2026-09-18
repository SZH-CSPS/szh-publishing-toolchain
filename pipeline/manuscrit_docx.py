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
# 1. Fragment.texte et la normalisation. ⚠ Révision du 19.09.2026 (défaut constaté sur le
#    corpus réel — voir le rapport de chantier) : une VERSION ANTÉRIEURE de ce module
#    appliquait ICI les trois substitutions de tiret de pronto_modele.normaliser() (–, —, ‑
#    -> '-') à CHAQUE Fragment.texte. Mesuré sur lot-A : 4 cadratins et 89 demi-cadratins
#    RÉELS, dans le texte visible d'un manuscrit, dégradés en simple trait d'union dès la
#    LECTURE — avant même que le filtre typographique (règle T2 de szh-typographie.lua, qui
#    décide JUSTEMENT entre eux) ait pu les voir. « pp. 12–25 » devenait « pp. 12-25 », sans
#    aucun moyen de revenir en arrière plus loin dans la chaîne. Ces substitutions sont
#    SUPPRIMÉES : Fragment.texte porte désormais le tiret RÉEL du document, tel quel — c'est
#    l'écrivain (manuscrit_gabarit.py) et le pont typographique, pas ce lecteur, qui décident
#    quoi en faire. `projeter_pronto()` continue, lui, à rappeler pronto_modele.normaliser()
#    sur la concaténation ENTIÈRE du paragraphe (texte_paragraphe() plus bas) : c'est là, et
#    SEULEMENT là, que la substitution de tiret doit avoir lieu, pour rester l'exact miroir de
#    pronto_docx.lire() (§3, « dette assumée ») — la projection, contrairement au modèle
#    riche, n'a jamais eu vocation à garder le tiret réel.
#
#    Le compactage d'espaces de pronto_modele.normaliser() (' '.join(t.split())), lui, n'a
#    JAMAIS été appliqué par Fragment séparé, pour une raison qui reste valable : un mot coupé
#    par Word exactement sur une espace de run («Bonjour[FIN DE RUN] le monde») perdrait cette
#    espace à la concaténation, ce qui casserait le contrôle n°1 du §11 (reconstruction exacte
#    d'un mot coupé). Voir _texte_depuis_enfants().
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
#    absente de la projection, alors que pronto_docx.lire() la lirait). ⚠ Révision du
#    19.09.2026 : ce n'est plus vrai pour toute image VML — voir le point 5 ci-dessous, qui
#    en récupère désormais une partie ; projeter_pronto(), lui, ne s'en préoccupe toujours
#    pas : images_paragraphe() ne regarde que `f.image`, quelle que soit sa provenance.
#
# 5. Défauts corrigés le 19.09.2026, mesurés sur le corpus réel ou constatés en lisant le XML
#    (revue de chantier, tous documentés en détail au fil du fichier ci-dessous) :
#      - w:noBreakHyphen rendait '-' (trait d'union banal) : rend désormais U+2011 (le VRAI
#        trait d'union insécable), distinct d'un tiret ordinaire — voir _texte_depuis_enfants.
#      - w:tab et w:br/w:cr rendaient tous trois une simple espace, ce qui rendait MORTE la
#        logique de nettoyer_mise_en_forme() qui cherche un '\t' en tête ou un '\n' en queue
#        de paragraphe (elle ne pouvait jamais les trouver). Ce lecteur porte maintenant le
#        VRAI caractère ('\t' / '\n') — voir _texte_depuis_enfants et la note sur ce choix.
#      - w:sym (Insertion > Symbole) n'était pas lu du tout : silence total sur un caractère
#        pourtant visible à l'écran. Voir _rendu_sym().
#      - w:fldSimple n'était pas déplié : l'avertissement 'champs-word-non-resolus' prétendait
#        lire sa valeur affichée, mais _runs_de_paragraphe ne descendait jamais dedans. Corrigé
#        en l'ajoutant à _CONTENEURS_PASSE_PLAT (w:fldChar, lui, n'a jamais eu ce problème : le
#        texte affiché d'un champ à w:fldChar vit dans un w:r ordinaire, entre les marqueurs
#        'separate' et 'end', déjà lu comme n'importe quel texte).
#      - w:sdt de niveau BLOC (un contrôle de contenu enveloppant un ou plusieurs w:p entiers,
#        directement enfant du corps ou d'une cellule) faisait disparaître ces paragraphes
#        SANS AVERTISSEMENT : blocs_du_corps() de pronto_docx.py (repris tel quel, §3) ne
#        reconnaît que w:p/w:tbl comme enfants directs du corps, jamais w:sdt. Voir
#        _deplier_sdt_niveau_bloc(), appelée sur le corps et sur chaque conteneur de bloc
#        AVANT tout parcours — le cas de niveau RUN (un sdt enveloppant des w:r à l'intérieur
#        d'un paragraphe) était déjà couvert par _CONTENEURS_PASSE_PLAT.
#      - word/endnotes.xml n'était jamais lu : les notes de fin disparaissaient purement et
#        simplement. Lu maintenant comme les notes de bas de page, avec un identifiant décalé
#        au-delà du plus grand identifiant de footnote (voir _decalage_notes_fin plus bas) —
#        Document.notes devient un dict{id: contenu} pour que les deux familles cohabitent
#        sans jamais se percuter (§4 du contrat, révision du 19.09.2026).
#      - Le décompte d'images VML héritées comptait les OCCURRENCES de v:imagedata, pas les
#        identifiants DISTINCTS : un groupe qui référence 5 fois la même image (répétitions
#        d'un même r:id, mesuré réel) comptait 5 images ignorées au lieu d'une. Corrigé, ET ces
#        images sont maintenant RÉCUPÉRÉES quand leur relation résout vers un média présent
#        dans l'archive — voir _images_depuis_vml().
#      - Image.source portait l'indice du w:r (celui de Fragment.source), pas celui du w:p
#        porteur dans le corps : sur 6 rapports d'images sur 7, source valait 0 pour toutes.
#        Corrigé (voir `indice_paragraphe` dans _fragments_de_run) : Fragment.source RESTE
#        l'indice du run (§4 du contrat, inchangé), seul Image.source change de référentiel.
#      - _liste_depuis() ne lisait qu'un w:numPr posé DIRECTEMENT sur le paragraphe, jamais un
#        w:numPr hérité d'un style de paragraphe (via w:pStyle -> ... -> w:pPr/w:numPr) : une
#        autrice qui applique un style de liste sans reposer numPr sur chaque paragraphe voyait
#        sa liste disparaître. Résolu par la même chaîne de styles que Fragment.effectif, voir
#        _index_styles_complet() et _numpr_depuis_style().
#      - w:numId="0" (convention Word : « retire explicitement la numérotation héritée d'un
#        style ») était traité comme un numId ordinaire de format indéterminé, jamais comme
#        « pas de liste » : corrigé dans _liste_depuis().
#      - _compter_revisions() ne comptait que document.xml : un suivi de modifications confiné
#        aux notes de bas de page ou de fin n'était pas détecté. Compte désormais aussi
#        footnotes.xml et endnotes.xml.
#      - Fragment.effectif (§4 du contrat) : la mise en forme EFFECTIVEMENT appliquée — directe
#        sinon style de caractère (w:rStyle) sinon chaîne des styles de paragraphe (w:pStyle ->
#        w:basedOn -> ...) sinon w:docDefaults/w:rPrDefault. Voir _index_styles_complet(),
#        _chaine_styles() et _forme_effective(). Idem pour Paragraphe.alignement_effectif.

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
import pronto_docx
import pronto_modele as pm
import manuscrit_modele as mm

# Contexte de lecture, calculé UNE fois par document (lire()) puis transmis tel quel à toutes
# les fonctions qui en ont besoin, à la place de plusieurs paramètres épars — AJOUTÉ le
# 19.09.2026 avec Fragment.effectif et les notes de fin, qui en ont chacun besoin plus loin
# dans l'arbre (paragraphes de cellule, notes elles-mêmes).
#   numerotation        {(numId, ilvl): 'puce'|'numero'|''} — voir _charger_numerotation
#   index_styles        {styleId: {'basedOn', 'ppr', 'rpr'}} — voir _index_styles_complet
#   rpr_defaut, ppr_defaut   Element|None de w:docDefaults — voir _index_styles_complet
#   decalage_notes_fin  int : à ajouter à un identifiant BRUT de w:endnoteReference /
#                        w:endnote pour obtenir son identifiant FINAL, jamais en collision
#                        avec un identifiant de footnote (voir lire()).
Contexto = namedtuple('Contexto', ('numerotation', 'index_styles', 'rpr_defaut', 'ppr_defaut',
                                    'decalage_notes_fin'))

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
PKG_RELS = '{http://schemas.openxmlformats.org/package/2006/relationships}'
MC = '{http://schemas.openxmlformats.org/markup-compatibility/2006}'
V = '{urn:schemas-microsoft-com:vml}'

# Conteneurs qui enveloppent des w:r sans leur ajouter de texte ou de lien propres : les
# révisions (w:ins/w:del — comptées à part, voir _compter_revisions), les balises de contenu
# structuré et leur enveloppe (niveau RUN — le niveau BLOC est couvert séparément, voir
# _deplier_sdt_niveau_bloc), et w:fldSimple (champ Word à valeur mise en cache : sa valeur
# affichée vit dans un w:r ordinaire, enfant direct du w:fldSimple — AJOUTÉ le 19.09.2026,
# voir le point 5 de l'en-tête). On y « passe à travers » plutôt que d'ignorer leur contenu,
# car un document en suivi de modifications (refusé plus tard par la CLI, §8) ne doit pas pour
# autant faire planter LA LECTURE : lire() doit rester utilisable sur les onze fichiers réels
# de lot-A, dont un porte des révisions ouvertes.
_CONTENEURS_PASSE_PLAT = (W + 'ins', W + 'del', W + 'smartTag', W + 'customXml',
                          W + 'sdt', W + 'sdtContent', W + 'fldSimple')

# w:t et w:delText (texte d'une suppression suivie) sont tous deux du texte visible au sens
# de ce lecteur — voir la note ci-dessus sur les révisions.
_TAGS_TEXTE = (W + 't', W + 'delText')

# Ajout du 19.09.2026 (superviseur, sur mesure de l'agent de l'écrivain) : 'continuationNotice'
# (le petit texte « … suite » que Word pose en bas d'une page où une note continue) est un
# type technique de plus, jamais une vraie note de bas de page — mesuré sur 1bis, 2-dense,
# 2-grappes et 5bis, où ce type apparaît dans footnotes.xml ET endnotes.xml SANS AUCUN
# w:footnoteReference/w:endnoteReference correspondant dans document.xml : ces quatre fichiers
# n'ont AUCUNE vraie note. Voir aussi le filtre orphelines plus bas (lire()), qui retire
# maintenant toute note — technique ou non — jamais appelée dans le corps.
_TYPES_NOTE_TECHNIQUES = ('separator', 'continuationSeparator', 'continuationNotice')

# w:sym (Insertion > Symbole) : Word ne pose alors aucun w:t, seulement w:char (un point de
# code, en hexadécimal) et w:font. Une puce Wingdings/Symbol courante a un équivalent Unicode
# réel — U+F0B7 est LE POINT MÉDIAN de ces polices, universellement utilisé comme puce ; tout
# le reste rend le caractère TEL QUEL (perte silencieuse sinon, §10 du contrat) et se signale
# (voir _rendu_sym et le recensement 'symboles_police_speciale').
_MAP_SYM_PUCES = {0xF0B7: '•'}
_POLICES_SYMBOLES = ('wingdings', 'wingdings2', 'wingdings3', 'symbol', 'webdings')

PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# ---------------------------------------------------------------------------------
# Texte d'un run — voir le point 1 de l'en-tête : les substitutions de tiret n'ont plus leur
# place ici depuis le 19.09.2026, Fragment.texte porte le tiret RÉEL du document.

def _rendu_sym(el, recensement):
    """Le caractère qu'un w:sym représente — voir la note sur _MAP_SYM_PUCES ci-dessus.
    w:char hors plage Unicode valide, ou illisible : '' (rien à restituer), jamais une
    exception qui ferait échouer la lecture d'un manuscrit entier pour un seul symbole."""
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
        # Police à mise en correspondance non standard connue : le caractère est repris tel
        # quel (mieux qu'un silence total), mais signalé — voir le recensement dans lire().
        recensement['symboles_police_speciale'] += 1
        recensement.setdefault('polices_symboles_vues', set()).add(el.get(W + 'font') or police)
    return chr(point)


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


def _texte_depuis_enfants(enfants, recensement):
    """⚠ Révision du 19.09.2026 : w:tab rend désormais '\\t' et w:br/w:cr rendent '\\n' — plus
    une simple espace comme avant (voir le point 5 de l'en-tête). C'est ce qui rend enfin
    UTILE la logique de nettoyer_mise_en_forme() qui cherche une tabulation en tête et un
    saut de ligne en queue de paragraphe : avant cette révision, cette logique ne pouvait
    JAMAIS se déclencher, ces caractères étant déjà des espaces à son arrivée — du code mort.
    Sans conséquence sur projeter_pronto() : pronto_modele.normaliser() finit par
    ' '.join(t.split()), qui traite '\\t'/'\\n' exactement comme une espace (str.split() les
    reconnaît tous deux comme des blancs) — la projection reste donc identique à
    pronto_docx.lire(), qui rend '\\t'/'\\n' en espace dès la lecture."""
    morceaux = []
    for e in enfants:
        if e.tag in _TAGS_TEXTE:
            morceaux.append(e.text or '')
        elif e.tag == W + 'tab':
            morceaux.append('\t')
        elif e.tag in (W + 'br', W + 'cr'):
            morceaux.append('\n')
        elif e.tag == W + 'noBreakHyphen':
            morceaux.append('‑')  # le VRAI trait d'union insécable, jamais un '-' banal
        elif e.tag == W + 'sym':
            morceaux.append(_rendu_sym(e, recensement))
        # w:softHyphen : invisible sauf en fin de ligne rendue, jamais un caractère du texte
        # normalisé — ignoré, comme le fait déjà pronto_docx.texte_paragraphe.
    return ''.join(morceaux)


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


def _lire_rstyle(rpr):
    """Le style de CARACTÈRE porté par ce rPr (w:rStyle), ou None — distinct d'un style de
    PARAGRAPHE (w:pStyle, résolu par pronto_docx.resoudre_style/pstyle)."""
    if rpr is None:
        return None
    el = rpr.find(W + 'rStyle')
    return el.get(W + 'val') if el is not None else None


# ---------------------------------------------------------------------------------
# Mise en forme EFFECTIVE (§4 du contrat, Fragment.effectif, ajouté le 19.09.2026) : directe
# (w:rPr du run — _forme_directe ci-dessus, INCHANGÉE) sinon style de caractère (w:rStyle)
# sinon chaîne des styles de paragraphe (w:pStyle -> w:basedOn -> ...) sinon
# w:docDefaults/w:rPrDefault. Motivé par classer_titres() (§5.1) : « corps sans taille
# déclarée » et « faux titre déclaré 12 pt » sont aujourd'hui jugés différents par la forme
# DIRECTE alors qu'ils font tous deux 12 pt une fois la cascade résolue — ce champ est ce
# qu'un lot ultérieur utilisera pour comparer les DEUX sur un pied d'égalité. `forme` reste
# strictement inchangée (§5.2 : jamais la cascade des styles pour le NETTOYAGE).
#
# styles.xml n'est lu ICI qu'une seule fois par document (_index_styles_complet), séparément
# de pronto_docx.charger_styles (qui ne garde que id -> nom, insuffisant pour remonter une
# chaîne de w:rPr/w:pPr) — les deux coexistent : celui-ci résout les NOMS affichés (§3,
# repris tel quel de pronto_docx.py), celui-là résout les ATTRIBUTS hérités.

def _index_styles_complet(z):
    """{styleId: {'basedOn': styleId|None, 'ppr': Element|None, 'rpr': Element|None}}, plus
    (rPrDefault, pPrDefault) de w:docDefaults — une seule lecture de styles.xml, réutilisée
    pour la mise en forme EFFECTIVE (ce module) et pour un numPr HÉRITÉ d'un style (§5.4, voir
    _numpr_depuis_style). styles.xml absent : index vide, les deux None — la mise en forme
    effective retombe alors sur la forme directe seule, jamais une exception."""
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
    """[style_id, parent, grand-parent, ...] en remontant w:basedOn — jamais deux fois le
    même styleId (une boucle basedOn est un styles.xml corrompu ; absent du corpus réel, mais
    un parcours qui bouclerait dessus figerait la lecture d'un manuscrit entier)."""
    chaine = []
    vus = set()
    while style_id and style_id not in vus and style_id in index_styles:
        vus.add(style_id)
        chaine.append(style_id)
        style_id = index_styles[style_id]['basedOn']
    return chaine


def _fusionner_forme(base, complement):
    """Remplit dans `base` les clés encore None avec celles de `complement` — ne modifie
    jamais un champ déjà déclaré : la source la plus proche (la plus prioritaire) l'emporte
    toujours, seuls les TROUS se comblent en remontant la cascade."""
    for cle in mm.FORME_CLES:
        if base.get(cle) is None and complement.get(cle) is not None:
            base[cle] = complement[cle]
    return base


def _forme_depuis_chaine(style_id, index_styles, base):
    """Comble les trous de `base` (mutée en place) en remontant la chaîne basedOn de
    `style_id`, du plus spécifique au plus général — s'arrête dès que les 12 clés sont
    toutes déclarées, inutile d'aller plus loin."""
    for sid in _chaine_styles(style_id, index_styles):
        rpr = index_styles.get(sid, {}).get('rpr')
        if rpr is not None:
            _fusionner_forme(base, _forme_directe(rpr))
        if all(base.get(c) is not None for c in mm.FORME_CLES):
            break
    return base


def _forme_effective(forme_directe, rstyle_id, pstyle_id, index_styles, rpr_defaut):
    """directe -> style de caractère -> chaîne des styles de paragraphe -> docDefaults —
    l'ordre exact du §4 du contrat (révision du 19.09.2026)."""
    effectif = dict(forme_directe)
    if any(effectif.get(c) is None for c in mm.FORME_CLES) and rstyle_id:
        _forme_depuis_chaine(rstyle_id, index_styles, effectif)
    if any(effectif.get(c) is None for c in mm.FORME_CLES) and pstyle_id:
        _forme_depuis_chaine(pstyle_id, index_styles, effectif)
    if any(effectif.get(c) is None for c in mm.FORME_CLES) and rpr_defaut is not None:
        _fusionner_forme(effectif, _forme_directe(rpr_defaut))
    return effectif


def _numpr_depuis_style(style_id, index_styles):
    """Le premier w:numPr trouvé en remontant la chaîne basedOn de `style_id` (§5.4, ajouté
    le 19.09.2026) : un style de liste porte son numPr dans son propre w:pPr, jamais dans
    celui d'un paragraphe qui se contente de l'appliquer."""
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


# ---------------------------------------------------------------------------------
# Images VML héritées (w:pict / mc:Fallback) — comptage ET récupération, révisés le
# 19.09.2026. Compter les OCCURRENCES de v:imagedata (comme avant cette révision) surcomptait
# d'un facteur mesuré de 5 sur lot-A/4_La méthode Flip Flap.docx : un même r:id peut être
# répété plusieurs fois dans un même groupe (redondance d'affichage héritée), 5 relations
# média DISTINCTES y donnaient 24 occurrences comptées. On compte désormais les r:id
# DISTINCTS, et on les récupère quand leur relation résout vers un média présent dans
# l'archive — 5 des 21 médias de ce fichier réel n'existaient dans AUCUNE sortie avant cette
# révision : ce sont ces images-là. Une image qui ne peut pas être récupérée (relation ou
# octets introuvables) rejoint les mêmes compteurs qu'une image DrawingML dans le même cas
# ('image_sans_relation' / 'image_octets_introuvables', déjà avertis plus bas dans lire()) —
# le message reste vrai quelle que soit l'origine (moderne ou héritée) de la référence cassée.

def _images_depuis_vml(conteneur, rels, z, recensement):
    """Image(s) récupérées d'un conteneur VML (w:pict ou mc:Fallback), une par r:id DISTINCT
    de v:imagedata — jamais par occurrence (voir la note ci-dessus). VML ne déclare ni cx/cy
    en EMU ni texte alternatif au même endroit que DrawingML : ces deux champs restent à leur
    valeur par défaut (0, ''). Un conteneur SANS AUCUN v:imagedata (pure forme vectorielle
    héritée — rectangle, connecteur…) n'est pas une image à récupérer : compté une seule fois
    dans 'image_vml_ignoree', jamais 0, pour ne rien faire disparaître du décompte (même
    principe que l'ancien comptage, conservé)."""
    images = []
    vus = set()
    trouve_imagedata = False
    for d in conteneur.iter(V + 'imagedata'):
        trouve_imagedata = True
        rid = d.get(R + 'id')
        if rid and rid in vus:
            continue  # même image référencée deux fois dans ce groupe : pas une seconde
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
    """Correction du 18.09.2026 (revue adverse, sur lot-A/4_La méthode Flip Flap.docx),
    récupération ajoutée le 19.09.2026 : _enfants_utiles() ne regarde QUE la branche
    mc:Choice d'un mc:AlternateContent (voir sa note) pour ne pas compter deux fois le MÊME
    dessin redit en VML dans mc:Fallback — mais cette hypothèse (« la même forme, redite »)
    est fausse pour 4 des 10 ancrages flottants de ce fichier réel : leur branche Choice est
    un pur groupe de formes SANS <a:blip> (recensé en 'forme_vectorielle_ignoree»,
    correctement), mais leur branche Fallback, elle, porte un VRAI groupe de 5 images
    embarquées (<v:imagedata>) chacune. On ne visite le Fallback QUE quand la branche Choice
    n'a trouvé aucune image propre — sinon ce serait exactement le double comptage que
    _enfants_utiles évite déjà pour les 6 autres ancrages, dont le Fallback ne fait que redire
    la même forme vide."""
    images = []
    for alt in r.findall(MC + 'AlternateContent'):
        choix = alt.find(MC + 'Choice')
        repli = alt.find(MC + 'Fallback')
        if choix is None or repli is None:
            continue
        dessin = choix.find(W + 'drawing')
        if dessin is None or dessin.find('.//' + A + 'blip') is not None:
            continue  # pas un dessin, ou déjà une vraie image côté Choice : rien à ajouter
        images.extend(_images_depuis_vml(repli, rels, z, recensement))
    return images


def _note_depuis_enfants(enfants, decalage_notes_fin):
    """L'identifiant FINAL (déjà décalé pour une note de fin — voir Contexto) du premier appel
    de note trouvé dans ce run, ou None. Word n'en pose jamais deux dans le même run ; un seul
    suffit à respecter le contrat même sur un document malformé qui en porterait plus d'un."""
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
    """`indice` : position du w:r dans SON PARAGRAPHE (Fragment.source, §4 du contrat,
    inchangé). `indice_paragraphe` : position du w:p PORTEUR dans le corps (Image.source —
    corrigé le 19.09.2026 : avant cette date, Image.source recevait `indice`, l'indice du
    RUN, jamais celui du paragraphe ; mesuré : 6 rapports d'images sur 7 valaient alors 0 pour
    toutes leurs images)."""
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
        # Même convention qu'une image (§4 du contrat) : texte == '' quand le fragment porte
        # une note.
        fragments.append(mm.Fragment(texte='', image=None, forme=forme, lien=lien,
                                      source=indice, note=note_id, effectif=effectif))
    # Un run porte normalement du texte OU une image/note, jamais les deux (mesuré sur le
    # corpus réel) ; s'il porte quand même du texte en plus, ou ni l'un ni l'autre, on rend
    # tout de même un Fragment texte pour ne rien perdre et ne jamais rendre une liste vide
    # pour un run qui existe.
    if texte or not fragments:
        fragments.append(mm.Fragment(texte=texte, image=None, forme=forme, lien=lien,
                                      source=indice, effectif=effectif))
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

def _liste_depuis(ppr, style_id, ctx):
    """Résout `numPr` du paragraphe LUI-MÊME ; à défaut (corrigé le 19.09.2026, §5.4), celui
    HÉRITÉ de son style (chaîne basedOn — voir _numpr_depuis_style) : un style de liste ne
    repose pas forcément un numPr sur chaque paragraphe qui l'applique.

    numId="0" (corrigé le 19.09.2026) : convention Word qui retire EXPLICITEMENT toute
    numérotation héritée — ce n'est pas « une liste de format indéterminé », c'est « pas de
    liste du tout », rendu ici par None comme l'absence pure et simple de numPr."""
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
    pstyle_brut = pronto_docx.pstyle(p)
    style_resolu = pronto_docx.resoudre_style(pstyle_brut, styles)
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


def _deplier_sdt_niveau_bloc(container):
    """Remplace en place chaque w:sdt enfant DIRECT de `container` par les enfants de son
    w:sdtContent (récursif : un sdt peut en envelopper un autre) — AJOUTÉ le 19.09.2026 (point
    5 de l'en-tête). Un contrôle de contenu de niveau BLOC (formulaire Word, citation Zotero,
    répertoire de style…) enveloppant un ou plusieurs w:p ENTIERS les rendait invisibles à
    blocs_du_corps() de pronto_docx.py (repris tel quel, §3 : il ne reconnaît que w:p/w:tbl
    comme enfants directs de son conteneur) — SANS AUCUN avertissement, à l'exact endroit où
    le §10 du contrat interdit le silence. Le cas de niveau RUN (un sdt enveloppant des w:r à
    l'intérieur d'un paragraphe) est distinct et déjà couvert par _CONTENEURS_PASSE_PLAT dans
    _runs_de_paragraphe. Un sdt sans sdtContent (rare, contrôle vide) disparaît proprement,
    rien à reporter."""
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
    """Les Paragraphe|Tableau enfants DIRECTS de `container` (un w:tc, un w:footnote…) —
    `source` = position locale dans CE conteneur, comme Cellule elle-même n'a pas de champ
    `source` (§4 du contrat) : pas de chemin complet, seulement une position locale."""
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


def _racine_ou_none(z, chemin):
    """Element racine d'un fichier XML optionnel de l'archive, ou None s'il est absent ou
    illisible — jamais une exception : footnotes.xml, endnotes.xml, comments.xml n'existent
    pas dans un .docx qui n'en a pas besoin."""
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
    """Le plus grand identifiant de note de bas de page RÉEL (hors séparateurs techniques),
    0 si aucun — AJOUTÉ le 19.09.2026 (§4 du contrat) : une note de fin reçoit son identifiant
    BRUT plus ce décalage, ce qui la place toujours au-delà de la plus grande note de bas de
    page existante et lui garantit de ne jamais entrer en collision avec elle dans
    Document.notes (les deux familles utilisent chacune leur propre numérotation dans le
    document Word d'origine, et peuvent donc partager le même identifiant brut)."""
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
    """{id_final: [Paragraphe|Tableau, ...]} — `tag_note` : W+'footnote' (decalage=0) ou
    W+'endnote' (decalage=_decalage_notes_fin(...), voir lire()). AJOUTÉ/RÉÉCRIT le
    19.09.2026 (§4 du contrat) : rendait auparavant une LISTE PLATE de tous les blocs de
    toutes les notes de bas de page confondues (aucune façon de savoir laquelle appelle quoi),
    et ne lisait jamais word/endnotes.xml du tout."""
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
    """{id, ...} des notes RÉELLEMENT appelées par un Fragment.note à l'intérieur de `blocs`
    (paragraphes ET cellules de tableau, à toute profondeur). AJOUTÉ le 19.09.2026 (superviseur,
    sur mesure de l'agent de l'écrivain) : une note présente dans footnotes.xml/endnotes.xml
    mais qu'AUCUN w:footnoteReference/w:endnoteReference n'appelle dans document.xml est une
    note FANTÔME — mesuré sur 1bis, 2-dense, 2-grappes et 5bis, où un type technique de plus
    que _TYPES_NOTE_TECHNIQUES ne couvrait pas encore ('continuationNotice') apparaissait dans
    les deux fichiers de notes SANS aucun renvoi correspondant : ces quatre fichiers n'ont, une
    fois filtré, AUCUNE vraie note. Voir lire(), qui appelle cette fonction sur le corps ET,
    par propagation, sur le contenu des notes retenues (une note peut, rarement, en appeler une
    autre)."""
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
    """Rend un manuscrit_modele.Document (§4 du contrat). Toute erreur de lecture (zip
    invalide, document.xml absent ou mal formé) se propage — même contrat que
    pronto_docx.lire()."""
    recensement = {'forme_vectorielle_ignoree': 0, 'image_sans_relation': 0,
                   'image_octets_introuvables': 0, 'image_vml_ignoree': 0,
                   'image_dimensions_indisponibles': 0, 'symboles_police_speciale': 0,
                   'polices_symboles_vues': set()}

    with zipfile.ZipFile(chemin) as z:
        noms = z.namelist()
        racine = ET.fromstring(z.read('word/document.xml'))
        racine_footnotes = _racine_ou_none(z, 'word/footnotes.xml')
        racine_endnotes = _racine_ou_none(z, 'word/endnotes.xml')
        styles_id_nom = pronto_docx.charger_styles(z)
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
        # Déplié AVANT blocs_du_corps() de pronto_docx.py (repris tel quel, §3) : un w:sdt de
        # niveau bloc, enfant direct du corps, lui serait invisible (voir le point 5 de
        # l'en-tête et _deplier_sdt_niveau_bloc).
        body = racine.find(W + 'body')
        if body is not None:
            _deplier_sdt_niveau_bloc(body)

        elements = pronto_docx.blocs_du_corps(racine)
        marqueurs_total = sum(pronto_docx.compter_marqueurs_page(e) for e in elements)
        blocs = []
        cumul = 0
        for i, e in enumerate(elements):
            if e.tag == W + 'p':
                blocs.append(_paragraphe_depuis(e, styles_id_nom, rels, z, recensement, i, ctx))
            else:
                page = (1 + cumul) if marqueurs_total > 0 else None
                blocs.append(_tableau_depuis(e, styles_id_nom, rels, z, recensement, i, ctx,
                                              page=page))
            cumul += pronto_docx.compter_marqueurs_page(e)

        # Filtre des notes ORPHELINES (superviseur, 19.09.2026) : une note présente dans
        # footnotes.xml/endnotes.xml qu'AUCUN fragment n'appelle n'est pas une vraie note de ce
        # document — voir _ids_notes_appelees(). Propagation à point fixe : une note RETENUE
        # peut elle-même en appeler une autre (rare, mais pas interdit par la norme), auquel
        # cas cette autre doit être retenue aussi, même si le corps ne l'appelle pas
        # directement.
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
    if recensement['symboles_police_speciale']:
        polices = ', '.join(sorted(recensement['polices_symboles_vues'])) or '?'
        avertir('symboles-police-speciale',
                ['article', 'occurrences %d' % recensement['symboles_police_speciale'],
                 'polices ' + polices],
                'Ce document porte %d caractère(s) composé(s) via Insertion > Symbole, dans '
                'une police à correspondance non standard (%s) : le caractère est repris tel '
                'quel, sa fidélité doit être vérifiée à l\'écran.'
                % (recensement['symboles_police_speciale'], polices),
                'Dieses Dokument enthält %d über Einfügen > Symbol erstellte(s) Zeichen in '
                'einer Schriftart mit nicht standardisierter Zuordnung (%s): das Zeichen wird '
                'unverändert übernommen, seine Richtigkeit muss am Bildschirm geprüft werden.'
                % (recensement['symboles_police_speciale'], polices))
    if notes_orphelines:
        avertir('notes-orphelines',
                ['article', 'occurrences %d' % len(notes_orphelines)],
                'Ce document porte %d note(s) de bas de page ou de fin présente(s) dans le '
                'fichier mais jamais appelée(s) par un renvoi dans le texte : elles ne sont '
                'pas reprises.' % len(notes_orphelines),
                'Dieses Dokument enthält %d Fuß- oder Endnote(n), die in der Datei vorhanden '
                'sind, aber im Text nie durch einen Verweis aufgerufen werden: sie werden '
                'nicht übernommen.' % len(notes_orphelines))

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
        # Concaténation brute des Fragment — depuis le 19.09.2026, tab/br/cr/tiret y sont
        # RÉELS, plus des espaces/traits d'union déjà substitués (voir le point 1 de l'en-tête)
        # — puis pm.normaliser(), le MÊME que pronto_docx.lire() appelle sur son propre texte
        # brut. ' '.join(t.split()) de normaliser() traite '\t'/'\n' exactement comme une
        # espace (str.split() les reconnaît tous deux comme des blancs), et ses trois
        # substitutions de tiret s'appliquent ici pour la première fois : la projection reste
        # donc l'exact miroir de pronto_docx.lire(), qui applique les deux dès la lecture.
        brut = ''.join(f.texte for f in p.fragments if f.image is None and f.note is None)
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
    for blocs_note in document.notes.values():   # dict{id: [bloc, ...]} depuis le 19.09.2026
        creuser_blocs(blocs_note)
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
