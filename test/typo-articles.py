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
# L3 (l'escalier du titre) vit dans un filtre à part : il mesure le titre et doit donc
# passer APRÈS celui-ci, qui pose les insécables et soude les mots outils.
FILTRE_TITRE = os.path.join(RACINE, "pipeline", "filters", "szh-titre-lignes.lua")

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
    # L'insécable devant le tiret est la seconde moitié de la règle : elle manquait ici
    # jusqu'au 08.09.2026, alors que typo-check.py la tenait déjà pour l'interface.
    ("T1", "fr", "un mot --- une incise --- la suite",
     "un mot" + NB + "– une incise" + NB + "– la suite"),
    ("T1", "de", "ein Wort --- ein Einschub --- der Rest",
     "ein Wort – ein Einschub – der Rest"),

    # ---- T2 · plage de pages, deux prescriptions inverses (08.09.2026) -------------------
    # Trait d'union en français (bis-Strich romand), demi-cadratin en allemand (Duden).
    # La règle convertit dans les DEUX sens : ce que la rédaction a tapé ne décide pas.
    ("T2", "fr", "voir pp. 12-25 ici", "voir pp." + NB + "12-25 ici"),
    ("T2", "fr", "voir pp. 12–25 ici", "voir pp." + NB + "12-25 ici"),
    ("T2", "de", "siehe S. 12-25 dort", "siehe S." + NB + "12–25 dort"),
    ("T2", "de", "siehe S. 12–25 dort", "siehe S." + NB + "12–25 dort"),
    ("T2", "fr", "le projet COVID-19 de 2020-2021",
     "le projet COVID-19 de 2020-2021"),

    # ---- S1 · points de suspension --------------------------------------------------------
    ("S1", "fr", "et ainsi de suite...", "et ainsi de suite…"),

    # ---- S2 · ordinaux ---------------------------------------------------------------------
    ("S2", "fr", "la 2ème fois et la 3ième", "la 2e fois et la 3e"),

    # ---- S4 · le point abréviatif absorbe le point final -----------------------------------
    ("S4", "fr", "voir etc.. ici", "voir etc. ici"),
    ("S4", "fr", "voir etc... ici", "voir etc. ici"),
    ("S4", "de", "siehe usw... hier", "siehe usw. hier"),
    # Ce qui n'est PAS un point doublé : les points de suspension d'une phrase inachevée.
    ("S4", "fr", "et ainsi de suite... ", "et ainsi de suite…"),

    # ---- E3 · pour mille, comme le pour-cent, dans les trois langues -----------------------
    ("E3", "fr", "environ 2 ‰ des cas", "environ 2" + NB + "‰ des cas"),
    ("E3", "de", "etwa 2‰ der Fälle", "etwa 2" + NB + "‰ der Fälle"),

    # ---- E5 · les insécables de contexte ---------------------------------------------------
    ("E5", "fr", "il a couru 12 km en 54,5 minutes",
     "il a couru 12" + NB + "km en 54,5" + NB + "minutes"),
    ("E5", "fr", "voir art. 8 et al. 2", "voir art." + NB + "8 et al." + NB + "2"),
    ("E5", "fr", "reçu par Mme Berger et M. Dupont",
     "reçu par Mme" + NB + "Berger et M." + NB + "Dupont"),
    ("E5", "fr", "signé J. Dupont", "signé J." + NB + "Dupont"),
    ("E5", "fr", "le 6 août 2017", "le 6" + NB + "août 2017"),
    ("E5", "fr", "à 4 h 04 précises", "à 4" + NB + "h" + NB + "04 précises"),
    ("E5", "fr", "coûte 160 fr. et 25 €", "coûte 160" + NB + "fr. et 25" + NB + "€"),
    ("E5", "fr", "sous Louis XIV", "sous Louis" + NB + "XIV"),
    ("E5", "de", "in 3 Tagen um 8.30 Uhr", "in 3" + NB + "Tagen um 8.30" + NB + "Uhr"),
    ("E5", "de", "siehe Abb. 4 und Art. 8",
     "siehe Abb." + NB + "4 und Art." + NB + "8"),
    # Ce qui n'est pas une unité reste sécable : souder tout nombre au mot qui suit
    # multiplierait les insécables dans une colonne étroite.
    ("E5", "fr", "il y avait 2000 personnes", "il y avait 2000 personnes"),

    # ---- E6 · le groupement des nombres ne se coupe pas ------------------------------------
    ("E6", "fr", "un budget de 22 255 725 francs",
     "un budget de 22" + FIN + "255" + FIN + "725" + NB + "francs"),
    ("E6", "de", "ein Budget von 22 255 725 Franken",
     "ein Budget von 22" + FIN + "255" + FIN + "725" + NB + "Franken"),

    # ---- E7 · pas d'espace à l'intérieur des parenthèses ni des crochets -------------------
    ("E7", "fr", "la machine ( ci-joint ) tourne", "la machine (ci-joint) tourne"),
    ("E7", "de", "die Maschine ( siehe oben ) läuft", "die Maschine (siehe oben) läuft"),

    # ---- E8 · la virgule et le point sont collés au mot ------------------------------------
    ("E8", "fr", "le mot , puis la suite .", "le mot, puis la suite."),
    ("E8", "de", "das Wort , dann der Rest .", "das Wort, dann der Rest."),

    # ---- A4 · majuscules accentuées ---------------------------------------------------------
    # Le « A » isolé qui est un « À », en OUVERTURE DE PHRASE seulement.
    ("A4", "fr", "A l'heure actuelle, tout va bien.",
     "À l’heure actuelle, tout va bien."),
    ("A4", "fr", "Tout va bien. A la maison aussi.", "Tout va bien. À la maison aussi."),
    # Au milieu d'une phrase, un « A » capital est un « à » minuscule : une coquille de
    # casse, que le filtre ne peut pas distinguer d'un intitulé. Il n'y touche pas.
    ("A4", "fr", "Il va A la maison.", "Il va A la maison."),
    ("A4", "fr", "Voir A. Dupont et la variante A) ici.",
     "Voir A." + NB + "Dupont et la variante A) ici."),
    # Le lexique : corrigé dans un intertitre, laissé dans le corps (un titre anglais
    # s'écrit « Education » sans faute).
    ("A4", "fr", "## Le role de l'Ecole", "Le" + NB + "role de" + NB + "l’École"),
    ("A4", "fr", "Un Etat dans le corps.", "Un Etat dans le corps."),

    # ---- A5 · ligatures œ et æ --------------------------------------------------------------
    ("A5", "fr", "le coeur de l'oeuvre", "le cœur de l’œuvre"),
    ("A5", "fr", "OEUVRES choisies", "ŒUVRES choisies"),
    ("A5", "fr", "Oeuvres choisies", "Œuvres choisies"),
    # Les pièges : le o et le e ne se lient pas ici.
    ("A5", "fr", "un coefficient de moelle", "un coefficient de moelle"),
    ("A5", "de", "das Oeuvre bleibt", "das Oeuvre bleibt"),

    # ---- L2 · déterminant et préposition restent avec leur mot (titres) ---------------------
    # L'exemple de la rédaction : la coupure ne peut plus tomber entre « de » et
    # « formation », elle se fera devant « de ».
    ("L2", "fr", "## Les personnes en situation de handicap comme partenaires de formation",
     "Les" + NB + "personnes en" + NB + "situation de" + NB + "handicap comme"
     + NB + "partenaires de" + NB + "formation"),
    ("L2", "de", "## Menschen mit Behinderung als Partner in der Ausbildung",
     "Menschen mit" + NB + "Behinderung als" + NB + "Partner in" + NB + "der"
     + NB + "Ausbildung"),
    # La chaîne de soudures s'arrête au plafond de 30 signes : la boîte du titre est en
    # overflow: hidden, et un groupe insécable plus long qu'elle serait tronqué sans bruit.
    # « Malgré la professionnalisation » fait exactement 30 signes et passe donc encore.
    ("L2", "fr", "## Malgré la professionnalisation des métiers",
     "Malgré" + NB + "la" + NB + "professionnalisation des" + NB + "métiers"),
    # Un seul mot de 27 signes fait déjà dépasser le plafond : l'espace reste sécable.
    ("L2", "de", "## Nach der Behindertenrechtskonvention",
     "Nach" + NB + "der Behindertenrechtskonvention"),
    # Le corps ne reçoit PAS la soudure : ce sont les points de coupure qui permettent à
    # WeasyPrint de répartir le blanc d'un paragraphe justifié.
    ("L2", "fr", "Les personnes de la formation restent ici.",
     "Les personnes de la formation restent ici."),

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


# (code, langue, clé, titre saisi, titre tel que la couverture l'imprime)
#
# Le hero n'est pas du texte d'article : le titre et le sous-titre sont des MetaString que
# szh-maquette.lua pose AVANT szh-typographie, et ce sont deux filtres qui les composent —
# szh-typographie pour la typographie et la soudure des mots outils (L2), szh-titre-lignes
# pour l'escalier (L3). Ces cas-ci passent donc par un gabarit minimal, qui imprime la clé
# comme le fait szh-article.html. « ⏎ » marque la fin de ligne calculée par L3.
CAS_TITRE = [
    # ---- L3 · effet d'escalier : la première ligne plus courte que la deuxième ---------
    # Sans le filtre, WeasyPrint remplit la première ligne et laisse « régulière » seule
    # (mesuré sur test/accessibilite/out/participation-fr.pdf, rendu du 08.09.2026).
    ("L3", "fr", "titre-affiche", "La participation sociale en classe régulière",
     # L'espace du point de coupure disparaît : c'est le <br> qui porte la fin de ligne,
     # et une espace traînante devant lui serait de toute façon ravalée.
     "La" + NB + "participation⏎sociale en" + NB + "classe régulière"),
    # Rien à faire : ce titre-là se replie DÉJÀ en escalier (304 px puis 340 px), et le
    # filtre s'abstient plutôt que de déplacer une coupure qui est juste.
    ("L3", "fr", "titre-affiche", "Développer ses compétences relationnelles grâce au handicap",
     "Développer ses" + NB + "compétences relationnelles grâce au" + NB + "handicap"),
    # Un titre d'une seule ligne n'a pas d'escalier.
    ("L3", "fr", "titre-affiche", "Un titre court", "Un" + NB + "titre court"),
    # En allemand, la soudure des mots outils suffit à mettre le titre en escalier
    # (357 px puis 388 px) : aucune coupure n'est posée.
    ("L3", "de", "titre-affiche", "Erfahrungen von Schülerinnen und Schülern in inklusiven Klassen",
     "Erfahrungen von" + NB + "Schülerinnen und" + NB + "Schülern in" + NB
     + "inklusiven Klassen"),

    # ---- L2 · le sous-titre de couverture, l'exemple de la rédaction -------------------
    # Avant : « … comme partenaires de / formation », préposition en fin de ligne et mot
    # seul en dessous. La soudure de « de formation » déplace la coupure devant « de ».
    ("L2", "fr", "sous-titre-affiche",
     "Les personnes en situation de handicap comme partenaires de formation",
     "Les" + NB + "personnes en" + NB + "situation de" + NB + "handicap comme"
     + NB + "partenaires de" + NB + "formation"),

    # ---- la couverture reçoit la MÊME typographie que le corps -------------------------
    # ⚠ Ce n'était pas le cas avant le 08.09.2026 : szh-maquette pose ces clés avant le
    # filtre, et une MetaString arrive en chaîne nue dans un filtre Lua — la
    # normalisation les traversait sans rien faire.
    ("A4", "fr", "titre-affiche", "L'Ecole inclusive : un défi",
     "L’École inclusive" + NB + ": un" + NB + "défi"),
    ("A5", "fr", "titre-affiche", "Au coeur de l'oeuvre",
     "Au" + NB + "cœur de" + NB + "l’œuvre"),
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


def rendre_titre(titre, langue, cle):
    """Compose une clé de couverture par les deux filtres, comme le fait le gabarit."""
    if cle == "titre-affiche":
        # La même expansion qu'à la ligne 110 de szh-article.html.
        gabarit = "$if(titre-lignes)$$titre-lignes$$else$$titre-affiche$$endif$\n"
    else:
        gabarit = "$" + cle + "$\n"
    with tempfile.TemporaryDirectory() as dossier:
        with open(os.path.join(dossier, "vide.md"), "w", encoding="utf-8") as f:
            f.write("")
        with open(os.path.join(dossier, "gabarit.html"), "w", encoding="utf-8") as f:
            f.write(gabarit)
        r = subprocess.run(
            ["pandoc", "vide.md", "--from=markdown", "--to=html", "--wrap=none",
             "--template=gabarit.html", "--metadata=lang=" + langue,
             "--metadata=" + cle + "=" + titre,
             "--lua-filter=" + FILTRE, "--lua-filter=" + FILTRE_TITRE],
            cwd=dossier, capture_output=True)
        if r.returncode != 0:
            return None, r.stderr.decode("utf-8", "replace").strip()
        sortie = r.stdout.decode("utf-8").strip()
        sortie = sortie.replace('<br class="szh-titre-ligne" />', "⏎")
        return sortie, r.stderr.decode("utf-8", "replace").strip()


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

    for code, langue, cle, entree, attendu in CAS_TITRE:
        obtenu, err = rendre_titre(entree, langue, cle)
        if obtenu is None:
            echecs.append((code, langue, entree, attendu, "pandoc en échec : " + err))
            continue
        if obtenu != attendu:
            echecs.append((code, langue, entree, attendu, obtenu))
        elif bavard:
            print("  ok   %-4s %-3s %s" % (code, langue, montrer(obtenu)))

    total = len(CAS) + len(CAS_TITRE)
    print()
    if echecs:
        for code, langue, entree, attendu, obtenu in echecs:
            print("ÉCHEC %s %s" % (code, langue))
            print("   entrée   " + montrer(entree))
            print("   attendu  " + montrer(attendu))
            print("   obtenu   " + montrer(obtenu))
        print("\n%d cas en échec sur %d." % (len(echecs), total))
        return 1
    print("%d cas, tous conformes." % total)
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.exit(main(sys.argv[1:]))
