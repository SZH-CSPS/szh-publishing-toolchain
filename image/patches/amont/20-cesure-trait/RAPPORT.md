# Correctif 20 : trait de césure

Patch : `image/patches/weasyprint-70.0/20-cesure-trait.patch`. Il portait aussi l'espace de
fin de ligne, qui a désormais son propre correctif :
[25-espace-fin-de-ligne](../25-espace-fin-de-ligne/RAPPORT.md). Le dessin de cette espace
est resté ici : il lit, dans `draw_first_line`, les variables que pose le bloc du trait
(`truncated`, `hyphen_start`), et une même ligne ne peut pas appartenir à deux patchs. Sans
le 25, ce code dort.

## Le défaut

Au copier-coller, à l'extraction et pour un lecteur d'écran, le trait ajouté par
`hyphens: auto` (ou un `&shy;`) est un vrai caractère du texte : « ac‐ compagnent » au lieu
de « accompagnent ». Par défaut c'est U+2010
(`hyphenate-character` vaut `'‐'`, `css/properties.py` ligne 165 de la 70.0) ; la démo le
montre.

Normes : ISO 32000-1:2008, 14.9.4 (`/ActualText`, texte de remplacement) et 14.8.2.2.3,
cité par l'en-tête du patch pour la coupure de mot incidente (non revérifié dans le texte de
la norme). veraPDF ne le contrôle pas : il passe avant comme après.

## La cause dans le code amont

- `weasyprint/text/line_break.py` de la 70.0 : `split_first_line()` sait qu'elle a coupé
  un mot (`hyphenated`, lignes 369-489) et ajoute `hyphenate_character` au texte de la
  ligne (lignes 439-472), mais l'information meurt avec la mise en page : elle n'est
  transmise qu'à `first_line_metrics()` (ligne 506).
- `weasyprint/layout/inline.py`, `split_text_box()` ligne 924 (copie ligne 947) : la boîte
  de texte garde le trait dans son texte, sans marque.
- `weasyprint/draw/text.py`, `draw_first_line()` ligne 87 : chaque glyphe part dans un `TJ`,
  le trait compris ; rien n'est entouré d'un `/Span /ActualText`. Le seul traitement du trait
  (lignes 113-117) sert à `text-overflow`.

## Ce que dit l'amont

- [#2132](https://github.com/Kozea/WeasyPrint/issues/2132) (fermée), liZe :
  « There's a way to make PDF readers not copy some characters, like hyphens really used to
  split words, or markers for example. It's not in WeasyPrint, but it would be useful. »
  Personne ne l'a demandé depuis. Aucune occurrence de `ActualText` dans le code ni dans les
  issues (recherche du 01.10.2026).
- La PR ouverte [#1840](https://github.com/Kozea/WeasyPrint/pull/1840) (« Draft: Do line
  breaking in WeasyPrint using Harfbuzz data », brouillon depuis 2023) toucherait le même
  code de coupure ; rien n'y traite de la couche texte.
- `main` au 01.10.2026 : `draw/text.py`, `layout/inline.py`, `text/line_break.py` identiques
  à la 70.0. Non corrigé.

## Notre correctif

- Le trait : `line_break.py` pose `layout.hyphenated`, `split_text_box` le recopie en
  `box.hyphenated`, et `draw_first_line` ouvre `/Span <</ActualText (U+00AD)>> BDC` au
  premier glyphe du trait, ferme après le dernier. Rendu identique.

Le patch fait 154 lignes, dont le dessin de l'espace du 25 (voir plus haut).

## Recommandation

- **Le proposer en amont** (issue courte, code sur demande). Le
  mainteneur a dit que ce serait utile, la correction est locale (dessin) et conforme à
  ISO 32000-1. **Le garder** d'ici là, **le retirer** quand l'amont le fera.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/20-cesure-trait/demo/demo.sh
```

HTML : `cesure.html` (paragraphe de 32 mm en `hyphens: auto`, `lang="fr"`). Sortie du
01.10.2026 :

```
== Préparation des deux venvs
  patch-weasyprint : posé 20-cesure-trait.patch
  patch-weasyprint : WeasyPrint 70.0, 1 correctif(s) posé(s) sur /tmp/tmp.RufWLlEKt5/patche/lib/python3.13/site-packages.
  nu     : WeasyPrint 70.0, aucun correctif SZH
  patché : WeasyPrint 70.0 + 20-cesure-trait.patch

== cesure, WeasyPrint nu
  veraPDF ua1 : PASS (0 règle(s) en échec)
  texte extrait par pypdf (· = espace) :
    p1 |Les·enseignantes|
    p1 |spécialisées·ac‐|
    p1 |compagnent·la|
    p1 |marche·des|
    p1 |élèves.|
  flux de contenu, marques de césure :
    page 1 : 0 ligne(s) avec 'ActualText'

== cesure, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  texte extrait par pypdf (· = espace) :
    p1 |Les·enseignantes|
    p1 |spécialisées·ac‐|
    p1 |compagnent·la|
    p1 |marche·des|
    p1 |élèves.|
  flux de contenu, marques de césure :
    page 1 : 1 ligne(s) avec 'ActualText'
      <</ActualText <feff00ad>>>
      BDC
      [<0af3>0] TJ
      …
```

Lecture : pypdf ne lit pas `/ActualText` et rend toujours le trait (« ac‐ ») ; la preuve
du trait est dans le flux, où le glyphe `<0af3>` est entouré du `/Span` qui le remplace par
U+00AD. Aucun lecteur PDF ni lecteur d'écran n'a été essayé ici (poppler n'est pas dans la
WSL) : l'effet sur NVDA ou Acrobat est **non vérifié**.
