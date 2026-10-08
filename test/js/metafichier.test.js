// Tests de pipeline/filters/szh-metafichier.lua : une image native Word (.emf/.wmf) est
// remplacée par un substitut visible, qui la nomme.
//
// Le test exécute pandoc avec le filtre et lit le HTML produit et le journal : lire le .lua
// ne prouve pas qu'il tourne.
//
// Contrôles :
//   1. une image du corps est substituée et garde ses dimensions, pour que la mise en page ne
//      bouge pas ;
//   2. une image citée seulement dans un tableau extrait l'est aussi : docx-tables.py sort
//      ces tableaux dans tables/table-NN.html, où un walker Image ne les voit pas ;
//   3. le texte alternatif nomme le fichier manquant, sinon un lecteur d'écran annoncerait
//      le vide et le PDF/UA prendrait le substitut pour un décor ;
//   4. une image ordinaire n'est pas touchée ;
//   5. le constat est écrit une fois par fichier, dans les deux langues ;
//   6. la casse ne compte pas : Word écrit parfois « .EMF ».
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

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

// Avec SZH_WSL_OBLIGATOIRE, gardes.js fait de l'absence de WSL un échec au chargement.

// Lance pandoc sur `markdown` avec le seul filtre testé, dans un dossier jetable où l'on dépose
// `fichiers` ({ 'media/x.emf': 'contenu' }). Rend { html, stderr, status }.
function rendre(markdown, fichiers, meta) {
  const chantier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-metafichier-'));
  try {
    for (const [rel, contenu] of Object.entries(fichiers || {})) {
      const cible = path.join(chantier, rel);
      fs.mkdirSync(path.dirname(cible), { recursive: true });
      fs.writeFileSync(cible, contenu);
    }
    fs.writeFileSync(path.join(chantier, 'essai.md'), markdown);
    // Sans --embed-resources, pour lire la cible plutôt que du base64. Le filtre pose un
    // chemin absolu, que pandoc laisse tel quel.
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
  if (sansPandocWsl) {
    console.warn('\n*** substitution non vérifiée : ' + sansPandocWsl + ' ***\n');
    return sauter.wsl(t);
  }
  const r = rendre(
    '![Un dessin collé depuis Excel](./media/dessin.emf){width="3.6in" height="5.1in"}\n',
    { 'media/dessin.emf': 'des octets qui ne sont pas une image' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  // La cible est ce que WeasyPrint va chercher. L'alt, lui, nomme le fichier manquant
  // (contrôle à part).
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

test("szh-metafichier : une image citée SEULEMENT dans un tableau extrait l’est aussi", (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  // szh-tabelle-inclure.lua réinjecte du HTML brut, sans nœud Image : un walker Image seul ne
  // le verrait pas.
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
  if (sansPandocWsl) { return sauter.wsl(t); }
  const r = rendre('![](./media/dessin.emf)\n', { 'media/dessin.emf': 'x' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  const alt = /alt="([^"]*)"/.exec(r.html);
  assert.ok(alt, 'le placeholder n’a pas de texte alternatif : sur un PDF/UA, il passerait '
    + 'pour une image décorative\n' + r.html);
  assert.match(alt[1], /IMAGE À REMPLACER/, 'l’alt ne dit pas qu’il faut remplacer l’image');
  assert.match(alt[1], /dessin\.emf/, 'l’alt ne nomme pas le fichier manquant');
});

test('szh-metafichier : une image ordinaire traverse le filtre intacte', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const r = rendre('![Une vraie image](./media/photo.png)\n', { 'media/photo.png': 'x' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  assert.match(r.html, /media\/photo\.png/, 'une image ordinaire a été substituée');
  assert.ok(!/image-a-remplacer/.test(r.html), 'le placeholder s’est invité sans raison');
  assert.strictEqual(r.stderr.trim(), '', 'un constat est écrit alors que rien ne cloche');
});

test('szh-metafichier : le constat est écrit une seule fois par fichier, en deux langues', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  // La même image citée trois fois ne donne qu'une ligne de journal.
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
  if (sansPandocWsl) { return sauter.wsl(t); }
  const r = rendre('![a](./media/DESSIN.EMF)\n', { 'media/DESSIN.EMF': 'x' });

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  assert.match(r.html, /image-a-remplacer\.svg/,
    'un « .EMF » en capitales passe au travers : Word en écrit, et la compilation '
    + 'tomberait dessus comme avant');
});

test('szh-metafichier : dans un ouvrage allemand, ce qui manque se dit en allemand', (t) => {
  if (sansPandocWsl) { return sauter.wsl(t); }
  const r = rendre('![a](./media/d.emf)\n', { 'media/d.emf': 'x' }, '--metadata=lang:de');

  assert.strictEqual(r.status, 0, 'pandoc a échoué : ' + r.stderr);
  const alt = /alt="([^"]*)"/.exec(r.html);
  assert.ok(alt, 'pas de texte alternatif\n' + r.html);
  assert.match(alt[1], /BILD ZU ERSETZEN/,
    'un livre allemand annonce son image manquante en français');
});
