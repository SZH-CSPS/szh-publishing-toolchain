#!/bin/bash
# Démo du correctif 90 : un seul contenu marqué pour les lignes d'un même bloc.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 90-un-mcid-par-element.patch 20-cesure-trait.patch 25-espace-fin-de-ligne.patch

for venv in NU PATCHE; do
  echo
  echo "== lignes, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/lignes-$venv.pdf"
  rendre "${!venv}" "$ICI/lignes.html" "$pdf"
  verapdf_ua1 "$pdf"
  "$NU/bin/python" "$AMONT/inspecter.py" mcid "$pdf"
  echo "  arbre de structure :"
  "$NU/bin/python" "$AMONT/inspecter.py" arbre "$pdf" | sed 's/^/  /'
done
