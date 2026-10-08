#!/usr/bin/env python3
# Étape d'import : fait passer à travers pandoc les styles de corps du gabarit Pronto
# (« SZH Important », « SZH Hervorhebung », « SZH Question (interview) ») et la ligne
# d'auteurs d'un chapitre de livre (STYLES_AUTEURS_CHAPITRE).
#
#   python3 docx-styles-corps.py <entree.docx> <sortie.docx>
#
# pandoc perd les styles de paragraphe. L'extension `docx+styles` les garde mais modifie
# le reste (le gras du style « Strong » devient un Span, une cellule passe de Plain à Para,
# une figure perd sa légende). Le script écrit donc une copie du document où chaque
# paragraphe de ces styles commence par un marqueur en caractères de la zone privée
# d'Unicode ; szh-styles-corps.lua, premier filtre de l'import, le remplace par le bloc du
# cockpit. Le reste du document est inchangé.
#
# Le style est reconnu par son nom (w:name), pas par son identifiant, que Word localise
# (« SZHQuestioninterview »).
#
# Sortie : une ligne JSON de statistiques sur stdout. Code 0 même si rien n'est marqué.

import json
import re
import sys
import os
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from pronto_modele import normaliser_nom_style

# Nom du style Word -> classe du bloc du cockpit (lib/formatting-pur.js, CLASSES_BLOCS).
# À garder identique dans szh-styles-corps.lua.
STYLES_BLOCS = {
    'SZH Important': 'important',
    'SZH Hervorhebung': 'highlight',
    'SZH Question (interview)': 'question',
}

# Livre : la ligne d'auteurs sous le titre d'un chapitre, dans un style d'un ancien
# gabarit. « Auhors » (sic) est le nom réel trouvé dans des documents. N'ajouter une
# variante qu'après l'avoir vue dans un .docx réel. Même classe que le bloc auteurs de
# szh-livre-auteurs.lua, pour un seul sélecteur dans styles/livre/falc.css.
STYLES_AUTEURS_CHAPITRE = {
    'Auhors': 'szh-auteurs',
    'Authors': 'szh-auteurs',
    'Auteurs': 'szh-auteurs',
    'Autor·innen': 'szh-auteurs',
}

TOUS_LES_STYLES = {**STYLES_BLOCS, **STYLES_AUTEURS_CHAPITRE}
# Par nom normalisé : « SZH-Important » et « szh important » désignent le même style.
_STYLES_NORMALISES = {normaliser_nom_style(n): c for n, c in TOUS_LES_STYLES.items()}

DEBUT, FIN = '', ''


def marqueur(classe):
    return DEBUT + classe + FIN


def ids_par_classe(styles_xml):
    """{identifiant de style: classe} pour les styles de paragraphe de TOUS_LES_STYLES."""
    ids = {}
    for m in re.finditer(r'<w:style\b[^>]*>.*?</w:style>', styles_xml, re.S):
        bloc = m.group()
        if 'w:type="paragraph"' not in bloc[:bloc.find('>')]:
            continue
        sid = re.search(r'w:styleId="([^"]+)"', bloc)
        nom = re.search(r'<w:name w:val="([^"]+)"', bloc)
        classe = _STYLES_NORMALISES.get(normaliser_nom_style(nom.group(1))) if nom else None
        if sid and classe:
            ids[sid.group(1)] = classe
    return ids


def marquer(document_xml, ids):
    """Insère un run marqueur juste après le <w:pPr> de chaque paragraphe visé.

    Seul compte le <w:pStyle> de premier niveau du <w:pPr>. Celui d'un <w:pPrChange> est
    l'ancien style d'une modification suivie, que l'import accepte ; son </w:pPr> interne
    n'est pas la fin du <w:pPr>."""
    if not ids:
        return document_xml, {}
    motif = re.compile(r'<w:pStyle w:val="(%s)"\s*/>' % '|'.join(re.escape(i) for i in ids))
    morceaux, pos, compte = [], 0, {}
    for m in motif.finditer(document_xml):
        avant = document_xml[:m.start()]
        if avant.rfind('<w:pPrChange') > avant.rfind('</w:pPrChange>'):
            continue
        fin = document_xml.find('</w:pPr>', m.end())
        change = document_xml.find('<w:pPrChange', m.end())
        if change != -1 and change < fin:
            fin = document_xml.find('</w:pPr>', document_xml.find('</w:pPrChange>', change))
        if fin == -1:
            continue
        fin += len('</w:pPr>')
        classe = ids[m.group(1)]
        morceaux.append(document_xml[pos:fin])
        morceaux.append('<w:r><w:t>%s</w:t></w:r>' % marqueur(classe))
        pos = fin
        compte[classe] = compte.get(classe, 0) + 1
    morceaux.append(document_xml[pos:])
    return ''.join(morceaux), compte


def principal(entree, sortie):
    with zipfile.ZipFile(entree) as zi:
        noms = zi.namelist()
        styles = zi.read('word/styles.xml').decode('utf-8') if 'word/styles.xml' in noms else ''
        ids = ids_par_classe(styles)
        doc, compte = marquer(zi.read('word/document.xml').decode('utf-8'), ids)
        with zipfile.ZipFile(sortie, 'w', zipfile.ZIP_DEFLATED) as zo:
            for info in zi.infolist():
                data = doc.encode('utf-8') if info.filename == 'word/document.xml' \
                    else zi.read(info.filename)
                zo.writestr(info, data)
    print(json.dumps({'blocs': compte}, ensure_ascii=False))


if __name__ == '__main__':
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) != 3:
        sys.exit('usage : docx-styles-corps.py <entree.docx> <sortie.docx>')
    principal(sys.argv[1], sys.argv[2])
