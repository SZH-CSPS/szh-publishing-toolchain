#!/usr/bin/env python3
# docx-tables.py — extraction FIDÈLE des tableaux d'un .docx en HTML (D50).
#
#   python3 docx-tables.py <fichier.docx> <dossier-sortie>
#
# Pour chaque tableau DE PREMIER NIVEAU (ordre du document), écrit
# <dossier-sortie>/table-NN.html (NN sur 2 chiffres). Contrairement au passage
# par pandoc (D33 : fusions dépliées), les fusions sont PRÉSERVÉES :
#   - w:gridSpan  -> colspan
#   - w:vMerge    -> rowspan (val="restart" = départ ; continue = absorbée)
# Contenu de cellule : paragraphes séparés par <br>, gras w:b -> <strong>,
# italique w:i -> <em>, texte échappé HTML. Tableau imbriqué dans une cellule :
# rendu récursivement DANS la cellule (il ne compte pas comme tableau séparé —
# aligné sur le filtre Lua de référence, qui ne descend pas dans les tableaux).
#
# En-têtes accessibles (AX2, WCAG H43) — MÊME style que l'éditeur (serialiserTable) :
#   - rangées d'en-tête déterminées par w:tblHeader (rangées de tête répétées de Word) ;
#   - à défaut, HEURISTIQUE : si la 1ʳᵉ rangée est ENTIÈREMENT en gras (tous ses runs
#     porteurs de texte en w:b) -> en-tête ; sinon, aucun en-tête (statu quo, <table> plat).
#   Tableau SIMPLE (1 rangée d'en-tête, sans cellule d'en-tête fusionnée) -> <thead> +
#   <th scope="col">. Tableau COMPLEXE (>= 2 rangées d'en-tête OU en-tête fusionné) ->
#   <thead> + id sur chaque en-tête + scope="col"/"colgroup" + headers="…" sur chaque
#   cellule de données (ids des en-têtes de colonne qui la couvrent, tous niveaux).
#
# stdlib UNIQUEMENT (zipfile, xml.etree) — aucun pip. Docx sans tableau :
# n'écrit rien, sort 0. La numérotation suit l'ordre du document : elle doit
# rester alignée avec szh-tabelle-reference.lua (RM2).

import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from html import escape

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'


def actif(prop):
    """Un booléen OOXML (w:b, w:i…) est actif sauf w:val false/0/none."""
    if prop is None:
        return False
    val = prop.get(W + 'val')
    return val not in ('false', '0', 'none')


def texte_du_run(run):
    """Texte d'un w:r, avec gras/italique, sauts <br>, texte échappé."""
    morceaux = []
    for enfant in run:
        if enfant.tag == W + 't':
            morceaux.append(escape(enfant.text or ''))
        elif enfant.tag == W + 'br' or enfant.tag == W + 'cr':
            morceaux.append('<br>')
        elif enfant.tag == W + 'tab':
            morceaux.append(' ')
    texte = ''.join(morceaux)
    if not texte:
        return ''
    rpr = run.find(W + 'rPr')
    if rpr is not None:
        if actif(rpr.find(W + 'i')):
            texte = '<em>' + texte + '</em>'
        if actif(rpr.find(W + 'b')):
            texte = '<strong>' + texte + '</strong>'
    return texte


def html_du_paragraphe(par):
    return ''.join(texte_du_run(r) for r in par.iter(W + 'r'))


def html_de_cellule(tc):
    """Paragraphes joints par <br> ; tableaux imbriqués rendus récursivement."""
    blocs = []
    for enfant in tc:
        if enfant.tag == W + 'p':
            blocs.append(html_du_paragraphe(enfant))
        elif enfant.tag == W + 'tbl':
            blocs.append(html_du_tableau(enfant))
    # Pas de <br> superflu autour d'un tableau imbriqué ; paragraphes vides
    # de fin ignorés (Word en ajoute souvent un après un tableau imbriqué).
    while blocs and blocs[-1] == '':
        blocs.pop()
    return '<br>'.join(blocs)


def infos_cellule(tc):
    """(colspan, vmerge) où vmerge ∈ {None, 'restart', 'continue'}."""
    colspan = 1
    vmerge = None
    tcpr = tc.find(W + 'tcPr')
    if tcpr is not None:
        gs = tcpr.find(W + 'gridSpan')
        if gs is not None:
            try:
                colspan = max(1, int(gs.get(W + 'val', '1')))
            except ValueError:
                colspan = 1
        vm = tcpr.find(W + 'vMerge')
        if vm is not None:
            vmerge = 'restart' if vm.get(W + 'val') == 'restart' else 'continue'
    return colspan, vmerge


def _runs_directs(tc):
    """Runs (w:r) des paragraphes DIRECTS de la cellule — sans descendre dans un
    tableau imbriqué (dont les runs ne caractérisent pas la cellule parente)."""
    for enfant in tc:
        if enfant.tag == W + 'p':
            for run in enfant.iter(W + 'r'):
                yield run


def _run_texte(run):
    return any(e.tag == W + 't' and (e.text or '') for e in run)


def _run_gras(run):
    rpr = run.find(W + 'rPr')
    return rpr is not None and actif(rpr.find(W + 'b'))


def ligne_toute_gras(cellules):
    """Vrai si TOUS les runs porteurs de texte de la ligne sont en gras (w:b), avec
    au moins un run de texte. Heuristique d'en-tête quand Word n'a pas de w:tblHeader."""
    vu_texte = False
    for c in cellules:
        for run in _runs_directs(c['tc']):
            if _run_texte(run):
                vu_texte = True
                if not _run_gras(run):
                    return False
    return vu_texte


def ligne_a_tblheader(tr):
    trpr = tr.find(W + 'trPr')
    return trpr is not None and trpr.find(W + 'tblHeader') is not None


# ---- Légendes de tableau (AX5) : un paragraphe VOISIN tout en gras = légende. ----
# Elle est bakée en <caption> dans le HTML extrait (numéro manuel retiré : la
# numérotation « Tableau N — » est automatique en CSS, D31) ; son texte normalisé
# est consigné pour que szh-legendes.lua retire le paragraphe gras du .md.

RE_NUM_TABLE = re.compile(
    r'^(?:tableau|tabelle|table)\s+\d+[a-z]?\s*[:.–—‑-]?\s*', re.I)


def normaliser(t):
    """Espaces spéciaux -> espace, tirets spéciaux -> '-', compacté, rogné.
    DOIT rester identique à la normalisation Lua (szh-legendes.lua)."""
    for a, b in ((u' ', ' '), (u' ', ' '), (u' ', ' '),
                 (u'–', '-'), (u'—', '-'), (u'‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


def texte_plat(p):
    """Texte brut d'un paragraphe (sans balisage), tabulations -> espace."""
    morceaux = []
    for r in p.iter(W + 'r'):
        for e in r:
            if e.tag == W + 't':
                morceaux.append(e.text or '')
            elif e.tag == W + 'tab':
                morceaux.append(' ')
    return ''.join(morceaux)


def paragraphe_tout_gras(p):
    """Vrai si tous les runs porteurs de texte du paragraphe (w:p) sont en gras.
    ⚠ prend un PARAGRAPHE (ses propres runs), pas une cellule comme _runs_directs."""
    vu = False
    for run in p.iter(W + 'r'):
        if _run_texte(run):
            vu = True
            if not _run_gras(run):
                return False
    return vu


def html_du_tableau(tbl, caption=None):
    """Rend un w:tbl en <table>, fusions préservées + en-têtes accessibles (AX2)."""
    lignes = [tr for tr in tbl if tr.tag == W + 'tr']
    # Pré-analyse : pour chaque ligne, cellules avec (colonne de départ, colspan,
    # vmerge, élément). Les cellules « continue » occupent leur colonne (elles
    # sont bien présentes dans le XML), ce qui rend le calcul de colonne direct.
    grille = []
    for tr in lignes:
        colonne = 0
        cellules = []
        for tc in tr:
            if tc.tag != W + 'tc':
                continue
            colspan, vmerge = infos_cellule(tc)
            cellules.append({'col': colonne, 'colspan': colspan, 'vmerge': vmerge, 'tc': tc})
            colonne += colspan
        grille.append(cellules)

    nb_lignes = len(grille)
    ncols = max((sum(c['colspan'] for c in cs) for cs in grille), default=0)

    def rowspan_depuis(index_ligne, colonne):
        n = 1
        for suite in grille[index_ligne + 1:]:
            if any(c['col'] == colonne and c['vmerge'] == 'continue' for c in suite):
                n += 1
            else:
                break
        return n

    # ---- Rangées d'en-tête : w:tblHeader (rangées de tête, contiguës) sinon 1ʳᵉ
    #      rangée toute en gras. Zéro -> tableau plat, aucun en-tête (statu quo).
    if any(ligne_a_tblheader(tr) for tr in lignes):
        lignes_entete = 0
        for tr in lignes:
            if ligne_a_tblheader(tr):
                lignes_entete += 1
            else:
                break
    elif grille and ligne_toute_gras(grille[0]):
        lignes_entete = 1
    else:
        lignes_entete = 0

    # ---- Matrice d'occupation : origine[r][c] = (rangée, colonne) de la cellule qui
    #      couvre la case visuelle (r,c) — pour les headers="…" des cellules de données.
    origine = [[None] * ncols for _ in range(nb_lignes)]
    for i, cellules in enumerate(grille):
        for c in cellules:
            if c['vmerge'] == 'continue':
                continue
            rs = rowspan_depuis(i, c['col'])
            for dr in range(rs):
                for dc in range(c['colspan']):
                    rr, cc = i + dr, c['col'] + dc
                    if rr < nb_lignes and cc < ncols and origine[rr][cc] is None:
                        origine[rr][cc] = (i, c['col'])

    # ---- Complexité (D68/AX1) : >= 2 rangées d'en-tête OU un en-tête fusionné.
    complexe = lignes_entete >= 2
    for i in range(lignes_entete):
        if complexe:
            break
        for c in grille[i]:
            if c['vmerge'] == 'continue':
                continue
            if c['colspan'] > 1 or rowspan_depuis(i, c['col']) > 1:
                complexe = True
                break

    def id_th(orow, ocol):
        return 'szh-th-r%dc%d' % (orow, ocol)

    def headers_de(col, colspan):
        """ids des en-têtes de colonne couvrant les colonnes col..col+colspan (tous
        les niveaux d'en-tête, de haut en bas), sans doublon."""
        ids, vus = [], set()
        for hr in range(lignes_entete):
            for cc in range(col, col + colspan):
                o = origine[hr][cc] if cc < ncols else None
                if o is None:
                    continue
                hid = id_th(*o)
                if hid not in vus:
                    vus.add(hid)
                    ids.append(hid)
        return ' '.join(ids)

    def rendre_ligne(i, cellules, entete):
        out = ['<tr>']
        for c in cellules:
            if c['vmerge'] == 'continue':
                continue                      # absorbée par le rowspan au-dessus
            col, colspan = c['col'], c['colspan']
            attributs = ''
            if entete:
                if complexe:
                    sc = 'colgroup' if colspan > 1 else 'col'
                    attributs += ' id="%s" scope="%s"' % (id_th(i, col), sc)
                else:
                    attributs += ' scope="col"'
            elif complexe:
                ids = headers_de(col, colspan)
                if ids:
                    attributs += ' headers="%s"' % ids
            if colspan > 1:
                attributs += ' colspan="%d"' % colspan
            n = rowspan_depuis(i, col)
            if n > 1:
                attributs += ' rowspan="%d"' % n
            balise = 'th' if entete else 'td'
            out.append('<%s%s>%s</%s>' % (balise, attributs, html_de_cellule(c['tc']), balise))
        out.append('</tr>')
        return out

    sortie = ['<table>']
    if caption:
        sortie.append('<caption>%s</caption>' % escape(caption))
    if lignes_entete > 0:
        sortie.append('<thead>')
        for i in range(lignes_entete):
            sortie += rendre_ligne(i, grille[i], True)
        sortie.append('</thead>')
        sortie.append('<tbody>')
        for i in range(lignes_entete, nb_lignes):
            sortie += rendre_ligne(i, grille[i], False)
        sortie.append('</tbody>')
    else:
        # Aucun en-tête déduit : structure plate, cellules de données (statu quo).
        for i in range(nb_lignes):
            sortie += rendre_ligne(i, grille[i], False)
    sortie.append('</table>')
    return '\n'.join(sortie)


def tableaux_de_premier_niveau(racine):
    """Tous les w:tbl du document SAUF ceux imbriqués dans un autre w:tbl, dans
    l'ordre du document, chacun avec son PARENT (pour repérer la légende voisine).
    Le parcours ne descend pas dans les tableaux (les imbriqués sont rendus dedans)."""
    resultats = []

    def parcourir(element):
        for enfant in element:
            if enfant.tag == W + 'tbl':
                resultats.append((enfant, element))
            else:
                parcourir(enfant)

    parcourir(racine)
    return resultats


def legende_de_table(parent, tbl, consommes):
    """Cherche un paragraphe VOISIN (avant, puis après) tout en gras = légende.
    Retourne (element_paragraphe, texte_pour_caption_nettoye) ou (None, None).
    `consommes` = ids déjà pris (évite qu'un même paragraphe serve 2 tableaux)."""
    enfants = list(parent)
    try:
        i = enfants.index(tbl)
    except ValueError:
        return None, None
    for j in (i - 1, i + 1):
        if 0 <= j < len(enfants):
            e = enfants[j]
            if e.tag == W + 'p' and id(e) not in consommes and paragraphe_tout_gras(e):
                brut = normaliser(texte_plat(e))
                if brut:
                    consommes.add(id(e))
                    return e, RE_NUM_TABLE.sub('', brut, count=1).strip()
    return None, None


def principal(argv):
    if len(argv) != 3:
        print('usage : docx-tables.py <fichier.docx> <dossier-sortie>', file=sys.stderr)
        return 2
    chemin_docx, dossier = argv[1], argv[2]
    try:
        with zipfile.ZipFile(chemin_docx) as z:
            racine = ET.fromstring(z.read('word/document.xml'))
    except Exception as e:
        print('[docx-tables] lecture impossible de %s : %s' % (chemin_docx, e), file=sys.stderr)
        return 1
    tableaux = tableaux_de_premier_niveau(racine)
    if not tableaux:
        return 0                              # rien à faire, rien d'écrit
    os.makedirs(dossier, exist_ok=True)
    consommes = set()
    legendes = []                             # textes normalisés des légendes prises
    for n, (tbl, parent) in enumerate(tableaux, start=1):
        el, caption = legende_de_table(parent, tbl, consommes)
        if el is not None and caption:
            legendes.append(normaliser(texte_plat(el)))
        else:
            caption = None
        chemin = os.path.join(dossier, 'table-%02d.html' % n)
        with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html_du_tableau(tbl, caption) + '\n')
    # Sidecar : légendes consommées -> szh-legendes.lua retire les paragraphes gras
    # correspondants du .md (le <caption> est déjà baké ci-dessus).
    chemin_leg = os.getenv('SZH_LEGENDES_TABLES')
    if chemin_leg and legendes:
        with open(chemin_leg, 'w', encoding='utf-8', newline='\n') as f:
            for t in legendes:
                f.write(t + '\n')
    print('[docx-tables] %d tableau(x) extrait(s), %d légendé(s)'
          % (len(tableaux), len(legendes)))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
