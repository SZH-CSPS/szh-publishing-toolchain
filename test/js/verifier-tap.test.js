'use strict';
// La porte de la CI est elle-même un garde-fou : si elle laissait passer un saut inconnu
// ou un test annulé, tout ce chantier de tests ne tiendrait qu'à un vert par défaut.
const test = require('node:test');
const assert = require('node:assert');
const { verifier } = require('./verifier-tap');

function tap(lignes, bilan) {
  const corps = lignes.map((l, i) => 'ok ' + (i + 1) + ' - ' + l).join('\n');
  const b = Object.assign({ tests: lignes.length, pass: lignes.length, fail: 0, cancelled: 0, skipped: 0, todo: 0 }, bilan);
  return corps + '\n1..' + lignes.length + '\n' + Object.keys(b).map((k) => '# ' + k + ' ' + b[k]).join('\n') + '\n';
}
const SKIPS_UBUNTU = [
  'lanceur : la tâche planifiée # SKIP powershell.exe indisponible',
  'rapport : chemin # SKIP chemins Windows : joué par le job contrats-windows',
  'ancrages : pandoc # SKIP wsl.exe injoignable : spawnSync wsl.exe ENOENT',
  'lire-config : lua # SKIP szh-lire-config.lua non vérifié : pandoc introuvable sur ce poste',
  'biblio : corpus # SKIP corpus hors dépôt absent : /tmp/x'
];
const PASSENT = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'];

test('ubuntu : PowerShell, WSL, pandoc, chemins Windows et corpus absents sont admis', () => {
  const r = verifier(tap(PASSENT.concat(SKIPS_UBUNTU), { skipped: 5 }), 'ubuntu');
  assert.deepStrictEqual(r.erreurs, []);
  assert.strictEqual(r.histogramme.powershell, 1);
  assert.strictEqual(r.histogramme.wsl, 1);
});

test('windows : un saut PowerShell est refusé (SZH_PS_OBLIGATOIRE le rend impossible)', () => {
  const r = verifier(tap(PASSENT.concat(SKIPS_UBUNTU), { skipped: 5 }), 'windows');
  assert.ok(r.erreurs.some((e) => /powershell\.exe indisponible/.test(e)), r.erreurs.join('\n'));
  assert.ok(r.erreurs.some((e) => /chemins Windows/.test(e)), 'les chemins Windows doivent être joués sur windows-latest');
});

test('un motif inconnu ou un saut sans motif fait échouer, quel que soit le runner', () => {
  for (const runner of ['ubuntu', 'windows', 'poste']) {
    const inconnu = verifier(tap(PASSENT.concat(['x # SKIP la fixture manque']), { skipped: 1 }), runner);
    assert.ok(inconnu.erreurs.some((e) => /saut non admis/.test(e)), runner + ' : motif inconnu accepté');
    const muet = verifier(tap(PASSENT.concat(['x # SKIP']), { skipped: 1 }), runner);
    assert.ok(muet.erreurs.some((e) => /sans motif/.test(e)), runner + ' : saut muet accepté');
  }
});

test('un test annulé par --test-timeout compte comme un échec, même avec fail = 0', () => {
  const r = verifier(tap(PASSENT, { cancelled: 1 }), 'ubuntu');
  assert.ok(r.erreurs.some((e) => /annulé/.test(e)), r.erreurs.join('\n'));
});

test('un bilan tronqué (suite interrompue) est refusé', () => {
  const r = verifier('ok 1 - a\n', 'ubuntu');
  assert.ok(r.erreurs.some((e) => /bilan TAP incomplet/.test(e)));
});

test('la moitié de la suite sautée est refusée, même pour des motifs admis', () => {
  const sauts = Array.from({ length: 12 }, () => 'x # SKIP powershell.exe indisponible');
  const r = verifier(tap(PASSENT.concat(sauts), { skipped: 12 }), 'ubuntu');
  assert.ok(r.erreurs.some((e) => /la moitié de la suite manque/.test(e)));
});

test('poste complet : seuls le pliage des accents et le corpus hors dépôt restent admis', () => {
  const ok = verifier(tap(PASSENT.concat(['m # SKIP pliage des accents cassé : …', 'n # SKIP corpus hors dépôt absent : x']), { skipped: 2 }), 'poste');
  assert.deepStrictEqual(ok.erreurs, []);
  const ko = verifier(tap(PASSENT.concat(['m # SKIP powershell.exe indisponible']), { skipped: 1 }), 'poste');
  assert.strictEqual(ko.erreurs.length, 1);
});
