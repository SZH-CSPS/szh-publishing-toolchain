// Maintien en vie de la distro WSL du pipeline, pour que les compilations ne paient
// pas un démarrage à froid.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Les compilations sont des `wsl.exe` éphémères : entre deux enregistrements la VM
// s'éteint (vmIdleTimeout) et la suivante repart à froid. Tant qu'une revue est ouverte,
// un processus dormant occupe la distro sans rien consommer et empêche l'extinction.

// ⚠ Doit correspondre à la distro de vscodium-user/tasks.json et szh-common.ps1.
const DISTRO = 'SZH-Publishing';

let dormeurWsl = null;

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
  } catch (e) { return; }                          // wsl introuvable : poste non préparé
  dormeurWsl = proc;
  // Distro absente ou wsl en erreur : silencieux, l'activation ne doit pas être
  // bloquée ; on retentera au prochain changement de contexte.
  proc.on('error', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
  proc.on('exit', () => { if (dormeurWsl === proc) { dormeurWsl = null; } });
}

function arreterDormeurWsl() {
  if (!dormeurWsl) { return; }
  const proc = dormeurWsl;
  dormeurWsl = null;                               // avant kill : l'écouteur exit ne re-nettoie pas
  try { proc.kill(); } catch (e) { /* déjà mort */ }
}

// Force le démarrage de la distro et résout quand elle répond, pour que l'activation
// affiche l'attente au lieu de la subir à la première compilation. Ne rejette pas : au
// pire on résout au bout de `timeoutMs` plutôt que de bloquer l'activation.
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
