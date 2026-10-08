#!/usr/bin/env python3
# Étape d'import : déduit, prudemment, les titres d'un .docx qui n'utilise pas (ou pas
# partout) les styles de titre de Word.
#
#   python3 docx-titres.py <fichier.docx> <fichier-sortie>
#
# pandoc perd la taille de police (w:sz). Ce script lit word/document.xml et écrit une
# ligne « N<TAB>texte » par titre déduit (N = 1 ou 2) ; szh-titres.lua en fait des
# Header(N).
#
# Seuls les styles de section comptent (heading N, Überschrift N, Titre N, outlineLvl) ;
# Title, Subtitle, Author et Abstract sont des métadonnées (docx-meta.py).
#   * aucun style de section : déduction complète ;
#   * styles présents : pandoc les garde, et on ne déduit en plus que si le document est
#     nettement « à moitié stylé » (au plus MAX_STYLES_MIXTE titres stylés, au moins
#     MIN_CANDIDATS_MIXTE candidats). Ces titres sont alors tous de niveau 2.
# Dans le doute, rien : un faux titre est pire qu'un titre manqué.
#
# Un paragraphe direct de w:body (hors tableau) est un titre présumé si : texte court
# (MAX_MOTS mots au plus), sans puce en tête ni ponctuation de phrase à la fin, hors liste
# (w:numPr), sans style de section, de métadonnée, de légende ou de bibliographie, non
# consommé par docx-meta.py (lignes P/B/F de $SZH_META), et entièrement en gras ou d'une
# taille >= SEUIL_TAILLE fois celle du corps.
# Niveau : la plus grande taille -> 1 (#), le reste -> 2 (##).

import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ooxml_lecture
from ooxml_lecture import W, charger_styles, pstyle
from heritage_meta import RE_LEGENDE

MAX_MOTS = 12
SEUIL_TAILLE = 1.2     # +20 %
MAX_STYLES_MIXTE = 2
MIN_CANDIDATS_MIXTE = 3
PONCT_PHRASE = '.;:!?…'
PUCES = '•▪◦-–—'


def actif(prop):
    if prop is None:
        return False
    return prop.get(W + 'val') not in ('false', '0', 'none')


def normaliser(t):
    """Espaces spéciales -> espace, tirets -> '-', espaces regroupées, bords rognés. À
    garder identique à la normalisation de szh-titres.lua."""
    for a, b in ((' ', ' '), (' ', ' '), (' ', ' '),
                 ('–', '-'), ('—', '-'), ('‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


def runs_texte(p):
    """Runs (w:r) qui portent du texte."""
    for r in p.iter(W + 'r'):
        if any(e.tag == W + 't' and (e.text or '') for e in r):
            yield r


def texte_paragraphe(p):
    """Texte du paragraphe tel que le lit pandoc (br et cr en espace, sym rendu), pour
    correspondre au Para que szh-titres.lua compare."""
    return ooxml_lecture.texte_paragraphe(p)


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

def familles_styles(styles):
    """(ids_section, ids_exclus) : les styles de section (heading N, Überschrift N,
    Titre N), et ceux qui ne deviennent jamais des titres : métadonnées
    (Title/Subtitle/Author/Abstract), légendes, bibliographie, sommaire."""
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


def a_outline(p):
    ppr = p.find(W + 'pPr')
    return ppr is not None and ppr.find(W + 'outlineLvl') is not None


def textes_consommes_par_meta():
    """Textes normalisés que docx-meta.py retire du corps (lignes P/B/F de $SZH_META), qui
    ne peuvent pas devenir des titres."""
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
    """w:p enfants directs de w:body (hors tableaux et zones imbriquées)."""
    return [e for e in ooxml_lecture.blocs_du_corps(racine) if e.tag == W + 'p']


def principal(argv):
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
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
        # Non bloquant : fichier vide, l'import continue sans titres déduits.
        open(sortie, 'w', encoding='utf-8', newline='\n').close()
        return 0

    paras = paragraphes_corps(racine)
    ids_section, ids_exclus = familles_styles(styles)
    consommes = textes_consommes_par_meta()

    def est_section(p):
        return pstyle(p) in ids_section or a_outline(p)

    # Titres déjà stylés (pandoc en fait des Header).
    n_styles = sum(1 for p in paras if est_section(p))

    # Taille du corps : la plus fréquente des tailles de run (demi-points).
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
            # Taille retenue : celle du run si le titre est plus grand, sinon celle du
            # corps (titre seulement gras), qui le classe au niveau le plus bas.
            eff = taille if plus_grand else taille_corps
            candidats.append((txt, eff))

    # Document structuré par styles : rien ; « à moitié stylé » : complément en niveau 2.
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

    # La plus grande taille -> 1 (#), le reste -> 2 (##). Avec une seule taille, pas de
    # hiérarchie visible : tout en ##.
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
