# Patch 55: a footnote stays on the page of its call

Patch: `image/patches/weasyprint-70.0/55-notes-reportees.patch` (`weasyprint/layout/block.py`).
Validated by Robin on 03.10.2026. Written in English, as asked by the supervisor, so it can
feed an upstream report; the issue text in `ISSUE.md` is still to be rewritten by Robin.

## The defect

A footnote leaves the page of its call although it fits there: the call is on page 1, the
footnote on page 2. It happens when a **later** paragraph, at the bottom of the page, has
exactly `orphans − 1` lines on the page: to fit one more line of that paragraph,
WeasyPrint moves away the footnotes already on the page, starting with the last one, even
when they belong to a paragraph laid out higher up. Seen in the journal and in books, rarely:
1 text length out of 50 tried in a fake journal article (`orphans: 3` of Pronto).

`demo/reportee.html`, 100 × 80 mm pages, `orphans: 2`, no Pronto CSS, no repagination: the
call is in paragraph "a"; paragraph "c" has only one line (`c1`) left at the bottom of
page 1. WeasyPrint 70.0 moves the footnote to page 2 to fit `c2`. CSS levers tried by the
Pronto session, without effect: `orphans: 1` makes it worse, `orphans: 3` only moves the
case, `break-inside: avoid` leaves the footnote reported. No option changes it.

## Cause in the 70.0 code

`weasyprint/layout/block.py`, `_linebox_layout()` (70.0 = `main` 369b1534 for this file,
checked 03.10.2026), branch `if overflow:`, lines 376-417. When a line overflows:

- `can_break_now` (lines 379-391): the page could break after this line (orphans and
  widows satisfied);
- `could_break_before` (lines 392-395): it could break before it; with `can_break_now`
  true, it is false only when the paragraph has fewer than `orphans` lines on the page;
- line 397: `report = not context.in_column and can_break_now and not could_break_before`;
- lines 399-405: `while report and context.current_page_footnotes:
  context.report_footnote(context.current_page_footnotes[-1])` until the line fits.

Nothing checks where the reported footnote is called. The normal path, `_break_line()`
(lines 305-332, called line 407), would have pushed the start of the paragraph to the next
page (lines 312-317: fewer lines than `orphans` and the page is not empty, abort), which is
what `orphans` asks for, and the footnote would have stayed with its call.

## What upstream knows

- [#2432](https://github.com/Kozea/WeasyPrint/issues/2432) (liZe, closed, 66.0),
  "Footnotes and forbidden page breaks can force page breaks too early", fixed by
  [PR #2437](https://github.com/Kozea/WeasyPrint/pull/2437) "Try to report footnotes when text
  overflows because of orphans" (merged 2025, 66.0), which added the code above. liZe: "The
  current code should help in some circumstances, but we'll probably need more real samples
  to test a large number of cases." Its test, `test_footnote_report_orphans`, has the four
  footnotes **in** the paragraph that needs its second line: that case is kept by our fix.
- [#1564](https://github.com/Kozea/WeasyPrint/issues/1564) (closed, 55.0) and
  [#1871](https://github.com/Kozea/WeasyPrint/issues/1871) (closed, 60.0): footnotes before
  their call, the opposite direction; GCPM: "A footnote body must never be placed on a page
  before the footnote reference".
- [#1924](https://github.com/Kozea/WeasyPrint/issues/1924) (closed, 2023): text and footnote
  both moved; liZe: "there's no magical way to handle these cases".
- No issue on a footnote moved away from a call that fits (searches "footnote reported",
  "footnote orphans", "report_footnote", 03.10.2026). `main`: `block.py` identical to 70.0.

## Our fix

Only footnotes called in the lines of **this** paragraph already laid out on the page
(`new_children`) may be reported. The loop stops at the first footnote of the page that is
not one of them; if the line still does not fit, the normal `_break_line()` path runs: the
start of the paragraph goes to the next page, and if a footnote is called in those lines,
`remove_placeholders()` takes it back and it goes with them.

What #2437 wanted is kept: a paragraph whose own footnote takes the room of its second
line still reports that footnote rather than leaving a blank. What changes: a footnote
called higher up on the page is no longer moved for a later paragraph.

## Proofs (03.10.2026, WSL SZH-Publishing, copies of the venv, `/opt` untouched)

- `demo/demo.sh`: plain 70.0, call on page 1 and footnote on page 2, "c1 c2" on page 1;
  patched, call and footnote on page 1, paragraph "c" whole on page 2. veraPDF ua1 PASS.
- WeasyPrint's own suite (sdist 70.0, `pytest -n 2`): 4336 passed, 1 failed, 43 xfailed,
  plain and patched alike (the failure, `test_emoji_text_svg`, is a missing emoji font;
  same in all four runs). `test_footnote_report_orphans` (#2437) passes.
- `test/weasyprint-patch-check.py`, case `n-reportee`: red without the code, green with it.
- Patch applies alone on plain 70.0 and after the other seven, `--fuzz=0`.

## Recommendation

Report upstream (`ISSUE.md`), as a follow-up of #2432 / #2437, with the short sample and
the offer of a PR. Keep the patch until a WeasyPrint version fixes it, then drop it.
