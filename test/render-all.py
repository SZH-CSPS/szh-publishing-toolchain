# Rend toutes les pages d'un PDF en PNG numérotés, pour relire une maquette page à page.
#
#   python render-all.py <pdf> <préfixe de sortie> [échelle]
#
# Appelé par build-render.sh, qui tourne dans WSL et lui passe l'interpréteur du venv
# pypdfium2 (voir $SZH_RENDER). Pour une seule page, côté Windows, voir render.py.
import sys
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument(sys.argv[1])
base = sys.argv[2]
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.15
n = len(pdf)
for i in range(n):
    pdf[i].render(scale=scale).to_pil().save("%s-%d.png" % (base, i + 1))
print("pages:", n)
