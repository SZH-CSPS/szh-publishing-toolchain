// Le nettoyeur applique la typographie maison PARTOUT où il réécrit du texte, pas seulement
// au corps (audit du 30.09.2026) :
//   D5  les notes de bas de page passent par le pont typographique (Document.notes vivait à
//       part et restait brut : 23 apostrophes droites sur 23 dans les notes d'un manuscrit
//       réel, contre 1 sur 75 au corps) ;
//   D6  les champs de l'en-tête (titre, sous-titre, résumé, mots-clés, fonction, institution)
//       sont normalisés par le même pont avant d'être écrits dans les tableaux du gabarit ;
//   D7  un intertitre part au filtre en Header : il y reçoit les règles de TITRE (A4, L2),
//       et ne lève plus C3 comme s'il était du corps.
//
//   node --test "test/js/*.test.js"
//
// Un vrai .docx (Title, auteur, intertitre, corps, note de bas de page) passe par la CLI
// réelle ; le pont joint pandoc par la WSL (sansPandocWsl), comme en production.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const NETTOYEUR = path.join(RACINE, 'pipeline', 'manuscrit-nettoyer.py');
const NB = ' ';

const FABRICANT_PY = String.raw`# -*- coding: utf-8 -*-
import json, sys, zipfile
from xml.sax.saxutils import escape
spec = json.load(open(sys.argv[1], encoding='utf-8'))
W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
def run(t):
    return '<w:r><w:t xml:space="preserve">%s</w:t></w:r>' % escape(t)
def para(style, t, note=False):
    ppr = '<w:pPr><w:pStyle w:val="%s"/></w:pPr>' % style if style else ''
    appel = ('<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr>'
             '<w:footnoteReference w:id="1"/></w:r>') if note else ''
    return '<w:p>%s%s%s</w:p>' % (ppr, run(t), appel)
corps = ''.join(para(s, t, n) for s, t, n in spec['paragraphes'])
doc = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="%s">'
       '<w:body>%s<w:sectPr/></w:body></w:document>' % (W, corps))
fn = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes xmlns:w="%s">'
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
      '<w:footnote w:id="1"><w:p><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>%s</w:p></w:footnote>'
      '</w:footnotes>' % (W, run(' ' + spec['note'])))
styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="%s">'
          '<w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="%s"/></w:rPr></w:rPrDefault></w:docDefaults>'
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'
          '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style>'
          '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>'
          '<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/></w:style>'
          '</w:styles>' % (W, spec['langue']))
CT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>'
      '</Types>')
RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>')
DOCRELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
           '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
           '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>'
           '</Relationships>')
with zipfile.ZipFile(spec['sortie'], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', CT)
    z.writestr('_rels/.rels', RELS)
    z.writestr('word/_rels/document.xml.rels', DOCRELS)
    z.writestr('word/styles.xml', styles)
    z.writestr('word/document.xml', doc)
    z.writestr('word/footnotes.xml', fn)
`;

// Texte (w:t concaténés, entités décodées) de chaque paragraphe d'une partie du .docx.
const LIRE_PY = String.raw`import json, re, sys, zipfile
from xml.sax.saxutils import unescape
z = zipfile.ZipFile(sys.argv[1])
sortie = {}
for partie in ('word/document.xml', 'word/footnotes.xml'):
    x = z.read(partie).decode('utf-8') if partie in z.namelist() else ''
    sortie[partie] = [unescape(''.join(re.findall(r'<w:t(?: [^>]*)?>([^<]*)</w:t>', p)), {'&quot;': '"', '&apos;': "'"})
                      for p in re.findall(r'<w:p[ >].*?</w:p>', x, re.S)]
print(json.dumps(sortie, ensure_ascii=False))
`;

function python(args) {
  return cp.spawnSync(PYTHON, args, {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' })
  });
}

function nettoyerFabrique(spec, produit) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-typo-champs-'));
  try {
    const fab = path.join(base, 'fab.py');
    fs.writeFileSync(fab, FABRICANT_PY, 'utf8');
    const docx = path.join(base, 'manuscrit.docx');
    fs.writeFileSync(path.join(base, 'spec.json'), JSON.stringify(Object.assign({ sortie: docx }, spec)), 'utf8');
    let r = python([fab, path.join(base, 'spec.json')]);
    assert.strictEqual(r.status, 0, 'fabrication impossible : ' + r.stderr);
    const sortie = path.join(base, 'sortie');
    r = python([NETTOYEUR, docx, '--produit', produit, '--sortie', sortie, '--sans-reseau',
      '--sans-annotation']);
    assert.ok(r.status === 0 || r.status === 1, 'nettoyeur en échec (' + r.status + ') : ' + r.stderr);
    const ligne = JSON.parse(String(r.stdout).trim().split(/\r?\n/).pop());
    assert.strictEqual(ligne.typographie, 'appliquee', 'typographie non appliquée : ' + r.stderr);
    const lire = path.join(base, 'lire.py');
    fs.writeFileSync(lire, LIRE_PY, 'utf8');
    const l = python([lire, ligne.sortie_docx]);
    assert.strictEqual(l.status, 0, l.stderr);
    return JSON.parse(l.stdout);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const SPEC_FR = {
  langue: 'fr-CH',
  paragraphes: [
    ['Title', "L'école inclusive – et après ?", false],
    ['Normal', 'Jean-Éric Dupont', false],
    ['Heading1', 'Ecole et Etat : le cadre', false],
    ['Normal', 'Un premier paragraphe de corps, assez long pour être du corps ordinaire.', true],
    ['Normal', 'Un second paragraphe de corps, lui aussi tout à fait ordinaire et sans histoire.', false]
  ],
  note: 'Note : voir « ici », pp. 12–14.'
};

const SPEC_DE = {
  langue: 'de-CH',
  paragraphes: [
    ['Title', 'Die Schule – und dann ?', false],
    ['Normal', 'Anna Müller', false],
    ['Heading1', 'Einleitung', false],
    ['Normal', 'Ein erster Absatz im Fliesstext, lang genug für gewöhnlichen Fliesstext.', true],
    ['Normal', 'Ein zweiter Absatz im Fliesstext, ebenfalls ganz gewöhnlich und ohne Besonderheit.', false]
  ],
  note: 'Anmerkung : siehe „hier“, S. 12-14.'
};

test('nettoyeur (D5) : la note de bas de page reçoit la typographie de sa langue',
  { skip: sansPython || sansPandocWsl }, () => {
    const fr = nettoyerFabrique(SPEC_FR, 'revue');
    const noteFr = fr['word/footnotes.xml'].join('\n');
    assert.ok(noteFr.includes('Note' + NB + ': voir «' + NB + 'ici' + NB + '», pp.' + NB + '12-14.'),
      'note française non normalisée : ' + JSON.stringify(noteFr));
    const de = nettoyerFabrique(SPEC_DE, 'zeitschrift');
    const noteDe = de['word/footnotes.xml'].join('\n');
    assert.ok(noteDe.includes('Anmerkung: siehe «hier», S.' + NB + '12–14.'),
      'note allemande non normalisée : ' + JSON.stringify(noteDe));
  });

test('nettoyeur (D6) : le titre écrit dans le tableau du gabarit est normalisé',
  { skip: sansPython || sansPandocWsl }, () => {
    const fr = nettoyerFabrique(SPEC_FR, 'revue');
    assert.ok(fr['word/document.xml'].includes('L’école inclusive' + NB + '– et' + NB + 'après' + NB + '?'),
      'titre français brut : ' + JSON.stringify(fr['word/document.xml'].slice(0, 12)));
    const de = nettoyerFabrique(SPEC_DE, 'zeitschrift');
    // L2 soude l'article à son nom dans un titre : « Die » + U+00A0 + « Schule ».
    assert.ok(de['word/document.xml'].some((t) => /^Die[  ]Schule/.test(t) && t.endsWith('dann?')),
      'titre allemand brut : ' + JSON.stringify(de['word/document.xml'].slice(0, 12)));
  });

test('nettoyeur (D7) : un intertitre reçoit les règles de titre (majuscules accentuées)',
  { skip: sansPython || sansPandocWsl }, () => {
    const fr = nettoyerFabrique(SPEC_FR, 'revue');
    const titre = fr['word/document.xml'].find((t) => /cole et/.test(t)) || '';
    assert.ok(titre.startsWith('École et') && titre.includes('État' + NB + ':'),
      'intertitre sans les règles de titre : ' + JSON.stringify(titre));
  });
