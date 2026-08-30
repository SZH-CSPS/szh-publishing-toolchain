#!/usr/bin/env python3
# livre-epub-prepare.py — prépare le HTML du livre pour la conversion EPUB.
#
# Pandoc découpe les EPUB sur les titres de premier niveau (--split-level=1) pour faire
# un fichier XHTML par chapitre. Le problème : les <h1> sont enrobées dans des
# <section class="szh-chapitre">. Pandoc découperait avant la balise, pas à sa place,
# laissant les chapitres enchevêtrés dans une même unité.
#
# Ce script retire les <section class="szh-chapitre"> enveloppes et leurs </section>
# correspondants, de sorte que les <h1> soient au niveau racine et que pandoc puisse les
# utiliser pour découper. Le reste du HTML reste inchangé — images, tables, notes, tout
# ce qui n'est pas une enveloppe de chapitre.
#
# Usage: python3 livre-epub-prepare.py <html-in> <html-out>

import sys
import re

def prepare_for_epub(html_content):
    """Retire les <section class="szh-chapitre"> enveloppes.

    Les sections décorent mais ne structurent rien pour pandoc. Elles enrobent
    juste les titres de premier niveau qu'on veut utiliser pour découper.

    Les <section> ont souvent d'autres attributs (id, style, data-*), donc la regex
    les attrape en acceptant n'importe quels attributs après class="szh-chapitre".
    """

    # Regex : <section... class="szh-chapitre"...> suivi de contenu, puis </section>
    # (?:[\s\S])*? = n'importe quel contenu (y compris newlines), non-gourmand
    # La section peut avoir id, style, data-* entre class et la fermeture >
    pattern = r'<section[^>]*class="szh-chapitre"[^>]*>((?:[\s\S])*?)</section>'

    # Remplace chaque <section>…</section> par son contenu (groupe 1).
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
