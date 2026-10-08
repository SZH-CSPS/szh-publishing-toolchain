// Les fichiers temporaires des écritures atomiques de rapports d'erreur, côté cockpit
// (lib/rapport-erreur.js) et côté lanceur (Write-SzhRapportSurDisque, windows/szh-rapport.ps1) :
// - le temporaire porte le préfixe « ~$ », que OneDrive ne synchronise pas ;
// - il est supprimé quand l'écriture échoue, sinon il resterait dans le dossier partagé.
// Une écriture réussie ne montre ni l'un ni l'autre : les tests observent le nom du
// temporaire pendant l'écriture et font échouer le renommage.
//
//   node --test test/js/temporaires-atomiques.test.js
//
// Tout se passe dans des dossiers jetables.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const RAPPORT_PS1 = path.join(RACINE, 'windows', 'szh-rapport.ps1');
const SOURCE_RAPPORT_PS = fs.readFileSync(RAPPORT_PS1, 'utf8');

const rapportErreur = require(path.join(COCKPIT, 'lib', 'rapport-erreur'));
const yaml = require(path.join(COCKPIT, 'lib', 'yaml'));

// Détection partagée (gardes.js) : sous un runner simulé sans PowerShell, elle rend
// « indisponible » au lieu d'appeler le vrai powershell.exe.
const { POWERSHELL, sansPowerShell } = require('./gardes');

function jetable(prefixe) { return fs.mkdtempSync(path.join(os.tmpdir(), prefixe)); }

// ---------------------------------------------------------------------------------------
// 1. Le nom du temporaire, observé pendant l'écriture
// ---------------------------------------------------------------------------------------
//
// lib/rapport-erreur.js partage l'objet `fs` de ce banc : remplacer writeFileSync le temps
// d'un appel donne le chemin que le module a réellement écrit.
function espionnerEcriture() {
  const vus = [];
  const vrai = fs.writeFileSync;
  fs.writeFileSync = function (chemin) {
    vus.push(String(chemin));
    return vrai.apply(fs, arguments);
  };
  return { vus: vus, rendre: () => { fs.writeFileSync = vrai; } };
}

const CHAMPS_MINIMAUX = {
  gravite: 'erreur', source: 'cockpit', code: 'COCKPIT-EXCEPTION',
  etape: 'essai', message: 'un message sans secret'
};

// SZH_RAPPORTS nomme directement le dossier d'écriture, SZH_BASE et LOCALAPPDATA tiennent
// lieu de C:\ProgramData\SZH et de l'état par compte : rien ne sort du dossier jetable.
function avecSandbox(travail, fn) {
  const avant = {
    SZH_RAPPORTS: process.env.SZH_RAPPORTS,
    SZH_BASE: process.env.SZH_BASE,
    LOCALAPPDATA: process.env.LOCALAPPDATA
  };
  process.env.SZH_RAPPORTS = path.join(travail, 'rapports');
  process.env.SZH_BASE = path.join(travail, 'ProgramData');
  process.env.LOCALAPPDATA = path.join(travail, 'Local');
  try { return fn(process.env.SZH_RAPPORTS); } finally {
    for (const cle of Object.keys(avant)) {
      if (avant[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = avant[cle]; }
    }
  }
}

test('cockpit : le temporaire vit à côté de sa cible, préfixé « ~$ », et n’est jamais un .json', () => {
  const cible = path.join('C:', 'dossier', 'rapports', 'abc123.json');
  const compose = rapportErreur.cheminTemporaire(cible);
  assert.strictEqual(path.dirname(compose), path.dirname(cible),
    'le temporaire doit vivre dans LE MÊME dossier que sa cible : un renommage n’est '
    + 'atomique qu’à l’intérieur d’un volume');
  assert.ok(path.basename(compose).startsWith('~$'),
    'le temporaire ne porte pas le préfixe « ~$ », le seul que OneDrive ignore : '
    + path.basename(compose));
  assert.ok(!compose.endsWith('.json'),
    'un temporaire qui finit par « .json » serait listé comme un rapport en attente');
  // Deux écritures simultanées (deux fenêtres de l'éditeur) ne doivent pas se marcher dessus.
  assert.notStrictEqual(compose, rapportErreur.cheminTemporaire(cible));
});

test('cockpit : un rapport écrit pour de vrai passe par « ~$ » et ne laisse rien derrière', () => {
  const travail = jetable('szh-tmp-reussi-');
  const espion = espionnerEcriture();
  try {
    avecSandbox(travail, (dossier) => {
      fs.mkdirSync(dossier, { recursive: true });
      const sortie = rapportErreur.emettreRapport(CHAMPS_MINIMAUX);
      assert.ok(sortie && sortie.ecrit, 'le rapport n’a pas été écrit : ' + JSON.stringify(sortie));
      const dansLeDossier = espion.vus.filter((c) => path.dirname(c) === dossier);
      assert.ok(dansLeDossier.length >= 1, 'aucune écriture vue dans le dossier de rapports');
      for (const c of dansLeDossier) {
        assert.ok(path.basename(c).startsWith('~$'),
          'le rapport a été écrit sans passer par un temporaire « ~$ » : ' + c);
      }
      const restes = fs.readdirSync(dossier).filter((n) => !n.endsWith('.json'));
      assert.deepStrictEqual(restes, [], 'des temporaires sont restés : ' + restes.join(', '));
      assert.strictEqual(fs.readdirSync(dossier).length, 1,
        'le dossier devrait ne contenir que le rapport : ' + fs.readdirSync(dossier).join(', '));
    });
  } finally {
    espion.rendre();
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('cockpit : un renommage qui échoue n’abandonne pas son temporaire', () => {
  const travail = jetable('szh-tmp-echec-');
  const vraiRename = fs.renameSync;
  try {
    avecSandbox(travail, (dossier) => {
      fs.mkdirSync(dossier, { recursive: true });
      // Renommage refusé (fichier tenu par le synchroniseur, dossier disparu, disque plein)
      // alors que le temporaire est déjà écrit.
      fs.renameSync = function () { throw new Error('EPERM simulé'); };
      const sortie = rapportErreur.emettreRapport(CHAMPS_MINIMAUX);
      fs.renameSync = vraiRename;
      assert.ok(sortie && !sortie.ecrit,
        'le rapport ne pouvait pas être écrit : ' + JSON.stringify(sortie));
      assert.deepStrictEqual(fs.readdirSync(dossier), [],
        'un temporaire a été abandonné dans le dossier partagé : '
        + fs.readdirSync(dossier).join(', '));
      // Même contrat pour l'état par compte (ecrireJsonAtomique), écrit au passage par
      // l'anti-inondation : rien ne doit rester non plus.
      const local = path.join(travail, 'Local', 'SZH');
      const restesLocaux = fs.existsSync(local)
        ? fs.readdirSync(local).filter((n) => n.startsWith('~$')) : [];
      assert.deepStrictEqual(restesLocaux, [],
        'un temporaire a été abandonné dans l’état par compte : ' + restesLocaux.join(', '));
    });
  } finally {
    fs.renameSync = vraiRename;
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

test('lib/yaml.js : le motif de référence, inchangé', () => {
  // Les deux écrivains de rapports suivent ce motif : préfixe « ~$ », même dossier, finally.
  // S'il change, les trois changent ensemble.
  const travail = jetable('szh-tmp-yaml-');
  const espion = espionnerEcriture();
  try {
    const cible = path.join(travail, 'ausgabe.yaml');
    yaml.ecrireAtomique(cible, 'title: essai\n');
    assert.strictEqual(fs.readFileSync(cible, 'utf8'), 'title: essai\n');
    assert.strictEqual(espion.vus.length, 1);
    assert.ok(path.basename(espion.vus[0]).startsWith('~$'),
      'le motif de référence n’emploie plus le préfixe « ~$ » : ' + espion.vus[0]);
    assert.deepStrictEqual(fs.readdirSync(travail), ['ausgabe.yaml']);
  } finally {
    espion.rendre();
    fs.rmSync(travail, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------------------
// 2. Le même contrat, côté PowerShell
// ---------------------------------------------------------------------------------------

test('lanceur : la source de Write-SzhRapportSurDisque porte le préfixe et le finally', () => {
  const m = SOURCE_RAPPORT_PS.match(/function Write-SzhRapportSurDisque \{[\s\S]*?\n\}/);
  assert.ok(m, 'Write-SzhRapportSurDisque introuvable');
  const corps = m[0];
  assert.ok(corps.indexOf("'~$'") !== -1,
    'le temporaire du lanceur ne porte pas le préfixe « ~$ », que OneDrive ignore');
  assert.ok(corps.indexOf('.tmp-') === -1,
    'l’ancien nom de temporaire « .tmp- » est toujours là');
  assert.match(corps, /\}\s*finally\s*\{/,
    'l’exception est toujours avalée sans que le temporaire soit supprimé');
});

// Le corps d'une fonction PowerShell, du vrai fichier (même technique que
// test/js/rapport-erreur-ps.test.js).
function corpsFonction(source, nom) {
  const lignes = source.split(/\r\n|\n/);
  let debut = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].indexOf('function ' + nom) === 0) { debut = i; break; }
  }
  assert.ok(debut !== -1, 'fonction introuvable : ' + nom);
  let fin = -1;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (lignes[i] === '}') { fin = i; break; }
  }
  assert.ok(fin !== -1, 'fin de fonction introuvable : ' + nom);
  return lignes.slice(debut, fin + 1).join('\r\n');
}

test('lanceur : écriture réussie puis écriture ratée, aucun orphelin dans les deux cas',
  { skip: sansPowerShell }, () => {
    const travail = jetable('szh-tmp-ps-');
    try {
      const dossier = path.join(travail, 'rapports');
      fs.mkdirSync(dossier);
      const d = dossier.replace(/\\/g, '\\\\');
      const pilote = path.join(travail, 'pilote.ps1');
      const sortie = path.join(travail, 'sortie.json');
      const contenu = [
        "$ErrorActionPreference = 'Stop'",
        // Doublure de la mise en forme JSON, éprouvée à part dans rapport-erreur-ps.test.js.
        'function ConvertTo-SzhRapportJsonTexte { param($Objet) return (($Objet | ConvertTo-Json -Depth 20) + "`n") }',
        corpsFonction(SOURCE_RAPPORT_PS, 'Write-SzhRapportSurDisque'),
        '$sortie = [ordered]@{ }',
        "$rapport = [ordered]@{ schema = 'szh-rapport-erreur/1'; id = 'essai-01' }",
        "$sortie['reussi'] = (Write-SzhRapportSurDisque -Dossier '" + d + "' -Id 'essai-01' -Rapport $rapport)",
        // Deuxième passage, cible ouverte sans partage : le renommage échoue après
        // l'écriture du temporaire.
        "$cible = Join-Path '" + d + "' 'essai-01.json'",
        "$flux = [System.IO.File]::Open($cible, 'Open', 'ReadWrite', 'None')",
        "try {",
        "  $sortie['rate'] = (Write-SzhRapportSurDisque -Dossier '" + d + "' -Id 'essai-01' -Rapport $rapport)",
        "} finally { $flux.Close() }",
        "($sortie | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath '" + sortie.replace(/\\/g, '\\\\') + "' -Encoding UTF8"
      ].join('\r\n');
      fs.writeFileSync(pilote, '\ufeff' + contenu, 'utf8');
      const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
        { encoding: 'utf8', windowsHide: true, timeout: 120000 });
      assert.ok(fs.existsSync(sortie), 'le pilote n’a rien rendu : ' + (run.stderr || ''));
      const lu = JSON.parse(String(fs.readFileSync(sortie, 'utf8')).replace(/^\uFEFF/, ''));
      assert.strictEqual(lu.reussi, true, 'la première écriture aurait dû réussir');
      assert.strictEqual(lu.rate, false, 'la seconde écriture aurait dû échouer (cible verrouillée)');

      const restes = fs.readdirSync(dossier).filter((n) => n !== 'essai-01.json');
      assert.deepStrictEqual(restes, [],
        'des temporaires sont restés dans le dossier partagé : ' + restes.join(', '));
    } finally {
      fs.rmSync(travail, { recursive: true, force: true });
    }
  });
