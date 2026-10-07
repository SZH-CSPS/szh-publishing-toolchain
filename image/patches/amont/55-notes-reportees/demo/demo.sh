#!/bin/bash
# Démo du correctif 55 : la note d'un paragraphe déjà posé reste sur sa page quand le
# paragraphe suivant manque de lignes pour respecter orphans.
# Deux rendus : nu, patché. Pas de repagination dans reportee.html, le 50 n'y joue pas.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 55-notes-reportees.patch

montrer() {
  verapdf_ua1 "$1"
  "$NU/bin/python" "$AMONT/inspecter.py" pages "$1"
}

echo
echo "== reportee, WeasyPrint nu"
rendre "$NU" "$ICI/reportee.html" "$TRAVAIL/nu.pdf"
montrer "$TRAVAIL/nu.pdf"

echo
echo "== reportee, WeasyPrint patché"
rendre "$PATCHE" "$ICI/reportee.html" "$TRAVAIL/patche.pdf"
montrer "$TRAVAIL/patche.pdf"
