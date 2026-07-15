#!/bin/bash
# Import SIMPLIFIÉ d'UN document Word -> article (D35).
# Appelé par le Makefile depuis la RACINE de la revue :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir>
#
# Produit : articles/<slug>/<slug>.md  + articles/<slug>/media/  (images extraites)
#
# Conversion Pandoc nue + un filtre unique : chaque tableau devient « {{TABELLE NN}} »
# (rappel manuel). Suivi de modifications accepté, commentaires Word ignorés.
# Les heuristiques D27-D30 (titres, listes, figures, AnyStyle, citations, rapports)
# sont débranchées (voir pipeline/attic/) ; retour arrière = git.
set -u

F="$1"; SLUG="$2"; PIPE="$3"
DIR="articles/$SLUG"
DOCX_ABS="$(realpath "$F")"

mkdir -p "$DIR/media"
cd "$DIR" || exit 1

# --extract-media=. : images extraites sous media/ (chemins relatifs au .md,
#   corrects car le build HTML tourne DANS le dossier de l'article). ⚠ =media doublerait en media/media/.
# -simple_tables-multiline_tables-grid_tables : sans objet ici (les tableaux sont
#   remplacés par le filtre) — conservé par cohérence avec le writer du pipeline.
pandoc "$DOCX_ABS" \
  --from=docx \
  --to=markdown-simple_tables-multiline_tables-grid_tables \
  --track-changes=accept \
  --extract-media=. \
  --lua-filter="$PIPE/filters/szh-tabelle-platzhalter.lua" \
  --wrap=none \
  -o "$SLUG.md" || exit 1

exit 0
