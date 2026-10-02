// Créer un numéro ou un livre depuis le lanceur de l'éditeur (lib/lanceur-nouveau.js) : les
// refus et la création sont ceux du socle PowerShell, rejoués ici sur une arborescence jetable.
//
//   node --test test/js/lanceur-nouveau.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { POWERSHELL, sansPowerShell, sansVSCodium, sauter } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const nouveau = require(path.join(COCKPIT, 'lib', 'lanceur-nouveau.js'));

const TRAVAIL = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nouveau-'));
process.on('exit', () => { try { fs.rmSync(TRAVAIL, { recursive: true, force: true }); } catch (e) { /* débris */ } });
const PROGRAMDATA = path.join(TRAVAIL, 'ProgramData');
const BASE = path.join(TRAVAIL, 'Base');
fs.mkdirSync(path.join(PROGRAMDATA, 'toolkit'), { recursive: true });
fs.writeFileSync(path.join(PROGRAMDATA, 'config.json'), JSON.stringify({ emplacementRevues: 'test' }), 'utf8');
fs.writeFileSync(path.join(PROGRAMDATA, 'toolkit', 'VERSION'), '3.1.0\n', 'utf8');
for (const g of ['revue-template', 'livre-template']) {
  fs.cpSync(path.join(RACINE, g), path.join(PROGRAMDATA, 'toolkit', g), { recursive: true });
}
const ENV = Object.assign({}, process.env, {
  SZH_BASE: PROGRAMDATA, SZH_RACINE_TEST: BASE, SZH_RACINE_PROD: path.join(TRAVAIL, 'Prod'),
  SZH_ANCRAGE: ''
});
function numero(relatif, fichier, lignes) {
  const d = path.join(BASE, ...relatif);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, fichier), lignes.join('\n') + '\n', 'utf8');
  return d;
}
numero(['Revue', '2026-01'], 'ausgabe.yaml', ['revue: revue', 'volume: 16', 'numero: "01"']);
// Rangé sous un autre nom, mais il porte déjà le volume 16 et le numéro 2 : c'est lui qui bloque.
numero(['_Archive', 'Revue', 'ancien-deux'], 'ausgabe.yaml', ['revue: revue', 'volume: "16"', 'numero: 2']);
numero(['Books', '2025-B12-Leichte'], 'buch.yaml', ['titre: "Leichte Sprache"']);

const creer = (demande) => nouveau.executer(nouveau.scriptCreation(demande, RACINE), { env: ENV, powershell: POWERSHELL });
const revue = (autres) => Object.assign({ produit: 'revue', annee: 2026, numero: 3, volume: 16, volumeManuel: false }, autres);
const livre = (autres) => Object.assign({ produit: 'livre', annee: 2026, reference: 13, titre: 'École & handicap : l’art d’être',
  genre: 'collectif', maquette: 'falc', format: 'a4' }, autres);

test('nouveau : une demande mal formée ne lance rien', () => {
  assert.strictEqual(nouveau.scriptCreation(revue({ numero: 0 }), RACINE), null);
  assert.strictEqual(nouveau.scriptCreation(revue({ numero: 100 }), RACINE), null);
  assert.strictEqual(nouveau.scriptCreation(revue({ produit: 'autre' }), RACINE), null);
  assert.strictEqual(nouveau.scriptCreation(livre({ titre: '  ' }), RACINE), null);
  assert.strictEqual(nouveau.scriptCreation(livre({ maquette: "falc'; Remove-Item x; '" }), RACINE), null);
  assert.ok(nouveau.scriptCreation(livre({ titre: "L'O'Neil" }), RACINE).includes("'L''O''Neil'"));
});

test('nouveau : un dossier du même nom est refusé, sans rien écrire', { skip: sansPowerShell }, async () => {
  const r = await creer(revue({ numero: 1 }));
  assert.deepStrictEqual(r, { ok: false, refus: 'existe', nom: '2026-01' });
});

test('nouveau : le volume et le numéro déjà pris, même aux archives, sont refusés', { skip: sansPowerShell }, async () => {
  const r = await creer(revue({ numero: 2 }));
  assert.strictEqual(r.refus, 'doublon', JSON.stringify(r));
  assert.strictEqual(r.nom, 'ancien-deux');
  assert.strictEqual(r.archive, true);
  assert.strictEqual(r.volume, 16, 'le volume se calcule d’après l’année quand il n’est pas réglé');
  assert.ok(!fs.existsSync(path.join(BASE, 'Revue', '2026-02')));
});

test('nouveau : une référence B déjà prise est refusée', { skip: sansPowerShell }, async () => {
  const r = await creer(livre({ reference: 12 }));
  assert.strictEqual(r.refus, 'reference', JSON.stringify(r));
  assert.strictEqual(r.titre, 'Leichte Sprache');
});

test('nouveau : un numéro et un livre se créent depuis le gabarit, nommés par le socle', async (t) => {
  if (sansPowerShell) { return sauter.powershell(t); }
  if (sansVSCodium) { return sauter.vscodium(t); }
  const r = await creer(revue({ numero: 4 }));
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  assert.strictEqual(r.chemin, path.join(BASE, 'Revue', '2026-04'));
  const ausgabe = fs.readFileSync(path.join(r.chemin, 'ausgabe.yaml'), 'utf8');
  assert.match(ausgabe, /^volume: "?16"?$/m);
  assert.match(ausgabe, /^numero: "04"$/m);
  const l = await creer(livre());
  assert.strictEqual(l.ok, true, JSON.stringify(l));
  assert.strictEqual(path.dirname(l.chemin), path.join(BASE, 'Books'));
  assert.match(path.basename(l.chemin), /^2026-B13-Ecole_handicap_l_art_d_etre$/);
  assert.match(fs.readFileSync(path.join(l.chemin, 'buch.yaml'), 'utf8'), /^titre: "École & handicap : l’art d’être"$/m);
});

test('nouveau : l’année zéro du volume vient du socle', { skip: sansPowerShell }, async () => {
  const r = await nouveau.executer(nouveau.scriptAnnees(RACINE), { env: ENV, powershell: POWERSHELL });
  assert.deepStrictEqual(r, { revue: 2010, zeitschrift: 1994 });
});

test('nouveau : l’hôte dit chaque refus du socle en clair', () => {
  const { chargerAvecVscodeFactice } = require('./dom-minimal');
  const { texteRefus } = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'lanceur-hote.js'));
  assert.match(texteRefus({ refus: 'existe', nom: '2026-03' }), /2026-03/);
  const doublon = texteRefus({ refus: 'doublon', volume: 16, numero: 3, nom: 'ancien-trois', archive: true });
  assert.match(doublon, /16/);
  assert.match(doublon, /ancien-trois/);
  assert.notStrictEqual(doublon, texteRefus({ refus: 'doublon', volume: 16, numero: 3, nom: 'ancien-trois' }),
    'un numéro archivé se dit archivé');
  assert.match(texteRefus({ refus: 'reference', reference: 12, titre: 'Leichte Sprache' }), /B12.*Leichte Sprache/);
  assert.ok(texteRefus({ refus: 'delai' }));
  assert.strictEqual(texteRefus({ refus: 'erreur', texte: 'Gabarit introuvable' }), 'Gabarit introuvable');
});
