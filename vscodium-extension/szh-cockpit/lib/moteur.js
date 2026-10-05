// Le moteur qui exécute la chaîne : aujourd'hui la distro WSL du poste. Seul point d'entrée
// du cockpit vers wsl.exe, ses chemins en /mnt et le maintien en vie de la VM (lib/wsl.js).
'use strict';

const cp = require('child_process');
const wsl = require('./wsl');
const poste = require('./poste');
const services = require('./services-env');

const DISTRO = wsl.DISTRO;

// Les arguments de wsl.exe autour d'une commande du moteur. `cwd` passe tel quel à --cd :
// c'est wsl.exe qui traduit le chemin Windows, UNC et OneDrive compris. `sansShell` lance la
// commande par -e : avec --, wsl.exe recolle les arguments et les fait relire par le shell de la
// distro, où un argument à espace ou à apostrophe se casse.
function argsMoteur(argv, cwd, sansShell) {
  const tete = cwd ? ['-d', DISTRO, '--cd', cwd] : ['-d', DISTRO];
  return tete.concat([sansShell ? '-e' : '--'], argv || []);
}

// -> le ChildProcess brut, à l'appelant d'en lire les issues. Lève si wsl.exe ne se lance
// pas. spawn est lu à l'appel, pour que les tests qui le remplacent soient vus. L'env du
// processus n'est complété que si un service en ligne est réglé (lib/services-env.js) : sinon il
// n'est pas touché, et WSLENV existant est toujours gardé.
function executer(argv, options) {
  const o = options || {};
  const opts = { windowsHide: true };
  if (o.stdio !== undefined) { opts.stdio = o.stdio; }
  const env = services.environnement(process.env);
  if (env) { opts.env = env; }
  return cp.spawn(wsl.cheminWsl(), argsMoteur(argv, o.cwd, o.sansShell), opts);
}

// La commande d'une tâche VS Code. wsl.exe y est cherché dans le PATH, comme dans
// tasks.json, et non dans System32 comme pour executer(). Les options (celles d'une
// ProcessExecution, fusionnées à l'env du parent) ne portent que les ajouts, et n'existent que
// si un service est réglé.
function ligneTache(argv, options) {
  const o = options || {};
  const ligne = { commande: 'wsl.exe', args: argsMoteur(argv, o.cwd) };
  const plus = services.ajouts(process.env);
  if (plus) { ligne.options = { env: plus }; }
  return ligne;
}

function reveiller(timeoutMs) { return wsl.reveillerWsl(timeoutMs); }
function demarrerDormeur() { return wsl.demarrerDormeurWsl(); }
function arreterDormeur() { return wsl.arreterDormeurWsl(); }

// Un chemin du poste vu depuis le moteur, et un chemin du toolkit dans le moteur.
function versMoteur(chemin) { return poste.versWsl(chemin); }
function toolkitMoteur(...segments) { return poste.toolkitWsl(...segments); }

module.exports = {
  DISTRO, executer, ligneTache, reveiller, demarrerDormeur, arreterDormeur,
  versMoteur, toolkitMoteur };
