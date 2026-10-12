<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. Issue nouvelle ; le diff n'est à
envoyer en PR que si liZe le demande. À reformuler par Robin avant de poster.
Titre proposé : Spaces of justified lines are lost by PDFium text extraction
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

In justified text, PDFium (Chrome, and many tools that copy, search or extract text) extracts some lines with words glued together, "statesthelevels". The space glyphs are in the PDF, but each one is drawn in the middle of the justification gap: the `x_offset` that Pango gives to the letter-spaced space is written in the `TJ` array before the glyph. PDFium sees a gap before the space, inserts a generated zero-width space and drops the real one.

```html
<html lang="en"><title>Test</title>
<p style="width: 60mm; text-align: justify">Participation is measured by what each pupil can do, and not by what the school lets them watch.</p>
```

With PyPDFium2, `FPDFText_IsGenerated()` returns true for the spaces of the justified lines. Writing the offset of the space after the glyph instead of before, in `draw_first_line()`, gives the same rendering, and PDFium then keeps the real spaces. Would you accept a PR for this?
