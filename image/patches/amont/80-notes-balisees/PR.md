<!--
Brouillon de pull request pour Kozea/WeasyPrint, à n'ouvrir qu'avec l'accord de Robin et
après la réponse à l'issue (ISSUE.md, liée à #2482) : la règle CourtBouillon « Ask before
sending code » s'applique. À reformuler par Robin avant de poster.
Le diff est celui de ../../weasyprint-70.0/80-notes-balisees.patch, commentaires en
anglais, plus un test dans tests/test_pdf.py. Vérifié sur l'sdist 70.0 : le test échoue
sans le correctif et passe avec ; suite complète identique à l'sdist vierge (seul
tests/draw/svg/test_text.py::test_emoji_text_svg échoue, des deux côtés, faute de police
emoji sur le poste) ; ruff check sans erreur.
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

# Tag footnotes as /Note right after their call

Related to #2482.

## Problem

With `pdf/ua-1`, the body of a `float: footnote` is tagged where its box is drawn: the footnote area is a `/NonStruct` added after the last block of the page. Screen readers read the notes in the middle of the text, sometimes between two items of a list cut by the page. The call (`::footnote-call`) and the note number (`::footnote-marker`) are `/NonStruct` too, so nothing links a note to its call.

```html
<html lang="en">
<style>.note { float: footnote }</style>
<p>A sentence with a note<span class="note">Note in the middle of the sentence.</span> in the middle.</p>
<ul><li>first item</li><li>second item<span class="note">Note in a list item.</span></li></ul>
<p>Next paragraph.</p>
```

The structure tree is `P, L, P, NonStruct(notes)`. veraPDF doesn't report it, as it can't know that a `/NonStruct` is a note.

## Fix

In `pdf/tags.py`:

- `_get_pdf_tag()`: `::footnote-call` gives `/Reference` (ISO 32000-1 14.8.4.4, "a citation to content elsewhere in the document"), `::footnote-marker` gives `/Lbl`;
- `_build_box_tree()`: the call box keeps its element and its parent element, the footnote area keeps its element (`box.mark`, as table cells already do);
- `add_tags()`, once all pages are built: each child of a footnote area becomes a `/Note` with a unique `/ID`, and is moved from the area to the element that contains its call, right after the `/Reference`. An empty area is removed from `/Document`. The marked content doesn't move, as the structure order doesn't depend on the content stream order. A note displayed on the next page follows its call too, and as WeasyPrint never splits a footnote, it stays a single `/Note`. A note whose call has no element (in a margin box) stays in the area.
- As `/Note` requires an `/ID`, the structure tree root gets an `/IDTree` name tree, required by ISO 32000-1 table 322 as soon as an element has an `/ID`. It includes the `/ID` already set on `/TH` elements, which currently have no `/IDTree`.

The call is a `/Reference` without `/Lbl`: Acrobat's checker reports `Lbl` in `Reference` as a wrong nesting under PDF/UA-1. The `/Lbl` is in the `/Note`, around the note number.

## Spec references

- ISO 14289-1:2014 (PDF/UA-1), 7.9: notes and references are tagged as `Note` and `Reference`, and each `Note` has a unique `ID`. Matterhorn Protocol 1.1, failure conditions 19-001 to 19-004.
- ISO 32000-1:2008, 14.8.4.4 (inline-level structure elements, `Note` and `Reference`) and table 322 (`IDTree` of the structure tree root).
- PDF Association, Tagged PDF Best Practice Guide: Syntax: a `Note` follows its reference in the logical order.

## Before / after

Structure tree of the demo (100 × 80 mm pages, five notes, the last one with its call on page 1 and its body on page 2), extract:

```
Before                                   After
/P                                       /P
  /Span "A sentence with a note"           /Span "A sentence with a note"
  /NonStruct "1"                           /Reference "1"
  /Span " in the middle."                  /Note ID=note-60
/L                                           /Lbl "1. "
  /LI                                        /Span "Note in the middle of the sentence."
    /LBody "second item"                   /Span " in the middle."
      /NonStruct "2"                     /L
…                                          /LI
/NonStruct                                   /LBody "second item"
  /Span                                        /Reference "2"
    /NonStruct "1. "                           /Note ID=note-64 …
    /Span "Note in the middle…"          …
  /Span                                  /P
    /NonStruct "2. "                       /Span "A last call"
    /Span "Note in a list item."           /Reference "5"
…                                          /Note ID=note-79   (drawn on page 2)
```

Identical pixels at 150 and 300 dpi (pypdfium2), veraPDF `--flavour ua1` passes before and after.

## Tests

New test in `tests/test_pdf.py`, failing before the change and passing after. The full test suite and `ruff check` give the same results as before.

```diff
--- a/weasyprint/pdf/tags.py
+++ b/weasyprint/pdf/tags.py
@@ -64,6 +64,44 @@
         sorted_refs = [ref for _, ref in sorted(page_nums.items())]
         content_mapping['Nums'][-1].extend(sorted_refs)
 
+    # Tag each footnote as a Note with an ID, and move it right after its
+    # call, even when it is displayed on the next page. Its marked content
+    # stays where it is drawn. Footnotes whose call is not tagged stay in the
+    # footnote area.
+    calls, areas = {}, []
+    for page in document.pages:
+        for box in page._page_box.descendants():
+            if isinstance(box, boxes.FootnoteAreaBox) and hasattr(box, 'mark'):
+                areas.append(box)
+            elif getattr(box, 'footnote', None) is not None and hasattr(box, 'mark'):
+                calls.setdefault(box.element, box.mark)
+    for area in areas:
+        kids = area.mark['K']
+        if len(kids) != len(area.children):
+            continue
+        for footnote, reference in zip(area.children, tuple(kids)):
+            note = pdf.objects[int(reference.split()[0])]
+            note['S'] = '/Note'
+            note['ID'] = pydyf.String(f'note-{note.number}')
+            call_parent, call = calls.get(footnote.element, (None, None))
+            if call is not None and call.reference in call_parent['K']:
+                kids.remove(reference)
+                call_kids = call_parent['K']
+                call_kids.insert(call_kids.index(call.reference) + 1, reference)
+                note['P'] = call_parent.reference
+        if not kids and area.mark.reference in structure_document['K']:
+            structure_document['K'].remove(area.mark.reference)
+
+    # Add the ID tree, required when structure elements have IDs.
+    identifiers = sorted(
+        (object_['ID'].string, object_.reference) for object_ in pdf.objects
+        if isinstance(object_, pydyf.Dictionary) and 'ID' in object_ and
+        object_.get('Type') == '/StructElem')
+    if identifiers:
+        structure_root['IDTree'] = pydyf.Dictionary({'Names': pydyf.Array(
+            item for identifier, reference in identifiers
+            for item in (pydyf.String(identifier), reference))})
+
     # Add annotations for links and widgets.
     start = len(document.pages)
     for i, (reference, annotation) in enumerate(annotations, start=start):
@@ -83,6 +121,11 @@
     """Get PDF tag corresponding to HTML tag."""
     if tag is None:
         return 'NonStruct'
+    elif tag.endswith('::footnote-call'):
+        # Footnote calls reference the Note that follows them.
+        return 'Reference'
+    elif tag.endswith('::footnote-marker'):
+        return 'Lbl'
     elif tag == 'div':
         return 'Div'
     elif tag.split(':')[0] == 'a':
@@ -314,6 +357,12 @@
         assert kid['mcid'] not in nums
         nums[kid['mcid']] = element.reference
 
+    # Keep elements of footnote calls and areas, to move notes after calls.
+    if box.footnote is not None:
+        box.mark = (parent, element)
+    elif isinstance(box, boxes.FootnoteAreaBox):
+        box.mark = element
+
     # Link table cells to related headers.
     if tag == 'Table':
         def _get_rows(table_box):
--- a/tests/test_pdf.py
+++ b/tests/test_pdf.py
@@ -859,6 +859,30 @@
     assert f'[({id}-4-0) ({id}-0-1) ({id}-0-2) ({id}-0-3)]'.encode() in pdf
 
 
+@assert_no_logs
+def test_pdf_tags_footnotes():
+    pdf = FakeHTML(string='''
+      <html lang="en">
+        <style>.note { float: footnote }</style>
+        <p>Text<span class="note">First note.</span> and text.</p>
+        <ul><li>Item<span class="note">Second note.</span></li></ul>
+        <p>Last paragraph.</p>
+      </html>
+    ''').write_pdf(pdf_tags=True)
+    tags = dict(re.findall(rb'(\d+) 0 obj\n<</Type /StructElem/S /(\w+)', pdf))
+    assert list(tags.values()).count(b'Note') == 2
+    assert b'/IDTree' in pdf
+    # Each note follows its call, in the paragraph or list item body.
+    notes = 0
+    for kids in re.findall(rb'/S /(?:P|LBody)/K \[([^\]]*)\]', pdf):
+        kids = [tags.get(number) for number in re.findall(rb'(\d+) 0 R', kids)]
+        for previous, kid in zip([None, *kids], kids):
+            if kid == b'Note':
+                assert previous == b'Reference'
+                notes += 1
+    assert notes == 2
+
+
 @pytest.mark.parametrize(('html', 'fields'), [
     ('<input>', ['/Tx', '/V ()']),
     ('<input value="">', ['/Tx', '/V ()']),
```
