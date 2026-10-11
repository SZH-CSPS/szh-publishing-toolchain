#!/bin/bash
# Démo du correctif 75 : auteurs de /Info /Author séparés par « ; », dc:creator inchangé.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 75-auteurs-info.patch

for venv in NU PATCHE; do
  echo
  echo "== auteurs, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/auteurs-$venv.pdf"
  rendre "${!venv}" "$ICI/auteurs.html" "$pdf"
  verapdf_ua1 "$pdf"
  "$NU/bin/python" - "$pdf" <<'PY'
import sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
print(f'  /Info /Author : {r.metadata.get("/Author")!r}')
print(f'  dc:creator    : {r.xmp_metadata.dc_creator}')
PY
done
