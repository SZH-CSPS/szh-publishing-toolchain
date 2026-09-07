// Le remplacement atomique du toolkit : Install-SzhToolkitDepuisArchive (szh-common.ps1).
//
//   node --test "test/js/*.test.js"
//
// Le défaut corrigé ici : update.ps1, update-launcher.ps1 et bootstrap.ps1 faisaient
// Remove-SzhToolkitOrphelins puis `Expand-Archive -Force` directement dans l'arbre vivant —
// extraction fichier par fichier, avec une fenêtre où le toolkit est amputé, et un VERSION
// qui peut arriver avant les autres fichiers si la mise à jour est interrompue en cours de
// route. Install-SzhToolkitDepuisArchive construit désormais la nouvelle version à part
// (<toolkit>.neuf : copie de l'actuel, complétée par l'archive, nettoyée de ses orphelins),
// puis bascule par un renommage NTFS ([System.IO.Directory]::Move) — tout ou rien.
//
// Piège vérifié en bac à sable avant d'écrire ce fichier : PowerShell Move-Item, lui,
// RECOPIE récursivement dossier par dossier et peut laisser le toolkit coupé en deux si un
// fichier est verrouillé en cours de route (un fichier resté dans l'ancien dossier ET un
// dossier « neuf » imbriqué dans l'ancien, sans la moindre erreur levée). D'où
// [System.IO.Directory]::Move dans l'implémentation : un renommage NTFS est une seule
// opération sur le NOM du dossier, jamais sur son contenu, qui réussit ou échoue en entier.
//
// $SZH_BASE : la variable d'environnement qui redirige $SzhBase (et donc $SzhToolkit,
// $SzhStaging) vers une arborescence jetable, lue par szh-common.ps1 à son propre
// chargement — c'est elle qui rend ce fichier possible sans jamais toucher
// C:\ProgramData\SZH.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');

const POWERSHELL = (function () {
  if (process.platform !== 'win32') { return ''; }
  const candidats = [path.join(process.env.WINDIR || 'C:\\Windows',
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), 'powershell.exe'];
  for (const c of candidats) {
    const essai = spawnSync(c, ['-NoProfile', '-Command', 'exit 0'], { encoding: 'utf8' });
    if (!essai.error && essai.status === 0) { return c; }
  }
  return '';
})();
const sansPowerShell = POWERSHELL ? false : 'powershell.exe indisponible';

// Windows PowerShell 5.1 lit un .ps1 SANS BOM avec la page de code ANSI du poste, pas en
// UTF-8 : sans ce préfixe, les accents des pilotes ci-dessous ressortiraient mojibake une
// fois relus (même remarque, et même geste, que test/js/orphelins-toolkit.test.js).
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\uFEFF' + contenu, 'utf8');
}

// Pose un arbre de fichiers plats sous $racine, un par entrée de `relatifs` (contenu
// arbitraire, seul le nom compte pour ce que Remove-SzhToolkitOrphelins en fait).
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
// périmé ; le zip apporte VERSION à jour et les cinq dossiers gérés. Le résultat doit être
// EXACTEMENT le contenu du zip : plus de vieux-filtre.py, VERSION à jour.

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
// Un handle exclusif est ouvert par le pilote lui-même, AVANT d'appeler la fonction, sur un
// fichier du toolkit courant — ce qui, en bac à sable, fait échouer le premier renommage
// NTFS (Toolkit -> Toolkit.vieux) plutôt que le second : Directory.Move est tout ou rien,
// et un fichier verrouillé dans l'arbre qu'on renomme suffit à le refuser en bloc, sans
// laisser le moindre reste. C'est ce que ce test observe : quel que soit le renommage qui
// échoue en interne, le contrat tenu par Install-SzhToolkitDepuisArchive est le même —
// erreur claire, toolkit d'origine intact, aucun .neuf ni .vieux ne reste.

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
    // Le handle est ouvert ICI, dans CE processus, et reste ouvert pendant tout l'appel :
    // FileShare.None (le défaut de File.Open) empêche même une lecture par un autre acteur.
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
