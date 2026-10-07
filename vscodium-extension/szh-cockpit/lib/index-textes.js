// Index inverse des libellés du cockpit, pour le mode « Trad » : retrouve la clé i18n d'un
// texte lu à l'écran. Une webview ne reçoit que des chaînes, la clé est perdue en route.
//
// L'index est construit depuis la table de la langue courante (TEXTES_COCKPIT de
// lib/i18n.js). Trois cas :
//   - le texte est un libellé mot pour mot -> sa clé ;
//   - le libellé a des trous ({0}, {1}…) et l'écran montre le texte rempli (« Volume 44 »
//     pour « Volume {0} ») -> on reconnaît le motif ;
//   - plusieurs libellés ont le même texte (« Titre », « Annuler »…) -> plusieurs clés.
// Si rien ne correspond, la liste est vide et le formulaire s'ouvre sur le texte littéral.
//
// Un motif dont la part fixe est trop courte reconnaîtrait n'importe quoi (« {0} : {1} ») :
// sous MIN_FIXE caractères fixes, le libellé n'entre pas dans l'index.
//
// Module pur (ni fs, ni vscode, ni DOM) : la table entre, l'index sort.
'use strict';

// Nombre minimal de caractères fixes d'un motif (morceaux littéraux réunis, espaces et
// ponctuation compris).
const MIN_FIXE = 8;

// Trou de gabarit tel que T() le remplace : {0}, {1}…
const RE_TROU = /\{\d+\}/;
const RE_TROU_G = /\{\d+\}/g;

// Espaces qui varient entre la table et l'écran (insécable, insécable fine, espace fine,
// retours à la ligne du gabarit) : on les réduit à une espace avant de comparer.
const RE_ESPACES = /[\s   ]+/g;

function normaliser(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(RE_ESPACES, ' ').trim();
}

// Morceaux littéraux d'un gabarit, trous retirés : « Volume {0} de {1} » ->
// ['Volume ', ' de ', '']. Un morceau vide en bord dit qu'un trou touche ce bord.
function morceaux(valeur) {
  return normaliser(valeur).split(RE_TROU_G);
}

function longueurFixe(parts) {
  let n = 0;
  for (const p of parts) { n += p.length; }
  return n;
}

// Le texte affiché correspond-il au motif ? Chaque trou vaut au moins un caractère, sinon
// « Volume {0} » reconnaîtrait le libellé « Volume ».
function motifColle(parts, texte) {
  if (!parts || parts.length < 2) { return false; }
  const debut = parts[0];
  if (texte.slice(0, debut.length) !== debut) { return false; }
  let pos = debut.length;
  for (let i = 1; i < parts.length - 1; i++) {
    const j = texte.indexOf(parts[i], pos + 1);
    if (j === -1) { return false; }
    pos = j + parts[i].length;
  }
  const fin = parts[parts.length - 1];
  if (fin !== '' && texte.slice(texte.length - fin.length) !== fin) { return false; }
  return texte.length - fin.length > pos;
}

// Index d'une table { clé: texte } -> { exact, motifs } :
//   exact   { texte normalisé: [clés] }, sans prototype (un libellé « constructor » ne doit
//           pas rendre une fonction héritée) ;
//   motifs  [{ cle, parts, fixe }], du plus de fixe au moins de fixe.
// L'index passe tel quel dans un postMessage, qui ne sérialise ni RegExp ni Map : un motif
// garde donc ses morceaux, pas une expression.
function construireIndex(table) {
  const t = table && typeof table === 'object' ? table : {};
  const exact = Object.create(null);
  const motifs = [];
  for (const cle of Object.keys(t)) {
    const valeur = t[cle];
    if (typeof valeur !== 'string') { continue; }
    const texte = normaliser(valeur);
    if (texte === '') { continue; }
    if (RE_TROU.test(texte)) {
      const parts = morceaux(texte);
      const fixe = longueurFixe(parts);
      if (fixe < MIN_FIXE) { continue; }
      motifs.push({ cle: cle, parts: parts, fixe: fixe });
      continue;
    }
    if (!exact[texte]) { exact[texte] = []; }
    exact[texte].push(cle);
  }
  // Le motif le plus précis en tête ; à égalité, ordre des clés, pour un ordre stable.
  motifs.sort((a, b) => (b.fixe - a.fixe) || (a.cle < b.cle ? -1 : (a.cle > b.cle ? 1 : 0)));
  return { exact: exact, motifs: motifs };
}

// Clés candidates d'un texte lu à l'écran, de la plus sûre à la moins sûre ; liste vide si
// rien ne correspond. Une correspondance exacte l'emporte sur les motifs.
function trouverCles(index, texte) {
  const i = index && typeof index === 'object' ? index : {};
  const t = normaliser(texte);
  if (t === '') { return []; }
  const exact = i.exact || {};
  if (Object.prototype.hasOwnProperty.call(exact, t)) { return exact[t].slice(); }
  const sortie = [];
  for (const motif of (i.motifs || [])) {
    if (motifColle(motif.parts, t)) { sortie.push(motif.cle); }
  }
  return sortie;
}

module.exports = {
  MIN_FIXE, normaliser, morceaux, longueurFixe, motifColle,
  construireIndex, trouverCles
};
