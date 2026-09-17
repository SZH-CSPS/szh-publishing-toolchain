// Smoke test S3 : la webview des réglages restaure le bon bouton radio depuis les valeurs
// que l'hôte envoie.
//
//   node --test test/js/smoke-settings.test.js
//
// Pourquoi : c'est le trou de harnais nommé par la revue de l'infrastructure de test —
// media/settings.js#cocher() lit `document.querySelector('input[name="…"][value="…"]')`
// AU NIVEAU RACINE du document, et avant le lot 0, dom-minimal.js y rendait toujours
// `null` (seul `chercher(document.body, …)` marchait) : ce chemin échouait donc en
// silence sous ce harnais, sans qu'aucun test ne l'ait jamais vu. Le lot 0 a fait suivre
// `document.querySelector`/`querySelectorAll` (au niveau du document que ouvrir() rend)
// jusqu'à `chercher()`, qui cherche maintenant sous <body> ET sous chaque conteneur pris
// par getElementById — voir dom-minimal.js, `document.querySelector`.
//
// cocher() cible ses éléments par `document.querySelector` avec des attributs HTML
// ordinaires (`input[name="…"][value="…"]`, jamais du `data-*`) : c'est ce qui a demandé
// au harnais partagé (dom-minimal.js, `correspond`/`correspondAttribut`) de reconnaître ce
// genre de sélecteur, attribut posé par setAttribute puis, à défaut, propriété de même nom
// (rendre() pose `radio.name = …`/`radio.value = …`, jamais setAttribute).
//
// Suit le même patron que test/js/webviews.test.js (ouvrir/envoyer, txt tiré du libellé
// réel de l'hôte via libellesHote) et la même construction de page que htmlReglages()
// (extension.js) : page 'settings', cssPartage ['_design.css'], jsPartage ['_messages.js'].
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');

// Un radio par groupe, tel que media/settings.js#GROUPES les nomme (`name` = la clé du
// groupe, `value` = la valeur de l'option) — la même forme que le message { type: 'valeurs',
// valeurs: {...} } qu'ouvrirReglages() (extension.js) envoie pour de vrai, réduite aux
// groupes qui suffisent au contrôle : plusieurs clés, pour prouver que cocher() ne
// s'arrête pas à la première.
const VALEURS_ENVOYEES = {
  theme: 'sombre', zoom: '1', policeMd: '16', apercu: 'pdf', assets: 'oui', cmyk: 'non',
  warnings: 'reduits', liensReferences: 'desactives', langue: 'de',
  verifTrad: 'actif', modeTrad: 'inactif'
};

function ouvrirPageReglages() {
  return ouvrir({
    racine: RACINE, page: 'settings',
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    txt: libellesHote(RACINE, ['REGL_LIBELLES'])
  });
}

test('smoke S3 : les réglages sauvegardés cochent le bon bouton radio', () => {
  const page = ouvrirPageReglages();
  assert.deepStrictEqual(page.messages.map((m) => m.type), ['pret'],
    'la page ne s’annonce pas prête (SZH.annoncerPret)');

  page.envoyer({ type: 'valeurs', valeurs: VALEURS_ENVOYEES });

  for (const [cle, valeur] of Object.entries(VALEURS_ENVOYEES)) {
    const coche = page.document.querySelector(
      'input[name="' + cle + '"][value="' + valeur + '"]');
    assert.ok(coche, 'aucun bouton radio pour ' + cle + '=' + valeur
      + ' : le groupe ne s’est pas construit');
    assert.strictEqual(coche.checked, true,
      'le bouton ' + cle + '=' + valeur + ' n’a pas été coché par les valeurs sauvegardées');
  }

  // Un bouton voisin, non désigné par le message, doit rester décoché : cocher() ne doit
  // pas cocher tout un groupe, seulement l'option reçue.
  const voisin = page.document.querySelector('input[name="theme"][value="clair"]');
  assert.ok(voisin, 'l’option voisine n’existe pas : le contrôle ne prouverait rien');
  assert.strictEqual(voisin.checked, false,
    'une option non envoyée s’est retrouvée cochée');
});
