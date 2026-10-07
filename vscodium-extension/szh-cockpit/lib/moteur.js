// Le moteur qui exécute la chaîne : la distro WSL du poste. Seul point d'entrée du cockpit
// vers wsl.exe, ses chemins en /mnt et le maintien en vie de la VM (lib/wsl.js).
'use strict';

const cp = require('child_process');
const wsl = require('./wsl');
const poste = require('./poste');
const services = require('./services-env');

const DISTRO = wsl.DISTRO;

// Les arguments de wsl.exe autour d'une commande du moteur. `cwd` passe tel quel à --cd,
// wsl.exe traduisant le chemin Windows (UNC et OneDrive compris). `sansShell` lance par -e :
// avec --, wsl.exe recolle les arguments et les fait relire par le shell, ce qui casse un
// argument contenant une espace ou une apostrophe.
function argsMoteur(argv, cwd, sansShell) {
  const tete = cwd ? ['-d', DISTRO, '--cd', cwd] : ['-d', DISTRO];
  return tete.concat([sansShell ? '-e' : '--'], argv || []);
}

// -> le ChildProcess brut ; l'appelant en lit les issues. Lève si wsl.exe ne se lance pas.
// spawn est lu à l'appel, pour que les tests puissent le remplacer. L'env n'est complété que
// si un service en ligne est réglé (lib/services-env.js) ; un WSLENV existant est gardé.
function executer(argv, options) {
  const o = options || {};
  const opts = { windowsHide: true };
  if (o.stdio !== undefined) { opts.stdio = o.stdio; }
  const env = services.environnement(process.env);
  if (env) { opts.env = env; }
  return cp.spawn(wsl.cheminWsl(), argsMoteur(argv, o.cwd, o.sansShell), opts);
}

// La commande d'une tâche VS Code. wsl.exe y est cherché dans le PATH, comme dans
// tasks.json (executer() le prend dans System32). Les options d'une ProcessExecution sont
// fusionnées à l'env du parent : elles ne portent que les ajouts, et seulement si un
// service est réglé.
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
