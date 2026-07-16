// SZH cockpit — maintien en vie de WSL (N1, D42). Extrait de extension.js (R6).
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ---- Maintien en vie de WSL (N1, D42) ---------------------------------------------
//
// Les builds sont des `wsl.exe` éphémères : entre deux Ctrl+S la VM WSL s'éteint
// (vmIdleTimeout) et la compilation suivante paie un démarrage à froid. Tant qu'une
// revue est ouverte, on maintient un processus DORMANT dans la distro du pipeline —
// il ne consomme rien et empêche l'extinction de la VM. Tué quand on quitte la
// revue, à la désactivation, et de toute façon nettoyé par un `wsl --shutdown`/reboot.

// ⚠ Doit correspondre à la distro de vscodium-user/tasks.json et szh-common.ps1.
const DISTRO = 'SZH-Publishing';

let dormeurWsl = null;

// wsl.exe : System32 en priorité (chemin sûr), PATH en repli.
function cheminWsl() {
  const systeme = path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'wsl.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'wsl.exe';
}

function demarrerDormeurWsl() {
  if (dormeurWsl) { return; }                      // un seul dormant à la fois
  let proc;
  try {
    proc = spawn(cheminWsl(), ['-d', DISTRO, '--', 'sh', '-c', 'exec sleep infinity'],
      { windowsHide: true, stdio: 'ignore' });
  } catch (e) { return; }                          // wsl introuvable : poste non bootstrappé
  dormeurWsl = proc;
  // Distro absente ou wsl en erreur : silencieux (l'activation ne doit jamais être
  // bloquée ni bruyante) ; on retentera au prochain changement de contexte.
  proc.on('error', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
  proc.on('exit', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
}

function arreterDormeurWsl() {
  if (!dormeurWsl) { return; }
  const proc = dormeurWsl;
  dormeurWsl = null;                               // avant kill : l'écouteur exit ne re-nettoie pas
  try { proc.kill(); } catch (e) { /* déjà mort */ }
}

module.exports = { demarrerDormeurWsl, arreterDormeurWsl };
