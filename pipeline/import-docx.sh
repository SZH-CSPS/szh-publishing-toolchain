#!/bin/bash
# Import d'UN document Word -> article (D35, enrichi F6/WS-D).
# Appelé par le Makefile depuis la RACINE de la revue :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir>
#
# Produit : articles/<slug>/<slug>.md + articles/<slug>/media/ (images extraites)
#           + articles/<slug>/tables/table-NN.html (un fichier par tableau, D47/D50)
#           + articles/<slug>/<slug>.meta.yaml (F6 — jamais écrasé s'il existe)
#           + articles/<slug>/media/<slug>.bib (F6 — si une bibliographie est
#             détectée ET qu'AnyStyle la parse ; sinon la liste RESTE dans le .md)
#
# Chaîne (l'ordre est VOULU) :
#   1. docx-meta.py    : métadonnées (titre, auteurs, résumés, mots-clés, DOI, type,
#                        tableau des auteurs, biblio stylée) -> meta.yaml + $SZH_META
#                        (instructions de retrait pour les filtres) + stats JSON.
#   2. docx-tables.py  : tableaux -> tables/*.html (fusions préservées, D50), en
#                        SAUTANT les tableaux consommés par docx-meta (lignes T de
#                        $SZH_META) — symétrie RM2 avec szh-meta.lua.
#   3. docx-titres.py  : titres déduits (AX4, garde-fou raffiné F6) -> $SZH_TITRES.
#   4. pandoc + filtres Lua DANS L'ORDRE :
#        szh-meta      (retire les blocs consommés AVANT tout raisonnement aval)
#        szh-legendes  (légendes -> alt d'image ; purge des paragraphes bakés)
#        szh-titres    (promotion des titres déduits — jamais sur un bloc consommé)
#        szh-biblio    (détache la liste de références -> $SZH_REFS)
#        szh-tabelle-reference (Table restants -> ::: {.szh-tabelle src=…})
#   5. AnyStyle sur $SZH_REFS -> media/<slug>.bib ; en cas d'ÉCHEC, pandoc est
#      RELANCÉ SANS szh-biblio : la liste de références reste dans le .md (aucune
#      perte, avertissement loggué) — le citeproc du Makefile ne s'activera pas
#      (pas de .bib non vide).
# Suivi de modifications accepté, commentaires Word ignorés.
set -u

F="$1"; SLUG="$2"; PIPE="$3"
DIR="articles/$SLUG"
DOCX_ABS="$(realpath "$F")"

mkdir -p "$DIR/media" "$DIR/tables"
cd "$DIR" || exit 1

# Métadonnées d'abord (F6) : docx-meta.py écrit <slug>.meta.yaml (sauf s'il existe),
# le fichier d'instructions $SZH_META (paragraphes/tableaux consommés, type, langue,
# biblio stylée, légendes stylées) et une ligne JSON de stats sur stdout, logguée ici.
# Non bloquant : un échec laisse $SZH_META vide, l'import continue sans métadonnées.
META="$(mktemp)"
export SZH_META="$META"
STATS="$(python3 "$PIPE/docx-meta.py" "$DOCX_ABS" "$SLUG" . || true)"
[ -n "$STATS" ] && echo "[import-meta] $STATS"

# Tableaux (D50) : docx-tables.py rend chaque tableau en HTML fidèle (fusions
# colspan/rowspan préservées) dans tables/, en sautant les tableaux consommés
# (lignes T de $SZH_META). La numérotation (ordre du document, premier niveau,
# tableaux consommés exclus) DOIT rester alignée avec le duo szh-meta.lua ->
# szh-tabelle-reference.lua (RM2). Légendes de tableau (AX5) : <caption> baké dans
# le HTML extrait + texte consigné dans SZH_LEGENDES_TABLES pour que szh-legendes.lua
# retire les paragraphes correspondants du .md.
LEGT="$(mktemp)"
export SZH_LEGENDES_TABLES="$LEGT"
python3 "$PIPE/docx-tables.py" "$DOCX_ABS" tables || { rm -f "$LEGT" "$META"; exit 1; }

# Titres déduits (AX4) : pré-pass Python qui lit les tailles de police dans
# word/document.xml (pandoc les perd) et écrit un fichier de titres présumés,
# consommé par szh-titres.lua pendant la conversion. Non bloquant : mktemp crée
# déjà le fichier (vide = aucun titre), un échec du pré-pass laisse l'import passer.
TITRES="$(mktemp)"
python3 "$PIPE/docx-titres.py" "$DOCX_ABS" "$TITRES" || true
export SZH_TITRES="$TITRES"

# Réceptacle des entrées de bibliographie détachées par szh-biblio.lua.
REFS="$(mktemp)"
export SZH_REFS="$REFS"

nettoyer() { rm -f "$TITRES" "$LEGT" "$META" "$REFS"; }

# --extract-media=. : images extraites sous media/ (chemins relatifs au .md,
#   corrects car le build HTML tourne DANS le dossier de l'article). ⚠ =media doublerait en media/media/.
# -simple_tables-multiline_tables-grid_tables : sans objet ici (les tableaux sont
#   remplacés par des références) — conservé par cohérence avec le writer du pipeline.
convertir() {
  # $1 = "avec-biblio" | "sans-biblio" (relance sans perte si AnyStyle échoue)
  local filtres=(--lua-filter="$PIPE/filters/szh-meta.lua"
                 --lua-filter="$PIPE/filters/szh-legendes.lua"
                 --lua-filter="$PIPE/filters/szh-titres.lua")
  if [ "$1" = "avec-biblio" ]; then
    filtres+=(--lua-filter="$PIPE/filters/szh-biblio.lua")
  fi
  filtres+=(--lua-filter="$PIPE/filters/szh-tabelle-reference.lua")
  pandoc "$DOCX_ABS" \
    --from=docx \
    --to=markdown-simple_tables-multiline_tables-grid_tables \
    --track-changes=accept \
    --extract-media=. \
    "${filtres[@]}" \
    --wrap=none \
    -o "$SLUG.md"
}

convertir avec-biblio || { nettoyer; exit 1; }

# Bibliographie (F6) : AnyStyle transforme les entrées brutes en BibTeX ; le
# Makefile n'active citeproc que si media/<slug>.bib est non vide. Échec (AnyStyle
# absent, sortie vide/invalide) -> on RELANCE la conversion sans szh-biblio : la
# liste de références reste dans le .md, rien n'est perdu.
if [ -s "$REFS" ]; then
  BIB="media/$SLUG.bib"
  if command -v anystyle >/dev/null 2>&1 \
     && anystyle --stdout -f bib parse "$REFS" > "$BIB" 2>/dev/null \
     && grep -q '@' "$BIB"; then
    echo "[import] bibliographie : $(grep -c '^@' "$BIB") entrée(s) -> $BIB"
  else
    rm -f "$BIB"
    echo "[import] ⚠ AnyStyle indisponible ou en échec : la bibliographie reste dans le texte"
    convertir sans-biblio || { nettoyer; exit 1; }
  fi
fi
nettoyer

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
