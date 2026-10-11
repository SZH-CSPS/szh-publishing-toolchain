<!--
Brouillon de pull request pour Kozea/WeasyPrint, à n'ouvrir qu'avec l'accord de Robin et
après la réponse à l'issue et au commentaire sur #2874 (ISSUE.md) : la règle CourtBouillon
« Ask before sending code » s'applique. Sur les sous-listes, liZe a retenu la lecture
inverse dans #2874 et la PR #2879 : présenter les sources, ne pas insister. Si l'amont la
maintient, la PR peut se réduire à <li><p> et <dl>. À reformuler par Robin avant de poster.
Le diff est celui de ../../weasyprint-70.0/85-listes-imbriquees.patch, commentaires en
anglais, plus un test dans tests/test_pdf.py. Vérifié sur l'sdist 70.0 : le test échoue
sans le correctif et passe avec ; test_pdf_tags_nested_lists_order (#2874) passe toujours ;
suite complète identique à l'sdist vierge (seul
tests/draw/svg/test_text.py::test_emoji_text_svg échoue, des deux côtés, faute de police
emoji sur le poste) ; ruff check sans erreur.
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

# Put list item content in /LBody, tag definition lists as /Lbl and /LBody

Related to #2482, #2874 and #2879.

## Problem

Three list cases give a structure that doesn't follow ISO 32000-1 table 336 with `pdf/ua-1`:

```html
<html lang="en">
<ul><li>ba<ul><li>b1</li><li>b2</li></ul>bb</li></ul>
<ol><li><p>Step one</p></li></ol>
<dl><dt>Term</dt><dd>Definition.</dd><dd>Second definition.</dd></dl>
```

- The `<p>` of `<li><p>` is a direct child of the `/LI`. veraPDF fails on PDF/UA-1 rule 7.2-20, "LI element may contain only Lbl and LBody elements".
- The `<dl>` gives one `/LI` for each `<dt>` and each `<dd>`, each with a `/LBody` and no `/Lbl`: nothing links a term to its definitions (there's a "TODO: dt should be different" in `_get_pdf_tag()`).
- The nested `<ul>` is a `/L` child of the parent `/L`, sibling of the `/LI` elements, and the text after it ("bb") goes into a second `/LBody` of the item.

About nested lists, #2874 chose to keep the nested `/L` as a direct child of the parent `/L`. I'd like to suggest the other reading, with the sources it relies on:

- ISO 32000-1:2008, table 336 lists the children of `L` as `LI` elements (and an optional `Caption`), and the children of `LI` as `Lbl` and `LBody`. A `/L` directly in a `/L` is not among them.
- The PDF Association's PDF/UA techniques (Tagged PDF and PDF/UA, beta) describe nested lists in technique L_05: the nested `L` is a child of the `LBody` of the item that introduces it. Failure L_F07 is the nested list placed outside the `LBody`. A `L` directly in a `L` is only shown for hierarchical lists (L_12), not for the sub-list of an item.
- The same techniques tag description lists as `L > LI > Lbl (term) + LBody (description)`, with no `ListNumbering` or `/None` (L_14).

## Fix

In `_build_box_tree()`:

- every child of a `/LI` other than its marker goes into the `/LBody` of the item. The anonymous box of the item text stays the `/LBody`; a nested list or a block that comes before any text creates one. Text after a nested list stays in the same `/LBody`. With an inline marker (`list-style-position: inside`), there's no anonymous box and the text boxes are direct children of the item line, between its inline elements: they go into the `/LBody` too, so that `<li>a <em>b</em> c</li>` is read in order, and not as "a b" then "c" after the other inline elements;
- in a `/L`, consecutive `dt` and `dd` share a `/LI`: each `dt` is a `/Lbl`, each `dd` a `/LBody`. A `dt` after a `dd` starts a new `/LI`, and a `dd` without term gives a `/LI` without `/Lbl`. Several definitions give several `/LBody`, several terms several `/Lbl`, as table 336 allows "one or more labels (Lbl) or list bodies (LBody) or both";
- the nested list is still built after the text of its item, so the order fixed by #2879 is kept, and `test_pdf_tags_nested_lists_order` still passes.

No `/ListNumbering` is added: its default value, `/None`, is right for definition lists.

Not covered: a list split by a page break stays two `/L`, as WeasyPrint builds a tree for each page (#2903).

## Spec references

- ISO 32000-1:2008, 14.8.4.3.3 (list elements) and table 336.
- ISO 14289-1:2014 (PDF/UA-1), 7.6 (lists), and veraPDF rule 7.2-20.
- PDF Association, PDF/UA techniques L_05, L_F07, L_12 and L_14.

## Before / after

Structure tree of the demo, extract:

```
Before                                   After
/L                                       /L
  /LI                                      /LI
    /Lbl "• "                                /Lbl "• "
    /LBody "ba "                             /LBody
    /LBody "bb "                               /Span "ba "
  /L                                           /L
    /LI /Lbl "◦ " /LBody "b1"                    /LI /Lbl "◦ " /LBody "b1"
    /LI /Lbl "◦ " /LBody "b2"                    /LI /Lbl "◦ " /LBody "b2"
                                               /NonStruct "bb "
/L                                       /L
  /LI                                      /LI
    /Lbl "1. "                               /Lbl "1. "
    /P "Step one"                            /LBody
                                               /P "Step one"
/L   (dl)                                /L   (dl)
  /LI /LBody "Speech therapy"              /LI
  /LI /LBody "Support for language."         /Lbl "Speech therapy"
  /LI /LBody "Psychomotor therapy"           /LBody "Support for language."
  /LI /LBody "Support for movement."       /LI
  /LI /LBody "Second definition…"            /Lbl "Psychomotor therapy"
                                             /LBody "Support for movement."
                                             /LBody "Second definition…"
```

veraPDF `--flavour ua1`: FAIL before (7.2-20), PASS after. Identical pixels at 150 and 300 dpi (pypdfium2).

## Tests

New test in `tests/test_pdf.py` (nested list, paragraph in a list item, definition list, list item with an inline marker), failing before the change and passing after. The full test suite and `ruff check` give the same results as before.

```diff
--- a/tests/test_pdf.py
+++ b/tests/test_pdf.py
@@ -859,6 +859,35 @@
     assert f'[({id}-4-0) ({id}-0-1) ({id}-0-2) ({id}-0-3)]'.encode() in pdf
 
 
+@assert_no_logs
+def test_pdf_tags_nested_and_definition_lists():
+    pdf = FakeHTML(string='''
+      <html lang="en">
+        <ul><li>a<ul><li>b</li></ul>c</li></ul>
+        <ol><li><p>d</p></li></ol>
+        <dl><dt>e</dt><dd>f</dd><dd>g</dd><dt>h</dt><dt>i</dt><dd>j</dd></dl>
+        <ul style="list-style-position: inside"><li>k <em>l</em> m</li></ul>
+      </html>
+    ''').write_pdf(pdf_tags=True)
+    tags = dict(re.findall(rb'(\d+) 0 obj\n<</Type /StructElem/S /(\w+)', pdf))
+    children = {}
+    for tag, kids in re.findall(rb'/S /(\w+)/K \[([^\]]*)\]', pdf):
+        children.setdefault(tag, []).append(
+            [tags.get(number) for number in re.findall(rb'(\d+) 0 R', kids)])
+    for kids in children[b'L']:
+        assert set(kids) == {b'LI'}
+    for kids in children[b'LI']:
+        assert set(kids) <= {b'Lbl', b'LBody'}
+    # Nested list and paragraph in list item bodies.
+    assert [b'Span', b'L', b'NonStruct'] in children[b'LBody']
+    assert [b'P'] in children[b'LBody']
+    # Terms and definitions grouped in list items.
+    assert [b'Lbl', b'LBody', b'LBody'] in children[b'LI']
+    assert [b'Lbl', b'Lbl', b'LBody'] in children[b'LI']
+    # Text of list items with inline markers in order in the body.
+    assert [b'Span', b'NonStruct', b'Span'] in children[b'LBody']
+
+
 @pytest.mark.parametrize(('html', 'fields'), [
     ('<input>', ['/Tx', '/V ()']),
     ('<input value="">', ['/Tx', '/V ()']),
--- a/weasyprint/pdf/tags.py
+++ b/weasyprint/pdf/tags.py
@@ -123,6 +123,19 @@
         return 'NonStruct'
 
 
+def _new_element(tag, parent, pdf, page_number):
+    """Create a structure element without box, child of parent."""
+    element = pydyf.Dictionary({
+        'Type': '/StructElem',
+        'S': f'/{tag}',
+        'K': pydyf.Array([]),
+        'Pg': pdf.page_references[page_number],
+        'P': parent.reference,
+    })
+    pdf.add_object(element)
+    return element
+
+
 def _build_box_tree(box, parent, pdf, page_number, nums, annotations, tags):
     """Recursively build tag tree for given box and yield children."""
 
@@ -156,14 +169,14 @@
     elif tag == 'LI':
         # Ignore anonymous blocks created for lists and bullets.
         anonymous_list_element = parent['S'] == '/LI'
-        anonymous_li_child = parent['S'] == '/LBody'
+        anonymous_li_child = parent['S'] in ('/LBody', '/Lbl')
         dl_item = box.element_tag in ('dt', 'dd')
         no_bullet_li = box.element_tag == 'li' and (
             'list-item' not in box.style['display'] or
             box.style['list_style_type'] == 'none')
         if anonymous_list_element:
-            # Store as list item body.
-            tag = 'LBody'
+            # Store as list item body, or as label for a term of a definition list.
+            tag = 'Lbl' if box.element_tag == 'dt' else 'LBody'
         elif anonymous_li_child:
             # Store as non struct list item body child.
             tag = 'NonStruct'
@@ -268,6 +281,8 @@
         element['K'].append(form_element.reference)
 
     # Build tree for box children.
+    body = item = None  # List item body, current item of definition list.
+    item_has_body = False
     for child in box.children:
         children = child.children if isinstance(child, boxes.LineBox) else [child]
         for child in children:
@@ -280,32 +295,55 @@
                     element['K'].append(kid['mcid'])
                     nums[kid['mcid']] = element.reference
                 else:
+                    # Put text of list items with inline markers in their
+                    # body, with the inline elements around it.
+                    text_parent = element
+                    if element['S'] == '/LI':
+                        if body is None:
+                            body = _new_element('LBody', element, pdf, page_number)
+                            element['K'].append(body.reference)
+                        text_parent = body
                     kid_element = pydyf.Dictionary({
                         'Type': '/StructElem',
                         'S': f'/{kid["tag"]}',
                         'K': pydyf.Array([kid['mcid']]),
                         'Pg': pdf.page_references[page_number],
-                        'P': element.reference,
+                        'P': text_parent.reference,
                     })
                     pdf.add_object(kid_element)
-                    element['K'].append(kid_element.reference)
+                    text_parent['K'].append(kid_element.reference)
                     nums[kid['mcid']] = kid_element.reference
             else:
                 # Recursively build tree for child.
-                if child.element_tag in ('ul', 'ol') and element['S'] == '/LI':
-                    # In PDFs, nested lists are linked to the parent list, but in
-                    # HTML, nested lists are linked to a parent’s list item.
-                    child_parent = parent
-                else:
-                    child_parent = element
+                # Put nested lists and other blocks of list items in the list
+                # item body, created if needed. In definition lists, list items
+                # group terms (Lbl) and their definitions (LBody), a term after a
+                # definition starts a new item.
+                child_parent = element
+                if element['S'] == '/LI' and child.element_tag != 'li::marker' and (
+                        body is not None or child.element_tag != 'li'):
+                    if body is None:
+                        body = _new_element('LBody', element, pdf, page_number)
+                        element['K'].append(body.reference)
+                    child_parent = body
+                elif element['S'] == '/L' and child.element_tag in ('dt', 'dd'):
+                    if item is None or (child.element_tag == 'dt' and item_has_body):
+                        item = _new_element('LI', element, pdf, page_number)
+                        element['K'].append(item.reference)
+                        item_has_body = False
+                    item_has_body |= child.element_tag == 'dd'
+                    child_parent = item
                 # Keep the current number of parent children, so that we can add the
                 # new children before the possible grandchildren, for example for
                 # lists.
                 child_index = len(child_parent['K'])
-                child_elements = _build_box_tree(
-                    child, child_parent, pdf, page_number, nums, annotations, tags)
+                child_elements = tuple(_build_box_tree(
+                    child, child_parent, pdf, page_number, nums, annotations, tags))
                 child_parent['K'][child_index:child_index] = [
                     element.reference for element in child_elements]
+                for child_element in child_elements:
+                    if child_parent is element and child_element['S'] == '/LBody':
+                        body = child_element
 
     if isinstance(box, boxes.ReplacedBox):
         # Add replaced box.
```
