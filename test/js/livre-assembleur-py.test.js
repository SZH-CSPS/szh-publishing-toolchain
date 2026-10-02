// Les tests Python de l'assembleur du livre (test/livre-assembler.test.py) : sommaire,
// couleur et case de l'index à pouce, numéro de sommaire, lecture de `sommaire: non`. Ils
// tournent dans leur processus python3, comme à la main ; ils appellent pandoc.
//
//   node --test test/js/livre-assembleur-py.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { pythonGroupe, sansPython, sansPandoc } = require('./gardes');

test('livre-assembler.test.py', { skip: sansPython || sansPandoc }, () => {
  const r = pythonGroupe([path.join(__dirname, '..', 'livre-assembler.test.py')], { timeout: 120000 });
  assert.strictEqual(r.status, 0, String(r.stdout || '') + String(r.stderr || ''));
});
