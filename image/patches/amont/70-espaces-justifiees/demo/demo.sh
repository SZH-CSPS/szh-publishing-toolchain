#!/bin/bash
# Démo du correctif 70 : espaces des lignes justifiées dessinées contre leur mot.
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
# pdfium (pypdfium2) est lu dans PDFIUM_VENV (par défaut ~/pdfvenv, outils-dev/venv-dev.sh).
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"
PDFIUM_VENV="${PDFIUM_VENV:-$HOME/pdfvenv}"

echo "== Préparation des deux venvs"
preparer_venvs 70-espaces-justifiees.patch

# espaces <pdf> : dans les TJ, espaces dessinées et espaces précédées d'un décalage ; puis,
# si pdfium est là, espaces générées (déduites d'un écart) et espaces lues dans le flux.
espaces() {
  "$NU/bin/python" - "$1" <<'PY'
import re
import sys
from pypdf import PdfReader
from pypdf.generic import ContentStream, TextStringObject

r = PdfReader(sys.argv[1])
page = r.pages[0]
espaces = set()
for police in page['/Resources']['/Font'].values():
    cmap = police.get_object()['/ToUnicode'].get_object().get_data().decode('latin-1')
    espaces |= {int(g, 16) for g, u in re.findall(r'<([0-9A-Fa-f]{4})>\s*<([0-9A-Fa-f]+)>', cmap)
                if u.lower() == '0020'}
dessinees = decalees = 0
for operandes, op in ContentStream(page.get_contents(), r).operations:
    if op != b'TJ':
        continue
    precedent = None
    for x in operandes[0]:
        if isinstance(x, (bytes, str)):
            b = x.original_bytes if isinstance(x, TextStringObject) else x
            for i in range(0, len(b), 2):
                if int.from_bytes(b[i:i + 2], 'big') in espaces:
                    dessinees += 1
                    decalees += i == 0 and precedent is not None and precedent < -50
            precedent = None
        else:
            precedent = float(x)
print(f'  TJ : {dessinees} espaces dessinées, dont {decalees} précédées d\'un décalage')
PY
  if [ -x "$PDFIUM_VENV/bin/python" ]; then
    "$PDFIUM_VENV/bin/python" - "$1" <<'PY'
import sys
import pypdfium2 as pdfium
import pypdfium2.raw as raw
tp = pdfium.PdfDocument(sys.argv[1])[0].get_textpage()
t = tp.get_text_range()
gen = [i for i in range(tp.count_chars()) if t[i] == ' ' and raw.FPDFText_IsGenerated(tp.raw, i) == 1]
print(f'  pdfium : {len(gen)} espaces générées, '
      f'{sum(1 for c in t if c == " ") - len(gen)} lues dans le flux')
print(f'  pdfium, 3e ligne : {t.splitlines()[3]!r}')
PY
  fi
}

for venv in NU PATCHE; do
  echo
  echo "== justifie, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/justifie-$venv.pdf"
  rendre "${!venv}" "$ICI/justifie.html" "$pdf"
  verapdf_ua1 "$pdf"
  espaces "$pdf"
done
echo
echo "== pixels nu / patché"
if [ -x "$PDFIUM_VENV/bin/python" ]; then
  "$PDFIUM_VENV/bin/python" - "$TRAVAIL/justifie-NU.pdf" "$TRAVAIL/justifie-PATCHE.pdf" <<'PY'
import sys
import pypdfium2 as pdfium
a, b = (pdfium.PdfDocument(p)[0].render(scale=300 / 72).to_pil().tobytes() for p in sys.argv[1:])
print('  identiques à 300 dpi' if a == b else '  DIFFÉRENTS')
PY
fi
