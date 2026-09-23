#!/usr/bin/env python3
# docx-styles-corps.py — pré-pass d'import : les styles de corps du gabarit Pronto
# (« SZH Important », « SZH Hervorhebung », « SZH Question (interview) ») survivent à pandoc,
# et de même pour la ligne d'auteur·e·s d'un chapitre de livre (STYLES_AUTEURS_CHAPITRE).
#
#   python3 docx-styles-corps.py <entree.docx> <sortie.docx>
#
# pandoc lit un .docx sans ses styles de paragraphe. La lecture `docx+styles` les garde,
# mais elle change tout le reste de l'arbre — mesuré sur 16 documents réels : le gras
# posé par le style de caractère « Strong » devient un Span, une cellule de tableau passe
# de Plain à Para, une figure perd sa légende. Ce pré-pass écrit donc une COPIE du
# document où chaque paragraphe d'un de ces styles commence par un marqueur, fait de
# caractères de la zone privée d'Unicode ; szh-styles-corps.lua, premier filtre de
# l'import, retire le marqueur et pose le bloc du cockpit. Le reste du document n'est pas
# touché d'un octet, et seul pandoc lit la copie.
#
# Le style est reconnu par son nom (w:name de styles.xml), jamais par son identifiant :
# Word localise l'identifiant (« SZHQuestioninterview »), pas le nom.
#
# Sortie : une ligne JSON de stats sur stdout. Code 0 même quand aucun paragraphe n'est
# marqué ; la copie est alors identique à l'entrée.

import json
import re
import sys
import zipfile

# Nom du style Word -> classe du bloc du cockpit (lib/formatting-pur.js, CLASSES_BLOCS).
# Tenu en miroir dans szh-styles-corps.lua.
STYLES_BLOCS = {
    'SZH Important': 'important',
    'SZH Hervorhebung': 'highlight',
    'SZH Question (interview)': 'question',
}

# Livre seulement : la ligne d'auteur·e·s d'un chapitre, juste sous son titre — style Word
# hérité d'un gabarit antérieur à Modele-chapitre-SZH.docx (constaté sur
# redf_Lerngeschichten_clean.docx : styleId ET w:name valent bien « Auhors », coquille
# comprise — vérifié dans styles.xml, pas supposé). Liste COURTE de variantes plausibles ;
# une variante s'ajoute ici après CONSTAT sur un .docx réel, jamais par anticipation. Rendu
# identique au bloc auteurs d'un ouvrage collectif (szh-livre-auteurs.lua, `.szh-auteurs`) :
# même classe, styles/livre/falc.css n'a qu'un seul sélecteur pour les deux origines.
STYLES_AUTEURS_CHAPITRE = {
    'Auhors': 'szh-auteurs',
    'Authors': 'szh-auteurs',
    'Auteurs': 'szh-auteurs',
    'Autor·innen': 'szh-auteurs',
}

# Un seul dict à parcourir (voir ids_par_classe()). Les deux constantes restent séparées :
# pas le même métier — bloc du cockpit contre ligne de titre de chapitre — même si le
# marquage est rigoureusement le même mécanisme.
TOUS_LES_STYLES = {**STYLES_BLOCS, **STYLES_AUTEURS_CHAPITRE}

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
        if sid and nom and nom.group(1) in TOUS_LES_STYLES:
            ids[sid.group(1)] = TOUS_LES_STYLES[nom.group(1)]
    return ids


def marquer(document_xml, ids):
    """Insère un run marqueur juste après le <w:pPr> de chaque paragraphe visé.

    Le style en vigueur est celui du <w:pStyle> de premier niveau du <w:pPr>. Celui d'un
    <w:pPrChange> est l'ANCIEN style d'une modification suivie : l'import accepte les
    modifications, il ne compte donc pas — et son </w:pPr> interne n'est pas la fin du
    <w:pPr> qui nous intéresse."""
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
    try:  # console Windows en cp1252 : un accent combinant (nom venu du partage) y plante.
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) != 3:
        sys.exit('usage : docx-styles-corps.py <entree.docx> <sortie.docx>')
    principal(sys.argv[1], sys.argv[2])
