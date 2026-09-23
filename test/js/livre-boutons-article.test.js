// Les boutons d'item « Envoyer aux autrices/auteurs » (szh.envoyerAuteur) et « Voir le PDF »
// (szh.voirPdfArticle) : sans objet sur un chapitre de livre — pas d'auteur·e à qui envoyer
// une version finale hors d'un circuit OJS, pas de PDF PAR CHAPITRE (lib/profil.js : le PDF
// d'un livre est celui de l'ouvrage entier, voir chemins().pdf). Leur bouton dans l'arbre
// (view/item/context) réutilise `viewItem == article`, le même contextValue qu'un chapitre
// (extension.js, contextValue = 'article' posé pour les deux profils) : sans le garde-fou,
// les deux boutons apparaîtraient donc aussi sur un chapitre.
//
//   node --test test/js/livre-boutons-article.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

test('package.json : les deux boutons d’item portent && !szh.estLivre dans leur when', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const items = pkg.contributes.menus['view/item/context'];
  for (const id of ['szh.voirPdfArticle', 'szh.envoyerAuteur']) {
    const e = items.find((x) => x.command === id);
    assert.ok(e, id + ' absente de view/item/context');
    assert.match(e.when, /viewItem == article/, id + ' : ne vise plus l’item article');
    assert.match(e.when, /&&\s*!szh\.estLivre\b/, id + ' : when incorrect (' + e.when + ')');
  }
});

test('package.json : commandPalette n’offre plus envoyerAuteur que pour une revue', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const palette = pkg.contributes.menus.commandPalette;
  const e = palette.find((x) => x.command === 'szh.envoyerAuteur');
  assert.ok(e, 'szh.envoyerAuteur absente de commandPalette');
  // (szh.estRevue || szh.estLivre) && !szh.estLivre se réduit à szh.estRevue, les deux
  // profils s'excluant (lib/profil.js, contextes()) : c'est la forme la plus simple qui
  // dit la même chose, cohérente avec le reste de commandPalette (szh.vueArticles,
  // szh.vueTraductions…).
  assert.strictEqual(e.when, 'szh.estRevue', 'szh.envoyerAuteur : when incorrect (' + e.when + ')');
});

test('package.json : szh.voirPdfArticle n’a pas d’entrée commandPalette à corriger', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const palette = pkg.contributes.menus.commandPalette;
  assert.strictEqual(palette.find((x) => x.command === 'szh.voirPdfArticle'), undefined,
    'szh.voirPdfArticle est apparue dans commandPalette : lui poser le même garde-fou');
});
