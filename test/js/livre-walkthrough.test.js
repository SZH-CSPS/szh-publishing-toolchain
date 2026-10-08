// Le walkthrough de démarrage (package.json, contributes.walkthroughs) n'a de sens que
// pour une revue/Zeitschrift : un livre n'a ni articles-word/, ni suivi de traduction, ni
// export XML/OJS — soit six des neuf pas du tutoriel.
//
//   node --test test/js/livre-walkthrough.test.js
//
// Le `when` du walkthrough ne filtre que la page d'accueil « Get Started » :
// `workbench.action.openWalkthrough` ouvre l'éditeur par son id sans lire de contexte
// (voir proposerTutoriel(), extension.js). L'invitation automatique porte donc sa propre
// garde, vérifiée dans test/js/hote-livre.test.js et test/js/hote.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

test('package.json : le walkthrough de démarrage porte when: !szh.estLivre', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const parcours = pkg.contributes.walkthroughs.find((w) => w.id === 'szhDemarrage');
  assert.ok(parcours, 'le walkthrough szhDemarrage a disparu de package.json');
  assert.strictEqual(parcours.when, '!szh.estLivre', 'when incorrect : ' + parcours.when);
});

test('le workbench VSCodium installé accepte bien when au niveau du walkthrough', () => {
  // Le point d'extension `walkthroughs` du VSCodium installé déclare `when` à côté de
  // id/title/description/steps dans son schéma JSON.
  const bin = path.join(
    process.env.LOCALAPPDATA || '', 'Programs', 'VSCodium', 'resources', 'app', 'out',
    'vs', 'workbench', 'workbench.desktop.main.js');
  let contenu;
  try { contenu = fs.readFileSync(bin, 'utf8'); }
  catch (e) { return; }               // poste sans VSCodium installé à cet endroit : rien à vérifier
  const m = contenu.match(/extensionPoint:"walkthroughs".{0,600}/);
  assert.ok(m, 'point d’extension walkthroughs introuvable dans le workbench installé');
  assert.match(m[0], /when:\{type:"string"/,
    'le schéma walkthroughs de ce workbench n’a plus de propriété when au niveau du walkthrough');
});
