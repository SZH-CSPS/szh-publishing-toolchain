import sys
import pypdfium2 as pdfium

pdf_path = sys.argv[1]
out_png = sys.argv[2]
page_idx = int(sys.argv[3]) if len(sys.argv) > 3 else 0
scale = float(sys.argv[4]) if len(sys.argv) > 4 else 1.4

doc = pdfium.PdfDocument(pdf_path)
n = len(doc)
idx = max(0, min(page_idx, n - 1))
page = doc[idx]
bitmap = page.render(scale=scale)
img = bitmap.to_pil()
img.save(out_png)
print("rendu page %d/%d -> %s %s" % (idx + 1, n, out_png, img.size))
