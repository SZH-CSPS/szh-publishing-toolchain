// La numérotation automatique des titres Word survit-elle à l'import ?
//
//   node --test "test/js/*.test.js"
//
// docs/REPRISE-LIVRES.md §2.5 le donnait pour vrai sans qu'un vrai aller-retour l'ait
// jamais mesuré : « il a été affirmé que pandoc retire cette numérotation à l'import [...]
// mais personne ne l'a constaté sur un vrai aller-retour ».
//
// Le modèle livre-template/Modele-chapitre-SZH.docx numérote ses titres (1., 1.1, 1.1.1) :
// vérifié sur ce .docx lui-même (un .docx est un zip), les styles Heading1/2/3 de
// word/styles.xml portent chacun w:numId=1, et word/numbering.xml définit ce numId avec
// w:numFmt=decimal et w:lvlText « %1. », « %1.%2. », « %1.%2.%3. ». C'est donc bien le
// STYLE qui numérote (numPr), jamais le texte des runs — word/document.xml porte des
// titres nus : « Introduction », « Première sous-section », etc.
//
// Ce contrôle fait le vrai aller-retour, par la chaîne réelle : import-docx.sh, le même
// script pour un article ou un chapitre de livre (pipeline/profils/livre.mk : « un
// chapitre se compile comme un article. Même `cd` dans son dossier, même suite de
// filtres »). Constat, sur ce document : les numéros ne survivent pas — pandoc ne
// restitue jamais dans le texte la numérotation portée par numPr. Ce test fige ce
// constat pour qu'il n'ait plus à être refait au jugé.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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

let pandocVu = null;
function pandocAbsent() {
  if (pandocVu !== null) { return pandocVu; }
  let r;
  try { r = wsl(['sh', '-c', 'command -v pandoc && command -v python3']); }
  catch (e) { pandocVu = 'wsl.exe injoignable : ' + e.message; return pandocVu; }
  if (r.error) { pandocVu = 'wsl.exe injoignable : ' + r.error.message; }
  else if (r.status !== 0) { pandocVu = 'pandoc ou python3 introuvable dans la distro ' + DISTRO; }
  else { pandocVu = null; }
  return pandocVu;
}

test('.docx du modèle : les titres sont numérotés par le style, pas par le texte', (t) => {
  // Prémisse à ne pas supposer : si le modèle ne numérotait plus ses titres, ce contrôle
  // n'aurait plus d'objet. Un .docx est un zip ; on le lit avec le zipfile de Python, dans
  // la distro WSL de la chaîne — aucune dépendance zip n'existe côté Node de ce dépôt.
  const absent = pandocAbsent();
  if (absent) {
    console.warn('\n*** prémisse non vérifiée : ' + absent + ' ***\n');
    return t.skip(absent);
  }
  const programme = [
    'import sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'sys.stdout.write(z.read("word/styles.xml").decode("utf-8"))',
    'sys.stdout.write("\\x00")',
    'sys.stdout.write(z.read("word/numbering.xml").decode("utf-8"))'
  ].join('\n');
  const r = wsl(['python3', '-c', programme, cheminVersWsl(MODELE)]);
  assert.strictEqual(r.status, 0, 'lecture du .docx (zip) via WSL : ' + r.stderr);
  const [styles, numbering] = r.stdout.split('\x00');

  const numId = /<w:style [^>]*w:styleId="Heading1"[^>]*>[\s\S]*?<w:numId w:val="(\d+)"/
    .exec(styles);
  assert.ok(numId, 'Heading1 ne référence plus de numérotation automatique (w:numId) — '
    + 'la prémisse de ce contrôle ne tient plus, à revoir avec docs/REPRISE-LIVRES.md §2.5');
  assert.match(numbering, /<w:lvlText w:val="%1\."/,
    'le format de numérotation attendu (« %1. ») a changé dans le modèle');
});

test('import-docx.sh : la numérotation automatique des titres Word ne survit pas à l’import', (t) => {
  const absent = pandocAbsent();
  if (absent) {
    console.warn('\n*** aller-retour non vérifié : ' + absent + ' ***\n');
    return t.skip(absent);
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
