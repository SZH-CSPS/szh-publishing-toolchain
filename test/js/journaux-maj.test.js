// Les journaux de mise à jour que l'onglet Log de l'Accueil liste (lib/journaux-maj.js), sur un
// dossier jetable.
//
//   node --test test/js/journaux-maj.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

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
