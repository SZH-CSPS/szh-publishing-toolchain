// Les journaux de mise à jour que l'onglet Log de l'Accueil liste (lib/journaux-maj.js), et leur
// parité avec Get-SzhJournauxMaj et Get-SzhVerdictJournalMaj sur le même dossier jetable.
//
//   node --test test/js/journaux-maj.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { POWERSHELL, sansPowerShell } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const journaux = require(path.join(COCKPIT, 'lib', 'journaux-maj.js'));

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-journaux-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const BASE = path.join(TRAVAIL, 'ProgramData');
const LOGS = path.join(BASE, 'logs');
fs.mkdirSync(LOGS, { recursive: true });
process.env.SZH_BASE = BASE;

const FIN = ['**********************', 'Windows PowerShell transcript end', 'End time: 20260901080017',
  '**********************'];
const remplissage = (n) => Array.from({ length: n }, (_, i) => '[08:12:' + String(i % 60).padStart(2, '0') + '] étape ' + i);
function journal(nom, lignes, opts) {
  const o = opts || {};
  const sep = o.crlf ? '\r\n' : '\n';
  fs.writeFileSync(path.join(LOGS, nom), (o.bom ? '﻿' : '') + lignes.join(sep) + sep, 'utf8');
  if (o.mtime) { fs.utimesSync(path.join(LOGS, nom), o.mtime, o.mtime); }
}
// Douze journaux, dont deux de trop, et tout ce que le verdict doit départager.
journal('update-20260801-080000.log', ['✓ Tout est à jour.'].concat(FIN));
journal('update-20260802-080000.log', ['✓ Tout est à jour.'].concat(FIN));
journal('update-20260901-080000.log', remplissage(250).concat(['✓ Tout est à jour (version 2026.10.1).'], FIN),
  { bom: true, crlf: true });
journal('update-20260902-080000.log', ['Échec : réseau injoignable.'].concat(FIN));
journal('update-20260903-080000.log', ['✓ Tout est à jour.', '[08:12:17] Terminé.']);
// La coche plus haut que les quarante dernières lignes ne compte pas.
journal('update-20260904-080000.log', ['✓ ancien succès'].concat(remplissage(45), FIN));
journal('update-20260905-080000.log', ['✓ Tout est à jour.', '**********************', 'windows powershell TRANSCRIPT END',
  'END TIME: 20260905080017', '**********************']);
journal('update-20260906-080000.log', ['✓'].concat(FIN));
// Le pied de page traduit d'un Windows français (texte mesuré dans les ressources de PowerShell
// 5.1) et d'un Windows allemand (seule la forme compte : le texte allemand n'a pas été relevé).
const FIN_FR = ['**********************', 'Fin de la transcription Windows PowerShell',
  'Heure de fin : 20260901080017', '**********************'];
const FIN_DE = ['**********************', 'Ende der Windows PowerShell-Transkription',
  'Endzeit: 20260901080017', '**********************'];
journal('update-20260907-080000.log', ['✓'].concat(FIN_FR));
journal('update-20260908-080000.log', ['✓ Alles aktuell.'].concat(FIN_DE));
journal('update-20260909-080000.log', ['Échec : réseau injoignable.'].concat(FIN_FR), { crlf: true });
// Un nom qui ne se lit pas : la date du fichier en tient lieu.
journal('update-manuel.log', ['rien'], { mtime: new Date(2026, 8, 3, 12, 0, 0) });
journal('autre.log', ['✓'].concat(FIN));
fs.mkdirSync(path.join(LOGS, 'update-dossier.log'));

test('journaux : les dix plus récents, avec leur verdict', () => {
  const liste = journaux.journauxMaj();
  assert.deepStrictEqual(liste.map((j) => j.nom), [
    'update-20260909-080000.log', 'update-20260908-080000.log', 'update-20260907-080000.log',
    'update-20260906-080000.log', 'update-20260905-080000.log', 'update-20260904-080000.log',
    'update-manuel.log', 'update-20260903-080000.log', 'update-20260902-080000.log', 'update-20260901-080000.log'
  ]);
  const verdict = (nom) => liste.filter((j) => j.nom === nom)[0].verdict;
  assert.strictEqual(verdict('update-20260901-080000.log'), 'ok');
  assert.strictEqual(verdict('update-20260902-080000.log'), 'echec');
  assert.strictEqual(verdict('update-20260903-080000.log'), 'inconnu', 'une mise à jour sans fin de transcription');
  assert.strictEqual(verdict('update-20260904-080000.log'), 'echec', 'la coche hors des quarante dernières lignes');
  assert.strictEqual(verdict('update-20260905-080000.log'), 'ok', 'la fin se reconnaît sans égard à la casse');
  assert.strictEqual(verdict('update-manuel.log'), 'inconnu');
  assert.strictEqual(verdict('update-20260907-080000.log'), 'ok', 'pied de page en français');
  assert.strictEqual(verdict('update-20260908-080000.log'), 'ok', 'pied de page en allemand');
  assert.strictEqual(verdict('update-20260909-080000.log'), 'echec', 'pied de page en français, sans coche');
  assert.strictEqual(liste[0].date.getHours(), 8, 'la date du nom est une heure locale');
});

test('journaux : un dossier absent rend une liste vide', () => {
  const avant = process.env.SZH_BASE;
  process.env.SZH_BASE = path.join(TRAVAIL, 'nulle-part');
  try { assert.deepStrictEqual(journaux.journauxMaj(), []); } finally { process.env.SZH_BASE = avant; }
});

// L'instance de dev a sa propre base, où aucune mise à jour n'écrit : pronto-dev.ps1 lui
// désigne les journaux du poste par SZH_JOURNAUX_MAJ.
test('journaux : SZH_JOURNAUX_MAJ désigne le dossier lu, quelle que soit la base', () => {
  const avant = process.env.SZH_BASE;
  process.env.SZH_BASE = path.join(TRAVAIL, 'nulle-part');
  process.env.SZH_JOURNAUX_MAJ = LOGS;
  try {
    assert.strictEqual(journaux.dossierJournaux(), LOGS);
    assert.ok(journaux.journauxMaj().length > 0, 'les journaux du dossier désigné');
  } finally { process.env.SZH_BASE = avant; delete process.env.SZH_JOURNAUX_MAJ; }
});

test('journaux : Get-SzhJournauxMaj suit aussi SZH_JOURNAUX_MAJ', { skip: sansPowerShell }, () => {
  const script = [
    ". '" + path.join(RACINE, 'windows', 'szh-common.ps1').replace(/'/g, "''") + "'",
    '[Console]::Out.Write(@(Get-SzhJournauxMaj).Count)'
  ].join('\n');
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { encoding: 'utf8', windowsHide: true, timeout: 90000,
    env: Object.assign({}, process.env, { SZH_BASE: path.join(TRAVAIL, 'nulle-part'), SZH_JOURNAUX_MAJ: LOGS }) });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(Number(r.stdout.trim()) > 0, 'aucun journal lu dans le dossier désigné : ' + r.stdout);
});

test('journaux : la fin d’un journal, ses deux cents dernières lignes et leur nombre', () => {
  const long = journaux.finJournal(path.join(LOGS, 'update-20260901-080000.log'));
  assert.strictEqual(long.lignes, 200);
  assert.strictEqual(long.texte.split('\n').length, 200);
  assert.ok(long.texte.endsWith('**********************'));
  assert.ok(!long.texte.includes('\r') && !long.texte.startsWith('﻿'));
  const court = journaux.finJournal(path.join(LOGS, 'update-20260902-080000.log'));
  assert.strictEqual(court.lignes, 0, 'un journal court se montre en entier');
  assert.strictEqual(court.texte, ['Échec : réseau injoignable.'].concat(FIN).join('\n'));
});

test('journaux : même liste, même ordre et mêmes verdicts que Get-SzhJournauxMaj', { skip: sansPowerShell }, () => {
  const script = [
    '[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false',
    ". '" + path.join(RACINE, 'windows', 'szh-common.ps1').replace(/'/g, "''") + "'",
    '$l = @(Get-SzhJournauxMaj | ForEach-Object { [pscustomobject]@{ nom = $_.nom; verdict = $_.verdict;',
    "  quand = $_.date.ToString('yyyyMMddHHmmss'); taille = $_.taille } })",
    'ConvertTo-Json -InputObject $l -Compress'
  ].join('\n');
  const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { encoding: 'utf8', windowsHide: true, timeout: 90000, env: Object.assign({}, process.env, { SZH_BASE: BASE }) });
  assert.strictEqual(r.status, 0, r.stderr);
  const ps = JSON.parse(r.stdout.trim());
  const verdictPs = (nom) => ps.filter((j) => j.nom === nom)[0].verdict;
  assert.deepStrictEqual(['update-20260907-080000.log', 'update-20260908-080000.log', 'update-20260909-080000.log']
    .map(verdictPs), ['ok', 'ok', 'echec'], 'pieds de page français et allemand');
  const p2 = (n) => String(n).padStart(2, '0');
  const quand = (d) => d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const js = journaux.journauxMaj().map((j) => ({ nom: j.nom, verdict: j.verdict, quand: quand(j.date), taille: j.taille }));
  assert.deepStrictEqual(js, ps);
});
