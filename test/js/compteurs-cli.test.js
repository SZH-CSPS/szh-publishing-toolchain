// outils/compteurs-cli.js : l'entrée en ligne de commande de l'écrivain des compteurs, lancée par
// le lanceur Windows. Elle ne recalcule rien : le fichier écrit est celui de lib/compteurs.js
// pour la même entrée, et les gardes (simulation, réseau interdit, dossier de test, file
// d'attente hors ligne) sont celles de l'écrivain.
//
//   node --test test/js/compteurs-cli.test.js
//
// Aucun test ne touche le vrai dossier partagé ni le vrai %LOCALAPPDATA% : SZH_COMPTEURS,
// LOCALAPPDATA et SZH_BASE visent toujours un dossier jetable.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const CLI = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'outils', 'compteurs-cli.js');
const COMPTEURS_JS = path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'compteurs.js');
const ENTETE = 'date;poste;contexte;version_toolkit;version_rootfs;source;passage;mesure;valeur';
const SENTINELLE = 'SENTINELLE-MANUSCRIT-8c41f2';

function jetable() { return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-compteurs-cli-')); }

// L'environnement d'un essai : tout ce qui viserait le vrai poste est retiré.
function environnement(travail, extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['OneDrive', 'OneDriveCommercial', 'SZH_ANCRAGE', 'SZH_COMPTEURS', 'SZH_LANCEUR_SIMULE',
    'SZH_RESEAU_INTERDIT', 'SZH_MANUSCRIT_CLI', 'SZH_CODIUM_PROFIL', 'SZH_TOOLKIT']) { delete env[k]; }
  Object.assign(env, {
    SZH_BASE: path.join(travail, 'programdata'),
    LOCALAPPDATA: path.join(travail, 'localappdata'),
    USERPROFILE: path.join(travail, 'profil'),
    COMPUTERNAME: 'rmo-test'
  }, extra || {});
  fs.mkdirSync(env.LOCALAPPDATA, { recursive: true });
  return env;
}

function lancer(entree, env) {
  const octets = Buffer.isBuffer(entree) ? entree : Buffer.from(String(entree), 'utf8');
  const r = spawnSync(process.execPath, [CLI], { input: octets, env, encoding: 'utf8', timeout: 30000, windowsHide: true });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function csvs(dossier) {
  try { return fs.readdirSync(dossier).filter((f) => f.endsWith('.csv')).sort(); } catch (e) { return []; }
}

function bilan(sortie) { return JSON.parse(sortie.stdout.trim().split(/\r?\n/).pop()); }

const MESURES = { 'issue.ok': 1, 'signes': '5000', 'regle:texte libre:revision': 2, 'images': 1.5, [SENTINELLE]: 7 };

test('même entrée, même fichier que lib/compteurs.js : octets identiques, au nom près', () => {
  const travail = jetable();
  try {
    const dossierCli = path.join(travail, 'cli');
    const dossierJs = path.join(travail, 'js');
    const entree = { source: 'nettoyeur', passage: 'abcdef012345', mesures: MESURES };

    const r = lancer('\uFEFF' + JSON.stringify(entree), environnement(travail, { SZH_COMPTEURS: dossierCli }));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(csvs(dossierCli).length, 1, 'un fichier : ' + r.stdout + r.stderr);

    const avant = process.env.SZH_COMPTEURS;
    Object.assign(process.env, environnement(travail, { SZH_COMPTEURS: dossierJs }));
    try {
      const { ecrireCompteurs } = require(COMPTEURS_JS);
      const attendu = ecrireCompteurs({ source: 'nettoyeur', passage: 'abcdef012345', mesures: MESURES });
      assert.ok(attendu.ecrit);
    } finally {
      if (avant === undefined) { delete process.env.SZH_COMPTEURS; } else { process.env.SZH_COMPTEURS = avant; }
    }

    const octetsCli = fs.readFileSync(path.join(dossierCli, csvs(dossierCli)[0]));
    const octetsJs = fs.readFileSync(path.join(dossierJs, csvs(dossierJs)[0]));
    assert.ok(Buffer.compare(octetsCli, octetsJs) === 0, 'contenu différent');
    const texte = octetsCli.toString('utf8');
    assert.ok(texte.startsWith('\uFEFF' + ENTETE + '\r\n'));
    assert.ok(!texte.includes(SENTINELLE), 'la sentinelle est sortie dans le fichier');
    assert.deepStrictEqual(bilan(r), Object.assign({}, bilan(r), { ecrit: true, enAttente: false, motif: null, lignes: 3 }));
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('sans passage, le fichier donne le passage : SHA-256 tronqué à 12, jamais le chemin', () => {
  const travail = jetable();
  try {
    const manuscrit = path.join(travail, SENTINELLE + '.docx');
    fs.writeFileSync(manuscrit, 'contenu du manuscrit', 'utf8');
    const sha = crypto.createHash('sha256').update('contenu du manuscrit').digest('hex').slice(0, 12);
    const dossier = path.join(travail, 'compteurs');
    const r = lancer(JSON.stringify({ source: 'nettoyeur', passage: '', fichier: manuscrit, mesures: { 'issue.plantage': 1 } }),
      environnement(travail, { SZH_COMPTEURS: dossier }));
    assert.equal(r.status, 0, r.stderr);
    const texte = fs.readFileSync(path.join(dossier, csvs(dossier)[0]), 'utf8');
    assert.ok(texte.includes(';nettoyeur;' + sha + ';issue.plantage;1\r\n'), texte);
    assert.ok(!texte.includes(SENTINELLE));
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('fichier illisible et passage absent : un passage tiré au hasard, jamais vide', () => {
  const travail = jetable();
  try {
    const dossier = path.join(travail, 'compteurs');
    const r = lancer(JSON.stringify({ source: 'nettoyeur', fichier: path.join(travail, 'nexiste-pas'), mesures: { 'issue.ok': 1 } }),
      environnement(travail, { SZH_COMPTEURS: dossier }));
    assert.equal(r.status, 0, r.stderr);
    const texte = fs.readFileSync(path.join(dossier, csvs(dossier)[0]), 'utf8');
    assert.match(texte, /;nettoyeur;[0-9a-f]{12};issue\.ok;1\r\n/);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('SZH_LANCEUR_SIMULE=1 ou SZH_RESEAU_INTERDIT sans SZH_COMPTEURS : aucun fichier, ni dossier ni file ; SZH_COMPTEURS lève la garde',
  () => {
    for (const garde of [{ SZH_LANCEUR_SIMULE: '1' }, { SZH_RESEAU_INTERDIT: '1' }]) {
      const travail = jetable();
      try {
        const env = environnement(travail, garde);
        const r = lancer(JSON.stringify({ source: 'nettoyeur', mesures: { 'issue.ok': 1 } }), env);
        assert.equal(r.status, 0, r.stderr);
        assert.equal(bilan(r).motif, 'harnais-test');
        assert.ok(!fs.existsSync(path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente')), 'rien dans la file');

        const dossier = path.join(travail, 'compteurs');
        const r2 = lancer(JSON.stringify({ source: 'nettoyeur', mesures: { 'issue.ok': 1 } }),
          Object.assign({}, env, { SZH_COMPTEURS: dossier }));
        assert.equal(csvs(dossier).length, 1, 'SZH_COMPTEURS doit lever la garde : ' + r2.stdout);
      } finally {
        fs.rmSync(travail, { recursive: true, force: true });
      }
    }
  });

test('dossier injoignable : le fichier part dans la file hors ligne du compte', () => {
  const travail = jetable();
  try {
    const obstacle = path.join(travail, 'obstacle');
    fs.writeFileSync(obstacle, 'je suis un fichier', 'utf8');
    const env = environnement(travail, { SZH_COMPTEURS: path.join(obstacle, 'compteurs') });
    const r = lancer(JSON.stringify({ source: 'nettoyeur', mesures: { 'issue.ok': 1 } }), env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(bilan(r).enAttente, true);
    assert.equal(csvs(path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente')).length, 1);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('contexte : prod par défaut, dev si SZH_CODIUM_PROFIL ou SZH_MANUSCRIT_CLI', () => {
  const contexte = (extra) => {
    const travail = jetable();
    try {
      const dossier = path.join(travail, 'compteurs');
      const r = lancer(JSON.stringify({ source: 'nettoyeur', mesures: { 'issue.ok': 1 } }),
        environnement(travail, Object.assign({ SZH_COMPTEURS: dossier }, extra)));
      assert.equal(r.status, 0, r.stderr);
      return fs.readFileSync(path.join(dossier, csvs(dossier)[0]), 'utf8').split('\r\n')[1].split(';')[2];
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  };
  assert.equal(contexte({}), 'prod');
  assert.equal(contexte({ SZH_CODIUM_PROFIL: 'C:\\profil-dev' }), 'dev');
  assert.equal(contexte({ SZH_MANUSCRIT_CLI: 'C:\\x\\manuscrit-nettoyer.py' }), 'dev');
});

test('ne lève jamais : entrée vide, JSON cassé, source inconnue, mesures sans valeur retenue', () => {
  const travail = jetable();
  try {
    const dossier = path.join(travail, 'compteurs');
    const env = environnement(travail, { SZH_COMPTEURS: dossier });
    for (const entree of ['', '{pas du json', 'null', JSON.stringify({ source: 'inconnue', mesures: { 'issue.ok': 1 } }),
      JSON.stringify({ source: 'nettoyeur', mesures: { Majuscule: 1, 'issue.ok': -3 } }),
      JSON.stringify({ source: 'nettoyeur' })]) {
      const r = lancer(entree, env);
      assert.equal(r.status, 0, JSON.stringify(entree) + ' : ' + r.stderr);
      assert.equal(bilan(r).ecrit, false);
    }
    assert.deepStrictEqual(csvs(dossier), []);
  } finally {
    fs.rmSync(travail, { recursive: true, force: true });
  }
});
