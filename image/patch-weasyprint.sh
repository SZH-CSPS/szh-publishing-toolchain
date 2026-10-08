#!/bin/sh
# Applique à un WeasyPrint installé les correctifs SZH de SA version (image/patches/).
# Appelé par image/Containerfile juste après l'installation épinglée, et par la CI
# (.github/workflows/ci.yml) sur son propre venv : sans cela, la porte PDF/UA de la CI
# ne jugerait pas le WeasyPrint de la flotte.
#
# Usage : patch-weasyprint.sh <python du venv WeasyPrint> <dossier des patchs>
#
# Les correctifs de la version X vivent dans <dossier>/weasyprint-X/, un fichier par sujet,
# posés dans l'ordre de leur nom (10-…, 20-…). Chacun s'applique sans les autres. Pour en
# désactiver un, le renommer en .patch.off : il est alors annoncé comme ignoré. La liste
# des patchs posés est écrite dans weasyprint/szh-patchs.txt, que lit
# test/weasyprint-patch-check.py pour ne juger que ceux-là.
#
# Échoue BRUYAMMENT, et c'est voulu :
#   - s'il n'existe pas de dossier weasyprint-<version installée>/ : une montée de
#     version de WeasyPrint (image/requirements.txt) oblige à rejuger les correctifs —
#     l'amont les a peut-être intégrés, ou le code a bougé ;
#   - si le dossier contient autre chose que des .patch et des .patch.off ;
#   - si un patch ne s'applique pas au caractère près (--fuzz=0), ou s'il est déjà
#     appliqué (--forward, et le témoin szh-patchs.txt déjà présent) ;
#   - si un module patché ne s'importe plus.
# La passe à blanc d'abord, sur une copie du paquet et patch après patch : un demi-patch
# serait pire que pas de patch.
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
