#!/usr/bin/env python3
# Extrait les tableaux d'un .docx en HTML, fusions comprises.
#
#   python3 docx-tables.py <fichier.docx> <dossier-sortie>
#
# Écrit <dossier-sortie>/table-NN.html pour chaque tableau de premier niveau, dans l'ordre
# du document. Les fusions, que pandoc déplie, sont gardées : w:gridSpan -> colspan,
# w:vMerge -> rowspan. Cellule : paragraphes séparés par <br>, w:b -> <strong>,
# w:i -> <em>, texte échappé. Un tableau imbriqué est rendu dans sa cellule et ne compte
# pas comme tableau, comme côté Lua.
#
# En-têtes accessibles (WCAG H43), comme dans l'éditeur du cockpit : rangées w:tblHeader,
# sinon première rangée si elle est toute en gras, sinon tableau sans en-tête. Tableau
# simple -> <thead> et <th scope="col"> ; complexe (deux rangées d'en-tête ou plus, ou un
# en-tête fusionné) -> id sur chaque en-tête, scope="col"/"colgroup", headers="…" sur
# chaque cellule de données.
#
# Un tableau sans <th> n'a pas de /Headers dans le PDF, et aucun validateur PDF/UA ne le
# signale. Cas fréquent : en-tête marqué par un fond coloré plutôt que par du gras. Chaque
# tableau sans en-tête déclenche donc un avertissement (stderr et $SZH_IMPORT_LOG) ;
# l'import réussit quand même.
#
# Sont sautés, et les autres numérotés en séquence : le tableau des auteurs (lignes
# « T<TAB>k » de $SZH_META, écrites par docx-meta.py) et les tableaux de mise en page
# d'images (lignes « FG<TAB>k » de pronto-lire.py), que szh-meta.lua remplace par un
# groupe d'images. szh-meta.lua retire les mêmes tableaux du corps : la numérotation reste
# alignée sur szh-tabelle-reference.lua.
#
# Légende : un paragraphe voisin tout en gras, de style « légende » (Tabelle Beschriftung,
# Caption…, lu dans styles.xml car pandoc le perd), ou commençant par « Tableau N » suivi
# d'un séparateur (« Tableau 3 présente… » n'est pas une légende).
#
# Sans tableau : n'écrit rien, sort 0.

import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from html import escape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import szh_commun
import ooxml_lecture
from ooxml_lecture import W, A, WP, R, pstyle

# Images des cellules, rendues en <img src="media/…"> : pandoc extrait les médias sous
# media/ avec leurs noms, et le tableau est inséré depuis le dossier de l'article, d'où ce
# chemin relatif.
RELS_IMAGES = {}                              # rId -> media/imageN.ext


def charger_rels(z):
    """word/_rels/document.xml.rels : rId -> cible media/ (basename conservé)."""
    return {rid: 'media/' + nom for rid, nom in ooxml_lecture.charger_rels_images(z).items()}


def html_du_drawing(drawing):
    """<img> d'un w:drawing : src par les rels, alt de wp:docPr (@descr), largeur de
    wp:extent (9525 EMU par px). Un dessin sans image (forme, graphique) donne '' ; pandoc
    les perd aussi."""
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
        elif enfant.tag == W + 'noBreakHyphen':
            morceaux.append(szh_commun.TRAIT_UNION_INSECABLE)
        elif enfant.tag == W + 'sym':
            morceaux.append(escape(szh_commun.caractere_sym(enfant.get(W + 'char'),
                                                             enfant.get(W + 'font'))))
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
    # Paragraphes vides de fin ignorés (Word en ajoute après un tableau imbriqué).
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
    """Runs (w:r) des paragraphes directs de la cellule, sans les tableaux imbriqués."""
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
    """Vrai si la ligne a du texte et que tous ses runs de texte sont en gras (w:b).
    Sert à deviner l'en-tête en l'absence de w:tblHeader."""
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


# ---- Légendes de tableau ----
# La légende devient le <caption> du HTML, sans son numéro : szh-numerotation.lua écrit
# « Tableau N — » à la compilation. Son texte normalisé est noté pour que szh-legendes.lua
# retire le paragraphe du .md.

RE_NUM_TABLE = re.compile(
    r'^(?:tableau|tabelle|table)\s+\d+[a-z]?\s*[:.–—‑-]?\s*', re.I)
# Variante stricte, pour un voisin ni gras ni stylé : séparateur obligatoire après le
# numéro.
RE_NUM_TABLE_STRICT = re.compile(
    r'^(?:tableau|tabelle|table)\s+\d+[a-z]?\s*[:.–—‑-]\s*', re.I)


def normaliser(t):
    """Espaces spéciales -> espace, tirets -> '-', espaces regroupées, bords rognés. À
    garder identique à la normalisation de szh-legendes.lua."""
    for a, b in ((u' ', ' '), (u' ', ' '), (u' ', ' '),
                 (u'–', '-'), (u'—', '-'), (u'‑', '-')):
        t = t.replace(a, b)
    return ' '.join(t.split())


def texte_plat(p):
    """Texte brut d'un paragraphe (sans balisage), tabulations -> espace, sauts ignorés."""
    return ooxml_lecture.texte_paragraphe(p, sauts=False)


def texte_plat_cellule(tc):
    """Texte brut d'une cellule (w:tc) : ses paragraphes directs joints par une espace,
    sans les tableaux imbriqués."""
    morceaux = [texte_plat(p) for p in tc if p.tag == W + 'p']
    return ' '.join(m for m in morceaux if m)


def paragraphe_tout_gras(p):
    """Vrai si tous les runs de texte du paragraphe (w:p, pas une cellule) sont en gras."""
    vu = False
    for run in p.iter(W + 'r'):
        if _run_texte(run):
            vu = True
            if not _run_gras(run):
                return False
    return vu


# Avertissements pour la rédaction : une ligne, champs séparés par « | », le deuxième étant
# un code stable que le cockpit reconnaît. Écrits sur stderr et dans $SZH_IMPORT_LOG par
# szh_commun.avertir() ; l'import réussit quand même.
PREFIXE_AVERT = '[import-avertissement]'


def avertir(code, champs, fr, de):
    szh_commun.avertir(PREFIXE_AVERT, code, champs, fr, de)


# « | » sépare les champs d'un avertissement : un texte de cellule ne doit pas en contenir.
def sans_barre(t):
    return str(t).replace('|', '/')


def nom_article():
    """Slug de l'article : $SZH_SLUG, sinon le nom du dossier courant."""
    return os.getenv('SZH_SLUG') or os.path.basename(os.getcwd()) or '?'


def html_du_tableau(tbl, caption=None, info=None, attributs_table=None):
    """Rend un w:tbl en <table>, fusions préservées et en-têtes accessibles.

    `info`, si fourni, reçoit `lignes_entete` (nombre de rangées d'en-tête, 0 = sans
    en-tête) et `premiere_cellule` (texte de la première cellule, absent si vide).

    `attributs_table`, si fourni, donne les attributs de la balise <table> : les champs
    d'un bloc du gabarit Pronto, sous les noms qu'attend szh-numerotation.lua (data-alt,
    data-copyright, data-source, data-note)."""
    lignes = [tr for tr in tbl if tr.tag == W + 'tr']
    # Pour chaque ligne, ses cellules (colonne de départ, colspan, vmerge, élément). Les
    # cellules « continue » sont présentes dans le XML et occupent leur colonne.
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
    #      toute en gras. Zéro : tableau sans en-tête, et principal() avertit.
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

    # ---- Aucune fusion de l'en-tête ne doit déborder dans le corps : navigateurs et
    #      WeasyPrint arrêtent un rowspan à la fin du <thead>, et la grille serait fausse.
    #      On réduit le nombre de rangées d'en-tête, jusqu'à 0 s'il le faut (l'en-tête se
    #      redéclare dans l'éditeur). Même règle que normaliserModele() du cockpit.
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

    if info is not None:
        info['lignes_entete'] = lignes_entete
        # Texte de la première cellule ; clé absente si elle est vide.
        if grille and grille[0]:
            debut_cellule = normaliser(texte_plat_cellule(grille[0][0]['tc']))
            if debut_cellule:
                info['premiere_cellule'] = debut_cellule

    ouvrante = ''.join(' %s="%s"' % (nom, escape(str(valeur), quote=True))
                       for nom, valeur in sorted((attributs_table or {}).items())
                       if str(valeur).strip())
    sortie = ['<table%s>' % ouvrante]
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
        # Sans en-tête : rien que des cellules de données.
        for i in range(nb_lignes):
            sortie += rendre_ligne(i, grille[i], False)
    sortie.append('</table>')
    return '\n'.join(sortie)


def tableaux_de_premier_niveau(racine):
    """[(w:tbl, parent)] des tableaux non imbriqués, dans l'ordre du document. Le parent
    sert à trouver la légende voisine."""
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
    return {sid for sid, nom in ooxml_lecture.charger_styles(z).items()
            if 'beschriftung' in sid.lower() or 'beschriftung' in nom
            or nom == 'caption' or 'légende' in nom or 'legende' in nom}


def est_legende_candidate(e, styles_legende):
    """Un voisin est une légende s'il est tout en gras, stylé légende, ou s'il porte le
    motif strict « Tabelle N: » (séparateur exigé, 50 mots au plus)."""
    if paragraphe_tout_gras(e):
        return True
    if pstyle(e) in styles_legende:
        return True
    brut = normaliser(texte_plat(e))
    return bool(RE_NUM_TABLE_STRICT.match(brut)) and len(brut.split()) <= 50


def legende_de_table(parent, tbl, consommes, styles_legende):
    """Cherche une légende dans le paragraphe voisin, avant puis après. Rend (paragraphe,
    texte du <caption>) ou (None, None). `consommes` : légendes déjà prises (une légende
    ne sert qu'à un tableau)."""
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
    """Rangs (à partir de 1) des tableaux consommés par docx-meta.py (lignes T de
    $SZH_META), comme le tableau des auteurs."""
    chemin = os.getenv('SZH_META')
    if not chemin:
        return set()
    return _ordinaux_par_lettre(chemin, 'T\t')


def tables_grilles_par_meta():
    """Rangs (comme les lignes T) des tableaux de mise en page d'images reconnus par
    pronto-lire.py (lignes « FG<TAB>k<TAB>… »). szh-meta.lua les remplace par un bloc
    `::: {.szh-grille}` ; ils sont sautés comme un tableau consommé."""
    return _ordinaux_par_lettre(os.getenv('SZH_META'), 'FG\t')


def _ordinaux_par_lettre(chemin, prefixe):
    if not chemin:
        return set()
    ordinaux = set()
    try:
        with open(chemin, encoding='utf-8') as f:
            for ligne in f:
                if ligne.startswith(prefixe):
                    try:
                        ordinaux.add(int(ligne[len(prefixe):].split('\t')[0].strip()))
                    except ValueError:
                        pass
    except OSError:
        return set()
    return ordinaux


def blocs_pronto_par_meta():
    """Rang (comme les lignes T) -> {'legende', 'alt', 'credit', 'source', 'note'} pour
    chaque tableau contenu dans un bloc du gabarit Pronto (lignes FT de $SZH_META,
    écrites par pronto-lire.py) :

        FT<TAB>k<TAB>légende<TAB>texte alternatif<TAB>copyright<TAB>source<TAB>note

    Ce sont les valeurs saisies sous « Légende : », « Texte alternatif : »,
    « Copyright : », « Source : » et « Note : » ; leurs paragraphes quittent le corps par
    les lignes P. Pour les figures, voir szh-legendes.lua (lignes FI)."""
    chemin = os.getenv('SZH_META')
    if not chemin:
        return {}
    blocs = {}
    try:
        with open(chemin, encoding='utf-8') as f:
            for ligne in f:
                if not ligne.startswith('FT\t'):
                    continue
                champs = ligne.rstrip('\n').split('\t')
                try:
                    ordinal = int(champs[1])
                except (IndexError, ValueError):
                    continue
                champs += [''] * (7 - len(champs))
                blocs[ordinal] = {'legende': champs[2].strip(), 'alt': champs[3].strip(),
                                  'credit': champs[4].strip(), 'source': champs[5].strip(),
                                  'note': champs[6].strip()}
    except OSError:
        return {}
    return blocs


def principal(argv):
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
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
        return 0
    # Tableaux sautés ici et retirés du corps par szh-meta.lua : la numérotation reste
    # la même des deux côtés.
    sautes = tables_consommees_par_meta()
    grilles = tables_grilles_par_meta() - sautes
    sautes = sautes | grilles
    blocs_pronto = blocs_pronto_par_meta()
    consommes = set()
    legendes = []                             # textes normalisés des légendes prises
    plats = []                                # tableaux sans rangée d'en-tête
    n = 0
    for ordinal, (tbl, parent) in enumerate(tableaux, start=1):
        if ordinal in sautes:
            continue
        n += 1
        bloc = blocs_pronto.get(ordinal)
        attributs = None
        if bloc:
            # Bloc du gabarit : la légende est donnée, on ne cherche pas de voisin (un
            # paragraphe gras au-dessus la remplacerait).
            caption = bloc['legende'] or None
            attributs = {'data-alt': bloc['alt'], 'data-copyright': bloc['credit'],
                         'data-source': bloc['source'], 'data-note': bloc['note']}
        else:
            el, caption = legende_de_table(parent, tbl, consommes, styles_legende)
            if el is not None and caption:
                legendes.append(normaliser(texte_plat(el)))
            else:
                caption = None
        chemin = os.path.join(dossier, 'table-%02d.html' % n)
        info = {}
        with open(chemin, 'w', encoding='utf-8', newline='\n') as f:
            f.write(html_du_tableau(tbl, caption, info, attributs) + '\n')
        if not info.get('lignes_entete'):
            plats.append((n, chemin, info.get('premiere_cellule', '')))
    if n == 0:
        return 0                              # tous sautés
    # Légendes prises : szh-legendes.lua retire leurs paragraphes du .md.
    chemin_leg = os.getenv('SZH_LEGENDES_TABLES')
    if chemin_leg and legendes:
        with open(chemin_leg, 'w', encoding='utf-8', newline='\n') as f:
            for t in legendes:
                f.write(t + '\n')
    # Aucun en-tête reconnu. Un tableau sans en-tête est permis (WCAG et RGAA exigent
    # seulement de déclarer celui qui existe) : le message pose une question plutôt que de
    # demander de désigner la première rangée.
    slug = nom_article()
    # `debut` donne au cockpit un texte à chercher : le numéro seul se confondrait avec
    # d'autres nombres de l'article. 40 caractères, comme cle_comparaison() de docx-meta.py.
    LONGUEUR_EXTRAIT_DEBUT = 40
    for numero, chemin, debut_txt in plats:
        champs = ['article « %s »' % slug, 'tableau %d' % numero]
        if debut_txt:
            champs.append('debut « %s »' % sans_barre(debut_txt[:LONGUEUR_EXTRAIT_DEBUT]))
        champs.append(chemin.replace(os.sep, '/'))
        avertir(
            'tableau-sans-entete',
            champs,
            "Aucun en-tête n'a pu être reconnu dans ce tableau. Si sa première rangée "
            "ou sa première colonne en est un, ouvrez-le dans l'éditeur de tableaux et "
            "déclarez-le : un lecteur d'écran pourra alors relier chaque cellule à son "
            "en-tête. Si ce tableau n'a réellement pas d'en-tête, il n'y a rien à faire.",
            'In dieser Tabelle wurde keine Kopfzeile erkannt. Falls die erste Zeile oder '
            'die erste Spalte eine ist, öffnen Sie die Tabelle im Tabellen-Editor und '
            'deklarieren Sie sie: ein Screenreader kann dann jede Zelle ihrer Kopfzeile '
            'zuordnen. Hat die Tabelle wirklich keine Kopfzeile, ist nichts zu tun.')

    nb_grilles = sum(1 for o in grilles if 1 <= o <= len(tableaux))
    nb_sautes = sum(1 for o in sautes if 1 <= o <= len(tableaux)) - nb_grilles
    print('[docx-tables] %d tableau(x) extrait(s), %d légendé(s)%s%s%s'
          % (n, len(legendes),
             ', %d consommé(s) (auteurs)' % nb_sautes if nb_sautes else '',
             ', %d devenu(s) groupe(s) d\'images' % nb_grilles if nb_grilles else '',
             ', %d sans en-tête' % len(plats) if plats else ''))
    return 0


if __name__ == '__main__':
    sys.exit(principal(sys.argv))
