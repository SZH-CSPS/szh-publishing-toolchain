// Crédits entre parenthèses et note sous une figure ou un tableau : ce qu'écrivent
// szh-numerotation.lua et szh-legende-avant.lua, avec pandoc.
//
//   node --test test/filtres-note-credits.test.js
//
// Hors du glob `test/js/*.test.js`, comme filtres-pandoc.test.js : il demande pandoc, que
// le job `contrats` de la CI n'installe pas. Le job `pdf-ua` le lance.
// Les assertions portent sur le HTML brut écrit par les filtres (légende, <p> de note,
// aria-describedby) et sur des positions relatives, pas sur le reste du document, qui
// dépend de la version de pandoc.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const FILTRES = path.resolve(__dirname, '..', 'pipeline', 'filters');
const FINE = ' ';

// HTML produit par la chaîne pour `md` : figure, numérotation, puis légende avant l'image.
// Le lecteur markdown construit lui-même les Figure à partir des images légendées.
function html(md, meta) {
  const entree = (meta ? '---\n' + meta + '\n---\n\n' : '') + md;
  const args = ['--from=markdown', '--to=html', '--wrap=none',
    '--lua-filter=' + path.join(FILTRES, 'szh-grille.lua'),
    '--lua-filter=' + path.join(FILTRES, 'szh-numerotation.lua'),
    '--lua-filter=' + path.join(FILTRES, 'szh-legende-avant.lua')];
  const r = spawnSync('pandoc', args, { input: entree, encoding: 'utf8' });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout.replace(/\r\n/g, '\n');
}

const pos = (h, motif) => h.search(motif);

test('figure : légende, © | source et note — crédit entre parenthèses, note après l’image', () => {
  const h = html('![Un titre](a.png){alt="desc" copyright="© SZH" source="ESA" note="Données 2025."}\n');
  assert.match(h, /Figure 1 —<\/span> Un titre <span class="szh-credit">\(© SZH \| ESA\)<\/span>/, h);
  assert.ok(!/Source\s*:/.test(h), 'l’étiquette « Source : » est revenue : ' + h);
  const note = h.match(/<p class="szh-bloc-note" id="(szh-bloc-note-\d+)">/);
  assert.ok(note, 'aucun <p class="szh-bloc-note"> : ' + h);
  assert.match(h, new RegExp('<span class="szh-bloc-note-etiquette">Note</span>' + FINE
    + ': Données 2025\\.</p>'), 'étiquette seule en classe, deux-points hors du span : ' + h);
  const img = h.match(/<img[^>]*>/)[0];
  assert.ok(img.includes('aria-describedby="' + note[1] + '"'), 'l’image ne référence pas la note : ' + img);
  assert.ok(!/data-note/.test(h), 'la note est restée en attribut : ' + h);
  assert.ok(pos(h, /<figcaption>/) < pos(h, /<img/) && pos(h, /<img/) < pos(h, /szh-bloc-note"/)
    && pos(h, /szh-bloc-note"/) < pos(h, /<\/figure>/),
    'ordre attendu légende, image, note, dans la <figure> : ' + h);
  assert.ok(!/class="szh-note/.test(h), 'la classe des notes de bas de page a été prise : ' + h);
});

test('figure : source seule entre parenthèses, sans ©', () => {
  const h = html('![Un titre](a.png){alt="d" source="Office fédéral"}\n');
  assert.match(h, /<span class="szh-credit">\(Office fédéral\)<\/span>/, h);
  assert.ok(!h.includes('©'), h);
});

test('figure : le © n’est ajouté que s’il manque ; (c) de tête devient ©', () => {
  const cas = [['X Y', '© X Y'], ['© X Y', '© X Y'], ['(c) X Y', '© X Y'], ['(C) X Y', '© X Y'],
    ['Copyright X Y', 'Copyright X Y'], ['copyright X Y', 'copyright X Y']];
  for (const [saisi, attendu] of cas) {
    const h = html('![T](a.png){alt="d" copyright="' + saisi + '"}\n');
    assert.ok(h.includes('<span class="szh-credit">(' + attendu + ')</span>'),
      saisi + ' -> ' + attendu + ' attendu : ' + h);
  }
});

test('figure : aucun crédit, aucune parenthèse ; aucune note, aucun <p> de note', () => {
  const h = html('![Un titre](a.png){alt="d"}\n');
  assert.ok(!/szh-credit|szh-bloc-note/.test(h), h);
  assert.match(h, /Un titre\n<\/figcaption>/, h);
});

test('figure : en allemand l’étiquette est « Notiz » et le deux-points colle', () => {
  const h = html('![T](a.png){alt="d" note="Text."}\n', 'lang: de');
  assert.ok(h.includes('<span class="szh-bloc-note-etiquette">Notiz</span>: Text.</p>'), h);
  assert.ok(!h.includes(FINE + ':'), 'une espace fine devant le deux-points allemand : ' + h);
});

test('figure sans légende, avec copyright et note : crédit après l’image, note en dernier', () => {
  const h = html('![](a.png){.szh-hors-figure alt="d" copyright="(c) SZH" note="Vignette."}\n');
  assert.match(h, /<figure class="szh-credit-seul">/, h);
  // Crédit seul sous l'image, sans titre : pas de parenthèses.
  assert.match(h, /<span class="szh-credit">© SZH<\/span>/, h);
  assert.ok(pos(h, /<img/) < pos(h, /<figcaption/) && pos(h, /<figcaption/) < pos(h, /szh-bloc-note"/),
    'ordre attendu image, crédit, note : ' + h);
  assert.match(h.match(/<img[^>]*>/)[0], /aria-describedby="szh-bloc-note-\d+"/, h);
});

test('figure sans légende, note seule : une <figure> sans <figcaption>', () => {
  const h = html('![](a.png){.szh-hors-figure alt="d" note="Seule."}\n');
  assert.ok(!/<figcaption/.test(h), h);
  assert.ok(pos(h, /<img/) < pos(h, /szh-bloc-note"/), h);
});

test('figure décorative (alt vide) : la note se lit, l’image ne reçoit pas aria-describedby', () => {
  const h = html('![](a.png){.szh-hors-figure alt="" copyright="© X" note="Décor."}\n');
  assert.ok(h.includes('Décor.</p>'), 'la note a disparu : ' + h);
  assert.ok(!/aria-describedby/.test(h), 'une image décorative ne se fait pas décrire : ' + h);
});

test('grille : crédits identiques dédoublonnés en une parenthèse, une seule note, sur la 1re image', () => {
  const md = '::: {.szh-grille disposition="2"}\n'
    + '![Deux vues](a.png){alt="A" copyright="© X" source="Archives" note="Note de grille."}\n'
    + '![](b.png){alt="B" copyright="© X" source="Archives"}\n'
    + '![](c.png){alt="C" copyright="© Y" source="Archives"}\n:::\n';
  const h = html(md);
  assert.match(h, /<span class="szh-credit">\(© X, © Y \| Archives\)<\/span>/, h);
  assert.strictEqual((h.match(/class="szh-bloc-note"/g) || []).length, 1, h);
  assert.strictEqual((h.match(/aria-describedby/g) || []).length, 1, h);
  assert.ok(pos(h, /aria-describedby/) < pos(h, /<img[^>]*alt="B"/), 'la note doit être sur la 1re image : ' + h);
});

test('grille sans légende : copyright et note ne se perdent pas', () => {
  const md = '::: {.szh-grille disposition="2"}\n![](a.png){alt="A" copyright="© X" note="N."}\n'
    + '![](b.png){alt="B" copyright="© X"}\n:::\n';
  const h = html(md);
  assert.ok(!/Figure \d/.test(h), 'une figure sans légende ne consomme pas de numéro : ' + h);
  assert.match(h, /<span class="szh-credit">© X<\/span>/, h);
  assert.ok(h.includes('N.</p>'), h);
});

const TABLE = (attrs, extra) => '```{=html}\n<table class="szh-tableau"' + attrs + '>\n'
  + (extra === undefined ? '<caption>Une légende</caption>\n' : extra)
  + '<tr><th scope="col">A</th></tr>\n<tr><td>1</td></tr>\n</table>\n```\n';

test('tableau : crédit entre parenthèses dans la caption, note juste après </table>', () => {
  const h = html(TABLE(' data-copyright="(C) SZH" data-source="ESA" data-note="Arrondi &amp; corrigé."'));
  assert.match(h, /<caption><span class="szh-numero">Tableau 1 —<\/span> Une légende <span class="szh-credit">\(© SZH \| ESA\)<\/span><\/caption>/, h);
  const note = h.match(/<\/table>\n<p class="szh-bloc-note" id="(szh-bloc-note-\d+)">/);
  assert.ok(note, 'la note ne suit pas </table> : ' + h);
  assert.ok(h.includes('Note</span>' + FINE + ': Arrondi &amp; corrigé.</p>'), h);
  assert.match(h.match(/<table[^>]*>/)[0], new RegExp('aria-describedby="' + note[1] + '"'), h);
  assert.ok(!/data-note/.test(h), h);
});

test('tableau : la description longue et la note se référencent toutes deux, sans écraser l’existant', () => {
  const h = html(TABLE(' aria-describedby="deja" data-alt="Long texte." data-note="N."'));
  const tag = h.match(/<table[^>]*>/)[0];
  assert.match(tag, /aria-describedby="deja szh-tabelle-desc-1 szh-bloc-note-\d+"/, tag);
  assert.ok(pos(h, /<\/table>/) < pos(h, /szh-bloc-note"/) && pos(h, /szh-bloc-note"/) < pos(h, /szh-description/),
    'ordre attendu tableau, note, description masquée : ' + h);
});

test('tableau : sans note, rien de plus qu’avant ; en allemand « Notiz: »', () => {
  const sans = html(TABLE(' data-alt="Long."'));
  assert.ok(!/szh-bloc-note/.test(sans), sans);
  assert.match(sans.match(/<table[^>]*>/)[0], /aria-describedby="szh-tabelle-desc-1"/, sans);
  const de = html(TABLE(' data-note="Text."'), 'lang: de');
  assert.ok(de.includes('>Notiz</span>: Text.</p>'), de);
});

test('tableau sans légende, avec copyright : le crédit reste, entre parenthèses', () => {
  const h = html(TABLE(' data-copyright="© SZH"', ''));
  assert.match(h, /<caption><span class="szh-credit">\(© SZH\)<\/span><\/caption>/, h);
});

test('ids de note : uniques dans le document', () => {
  const h = html('![A](a.png){alt="d" note="Un."}\n\n![B](b.png){alt="d" note="Deux."}\n\n'
    + TABLE(' data-note="Trois."'));
  const ids = h.match(/id="szh-bloc-note-\d+"/g) || [];
  assert.strictEqual(ids.length, 3, h);
  assert.strictEqual(new Set(ids).size, 3, 'ids en double : ' + ids);
});

// ── docx-tables.py : la note d'un bloc tableau (ligne FT) part en data-note ──────────────
const fs = require('fs');
const os = require('os');
const { python, pythonSortie, sansPython } = require('./js/gardes');

test('docx-tables.py : le champ note d’une ligne FT est lu, les clés qui suivent ne le sont pas', { skip: sansPython }, () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-ft-'));
  try {
    const meta = path.join(dossier, 'meta.txt');
    fs.writeFileSync(meta, 'FT\t1\tLeg\tAlt\tcopy\tsrc\tUne note\tCle : x\n', 'utf8');
    const script = 'import importlib.util,json,sys\n'
      + 'sp=importlib.util.spec_from_file_location("dt",sys.argv[1]);m=importlib.util.module_from_spec(sp);'
      + 'sp.loader.exec_module(m);print(json.dumps(m.blocs_pronto_par_meta()))\n';
    const r = python(['-c', script, path.resolve(__dirname, '..', 'pipeline', 'docx-tables.py')],
      { encoding: 'utf8', env: Object.assign({}, process.env, { SZH_META: meta }) });
    assert.strictEqual(r.status, 0, r.stderr);
    const bloc = JSON.parse(r.stdout)['1'];
    assert.strictEqual(bloc.note, 'Une note');
    assert.strictEqual(bloc.source, 'src');
    assert.strictEqual(bloc.credit, 'copy');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});
