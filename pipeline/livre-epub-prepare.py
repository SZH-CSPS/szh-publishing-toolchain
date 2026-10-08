#!/usr/bin/env python3
# Prépare le HTML du livre pour la conversion EPUB.
#
#   python3 livre-epub-prepare.py <html-in> <html-out>
#
# Les trois premières passes s'appliquent tant que les <section class="szh-chapitre">
# bornent encore chaque chapitre : szh-numerotation.lua numérote par appel de pandoc, donc
# chaque chapitre recommence à 1.
#
# 1. Identifiants de description longue de tableau (id="szh-tabelle-desc-N") : préfixés
#    par le slug du chapitre. Sinon, une fois les chapitres réunis par livre-assembler.py,
#    deux tableaux auraient le même id, invalide en XHTML, et l'aria-describedby du second
#    serait ambigu.
#
# 2. Images décoratives : le <style> que szh-numerotation.lua écrit en fin de chapitre
#    (style_decors()) devient des attributs style=. En epub3, pandoc déplace ce <style>
#    dans le <head> mais le vide, et l'image disparaît. Les classes szh-decor-N n'étant pas
#    propres au chapitre, la correction se fait section par section.
#
# 3. Retrait des <div class="szh-onglet">, "szh-pastille" et "szh-picto-entete" que le
#    gabarit place avant le <h1> (epub.css les masque déjà). Avec --split-level=1, pandoc
#    range tout ce qui précède un <h1> dans le fichier précédent : ces <div> créeraient un
#    fichier quasi vide et, pour la pastille, un numéro lisible dans le mauvais chapitre.
#    Pour la même raison, une ligne d'auteurs placée au-dessus du titre
#    (`auteurs-chapitre: dessus`) passe juste après le <h1>.
#
# 4. Retrait des enveloppes <section class="szh-chapitre"> (et "szh-partie") : les <h1>
#    passent au niveau racine, où pandoc découpe (--split-level=1). Le reste est inchangé.

import sys
import re

# Une <section class="szh-chapitre">…</section> complète, jusqu'au premier </section> : un
# chapitre ne contient pas de <section> (la chaîne n'utilise pas --section-divs).
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


def dedoublonner_desc_tableaux(html):
    """Point 1 de l'en-tête. Un chapitre sans id="ch-…" reste inchangé."""
    def traiter(est_chapitre, slug, texte):
        if est_chapitre and slug:
            return re.sub(r'szh-tabelle-desc-(\d+)',
                           'szh-tabelle-desc-' + slug + r'-\1', texte)
        return texte

    return ''.join(traiter(e, s, t) for e, s, t in _segments(html))


# Le <style> unique qu'ajoute style_decors() en fin de chapitre.
RE_STYLE_BLOCK = re.compile(r'<style>\s*([\s\S]*?)\s*</style>')
# Deux règles par classe .szh-decor-N : la boîte, puis le fond du <span> interne. Format
# écrit par style_decors() (szh-numerotation.lua), sans accolade imbriquée.
RE_REGLE_DECOR = re.compile(r'\.([\w-]+)\{([^{}]*)\}\s*\.\1>span\{([^{}]*)\}')


def _inliner_decors_du_chapitre(texte):
    """Point 2 de l'en-tête, sur le texte d'une seule section de chapitre. Sans <style>
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
    """Point 3 de l'en-tête : retire onglets, pastilles et pictos d'en-tête."""
    html = RE_ONGLET.sub('', html)
    html = RE_PASTILLE.sub('', html)
    html = RE_PICTO.sub('', html)
    return html


# La ligne d'auteurs d'un chapitre (szh-livre-auteurs.lua, ou bloc venu de l'import), suivie
# du titre quand elle est placée au-dessus (`auteurs-chapitre: dessus`).
RE_AUTEURS_AVANT_TITRE = re.compile(
    r'(<(p|div)\b[^>]*\bclass="szh-auteurs"[^>]*>[\s\S]*?</\2>\s*)(<h1\b[\s\S]*?</h1>\s*)')


def auteurs_apres_titre(html):
    """Point 3 de l'en-tête : place la ligne d'auteurs juste après le <h1>."""
    def traiter(est_chapitre, slug, texte):
        if not est_chapitre:
            return texte
        return RE_AUTEURS_AVANT_TITRE.sub(lambda m: m.group(3) + m.group(1), texte, count=1)

    return ''.join(traiter(e, s, t) for e, s, t in _segments(html))


def prepare_for_epub(html_content):
    """Applique les points 1 à 4 de l'en-tête."""
    html_content = dedoublonner_desc_tableaux(html_content)
    html_content = inliner_decors(html_content)
    html_content = retirer_onglets(html_content)
    html_content = auteurs_apres_titre(html_content)

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
