#!/usr/bin/env python3
# livre-epub-prepare.py — prépare le HTML du livre pour la conversion EPUB.
#
# Quatre passes, dans cet ordre, PENDANT que les <section class="szh-chapitre"> sont
# encore en place — elles bornent chaque chapitre, et c'est ce qui permet de corriger
# ce que szh-numerotation.lua numérote par invocation pandoc (donc par chapitre, chaque
# chapitre recommençant à 1) avant que les frontières ne disparaissent :
#
# 1. dédoublonne les identifiants de description longue de tableau
#    (id="szh-tabelle-desc-N", posé par szh-numerotation.lua sur le <div> visé par
#    l'aria-describedby du tableau). Deux chapitres portant chacun un tableau à
#    description longue produiraient sinon le même id="szh-tabelle-desc-1" une fois
#    fusionnés en un seul document par livre-assembler.py — avant que pandoc ne découpe
#    ce document en fichiers EPUB. Un doublon d'identifiant est invalide en XHTML, et
#    l'aria-describedby du second tableau resterait ambigu (le premier id trouvé gagne).
#    Mesuré en dupliquant temporairement le chapitre à tableau du banc — voir
#    docs/ARCHITECTURE-LIVRES.md §4.5.
#
# 2. bascule en attributs style= le <style> des images décoratives que
#    szh-numerotation.lua écrit en fin de chapitre (style_decors()). Mesuré : pandoc,
#    à la conversion epub3, retrouve ce <style> de corps et le remonte dans le <head>
#    du XHTML de chaque chapitre — mais VIDE, son contenu perdu (reproduit sur un HTML
#    minimal ne portant que ce <style>). Sans ce détour, l'image décorative disparaît
#    de l'EPUB : ni <img>, ni fond CSS, sans un mot. Les classes szh-decor-N ne sont
#    elles non plus pas préfixées par chapitre (même compteur par invocation pandoc) :
#    la correction doit donc rester dans les bornes de la <section> pour ne pas
#    apparier la règle d'un chapitre à l'image décorative d'un autre.
#
# 3. retire le <div class="szh-onglet"> que le gabarit de chapitre pose en tout premier
#    enfant, avant $body$ — donc avant le <h1> une fois la <section> retirée. epub.css le
#    met déjà en display:none (l'onglet de tranche n'existe qu'en pagination) : mort pour
#    l'EPUB. Mesuré : laissé en place, ce <div> vide traîne AVANT le <h1> du chapitre
#    suivant, et pandoc --split-level=1 le range dans le fichier du chapitre PRÉCÉDENT
#    (tout ce qui précède un <h1> appartient au split d'avant) — un fichier XHTML
#    quasi-vide s'intercale entre les liminaires et le premier chapitre, et le <div> du
#    dernier chapitre traîne à la fin de l'avant-dernier. Rien n'est perdu (le <div> est
#    vide et aria-hidden), mais un fichier fantôme dans le spine n'a aucune raison d'être.
#
# 4. retire les <section class="szh-chapitre"> enveloppes et leurs </section>
#    correspondants, de sorte que les <h1> soient au niveau racine et que pandoc puisse
#    les utiliser pour découper (--split-level=1). Le reste du HTML reste inchangé —
#    images, tables, notes, tout ce qui n'est pas une enveloppe de chapitre.
#
# Usage: python3 livre-epub-prepare.py <html-in> <html-out>

import sys
import re

# Une <section class="szh-chapitre">…</section> complète. Non-greedy jusqu'au premier
# </section> : aucune <section> imbriquée n'apparaît dans un chapitre (pas de
# --section-divs dans la chaîne pandoc de ce projet — mesuré sur le fragment compilé,
# les <h2>/<h3> sortent en <hN> nus, jamais enveloppés).
RE_CHAPITRE = re.compile(r'<section[^>]*class="szh-chapitre"[^>]*>(?:[\s\S])*?</section>')
RE_CHAPITRE_ID = re.compile(r'id="ch-([^"]+)"')


def _segments(html):
    """Découpe html en segments (est_chapitre, slug, texte). est_chapitre est vrai pour
    une <section class="szh-chapitre">…</section> complète (slug tiré de son
    id="ch-<slug>", ou None si l'attribut manque exceptionnellement) ; faux pour le texte
    entre deux chapitres (liminaires, pièces hors chapitre). Les textes des segments,
    remis bout à bout dans l'ordre, redonnent html à l'identique."""
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
    """Préfixe szh-tabelle-desc-N par le slug du chapitre porteur. Voir le point 1 de
    l'en-tête. Un chapitre sans id="ch-…" (ne devrait pas arriver) traverse inchangé :
    pas pire que l'état actuel, seulement pas corrigé."""
    def traiter(est_chapitre, slug, texte):
        if est_chapitre and slug:
            return re.sub(r'szh-tabelle-desc-(\d+)',
                           'szh-tabelle-desc-' + slug + r'-\1', texte)
        return texte

    return ''.join(traiter(e, s, t) for e, s, t in _segments(html))


# Le <style> unique qu'ajoute style_decors() en fin de chapitre.
RE_STYLE_BLOCK = re.compile(r'<style>\s*([\s\S]*?)\s*</style>')
# Une paire de règles pour une même classe .szh-decor-N : la boîte, puis le fond du
# <span> interne. Le format exact vient de string.format() dans style_decors()
# (szh-numerotation.lua) — une seule ligne par règle, pas d'accolade imbriquée.
RE_REGLE_DECOR = re.compile(r'\.([\w-]+)\{([^{}]*)\}\s*\.\1>span\{([^{}]*)\}')


def _inliner_decors_du_chapitre(texte):
    """Applique le point 2 de l'en-tête à un seul chapitre (un seul appel, sur le texte
    d'une <section class="szh-chapitre"> déjà isolée). Sans <style> ou sans règle
    reconnue, texte revient inchangé — pandoc l'aurait de toute façon vidé, ce n'est
    donc pas une régression que de le laisser tel quel."""
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
    # Les règles inlinées ci-dessus remplacent le <style> : il ne sert plus à rien, et
    # pandoc le viderait de toute façon à l'écriture de l'EPUB.
    return RE_STYLE_BLOCK.sub('', texte, count=1)


def inliner_decors(html):
    def traiter(est_chapitre, slug, texte):
        return _inliner_decors_du_chapitre(texte) if est_chapitre else texte

    return ''.join(traiter(e, s, t) for e, s, t in _segments(html))


# Le <div> que GABARIT_CHAPITRE écrit en tout premier enfant de la section, avant $body$
# (voir templates/szh-livre-chapitre.html). Toujours cette forme exacte, sans autre
# attribut : id="ch-…" et la couleur/l'onglet vivent sur la <section> elle-même, pas ici.
RE_ONGLET = re.compile(r'<div class="szh-onglet" aria-hidden="true"></div>\s*')


def retirer_onglets(html):
    """Voir le point 3 de l'en-tête : mort pour l'EPUB (epub.css : display:none), et sa
    seule présence avant chaque <h1> de chapitre fait sortir un fichier XHTML fantôme
    au découpage pandoc."""
    return RE_ONGLET.sub('', html)


def prepare_for_epub(html_content):
    """Dédoublonne les descriptions de tableau, inline les images décoratives, retire les
    onglets de tranche morts, puis retire les <section class="szh-chapitre"> enveloppes
    (voir les points 1 à 4 de l'en-tête du fichier)."""
    html_content = dedoublonner_desc_tableaux(html_content)
    html_content = inliner_decors(html_content)
    html_content = retirer_onglets(html_content)

    # Remplace chaque <section>…</section> par son contenu (groupe 1). Les <section>
    # ont souvent d'autres attributs (id, style, data-*), la regex les attrape en
    # acceptant n'importe quels attributs après class="szh-chapitre".
    pattern = r'<section[^>]*class="szh-chapitre"[^>]*>((?:[\s\S])*?)</section>'
    result = re.sub(pattern, r'\1', html_content)

    return result

def main():
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
