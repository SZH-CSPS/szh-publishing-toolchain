#!/bin/bash
# Démo du correctif 60 : /Lang sur l'élément de structure d'un passage dans une autre langue.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 60-langue-element.patch

for venv in NU PATCHE; do
  echo
  echo "== langue-element, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/langue-element-$venv.pdf"
  rendre "${!venv}" "$ICI/langue-element.html" "$pdf"
  verapdf_ua1 "$pdf"
  echo "  arbre de structure :"
  "$NU/bin/python" "$AMONT/inspecter.py" arbre "$pdf" | sed 's/^/  /'
done
