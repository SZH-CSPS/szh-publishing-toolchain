<!--
Brouillon de pull request pour Kozea/WeasyPrint, à n'ouvrir qu'avec l'accord de Robin et
après la réponse à l'issue (ISSUE.md) : la règle CourtBouillon « Ask before sending code »
s'applique. À reformuler par Robin avant de poster.
Le diff est celui de ../../weasyprint-70.0/60-langue-element.patch, commentaires en
anglais, plus un test dans tests/test_pdf.py. Vérifié sur l'sdist 70.0 : le test échoue
sans le correctif et passe avec ; suite complète identique à l'sdist vierge (seul
tests/draw/svg/test_text.py::test_emoji_text_svg échoue, des deux côtés, faute de police
emoji sur le poste) ; ruff check sans erreur.
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

# Set /Lang on structure elements whose language differs from their parent

Related to #2482.

## Problem

With `pdf/ua-1` (or `pdf_tags=True`), the `lang` attribute of the root element becomes the catalog `/Lang`, but the `lang` attribute of other elements is ignored by the structure tree. A German abstract in a French article, an English quotation or a single foreign word are all read by screen readers with the voice of the document language.

```html
<html lang="en">
<p>An English paragraph with the French word <span lang="fr">bricolage</span>.</p>
<section lang="de"><h2>Zusammenfassung</h2><p>Ein deutscher Absatz.</p></section>
<blockquote lang="fr"><p>Une citation en français.</p></blockquote>
```

No `/Lang` is set in the structure tree. veraPDF doesn't report it, as it can't know the language of a text.

## Fix

In `_build_box_tree()`, the structure element gets a `/Lang` entry when the computed `lang` of its box differs from the `lang` of its parent style. The value is the `lang` attribute as written in HTML, the same string as the catalog `/Lang`. Descendants with the same language don't get `/Lang`, as they inherit it from the structure tree; anonymous boxes and pseudo-elements have their parent's language and don't get it either.

The `lang` property is already computed and inherited for hyphenation, so the change is limited to a few lines.

Not covered: `lang` on `<body>` (no structure element of its own) and on `<table>` (the `/Table` element is created for the anonymous table wrapper, which has the language of its parent).

## Spec references

- ISO 14289-1:2014 (PDF/UA-1), 7.2: changes of natural language in the content must be declared.
- ISO 32000-1:2008, 14.9.2 (Natural Language Specification): the `Lang` entry of a structure element dictionary (table 323) sets the language of its content, inherited by its children.
- WCAG 2.2, success criterion 3.1.2 (Language of Parts).

## Before / after

Structure tree of the example above, with the text of each element:

```
Before                                   After
/P                                       /P
  /Span "An English paragraph…"            /Span "An English paragraph…"
  /Span                                    /Span Lang=fr
    /Span "bricolage"                        /Span "bricolage"
/Sect                                    /Sect Lang=de
  /H2 …                                    /H2 …
  /P …                                     /P …
/BlockQuote                              /BlockQuote Lang=fr
  /P "Une citation en français."           /P "Une citation en français."
```

The rendering is unchanged: identical pixels at 150 and 300 dpi (pypdfium2), and veraPDF `--flavour ua1` passes before and after.

## Tests

New test in `tests/test_pdf.py`, failing before the change and passing after. The full test suite and `ruff check` give the same results as before.

```diff
--- a/weasyprint/pdf/tags.py
+++ b/weasyprint/pdf/tags.py
@@ -195,6 +195,13 @@
     })
     pdf.add_object(element)
 
+    # Set language when it differs from the inherited one. Descendants
+    # inherit it from the structure tree.
+    lang = box.style['lang']
+    if lang and box.style.parent_style is not None and (
+            lang != box.style.parent_style['lang']):
+        element['Lang'] = pydyf.String(lang)
+
     # Handle special cases.
     if tag == 'Figure':
         # Add extra data for images.
--- a/tests/test_pdf.py
+++ b/tests/test_pdf.py
@@ -859,6 +859,22 @@
     assert f'[({id}-4-0) ({id}-0-1) ({id}-0-2) ({id}-0-3)]'.encode() in pdf
 
 
+@assert_no_logs
+def test_pdf_tags_lang():
+    pdf = FakeHTML(string='''
+      <html lang="en">
+        <p>Text with <span lang="fr">un mot</span> and <span lang="en">words</span>.</p>
+        <section lang="de">
+          <h1>Titel</h1>
+          <p>Ein Satz mit <span lang="en">a word</span>.</p>
+        </section>
+      </html>
+    ''').write_pdf(pdf_tags=True)
+    assert b'/Lang (en)' in pdf  # Catalog.
+    tags = re.findall(rb'/S /(\w+)[^>]*?/Lang \((\w+)\)', pdf)
+    assert tags == [(b'Span', b'fr'), (b'Sect', b'de'), (b'Span', b'en')]
+
+
 @pytest.mark.parametrize(('html', 'fields'), [
     ('<input>', ['/Tx', '/V ()']),
     ('<input value="">', ['/Tx', '/V ()']),
```
