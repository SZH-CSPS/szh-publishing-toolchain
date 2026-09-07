// lib/formatting-pur.js : la part de lib/formatting.js qui ne référence pas `vscode`,
// extraite pour que lib/medias.js et lib/panneaux.js puissent la réutiliser sans tirer
// tout l'hôte avec elle. Ce fichier ne charge JAMAIS lib/formatting.js par la voie
// vscode-factice : le module doit se charger tel quel, hors de l'éditeur.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

test('formatting-pur.js se charge sans require("vscode")', () => {
  // Un require('vscode') qui échouerait ferait tomber ce require tout entier : le simple
  // fait d'arriver ici, sans faux vscode posé par un harnais, prouve la pureté du module.
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'formatting-pur.js'))];
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  assert.ok(typeof pur.basculerEnrobage === 'function');
  assert.ok(typeof pur.poserBloc === 'function');
  assert.ok(typeof pur.nomMediaUnique === 'function');
  assert.ok(Array.isArray(pur.PALETTE_MEF) && pur.PALETTE_MEF.length > 0);
});

test('formatting.js réexporte les mêmes fonctions que formatting-pur.js (identité)', () => {
  const { chargerAvecVscodeFactice } = require('./dom-minimal');
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  const fmt = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'formatting.js'));
  // nomMediaUnique n'est pas de ceux-là : formatting.js ne l'a jamais exporté, seul
  // fmtFigure l'appelle en interne — pas un contrat de réexport à garder.
  for (const nom of ['basculerEnrobage', 'basculerSouligne', 'basculerTitre', 'basculerCitation',
    'enroberBloc', 'poserBloc', 'blocAutour', 'squeletteTableau', 'tableauVierge',
    'blocReferenceTable', 'blocSautPage', 'nomTableLibre', 'PALETTE_MEF',
    'CLASSES_BLOCS']) {
    assert.strictEqual(fmt[nom], pur[nom], nom + ' n’est pas la même référence des deux côtés');
  }
});

test('attrBloc échappe l’antislash avant le guillemet (comme citerValeur de references.js)', () => {
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  assert.strictEqual(pur.attrBloc('important', 'Dire "non"'),
    '{.important data-titre="Dire \\"non\\""}');
  // Le cas qui distingue échapper de retirer : un antislash suivi d'un guillemet doit
  // rester lisible sans avaler le guillemet fermant de l'attribut.
  assert.strictEqual(pur.attrBloc('important', 'chemin\\ "cité"'),
    '{.important data-titre="chemin\\\\ \\"cité\\""}');
  assert.strictEqual(pur.attrBloc('important', ''), '{.important}');
});

// Les trois boucles while (fs.existsSync(...)) qui cherchent un nom libre reçoivent une
// borne : sans elle, un dossier pathologique (ou un appelant qui boucle par erreur) tourne
// pour toujours au lieu d'échouer proprement.
test('nomMediaUnique (formatting-pur) refuse de boucler sans fin : borne à 1000, erreur claire', () => {
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nom-media-'));
  fs.writeFileSync(path.join(dossier, 'a.png'), '');
  for (let i = 1; i <= 1000; i++) { fs.writeFileSync(path.join(dossier, 'a-' + i + '.png'), ''); }
  assert.throws(() => pur.nomMediaUnique(dossier, 'a.png'), /1000/,
    'aucune erreur au-delà de 1000 essais : la boucle n’est pas bornée');
});

test('medias.js (nomMediaLibre) est désormais nomMediaUnique de formatting-pur, même borne', () => {
  const medias = require(path.join(COCKPIT, 'lib', 'medias.js'));
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  assert.strictEqual(medias.nomMediaLibre, pur.nomMediaUnique,
    'medias.js garde une copie au lieu de réutiliser formatting-pur.js');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nom-media-2-'));
  fs.writeFileSync(path.join(dossier, 'a.png'), '');
  for (let i = 1; i <= 1000; i++) { fs.writeFileSync(path.join(dossier, 'a-' + i + '.png'), ''); }
  assert.throws(() => medias.nomMediaLibre(dossier, 'a.png'), /1000/);
});

test('reserve.js (nomLibre) reçoit la même borne, à 1000 essais', () => {
  const reserve = require(path.join(COCKPIT, 'lib', 'reserve.js'));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nom-reserve-'));
  fs.writeFileSync(path.join(dossier, 'a.jpg'), '');
  for (let i = 1; i <= 1000; i++) { fs.writeFileSync(path.join(dossier, 'a-' + i + '.jpg'), ''); }
  assert.throws(() => reserve.nomLibre(dossier, 'a.jpg'), /1000/,
    'aucune erreur au-delà de 1000 essais : la boucle n’est pas bornée');
});

test('panneaux.js importe PALETTE_MEF de formatting-pur.js, pas de formatting.js', () => {
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'panneaux.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/formatting-pur['"]\)/,
    'panneaux.js ne charge plus formatting-pur.js pour sa palette');
});
