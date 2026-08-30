// Les filtres d'assainissement sont-ils BRANCHÉS ? Rien de plus : ce fichier est exécuté
// par le job `contrats` de la CI, qui n'installe volontairement pas la chaîne PDF.
//
//   node --test test/js/attributs-sains.test.js
//
// Ce que font réellement ces filtres se vérifie en faisant tourner pandoc, dans
// test/filtres-pandoc.test.js — hors du glob `test/js/*.test.js`, et lancé par le job
// `pdf-ua`, seul à disposer de pandoc.
//
// Un filtre débranché ne casse rien de visible : le livre sort, conforme, et le défaut ne
// se lit qu'une fois imprimé. D'où ce contrôle, qui ne coûte rien.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const RACINE = path.resolve(__dirname, '..', '..');

test('filtres : l’assainissement des attributs est dans la chaîne d’import', () => {
  const sh = fs.readFileSync(path.join(RACINE, 'pipeline', 'import-docx.sh'), 'utf8');
  assert.match(sh, /szh-attributs-sains\.lua/,
    'szh-attributs-sains.lua n’est plus appelé : les classes de style Word redeviendront ' +
    'illisibles et leur bloc d’attributs s’imprimera dans le livre');
});

// Celui-ci garde le nombre de PAGES d'un livre FALC. Sans lui, chaque saut de ligne est
// posé deux fois — le `\` de l'import Word, puis le retour promu par hard_line_breaks — et
// l'ouvrage gagne un tiers de pages sans qu'aucun avertissement ne l'annonce.
test('filtres : les sauts uniques sont dans la chaîne du livre', () => {
  const mk = fs.readFileSync(path.join(RACINE, 'pipeline', 'profils', 'livre.mk'), 'utf8');
  assert.match(mk, /szh-sauts-uniques\.lua/,
    'szh-sauts-uniques.lua n’est plus dans FILTRES_CHAPITRE : les sauts redeviendront doubles');
});
