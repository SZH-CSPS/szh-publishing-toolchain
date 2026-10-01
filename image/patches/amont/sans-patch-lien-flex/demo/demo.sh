#!/bin/bash
# Démo : un <a> enfant direct d'un conteneur flex n'a pas d'annotation /Link, un <span>
# intermédiaire la rend. WeasyPrint 70 tel qu'installé, aucun correctif à poser.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

# compter <pdf> : annotations /Link du PDF, avec leur cible.
compter() {
  "$SOURCE_VENV/bin/python" - "$1" <<'PY'
import sys
from pypdf import PdfReader
r = PdfReader(sys.argv[1])
annots = [a.get_object() for p in r.pages for a in p.get('/Annots', [])]
liens = [a for a in annots if a.get('/Subtype') == '/Link']
print(f"  annotations /Link : {len(liens)}")
for a in liens:
    print(f"    {a['/A']['/URI']}")
PY
}

echo "== WeasyPrint $("$SOURCE_VENV/bin/python" -c 'import weasyprint; print(weasyprint.__version__)')"
for cas in sans avec; do
  if [ $cas = sans ]; then
    sed '/With an intermediate span/,$d' "$ICI/lien-flex.html" > "$TRAVAIL/$cas.html"
  else
    { sed -n '1,/^<\/style>/p' "$ICI/lien-flex.html"; sed -n '/With an intermediate span/,$p' "$ICI/lien-flex.html"; } > "$TRAVAIL/$cas.html"
  fi
  echo
  echo "== $cas <span> intermédiaire"
  rendre "$SOURCE_VENV" "$TRAVAIL/$cas.html" "$TRAVAIL/$cas.pdf"
  compter "$TRAVAIL/$cas.pdf"
done
