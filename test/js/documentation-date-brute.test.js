// Une date stockée qui n'existe pas au calendrier (2026-02-30) survit à l'ouverture et à
// l'enregistrement de la Documentation, et se signale au lieu de disparaitre.
//
//   node --test test/js/documentation-date-brute.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');
const { ouvrir, libellesHote } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));

activerHote(revueDEssai());
const doc = require(path.join(COCKPIT, 'lib', 'documentation-hote.js'));

function page(ressources, categorie) {
  const txt = libellesHote(RACINE, ['textesDocumentation']);
  const p = ouvrir({
    racine: RACINE, page: 'documentation', cssPartage: ['_design.css'],
    jsPartage: ['_messages.js', '_fiche-doc.js'], txt: txt
  });
  p.envoyer({
    type: 'charger', slug: 'documentation', accent: 'bleuacier', i18n: txt,
    typesConfig: doc._libelles.typesRessourceConfig('fr'), typesRubrique: [],
    rubriques: [], ressources: ressources, vueInitiale: { onglet: 'numero', categorie: categorie }
  });
  return p;
}
function champ(p, cle) {
  const i = p.document.querySelectorAll('input').find((e) => e.id.indexOf('ch-' + cle + '-') === 0);
  assert.ok(i, 'champ absent : ' + cle);
  return i;
}
function enregistrement(p) {
  p.parId.barre.querySelector('button').click();
  const m = p.messages.filter((x) => x.type === MSG.ENREGISTRER).pop();
  assert.ok(m, 'l’enregistrement doit partir');
  return m.ressources[0].valeurs;
}

const INTERVENTION = { id: 'i1', type: 'intervention', apercu: null, valeurs: {
  canton: 'CH', categorie: 'motion', numero: '1', date: '2026-02-30', title: 'M', etat: '', etat_date: '',
  suivi: [{ date: '2026-04-31', genre: '', libelle: 'Réponse', lien: '' }] } };

test('le harnais vide une date impossible dans un champ type="date", comme le navigateur', () => {
  const p = page([], 'intervention');
  const i = p.document.createElement('input');
  i.type = 'date';
  i.value = '2026-02-30';
  assert.strictEqual(i.value, '');
  i.value = '2024-02-29';
  assert.strictEqual(i.value, '2024-02-29');
});

test('une date impossible stockée reste dans le champ et repart telle quelle à l’enregistrement', () => {
  const p = page([INTERVENTION], 'intervention');
  assert.strictEqual(champ(p, 'date').value, '2026-02-30');
  assert.strictEqual(enregistrement(p).date, '2026-02-30');
});

test('elle se signale : la page demande aussitôt sa forme à l’hôte', () => {
  const p = page([INTERVENTION], 'intervention');
  const d = p.messages.filter((m) => m.type === MSG.DOC_DATE_FORMER);
  assert.strictEqual(d.length, 1, 'une seule demande, pour la date illisible');
  assert.deepStrictEqual([...d[0].valeurs], ['2026-02-30']);
});

test('une date impossible dans une ligne de suivi survit aussi, et se signale', () => {
  const p = page([INTERVENTION], 'intervention');
  const sous = p.document.querySelectorAll('input').find((e) => e.id.indexOf('sc-suivi-date-') === 0);
  assert.ok(sous, 'date de suivi absente');
  assert.strictEqual(sous.value, '2026-04-31');
  assert.ok(sous.classList.contains('doc-date-champ--erreur'), 'la date de suivi illisible doit se voir');
  assert.strictEqual(enregistrement(p).suivi[0].date, '2026-04-31');
});

test('une date valide garde son champ de date', () => {
  const p = page([Object.assign({}, INTERVENTION, { valeurs: Object.assign({}, INTERVENTION.valeurs,
    { date: '2026-02-28', suivi: [] }) })], 'intervention');
  assert.strictEqual(champ(p, 'date').type, 'date');
  assert.strictEqual(enregistrement(p).date, '2026-02-28');
});
