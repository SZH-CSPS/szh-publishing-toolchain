// Smoke test S3 : l'onglet Paramètres de l'Accueil restaure le bon bouton radio depuis les valeurs
// que l'hôte envoie.
//
//   node --test test/js/smoke-settings.test.js
//
// Pourquoi : c'est le trou de harnais nommé par la revue de l'infrastructure de test — la page
// retrouve ses radios par `panneau.querySelector('input[name="…"][value="…"]')`, que le DOM
// minimal (dom-minimal.js, `correspond`/`correspondAttribut`) a dû apprendre à reconnaître :
// attribut posé par setAttribute puis, à défaut, propriété de même nom (`radio.name = …`).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ouvrirReglages, MSG } = require('./page-reglages');

// Un radio par groupe, tel que media/accueil.js (choix()) les nomme : `name` est la clé du
// réglage, `value` la valeur de l'option — la même forme que le message « valeurs » de l'hôte,
// réduite aux groupes qui suffisent au contrôle : plusieurs clés, pour prouver que cocher() ne
// s'arrête pas à la première.
const VALEURS_ENVOYEES = {
  theme: 'sombre', zoom: '1', policeMd: '16', apercu: 'pdf', assets: 'oui', cmyk: 'non',
  warnings: 'reduits', liensReferences: 'desactives', langue: 'de',
  verifTrad: 'actif', modeTrad: 'inactif', majSilencieuse: 'silence', modeDev: 'actif'
};

test('smoke S3 : les réglages sauvegardés cochent le bon bouton radio', () => {
  const p = ouvrirReglages();
  assert.strictEqual(p.postes(MSG.PRET).length, 1, 'la page ne s’annonce pas prête (SZH.annoncerPret)');

  p.envoyer({ type: MSG.VALEURS, valeurs: VALEURS_ENVOYEES });

  for (const [cle, valeur] of Object.entries(VALEURS_ENVOYEES)) {
    const coche = p.un('input[name="' + cle + '"][value="' + valeur + '"]');
    assert.ok(coche, 'aucun bouton radio pour ' + cle + '=' + valeur + ' : le groupe ne s’est pas construit');
    assert.strictEqual(coche.checked, true,
      'le bouton ' + cle + '=' + valeur + ' n’a pas été coché par les valeurs sauvegardées');
  }

  // Un bouton voisin, non désigné par le message, doit rester décoché : cocher() ne doit pas
  // cocher tout un groupe, seulement l'option reçue.
  const voisin = p.un('input[name="theme"][value="clair"]');
  assert.ok(voisin, 'l’option voisine n’existe pas : le contrôle ne prouverait rien');
  assert.strictEqual(voisin.checked, false, 'une option non envoyée s’est retrouvée cochée');
});

test('un geste sur un radio part en « regler », et le choix du produit proposé aussi', () => {
  const p = ouvrirReglages();
  p.envoyer({ type: MSG.VALEURS, valeurs: VALEURS_ENVOYEES, poste: { produit: '', produitAuto: 'revue' } });
  const radio = p.un('input[name="theme"][value="clair"]');
  radio.checked = true;
  radio.dispatchEvent({ type: 'change' });
  assert.deepStrictEqual(p.postes(MSG.REGLER), [{ type: MSG.REGLER, cle: 'theme', valeur: 'clair' }]);
  const select = p.un('select');
  assert.deepStrictEqual(select.querySelectorAll('option').map((o) => o.value), ['', 'revue', 'zeitschrift', 'livre']);
  select.value = 'zeitschrift';
  select.dispatchEvent({ type: 'change' });
  assert.deepStrictEqual(p.postes(MSG.REGLER).pop(), { type: MSG.REGLER, cle: 'produit', valeur: 'zeitschrift' });
});
