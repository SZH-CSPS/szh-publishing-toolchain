// La clé cachée des gabarits Pronto (propriété personnalisée « SZH-Gabarit ») : portée par
// les quatre gabarits livrés, elle prime sur les styles à l'import comme au nettoyeur, et le
// document que le nettoyeur écrit la garde.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPELINE = path.join(RACINE, 'pipeline');
const MARQUER = path.join(RACINE, 'outils-dev', 'marquer-gabarit.py');
const PRONTO_LIRE = path.join(PIPELINE, 'pronto-lire.py');
const HERITE = path.join(RACINE, 'livre-template', 'Modele-chapitre-SZH.docx');
const GABARITS = ['FR', 'DE'].flatMap((c) => ['.docx', '.odt'].map((ext) =>
  path.join(RACINE, 'revue-template', "Pronto - modele d'article_" + c + ext)));
const ENV = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });

function python(args) {
  const r = cp.spawnSync(PYTHON, args, { encoding: 'utf8', env: ENV });
  assert.ok(!r.error, String(r.error));
  return r;
}

// Valeur de la clé lue directement dans le zip, sans passer par le code de production.
const LIRE_CLE = [
  'import re, sys, zipfile',
  'z = zipfile.ZipFile(sys.argv[1])',
  'odt = sys.argv[1].lower().endswith(".odt")',
  'xml = z.read("meta.xml" if odt else "docProps/custom.xml").decode("utf-8") if (odt or "docProps/custom.xml" in z.namelist()) else ""',
  'm = re.search(r\'meta:name="SZH-Gabarit">([^<]*)<\' if odt else r\'name="SZH-Gabarit"><vt:lpwstr>([^<]*)<\', xml)',
  'print(m.group(1) if m else "")',
].join('\n');

function cle(chemin) {
  const r = python(['-c', LIRE_CLE, chemin]);
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function reconnu(chemin) {
  const r = python([PRONTO_LIRE, '--reconnaitre', chemin]);
  assert.ok(r.status === 0 || r.status === 10, r.stderr);  // 10 = pas au gabarit, le reste est une panne
  return r.status === 0;
}

const CAS_NETTOYEUR = [
  'import sys',
  'sys.path.insert(0, sys.argv[1])',
  'import manuscrit_docx as md, manuscrit_modele as mm',
  'print(mm.reconnaitre_gabarit(md.lire(sys.argv[2])))',
].join('\n');

function casNettoyeur(chemin) {
  const r = python(['-c', CAS_NETTOYEUR, PIPELINE, chemin]);
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.trim();
}

function jetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-cle-gabarit-'));
}

test('les quatre gabarits livrés portent la clé SZH-Gabarit', { skip: sansPython }, () => {
  for (const g of GABARITS) {
    assert.match(cle(g), /^pronto-article/, 'clé absente de ' + path.basename(g)
      + ' : rejouer outils-dev/marquer-gabarit.py sur ce gabarit');
  }
});

test('la clé seule suffit : un Word hérité marqué est reconnu à l’import et au nettoyeur', { skip: sansPython }, () => {
  const base = jetable();
  try {
    const marque = path.join(base, 'herite-marque.docx');
    fs.copyFileSync(HERITE, marque);
    assert.strictEqual(reconnu(marque), false, 'le Word hérité est déjà reconnu sans clé');
    assert.strictEqual(casNettoyeur(marque), 'B');
    const r = python([MARQUER, marque]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(cle(marque), 'pronto-article-4');
    assert.strictEqual(reconnu(marque), true, 'la clé n’est pas lue par pronto-lire.py --reconnaitre');
    assert.strictEqual(casNettoyeur(marque), 'A', 'la clé n’est pas lue par le nettoyeur');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('sans clé, les styles du gabarit restent le repli', { skip: sansPython }, () => {
  const base = jetable();
  try {
    const sansCle = path.join(base, 'gabarit-sans-cle.docx');
    const r = python(['-c', [
      'import sys, zipfile',
      'src, dst = sys.argv[1], sys.argv[2]',
      'with zipfile.ZipFile(src) as zi, zipfile.ZipFile(dst, "w") as zo:',
      '    for i in zi.infolist():',
      '        d = zi.read(i.filename)',
      '        if i.filename == "docProps/custom.xml":',
      '            d = d.decode("utf-8").replace("SZH-Gabarit", "Autre-Propriete").encode("utf-8")',
      '        zo.writestr(i, d)',
    ].join('\n'), GABARITS[0], sansCle]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(cle(sansCle), '');
    assert.strictEqual(reconnu(sansCle), true);
    assert.strictEqual(casNettoyeur(sansCle), 'A');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('le document écrit par le nettoyeur garde la clé du gabarit', { skip: sansPython }, () => {
  const base = jetable();
  try {
    const sortie = path.join(base, 'sortie.docx');
    const r = python(['-c', [
      'import json, sys',
      'sys.path.insert(0, sys.argv[1])',
      'import manuscrit_docx as md, manuscrit_gabarit as mg',
      'mg.ecrire(md.lire(sys.argv[2]), sys.argv[3], sys.argv[4], decisions=None)',
    ].join('\n'), PIPELINE, HERITE, GABARITS[0], sortie]);
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(cle(sortie), 'pronto-article-4');
    assert.strictEqual(reconnu(sortie), true);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
