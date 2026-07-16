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


def html_du_tableau(tbl):
    """Rend un w:tbl en <table>, fusions préservées."""
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

    def rowspan_depuis(index_ligne, colonne):
        n = 1
        for suite in grille[index_ligne + 1:]:
            if any(c['col'] == colonne and c['vmerge'] == 'continue' for c in suite):
                n += 1
            else:
                break
        return n

    sortie = ['<table>']
    for i, (tr, cellules) in enumerate(zip(lignes, grille)):
        trpr = tr.find(W + 'trPr')
        entete = trpr is not None and trpr.find(W + 'tblHeader') is not None
        balise = 'th' if entete else 'td'
        sortie.append('<tr>')
        for c in cellules:
            if c['vmerge'] == 'continue':
                continue                      # absorbée par le rowspan au-dessus
            attributs = ''
            if c['colspan'] > 1:
                attributs += ' colspan="%d"' % c['colspan']
            if c['vmerge'] == 'restart':
                n = rowspan_depuis(i, c['col'])
                if n > 1:
                    attributs += ' rowspan="%d"' % n
            sortie.append('<%s%s>%s</%s>' % (balise, attributs, html_de_cellule(c['tc']), balise))
        sortie.append('</tr>')
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
