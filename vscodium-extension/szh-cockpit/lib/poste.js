// Les chemins et dossiers du poste : base SZH, toolkit, forme WSL, dossiers de l'utilisateur
// et de Windows. Seul module du cockpit à lire LOCALAPPDATA, USERPROFILE, APPDATA et WINDIR.
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const BASE_DEFAUT = 'C:\\ProgramData\\SZH';

// Jamais une constante de module : SZH_BASE peut être posée après le chargement (les
// tests le font), et une valeur figée au require ne la verrait plus jamais.
function basePoste() {
  const surcharge = String(process.env.SZH_BASE || '').trim();
  return surcharge || BASE_DEFAUT;
}

// Fonction pure — tout lui arrive par ses paramètres, rien n'est lu sur process.env ni
// sur le disque — pour rester éprouvable dans ses trois branches sans poser ni retirer
// de variable d'environnement réelle. Ordre : SZH_TOOLKIT ; sinon la racine du dépôt si
// pipeline/Makefile s'y trouve trois crans au-dessus de dossierModule ; sinon <base>/toolkit.
function resoudreToolkit(env, dossierModule, existe) {
  const surcharge = String((env && env.SZH_TOOLKIT) || '').trim();
  if (surcharge) { return surcharge; }
  const racineDepot = path.resolve(dossierModule, '..', '..', '..');
  if (existe(path.join(racineDepot, 'pipeline', 'Makefile'))) { return racineDepot; }
  const base = String((env && env.SZH_BASE) || '').trim() || BASE_DEFAUT;
  return path.join(base, 'toolkit');
}

// Même piège que basePoste() : lecture différée, jamais mise en cache.
function toolkitPoste() {
  return resoudreToolkit(process.env, __dirname, fs.existsSync);
}

// Identique au caractère près à cheminVersWsl() de lib/portraits.js : lettre de lecteur
// minusculisée, antislash convertis, UNC laissé sans préfixe /mnt/.
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

// %USERPROFILE%, ou '' : le masquage des rapports d'erreur ne doit rien deviner.
function dossierProfil() {
  return process.env.USERPROFILE || '';
}

function dossierBureau() {
  return path.join(dossierProfil() || process.env.HOME || '', 'Desktop');
}

// Le dossier de configuration de VSCodium (%APPDATA%\VSCodium), où vit argv.json.
function dossierEditeur() {
  return path.join(process.env.APPDATA || '', 'VSCodium');
}

// Un exécutable de System32, par chemin absolu pour ne pas dépendre du PATH.
function cheminSysteme(...segments) {
  return path.join(process.env.WINDIR || 'C:\\Windows', 'System32', ...segments);
}

module.exports = {
  basePoste, resoudreToolkit, toolkitPoste, versWsl, toolkitWsl,
  racineUtilisateur, dossierProfil, dossierBureau, dossierEditeur, cheminSysteme };
