// Le remplacement atomique du toolkit : Install-SzhToolkitDepuisArchive (szh-common.ps1).
//
//   node --test test/js/toolkit-remplacement.test.js
//
// La fonction construit la nouvelle version à part (<toolkit>.neuf : copie de l'actuel,
// complétée par l'archive, nettoyée de ses orphelins), puis bascule par un renommage NTFS
// ([System.IO.Directory]::Move), qui réussit ou échoue en entier. Move-Item ne convient pas :
// il recopie dossier par dossier et peut, sur un fichier verrouillé, laisser le toolkit
// coupé en deux sans lever d'erreur.
//
// $SZH_BASE, lue par szh-common.ps1 à son chargement, redirige $SzhBase (donc $SzhToolkit et
// $SzhStaging) vers une arborescence jetable, à la place de C:\ProgramData\SZH.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');

const { POWERSHELL, sansPowerShell } = require('./gardes');

// Windows PowerShell 5.1 lit un .ps1 sans BOM dans la page de code ANSI du poste : le BOM
// garde les accents des pilotes.
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\uFEFF' + contenu, 'utf8');
}

// Pose un fichier par entrée de `relatifs` sous `racine` ; seul le nom compte.
function poserArbre(racine, relatifs) {
  for (const rel of relatifs) {
    const p = path.join(racine, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'x', 'utf8');
  }
}

// ---- Scénario (a) : nominal, avec une vraie archive .zip ----
//
// L'ancien toolkit porte un fichier en trop (pipeline/vieux-filtre.py) et un VERSION
// périmé ; le zip apporte VERSION à jour et les cinq dossiers gérés. Le résultat est
// exactement le contenu du zip.

const bilanNominal = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-toolkit-nominal-'));
  const base = path.join(travail, 'ProgramData');
  const toolkit = path.join(base, 'toolkit');
  const zipSource = path.join(travail, 'zip-source');
  const zip = path.join(travail, 'toolkit-2026.09.01.zip');
  const sortie = path.join(travail, 'bilan.json');
  const pilote = path.join(travail, 'eprouver.ps1');

  poserArbre(toolkit, [
    'VERSION',
    'pipeline/garde.md', 'pipeline/vieux-filtre.py',
    'vscodium-user/garde.md', 'revue-template/garde.md',
    'livre-template/garde.md', 'windows/garde.md'
  ]);
  fs.writeFileSync(path.join(toolkit, 'VERSION'), '2026.08.40', 'utf8');

  poserArbre(zipSource, [
    'VERSION',
    'pipeline/garde.md',
    'vscodium-user/garde.md', 'revue-template/garde.md',
    'livre-template/garde.md', 'windows/garde.md'
  ]);
  fs.writeFileSync(path.join(zipSource, 'VERSION'), '2026.09.01', 'utf8');

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$env:SZH_BASE = '" + base + "'",
    '. "' + COMMUN_PS1 + '"',
    "$sortie = '" + sortie + "'",
    "Compress-Archive -Path (Join-Path '" + zipSource + "' '*') -DestinationPath '" + zip + "' -Force",
    "$bilan = Install-SzhToolkitDepuisArchive -Zip '" + zip + "' -Toolkit $SzhToolkit -DossierTravail $SzhStaging",
    '$fichiers = @(Get-ChildItem -LiteralPath $SzhToolkit -Recurse -File |',
    '  ForEach-Object { $_.FullName.Substring($SzhToolkit.Length + 1) -replace "\\\\", "/" } | Sort-Object)',
    '$version = Get-Content (Join-Path $SzhToolkit "VERSION") -Raw',
    '$r = [ordered]@{ retires = @($bilan.retires); avertissements = @($bilan.avertissements)',
    '  fichiers = $fichiers; version = $version.Trim()',
    '  toolkitEqualsSzhToolkit = ($SzhToolkit -eq (Join-Path $env:SZH_BASE "toolkit"))',
    '  neufReste = (Test-Path ($SzhToolkit + ".neuf")); vieuxReste = (Test-Path ($SzhToolkit + ".vieux")) }',
    'Set-SzhJson $sortie $r'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);

  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('remplacement atomique : $SZH_BASE redirige bien $SzhToolkit vers l’arborescence jetable',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(bilanNominal.status, 0, 'le pilote PowerShell a échoué : ' + bilanNominal.stderr);
    assert.strictEqual(bilanNominal.r.toolkitEqualsSzhToolkit, true,
      'SZH_BASE ne redirige plus $SzhToolkit — les tests écriraient sous C:\\ProgramData\\SZH');
  });

test('remplacement atomique, cas nominal : le résultat est exactement le contenu du zip',
  { skip: sansPowerShell }, () => {
    const r = bilanNominal.r;
    assert.deepStrictEqual(r.retires, ['pipeline\\vieux-filtre.py'],
      'l’orphelin (pipeline/vieux-filtre.py) n’a pas été écarté de la copie');
    assert.deepStrictEqual(r.avertissements, []);
    assert.deepStrictEqual(r.fichiers.slice().sort(), [
      'VERSION', 'livre-template/garde.md', 'pipeline/garde.md',
      'revue-template/garde.md', 'vscodium-user/garde.md', 'windows/garde.md'
    ].sort(), 'le toolkit final n’est pas exactement le contenu du zip : ' + JSON.stringify(r.fichiers));
    assert.strictEqual(r.version, '2026.09.01', 'VERSION n’a pas été remplacé par celui du zip');
  });

test('remplacement atomique, cas nominal : aucun .neuf ni .vieux ne survit à une passe réussie',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(bilanNominal.r.neufReste, false, 'toolkit.neuf traîne encore après la bascule');
    assert.strictEqual(bilanNominal.r.vieuxReste, false, 'toolkit.vieux traîne encore après la bascule');
  });

// ---- Scénario (b) : la bascule échoue (fichier encore ouvert) ----
//
// Le pilote ouvre un handle exclusif sur un fichier du toolkit avant l'appel : le premier
// renommage (toolkit -> toolkit.vieux) est refusé en bloc. Quel que soit le renommage qui
// échoue, on attend une erreur claire, le toolkit d'origine intact, ni .neuf ni .vieux.

const bilanEchec = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-toolkit-echec-'));
  const base = path.join(travail, 'ProgramData');
  const toolkit = path.join(base, 'toolkit');
  const zipSource = path.join(travail, 'zip-source');
  const zip = path.join(travail, 'toolkit-2026.09.01.zip');
  const sortie = path.join(travail, 'bilan.json');
  const pilote = path.join(travail, 'eprouver.ps1');

  poserArbre(toolkit, ['VERSION', 'windows/garde.md', 'windows/update.ps1']);
  fs.writeFileSync(path.join(toolkit, 'VERSION'), '2026.08.40', 'utf8');
  poserArbre(zipSource, ['VERSION', 'windows/garde.md']);
  fs.writeFileSync(path.join(zipSource, 'VERSION'), '2026.09.01', 'utf8');

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$env:SZH_LANGUE = 'fr'",   // message attendu déterministe, sans dépendre de la langue du poste
    "$env:SZH_BASE = '" + base + "'",
    '. "' + COMMUN_PS1 + '"',
    "$sortie = '" + sortie + "'",
    "$zip = '" + zip + "'",
    "Compress-Archive -Path (Join-Path '" + zipSource + "' '*') -DestinationPath $zip -Force",
    // Le handle reste ouvert pendant tout l'appel ; FileShare.None interdit même la lecture.
    '$verrou = [System.IO.File]::Open((Join-Path $SzhToolkit "windows\\update.ps1"), ' +
      '[System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)',
    '$leve = $false; $message = ""',
    'try {',
    '  Install-SzhToolkitDepuisArchive -Zip $zip -Toolkit $SzhToolkit -DossierTravail $SzhStaging | Out-Null',
    '} catch {',
    '  $leve = $true; $message = $_.Exception.Message',
    '} finally {',
    '  $verrou.Close()',
    '}',
    '$fichiersRestants = @(Get-ChildItem -LiteralPath $SzhToolkit -Recurse -File |',
    '  ForEach-Object { $_.FullName.Substring($SzhToolkit.Length + 1) -replace "\\\\", "/" } | Sort-Object)',
    '$r = [ordered]@{ leve = $leve; message = $message',
    '  versionInchangee = (Get-Content (Join-Path $SzhToolkit "VERSION") -Raw).Trim()',
    '  fichiersRestants = $fichiersRestants',
    '  neufReste = (Test-Path ($SzhToolkit + ".neuf")); vieuxReste = (Test-Path ($SzhToolkit + ".vieux")) }',
    'Set-SzhJson $sortie $r'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);

  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('remplacement atomique, bascule impossible : une erreur claire est levée', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilanEchec.status, 0, 'le pilote PowerShell a échoué : ' + bilanEchec.stderr);
  assert.strictEqual(bilanEchec.r.leve, true,
    'la bascule aurait dû échouer (fichier verrouillé par le pilote lui-même) mais n’a rien levé');
  assert.match(bilanEchec.r.message, /toolkit/i, 'le message levé ne nomme pas le toolkit : ' + bilanEchec.r.message);
  assert.match(bilanEchec.r.message, /éditeur|fermez/i,
    'le message ne dit pas de fermer l’éditeur et de relancer : ' + bilanEchec.r.message);
});

test('remplacement atomique, bascule impossible : le toolkit d’origine est intact', { skip: sansPowerShell }, () => {
  const r = bilanEchec.r;
  assert.strictEqual(r.versionInchangee, '2026.08.40', 'VERSION a changé alors que la bascule a échoué');
  assert.deepStrictEqual(r.fichiersRestants.slice().sort(),
    ['VERSION', 'windows/garde.md', 'windows/update.ps1'].sort(),
    'le toolkit d’origine n’est plus intact après l’échec de la bascule : ' + JSON.stringify(r.fichiersRestants));
});

test('remplacement atomique, bascule impossible : aucun .neuf ni .vieux ne reste derrière l’échec',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(bilanEchec.r.neufReste, false,
      'toolkit.neuf est resté après l’échec : la prochaine passe le trouverait déjà là');
    assert.strictEqual(bilanEchec.r.vieuxReste, false,
      'toolkit.vieux est resté après l’échec : le poste semblerait avoir deux toolkits');
  });
