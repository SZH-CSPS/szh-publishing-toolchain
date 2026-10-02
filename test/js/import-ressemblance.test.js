// Un Word renommé par l'auteur (« Essai-corrige.docx » pour l'article « essai ») : avant
// la conversion, le cockpit demande s'il corrige cet article ou s'il en est un nouveau,
// au lieu de créer un doublon en silence.
//
//   node --test test/js/import-ressemblance.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const NOM_IMPORT = 'Importer les articles Word';
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);
const MOTS = path.join(REVUE, 'articles-word');
const WORD = 'Essai-corrige.docx';

const CORRIGE = 'Version corrigée de cet article';
const NOUVEAU = 'Nouvel article';

let lancees = [];
let presentAuLancement = null;
const origExecute = HOTE.stub.tasks.executeTask;

test('mise en route', async () => {
  await demarrageSeTait(HOTE);
  fs.rmSync(path.join(MOTS, '9_Essai.docx'), { force: true });
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
  HOTE.stub.tasks.executeTask = (t) => {
    lancees.push(t.name);
    if (t.name === NOM_IMPORT) { presentAuLancement = fs.existsSync(path.join(MOTS, WORD)); }
    return origExecute(t);
  };
});

function question() {
  return HOTE.modales.filter((m) => m.message.indexOf('Ce Word ressemble') === 0).pop() || null;
}

async function convertir() {
  const promesse = HOTE.executer('szh.convertirEnAttente');
  for (let i = 0; i < 6; i++) { await tick(); }
  if (lancees.indexOf(NOM_IMPORT) !== -1) { await HOTE.finirTache(NOM_IMPORT, 0); }
  await promesse;
  for (let i = 0; i < 6; i++) { await tick(); }
}

function avant() {
  lancees = [];
  presentAuLancement = null;
  HOTE.modales.length = 0;
  fs.writeFileSync(path.join(MOTS, WORD), Buffer.alloc(16));
}

test('la question nomme l’article par son titre, avec les deux boutons', async () => {
  avant();
  HOTE.repondreModale(NOUVEAU);
  await convertir();
  const q = question();
  assert.ok(q, 'aucune question posée pour un Word dont le nom prolonge celui d’un article');
  assert.strictEqual(q.message, 'Ce Word ressemble à l’article « Titre ».');
  assert.ok(q.options && q.options.modal, 'la question doit être modale');
  assert.deepStrictEqual(q.boutons, [CORRIGE, NOUVEAU]);
});

test('« Nouvel article » laisse la conversion se faire', () => {
  assert.deepStrictEqual(lancees, [NOM_IMPORT]);
  assert.strictEqual(presentAuLancement, true, 'le Word devait rester dans le dépôt pour être converti');
});

test('Annuler : ce Word n’est pas converti, et il reste dans le dépôt', async () => {
  avant();
  fs.writeFileSync(path.join(MOTS, '7_Autre.docx'), Buffer.alloc(16));
  await convertir();
  assert.ok(question(), 'la question n’a pas été posée');
  assert.deepStrictEqual(lancees, [NOM_IMPORT], 'l’autre Word devait encore être converti');
  assert.strictEqual(presentAuLancement, false, 'le Word écarté était visible de la conversion');
  assert.ok(fs.existsSync(path.join(MOTS, WORD)), 'le Word écarté n’a pas été remis dans le dépôt');
  fs.rmSync(path.join(MOTS, '7_Autre.docx'), { force: true });
});

test('Annuler sur le seul Word en attente : aucune conversion lancée', async () => {
  avant();
  await convertir();
  assert.ok(question());
  assert.deepStrictEqual(lancees, []);
  assert.ok(fs.existsSync(path.join(MOTS, WORD)));
});

test('« Version corrigée » lance le réimport forcé de cet article, sans convertir le Word', async () => {
  avant();
  HOTE.repondreModale(CORRIGE);
  const journal = HOTE.stub.commands._journal;
  const depart = journal.length;
  await convertir();
  const appel = journal.slice(depart).find((c) => c.id === 'szh.reimporterArticle');
  assert.ok(appel, 'le réimport n’a pas été lancé');
  assert.deepStrictEqual(appel.args[0], { word: WORD, slug: '01-essai' });
  assert.deepStrictEqual(lancees, [], 'le Word corrigé est parti à la conversion');
  // Le réimport existant demande encore sa confirmation (annulée ici) : rien n'est touché.
  assert.ok(HOTE.modales.some((m) => m.message.indexOf('Remplacer le texte de l’article « 01-essai »') === 0));
  assert.ok(fs.existsSync(path.join(MOTS, WORD)));
});

test('un Word sans parenté de nom ne pose aucune question', async () => {
  avant();
  fs.rmSync(path.join(MOTS, WORD));
  fs.writeFileSync(path.join(MOTS, 'Inclusion.docx'), Buffer.alloc(16));
  await convertir();
  assert.strictEqual(question(), null);
  assert.deepStrictEqual(lancees, [NOM_IMPORT]);
  fs.rmSync(path.join(MOTS, 'Inclusion.docx'), { force: true });
  HOTE.stub.tasks.executeTask = origExecute;
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
});
