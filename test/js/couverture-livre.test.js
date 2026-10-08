// Lance les tests Python de la couverture des livres (test/couverture-*.test.py), chacun
// dans son propre processus.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { python, sansPython } = require('./gardes');

const TEST = path.join(__dirname, '..');

for (const nom of ['couverture-dos.test.py', 'couverture-illustration.test.py',
  'couverture-modele.test.py']) {
  test(nom, { skip: sansPython }, () => {
    const r = python([path.join(TEST, nom)], { timeout: 120000 });
    assert.strictEqual(r.status, 0, String(r.stdout || '') + String(r.stderr || ''));
  });
}
