// SZH cockpit — cycle de vie du numéro : verrouillage, archivage, version du
// logiciel (D116–D117 et D120).
//
// Ce module ne connaît RIEN de l'arborescence SharePoint. Le DÉPLACEMENT d'un
// dossier de revue est délégué à windows/archive-revue.ps1 : lui seul calcule les
// emplacements (« en cours » / « archives », mode développeur compris — D119), et
// lui seul peut déplacer un dossier que VSCodium tient encore ouvert (il attend la
// fermeture de la fenêtre, retente, puis rouvre l'éditeur sur la nouvelle place).
// Une seule source de vérité pour les chemins, côté PowerShell, partagée avec le
// lanceur « Revues SZH ».
//
// Ce module ne dépend ni de vscode ni de i18n : les fonctions pures
// (versionsDivergent, tailleDossier) sont testables headless via _pur.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// ⚠ Mêmes chemins que szh-common.ps1 ($SzhBase / $SzhToolkit) et que
// lib/portraits.js (qui vise le même toolkit depuis WSL).
const BASE_SZH = 'C:\\ProgramData\\SZH';
const TOOLKIT = path.join(BASE_SZH, 'toolkit');
const SCRIPT_ARCHIVAGE = path.join(TOOLKIT, 'windows', 'archive-revue.ps1');
const SCRIPT_LANCEUR = path.join(TOOLKIT, 'windows', 'open-revue.ps1');

// Version du logiciel INSTALLÉE sur ce poste. Source primaire : le fichier VERSION
// du toolkit (écrit par la CI dans toolkit-X.zip) ; repli : state.json, écrit par
// update.ps1. '' si rien n'est lisible (poste non déployé, dépôt de dev) — aucun
// avertissement de divergence n'est alors affiché : on ne compare pas à l'inconnu.
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

// Deux versions divergent-elles ? FAUX dès qu'une des deux est inconnue (numéro
// antérieur à D120, poste non déployé) : mieux vaut ne rien dire que crier au loup.
// Comparaison textuelle après normalisation (« v2026.08.0 » == « 2026.08.0 ») — les
// tags de release sont des chaînes, jamais des nombres à ordonner.
function versionsDivergent(versionNumero, versionPoste) {
  const a = String(versionNumero || '').trim().replace(/^v/i, '');
  const b = String(versionPoste || '').trim().replace(/^v/i, '');
  if (a === '' || b === '') { return false; }
  return a !== b;
}

// Poids total d'un dossier, en octets (récursif, liens ignorés). Sert à DIRE au
// rédacteur ce que l'archivage libère avant de supprimer quoi que ce soit — la
// promesse « on peut toujours réexporter » n'a de valeur que chiffrée. 0 si absent.
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

// Suppression récursive d'un dossier. Retourne null si tout est parti, sinon le
// message d'erreur (un PDF encore verrouillé par un lecteur, typiquement).
function supprimerDossier(chemin) {
  try {
    if (!fs.existsSync(chemin)) { return null; }
    fs.rmSync(chemin, { recursive: true, force: true });
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Lance un script PowerShell du toolkit, DÉTACHÉ : la fenêtre de VSCodium peut se
// fermer juste après (c'est la condition pour déplacer un dossier), le script doit donc
// survivre à l'hôte d'extensions et pouvoir parler tout seul.
// `cache` décide s'il y a une console à l'écran, et c'est un choix d'interface :
//   false -> archivage. Déplacer plusieurs centaines de Mo en silence passerait pour un
//            plantage (D5) : la console nomme les étapes et garde l'erreur à l'écran.
//   true  -> sélecteur de version. Il n'a rien à raconter avant que sa fenêtre
//            n'apparaisse : une console derrière un dialogue ne serait que du bruit.
//            `-WindowStyle Hidden` ET windowsHide — l'un sans l'autre laisse un flash.
// Retourne null si le lancement a réussi, sinon le message d'erreur.
function lancerScriptPowerShell(script, args, cache) {
  if (!fs.existsSync(script)) {
    return 'script introuvable : ' + script;
  }
  const avant = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
  if (cache) { avant.push('-WindowStyle', 'Hidden'); }
  try {
    const proc = spawn('powershell.exe',
      avant.concat(['-File', script]).concat(args || []),
      { detached: true, stdio: 'ignore', windowsHide: !!cache });
    proc.unref();
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// « Archiver et verrouiller » / « Désarchiver » : le déplacement du dossier.
// `action` = 'archiver' | 'desarchiver'.
function lancerArchivage(action, racine) {
  const args = ['-Dossier', racine];
  if (action === 'desarchiver') { args.push('-Desarchiver'); }
  return lancerScriptPowerShell(SCRIPT_ARCHIVAGE, args, false);
}

// « Changer de version du logiciel… » : ouvre le sélecteur de versions du lanceur
// « Revues SZH » (D120) — une seule implémentation du choix de version, atteignable
// depuis le lanceur comme depuis l'avertissement de divergence.
//
// On appelle le script DIRECTEMENT, pas via hidden.vbs : un argument de moins à
// requoter, et `-WindowStyle Hidden` + windowsHide suffisent à ne montrer aucune
// console. (Un « -Versions » requoté par hidden.vbs se lierait très bien — vérifié
// à la mesure ; c'est simplement inutile ici.)
// ⚠ Rien ne remonte de ce lancement : `stdio: 'ignore'` et le process est détaché. Le
// lanceur journalise donc son entrée dans le chemin -Versions
// (C:\ProgramData\SZH\logs) — c'est la seule trace exploitable si l'utilisateur dit
// « je clique et rien ne se passe ».
function lancerChoixVersion() {
  return lancerScriptPowerShell(SCRIPT_LANCEUR, ['-Versions'], true);
}

// ---- Mode développeur (D119) --------------------------------------------------------
//
// Un seul interrupteur, dans C:\ProgramData\SZH\config.json (partagé avec TOUS les
// scripts PowerShell : lanceur, création de revue, archivage). Activé, les revues sont
// cherchées, créées et archivées dans l'arborescence de TEST plutôt que dans celle de
// production — voir Get-SzhEmplacements dans windows/szh-common.ps1, seule à connaître
// les chemins. Le cockpit ne fait que lire et écrire ce booléen.
// Défaut VRAI tant que la chaîne n'est pas passée en production : mieux vaut un essai
// qui touche le dossier de test qu'un essai qui déplace un vrai numéro.
const CONFIG = path.join(BASE_SZH, 'config.json');

// ⚠ Le BOM est RETIRÉ avant l'analyse : les config.json écrits par les versions
// antérieures de bootstrap.ps1 en portent un (Set-Content -Encoding UTF8), et
// JSON.parse le refuse. Sans ce filet, devMode retombait silencieusement sur son
// défaut. Les nouvelles écritures passent par Set-SzhJson, sans BOM.
function lireConfigPoste() {
  try { return JSON.parse(String(fs.readFileSync(CONFIG, 'utf8')).replace(/^﻿/, '')); }
  catch (e) { return null; }
}

function lireModeDeveloppeur() {
  const cfg = lireConfigPoste();
  if (!cfg || typeof cfg !== 'object' || !('devMode' in cfg)) { return true; }
  return cfg.devMode === true;
}

// Écrit devMode en préservant le reste du fichier (repo, revuesRoots, basesRevues…).
// Retourne null si écrit, sinon le message d'erreur.
function ecrireModeDeveloppeur(actif) {
  try {
    const cfg = lireConfigPoste() || {};
    cfg.devMode = !!actif;
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

module.exports = {
  BASE_SZH, TOOLKIT, CONFIG, SCRIPT_ARCHIVAGE, SCRIPT_LANCEUR,
  lireModeDeveloppeur, ecrireModeDeveloppeur,
  versionInstallee, versionsDivergent, tailleDossier, supprimerDossier,
  lancerArchivage, lancerChoixVersion
};
