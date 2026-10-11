<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. Issue nouvelle, à lier à #2482 ; le diff
n'est à envoyer en PR que si liZe le demande. À reformuler par Robin avant de poster.
Titre proposé : Tag footnotes as /Note after their call
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

With `pdf/ua-1`, the body of a `float: footnote` is tagged where its box is drawn: a `/NonStruct` at the end of the page, after the last block. Screen readers read it in the middle of the text, sometimes between two items of a list cut by the page. The call is a `/NonStruct` too, linked to nothing. PDF/UA-1 7.9 expects a `/Note` with a unique `/ID`, and the PDF Association's Tagged PDF Best Practice Guide puts it right after its reference.

```html
<html lang="en"><title>Test</title>
<style>.note { float: footnote }</style>
<p>Some text<span class="note">The note.</span> and more text.</p>
<p>Another paragraph.</p>
```

`weasyprint --pdf-variant=pdf/ua-1 test.html test.pdf` gives `P, P, NonStruct(note)`. Expected: `P(Span, Reference(call), Note(Lbl, Span), Span), P`. The marked content can stay where it is drawn, as the structure order doesn't depend on the content stream order. As `/Note` requires an `/ID`, the structure tree root would also get an `/IDTree` (already needed for the `/ID` of table headers).

The call box knows its footnote (`box.footnote`) and the laid-out footnote keeps the same element, so `add_tags()` could move each note after its call once all pages are built: about 40 lines in `pdf/tags.py`. Should I open a PR?
