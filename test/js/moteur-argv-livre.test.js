// Caractérisation de la tâche de chapitre d'un livre : le pendant de moteur-argv.test.js,
// dans son propre processus, car l'hôte factice ne s'active qu'une fois par processus.
//
//   node --test test/js/moteur-argv-livre.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

// Avant tout require du cockpit : le chemin du Makefile se calcule au chargement.
process.env.SZH_TOOLKIT = 'C:\\SZH-essai\\toolkit';
const TK = '/mnt/c/SZH-essai/toolkit';

const { livreDEssai, activerHote } = require('./hote-factice');
const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

const tick = () => new Promise((r) => setImmediate(r));

test('chapitre : tâche wsl.exe du PATH, bash -c avec pipefail et tee du journal', async () => {
  fs.rmSync(path.join(LIVRE, 'out'), { recursive: true, force: true });   // rien compilé
  const origine = HOTE.stub.tasks.executeTask;
  let tache = null;
  HOTE.stub.tasks.executeTask = (t) => {
    tache = t;
    // Le PDF qu'aurait écrit la compilation, sans quoi l'ouverture attendrait encore.
    fs.mkdirSync(path.join(LIVRE, 'out', 'chapitres'), { recursive: true });
    fs.writeFileSync(path.join(LIVRE, 'out', 'chapitres', '02-suite.pdf'), '%PDF-1.7\n');
    return origine(t);
  };
  try {
    const p = HOTE.executer('szh.ouvrirArticle', '02-suite');
    for (let i = 0; i < 5 && !tache; i++) { await tick(); }
    await tick();
    assert.ok(tache, 'aucune tâche lancée');
    HOTE.finirTache(tache.name, 0);
    await p;
  } finally {
    HOTE.stub.tasks.executeTask = origine;
    fs.rmSync(path.join(LIVRE, 'out'), { recursive: true, force: true });
  }
  const e = tache.execution;
  assert.deepStrictEqual({ commande: e.process, args: e.args, options: e.options }, {
    commande: 'wsl.exe',
    args: ['-d', 'SZH-Publishing', '--cd', LIVRE, '--', 'bash', '-c',
      "set -o pipefail; make -j2 -O -f '" + TK + "/pipeline/Makefile' livre-chapitre-pdf "
      + 'CHAPITRE=02-suite 2>&1 | tee .szh-journal.log'],
    options: undefined
  });
});
