#!/usr/bin/env python3
# Prépare le HTML du livre pour la conversion EPUB.
#
#   python3 livre-epub-prepare.py <html-in> <html-out>
#
# Les identifiants posés par chapitre sont déjà préfixés par le slug du chapitre, à
# l'assemblage (prefixer_identifiants() de livre-assembler.py).
#
# 1. Images décoratives : le <style> que szh-numerotation.lua écrit en fin de chapitre
#    (style_decors()) devient des attributs style=. En epub3, pandoc déplace ce <style>
#    dans le <head> mais le vide, et l'image disparaît. Les classes szh-decor-N n'étant pas
#    propres au chapitre, la correction se fait section par section.
#
# 2. Retrait des <div class="szh-onglet">, "szh-pastille" et "szh-picto-entete" que le
#    gabarit place avant le <h1> (epub.css les masque déjà). Avec --split-level=1, pandoc
#    range tout ce qui précède un <h1> dans le fichier précédent : ces <div> créeraient un
#    fichier quasi vide et, pour la pastille, un numéro lisible dans le mauvais chapitre.
#    Pour la même raison, une ligne d'auteurs placée au-dessus du titre
#    (`auteurs-chapitre: dessus`) passe juste après le <h1>.
#
# 3. Le <h1> d'un chapitre reçoit data-chapitre (son slug) et, dans une partie,
#    data-partie, que la section du chapitre portait : livre-epub-finir.py s'en sert pour
#    ranger le chapitre sous sa partie dans la navigation et pour trouver le début du
#    texte.
#
# 4. Tableaux : chaque <div class="szh-tableau-boite"> (tableau, note, description longue)
#    devient un <div data-szh-brut="…"> qui porte son XHTML. Relu par pandoc --from=html,
#    un tableau complexe perdrait ses en-têtes de rangée (<th> devenus <td>), et la note son
#    identifiant. szh-livre-epub-brut.lua le rend tel quel dans l'EPUB. Un tableau qui
#    contient une image reste confié à pandoc, qui extrait l'image dans l'archive.
#
# 5. Retrait des enveloppes <section class="szh-chapitre"> (et "szh-partie") : les <h1>
#    passent au niveau racine, où pandoc découpe (--split-level=1). Le reste est inchangé.

import html as html_mod
import re
import sys
from html.entities import name2codepoint

# Une <section class="szh-chapitre">…</section> complète, jusqu'au premier </section>.
RE_CHAPITRE = re.compile(r'<section[^>]*class="szh-chapitre"[^>]*>(?:[\s\S])*?</section>')
RE_CHAPITRE_ID = re.compile(r'id="ch-([^"]+)"')


def _segments(html):
    """Découpe html en segments (est_chapitre, slug, texte) : une section de chapitre
    complète (slug tiré de id="ch-<slug>", ou None), ou le texte entre deux chapitres.
    Les textes mis bout à bout redonnent html."""
    segments = []
    fin = 0
    for m in RE_CHAPITRE.finditer(html):
        if m.start() > fin:
            segments.append((False, None, html[fin:m.start()]))
        slug_m = RE_CHAPITRE_ID.search(m.group(0))
        segments.append((True, slug_m.group(1) if slug_m else None, m.group(0)))
        fin = m.end()
    if fin < len(html):
        segments.append((False, None, html[fin:]))
    return segments


# Le <style> unique qu'ajoute style_decors() en fin de chapitre.
RE_STYLE_BLOCK = re.compile(r'<style>\s*([\s\S]*?)\s*</style>')
# Deux règles par classe .szh-decor-N : la boîte, puis le fond du <span> interne. Format
# écrit par style_decors() (szh-numerotation.lua), sans accolade imbriquée.
RE_REGLE_DECOR = re.compile(r'\.([\w-]+)\{([^{}]*)\}\s*\.\1>span\{([^{}]*)\}')


def _inliner_decors_du_chapitre(texte):
    """Point 1 de l'en-tête, sur le texte d'une seule section de chapitre. Sans <style>
    ni règle reconnue, le texte est rendu inchangé."""
    style_m = RE_STYLE_BLOCK.search(texte)
    if not style_m:
        return texte
    regles = style_m.group(1)
    consomme = False
    for classe, decl_boite, decl_fond in RE_REGLE_DECOR.findall(regles):
        motif_span = re.compile(
            r'(<span class="szh-decor ' + re.escape(classe) + r'"[^>]*>)'
            r'(<span)(></span>)(</span>)'
        )

        def poser(m, decl_boite=decl_boite, decl_fond=decl_fond):
            ouverture = m.group(1)[:-1] + ' style="' + decl_boite.strip() + '">'
            span_interne = m.group(2) + ' style="' + decl_fond.strip() + '"'
            return ouverture + span_interne + m.group(3) + m.group(4)

        texte, n = motif_span.subn(poser, texte, count=1)
        consomme = consomme or n > 0
    if not consomme:
        return texte
    # Le <style> est remplacé par les attributs posés ci-dessus.
    return RE_STYLE_BLOCK.sub('', texte, count=1)


def inliner_decors(html):
    def traiter(est_chapitre, slug, texte):
        return _inliner_decors_du_chapitre(texte) if est_chapitre else texte

    return ''.join(traiter(e, s, t) for e, s, t in _segments(html))


# Les <div> que le gabarit de chapitre (templates/szh-livre-chapitre.html) écrit avant
# $body$, dans cette forme exacte. La pastille contient un numéro, ou rien pour un
# chapitre hors sommaire.
RE_ONGLET = re.compile(r'<div class="szh-onglet" aria-hidden="true"></div>\s*')
RE_PASTILLE = re.compile(r'<div class="szh-pastille" aria-hidden="true">[^<]*</div>\s*')
# Le picto d'en-tête. Vide, --embed-resources l'écrit `data-picto` sans valeur.
RE_PICTO = re.compile(r'<div class="szh-picto-entete" data-picto(?:="[^"]*")? aria-hidden="true"></div>\s*')


def retirer_onglets(html):
    """Point 2 de l'en-tête : retire onglets, pastilles et pictos d'en-tête."""
    html = RE_ONGLET.sub('', html)
    html = RE_PASTILLE.sub('', html)
    html = RE_PICTO.sub('', html)
    return html


# La ligne d'auteurs d'un chapitre (szh-livre-auteurs.lua, ou bloc venu de l'import), suivie
# du titre quand elle est placée au-dessus (`auteurs-chapitre: dessus`).
RE_AUTEURS_AVANT_TITRE = re.compile(
    r'(<(p|div)\b[^>]*\bclass="szh-auteurs"[^>]*>[\s\S]*?</\2>\s*)(<h1\b[\s\S]*?</h1>\s*)')


def auteurs_apres_titre(html):
    """Point 2 de l'en-tête : place la ligne d'auteurs juste après le <h1>."""
    def traiter(est_chapitre, slug, texte):
        if not est_chapitre:
            return texte
        return RE_AUTEURS_AVANT_TITRE.sub(lambda m: m.group(3) + m.group(1), texte, count=1)

    return ''.join(traiter(e, s, t) for e, s, t in _segments(html))


RE_DATA_PARTIE = re.compile(r'<section\b[^>]*\bdata-partie="(\d+)"')


def partie_sur_le_titre(html):
    """Point 3 de l'en-tête : le premier <h1> d'un chapitre reçoit data-chapitre (le slug)
    et, dans une partie, data-partie."""
    def traiter(est_chapitre, slug, texte):
        if not (est_chapitre and slug):
            return texte
        m = RE_DATA_PARTIE.match(texte)
        attributs = ' data-chapitre="%s"' % html_mod.escape(slug, quote=True)
        if m:
            attributs += ' data-partie="%s"' % m.group(1)
        return re.sub(r'<h1\b', '<h1' + attributs, texte, count=1)

    return ''.join(traiter(e, s, t) for e, s, t in _segments(html))


# --------------------------------------------------------------------------------------
# Point 4 : les tableaux, protégés de la relecture par pandoc.
# --------------------------------------------------------------------------------------
RE_OUVERTURE_BOITE = re.compile(r'<div class="szh-tableau-boite"[^>]*>')
RE_DIV = re.compile(r'<(/?)div\b[^>]*>', re.I)
ELEMENTS_VIDES = {'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta',
                  'param', 'source', 'track', 'wbr'}
# Une balise ; une valeur entre guillemets peut contenir « > ».
RE_BALISE = re.compile(r'<(/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|\'[^\']*\'|[^\'"<>])*)>')
RE_ATTRIBUT = re.compile(r'([^\s=/>]+)(?:\s*=\s*("[^"]*"|\'[^\']*\'|[^\s>]+))?')
RE_ENTITE = re.compile(r'&([a-zA-Z][a-zA-Z0-9]*);')
ENTITES_XML = {'amp', 'lt', 'gt', 'quot', 'apos'}


def fin_du_div(html, debut):
    """Position juste après le </div> qui ferme le <div> ouvert à `debut`, ou -1."""
    profondeur = 0
    for m in RE_DIV.finditer(html, debut):
        profondeur += -1 if m.group(1) else 1
        if profondeur == 0:
            return m.end()
    return -1


def _ident_xml(valeur):
    """Un identifiant qui commence par un chiffre n'est pas un nom XML : pandoc le préfixe
    par « id_ » dans l'EPUB. Même règle ici, pour que les renvois restent justes."""
    return 'id_' + valeur if valeur[:1].isdigit() else valeur


def _attribut_xhtml(nom, brut):
    if brut is None:
        return '%s="%s"' % (nom, nom)
    valeur = brut[1:-1] if brut[:1] in '"\'' else brut
    valeur = html_mod.unescape(valeur)
    if nom == 'id':
        valeur = _ident_xml(valeur)
    elif nom in ('headers', 'aria-describedby', 'aria-labelledby'):
        valeur = ' '.join(_ident_xml(v) for v in valeur.split())
    elif nom == 'href' and valeur.startswith('#'):
        valeur = '#' + _ident_xml(valeur[1:])
    return '%s="%s"' % (nom, html_mod.escape(valeur, quote=True))


def en_xhtml(fragment):
    """Le fragment HTML en XHTML bien formé : éléments vides fermés, attributs entre
    guillemets, entités nommées remplacées par leur caractère (sauf celles de XML)."""
    def balise(m):
        fermante, nom, attrs = m.group(1), m.group(2), m.group(3) or ''
        if fermante:
            return '</%s>' % nom
        auto = attrs.rstrip().endswith('/')
        if auto:
            attrs = attrs.rstrip()[:-1]
        rendus = [_attribut_xhtml(a.group(1), a.group(2)) for a in RE_ATTRIBUT.finditer(attrs)]
        ouverture = '<' + nom + ''.join(' ' + r for r in rendus)
        return ouverture + (' />' if auto or nom.lower() in ELEMENTS_VIDES else '>')

    def entite(m):
        nom = m.group(1)
        if nom in ENTITES_XML or nom not in name2codepoint:
            return m.group(0)
        return chr(name2codepoint[nom])

    xhtml = RE_BALISE.sub(balise, fragment)
    # Une balise fermante d'élément vide, écrite par certains HTML, est en trop.
    xhtml = re.sub(r'</(?:%s)>' % '|'.join(ELEMENTS_VIDES), '', xhtml)
    return RE_ENTITE.sub(entite, xhtml)


def proteger_tableaux(html):
    """Point 4 de l'en-tête."""
    morceaux, fin = [], 0
    for m in RE_OUVERTURE_BOITE.finditer(html):
        if m.start() < fin:
            continue
        bout = fin_du_div(html, m.start())
        if bout < 0:
            break
        bloc = html[m.start():bout]
        if '<img' in bloc:
            continue
        morceaux.append(html[fin:m.start()])
        morceaux.append('<div data-szh-brut="%s"></div>'
                        % html_mod.escape(en_xhtml(bloc), quote=True))
        fin = bout
    morceaux.append(html[fin:])
    return ''.join(morceaux)


def prepare_for_epub(html_content):
    """Applique les points 1 à 5 de l'en-tête."""
    html_content = inliner_decors(html_content)
    html_content = retirer_onglets(html_content)
    html_content = auteurs_apres_titre(html_content)
    html_content = partie_sur_le_titre(html_content)
    html_content = proteger_tableaux(html_content)

    # Chaque section de chapitre est remplacée par son contenu (attributs quelconques).
    pattern = r'<section[^>]*class="szh-chapitre"[^>]*>((?:[\s\S])*?)</section>'
    result = re.sub(pattern, r'\1', html_content)
    # Section d'une partie (maquette normal), au même niveau que les chapitres : son <h1>
    # devient aussi un point de découpe.
    result = re.sub(r'<section[^>]*class="szh-partie"[^>]*>((?:[\s\S])*?)</section>', r'\1', result)

    return result


def main():
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <html-in> <html-out>", file=sys.stderr)
        sys.exit(1)

    html_in = sys.argv[1]
    html_out = sys.argv[2]

    try:
        with open(html_in, 'r', encoding='utf-8') as f:
            html_content = f.read()
    except OSError as e:
        print(f"Erreur lecture {html_in}: {e}", file=sys.stderr)
        sys.exit(1)

    prepared = prepare_for_epub(html_content)

    try:
        with open(html_out, 'w', encoding='utf-8') as f:
            f.write(prepared)
    except OSError as e:
        print(f"Erreur écriture {html_out}: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == '__main__':
    main()
