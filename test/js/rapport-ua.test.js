// pipeline/rapport-ua.py : ce qu'une règle PDF/UA dit à la rédaction, et ce qui reste au
// journal pour qui corrige la chaîne. Lancé dans la WSL (gardes.js), sur un rapport veraPDF
// réduit à l'essentiel.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { python, sansPython } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const RAPPORT_UA = path.join(RACINE, 'pipeline', 'rapport-ua.py');
const { verdictsPdfUa, analyserJournal } = require(path.join(RACINE, 'vscodium-extension',
  'szh-cockpit', 'lib', 'journal.js'));
const constats = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'constats.js'));

// Les règles en échec d'un seul PDF, au format XML de veraPDF.
function rapportVeraPdf(regles) {
  const r = regles.map(([clause, numero]) => '<rule clause="' + clause + '" testNumber="' + numero
    + '" failedChecks="1"><description>x</description><check><context>root/document[0]/pages[1]</context></check></rule>');
  return '<report><jobs><job><item><name>/x/03-massie.pdf</name></item>'
    + '<validationReport isCompliant="false"><details>' + r.join('') + '</details>'
    + '</validationReport></job></jobs></report>';
}

function traduire(regles) {
  const r = python([RAPPORT_UA], { input: rapportVeraPdf(regles) });
  assert.strictEqual(r.status, 1, 'un PDF non conforme rend 1 : ' + r.stderr);
  return r.stdout;
}

// Les règles qui relèvent de la chaîne, et non de l'article.
const CHAINE = [['7.1', '3'], ['7.1', '10'], ['7.18.3', '1'], ['7.18.5', '1'], ['7.18.5', '2'],
  ['7.18.1', '2'], ['7.20', '2'], ['7.21.4.1', '1'], ['7.21.4.1', '2'], ['7.21.7', '1'],
  ['5', '1'], ['6.2', '1'], ['7.1', '11']];
const TECHNIQUE = /opacity|print\.css|XObject|MarkInfo|XMP|DisplayDocTitle|szh-article\.html|U\+202F|span, svg/;

test('règle de la chaîne : une cause côté rédaction, le détail technique au journal seulement', { skip: sansPython }, () => {
  const sortie = traduire(CHAINE);
  const [verdict] = verdictsPdfUa(sortie);
  assert.strictEqual(verdict.details.fr.length, CHAINE.length);
  for (const langue of ['fr', 'de']) {
    for (const r of verdict.details[langue]) {
      const cause = constats.decouperExplication(r.explication).cause;
      assert.ok(!TECHNIQUE.test(r.explication), 'du jargon dans l’infobulle (' + r.repere + ', '
        + langue + ') : ' + r.explication);
      assert.strictEqual((cause.match(/[.!?](\s|$)/g) || []).length, 1,
        'la cause tient en une phrase (' + r.repere + ', ' + langue + ') : ' + cause);
    }
  }
  // Le détail reste dans la sortie, donc dans le journal d'un export.
  assert.match(sortie, /\[pdf-ua\]   Détail technique : /);
  assert.match(sortie, /\[pdf-ua\] \[de\]   Technisches Detail: /);
  assert.match(sortie, /opacity/);
  // Et le journal relu par le cockpit ne le mêle à aucune carte.
  for (const c of analyserJournal(sortie, 'fr').filter((x) => x.code === 'regle')) {
    assert.ok(!TECHNIQUE.test(c.champs.explication), 'le détail a rejoint la carte : ' + c.champs.explication);
  }
});

test('règle 7.4.2-1 : le geste nomme le menu qui corrige', { skip: sansPython }, () => {
  const [verdict] = verdictsPdfUa(traduire([['7.4.2', '1']]));
  const plat = (s) => s.replace(/\s+/g, ' ');
  assert.strictEqual(plat(constats.decouperExplication(verdict.details.fr[0].explication).geste),
    'Un titre saute un niveau (un « Titre 3 » juste après un « Titre 1 »). Placez le curseur '
    + 'dessus et choisissez Mise en forme → Titre 2.');
  assert.match(constats.decouperExplication(verdict.details.de[0].explication).geste, /Überschrift 2\.$/);
});
