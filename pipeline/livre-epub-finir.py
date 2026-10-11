#!/usr/bin/env python3
# Reprend l'EPUB que pandoc vient d'écrire, en place.
#
#   python3 livre-epub-finir.py <livre.epub>
#
# 1. Le <title> de chaque document du texte est le titre de son premier <h1>, et non le nom
#    du fichier (« ch004.xhtml »).
# 2. Navigation (nav.xhtml, toc.ncx) : les chapitres d'une partie passent dans une
#    sous-liste de la partie. Le <h1> d'un chapitre porte data-partie
#    (livre-epub-prepare.py), le titre d'une partie l'identifiant partie-<N>-titre.
# 3. Repères (nav epub:type="landmarks") : couverture, page de titre, table des matières et
#    début du texte (le premier chapitre), nommés dans la langue du livre.
# 4. Couverture : l'image reçoit un nom accessible, le titre et le sous-titre du livre.
#
# La langue et le titre sont lus dans l'OPF. L'archive est réécrite avec le même ordre
# d'entrées, mimetype en tête et sans compression, comme l'exige EPUB.

import html
import re
import sys
import zipfile

REPERES = {
    'de': {'cover': 'Umschlag', 'titlepage': 'Titelseite', 'toc': 'Inhaltsverzeichnis',
           'bodymatter': 'Textbeginn'},
    'fr': {'cover': 'Couverture', 'titlepage': 'Page de titre', 'toc': 'Sommaire',
           'bodymatter': 'Début du texte'},
    'it': {'cover': 'Copertina', 'titlepage': 'Frontespizio', 'toc': 'Indice',
           'bodymatter': 'Inizio del testo'},
}

RE_BALISE = re.compile(r'<[^>]+>')


def texte_seul(fragment):
    return re.sub(r'\s+', ' ', html.unescape(RE_BALISE.sub('', fragment))).strip()


def lire_opf(opf):
    """(langue, titre, chemins des documents du spine relatifs à l'OPF)."""
    langue = re.search(r'<dc:language>([^<]+)</dc:language>', opf)
    titre = re.search(r'<dc:title\b[^>]*>([^<]*)</dc:title>', opf)
    items = dict(re.findall(r'<item id="([^"]+)" href="([^"]+)"', opf))
    spine = [items[i] for i in re.findall(r'<itemref idref="([^"]+)"', opf) if i in items]
    return ((langue.group(1).strip()[:2] if langue else 'fr'),
            html.unescape(titre.group(1)) if titre else '', spine)


# ---------------------------------------------------------------------------------------
# Listes imbriquées : découpe d'une liste en ses éléments de premier niveau.
# ---------------------------------------------------------------------------------------
def fin_element(texte, debut, nom):
    """Position juste après la balise fermante de l'élément `nom` ouvert à `debut`."""
    profondeur = 0
    for m in re.finditer(r'<(/?)%s\b[^>]*>' % nom, texte[debut:]):
        profondeur += -1 if m.group(1) else 1
        if profondeur == 0:
            return debut + m.end()
    return -1


def elements(texte, nom):
    """Les éléments `nom` de premier niveau de `texte`, dans l'ordre."""
    trouves, i = [], 0
    while True:
        m = re.compile(r'<%s\b' % nom).search(texte, i)
        if not m:
            return trouves
        fin = fin_element(texte, m.start(), nom)
        if fin < 0:
            return trouves
        trouves.append(texte[m.start():fin])
        i = fin


def ranger_sous_parties(entrees, classe, nom, cible, enveloppe):
    """Range les entrées de chapitre sous l'entrée de leur partie. `classe(entrée)` rend
    ('partie', N), ('chapitre', N) ou None ; `enveloppe(enfants)` écrit la sous-liste,
    insérée avant la balise fermante `</nom>` de l'entrée de partie. Si cette entrée finit
    déjà par une sous-liste fermée par `cible`, les enfants y sont ajoutés ; `cible` vide :
    toujours à la fin de l'entrée."""
    sortie, parties = [], {}
    for e in entrees:
        c = classe(e)
        if c and c[0] == 'partie':
            parties[c[1]] = len(sortie)
            sortie.append([e, []])
        elif c and c[0] == 'chapitre' and c[1] in parties:
            sortie[parties[c[1]]][1].append(e)
        else:
            sortie.append([e, []])
    rendu = []
    for e, enfants in sortie:
        if enfants:
            fermeture = '</%s>' % nom
            corps = e[:-len(fermeture)]
            if cible and corps.rstrip().endswith(cible):
                corps = corps.rstrip()[:-len(cible)] + ''.join(enfants) + cible
                e = corps + fermeture
            else:
                e = corps + enveloppe(enfants) + fermeture
        rendu.append(e)
    return rendu


def classer(lien, parties_de):
    """('partie', N), ('chapitre', N) ou None pour le lien d'une entrée de navigation."""
    fichier, _, ancre = lien.partition('#')
    m = re.fullmatch(r'partie-(\d+)-titre', ancre)
    if m:
        return ('partie', m.group(1))
    n = parties_de.get((fichier.rsplit('/', 1)[-1], ancre))
    return ('chapitre', n) if n else None


def nav_par_parties(nav, parties_de):
    m = re.search(r'<nav epub:type="toc"[^>]*>', nav)
    if not m:
        return nav
    debut = nav.index('<ol', m.end())
    fin = fin_element(nav, debut, 'ol')
    ouverture = nav[debut:nav.index('>', debut) + 1]
    interieur = nav[len(ouverture) + debut:fin - len('</ol>')]

    def classe(li):
        lien = re.search(r'<a href="([^"]+)"', li)
        return classer(lien.group(1), parties_de) if lien else None

    lis = ranger_sous_parties(elements(interieur, 'li'), classe, 'li', '</ol>',
                              lambda enfants: '<ol class="toc">' + ''.join(enfants) + '</ol>')
    return nav[:debut] + ouverture + ''.join(lis) + '</ol>' + nav[fin:]


def ncx_par_parties(ncx, parties_de):
    m = re.search(r'<navMap>', ncx)
    if not m:
        return ncx
    fin = ncx.index('</navMap>')
    interieur = ncx[m.end():fin]

    def classe(point):
        lien = re.search(r'<content src="([^"]+)"', point)
        return classer(lien.group(1), parties_de) if lien else None

    points = ranger_sous_parties(elements(interieur, 'navPoint'), classe, 'navPoint',
                                 '', lambda enfants: ''.join(enfants))
    return ncx[:m.end()] + '\n' + '\n'.join(points) + '\n' + ncx[fin:]


def reperes(nav, langue, bodymatter):
    """Point 3 de l'en-tête."""
    noms = REPERES.get(langue, REPERES['fr'])
    m = re.search(r'<nav epub:type="landmarks"[^>]*>[\s\S]*?</nav>', nav)
    if not m:
        return nav
    liens = re.findall(r'<a href="([^"]+)" epub:type="([^"]+)"', m.group(0))
    cibles = dict((t, h) for h, t in liens)
    cibles['toc'] = 'nav.xhtml#toc'
    if bodymatter:
        cibles['bodymatter'] = bodymatter
    lignes = ['<nav epub:type="landmarks" id="landmarks" hidden="hidden">', '  <ol>']
    for type_ in ('cover', 'titlepage', 'toc', 'bodymatter'):
        if type_ in cibles:
            lignes.append('    <li>\n      <a href="%s" epub:type="%s">%s</a>\n    </li>'
                          % (cibles[type_], type_, html.escape(noms[type_])))
    lignes += ['  </ol>', '</nav>']
    return nav[:m.start()] + '\n'.join(lignes) + nav[m.end():]


def couverture(xhtml, langue, titre, sous_titre):
    """Point 4 de l'en-tête : role="img", aria-label et <title> sur le <svg>."""
    separateur = ' : ' if langue == 'fr' else ': '
    nom = REPERES.get(langue, REPERES['fr'])['cover'] + separateur + titre
    if sous_titre:
        nom += '. ' + sous_titre
    nom = html.escape(nom, quote=True)
    return re.sub(r'<svg\b([^>]*)>', lambda m: '<svg%s role="img" aria-label="%s"><title>%s</title>'
                  % (m.group(1), nom, nom), xhtml, count=1)


def finir(chemin):
    with zipfile.ZipFile(chemin) as z:
        infos = z.infolist()
        contenus = {i.filename: z.read(i.filename) for i in infos}
    chemin_opf = next(n for n in contenus if n.endswith('.opf'))
    racine = chemin_opf.rsplit('/', 1)[0] + '/' if '/' in chemin_opf else ''
    opf = contenus[chemin_opf].decode('utf-8')
    langue, titre, spine = lire_opf(opf)
    # Le sous-titre est sur la page de titre que pandoc compose ; l'OPF ne le porte pas.
    sous_titre = ''
    for doc in spine:
        m = re.search(r'<p class="subtitle">([\s\S]*?)</p>',
                      contenus[racine + doc].decode('utf-8'))
        if m:
            sous_titre = texte_seul(m.group(1))
            break

    parties_de, bodymatter = {}, None
    for doc in spine:
        nom = racine + doc
        xhtml = contenus[nom].decode('utf-8')
        fichier = doc.rsplit('/', 1)[-1]
        # Le chapitre : la section que pandoc ouvre autour de son <h1>.
        for m in re.finditer(r'<section id="([^"]+)"[^>]*>\s*<h1\b([^>]*)>', xhtml):
            partie = re.search(r'\bdata-partie="(\d+)"', m.group(2))
            if partie:
                parties_de[(fichier, m.group(1))] = partie.group(1)
            if bodymatter is None and 'data-chapitre=' in m.group(2):
                bodymatter = doc + '#' + m.group(1)
        h1 = re.search(r'<h1\b[^>]*>([\s\S]*?)</h1>', xhtml)
        if h1 and fichier.startswith('ch'):
            xhtml = re.sub(r'<title>[^<]*</title>',
                           '<title>%s</title>' % html.escape(texte_seul(h1.group(1))),
                           xhtml, count=1)
        if fichier == 'cover.xhtml':
            xhtml = couverture(xhtml, langue, titre, sous_titre)
        contenus[nom] = xhtml.encode('utf-8')

    nom_nav = racine + 'nav.xhtml'
    if nom_nav in contenus:
        nav = contenus[nom_nav].decode('utf-8')
        nav = reperes(nav_par_parties(nav, parties_de), langue, bodymatter)
        contenus[nom_nav] = nav.encode('utf-8')
    nom_ncx = racine + 'toc.ncx'
    if nom_ncx in contenus:
        contenus[nom_ncx] = ncx_par_parties(contenus[nom_ncx].decode('utf-8'),
                                            parties_de).encode('utf-8')

    with zipfile.ZipFile(chemin, 'w') as z:
        for info in infos:
            compression = zipfile.ZIP_STORED if info.filename == 'mimetype' else zipfile.ZIP_DEFLATED
            z.writestr(info, contenus[info.filename], compress_type=compression)


def main():
    if len(sys.argv) != 2:
        print('Usage: %s <livre.epub>' % sys.argv[0], file=sys.stderr)
        return 2
    finir(sys.argv[1])
    return 0


if __name__ == '__main__':
    sys.exit(main())
