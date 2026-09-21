#!/usr/bin/env python3
# Lit pipeline/vale/lexique/lexique-fr.csv et lexique-de.csv (la SOURCE DE VÉRITÉ, éditable
# au tableur) et écrit, de façon idempotente (même entrée -> mêmes octets) :
#   - tmp/lexique/lexique-<langue>.xlsx   un classeur Office Open XML, stdlib seule
#   - tmp/lexique/lexique.tbx             TBX-Basic (ISO 30042), fr+de
#   - pipeline/vale/styles/{CSPS,SZH}/Lexique/Coherence.yml   règle de substitution générée
#   - pipeline/vale/styles/{CSPS,SZH}/Lexique/Sigle.yml       règle conditionnelle générée
#   - tmp/lexique/accept-<langue>.txt     vocabulaire accepté (voir LISEZMOI : ce fichier
#     n'est PAS dans la liste des fichiers autorisés sous pipeline/vale/styles/.../Lexique/
#     (glob *.yml uniquement) — il est donc généré en zone hors git, comme le xlsx et le
#     tbx, en attendant une décision sur son emplacement définitif.
#
# stdlib seule (zipfile + xml.etree pour le xlsx et le tbx, pas d'openpyxl/PyYAML).
import csv
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape as xml_escape

RACINE = Path(__file__).resolve().parents[2]
LEXIQUE_DIR = RACINE / 'pipeline' / 'vale' / 'lexique'
SORTIE_TMP = RACINE / 'tmp' / 'lexique'
STYLES_DIR = RACINE / 'pipeline' / 'vale' / 'styles'

COLONNES = ['terme', 'categorie', 'forme_privilegiee', 'variantes', 'frequence', 'documents',
            'sigle_developpement', 'statut', 'source_normative', 'exemple_1', 'exemple_2', 'note']

STATUT_TBX = {
    'privilegie': 'preferredTerm-admn-sts',
    'deconseille': 'deprecatedTerm-admn-sts',
    'neutre': 'admittedTerm-admn-sts',
    'a_trancher': 'admittedTerm-admn-sts',
}

ENTETE_YAML_GENERE = (
    "# généré par outils-dev/lexique/generer-lexique.py depuis pipeline/vale/lexique/"
    "lexique-{langue}.csv — NE PAS ÉDITER À LA MAIN, corriger le CSV puis régénérer.\n"
)


def lire_lexique(chemin):
    if not chemin.exists():
        return []
    with open(chemin, encoding='utf-8', newline='') as f:
        return list(csv.DictReader(f, delimiter=';'))


# ------------------------------------------------------------------------------------------
# XLSX — Office Open XML minimal écrit à la main (zipfile + XML), chaînes en ligne
# (inlineStr) pour éviter un fichier sharedStrings.xml séparé, comme le tolère le brief.

def _colonne_lettre(indice0):
    lettres = ''
    n = indice0 + 1
    while n > 0:
        n, r = divmod(n - 1, 26)
        lettres = chr(65 + r) + lettres
    return lettres


def _largeur_colonne(nom, lignes, indice):
    largeur = len(nom)
    for l in lignes:
        v = l[indice] if indice < len(l) else ''
        largeur = max(largeur, min(len(str(v)), 60))
    return min(max(largeur + 2, 10), 62)


CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.'
    'relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-'
    'officedocument.spreadsheetml.sheet.main+xml"/>'
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.'
    'openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-'
    'officedocument.spreadsheetml.styles+xml"/>'
    '</Types>'
)

RELS_RACINE = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
    'relationships/officeDocument" Target="xl/workbook.xml"/>'
    '</Relationships>'
)

RELS_WORKBOOK = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
    'relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/'
    'relationships/styles" Target="styles.xml"/>'
    '</Relationships>'
)

STYLES_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    '<fonts count="2">'
    '<font><sz val="11"/><name val="Calibri"/></font>'
    '<font><b/><sz val="11"/><name val="Calibri"/></font>'
    '</fonts>'
    '<fills count="2"><fill><patternFill patternType="none"/></fill>'
    '<fill><patternFill patternType="gray125"/></fill></fills>'
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    '<cellXfs count="2">'
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
    '</cellXfs>'
    '</styleSheet>'
)


def _workbook_xml(nom_feuille):
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="' + xml_escape(nom_feuille) + '" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>'
    )


def _cellule(ref, valeur, style=None):
    s = ' s="{}"'.format(style) if style is not None else ''
    if valeur is None or valeur == '':
        return '<c r="{}"{}/>'.format(ref, s)
    if isinstance(valeur, (int, float)) or (isinstance(valeur, str) and re.fullmatch(r'-?\d+', valeur)):
        return '<c r="{}"{}><v>{}</v></c>'.format(ref, s, valeur)
    return '<c r="{}"{} t="inlineStr"><is><t xml:space="preserve">{}</t></is></c>'.format(
        ref, s, xml_escape(str(valeur)))


def _sheet_xml(colonnes, lignes):
    n_lignes = len(lignes) + 1
    n_cols = len(colonnes)
    derniere_col = _colonne_lettre(n_cols - 1)
    cols_xml = '<cols>' + ''.join(
        '<col min="{i}" max="{i}" width="{w}" customWidth="1"/>'.format(
            i=i + 1, w=_largeur_colonne(colonnes[i], lignes, i))
        for i in range(n_cols)
    ) + '</cols>'
    rows = ['<row r="1">' + ''.join(
        _cellule(_colonne_lettre(i) + '1', colonnes[i], style=1) for i in range(n_cols)
    ) + '</row>']
    for r, ligne in enumerate(lignes, start=2):
        rows.append('<row r="{}">'.format(r) + ''.join(
            _cellule(_colonne_lettre(i) + str(r), ligne[i] if i < len(ligne) else '')
            for i in range(n_cols)
        ) + '</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + cols_xml
        + '<sheetData>' + ''.join(rows) + '</sheetData>'
        + '<autoFilter ref="A1:{}{}"/>'.format(derniere_col, n_lignes)
        + '</worksheet>'
    )


def ecrire_xlsx(chemin, colonnes, lignes, nom_feuille):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    parties = [
        ('[Content_Types].xml', CONTENT_TYPES),
        ('_rels/.rels', RELS_RACINE),
        ('xl/workbook.xml', _workbook_xml(nom_feuille)),
        ('xl/_rels/workbook.xml.rels', RELS_WORKBOOK),
        ('xl/styles.xml', STYLES_XML),
        ('xl/worksheets/sheet1.xml', _sheet_xml(colonnes, lignes)),
    ]
    with zipfile.ZipFile(chemin, 'w', zipfile.ZIP_DEFLATED) as z:
        for nom, contenu in parties:
            info = zipfile.ZipInfo(nom, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            z.writestr(info, contenu.encode('utf-8'))


# ------------------------------------------------------------------------------------------
# TBX-Basic (ISO 30042) — un termEntry par concept, langSet fr et/ou de.

NS_TBX = 'urn:iso:std:iso:30042:ed-2'


def _cle_appariement(row):
    if row.get('sigle_developpement'):
        return 'sigle:' + row['sigle_developpement'].strip().lower()
    return 'terme:' + row['terme'].strip().lower()


def construire_tbx(lignes_fr, lignes_de):
    dispo_de = list(lignes_de)
    entrees = []
    for r_fr in lignes_fr:
        cle = _cle_appariement(r_fr)
        jumeau = None
        for i, r_de in enumerate(dispo_de):
            if r_de is not None and _cle_appariement(r_de) == cle:
                jumeau = i
                break
        r_de = dispo_de[jumeau] if jumeau is not None else None
        if jumeau is not None:
            dispo_de[jumeau] = None
        entrees.append((r_fr, r_de))
    for r_de in dispo_de:
        if r_de is not None:
            entrees.append((None, r_de))

    tbx = ET.Element('tbx', {'style': 'dca', 'type': 'TBX-Basic', 'xmlns': NS_TBX})
    header = ET.SubElement(tbx, 'tbxHeader')
    fileDesc = ET.SubElement(header, 'fileDesc')
    sourceDesc = ET.SubElement(fileDesc, 'sourceDesc')
    p = ET.SubElement(sourceDesc, 'p')
    p.text = ('Lexique maison Revue suisse de pédagogie spécialisée / Schweizerische '
              'Zeitschrift für Heilpädagogik — généré depuis le corpus publié sur ojs.szh.ch')
    text_el = ET.SubElement(tbx, 'text')
    body = ET.SubElement(text_el, 'body')

    for idx, (r_fr, r_de) in enumerate(entrees, start=1):
        entry = ET.SubElement(body, 'termEntry', {'id': 'c{:04d}'.format(idx)})
        for lang, row in (('fr', r_fr), ('de', r_de)):
            if row is None:
                continue
            langset = ET.SubElement(entry, 'langSet', {'{http://www.w3.org/XML/1998/namespace}lang': lang})
            tig = ET.SubElement(langset, 'tig')
            term = ET.SubElement(tig, 'term')
            term.text = row['forme_privilegiee'] or row['terme']
            note = ET.SubElement(tig, 'termNote', {'type': 'administrativeStatus'})
            note.text = STATUT_TBX.get(row.get('statut', ''), 'admittedTerm-admn-sts')
        descrip = ET.SubElement(entry, 'descrip', {'type': 'definition'})
        descrip.text = ''
        note_libre = (r_fr or r_de).get('note', '')
        if note_libre:
            note_el = ET.SubElement(entry, 'note')
            note_el.text = note_libre
    return tbx


def ecrire_tbx(chemin, lignes_fr, lignes_de):
    chemin.parent.mkdir(parents=True, exist_ok=True)
    tbx = construire_tbx(lignes_fr, lignes_de)
    brut = ET.tostring(tbx, encoding='unicode')
    contenu = '<?xml version="1.0" encoding="UTF-8"?>\n' + brut + '\n'
    # vérifie que ce qu'on écrit est bien formé avant de l'écrire (le brief le demande
    # explicitement : validé par ET.fromstring).
    ET.fromstring(contenu)
    chemin.write_text(contenu, encoding='utf-8')


# ------------------------------------------------------------------------------------------
# Règles Vale générées : Coherence.yml (substitution, paires privilégiées uniquement) et
# Sigle.yml (conditional, un seul motif %s pour tous les sigles connus — voir la doc Vale
# de l'extension conditional : `second` peut réutiliser la capture de `first` via %s).

def _yaml_str(valeur):
    v = valeur.replace('\\', '\\\\').replace('"', '\\"')
    return '"' + v + '"'


def construire_coherence_yaml(lignes, langue):
    swap = []
    ecartes = []
    for row in lignes:
        if row.get('statut') != 'privilegie':
            continue
        variantes = [v.strip() for v in (row.get('variantes') or '').split('|') if v.strip()]
        for variante in variantes:
            motif = r'\b' + re.escape(variante) + r'\b'
            if re.match(r'^\\b\\[^\w]', motif) or not variante[0].isalnum() or not variante[-1].isalnum():
                ecartes.append(variante)
                continue
            swap.append((motif, row['forme_privilegiee'] or row['terme']))
    swap.sort(key=lambda kv: kv[0])
    lignes_yaml = [ENTETE_YAML_GENERE.format(langue=langue)]
    lignes_yaml.append(
        '# Variantes -> forme privilégiée, uniquement les paires dont le CSV porte le '
        'statut "privilegie" (la rédaction, ou une règle Vale existante, l\'a fondé).\n')
    lignes_yaml.append('extends: substitution\n')
    lignes_yaml.append('message: "%s est la forme privilégiée du lexique maison (au lieu de « %s »)."\n')
    lignes_yaml.append('level: suggestion\n')
    lignes_yaml.append('ignorecase: true\n')
    lignes_yaml.append('action:\n  name: replace\n')
    lignes_yaml.append('swap:\n')
    if not swap:
        lignes_yaml.append('  # aucune paire "privilegie" avec variantes dans le CSV actuel\n')
    for motif, cible in swap:
        lignes_yaml.append('  {}: {}\n'.format(_yaml_str(motif), _yaml_str(cible)))
    return ''.join(lignes_yaml), ecartes


def construire_sigle_yaml(lignes, langue):
    sigles = sorted({row['terme'] for row in lignes
                      if row.get('categorie') == 'sigle' and row.get('sigle_developpement')})
    lignes_yaml = [ENTETE_YAML_GENERE.format(langue=langue)]
    lignes_yaml.append(
        '# Un sigle de cette liste doit être développé au moins une fois dans le document\n'
        '# (motif générique "Mots (SIGLE)" avant ou après). Seuls les sigles dont le\n'
        '# développement a été retrouvé dans le corpus publié figurent ici — un sigle sans\n'
        '# développement connu n\'est pas de la responsabilité de cette règle (voir le\n'
        '# lexique, colonne note : "jamais développé dans le corpus").\n')
    lignes_yaml.append('extends: conditional\n')
    lignes_yaml.append('message: "Sigle « %s » : à développer au moins une fois dans l\'article."\n')
    lignes_yaml.append('level: suggestion\n')
    lignes_yaml.append('ignorecase: false\n')
    if sigles:
        lignes_yaml.append('first: \'\\b({})\\b\'\n'.format('|'.join(re.escape(s) for s in sigles)))
    else:
        lignes_yaml.append("first: '(?!x)x'  # aucun sigle avec développement connu dans le CSV actuel\n")
    lignes_yaml.append("second: '(?:[\\wÀ-ÿ]+[\\s-]+){1,6}\\(%s\\)'\n")
    return ''.join(lignes_yaml)


def construire_accept_txt(lignes):
    termes = set()
    for row in lignes:
        if row.get('terme'):
            termes.add(row['terme'].strip())
        if row.get('sigle_developpement'):
            termes.add(row['sigle_developpement'].strip())
    return '\n'.join(sorted(termes)) + '\n'


def main():
    import argparse
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--lexique-dir', default=str(LEXIQUE_DIR),
                     help='dossier des lexique-fr.csv/lexique-de.csv (test : un mini-CSV isolé)')
    ap.add_argument('--sortie', default=str(SORTIE_TMP), help='dossier des exports xlsx/tbx/accept.txt')
    ap.add_argument('--styles-dir', default=str(STYLES_DIR),
                     help='dossier pipeline/vale/styles (test : une copie isolée)')
    args = ap.parse_args()

    lexique_dir = Path(args.lexique_dir)
    sortie_tmp = Path(args.sortie)
    styles_dir = Path(args.styles_dir)

    lexique_dir.mkdir(parents=True, exist_ok=True)
    lignes_fr = lire_lexique(lexique_dir / 'lexique-fr.csv')
    lignes_de = lire_lexique(lexique_dir / 'lexique-de.csv')

    sortie_tmp.mkdir(parents=True, exist_ok=True)
    if lignes_fr:
        ecrire_xlsx(sortie_tmp / 'lexique-fr.xlsx', COLONNES,
                    [[r.get(c, '') for c in COLONNES] for r in lignes_fr], 'fr')
    if lignes_de:
        ecrire_xlsx(sortie_tmp / 'lexique-de.xlsx', COLONNES,
                    [[r.get(c, '') for c in COLONNES] for r in lignes_de], 'de')

    ecrire_tbx(sortie_tmp / 'lexique.tbx', lignes_fr, lignes_de)

    coherence_fr, ecartes_fr = construire_coherence_yaml(lignes_fr, 'fr')
    coherence_de, ecartes_de = construire_coherence_yaml(lignes_de, 'de')
    (styles_dir / 'CSPS' / 'Lexique').mkdir(parents=True, exist_ok=True)
    (styles_dir / 'SZH' / 'Lexique').mkdir(parents=True, exist_ok=True)
    (styles_dir / 'CSPS' / 'Lexique' / 'Coherence.yml').write_text(coherence_fr, encoding='utf-8', newline='\n')
    (styles_dir / 'SZH' / 'Lexique' / 'Coherence.yml').write_text(coherence_de, encoding='utf-8', newline='\n')
    (styles_dir / 'CSPS' / 'Lexique' / 'Sigle.yml').write_text(
        construire_sigle_yaml(lignes_fr, 'fr'), encoding='utf-8', newline='\n')
    (styles_dir / 'SZH' / 'Lexique' / 'Sigle.yml').write_text(
        construire_sigle_yaml(lignes_de, 'de'), encoding='utf-8', newline='\n')

    (sortie_tmp / 'accept-fr.txt').write_text(construire_accept_txt(lignes_fr), encoding='utf-8', newline='\n')
    (sortie_tmp / 'accept-de.txt').write_text(construire_accept_txt(lignes_de), encoding='utf-8', newline='\n')

    if ecartes_fr or ecartes_de:
        print('variantes écartées de Coherence.yml (premier/dernier caractère non alphanumérique, '
              'motif "\\b" inutilisable) :', file=sys.stderr)
        for v in ecartes_fr + ecartes_de:
            print('  ' + v, file=sys.stderr)


if __name__ == '__main__':
    main()
