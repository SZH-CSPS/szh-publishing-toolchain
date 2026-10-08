// Les réglages de l'éditeur imposés à tous les postes : où ils vivent, et comment ils
// cohabitent avec ceux du rédacteur.
//
//   node --test "test/js/*.test.js"
//
// Le gabarit `vscodium-user/settings.json` est un jeu de défauts d'extension
// (configurationDefaults), qui se placent sous le fichier de réglages du rédacteur. Ce
// fichier n'est écrit que s'il est absent, sur un poste neuf : thème, zoom, taille de police,
// langue de l'interface et mode d'aperçu choisis dans « Réglages SZH » survivent aux mises à
// jour.
//
// Ce que ces contrôles vérifient : la recopie exacte du gabarit dans package.json, la mesure
// de ce que l'éditeur refuse en défaut, une seule écriture par valeur voulue, et
// qu'update.ps1 n'écrase pas les réglages du rédacteur.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const flotte = require(path.join(COCKPIT, 'lib', 'reglages-flotte.js'));
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const GABARIT = flotte.analyserJsonc(lire('vscodium-user', 'settings.json'));
const PKG = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
const LF = String.fromCharCode(10);

// ---- Deux fichiers, une seule valeur ----

test('les défauts de l’extension sont la recopie exacte du gabarit', () => {
  const contribues = (PKG.contributes || {}).configurationDefaults;
  assert.ok(contribues, 'contributes.configurationDefaults a disparu de package.json');
  assert.ok(Object.keys(GABARIT).length > 40,
    'le gabarit est suspicieusement maigre : ' + Object.keys(GABARIT).length + ' clés');
  // Le message d'échec donne le bloc à recopier.
  assert.ok(flotte.memeValeur(contribues, GABARIT),
    'package.json et le gabarit ont divergé. Recopiez ce bloc dans '
      + 'contributes.configurationDefaults :' + LF + JSON.stringify(GABARIT, null, 2));
});

test('le gabarit ne redit pas un réglage que l’extension déclare déjà', () => {
  // Un « szh.* » a son défaut dans contributes.configuration ; le répéter dans le gabarit
  // donnerait deux valeurs, et la seconde gagnerait sans bruit.
  const propres = Object.keys(((PKG.contributes || {}).configuration || {}).properties || {});
  for (const cle of Object.keys(GABARIT)) {
    assert.ok(propres.indexOf(cle) === -1,
      'réglage déclaré deux fois — dans le gabarit et dans contributes.configuration : ' + cle);
  }
});

// ---- La sonde : ce que l'éditeur refuse en défaut d'extension ----
//
// Le point d'extension `configurationDefaults` filtre selon la portée de chaque réglage : ceux
// de portée « application » (update.mode, extensions.autoUpdate, extensions.autoCheckUpdates,
// window.commandCenter, window.menuBarVisibility sous VSCodium 1.121) en sont retirés, avec un
// simple avertissement. Le cockpit les pose donc lui-même. La liste n'est pas écrite en dur :
// elle se mesure, pour rattraper une clé refusée par une version future.

test('la sonde ne retient que les clés dont le défaut effectif diffère', () => {
  const voulu = { 'a.un': 1, 'b.deux': 'x', 'c.trois': { p: true } };
  const effectif = { 'a.un': 1, 'b.deux': 'AUTRE', 'c.trois': { p: true } };
  assert.deepStrictEqual(flotte.clesRefusees(voulu, (c) => effectif[c]), ['b.deux']);
  // Une clé que l'éditeur ne connaît pas du tout rend undefined : elle est à poser.
  assert.deepStrictEqual(flotte.clesRefusees({ 'z.inconnue': 3 }, () => undefined), ['z.inconnue']);
  // Une lecture qui lève ne fait pas tomber la sonde : la clé est à poser.
  assert.deepStrictEqual(flotte.clesRefusees({ 'z.casse': 3 }, () => { throw new Error('x'); }),
    ['z.casse']);
});

test('la comparaison de valeurs ne dépend pas de l’ordre des clés', () => {
  // files.exclude porte une douzaine de clés, et JSON.stringify garde leur ordre : deux
  // configurations identiques paraîtraient différentes à chaque démarrage, et le cockpit
  // réécrirait le fichier du rédacteur pour rien.
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
  // Le gabarit réel a une empreinte non vide.
  assert.match(flotte.empreinteReglages(GABARIT), /^\d+-[0-9a-f]+$/);
});

test('le commentaire du gabarit ne perturbe pas la lecture', () => {
  const src = ['{', '  // un commentaire', '  "a": "https://exemple.ch // pas un commentaire",',
    '  /* bloc */', '  "b": 2,', '}'].join(LF);
  assert.deepStrictEqual(flotte.analyserJsonc(src),
    { a: 'https://exemple.ch // pas un commentaire', b: 2 });
  // Le gabarit réel en porte beaucoup : ils disent pourquoi chaque réglage est là.
  assert.ok(lire('vscodium-user', 'settings.json').indexOf('// ----') !== -1,
    'le gabarit a perdu ses commentaires : c’est là qu’on décide, ils doivent y rester');
});

// ---- L'hôte : une écriture par valeur voulue ----

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

// ---- L'effet réel, pas seulement la source relue ----
//
// Le test précédent ne relit que la source de poserReglagesMaison(). Celui-ci vérifie son
// exécution sur un poste jamais démarré (globalState neuf) : vider la boucle
// `for (const cle of aPoser)` dans extension.js ne se verrait nulle part ailleurs.
test('poserReglagesMaison écrit vraiment au moins un défaut, à l’activation d’un poste neuf',
  async () => {
    const REVUE = revueDEssai();
    // Une seule activation par processus (hote-factice.js).
    const HOTE = activerHote(REVUE);
    await demarrageSeTait(HOTE);

    // Une clé « mesurable » du gabarit (clesMesurables, extension.js, écarte les surcharges
    // par langue comme « [markdown] »). N'importe laquelle suffit : l'hôte factice n'a aucun
    // défaut effectif (inspect().defaultValue vaut undefined), donc toutes les clés du
    // gabarit sont « refusées » et à poser.
    const mesurable = Object.keys(GABARIT).find((cle) => !/^\[.+\]$/.test(cle));
    assert.ok(mesurable, 'le gabarit ne porte aucune clé mesurable pour ce test');

    const cfg = HOTE.stub.workspace.getConfiguration();
    const posee = cfg.get(mesurable);
    assert.notStrictEqual(posee, undefined,
      'poserReglagesMaison() n’a rien écrit pour « ' + mesurable + ' » : sur un poste neuf, '
      + 'la garde d’empreinte ne doit encore rien avoir bloqué');
    assert.deepStrictEqual(posee, GABARIT[mesurable],
      'la valeur posée pour « ' + mesurable + ' » ne correspond pas au gabarit');
  });

// ---- La mise à jour du poste ----

test('la mise à jour n’écrase plus les réglages du rédacteur', () => {
  const maj = lire('windows', 'update.ps1');
  // La boucle de copie ne porte que deux fichiers ; settings.json est traité à part.
  assert.ok(maj.indexOf("foreach ($f in 'settings.json', 'keybindings.json', 'tasks.json')") === -1,
    'settings.json est de nouveau recopié en entier : le défaut est revenu');
  assert.match(maj, /foreach \(\$f in 'keybindings\.json', 'tasks\.json'\)/,
    'les deux fichiers de la maison ne sont plus déployés');
  // Posé sur un poste qui n'en a pas : le cockpit ne tourne pas avant le premier démarrage de
  // l'éditeur.
  assert.match(maj, /-not \(Test-Path \$reglagesRedacteur\)/,
    'un poste neuf ne recevrait plus aucun réglage');
});
