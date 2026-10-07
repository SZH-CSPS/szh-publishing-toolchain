// Ce que liste l'Accueil : la racine active du poste et, pour chaque produit, ses numéros
// en cours et archivés. Même logique que Get-SzhBaseRevuesPour et Get-SzhEmplacementRevue
// (windows/szh-produits.ps1) ; test/js/inventaire.test.js vérifie la concordance.
'use strict';

const fs = require('fs');
const path = require('path');
const { estVraiYaml, normaliserRevue } = require('./yaml');
const { lireConfigPoste, resoudreEmplacementRevues, EMPLACEMENT_TEST } = require('./archivage');
const { resoudreAncrage, SEGMENTS_DOSSIER_RAPPORTS, SEGMENT_APPLICATION } = require('./rapport-erreur');

// Ordre des onglets.
const ORDRE = ['revue', 'zeitschrift', 'livre'];

// Dossiers en cours et d'archive de chaque produit, comme $SzhSousDossiers.
const SOUS_DOSSIERS = {
  revue: { encours: ['Revue'], archive: ['_Archive', 'Revue'] },
  zeitschrift: { encours: ['Zeitschrift'], archive: ['_Archive', 'Zeitschrift'] },
  livre: { encours: ['Books'], archive: ['_Archive', 'Books'] }
};

// Par produit : son manifeste, la clé du titre, et si le champ `revue:` du manifeste filtre.
const PRODUITS = {
  revue: { manifeste: 'ausgabe.yaml', cleTitre: 'title', filtrerJeton: true, racinesHeritees: true },
  zeitschrift: { manifeste: 'ausgabe.yaml', cleTitre: 'title', filtrerJeton: true, racinesHeritees: true },
  livre: { manifeste: 'buch.yaml', cleTitre: 'titre', filtrerJeton: false, racinesHeritees: false }
};

// Variables d'environnement de surcharge, et bases par défaut comme $SzhBasesDefaut.
const VARIABLES_RACINE = { prod: 'SZH_RACINE_PROD', dev: 'SZH_RACINE_TEST' };
const PRODUITS_SOUS_ANCRAGE = [SEGMENTS_DOSSIER_RAPPORTS[0], SEGMENT_APPLICATION];
const BASES_DEFAUT = {
  prod: path.join('%USERPROFILE%\\SZH CSPS\\Daten_Allgemein - General', ...PRODUITS_SOUS_ANCRAGE),
  dev: '%USERPROFILE%\\OneDrive - SZH CSPS\\Revues-TESTING'
};

// Comme [Environment]::ExpandEnvironmentVariables : un %NOM% inconnu reste tel quel.
function etendre(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(/%([^%]+)%/g, (m, nom) => (process.env[nom] === undefined ? m : process.env[nom]));
}

// Base d'un emplacement : la surcharge, puis l'ancrage SharePoint en production, puis le défaut.
function baseRevuesPour(emplacement) {
  const cle = emplacement === EMPLACEMENT_TEST ? 'dev' : 'prod';
  const essai = String(process.env[VARIABLES_RACINE[cle]] || '').trim();
  if (essai) { return etendre(essai); }
  if (cle === 'prod') {
    const ancrage = resoudreAncrage();
    if (ancrage && ancrage.trouve) { return path.join(ancrage.chemin, ...PRODUITS_SOUS_ANCRAGE); }
  }
  return etendre(BASES_DEFAUT[cle]);
}

// Dossier d'un produit dans un état ('encours' | 'archive'), sous une base.
function emplacementProduit(base, jeton, etat) {
  return path.join(base, ...SOUS_DOSSIERS[jeton][etat]);
}

// Lit un YAML plat comme Get-SzhAusgabe : une clé par ligne, la première gagne, guillemets
// et commentaire de fin retirés.
function lireYamlPlat(fichier) {
  const valeurs = {};
  let brut;
  try { brut = fs.readFileSync(fichier, 'utf8'); } catch (e) { return valeurs; }
  for (const ligne of brut.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(ligne);
    if (!m || Object.prototype.hasOwnProperty.call(valeurs, m[1])) { continue; }
    let v = m[2].trim();
    let q;
    if ((q = /^"(.*)"\s*(#.*)?$/.exec(v))) { v = q[1]; }
    else if ((q = /^'(.*)'\s*(#.*)?$/.exec(v))) { v = q[1]; }
    else if ((q = /^([^#]*?)\s*#.*$/.exec(v))) { v = q[1]; }
    valeurs[m[1]] = v.trim();
  }
  return valeurs;
}

function estDossier(chemin) {
  try { return fs.statSync(chemin).isDirectory(); } catch (e) { return false; }
}
function existe(chemin) {
  try { fs.statSync(chemin); return true; } catch (e) { return false; }
}
function sousDossiers(racine) {
  try {
    return fs.readdirSync(racine, { withFileTypes: true }).filter((e) => e.isDirectory())
      .map((e) => path.join(racine, e.name));
  } catch (e) { return []; }
}

// Numéros restés hors de l'arborescence, sous `revuesRoots` de config.json ou OneDrive\Revues.
// Rend leur nombre et le premier dossier qui en contient.
function horsArborescence(jeton, base, cfg) {
  const info = PRODUITS[jeton];
  if (!info.racinesHeritees) { return { nombre: 0, dossier: '' }; }
  const exclues = new Set([emplacementProduit(base, jeton, 'archive')]
    .concat(['revue', 'zeitschrift'].flatMap((j) => ['encours', 'archive'].map((e) => emplacementProduit(base, j, e))))
    .map((c) => c.toLowerCase()));
  const candidates = [];
  const ajouter = (c) => {
    if (!c) { return; }
    const cle = String(c).toLowerCase();
    if (exclues.has(cle)) { return; }
    exclues.add(cle);
    candidates.push(String(c));
  };
  if (cfg && Array.isArray(cfg.revuesRoots)) { for (const r of cfg.revuesRoots) { ajouter(etendre(r)); } }
  if (process.env.OneDrive) { ajouter(path.join(process.env.OneDrive, 'Revues')); }
  let nombre = 0;
  let dossier = '';
  for (const racine of candidates) {
    const trouves = sousDossiers(racine).filter((d) => existe(path.join(d, info.manifeste))).length;
    if (trouves > 0) {
      nombre += trouves;
      if (!dossier) { dossier = racine; }
    }
  }
  return { nombre, dossier };
}

// Entrées d'un produit, dans l'ordre de l'Accueil : en cours du plus récemment modifié au
// plus ancien, archives par nom décroissant. Une entrée est archivée si son manifeste le dit
// ou si elle se trouve sous la racine d'archives.
function inventaireProduit(jeton, base, cfg) {
  const info = PRODUITS[jeton];
  const racineEnCours = emplacementProduit(base, jeton, 'encours');
  const racineArchive = emplacementProduit(base, jeton, 'archive');
  const enCours = [];
  const archives = [];
  const vus = new Set();
  for (const racine of [racineEnCours, racineArchive]) {
    if (!estDossier(racine)) { continue; }
    const sousArchives = racine.toLowerCase() === racineArchive.toLowerCase();
    for (const dossier of sousDossiers(racine)) {
      const manifeste = path.join(dossier, info.manifeste);
      if (!existe(manifeste)) { continue; }
      const cle = dossier.toLowerCase();
      if (vus.has(cle)) { continue; }
      vus.add(cle);
      const v = lireYamlPlat(manifeste);
      if (info.filtrerJeton && normaliserRevue(v.revue) !== jeton) { continue; }
      let modifie = null;
      try { modifie = fs.statSync(dossier).mtime; } catch (e) { /* disparu entre-temps */ }
      const entree = {
        nom: path.basename(dossier),
        titre: v[info.cleTitre] || '',
        chemin: dossier,
        modifie: modifie,
        verrouillee: estVraiYaml(v.locked),
        archivee: estVraiYaml(v.archived) || sousArchives
      };
      (entree.archivee ? archives : enCours).push(entree);
    }
  }
  const temps = (e) => (e.modifie ? e.modifie.getTime() : 0);
  enCours.sort((a, b) => temps(b) - temps(a));
  archives.sort((a, b) => b.nom.localeCompare(a.nom, undefined, { sensitivity: 'base' }));
  return { jeton, racineEnCours, racineArchive, enCours, archives, hors: horsArborescence(jeton, base, cfg) };
}

// Tout ce que l'Accueil affiche, pour les trois produits. ancrageAbsent ne vaut qu'en
// production : en test, l'ancrage ne sert pas à trouver la racine.
function inventaire() {
  const cfg = lireConfigPoste();
  const emplacement = resoudreEmplacementRevues(cfg);
  const modeTest = emplacement === EMPLACEMENT_TEST;
  const base = baseRevuesPour(emplacement);
  const ancrageAbsent = !modeTest && !resoudreAncrage().trouve;
  const produits = {};
  for (const jeton of ORDRE) { produits[jeton] = inventaireProduit(jeton, base, cfg); }
  return { emplacement, modeTest, base, ancrageAbsent, produits };
}

// Dossier des exports de l'Accueil (Secrétariat, Préprocessing), sous la racine active.
// `inv`, un inventaire déjà calculé, évite de le refaire.
function racineExports(inv) {
  return path.join((inv || inventaire()).base, 'Exports');
}

module.exports = {
  ORDRE, SOUS_DOSSIERS, BASES_DEFAUT,
  baseRevuesPour, emplacementProduit, lireYamlPlat, inventaireProduit, inventaire, racineExports
};
