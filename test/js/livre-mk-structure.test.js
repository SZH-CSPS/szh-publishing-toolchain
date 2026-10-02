// pipeline/profils/livre.mk, pour la structure du livre normal : le numéro « 1.1 » que
// l'assembleur calcule une fois et que chaque chapitre reçoit en SZH_NUMERO_CHAPITRE, et la
// surcharge styles/livre.css, empilée après partage-filtres et avant l'accent. On lit les
// recettes que make écrirait (`make -n`) sur un livre jetable, sans rien compiler.
//
//   node --test test/js/livre-mk-structure.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const DISTRO = 'SZH-Publishing';

function versWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function makeN(dossier, cible) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  const args = ['-d', DISTRO, '--cd', versWsl(dossier), '--', 'make', '-n', '-f',
    versWsl(path.join(RACINE, 'pipeline', 'Makefile')), cible];
  return spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe', args,
    { encoding: 'utf8', windowsHide: true, timeout: 180000 });
}

// Les commandes que make écrirait, une par ligne, continuations « \ » recollées.
function commandes(sortie) {
  return sortie.replace(/\\\r?\n/g, ' ').split(/\r?\n/);
}

// Un livre jetable : trois chapitres, deux dans une partie numérotée.
function livre(extra, fichiers) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-livre-mk-'));
  const buch = 'titre: "Ein Buch"\nlang: de\nmaquette: normal\nliminaires: [sommaire]\n'
    + 'parties:\n- titre: "Teil"\n  numero: "1"\n  numeroter: oui\n  chapitres: [02-b, 03-c]\n' + (extra || '');
  fs.writeFileSync(path.join(d, 'buch.yaml'), buch, 'utf8');
  for (const slug of ['01-a', '02-b', '03-c']) {
    fs.mkdirSync(path.join(d, 'chapitres', slug), { recursive: true });
    fs.writeFileSync(path.join(d, 'chapitres', slug, slug + '.md'), 'Text.\n', 'utf8');
    fs.writeFileSync(path.join(d, 'chapitres', slug, slug + '.meta.yaml'), 'title:\n  de: "Titel ' + slug + '"\n', 'utf8');
  }
  for (const [nom, contenu] of Object.entries(fichiers || {})) {
    fs.mkdirSync(path.dirname(path.join(d, nom)), { recursive: true });
    fs.writeFileSync(path.join(d, nom), contenu, 'utf8');
  }
  return d;
}

test('livre.mk : chaque chapitre reçoit le numéro de sa partie, calculé par l’assembleur', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const d = livre('mise-en-page:\n  numeros-chapitres: partie\n');
  try {
    const r = makeN(d, 'out/chapitres/03-c.frag.html');
    assert.strictEqual(r.status, 0, r.stderr);
    const lignes = r.stdout.split(/\r?\n/).filter((l) => l.includes('export SZH_NUMERO_CHAPITRE='));
    assert.ok(lignes.length > 0, 'contexte_chapitre ne passe pas SZH_NUMERO_CHAPITRE : ' + r.stdout);
    assert.ok(lignes.every((l) => /02-b=1\.1 03-c=1\.2/.test(l)), lignes.join('\n'));
    assert.ok(!/01-a=/.test(lignes.join('\n')), 'un chapitre hors partie a reçu un numéro');
    const d2 = livre('mise-en-page:\n  numeros-chapitres: continu\n');
    try {
      const continu = makeN(d2, 'out/chapitres/03-c.frag.html');
      assert.strictEqual(continu.status, 0, continu.stderr);
      assert.ok(!/=1\.1/.test(continu.stdout), 'numéro de partie sans numeros-chapitres: partie');
    } finally { fs.rmSync(d2, { recursive: true, force: true }); }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('livre.mk : styles/livre.css s’empile après partage-filtres, avant l’accent, PDF et imprimeur seulement', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const d = livre('', { 'styles/livre.css': '.x { color: red; }\n' });
  try {
    const nom = path.basename(d);
    for (const cible of ['out/' + nom + '.html', 'out/' + nom + '-imprimeur.html']) {
      const r = makeN(d, cible);
      assert.strictEqual(r.status, 0, r.stderr);
      const ligne = commandes(r.stdout).find((l) => l.includes('livre-assembler.py') && l.includes('--sortie "' + cible));
      assert.ok(ligne, cible + ' : appel de l’assembleur absent : ' + r.stdout);
      const iPartage = ligne.indexOf('partage-filtres.css');
      const iLocal = ligne.indexOf('/styles/livre.css');
      const iAccent = ligne.indexOf('.szh-accent.css');
      assert.ok(iPartage >= 0 && iLocal > iPartage && iAccent > iLocal, cible + ' : ' + ligne);
    }
    const web = makeN(d, 'out/web/' + nom + '.html');
    assert.strictEqual(web.status, 0, web.stderr);
    assert.ok(!/\/styles\/livre\.css/.test(web.stdout), 'la surcharge entre dans le HTML web');
    const sans = livre('');
    try {
      const r = makeN(sans, 'out/' + path.basename(sans) + '.html');
      assert.strictEqual(r.status, 0, r.stderr);
      assert.ok(!/\/styles\/livre\.css/.test(r.stdout), 'surcharge posée sans fichier');
    } finally { fs.rmSync(sans, { recursive: true, force: true }); }
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
