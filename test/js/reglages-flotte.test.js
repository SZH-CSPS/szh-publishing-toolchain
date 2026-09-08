// Les réglages de l'éditeur imposés à tous les postes : où ils vivent, et pourquoi ils
// n'écrasent plus ceux du rédacteur.
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici. `windows/update.ps1` (étape 4/5) recopiait
// `vscodium-user/settings.json` PAR-DESSUS les réglages de l'éditeur, fichier entier, à
// chaque mise à jour. Tout ce que le rédacteur avait choisi dans « Réglages SZH » —
// thème, zoom, taille de police, langue de l'interface, mode d'aperçu — disparaissait
// donc à chaque mise à jour, sans un mot.
//
// La réparation : le gabarit devient un jeu de DÉFAUTS d'extension, qui vivent SOUS le
// fichier du rédacteur au lieu de le remplacer. Ce fichier n'est donc plus jamais réécrit —
// sauf s'il est absent, sur un poste neuf.
//
// Ce que ces contrôles gardent, dans l'ordre : la recopie exacte du gabarit dans
// package.json (deux fichiers, une seule vérité), la mesure de ce que l'éditeur refuse en
// défaut, l'écriture unique par valeur voulue, et le fait qu'update.ps1 n'écrase plus rien.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const flotte = require(path.join(COCKPIT, 'lib', 'reglages-flotte.js'));

const GABARIT = flotte.analyserJsonc(lire('vscodium-user', 'settings.json'));
const PKG = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
const LF = String.fromCharCode(10);

// ---- Une seule vérité, deux fichiers ----

test('les défauts de l’extension sont la recopie exacte du gabarit', () => {
  const contribues = (PKG.contributes || {}).configurationDefaults;
  assert.ok(contribues, 'contributes.configurationDefaults a disparu de package.json');
  assert.ok(Object.keys(GABARIT).length > 40,
    'le gabarit est suspicieusement maigre : ' + Object.keys(GABARIT).length + ' clés');
  // Le message d'échec porte le bloc à recopier : celui qui change le gabarit ne doit pas
  // avoir à deviner ce qu'on attend de lui.
  assert.ok(flotte.memeValeur(contribues, GABARIT),
    'package.json et le gabarit ont divergé. Recopiez ce bloc dans '
      + 'contributes.configurationDefaults :' + LF + JSON.stringify(GABARIT, null, 2));
});

test('le gabarit ne redit pas un réglage que l’extension déclare déjà', () => {
  // Un « szh.* » a son défaut dans contributes.configuration ; le redire dans le gabarit
  // donnerait deux vérités pour une même question, et la seconde gagnerait en silence.
  const propres = Object.keys(((PKG.contributes || {}).configuration || {}).properties || {});
  for (const cle of Object.keys(GABARIT)) {
    assert.ok(propres.indexOf(cle) === -1,
      'réglage déclaré deux fois — dans le gabarit et dans contributes.configuration : ' + cle);
  }
});

// ---- La sonde : ce que l'éditeur refuse en défaut d'extension ----
//
// Le point d'extension `configurationDefaults` filtre sur la portée de chaque réglage :
// mesuré sur VSCodium 1.121, ceux de portée « application » (update.mode,
// extensions.autoUpdate, extensions.autoCheckUpdates, window.commandCenter,
// window.menuBarVisibility) en sont retirés, avec un simple avertissement. Le cockpit les
// pose donc lui-même. Le partage n'est PAS écrit en dur : il se mesure, pour qu'une clé
// refusée par une version future soit rattrapée sans qu'une liste ait à être tenue.

test('la sonde ne retient que les clés dont le défaut effectif diffère', () => {
  const voulu = { 'a.un': 1, 'b.deux': 'x', 'c.trois': { p: true } };
  const effectif = { 'a.un': 1, 'b.deux': 'AUTRE', 'c.trois': { p: true } };
  assert.deepStrictEqual(flotte.clesRefusees(voulu, (c) => effectif[c]), ['b.deux']);
  // Une clé que l'éditeur ne connaît pas du tout rend undefined : elle est à poser.
  assert.deepStrictEqual(flotte.clesRefusees({ 'z.inconnue': 3 }, () => undefined), ['z.inconnue']);
  // Une lecture qui lève ne fait pas tomber la sonde : la clé est simplement à poser.
  assert.deepStrictEqual(flotte.clesRefusees({ 'z.casse': 3 }, () => { throw new Error('x'); }),
    ['z.casse']);
});

test('la comparaison de valeurs ne dépend pas de l’ordre des clés', () => {
  // files.exclude en porte une douzaine, et JSON.stringify les ordonnerait : deux
  // configurations identiques se seraient dites différentes à chaque démarrage, et le
  // cockpit aurait réécrit le fichier du rédacteur pour rien.
  assert.ok(flotte.memeValeur({ a: 1, b: 2 }, { b: 2, a: 1 }));
  assert.ok(flotte.memeValeur({ x: { p: [1, 2] } }, { x: { p: [1, 2] } }));
  assert.ok(!flotte.memeValeur({ x: { p: [1, 2] } }, { x: { p: [2, 1] } }));
  assert.ok(!flotte.memeValeur({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!flotte.memeValeur([1, 2], { 0: 1, 1: 2 }));
  assert.ok(flotte.memeValeur(null, null) && !flotte.memeValeur(null, {}));
});

test('l’empreinte suit les valeurs, pas la mise en page ni l’ordre', () => {
  const a = flotte.empreinteReglages({ 'x.un': 1, 'y.deux': [3, 4] });
  const b = flotte.empreinteReglages({ 'y.deux': [3, 4], 'x.un': 1 });
  assert.strictEqual(a, b, 'l’ordre des clés change l’empreinte : elle se déclencherait pour rien');
  assert.notStrictEqual(a, flotte.empreinteReglages({ 'x.un': 2, 'y.deux': [3, 4] }));
  assert.notStrictEqual(a, flotte.empreinteReglages({ 'x.un': 1 }));
  // Et le gabarit réel en a une, non vide.
  assert.match(flotte.empreinteReglages(GABARIT), /^\d+-[0-9a-f]+$/);
});

test('le commentaire du gabarit ne perturbe pas la lecture', () => {
  const src = ['{', '  // un commentaire', '  "a": "https://exemple.ch // pas un commentaire",',
    '  /* bloc */', '  "b": 2,', '}'].join(LF);
  assert.deepStrictEqual(flotte.analyserJsonc(src),
    { a: 'https://exemple.ch // pas un commentaire', b: 2 });
  // Le gabarit réel en porte, et beaucoup : ils disent pourquoi chaque réglage est là.
  assert.ok(lire('vscodium-user', 'settings.json').indexOf('// ----') !== -1,
    'le gabarit a perdu ses commentaires : c’est là qu’on décide, ils doivent y rester');
});

// ---- L'hôte : une écriture par valeur voulue, et pas une de plus ----

test('le cockpit ne repose les réglages que si la valeur voulue a changé', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const i = src.indexOf('async function poserReglagesMaison');
  assert.notStrictEqual(i, -1, 'poserReglagesMaison a disparu');
  const bloc = src.slice(i, src.indexOf(LF + '}', i));
  assert.match(bloc, /globalState\.get\(CLE_EMPREINTE_REGLAGES\) === empreinte\) \{ return \[\]; \}/,
    'la garde d’empreinte a disparu : les réglages seraient réimposés à chaque démarrage');
  assert.match(bloc, /inspect\(cle\)/, 'la sonde ne lit plus le défaut effectif');
  assert.match(bloc, /ConfigurationTarget\.Global/, 'l’écriture ne vise plus les réglages utilisateur');
  assert.match(bloc, /globalState\.update\(CLE_EMPREINTE_REGLAGES, empreinte\)/,
    'l’empreinte n’est plus mémorisée');
  // Les surcharges par langue sont hors sonde : le point d'extension les accepte toujours.
  assert.match(src, /function clesMesurables/, 'les surcharges par langue ne sont plus écartées');
});

// ---- La mise à jour du poste ----

test('la mise à jour n’écrase plus les réglages du rédacteur', () => {
  const maj = lire('windows', 'update.ps1');
  // La boucle d'avant portait les trois fichiers ; elle n'en porte plus que deux.
  assert.ok(maj.indexOf("foreach ($f in 'settings.json', 'keybindings.json', 'tasks.json')") === -1,
    'settings.json est de nouveau recopié en entier : le défaut est revenu');
  assert.match(maj, /foreach \(\$f in 'keybindings\.json', 'tasks\.json'\)/,
    'les deux fichiers de la maison ne sont plus déployés');
  // Posé quand même sur un poste qui n'en a pas : le cockpit ne tourne pas avant le premier
  // démarrage de l'éditeur.
  assert.match(maj, /-not \(Test-Path \$reglagesRedacteur\)/,
    'un poste neuf ne recevrait plus aucun réglage');
});
