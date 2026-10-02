// lib/autre-revue.js : les articles de l'autre revue, lus dans les numéros de la racine
// active, en cours et archivés, pour préremplir une fiche « D'une revue à l'autre ».
//
//   node --test test/js/autre-revue.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const autreRevue = require(path.join(COCKPIT, 'lib', 'autre-revue.js'));
const LF = '\n';

function ecrire(chemin, lignes) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, lignes.join(LF) + LF);
}
function numero(dossier, revue, lang, numeroTxt) {
  ecrire(path.join(dossier, 'ausgabe.yaml'),
    ['revue: "' + revue + '"', 'title: "Numéro d’essai"', 'lang: ' + lang, 'volume: "16"', 'numero: "' + numeroTxt + '"']);
}
function article(dossierNumero, slug, meta) {
  ecrire(path.join(dossierNumero, 'articles', slug, slug + '.md'), ['Texte.']);
  ecrire(path.join(dossierNumero, 'articles', slug, slug + '.meta.yaml'), meta);
}

// Une racine d'arbre jetable : deux numéros de la Revue (l'un archivé), un numéro illisible,
// et un numéro de la Zeitschrift, la revue courante, qui ne doit jamais être proposé.
function racineEssai() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-autre-revue-'));
  const r1 = path.join(racine, 'Revue', '2026-01');
  numero(r1, 'Revue suisse de pédagogie spécialisée', 'fr', '1');
  article(r1, '01-inclusion', ['type: article', 'title:', '  fr: "L’inclusion au quotidien"', '  de: "Inklusion im Alltag"',
    'author:', '- prenom: "Alice"', '  nom: "Meier"', '- prenom: "Bob"', '  nom: "Martin"',
    'resume:', '  fr: "Un résumé."', '  de: "Eine Zusammenfassung."']);
  article(r1, '02-ecole', ['type: article', 'title:', '  fr: "L’école et ses marges"',
    'author:', '- prenom: "Claire"', '  nom: "Dubois"', 'resume:', '  fr: "Résumé seul."']);
  article(r1, '03-documentation', ['type: documentation', 'title:', '  fr: "Actualité et ressources"']);
  const r2 = path.join(racine, '_Archive', 'Revue', '2025-02');
  numero(r2, 'Revue suisse de pédagogie spécialisée', 'fr', '2');
  article(r2, '01-ancien', ['type: article', 'title:', '  fr: "Un ancien article"',
    'author:', '- prenom: "Denis"', '  nom: "Roux"']);
  fs.mkdirSync(path.join(racine, 'Revue', '2026-02-casse', 'articles'), { recursive: true });
  const z = path.join(racine, 'Zeitschrift', '2026-01');
  numero(z, 'Schweizerische Zeitschrift für Heilpädagogik', 'de', '1');
  article(z, '01-eigen', ['type: article', 'title:', '  de: "Ein eigener Artikel"']);
  return racine;
}

test('les numéros de l’autre revue, du plus récent au plus ancien, l’archive marquée', () => {
  const r = autreRevue.articlesAutreRevue(racineEssai(), 'zeitschrift', 'de');
  assert.deepStrictEqual(r.numeros.map((n) => [n.cle, n.archive]), [['2026-01', false], ['2025-02', true]]);
  assert.strictEqual(r.illisibles, 1, 'le numéro sans ausgabe.yaml compte, sans arrêter la lecture');
  for (const n of r.numeros) { assert.ok(n.libelle, 'libellé de numéro absent'); }
});

test('jamais la revue courante, jamais la page de Documentation', () => {
  const r = autreRevue.articlesAutreRevue(racineEssai(), 'zeitschrift', 'de');
  const titres = [].concat(...r.numeros.map((n) => n.articles.map((a) => a.valeurs.title)));
  assert.ok(!titres.includes('Ein eigener Artikel'), 'un article de la Zeitschrift elle-même est proposé');
  assert.ok(!titres.some((t) => /Actualité et ressources/.test(t)), 'la page de Documentation est proposée');
  assert.strictEqual(r.numeros[0].articles.length, 2);
});

test('les valeurs : titre et résumé dans la langue du numéro ouvert, sinon dans celle de l’article', () => {
  const r = autreRevue.articlesAutreRevue(racineEssai(), 'zeitschrift', 'de');
  const [a1, a2] = r.numeros[0].articles;
  assert.deepStrictEqual(a1.valeurs, {
    revue: 'revue', title: 'Inklusion im Alltag', auteurs: 'Alice Meier und Bob Martin',
    reference: '2026, 1', doi: '10.57161/r2026-01-00', lien: 'https://doi.org/10.57161/r2026-01-00',
    descriptif: 'Eine Zusammenfassung.'
  });
  assert.strictEqual(a2.valeurs.title, 'L’école et ses marges', 'pas de titre allemand : le titre français');
  assert.strictEqual(a2.valeurs.descriptif, 'Résumé seul.');
  assert.strictEqual(a2.valeurs.auteurs, 'Claire Dubois');
  assert.strictEqual(a2.valeurs.doi, '10.57161/r2026-01-01');
  assert.strictEqual(a1.titreAffiche, 'Inklusion im Alltag');
  assert.strictEqual(a1.signature, 'Alice Meier und Bob Martin');
  assert.ok(a1.cle && a1.cle !== a2.cle);
  assert.strictEqual(r.numeros[1].articles[0].valeurs.reference, '2025, 2');
});

test('depuis la Revue : les numéros de la Zeitschrift, signature à la française', () => {
  const r = autreRevue.articlesAutreRevue(racineEssai(), 'revue', 'fr');
  assert.deepStrictEqual(r.numeros.map((n) => n.cle), ['2026-01']);
  assert.strictEqual(r.numeros[0].articles[0].valeurs.revue, 'zeitschrift');
  assert.strictEqual(r.numeros[0].articles[0].valeurs.title, 'Ein eigener Artikel');
  assert.strictEqual(r.illisibles, 0);
});

test('une racine sans aucun numéro rend une liste vide, sans lever', () => {
  const vide = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-autre-revue-vide-'));
  assert.deepStrictEqual(autreRevue.articlesAutreRevue(vide, 'revue', 'fr'), { numeros: [], illisibles: 0 });
  assert.deepStrictEqual(autreRevue.articlesAutreRevue(vide, 'inconnue', 'fr'), { numeros: [], illisibles: 0 });
});
