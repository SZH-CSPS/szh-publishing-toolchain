<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code, une seule PR ouverte à la fois). Voir
../10-tableaux-entetes/ISSUE.md pour les citations. Issue nouvelle, à lier à #2482 ; le diff,
sous la seconde ligne de séparation, n'est à envoyer en PR que si liZe le demande. À
reformuler par Robin avant de poster.
Titre proposé : Set /Lang on structure elements of passages in another language
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

With `pdf/ua-1`, the `lang` of `<html>` becomes the catalog `/Lang`, but the `lang` of other elements is ignored by the structure tree: a German abstract in a French article is read by screen readers with the French voice. PDF/UA-1 7.2 and ISO 32000-1 14.9.2 expect `/Lang` on the structure element where the language changes.

```html
<html lang="fr"><title>Test</title>
<p>Un paragraphe avec un <span lang="en">mindset</span>.</p>
<section lang="de"><p>Ein deutscher Absatz.</p></section>
```

`weasyprint --pdf-variant=pdf/ua-1 test.html test.pdf`: no `/Lang` in the structure tree. Expected: `/Lang (en)` on the `/Span` and `/Lang (de)` on the `/Sect`, and nothing on their descendants, which inherit it. veraPDF doesn't detect it, as it can't know the text language.

The `lang` property is already computed for hyphenation, so it could be a few lines in `_build_box_tree()`: set `/Lang` when `box.style['lang']` differs from `box.style.parent_style['lang']`. It could be part of #2482. Should I open a PR?

<!-- Diff proposé, à n'envoyer que sur demande. -->

```diff
--- a/weasyprint/pdf/tags.py
+++ b/weasyprint/pdf/tags.py
@@ -195,6 +195,12 @@
     })
     pdf.add_object(element)
 
+    # Set language when it differs from the inherited one.
+    lang = box.style['lang']
+    if lang and box.style.parent_style is not None and (
+            lang != box.style.parent_style['lang']):
+        element['Lang'] = pydyf.String(lang)
+
     # Handle special cases.
     if tag == 'Figure':
         # Add extra data for images.
```
