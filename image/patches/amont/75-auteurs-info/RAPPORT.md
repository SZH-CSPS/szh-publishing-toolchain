# Correctif 75 : séparateur des auteurs de `/Info /Author`

Patch : `image/patches/weasyprint-70.0/75-auteurs-info.patch`.

## Le défaut

WeasyPrint écrit `/Info /Author` en joignant les `<meta name="author">` par « , ». Pronto
écrit chaque auteur « Nom, Prénom ». Deux auteurs donnent donc « Fictive-Dumont, Élodie,
Przykład, Łukasz », où l'on ne sait plus où finit un auteur. Les lecteurs PDF et les
moissonneurs qui lisent `/Info` (propriétés du document, catalogues) affichent cette chaîne.
Le XMP n'a pas ce défaut : `dc:creator` est une liste, un `rdf:li` par auteur.

veraPDF ua1 passe avant comme après : PDF/UA ne règle pas le contenu de `/Author`.

## La cause dans le code amont

`weasyprint/pdf/__init__.py` de la 70.0, ligne 256 :
`pdf.info['Author'] = pydyf.String(', '.join(metadata.authors))`. Les mots-clés (ligne 260)
sont joints de la même façon, ce qui ne gêne pas Pronto.

## Ce que dit l'amont

Aucune issue ni PR sur le séparateur des auteurs (recherche du 11.10.2026). `main` : la même
ligne. Non corrigé.

## Notre correctif

Une ligne : « ; » au lieu de « , ». `dc:creator` n'est pas touché.

Le livre d'essai de Pronto n'a qu'un `<meta name="author">`, « Banc d'essai und Tina
Platzhalter », écrit tel quel : le correctif n'y change rien.

## Mesures

Corpus d'essai (trois articles, un livre), pile des 11 correctifs puis des 12 : 40 pages,
0 pixel différent, veraPDF ua1 sans échec. `a11y-revue-fr.pdf` passe de « Fictive-Dumont,
Élodie, Przykład, Łukasz » à « Fictive-Dumont, Élodie; Przykład, Łukasz ». Les PDF à un seul
auteur ne changent pas.

## Recommandation

**Le garder**, et **le proposer en amont** par une issue courte. « ; » est un choix, la
virgule convient à qui écrit « Prénom Nom ». L'amont peut préférer une option : la question
d'abord.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/75-auteurs-info/demo/demo.sh
```

Sortie du 11.10.2026 :

```
== auteurs, WeasyPrint nu
  veraPDF ua1 : PASS (0 règle(s) en échec)
  /Info /Author : 'Doe, Jane, Roe, Richard'
  dc:creator    : ['Doe, Jane', 'Roe, Richard']

== auteurs, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  /Info /Author : 'Doe, Jane; Roe, Richard'
  dc:creator    : ['Doe, Jane', 'Roe, Richard']
```
