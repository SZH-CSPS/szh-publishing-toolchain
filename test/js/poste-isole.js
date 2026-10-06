// Détourne les deux fichiers du poste que lib/i18n.js interroge pour choisir sa langue,
// C:\ProgramData\SZH\config.json et state.json, vers des fichiers vides. À requérir avant
// tout module du cockpit : un test ne lit rien de la machine qui l'exécute.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// Sans ce détour, un poste réglé en allemand fait rendre à T() des textes allemands, et tout
// test qui compare à des textes français tombe. Posés seulement s'ils ne le sont pas déjà :
// plusieurs contrôles pointent SZH_CONFIG_OJS vers leur propre fichier, et c'est le leur qui
// doit gagner.
let posteEssai = null;
for (const [variable, nom] of [['SZH_CONFIG_OJS', 'config.json'], ['SZH_ETAT_POSTE', 'state.json']]) {
  if (process.env[variable]) { continue; }
  if (!posteEssai) { posteEssai = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-poste-')); }
  const chemin = path.join(posteEssai, nom);
  fs.writeFileSync(chemin, '{}\n');
  process.env[variable] = chemin;
}
