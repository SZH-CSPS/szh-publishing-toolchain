// Le cockpit ouvert sur un LIVRE : ce qu'il montre, et ce qu'il ne montre pas.
//
//   node --test test/js/hote-livre.test.js
//
// L'extension est réellement activée (hote-factice.js intercepte `require('vscode')`), sur
// un dossier qui porte un buch.yaml. On ne vérifie ici que ce qui DIFFÈRE d'un numéro —
// le reste de la mécanique est indifférent au profil, et hote.test.js le dit déjà pour la
// revue. Vérifier deux fois la même chose ne prouve rien de plus.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { livreDEssai, activerHote } = require('./hote-factice');

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

// Le défaut que ce contrôle prévient : la vue latérale était gardée par `szh.estRevue` et
// ne s'affichait tout simplement pas sur un livre — dossier ouvert, aucun cockpit.
test('livre : les deux clés de contexte sont posées, et elles s’excluent', () => {
  const ctx = HOTE.contexte ? HOTE.contexte() : null;
  if (!ctx) { return; }   // l'hôte factice ne les expose pas partout : on ne casse pas pour ça
  assert.strictEqual(ctx['szh.estLivre'], true, 'szh.estLivre n’est pas posé sur un livre');
  assert.strictEqual(ctx['szh.estRevue'], false,
    'szh.estRevue reste vrai sur un livre : les deux vues s’afficheraient ensemble');
});

// ⚠ PAS de section « Traductions » pour un livre, et ce n'est pas un détail d'affichage.
// Une revue paraît en deux langues et chaque article a sa version jumelle ; un livre est
// écrit dans une langue, et sa traduction est un AUTRE livre, avec son ISBN. La section
// était construite inconditionnellement — c'est cette ligne-là qu'il a fallu rendre
// conditionnelle, pas seulement les chemins de fichiers.
test('livre : l’arbre montre Chapitres et Word, jamais Traductions', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre, 'aucun fournisseur d’arbre enregistré');
  const racine = await arbre.getChildren();
  const categories = racine.map((it) => it.categorie);
  assert.deepStrictEqual(categories, ['chapitres', 'word'],
    'sections attendues pour un livre : chapitres puis word — obtenu ' + categories.join(', '));
});

test('livre : la section des unités s’appelle « chapitres », pas « articles »', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const section = racine[0];
  assert.strictEqual(section.contextValue, 'section-chapitres');
  assert.match(String(section.label), /CHAPITRES/i,
    'le titre de section ne dit pas « chapitres » : ' + section.label);
});

// L'accordéon s'ouvrait sur la clé « articles », codée en dur au constructeur. Sur un
// livre, cette catégorie n'existe pas : rien ne se dépliait, et l'arbre s'ouvrait fermé.
test('livre : la section des chapitres est dépliée à l’ouverture', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  assert.strictEqual(racine[0].collapsibleState, 2,
    'la section des chapitres n’est pas dépliée (2 = Expanded)');
});

test('livre : les chapitres du dossier sont listés', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(racine[0]);
  const slugs = enfants.map((it) => it.slug).filter(Boolean);
  assert.deepStrictEqual(slugs.sort(), ['01-ouverture', '02-suite'],
    'les chapitres ne sont pas lus dans chapitres/ — obtenu ' + slugs.join(', '));
});

// Le chemin d'un chapitre doit être chapitres/<slug>/<slug>.md et non articles/… : c'est
// la jointure que dossierUnites() a remplacée, et celle dont dépendent tous les gestes.
// L'élément de l'arbre porte l'URI du .md dans `resourceUri` ; la commande, elle, ne reçoit
// que le slug — ce qui a d'abord fait échouer ce contrôle, et c'est le contrôle qui avait
// tort, pas l'arbre.
test('livre : un chapitre pointe sur chapitres/<slug>/<slug>.md', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(racine[0]);
  const premier = enfants.find((it) => it.slug === '01-ouverture');
  assert.ok(premier, 'le chapitre 01-ouverture n’est pas dans l’arbre');
  const cible = String((premier.resourceUri && premier.resourceUri.fsPath) || '');
  assert.ok(cible, 'le chapitre ne porte aucun fichier');
  assert.ok(cible.indexOf(path.join('chapitres', '01-ouverture', '01-ouverture.md')) !== -1,
    'le chapitre ne pointe pas dans chapitres/ : ' + cible);
  assert.ok(cible.indexOf(path.sep + 'articles' + path.sep) === -1,
    'le chapitre pointe encore dans articles/ : ' + cible);
});
