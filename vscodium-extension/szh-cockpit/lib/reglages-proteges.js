// Les réglages protégés : ceux qui décrivent la chaîne de publication et valent pour toute
// la rédaction (configuration de l'export OJS, titres de bibliographie, tâches éditoriales
// par article). Une rubrique OJS ou un titre de bibliographie différent d'un poste à
// l'autre donnerait des numéros incohérents ; des tâches différentes, des cases cochées
// que l'autre poste ne voit pas.
//
// Ils se lisent sur tous les postes et ne se modifient qu'après déverrouillage. Une
// modification vaut tout de suite sur ce poste (pour dépanner un jour de bouclage), puis
// le fichier déployé la remplace à la mise à jour suivante. Le formulaire signale quand le
// poste diverge et permet de télécharger l'état courant pour l'administrateur.
//
// ---- Les deux fichiers ----
//
//   settings-protected.json   déployé par la mise à jour, écrasé à chaque fois. C'est la
//                             version de l'administrateur, la référence.
//   config.json               ce que le poste emploie, et le seul fichier que
//                             pipeline/filters/szh-citations.lua lit depuis la WSL. Le
//                             cockpit y recopie les réglages protégés ; le filtre Lua et
//                             lib/export-ojs.js n'ont ainsi qu'une source.
//
// `divergences()` compare le poste à la référence ; le bandeau du formulaire et la ligne
// du diagnostic en dépendent.
'use strict';

const fs = require('fs');
const path = require('path');
const { basePoste } = require('./poste');

// Mêmes chemins que lib/archivage.js et lib/i18n.js. Une fonction plutôt qu'une constante,
// pour voir une variable d'environnement posée après le chargement (les tests le font).
const BASE_POSTE = basePoste();
const NOM_FICHIER = 'settings-protected.json';

function cheminReglagesProteges() {
  return String(process.env.SZH_REGLAGES_PROTEGES || '').trim()
    || path.join(BASE_POSTE, NOM_FICHIER);
}

// Les blocs protégés. Cette liste décide de ce que le formulaire désactive, de ce que porte
// le fichier déployé et de ce que la comparaison regarde. Ce sont les clés de config.json
// telles quelles : « ojs », « biblio », « tachesArticle » (CLE_TACHES, lib/articles.js).
const BLOCS = ['ojs', 'biblio', 'tachesArticle'];

// Le contenu du fichier déployé, ou null s'il est absent, illisible ou n'est pas un objet.
// null se distingue de {} : l'appelant n'écrase pas ce qu'il n'a pas su lire.
function lireReglagesProteges() {
  try {
    const brut = String(fs.readFileSync(cheminReglagesProteges(), 'utf8')).replace(/^\uFEFF/, '');
    const lu = JSON.parse(brut);
    return (lu && typeof lu === 'object' && !Array.isArray(lu)) ? lu : null;
  } catch (e) { return null; }
}

// Ne garde que les blocs protégés d'un objet : une autre clé du fichier déployé n'entre
// pas dans la configuration du poste.
function blocsProteges(source) {
  const sortie = {};
  const src = (source && typeof source === 'object') ? source : {};
  for (const bloc of BLOCS) {
    if (src[bloc] !== undefined && src[bloc] !== null) { sortie[bloc] = src[bloc]; }
  }
  return sortie;
}

// Pose les blocs protégés sur une configuration de poste, sans toucher au reste du fichier
// (emplacement des revues, langue…). L'appelant écrit (ecrireConfigPoste).
//
// Seuls les blocs que la référence définit sont posés ; les autres restent ceux du poste.
// Le fichier déployé peut être incomplet : l'administrateur le remplit bloc par bloc.
function configAvecProteges(cfg, source) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  const blocs = blocsProteges(source);
  for (const bloc of Object.keys(blocs)) { sortie[bloc] = blocs[bloc]; }
  return sortie;
}

// Comparaison en profondeur, indépendante de l'ordre des clés.
function memeValeur(a, b) {
  if (a === b) { return true; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { return false; }
  if (Array.isArray(a) !== Array.isArray(b)) { return false; }
  if (Array.isArray(a)) { return a.length === b.length && a.every((v, i) => memeValeur(v, b[i])); }
  const ca = Object.keys(a).sort();
  const cb = Object.keys(b).sort();
  if (ca.length !== cb.length || ca.some((c, i) => c !== cb[i])) { return false; }
  return ca.every((c) => memeValeur(a[c], b[c]));
}

// -> les noms des blocs où le poste s'écarte de la version déployée ; vide si conforme.
// Une référence illisible ou absente ne donne aucune divergence, et un bloc qu'elle ne
// définit pas n'est pas comparé.
function divergences(configPoste, reference) {
  if (!reference || typeof reference !== 'object') { return []; }
  const ici = blocsProteges(configPoste);
  const la = blocsProteges(reference);
  return Object.keys(la).filter((bloc) => !memeValeur(ici[bloc], la[bloc]));
}

// Le contenu du fichier à télécharger : les blocs protégés du poste, plus une clé
// `_lisezmoi` qui explique au destinataire quoi en faire (le fichier est du JSON pur, sans
// commentaires ; blocsProteges ignore cette clé).
function fichierATelecharger(configPoste, avertissement) {
  const contenu = { _lisezmoi: String(avertissement || '') };
  Object.assign(contenu, blocsProteges(configPoste));
  return JSON.stringify(contenu, null, 2) + '\n';
}

module.exports = {
  BLOCS, NOM_FICHIER, cheminReglagesProteges, lireReglagesProteges,
  blocsProteges, configAvecProteges, divergences, memeValeur, fichierATelecharger
};
