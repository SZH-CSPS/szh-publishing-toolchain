// À la désactivation, VS Code libère chaque abonnement de context.subscriptions : aucun ne
// doit lever, sans quoi les suivants restent vivants (le contrôle de source des conflits
// compris).
//
// Exécution : depuis la racine du dépôt,
//   node --test test/js/liberation-abonnements.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { revueDEssai, activerHote } = require('./hote-factice');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Un seul activerHote() par processus : les deux tests partagent le même hôte.
const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const ext = require(path.join(COCKPIT, 'extension.js'));

// L'hôte factice ne rend pas son contexte : une seconde activation, sur un contexte à nous,
// donne accès à la liste des abonnements posés par extension.js.
function activerSurContexteAPart() {
  const contexte = {
    subscriptions: [], extensionPath: COCKPIT,
    globalState: { get: () => undefined, update: () => Promise.resolve() }
  };
  ext.activate(contexte);
  return contexte;
}

test('tous les abonnements de l\'extension se libèrent sans lever', () => {
  const contexte = activerSurContexteAPart();
  assert.ok(contexte.subscriptions.length > 0, 'des abonnements sont posés');
  const echecs = [];
  contexte.subscriptions.forEach((s, i) => {
    try { s.dispose(); } catch (e) { echecs.push('#' + i + ' : ' + e.message); }
  });
  assert.deepEqual(echecs, []);
});

test('libérer les abonnements ferme le SourceControl des conflits', () => {
  const contexte = activerSurContexteAPart();
  const ausgabe = path.join(REVUE, 'ausgabe.yaml');
  const copie = path.join(REVUE, 'ausgabe-Copie en conflit.yaml');
  fs.writeFileSync(copie, fs.readFileSync(ausgabe, 'utf8') + '\n');
  require(path.join(COCKPIT, 'lib', 'cycle-vie.js')).majConflitsScm(REVUE, [
    { nom: 'ausgabe-Copie en conflit.yaml', cheminOriginal: ausgabe, chemin: copie }
  ]);
  assert.ok(HOTE.sourceControls().length > 0, 'un SourceControl existe');
  contexte.subscriptions.forEach((s) => { try { s.dispose(); } catch (e) { /* vu par le premier test */ } });
  assert.equal(HOTE.sourceControls().length, 0);
});
