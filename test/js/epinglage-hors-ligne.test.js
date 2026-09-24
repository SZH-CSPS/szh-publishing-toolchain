// L'épinglage hors ligne (OneDrive Files On-Demand) — windows/szh-epinglage.ps1,
// Get-SzhDossiersAEpingler / Invoke-SzhEpinglageHorsLigne —, appelé par open-produit.ps1
// juste après le check-in (demande de Robin, 24.09.2026).
//
//   node --test test/js/epinglage-hors-ligne.test.js
//   node --test "test/js/*.test.js"
//
// Ce que ce banc prouve, sur des arborescences jetables (jamais le vrai OneDrive, jamais le
// vrai C:\ProgramData) :
//   1. le plan (Get-SzhDossiersAEpingler) retient chaque numéro EN COURS des deux revues
//      (reconnus à leur ausgabe.yaml ou buch.yaml), jamais _Archive, et la bibliothèque
//      _NewsUndActu\Fiches + _NewsUndActu\_Statuts PAR NOM — jamais _Import-*, même présent
//      à côté ;
//   2. racine de production et racine active distinctes (mode test) : la bibliothèque des
//      DEUX apparaît dans le plan, mais les numéros en cours ne viennent QUE de la racine
//      active ;
//   3. `"epinglageHorsLigne": false` dans config.json : rien n'est examiné ;
//   4. en simulation (SZH_LANCEUR_SIMULE=1), le plan est bien calculé mais aucun lancement
//      réel n'a lieu ;
//   5. un dossier « à épingler » lance le processus (compté « lances »), un dossier « déjà
//      épingle » ne lance rien (compté « deja ») — vérification d'attribut et lancement de
//      processus tous deux injectés, jamais un vrai attrib.exe ;
//   6. le journal ne porte une ligne récapitulative que lorsque quelque chose a vraiment été
//      lancé.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');

// Détection partagée (gardes.js) : sous un runner simulé sans PowerShell, elle rend
// « indisponible » au lieu d'appeler le vrai powershell.exe.
const { POWERSHELL, sansPowerShell } = require('./gardes');

function monterArborescence(nom) {
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-epinglage-' + nom + '-'));
  const programData = path.join(travail, 'ProgramData');
  fs.mkdirSync(programData, { recursive: true });
  return { travail, programData };
}

function ecrireAusgabe(dossier, contenu) {
  fs.mkdirSync(dossier, { recursive: true });
  fs.writeFileSync(path.join(dossier, 'ausgabe.yaml'), contenu || 'titre: "Numero"\n', 'utf8');
}

// Lance un script PowerShell qui dot-source windows/szh-common.ps1 (donc szh-epinglage.ps1)
// sur l'arborescence jetable, exécute `corps`, et rend le JSON que `corps` a écrit dans
// $sortie (déjà préparé pour lui). `corps` doit assigner sa réponse à $reponse.
function executerPs(f, corps, envSupp) {
  const sonde = path.join(f.travail, 'sonde-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1');
  const sortie = sonde.replace(/\.ps1$/, '.json');
  const script = [
    'param([string]$RacineDepot)',
    '. (Join-Path $RacineDepot \'windows\\szh-common.ps1\')',
    '$reponse = $null',
    corps,
    ('$reponse | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath \'' +
      sortie.replace(/\\/g, '\\\\') + '\' -Encoding UTF8')
  ].join('\r\n');
  fs.writeFileSync(sonde, '\ufeff' + script, 'utf8');
  const env = Object.assign({}, process.env, {
    SZH_BASE: f.programData,
    LOCALAPPDATA: path.join(f.travail, 'Local')
  }, envSupp || {});
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', sonde,
    '-RacineDepot', RACINE], { encoding: 'utf8', windowsHide: true, timeout: 120000, env });
  let reponse = null;
  try { reponse = JSON.parse(fs.readFileSync(sortie, 'utf8').replace(/^\uFEFF/, '')); } catch (e) { reponse = null; }
  return { run, reponse };
}

function lireJournal(f) {
  const dossierLogs = path.join(f.programData, 'logs');
  if (!fs.existsSync(dossierLogs)) { return ''; }
  const logs = fs.readdirSync(dossierLogs).filter((n) => n.startsWith('szh-') && n.endsWith('.log'));
  if (logs.length === 0) { return ''; }
  return logs.map((n) => fs.readFileSync(path.join(dossierLogs, n), 'utf8')).join('\n');
}

test('le plan retient les numéros et les livres en cours, jamais _Archive, et la bibliothèque par nom (jamais _Import-*)',
  { skip: sansPowerShell }, () => {
    const f = monterArborescence('plan-simple');
    try {
      const racine = path.join(f.travail, 'racine');
      ecrireAusgabe(path.join(racine, 'Revue', '2027-01'), 'titre: "En cours"\n');
      // Sans ausgabe.yaml : pas un numéro, jamais retenu.
      fs.mkdirSync(path.join(racine, 'Revue', '2027-99'), { recursive: true });
      ecrireAusgabe(path.join(racine, '_Archive', 'Revue', '2020-01'), 'titre: "Archive"\n');
      ecrireAusgabe(path.join(racine, 'Zeitschrift', '2027-05'), 'titre: "Zeitschrift"\n');
      // Un livre en cours (buch.yaml) : retenu. Un dossier de Books sans buch.yaml, ou un
      // livre archivé : jamais.
      fs.mkdirSync(path.join(racine, 'Books', '2025-B1-Test'), { recursive: true });
      fs.writeFileSync(path.join(racine, 'Books', '2025-B1-Test', 'buch.yaml'), 'titre: "Livre"\n', 'utf8');
      fs.mkdirSync(path.join(racine, 'Books', 'pas-un-livre'), { recursive: true });
      fs.mkdirSync(path.join(racine, '_Archive', 'Books', '2020-B1-Ancien'), { recursive: true });
      fs.writeFileSync(path.join(racine, '_Archive', 'Books', '2020-B1-Ancien', 'buch.yaml'), 'titre: "Ancien"\n', 'utf8');
      fs.mkdirSync(path.join(racine, '_NewsUndActu', 'Fiches'), { recursive: true });
      fs.mkdirSync(path.join(racine, '_NewsUndActu', '_Statuts'), { recursive: true });
      // Jamais épinglé, même présent juste à côté de Fiches/_Statuts.
      fs.mkdirSync(path.join(racine, '_NewsUndActu', '_Import-fr'), { recursive: true });

      const corps = [
        '$plan = Get-SzhDossiersAEpingler -RacineActive \'' + racine +
          '\' -RacineProduction \'' + racine + '\'',
        '$reponse = @($plan | Sort-Object)'
      ].join('\r\n');
      const { run, reponse } = executerPs(f, corps);
      assert.strictEqual(run.status, 0, 'le calcul du plan a échoué : ' + run.stderr);
      assert.ok(Array.isArray(reponse), 'le plan ne rend pas un tableau : ' + JSON.stringify(reponse));

      const attendu = [
        path.join(racine, 'Revue', '2027-01'),
        path.join(racine, 'Zeitschrift', '2027-05'),
        path.join(racine, 'Books', '2025-B1-Test'),
        path.join(racine, '_NewsUndActu', 'Fiches'),
        path.join(racine, '_NewsUndActu', '_Statuts')
      ].sort();
      assert.deepStrictEqual(reponse.slice().sort(), attendu,
        'le plan ne correspond pas à ce qui devait être retenu : ' + JSON.stringify(reponse));
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('racine active et racine de production distinctes : la bibliothèque des DEUX, les numéros de l’active seulement',
  { skip: sansPowerShell }, () => {
    const f = monterArborescence('plan-distinct');
    try {
      const racineActive = path.join(f.travail, 'racine-test');
      const racineProd = path.join(f.travail, 'racine-prod');
      ecrireAusgabe(path.join(racineActive, 'Revue', '2028-01'), 'titre: "Test"\n');
      fs.mkdirSync(path.join(racineActive, '_NewsUndActu', 'Fiches'), { recursive: true });
      fs.mkdirSync(path.join(racineActive, '_NewsUndActu', '_Statuts'), { recursive: true });

      // Un numéro côté PRODUCTION : ne doit JAMAIS apparaître dans le plan, seule la racine
      // active est balayée pour les numéros en cours.
      ecrireAusgabe(path.join(racineProd, 'Revue', '2099-01'), 'titre: "Prod"\n');
      fs.mkdirSync(path.join(racineProd, '_NewsUndActu', 'Fiches'), { recursive: true });
      fs.mkdirSync(path.join(racineProd, '_NewsUndActu', '_Statuts'), { recursive: true });

      const corps = [
        '$plan = Get-SzhDossiersAEpingler -RacineActive \'' + racineActive +
          '\' -RacineProduction \'' + racineProd + '\'',
        '$reponse = @($plan | Sort-Object)'
      ].join('\r\n');
      const { run, reponse } = executerPs(f, corps);
      assert.strictEqual(run.status, 0, 'le calcul du plan a échoué : ' + run.stderr);

      const attendu = [
        path.join(racineActive, 'Revue', '2028-01'),
        path.join(racineActive, '_NewsUndActu', 'Fiches'),
        path.join(racineActive, '_NewsUndActu', '_Statuts'),
        path.join(racineProd, '_NewsUndActu', 'Fiches'),
        path.join(racineProd, '_NewsUndActu', '_Statuts')
      ].sort();
      assert.deepStrictEqual(reponse.slice().sort(), attendu,
        'le plan ne distingue pas correctement racine active et racine de production : ' + JSON.stringify(reponse));
      assert.ok(reponse.indexOf(path.join(racineProd, 'Revue', '2099-01')) === -1,
        'un numéro de la racine de production a été retenu : la migration/l’épinglage des numéros ne doit lire QUE la racine active');
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('"epinglageHorsLigne": false dans config.json : rien n’est examiné',
  { skip: sansPowerShell }, () => {
    const f = monterArborescence('reglage-desactive');
    try {
      fs.writeFileSync(path.join(f.programData, 'config.json'),
        JSON.stringify({ epinglageHorsLigne: false }), 'utf8');

      const corps = '$reponse = Invoke-SzhEpinglageHorsLigne -Dossiers @(\'C:\\peu-importe\')';
      const { run, reponse } = executerPs(f, corps);
      assert.strictEqual(run.status, 0, 'l’appel a échoué : ' + run.stderr);
      assert.deepStrictEqual(reponse, { examines: 0, lances: 0, deja: 0, ignores: 0 },
        'le réglage désactivé aurait dû tout laisser à zéro : ' + JSON.stringify(reponse));
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('en simulation (SZH_LANCEUR_SIMULE=1) : le plan est calculé, mais rien n’est lancé',
  { skip: sansPowerShell }, () => {
    const f = monterArborescence('simulation');
    try {
      const corps = [
        'function Faux-Verif([string]$Chemin) { return \'aepingler\' }',
        '$Script:appels = New-Object System.Collections.Generic.List[string]',
        'function Faux-Lanceur([string]$Chemin) { $Script:appels.Add($Chemin) }',
        '$dossiers = @(\'C:\\dossier-a-epingler-1\', \'C:\\dossier-a-epingler-2\')',
        '$resultat = Invoke-SzhEpinglageHorsLigne -Dossiers $dossiers ' +
          '-VerifAttribut \'Faux-Verif\' -LanceurProcessus \'Faux-Lanceur\'',
        '$reponse = [ordered]@{ resultat = $resultat; appels = @($Script:appels) }'
      ].join('\r\n');
      const { run, reponse } = executerPs(f, corps, { SZH_LANCEUR_SIMULE: '1' });
      assert.strictEqual(run.status, 0, 'l’appel a échoué : ' + run.stderr);
      assert.strictEqual(reponse.resultat.examines, 2, 'le plan n’a pas été calculé (examines)');
      assert.strictEqual(reponse.resultat.lances, 0, 'un lancement a eu lieu en simulation');
      assert.deepStrictEqual(reponse.appels, [], 'le lanceur de processus a été appelé en simulation : ' + JSON.stringify(reponse.appels));
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('un dossier « à épingler » lance le processus, un dossier « déjà épinglé » ne lance rien',
  { skip: sansPowerShell }, () => {
    const f = monterArborescence('lance-deja');
    try {
      const corps = [
        'function Faux-Verif([string]$Chemin) {',
        '  if ($Chemin -like \'*AEPINGLER*\') { return \'aepingler\' }',
        '  if ($Chemin -like \'*HORSONEDRIVE*\') { return \'horsonedrive\' }',
        '  return \'epingle\'',
        '}',
        '$Script:appels = New-Object System.Collections.Generic.List[string]',
        'function Faux-Lanceur([string]$Chemin) { $Script:appels.Add($Chemin) }',
        '$dossiers = @(\'C:\\AEPINGLER-1\', \'C:\\DEJA-EPINGLE-1\', \'C:\\HORSONEDRIVE-1\')',
        '$resultat = Invoke-SzhEpinglageHorsLigne -Dossiers $dossiers ' +
          '-VerifAttribut \'Faux-Verif\' -LanceurProcessus \'Faux-Lanceur\'',
        '$reponse = [ordered]@{ resultat = $resultat; appels = @($Script:appels) }'
      ].join('\r\n');
      const { run, reponse } = executerPs(f, corps);
      assert.strictEqual(run.status, 0, 'l’appel a échoué : ' + run.stderr);
      assert.strictEqual(reponse.resultat.examines, 3);
      assert.strictEqual(reponse.resultat.lances, 1, 'un seul dossier "à épingler" aurait dû être lancé');
      assert.strictEqual(reponse.resultat.deja, 1, 'le dossier déjà épinglé aurait dû être compté à part');
      assert.strictEqual(reponse.resultat.ignores, 1, 'le dossier hors OneDrive aurait dû être ignoré');
      assert.deepStrictEqual(reponse.appels, ['C:\\AEPINGLER-1'],
        'le faux lanceur n’a pas été appelé exactement sur le dossier "à épingler" : ' + JSON.stringify(reponse.appels));

      const journal = lireJournal(f);
      assert.match(journal, /epinglage hors ligne/, 'le journal ne dit pas qu’un dossier a été marqué');
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });

test('rien de lancé : le journal ne porte aucune ligne récapitulative',
  { skip: sansPowerShell }, () => {
    const f = monterArborescence('rien-lance-journal');
    try {
      const corps = [
        'function Faux-Verif([string]$Chemin) { return \'epingle\' }',
        'function Faux-Lanceur([string]$Chemin) { throw \'ne doit jamais etre appelee\' }',
        '$dossiers = @(\'C:\\DEJA-EPINGLE-1\', \'C:\\DEJA-EPINGLE-2\')',
        '$resultat = Invoke-SzhEpinglageHorsLigne -Dossiers $dossiers ' +
          '-VerifAttribut \'Faux-Verif\' -LanceurProcessus \'Faux-Lanceur\'',
        '$reponse = $resultat'
      ].join('\r\n');
      const { run, reponse } = executerPs(f, corps);
      assert.strictEqual(run.status, 0, 'l’appel a échoué : ' + run.stderr);
      assert.strictEqual(reponse.lances, 0);
      assert.strictEqual(reponse.deja, 2);

      const journal = lireJournal(f);
      assert.ok(!/epinglage hors ligne/.test(journal),
        'une ligne récapitulative a été écrite alors que rien n’a été lancé : ' + journal);
    } finally {
      fs.rmSync(f.travail, { recursive: true, force: true });
    }
  });
