// lib/bienvenue-hote.js chargé seul, sans extension.js : l'invitation au tutoriel se pose une
// fois, et « Quoi de neuf » ouvre son panneau sans rien demander à l'hôte.
//
//   node --test test/js/bienvenue-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const Module = require('module');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

const vu = { infos: [], panneaux: [] };
function charger() {
  const orig = Module._load;
  const faux = {
    ViewColumn: { One: 1, Beside: -2 },
    workspace: { getConfiguration: () => ({ get: (c, d) => d }) },
    env: { language: 'fr' },
    commands: { executeCommand: () => Promise.resolve() },
    window: {
      showInformationMessage: (m) => { vu.infos.push(m); return Promise.resolve(undefined); },
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
  try { return require(path.join(COCKPIT, 'lib', 'bienvenue-hote.js')); }
  finally { Module._load = orig; }
}

function contexte() {
  const etat = new Map();
  return { globalState: { get: (c) => etat.get(c), update: (c, v) => { etat.set(c, v); return Promise.resolve(); } } };
}

test('bienvenue-hote seul : le tutoriel est proposé une fois, puis plus jamais', async () => {
  const m = charger();
  const ctx = contexte();
  vu.infos = [];
  await m.proposerTutoriel(ctx);
  await m.proposerTutoriel(ctx);
  assert.equal(vu.infos.length, 1, 'l’invitation doit partir une seule fois');
  assert.equal(ctx.globalState.get(m.CLE_TUTORIEL_VU), true);
});

test('bienvenue-hote seul : « Quoi de neuf » ouvre un seul panneau et répond à PRET', async () => {
  const m = charger();
  vu.panneaux = [];
  m.montrerNouveautes('1.0');
  m.montrerNouveautes('1.0');
  assert.equal(vu.panneaux.length, 1, 'la seconde ouverture a créé un second panneau');
  const p = vu.panneaux[0];
  assert.equal(p.viewType, 'szhNouveautes');
  const avant = p.postes.length;
  await p.recepteurs[0]({ type: MSG.PRET });
  assert.equal(p.postes.length, avant + 1, 'PRET n’a reçu aucune réponse');
  assert.equal(p.postes[avant].type, MSG.VALEURS);
});
