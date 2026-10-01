// Le lanceur Windows n'écrit plus les compteurs d'usage : Send-SzhConstatsNettoyeur
// (windows/lanceur-preproc.ps1) passe par outils/compteurs-cli.js, sous le Node de VSCodium, et
// lib/compteurs.js reste le seul écrivain (son contenu est éprouvé par compteurs-cli.test.js et
// compteurs.test.js). Ce fichier garde le câblage :
//
//   - le jumeau PowerShell a disparu, et rien ne le charge ni ne l'appelle plus ;
//   - le lanceur appelle l'outil avec le bon JSON, sans lever, et sans VSCodium ni outil le
//     compteur est perdu sans bruit ;
//   - de bout en bout, avec le node.exe de ce poste en guise de VSCodium : le fichier arrive,
//     et les gardes de simulation tiennent.
//
//   node --test test/js/compteurs-ps.test.js
//
// Aucun test ne touche le vrai dossier partagé ni le vrai %LOCALAPPDATA% : SZH_BASE,
// LOCALAPPDATA, USERPROFILE, SZH_COMPTEURS et SZH_ANCRAGE visent toujours des dossiers jetables.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const SZH_COMMON = path.join(RACINE, 'windows', 'szh-common.ps1');

const ENTETE = 'date;poste;contexte;version_toolkit;version_rootfs;source;passage;mesure;valeur';
const SENTINELLE = 'SENTINELLE-MANUSCRIT-8c41f2';

function psChaine(v) { return "'" + String(v).replace(/['\u2018\u2019\u201A\u201B]/g, (m) => m + m) + "'"; }

function dossierJetable(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }

// L'environnement d'un pilote : tout ce qui pourrait viser le vrai poste est retiré, puis les
// dossiers jetables posés.
function environnement(travail, extra) {
  const env = Object.assign({}, process.env);
  for (const k of ['OneDrive', 'OneDriveCommercial', 'SZH_ANCRAGE', 'SZH_RAPPORTS', 'SZH_COMPTEURS',
    'SZH_LANCEUR_SIMULE', 'SZH_OPENMD_SIMULE', 'SZH_RESEAU_INTERDIT', 'SZH_MANUSCRIT_CLI',
    'SZH_CODIUM_PROFIL', 'SZH_TOOLKIT']) { delete env[k]; }
  Object.assign(env, {
    SZH_BASE: path.join(travail, 'programdata'),
    LOCALAPPDATA: path.join(travail, 'localappdata'),
    USERPROFILE: path.join(travail, 'profil'),
    SZH_LANGUE: 'fr',
    COMPUTERNAME: 'rmo-test_é1'
  }, extra || {});
  for (const k of ['SZH_BASE', 'LOCALAPPDATA', 'USERPROFILE']) { fs.mkdirSync(env[k], { recursive: true }); }
  return env;
}

function ecrirePilote(travail, script) {
  const pilote = path.join(travail, 'pilote-' + Math.random().toString(16).slice(2) + '.ps1');
  fs.writeFileSync(pilote, '\ufeff' + ["$ErrorActionPreference = 'Stop'", '. ' + psChaine(SZH_COMMON), script].join('\r\n') + '\r\n', 'utf8');
  return pilote;
}

function lancer(travail, env, script) {
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ecrirePilote(travail, script)],
    { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function csvs(dossier) {
  try { return fs.readdirSync(dossier).filter((f) => f.endsWith('.csv')).sort(); } catch (e) { return []; }
}


const LANCEUR_PREPROC = path.join(RACINE, 'windows', 'lanceur-preproc.ps1');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const TEXTE_LANCEUR = fs.readFileSync(LANCEUR_PREPROC, 'utf8');

// La définition de Send-SzhConstatsNettoyeur telle que le lanceur la porte, sans la recopier.
function extraireFonction(nom) {
  const debut = TEXTE_LANCEUR.indexOf('\nfunction ' + nom + ' {');
  assert.ok(debut !== -1, 'fonction introuvable dans le lanceur : ' + nom);
  const fin = TEXTE_LANCEUR.indexOf('\n}', debut + 1);
  assert.ok(fin !== -1, 'fin de fonction introuvable : ' + nom);
  return TEXTE_LANCEUR.slice(debut + 1, fin + 2);
}
const SEND_CONSTATS = extraireFonction('Send-SzhConstatsNettoyeur');

// Un pilote : le socle chargé, puis `avant` (stubs), la fonction du lanceur, et `corps`.
// Ce que le lanceur ferait après les compteurs (rapports d'erreur) est remplacé par des coquilles vides.
function piloter(travail, env, avant, corps) {
  const sortie = path.join(travail, 'r.json');
  const script = avant.concat([
    'function Send-SzhRapportNettoyeur { param($Etape, $Contenu, $Produit) }',
    'function ConvertTo-SzhNettoyeurContenu { param($Stats, $CodeSortie, $Echec, $Phase) return [ordered]@{ etape = "x" } }',
    SEND_CONSTATS,
    '$r = [ordered]@{}',
  ]).concat(corps).concat(['Set-SzhJson ' + psChaine(sortie) + ' $r']).join('\r\n');
  const run = lancer(travail, env, script);
  return { run, r: fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null };
}

const FAUX_VSCODIUM = 'function Get-VSCodiumExe { return ' + psChaine(process.execPath) + ' }';
const STUB_NODE = [
  '$script:appels = New-Object System.Collections.ArrayList',
  'function Invoke-SzhNodeCockpit { param([string]$Outil, $Entree, [switch]$SansLever)',
  '  [void]$script:appels.Add([pscustomobject]@{ outil = $Outil; sansLever = [bool]$SansLever; entree = ($Entree | ConvertTo-Json -Depth 6 -Compress) })',
  '  return $null',
  '}',
];

function statsCompteurs(passage, mesures) {
  return '$stats = ' + psChaine(JSON.stringify({ compteurs: { passage, mesures } })) + ' | ConvertFrom-Json';
}

function appelConstats(stats, interrompu, ok, chemin) {
  return 'Send-SzhConstatsNettoyeur -Stats ' + stats + ' -CodeSortie ' + (ok ? 0 : 1) + ' -Interrompu $' + interrompu
    + ' -PhaseEchec "" -Produit "revue" -CheminManuscrit ' + psChaine(chemin) + ' -Ok $' + ok;
}

test('le jumeau PowerShell a disparu : plus de fichier, plus de dot-source, plus d’appel', () => {
  assert.ok(!fs.existsSync(path.join(RACINE, 'windows', 'szh-compteurs.ps1')));
  for (const f of fs.readdirSync(path.join(RACINE, 'windows')).filter((n) => n.endsWith('.ps1'))) {
    const texte = fs.readFileSync(path.join(RACINE, 'windows', f), 'utf8');
    assert.ok(!/szh-compteurs\.ps1|Write-SzhCompteurs|Clear-SzhCompteursEnAttente|Get-SzhCompteursPassage/.test(texte),
      f + ' référence encore l’écrivain PowerShell des compteurs');
  }
  assert.ok(fs.existsSync(path.join(COCKPIT, 'outils', 'compteurs-cli.js')));
});

test('le lanceur appelle outils/compteurs-cli.js, sans lever, avec le JSON de la CLI du nettoyeur',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-cable-');
    try {
      const { run, r } = piloter(travail, environnement(travail), STUB_NODE, [
        statsCompteurs('abcdef012345', { 'issue.ok': 1, signes: 5000 }),
        appelConstats('$stats', 'false', 'true', 'C:\\x\\a.docx'),
        '$r.appels = @($script:appels)',
      ]);
      assert.ok(r, run.stderr + run.stdout);
      assert.equal(r.appels.length, 1);
      assert.equal(r.appels[0].outil, 'compteurs-cli.js');
      assert.equal(r.appels[0].sansLever, true, 'sans VSCodium ni outil : rien ne doit lever');
      assert.deepStrictEqual(JSON.parse(r.appels[0].entree), {
        source: 'nettoyeur', passage: 'abcdef012345', fichier: '', mesures: { 'issue.ok': 1, signes: 5000 }
      });
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('rien n’est revenu de la CLI : un compteur minimal pour l’issue, avec le fichier pour le passage',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-minimal-');
    try {
      const { run, r } = piloter(travail, environnement(travail), STUB_NODE, [
        appelConstats('$null', 'true', 'false', 'C:\\x\\a.docx'),
        '$r.interrompu = @($script:appels)',
        '$script:appels.Clear()',
        appelConstats('$null', 'false', 'false', 'C:\\x\\a.docx'),
        '$r.plantage = @($script:appels)',
      ]);
      assert.ok(r, run.stderr + run.stdout);
      const attendu = (issue) => ({
        source: 'nettoyeur', passage: '', fichier: 'C:\\x\\a.docx', mesures: { ['issue.' + issue]: 1, 'produit.revue': 1 }
      });
      assert.deepStrictEqual(JSON.parse(r.interrompu[0].entree), attendu('interrompu'));
      assert.deepStrictEqual(JSON.parse(r.plantage[0].entree), attendu('plantage'));
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });

test('sans VSCodium, ou sans l’outil dans le cockpit : le compteur est perdu, sans erreur ni message',
  { skip: sansPowerShell }, () => {
    const variantes = [
      { nom: 'VSCodium absent', avant: ['function Get-VSCodiumExe { return $null }'], cockpit: COCKPIT },
      { nom: 'outil absent', avant: [FAUX_VSCODIUM], cockpit: null },
    ];
    for (const v of variantes) {
      const travail = dossierJetable('szh-compteurs-perdu-');
      try {
        const dossier = path.join(travail, 'compteurs');
        const cockpit = v.cockpit || path.join(travail, 'cockpit-vide');
        fs.mkdirSync(path.join(travail, 'cockpit-vide', 'outils'), { recursive: true });
        const env = environnement(travail, { SZH_COMPTEURS: dossier, SZH_COCKPIT_DOSSIER: cockpit });
        const { run, r } = piloter(travail, env, v.avant, [
          statsCompteurs('abcdef012345', { 'issue.ok': 1 }),
          appelConstats('$stats', 'false', 'true', 'C:\\x\\a.docx'),
          '$r.fin = "ok"',
        ]);
        assert.ok(r && r.fin === 'ok', v.nom + ' : ' + run.stderr + run.stdout);
        assert.equal(run.status, 0, v.nom);
        assert.equal(run.stdout.trim(), '', v.nom + ' : rien ne doit sortir');
        assert.equal(run.stderr.trim(), '', v.nom + ' : aucune erreur');
        assert.deepStrictEqual(csvs(dossier), [], v.nom);
      } finally {
        fs.rmSync(travail, { recursive: true, force: true });
      }
    }
  });

test('de bout en bout : le fichier arrive dans SZH_COMPTEURS ; en simulation sans SZH_COMPTEURS, rien',
  { skip: sansPowerShell }, () => {
    const travail = dossierJetable('szh-compteurs-bout-');
    try {
      const manuscrit = path.join(travail, 'manuscrit.docx');
      fs.writeFileSync(manuscrit, 'contenu du manuscrit', 'utf8');
      const sha = require('crypto').createHash('sha256').update('contenu du manuscrit').digest('hex').slice(0, 12);
      const dossier = path.join(travail, 'compteurs');
      const appel = [
        statsCompteurs('abcdef012345', { 'issue.ok': 1, signes: 5000, [SENTINELLE]: 3 }),
        appelConstats('$stats', 'false', 'true', manuscrit),
        appelConstats('$null', 'false', 'false', manuscrit),
      ];
      const base = { SZH_COCKPIT_DOSSIER: COCKPIT };
      const { run } = piloter(travail, environnement(travail, Object.assign({ SZH_COMPTEURS: dossier }, base)), [FAUX_VSCODIUM], appel);
      assert.equal(run.status, 0, run.stderr);
      const fichiers = csvs(dossier);
      assert.equal(fichiers.length, 2, JSON.stringify(fichiers) + run.stderr);
      const textes = fichiers.map((f) => fs.readFileSync(path.join(dossier, f), 'utf8'));
      assert.ok(textes.every((t) => t.startsWith('\uFEFF' + ENTETE + '\r\n') && !t.includes(SENTINELLE)));
      assert.ok(textes.some((t) => t.includes(';nettoyeur;abcdef012345;issue.ok;1\r\n') && t.includes(';signes;5000\r\n')));
      assert.ok(textes.some((t) => t.includes(';nettoyeur;' + sha + ';issue.plantage;1\r\n')), 'le passage vient du fichier');

      const simule = dossierJetable('szh-compteurs-simule-');
      try {
        const env = environnement(simule, Object.assign({ SZH_LANCEUR_SIMULE: '1' }, base));
        const s = piloter(simule, env, [FAUX_VSCODIUM], appel);
        assert.equal(s.run.status, 0, s.run.stderr);
        assert.ok(!fs.existsSync(path.join(env.LOCALAPPDATA, 'SZH', 'compteurs-en-attente')), 'rien dans la file en simulation');
      } finally {
        fs.rmSync(simule, { recursive: true, force: true });
      }
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });
