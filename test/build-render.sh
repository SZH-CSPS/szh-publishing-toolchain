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
echec=0
for d in articles/*/; do
  slug="$(basename "$d")"
  [ -n "$only" ] && [ "$only" != "$slug" ] && continue
  echo "=== $slug ==="
  rm -rf "out/$slug"
  journal="out/$slug-build.log"
  mkdir -p out
  # Le code de sortie est celui de make, pas celui du grep qui suit : sinon un
  # échec dont le message ne contient aucun des mots cherchés passe pour un succès.
  if make -f "$REPO/pipeline/Makefile" "out/$slug/$slug.pdf" > "$journal" 2>&1; then
    grep -iE "nonempty|error|traceback|warning" "$journal" || echo "  build ok"
  else
    echo "  ÉCHEC du build :"
    sed -n '1,40p' "$journal" | sed 's/^/    /'
    echec=1
    continue
  fi
  if [ -x "$RENDER" ] || command -v "$RENDER" >/dev/null 2>&1; then
    "$RENDER" render-all.py "out/$slug/$slug.pdf" "out/$slug/page" 1.15 \
      && echo "  PNG -> out/$slug/page-*.png"
  else
    echo "  (rendu PNG ignoré : renderer introuvable en $RENDER)"
  fi
done
exit $echec
