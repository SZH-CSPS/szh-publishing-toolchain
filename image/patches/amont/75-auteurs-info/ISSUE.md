<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. Issue nouvelle ; une ligne de code, à
n'envoyer que si liZe le demande. À reformuler par Robin avant de poster.
Titre proposé : Authors joined by commas in /Author are ambiguous
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

The `/Author` entry of the PDF information dictionary joins the `<meta name="author">` values with `, `. When authors are written "Name, Given name", as many journals and libraries do, the result can't be split back:

```html
<html lang="en"><title>Test</title>
<meta name="author" content="Doe, Jane">
<meta name="author" content="Roe, Richard">
<p>Text.</p>
```

`/Author` is `Doe, Jane, Roe, Richard`. The XMP metadata is fine, with one `rdf:li` per author in `dc:creator`. Joining with `; ` would keep both forms readable. Would you accept this change, or would you prefer something else?
