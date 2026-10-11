#!/bin/bash
# Démo du correctif 80 : la note de bas de page est une /Note rangée après son appel.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 80-notes-balisees.patch

for venv in NU PATCHE; do
  echo
  echo "== notes, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/notes-$venv.pdf"
  rendre "${!venv}" "$ICI/notes.html" "$pdf"
  verapdf_ua1 "$pdf"
  echo "  arbre de structure :"
  "$NU/bin/python" "$AMONT/inspecter.py" arbre "$pdf" | sed 's/^/  /'
done
