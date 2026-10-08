# Vérifie que les patchs SZH de WeasyPrint (image/patches/weasyprint-<version>/) font leur
# travail. Chaque cas est rendu en PDF/UA-1 par le WeasyPrint qui exécute ce script, puis
# jugé par veraPDF et relu dans l'arbre de structure et le flux de contenu.
#
#   /opt/weasyprint/bin/python3 test/weasyprint-patch-check.py
#   (dans la WSL SZH-Publishing ; en CI : "$RUNNER_TEMP/weasyprint/bin/python")
#
# VERAPDF et VERAPDF_JAVA : mêmes variables et mêmes valeurs par défaut que le Makefile.
# veraPDF absent est un échec.
#
# Seuls les cas des patchs appliqués sont jugés : image/patch-weasyprint.sh en écrit la
# liste dans weasyprint/szh-patchs.txt. Liste absente, ou patch appliqué sans cas ici :
# échec.
#
# Ce que chaque patch doit garantir (voir son en-tête) :
#   10-tableaux-entetes : un th colspan/rowspan est inscrit sur toutes les colonnes/lignes
#      qu'il couvre (sans lui : /Headers [] sur la 2e colonne d'un « Punkte » colspan=2,
#      PDF/UA 7.5-1) ; l'attribut HTML `headers` l'emporte sur la position ;
#   15-images-decoratives : une <img alt="" role="presentation"> sort en artefact, sans
#      /Figure (sinon 7.3-1), et reste dessinée ;
#   20-cesure-trait : le trait ajouté par la césure est un /Span /ActualText U+00AD autour
#      de ce seul glyphe (sinon « ensei‐gnants » au copier-coller) ;
#   25-espace-fin-de-ligne : une ligne coupée sur une espace garde cette espace dans la
#      couche texte (sinon « lamarche ») ; le dessin de l'espace est dans le 20, sans lequel
#      ce patch ne produit rien : posé seul, c'est un échec ;
#   30-marges-artefact : en-tête, pied et folio sont des /Artifact /Pagination, sans MCID
#      orphelin ; une boîte de marge qui porte un lien reste du contenu balisé ;
#   40-xmp-dc-language : la langue de <html lang> est en dc:language dans le XMP, au sein
#      de l'unique rdf:RDF du paquet (pypdf ne lit que le premier) ;
#   50-notes-doublon : une note reportée à la page suivante n'y est pas imprimée une
#      seconde fois quand un target-counter fait repaginer ;
#   55-notes-reportees : une note reste sur la page de son appel quand c'est un paragraphe
#      suivant qui manque de lignes pour orphans ; c'est ce paragraphe qui part.
# Ce qu'ils ne changent pas : alt="" seul reste une /Figure sans /Alt, signalée, car
# l'import écrit alt="" pour toute image sans description. Le cas f doit donc échouer en
# 7.3 ; s'il passe, le contrôle ne détecte plus rien ou le patch va trop loin. Le trait
# d'un composé coupé à son trait reste un trait, et ni un <br> ni une fin de paragraphe ne
# reçoivent d'espace.
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

import weasyprint
from PIL import Image
from pypdf import PdfReader
from pypdf.generic import (
    ArrayObject, ContentStream, DictionaryObject, IndirectObject, NumberObject,
    TextStringObject)
from weasyprint import HTML

VERAPDF = os.environ.get('VERAPDF', '/opt/verapdf-cli/verapdf')
VERAPDF_JAVA = os.environ.get('VERAPDF_JAVA', '/opt/jre-min')
TEMOIN = os.path.join(os.path.dirname(weasyprint.__file__), 'szh-patchs.txt')
SHY = chr(0xAD)

ENTETE = ('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title>'
          '</head><body>')
PIED = '</body></html>'

ENTETES, DECOR, CESURE, ESPACE, MARGES, XMP, DOUBLON, REPORTEE = (
    '10-tableaux-entetes.patch', '15-images-decoratives.patch', '20-cesure-trait.patch',
    '25-espace-fin-de-ligne.patch', '30-marges-artefact.patch', '40-xmp-dc-language.patch',
    '50-notes-doublon.patch', '55-notes-reportees.patch')

# Pages de 100 × 80 mm à 12 lignes de 5 mm ; un renvoi target-counter vers la dernière
# page fait repaginer.
NOTES = ('<style>@page{size:100mm 80mm;margin:10mm;@footnote{margin-top:1mm}}'
         ' body{font:4mm/5mm sans-serif;margin:0;orphans:2;widows:2} p{margin:0}'
         ' .note{float:footnote} ::footnote-call{line-height:0;vertical-align:super;'
         'font-size:70%}'
         ' a.ref::after{content:" S. " target-counter(attr(href), page)}'
         ' .saut{break-before:page}</style>')
FIN = ('<p class="saut">d1 <a class="ref" href="#fin">Verweis</a></p>'
       '<p class="saut" id="fin">Ende</p>')

# nom : (patch, corps HTML, clauses veraPDF en échec attendues)
CAS = {
    # Tableau d'un article réel, réduit : « Punkte » colspan=2.
    'a-colspan': (ENTETES,
                  '<table><caption>C</caption><thead><tr><th scope="col">X</th>'
                  '<th scope="col">Beschreibung</th><th scope="colgroup" colspan="2">Punkte'
                  '</th></tr></thead><tbody><tr><td>1. Hilfe</td><td colspan="2">Ermutigen'
                  '</td><td>0</td></tr></tbody></table>', set()),
    # En-tête de ligne rowspan=2 : sans patch, la 2e ligne perd son en-tête et se décale.
    'd-rowspan': (ENTETES,
                  '<table><caption>C</caption><thead><tr><td></td><th scope="col">Wert</th>'
                  '<th scope="col">Note</th></tr></thead><tbody><tr><th scope="row" '
                  'rowspan="2">Gruppe</th><td>1</td><td>a</td></tr><tr><td>2</td><td>b</td>'
                  '</tr></tbody></table>', set()),
    # `headers` explicite, qui contredit la position.
    'c-headers': (ENTETES,
                  '<table><caption>C</caption><thead><tr><th id="h0" scope="col">A</th>'
                  '<th id="h1" scope="col">B</th><th id="h2" scope="col">C</th></tr></thead>'
                  '<tbody><tr><td headers="h0">1</td><td headers="h2">2</td>'
                  '<td headers="h1 h2">3</td></tr></tbody></table>', set()),
    # Portrait décoratif dans un tableau (bloc auteur) et image décrite.
    'e-decor': (DECOR,
                '<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                'role="presentation" width="80"></td><td><img src="img.png" '
                'alt="Porträt" width="80"></td></tr></table>', set()),
    # Décor seul : aucune /Figure ne doit rester, mais l'image doit être peinte.
    'e-decor-seul': (DECOR,
                     '<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                     'role="presentation" width="80"></td><td>Name</td></tr></table>', set()),
    # alt="" seul reste signalé (7.3-1).
    'f-alt-vide-seul': (DECOR,
                        '<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                        'width="80"></td><td>x</td></tr></table>', {'7.3-1'}),
    # Non-régression : tableau ordinaire et figure décrite.
    'g-ordinaire': (DECOR,
                    '<table><caption>C</caption><thead><tr><th scope="col">A</th>'
                    '<th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr>'
                    '</tbody></table><figure><img src="img.png" alt="Ein Bild" width="100">'
                    '<figcaption>Legende</figcaption></figure>', set()),
    # Césure : plusieurs mots coupés dans une colonne étroite.
    'h-cesure': (CESURE,
                 '<p lang="fr" style="width:6em;hyphens:auto">Les enseignants spécialisés '
                 'accompagnent institutionnellement les élèves.</p>', set()),
    # Composé coupé à son trait : WeasyPrint n'y ajoute rien, il ne faut rien baliser.
    # hyphenate-character "-" : le trait de césure et celui du composé sont alors le même
    # caractère, seul le patch sait lequel il a ajouté.
    'i-compose': (CESURE,
                  "<p lang=\"fr\" style=\"width:3em;hyphenate-character:'-'\">Hess-Klein "
                  'Hess-Klein</p>', set()),
    # Un mot par ligne : espace en fin de ligne, sauf au <br> et en fin de paragraphe.
    'j-espace': (ESPACE,
                 '<p style="width:1em">un deux trois<br>quatre <em>cinq</em> six</p>'
                 '<p>sept</p>', set()),
    # En-tête, folio, marge de côté en artefacts ; pied à lien, qui doit rester balisé.
    'k-marges': (MARGES,
                 '<style>@page{@top-center{content:"En-tête courant"} '
                 '@bottom-right{content:counter(page)} @left-middle{content:"Côté"} '
                 '@bottom-center{content:element(pied)}} .pied{position:running(pied)}'
                 '</style><div class="pied">Voir <a href="https://www.szh.ch">szh.ch</a>'
                 '</div><p>Texte courant.</p>', set()),
    # Langue du document (ENTETE : lang="de") dans le XMP.
    'l-xmp-langue': (XMP, '<p>Ein Satz.</p>', set()),
    # Appel sur la dernière ligne de la p. 1 : la note n'y tient pas, elle passe en p. 2,
    # qui est « à jour » à la repagination ; sans le patch, la p. 3 refaite la reprend.
    'm-doublon': (DOUBLON,
                  NOTES + '<p style="orphans:1;widows:1">a1 <a class="ref" href="#fin">'
                  'Verweis</a><br>a2<br>a3<br>a4<br>a5<br>a6<br>a7<br>a8<br>a9<br>a10<br>'
                  'a11 Aufruf<span class="note">Fussnote eins, Zeile 1<br>Zeile 2</span>'
                  '</p><p>b1</p>' + FIN, set()),
    # Le paragraphe « c » n'a qu'une ligne en bas de la p. 1 (orphans: 2) : sans le patch,
    # la note du paragraphe « a » est chassée en p. 2 pour y loger c2.
    'n-reportee': (REPORTEE,
                   NOTES + '<p>a1 <a class="ref" href="#fin">Verweis</a> Aufruf<span '
                   'class="note">Fussnote eins, Zeile 1<br>Zeile 2</span><br>a2<br>a3</p>'
                   '<p>b1<br>b2<br>b3<br>b4<br>b5</p><p>c1<br>c2<br>c3<br>c4<br>c5</p>'
                   + FIN, set()),
}


def _res(o):
    return o.get_object() if isinstance(o, IndirectObject) else o


def _patchs_actifs():
    if not os.path.exists(TEMOIN):
        sys.exit(f'Témoin absent : {TEMOIN}. image/patch-weasyprint.sh n\'a pas posé les '
                 'correctifs SZH sur ce WeasyPrint.')
    actifs = [l.strip() for l in open(TEMOIN, encoding='utf-8') if l.strip()]
    inconnus = set(actifs) - set(VERIFS)
    if inconnus:
        sys.exit(f'Patch(s) posé(s) sans contrôle ici : {sorted(inconnus)}')
    return actifs


def _elements(pdf):
    """Éléments de structure dans l'ordre du document : (S, A, ID, Alt)."""
    def enfants(e):
        k = e.get('/K')
        if k is None:
            return []
        k = _res(k)
        return [_res(x) for x in k] if isinstance(k, ArrayObject) else [k]

    def parcourir(e):
        if not isinstance(e, DictionaryObject) or '/S' not in e:
            return
        a = _res(e['/A']) if '/A' in e else {}
        yield (str(e['/S']), a, str(e['/ID']) if '/ID' in e else None,
               str(e['/Alt']) if '/Alt' in e else None)
        for c in enfants(e):
            yield from parcourir(c)

    racine = PdfReader(pdf).trailer['/Root']['/StructTreeRoot'].get_object()
    for c in enfants(racine):
        yield from parcourir(c)


def _headers(elements):
    """Liste des /Headers des TD, dans l'ordre, en listes de chaînes."""
    return [[str(_res(h)) for h in _res(a.get('/Headers', []))]
            for s, a, _, _ in elements if s == '/TD']


def _images_peintes(pdf):
    total = 0
    for page in PdfReader(pdf).pages:
        xo = page['/Resources'].get('/XObject')
        if xo is not None:
            total += sum(1 for v in _res(xo).values() if _res(v).get('/Subtype') == '/Image')
    return total


def _marquage(pdf):
    """Par page : (MCID du flux, propriétés des /Artifact, pile de marquage de chaque
    opérateur de texte). Une pile est la liste des (tag, propriétés) englobants."""
    pages = []
    reader = PdfReader(pdf)
    for page in reader.pages:
        mcids, artefacts, textes, pile = [], [], [], []
        for operandes, op in ContentStream(page.get_contents(), reader).operations:
            if op in (b'BDC', b'BMC'):
                props = _res(operandes[1]) if op == b'BDC' else None
                props = props if isinstance(props, DictionaryObject) else {}
                pile.append((str(operandes[0]), props))
                if '/MCID' in props:
                    mcids.append(int(props['/MCID']))
                if str(operandes[0]) == '/Artifact':
                    artefacts.append(props)
            elif op == b'EMC':
                pile.pop()
            elif op in (b'TJ', b'Tj'):
                textes.append((list(pile), operandes[0]))
        pages.append((mcids, artefacts, textes))
    return pages


def _actual_text(pdf):
    """[ActualText, glyphes montrés dedans] de chaque contenu marqué qui en porte un."""
    spans = []
    for _, _, textes in _marquage(pdf):
        for pile, texte in textes:
            if pile and '/ActualText' in pile[-1][1]:
                if not spans or spans[-1][2] is not pile[-1][1]:
                    spans.append([str(pile[-1][1]['/ActualText']), 0, pile[-1][1]])
                chaines = texte if isinstance(texte, ArrayObject) else [texte]
                for c in chaines:
                    if isinstance(c, (bytes, str)):
                        octets = c.original_bytes if isinstance(c, TextStringObject) else c
                        spans[-1][1] += len(octets) // 2   # CID sur 2 octets
    return [s[:2] for s in spans]


def _mcid_rattaches(pdf):
    """{ numéro d'objet de la page : MCID cités par l'arbre de structure }."""
    reader = PdfReader(pdf)
    lies = {}

    def walk(e, pg):
        e = _res(e)
        if not isinstance(e, DictionaryObject):
            return
        pg = e.get('/Pg', pg)
        k = e.get('/K')
        kids = list(k) if isinstance(k, ArrayObject) else ([k] if k is not None else [])
        for kid in kids:
            ko = _res(kid)
            if isinstance(ko, (int, NumberObject)):
                lies.setdefault(pg.idnum, set()).add(int(ko))
            elif isinstance(ko, DictionaryObject) and ko.get('/Type') == '/MCR':
                lies.setdefault(ko.get('/Pg', pg).idnum, set()).add(int(ko['/MCID']))
            else:
                walk(kid, pg)
    walk(reader.trailer['/Root']['/StructTreeRoot'], None)
    return [lies.get(p.indirect_reference.idnum, set()) for p in reader.pages]


def _lignes(pdf):
    return '\n'.join(p.extract_text() for p in PdfReader(pdf).pages).split('\n')


def _verapdf(pdfs):
    """{ chemin : ensemble des clauses en échec, 'clause-test' }."""
    if not os.access(VERAPDF, os.X_OK):
        sys.exit(f'veraPDF introuvable : {VERAPDF} (VERAPDF / VERAPDF_JAVA)')
    env = dict(os.environ, JAVA_HOME=VERAPDF_JAVA)
    r = subprocess.run([VERAPDF, '--flavour', 'ua1', '--format', 'xml', *pdfs],
                       capture_output=True, env=env, check=False)
    if r.returncode not in (0, 1):
        sys.exit(f'veraPDF en panne (code {r.returncode}) : {r.stderr.decode()[:500]}')
    verdicts = {}
    for job in ET.fromstring(r.stdout).iter('job'):
        nom = job.find('item/name').text
        rapport = job.find('validationReport')
        if rapport is None:
            sys.exit(f'veraPDF n\'a pas jugé {nom}')
        verdicts[os.path.basename(nom)] = {
            f"{regle.get('clause')}-{regle.get('testNumber')}"
            for regle in rapport.iter('rule') if regle.get('status') == 'failed'}
    return verdicts


def _verifier_entetes(pdfs, erreurs):
    el = list(_elements(pdfs['a-colspan']))
    ids = [i for s, _, i, _ in el if s == '/TH']
    if _headers(el) != [[ids[0]], [ids[1], ids[2]], [ids[2]]]:
        erreurs.append(f'a-colspan : /Headers {_headers(el)} (th {ids})')

    el = list(_elements(pdfs['d-rowspan']))
    ids = [i for s, _, i, _ in el if s == '/TH']   # Wert, Note, Gruppe
    voulu = [[], [ids[2], ids[0]], [ids[2], ids[1]], [ids[2], ids[0]], [ids[2], ids[1]]]
    if _headers(el) != voulu:
        erreurs.append(f'd-rowspan : /Headers {_headers(el)}, attendu {voulu}')

    el = list(_elements(pdfs['c-headers']))
    ids = [i for s, _, i, _ in el if s == '/TH']
    voulu = [[ids[0]], [ids[2]], [ids[1], ids[2]]]
    if _headers(el) != voulu:
        erreurs.append(f'c-headers : /Headers {_headers(el)}, attendu {voulu}')


def _verifier_decor(pdfs, erreurs):
    figures = [alt for s, _, _, alt in _elements(pdfs['e-decor']) if s == '/Figure']
    if figures != ['Porträt']:
        erreurs.append(f'e-decor : /Figure {figures}, attendu la seule image décrite')
    figures = [alt for s, _, _, alt in _elements(pdfs['e-decor-seul']) if s == '/Figure']
    if figures:
        erreurs.append(f'e-decor-seul : /Figure {figures} restée dans l\'arbre')
    if _images_peintes(pdfs['e-decor-seul']) < 1:
        erreurs.append('e-decor-seul : l\'image décorative n\'est plus peinte')
    figures = [alt for s, _, _, alt in _elements(pdfs['f-alt-vide-seul']) if s == '/Figure']
    if figures != [None]:
        erreurs.append(f'f-alt-vide-seul : /Figure {figures}, attendu une /Figure sans /Alt')


def _verifier_cesure(pdfs, erreurs):
    # Couche texte des fins de ligne : ce que ni veraPDF ni le rendu ne voient.
    spans = _actual_text(pdfs['h-cesure'])
    if len(spans) < 2 or any(s != [SHY, 1] for s in spans):
        erreurs.append(f'h-cesure : {spans}, attendu au moins 2 [U+00AD, 1 glyphe]')
    if _actual_text(pdfs['i-compose']):
        erreurs.append(f'i-compose : /ActualText hors césure {_actual_text(pdfs["i-compose"])}')
    # Les espaces de fin de ligne relèvent du 25 : ici, seul le trait du composé compte.
    voulu = ['Hess-', 'Klein', 'Hess-', 'Klein']
    if [l.rstrip(' ') for l in _lignes(pdfs['i-compose'])] != voulu:
        erreurs.append(f'i-compose : lignes {_lignes(pdfs["i-compose"])}, attendu {voulu}')


def _verifier_espace(pdfs, erreurs):
    # Le dessin de l'espace est dans le 20 : sans lui, ce patch ne produit rien.
    if 'i-compose' not in pdfs:
        erreurs.append(f'{ESPACE} posé sans {CESURE}, qui dessine l\'espace de fin de ligne')
        return
    if _actual_text(pdfs['j-espace']):
        erreurs.append(f'j-espace : /ActualText hors césure {_actual_text(pdfs["j-espace"])}')
    voulu = ['Hess-', 'Klein ', 'Hess-', 'Klein']
    if _lignes(pdfs['i-compose']) != voulu:
        erreurs.append(f'i-compose : lignes {_lignes(pdfs["i-compose"])}, attendu {voulu}')
    voulu = ['un ', 'deux ', 'trois', 'quatre ', 'cinq ', 'six', 'sept']
    if _lignes(pdfs['j-espace']) != voulu:
        erreurs.append(f'j-espace : lignes {_lignes(pdfs["j-espace"])}, attendu {voulu}')


def _verifier_marges(pdfs, erreurs):
    pdf = pdfs['k-marges']
    pages = _marquage(pdf)
    for n, ((mcids, artefacts, textes), lies) in enumerate(zip(pages, _mcid_rattaches(pdf))):
        orphelins = sorted(set(mcids) - lies)
        if orphelins:
            erreurs.append(f'k-marges p.{n + 1} : MCID rattachés à rien {orphelins}')
        pagination = sorted(
            (str(a.get('/Subtype')), [str(x) for x in a.get('/Attached', [])])
            for a in artefacts if a.get('/Type') == '/Pagination')
        voulu = [('/Footer', ['/Bottom']), ('/Header', ['/Top']), ('None', ['/Left'])]
        if pagination != voulu:
            erreurs.append(f'k-marges p.{n + 1} : artefacts de pagination {pagination}, '
                           f'attendu {voulu} (le pied à lien reste du contenu)')
        hors = [t for pile, t in textes if not pile]
        if hors:
            erreurs.append(f'k-marges p.{n + 1} : {len(hors)} texte(s) hors de tout marquage')
        en_marge = [t for pile, t in textes
                    if any(tag == '/Artifact' and p.get('/Type') == '/Pagination'
                           for tag, p in pile)]
        if len(en_marge) < 3:
            erreurs.append(f'k-marges p.{n + 1} : {len(en_marge)} texte(s) en artefact de '
                           'pagination, attendu 3 (en-tête, folio, côté)')
    if '/Link' not in [s for s, _, _, _ in _elements(pdf)]:
        erreurs.append('k-marges : le lien du pied n\'est plus un élément /Link')
    texte = '\n'.join(_lignes(pdf))
    for mot in ('En-tête courant', 'Côté', 'szh.ch'):
        if mot not in texte:
            erreurs.append(f'k-marges : « {mot} » n\'est plus extractible')


def _verifier_xmp(pdfs, erreurs):
    reader = PdfReader(pdfs['l-xmp-langue'])
    flux = reader.trailer['/Root']['/Metadata'].get_object().get_data()
    if flux.count(b'<rdf:RDF') != 1:
        erreurs.append(f'l-xmp-langue : {flux.count(b"<rdf:RDF")} rdf:RDF dans le XMP, '
                       'attendu 1')
    langues = reader.xmp_metadata.dc_language
    if langues != ['de']:
        erreurs.append(f'l-xmp-langue : dc:language {langues}, attendu [\'de\']')


def _pages_de(pdf, texte):
    """Numéros des pages dont le texte contient `texte`."""
    return [n for n, p in enumerate(PdfReader(pdf).pages, 1) if texte in p.extract_text()]


def _verifier_doublon(pdfs, erreurs):
    notes = _pages_de(pdfs['m-doublon'], 'Fussnote eins')
    if notes != [2]:
        erreurs.append(f'm-doublon : note en p. {notes}, attendu [2] (reportée une fois)')


def _verifier_reportee(pdfs, erreurs):
    appel = _pages_de(pdfs['n-reportee'], 'Aufruf')
    notes = _pages_de(pdfs['n-reportee'], 'Fussnote eins')
    if appel != [1] or notes != [1]:
        erreurs.append(f'n-reportee : appel en p. {appel}, note en p. {notes}, attendu [1] '
                       'et [1]')
    if _pages_de(pdfs['n-reportee'], 'c1') != [2]:
        erreurs.append('n-reportee : le paragraphe « c » n\'est pas parti entier en p. 2')


VERIFS = {ENTETES: _verifier_entetes, DECOR: _verifier_decor, CESURE: _verifier_cesure,
          ESPACE: _verifier_espace, MARGES: _verifier_marges, XMP: _verifier_xmp,
          DOUBLON: _verifier_doublon, REPORTEE: _verifier_reportee}


def main():
    actifs = _patchs_actifs()
    cas = {nom: v for nom, v in CAS.items() if v[0] in actifs}
    print(f'Correctifs posés : {", ".join(actifs) or "aucun"}')
    erreurs = []
    with tempfile.TemporaryDirectory() as d:
        Image.new('RGB', (40, 30), (200, 60, 40)).save(os.path.join(d, 'img.png'))
        pdfs = {}
        for nom, (_, corps, _) in cas.items():
            pdfs[nom] = os.path.join(d, nom + '.pdf')
            HTML(string=ENTETE + corps + PIED, base_url=d + os.sep).write_pdf(
                pdfs[nom], pdf_variant='pdf/ua-1')
        verdicts = _verapdf(list(pdfs.values())) if pdfs else {}

        for nom, (_, _, attendu) in cas.items():
            obtenu = verdicts.get(nom + '.pdf')
            if obtenu != attendu:
                erreurs.append(f'{nom} : veraPDF en échec sur {sorted(obtenu or [])}, '
                               f'attendu {sorted(attendu)}')
        for patch in actifs:
            VERIFS[patch](pdfs, erreurs)

    if erreurs:
        print('Correctifs WeasyPrint : ÉCHEC')
        for e in erreurs:
            print('  -', e)
        sys.exit(1)
    print(f'Correctifs WeasyPrint : {len(cas)} cas conformes à l\'attendu '
          f'({len(CAS) - len(cas)} cas de patchs désactivés non joués).')


if __name__ == '__main__':
    main()
