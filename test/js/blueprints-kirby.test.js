// Éprouve kirby/generer-blueprints.js : les blueprints committés dans
// kirby/site/blueprints/pages/ égalent la génération depuis le contrat unique
// pipeline/kirby/champs-documentation.json, et trois garanties structurelles tenues par le
// générateur (chaque liste a ses deux langues, aucun nom de champ hors a-z0-9_, aucun champ
// nommé `image` — méthode réservée de Kirby, voir TODO_KirbyCMS.md §10).
//
//   node --test test/js/blueprints-kirby.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const gen = require(path.join(RACINE, 'kirby', 'generer-blueprints.js'));

const contrat = gen.chargerContrat();

// ---- Les blueprints committés égalent la génération -------------------------------------

test('blueprints committés : identiques octet pour octet à la génération', () => {
  const attendus = gen.genererContenus(contrat);
  const noms = Object.keys(attendus);
  assert.ok(noms.length > 0, 'aucun blueprint généré');
  for (const nom of noms) {
    const chemin = path.join(gen.DOSSIER_PAGES, nom);
    assert.ok(fs.existsSync(chemin), 'blueprint absent du dépôt : ' + nom
      + ' (lancer node kirby/generer-blueprints.js)');
    const surDisque = fs.readFileSync(chemin, 'utf8');
    assert.strictEqual(surDisque, attendus[nom],
      nom + ' diffère de la génération — relancer node kirby/generer-blueprints.js');
  }
});

test('blueprints committés : aucun fichier en trop dans le dossier', () => {
  const attendus = new Set(Object.keys(gen.genererContenus(contrat)));
  const surDisque = fs.readdirSync(gen.DOSSIER_PAGES).filter((f) => f.endsWith('.yml'));
  for (const f of surDisque) {
    assert.ok(attendus.has(f), f + ' n’a plus de source dans le JSON — à retirer');
  }
});

test('--verifier : sort en code 0 quand le dépôt est à jour', () => {
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath,
    [path.join(RACINE, 'kirby', 'generer-blueprints.js'), '--verifier'],
    { encoding: 'utf8', cwd: RACINE });
  assert.strictEqual(r.status, 0, 'sortie : ' + r.stdout + r.stderr);
});

// ---- Chaque liste du JSON a toutes ses options en fr et en de ---------------------------

test('listes : chaque jeton a un libellé fr et de non vides', () => {
  for (const [nomListe, items] of Object.entries(contrat.listes)) {
    assert.ok(Array.isArray(items) && items.length > 0, 'liste vide : ' + nomListe);
    for (const it of items) {
      assert.ok(it.jeton, 'jeton manquant dans la liste ' + nomListe);
      assert.strictEqual(typeof it.fr, 'string', nomListe + '.' + it.jeton + ' sans fr');
      assert.notStrictEqual(it.fr.trim(), '', nomListe + '.' + it.jeton + ' : fr vide');
      assert.strictEqual(typeof it.de, 'string', nomListe + '.' + it.jeton + ' sans de');
      assert.notStrictEqual(it.de.trim(), '', nomListe + '.' + it.jeton + ' : de vide');
    }
  }
});

// Corollaire côté blueprint généré : les options select portent aussi les deux langues (même
// après le suffixe canton ajouté pour les instruments `local: true`).
test('blueprints générés : les options select ont toutes fr et de', () => {
  const docs = gen.construireTous(contrat);
  const walker = (fields) => {
    for (const [nomChamp, config] of Object.entries(fields)) {
      if (config.type === 'select') {
        for (const [jeton, libelles] of Object.entries(config.options)) {
          assert.ok(libelles.fr, nomChamp + '.' + jeton + ' : fr manquant');
          assert.ok(libelles.de, nomChamp + '.' + jeton + ' : de manquant');
        }
      }
      if (config.type === 'structure') { walker(config.fields); }
    }
  };
  for (const arbre of Object.values(docs)) { if (arbre.fields) { walker(arbre.fields); } }
});

// ---- Aucun nom de champ hors [a-z0-9_], aucun champ nommé `image` -----------------------

test('blueprints générés : noms de champ en a-z0-9_ uniquement, jamais `image`', () => {
  const docs = gen.construireTous(contrat);
  const CLE_SIMPLE = /^[a-z0-9_]+$/;
  const walker = (fields, origine) => {
    for (const [nomChamp, config] of Object.entries(fields)) {
      assert.match(nomChamp, CLE_SIMPLE, origine + ' : nom de champ hors a-z0-9_ : ' + nomChamp);
      assert.notStrictEqual(nomChamp, 'image',
        origine + ' : champ nommé `image` — méthode réservée de Kirby (TODO_KirbyCMS.md §10)');
      if (config && config.type === 'structure') { walker(config.fields, origine + '.' + nomChamp); }
    }
  };
  for (const [nomFichier, arbre] of Object.entries(docs)) {
    if (arbre.fields) { walker(arbre.fields, nomFichier); }
  }
});
