// « L'auteur renvoie son Word corrigé », vu de l'hôte : le Word se choisit avant la
// confirmation, et le geste n'en demande qu'une.
//
//   node --test test/js/reimport-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const LF = String.fromCharCode(10);

// Un faux System32 et un toolkit connus, comme moteur-argv.test.js : aucun vrai wsl.exe.
const WINDIR_ESSAI = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-windir-'));
fs.mkdirSync(path.join(WINDIR_ESSAI, 'System32'));
fs.writeFileSync(path.join(WINDIR_ESSAI, 'System32', 'wsl.exe'), '');
process.on('exit', () => { try { fs.rmSync(WINDIR_ESSAI, { recursive: true, force: true }); } catch (e) { /* débris */ } });
process.env.WINDIR = WINDIR_ESSAI;
process.env.SZH_TOOLKIT = 'C:\\SZH-essai\\toolkit';

// spawn intercepté avant tout chargement : seuls les lancements de wsl.exe sont simulés.
const cp = require('child_process');
const spawnReel = cp.spawn;
const appels = [];
let sortieFactice = '';
cp.spawn = function (commande, args, options) {
  if (!/wsl\.exe$/i.test(String(commande))) { return spawnReel.apply(this, arguments); }
  appels.push({ commande: commande, args: args, options: options });
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.kill = () => { setImmediate(() => p.emit('exit', null, 'SIGTERM')); };
  const texte = sortieFactice;
  setImmediate(() => {
    if (texte) { p.stdout.emit('data', Buffer.from(texte, 'utf8')); }
    p.emit('exit', 0, null);
    p.emit('close', 0);
  });
  return p;
};
require(path.join(COCKPIT, 'lib', 'wsl.js'));

const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const SLUG = '01-essai';
const MOTS = path.join(REVUE, 'articles-word');
const FICHE = path.join(REVUE, 'articles', SLUG, SLUG + '.meta.yaml');
const FICHE_ORIGINE = fs.readFileSync(FICHE, 'utf8');

// Les appels réimport seuls (reveiller() lance aussi wsl.exe).
const appelsReimport = () => appels.filter((a) => a.args.indexOf('python3') !== -1)
  .map((a) => a.args.slice(a.args.indexOf('python3') + 2));
const confirmations = () => HOTE.modales.filter((m) => m.options && m.options.modal
  && m.message === T('modale.reimport.question', [SLUG]));

// Journalise l'ordre des dialogues, et ce que showInformationMessage dit.
function espionner() {
  const ordre = [];
  const infos = [];
  const w = HOTE.stub.window;
  const origines = { qp: w.showQuickPick, avert: w.showWarningMessage, info: w.showInformationMessage };
  w.showQuickPick = (...a) => { ordre.push('choix'); return origines.qp(...a); };
  w.showWarningMessage = (m, ...r) => { ordre.push(r[0] && r[0].modal ? 'confirmation' : 'avert'); return origines.avert(m, ...r); };
  w.showInformationMessage = (m) => { infos.push(m); return Promise.resolve(undefined); };
  return {
    ordre: ordre, infos: infos,
    rendre() { w.showQuickPick = origines.qp; w.showWarningMessage = origines.avert; w.showInformationMessage = origines.info; }
  };
}

function preparer(source, wordsEnAttente) {
  fs.writeFileSync(FICHE, FICHE_ORIGINE.replace('type: article' + LF,
    'type: article' + LF + (source ? 'source: "' + source + '"' + LF : '')));
  for (const n of fs.readdirSync(MOTS)) {
    if (/\.(docx|odt)$/i.test(n)) { fs.rmSync(path.join(MOTS, n)); }
  }
  for (const n of wordsEnAttente) { fs.writeFileSync(path.join(MOTS, n), Buffer.alloc(16)); }
  appels.length = 0;
  HOTE.modales.length = 0;
  HOTE.repondreQuickPick(undefined);
}

test('mise en route : le démarrage se tait', async () => {
  await demarrageSeTait(HOTE);
});

test('Word de la fiche absent du dépôt : on choisit le Word, puis on confirme une fois', async () => {
  preparer('Ancien.docx', ['Corrige.docx']);
  const e = espionner();
  sortieFactice = JSON.stringify({ resultat: 'rien', article: SLUG, avertissements: [] }) + LF;
  HOTE.repondreQuickPick('Corrige.docx');
  HOTE.repondreModale(T('modale.reimport.bouton'));
  try {
    await HOTE.executer('szh.reimporterArticle', { slug: SLUG });
  } finally { e.rendre(); }
  assert.deepStrictEqual(e.ordre.slice(0, 2), ['choix', 'confirmation'],
    'la confirmation doit venir après le choix du Word, pas avant');
  assert.strictEqual(confirmations().length, 1, 'une seule confirmation');
  assert.deepStrictEqual(appelsReimport(), [['--article', SLUG, '--word', 'Corrige.docx']],
    'le Word choisi doit être apparié de force à l’article');
});

test('Word de la fiche en attente : une confirmation, et la chaîne le trouve seule', async () => {
  preparer('Corrige.docx', ['Corrige.docx']);
  const e = espionner();
  sortieFactice = JSON.stringify({ resultat: 'rien', article: SLUG, avertissements: [] }) + LF;
  HOTE.repondreModale(T('modale.reimport.bouton'));
  try {
    await HOTE.executer('szh.reimporterArticle', { slug: SLUG });
  } finally { e.rendre(); }
  assert.ok(e.ordre.indexOf('choix') === -1, 'aucun choix à faire quand le Word attend sous son nom');
  assert.strictEqual(confirmations().length, 1);
  assert.deepStrictEqual(appelsReimport(), [['--article', SLUG]]);
});

test('refus « sans Word » après la confirmation : choisir le Word ne redemande pas', async () => {
  preparer('Corrige.docx', ['Corrige.docx', 'Autre.docx']);
  const e = espionner();
  sortieFactice = JSON.stringify({ resultat: 'refuse', article: SLUG,
    avertissements: ['reimport-sans-word'] }) + LF;
  HOTE.repondreModale(T('modale.reimport.bouton'));
  HOTE.repondreModale(T('reimport.choisirWord'));
  HOTE.repondreQuickPick('Autre.docx');
  try {
    const promesse = HOTE.executer('szh.reimporterArticle', { slug: SLUG });
    // Le second lancement répond « rien à faire » : le geste s'arrête là.
    for (let i = 0; i < 20 && appelsReimport().length < 1; i++) { await new Promise((r) => setImmediate(r)); }
    sortieFactice = JSON.stringify({ resultat: 'rien', article: SLUG, avertissements: [] }) + LF;
    await promesse;
  } finally { e.rendre(); }
  assert.strictEqual(confirmations().length, 1, 'le geste ne confirme qu’une fois');
  assert.deepStrictEqual(appelsReimport(),
    [['--article', SLUG], ['--article', SLUG, '--word', 'Autre.docx']]);
});

test('aucun Word en attente : on dit où le déposer, sans rien lancer ni confirmer', async () => {
  preparer('Ancien.docx', []);
  const e = espionner();
  try {
    await HOTE.executer('szh.reimporterArticle', { slug: SLUG });
  } finally { e.rendre(); }
  assert.deepStrictEqual(e.infos, [T('reimport.deposerWord')]);
  assert.strictEqual(confirmations().length, 0);
  assert.deepStrictEqual(appelsReimport(), []);
});

test('depuis la vue Word : article et Word désignés, appariement forcé', async () => {
  preparer('', ['1_Essai.docx']);
  sortieFactice = JSON.stringify({ resultat: 'rien', article: SLUG, avertissements: [] }) + LF;
  HOTE.repondreModale(T('modale.reimport.bouton'));
  await HOTE.executer('szh.reimporterArticle', { word: '1_Essai.docx', slug: SLUG });
  assert.strictEqual(confirmations().length, 1);
  assert.deepStrictEqual(appelsReimport(), [['--article', SLUG, '--word', '1_Essai.docx']]);
});
