#!/bin/bash
# Démo du correctif 65 : nom des liens en /Contents (annotation) et /Alt (élément /Link).
# Lancer dans la WSL : wsl.exe -d SZH-Publishing -- bash <chemin>/demo.sh
ICI="$(cd "$(dirname "$0")" && pwd)"
. "$ICI/../../demo-commun.sh"

echo "== Préparation des deux venvs"
preparer_venvs 65-nom-des-liens.patch

# liens <pdf> : pour chaque élément /Link, son /Alt et le /Contents de son annotation.
liens() {
  "$NU/bin/python" - "$1" <<'PY'
import sys
from pypdf import PdfReader
from pypdf.generic import ArrayObject, DictionaryObject, IndirectObject

def res(o):
    return o.get_object() if isinstance(o, IndirectObject) else o

def enfants(e):
    k = res(e.get('/K'))
    return [] if k is None else [res(x) for x in (k if isinstance(k, ArrayObject) else [k])]

def parcourir(e):
    if not isinstance(e, DictionaryObject):
        return
    if e.get('/S') == '/Link':
        contents = [str(res(k['/Obj']).get('/Contents')) for k in enfants(e)
                    if isinstance(k, DictionaryObject) and k.get('/Type') == '/OBJR']
        alt = str(e['/Alt']) if '/Alt' in e else '-'
        print(f'  /Link  Contents={contents}  Alt={alt!r}')
    for k in enfants(e):
        parcourir(k)

parcourir(res(PdfReader(sys.argv[1]).trailer['/Root']['/StructTreeRoot']))
PY
}

for venv in NU PATCHE; do
  echo
  echo "== liens, WeasyPrint $([ $venv = NU ] && echo nu || echo patché)"
  pdf="$TRAVAIL/liens-$venv.pdf"
  rendre "${!venv}" "$ICI/liens.html" "$pdf"
  verapdf_ua1 "$pdf"
  liens "$pdf"
done
