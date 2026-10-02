// Ce que l'Accueil ouvre avec l'application du système (lib/accueil-hote.js) : le document
// et le rapport du Préprocessing, le dossier d'un export et celui des journaux. Tous passent
// par ouvrirAvecSysteme, jamais par le file:// encodé d'openExternal, que Windows refuse sur
// un chemin accentué. Le faux vscode ne s'active qu'une fois : un seul fichier, à lui seul.
//
//   node --test test/js/accueil-ouvrir.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const LIB = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib');
const { revueDEssai, activerHote } = require('./hote-factice');

// Les rappels que l'Accueil pose sur ses onglets, retenus au passage.
const rappels = {};
for (const nom of ['accueil-preproc-hote', 'accueil-secretariat-hote', 'accueil-journal-hote']) {
  const m = require(path.join(LIB, nom + '.js'));
  const avant = m.configurer;
  m.configurer = (c) => { rappels[nom] = Object.assign({}, rappels[nom], c); return avant(c); };
}

const HOTE = activerHote(revueDEssai(), { sansDossier: true });
let externes = 0;
const openExternal = HOTE.stub.env.openExternal;
HOTE.stub.env.openExternal = (u) => { externes++; return openExternal(u); };

const SAUT = process.platform !== 'win32' ? 'chemins Windows — joué par le job contrats-windows' : false;

test('le document et le rapport, les dossiers d’export et de journaux : ouvrirAvecSysteme, jamais openExternal',
  { skip: SAUT }, async () => {
    const document = String.raw`C:\Users\x\OneDrive - SZH\Révision\alvarez_2026_Revue CSPS-nettoye.docx`;
    const rapport = String.raw`C:\Users\x\AppData\Local\Temp\rapport-élève.html`;
    const exportes = String.raw`C:\Users\x\OneDrive - SZH\Exports\Caractères par article`;
    const journaux = String.raw`C:\ProgramData\SZH\logs`;
    const preproc = rappels['accueil-preproc-hote'];
    assert.ok(preproc && rappels['accueil-secretariat-hote'] && rappels['accueil-journal-hote'],
      'un onglet n’a pas reçu ses rappels : ' + Object.keys(rappels).join(', '));
    assert.strictEqual(await preproc.ouvrirExterne(document), true, 'le document ne s’ouvre pas');
    assert.strictEqual(await preproc.ouvrirExterne(rapport), true, 'le rapport ne s’ouvre pas');
    await rappels['accueil-secretariat-hote'].ouvrirDossier(exportes);
    await rappels['accueil-journal-hote'].ouvrirDossier(journaux);
    assert.strictEqual(externes, 0, 'openExternal(Uri.file(…)) est revenu');
    assert.deepStrictEqual(HOTE.ouvertures(), [document, rapport, exportes, journaux]);
  });
