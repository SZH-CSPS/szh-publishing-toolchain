#!/bin/bash
# Build PDF + capture PNG de chaque page, pour tous les articles de test.
# À lancer depuis WSL (distro SZH-Publishing) :
#   bash /mnt/c/.../szh-publishing-toolchain/test/build-render.sh [slug]
# Prérequis rendu PNG : un venv Python avec pypdfium2 + Pillow (voir README.md),
# chemin dans $SZH_RENDER (défaut : ~/pdfvenv/bin/python).
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
RENDER="${SZH_RENDER:-$HOME/pdfvenv/bin/python}"
cd "$REPO/test" || exit 1
only="${1:-}"
for d in articles/*/; do
  slug="$(basename "$d")"
  [ -n "$only" ] && [ "$only" != "$slug" ] && continue
  echo "=== $slug ==="
  rm -rf "out/$slug"
  make -f "$REPO/pipeline/Makefile" "out/$slug/$slug.pdf" 2>&1 \
    | grep -iE "nonempty|error|traceback|warning" || echo "  build ok"
  if [ -x "$RENDER" ] || command -v "$RENDER" >/dev/null 2>&1; then
    "$RENDER" render-all.py "out/$slug/$slug.pdf" "out/$slug/page" 1.15 \
      && echo "  PNG -> out/$slug/page-*.png"
  else
    echo "  (rendu PNG ignoré : renderer introuvable en $RENDER)"
  fi
done
