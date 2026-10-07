// Écrit les rapports d'erreur automatiques du cockpit (docs/RAPPORTS-ERREUR.md). Construit
// un rapport au schéma v1, résout l'ancrage SharePoint sans balayer le disque ni ouvrir de
// fenêtre, applique l'anti-inondation et la file d'attente hors ligne, puis écrit le
// fichier. Ne lève jamais : un rapport ne doit pas gêner l'action en cours.
//
// Les codes, le schéma, le masquage, les plafonds, la validation, l'id et la signature
// viennent de lib/codes-erreur.js ; ce module ajoute la construction et l'écriture.
//
// Dépendances limitées à fs, path, os, codes-erreur.js et poste.js, sans vscode : le module
// se charge hors de l'éditeur (test/js/rapport-erreur.test.js), et l'écrivain PowerShell
// (windows/szh-rapport.ps1) peut en reproduire la logique. La lecture tolérante de
// config.json et l'écriture atomique sont donc reprises ici plutôt que requises de
// lib/archivage.js ou lib/yaml.js.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const codesErreur = require('./codes-erreur');
const { basePoste, racineUtilisateur, dossierProfil } = require('./poste');

// ---------------------------------------------------------------------------------------
// 1. Racines et chemins, surchargeables pour les tests
// ---------------------------------------------------------------------------------------
//
// Quatre variables, indépendantes :
//   SZH_ANCRAGE    -> le niveau « essai » de la résolution de l'ancrage (section 3). Même
//                     variable que Resolve-SzhAncrage côté PowerShell.
//   SZH_RAPPORTS   -> le dossier de rapports lui-même. Elle remplace seulement le dossier
//                     d'écriture : l'ancrage du rapport et les chemins relatifs restent
//                     calculés depuis l'ancrage (voir resoudreDossierRapports()).
//   SZH_BASE       -> remplace C:\ProgramData\SZH (config.json, état du poste, toolkit
//                     installé), comme $env:SZH_BASE côté PowerShell.
//   LOCALAPPDATA   -> la variable Windows ; %LOCALAPPDATA%\SZH contient
//                     etat-utilisateur.json.
// Des fonctions plutôt que des constantes, pour qu'une variable posée après le require
// soit vue au prochain appel.
function racineProgramData() {
  return basePoste();
}
function cheminConfigPoste() { return path.join(racineProgramData(), 'config.json'); }
function cheminStatePoste() { return path.join(racineProgramData(), 'state.json'); }
function cheminVersionToolkit() { return path.join(racineProgramData(), 'toolkit', 'VERSION'); }
function cheminEtatUtilisateur() { return path.join(racineUtilisateur(), 'SZH', 'etat-utilisateur.json'); }
function cheminDossierAttente() { return path.join(racineUtilisateur(), 'SZH', 'rapports-en-attente'); }
// La file des compteurs d'usage (lib/compteurs.js), distincte de celle des rapports.
function cheminDossierCompteursAttente() { return path.join(racineUtilisateur(), 'SZH', 'compteurs-en-attente'); }

// =======================================================================================
// Le nom du dossier de production de Pronto, seul endroit où il est écrit côté JavaScript.
// Numéros, archives, fiches, rapports et journaux sont sous ce dossier. Son pendant
// PowerShell est $script:SzhSegmentApplication (windows/szh-ancrage.ps1) : les deux
// changent ensemble, et test/js/rapport-erreur-ps.test.js compare les deux dérivations.
const SEGMENT_APPLICATION = '54_Pronto';
// =======================================================================================

// Le dossier des rapports, relatif à l'ancrage. Pendant PowerShell :
// $script:SzhDeriveDossierRapports (windows/szh-ancrage.ps1).
const SEGMENTS_DOSSIER_RAPPORTS = ['2_Produkte', SEGMENT_APPLICATION, '_Systeme', 'rapports'];

function dossierRapportsDepuisAncrage(ancrage) {
  return dossierSystemeDepuisAncrage(ancrage, 'rapports');
}

// Un sous-dossier de `_Systeme` (rapports, compteurs…), dérivé des segments des rapports :
// le segment de l'application n'est jamais recopié. Nom de sous-dossier hors `[A-Za-z0-9_-]+`
// -> null, pour qu'un appelant ne puisse pas remonter l'arborescence.
function dossierSystemeDepuisAncrage(ancrage, sousDossier) {
  if (!ancrage) { return null; }
  if (!/^[A-Za-z0-9_-]+$/.test(String(sousDossier || ''))) { return null; }
  const segments = SEGMENTS_DOSSIER_RAPPORTS.slice(0, -1).concat(sousDossier);
  return path.join.apply(path, [ancrage].concat(segments));
}

// Le dossier d'écriture des rapports. `SZH_RAPPORTS`, si elle est posée, est prise telle
// quelle. Sinon, le dossier se déduit de l'ancrage résolu ; null si l'ancrage est
// introuvable.
function resoudreDossierRapports(ancrage) {
  const surcharge = String(process.env.SZH_RAPPORTS || '').trim();
  if (surcharge) { return surcharge; }
  if (!ancrage || !ancrage.trouve) { return null; }
  return dossierRapportsDepuisAncrage(ancrage.chemin);
}

// Plafonds de la file d'attente hors ligne, distincts des plafonds de contenu d'un rapport
// (codesErreur.PLAFONDS).
const PLAFONDS_ATTENTE = Object.freeze({ fichiers: 50, jours: 30 });
// Les compteurs sont petits et nombreux : plafonds plus larges, même mécanique.
const PLAFONDS_ATTENTE_COMPTEURS = Object.freeze({ fichiers: 200, jours: 90 });

// ---------------------------------------------------------------------------------------
// 2. Lecture tolérante et écriture atomique (reprises de lib/archivage.js, voir l'en-tête)
// ---------------------------------------------------------------------------------------

// JSON.parse tolérant, pour config.json et etat-utilisateur.json : BOM retiré
// (Save-SzhState et certains éditeurs Windows en posent un, que JSON.parse refuse) ;
// fichier absent ou illisible -> objet vide.
function lireJsonTolerant(chemin) {
  try {
    const brut = String(fs.readFileSync(chemin, 'utf8')).replace(/^\uFEFF/, '');
    const valeur = JSON.parse(brut);
    return (valeur && typeof valeur === 'object' && !Array.isArray(valeur)) ? valeur : {};
  } catch (e) { return {}; }
}

// Le nom du fichier temporaire d'une écriture atomique, dans le même dossier que la cible
// (un renommage n'est atomique qu'à l'intérieur d'un volume). Le préfixe « ~$ » est ignoré
// par OneDrive, qui ne synchronise donc pas ces fichiers (même règle que ecrireAtomique de
// lib/yaml.js).
function cheminTemporaire(cible) {
  const jeton = process.pid + '.' + Date.now().toString(36) + '.' + Math.random().toString(36).slice(2, 8);
  return path.join(path.dirname(cible), '~$' + path.basename(cible) + '.' + jeton);
}

// Écrit un JSON UTF-8 sans BOM, indenté de 2 espaces, dans un fichier temporaire puis
// renommé : une lecture concurrente ne voit jamais un fichier à moitié écrit. Le `finally`
// retire le temporaire si le renommage échoue (cible verrouillée, disque plein…) ; après un
// renommage réussi, il n'existe plus.
function ecrireJsonAtomique(chemin, valeur) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const tmp = cheminTemporaire(chemin);
  try {
    fs.writeFileSync(tmp, JSON.stringify(valeur, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, chemin);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
}

function lireEtatUtilisateur() { return lireJsonTolerant(cheminEtatUtilisateur()); }

// Lecture-modification-écriture : `fn` reçoit l'objet lu (jamais null) et rend l'objet à
// écrire. Ne lève jamais : au pire, l'anti-inondation oublie ses compteurs.
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
// 3. Résolution passive de l'ancrage
// ---------------------------------------------------------------------------------------
//
// Trois niveaux : essai (SZH_ANCRAGE), config, cache. Chacun ne fait qu'un fs.statSync sur
// un chemin connu, sans parcourir de dossier ni ouvrir de fenêtre, et rend
// `origine: 'absent'` si rien n'aboutit.
//
// La détection automatique et la question à l'utilisateur·trice restent au lanceur
// (Resolve-SzhAncrage). Le lanceur s'exécute avant le cockpit et met l'ancrage en cache
// dans etat-utilisateur.json : le cache suffit presque toujours. Lancer PowerShell depuis
// le cockpit pour un rapport serait lent et fragile.

// Équivalent de [Environment]::ExpandEnvironmentVariables : développe les %NOM% d'une
// valeur de config.json depuis process.env (insensible à la casse sous win32).
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

// Un chemin d'ancrage peut arriver avec des barres obliques (SZH_ANCRAGE ou config.json).
// Le champ `ancrage.chemin` du rapport est recopié tel quel : on le passe en antislashs,
// comme `fichiers[].chemin` et comme le fait Resolve-SzhAncrage, pour que les rapports des
// deux écrivains soient comparables.
//
// Simple remplacement de séparateur : path.normalize réduirait aussi les « .. ». Le
// séparateur final est retiré, sauf sur une racine de lecteur nue.
function normaliserSeparateursAncrage(chemin) {
  if (!chemin) { return chemin; }
  let c = String(chemin).replace(/\//g, '\\');
  if (c.length > 3 && c.endsWith('\\')) { c = c.slice(0, -1); }
  return c;
}

// Résolution passive : rend { trouve, origine, chemin }. `origine` ∈ 'essai' | 'config' |
// 'cache' | 'absent' ('auto', 'utilisateur' et 'defaut' sont réservés au lanceur).
// `chemin` est toujours en antislashs (normaliserSeparateursAncrage). Le niveau « essai »
// lit `SZH_ANCRAGE`, comme Resolve-SzhAncrage.
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

// Vrai si le dossier d'écriture a été choisi par le test, via `SZH_ANCRAGE` (origine
// 'essai') ou `SZH_RAPPORTS`.
function destinationExplicitementFournieParEssai(ancrage) {
  return !!String(process.env.SZH_RAPPORTS || '').trim() || ancrage.origine === 'essai';
}

// Garde des tests : test/js/hote-factice.js pose SZH_RESEAU_INTERDIT pour tout test qui
// active l'extension. Certains de ces tests font échouer une compilation sans poser
// SZH_ANCRAGE ni SZH_RAPPORTS ; sans cette garde, ils écriraient un rapport dans le vrai
// dossier d'attente ou sur SharePoint. Un dossier choisi par le test reste honoré.
// SZH_RESEAU_INTERDIT n'est jamais posée en production. Des tests appellent cette fonction
// par son nom.
function ecritureReelleEviteeParHarnaisTest(ancrage) {
  return !!process.env.SZH_RESEAU_INTERDIT && !destinationExplicitementFournieParEssai(ancrage);
}

// ---------------------------------------------------------------------------------------
// 4. Contexte — versions, produit, horodatage local, extrait de journal, constats
// ---------------------------------------------------------------------------------------

// Version du toolkit installé : le fichier VERSION du toolkit déployé, sinon state.json
// (même ordre que lib/archivage.js#versionInstallee()).
function versionToolkit() {
  try {
    const v = String(fs.readFileSync(cheminVersionToolkit(), 'utf8')).trim();
    if (v !== '') { return v; }
  } catch (e) { /* repli state.json */ }
  const etat = lireJsonTolerant(cheminStatePoste());
  const v = String(etat.version || '').trim();
  return v || null;
}

// Version du cockpit chargé, lue dans son package.json (lib/../package.json).
function versionCockpit() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
    const v = String(pkg.version || '').trim();
    return v || null;
  } catch (e) { return null; }
}

// L'emplacement courant (test|production), lu dans config.json, avec le même repli que
// lib/archivage.js#resoudreEmplacementRevues.
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

// Un ausgabe.yaml ou buch.yaml illisible ou absent rend un produit partiel (numero: null).
// Une expression régulière suffit pour lire deux clés de premier niveau.
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
  } catch (e) { /* fiche illisible : produit partiel */ }
  // Revue et Zeitschrift ne se distinguent que par la langue (lang: de).
  const type = estLivre ? 'livre' : (lang === 'de' ? 'zeitschrift' : 'revue');
  return { type: type, numero: numero, emplacement: emplacementCourant() };
}

// horodatageLocal : le même instant que `horodatage`, à l'heure du poste avec son
// décalage, pour la lecture. Le tri se fait sur l'UTC de l'id (codesErreur.calculerId).
function formaterHorodatageLocal(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  const decalageMin = -date.getTimezoneOffset();
  const signe = decalageMin >= 0 ? '+' : '-';
  const abs = Math.abs(decalageMin);
  return date.getFullYear() + '-' + p2(date.getMonth() + 1) + '-' + p2(date.getDate())
    + 'T' + p2(date.getHours()) + ':' + p2(date.getMinutes()) + ':' + p2(date.getSeconds())
    + signe + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60);
}

// L'extrait d'un fichier texte pour le champ `journal` : chemin absolu (rendu relatif et
// masqué par construireRapport), nombre de lignes et lignes. La limite (200 dernières
// lignes, 40 000 caractères) est appliquée par codesErreur.appliquerPlafonds(). Fichier
// absent ou illisible -> null.
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
// quatre champs du schéma v1.
function normaliserConstats(constats) {
  return (constats || []).map((c) => ({
    source: (c && c.source !== undefined && c.source !== null) ? c.source : null,
    code: (c && c.code !== undefined && c.code !== null) ? c.code : null,
    ton: (c && c.ton !== undefined && c.ton !== null) ? c.ton : null,
    slug: (c && c.slug !== undefined && c.slug !== null) ? c.slug : null
  }));
}

// ---------------------------------------------------------------------------------------
// 5. Construction du rapport, à partir de valeurs déjà résolues par emettreRapport
// ---------------------------------------------------------------------------------------

// { chemin, relatifA } pour un chemin absolu : relatif à l'ancrage d'abord (l'ordre compte,
// voir codes-erreur.js), puis à programData ; sinon le chemin absolu masqué
// (%USERPROFILE% -> ~\…).
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

// `p` vient d'emettreRapport : id, horodatages, gravite/source/code/signature, poste,
// versions, produit, ancrage résolu, fichiers et journal en chemins absolus, constats
// normalisés, environnement, et `racines` pour le masquage (ancrage/userProfile/programData).
//
// Construit l'objet dans l'ordre de codesErreur.ORDRE_CLES_RAPPORT (contrôlé par
// validerRapport()), masque message, pile et journal.extrait, rend relatifs les chemins de
// `fichiers` et `journal`, puis applique codesErreur.appliquerPlafonds().
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
// 6. Anti-inondation, à partir des compteurs et de l'horloge
// ---------------------------------------------------------------------------------------

function formaterJourLocal(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  return date.getFullYear() + '-' + p2(date.getMonth() + 1) + '-' + p2(date.getDate());
}

// Retire du compteur toute signature vue il y a plus de 7 jours. `_jour` et `_compte`
// (le jour courant et son compte) sont traités par decisionAntiInondation().
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

// Rend { autorise, motif, rapports } : `rapports` est la valeur à réécrire dans
// etat-utilisateur.json (purge faite, compteur du jour à jour), que l'écriture soit
// autorisée ou non. Un rapport étouffé n'est pas mis en attente : il est perdu.
//
//   - Une signature revue avant le délai (24 h par défaut) : étouffé, motif
//     'signature-recente'. Ne compte pas dans le plafond du jour, que seul un rapport
//     écrit incrémente.
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
// 7. File d'attente hors ligne
// ---------------------------------------------------------------------------------------

// Écrit un rapport construit et validé en <dossier>\<id>.json, UTF-8 sans BOM, indenté de
// 2 espaces. Crée le dossier au besoin. Lève si l'écriture échoue : emettreRapport se
// replie alors sur la file d'attente.
//
// Le temporaire (préfixe « ~$ », voir cheminTemporaire) est retiré par un `finally`, car ce
// dossier est synchronisé sur tous les postes. Son nom ne finit pas par « .json » :
// listerFileAttente() et son pendant PowerShell l'ignorent.
function ecrireRapportSurDisque(dossier, rapport) {
  fs.mkdirSync(dossier, { recursive: true });
  const cible = path.join(dossier, rapport.id + '.json');
  const tmp = cheminTemporaire(cible);
  try {
    fs.writeFileSync(tmp, JSON.stringify(rapport, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, cible);
  } finally {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
  }
  return cible;
}

// Les fichiers .json de la file d'attente, du plus ancien au plus récent (mtime) : la purge
// et le vidage traitent les plus anciens d'abord. Dossier absent -> liste vide.
function listerFileAttente(dossierFile, extension) {
  const dossier = dossierFile || cheminDossierAttente();
  const ext = extension || '.json';
  let noms;
  try { noms = fs.readdirSync(dossier); } catch (e) { return []; }
  const fichiers = [];
  for (const nom of noms) {
    if (!nom.endsWith(ext) || nom.startsWith('~$')) { continue; }
    const chemin = path.join(dossier, nom);
    let mtime = 0;
    try { mtime = fs.statSync(chemin).mtimeMs; } catch (e) { continue; }
    fichiers.push({ chemin: chemin, nom: nom, mtime: mtime });
  }
  fichiers.sort((a, b) => a.mtime - b.mtime);
  return fichiers;
}

// Applique les deux plafonds de la file : fichiers de plus de 30 jours effacés sans être
// transmis, puis les plus anciens au-delà de 50. Rend la liste restante, pour que
// viderFileAttente() n'ait pas à relire le dossier.
function purgerFileAttente(maintenant) {
  return purgerDossierAttente(cheminDossierAttente(), '.json', PLAFONDS_ATTENTE, maintenant);
}

// La même purge pour une autre file (celle des compteurs : .csv, plafonds plus larges).
function purgerDossierAttente(dossierFile, extension, plafonds, maintenant) {
  const now = maintenant || new Date();
  const seuilAge = now.getTime() - plafonds.jours * 24 * 3600 * 1000;
  let fichiers = listerFileAttente(dossierFile, extension).filter((f) => {
    if (f.mtime < seuilAge) { try { fs.unlinkSync(f.chemin); } catch (e) { /* on réessaiera */ } return false; }
    return true;
  });
  if (fichiers.length > plafonds.fichiers) {
    const enTrop = fichiers.length - plafonds.fichiers;
    for (let i = 0; i < enTrop; i++) { try { fs.unlinkSync(fichiers[i].chemin); } catch (e) { /* … */ } }
    fichiers = fichiers.slice(enTrop);
  }
  return fichiers;
}

// Appelée à l'activation de l'extension (côté PowerShell, au démarrage du lanceur). Chaque
// fichier restant après les plafonds est déplacé vers le dossier des rapports ; en cas
// d'échec, il reste pour la fois suivante. Ne lève pas.
function viderFileAttente() {
  try {
    const ancrage = resoudreAncrage();
    // Le dossier peut venir de SZH_RAPPORTS même sans ancrage (resoudreDossierRapports()).
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
      } catch (e) { /* dossier injoignable : le fichier reste en place */ }
    }
    if (deplaces > 0 || fichiers.length > 0) {
      console.log('[rapport-erreur] file d’attente : ' + deplaces + '/' + fichiers.length + ' déplacé(s).');
    }
    return { deplaces: deplaces, restes: fichiers.length - deplaces };
  } catch (e) {
    // Le vidage ne doit pas empêcher l'activation de l'extension.
    console.log('[rapport-erreur] vidage de la file d’attente impossible : ' + ((e && e.message) || e));
    return { deplaces: 0, restes: 0 };
  }
}

// ---------------------------------------------------------------------------------------
// 8. emettreRapport, seule fonction appelée par extension.js
// ---------------------------------------------------------------------------------------

// codesErreur.calculerId lève sans 6 caractères hexadécimaux ; genererAleatoireHex() en
// rend toujours 6.
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
// Rend toujours { ecrit, enAttente, etouffe, id, motif } et ne lève jamais. `motif` dit
// pourquoi rien n'a été écrit (mal-forme, signature-recente, plafond-jour,
// ecriture-impossible, exception-interne), ou vaut null. `chemin`, le fichier écrit,
// s'ajoute quand le rapport est écrit ou mis en attente.
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
      userProfile: dossierProfil() || null,
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

    // Anti-inondation : les compteurs sont réécrits, que l'écriture soit autorisée ou non.
    const etatAvant = lireEtatUtilisateur();
    const rapportsAvant = (etatAvant.rapports && typeof etatAvant.rapports === 'object') ? etatAvant.rapports : {};
    const decision = decisionAntiInondation(rapportsAvant, signature, maintenant);
    ecrireEtatUtilisateur((avant) => Object.assign({}, avant, { rapports: decision.rapports }));
    if (!decision.autorise) {
      console.log('[rapport-erreur] ' + c.code + ' étouffé par l’anti-inondation (' + decision.motif + '), perdu.');
      return { ecrit: false, enAttente: false, etouffe: true, id: id, motif: decision.motif };
    }

    // SZH_RAPPORTS, si elle est posée, donne directement le dossier d'écriture.
    const dossierCible = resoudreDossierRapports(ancrage);
    if (dossierCible) {
      try {
        const chemin = ecrireRapportSurDisque(dossierCible, rapport);
        console.log('[rapport-erreur] ' + id + ' écrit (' + c.code + ').');
        return { ecrit: true, enAttente: false, etouffe: false, id: id, motif: null, chemin: chemin };
      } catch (e) {
        console.log('[rapport-erreur] dossier de rapports injoignable (' + ((e && e.message) || e) + '), mise en attente.');
        // tombe dans la file ci-dessous
      }
    } else {
      console.log('[rapport-erreur] aucun ancrage résolu, mise en attente.');
    }

    try {
      const chemin = ecrireRapportSurDisque(cheminDossierAttente(), rapport);
      purgerFileAttente();
      console.log('[rapport-erreur] ' + id + ' mis en attente.');
      return { ecrit: false, enAttente: true, etouffe: false, id: id, motif: null, chemin: chemin };
    } catch (e2) {
      // Un échec d'écriture ne produit pas de second rapport (RAPPORT-ECHEC-ECRITURE n'est
      // jamais écrit en JSON, voir codes-erreur.js) : seule cette ligne le signale.
      console.log('[rapport-erreur] écriture impossible, y compris en attente (' + ((e2 && e2.message) || e2) + ') — abandon silencieux.');
      return { ecrit: false, enAttente: false, etouffe: false, id: id, motif: 'ecriture-impossible' };
    }
  } catch (e) {
    // Cette fonction ne lève jamais.
    console.log('[rapport-erreur] échec interne inattendu : ' + ((e && e.message) || e));
    return { ecrit: false, enAttente: false, etouffe: false, id: null, motif: 'exception-interne' };
  }
}

module.exports = {
  // Constantes.
  SEGMENT_APPLICATION, SEGMENTS_DOSSIER_RAPPORTS,
  PLAFONDS_ATTENTE, PLAFONDS_ATTENTE_COMPTEURS,
  // Racines et chemins (impurs : environnement + disque).
  racineProgramData, racineUtilisateur,
  cheminConfigPoste, cheminStatePoste, cheminVersionToolkit,
  cheminEtatUtilisateur, cheminDossierAttente, cheminDossierCompteursAttente, cheminTemporaire,
  // Ancrage.
  resoudreAncrage, dossierRapportsDepuisAncrage, dossierSystemeDepuisAncrage, resoudreDossierRapports,
  normaliserSeparateursAncrage,
  ecritureReelleEviteeParHarnaisTest,
  // Contexte.
  versionToolkit, versionCockpit, emplacementCourant, produitDepuisRacine,
  formaterHorodatageLocal, lireExtraitFichier, normaliserConstats,
  // État utilisateur (compteurs anti-inondation, cache d'ancrage).
  lireEtatUtilisateur, ecrireEtatUtilisateur, lireJsonTolerant, formaterJourLocal,
  // Construction — pure.
  construireRapport,
  // Anti-inondation — pure.
  purgerCompteursRapports, decisionAntiInondation,
  // File d'attente hors ligne.
  listerFileAttente, purgerFileAttente, purgerDossierAttente, viderFileAttente,
  // Orchestrateur.
  genererId, emettreRapport
};
