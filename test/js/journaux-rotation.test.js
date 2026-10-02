// Le dossier des journaux ne garde que les dix dernières mises à jour : Limit-SzhJournauxMaj
// (windows/szh-common.ps1), appelée par update.ps1 juste avant d'ouvrir le nouveau journal.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sansPowerShell, POWERSHELL } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');

function limiter(base, garder, envEnPlus) {
  const script = [
    ". '" + path.join(RACINE, 'windows', 'szh-common.ps1').replace(/'/g, "''") + "'",
    'Limit-SzhJournauxMaj -Garder ' + garder
  ].join('\n');
  return spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  { encoding: 'utf8', windowsHide: true, timeout: 90000,
    env: Object.assign({}, process.env, { SZH_BASE: base }, envEnPlus || {}) });
}

function arbre() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-rotation-'));
  const logs = path.join(base, 'logs');
  fs.mkdirSync(logs);
  for (let jour = 1; jour <= 15; jour++) {
    fs.writeFileSync(path.join(logs, 'update-202609' + String(jour).padStart(2, '0') + '-080000.log'), 'x');
  }
  fs.writeFileSync(path.join(logs, 'szh-2026-09.log'), 'mensuel');
  fs.writeFileSync(path.join(logs, 'bootstrap-20260801-080000.log'), 'installation');
  return { base, logs };
}

test('rotation : seules les neuf dernières mises à jour restent, le reste du dossier est intact',
  { skip: sansPowerShell }, () => {
    const { base, logs } = arbre();
    try {
      const r = limiter(base, 9);
      assert.strictEqual(r.status, 0, r.stderr);
      const restants = fs.readdirSync(logs).sort();
      const maj = restants.filter((n) => n.startsWith('update-'));
      assert.deepStrictEqual(maj, [7, 8, 9, 10, 11, 12, 13, 14, 15]
        .map((j) => 'update-202609' + String(j).padStart(2, '0') + '-080000.log'));
      assert.ok(restants.includes('szh-2026-09.log'), 'le journal mensuel a disparu');
      assert.ok(restants.includes('bootstrap-20260801-080000.log'), 'le journal d\'installation a disparu');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('rotation : un dossier absent ne lève pas', { skip: sansPowerShell }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-rotation-'));
  try {
    const r = limiter(base, 9);
    assert.strictEqual(r.status, 0, r.stderr);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// L'instance de dev lit les journaux du poste par SZH_JOURNAUX_MAJ : elle ne doit jamais les effacer.
test('rotation : SZH_JOURNAUX_MAJ ne change pas le dossier nettoyé', { skip: sansPowerShell }, () => {
  const a = arbre();
  const autre = arbre();
  try {
    const r = limiter(a.base, 9, { SZH_JOURNAUX_MAJ: autre.logs });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(fs.readdirSync(autre.logs).filter((n) => n.startsWith('update-')).length, 15,
      'les journaux désignés par SZH_JOURNAUX_MAJ ont été effacés');
    assert.strictEqual(fs.readdirSync(a.logs).filter((n) => n.startsWith('update-')).length, 9);
  } finally {
    fs.rmSync(a.base, { recursive: true, force: true });
    fs.rmSync(autre.base, { recursive: true, force: true });
  }
});

test('rotation : le journal mensuel garde le mois en cours et les deux précédents', { skip: sansPowerShell }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-rotation-'));
  const logs = path.join(base, 'logs');
  fs.mkdirSync(logs);
  const mois = ['2025-12', '2026-01', '2026-07', '2026-08', '2026-09', '2026-10'];
  for (const m of mois) { fs.writeFileSync(path.join(logs, 'szh-' + m + '.log'), 'x'); }
  fs.writeFileSync(path.join(logs, 'update-20260901-080000.log'), 'x');
  fs.writeFileSync(path.join(logs, 'szh-notes.log'), 'pas un mois');
  try {
    const script = [
      ". '" + path.join(RACINE, 'windows', 'szh-common.ps1').replace(/'/g, "''") + "'",
      'Limit-SzhJournauxMensuels -Garder 3'
    ].join('\n');
    const r = spawnSync(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', windowsHide: true, timeout: 90000, env: Object.assign({}, process.env, { SZH_BASE: base }) });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(fs.readdirSync(logs).sort(), ['szh-2026-08.log', 'szh-2026-09.log', 'szh-2026-10.log',
      'szh-notes.log', 'update-20260901-080000.log']);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('rotation : update.ps1 limite aussi les journaux mensuels à trois', () => {
  const s = fs.readFileSync(path.join(RACINE, 'windows', 'update.ps1'), 'utf8');
  assert.ok(s.indexOf('Limit-SzhJournauxMensuels -Garder 3') !== -1, 'update.ps1 n\'appelle pas Limit-SzhJournauxMensuels -Garder 3');
});

test('rotation : update.ps1 limite à neuf avant d\'ouvrir le dixième journal', () => {
  const s = fs.readFileSync(path.join(RACINE, 'windows', 'update.ps1'), 'utf8');
  const limite = s.indexOf('Limit-SzhJournauxMaj -Garder 9');
  const ouverture = s.indexOf('Start-Transcript -Path $journal');
  assert.ok(limite !== -1, 'update.ps1 n\'appelle pas Limit-SzhJournauxMaj -Garder 9');
  assert.ok(ouverture !== -1 && limite < ouverture, 'la rotation doit précéder Start-Transcript');
});
