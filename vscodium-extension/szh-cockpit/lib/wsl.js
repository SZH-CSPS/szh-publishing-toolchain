// Garde la distro WSL allumée tant qu'une revue est ouverte, pour éviter un démarrage à
// froid à chaque compilation.
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const { cheminSysteme } = require('./poste');

// Chaque compilation est un `wsl.exe` de courte durée : entre deux, la VM s'éteindrait
// (vmIdleTimeout). Un processus `sleep` occupe la distro sans rien consommer.

// Même nom que dans vscodium-user/tasks.json et szh-common.ps1.
const DISTRO = 'SZH-Publishing';

let dormeurWsl = null;

function cheminWsl() {
  const systeme = cheminSysteme('wsl.exe');
  try { if (fs.existsSync(systeme)) { return systeme; } } catch (e) { /* PATH en repli */ }
  return 'wsl.exe';
}

function demarrerDormeurWsl() {
  if (dormeurWsl) { return; }                      // un seul dormant à la fois
  let proc;
  try {
    proc = spawn(cheminWsl(), ['-d', DISTRO, '--', 'sh', '-c', 'exec sleep infinity'],
      { windowsHide: true, stdio: 'ignore' });
  } catch (e) { return; }                          // wsl introuvable : poste non préparé
  dormeurWsl = proc;
  // Distro absente ou wsl en erreur : on se tait pour ne pas bloquer l'activation, et on
  // réessaie au prochain changement de contexte.
  proc.on('error', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
  proc.on('exit', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
}

function arreterDormeurWsl() {
  if (!dormeurWsl) { return; }
  const proc = dormeurWsl;
  dormeurWsl = null;                               // avant kill : l'écouteur exit ne re-nettoie pas
  try { proc.kill(); } catch (e) { /* déjà mort */ }
}

// Démarre la distro et résout quand elle répond, pour que l'attente se voie à l'activation
// plutôt qu'à la première compilation. Ne rejette pas ; résout au plus tard après `timeoutMs`.
function reveillerWsl(timeoutMs) {
  const limite = timeoutMs || 60000;
  return new Promise((resolve) => {
    let fini = false, minuteur = null;
    const finir = () => { if (fini) { return; } fini = true; if (minuteur) { clearTimeout(minuteur); } resolve(); };
    let proc;
    try {
      proc = spawn(cheminWsl(), ['-d', DISTRO, '--', 'true'], { windowsHide: true, stdio: 'ignore' });
    } catch (e) { resolve(); return; }             // wsl introuvable : poste non préparé
    minuteur = setTimeout(finir, limite);
    proc.on('error', finir);
    proc.on('exit', finir);
  });
}

module.exports = {
  DISTRO, cheminWsl, demarrerDormeurWsl, arreterDormeurWsl, reveillerWsl };
