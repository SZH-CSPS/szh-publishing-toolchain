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


def html_du_tableau(tbl):
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
    """Tous les w:tbl du document SAUF ceux imbriqués dans un autre w:tbl,
    dans l'ordre du document (parcours en profondeur qui ne descend pas
    dans les tableaux)."""
    resultats = []

    def parcourir(element):
        for enfant in element:
            if enfant.tag == W + 'tbl':
                resultats.append(enfant)      # ne pas descendre : imbriqués rendus dedans
            else:
                parcourir(enfant)

    parcourir(racine)
    return resultats


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
    import os
    os.makedirs(dossier, exist_ok=True)
    for n, tbl in enumerate(tableaux, start=1):
        chemin = os.path.join(dossier, 'table-%02d.html' % n)
        with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html_du_tableau(tbl) + '\n')
    print('[docx-tables] %d tableau(x) extrait(s)' % len(tableaux))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
