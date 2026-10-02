// Le lancement d'un outil du cockpit par VSCodium-en-Node (Invoke-SzhNodeCockpit et
// Get-SzhOutilCockpit, windows/szh-shell.ps1) : sans shell ni fenêtre. Analyse statique du
// texte pour la forme, et un pilote pour le résolveur.
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

// ---- Get-SzhOutilCockpit : un outil introuvable lève un message précis ------
// Dynamique : une extension du cockpit introuvable (SZH_COCKPIT_DOSSIER vers un dossier vide).
test('Get-SzhOutilCockpit lève quand l\'outil est introuvable et rend son chemin quand il existe',
  { skip: sansPowerShell }, () => {
    const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-outil-cockpit-'));
    fs.mkdirSync(path.join(travail, 'outils'));
    fs.writeFileSync(path.join(travail, 'outils', 'present.js'), '');
    const pilote = path.join(travail, 'p.ps1');
    const sortie = path.join(travail, 's.json');
    fs.writeFileSync(pilote, [
      '$ErrorActionPreference = "Stop"',
      '. "' + path.join(RACINE, 'windows', 'szh-common.ps1') + '"',
      '$r = [ordered]@{}',
      '$r.chemin = [string](Get-SzhOutilCockpit -Outil "present.js")',
      '$r.message = ""',
      'try { [void](Get-SzhOutilCockpit -Outil "absent.js") } catch { $r.message = $_.Exception.Message }',
      'Set-SzhJson "' + sortie.replace(/\\/g, '\\\\') + '" $r'
    ].join('\r\n') + '\r\n', 'utf8');
    const env = Object.assign({}, process.env, { SZH_BASE: path.join(travail, 'base'), SZH_COCKPIT_DOSSIER: travail });
    const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
      { encoding: 'utf8', windowsHide: true, timeout: 60000, env });
    const r = fs.existsSync(sortie) ? JSON.parse(fs.readFileSync(sortie, 'utf8')) : null;
    fs.rmSync(travail, { recursive: true, force: true });
    assert.ok(r, 'le pilote n\'a rien produit - ' + run.stderr);
    assert.ok(r.chemin.endsWith('present.js'), 'le chemin de l\'outil présent est attendu : ' + r.chemin);
    assert.match(r.message, /absent\.js introuvable/, 'un outil absent doit lever un message précis');
  });

test('Invoke-SzhNodeCockpit : VSCodium-en-Node (ELECTRON_RUN_AS_NODE=1), UseShellExecute=$false, CreateNoWindow=$true', () => {
  assert.match(NODE_COCKPIT, /EnvironmentVariables\['ELECTRON_RUN_AS_NODE'\]\s*=\s*'1'/,
    'Invoke-SzhNodeCockpit doit lancer VSCodium en mode Node (ELECTRON_RUN_AS_NODE=1)');
  assert.match(NODE_COCKPIT, /UseShellExecute\s*=\s*\$false/);
  assert.match(NODE_COCKPIT, /CreateNoWindow\s*=\s*\$true/);
  assert.match(NODE_COCKPIT, /Get-SzhOutilCockpit -Outil \$Outil\r?\n/,
    'Invoke-SzhNodeCockpit doit résoudre son script par son nom via Get-SzhOutilCockpit');
  assert.ok(OUTIL_COCKPIT.includes('function Get-SzhOutilCockpit'));
});
