// Le lancement d'un outil du cockpit par VSCodium-en-Node (Invoke-SzhNodeCockpit et
// Get-SzhOutilCockpit, windows/szh-shell.ps1) : sans shell ni fenêtre, et sans lever quand
// l'extension n'est pas encore posée. Analyse statique du texte pour la forme, et un pilote
// pour le résolveur.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
// Extrait le corps d'une fonction PowerShell par comptage d'accolades -- aucune des
// fonctions ci-dessous n'a de `{`/`}` dans un commentaire ou une chaîne, un simple compteur
// suffit donc (contrairement à un JS/CSS quelconque, il n'y a ici ni accolade dans une regex
// ni dans un template).
function extraireFonction(texte, nom) {
  const debut = texte.indexOf('function ' + nom + ' {');
  assert.ok(debut !== -1, 'fonction introuvable : ' + nom);
  const iAccolade = texte.indexOf('{', debut);
  let profondeur = 0;
  for (let i = iAccolade; i < texte.length; i++) {
    if (texte[i] === '{') { profondeur++; }
    else if (texte[i] === '}') {
      profondeur--;
      if (profondeur === 0) { return texte.slice(debut, i + 1); }
    }
  }
  assert.fail('accolade fermante introuvable pour ' + nom);
}

// Le lancement de VSCodium-en-Node et la résolution du script vivent dans szh-shell.ps1.
const SOURCE_SHELL = fs.readFileSync(path.join(RACINE, 'windows', 'szh-shell.ps1'), 'utf8');
const NODE_COCKPIT = extraireFonction(SOURCE_SHELL, 'Invoke-SzhNodeCockpit');
const OUTIL_COCKPIT = extraireFonction(SOURCE_SHELL, 'Get-SzhOutilCockpit');

// ---- Avec -SansLever, le résolveur ne lève jamais (sans lui, il lève) ------
// Dynamique : une extension du cockpit introuvable (SZH_COCKPIT_DOSSIER vers un dossier
// vide) donne '' avec -SansLever, une exception sans lui.
test('Get-SzhOutilCockpit -SansLever ne lève jamais et rend une chaîne vide quand l\'outil est introuvable',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-outil-cockpit-'));
    const pilote = path.join(travail, 'p.ps1');
    const sortie = path.join(travail, 's.json');
    fs.writeFileSync(pilote, [
      '$ErrorActionPreference = "Stop"',
      '. "' + path.join(RACINE, 'windows', 'szh-common.ps1') + '"',
      '$r = [ordered]@{}',
      '$r.sansLever = [string](Get-SzhOutilCockpit -Outil "auteurs-cli.js" -SansLever)',
      '$r.leve = $false',
      'try { [void](Get-SzhOutilCockpit -Outil "auteurs-cli.js") } catch { $r.leve = $true }',
      '$r.message = $false',
      'try { [void](Get-SzhOutilCockpit -Outil "auteurs-cli.js" -MessageAbsent "absent-voulu") } catch { $r.message = ($_.Exception.Message -eq "absent-voulu") }',
      'Set-SzhJson "' + sortie.replace(/\\/g, '\\\\') + '" $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const env = Object.assign({}, process.env, { SZH_BASE: path.join(travail, 'base'), SZH_COCKPIT_DOSSIER: travail });
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
    const r = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
    assert.strictEqual(r.sansLever, '', 'Get-SzhOutilCockpit -SansLever doit rendre une chaîne vide');
    assert.strictEqual(r.leve, true, 'sans -SansLever, un outil introuvable doit lever');
    assert.strictEqual(r.message, true, '-MessageAbsent doit être le message levé');
  });

// ---- Invoke-SzhNodeCockpit : jamais bloquant en -SansAttendre, jamais visible ----------
test('Invoke-SzhNodeCockpit -SansAttendre : ni WaitForExit, ni ReadLine/ReadToEnd, ni -Wait', () => {
  const iBranche = NODE_COCKPIT.indexOf('if ($SansAttendre) {');
  const iRedirection = NODE_COCKPIT.indexOf('RedirectStandardOutput');
  assert.ok(iBranche !== -1 && iRedirection > iBranche, 'la branche -SansAttendre doit précéder toute redirection de flux');
  const brancheSansAttendre = NODE_COCKPIT.slice(iBranche, iRedirection);
  assert.ok(!/WaitForExit|Read(Line|ToEnd)|-Wait\b/.test(brancheSansAttendre),
    'la branche -SansAttendre de Invoke-SzhNodeCockpit attend ou lit le processus');
});

test('Invoke-SzhNodeCockpit : VSCodium-en-Node (ELECTRON_RUN_AS_NODE=1), UseShellExecute=$false, CreateNoWindow=$true', () => {
  // Posés une fois pour tous les appelants, avant la branche -SansAttendre.
  const iBranche = NODE_COCKPIT.indexOf('if ($SansAttendre) {');
  const avantBranche = NODE_COCKPIT.slice(0, iBranche);
  assert.match(avantBranche, /EnvironmentVariables\['ELECTRON_RUN_AS_NODE'\]\s*=\s*'1'/,
    'Invoke-SzhNodeCockpit doit lancer VSCodium en mode Node (ELECTRON_RUN_AS_NODE=1)');
  assert.match(avantBranche, /UseShellExecute\s*=\s*\$false/);
  assert.match(avantBranche, /CreateNoWindow\s*=\s*\$true/);
  assert.match(NODE_COCKPIT, /Get-SzhOutilCockpit -Outil \$Outil -SansLever:\$SansLever/,
    'Invoke-SzhNodeCockpit doit résoudre son script par son nom via Get-SzhOutilCockpit');
  assert.match(OUTIL_COCKPIT, /if \(\$SansLever\) \{ return '' \}/, 'le résolveur doit rendre une chaîne vide avec -SansLever');
});
