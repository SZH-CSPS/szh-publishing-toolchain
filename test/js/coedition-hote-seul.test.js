// lib/coedition-hote.js chargé seul, sans extension.js : la main sur un fichier se prend,
// se refuse et se rend sans aucun rappel vers l'hôte. Les formulaires le requièrent
// directement ; un module qui aurait besoin de l'hôte échouerait ici.
//
//   node --test test/js/coedition-hote-seul.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const coedition = require(path.join(COCKPIT, 'lib', 'coedition.js'));

// Une doublure de « vscode » réduite à ce que le module lit : le réglage du nom.
const postes = [];
function charger() {
  const orig = Module._load;
  const faux = {
    workspace: { getConfiguration: () => ({ get: () => 'Moi Ici' }) },
    window: {}
  };
  Module._load = function (r, p, i) { return r === 'vscode' ? faux : orig(r, p, i); };
  try { return require(path.join(COCKPIT, 'lib', 'coedition-hote.js')); }
  finally { Module._load = orig; }
}

const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-coedition-seul-'));
test.after(() => { fs.rmSync(racine, { recursive: true, force: true }); });
const fichier = path.join(racine, 'ausgabe.yaml');
fs.writeFileSync(fichier, 'title: "Essai"\n');
const VOISIN = { utilisateur: 'Anne Voisine', poste: 'PC-VOISIN' };

test('coedition-hote seul : écrire sous la main pose le bail, fermer le rend', () => {
  const m = charger();
  assert.equal(typeof m.configurer, 'undefined', 'le module ne doit rien attendre de l’hôte');
  const panneau = {};
  let ecrit = false;
  assert.equal(m.ecrireSousMain(panneau, racine, fichier, () => { ecrit = true; return null; }), null);
  assert.equal(ecrit, true);
  assert.ok(coedition.titulaireAutre(racine, fichier, VOISIN), 'aucun bail posé par l’écriture');
  m.libererCoedition(panneau);
  assert.equal(coedition.titulaireAutre(racine, fichier, VOISIN), null, 'le bail survit à la fermeture');
});

test('coedition-hote seul : un fichier tenu ailleurs est refusé, message envoyé au panneau', () => {
  const m = charger();
  assert.ok(coedition.poser(racine, fichier, VOISIN, Date.now()).ok);
  try {
    assert.ok(m.refusCoedition(racine, fichier).indexOf('Anne Voisine') !== -1);
    assert.ok(m.refusCoeditionNumero(racine), 'le numéro paraît libre alors qu’un fichier est tenu');
    const panneau = { webview: { postMessage: (msg) => { postes.push(msg); } } };
    const refus = m.annoncerMain(panneau, racine, fichier);
    assert.equal(refus.code, 'pris');
    assert.equal(postes.length, 1, 'le refus n’est pas parti dans la zone d’état du panneau');
    m.libererCoedition(panneau);
  } finally { coedition.rendre(racine, fichier, VOISIN); }
});

test('coedition-hote seul : l’identité vient du réglage, et s’oublie', () => {
  const m = charger();
  m.oublierIdentiteCoedition();
  assert.equal(m.moiCoedition().utilisateur, 'Moi Ici');
});
