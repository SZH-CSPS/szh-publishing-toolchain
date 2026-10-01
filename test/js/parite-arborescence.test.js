// Parité de l'arborescence entre PowerShell et JavaScript.
//
//   node --test "test/js/*.test.js"
//
// L'arbre de la rédaction (Revue, Zeitschrift, Books, _Archive) et la façon de reconnaître un
// produit sur le disque sont écrits deux fois : dans windows/szh-produits.ps1 ($SzhSousDossiers,
// $SzhProduits, Get-SzhJetonDossier) et dans le cockpit (lib/kirby-contenu.js, lib/profil.js).
// Un dossier renommé d'un seul côté ne casse rien à grand bruit : le lanceur crée « Books »
// pendant que le cockpit cherche ailleurs, et les livres disparaissent d'un côté. Ce test lit
// le fichier PowerShell en texte, sans recopier ses valeurs, et les confronte aux constantes
// exportées par les deux modules JavaScript.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const PS = fs.readFileSync(path.join(RACINE, 'windows', 'szh-produits.ps1'), 'utf8');
const kirby = require(path.join(COCKPIT, 'lib', 'kirby-contenu.js'));
const profil = require(path.join(COCKPIT, 'lib', 'profil.js'));

// $SzhSousDossiers : { jeton: { encours, archive } }.
function sousDossiersPS() {
  const debut = PS.indexOf('$script:SzhSousDossiers = @{');
  assert.notStrictEqual(debut, -1, '$SzhSousDossiers a disparu de szh-produits.ps1');
  const bloc = PS.slice(debut, PS.indexOf('\n}', debut));
  const re = /^\s*(\w+)\s*=\s*@\{\s*encours\s*=\s*'([^']+)';\s*archive\s*=\s*'([^']+)'\s*\}/gm;
  const res = {};
  let m;
  while ((m = re.exec(bloc)) !== null) { res[m[1]] = { encours: m[2], archive: m[3] }; }
  return res;
}

// Le manifeste de chaque ligne de $SzhProduits : { jeton: 'ausgabe.yaml' | 'buch.yaml' }.
function manifestesPS() {
  const debut = PS.indexOf('$script:SzhProduits = @{');
  assert.notStrictEqual(debut, -1, '$SzhProduits a disparu de szh-produits.ps1');
  const bloc = PS.slice(debut, PS.indexOf('\n}', debut));
  const re = /jeton\s*=\s*'(\w+)'[\s\S]*?manifeste\s*=\s*'([^']+)'/g;
  const res = {};
  let m;
  while ((m = re.exec(bloc)) !== null) { res[m[1]] = m[2]; }
  return res;
}

// Les manifestes testés par Get-SzhJetonDossier, dans l'ordre où le script les teste.
function ordreDetectionPS() {
  const debut = PS.indexOf('function Get-SzhJetonDossier');
  assert.notStrictEqual(debut, -1, 'Get-SzhJetonDossier a disparu de szh-produits.ps1');
  const corps = PS.slice(debut, PS.indexOf('\n}', debut));
  const res = [];
  const re = /'(buch\.yaml|ausgabe\.yaml)'/g;
  let m;
  while ((m = re.exec(corps)) !== null) { if (res.indexOf(m[1]) === -1) { res.push(m[1]); } }
  return res;
}

test('les trois produits de $SzhSousDossiers sont ceux du cockpit', () => {
  const ps = sousDossiersPS();
  assert.deepStrictEqual(Object.keys(ps).sort(), ['livre', 'revue', 'zeitschrift'],
    '$SzhSousDossiers ne porte plus les trois produits attendus');
  const encours = Object.keys(ps).map((j) => ps[j].encours.toLowerCase()).sort();
  assert.deepStrictEqual(encours, kirby.DOSSIERS_PRODUIT.slice().sort(),
    'les dossiers en cours du lanceur et DOSSIERS_PRODUIT (kirby-contenu.js) ont divergé');
});

test('revue et Zeitschrift : mêmes noms de dossier des deux côtés', () => {
  const ps = sousDossiersPS();
  for (const jeton of Object.keys(kirby.DOSSIERS_REVUE)) {
    assert.ok(ps[jeton], 'DOSSIERS_REVUE connaît « ' + jeton + ' », pas $SzhSousDossiers');
    assert.strictEqual(ps[jeton].encours, kirby.DOSSIERS_REVUE[jeton],
      'le dossier en cours de « ' + jeton + ' » diffère entre PowerShell et DOSSIERS_REVUE');
  }
});

test('les archives : un seul _Archive, un sous-dossier par produit, des deux côtés', () => {
  const ps = sousDossiersPS();
  for (const jeton of Object.keys(ps)) {
    const [racine, ...reste] = ps[jeton].archive.split('\\');
    assert.strictEqual(racine.toLowerCase(), kirby.DOSSIER_ARCHIVE,
      'le dossier d’archives de « ' + jeton + ' » ne commence pas par DOSSIER_ARCHIVE');
    assert.deepStrictEqual(reste, [ps[jeton].encours],
      'l’archive de « ' + jeton + ' » ne porte pas le même nom de produit que son dossier en cours');
  }
});

test('ordre de détection : buch.yaml avant ausgabe.yaml, comme profil.js', () => {
  const js = profil.ORDRE_DETECTION.map((cle) => profil.PROFILS[cle].config);
  assert.deepStrictEqual(ordreDetectionPS(), js,
    'Get-SzhJetonDossier et ORDRE_DETECTION ne testent plus les manifestes dans le même ordre');
});

test('les manifestes de $SzhProduits sont les config de PROFILS', () => {
  const ps = manifestesPS();
  assert.deepStrictEqual(Object.keys(ps).sort(), ['livre', 'revue', 'zeitschrift']);
  assert.strictEqual(ps.livre, profil.PROFILS.livre.config, 'le manifeste du livre a divergé');
  // La Zeitschrift est un profil « revue » côté cockpit : le même fichier.
  assert.strictEqual(ps.revue, profil.PROFILS.revue.config, 'le manifeste de la revue a divergé');
  assert.strictEqual(ps.zeitschrift, profil.PROFILS.revue.config,
    'le manifeste de la Zeitschrift a divergé de celui du profil revue');
});
