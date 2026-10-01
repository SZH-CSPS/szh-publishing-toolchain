#!/bin/bash
# Démo du correctif 15 : image décorative peinte en artefact, sans /Figure.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 15-images-decoratives.patch

for venv in NU PATCHE; do
  echo
  echo "== image-decorative, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/image-decorative-$venv.pdf"
  rendre "${!venv}" "$ICI/image-decorative.html" "$pdf"
  verapdf_ua1 "$pdf"
  echo "  arbre de structure :"
  "$NU/bin/python" "$AMONT/inspecter.py" arbre "$pdf" | sed 's/^/  /'
  "$NU/bin/python" "$AMONT/inspecter.py" artefacts "$pdf"
done
