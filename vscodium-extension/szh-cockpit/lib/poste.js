// Les chemins et dossiers du poste : base SZH, toolkit, forme WSL, dossiers de l'utilisateur
// et de Windows. Seul module du cockpit qui lit LOCALAPPDATA, USERPROFILE, APPDATA et WINDIR.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const BASE_DEFAUT = 'C:\\ProgramData\\SZH';

// Lu à chaque appel : SZH_BASE peut être posée après le chargement du module (les tests le
// font).
function basePoste() {
  const surcharge = String(process.env.SZH_BASE || '').trim();
  return surcharge || BASE_DEFAUT;
}

// Tout arrive par les paramètres. Ordre : SZH_TOOLKIT ; sinon la racine du dépôt si
// pipeline/Makefile se trouve trois niveaux au-dessus de dossierModule ; sinon <base>/toolkit.
function resoudreToolkit(env, dossierModule, existe) {
  const surcharge = String((env && env.SZH_TOOLKIT) || '').trim();
  if (surcharge) { return surcharge; }
  const racineDepot = path.resolve(dossierModule, '..', '..', '..');
  if (existe(path.join(racineDepot, 'pipeline', 'Makefile'))) { return racineDepot; }
  const base = String((env && env.SZH_BASE) || '').trim() || BASE_DEFAUT;
  return path.join(base, 'toolkit');
}

// Lu à chaque appel, comme basePoste().
function toolkitPoste() {
  return resoudreToolkit(process.env, __dirname, fs.existsSync);
}

// Lettre de lecteur en minuscule, antislashs convertis, chemin UNC laissé sans préfixe
// /mnt/.
function versWsl(chemin) {
  const c = String(chemin || '');
  const m = c.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) { return c.replace(/\\/g, '/'); }
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}

function toolkitWsl(...segments) {
  return [versWsl(toolkitPoste()), ...segments].join('/');
}

// Les dossiers de l'utilisateur, lus à l'appel comme basePoste().
// %LOCALAPPDATA%, ou son emplacement habituel sous le profil quand la variable manque.
function racineUtilisateur() {
  const v = String(process.env.LOCALAPPDATA || '').trim();
  return v || path.join(os.homedir(), 'AppData', 'Local');
}

// %USERPROFILE%, ou '' : le masquage des rapports d'erreur ne doit pas deviner.
function dossierProfil() {
  return process.env.USERPROFILE || '';
}

// Le Bureau de la personne, redirection OneDrive comprise, lu par GetFolderPath en UTF-8
// (reg query écrit dans la page de code OEM, qui abîme un chemin accentué). Lu une fois par
// processus, sans bloquer l'hôte ; à défaut <profil>\Desktop. -> Promise<string>
function lireBureauSysteme() {
  if (process.platform !== 'win32') { return Promise.resolve(''); }
  const script = "[Console]::OutputEncoding=[Text.Encoding]::UTF8;[Environment]::GetFolderPath('Desktop')";
  return new Promise((resoudre) => {
    execFile(cheminSysteme('WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { encoding: 'utf8', windowsHide: true, timeout: 10000 },
      (err, sortie) => resoudre(err ? '' : String(sortie || '')));
  });
}

let lecteurBureau = lireBureauSysteme;
let bureauLu = null;
// Les tests posent leur propre lecture ; null remet celle du système.
function poserLecteurBureau(f) { lecteurBureau = f || lireBureauSysteme; bureauLu = null; }

async function dossierBureau() {
  if (bureauLu === null) {
    bureauLu = Promise.resolve().then(() => lecteurBureau())
      .then((v) => String(v === undefined || v === null ? '' : v).trim(), () => '');
  }
  const lu = await bureauLu;
  return lu && path.isAbsolute(lu) ? lu : path.join(dossierProfil() || process.env.HOME || '', 'Desktop');
}

// Le dossier de configuration de VSCodium (%APPDATA%\VSCodium), où vit argv.json.
function dossierEditeur() {
  return path.join(process.env.APPDATA || '', 'VSCodium');
}

// Le dossier de Windows, et un exécutable de System32 par chemin absolu, pour ne pas
// dépendre du PATH.
function dossierWindows() {
  return process.env.WINDIR || 'C:\\Windows';
}
function cheminSysteme(...segments) {
  return path.join(dossierWindows(), 'System32', ...segments);
}

module.exports = {
  basePoste, resoudreToolkit, toolkitPoste, versWsl, toolkitWsl,
  racineUtilisateur, dossierProfil, dossierBureau, poserLecteurBureau, dossierEditeur, dossierWindows,
  cheminSysteme };
