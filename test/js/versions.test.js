// Le schéma de version du dépôt : ce que le sélecteur « Version du logiciel… » a le droit de
// proposer, et quand le cockpit avertit qu'un numéro n'a pas été fait avec cette maquette.
//
//   node --test "test/js/versions.test.js"
//
// Les tags suivent majeure.medium.mineure depuis 1.0.0 ; les plus anciens suivent
// année.mois.compteur (v2026.09.42). Le sélecteur :
//   * écarte l'ancienne numérotation : Sort-SzhVersions trie par [version], 2026.09.42
//     passerait en tête, et le dialogue présélectionne la première ligne ;
//   * ne montre que la dernière mineure de chaque medium (1.2.13, pas 1.2.12).
// Une version d'avant 1.0.0 s'installe en ligne de commande : `update.ps1 -Version 2026.09.42`.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COMMUN_PS1 = path.join(RACINE, 'windows', 'szh-common.ps1');
const COMMUN = fs.readFileSync(COMMUN_PS1, 'utf8');
// Le sélecteur WinForms vit dans son propre fichier, chargé par le seul open-revue.ps1 -Versions.
const VERSIONS_PS1 = path.join(RACINE, 'windows', 'szh-versions.ps1');
const VERSIONS = fs.readFileSync(VERSIONS_PS1, 'utf8');
const LANCEUR = fs.readFileSync(path.join(RACINE, 'windows', 'open-revue.ps1'), 'utf8');
const TEXTES = fs.readFileSync(path.join(RACINE, 'windows', 'szh-textes.ps1'), 'utf8');

// Liste mélangée exprès : l'ordre de sortie vient de Sort-SzhVersions.
const ENTREE = [
  '1.2.12', '2026.09.42', '1.0.0', '1.2.13', 'v2026.07.0', '2.0.0',
  '1.2.0', '0.0.0-dev+f153f92', '1.4.0-rc1', '1.4.0', '1.3.1', '1.5.0-rc1',
  '2026.08.66', 'v1.0.1', 'brouillon', '1.2'
];

// Un seul passage PowerShell : le dot-source de szh-common.ps1 coûte cinq autres fichiers.
const bilan = (function () {
  if (!POWERSHELL) { return null; }
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-versions-'));
  const pilote = path.join(travail, 'eprouver.ps1');
  const sortie = path.join(travail, 'bilan.json');
  const script = [
    '. "' + COMMUN_PS1 + '"',
    '$entree = @(' + ENTREE.map((v) => "'" + v + "'").join(', ') + ')',
    '$r = [ordered]@{}',
    '$r.proposables = @(Select-SzhVersionsProposables $entree)',
    '$r.mediums = @(foreach ($v in $entree) { Get-SzhMediumVersion $v })',
    // Sans version proposable, la liste est vide et non $null, sur quoi le dialogue
    // planterait au lieu de dire « aucune version ».
    '$r.vide = @(Select-SzhVersionsProposables @(' + "'2026.09.42', '0.0.0-dev'" + '))',
    '$r.rien = @(Select-SzhVersionsProposables @())',
    '$r | ConvertTo-Json -Depth 4 | Set-Content -Path "' + sortie.replace(/\\/g, '\\\\') + '" -Encoding UTF8'
  ].join('\r\n') + '\r\n';
  fs.writeFileSync(pilote, script, 'utf8');
  const run = spawnSync(POWERSHELL, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', pilote],
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  const lu = fs.existsSync(sortie)
    ? JSON.parse(fs.readFileSync(sortie, 'utf8').replace(/^﻿/, '')) : null;
  fs.rmSync(travail, { recursive: true, force: true });
  return { status: run.status, stderr: run.stderr || '', r: lu };
})();

function resultat() {
  assert.ok(bilan, 'aucun résultat (powershell.exe indisponible ?)');
  assert.strictEqual(bilan.status, 0, 'le pilote a échoué — ' + bilan.stderr);
  assert.ok(bilan.r, 'pas de bilan JSON — ' + bilan.stderr);
  return bilan.r;
}

// ---- Ce que le sélecteur propose ------------------------------------------------------

test('le sélecteur ne garde que la dernière mineure de chaque medium, la plus récente d’abord',
  { skip: sansPowerShell }, () => {
    const r = resultat();
    assert.deepStrictEqual(r.proposables, [
      '2.0.0',      // le medium le plus récent en tête
      '1.5.0-rc1',  // seule version de son medium : une pré-version vaut mieux que rien
      '1.4.0',      // 1.4.0-rc1 se classe dessous, et disparaît
      '1.3.1',
      '1.2.13',     // ni 1.2.12 ni 1.2.0
      '1.0.1'       // le « v » de « v1.0.1 » ne fait pas un medium à part, et 1.0.0 tombe
    ]);
  });

test('rien d’avant 1.0.0 n’est proposé, ni l’ancienne ère, ni le poste de développement',
  { skip: sansPowerShell }, () => {
    const r = resultat();
    for (const ecartee of ['2026.09.42', '2026.08.66', 'v2026.07.0', '0.0.0-dev+f153f92']) {
      assert.ok(!r.proposables.includes(ecartee.replace(/^v/, '')),
        ecartee + ' est revenue dans le sélecteur');
    }
    // Une valeur qui n'est pas un numéro est écartée aussi : elle part en argument de
    // update.ps1, et Test-SzhVersionTag n'est qu'un second rempart.
    assert.ok(!r.proposables.includes('brouillon'), '« brouillon » proposé comme une version');
    assert.ok(!r.proposables.includes('1.2'), 'un numéro à deux composants proposé');
  });

test('une liste sans nouvelle ère rend un tableau vide, jamais $null',
  { skip: sansPowerShell }, () => {
    const r = resultat();
    assert.deepStrictEqual(r.vide, [], 'l’ancienne ère seule devrait ne rien proposer');
    assert.deepStrictEqual(r.rien, [], 'une liste vide devrait rester vide');
  });

test('le medium se lit sur la majeure et la mineure, et l’année n’en est pas une',
  { skip: sansPowerShell }, () => {
    const r = resultat();
    const lu = {};
    ENTREE.forEach((v, i) => { lu[v] = r.mediums[i]; });
    assert.strictEqual(lu['1.2.13'], '1.2');
    assert.strictEqual(lu['1.2.0'], '1.2');
    assert.strictEqual(lu['2.0.0'], '2.0');
    assert.strictEqual(lu['v1.0.1'], '1.0');
    assert.strictEqual(lu['1.4.0-rc1'], '1.4', 'une pré-version appartient au medium de son numéro');
    // Les deux numérotations ont la même forme : seule la borne sur la majeure les sépare.
    assert.strictEqual(lu['2026.09.42'], '');
    assert.strictEqual(lu['0.0.0-dev+f153f92'], '');
    assert.strictEqual(lu['brouillon'], '');
    assert.strictEqual(lu['1.2'], '');
  });

// ---- Le dialogue passe ses deux sources par le filtre -------------------------------
// Les versions publiées et celles du staging (toolkit-2026.09.42.zip, installable hors ligne).

test('Show-SzhVersions filtre les versions publiées ET celles du staging', () => {
  assert.match(VERSIONS, /\$locales = @\(Select-SzhVersionsProposables \(Get-SzhVersionsLocales\)\)/,
    'les versions du staging ne passent plus par le filtre');
  assert.match(VERSIONS, /\$publiees = @\(Select-SzhVersionsProposables \$publieesBrutes\)/,
    'les versions publiées ne passent plus par le filtre');
  // Le message « hors ligne » juge la réponse de GitHub, avant le filtre : un réseau qui ne
  // rend que l'ancienne numérotation n'est pas un poste hors ligne.
  assert.match(VERSIONS, /if \(\$publieesBrutes\.Count -gt 0\)/,
    'le message hors ligne se décide sur la liste filtrée, et ment donc au premier jour');
});

test('la ligne présélectionnée n’est pas la version installée quand une autre est proposée', () => {
  // Une version installée d'avant 1.0.0 s'insère en tête comme « installée » : présélectionner
  // la ligne 0 ferait du bouton « Installer » une réinstallation à l'identique.
  assert.match(VERSIONS, /\$premier = 0\r?\n\s*if \(\(\$disponibles\.Count -gt 1\) -and \(\$disponibles\[0\] -eq \$installee\)\) \{ \$premier = 1 \}/,
    'la présélection est revenue à la première ligne, quelle qu’elle soit');
  assert.match(VERSIONS, /\$liVersions\.SelectedIndex = \$premier/);
});

test('Show-SzhVersions n’est plus dans le socle : seul open-revue.ps1 charge son fichier', () => {
  // szh-common.ps1 est chargé par des scripts sans fenêtre : le sélecteur WinForms n’y a pas sa place.
  assert.ok(!/function Show-SzhVersions\b/.test(COMMUN), 'Show-SzhVersions est revenue dans szh-common.ps1');
  assert.ok(!/System\.Windows\.Forms/.test(COMMUN), 'le socle commun porte à nouveau du WinForms');
  assert.match(VERSIONS, /function Show-SzhVersions\(\$Parent, \[string\]\$FichierIcone\)/);
  const iCharge = LANCEUR.indexOf('. "$PSScriptRoot\\szh-versions.ps1"');
  const iAppel = LANCEUR.indexOf('Show-SzhVersions $null');
  assert.ok(iCharge !== -1 && iAppel !== -1 && iCharge < iAppel,
    'open-revue.ps1 doit dot-sourcer szh-versions.ps1 avant d’appeler Show-SzhVersions');
  // Aucun autre script de windows/ n’appelle le sélecteur sans charger son fichier.
  for (const nom of fs.readdirSync(path.join(RACINE, 'windows'))) {
    if (!nom.endsWith('.ps1') || nom === 'szh-versions.ps1') { continue; }
    const source = fs.readFileSync(path.join(RACINE, 'windows', nom), 'utf8');
    if (/\bShow-SzhVersions\s+[$]/.test(source)) {
      assert.ok(source.indexOf('szh-versions.ps1') !== -1, nom + ' appelle Show-SzhVersions sans charger szh-versions.ps1');
    }
  }
});

test('la note qui explique la liste courte existe dans les trois langues', () => {
  const occurrences = TEXTES.split("'lanceur.versions.note'").length - 1;
  assert.strictEqual(occurrences, 3,
    'lanceur.versions.note manque à une langue : la liste paraîtrait tronquée sans raison');
});

// ---- L'avertissement de maquette (cockpit) --------------------------------------------
// Seule la majeure le déclenche : c'est elle qui change quand la maquette change.

const { versionsDivergent } = require(path.join(
  RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'archivage.js'));

test('deux mineures ou deux mediums de la même majeure ne divergent pas', () => {
  assert.strictEqual(versionsDivergent('1.0.0', '1.0.1'), false);
  assert.strictEqual(versionsDivergent('1.2.13', '1.9.0'), false);
  // Un numéro commencé avant une mise à jour mineure du poste.
  assert.strictEqual(versionsDivergent('1.4.0', '1.4.12'), false);
});

test('une majeure différente diverge, et l’ancienne ère diverge de la nouvelle', () => {
  assert.strictEqual(versionsDivergent('1.9.3', '2.0.0'), true);
  assert.strictEqual(versionsDivergent('2.0.0', '1.9.3'), true);
  // La maquette a changé entre v2026.09.42 et 1.0.0.
  assert.strictEqual(versionsDivergent('2026.09.42', '1.0.0'), true);
});

test('une version inconnue, illisible ou de développement n’avertit jamais', () => {
  assert.strictEqual(versionsDivergent('', '1.0.0'), false, 'numéro sans estampille');
  assert.strictEqual(versionsDivergent('1.0.0', ''), false, 'poste sans VERSION lisible');
  assert.strictEqual(versionsDivergent(null, undefined), false);
  assert.strictEqual(versionsDivergent('brouillon', '1.0.0'), false);
  // Sur un poste de développement, la maquette est celle du dépôt ouvert : pas de version à
  // comparer.
  assert.strictEqual(versionsDivergent('1.0.0', '0.0.0-dev+f153f92'), false);
  assert.strictEqual(versionsDivergent('0.0.0-dev+f153f92', '1.0.0'), false);
});

test('le « v » d’un tag ne fait pas à lui seul une divergence', () => {
  assert.strictEqual(versionsDivergent('v1.0.0', '1.0.0'), false);
});
