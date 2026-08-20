#!/usr/bin/env python3
# docx-tables.py — extrait fidèlement les tableaux d'un .docx en HTML.
#
#   python3 docx-tables.py <fichier.docx> <dossier-sortie>
#
# Écrit <dossier-sortie>/table-NN.html pour chaque tableau de premier niveau, dans l'ordre
# du document. Contrairement au passage par pandoc, qui déplie les fusions, elles sont
# préservées : w:gridSpan -> colspan, w:vMerge -> rowspan. Contenu de cellule :
# paragraphes séparés par <br>, w:b -> <strong>, w:i -> <em>, texte échappé. Un tableau
# imbriqué est rendu dans sa cellule et ne compte pas comme tableau séparé, comme côté Lua.
#
# En-têtes accessibles (WCAG H43), dans le même style que l'éditeur du cockpit : les
# rangées d'en-tête viennent de w:tblHeader ; à défaut, la 1ʳᵉ rangée sert d'en-tête si elle
# est entièrement en gras ; sinon <table> plat. Tableau simple -> <thead> +
# <th scope="col"> ; tableau complexe (au moins deux rangées d'en-tête, ou un en-tête
# fusionné) -> id sur chaque en-tête, scope="col"/"colgroup" et headers="…" sur chaque
# cellule de données.
#
# Les tableaux consommés par docx-meta.py (lignes « T<TAB>k » de $SZH_META : le tableau des
# auteurs) sont sautés ici et les autres numérotés séquentiellement. La numérotation doit
# rester alignée sur szh-tabelle-reference.lua, ce qui tient parce que szh-meta.lua retire
# les mêmes blocs Table avant que le filtre ne compte les siens.
#
# Légendes : un paragraphe voisin est une légende s'il est tout en gras, s'il est stylé
# « légende » (Tabelle Beschriftung, Caption… — style invisible pour pandoc, lu ici dans
# styles.xml), ou s'il commence par « Tableau N » avec un séparateur, exigé pour ne pas
# prendre « Tableau 3 présente… » pour une légende.
#
# stdlib uniquement (zipfile, xml.etree). Docx sans tableau : n'écrit rien, sort 0.

import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from html import escape

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
A = '{http://schemas.openxmlformats.org/drawingml/2006/main}'
WP = '{http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing}'
R = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}'

# Images dans les cellules, rendues en <img src="media/…"> : pandoc extrait tous les
# médias du docx sous media/ en gardant leurs noms, et la table HTML, quoique rangée dans
# tables/, est réinjectée depuis le dossier de l'article — le chemin relatif media/… est
# donc le bon. Sans ce rendu, une photo placée dans un tableau disparaissait
# silencieusement.
RELS_IMAGES = {}                              # rId -> media/imageN.ext


def charger_rels(z):
    """word/_rels/document.xml.rels : rId -> cible media/ (basename conservé)."""
    rels = {}
    try:
        racine = ET.fromstring(z.read('word/_rels/document.xml.rels'))
    except Exception:
        return rels
    ns = '{http://schemas.openxmlformats.org/package/2006/relationships}'
    for rel in racine.iter(ns + 'Relationship'):
        cible = rel.get('Target') or ''
        if 'media/' in cible.replace('\\', '/'):
            rels[rel.get('Id')] = 'media/' + os.path.basename(cible.replace('\\', '/'))
    return rels


def html_du_drawing(drawing):
    """<img> d'un w:drawing : src via les rels, alt du wp:docPr (@descr), largeur
    wp:extent (EMU -> px, 9525 EMU/px) pour garder la mise en page. Dessin sans image
    (formes, graphiques) : rien, pandoc les perd aussi."""
    blip = drawing.find('.//' + A + 'blip')
    if blip is None:
        return ''
    src = RELS_IMAGES.get(blip.get(R + 'embed') or '')
    if not src:
        return ''
    alt = ''
    doc_pr = drawing.find('.//' + WP + 'docPr')
    if doc_pr is not None:
        alt = doc_pr.get('descr') or ''
    largeur = ''
    extent = drawing.find('.//' + WP + 'extent')
    if extent is not None:
        try:
            px = int(extent.get('cx', '0')) // 9525
            if px > 0:
                largeur = ' width="%d"' % px
        except (TypeError, ValueError):
            pass
    return '<img src="%s" alt="%s"%s>' % (escape(src), escape(alt), largeur)


def actif(prop):
    """Un booléen OOXML (w:b, w:i…) est actif sauf w:val false/0/none."""
    if prop is None:
        return False
    val = prop.get(W + 'val')
    return val not in ('false', '0', 'none')


def texte_du_run(run):
    """Texte d'un w:r, avec gras/italique, sauts <br>, images <img>, texte échappé."""
    morceaux = []
    for enfant in run:
        if enfant.tag == W + 't':
            morceaux.append(escape(enfant.text or ''))
        elif enfant.tag == W + 'br' or enfant.tag == W + 'cr':
            morceaux.append('<br>')
        elif enfant.tag == W + 'tab':
            morceaux.append(' ')
        elif enfant.tag == W + 'drawing':
            morceaux.append(html_du_drawing(enfant))
    texte = ''.join(morceaux)
    if not texte:
        return ''
    if texte.startswith('<img') and texte.count('<') == 1:
        return texte                          # image seule : pas de gras/italique autour
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
    """Vrai si tous les runs porteurs de texte de la ligne sont en gras (w:b), avec au
    moins un run de texte. Heuristique d'en-tête quand Word n'a pas de w:tblHeader."""
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


# ---- Légendes de tableau : un paragraphe voisin tout en gras est une légende. ----
# Elle est bakée en <caption> dans le HTML extrait, numéro manuel retiré : c'est
# filters/szh-numerotation.lua qui écrit « Tableau N — » à la compilation. Son texte
# normalisé est consigné pour que szh-legendes.lua retire le paragraphe gras du .md.

RE_NUM_TABLE = re.compile(
    r'^(?:tableau|tabelle|table)\s+\d+[a-z]?\s*[:.–—‑-]?\s*', re.I)
# Variante stricte, pour un voisin ni gras ni stylé : séparateur obligatoire après le
# numéro — « Tabelle 1: … » est une légende, « Tableau 3 présente… » n'en est pas une.
RE_NUM_TABLE_STRICT = re.compile(
    r'^(?:tableau|tabelle|table)\s+\d+[a-z]?\s*[:.–—‑-]\s*', re.I)


def normaliser(t):
    """Espaces spéciaux -> espace, tirets spéciaux -> '-', compacté, rogné. À garder
    identique à la normalisation Lua de szh-legendes.lua."""
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
    ⚠ prend un paragraphe et ses propres runs, pas une cellule comme _runs_directs."""
    vu = False
    for run in p.iter(W + 'r'):
        if _run_texte(run):
            vu = True
            if not _run_gras(run):
                return False
    return vu


def html_du_tableau(tbl, caption=None):
    """Rend un w:tbl en <table>, fusions préservées et en-têtes accessibles."""
    lignes = [tr for tr in tbl if tr.tag == W + 'tr']
    # Pré-analyse : pour chaque ligne, les cellules avec (colonne de départ, colspan,
    # vmerge, élément). Les cellules « continue » occupent leur colonne — elles sont bien
    # présentes dans le XML — ce qui rend le calcul de colonne direct.
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

    # ---- Rangées d'en-tête : w:tblHeader (rangées de tête contiguës), sinon 1ʳᵉ rangée
    #      toute en gras. Zéro -> tableau plat, aucun en-tête.
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

    # ---- Invariant de grille : aucune fusion de l'en-tête ne doit dépasser dans le corps.
    #      Un rowspan ne franchit pas la frontière <thead>/<tbody>, navigateurs et
    #      WeasyPrint le bornant à la section : un en-tête d'une rangée sur un tableau dont
    #      la rangée 0 porte un rowspan=2 donnerait une grille fausse. On réduit le compte
    #      jusqu'à ce qu'aucune fusion ne dépasse, quitte à tomber à 0 — un tableau sans
    #      <thead> reste juste, un <thead> tronqué est faux, et l'en-tête se repose d'un
    #      clic dans l'éditeur. Même invariant que normaliserModele() côté extension.
    def fusion_franchit_entete(n):
        for r in range(min(n, len(grille))):
            for cel in grille[r]:
                if r + rowspan_depuis(r, cel['col']) > n:
                    return True
        return False

    while lignes_entete > 0 and fusion_franchit_entete(lignes_entete):
        lignes_entete -= 1

    # ---- Matrice d'occupation : origine[r][c] = (rangée, colonne) de la cellule qui
    #      couvre la case visuelle (r, c), pour les headers="…" des cellules de données.
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

    # ---- Complexité : au moins 2 rangées d'en-tête, ou un en-tête fusionné.
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


def charger_styles_legende(z):
    """ids des styles « légende » de styles.xml (Tabelle Beschriftung, Abbildung
    Beschriftung, Caption, Légende…), que pandoc perd."""
    try:
        racine = ET.fromstring(z.read('word/styles.xml'))
    except Exception:
        return set()
    ids = set()
    for st in racine.iter(W + 'style'):
        sid = st.get(W + 'styleId') or ''
        nom_el = st.find(W + 'name')
        nom = (nom_el.get(W + 'val') or '').lower() if nom_el is not None else ''
        if 'beschriftung' in sid.lower() or 'beschriftung' in nom \
                or nom == 'caption' or 'légende' in nom or 'legende' in nom:
            ids.add(sid)
    return ids


def _pstyle(p):
    ppr = p.find(W + 'pPr')
    if ppr is None:
        return ''
    ps = ppr.find(W + 'pStyle')
    return ps.get(W + 'val') if ps is not None else ''


def est_legende_candidate(e, styles_legende):
    """Un voisin est une légende s'il est tout en gras, stylé légende, ou s'il porte le
    motif strict « Tabelle N: » (séparateur exigé, 50 mots au plus)."""
    if paragraphe_tout_gras(e):
        return True
    if _pstyle(e) in styles_legende:
        return True
    brut = normaliser(texte_plat(e))
    return bool(RE_NUM_TABLE_STRICT.match(brut)) and len(brut.split()) <= 50


def legende_de_table(parent, tbl, consommes, styles_legende):
    """Cherche un paragraphe VOISIN (avant, puis après) légende (gras, style ou
    motif strict). Retourne (element_paragraphe, texte_pour_caption_nettoye) ou
    (None, None). `consommes` = ids déjà pris (jamais 2 tableaux pour 1 légende)."""
    enfants = list(parent)
    try:
        i = enfants.index(tbl)
    except ValueError:
        return None, None
    for j in (i - 1, i + 1):
        if 0 <= j < len(enfants):
            e = enfants[j]
            if e.tag == W + 'p' and id(e) not in consommes \
                    and est_legende_candidate(e, styles_legende):
                brut = normaliser(texte_plat(e))
                if brut:
                    consommes.add(id(e))
                    return e, RE_NUM_TABLE.sub('', brut, count=1).strip()
    return None, None


def tables_consommees_par_meta():
    """Ordinaux (1-based) des tableaux consommés par docx-meta.py (lignes T de
    $SZH_META) : le tableau des auteurs ne devient jamais tables/table-NN.html."""
    chemin = os.getenv('SZH_META')
    if not chemin:
        return set()
    ordinaux = set()
    try:
        with open(chemin, encoding='utf-8') as f:
            for ligne in f:
                if ligne.startswith('T\t'):
                    try:
                        ordinaux.add(int(ligne[2:].strip()))
                    except ValueError:
                        pass
    except OSError:
        return set()
    return ordinaux


def principal(argv):
    if len(argv) != 3:
        print('usage : docx-tables.py <fichier.docx> <dossier-sortie>', file=sys.stderr)
        return 2
    chemin_docx, dossier = argv[1], argv[2]
    try:
        with zipfile.ZipFile(chemin_docx) as z:
            racine = ET.fromstring(z.read('word/document.xml'))
            styles_legende = charger_styles_legende(z)
            RELS_IMAGES.update(charger_rels(z))
    except Exception as e:
        print('[docx-tables] lecture impossible de %s : %s' % (chemin_docx, e), file=sys.stderr)
        return 1
    tableaux = tableaux_de_premier_niveau(racine)
    if not tableaux:
        return 0                              # rien à faire, rien d'écrit
    # Tableau des auteurs : sauté ici et retiré du corps par szh-meta.lua, les tableaux
    # restants étant renumérotés en séquence des deux côtés.
    sautes = tables_consommees_par_meta()
    consommes = set()
    legendes = []                             # textes normalisés des légendes prises
    n = 0
    for ordinal, (tbl, parent) in enumerate(tableaux, start=1):
        if ordinal in sautes:
            continue
        n += 1
        el, caption = legende_de_table(parent, tbl, consommes, styles_legende)
        if el is not None and caption:
            legendes.append(normaliser(texte_plat(el)))
        else:
            caption = None
        chemin = os.path.join(dossier, 'table-%02d.html' % n)
        with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html_du_tableau(tbl, caption) + '\n')
    if n == 0:
        return 0                              # tous consommés : pas de tables/ vide
    # Sidecar : légendes consommées -> szh-legendes.lua retire les paragraphes gras
    # correspondants du .md (le <caption> est déjà baké ci-dessus).
    chemin_leg = os.getenv('SZH_LEGENDES_TABLES')
    if chemin_leg and legendes:
        with open(chemin_leg, 'w', encoding='utf-8', newline='\n') as f:
            for t in legendes:
                f.write(t + '\n')
    nb_sautes = sum(1 for o in sautes if 1 <= o <= len(tableaux))
    print('[docx-tables] %d tableau(x) extrait(s), %d légendé(s)%s'
          % (n, len(legendes),
             ', %d consommé(s) (auteurs)' % nb_sautes if nb_sautes else ''))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
