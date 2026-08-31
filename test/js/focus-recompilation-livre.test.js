// Lot G2, A1, sur un LIVRE : Robin est explicite — « revues ou livres » — donc le focus de
// l'arbre sur l'édition des métadonnées ou des médias doit marcher aussi pour un chapitre.
// Le reste (A3, la garde buildEnCours) est indifférent au profil et déjà éprouvé côté revue
// dans focus-recompilation.test.js ; activerHote() n'admet qu'un appel par processus, d'où
// ce fichier séparé (même convention que hote-livre.test.js).
//
//   node --test test/js/focus-recompilation-livre.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { livreDEssai, activerHote } = require('./hote-factice');

const tick = () => new Promise((r) => setImmediate(r));

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

test('mise en route : le démarrage se tait', async () => {
  for (let i = 0; i < 30; i++) { await tick(); }
  HOTE.erreurs.length = 0;
  HOTE.avertissements.length = 0;
});

test('livre — A1 : « Métadonnées » d’un chapitre focalise l’arbre, aperçu fermé', async () => {
  const avant = HOTE.revelations.length;
  await HOTE.executer('szh.metadonneesArticle', { slug: '01-ouverture' });

  const revele = HOTE.revelations.slice(avant).pop();
  assert.ok(revele, 'aucun reveal() de l’arbre : le clic n’a pas focalisé le chapitre');
  assert.strictEqual(revele.element.slug, '01-ouverture');
  assert.deepStrictEqual(revele.options, { select: true, focus: false });

  assert.ok(HOTE.panneauDeType('szhApercuMetadonnees'),
    'le formulaire des métadonnées ne s’est pas ouvert sur un livre');
  assert.ok(!HOTE.panneauDeType('szhApercuHtml'),
    'l’aperçu est resté ouvert : A1 doit le fermer, même sur un livre');
});

test('livre — A1 : « Médias » d’un chapitre focalise l’arbre, aperçu fermé', async () => {
  const avant = HOTE.revelations.length;
  await HOTE.executer('szh.mediasArticle', { slug: '02-suite' });

  const revele = HOTE.revelations.slice(avant).pop();
  assert.ok(revele, 'aucun reveal() de l’arbre : le clic n’a pas focalisé le chapitre');
  assert.strictEqual(revele.element.slug, '02-suite');
  assert.deepStrictEqual(revele.options, { select: true, focus: false });

  assert.ok(HOTE.panneauDeType('szhMedias'),
    'le formulaire des médias ne s’est pas ouvert sur un livre');
  assert.ok(!HOTE.panneauDeType('szhApercuHtml'),
    'l’aperçu est resté ouvert : A1 doit le fermer, même sur un livre');
});
