// config.json du poste (C:\ProgramData\SZH\config.json) : un seul couple lecture/écriture
// dans lib/archivage.js, que lib/export-ojs.js et le reste du cockpit doivent partager.
//
//   node --test "test/js/*.test.js"
//
// Avant ce lot, lib/export-ojs.js portait sa PROPRE copie de lireConfigPoste(), avec son
// propre override d'environnement (SZH_CONFIG_OJS) ; lib/archivage.js lisait toujours
// C:\ProgramData\SZH\config.json en dur, sans override. Un test qui posait SZH_CONFIG_OJS
// et passait par archivage.js (l'emplacement des revues, par exemple) touchait donc
// encore le vrai fichier du poste, en silence. Ce fichier éprouve la version centralisée :
// un seul override, une seule écriture atomique, une lecture-modification-écriture qui ne
// perd jamais ce qu'un autre appelant vient de ranger.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

// Un config.json de travail par test, jamais celui du poste — même principe que
// export-ojs.test.js : SZH_CONFIG_OJS détourne la lecture ET l'écriture.
function fichierEssai() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'szh-config-poste-')), 'config.json');
}

test('lireConfigPoste/ecrireConfigPoste respectent SZH_CONFIG_OJS, comme export-ojs.js', () => {
  const chemin = fichierEssai();
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
  try {
    assert.strictEqual(archivage.lireConfigPoste(), null, 'rien à lire avant la première écriture');
    const erreur = archivage.ecrireConfigPoste(() => ({ repo: 'x' }));
    assert.strictEqual(erreur, null, 'échec inattendu : ' + erreur);
    assert.ok(fs.existsSync(chemin), 'le fichier de SZH_CONFIG_OJS n’a pas été écrit');
    assert.deepStrictEqual(archivage.lireConfigPoste(), { repo: 'x' });
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});

// Le contrat central : deux écritures successives, chacune ne connaissant qu'UN bloc, ne
// doivent jamais s'écraser l'une l'autre — c'est exactement ce que faisait mal l'ancien
// export-ojs.js (writeFileSync nu, sans le passage par une lecture fraîche partagée).
test('deux écritures successives de blocs différents conservent les deux (lecture-modification-écriture atomique)', () => {
  const chemin = fichierEssai();
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
  try {
    archivage.ecrireConfigPoste((avant) => Object.assign({}, avant, { blocA: { x: 1 } }));
    archivage.ecrireConfigPoste((avant) => Object.assign({}, avant, { blocB: { y: 2 } }));
    const relu = archivage.lireConfigPoste();
    assert.deepStrictEqual(relu.blocA, { x: 1 }, 'le premier bloc a été perdu');
    assert.deepStrictEqual(relu.blocB, { y: 2 }, 'le second bloc a été perdu');
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});

test('ecrireConfigPoste garde la forme historique : un objet direct s’écrit tel quel', () => {
  // extension.js appelle encore ecrireConfigPoste(objet) à trois endroits (lecture et
  // fusion faites par l'appelant) : cette forme ne doit pas casser quand fn est un objet
  // et non une fonction.
  const chemin = fichierEssai();
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
  try {
    const erreur = archivage.ecrireConfigPoste({ repo: 'y' });
    assert.strictEqual(erreur, null, 'échec inattendu : ' + erreur);
    assert.deepStrictEqual(archivage.lireConfigPoste(), { repo: 'y' });
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});

test('ecrireEmplacementRevues écrit désormais atomiquement, et garde le reste du fichier', () => {
  const chemin = fichierEssai();
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
  try {
    archivage.ecrireConfigPoste(() => ({ repo: 'z', ojs: { revues: {} } }));
    const erreur = archivage.ecrireEmplacementRevues(archivage.EMPLACEMENT_PRODUCTION);
    assert.strictEqual(erreur, null, 'échec inattendu : ' + erreur);
    const relu = archivage.lireConfigPoste();
    assert.strictEqual(relu.emplacementRevues, 'production');
    assert.strictEqual(relu.devMode, false);
    assert.strictEqual(relu.repo, 'z', 'le reste du fichier a été écrasé');
    assert.deepStrictEqual(relu.ojs, { revues: {} }, 'la config OJS a été écrasée');
    // Aucun temporaire oublié à côté : ecrireAtomique nettoie toujours le sien.
    const fichiers = fs.readdirSync(path.dirname(chemin));
    assert.ok(!fichiers.some((f) => f.startsWith('~$')), 'un temporaire est resté : ' + fichiers);
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});

test('export-ojs.js partage désormais le même fichier et le même override qu’archivage.js', () => {
  const chemin = fichierEssai();
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'export-ojs.js'))];
  const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
  const ojs = require(path.join(COCKPIT, 'lib', 'export-ojs.js'));
  try {
    // Écrit par archivage, lu par export-ojs : même fichier.
    archivage.ecrireConfigPoste(() => ({ repo: 'depuis-archivage' }));
    const cfg = ojs.configOjs();
    assert.ok(cfg && typeof cfg === 'object', 'export-ojs.js ne lit plus le fichier attendu');
    // Écrit par export-ojs, lu par archivage : même fichier, dans l'autre sens, et le
    // reste du fichier survit (repo posé juste au-dessus).
    const erreur = ojs.ecrireConfigOjs({});
    assert.strictEqual(erreur, null, 'échec inattendu : ' + erreur);
    const relu = archivage.lireConfigPoste();
    assert.strictEqual(relu.repo, 'depuis-archivage', 'export-ojs.js a écrasé le reste du fichier');
    assert.ok(relu.ojs && typeof relu.ojs === 'object', 'export-ojs.js n’a pas écrit sous la clé ojs');
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});
