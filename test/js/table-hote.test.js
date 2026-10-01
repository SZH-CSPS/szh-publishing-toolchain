// Le module de l'éditeur de tableau, configuré seul, sans extension.js : ses fonctions pures
// et ses rappels répondent sans l'hôte.
//
//   node --test "test/js/table-hote.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Le module demande « vscode », que ce banc n'a pas : une doublure minimale suffit, rien de
// ce qui est éprouvé ici ne touche à l'interface.
function charger() {
  const Module = require('module');
  const orig = Module._load;
  const rien = { dispose() {} };
  const faux = {
    EventEmitter: class { constructor() { this.event = () => rien; } fire() {} dispose() {} },
    Uri: { file: (p) => ({ fsPath: p }) },
    window: { showWarningMessage: () => Promise.resolve(undefined), setStatusBarMessage: () => {} },
    workspace: { getConfiguration: () => ({ get: () => '' }) },
    env: { language: 'fr' },
    commands: { executeCommand: () => Promise.resolve() }
  };
  Module._load = function (r, pp, i) { return r === 'vscode' ? faux : orig(r, pp, i); };
  try { return require(path.join(COCKPIT, 'lib', 'table-hote.js')); } finally { Module._load = orig; }
}

test('table-hote : les teintes se lisent dans out/.szh-accent.css, grises à défaut', () => {
  const m = charger();
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-table-hote-'));
  assert.deepStrictEqual(m.lireTeintesAccent(racine), { clair: null, fonce: null, filet: null });
  fs.mkdirSync(path.join(racine, 'out'));
  fs.writeFileSync(path.join(racine, 'out', '.szh-accent.css'),
    ':root { --szh-accent-clair: #AABBCC; --szh-accent-fonce: #112233; --c-annual-ui: #445566; }');
  assert.deepStrictEqual(m.lireTeintesAccent(racine),
    { clair: '#AABBCC', fonce: '#112233', filet: '#445566' });
});

test('table-hote : un constat sur un article inconnu ne vise aucun tableau', async () => {
  const m = charger();
  const fournisseur = { racine: os.tmpdir(), listerArticles: () => ['01-essai'], _tablesArticle: () => [] };
  assert.strictEqual(await m.tableDuConstat(fournisseur, { slug: 'autre', focus: '' }), null);
  assert.strictEqual(await m.tableDuConstat(fournisseur, null), null);
});

test('table-hote : fermer les panneaux d’un numéro sans panneau ouvert ne lève pas', () => {
  const m = charger();
  assert.strictEqual(m.panneauTableOuvert('x.html'), undefined);
  m.fermerPanneauxTableDe(os.tmpdir(), '01-essai');
});

test('table-hote : un seul tableau dans l’article s’ouvre directement', async () => {
  const m = charger();
  const fournisseur = {
    racine: os.tmpdir(), listerArticles: () => ['01-essai'], _tablesArticle: () => ['table-01.html']
  };
  const res = await m.tableDuConstat(fournisseur, { slug: '01-essai', focus: '' });
  assert.strictEqual(path.basename(res.cheminAsset), 'table-01.html');
  assert.strictEqual(res.slug, '01-essai');
});
