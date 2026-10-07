// Images des cellules de tableau, côté hôte : l'aperçu montré par l'éditeur de tableau, et
// la copie dans media/ faite par « Insérer une image… » ou « Remplacer l'image… ». La
// balise <img> elle-même est modifiée par lib/table-model.js.
//
// Le src d'une image de cellule est relatif au dossier de l'article (media/…), comme
// l'écrit pipeline/docx-tables.py : szh-tabelle-inclure.lua insère le tableau dans
// l'article, et WeasyPrint résout le src depuis le dossier de l'article.
'use strict';

const fs = require('fs');
const path = require('path');
const { apercuMedia, BUDGET_APERCUS_MEDIA, relatifImageValide, nomImageAssaini } = require('./medias');
const { nomMediaUnique } = require('./formatting-pur');
const { srcImagesModele } = require('./table-model');

// articles/<slug>/tables/table-NN.html -> articles/<slug>. Tiré du chemin, car l'éditeur
// peut s'ouvrir sans slug.
function dossierArticleDeTable(cheminTable) {
  return path.dirname(path.dirname(String(cheminTable || '')));
}

// src (tel qu'écrit dans la cellule) -> { etat, uri } :
//   'ok'           aperçu en data: (les webviews n'ont aucune racine locale autorisée) ;
//   'introuvable'  pas de fichier, ou un src qui sort de l'article (http:, chemin absolu,
//                  « .. ») ;
//   'indisponible' le fichier existe, mais trop lourd, hors budget, ou d'un format que la
//                  webview n'affiche pas.
// `budget` = { reste: octets }, partagé entre toutes les images d'un même chargement.
function apercuImageTable(dossierArticle, src, budget) {
  const s = String(src || '');
  if (!relatifImageValide(s)) {
    // relatifImageValide refuse aussi une extension inconnue : si le fichier existe, il
    // est seulement sans aperçu.
    const sur = s !== '' && !/[:\\]/.test(s) && s[0] !== '/' && s.split('/').indexOf('..') === -1;
    if (sur && fichierExiste(path.join(dossierArticle, s))) { return { etat: 'indisponible' }; }
    return { etat: 'introuvable' };
  }
  // WeasyPrint décode un src encodé (« a%20b.png ») : on essaie les deux formes.
  let chemin = path.join(dossierArticle, s);
  if (!fichierExiste(chemin)) {
    let decode = s;
    try { decode = decodeURIComponent(s); } catch (e) { /* séquence invalide : tel quel */ }
    chemin = path.join(dossierArticle, decode);
    if (decode === s || !fichierExiste(chemin)) { return { etat: 'introuvable' }; }
  }
  const uri = apercuMedia(chemin, budget);
  return uri ? { etat: 'ok', uri: uri } : { etat: 'indisponible' };
}

function fichierExiste(chemin) {
  try { return fs.statSync(chemin).isFile(); } catch (e) { return false; }
}

// Les aperçus de toutes les images d'un modèle : { src: { etat, uri } }.
function apercusImagesTable(dossierArticle, modele) {
  const budget = { reste: BUDGET_APERCUS_MEDIA };
  const res = {};
  for (const src of srcImagesModele(modele)) { res[src] = apercuImageTable(dossierArticle, src, budget); }
  return res;
}

// Copie `source` dans <article>/media/ sous un nom libre (suffixe -1, -2… par
// nomMediaUnique), puis la passe par `convertir(chemins)` si l'hôte la fournit : un JPEG
// CMJN ne s'affiche pas dans l'aperçu et sort mal au PDF.
// -> { src: 'media/<nom>', nom, chemin }.
//
// Le nom est assaini (minuscules, sans espace ni accent) : le Makefile liste media/ par
// $(wildcard …) et make coupe aux espaces, ce qui casserait la compilation.
// Lève si l'extension n'est pas une image reconnue, ou si la copie échoue.
async function copierImageDansArticle(dossierArticle, source, convertir) {
  const nomSur = nomImageAssaini(path.basename(String(source || '')));
  if (!nomSur) {
    const e = new Error('format'); e.code = 'format'; throw e;
  }
  const mediaDir = path.join(dossierArticle, 'media');
  try { fs.mkdirSync(mediaDir, { recursive: true }); } catch (e) { /* existe déjà */ }
  const nom = nomMediaUnique(mediaDir, nomSur);
  const chemin = path.join(mediaDir, nom);
  fs.copyFileSync(source, chemin);
  // La conversion réécrit le fichier sous le même nom.
  if (typeof convertir === 'function') {
    try { await convertir([chemin]); } catch (e) { /* signalé par l'hôte, le fichier reste lisible */ }
  }
  return { src: 'media/' + nom, nom: nom, chemin: chemin };
}

module.exports = {
  dossierArticleDeTable, apercuImageTable, apercusImagesTable, copierImageDansArticle
};
