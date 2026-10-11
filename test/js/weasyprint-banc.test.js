// Forme du banc des correctifs WeasyPrint (test/weasyprint-banc/) : chaque bloc de
// cas.toml a son HTML et inversement, n'utilise que des clés connues, du bon type, et ne
// cite que des jetons présents dans son HTML. Sans lancer WeasyPrint : le banc lui-même
// tourne dans la WSL et dans le job pdf-ua.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const RACINE = path.resolve(__dirname, '..', '..');
const BANC = path.join(RACINE, 'test', 'weasyprint-banc');
const CAS = path.join(BANC, 'cas');
const JETON = /^Q\d\d$/;
const VARIANTES = ['ua1', 'tags', 'nu', 'a3u'];

// Lecteur du sous-ensemble de TOML que cas.toml utilise : [bloc], clé = valeur, avec des
// chaînes "…", des entiers, des tableaux et des tables en ligne. Toute autre syntaxe lève.
function lireToml(texte) {
  const blocs = {};
  let courant = null;
  let i = 0;
  const erreur = (m) => { throw new Error(`cas.toml, position ${i} : ${m}`); };
  const blancs = () => {
    for (;;) {
      while (i < texte.length && ' \t\r\n'.includes(texte[i])) i++;
      if (texte[i] !== '#') return;
      while (i < texte.length && texte[i] !== '\n') i++;
    }
  };
  const chaine = () => {
    let s = '';
    i++;
    while (texte[i] !== '"') {
      if (i >= texte.length || texte[i] === '\n') erreur('chaîne non fermée');
      if (texte[i] === '\\') {
        i++;
        const e = { '"': '"', '\\': '\\', n: '\n', t: '\t' }[texte[i]];
        if (e === undefined) erreur(`échappement \\${texte[i]}`);
        s += e;
      } else s += texte[i];
      i++;
    }
    i++;
    return s;
  };
  const cle = () => {
    blancs();
    if (texte[i] === '"') return chaine();
    const m = /^[A-Za-z0-9_-]+/.exec(texte.slice(i));
    if (!m) erreur('clé attendue');
    i += m[0].length;
    return m[0];
  };
  const valeur = () => {
    blancs();
    const c = texte[i];
    if (c === '"') return chaine();
    if (c === '[') {
      i++;
      const t = [];
      for (;;) {
        blancs();
        if (texte[i] === ']') { i++; return t; }
        t.push(valeur());
        blancs();
        if (texte[i] === ',') i++;
        else if (texte[i] !== ']') erreur('« , » ou « ] » attendu');
      }
    }
    if (c === '{') {
      i++;
      const t = {};
      for (;;) {
        blancs();
        if (texte[i] === '}') { i++; return t; }
        const k = cle();
        blancs();
        if (texte[i] !== '=') erreur('« = » attendu');
        i++;
        if (k in t) erreur(`clé ${k} en double`);
        t[k] = valeur();
        blancs();
        if (texte[i] === ',') i++;
        else if (texte[i] !== '}') erreur('« , » ou « } » attendu');
      }
    }
    const m = /^-?\d+/.exec(texte.slice(i));
    if (!m) erreur('valeur inconnue');
    i += m[0].length;
    return Number(m[0]);
  };
  for (;;) {
    blancs();
    if (i >= texte.length) return blocs;
    if (texte[i] === '[') {
      const m = /^\[([A-Za-z0-9_-]+)\]/.exec(texte.slice(i));
      if (!m) erreur('en-tête de bloc');
      if (m[1] in blocs) erreur(`bloc ${m[1]} en double`);
      courant = blocs[m[1]] = {};
      i += m[0].length;
      continue;
    }
    if (!courant) erreur('clé hors bloc');
    const k = cle();
    blancs();
    if (texte[i] !== '=') erreur('« = » attendu');
    i++;
    if (k in courant) erreur(`clé ${k} en double`);
    courant[k] = valeur();
  }
}

// Jetons du texte visible d'un HTML (hors <title>, <style>, <script> et attributs).
function jetonsHtml(source) {
  const texte = source
    .replace(/<(title|style|script)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return new Set(texte.match(/(?<![0-9A-Za-z])Q\d\d(?!\d)/g) || []);
}

const estChaine = (v) => typeof v === 'string' && v.length > 0;
const listeDe = (v, f) => Array.isArray(v) && v.every(f);
const tableDe = (v, f) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  Object.entries(v).every(([k, x]) => f(k, x));

// Clé autorisée → contrôle de sa valeur.
const CLES = {
  titre: estChaine,
  ordres: (v) => listeDe(v, (o) => listeDe(o, (j) => JETON.test(j)) && o.length >= 2),
  langues: (v) => tableDe(v, (k, x) => JETON.test(k) && /^[a-z]{2}$/.test(x)),
  chemins: (v) => tableDe(v, (k, x) => JETON.test(k) && estChaine(x)),
  meme_contenu: (v) => listeDe(v, (o) => listeDe(o, (j) => JETON.test(j)) && o.length >= 2),
  contenus_distincts: (v) => listeDe(v, (o) => listeDe(o, (j) => JETON.test(j)) && o.length >= 2),
  liens: (v) => tableDe(v, (k, x) => estChaine(k) && estChaine(x)),
  figures: (v) => tableDe(v, (k, x) => estChaine(k) && estChaine(x)),
  figures_sans_alt: (v) => Number.isInteger(v) && v > 0,
  vera_ua1: (v) => listeDe(v, (c) => /^\d+(\.\d+)*-\d+$/.test(c)),
  vera_ua1_exige: (v) => listeDe(v, (c) => /^\d+(\.\d+)*-\d+$/.test(c)),
  info_author: estChaine,
  dc_language: (v) => listeDe(v, (x) => /^[a-z]{2}$/.test(x)),
  doublons_admis: (v) => listeDe(v, (j) => JETON.test(j)),
  dans_arbre: (v) => listeDe(v, (j) => JETON.test(j)),
  tolere: (v) => listeDe(v, (x) => /^[a-z_]+$/i.test(x)),
  connus: (v) => tableDe(v, (k, x) => VARIANTES.includes(k) && listeDe(x, estChaine)),
};

const toml = fs.readFileSync(path.join(CAS, 'cas.toml'), 'utf8');
const blocs = lireToml(toml);
const htmls = fs.readdirSync(CAS).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5));

test('chaque HTML du banc a son bloc dans cas.toml, et chaque bloc son HTML', () => {
  assert.deepStrictEqual(Object.keys(blocs).sort(), [...htmls].sort());
  assert.ok(htmls.length >= 20, `${htmls.length} cas seulement`);
});

for (const [nom, bloc] of Object.entries(blocs)) {
  test(`cas ${nom} : clés connues, valeurs bien formées, jetons présents`, () => {
    assert.ok('titre' in bloc, 'titre manquant');
    for (const [k, v] of Object.entries(bloc)) {
      assert.ok(k in CLES, `clé inconnue : ${k}`);
      assert.ok(CLES[k](v), `valeur mal formée pour ${k} : ${JSON.stringify(v)}`);
    }
    const source = fs.readFileSync(path.join(CAS, `${nom}.html`), 'utf8');
    assert.match(source, /<html lang="[a-z]{2}"/, 'langue du document absente');
    assert.match(source, /<meta charset="utf-8">/i);
    const jetons = jetonsHtml(source);
    const cites = [
      ...(bloc.ordres || []).flat(), ...Object.keys(bloc.langues || {}),
      ...Object.keys(bloc.chemins || {}), ...(bloc.doublons_admis || []),
      ...(bloc.dans_arbre || []), ...(bloc.meme_contenu || []).flat(),
      ...(bloc.contenus_distincts || []).flat(),
    ];
    for (const j of cites) assert.ok(jetons.has(j), `${j} absent du texte de ${nom}.html`);
    for (const m of source.matchAll(/<link [^>]*href="([^"]+)"/g)) {
      assert.ok(fs.existsSync(path.join(CAS, m[1])), `feuille absente : ${m[1]}`);
    }
  });
}

test('le banc et le venv de développement épinglent le même pypdfium2', () => {
  const banc = fs.readFileSync(path.join(BANC, 'banc.py'), 'utf8').match(/^PYPDFIUM = '(pypdfium2==[^']+)'$/m);
  const dev = fs.readFileSync(path.join(RACINE, 'outils-dev', 'venv-dev.sh'), 'utf8').match(/pypdfium2==\S+/);
  assert.ok(banc && dev);
  assert.strictEqual(banc[1], dev[0]);
});

test('le lecteur de cas.toml refuse une syntaxe qu\'il ne connaît pas', () => {
  assert.throws(() => lireToml('[a]\nx = 1.5e3\n'));
  assert.throws(() => lireToml('[a]\nx = "ouvert\n'));
  assert.throws(() => lireToml('[a]\nx = 1\nx = 2\n'));
  assert.deepStrictEqual(lireToml('[a] # c\nx = { "u" = ["Q01"] }\n'), { a: { x: { u: ['Q01'] } } });
});
