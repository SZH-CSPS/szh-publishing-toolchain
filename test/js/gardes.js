// Une seule détection par outil externe, faite une fois par processus, partagée par tous
// les fichiers de test qui en ont besoin — au lieu de la recopier (14 fois pour PowerShell
// avant ce module, avec le risque qu'une copie diverge des autres sans que rien ne le dise).
//
// Chaque « sansX » vaut `false` si l'outil est là, sinon une chaîne (le motif du skip),
// utilisable telle quelle en `{ skip: sansX }`. Par défaut un outil absent fait sauter le
// test — mais un poste de release ne doit pas pouvoir « réussir » simplement parce que la
// moitié des contrôles s'est tue : poser la variable d'environnement correspondante
// (SZH_PS_OBLIGATOIRE, SZH_PYTHON_OBLIGATOIRE, SZH_WSL_OBLIGATOIRE, SZH_PANDOC_OBLIGATOIRE)
// fait ÉCHOUER le chargement de ce module au lieu de sauter, dès qu'un outil qu'elle couvre
// manque. C'est délibérément un échec au chargement (avant le premier `test()`) : la forme
// la plus simple qui rende quelque chose de rouge, sans machinerie par test.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// ---- PowerShell (Windows uniquement) --------------------------------------------------
// Même détection que les 16 fichiers qui la recopiaient : le powershell.exe du système
// d'abord (jamais celui, éventuel, du PATH d'un profil qui l'aurait masqué), sinon celui du
// PATH.
function detecterPowerShell() {
  if (process.platform !== 'win32') { return ''; }
  const candidats = [path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe'];
  for (const c of candidats) {
    const essai = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) { return c; }
  }
  return '';
}

// ---- Python (Windows et ailleurs) ------------------------------------------------------
// `python3` en premier peut tomber sur l'alias d'exécution de WindowsApps quand aucun
// Python n'est installé : ce lanceur peut rester accroché (tentative d'ouverture du Store)
// au lieu de rendre la main, ce qui gèlerait toute la suite derrière lui. `python` n'est pas
// concerné sur les postes de la maison, on l'essaie donc en premier ; `python3` n'est tenté
// qu'en repli, et jamais nu — borné par un délai, pour qu'un blocage devienne un simple
// « absent » plutôt qu'un processus de test qui ne rend jamais la main.
function detecterPython() {
  for (const commande of ['python', 'python3']) {
    let r;
    try {
      r = spawnSync(commande, ['--version'],
        { encoding: 'utf8', timeout: 5000, windowsHide: true });
    } catch (e) {
      continue;
    }
    if (r.error || r.signal) { continue; } // r.signal : tué par le délai (le stub qui traîne)
    if (/Python 3/.test(String(r.stdout || '') + String(r.stderr || ''))) { return commande; }
  }
  return '';
}

// ---- pandoc + python3 dans la distro WSL SZH-Publishing --------------------------------
// Reprend telle quelle la détection de test/js/biblio.test.js (pandocAbsent) : ce n'est pas
// le python3 de Windows (ci-dessus) qui est en jeu ici, mais celui, réel, de la distro
// Linux — sans son risque de blocage.
const DISTRO = 'SZH-Publishing';
function detecterPandocWsl() {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const exe = fs.existsSync(wslExe) ? wslExe : 'wsl.exe';
  let r;
  try {
    r = spawnSync(exe, ['-d', DISTRO, '--', 'sh', '-c', 'command -v pandoc && command -v python3'],
      { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  } catch (e) {
    return 'wsl.exe injoignable : ' + e.message;
  }
  if (r.error) { return 'wsl.exe injoignable : ' + r.error.message; }
  if (r.status !== 0) { return 'pandoc ou python3 introuvable dans la distro ' + DISTRO; }
  return null;
}

// ---- pandoc du PATH Windows -------------------------------------------------------------
// Reprend la détection de test/js/reimport-biblio.test.js (pandocAbsent) : le pandoc lancé
// directement, jamais via wsl.exe — celui que filtres-pandoc.test.js utilise aussi.
function detecterPandoc() {
  try {
    const r = spawnSync('pandoc', ['--version'], { encoding: 'utf8' });
    return (!r.error && r.status === 0) ? null : 'pandoc introuvable sur ce poste';
  } catch (e) {
    return 'pandoc introuvable sur ce poste (' + e.message + ')';
  }
}

const POWERSHELL = detecterPowerShell();
const PYTHON = detecterPython();
const _motifPandocWsl = detecterPandocWsl();
const _motifPandoc = detecterPandoc();

// Bascule un skip en échec quand l'outil est déclaré obligatoire : sans ce contrôle, poser
// la variable sur un poste où l'outil manque encore « réussirait » silencieusement — les
// tests couverts se contenteraient de sauter, comme d'habitude.
function exiger(variable, motif) {
  if (motif && process.env[variable]) {
    throw new Error(motif + ' — ' + variable + ' est posé : cet outil est déclaré '
      + 'obligatoire, sauter le contrôle est refusé.');
  }
  return motif;
}

const sansPowerShell = exiger('SZH_PS_OBLIGATOIRE', POWERSHELL ? false : 'powershell.exe indisponible');
const sansPython = exiger('SZH_PYTHON_OBLIGATOIRE',
  PYTHON ? false : 'aucun interprète Python 3 trouvé (python, puis python3)');
const sansPandocWsl = exiger('SZH_WSL_OBLIGATOIRE', _motifPandocWsl === null ? false : _motifPandocWsl);
const sansPandoc = exiger('SZH_PANDOC_OBLIGATOIRE', _motifPandoc === null ? false : _motifPandoc);

module.exports = { POWERSHELL, sansPowerShell, PYTHON, sansPython, sansPandocWsl, sansPandoc, exiger };
