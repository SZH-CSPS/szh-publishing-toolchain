// L'écrivain de rapports d'erreur automatiques côté cockpit (SPEC-RAPPORTS.md, §4 et §5 ;
// docs/RAPPORTS-ERREUR.md). Construit un rapport conforme au schéma v1, résout l'ancrage
// SharePoint PASSIVEMENT (jamais de balayage de disque, jamais de fenêtre), applique
// l'anti-inondation et la file d'attente hors ligne, et écrit le fichier — ou n'écrit rien,
// mais ne lève jamais (D5).
//
// Ce module RÉUTILISE lib/codes-erreur.js (la table des codes, les constantes du schéma, et
// les fonctions pures de masquage/plafonds/validation/id/signature) : il ne le réécrit pas,
// il ne le modifie pas. Tout ce qui est ICI concerne la construction du rapport à partir du
// contexte du cockpit et l'ÉCRITURE (résolution de l'ancrage, anti-inondation, file
// d'attente, disque) — la moitié impure que codes-erreur.js n'a pas.
//
// Dépendances volontairement limitées à fs/path/os (plus codes-erreur.js, le contrat déjà
// livré) : jamais `require('vscode')`, jamais un autre module de lib/ (archivage.js,
// yaml.js…). Deux raisons : ce module doit rester chargeable par le banc de test hors de
// l'éditeur (test/js/rapport-erreur.test.js le requiert directement), et un futur écrivain
// PowerShell (lanceur, autre jalon) doit pouvoir reproduire cette moitié-ci de la même façon
// qu'il reproduit déjà celle de codes-erreur.js — sans avoir à traduire des dépendances
// propres au cockpit (mailsTraduction, emplacementRevues…) qui n'ont rien à voir avec un
// rapport d'erreur. Là où un motif du dépôt est réutile (lecture tolérante de config.json,
// écriture atomique), il est repris ICI localement plutôt que requis depuis lib/archivage.js
// — voir les commentaires plus bas à chaque endroit concerné.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const codesErreur = require('./codes-erreur');

// ---------------------------------------------------------------------------------------
// 1. Racines et chemins — dérivés, jamais en dur, surchargeables pour les tests
// ---------------------------------------------------------------------------------------
//
// Quatre surcharges, jamais mélangées :
//   SZH_ANCRAGE    -> le niveau « essai » de la résolution de l'ANCRAGE (3 ci-dessous) —
//                     la MÊME variable que Resolve-SzhAncrage côté PowerShell (D10) : il
//                     n'existe qu'UNE SEULE surcharge d'ancrage dans tout le produit,
//                     honorée identiquement par les deux langages.
//   SZH_RAPPORTS   -> le DOSSIER DE RAPPORTS, directement (D10, amendement du 09.09.2026).
//                     Orthogonale à SZH_ANCRAGE : remplace la DÉRIVATION depuis l'ancrage,
//                     mais ne remplace pas la résolution de l'ancrage elle-même — le champ
//                     `ancrage` du rapport garde son sens, les chemins relatifs aussi ; seul
//                     le dossier D'ÉCRITURE change. Voir resoudreDossierRapports() plus bas.
//                     ⚠ Piège vécu (Robin, en éprouvant ce module) : avant D10, cette
//                     variable désignait l'ancrage, et un dossier de rapports qu'on lui
//                     passait directement se retrouvait avec un `2_Produkte\…` de trop en
//                     dessous de lui. Les deux variables sont maintenant strictement
//                     séparées : chacune ne fait qu'une chose, celle que son nom dit.
//   SZH_BASE       -> remplace C:\ProgramData\SZH (config.json, l'état du poste, le
//                     toolkit installé) — même nom et même rôle que $env:SZH_BASE côté
//                     PowerShell (windows/szh-common.ps1), pour qu'un même geste de test
//                     se comprenne des deux côtés du lot, même si les deux processus ne se
//                     parlent pas.
//   LOCALAPPDATA   -> la vraie variable Windows : %LOCALAPPDATA%\SZH porte déjà
//                     etat-utilisateur.json (par compte) dans toute la chaîne ; la
//                     redéfinir dans l'environnement du test suffit, aucune variable
//                     SZH_* dédiée n'est nécessaire ici.
// Toujours des FONCTIONS, jamais des constantes figées au chargement : une surcharge posée
// après le require (comme le fait chaque test) doit être vue au prochain appel (même motif
// que lib/archivage.js#cheminConfigPoste).
function racineProgramData() {
  const v = String(process.env.SZH_BASE || '').trim();
  return v || 'C:\\ProgramData\\SZH';
}
function racineUtilisateur() {
  const v = String(process.env.LOCALAPPDATA || '').trim();
  return v || path.join(os.homedir(), 'AppData', 'Local');
}
function cheminConfigPoste() { return path.join(racineProgramData(), 'config.json'); }
function cheminStatePoste() { return path.join(racineProgramData(), 'state.json'); }
function cheminVersionToolkit() { return path.join(racineProgramData(), 'toolkit', 'VERSION'); }
function cheminEtatUtilisateur() { return path.join(racineUtilisateur(), 'SZH', 'etat-utilisateur.json'); }
function cheminDossierAttente() { return path.join(racineUtilisateur(), 'SZH', 'rapports-en-attente'); }

// Le dossier des rapports, DÉRIVÉ de l'ancrage — jamais un chemin absolu en dur (D4). La
// faute de frappe « Zeitscrhiften » est le VRAI nom du dossier existant sur SharePoint :
// elle est reproduite à l'identique, elle ne se corrige jamais (test dédié dans le banc).
const SEGMENTS_DOSSIER_RAPPORTS = ['2_Produkte', 'Edition SZH CSPS allgemein', '_AutoReportToolboxZeitscrhiften'];

function dossierRapportsDepuisAncrage(ancrage) {
  if (!ancrage) { return null; }
  return path.join.apply(path, [ancrage].concat(SEGMENTS_DOSSIER_RAPPORTS));
}

// D10 : le dossier D'ÉCRITURE effectif, une fois l'ancrage résolu par ailleurs.
// `SZH_RAPPORTS`, quand elle est posée, l'emporte SANS CONDITION sur la dérivation depuis
// l'ancrage — c'est la surcharge la plus spécifique (« le dossier de rapports, directement,
// tel quel ») : elle ne dérive rien, elle NE FAIT AUCUN JOIN. Sans elle, on retombe sur la
// dérivation habituelle depuis l'ancrage résolu (ou `null` si l'ancrage lui-même est
// introuvable — pas de dossier de rapports sans ancrage ET sans surcharge explicite).
function resoudreDossierRapports(ancrage) {
  const surcharge = String(process.env.SZH_RAPPORTS || '').trim();
  if (surcharge) { return surcharge; }
  if (!ancrage || !ancrage.trouve) { return null; }
  return dossierRapportsDepuisAncrage(ancrage.chemin);
}

// Plafonds de la file d'attente hors ligne (§4.4) — distincts des plafonds de contenu d'un
// rapport (codesErreur.PLAFONDS), qui portent sur un rapport déjà construit.
const PLAFONDS_ATTENTE = Object.freeze({ fichiers: 50, jours: 30 });

// ---------------------------------------------------------------------------------------
// 2. Lecture tolérante et écriture atomique — motif de lib/archivage.js, repris ici en
//    local (voir l'en-tête : pas de dépendance sur ce module pour rester indépendant).
// ---------------------------------------------------------------------------------------

// JSON.parse tolérant : BOM retiré (Save-SzhState et certains éditeurs Windows en posent
// un, que JSON.parse refuse), fichier absent ou illisible -> objet vide, jamais une
// exception. Utilisé pour config.json comme pour etat-utilisateur.json.
function lireJsonTolerant(chemin) {
  try {
    const brut = String(fs.readFileSync(chemin, 'utf8')).replace(/^\uFEFF/, '');
    const valeur = JSON.parse(brut);
    return (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) ? valeur : {};
  } catch (e) { return {}; }
}

// Écrit un JSON UTF-8 SANS BOM, indenté 2 espaces (§4, en-tête du schéma — appliqué ici
// aussi à etat-utilisateur.json par cohérence). Écrit dans un fichier temporaire puis
// renomme : une lecture concurrente ne voit jamais un fichier à moitié écrit.
function ecrireJsonAtomique(chemin, valeur) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const tmp = chemin + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, chemin);
}

function lireEtatUtilisateur() { return lireJsonTolerant(cheminEtatUtilisateur()); }

// Lecture-modification-écriture, comme lib/archivage.js#ecrireConfigPoste : `fn` reçoit
// l'objet lu (jamais null) et rend l'objet à écrire. Ne lève jamais — un échec d'écriture
// des compteurs anti-inondation n'est déjà, en soi, qu'une dégradation silencieuse (au pire
// l'anti-inondation « oublie » d'une exécution à l'autre, jamais un crash ni un rapport en
// boucle).
function ecrireEtatUtilisateur(fn) {
  try {
    const avant = lireEtatUtilisateur();
    const apres = fn(avant);
    if (apres === undefined || apres === null) { return false; }
    ecrireJsonAtomique(cheminEtatUtilisateur(), apres);
    return true;
  } catch (e) { return false; }
}

// ---------------------------------------------------------------------------------------
// 3. Résolution PASSIVE de l'ancrage (amendement du 09.09.2026 : Resolve, jamais Initialize)
// ---------------------------------------------------------------------------------------
//
// Trois niveaux SEULEMENT (essai, config, cache) : la détection automatique et la demande
// à l'utilisateur·trice (niveaux 4 et 5 de la spec complète) sont le lanceur PowerShell,
// un autre jalon. Ici, JAMAIS de fs.readdirSync pour chercher un dossier, JAMAIS de
// fenêtre : chaque niveau ne fait qu'une sonde ciblée (fs.statSync sur un chemin déjà
// connu), et rend `origine: 'absent'` en silence si rien n'aboutit — exactement la garde
// que l'amendement exige d'une fonction appelable depuis un accesseur de chemin sans
// console (ici, l'écrivain de rapports).
//
// Volontairement plus ÉTROIT que Resolve-SzhAncrage côté PowerShell (qui, lui, ajoute la
// détection automatique — niveau 4) : décision actée avec Robin, pas un raccourci. Deux
// raisons, pas une seule :
//   1. Le lanceur tourne TOUJOURS avant le cockpit (VSCodium ne s'ouvre que depuis lui) et
//      met déjà l'ancrage résolu en cache dans etat-utilisateur.json — le niveau « auto »
//      ne manque donc à personne ici : par le temps où un rapport peut partir du cockpit,
//      le niveau 3 (cache) a presque toujours déjà la réponse.
//   2. Appeler Resolve-SzhAncrage reviendrait à lancer un processus PowerShell depuis le
//      cockpit rien que pour écrire un rapport d'erreur : lent, fragile (dépend de
//      powershell.exe, d'un profil qui charge, d'un antivirus qui l'inspecte…), et
//      directement contraire à D5 (« un rapport ne doit jamais ralentir l'action en
//      cours »). Une résolution en process, en quelques appels fs.statSync, est la seule
//      qui tienne cette promesse.

// [Environment]::ExpandEnvironmentVariables côté PowerShell -> son équivalent : les jetons
// %NOM% d'une valeur venant de config.json sont développés depuis process.env. Sur Windows,
// la casse des noms de variables d'environnement n'est pas significative (Node aligne déjà
// process.env là-dessus sous win32).
function etendreVariablesEnvironnement(texte) {
  return String(texte === null || texte === undefined ? '' : texte).replace(/%([^%]+)%/g, (m, nom) => {
    const v = process.env[nom];
    return v === undefined ? m : v;
  });
}

function dossierExiste(p) {
  if (!p) { return false; }
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

// Un chemin d'ancrage peut arriver en barres obliques (habitude de shell : SZH_ANCRAGE
// tapée à la main, ou une valeur de config.json écrite ainsi) — tout comme
// codesErreur.versCheminRelatif() et masquer() acceptent déjà l'un ou l'autre séparateur
// en ENTRÉE pour reconnaître une racine (vérifié par l'exécution, pas supposé : les deux
// traitent une racine « C:/…/Daten_Allgemein - General » exactement comme sa forme en
// antislash). Mais le champ `ancrage.chemin` du rapport, lui, n'est PAS masqué (§4.1) :
// c'est un simple recopiage de la valeur résolue, et rien ne le passait par un
// normalisateur de séparateur. Deux conséquences concrètes, relevées en comparant les
// rapports des deux écrivains sur un même incident : le champ ne se collait plus
// proprement avec `fichiers[].chemin` (toujours en antislash) dans l'Explorateur, et
// PowerShell (qui normalise déjà côté Resolve-SzhAncrage) rendait une chaîne différente
// pour le MÊME ancrage — deux rapports du même incident cessaient d'être comparables.
//
// Simple remplacement de séparateur, pas une résolution de chemin (jamais path.normalize,
// qui collapserait aussi les « .. ») — même esprit que les remplacements déjà faits dans
// codes-erreur.js. Le séparateur final est retiré (sauf sur une racine de lecteur nue,
// improbable ici mais gardée par précaution).
function normaliserSeparateursAncrage(chemin) {
  if (!chemin) { return chemin; }
  let c = String(chemin).replace(/\//g, '\\');
  if (c.length > 3 && c.endsWith('\\')) { c = c.slice(0, -1); }
  return c;
}

// Résolution passive : rend { trouve, origine, chemin }. `origine` ∈ 'essai' | 'config' |
// 'cache' | 'absent' — jamais 'auto' ni 'utilisateur' ni 'defaut', réservés au lanceur.
// `chemin` est TOUJOURS normalisé en antislash (voir normaliserSeparateursAncrage
// ci-dessus), quelle que soit la forme reçue en entrée — variable d'environnement,
// config.json ou cache.
//
// D10 (amendement du 09.09.2026) : le niveau « essai » lit `SZH_ANCRAGE`, PAS
// `SZH_RAPPORTS` — cette dernière ne concerne QUE le dossier de rapports
// (resoudreDossierRapports() ci-dessus), jamais l'ancrage. `SZH_ANCRAGE` est la MÊME
// variable que Resolve-SzhAncrage côté PowerShell : une seule surcharge d'ancrage dans
// tout le produit, honorée identiquement par les deux langages.
function resoudreAncrage() {
  const essai = String(process.env.SZH_ANCRAGE || '').trim();
  if (essai && dossierExiste(essai)) {
    return { trouve: true, origine: 'essai', chemin: normaliserSeparateursAncrage(essai) };
  }

  const cfg = lireJsonTolerant(cheminConfigPoste());
  const brutConfig = String(cfg.ancrageSharePoint || '').trim();
  if (brutConfig) {
    const etendu = etendreVariablesEnvironnement(brutConfig);
    if (dossierExiste(etendu)) {
      return { trouve: true, origine: 'config', chemin: normaliserSeparateursAncrage(etendu) };
    }
  }

  const etat = lireEtatUtilisateur();
  const brutCache = String(etat.ancrageSharePoint || '').trim();
  if (brutCache && dossierExiste(brutCache)) {
    return { trouve: true, origine: 'cache', chemin: normaliserSeparateursAncrage(brutCache) };
  }

  return { trouve: false, origine: 'absent', chemin: null };
}

// Vrai si CETTE émission a une destination explicitement fournie par le test — via
// `SZH_ANCRAGE` (origine 'essai') OU via `SZH_RAPPORTS` (qui l'emporte de toute façon sur
// la dérivation, D10) : dans les deux cas, le dossier où l'écriture va réellement se
// produire est un dossier que le test a lui-même choisi, jamais un dossier réel du poste.
function destinationExplicitementFournieParEssai(ancrage) {
  return !!String(process.env.SZH_RAPPORTS || '').trim() || ancrage.origine === 'essai';
}

// Filet de sécurité propre au banc de test JS (celui-ci, pas une exigence de la spec) :
// test/js/hote-factice.js pose SZH_RESEAU_INTERDIT='1' pour TOUT test qui active
// l'extension, précisément pour empêcher un effet de bord réel pendant un test (son
// en-tête dit explicitement vouloir couvrir « n'importe quel futur module qui s'y
// brancherait »). Plusieurs fichiers de test déjà écrits, hors du périmètre de ce jalon
// (controles.test.js, interaction.test.js, pdfua.test.js), déclenchent une tâche de
// compilation avec un code de sortie non nul SANS jamais poser ni SZH_ANCRAGE ni
// SZH_RAPPORTS : sans cette garde, une simple exécution de ces tests écrirait pour de vrai
// dans le vrai %LOCALAPPDATA%\SZH\rapports-en-attente (ancrage introuvable sur un poste où
// ancrageSharePoint n'est pas encore configuré), ou pire, dans le vrai dossier SharePoint
// si un poste avait un ancrage déjà résolu. Une destination explicitement fournie par le
// test (voir ci-dessus) reste toujours honorée : c'est exactement ainsi que
// test/js/rapport-erreur.test.js éprouve l'écriture réelle, dans un dossier jetable.
// Aucune incidence en production : SZH_RESEAU_INTERDIT n'est jamais posé hors du banc de
// test. Nom de fonction gardé stable (ne pas renommer) : d'autres tests s'y réfèrent.
function ecritureReelleEviteeParHarnaisTest(ancrage) {
  return !!process.env.SZH_RESEAU_INTERDIT && !destinationExplicitementFournieParEssai(ancrage);
}

// ---------------------------------------------------------------------------------------
// 4. Contexte — versions, produit, horodatage local, extrait de journal, constats
// ---------------------------------------------------------------------------------------

// Version du toolkit installé sur le poste : le fichier VERSION du toolkit déployé, puis
// state.json en repli — même ordre que lib/archivage.js#versionInstallee(), rejoué ici en
// local pour ne pas dépendre de ce module (voir l'en-tête).
function versionToolkit() {
  try {
    const v = String(fs.readFileSync(cheminVersionToolkit(), 'utf8')).trim();
    if (v !== '') { return v; }
  } catch (e) { /* repli state.json */ }
  const etat = lireJsonTolerant(cheminStatePoste());
  const v = String(etat.version || '').trim();
  return v || null;
}

// Version du cockpit lui-même : celle que VSCodium a chargée, dans le package.json à côté
// de ce module (lib/../package.json) — une lecture statique, jamais celle d'un autre poste.
function versionCockpit() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const v = String(pkg.version || '').trim();
    return v || null;
  } catch (e) { return null; }
}

// L'emplacement courant (test|production), lu dans config.json — même clé et même ordre de
// repli que lib/archivage.js#resoudreEmplacementRevues, rejoués ici en local (voir l'en-
// tête : cette fonction-ci n'a besoin que d'une lecture, pas de toute l'écriture qui va
// avec côté archivage.js).
function emplacementCourant() {
  const cfg = lireJsonTolerant(cheminConfigPoste());
  const v = String(cfg.emplacementRevues || '').trim().toLowerCase();
  if (v === 'production') { return 'production'; }
  if (v === 'test') { return 'test'; }
  if ('devMode' in cfg) {
    const b = cfg.devMode;
    if (b === true || b === 'true' || b === 1) { return 'test'; }
    if (b === false || b === 'false' || b === 0) { return 'production'; }
  }
  return 'test';
}

// Best-effort, jamais bloquant : un ausgabe.yaml/buch.yaml illisible ou absent rend un
// produit partiel (numero: null), jamais une exception. Une regex suffit ici — ce module
// ne dépend pas de lib/yaml.js (voir l'en-tête) — pour extraire deux clés simples d'un
// fichier YAML à plat, tel que ces deux fichiers le sont toujours dans ce dépôt.
function produitDepuisRacine(racine, profilCle) {
  if (!racine) { return null; }
  const estLivre = profilCle === 'livre';
  const nomConfig = estLivre ? 'buch.yaml' : 'ausgabe.yaml';
  let numero = null;
  let lang = null;
  try {
    const texte = fs.readFileSync(path.join(racine, nomConfig), 'utf8');
    const mNumero = texte.match(/^\s*numero\s*:\s*["']?([^"'\r\n]+?)["']?\s*$/mi);
    if (mNumero) { numero = mNumero[1].trim(); }
    const mLang = texte.match(/^\s*lang\s*:\s*["']?([a-z]{2})["']?\s*$/mi);
    if (mLang) { lang = mLang[1].trim().toLowerCase(); }
  } catch (e) { /* fiche illisible : produit partiel, jamais une exception (D5) */ }
  // Revue et Zeitschrift partagent le même moteur (lib/profil.js) ; seule la langue de
  // rédaction (lang: de) distingue laquelle des deux maisons est concernée.
  const type = estLivre ? 'livre' : (lang === 'de' ? 'zeitschrift' : 'revue');
  return { type: type, numero: numero, emplacement: emplacementCourant() };
}

// horodatageLocal (§4) : le même instant que `horodatage`, à l'heure DU POSTE, décalage
// inclus — pour la personne qui relit, jamais pour le tri (qui reste sur l'UTC de l'id,
// voir codesErreur.calculerId). Getters locaux de `date`, donc dépendant du fuseau du
// poste qui écrit le rapport — c'est le but.
function formaterHorodatageLocal(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  const decalageMin = -date.getTimezoneOffset();
  const signe = decalageMin >= 0 ? '+' : '-';
  const abs = Math.abs(decalageMin);
  return date.getFullYear() + '-' + p2(date.getMonth() + 1) + '-' + p2(date.getDate())
    + 'T' + p2(date.getHours()) + ':' + p2(date.getMinutes()) + ':' + p2(date.getSeconds())
    + signe + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60);
}

// Lit un fichier texte et en rend un extrait exploitable par le champ `journal` (§4) :
// chemin ABSOLU (la mise en chemin relatif et le masquage se font dans construireRapport,
// avec les racines du poste), nombre de lignes réel, et les lignes elles-mêmes — le
// plafonnage aux 200 dernières / 40 000 caractères est fait par
// codesErreur.appliquerPlafonds(), pas ici. Fichier absent ou illisible -> null : pas de
// journal à joindre n'est pas une panne.
function lireExtraitFichier(chemin) {
  if (!chemin) { return null; }
  let texte;
  try { texte = fs.readFileSync(chemin, 'utf8'); }
  catch (e) { return null; }
  let lignes = String(texte).split(/\r\n|\r|\n/);
  if (lignes.length && lignes[lignes.length - 1] === '') { lignes = lignes.slice(0, -1); }
  return { chemin: chemin, lignes: lignes.length, tronque: false, extrait: lignes };
}

// Réduit un constat de lib/journal.js (source, code, ton, cle, args, slug, brut…) aux
// quatre champs que le schéma v1 attend (§4, exemple) — un rapport n'a pas besoin de la clé
// i18n ni des arguments de mise en forme, seulement de quoi identifier le constat.
function normaliserConstats(constats) {
  return (constats || []).map((c) => ({
    source: (c && c.source !== undefined && c.source !== null) ? c.source : null,
    code: (c && c.code !== undefined && c.code !== null) ? c.code : null,
    ton: (c && c.ton !== undefined && c.ton !== null) ? c.ton : null,
    slug: (c && c.slug !== undefined && c.slug !== null) ? c.slug : null
  }));
}

// ---------------------------------------------------------------------------------------
// 5. Construction du rapport — pure : tout le disque et l'environnement sont déjà résolus
//    par l'appelant (emettreRapport, §8) et passés en paramètres.
// ---------------------------------------------------------------------------------------

// { chemin, relatifA } pour un chemin ABSOLU quelconque : ancrage d'abord (D3, l'ordre
// compte, voir codes-erreur.js), programData ensuite, et si aucun des deux ne s'applique,
// un chemin absolu passé au masquage (§4.1, règle 2 : %USERPROFILE% -> ~\…) plutôt que
// laissé tel quel en clair.
function cheminRelatifAvecRepli(cheminAbsolu, racines) {
  let r = codesErreur.versCheminRelatif(cheminAbsolu, racines.ancrage, 'ancrage');
  if (r.relatifA === 'absolu' && racines.programData) {
    const r2 = codesErreur.versCheminRelatif(cheminAbsolu, racines.programData, 'programdata');
    if (r2.relatifA !== 'absolu') { r = r2; }
  }
  if (r.relatifA === 'absolu') {
    r = { chemin: codesErreur.masquer(r.chemin, racines), relatifA: 'absolu' };
  }
  return r;
}

// `p` porte tout ce qu'il faut, déjà calculé par emettreRapport : id, horodatage(s),
// gravite/source/code/signature, poste, versions, produit, ancrage (déjà résolu), fichiers
// et journal en chemins ABSOLUS (mis en relatif ici), constats déjà normalisés,
// environnement, et `racines` pour le masquage (ancrage/userProfile/programData).
//
// Construit l'objet dans l'ordre EXACT de codesErreur.ORDRE_CLES_RAPPORT (validerRapport()
// le contrôle), passe message/pile/journal.extrait par le masquage, `fichiers`/`journal`
// par la mise en chemin relatif, puis délègue à codesErreur.appliquerPlafonds().
function construireRapport(p) {
  const racines = p.racines || {};

  const fichiers = (p.fichiers || [])
    .filter((f) => f && f.chemin !== null && f.chemin !== undefined && f.chemin !== '')
    .map((f) => {
      const rel = cheminRelatifAvecRepli(f.chemin, racines);
      return { chemin: rel.chemin, relatifA: rel.relatifA, role: (f.role === undefined ? null : f.role) };
    });

  let journal = null;
  if (p.journal) {
    const rel = cheminRelatifAvecRepli(p.journal.chemin, racines);
    journal = {
      chemin: rel.chemin,
      relatifA: rel.relatifA,
      lignes: (p.journal.lignes === undefined || p.journal.lignes === null) ? null : p.journal.lignes,
      tronque: !!p.journal.tronque,
      extrait: (p.journal.extrait || []).map((ligne) => codesErreur.masquer(ligne, racines))
    };
  }

  const resume = (codesErreur.CODES[p.code] && codesErreur.CODES[p.code].resume)
    || { fr: null, de: null };

  const rapport = {
    schema: codesErreur.SCHEMA_VERSION,
    id: p.id,
    horodatage: p.horodatage,
    horodatageLocal: p.horodatageLocal,
    gravite: p.gravite,
    source: p.source,
    code: p.code,
    signature: p.signature,
    resume: resume,
    etape: (p.etape === undefined || p.etape === null) ? null : p.etape,
    message: (p.message === undefined || p.message === null) ? null : codesErreur.masquer(p.message, racines),
    pile: (p.pile === undefined || p.pile === null) ? null : codesErreur.masquer(p.pile, racines),
    poste: p.poste || null,
    versions: p.versions || null,
    produit: p.produit || null,
    ancrage: p.ancrage || { trouve: false, origine: 'absent', chemin: null },
    fichiers: fichiers,
    journal: journal,
    constats: normaliserConstats(p.constats),
    environnement: (p.environnement === undefined ? null : p.environnement)
  };

  return codesErreur.appliquerPlafonds(rapport);
}

// ---------------------------------------------------------------------------------------
// 6. Anti-inondation (§4.3) — pur, étant donné les compteurs et l'horloge.
// ---------------------------------------------------------------------------------------

function formaterJourLocal(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + p2(date.getMonth() + 1) + '-' + p2(date.getDate());
}

// Retire du compteur toute signature vue il y a plus de 7 jours (§4.3). `_jour` et
// `_compte` sont traités à part par decisionAntiInondation() : ce ne sont pas des
// signatures, ils portent le jour courant et son compte.
function purgerCompteursRapports(rapports, maintenant) {
  const seuil = maintenant.getTime() - codesErreur.ANTI_INONDATION.purgeCompteursJours * 24 * 3600 * 1000;
  const sortie = {};
  const source = rapports || {};
  for (const cle of Object.keys(source)) {
    if (cle === '_jour' || cle === '_compte') { continue; }
    const t = Date.parse(source[cle]);
    if (!Number.isNaN(t) && t >= seuil) { sortie[cle] = source[cle]; }
  }
  return sortie;
}

// Rend { autorise, motif, rapports } : `rapports` est TOUJOURS la valeur à réécrire dans
// etat-utilisateur.json (purge appliquée, compteur du jour tenu à jour), que la décision
// autorise ou non l'écriture — un rapport étouffé n'est pas mis en attente (il est perdu),
// mais les compteurs, eux, doivent survivre pour que le prochain appel voie juste.
//
//   - Une signature revue avant le délai (24 h par défaut) : étouffé, motif
//     'signature-recente'. Ne compte PAS dans le plafond du jour (seul un rapport
//     réellement écrit incrémente `_compte` — voir plus bas).
//   - Sinon, le plafond quotidien atteint (20 par défaut, compteur remis à 0 à chaque
//     nouveau jour local) : étouffé, motif 'plafond-jour'.
//   - Sinon, autorisé : la signature et le compteur du jour sont mis à jour.
function decisionAntiInondation(rapports, signature, maintenant) {
  const jour = formaterJourLocal(maintenant);
  const purge = purgerCompteursRapports(rapports, maintenant);
  const source = rapports || {};
  const compteAvant = (source._jour === jour) ? (Number(source._compte) || 0) : 0;

  const derniereFois = purge[signature];
  if (derniereFois) {
    const depuisMs = maintenant.getTime() - Date.parse(derniereFois);
    const periodeMs = codesErreur.ANTI_INONDATION.signaturePeriodeHeures * 3600 * 1000;
    if (!Number.isNaN(depuisMs) && depuisMs >= 0 && depuisMs < periodeMs) {
      return { autorise: false, motif: 'signature-recente',
        rapports: Object.assign({}, purge, { _jour: jour, _compte: compteAvant }) };
    }
  }

  if (compteAvant >= codesErreur.ANTI_INONDATION.rapportsParJourMax) {
    return { autorise: false, motif: 'plafond-jour',
      rapports: Object.assign({}, purge, { _jour: jour, _compte: compteAvant }) };
  }

  const nouveau = Object.assign({}, purge, {
    _jour: jour, _compte: compteAvant + 1
  });
  nouveau[signature] = maintenant.toISOString();
  return { autorise: true, motif: null, rapports: nouveau };
}

// ---------------------------------------------------------------------------------------
// 7. File d'attente hors ligne (§4.4)
// ---------------------------------------------------------------------------------------

// Écrit un rapport (déjà construit et validé) en <dossier>\<id>.json, UTF-8 sans BOM,
// indenté 2 espaces (§4). Crée le dossier au besoin ; lève si l'écriture échoue — c'est
// l'appelant (emettreRapport) qui décide quoi faire d'un échec (repli sur la file, puis
// abandon silencieux), jamais cette fonction-ci.
function ecrireRapportSurDisque(dossier, rapport) {
  fs.mkdirSync(dossier, { recursive: true });
  const cible = path.join(dossier, rapport.id + '.json');
  const tmp = cible + '.tmp-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  fs.writeFileSync(tmp, JSON.stringify(rapport, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, cible);
}

// Les fichiers .json de la file d'attente, du plus ancien au plus récent (mtime) — pour
// que « les plus anciens sont effacés » (§4.4) et « vidée » (le vidage tente les plus
// anciens d'abord) traitent toujours dans le même ordre. Dossier absent -> liste vide,
// jamais une exception (D5) : une file jamais utilisée n'a pas de dossier.
function listerFileAttente() {
  const dossier = cheminDossierAttente();
  let noms;
  try { noms = fs.readdirSync(dossier); } catch (e) { return []; }
  const fichiers = [];
  for (const nom of noms) {
    if (!nom.endsWith('.json')) { continue; }
    const chemin = path.join(dossier, nom);
    let mtime = 0;
    try { mtime = fs.statSync(chemin).mtimeMs; } catch (e) { continue; }
    fichiers.push({ chemin: chemin, nom: nom, mtime: mtime });
  }
  fichiers.sort((a, b) => a.mtime - b.mtime);
  return fichiers;
}

// Applique les deux plafonds de la file (§4.4) : fichiers de plus de 30 jours effacés SANS
// être transmis, puis, au-delà de 50 fichiers restants, les plus anciens effacés. Rend la
// liste (déjà purgée) qui subsiste, pour que viderFileAttente() n'ait pas à relire le
// dossier une seconde fois.
function purgerFileAttente(maintenant) {
  const now = maintenant || new Date();
  const seuilAge = now.getTime() - PLAFONDS_ATTENTE.jours * 24 * 3600 * 1000;
  let fichiers = listerFileAttente().filter((f) => {
    if (f.mtime < seuilAge) { try { fs.unlinkSync(f.chemin); } catch (e) { /* on réessaiera */ } return false; }
    return true;
  });
  if (fichiers.length > PLAFONDS_ATTENTE.fichiers) {
    const enTrop = fichiers.length - PLAFONDS_ATTENTE.fichiers;
    for (let i = 0; i < enTrop; i++) { try { fs.unlinkSync(fichiers[i].chemin); } catch (e) { /* … */ } }
    fichiers = fichiers.slice(enTrop);
  }
  return fichiers;
}

// Vidée « au démarrage du lanceur » côté PowerShell ; côté cockpit, à l'activation de
// l'extension (accroche minimale dans extension.js, qui ne fait qu'appeler cette
// fonction). Chaque fichier restant après les plafonds est déplacé vers le vrai dossier de
// rapports ; un échec (dossier toujours injoignable) le laisse en place pour la prochaine
// tentative — jamais une exception qui remonterait jusqu'à activate().
function viderFileAttente() {
  try {
    const ancrage = resoudreAncrage();
    // D10 : le dossier d'écriture peut venir de SZH_RAPPORTS même si l'ancrage lui-même
    // reste introuvable — resoudreDossierRapports() porte cette règle, ici comme dans
    // emettreRapport().
    const dossier = resoudreDossierRapports(ancrage);
    if (!dossier) { return { deplaces: 0, restes: 0 }; }
    if (ecritureReelleEviteeParHarnaisTest(ancrage)) { return { deplaces: 0, restes: 0 }; }
    const fichiers = purgerFileAttente();
    let deplaces = 0;
    for (const f of fichiers) {
      try {
        fs.mkdirSync(dossier, { recursive: true });
        fs.renameSync(f.chemin, path.join(dossier, f.nom));
        deplaces++;
      } catch (e) { /* dossier toujours injoignable : on laisse en place (§4.4) */ }
    }
    if (deplaces > 0 || fichiers.length > 0) {
      console.log('[rapport-erreur] file d’attente : ' + deplaces + '/' + fichiers.length + ' déplacé(s).');
    }
    return { deplaces: deplaces, restes: fichiers.length - deplaces };
  } catch (e) {
    // D5 : le vidage de la file ne doit jamais empêcher l'activation de l'extension.
    console.log('[rapport-erreur] vidage de la file d’attente impossible : ' + ((e && e.message) || e));
    return { deplaces: 0, restes: 0 };
  }
}

// ---------------------------------------------------------------------------------------
// 8. L'orchestrateur — la seule fonction que les accroches d'extension.js appellent.
// ---------------------------------------------------------------------------------------

// codesErreur.calculerId lève si on ne lui passe pas 6 hex — délibérément (voir son en-
// tête) : genererAleatoireHex() en rend toujours 6, donc cela ne devrait jamais arriver,
// mais D5 interdit qu'une exception, fût-elle improbable, s'échappe d'ici.
function genererId(horodatage, poste) {
  try { return codesErreur.calculerId(horodatage, poste, codesErreur.genererAleatoireHex()); }
  catch (e) { return null; }
}

// `champs` (tout optionnel sauf gravite/source/code, en pratique toujours fournis par les
// accroches) :
//   gravite, source, code, etape, message, pile           -- le cœur de l'erreur
//   produit        { type, numero, emplacement } | null   -- rapport-erreur.produitDepuisRacine() aide à le remplir
//   fichiers       [{ chemin(absolu), role }]              -- mis en relatif et masqués ici
//   journal        { chemin(absolu), lignes, extrait }     -- lireExtraitFichier() le construit
//   constats       [...]                                   -- lib/journal.js, normalisés ici
//   environnement  objet | null
//   langueInterface, vscodiumVersion                       -- ce que seul l'appelant (extension.js) connaît
//
// Rend TOUJOURS { ecrit, enAttente, etouffe, id, motif } — jamais ne lève (D5). `motif`
// documente pourquoi rien n'a été écrit (mal-forme, signature-recente, plafond-jour,
// ecriture-impossible, exception-interne), ou reste null sur un succès.
function emettreRapport(champs) {
  try {
    const c = champs || {};
    const maintenant = new Date();
    const ancrage = resoudreAncrage();
    if (ecritureReelleEviteeParHarnaisTest(ancrage)) {
      console.log('[rapport-erreur] ' + c.code + ' : écriture réelle évitée (banc de test JS, '
        + 'destination non fournie par SZH_ANCRAGE ni SZH_RAPPORTS).');
      return { ecrit: false, enAttente: false, etouffe: false, id: null, motif: 'harnais-test' };
    }
    const racines = {
      ancrage: ancrage.chemin,
      userProfile: process.env.USERPROFILE || null,
      programData: racineProgramData()
    };

    const posteNom = os.hostname();
    let utilisateur = process.env.USERNAME || null;
    if (!utilisateur) { try { utilisateur = os.userInfo().username; } catch (e) { utilisateur = null; } }
    const poste = {
      nom: posteNom,
      utilisateur: utilisateur,
      os: os.release() || null,
      powershell: null,
      langueInterface: (c.langueInterface === undefined || c.langueInterface === null) ? null : c.langueInterface
    };
    const versions = {
      toolkit: versionToolkit(),
      cockpit: versionCockpit(),
      vscodium: (c.vscodiumVersion === undefined || c.vscodiumVersion === null) ? null : c.vscodiumVersion
    };

    const id = genererId(maintenant, posteNom);
    if (!id) {
      console.log('[rapport-erreur] ' + c.code + ' abandonné : id invalide.');
      return { ecrit: false, enAttente: false, etouffe: false, id: null, motif: 'id-invalide' };
    }

    const messageMasque = (c.message === undefined || c.message === null) ? '' : codesErreur.masquer(c.message, racines);
    const signature = codesErreur.calculerSignature({
      source: c.source, code: c.code, etape: c.etape, messageMasque: messageMasque,
      produitNumero: c.produit && c.produit.numero
    });

    const rapport = construireRapport({
      id: id,
      horodatage: maintenant.toISOString(),
      horodatageLocal: formaterHorodatageLocal(maintenant),
      gravite: c.gravite || 'erreur',
      source: c.source,
      code: c.code,
      signature: signature,
      etape: c.etape,
      message: c.message,
      pile: c.pile,
      poste: poste,
      versions: versions,
      produit: c.produit || null,
      ancrage: { trouve: ancrage.trouve, origine: ancrage.origine, chemin: ancrage.chemin },
      fichiers: c.fichiers || [],
      journal: c.journal || null,
      constats: c.constats || [],
      environnement: c.environnement,
      racines: racines
    });

    const ecarts = codesErreur.validerRapport(rapport);
    if (ecarts.length) {
      console.log('[rapport-erreur] ' + c.code + ' abandonné, mal formé : ' + ecarts.join(' ; '));
      return { ecrit: false, enAttente: false, etouffe: false, id: id, motif: 'mal-forme' };
    }

    // Anti-inondation : les compteurs sont réécrits que la décision autorise ou non, pour
    // que le prochain appel voie l'état à jour (§4.3).
    const etatAvant = lireEtatUtilisateur();
    const rapportsAvant = (etatAvant.rapports && typeof etatAvant.rapports === 'object') ? etatAvant.rapports : {};
    const decision = decisionAntiInondation(rapportsAvant, signature, maintenant);
    ecrireEtatUtilisateur((avant) => Object.assign({}, avant, { rapports: decision.rapports }));
    if (!decision.autorise) {
      console.log('[rapport-erreur] ' + c.code + ' étouffé par l’anti-inondation (' + decision.motif + '), perdu.');
      return { ecrit: false, enAttente: false, etouffe: true, id: id, motif: decision.motif };
    }

    // D10 : SZH_RAPPORTS, quand elle est posée, donne le dossier D'ÉCRITURE directement —
    // sans condition sur l'ancrage. Sans elle, on retombe sur la dérivation habituelle.
    const dossierCible = resoudreDossierRapports(ancrage);
    if (dossierCible) {
      try {
        ecrireRapportSurDisque(dossierCible, rapport);
        console.log('[rapport-erreur] ' + id + ' écrit (' + c.code + ').');
        return { ecrit: true, enAttente: false, etouffe: false, id: id, motif: null };
      } catch (e) {
        console.log('[rapport-erreur] dossier de rapports injoignable (' + ((e && e.message) || e) + '), mise en attente.');
        // tombe dans la file ci-dessous
      }
    } else {
      console.log('[rapport-erreur] aucun ancrage résolu, mise en attente.');
    }

    try {
      ecrireRapportSurDisque(cheminDossierAttente(), rapport);
      purgerFileAttente();
      console.log('[rapport-erreur] ' + id + ' mis en attente.');
      return { ecrit: false, enAttente: true, etouffe: false, id: id, motif: null };
    } catch (e2) {
      // D5, la règle absolue : un échec d'écriture ne produit PAS un second rapport (pas de
      // boucle sur RAPPORT-ECHEC-ECRITURE, jamais écrit en JSON — voir codes-erreur.js) ;
      // seule cette ligne locale le dit.
      console.log('[rapport-erreur] écriture impossible, y compris en attente (' + ((e2 && e2.message) || e2) + ') — abandon silencieux.');
      return { ecrit: false, enAttente: false, etouffe: false, id: id, motif: 'ecriture-impossible' };
    }
  } catch (e) {
    // Garde absolue (D5) : quoi qu'il arrive, cette fonction ne lève jamais.
    console.log('[rapport-erreur] échec interne inattendu : ' + ((e && e.message) || e));
    return { ecrit: false, enAttente: false, etouffe: false, id: null, motif: 'exception-interne' };
  }
}

module.exports = {
  // Constantes.
  SEGMENTS_DOSSIER_RAPPORTS,
  PLAFONDS_ATTENTE,
  // Racines et chemins (impurs : environnement + disque).
  racineProgramData, racineUtilisateur,
  cheminConfigPoste, cheminStatePoste, cheminVersionToolkit,
  cheminEtatUtilisateur, cheminDossierAttente,
  // Ancrage.
  resoudreAncrage, dossierRapportsDepuisAncrage, resoudreDossierRapports,
  normaliserSeparateursAncrage,
  ecritureReelleEviteeParHarnaisTest,
  // Contexte.
  versionToolkit, versionCockpit, emplacementCourant, produitDepuisRacine,
  formaterHorodatageLocal, lireExtraitFichier, normaliserConstats,
  // État utilisateur (compteurs anti-inondation, cache d'ancrage).
  lireEtatUtilisateur, ecrireEtatUtilisateur,
  // Construction — pure.
  construireRapport,
  // Anti-inondation — pure.
  purgerCompteursRapports, decisionAntiInondation,
  // File d'attente hors ligne.
  listerFileAttente, purgerFileAttente, viderFileAttente,
  // Orchestrateur.
  genererId, emettreRapport
};
