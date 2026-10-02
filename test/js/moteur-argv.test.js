// Caractérisation des lancements de wsl.exe : le triplet (commande, args, options) que
// chaque site construit, figé tel quel pour que l'abstraction du moteur n'en change rien.
//
//   node --test test/js/moteur-argv.test.js
//
// Le chapitre d'un livre se fige dans moteur-argv-livre.test.js : un seul hôte par processus.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Avant tout require du cockpit : un toolkit et un WINDIR connus, pour des chemins littéraux.
// Le faux System32 porte un wsl.exe, sans quoi les spawn retomberaient sur celui du PATH.
const WINDIR_ESSAI = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-windir-'));
fs.mkdirSync(path.join(WINDIR_ESSAI, 'System32'));
fs.writeFileSync(path.join(WINDIR_ESSAI, 'System32', 'wsl.exe'), '');
process.on('exit', () => { try { fs.rmSync(WINDIR_ESSAI, { recursive: true, force: true }); } catch (e) { /* débris */ } });
process.env.WINDIR = WINDIR_ESSAI;
process.env.SZH_TOOLKIT = 'C:\\SZH-essai\\toolkit';
const WSL_SYSTEME = path.join(WINDIR_ESSAI, 'System32', 'wsl.exe');
const TK = '/mnt/c/SZH-essai/toolkit';
const DISTRO = 'SZH-Publishing';

// spawn intercepté avant tout chargement : plusieurs modules le prennent par déstructuration.
// Seuls les lancements de wsl.exe sont simulés, le reste part au vrai spawn.
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

// Le vrai module, requis avant l'hôte : son crochet ne neutralise que les chargements suivants.
const wsl = require(path.join(COCKPIT, 'lib', 'wsl.js'));

const { revueDEssai, activerHote } = require('./hote-factice');
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));

const tick = () => new Promise((r) => setImmediate(r));
const STDIO_LECTURE = { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] };
const STDIO_MUET = { windowsHide: true, stdio: 'ignore' };

function viderAppels() { appels.length = 0; sortieFactice = ''; }

// Les tâches que le cockpit construit lui-même : la ProcessExecution capturée à l'envol.
async function capturerTache(jouer) {
  const origine = HOTE.stub.tasks.executeTask;
  let tache = null;
  HOTE.stub.tasks.executeTask = (t) => { tache = t; return origine(t); };
  try {
    const p = jouer();
    for (let i = 0; i < 5 && !tache; i++) { await tick(); }
    await tick();   // lancerTacheObjet s'abonne à la fin après l'envol
    assert.ok(tache, 'aucune tâche lancée');
    HOTE.finirTache(tache.name, 0);
    await p;
  } finally {
    HOTE.stub.tasks.executeTask = origine;
  }
  const e = tache.execution;
  return { commande: e.process, args: e.args, options: e.options };
}

test('dormeur : wsl.exe de System32, sleep infinity, sans sortie lue', () => {
  viderAppels();
  wsl.demarrerDormeurWsl();
  wsl.arreterDormeurWsl();
  assert.deepStrictEqual(appels, [{
    commande: WSL_SYSTEME,
    args: ['-d', DISTRO, '--', 'sh', '-c', 'exec sleep infinity'],
    options: STDIO_MUET
  }]);
});

test('réveil : wsl.exe de System32, true, sans sortie lue', async () => {
  viderAppels();
  await wsl.reveillerWsl(5000);
  assert.deepStrictEqual(appels, [{
    commande: WSL_SYSTEME, args: ['-d', DISTRO, '--', 'true'], options: STDIO_MUET
  }]);
});

test('portraits : interprète du venv, script du toolkit, chemins en /mnt', async () => {
  viderAppels();
  sortieFactice = JSON.stringify({ slug: 'anne-dupont', ok: true }) + '\n';
  const { traiterPortraits } = require(path.join(COCKPIT, 'lib', 'portraits.js'));
  await traiterPortraits({
    dossierPortraits: 'C:\\Revue\\portraits',
    entrees: [{ slug: 'anne-dupont', cheminSource: 'C:\\Revue\\portraits\\anne.jpg' }]
  });
  assert.deepStrictEqual(appels, [{
    commande: WSL_SYSTEME,
    args: ['-d', DISTRO, '--', '/opt/portraits/bin/python', TK + '/pipeline/portraits.py',
      '/mnt/c/Revue/portraits', 'anne-dupont', '/mnt/c/Revue/portraits/anne.jpg'],
    options: STDIO_LECTURE
  }]);
});

test('cmyk : interprète du venv, script du toolkit, une image', async () => {
  viderAppels();
  sortieFactice = JSON.stringify({ chemin: 'image.jpg', ok: true }) + '\n';
  const { convertirCmykEnRgb } = require(path.join(COCKPIT, 'lib', 'cmyk.js'));
  // Un JPEG dont le SOF0 déclare quatre composantes, désigné par un nom sans dossier :
  // la conversion en /mnt le laisse tel quel, ce qui garde l'attendu littéral.
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-cmyk-'));
  const sof = Buffer.alloc(22);
  Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x14, 0x08, 0x00, 0x10, 0x00, 0x10, 0x04]).copy(sof);
  fs.writeFileSync(path.join(dossier, 'image.jpg'), sof);
  const cwd = process.cwd();
  let promesse;
  try {
    process.chdir(dossier);
    promesse = convertirCmykEnRgb({ chemins: ['image.jpg'] });
  } finally {
    process.chdir(cwd);
  }
  await promesse;
  fs.rmSync(dossier, { recursive: true, force: true });
  assert.deepStrictEqual(appels, [{
    commande: WSL_SYSTEME,
    args: ['-d', DISTRO, '--', '/opt/portraits/bin/python', TK + '/pipeline/cmyk-rgb.py', 'image.jpg'],
    options: STDIO_LECTURE
  }]);
});

test('pagination : --cd reçoit la racine Windows telle quelle, make nu puis bash -c tee', async () => {
  const pagination = require(path.join(COCKPIT, 'lib', 'pagination-hote.js'));
  viderAppels();
  await pagination.lireEtat(REVUE, ['01-essai']).catch(() => null);
  await pagination.rafraichir(REVUE, ['01-essai']);
  assert.deepStrictEqual(appels, [{
    commande: WSL_SYSTEME,
    args: ['-d', DISTRO, '--cd', REVUE, '--', 'make', '-f', TK + '/pipeline/Makefile',
      'etat-pagination', 'ORDRE=01-essai'],
    options: STDIO_LECTURE
  }, {
    commande: WSL_SYSTEME,
    args: ['-d', DISTRO, '--cd', REVUE, '--', 'bash', '-c',
      "set -o pipefail; make -f '" + TK + "/pipeline/Makefile' rafraichir-pagination "
      + 'ORDRE=01-essai 2>&1 | tee .szh-journal.log'],
    options: STDIO_LECTURE
  }]);
});

test('pdfua : verifier-ua.sh sur les PDF présents, chemins relatifs à la racine', async () => {
  const pdfua = require(path.join(COCKPIT, 'lib', 'pdfua-hote.js'));
  const [slug] = HOTE.arbre().listerArticles();
  const pdf = path.join(REVUE, 'out', slug, slug + '.pdf');
  fs.mkdirSync(path.dirname(pdf), { recursive: true });
  fs.writeFileSync(pdf, '%PDF-1.7\n');
  viderAppels();
  try {
    await pdfua.planifier(REVUE);
  } finally {
    fs.rmSync(path.join(REVUE, 'out'), { recursive: true, force: true });
  }
  assert.deepStrictEqual(appels, [{
    commande: WSL_SYSTEME,
    args: ['-d', DISTRO, '--cd', REVUE, '--', 'bash', TK + '/pipeline/verifier-ua.sh', '-',
      'out/' + slug + '/' + slug + '.pdf'],
    options: STDIO_LECTURE
  }]);
});

// La fiche d'essai ne nomme aucun Word : la chaîne refuserait, donc le Word se choisit
// avant la confirmation et part en appariement forcé.
test('réimport : python3 reimporter.py, la sortie standard lue', async () => {
  const [slug] = HOTE.arbre().listerArticles();
  const depot = path.join(REVUE, 'articles-word');
  fs.mkdirSync(depot, { recursive: true });
  const word = path.join(depot, 'essai-corrige.docx');
  fs.writeFileSync(word, '');
  try {
    viderAppels();
    HOTE.repondreQuickPick('essai-corrige.docx');
    HOTE.repondreModale(T('modale.reimport.bouton'));
    await HOTE.executer('szh.reimporterArticle', { slug: slug });
    assert.deepStrictEqual(appels, [{
      commande: WSL_SYSTEME,
      args: ['-d', DISTRO, '--cd', REVUE, '--', 'python3', TK + '/pipeline/reimporter.py',
        '--article', slug, '--word', 'essai-corrige.docx'],
      options: STDIO_LECTURE
    }]);
  } finally { fs.rmSync(word, { force: true }); }
});

test('export d’un article : tâche wsl.exe du PATH, make -j2 -O sur le PDF et l’aperçu', async () => {
  const [slug] = HOTE.arbre().listerArticles();
  const dossierOut = path.join(REVUE, 'out', slug);
  fs.mkdirSync(dossierOut, { recursive: true });
  fs.writeFileSync(path.join(dossierOut, slug + '.pdf'), 'PDF factice');
  fs.writeFileSync(path.join(dossierOut, slug + '.apercu.html'), '<p>aperçu factice</p>');
  viderAppels();
  let triplet;
  try {
    triplet = await capturerTache(() => HOTE.executer('szh.exporterArticle', { slug: slug }));
  } finally {
    fs.rmSync(path.join(REVUE, 'out'), { recursive: true, force: true });
  }
  assert.deepStrictEqual(triplet, {
    commande: 'wsl.exe',
    args: ['-d', DISTRO, '--cd', REVUE, '--', 'make', '-j2', '-O', '-f', TK + '/pipeline/Makefile',
      'out/' + slug + '/' + slug + '.pdf', 'out/' + slug + '/' + slug + '.apercu.html'],
    options: undefined
  });
});
