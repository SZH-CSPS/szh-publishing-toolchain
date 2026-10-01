// Signets, /Info /Title et dc:language des PDF, lus par pypdf sur une vraie compilation (WSL).
//
//   node --test test/js/signets-xmp.test.js
//
// Ce que ce fichier tient :
//   1. un article dont le titre est coupé en escalier (<br> posé par szh-titre-lignes.lua) a
//      un signet aux mots séparés, et un /Title sans retour à la ligne ;
//   2. un chapitre de livre à titre « A // B » donne le signet « A B », dans le PDF du
//      chapitre comme dans le livre assemblé, et les /Title sont à plat ;
//   3. le XMP porte dc:language dans la langue du document (fr, de), si le WeasyPrint qui
//      compile a le correctif 40-xmp-dc-language (image/patches/) ;
//   4. dc:description d'un article est à plat, sans le repli à 72 colonnes de pandoc ;
//   5. xmp:CreatorTool nomme Pronto, pour l'article comme pour le livre.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const DISTRO = 'SZH-Publishing';

function cheminVersWsl(p) {
  const abs = path.resolve(p).replace(/\\/g, '/');
  const m = abs.match(/^([A-Za-z]):\/(.*)$/);
  return m ? '/mnt/' + m[1].toLowerCase() + '/' + m[2] : abs;
}

function wsl(args) {
  const wslExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wsl.exe');
  return cp.spawnSync(fs.existsSync(wslExe) ? wslExe : 'wsl.exe', ['-d', DISTRO, '--'].concat(args),
    { encoding: 'utf8', windowsHide: true, timeout: 900000 });
}

function ecrire(chemin, contenu) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, contenu, 'utf8');
}

// Signets (titre et niveau), /Title, et dc:language, dc:description, xmp:CreatorTool du XMP.
const LIRE_PDF = [
  'import json, sys',
  'from pypdf import PdfReader',
  'sortie = {}',
  'for chemin in sys.argv[1:]:',
  '    r = PdfReader(chemin)',
  '    signets = []',
  '    def marche(o, n):',
  '        for x in o:',
  '            if isinstance(x, list): marche(x, n + 1)',
  '            else: signets.append([n, x.title])',
  '    marche(r.outline, 0)',
  '    x = r.xmp_metadata',
  '    sortie[chemin] = {"signets": signets, "titre": (r.metadata or {}).get("/Title"),',
  '                      "langues": x.dc_language, "description": x.dc_description,',
  '                      "outil": x.xmp_creator_tool}',
  'print(json.dumps(sortie))'
].join('\n');

const plat = (s) => String(s).replace(/\u00a0/g, ' ');

// Deux titres réels du banc : le premier se coupe en escalier ET dépasse la ligne de 72
// colonnes où pandoc replie le <title> ; le second se coupe en escalier.
const TITRE_FR = 'Directive de la Commission suisse de maturité sur les mesures de compensation des désavantages au gymnase';
const TITRE_DE = 'Sprachunterstützende Massnahmen im Teamteaching';
// Résumé de l'article allemand, plus long que les 72 colonnes du repli de pandoc.
const RESUME_DE = 'Zwei Lehrpersonen planen den Unterricht gemeinsam und beobachten '
  + 'die Sprachentwicklung ihrer Klasse während eines ganzen Schuljahres';
const OUTIL = 'Pronto, open-source publishing software by SZH/CSPS';
const PATCH_LANGUE = '40-xmp-dc-language.patch';

// Une seule compilation pour tous les cas : un numéro (article fr, article de) et une copie
// de test/livre-normal dont le livre et le premier chapitre ont un titre « A // B ».
let base = null;
let lu = null;
let echec = null;
function compiler() {
  if (echec) { throw echec; }
  if (!lu) {
    try { lu = compilerUneFois(); } catch (e) { echec = e; throw e; }
  }
  return lu;
}

function compilerUneFois() {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-signets-'));
  const num = path.join(base, 'num');
  ecrire(path.join(num, 'ausgabe.yaml'),
    'title: "Essai"\nrevue: revue\nvolume: "1"\nnumero: "1"\ndate: "2026"\ncouleur: "#5F9FBC"\n');
  ecrire(path.join(num, 'articles', 'af', 'af.meta.yaml'),
    'type: article\nlang: fr\ntitle:\n  fr: "' + TITRE_FR + '"\n');
  ecrire(path.join(num, 'articles', 'af', 'af.md'), '# Introduction\n\nTexte.\n');
  ecrire(path.join(num, 'articles', 'ad', 'ad.meta.yaml'),
    'type: article\nlang: de\ntitle:\n  de: "' + TITRE_DE + '"\nresume:\n  de: "' + RESUME_DE + '"\n');
  ecrire(path.join(num, 'articles', 'ad', 'ad.md'), '# Einleitung\n\nText.\n');

  const livre = path.join(base, 'livre');
  fs.cpSync(path.join(RACINE, 'test', 'livre-normal'), livre, { recursive: true,
    filter: (src) => path.basename(src) !== 'out' });
  const buch = path.join(livre, 'buch.yaml');
  fs.writeFileSync(buch, fs.readFileSync(buch, 'utf8')
    .replace(/^titre: .*$/m, 'titre: "Berufliche // Teilhabe von Erwachsenen"'));
  const fiche = path.join(livre, 'chapitres', '01-einleitung', '01-einleitung.meta.yaml');
  fs.writeFileSync(fiche, fs.readFileSync(fiche, 'utf8').replace('de: "Einleitung"', 'de: "Ein // Leitung"'));

  const mk = cheminVersWsl(path.join(RACINE, 'pipeline', 'Makefile'));
  const script = [
    'set -e',
    'cd "' + cheminVersWsl(num) + '"',
    'make -f "' + mk + '" out/af/af.pdf out/ad/ad.pdf',
    'cd "' + cheminVersWsl(livre) + '"',
    'make -f "' + mk + '" livre-pdf',
    'make -f "' + mk + '" livre-chapitre-pdf CHAPITRE=01-einleitung'
  ].join('\n');
  const rMake = wsl(['bash', '-c', script]);
  assert.ok(!rMake.error, 'WSL injoignable : ' + (rMake.error && rMake.error.message));
  assert.strictEqual(rMake.status, 0, 'la compilation a échoué : ' + rMake.stdout + rMake.stderr);

  const pdf = {
    af: path.join(num, 'out', 'af', 'af.pdf'),
    ad: path.join(num, 'out', 'ad', 'ad.pdf'),
    livre: path.join(livre, 'out', 'livre.pdf'),
    chapitre: path.join(livre, 'out', 'chapitres', '01-einleitung.pdf')
  };
  const rLire = wsl(['/opt/weasyprint/bin/python3', '-c', LIRE_PDF].concat(Object.values(pdf).map(cheminVersWsl)));
  assert.strictEqual(rLire.status, 0, 'lecture par pypdf échouée : ' + rLire.stderr);
  const brut = JSON.parse(rLire.stdout.trim());
  const parCle = {};
  for (const cle of Object.keys(pdf)) { parCle[cle] = brut[cheminVersWsl(pdf[cle])]; }

  // Correctifs posés sur le WeasyPrint que le Makefile appelle : témoin szh-patchs.txt écrit
  // par image/patch-weasyprint.sh, à côté du paquet du python lu sur la ligne #! du script.
  // En fichier : wsl.exe repasse ses arguments par un shell, qui mangerait les $.
  const temoin = path.join(base, 'patchs.sh');
  ecrire(temoin, 'w=$(command -v "${WEASYPRINT:-weasyprint}")\n'
    + 'py=$(sed -n \'1s/^#!//p\' "$w")\n'
    + '"$py" -c \'import os, weasyprint\n'
    + 'f = os.path.join(os.path.dirname(weasyprint.__file__), "szh-patchs.txt")\n'
    + 'print(open(f).read() if os.path.exists(f) else "")\'\n');
  const rPatchs = wsl(['bash', cheminVersWsl(temoin)]);
  assert.strictEqual(rPatchs.status, 0, 'témoin des correctifs illisible : ' + rPatchs.stderr);
  parCle.patchs = rPatchs.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  return parCle;
}

test.after(() => { if (base) { fs.rmSync(base, { recursive: true, force: true }); } });

const ARTICLES = [['af', TITRE_FR, 'fr'], ['ad', TITRE_DE, 'de']];

test('article coupé en escalier : le signet du titre garde ses espaces', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  for (const [cle, titre] of ARTICLES) {
    const s = compiler()[cle].signets[0];
    assert.deepStrictEqual([s[0], plat(s[1])], [0, titre], cle + ' : signet du titre ' + JSON.stringify(s));
  }
});

test('article : /Info /Title à plat, sans retour à la ligne', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  for (const [cle, titre] of ARTICLES) {
    const d = compiler()[cle];
    assert.strictEqual(plat(d.titre), titre, cle + ' : /Info /Title ' + JSON.stringify(d.titre));
  }
});

test('chapitre « A // B » : signet « A B » dans le PDF du chapitre et dans le livre', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  for (const cle of ['livre', 'chapitre']) {
    const signets = compiler()[cle].signets;
    const s = signets.find((x) => /Leitung/.test(x[1]));
    assert.ok(s, cle + ' : signet du chapitre introuvable : ' + JSON.stringify(signets));
    assert.strictEqual(plat(s[1]), '1 Ein Leitung', cle + ' : signet du chapitre');
  }
});

test('livre et chapitre : /Info /Title à plat', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  assert.strictEqual(plat(compiler().livre.titre), 'Berufliche Teilhabe von Erwachsenen');
  assert.strictEqual(plat(compiler().chapitre.titre), '1 Ein Leitung — Berufliche Teilhabe von Erwachsenen');
});

test('XMP : dc:language dit la langue du document', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  if (!compiler().patchs.includes(PATCH_LANGUE)) {
    // Le WeasyPrint de la WSL ne le reçoit qu'à la reconstruction de l'image.
    t.skip('correctif WeasyPrint absent : ' + PATCH_LANGUE);
    return;
  }
  const attendu = { af: ['fr'], ad: ['de'], livre: ['de'], chapitre: ['de'] };
  for (const cle of Object.keys(attendu)) {
    assert.deepStrictEqual(compiler()[cle].langues, attendu[cle], cle + ' : dc:language');
  }
});

test('XMP : dc:description d\'un article à plat, sans retour à la ligne', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  const d = compiler().ad.description;
  assert.ok(d && typeof d['x-default'] === 'string', 'ad : dc:description ' + JSON.stringify(d));
  assert.strictEqual(plat(d['x-default']), RESUME_DE, 'ad : dc:description');
});

test('XMP : xmp:CreatorTool nomme Pronto (article, livre, chapitre)', (t) => {
  if (sansPandocWsl) { sauter.wsl(t); return; }
  for (const cle of ['af', 'ad', 'livre', 'chapitre']) {
    assert.strictEqual(compiler()[cle].outil, OUTIL, cle + ' : xmp:CreatorTool');
  }
});
