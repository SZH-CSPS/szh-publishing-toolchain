// lib/webviews/util.js : construireHtml() assemble une webview à partir de fragments
// statiques, et injecte deux choses fournies par l'hôte — `remplacements` (du JSON, posé
// tel quel dans le <script>) et `titre` (du texte, posé tel quel dans le <title>). Aucune
// des deux ne doit pouvoir casser le document qui les porte.
//
//   node --test "test/js/*.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const util = require(path.join(COCKPIT, 'lib', 'webviews', 'util.js'));

// __TXT__ est le marqueur réel de media/settings.js (`const TXT = __TXT__;`) : ce test
// rejoue l'assemblage tel qu'extension.js le fait, pas un marqueur inventé qui n'apparaîtrait
// nulle part dans le fragment.
test('construireHtml : un remplacement JSON contenant « </script> » ne referme jamais la balise', () => {
  const donnee = JSON.stringify({ texte: '</script><script>alert(1)</script>' });
  const html = util.construireHtml('settings', 'abc123', {
    cssPartage: ['_design.css'],
    remplacements: { '__TXT__': donnee }
  });
  const balises = (html.match(/<\/?script\b[^>]*>/gi) || []);
  // Un seul <script ...> d'ouverture (celui que construireHtml pose lui-même) et une
  // seule fermeture : si la donnée avait refermé la balise, il y en aurait quatre.
  assert.strictEqual(balises.length, 2,
    'le document ne doit porter qu’une seule balise <script> ouvrante et une fermante : ' + JSON.stringify(balises));
  assert.ok(html.indexOf('\\u003c/script>') !== -1,
    'le "<" de "</script>" dans la donnée JSON doit être échappé en \\u003c, pas laissé tel quel');
  assert.ok(html.indexOf('</script><script>alert') === -1,
    'la balise <script> a été refermée par la donnée injectée');
});

test('construireHtml : un remplacement JSON sans "<" traverse sans y toucher', () => {
  const donnee = JSON.stringify({ texte: 'Bonjour, ceci est un texte normal.' });
  const html = util.construireHtml('settings', 'abc123', {
    cssPartage: ['_design.css'],
    remplacements: { '__TXT__': donnee }
  });
  assert.ok(html.indexOf('Bonjour, ceci est un texte normal.') !== -1,
    'un remplacement inoffensif ne doit pas être altéré');
});

test('construireHtml : le titre est échappé en HTML', () => {
  const html = util.construireHtml('settings', 'abc123', {
    cssPartage: ['_design.css'],
    titre: '<script>alert(1)</script> & "citation"'
  });
  assert.match(html, /<title>&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; "citation"<\/title>/,
    'le titre doit être échappé (&lt;, &gt;, &amp;), jamais posé tel quel dans le <title>');
  assert.ok(html.indexOf('<title><script>') === -1, 'le titre n’est pas échappé : injection possible');
});

test('construireHtml : un titre ordinaire n’est pas défiguré par l’échappement', () => {
  const html = util.construireHtml('settings', 'abc123', { cssPartage: ['_design.css'], titre: 'Réglages' });
  assert.match(html, /<title>Réglages<\/title>/);
});
