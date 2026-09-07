// Fidélité de lib/yaml.js : ce que l'analyseur maison ne peut pas lire fidèlement doit se
// déclarer infidèle, et aucun sérialiseur ne doit réécrire par-dessus une clé qu'il n'a pas
// comprise. Chaque sonde reprend une construction YAML réelle mais hors de portée d'un
// analyseur ligne à ligne : scalaire de bloc, chaîne citée qui déborde sur deux lignes
// physiques, tabulation. Une clé non touchée par la construction douteuse continue de
// s'écrire normalement — le refus est ciblé, jamais un blocage de tout le fichier.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));

// ---- (a) scalaire de bloc | sur une clé d'ausgabe.yaml / buch.yaml ----

test('sonde (a) : scalaire de bloc « | » -> infidèle, écriture de CETTE clé refusée', () => {
  const SRC_A = 'title: |\n  Ligne un\n  Ligne deux\nlang: de\n';
  const r = yaml.analyserAusgabe(SRC_A);
  assert.ok(Array.isArray(r._infidele), '_infidele absent pour un scalaire de bloc');
  assert.ok(r._infidele.some((x) => x.cle === 'title'),
    'title non signalé infidèle : ' + JSON.stringify(r._infidele));
  assert.strictEqual(r.lang, 'de', 'une clé saine plus loin dans le fichier doit rester lisible');
  assert.throws(() => yaml.serialiserAusgabe(SRC_A, { title: 'Autre' }), /title/,
    'l’écriture de la clé infidèle doit être refusée, message nommant la clé');
  // Une clé SAINE du même fichier continue de s'écrire : le refus est ciblé.
  const sortie = yaml.serialiserAusgabe(SRC_A, { lang: 'fr' });
  assert.match(sortie, /^lang: fr$/m);
  assert.match(sortie, /^title: \|$/m, 'le scalaire de bloc doit rester intact si on ne le touche pas');
});

// ---- (b) chaîne citée qui déborde sur deux lignes physiques, en frontmatter ----

test('sonde (b) : chaîne citée sur deux lignes physiques en frontmatter -> infidèle', () => {
  const SRC_B = '---\ntitle: "Ligne1\nLigne2 et é"\n---\nCorps.\n';
  const partie = yaml.separerFrontmatter(SRC_B);
  const r = yaml.analyserFrontmatter(partie.fm);
  assert.ok(Array.isArray(r._infidele) && r._infidele.some((x) => x.cle === 'title'),
    'title non signalé infidèle : ' + JSON.stringify(r._infidele));
  assert.throws(() => yaml.serialiserFrontmatter(SRC_B, { title: 'Autre' }), /title/,
    'l’écriture de title doit être refusée, message nommant la clé');
});

// ---- (c) échappements \n \t \uXXXX \" \\ : décodés à la lecture, ré-encodés à l'écriture ----

test('sonde (c) : \\n \\t \\uXXXX \\" \\\\ décodés puis ré-encodés, sans doublement', () => {
  const SRC_C = '---\ntitle: "Ligne1\\nLigne2 \\u00e9te"\n---\nCorps.\n';
  const r1 = yaml.analyserFrontmatter(yaml.separerFrontmatter(SRC_C).fm);
  assert.strictEqual(r1.title, 'Ligne1\nLigne2 éte', 'décodage \\n / \\uXXXX incorrect à la lecture');
  assert.strictEqual(r1._infidele, undefined,
    'une chaîne échappée sur une seule ligne physique n’est pas une construction infidèle');

  // Premier aller-retour : réécrire la même valeur ne doit rien changer de mal.
  const sortie1 = yaml.serialiserFrontmatter(SRC_C, { title: r1.title });
  const r2 = yaml.analyserFrontmatter(yaml.separerFrontmatter(sortie1).fm);
  assert.strictEqual(r2.title, r1.title, 'la valeur diverge au premier aller-retour');

  // Second aller-retour : le bogue classique double un échappement déjà posé
  // (\ -> \\ -> \\\\...) ; ici la valeur ET la représentation textuelle doivent se stabiliser.
  const sortie2 = yaml.serialiserFrontmatter(sortie1, { title: r2.title });
  const r3 = yaml.analyserFrontmatter(yaml.separerFrontmatter(sortie2).fm);
  assert.strictEqual(r3.title, r1.title, 'la valeur double au second aller-retour');
  assert.strictEqual(sortie2, sortie1, 'la représentation textuelle ne s’est pas stabilisée');

  // Les quatre échappements d'un coup : antislash, guillemet, tabulation, saut de ligne.
  const brut = 'a\\b "c" \td\ne';
  const s = yaml.serialiserFrontmatter('---\ntitle: "x"\n---\n', { title: brut });
  const relu = yaml.analyserFrontmatter(yaml.separerFrontmatter(s).fm);
  assert.strictEqual(relu.title, brut,
    'aller-retour cassé sur antislash/guillemet/tabulation/saut de ligne');
});

// ---- (d) clé dupliquée : le dernier gagne, comme YAML ----

test('sonde (d) : le dernier gagne comme YAML, et la réécriture ne laisse qu’une occurrence', () => {
  const SRC_D = 'lang: fr\nnumero: 1\nlang: de\n';
  const r = yaml.analyserAusgabe(SRC_D);
  assert.strictEqual(r.lang, 'de', 'la clé dupliquée doit lire la DERNIÈRE valeur, comme YAML');
  const sortie = yaml.serialiserAusgabe(SRC_D, { numero: '2' });
  assert.strictEqual((sortie.match(/^lang:/gm) || []).length, 1,
    'la réécriture laisse plus d’une occurrence de lang : ' + sortie);
  assert.match(sortie, /^lang: de$/m, 'la seule occurrence restante doit porter la dernière valeur');
  assert.match(sortie, /^numero: "2"$/m);
});

// ---- (e) liste en blocs, lue comme un tableau, réécrite en ligne ----

test('sonde (e) : une liste en blocs se lit comme un tableau, et se réécrit en ligne', () => {
  const SRC_E = 'ordre-articles:\n  - a\n  - b\n';
  const r = yaml.analyserAusgabe(SRC_E);
  assert.deepStrictEqual(r['ordre-articles'], ['a', 'b']);
  const sortie = yaml.serialiserAusgabe(SRC_E, { 'ordre-articles': r['ordre-articles'] });
  assert.match(sortie, /^ordre-articles: \["a", "b"\]$/m,
    'forme en ligne attendue par le Makefile absente : ' + sortie);
  assert.strictEqual(sortie.indexOf('- a'), -1, 'les lignes en blocs doivent disparaître après réécriture');
  assert.strictEqual(sortie.indexOf('- b'), -1);
});

test('listeYamlEnLigne lit un flux à guillemets sans casser un jeton à espace', () => {
  assert.deepStrictEqual(yaml.listeYamlEnLigne('["a b", "c"]'), ['a b', 'c']);
});

// ---- (f) fiche .meta.yaml avec BOM : déjà corrigé, on garde le test ----

test('sonde (f) : la fiche .meta.yaml avec BOM se lit malgré tout', () => {
  const SRC_F = '\uFEFF' + 'type: article\nlang: fr\n';
  const r = yaml.analyserMeta(SRC_F);
  assert.strictEqual(r.type, 'article', 'le BOM fait perdre la première clé de la fiche');
  assert.strictEqual(r.lang, 'fr');
});

// ---- (g) indentation par tabulation ----

test('sonde (g) : indentation par tabulation sous un bloc -> infidèle', () => {
  const SRC_G = 'impression:\n\tgrammage: 90\n';
  const r = yaml.analyserAusgabe(SRC_G);
  assert.ok(Array.isArray(r._infidele) && r._infidele.some((x) => x.cle === 'impression.grammage'),
    'impression.grammage non signalé infidèle : ' + JSON.stringify(r._infidele));
  assert.throws(() => yaml.serialiserAusgabe(SRC_G, { 'impression.grammage': '150' }),
    /impression\.grammage/, 'l’écriture doit être refusée, message nommant la clé');
});

// ---- Le contrat vaut pour les trois sérialiseurs, pas seulement pour ausgabe.yaml ----

test('tout sérialiseur refuse d’écrire : serialiserMeta lève si _infidele porte des entrées', () => {
  const SRC = 'type: |\n  article\nlang: fr\n';
  const meta = yaml.analyserMeta(SRC);
  assert.ok(Array.isArray(meta._infidele) && meta._infidele.length > 0,
    'type non signalé infidèle dans une fiche : ' + JSON.stringify(meta._infidele));
  assert.throws(() => yaml.serialiserMeta(meta), /type/);
});
