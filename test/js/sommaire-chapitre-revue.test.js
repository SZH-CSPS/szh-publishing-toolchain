// Complément de test/js/sommaire-chapitre.test.js, dans son propre fichier : ce contrôle a
// besoin d'un processus où AUCUN activerHote() n'a encore été appelé, pour que
// lib/session.js n'ait posé aucun profilOuvrage et que profilCourant()
// (lib/metadonnees-hote.js) retombe sur son repli 'revue' — l'état d'un module chargé hors
// de tout dossier livre. sommaire-chapitre.test.js appelle déjà activerHote() sur un livre
// et pose ainsi ce profil pour tout son propre processus ; « un seul activerHote() par
// processus » (hote-factice.js) interdit d'y ajouter ce contrôle-ci.
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

// lib/metadonnees-hote.js entraîne lib/cycle-vie.js, qui pose `new vscode.EventEmitter()`
// AU CHARGEMENT du module (pas dans une fonction) : le simple vscode factice de
// dom-minimal.js (workspace/env) n'en porte pas et lève aussitôt. On l'étend ici plutôt que
// d'appeler activerHote() (hote-factice.js), qui n'est permis qu'une fois par processus et
// que sommaire-chapitre.test.js consomme déjà pour un LIVRE — précisément le profil que ce
// contrôle-ci veut absent.
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

// Défense en profondeur : même si un bogue de la webview envoyait horsSommaire pour un
// article (la case n'existe pourtant pas dans son DOM, voir sommaire-chapitre.test.js),
// nettoyerCarte() ne doit jamais laisser passer la clé hors d'un profil livre.
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
