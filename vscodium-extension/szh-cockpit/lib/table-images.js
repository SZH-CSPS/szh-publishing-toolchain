// Images des cellules de tableau, côté hôte : l'aperçu que la webview de l'éditeur de
// tableau affiche, et le fichier qu'« Insérer une image… » ou « Remplacer l'image… » copie
// dans le dossier media/ de l'article. La balise elle-même, son src et son texte
// alternatif, vivent dans le modèle (lib/table-model.js, opérations imageInserer,
// imageRemplacer, imageAlt) : ce module ne touche jamais au fichier du tableau.
//
// Le src d'une image de cellule est relatif au dossier de l'ARTICLE (media/…), comme
// l'écrit pipeline/docx-tables.py : szh-tabelle-inclure.lua réinjecte tables/table-NN.html
// dans l'article avec ce dossier pour répertoire courant, et WeasyPrint résout le src de
// là. Un src relatif à tables/ ne se trouverait pas au PDF.
'use strict';

const fs = require('fs');
const path = require('path');
const { apercuMedia, BUDGET_APERCUS_MEDIA, relatifImageValide, nomImageAssaini } = require('./medias');
const { nomMediaUnique } = require('./formatting-pur');
const { srcImagesModele } = require('./table-model');

// Le dossier de l'article d'un fichier de tableau : articles/<slug>/tables/table-NN.html
// -> articles/<slug>. Pris sur le chemin, pas sur un slug : l'éditeur peut s'ouvrir sans.
function dossierArticleDeTable(cheminTable) {
  return path.dirname(path.dirname(String(cheminTable || '')));
}

// src (tel qu'écrit dans la cellule) -> { etat, uri } :
//   'ok'           l'aperçu en data: — la webview n'a aucune racine locale autorisée
//                  (localResourceRoots: []), c'est la convention de tout le cockpit ;
//   'introuvable'  pas de fichier à cet endroit, ou un src qui sort de l'article (http:,
//                  chemin absolu, remontée « .. ») : rien que le PDF saurait trouver ;
//   'indisponible' le fichier existe, mais trop lourd pour un aperçu, au-delà du budget du
//                  message, ou d'un format que la webview n'affiche pas.
// `budget` = { reste: octets }, partagé entre toutes les images d'un même chargement.
function apercuImageTable(dossierArticle, src, budget) {
  const s = String(src || '');
  if (!relatifImageValide(s)) {
    // relatifImageValide refuse aussi une extension inconnue : un fichier qui existe
    // quand même n'est pas « introuvable », il est seulement sans aperçu.
    const sur = s !== '' && !/[:\\]/.test(s) && s[0] !== '/' && s.split('/').indexOf('..') === -1;
    if (sur && fichierExiste(path.join(dossierArticle, s))) { return { etat: 'indisponible' }; }
    return { etat: 'introuvable' };
  }
  // Un src encodé (« a%20b.png ») est celui que WeasyPrint décode : on essaie les deux.
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

// Copie `source` dans <article>/media/ sous un nom sûr et libre — suffixe -1, -2… si le nom
// est pris (nomMediaUnique, comme « Insérer une figure », lib/formatting.js) — puis passe le
// fichier par la conversion CMJN si l'hôte la fournit (`convertir(chemins)`, la même que
// fmtFigure : un JPEG CMJN ne s'affiche ni dans l'aperçu ni correctement au PDF).
// -> { src: 'media/<nom>', nom, chemin }.
//
// ⚠ Le nom est d'abord assaini (nomImageAssaini : minuscules, sans espace ni accent),
// contrairement à fmtFigure : le Makefile liste les fichiers de media/ par $(wildcard …)
// dans les prérequis du PDF, et make coupe aux espaces — « nouveau portrait.png » y devient
// deux fichiers inexistants, « No rule to make target », et plus rien ne compile (constaté
// le 29.09.2026 en compilant un article d'essai dans la WSL).
// Lève si l'extension n'est pas une image que la chaîne sait traiter, ou si la copie échoue.
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
  // Avant de rendre le src : la conversion réécrit le fichier sous le même nom.
  if (typeof convertir === 'function') {
    try { await convertir([chemin]); } catch (e) { /* signalé par l'hôte, le fichier reste lisible */ }
  }
  return { src: 'media/' + nom, nom: nom, chemin: chemin };
}

module.exports = {
  dossierArticleDeTable, apercuImageTable, apercusImagesTable, copierImageDansArticle
};
