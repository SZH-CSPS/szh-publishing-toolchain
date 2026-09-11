// Le plan de renumérotation : quel dossier prend quel nom, et dans quel ordre les bouger.
//
//   node --test "test/js/*.test.js"
//
// Le numéro qu'un article porte à l'écran vient de son rang dans l'ordre du numéro
// (ausgabe.yaml) ; le préfixe de son dossier, lui, est figé à l'import et n'a jamais été
// renommé. Les deux divergent donc dès le premier déplacement, et l'on cherche l'article 3
// dans l'explorateur pour tomber sur « 01- ».
//
// Ce module calcule le renommage qui les réaligne. Il est PUR : il ne touche pas au disque,
// il rend un plan. C'est ce qui permet de l'éprouver sur les cas qui font mal — le cycle,
// l'interruption, le dossier déjà en place — sans monter une arborescence à chaque fois.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const plan = require(path.join(COCKPIT, 'lib', 'renumerotation.js'));

// Un article tel que l'hôte le lira sur le disque : son dossier, et les fichiers posés
// directement dedans. media/ et tables/ sont des dossiers, ils ne sont pas listés ici — et
// c'est le fond de l'affaire : ce qu'ils contiennent est désigné en chemin relatif depuis
// le .md, et ne bouge donc pas.
function article(slug, extras) {
  return { slug: slug,
           fichiers: [slug + '.md', slug + '.meta.yaml'].concat(extras || []) };
}

// ---- 1. Le plan lui-même -----------------------------------------------------------

test('plan : un dossier déjà au bon rang n’est pas touché', () => {
  const p = plan.planRenumerotation(
    [article('01-edito'), article('02-inclusion')],
    ['01-edito', '02-inclusion']);
  assert.deepStrictEqual(p.renommages, [], 'un renommage inutile est un risque gratuit');
  assert.strictEqual(p.aFaire, false);
});

test('plan : le rang décide du préfixe, et le reste du nom ne bouge pas', () => {
  const p = plan.planRenumerotation(
    [article('01-edito'), article('02-inclusion')],
    ['02-inclusion', '01-edito']);
  assert.strictEqual(p.aFaire, true);
  // Deux articles qui échangent leur rang : chacun prend le préfixe de l'autre, la partie
  // parlante du nom reste la sienne.
  assert.deepStrictEqual(p.renommages.map((r) => r.de + ' -> ' + r.vers),
    ['02-inclusion -> 01-inclusion', '01-edito -> 02-edito']);
});

test('plan : un échange passe par un nom temporaire, sinon il écrase', () => {
  // Le cas qui casse une implémentation naïve : renommer 01 en 02 alors que 02 existe
  // encore. Le plan doit donc sortir en deux passes.
  const p = plan.planRenumerotation(
    [article('01-edito'), article('02-inclusion')],
    ['02-inclusion', '01-edito']);
  assert.strictEqual(p.passes.length, 2, 'un échange sans passe temporaire écrase un dossier');
  const [aller, retour] = p.passes;
  for (const etape of aller) {
    assert.match(etape.vers, /^~ordre-/, 'la première passe doit viser un nom temporaire');
  }
  for (const etape of retour) {
    assert.match(etape.de, /^~ordre-/, 'la seconde passe doit partir du nom temporaire');
    assert.ok(!/^~ordre-/.test(etape.vers), 'un nom temporaire est resté à l’arrivée');
  }
  // Et aucun nom temporaire ne peut heurter un dossier existant.
  const existants = new Set(['01-edito', '02-inclusion']);
  for (const etape of aller) { assert.ok(!existants.has(etape.vers)); }
});

test('plan : les fichiers du dossier suivent son nom', () => {
  // Le Makefile exige que le .md porte le nom de son dossier ; la fiche, la bibliographie
  // et le sidecar des tâches suivent la même règle. Un fichier oublié resterait invisible
  // pour la chaîne.
  const p = plan.planRenumerotation(
    [article('03-gremion', ['03-gremion.biblio.md', '03-gremion.taches.yaml'])],
    ['03-gremion']);
  const r = p.renommages[0];
  assert.strictEqual(r.vers, '01-gremion');
  assert.deepStrictEqual(r.fichiers.map((f) => f.de + ' -> ' + f.vers), [
    '03-gremion.md -> 01-gremion.md',
    '03-gremion.meta.yaml -> 01-gremion.meta.yaml',
    '03-gremion.biblio.md -> 01-gremion.biblio.md',
    '03-gremion.taches.yaml -> 01-gremion.taches.yaml'
  ]);
});

test('plan : un fichier qui ne porte pas le nom du dossier reste tranquille', () => {
  // Une note laissée par une rédactrice, un Word déposé à la main : ils ne suivent pas.
  const p = plan.planRenumerotation(
    [article('03-gremion', ['notes.txt', 'Gremion-v2.docx'])], ['03-gremion']);
  const noms = p.renommages[0].fichiers.map((f) => f.de);
  assert.ok(noms.indexOf('notes.txt') === -1 && noms.indexOf('Gremion-v2.docx') === -1,
    'un fichier étranger au slug a été renommé : ' + noms.join(', '));
});

test('plan : un dossier sans préfixe en reçoit un', () => {
  // Un article créé à la main, ou importé avant que la chaîne ne préfixe.
  const p = plan.planRenumerotation([article('inclusion'), article('01-edito')],
    ['01-edito', 'inclusion']);
  const vers = p.renommages.map((r) => r.vers);
  assert.ok(vers.indexOf('02-inclusion') !== -1, 'le dossier sans préfixe n’a pas été aligné : ' + vers);
});

test('plan : au-delà de neuf, le préfixe garde deux chiffres', () => {
  const slugs = [];
  for (let i = 1; i <= 12; i++) { slugs.push(article('a' + i)); }
  const p = plan.planRenumerotation(slugs, slugs.map((a) => a.slug));
  const dernier = p.renommages[p.renommages.length - 1];
  assert.strictEqual(dernier.vers, '12-a12');
  assert.ok(p.renommages.some((r) => r.vers === '09-a9'), 'le neuvième perd son zéro');
});

// ---- 2. Ce que le plan refuse ------------------------------------------------------

test('plan : un ordre qui ne parle pas des mêmes articles est refusé', () => {
  // Le garde-fou qui compte : un ordre calculé sur une liste périmée renommerait au hasard.
  assert.throws(() => plan.planRenumerotation([article('01-a'), article('02-b')], ['01-a']),
    /ordre/i, 'un ordre incomplet doit être refusé, pas complété d’office');
  assert.throws(() => plan.planRenumerotation([article('01-a')], ['01-a', '02-b']),
    /ordre/i, 'un ordre qui nomme un article absent doit être refusé');
});

test('plan : deux articles ne peuvent pas viser le même nom', () => {
  // Impossible par construction, puisque le préfixe vient du rang — ce contrôle existe
  // pour que cela reste vrai le jour où le calcul du préfixe changera.
  const p = plan.planRenumerotation(
    [article('01-essai'), article('02-essai')], ['02-essai', '01-essai']);
  const cibles = p.renommages.map((r) => r.vers);
  assert.strictEqual(new Set(cibles).size, cibles.length, 'deux dossiers visent le même nom');
});

// ---- 3. La reprise, quand un lot s’est interrompu -----------------------------------

test('reprise : des dossiers temporaires laissés derrière se terminent', () => {
  // Une interruption au milieu — un fichier verrouillé, une fenêtre fermée — laisse des
  // « ~ordre-… » sur le disque. Sans reprise, le numéro reste dans un état que personne ne
  // sait lire. Le nom temporaire porte donc sa destination, et la reprise la relit.
  const restes = ['~ordre-02-inclusion', '01-edito'];
  const p = plan.planReprise(restes);
  assert.strictEqual(p.aFaire, true);
  assert.deepStrictEqual(p.passes.length, 1, 'une reprise n’a plus besoin de passe temporaire');
  assert.deepStrictEqual(p.passes[0].map((e) => e.de + ' -> ' + e.vers),
    ['~ordre-02-inclusion -> 02-inclusion']);
});

test('reprise : rien à reprendre quand aucun temporaire ne traîne', () => {
  const p = plan.planReprise(['01-edito', '02-inclusion']);
  assert.strictEqual(p.aFaire, false);
  assert.deepStrictEqual(p.passes, []);
});

test('reprise : un temporaire dont la destination est prise ne s’écrase pas', () => {
  // Deux exécutions concurrentes, ou un dossier recréé à la main entre-temps.
  assert.throws(() => plan.planReprise(['~ordre-02-inclusion', '02-inclusion']),
    /occup|existe/i, 'la reprise doit refuser plutôt qu’écraser');
});
