#!/bin/sh
# Applique à un WeasyPrint installé les correctifs de sa version (image/patches/).
# Appelé par image/Containerfile après l'installation, et par la CI sur son propre venv,
# pour que la CI valide le même WeasyPrint que les postes.
#
# Usage : patch-weasyprint.sh <python du venv WeasyPrint> <dossier des patchs>
#
# Les correctifs de la version X sont dans <dossier>/weasyprint-X/, un fichier par sujet,
# appliqués dans l'ordre de leur nom. Chacun s'applique seul. Un fichier renommé en
# .patch.off est ignoré, et le journal le dit. La liste des patchs appliqués est écrite
# dans weasyprint/szh-patchs.txt, que lit test/weasyprint-patch-check.py.
#
# Le script échoue :
#   - s'il n'y a pas de dossier pour la version installée : une montée de WeasyPrint
#     oblige à revoir les correctifs ;
#   - si le dossier contient autre chose que des .patch et des .patch.off ;
#   - si un patch ne s'applique pas exactement (--fuzz=0) ou est déjà appliqué ;
#   - si un module patché ne s'importe plus.
# Tous les patchs sont d'abord essayés sur une copie du paquet, pour ne jamais laisser
# WeasyPrint à moitié patché.
set -eu
export LC_ALL=C

PY="$1"
DIR="$2"

VERSION="$("$PY" -c 'import weasyprint; print(weasyprint.__version__)')"
SITE="$("$PY" -c 'import os, weasyprint; print(os.path.dirname(os.path.dirname(weasyprint.__file__)))')"
PATCHES="$DIR/weasyprint-$VERSION"
TEMOIN="$SITE/weasyprint/szh-patchs.txt"

if [ ! -d "$PATCHES" ]; then
  echo "patch-weasyprint : aucun correctif pour WeasyPrint $VERSION ($PATCHES absent)." >&2
  echo "  Rejuger image/patches/ avant de monter de version (voir les patchs précédents)." >&2
  exit 1
fi
if [ -e "$TEMOIN" ]; then
  echo "patch-weasyprint : correctifs déjà posés sur $SITE ($TEMOIN existe)." >&2
  exit 1
fi

ACTIFS=""
for f in "$PATCHES"/*; do
  [ -e "$f" ] || continue
  case "$f" in
    *.patch) ACTIFS="$ACTIFS $(basename "$f")" ;;
    *.patch.off) echo "patch-weasyprint : ignoré $(basename "$f") (désactivé)" ;;
    *) echo "patch-weasyprint : fichier inattendu $f (ni .patch ni .patch.off)." >&2; exit 1 ;;
  esac
done

BANC="$(mktemp -d)"
trap 'rm -rf "$BANC"' EXIT
cp -R "$SITE/weasyprint" "$BANC/"
for p in $ACTIFS; do
  if ! patch --dry-run -d "$BANC" -p1 --forward --batch --fuzz=0 < "$PATCHES/$p" >/dev/null ||
     ! patch -s -d "$BANC" -p1 --forward --batch --fuzz=0 --no-backup-if-mismatch < "$PATCHES/$p"; then
    echo "patch-weasyprint : $p ne s'applique pas proprement sur $SITE." >&2
    exit 1
  fi
done
for p in $ACTIFS; do
  patch -s -d "$SITE" -p1 --forward --batch --fuzz=0 --no-backup-if-mismatch < "$PATCHES/$p"
  echo "patch-weasyprint : posé $p"
done

# Les modules patchés doivent s'importer, et les .pyc compilés par pip sont périmés.
"$PY" -c 'import weasyprint.pdf.tags, weasyprint.pdf.stream, weasyprint.pdf.metadata, weasyprint.draw, weasyprint.draw.text, weasyprint.layout.inline, weasyprint.layout.block, weasyprint.layout.page, weasyprint.text.line_break, weasyprint.text.ffi'
"$PY" -m compileall -q "$SITE/weasyprint"
: > "$TEMOIN"
for p in $ACTIFS; do echo "$p" >> "$TEMOIN"; done
if [ -z "$ACTIFS" ]; then
  echo "patch-weasyprint : AUCUN correctif actif, WeasyPrint $VERSION tel que publié." >&2
fi
echo "patch-weasyprint : WeasyPrint $VERSION, $(echo $ACTIFS | wc -w) correctif(s) posé(s) sur $SITE."
