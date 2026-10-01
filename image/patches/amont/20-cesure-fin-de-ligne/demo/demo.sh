#!/bin/bash
# Démo du correctif 20 : trait de césure en /ActualText U+00AD, espace de fin de ligne
# remise dans la couche texte.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 20-cesure-fin-de-ligne.patch

for venv in NU PATCHE; do
  echo
  echo "== cesure, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/cesure-$venv.pdf"
  rendre "${!venv}" "$ICI/cesure.html" "$pdf"
  verapdf_ua1 "$pdf"
  echo "  texte extrait par pypdf (· = espace) :"
  "$NU/bin/python" "$AMONT/inspecter.py" texte "$pdf" | sed 's/^/  /'
  echo "  flux de contenu, marques de césure :"
  "$NU/bin/python" "$AMONT/inspecter.py" flux "$pdf" 'ActualText' | sed 's/^/  /'
done
