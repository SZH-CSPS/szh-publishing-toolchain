# Le correctif SZH de WeasyPrint (image/patches/weasyprint-<version>.patch) tient-il ?
# Contrôle sur le RÉSULTAT : chaque cas est rendu en PDF/UA-1 par le WeasyPrint qui fait
# tourner ce script, puis jugé par veraPDF et relu dans l'arbre de structure.
#
#   /opt/weasyprint/bin/python3 test/weasyprint-patch-check.py
#   (depuis WSL, distro SZH-Publishing ; en CI : "$RUNNER_TEMP/weasyprint/bin/python")
#
# VERAPDF et VERAPDF_JAVA : mêmes variables et mêmes valeurs par défaut que le Makefile.
# Aucun cas ne s'abstient : veraPDF absent, c'est un échec, pas un vert.
#
# Ce que le patch doit garantir (voir son en-tête) :
#   1. un th colspan/rowspan est inscrit sur toutes les colonnes/lignes qu'il couvre
#      (sans lui : /Headers [] sur la 2e colonne d'un « Punkte » colspan=2, PDF/UA 7.5-1) ;
#      l'attribut HTML `headers` l'emporte sur la position quand il est présent ;
#   2. une <img alt="" role="presentation"> sort en artefact, sans /Figure (sinon 7.3-1),
#      et reste dessinée.
# Et ce qu'il ne doit PAS changer : alt="" seul reste une /Figure sans /Alt, signalée —
# l'import écrit alt="" pour toute image sans description, ce n'est pas une décision de
# la rédaction. Le cas f ci-dessous DOIT donc échouer en 7.3 : s'il passait, le contrôle
# serait mort, ou le patch déciderait à la place de la rédaction.
import os
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

from PIL import Image
from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject
from weasyprint import HTML

VERAPDF = os.environ.get('VERAPDF', '/opt/verapdf-cli/verapdf')
VERAPDF_JAVA = os.environ.get('VERAPDF_JAVA', '/opt/jre-min')

ENTETE = ('<!doctype html><html lang="de"><head><meta charset="utf-8"><title>T</title>'
          '</head><body>')
PIED = '</body></html>'

# nom : (corps HTML, clauses veraPDF en échec attendues)
CAS = {
    # Le tableau massie 2025-02 (table-01.html), réduit : « Punkte » colspan=2.
    'a-colspan': ('<table><caption>C</caption><thead><tr><th scope="col">X</th>'
                  '<th scope="col">Beschreibung</th><th scope="colgroup" colspan="2">Punkte'
                  '</th></tr></thead><tbody><tr><td>1. Hilfe</td><td colspan="2">Ermutigen'
                  '</td><td>0</td></tr></tbody></table>', set()),
    # En-tête de ligne rowspan=2 : sans patch, la 2e ligne perd son en-tête et se décale.
    'd-rowspan': ('<table><caption>C</caption><thead><tr><td></td><th scope="col">Wert</th>'
                  '<th scope="col">Note</th></tr></thead><tbody><tr><th scope="row" '
                  'rowspan="2">Gruppe</th><td>1</td><td>a</td></tr><tr><td>2</td><td>b</td>'
                  '</tr></tbody></table>', set()),
    # `headers` explicite, qui contredit la position.
    'c-headers': ('<table><caption>C</caption><thead><tr><th id="h0" scope="col">A</th>'
                  '<th id="h1" scope="col">B</th><th id="h2" scope="col">C</th></tr></thead>'
                  '<tbody><tr><td headers="h0">1</td><td headers="h2">2</td>'
                  '<td headers="h1 h2">3</td></tr></tbody></table>', set()),
    # Portrait décoratif dans un tableau (bloc auteur, table-02.html) + image décrite.
    'e-decor': ('<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                'role="presentation" width="80"></td><td><img src="img.png" '
                'alt="Porträt" width="80"></td></tr></table>', set()),
    # Décor seul : aucune /Figure ne doit rester, mais l'image doit être peinte.
    'e-decor-seul': ('<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                     'role="presentation" width="80"></td><td>Name</td></tr></table>', set()),
    # alt="" seul : pas une décision, reste signalé (7.3-1).
    'f-alt-vide-seul': ('<table><caption>C</caption><tr><td><img src="img.png" alt="" '
                        'width="80"></td><td>x</td></tr></table>', {'7.3-1'}),
    # Non-régression : tableau ordinaire et figure décrite.
    'g-ordinaire': ('<table><caption>C</caption><thead><tr><th scope="col">A</th>'
                    '<th scope="col">B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr>'
                    '</tbody></table><figure><img src="img.png" alt="Ein Bild" width="100">'
                    '<figcaption>Legende</figcaption></figure>', set()),
}


def _res(o):
    return o.get_object() if isinstance(o, IndirectObject) else o


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


def main():
    erreurs = []
    with tempfile.TemporaryDirectory() as d:
        Image.new('RGB', (40, 30), (200, 60, 40)).save(os.path.join(d, 'img.png'))
        pdfs = {}
        for nom, (corps, _) in CAS.items():
            pdfs[nom] = os.path.join(d, nom + '.pdf')
            HTML(string=ENTETE + corps + PIED, base_url=d + os.sep).write_pdf(
                pdfs[nom], pdf_variant='pdf/ua-1')
        verdicts = _verapdf(list(pdfs.values()))

        for nom, (_, attendu) in CAS.items():
            obtenu = verdicts.get(nom + '.pdf')
            if obtenu != attendu:
                erreurs.append(f'{nom} : veraPDF en échec sur {sorted(obtenu or [])}, '
                               f'attendu {sorted(attendu)}')

        # Lecture de l'arbre : ce que veraPDF ne distingue pas à lui seul.
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

    if erreurs:
        print('Correctif WeasyPrint : ÉCHEC')
        for e in erreurs:
            print('  -', e)
        sys.exit(1)
    print(f'Correctif WeasyPrint : {len(CAS)} cas conformes à l\'attendu.')


if __name__ == '__main__':
    main()
