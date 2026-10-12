<!--
Brouillon de pull request pour Kozea/WeasyPrint, à n'ouvrir qu'avec l'accord de Robin et
après une réponse favorable à l'issue (ISSUE.md) : la règle CourtBouillon « Ask before
sending code » s'applique. À reformuler par Robin avant de poster.
Le diff est celui de ../../weasyprint-70.0/90-un-mcid-par-element.patch, commentaires en
anglais, plus un test dans tests/test_pdf.py. Il suppose l'espace de fin de ligne dans la
couche texte (correctifs 20 et 25) : sans elle, rien ne se fusionne d'une ligne à l'autre.
Vérifié sur l'sdist 70.0 + 20 + 25 : le test échoue sans le correctif (16 MCID au lieu de
12) et passe avec ; suite complète identique à l'sdist vierge (seul
tests/draw/svg/test_text.py::test_emoji_text_svg échoue, des deux côtés, faute de police
emoji sur le poste) ; ruff check : aucune erreur dans les lignes du 90 (les deux E501
restants sont dans les commentaires français du 20 et du 25).
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

# Share marked content between lines of a block

## Problem

With `pdf_tags=True` or `pdf/ua-1`, each line of a paragraph is a separate marked content, with its own MCID and its own `/Span` structure element.

The PDF viewer of Edge (powered by Adobe Acrobat, with its own accessibility layer) exposes each marked content as a separate text node, trimmed of its leading and trailing spaces. NVDA reads consecutive nodes without separator: the last word of a line is stuck to the first word of the next one ("and" + "not" is read "andnot"). Nothing in ISO 32000-1 or PDF/UA requires one marked content per line; Word and LibreOffice write one per paragraph, and Edge then exposes the paragraph as a single node.

Before 66.0, a paragraph had a single MCID (see the structure tree shown in #2153). Since #2471, marked content is created for each text box.

## Fix

- `_text_follows()` lists, once for each page, the text boxes whose direct previous sibling is a text box of the same element, in the order used by `_build_box_tree()` (children of lines flattened), not in the drawing order: images, SVG, floats and positioned elements are drawn later, but stay between their text in the structure tree. Across lines, the previous box must end with a space or a hyphen.
- `draw_block_level()` gives this list to `Stream.text_block()` while drawing lines.
- In `Stream.marked()`, a listed text box continues the marked content of the box it follows when this box is the last marked one and nothing has been drawn since its `EMC`: the `EMC` is removed, no new marked content is opened, and the box is flagged.
- `_build_box_tree()` skips flagged boxes; other text boxes are still required in the tags.

Across lines, this relies on the space at the end of the line being kept in the text layer: without a space or a hyphen, readers that take the text of the marked content as is (Acrobat) would stick the words together. The check reads the last glyph actually drawn (kept by `Stream.show_text()`, read through the font's ToUnicode), as the space is not drawn for right-to-left lines, truncated lines or bitmap and color fonts. That's why lines ending with `<br>`, lines of `pre`, right-to-left lines and lines without this space keep their own marked content.

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

New test in `tests/test_pdf.py`, failing before the change (16 MCIDs instead of 12) and passing after. The full test suite gives the same results as before.

```diff
--- a/tests/test_pdf.py
+++ b/tests/test_pdf.py
@@ -859,6 +859,30 @@
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
+        <p>kk<img src="pattern.png" alt="ll">mm</p>
+        <p>nn<br>oo</p>
+        <p id="x">pp</p>
+      </html>
+    ''', base_url=resource_path('<inline HTML>')).write_pdf(pdf_tags=True)
+    # One word per line. Lines of a paragraph share marked content after a space,
+    # inline elements keep theirs, and text after an image or a line break starts
+    # a new one: "aa" to "dd", "ee", "ff", "gg", "hh", "ii" and "jj", "kk", "ll",
+    # "mm", "nn", "oo", "pp".
+    assert pdf.count(b'/MCID') == 12
+    assert pdf.count(b'/S /Span') == 10
+
+
 @pytest.mark.parametrize(('html', 'fields'), [
     ('<input>', ['/Tx', '/V ()']),
     ('<input value="">', ['/Tx', '/V ()']),
--- a/weasyprint/draw/__init__.py
+++ b/weasyprint/draw/__init__.py
@@ -652,6 +652,38 @@
                 draw_replacedbox(stream, block)
         elif block.children:
             if isinstance(block.children[-1], boxes.LineBox):
-                for child in block.children:
-                    draw_inline_level(stream, page, child)
+                with stream.text_block(_text_follows(page)):
+                    for child in block.children:
+                        draw_inline_level(stream, page, child)
         draw_block_level(page, stream, blocks_and_cells)
+
+
+def _text_follows(page):
+    """Get text boxes of page continuing the previous text box.
+
+    Boxes are in the order used by _build_box_tree (pdf/tags.py), not in the
+    drawing order where images, floats and positioned elements are drawn later. A
+    text box continues the previous one if it is its direct sibling with the same
+    element. Values are (previous box, whether it is on the previous line).
+    Computed once for each page, on the original tree, whose text boxes are the
+    drawn ones.
+
+    """
+    follows = getattr(page, 'text_follows', None)
+    if follows is not None:
+        return follows
+    follows = page.text_follows = {}
+    parents = [page]
+    while parents:
+        before = None
+        for child in getattr(parents.pop(), 'children', ()):
+            line = isinstance(child, boxes.LineBox)
+            for index, kid in enumerate(child.children if line else [child]):
+                if not isinstance(kid, boxes.TextBox):
+                    parents.append(kid)
+                elif (isinstance(before, boxes.TextBox) and
+                        kid.element is before.element and
+                        kid.element_tag == before.element_tag):
+                    follows[kid] = (before, index == 0)
+                before = kid
+    return follows
--- a/weasyprint/pdf/stream.py
+++ b/weasyprint/pdf/stream.py
@@ -286,13 +286,65 @@
             mcid = len(self._tags)
             assert box not in self._tags
             self._tags[box] = {'tag': tag, 'mcid': mcid}
-            property_list = pydyf.Dictionary({'MCID': mcid})
-            super().begin_marked_content(tag, property_list)
+            # Keep a text box that continues the last marked box (see text_block)
+            # in its marked content when nothing has been drawn since its EMC: the
+            # EMC is removed, the box gets no MCID and no Span (see tags.py).
+            # Across lines, the drawn text of the previous box must end with a
+            # space or a hyphen, otherwise words would be stuck together.
+            follows, new_line = self._follows.get(box, (None, False))
+            box.continued_mark = tag == 'Span' and follows is not None and (
+                self._last_mark == (follows, len(self.stream))) and (
+                not new_line or self._shown_separator())
+            self._last_shown = None
+            if box.continued_mark:
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
+                self._last_mark = (box, len(self.stream))
+
+    _follows, _last_mark, _last_shown = {}, None, None
+
+    @contextmanager
+    def text_block(self, follows):
+        """Draw lines whose text can continue marked content.
+
+        ``follows`` maps text boxes to the text boxes they continue, and whether
+        these are on the previous line.
+
+        """
+        previous, self._follows = self._follows, follows
+        try:
+            yield
+        finally:
+            self._follows = previous
+
+    def show_text(self, text):
+        super().show_text(text)
+        self._last_shown = (self._current_font, text)
+
+    def _shown_separator(self):
+        """Return whether the last drawn glyph is a space or a hyphen."""
+        if self._last_shown is None or self._last_shown[0] is None:
+            return False
+        (key, _), text = self._last_shown
+        text = str(text)
+        start, end = text.rfind('<'), text.rfind('>')
+        if start < 0 or end < start:
+            return False
+        for font in self._fonts.values():
+            if font.hash == key:
+                size = 2 if font.bitmap else 4
+                glyph = text[start + 1:end][-size:]
+                last = font.to_unicode.get(int(glyph, 16), '')[-1:] if glyph else ''
+                return bool(last) and (last.isspace() or last in '-‐‑–—\xad')
+        return False
 
     @contextmanager
     def artifact(self):
--- a/weasyprint/pdf/tags.py
+++ b/weasyprint/pdf/tags.py
@@ -273,6 +273,10 @@
         for child in children:
             if isinstance(child, boxes.TextBox):
                 # Add marked element from the stream.
+                if getattr(child, 'continued_mark', False):
+                    # Text drawn in the marked content of the previous box,
+                    # already in the tree (see Stream.marked).
+                    continue
                 kid = tags.pop(child)
                 assert kid['mcid'] not in nums
                 if tag == 'Link':
```
