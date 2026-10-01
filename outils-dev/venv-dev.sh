#!/bin/bash
# Crée (ou met à jour) ~/pdfvenv, le venv de développement de la WSL SZH-Publishing :
# pypdfium2 et Pillow pour le rendu PNG (test/render.py, test/render-all.py,
# test/build-render.sh), PyYAML pour le contrôle YAML de test/js/porte-release.js.
# Versions épinglées : le rendu au pixel ne se compare qu'à moteur identique.
#
# Depuis Windows, par l'outil PowerShell (jamais Git Bash, qui casse /mnt/c) :
#   wsl.exe -d SZH-Publishing -- bash /mnt/c/<dépôt>/outils-dev/venv-dev.sh
set -euo pipefail

VENV="${SZH_VENV_DEV:-$HOME/pdfvenv}"

if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
fi
"$VENV/bin/python" -m pip install --quiet --upgrade \
  pypdfium2==5.13.0 \
  pillow==12.3.0 \
  pyyaml==6.0.3
"$VENV/bin/python" -c 'import sys, pypdfium2, PIL, yaml; print(sys.version.split()[0], "pypdfium2", pypdfium2.version.PYPDFIUM_INFO, "Pillow", PIL.__version__, "PyYAML", yaml.__version__)'
