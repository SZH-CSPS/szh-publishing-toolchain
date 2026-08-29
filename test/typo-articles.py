#!/usr/bin/env python3
# typo-articles.py — éprouve szh-typographie.lua sur du vrai pandoc.
#
#   python3 test/typo-articles.py           -> tableau lisible ; sortie 0 si tout passe
#   python3 test/typo-articles.py -v        -> montre aussi les cas qui passent
#
# Le filtre normalise la typographie du TEXTE DES ARTICLES à la compilation. Le .md n'est
# jamais réécrit : ce qui se vérifie ici, c'est donc la SORTIE, pas la source.
#
# Chaque cas est un aller simple : un fragment Markdown, une langue d'article, et le texte
# attendu en sortie. Le rendu se fait en `plain` — sans balise, sans échappement — pour que
# l'attendu se lise comme du texte et non comme du HTML. Les espaces invisibles y sont
# écrites [nb] (insécable) et [fin] (fine), sans quoi un attendu faux serait indiscernable
# d'un attendu juste.
#
# ⚠ Ce contrôle a besoin de pandoc. Sans lui il ne prétend pas passer : il le dit et sort
# en échec, plutôt que de faire croire que les règles sont vérifiées.
"""Contrôle du filtre de typographie des articles, par pandoc."""

import os
import re
import shutil
import subprocess
import sys
import tempfile

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FILTRE = os.path.join(RACINE, "pipeline", "filters", "szh-typographie.lua")

NB = " "
FIN = " "


def montrer(t):
    return t.replace(NB, "[nb]").replace(FIN, "[fin]")


# (code de règle, langue, entrée Markdown, sortie attendue)
#
# Les codes sont ceux de docs/TYPOGRAPHIE-FR.md : la table ci-dessous est la seule preuve
# que chacun fait ce que la note promet à la rédaction.
CAS = [
    # ---- A1 · apostrophe -------------------------------------------------------------
    ("A1", "fr", "l'enfant d'ici n'a qu'une idee",
     "l’enfant d’ici n’a qu’une idee"),
    ("A1", "fr", "l'été de l'école",
     "l’été de l’école"),
    ("A1", "de", "Boccaccio's Werk",
     "Boccaccio’s Werk"),

    # ---- A2 · guillemets de premier niveau --------------------------------------------
    ("A2", "fr", 'Il dit "bonjour" ainsi.',
     "Il dit «" + NB + "bonjour" + NB + "» ainsi."),
    ("A2", "de", 'Er sagt "Guten Tag" so.',
     "Er sagt «Guten Tag» so."),
    ("A2", "de", "Er sagt „Guten Tag“ so.",
     "Er sagt «Guten Tag» so."),

    # ---- A3 · second niveau ------------------------------------------------------------
    ("A3", "fr", "Il dit \"un 'mot' de plus\".",
     "Il dit «" + NB + "un ‹" + NB + "mot" + NB + "› de plus" + NB + "»."),

    # ---- E1 · espacement des guillemets ------------------------------------------------
    ("E1", "fr", "Ouvrez « Métadonnées » ici.",
     "Ouvrez «" + NB + "Métadonnées" + NB + "» ici."),
    ("E1", "fr", "Ouvrez «Métadonnées» ici.",
     "Ouvrez «" + NB + "Métadonnées" + NB + "» ici."),
    ("E1", "de", "Öffnen Sie « Metadaten » hier.",
     "Öffnen Sie «Metadaten» hier."),
    ("E1", "it", "Aprire « Metadati » qui.",
     "Aprire «Metadati» qui."),

    # ---- E2 · ponctuation haute --------------------------------------------------------
    ("E2", "fr", "Voici la suite : elle arrive.",
     "Voici la suite" + NB + ": elle arrive."),
    ("E2", "fr", "Vraiment ? Oui ; toujours !",
     "Vraiment" + NB + "? Oui" + NB + "; toujours" + NB + "!"),
    ("E2", "fr", "Voici la suite: elle arrive.",
     "Voici la suite" + NB + ": elle arrive."),
    ("E2", "de", "Hier die Folge : sie kommt.",
     "Hier die Folge: sie kommt."),
    ("E2", "fr", "Voir https://ror.org/012 pour la suite.",
     "Voir https://ror.org/012 pour la suite."),
    ("E2", "fr", "Le train de 10:30 part.",
     "Le train de 10:30 part."),

    # ---- E3 · pour-cent -----------------------------------------------------------------
    ("E3", "fr", "Environ 80 % des cas.", "Environ 80" + NB + "% des cas."),
    ("E3", "fr", "Environ 80% des cas.", "Environ 80" + NB + "% des cas."),
    ("E3", "de", "Etwa 80 % der Fälle.", "Etwa 80" + NB + "% der Fälle."),

    # ---- E4 · abréviations -----------------------------------------------------------------
    ("E4", "fr", "voir p. ex. la note", "voir p." + NB + "ex. la note"),
    ("E4", "fr", "voir p. 202 et pp. 30 ici", "voir p." + NB + "202 et pp." + NB + "30 ici"),
    ("E4", "de", "siehe z. B. die Note", "siehe z." + NB + "B. die Note"),
    ("E4", "de", "siehe S. 202 dort", "siehe S." + NB + "202 dort"),

    # ---- T1 · tiret d'incise ------------------------------------------------------------
    ("T1", "fr", "un mot --- une incise --- la suite",
     "un mot – une incise – la suite"),
    ("T1", "de", "ein Wort --- ein Einschub --- der Rest",
     "ein Wort – ein Einschub – der Rest"),

    # ---- T2 · plage de pages -------------------------------------------------------------
    ("T2", "fr", "voir pp. 12-25 ici", "voir pp." + NB + "12–25 ici"),
    ("T2", "de", "siehe S. 12-25 dort", "siehe S." + NB + "12–25 dort"),
    ("T2", "fr", "le projet COVID-19 de 2020-2021",
     "le projet COVID-19 de 2020-2021"),

    # ---- S1 · points de suspension --------------------------------------------------------
    ("S1", "fr", "et ainsi de suite...", "et ainsi de suite…"),

    # ---- S2 · ordinaux ---------------------------------------------------------------------
    ("S2", "fr", "la 2ème fois et la 3ième", "la 2e fois et la 3e"),

    # ---- ce que la maquette a déjà posé, et qui doit survivre ---------------------------
    # szh-numerotation.lua écrit « Source⍽: » avec une FINE insécable : c'est une décision
    # de composition, et l'élargir en insécable ordinaire la déferait.
    ("E2", "fr", "Le crédit dit Source : Banc d’essai.",
     "Le crédit dit Source : Banc d’essai."),

    # ---- ce qui ne doit PAS bouger ----------------------------------------------------------
    ("--", "fr", "le code `mot : suite` reste", "le code mot : suite reste"),
    ("--", "de", "Massnahmen und Schulschliessungen",
     "Massnahmen und Schulschliessungen"),
    ("--", "fr", "la date 2026-08-29 et le DOI 10.57161/r2026-03-01",
     "la date 2026-08-29 et le DOI 10.57161/r2026-03-01"),
    ("--", "fr", "un [lien](https://szh.ch/a:b) et *l’emphase* : ici",
     "un lien et l’emphase : ici"),
    ("--", "fr", "**gras** : la suite", "gras : la suite"),
    ("--", "de", "**fett** : der Rest", "fett: der Rest"),
]


def rendre(md, langue):
    """Compile un fragment avec le filtre, dans un dossier d'article factice."""
    with tempfile.TemporaryDirectory() as dossier:
        slug = "essai"
        with open(os.path.join(dossier, slug + ".md"), "w", encoding="utf-8") as f:
            f.write(md + "\n")
        with open(os.path.join(dossier, slug + ".meta.yaml"), "w", encoding="utf-8") as f:
            f.write("type: article\nlang: " + langue + "\n")
        r = subprocess.run(
            ["pandoc", slug + ".md", "--from=markdown", "--to=plain", "--wrap=none",
             "--lua-filter=" + FILTRE],
            cwd=dossier, capture_output=True)
        if r.returncode != 0:
            return None, r.stderr.decode("utf-8", "replace").strip()
        return r.stdout.decode("utf-8").strip(), r.stderr.decode("utf-8", "replace").strip()


def main(argv):
    bavard = "-v" in argv
    if shutil.which("pandoc") is None:
        print("pandoc est introuvable : les règles ne sont PAS vérifiées.")
        return 1

    echecs = []
    for code, langue, entree, attendu in CAS:
        obtenu, err = rendre(entree, langue)
        if obtenu is None:
            echecs.append((code, langue, entree, attendu, "pandoc en échec : " + err))
            continue
        if obtenu != attendu:
            echecs.append((code, langue, entree, attendu, obtenu))
        elif bavard:
            print("  ok   %-4s %-3s %s" % (code, langue, montrer(obtenu)))

    print()
    if echecs:
        for code, langue, entree, attendu, obtenu in echecs:
            print("ÉCHEC %s %s" % (code, langue))
            print("   entrée   " + montrer(entree))
            print("   attendu  " + montrer(attendu))
            print("   obtenu   " + montrer(obtenu))
        print("\n%d cas en échec sur %d." % (len(echecs), len(CAS)))
        return 1
    print("%d cas, tous conformes." % len(CAS))
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main(sys.argv[1:]))
