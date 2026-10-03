<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code). Voir ../README.md. Le diff, sous la
seconde ligne de séparation, n'est à envoyer en PR que si liZe le demande, avec un test dans
tests/layout/test_footnotes.py à côté de test_reported_footnote_repagination. À reformuler
par Robin avant de poster.
Titre proposé : Reported footnote drawn twice after repagination
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

When a footnote is reported to the next page and the document is repaginated because of `target-counter()`, the footnote can be drawn twice.

```html
<style>
  @page { size: 100mm 80mm; margin: 10mm }
  body { font: 4mm/5mm sans-serif; margin: 0; orphans: 1; widows: 1 }
  p { margin: 0 }
  span { float: footnote }
  a::after { content: " p" target-counter(attr(href), page) }
  .break { break-before: page }
</style>
<p>a1 <a href="#end">link</a><br>a2<br>a3<br>a4<br>a5<br>a6<br>a7<br>a8<br>a9<br>a10<br>a11<span>note, line 1<br>note, line 2</span></p>
<p>b1</p>
<p class="break">c1 <a href="#end">link</a></p>
<p class="break" id="end">end</p>
```

The footnote doesn't fit on page 1 and goes to page 2, that's fine. But it's also drawn on page 3. With `max_loops=1`, it's only on page 2.

During the second loop, page 1 is laid out again and reports the footnote into `context.reported_footnotes`. Page 2 is up-to-date and skipped, so the list isn't consumed, and page 3 (laid out again for its own `target-counter()`) starts with it. It looks like #1700, but the fix there only handled the last page.

Keeping the list of reported footnotes in the `page_maker` state of the next page, and restoring it in `remake_page()`, fixes it for us. Should I open a PR?

<!-- Diff proposé, à n'envoyer que sur demande. -->

```diff
--- a/weasyprint/layout/page.py
+++ b/weasyprint/layout/page.py
@@ -969,7 +969,11 @@
 
     """
     page_maker = context.page_maker
-    resume_at, next_page, right_page, page_state, _ = page_maker[index]
+    resume_at, next_page, right_page, page_state, remake_state = page_maker[index]
+
+    # Footnotes reported by the previous page, as they were when it was laid out:
+    # this page may follow an up-to-date page that has not been laid out again.
+    context.reported_footnotes = list(remake_state.get('reported_footnotes', ()))
 
     # PageType for current page, values for page_maker[index + 1].
     # Don't modify actual page_maker[index] values!
@@ -1008,13 +1012,15 @@
         page_maker_next_changed = True
     else:
         # Check whether something changed
-        next_resume_at, next_next_page, next_right_page, next_page_state, _ = (
-            page_maker[index + 1])
+        (next_resume_at, next_next_page, next_right_page, next_page_state,
+         next_remake_state) = page_maker[index + 1]
         page_maker_next_changed = (
             next_resume_at != resume_at or
             next_next_page != next_page or
             next_right_page != right_page or
-            next_page_state != page_state)
+            next_page_state != page_state or
+            next_remake_state.get('reported_footnotes', []) !=
+            context.reported_footnotes)
 
     if page_maker_next_changed:
         # Reset remake_state
@@ -1023,6 +1029,7 @@
             'pages_wanted': False,
             'anchors': [],
             'content_lookups': [],
+            'reported_footnotes': list(context.reported_footnotes),
         }
         # Setting content_changed to True ensures remake.
         # If resume_at is None (last page) it must be False to prevent endless
```
