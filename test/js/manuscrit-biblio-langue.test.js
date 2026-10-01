// pipeline/manuscrit_biblio.py — déterminisme du jeton annoncé et langue des messages.
//
//   node --test test/js/manuscrit-biblio-langue.test.js
//
// Module pur, appelé par le Python de Windows (PYTHON de gardes.js), sans réseau.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython } = require('./gardes');

const PIPELINE = path.resolve(__dirname, '..', '..', 'pipeline');

function executer(corps, graine) {
  const programme = [
    'import sys, json',
    'sys.path.insert(0, ' + JSON.stringify(PIPELINE) + ')',
    'import manuscrit_biblio as mb',
    corps,
  ].join('\n');
  const r = cp.spawnSync(PYTHON, ['-c', programme], {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' },
      graine === undefined ? {} : { PYTHONHASHSEED: String(graine) }),
  });
  assert.strictEqual(r.status, 0, 'le script Python a échoué : ' + r.stderr);
  return JSON.parse(r.stdout);
}

test('_jeton_manquant : le premier jeton absent dans l\'ordre du texte, quelle que soit '
  + 'PYTHONHASHSEED', { skip: sansPython }, () => {
  const corps = [
    'orig = "Schalock, R. L., & Braddock, D. (2010). Intellectual disability. Washington."',
    'print(json.dumps(mb._jeton_manquant(orig, "Intellectual disability.")))',
  ].join('\n');
  const vus = new Set();
  for (const graine of [0, 1, 2, 3, 4, 5, 6, 7]) {
    const jeton = executer(corps, graine);
    assert.strictEqual(jeton, 'schalock', 'graine ' + graine);
    vus.add(jeton);
  }
  assert.strictEqual(vus.size, 1);
});
