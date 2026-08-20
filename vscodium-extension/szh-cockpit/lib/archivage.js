// Cycle de vie d'un numéro : archivage, version du logiciel installée, mode développeur.
//
// Ce module ignore tout de l'arborescence SharePoint : le déplacement d'un dossier de
// revue est délégué à windows/archive-revue.ps1, seul à calculer les emplacements et seul
// capable de déplacer un dossier que VSCodium tient ouvert. Les chemins n'ont ainsi
// qu'une source, côté PowerShell, partagée avec le lanceur « Revues SZH ».
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Mêmes chemins que szh-common.ps1 ($SzhBase et $SzhToolkit) et que lib/portraits.js,
// qui vise le même toolkit depuis WSL.
const BASE_SZH = 'C:\\ProgramData\\SZH';
const TOOLKIT = path.join(BASE_SZH, 'toolkit');
const SCRIPT_ARCHIVAGE = path.join(TOOLKIT, 'windows', 'archive-revue.ps1');
const SCRIPT_LANCEUR = path.join(TOOLKIT, 'windows', 'open-revue.ps1');
const SCRIPT_MAIL = path.join(TOOLKIT, 'windows', 'mail-traduction.ps1');

function versionInstallee() {
  try {
    const v = String(fs.readFileSync(path.join(TOOLKIT, 'VERSION'), 'utf8')).trim();
    if (v !== '') { return v; }
  } catch (e) { /* repli state.json */ }
  try {
    const etat = JSON.parse(fs.readFileSync(path.join(BASE_SZH, 'state.json'), 'utf8'));
    return String((etat && etat.version) || '').trim();
  } catch (e) { return ''; }
}

// Faux dès qu'une des deux versions est inconnue. Comparaison textuelle après
// normalisation, les tags de release étant des chaînes et non des nombres à ordonner.
function versionsDivergent(versionNumero, versionPoste) {
  const a = String(versionNumero || '').trim().replace(/^v/i, '');
  const b = String(versionPoste || '').trim().replace(/^v/i, '');
  if (a === '' || b === '') { return false; }
  return a !== b;
}

function tailleDossier(chemin) {
  let total = 0;
  let entrees;
  try { entrees = fs.readdirSync(chemin, { withFileTypes: true }); }
  catch (e) { return 0; }
  for (const e of entrees) {
    const complet = path.join(chemin, e.name);
    if (e.isDirectory()) { total += tailleDossier(complet); continue; }
    if (!e.isFile()) { continue; }
    try { total += fs.statSync(complet).size; } catch (err) { /* disparu entre-temps */ }
  }
  return total;
}

function supprimerDossier(chemin) {
  try {
    if (!fs.existsSync(chemin)) { return null; }
    fs.rmSync(chemin, { recursive: true, force: true });
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Lance un script PowerShell du toolkit de façon qu'il survive à cette fenêtre :
// l'archivage ferme VSCodium, condition pour déplacer un dossier ouvert.
//
// ⚠ Pas de `detached: true` ici : sur Windows, libuv le traduit par DETACHED_PROCESS,
// donc powershell.exe démarre sans console, ressort aussitôt avec le code 0 et n'exécute
// pas une ligne du script, sans le moindre message. La voie qui marche est celle que le
// toolkit emploie partout ailleurs, `wscript.exe //B hidden.vbs`, qui crée un vrai
// processus à console cachée et rend la main aussitôt — il n'y a donc plus rien à
// détacher. En contrepartie les scripts lancés d'ici signalent leurs erreurs par une
// boîte de dialogue et par le journal, non par la console.
function lancerScriptPowerShell(script, args) {
  if (!fs.existsSync(script)) { return 'script introuvable : ' + script; }
  const vbs = path.join(TOOLKIT, 'windows', 'hidden.vbs');
  if (!fs.existsSync(vbs)) { return 'script introuvable : ' + vbs; }
  try {
    const proc = spawn('wscript.exe', ['//B', vbs, script].concat(args || []),
      { stdio: 'ignore', windowsHide: true });
    // wscript sort tout de suite : ni attendre son code, ni laisser une erreur remonter
    // en rejet non capturé de l'hôte d'extensions.
    proc.on('error', () => { /* signalé par l'absence d'effet, et par le journal */ });
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

function lancerArchivage(action, racine) {
  const args = ['-Dossier', racine];
  if (action === 'desarchiver') { args.push('-Desarchiver'); }
  return lancerScriptPowerShell(SCRIPT_ARCHIVAGE, args);
}

// Ouvre le sélecteur de versions du lanceur « Revues SZH », seule implémentation du choix
// de version. Rien ne remonte de ce lancement : le lanceur journalise son entrée dans
// C:\ProgramData\SZH\logs, unique trace si l'utilisateur dit que rien ne se passe.
function lancerChoixVersion() {
  return lancerScriptPowerShell(SCRIPT_LANCEUR, ['-Versions']);
}

// Brouillon d'e-mail « Envoyer pour traduction ». Confié à PowerShell parce qu'un corps
// `mailto:` est du texte brut, où le lien szh:// arriverait inerte : seul l'objet mail
// d'Outlook accepte un corps HTML, donc un vrai <a href>. Le script déduit aussi du
// produit la langue de l'e-mail et le destinataire.
function lancerMailTraduction(lien) {
  return lancerScriptPowerShell(SCRIPT_MAIL, ['-Lien', lien]);
}

// Mode développeur : un seul interrupteur, dans C:\ProgramData\SZH\config.json, partagé
// avec tous les scripts PowerShell. Activé, les revues sont cherchées, créées et
// archivées dans l'arborescence de test (voir Get-SzhEmplacements dans
// windows/szh-common.ps1, seule à connaître les chemins). Vrai par défaut : mieux vaut un
// essai dans le dossier de test qu'un essai qui déplace un vrai numéro.
const CONFIG = path.join(BASE_SZH, 'config.json');

// BOM retiré avant l'analyse : d'anciens config.json en portent un et JSON.parse le
// refuse, ce qui ferait retomber devMode sur son défaut sans rien dire.
function lireConfigPoste() {
  try { return JSON.parse(String(fs.readFileSync(CONFIG, 'utf8')).replace(/^﻿/, '')); }
  catch (e) { return null; }
}

function lireModeDeveloppeur() {
  const cfg = lireConfigPoste();
  if (!cfg || typeof cfg !== 'object' || !('devMode' in cfg)) { return true; }
  return cfg.devMode === true;
}

function ecrireModeDeveloppeur(actif) {
  try {
    const cfg = lireConfigPoste() || {};
    cfg.devMode = !!actif;
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

module.exports = {
  BASE_SZH, TOOLKIT, CONFIG, SCRIPT_ARCHIVAGE, SCRIPT_LANCEUR, SCRIPT_MAIL,
  lancerMailTraduction,
  lireModeDeveloppeur, ecrireModeDeveloppeur,
  versionInstallee, versionsDivergent, tailleDossier, supprimerDossier,
  lancerArchivage, lancerChoixVersion
};
