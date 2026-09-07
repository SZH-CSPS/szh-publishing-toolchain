// Le découpage de windows/szh-common.ps1 en quatre fichiers : szh-textes.ps1 (la table des
// textes, données pures), szh-produits.ps1 (emplacements, YAML plat, identité d'un numéro ou
// d'un livre), szh-shell.ps1 (AppUserModelID, raccourcis du menu Démarrer, VSCodium) et
// szh-common.ps1 lui-même, qui garde son nom, ses effets de bord de chargement et dot-source
// les trois fils en tête.
//
//   node --test "test/js/*.test.js"
//
// Ce fichier ne prouve qu'une chose, mais qui engage tout le reste : les onze scripts qui
// dot-sourcent encore « . "$PSScriptRoot\szh-common.ps1" » n'ont rien à changer, parce que
// dot-sourcer ce seul fichier suffit à charger les trois autres et tout ce qu'ils déclarent.
// Une fonction de chaque fil est appelée pour de vrai, sur une arborescence jetable :
//   * T 'lanceur.encours'       -> prouve que $SzhTextes (szh-textes.ps1) est chargée ;
//   * Get-SzhEmplacements       -> prouve que szh-produits.ps1 est chargée ;
//   * Get-SzhRaccourcisMenu     -> prouve que szh-shell.ps1 est chargée.
// Rien n'est écrit sous le vrai C:\ProgramData\SZH : $script:SzhBase est redirigé vers un
// dossier de travail jetable, comme le fait déjà test/js/installation.test.js.
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

// ---- Les quatre fichiers existent, et szh-common.ps1 les dot-source dans le bon ordre ----

test('szh-common.ps1 dot-source les trois fils, textes avant produits avant shell', () => {
  for (const f of ['szh-textes.ps1', 'szh-produits.ps1', 'szh-shell.ps1']) {
    assert.ok(fs.existsSync(path.join(RACINE, 'windows', f)), f + ' manque au dépôt');
  }
  const commun = fs.readFileSync(COMMUN_PS1, 'utf8');
  const iTextes = commun.indexOf('. "$PSScriptRoot\\szh-textes.ps1"');
  const iProduits = commun.indexOf('. "$PSScriptRoot\\szh-produits.ps1"');
  const iShell = commun.indexOf('. "$PSScriptRoot\\szh-shell.ps1"');
  assert.ok(iTextes !== -1 && iProduits !== -1 && iShell !== -1,
    'un des trois dot-source a disparu de szh-common.ps1');
  assert.ok(iTextes < iProduits && iProduits < iShell,
    'l’ordre déclaré (textes, produits, shell) n’est plus respecté');
  // Aucun des onze scripts appelants n'a besoin de changer : ils dot-sourcent encore et
  // seulement szh-common.ps1.
  for (const script of ['archive-revue.ps1', 'bootstrap.ps1', 'diagnostic.ps1',
    'new-livre.ps1', 'new-revue.ps1', 'open-livre.ps1', 'open-md.ps1', 'open-revue.ps1',
    'update-launcher.ps1', 'update.ps1']) {
    const source = fs.readFileSync(path.join(RACINE, 'windows', script), 'utf8');
    assert.ok(source.indexOf('. "$PSScriptRoot\\szh-common.ps1"') !== -1,
      script + ' ne dot-source plus szh-common.ps1');
    assert.ok(source.indexOf('szh-textes.ps1') === -1 && source.indexOf('szh-produits.ps1') === -1
      && source.indexOf('szh-shell.ps1') === -1,
      script + ' dot-source directement un des trois fils : il ne devrait passer que par szh-common.ps1');
  }
});

// ---- Chargement réel, sur une arborescence jetable ----

const PILOTE = [
  "$ErrorActionPreference = 'Stop'",
  '. "' + COMMUN_PS1 + '"',
  '$travail = $args[0]; $sortie = $args[1]',
  // Redirigé avant le premier appel : aucune des trois fonctions ci-dessous ne doit lire ou
  // écrire sous le vrai C:\ProgramData\SZH.
  '$script:SzhBase = Join-Path $travail "ProgramData"',
  '$script:SzhToolkit = Join-Path $SzhBase "toolkit"',
  '$script:SzhStaging = Join-Path $SzhBase "staging"',
  '$script:SzhLogs = Join-Path $SzhBase "logs"',
  '$script:SzhStateFile = Join-Path $SzhBase "state.json"',
  '$script:SzhConfigFile = Join-Path $SzhBase "config.json"',
  '$r = [ordered]@{}',
  // szh-textes.ps1, via T.
  '$r.texte = T \'lanceur.encours\'',
  // szh-produits.ps1, via Get-SzhEmplacements -- rien sur ce dossier jetable n\'existe, la
  // fonction ne doit pas lever pour autant.
  '$emp = Get-SzhEmplacements',
  '$r.emplacement = [string]$emp.emplacement',
  '$r.base = [string]$emp.base',
  '$r.encoursCount = @($emp.encours).Count',
  // szh-shell.ps1, via Get-SzhRaccourcisMenu.
  '$raccourcis = @(Get-SzhRaccourcisMenu -Toolkit $SzhToolkit)',
  '$r.raccourcisCount = $raccourcis.Count',
  '$r.premierNom = [string]$raccourcis[0].nom',
  'Set-SzhJson $sortie $r'
].join('\r\n') + '\r\n';

const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-decoupage-'));
  const pilote = path.join(travail, 'charger.ps1');
  const sortie = path.join(travail, 'bilan.json');
  fs.writeFileSync(pilote, PILOTE, 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote,
    travail, sortie], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  const lu = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
  const restes = { status: run.status, stderr: run.stderr || '' };
  fs.rmSync(travail, { recursive: true, force: true });
  return Object.assign({}, restes, { r: lu });
})();

test('un pilote qui ne dot-source que szh-common.ps1 obtient un résultat non vide des trois fils',
  { skip: sansPowerShell }, () => {
    assert.strictEqual(bilan.status, 0, 'le pilote PowerShell a échoué : ' + bilan.stderr);
    const r = bilan.r;
    // szh-textes.ps1 : un texte réel, jamais la clé nue (ce que T rend quand la table est
    // introuvable ou incomplète).
    assert.ok(r.texte && r.texte !== 'lanceur.encours',
      'T ne trouve plus la table de szh-textes.ps1 : ' + JSON.stringify(r.texte));
    // szh-produits.ps1 : un emplacement résolu ('test' ou 'production'), une base non vide,
    // et deux racines « en cours » (revue + zeitschrift).
    assert.ok(r.emplacement === 'test' || r.emplacement === 'production',
      'Get-SzhEmplacements ne rend plus un emplacement connu : ' + JSON.stringify(r.emplacement));
    assert.ok(r.base && r.base.length > 0, 'Get-SzhEmplacements rend une base vide');
    assert.strictEqual(r.encoursCount, 2, 'Get-SzhEmplacements ne rend plus les deux racines en cours');
    // szh-shell.ps1 : les cinq entrées du menu Démarrer, jamais un tableau vide.
    assert.strictEqual(r.raccourcisCount, 5, 'Get-SzhRaccourcisMenu ne rend plus les cinq entrées');
    assert.ok(r.premierNom && r.premierNom.length > 0, 'la première entrée du menu est sans nom');
  });
