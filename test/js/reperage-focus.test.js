// lib/reperage-focus.js : retrouver dans un .md le passage qu'un constat désigne par son
// `focus`, malgré la normalisation que pipeline/filters/szh-citations.lua lui a fait subir
// avant de l'écrire (espaces insécables/fines, tirets longs, espaces multiples).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { trouverPlageFocus } = require(path.join(COCKPIT, 'lib', 'reperage-focus.js'));

// Relit la plage trouvée pour comparer une chaîne, pas des offsets — plus lisible à l'échec.
function extrait(texte, focus) {
  const plage = trouverPlageFocus(texte, focus);
  return plage ? texte.slice(plage.debut, plage.fin) : null;
}

test('trouverPlageFocus : appel présent tel quel', () => {
  const doc = 'Comme le montre (Shaw et al., 2023), le constat est clair.';
  assert.strictEqual(extrait(doc, '(Shaw et al., 2023)'), '(Shaw et al., 2023)');
});

test('trouverPlageFocus : espace insécable dans le .md, espace simple dans le focus', () => {
  //   entre « al., » et « 2023) » — ce que Word/pandoc laissent, jamais un simple espace.
  const doc = 'Comme le montre (Shaw et al., 2023), le constat est clair.';
  assert.strictEqual(extrait(doc, '(Shaw et al., 2023)'), '(Shaw et al., 2023)');
});

test('trouverPlageFocus : tiret demi-cadratin dans le .md, trait d’union dans le focus', () => {
  const doc = 'Voir la page 12–14 pour le détail.';
  assert.strictEqual(extrait(doc, '12-14'), '12–14');
});

test('trouverPlageFocus : tiret cadratin et trait d’union insécable, même règle', () => {
  assert.strictEqual(extrait('Un tiret — cadratin ici.', 'tiret - cadratin'), 'tiret — cadratin');
  assert.strictEqual(extrait('Un trait‑d’union insécable.', 'trait-d’union'), 'trait‑d’union');
});

test('trouverPlageFocus : espaces multiples dans le .md, un seul dans le focus', () => {
  const doc = 'Comme le montre (Shaw   et al.,  2023), le constat est clair.';
  assert.strictEqual(extrait(doc, '(Shaw et al., 2023)'), '(Shaw   et al.,  2023)');
});

test('trouverPlageFocus : appel absent — rien, jamais une erreur', () => {
  const doc = 'Ce texte ne cite personne.';
  assert.strictEqual(trouverPlageFocus(doc, '(Shaw et al., 2023)'), null);
});

test('trouverPlageFocus : deux occurrences — la première gagne', () => {
  const doc = 'Premier renvoi (Shaw et al., 2023) puis un second (Shaw et al., 2023) plus loin.';
  const plage = trouverPlageFocus(doc, '(Shaw et al., 2023)');
  assert.strictEqual(plage.debut, doc.indexOf('(Shaw et al., 2023)'));
  assert.notStrictEqual(plage.debut, doc.lastIndexOf('(Shaw et al., 2023)'));
});

test('trouverPlageFocus : focus vide ou document vide — rien', () => {
  assert.strictEqual(trouverPlageFocus('un texte quelconque', ''), null);
  assert.strictEqual(trouverPlageFocus('', '(Shaw et al., 2023)'), null);
  assert.strictEqual(trouverPlageFocus('', ''), null);
});

test('trouverPlageFocus : combinaison insécable + tiret + espaces multiples', () => {
  const doc = 'Renvoi  (Shaw et al., 2023, –p. 12) ici.';
  const plage = trouverPlageFocus(doc, '(Shaw et al., 2023, -p. 12)');
  assert.notStrictEqual(plage, null);
  assert.strictEqual(doc.slice(plage.debut, plage.fin), '(Shaw et al., 2023, –p. 12)');
});
