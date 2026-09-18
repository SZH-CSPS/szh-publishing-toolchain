// Le schéma de version du dépôt : ce que le sélecteur « Version du logiciel… » a le droit de
// proposer, et quand le cockpit avertit qu'un numéro n'a pas été fait avec cette maquette.
//
//   node --test "test/js/versions.test.js"
//
// Le 18.09.2026, le dépôt quitte la numérotation année.mois.compteur (v2026.09.42, 41 tags
// pour le seul mois de septembre) pour majeure.medium.mineure, à partir de 1.0.0. Deux
// conséquences, gardées ici parce qu'aucune n'est visible en lisant le code du dialogue :
//
//   * le numéro BAISSE (2026.09.42 -> 1.0.0), et Sort-SzhVersions trie par [version] : sans
//     filtre, l'ancienne ère resterait en tête de liste pour toujours, et le dialogue --
//     qui présélectionne la première ligne -- proposerait de réinstaller 2026.09.42 ;
//   * une ligne par mineure était illisible. Le sélecteur ne montre donc que la dernière
//     mineure de chaque medium (1.2.13, pas 1.2.12), une version intermédiaire ne se
//     distinguant de la suivante que par des correctifs.
//
// Revenir à une version d'avant 1.0.0 reste possible, mais seulement en ligne de commande
// (`update.ps1 -Version 2026.09.42`) : c'est délibéré, pas un oubli.
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
const TEXTES = fs.readFileSync(path.join(RACINE, 'windows', 'szh-textes.ps1'), 'utf8');

// La liste d'épreuve, mélangée exprès : l'ordre d'entrée ne doit jamais transparaître dans
// l'ordre de sortie, c'est Sort-SzhVersions qui décide.
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
    // Aucune version de la nouvelle ère : la liste doit être vide, jamais $null -- un $null
    // ferait « Count » sur rien et le dialogue planterait au lieu de dire « aucune version ».
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
    // Et un numéro qui n'est pas un numéro ne s'y glisse pas non plus : la valeur part en
    // argument de update.ps1, Test-SzhVersionTag n'étant qu'un second rempart.
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
    // 2026 est une année, pas une majeure : c'est cette borne, et elle seule, qui sépare les
    // deux ères — les deux numérotations ayant exactement la même forme.
    assert.strictEqual(lu['2026.09.42'], '');
    assert.strictEqual(lu['0.0.0-dev+f153f92'], '');
    assert.strictEqual(lu['brouillon'], '');
    assert.strictEqual(lu['1.2'], '');
  });

// ---- Le dialogue passe bien ses DEUX sources par le filtre ----------------------------
// Sans cette garde, une version de l'ancienne ère restée en staging (toolkit-2026.09.42.zip)
// reviendrait par la porte « installable hors ligne », que rien n'aurait filtrée.

test('Show-SzhVersions filtre les versions publiées ET celles du staging', () => {
  assert.match(COMMUN, /\$locales = @\(Select-SzhVersionsProposables \(Get-SzhVersionsLocales\)\)/,
    'les versions du staging ne passent plus par le filtre');
  assert.match(COMMUN, /\$publiees = @\(Select-SzhVersionsProposables \$publieesBrutes\)/,
    'les versions publiées ne passent plus par le filtre');
  // Le message « hors ligne » juge la réponse de GitHub, pas le résultat du filtre : un
  // réseau qui répond mais ne rend que de l'ancienne ère n'est pas un poste hors ligne.
  assert.match(COMMUN, /if \(\$publieesBrutes\.Count -gt 0\)/,
    'le message hors ligne se décide sur la liste filtrée, et ment donc au premier jour');
});

test('la ligne présélectionnée n’est pas la version installée quand une autre est proposée', () => {
  // Régression possible du filtre lui-même : une version d'avant 1.0.0 n'étant plus
  // proposable, elle s'insère en tête de liste comme « installée » — et la présélection à 0
  // faisait alors du bouton « Installer » une réinstallation à l'identique.
  assert.match(COMMUN, /\$premier = 0\r?\n\s*if \(\(\$disponibles\.Count -gt 1\) -and \(\$disponibles\[0\] -eq \$installee\)\) \{ \$premier = 1 \}/,
    'la présélection est revenue à la première ligne, quelle qu’elle soit');
  assert.match(COMMUN, /\$liVersions\.SelectedIndex = \$premier/);
});

test('la note qui explique la liste courte existe dans les trois langues', () => {
  const occurrences = TEXTES.split("'lanceur.versions.note'").length - 1;
  assert.strictEqual(occurrences, 3,
    'lanceur.versions.note manque à une langue : la liste paraîtrait tronquée sans raison');
});

// ---- L'avertissement de maquette (cockpit) --------------------------------------------
// Il était posé sur l'égalité des chaînes : à quarante et une releases par mois, il criait à
// chaque fois, donc il ne disait plus rien. Depuis 1.0.0, seule la MAJEURE le déclenche —
// c'est elle qui change quand la maquette change.

const { versionsDivergent } = require(path.join(
  RACINE, 'vscodium-extension', 'szh-cockpit', 'lib', 'archivage.js'));

test('deux mineures ou deux mediums de la même majeure ne divergent pas', () => {
  assert.strictEqual(versionsDivergent('1.0.0', '1.0.1'), false);
  assert.strictEqual(versionsDivergent('1.2.13', '1.9.0'), false);
  // Le cas qui rendait l'avertissement inaudible : un numéro commencé lundi, un poste mis à
  // jour mercredi, et une alerte sur un écart qui ne change rien de ce qu'on voit.
  assert.strictEqual(versionsDivergent('1.4.0', '1.4.12'), false);
});

test('une majeure différente diverge, et l’ancienne ère diverge de la nouvelle', () => {
  assert.strictEqual(versionsDivergent('1.9.3', '2.0.0'), true);
  assert.strictEqual(versionsDivergent('2.0.0', '1.9.3'), true);
  // Exact : la maquette a bel et bien bougé entre v2026.09.42 et 1.0.0. L'avertissement
  // s'éteindra de lui-même quand les numéros auront été ré-estampillés.
  assert.strictEqual(versionsDivergent('2026.09.42', '1.0.0'), true);
});

test('une version inconnue, illisible ou de développement n’avertit jamais', () => {
  assert.strictEqual(versionsDivergent('', '1.0.0'), false, 'numéro sans estampille');
  assert.strictEqual(versionsDivergent('1.0.0', ''), false, 'poste sans VERSION lisible');
  assert.strictEqual(versionsDivergent(null, undefined), false);
  assert.strictEqual(versionsDivergent('brouillon', '1.0.0'), false);
  // Sur un poste de développement la maquette est celle du dépôt ouvert : l'avertissement
  // n'aurait aucune version à désigner, et se déclencherait sur chaque numéro ouvert.
  assert.strictEqual(versionsDivergent('1.0.0', '0.0.0-dev+f153f92'), false);
  assert.strictEqual(versionsDivergent('0.0.0-dev+f153f92', '1.0.0'), false);
});

test('le « v » d’un tag ne fait pas à lui seul une divergence', () => {
  assert.strictEqual(versionsDivergent('v1.0.0', '1.0.0'), false);
});
