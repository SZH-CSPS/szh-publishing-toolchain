// L'onglet Log du lanceur côté hôte (lib/lanceur-journal-hote.js) : la liste et la fin des
// journaux, l'éditeur, et le signalement en un geste, dans ses trois issues. Tout s'écrit
// dans un dossier jetable ; aucun courriel ne part, le brouillon n'est que lu.
//
//   node --test test/js/lanceur-journal.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-lanceur-jrn-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const LOGS = path.join(TRAVAIL, 'ProgramData', 'logs');
fs.mkdirSync(LOGS, { recursive: true });
Object.assign(process.env, { SZH_BASE: path.join(TRAVAIL, 'ProgramData'), LOCALAPPDATA: path.join(TRAVAIL, 'Local'),
  SZH_TOOLKIT: RACINE, SZH_ANCRAGE: path.join(TRAVAIL, 'Ancrage'), SZH_LANGUE: 'fr' });
delete process.env.SZH_RESEAU_INTERDIT;

const FIN = ['Windows PowerShell transcript end'];
const LONG = Array.from({ length: 230 }, (_, i) => 'ligne ' + i).concat(['✓ Tout est à jour.'], FIN);
fs.writeFileSync(path.join(LOGS, 'update-20261001-081203.log'), LONG.join('\r\n') + '\r\n', 'utf8');
fs.writeFileSync(path.join(LOGS, 'update-20260924-080500.log'), ['Échec.'].concat(FIN).join('\n') + '\n', 'utf8');

const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
const { COURRIEL_SUPPORT } = require(path.join(COCKPIT, 'lib', 'codes-erreur.js'));
const hote = require(path.join(COCKPIT, 'lib', 'lanceur-journal-hote.js'));
const envoyes = [];
const editeur = [];
const dossiers = [];
const liens = [];
hote.configurer({ envoyer: (m) => envoyes.push(m), ouvrirEditeur: (c) => editeur.push(c),
  ouvrirDossier: (c) => dossiers.push(c), ouvrirLien: (u) => liens.push(u), versionEditeur: () => '1.99.0' });
const oublier = () => { envoyes.length = 0; editeur.length = 0; dossiers.length = 0; liens.length = 0; };

test('log : la liste pour la page, plus récent d’abord, avec la date, le verdict et la taille', () => {
  assert.deepStrictEqual(hote.listePage(), [
    { rang: 0, date: '01.10.2026 08:12', verdict: 'ok', ko: 2 },
    { rang: 1, date: '24.09.2026 08:05', verdict: 'echec', ko: 1 }
  ]);
});

test('log : la fin d’un journal, l’éditeur, et un journal illisible', () => {
  oublier();
  hote.listePage();
  hote.surMessage({ type: MSG.LANCEUR_JOURNAL_LIRE, rang: 0 });
  assert.strictEqual(envoyes[0].type, MSG.LANCEUR_JOURNAL_TEXTE);
  assert.strictEqual(envoyes[0].rang, 0);
  assert.strictEqual(envoyes[0].lignes, 200);
  assert.ok(envoyes[0].texte.endsWith('Windows PowerShell transcript end'));
  hote.surMessage({ type: MSG.LANCEUR_JOURNAL_LIRE, rang: 1 });
  assert.strictEqual(envoyes[1].lignes, 0, 'un journal court se montre en entier');
  hote.surMessage({ type: MSG.LANCEUR_JOURNAL_EDITEUR, rang: 1 });
  hote.surMessage({ type: MSG.LANCEUR_JOURNAL_EDITEUR, rang: 7 });
  assert.deepStrictEqual(editeur, [path.join(LOGS, 'update-20260924-080500.log')]);
  fs.renameSync(path.join(LOGS, 'update-20260924-080500.log'), path.join(TRAVAIL, 'ailleurs.log'));
  try {
    hote.surMessage({ type: MSG.LANCEUR_JOURNAL_LIRE, rang: 1 });
    assert.strictEqual(envoyes[2].rang, 1);
    assert.ok(envoyes[2].erreur, 'l’erreur se dit');
  } finally { fs.renameSync(path.join(TRAVAIL, 'ailleurs.log'), path.join(LOGS, 'update-20260924-080500.log')); }
});

function rapportsDans(dossier) {
  try { return fs.readdirSync(dossier).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dossier, f), 'utf8'))); }
  catch (e) { return []; }
}

test('log : signaler écrit le rapport avec la phrase et le journal, puis ouvre les journaux et le brouillon', () => {
  oublier();
  const dossier = path.join(TRAVAIL, 'rapports');
  process.env.SZH_RAPPORTS = dossier;
  hote.listePage();
  hote.surMessage({ type: MSG.LANCEUR_SIGNALER, phrase: '  Le PDF sort sans les portraits.  ', rang: 0 });
  const rapports = rapportsDans(dossier);
  assert.strictEqual(rapports.length, 1);
  assert.strictEqual(rapports[0].code, 'LANCEUR-SIGNALEMENT');
  assert.strictEqual(rapports[0].source, 'lanceur');
  assert.strictEqual(rapports[0].message, 'Le PDF sort sans les portraits.');
  assert.ok(rapports[0].journal && rapports[0].journal.extrait.indexOf('✓ Tout est à jour.') !== -1, 'le journal affiché part avec');
  assert.deepStrictEqual(dossiers, [LOGS]);
  assert.strictEqual(liens.length, 1);
  assert.ok(liens[0].startsWith('mailto:' + COURRIEL_SUPPORT + '?subject='), liens[0]);
  const corps = decodeURIComponent(liens[0].split('&body=')[1]);
  assert.ok(corps.includes('Le PDF sort sans les portraits.') && corps.includes('update-20261001-081203.log'), corps);
  assert.deepStrictEqual(envoyes, [{ type: MSG.LANCEUR_SIGNALE, issue: 'fait', courriel: true }]);
});

test('log : sans dossier de rapports joignable, le signalement attend ; répété, il est refusé', () => {
  oublier();
  const bloque = path.join(TRAVAIL, 'un-fichier');
  fs.writeFileSync(bloque, 'x');
  process.env.SZH_RAPPORTS = path.join(bloque, 'rapports');
  hote.surMessage({ type: MSG.LANCEUR_SIGNALER, phrase: 'Rien ne s’ouvre.', rang: 1 });
  assert.strictEqual(envoyes[0].issue, 'attente');
  assert.strictEqual(rapportsDans(path.join(TRAVAIL, 'Local', 'SZH', 'rapports-en-attente')).length, 1);
  hote.surMessage({ type: MSG.LANCEUR_SIGNALER, phrase: 'Rien ne s’ouvre.', rang: 1 });
  assert.strictEqual(envoyes[1].issue, 'refuse', 'le même signalement, aussitôt, est étouffé');
  hote.surMessage({ type: MSG.LANCEUR_SIGNALER, phrase: '   ', rang: 1 });
  assert.strictEqual(envoyes.length, 2, 'une phrase vide ne part pas');
  delete process.env.SZH_RAPPORTS;
});

test('log : l’adresse du support n’est écrite qu’une fois, dans lib/codes-erreur.js', () => {
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'lanceur-journal-hote.js'), 'utf8');
  assert.ok(!/@\w/.test(src.replace(/@@/g, '')), 'une adresse en dur dans lanceur-journal-hote.js');
});
