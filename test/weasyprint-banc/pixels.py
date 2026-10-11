"""Empreinte des pixels de chaque page et texte extrait par pdfium.

    python pixels.py <pdf>…        → écrit <pdf>.pix.json à côté de chaque PDF

Lancé par banc.py avec le Python du venv du banc, qui a pypdfium2.
"""
import hashlib
import json
import sys

import pypdfium2 as pdfium

ECHELLE = 2  # 144 dpi


def main():
    for chemin in sys.argv[1:]:
        sortie = {'pages': [], 'texte': ''}
        try:
            doc = pdfium.PdfDocument(chemin)
            textes = []
            for page in doc:
                image = page.render(scale=ECHELLE).to_pil().convert('RGB')
                sortie['pages'].append(hashlib.md5(image.tobytes()).hexdigest())
                tp = page.get_textpage()
                textes.append(tp.get_text_range())
            sortie['texte'] = ' '.join(' '.join(textes).replace('­', '').split())
        except Exception as e:  # noqa: BLE001
            sortie['echec'] = repr(e)
        with open(chemin + '.pix.json', 'w', encoding='utf-8') as f:
            json.dump(sortie, f, ensure_ascii=False)


if __name__ == '__main__':
    main()
