// Le nettoyage des orphelins du toolkit : ce qu'il ne doit JAMAIS faire.
//
//   node --test "test/js/*.test.js"
//
// Le défaut corrigé ici, découvert en revue adversariale sur les correctifs de la nuit du
// 31 août au 1er septembre 2026 : Remove-SzhToolkitOrphelins (update.ps1, bootstrap.ps1,
// update-launcher.ps1) compare le toolkit à une archive extraite à part, et supprime du
// toolkit ce que l'archive ne contient pas — mais ne vérifiait JAMAIS que le dossier
// correspondant existe dans l'archive. Constaté à l'exécution :
//
//   * $Extrait\pipeline absent mais $Extrait\windows présent -> TOUT $Toolkit\pipeline
//     disparaissait, sans qu'une seule ligne du dépôt n'ait changé ;
//   * $Extrait vide (zip qui réussit sans rien contenir) -> les cinq dossiers gérés du
//     toolkit étaient vidés, un par un.
//
// Le point qui rend ce défaut sérieux : il ne demande pas une archive corrompue. Il suffit
// qu'Expand-Archive réussisse sans exception sur un contenu incomplet — le try/catch qui
// entoure le nettoyage ne rattrape alors rien — et une archive incomplète mais AUTHENTIQUE
// (un dossier source vidé par erreur avant le `cp -r` de release.yml, zip valide, empreinte
// correcte) passe Test-SzhSha256, qui ne protège que de la corruption de téléchargement.
//
// Trois gardes, dans l'esprit « en cas de doute, ne rien supprimer » :
//   1. Par dossier : le dossier doit exister dans l'archive extraite, sinon ce dossier-là
//      n'est pas touché — c'est ce qui répare le premier scénario ci-dessus.
//   2. Globalement, avant même de commencer : si l'extraction ne porte NI le VERSION NI un
//      seul des cinq dossiers gérés, le nettoyage entier s'abstient — c'est ce qui répare le
//      second scénario. (Volontairement plus laxiste qu'« il faut les cinq » : sinon cette
//      garde et la garde 1 seraient indiscernables, et le premier scénario perdrait son
//      nettoyage légitime des AUTRES dossiers en même temps que sa protection de pipeline.)
//   3. Proportion invraisemblable : une archive authentique mais incomplète (le dossier
//      source vidé par erreur ci-dessus) fait passer les deux gardes précédentes — le
//      dossier EXISTE dans l'archive, il est juste creux. Si retirer les candidats
//      éliminerait plus de la moitié d'un dossier d'au moins quatre fichiers, rien n'est
//      retiré de ce dossier : un nettoyage normal écarte quelques fichiers retirés du
//      dépôt, pas la majorité d'un dossier géré.
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
const UPDATE = lire('windows', 'update.ps1');
const BOOTSTRAP = lire('windows', 'bootstrap.ps1');
const LANCEUR = lire('windows', 'update-launcher.ps1');
const RELEASE = lire('.github', 'workflows', 'release.yml');

// Le corps d'une fonction PowerShell : de sa ligne de déclaration jusqu'à la première ligne
// qui n'est QUE « } », en colonne 0 — la fermeture du top-level, dans le style constant de ce
// dépôt. Ne compte pas les accolades une à une : les chaînes de formatage de ces fonctions
// (« {0} », « {1} ») en portent, et un compteur naïf s'y tromperait.
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

// Le bloc qui suit l'appel à Remove-SzhToolkitOrphelins, jusqu'à la fermeture de SON propre
// `finally` -- un Remove-Item qui traînerait ailleurs dans le fichier ne prouverait rien, il
// doit être DANS ce bloc-ci pour compter comme le nettoyage du staging après l'appel. Repéré
// par indentation (celle qui précède « } finally { » referme le bloc au même niveau, trois
// lignes plus bas) plutôt que par un compte d'accolades, pour la même raison que
// corpsFonction évite les accolades des chaînes de formatage.
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

// ---- Les trois copies restent identiques ----
// Dupliquée à l'identique dans les trois scripts (aucun des trois ne dot-source les deux
// autres) : elles doivent donc rester identiques, sinon un correctif posé dans l'un ne
// protège pas les postes qui passent par les deux autres chemins.

test('Remove-SzhToolkitOrphelins est identique, mot pour mot, dans les trois scripts', () => {
  const corps = {
    'update.ps1': corpsFonction(UPDATE, 'Remove-SzhToolkitOrphelins'),
    'bootstrap.ps1': corpsFonction(BOOTSTRAP, 'Remove-SzhToolkitOrphelins'),
    'update-launcher.ps1': corpsFonction(LANCEUR, 'Remove-SzhToolkitOrphelins')
  };
  assert.strictEqual(corps['bootstrap.ps1'], corps['update.ps1'],
    'bootstrap.ps1 a divergé d’update.ps1');
  assert.strictEqual(corps['update-launcher.ps1'], corps['update.ps1'],
    'update-launcher.ps1 a divergé d’update.ps1');
});

test('les trois appelants relisent .retires et .avertissements, plus un $orphelins nu', () => {
  // La fonction rend désormais une table ordonnée, pas juste la liste des retirés : les trois
  // appelants doivent avoir suivi, sinon `.Count` sur un $orphelins nu (l'ancienne forme)
  // planterait au tout premier nettoyage.
  for (const [nom, source] of [['update.ps1', UPDATE], ['bootstrap.ps1', BOOTSTRAP],
    ['update-launcher.ps1', LANCEUR]]) {
    assert.ok(source.indexOf('$bilanOrphelins = Remove-SzhToolkitOrphelins') !== -1,
      nom + ' ne relit plus le nettoyage sous sa forme structurée');
    assert.ok(source.indexOf('$bilanOrphelins.retires') !== -1, nom + ' ne lit plus .retires');
    assert.ok(source.indexOf('$bilanOrphelins.avertissements') !== -1,
      nom + ' ne journalise plus les anomalies du nettoyage');
    assert.ok(source.indexOf('$orphelins = Remove-SzhToolkitOrphelins') === -1,
      nom + ' relit encore l’ancienne forme ($orphelins nu)');
  }
});

test('les trois scripts nettoient leur dossier d’extraction, dans un finally qui suit l’appel', () => {
  // Le staging ($SzhStaging\toolkit-extrait-<version>) est une extraction À PART, faite
  // seulement pour comparer -- elle n'a aucune raison de survivre à l'appel. Ce nettoyage vit
  // dans un `finally` précisément parce que Remove-SzhToolkitOrphelins peut lever (dossier
  // illisible, chemin trop long...) : sans ce filet, une seule mise à jour malchanceuse
  // suffirait à laisser le dossier d'extraction derrière elle. Si une copie perdait ce
  // `finally` -- ou ne nettoyait plus que sur le chemin heureux --, le staging du poste
  // grossirait d'un toolkit complet à CHAQUE mise à jour qui passe par ce chemin, sans qu'un
  // seul message ne le signale : Remove-Item y est en -ErrorAction SilentlyContinue, exprès,
  // pour ne jamais faire échouer une mise à jour par ailleurs réussie sur un souci de ménage.
  for (const [nom, source] of [['update.ps1', UPDATE], ['bootstrap.ps1', BOOTSTRAP],
    ['update-launcher.ps1', LANCEUR]]) {
    const filet = finallyApresAppel(source, nom);
    assert.match(filet,
      /if \(\$extrait -and \(Test-Path \$extrait\)\) \{ Remove-Item -LiteralPath \$extrait -Recurse -Force -ErrorAction SilentlyContinue \}/,
      nom + ' : le finally qui suit l’appel ne nettoie plus $extrait');
  }
});

test('$dossiersGeres coïncide, dans les deux sens, avec ce que release.yml copie dans le toolkit', () => {
  // Piège de maintenance, pas un bug vivant : aujourd'hui les deux listes coïncident, et le
  // défaut que ce fichier garde par ailleurs (garde 1, plus haut) protège déjà un dossier
  // absent de l'archive -- une CI qui cesserait d'en livrer un échouerait donc en sécurité,
  // pas en silence. Mais rien ne LIE ces deux listes entre elles. Si quelqu'un ajoute un
  // dossier aux trois scripts sans l'ajouter à la ligne `cp -r` de release.yml, le nettoyage
  // raisonnera sur un dossier que l'archive ne porte jamais (la garde 1 le protégera --
  // rien de cassé, juste du mort). Mais si quelqu'un ajoute un dossier à `cp -r` sans
  // l'ajouter aux trois scripts, ce dossier-là s'accumule sur chaque poste sans jamais être
  // nettoyé -- exactement le défaut que ce fichier garde par ailleurs, réintroduit par un
  // chemin que ni les trois scripts ni ce fichier ne surveillaient jusqu'ici.
  const mGeres = UPDATE.match(/\$dossiersGeres = @\(([^)]*)\)/);
  assert.ok(mGeres, 'update.ps1 : $dossiersGeres a changé de forme, la comparaison ne sait plus le lire');
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

// ---- Le second défaut : update-launcher.ps1 sans mutex ----

test('update-launcher.ps1 pose le même mutex nommé qu’update.ps1, et le relâche partout', () => {
  // Même nom par défaut ('SZH-Publishing-Update' dans New-SzhMutexPoste) : c'est ce qui fait
  // qu'un seul verrou protège les deux scripts à la fois. -Nom n'est PAS passé ici — sinon ce
  // serait un verrou différent de celui d'update.ps1, et la protection n'aurait plus de sens.
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
  // Relâché avant de passer la main à la fenêtre visible : sinon update.ps1, qui prend le
  // même verrou à son tour, le trouverait occupé par ce script-ci et sortirait aussitôt en
  // croyant une mise à jour concurrente qui n'existe pas.
  const corpsFenetre = corpsFonction(LANCEUR, 'Start-SzhFenetreVisible');
  const iRelache = corpsFenetre.indexOf('ReleaseMutex');
  const iLance = corpsFenetre.indexOf('Start-Process');
  assert.ok(iRelache !== -1 && iLance !== -1 && iRelache < iLance,
    'le verrou doit être relâché AVANT Start-Process, pas après');
  // Et un filet de sûreté couvre les autres sorties (déjà à jour, renoncement de moment,
  // erreur) : un `finally` sur le bloc principal, gardé par le même drapeau pour ne jamais
  // relâcher deux fois un mutex déjà rendu.
  const iFinally = LANCEUR.lastIndexOf('} finally {');
  assert.ok(iFinally !== -1, 'aucun filet de sûreté (finally) sur la passe principale');
  const filet = LANCEUR.slice(iFinally, iFinally + 500);
  assert.match(filet, /if \(\$script:SzhMutexTenu\) \{/);
  assert.match(filet, /ReleaseMutex/);
});

// ---- Les scénarios dégénérés, réellement exécutés ----
// Windows seulement. La fonction ne dépend que de cmdlets natives (Test-Path, Get-ChildItem,
// Remove-Item…), jamais de szh-common.ps1 : elle est donc éprouvée seule, extraite du VRAI
// texte d'update.ps1 (identique aux deux autres, prouvé ci-dessus) et évaluée dans des
// dossiers de travail jetables. Rien n'est jamais touché sous C:\ProgramData\SZH.

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

const CORPS_FONCTION = corpsFonction(UPDATE, 'Remove-SzhToolkitOrphelins');

// Les blocs éprouvés ici sont extraits mot pour mot des vrais .ps1, donc portent leurs
// messages en français accentué. Windows PowerShell 5.1 lit un script SANS BOM avec la page
// de code ANSI du poste, pas en UTF-8 : sans ce préfixe, « à », « é » ressortent en mojibame
// une fois relus (constaté : « une autre mise Ã  jour... »). Les .ps1 du dépôt, eux, portent
// déjà ce BOM ; celui qu'on écrit ici, fraîchement, doit le porter aussi.
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '﻿' + contenu, 'utf8');
}

// Un scénario = deux arbres (toolkit, extrait) ; le pilote appelle la fonction UNE fois et
// rend { retires, avertissements } tel quel, plus l'état du toolkit après coup.
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
  // Sans BOM : Set-Content -Encoding UTF8 en poserait un sous PowerShell 5.1, et Node ne
  // digère pas un fichier JSON qui commence par ce caractère.
  '[System.IO.File]::WriteAllText($sortie, ($resultats | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))'
].join('\r\n') + '\r\n';

const SCENARIOS = [
  {
    // Cas nominal : un fichier retiré du dépôt doit toujours être écarté. Sans ce test, une
    // garde trop prudente pourrait « corriger » le défaut en ne nettoyant plus jamais rien.
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
    // Le défaut d'origine, rejoué tel qu'observé : pipeline absent de l'archive, windows
    // présent. AVANT le correctif, ceci vidait tout pipeline.
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
    // Le second défaut d'origine : extraction vide (zip qui « réussit » sans rien contenir).
    // AVANT le correctif, ceci vidait les cinq dossiers gérés.
    nom: 'extraction-vide',
    toolkit: [
      'pipeline/a.py', 'pipeline/b.py',
      'vscodium-user/a', 'revue-template/a', 'livre-template/a', 'windows/a'
    ],
    extrait: []   // ni VERSION, ni aucun dossier
  },
  {
    // Une archive AUTHENTIQUE mais incomplète : le dossier existe dans l'extraction (donc les
    // gardes 1 et 2 passent toutes deux) mais il est vide — le scénario « dossier source vidé
    // par erreur avant le `cp -r` de release.yml ». windows, lui, a un nettoyage normal (un
    // seul orphelin sur cinq) qui doit passer malgré la garde qui bloque pipeline à côté.
    nom: 'dossier-creux',
    toolkit: [
      'pipeline/f1.py', 'pipeline/f2.py', 'pipeline/f3.py', 'pipeline/f4.py', 'pipeline/f5.py',
      'pipeline/f6.py', 'pipeline/f7.py', 'pipeline/f8.py', 'pipeline/f9.py', 'pipeline/f10.py',
      'windows/f1.ps1', 'windows/f2.ps1', 'windows/f3.ps1', 'windows/f4.ps1', 'windows/vieux.ps1',
      'vscodium-user/garde.md', 'revue-template/garde.md', 'livre-template/garde.md'
    ],
    extrait: [
      'VERSION',
      // pipeline/.keep : force la création du dossier « pipeline » dans l'extraction sans
      // qu'aucun des dix fichiers réels de pipeline n'y trouve son pendant — c'est le
      // dossier CREUX (existe, mais rien à quoi comparer), à distinguer du dossier ABSENT
      // du scénario précédent. Sans ce fichier, le dossier ne serait même pas créé et on
      // testerait la garde 1 (absence) au lieu de la garde 3 (proportion).
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
  // Le défaut d'origine : les trois fichiers de pipeline auraient tous disparu.
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
  // Les dix fichiers de pipeline auraient tous été des « candidats orphelins » : la garde de
  // proportion doit les épargner tous, alors même que le dossier existe bien dans l’archive.
  for (let i = 1; i <= 10; i++) {
    assert.ok(s.restants.indexOf('pipeline/f' + i + '.py') !== -1,
      'pipeline/f' + i + '.py a été retiré malgré la garde de proportion');
  }
  // windows, dont un seul fichier sur cinq est orphelin (20 %, sous le seuil), doit rester
  // nettoyé normalement : la garde ne doit pas se répercuter sur un dossier sain.
  assert.deepStrictEqual(s.retires, ['windows\\vieux.ps1']);
  assert.ok(s.avertissements.some((a) => a.indexOf('proportion') !== -1 && a.indexOf('pipeline') !== -1),
    'la garde de proportion doit se journaliser explicitement');
});

// ---- Le mutex du lanceur, réellement exécuté ----
// On ne rejoue pas update-launcher.ps1 en entier (il appellerait Get-SzhManifest, donc le
// réseau) : on éprouve le VRAI bloc d'acquisition, extrait tel quel du fichier, avec son nom
// de mutex substitué par un nom d'essai — sinon le test prendrait le verrou RÉEL du poste,
// celui qu'update.ps1 utilise en production.

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

  // Le titulaire : prend le verrou d'essai et le garde jusqu'à ce qu'un fichier signal
  // apparaisse, en écrivant lui-même un marqueur dès qu'il l'a obtenu (pour que le test
  // n'interroge le lanceur qu'une fois le verrou vraiment posé).
  const titulaire = [
    '. "' + COMMUN_PS1 + '"',
    "$nomEssai = '" + nomEssai + "'",
    '$m = New-SzhMutexPoste -Nom $nomEssai',
    'if (-not $m.WaitOne(5000)) { exit 9 }',
    "Set-Content -Path (Join-Path '" + travail + "' 'tenu.txt') -Value 'ok'",
    "while (-not (Test-Path (Join-Path '" + travail + "' 'libere.txt'))) { Start-Sleep -Milliseconds 50 }",
    '$m.ReleaseMutex()'
  ].join('\r\n') + '\r\n';

  // L'essai : exactement le bloc du lanceur (nom d'essai substitué), suivi d'un marqueur posé
  // seulement si l'exécution est arrivée jusque-là — donc jamais quand le bloc a fait `exit 0`.
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

  // Pause synchrone sans sous-processus : ce bloc entier tourne hors d'un test async (une
  // IIFE, comme dans installation.test.js et rythme-maj.test.js), donc pas d'await possible.
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

  // Une fois relâché : le même bloc doit maintenant acquérir le verrou et continuer.
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
