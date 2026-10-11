<!--
Brouillon de pull request pour Kozea/WeasyPrint, à n'ouvrir qu'avec l'accord de Robin et
après la réponse à l'issue (ISSUE.md) : la règle CourtBouillon « Ask before sending code »
s'applique. L'amont peut préférer une option au changement du séparateur. À reformuler par
Robin avant de poster.
Le diff est celui de ../../weasyprint-70.0/75-auteurs-info.patch, commentaire en anglais,
plus un test dans tests/test_pdf.py. Vérifié sur l'sdist 70.0 : le test échoue sans le
correctif et passe avec ; test_document_info (un seul auteur) passe toujours ; suite
complète identique à l'sdist vierge (seul tests/draw/svg/test_text.py::test_emoji_text_svg
échoue, des deux côtés, faute de police emoji sur le poste) ; ruff check sans erreur.
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

# Join authors with semicolons in /Author

## Problem

The `/Author` entry of the document information dictionary joins the `<meta name="author">` values with `, `. When authors are written "Name, Given name", as journals, libraries and citation styles often do, the list can't be split back into authors:

```html
<html lang="en">
<title>Two authors</title>
<meta name="author" content="Doe, Jane">
<meta name="author" content="Roe, Richard">
<p>Text.</p>
```

`/Author` is `Doe, Jane, Roe, Richard`: is it two authors or four? PDF viewers show this string in the document properties, and harvesters and reference managers read it. The XMP metadata is already fine, with one `rdf:li` per author in `dc:creator`.

## Fix

Join the authors with `; ` instead of `, `. A single author is written as before, and `dc:creator` is not changed.

## Spec references

- ISO 32000-1:2008, 14.3.3 (Document Information Dictionary), table 317: `Author` is a single text string, "the name of the person who created the document"; nothing defines how several names are separated.
- ISO 16684-1 (XMP) and Dublin Core: `dc:creator` is an ordered array, one entry per author. A separator that doesn't appear in "Name, Given name" keeps `/Author` readable as the same list.
- PDF/UA-1 doesn't constrain `/Author`; veraPDF passes before and after.

## Before / after

```
Before: /Author (Doe, Jane, Roe, Richard)
After:  /Author (Doe, Jane; Roe, Richard)
dc:creator, before and after: <rdf:Seq><rdf:li>Doe, Jane</rdf:li><rdf:li>Roe, Richard</rdf:li></rdf:Seq>
```

Identical pixels (pypdfium2), veraPDF `--flavour ua1` passes before and after.

## Tests

New test in `tests/test_pdf.py`, failing before the change and passing after. `test_document_info`, with one author, still passes. The full test suite and `ruff check` give the same results as before.

```diff
--- a/weasyprint/pdf/__init__.py
+++ b/weasyprint/pdf/__init__.py
@@ -253,7 +253,8 @@
     if metadata.title:
         pdf.info['Title'] = pydyf.String(metadata.title)
     if metadata.authors:
-        pdf.info['Author'] = pydyf.String(', '.join(metadata.authors))
+        # Use semicolons, as names can include commas ("Doe, Jane").
+        pdf.info['Author'] = pydyf.String('; '.join(metadata.authors))
     if metadata.description:
         pdf.info['Subject'] = pydyf.String(metadata.description)
     if metadata.keywords:
--- a/tests/test_pdf.py
+++ b/tests/test_pdf.py
@@ -553,6 +553,15 @@
 
 
 @assert_no_logs
+def test_document_info_authors():
+    pdf = FakeHTML(string='''
+      <meta name=author content="Doe, Jane">
+      <meta name=author content="Roe, Richard">
+    ''').write_pdf()
+    assert b'/Author (Doe, Jane; Roe, Richard)' in pdf
+
+
+@assert_no_logs
 def test_embedded_files_attachments(tmp_path):
     absolute_tmp_path = tmp_path / 'some_file.txt'
     absolute_data = b'12345678'
```

Related: #1691 (closed) shows how `/Author` and `dc:creator` are displayed side by side for several authors.
