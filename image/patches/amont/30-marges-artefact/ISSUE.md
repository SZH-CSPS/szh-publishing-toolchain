<!--
Commentaire à ajouter à l'issue ouverte #1836 « PDF/UA page header and footer »
(https://github.com/Kozea/WeasyPrint/issues/1836), plutôt qu'une nouvelle issue.
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code). Voir ../10-tableaux-entetes/ISSUE.md.
À reformuler par Robin avant de poster. Tout ce qui est au-dessus de cette ligne n'est pas à
poster.
-->

About "it's only possible in PDF 2.0": the Artifact *structure element* is PDF 2.0, but *marked content* `/Artifact` exists in PDF 1.7 (ISO 32000-1 14.8.2.2.2), and that's what PDF/UA-1 asks for page headers and footers (ISO 14289-1 7.1 and 7.8).

With 70.0, the margin content of this sample gets MCIDs that are reachable from no structure element (6 on 2 pages without the `opacity` line). veraPDF doesn't notice; with the `opacity` line, 7.1-3 fails.

```html
<html lang="en"><title>Test</title>
<style>
  @page {
    @top-center { content: "Journal title" }
    @bottom-right { content: "Page " counter(page) }
    @bottom-left { content: "ISSN 0000-0000"; opacity: 0.6 }
  }
</style>
<p>First page.</p>
<p style="break-before: page">Second page.</p>
```

Locally we paint each margin box in `/Artifact <</Type /Pagination /Subtype /Header /Attached [/Top]>> BDC … EMC` (Footer for bottom boxes), with tagging switched off while drawing it, and we don't build the detached subtree anymore. The only exception is a margin box with a link or a form field, which stays real content because its annotation must be tagged (7.18). veraPDF passes, rendering is unchanged. I can share the code or open a PR if you want.
