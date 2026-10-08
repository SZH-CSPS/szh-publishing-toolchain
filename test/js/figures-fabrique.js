// Fabrique des .docx d'essai pour les figures à plusieurs images, utilisée par
// test/js/manuscrit-figures.test.js (le nettoyeur) et test/js/import-figures.test.js
// (l'import). Ce n'est pas un test.
//
// Deux familles :
//   * « brut » : un manuscrit quelconque (styles Normal et heading 1), l'en-tête de figure
//     tapé à la main (« Légende : … », « Texte alternatif : … », « Copyright : … ») ;
//   * « pronto » : une copie du gabarit livré (revue-template), dont le premier bloc figure
//     reçoit les mêmes valeurs dans ses paragraphes « SZH Cle Abb/Tab ».
// Et trois contenus : (a) deux images dans un paragraphe, (b) deux paragraphes d'images,
// (c) un tableau 1×2 de mise en page. Les images sont de vrais PNG (400×300 et 300×400), avec
// une description Word (descr) chacune — ou sans, sur demande.
//
// Le programme Python est écrit au vol, plutôt qu'un binaire figé dans le dépôt.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { python, cheminPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
// Le gabarit existe en FR et en DE ; la fabrique prend le FR, car ses tests portent sur la
// reconnaissance des blocs figure et tableau, et non sur la langue des étiquettes.
const GABARIT = path.join(RACINE, 'revue-template', "Pronto - modele d'article_FR.docx");
const ENV_UTF8 = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

const FABRIQUE_PY = String.raw`
import json, os, struct, sys, zipfile, zlib

spec = json.loads(sys.argv[2])
sortie = sys.argv[1]

def png(l, h, rgb):
    brut = b''.join(b'\x00' + bytes(rgb) * l for _ in range(h))
    def bloc(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return (b'\x89PNG\r\n\x1a\n' + bloc(b'IHDR', struct.pack('>IIBBBBB', l, h, 8, 2, 0, 0, 0))
            + bloc(b'IDAT', zlib.compress(brut)) + bloc(b'IEND', b''))

IMAGES = {'A': ('photoA.png', png(400, 300, (200, 30, 30)), 2400000, 1800000),
          'B': ('photoB.png', png(300, 400, (30, 30, 200)), 1800000, 2400000),
          'C': ('photoC.png', png(300, 300, (30, 160, 30)), 1800000, 1800000)}

def esc(t):
    return t.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;').replace('"', '&quot;')

def dessin(cle, descr, did):
    nom, _, cx, cy = IMAGES[cle]
    d = (' descr="%s"' % esc(descr)) if descr else ''
    return ('<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">'
            '<wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="Photo %s"%s/>'
            '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
            '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">'
            '<pic:nvPicPr><pic:cNvPr id="%d" name="Photo %s"/><pic:cNvPicPr/></pic:nvPicPr>'
            '<pic:blipFill><a:blip r:embed="rId%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>'
            '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>'
            '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>'
            % (cx, cy, did, cle, d, did, cle, cle, cx, cy))

compteur = [9000]
def run(r):
    if 'img' in r:
        compteur[0] += 1
        return dessin(r['img'], r.get('descr', ''), compteur[0])
    return '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % esc(r['t'])

def para(b):
    ppr = '<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % b['style'] if b.get('style') else ''
    return '<w:p>%s%s</w:p>' % (ppr, ''.join(run(r) for r in b['p']))

def tableau(rangees):
    ncol = max(len(r) for r in rangees)
    w = 8000 // ncol
    xml = ('<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr><w:tblGrid>'
           + ''.join('<w:gridCol w:w="%d"/>' % w for _ in range(ncol)) + '</w:tblGrid>')
    for r in rangees:
        xml += '<w:tr>' + ''.join('<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr>%s</w:tc>'
                                  % (w, ''.join(bloc(b) for b in c) or '<w:p/>') for c in r) + '</w:tr>'
    return xml + '</w:tbl>'

def bloc(b):
    return tableau(b['tbl']) if 'tbl' in b else para(b)

def images_utilisees(blocs):
    vues = set()
    def voir(b):
        if 'tbl' in b:
            for r in b['tbl']:
                for c in r:
                    for x in c:
                        voir(x)
        else:
            for r in b.get('p', []):
                if 'img' in r:
                    vues.add(r['img'])
    for b in blocs:
        voir(b)
    return sorted(vues)

NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" '
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"')

if spec.get('gabarit'):
    # Le gabarit livré : son premier bloc figure (quatre « SZH Cle Abb/Tab » puis l'image
    # d'exemple) reçoit les valeurs et le contenu demandés — même découpe que le diagnostic.
    with zipfile.ZipFile(spec['gabarit']) as z:
        doc = z.read('word/document.xml').decode('utf-8')
    i_cle = doc.find('SZHCleAbbTab')
    debut_bloc = doc.rfind('<w:p ', 0, i_cle)
    i_dessin = doc.find('<w:drawing>')
    debut_img = doc.rfind('<w:p ', 0, i_dessin)
    fin_img = doc.find('</w:p>', i_dessin) + len('</w:p>')
    cles = doc[debut_bloc:debut_img]
    for etiquette, valeur in spec['valeurs']:
        # Le gabarit livré écrit « Légende : » à l'espace insécable depuis la passe
        # typographique ; une copie plus ancienne, à l'espace ordinaire. Les deux se remplissent.
        for sep in (' ', ' '):
            cible = etiquette + sep + ': </w:t>'
            if cible in cles:
                cles = cles.replace(cible, etiquette + sep + ': %s</w:t>' % esc(valeur), 1)
                break
        else:
            raise SystemExit('clé « %s » introuvable dans le gabarit' % etiquette)
    contenu = ''.join(bloc(b) for b in spec['contenu'])
    nouveau = doc[:debut_bloc] + cles + contenu + doc[fin_img:]
    utilisees = images_utilisees(spec['contenu'])
    with zipfile.ZipFile(spec['gabarit']) as zi, zipfile.ZipFile(sortie, 'w', zipfile.ZIP_DEFLATED) as zo:
        for item in zi.infolist():
            data = zi.read(item.filename)
            if item.filename == 'word/document.xml':
                data = nouveau.encode('utf-8')
            elif item.filename == 'word/_rels/document.xml.rels':
                s = data.decode('utf-8')
                s = s.replace('</Relationships>', ''.join(
                    '<Relationship Id="rId%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/%s"/>'
                    % (k, IMAGES[k][0]) for k in utilisees) + '</Relationships>')
                data = s.encode('utf-8')
            elif item.filename == '[Content_Types].xml':
                s = data.decode('utf-8')
                if 'Extension="png"' not in s:
                    s = s.replace('<Default ', '<Default Extension="png" ContentType="image/png"/><Default ', 1)
                data = s.encode('utf-8')
            zo.writestr(item, data)
        for k in utilisees:
            zo.writestr('word/media/' + IMAGES[k][0], IMAGES[k][1])
else:
    corps = ''.join(bloc(b) for b in spec['corps'])
    utilisees = images_utilisees(spec['corps'])
    doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document %s><w:body>%s'
           '<w:sectPr/></w:body></w:document>' % (NS, corps))
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles %s>'
              '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
              '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
              '</w:styles>' % NS)
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
          '<Default Extension="xml" ContentType="application/xml"/>'
          '<Default Extension="png" ContentType="image/png"/>'
          '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
          '</Types>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>')
    docrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
               '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
               '<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
               + ''.join('<Relationship Id="rId%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/%s"/>'
                         % (k, IMAGES[k][0]) for k in utilisees)
               + '</Relationships>')
    with zipfile.ZipFile(sortie, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', rels)
        z.writestr('word/_rels/document.xml.rels', docrels)
        z.writestr('word/document.xml', doc)
        z.writestr('word/styles.xml', styles)
        for k in utilisees:
            z.writestr('word/media/' + IMAGES[k][0], IMAGES[k][1])
`;

function ecrireFabrique(dossier) {
  const chemin = path.join(dossier, 'fabrique.py');
  if (!fs.existsSync(chemin)) { fs.writeFileSync(chemin, FABRIQUE_PY, 'utf8'); }
  return chemin;
}

function fabriquer(dossier, nom, spec) {
  const sortie = path.join(dossier, nom + '.docx');
  const specConvertie = Object.assign({}, spec);
  if (specConvertie.gabarit) { specConvertie.gabarit = cheminPython(specConvertie.gabarit); }
  const r = python([ecrireFabrique(dossier), sortie, JSON.stringify(specConvertie)],
    { encoding: 'utf8', env: ENV_UTF8 });
  if (r.status !== 0) { throw new Error('fabrication de ' + nom + ' impossible : ' + r.stderr); }
  return sortie;
}

// ---- Les briques des deux familles ------------------------------------------------------

const LEGENDE = 'Deux vues du bâtiment';
const ALT = 'À gauche la façade nord, à droite la façade sud';
const CREDIT = '© Jeanne Test';

const p = (texte, style) => ({ p: [{ t: texte }], style: style });
const img = (cle, descr) => ({ img: cle, descr: descr === undefined ? 'descr Word ' + cle : descr });

// Les trois contenus. `descrB` : la description Word de la seconde image
// (vide : l'image n'a pas de texte alternatif, et l'import doit le dire).
function contenu(cas, descrB) {
  const a = img('A');
  const b = img('B', descrB);
  if (cas === 'a') { return [{ p: [a, b] }]; }
  if (cas === 'b') { return [{ p: [a] }, { p: [b] }]; }
  return [{ tbl: [[[{ p: [a] }], [{ p: [b] }]]] }];
}

// Un manuscrit brut, avec (par défaut) une bibliographie et un corps assez long ; `court` :
// sans bibliographie ni seconde section, neuf paragraphes : la forme où le nettoyeur
// risquerait de supprimer tout le corps.
function manuscritBrut(cas, options) {
  const o = options || {};
  const corps = [
    p('Un titre d’article pour l’essai', 'Heading1'),
    p('Jeanne Test'),
    p('Introduction', 'Heading1'),
    p('Un paragraphe de corps avant la figure, assez long pour ne pas passer pour un titre de section.'),
  ];
  if (o.cles !== false) {
    corps.push(p('Légende : ' + LEGENDE), p('Texte alternatif : ' + ALT), p('Copyright : ' + CREDIT));
  }
  corps.push(...(o.contenu || contenu(cas, o.descrB)));
  corps.push(...(o.apres || []));   // ce qui suit IMMÉDIATEMENT le contenu (une note, par exemple)
  corps.push(p('Un paragraphe de corps après la figure, assez long lui aussi pour rester du corps.'));
  if (!o.court) {
    corps.push(p('Discussion', 'Heading1'),
      p('Encore un paragraphe de corps, pour que la fin du document ne ressemble pas à une '
        + 'notice d’autrice, avec des phrases complètes et une ponctuation ordinaire.'),
      p('Bibliographie', 'Heading1'),
      p('Dupont, J. (2020). Un ouvrage important. Éditions Test.'));
  }
  return { corps: corps };
}

// `options.contenu` remplace le contenu du bloc par des blocs donnés tels quels (un cas
// volontairement inattendu, par exemple une image au milieu d'une phrase).
function documentPronto(cas, options) {
  const o = options || {};
  return { gabarit: GABARIT,
    valeurs: [['Légende', LEGENDE], ['Texte alternatif', ALT], ['Copyright', CREDIT]],
    contenu: o.contenu || contenu(cas, o.descrB) };
}

function dossierJetable(prefixe) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefixe || 'szh-figures-'));
}

// Les enchaînements de la règle « 0, 1 ou 2 paragraphes vides entre deux images d'une même
// figure » : deux images séparées par `entre`, une liste de
// blocs — des vides, un texte, ou une nouvelle série de clés (`clesSecondes(style)`).
const vide = () => ({ p: [] });
function deuxImagesSeparees(entre) {
  return [{ p: [img('A')] }].concat(entre, [{ p: [img('B')] }]);
}
const LEGENDE_2 = 'Une seconde figure';
function clesSecondes(style) {
  return [{ p: [{ t: 'Légende : ' + LEGENDE_2 }], style: style },
    { p: [{ t: 'Copyright : © Autre' }], style: style }];
}

module.exports = { fabriquer, manuscritBrut, documentPronto, dossierJetable, GABARIT,
  LEGENDE, LEGENDE_2, ALT, CREDIT, ENV_UTF8, RACINE, p, vide, deuxImagesSeparees,
  clesSecondes };
