#!/bin/bash
# Import SIMPLIFIÉ d'UN document Word -> article (D35).
# Appelé par le Makefile depuis la RACINE de la revue :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir>
#
# Produit : articles/<slug>/<slug>.md + articles/<slug>/media/ (images extraites)
#           + articles/<slug>/tables/table-NN.html (un fichier par tableau, D47)
#
# Conversion Pandoc nue + un filtre unique : chaque tableau est EXTRAIT en HTML
# (tables/) et remplacé par une référence ::: {.szh-tabelle src="…"} résolue à la
# compilation. Suivi de modifications accepté, commentaires Word ignorés.
# Les heuristiques D27-D30 (titres, listes, figures, AnyStyle, citations, rapports)
# sont débranchées (voir pipeline/attic/) ; retour arrière = git.
set -u

F="$1"; SLUG="$2"; PIPE="$3"
DIR="articles/$SLUG"
DOCX_ABS="$(realpath "$F")"

mkdir -p "$DIR/media" "$DIR/tables"
cd "$DIR" || exit 1

# --extract-media=. : images extraites sous media/ (chemins relatifs au .md,
#   corrects car le build HTML tourne DANS le dossier de l'article). ⚠ =media doublerait en media/media/.
# -simple_tables-multiline_tables-grid_tables : sans objet ici (les tableaux sont
#   extraits par le filtre) — conservé par cohérence avec le writer du pipeline.
pandoc "$DOCX_ABS" \
  --from=docx \
  --to=markdown-simple_tables-multiline_tables-grid_tables \
  --track-changes=accept \
  --extract-media=. \
  --lua-filter="$PIPE/filters/szh-tabelle-extraire.lua" \
  --wrap=none \
  -o "$SLUG.md" || exit 1

# Pas de tableau dans ce docx : ne pas laisser un tables/ vide.
rmdir tables 2>/dev/null || true

# D45 : les médias vivent à UN seul niveau (media/). Vérifié (spike N4, pandoc 3.5) :
# --extract-media=. produit déjà media/ simple ; cette normalisation idempotente est
# une ceinture de sécurité (comportement pandoc futur, docx exotique). Copie AVANT
# suppression : aucune image n'est jamais perdue.
if [ -d media/media ]; then
  cp -r media/media/. media/ && rm -rf media/media
  sed -i 's|media/media/|media/|g' "$SLUG.md"
fi

exit 0
