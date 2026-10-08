// L'aperçu de la date imprimée d'une fiche : pipeline/filters/szh-date-apercu.lua (le
// formateur de szh-commun.lua, celui de la compilation) et lib/date-apercu.js, qui le lance
// dans le moteur avec la saisie sur stdin.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { EventEmitter } = require('events');
const { sauter, sansPandoc, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');
const SCRIPT = path.join(FILTRES, 'szh-date-apercu.lua');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const dateApercu = require(path.join(COCKPIT, 'lib', 'date-apercu.js'));

// ---- Le script Lua, par le pandoc du PATH ----------------------------------------------

function former(saisie, valeurs, lang, cwd) {
  const r = cp.spawnSync('pandoc', ['lua', SCRIPT], {
    input: JSON.stringify({ saisie: saisie, lang: lang || 'fr', valeurs: valeurs }),
    encoding: 'utf8', cwd: cwd
  });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  assert.strictEqual(r.status, 0, 'code de sortie ' + r.status + ' : ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('script : le fichier existe dans pipeline/filters', () => {
  assert.ok(fs.existsSync(SCRIPT), 'szh-date-apercu.lua absent');
});

test('script : date', (t) => {
  if (sansPandoc) { return sauter.pandoc(t); }
  assert.deepStrictEqual(former('date', ['2026-01-05']), { forme: '05.01.2026' });
  assert.deepStrictEqual(former('date', ['2026-02-30']), { forme: '30.02.2026', erreur: 'impossible' });
  assert.deepStrictEqual(former('date', ['2026-13-01']), { forme: '01.13.2026', erreur: 'impossible' });
  assert.deepStrictEqual(former('date', ['2024-02-29']), { forme: '29.02.2024' }, 'année bissextile');
  assert.deepStrictEqual(former('date', ['2100-02-29']), { forme: '29.02.2100', erreur: 'impossible' });
  assert.deepStrictEqual(former('date', ['5.1.26']), { forme: '5.1.26', erreur: 'format' });
  assert.deepStrictEqual(former('date', ['']), { forme: '' });
});

test('script : date partielle', (t) => {
  if (sansPandoc) { return sauter.pandoc(t); }
  assert.deepStrictEqual(former('date_partielle', ['2026']), { forme: '2026' });
  assert.deepStrictEqual(former('date_partielle', ['2026-03']), { forme: '03.2026' });
  assert.deepStrictEqual(former('date_partielle', ['2026-03-05']), { forme: '05.03.2026' });
  assert.deepStrictEqual(former('date_partielle', ['2026-3']), { forme: '2026-3', erreur: 'format' });
  assert.deepStrictEqual(former('date_partielle', ['2026-00']), { forme: '00.2026', erreur: 'impossible' });
  assert.deepStrictEqual(former('date_partielle', ['2026-04-31']), { forme: '31.04.2026', erreur: 'impossible' });
});

test('script : plage, les quatre formes du corpus et la fin avant le début', (t) => {
  if (sansPandoc) { return sauter.pandoc(t); }
  assert.deepStrictEqual(former('plage', ['2026-01-05', '2026-01-05']), { forme: '05.01.2026' });
  assert.deepStrictEqual(former('plage', ['2026-01-05', '']), { forme: '05.01.2026' });
  assert.deepStrictEqual(former('plage', ['', '2026-01-06']), { forme: '06.01.2026' });
  assert.deepStrictEqual(former('plage', ['2026-01-05', '2026-01-06']), { forme: '05.–06.01.2026' });
  assert.deepStrictEqual(former('plage', ['2026-06-29', '2026-07-02']), { forme: '29.06.–02.07.2026' });
  assert.deepStrictEqual(former('plage', ['2026-09-10', '2028-07-04']), { forme: '10.09.2026–04.07.2028' });
  assert.deepStrictEqual(former('plage', ['2026-03-02', '2026-03-01']), { forme: '02.–01.03.2026', erreur: 'inversee' });
  assert.deepStrictEqual(former('plage', ['2026-02-30', '2026-03-02']), { forme: '30.02.–02.03.2026', erreur: 'impossible' });
  assert.deepStrictEqual(former('plage', ['2026-03-02', 'bientôt']), { forme: '02.03.2026–bientôt', erreur: 'format' });
});

test('script : l’allemand imprime la même forme que le français', (t) => {
  if (sansPandoc) { return sauter.pandoc(t); }
  assert.deepStrictEqual(former('date', ['2026-01-05'], 'de'), former('date', ['2026-01-05'], 'fr'));
  assert.deepStrictEqual(former('plage', ['2026-06-29', '2026-07-02'], 'de'),
    former('plage', ['2026-06-29', '2026-07-02'], 'fr'));
});

test('script : une saisie qui ressemble à du shell reste un texte', (t) => {
  if (sansPandoc) { return sauter.pandoc(t); }
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-date-apercu-'));
  const r = former('date', ['$(touch x); `touch y`'], 'fr', dossier);
  assert.deepStrictEqual(r, { forme: '$(touch x); `touch y`', erreur: 'format' });
  assert.deepStrictEqual(fs.readdirSync(dossier), []);
});

test('script : une demande illisible sort en erreur, sans rien imprimer sur stdout', (t) => {
  if (sansPandoc) { return sauter.pandoc(t); }
  const r = cp.spawnSync('pandoc', ['lua', SCRIPT], { input: 'pas du json', encoding: 'utf8' });
  assert.notStrictEqual(r.status, 0);
  assert.strictEqual(r.stdout, '');
});

// ---- Un seul formateur de dates -----------------------------------------------------

test('structure : seules les fonctions de szh-commun.lua forment une date suisse', () => {
  const RE = /function\s+(?:M\.)?(jour_mois_an|date_suisse|date_partielle_suisse|plage_date)\b/;
  const fautifs = fs.readdirSync(FILTRES).filter((f) => f.endsWith('.lua') && f !== 'szh-commun.lua')
    .filter((f) => RE.test(fs.readFileSync(path.join(FILTRES, f), 'utf8')));
  assert.deepStrictEqual(fautifs, []);
  const commun = fs.readFileSync(path.join(FILTRES, 'szh-commun.lua'), 'utf8');
  for (const nom of ['jour_mois_an', 'date_suisse', 'date_partielle_suisse', 'plage_date', 'verifier_date']) {
    assert.match(commun, new RegExp('function M\\.' + nom + '\\('), nom + ' absent de szh-commun.lua');
  }
});

// Les surfaces de la Documentation ne forment aucune date elles-mêmes : la forme imprimée
// vient du script. D'autres modules du cockpit datent leurs propres écrans (accueil,
// journaux) et ne sont pas visés.
test('structure : aucune date suisse formée en JavaScript côté Documentation', () => {
  const surfaces = ['lib/date-apercu.js', 'lib/documentation-hote.js', 'media/documentation.js', 'media/_fiche-doc.js'];
  const RE = [/\.get(UTC)?Date\(\)/, /toLocaleDateString/, /\[[123]\]\s*\+\s*'\.'/, /padStart\(2[^\n]*'\.'/];
  for (const s of surfaces) {
    const code = fs.readFileSync(path.join(COCKPIT, s), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    for (const re of RE) { assert.doesNotMatch(code, re, s + ' : ' + re); }
  }
});

// ---- lib/date-apercu.js, spawn remplacé ---------------------------------------------

function fauxSpawn(t, comportement) {
  const appels = [];
  const origine = cp.spawn;
  cp.spawn = (exe, args, opts) => {
    const proc = new EventEmitter();
    const recu = [];
    proc.stdin = { write: (d) => { recu.push(String(d)); return true; }, end: (d) => { if (d) { recu.push(String(d)); } proc.emit('_fin'); }, on: () => {} };
    proc.stdout = new EventEmitter();
    proc.kill = () => { proc.tue = true; };
    appels.push({ exe: exe, args: args, opts: opts, stdin: recu, proc: proc });
    proc.on('_fin', () => setImmediate(() => comportement(proc, recu.join(''))));
    return proc;
  };
  t.after(() => { cp.spawn = origine; });
  return appels;
}

test('module : la saisie part sur stdin, jamais dans la ligne de commande', async (t) => {
  const appels = fauxSpawn(t, (proc) => {
    proc.stdout.emit('data', Buffer.from('{"forme":"05.01.2026"}'));
    proc.emit('close', 0);
  });
  const r = await dateApercu.former({ saisie: 'date', lang: 'fr', valeurs: ['2026-01-05$(id)'] });
  assert.deepStrictEqual(r, { ok: true, forme: '05.01.2026' });
  assert.strictEqual(appels.length, 1);
  const argv = appels[0].args.join(' ');
  assert.ok(!argv.includes('2026-01-05'), 'la valeur ne doit jamais être dans argv : ' + argv);
  assert.ok(argv.includes('szh-date-apercu.lua'), argv);
  assert.deepStrictEqual(JSON.parse(appels[0].stdin.join('')),
    { saisie: 'date', lang: 'fr', valeurs: ['2026-01-05$(id)'] });
});

test('module : une erreur du script se transmet avec sa forme', async (t) => {
  fauxSpawn(t, (proc) => {
    proc.stdout.emit('data', Buffer.from('{"forme":"30.02.2026","erreur":"impossible"}\n'));
    proc.emit('close', 0);
  });
  const r = await dateApercu.former({ saisie: 'date', lang: 'de', valeurs: ['2026-02-30'] });
  assert.deepStrictEqual(r, { ok: true, forme: '30.02.2026', erreur: 'impossible' });
});

test('module : code non nul, JSON illisible, erreur de lancement : indisponible, sans exception', async (t) => {
  let mode = 'code';
  fauxSpawn(t, (proc) => {
    if (mode === 'code') { proc.emit('close', 1); }
    if (mode === 'json') { proc.stdout.emit('data', Buffer.from('{pas du json')); proc.emit('close', 0); }
    if (mode === 'erreur') { proc.emit('error', new Error('ENOENT')); }
  });
  const d = { saisie: 'date', lang: 'fr', valeurs: ['2026-01-05'] };
  assert.deepStrictEqual(await dateApercu.former(d), { indisponible: true });
  mode = 'json';
  assert.deepStrictEqual(await dateApercu.former(d), { indisponible: true });
  mode = 'erreur';
  assert.deepStrictEqual(await dateApercu.former(d), { indisponible: true });
});

test('module : spawn qui lève, ou saisie inconnue : indisponible', async (t) => {
  const origine = cp.spawn;
  cp.spawn = () => { throw new Error('wsl.exe absent'); };
  t.after(() => { cp.spawn = origine; });
  assert.deepStrictEqual(await dateApercu.former({ saisie: 'date', lang: 'fr', valeurs: ['2026-01-05'] }),
    { indisponible: true });
  assert.deepStrictEqual(await dateApercu.former({ saisie: 'rm -rf', lang: 'fr', valeurs: ['x'] }),
    { indisponible: true });
});

test('module : délai dépassé, le processus est tué et l’aperçu indisponible', async (t) => {
  const appels = fauxSpawn(t, () => { /* ne répond jamais */ });
  t.mock.timers.enable({ apis: ['setTimeout', 'setImmediate'] });
  const p = dateApercu.former({ saisie: 'date', lang: 'fr', valeurs: ['2026-01-05'] }, { delaiMs: 3000 });
  t.mock.timers.tick(2999);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(await p, { indisponible: true });
  assert.strictEqual(appels[0].proc.tue, true);
});

test('module : au plus quatre appels en vol, le cinquième est indisponible sans lancer', async (t) => {
  const procs = [];
  const appels = fauxSpawn(t, (proc) => { procs.push(proc); });
  const d = { saisie: 'date', lang: 'fr', valeurs: ['2026-01-05'] };
  const enVol = [1, 2, 3, 4].map(() => dateApercu.former(d));
  assert.deepStrictEqual(await dateApercu.former(d), { indisponible: true });
  assert.strictEqual(appels.length, 4);
  await new Promise((r) => setImmediate(r));
  for (const proc of procs) { proc.stdout.emit('data', Buffer.from('{"forme":"05.01.2026"}')); proc.emit('close', 0); }
  for (const r of await Promise.all(enVol)) { assert.deepStrictEqual(r, { ok: true, forme: '05.01.2026' }); }
});

// ---- Intégration : le vrai moteur ---------------------------------------------------

test('intégration : former() dans la WSL, et la saisie ne passe par aucun shell', async (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const debut = Date.now();
  const r = await dateApercu.former({ saisie: 'date', lang: 'fr', valeurs: ['2026-01-05'] }, { delaiMs: 20000 });
  const premier = Date.now() - debut;
  assert.deepStrictEqual(r, { ok: true, forme: '05.01.2026' });
  const debut2 = Date.now();
  await dateApercu.former({ saisie: 'date', lang: 'fr', valeurs: ['2026-01-06'] }, { delaiMs: 20000 });
  console.log('[date-apercu] WSL : ' + premier + ' ms, puis ' + (Date.now() - debut2) + ' ms');
  const temoin = '/tmp/szh-date-apercu-' + process.pid;
  const s = await dateApercu.former({ saisie: 'date', lang: 'fr', valeurs: ['$(touch ' + temoin + ')'] }, { delaiMs: 20000 });
  assert.strictEqual(s.erreur, 'format');
  const v = cp.spawnSync('wsl.exe', ['-d', 'SZH-Publishing', '--', 'test', '-e', temoin], { windowsHide: true });
  assert.strictEqual(v.status, 1, 'le fichier témoin ne doit pas exister');
});
