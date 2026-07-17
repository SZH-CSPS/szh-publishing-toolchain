#!/usr/bin/env python3
# docx-titres.py — pré-pass d'import (AX4/D63) : déduction CONSERVATRICE des titres
# d'un .docx qui N'UTILISE PAS les styles de titre de Word.
#
#   python3 docx-titres.py <fichier.docx> <fichier-sortie>
#
# pandoc perd la TAILLE de police (w:sz) : ce pré-pass lit word/document.xml (comme
# docx-tables.py, stdlib seule) et écrit dans <fichier-sortie> une ligne « N<TAB>texte »
# par titre déduit (N = niveau 1/2). Le filtre Lua szh-titres.lua consomme ce fichier
# et promeut les paragraphes de PREMIER NIVEAU correspondants en Header(N).
#
# GARDE-FOU : si le document contient DÉJÀ des paragraphes en style de titre (Heading,
# Titre, Überschrift, outlineLvl), l'auteur a structuré son texte -> AUCUNE déduction
# (fichier vide). Un faux titre est pire qu'un titre manqué.
#
# Un paragraphe (direct de w:body, hors tableau) est un titre PRÉSUMÉ si TOUT est vrai :
#   - texte non vide, court (<= MAX_MOTS mots), pas de puce en tête ;
#   - ne se termine pas par une ponctuation de phrase (. ; : ! ? …) ;
#   - pas dans une liste (w:numPr) ni en style de titre ;
#   - ET (tous ses runs de texte en gras w:b) OU (police nettement plus grande que le
#     corps : >= SEUIL_TAILLE x la taille dominante du corps).
# Niveau : plus grande taille de titre -> 1 (#), le reste -> 2 (##).

import sys
import zipfile
import xml.etree.ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

MAX_MOTS = 12          # au-delà, ce n'est pas un titre (à valider par Robin)
SEUIL_TAILLE = 1.2     # « nettement plus grand » = +20 % (à valider par Robin)
PONCT_PHRASE = '.;:!?…'
PUCES = '•▪◦-–—'


def actif(prop):
    if prop is None:
        return False
    return prop.get(W + 'val') not in ('false', '0', 'none')


def normaliser(t):
    """Espaces spéciaux -> espace, tirets spéciaux -> '-', espaces compactés, rogné.
    DOIT rester identique à la normalisation Lua (szh-titres.lua) pour l'appariement."""
    for a, b in ((' ', ' '), (' ', ' '), (' ', ' '),
                 ('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


def runs_texte(p):
    """Runs (w:r) porteurs de texte d'un paragraphe (paragraphe direct, jamais un
    tableau imbriqué — un w:p n'en contient pas)."""
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


def style_titre(p):
    """Le paragraphe porte-t-il un style de titre (Heading/Titre/Überschrift) ou un
    niveau de plan (outlineLvl) ?"""
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return False
    if ppr.find(W + 'outlineLvl') is not None:
        return True
    ps = ppr.find(W + 'pStyle')
    if ps is None:
        return False
    val = (ps.get(W + 'val') or '').lower()
    return (val.startswith('heading') or val.startswith('titre')
            or val.startswith('title') or 'berschrift' in val or val.startswith('titolo'))


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
    except Exception as e:
        print('[docx-titres] lecture impossible de %s : %s' % (chemin_docx, e), file=sys.stderr)
        # Pas un échec bloquant : on écrit un fichier vide, l'import continue sans titres.
        open(sortie, 'w', encoding='utf-8', newline='\n').close()
        return 0

    paras = paragraphes_corps(racine)

    # Garde-fou : document déjà structuré (styles de titre) -> aucune déduction.
    if any(style_titre(p) for p in paras):
        open(sortie, 'w', encoding='utf-8', newline='\n').close()
        print('[import] 0 titre déduit (document déjà structuré par styles)')
        return 0

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
        if est_liste(p) or style_titre(p):
            continue
        brut = texte_paragraphe(p)
        txt = normaliser(brut)
        if len(txt) < 2 or txt[0] in PUCES:
            continue
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

    # Niveaux par PALIERS de taille effective : la plus GRANDE -> 1 (#), le reste -> 2
    # (##). S'il n'existe qu'UNE taille de titre (aucune hiérarchie décelable), tout en
    # ## : un faux # est pire qu'un titre correctement rétrogradé.
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
