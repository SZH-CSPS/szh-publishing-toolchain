// En-têtes d'un tableau complexe écrit par l'éditeur du cockpit (lib/table-model.js) :
// headers= de chaque cellule de données, titres de section, rangée de total.
//
//   node --test test/js/tableaux-entetes.test.js
//
// Le tableau type a deux rangées d'en-tête (années fusionnées, puis filles et garçons),
// une colonne d'en-tête, deux titres de section et une rangée de total, construit par les
// opérations de l'éditeur comme le ferait la personne qui le saisit.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const table = require(path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'table-model.js'));

const TSV = [
  'Mesure\tAn A\t\tAn B\t\tRemarque',
  '\tF\tG\tF\tG\t',
  '\tPremier degré\t\t\t\t',
  'Mesure 1\t11\t12\t13\t14\t',
  'Mesure 2\t21\t22\t23\t24\tr2',
  '\tSecond degré\t\t\t\t',
  'Mesure 3\t31\t32\t33\t34\t',
  'Total\t91\t92\t93\t94\tt'
].join('\n');

// `section` : { cMin } de chaque titre de section (1 : à droite de la colonne d'en-tête ;
// 0 : rangée entière).
function construire(cMinSection, preset) {
  let m = table.tableauDepuisTsv(TSV);
  const op = (nom, args) => {
    const r = table.appliquerOperationTable(nom, m, args);
    assert.ok(!r.erreur, nom + ' : ' + r.erreur);
    m = r;
  };
  op('fusionner', { rMin: 0, cMin: 0, rMax: 1, cMax: 0 });
  op('fusionner', { rMin: 0, cMin: 1, rMax: 0, cMax: 2 });
  op('fusionner', { rMin: 0, cMin: 3, rMax: 0, cMax: 4 });
  op('fusionner', { rMin: 0, cMin: 5, rMax: 1, cMax: 5 });
  op('entete', { sens: 'lignes', n: 2 });
  op('entete', { sens: 'colonnes', n: 1 });
  for (const r of [2, 5]) { op('section', { r: r, cMin: cMinSection, cMax: 5, actif: true }); }
  op('preset', { nom: preset || 'synthese' });
  return m;
}

// Texte des en-têtes d'une cellule de données, résolus par leur id.
function entetesDe(html, contenu) {
  const td = html.match(new RegExp('<td headers="([^"]*)"[^>]*>' + contenu + '</td>'));
  assert.ok(td, 'cellule « ' + contenu + ' » introuvable : ' + html);
  return td[1].split(' ').map((id) => {
    const th = html.match(new RegExp('<th id="' + id + '"[^>]*>([^<]*)</th>'));
    assert.ok(th, 'en-tête ' + id + ' introuvable');
    return th[1];
  });
}

test('tableau complexe : une cellule sous un titre de section garde le groupe de colonnes du thead', () => {
  const html = table.serialiserTable(construire(1));
  assert.deepStrictEqual(entetesDe(html, '11'), ['An A', 'F', 'Premier degré', 'Mesure 1']);
  assert.deepStrictEqual(entetesDe(html, '13'), ['An B', 'F', 'Premier degré', 'Mesure 1']);
  assert.deepStrictEqual(entetesDe(html, '33'), ['An B', 'F', 'Second degré', 'Mesure 3']);
  assert.deepStrictEqual(entetesDe(html, 'r2'), ['Remarque', 'Premier degré', 'Mesure 2']);
});

test('tableau complexe : la rangée de total ne reçoit aucun titre de section', () => {
  const html = table.serialiserTable(construire(1));
  assert.deepStrictEqual(entetesDe(html, '91'), ['An A', 'F', 'Total']);
  assert.deepStrictEqual(entetesDe(html, 't'), ['Remarque', 'Total']);
});

test('tableau complexe : sans style de total, la dernière rangée reste dans sa section', () => {
  const html = table.serialiserTable(construire(1, 'academique'));
  assert.deepStrictEqual(entetesDe(html, '91'), ['An A', 'F', 'Second degré', 'Total']);
});

test('titre de section à droite de la colonne d’en-tête : la cellule vide de gauche sort en <td>', () => {
  const m = construire(1);
  const html = table.serialiserTable(m);
  assert.ok(!/<th[^>]*><\/th>/.test(html), 'un <th> vide reste : ' + html);
  assert.match(html, /<tr>\n<td><\/td>\n<th id="szh-th-r2c1" scope="rowgroup" colspan="5">Premier degré<\/th>\n<\/tr>/);
  assert.match(html, /<tr>\n<td><\/td>\n<th id="szh-th-r5c1" scope="rowgroup" colspan="5">Second degré<\/th>\n<\/tr>/);
  assert.ok(!/szh-th-r2c0|szh-th-r5c0/.test(html), 'un headers= vise encore la cellule vide : ' + html);
  // Aller-retour : le <td> relu redevient la cellule de la colonne d'en-tête.
  const relu = table.analyserTable(html);
  assert.strictEqual(table.serialiserTable(relu), html, 'aller-retour instable');
  // L'aperçu de l'éditeur ne lui donne pas le style des en-têtes.
  const cellule = table.disposition(relu).lignes[2].cellules[0];
  assert.strictEqual(cellule.enDonnee, true);
  assert.strictEqual(table.disposition(relu).lignes[3].cellules[0].enDonnee, false);
});

test('titre de section sur la rangée entière : scope="rowgroup" et lien headers=', () => {
  const m = construire(0);
  const html = table.serialiserTable(m);
  assert.match(html, /<th id="szh-th-r2c0" scope="rowgroup" colspan="6">Premier degré<\/th>/, html);
  assert.match(html, /<th id="szh-th-r5c0" scope="rowgroup" colspan="6">Second degré<\/th>/, html);
  assert.deepStrictEqual(entetesDe(html, '11'), ['An A', 'F', 'Premier degré', 'Mesure 1']);
  assert.deepStrictEqual(entetesDe(html, '34'), ['An B', 'G', 'Second degré', 'Mesure 3']);
  assert.deepStrictEqual(entetesDe(html, '94'), ['An B', 'G', 'Total']);
  const relu = table.analyserTable(html);
  assert.deepStrictEqual(relu, m, 'aller-retour instable');
  // Désactivé : la fusion reste, la cellule redevient l'en-tête de sa rangée.
  const sans = table.appliquerOperationTable('section', relu, { r: 2, actif: false });
  assert.match(table.serialiserTable(sans), /<th id="szh-th-r2c0" scope="row" colspan="6">Premier degré<\/th>/);
});

// Un en-tête de gauche fusionné en hauteur sort en scope="rowgroup" et revient marqué à la
// relecture : il ne déborde pas sur les données, il reste un en-tête de ligne.
test('en-tête de gauche fusionné en hauteur : pas un titre de section', () => {
  let m = table.analyserTable('<table><tr><td rowspan="2">Groupe</td><td>L1</td><td>1</td></tr>'
    + '<tr><td>L2</td><td>2</td></tr></table>');
  m = table.appliquerOperationTable('entete', m, { sens: 'colonnes', n: 2 });
  const relu = table.analyserTable(table.serialiserTable(m));
  assert.strictEqual(relu.lignes[0].cellules[0].section, false);
});
