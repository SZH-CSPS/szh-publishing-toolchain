#!/bin/sh
# Applique à un WeasyPrint installé le correctif SZH de SA version (image/patches/).
# Appelé par image/Containerfile juste après l'installation épinglée, et par la CI
# (.github/workflows/ci.yml) sur son propre venv : sans cela, la porte PDF/UA de la CI
# ne jugerait pas le WeasyPrint de la flotte.
#
# Usage : patch-weasyprint.sh <python du venv WeasyPrint> <dossier des patchs>
#
# Échoue BRUYAMMENT, et c'est voulu :
#   - s'il n'existe pas de patches/weasyprint-<version installée>.patch : une montée de
#     version de WeasyPrint (image/requirements.txt) oblige à rejuger le correctif —
#     l'amont l'a peut-être intégré, ou le code a bougé ;
#   - si le patch ne s'applique pas au caractère près (--fuzz=0), ou s'il est déjà
#     appliqué (--forward) ;
#   - si le module patché ne s'importe plus.
# La passe --dry-run d'abord : un patch à moitié posé serait pire que pas de patch.
set -eu

PY="$1"
DIR="$2"

VERSION="$("$PY" -c 'import weasyprint; print(weasyprint.__version__)')"
SITE="$("$PY" -c 'import os, weasyprint; print(os.path.dirname(os.path.dirname(weasyprint.__file__)))')"
PATCH="$DIR/weasyprint-$VERSION.patch"

if [ ! -f "$PATCH" ]; then
  echo "patch-weasyprint : aucun correctif pour WeasyPrint $VERSION ($PATCH absent)." >&2
  echo "  Rejuger image/patches/ avant de monter de version (voir le patch précédent)." >&2
  exit 1
fi

if ! patch --dry-run -d "$SITE" -p1 --forward --batch --fuzz=0 < "$PATCH"; then
  echo "patch-weasyprint : $PATCH ne s'applique pas proprement sur $SITE." >&2
  exit 1
fi
patch -d "$SITE" -p1 --forward --batch --fuzz=0 --no-backup-if-mismatch < "$PATCH"

# Le module patché doit s'importer, et les .pyc compilés par pip sont périmés.
"$PY" -c 'import weasyprint.pdf.tags, weasyprint.pdf.stream'
"$PY" -m compileall -q "$SITE/weasyprint/pdf"
echo "patch-weasyprint : $PATCH appliqué sur $SITE."
