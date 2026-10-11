# Correctif 70 : espaces des lignes justifiées

Patch : `image/patches/weasyprint-70.0/70-espaces-justifiees.patch`.

## Le défaut

Sur une ligne justifiée, Edge et son lecteur d'écran lisent des mots collés
(« unarticle de laRevue »). Le PDF contient pourtant chaque espace, avec sa ToUnicode
U+0020 : c'est sa position qui trompe le lecteur de texte. pdfium, le moteur PDF de Chrome
et d'Edge, voit un écart entre la fin d'un mot et le glyphe espace. Il en déduit une espace
« générée » de largeur nulle (`FPDFText_IsGenerated`) et écarte la vraie. Sur
`demo/justifie.html` : 19 espaces générées sur 62 sans le correctif, aucune avec.

pypdf, qui ajoute lui-même une espace devant tout grand écart du `TJ`, n'est pas touché.
veraPDF passe avant comme après. Ce que lit un lecteur d'écran réel n'a pas été vérifié.

Aucun recours CSS, sauf renoncer à `text-align: justify`. `word-spacing` passe par le même
mécanisme et produit le même défaut.

## La cause dans le code amont

- `weasyprint/text/line_break.py` de la 70.0, lignes 179-191 : pour justifier, chaque
  espace reçoit un attribut Pango `letter_spacing` égal à l'écart à ajouter.
- Pango rend la moitié de cet écart en `x_offset` du glyphe espace.
- `weasyprint/draw/text.py`, lignes 206 et 224-225 : `draw_first_line` écrit ce décalage
  dans le `TJ` **avant** le glyphe, puis le reste de l'écart après lui (ligne 238). L'espace
  est donc dessinée au milieu de l'intervalle.

## Ce que dit l'amont

Aucune issue ni PR sur des espaces perdues ou des mots collés à l'extraction d'un texte
justifié (recherche du 11.10.2026). [#2928](https://github.com/Kozea/WeasyPrint/issues/2928)
(fermée) touche le même mécanisme, mais pour la largeur des lignes, avec des polices qui
crénent contre l'espace. `main` : `draw/text.py` identique sur ce point. Non corrigé.

## Notre correctif

Dans `draw_first_line`, pour une espace (U+0020 ou U+00A0) à `x_offset` d'un texte justifié
ou à `word-spacing` : rien n'est écrit avant le glyphe, et son décalage s'ajoute au nombre
écrit après lui. Les glyphes suivants gardent leur position et l'espace n'a pas d'encre.

Ce qui reste comme avant :

- les autres glyphes ;
- une espace à `y_offset` ;
- les espaces d'un texte seulement espacé (`letter-spacing` sans justification). Elles
  portent un petit décalage, qui ne gêne pas pdfium. Les y toucher déplaçait d'un pixel un
  glyphe de l'impressum du livre d'essai, à 100 dpi, par l'ordre des additions en virgule
  flottante.

## Mesures

Pile des 10 correctifs, puis des 11, sur le corpus d'essai (trois articles, un livre) :

- 40 pages, 0 pixel différent ; veraPDF ua1 sans échec ;
- espaces générées par pdfium : `mots-colles-fautif.html` 21 → 0, avec 79 espaces lues dans
  le flux sur 79 ; `a11y-revue-fr.pdf` 103 → 93, et `a11y-zeitschrift-de.pdf` 138 → 105.
  Les espaces générées qui restent séparent des cellules de tableau, une puce ou un numéro
  de son texte, des mots-clés, ou les lettres d'un titre espacé. Aucune n'y remplace plus
  une vraie espace d'une ligne justifiée ;
- texte pypdf, mots comparés : identique, sauf « 47(4) » d'une référence, lu « 47 (4) ».
  pypdf ne suit pas les déplacements du `TJ` et juge l'écart avant un `Tm` sur sa propre
  estimation. pdfium lit « 47(4) » avant comme après.

## Recommandation

**Le garder**, et **le proposer en amont** par une issue courte, avec la démo. La règle
CourtBouillon « Ask before sending code » s'applique : la question d'abord. Le retirer dès
que l'amont dessine l'espace contre son mot.

Texte prêt : `ISSUE.md`.

## Démo

`demo/demo.sh`, dans la WSL (pdfium lu dans `~/pdfvenv`, `outils-dev/venv-dev.sh`) :

```
wsl.exe -d SZH-Publishing -- bash /mnt/c/Users/robin/Documents/Prog/szh-publishing-toolchain/image/patches/amont/70-espaces-justifiees/demo/demo.sh
```

HTML : `justifie.html` (un paragraphe justifié, un paragraphe à `word-spacing`).

Sortie du 11.10.2026 :

```
== justifie, WeasyPrint nu
  veraPDF ua1 : PASS (0 règle(s) en échec)
  TJ : 62 espaces dessinées, dont 19 précédées d'un décalage
  pdfium : 19 espaces générées, 43 lues dans le flux

== justifie, WeasyPrint patché
  veraPDF ua1 : PASS (0 règle(s) en échec)
  TJ : 62 espaces dessinées, dont 0 précédées d'un décalage
  pdfium : 0 espaces générées, 62 lues dans le flux

== pixels nu / patché
  identiques à 300 dpi
```

Texte de pull request, test pytest compris : `PR.md`.
