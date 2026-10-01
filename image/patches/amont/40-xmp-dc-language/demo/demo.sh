#!/bin/bash
# Démo du correctif 40 : dc:language dans le XMP, tirée de <html lang>.
# Trois rendus : nu, nu avec le seul recours amont (--xmp-metadata), patché.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 40-xmp-dc-language.patch

montrer() {
  verapdf_ua1 "$1"
  "$NU/bin/python" "$AMONT/inspecter.py" xmp "$1"
}

echo
echo "== langue, WeasyPrint nu"
rendre "$NU" "$ICI/langue.html" "$TRAVAIL/nu.pdf"
montrer "$TRAVAIL/nu.pdf"

echo
echo "== langue, WeasyPrint nu + --xmp-metadata dc-language.xmp"
rendre "$NU" "$ICI/langue.html" "$TRAVAIL/nu-xmp.pdf" --xmp-metadata "$ICI/dc-language.xmp"
montrer "$TRAVAIL/nu-xmp.pdf"

echo
echo "== langue, WeasyPrint patché"
rendre "$PATCHE" "$ICI/langue.html" "$TRAVAIL/patche.pdf"
montrer "$TRAVAIL/patche.pdf"
