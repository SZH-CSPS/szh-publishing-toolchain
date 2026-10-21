// Les tâches de démarrage du lanceur (Invoke-SzhTachesDemarrage, windows/szh-shell.ps1) quand
// VSCodium a été ouvert sans passer par « Pronto » : par VSCodium épinglé à la barre des
// tâches, ou par son propre raccourci. Le lanceur pose SZH_TACHES_DEMARRAGE, dont hérite le
// VSCodium qu'il ouvre. Sans elle, le cockpit lance `open-revue.ps1 -Demarrage`, au plus une
// fois toutes les 12 heures pour l'ensemble des fenêtres (la date vit dans globalState).
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { toolkitPoste, cheminSysteme } = require('./poste');

const CLE_DERNIER = 'szh.demarrage.le';
const PERIODE_MS = 12 * 60 * 60 * 1000;

// Vrai s'il faut lancer les tâches. `derniere` : la date du dernier lancement par le
// cockpit, en millisecondes, ou undefined. Les tests (SZH_RESEAU_INTERDIT, simulation) ne
// lancent rien.
function aLancer(env, derniere, maintenant, plateforme) {
  if (plateforme !== 'win32') { return false; }
  if (env.SZH_TACHES_DEMARRAGE || env.SZH_RESEAU_INTERDIT || env.SZH_LANCEUR_SIMULE === '1') { return false; }
  const d = Number(derniere);
  if (!Number.isFinite(d)) { return true; }
  const ecart = maintenant - d;
  return ecart < 0 || ecart >= PERIODE_MS;
}

function scriptLanceur() { return path.join(toolkitPoste(), 'windows', 'open-revue.ps1'); }

// Lance les tâches si besoin et rend une promesse : vrai une fois le script terminé, faux
// s'il n'a pas été lancé. La date est posée avant le lancement, pour qu'une deuxième fenêtre
// ouverte entre-temps ne le relance pas. Le script peut ouvrir la fenêtre qui demande le
// dossier SharePoint : aucun délai ne l'interrompt. Ne rejette jamais.
async function lancerSiBesoin(memoire, opts) {
  const o = Object.assign({ env: process.env, maintenant: Date.now(), plateforme: process.platform,
    executer: execFile, existe: fs.existsSync }, opts);
  if (!memoire || !aLancer(o.env, memoire.get(CLE_DERNIER), o.maintenant, o.plateforme)) { return false; }
  const script = scriptLanceur();
  if (!o.existe(script)) { return false; }
  try { await memoire.update(CLE_DERNIER, o.maintenant); } catch (e) { /* relancé à la prochaine fenêtre */ }
  return new Promise((resoudre) => {
    try {
      o.executer(cheminSysteme('WindowsPowerShell', 'v1.0', 'powershell.exe'),
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Demarrage'],
        { windowsHide: true }, () => resoudre(true));
    } catch (e) { resoudre(false); }
  });
}

module.exports = { aLancer, lancerSiBesoin, CLE_DERNIER, PERIODE_MS };
