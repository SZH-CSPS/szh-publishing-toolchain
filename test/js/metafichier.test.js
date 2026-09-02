// Contrôles de pipeline/filters/szh-metafichier.lua : une image native Word (.emf/.wmf)
// est remplacée par un placeholder visible, et NOMMÉE.
//
//   node --test "test/js/*.test.js"
//
// Ce fichier EXÉCUTE pandoc avec le filtre, comme import-numerotation-titres.test.js
// exécute la chaîne d'import : ce qui est en jeu n'est pas un texte source mais un HTML
// produit et une ligne de journal. Un contrôle qui se contenterait de lire le .lua ne
// dirait rien du défaut réel — szh-legende-avant.lua était CORRECT à la lecture et ne
// tournait jamais (défaut A9, une alternation « | » dans un motif Lua).
//
// Ce que ces contrôles tiennent :
//   1. une image du CORPS est substituée, et ses dimensions d'origine survivent — le
//      placeholder occupe la boîte de l'image absente, la mise en page ne se déplace pas ;
//   2. une image citée SEULEMENT dans un tableau extrait l'est aussi : docx-tables.py les
//      sort du .md dans tables/table-NN.html, et un walker Image ne les voit pas. C'était
//      le cas de fig-73 au chapitre 09 du VN-FALC ;
//   3. le texte alternatif NOMME le fichier manquant — sans quoi un lecteur d'écran
//      annoncerait le vide, et le PDF/UA prendrait le placeholder pour un décor ;
//   4. une image ordinaire n'est pas touchée ;
//   5. le constat est écrit UNE fois par fichier, dans les deux langues du poste ;
//   6. la casse ne décide pas : Word écrit parfois « .EMF ».
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const PIPE = path.join(RACINE, 'pipeline');
const FILTRE = path.join(PIPE, 'filters', 'szh-metafichier.lua');
const DISTRO = 'SZH-Publishing';

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
  try { r = wsl(['sh', '-c', 'command -v pandoc']); }
  catch (e) { pandocVu = 'wsl.exe injoignable : ' + e.message; return pandocVu; }
  if (r.error) { pandocVu = 'wsl.exe injoignable : ' + r.error.message; }
  else if (r.status !== 0) { pandocVu = 'pandoc introuvable dans la distro ' + DISTRO; }
  else { pandocVu = null; }
  return pandocVu;
}

// Lance pandoc sur `markdown` avec le seul filtre à l'essai, dans un dossier jetable où
// l'on dépose les fichiers de `fichiers` ({ 'media/x.emf': 'contenu' }).
// Rend { html, stderr, status }.
function rendre(markdown, fichiers, meta) {
  const chantier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-metafichier-'));
  try {
    for (const [rel, contenu] of Object.entries(fichiers || {})) {
      const cible = path.join(chantier, rel);
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.writeFileSync(cible, contenu);
    }
    fs.writeFileSync(path.join(chantier, 'essai.md'), markdown);
    // Pas de --embed-resources : on veut LIRE la cible, pas 300 ko de base64. Le filtre
    // pose un chemin absolu, que pandoc laisse tel quel sans incorporation.
    const cmd = 'cd ' + JSON.stringify(cheminVersWsl(chantier))
      + ' && pandoc essai.md --from=markdown --to=html5'
      + (meta ? ' ' + meta : '')
      + ' --lua-filter=' + JSON.stringify(cheminVersWsl(FILTRE));
    const r = wsl(['sh', '-c', cmd]);
    return { html: String(r.stdout || ''), stderr: String(r.stderr || ''), status: r.status };
  } finally {
    fs.rmSync(chantier, { recursive: true, force: true });
  }
}

test('szh-metafichier : une image du corps est remplacée, ses dimensions conservées', (t) => {
  const absent = pandocAbsent();
  if (absent) {
    console.warn('\n*** substitution non vérifiée : ' + absent + ' ***\n');
    return t.skip(absent);
  }
  const r = rendre(
    '![Un dessin collé depuis Excel](./media/dessin.emf){width="3.6in" height="5.1in"}\n',
    { 'media/dessin.emf': 'des octets qui ne sont pas une image' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  // Ce qui compte est la CIBLE : c'est elle que WeasyPrint va chercher. L'alt, lui, doit
  // au contraire nommer le fichier manquant — un autre contrôle s'en charge.
  const cibles = (r.html.match(/src="([^"]*)"/g) || []).map((s) => s.slice(5, -1));
  assert.deepStrictEqual(cibles.filter((c) => /\.(emf|wmf)$/i.test(c)), [],
    'une cible .emf survit : WeasyPrint s’y arrêterait, et la compilation entière '
    + 'tomberait sur cette seule image\n' + r.html);
  assert.match(r.html, /image-a-remplacer\.svg/, 'le placeholder n’a pas pris la place');
  assert.match(r.html, /data-szh-metafichier="dessin\.emf"/,
    'le fichier d’origine n’est plus tracé dans le HTML');
  for (const dim of ['3.6in', '5.1in']) {
    assert.ok(r.html.includes(dim),
      'la dimension ' + dim + ' a disparu : le placeholder n’occupe plus la boîte de '
      + 'l’image absente, et toute la mise en page se déplace sous lui');
  }
});

test('szh-metafichier : une image citée SEULEMENT dans un tableau extrait l’est aussi', (t) => {
  const absent = pandocAbsent();
  if (absent) { return t.skip(absent); }
  // Ce que szh-tabelle-inclure.lua réinjecte : du HTML brut, où il n'y a plus de nœud
  // Image. Un walker Image seul passerait à côté — c'est ce qui est arrivé à fig-73.
  const r = rendre(
    '```{=html}\n<table><tr><td>'
    + '<img src="media/schema.wmf" alt="P1#yIS1" width="266"></td></tr></table>\n```\n',
    { 'media/schema.wmf': 'des octets' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  assert.match(r.html, /image-a-remplacer\.svg/,
    'une image de tableau n’est pas substituée : elle ferait tomber la compilation, et '
    + 'rien dans le .md ne dirait où elle est');
  assert.match(r.html, /data-szh-metafichier="schema\.wmf"/, 'le fichier n’est pas tracé');
  assert.ok(r.html.includes('width="266"'),
    'la largeur du tableau d’origine a été perdue');
});

test('szh-metafichier : le texte alternatif NOMME ce qui manque', (t) => {
  const absent = pandocAbsent();
  if (absent) { return t.skip(absent); }
  const r = rendre('![](./media/dessin.emf)\n', { 'media/dessin.emf': 'x' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  const alt = /alt="([^"]*)"/.exec(r.html);
  assert.ok(alt, 'le placeholder n’a pas de texte alternatif : sur un PDF/UA, il passerait '
    + 'pour une image décorative\n' + r.html);
  assert.match(alt[1], /IMAGE À REMPLACER/, 'l’alt ne dit pas qu’il faut remplacer l’image');
  assert.match(alt[1], /dessin\.emf/, 'l’alt ne nomme pas le fichier manquant');
});

test('szh-metafichier : une image ordinaire traverse le filtre intacte', (t) => {
  const absent = pandocAbsent();
  if (absent) { return t.skip(absent); }
  const r = rendre('![Une vraie image](./media/photo.png)\n', { 'media/photo.png': 'x' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  assert.match(r.html, /media\/photo\.png/, 'une image ordinaire a été substituée');
  assert.ok(!/image-a-remplacer/.test(r.html), 'le placeholder s’est invité sans raison');
  assert.strictEqual(r.stderr.trim(), '', 'un constat est écrit alors que rien ne cloche');
});

test('szh-metafichier : le constat est écrit une seule fois par fichier, en deux langues', (t) => {
  const absent = pandocAbsent();
  if (absent) { return t.skip(absent); }
  // La même image citée trois fois ne doit pas remplir le journal de trois lignes.
  const r = rendre('![a](./media/d.emf)\n\n![b](./media/d.emf)\n\n![c](./media/d.emf)\n',
    { 'media/d.emf': 'x' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  const lignes = r.stderr.split('\n').filter((l) => l.includes('image-native-word'));
  assert.strictEqual(lignes.length, 1,
    'la même image donne ' + lignes.length + ' constats : le journal se remplirait de '
    + 'doublons, et le vrai message se perdrait dedans');
  assert.match(lignes[0], /\[metafichier-avertissement\]/,
    'le constat ne porte plus le préfixe que le cockpit relit dans .szh-journal.log');
  assert.match(lignes[0], /image native Word/, 'le message français a disparu');
  assert.match(lignes[0], /\| \[de\] /, 'le message allemand a disparu');
  assert.match(lignes[0], /d\.emf/, 'le message ne nomme pas le fichier');
  assert.match(lignes[0], /PNG/, 'le message ne dit plus quel geste répare');
});

test('szh-metafichier : « .EMF » en capitales est reconnu comme « .emf »', (t) => {
  const absent = pandocAbsent();
  if (absent) { return t.skip(absent); }
  const r = rendre('![a](./media/DESSIN.EMF)\n', { 'media/DESSIN.EMF': 'x' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  assert.match(r.html, /image-a-remplacer\.svg/,
    'un « .EMF » en capitales passe au travers : Word en écrit, et la compilation '
    + 'tomberait dessus comme avant');
});

test('szh-metafichier : dans un ouvrage allemand, ce qui manque se dit en allemand', (t) => {
  const absent = pandocAbsent();
  if (absent) { return t.skip(absent); }
  const r = rendre('![a](./media/d.emf)\n', { 'media/d.emf': 'x' }, '--metadata=lang:de');

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  const alt = /alt="([^"]*)"/.exec(r.html);
  assert.ok(alt, 'pas de texte alternatif\n' + r.html);
  assert.match(alt[1], /BILD ZU ERSETZEN/,
    'un livre allemand annonce son image manquante en français');
});
