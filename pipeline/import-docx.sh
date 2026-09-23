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
#   1. le LECTEUR   : métadonnées -> meta.yaml et instructions de retrait ($SZH_META). Deux
#                     lecteurs, choisis document par document (voir « QUEL LECTEUR ? » plus
#                     bas) : pronto-lire.py pour un document au gabarit « Pronto — modèle
#                     d'article », docx-meta.py pour un Word hérité.
#   2. docx-tables.py : tableaux -> tables/*.html, en sautant ceux que le lecteur a
#                       consommés (lignes T) — c'est ce qui garde sa numérotation alignée
#                       sur celle de szh-tabelle-reference.lua — et en posant sur le tableau
#                       d'un bloc du gabarit sa légende et ses crédits (lignes FT).
#   3. docx-titres.py : titres déduits -> $SZH_TITRES.
#   3bis. docx-styles-corps.py : copie du .docx, lue par pandoc seul, où les paragraphes
#      « SZH Important », « SZH Hervorhebung » et « SZH Question (interview) » portent un
#      marqueur (pandoc perd les styles de paragraphe) — et de même, livre seulement, pour
#      la ligne d'auteur·e·s d'un chapitre (style Word « Auhors » et ses variantes).
#   4. pandoc + filtres Lua dans cet ordre :
#        szh-styles-corps (en premier : marqueur -> bloc du cockpit, ::: {.important},
#                      {.highlight}, {.question}, {.szh-auteurs} ; les suivants voient le
#                      texte d'avant)
#        szh-meta      (retire les blocs consommés avant tout raisonnement aval)
#        szh-legendes  (légendes -> alt d'image ; purge des paragraphes bakés ; et les
#                      champs d'un bloc figure du gabarit -> légende, alt, crédit et source
#                      de son image, lignes FI)
#        szh-titres    (promotion des titres déduits, jamais sur un bloc consommé)
#        szh-biblio-detacher (l'étendue de bibliographie -> <slug>.biblio.md, et une
#                      référence à sa place ; après szh-titres, qui a fait des Header des
#                      titres promus, et avant szh-tabelle-reference, les Table étant
#                      encore des Table)
#        szh-tabelle-reference (Table restants -> ::: {.szh-tabelle src=…})
#        szh-attributs-sains (en dernier : il assainit les classes et identifiants que
#                      tout ce qui précède a pu poser. Le lecteur docx met le nom du style
#                      Word en classe — « Titre 2 (small) » — et pandoc ne sait pas relire
#                      une parenthèse dans un nom de classe : le bloc d'attributs entier
#                      s'imprimerait alors dans le livre)
#   4bis. garde-fou : aucun bloc HTML brut ne doit rester dans le .md (voir plus bas).
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

# Le PRODUIT du numéro (« revue » | « zeitschrift »), lu AVANT le cd : on est encore à la
# racine du numéro, là où vit ausgabe.yaml. C'est de lui que le lecteur du gabarit tire la
# LANGUE de l'article — le champ « Langue de l'article » a quitté le gabarit le 22.09.2026,
# et un article italien se corrige à la main dans la fiche après l'import (décision de la
# rédaction). Lu par le même chemin que le Makefile, `pandoc lua szh-lire-config.lua`, pour
# que les deux lisent la configuration exactement comme pandoc la relira à la compilation.
# Absent (dossier sans ausgabe.yaml, livre) : variable vide, le lecteur se rabat sur le
# français et le dit — il ne devine jamais en silence.
SZH_PRODUIT="$(pandoc lua "$PIPE/filters/szh-lire-config.lua" ausgabe.yaml revue 2>/dev/null || true)"
export SZH_PRODUIT

# Les cinq fichiers temporaires de la chaîne (métadonnées, appariement photo, légendes de
# tableaux, titres déduits, copie marquée du .docx), nettoyés par un seul trap plutôt que par des rm épars à chaque
# sortie possible — succès, `exit 1` d'une pré-passe, ou un futur point de sortie qu'on
# oublierait de couvrir à la main. Déclarées vides ici : `set -u` ferait échouer le trap
# lui-même s'il se déclenchait avant qu'un mktemp les remplisse.
META=""; PHOTOS=""; LEGT=""; TITRES=""; MARQUE=""
trap 'rm -f "$META" "$PHOTOS" "$LEGT" "$TITRES" "$MARQUE"' EXIT

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

# Métadonnées d'abord : le lecteur écrit <slug>.meta.yaml (sauf s'il existe), le
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

# QUEL LECTEUR ? Deux existent, et ils ne font pas le même métier :
#
#   * pronto-lire.py LIT une structure imposée par le gabarit « Pronto — modèle d'article »
#     (deux tableaux fixes en tête, blocs figure/tableau à clés). Il n'a pas le droit de
#     deviner : une étiquette qu'il ne reconnaît pas arrête l'import plutôt que de perdre en
#     silence ce qu'elle portait.
#   * docx-meta.py DEVINE, sur des Word hérités de formes toutes différentes. C'est le bon
#     outil pour un document qui ne vient pas du gabarit, et le mauvais pour un qui en vient.
#
# Le partage se fait sur la DÉCLARATION des styles du gabarit dans le document (mode
# `--reconnaitre`), jamais sur un réglage de poste : la rédaction reçoit les deux sortes de
# documents, souvent le même jour, et personne n'a à basculer quoi que ce soit.
if python3 "$PIPE/pronto-lire.py" --reconnaitre "$DOCX_ABS" 2>/dev/null; then
  LECTEUR="$PIPE/pronto-lire.py"
  NOM_LECTEUR=pronto
else
  LECTEUR="$PIPE/docx-meta.py"
  NOM_LECTEUR=herite
fi

if ! STATS="$(python3 "$LECTEUR" "$DOCX_ABS" "$SLUG" .)"; then
  # Le lecteur du gabarit a deux façons d'échouer, et elles ne se disent pas pareil : une clé
  # présente qu'il n'a pas su ranger (code 1, il a déjà écrit un avertissement par clé, et
  # n'a RIEN écrit d'autre — ni fiche, ni instructions), ou une panne de lecture. Dans les
  # deux cas l'article n'entre pas dans le numéro et son Word reste en attente ; seul le
  # geste à faire diffère, et c'est lui que la personne doit lire.
  if [ "$NOM_LECTEUR" = pronto ]; then
    signaler "[import] ⚠ « $SLUG » n'a pas été importé : son document suit le gabarit « Pronto », mais un ou plusieurs champs n'ont pas pu être lus (voir les messages juste au-dessus, qui nomment chaque étiquette en cause). Rien n'a été créé, et le fichier Word reste en attente. Corrigez les étiquettes dans le document, puis enregistrez (Ctrl+S). [de] « $SLUG » wurde nicht importiert: das Dokument folgt der Vorlage «Pronto», aber ein oder mehrere Felder konnten nicht gelesen werden (siehe die Meldungen direkt darüber, die jede betroffene Bezeichnung nennen). Es wurde nichts angelegt, die Word-Datei bleibt in der Warteschlange. Korrigieren Sie die Bezeichnungen im Dokument und speichern Sie (Ctrl+S)."
  else
    signaler "[import] ⚠ Les métadonnées de « $SLUG » n'ont pas pu être lues : l'article n'est pas importé et son fichier Word reste en attente. Vérifiez que le document s'ouvre dans Word, puis relancez la conversion. [de] Die Metadaten von « $SLUG » konnten nicht gelesen werden: der Artikel wird nicht importiert, die Word-Datei bleibt in der Warteschlange. Prüfen Sie, ob sich das Dokument in Word öffnet, und starten Sie die Konvertierung erneut."
  fi
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
python3 "$PIPE/docx-tables.py" "$DOCX_ABS" tables || exit 1

# Titres déduits : pré-pass Python qui lit les tailles de police de word/document.xml
# (pandoc les perd) et écrit les titres présumés, consommés par szh-titres.lua. Non
# bloquant : mktemp a déjà créé le fichier, vide signifiant aucun titre.
TITRES="$(mktemp)"
python3 "$PIPE/docx-titres.py" "$DOCX_ABS" "$TITRES" || true
export SZH_TITRES="$TITRES"

# Styles de corps : pandoc lit une copie où chaque paragraphe d'un style du gabarit
# (encadré, mise en évidence, question — et, livre seulement, la ligne d'auteur·e·s d'un
# chapitre) commence par un marqueur, que szh-styles-corps.lua change en bloc. Pas
# `docx+styles` : mesuré sur 16 documents réels, cette lecture change aussi le gras, les
# cellules et les légendes. Non bloquant : sans copie, pandoc lit l'original et les blocs
# arrivent en paragraphes, comme avant.
MARQUE="$(mktemp --suffix=.docx)"
if STYLES="$(python3 "$PIPE/docx-styles-corps.py" "$DOCX_ABS" "$MARQUE")"; then
  SOURCE_PANDOC="$MARQUE"
  echo "[import-styles] $STYLES"
else
  SOURCE_PANDOC="$DOCX_ABS"
fi

# --extract-media=. : images extraites sous media/, en chemins relatifs au .md,
#   corrects parce que le build HTML tourne dans le dossier de l'article. ⚠ écrire
#   =media doublerait le chemin en media/media/.
# -simple_tables-multiline_tables-grid_tables : sans objet ici (les tableaux sont
#   remplacés par des références), conservé par cohérence avec le writer du pipeline.
pandoc "$SOURCE_PANDOC" \
  --from=docx \
  --to=markdown-simple_tables-multiline_tables-grid_tables \
  --track-changes=accept \
  --extract-media=. \
  --lua-filter="$PIPE/filters/szh-styles-corps.lua" \
  --lua-filter="$PIPE/filters/szh-meta.lua" \
  --lua-filter="$PIPE/filters/szh-legendes.lua" \
  --lua-filter="$PIPE/filters/szh-titres.lua" \
  --lua-filter="$PIPE/filters/szh-biblio-detacher.lua" \
  --lua-filter="$PIPE/filters/szh-tabelle-reference.lua" \
  --lua-filter="$PIPE/filters/szh-attributs-sains.lua" \
  --wrap=none \
  -o "$SLUG.md" || exit 1

# pandoc écrit « ::: highlight » ; le cockpit pose et relit « ::: {.highlight} ». Même
# normalisation pour szh-auteurs (livre), qui n'est pas un bloc du cockpit mais suit le
# même écrit de pandoc pour un Div à une seule classe.
sed -i -E 's/^(:::+) (important|highlight|question|szh-auteurs)$/\1 {.\2}/' "$SLUG.md"

# Pas de tableau dans ce docx : ne pas laisser un tables/ vide.
rmdir tables 2>/dev/null || true

# Garde-fou : aucun bloc HTML brut ne doit rester dans le .md.
#
# Le writer markdown ne renonce pas bruyamment. Quand un bloc ne s'exprime pas dans sa
# syntaxe — une Figure dont la légende diffère de la description de l'image, par exemple —
# il écrit du HTML brut au milieu du .md et n'avertit de rien. Le rédacteur hérite alors
# d'un article qu'il ne peut plus modifier dans l'éditeur, et les filtres de compilation
# ne reconnaissent pas ce qu'ils doivent numéroter. Le cas connu (Figure venue d'une
# légende stylée) est traité par szh-legendes.lua ; ce contrôle est là pour le SUIVANT,
# celui qu'on n'a pas vu venir. Non bloquant : l'article est importé, mais il est dit.
BRUT="$(grep -c -E '^<(figure|img|table|div)[ />]' "$SLUG.md" 2>/dev/null || true)"
if [ "${BRUT:-0}" -gt 0 ]; then
  signaler "[import] ⚠ « $SLUG » contient $BRUT bloc(s) HTML que la conversion n'a pas su écrire en markdown : ces passages ne seront ni modifiables dans l'éditeur ni numérotés à la compilation. Signalez ce document à la maintenance. [de] « $SLUG » enthält $BRUT HTML-Block/Blöcke, die die Konvertierung nicht in Markdown schreiben konnte: diese Stellen sind weder im Editor bearbeitbar noch werden sie beim Kompilieren nummeriert. Melden Sie dieses Dokument der Wartung."
fi


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

# Empreintes de ce que cette conversion a livré : c'est ce qui permettra à « Réimporter cet
# article » de distinguer un tableau retravaillé dans l'éditeur d'un tableau tel que le Word
# l'avait donné. Non bloquant : sans ce fichier, le réimport se montre prudent et nomme
# comme ambigu ce qu'il ne peut plus trancher.
python3 "$PIPE/reimporter.py" --empreintes --dossier . --slug "$SLUG" \
  --word "$(basename "$DOCX_ABS")" || true

exit 0
