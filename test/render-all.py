import sys
import pypdfium2 as pdfium

pdf = pdfium.PdfDocument(sys.argv[1])
base = sys.argv[2]
scale = float(sys.argv[3]) if len(sys.argv) > 3 else 1.15
n = len(pdf)
for i in range(n):
    pdf[i].render(scale=scale).to_pil().save("%s-%d.png" % (base, i + 1))
print("pages:", n)
