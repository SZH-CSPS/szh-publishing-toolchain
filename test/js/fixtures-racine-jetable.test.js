// Les fixtures de numéro et de livre (hote-factice.js) ne posent pas leur dossier
// directement dans os.tmpdir(). kirby-contenu.js#racineArbre ne reconnaît la racine de
// l'arbre (celle qui porte _NewsUndActu\) qu'à la forme <racine>\Revue|Zeitschrift|Books\
// <numero> ; pour un numéro posé à plat, elle rend le parent du numéro, ici os.tmpdir(), et
// les tests écriraient leur bibliothèque _NewsUndActu dans le dossier temporaire commun.
//
// Le test vérifie racineArbre() sur les fixtures plutôt que l'absence de
// %TEMP%\_NewsUndActu après la suite : d'autres sessions qui tournent en parallèle peuvent
// écrire dans ce dossier temporaire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const { revueDEssai, livreDEssai } = require('./hote-factice');

const TMP_RESOLU = path.resolve(os.tmpdir());

test('revueDEssai() : racineArbre() ne retombe jamais sur os.tmpdir()', () => {
  const revue = revueDEssai();
  const racineArbreVal = path.resolve(kirby.racineArbre(revue));
  assert.notStrictEqual(racineArbreVal, TMP_RESOLU,
    'racineArbre(revueDEssai()) rend os.tmpdir() : la bibliothèque _NewsUndActu s’écrirait ' +
    'dans le dossier temporaire partagé par tout le poste et tous les tests, au lieu de la ' +
    'racine jetable propre au test');
  assert.strictEqual(path.basename(path.dirname(revue)).toLowerCase(), 'revue',
    'le numéro rendu par revueDEssai() n’est plus rangé sous un dossier « Revue » : ' +
    'racineArbre() ne le reconnaîtrait plus');
});

test('livreDEssai() : racineArbre() ne retombe jamais sur os.tmpdir()', () => {
  const livre = livreDEssai();
  const racineArbreVal = path.resolve(kirby.racineArbre(livre));
  assert.notStrictEqual(racineArbreVal, TMP_RESOLU,
    'racineArbre(livreDEssai()) rend os.tmpdir() : la bibliothèque _NewsUndActu s’écrirait ' +
    'dans le dossier temporaire partagé par tout le poste et tous les tests, au lieu de la ' +
    'racine jetable propre au test');
  assert.strictEqual(path.basename(path.dirname(livre)).toLowerCase(), 'books',
    'le livre rendu par livreDEssai() n’est plus rangé sous un dossier « Books » : ' +
    'racineArbre() ne le reconnaîtrait plus');
});
