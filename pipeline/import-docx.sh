#!/bin/bash
# Importe un document Word en article. Appelé par le Makefile depuis la racine de la revue :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir>
#
# Produit dans articles/<slug>/ : <slug>.md, media/, tables/table-NN.html (un fichier par
# tableau), <slug>.meta.yaml (jamais écrasé s'il existe) et media/<slug>.bib quand une
# bibliographie est détectée et qu'AnyStyle la parse ; sinon la liste reste dans le .md.
#
# L'ordre de la chaîne est voulu :
#   1. docx-meta.py   : métadonnées -> meta.yaml et instructions de retrait ($SZH_META).
#   2. docx-tables.py : tableaux -> tables/*.html, en sautant ceux que docx-meta.py a
#                       consommés (lignes T) — c'est ce qui garde sa numérotation alignée
#                       sur celle de szh-tabelle-reference.lua.
#   3. docx-titres.py : titres déduits -> $SZH_TITRES.
#   4. pandoc + filtres Lua dans cet ordre :
#        szh-meta      (retire les blocs consommés avant tout raisonnement aval)
#        szh-legendes  (légendes -> alt d'image ; purge des paragraphes bakés)
#        szh-titres    (promotion des titres déduits, jamais sur un bloc consommé)
#        szh-biblio    (détache la liste de références -> $SZH_REFS)
#        szh-tabelle-reference (Table restants -> ::: {.szh-tabelle src=…})
#   5. AnyStyle sur $SZH_REFS -> media/<slug>.bib ; en cas d'échec, pandoc est relancé
#      sans szh-biblio et rien n'est perdu.
#   6. import-medias.py : les photos du tableau des auteurs quittent media/ pour
#      portraits/ et passent au détourage ; les images que ni le .md ni tables/*.html ne
#      citent sont supprimées (Word livre aussi les logos et filigranes du document).
# Suivi de modifications accepté, commentaires Word ignorés.
set -u

F="$1"; SLUG="$2"; PIPE="$3"
DIR="articles/$SLUG"
DOCX_ABS="$(realpath "$F")"

mkdir -p "$DIR/media" "$DIR/tables"
cd "$DIR" || exit 1

# Métadonnées d'abord : docx-meta.py écrit <slug>.meta.yaml (sauf s'il existe), le
# fichier d'instructions $SZH_META et une ligne JSON de stats, logguée ici. Non
# bloquant : un échec laisse $SZH_META vide et l'import continue sans métadonnées.
META="$(mktemp)"
export SZH_META="$META"
# Appariement photo <-> auteur, écrit par docx-meta.py et consommé par import-medias.py,
# après pandoc : les images n'existent sous media/ qu'une fois la conversion faite.
PHOTOS="$(mktemp)"
export SZH_PHOTOS="$PHOTOS"
STATS="$(python3 "$PIPE/docx-meta.py" "$DOCX_ABS" "$SLUG" . || true)"
[ -n "$STATS" ] && echo "[import-meta] $STATS"

# Tableaux : docx-tables.py rend chaque tableau en HTML fidèle (fusions colspan et
# rowspan préservées) dans tables/, en sautant ceux consommés (lignes T de $SZH_META).
# Sa numérotation doit rester alignée sur le duo szh-meta.lua ->
# szh-tabelle-reference.lua. Les légendes sont bakées en <caption> et consignées dans
# SZH_LEGENDES_TABLES, pour que szh-legendes.lua retire les paragraphes du .md.
LEGT="$(mktemp)"
export SZH_LEGENDES_TABLES="$LEGT"
python3 "$PIPE/docx-tables.py" "$DOCX_ABS" tables || { rm -f "$LEGT" "$META" "$PHOTOS"; exit 1; }

# Titres déduits : pré-pass Python qui lit les tailles de police de word/document.xml
# (pandoc les perd) et écrit les titres présumés, consommés par szh-titres.lua. Non
# bloquant : mktemp a déjà créé le fichier, vide signifiant aucun titre.
TITRES="$(mktemp)"
python3 "$PIPE/docx-titres.py" "$DOCX_ABS" "$TITRES" || true
export SZH_TITRES="$TITRES"

# Réceptacle des entrées de bibliographie détachées par szh-biblio.lua.
REFS="$(mktemp)"
export SZH_REFS="$REFS"

# $PHOTOS survit à nettoyer() : il est consommé après pandoc, une fois les images
# extraites. nettoyer_tout() sert donc aux sorties en échec.
nettoyer() { rm -f "$TITRES" "$LEGT" "$META" "$REFS"; }
nettoyer_tout() { nettoyer; rm -f "$PHOTOS"; }

# --extract-media=. : images extraites sous media/, en chemins relatifs au .md,
#   corrects parce que le build HTML tourne dans le dossier de l'article. ⚠ écrire
#   =media doublerait le chemin en media/media/.
# -simple_tables-multiline_tables-grid_tables : sans objet ici (les tableaux sont
#   remplacés par des références), conservé par cohérence avec le writer du pipeline.
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

convertir avec-biblio || { nettoyer_tout; exit 1; }

# Bibliographie : AnyStyle transforme les entrées brutes en BibTeX ; le Makefile
# n'active citeproc que si media/<slug>.bib est non vide. En cas d'échec (AnyStyle
# absent, sortie vide ou invalide), la conversion est relancée sans szh-biblio et la
# liste de références reste dans le .md.
if [ -s "$REFS" ]; then
  BIB="media/$SLUG.bib"
  if command -v anystyle >/dev/null 2>&1 \
     && anystyle --stdout -f bib parse "$REFS" > "$BIB" 2>/dev/null \
     && grep -q '@' "$BIB"; then
    echo "[import] bibliographie : $(grep -c '^@' "$BIB") entrée(s) -> $BIB"
  else
    rm -f "$BIB"
    echo "[import] ⚠ AnyStyle indisponible ou en échec : la bibliographie reste dans le texte"
    convertir sans-biblio || { nettoyer_tout; exit 1; }
  fi
fi
nettoyer

# Pas de tableau dans ce docx : ne pas laisser un tables/ vide.
rmdir tables 2>/dev/null || true

# Les médias vivent à un seul niveau (media/). --extract-media=. produit déjà media/
# simple (pandoc 3.5) ; cette normalisation idempotente est une ceinture de sécurité.
# Copie avant suppression : aucune image n'est perdue.
if [ -d media/media ]; then
  cp -r media/media/. media/ && rm -rf media/media
  sed -i 's|media/media/|media/|g' "$SLUG.md"
fi

# Photos d'auteur·e·s rangées et détourées, images inutilisées supprimées. Non bloquant :
# un échec laisse le dossier tel quel, l'article est déjà converti.
MEDIAS="$(python3 "$PIPE/import-medias.py" "$SLUG" . "$PHOTOS" || true)"
[ -n "$MEDIAS" ] && echo "[import-medias] $MEDIAS"
rm -f "$PHOTOS"

exit 0
