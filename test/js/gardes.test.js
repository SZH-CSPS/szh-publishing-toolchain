// Le module gardes.js DOIT faire échouer un test dont l'outil est déclaré obligatoire et
// absent, jamais le sauter. Le mécanisme réel (échec au chargement du module, sur le poste
// de Robin, pour un vrai outil manquant) ne se simule pas ici sans PATH tronqué — ce fichier
// éprouve donc directement la fonction `exiger`, sur un nom de variable et un motif
// fictifs, pour prouver que « obligatoire + absent » lève et que les deux autres cas non.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const gardes = require('./gardes');

const VARIABLE_FICTIVE = 'SZH_TEST_GARDES_FICTIF_OBLIGATOIRE';

test.afterEach(() => { delete process.env[VARIABLE_FICTIVE]; });

test('outil obligatoire et absent : exiger() lève, ne rend pas un skip', () => {
  process.env[VARIABLE_FICTIVE] = '1';
  assert.throws(() => gardes.exiger(VARIABLE_FICTIVE, 'outil fictif introuvable'),
    /outil fictif introuvable/);
});

test('outil obligatoire mais présent (motif faux) : exiger() ne lève pas', () => {
  process.env[VARIABLE_FICTIVE] = '1';
  assert.strictEqual(gardes.exiger(VARIABLE_FICTIVE, false), false);
});

test('outil absent mais pas déclaré obligatoire : exiger() rend le motif tel quel (skip normal)', () => {
  assert.strictEqual(gardes.exiger(VARIABLE_FICTIVE, 'outil fictif introuvable'),
    'outil fictif introuvable');
});

test('les quatre détections rendent une forme utilisable en { skip: … }', () => {
  for (const [nom, valeur] of Object.entries({
    sansPowerShell: gardes.sansPowerShell, sansPython: gardes.sansPython,
    sansPandocWsl: gardes.sansPandocWsl, sansPandoc: gardes.sansPandoc
  })) {
    assert.ok(valeur === false || typeof valeur === 'string',
      nom + ' doit être `false` ou une chaîne de motif, pas : ' + JSON.stringify(valeur));
  }
  assert.strictEqual(typeof gardes.POWERSHELL, 'string');
  assert.strictEqual(typeof gardes.VERSION_PYTHON, 'string');
  assert.strictEqual(gardes.PYTHON, undefined, 'plus aucun interprète à lancer à la main');
});

test('cheminVersWsl : un chemin Windows absolu passe en /mnt/<lecteur>/, le reste ne bouge pas', () => {
  const c = gardes.cheminVersWsl;
  assert.strictEqual(c('C:\\Users\\robin\\a b.docx'), '/mnt/c/Users/robin/a b.docx');
  assert.strictEqual(c('D:/x/y'), '/mnt/d/x/y');
  assert.strictEqual(c('C:\\'), '/mnt/c/');
  assert.strictEqual(c('--sortie=C:\\t\\o.json'), '--sortie=/mnt/c/t/o.json');
  for (const tel of ['-c', 'import sys', 'relatif\\a', '/mnt/c/x', 'C:', 'http://x', '{"a":"C:\\\\b"}', '']) {
    assert.strictEqual(c(tel), tel);
  }
  assert.strictEqual(c(undefined), undefined);
});

test('wslenvPour : seules les variables ajoutées ou changées passent, /p pour un chemin', () => {
  const parent = { PATH: 'x', HOME: 'C:\\h', GARDE: '1' };
  const env = Object.assign({}, parent, { HOME: 'C:\\autre', NOUVELLE: 'v', ICI: 'D:/d', GARDE: '1', WSLENV: 'Z' });
  assert.deepStrictEqual(gardes.wslenvPour(env, parent), ['HOME/p', 'NOUVELLE', 'ICI/p']);
  assert.deepStrictEqual(gardes.wslenvPour(undefined, parent), []);
});

test('commandePython : wsl.exe -e python3 sous Windows, python3 ailleurs', () => {
  const w = gardes.commandePython(['C:\\s.py', 'x'], { cwd: 'C:\\d', env: { A: '1' } }, 'win32');
  assert.match(w.commande, /wsl(\.exe)?$/i);
  assert.deepStrictEqual(w.args, ['-d', 'SZH-Publishing', '--cd', '/mnt/c/d', '-e', 'python3', '/mnt/c/s.py', 'x']);
  assert.ok(/(^|:)A$/.test(w.env.WSLENV), w.env.WSLENV);
  assert.strictEqual(w.cwd, undefined);
  const l = gardes.commandePython(['s.py'], { cwd: '/d' }, 'linux');
  assert.deepStrictEqual([l.commande, l.args, l.cwd], ['python3', ['s.py'], '/d']);
});

for (const nom of ['python', 'pythonGroupe']) {
test(nom + '() : stdin, arguments, variables et dossier courant arrivent à l’interprète', { skip: gardes.sansPython }, () => {
  const os = require('os');
  const r = gardes[nom](['-c', 'import os, sys; print(sys.argv[1:]); print(os.environ["SZH_ESSAI"]); '
    + 'print(os.path.isdir(os.environ["SZH_ESSAI_CHEMIN"])); print(os.path.isdir(os.getcwd())); print(sys.stdin.read())',
  os.tmpdir(), '$HOME', "l'é"],
  { input: 'entrée', cwd: os.tmpdir(),
    env: Object.assign({}, process.env, { SZH_ESSAI: 'a b', SZH_ESSAI_CHEMIN: os.tmpdir() }) });
  assert.strictEqual(r.status, 0, r.stderr);
  const lignes = r.stdout.split(/\r?\n/);
  assert.ok(!/^\[.[A-Za-z]:/.test(lignes[0]), lignes[0]);
  assert.match(lignes[0], /'\$HOME', "l'é"\]$/);
  assert.deepStrictEqual(lignes.slice(1, 5), ['a b', 'True', 'True', 'entrée']);
});

test(nom + '() : code de sortie, stderr, octets bruts et processus neuf à chaque appel', { skip: gardes.sansPython }, () => {
  const r = gardes[nom](['-c', 'import sys; sys.stderr.write("é\\n"); sys.exit(3)']);
  assert.deepStrictEqual([r.status, r.stderr, r.stdout], [3, 'é\n', '']);
  const b = gardes[nom](['-c', 'import sys; sys.stdout.buffer.write(bytes([0, 255]))'], { encoding: 'buffer' });
  assert.ok(Buffer.isBuffer(b.stdout) && b.stdout.equals(Buffer.from([0, 255])), String(b.stdout));
  const pid = (x) => gardes[nom](['-c', 'import os; print(os.getpid())']).stdout.trim();
  assert.notStrictEqual(pid(), pid(), 'deux appels ne doivent jamais partager un interprète');
});
}
