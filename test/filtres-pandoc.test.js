// Ce que les filtres Lua font vraiment, en faisant tourner pandoc.
//
//   node --test test/filtres-pandoc.test.js
//
// ⚠ CE FICHIER EST HORS DU GLOB `test/js/*.test.js`, ET C'EST VOULU. Le job `contrats` de
//   la CI n'installe pas la chaîne PDF — c'est sa raison d'être, il doit rendre son verdict
//   sans attendre. Ces contrôles-ci demandent pandoc : ils sont lancés par le job `pdf-ua`,
//   qui l'a déjà. Déplacer ce fichier sous test/js/ ferait échouer `contrats`.
//
// Aucun de ces contrôles ne s'abstient : si pandoc manque, ils ÉCHOUENT. Un test qui se
// neutralise tout seul ne protège rien.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');

function pandoc(entree, options) {
  const o = options || {};
  const args = ['--from=' + (o.de || 'html'), '--to=' + (o.vers || 'markdown'), '--wrap=none'];
  for (const f of (o.filtres || [])) { args.push('--lua-filter=' + path.join(FILTRES, f)); }
  const r = spawnSync('pandoc', args, { input: entree, encoding: 'utf8' });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  if (r.status !== 0) { throw new Error('pandoc a échoué : ' + r.stderr); }
  return r.stdout;
}

// ── Assainissement des attributs ───────────────────────────────────────────────────────
// Le lecteur docx pose le nom du style Word en classe : « Titre 2 (small) » devient
// `Titre-2-(small)`, que la syntaxe d'attributs de pandoc n'admet pas. Le bloc entier est
// alors abandonné à la relecture et s'imprime en toutes lettres.
//
// ⚠ On passe par le lecteur HTML, et non par un markdown écrit à la main : il range la
//   classe dans `el.classes`, exactement comme le lecteur docx. Un essai écrit en markdown
//   avec `class="…"` remplirait `el.attributes`, qui est une AUTRE table — et un filtre
//   fautif, lisant `attributes`, passerait l'essai sans rien corriger. C'est arrivé.
const TITRE_FAUTIF = '<h2 id="qui-a-fait-ce-livre" class="Titre-2-(small)">Qui ?</h2>';

test('attributs : le défaut existe bien sans le filtre', () => {
  assert.match(pandoc(TITRE_FAUTIF), /\(small\)/,
    'pandoc n’écrit plus la parenthèse : le défaut a changé de forme, revoir le filtre');
});

test('attributs : plus une parenthèse dans un bloc d’attributs, filtre appliqué', () => {
  const md = pandoc(TITRE_FAUTIF, { filtres: ['szh-attributs-sains.lua'] });
  const blocs = md.match(/\{[^}]*\}/g) || [];
  assert.ok(blocs.length, 'aucun bloc d’attributs : le contrôle ne prouverait rien');
  for (const bloc of blocs) {
    assert.ok(!/[()]/.test(bloc), 'une parenthèse subsiste dans ' + bloc);
  }
  assert.match(md, /\.Titre-2-small/, 'la classe n’a pas été normalisée : ' + md);
});

test('attributs : les lettres accentuées survivent', () => {
  const md = pandoc('<h2 id="ce-livre-a-été-mis-en-page-par" class="Titre-2-(small)">Été</h2>',
                    { filtres: ['szh-attributs-sains.lua'] });
  assert.match(md, /#ce-livre-a-été-mis-en-page-par/,
    'l’identifiant accentué a été abîmé alors que pandoc le relit sans peine : ' + md);
});

test('attributs : un lien interne suit l’identifiant renommé', () => {
  const md = pandoc('<p><a href="#section-(1)">voir</a></p><h2 id="section-(1)">Section</h2>',
                    { filtres: ['szh-attributs-sains.lua'] });
  assert.ok(!/#section-\(1\)/.test(md), 'le lien vise encore l’ancien identifiant : ' + md);
  assert.match(md, /#section-1/, 'le lien ne suit pas le renommage : ' + md);
});

// ── Sauts de ligne uniques ─────────────────────────────────────────────────────────────
// La maquette FALC lit en `markdown+hard_line_breaks` — en facile à lire, le retour à la
// ligne porte du sens. Mais l'import Word écrit AUSSI un `\` en fin de ligne : pandoc compte
// alors deux sauts, et le texte sort à double interligne. Sur un ouvrage réel, 282 des 570
// sauts étaient doubles et le livre faisait 64 pages contre 46 à l'édition d'origine.
const FALC = 'Première ligne.\\\nDeuxième ligne.\\\nTroisième ligne.\n';

test('sauts : sans le filtre, le `\\` et hard_line_breaks se cumulent', () => {
  const html = pandoc(FALC, { de: 'markdown+hard_line_breaks', vers: 'html' });
  assert.match(html, /<br\s*\/?>\s*<br\s*\/?>/,
    'le doublement ne se reproduit plus : pandoc a changé, revoir le filtre — ' + html);
});

test('sauts : avec le filtre, jamais deux sauts consécutifs', () => {
  const html = pandoc(FALC, { de: 'markdown+hard_line_breaks', vers: 'html',
                              filtres: ['szh-sauts-uniques.lua'] });
  assert.ok(!/<br\s*\/?>\s*<br\s*\/?>/.test(html), 'un saut double subsiste : ' + html);
  // Trois lignes, donc deux sauts : ni plus — ce serait le défaut — ni moins, ce qui
  // recollerait les phrases et détruirait la règle « une phrase, une ligne ».
  assert.equal((html.match(/<br\s*\/?>/g) || []).length, 2,
    'le compte de sauts n’est pas celui des lignes : ' + html);
});
