// Masquage du qualificatif de provenance d'un mot-clé edudoc (« Barrierefreiheit (szh) »,
// « inclusion (CSPS) », « plan d'études (na) ») : la forme complète part dans le .meta.yaml et
// dans le CSV Edudoc, mais le qualificatif ne s'imprime pas (voir
// sansQualificatifDeProvenance dans lib/mots-cles-edudoc.js).
//
// Ce fichier couvre la fonction JavaScript et l'égalité de sa liste fermée avec
// QUALIFICATIFS_PROVENANCE de pipeline/filters/szh-maquette.lua, qui fait le même travail
// pour le PDF et le HTML. Le masquage dans l'export OJS est couvert par
// test/js/export-ojs.test.js.
//
// Non couvert : le comportement du filtre Lua exécuté par pandoc sur resumes[].motscles
// (masquage, tri sur la forme affichée, dédoublonnage par cle_tri_motcle). Il faudrait faire
// tourner pandoc, comme test/filtres-pandoc.test.js le fait pour le tri des mots-clés.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const motsClesEdudoc = require(path.join(COCKPIT, 'lib', 'mots-cles-edudoc.js'));
const LUA_MAQUETTE = path.join(RACINE, 'pipeline', 'filters', 'szh-maquette.lua');

// ---- La fonction elle-même -----------------------------------------------------------

test('provenance : chaque jeton de la liste fermée est masqué, dans les deux casses', () => {
  for (const jeton of motsClesEdudoc.QUALIFICATIFS_PROVENANCE) {
    for (const forme of [jeton, jeton.toUpperCase()]) {
      assert.strictEqual(
        motsClesEdudoc.sansQualificatifDeProvenance('Terme (' + forme + ')'), 'Terme',
        'jeton non masqué : (' + forme + ')');
    }
  }
  // Une casse mêlée, comme le thésaurus en écrit parfois (« Szh », « Na »).
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('Barrierefreiheit (Szh)'),
    'Barrierefreiheit');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('accessibilité (Na)'),
    'accessibilité');
});

test('provenance : une parenthèse de SENS en fin de libellé n’est jamais touchée', () => {
  // Des parenthèses qui distinguent deux concepts ou portent un acronyme officiel : une règle
  // « tout ce qui est entre parenthèses » les casserait.
  for (const libelle of [
    'diagnostic (résultat)',
    'diagnostic (processus)',
    "procédure d'évaluation standardisée (PES)",
    'standardisiertes Abklärungsverfahren (SAV)',
    'personne en formation (dans la formation professionnelle)',
    'Lernende Person (in der Berufsbildung)'
  ]) {
    assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance(libelle), libelle,
      'une parenthèse de sens a été altérée : ' + libelle);
  }
});

test('provenance : une parenthèse au MILIEU du libellé n’est jamais touchée', () => {
  // Seule la parenthèse finale compte, même quand une autre contient l'un des cinq jetons.
  const libelle = 'Formation (SZH) continue';
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance(libelle), libelle);
});

test('provenance : un mot-clé sans parenthèse ressort inchangé', () => {
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('pédagogie spécialisée'),
    'pédagogie spécialisée');
});

test('provenance : une valeur vide, nulle ou non-chaîne ne fait pas lever d’erreur', () => {
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance(''), '');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance(undefined), '');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance(null), '');
});

// Un mot-clé réduit à son qualificatif devient une chaîne vide. La fonction ne fait que
// masquer : c'est à l'appelant (lib/export-ojs.js, pipeline/filters/szh-maquette.lua)
// d'écarter l'entrée vidée.
test('provenance : un mot-clé réduit à son seul qualificatif devient une chaîne vide', () => {
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('(na)'), '');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('(szh)'), '');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('(SZH)'), '');
});

// ---- L'accord des deux listes, Lua et JS ----------------------------------------------
//
// Le test lit les deux fichiers et compare : une modification d'un seul côté le fait échouer,
// au lieu de faire diverger le PDF et la page publique d'ojs.szh.ch (même méthode que
// test/js/emplacements.test.js).
test('provenance : la liste des qualificatifs est identique en Lua et en JavaScript', () => {
  const lua = fs.readFileSync(LUA_MAQUETTE, 'utf8');
  const bloc = lua.match(/local QUALIFICATIFS_PROVENANCE = \{([^}]*)\}/);
  assert.ok(bloc, 'la table QUALIFICATIFS_PROVENANCE a disparu de szh-maquette.lua');
  const clesLua = (bloc[1].match(/([A-Za-z]+)\s*=\s*true/g) || [])
    .map((m) => m.replace(/\s*=\s*true/, '').toLowerCase());
  assert.ok(clesLua.length > 0, 'aucun jeton n’a pu être extrait de la table Lua : ' + bloc[1]);
  assert.deepStrictEqual(clesLua.slice().sort(), motsClesEdudoc.QUALIFICATIFS_PROVENANCE.slice().sort(),
    'la liste Lua (' + clesLua.join(', ') + ') et la liste JS (' +
    motsClesEdudoc.QUALIFICATIFS_PROVENANCE.join(', ') + ') des qualificatifs de provenance ont divergé');
  // La fonction Lua existe sous le nom cité ici et dans mots-cles-edudoc.js.
  assert.ok(lua.indexOf('local function sans_qualificatif_provenance(texte)') !== -1,
    'sans_qualificatif_provenance a disparu ou a été renommée dans szh-maquette.lua');
});
