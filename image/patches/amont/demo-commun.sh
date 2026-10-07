# Outils communs des démos (sourcé par <nn>-<nom>/demo/demo.sh, dans la WSL SZH-Publishing).
# Fabrique deux copies temporaires du venv WeasyPrint : « nu » (WeasyPrint tel que publié,
# sans correctif SZH sauf le socle éventuel) et « patché » (nu + le correctif démontré,
# posé par image/patch-weasyprint.sh). /opt/weasyprint reste intact.
set -eu
export LC_ALL=C.UTF-8 PYTHONIOENCODING=utf-8

AMONT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IMAGE="$(cd "$AMONT/../.." && pwd)"
SOURCE_VENV="${SOURCE_VENV:-/opt/weasyprint}"
VERAPDF="${VERAPDF:-/opt/verapdf-cli/verapdf}"
VERAPDF_JAVA="${VERAPDF_JAVA:-/opt/jre-min}"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT

site_de() { "$1/bin/python" -c 'import os, weasyprint; print(os.path.dirname(os.path.dirname(weasyprint.__file__)))'; }

# preparer_venvs <nom du patch> [socle…] : pose $NU et $PATCHE. Le socle, les patchs sans
# lesquels le démontré ne produit rien, est posé sur les deux venvs.
preparer_venvs() {
  local patch="$1" version site temoin dossier p manque=0 liste
  shift
  NU="$TRAVAIL/nu"
  PATCHE="$TRAVAIL/patche"
  cp -a "$SOURCE_VENV" "$NU"
  version="$("$NU/bin/python" -c 'import weasyprint; print(weasyprint.__version__)')"
  site="$(site_de "$NU")"
  temoin="$site/weasyprint/szh-patchs.txt"
  dossier="$IMAGE/patches/weasyprint-$version"
  # Les correctifs déjà posés sur la source sont retirés, du dernier au premier.
  if [ -e "$temoin" ]; then
    for p in $(cat "$temoin"); do [ -e "$dossier/$p" ] || manque=1; done
    if [ $manque = 0 ]; then
      liste="$(tac "$temoin")"
    else
      # Le témoin nomme des patchs absents du dossier (renommés depuis la construction de
      # l'image) : on retire les patchs du dossier qui ne s'appliquent plus, donc posés.
      liste="$(cd "$dossier" && ls -r -- *.patch)"
    fi
    for p in $liste; do
      if [ $manque = 1 ] && patch --dry-run -s -d "$site" -p1 --forward --batch --fuzz=0 \
          < "$dossier/$p" > /dev/null 2>&1; then
        continue
      fi
      patch -s -R -d "$site" -p1 --batch --fuzz=0 --no-backup-if-mismatch < "$dossier/$p"
    done
    rm "$temoin"
  fi
  # Le venv nu doit l'être : chaque patch du dossier s'y applique au caractère près.
  for p in "$dossier"/*.patch; do
    patch --dry-run -s -d "$site" -p1 --forward --batch --fuzz=0 < "$p" > /dev/null ||
      { echo "demo : $(basename "$p") ne s'applique pas au venv nu" >&2; return 1; }
  done
  find "$site/weasyprint" -name '__pycache__' -prune -exec rm -rf {} +
  cp -a "$NU" "$PATCHE"
  mkdir -p "$TRAVAIL/socle/weasyprint-$version" "$TRAVAIL/un-seul/weasyprint-$version"
  for p in "$@"; do
    cp "$dossier/$p" "$TRAVAIL/socle/weasyprint-$version/"
    cp "$dossier/$p" "$TRAVAIL/un-seul/weasyprint-$version/"
  done
  cp "$dossier/$patch" "$TRAVAIL/un-seul/weasyprint-$version/"
  if [ $# -gt 0 ]; then
    sh "$IMAGE/patch-weasyprint.sh" "$NU/bin/python" "$TRAVAIL/socle" | sed 's/^/  /'
  fi
  sh "$IMAGE/patch-weasyprint.sh" "$PATCHE/bin/python" "$TRAVAIL/un-seul" | sed 's/^/  /'
  if [ $# -gt 0 ]; then
    echo "  nu     : WeasyPrint $version + $* (socle), sans $patch"
  else
    echo "  nu     : WeasyPrint $version, aucun correctif SZH"
  fi
  echo "  patché : WeasyPrint $version + $(paste -sd' ' "$(site_de "$PATCHE")/weasyprint/szh-patchs.txt")"
}

# rendre <venv> <html> <pdf> [options WeasyPrint…]
rendre() {
  local venv="$1" html="$2" pdf="$3"
  shift 3
  "$venv/bin/python" -m weasyprint --pdf-variant pdf/ua-1 --uncompressed-pdf "$@" \
    "$html" "$pdf" 2> "$pdf.log" || { cat "$pdf.log"; return 1; }
  sed 's/^/  [weasyprint] /' "$pdf.log"
}

# verapdf_ua1 <pdf> : verdict et règles en échec (le verdict se lit sur l'absence de FAIL).
verapdf_ua1() {
  JAVA_HOME="$VERAPDF_JAVA" "$VERAPDF" --flavour ua1 --format xml "$1" > "$1.vera.xml" 2> /dev/null || true
  python3 - "$1.vera.xml" <<'PY'
import sys
import xml.etree.ElementTree as ET
racine = ET.parse(sys.argv[1]).getroot()
rapport = racine.find('.//validationReport')
details = rapport.find('details')
echecs = [r for r in details.findall('rule') if r.get('status') == 'failed']
print(f"  veraPDF ua1 : {'PASS' if rapport.get('isCompliant') == 'true' else 'FAIL'}"
      f" ({details.get('failedRules')} règle(s) en échec)")
for r in echecs:
    print(f"    {r.get('specification')} {r.get('clause')}-{r.get('testNumber')}"
          f" x{r.get('failedChecks')} : {r.findtext('description').strip()}")
PY
}
