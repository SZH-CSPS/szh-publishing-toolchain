// Le choix du lecteur dans import-docx.sh distingue trois réponses de
// `pronto-lire.py --reconnaitre` : 0 = au gabarit, 10 = pas au gabarit, tout autre code =
// panne. Sur une panne, le document passe par docx-meta.py, et le journal d'import le dit,
// avec la dernière ligne écrite par le reconnaisseur.
//
//   node --test test/js/import-reconnaissance.test.js
//
// Chaîne réelle dans la WSL (comme import-figures.test.js). La panne est provoquée dans
// une copie du dossier pipeline/ dont pronto_docx.py plante au chargement.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPE = path.join(RACINE, 'pipeline');
const HERITE = path.join(RACINE, 'livre-template', 'Modele-chapitre-SZH.docx');
const DISTRO = 'SZH-Publishing';
const WSL_EXE = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');

function versWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function importer(base, pipe) {
  const chantier = path.join(base, 'revue');
  fs.mkdirSync(chantier, { recursive: true });
  fs.copyFileSync(path.join(RACINE, 'test', 'ausgabe.yaml'), path.join(chantier, 'ausgabe.yaml'));
  const docx = path.join(base, 'herite.docx');
  fs.copyFileSync(HERITE, docx);
  const journal = path.join(base, 'import.log');
  const r = cp.spawnSync(fs.existsSync(WSL_EXE) ? WSL_EXE : 'wsl.exe', ['-d', DISTRO, '--', 'sh', '-c',
    'cd ' + JSON.stringify(versWsl(chantier)) + ' && SZH_IMPORT_LOG=' + JSON.stringify(versWsl(journal))
    + ' PYTHONIOENCODING=utf-8 bash ' + JSON.stringify(versWsl(path.join(pipe, 'import-docx.sh')))
    + ' ' + JSON.stringify(versWsl(docx)) + ' essai ' + JSON.stringify(versWsl(pipe))],
  { encoding: 'utf8', windowsHide: true, timeout: 240000 });
  return { r, journal: fs.existsSync(journal) ? fs.readFileSync(journal, 'utf8') : '' };
}

test('import-docx.sh (WSL) : un Word hérité est un « non » (10), sans alarme au journal',
  { skip: sansPandocWsl }, () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-reco-'));
    try {
      const vu = importer(base, PIPE);
      assert.strictEqual(vu.r.status, 0, 'l’import d’un Word hérité a échoué : ' + vu.r.stderr);
      assert.ok(!/reconnaissance du gabarit|Erkennung der Vorlage/.test(vu.journal + vu.r.stderr),
        'alarme de panne sur un simple « non » : ' + vu.journal);
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });

test('import-docx.sh (WSL) : un reconnaisseur en panne est signalé au journal, fr puis de, avant le repli',
  { skip: sansPandocWsl }, () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-reco-'));
    try {
      const pipe = path.join(base, 'pipeline');
      fs.cpSync(PIPE, pipe, { recursive: true });
      fs.writeFileSync(path.join(pipe, 'pronto_docx.py'),
        'raise RuntimeError("panne-provoquee-par-le-test")\n', 'utf8');
      const vu = importer(base, pipe);
      assert.match(vu.journal, /la reconnaissance du gabarit «.Pronto.» est tombée en panne \(code 1\)/, vu.journal);
      assert.match(vu.journal, /\[de\].*Erkennung der Vorlage.*panne-provoquee-par-le-test/s, vu.journal);
      // Le repli a bien eu lieu : docx-meta.py a lu le document, l'article existe.
      assert.strictEqual(vu.r.status, 0, 'le repli sur docx-meta.py a échoué : ' + vu.r.stderr);
      assert.ok(fs.existsSync(path.join(base, 'revue', 'articles', 'essai', 'essai.md')));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
