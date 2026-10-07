// Archivage d'un numéro, version installée, et lecture-écriture de config.json (emplacement
// des revues, langue, modes de traduction, destinataires). Le déplacement d'un dossier est
// délégué à windows/archive-revue.ps1, qui sait déplacer un dossier que VSCodium tient ouvert.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { ecrireAtomique } = require('./yaml');
const { basePoste } = require('./poste');

// Mêmes chemins que szh-common.ps1 ($SzhBase et $SzhToolkit) et que lib/portraits.js,
// qui vise le même toolkit depuis WSL.
const BASE_SZH = basePoste();
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

// La majeure d'un numéro de version, ou 0 quand ce n'en est pas un. « 0.0.0-dev+<sha> » de
// l'instance de développement donne aussi 0.
function majeureVersion(version) {
  const trouve = /^v?(\d+)\.\d+\.\d+/.exec(String(version || '').trim());
  if (!trouve) { return 0; }
  return Number(trouve[1]);
}

// Vrai si le numéro a été compilé par une autre majeure que celle du poste. Seule la
// majeure compte : elle change quand un numéro déjà compilé sortirait différent. Une
// version au format AAAA.MM.N (majeure 2026) diverge donc de toute version 3.x.y.
//
// Faux si l'une des deux versions est inconnue ou illisible, et sur un poste de
// développement (0.0.0-dev), où la maquette est celle du dépôt ouvert.
function versionsDivergent(versionNumero, versionPoste) {
  const a = majeureVersion(versionNumero);
  const b = majeureVersion(versionPoste);
  if ((a === 0) || (b === 0)) { return false; }
  return a !== b;
}

// Le medium d'un numéro de version (« 1.2 » pour 1.2.13), ou '' quand ce n'en est pas un.
// lib/nouveautes.js range ses notes sous cette clé. Même règle que Get-SzhMediumVersion
// (windows/szh-common.ps1) : la majeure vaut au moins 1 et reste sous 2000 ; au-delà, c'est
// une année, donc l'ancien format AAAA.MM.N.
function mediumVersion(version) {
  const trouve = /^v?(\d+)\.(\d+)\.\d+/.exec(String(version || '').trim());
  if (!trouve) { return ''; }
  const majeure = Number(trouve[1]);
  if ((majeure < 1) || (majeure >= 2000)) { return ''; }
  return majeure + '.' + Number(trouve[2]);
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
// Le lancement passe par `wscript.exe //B hidden.vbs`, qui crée un processus à console
// cachée et rend la main aussitôt. `detached: true` ne convient pas : sous Windows, libuv le
// traduit par DETACHED_PROCESS, et powershell.exe sort alors aussitôt avec le code 0 sans
// exécuter le script. Les scripts lancés ainsi signalent leurs erreurs par une boîte de
// dialogue et par le journal.
function lancerScriptPowerShell(script, args) {
  if (!fs.existsSync(script)) { return 'script introuvable : ' + script; }
  const vbs = path.join(TOOLKIT, 'windows', 'hidden.vbs');
  if (!fs.existsSync(vbs)) { return 'script introuvable : ' + vbs; }
  try {
    const proc = spawn('wscript.exe', ['//B', vbs, script].concat(args || []),
      { stdio: 'ignore', windowsHide: true });
    // wscript sort tout de suite : son code n'est pas attendu, et une erreur ne doit pas
    // devenir un rejet non capturé dans l'hôte d'extensions.
    proc.on('error', () => { /* signalé par l'absence d'effet, et par le journal */ });
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

function lancerArchivage(action, racine) {
  const args = ['-Dossier', racine];
  if (action === 'desarchiver') { args.push('-Desarchiver'); }
  return lancerScriptPowerShell(SCRIPT_ARCHIVAGE, args);
}

// Ouvre le sélecteur de versions du lanceur PowerShell. Aucun retour ne remonte : le
// lanceur journalise son démarrage dans C:\ProgramData\SZH\logs.
function lancerChoixVersion() {
  return lancerScriptPowerShell(SCRIPT_LANCEUR, ['-Versions']);
}

const CONFIG = path.join(BASE_SZH, 'config.json');

// Le config.json lu et écrit : celui du poste, ou celui que nomme SZH_CONFIG_OJS (les tests
// s'en servent pour ne pas toucher C:\ProgramData\SZH). C'est une fonction et non une
// constante : un test pose la variable après le chargement du module.
function cheminConfigPoste() {
  const surcharge = String(process.env.SZH_CONFIG_OJS || '').trim();
  return surcharge || CONFIG;
}

// BOM retiré avant l'analyse : des config.json en portent un, que JSON.parse refuse.
function lireConfigPoste() {
  try { return JSON.parse(String(fs.readFileSync(cheminConfigPoste(), 'utf8')).replace(/^﻿/, '')); }
  catch (e) { return null; }
}

// Lit, modifie et réécrit config.json ; tout ce qui écrit dans ce fichier passe par ici.
// `fn` reçoit l'objet lu ({} si le fichier est absent ou illisible) et rend l'objet à
// écrire ; null ou undefined annule l'écriture. Le fichier étant relu juste avant chaque
// écriture, deux écritures successives sur des clés différentes ne s'écrasent pas.
// `fn` peut aussi être directement l'objet à écrire, déjà fusionné par l'appelant.
// Rend null, ou le message d'erreur.
function ecrireConfigPoste(fn) {
  try {
    const avant = lireConfigPoste() || {};
    const apres = typeof fn === 'function' ? fn(avant) : fn;
    if (apres === undefined || apres === null) { return null; }
    // Écriture atomique : un config.json à moitié écrit serait illisible pour tous ses lecteurs.
    ecrireAtomique(cheminConfigPoste(),
      JSON.stringify(typeof apres === 'object' ? apres : {}, null, 2) + '\n');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// ---- Destinataire de « Envoyer pour traduction » --------------------------------
//
// Le courriel va à la rédaction qui traduit : un numéro de la Zeitschrift part vers la
// rédaction francophone, une Revue vers la rédaction germanophone.
const MAILS_TRADUCTION = {
  zeitschrift: 'redaction@csps.ch',    // allemand -> français
  revue: 'redaktion@szh.ch'            // français -> allemand
};
// Produit inconnu, config illisible, adresse invalide : le brouillon s'ouvre quand même, et
// le rédacteur corrige le destinataire.
const MAIL_TRADUCTION_DEFAUT = 'robin.morand@szh.ch';

// Adresse conservatrice : seuls ces caractères passent tels quels dans un `mailto:`.
const FORME_MAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// Les adresses se surchargent dans config.json :
//   { "mailsTraduction": { "revue": "…", "zeitschrift": "…" } }
// La config est passée en argument, pour tester sans écrire dans C:\ProgramData ;
// adresseMailTraduction lit le fichier.
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
// La clé `emplacementRevues` de config.json, partagée avec les scripts PowerShell, vaut
// « test » ou « production » et choisit la racine des numéros. L'ancienne clé `devMode`
// est encore lue, et réécrite avec la nouvelle pour un toolkit plus ancien resté sur le poste.
//
// Les chemins des deux racines sont dans Get-SzhEmplacements (windows/szh-common.ps1). Ce
// module ne rend que le choix ; Resolve-SzhEmplacementRevues applique les mêmes règles
// dans le même ordre, ce que vérifie test/js/emplacements.test.js.
const EMPLACEMENT_TEST = 'test';
const EMPLACEMENT_PRODUCTION = 'production';

// Booléen d'un JSON écrit à la main : true/false, "true"/"false", 1/0. Tout le reste rend
// null, soit « clé absente ». PowerShell applique la même règle ; sans elle,
// `"devMode": "false"` vaudrait faux ici et vrai côté PowerShell ([bool]'false' y est $true).
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

// La nouvelle clé, puis l'ancienne, puis « test » par défaut : le seul défaut qui ne fasse
// disparaître aucune revue d'un poste existant. Get-SzhEmplacementRevues, côté PowerShell,
// écrit la valeur dans config.json dès qu'il tourne, après avoir regardé le disque.
// La config est passée en argument, pour tester sans écrire dans C:\ProgramData.
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

// Les deux clés sont posées ensemble, pour qu'un toolkit plus ancien lise la même chose que
// le cockpit. ecrireEmplacementRevues écrit le fichier.
function configAvecEmplacement(cfg, emplacement) {
  const voulu = emplacement === EMPLACEMENT_PRODUCTION ? EMPLACEMENT_PRODUCTION : EMPLACEMENT_TEST;
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  sortie.emplacementRevues = voulu;
  sortie.devMode = (voulu === EMPLACEMENT_TEST);
  return sortie;
}

function ecrireEmplacementRevues(emplacement) {
  return ecrireConfigPoste((avant) => configAvecEmplacement(avant, emplacement));
}

// ---- Langue de l'interface -------------------------------------------------------
//
// Les réglages écrivent la langue dans le réglage de l'éditeur et dans config.json. La mise
// à jour du poste réécrit entièrement les réglages de l'éditeur ; config.json, lui, n'est
// pas réécrit, et garde donc le choix.
//
// lib/i18n.js relit la clé sans passer par ce module, pour rester chargeable hors de
// l'éditeur. L'appelant écrit le résultat avec ecrireConfigPoste.
function configAvecLangue(cfg, langue) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  const v = String(langue === undefined || langue === null ? '' : langue).trim().toLowerCase();
  if (v === 'fr' || v === 'de') { sortie.langue = v; }
  else { delete sortie.langue; }       // valeur inconnue : la clé est effacée
  return sortie;
}

// ---- Vérificateur de traduction : le mode qui pose une pastille sur les champs --
//
// Dans config.json plutôt que dans les réglages de l'éditeur : trois panneaux le lisent
// (fiches, vérification de l'import, traduction), et la mise à jour du poste réécrit les
// réglages de VSCodium en entier.
//
// Éteint par défaut. Un JSON écrit à la main est lu par normaliserBooleenConfig.
const CLE_VERIF_TRADUCTION = 'verifTraduction';

// Absente ou illisible : éteint.
function resoudreVerifTraduction(cfg) {
  if (!cfg || typeof cfg !== 'object') { return false; }
  return normaliserBooleenConfig(cfg[CLE_VERIF_TRADUCTION]) === true;
}

function lireVerifTraduction() {
  return resoudreVerifTraduction(lireConfigPoste());
}

// La clé est toujours écrite en booléen, quelle que soit la forme lue.
function configAvecVerifTraduction(cfg, actif) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  sortie[CLE_VERIF_TRADUCTION] = actif === true;
  return sortie;
}

function ecrireVerifTraduction(actif) {
  return ecrireConfigPoste((avant) => configAvecVerifTraduction(avant, actif === true));
}

// Le mode « Trad » : tant qu'il est allumé, un clic sur un texte de l'interface ouvre le
// formulaire de suggestion au lieu de l'action normale. Mêmes fonctions et même raison
// d'être dans config.json que le vérificateur ci-dessus.
//
// Indépendant du vérificateur, qui porte sur les champs traduisibles d'un article ; ce mode
// porte sur les libellés de l'interface.
const CLE_MODE_TRAD = 'modeTrad';

function resoudreModeTrad(cfg) {
  if (!cfg || typeof cfg !== 'object') { return false; }
  return normaliserBooleenConfig(cfg[CLE_MODE_TRAD]) === true;
}

function lireModeTrad() {
  return resoudreModeTrad(lireConfigPoste());
}

function configAvecModeTrad(cfg, actif) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  sortie[CLE_MODE_TRAD] = actif === true;
  return sortie;
}

function ecrireModeTrad(actif) {
  return ecrireConfigPoste((avant) => configAvecModeTrad(avant, actif === true));
}

// « Mode développeur » : autre nom de l'emplacement de test, employé par les réglages.
function lireModeDeveloppeur() {
  return lireEmplacementRevues() === EMPLACEMENT_TEST;
}

function ecrireModeDeveloppeur(actif) {
  return ecrireEmplacementRevues(actif ? EMPLACEMENT_TEST : EMPLACEMENT_PRODUCTION);
}

module.exports = {
  BASE_SZH, TOOLKIT, CONFIG, CONFIG_POSTE: CONFIG, SCRIPT_ARCHIVAGE, SCRIPT_LANCEUR,
  lancerScriptPowerShell,
  cheminConfigPoste, lireConfigPoste, ecrireConfigPoste, FORME_MAIL,
  MAILS_TRADUCTION, MAIL_TRADUCTION_DEFAUT, choisirAdresseMail, adresseMailTraduction,
  EMPLACEMENT_TEST, EMPLACEMENT_PRODUCTION, normaliserBooleenConfig,
  resoudreEmplacementRevues, lireEmplacementRevues, configAvecEmplacement, configAvecLangue,
  ecrireEmplacementRevues, lireModeDeveloppeur, ecrireModeDeveloppeur,
  CLE_VERIF_TRADUCTION, resoudreVerifTraduction, configAvecVerifTraduction,
  lireVerifTraduction, ecrireVerifTraduction,
  CLE_MODE_TRAD, resoudreModeTrad, configAvecModeTrad,
  lireModeTrad, ecrireModeTrad,
  versionInstallee, versionsDivergent, mediumVersion, tailleDossier,
  lancerArchivage, lancerChoixVersion
};
