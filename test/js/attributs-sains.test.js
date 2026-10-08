// Vérifie que les filtres d'assainissement sont branchés dans les chaînes. Ce fichier tourne
// dans le job `contrats` de la CI, qui n'installe pas la chaîne PDF.
//
//   node --test test/js/attributs-sains.test.js
//
// Leur effet se vérifie avec pandoc dans test/filtres-pandoc.test.js (hors du glob
// `test/js/*.test.js`, lancé par le job `pdf-ua`).
//
// Un filtre débranché ne casse rien de visible : le livre sort, et le défaut ne se voit
// qu'une fois imprimé.
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

// Le filtre assainit ce que les filtres précédents ont posé : il doit être le dernier
// --lua-filter de la chaîne, sinon un filtre placé après lui salirait de nouveau les
// attributs.
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

// Vérifie que dernierFiltre() détecte un filtre mal placé, sur une copie permutée du script
// tenue en mémoire.
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

// Sans szh-sauts-uniques.lua, chaque saut de ligne d'un livre FALC est posé deux fois (le
// `\` de l'import Word, puis le retour promu par hard_line_breaks) et l'ouvrage gagne un
// tiers de pages sans avertissement.
test('filtres : les sauts uniques sont dans la chaîne du livre', () => {
  const chapitre = require('./chaines-filtres-lire').lireChaines().CHAINE_CHAPITRE;
  assert.ok(chapitre.includes('sauts-uniques'),
    'szh-sauts-uniques.lua n’est plus dans FILTRES_CHAPITRE : les sauts redeviendront doubles');
});
