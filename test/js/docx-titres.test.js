// pipeline/docx-titres.py : pré-pass d'import qui déduit les niveaux de titre d'un .docx
// dépourvu (ou à moitié dépourvu) de styles Word — utilisé par pipeline/import-docx.sh sur
// CHAQUE import réel, sans aucun test avant ce fichier (grep confirmé : aucune occurrence
// hors de lui-même et de pipeline/import-docx.sh, exclu de cette revue).
//
//   node --test "test/js/*.test.js"
//
// Trois fixtures .docx minimales, fabriquées ici (patron test/js/docx-meta-titre.test.js,
// fabriquerDocx) plutôt que figées en binaire — le style de chaque paragraphe se lit dans le
// test : styles de section absents (déduction complète, par paliers de taille de police),
// « à moitié » présents (déduction en complément, tout au niveau 2), complets (aucune
// déduction, même si des paragraphes ressemblent fortement à des titres).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const DOCX_TITRES = path.join(RACINE, 'pipeline', 'docx-titres.py');

function python(args) {
  return cp.spawnSync(PYTHON, args, { encoding: 'utf8' });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-docxtitres-'));
}

// Un .docx minimal : docx-titres.py ne lit que word/document.xml et word/styles.xml.
// `paragraphes` : [{ texte, style|null, gras|false, taille|null (demi-points) }].
function fabriquerDocx(chemin, paragraphes) {
  const programme = [
    'import json, sys, zipfile',
    'chemin, paras = sys.argv[1], json.loads(sys.argv[2])',
    'W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"',
    'def para_xml(p):',
    '    pStyle = (\'<w:pStyle w:val="%s"/>\' % p["style"]) if p.get("style") else ""',
    '    ppr = ("<w:pPr>%s</w:pPr>" % pStyle) if pStyle else ""',
    '    bits = ""',
    '    if p.get("gras"):',
    '        bits += "<w:b/>"',
    '    if p.get("taille"):',
    '        bits += \'<w:sz w:val="%d"/>\' % p["taille"]',
    '    rpr = ("<w:rPr>%s</w:rPr>" % bits) if bits else ""',
    '    return \'<w:p>%s<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r></w:p>\' % (ppr, rpr, p.get("texte", ""))',
    'corps = "".join(para_xml(p) for p in paras)',
    'doc = \'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="%s"><w:body>%s</w:body></w:document>\' % (W, corps)',
    'styles = \'<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="%s">\' % W',
    'for sid, nom in (("Heading1", "heading 1"), ("Heading2", "heading 2"), ("Normal", "Normal")):',
    '    styles += \'<w:style w:styleId="%s"><w:name w:val="%s"/></w:style>\' % (sid, nom)',
    'styles += "</w:styles>"',
    'with zipfile.ZipFile(chemin, "w") as z:',
    '    z.writestr("word/document.xml", doc.encode("utf-8"))',
    '    z.writestr("word/styles.xml", styles.encode("utf-8"))'
  ].join('\n');
  const r = python(['-c', programme, chemin, JSON.stringify(paragraphes)]);
  assert.strictEqual(r.status, 0, 'fabrication du .docx impossible : ' + r.stderr);
}

// Lance docx-titres.py sur un .docx fabriqué depuis `paragraphes`, rend le contenu du
// fichier de sortie (une ligne « N<TAB>texte » par titre déduit).
function deduire(paragraphes) {
  const base = dossierJetable();
  try {
    const docx = path.join(base, 'essai.docx');
    const sortie = path.join(base, 'sortie.txt');
    fabriquerDocx(docx, paragraphes);
    const r = python([DOCX_TITRES, docx, sortie]);
    assert.strictEqual(r.status, 0, 'docx-titres.py a échoué : ' + r.stderr);
    return fs.readFileSync(sortie, 'utf8');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test('docx-titres.py : styles de section absents, déduction complète par paliers de taille',
  { skip: sansPython }, () => {
    // Corps à 24 demi-points (dominant, deux paragraphes) ; un titre tout en gras sans
    // taille propre (retombe au palier du corps -> niveau 2) ; un titre à 36 demi-points,
    // nettement plus grand (>= 24 x 1.2) -> niveau 1.
    const sortie = deduire([
      { texte: 'Le corps du texte commence ici avec des mots simples.', taille: 24 },
      { texte: 'Introduction generale', gras: true },
      { texte: 'Grand titre de section', taille: 36 },
      { texte: 'Encore un peu de texte de corps sans rien de special.', taille: 24 }
    ]);
    assert.strictEqual(sortie, '2\tIntroduction generale\n1\tGrand titre de section\n');
  });

test('docx-titres.py : styles « à moitié » présents, déduction en complément, tout niveau 2',
  { skip: sansPython }, () => {
    // Un seul titre stylé (Heading1, <= MAX_STYLES_MIXTE) et trois candidats heuristiques
    // nets (>= MIN_CANDIDATS_MIXTE) : document jugé « à moitié stylé », les candidats
    // sortent TOUS en niveau 2, la hiérarchie restant à la charge des styles.
    const sortie = deduire([
      { texte: 'Titre style', style: 'Heading1' },
      { texte: 'Un sous-titre implicite un', gras: true },
      { texte: 'Un sous-titre implicite deux', gras: true },
      { texte: 'Un sous-titre implicite trois', gras: true }
    ]);
    assert.strictEqual(sortie,
      '2\tUn sous-titre implicite un\n2\tUn sous-titre implicite deux\n2\tUn sous-titre implicite trois\n');
  });

test('docx-titres.py : document déjà structuré -> aucune déduction, même si des paragraphes y ressemblent',
  { skip: sansPython }, () => {
    const sortie = deduire([
      { texte: 'Introduction', style: 'Heading1' },
      { texte: 'Sous-partie', style: 'Heading2' },
      { texte: 'Conclusion', style: 'Heading1' },
      { texte: 'Encore un candidat qui ne doit pas sortir', gras: true }
    ]);
    assert.strictEqual(sortie, '', 'une déduction est sortie malgré un document déjà structuré');
  });
