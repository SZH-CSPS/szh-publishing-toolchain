// Les tests Python de la couverture des livres (test/couverture-*.test.py) : dos, décalage
// de l'illustration, modèles. Chacun tourne dans son processus python3, comme à la main.
//
//   node --test test/js/couverture-livre.test.js
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
