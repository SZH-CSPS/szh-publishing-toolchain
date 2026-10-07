#!/bin/bash
# Démo du correctif 50 : une note reportée à la page suivante n'y est imprimée qu'une fois,
# même quand un target-counter fait repaginer. Deux rendus : nu, patché.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 50-notes-doublon.patch

montrer() {
  verapdf_ua1 "$1"
  "$NU/bin/python" "$AMONT/inspecter.py" pages "$1"
}

echo
echo "== doublon, WeasyPrint nu"
rendre "$NU" "$ICI/doublon.html" "$TRAVAIL/nu.pdf"
montrer "$TRAVAIL/nu.pdf"

echo
echo "== doublon, WeasyPrint nu, une seule passe de mise en page (sans repagination)"
"$NU/bin/python" - "$ICI/doublon.html" "$TRAVAIL/nu-1passe.pdf" <<'PY'
import sys
import weasyprint.document
from weasyprint import HTML
origine = weasyprint.document.layout_document
weasyprint.document.layout_document = lambda *a, **k: origine(*a, **{**k, 'max_loops': 1})
HTML(sys.argv[1]).write_pdf(sys.argv[2])
PY
"$NU/bin/python" "$AMONT/inspecter.py" pages "$TRAVAIL/nu-1passe.pdf"

echo
echo "== doublon, WeasyPrint patché"
rendre "$PATCHE" "$ICI/doublon.html" "$TRAVAIL/patche.pdf"
montrer "$TRAVAIL/patche.pdf"
