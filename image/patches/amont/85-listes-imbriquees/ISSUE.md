<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. Issue nouvelle pour <li><p> et <dl> ;
la sous-liste dans /LBody se discute plutôt en commentaire de #2874 (fermée). Le diff n'est à
envoyer en PR que si liZe le demande. À reformuler par Robin avant de poster.
Titre proposé : PDF/UA: block in list item and definition lists are not tagged as Lbl/LBody
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

Two list cases give a wrong structure with `pdf/ua-1`:

```html
<html lang="en"><title>Test</title>
<ol><li><p>Step one</p></li></ol>
<dl><dt>Term</dt><dd>Definition.</dd></dl>
```

The `<p>` is a direct child of the `/LI`, and veraPDF fails on PDF/UA-1 7.2-20 ("LI element may contain only Lbl and LBody elements"). The `<dl>` gives two `/LI`, each with only a `/LBody`, so nothing links the term to its definition (there's a "TODO: dt should be different" in `_get_pdf_tag()`).

Expected: `/LI > /Lbl, /LBody > /P` for the first list, and `/L > /LI > /Lbl (dt), /LBody (dd)` for the definition list, as in the PDF Association's PDF/UA technique L_14 for description lists. Consecutive `dt`/`dd` would share one `/LI`, which ISO 32000-1 table 336 allows ("one or more labels or list bodies or both").

About nested lists (#2874): the PDF Association techniques L_05 and L_F07 put a nested `/L` in the `/LBody` of its item, and keep `/L` directly in `/L` for hierarchical lists only. Putting everything that is not the marker in the `/LBody` would fix both the nested lists and the `<p>` case.

It's about 40 lines in `_build_box_tree()`. Should I open a PR?
