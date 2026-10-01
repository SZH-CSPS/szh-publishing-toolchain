<!--
Canevas suivi : le dépôt Kozea/WeasyPrint n'a ni ISSUE_TEMPLATE ni PULL_REQUEST_TEMPLATE
(.github/ ne contient que CONTRIBUTING.md, FUNDING.yml et workflows/). CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon
(https://www.courtbouillon.org/code-of-conduct/#guidelines-for-contributors) :
« Use your own words, write with your keyboard. » ; « Stay short: a few lines are often
enough. Don't use long chapters with titles. » ; « Report real bugs you have in real life.
Attach a short sample that shows the bug. » ; « Ask before sending code. Open an issue or
write a comment and wait for more information. » ; une seule PR ouverte à la fois.
D'où : une issue, pas une PR ; quelques lignes, sans intertitres ; le code proposé
seulement si le mainteneur le demande. Robin doit reformuler ce texte avec ses mots avant de
le poster : c'est la première règle du canevas.
Titre proposé : PDF/UA: wrong /Headers for cells under a th with colspan or rowspan
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

Since #2881, table cells get `/Headers`, thanks a lot. But a `th` is only registered on its first column (or first row), so cells under a spanning header get wrong headers. We hit this on real journal tables.

```html
<html lang="en"><title>Test</title>
<table>
  <tr><th>Name</th><th colspan="2">Points</th></tr>
  <tr><td>Anna</td><td>12</td><td>15</td></tr>
</table>
<table>
  <tr><td></td><th>Test A</th><th>Test B</th></tr>
  <tr><th scope="row" rowspan="2">Group 1</th><td>12</td><td>15</td></tr>
  <tr><td>9</td><td>11</td></tr>
</table>
```

`weasyprint --pdf-variant=pdf/ua-1 test.html test.pdf` with 70.0 (and current main):

- "15" gets `/Headers []` instead of the "Points" header;
- "9" gets `/Headers []`, and "11" gets "Test A" instead of "Group 1" and "Test B".

veraPDF fails on ISO 14289-1 7.5-1 (it only sees the empty lists, not the wrong one). Expected: each cell refers to every `th` covering its column or row (ISO 32000-1 14.8.5.7).

The column counter in `pdf/tags.py` (Find column and row headers) seems to lose track with spans; `cell.grid_x` is already known there. We have a small local fix using `grid_x` (and the HTML `headers` attribute when present), I can open a PR if you want.
