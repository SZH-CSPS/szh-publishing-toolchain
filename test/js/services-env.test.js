// lib/services-env.js : les trois variables des services en ligne (SZH_SHLINK_URL, SZH_SHLINK_CLE,
// SZH_OJS_CLE) et WSLENV, posées dans l'environnement de tout appel à la WSL que le cockpit
// lance (lib/moteur.js). Rien n'est posé quand rien n'est réglé, WSLENV existant est gardé, et
// une clé n'apparaît jamais dans un texte destiné à un journal.
//
//   node --test test/js/services-env.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const WINDIR_ESSAI = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-windir-env-'));
fs.mkdirSync(path.join(WINDIR_ESSAI, 'System32'));
fs.writeFileSync(path.join(WINDIR_ESSAI, 'System32', 'wsl.exe'), '');
process.on('exit', () => { try { fs.rmSync(WINDIR_ESSAI, { recursive: true, force: true }); } catch (e) { /* débris */ } });
process.env.WINDIR = WINDIR_ESSAI;

const cp = require('child_process');
const services = require(path.join(COCKPIT, 'lib', 'services-env.js'));
const moteur = require(path.join(COCKPIT, 'lib', 'moteur.js'));
const spawnReel = cp.spawn;
const appels = [];
cp.spawn = function (commande, args, options) {
  if (!/wsl\.exe$/i.test(String(commande))) { return spawnReel.apply(this, arguments); }
  appels.push({ commande, args, options });
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.kill = () => {};
  return p;
};

const CLE_SHLINK = 'cle-shlink-secrete-0123';
const CLE_OJS = 'cle-ojs-secrete-4567';
const WSLENV_AVANT = process.env.WSLENV;
test.afterEach(() => {
  services.poser({ url: '', shlinkCle: '', ojsCle: '' });
  if (WSLENV_AVANT === undefined) { delete process.env.WSLENV; } else { process.env.WSLENV = WSLENV_AVANT; }
});

test('rien de réglé : aucun env passé à wsl.exe, ligneTache sans options', () => {
  delete process.env.WSLENV;
  appels.length = 0;
  moteur.executer(['true']);
  assert.strictEqual(appels[0].options.env, undefined);
  assert.deepStrictEqual(moteur.ligneTache(['true']), { commande: 'wsl.exe', args: ['-d', 'SZH-Publishing', '--', 'true'] });
  assert.strictEqual(services.environnement({ A: '1' }), null);
});

test('réglé : executer passe les trois variables et WSLENV (noms en /u), le reste de l’env intact', () => {
  delete process.env.WSLENV;
  services.poser({ url: 'https://link.exemple.ch', shlinkCle: CLE_SHLINK, ojsCle: CLE_OJS });
  appels.length = 0;
  moteur.executer(['true']);
  const env = appels[0].options.env;
  assert.strictEqual(env.SZH_SHLINK_URL, 'https://link.exemple.ch');
  assert.strictEqual(env.SZH_SHLINK_CLE, CLE_SHLINK);
  assert.strictEqual(env.SZH_OJS_CLE, CLE_OJS);
  assert.strictEqual(env.WSLENV, 'SZH_SHLINK_URL/u:SZH_SHLINK_CLE/u:SZH_OJS_CLE/u');
  assert.strictEqual(env.PATH || env.Path, process.env.PATH || process.env.Path, 'l’environnement du cockpit est perdu');
});

test('un seul service réglé : seule sa variable est posée, jamais une variable vide', () => {
  services.poser({ url: '', shlinkCle: CLE_SHLINK, ojsCle: '' });
  const env = services.environnement({});
  assert.deepStrictEqual(Object.keys(env).sort(), ['SZH_SHLINK_CLE', 'WSLENV']);
  assert.strictEqual(env.WSLENV, 'SZH_SHLINK_CLE/u');
});

test('WSLENV existant préservé, sans doublon, même appelé deux fois ou déjà porteur du nom', () => {
  services.poser({ url: 'https://l.ch', shlinkCle: CLE_SHLINK, ojsCle: '' });
  const une = services.environnement({ WSLENV: 'FOO/p:SZH_SHLINK_URL/u' });
  assert.strictEqual(une.WSLENV, 'FOO/p:SZH_SHLINK_URL/u:SZH_SHLINK_CLE/u');
  const deux = services.environnement(une);
  assert.strictEqual(deux.WSLENV, une.WSLENV);
});

test('ligneTache : options.env ne porte que les variables posées et WSLENV', () => {
  process.env.WSLENV = 'FOO/p';
  services.poser({ url: 'https://l.ch', shlinkCle: '', ojsCle: CLE_OJS });
  const ligne = moteur.ligneTache(['make'], { cwd: 'C:\\R' });
  assert.deepStrictEqual(ligne.options, { env: {
    SZH_SHLINK_URL: 'https://l.ch', SZH_OJS_CLE: CLE_OJS, WSLENV: 'FOO/p:SZH_SHLINK_URL/u:SZH_OJS_CLE/u' } });
  assert.deepStrictEqual(ligne.args, ['-d', 'SZH-Publishing', '--cd', 'C:\\R', '--', 'make']);
});

test('aucune clé dans la description destinée aux journaux ni dans les arguments de wsl.exe', () => {
  services.poser({ url: 'https://l.ch', shlinkCle: CLE_SHLINK, ojsCle: CLE_OJS });
  const texte = services.description();
  assert.ok(texte.indexOf('SZH_SHLINK_CLE') !== -1, 'les noms doivent se lire');
  assert.ok(texte.indexOf(CLE_SHLINK) === -1 && texte.indexOf(CLE_OJS) === -1, 'une clé fuit : ' + texte);
  appels.length = 0;
  moteur.executer(['true']);
  assert.ok(JSON.stringify(appels[0].args).indexOf(CLE_SHLINK) === -1, 'la clé est dans la ligne de commande');
});

test('une valeur à espaces seuls vaut « absente »', () => {
  services.poser({ url: '   ', shlinkCle: '  ', ojsCle: '' });
  assert.strictEqual(services.environnement({}), null);
});
