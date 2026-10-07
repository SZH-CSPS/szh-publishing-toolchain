// Enrichit le cache des auteurs avec les fiches <slug>.meta.yaml des numéros du poste : la
// fonction et l'e-mail n'existent que là, OJS ne les expose pas. Les revues sont sur
// OneDrive (Fichiers à la demande, qui télécharge un fichier à son ouverture) : seuls les
// *.meta.yaml sont ouverts, quelques Ko chacun.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { analyserMeta } = require('./yaml');
const { TOOLKIT } = require('./archivage');
const { lireCache, ecrireCache, JOURS_FRAICHEUR, fusionnerAuteurs } = require('./auteurs-ojs');

// Le cache est celui de lib/auteurs-ojs.js, lu et écrit par ses fonctions.
const SCRIPT_EMPLACEMENTS = path.join(TOOLKIT, 'windows', 'szh-common.ps1');

// Les racines des numéros (en cours et archives), lues par Get-SzhEmplacements de
// szh-common.ps1. Rend { racines, erreur } ; erreur vaut null en cas de succès. Ne lève pas.
// opts.executer remplace PowerShell dans les tests.
async function racinesCorpus(opts) {
  const o = opts || {};
  const executer = o.executer || lancerPowerShell;
  try {
    const sortie = await executer([
      '. "' + SCRIPT_EMPLACEMENTS + '"',
      'Get-SzhEmplacements | ConvertTo-Json -Compress'
    ].join('; '));
    let emplacements;
    try { emplacements = JSON.parse(sortie.trim()); }
    catch (e) { return { racines: [], erreur: 'JSON illisible' }; }
    if (!emplacements || typeof emplacements !== 'object') { return { racines: [], erreur: 'JSON illisible' }; }
    const racines = [];
    if (Array.isArray(emplacements.encours)) { racines.push(...emplacements.encours); }
    if (Array.isArray(emplacements.archives)) { racines.push(...emplacements.archives); }
    return { racines: racines, erreur: null };
  } catch (e) {
    return { racines: [], erreur: String((e && e.message) || e) };
  }
}

// Lance PowerShell et rend la sortie stdout brute.
function lancerPowerShell(lignes) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SCRIPT_EMPLACEMENTS)) {
      reject(new Error('script introuvable : ' + SCRIPT_EMPLACEMENTS));
      return;
    }
    const proc = spawn('powershell.exe', [
      '-NoProfile',
      '-Command', String(lignes)
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += String(d); });
    proc.stderr.on('data', (d) => { stderr += String(d); });
    proc.on('error', (e) => { reject(e); });
    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error('PowerShell ' + code + (stderr ? ' : ' + stderr.slice(0, 200) : '')));
        return;
      }
      resolve(stdout);
    });
  });
}

// Balaie chaque racine : les dossiers qui ont un ausgabe.yaml sont des numéros, dont on lit
// articles/<slug>/<slug>.meta.yaml. Une fiche dont le mtime n'a pas changé n'est pas relue.
// opts = { racines, vus, maintenant, plafondFichiers, delaiMs, lire, statuer, lireDossier, horloge }
// vus = { chemin: mtimeMs, ... }
// Rend { auteurs, vus, fichiers, complet, erreur }.
//
// Asynchrone : le balayage peut traverser des milliers de dossiers OneDrive, où chaque
// readdir ou stat peut attendre le réseau ; une version synchrone gèlerait l'éditeur.
// Les plafonds de temps et de fichiers sont vérifiés à chaque entrée ; un balayage
// interrompu garde ce qu'il a trouvé et rend complet: false.
async function balayerCorpus(opts) {
  const o = opts || {};
  const racines = Array.isArray(o.racines) ? o.racines : [];
  const vus = (o.vus && typeof o.vus === 'object') ? o.vus : {};
  const maintenant = o.maintenant === undefined ? Date.now() : o.maintenant;
  const plafondFichiers = o.plafondFichiers === undefined ? 5000 : o.plafondFichiers;
  const delaiMs = o.delaiMs === undefined ? 600000 : o.delaiMs;
  const lire = o.lire || ((c) => fs.promises.readFile(c, 'utf8'));
  const statuer = o.statuer || ((c) => fs.promises.stat(c));
  const lireDossier = o.lireDossier || ((c) => fs.promises.readdir(c, { withFileTypes: true }));
  // L'horloge du plafond de temps est distincte de `maintenant`, qui est un horodatage fixe :
  // comparé à lui-même, il mesurerait toujours zéro seconde.
  const horloge = o.horloge || Date.now;
  const debut = horloge();
  const auteurs = [];
  let fichiers = 0;
  let complet = true;
  let derniereErreur = null;
  for (const racine of racines) {
    if (horloge() - debut > delaiMs) { complet = false; break; }
    if (fichiers >= plafondFichiers) { complet = false; break; }
    // Une racine inexistante ou non synchronisée est sautée silencieusement.
    let dossiers;
    try { dossiers = await lireDossier(racine); }
    catch (e) { continue; }
    for (const entree of dossiers) {
      if (horloge() - debut > delaiMs) { complet = false; break; }
      if (fichiers >= plafondFichiers) { complet = false; break; }
      if (!entree.isDirectory()) { continue; }
      const ausgabe = path.join(racine, entree.name, 'ausgabe.yaml');
      let statAusgabe;
      try { statAusgabe = await statuer(ausgabe); }
      catch (e) { continue; }
      if (!statAusgabe.isFile()) { continue; }
      const articlesDir = path.join(racine, entree.name, 'articles');
      let slugs;
      try { slugs = await lireDossier(articlesDir); }
      catch (e) { continue; }
      for (const slug of slugs) {
        if (horloge() - debut > delaiMs) { complet = false; break; }
        if (fichiers >= plafondFichiers) { complet = false; break; }
        if (!slug.isDirectory()) { continue; }
        const metaYaml = path.join(articlesDir, slug.name, slug.name + '.meta.yaml');
        let statMeta;
        try { statMeta = await statuer(metaYaml); }
        catch (e) { continue; }
        if (!statMeta.isFile()) { continue; }
        fichiers++;
        if (vus[metaYaml] === statMeta.mtimeMs) { continue; }
        vus[metaYaml] = statMeta.mtimeMs;
        let contenu;
        try { contenu = await lire(metaYaml); }
        catch (e) {
          derniereErreur = String((e && e.message) || e);
          continue;
        }
        let meta;
        try { meta = analyserMeta(contenu); }
        catch (e) {
          derniereErreur = String((e && e.message) || e);
          continue;
        }
        if (!Array.isArray(meta.author)) { continue; }
        for (const a of meta.author) {
          if (!a || typeof a !== 'object') { continue; }
          const prenom = String((a.prenom || '').trim());
          const nom = String((a.nom || '').trim());
          if (prenom === '' && nom === '') { continue; }
          auteurs.push({
            prenom: prenom,
            nom: nom,
            affiliation: String((a.affiliation || '').trim()),
            ror: String((a.ror || '').trim()),
            fonction: String((a.fonction || '').trim()),
            email: String((a.email || '').trim()),
            orcid: String((a.orcid || '').trim()),
            datePublication: '',
            source: 'corpus'
          });
        }
      }
    }
  }
  return { auteurs: auteurs, vus: vus, fichiers: fichiers, complet: complet, erreur: derniereErreur };
}

// Pendant de rafraichir() de lib/auteurs-ojs.js. Rend { fait, complet, erreur, dateCorpus,
// nombre, fichiers }, ou { fait: false, raison: 'frais' } quand dateCorpus a moins de
// JOURS_FRAICHEUR jours. dateCorpus n'avance que si le balayage est complet.
// opts de test : { maintenant, forcer, racines, executer, lire, statuer }
async function rafraichirCorpus(opts) {
  const o = opts || {};
  const maintenant = o.maintenant === undefined ? Date.now() : o.maintenant;
  const cache = lireCache();
  const dateCorpus = cache.dateCorpus || null;
  if (!o.forcer && dateCorpus && cacheFrais(dateCorpus, maintenant)) {
    return {
      fait: false, raison: 'frais', dateCorpus: dateCorpus,
      nombre: cache.auteurs.length, fichiers: 0
    };
  }
  let racines = Array.isArray(o.racines) ? o.racines : null;
  if (racines === null) {
    const { racines: r, erreur: e } = await racinesCorpus(o);
    if (e) { return { fait: false, raison: 'racines', erreur: e, dateCorpus: dateCorpus, nombre: cache.auteurs.length, fichiers: 0 }; }
    racines = r;
  }
  const resultCorpus = await balayerCorpus({
    racines: racines,
    vus: (cache.vus && typeof cache.vus === 'object') ? Object.assign({}, cache.vus) : {},
    maintenant: maintenant,
    plafondFichiers: o.plafondFichiers,
    delaiMs: o.delaiMs,
    lire: o.lire,
    statuer: o.statuer
  });
  // Une seule fusion pour tout le lot : fusionner auteur par auteur reconstruirait la table
  // à chaque nom. Une entrée 'corpus' écrase les champs d'enrichissement d'une entrée 'oai',
  // pas l'inverse.
  const auteurs = fusionnerAuteurs(cache.auteurs, resultCorpus.auteurs);
  // Version 2 en dur : recopier `cache.version` garderait un cache v1 en v1, et sa migration,
  // rejouée à chaque lecture, remettrait dateFetch à null, donc relancerait un moissonnage
  // OJS complet à chaque activation.
  const neuf = {
    version: 2,
    dateFetch: cache.dateFetch || null,
    dateCorpus: resultCorpus.complet ? new Date(maintenant).toISOString() : dateCorpus,
    vus: resultCorpus.vus,
    auteurs: auteurs,
    ror: cache.ror || {}
  };
  // `vus` est écrit même après un balayage partiel : les fiches déjà téléchargées par
  // OneDrive ne seront pas relues au balayage suivant.
  const erreurEcriture = ecrireCache(neuf);
  return {
    fait: true,
    complet: resultCorpus.complet && !erreurEcriture,
    erreur: resultCorpus.erreur || erreurEcriture || null,
    dateCorpus: neuf.dateCorpus,
    nombre: auteurs.length,
    fichiers: resultCorpus.fichiers
  };
}

// Vrai si dateCorpus a moins de JOURS_FRAICHEUR jours, comme cacheFrais de auteurs-ojs.js.
function cacheFrais(dateCorpus, maintenant) {
  if (!dateCorpus || typeof dateCorpus !== 'string') { return false; }
  const t = Date.parse(dateCorpus);
  if (!isFinite(t)) { return false; }
  const age = (maintenant === undefined ? Date.now() : maintenant) - t;
  return age >= 0 && age < JOURS_FRAICHEUR * 24 * 3600 * 1000;
}

module.exports = {
  lancerPowerShell, racinesCorpus, balayerCorpus,
  cacheFrais, rafraichirCorpus
};
