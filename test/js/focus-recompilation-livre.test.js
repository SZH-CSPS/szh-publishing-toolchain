// Lot G2, A1, sur un LIVRE : Robin est explicite — « revues ou livres » — donc le focus de
// l'arbre sur l'édition des métadonnées ou des médias doit marcher aussi pour un chapitre.
// Le reste (A3, la garde buildEnCours) est indifférent au profil et déjà éprouvé côté revue
// dans focus-recompilation.test.js ; activerHote() n'admet qu'un appel par processus, d'où
// ce fichier séparé (même convention que hote-livre.test.js).
//
//   node --test test/js/focus-recompilation-livre.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const { livreDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const tick = () => new Promise((r) => setImmediate(r));

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

// Un aperçu déjà composé, comme hote-livre.test.js ~L196-220 : sans lui, « l'aperçu est
// fermé » serait vrai par construction — aucun aperçu n'ayant jamais existé avant l'appel.
// Rend un témoin de fermeture : hote-factice.js ne retire pas un panneau fermé de sa liste
// (panneauDeType le retrouverait donc encore après coup, disposé ou pas), donc c'est
// dispose() lui-même qu'on observe, sur l'objet réellement rendu par createWebviewPanel.
async function ouvrirApercuChapitre(slug) {
  const dossierOut = path.join(LIVRE, 'out', 'chapitres');
  fs.mkdirSync(dossierOut, { recursive: true });
  const apercu = path.join(dossierOut, slug + '.apercu.html');
  fs.writeFileSync(apercu, '<html><body>chapitre déjà composé</body></html>');
  const futur = (Date.now() + 60000) / 1000;
  fs.utimesSync(apercu, futur, futur);
  await HOTE.executer('szh.ouvrirArticle', slug);
  const panneau = HOTE.panneauDeType('szhApercuHtml');
  assert.ok(panneau,
    'l’aperçu ne s’est pas ouvert avant le test : la fermeture qui suit ne prouverait rien');
  const etat = { ferme: false };
  const origDispose = panneau.dispose.bind(panneau);
  panneau.dispose = () => { etat.ferme = true; origDispose(); };
  return etat;
}

test('mise en route : le démarrage se tait', async () => {
  await demarrageSeTait(HOTE);
});

test('livre — A1 : « Métadonnées » d’un chapitre focalise l’arbre, aperçu fermé', async () => {
  const etatApercu = await ouvrirApercuChapitre('01-ouverture');

  const avant = HOTE.revelations.length;
  await HOTE.executer('szh.metadonneesArticle', { slug: '01-ouverture' });

  const revele = HOTE.revelations.slice(avant).pop();
  assert.ok(revele, 'aucun reveal() de l’arbre : le clic n’a pas focalisé le chapitre');
  assert.strictEqual(revele.element.slug, '01-ouverture');
  assert.deepStrictEqual(revele.options, { select: true, focus: false });

  assert.ok(HOTE.panneauDeType('szhApercuMetadonnees'),
    'le formulaire des métadonnées ne s’est pas ouvert sur un livre');
  assert.ok(etatApercu.ferme,
    'l’aperçu est resté ouvert : A1 doit le fermer, même sur un livre');
});

test('livre — A1 : « Médias » d’un chapitre focalise l’arbre, aperçu fermé', async () => {
  const etatApercu = await ouvrirApercuChapitre('02-suite');

  const avant = HOTE.revelations.length;
  await HOTE.executer('szh.mediasArticle', { slug: '02-suite' });

  const revele = HOTE.revelations.slice(avant).pop();
  assert.ok(revele, 'aucun reveal() de l’arbre : le clic n’a pas focalisé le chapitre');
  assert.strictEqual(revele.element.slug, '02-suite');
  assert.deepStrictEqual(revele.options, { select: true, focus: false });

  assert.ok(HOTE.panneauDeType('szhMedias'),
    'le formulaire des médias ne s’est pas ouvert sur un livre');
  assert.ok(etatApercu.ferme,
    'l’aperçu est resté ouvert : A1 doit le fermer, même sur un livre');
});
