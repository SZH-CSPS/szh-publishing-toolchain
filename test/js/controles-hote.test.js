// lib/controles-hote.js configuré seul, sans extension.js. Les constats sont rangés par
// source : en poser pour l'une n'efface pas ceux d'une autre. Le voile « Analyse en
// cours… » se lève quand la tâche est finie.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
require('./poste-isole');

// Les éléments de barre d'état créés par installerBarres, dans l'ordre : compteur, badge PDF/UA.
const barres = [];
// Les notifications sorties, par ton, et les réglages lus par le module.
const notifs = { erreurs: [], avertissements: [], infos: [], boutons: [], reponse: undefined };
const reglages = {};

// Doublure minimale de « vscode ».
function charger() {
  const Module = require('module');
  const orig = Module._load;
  const faux = {
    Uri: { file: (p) => ({ fsPath: p }) },
    window: {
      showErrorMessage: async (m, ...boutons) => { notifs.erreurs.push(m); notifs.boutons = boutons; return notifs.reponse; },
      showInformationMessage: async (m) => { notifs.infos.push(m); },
      showWarningMessage: async (m) => { notifs.avertissements.push(m); },
      createStatusBarItem: () => {
        const item = { text: '', visible: false };
        item.show = () => { item.visible = true; };
        item.hide = () => { item.visible = false; };
        barres.push(item);
        return item;
      }
    },
    StatusBarAlignment: { Left: 1 },
    commands: { executeCommand: async () => {} },
    workspace: { getConfiguration: () => ({ get: (cle, defaut) => (cle in reglages ? reglages[cle] : defaut) }) },
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

test('la barre d’état compte les refus d’export comme la vue les montre', () => {
  controles.reinitialiser();
  barres.length = 0;
  controles.installerBarres({ subscriptions: [] }, {});
  const compteur = barres[0];
  controles.poserConstats(racine, 'reimport', []);
  assert.strictEqual(compteur.visible, false, 'rien à signaler : la barre reste masquée');
  controles.poserConstatsExport(racine, ['articles/00-a : titre manquant', 'articles/01-b : auteur manquant'], 0);
  assert.strictEqual(compteur.visible, true, 'des refus d’export font monter le compteur');
  assert.match(compteur.text, /2/, 'deux refus, ton danger : deux bloquants');
  // Un avertissement de réimport seul : la barre le dit, les bloquants d'export gardent la main.
  controles.poserConstats(racine, 'reimport', [constat('import', 'tableau', '00-a')]);
  assert.match(compteur.text, /2/);
  controles.poserConstatsExport(racine, [], 0);
  assert.match(compteur.text, /1/, 'les refus effacés, il ne reste que l’avertissement');
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

// Une seule figure sans texte alternatif : la vue la range en bloquant (lib/constats.js,
// gravite) ; la barre d'état et la notification disent la même chose, et passent en
// avertissement avec elle quand la validation PDF/UA est éteinte.
const JOURNAL_FIGURE = '[numerotation-avertissement] figure-sans-alt | article « 00-a » | image « media/fig-01.png » | L’image n’a pas de texte alternatif | [de] Bild ohne Alt\n';

async function compilerFigure() {
  controles.reinitialiser();
  barres.length = 0;
  notifs.erreurs.length = 0;
  notifs.avertissements.length = 0;
  const fournisseur = { racine: racine, listerArticles: () => ['00-a', '01-b'],
    _tablesArticle: () => [], _imagesArticle: () => [] };
  controles.installerBarres({ subscriptions: [] }, fournisseur);
  fs.writeFileSync(path.join(racine, '.szh-journal.log'), JOURNAL_FIGURE, 'utf8');
  try { await controles.relireJournal(fournisseur, 0); }
  finally { fs.rmSync(path.join(racine, '.szh-journal.log'), { force: true }); }
  await new Promise((r) => setImmediate(r));
  const vue = controles.vueControles(fournisseur);
  return { compteur: barres[0], tons: vue.lignes.flatMap((l) => l.messages.map((m) => m.ton)) };
}

test('une figure sans alternative : la barre et la notification comptent comme la vue', async () => {
  delete reglages.controlePdfUa;
  const { compteur, tons } = await compilerFigure();
  assert.deepStrictEqual(tons, ['danger'], 'la vue ne la range plus en bloquant');
  assert.strictEqual(compteur.visible, true, 'la barre d’état se tait sur un bloquant');
  assert.match(compteur.text, /1 à corriger/);
  assert.strictEqual(notifs.erreurs.length, 1, 'la notification n’est pas une erreur');
  assert.strictEqual(notifs.avertissements.length, 0);
});

test('la même figure, validation PDF/UA éteinte : un avertissement partout', async () => {
  reglages.controlePdfUa = false;
  try {
    const { compteur, tons } = await compilerFigure();
    assert.deepStrictEqual(tons, ['attention']);
    assert.strictEqual(compteur.visible, true);
    assert.match(compteur.text, /1 à vérifier/);
    assert.strictEqual(notifs.erreurs.length, 0, 'une erreur pour ce que la vue range en avertissement');
    assert.strictEqual(notifs.avertissements.length, 1);
  } finally { delete reglages.controlePdfUa; }
});

// Un arrêt que le journal ne sait pas nommer : la notification porte de quoi contacter le
// support sans passer par la vue, et le clic écrit le même rapport que la carte.
test('échec inconnu : la notification offre « Contacter le support », qui écrit le signalement', async () => {
  const bac = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-support-'));
  const avant = { SZH_RAPPORTS: process.env.SZH_RAPPORTS, LOCALAPPDATA: process.env.LOCALAPPDATA,
                  SZH_BASE: process.env.SZH_BASE, SZH_ANCRAGE: process.env.SZH_ANCRAGE };
  process.env.SZH_RAPPORTS = path.join(bac, 'rapports');
  process.env.LOCALAPPDATA = path.join(bac, 'local');
  process.env.SZH_BASE = path.join(bac, 'base');
  delete process.env.SZH_ANCRAGE;
  const journal = path.join(racine, '.szh-journal.log');
  try {
    controles.reinitialiser();
    notifs.erreurs.length = 0;
    notifs.infos.length = 0;
    notifs.reponse = 'Contacter le support';
    const fournisseur = { racine: racine, listerArticles: () => ['00-a', '01-b'],
      _tablesArticle: () => [], _imagesArticle: () => [] };
    fs.writeFileSync(journal, ['filters/szh-legendes.lua:42: attempt to index a nil value',
      'make: *** [Makefile:310] Error 83', ''].join('\n'), 'utf8');
    await controles.relireJournal(fournisseur, 2);
    for (let i = 0; i < 5; i++) { await new Promise((r) => setImmediate(r)); }
    assert.strictEqual(notifs.erreurs.length, 1, 'aucune notification d’échec');
    assert.ok(notifs.boutons.indexOf('Contacter le support') !== -1,
      'pas de bouton support dans la notification : ' + JSON.stringify(notifs.boutons));
    const rapports = fs.existsSync(process.env.SZH_RAPPORTS)
      ? fs.readdirSync(process.env.SZH_RAPPORTS).filter((n) => n.endsWith('.json')) : [];
    const codes = rapports.map((n) => JSON.parse(fs.readFileSync(path.join(process.env.SZH_RAPPORTS, n), 'utf8')).code);
    assert.ok(codes.indexOf('COCKPIT-SIGNALEMENT') !== -1, 'le clic n’a rien écrit : ' + JSON.stringify(codes));
    assert.ok(notifs.infos.some((m) => /Signalement enregistré/.test(m)), 'le clic ne dit pas ce qui a eu lieu');
  } finally {
    notifs.reponse = undefined;
    fs.rmSync(journal, { force: true });
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) { delete process.env[k]; } else { process.env[k] = v; } }
    fs.rmSync(bac, { recursive: true, force: true });
  }
});
