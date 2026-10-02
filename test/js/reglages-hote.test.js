// lib/reglages-hote.js configuré seul, sans extension.js : le module ne dépend pas de l'hôte.
// modifierConfigPoste ne doit jamais écraser un config.json qu'on n'a pas su lire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-reglages-hote-'));
const chemin = path.join(dossier, 'config.json');
process.env.SZH_CONFIG_OJS = chemin;

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Le module demande « vscode », que ce banc n'a pas : une doublure minimale suffit.
function charger() {
  const Module = require('module');
  const orig = Module._load;
  const faux = {
    Uri: { file: (p) => ({ fsPath: p }) },
    window: {},
    workspace: { getConfiguration: () => ({ get: (cle, defaut) => defaut }) },
    env: { language: 'fr' }
  };
  Module._load = function (r, pp, i) { return r === 'vscode' ? faux : orig(r, pp, i); };
  try { return require(path.join(COCKPIT, 'lib', 'reglages-hote.js')); } finally { Module._load = orig; }
}
const reglages = charger();

test.after(() => { fs.rmSync(dossier, { recursive: true, force: true }); });

test('config illisible : rien n’est écrit, le chemin du fichier est rendu', () => {
  fs.writeFileSync(chemin, '{ pas du json');
  let appele = false;
  const erreur = reglages.modifierConfigPoste((avant) => { appele = true; return Object.assign({}, avant, { x: 1 }); });
  assert.strictEqual(erreur, chemin);
  assert.strictEqual(appele, false, 'la fonction ne doit pas être appelée sur un fichier illisible');
  assert.strictEqual(fs.readFileSync(chemin, 'utf8'), '{ pas du json');
});

test('config absente : elle est créée', () => {
  fs.rmSync(chemin, { force: true });
  const erreur = reglages.modifierConfigPoste((avant) => Object.assign({}, avant, { langue: 'de' }));
  assert.strictEqual(erreur, null);
  assert.strictEqual(JSON.parse(fs.readFileSync(chemin, 'utf8')).langue, 'de');
});

test('config lisible : les clés voisines sont gardées', () => {
  fs.writeFileSync(chemin, JSON.stringify({ emplacementRevues: 'production' }));
  assert.strictEqual(reglages.modifierConfigPoste((avant) => Object.assign({}, avant, { langue: 'fr' })), null);
  const cfg = JSON.parse(fs.readFileSync(chemin, 'utf8'));
  assert.strictEqual(cfg.emplacementRevues, 'production');
  assert.strictEqual(cfg.langue, 'fr');
});

test('module seul : un rappel configuré est bien employé', () => {
  reglages.configurer({ replierAssetsAutres: () => false, convertirCmykActif: () => false });
  assert.strictEqual(reglages.lireReglagesActuels().assets, 'non');
  assert.strictEqual(reglages.lireReglagesActuels().cmyk, 'non');
});

// Les titres de commandes du fichier de langue viennent des package.nls*.json de
// l'extension, à sa racine : une table vide les aurait laissés hors de la relecture.
test('fichier de langue : les titres de commandes sont lus, en fr et en de', () => {
  const t = reglages.nlsCommandes();
  assert.ok(Object.keys(t.fr).length > 10, 'aucun titre fr lu');
  assert.ok(Object.keys(t.de).length > 10, 'aucun titre de lu');
});
