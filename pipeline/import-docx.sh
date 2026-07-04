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
rm -f media/refs-brutes.txt media/rapport.json

# --- Passe A : docx -> markdown (structure, figures, extraction des références) ---
SZH_STATS="media/rapport.json" SZH_REFS="media/refs-brutes.txt" \
pandoc "$DOCX_ABS" --track-changes=accept -f docx -t markdown \
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
SZH_BIB="$BIB" SZH_REFS="media/refs-brutes.txt" SZH_LANG="$LANG_ART" SZH_STATS="media/rapport.json" \
pandoc "$SLUG.md" -f markdown -t markdown --standalone --wrap=none --markdown-headings=atx \
  --lua-filter="$PIPE/filters/szh-citations.lua" \
  -o "$SLUG.md.tmp" && mv -f "$SLUG.md.tmp" "$SLUG.md"

# --- Rapport de conversion trilingue ---
python3 "$PIPE/rapport.py" media/rapport.json "$SLUG" > "$SLUG-rapport.html" 2>/dev/null \
  || rm -f "$SLUG-rapport.html"

exit 0
