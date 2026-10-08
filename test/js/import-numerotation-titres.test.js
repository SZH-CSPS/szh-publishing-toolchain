// La numérotation automatique des titres Word ne survit pas à l'import : pandoc ne
// restitue pas dans le texte la numérotation portée par le style (numPr).
//
//   node --test "test/js/*.test.js"
//
// Le modèle livre-template/Modele-chapitre-SZH.docx numérote ses titres (1., 1.1, 1.1.1)
// par ses styles : Heading1/2/3 de word/styles.xml portent w:numId=1, défini dans
// word/numbering.xml (w:lvlText « %1. », « %1.%2. », « %1.%2.%3. »). Le texte des titres,
// dans word/document.xml, est nu.
//
// Le contrôle passe par la chaîne réelle, import-docx.sh, la même pour un article et pour
// un chapitre de livre.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { python, sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const DISTRO = 'SZH-Publishing';
const MODELE = path.join(RACINE, 'livre-template', 'Modele-chapitre-SZH.docx');
const PIPE = path.join(RACINE, 'pipeline');

function cheminVersWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function wsl(args) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe',
    ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

// SZH_WSL_OBLIGATOIRE via gardes.js en fait un échec au chargement du module.

test(".docx du modèle : les titres sont numérotés par le style, pas par le texte", (t) => {
  // Prémisse : le modèle numérote bien ses titres. Le .docx (un zip) est lu par le zipfile
  // de Python dans la WSL, le dépôt n'ayant pas de bibliothèque zip côté Node.
  if (sansPandocWsl) {
    console.warn("\n*** prémisse non vérifiée : " + sansPandocWsl + " ***\n");
    return sauter.wsl(t);
  }
  const programme = [
    'import sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'sys.stdout.write(z.read("word/styles.xml").decode("utf-8"))',
    'sys.stdout.write("\\x00")',
    'sys.stdout.write(z.read("word/numbering.xml").decode("utf-8"))'
  ].join('\n');
  const r = python(['-c', programme, MODELE], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, 'lecture du .docx (zip) via WSL : ' + r.stderr);
  const [styles, numbering] = r.stdout.split('\x00');

  const numId = /<w:style [^>]*w:styleId="Heading1"[^>]*>[\s\S]*?<w:numId w:val="(\d+)"/
    .exec(styles);
  assert.ok(numId, 'Heading1 ne référence plus de numérotation automatique (w:numId) — '
    + 'la prémisse de ce contrôle ne tient plus');
  assert.match(numbering, /<w:lvlText w:val="%1\."/,
    'le format de numérotation attendu (« %1. ») a changé dans le modèle');
});

test("import-docx.sh : la numérotation automatique des titres Word ne survit pas à l’import", (t) => {
  if (sansPandocWsl) {
    console.warn("\n*** aller-retour non vérifié : " + sansPandocWsl + " ***\n");
    return sauter.wsl(t);
  }
  assert.ok(fs.existsSync(MODELE), 'le modèle de chapitre a disparu : ' + MODELE);

  const chantier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-numerotation-titres-'));
  const pipe = cheminVersWsl(PIPE);
  const docxWsl = cheminVersWsl(MODELE);
  const rr = wsl(['sh', '-c',
    'cd ' + JSON.stringify(cheminVersWsl(chantier))
    + ' && PYTHONIOENCODING=utf-8 bash ' + JSON.stringify(pipe + '/import-docx.sh')
    + ' ' + JSON.stringify(docxWsl) + ' modele-chapitre-szh ' + JSON.stringify(pipe)]);
  assert.strictEqual(rr.status, 0, 'import en échec : ' + rr.stderr);

  const md = fs.readFileSync(
    path.join(chantier, 'articles', 'modele-chapitre-szh', 'modele-chapitre-szh.md'), 'utf8');
  const titres = md.split('\n').filter((l) => /^#{1,6}\s/.test(l));
  // Le modèle porte cinq titres stylés : Introduction, Première sous-section,
  // Sous-sous-section, Deuxième sous-section, Conclusion.
  assert.ok(titres.length >= 5,
    'le modèle attendu porte au moins 5 titres, il en manque au .md produit :\n' + md);
  const numerotes = titres.filter((l) => /^#{1,6}\s+\**\s*\d+(\.\d+)*[.):]?\s/.test(l));
  assert.deepStrictEqual(numerotes, [],
    'la numérotation automatique du style Word a survécu à l’import — un livre sortirait '
    + 'avec des titres doublement numérotés : ' + numerotes.join(' | '));
});
