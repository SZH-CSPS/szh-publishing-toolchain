// Le nettoyage des orphelins du toolkit (Remove-SzhToolkitOrphelins, szh-common.ps1, appelée
// par update.ps1, bootstrap.ps1 et update-launcher.ps1) : il compare le toolkit à une archive
// extraite à part, et retire du toolkit ce que l'archive ne contient pas.
//
// Expand-Archive peut réussir sur un contenu incomplet, et une archive authentique mais
// incomplète (un dossier source vidé avant le `cp -r` de release.yml) passe Test-SzhSha256,
// qui ne protège que de la corruption au téléchargement. Trois gardes, selon la règle « en cas
// de doute, ne rien supprimer » :
//   1. Par dossier : un dossier absent de l'archive extraite n'est pas touché (sinon
//      $Extrait\pipeline absent vide tout $Toolkit\pipeline).
//   2. Globalement : si l'extraction ne porte ni VERSION ni aucun des cinq dossiers gérés,
//      le nettoyage s'abstient (une extraction vide viderait les cinq dossiers). La garde
//      n'exige pas les cinq : sinon elle se confondrait avec la garde 1 et empêcherait le
//      nettoyage légitime des autres dossiers.
//   3. Proportion : un dossier présent mais creux passe les deux gardes. Si retirer les
//      candidats éliminait plus de la moitié d'un dossier d'au moins quatre fichiers, rien
//      n'est retiré de ce dossier : un nettoyage normal écarte quelques fichiers, pas la
//      majorité.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const COMMUN = lire('windows', 'szh-common.ps1');
const UPDATE = lire('windows', 'update.ps1');
const BOOTSTRAP = lire('windows', 'bootstrap.ps1');
const LANCEUR = lire('windows', 'update-launcher.ps1');
const RELEASE = lire('.github', 'workflows', 'release.yml');

// Le corps d'une fonction PowerShell : de sa déclaration à la première ligne qui n'est que
// « } » en colonne 0. Les accolades ne sont pas comptées : les chaînes de formatage
// (« {0} », « {1} ») en contiennent.
function corpsFonction(source, nom) {
  const lignes = source.split('\r\n');
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

// Le bloc qui suit l'appel à Remove-SzhToolkitOrphelins, jusqu'à la fermeture de son propre
// `finally` : un Remove-Item ailleurs dans le fichier ne compterait pas comme le nettoyage du
// staging. Repéré par indentation (la ligne « } finally { » au même niveau, trois lignes plus
// bas), pour la même raison que corpsFonction.
function finallyApresAppel(source, nom) {
  const iAppel = source.indexOf('$bilanOrphelins = Remove-SzhToolkitOrphelins');
  assert.ok(iAppel !== -1, nom + ' : appel à Remove-SzhToolkitOrphelins introuvable');
  const iOuvre = source.indexOf('} finally {', iAppel);
  assert.ok(iOuvre !== -1 && (iOuvre - iAppel) < 800,
    nom + ' : aucun `finally` immédiatement après l’appel à Remove-SzhToolkitOrphelins');
  const iDebutLigne = source.lastIndexOf('\r\n', iOuvre) + 2;
  const indent = source.slice(iDebutLigne, iOuvre);
  const iFermeture = source.indexOf('\r\n' + indent + '}', iOuvre + '} finally {'.length);
  assert.ok(iFermeture !== -1, nom + ' : fermeture du `finally` introuvable');
  return source.slice(iDebutLigne, iFermeture + 2 + indent.length + 1);
}

// ---- Une seule définition, appelée par les trois ----
// La fonction vit une fois dans szh-common.ps1, que les trois scripts chargent ; aucun ne doit
// en redéfinir une copie locale.

test('Remove-SzhToolkitOrphelins est définie une seule fois, dans szh-common.ps1, et appelée (via Install-SzhToolkitDepuisArchive) par les trois scripts', () => {
  // Une seule déclaration dans le dépôt, dans szh-common.ps1. Les trois scripts n'appellent
  // pas Remove-SzhToolkitOrphelins directement : Install-SzhToolkitDepuisArchive
  // (szh-common.ps1) le fait, sur une copie jetable du toolkit.
  assert.ok(COMMUN.indexOf('function Remove-SzhToolkitOrphelins') !== -1,
    'szh-common.ps1 ne déclare plus Remove-SzhToolkitOrphelins');
  assert.ok(COMMUN.indexOf('function Install-SzhToolkitDepuisArchive') !== -1,
    'szh-common.ps1 ne déclare plus Install-SzhToolkitDepuisArchive');
  const corpsInstall = corpsFonction(COMMUN, 'Install-SzhToolkitDepuisArchive');
  assert.ok(corpsInstall.indexOf('Remove-SzhToolkitOrphelins') !== -1,
    'Install-SzhToolkitDepuisArchive n’appelle plus Remove-SzhToolkitOrphelins');
  for (const [nom, source] of [['update.ps1', UPDATE], ['bootstrap.ps1', BOOTSTRAP],
    ['update-launcher.ps1', LANCEUR]]) {
    assert.ok(source.indexOf('function Remove-SzhToolkitOrphelins') === -1,
      nom + ' redéfinit encore sa propre copie de Remove-SzhToolkitOrphelins');
    assert.ok(source.indexOf('function Install-SzhToolkitDepuisArchive') === -1,
      nom + ' redéfinit sa propre copie de Install-SzhToolkitDepuisArchive');
    assert.ok(source.indexOf('$bilanOrphelins = Install-SzhToolkitDepuisArchive') !== -1,
      nom + ' n’appelle plus Install-SzhToolkitDepuisArchive');
    // Une mention en commentaire est admise ; un appel direct ne l'est pas.
    assert.ok(source.indexOf('= Remove-SzhToolkitOrphelins ') === -1,
      nom + ' appelle encore Remove-SzhToolkitOrphelins directement, plus seulement via Install-SzhToolkitDepuisArchive');
  }
  // Le corps unique, extrait de szh-common.ps1, que les scénarios plus bas exécutent.
  const corps = corpsFonction(COMMUN, 'Remove-SzhToolkitOrphelins');
  assert.ok(corps.length > 200, 'le corps extrait de szh-common.ps1 paraît vide');
});

test('les trois appelants relisent .retires et .avertissements, plus un $orphelins nu', () => {
  // La fonction rend une table ordonnée, pas la seule liste des retirés : les appelants
  // doivent lire ce bilan, sinon `.Count` sur un $orphelins nu planterait. Le bilan est rendu
  // par Install-SzhToolkitDepuisArchive.
  for (const [nom, source] of [['update.ps1', UPDATE], ['bootstrap.ps1', BOOTSTRAP],
    ['update-launcher.ps1', LANCEUR]]) {
    assert.ok(source.indexOf('$bilanOrphelins = Install-SzhToolkitDepuisArchive') !== -1,
      nom + ' ne relit plus le nettoyage sous sa forme structurée');
    assert.ok(source.indexOf('$bilanOrphelins.retires') !== -1, nom + ' ne lit plus .retires');
    assert.ok(source.indexOf('$bilanOrphelins.avertissements') !== -1,
      nom + ' ne journalise plus les anomalies du nettoyage');
    assert.ok(source.indexOf('$orphelins = Install-SzhToolkitDepuisArchive') === -1,
      nom + ' relit encore l’ancienne forme ($orphelins nu)');
  }
});

test('le remplacement du toolkit nettoie son dossier d’extraction, dans un finally qui suit l’appel', () => {
  // Le staging ($SzhStaging\toolkit-verif-<guid>) est une extraction faite seulement pour
  // comparer. Son nettoyage est dans un `finally` d'Install-SzhToolkitDepuisArchive, parce que
  // Remove-SzhToolkitOrphelins peut lever (dossier illisible, chemin trop long…).
  const corpsInstall = corpsFonction(COMMUN, 'Install-SzhToolkitDepuisArchive');
  const filet = finallyApresAppel(corpsInstall, 'Install-SzhToolkitDepuisArchive');
  assert.match(filet,
    /if \(Test-Path -LiteralPath \$extrait\) \{ Remove-Item -LiteralPath \$extrait -Recurse -Force -ErrorAction SilentlyContinue \}/,
    'le finally qui suit l’appel ne nettoie plus $extrait');
});

test('$dossiersGeres coïncide, dans les deux sens, avec ce que release.yml copie dans le toolkit', () => {
  // La liste des dossiers gérés (trois scripts) et la ligne `cp -r` de release.yml ne sont
  // liées par rien d'autre que ce test. Un dossier géré absent de l'archive est protégé par la
  // garde 1 (sans effet). Un dossier livré mais non géré s'accumulerait sur chaque poste sans
  // jamais être nettoyé.
  const mGeres = COMMUN.match(/\$dossiersGeres = @\(([^)]*)\)/);
  assert.ok(mGeres, 'szh-common.ps1 : $dossiersGeres a changé de forme, la comparaison ne sait plus le lire');
  const dossiersGeres = mGeres[1].split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1'));

  const mCp = RELEASE.match(/cp -r ([^\r\n]+) toolkit\/\r?\n/);
  assert.ok(mCp, 'release.yml : la ligne `cp -r ... toolkit/` a changé de forme, la comparaison ne sait plus la lire');
  const dossiersLivres = mCp[1].trim().split(/\s+/);

  const geresNonLivres = dossiersGeres.filter((d) => dossiersLivres.indexOf(d) === -1);
  const livresNonGeres = dossiersLivres.filter((d) => dossiersGeres.indexOf(d) === -1);
  assert.deepStrictEqual(geresNonLivres, [],
    '$dossiersGeres protège un dossier que release.yml ne livre plus : ' + geresNonLivres.join(', '));
  assert.deepStrictEqual(livresNonGeres, [],
    'release.yml livre un dossier que $dossiersGeres ne connaît pas -- jamais nettoyé sur aucun poste : '
    + livresNonGeres.join(', '));
});

test('la boucle de repli de bootstrap.ps1 copie les mêmes dossiers que $dossiersGeres, moissonneurs compris', () => {
  // Un poste installé par le repli hors ligne reçoit tout le toolkit : sans moissonneurs, le
  // bouton de la moisson mensuelle échouerait sur ce poste.
  const mGeres = COMMUN.match(/\$dossiersGeres = @\(([^)]*)\)/);
  assert.ok(mGeres, 'szh-common.ps1 : $dossiersGeres a changé de forme');
  const dossiersGeres = mGeres[1].split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1'));
  const mBoucle = BOOTSTRAP.match(/foreach \(\$d in ('[^)]*')\) \{\r\n\s*\$src  = Join-Path \$racineDepot \$d/);
  assert.ok(mBoucle, 'bootstrap.ps1 : la boucle de repli a changé de forme, la comparaison ne sait plus la lire');
  const copies = mBoucle[1].split(',').map((s) => s.trim().replace(/^'(.*)'$/, '$1'));
  assert.deepStrictEqual(copies, dossiersGeres);
  assert.ok(dossiersGeres.indexOf('moissonneurs') !== -1, '$dossiersGeres ne connaît pas moissonneurs');
});

// ---- update-launcher.ps1 et le mutex ----

test('update-launcher.ps1 pose le même mutex nommé qu’update.ps1, et le relâche partout', () => {
  // Même nom par défaut ('SZH-Publishing-Update' dans New-SzhMutexPoste) : un seul verrou
  // protège les deux scripts. -Nom n'est pas passé, sinon ce serait un autre verrou que celui
  // d'update.ps1.
  assert.match(LANCEUR, /\$script:SzhMutex = New-SzhMutexPoste\r\n/);
  assert.ok(LANCEUR.indexOf('New-SzhMutexPoste -Nom') === -1,
    'le mutex du lanceur ne doit pas porter un autre nom que celui d’update.ps1');
  assert.match(LANCEUR, /\$script:SzhMutexTenu = \$SzhMutex\.WaitOne\(0\)/);
  // Occupé : sortie immédiate, avant de toucher au toolkit.
  const iGarde = LANCEUR.indexOf('if (-not $script:SzhMutexTenu) {');
  assert.ok(iGarde !== -1);
  const garde = LANCEUR.slice(iGarde, iGarde + 200);
  assert.match(garde, /Write-SzhLog 'check : une autre mise à jour est déjà en cours/);
  assert.match(garde, /exit 0/);
  // Relâché avant de passer la main à la fenêtre visible : sinon update.ps1, qui prend le même
  // verrou, le trouverait occupé et sortirait en croyant à une mise à jour concurrente.
  const corpsFenetre = corpsFonction(LANCEUR, 'Start-SzhFenetreMaj');
  const iRelache = corpsFenetre.indexOf('ReleaseMutex');
  const iLance = corpsFenetre.indexOf('Start-Process');
  assert.ok(iRelache !== -1 && iLance !== -1 && iRelache < iLance,
    'le verrou doit être relâché AVANT Start-Process, pas après');
  // Un `finally` sur le bloc principal couvre les autres sorties (déjà à jour, renoncement,
  // erreur), gardé par le même drapeau pour ne pas relâcher deux fois.
  const iFinally = LANCEUR.lastIndexOf('} finally {');
  assert.ok(iFinally !== -1, 'aucun filet de sûreté (finally) sur la passe principale');
  const filet = LANCEUR.slice(iFinally, iFinally + 500);
  assert.match(filet, /if \(\$script:SzhMutexTenu\) \{/);
  assert.match(filet, /ReleaseMutex/);
});

// ---- Les scénarios dégénérés, exécutés ----
// Windows seulement. La fonction n'utilise que des cmdlets natives (Test-Path, Get-ChildItem,
// Remove-Item…) : elle est extraite du texte de szh-common.ps1 et exécutée seule, dans des
// dossiers jetables. Rien n'est touché sous C:\ProgramData\SZH.

const { POWERSHELL, sansPowerShell } = require('./gardes');

const CORPS_FONCTION = corpsFonction(COMMUN, 'Remove-SzhToolkitOrphelins');

// Les blocs extraits des .ps1 portent des messages en français accentué. Windows PowerShell
// 5.1 lit un script sans BOM dans la page de code ANSI du poste : sans ce préfixe, les accents
// ressortent en mojibake (« une autre mise Ã  jour... »).
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '﻿' + contenu, 'utf8');
}

// Un scénario = deux arbres (toolkit, extrait). Le pilote appelle la fonction une fois et
// rend { retires, avertissements }, plus l'état du toolkit après coup.
const PILOTE = [
  "\$ErrorActionPreference = 'Stop'",
  CORPS_FONCTION,
  '$travail = $args[0]; $sortie = $args[1]',
  '$scenarios = Get-Content (Join-Path $travail "scenarios.json") -Raw | ConvertFrom-Json',
  '$resultats = [ordered]@{}',
  'foreach ($s in $scenarios) {',
  '  $toolkit = Join-Path $travail ("t-" + $s.nom)',
  '  $extrait = Join-Path $travail ("e-" + $s.nom)',
  '  foreach ($rel in $s.toolkit) {',
  '    $p = Join-Path $toolkit $rel',
  '    New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null',
  "    Set-Content -Path \$p -Value 'x' -Encoding ASCII",
  '  }',
  '  foreach ($rel in $s.extrait) {',
  '    $p = Join-Path $extrait $rel',
  '    New-Item -ItemType Directory -Force -Path (Split-Path $p) | Out-Null',
  "    Set-Content -Path \$p -Value 'x' -Encoding ASCII",
  '  }',
  '  $r = Remove-SzhToolkitOrphelins -Toolkit $toolkit -Extrait $extrait',
  '  $restants = @()',
  '  if (Test-Path $toolkit) {',
  '    $restants = @(Get-ChildItem -LiteralPath $toolkit -Recurse -File |',
  '      ForEach-Object { $_.FullName.Substring($toolkit.Length + 1) -replace "\\\\", "/" })',
  '  }',
  '  $resultats[$s.nom] = [ordered]@{',
  '    retires = @($r.retires); avertissements = @($r.avertissements); restants = @($restants) }',
  '}',
  // Sans BOM : Set-Content -Encoding UTF8 en poserait un sous PowerShell 5.1, et Node ne lit
  // pas un JSON qui commence par ce caractère.
  '[System.IO.File]::WriteAllText($sortie, ($resultats | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))'
].join('\r\n') + '\r\n';

const SCENARIOS = [
  {
    // Cas nominal : un fichier retiré du dépôt est écarté. Une garde trop prudente qui ne
    // nettoierait plus rien échouerait ici.
    nom: 'nominal',
    toolkit: [
      'pipeline/garde.md', 'pipeline/vieux-filtre.py',
      'vscodium-user/garde.md', 'revue-template/garde.md',
      'livre-template/garde.md', 'windows/garde.md'
    ],
    extrait: [
      'VERSION',
      'pipeline/garde.md',
      'vscodium-user/garde.md', 'revue-template/garde.md',
      'livre-template/garde.md', 'windows/garde.md'
    ]
  },
  {
    // pipeline absent de l'archive, windows présent.
    nom: 'dossier-manquant',
    toolkit: [
      'pipeline/a.py', 'pipeline/b.py', 'pipeline/c.py',
      'windows/garde.md', 'windows/vieux.ps1'
    ],
    extrait: [
      'VERSION',
      // pas de pipeline du tout
      'vscodium-user/garde.md', 'revue-template/garde.md', 'livre-template/garde.md',
      'windows/garde.md'
    ]
  },
  {
    // Extraction vide (zip qui réussit sans rien contenir).
    nom: 'extraction-vide',
    toolkit: [
      'pipeline/a.py', 'pipeline/b.py',
      'vscodium-user/a', 'revue-template/a', 'livre-template/a', 'windows/a'
    ],
    extrait: []   // ni VERSION, ni aucun dossier
  },
  {
    // Archive authentique mais incomplète : le dossier existe dans l'extraction (gardes 1 et
    // 2 passent) mais il est vide. windows a un nettoyage normal (un orphelin sur cinq) qui
    // doit passer malgré la garde qui bloque pipeline.
    nom: 'dossier-creux',
    toolkit: [
      'pipeline/f1.py', 'pipeline/f2.py', 'pipeline/f3.py', 'pipeline/f4.py', 'pipeline/f5.py',
      'pipeline/f6.py', 'pipeline/f7.py', 'pipeline/f8.py', 'pipeline/f9.py', 'pipeline/f10.py',
      'windows/f1.ps1', 'windows/f2.ps1', 'windows/f3.ps1', 'windows/f4.ps1', 'windows/vieux.ps1',
      'vscodium-user/garde.md', 'revue-template/garde.md', 'livre-template/garde.md'
    ],
    extrait: [
      'VERSION',
      // pipeline/.keep crée le dossier « pipeline » dans l'extraction sans aucun des dix
      // fichiers de pipeline : dossier creux (garde 3), distinct du dossier absent (garde 1)
      // du scénario précédent.
      'pipeline/.keep',
      'windows/f1.ps1', 'windows/f2.ps1', 'windows/f3.ps1', 'windows/f4.ps1',
      'vscodium-user/garde.md', 'revue-template/garde.md', 'livre-template/garde.md'
    ]
  }
];

const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-orphelins-'));
  const pilote = path.join(travail, 'eprouver.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(path.join(travail, 'scenarios.json'), JSON.stringify(SCENARIOS), 'utf8');
  ecrirePs1(pilote, PILOTE);
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    travail, sortie], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('le cas nominal continue de nettoyer : un fichier retiré du dépôt est écarté', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a échoué : ' + bilan.stderr);
  const s = bilan.r.nominal;
  assert.deepStrictEqual(s.retires, ['pipeline\\vieux-filtre.py']);
  assert.deepStrictEqual(s.avertissements, []);
  assert.ok(s.restants.indexOf('pipeline/garde.md') !== -1, 'un fichier toujours dans l’archive a été retiré à tort');
  assert.ok(s.restants.indexOf('pipeline/vieux-filtre.py') === -1, 'l’orphelin n’a pas été retiré : le nettoyage ne fonctionne plus');
});

test('dossier absent de l’archive : ce dossier n’est pas touché, les autres sont nettoyés normalement', { skip: sansPowerShell }, () => {
  const s = bilan.r['dossier-manquant'];
  // Les trois fichiers de pipeline sont toujours là.
  assert.ok(s.restants.indexOf('pipeline/a.py') !== -1, 'pipeline a été vidé malgré la garde par dossier');
  assert.ok(s.restants.indexOf('pipeline/b.py') !== -1);
  assert.ok(s.restants.indexOf('pipeline/c.py') !== -1);
  assert.deepStrictEqual(s.retires, ['windows\\vieux.ps1'], 'windows, lui, doit rester nettoyé normalement');
  assert.ok(s.avertissements.some((a) => a.indexOf('pipeline') !== -1),
    'l’absence du dossier dans l’archive doit être journalisée comme anomalie');
});

test('extraction vide : le nettoyage entier s’abstient, rien n’est retiré nulle part', { skip: sansPowerShell }, () => {
  const s = bilan.r['extraction-vide'];
  assert.deepStrictEqual(s.retires, [], 'une extraction vide a quand même fait retirer des fichiers');
  assert.strictEqual(s.restants.length, 6, 'un fichier a disparu alors que l’extraction était vide');
  assert.ok(s.avertissements.length === 1 && s.avertissements[0].indexOf('abandonné') !== -1,
    'l’abandon global doit se journaliser explicitement');
});

test('dossier présent mais creux dans l’archive : la garde de proportion protège le dossier, sans bloquer les autres', { skip: sansPowerShell }, () => {
  const s = bilan.r['dossier-creux'];
  // Les dix fichiers de pipeline seraient candidats : la garde de proportion les épargne,
  // alors que le dossier existe dans l'archive.
  for (let i = 1; i <= 10; i++) {
    assert.ok(s.restants.indexOf('pipeline/f' + i + '.py') !== -1,
      'pipeline/f' + i + '.py a été retiré malgré la garde de proportion');
  }
  // windows, avec un orphelin sur cinq (20 %, sous le seuil), est nettoyé normalement.
  assert.deepStrictEqual(s.retires, ['windows\\vieux.ps1']);
  assert.ok(s.avertissements.some((a) => a.indexOf('proportion') !== -1 && a.indexOf('pipeline') !== -1),
    'la garde de proportion doit se journaliser explicitement');
});

// ---- Le mutex du lanceur, exécuté ----
// update-launcher.ps1 entier appellerait Get-SzhManifest, donc le réseau : on exécute le
// bloc d'acquisition extrait du fichier, avec un nom de mutex d'essai pour ne pas prendre le
// verrou réel du poste.

const BLOC_MUTEX = (function () {
  const iDebut = LANCEUR.indexOf('$script:SzhMutex = New-SzhMutexPoste');
  const iFin = LANCEUR.indexOf('\r\n\r\ntry {', iDebut);
  assert.ok(iDebut !== -1 && iFin !== -1, 'le bloc d’acquisition du mutex n’a plus la forme attendue');
  return LANCEUR.slice(iDebut, iFin).replace(
    'New-SzhMutexPoste', 'New-SzhMutexPoste -Nom $nomEssai');
})();

const bilanMutex = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-mutex-lanceur-'));
  const nomEssai = 'SZH-Essai-Lanceur-' + process.pid;

  // Le titulaire prend le verrou d'essai et le garde jusqu'à l'apparition d'un fichier
  // signal ; il écrit un marqueur dès qu'il l'a obtenu, pour que le test n'interroge le
  // lanceur qu'une fois le verrou posé.
  const titulaire = [
    '. "' + COMMUN_PS1 + '"',
    "$nomEssai = '" + nomEssai + "'",
    '$m = New-SzhMutexPoste -Nom $nomEssai',
    'if (-not $m.WaitOne(5000)) { exit 9 }',
    "Set-Content -Path (Join-Path '" + travail + "' 'tenu.txt') -Value 'ok'",
    "while (-not (Test-Path (Join-Path '" + travail + "' 'libere.txt'))) { Start-Sleep -Milliseconds 50 }",
    '$m.ReleaseMutex()'
  ].join('\r\n') + '\r\n';

  // L'essai : le bloc du lanceur (nom d'essai substitué), suivi d'un marqueur posé seulement
  // si l'exécution arrive jusque-là, donc pas quand le bloc fait `exit 0`.
  const essaiVerrouille = [
    "$ErrorActionPreference = 'Stop'",
    '. "' + COMMUN_PS1 + '"',
    "$script:SzhLogs = '" + path.join(travail, 'logs') + "'",
    "$nomEssai = '" + nomEssai + "'",
    BLOC_MUTEX,
    "Set-Content -Path (Join-Path '" + travail + "' 'continue.txt') -Value 'ok'"
  ].join('\r\n') + '\r\n';

  fs.mkdirSync(travail, { recursive: true });
  const pTitulaire = path.join(travail, 'titulaire.ps1');
  const pEssai = path.join(travail, 'essai.ps1');
  ecrirePs1(pTitulaire, titulaire);
  ecrirePs1(pEssai, essaiVerrouille);

  const procTitulaire = spawn(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pTitulaire],
    { windowsHide: true });

  // Pause synchrone sans sous-processus : ce bloc tourne hors d'un test async (une IIFE,
  // comme dans installation.test.js et rythme-maj.test.js), sans await possible.
  const dormirSync = (ms) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };

  const attendre = (fichier, delaiMs) => {
    const limite = Date.now() + delaiMs;
    while (!fs.existsSync(fichier)) {
      if (Date.now() > limite) { return false; }
      dormirSync(30);
    }
    return true;
  };

  const aPrisLeVerrou = attendre(path.join(travail, 'tenu.txt'), 10000);

  const runVerrouille = spawnSync(POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pEssai],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const continueVerrouille = fs.existsSync(path.join(travail, 'continue.txt'));
  const logsVerrouille = fs.existsSync(path.join(travail, 'logs'))
    ? fs.readdirSync(path.join(travail, 'logs')).map((f) =>
      fs.readFileSync(path.join(travail, 'logs', f), 'utf8')).join('\n')
    : '';

  fs.writeFileSync(path.join(travail, 'libere.txt'), 'ok');
  procTitulaire.kill();

  // Une fois relâché, le même bloc acquiert le verrou et continue.
  const runLibre = spawnSync(POWERSHELL,
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pEssai],
    { encoding: 'utf8', windowsHide: true, timeout: 30000 });
  const continueLibre = fs.existsSync(path.join(travail, 'continue.txt'));

  fs.rmSync(travail, { recursive: true, force: true });
  return { aPrisLeVerrou, runVerrouille, continueVerrouille, logsVerrouille, runLibre, continueLibre };
})();

test('le lanceur, verrou occupé : il sort tout de suite, sans rien tenter', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilanMutex.aPrisLeVerrou, true, 'le titulaire d’essai n’a jamais pris son propre verrou');
  assert.strictEqual(bilanMutex.runVerrouille.status, 0,
    'le bloc doit sortir en 0 (retenter plus tard), pas planter : ' + bilanMutex.runVerrouille.stderr);
  assert.strictEqual(bilanMutex.continueVerrouille, false,
    'le bloc a continué après le point de sortie alors que le verrou était occupé par un autre processus');
  assert.match(bilanMutex.logsVerrouille, /une autre mise à jour est déjà en cours/);
});

test('le lanceur, verrou libre : il le prend et continue normalement', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilanMutex.runLibre.status, 0, 'le bloc a échoué verrou libre : ' + bilanMutex.runLibre.stderr);
  assert.strictEqual(bilanMutex.continueLibre, true,
    'le bloc n’a pas continué alors que le verrou était libre : un poste ne se mettrait plus jamais à jour');
});
