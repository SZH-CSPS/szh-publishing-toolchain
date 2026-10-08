// A1 sur un livre : le focus de l'arbre sur l'édition des métadonnées ou des médias vaut
// aussi pour un chapitre. A3 ne dépend pas du profil et se teste côté revue
// (focus-recompilation.test.js). activerHote() n'admet qu'un appel par processus, d'où ce
// fichier séparé.
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert');

const { livreDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const tick = () => new Promise((r) => setImmediate(r));

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

// Un aperçu déjà ouvert : sans lui, « l'aperçu est fermé » serait vrai d'avance.
// L'aperçu d'un chapitre est son PDF (out/chapitres/<slug>.pdf), ouvert dans un onglet :
// on observe la fermeture de cet onglet (tabGroups.close).
async function ouvrirApercuChapitre(slug) {
  const dossierOut = path.join(LIVRE, 'out', 'chapitres');
  fs.mkdirSync(dossierOut, { recursive: true });
  const pdf = path.join(dossierOut, slug + '.pdf');
  fs.writeFileSync(pdf, '%PDF-1.7\n');
  const futur = (Date.now() + 60000) / 1000;
  fs.utimesSync(pdf, futur, futur);
  await HOTE.executer('szh.ouvrirArticle', slug);
  assert.ok(HOTE.ouvertures().some((o) => String(o).toLowerCase() === pdf.toLowerCase()),
    'l’aperçu ne s’est pas ouvert avant le test : la fermeture qui suit ne prouverait rien');
  HOTE.poserOnglets([{ uri: { fsPath: pdf } }]);
  HOTE.oublierFermetures();
  return { get ferme() { return HOTE.fermetures().length >= 1; } };
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
