// Le bloc `mise-en-page:` de buch.yaml, côté livre-assembler.py : la table MISE_EN_PAGE,
// la validation (refus en fr et en de, code de sortie non nul), les attributs posés sur
// <html> et le sommaire (numéro de chapitre, forme hiérarchique). Les filtres qui relisent
// le même bloc sont éprouvés dans test/filtres-pandoc.test.js.
//
//   node --test test/js/livre-mise-en-page.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const gardes = require('./gardes');
const { sansPython } = gardes;

const RACINE = path.resolve(__dirname, '..', '..');
const ASSEMBLEUR = path.join(RACINE, 'pipeline', 'livre-assembler.py');
const GABARIT = path.join(RACINE, 'pipeline', 'templates', 'szh-livre.html');

function python(args) {
  return gardes.pythonGroupe(args, {
    env: Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' }),
  });
}

function dossierJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-mep-'));
}

/// Le contrat, lu dans le fichier même que lisent l'assembleur et szh-commun.lua : les tests le
// citent, ils ne le recopient pas.
const CONTRAT = JSON.parse(fs.readFileSync(
  path.join(RACINE, 'pipeline', 'livre', 'mise-en-page.json'), 'utf8'));
const TABLE = CONTRAT.cles;
const NOMBRES = Object.keys(TABLE).filter((c) => !TABLE[c].valeurs);
function exigerTable() {
  assert.ok(Object.keys(TABLE).length > 0, 'contrat mise-en-page.json vide');
}

// La table que l'assembleur utilise, lue dans le module chargé : elle doit être le contrat.
const LECTEUR_TABLE = [
  'import importlib.util, json, sys',
  "spec = importlib.util.spec_from_file_location('la', sys.argv[1])",
  'la = importlib.util.module_from_spec(spec); spec.loader.exec_module(la)',
  'print(json.dumps({"cles": la.MISE_EN_PAGE, "refus": la.REFUS_MISE_EN_PAGE}))',
].join('\n') + '\n';

// Un fragment de chapitre dans la forme de szh-livre-chapitre.html.
function fragment(slug, numero, titre, opts) {
  const o = opts || {};
  const num = o.numSection ? '<span class="szh-num-section">' + numero + ' </span>' : '';
  const auteurs = o.auteurs ? '<p class="szh-auteurs">' + o.auteurs + '</p>' : '';
  return '<section class="szh-chapitre" id="ch-' + slug + '" style="--c-chapitre: #4D869F;" data-rang="'
    + numero + '">\n<div class="szh-onglet" aria-hidden="true"></div>\n'
    + '<div class="szh-pastille" aria-hidden="true">' + numero + '</div>\n'
    + '<div class="szh-picto-entete" data-picto aria-hidden="true"></div>\n'
    + (o.auteursDessus ? auteurs : '')
    + '<h1 id="' + slug + '-titre">' + num + titre + '</h1>\n'
    + (o.auteursDessus ? '' : auteurs)
    + '<p>Texte.</p>\n<h2 id="' + slug + '-section">Section</h2>\n<p>Texte.</p>\n</section>\n';
}

// Assemble un livre jetable : buch.yaml (en-tête commun + `extra`), deux chapitres.
function assembler(extra, opts) {
  const o = opts || {};
  const d = dossierJetable();
  try {
    const buch = path.join(d, 'buch.yaml');
    fs.writeFileSync(buch, 'titre: "Ein Buch"\nlang: ' + (o.lang || 'de') + '\n'
      + 'liminaires: [sommaire]\n' + extra, 'utf8');
    const frags = (o.fragments || [
      fragment('01-eins', 1, 'Erstes Kapitel', o),
      fragment('02-zwei', 2, 'Zweites Kapitel', Object.assign({}, o, { auteurs: o.auteurs2 })),
    ]).map((t, i) => {
      const f = path.join(d, 'f' + i + '.frag.html');
      fs.writeFileSync(f, t, 'utf8');
      return f;
    });
    const sortie = path.join(d, 'livre.html');
    const r = python([ASSEMBLEUR, '--meta', buch, '--gabarit', GABARIT, '--sortie', sortie,
      '--out', path.join(d, 'out')].concat(frags));
    const html = fs.existsSync(sortie) ? fs.readFileSync(sortie, 'utf8') : null;
    return { status: r.status, stderr: String(r.stderr || ''), html };
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
}

function balise(html) {
  const m = /<html\b[^>]*>/.exec(html || '');
  return m ? m[0] : '';
}

function bloc(lignes) {
  return 'mise-en-page:\n' + Object.entries(lignes).map(([c, v]) => '  ' + c + ': ' + v + '\n').join('');
}

test('mise-en-page : chaque clé du contrat a un défaut permis, chaque nombre ses bornes et sa propriété', () => {
  exigerTable();
  for (const [cle, d] of Object.entries(TABLE)) {
    if (d.valeurs) {
      assert.ok(d.valeurs.length >= 2 && d.valeurs.includes(d.defaut), cle + ' : défaut hors des valeurs');
      assert.strictEqual(d.propriete, undefined, cle);
    } else {
      assert.ok(d.min <= d.defaut && d.defaut <= d.max, cle + ' : défaut hors bornes');
      assert.match(d.propriete, /^--[a-z-]+$/, cle);
    }
  }
  for (const [code, g] of Object.entries(CONTRAT.refus)) {
    assert.ok(g.fr.length > 10 && g.de.length > 10, code + ' : phrase fr ou de absente');
  }
});

test('mise-en-page : l’assembleur ne garde aucune table à lui, il lit le contrat', { skip: sansPython }, () => {
  const d = dossierJetable();
  try {
    const script = path.join(d, 'table.py');
    fs.writeFileSync(script, LECTEUR_TABLE, 'utf8');
    const r = python([script, ASSEMBLEUR]);
    assert.strictEqual(r.status, 0, r.stderr);
    const lu = JSON.parse(r.stdout);
    assert.deepStrictEqual(Object.keys(lu.cles), Object.keys(TABLE), 'ordre des clés');
    assert.deepStrictEqual(lu, { cles: TABLE, refus: CONTRAT.refus });
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('mise-en-page : sans bloc, chaque clé à son défaut sur <html>, les nombres en style', { skip: sansPython }, () => {
  exigerTable();
  const r = assembler('maquette: normal\n');
  assert.strictEqual(r.status, 0, r.stderr);
  const attendu = Object.entries(TABLE).filter(([c]) => !NOMBRES.includes(c))
    .map(([c, d]) => ' data-' + c + '="' + d.defaut + '"').join('');
  const style = NOMBRES.map((c) => TABLE[c].propriete + ': ' + TABLE[c].defaut + 'mm').join('; ');
  assert.strictEqual(balise(r.html), '<html lang="de" class=""' + attendu + ' style="' + style + '">');
});

test('mise-en-page : chaque valeur permise se retrouve en data-<clé> sur <html>', { skip: sansPython }, () => {
  exigerTable();
  for (const [cle, d] of Object.entries(TABLE)) {
    if (NOMBRES.includes(cle)) { continue; }
    for (const v of d.valeurs) {
      const r = assembler(bloc({ [cle]: v }));
      assert.strictEqual(r.status, 0, cle + ': ' + v + ' : ' + r.stderr);
      assert.ok(balise(r.html).includes(' data-' + cle + '="' + v + '"'), cle + ': ' + v + ' -> ' + balise(r.html));
    }
  }
});

test('mise-en-page : les millimètres, entiers, décimaux ou suivis d’un commentaire', { skip: sansPython }, () => {
  const cas = [['7', '--alinea: 7mm'], ['4,5', '--alinea: 4.5mm'], ['0', '--alinea: 0mm'],
    ['15', '--alinea: 15mm'], ['"7"', '--alinea: 7mm'], ['7  # mm', '--alinea: 7mm']];
  for (const [brut, attendu] of cas) {
    const r = assembler(bloc({ 'alinea-mm': brut, 'liste-retrait-mm': 0 }));
    assert.strictEqual(r.status, 0, brut + ' : ' + r.stderr);
    assert.ok(balise(r.html).includes('style="' + attendu + '; --liste-retrait: 0mm"'), brut + ' -> ' + balise(r.html));
  }
});

// Une ligne refusée : format maison, code, champ, phrase fr puis [de].
function exigerRefus(r, code, cle, motif) {
  assert.strictEqual(r.status, 1, 'le livre doit être refusé : ' + r.stderr);
  assert.strictEqual(r.html, null, 'un HTML a été écrit malgré le refus');
  const ligne = r.stderr.split(/\r?\n/).find((l) => l.startsWith('[livre-blocage] ' + code + ' | mise-en-page.' + cle + ' | '));
  assert.ok(ligne, 'ligne de refus absente : ' + r.stderr);
  const champs = ligne.split(' | ');
  assert.strictEqual(champs.length, 4, ligne);
  assert.ok(champs[3].startsWith('[de] ') && champs[3].length > 10, 'phrase allemande absente : ' + ligne);
  assert.ok(champs[2].length > 10, 'phrase française absente : ' + ligne);
  if (motif) { assert.match(ligne, motif); }
}

test('mise-en-page : une valeur inconnue est refusée pour chaque clé, en fr et en de', { skip: sansPython }, () => {
  exigerTable();
  for (const cle of Object.keys(TABLE)) {
    const code = NOMBRES.includes(cle) ? 'mise-en-page-valeur-mm' : 'mise-en-page-valeur';
    exigerRefus(assembler(bloc({ [cle]: 'nimmermehr' })), code, cle, /nimmermehr/);
  }
});

test('mise-en-page : un nombre hors bornes ou illisible est refusé', { skip: sansPython }, () => {
  for (const brut of ['16', '-1', 'sept', '7mm']) {
    const { min, max } = TABLE['liste-retrait-mm'];
    exigerRefus(assembler(bloc({ 'liste-retrait-mm': brut })), 'mise-en-page-valeur-mm', 'liste-retrait-mm',
      new RegExp(min + ' et ' + max + '.*' + min + ' und ' + max));
  }
});

test('mise-en-page : une clé inconnue est refusée', { skip: sansPython }, () => {
  exigerRefus(assembler(bloc({ 'marge-haut': '20' })), 'mise-en-page-cle-inconnue', 'marge-haut');
});

// La valeur annoncée au lot des clés, refusée tant que les parties n'existaient pas.
test('mise-en-page : numeros-chapitres partie est permise, maintenant que les parties existent', { skip: sansPython }, () => {
  const r = assembler(bloc({ 'numeros-chapitres': 'partie' }));
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(balise(r.html).includes(' data-numeros-chapitres="partie"'), balise(r.html));
});

test('mise-en-page : la maquette falc ignore le bloc entier, même fautif', { skip: sansPython }, () => {
  const r = assembler('maquette: falc\n' + bloc({ folio: 'seul', 'cle-inconnue': 'x' }), { lang: 'fr' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.strictEqual(balise(r.html), '<html lang="fr" class="">');
});

function entreesSommaire(html) {
  const s = /<section class="szh-sommaire"[\s\S]*?<\/section>/.exec(html || '');
  return s ? s[0].match(/<li[\s\S]*?<\/li>/g) || [] : [];
}

test('mise-en-page (sommaire) : sans numéro de chapitre, le sommaire n’en imprime pas', { skip: sansPython }, () => {
  const r = assembler('maquette: normal\n');
  assert.strictEqual(r.status, 0, r.stderr);
  const li = entreesSommaire(r.html).filter((l) => /niveau-1/.test(l));
  assert.strictEqual(li.length, 2, r.html);
  assert.match(li[0], /<a href="#01-eins-titre">Erstes Kapitel<\/a>/, li[0]);
});

test('mise-en-page (sommaire) : numeros-chapitres continu, le numéro du sommaire précède le titre', { skip: sansPython }, () => {
  const r = assembler(bloc({ 'numeros-chapitres': 'continu', 'sommaire-niveaux': 2 }), { numSection: true });
  assert.strictEqual(r.status, 0, r.stderr);
  const li = entreesSommaire(r.html);
  assert.match(li[0], /<a href="#01-eins-titre">1 Erstes Kapitel<\/a>/, li[0]);
  assert.ok(li.some((l) => /niveau-2/.test(l)), 'le sommaire plat à deux niveaux garde les sections');
});

test('mise-en-page (sommaire) : hiérarchique, les chapitres seuls avec leurs auteur·e·s', { skip: sansPython }, () => {
  const r = assembler(bloc({ 'numeros-chapitres': 'continu', sommaire: 'hierarchique' }),
    { numSection: true, auteurs: 'Lea Beispiel', auteurs2: 'Noah Probe und Sara Vorlage' });
  assert.strictEqual(r.status, 0, r.stderr);
  const li = entreesSommaire(r.html);
  assert.strictEqual(li.length, 2, 'seuls les chapitres : ' + li.join('\n'));
  assert.strictEqual(li[0], '<li class="niveau-1" style="--c-chapitre: #4D869F"><span>'
    + '<a href="#01-eins-titre">1 Erstes Kapitel</a></span>'
    + '<span class="szh-sommaire-auteurs">Lea Beispiel</span></li>');
  assert.match(li[1], /<span class="szh-sommaire-auteurs">Noah Probe und Sara Vorlage<\/span><\/li>$/, li[1]);
});

test('mise-en-page (sommaire) : les auteur·e·s placés au-dessus du titre sont lus aussi', { skip: sansPython }, () => {
  const r = assembler(bloc({ sommaire: 'hierarchique' }), { auteurs: 'Lea Beispiel', auteursDessus: true });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(entreesSommaire(r.html)[0], /Erstes Kapitel<\/a><\/span><span class="szh-sommaire-auteurs">Lea Beispiel</);
});

test('mise-en-page (sommaire) : le sommaire plat n’imprime pas les auteur·e·s', { skip: sansPython }, () => {
  const r = assembler('maquette: normal\n', { auteurs: 'Lea Beispiel' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!/szh-sommaire-auteurs/.test(r.html), 'auteur·e·s au sommaire plat');
});
