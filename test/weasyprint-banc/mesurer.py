"""Relit un PDF de WeasyPrint avec pypdf : arbre de structure normalisé, texte par MCID,
contrôles de cohérence de l'arbre, liens, métadonnées, texte extrait.

    python mesurer.py <pdf>…        → écrit <pdf>.mesure.json à côté de chaque PDF

Indépendant de la pile qui a produit le PDF : banc.py le lance sans PYTHONPATH, avec le
Python du venv du banc, qui a pypdf.
"""
import hashlib
import json
import re
import sys
from collections import defaultdict

from pypdf import PdfReader
from pypdf.generic import (
    ArrayObject, ContentStream, DictionaryObject, IndirectObject, NameObject,
    NumberObject, TextStringObject)

SHY = '­'


def res(o):
    return o.get_object() if isinstance(o, IndirectObject) else o


def idnum(o):
    return o.idnum if isinstance(o, IndirectObject) else id(o)


# ── Texte des flux, par MCID ───────────────────────────────────────────────────────

def tounicode(font):
    """{code: texte} lu dans le /ToUnicode d'une police (bfchar et bfrange)."""
    table = {}
    tu = font.get('/ToUnicode')
    if tu is None:
        return table
    data = res(tu).get_data().decode('latin-1')

    def u16(h):
        b = bytes.fromhex(h)
        return b.decode('utf-16-be', errors='replace')

    for bloc in re.findall(r'beginbfchar(.*?)endbfchar', data, re.S):
        for src, dst in re.findall(r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]*)>', bloc):
            table[int(src, 16)] = u16(dst)
    for bloc in re.findall(r'beginbfrange(.*?)endbfrange', data, re.S):
        for a, b, dst in re.findall(
                r'<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<[0-9A-Fa-f]*>|\[[^\]]*\])', bloc):
            a, b = int(a, 16), int(b, 16)
            if dst.startswith('['):
                for i, h in enumerate(re.findall(r'<([0-9A-Fa-f]*)>', dst)):
                    table[a + i] = u16(h)
            else:
                base = int(dst[1:-1], 16)
                for i in range(b - a + 1):
                    table[a + i] = chr(base + i) if base + i < 0x110000 else '?'
    return table


class Polices:
    def __init__(self):
        self.cache = {}

    def get(self, font):
        key = idnum(font)
        if key not in self.cache:
            f = res(font)
            largeur = 2 if f.get('/Subtype') == '/Type0' else 1
            self.cache[key] = (largeur, tounicode(f))
        return self.cache[key]


def octets(s):
    if isinstance(s, TextStringObject):
        return s.original_bytes
    return bytes(s)


def decoder(s, police):
    largeur, table = police
    b = octets(s)
    codes = [int.from_bytes(b[i:i + largeur], 'big') for i in range(0, len(b), largeur)]
    return ''.join(table.get(c, '�') for c in codes)


def lire_flux(reader, page):
    """[(pile de marquage, texte)] dans l'ordre du flux, formulaires compris.

    Une pile est une liste de (tag, propriétés). Le texte d'un /ActualText remplace celui
    de ses glyphes, une fois par contenu marqué. Un texte dessiné sur une autre ligne que le
    précédent commence par un saut de ligne, comme le lit un outil qui suit la position :
    un contenu marqué peut couvrir plusieurs lignes. Ce saut retiré, reste le texte brut,
    celui d'un outil qui lit le contenu marqué à la suite."""
    polices = Polices()
    sortie = []

    def parcourir(contenu, ressources, pile):
        police = (1, {})
        fontes = res(ressources.get('/Font', {})) if ressources else {}
        xobjets = res(ressources.get('/XObject', {})) if ressources else {}
        actual_vu = set()
        ligne = [0.0, None, 0.0]   # ordonnée du texte, celle du dernier texte lu, TL
        for operandes, op in ContentStream(contenu, reader).operations:
            if op == b'BT':
                ligne[0] = 0.0
            elif op == b'TL':
                ligne[2] = float(operandes[0])
            elif op in (b'T*', b"'", b'"'):
                ligne[0] -= ligne[2] or 1.0
            if op in (b'BDC', b'BMC'):
                props = {}
                if op == b'BDC':
                    p = res(operandes[1])
                    if isinstance(p, DictionaryObject):
                        props = p
                    elif isinstance(p, NameObject) and ressources:
                        props = res(res(ressources.get('/Properties', {})).get(p, {}))
                pile.append((str(operandes[0]), props))
                if '/MCID' in props:
                    sortie.append((list(pile), ''))
            elif op == b'EMC':
                if pile:
                    pile.pop()
            elif op == b'Tf':
                police = polices.get(fontes[operandes[0]])
            elif op == b'Tm':
                ligne[0] = float(operandes[5])
            elif op in (b'Td', b'TD'):
                ligne[0] += float(operandes[1])
            elif op in (b'Tj', b'TJ', b"'", b'"'):
                arg = operandes[-1]
                morceaux = arg if isinstance(arg, ArrayObject) else [arg]
                texte = ''.join(decoder(m, police) for m in morceaux
                                if not isinstance(m, (int, float, NumberObject))
                                and not hasattr(m, 'as_numeric'))
                actual = next((p for _, p in reversed(pile) if '/ActualText' in p), None)
                if actual is not None:
                    if id(actual) in actual_vu:
                        texte = ''
                    else:
                        actual_vu.add(id(actual))
                        texte = str(actual['/ActualText'])
                if texte and ligne[1] is not None and ligne[0] != ligne[1]:
                    texte = '\n' + texte
                if texte:
                    ligne[1] = ligne[0]
                sortie.append((list(pile), texte))
            elif op == b'Do' and xobjets:
                x = res(xobjets.get(operandes[0]))
                if x is not None and x.get('/Subtype') == '/Form':
                    parcourir(x, res(x.get('/Resources')) or ressources, pile)

    parcourir(page.get_contents(), res(page.get('/Resources')), [])
    return sortie


# ── Mesure ─────────────────────────────────────────────────────────────────────────

def norm(t):
    return ' '.join(t.replace(SHY, '').split())


def mesurer(chemin):
    reader = PdfReader(chemin)
    pages = reader.pages
    page_ids = {p.indirect_reference.idnum: i for i, p in enumerate(pages)}
    root = reader.trailer['/Root']
    m = {'pages': len(pages), 'balise': '/StructTreeRoot' in root,
         'flux': [hashlib.md5(p.get_contents().get_data()).hexdigest()
                  if p.get_contents() is not None else '' for p in pages]}
    erreurs = defaultdict(list)

    # Flux : texte par (page, MCID), texte hors balisage, texte d'artefact.
    texte_mcid, texte_brut, ordre_flux, hors, artefact = {}, {}, [], [], []
    for i, page in enumerate(pages):
        for pile, texte in lire_flux(reader, page):
            if any(t == '/Artifact' for t, _ in pile):
                artefact.append(texte)
                continue
            mcid = next((int(p['/MCID']) for _, p in reversed(pile) if '/MCID' in p), None)
            if mcid is None:
                hors.append(texte)
                continue
            avant = texte_mcid.get((i, mcid), '')
            if avant.endswith(SHY):
                texte = texte.lstrip('\n')   # mot coupé par la césure : pas de saut
            texte_mcid[(i, mcid)] = avant + texte
            texte_brut[(i, mcid)] = texte_brut.get((i, mcid), '') + texte.lstrip('\n')
            if (i, mcid) not in ordre_flux:
                ordre_flux.append((i, mcid))
    # Contenu marqué où se lit chaque jeton, la première fois : « p<page>-<MCID> ».
    m['jetons_mcid'] = {}
    for i, mcid in ordre_flux:
        for j in re.findall(r'(?<!\d)Q\d\d(?!\d)', texte_mcid[(i, mcid)]):
            m['jetons_mcid'].setdefault(j, f'p{i}-{mcid}')
    m['texte_artefact'] = norm(' '.join(artefact))
    m['texte_flux'] = norm(' '.join(texte_mcid[k] for k in ordre_flux) + ' ' + ' '.join(hors))

    # Métadonnées.
    info = reader.metadata or {}
    m['info'] = {k: str(v) for k, v in info.items() if k in ('/Title', '/Author', '/Subject')}
    xmp = root.get('/Metadata')
    if xmp is not None:
        brut = res(xmp).get_data().decode('utf-8', 'replace')
        m['xmp'] = {
            'rdf': brut.count('<rdf:RDF'),
            'language': re.findall(r'<dc:language>.*?</dc:language>', brut, re.S) and
            re.findall(r'<rdf:li[^>]*>([^<]*)</rdf:li>',
                       re.search(r'<dc:language>(.*?)</dc:language>', brut, re.S).group(1)),
            'creator': re.search(r'<dc:creator>(.*?)</dc:creator>', brut, re.S) and
            re.findall(r'<rdf:li[^>]*>([^<]*)</rdf:li>',
                       re.search(r'<dc:creator>(.*?)</dc:creator>', brut, re.S).group(1)),
        }
    m['lang'] = str(root.get('/Lang', ''))

    # Annotations de lien.
    annots = {}
    for i, page in enumerate(pages):
        for a in page.get('/Annots', []) or []:
            o = res(a)
            if o.get('/Subtype') == '/Link':
                act = res(o.get('/A', {}))
                cible = str(act.get('/URI', '')) or str(o.get('/Dest', ''))
                annots[idnum(a)] = {'page': i, 'contents': str(o.get('/Contents', '')),
                                    'cible': cible, 'sp': o.get('/StructParent')}
    m['liens'] = sorted((v['cible'], v['contents']) for v in annots.values())

    if not m['balise']:
        m['arbre'] = ''
        m['texte_arbre'] = m['texte_arbre_brut'] = ''
        m['erreurs'] = {}
        m['jetons_chemin'] = {}
        return m

    # Arbre.
    str_root = res(root['/StructTreeRoot'])
    lignes, texte_arbre, texte_arbre_brut = [], [], []
    mcid_elem = defaultdict(list)       # (page, mcid) → [idnum élément]
    ids = defaultdict(list)             # /ID → [idnum]
    objr = {}                           # idnum annotation → idnum élément
    elems = {}                          # idnum → dict
    jetons = {}                         # jeton → (chemin S, lang effective)
    th_texte = {}

    def kids(e):
        k = e.get('/K')
        if k is None:
            return []
        return list(k) if isinstance(k, ArrayObject) else [k]

    def texte_sous(e, pg):
        t = []
        for k in kids(e):
            ko = res(k)
            if isinstance(ko, (int, NumberObject)):
                t.append(texte_mcid.get((page_ids.get(pg, -1), int(ko)), ''))
            elif isinstance(ko, DictionaryObject) and ko.get('/Type') == '/MCR':
                t.append(texte_mcid.get((page_ids.get(ko.raw_get('/Pg').idnum if '/Pg' in ko else pg, -1),
                                         int(ko['/MCID'])), ''))
            elif isinstance(ko, DictionaryObject) and '/S' in ko:
                t.append(texte_sous(ko, ko.raw_get('/Pg').idnum if '/Pg' in ko else pg))
        return ' '.join(t)

    def walk(ref, parent_ref, pg, prof, chemin, lang):
        e = res(ref)
        n = idnum(ref)
        s = str(e['/S'])
        if n in elems:
            erreurs['element_deux_fois'].append(s)
            return
        elems[n] = e
        if parent_ref is not None and '/P' in e and idnum(e.raw_get('/P')) != parent_ref:
            erreurs['P_incoherent'].append(s)
        if '/Pg' in e:
            if e.raw_get('/Pg').idnum not in page_ids:
                erreurs['Pg_hors_page'].append(s)
            pg = e.raw_get('/Pg').idnum
        lang = str(e['/Lang']) if '/Lang' in e else lang
        if '/ID' in e:
            ids[str(e['/ID'])].append(n)
        attrs = []
        for cle in ('/Lang', '/Alt', '/ActualText', '/E'):
            if cle in e:
                attrs.append(f'{cle[1:]}={str(e[cle])!r}')
        if '/ID' in e:
            attrs.append('ID')
        a = res(e.get('/A')) if '/A' in e else None
        if isinstance(a, DictionaryObject):
            for cle in ('/ColSpan', '/RowSpan', '/Scope', '/ListNumbering'):
                if cle in a:
                    attrs.append(f'{cle[1:]}={a[cle]}')
            if '/Headers' in a:
                attrs.append('Headers=' + '|'.join(
                    f'@{str(res(h))}' for h in res(a['/Headers'])))
        if s == '/TH':
            th_texte[str(e.get('/ID', ''))] = norm(texte_sous(e, pg))
        lignes.append('  ' * prof + s[1:] + (' ' + ' '.join(attrs) if attrs else ''))
        chemin = chemin + [s[1:]]
        alt = str(e['/Alt']) if '/Alt' in e else None
        contenu = norm(texte_sous(e, pg))
        if alt is not None and not contenu:
            texte_arbre.append(alt)
            texte_arbre_brut.append(alt)
            for j in re.findall(r'(?<!\d)Q\d\d(?!\d)', alt):
                jetons.setdefault(j, ('/'.join(chemin), lang))
        for k in kids(e):
            ko = res(k)
            if isinstance(ko, (int, NumberObject)) or (
                    isinstance(ko, DictionaryObject) and ko.get('/Type') == '/MCR'):
                if isinstance(ko, DictionaryObject):
                    p = ko.raw_get('/Pg').idnum if '/Pg' in ko else pg
                    mc = int(ko['/MCID'])
                else:
                    p, mc = pg, int(ko)
                cle = (page_ids.get(p, -1), mc)
                mcid_elem[cle].append(n)
                t = texte_mcid.get(cle)
                if t is None:
                    erreurs['mcid_fantome'].append(f'p{cle[0]} mcid {mc}')
                    t = ''
                lignes.append('  ' * (prof + 1) + repr(norm(t)))
                texte_arbre.append(t)
                texte_arbre_brut.append(texte_brut.get(cle, ''))
                for j in re.findall(r'(?<!\d)Q\d\d(?!\d)', t):
                    if j in jetons:
                        erreurs['jeton_deux_fois_arbre'].append(j)
                    jetons[j] = ('/'.join(chemin), lang)
            elif isinstance(ko, DictionaryObject) and ko.get('/Type') == '/OBJR':
                ao = idnum(ko.raw_get('/Obj'))
                if ao in objr:
                    erreurs['objr_double'].append(str(ao))
                objr[ao] = n
                an = annots.get(ao)
                if an is None:
                    erreurs['objr_sans_annotation'].append(s)
                    lignes.append('  ' * (prof + 1) + 'OBJR ?')
                else:
                    lignes.append('  ' * (prof + 1) +
                                  f'OBJR {an["cible"]!r} Contents={an["contents"]!r}')
            elif isinstance(ko, DictionaryObject) and '/S' in ko:
                walk(k, n, pg, prof + 1, chemin, lang)
            else:
                erreurs['kid_inconnu'].append(s)

    for k in kids(str_root):
        walk(k, idnum(root.raw_get('/StructTreeRoot')), None, 0, [], m['lang'])

    # Contrôles.
    for cle in texte_mcid:
        if cle not in mcid_elem:
            erreurs['mcid_orphelin'].append(f'p{cle[0]} mcid {cle[1]} {norm(texte_mcid[cle])[:40]!r}')
    for cle, liste in mcid_elem.items():
        if len(liste) > 1:
            erreurs['mcid_double'].append(f'p{cle[0]} mcid {cle[1]}')
    if hors:
        t = norm(' '.join(hors))
        if t:
            erreurs['texte_hors_balisage'].append(t[:80])
    # ParentTree.
    pt = res(str_root.get('/ParentTree'))
    nums = {}
    def lire_nums(noeud):
        noeud = res(noeud)
        if '/Nums' in noeud:
            n = noeud['/Nums']
            for i in range(0, len(n), 2):
                nums[int(n[i])] = n[i + 1]
        for k in noeud.get('/Kids', []):
            lire_nums(k)
    if pt is not None:
        lire_nums(pt)
    for i, page in enumerate(pages):
        sp = page.get('/StructParents')
        mcids = sorted(mc for (p, mc) in texte_mcid if p == i)
        if sp is None:
            if mcids:
                erreurs['page_sans_StructParents'].append(f'p{i}')
            continue
        tab = res(nums.get(int(sp)))
        if tab is None:
            if mcids:
                erreurs['parenttree_page_absente'].append(f'p{i}')
            continue
        tab = list(tab)
        for mc in mcids:
            attendu = mcid_elem.get((i, mc))
            if mc >= len(tab):
                erreurs['parenttree_court'].append(f'p{i} mcid {mc}')
            elif attendu and idnum(tab[mc]) != attendu[0]:
                erreurs['parenttree_incoherent'].append(f'p{i} mcid {mc}')
    for ao, an in annots.items():
        if ao not in objr:
            erreurs['annotation_sans_objr'].append(an['cible'])
        elif an['sp'] is None:
            erreurs['annotation_sans_StructParent'].append(an['cible'])
        elif idnum(nums.get(int(an['sp']))) != objr[ao]:
            erreurs['annotation_parenttree_incoherent'].append(an['cible'])
    # /ID et /IDTree.
    for i, liste in ids.items():
        if len(liste) > 1:
            erreurs['id_double'].append(i)
    idtree = {}
    def lire_noms(noeud):
        noeud = res(noeud)
        if '/Names' in noeud:
            n = noeud['/Names']
            for i in range(0, len(n), 2):
                idtree[str(n[i])] = idnum(n[i + 1])
        for k in noeud.get('/Kids', []):
            lire_noms(k)
    if '/IDTree' in str_root:
        lire_noms(str_root['/IDTree'])
    for i, liste in ids.items():
        if i not in idtree:
            erreurs['id_hors_idtree'].append(i)
        elif idtree[i] not in liste:
            erreurs['idtree_incoherent'].append(i)
    for i, n in idtree.items():
        if n not in elems:
            erreurs['idtree_vers_hors_arbre'].append(i)
    # Structure des listes.
    for n, e in elems.items():
        s = str(e['/S'])
        enfants = [str(res(k)['/S']) for k in kids(e)
                   if isinstance(res(k), DictionaryObject) and '/S' in res(k)]
        if s == '/LI' and any(c not in ('/Lbl', '/LBody') for c in enfants):
            erreurs['LI_enfant_interdit'].append(','.join(enfants))
        if s == '/LI' and any(isinstance(res(k), (int, NumberObject)) for k in kids(e)):
            erreurs['LI_contenu_direct'].append(s)
        if not kids(e) and s not in ('/Figure',):
            erreurs['element_vide'].append(s)

    # Headers résolus en texte du TH.
    arbre = '\n'.join(lignes)
    for i, t in th_texte.items():
        arbre = arbre.replace(f'@{i}|', f'@{t!r}|').replace(f'@{i}\n', f'@{t!r}\n')
    arbre = re.sub(r'@(\d+-\d+-\d+)', lambda mo: f'@{th_texte.get(mo.group(1), "?")!r}', arbre)
    m['arbre'] = arbre
    m['texte_arbre'] = norm(' '.join(texte_arbre))
    m['texte_arbre_brut'] = norm(' '.join(texte_arbre_brut))
    m['jetons_chemin'] = jetons
    m['erreurs'] = {k: v for k, v in erreurs.items()}
    return m


def extraction_pypdf(chemin):
    try:
        return norm(' '.join(p.extract_text() for p in PdfReader(chemin).pages))
    except Exception as e:  # noqa: BLE001
        return f'<pypdf en échec : {e}>'


def main():
    for chemin in sys.argv[1:]:
        try:
            m = mesurer(chemin)
        except Exception:
            import traceback
            m = {'echec_mesure': traceback.format_exc()}
        m['texte_pypdf'] = extraction_pypdf(chemin)
        with open(chemin + '.mesure.json', 'w', encoding='utf-8') as f:
            json.dump(m, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
