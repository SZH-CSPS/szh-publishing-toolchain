// demarrerDormeurWsl / arreterDormeurWsl / reveillerWsl (lib/wsl.js) n'ont aucun test dans le
// dépôt : test/js/hote-factice.js les neutralise systématiquement (son crochet Module._load
// remplace les trois par des no-op dès qu'un autre module requiert lib/wsl.js), justement
// pour qu'aucun test ne garde une VM WSL en vie ni ne la réveille pour de vrai — mais ça
// veut dire que le VRAI comportement de ces trois fonctions n'est éprouvé nulle part.
//
// lib/wsl.js n'a aucune dépendance à `vscode` : il se charge seul, sans hote-factice.js.
// Même ruse d'injection que test/js/portraits-traitement.test.js — patch de
// `require('child_process').spawn` posé avant le premier require du module, avec un
// indirecteur (`impl`) réglable par test.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { EventEmitter } = require('node:events');

const cp = require('child_process');
const spawnReel = cp.spawn;
const appels = [];
let impl = null;
cp.spawn = function (commande, args, options) {
  appels.push({ commande: commande, args: args, options: options });
  if (impl) { return impl(commande, args, options); }
  return spawnReel(commande, args, options);
};

const wsl = require(path.join(__dirname, '..', '..',
  'vscodium-extension', 'szh-cockpit', 'lib', 'wsl'));

function fauxProcessus() {
  const p = new EventEmitter();
  p.tue = false;
  // kill() émet 'exit' de façon asynchrone, comme un vrai process tué par signal.
  p.kill = () => { p.tue = true; setImmediate(() => p.emit('exit', null, 'SIGTERM')); };
  return p;
}

test('demarrerDormeurWsl : un seul dormeur à la fois', () => {
  appels.length = 0;
  impl = () => fauxProcessus();
  wsl.demarrerDormeurWsl();
  wsl.demarrerDormeurWsl();
  wsl.demarrerDormeurWsl();
  assert.strictEqual(appels.length, 1,
    'un second (ou un troisième) dormeur a été lancé alors qu’un premier tournait déjà');
  wsl.arreterDormeurWsl();
});

test('arreterDormeurWsl : tue le dormeur, et un nouveau démarrage en relance vraiment un',
  () => {
    appels.length = 0;
    let dernier = null;
    impl = () => { dernier = fauxProcessus(); return dernier; };

    wsl.demarrerDormeurWsl();
    assert.strictEqual(appels.length, 1);
    assert.strictEqual(dernier.tue, false);

    wsl.arreterDormeurWsl();
    assert.strictEqual(dernier.tue, true, 'arreterDormeurWsl n’a pas tué le processus');

    wsl.demarrerDormeurWsl();
    assert.strictEqual(appels.length, 2,
      'après arrêt, un nouveau démarrage n’a relancé aucun processus');
    wsl.arreterDormeurWsl();
  });

test('arreterDormeurWsl : sans dormeur en cours, ne fait rien (pas de kill sur du vide)',
  () => {
    appels.length = 0;
    assert.doesNotThrow(() => wsl.arreterDormeurWsl());
    assert.strictEqual(appels.length, 0);
  });

test('demarrerDormeurWsl : wsl.exe introuvable (throw synchrone) -> silencieux, pas de throw',
  () => {
    appels.length = 0;
    impl = () => { const e = new Error('spawn wsl.exe ENOENT'); e.code = 'ENOENT'; throw e; };
    assert.doesNotThrow(() => wsl.demarrerDormeurWsl());

    // Rien n'est resté « démarré » à tort : un appel suivant retente pour de bon, au lieu de
    // croire qu'un dormeur tourne déjà.
    impl = () => fauxProcessus();
    wsl.demarrerDormeurWsl();
    assert.strictEqual(appels.length, 2,
      'l’échec précédent a été pris pour un dormeur toujours vivant');
    wsl.arreterDormeurWsl();
  });

test('demarrerDormeurWsl : le dormeur répond « error » de façon asynchrone -> se libère',
  () => {
    appels.length = 0;
    let p = null;
    impl = () => { p = fauxProcessus(); return p; };

    wsl.demarrerDormeurWsl();
    assert.strictEqual(appels.length, 1);
    p.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

    // Le dormeur précédent s'est décroché de lui-même : un nouveau démarrage relance un vrai
    // processus, au lieu de croire l'ancien encore vivant.
    wsl.demarrerDormeurWsl();
    assert.strictEqual(appels.length, 2,
      'demarrerDormeurWsl n’a pas retenté après l’erreur asynchrone du dormeur précédent');
    wsl.arreterDormeurWsl();
  });

test('reveillerWsl : résout quand le processus sort', async () => {
  appels.length = 0;
  impl = () => { const p = fauxProcessus(); setImmediate(() => p.emit('exit', 0, null)); return p; };
  await wsl.reveillerWsl(1000);
  assert.strictEqual(appels.length, 1);
});

test('reveillerWsl : wsl.exe introuvable -> résout quand même, ne rejette jamais', async () => {
  appels.length = 0;
  impl = () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); };
  await wsl.reveillerWsl(1000);   // ne doit pas lever
});

test('reveillerWsl : erreur asynchrone du processus -> résout quand même', async () => {
  appels.length = 0;
  impl = () => {
    const p = fauxProcessus();
    setImmediate(() => p.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
    return p;
  };
  await wsl.reveillerWsl(1000);
});

test('reveillerWsl : processus muet -> résout au bout du délai, pas avant ni jamais', async () => {
  appels.length = 0;
  impl = () => fauxProcessus();   // n'émet ni 'exit' ni 'error'
  const debut = Date.now();
  await wsl.reveillerWsl(80);
  assert.ok(Date.now() - debut >= 70, 'reveillerWsl a résolu avant son propre délai');
});
