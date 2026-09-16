// Masquage du qualificatif de PROVENANCE d'un mot-clé edudoc (« Barrierefreiheit (szh) »,
// « inclusion (CSPS) », « plan d'études (na) ») : la forme canonique complète part dans le
// .meta.yaml et dans le CSV Edudoc, mais ce qualificatif-là ne doit jamais s'imprimer — voir
// sansQualificatifDeProvenance dans lib/mots-cles-edudoc.js pour la règle et le pourquoi.
//
//   node --test "test/js/*.test.js"
//
// Ce fichier ne couvre QUE la moitié JavaScript de la règle : la fonction elle-même
// (sansQualificatifDeProvenance) et l'égalité de sa liste fermée avec celle de
// pipeline/filters/szh-maquette.lua (QUALIFICATIFS_PROVENANCE), qui fait le même travail pour
// le PDF et le HTML. Le dédoublonnage et le masquage dans l'export OJS réel (l'XML produit)
// sont couverts dans test/js/export-ojs.test.js, qui a déjà tout l'attirail pour monter un
// numéro complet.
//
// ⚠ Ce que CE fichier NE couvre PAS : le comportement RÉEL du filtre Lua (masquage, tri
// alphabétique sur la forme affichée, dédoublonnage) tel qu'exécuté par pandoc sur
// resumes[].motscles — la fonction qui alimente à la fois la galley HTML et le PDF
// (szh-article.html). L'éprouver demanderait de faire tourner pandoc, comme le fait
// test/filtres-pandoc.test.js pour le tri des mots-clés (A8) déjà en place — mais ce
// fichier-ci est hors du périmètre de ce chantier (voir la consigne qui l'a produit). La
// liste et la fonction Lua ont été écrites en miroir exact de leur équivalent JS, et
// réutilisent cle_tri_motcle (déjà éprouvé par filtres-pandoc.test.js) pour le
// dédoublonnage — mais aucun test exécutable ne le prouve ici.
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
  // Une casse mêlée, comme le thésaurus les écrit parfois réellement (« Szh », « Na »).
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('Barrierefreiheit (Szh)'),
    'Barrierefreiheit');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('accessibilité (Na)'),
    'accessibilité');
});

test('provenance : une parenthèse de SENS en fin de libellé n’est jamais touchée', () => {
  // Les cas réels cités par Robin, qui distinguent deux concepts ou portent un acronyme
  // officiel : un « tout ce qui est entre parenthèses » les aurait cassés.
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
  // Même quand son contenu est, par malchance, l'un des cinq jetons : seule la parenthèse
  // FINALE compte, jamais une recherche n'importe où dans le texte.
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

// Cas dégénéré signalé après coup : un mot-clé réduit à son seul qualificatif de provenance
// devient une chaîne vide. Personne ne tape « (na) » tout seul et aucun descripteur du
// thésaurus n'a cette forme, mais la saisie manuelle reste ouverte, et c'est à l'appelant
// (lib/export-ojs.js, pipeline/filters/szh-maquette.lua) d'écarter l'entrée une fois vidée —
// cette fonction-ci, elle, ne fait QUE masquer, elle ne filtre rien.
test('provenance : un mot-clé réduit à son seul qualificatif devient une chaîne vide', () => {
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('(na)'), '');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('(szh)'), '');
  assert.strictEqual(motsClesEdudoc.sansQualificatifDeProvenance('(SZH)'), '');
});

// ---- L'accord des deux listes, Lua et JS ----------------------------------------------
//
// Même patron que test/js/emplacements.test.js pour l'emplacement des revues (Lua/PowerShell
// là-bas, ici Lua/JS) : lire les DEUX fichiers et comparer, pour qu'une modification d'un
// seul côté fasse échouer ce test plutôt que de diverger en silence entre le PDF et la page
// publique d'ojs.szh.ch.
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
  // Et la fonction Lua existe bien, appelée par le même nom que celui documenté ici et dans
  // le commentaire de mots-cles-edudoc.js — un renommage silencieux romprait le lien décrit
  // entre les deux fichiers sans qu’aucun test ne le remarque autrement.
  assert.ok(lua.indexOf('local function sans_qualificatif_provenance(texte)') !== -1,
    'sans_qualificatif_provenance a disparu ou a été renommée dans szh-maquette.lua');
});
