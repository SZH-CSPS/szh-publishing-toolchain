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

// La présence seule ne suffit pas : le filtre assainit ce que tout ce qui précède a pu
// poser (son propre en-tête le dit), il doit donc être le DERNIER --lua-filter de la
// chaîne. Un filtre remonté après lui salirait de nouveau les attributs, en silence.
function dernierFiltre(sh) {
  const noms = [];
  const re = /--lua-filter="\$PIPE\/filters\/([a-zA-Z0-9_-]+)\.lua"/g;
  let m;
  while ((m = re.exec(sh)) !== null) { noms.push(m[1]); }
  assert.ok(noms.length > 0, 'aucun --lua-filter trouvé dans import-docx.sh');
  return noms[noms.length - 1];
}

test('filtres : szh-attributs-sains.lua est le DERNIER --lua-filter de l’import', () => {
  const sh = fs.readFileSync(path.join(RACINE, 'pipeline', 'import-docx.sh'), 'utf8');
  assert.strictEqual(dernierFiltre(sh), 'szh-attributs-sains',
    'szh-attributs-sains.lua n’est plus le dernier filtre de la chaîne : un filtre listé '
    + 'après lui pourrait de nouveau salir les attributs qu’il vient d’assainir');
});

// import-docx.sh est hors périmètre en écriture, donc pas de sonde dessus : on vérifie
// plutôt que dernierFiltre() SAIT détecter un filtre remonté trop tôt, sur une copie du
// script tenue en mémoire (le fichier réel n’est jamais touché).
test('filtres : le contrôle de position détecte un filtre remonté avant szh-attributs-sains.lua', () => {
  const sh = fs.readFileSync(path.join(RACINE, 'pipeline', 'import-docx.sh'), 'utf8');
  const avant = '--lua-filter="$PIPE/filters/szh-tabelle-reference.lua" \\\n'
    + '  --lua-filter="$PIPE/filters/szh-attributs-sains.lua" \\';
  const apres = '--lua-filter="$PIPE/filters/szh-attributs-sains.lua" \\\n'
    + '  --lua-filter="$PIPE/filters/szh-tabelle-reference.lua" \\';
  assert.ok(sh.indexOf(avant) !== -1,
    'le texte attendu a changé : la permutation d’essai ne porterait sur rien');
  const permute = sh.replace(avant, apres);
  assert.notStrictEqual(dernierFiltre(permute), 'szh-attributs-sains',
    'le contrôle de position ne voit pas un filtre remonté avant szh-attributs-sains.lua');
});

// Celui-ci garde le nombre de PAGES d'un livre FALC. Sans lui, chaque saut de ligne est
// posé deux fois — le `\` de l'import Word, puis le retour promu par hard_line_breaks — et
// l'ouvrage gagne un tiers de pages sans qu'aucun avertissement ne l'annonce.
test('filtres : les sauts uniques sont dans la chaîne du livre', () => {
  const mk = fs.readFileSync(path.join(RACINE, 'pipeline', 'profils', 'livre.mk'), 'utf8');
  assert.match(mk, /szh-sauts-uniques\.lua/,
    'szh-sauts-uniques.lua n’est plus dans FILTRES_CHAPITRE : les sauts redeviendront doubles');
});
