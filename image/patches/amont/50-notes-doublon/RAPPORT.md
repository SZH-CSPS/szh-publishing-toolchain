# Patch 50: a reported footnote is printed twice after a repagination

Patch: `image/patches/weasyprint-70.0/50-notes-doublon.patch` (`weasyprint/layout/page.py`).
Validated by Robin on 03.10.2026. Written in English, as asked by the supervisor, so it can
feed an upstream report; the issue text in `ISSUE.md` is still to be rewritten by Robin.

## The defect

A footnote that does not fit on the page of its call is moved to the next page
("reported"). If the document is then laid out again because a `target-counter()` changed
(a table of contents, "see page X"), the same footnote can be printed a second time, on
another page. Seen in Pronto books (the table of contents forces a repagination), not in
the journal, which is not repaginated.

`demo/doublon.html`, 100 × 80 mm pages, no Pronto CSS: the call is on the last line of
page 1, the note does not fit and goes to page 2, which is correct. Page 3 holds a
`target-counter()` link, as does page 1. With WeasyPrint 70.0, the note is on page 2 **and**
page 3. With one layout pass only (`max_loops=1`), it is on page 2 only.

## Cause in the 70.0 code

`weasyprint/layout/page.py` (70.0 = `main` 369b1534 for this file, checked 03.10.2026):

- lines 616-623, `make_page()`: each page starts by laying out
  `context.reported_footnotes`, the footnotes left by the previous page, then empties it;
- lines 959-1037, `remake_page()`: the state needed to lay out page `i + 1` is kept in
  `context.page_maker[i + 1]` (resume_at, next_page, right_page, page_state,
  remake_state). `context.reported_footnotes` is not part of it: it is one global list on
  the context, valid only right after the previous page was laid out;
- lines 1040-1076, `make_all_pages()`: on a repagination, a page whose state did not change
  is "up-to-date" and is not laid out again (lines 1063-1068): the old page is reused.

On the second pass, page 1 is laid out again (its `target-counter` changed) and reports
the footnote again, into the global list. Page 2 is up-to-date, so it is skipped and does
not consume the list. Page 3 is laid out again (its `target-counter` changed too) and
starts with the stale list: it lays out the footnote a second time.

`layout_document()` (`layout/__init__.py`, lines 123-132) resets `context.footnotes` on each
loop, but not `context.reported_footnotes`.

## What upstream knows

- [#1700](https://github.com/Kozea/WeasyPrint/issues/1700) (closed, 57.0): an
  `IndexError` in `make_all_pages`. liZe described the same conditions: "a footnote should
  be displayed on a page but doesn't have the place to be displayed, and this page has to be
  repaginated, and the pages after this page don't have to be repaginated." The fix,
  commit [c64eec8](https://github.com/Kozea/WeasyPrint/commit/c64eec81cc) "Correctly detect
  reported footnotes for repagination", only changed the end-of-document test in
  `make_all_pages()` (the local `reported_footnotes`, set to `None` for an up-to-date
  page), with `test_reported_footnote_repagination`. It does not cover a page laid out
  again after an up-to-date one: that is our case, and it prints, it does not crash.
- No open issue on a footnote printed twice (searches "footnote twice", "footnote
  duplicated", "reported footnote", 03.10.2026). Open footnote issues: #1545, #1546,
  #1833, #2553, none related.

## Our fix

The list of footnotes reported at the end of page `i` becomes part of the state of page
`i + 1`, like the rest:

- saved in `remake_state['reported_footnotes']` when `page_maker[i + 1]` is written;
- restored at the start of `remake_page(i + 1)`;
- compared in "did the next page change?", so that page `i + 1` is laid out again when the
  footnotes it receives changed.

`page_maker` keeps its 5-tuple shape: the key lives in the `remake_state` dict, read with
`.get()`, so the first page and old states default to an empty list. Without
repagination, the restored list is the one the previous page just left: nothing changes.

## Proofs (03.10.2026, WSL SZH-Publishing, copies of the venv, `/opt` untouched)

- `demo/demo.sh`: plain 70.0 prints the note on pages 2 and 3; plain 70.0 with
  `max_loops=1` on page 2 only; patched on page 2 only. veraPDF ua1 PASS in all cases.
- WeasyPrint's own suite (sdist 70.0, `pytest -n 2`): 4336 passed, 1 failed, 43 xfailed,
  plain and patched alike; the failure is `test_emoji_text_svg` (no emoji font on the
  machine), the same in all four runs (plain, 50, 55, 50 + 55).
- `test/weasyprint-patch-check.py`, case `m-doublon`: red without the code (note on
  `[2, 3]`), green with it.
- Patch applies alone on plain 70.0 and after the six others, `--fuzz=0`.

## Recommendation

Report upstream as a bug (`ISSUE.md`, a short sample, ask before sending the diff). Keep the
patch until a WeasyPrint version fixes it, then drop it.
