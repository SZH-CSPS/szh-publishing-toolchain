"""Cotes de la maquette normal sur le PDF numérique d'un livre compilé, à 0,25 mm près.

    /opt/weasyprint/bin/python test/livre-cotes-check.py test/livre-normal

Les valeurs sont celles des livres de référence (docs/ARCHITECTURE-LIVRES.md). Une
ligne FAIL par écart, code de sortie 1 s'il y en a ; le verdict se lit sur l'absence de FAIL.
"""
import os
import sys

import pypdf

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(ICI, '..', 'pipeline'))
from szh_commun import lire_yaml  # noqa: E402

TOLERANCE = 0.25
PT_MM = 25.4 / 72
FOLIO_Y = 215.0
DERNIERE_LIGNE = 201.0
PREMIERE_LIGNE = 20.0
DEMI_TITRE = (58.1, 67.6, 77.1)
# Titre du sommaire et première entrée : plat (Hofer p6), hiérarchique (HfH p7).
SOMMAIRE = {'plat': (21.8, 48.6), 'hierarchique': (21.8, 58.1)}
OUVERTURE_AUTEURS = (19.5, 29.0, 43.8)
# Nom que WeasyPrint donne à la face Regular semi-condensée dans le PDF.
REGULIER = 'Open-Sans-Semi-Condensed'


def lignes(page):
    """[(y de ligne de base en mm depuis le haut, police, corps, texte)], triées par y."""
    haut = float(page.mediabox[3])
    vues = {}

    def visiteur(texte, cm, tm, police, corps):
        if not texte.strip():
            return
        y = round((haut - (cm[1] * tm[4] + cm[3] * tm[5] + cm[5])) * PT_MM, 1)
        nom = str((police or {}).get('/BaseFont', '?')).split('+')[-1]
        taille = round(corps * abs(tm[3]) * abs(cm[3]) if tm[3] else corps, 2)
        vues.setdefault(y, []).append((nom, taille, texte))

    page.extract_text(visitor_text=visiteur)
    return [(y, v[0][0], max(t for _, t, _ in v), ''.join(x for *_, x in v))
            for y, v in sorted(vues.items())]


def proche(a, b):
    return abs(a - b) <= TOLERANCE


def main(dossier):
    buch = lire_yaml(os.path.join(dossier, 'buch.yaml'))
    if str(buch.get('maquette') or 'normal') != 'normal':
        print('ok   | maquette %s : pas de cotes normal' % buch.get('maquette'))
        return 0
    nom = os.path.basename(os.path.abspath(dossier))
    sorte_sommaire = str((buch.get('mise-en-page') or {}).get('sommaire') or 'plat')
    pdf = pypdf.PdfReader(os.path.join(dossier, 'out', nom + '.pdf'))
    echecs = []

    def echec(n, quoi, vu, attendu):
        echecs.append('FAIL | p%d | %s : %s mm, attendu %s mm' % (n, quoi, vu, attendu))

    pages = [lignes(p) for p in pdf.pages]
    for n, ls in enumerate(pages, 1):
        folios = [l for l in ls if l[0] > 205 and l[2] <= 8.5]
        corps = [l for l in ls if l not in folios]
        for y, *_ in folios:
            if not proche(y, FOLIO_Y):
                echec(n, 'folio', y, FOLIO_Y)
        for y, *_ in corps:
            if y > DERNIERE_LIGNE + TOLERANCE:
                echec(n, 'ligne sous la dernière ligne de la grille', y, DERNIERE_LIGNE)
        # Page qui continue un texte : sa première ligne est du texte courant de 10 pt.
        if corps and corps[0][2] == 10 and corps[0][1] == REGULIER and corps[0][0] < 30:
            if not proche(corps[0][0], PREMIERE_LIGNE):
                echec(n, 'première ligne de texte', corps[0][0], PREMIERE_LIGNE)
        textes = [t for *_, t in corps]
        if any(t.strip().startswith(('Inhaltsverzeichnis', 'Sommaire', 'Indice')) for t in textes[:1]):
            for (y, *_), attendu in zip(corps[:2], SOMMAIRE[sorte_sommaire]):
                if not proche(y, attendu):
                    echec(n, 'sommaire', y, attendu)
        # Ouverture à auteurs dessus : Medium 10, puis titre de 16 pt d'une ligne, puis texte.
        if len(corps) >= 3 and corps[0][2] == 10 and 'Medium' in corps[0][1] \
                and corps[1][2] == 16 and corps[2][2] == 10 and corps[0][0] < 25:
            for (y, *_), attendu in zip(corps[:3], OUVERTURE_AUTEURS):
                if not proche(y, attendu):
                    echec(n, 'ouverture à auteurs', y, attendu)
    premiere = [l for l in pages[0] if l[0] < 205]
    if len(premiere) >= 3:
        for (y, *_), attendu in zip(premiere[:3], DEMI_TITRE):
            if not proche(y, attendu):
                echec(1, 'demi-titre', y, attendu)
    for e in echecs:
        print(e)
    if not echecs:
        print('ok   | %d pages aux cotes de la maquette normal (± %.2f mm)' % (len(pages), TOLERANCE))
    return 1 if echecs else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else '.'))
