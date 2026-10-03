"""Contrôle des sorties d'un livre compilé : folios, métadonnées, couverture, EPUB.

    /opt/weasyprint/bin/python test/livre-sorties-check.py test/livre-falc

Lit buch.yaml et out/ du livre. Une ligne FAIL par écart, code de sortie 1 s'il y en a.
Le verdict se lit sur l'absence de FAIL.
"""
import json
import os
import re
import sys
import zipfile

import pypdf
from PIL import Image

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, '..', 'pipeline'))
from szh_commun import lire_yaml  # noqa: E402


def _modele(buch):
    """Le modèle de couverture, lu par couverture.py lui-même."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        'couverture', os.path.join(ICI, '..', 'pipeline', 'couverture.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.modele_couverture(buch)
REFERENCE = os.path.join(ICI, '..', 'pipeline', 'styles', 'couleurs-reference.json')
FORMATS_MM = {'standard': (155, 225), 'a4': (210, 297)}
PT_MM = 25.4 / 72
FOLIO = re.compile(r'\b(?:page|seite)\s+(\d+)\s+(?:sur|von)\s+(\d+)\b', re.I)
TITRE_SOMMAIRE = {'fr': 'Sommaire', 'de': 'Inhaltsverzeichnis', 'it': 'Indice'}

echecs = []


def fail(msg):
    echecs.append(msg)
    print('FAIL ' + msg)


def ok(msg):
    print('ok   ' + msg)


def noms(personnes):
    out = []
    for p in personnes or []:
        if isinstance(p, dict):
            nom = ' '.join(x for x in (p.get('prenom'), p.get('nom')) if x)
            if nom:
                out.append(nom)
    return out


def operateurs(reader):
    """Tous les flux de contenu de toutes les pages, Form XObjects compris (récursif)."""
    vus, flux = set(), []

    def xobjets(res):
        res = res.get_object() if res else None
        if not res or '/XObject' not in res:
            return
        for x in res['/XObject'].values():
            o = x.get_object()
            if id(o) in vus:
                continue
            vus.add(id(o))
            if o.get('/Subtype') == '/Form':
                flux.append(o.get_data().decode('latin1'))
                xobjets(o.get('/Resources'))
            elif o.get('/Subtype') == '/Image':
                flux.append(('IMG', o.get('/ColorSpace')))

    for p in reader.pages:
        c = p.get_contents()
        if c is not None:
            flux.append(c.get_data().decode('latin1'))
        xobjets(p.get('/Resources'))
    return flux


def taille_mm(box):
    return (float(box.width) * PT_MM, float(box.height) * PT_MM)


def proche(a, b, tol=0.3):
    return abs(a - b) <= tol


def controler_folios(chemin, lang):
    r = pypdf.PdfReader(chemin)
    n = len(r.pages)
    page_sommaire, premier_folio, vus = None, None, 0
    for i, p in enumerate(r.pages, 1):
        t = p.extract_text() or ''
        if page_sommaire is None and TITRE_SOMMAIRE.get(lang, 'Sommaire') in t:
            page_sommaire = i
        for m in FOLIO.finditer(t):
            vus += 1
            x, y = int(m.group(1)), int(m.group(2))
            if premier_folio is None:
                premier_folio = i
            if x != i or y != n:
                fail('%s p.%d : folio « %s », attendu %d sur %d' % (chemin, i, m.group(0), i, n))
        if re.search(r'(?m)^\s*[ivxlc]+\s*$', t):
            fail('%s p.%d : folio romain' % (chemin, i))
    if not vus:
        fail('%s : aucun folio « page X sur Y »' % chemin)
        return
    if page_sommaire is None:
        fail('%s : page du sommaire introuvable' % chemin)
    elif premier_folio != page_sommaire:
        fail('%s : premier folio p.%s, sommaire p.%s' % (chemin, premier_folio, page_sommaire))
    else:
        ok('%s : %d folios, page PDF = folio, premier au sommaire (p.%d)' % (chemin, vus, page_sommaire))


def controler_meta_pdf(chemin, buch, personnes):
    info = pypdf.PdfReader(chemin).metadata or {}
    if (info.get('/Title') or '').strip() != str(buch.get('titre', '')).strip():
        fail('%s : /Title « %s »' % (chemin, info.get('/Title')))
    auteur = info.get('/Author') or ''
    manquants = [x for x in personnes if x not in auteur]
    if personnes and manquants:
        fail('%s : /Author « %s » sans %s' % (chemin, auteur, manquants))
    if not echecs or chemin not in echecs[-1]:
        ok('%s : titre et auteurs' % chemin)


def controler_couverture(out, nom, buch, ref):
    dos_json = os.path.join(out, nom + '-dos.json')
    if not os.path.exists(dos_json):
        fail('%s absent' % dos_json)
        return
    dos = json.load(open(dos_json, encoding='utf-8'))
    largeur, hauteur = FORMATS_MM[str(buch.get('format') or 'standard')]
    cle = buch.get('couleur-impression')
    if cle not in ref:
        fail('buch.yaml : couleur-impression « %s » hors de la liste de référence' % cle)
        return
    cmjn = ' '.join('%g' % v for v in ref[cle]['cmjn'])
    rgb = tuple(int(ref[cle]['rgb'][i:i + 2], 16) for i in (1, 3, 5))

    # Impression : PDF/X, FOGRA52, aucune couleur RGB, gabarit = 2 plats + dos.
    imp = os.path.join(out, nom + '-couverture-impression.pdf')
    if not os.path.exists(imp):
        fail('%s absent' % imp)
    else:
        r = pypdf.PdfReader(imp)
        oi = r.trailer['/Root'].get('/OutputIntents')
        ident = [str(o.get_object().get('/OutputConditionIdentifier')) for o in (oi or [])]
        sortes = [str(o.get_object().get('/S')) for o in (oi or [])]
        if '/GTS_PDFX' not in sortes or not any('FOGRA52' in x for x in ident):
            fail('%s : OutputIntent PDF/X FOGRA52 absent (%s)' % (imp, ident))
        if len(r.pages) != 1:
            fail('%s : %d pages, attendu 1' % (imp, len(r.pages)))
        p = r.pages[0]
        w, h = taille_mm(p.trimbox)
        if not (proche(w, 2 * largeur + dos['dos_mm']) and proche(h, hauteur)):
            fail('%s : TrimBox %.1f×%.1f, attendu %.1f×%.1f'
                 % (imp, w, h, 2 * largeur + dos['dos_mm'], hauteur))
        bw, _ = taille_mm(p.bleedbox)
        if bw < w + 5.9:
            fail('%s : fond perdu < 3 mm' % imp)
        flux = operateurs(r)
        textes = [f for f in flux if isinstance(f, str)]
        rgb_ops = [m for f in textes for m in re.findall(r'(?<![\w.])[\d.]+ [\d.]+ [\d.]+ (?:rg|RG)\b', f)]
        if rgb_ops:
            fail('%s : %d opérateurs RGB, ex. %s' % (imp, len(rgb_ops), rgb_ops[:3]))
        images = [str(f[1]) for f in flux if isinstance(f, tuple)]
        if any('RGB' in x for x in images):
            fail('%s : image RGB %s' % (imp, images))
        if not any(cmjn in f for f in textes):
            fail('%s : CMJN de référence « %s » (%s) absent' % (imp, cmjn, cle))
        if not echecs or imp not in echecs[-1]:
            ok('%s : PDF/X FOGRA52, %.1f mm de dos, CMJN %s exact' % (imp, dos['dos_mm'], cmjn))

    # Écran : 2 pages sans dos ni fond perdu, en RGB.
    ecran = os.path.join(out, nom + '-couverture.pdf')
    if not os.path.exists(ecran):
        fail('%s absent' % ecran)
    else:
        r = pypdf.PdfReader(ecran)
        if len(r.pages) != 2:
            fail('%s : %d pages, attendu 2 (1re puis 4e)' % (ecran, len(r.pages)))
        for i, p in enumerate(r.pages, 1):
            w, h = taille_mm(p.mediabox)
            if not (proche(w, largeur) and proche(h, hauteur)):
                fail('%s p.%d : %.1f×%.1f, attendu %d×%d' % (ecran, i, w, h, largeur, hauteur))
        textes = [f for f in operateurs(r) if isinstance(f, str)]
        if any(re.search(r'(?<![\w.])[\d.]+ [\d.]+ [\d.]+ [\d.]+ (?:k|K|scn|SCN)\b', f) for f in textes):
            fail('%s : couleurs CMJN dans le PDF écran' % ecran)
        # Une illustration CMJN fournie telle quelle (JPEG d'InDesign ou de Photoshop) doit
        # sortir en RGB à l'écran : laissée en CMJN, chaque lecteur la convertit à sa façon.
        images = [str(f[1]) for f in operateurs(r) if isinstance(f, tuple)]
        if any('CMYK' in x for x in images):
            fail('%s : image CMJN dans le PDF écran (%s)' % (ecran, images))
        if not echecs or ecran not in echecs[-1]:
            ok('%s : 2 pages RGB %d×%d' % (ecran, largeur, hauteur))

    # PNG : 1re et 4e, RGB strict de la référence (pas de conversion), lu sur la couleur
    # d'impression en 1re. La 1re du modèle recherche n'en porte aucune au pixel près
    # (illustration sous des voiles) : on y lit le rouge de la bande de 4e.
    face_lue, attendu, cle_lue = '1', rgb, cle
    if _modele(buch) == 'recherche':
        face_lue, cle_lue = '4', 'rouge'
        attendu = tuple(int(ref['rouge']['rgb'][i:i + 2], 16) for i in (1, 3, 5))
    for face in ('1', '4'):
        png = os.path.join(out, '%s-couverture-%s.png' % (nom, face))
        if not os.path.exists(png):
            fail('%s absent' % png)
            continue
        im = Image.open(png)
        if im.mode != 'RGB':
            fail('%s : mode %s' % (png, im.mode))
            im = im.convert('RGB')
        if abs(im.width / im.height - largeur / hauteur) > 0.01:
            fail('%s : rapport %.3f, attendu %.3f' % (png, im.width / im.height, largeur / hauteur))
        if face == face_lue:
            exacts = sum(n for n, c in im.getcolors(1 << 24) if c == attendu)
            if exacts < 1000:
                fail('%s : %d pixels %s exacts (couleur de référence %s)'
                     % (png, exacts, ref[cle_lue]['rgb'], cle_lue))
        if not echecs or png not in echecs[-1]:
            ok('%s : %d×%d RGB' % (png, im.width, im.height))


def controler_epub(chemin, buch, personnes):
    if not os.path.exists(chemin):
        fail('%s absent' % chemin)
        return
    z = zipfile.ZipFile(chemin)
    opf_nom = re.search(r'full-path="([^"]+)"', z.read('META-INF/container.xml').decode()).group(1)
    # pandoc typographie l'apostrophe : « d’essai » vaut « d'essai ».
    opf = z.read(opf_nom).decode('utf-8').replace('’', "'")
    if 'properties="cover-image"' not in opf:
        fail('%s : pas d’image de couverture' % chemin)
    titre = str(buch.get('titre', ''))
    if titre and titre not in opf:
        fail('%s : dc:title sans « %s »' % (chemin, titre))
    for x in personnes:
        if x not in opf:
            fail('%s : dc:creator/contributor sans « %s »' % (chemin, x))
    if not echecs or chemin not in echecs[-1]:
        ok('%s : couverture, titre, %d personnes' % (chemin, len(personnes)))


def main(dossier):
    buch = lire_yaml(os.path.join(dossier, 'buch.yaml'))
    ref = json.load(open(REFERENCE, encoding='utf-8'))
    nom = os.path.basename(os.path.abspath(dossier))
    out = os.path.join(dossier, 'out')
    lang = str(buch.get('lang') or 'fr')
    personnes = noms(buch.get('auteurs')) + noms(buch.get('editeurs'))

    pdf = os.path.join(out, nom + '.pdf')
    controler_folios(pdf, lang)
    controler_meta_pdf(pdf, buch, personnes)
    controler_couverture(out, nom, buch, ref)
    controler_epub(os.path.join(out, nom + '.epub'), buch, personnes)

    apercus = [f for f in os.listdir(os.path.join(out, 'chapitres'))
               if f.endswith('.pdf')] if os.path.isdir(os.path.join(out, 'chapitres')) else []
    if not apercus:
        fail('%s/chapitres : aucun PDF de chapitre seul' % out)
    for f in apercus:
        controler_folios_chapitre(os.path.join(out, 'chapitres', f))
    return 1 if echecs else 0


def controler_folios_chapitre(chemin):
    r = pypdf.PdfReader(chemin)
    n = len(r.pages)
    for i, p in enumerate(r.pages, 1):
        for m in FOLIO.finditer(p.extract_text() or ''):
            if (int(m.group(1)), int(m.group(2))) != (i, n):
                fail('%s p.%d : folio « %s », attendu %d sur %d' % (chemin, i, m.group(0), i, n))
    if not echecs or chemin not in echecs[-1]:
        ok('%s : %d pages, folios depuis 1' % (chemin, n))


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
