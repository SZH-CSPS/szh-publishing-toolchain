// La langue de l'interface : d'où elle vient, et pourquoi les deux moitiés de l'écran
// peuvent ne pas s'accorder.
//
//   node --test "test/js/*.test.js"
//
// Le défaut de départ, relevé le 08.09.2026 sur deux postes. La cascade de langueCockpit()
// s'arrêtait à la langue d'affichage de VSCodium, et retombait sur le français dès qu'elle
// ne valait pas « de ». Or les postes d'ici affichent VSCodium en anglais : le repli était
// donc atteint TOUJOURS, et le cockpit parlait français à la rédaction germanophone. Rien
// ne le rattrapait — le réglage szh.langue, qui aurait pu, vit dans les réglages de
// l'éditeur, que la mise à jour du poste réécrit en entier : le choix disparaissait à
// chaque mise à jour.
//
// Et le symptôme le plus déroutant, celui qu'on ne relie à rien sans le savoir : les menus
// de VSCodium et les textes du cockpit ne viennent pas de la même source. Les premiers de
// package.nls*.json, résolus par la langue d'affichage de l'éditeur ; les seconds de
// lib/i18n.js, résolus par la cascade ci-dessous. Un écran à moitié allemand et à moitié
// français est donc un état ATTEIGNABLE, et non une traduction manquante.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

// Les deux fichiers du poste sont détournés AVANT le premier require : lib/i18n.js les lit
// par SZH_CONFIG_OJS et SZH_ETAT_POSTE, exactement comme lib/archivage.js le fait déjà pour
// le premier. Aucun contrôle de ce fichier ne touche le config.json du poste.
const POSTE = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-langue-'));
const CONFIG = path.join(POSTE, 'config.json');
const ETAT = path.join(POSTE, 'state.json');
process.env.SZH_CONFIG_OJS = CONFIG;
process.env.SZH_ETAT_POSTE = ETAT;

const { chargerAvecVscodeFactice } = require('./dom-minimal');
const i18n = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'i18n.js'));
const archivage = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'archivage.js'));

// Le faux « vscode » de dom-minimal rend szh.langue vide et env.language « fr ». C'est donc
// l'étage « éditeur » de la cascade qui sert de plancher ici, et les étages du poste se
// testent au-dessus de lui.
const LF = String.fromCharCode(10);
function poserPoste(config, etat) {
  for (const paire of [[CONFIG, config], [ETAT, etat]]) {
    if (paire[1] === null) { fs.rmSync(paire[0], { force: true }); }
    else { fs.writeFileSync(paire[0], JSON.stringify(paire[1]) + LF); }
  }
  i18n.oublierLanguePoste();
}

test('cascade : sans rien sur le poste, la langue d’affichage de l’éditeur tranche', () => {
  poserPoste(null, null);
  assert.deepStrictEqual(i18n.sourceLangue(), { langue: 'fr', source: 'editeur' });
});

test('cascade : le dernier lanceur ouvert décide quand rien de plus explicite ne le fait', () => {
  // C'est le correctif du défaut principal : sur ces postes, ni Windows ni VSCodium ne
  // disent l'équipe qui s'en sert — les deux sont en anglais. Le lanceur, lui, le dit :
  // « Zeitschriften SZH » écrit « de » dans son fichier d'état (Set-SzhLangueProduit).
  poserPoste({}, { langue: 'de' });
  assert.deepStrictEqual(i18n.sourceLangue(), { langue: 'de', source: 'lanceur' });
  assert.strictEqual(i18n.T('arbre.actualite'), i18n.TEXTES_COCKPIT.de['arbre.actualite']);
});

test('cascade : le choix enregistré pour le poste passe devant le lanceur', () => {
  // Deux exemplaires du même choix, et c'est celui-ci qui survit à une mise à jour.
  poserPoste({ langue: 'de' }, { langue: 'fr' });
  assert.deepStrictEqual(i18n.sourceLangue(), { langue: 'de', source: 'poste' });
});

test('cascade : la variable d’essai garde le dernier mot', () => {
  poserPoste({ langue: 'de' }, { langue: 'de' });
  process.env.SZH_LANGUE = 'fr';
  try {
    assert.deepStrictEqual(i18n.sourceLangue(), { langue: 'fr', source: 'essai' });
  } finally { delete process.env.SZH_LANGUE; }
});

test('cascade : une valeur inconnue sur le poste ne détourne rien', () => {
  for (const brute of ['en', 'ZZ', '', 'it', 42, null, true, {}]) {
    poserPoste({ langue: brute }, { langue: brute });
    assert.strictEqual(i18n.sourceLangue().source, 'editeur',
      'valeur retenue à tort : ' + JSON.stringify(brute));
  }
  // En revanche une étiquette de langue complète est acceptée sur ses deux premières
  // lettres, comme la variable d'essai : ces fichiers se corrigent aussi à la main, et
  // « de-CH » veut dire allemand.
  for (const brute of ['de-CH', 'DE', ' fr ', 'fr-CH']) {
    poserPoste({ langue: brute }, null);
    assert.strictEqual(i18n.sourceLangue().source, 'poste',
      'étiquette de langue refusée : ' + JSON.stringify(brute));
  }
  // Un fichier illisible n'est pas une valeur : il ne doit pas faire échouer la traduction.
  fs.writeFileSync(CONFIG, '{ pas du json');
  i18n.oublierLanguePoste();
  assert.strictEqual(i18n.sourceLangue().source, 'editeur');
});

test('le choix de la langue s’écrit hors des réglages de l’éditeur', () => {
  // configAvecLangue pose la clé sans toucher au reste du fichier : l'emplacement des
  // revues et la configuration OJS vivent au même endroit.
  const avant = { repo: 'SZH-CSPS/szh-publishing-toolchain', emplacementRevues: 'production' };
  const apres = archivage.configAvecLangue(avant, 'de');
  assert.strictEqual(apres.langue, 'de');
  assert.strictEqual(apres.emplacementRevues, 'production', 'une clé voisine a été perdue');
  assert.strictEqual(avant.langue, undefined, 'la configuration de départ a été modifiée');
  // Une valeur inconnue efface plutôt que d'inventer : la cascade descend alors d'un cran.
  assert.strictEqual('langue' in archivage.configAvecLangue({ langue: 'de' }, 'en'), false);
});

test('le formulaire de réglages écrit la langue aux DEUX endroits', () => {
  // Le premier exemplaire pilote la session, le second survit à la mise à jour. Écrire l'un
  // sans l'autre ramènerait le défaut : l'outil remis à jour reparlait français.
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const i = src.indexOf("msg.cle === 'langue'");
  assert.notStrictEqual(i, -1, 'la branche « langue » du formulaire de réglages a disparu');
  const bloc = src.slice(i, src.indexOf(LF + '      }', i));
  assert.match(bloc, /getConfiguration\('szh'\)\.update\('langue'/,
    'le réglage de l’éditeur n’est plus écrit');
  assert.match(bloc, /ecrireConfigPoste\(configAvecLangue\(/,
    'le second exemplaire, hors des réglages de l’éditeur, n’est plus écrit');
  assert.match(bloc, /oublierLanguePoste\(\)/,
    'le souvenir des fichiers du poste n’est pas jeté après écriture');
  assert.match(bloc, /ecrireLocaleArgv\(langue\)/,
    'la langue d’affichage de l’éditeur ne suit plus le choix');
});

// ---- La discordance, dite plutôt que devinée ----

test('discordance : elle ne se signale que lorsqu’elle existe vraiment', () => {
  // Des menus en anglais ne sont pas une discordance : c'est l'état ordinaire d'un poste
  // sans pack de langue, et personne ne s'en plaint. Le message ne sort donc que quand
  // l'éditeur parle une des deux langues de la maison, et pas la même que le cockpit.
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const i = src.indexOf('function avertissementLangue');
  assert.notStrictEqual(i, -1, 'avertissementLangue a disparu');
  const bloc = src.slice(i, src.indexOf(LF + '}', i));
  assert.match(bloc, /if \(editeur === '' \|\| editeur === cockpit\) \{ return ''; \}/,
    'la condition de silence a changé de forme');
  for (const langue of ['fr', 'de']) {
    const texte = i18n.TL(langue, 'regl.langue.discordance', ['A', 'B']);
    assert.notStrictEqual(texte, 'regl.langue.discordance', 'message absent en ' + langue);
    assert.ok(texte.indexOf('A') !== -1 && texte.indexOf('B') !== -1,
      'le message ne nomme pas les deux langues en ' + langue);
  }
  assert.strictEqual(i18n.TEXTES_COCKPIT.de['regl.langue.discordance'].indexOf('ß'), -1);
});

test('discordance : le formulaire de réglages la pose sous le choix de la langue', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'media', 'settings.js');
  assert.match(src, /if \(g\.cle === 'langue'\)/,
    'la zone du message ne se pose plus dans le groupe « langue »');
  assert.match(src, /afficherDiscordanceLangue\(msg\.avertLangue\)/,
    'le message envoyé par l’hôte n’est plus affiché');
});

// ---- Le diagnostic du poste ----
//
// C'est lui qui sert quand un poste distant montre le symptôme : il pose les six sources
// côte à côte. Sa cascade doit être celle de lib/i18n.js — un diagnostic qui les ordonne
// autrement désignerait la mauvaise coupable.

test('diagnostic : sa cascade est celle du cockpit, dans le même ordre', () => {
  const diag = lire('windows', 'diagnostic.ps1');
  const ordreDiag = [...diag.matchAll(/@\(\$(src[A-Za-z]+|langueMenus),/g)].map((m) => m[1]);
  assert.deepStrictEqual(ordreDiag,
    ['srcEssai', 'srcReglage', 'srcPoste', 'srcLanceur', 'langueMenus', 'srcWindows'],
    'la cascade du diagnostic ne suit plus celle de lib/i18n.js');

  // Et l'ordre de lib/i18n.js, lu dans sourceLangue() : les mêmes étages, dans le même
  // ordre. « editeur » y paraît deux fois — un test par langue d'affichage reconnue.
  const src = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  const i = src.indexOf('function sourceLangue');
  assert.notStrictEqual(i, -1, 'sourceLangue a disparu');
  const bloc = src.slice(i, src.indexOf(LF + '}', i));
  const sources = [...bloc.matchAll(/source: '([a-z]+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(sources,
    ['essai', 'reglage', 'poste', 'lanceur', 'editeur', 'editeur', 'windows', 'defaut'],
    'les étages de la cascade ont changé d’ordre ou de nom');
});

test('diagnostic : un pack de langue absent est nommé, pas tu', () => {
  // Sans le pack, la locale demandée ne s'applique pas : les menus restent en anglais et la
  // langue d'affichage de l'éditeur n'est plus celle du fichier. Le diagnostic doit dire
  // cela plutôt que d'afficher une langue qui n'est pas à l'écran.
  const diag = lire('windows', 'diagnostic.ps1');
  assert.match(diag, /if \(\$localeArgv -and \(-not \$packPose\)\)/,
    'le cas « locale demandée sans pack » n’est plus distingué');
  assert.match(diag, /Dire 'manque' 'Interface cohérente'/,
    'la discordance ne ressort plus en défaut à réparer');

  // Le piège, et c'est celui de SumatraPDF déjà corrigé une fois (voir diagnostic.test.js,
  // correctif 1) : un pack absent n'est un DÉFAUT que si nous le livrons. Le pack français
  // n'est volontairement pas épinglé, donc une locale « fr » qui laisse les menus en anglais
  // est l'état voulu d'un poste francophone — le dire en défaut ferait ressortir tout poste
  // sain en « exit 1 ». Seul un pack épinglé et non posé mérite « manque ».
  assert.match(diag, /\$packEpingle -and \(-not \$packPose\)/,
    'le diagnostic ne distingue plus « pack livré » de « pack absent du catalogue »');
  const iManque = diag.indexOf("Dire 'manque' '5. Affichage");
  const iNote = diag.indexOf("Dire 'note' '5. Affichage de l''éditeur' ($localeArgv + ' demandé ;");
  assert.ok(iManque !== -1 && iNote !== -1,
    'les deux issues du pack de langue ne sont plus toutes les deux écrites');
  const epingles = JSON.parse(lire('windows', 'vsix.lock')).extensions.map((e) => e.id);
  assert.ok(epingles.indexOf('MS-CEINTL.vscode-language-pack-fr') === -1,
    'un pack français est désormais épinglé : le commentaire du diagnostic — et cette règle — '
      + 'sont à revoir, une locale « fr » sans pack devient alors un vrai défaut');
  // Le pack épinglé du poste et celui que le diagnostic cherche sont le même.
  const packs = epingles.filter((id) => /language-pack/.test(id));
  assert.ok(packs.length > 0, 'aucun pack de langue épinglé : le contrôle ne prouve plus rien');
  for (const id of packs) {
    assert.ok(diag.indexOf(id) !== -1, 'pack épinglé inconnu du diagnostic : ' + id);
  }
});
