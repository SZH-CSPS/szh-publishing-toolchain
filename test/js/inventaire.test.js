// Ce que l'Accueil liste (lib/inventaire.js), et sa parité avec le socle PowerShell : sur la
// même arborescence jetable, Get-SzhEmplacements et Get-SzhEmplacementRevue (szh-produits.ps1)
// et le module rendent la même racine active, le même mode et les mêmes racines par produit.
//
//   node --test test/js/inventaire.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const inventaire = require(path.join(COCKPIT, 'lib', 'inventaire.js'));

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-inventaire-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });

// Une seconde d'écart par entrée : l'ordre « plus récent d'abord » ne dépend d'aucun hasard.
let horloge = Date.UTC(2026, 8, 1, 8, 0, 0) / 1000;
function numero(base, relatif, fichier, lignes, opts) {
  const dossier = path.join(base, ...relatif);
  fs.mkdirSync(dossier, { recursive: true });
  const sep = (opts && opts.crlf) ? '\r\n' : '\n';
  const texte = ((opts && opts.bom) ? '﻿' : '') + lignes.join(sep) + sep;
  if (fichier) { fs.writeFileSync(path.join(dossier, fichier), texte, 'utf8'); }
  horloge += 1;
  fs.utimesSync(dossier, horloge, horloge);
  return dossier;
}

// Un poste : son ProgramData (config.json), son dossier d'utilisateur et son OneDrive.
function poste(nom, config) {
  const racine = path.join(TRAVAIL, nom);
  const programData = path.join(racine, 'ProgramData');
  fs.mkdirSync(path.join(programData, 'toolkit'), { recursive: true });
  fs.writeFileSync(path.join(programData, 'config.json'), JSON.stringify(config), 'utf8');
  const local = path.join(racine, 'Local');
  fs.mkdirSync(local, { recursive: true });
  return { racine, programData, local, profil: path.join(racine, 'Profil'), onedrive: path.join(racine, 'OneDrive') };
}

// Arborescence d'essai : tout ce que la liste doit trier, filtrer ou ignorer.
function remplir(base) {
  numero(base, ['_Archive', 'Revue', '2020-05'], 'ausgabe.yaml', ['title: "Archivé"', 'revue: revue']);
  numero(base, ['_Archive', 'Revue', '2021-01'], 'ausgabe.yaml', ['title: Ancien', 'revue: "revue"', 'locked: true']);
  numero(base, ['Revue', '2026-01'], 'ausgabe.yaml', ['title: "Marqué archivé"', 'revue: revue', 'archived: oui']);
  numero(base, ['Revue', '2026-02'], 'ausgabe.yaml', ['title: \'Deux\'', 'revue: "Revue suisse"', 'locked: true'],
    { bom: true, crlf: true });
  numero(base, ['Revue', '2026-03'], 'ausgabe.yaml', ['title: "Trois # pas un commentaire" # note', 'revue: revue',
    'title: "second titre ignoré"']);
  numero(base, ['Revue', '2026-08'], 'ausgabe.yaml', ['title: "Sans jeton"']);
  numero(base, ['Revue', '2026-09'], 'ausgabe.yaml', ['title: "Rangé du mauvais côté"', 'revue: zeitschrift']);
  numero(base, ['Revue', 'notes'], null, []);
  numero(base, ['Zeitschrift', '2026-04'], 'ausgabe.yaml', ['title: "Heft vier"', 'revue: zeitschrift']);
  numero(base, ['Books', '2026-B13-Ecole'], 'buch.yaml', ['titre: "École et handicap"', 'locked: oui']);
  numero(base, ['Books', '2025-B12-Sans'], 'buch.yaml', ['lang: fr']);
  numero(base, ['_Archive', 'Books', '2020-B1-Alt'], 'buch.yaml', ['titre: Alt']);
}

// Le socle PowerShell, sur ce poste : la racine active, le mode, et les deux racines de chaque
// produit, en JSON.
function lanceurPowerShell(p, env) {
  const commande = '. "' + COMMUN_PS1 + '"; $e = Get-SzhEmplacements; $r = [ordered]@{ racineBase = $e.base; ' +
    'modeTest = ($e.emplacement -eq $SzhEmplacementTest); produits = [ordered]@{} }; ' +
    "foreach ($j in @('revue', 'zeitschrift', 'livre')) { $r.produits[$j] = [ordered]@{ " +
    "racineEnCours = (Get-SzhEmplacementRevue $j 'encours'); racineArchive = (Get-SzhEmplacementRevue $j 'archive') } }; " +
    '[Console]::Out.Write(($r | ConvertTo-Json -Depth 4 -Compress))';
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', commande], {
    encoding: 'utf8', windowsHide: true, timeout: 90000,
    env: Object.assign({}, process.env, {
      SZH_BASE: p.programData, SZH_LANCEUR_SIMULE: '1', LOCALAPPDATA: p.local, OneDrive: p.onedrive,
      SZH_ANCRAGE: '', SZH_RACINE_TEST: '', SZH_RACINE_PROD: ''
    }, env)
  });
  assert.strictEqual(run.status, 0, 'socle PowerShell : ' + run.stdout + run.stderr);
  return JSON.parse(run.stdout.trim());
}

// Le module, avec le même environnement le temps de l'appel.
function lanceurJs(p, env) {
  const voulu = Object.assign({
    SZH_BASE: p.programData, SZH_CONFIG_OJS: path.join(p.programData, 'config.json'),
    LOCALAPPDATA: p.local, OneDrive: p.onedrive, SZH_ANCRAGE: '', SZH_RACINE_TEST: '', SZH_RACINE_PROD: ''
  }, env);
  const avant = {};
  for (const k of Object.keys(voulu)) { avant[k] = process.env[k]; process.env[k] = voulu[k]; }
  try { return inventaire.inventaire(); }
  finally {
    for (const k of Object.keys(avant)) {
      if (avant[k] === undefined) { delete process.env[k]; } else { process.env[k] = avant[k]; }
    }
  }
}

// Les listes de numéros n'existent que côté Node, et chaque test les vérifie directement ;
// la parité porte sur les racines, que PowerShell et le module calculent chacun.
function comparer(ps, js) {
  assert.strictEqual(js.base, ps.racineBase, 'racine active');
  assert.strictEqual(js.modeTest, ps.modeTest, 'mode test');
  for (const jeton of inventaire.ORDRE) {
    const a = ps.produits[jeton];
    const b = js.produits[jeton];
    assert.strictEqual(b.racineEnCours, a.racineEnCours, jeton + ' : racine en cours');
    assert.strictEqual(b.racineArchive, a.racineArchive, jeton + ' : racine des archives');
  }
}

test('inventaire : mêmes racines que le socle PowerShell, en emplacement de test', { skip: sansPowerShell }, () => {
  const p = poste('test', { emplacementRevues: 'test', revuesRoots: [path.join(TRAVAIL, 'test', 'Ancien')] });
  const base = path.join(p.racine, 'Base');
  remplir(base);
  numero(p.racine, ['Ancien', '2019-01'], 'ausgabe.yaml', ['revue: revue']);
  numero(p.racine, ['Ancien', 'vide'], null, []);
  numero(p.onedrive, ['Revues', '2018-02'], 'ausgabe.yaml', ['revue: zeitschrift']);
  const env = { SZH_RACINE_TEST: base, SZH_RACINE_PROD: path.join(p.racine, 'Prod') };
  const ps = lanceurPowerShell(p, env);
  const js = lanceurJs(p, env);
  comparer(ps, js);
  // Les valeurs attendues, explicites : deux listes vides seraient sinon « égales ».
  assert.deepStrictEqual(js.produits.revue.enCours.map((e) => e.nom), ['2026-03', '2026-02']);
  assert.deepStrictEqual(js.produits.revue.archives.map((e) => e.nom), ['2026-01', '2021-01', '2020-05']);
  assert.deepStrictEqual(js.produits.revue.hors, { nombre: 2, dossier: path.join(p.racine, 'Ancien') });
  assert.strictEqual(js.produits.revue.enCours[0].titre, 'Trois # pas un commentaire');
  assert.strictEqual(js.produits.zeitschrift.enCours.length, 1);
  assert.deepStrictEqual(js.produits.livre.enCours.map((e) => [e.titre, e.verrouillee]),
    [['', false], ['École et handicap', true]]);
  assert.strictEqual(js.ancrageAbsent, false);
});

test('inventaire : même racine de production que le socle, dérivée de l’ancrage', { skip: sansPowerShell }, () => {
  const p = poste('prod', { emplacementRevues: 'production' });
  const ancrage = path.join(p.racine, 'SZH', 'Daten_Allgemein - General');
  const base = path.join(ancrage, '2_Produkte', '54_Pronto');
  remplir(base);
  const env = { SZH_ANCRAGE: ancrage, SZH_RACINE_TEST: path.join(p.racine, 'Essai') };
  const ps = lanceurPowerShell(p, env);
  const js = lanceurJs(p, env);
  comparer(ps, js);
  assert.strictEqual(js.base, base);
  assert.strictEqual(js.produits.revue.enCours.length, 2);
});

test('inventaire : même racine par défaut que le socle, sans surcharge ni ancrage', { skip: sansPowerShell }, () => {
  const p = poste('defaut', { emplacementRevues: 'test' });
  const env = { USERPROFILE: p.profil };
  remplir(path.join(p.profil, 'OneDrive - SZH CSPS', 'Revues-TESTING'));
  const ps = lanceurPowerShell(p, env);
  const js = lanceurJs(p, env);
  comparer(ps, js);
  assert.strictEqual(js.base, path.join(p.profil, 'OneDrive - SZH CSPS', 'Revues-TESTING'));
});

// L'ancrage se normalise en chemin Windows : ce cas ne se joue que sous Windows.
const SAUT_WIN = process.platform !== 'win32' ? 'chemins Windows — joué par le job contrats-windows' : false;

test('inventaire : la surcharge d’essai passe avant l’ancrage, l’ancrage avant le défaut', { skip: SAUT_WIN }, () => {
  const p = poste('ordre', { emplacementRevues: 'production' });
  const ancrage = path.join(p.racine, 'Daten_Allgemein - General');
  fs.mkdirSync(ancrage, { recursive: true });
  const essai = path.join(p.racine, 'Essai');
  assert.strictEqual(lanceurJs(p, { SZH_RACINE_PROD: essai, SZH_ANCRAGE: ancrage }).base, essai);
  assert.strictEqual(lanceurJs(p, { SZH_ANCRAGE: ancrage }).base, path.join(ancrage, '2_Produkte', '54_Pronto'));
  const sansAncrage = lanceurJs(p, { USERPROFILE: p.profil });
  assert.strictEqual(sansAncrage.base,
    path.join(p.profil + '\\SZH CSPS\\Daten_Allgemein - General', '2_Produkte', '54_Pronto'));
  assert.strictEqual(sansAncrage.ancrageAbsent, true, 'en production, un ancrage introuvable se dit');
});

test('inventaire : le YAML plat garde la première clé et retire guillemets et commentaire', () => {
  const f = path.join(TRAVAIL, 'plat.yaml');
  fs.writeFileSync(f, '﻿title: "A # B" # c\r\nlocked: oui # vrai\r\ntitle: autre\r\n  revue: x\r\nnu: valeur # fin\r\n');
  assert.deepStrictEqual(inventaire.lireYamlPlat(f), { title: 'A # B', locked: 'oui', nu: 'valeur' });
  assert.deepStrictEqual(inventaire.lireYamlPlat(path.join(TRAVAIL, 'absent.yaml')), {});
});
