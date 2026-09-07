// Le moteur de gabarits (lib/gabarits.js) : un cas par construction reconnue, et les
// erreurs qui doivent porter le nom du gabarit et le numéro de ligne.
//
//   node --test test/js/gabarits.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const { compiler, rendre } = require(path.join(COCKPIT, 'lib', 'gabarits'));

function corps(source, variables) {
  return rendre('{% block b %}' + source + '{% endblock %}', variables, 't').b;
}

test('variable simple', () => {
  assert.equal(corps('{{ x }}', { x: 'ohé' }), 'ohé');
});

test('chemin de variable a.b.c', () => {
  assert.equal(corps('{{ a.b.c }}', { a: { b: { c: 'trouvé' } } }), 'trouvé');
});

test('variable absente -> chaîne vide', () => {
  assert.equal(corps('{{ inconnue }}', {}), '');
  assert.equal(corps('{{ a.b.c }}', { a: {} }), '');
});

test('littéraux : chaîne, nombre, booléen, null', () => {
  assert.equal(corps("{{ 'x' }}"), 'x');
  assert.equal(corps('{{ 3 }}'), '3');
  assert.equal(corps('{{ true }}'), '1');
  assert.equal(corps('{{ false }}'), '');
  assert.equal(corps('{{ null }}'), '');
});

test('filtre default', () => {
  assert.equal(corps("{{ x|default('repli') }}", { x: '' }), 'repli');
  assert.equal(corps("{{ x|default('repli') }}", { x: 'là' }), 'là');
  assert.equal(corps("{{ x|default('repli') }}", {}), 'repli');
});

test('filtre upper / lower', () => {
  assert.equal(corps('{{ x|upper }}', { x: 'abc' }), 'ABC');
  assert.equal(corps('{{ x|lower }}', { x: 'ABC' }), 'abc');
});

test('filtre trim', () => {
  assert.equal(corps('{{ x|trim }}', { x: '  ab  ' }), 'ab');
});

test('filtre capitalize', () => {
  assert.equal(corps('{{ x|capitalize }}', { x: 'bonJOUR' }), 'Bonjour');
});

test('filtre join', () => {
  assert.equal(corps("{{ x|join(', ') }}", { x: ['a', 'b', 'c'] }), 'a, b, c');
  assert.equal(corps('{{ x|join }}', { x: ['a', 'b'] }), 'ab');
});

test('filtre length', () => {
  assert.equal(corps('{{ x|length }}', { x: ['a', 'b', 'c'] }), '3');
  assert.equal(corps('{{ x|length }}', { x: 'abcd' }), '4');
});

test('filtre first / last', () => {
  assert.equal(corps('{{ x|first }}', { x: ['a', 'b', 'c'] }), 'a');
  assert.equal(corps('{{ x|last }}', { x: ['a', 'b', 'c'] }), 'c');
});

test('filtres chaînés', () => {
  assert.equal(corps('{{ x|trim|upper }}', { x: '  ab  ' }), 'AB');
});

test('if / else', () => {
  assert.equal(corps('{% if x %}A{% else %}B{% endif %}', { x: true }), 'A');
  assert.equal(corps('{% if x %}A{% else %}B{% endif %}', { x: false }), 'B');
});

test('if / elseif / else', () => {
  const src = '{% if x == 1 %}un{% elseif x == 2 %}deux{% else %}autre{% endif %}';
  assert.equal(corps(src, { x: 1 }), 'un');
  assert.equal(corps(src, { x: 2 }), 'deux');
  assert.equal(corps(src, { x: 3 }), 'autre');
});

test('condition : not, and, or, et leur priorité', () => {
  assert.equal(corps('{% if not x %}oui{% else %}non{% endif %}', { x: false }), 'oui');
  assert.equal(corps('{% if a and b %}oui{% else %}non{% endif %}', { a: true, b: false }), 'non');
  assert.equal(corps('{% if a or b %}oui{% else %}non{% endif %}', { a: false, b: true }), 'oui');
  // not > and > or : « not a and b » lie (not a) et b, pas not (a and b).
  assert.equal(corps('{% if not a and b %}oui{% else %}non{% endif %}', { a: false, b: true }), 'oui');
  // « a or b and c » lie (b and c), pas (a or b) and c.
  assert.equal(corps('{% if a or b and c %}oui{% else %}non{% endif %}', { a: false, b: true, c: false }), 'non');
});

test('condition : is empty / is not empty', () => {
  assert.equal(corps('{% if x is empty %}vide{% else %}plein{% endif %}', { x: '' }), 'vide');
  assert.equal(corps('{% if x is empty %}vide{% else %}plein{% endif %}', { x: [] }), 'vide');
  assert.equal(corps('{% if x is not empty %}plein{% else %}vide{% endif %}', { x: 'a' }), 'plein');
});

test('condition : is defined', () => {
  assert.equal(corps('{% if x is defined %}oui{% else %}non{% endif %}', { x: 'a' }), 'oui');
  assert.equal(corps('{% if x is defined %}oui{% else %}non{% endif %}', {}), 'non');
});

test('condition : == et !=', () => {
  assert.equal(corps("{% if x == 'a' %}oui{% else %}non{% endif %}", { x: 'a' }), 'oui');
  assert.equal(corps("{% if x != 'a' %}oui{% else %}non{% endif %}", { x: 'b' }), 'oui');
});

test('for sur une liste, avec loop.*', () => {
  const src = '{% for x in items %}{{ loop.index }}:{{ loop.index0 }}:{{ x }}' +
    '{% if not loop.last %},{% endif %}{% endfor %}';
  assert.equal(corps(src, { items: ['a', 'b'] }), '1:0:a,2:1:b');
});

test('for : loop.first, loop.last, loop.length', () => {
  const src = '{% for x in items %}{% if loop.first %}[{% endif %}{{ x }}' +
    '{% if loop.last %}]({{ loop.length }}){% endif %}{% endfor %}';
  assert.equal(corps(src, { items: ['a', 'b', 'c'] }), '[abc](3)');
});

test('for : else sur une liste vide', () => {
  assert.equal(corps('{% for x in items %}{{ x }}{% else %}rien{% endfor %}', { items: [] }), 'rien');
  assert.equal(corps('{% for x in items %}{{ x }}{% else %}rien{% endfor %}', {}), 'rien');
});

test('set', () => {
  assert.equal(corps("{% set y = 'valeur' %}{{ y }}"), 'valeur');
  assert.equal(corps('{% set y = x|upper %}{{ y }}', { x: 'ab' }), 'AB');
});

test('commentaire : retiré du rendu', () => {
  assert.equal(corps('avant{# ceci disparaît #}après'), 'avantaprès');
});

test('blocs : rendre() rend un objet {nom: texte}, le texte hors bloc est ignoré', () => {
  const blocs = rendre('hors bloc{% block a %}A{% endblock %}entre deux{% block b %}B{% endblock %}', {}, 't');
  assert.deepEqual(blocs, { a: 'A', b: 'B' });
});

test('contrôle des blancs : {%- et -%} mangent les blancs voisins, retours à la ligne compris', () => {
  const src = '{% block b %}\n  {%- if x -%}\n  A\n  {%- endif -%}\n{% endblock %}';
  assert.equal(rendre(src, { x: true }, 't').b, 'A');
});

test('fins de ligne CRLF normalisées', () => {
  const src = '{% block b %}\r\nligne1\r\nligne2\r\n{% endblock %}';
  assert.equal(rendre(src, {}, 't').b, '\nligne1\nligne2\n');
});

test('erreur : bloc non fermé porte le nom et la ligne', () => {
  assert.throws(() => compiler('a\nb\n{% if x %}\nc', 'mongabarit'), (e) => {
    assert.match(e.message, /mongabarit/);
    assert.match(e.message, /ligne 3/);
    return true;
  });
});

test('erreur : tag inconnu porte le nom et la ligne', () => {
  assert.throws(() => compiler('a\n{% zorglub %}', 'mongabarit'), (e) => {
    assert.match(e.message, /mongabarit/);
    assert.match(e.message, /ligne 2/);
    assert.match(e.message, /zorglub/);
    return true;
  });
});

test('erreur : filtre inconnu porte le nom et la ligne', () => {
  assert.throws(() => compiler('{{ x|inexistant }}', 'mongabarit'), (e) => {
    assert.match(e.message, /mongabarit/);
    assert.match(e.message, /ligne 1/);
    assert.match(e.message, /inexistant/);
    return true;
  });
});

test('rendre() : raccourci de compiler(...).rendre(...)', () => {
  assert.deepEqual(rendre('{% block x %}{{ a }}{% endblock %}', { a: 'v' }, 't'), { x: 'v' });
});
