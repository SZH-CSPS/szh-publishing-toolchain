// Retrouver dans un .md le passage que désigne le `focus` d'un constat (lib/constats.js).
// Fonction pure : ni `vscode`, ni `fs` — lue par l'extension (surlignage du bouton « Vers
// l'article ») et par les tests, comme lib/formatting-pur.js et lib/codes-erreur.js.
//
// Le piège : `focus` vient d'un constat de citations, et pipeline/filters/szh-citations.lua
// l'a fait passer par sa fonction normaliser() avant de l'écrire — espaces insécables et
// fines ramenées à l'espace simple, tirets demi-cadratin/cadratin/insécable ramenés au trait
// d'union, suites d'espaces écrasées. Le .md sur le disque, lui, porte les caractères
// d'origine. Une recherche littérale de `focus` dans le texte réel échoue donc souvent.
//
// La parade : normaliser aussi le texte du document, de la même façon, mais en gardant pour
// chaque caractère normalisé la plage de caractères RÉELS qui l'a produit — une suite
// d'espaces écrasée pointe sur toute la suite, pas seulement sur le survivant. La recherche
// se fait alors sur les deux formes normalisées, et le résultat se retraduit en offsets
// réels pour poser un Range dans le document tel qu'il est sur le disque.
//
// ⚠ Recopié à la main depuis assainir()/normaliser() du filtre Lua (mêmes six caractères,
// même ordre) : pas d'import croisé JS/Lua possible. Si le filtre change ses substitutions,
// celles d'ici doivent suivre.
'use strict';

// Les six substitutions d'assainir() (szh-citations.lua) : un caractère pour un caractère,
// jamais une longueur qui change — la correspondance réel/normalisé reste 1 pour 1 ici.
const SUBSTITUTIONS = Object.freeze({
  ' ': ' ',   // espace insécable
  ' ': ' ',   // espace fine insécable
  ' ': ' ',   // espace fine
  '–': '-',   // tiret demi-cadratin (en dash)
  '—': '-',   // tiret cadratin (em dash)
  '‑': '-'    // trait d'union insécable
});

// %s du filtre Lua : espace, tabulation, saut de ligne, retour chariot, sauts de page.
function estBlanc(c) { return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v'; }

function substitue(c) { return Object.prototype.hasOwnProperty.call(SUBSTITUTIONS, c) ? SUBSTITUTIONS[c] : c; }

// -> { normalise, correspondance } où correspondance[i] = { debut, fin } sont les offsets,
// dans `texte`, du ou des caractères réels qui ont produit le caractère normalisé n°i.
// Pas de trim ici : une recherche de sous-chaîne n'en a pas besoin, seuls les bords du
// texte entier seraient concernés, jamais ceux d'un passage au milieu.
function normaliserAvecCorrespondance(texte) {
  const t = String(texte === undefined || texte === null ? '' : texte);
  let normalise = '';
  const correspondance = [];
  let i = 0;
  while (i < t.length) {
    const c = substitue(t[i]);
    if (estBlanc(c)) {
      const debut = i;
      i++;
      while (i < t.length && estBlanc(substitue(t[i]))) { i++; }
      normalise += ' ';
      correspondance.push({ debut: debut, fin: i });
    } else {
      normalise += c;
      correspondance.push({ debut: i, fin: i + 1 });
      i++;
    }
  }
  return { normalise: normalise, correspondance: correspondance };
}

// Le passage que désigne `focus` dans `texteDocument`, ou null s'il est absent.
// -> { debut, fin } offsets réels (comme String.slice) dans `texteDocument`, ou null.
// Deux occurrences : la première gagne — indexOf() le fait déjà.
function trouverPlageFocus(texteDocument, focus) {
  const brut = String(focus === undefined || focus === null ? '' : focus).trim();
  if (brut === '') { return null; }
  const aiguille = normaliserAvecCorrespondance(brut).normalise.trim();
  if (aiguille === '') { return null; }
  const { normalise, correspondance } = normaliserAvecCorrespondance(texteDocument);
  const idx = normalise.indexOf(aiguille);
  if (idx === -1) { return null; }
  return { debut: correspondance[idx].debut, fin: correspondance[idx + aiguille.length - 1].fin };
}

module.exports = { trouverPlageFocus, normaliserAvecCorrespondance };
