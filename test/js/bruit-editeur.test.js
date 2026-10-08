// Les réglages qui font taire VSCodium et ses extensions pendant et après une compilation,
// dans le gabarit du poste et dans les défauts du cockpit.
//
//   node --test test/js/bruit-editeur.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');
const flotte = require(path.join(COCKPIT, 'lib', 'reglages-flotte.js'));

const GABARIT = flotte.analyserJsonc(lire('vscodium-user', 'settings.json'));
const DEFAUTS = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'))
  .contributes.configurationDefaults;

// Chaque réglage vaut dans le gabarit du poste et dans les défauts de l'extension.
function verifierPartout(cle, attendu) {
  assert.deepStrictEqual(GABARIT[cle], attendu, 'vscodium-user/settings.json : ' + cle);
  assert.deepStrictEqual(DEFAUTS[cle], attendu, 'configurationDefaults : ' + cle);
}

test('la bascule « Trigger Task on Save » n’est pas dans la barre d’état', () => {
  // Libellé anglais, et un clic y coupe la compilation à l'enregistrement sans rien dire.
  verifierPartout('triggerTaskOnSave.showStatusBarToggle', false);
  // Les avis « Task … started / finished », en anglais, restent éteints.
  assert.notStrictEqual(GABARIT['triggerTaskOnSave.showNotifications'], true);
});

test('le panneau de discussion (Chat) ne s’ouvre pas à côté de l’article', () => {
  // VSCodium ouvre la barre latérale secondaire, vide, au premier passage d'un dossier.
  verifierPartout('workbench.secondarySideBar.defaultVisibility', 'hidden');
});

// Les fichiers techniques que la chaîne et le cockpit écrivent à la racine d'un numéro ou
// dans le dossier d'un article. Chaque nom est relu à sa source : s'il y change, ce test le
// signale.
const FICHIERS_TECHNIQUES = [
  { source: ['vscodium-extension', 'szh-cockpit', 'lib', 'pdfua-hote.js'], motif: /const NOM_CACHE = '([^']+)'/ },
  { source: ['pipeline', 'pagination.py'], motif: /^NOM_JSON = '([^']+)'/m },
  { source: ['pipeline', 'reimporter.py'], motif: /^NOM_EMPREINTES = '([^']+)'/m },
  { source: ['vscodium-extension', 'szh-cockpit', 'lib', 'coedition.js'], motif: /const DOSSIER_EDITION = '([^']+)'/ },
  { source: ['vscodium-extension', 'szh-cockpit', 'lib', 'apercu.js'], motif: /path\.join\(racine, '(\.szh-apercu)'\)/ }
];

test('l’explorateur masque les fichiers techniques d’une compilation', () => {
  const exclus = GABARIT['files.exclude'] || {};
  for (const f of FICHIERS_TECHNIQUES) {
    const m = lire(...f.source).match(f.motif);
    assert.ok(m, 'nom introuvable dans ' + f.source.join('/'));
    assert.strictEqual(exclus['**/' + m[1]], true, m[1] + ' reste visible dans l’explorateur');
  }
  for (const nom of ['.szh-journal.log', '.import.log']) {
    assert.strictEqual(exclus['**/' + nom], true, nom + ' reste visible dans l’explorateur');
  }
});

test('aucune tâche ne réclame de problemMatcher ni ne rouvre son terminal', () => {
  const src = lire('vscodium-user', 'tasks.json');
  const taches = flotte.analyserJsonc(src).tasks;
  assert.ok(taches.length >= 4);
  for (const t of taches) {
    // Sans problemMatcher déclaré, VSCodium demande en anglais quelles erreurs chercher dans
    // la sortie ; un vrai problemMatcher remplirait le panneau Problèmes de lignes de make.
    assert.deepStrictEqual(t.problemMatcher, [], t.label + ' : problemMatcher');
    assert.strictEqual(t.presentation.reveal, 'never', t.label + ' : reveal');
    assert.strictEqual(t.presentation.showReuseMessage, false, t.label + ' : showReuseMessage');
    assert.notStrictEqual(t.presentation.revealProblems, 'always', t.label + ' : revealProblems');
    assert.notStrictEqual(t.presentation.focus, true, t.label + ' : focus');
  }
});
