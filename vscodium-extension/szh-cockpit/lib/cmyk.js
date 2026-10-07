// Conversion des JPEG CMJN en RVB : détection ici, conversion dans la WSL.
//
// Un JPEG CMJN sort d'une chaîne d'imprimerie. Ni les navigateurs ni WeasyPrint ne
// l'affichent correctement (couleurs inversées, ou image absente), et le défaut ne se voit
// qu'au PDF. La détection lit l'en-tête, sans dépendance : un marqueur SOF à quatre
// composantes signale du CMJN (ou YCCK). La conversion demande Pillow : elle passe par
// `pipeline/cmyk-rgb.py` dans le venv de la WSL, comme le détourage des portraits.
//
// Le fichier est réécrit sous son propre nom : les références du .md restent valides.
'use strict';

const fs = require('fs');
const moteur = require('./moteur');
const { cheminVersWsl, INTERPRETE_DEFAUT } = require('./portraits');
const { sofJpeg } = require('./medias');

const SCRIPT_DEFAUT = moteur.toolkitMoteur('pipeline', 'cmyk-rgb.py');
// Pillow est déjà installé dans le venv ; hors réveil de la VM, quelques secondes suffisent.
const TIMEOUT_DEFAUT = 60000;

// Nombre de composantes déclaré par le marqueur SOF d'un JPEG, ou 0 si indéterminable.
// lib/medias.js#sofJpeg parcourt le fichier segment par segment, ce qui trouve le SOF même
// derrière un gros profil ICC.
function composantesJpeg(chemin) {
  const sof = sofJpeg(chemin);
  return sof ? sof.composantes : 0;
}

// Quatre composantes = CMJN ou YCCK. Trois = YCbCr, une = niveaux de gris : rien à faire.
function estJpegCmyk(chemin) {
  return composantesJpeg(chemin) === 4;
}

// -> Promise<[{chemin, ok, converti, mode, profil, erreur}]>, une entrée par fichier
// converti. Seuls les JPEG CMJN sont envoyés ; s'il n'y en a aucun, le tableau est vide et
// aucun processus n'est lancé. Rejette si wsl.exe est introuvable (erreur marquée .wsl), si
// le délai est dépassé, ou si stdout ne porte aucune ligne JSON.
function convertirCmykEnRgb(options) {
  const o = options || {};
  const candidats = (Array.isArray(o.chemins) ? o.chemins : [])
    .map((c) => String(c || '')).filter((c) => c !== '' && estJpegCmyk(c));
  if (candidats.length === 0) { return Promise.resolve([]); }
  const interprete = String(o.interprete || INTERPRETE_DEFAUT);
  const script = String(o.script || SCRIPT_DEFAUT);
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : TIMEOUT_DEFAUT;
  const args = [interprete, script].concat(candidats.map(cheminVersWsl));

  return moteur.reveiller().then(() => new Promise((resolve, reject) => {
    let proc;
    try {
      proc = moteur.executer(args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      const erreur = new Error('wsl.exe introuvable : ' + e.message);
      erreur.wsl = true;
      reject(erreur);
      return;
    }
    const morceaux = [];
    let fini = false;
    let minuteur = null;
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
        if (nette === '' || nette.charAt(0) !== '{') { continue; }
        try {
          const obj = JSON.parse(nette);
          if (obj && typeof obj === 'object') { resultats.push(obj); }
        } catch (e) { /* ligne non JSON : ignorée */ }
      }
      if (resultats.length === 0) {
        reject(new Error('aucune sortie exploitable de la conversion CMJN (code ' + code + ')'));
        return;
      }
      resolve(resultats);
    });
  }));
}

module.exports = { convertirCmykEnRgb, estJpegCmyk, composantesJpeg, SCRIPT_DEFAUT };
