// Passe tout le dossier d'un numéro verrouillé en lecture seule.
//
// Le seul mécanisme offert par VS Code est `files.readonlyInclude`, et le seul endroit qui
// fasse voyager le verrou avec le dossier (OneDrive, archivage, autre poste) est
// <revue>/.vscode/settings.json, unique fichier technique toléré dans une revue et masqué
// par files.exclude. Trois clés y sont écrites : `files.readonlyInclude` sur « ** »,
// `files.readonlyExclude` sur « .vscode/** », et `triggerTaskOnSave.tasks` vidé pour qu'un
// enregistrement fait par une extension tierce ne relance pas `make all`.
//
// ⚠ Deux pièges vérifiés. `readonlyInclude: {'**': true}` couvre aussi
// .vscode/settings.json, et l'API de configuration de VS Code écrit à travers son service
// de fichiers, qui refuse une ressource en lecture seule : sans `readonlyExclude` et sans
// l'écriture par fs faite ici, le verrou verrouillerait son propre interrupteur. Et
// `getConfiguration().update(clé, undefined)` matérialise le fichier, semant un
// settings.json vide dans chaque dossier de revue simplement visité.
'use strict';

const fs = require('fs');
const path = require('path');

const CLES_VERROU = ['files.readonlyInclude', 'files.readonlyExclude', 'triggerTaskOnSave.tasks'];

function cheminsVerrou(racine) {
  const dossier = path.join(racine, '.vscode');
  return { dossier: dossier, fichier: path.join(dossier, 'settings.json') };
}

// Réglages du disque, ou null si le fichier n'est pas du JSON exploitable, auquel cas
// l'appelant s'arrête sans rien écraser.
function lireReglages(fichier) {
  if (!fs.existsSync(fichier)) { return {}; }
  try {
    const lu = JSON.parse(String(fs.readFileSync(fichier, 'utf8')).replace(/^﻿/, ''));
    if (lu && typeof lu === 'object' && !Array.isArray(lu)) { return lu; }
    return null;
  } catch (e) { return null; }
}

// Renvoie null si tout va bien, sinon le message d'erreur. Ne lève pas : un échec ici ne
// doit pas laisser un archivage à moitié fait.
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
      // Plus rien à nous ni à personne : le dossier retrouve son état épuré.
      try { fs.unlinkSync(c.fichier); } catch (e) { return String((e && e.message) || e); }
      try { fs.rmdirSync(c.dossier); } catch (e) { /* pas vide : très bien */ }
      return null;
    }
  }

  // Écriture atomique, préfixe « ~$ » ignoré par la synchro OneDrive puis rename.
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
  if (!valeurs) { return false; }
  const inc = valeurs['files.readonlyInclude'];
  return !!(inc && inc['**'] === true);
}

module.exports = { CLES_VERROU, appliquerVerrou, verrouPose, cheminsVerrou };
