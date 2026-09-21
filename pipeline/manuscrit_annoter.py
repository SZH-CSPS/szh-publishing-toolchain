#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# manuscrit_annoter.py — annote un .docx DÉJÀ au gabarit (la sortie de manuscrit_gabarit.ecrire())
# avec les alertes du contrat §7/§7 bis : révisions Word (w:ins/w:del) pour les corrections
# textuelles déterministes, commentaires Word ancrés pour ce qui demande un jugement, plafonnés.
# Contrat : outils-dev/ARCHITECTURE-nettoyeur-manuscrit.md, §7 ter.
#
# stdlib seule (zipfile, re, json, itertools, datetime, os, tempfile) — pas de python-docx, pas
# de lxml (§2 du contrat). Ce module ne prend AUCUNE décision éditoriale : les alertes arrivent
# déjà tranchées (rule/severity/action/found/suggested) par manuscrit_regles.py/manuscrit_vale.py/
# manuscrit_biblio.py ; il ne fait que les TRADUIRE en marques Word, comme manuscrit_gabarit.py
# traduit les décisions de classement en styles Word.
#
# ── Hypothèse qui simplifie tout, et qui est vraie pour son unique entrée réelle ────────────
# Ce module suppose que le run w:rPr qu'il rencontre ne porte JAMAIS que le sous-ensemble
# {w:b, w:i, w:u, w:vertAlign} — exactement ce que manuscrit_gabarit._rpr_xml() sait écrire
# (§5.2 du contrat : tout le reste, taille/police/couleur/surlignage, est retiré avant d'écrire
# le gabarit). Un run à l'italique/gras/exposant/indice se manipule donc par un jeu de DRAPEAUX
# reconstruits (_banderas_desde_rpr/_rpr_desde_banderas), jamais par une manipulation XML
# générique — plus court, plus sûr, et suffisant pour la seule entrée que ce module doit
# jamais lire (la sortie de l'écrivain). Le w:rPr d'un run SUPPRIMÉ (w:del), lui, est recopié
# VERBATIM (jamais reconstruit) : rien à perdre là, on ne fait que déplacer du texte existant.
#
# ── Ancrage : atomes de texte, pas des runs qu'on couperait en place ────────────────────────
# Chaque paragraphe ciblé est lu UNE fois en une liste de « runs » figée (texte concaténé de
# ses w:t, w:rPr brut, bornes en caractères ET en offsets XML). Toutes les alertes de CE
# paragraphe sont ensuite localisées contre ce texte figé, jamais recalculées après une
# première modification — un paragraphe qui reçoit une révision ET un commentaire ne doit
# jamais voir le second se décaler à cause du premier. Les bornes de toutes les alertes
# deviennent des points de coupe communs ; le paragraphe se découpe en « atomes » (un par
# segment de texte entre deux points de coupe consécutifs, avec le w:rPr du run qui le
# portait) — c'est l'équivalent, sans jamais toucher au XML avant la toute dernière passe, de
# « fractionner les runs aux deux décalages » demandé par le contrat. Une révision FUSIONNE
# les atomes qu'elle couvre en UN SEUL atome de remplacement (w:del+w:ins) ; un commentaire ne
# consomme rien, il pose juste des marqueurs avant/après les atomes qu'il couvre.
#
# ── Le « collage » entre runs est préservé, jamais reconstruit ─────────────────────────────
# Un paragraphe réel peut envelopper des runs dans un <w:hyperlink> (bibliographie, DOI) —
# tout ce qui n'est PAS à l'intérieur d'un <w:r> (ouverture/fermeture de w:hyperlink, w:pPr...)
# est copié tel quel depuis le XML d'origine, jamais régénéré : chaque atome garde l'indice du
# run d'origine dont il vient, et le texte ENTRE deux atomes finaux se relit directement dans
# le w:p d'origine, entre la fin du dernier run couvert par le premier et le début du premier
# run couvert par le second.

import difflib
import itertools
import json
import os
import re
import sys
import tempfile
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

REL_COMMENTS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments'

_RELS_VACIAS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
                'relationships"></Relationships>')

_COMMENTS_XML_DEBUT = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">')

_ETIQUETA_SUGGESTION = {'fr': 'Suggestion', 'de': 'Vorschlag'}

# Nom canonique anglais du style de caractère qui marque un renvoi de commentaire — même
# convention que STYLE_TITRE/STYLE_CORPS de manuscrit_gabarit.py (« heading 1 »/« Body Text ») :
# le w:name reste en anglais même dans un gabarit francophone.
_NOMS_STYLE_MARQUE_COMMENTAIRE = ('annotation reference', 'comment reference')

_RE_RUN = re.compile(r'<w:r(?:\s[^>]*)?>(.*?)</w:r>', re.S)
_RE_RPR = re.compile(r'<w:rPr>(.*?)</w:rPr>', re.S)
_RE_T = re.compile(r'<w:t(?:\s[^>]*)?>(.*?)</w:t>', re.S)
_RE_ITALICA = re.compile(r'\*([^*]+)\*')
_RE_TAG_INICIO_CUERPO = re.compile(r'<(w:p|w:tbl|w:sectPr)\b')
_RE_HYPERLINK = re.compile(r'<w:hyperlink\b[^>]*>.*?</w:hyperlink>', re.S)


# ---------------------------------------------------------------------------------
# Échappement — même convention que manuscrit_gabarit._echapper/_echapper_attribut (copié,
# pas importé : ce module ne dépend d'aucun autre module du chantier, comme le contrat le
# demande pour un module qui n'a que deux fichiers autorisés).

def _escapar(t):
    return (t or '').replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def _escapar_attr(t):
    return _escapar(t).replace('"', '&quot;')


def _desescapar(t):
    return (t.replace('&lt;', '<').replace('&gt;', '>')
             .replace('&quot;', '"').replace('&apos;', "'")
             .replace('&amp;', '&'))


# ---------------------------------------------------------------------------------
# Lecture du corps — enfants directs de w:body (les w:tbl ne comptent pas, §7 ter du contrat),
# porté du patron JS ENFANTS_CORPS_PY de test/js/manuscrit-gabarit.test.js : une regex non
# gourmande sur `<w:tbl\b.*?</w:tbl>` s'arrêterait sur la fermeture d'un tableau IMBRIQUÉ (un
# bloc tableau du gabarit enveloppe le tableau du manuscrit, §5.3) — un comptage d'imbrication
# est la seule méthode sûre.

def _hijos_directos_cuerpo(interior):
    i, n = 0, len(interior)
    resultado = []
    while i < n:
        m = _RE_TAG_INICIO_CUERPO.search(interior, i)
        if not m:
            break
        tag, inicio = m.group(1), m.start()
        fin_apertura = interior.index('>', inicio)
        if interior[fin_apertura - 1] == '/':
            resultado.append((tag, inicio, fin_apertura + 1))
            i = fin_apertura + 1
            continue
        if tag == 'w:sectPr':
            resultado.append((tag, inicio, n))
            break
        profundidad = 1
        j = fin_apertura + 1
        motivo = re.compile(r'<' + tag + r'\b[^>]*?(/?)>|</' + tag + '>')
        while profundidad > 0:
            mm = motivo.search(interior, j)
            if not mm:
                raise ValueError('balise non fermee : ' + tag)
            if mm.group(0).startswith('</'):
                profundidad -= 1
            elif mm.group(1) != '/':
                profundidad += 1
            j = mm.end()
        resultado.append((tag, inicio, j))
        i = j
    return resultado


def _leer_runs(p_xml):
    """Liste des runs, DANS L'ORDRE où ils apparaissent dans p_xml — pas seulement les
    enfants directs de w:p : un run enveloppé dans <w:hyperlink> est vu de la même façon,
    parce que la préservation du « collage » (voir l'en-tête) ne dépend pas de cette
    distinction. Chaque run porte son texte concaténé (les seuls w:t, jamais w:tab/w:br/une
    image — §7 ter du contrat : « concatène ses w:t »), son w:rPr brut, ses offsets XML dans
    p_xml, ses offsets dans le texte du paragraphe, et `en_lien` (dans un <w:hyperlink>).

    ⚠ `en_lien` existe pour un seul usage : EMPÊCHER une révision de fusionner ce run avec
    ses voisins (§7 ter, révision du 21.09.2026, défaut n°3). Fusionner des atomes qui
    chevauchent la frontière d'un <w:hyperlink> perd le XML « de collage » interne au groupe
    (l'ouverture ou la fermeture du lien tombait ENTRE deux atomes désormais fondus en un
    seul) — mesuré sur le corpus réel : un </w:hyperlink> orphelin, sans la moindre exception
    à l'écriture."""
    enlaces = [(m.start(), m.end()) for m in _RE_HYPERLINK.finditer(p_xml)]
    runs = []
    pos_texto = 0
    for m in _RE_RUN.finditer(p_xml):
        contenido = m.group(1)
        rpr_m = _RE_RPR.search(contenido)
        rpr = rpr_m.group(0) if rpr_m else ''
        texto = ''.join(_desescapar(t) for t in _RE_T.findall(contenido))
        en_lien = any(a <= m.start() and m.end() <= b for a, b in enlaces)
        runs.append({'debut_xml': m.start(), 'fin_xml': m.end(), 'rpr': rpr, 'texto': texto,
                     'debut_texto': pos_texto, 'fin_texto': pos_texto + len(texto),
                     'en_lien': en_lien})
        pos_texto += len(texto)
    return runs


def _span_toca_enlace(runs, s, e):
    """Vrai si [s, e) touche le texte d'un run enveloppé dans <w:hyperlink> — une révision ne
    doit alors JAMAIS s'appliquer (voir _leer_runs) : le repli est un commentaire au même
    endroit, jamais un remplacement."""
    return any(r['en_lien'] and r['debut_texto'] < e and s < r['fin_texto'] for r in runs)


# ---------------------------------------------------------------------------------
# Localisation (§7 ter, point 1) — span exact si `found` s'y trouve ; sinon (span absent ou
# faux) un repli PRUDENT, jamais « la première occurrence trouvée ».
#
# ⚠ Révision du 21.09.2026 (défaut n°2 mesuré sur le corpus réel par le lot de branchement) :
# l'ancien repli prenait `texto.find(found)` sans aucune borne — un `found` court et banal
# (« et », « & », raffineurs Vale comme CSPS.APA.EtDansParentheses) peut apparaître À
# L'INTÉRIEUR d'un autre mot avant la vraie occurrence visée (« et » dans « **Cet**te ») et
# corrompt alors du texte réel, sans le moindre signe visible dans le `.docx` produit. Sans
# `span` fiable, le repli n'accepte donc désormais qu'un `found` d'au moins 4 caractères ET
# présent EXACTEMENT une fois dans le paragraphe — ambigu (0 ou plusieurs) ou trop court,
# c'est None : l'appelant ancre alors sur le paragraphe entier (un commentaire, jamais un
# remplacement à l'aveugle).

_LONGUEUR_MIN_FOUND_SANS_SPAN = 4

# Repli TOLÉRANT à la typographie (révision du 21.09.2026) : le pont typographique (§6 du
# contrat) peut avoir posé une apostrophe typographique, une insécable ou un tiret différent
# entre le moment où `found` a été capturé (texte de paragraphe déjà lu par un module
# d'analyse) et celui où l'annotation le cherche dans le MÊME paragraphe. Chaque substitution
# ci-dessous est UN caractère pour UN caractère : une position trouvée dans le texte
# NORMALISÉ reste donc valide telle quelle dans le texte ORIGINAL, jamais besoin de remapper
# des offsets. Ne sert JAMAIS à écrire, seulement à comparer.
_TRANS_TOLERANTE_TYPO = str.maketrans({
    '’': "'", '‘': "'",
    ' ': ' ', ' ': ' ', ' ': ' ',
    '–': '-', '—': '-', '‑': '-',
})


def _normalizar_para_comparar(t):
    return (t or '').translate(_TRANS_TOLERANTE_TYPO)


def _localizar(texto, span, found):
    if not found:
        return None
    if span and len(span) == 2:
        d, f = span
        if 0 <= d <= f <= len(texto) and texto[d:f] == found:
            return (d, f)
    if len(found) < _LONGUEUR_MIN_FOUND_SANS_SPAN:
        return None
    ocurrencias = [m.start() for m in re.finditer(re.escape(found), texto)]
    if len(ocurrencias) == 1:
        pos = ocurrencias[0]
        return (pos, pos + len(found))
    if len(ocurrencias) == 0:
        texto_n = _normalizar_para_comparar(texto)
        found_n = _normalizar_para_comparar(found)
        ocurrencias_n = [m.start() for m in re.finditer(re.escape(found_n), texto_n)]
        if len(ocurrencias_n) == 1:
            pos = ocurrencias_n[0]
            return (pos, pos + len(found))
    return None


# ---------------------------------------------------------------------------------
# Atomes — un paragraphe découpé aux bornes de tous les runs ET de toutes les alertes qui le
# concernent, avant toute écriture (voir l'en-tête).

def _atomos_parrafo(runs, total_len, puntos_extra):
    puntos = {0, total_len}
    for r in runs:
        puntos.add(r['debut_texto'])
        puntos.add(r['fin_texto'])
    for p in puntos_extra:
        if 0 <= p <= total_len:
            puntos.add(p)
    puntos = sorted(puntos)
    atomos = []
    for a, b in zip(puntos, puntos[1:]):
        if a == b:
            continue
        run = next((r for r in runs if r['debut_texto'] <= a and b <= r['fin_texto']), None)
        if run is None:
            continue
        atomos.append({'debut': a, 'fin': b, 'rpr': run['rpr'],
                        'texto': run['texto'][a - run['debut_texto']: b - run['debut_texto']]})
    return atomos


def _rango_atomos_contiene(atomos, s, e):
    """Indices [i1, i2] (inclus) de la plage d'atomes qui couvre [s, e) — par CONTENANCE, pas
    par égalité stricte : robuste si un commentaire vise un passage déjà fusionné par une
    révision voisine. None si `s` tombe à la toute fin du paragraphe (rien à sa droite)."""
    if not atomos:
        return None
    i1 = None
    for i, a in enumerate(atomos):
        if a['debut'] <= s < a['fin']:
            i1 = i
            break
    if i1 is None:
        if s >= atomos[-1]['fin']:
            return None
        i1 = 0
    i2 = i1
    for i in range(i1, len(atomos)):
        i2 = i
        if atomos[i]['fin'] >= e:
            break
    return i1, i2


# ---------------------------------------------------------------------------------
# Runs plats, révisions, insertions avec italique segmentée (§7 ter, points 2-3).

def _run_plano_xml(rpr, texto):
    if not texto:
        return ''
    return '<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>' % (rpr, _escapar(texto))


def _banderas_desde_rpr(rpr):
    return {
        'gras': '<w:b/>' in rpr,
        'italique': '<w:i/>' in rpr,
        'souligne': '<w:u ' in rpr,
        'exposant': 'superscript' in rpr,
        'indice': 'subscript' in rpr,
    }


def _rpr_desde_banderas(b):
    partes = []
    if b.get('gras'):
        partes.append('<w:b/>')
    if b.get('italique'):
        partes.append('<w:i/>')
    if b.get('souligne'):
        partes.append('<w:u w:val="single"/>')
    if b.get('exposant'):
        partes.append('<w:vertAlign w:val="superscript"/>')
    elif b.get('indice'):
        partes.append('<w:vertAlign w:val="subscript"/>')
    if not partes:
        return ''
    return '<w:rPr>' + ''.join(partes) + '</w:rPr>'


def _segmentos_italica(texto):
    """[(texte, est_italique)] à partir des segments *…* de `texto` — les astérisques
    eux-mêmes ne sont jamais écrits (§7 ter, point 2 : « suggested peut porter de l'italique
    marquée *…* »)."""
    resultado = []
    pos = 0
    for m in _RE_ITALICA.finditer(texto):
        if m.start() > pos:
            resultado.append((texto[pos:m.start()], False))
        resultado.append((m.group(1), True))
        pos = m.end()
    if pos < len(texto):
        resultado.append((texto[pos:], False))
    return resultado


def _xml_del(id_, autor, fecha, grupo):
    runs_xml = ''.join(
        '<w:r>%s<w:delText xml:space="preserve">%s</w:delText></w:r>' % (a['rpr'], _escapar(a['texto']))
        for a in grupo if a['texto'])
    return '<w:del w:id="%d" w:author="%s" w:date="%s">%s</w:del>' % (
        id_, _escapar_attr(autor), fecha, runs_xml)


def _xml_ins(id_, autor, fecha, rpr_origen, texto_sugerido):
    """Le run inséré hérite du w:rPr du run d'origine, HORS italique (§7 ter, point 2) : la
    segmentation *…* décide seule de l'italique de chaque morceau inséré."""
    banderas_base = dict(_banderas_desde_rpr(rpr_origen), italique=False)
    partes = []
    for fragmento, es_italica in _segmentos_italica(texto_sugerido):
        if not fragmento:
            continue
        b = dict(banderas_base, italique=es_italica) if es_italica else banderas_base
        partes.append('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>'
                       % (_rpr_desde_banderas(b), _escapar(fragmento)))
    return '<w:ins w:id="%d" w:author="%s" w:date="%s">%s</w:ins>' % (
        id_, _escapar_attr(autor), fecha, ''.join(partes))


# ---------------------------------------------------------------------------------
# Révision par JETON — révision du 21.09.2026, demande de Robin : une référence entière ne
# doit plus être barrée puis réinsérée pour trois mots changés (« et » -> « & », un italique,
# un espace). Diff au niveau du MOT/de l'espace/du signe (jamais du caractère, trop bavard ;
# jamais de la phrase entière, ce que ce module faisait jusqu'ici) entre le texte d'ORIGINE
# (les atomes déjà localisés, `grupo`) et `suggested` : seuls les jetons qui changent — texte
# OU italique — deviennent w:del/w:ins, le reste reste des runs NORMAUX, mise en forme
# d'origine intacte, jamais touchés. Un diff qui change plus de 60 % des jetons d'origine
# retombe sur l'ancien comportement (un seul w:del/w:ins couvrant tout le span) : une
# reformulation aussi profonde n'a plus rien à gagner à être éparpillée en petites révisions.

_RE_JETON = re.compile(r'\w+|\s+|[^\w\s]')
_UMBRAL_REEMPLAZO_TOTAL = 0.6
_MIN_JETONES_ISLOTE = 3


def _jetonizar(texto):
    return _RE_JETON.findall(texto or '')


def _jetones_origen(grupo):
    """[(jeton, rpr_de_son_atome)] — un jeton ne franchit jamais la frontière entre deux
    atomes : chaque atome (donc chaque run d'origine) est jetonné SÉPARÉMENT, jamais le texte
    concaténé, pour que le w:rPr d'origine reste attaché au bon fragment."""
    jetones = []
    for a in grupo:
        for tok in _jetonizar(a['texto']):
            jetones.append((tok, a['rpr']))
    return jetones


def _jetones_destino(suggested):
    """[(jeton, est_italique)] — l'italique *…* d'abord segmentée (jamais les astérisques
    eux-mêmes dans un jeton), puis chaque segment jetonné."""
    jetones = []
    for fragmento, es_italica in _segmentos_italica(suggested):
        for tok in _jetonizar(fragmento):
            jetones.append((tok, es_italica))
    return jetones


def _jeton_origen_es_italico(rpr):
    return bool(rpr) and '<w:i/>' in rpr


def _agrupar_para_revision(jetones_o, jetones_d):
    """[{cambia, i1, i2, j1, j2}, ...] à partir d'un diff PAR JETON — seuls les groupes
    `cambia` deviennent w:del/w:ins. Un groupe 'equal' (même texte) dont l'italique doit
    changer est aussi `cambia` : le seul moyen de basculer l'italique est w:del + w:ins,
    jamais w:rPrChange (trop fragile, §7 ter). Les îlots INCHANGÉS de moins de
    `_MIN_JETONES_ISLOTE` jetons, coincés ENTRE deux groupes changés, sont absorbés dans le
    changement voisin — sinon trois mots changés à deux mots d'écart produisent trois
    révisions séparées par un îlot minuscule, la « mitraille » que ce lot doit éviter."""
    origenes = [t for t, _ in jetones_o]
    destinos = [t for t, _ in jetones_d]
    opcodes = difflib.SequenceMatcher(None, origenes, destinos, autojunk=False).get_opcodes()
    grupos = []
    for tag, i1, i2, j1, j2 in opcodes:
        if tag != 'equal':
            grupos.append({'cambia': True, 'i1': i1, 'i2': i2, 'j1': j1, 'j2': j2})
            continue
        # Un opcode 'equal' (même TEXTE) peut rester très long — c'est justement le but du
        # diff par jeton. Le resubdiviser jeton par jeton, là où l'italique bascule, est donc
        # OBLIGATOIRE : marquer tout le groupe `cambia` dès qu'UN SEUL jeton doit changer
        # d'italique ferait à nouveau barrer une référence entière pour un seul mot en
        # italique perdu au milieu d'un long passage par ailleurs identique (défaut mesuré en
        # écrivant ce lot).
        debut, cambia_courant = i1, None
        for k in range(i1, i2):
            c = _jeton_origen_es_italico(jetones_o[k][1]) != bool(jetones_d[j1 + (k - i1)][1])
            if cambia_courant is None:
                cambia_courant = c
            elif c != cambia_courant:
                grupos.append({'cambia': cambia_courant, 'i1': debut, 'i2': k,
                                'j1': j1 + (debut - i1), 'j2': j1 + (k - i1)})
                debut, cambia_courant = k, c
        grupos.append({'cambia': bool(cambia_courant), 'i1': debut, 'i2': i2,
                        'j1': j1 + (debut - i1), 'j2': j1 + (i2 - i1)})

    encore = True
    while encore:
        encore = False
        for idx in range(1, len(grupos) - 1):
            g = grupos[idx]
            if (not g['cambia'] and (g['i2'] - g['i1']) < _MIN_JETONES_ISLOTE
                    and grupos[idx - 1]['cambia'] and grupos[idx + 1]['cambia']):
                g['cambia'] = True
                encore = True
        fusion = []
        for g in grupos:
            if fusion and fusion[-1]['cambia'] and g['cambia']:
                fusion[-1] = {'cambia': True, 'i1': fusion[-1]['i1'], 'i2': g['i2'],
                               'j1': fusion[-1]['j1'], 'j2': g['j2']}
            else:
                fusion.append(dict(g))
        grupos = fusion
    return grupos


def _xml_del_jetones(id_, autor, fecha, jetones):
    """Comme _xml_del, à partir d'une liste (jeton, rpr) — un w:r par changement de rpr
    CONSÉCUTIF, jamais un w:r par jeton (XML inutilement bavard)."""
    runs_xml = []
    rpr_actuel, tampon = None, []
    for tok, rpr in jetones:
        if rpr_actuel is None or rpr == rpr_actuel:
            tampon.append(tok)
            rpr_actuel = rpr
        else:
            if tampon:
                runs_xml.append('<w:r>%s<w:delText xml:space="preserve">%s</w:delText></w:r>'
                                 % (rpr_actuel or '', _escapar(''.join(tampon))))
            tampon, rpr_actuel = [tok], rpr
    if tampon:
        runs_xml.append('<w:r>%s<w:delText xml:space="preserve">%s</w:delText></w:r>'
                         % (rpr_actuel or '', _escapar(''.join(tampon))))
    return '<w:del w:id="%d" w:author="%s" w:date="%s">%s</w:del>' % (
        id_, _escapar_attr(autor), fecha, ''.join(runs_xml))


def _xml_ins_jetones(id_, autor, fecha, rpr_base, jetones):
    """Comme _xml_ins, à partir d'une liste (jeton, est_italique) — un w:r par changement
    d'italique CONSÉCUTIF."""
    banderas_base = dict(_banderas_desde_rpr(rpr_base), italique=False)
    runs_xml = []
    italica_actuelle, tampon = None, []
    for tok, es_italica in jetones:
        if italica_actuelle is None or es_italica == italica_actuelle:
            tampon.append(tok)
            italica_actuelle = es_italica
        else:
            if tampon:
                b = dict(banderas_base, italique=bool(italica_actuelle))
                runs_xml.append('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>'
                                 % (_rpr_desde_banderas(b), _escapar(''.join(tampon))))
            tampon, italica_actuelle = [tok], es_italica
    if tampon:
        b = dict(banderas_base, italique=bool(italica_actuelle))
        runs_xml.append('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>'
                         % (_rpr_desde_banderas(b), _escapar(''.join(tampon))))
    return '<w:ins w:id="%d" w:author="%s" w:date="%s">%s</w:ins>' % (
        id_, _escapar_attr(autor), fecha, ''.join(runs_xml))


def _run_plano_jetones(jetones):
    """Jetons NON changés -> runs plats (un par changement de rpr CONSÉCUTIF) — la mise en
    forme d'origine reste intacte, rien n'est marqué w:del/w:ins."""
    piezas = []
    rpr_actuel, tampon = None, []
    for tok, rpr in jetones:
        if rpr_actuel is None or rpr == rpr_actuel:
            tampon.append(tok)
            rpr_actuel = rpr
        else:
            piezas.append(_run_plano_xml(rpr_actuel or '', ''.join(tampon)))
            tampon, rpr_actuel = [tok], rpr
    if tampon:
        piezas.append(_run_plano_xml(rpr_actuel or '', ''.join(tampon)))
    return ''.join(piezas)


def _construir_revision(grupo, suggested, contador, autor, fecha):
    """XML d'une révision — diff PAR JETON entre le texte d'origine de `grupo` et `suggested`
    (voir l'en-tête ci-dessus). Retombe sur l'ancien remplacement complet (un seul w:del/w:ins
    couvrant tout le span) si `grupo` ne porte aucun texte ou si plus de 60 % de ses jetons
    changent."""
    jetones_o = _jetones_origen(grupo)
    jetones_d = _jetones_destino(suggested)
    rpr_base = grupo[0]['rpr']

    if not jetones_o:
        grupos, ratio = [], 1.0
    else:
        grupos = _agrupar_para_revision(jetones_o, jetones_d)
        n_cambies = sum(g['i2'] - g['i1'] for g in grupos if g['cambia'])
        ratio = n_cambies / len(jetones_o)

    if not jetones_o or ratio > _UMBRAL_REEMPLAZO_TOTAL:
        id_del, id_ins = next(contador), next(contador)
        return (_xml_del(id_del, autor, fecha, grupo)
                + _xml_ins(id_ins, autor, fecha, rpr_base, suggested))

    piezas = []
    for g in grupos:
        seg_o = jetones_o[g['i1']:g['i2']]
        seg_d = jetones_d[g['j1']:g['j2']]
        if not g['cambia']:
            piezas.append(_run_plano_jetones(seg_o))
            continue
        if seg_o:
            piezas.append(_xml_del_jetones(next(contador), autor, fecha, seg_o))
        if seg_d:
            piezas.append(_xml_ins_jetones(next(contador), autor, fecha, rpr_base, seg_d))
    return ''.join(piezas)


def _marca_inicio(id_):
    return '<w:commentRangeStart w:id="%d"/>' % id_


def _marca_fin(id_, style_marca):
    rpr = ('<w:rPr><w:rStyle w:val="%s"/></w:rPr>' % style_marca) if style_marca else ''
    return '<w:commentRangeEnd w:id="%d"/><w:r>%s<w:commentReference w:id="%d"/></w:r>' % (
        id_, rpr, id_)


def _comentario_xml(id_, autor, fecha, iniciales, lineas):
    parrafos = ''.join(
        '<w:p><w:r><w:t xml:space="preserve">%s</w:t></w:r></w:p>' % _escapar(l)
        for l in lineas)
    return ('<w:comment w:id="%d" w:author="%s" w:date="%s" w:initials="%s">%s</w:comment>'
            % (id_, _escapar_attr(autor), fecha, _escapar_attr(iniciales), parrafos))


# ---------------------------------------------------------------------------------
# Style de la marque de commentaire, styleId résolu depuis les styles du document si le
# gabarit en définit un — même patron que manuscrit_gabarit._styleid_par_nom (copié : ce
# module n'importe aucun autre fichier du chantier, voir l'en-tête).

def _styleid_por_nombre(styles_xml, nombres):
    if not styles_xml:
        return None
    nombres_lower = {n.lower() for n in nombres}
    for m in re.finditer(r'<w:style\b[^>]*w:styleId="([^"]*)"[^>]*>(.*?)</w:style>',
                          styles_xml, re.S):
        sid, cuerpo = m.group(1), m.group(2)
        nm = re.search(r'<w:name\s+w:val="([^"]*)"', cuerpo)
        if nm and nm.group(1).lower() in nombres_lower:
            return sid
    return None


def _iniciales(autor):
    palabras = [p for p in re.split(r'\s+', (autor or '').strip()) if p]
    if not palabras:
        return '??'
    if len(palabras) == 1:
        return (palabras[0][:2] or '??').upper()
    return (palabras[0][0] + palabras[1][0]).upper()


def _fecha_iso():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


def _proximo_contador(doc_xml, comments_xml):
    """Premier identifiant libre pour w:id — au-delà du plus grand déjà présent dans le
    document (révisions, commentaires, MAIS AUSSI signets : un surensemble ne peut jamais
    provoquer de collision, voir §7 ter du contrat : « identifiants uniques croissants pour
    tous les w:id de révision et de commentaire »)."""
    ids = [int(m) for m in re.findall(r'\bw:id="(\d+)"', doc_xml)]
    if comments_xml:
        ids += [int(m) for m in re.findall(r'\bw:id="(\d+)"', comments_xml)]
    return (max(ids) + 1) if ids else 1


def _contar_regla(stats, alerta, campo):
    regla = alerta.get('rule')
    entrada = stats['par_regle'].setdefault(
        regla, {'revisions': 0, 'commentes': 0, 'renvoyees': 0, 'signalees': 0})
    entrada[campo] = entrada.get(campo, 0) + 1


def _texto_sin_marcas_italica(suggested):
    """`suggested` sans le marquage *…* — pour un usage en TEXTE PLAT (un commentaire Word ne
    rend jamais le Markdown, §7 ter, point 4) : des astérisques littéraux n'y disent rien à
    une relectrice. Une note signale qu'un passage était en italique, sans jamais le marquer."""
    if not suggested or '*' not in suggested:
        return suggested
    segments = _segmentos_italica(suggested)
    texte = ''.join(t for t, _ in segments)
    if any(es for _, es in segments):
        return texte + ' (élément(s) en italique dans la révision)'
    return texte


def _construir_texto_comentario(alerta, es_sintesis, total_por_regla, langue):
    mensaje = alerta.get('message') or ''
    if es_sintesis:
        extra = total_por_regla.get(alerta.get('rule'), 0) - 5
        frase = '… et %d autres occurrences de cette règle, voir le rapport.' % extra
        mensaje = ('%s %s' % (mensaje, frase)) if mensaje else frase
    lineas = [mensaje]
    if alerta.get('suggested'):
        etiqueta = _ETIQUETA_SUGGESTION.get(langue, 'Suggestion')
        lineas.append('%s : %s' % (etiqueta, _texto_sin_marcas_italica(alerta['suggested'])))
    lineas.append('[%s]' % alerta.get('rule'))
    return lineas


# ---------------------------------------------------------------------------------
# Un paragraphe entier : révisions puis commentaires, dans cet ordre (les commentaires
# peuvent ancrer sur un passage déjà fusionné par une révision — §7 ter, point 3).

def _puntos_extra(revisiones, comentarios, total_len):
    pts = []
    for span, _a in revisiones:
        pts += [span[0], span[1]]
    for span, _a, _s in comentarios:
        if span is not None:
            pts += [span[0], span[1]]
        else:
            pts += [0, total_len]
    return pts


def _anotar_parrafo(p_xml, revisiones, comentarios, contador, autor, fecha, iniciales,
                     style_comentario, langue, stats, total_por_regla, comments_nuevos):
    if p_xml.endswith('/>'):
        p_xml = p_xml[:-2] + '></w:p>'
    runs = _leer_runs(p_xml)
    total_len = sum(len(r['texto']) for r in runs)
    atomos = _atomos_parrafo(runs, total_len, _puntos_extra(revisiones, comentarios, total_len))

    def finalizar_comentario(alerta, es_sintesis):
        id_ = next(contador)
        lineas = _construir_texto_comentario(alerta, es_sintesis, total_por_regla, langue)
        comments_nuevos.append(_comentario_xml(id_, autor, fecha, iniciales, lineas))
        stats['commentaires'] += 1
        _contar_regla(stats, alerta, 'commentes')
        if es_sintesis:
            stats['commentaires_synthese'] += 1
        return id_

    # Paragraphe sans le moindre atome de texte (aucun run, ou runs tous vides) : seuls des
    # commentaires en paragraphe entier ont pu s'y ancrer (span=None -> s=e=0) ; les deux
    # marqueurs se posent dos à dos juste avant la fermeture, rien à fractionner.
    if not runs or not atomos:
        marcas = []
        for _span, alerta, es_sintesis in comentarios:
            id_ = finalizar_comentario(alerta, es_sintesis)
            marcas.append(_marca_inicio(id_))
            marcas.append(_marca_fin(id_, style_comentario))
        if not marcas:
            return p_xml
        return p_xml[:-len('</w:p>')] + ''.join(marcas) + '</w:p>'

    for a in atomos:
        for i, r in enumerate(runs):
            if r['debut_texto'] <= a['debut'] and a['fin'] <= r['fin_texto']:
                a['run_ini'] = a['run_fin'] = i
                break
        a['xml'] = _run_plano_xml(a['rpr'], a['texto'])

    for span, alerta in revisiones:
        s, e = span
        grupo = [a for a in atomos if a['debut'] >= s and a['fin'] <= e]
        if not grupo:
            continue
        i1 = next(i for i, a in enumerate(atomos) if a is grupo[0])
        i2 = next(i for i, a in enumerate(atomos) if a is grupo[-1])
        xml_revision = _construir_revision(
            grupo, str(alerta.get('suggested')), contador, autor, fecha)
        nuevo = {'debut': s, 'fin': e, 'xml': xml_revision,
                 'run_ini': grupo[0]['run_ini'], 'run_fin': grupo[-1]['run_fin']}
        atomos[i1:i2 + 1] = [nuevo]
        stats['revisions'] += 1
        _contar_regla(stats, alerta, 'revisions')

    antes, despues = {}, {}
    for span, alerta, es_sintesis in comentarios:
        s, e = span if span is not None else (0, total_len)
        rango = _rango_atomos_contiene(atomos, s, e)
        id_ = finalizar_comentario(alerta, es_sintesis)
        if rango is None:
            despues.setdefault(id(atomos[-1]), []).append(
                _marca_inicio(id_) + _marca_fin(id_, style_comentario))
            continue
        i1, i2 = rango
        antes.setdefault(id(atomos[i1]), []).append(_marca_inicio(id_))
        despues.setdefault(id(atomos[i2]), []).append(_marca_fin(id_, style_comentario))

    piezas = [p_xml[:runs[atomos[0]['run_ini']]['debut_xml']]]
    for i, a in enumerate(atomos):
        piezas.append(''.join(antes.get(id(a), [])))
        piezas.append(a['xml'])
        piezas.append(''.join(despues.get(id(a), [])))
        if i + 1 < len(atomos):
            sig = atomos[i + 1]
            piezas.append(p_xml[runs[a['run_fin']]['fin_xml']:runs[sig['run_ini']]['debut_xml']])
    piezas.append(p_xml[runs[atomos[-1]['run_fin']]['fin_xml']:])
    return ''.join(piezas)


# ---------------------------------------------------------------------------------
# Point d'entrée.

def annoter(chemin_docx_entree, chemin_docx_sortie, alertes, correspondance, langue='fr',
            auteur='Relecture automatique', plafond_commentaires=25):
    """Ancre les `alertes` (schéma du contrat §7, huit champs) sur `chemin_docx_entree` (déjà
    au gabarit — voir manuscrit_gabarit.ecrire()) via `correspondance` (liste de
    {'source', 'sortie'}, voir sa docstring), et écrit le résultat dans `chemin_docx_sortie`
    (qui peut être le même chemin que l'entrée : écriture dans un temporaire puis remplacement,
    l'entrée n'est JAMAIS modifiée en place — voir l'en-tête). Rend les statistiques du
    contrat §7 ter, point 7."""
    with zipfile.ZipFile(chemin_docx_entree) as zin:
        contenidos = {nombre: zin.read(nombre) for nombre in zin.namelist()}

    doc_xml = contenidos['word/document.xml'].decode('utf-8')
    rels_xml = (contenidos['word/_rels/document.xml.rels'].decode('utf-8')
                if 'word/_rels/document.xml.rels' in contenidos else _RELS_VACIAS)
    ct_xml = contenidos['[Content_Types].xml'].decode('utf-8')
    styles_xml = (contenidos['word/styles.xml'].decode('utf-8')
                  if 'word/styles.xml' in contenidos else '')
    comments_previos_xml = (contenidos['word/comments.xml'].decode('utf-8')
                             if 'word/comments.xml' in contenidos else None)

    i_body = doc_xml.index('<w:body>')
    i_fin_body = doc_xml.rindex('</w:body>')
    prefijo_doc = doc_xml[:i_body + len('<w:body>')]
    interior = doc_xml[i_body + len('<w:body>'):i_fin_body]
    sufijo_doc = doc_xml[i_fin_body:]

    indices_p = [(d, f) for (tag, d, f) in _hijos_directos_cuerpo(interior) if tag == 'w:p']

    origen_a_salida = {}
    for c in (correspondance or []):
        origen_a_salida.setdefault(c['source'], c['sortie'])

    contador = itertools.count(_proximo_contador(doc_xml, comments_previos_xml))
    fecha = _fecha_iso()
    iniciales = _iniciales(auteur)
    style_comentario = _styleid_por_nombre(styles_xml, _NOMS_STYLE_MARQUE_COMMENTAIRE)

    # `devenir[i]` dit ce qu'est VRAIMENT devenue `alertes[i]` — 'revision' | 'commentaire' |
    # 'rapport' | 'non_ancree' — indexé comme `alertes`, jamais déduit après coup de `action`
    # (défaut réel mesuré, révision du 21.09.2026 ter : `manuscrit-nettoyer.py` déduisait
    # `dans_docx` de `action` pour toute alerte `fix`/`track`, sans savoir que le
    # chevauchement, §7 ter point « 2 bis », avait pu la démoter en commentaire, ou que le
    # plafond, point 3, l'avait renvoyée au rapport — `dans_docx: 'revision'` pouvait donc
    # mentir. Ce module, qui SEUL sait ce qu'il a écrit, porte désormais la vérité).
    devenir = [None] * len(alertes)
    stats = {'revisions': 0, 'commentaires': 0, 'commentaires_synthese': 0,
             'renvoyees_au_rapport': [], 'non_ancrees': [], 'par_regle': {}, 'devenir': devenir}

    # 1. Ancrage — quel <w:p> de sortie, si aucun jamais perdu en silence (§7 ter, point 1).
    por_salida = {}
    for idx, alerta in enumerate(alertes):
        para = alerta.get('para')
        salida = origen_a_salida.get(para) if para is not None else None
        if salida is None or not (0 <= salida < len(indices_p)):
            stats['non_ancrees'].append(alerta)
            devenir[idx] = 'non_ancree'
            continue
        por_salida.setdefault(salida, []).append((idx, alerta))

    # 2. Localisation + classement révision/commentaire, texte figé PAR PARAGRAPHE (voir
    # l'en-tête : jamais recalculé après une première modification du même paragraphe).
    candidatos_comentario = []
    revisiones_por_salida = {}
    for salida, lista in por_salida.items():
        debut_p, fin_p = indices_p[salida]
        p_xml_tmp = interior[debut_p:fin_p]
        if p_xml_tmp.endswith('/>'):
            p_xml_tmp = p_xml_tmp[:-2] + '></w:p>'
        runs_tmp = _leer_runs(p_xml_tmp)
        texto_tmp = ''.join(r['texto'] for r in runs_tmp)
        for idx, alerta in lista:
            localizado = _localizar(texto_tmp, alerta.get('span'), alerta.get('found'))
            accion = alerta.get('action')
            # Un span qui touche un run de lien ne devient JAMAIS une révision (défaut n°3,
            # voir _span_toca_enlace) : il reste localisé, mais repart au fil des commentaires.
            peut_reviser = (accion in ('fix', 'track') and alerta.get('suggested')
                             and localizado is not None
                             and not _span_toca_enlace(runs_tmp, *localizado))
            if peut_reviser:
                revisiones_por_salida.setdefault(salida, []).append((idx, localizado, alerta))
            elif accion == 'report':
                _contar_regla(stats, alerta, 'signalees')
                devenir[idx] = 'rapport'
            else:
                # action == 'comment', fix/track non localisable/sans suggestion, ou span
                # touchant un lien (§7 ter, points 3 et défaut n°3) : repli commentaire,
                # jamais perdu.
                candidatos_comentario.append((idx, alerta, salida, localizado))

    # 2 bis. Chevauchements entre révisions d'un MÊME paragraphe (§7 ter, révision du
    # 21.09.2026, défaut n°1) : fusionner deux atomes déjà fusionnés par une révision voisine
    # fait perdre la clé 'texto' de l'atome de remplacement (KeyError, mesuré sur le corpus
    # réel : deux règles distinctes — Vale et manuscrit_biblio.py — lèvent chacune leur propre
    # alerte sur le MÊME DOI). La plus sévère reste une révision ; l'autre devient un
    # commentaire sur le MÊME ancrage — jamais deux modifications imbriquées.
    #
    # ⚠ Révision du 21.09.2026 bis, mesurée sur le corpus réel (chaîne complète, manuscrit
    # « coenseignement ») : à sévérité ÉGALE, l'ancien tri (index d'apparition croissant)
    # faisait systématiquement perdre `APA.MiseEnForme` — dont le span couvre TOUJOURS la
    # référence entière (§7 bis : `found` est tout le texte de l'entrée) — face à une règle
    # Vale bien plus étroite qui corrige la MÊME chose en passant (ici,
    # `CSPS-Biblio.APA.Esperluette`, « et » -> « & », sur 4 références du manuscrit réel).
    # Résultat mesuré AVANT ce correctif : toute la mise en forme APA proposée (italique,
    # séparateur anglais, DOI…) disparaissait en commentaire pour ne garder qu'un « et » -> « &
    # » isolé — la règle la plus étroite gagnait alors qu'elle ne fait QU'UNE PARTIE de ce que
    # fait la plus large. Le span le plus LARGE l'emporte désormais à sévérité égale (la
    # révision la plus large a beaucoup plus de chances d'englober ce que fait la plus étroite
    # que l'inverse) ; l'ordre d'apparition ne tranche plus qu'en tout dernier recours.
    rango_severidad = {'error': 0, 'warning': 1, 'suggestion': 2}
    for salida, lista_rev in list(revisiones_por_salida.items()):
        ordenada = sorted(
            lista_rev,
            key=lambda t: (rango_severidad.get(t[2].get('severity'), 3),
                            -(t[1][1] - t[1][0]), t[0]))
        spans_aceptados = []
        conservadas = []
        for idx, localizado, alerta in ordenada:
            s, e = localizado
            solapa = any(s < e2 and s2 < e for (s2, e2) in spans_aceptados)
            if solapa:
                candidatos_comentario.append((idx, alerta, salida, localizado))
            else:
                spans_aceptados.append((s, e))
                conservadas.append((localizado, alerta))
                devenir[idx] = 'revision'
        revisiones_por_salida[salida] = conservadas

    # 3. Plafond des commentaires (§7 ter, point 4) : tri error > warning > suggestion puis
    # ordre d'apparition, au plus 5 par règle (la 5e écrite porte la synthèse des suivantes),
    # puis le plafond global.
    candidatos_comentario.sort(key=lambda t: (rango_severidad.get(t[1].get('severity'), 3), t[0]))

    total_por_regla = {}
    for _idx, alerta, _s, _l in candidatos_comentario:
        r = alerta.get('rule')
        total_por_regla[r] = total_por_regla.get(r, 0) + 1

    vistos_regla = {}
    conservados = []
    for item in candidatos_comentario:
        regla = item[1].get('rule')
        n = vistos_regla.get(regla, 0)
        vistos_regla[regla] = n + 1
        if n < 5:
            conservados.append(item)
        else:
            stats['renvoyees_au_rapport'].append(item[1])
            _contar_regla(stats, item[1], 'renvoyees')
            devenir[item[0]] = 'rapport'

    escritos = conservados[:plafond_commentaires]
    for item in conservados[plafond_commentaires:]:
        stats['renvoyees_au_rapport'].append(item[1])
        _contar_regla(stats, item[1], 'renvoyees')
        devenir[item[0]] = 'rapport'

    conteo_escritos_regla = {}
    sintesis_para = set()
    for item in escritos:
        regla = item[1].get('rule')
        conteo_escritos_regla[regla] = conteo_escritos_regla.get(regla, 0) + 1
        if conteo_escritos_regla[regla] == 5 and total_por_regla.get(regla, 0) > 5:
            sintesis_para.add(id(item[1]))

    comentarios_por_salida = {}
    for idx, alerta, salida, localizado in escritos:
        comentarios_por_salida.setdefault(salida, []).append(
            (localizado, alerta, id(alerta) in sintesis_para))
        devenir[idx] = 'commentaire'

    # 4. Écriture, paragraphe par paragraphe, dans l'ordre DÉCROISSANT de position dans
    # `interior` — chaque remplacement ne touche que ce qui est à sa droite pour les
    # remplacements déjà faits, jamais les offsets (encore valides) des paragraphes restants.
    comments_nuevos = []
    salidas_a_tratar = sorted(set(revisiones_por_salida) | set(comentarios_por_salida),
                               key=lambda s: indices_p[s][0], reverse=True)
    for salida in salidas_a_tratar:
        debut_p, fin_p = indices_p[salida]
        p_xml = interior[debut_p:fin_p]
        nuevo_p_xml = _anotar_parrafo(
            p_xml, revisiones_por_salida.get(salida, []), comentarios_por_salida.get(salida, []),
            contador, auteur, fecha, iniciales, style_comentario, langue, stats,
            total_por_regla, comments_nuevos)
        interior = interior[:debut_p] + nuevo_p_xml + interior[fin_p:]

    contenidos['word/document.xml'] = (prefijo_doc + interior + sufijo_doc).encode('utf-8')

    if comments_nuevos:
        if comments_previos_xml is not None:
            comments_xml_final = comments_previos_xml.replace(
                '</w:comments>', ''.join(comments_nuevos) + '</w:comments>')
        else:
            comments_xml_final = _COMMENTS_XML_DEBUT + ''.join(comments_nuevos) + '</w:comments>'
        contenidos['word/comments.xml'] = comments_xml_final.encode('utf-8')

        if comments_previos_xml is None:
            rid_existentes = [int(m) for m in re.findall(r'Id="rId(\d+)"', rels_xml)]
            rid_nuevo = 'rId%d' % (max(rid_existentes, default=0) + 1)
            rels_xml = rels_xml.replace(
                '</Relationships>',
                '<Relationship Id="%s" Type="%s" Target="comments.xml"/></Relationships>'
                % (rid_nuevo, REL_COMMENTS))
            contenidos['word/_rels/document.xml.rels'] = rels_xml.encode('utf-8')
            if '/word/comments.xml' not in ct_xml:
                ct_xml = ct_xml.replace(
                    '</Types>',
                    '<Override PartName="/word/comments.xml" ContentType='
                    '"application/vnd.openxmlformats-officedocument.wordprocessingml.'
                    'comments+xml"/></Types>')
                contenidos['[Content_Types].xml'] = ct_xml.encode('utf-8')

    # Contrôle systématique AVANT écriture (§7 ter, révision du 21.09.2026, défaut n°3) :
    # aucune partie XML/rels de la sortie ne part sur disque sans avoir été reparsée — un
    # module qui rendrait un XML mal formé doit lever une exception EXPLICITE ici, jamais
    # laisser un .docx corrompu sortir avec un code de succès. Toutes les parties (pas
    # seulement celles que ce module vient de modifier) : un défaut mesuré une fois ne suffit
    # pas à garantir qu'il n'y en a pas d'autre.
    for nombre, datos in contenidos.items():
        if nombre.endswith('.xml') or nombre.endswith('.rels'):
            try:
                ET.fromstring(datos)
            except ET.ParseError as e:
                raise ValueError(
                    "manuscrit_annoter.annoter() a produit une partie XML mal formee (%s) : "
                    "%s -- annotation refusee, rien n'est ecrit sur %s"
                    % (nombre, e, chemin_docx_sortie))

    dossier = os.path.dirname(os.path.abspath(chemin_docx_sortie)) or '.'
    if not os.path.isdir(dossier):
        os.makedirs(dossier)
    fd, tmp_path = tempfile.mkstemp(dir=dossier, suffix='.docx.tmp')
    os.close(fd)
    try:
        with zipfile.ZipFile(tmp_path, 'w', zipfile.ZIP_DEFLATED) as zout:
            for nombre, datos in contenidos.items():
                zout.writestr(nombre, datos)
        os.replace(tmp_path, chemin_docx_sortie)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise

    return stats


# ---------------------------------------------------------------------------------
# CLI d'essai (§7 ter, point 8) — analyse manuelle, comme tous les CLI de pipeline/ (aucun
# n'utilise argparse). Un seul chemin .docx : annote EN PLACE (lecture puis remplacement
# atomique, voir annoter()) le fichier déjà au gabarit qu'on lui donne — typiquement une
# sortie de manuscrit-nettoyer.py. --alertes/--correspondance acceptent soit le tableau/la
# liste bruts, soit le rapport JSON complet du nettoyeur (alertes.liste /
# decisions.ecriture.correspondance), pour pouvoir passer le MÊME fichier aux deux options.

USAGE = ('usage : manuscrit_annoter.py <sortie.docx> --alertes alertes.json '
         '--correspondance correspondance.json [--plafond 25] [--auteur "..."] '
         '[--langue fr|de]')


def _analizar_args(argv):
    args = {'docx': None, 'alertes': None, 'correspondance': None, 'plafond': 25,
            'auteur': 'Relecture automatique', 'langue': 'fr'}
    positionnels = []
    reste = argv[1:]
    i = 0
    while i < len(reste):
        a = reste[i]
        if a == '--alertes' and i + 1 < len(reste):
            i += 1
            args['alertes'] = reste[i]
        elif a == '--correspondance' and i + 1 < len(reste):
            i += 1
            args['correspondance'] = reste[i]
        elif a == '--plafond' and i + 1 < len(reste):
            i += 1
            args['plafond'] = int(reste[i])
        elif a == '--auteur' and i + 1 < len(reste):
            i += 1
            args['auteur'] = reste[i]
        elif a == '--langue' and i + 1 < len(reste):
            i += 1
            args['langue'] = reste[i]
        else:
            positionnels.append(a)
        i += 1
    if positionnels:
        args['docx'] = positionnels[0]
    return args


def _extraire(chemin, cle_imbriquee):
    with open(chemin, encoding='utf-8') as f:
        donnees = json.load(f)
    if isinstance(donnees, dict):
        for etape in cle_imbriquee.split('.'):
            if isinstance(donnees, dict) and etape in donnees:
                donnees = donnees[etape]
    return donnees


def principal(argv):
    args = _analizar_args(argv)
    if not args['docx'] or not args['alertes'] or not args['correspondance']:
        print(USAGE, file=sys.stderr)
        return 2
    alertes = _extraire(args['alertes'], 'alertes.liste')
    correspondance = _extraire(args['correspondance'], 'decisions.ecriture.correspondance')
    stats = annoter(args['docx'], args['docx'], alertes, correspondance, langue=args['langue'],
                     auteur=args['auteur'], plafond_commentaires=args['plafond'])
    print(json.dumps(stats, ensure_ascii=True))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
