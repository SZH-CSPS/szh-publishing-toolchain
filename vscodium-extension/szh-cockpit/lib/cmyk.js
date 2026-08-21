// Conversion des JPEG CMJN en RVB : détection ici, conversion dans la WSL.
//
// Un JPEG CMJN sort d'une chaîne d'imprimerie. Ni les navigateurs ni WeasyPrint ne
// l'affichent correctement — couleurs inversées au mieux, image absente au pire — et le
// défaut ne se voit qu'au PDF, une fois l'article composé. La détection est faite ici, sans
// dépendance, en lisant l'en-tête : un JPEG dont le marqueur SOF déclare quatre composantes
// est en CMJN (ou YCCK). La conversion, elle, demande Pillow : elle passe par
// `pipeline/cmyk-rgb.py` dans le venv du rootfs, comme le détourage des portraits.
//
// Le fichier est réécrit sous son propre nom : les références du .md restent valides.
'use strict';

const fs = require('fs');
const { spawn } = require('child_process');
const { reveillerWsl, DISTRO, cheminWsl } = require('./wsl');
const { cheminVersWsl, INTERPRETE_DEFAUT } = require('./portraits');

const SCRIPT_DEFAUT = '/mnt/c/ProgramData/SZH/toolkit/pipeline/cmyk-rgb.py';
// Pillow est déjà chargé par le venv : sans le réveil de la VM, quelques secondes suffisent.
const TIMEOUT_DEFAUT = 60000;

// Nombre de composantes déclaré par le marqueur SOF d'un JPEG, ou 0 si indéterminable.
//
// ⚠ Le fichier est parcouru de segment en segment, et non sur une fenêtre de tête : un JPEG
// d'imprimerie porte son profil ICC CMJN en segments APP2, et un profil comme ISO Coated v2
// pèse près de deux mégaoctets. Le marqueur SOF tombe alors très au-delà des premiers
// kilooctets — précisément sur les fichiers que cette détection existe pour attraper.
// Chaque lecture ne prend que douze octets, à la position calculée.
function composantesJpeg(chemin) {
  let fd = null;
  try {
    const taille = fs.statSync(chemin).size;
    fd = fs.openSync(chemin, 'r');
    const seg = Buffer.alloc(12);
    if (fs.readSync(fd, seg, 0, 2, 0) !== 2 || seg[0] !== 0xff || seg[1] !== 0xd8) { return 0; }
    let pos = 2;
    // Garde-fou : un fichier tronqué ou brouillé ne doit pas faire tourner la boucle sans
    // fin. Aucun JPEG réel ne porte des milliers de segments d'en-tête.
    let segments = 0;
    while (pos + 4 <= taille && segments++ < 4096) {
      const lu = fs.readSync(fd, seg, 0, 12, pos);
      if (lu < 4) { return 0; }
      if (seg[0] !== 0xff) { pos++; continue; }                  // désynchronisé : on se recale
      const marqueur = seg[1];
      if (marqueur === 0xff) { pos++; continue; }                // bourrage
      if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd7) || marqueur === 0x01) {
        pos += 2;                                                // marqueurs sans charge utile
        continue;
      }
      if (marqueur === 0xda || marqueur === 0xd9) { return 0; }  // données ou fin : SOF manqué
      const longueur = seg.readUInt16BE(2);
      if (longueur < 2) { return 0; }                            // en-tête corrompu
      // SOF0 à SOF15, hors DHT (C4), JPG (C8) et DAC (CC) : Nf suit Lf, P, Y et X.
      if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) {
        return lu >= 10 ? seg[9] : 0;
      }
      pos += 2 + longueur;
    }
    return 0;
  } catch (e) {
    return 0;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* déjà fermé */ } }
  }
}

// Quatre composantes = CMJN ou YCCK. Trois = YCbCr, une = niveaux de gris : rien à faire.
function estJpegCmyk(chemin) {
  return composantesJpeg(chemin) === 4;
}

// -> Promise<[{chemin, ok, converti, mode, profil, erreur}]>, une entrée par fichier
// converti. Les chemins qui ne sont pas des JPEG CMJN ne sont même pas envoyés : le tableau
// rendu est vide et aucun processus n'est lancé. Rejette si wsl.exe est introuvable
// (erreur marquée .wsl), si le délai est dépassé, ou si stdout ne porte aucune ligne JSON.
function convertirCmykEnRgb(options) {
  const o = options || {};
  const candidats = (Array.isArray(o.chemins) ? o.chemins : [])
    .map((c) => String(c || '')).filter((c) => c !== '' && estJpegCmyk(c));
  if (candidats.length === 0) { return Promise.resolve([]); }
  const interprete = String(o.interprete || INTERPRETE_DEFAUT);
  const script = String(o.script || SCRIPT_DEFAUT);
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : TIMEOUT_DEFAUT;
  const args = ['-d', DISTRO, '--', interprete, script].concat(candidats.map(cheminVersWsl));

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
