<!--
Canevas suivi : aucun modèle d'issue ni de PR dans Kozea/WeasyPrint ; CONTRIBUTING.md renvoie
aux « Guidelines for Contributors » de CourtBouillon (avec ses mots, court, sans intertitres,
un exemple court, demander avant d'envoyer du code). Voir ../README.md. Suite de #2432 /
#2437 : une nouvelle issue qui les cite, plutôt qu'un commentaire sur une issue fermée. Le
diff n'est à envoyer en PR que si liZe le demande, avec un test dans
tests/layout/test_footnotes.py à côté de test_footnote_report_orphans. À reformuler par Robin
avant de poster.
Titre proposé : Footnote reported away from its call because of a later paragraph's orphans
Tout ce qui est au-dessus de cette ligne n'est pas à poster.
-->

Hi!

Since #2437, when a paragraph can't keep enough lines for `orphans`, WeasyPrint reports footnotes to the next page. But it reports any footnote of the page, even one called in an earlier paragraph, that fits with its call.

```html
<style>
  @page { size: 100mm 80mm; margin: 10mm; @footnote { margin-top: 1mm } }
  body { font: 4mm/5mm sans-serif; margin: 0; orphans: 2; widows: 2 }
  p { margin: 0 }
  span { float: footnote }
  ::footnote-call { line-height: 0; vertical-align: super; font-size: 70% }
</style>
<p>a1<span>note, line 1<br>note, line 2</span><br>a2<br>a3</p>
<p>b1<br>b2<br>b3<br>b4<br>b5</p>
<p>c1<br>c2<br>c3<br>c4<br>c5</p>
```

The footnote fits on page 1 with its call. But to keep `c1` and `c2` on page 1, it's moved to page 2. I'd expect `c1` to go to page 2, as without footnotes, and the footnote to stay on page 1.

Only reporting the footnotes called in the lines of the current box, and using `_break_line()` otherwise, fixes it for us, and `test_footnote_report_orphans` still passes. Should I open a PR?

<!-- Diff proposé, à n'envoyer que sur demande. -->

```diff
--- a/weasyprint/layout/block.py
+++ b/weasyprint/layout/block.py
@@ -396,7 +396,14 @@
             needed = max(0, needed)
             report = not context.in_column and can_break_now and not could_break_before
             reported_footnotes = 0
-            while report and context.current_page_footnotes:
+            # Only report footnotes called in the lines of this box already laid out on
+            # this page: footnotes called earlier on the page stay with their calls,
+            # and the start of this box is pushed to the next page instead.
+            own_footnotes = [
+                descendant.footnote for previous_line in new_children
+                for descendant in previous_line.descendants() if descendant.footnote]
+            while (report and context.current_page_footnotes and
+                   context.current_page_footnotes[-1] in own_footnotes):
                 context.report_footnote(context.current_page_footnotes[-1])
                 reported_footnotes += 1
                 if not context.overflows_page(bottom_space, new_position_y + offset_y):
```
