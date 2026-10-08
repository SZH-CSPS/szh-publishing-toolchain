// windows/diagnostic.ps1. Les tests sont numérotés par sujet :
//
// 1. Une application absente marquée `"requis": false` dans windows/apps.lock (SumatraPDF)
//    ressort au ton 'note', qui ne fait pas échouer le diagnostic ; une application requise
//    absente ressort en 'manque'.
//
// 2. Le nombre de raccourcis annoncé vient du tableau rendu par Get-SzhRaccourcisMenu
//    (szh-common.ps1), et non d'un chiffre écrit dans le texte.
//
// 3. Les clés de registre `SZH.Markdown` et `szh` sont écrites en dur dans diagnostic.ps1,
//    mais appartiennent à update.ps1 (Set-SzhProgIdMarkdown, Set-SzhProtocoleSzh). Un
//    commentaire de diagnostic.ps1 le dit et cite les lignes de ces fonctions ; le test
//    vérifie que ces lignes sont toujours les bonnes.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const DIAG_PATH = path.join(RACINE, 'windows', 'diagnostic.ps1');
const DIAG = lire('windows', 'diagnostic.ps1');
const UPDATE = lire('windows', 'update.ps1');

// Extrait de diagnostic.ps1 entre deux motifs. Si l'un manque, le script a changé de forme
// et le test échoue.
function tranche(source, debutMotif, finMotif) {
  const iDebut = source.indexOf(debutMotif);
  assert.ok(iDebut !== -1, 'motif de début introuvable dans diagnostic.ps1 : ' + debutMotif);
  const iFin = source.indexOf(finMotif, iDebut + debutMotif.length);
  assert.ok(iFin !== -1, 'motif de fin introuvable dans diagnostic.ps1 : ' + finMotif);
  return source.slice(iDebut, iFin);
}

function ligneContenant(source, motif) {
  const i = source.indexOf(motif);
  assert.ok(i !== -1, 'ligne introuvable dans diagnostic.ps1 : ' + motif);
  const finLigne = source.indexOf('\r\n', i);
  return source.slice(i, finLigne === -1 ? source.length : finLigne);
}

// ---- Contrats sur le texte source, sans rien exécuter ----

test('correctif 1 : la branche « pas requis » ne recopie plus la branche « requis »', () => {
  const bloc = tranche(DIAG, '$sujet = $app.nom', '\r\n  $v = ');
  // Deux affectations à $etat, de valeurs différentes : 'manque' puis 'note'.
  const lignesEtat = bloc.split('\r\n').filter((l) => l.indexOf('$etat = ') !== -1 || l.indexOf('$etat =') !== -1);
  assert.ok(lignesEtat.length >= 2, 'les deux affectations de $etat ont disparu du bloc');
  assert.ok(bloc.indexOf("$etat = 'manque'") !== -1, 'la branche par défaut doit rester « manque »');
  assert.ok(bloc.indexOf("if (-not $app.requis) { $etat = 'note' }") !== -1,
    'la branche « pas requis » doit passer $etat à \'note\', le ton que Dire sait déjà afficher sans faire échouer le diagnostic');
});

test('correctif 1 : le ton \'note\' n\'est pas compté dans le verdict final', () => {
  // $aReparer ne retient que 'manque' : sinon le ton 'note' ferait aussi échouer le
  // diagnostic.
  const ligne = ligneContenant(DIAG, '$aReparer = @($Bilan');
  assert.match(ligne, /Where-Object \{ \$_\.etat -eq 'manque' \}/,
    'le filtre du verdict a changé : vérifier qu\'il ne compte toujours que \'manque\'');
});

test('correctif 2 : plus de littéral « 4 entrées », le compte vient de Get-SzhRaccourcisMenu', () => {
  assert.ok(DIAG.indexOf('4 entrées') === -1,
    'diagnostic.ps1 porte encore un compte écrit en dur : ' + "'4 entrées'");
  assert.ok(DIAG.indexOf('les 4 entrées') === -1,
    'diagnostic.ps1 porte encore un compte écrit en dur : ' + "'les 4 entrées'");
  // Les deux textes se forment avec -f à partir du .Count du tableau de
  // Get-SzhRaccourcisMenu.
  assert.ok(DIAG.indexOf('$raccourcisMenu = @(Get-SzhRaccourcisMenu)') !== -1,
    'le tableau de raccourcis n\'est plus capturé dans une variable nommée');
  assert.match(DIAG, /'Raccourcis du menu Démarrer'\s*\(\s*'\{0\} entrées en place'\s*-f\s*\$raccourcisMenu\.Count\s*\)/);
  assert.match(DIAG, /'Icône dans la barre des tâches'\s*\(\s*'les \{0\} entrées portent leur identité'\s*-f\s*\$raccourcisMenu\.Count\s*\)/);
});

test('correctif 3 : les clés de registre restent en dur, mais un commentaire ⚠ nomme update.ps1 comme propriétaire', () => {
  const bloc = tranche(DIAG, '# ⚠ Ces deux chemins de registre', "\r\nif (Test-Path (Join-Path \$env:USERPROFILE '.wslconfig'))");
  assert.ok(bloc.indexOf('update.ps1') !== -1, 'le commentaire ne nomme plus update.ps1 comme propriétaire');
  assert.ok(bloc.indexOf('Set-SzhProgIdMarkdown') !== -1, 'le commentaire ne nomme plus Set-SzhProgIdMarkdown');
  assert.ok(bloc.indexOf('Set-SzhProtocoleSzh') !== -1, 'le commentaire ne nomme plus Set-SzhProtocoleSzh');
  assert.ok(bloc.indexOf('centralisation') !== -1,
    'le commentaire ne dit plus qu\'une centralisation reste à faire — sans quoi le prochain lecteur croira le sujet clos');
  // Aucune fonction de szh-common.ps1 ne nomme ces clés : elles restent écrites en dur.
  assert.ok(bloc.indexOf('HKCU:\\Software\\Classes\\SZH.Markdown\\shell\\open\\command') !== -1);
  assert.ok(bloc.indexOf('HKCU:\\Software\\Classes\\szh\\shell\\open\\command') !== -1);
});

// Bornes d'une fonction PowerShell : de sa déclaration jusqu'à la première ligne réduite à
// « } » en colonne 0. Numéros de ligne à partir de 1, comme ceux cités dans diagnostic.ps1.
function bornesFonction(source, nom) {
  const lignes = source.split('\r\n');
  let debut = -1;
  for (let i = 0; i < lignes.length; i++) {
    if (lignes[i].indexOf('function ' + nom) === 0) { debut = i; break; }
  }
  assert.ok(debut !== -1, 'fonction introuvable dans update.ps1 : ' + nom);
  let fin = -1;
  for (let i = debut + 1; i < lignes.length; i++) {
    if (lignes[i] === '}') { fin = i; break; }
  }
  assert.ok(fin !== -1, 'fin de fonction introuvable dans update.ps1 : ' + nom);
  return { debut: debut + 1, fin: fin + 1 };
}

// Toute modification d'update.ps1 au-dessus de ces fonctions décale les lignes : il faut
// alors mettre à jour la citation dans diagnostic.ps1.
test('correctif 3 : les lignes citées d’update.ps1 sont toujours les bonnes', () => {
  const reelProgId = bornesFonction(UPDATE, 'Set-SzhProgIdMarkdown');
  const reelProtocole = bornesFonction(UPDATE, 'Set-SzhProtocoleSzh');
  const bloc = tranche(DIAG, '# ⚠ Ces deux chemins de registre',
    "\r\nif (Test-Path (Join-Path \$env:USERPROFILE '.wslconfig'))");
  const citations = [...bloc.matchAll(/update\.ps1:(\d+)-(\d+)/g)].map(
    (m) => ({ debut: Number(m[1]), fin: Number(m[2]) }));
  assert.strictEqual(citations.length, 2, 'il faut une citation de lignes par fonction citée');
  assert.deepStrictEqual(citations[0], reelProgId,
    'la citation de Set-SzhProgIdMarkdown ne correspond plus à update.ps1');
  assert.deepStrictEqual(citations[1], reelProtocole,
    'la citation de Set-SzhProtocoleSzh ne correspond plus à update.ps1');
});

// ---- Les sujets 1 et 2, exécutés ----
// Windows seulement. Les essais travaillent dans des dossiers jetables du dossier
// temporaire, sans toucher au registre, aux tâches planifiées ni à C:\ProgramData.

const { POWERSHELL, sansPowerShell } = require('./gardes');

// Sans BOM, PowerShell 5.1 lit un .ps1 dans la page de code ANSI du poste, et les accents
// des extraits seraient corrompus.
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\uFEFF' + contenu, 'utf8');
}

// ---- Sujet 1 : une application facultative et une application requise, absentes ----

const BLOC_BILAN_DIRE = tranche(DIAG,
  '$script:Bilan = New-Object System.Collections.ArrayList', '\r\n\r\nWrite-SzhBanniere');
const BLOC_APPS = tranche(DIAG,
  "$verrouApps = Join-Path \$PSScriptRoot 'apps.lock'", '\r\n\r\n# wscript.exe porte les deux lanceurs');
const LIGNE_VERDICT = ligneContenant(DIAG, '$aReparer = @($Bilan');

const bilanApps = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-diagnostic-apps-'));
  // Deux sondes qui n'existent pas.
  const introuvableRequise = path.join(os.tmpdir(), 'szh-test-introuvable-' + process.pid + '-requise.exe');
  const introuvableFacultative = path.join(os.tmpdir(), 'szh-test-introuvable-' + process.pid + '-facultative.exe');
  const appsLock = {
    applications: [
      { nom: 'AppTestRequise', version: '9.9.9', sondes: [introuvableRequise], requis: true },
      { nom: 'AppTestFacultative', version: '9.9.9', sondes: [introuvableFacultative], requis: false }
    ]
  };
  fs.writeFileSync(path.join(travail, 'apps.lock'), JSON.stringify(appsLock), 'utf8');
  const pilote = path.join(travail, 'eprouver.ps1');
  const sortie = path.join(travail, 'bilan.json');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    BLOC_BILAN_DIRE,
    BLOC_APPS,
    LIGNE_VERDICT,
    '$sortie = $args[0]',
    '$json = [ordered]@{',
    '  bilan = @($Bilan | ForEach-Object { [ordered]@{ etat = $_.etat; sujet = $_.sujet } })',
    '  aReparerCount = @($aReparer).Count',
    '} | ConvertTo-Json -Depth 6',
    '[System.IO.File]::WriteAllText($sortie, $json, (New-Object System.Text.UTF8Encoding($false)))'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);
  // $PSScriptRoot vaut le dossier du script lancé par -File : le pilote lit l'apps.lock du
  // dossier jetable.
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote, sortie],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('correctif 1, réellement exécuté : requis:false ressort en \'note\', requis:true en \'manque\'',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(bilanApps.status, 0, 'le pilote PowerShell a échoué : ' + bilanApps.stderr);
    const parApp = {};
    for (const e of bilanApps.r.bilan) { parApp[e.sujet] = e.etat; }
    assert.strictEqual(parApp.AppTestRequise, 'manque',
      'une application requise et absente doit toujours ressortir en \'manque\'');
    assert.strictEqual(parApp.AppTestFacultative, 'note',
      'une application non requise et absente doit ressortir en \'note\', pas en \'manque\'');
  });

test('correctif 1, réellement exécuté : le verdict final ne compte que l\'application requise',
  { skip: sansPowerShell }, () => {
    // Seule l'application requise compte dans le nombre qui décide du code de sortie.
    assert.strictEqual(bilanApps.r.aReparerCount, 1,
      'le verdict final compte l\'application facultative absente comme un défaut à réparer');
  });

// ---- Sujet 2 : le nombre de raccourcis vient de Get-SzhRaccourcisMenu ----

const BLOC_RACCOURCIS = tranche(DIAG,
  '$absents = New-Object System.Collections.ArrayList',
  '\r\n\r\n# ⚠ Ces deux chemins de registre');

const bilanRaccourcis = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-diagnostic-raccourcis-'));
  const menu = path.join(travail, 'Programs');
  const sortie = path.join(travail, 'bilan.json');
  const pilote = path.join(travail, 'eprouver.ps1');
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '. "' + COMMUN_PS1 + '"',
    BLOC_BILAN_DIRE,
    '$menu = $args[0]; $toolkitReel = $args[1]; $sortie = $args[2]',
    // Pose dans un menu Démarrer jetable les raccourcis de Get-SzhRaccourcisMenu : $absents
    // est vide, et le bloc passe par ses branches 'ok', celles qui affichent le nombre.
    '$null = Set-SzhRaccourcisMenu -Menu $menu -Toolkit $toolkitReel',
    BLOC_RACCOURCIS,
    // Second appel, indépendant de $raccourcisMenu : les deux nombres doivent concorder.
    '$compteIndependant = @(Get-SzhRaccourcisMenu -Toolkit $toolkitReel).Count',
    '$json = [ordered]@{',
    '  raccourcisMenuCount = $raccourcisMenu.Count',
    '  compteIndependant = $compteIndependant',
    '  absentsCount = @($absents).Count',
    '  bilan = @($Bilan | ForEach-Object { [ordered]@{ etat = $_.etat; sujet = $_.sujet; detail = $_.detail } })',
    '} | ConvertTo-Json -Depth 6',
    '[System.IO.File]::WriteAllText($sortie, $json, (New-Object System.Text.UTF8Encoding($false)))'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    menu, RACINE, sortie],
  { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('correctif 2, réellement exécuté : aucun raccourci absent avec un menu complet', { skip: sansPowerShell }, () => {
  assert.strictEqual(bilanRaccourcis.status, 0, 'le pilote PowerShell a échoué : ' + bilanRaccourcis.stderr);
  assert.strictEqual(bilanRaccourcis.r.absentsCount, 0,
    'Set-SzhRaccourcisMenu n\'a pas posé toutes les entrées attendues par Get-SzhRaccourcisMenu');
});

test('correctif 2, réellement exécuté : le compte affiché est celui, réel, de Get-SzhRaccourcisMenu',
  { skip: sansPowerShell }, () => {
    const r = bilanRaccourcis.r;
    assert.strictEqual(r.raccourcisMenuCount, r.compteIndependant,
      'le compte utilisé par le diagnostic a divergé d\'un second appel à Get-SzhRaccourcisMenu : il ne dérive plus de la fonction');
    const parSujet = {};
    for (const e of r.bilan) { parSujet[e.sujet] = e; }
    assert.strictEqual(parSujet['Raccourcis du menu Démarrer'].etat, 'ok');
    assert.strictEqual(parSujet['Raccourcis du menu Démarrer'].detail,
      r.raccourcisMenuCount + ' entrées en place');
    assert.strictEqual(parSujet['Icône dans la barre des tâches'].etat, 'ok');
    assert.strictEqual(parSujet['Icône dans la barre des tâches'].detail,
      'les ' + r.raccourcisMenuCount + ' entrées portent leur identité');
  });
