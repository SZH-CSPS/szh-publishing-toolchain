// SZH cockpit — appel du pipeline de portraits dans la WSL (F3, D91/D92).
// `pipeline/portraits.py` tourne dans le venv /opt/portraits du rootfs
// SZH-Publishing : recadrage visage (YuNet) + détourage (rembg), il écrit
// <slug>.avec-fond.png et <slug>.sans-fond.png (400 × 400, N&B) dans le dossier
// de sortie et répond UNE ligne JSON par image sur stdout —
//   {"slug":…, "ok":bool, "visage":bool, "padding":bool,
//    "fichiers":{"avec_fond":…, "sans_fond":…}|null, "erreur":null|str}
// Ce module ne fait qu'invoquer le script (spawn wsl.exe, jamais de shell) et
// parser ces lignes ; l'écriture de l'original et les chemins relatifs du champ
// `photo` restent la responsabilité de l'appelant (extension.js).
// Aucune dépendance à vscode ni à i18n (testable headless).
'use strict';

const { spawn } = require('child_process');
const { reveillerWsl, DISTRO, cheminWsl } = require('./wsl');

// Défauts du poste déployé (D91) : venv du rootfs + script du toolkit installé.
// Surchargeables par les options — c'est ce qu'utilisent les tests headless
// (venv de test + script du dépôt via /mnt/c/…).
const INTERPRETE_DEFAUT = '/opt/portraits/bin/python';
const SCRIPT_DEFAUT = '/mnt/c/ProgramData/SZH/toolkit/pipeline/portraits.py';
// 180 s : le PREMIER appel paie le réveil de la VM + le chargement du modèle
// u2net_human_seg ; les suivants sont à ~1 s/image (session amortie côté script).
const TIMEOUT_DEFAUT = 180000;

// Chemin Windows -> chemin WSL : « C:\Users\x » -> « /mnt/c/Users/x ». Les
// espaces ne se négocient pas ici : chaque chemin part comme UN argument de
// spawn (pas de shell, donc pas de quoting). Un chemin déjà POSIX (tests) est
// rendu tel quel, antislashs normalisés.
function cheminVersWsl(chemin) {
  const c = String(chemin || '');
  const m = c.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) { return c.replace(/\\/g, '/'); }
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}

// traiterPortraits({ dossierPortraits, entrees:[{slug, cheminSource}],
//                    interprete?, script?, timeoutMs? })
//   -> Promise<[{slug, ok, visage, padding, fichiers, erreur}]>
// Une invocation = UNE session du script pour N images (le modèle rembg n'est
// chargé qu'une fois). Réveille la VM d'abord (reveillerWsl ne rejette jamais).
// Rejette : wsl.exe introuvable (erreur marquée .wsl = true), délai dépassé, ou
// aucune ligne JSON exploitable (rootfs sans /opt/portraits, script absent…).
// Les lignes parasites de stdout sont ignorées ; stderr n'est pas lu (les traces
// de progression du script y vivent). Un code retour non nul avec des lignes
// JSON valides RÉSOUT quand même : l'échec est porté par entrée (ok:false).
function traiterPortraits(options) {
  const o = options || {};
  const entrees = (Array.isArray(o.entrees) ? o.entrees : [])
    .map((e) => ({ slug: String((e && e.slug) || '').trim(), cheminSource: String((e && e.cheminSource) || '') }))
    .filter((e) => e.slug !== '' && e.cheminSource !== '');
  if (entrees.length === 0) { return Promise.resolve([]); }
  const interprete = String(o.interprete || INTERPRETE_DEFAUT);
  const script = String(o.script || SCRIPT_DEFAUT);
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : TIMEOUT_DEFAUT;

  const args = ['-d', DISTRO, '--', interprete, script, cheminVersWsl(o.dossierPortraits)];
  for (const e of entrees) { args.push(e.slug, cheminVersWsl(e.cheminSource)); }

  return reveillerWsl().then(() => new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(cheminWsl(), args, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      const erreur = new Error('wsl.exe introuvable : ' + e.message);
      erreur.wsl = true;
      reject(erreur);
      return;
    }
    const morceaux = [];
    let fini = false, minuteur = null;
    const finir = () => {
      if (fini) { return false; }
      fini = true;
      if (minuteur) { clearTimeout(minuteur); }
      return true;
    };
    minuteur = setTimeout(() => {
      try { proc.kill(); } catch (e) { /* déjà mort */ }
      if (finir()) { reject(new Error('délai dépassé (' + Math.round(timeoutMs / 1000) + ' s)')); }
    }, timeoutMs);
    proc.stdout.on('data', (d) => morceaux.push(d));
    proc.on('error', (e) => {
      if (finir()) {
        const erreur = new Error('wsl.exe : ' + e.message);
        erreur.wsl = true;
        reject(erreur);
      }
    });
    proc.on('close', (code) => {
      if (!finir()) { return; }
      const resultats = [];
      for (const ligne of Buffer.concat(morceaux).toString('utf8').split(/\r?\n/)) {
        const nette = ligne.trim();
        if (nette === '' || nette.charAt(0) !== '{') { continue; }   // parasite : ignoré
        try {
          const obj = JSON.parse(nette);
          if (obj && typeof obj === 'object' && typeof obj.slug === 'string') { resultats.push(obj); }
        } catch (e) { /* ligne non JSON : ignorée */ }
      }
      if (resultats.length === 0) {
        reject(new Error('aucune sortie exploitable du pipeline de portraits (code ' + code + ')'));
        return;
      }
      resolve(resultats);
    });
  }));
}

module.exports = { traiterPortraits, cheminVersWsl, INTERPRETE_DEFAUT, SCRIPT_DEFAUT };
