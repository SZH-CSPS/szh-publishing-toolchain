// Accessibilité des sorties du livre (test/livre-accessibilite.test.py) : identifiants
// préfixés par chapitre, sommaire imbriqué, repères du HTML web, tableaux et navigation de
// l'EPUB. Les tests tournent dans leur processus python3 ; la chaîne EPUB appelle pandoc.
//
//   node --test test/js/livre-accessibilite.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { pythonGroupe, sansPython, sansPandoc } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');

test('livre-accessibilite.test.py', { skip: sansPython || sansPandoc }, () => {
  const r = pythonGroupe([path.join(RACINE, 'test', 'livre-accessibilite.test.py')], { timeout: 120000 });
  assert.strictEqual(r.status, 0, String(r.stdout || '') + String(r.stderr || ''));
});

test('web.css : en mode sombre, les fonds de tableau sont redéfinis', () => {
  const css = fs.readFileSync(path.join(RACINE, 'pipeline', 'styles', 'livre', 'web.css'), 'utf8');
  const sombre = css.match(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}/);
  assert.ok(sombre, 'bloc sombre introuvable');
  assert.match(sombre[0], /--web-tableau-tete:/);
  assert.match(sombre[0], /--web-tableau-zebre:/);
  // Les règles de tableau lisent ces jetons, et non l'accent clair du PDF directement.
  assert.match(css, /\.szh-tableau thead th \{ background: var\(--web-tableau-tete\); \}/);
  assert.match(css, /\.szh-tableau tbody tr:nth-child\(even\) \{ background: var\(--web-tableau-zebre\); \}/);
});

test('web.css : le lien de retour à l’appel a une cible de 24 px et un focus visible', () => {
  const css = fs.readFileSync(path.join(RACINE, 'pipeline', 'styles', 'livre', 'web.css'), 'utf8');
  const regle = css.match(/a\.szh-retour-appel \{([^}]*)\}/);
  assert.ok(regle, 'règle a.szh-retour-appel introuvable');
  assert.match(regle[1], /width: 24px/);
  assert.match(regle[1], /height: 24px/);
  assert.match(css, /a\.szh-retour-appel:focus-visible \{ outline: 2px solid/);
});

test('livre.mk : le HTML web part des fragments sans szh-notes, en mode --web', () => {
  const mk = fs.readFileSync(path.join(RACINE, 'pipeline', 'profils', 'livre.mk'), 'utf8');
  const recette = mk.match(/\$\(LIVRE_WEB_HTML\):[\s\S]*?\n\n/);
  assert.ok(recette, 'recette du HTML web introuvable');
  assert.match(recette[0], /--web/);
  assert.match(recette[0], /\$\(FRAGMENTS_EPUB\)\s*$/);
  const epub = mk.match(/\$\(LIVRE_EPUB\):[\s\S]*?\n\n/);
  assert.match(epub[0], /--lua-filter="\$\(EPUB_BRUT\)"/);
  assert.match(epub[0], /python3 "\$\(EPUB_FINIR\)" "\$@"/);
});
