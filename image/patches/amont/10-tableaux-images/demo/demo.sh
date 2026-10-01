#!/bin/bash
# Démo du correctif 10 : /Headers d'un th colspan, et image décorative en artefact.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 10-tableaux-images.patch

for cas in tableau-colspan tableau-rowspan image-decorative; do
  for venv in NU PATCHE; do
    echo
    echo "== $cas, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
    pdf="$TRAVAIL/$cas-$venv.pdf"
    rendre "${!venv}" "$ICI/$cas.html" "$pdf"
    verapdf_ua1 "$pdf"
    echo "  arbre de structure :"
    "$NU/bin/python" "$AMONT/inspecter.py" arbre "$pdf" | sed 's/^/  /'
    if [ $cas = image-decorative ]; then
      "$NU/bin/python" "$AMONT/inspecter.py" artefacts "$pdf"
    fi
  done
done
