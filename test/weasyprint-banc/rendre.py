"""Rend des cas HTML en PDF avec le WeasyPrint importable : celui de la pile, que banc.py
place en tête du PYTHONPATH.

    python rendre.py <dossier-cas> <dossier-sortie> <variante>[,<variante>…] <cas>…

Écrit <sortie>/<cas>.<variante>.pdf et <sortie>/<cas>.<variante>.json : exception (trace),
journal de WeasyPrint (avertissements et erreurs), durée, et le chemin du WeasyPrint
réellement importé, pour vérifier que la pile est bien celle qu'on croit.
"""
import json
import logging
import os
import sys
import time
import traceback

import weasyprint

VARIANTES = {
    'ua1': {'pdf_variant': 'pdf/ua-1'},
    'tags': {'pdf_tags': True},
    'nu': {},
    'a3u': {'pdf_variant': 'pdf/a-3u'},
}


class Journal(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.lignes = []

    def emit(self, record):
        self.lignes.append(f'{record.levelname} {record.getMessage()}')


def main():
    cas_dir, sortie, variantes, *cas = sys.argv[1:]
    os.makedirs(sortie, exist_ok=True)
    journal = Journal()
    for nom in ('weasyprint', 'weasyprint.progress'):
        logging.getLogger(nom).addHandler(journal)
    for nom in cas:
        source = os.path.join(cas_dir, nom + '.html')
        for variante in variantes.split(','):
            base = os.path.join(sortie, f'{nom}.{variante}')
            journal.lignes = []
            debut = time.monotonic()
            exception = None
            try:
                weasyprint.HTML(filename=source).write_pdf(
                    base + '.pdf', **VARIANTES[variante])
            except Exception:
                exception = traceback.format_exc()
                if os.path.exists(base + '.pdf'):
                    os.remove(base + '.pdf')
            with open(base + '.json', 'w', encoding='utf-8') as f:
                json.dump({
                    'exception': exception,
                    'journal': sorted(set(journal.lignes)),
                    'secondes': round(time.monotonic() - debut, 3),
                    'weasyprint': os.path.dirname(weasyprint.__file__),
                }, f, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
