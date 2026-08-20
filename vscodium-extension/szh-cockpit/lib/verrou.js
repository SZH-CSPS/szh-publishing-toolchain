// SZH cockpit — lecture seule du dossier de revue (D116, corrigé D131).
//
// Un numéro VERROUILLÉ doit résister aux frappes : l'éditeur passe en lecture seule pour
// tout le dossier. Le seul mécanisme que VS Code offre pour ça est le réglage
// `files.readonlyInclude`, et le seul endroit qui fasse VOYAGER le verrou avec le dossier
// (OneDrive, archivage, autre poste) est <revue>/.vscode/settings.json. C'est le seul
// fichier technique toléré dans un dossier de revue (entorse assumée à D8, limitée aux
// numéros gelés), masqué de l'explorateur par files.exclude.
//
// LES TROIS CLÉS :
//   files.readonlyInclude « ** »         tout le dossier en lecture seule
//   files.readonlyExclude « .vscode/** » SAUF nos propres réglages — voir ① ci-dessous
//   triggerTaskOnSave.tasks {}           plus de `make all` si un fichier est tout de
//                                        même enregistré (extension tierce, formatage)
//
// ⚠ DEUX PIÈGES, tous deux payés une fois :
// ① Le verrou verrouillait son propre interrupteur. `readonlyInclude: {'**': true}`
//    couvre AUSSI .vscode/settings.json ; or l'API de configuration de VS Code écrit à
//    travers le service de fichiers de l'éditeur, qui refuse une ressource en lecture
//    seule. Au déverrouillage, la clé survivait donc : le drapeau d'ausgabe.yaml
//    basculait (lui passe par fs) mais les articles restaient bloqués. D'où
//    `readonlyExclude` sur .vscode/**, ET l'écriture par fs dans ce module — qui ne
//    dépend plus du tout de l'éditeur.
// ② `getConfiguration().update(clé, undefined)` MATÉRIALISE le fichier : appelé au
//    passage sur une revue ordinaire, il semait un settings.json vide dans chaque
//    dossier de revue. En écrivant nous-mêmes, on ne touche au disque que quand il y a
//    vraiment quelque chose à écrire ou à retirer.
//
// Aucune dépendance à vscode : testable headless.
'use strict';

const fs = require('fs');
const path = require('path');

// Les clés que NOUS possédons. Tout le reste du fichier est préservé, et le fichier
// n'est effacé que s'il ne reste rien d'autre.
const CLES_VERROU = ['files.readonlyInclude', 'files.readonlyExclude', 'triggerTaskOnSave.tasks'];

function cheminsVerrou(racine) {
  const dossier = path.join(racine, '.vscode');
  return { dossier: dossier, fichier: path.join(dossier, 'settings.json') };
}

// Réglages du dossier tels qu'ils sont sur le disque, ou null si le fichier existe mais
// n'est pas du JSON exploitable (commentaires, édition à la main) — dans ce cas
// l'appelant s'arrête sans rien écraser.
function lireReglages(fichier) {
  if (!fs.existsSync(fichier)) { return {}; }
  try {
    const lu = JSON.parse(String(fs.readFileSync(fichier, 'utf8')).replace(/^﻿/, ''));
    if (lu && typeof lu === 'object' && !Array.isArray(lu)) { return lu; }
    return null;
  } catch (e) { return null; }
}

// appliquerVerrou(racine, verrouillee) -> null si tout va bien, sinon le message
// d'erreur. Ne lève JAMAIS : un échec ici ne doit pas laisser un archivage à moitié fait.
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
      // Plus rien à nous, et rien à personne d'autre : le dossier retrouve son état
      // épuré (D8).
      try { fs.unlinkSync(c.fichier); } catch (e) { return String((e && e.message) || e); }
      try { fs.rmdirSync(c.dossier); } catch (e) { /* pas vide : très bien */ }
      return null;
    }
  }

  // Écriture atomique (« ~$ » puis rename), comme ausgabe.yaml : jamais de fichier de
  // réglages à moitié écrit. Le préfixe « ~$ » est ignoré par la synchro OneDrive.
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

// Le dossier porte-t-il notre verrou ? Sert aux tests et au diagnostic ; l'état de
// référence reste `locked` dans ausgabe.yaml, jamais ce fichier.
function verrouPose(racine) {
  const valeurs = lireReglages(cheminsVerrou(racine).fichier);
  if (!valeurs) { return false; }
  const inc = valeurs['files.readonlyInclude'];
  return !!(inc && inc['**'] === true);
}

module.exports = { CLES_VERROU, appliquerVerrou, verrouPose, cheminsVerrou };
