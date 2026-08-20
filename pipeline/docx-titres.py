#!/usr/bin/env python3
# docx-titres.py — pré-pass d'import : déduction conservatrice des titres d'un .docx qui
# n'utilise pas, ou pas partout, les styles de titre de Word.
#
#   python3 docx-titres.py <fichier.docx> <fichier-sortie>
#
# pandoc perd la taille de police (w:sz) : ce pré-pass lit word/document.xml (stdlib
# seule) et écrit dans <fichier-sortie> une ligne « N<TAB>texte » par titre déduit
# (N = 1 ou 2). szh-titres.lua consomme ce fichier et promeut en Header(N) les
# paragraphes de premier niveau correspondants.
#
# Garde-fou : seuls les styles de section comptent (heading N, Überschrift N, Titre N,
# outlineLvl) — Title, Subtitle, Author et Abstract sont des métadonnées, prises par
# docx-meta.py. Styles de section absents -> déduction complète. Styles présents ->
# pandoc les garde, et on ne déduit en plus que si le document est nettement « à moitié
# stylé » : au plus MAX_STYLES_MIXTE titres stylés et au moins MIN_CANDIDATS_MIXTE
# candidats heuristiques nets. Dans le doute, rien — un faux titre est pire qu'un titre
# manqué. Les titres déduits en mode mixte sont tous de niveau 2, la hiérarchie
# appartenant aux styles.
#
# Un paragraphe (enfant direct de w:body, hors tableau) est un titre présumé si tout est
# vrai : texte non vide et court (MAX_MOTS mots au plus), pas de puce en tête, pas de
# ponctuation de phrase à la fin, pas dans une liste (w:numPr), pas stylé
# section/méta/légende/bibliographie, pas déjà consommé par docx-meta.py (lignes P/B/F de
# $SZH_META), et (tous ses runs de texte en gras w:b) ou (police >= SEUIL_TAILLE x la
# taille dominante du corps).
# Niveau : la plus grande taille de titre -> 1 (#), le reste -> 2 (##).

import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

MAX_MOTS = 12          # au-delà, ce n'est pas un titre
SEUIL_TAILLE = 1.2     # « nettement plus grand » = +20 %
MAX_STYLES_MIXTE = 2   # « à moitié stylé » : au plus 2 titres stylés…
MIN_CANDIDATS_MIXTE = 3  # … et au moins 3 candidats heuristiques nets
PONCT_PHRASE = '.;:!?…'
PUCES = '•▪◦-–—'

# Une légende (« Figure 1 : … », « Tableau 2 — … ») n'est pas un titre : elle est traitée
# par szh-legendes.lua. L'exclure évite de la promouvoir par erreur.
RE_LEGENDE = re.compile(
    r'^(?:figure|fig\.?|abbildung|abb\.?|illustration|grafik|tableau|tabelle|table)\s+\d+',
    re.I)


def actif(prop):
    if prop is None:
        return False
    return prop.get(W + 'val') not in ('false', '0', 'none')


def normaliser(t):
    """Espaces spéciaux -> espace, tirets spéciaux -> '-', espaces compactés, rogné. À
    garder identique à la normalisation Lua de szh-titres.lua, sinon l'appariement
    échoue."""
    for a, b in ((' ', ' '), (' ', ' '), (' ', ' '),
                 ('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


def runs_texte(p):
    """Runs (w:r) porteurs de texte d'un paragraphe direct ; un w:p ne contient jamais de
    tableau imbriqué."""
    for r in p.iter(W + 'r'):
        if any(e.tag == W + 't' and (e.text or '') for e in r):
            yield r


def texte_paragraphe(p):
    morceaux = []
    for r in p.iter(W + 'r'):
        for e in r:
            if e.tag == W + 't':
                morceaux.append(e.text or '')
            elif e.tag == W + 'tab':
                morceaux.append(' ')
    return ''.join(morceaux)


def taille_run(r):
    rpr = r.find(W + 'rPr')
    if rpr is None:
        return None
    sz = rpr.find(W + 'sz')
    if sz is None:
        return None
    try:
        return int(sz.get(W + 'val'))
    except (TypeError, ValueError):
        return None


def run_gras(r):
    rpr = r.find(W + 'rPr')
    return rpr is not None and actif(rpr.find(W + 'b'))


def est_liste(p):
    ppr = p.find(W + 'pPr')
    return ppr is not None and ppr.find(W + 'numPr') is not None


# ---- classification des styles (styles.xml : id + nom localisé) -------------------

def charger_styles(z):
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


def familles_styles(styles):
    """(ids_section, ids_exclus) : d'un côté les styles de section (heading N,
    Überschrift N, Titre N) ; de l'autre ceux à ne jamais promouvoir — métadonnées
    (Title/Subtitle/Author/Abstract, prises par docx-meta.py et pandoc), légendes
    (Beschriftung/Caption), bibliographie, sommaire."""
    sections, exclus = set(), set()
    for sid, nom in styles.items():
        i = sid.lower()
        if re.match(r'^heading\s*\d', nom) or re.match(
                r'^(berschrift|heading|titre|titolo)\d', i):
            sections.add(sid)
        elif nom in ('title', 'subtitle', 'author', 'abstract', 'date', 'caption',
                     'bibliography') \
                or i in ('titel', 'titre', 'title', 'titolo', 'untertitel',
                         'sous-titre', 'soustitre', 'subtitle', 'sottotitolo',
                         'author', 'auteur', 'autor', 'abstract') \
                or i.startswith('literaturverzeichnis') \
                or 'beschriftung' in i or 'beschriftung' in nom \
                or 'légende' in nom or 'legende' in nom \
                or nom.startswith('toc ') or i.startswith('verzeichnis'):
            exclus.add(sid)
    return sections, exclus


def pstyle(p):
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return ''
    ps = ppr.find(W + 'pStyle')
    return ps.get(W + 'val') if ps is not None else ''


def a_outline(p):
    ppr = p.find(W + 'pPr')
    return ppr is not None and ppr.find(W + 'outlineLvl') is not None


def textes_consommes_par_meta():
    """Textes normalisés que docx-meta.py retire du corps (lignes P/B/F de $SZH_META) :
    jamais candidats, un bloc consommé ne pouvant pas devenir un titre."""
    chemin = os.getenv('SZH_META')
    if not chemin:
        return set()
    textes = set()
    try:
        with open(chemin, encoding='utf-8') as f:
            for ligne in f:
                if ligne[:2] in ('P\t', 'B\t', 'F\t'):
                    t = normaliser(ligne[2:].rstrip('\n'))
                    if t:
                        textes.add(t)
    except OSError:
        return set()
    return textes


def paragraphes_corps(racine):
    """w:p enfants DIRECTS de w:body (donc hors tableaux, hors zones imbriquées)."""
    body = racine.find(W + 'body')
    if body is None:
        return []
    return [e for e in body if e.tag == W + 'p']


def principal(argv):
    if len(argv) != 3:
        print('usage : docx-titres.py <fichier.docx> <fichier-sortie>', file=sys.stderr)
        return 2
    chemin_docx, sortie = argv[1], argv[2]
    try:
        with zipfile.ZipFile(chemin_docx) as z:
            racine = ET.fromstring(z.read('word/document.xml'))
            styles = charger_styles(z)
    except Exception as e:
        print('[docx-titres] lecture impossible de %s : %s' % (chemin_docx, e), file=sys.stderr)
        # Pas un échec bloquant : on écrit un fichier vide, l'import continue sans titres.
        open(sortie, 'w', encoding='utf-8', newline='\n').close()
        return 0

    paras = paragraphes_corps(racine)
    ids_section, ids_exclus = familles_styles(styles)
    consommes = textes_consommes_par_meta()

    def est_section(p):
        return pstyle(p) in ids_section or a_outline(p)

    # Titres de section déjà stylés (pandoc les convertira en Header lui-même).
    n_styles = sum(1 for p in paras if est_section(p))

    # Taille dominante du corps : mode des tailles de run (demi-points).
    freq = {}
    for p in paras:
        for r in runs_texte(p):
            t = taille_run(r)
            if t:
                freq[t] = freq.get(t, 0) + 1
    taille_corps = max(freq, key=freq.get) if freq else None

    candidats = []   # (texte_normalisé, taille_ou_None)
    for p in paras:
        if est_liste(p) or est_section(p) or pstyle(p) in ids_exclus:
            continue
        brut = texte_paragraphe(p)
        txt = normaliser(brut)
        if len(txt) < 2 or txt[0] in PUCES:
            continue
        if RE_LEGENDE.match(txt):
            continue                          # légende, pas un titre
        if txt in consommes:
            continue                          # bloc consommé par docx-meta.py
        if len(txt.split()) > MAX_MOTS:
            continue
        if txt[-1] in PONCT_PHRASE:
            continue
        runs = list(runs_texte(p))
        if not runs:
            continue
        tout_gras = all(run_gras(r) for r in runs)
        taille = max((taille_run(r) or 0) for r in runs) or None
        plus_grand = (taille is not None and taille_corps is not None
                      and taille >= taille_corps * SEUIL_TAILLE)
        if tout_gras or plus_grand:
            # taille EFFECTIVE : celle du run si titre « plus grand », sinon la taille
            # du corps (titre gras seul) -> classe au plus bas des paliers de titre.
            eff = taille if plus_grand else taille_corps
            candidats.append((txt, eff))

    # Garde-fou raffiné : document déjà (entièrement) structuré -> aucune déduction ;
    # document « à moitié stylé » -> déduction en complément, tout en niveau 2.
    if n_styles > 0:
        if n_styles <= MAX_STYLES_MIXTE and len(candidats) >= MIN_CANDIDATS_MIXTE:
            with open(sortie, 'w', encoding='utf-8', newline='\n') as f:
                for txt, _ in candidats:
                    f.write('2\t%s\n' % txt)
            print('[import] %d titre(s) déduit(s) EN COMPLÉMENT de %d titre(s) stylé(s)'
                  ' (document à moitié stylé)' % (len(candidats), n_styles))
        else:
            open(sortie, 'w', encoding='utf-8', newline='\n').close()
            print('[import] 0 titre déduit (document déjà structuré par styles : '
                  '%d stylé(s), %d candidat(s) heuristique(s) ignoré(s))'
                  % (n_styles, len(candidats)))
        return 0

    # Niveaux par paliers de taille effective : la plus grande -> 1 (#), le reste -> 2
    # (##). S'il n'existe qu'une taille de titre, aucune hiérarchie n'est décelable et
    # tout part en ## : un faux # est pire qu'un titre correctement rétrogradé.
    tailles = sorted({e for _, e in candidats if e is not None}, reverse=True)
    taille_h1 = tailles[0] if tailles else None
    h1_distinct = len(tailles) >= 2

    with open(sortie, 'w', encoding='utf-8', newline='\n') as f:
        for txt, eff in candidats:
            niveau = 1 if (h1_distinct and eff == taille_h1) else 2
            f.write('%d\t%s\n' % (niveau, txt))

    print('[import] %d titre(s) déduit(s)' % len(candidats))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
