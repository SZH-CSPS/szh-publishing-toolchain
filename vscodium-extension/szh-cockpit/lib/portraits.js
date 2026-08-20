// Invoque `pipeline/portraits.py` dans la WSL (spawn de wsl.exe, sans shell) et lit sa
// sortie. Le script recadre le visage (YuNet), détoure (rembg), écrit
// <slug>.avec-fond.png et <slug>.sans-fond.png dans le dossier de sortie, et répond une
// ligne JSON par image sur stdout :
//   {"slug":…, "ok":bool, "visage":bool, "padding":bool,
//    "fichiers":{"avec_fond":…, "sans_fond":…}|null, "erreur":null|str}
// L'écriture de l'original et les chemins relatifs du champ `photo` restent à l'appelant.
'use strict';

const { spawn } = require('child_process');
const { reveillerWsl, DISTRO, cheminWsl } = require('./wsl');

const INTERPRETE_DEFAUT = '/opt/portraits/bin/python';
const SCRIPT_DEFAUT = '/mnt/c/ProgramData/SZH/toolkit/pipeline/portraits.py';
// Large, car le premier appel paie le réveil de la VM et le chargement du modèle
// u2net_human_seg ; les images suivantes de la même session sont bien plus rapides.
const TIMEOUT_DEFAUT = 180000;

function cheminVersWsl(chemin) {
  const c = String(chemin || '');
  const m = c.match(/^([A-Za-z]):[\\/](.*)$/);
  if (!m) { return c.replace(/\\/g, '/'); }
  return '/mnt/' + m[1].toLowerCase() + '/' + m[2].replace(/\\/g, '/');
}

// -> Promise<[{slug, ok, visage, padding, fichiers, erreur}]>. Une invocation traite
// toutes les images en une session, le modèle rembg n'étant chargé qu'une fois. Rejette
// si wsl.exe est introuvable (erreur marquée .wsl), si le délai est dépassé, ou si stdout
// ne porte aucune ligne JSON exploitable ; un code retour non nul accompagné de lignes
// valides résout quand même, l'échec étant alors porté par entrée.
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
