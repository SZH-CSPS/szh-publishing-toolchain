// Complément de test/js/sommaire-chapitre.test.js, dans un processus où aucun activerHote()
// n'a été appelé : lib/session.js n'a pas de profilOuvrage, et profilCourant()
// (lib/metadonnees-hote.js) retombe sur 'revue'. sommaire-chapitre.test.js active l'hôte sur
// un livre, et hote-factice.js n'admet qu'un activerHote() par processus.
//
//   node --test test/js/sommaire-chapitre-revue.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const { chargerAvecVscodeFactice } = require('./dom-minimal');
const yaml = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'yaml.js'));

// lib/metadonnees-hote.js charge lib/cycle-vie.js, qui crée un `new vscode.EventEmitter()` au
// chargement du module. Le vscode factice de dom-minimal.js (workspace/env) n'en a pas : on
// l'étend ici, sans activerHote(), qui poserait un profil.
function chargerHoteMetaSansLivre(chemin) {
  const Module = require('module');
  const orig = Module._load;
  Module._load = function (r, p, i) {
    if (r === 'vscode') {
      return {
        workspace: { getConfiguration: () => ({ get: () => '' }) },
        env: { language: 'fr' },
        EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); } fire() {} }
      };
    }
    return orig(r, p, i);
  };
  try { return require(chemin); } finally { Module._load = orig; }
}

// Même si la webview envoyait horsSommaire pour un article (la case n'existe pas dans son
// DOM, voir sommaire-chapitre.test.js), nettoyerCarte() ignore la clé hors d'un profil livre.
test('revue (profil non livre) : nettoyerCarte ignore horsSommaire même si on le lui fournit', () => {
  const mh = chargerHoteMetaSansLivre(path.join(COCKPIT, 'lib', 'metadonnees-hote.js'));
  const carte = mh.nettoyerCarte({
    type: 'article', lang: 'fr', horsSommaire: true, title: { fr: 'Titre' }
  });
  assert.strictEqual(carte.horsSommaire, false,
    'nettoyerCarte a laissé passer horsSommaire hors d’un profil livre');
  assert.ok(!/sommaire/.test(yaml.serialiserMeta(carte)),
    'la fiche nettoyée écrirait quand même une clé sommaire');
});
