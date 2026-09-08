// Les réglages protégés : ceux qui décrivent la CHAÎNE DE PUBLICATION et non le confort
// d'une personne — la configuration de l'export OJS et les titres de bibliographie.
//
// Pourquoi les protéger. Ces deux blocs ne valent pas pour un poste mais pour la maison
// entière : une rubrique OJS renommée sur un seul poste fait atterrir ses articles dans la
// mauvaise section de la revue, et un titre de bibliographie changé d'un côté fait paraître
// deux numéros de la même revue avec deux titres différents. Ils étaient pourtant offerts à
// la saisie libre dans « Réglages SZH », au milieu du thème et du zoom, sans que rien ne
// dise qu'on engageait tout le monde.
//
// D'où la règle : ces réglages se LISENT sur tous les postes, et ne se MODIFIENT qu'après un
// déverrouillage explicite, qui dit ce qu'il engage. Une modification vaut alors tout de
// suite sur ce poste — on doit pouvoir dépanner un export un jour de bouclage — mais elle
// est un brouillon : le fichier déployé la remplacera à la prochaine mise à jour. Le
// formulaire dit donc, en clair, quand le poste diverge, et offre de télécharger l'état
// courant pour l'envoyer à l'administrateur, qui le déploiera pour tout le monde.
//
// ---- Les deux fichiers, et pourquoi il y en a deux ----
//
//   settings-protected.json   déployé par la mise à jour, écrasé à chaque fois. C'est la
//                             version de l'administrateur, la référence.
//   config.json               ce que le poste emploie RÉELLEMENT, et le seul fichier que
//                             pipeline/filters/szh-citations.lua sache lire depuis la
//                             machine virtuelle. Le cockpit y recopie les réglages
//                             protégés — même relais que szh.desactiverLiensReferences.
//
// ⚠ C'est ce relais qui évite de toucher au pipeline : ni le filtre Lua ni lib/export-ojs.js
//   ne changent de source, ils lisent config.json comme avant. Une seconde source de vérité
//   pour eux aurait voulu dire un second lecteur JSON dans un filtre pandoc, et un second
//   chemin monté dans la machine virtuelle.
//
// Comparer le poste à la référence dit s'il diverge : c'est `divergences()`, et c'est de lui
// que sortent le bandeau du formulaire et la ligne du diagnostic.
'use strict';

const fs = require('fs');
const path = require('path');

// Mêmes chemins que lib/archivage.js et lib/i18n.js. La surcharge d'environnement suit la
// même règle que partout : une fonction, jamais une constante, pour voir une surcharge
// posée après le chargement du module — c'est ainsi que les tests travaillent sans jamais
// toucher au fichier du poste.
const BASE_POSTE = 'C:\\ProgramData\\SZH';
const NOM_FICHIER = 'settings-protected.json';

function cheminReglagesProteges() {
  return String(process.env.SZH_REGLAGES_PROTEGES || '').trim()
    || path.join(BASE_POSTE, NOM_FICHIER);
}

// Les deux blocs protégés, et rien d'autre. Nommés une fois ici : c'est cette liste qui
// décide de ce que le formulaire grise, de ce que le fichier déployé porte, et de ce que la
// comparaison regarde. En ajouter un troisième ne demande que de l'écrire ici.
const BLOCS = ['ojs', 'biblio'];

// Le contenu du fichier déployé, ou null — absent, illisible, ou pas un objet. null n'est
// pas {} : « je n'ai pas su lire » ne se confond pas avec « il n'y a rien dedans », et
// l'appelant ne doit pas écraser ce qu'il n'a pas su lire.
function lireReglagesProteges() {
  try {
    const brut = String(fs.readFileSync(cheminReglagesProteges(), 'utf8')).replace(/^\uFEFF/, '');
    const lu = JSON.parse(brut);
    return (lu && typeof lu === 'object' && !Array.isArray(lu)) ? lu : null;
  } catch (e) { return null; }
}

// Les seuls blocs retenus d'un objet quelconque : un fichier déployé qui porterait autre
// chose — une clé de config.json recopiée par erreur — ne doit pas se déverser dans la
// configuration du poste.
function blocsProteges(source) {
  const sortie = {};
  const src = (source && typeof source === 'object') ? source : {};
  for (const bloc of BLOCS) {
    if (src[bloc] !== undefined && src[bloc] !== null) { sortie[bloc] = src[bloc]; }
  }
  return sortie;
}

// Pose les blocs protégés sur une configuration de poste, sans toucher au reste du fichier
// (emplacement des revues, tâches, langue…). Pure, pour être éprouvable sans écrire dans
// C:\ProgramData ; c'est l'appelant qui appelle ecrireConfigPoste.
//
// ⚠ Seuls les blocs que la référence DÉFINIT sont posés ; un bloc qu'elle ne porte pas laisse
//   celui du poste intact. Ce n'est pas de la timidité : le fichier déployé part vide, et
//   effacer ce qu'il ne nomme pas emporterait, dès la première mise à jour, la configuration
//   OJS des postes qui en avaient déjà une. L'administrateur remplit le fichier bloc par
//   bloc, et chaque bloc rempli prend la main à partir de là.
function configAvecProteges(cfg, source) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  const blocs = blocsProteges(source);
  for (const bloc of Object.keys(blocs)) { sortie[bloc] = blocs[bloc]; }
  return sortie;
}

// Comparaison en profondeur, indépendante de l'ordre des clés — celui d'un objet JSON n'a
// pas de sens, et la table des rubriques OJS en porte des dizaines. Une comparaison
// textuelle aurait fait diverger un poste qui n'avait rien changé.
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

// -> les noms des blocs où le poste s'écarte de la version déployée. Vide = le poste est
// conforme, et c'est le cas de tous les postes tant que personne n'a déverrouillé.
//
// Une référence illisible ou absente ne rend AUCUNE divergence : sans référence il n'y a
// rien à comparer, et crier « modifié localement » sur un poste dont le fichier n'est pas
// encore déployé serait un mensonge.
// Un bloc que la référence ne définit pas n'est pas non plus comparé, pour la même raison
// qu'il n'est pas posé : elle n'a rien à en dire.
function divergences(configPoste, reference) {
  if (!reference || typeof reference !== 'object') { return []; }
  const ici = blocsProteges(configPoste);
  const la = blocsProteges(reference);
  return Object.keys(la).filter((bloc) => !memeValeur(ici[bloc], la[bloc]));
}

// Le contenu du fichier à télécharger : les blocs protégés tels que le poste les emploie,
// avec un en-tête qui dit à celui qui le recevra ce que c'est et ce qu'il en fait. JSON pur
// — le fichier est relu par ce module et déployé tel quel, il ne peut donc pas porter de
// commentaires. L'explication passe par une clé, `_lisezmoi`, que blocsProteges ignore.
function fichierATelecharger(configPoste, avertissement) {
  const contenu = { _lisezmoi: String(avertissement || '') };
  Object.assign(contenu, blocsProteges(configPoste));
  return JSON.stringify(contenu, null, 2) + '\n';
}

module.exports = {
  BLOCS, NOM_FICHIER, cheminReglagesProteges, lireReglagesProteges,
  blocsProteges, configAvecProteges, divergences, memeValeur, fichierATelecharger
};
