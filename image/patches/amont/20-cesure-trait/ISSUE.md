<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un bogue réel avec un exemple court, demander avant d'envoyer du code). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. À reformuler par Robin avant de poster.
Seule la partie « trait de césure » est proposée ; l'espace de fin de ligne reste local
(voir RAPPORT.md, #1635 et #2715).
Titre proposé : Mark hyphens added by hyphenation with ActualText
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

When a word is hyphenated by `hyphens: auto` (or at a `&shy;`), the added hyphen is a real character of the PDF text layer. Copying "accompagnent" split as "ac‐ / compagnent" gives "ac‐ compagnent", and screen readers get the hyphen too. We see it in every article of our journal.

```html
<html lang="fr"><title>Test</title>
<p style="width: 32mm; hyphens: auto">Les enseignantes spécialisées accompagnent la marche des élèves.</p>
```

You said in #2132 that marking such hyphens "would be useful". ISO 32000-1 (14.9.4) allows wrapping the hyphen in `/Span <</ActualText (­)>> BDC … EMC`, so that readers get a soft hyphen and can rejoin the word. Rendering is unchanged.

Locally we keep the `hyphenated` flag from `split_first_line()` on the text box and wrap the hyphen glyphs in `draw_first_line()`. I can open a PR if you are interested.
