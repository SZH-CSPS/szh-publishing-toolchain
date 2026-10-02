// Le module de la vue « Articles », configuré seul, sans extension.js : ses fonctions pures
// et ses rappels répondent sans l'hôte.
//
//   node --test "test/js/vue-articles-hote.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Une doublure minimale de « vscode » : elle compte les panneaux créés.
const crees = [];
// Les commandes jouées par le module, dans l'ordre.
const commandes = [];
function charger() {
  const Module = require('module');
  const orig = Module._load;
  const rien = { dispose() {} };
  const faux = {
    EventEmitter: class { constructor() { this.event = () => rien; } fire() {} dispose() {} },
    ViewColumn: { One: 1, Two: 2 },
    Uri: { file: (p) => ({ fsPath: p }), parse: (u) => ({ toString: () => u }) },
    window: {
      showWarningMessage: () => Promise.resolve(undefined),
      showInformationMessage: () => Promise.resolve(undefined),
      setStatusBarMessage: () => rien,
      tabGroups: { all: [] },
      createWebviewPanel: (type) => {
        const p = {
          type: type, reveles: 0, messages: [], title: '',
          webview: { html: '', postMessage(m) { p.messages.push(m); }, onDidReceiveMessage() { return rien; } },
          reveal() { p.reveles++; },
          onDidDispose() { return rien; }
        };
        crees.push(p);
        return p;
      }
    },
    workspace: { getConfiguration: () => ({ get: () => '' }), workspaceFolders: [] },
    env: { language: 'fr' },
    commands: { executeCommand: (id) => { commandes.push(id); return Promise.resolve(); } }
  };
  Module._load = function (r, pp, i) { return r === 'vscode' ? faux : orig(r, pp, i); };
  try { return require(path.join(COCKPIT, 'lib', 'vue-articles-hote.js')); } finally { Module._load = orig; }
}

test('vue-articles-hote : un article sans DOI le dit, un DOI manuel est étiqueté et confronté au calculé', () => {
  const m = charger();
  const sans = m.apercuDoi('fr', '2026', '03', -1, '', false);
  assert.deepStrictEqual(sans.constats, []);
  assert.ok(sans.ligne.texte !== '', 'la ligne DOI d’un article sans DOI est vide');
  const manuel = m.apercuDoi('fr', '2026', '03', 1, '10.0000/autre', false);
  assert.strictEqual(manuel.ligne.texte, '10.0000/autre', 'la carte n’affiche pas le DOI manuel');
  assert.strictEqual(manuel.ligne.marques.length, 1);
  assert.strictEqual(manuel.constats.length, 1, 'la divergence avec le calculé n’est pas signalée');
  assert.strictEqual(manuel.constats[0].ton, 'attention');
});

test('vue-articles-hote : le mode « Changer l’ordre » passe par les rappels de l’hôte', async () => {
  const m = charger();
  const poses = [];
  let enCours = null;
  m.configurer({
    poserModeOrdre: (etat) => { poses.push(etat); enCours = etat; },
    ordreEnCours: (racine) => (enCours && enCours.racine === racine ? enCours.slugs : null)
  });
  const fournisseur = { racine: os.tmpdir(), listerArticles: () => ['01-a', '02-b'] };
  await m.actionArticle(fournisseur, null, { type: 'commande', id: 'ordre' });
  assert.deepStrictEqual(poses[0], { racine: os.tmpdir(), slugs: ['01-a', '02-b'] });
  await m.actionArticle(fournisseur, null, { type: 'action', id: 'monter', cle: '02-b' });
  assert.deepStrictEqual(poses[1], { racine: os.tmpdir(), slugs: ['02-b', '01-a'] },
    'le déplacement en mode ordre n’a pas reposé l’ordre voulu');
  await m.actionArticle(fournisseur, null, { type: 'commande', id: 'ordre-annuler' });
  assert.strictEqual(poses[2], null);
});

test('vue-articles-hote : déplacer une unité écrit l’ordre par ecrireClesAusgabe de l’hôte', () => {
  const m = charger();
  const ecrits = [];
  m.configurer({
    ordreEnCours: () => null,
    articlesSansDoi: () => new Set(),
    refusCoedition: () => null,
    ecrireClesAusgabe: (racine, modifies) => { ecrits.push(modifies); return null; }
  });
  const fournisseur = { racine: os.tmpdir(), listerArticles: () => ['01-a', '02-b'] };
  const dit = m.deplacerUnite(fournisseur, '02-b', -1, null);
  assert.strictEqual(ecrits.length, 1);
  assert.deepStrictEqual(Object.values(ecrits[0])[0], ['02-b', '01-a']);
  assert.ok(typeof dit === 'string' && dit !== '');
});

test('vue-articles-hote : rouvrir la vue révèle le panneau existant, sans en créer un second', async () => {
  const m = charger();
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-vue-articles-'));
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'), 'revue: revue\nlang: fr\n');
  fs.mkdirSync(path.join(racine, 'articles'));
  const fournisseur = { racine: racine, listerArticles: () => [], _imagesArticle: () => [] };
  const avant = crees.length;
  await m.ouvrirVueArticles(fournisseur, null);
  await m.ouvrirVueArticles(fournisseur, null);
  const vues = crees.slice(avant).filter((p) => p.type === 'szhVueArticles');
  assert.strictEqual(vues.length, 1, 'la vue a été recréée au lieu d’être réutilisée');
  assert.strictEqual(vues[0].reveles, 1, 'le panneau ouvert n’a pas été révélé');
  assert.ok(vues[0].messages.some((x) => x.type === 'valeurs'), 'le panneau réutilisé n’a pas reçu ses valeurs');
});

test('vue-articles-hote : « Paginer » et « Exporter pour OJS » appellent les commandes existantes', async () => {
  const m = charger();
  const fournisseur = { racine: os.tmpdir(), listerArticles: () => [] };
  commandes.length = 0;
  await m.actionArticle(fournisseur, null, { type: 'commande', id: 'paginer' });
  await m.actionArticle(fournisseur, null, { type: 'commande', id: 'exporter-ojs' });
  assert.deepStrictEqual(commandes, ['szh.rafraichirPagination', 'szh.exporterXml']);
});
