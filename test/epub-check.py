#!/usr/bin/env python3
# Contrôle la structure d'un EPUB, sans dépendance externe.
#
#   python3 test/epub-check.py <fichier.epub> [<fichier.epub> ...]
#
# pandoc ne valide pas ce qu'il écrit, et epubcheck (Java) n'est pas dans la WSL
# SZH-Publishing. Ce script, en bibliothèque standard (zipfile, xml.etree), ne remplace pas
# epubcheck : il trouve ce qu'un assemblage maison casse sans erreur visible (fichier hors
# manifeste, lien interne sans cible, image absente, chapitre absent du sommaire).
#
# Dix contrôles, dans l'ordre où un échec peut fausser les suivants :
#   1. mimetype — première entrée de l'archive, non compressée, contenu exact.
#   2. META-INF/container.xml -> chemin de l'OPF, résolu dans l'archive.
#   3. manifeste -> archive : chaque item existe réellement.
#   4. archive -> manifeste : chaque fichier de contenu (XHTML/CSS/image/police) est
#      listé dans le manifeste.
#   5. chaque XHTML du manifeste est du XML bien formé.
#   6. dc:title et dc:language sont posés et non vides.
#   7. chaque lien interne (href="#…" ou href="fichier#…") pointe sur un id qui existe
#      réellement, dans le bon fichier ; chaque image référencée (<img src>, url() de
#      style= ou de CSS, hors data:) existe dans l'archive.
#   8. nav.xhtml : chaque document du spine est atteint par au moins un lien de la
#      navigation (table des matières ou repères). Exemple de défaut : un élément placé
#      avant le <h1> d'un chapitre fait sortir à pandoc un XHTML presque vide, que
#      nav.xhtml ne vise pas.
#   9. accessibilité des XHTML : identifiants uniques dans chaque document ; chaque
#      renvoi headers, aria-describedby, aria-labelledby vise un identifiant du même
#      document, et un headers= vise un <th> ; le <title> d'un document n'est pas son nom
#      de fichier ; l'image de couverture a un nom.
#  10. accessibilité de l'OPF et de la navigation : les métadonnées schema:accessMode,
#      accessModeSufficient, accessibilityFeature, accessibilityHazard et
#      accessibilitySummary sont posées ; les repères (landmarks) ne sont pas restés en
#      anglais dans un livre d'une autre langue, et mènent à la table des matières et au
#      début du texte.
#
# Sortie : un bilan par EPUB, code de sortie 1 au premier défaut (tous les EPUB
# passés en argument sont quand même contrôlés jusqu'au bout).

import sys
import re
import zipfile
import xml.etree.ElementTree as ET
import posixpath

try:
    sys.stdout.reconfigure(encoding='utf-8')
except (AttributeError, OSError):
    pass

EXTENSIONS_CONTENU = ('.xhtml', '.html', '.css', '.png', '.jpg', '.jpeg', '.gif',
                      '.svg', '.otf', '.ttf', '.woff', '.woff2', '.ncx')
EXTENSIONS_IMAGE = ('.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp')


def _sans_ns(tag):
    """'{http://…}nom' -> 'nom' : les fichiers mêlent plusieurs espaces de noms (OPF,
    XHTML, epub:), on ne compare que le nom local."""
    return tag.rsplit('}', 1)[-1]


def _resoudre(base_dir, href):
    """Chemin d'un href dans l'archive. Un href d'EPUB est un chemin relatif POSIX, même
    sous Windows ; posixpath.normpath résout les « ../ »."""
    href = href.split('#', 1)[0]
    if not href:
        return None
    chemin = posixpath.normpath(posixpath.join(base_dir, href))
    return chemin


def _lien_externe(href):
    return bool(re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', href)) and not href.startswith('#')


class Rapport:
    def __init__(self, nom):
        self.nom = nom
        self.defauts = []
        self.infos = []

    def defaut(self, message):
        self.defauts.append(message)

    def info(self, message):
        self.infos.append(message)

    def ok(self):
        return not self.defauts


def verifier_mimetype(zf, noms, rapport):
    if not noms or noms[0] != 'mimetype':
        rapport.defaut('mimetype n\'est pas la première entrée de l\'archive '
                        '(trouvé en premier : %r)' % (noms[0] if noms else None))
        return
    info = zf.getinfo('mimetype')
    if info.compress_type != zipfile.ZIP_STORED:
        rapport.defaut('mimetype est compressé (compress_type=%r) — doit être stocké '
                        'tel quel' % info.compress_type)
    contenu = zf.read('mimetype')
    if contenu != b'application/epub+zip':
        rapport.defaut('mimetype porte %r au lieu de b\'application/epub+zip\'' % contenu)
    else:
        rapport.info('mimetype : première entrée, non compressée, contenu exact.')


def lire_container(zf, noms, rapport):
    chemin_container = 'META-INF/container.xml'
    if chemin_container not in noms:
        rapport.defaut('%s introuvable' % chemin_container)
        return None
    try:
        racine = ET.fromstring(zf.read(chemin_container))
    except ET.ParseError as e:
        rapport.defaut('%s n\'est pas du XML bien formé : %s' % (chemin_container, e))
        return None
    for rootfile in racine.iter():
        if _sans_ns(rootfile.tag) == 'rootfile':
            chemin_opf = rootfile.get('full-path')
            if chemin_opf and chemin_opf in noms:
                rapport.info('container.xml -> %s' % chemin_opf)
                return chemin_opf
            rapport.defaut('container.xml désigne %r, introuvable dans l\'archive'
                            % chemin_opf)
            return None
    rapport.defaut('%s ne porte aucun <rootfile full-path="…">' % chemin_container)
    return None


def lire_opf(zf, chemin_opf, rapport):
    try:
        racine = ET.fromstring(zf.read(chemin_opf))
    except ET.ParseError as e:
        rapport.defaut('%s n\'est pas du XML bien formé : %s' % (chemin_opf, e))
        return None
    for e in racine.iter():
        e.tag = _sans_ns(e.tag)
    return racine


def manifeste(opf_racine, dossier_opf):
    """{id: {'href': chemin résolu dans l'archive, 'properties': [...]}}"""
    items = {}
    manifest_el = opf_racine.find('manifest')
    if manifest_el is None:
        return items
    for item in manifest_el.findall('item'):
        href = item.get('href')
        if not href:
            continue
        items[item.get('id')] = {
            'href': _resoudre(dossier_opf, href),
            'href_brut': href,
            'properties': (item.get('properties') or '').split(),
            'media-type': item.get('media-type'),
        }
    return items


def verifier_manifeste_archive(items, noms, rapport):
    ensemble_noms = set(noms)
    for item_id, info in items.items():
        if info['href'] not in ensemble_noms:
            rapport.defaut('manifest#%s référence %s, absent de l\'archive'
                            % (item_id, info['href_brut']))


def verifier_archive_manifeste(items, noms, chemin_opf, rapport):
    hrefs_connus = {info['href'] for info in items.values()}
    for nom in noms:
        if nom == 'mimetype' or nom.startswith('META-INF/') or nom == chemin_opf:
            continue  # l'OPF ne s'auto-référence jamais dans son propre manifeste
        if nom.lower().endswith(EXTENSIONS_CONTENU) and nom not in hrefs_connus:
            rapport.defaut('%s existe dans l\'archive mais n\'est référencé par aucun '
                            'item du manifeste' % nom)


def verifier_metadonnees(opf_racine, rapport):
    meta = opf_racine.find('metadata')
    titre = lang = None
    if meta is not None:
        t = meta.find('title')
        if t is not None and (t.text or '').strip():
            titre = t.text.strip()
        l = meta.find('language')
        if l is not None and (l.text or '').strip():
            lang = l.text.strip()
    if not titre:
        rapport.defaut('dc:title absent ou vide')
    if not lang:
        rapport.defaut('dc:language absent ou vide')
    if titre and lang:
        rapport.info('métadonnées : titre=%r, langue=%r' % (titre, lang))
    identifiants = [ (e.text or '').strip() for e in (meta.findall('identifier') if meta is not None else []) ]
    identifiants = [i for i in identifiants if i]
    if not identifiants:
        rapport.defaut('aucun dc:identifier non vide')
    else:
        rapport.info('identifiant(s) : %s' % ', '.join(identifiants))


RE_ID_ATTR = re.compile(r'\bid\b')


def _tous_les_ids(racine_xhtml):
    return {el.get('id') for el in racine_xhtml.iter() if el.get('id')}


def _hrefs_et_srcs(racine_xhtml):
    """[(élément, attribut, valeur)] pour chaque attribut de lien/ressource qui compte."""
    resultat = []
    for el in racine_xhtml.iter():
        tag = el.tag
        for attr in ('href', 'src'):
            v = el.get(attr)
            if v:
                resultat.append((tag, attr, v))
        style = el.get('style')
        if style:
            for m in re.finditer(r'url\(([^)]+)\)', style):
                resultat.append((tag, 'style:url()', m.group(1).strip('\'"')))
    return resultat


def verifier_xhtml_et_liens(zf, items, noms, rapport):
    """Points 5 (XML bien formé) et 7 (liens internes et images). Rend {chemin: ids} pour
    les XHTML lisibles."""
    xhtml_items = {info['href']: info for info in items.values()
                   if (info['media-type'] or '').endswith('xhtml+xml')}
    ids_par_fichier = {}
    racines = {}
    for chemin in xhtml_items:
        try:
            contenu = zf.read(chemin)
        except KeyError:
            continue  # déjà signalé par verifier_manifeste_archive
        try:
            racine = ET.fromstring(contenu)
        except ET.ParseError as e:
            rapport.defaut('%s n\'est pas du XML bien formé : %s' % (chemin, e))
            continue
        for el in racine.iter():
            el.tag = _sans_ns(el.tag)
        racines[chemin] = racine
        ids_par_fichier[chemin] = _tous_les_ids(racine)

    ensemble_noms = set(noms)
    for chemin, racine in racines.items():
        dossier = posixpath.dirname(chemin)
        for tag, attr, valeur in _hrefs_et_srcs(racine):
            if not valeur or valeur.startswith('data:') or _lien_externe(valeur):
                continue
            fichier_cible, _, ancre = valeur.partition('#')
            if fichier_cible == '':
                cible = chemin
            else:
                cible = _resoudre(dossier, fichier_cible)
            if attr in ('src', 'style:url()') or tag == 'link':
                # Ressource (image, police, feuille) : doit exister dans l'archive.
                if cible not in ensemble_noms:
                    rapport.defaut('%s : %s="%s" introuvable dans l\'archive'
                                   % (chemin, attr, valeur))
                continue
            # href de <a> : lien interne à vérifier (fichier + ancre éventuelle).
            if cible not in ensemble_noms and cible not in racines and cible != chemin:
                rapport.defaut('%s : href="%s" pointe sur un fichier absent de l\'archive'
                               % (chemin, valeur))
                continue
            if ancre:
                ids_cible = ids_par_fichier.get(cible if fichier_cible else chemin)
                if ids_cible is None and cible in xhtml_items:
                    # Cible absente ou mal formée, déjà signalée : toute ancre y manque.
                    ids_cible = set()
                if ids_cible is not None and ancre not in ids_cible:
                    rapport.defaut('%s : href="%s" — ancre "#%s" introuvable dans %s'
                                   % (chemin, valeur, ancre, cible if fichier_cible else chemin))
    if racines:
        rapport.info('%d document(s) XHTML bien formés, liens et images vérifiés.'
                     % len(racines))
    return ids_par_fichier


def verifier_navigation(zf, opf_racine, items, rapport):
    """Point 8 : chaque document du spine est atteint par au moins un lien de nav.xhtml
    (table des matières ou repères)."""
    nav_item = None
    for info in items.values():
        if 'nav' in info['properties']:
            nav_item = info
            break
    if nav_item is None:
        rapport.defaut('aucun item de manifeste ne porte properties="nav"')
        return
    try:
        contenu_nav = zf.read(nav_item['href'])
    except KeyError:
        rapport.defaut('%s (nav) introuvable dans l\'archive' % nav_item['href'])
        return
    try:
        racine_nav = ET.fromstring(contenu_nav)
    except ET.ParseError as e:
        rapport.defaut('%s (nav) n\'est pas du XML bien formé : %s' % (nav_item['href'], e))
        return
    for el in racine_nav.iter():
        el.tag = _sans_ns(el.tag)
    dossier_nav = posixpath.dirname(nav_item['href'])
    cibles_nav = set()
    for a in racine_nav.iter('a'):
        href = a.get('href')
        if not href or _lien_externe(href):
            continue
        fichier_cible = href.split('#', 1)[0]
        if fichier_cible:
            cibles_nav.add(_resoudre(dossier_nav, fichier_cible))

    spine_el = opf_racine.find('spine')
    if spine_el is None:
        rapport.defaut('aucun <spine> dans l\'OPF')
        return
    manquants = []
    total = 0
    for itemref in spine_el.findall('itemref'):
        idref = itemref.get('idref')
        info = items.get(idref)
        if info is None:
            rapport.defaut('spine : itemref idref="%s" ne correspond à aucun item du '
                            'manifeste' % idref)
            continue
        total += 1
        if info['href'] not in cibles_nav:
            manquants.append(info['href'])
    if manquants:
        rapport.defaut('document(s) du spine absents de la navigation (nav.xhtml) : %s'
                       % ', '.join(manquants))
    else:
        rapport.info('navigation : %d/%d document(s) du spine atteints par un lien de '
                     'nav.xhtml (%d lien(s) au total).' % (total, total, len(cibles_nav)))


ATTRIBUTS_IDREFS = ('headers', 'aria-describedby', 'aria-labelledby')
EPUB_TYPE = '{http://www.idpf.org/2007/ops}type'


def verifier_accessibilite_xhtml(zf, items, opf_racine, rapport):
    """Point 9."""
    spine = set()
    spine_el = opf_racine.find('spine')
    for itemref in (spine_el.findall('itemref') if spine_el is not None else []):
        if itemref.get('idref') in items:
            spine.add(items[itemref.get('idref')]['href'])
    renvois = 0
    for info in items.values():
        if not (info['media-type'] or '').endswith('xhtml+xml'):
            continue
        chemin = info['href']
        try:
            racine = ET.fromstring(zf.read(chemin))
        except (KeyError, ET.ParseError):
            continue  # déjà signalé
        for el in racine.iter():
            el.tag = _sans_ns(el.tag)
        par_id = {}
        for el in racine.iter():
            ident = el.get('id')
            if ident:
                if ident in par_id:
                    rapport.defaut('%s : id="%s" en double' % (chemin, ident))
                par_id[ident] = el
        for el in racine.iter():
            for attr in ATTRIBUTS_IDREFS:
                for ident in (el.get(attr) or '').split():
                    renvois += 1
                    cible = par_id.get(ident)
                    if cible is None:
                        rapport.defaut('%s : <%s %s> vise "%s", absent du document'
                                       % (chemin, el.tag, attr, ident))
                    elif attr == 'headers' and cible.tag != 'th':
                        rapport.defaut('%s : <%s headers> vise "%s", un <%s> et non un <th>'
                                       % (chemin, el.tag, ident, cible.tag))
        titre = racine.find('head/title')
        nom_fichier = posixpath.basename(chemin)
        if chemin in spine and titre is not None and (titre.text or '').strip() == nom_fichier:
            rapport.defaut('%s : <title> est le nom du fichier' % chemin)
        if 'svg' in info['properties'] or nom_fichier.startswith('cover'):
            for el in racine.iter():
                if el.tag == 'svg' and not (el.get('aria-label') or el.find('title') is not None):
                    rapport.defaut('%s : image de couverture <svg> sans nom accessible' % chemin)
                if el.tag == 'img' and el.get('alt') is None:
                    rapport.defaut('%s : image de couverture <img> sans alt' % chemin)
    rapport.info('accessibilité des XHTML : identifiants uniques, %d renvoi(s) résolu(s), '
                 'titres des documents.' % renvois)


PROPRIETES_ACCESSIBILITE = ('schema:accessMode', 'schema:accessModeSufficient',
                            'schema:accessibilityFeature', 'schema:accessibilityHazard',
                            'schema:accessibilitySummary')
REPERES_ANGLAIS = ('Title Page', 'Cover', 'Table of Contents', 'Start')


def verifier_accessibilite_opf(zf, opf_racine, items, rapport):
    """Point 10."""
    meta = opf_racine.find('metadata')
    poses = {m.get('property') for m in (meta.findall('meta') if meta is not None else [])
             if (m.text or '').strip()}
    manquantes = [p for p in PROPRIETES_ACCESSIBILITE if p not in poses]
    if manquantes:
        rapport.defaut('OPF : métadonnées d\'accessibilité absentes : %s' % ', '.join(manquantes))
    langue = ''
    if meta is not None and meta.find('language') is not None:
        langue = (meta.find('language').text or '').strip()
    nav_item = next((i for i in items.values() if 'nav' in i['properties']), None)
    if nav_item is None:
        return
    try:
        racine_nav = ET.fromstring(zf.read(nav_item['href']))
    except (KeyError, ET.ParseError):
        return
    types = set()
    for nav in racine_nav.iter('{http://www.w3.org/1999/xhtml}nav'):
        if nav.get(EPUB_TYPE) != 'landmarks':
            continue
        for a in nav.iter('{http://www.w3.org/1999/xhtml}a'):
            types.add(a.get(EPUB_TYPE))
            libelle = (a.text or '').strip()
            if not langue.startswith('en') and libelle in REPERES_ANGLAIS:
                rapport.defaut('nav.xhtml : repère « %s » en anglais dans un livre en %s'
                               % (libelle, langue))
    for type_ in ('toc', 'bodymatter'):
        if type_ not in types:
            rapport.defaut('nav.xhtml : aucun repère epub:type="%s"' % type_)
    if not manquantes:
        rapport.info('OPF : métadonnées d\'accessibilité posées ; repères : %s.'
                     % ', '.join(sorted(t for t in types if t)))


def controler_epub(chemin_epub):
    rapport = Rapport(chemin_epub)
    try:
        zf = zipfile.ZipFile(chemin_epub, 'r')
    except (OSError, zipfile.BadZipFile) as e:
        rapport.defaut('archive illisible : %s' % e)
        return rapport
    with zf:
        noms = zf.namelist()
        verifier_mimetype(zf, noms, rapport)
        chemin_opf = lire_container(zf, noms, rapport)
        if chemin_opf is None:
            return rapport
        opf_racine = lire_opf(zf, chemin_opf, rapport)
        if opf_racine is None:
            return rapport
        dossier_opf = posixpath.dirname(chemin_opf)
        items = manifeste(opf_racine, dossier_opf)
        if not items:
            rapport.defaut('manifest vide ou introuvable dans %s' % chemin_opf)
            return rapport
        verifier_manifeste_archive(items, noms, rapport)
        verifier_archive_manifeste(items, noms, chemin_opf, rapport)
        verifier_metadonnees(opf_racine, rapport)
        verifier_xhtml_et_liens(zf, items, noms, rapport)
        verifier_navigation(zf, opf_racine, items, rapport)
        verifier_accessibilite_xhtml(zf, items, opf_racine, rapport)
        verifier_accessibilite_opf(zf, opf_racine, items, rapport)
    return rapport


def main(argv):
    if len(argv) < 2:
        print('Usage: %s <fichier.epub> [<fichier.epub> ...]' % argv[0], file=sys.stderr)
        return 1
    code = 0
    for chemin in argv[1:]:
        rapport = controler_epub(chemin)
        print('=== %s ===' % rapport.nom)
        for ligne in rapport.infos:
            print('  ok   | %s' % ligne)
        for ligne in rapport.defauts:
            print('  ÉCHEC | %s' % ligne)
        if rapport.ok():
            print('  -> conforme (%d contrôle(s) passés).' % len(rapport.infos))
        else:
            print('  -> %d défaut(s).' % len(rapport.defauts))
            code = 1
    return code


if __name__ == '__main__':
    sys.exit(main(sys.argv))
