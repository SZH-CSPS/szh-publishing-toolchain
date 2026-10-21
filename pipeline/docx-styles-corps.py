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
# cockpit. La même copie dégage aussi les titres posés en style de caractère (voir plus
# bas). Le reste du document est inchangé.
#
# Le style est reconnu par son nom (w:name), pas par son identifiant, que Word localise
# (« SZHQuestioninterview »).
#
# Sortie : une ligne JSON de statistiques sur stdout (blocs marqués, titres dégagés). Code 0
# même si rien n'est marqué.

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


# ---- Titres posés en style de caractère ---------------------------------------------
#
# Sélectionner la première ligne d'un paragraphe et cliquer sur « Überschrift 2 » ne pose
# pas le style de paragraphe : Word applique à la sélection le style de caractère lié
# (« Überschrift 2 Zchn »). La ligne a l'air d'un titre, suivie d'un saut de ligne manuel
# puis du texte, mais pandoc n'y voit qu'un paragraphe. La copie coupe ce paragraphe en
# deux : un paragraphe au style de titre, puis le reste avec les propriétés d'origine.
#
# Seulement si le paragraphe commence par ce texte, que tout le texte avant le premier
# saut de ligne (ou tout le paragraphe, s'il n'en a pas) porte le même style de caractère
# de titre, qu'il compte au plus MAX_MOTS_TITRE mots, ne finit pas par un deux-points et
# n'ouvre pas de guillemet sans le fermer. Un paragraphe qui porte déjà un
# style de titre, une modification suivie de ses propriétés, une zone de texte, un lien ou
# un champ avant le saut est laissé tel quel.

MAX_MOTS_TITRE = 15

# Éléments sans texte admis entre les runs du titre.
_NEUTRES = re.compile(r'<w:(?:bookmarkStart|bookmarkEnd|proofErr|permStart|permEnd)\b[^>]*/>')
# Contenu admis dans un run du titre ; le reste (image, champ, symbole) fait renoncer.
_CONTENU_RUN = re.compile(
    r'<w:t(?:\s[^>]*)?>[^<]*</w:t>|<w:t(?:\s[^>]*)?/>|<w:tab/>|<w:br\s*/>'
    r'|<w:br w:type="textWrapping"\s*/>|<w:lastRenderedPageBreak/>|<w:softHyphen/>'
    r'|<w:noBreakHyphen/>')
_RUN = re.compile(r'<w:r(?:\s[^>]*)?>(?:(<w:rPr>.*?</w:rPr>))?(.*?)</w:r>', re.S)
_SAUT = re.compile(r'<w:br\s*/>|<w:br w:type="textWrapping"\s*/>')


def titres_par_style_caractere(styles_xml):
    """{id du style de caractère: id du style de titre lié} pour « heading N » (nom que
    Word écrit en anglais dans styles.xml, quelle que soit la langue de l'interface)."""
    titres, liens = set(), {}
    for m in re.finditer(r'<w:style\b[^>]*>.*?</w:style>', styles_xml, re.S):
        bloc = m.group()
        entete = bloc[:bloc.find('>')]
        sid = re.search(r'w:styleId="([^"]+)"', entete)
        nom = re.search(r'<w:name w:val="([^"]+)"', bloc)
        lien = re.search(r'<w:link w:val="([^"]+)"', bloc)
        if not sid:
            continue
        if 'w:type="paragraph"' in entete and nom and re.match(r'(?i)heading\s*[1-6]$', nom.group(1)):
            titres.add(sid.group(1))
        elif 'w:type="character"' in entete and lien:
            liens[sid.group(1)] = lien.group(1)
    return {c: p for c, p in liens.items() if p in titres}


def _texte_run(contenu):
    return ''.join(re.findall(r'<w:t(?:\s[^>]*)?>([^<]*)</w:t>', contenu))


def _scinder_paragraphe(xml_p, liens):
    """Le paragraphe coupé en titre + reste, ou None s'il ne s'y prête pas."""
    m = re.match(r'(<w:p(?:\s[^>]*)?>)(<w:pPr>.*?</w:pPr>)?(.*)</w:p>$', xml_p, re.S)
    if not m or 'txbxContent' in xml_p:
        return None
    ouvre, ppr, reste = m.group(1), m.group(2) or '', m.group(3)
    if '<w:pPrChange' in ppr:
        return None
    pstyle = re.search(r'<w:pStyle w:val="([^"]+)"', ppr)
    if pstyle and pstyle.group(1) in liens.values():
        return None
    style_titre, texte, pos, titre_xml = None, '', 0, []
    while pos < len(reste):
        neutre = _NEUTRES.match(reste, pos)
        if neutre:
            titre_xml.append(neutre.group())
            pos = neutre.end()
            continue
        run = _RUN.match(reste, pos)
        if not run:
            return None
        rpr, contenu = run.group(1) or '', run.group(2)
        if _CONTENU_RUN.sub('', contenu).strip():
            return None
        saut = _SAUT.search(contenu)
        avant = contenu[:saut.start()] if saut else contenu
        if _texte_run(avant).strip():
            rstyle = re.search(r'<w:rStyle w:val="([^"]+)"', rpr)
            cible = liens.get(rstyle.group(1)) if rstyle else None
            if not cible or (style_titre and cible != style_titre):
                return None
            style_titre = cible
            texte += _texte_run(avant)
        if saut:
            titre_xml.append('<w:r>%s%s</w:r>' % (rpr, avant))
            apres = contenu[saut.end():]
            suite = ('<w:r>%s%s</w:r>' % (rpr, apres) if apres else '') + reste[run.end():]
            break
        titre_xml.append(run.group())
        pos = run.end()
    else:
        suite = ''
    texte = texte.strip()
    if not style_titre or len(texte.split()) > MAX_MOTS_TITRE:
        return None
    # « Dieses Buch heisst «Lebensgeschichten: » : une phrase qui se poursuit à la ligne.
    if texte.endswith(':') or texte.count('«') != texte.count('»'):
        return None
    ouvre_titre = re.sub(r'\s(?:w14:paraId|w14:textId)="[^"]*"', '', ouvre)
    titre = '%s<w:pPr><w:pStyle w:val="%s"/></w:pPr>%s</w:p>' % (
        ouvre_titre, style_titre, ''.join(titre_xml))
    if not _texte_run(suite).strip():
        return titre
    return titre + '%s%s%s</w:p>' % (ouvre, ppr, suite)


def scinder_titres(document_xml, liens):
    """Coupe les paragraphes dont la première ligne est un titre en style de caractère.
    Rend le document et le nombre de titres dégagés. Sans titre à dégager, le document
    sort identique à l'octet."""
    if not liens:
        return document_xml, 0
    morceaux, pos, compte = [], 0, 0
    for m in re.finditer(r'<w:p(?:\s[^>]*)?>.*?</w:p>', document_xml, re.S):
        coupe = _scinder_paragraphe(m.group(), liens)
        if coupe is None:
            continue
        morceaux.append(document_xml[pos:m.start()])
        morceaux.append(coupe)
        pos = m.end()
        compte += 1
    if not compte:
        return document_xml, 0
    morceaux.append(document_xml[pos:])
    return ''.join(morceaux), compte


def principal(entree, sortie):
    with zipfile.ZipFile(entree) as zi:
        noms = zi.namelist()
        styles = zi.read('word/styles.xml').decode('utf-8') if 'word/styles.xml' in noms else ''
        ids = ids_par_classe(styles)
        doc, titres = scinder_titres(zi.read('word/document.xml').decode('utf-8'),
                                     titres_par_style_caractere(styles))
        doc, compte = marquer(doc, ids)
        with zipfile.ZipFile(sortie, 'w', zipfile.ZIP_DEFLATED) as zo:
            for info in zi.infolist():
                data = doc.encode('utf-8') if info.filename == 'word/document.xml' \
                    else zi.read(info.filename)
                zo.writestr(info, data)
    print(json.dumps({'blocs': compte, 'titres': titres}, ensure_ascii=False))


if __name__ == '__main__':
    try:  # console Windows en cp1252 : un accent combinant y ferait planter print().
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass
    if len(sys.argv) != 3:
        sys.exit('usage : docx-styles-corps.py <entree.docx> <sortie.docx>')
    principal(sys.argv[1], sys.argv[2])
