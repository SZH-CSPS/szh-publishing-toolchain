// Ouvrir un fichier avec l'application du système : le chemin brut, jamais un file:// encodé.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const ouvrir = require(path.join(COCKPIT, 'lib', 'ouvrir-systeme.js'));

// Un chemin réaliste : espaces, accent, comme un numéro rangé dans OneDrive.
const CHEMIN = String.raw`C:\Users\x\OneDrive - SZH\Révision\alvarez_2026_Revue CSPS-nettoye.docx`;

test('sous Windows, explorer.exe reçoit le chemin tel quel, accents et espaces compris', () => {
  const c = ouvrir.commande(CHEMIN, 'win32', String.raw`D:\Win`);
  assert.deepStrictEqual(c, { programme: path.join(String.raw`D:\Win`, 'explorer.exe'), args: [CHEMIN] });
});

test('hors Windows, pas de commande : on passe par openExternal', () => {
  assert.strictEqual(ouvrir.commande('/home/x/a.docx', 'linux', ''), null);
});

test('ouvrirAvecSysteme lance explorer.exe, sans passer par openExternal', { skip: process.platform !== 'win32' }, async () => {
  const lances = [];
  let externes = 0;
  ouvrir.poserLanceur((programme, args) => { lances.push([programme, args]); });
  try {
    const faux = { env: { openExternal: () => { externes++; } }, Uri: { file: (p) => p } };
    const r = await ouvrir.ouvrirAvecSysteme(CHEMIN, faux);
    assert.strictEqual(r, true);
    assert.strictEqual(externes, 0, 'le file:// encodé est revenu');
    assert.deepStrictEqual(lances.map((l) => l[1]), [[CHEMIN]]);
    assert.match(lances[0][0], /explorer\.exe$/i);
  } finally { ouvrir.poserLanceur(null); }
});

// Le file:// d'openExternal échoue sous Windows sur un chemin accentué (0x2) : aucun
// fichier du cockpit ne doit plus passer par là. L'hôte du lanceur est rebranché sur ce
// module par la bascule « accueil » ; d'ici là il est seul excepté.
test('aucun openExternal(vscode.Uri.file(…)) dans le cockpit', () => {
  const exceptes = [path.join('lib', 'lanceur-hote.js'), path.join('lib', 'ouvrir-systeme.js')];
  const fichiers = fs.readdirSync(path.join(COCKPIT, 'lib')).filter((n) => n.endsWith('.js'))
    .map((n) => path.join('lib', n)).concat(['extension.js']);
  const fautes = fichiers.filter((rel) => exceptes.indexOf(rel) === -1
    && /openExternal\(\s*vscode\.Uri\.file\(/.test(fs.readFileSync(path.join(COCKPIT, rel), 'utf8')));
  assert.deepStrictEqual(fautes, []);
});
