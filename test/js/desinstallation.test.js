// Le désinstalleur administrateur de la chaîne SZH (windows/uninstall.ps1,
// windows/szh-desinstallation.ps1, windows/Désinstaller le poste SZH.cmd) : ce qu'il ne doit
// JAMAIS faire, et ce qu'il fait réellement sur une arborescence jetable.
//
//   node --test "test/js/*.test.js"
//
// Trois contrats de source, vérifiés partout (pas seulement sous Windows) :
//   * ni uninstall.ps1 ni szh-desinstallation.ps1 n'appellent jamais `wsl --unregister` ;
//   * szh-desinstallation.ps1 porte la garde (Assert-SzhCibleMachineAutorisee) qui refuse
//     toute cible « fichier-machine » sous WSL\ ou égale à la racine SZH, réappliquée à
//     l'exécution (Invoke-SzhPlanDesinstallation), pas seulement à la construction du plan ;
//   * le .cmd s'élève puis appelle uninstall.ps1 du même dossier.
//
// Le reste (Windows seulement, comme test/js/toolkit-remplacement.test.js) rejoue
// Get-SzhPlanDesinstallation / Invoke-SzhPlanDesinstallation sur une arborescence $SZH_BASE
// jetable, JAMAIS C:\ProgramData\SZH -- et jamais sur le vrai compte Windows qui exécute les
// tests : les scénarios qui appellent Invoke- réellement (b, c, d) ne portent que sur des
// entrées « fichier-machine », toutes sous l'arborescence jetable. Aucune tâche planifiée
// réelle n'est créée, aucune clé de registre réelle n'est touchée : ces deux familles restent
// au niveau du plan (lecture seule), dans le scénario (e) via uninstall.ps1 -Simuler -Json.
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
const DESINSTALL_PS1 = path.join(RACINE, 'windows', 'szh-desinstallation.ps1');
const UNINSTALL_PS1 = path.join(RACINE, 'windows', 'uninstall.ps1');
const UNINSTALL = lire('windows', 'uninstall.ps1');
const DESINSTALLATION = lire('windows', 'szh-desinstallation.ps1');
const CMD = lire('windows', 'Désinstaller le poste SZH.cmd');

// ---- Contrats de source : partout, pas seulement sous Windows ----

test('ni uninstall.ps1 ni szh-desinstallation.ps1 n’appellent jamais `wsl --unregister`', () => {
  assert.ok(UNINSTALL.toLowerCase().indexOf('--unregister') === -1,
    'uninstall.ps1 contient --unregister');
  assert.ok(DESINSTALLATION.toLowerCase().indexOf('--unregister') === -1,
    'szh-desinstallation.ps1 contient --unregister');
});

test('szh-desinstallation.ps1 porte la garde qui refuse toute cible sous WSL\\ ou égale à la racine', () => {
  assert.ok(DESINSTALLATION.indexOf('function Assert-SzhCibleMachineAutorisee') !== -1,
    'la garde Assert-SzhCibleMachineAutorisee est introuvable');
  assert.ok(DESINSTALLATION.indexOf("$cibleNorm -ieq $baseNorm") !== -1,
    'la garde ne compare plus la cible à la racine elle-même');
  assert.ok(DESINSTALLATION.indexOf("($wslNorm + '\\*')") !== -1,
    'la garde ne compare plus la cible à ce qui est sous WSL\\');
  // Réappliquée à CHAQUE suppression d'un « fichier-machine », dans Invoke-, pas seulement
  // une fois à la construction du plan dans Get-SzhPlanDesinstallation.
  const iGet = DESINSTALLATION.indexOf('function Get-SzhPlanDesinstallation');
  const iInvoke = DESINSTALLATION.indexOf('function Invoke-SzhPlanDesinstallation');
  assert.ok(iGet !== -1 && iInvoke !== -1 && iGet < iInvoke);
  const corpsGet = DESINSTALLATION.slice(iGet, iInvoke);
  const corpsInvoke = DESINSTALLATION.slice(iInvoke);
  assert.ok(corpsGet.indexOf('Assert-SzhCibleMachineAutorisee') !== -1,
    'Get-SzhPlanDesinstallation n’applique plus la garde à la construction du plan');
  assert.ok(corpsInvoke.indexOf('Assert-SzhCibleMachineAutorisee') !== -1,
    'Invoke-SzhPlanDesinstallation ne réapplique plus la garde avant de supprimer');
});

test('le .cmd « Désinstaller le poste SZH » s’élève puis appelle uninstall.ps1 du même dossier', () => {
  assert.match(CMD, /-Verb RunAs/);
  assert.match(CMD, /SZH_UNINSTALL=%~dp0uninstall\.ps1/);
  assert.match(CMD, /-File "%SZH_UNINSTALL%"/);
  // Deux lignes d'en-tête : ce qu'il fait, et d'où le lancer -- jamais depuis le toolkit.
  assert.match(CMD, /rem  Desinstallation d'un poste SZH/i);
  assert.match(CMD, /jamais depuis C:\\ProgramData\\SZH\\toolkit/i);
});

// ---- Le reste : Windows seulement, sur une arborescence $SZH_BASE jetable ----

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

// Même remarque, et même geste, que test/js/orphelins-toolkit.test.js et
// test/js/toolkit-remplacement.test.js : Windows PowerShell 5.1 lit un .ps1 SANS BOM avec la
// page de code ANSI du poste, jamais en UTF-8 -- sans ce préfixe, les accents des pilotes
// ci-dessous ressortiraient mojibake une fois relus.
function ecrirePs1(chemin, contenu) {
  fs.writeFileSync(chemin, '\uFEFF' + contenu, 'utf8');
}

// L'arborescence exacte demandée par la consigne : toolkit (avec un sous-dossier windows),
// toolkit.neuf vide, staging avec une archive, logs avec un journal, config.json, state.json,
// le disque d'une distro sous WSL\<SID>\SZH-Publishing, et un dossier « autre » inconnu.
function poserArborescence(base) {
  fs.mkdirSync(path.join(base, 'toolkit', 'windows'), { recursive: true });
  fs.writeFileSync(path.join(base, 'toolkit', 'VERSION'), '2026.09.01', 'utf8');
  fs.writeFileSync(path.join(base, 'toolkit', 'windows', 'x.ps1'), '# x', 'utf8');
  fs.mkdirSync(path.join(base, 'toolkit.neuf'), { recursive: true });
  fs.mkdirSync(path.join(base, 'staging'), { recursive: true });
  fs.writeFileSync(path.join(base, 'staging', 'a.zip'), 'x', 'utf8');
  fs.mkdirSync(path.join(base, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(base, 'logs', 'szh-2026-09.log'), 'x', 'utf8');
  fs.writeFileSync(path.join(base, 'config.json'), '{}', 'utf8');
  fs.writeFileSync(path.join(base, 'state.json'), '{}', 'utf8');
  fs.mkdirSync(path.join(base, 'WSL', 'S-1-5-21-1', 'SZH-Publishing'), { recursive: true });
  fs.writeFileSync(path.join(base, 'WSL', 'S-1-5-21-1', 'SZH-Publishing', 'ext4.vhdx'), 'disque factice', 'utf8');
  fs.mkdirSync(path.join(base, 'autre'), { recursive: true });
  fs.writeFileSync(path.join(base, 'autre', 'quelque-chose.txt'), 'x', 'utf8');
}

// Liste complète des fichiers (chemins relatifs, « / ») sous une racine, triée.
function listerFichiers(racine) {
  const sortie = [];
  (function parcourir(dossier, prefixe) {
    for (const nom of fs.readdirSync(dossier)) {
      const p = path.join(dossier, nom);
      const rel = prefixe ? prefixe + '/' + nom : nom;
      if (fs.statSync(p).isDirectory()) { parcourir(p, rel); } else { sortie.push(rel); }
    }
  })(racine, '');
  return sortie.sort();
}

// ---- Scénario (a) : le plan -Machine, sur l'arborescence jetable ----

const scenarioA = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-desinstall-a-'));
  const base = path.join(travail, 'ProgramData');
  const sortie = path.join(travail, 'plan.json');
  const pilote = path.join(travail, 'eprouver.ps1');
  poserArborescence(base);

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$env:SZH_BASE = '" + base + "'",
    '. "' + COMMUN_PS1 + '"',
    '. "' + DESINSTALL_PS1 + '"',
    '$plan = @(Get-SzhPlanDesinstallation -Machine)',
    'Set-SzhJson \'' + sortie + '\' $plan'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);

  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { plan: lu, base: base });
})();

test('plan -Machine : les fichiers connus sous $SzhBase sont recensés « fichier-machine »',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(scenarioA.status, 0, 'le pilote PowerShell a échoué : ' + scenarioA.stderr);
    const parNom = {};
    for (const e of scenarioA.plan) { if (e.type === 'fichier-machine') { parNom[path.basename(e.cible)] = e; } }
    for (const nom of ['toolkit', 'toolkit.neuf', 'staging', 'logs', 'config.json', 'state.json']) {
      assert.ok(parNom[nom], nom + ' n’est pas recensé comme fichier-machine');
      assert.strictEqual(parNom[nom].present, true, nom + ' devrait être présent sur cette arborescence');
    }
    for (const nom of ['toolkit.vieux', 'comptes', 'auteurs.json', 'mots-cles.json', 'maj-auto.json']) {
      assert.ok(parNom[nom], nom + ' n’est pas recensé comme fichier-machine (absent de l’arborescence, mais doit rester dans le plan)');
      assert.strictEqual(parNom[nom].present, false, nom + ' ne devrait pas être présent sur cette arborescence');
    }
  });

test('plan -Machine : jamais la racine elle-même parmi les « fichier-machine »',
  { skip: sansPowerShell }, () => {
    const racines = scenarioA.plan.filter((e) => e.type === 'fichier-machine' &&
      path.resolve(e.cible) === path.resolve(scenarioA.base));
    assert.deepStrictEqual(racines, [], 'la racine SZH apparaît comme une cible fichier-machine');
  });

test('plan -Machine : WSL\\ est « conserve », « autre » est « inconnu », ni l’un ni l’autre n’est fichier-machine',
  { skip: sansPowerShell }, () => {
    const wsl = scenarioA.plan.find((e) => path.basename(e.cible) === 'WSL');
    assert.ok(wsl, 'WSL n’apparaît pas dans le plan');
    assert.strictEqual(wsl.type, 'conserve', 'WSL devrait être de type conserve, pas ' + wsl.type);
    assert.strictEqual(wsl.present, true);

    const autre = scenarioA.plan.find((e) => path.basename(e.cible) === 'autre');
    assert.ok(autre, '« autre » n’apparaît pas dans le plan');
    assert.strictEqual(autre.type, 'inconnu', '« autre » devrait être de type inconnu, pas ' + autre.type);
    assert.strictEqual(autre.present, true);

    assert.deepStrictEqual(scenarioA.plan.filter((e) => e.type === 'fichier-machine' &&
      (path.basename(e.cible) === 'WSL' || path.basename(e.cible) === 'autre')), [],
      'WSL ou « autre » est aussi recensé comme fichier-machine');
  });

// ---- Scénario (b) : Invoke- sur les seules entrées fichier-machine ----

const scenarioB = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-desinstall-b-'));
  const base = path.join(travail, 'ProgramData');
  const sortie = path.join(travail, 'bilan.json');
  const pilote = path.join(travail, 'eprouver.ps1');
  poserArborescence(base);

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$env:SZH_BASE = '" + base + "'",
    '. "' + COMMUN_PS1 + '"',
    '. "' + DESINSTALL_PS1 + '"',
    '$plan = @(Get-SzhPlanDesinstallation -Machine)',
    '$planFichiersMachine = @($plan | Where-Object { $_.type -eq \'fichier-machine\' })',
    '$bilan = Invoke-SzhPlanDesinstallation -Plan $planFichiersMachine',
    '$r = [ordered]@{',
    '  faits = @($bilan.faits).Count; echecs = @($bilan.echecs).Count',
    '  vhdxExiste = (Test-Path (Join-Path $env:SZH_BASE \'WSL\\S-1-5-21-1\\SZH-Publishing\\ext4.vhdx\'))',
    '  autreExiste = (Test-Path (Join-Path $env:SZH_BASE \'autre\\quelque-chose.txt\'))',
    '  racineExiste = (Test-Path $env:SZH_BASE)',
    '  toolkitExiste = (Test-Path (Join-Path $env:SZH_BASE \'toolkit\'))',
    '  toolkitNeufExiste = (Test-Path (Join-Path $env:SZH_BASE \'toolkit.neuf\'))',
    '  stagingExiste = (Test-Path (Join-Path $env:SZH_BASE \'staging\'))',
    '  logsExiste = (Test-Path (Join-Path $env:SZH_BASE \'logs\'))',
    '  configExiste = (Test-Path (Join-Path $env:SZH_BASE \'config.json\'))',
    '  stateExiste = (Test-Path (Join-Path $env:SZH_BASE \'state.json\'))',
    '}',
    'Set-SzhJson \'' + sortie + '\' $r'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);

  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('Invoke- sur les entrées fichier-machine : tout est retiré, sans échec',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(scenarioB.status, 0, 'le pilote PowerShell a échoué : ' + scenarioB.stderr);
    assert.strictEqual(scenarioB.r.echecs, 0, 'des suppressions ont échoué alors que rien ne les en empêchait');
    // toolkit, staging, logs, config.json, state.json : cinq entrées présentes sur cette
    // arborescence (toolkit.vieux, comptes, auteurs.json, mots-cles.json, maj-auto.json ne le
    // sont pas -- ignorées, pas comptées comme « faits »). toolkit.neuf est vide mais EXISTE
    // (Test-Path d'un dossier vide rend $true), donc lui aussi retiré : six au total.
    assert.strictEqual(scenarioB.r.faits, 6, 'nombre de suppressions inattendu : ' + JSON.stringify(scenarioB.r));
  });

test('Invoke- sur les entrées fichier-machine : WSL, « autre » et la racine restent intacts',
  { skip: sansPowerShell }, () => {
    const r = scenarioB.r;
    assert.strictEqual(r.vhdxExiste, true, 'le disque de la distribution a disparu');
    assert.strictEqual(r.autreExiste, true, 'le dossier « autre », non reconnu, a disparu');
    assert.strictEqual(r.racineExiste, true, 'la racine SZH elle-même a disparu');
  });

test('Invoke- sur les entrées fichier-machine : le toolkit et le reste ont bien disparu',
  { skip: sansPowerShell }, () => {
    const r = scenarioB.r;
    assert.strictEqual(r.toolkitExiste, false);
    assert.strictEqual(r.toolkitNeufExiste, false);
    assert.strictEqual(r.stagingExiste, false);
    assert.strictEqual(r.logsExiste, false);
    assert.strictEqual(r.configExiste, false);
    assert.strictEqual(r.stateExiste, false);
  });

// ---- Scénario (c) : un plan forgé visant WSL\ -- refusé, rien ne disparaît ----
//
// Invoke-SzhPlanDesinstallation choisit de journaliser un échec plutôt que de laisser
// l'exception traverser tout le pilote : chaque suppression a son propre try/catch (comme
// toutes les autres), pour qu'une seule entrée fautive n'empêche jamais le reste du plan de
// s'appliquer. Le fichier visé doit survivre dans les deux cas -- c'est lui que ce test
// vérifie, plus que la forme exacte de l'échec.

const scenarioC = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-desinstall-c-'));
  const base = path.join(travail, 'ProgramData');
  const sortie = path.join(travail, 'bilan.json');
  const pilote = path.join(travail, 'eprouver.ps1');
  poserArborescence(base);
  // La cible forgée : un fichier directement sous WSL\, distinct du disque de la distro.
  fs.writeFileSync(path.join(base, 'WSL', 'x'), 'ne doit jamais partir', 'utf8');

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$env:SZH_BASE = '" + base + "'",
    '. "' + COMMUN_PS1 + '"',
    '. "' + DESINSTALL_PS1 + '"',
    '$cibleForgee = Join-Path $env:SZH_BASE \'WSL\\x\'',
    '$planForge = @([pscustomobject]@{ type = \'fichier-machine\'; cible = $cibleForgee; detail = \'forgé\'; present = $true })',
    '$leve = $false; $messageLeve = \'\'',
    '$bilan = $null',
    'try { $bilan = Invoke-SzhPlanDesinstallation -Plan $planForge }',
    'catch { $leve = $true; $messageLeve = $_.Exception.Message }',
    '$r = [ordered]@{',
    '  leve = $leve; messageLeve = $messageLeve',
    '  faits = if ($bilan) { @($bilan.faits).Count } else { -1 }',
    '  echecs = if ($bilan) { @($bilan.echecs).Count } else { -1 }',
    '  messageEchec = if ($bilan -and (@($bilan.echecs).Count -gt 0)) { $bilan.echecs[0].erreur } else { \'\' }',
    '  fichierExiste = (Test-Path -LiteralPath $cibleForgee)',
    '}',
    'Set-SzhJson \'' + sortie + '\' $r'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);

  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('un plan forgé visant WSL\\x : la garde refuse, le fichier survit',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(scenarioC.status, 0, 'le pilote PowerShell a échoué : ' + scenarioC.stderr);
    const r = scenarioC.r;
    assert.strictEqual(r.fichierExiste, true, 'le fichier sous WSL\\ a disparu -- la garde n’a pas tenu');
    // Refusé d'une façon ou d'une autre : soit Invoke- lève, soit elle journalise un échec
    // sans rien avoir fait (faits = 0). Jamais les deux à la fois « rien ne s’est passé ».
    const refuseParEchec = (!r.leve) && (r.faits === 0) && (r.echecs >= 1);
    const refuseParException = r.leve;
    assert.ok(refuseParEchec || refuseParException,
      'ni une levée ni un échec journalisé n’a été observé : ' + JSON.stringify(r));
    if (refuseParEchec) {
      assert.match(r.messageEchec, /WSL/, 'l’échec journalisé ne mentionne pas WSL : ' + r.messageEchec);
    }
    if (refuseParException) {
      assert.match(r.messageLeve, /WSL/, 'l’exception levée ne mentionne pas WSL : ' + r.messageLeve);
    }
  });

// ---- Scénario (d) : -Simuler sur l'arborescence pleine -- rien ne bouge ----

const scenarioD = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-desinstall-d-'));
  const base = path.join(travail, 'ProgramData');
  const sortie = path.join(travail, 'bilan.json');
  const pilote = path.join(travail, 'eprouver.ps1');
  poserArborescence(base);
  const avant = listerFichiers(base);

  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$env:SZH_BASE = '" + base + "'",
    '. "' + COMMUN_PS1 + '"',
    '. "' + DESINSTALL_PS1 + '"',
    '$plan = @(Get-SzhPlanDesinstallation -Machine)',
    '$planFichiersMachine = @($plan | Where-Object { $_.type -eq \'fichier-machine\' })',
    '$bilan = Invoke-SzhPlanDesinstallation -Plan $planFichiersMachine -Simuler',
    '$r = [ordered]@{ faits = @($bilan.faits).Count; echecs = @($bilan.echecs).Count; ignores = @($bilan.ignores).Count }',
    'Set-SzhJson \'' + sortie + '\' $r'
  ].join('\r\n') + '\r\n';
  ecrirePs1(pilote, script);

  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  const apres = listerFichiers(base);
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu, avant: avant, apres: apres });
})();

test('-Simuler sur l’arborescence pleine : rien ne bouge (mêmes fichiers avant/après)',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(scenarioD.status, 0, 'le pilote PowerShell a échoué : ' + scenarioD.stderr);
    assert.strictEqual(scenarioD.r.faits, 0, '-Simuler a quand même compté des suppressions faites');
    assert.deepStrictEqual(scenarioD.apres, scenarioD.avant,
      '-Simuler a changé l’arborescence : ' + JSON.stringify({ avant: scenarioD.avant, apres: scenarioD.apres }));
  });

// ---- Scénario (e) : uninstall.ps1 -Simuler -Json, en sous-processus réel ----
//
// $env:SZH_BASE redirige $SzhToolkit et consorts vers l'arborescence jetable ; les entrées
// « raccourci », « registre » et « extension » du plan, elles, portent forcément sur le VRAI
// compte Windows qui exécute le test (Get-SzhRaccourcisMenu, HKCU, le CLI VSCodium) --
// -Simuler -Json ne fait qu'afficher ce plan, jamais un Invoke-, donc rien n'est modifié nulle
// part, ni dans l'arborescence jetable ni sur le vrai compte.

function lancerUninstallJson(base, applications) {
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', UNINSTALL_PS1, '-Simuler', '-Json'];
  if (applications) { args.push('-Applications'); }
  const env = Object.assign({}, process.env, { SZH_BASE: base });
  return spawnSync(POWERSHELL, args, { encoding: 'utf8', windowsHide: true, timeout: 60000, env: env });
}

const scenarioE = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-desinstall-e-'));
  const base = path.join(travail, 'ProgramData');
  fs.mkdirSync(base, { recursive: true });
  const avant = listerFichiers(travail);

  const sansApplications = lancerUninstallJson(base, false);
  const avecApplications = lancerUninstallJson(base, true);

  const apres = listerFichiers(travail);
  fs.rmSync(travail, { recursive: true, force: true });

  let planSansApplications = null;
  let planAvecApplications = null;
  try { planSansApplications = JSON.parse(sansApplications.stdout); } catch (e) { /* rapporté ci-dessous */ }
  try { planAvecApplications = JSON.parse(avecApplications.stdout); } catch (e) { /* rapporté ci-dessous */ }

  return {
    sansApplications: sansApplications, avecApplications: avecApplications,
    planSansApplications: planSansApplications, planAvecApplications: planAvecApplications,
    avant: avant, apres: apres
  };
})();

test('uninstall.ps1 -Simuler -Json : sortie JSON parsable, exit 0', { skip: sansPowerShell }, () => {
  assert.strictEqual(scenarioE.sansApplications.status, 0,
    'uninstall.ps1 -Simuler -Json a échoué : ' + scenarioE.sansApplications.stderr);
  assert.ok(Array.isArray(scenarioE.planSansApplications),
    'la sortie n’est pas un tableau JSON parsable : ' + scenarioE.sansApplications.stdout.slice(0, 500));
});

test('uninstall.ps1 -Simuler -Json : au moins une entrée tache, une registre, une raccourci, aucune application',
  { skip: sansPowerShell }, () => {
    const plan = scenarioE.planSansApplications;
    assert.ok(plan.some((e) => e.type === 'tache'), 'aucune entrée « tache » dans le plan');
    assert.ok(plan.some((e) => e.type === 'registre'), 'aucune entrée « registre » dans le plan');
    assert.ok(plan.some((e) => e.type === 'raccourci'), 'aucune entrée « raccourci » dans le plan');
    assert.deepStrictEqual(plan.filter((e) => e.type === 'application'), [],
      'une entrée « application » apparaît sans -Applications');
  });

test('uninstall.ps1 -Simuler -Json -Applications : au moins une entrée application',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(scenarioE.avecApplications.status, 0,
      'uninstall.ps1 -Simuler -Json -Applications a échoué : ' + scenarioE.avecApplications.stderr);
    const plan = scenarioE.planAvecApplications;
    assert.ok(plan.some((e) => e.type === 'application'), 'aucune entrée « application » malgré -Applications');
  });

test('uninstall.ps1 -Simuler -Json : l’arborescence jetable est intacte après coup',
  { skip: sansPowerShell }, () => {
    assert.deepStrictEqual(scenarioE.apres, scenarioE.avant,
      '-Simuler -Json a quand même modifié l’arborescence jetable : ' +
      JSON.stringify({ avant: scenarioE.avant, apres: scenarioE.apres }));
  });
