// Cycle de vie d'un numéro : archivage, version du logiciel installée, emplacement des revues.
//
// Ce module ignore tout de l'arborescence SharePoint : le déplacement d'un dossier de
// revue est délégué à windows/archive-revue.ps1, seul à calculer les emplacements et seul
// capable de déplacer un dossier que VSCodium tient ouvert. Les chemins n'ont ainsi
// qu'une source, côté PowerShell, partagée avec le lanceur « Revues SZH ».
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ecrireAtomique } = require('./yaml');

// Mêmes chemins que szh-common.ps1 ($SzhBase et $SzhToolkit) et que lib/portraits.js,
// qui vise le même toolkit depuis WSL.
const BASE_SZH = 'C:\\ProgramData\\SZH';
const TOOLKIT = path.join(BASE_SZH, 'toolkit');
const SCRIPT_ARCHIVAGE = path.join(TOOLKIT, 'windows', 'archive-revue.ps1');
const SCRIPT_LANCEUR = path.join(TOOLKIT, 'windows', 'open-revue.ps1');

function versionInstallee() {
  try {
    const v = String(fs.readFileSync(path.join(TOOLKIT, 'VERSION'), 'utf8')).trim();
    if (v !== '') { return v; }
  } catch (e) { /* repli state.json */ }
  try {
    // BOM retiré : Save-SzhState écrit state.json avec un BOM, que JSON.parse refuse.
    const brut = String(fs.readFileSync(path.join(BASE_SZH, 'state.json'), 'utf8')).replace(/^﻿/, '');
    const etat = JSON.parse(brut);
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

const CONFIG = path.join(BASE_SZH, 'config.json');

// BOM retiré avant l'analyse : d'anciens config.json en portent un et JSON.parse le
// refuse, ce qui ferait retomber devMode sur son défaut sans rien dire.
function lireConfigPoste() {
  try { return JSON.parse(String(fs.readFileSync(CONFIG, 'utf8')).replace(/^﻿/, '')); }
  catch (e) { return null; }
}

// Écrit config.json tel qu'on le lui donne. Les modules qui y rangent un réglage de revue
// — l'emplacement des revues, la configuration OJS, les tâches par article — passent par
// ces deux fonctions : un seul chemin, un seul BOM à retirer, et le fichier garde ce que
// les autres y ont mis. Rend null, ou le message de l'échec.
function ecrireConfigPoste(cfg) {
  try {
    // Atomique : config.json porte l'emplacement des revues et la configuration OJS, et
    // un fichier à moitié écrit rendrait le poste illisible pour tous ses lecteurs.
    ecrireAtomique(CONFIG, JSON.stringify(cfg && typeof cfg === 'object' ? cfg : {}, null, 2) + '\n');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// ---- Destinataire de « Envoyer pour traduction » --------------------------------
//
// On écrit à l'équipe qui va traduire, donc à l'autre maison : un numéro de la
// Zeitschrift part vers la rédaction francophone, une Revue vers la rédaction
// germanophone. Ces deux adresses ne vivent plus qu'ici — le script PowerShell qui les
// portait est parti avec le composant COM d'Outlook.
const MAILS_TRADUCTION = {
  zeitschrift: 'redaction@csps.ch',    // allemand -> français
  revue: 'redaktion@szh.ch'            // français -> allemand
};
// Produit inconnu, config illisible, adresse invalide : le brouillon doit s'ouvrir quand
// même, quitte à ce que le rédacteur corrige le destinataire lui-même.
const MAIL_TRADUCTION_DEFAUT = 'robin.morand@szh.ch';

// Adresse conservatrice : seuls ces caractères passent tels quels dans un `mailto:`.
const FORME_MAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Surchargeable par config.json, clé `mailsTraduction` — un objet dont les clés sont les
// jetons de revue. Nom et forme inchangés : des postes en portent déjà.
//   { "mailsTraduction": { "revue": "…", "zeitschrift": "…" } }
// La résolution est pure — la config lui est passée — pour être éprouvable sans écrire
// dans C:\ProgramData ; adresseMailTraduction n'est que la lecture du fichier.
function choisirAdresseMail(produit, cfg) {
  const cle = String(produit === undefined || produit === null ? '' : produit).toLowerCase();
  const surcharge = (cfg && typeof cfg.mailsTraduction === 'object' && cfg.mailsTraduction) || {};
  for (const source of [surcharge[cle], MAILS_TRADUCTION[cle]]) {
    const v = String(source === undefined || source === null ? '' : source).trim();
    if (FORME_MAIL.test(v)) { return v; }
  }
  return MAIL_TRADUCTION_DEFAUT;
}

function adresseMailTraduction(produit) {
  return choisirAdresseMail(produit, lireConfigPoste());
}

// ---- Emplacement des revues : où vivent les numéros -----------------------------
//
// Un seul interrupteur, dans C:\ProgramData\SZH\config.json, partagé avec tous les scripts
// PowerShell. Il déplace la racine de tout le travail, et la clé porte donc le nom de son
// effet : `emplacementRevues` vaut « test » ou « production ». « devMode » était le nom
// d'avant ; il est encore lu, des postes le portent, et réécrit en même temps que la clé
// neuve pour un toolkit plus ancien resté sur le poste.
//
// Les chemins des deux racines ne sont pas ici : ils n'ont qu'une source,
// Get-SzhEmplacements dans windows/szh-common.ps1. Ce module ne rend que la décision, et
// Resolve-SzhEmplacementRevues y applique exactement les mêmes règles dans le même ordre —
// test/js/emplacements.test.js soumet les deux aux mêmes configurations.
const EMPLACEMENT_TEST = 'test';
const EMPLACEMENT_PRODUCTION = 'production';

// Booléen d'un JSON écrit à la main : true/false, "true"/"false", 1/0. Tout le reste rend
// null, soit « clé absente ». Sans cette normalisation, `"devMode": "false"` vaut faux ici
// et vrai côté PowerShell ([bool]'false' y est $true) : les deux moitiés liraient deux
// racines différentes pour la même configuration.
function normaliserBooleenConfig(valeur) {
  if (valeur === true || valeur === false) { return valeur; }
  if (typeof valeur === 'number') {
    if (valeur === 1) { return true; }
    if (valeur === 0) { return false; }
    return null;
  }
  if (typeof valeur === 'string') {
    const t = valeur.trim().toLowerCase();
    if (t === 'true') { return true; }
    if (t === 'false') { return false; }
  }
  return null;
}

// La clé neuve, puis l'ancienne, puis le défaut historique « test ». Résolution pure — la
// config lui est passée — pour être éprouvable sans écrire dans C:\ProgramData. Le défaut
// n'est pas un choix : c'est ce que voyaient les postes d'avant, et le seul qui ne fasse
// disparaître aucune revue. Get-SzhEmplacementRevues, côté PowerShell, l'écrit en clair
// dans config.json dès qu'il tourne, après avoir regardé le disque.
function resoudreEmplacementRevues(cfg) {
  if (cfg && typeof cfg === 'object') {
    const brut = cfg.emplacementRevues;
    const v = String(brut === undefined || brut === null ? '' : brut).trim().toLowerCase();
    if (v === EMPLACEMENT_PRODUCTION) { return EMPLACEMENT_PRODUCTION; }
    if (v === EMPLACEMENT_TEST) { return EMPLACEMENT_TEST; }
    if ('devMode' in cfg) {
      const ancien = normaliserBooleenConfig(cfg.devMode);
      if (ancien !== null) { return ancien ? EMPLACEMENT_TEST : EMPLACEMENT_PRODUCTION; }
    }
  }
  return EMPLACEMENT_TEST;
}

function lireEmplacementRevues() {
  return resoudreEmplacementRevues(lireConfigPoste());
}

// Les deux clés sont posées ensemble : la neuve fait foi, l'ancienne suit, faute de quoi un
// toolkit resté en arrière lirait l'inverse de ce que le cockpit affiche. Pure, pour être
// éprouvable ; ecrireEmplacementRevues n'est que l'écriture du fichier.
function configAvecEmplacement(cfg, emplacement) {
  const voulu = emplacement === EMPLACEMENT_PRODUCTION ? EMPLACEMENT_PRODUCTION : EMPLACEMENT_TEST;
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  sortie.emplacementRevues = voulu;
  sortie.devMode = (voulu === EMPLACEMENT_TEST);
  return sortie;
}

function ecrireEmplacementRevues(emplacement) {
  try {
    const cfg = configAvecEmplacement(lireConfigPoste(), emplacement);
    fs.writeFileSync(CONFIG, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Noms d'avant, gardés pour l'hôte et ses réglages : « mode développeur » n'était que le nom
// de l'emplacement de test.
function lireModeDeveloppeur() {
  return lireEmplacementRevues() === EMPLACEMENT_TEST;
}

function ecrireModeDeveloppeur(actif) {
  return ecrireEmplacementRevues(actif ? EMPLACEMENT_TEST : EMPLACEMENT_PRODUCTION);
}

module.exports = {
  BASE_SZH, TOOLKIT, CONFIG, CONFIG_POSTE: CONFIG, SCRIPT_ARCHIVAGE, SCRIPT_LANCEUR,
  lireConfigPoste, ecrireConfigPoste, FORME_MAIL,
  MAILS_TRADUCTION, MAIL_TRADUCTION_DEFAUT, choisirAdresseMail, adresseMailTraduction,
  EMPLACEMENT_TEST, EMPLACEMENT_PRODUCTION, normaliserBooleenConfig,
  resoudreEmplacementRevues, lireEmplacementRevues, configAvecEmplacement,
  ecrireEmplacementRevues, lireModeDeveloppeur, ecrireModeDeveloppeur,
  versionInstallee, versionsDivergent, tailleDossier,
  lancerArchivage, lancerChoixVersion
};
