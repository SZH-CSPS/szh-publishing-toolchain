"""Montre ce qu'un PDF de démo contient, pour les démos de image/patches/amont/.

Usage (avec le Python d'un venv qui a pypdf, par exemple /opt/weasyprint/bin/python) :
  inspecter.py arbre <pdf>        arbre de structure (S, Alt, ID, Headers, attributs)
  inspecter.py mcid <pdf>         contenu marqué : MCID rattachés à l'arbre ou orphelins
  inspecter.py artefacts <pdf>    marques /Artifact du flux et leurs propriétés
  inspecter.py flux <pdf> <motif> lignes du flux de contenu qui contiennent le motif
  inspecter.py texte <pdf>        texte extrait par pypdf, ligne à ligne, espaces visibles
  inspecter.py xmp <pdf>          paquet XMP brut, nombre de rdf:RDF, dc:language lu par pypdf
"""

import re
import sys

from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject

ATTRIBUTS = ('/ID', '/Alt', '/ActualText', '/Lang')


def resoudre(objet):
    return objet.get_object() if isinstance(objet, IndirectObject) else objet


def enfants(element):
    k = resoudre(element.get('/K'))
    if k is None:
        return []
    return [resoudre(e) for e in (k if isinstance(k, ArrayObject) else [k])]


def texte_de(valeur):
    valeur = resoudre(valeur)
    if isinstance(valeur, ArrayObject):
        return '[' + ' '.join(texte_de(v) for v in valeur) + ']'
    if isinstance(valeur, DictionaryObject):
        return '<<' + ' '.join(f'{k} {texte_de(v)}' for k, v in valeur.items()) + '>>'
    return repr(str(valeur)) if isinstance(valeur, str) and not str(valeur).startswith('/') else str(valeur)


def arbre(reader):
    racine = resoudre(reader.trailer['/Root'].get('/StructTreeRoot'))
    if racine is None:
        print('  (pas d\'arbre de structure)')
        return

    def parcourir(element, profondeur):
        mcids = [e for e in enfants(element) if isinstance(e, int)]
        mcids += [resoudre(e['/MCID']) for e in enfants(element)
                  if isinstance(e, DictionaryObject) and '/MCID' in e]
        details = [f'{a[1:]}={texte_de(element[a])}' for a in ATTRIBUTS if a in element]
        if '/A' in element:
            details.append(f'A={texte_de(element["/A"])}')
        if mcids:
            details.append(f'MCID={mcids}')
        print(f'  {"  " * profondeur}{element.get("/S")} {" ".join(details)}'.rstrip())
        for enfant in enfants(element):
            if isinstance(enfant, DictionaryObject) and '/S' in enfant:
                parcourir(enfant, profondeur + 1)

    for enfant in enfants(racine):
        parcourir(enfant, 0)


def marques(reader):
    """(page, opérateur, étiquette, propriétés) de chaque BDC/BMC du flux, dans l'ordre."""
    from pypdf.generic import ContentStream
    for numero, page in enumerate(reader.pages, 1):
        flux = ContentStream(page.get_contents(), reader)
        for operandes, operateur in flux.operations:
            if operateur in (b'BDC', b'BMC'):
                proprietes = resoudre(operandes[1]) if len(operandes) > 1 else None
                yield numero, operateur.decode(), str(operandes[0]), proprietes


def mcid(reader):
    racine = resoudre(reader.trailer['/Root']['/StructTreeRoot'])
    atteints = set()

    def parcourir(element):
        atteints.add(id(element))
        for enfant in enfants(element):
            if isinstance(enfant, DictionaryObject) and '/S' in enfant:
                parcourir(enfant)
    parcourir(racine)
    parent_tree = resoudre(racine['/ParentTree'])
    nums = resoudre(parent_tree['/Nums'])
    par_page = {}
    for i in range(0, len(nums), 2):
        par_page[int(nums[i])] = resoudre(nums[i + 1])
    total = orphelins = 0
    exemples = []
    for numero, page in enumerate(reader.pages, 1):
        cle = int(page.get('/StructParents', -1))
        tableau = par_page.get(cle, ArrayObject())
        for p, _, etiquette, proprietes in marques(reader):
            if p != numero or not isinstance(proprietes, DictionaryObject):
                continue
            if '/MCID' not in proprietes:
                continue
            total += 1
            n = int(proprietes['/MCID'])
            parent = resoudre(tableau[n]) if n < len(tableau) else None
            if parent is None or id(parent) not in atteints:
                orphelins += 1
                if len(exemples) < 6:
                    exemples.append(f'page {numero} {etiquette} MCID {n}')
    print(f'  {total} contenus marqués avec MCID, {orphelins} rattachés à aucun élément'
          ' atteignable depuis StructTreeRoot')
    for exemple in exemples:
        print(f'    orphelin : {exemple}')


def artefacts(reader):
    vus = {}
    for _, operateur, etiquette, proprietes in marques(reader):
        if etiquette == '/Artifact':
            cle = f'{operateur} {texte_de(proprietes) if proprietes is not None else ""}'
            vus[cle] = vus.get(cle, 0) + 1
    if not vus:
        print('  aucune marque /Artifact')
    for cle, nombre in vus.items():
        print(f'  x{nombre} /Artifact {cle}')


def flux(reader, motif):
    expression = re.compile(motif)
    for numero, page in enumerate(reader.pages, 1):
        lignes = page.get_contents().get_data().decode('latin-1').splitlines()
        trouves = [i for i, ligne in enumerate(lignes) if expression.search(ligne)]
        print(f'  page {numero} : {len(trouves)} ligne(s) avec {motif!r}')
        for i in trouves[:6]:
            # La ligne trouvée et les deux suivantes, pour voir ce que la marque entoure.
            for ligne in lignes[i:i + 3]:
                print(f'    {ligne[:110]}')
            print('    …')


def texte(reader):
    for numero, page in enumerate(reader.pages, 1):
        for ligne in page.extract_text().split('\n'):
            print(f'  p{numero} |{ligne.replace(" ", "·")}|')


def xmp(reader):
    metadonnees = resoudre(reader.trailer['/Root'].get('/Metadata'))
    brut = metadonnees.get_data().decode('utf-8')
    print(f'  {brut.count("<rdf:RDF")} rdf:RDF dans le paquet XMP')
    print(f'  pypdf xmp_metadata.dc_language = {reader.xmp_metadata.dc_language!r}')
    langue = re.search(r'<dc:language>.*?</dc:language>', brut, re.S)
    print(f'  dc:language : {langue.group(0) if langue else "absent"}')
    print(f'  /Lang du catalogue : {reader.trailer["/Root"].get("/Lang")!r}')


def main():
    commande, chemin, *reste = sys.argv[1:]
    reader = PdfReader(chemin)
    {'arbre': arbre, 'mcid': mcid, 'artefacts': artefacts, 'texte': texte, 'xmp': xmp,
     'flux': lambda r: flux(r, reste[0])}[commande](reader)


if __name__ == '__main__':
    main()
