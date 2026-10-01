// Un Word illisible (zip tronqué) est un échec franc, jamais un succès silencieux.
//
//   node --test test/js/import-illisible.test.js
//
// Avant : docx-meta.py et pronto-lire.py rendaient 0 sur un zip tronqué, sans fiche ni
// instructions ; le refus de l'import ne venait que, par hasard, de l'échec d'un maillon
// suivant. Maintenant les deux lecteurs sortent en échec avec un constat au rédacteur
// (fichier-illisible, fr puis de), et import-docx.sh refuse avant de créer quoi que ce soit.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { PYTHON, sansPython, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPE = path.join(RACINE, 'pipeline');
const GABARIT = path.join(RACINE, 'revue-template', "Pronto - modele d'article_FR.docx");

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-illisible-'));
}

// Le gabarit livré, coupé en deux : un zip dont l'annuaire central a disparu.
function zipTronque(base) {
  const complet = fs.readFileSync(GABARIT);
  const chemin = path.join(base, 'tronque.docx');
  fs.writeFileSync(chemin, complet.subarray(0, Math.floor(complet.length / 2)));
  return chemin;
}

function python(args, env) {
  return cp.spawnSync(PYTHON, args, {
    encoding: 'utf8',
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }, env || {})
  });
}

for (const lecteur of ['docx-meta.py', 'pronto-lire.py']) {
  test(lecteur + ' : un zip tronqué sort en échec, avec un constat fr puis de', { skip: sansPython }, () => {
    const base = dossierJetable();
    try {
      const r = python([path.join(PIPE, lecteur), zipTronque(base), 'art', base]);
      assert.notStrictEqual(r.status, 0, lecteur + ' a réussi sur un zip tronqué : ' + r.stderr);
      assert.match(r.stderr, /\[import-avertissement\] fichier-illisible \| article « art » \|/, r.stderr);
      assert.match(r.stderr, /n’a pas pu être ouvert.*\[de\] Die Word-Datei konnte nicht/s, r.stderr);
      assert.ok(!fs.existsSync(path.join(base, 'art.meta.yaml')), 'une fiche a été écrite');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
}

// ---- La vraie chaîne, dans la WSL -------------------------------------------------------
const DISTRO = 'SZH-Publishing';
const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');

function versWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

test('import-docx.sh (WSL) : un zip tronqué est refusé, message fr puis de, rien n’est créé',
  { skip: sansPandocWsl }, () => {
    const base = dossierJetable();
    try {
      const chantier = path.join(base, 'revue');
      fs.mkdirSync(chantier, { recursive: true });
      fs.copyFileSync(path.join(RACINE, 'test', 'ausgabe.yaml'), path.join(chantier, 'ausgabe.yaml'));
      const journal = path.join(base, 'import.log');
      const r = cp.spawnSync(fs.existsSync(WSL_EXE) ? WSL_EXE : 'wsl.exe', ['-d', DISTRO, '--', 'sh', '-c',
        'cd ' + JSON.stringify(versWsl(chantier)) + ' && SZH_IMPORT_LOG=' + JSON.stringify(versWsl(journal))
        + ' PYTHONIOENCODING=utf-8 bash ' + JSON.stringify(versWsl(path.join(PIPE, 'import-docx.sh')))
        + ' ' + JSON.stringify(versWsl(zipTronque(base))) + ' essai ' + JSON.stringify(versWsl(PIPE))],
      { encoding: 'utf8', windowsHide: true, timeout: 240000 });
      assert.strictEqual(r.status, 1, 'import-docx.sh devait refuser : ' + r.stdout + r.stderr);
      assert.match(r.stderr, /n’a pas pu être ouvert.*\[de\].*konnte nicht geöffnet werden/s, r.stderr);
      assert.ok(fs.existsSync(journal) && /\[de\]/.test(fs.readFileSync(journal, 'utf8')),
        'le refus n’est pas au journal d’import');
      assert.ok(!fs.existsSync(path.join(chantier, 'articles')), 'un dossier d’article a été créé');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
