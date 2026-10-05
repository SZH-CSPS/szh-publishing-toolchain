// Contrat de vscodium-extension/szh-cockpit/lib/moteur.js : la façade rend les mêmes lancements
// que lib/wsl.js, et elle seule, avec wsl.js, connaît wsl.exe.
//
//   node --test test/js/moteur-contrat.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('node:events');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Un WINDIR connu, pour un chemin de wsl.exe littéral.
const WINDIR_ESSAI = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-windir-'));
fs.mkdirSync(path.join(WINDIR_ESSAI, 'System32'));
fs.writeFileSync(path.join(WINDIR_ESSAI, 'System32', 'wsl.exe'), '');
process.on('exit', () => { try { fs.rmSync(WINDIR_ESSAI, { recursive: true, force: true }); } catch (e) { /* débris */ } });
process.env.WINDIR = WINDIR_ESSAI;
const WSL_SYSTEME = path.join(WINDIR_ESSAI, 'System32', 'wsl.exe');

// spawn remplacé après le chargement : moteur.js doit le lire à l'appel.
const cp = require('child_process');
const moteur = require(path.join(COCKPIT, 'lib', 'moteur.js'));
const spawnReel = cp.spawn;
const appels = [];
cp.spawn = function (commande, args, options) {
  if (!/wsl\.exe$/i.test(String(commande))) { return spawnReel.apply(this, arguments); }
  appels.push({ commande: commande, args: args, options: options });
  const p = new EventEmitter();
  p.stdout = new EventEmitter();
  p.kill = () => {};
  setImmediate(() => { p.emit('exit', 0, null); p.emit('close', 0); });
  return p;
};

test('executer : wsl.exe de System32, --cd seulement avec cwd, aucun env passé', () => {
  appels.length = 0;
  const proc = moteur.executer(['make', 'all'], { cwd: 'C:\\Revue\\essai', stdio: ['ignore', 'pipe', 'ignore'] });
  moteur.executer(['true']);
  assert.ok(proc && typeof proc.on === 'function', 'executer ne rend pas le processus brut');
  assert.deepStrictEqual(appels, [{
    commande: WSL_SYSTEME,
    args: ['-d', 'SZH-Publishing', '--cd', 'C:\\Revue\\essai', '--', 'make', 'all'],
    options: { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
  }, {
    commande: WSL_SYSTEME, args: ['-d', 'SZH-Publishing', '--', 'true'], options: { windowsHide: true }
  }]);
});

test('executer sansShell : -e au lieu de --, pour que chaque argument arrive entier au moteur', () => {
  // Avec --, wsl.exe recolle les arguments et les fait relire par le shell de la distro : un
  // chemin à espace ou à apostrophe s'y casse. -e les passe un à un.
  appels.length = 0;
  moteur.executer(['python3', '-B', '/mnt/c/Users/x/OneDrive - SZH CSPS/l’a.py'], { sansShell: true });
  assert.deepStrictEqual(appels.map((a) => a.args),
    [['-d', 'SZH-Publishing', '-e', 'python3', '-B', '/mnt/c/Users/x/OneDrive - SZH CSPS/l’a.py']]);
});

test('ligneTache : wsl.exe du PATH, la racine Windows telle quelle', () => {
  assert.deepStrictEqual(moteur.ligneTache(['make', '-j2'], { cwd: 'C:\\Revue\\essai' }), {
    commande: 'wsl.exe', args: ['-d', 'SZH-Publishing', '--cd', 'C:\\Revue\\essai', '--', 'make', '-j2']
  });
});

test('versMoteur et toolkitMoteur rendent les chemins de lib/poste.js', () => {
  const poste = require(path.join(COCKPIT, 'lib', 'poste.js'));
  assert.strictEqual(moteur.versMoteur('C:\\Revue\\a.jpg'), '/mnt/c/Revue/a.jpg');
  assert.strictEqual(moteur.toolkitMoteur('pipeline', 'Makefile'), poste.toolkitWsl('pipeline', 'Makefile'));
  assert.strictEqual(moteur.DISTRO, 'SZH-Publishing');
});

// Le jour où le moteur change, seuls moteur.js et wsl.js ont à changer.
const PERMIS = [path.join('lib', 'moteur.js'), path.join('lib', 'wsl.js')];

function fautesMoteur(relatif) {
  const motifs = [/(['"`])wsl\.exe\1/, /\bcheminWsl\b/, /require\(\s*['"]\.\/(lib\/)?wsl['"]\s*\)/];
  const lignes = fs.readFileSync(path.join(COCKPIT, relatif), 'utf8').split(/\r?\n/);
  const fautes = [];
  lignes.forEach((ligne, i) => {
    if (ligne.trim().startsWith('//')) { return; }
    if (motifs.some((m) => m.test(ligne))) { fautes.push(relatif + ':' + (i + 1)); }
  });
  return fautes;
}

test('ni wsl.exe, ni cheminWsl, ni lib/wsl.js hors de moteur.js et wsl.js', () => {
  const fichiers = ['extension.js'];
  (function parcourir(dossier) {
    for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) { parcourir(chemin); continue; }
      if (entree.name.endsWith('.js')) { fichiers.push(path.relative(COCKPIT, chemin)); }
    }
  })(path.join(COCKPIT, 'lib'));
  const fautifs = [];
  for (const relatif of fichiers) {
    if (PERMIS.indexOf(relatif) !== -1) { continue; }
    fautifs.push(...fautesMoteur(relatif));
  }
  assert.deepStrictEqual(fautifs, [], 'lancement de WSL hors de lib/moteur.js : ' + fautifs.join(', '));
});
