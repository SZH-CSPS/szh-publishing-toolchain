// Un article importé sans bibliographie reçoit désormais <slug>.biblio.md quand même —
// vide — et son marqueur en fin de texte ; un fichier vide n'imprime rien à la
// compilation, ni titre, ni section, ni cadre. Voir pipeline/filters/szh-biblio-detacher.lua
// et pipeline/filters/szh-citations.lua (fonction est_vide, exposée sur SZH_CITATIONS).
//
//   node --test "test/js/*.test.js"
//
// CE QUI NE DOIT PAS SE CONFONDRE, et que ce fichier éprouve séparément :
//   * un fichier de bibliographie VIDE (ou seulement des blancs, y compris les blancs
//     invisibles que la typographie maison pose partout — insécable U+00A0, espace fine
//     insécable U+202F, BOM U+FEFF) est un état NORMAL et silencieux, comme si l'article
//     n'avait jamais eu de bibliographie ;
//   * un fichier ABSENT reste l'anomalie que « biblio-introuvable » signale toujours —
//     l'encadré rouge de szh-citations.lua ne doit RIEN perdre de sa portée.
//
// Exécuté directement avec `pandoc lua`, sans passer par wsl.exe : pandoc embarque son
// propre interprète Lua (voir reimport-biblio.test.js, qui mesure pandoc de la même façon
// pour la même raison — ces contrôles tournent en local, pas dans une distribution). Un
// poste sans pandoc sur le PATH saute ces contrôles, bruyamment, jamais en silence.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const { sauter, sansPandoc } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const DETACHEUR = path.join(RACINE, 'pipeline', 'filters', 'szh-biblio-detacher.lua');
const CITATIONS = path.join(RACINE, 'pipeline', 'filters', 'szh-citations.lua');

const LF = String.fromCharCode(10);

// Détection centralisée (test/js/gardes.js, sansPandoc). SZH_LUA_OBLIGATOIRE, distinct de
// SZH_PANDOC_OBLIGATOIRE (gardes.js) : un poste sans pandoc peut être un poste normal, mais
// une CI qui tourne ces contrôles-là ne doit jamais se contenter d'un saut.
function sauterSansPandoc(t, raison) {
  if (process.env.SZH_LUA_OBLIGATOIRE) { assert.fail('Lua non vérifié : ' + raison); }
  console.warn('\n*** Lua non vérifié : ' + raison + ' — le filtre n’est pas éprouvé en '
    + 'exécution ***\n');
  sauter.pandoc(t);
}

function lancerLua(dossier, script, args) {
  const fHarnais = path.join(dossier, 'harnais.lua');
  fs.writeFileSync(fHarnais, script, 'utf8');
  return cp.spawnSync('pandoc', ['lua', fHarnais].concat(args || []),
    { cwd: dossier, encoding: 'utf8', env: Object.assign({}, process.env, { SZH_SLUG: 'essai' }) });
}

// ---- szh-biblio-detacher.lua : le fichier se crée vide, même sans bibliographie -------

const HARNAIS_DETACHEUR = [
  'local filtre = arg[1]',
  'dofile(filtre)',
  'local doc = pandoc.Pandoc({ pandoc.Para({ pandoc.Str("Texte.") }) })',
  'local resultat = Pandoc(doc)',
  'if resultat == nil then print("NIL") ; os.exit(0) end',
  'print("BLOCS " .. #resultat.blocks)',
  'for i, b in ipairs(resultat.blocks) do',
  '  if b.t == "Div" then',
  '    print("DIV " .. i .. " " .. table.concat(b.classes, ",") .. " src=" .. (b.attributes["src"] or ""))',
  '  else',
  '    print("BLOC " .. i .. " " .. b.t)',
  '  end',
  'end'
].join(LF) + LF;

test('szh-biblio-detacher : sans bibliographie dans le Word, le fichier se crée vide',
  (t) => {
    const absent = sansPandoc;
    if (absent) { return sauterSansPandoc(t, absent); }
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-biblio-vide-'));
    try {
      // SZH_META absent : aucune ligne B, comme un Word qui n'a pas de bibliographie.
      const r = lancerLua(dossier, HARNAIS_DETACHEUR, [DETACHEUR]);
      assert.strictEqual(r.status, 0, 'harnais Lua sorti en ' + r.status + ' : ' + r.stderr);
      assert.doesNotMatch(r.stdout, /^NIL/m,
        'le filtre ne rend plus de document : le fichier et son marqueur ont disparu');
      // Le marqueur rejoint la fin de l'article — le texte d'origine reste devant lui.
      assert.match(r.stdout, /BLOC 1 Para/);
      assert.match(r.stdout, /DIV 2 szh-biblio src=essai\.biblio\.md/,
        'le marqueur n’est pas posé en fin d’article, avec le bon src=');
      assert.ok(fs.existsSync(path.join(dossier, 'essai.biblio.md')),
        'le fichier de bibliographie n’a pas été créé');
      assert.strictEqual(fs.readFileSync(path.join(dossier, 'essai.biblio.md'), 'utf8'), '',
        'le fichier créé sans bibliographie dans le Word n’est pas vide');
      // Aucun avertissement : cet état est normal, pas une anomalie.
      assert.strictEqual(r.stderr.trim(), '', 'un fichier créé silencieusement ne doit rien dire : ' + r.stderr);
    } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
  });

// ---- szh-citations.lua : est_vide(), sur les mêmes blancs que la typographie maison ---

const HARNAIS_EST_VIDE = [
  'local filtre = arg[1]',
  'dofile(filtre)',
  'local S = SZH_CITATIONS',
  'local cas = { "", "   \\t\\n\\n  ", "\\u{00A0}", "\\u{202F}", "\\u{FEFF}",',
  '  "\\u{FEFF}\\u{00A0} \\n\\u{202F}\\t", "Dupont, A. (2024).", "\\u{00A0}Dupont\\u{00A0}" }',
  'for _, c in ipairs(cas) do print(tostring(S.est_vide(c))) end'
].join(LF) + LF;

test('szh-citations : est_vide() efface l’insécable, l’espace fine et le BOM', (t) => {
  const absent = sansPandoc;
  if (absent) { return sauterSansPandoc(t, absent); }
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-est-vide-'));
  try {
    const r = lancerLua(dossier, HARNAIS_EST_VIDE, [CITATIONS]);
    assert.strictEqual(r.status, 0, 'harnais Lua sorti en ' + r.status + ' : ' + r.stderr);
    const lignes = r.stdout.trim().split(/\r?\n/);
    assert.deepStrictEqual(lignes,
      ['true', 'true', 'true', 'true', 'true', 'true', 'false', 'false'],
      'est_vide() ne reconnaît plus tous les blancs, visibles ou non');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

// ---- intégration : un fichier vide n'imprime rien, un fichier absent avertit ----------

const HARNAIS_RESOLUTION = [
  'local filtre, cas = arg[1], arg[2]',
  'dofile(filtre)',
  'if cas == "vide" then local f = io.open("essai.biblio.md", "w") f:close()',
  'elseif cas == "blanc" then local f = io.open("essai.biblio.md", "w")',
  '  f:write("\\u{00A0}\\u{FEFF}\\n \\t\\n") f:close()',
  'elseif cas == "contenu" then local f = io.open("essai.biblio.md", "w")',
  '  f:write("Dupont, A. (2024). Un titre.\\n") f:close()',
  'elseif cas == "absent" then os.remove("essai.biblio.md") end',
  'local marqueur = pandoc.Div({}, pandoc.Attr("", {"szh-biblio"}, {{"src", "essai.biblio.md"}}))',
  'local doc = pandoc.Pandoc({ pandoc.Para({pandoc.Str("Texte.")}), marqueur }, pandoc.Meta({}))',
  'local resultat = Pandoc(doc)',
  'print("BLOCS " .. #resultat.blocks)',
  'for i, b in ipairs(resultat.blocks) do',
  '  if b.t == "Div" then print("DIV " .. table.concat(b.classes, ","))',
  '  elseif b.t == "Header" then print("HEADER " .. pandoc.utils.stringify(b))',
  '  else print(b.t) end',
  'end'
].join(LF) + LF;

function resoudre(dossier, cas) {
  return lancerLua(dossier, HARNAIS_RESOLUTION, [CITATIONS, cas]);
}

test('szh-citations : un fichier de bibliographie vide n’imprime rien, sans avertissement',
  (t) => {
    const absent = sansPandoc;
    if (absent) { return sauterSansPandoc(t, absent); }
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-resolution-'));
    try {
      const r = resoudre(dossier, 'vide');
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stdout, /BLOCS 1/, 'un fichier vide a quand même laissé quelque chose derrière lui');
      assert.doesNotMatch(r.stderr, /biblio-introuvable|szh-biblio-manquante/,
        'un fichier présent mais vide déclenche l’avertissement prévu pour un fichier absent');
    } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
  });

test('szh-citations : un fichier fait seulement de blancs invisibles n’imprime rien non plus',
  (t) => {
    const absent = sansPandoc;
    if (absent) { return sauterSansPandoc(t, absent); }
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-resolution-'));
    try {
      const r = resoudre(dossier, 'blanc');
      assert.strictEqual(r.status, 0, r.stderr);
      assert.match(r.stdout, /BLOCS 1/,
        'un fichier de blancs invisibles a laissé un paragraphe ou un titre derrière lui');
      assert.doesNotMatch(r.stderr, /biblio-introuvable|szh-biblio-manquante/);
    } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
  });

test('szh-citations : un fichier de bibliographie ABSENT reste signalé comme avant', (t) => {
  const absent = sansPandoc;
  if (absent) { return sauterSansPandoc(t, absent); }
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-resolution-'));
  try {
    const r = resoudre(dossier, 'absent');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /DIV szh-biblio-manquante/,
      'l’encadré rouge de « bibliographie introuvable » a disparu pour un fichier absent');
    assert.match(r.stderr, /biblio-introuvable/,
      'l’avertissement « bibliographie introuvable » ne part plus');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('szh-citations : une vraie bibliographie continue de s’imprimer avec son titre', (t) => {
  const absent = sansPandoc;
  if (absent) { return sauterSansPandoc(t, absent); }
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-resolution-'));
  try {
    const r = resoudre(dossier, 'contenu');
    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stdout, /HEADER Références/,
      'une bibliographie non vide n’imprime plus son titre');
    assert.match(r.stdout, /BLOCS 3/);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});
