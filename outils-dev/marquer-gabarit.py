#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# marquer-gabarit.py — pose la clé cachée du gabarit Pronto (propriété personnalisée
# « SZH-Gabarit ») dans un .docx ou un .odt, à rejouer sur tout nouveau gabarit reçu.
#
#   python3 outils-dev/marquer-gabarit.py "revue-template/Pronto - modele d'article_FR.docx" ...
#
# Le fichier est réécrit en place, toutes les autres parties du zip sont recopiées à l'octet.
# Une clé déjà présente est remplacée.

import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pipeline'))
import pronto_modele as pm

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

FMTID = '{D5CDD505-2E9C-101B-9397-08002B2CF9AE}'
CT_CUSTOM = 'application/vnd.openxmlformats-officedocument.custom-properties+xml'
REL_CUSTOM = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties'
CUSTOM_VIDE = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n'
               '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"'
               ' xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>')


def _sans_cle_docx(xml):
    motif = r'<property [^>]*name="%s"[^>]*>.*?</property>' % re.escape(pm.CLE_GABARIT_NOM)
    return re.sub(motif, '', xml, flags=re.S)


def marquer_docx(contenus):
    xml = contenus.get('docProps/custom.xml')
    if xml is None:
        xml = CUSTOM_VIDE
        ct = contenus['[Content_Types].xml']
        contenus['[Content_Types].xml'] = ct.replace(
            '</Types>', '<Override PartName="/docProps/custom.xml" ContentType="%s"/></Types>' % CT_CUSTOM)
        rels = contenus['_rels/.rels']
        ids = [int(n) for n in re.findall(r'Id="rId(\d+)"', rels)] or [0]
        contenus['_rels/.rels'] = rels.replace(
            '</Relationships>', '<Relationship Id="rId%d" Type="%s" Target="docProps/custom.xml"/>'
            '</Relationships>' % (max(ids) + 1, REL_CUSTOM))
    xml = _sans_cle_docx(xml)
    pids = [int(n) for n in re.findall(r'pid="(\d+)"', xml)] or [1]
    propriete = ('<property fmtid="%s" pid="%d" name="%s"><vt:lpwstr>%s</vt:lpwstr></property>'
                 % (FMTID, max(pids) + 1, pm.CLE_GABARIT_NOM, pm.CLE_GABARIT_VALEUR))
    contenus['docProps/custom.xml'] = xml.replace('</Properties>', propriete + '</Properties>')


def marquer_odt(contenus):
    xml = contenus['meta.xml']
    motif = r'<meta:user-defined meta:name="%s"[^>]*>.*?</meta:user-defined>' % re.escape(pm.CLE_GABARIT_NOM)
    xml = re.sub(motif, '', xml, flags=re.S)
    propriete = '<meta:user-defined meta:name="%s">%s</meta:user-defined>' % (
        pm.CLE_GABARIT_NOM, pm.CLE_GABARIT_VALEUR)
    contenus['meta.xml'] = xml.replace('</office:meta>', propriete + '</office:meta>')


def marquer(chemin):
    with zipfile.ZipFile(chemin) as z:
        infos = z.infolist()
        brut = {i.filename: z.read(i.filename) for i in infos}
    odt = chemin.lower().endswith('.odt')
    noms = ('meta.xml',) if odt else ('docProps/custom.xml', '[Content_Types].xml', '_rels/.rels')
    contenus = {n: brut[n].decode('utf-8') for n in noms if n in brut}
    (marquer_odt if odt else marquer_docx)(contenus)
    temporaire = chemin + '.marquage'
    with zipfile.ZipFile(temporaire, 'w') as sortie:
        for info in infos:
            donnees = contenus[info.filename].encode('utf-8') if info.filename in contenus else brut[info.filename]
            sortie.writestr(info, donnees)
        for nom in contenus:
            if nom not in brut:
                sortie.writestr(zipfile.ZipInfo(nom, date_time=infos[0].date_time),
                                contenus[nom].encode('utf-8'), compress_type=zipfile.ZIP_DEFLATED)
    os.replace(temporaire, chemin)


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('usage : marquer-gabarit.py <gabarit.docx|.odt> ...')
    for c in sys.argv[1:]:
        marquer(c)
        print('marqué : %s' % c)
