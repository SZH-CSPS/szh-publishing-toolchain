// Les tâches de démarrage lancées par le cockpit quand VSCodium a été ouvert sans « Pronto »
// (vscodium-extension/szh-cockpit/lib/demarrage.js). Rien n'est lancé : l'exécution est
// remplacée par un enregistreur.
//
//   node --test test/js/demarrage.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const demarrage = require('../../vscodium-extension/szh-cockpit/lib/demarrage');

const MAINTENANT = Date.UTC(2026, 9, 20, 9, 0, 0);
const HEURE = 60 * 60 * 1000;

function memoire(valeurs) {
  const m = Object.assign({}, valeurs);
  return { get: (k) => m[k], update: async (k, v) => { m[k] = v; }, lu: m };
}

function enregistreur() {
  const appels = [];
  const executer = (exe, args, opts, rappel) => { appels.push({ exe, args, opts }); rappel(null, '', ''); };
  return { appels, executer };
}

test('aLancer : seulement sous Windows, sans le passage du lanceur ni harnais de test', () => {
  assert.equal(demarrage.aLancer({}, undefined, MAINTENANT, 'win32'), true);
  assert.equal(demarrage.aLancer({}, undefined, MAINTENANT, 'linux'), false);
  assert.equal(demarrage.aLancer({ SZH_TACHES_DEMARRAGE: '1' }, undefined, MAINTENANT, 'win32'), false);
  assert.equal(demarrage.aLancer({ SZH_RESEAU_INTERDIT: '1' }, undefined, MAINTENANT, 'win32'), false);
  assert.equal(demarrage.aLancer({ SZH_LANCEUR_SIMULE: '1' }, undefined, MAINTENANT, 'win32'), false);
});

test('aLancer : au plus une fois toutes les 12 heures, une date future ou illisible ne bloque pas', () => {
  assert.equal(demarrage.aLancer({}, MAINTENANT - HEURE, MAINTENANT, 'win32'), false);
  assert.equal(demarrage.aLancer({}, MAINTENANT - demarrage.PERIODE_MS + 1, MAINTENANT, 'win32'), false);
  assert.equal(demarrage.aLancer({}, MAINTENANT - demarrage.PERIODE_MS, MAINTENANT, 'win32'), true);
  assert.equal(demarrage.aLancer({}, MAINTENANT + HEURE, MAINTENANT, 'win32'), true);
  assert.equal(demarrage.aLancer({}, 'abc', MAINTENANT, 'win32'), true);
});

test('lancerSiBesoin : open-revue.ps1 -Demarrage par Windows PowerShell, la date posée avant', async () => {
  const m = memoire();
  const e = enregistreur();
  const lance = await demarrage.lancerSiBesoin(m, { env: {}, maintenant: MAINTENANT, plateforme: 'win32',
    executer: e.executer, existe: () => true });
  assert.equal(lance, true);
  assert.equal(m.lu[demarrage.CLE_DERNIER], MAINTENANT);
  assert.equal(e.appels.length, 1);
  assert.equal(path.basename(e.appels[0].exe).toLowerCase(), 'powershell.exe');
  const args = e.appels[0].args;
  assert.equal(path.basename(args[args.indexOf('-File') + 1]), 'open-revue.ps1');
  assert.equal(args[args.length - 1], '-Demarrage');
  assert.equal(e.appels[0].opts.windowsHide, true);
});

test('lancerSiBesoin : rien quand le lanceur est passé, ni dans les 12 heures, ni sans le script', async () => {
  const e = enregistreur();
  const base = { maintenant: MAINTENANT, plateforme: 'win32', executer: e.executer, existe: () => true };
  assert.equal(await demarrage.lancerSiBesoin(memoire(), Object.assign({}, base, { env: { SZH_TACHES_DEMARRAGE: '1' } })), false);
  assert.equal(await demarrage.lancerSiBesoin(memoire({ [demarrage.CLE_DERNIER]: MAINTENANT - HEURE }),
    Object.assign({}, base, { env: {} })), false);
  const m = memoire();
  assert.equal(await demarrage.lancerSiBesoin(m, Object.assign({}, base, { env: {}, existe: () => false })), false);
  assert.equal(m.lu[demarrage.CLE_DERNIER], undefined, 'sans script, aucune date ne doit être posée');
  assert.equal(await demarrage.lancerSiBesoin(null, Object.assign({}, base, { env: {} })), false);
  assert.equal(e.appels.length, 0);
});

test('lancerSiBesoin : une exécution qui lève ne rejette pas', async () => {
  const lance = await demarrage.lancerSiBesoin(memoire(), { env: {}, maintenant: MAINTENANT, plateforme: 'win32',
    executer: () => { throw new Error('spawn EPERM'); }, existe: () => true });
  assert.equal(lance, false);
});
