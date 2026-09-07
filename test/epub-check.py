#!/usr/bin/env python3
# epub-check.py — contrôle structurel d'un EPUB, sans dépendance externe.
#
#   python3 test/epub-check.py <fichier.epub> [<fichier.epub> ...]
#
# pandoc ne valide pas ce qu'il écrit, et epubcheck (Java) n'est pas dans la distro
# SZH-Publishing : ce script tient donc lieu de porte, en Python 3 stdlib seul
# (zipfile + xml.etree). Il ne remplace pas epubcheck — il attrape ce qu'un assemblage
# maison peut casser en silence : un fichier orphelin du manifeste, un lien interne qui
# ne mène nulle part, une image qui n'existe pas, un chapitre absent du sommaire.
#
# Huit contrôles, dans l'ordre où ils peuvent faire tomber les suivants :
#   1. mimetype — première entrée de l'archive, non compressée, contenu exact.
#   2. META-INF/container.xml -> chemin de l'OPF, résolu dans l'archive.
#   3. manifeste -> archive : chaque item existe réellement.
#   4. archive -> manifeste : chaque fichier de contenu (XHTML/CSS/image/police) est
#      listé dans le manifeste — un fichier orphelin ne sert à rien et gonfle l'EPUB.
#   5. chaque XHTML du manifeste est du XML bien formé.
#   6. dc:title et dc:language sont posés et non vides.
#   7. chaque lien interne (href="#…" ou href="fichier#…") pointe sur un id qui existe
#      réellement, dans le bon fichier ; chaque image référencée (<img src>, url() de
#      style= ou de CSS, hors data:) existe dans l'archive.
#   8. nav.xhtml : chaque document du spine est atteint par au moins un lien de la
#      navigation (table des matières ou repères) — un chapitre absent du sommaire ne
#      casse rien à l'ouverture, seul un lecteur qui tourne les pages une à une le
#      découvre. C'est ainsi qu'un défaut réel s'est trouvé sur ce banc : le <div>
#      d'onglet de tranche, laissé avant le <h1> de chaque chapitre, faisait sortir à
#      pandoc un fichier XHTML quasi vide qu'aucun lien de nav.xhtml ne visait.
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
    """'{http://…}nom' -> 'nom' : les fichiers mêlent OPF, XHTML, epub: — un seul nom
    local par balise évite de tenir trois jeux de namespaces à jour."""
    return tag.rsplit('}', 1)[-1]


def _resoudre(base_dir, href):
    """Un href d'EPUB est toujours un chemin relatif POSIX (même sous Windows, l'archive
    est un zip) ; posixpath.normpath résout les « ../ » sans toucher au système de
    fichiers réel."""
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
    """Point 5 (bien formé), 6 fait à part, 7 (liens internes + images). Retourne
    {chemin: ensemble des ids} pour les fichiers XHTML valides, réutilisé par le
    contrôle de navigation (point 8)."""
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
                    # cible pas encore lue plus haut (ne devrait pas arriver, tous les
                    # xhtml_items sont parcourus) — repli défensif, pas un vrai cas.
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
    (table des matières ou repères) — sans quoi un chapitre entier peut manquer le
    sommaire sans qu'aucune erreur ne le montre (voir l'en-tête du fichier)."""
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
