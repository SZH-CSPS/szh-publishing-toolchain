# Outils communs des démos (sourcé par <nn>-<nom>/demo/demo.sh, dans la WSL SZH-Publishing).
# Fabrique deux copies jetables du venv WeasyPrint : « nu » (WeasyPrint 70 tel que publié,
# tous les correctifs SZH retirés) et « patché » (nu + le seul correctif démontré, posé par
# image/patch-weasyprint.sh). /opt/weasyprint n'est jamais modifié.
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

# preparer_venvs <nom du patch> : pose $NU et $PATCHE.
preparer_venvs() {
  local patch="$1" version site temoin p
  NU="$TRAVAIL/nu"
  PATCHE="$TRAVAIL/patche"
  cp -a "$SOURCE_VENV" "$NU"
  version="$("$NU/bin/python" -c 'import weasyprint; print(weasyprint.__version__)')"
  site="$(site_de "$NU")"
  temoin="$site/weasyprint/szh-patchs.txt"
  # Les correctifs déjà posés sur la source sont retirés, du dernier au premier.
  if [ -e "$temoin" ]; then
    for p in $(tac "$temoin"); do
      patch -s -R -d "$site" -p1 --batch --fuzz=0 --no-backup-if-mismatch \
        < "$IMAGE/patches/weasyprint-$version/$p"
    done
    rm "$temoin"
  fi
  find "$site/weasyprint" -name '__pycache__' -prune -exec rm -rf {} +
  cp -a "$NU" "$PATCHE"
  mkdir -p "$TRAVAIL/un-seul/weasyprint-$version"
  cp "$IMAGE/patches/weasyprint-$version/$patch" "$TRAVAIL/un-seul/weasyprint-$version/"
  sh "$IMAGE/patch-weasyprint.sh" "$PATCHE/bin/python" "$TRAVAIL/un-seul" | sed 's/^/  /'
  echo "  nu     : WeasyPrint $version, aucun correctif SZH"
  echo "  patché : WeasyPrint $version + $(cat "$(site_de "$PATCHE")/weasyprint/szh-patchs.txt")"
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
