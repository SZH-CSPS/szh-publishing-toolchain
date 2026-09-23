// Garde-fou anti-régression : une fixture de numéro/livre (hote-factice.js) ne doit JAMAIS
// poser son dossier directement dans os.tmpdir(). kirby-contenu.js#racineArbre ne reconnaît
// la racine de l'arbre (celle qui porte _NewsUndActu\, la bibliothèque partagée de fiches)
// qu'à la forme <racine>\Revue|Zeitschrift|Books\<numero> ; un numéro posé à plat s'y voit
// dégradé, et racineArbre() rend le PARENT du numéro -- ici os.tmpdir() lui-même. Toute la
// suite écrit alors sa bibliothèque _NewsUndActu dans le dossier temporaire commun à tout
// le poste ET à tous les tests : fuite entre tests, des milliers d'entrées au fil des
// exécutions (304 dossiers relevés sous _NewsUndActu\Fiches lors de l'audit qui a motivé
// ce fichier).
//
// Pourquoi pas un contrôle « %TEMP%\_NewsUndActu n'existe pas après la suite » : ce poste
// partage un seul dossier temporaire entre TOUTES les sessions concurrentes (voir la note
// « Agent concurrent dans le même arbre ») -- une autre session, sur du code non corrigé ou
// simplement en cours d'exécution en parallèle, peut légitimement écrire là pendant que ce
// fichier tourne. Un tel contrôle serait donc intrinsèquement instable ici. À la place, ce
// fichier éprouve directement le COMPORTEMENT qui a causé la fuite : que racineArbre() ne
// se rabatte jamais sur os.tmpdir() pour les fixtures partagées par la quarantaine de
// fichiers qui les emploient.
//
//   node --test test/js/fixtures-racine-jetable.test.js
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
