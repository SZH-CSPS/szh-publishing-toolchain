// lib/controles-hote.js configuré seul, sans extension.js : le module ne dépend pas de l'hôte.
// Les constats y sont rangés par source : en poser pour l'une ne doit jamais effacer ceux
// d'une autre, et le voile « Analyse en cours… » se lève quand la tâche est finie.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Le module demande « vscode », que ce banc n'a pas : une doublure minimale suffit.
function charger() {
  const Module = require('module');
  const orig = Module._load;
  const faux = {
    Uri: { file: (p) => ({ fsPath: p }) },
    window: {},
    commands: { executeCommand: async () => {} },
    workspace: { getConfiguration: () => ({ get: (cle, defaut) => defaut }) },
    env: { language: 'fr' },
    ThemeColor: function ThemeColor(id) { this.id = id; }
  };
  Module._load = function (r, pp, i) { return r === 'vscode' ? faux : orig(r, pp, i); };
  try { return require(path.join(COCKPIT, 'lib', 'controles-hote.js')); } finally { Module._load = orig; }
}
const controles = charger();

// Un numéro jetable : un dossier d'articles, aucun journal de compilation.
const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-controles-hote-'));
fs.mkdirSync(path.join(racine, 'articles', '00-a'), { recursive: true });
fs.mkdirSync(path.join(racine, 'articles', '01-b'), { recursive: true });
test.after(() => { fs.rmSync(racine, { recursive: true, force: true }); });

function constat(source, code, slug) {
  return { source: source, code: code, ton: 'attention', cle: '', args: [], champs: {}, slug: slug };
}

const codes = (liste) => liste.map((c) => c.source + '/' + c.code).sort();

test('poser les constats d’une source n’efface pas ceux d’une autre', () => {
  controles.reinitialiser();
  controles.poserConstats(racine, 'reimport', [constat('import', 'tableau', '01-a')]);
  controles.poserConstats(racine, 'pagination', [constat('pagination', 'impair', '')]);
  controles.poserConstatsExport(racine, ['articles/02-b : titre manquant'], 0);
  assert.deepStrictEqual(codes(controles.constatsCourants(racine)),
    ['export/refus', 'import/tableau', 'pagination/impair']);
  // Reposer une source la remplace, elle seule.
  controles.poserConstats(racine, 'reimport', []);
  assert.deepStrictEqual(codes(controles.constatsCourants(racine)),
    ['export/refus', 'pagination/impair']);
  assert.deepStrictEqual(controles.constatsPoses('pagination').map((c) => c.code), ['impair']);
});

test('changer de numéro périme toutes les sources à la fois', () => {
  controles.reinitialiser();
  controles.poserConstats(racine, 'reimport', [constat('import', 'tableau', '01-a')]);
  const autre = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-controles-hote-autre-'));
  try {
    assert.strictEqual(controles.ouvrirNumero(autre, null), true);
    assert.strictEqual(controles.ouvrirNumero(autre, null), false, 'le même numéro ne repart pas de zéro');
    assert.deepStrictEqual(controles.constatsPoses('reimport'), []);
    assert.deepStrictEqual(controles.constatsCourants(autre), []);
  } finally { fs.rmSync(autre, { recursive: true, force: true }); }
});

test('un nom qu’un article a quitté ne s’affiche plus', () => {
  controles.reinitialiser();
  controles.poserConstats(racine, 'reimport',
    [constat('import', 'tableau', '00-a'), constat('import', 'tableau', '09-parti')]);
  assert.strictEqual(controles.constatsCourants(racine).length, 2);
  // « 09-parti » n’a plus de dossier : l’alignement le retient comme nom retiré.
  controles.alignerDossiersSurOrdre(racine, ['00-a', '01-b']);
  assert.deepStrictEqual(controles.constatsCourants(racine).map((c) => c.slug), ['00-a']);
});

test('l’analyse débutée voile l’article, terminée elle se lève, et la vue en est avertie', () => {
  controles.reinitialiser();
  const pousses = [];
  controles.configurer({ pousserAnalyseControles: (m) => pousses.push(m) });
  const fournisseur = { racine: racine };
  controles.debuterAnalyse(fournisseur, '01-a');
  controles.debuterAnalyse(fournisseur, '02-b');
  assert.deepStrictEqual(controles.etatAnalyse().cles, ['01-a', '02-b']);
  assert.strictEqual(controles.etatAnalyse().actif, true);
  // Le journal relu, aucune validation PDF/UA en vol : le voile tombe de lui-même.
  controles.noterProcessFini();
  assert.strictEqual(controles.processFini(), true);
  controles.marquerJournalRelu(fournisseur);
  assert.strictEqual(controles.etatAnalyse().actif, false);
  assert.strictEqual(controles.processFini(), false, 'la tâche suivante repart sans processus fini');
  assert.deepStrictEqual(pousses.map((m) => m.actif), [true, true, false]);
  assert.ok(pousses.every((m) => m.type === 'analyse'));
});

test('terminerAnalyse sans analyse en cours ne pousse rien', () => {
  controles.reinitialiser();
  const pousses = [];
  controles.configurer({ pousserAnalyseControles: (m) => pousses.push(m) });
  controles.terminerAnalyse({ racine: racine });
  assert.deepStrictEqual(pousses, []);
});
