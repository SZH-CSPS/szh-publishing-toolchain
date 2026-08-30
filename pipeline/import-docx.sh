#!/bin/bash
# Importe un document Word en article. Appelé par le Makefile depuis la racine de la revue :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir>
#
# Produit dans articles/<slug>/ : <slug>.md, media/, tables/table-NN.html (un fichier par
# tableau), <slug>.biblio.md (les références seules) et <slug>.meta.yaml (jamais écrasé
# s'il existe).
#
# La bibliographie devient une donnée, comme un tableau : docx-meta.py en lit l'étendue dans
# les STYLES du .docx, szh-biblio-detacher.lua l'écrit dans <slug>.biblio.md — les
# références seules, sans titre — et laisse à sa place, dans le .md, une référence
# « ::: {.szh-biblio src=…} ». À la compilation, szh-citations.lua résout la référence, pose
# le titre dans la langue de l'article et ancre chaque entrée. Un document dont les
# références ne portent pas le style sort sans ce fichier : sa liste reste dans le corps,
# l'article est entier, et docx-meta.py le dit au rédacteur.
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
#        szh-biblio-detacher (l'étendue de bibliographie -> <slug>.biblio.md, et une
#                      référence à sa place ; après szh-titres, qui a fait des Header des
#                      titres promus, et avant szh-tabelle-reference, les Table étant
#                      encore des Table)
#        szh-tabelle-reference (Table restants -> ::: {.szh-tabelle src=…})
#        szh-attributs-sains (EN DERNIER : il assainit les classes et identifiants que
#                      tout ce qui précède a pu poser. Le lecteur docx met le nom du style
#                      Word en classe — « Titre 2 (small) » — et pandoc ne sait pas relire
#                      une parenthèse dans un nom de classe : le bloc d'attributs entier
#                      s'imprimerait alors dans le livre)
#   5. import-medias.py : les photos du tableau des auteurs quittent media/ pour
#      portraits/ et passent au détourage ; les images que ni le .md ni tables/*.html ne
#      citent sont supprimées (Word livre aussi les logos et filigranes du document).
#   6. reimporter.py --empreintes : note l'empreinte de ce que cette conversion a livré,
#      pour que « Réimporter cet article » sache plus tard ce que personne n'a retouché.
# Suivi de modifications accepté, commentaires Word ignorés.
# La destination est articles/<slug>, ou $SZH_IMPORT_DIR : c'est ainsi que le réimport
# convertit dans un chantier voisin et ne remplace l'article qu'une fois tout prêt.
set -u

F="$1"; SLUG="$2"; PIPE="$3"
# Destination : articles/<slug>, sauf si $SZH_IMPORT_DIR en désigne une autre. C'est par là
# que reimporter.py convertit dans un chantier voisin, sans toucher l'article vivant : une
# seule chaîne d'import, pas deux à garder d'accord.
DIR="${SZH_IMPORT_DIR:-articles/$SLUG}"
DOCX_ABS="$(realpath "$F")"

# Le slug, pour que les pré-passes nomment l'article dans leurs messages.
export SZH_SLUG="$SLUG"

# Un message destiné au rédacteur : sur stderr, et dans articles-word/.import.log quand la
# cible `import` du Makefile en a passé le chemin absolu. Le journal nourrit la vue
# « Word » du cockpit ; le chemin est absolu parce qu'on travaille dans articles/<slug>/.
signaler() {
  printf '%s\n' "$*" >&2
  if [ -n "${SZH_IMPORT_LOG:-}" ]; then
    printf '%s\n' "$*" >> "$SZH_IMPORT_LOG" 2>/dev/null || true
  fi
}

mkdir -p "$DIR/media" "$DIR/tables"
cd "$DIR" || exit 1

# Métadonnées d'abord : docx-meta.py écrit <slug>.meta.yaml (sauf s'il existe), le
# fichier d'instructions $SZH_META et une ligne JSON de stats, logguée ici. Bloquant : sans
# fiche, la compilation refuserait l'article (titre de document vide, exigé par PDF/UA), et
# l'article aurait disparu du numéro sans un mot. Mieux vaut refuser l'import tout de
# suite, le Word restant en attente dans articles-word/.
META="$(mktemp)"
export SZH_META="$META"
# Appariement photo <-> auteur, écrit par docx-meta.py et consommé par import-medias.py,
# après pandoc : les images n'existent sous media/ qu'une fois la conversion faite.
PHOTOS="$(mktemp)"
export SZH_PHOTOS="$PHOTOS"
if ! STATS="$(python3 "$PIPE/docx-meta.py" "$DOCX_ABS" "$SLUG" .)"; then
  signaler "[import] ⚠ Les métadonnées de « $SLUG » n'ont pas pu être lues : l'article n'est pas importé et son fichier Word reste en attente. Vérifiez que le document s'ouvre dans Word, puis relancez la conversion. [de] Die Metadaten von « $SLUG » konnten nicht gelesen werden: der Artikel wird nicht importiert, die Word-Datei bleibt in der Warteschlange. Prüfen Sie, ob sich das Dokument in Word öffnet, und starten Sie die Konvertierung erneut."
  rm -f "$META" "$PHOTOS"
  exit 1
fi
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

# $PHOTOS survit à nettoyer() : il est consommé après pandoc, une fois les images
# extraites. nettoyer_tout() sert donc aux sorties en échec.
nettoyer() { rm -f "$TITRES" "$LEGT" "$META"; }
nettoyer_tout() { nettoyer; rm -f "$PHOTOS"; }

# --extract-media=. : images extraites sous media/, en chemins relatifs au .md,
#   corrects parce que le build HTML tourne dans le dossier de l'article. ⚠ écrire
#   =media doublerait le chemin en media/media/.
# -simple_tables-multiline_tables-grid_tables : sans objet ici (les tableaux sont
#   remplacés par des références), conservé par cohérence avec le writer du pipeline.
pandoc "$DOCX_ABS" \
  --from=docx \
  --to=markdown-simple_tables-multiline_tables-grid_tables \
  --track-changes=accept \
  --extract-media=. \
  --lua-filter="$PIPE/filters/szh-meta.lua" \
  --lua-filter="$PIPE/filters/szh-legendes.lua" \
  --lua-filter="$PIPE/filters/szh-titres.lua" \
  --lua-filter="$PIPE/filters/szh-biblio-detacher.lua" \
  --lua-filter="$PIPE/filters/szh-tabelle-reference.lua" \
  --lua-filter="$PIPE/filters/szh-attributs-sains.lua" \
  --wrap=none \
  -o "$SLUG.md" || { nettoyer_tout; exit 1; }
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

# Empreintes de ce que cette conversion a livré : c'est ce qui permettra à « Réimporter cet
# article » de distinguer un tableau retravaillé dans l'éditeur d'un tableau tel que le Word
# l'avait donné. Non bloquant : sans ce fichier, le réimport se montre prudent et nomme
# comme ambigu ce qu'il ne peut plus trancher.
python3 "$PIPE/reimporter.py" --empreintes --dossier . --slug "$SLUG" \
  --word "$(basename "$DOCX_ABS")" || true

exit 0
