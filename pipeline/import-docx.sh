#!/bin/bash
# Import SIMPLIFIÉ d'UN document Word -> article (D35).
# Appelé par le Makefile depuis la RACINE de la revue :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir>
#
# Produit : articles/<slug>/<slug>.md + articles/<slug>/media/ (images extraites)
#           + articles/<slug>/tables/table-NN.html (un fichier par tableau, D47/D50)
#
# Les tableaux sont rendus par docx-tables.py (Python stdlib, FUSIONS préservées :
# colspan/rowspan — D50) AVANT pandoc ; le filtre Lua ne pose plus que la
# référence ::: {.szh-tabelle src="…"} résolue à la compilation. Suivi de
# modifications accepté, commentaires Word ignorés.
# Les heuristiques D27-D30 (titres, listes, figures, AnyStyle, citations, rapports)
# sont débranchées (voir pipeline/attic/) ; retour arrière = git.
set -u

F="$1"; SLUG="$2"; PIPE="$3"
DIR="articles/$SLUG"
DOCX_ABS="$(realpath "$F")"

mkdir -p "$DIR/media" "$DIR/tables"
cd "$DIR" || exit 1

# Tableaux d'abord (D50) : docx-tables.py rend chaque tableau en HTML fidèle
# (fusions colspan/rowspan préservées) dans tables/. La numérotation (ordre du
# document, premier niveau) DOIT rester alignée avec szh-tabelle-reference.lua.
# Légendes de tableau (AX5) : le <caption> est baké dans le HTML extrait et le
# texte des légendes prises est consigné dans SZH_LEGENDES_TABLES pour que
# szh-legendes.lua retire les paragraphes gras correspondants du .md.
LEGT="$(mktemp)"
export SZH_LEGENDES_TABLES="$LEGT"
python3 "$PIPE/docx-tables.py" "$DOCX_ABS" tables || { rm -f "$LEGT"; exit 1; }

# Titres déduits (AX4) : pré-pass Python qui lit les tailles de police dans
# word/document.xml (pandoc les perd) et écrit un fichier de titres présumés,
# consommé par szh-titres.lua pendant la conversion. Non bloquant : mktemp crée
# déjà le fichier (vide = aucun titre), un échec du pré-pass laisse l'import passer.
TITRES="$(mktemp)"
python3 "$PIPE/docx-titres.py" "$DOCX_ABS" "$TITRES" || true
export SZH_TITRES="$TITRES"

# --extract-media=. : images extraites sous media/ (chemins relatifs au .md,
#   corrects car le build HTML tourne DANS le dossier de l'article). ⚠ =media doublerait en media/media/.
# -simple_tables-multiline_tables-grid_tables : sans objet ici (les tableaux sont
#   remplacés par des références) — conservé par cohérence avec le writer du pipeline.
# Ordre des filtres : szh-legendes (consomme les légendes, retire les paragraphes
# gras) AVANT szh-titres (pour qu'un paragraphe déjà pris comme légende ne soit
# pas aussi promu en titre), puis szh-tabelle-reference (remplace les Table).
pandoc "$DOCX_ABS" \
  --from=docx \
  --to=markdown-simple_tables-multiline_tables-grid_tables \
  --track-changes=accept \
  --extract-media=. \
  --lua-filter="$PIPE/filters/szh-legendes.lua" \
  --lua-filter="$PIPE/filters/szh-titres.lua" \
  --lua-filter="$PIPE/filters/szh-tabelle-reference.lua" \
  --wrap=none \
  -o "$SLUG.md" || { rm -f "$TITRES" "$LEGT"; exit 1; }
rm -f "$TITRES" "$LEGT"

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
