#!/bin/bash
# Importe un document Word en article. Appelé par la cible `import` du Makefile, depuis la
# racine du numéro :
#   import-docx.sh <chemin-docx> <slug> <pipeline_dir>
#
# Produit dans articles/<slug>/ (ou $SZH_IMPORT_DIR, que le réimport utilise pour convertir
# à côté de l'article existant) : <slug>.md, media/, tables/table-NN.html (un fichier par
# tableau), <slug>.biblio.md (les références seules) et <slug>.meta.yaml (pas écrasé s'il
# existe). Suivi de modifications accepté, commentaires Word ignorés.
#
# Bibliographie : docx-meta.py en repère l'étendue par les styles du .docx ;
# szh-biblio-detacher.lua l'écrit dans <slug>.biblio.md et laisse dans le .md un bloc
# « ::: {.szh-biblio src=…} ». À la compilation, szh-citations.lua la réinsère avec son
# titre. Si les références n'ont pas le style attendu, la liste reste dans le corps et
# docx-meta.py le signale.
#
# Étapes, dans cet ordre :
#   0. .odt : converti en .docx par conversion_odt.py (LibreOffice). Le nom d'origine reste
#      dans $SZH_SOURCE (champ `source:` de la fiche, empreintes du réimport).
#   1. lecteur de métadonnées -> <slug>.meta.yaml et instructions de retrait ($SZH_META) :
#      pronto-lire.py pour un document au gabarit Pronto, docx-meta.py sinon (voir plus bas).
#   2. docx-tables.py : tableaux -> tables/*.html, sans ceux que le lecteur a consommés
#      (lignes T), pour rester aligné sur szh-tabelle-reference.lua ; pose légende et crédits
#      sur le tableau d'un bloc du gabarit (lignes FT).
#   3. docx-titres.py : titres déduits des tailles de police -> $SZH_TITRES.
#   3bis. docx-styles-corps.py : copie du .docx où les paragraphes « SZH Important »,
#      « SZH Hervorhebung », « SZH Question (interview) » et, pour un livre, la ligne
#      d'auteurs (style « Auhors » et variantes) portent un marqueur. Pandoc perd les styles
#      de paragraphe.
#   4. pandoc et ses filtres Lua, dans cet ordre :
#        szh-styles-corps     marqueur -> bloc ::: {.important}, {.highlight}, {.question},
#                             {.szh-auteurs} ; en premier
#        szh-meta             retire les blocs consommés par le lecteur
#        szh-legendes         légendes -> alt d'image ; retire les légendes recopiées ; champs
#                             d'un bloc figure du gabarit -> légende, alt, crédit, source
#                             (lignes FI)
#        szh-titres           promeut les titres déduits, jamais sur un bloc consommé
#        szh-biblio-detacher  bibliographie -> <slug>.biblio.md ; après szh-titres (titres
#                             promus devenus Header), avant szh-tabelle-reference
#        szh-tabelle-reference  tableaux restants -> ::: {.szh-tabelle src=…}
#        szh-attributs-sains  en dernier : assainit classes et identifiants. Le lecteur docx
#                             met le nom du style Word en classe (« Titre 2 (small) »), et
#                             pandoc ne relit pas une parenthèse dans une classe : le bloc
#                             d'attributs s'imprimerait tel quel.
#   4bis. contrôle : aucun bloc HTML brut dans le .md.
#   4ter. docx-controle-import.py --avant-medias : toute valeur de bloc et toute image du
#      Word doivent se retrouver dans l'article ; ce qui manque y est remis et signalé.
#      Seconde passe --apres-medias après l'étape 5, sur les noms définitifs.
#   5. import-medias.py : photos des auteurs -> portraits/ et détourage ; suppression des
#      images que ni le .md ni tables/*.html ne citent (logos, filigranes).
#   5bis. livre : livre-migrer-meta.py range le titre et la ligne d'auteurs du chapitre dans
#      sa fiche. Avant l'étape 6, pour que les empreintes décrivent le chapitre final.
#   6. reimporter.py --empreintes : note ce que cette conversion a livré, pour que le
#      réimport sache plus tard ce qui a été retouché.
set -u
# Espace insécable U+00A0 des messages français.
NB="$(printf '\302\240')"

F="$1"; SLUG="$2"; PIPE="$3"
DIR="${SZH_IMPORT_DIR:-articles/$SLUG}"
# Dossier de livre (buch.yaml présent) : l'étape 5bis ne concerne que lui.
LIVRE_RACINE=""
[ -f buch.yaml ] && LIVRE_RACINE="$PWD"
DOCX_ABS="$(realpath "$F")"

# Nom du Word déposé (.docx ou .odt), avant conversion : champ `source:` de la fiche, et nom
# grâce auquel la cible `import` reconnaît un redépôt.
SZH_SOURCE="$(basename "$DOCX_ABS")"
export SZH_SOURCE

# Pour que les étapes Python nomment l'article dans leurs messages.
export SZH_SLUG="$SLUG"

# Produit du numéro (« revue » ou « zeitschrift »), lu avant le cd, là où est ausgabe.yaml.
# Le lecteur du gabarit en tire la langue de l'article ; un article italien se corrige à la
# main dans la fiche. Vide (livre, pas d'ausgabe.yaml) : le lecteur prend le français et le
# signale.
SZH_PRODUIT="$(pandoc lua "$PIPE/filters/szh-lire-config.lua" ausgabe.yaml revue 2>/dev/null || true)"
export SZH_PRODUIT

# Fichiers temporaires, supprimés par un seul trap à toute sortie. Initialisés vides : avec
# `set -u`, le trap échouerait s'il se déclenchait avant leur mktemp.
META=""; PHOTOS=""; LEGT=""; TITRES=""; MARQUE=""; CONTROLE=""; RETRAITS=""; CONVDIR=""
trap 'rm -f "$META" "$PHOTOS" "$LEGT" "$TITRES" "$MARQUE" "$CONTROLE" "$RETRAITS"; rm -rf "$CONVDIR"' EXIT

# Message pour la rédaction : sur stderr, et dans le journal $SZH_IMPORT_LOG (chemin absolu,
# posé par la cible `import`) que lit la vue « Word » du cockpit.
signaler() {
  printf '%s\n' "$*" >&2
  if [ -n "${SZH_IMPORT_LOG:-}" ]; then
    printf '%s\n' "$*" >> "$SZH_IMPORT_LOG" 2>/dev/null || true
  fi
}

# Refus d'un Word qui ne s'ouvre pas (zip tronqué, document.xml mal formé).
refuser_fichier_illisible() {
  signaler "[import] ⚠ «${NB}$SLUG${NB}»${NB}: le fichier «${NB}$SZH_SOURCE${NB}» n’a pas pu être ouvert (document tronqué ou endommagé)${NB}; rien n’a été créé, le fichier reste en attente. Ouvrez-le dans Word, enregistrez-le de nouveau, puis relancez la conversion. [de] «$SLUG»: die Datei «$SZH_SOURCE» konnte nicht geöffnet werden (Dokument abgeschnitten oder beschädigt); es wurde nichts angelegt, die Datei bleibt in der Warteschlange. Öffnen Sie sie in Word, speichern Sie sie erneut und starten Sie die Konvertierung noch einmal."
  exit 1
}

# .odt : conversion en .docx dans CONVDIR, avant de créer quoi que ce soit dans $DIR. La
# suite lit le .docx converti ; $SZH_SOURCE garde le nom .odt.
case "$DOCX_ABS" in
  *.[oO][dD][tT])
    CONVDIR="$(mktemp -d)"
    if ! DOCX_ABS="$(python3 "$PIPE/conversion_odt.py" "$DOCX_ABS" docx "$CONVDIR")"; then
      signaler "[import] ⚠ «${NB}$SLUG${NB}»${NB}: la conversion de «${NB}$SZH_SOURCE${NB}» (.odt) en .docx a échoué${NB}; rien n’a été créé, le fichier reste en attente. [de] «$SLUG»: die Umwandlung von «$SZH_SOURCE» (.odt) in .docx ist fehlgeschlagen; es wurde nichts angelegt, die Datei bleibt in der Warteschlange."
      exit 1
    fi
    ;;
esac

# Zip tronqué : refusé avant de créer le dossier. Test : la signature de fin du répertoire
# central (PK 05 06) doit figurer dans les 70 derniers Ko (taille maximale d'un commentaire
# de zip).
if ! tail -c 70000 "$DOCX_ABS" | LC_ALL=C grep -qaF "$(printf 'PK\005\006')"; then
  refuser_fichier_illisible
fi

mkdir -p "$DIR/media" "$DIR/tables"
cd "$DIR" || exit 1

# Métadonnées : le lecteur écrit <slug>.meta.yaml (s'il n'existe pas), les instructions
# $SZH_META et une ligne JSON de statistiques. Bloquant : sans fiche, la compilation
# refuserait l'article (titre vide).
META="$(mktemp)"
export SZH_META="$META"
# Appariement photo <-> auteur, écrit par docx-meta.py, lu par import-medias.py après
# pandoc, une fois les images extraites.
PHOTOS="$(mktemp)"
export SZH_PHOTOS="$PHOTOS"

# Choix du lecteur de métadonnées :
#   * pronto-lire.py lit la structure du gabarit « Pronto — modèle d'article » (deux
#     tableaux en tête, blocs figure et tableau à clés). Une étiquette inconnue arrête
#     l'import ;
#   * docx-meta.py devine, sur des Word de toutes formes.
# Le choix se fait document par document, sur les styles du gabarit déclarés dans le
# fichier (`--reconnaitre`) : 0 = gabarit, 10 = autre, tout autre code = panne. En cas de
# panne, docx-meta.py lit le document et le journal le signale.
RECO_ERR="$(python3 "$PIPE/pronto-lire.py" --reconnaitre "$DOCX_ABS" 2>&1)"
RECO_RC=$?
case "$RECO_RC" in
  0)
    LECTEUR="$PIPE/pronto-lire.py"
    NOM_LECTEUR=pronto
    ;;
  10)
    LECTEUR="$PIPE/docx-meta.py"
    NOM_LECTEUR=herite
    ;;
  *)
    LECTEUR="$PIPE/docx-meta.py"
    NOM_LECTEUR=herite
    signaler "[import] ⚠ «${NB}$SLUG${NB}»${NB}: la reconnaissance du gabarit «${NB}Pronto${NB}» est tombée en panne (code $RECO_RC)${NB}; le document est lu comme un Word hérité, ses champs sont à vérifier dans «${NB}Métadonnées des articles${NB}». Signalez-le à la maintenance. [de] «$SLUG»: die Erkennung der Vorlage «Pronto» ist ausgefallen (Code $RECO_RC); das Dokument wird wie ein älteres Word-Dokument gelesen, seine Felder sind unter «Metadaten der Artikel» zu prüfen. Melden Sie dies der Wartung. ${RECO_ERR:+[$(printf '%s' "$RECO_ERR" | tail -n 1)]}"
    ;;
esac

if ! STATS="$(python3 "$LECTEUR" "$DOCX_ABS" "$SLUG" .)"; then
  # Premier mot du bloc : après `if !`, $? vaut 0, le code du lecteur est dans PIPESTATUS.
  LECT_RC="${PIPESTATUS[0]}"
  # 3 = pronto-lire.py n'a pas pu ouvrir le fichier (document.xml mal formé).
  if [ "$NOM_LECTEUR" = pronto ] && [ "$LECT_RC" -eq 3 ]; then
    # Le message dit « rien n'a été créé » : on retire les dossiers vides.
    cd "$OLDPWD" 2>/dev/null && rmdir "$DIR/media" "$DIR/tables" "$DIR" 2>/dev/null
    refuser_fichier_illisible
  fi
  # Autre échec : pour pronto-lire.py, une étiquette non reconnue (il a déjà écrit un
  # message par étiquette, et rien d'autre) ; pour docx-meta.py, une panne de lecture.
  # Seul le geste proposé diffère.
  if [ "$NOM_LECTEUR" = pronto ]; then
    signaler "[import] ⚠ «${NB}$SLUG${NB}» n’a pas été importé${NB}: son document suit le gabarit «${NB}Pronto${NB}», mais un ou plusieurs champs n’ont pas pu être lus (voir les messages juste au-dessus, qui nomment chaque étiquette en cause). Rien n’a été créé, et le fichier Word reste en attente. Corrigez les étiquettes dans le document, puis enregistrez (Ctrl+S). [de] «$SLUG» wurde nicht importiert: das Dokument folgt der Vorlage «Pronto», aber ein oder mehrere Felder konnten nicht gelesen werden (siehe die Meldungen direkt darüber, die jede betroffene Bezeichnung nennen). Es wurde nichts angelegt, die Word-Datei bleibt in der Warteschlange. Korrigieren Sie die Bezeichnungen im Dokument und speichern Sie (Ctrl+S)."
  else
    signaler "[import] ⚠ Les métadonnées de «${NB}$SLUG${NB}» n’ont pas pu être lues${NB}: l’article n’est pas importé et son fichier Word reste en attente. Vérifiez que le document s’ouvre dans Word, puis relancez la conversion. [de] Die Metadaten von «$SLUG» konnten nicht gelesen werden: der Artikel wird nicht importiert, die Word-Datei bleibt in der Warteschlange. Prüfen Sie, ob sich das Dokument in Word öffnet, und starten Sie die Konvertierung erneut."
  fi
  exit 1
fi
[ -n "$STATS" ] && echo "[import-meta] $STATS"

# Tableaux -> tables/*.html (fusions colspan et rowspan gardées), sans ceux consommés par
# le lecteur (lignes T). La numérotation doit rester alignée sur szh-meta.lua puis
# szh-tabelle-reference.lua. Les légendes deviennent des <caption> et sont notées dans
# SZH_LEGENDES_TABLES, pour que szh-legendes.lua retire leur paragraphe du .md.
LEGT="$(mktemp)"
export SZH_LEGENDES_TABLES="$LEGT"
python3 "$PIPE/docx-tables.py" "$DOCX_ABS" tables || exit 1

# Titres déduits des tailles de police de word/document.xml (pandoc les perd), lus par
# szh-titres.lua. Non bloquant : un fichier vide veut dire aucun titre.
TITRES="$(mktemp)"
python3 "$PIPE/docx-titres.py" "$DOCX_ABS" "$TITRES" || true
export SZH_TITRES="$TITRES"

# Styles de corps : pandoc lit une copie où chaque paragraphe d'un style du gabarit
# (encadré, mise en évidence, question ; ligne d'auteurs pour un livre) commence par un
# marqueur, que szh-styles-corps.lua change en bloc. L'extension `docx+styles` n'est pas
# utilisée : elle modifie aussi le gras, les cellules et les légendes. Non bloquant : sans
# copie, pandoc lit l'original et ces blocs restent des paragraphes.
MARQUE="$(mktemp --suffix=.docx)"
if STYLES="$(python3 "$PIPE/docx-styles-corps.py" "$DOCX_ABS" "$MARQUE")"; then
  SOURCE_PANDOC="$MARQUE"
  echo "[import-styles] $STYLES"
else
  SOURCE_PANDOC="$DOCX_ABS"
fi

# Images retirées volontairement par szh-meta.lua (logo de licence), que
# docx-controle-import.py ne doit pas remettre dans le texte.
RETRAITS="$(mktemp)"
export SZH_RETRAITS="$RETRAITS"

# --extract-media=. : images sous media/, en chemins relatifs au .md (la compilation tourne
#   dans le dossier de l'article). =media donnerait media/media/.
# -simple_tables-multiline_tables-grid_tables : sans effet ici (les tableaux sont déjà
#   remplacés par des références), gardé par cohérence.
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

# pandoc écrit « ::: highlight », le cockpit attend « ::: {.highlight} ». Idem pour
# szh-auteurs (livre).
sed -i -E 's/^(:::+) (important|highlight|question|szh-auteurs)$/\1 {.\2}/' "$SLUG.md"

# Retire tables/ s'il est vide.
rmdir tables 2>/dev/null || true

# Contrôle : aucun bloc HTML brut dans le .md. Quand un bloc ne s'exprime pas en markdown
# (une Figure dont la légende diffère de l'alt, par exemple), le writer écrit du HTML brut
# sans avertir ; ce passage n'est alors ni modifiable dans l'éditeur ni numéroté. Le cas
# connu est traité par szh-legendes.lua. Non bloquant, mais signalé.
BRUT="$(grep -c -E '^<(figure|img|table|div)[ />]' "$SLUG.md" 2>/dev/null || true)"
if [ "${BRUT:-0}" -gt 0 ]; then
  signaler "[import] ⚠ «${NB}$SLUG${NB}» contient $BRUT bloc(s) HTML que la conversion n’a pas su écrire en markdown${NB}: ces passages ne seront ni modifiables dans l’éditeur ni numérotés à la compilation. Signalez ce document à la maintenance. [de] «$SLUG» enthält $BRUT HTML-Block/Blöcke, die die Konvertierung nicht in Markdown schreiben konnte: diese Stellen sind weder im Editor bearbeitbar noch werden sie beim Kompilieren nummeriert. Melden Sie dieses Dokument der Wartung."
fi


# Aplatit un éventuel media/media/ (--extract-media=. produit normalement media/).
if [ -d media/media ]; then
  cp -r media/media/. media/ && rm -rf media/media
  sed -i 's|media/media/|media/|g' "$SLUG.md"
fi

# Contrôle de complétude, première passe : chaque légende, texte alternatif, crédit et
# source lus dans le Word doivent se retrouver dans l'article, et chaque image y être citée.
# Ce qui manque est remis dans le texte et signalé. Avant import-medias.py, qui supprime les
# images que le texte ne cite pas. Non bloquant.
CONTROLE="$(mktemp)"
python3 "$PIPE/docx-controle-import.py" --avant-medias "$DOCX_ABS" "$SLUG" . "$CONTROLE" || true

# Photos des auteurs rangées et détourées, images inutilisées supprimées. Non bloquant.
MEDIAS="$(python3 "$PIPE/import-medias.py" "$SLUG" . "$PHOTOS" || true)"
[ -n "$MEDIAS" ] && echo "[import-medias] $MEDIAS"

# Seconde passe, sur les noms définitifs (<slug>-fig-NN) : nomme les images remises et les
# images de groupe sans texte alternatif.
python3 "$PIPE/docx-controle-import.py" --apres-medias "$SLUG" . "$CONTROLE" "$MEDIAS" || true

# Livre : titre et auteurs du chapitre passent du .md à la fiche. Un manuscrit à plusieurs
# titres de niveau 1 est laissé à livre-scinder.py. Non bloquant ; un conflit avec la fiche
# est signalé sans être tranché. Les lignes de message (« | ») vont aussi au journal.
if [ -n "$LIVRE_RACINE" ]; then
  MIGRATION="$(python3 "$PIPE/livre-migrer-meta.py" "$LIVRE_RACINE" --chapitre "$SLUG" 2>&1 || true)"
  if [ -n "$MIGRATION" ]; then
    while IFS= read -r ligne_migration; do
      case "$ligne_migration" in
        *" | "*) signaler "$ligne_migration" ;;
        *) echo "$ligne_migration" ;;
      esac
    done <<< "$MIGRATION"
  fi
fi

# Empreintes de ce que la conversion a livré : le réimport distinguera ainsi un tableau
# retouché dans l'éditeur d'un tableau intact. Non bloquant : sans elles, le réimport
# signale comme ambigu ce qu'il ne peut trancher.
python3 "$PIPE/reimporter.py" --empreintes --dossier . --slug "$SLUG" \
  --word "$SZH_SOURCE" || true

exit 0
