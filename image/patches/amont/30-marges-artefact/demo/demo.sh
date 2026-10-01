#!/bin/bash
# Démo du correctif 30 : boîtes de marge (@page) en /Artifact de pagination.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 30-marges-artefact.patch

for venv in NU PATCHE; do
  echo
  echo "== marges, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/marges-$venv.pdf"
  rendre "${!venv}" "$ICI/marges.html" "$pdf"
  verapdf_ua1 "$pdf"
  echo "  contenu marqué :"
  "$NU/bin/python" "$AMONT/inspecter.py" mcid "$pdf" | sed 's/^/  /'
  echo "  artefacts :"
  "$NU/bin/python" "$AMONT/inspecter.py" artefacts "$pdf" | sed 's/^/  /'
  echo "  arbre de structure :"
  "$NU/bin/python" "$AMONT/inspecter.py" arbre "$pdf" | sed 's/^/  /'
done
