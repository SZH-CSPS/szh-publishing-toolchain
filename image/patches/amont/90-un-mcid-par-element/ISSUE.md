<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. Issue nouvelle : aucune issue amont sur
le sujet (recherche du 11.10.2026). Le diff n'est à envoyer en PR que si liZe le demande.
À reformuler par Robin avant de poster.
Titre proposé : PDF/UA: each line is a separate marked content, words of consecutive lines are read stuck together
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

With `pdf/ua-1`, each line of a paragraph is a separate marked content, with its own MCID and its own `/Span`:

```html
<html lang="en"><title>Test</title>
<p style="width: 10em">Participation is measured by what each pupil can do, and not by what the school lets them watch.</p>
```

The PDF reader of Edge exposes each marked content as a separate text node, without its leading and trailing spaces, and NVDA reads these nodes without any separator: the last word of a line is stuck to the first word of the next one ("andnot"). With one marked content for the lines of the paragraph, as Word and LibreOffice do, Edge gives one text node and NVDA reads it correctly. Before 66.0, paragraphs had a single MCID (see the structure in #2153).

Consecutive text boxes of the same element could share their marked content, in box order (images, floats and positioned elements are drawn later but stay between their text in the structure tree), while text of inline elements (`em`, links, `lang`, footnote calls) keeps its own. Across lines, this only works when the line ends with a space or a hyphen in the text layer: otherwise readers that take the marked content text as is (Acrobat does) stick the words together. As WeasyPrint removes the space at the end of a line, that would also need the space to be kept in the text layer, without ink.

Would you be interested in such a change?
