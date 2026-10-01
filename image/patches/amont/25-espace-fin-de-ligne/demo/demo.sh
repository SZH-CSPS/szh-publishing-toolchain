#!/bin/bash
# Démo du correctif 25 : espace de fin de ligne remise dans la couche texte. Le dessin de
# l'espace est dans le 20 : les deux venvs le portent, seul le patché a le 25.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 25-espace-fin-de-ligne.patch 20-cesure-trait.patch

for venv in NU PATCHE; do
  echo
  echo "== espace, WeasyPrint $([ $venv = NU ] && echo "+ 20" || echo "+ 20 + 25")"
  pdf="$TRAVAIL/espace-$venv.pdf"
  rendre "${!venv}" "$ICI/espace.html" "$pdf"
  verapdf_ua1 "$pdf"
  echo "  texte extrait par pypdf (· = espace) :"
  "$NU/bin/python" "$AMONT/inspecter.py" texte "$pdf" | sed 's/^/  /'
done
