// Médias d'un article : dimensions d'image sans dépendance, noms de fichiers sûrs,
// versions d'un portrait en data: URI, et détection des doublons dans media/. Rien ici ne
// dépend de vscode ni de l'état du module hôte (profil actif, panneaux ouverts, build en
// cours) : chaque fonction reçoit en paramètre tout ce dont elle a besoin, et se rejoue
// donc seule en test — comme lib/qualite-image.js et lib/cmyk.js, dont ce module est le
// voisin naturel.
//
// Ce qui reste dans extension.js, volontairement : le gestionnaire de webview des médias
// (ouvrirGestionMedias) et les agrégats qui en dépendent (listerMediasArticle,
// listerPortraitsArticle, listerGrillesArticle) — ils lisent `fournisseur` et
// dossierUnites(), donc le profil actif ; le remplacement et l'ajout de fichiers
// (remplacerFichierImage, ajouterImageACote), qui touchent vscode.window et l'état de
// build dans le même geste ; et vignetteAuteur/dossierPortraitsArticle, qui dépendent eux
// aussi du profil actif pour situer le dossier portraits/ d'un article.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { slugifier } = require('./slug');

// ---- Extensions et poids acceptés pour une image déposée par une webview ---------
const EXTENSIONS_IMAGE_IMPORT = ['png', 'jpg', 'jpeg', 'gif', 'svg'];
const TAILLE_MAX_IMAGE_IMPORT = 50 * 1024 * 1024;  // 50 Mo, vérifiés webview et hôte

// ---- Dimensions et description d'une image ---------------------------------------

// Lues dans les en-têtes : sûres pour PNG, GIF et SVG, au mieux pour JPEG ; null si
// indéterminable, la description retombant sur le poids seul.
function lireDimensionsImage(chemin) {
  let fd = null;
  try {
    fd = fs.openSync(chemin, 'r');
    const tampon = Buffer.alloc(65536);
    const lu = fs.readSync(fd, tampon, 0, tampon.length, 0);
    const b = tampon.subarray(0, lu);
    if (lu >= 24 && b.readUInt32BE(0) === 0x89504e47) {          // PNG : IHDR
      return { largeur: b.readUInt32BE(16), hauteur: b.readUInt32BE(20) };
    }
    if (lu >= 10 && (b.toString('latin1', 0, 6) === 'GIF87a' || b.toString('latin1', 0, 6) === 'GIF89a')) {
      return { largeur: b.readUInt16LE(6), hauteur: b.readUInt16LE(8) };
    }
    if (lu >= 4 && b[0] === 0xff && b[1] === 0xd8) {             // JPEG : marqueurs SOF
      let i = 2;
      while (i + 9 < lu) {
        if (b[i] !== 0xff) { i++; continue; }
        const marqueur = b[i + 1];
        if (marqueur === 0xff) { i++; continue; }                 // bourrage FF
        if (marqueur === 0xd8 || (marqueur >= 0xd0 && marqueur <= 0xd7) || marqueur === 0x01) { i += 2; continue; }
        if (marqueur === 0xda) { break; }                         // données : SOF manqué
        const longueur = b.readUInt16BE(i + 2);
        if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) {
          return { largeur: b.readUInt16BE(i + 7), hauteur: b.readUInt16BE(i + 5) };
        }
        if (longueur < 2) { break; }                              // en-tête corrompu
        i += 2 + longueur;
      }
      return null;
    }
    // WEBP : conteneur RIFF, trois formes de bloc. Les portraits en acceptent, et sans
    // dimensions le formulaire des médias n'aurait aucun verdict à rendre.
    if (lu >= 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
      const bloc = b.toString('latin1', 12, 16);
      if (bloc === 'VP8X') {                                      // étendu : 24 bits - 1
        return { largeur: (b.readUIntLE(24, 3) & 0xffffff) + 1, hauteur: (b.readUIntLE(27, 3) & 0xffffff) + 1 };
      }
      if (bloc === 'VP8 ' && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
        return { largeur: b.readUInt16LE(26) & 0x3fff, hauteur: b.readUInt16LE(28) & 0x3fff };
      }
      if (bloc === 'VP8L') {                                      // 14 bits chacun, - 1
        const bits = b.readUInt32LE(21);
        return { largeur: (bits & 0x3fff) + 1, hauteur: ((bits >> 14) & 0x3fff) + 1 };
      }
      return null;
    }
    if (/\.svg$/i.test(chemin)) {                                 // SVG : attributs ou viewBox
      const texte = b.toString('utf8');
      const balise = texte.match(/<svg[^>]*>/i);
      if (balise) {
        const l = balise[0].match(/[\s"']width\s*=\s*["']?([0-9.]+)(?:px)?["']?/i);
        const h = balise[0].match(/[\s"']height\s*=\s*["']?([0-9.]+)(?:px)?["']?/i);
        if (l && h) { return { largeur: Math.round(parseFloat(l[1])), hauteur: Math.round(parseFloat(h[1])) }; }
        const vb = balise[0].match(/viewBox\s*=\s*["']\s*[0-9.+-]+[\s,]+[0-9.+-]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/i);
        if (vb) { return { largeur: Math.round(parseFloat(vb[1])), hauteur: Math.round(parseFloat(vb[2])) }; }
      }
    }
    return null;
  } catch (e) {
    return null;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch (e) { /* déjà fermé */ } }
  }
}

// « 1 234 × 567 · 245 Ko » ; virgule française pour les Mo.
function decrireImage(chemin) {
  let octets = 0;
  try { octets = fs.statSync(chemin).size; } catch (e) { return ''; }
  let poids;
  if (octets < 1024) { poids = octets + ' o'; }
  else if (octets < 1024 * 1024) { poids = Math.round(octets / 1024) + ' Ko'; }
  else { poids = (octets / (1024 * 1024)).toFixed(1).replace('.', ',') + ' Mo'; }
  const dims = lireDimensionsImage(chemin);
  return dims ? dims.largeur + ' × ' + dims.hauteur + ' · ' + poids : poids;
}

// Extension « logique » pour la comparaison de formats (jpg et jpeg = même format).
function formatImage(nom) {
  const ext = (nom.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
  return ext === 'jpeg' ? 'jpg' : ext;
}

// ---- Noms de fichiers sûrs, dans media/ --------------------------------------------

// Nom de fichier tiré de ce qu'une webview annonce, donc de ce qu'un rédacteur a nommé :
// accents, espaces, parenthèses, et parfois un chemin entier. On garde le nom d'origine,
// comme « Insérer une figure » (lib/formatting.js) — il dit quelque chose au rédacteur —
// mais réduit à ce qui traverse sans dommage un lien markdown, un Makefile et WSL.
// Le dossier n'est jamais lu depuis l'appelant : seul le dernier segment survit.
function nomImageAssaini(nomFichier) {
  const brut = String(nomFichier || '').replace(/\\/g, '/');
  const base = brut.slice(brut.lastIndexOf('/') + 1);
  const ext = (base.match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (EXTENSIONS_IMAGE_IMPORT.indexOf(ext) === -1) { return null; }
  const corps = slugifier(base.slice(0, base.length - ext.length - 1));
  return corps.slice(0, 60) + '.' + (ext === 'jpeg' ? 'jpg' : ext);
}

// Nom libre dans media/ : même règle que nomMediaUnique de lib/formatting.js, que ce
// module ne peut pas appeler (il vit derrière require('vscode')).
function nomMediaLibre(dossier, nom) {
  const point = nom.lastIndexOf('.');
  const base = nom.slice(0, point);
  const ext = nom.slice(point);
  let candidat = nom;
  let i = 1;
  while (fs.existsSync(path.join(dossier, candidat))) { candidat = base + '-' + i + ext; i++; }
  return candidat;
}

// Chemin d'image reçu de la webview d'import : relatif à articles/<slug>/media/,
// segments sûrs, extension d'image. Aucun chemin n'est construit sans passer ici. Pure.
function relatifImageValide(relatif) {
  const c = String(relatif === undefined || relatif === null ? '' : relatif);
  if (c === '' || c.length > 300 || /[\\:\r\n]/.test(c)) { return false; }
  const segments = c.split('/');
  for (const s of segments) {
    if (s === '' || s === '.' || s === '..' || s.indexOf('~$') === 0) { return false; }
  }
  return /\.(png|jpe?g|gif|svg)$/i.test(segments[segments.length - 1]);
}

// ---- Photos d'auteur·e·s : chemin, versions, doublons ------------------------------

const MIMES_PHOTO = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };

// Le champ `photo` est posé par la modale, jamais saisi : seul un chemin relatif sous
// portraits/, sans remontée ni segment vide, est accepté.
function assainirCheminPhoto(valeur) {
  const c = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  if (c === '' || c.length > 300) { return ''; }
  if (c.indexOf('\\') !== -1 || /[\r\n:]/.test(c)) { return ''; }
  const morceaux = c.split('/');
  if (morceaux.length !== 2 || morceaux[0] !== 'portraits') { return ''; }
  const nom = morceaux[1];
  if (nom === '' || nom === '.' || nom === '..') { return ''; }
  return c;
}

// Champ `photo` déjà assaini -> { base, version } : une base, trois suffixes.
// La base n'est pas contrôlée ici : baseAuteurValide s'en charge chez les appelants, qui
// doivent tous répondre quelque chose — une modale qui a désactivé son bouton avant
// d'envoyer reste figée sur un silence.
function decomposerPhoto(photo) {
  const nom = String(photo || '').replace(/^portraits\//, '');
  let m = nom.match(/^(.+)\.original\.[a-z0-9]+$/i);
  if (m) { return { base: m[1], version: 'original' }; }
  m = nom.match(/^(.+)\.avec-fond\.png$/i);
  if (m) { return { base: m[1], version: 'avec-fond' }; }
  m = nom.match(/^(.+)\.sans-fond\.png$/i);
  if (m) { return { base: m[1], version: 'sans-fond' }; }
  return null;
}

// Un seul segment de chemin, alphabet sûr : pas de remontée hors de portraits/.
function baseAuteurValide(base) {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(base || ''));
}

// Aperçus de la modale ; null si l'image est illisible.
function dataUriImage(chemin) {
  try {
    const ext = (chemin.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
    return 'data:' + (MIMES_PHOTO[ext] || 'image/png') + ';base64,' +
      fs.readFileSync(chemin).toString('base64');
  } catch (e) { return null; }
}

// <base>.original.<ext> présent dans `dossier`, dont la webview ignore l'extension.
function trouverOriginal(dossier, base) {
  let noms = [];
  try { noms = fs.readdirSync(dossier); } catch (e) { return null; }
  for (const n of noms) {
    if (n.indexOf(base + '.original.') === 0 && !n.startsWith('~$')) { return n; }
  }
  return null;
}

function versionsPhoto(dossier, base) {
  const original = trouverOriginal(dossier, base);
  return {
    original: original ? dataUriImage(path.join(dossier, original)) : null,
    avecFond: dataUriImage(path.join(dossier, base + '.avec-fond.png')),
    sansFond: dataUriImage(path.join(dossier, base + '.sans-fond.png'))
  };
}

// ---- Aperçu d'une image de media/, sous budget -------------------------------------

// Dans un <img>, un SVG ne peut ni exécuter de script ni charger de ressource externe.
const MIMES_APERCU_MEDIA = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  svg: 'image/svg+xml', webp: 'image/webp'
};
// Au-delà, pas d'aperçu : le base64 d'une grosse image gonflerait le postMessage.
const TAILLE_MAX_APERCU_MEDIA = 8 * 1024 * 1024;
// Et un plafond pour le message entier : le formulaire charge d'un coup les aperçus de
// toutes les images et de tous les portraits. Quinze photos d'impression suffiraient à
// envoyer plus de cent mégaoctets de base64 dans un seul postMessage et à figer l'hôte.
// Passé le budget, les cartes suivantes s'affichent sans aperçu.
const BUDGET_APERCUS_MEDIA = 24 * 1024 * 1024;

// `budget` (facultatif) = { reste: octets } décrémenté au fil des aperçus rendus.
function apercuMedia(chemin, budget) {
  try {
    const octets = fs.statSync(chemin).size;
    if (octets > TAILLE_MAX_APERCU_MEDIA) { return null; }
    if (budget) {
      if (budget.reste < octets) { return null; }
      budget.reste -= octets;
    }
    const ext = (chemin.match(/\.([a-z0-9]+)$/i) || ['', ''])[1].toLowerCase();
    if (!MIMES_APERCU_MEDIA[ext]) { return null; }
    return 'data:' + MIMES_APERCU_MEDIA[ext] + ';base64,' + fs.readFileSync(chemin).toString('base64');
  } catch (e) { return null; }
}

// ---- Doublons dans media/ : deux noms, un seul contenu -----------------------------

// Fichiers identiques sous deux noms : Word duplique volontiers la même image, et deux
// cartes pour un seul visuel se remplissent deux fois, avec deux légendes qui divergent.
// L'empreinte du contenu le dit, là où la taille seule se trompe.
function empreinteFichier(chemin) {
  try { return crypto.createHash('sha1').update(fs.readFileSync(chemin)).digest('hex'); }
  catch (e) { return null; }
}

function tailleFichier(chemin) {
  try { return fs.statSync(chemin).size; } catch (e) { return -1; }
}

// relatif -> empreinte, pour les seuls fichiers dont la taille est partagée : deux contenus
// identiques ont forcément la même taille, et l'immense majorité des articles n'a aucun
// doublon. Sans ce tri, chaque chargement relisait tous les fichiers pour rien.
function empreintesPartagees(base, relatifs) {
  const parTaille = new Map();
  for (const relatif of relatifs) {
    const t = tailleFichier(path.join(base, relatif));
    if (t <= 0) { continue; }
    if (!parTaille.has(t)) { parTaille.set(t, []); }
    parTaille.get(t).push(relatif);
  }
  const empreintes = new Map();
  for (const memeTaille of parTaille.values()) {
    if (memeTaille.length < 2) { continue; }
    for (const relatif of memeTaille) {
      const e = empreinteFichier(path.join(base, relatif));
      if (e) { empreintes.set(relatif, e); }
    }
  }
  return empreintes;
}

module.exports = {
  EXTENSIONS_IMAGE_IMPORT, TAILLE_MAX_IMAGE_IMPORT,
  lireDimensionsImage, decrireImage, formatImage,
  nomImageAssaini, nomMediaLibre, relatifImageValide,
  assainirCheminPhoto, decomposerPhoto, baseAuteurValide,
  dataUriImage, trouverOriginal, versionsPhoto,
  BUDGET_APERCUS_MEDIA, apercuMedia,
  empreinteFichier, tailleFichier, empreintesPartagees
};
