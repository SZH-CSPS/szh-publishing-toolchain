#!/bin/bash
# Démo du correctif 85 : sous-liste dans le /LBody de son item, <dl> en /Lbl et /LBody.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 85-listes-imbriquees.patch

for venv in NU PATCHE; do
  echo
  echo "== listes, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/listes-$venv.pdf"
  rendre "${!venv}" "$ICI/listes.html" "$pdf"
  verapdf_ua1 "$pdf"
  echo "  arbre de structure :"
  "$NU/bin/python" "$AMONT/inspecter.py" arbre "$pdf" | sed 's/^/  /'
done
