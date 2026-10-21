#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# Étape d'import : repère dans un Word les objets que pandoc ne sait pas rendre en image
# (graphique, SmartArt, objet incorporé, dessin, forme) et pose à côté de chacun une image
# de remplacement, pour que la figure garde sa place, sa légende et son numéro.
#
#   python3 docx-objets.py <entree.docx> <sortie.docx> <etat.tsv>
#
# La sortie est une copie du Word, lue ensuite par toutes les étapes de l'import à la place
# de l'original. Elle n'est écrite que si un objet a reçu une image de remplacement ; le
# code de sortie vaut alors 0, et 10 s'il n'y a rien à remplacer (l'original sert tel quel).
#
# L'image de remplacement est pipeline/media/image-a-remplacer.svg, celle que
# szh-metafichier.lua met à la place d'une image .emf ou .wmf. Son texte alternatif dit
# qu'il manque une image, suivi de la description Word de l'objet s'il en a une.
#
# Placement :
#   * un objet seul dans son paragraphe : l'image est posée juste avant lui, dans le même
#     paragraphe. La légende Word voisine devient celle de la figure, comme pour une image ;
#   * un objet dans un paragraphe de texte (forme flottante, objet dans une phrase) :
#     l'image va dans un nouveau paragraphe, juste après.
# L'objet reste dans la copie : pandoc en garde ce qu'il sait lire (le texte d'une zone de
# texte d'un groupe, par exemple).
#
# Ce qui reçoit une image de remplacement (TYPES) :
#   * graphique Word (c:chart, cx:chart), SmartArt (dgm:relIds) ;
#   * objet incorporé (o:OLEObject) sans aperçu, ou dont l'aperçu est dans un
#     mc:AlternateContent, que pandoc ignore. Un objet incorporé avec son aperçu garde
#     l'aperçu, que pandoc extrait comme une image ; il est seulement noté ;
#   * dessin : groupe de formes (wpg:wgp, v:group), zone de dessin (wpc:wpc), encre ;
#   * forme seule (wps:wsp, v:shape, v:rect…) visible et sans texte ;
#   * tout autre contenu graphique sans image lisible par pandoc.
# Ce qui est laissé tel quel :
#   * une image ordinaire (pic:pic, v:imagedata) ;
#   * une zone de texte : pandoc en garde le texte ;
#   * un filet seul (ligne, connecteur, filet horizontal o:hr) et une forme invisible
#     (fond blanc ou absent, sans contour), qui ne sont que de la mise en page.
#
# etat.tsv : une ligne par objet noté, lue par docx-controle-import.py --apres-medias, qui
# avertit sous le nom définitif de l'image :
#   <image sous media/>  <type>  <détail>  <nom Word>  <repère>  <texte du repère>  <remplacé>
# <repère> vaut « legende » (légende voisine), « paragraphe » (texte du paragraphe de
# l'objet), « apres » (dernier paragraphe de texte avant lui) ou « debut ». <remplacé> vaut
# 1 pour une image de remplacement, 0 pour un aperçu gardé.
#
# Le document est lu par un analyseur de balises qui garde la position de chaque élément :
# les ajouts se font dans le texte XML, le reste reste identique à l'octet. Non bloquant :
# sur une erreur, code 2 et message sur stderr ; l'import continue avec l'original.

import os
import re
import sys
import zipfile
from html import escape, unescape

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pronto_modele

REMPLACEMENT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'media',
                            'image-a-remplacer.svg')

# Type d'objet -> nom dans les messages et le texte alternatif.
TYPES = {
    'graphique': ('graphique', 'Diagramm'),
    'smartart': ('SmartArt', 'SmartArt-Grafik'),
    'ole': ('objet incorporé', 'eingebettetes Objekt'),
    'dessin': ('dessin', 'Zeichnung'),
    'forme': ('forme', 'Form'),
    'objet': ('objet', 'Objekt'),
}

# Application d'un objet incorporé, d'après le début de son ProgID.
APPLICATIONS = (('excel', 'Excel'), ('word', 'Word'), ('powerpoint', 'PowerPoint'),
                ('visio', 'Visio'), ('equation', 'Formel'), ('mathtype', 'MathType'),
                ('acroexch', 'PDF'), ('package', 'Paket'))

URI_GRAPHIQUE = ('/drawingml/2006/chart', '/drawing/2014/chartex')
URI_SMARTART = '/drawingml/2006/diagram'
URI_IMAGE = '/drawingml/2006/picture'
URI_FORME = '/wordprocessingShape'
URI_DESSIN = ('/wordprocessingGroup', '/wordprocessingCanvas', '/wordprocessingInk')

# Formes VML. Un filet (v:line) est de la mise en page.
VML_FORMES = ('v:shape', 'v:rect', 'v:roundrect', 'v:oval', 'v:polyline', 'v:arc',
              'v:curve')
# Géométries DrawingML d'un filet.
GEOMETRIES_FILET = re.compile(r'^(line|straightConnector\d*|bentConnector\d+|curvedConnector\d+)$')

# Légende Word reconnue à son début (« Figure 2 : … », « Abb. 3 »), ou à son style.
RE_LEGENDE = re.compile(
    r'^\s*(figure|fig\.?|abbildung|abb\.?|illustration|graphique|grafik|schéma|schema'
    r'|diagramme?|tableau|tabelle|table)\s*\d+', re.I)
STYLES_LEGENDE = ('caption', 'légende', 'legende', 'beschriftung', 'szh cle abb')

LIBELLE_ALT = {
    'fr': 'Image à remplacer : objet Word non converti (%s)',
    'de': 'Bild zu ersetzen: nicht umgewandeltes Word-Objekt (%s)',
}

NS_WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing'
NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
TYPE_REL_IMAGE = NS_R + '/image'


# ---------------------------------------------------------------------------------------
# Analyse : un arbre d'éléments qui garde la position de chacun dans le texte XML.

class Noeud:
    __slots__ = ('nom', 'attrs', 'debut', 'fin', 'enfants', 'parent', 'texte')

    def __init__(self, nom, attrs, debut, parent):
        self.nom, self.attrs, self.debut, self.parent = nom, attrs, debut, parent
        self.fin, self.enfants, self.texte = debut, [], ''

    def iter(self, nom=None):
        for e in self.enfants:
            if nom is None or e.nom == nom:
                yield e
            yield from e.iter(nom)

    def ancetre(self, nom):
        e = self.parent
        while e is not None and e.nom != nom:
            e = e.parent
        return e

    def attr(self, nom):
        m = re.search(r'(?:^|\s)' + re.escape(nom) + r'\s*=\s*"([^"]*)"', self.attrs)
        return unescape(m.group(1)) if m else None


RE_BALISE = re.compile(r'<(/?)([A-Za-z_][\w.:-]*)((?:\s[^>]*?)?)(/?)>|<!--.*?-->|<\?.*?\?>'
                       r'|<!\[CDATA\[.*?\]\]>|<![^>]*>', re.S)


def analyser(xml):
    racine = Noeud('#document', '', 0, None)
    courant, pos = racine, 0
    for m in RE_BALISE.finditer(xml):
        if m.group(2) is None:
            continue
        if courant.nom == 'w:t' and m.start() > pos:
            courant.texte += unescape(xml[pos:m.start()])
        pos = m.end()
        ferme, nom, attrs, vide = m.group(1), m.group(2), m.group(3) or '', m.group(4)
        if ferme:
            courant.fin = m.end()
            courant = courant.parent
            continue
        noeud = Noeud(nom, attrs, m.start(), courant)
        courant.enfants.append(noeud)
        if vide:
            noeud.fin = m.end()
        else:
            courant = noeud
    return racine


def texte(noeud, sauf=()):
    """Texte des w:t de `noeud`, sans ceux des sous-arbres de `sauf`."""
    morceaux = []

    def marche(e):
        for x in e.enfants:
            if x in sauf:
                continue
            if x.nom == 'w:t':
                morceaux.append(x.texte)
            elif x.nom in ('w:tab', 'w:br', 'w:cr'):
                morceaux.append(' ')
            else:
                marche(x)
    marche(noeud)
    return ' '.join(''.join(morceaux).split())


# ---------------------------------------------------------------------------------------
# Les objets.

CONTENEURS = ('w:drawing', 'w:pict', 'w:object')


def contenu_choisi(alternance):
    """Le mc:Choice d'un mc:AlternateContent (la forme moderne de l'objet), à défaut son
    mc:Fallback."""
    for nom in ('mc:Choice', 'mc:Fallback'):
        for e in alternance.enfants:
            if e.nom == nom:
                return e
    return None


def _a(noeud, nom):
    return next(noeud.iter(nom), None) is not None


def forme_invisible(sppr):
    """Vrai pour une forme DrawingML sans fond visible (aucun, ou blanc) et sans contour."""
    if sppr is None:
        return False
    fond_absent = any(e.nom == 'a:noFill' for e in sppr.enfants)
    for e in sppr.enfants:
        if e.nom == 'a:solidFill':
            couleur = next((c for c in e.enfants), None)
            if couleur is not None and (
                    (couleur.nom == 'a:schemeClr' and couleur.attr('val') in ('bg1', 'lt1'))
                    or (couleur.nom == 'a:srgbClr' and (couleur.attr('val') or '').upper() == 'FFFFFF')):
                fond_absent = True
    ligne = next((e for e in sppr.enfants if e.nom == 'a:ln'), None)
    sans_contour = ligne is not None and any(e.nom == 'a:noFill' for e in ligne.enfants)
    return fond_absent and sans_contour


def classer_forme_dml(wsp):
    """'forme', ou None pour une zone de texte, un filet ou une forme invisible."""
    if _a(wsp, 'wps:txbx'):
        return None
    geo = next(wsp.iter('a:prstGeom'), None)
    if geo is not None and GEOMETRIES_FILET.match(geo.attr('prst') or ''):
        return None
    if forme_invisible(next(wsp.iter('wps:spPr'), None)):
        return None
    return 'forme'


def classer_vml(pict):
    """Type d'un w:pict sans objet incorporé : None pour une image, une zone de texte, un
    filet ou une forme invisible."""
    if _a(pict, 'v:imagedata') or _a(pict, 'v:textbox'):
        return None
    if _a(pict, 'v:group'):
        return 'dessin'
    for e in pict.iter():
        if e.nom in VML_FORMES:
            if e.attr('o:hr') == 't':
                return None
            if e.attr('filled') in ('f', 'false') and e.attr('stroked') in ('f', 'false'):
                return None
            if (e.attr('fillcolor') or '').lower().startswith('white') \
                    and e.attr('stroked') in ('f', 'false'):
                return None
            return 'forme'
    return None


def application(progid):
    p = (progid or '').lower()
    for debut, nom in APPLICATIONS:
        if p.startswith(debut) or ('.' + debut) in p:
            return nom
    return (progid or '').split('.')[0]


def classer(contenu, dans_alternance, rels):
    """(type, détail, aperçu) d'un objet, ou None s'il n'y a rien à signaler. `aperçu` : le
    nom sous media/ de l'image que pandoc extrait de l'objet, '' sinon."""
    ole = next(contenu.iter('o:OLEObject'), None)
    if ole is not None:
        apercu = ''
        if not dans_alternance:
            donnees = next(contenu.iter('v:imagedata'), None)
            if donnees is not None:
                apercu = rels.get(donnees.attr('r:id') or '', '')
        return 'ole', application(ole.attr('ProgID')), apercu
    if _a(contenu, 'w14:contentPart'):
        return 'dessin', '', ''
    donnees = next(contenu.iter('a:graphicData'), None)
    if donnees is not None:
        uri = donnees.attr('uri') or ''
        if any(uri.endswith(u) for u in URI_GRAPHIQUE):
            return 'graphique', '', ''
        if uri.endswith(URI_SMARTART):
            return 'smartart', '', ''
        if any(uri.endswith(u) for u in URI_DESSIN):
            return 'dessin', '', ''
        if uri.endswith(URI_FORME):
            wsp = next(donnees.iter('wps:wsp'), None)
            genre = classer_forme_dml(wsp) if wsp is not None else 'forme'
            return (genre, '', '') if genre else None
        if uri.endswith(URI_IMAGE):
            return None
        if not dans_alternance and _a(contenu, 'a:blip'):
            return None
        return 'objet', '', ''
    if contenu.nom == 'w:pict' or _a(contenu, 'w:pict'):
        genre = classer_vml(contenu)
        return (genre, '', '') if genre else None
    return None


def nom_word(contenu):
    pr = next(contenu.iter('wp:docPr'), None)
    if pr is not None:
        return (pr.attr('name') or '').strip(), (pr.attr('descr') or '').strip()
    for e in contenu.iter():
        if e.nom in VML_FORMES + ('v:group',) and e.attr('alt'):
            return '', e.attr('alt').strip()
    return '', ''


def taille_emu(contenu):
    """(cx, cy) de l'objet en EMU : wp:extent, sinon le style VML (pt), sinon w:object
    (twips). 4:3 par défaut."""
    ext = next(contenu.iter('wp:extent'), None)
    if ext is not None:
        try:
            cx, cy = int(ext.attr('cx')), int(ext.attr('cy'))
            if cx > 0 and cy > 0:
                return cx, cy
        except (TypeError, ValueError):
            pass
    for e in [contenu] + list(contenu.iter()):
        style = e.attr('style') or ''
        l = re.search(r'width:\s*([\d.]+)pt', style)
        h = re.search(r'height:\s*([\d.]+)pt', style)
        if l and h and float(l.group(1)) > 0 and float(h.group(1)) > 0:
            return int(float(l.group(1)) * 12700), int(float(h.group(1)) * 12700)
        if e.nom == 'w:object':
            try:
                return int(e.attr('w:dxaOrig')) * 635, int(e.attr('w:dyaOrig')) * 635
            except (TypeError, ValueError):
                pass
    return 3048000, 2286000


def objets_du_document(racine, rels):
    """[(conteneur, contenu, type, détail, aperçu)] dans l'ordre du document. Le conteneur
    est l'élément enfant du run : w:drawing, w:pict, w:object ou mc:AlternateContent."""
    trouves = []

    def marche(e):
        for x in e.enfants:
            if x.nom == 'mc:AlternateContent':
                contenu = contenu_choisi(x)
                if contenu is not None and (any(_a(contenu, c) for c in CONTENEURS)
                                            or _a(contenu, 'w14:contentPart')):
                    r = classer(contenu, True, rels)
                    if r:
                        trouves.append((x, contenu) + r)
                continue
            if x.nom in CONTENEURS:
                r = classer(x, False, rels)
                if r:
                    trouves.append((x, x) + r)
                continue
            marche(x)
    marche(racine)
    return trouves


# ---------------------------------------------------------------------------------------
# Repère : la légende voisine, sinon le texte autour.

def _style_legende(p, styles):
    sid = next((s.attr('w:val') for s in p.iter('w:pStyle')), '') or ''
    nom = (styles.get(sid) or sid).lower()
    nom_n = pronto_modele.normaliser_nom_style(nom)
    return any(pronto_modele.normaliser_nom_style(s) in nom_n for s in STYLES_LEGENDE)


def repere(p, sauf, styles):
    """(genre, texte) qui situe un objet dont `p` est le paragraphe."""
    if p is None:
        return 'debut', ''
    freres = [e for e in p.parent.enfants if e.nom == 'w:p']
    i = freres.index(p)
    voisins = []
    for j in (i + 1, i - 1, i + 2, i - 2):
        if 0 <= j < len(freres):
            t = texte(freres[j])
            if t:
                voisins.append((freres[j], t))
    for q, t in voisins:
        if RE_LEGENDE.match(t) or _style_legende(q, styles):
            return 'legende', t
    propre = texte(p, sauf)
    if propre:
        return 'paragraphe', propre
    for q in reversed(freres[:i]):
        t = texte(q)
        if t:
            return 'apres', t
    return 'debut', ''


def styles_par_id(z):
    try:
        xml = z.read('word/styles.xml').decode('utf-8')
    except KeyError:
        return {}
    ids = {}
    for m in re.finditer(r'<w:style\b[^>]*?w:styleId="([^"]+)"[^>]*>.*?<w:name w:val="([^"]+)"',
                         xml, re.S):
        ids[m.group(1)] = unescape(m.group(2))
    return ids


# ---------------------------------------------------------------------------------------
# Écriture de la copie.

def langue():
    """Langue du texte alternatif : celle du livre, sinon celle du produit ; fr par défaut."""
    lang = pronto_modele.langue_du_livre() or pronto_modele.langue_du_produit(
        os.getenv('SZH_PRODUIT', ''))
    return 'de' if lang == 'de' else 'fr'


def texte_alt(genre, detail, descr, lang):
    nom = TYPES[genre][0 if lang == 'fr' else 1]
    if genre == 'ole' and detail:
        nom += ' ' + detail
    alt = LIBELLE_ALT[lang] % nom
    if descr:
        alt += '. ' + descr
    return alt


def dessin_remplacement(rid, nom_fichier, cx, cy, ident, nom, alt):
    return ('<w:r><w:drawing><wp:inline xmlns:wp="%s" distT="0" distB="0" distL="0" distR="0">'
            '<wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="%s" descr="%s"/>'
            '<a:graphic xmlns:a="%s"><a:graphicData uri="%s">'
            '<pic:pic xmlns:pic="%s"><pic:nvPicPr><pic:cNvPr id="%d" name="%s"/><pic:cNvPicPr/>'
            '</pic:nvPicPr><pic:blipFill><a:blip xmlns:r="%s" r:embed="%s"/><a:stretch>'
            '<a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/>'
            '<a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
            '</pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
            % (NS_WP, cx, cy, ident, escape(nom), escape(alt), NS_A, NS_PIC, NS_PIC, ident, escape(nom_fichier), NS_R, rid, cx, cy))


def ligne_etat(*champs):
    return '\t'.join(' '.join(str(c).split()) for c in champs)


def principal(entree, sortie, chemin_etat):
    with zipfile.ZipFile(entree) as z:
        noms = z.namelist()
        xml = z.read('word/document.xml').decode('utf-8')
        rels_xml = z.read('word/_rels/document.xml.rels').decode('utf-8') \
            if 'word/_rels/document.xml.rels' in noms else ''
        styles = styles_par_id(z)
        rels = {m.group(1): os.path.basename(m.group(2)) for m in re.finditer(
            r'<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]*media/[^"]+)"', rels_xml)}
        racine = analyser(xml)
        objets = objets_du_document(racine, rels)
        lang = langue()
        insertions, lignes, fichiers = [], [], []
        conteneurs = {o[0] for o in objets}
        for conteneur, contenu, genre, detail, apercu in objets:
            nom, descr = nom_word(contenu)
            p = conteneur.ancetre('w:p')
            genre_rep, texte_rep = repere(p, conteneurs, styles)
            if apercu:
                lignes.append(ligne_etat(apercu, genre, detail, nom, genre_rep, texte_rep[:120], 0))
                continue
            n = len(fichiers) + 1
            fichier = 'szh-objet-%02d.svg' % n
            rid = 'rIdSzhObjet%d' % n
            cx, cy = taille_emu(contenu)
            run = dessin_remplacement(rid, fichier, cx, cy, 990000 + n, nom or fichier,
                                      texte_alt(genre, detail, descr, lang))
            r = conteneur.ancetre('w:r')
            if p is not None and texte(p, conteneurs) == '' and r is not None:
                insertions.append((r.debut, run))
            elif p is not None:
                insertions.append((p.fin, '<w:p>%s</w:p>' % run))
            else:
                continue
            fichiers.append((fichier, rid))
            lignes.append(ligne_etat(fichier, genre, detail, nom, genre_rep, texte_rep[:120], 1))
        with open(chemin_etat, 'w', encoding='utf-8', newline='\n') as f:
            f.write(''.join(l + '\n' for l in lignes))
        if not fichiers:
            return 10
        # Du dernier ajout au premier : les positions des précédents restent justes. À
        # position égale, l'ordre du document est gardé.
        for pos, bout in sorted(enumerate(insertions), key=lambda x: (x[1][0], x[0]), reverse=True):
            xml = xml[:bout[0]] + bout[1] + xml[bout[0]:]
        rels_xml = rels_xml.replace('</Relationships>', ''.join(
            '<Relationship Id="%s" Type="%s" Target="media/%s"/>' % (rid, TYPE_REL_IMAGE, f)
            for f, rid in fichiers) + '</Relationships>')
        with open(REMPLACEMENT, 'rb') as f:
            svg = f.read()
        with zipfile.ZipFile(sortie, 'w', zipfile.ZIP_DEFLATED) as zo:
            for info in z.infolist():
                data = z.read(info.filename)
                if info.filename == 'word/document.xml':
                    data = xml.encode('utf-8')
                elif info.filename == 'word/_rels/document.xml.rels':
                    data = rels_xml.encode('utf-8')
                elif info.filename == '[Content_Types].xml':
                    ct = data.decode('utf-8')
                    if not re.search(r'Extension="svg"', ct, re.I):
                        ct = ct.replace('</Types>', '<Default Extension="svg" '
                                        'ContentType="image/svg+xml"/></Types>')
                    data = ct.encode('utf-8')
                zo.writestr(info.filename, data, compress_type=zipfile.ZIP_DEFLATED)
            for f, _ in fichiers:
                zo.writestr('word/media/' + f, svg)
    return 0


if __name__ == '__main__':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) != 4:
        sys.exit('usage : docx-objets.py <entree.docx> <sortie.docx> <etat.tsv>')
    try:
        sys.exit(principal(sys.argv[1], sys.argv[2], sys.argv[3]))
    except (OSError, KeyError, zipfile.BadZipFile, UnicodeDecodeError, ValueError) as e:
        print('[docx-objets] objets du Word non traités : %s' % e, file=sys.stderr)
        sys.exit(2)
