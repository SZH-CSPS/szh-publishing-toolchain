<!--
Brouillon de pull request pour Kozea/WeasyPrint, à n'ouvrir qu'avec l'accord de Robin et
après la réponse à l'issue (ISSUE.md) : la règle CourtBouillon « Ask before sending code »
s'applique. À reformuler par Robin avant de poster.
Le diff est celui de ../../weasyprint-70.0/90-un-mcid-par-element.patch, commentaires en
anglais, plus un test dans tests/test_pdf.py. Vérifié sur l'sdist 70.0 : le test échoue
sans le correctif (11 MCID au lieu de 7) et passe avec ; suite complète identique à
l'sdist vierge (seul tests/draw/svg/test_text.py::test_emoji_text_svg échoue, des deux
côtés, faute de police emoji sur le poste) ; ruff check sans erreur.
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

# Share marked content between lines of a block

## Problem

With `pdf_tags=True` or `pdf/ua-1`, each line of a paragraph is a separate marked content, with its own MCID and its own `/Span` structure element:

```html
<html lang="en">
<p style="width: 10em">Participation is measured by what each pupil can do, and not by what the school lets them watch.</p>
```

The PDF viewer of Edge (and Chrome) exposes each marked content as a separate text node, trimmed of its leading and trailing spaces. NVDA reads consecutive nodes without separator: the last word of a line is stuck to the first word of the next one ("and" + "not" is read "andnot"). Nothing in ISO 32000-1 or PDF/UA requires one marked content per line; Word and LibreOffice write one per paragraph, and Edge then exposes the paragraph as a single node, with spaces between lines.

Before 66.0, a paragraph had a single MCID (see the structure tree shown in #2153). Since #2471, marked content is created for each text box.

## Fix

- `draw_block_level()` declares the block whose lines it draws, with a new `Stream.text_block()` context manager.
- In `Stream.marked()`, when a text box is the text of this block (same element and same pseudo-element) and nothing has been drawn since the `EMC` of the previous text of the block, the `EMC` is removed and no new marked content is opened. The box is not stored in the tags.
- `_build_box_tree()` skips text boxes without tags: their text is already in the `/Span` of the previous line.

What stays separate:

- text of inline elements (`em`, links, `span lang`, footnote calls): their text boxes don't belong to the block element, so they keep their own marked content, and the text of the block after them starts a new one;
- pages: each page has its own stream, marked content never spans two pages;
- fragments of a block (columns) and anonymous blocks of the same element: the key is the block box, not the element;
- lines with something drawn in between (inline images, backgrounds).

Rendering doesn't change: only `EMC`/`BDC` pairs are removed, and the following `ET`/`BT` pair is merged by `begin_text()`, as it already is without tags. Each text box sets its text matrix.

## Before / after

Edge, text nodes of the accessibility tree (MSAA, without screen reader) for a justified paragraph of four lines on A5:

```
Before
  "Participation is measured by what each pupil can do, and"
  "not by what the school lets them watch. Adjustments are"
  "discussed with the family and written down in a plan that"
  "states the levels and the measures."
After
  "Participation is measured by what each pupil can do, and not by what the school
   lets them watch. Adjustments are discussed with the family and written down in a
   plan that states the levels and the measures."
```

veraPDF `--flavour ua1`: PASS before and after. Identical pixels at 150 and 300 dpi (pypdfium2). Text extracted by pdfium and pypdf is the same.

## Tests

New test in `tests/test_pdf.py`, failing before the change (11 MCIDs instead of 7) and passing after. The full test suite and `ruff check` give the same results as before.

```diff
--- a/tests/test_pdf.py
+++ b/tests/test_pdf.py
@@ -859,6 +859,27 @@
     assert f'[({id}-4-0) ({id}-0-1) ({id}-0-2) ({id}-0-3)]'.encode() in pdf
 
 
+@assert_no_logs
+def test_pdf_tags_marked_content_lines():
+    pdf = FakeHTML(string='''
+      <html lang="en">
+        <style>
+          @page { size: 100px 400px; margin: 0 }
+          body { font: 10px weasyprint }
+          p { width: 30px; margin: 0 }
+        </style>
+        <p>aa bb cc dd</p>
+        <p>ee <em>ff</em> gg <a href="#x">hh</a> ii jj</p>
+        <p id="x">kk</p>
+      </html>
+    ''').write_pdf(pdf_tags=True)
+    # One word per line. Lines of a paragraph share marked content, inline
+    # elements keep theirs: "aa" to "dd", "ee", "ff", "gg", "hh", "ii" and "jj",
+    # "kk".
+    assert pdf.count(b'/MCID') == 7
+    assert pdf.count(b'/S /Span') == 6
+
+
 @pytest.mark.parametrize(('html', 'fields'), [
     ('<input>', ['/Tx', '/V ()']),
     ('<input value="">', ['/Tx', '/V ()']),
--- a/weasyprint/draw/__init__.py
+++ b/weasyprint/draw/__init__.py
@@ -652,6 +652,7 @@
                 draw_replacedbox(stream, block)
         elif block.children:
             if isinstance(block.children[-1], boxes.LineBox):
-                for child in block.children:
-                    draw_inline_level(stream, page, child)
+                with stream.text_block(block):
+                    for child in block.children:
+                        draw_inline_level(stream, page, child)
         draw_block_level(page, stream, blocks_and_cells)
--- a/weasyprint/pdf/stream.py
+++ b/weasyprint/pdf/stream.py
@@ -286,13 +286,35 @@
             mcid = len(self._tags)
             assert box not in self._tags
             self._tags[box] = {'tag': tag, 'mcid': mcid}
-            property_list = pydyf.Dictionary({'MCID': mcid})
-            super().begin_marked_content(tag, property_list)
+            # Keep the text of a block in the marked content of its previous line
+            # when nothing has been drawn in between: the previous EMC is removed,
+            # the box gets no MCID and no Span (see tags.py).
+            block = self._text_block
+            continued = block is not None and tag == 'Span' and (
+                box.element is block.element and box.element_tag == block.element_tag)
+            if continued and self._last_text == (block, len(self.stream)):
+                del self._tags[box]
+                self.stream.pop()
+            else:
+                property_list = pydyf.Dictionary({'MCID': mcid})
+                super().begin_marked_content(tag, property_list)
         try:
             yield
         finally:
             if self._tags is not None:
                 super().end_marked_content()
+                self._last_text = (block if continued else None, len(self.stream))
+
+    _text_block = _last_text = None
+
+    @contextmanager
+    def text_block(self, block):
+        """Draw the lines of a block, whose text can share marked content."""
+        previous, self._text_block = self._text_block, block
+        try:
+            yield
+        finally:
+            self._text_block = previous
 
     @contextmanager
     def artifact(self):
--- a/weasyprint/pdf/tags.py
+++ b/weasyprint/pdf/tags.py
@@ -273,7 +273,11 @@
         for child in children:
             if isinstance(child, boxes.TextBox):
                 # Add marked element from the stream.
-                kid = tags.pop(child)
+                kid = tags.pop(child, None)
+                if kid is None:
+                    # Text drawn in the marked content of the previous line,
+                    # already in the tree (see Stream.marked).
+                    continue
                 assert kid['mcid'] not in nums
                 if tag == 'Link':
                     # Associate MCID directly with link reference.
```
