// L'exécution du plan de renumérotation, sur un vrai dossier.
//
//   node --test "test/js/*.test.js"
//
// Le plan lui-même est éprouvé sans disque (renumerotation.test.js). Ici on éprouve ce qui
// ne se simule pas : des dossiers réellement renommés, un lot interrompu au milieu, et
// l'ordre du numéro réécrit APRÈS que tout soit passé — jamais avant, sinon ausgabe.yaml
// désignerait des dossiers qui n'existent pas.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const hote = require(path.join(COCKPIT, 'lib', 'renumerotation-fs.js'));

const LF = String.fromCharCode(10);

// Un numéro d'essai : des dossiers d'article, leurs sidecars, un ausgabe.yaml qui porte
// l'ordre, et de quoi vérifier que le reste ne bouge pas.
function numero(slugs) {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-renum-'));
  // L'ordre s'écrit en séquence EN LIGNE, comme le sérialiseur du cockpit la pose :
  // ordre-articles: ["01-a", "02-b"]. Le corpus d'essai doit parler la même langue que
  // lui, sinon le contrôle prouve autre chose que ce qu'il croit.
  fs.writeFileSync(path.join(racine, 'ausgabe.yaml'),
    ['revue: revue',
     'ordre-articles: [' + slugs.map((s) => '"' + s + '"').join(', ') + ']'].join(LF) + LF);
  for (const slug of slugs) {
    const d = path.join(racine, 'articles', slug);
    fs.mkdirSync(path.join(d, 'media'), { recursive: true });
    fs.writeFileSync(path.join(d, slug + '.md'), '# ' + slug + LF + '![](media/fig.png)' + LF);
    fs.writeFileSync(path.join(d, slug + '.meta.yaml'), 'title:' + LF + '  fr: "' + slug + '"' + LF);
    fs.writeFileSync(path.join(d, 'media', 'fig.png'), 'PNG');
    fs.writeFileSync(path.join(d, 'notes.txt'), 'pense-bête');
  }
  return racine;
}

const dossiers = (racine) => fs.readdirSync(path.join(racine, 'articles')).sort();
const ordreEcrit = (racine) => ((fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')
  .match(/^ordre-articles:\s*\[(.*)\]/m) || [null, ''])[1])
  .split(',').map((x) => x.trim().replace(/^"|"$/g, '')).filter((x) => x !== '');

test('exécution : un échange de rangs renomme les deux dossiers et leurs fichiers', () => {
  const racine = numero(['01-edito', '02-inclusion']);
  const r = hote.renumeroter(racine, ['02-inclusion', '01-edito']);
  assert.strictEqual(r.erreur, null, 'renumérotation refusée : ' + r.erreur);
  assert.deepStrictEqual(dossiers(racine), ['01-inclusion', '02-edito']);
  // Les fichiers suivent le dossier : le Makefile exige que le .md porte son nom.
  assert.ok(fs.existsSync(path.join(racine, 'articles', '01-inclusion', '01-inclusion.md')));
  assert.ok(fs.existsSync(path.join(racine, 'articles', '01-inclusion', '01-inclusion.meta.yaml')));
  // Ce qui est désigné en chemin relatif depuis le .md ne bouge pas.
  assert.ok(fs.existsSync(path.join(racine, 'articles', '01-inclusion', 'media', 'fig.png')));
  assert.strictEqual(
    fs.readFileSync(path.join(racine, 'articles', '01-inclusion', '01-inclusion.md'), 'utf8')
      .indexOf('![](media/fig.png)') !== -1, true, 'le texte de l’article a été touché');
  // Et le fichier étranger au slug reste tranquille.
  assert.ok(fs.existsSync(path.join(racine, 'articles', '01-inclusion', 'notes.txt')));
  // L'ordre du numéro parle des nouveaux noms.
  assert.deepStrictEqual(ordreEcrit(racine), ['01-inclusion', '02-edito']);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('exécution : rien à faire ne touche rien, pas même ausgabe.yaml', () => {
  const racine = numero(['01-edito', '02-inclusion']);
  const avant = fs.statSync(path.join(racine, 'ausgabe.yaml')).mtimeMs;
  const r = hote.renumeroter(racine, ['01-edito', '02-inclusion']);
  assert.strictEqual(r.erreur, null);
  assert.strictEqual(r.renommes, 0);
  assert.strictEqual(fs.statSync(path.join(racine, 'ausgabe.yaml')).mtimeMs, avant,
    'ausgabe.yaml réécrit alors que rien ne changeait');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('exécution : les documents produits des articles renommés sont retirés', () => {
  // out/<slug>/ porte le nom d'avant : le laisser ferait cohabiter deux PDF pour un même
  // article, dont un périmé que l'export pourrait reprendre.
  const racine = numero(['01-edito', '02-inclusion']);
  for (const slug of ['01-edito', '02-inclusion']) {
    fs.mkdirSync(path.join(racine, 'out', slug), { recursive: true });
    fs.writeFileSync(path.join(racine, 'out', slug, slug + '.pdf'), 'PDF');
  }
  hote.renumeroter(racine, ['02-inclusion', '01-edito']);
  assert.deepStrictEqual(fs.readdirSync(path.join(racine, 'out')), [],
    'les documents produits sous l’ancien nom sont restés');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('exécution : un ordre qui ne parle pas des mêmes articles est refusé, sans rien toucher', () => {
  const racine = numero(['01-edito', '02-inclusion']);
  const r = hote.renumeroter(racine, ['01-edito']);
  assert.ok(r.erreur, 'un ordre incomplet doit être refusé');
  assert.deepStrictEqual(dossiers(racine), ['01-edito', '02-inclusion'], 'des dossiers ont bougé malgré le refus');
  assert.deepStrictEqual(ordreEcrit(racine), ['01-edito', '02-inclusion']);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reprise : un lot interrompu se termine, et l’ordre s’écrit alors seulement', () => {
  // On simule l'interruption : les dossiers sont passés par leur nom temporaire, et la
  // seconde passe n'a pas eu lieu. C'est l'état que laisse une fermeture de fenêtre.
  const racine = numero(['01-edito', '02-inclusion']);
  const base = path.join(racine, 'articles');
  fs.renameSync(path.join(base, '01-edito'), path.join(base, '~ordre-02-edito'));
  fs.renameSync(path.join(base, '02-inclusion'), path.join(base, '~ordre-01-inclusion'));

  const r = hote.reprendre(racine);
  assert.strictEqual(r.erreur, null, 'reprise refusée : ' + r.erreur);
  assert.deepStrictEqual(dossiers(racine), ['01-inclusion', '02-edito']);
  // Les fichiers portaient encore l'ancien nom : la reprise les aligne aussi.
  assert.ok(fs.existsSync(path.join(base, '01-inclusion', '01-inclusion.md')),
    'la reprise a laissé les fichiers sous leur ancien nom : ' +
    fs.readdirSync(path.join(base, '01-inclusion')).join(', '));
  assert.deepStrictEqual(ordreEcrit(racine), ['01-inclusion', '02-edito']);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reprise : rien à reprendre ne fait rien', () => {
  const racine = numero(['01-edito']);
  const r = hote.reprendre(racine);
  assert.strictEqual(r.erreur, null);
  assert.strictEqual(r.renommes, 0);
  fs.rmSync(racine, { recursive: true, force: true });
});

test('reprise : une destination occupée est refusée, et rien ne s’écrase', () => {
  const racine = numero(['01-edito']);
  const base = path.join(racine, 'articles');
  fs.mkdirSync(path.join(base, '~ordre-01-edito'));
  fs.writeFileSync(path.join(base, '~ordre-01-edito', 'marqueur.txt'), 'temporaire');
  const r = hote.reprendre(racine);
  assert.ok(r.erreur, 'la reprise devait refuser une destination occupée');
  assert.ok(fs.existsSync(path.join(base, '01-edito', '01-edito.md')),
    'le dossier en place a été écrasé');
  fs.rmSync(racine, { recursive: true, force: true });
});

test('état : on sait dire qu’un lot a été interrompu', () => {
  // Ce que l'interface lira pour proposer la reprise plutôt que de laisser un numéro
  // dans un état que personne ne sait nommer.
  const racine = numero(['01-edito']);
  assert.strictEqual(hote.repriseEnAttente(racine), false);
  fs.renameSync(path.join(racine, 'articles', '01-edito'),
    path.join(racine, 'articles', '~ordre-01-edito'));
  assert.strictEqual(hote.repriseEnAttente(racine), true);
  fs.rmSync(racine, { recursive: true, force: true });
});
