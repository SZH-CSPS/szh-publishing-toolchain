// Les tests Python des moissonneurs (moissonneurs/**/tests) : créneau, budget, état partagé,
// événements pronto-moisson/1, recherche et parlement, hors réseau. Un seul processus python3,
// lancé depuis moissonneurs/ avec -B, comme dans le toolkit.
//
//   node --test test/js/moissonneurs.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pythonGroupe, sansPython } = require('./gardes');

const DOSSIER = path.join(__dirname, '..', '..', 'moissonneurs');

// Les dossiers __pycache__ présents avant le lancement, pour prouver que -B n'en écrit aucun.
function caches(dossier) {
  const res = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) { if (e.name === '__pycache__') { res.push(p); } else { res.push(...caches(p)); } }
  }
  return res;
}

test('moissonneurs : unittest discover, hors réseau, sans __pycache__', { skip: sansPython }, (t) => {
  const avant = new Set(caches(DOSSIER));
  const r = pythonGroupe(['-B', '-m', 'unittest', 'discover', '-s', '.', '-t', '.'],
    { cwd: DOSSIER, timeout: 280000, env: Object.assign({}, process.env, { PYTHONDONTWRITEBYTECODE: '1' }) });
  const sortie = String(r.stdout || '') + String(r.stderr || '');
  const compte = sortie.match(/Ran \d+ tests? in [\d.]+s/);
  if (compte) { t.diagnostic(compte[0]); }
  assert.strictEqual(r.status, 0, sortie.slice(-6000));
  assert.match(sortie, /\nOK( \(skipped=\d+\))?\s*$/, 'le rapport de unittest ne finit pas sur OK');
  const nouveaux = caches(DOSSIER).filter((c) => !avant.has(c));
  assert.deepStrictEqual(nouveaux, [], 'des __pycache__ sont apparus malgré -B');
});
