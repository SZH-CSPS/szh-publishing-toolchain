#!/bin/bash
# Import d'UN document Word/LibreOffice -> article structuré (D26-D30).
# Appelé par le Makefile depuis la RACINE de la revue :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir> [lang]
#
# Produit : articles/<slug>/<slug>.md
#           articles/<slug>/media/            (images extraites, refs brutes, .bib)
#           articles/<slug>/<slug>-rapport.html
set -u

F="$1"; SLUG="$2"; PIPE="$3"; LANG_ART="${4:-fr}"
DIR="articles/$SLUG"
DOCX_ABS="$(realpath "$F")"

mkdir -p "$DIR/media"
cd "$DIR" || exit 1
rm -f media/refs-brutes.txt media/rapport.json media/conversion-stats.json

# --- Passe A : docx -> markdown (structure, figures, extraction des références) ---
# Tableaux TOUJOURS en PIPE (| … |), le format que les extensions d'édition manipulent
# (D33 : les tableaux sont normalisés par le filtre — fusions dépliées, cellules aplaties).
# grid_tables désactivé aussi : sinon la relecture d'un tableau pipe plus large que
# --columns lui attribue des largeurs, et le writer retomberait en grid.
MD_FMT="markdown-simple_tables-multiline_tables-grid_tables"
SZH_STATS="media/conversion-stats.json" SZH_REFS="media/refs-brutes.txt" \
pandoc "$DOCX_ABS" --track-changes=accept -f docx -t "$MD_FMT" \
  --wrap=none --markdown-headings=atx \
  --extract-media=media \
  --lua-filter="$PIPE/filters/szh-import.lua" \
  -o "$SLUG.md" || exit 1

# --- AnyStyle : références brutes -> BibTeX (si une liste a été détectée) ---
BIB=""
if [ -s media/refs-brutes.txt ]; then
  if anystyle -f bib --stdout parse media/refs-brutes.txt > "media/$SLUG.bib" 2>/dev/null \
     && [ -s "media/$SLUG.bib" ]; then
    BIB="media/$SLUG.bib"
  else
    rm -f "media/$SLUG.bib"
  fi
fi

# --- Passe B : liaison des citations + métadonnées bibliographiques ---
# --standalone : indispensable pour que le YAML (bibliography, titre…) soit RÉÉCRIT dans le md.
SZH_BIB="$BIB" SZH_REFS="media/refs-brutes.txt" SZH_LANG="$LANG_ART" SZH_STATS="media/conversion-stats.json" \
pandoc "$SLUG.md" -f markdown -t "$MD_FMT" --standalone --wrap=none --markdown-headings=atx \
  --lua-filter="$PIPE/filters/szh-citations.lua" \
  -o "$SLUG.md.tmp" && mv -f "$SLUG.md.tmp" "$SLUG.md"

# --- Rapport de conversion trilingue ---
python3 "$PIPE/rapport.py" media/conversion-stats.json "$SLUG" > "$SLUG-rapport.html" 2>/dev/null \
  || rm -f "$SLUG-rapport.html"

exit 0
