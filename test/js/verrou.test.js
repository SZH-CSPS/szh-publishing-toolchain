// lib/verrou.js : settings.json est du JSONC (VS Code y tolère commentaires et virgules
// traînantes), et un fichier qu'on ne sait plus lire ne doit jamais faire croire à un
// déverrouillage réussi — mieux vaut le supposer verrouillé (voir hote.test.js pour le
// scénario complet, à travers appliquerEtVerifierVerrou dans extension.js).
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const verrou = require(path.join(COCKPIT, 'lib', 'verrou.js'));

function racineEssai() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-verrou-'));
}

test('settings.json en JSONC : les commentaires // et /* */ n’empêchent pas la lecture du verrou', () => {
  const racine = racineEssai();
  const dossier = path.join(racine, '.vscode');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'settings.json'), [
    '{',
    '  // posé par le cockpit, ne pas éditer à la main',
    '  "files.readonlyInclude": { "**": true }, /* tout le dossier */',
    '  "files.readonlyExclude": { ".vscode/**": true },',
    '  "triggerTaskOnSave.tasks": {}',
    '}',
    ''
  ].join('\n'));
  assert.strictEqual(verrou.verrouPose(racine), true,
    'le verrou n’est pas lu à travers les commentaires JSONC');
});

test('settings.json en JSONC : une clé étrangère survit à un déverrouillage', () => {
  const racine = racineEssai();
  const dossier = path.join(racine, '.vscode');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'settings.json'), [
    '{',
    '  // réglage d’une autre extension, sans rapport avec le verrou',
    '  "editor.rulers": [80],',
    '  "files.readonlyInclude": { "**": true },',
    '  "files.readonlyExclude": { ".vscode/**": true },',
    '  "triggerTaskOnSave.tasks": {}',
    '}',
    ''
  ].join('\n'));
  const erreur = verrou.appliquerVerrou(racine, false);
  assert.strictEqual(erreur, null, 'le déverrouillage a échoué : ' + erreur);
  assert.strictEqual(verrou.verrouPose(racine), false, 'le verrou n’a pas été levé');
  const relu = JSON.parse(fs.readFileSync(path.join(dossier, 'settings.json'), 'utf8'));
  assert.deepStrictEqual(relu['editor.rulers'], [80],
    'la clé étrangère n’a pas survécu à la réécriture JSONC -> JSON');
  for (const cle of verrou.CLES_VERROU) {
    assert.ok(!(cle in relu), 'la clé de verrou ' + cle + ' aurait dû partir');
  }
});

// Sonde du point 3(b) : un settings.json qu'on ne sait plus lire (JSON cassé) doit se
// supposer VERROUILLÉ, jamais déverrouillé — l'inverse laisserait éditer un numéro que
// l'interface prétend protégé, silencieusement.
test('settings.json illisible : verrouPose se replie sur « verrouillé », jamais sur « libre »', () => {
  const racine = racineEssai();
  const dossier = path.join(racine, '.vscode');
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'settings.json'), '{ ceci ne se referme pas');
  assert.strictEqual(verrou.verrouPose(racine), true,
    'un settings.json cassé ne doit jamais se lire comme « déverrouillé »');
});

test('settings.json absent : verrouPose dit « libre », un numéro neuf n’est jamais verrouillé à tort', () => {
  const racine = racineEssai();
  assert.strictEqual(verrou.verrouPose(racine), false);
});
