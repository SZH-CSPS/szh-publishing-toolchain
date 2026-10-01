// lib/import-verif-hote.js chargé seul, sans extension.js : le dialogue s'ouvre une seule
// fois, et le remplacement d'une image passe par le rappel de l'hôte.
//
//   node --test test/js/import-verif-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const Module = require('module');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

const vu = { panneaux: [] };
function charger() {
  const orig = Module._load;
  const faux = {
    ViewColumn: { One: 1, Beside: -2 },
    EventEmitter: class { constructor() { this.event = () => {}; } fire() {} },
    workspace: { getConfiguration: () => ({ get: (c, d) => d }) },
    env: { language: 'fr' },
    commands: { executeCommand: () => Promise.resolve() },
    window: {
      tabGroups: { all: [] },
      setStatusBarMessage: () => {},
      createWebviewPanel: (type) => {
        const p = {
          viewType: type, recepteurs: [], postes: [],
          webview: {
            html: '',
            onDidReceiveMessage: (f) => { p.recepteurs.push(f); },
            postMessage: (m) => { p.postes.push(m); return Promise.resolve(true); }
          },
          onDidDispose: () => {}, reveal: () => {}, dispose: () => {}
        };
        vu.panneaux.push(p);
        return p;
      }
    }
  };
  Module._load = function (r, p, i) { return r === 'vscode' ? faux : orig(r, p, i); };
  try { return require(path.join(COCKPIT, 'lib', 'import-verif-hote.js')); }
  finally { Module._load = orig; }
}

test('import-verif-hote seul : un remplacement annulé est dit au panneau, par le rappel', async () => {
  const m = charger();
  const appels = [];
  m.configurer({ remplacerFichierImage: async (f, r, slug, relatif) => { appels.push([slug, relatif]); return { etat: 'annule' }; } });
  const panneau = { webview: { postMessage: (msg) => { panneau.postes.push(msg); } }, postes: [] };
  await m.remplacerImageImport({ racine: os.tmpdir() }, null, panneau, { slug: '01-a', relatif: 'fig.png' });
  assert.deepEqual(appels, [['01-a', 'fig.png']]);
  assert.deepEqual(panneau.postes, [{ type: MSG.IMAGE_ANNULEE, slug: '01-a', relatif: 'fig.png' }]);
});

test('import-verif-hote seul : sans nouvel article, aucun dialogue ; avec, un seul panneau', async () => {
  const m = charger();
  const fournisseur = { racine: os.tmpdir(), listerArticles: () => [] };
  await m.ouvrirImportVerif(fournisseur, null, []);
  assert.equal(vu.panneaux.length, 0, 'un import sans nouvel article ouvre le dialogue');
  await m.ouvrirImportVerif(fournisseur, null, ['01-a']);
  assert.equal(vu.panneaux.length, 1);
  assert.equal(vu.panneaux[0].viewType, 'szhImportVerif');
});
