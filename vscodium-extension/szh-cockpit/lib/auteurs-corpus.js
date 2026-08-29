// Enrichissement du cache des auteurs avec les données du corpus local.
//
// Les auteur·e·s publiés d'OJS n'ont que nom + affiliation. La fonction et l'e-mail
// existent seulement dans les fiches <slug>.meta.yaml du corpus. Ce module balaie ces
// fiches pour fusionner les champs manquants.
//
// Contrainte déterminante : les revues vivent sur OneDrive avec Fichiers à la demande.
// Ouvrir un fichier le fait télécharger — donc on ouvre QUE les *.meta.yaml (quelques Ko),
// jamais un .md, jamais out/, jamais media/, jamais un .docx. Le mtime décide : on relit
// une fiche seulement si son mtimeMs diffère de celui mémorisé dans cache.vus[chemin].
// Tout balayage interrompu garde ce qu'il a trouvé.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { analyserMeta } = require('./yaml');
const { TOOLKIT } = require('./archivage');
const { lireCache, ecrireCache, JOURS_FRAICHEUR, fusionnerAuteurs } = require('./auteurs-ojs');

// Le cache est celui du module frère — même fichier, mêmes lecteurs. Rien n'est recopié
// ici : deux calculs du chemin finiraient par diverger sur un poste.
const SCRIPT_EMPLACEMENTS = path.join(TOOLKIT, 'windows', 'szh-common.ps1');

// Lance PowerShell pour sourcer szh-common.ps1 et appeller Get-SzhEmplacements.
// Retourne un objet { encours: [...], archives: [...] } en JSON, ou [] + erreur sur
// panne. Aucune exception levée.
// opts.executer est injectable pour les tests — aucun test ne doit lancer PowerShell.
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

// Balaie le corpus : une racine → readdirSync → dossiers avec ausgabe.yaml →
// articles/<slug>/<slug>.meta.yaml. Gère mtime pour ne relire que si nécessaire.
// opts = { racines, vus, maintenant, plafondFichiers, delaiMs, lire, statuer }
// vus = { chemin: mtimeMs, ... }
// Rend { auteurs, vus, fichiers, complet, erreur }. N'ouvre QUE les *.meta.yaml.
function balayerCorpus(opts) {
  const o = opts || {};
  const racines = Array.isArray(o.racines) ? o.racines : [];
  const vus = (o.vus && typeof o.vus === 'object') ? o.vus : {};
  const maintenant = o.maintenant === undefined ? Date.now() : o.maintenant;
  const plafondFichiers = o.plafondFichiers === undefined ? 5000 : o.plafondFichiers;
  const delaiMs = o.delaiMs === undefined ? 600000 : o.delaiMs;
  const lire = o.lire || ((c) => fs.readFileSync(c, 'utf8'));
  const statuer = o.statuer || ((c) => fs.statSync(c));
  // L'horloge du budget est SÉPARÉE de `maintenant`, qui n'est qu'un horodatage : les
  // comparer reviendrait à mesurer zéro seconde, et la borne de temps — la seule qui
  // protège d'un OneDrive qui s'hydrate au compte-gouttes — ne se déclencherait jamais.
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
    try { dossiers = fs.readdirSync(racine, { withFileTypes: true }); }
    catch (e) { continue; }
    for (const entree of dossiers) {
      if (horloge() - debut > delaiMs) { complet = false; break; }
      if (fichiers >= plafondFichiers) { complet = false; break; }
      if (!entree.isDirectory()) { continue; }
      const ausgabe = path.join(racine, entree.name, 'ausgabe.yaml');
      let statAusgabe;
      try { statAusgabe = statuer(ausgabe); }
      catch (e) { continue; }
      if (!statAusgabe.isFile()) { continue; }
      // Ce dossier est un numéro. Balaie articles/<slug>/<slug>.meta.yaml.
      const articlesDir = path.join(racine, entree.name, 'articles');
      let slugs;
      try { slugs = fs.readdirSync(articlesDir, { withFileTypes: true }); }
      catch (e) { continue; }
      for (const slug of slugs) {
        if (horloge() - debut > delaiMs) { complet = false; break; }
        if (fichiers >= plafondFichiers) { complet = false; break; }
        if (!slug.isDirectory()) { continue; }
        const metaYaml = path.join(articlesDir, slug.name, slug.name + '.meta.yaml');
        let statMeta;
        try { statMeta = statuer(metaYaml); }
        catch (e) { continue; }
        if (!statMeta.isFile()) { continue; }
        fichiers++;
        // Optimisation OneDrive : ne relire que si mtime a changé.
        if (vus[metaYaml] === statMeta.mtimeMs) { continue; }
        vus[metaYaml] = statMeta.mtimeMs;
        // On lit la fiche et on en extrait les auteurs.
        let contenu;
        try { contenu = lire(metaYaml); }
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
          // Entrée bien formée : fonction, email, affiliation, orcid, ror.
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

// Pendant de rafraichir() de lib/auteurs-ojs.js. Porte de fraîcheur sur dateCorpus : 30 jours.
// Retourne { fait, complet, erreur, dateCorpus, nombre, fichiers }, avec
// { fait: false, raison: 'frais' } quand le cache a moins de 30 jours.
// dateCorpus n'avance que si le balayage est complet.
// cache.vus est toujours écrit, même sur balayage partiel.
// opts de test : { maintenant, forcer, racines, executer, lire, statuer }
async function rafraichirCorpus(opts) {
  const o = opts || {};
  const maintenant = o.maintenant === undefined ? Date.now() : o.maintenant;
  const cache = lireCache();
  // dateCorpus et dateCorpus côté OJS sont SÉPARÉS dans le cache — on ne fusionne
  // que si corpus a avancé.
  const dateCorpus = cache.dateCorpus || null;
  if (!o.forcer && dateCorpus && cacheFrais(dateCorpus, maintenant)) {
    return {
      fait: false, raison: 'frais', dateCorpus: dateCorpus,
      nombre: cache.auteurs.length, fichiers: 0
    };
  }
  // On a besoin des racines. Si racines n'est pas fourni en test, on les récupère.
  let racines = Array.isArray(o.racines) ? o.racines : null;
  if (racines === null) {
    const { racines: r, erreur: e } = await racinesCorpus(o);
    if (e) { return { fait: false, raison: 'racines', erreur: e, dateCorpus: dateCorpus, nombre: cache.auteurs.length, fichiers: 0 }; }
    racines = r;
  }
  // On balaie le corpus.
  const resultCorpus = balayerCorpus({
    racines: racines,
    vus: (cache.vus && typeof cache.vus === 'object') ? Object.assign({}, cache.vus) : {},
    maintenant: maintenant,
    plafondFichiers: o.plafondFichiers,
    delaiMs: o.delaiMs,
    lire: o.lire,
    statuer: o.statuer
  });
  // Une seule fusion pour tout le lot : appelée par auteur, elle reconstruirait la table
  // et le tableau à chaque nom, soit des millions d'opérations sur un corpus entier.
  // fusionnerAuteurs applique la précédence : une entrée 'corpus' écrase les champs
  // d'enrichissement d'une entrée 'oai', jamais l'inverse.
  const auteurs = fusionnerAuteurs(cache.auteurs, resultCorpus.auteurs);
  // Bâtir le cache à écrire.
  // Version 2 en dur : réécrire `cache.version` laisserait un cache v1 se réécrire en v1,
  // la migration se rejouerait à chaque lecture et remettrait dateFetch à null — donc un
  // moissonnage OJS complet à chaque activation, pour toujours.
  const neuf = {
    version: 2,
    dateFetch: cache.dateFetch || null,
    dateCorpus: resultCorpus.complet ? new Date(maintenant).toISOString() : dateCorpus,
    vus: resultCorpus.vus,
    auteurs: auteurs,
    ror: cache.ror || {}
  };
  // `vus` part TOUJOURS, même sur un balayage partiel : le téléchargement déjà payé par
  // OneDrive ne doit pas l'être une seconde fois au mois suivant.
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

// Frais = moins de 30 jours. Même logique que cacheFrais dans auteurs-ojs.js.
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
