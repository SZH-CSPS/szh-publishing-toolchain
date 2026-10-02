// pipeline/livre-epub-prepare.py : ce que le HTML du livre doit devenir avant que pandoc le
// découpe aux <h1> (--split-level=1). Tout ce qui précède un <h1> tombe dans le fichier du
// chapitre d'avant : la ligne d'auteur·e·s placée au-dessus du titre, l'enveloppe d'une
// partie.
//
//   node --test test/js/livre-epub-prepare.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gardes = require('./gardes');
const { sansPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const PREPARE = path.join(RACINE, 'pipeline', 'livre-epub-prepare.py');

// Fait passer le HTML par prepare_for_epub(), la fonction que la cible livre-epub appelle.
function preparer(html) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-epub-prep-'));
  try {
    const entree = path.join(d, 'livre.html');
    const sortie = path.join(d, 'livre-epub.html');
    fs.writeFileSync(entree, html, 'utf8');
    const r = gardes.pythonGroupe([PREPARE, entree, sortie],
      { env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }) });
    assert.strictEqual(r.status, 0, String(r.stderr || ''));
    return fs.readFileSync(sortie, 'utf8');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

function chapitre(slug, avant, apres) {
  return '<section class="szh-chapitre" id="ch-' + slug + '" data-rang="1">\n'
    + '<div class="szh-onglet" aria-hidden="true"></div>\n'
    + '<div class="szh-pastille" aria-hidden="true">1</div>\n'
    + '<div class="szh-picto-entete" data-picto aria-hidden="true"></div>\n'
    + avant + '<h1 id="' + slug + '-titre">Titre ' + slug + '</h1>\n' + apres
    + '<p>Texte.</p>\n</section>\n';
}

test('epub : une ligne d’auteur·e·s au-dessus du titre passe juste après lui', { skip: sansPython }, () => {
  const html = preparer('<body>\n' + chapitre('eins', '<p class="szh-auteurs">Lea Beispiel</p>\n', '')
    + chapitre('zwei', '<div class="szh-auteurs">\n<p>Noah Probe</p>\n</div>\n', '') + '</body>');
  assert.match(html, /<h1 id="eins-titre">Titre eins<\/h1>\s*<p class="szh-auteurs">Lea Beispiel<\/p>/, html);
  assert.match(html, /<h1 id="zwei-titre">Titre zwei<\/h1>\s*<div class="szh-auteurs">\s*<p>Noah Probe<\/p>\s*<\/div>/, html);
  // Rien ne reste entre deux chapitres : le premier <h1> ouvre chaque document.
  assert.doesNotMatch(html, /Texte\.<\/p>\s*<(p|div) class="szh-auteurs"/, html);
});

test('epub : l’enveloppe d’une partie est retirée, son titre devient un <h1> de premier niveau', { skip: sansPython }, () => {
  const partie = '<section class="szh-partie" id="partie-1" data-page-seule="oui">\n'
    + '<h1 id="partie-1-titre" data-signet="Teil">Teil</h1>\n<p class="szh-partie-illustration"><img src="x.png" alt="" /></p>\n</section>\n';
  const html = preparer('<body>\n' + chapitre('eins', '', '') + partie
    + chapitre('zwei', '', '').replace('<section class="szh-chapitre"', '<section class="szh-chapitre" data-partie="1"') + '</body>');
  assert.doesNotMatch(html, /<section/, html);
  assert.match(html, /<p>Texte\.<\/p>\s*<h1 id="partie-1-titre"[^>]*>Teil<\/h1>\n<p class="szh-partie-illustration">/, html);
  assert.match(html, /<h1 id="zwei-titre">/, html);
});

test('epub : une ligne d’auteur·e·s déjà sous le titre ne bouge pas', { skip: sansPython }, () => {
  const source = '<body>\n' + chapitre('eins', '', '<p class="szh-auteurs">Lea Beispiel</p>\n') + '</body>';
  const html = preparer(source);
  assert.match(html, /<\/h1>\n<p class="szh-auteurs">Lea Beispiel<\/p>\n<p>Texte\.<\/p>/, html);
});
