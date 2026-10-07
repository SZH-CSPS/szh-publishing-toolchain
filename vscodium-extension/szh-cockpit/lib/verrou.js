// Passe tout le dossier d'un numéro verrouillé en lecture seule.
//
// Le verrou s'écrit dans <revue>/.vscode/settings.json, qui voyage avec le dossier
// (OneDrive, archivage, autre poste) et que files.exclude masque. Trois clés :
// `files.readonlyInclude` sur « ** », `files.readonlyExclude` sur « .vscode/** », et
// `triggerTaskOnSave.tasks` vidé pour qu'un enregistrement par une autre extension ne
// relance pas `make all`.
//
// L'écriture passe par fs, pas par l'API de configuration de VS Code : celle-ci refuse
// d'écrire un fichier en lecture seule, et `update(clé, undefined)` crée un settings.json
// vide dans chaque dossier visité. readonlyExclude garde .vscode/ modifiable.
'use strict';

const fs = require('fs');
const path = require('path');

const CLES_VERROU = ['files.readonlyInclude', 'files.readonlyExclude', 'triggerTaskOnSave.tasks'];

function cheminsVerrou(racine) {
  const dossier = path.join(racine, '.vscode');
  return { dossier: dossier, fichier: path.join(dossier, 'settings.json') };
}

// settings.json est du JSONC : VS Code y tolère les commentaires `//` et `/* */`, et une
// virgule finale avant `}`/`]`. Retire les deux hors des chaînes, pour JSON.parse.
function retirerJsonc(texte) {
  return String(texte)
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m.charAt(0) === '"' ? m : ''))
    .replace(/,(\s*[}\]])/g, '$1');
}

// Réglages lus sur le disque, ou null si le JSONC est illisible : l'appelant s'arrête alors
// sans rien écraser.
function lireReglages(fichier) {
  if (!fs.existsSync(fichier)) { return {}; }
  try {
    const brut = String(fs.readFileSync(fichier, 'utf8')).replace(/^﻿/, '');
    const lu = JSON.parse(retirerJsonc(brut));
    if (lu && typeof lu === 'object' && !Array.isArray(lu)) { return lu; }
    return null;
  } catch (e) { return null; }
}

// -> null si tout va bien, sinon le message d'erreur. Ne lève pas, pour ne pas laisser un
// archivage à moitié fait.
function appliquerVerrou(racine, verrouillee) {
  if (!racine) { return null; }
  const c = cheminsVerrou(racine);
  const present = fs.existsSync(c.fichier);
  const valeurs = lireReglages(c.fichier);
  if (valeurs === null) { return 'réglages du dossier illisibles (' + c.fichier + ')'; }

  if (verrouillee) {
    valeurs['files.readonlyInclude'] = { '**': true };
    valeurs['files.readonlyExclude'] = { '.vscode/**': true };
    valeurs['triggerTaskOnSave.tasks'] = {};
  } else {
    if (!present) { return null; }                 // rien à retirer, rien à créer
    for (const cle of CLES_VERROU) { delete valeurs[cle]; }
    if (Object.keys(valeurs).length === 0) {
      // Plus aucun réglage : on retire le fichier, et .vscode/ s'il est vide.
      try { fs.unlinkSync(c.fichier); } catch (e) { return String((e && e.message) || e); }
      try { fs.rmdirSync(c.dossier); } catch (e) { /* pas vide : on le garde */ }
      return null;
    }
  }

  // Écriture atomique : fichier « ~$… », que OneDrive ne synchronise pas, puis rename.
  const tmp = path.join(c.dossier, '~$settings.json');
  try {
    fs.mkdirSync(c.dossier, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(valeurs, null, 2) + '\n', 'utf8');
    fs.renameSync(tmp, c.fichier);
    return null;
  } catch (e) {
    try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (err) { /* déjà renommé */ }
    return String((e && e.message) || e);
  }
}

function verrouPose(racine) {
  const valeurs = lireReglages(cheminsVerrou(racine).fichier);
  // Fichier illisible (null, à distinguer du fichier absent qui donne {}) : on suppose le
  // numéro verrouillé, plutôt que d'annoncer à tort qu'il ne l'est pas.
  if (valeurs === null) { return true; }
  const inc = valeurs['files.readonlyInclude'];
  return !!(inc && inc['**'] === true);
}

module.exports = { CLES_VERROU, appliquerVerrou, verrouPose, cheminsVerrou };
