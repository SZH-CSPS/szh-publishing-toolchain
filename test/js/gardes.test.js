// Le module gardes.js DOIT faire échouer un test dont l'outil est déclaré obligatoire et
// absent, jamais le sauter. Le mécanisme réel (échec au chargement du module, sur le poste
// de Robin, pour un vrai outil manquant) ne se simule pas ici sans PATH tronqué — ce fichier
// éprouve donc directement la fonction `exiger`, sur un nom de variable et un motif
// fictifs, pour prouver que « obligatoire + absent » lève et que les deux autres cas non.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gardes = require('./gardes');

const VARIABLE_FICTIVE = 'SZH_TEST_GARDES_FICTIF_OBLIGATOIRE';

test.afterEach(() => { delete process.env[VARIABLE_FICTIVE]; });

test('outil obligatoire et absent : exiger() lève, ne rend pas un skip', () => {
  process.env[VARIABLE_FICTIVE] = '1';
  assert.throws(() => gardes.exiger(VARIABLE_FICTIVE, 'outil fictif introuvable'),
    /outil fictif introuvable/);
});

test('outil obligatoire mais présent (motif faux) : exiger() ne lève pas', () => {
  process.env[VARIABLE_FICTIVE] = '1';
  assert.strictEqual(gardes.exiger(VARIABLE_FICTIVE, false), false);
});

test('outil absent mais pas déclaré obligatoire : exiger() rend le motif tel quel (skip normal)', () => {
  assert.strictEqual(gardes.exiger(VARIABLE_FICTIVE, 'outil fictif introuvable'),
    'outil fictif introuvable');
});

test('les quatre détections rendent une forme utilisable en { skip: … }', () => {
  for (const [nom, valeur] of Object.entries({
    sansPowerShell: gardes.sansPowerShell, sansPython: gardes.sansPython,
    sansPandocWsl: gardes.sansPandocWsl, sansPandoc: gardes.sansPandoc
  })) {
    assert.ok(valeur === false || typeof valeur === 'string',
      nom + ' doit être `false` ou une chaîne de motif, pas : ' + JSON.stringify(valeur));
  }
  assert.strictEqual(typeof gardes.POWERSHELL, 'string');
  assert.strictEqual(typeof gardes.PYTHON, 'string');
});
