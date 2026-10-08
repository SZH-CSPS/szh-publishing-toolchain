// config.json du poste (C:\ProgramData\SZH\config.json) : un seul couple lecture/écriture
// dans lib/archivage.js, que lib/export-ojs.js et le reste du cockpit doivent partager.
//
//   node --test test/js/config-poste.test.js
//
// Vérifie : une seule variable de détournement (SZH_CONFIG_OJS) pour la lecture et
// l'écriture, une seule écriture atomique, et une lecture-modification-écriture qui ne perd
// pas ce qu'un autre appelant vient d'écrire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

// Un config.json de travail par test, pas celui du poste : SZH_CONFIG_OJS détourne la
// lecture et l'écriture.
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

// Deux écritures successives, chacune ne connaissant qu'un bloc, ne s'écrasent pas l'une
// l'autre : chaque écriture part d'une lecture fraîche du fichier.
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
  // extension.js appelle ecrireConfigPoste(objet) à trois endroits (lecture et fusion faites
  // par l'appelant) : un objet est accepté à la place d'une fonction.
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
    // Aucun temporaire ne reste : ecrireAtomique nettoie le sien.
    const fichiers = fs.readdirSync(path.dirname(chemin));
    assert.ok(!fichiers.some((f) => f.startsWith('~$')), 'un temporaire est resté : ' + fichiers);
  } finally {
    delete process.env.SZH_CONFIG_OJS;
  }
});

// Le test ci-dessus n'exerce que la valeur « production » ; celui-ci couvre l'autre branche
// d'ecrireEmplacementRevues(), « test ».
test('ecrireEmplacementRevues : l’autre valeur (test) écrit aussi atomiquement, et garde le reste', () => {
  const chemin = fichierEssai();
  process.env.SZH_CONFIG_OJS = chemin;
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'archivage.js'))];
  const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
  try {
    // Poste déjà en production, avec du contenu à côté : la bascule vers « test » doit le
    // garder, tout comme l'inverse le fait pour « production » ci-dessus.
    archivage.ecrireConfigPoste(() => ({ repo: 'w', emplacementRevues: 'production',
      devMode: false, ojs: { revues: {} } }));
    const erreur = archivage.ecrireEmplacementRevues(archivage.EMPLACEMENT_TEST);
    assert.strictEqual(erreur, null, 'échec inattendu : ' + erreur);
    const relu = archivage.lireConfigPoste();
    assert.strictEqual(relu.emplacementRevues, 'test');
    assert.strictEqual(relu.devMode, true);
    assert.strictEqual(relu.repo, 'w', 'le reste du fichier a été écrasé');
    assert.deepStrictEqual(relu.ojs, { revues: {} }, 'la config OJS a été écrasée');
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
