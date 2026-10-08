// Les compteurs d'usage n'ont qu'un écrivain, lib/compteurs.js (vérifié par
// compteurs.test.js) : aucun script de windows/ ne tient de version PowerShell.
//
//   node --test test/js/compteurs-ps.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

test('le jumeau PowerShell a disparu : plus de fichier, plus de dot-source, plus d’appel', () => {
  assert.ok(!fs.existsSync(path.join(RACINE, 'windows', 'szh-compteurs.ps1')));
  for (const f of fs.readdirSync(path.join(RACINE, 'windows')).filter((n) => n.endsWith('.ps1'))) {
    const texte = fs.readFileSync(path.join(RACINE, 'windows', f), 'utf8');
    assert.ok(!/szh-compteurs\.ps1|Write-SzhCompteurs|Clear-SzhCompteursEnAttente|Get-SzhCompteursPassage/.test(texte),
      f + ' référence encore l’écrivain PowerShell des compteurs');
  }
  assert.ok(!fs.existsSync(path.join(COCKPIT, 'outils', 'compteurs-cli.js')));
});
