// Accessibilité du HTML et du PDF d'un article, filtre par filtre : exergue, figure à
// légende déclarée décorative, titre en escalier, image décorative seule, titre des
// encadrés, liens de la bibliographie, <style> des décors, niveaux de titre, nom des
// figures, feuille d'écran.
//
// Les filtres tournent avec le pandoc de la WSL, celui qui compile. Sans elle, les
// contrôles sont sautés avec un motif ; SZH_WSL_OBLIGATOIRE en fait des échecs.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { sauter, sansPandocWsl } = require('./gardes');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');
const TRAVAIL = path.join(os.tmpdir(), 'szh-accessibilite-articles');

// Image PNG de 1 × 1 pixel, pour les filtres qui mesurent une image.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

// Compile `fichiers['essai.md']` dans un dossier jetable, avec les filtres nommés. Rend
// { html, stderr }. `options.args` : arguments de plus pour pandoc ; `options.env` :
// variables exportées avant pandoc.
function compiler(nom, fichiers, filtres, options) {
  const o = options || {};
  const { DISTRO, cheminWsl } = require(path.join(COCKPIT, 'lib', 'wsl.js'));
  const { cheminVersWsl } = require(path.join(COCKPIT, 'lib', 'portraits.js'));
  const dossier = path.join(TRAVAIL, nom);
  fs.rmSync(dossier, { recursive: true, force: true });
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, 'media', 'x.png'), PNG);
  for (const [f, contenu] of Object.entries(fichiers)) {
    fs.writeFileSync(path.join(dossier, f), contenu, 'utf8');
  }
  const env = Object.entries(o.env || {}).map(([k, v]) => 'export ' + k + '=' + JSON.stringify(v) + '; ').join('');
  const args = ['essai.md', '--from=markdown', '--to=html5']
    .concat(o.args || [])
    .concat(filtres.map((f) => '--lua-filter=' + JSON.stringify(cheminVersWsl(path.join(FILTRES, f)))));
  const r = spawnSync(cheminWsl(), ['-d', DISTRO, '--', 'sh', '-c',
    env + 'cd ' + JSON.stringify(cheminVersWsl(dossier)) + ' && pandoc ' + args.join(' ')],
  { encoding: 'utf8', windowsHide: true, timeout: 120000 });
  assert.ok(!r.error, 'pandoc injoignable : ' + (r.error && r.error.message));
  assert.strictEqual(r.status, 0, 'pandoc sorti en ' + r.status + ' : ' + r.stderr);
  return { html: String(r.stdout).replace(/\s+/g, ' '), stderr: String(r.stderr) };
}

function avecWsl(nom, corps) {
  test(nom, (t) => {
    if (sansPandocWsl) { sauter.wsl(t); return; }
    return corps(t);
  });
}

// ── Exergue ──────────────────────────────────────────────────────────────────────────
const PHRASE = 'La participation se mesure à ce que chaque élève peut faire.';

avecWsl('exergue : masquée au lecteur d’écran quand son texte figure dans le corps', () => {
  // Même phrase, autre casse et autre ponctuation : la comparaison ne garde que les mots.
  const md = 'Le texte dit : « la participation se mesure à ce que chaque élève peut faire » '
    + 'et la suite.\n\n'
    + '::: {.highlight}\n' + PHRASE + '\n:::\n';
  const { html } = compiler('exergue-repetee', { 'essai.md': md }, ['szh-exergue.lua']);
  assert.match(html, /<div class="highlight" aria-hidden="true">/, html);
});

avecWsl('exergue : lue quand son texte n’existe nulle part ailleurs', () => {
  const md = 'Un paragraphe qui parle d’autre chose.\n\n::: {.highlight}\n' + PHRASE + '\n:::\n';
  const { html } = compiler('exergue-unique', { 'essai.md': md }, ['szh-exergue.lua']);
  assert.match(html, /<div class="highlight">/, html);
  assert.ok(!/aria-hidden/.test(html), 'une exergue au texte unique est masquée : ' + html);
});

// ── Figure à légende déclarée décorative ──────────────────────────────────────────────
avecWsl('figure à légende déclarée décorative : un constat bilingue, le rendu inchangé', () => {
  const md = '![Répartition des élèves](media/x.png){alt=""}\n';
  const { html, stderr } = compiler('figure-decorative', { 'essai.md': md }, ['szh-numerotation.lua']);
  const lignes = stderr.split('\n').filter((l) => /figure-legendee-decorative/.test(l));
  assert.strictEqual(lignes.length, 1, 'un constat attendu : ' + stderr);
  assert.match(lignes[0],
    /^\[numerotation-avertissement\] figure-legendee-decorative \| article « essai » \| image « media\/x\.png » \| .+ \| \[de\] .+$/);
  assert.match(html, /<span class="szh-decor szh-decor-1" role="presentation">/,
    'l’image n’est plus rendue en fond CSS : ' + html);
});

// La ligne du filtre devient une carte des Contrôles, avec sa phrase fr et de et son
// bouton vers les médias.
avecWsl('figure à légende déclarée décorative : la ligne devient une carte des Contrôles', () => {
  const journal = require(path.join(COCKPIT, 'lib', 'journal.js'));
  const constats = require(path.join(COCKPIT, 'lib', 'constats.js'));
  const { stderr } = compiler('figure-decorative-carte',
    { 'essai.md': '![Répartition des élèves](media/x.png){alt=""}\n' }, ['szh-numerotation.lua']);
  const fr = journal.analyserJournal(stderr, 'fr').filter((c) => c.code === 'figure-legendee-decorative');
  assert.strictEqual(fr.length, 1, stderr);
  assert.strictEqual(fr[0].cle, 'ctl.figure.legendeedecorative');
  assert.deepStrictEqual(fr[0].args, ['x.png']);
  assert.match(journal.phraseConstat(fr[0], 'fr'), /^L’image x\.png a une légende mais est déclarée décorative/);
  const de = journal.analyserJournal(stderr, 'de').filter((c) => c.code === 'figure-legendee-decorative');
  assert.match(journal.phraseConstat(de[0], 'de'), /^Das Bild x\.png hat eine Legende/);
  assert.strictEqual(constats.TABLE['numerotation/figure-legendee-decorative'].lieu, 'medias');
});

avecWsl('figure à légende décrite, ou image décorative sans légende : aucun constat', () => {
  const md = '![Légende](media/x.png){alt="Une description"}\n\nTexte.\n\n![](media/x.png){alt=""}\n';
  const { stderr } = compiler('figure-decrite', { 'essai.md': md }, ['szh-numerotation.lua']);
  assert.ok(!/figure-legendee-decorative/.test(stderr), stderr);
});

// ── Titre en escalier ─────────────────────────────────────────────────────────────────
avecWsl('titre en escalier : l’espace reste devant le saut de ligne', () => {
  const { html } = compiler('titre-lignes', {
    'essai.md': '', 't.html': '$titre-lignes$\n'
  }, ['szh-titre-lignes.lua'], { args: ['-s', '--template=t.html',
    '--metadata=titre-affiche:"Ce qu’un lecteur d’écran doit pouvoir parcourir"'] });
  assert.match(html, /<br class="szh-titre-ligne" \/>/, 'aucune coupure posée, le test ne prouve rien : ' + html);
  assert.match(html, /\S <br class="szh-titre-ligne" \/>/,
    'le saut remplace l’espace : les deux mots se collent à l’écran et dans le nom accessible : ' + html);
});

// ── Image décorative seule dans son paragraphe ────────────────────────────────────────
avecWsl('image décorative seule : un <div class="szh-decor-seul">, pas un <p> sans texte', () => {
  const md = 'Avant.\n\n![](media/x.png){alt=""}\n\nAprès.\n';
  const { html } = compiler('decor-seul', { 'essai.md': md }, ['szh-numerotation.lua']);
  assert.match(html, /<div class="szh-decor-seul"> ?<span class="szh-decor szh-decor-1"/, html);
  assert.ok(!/<p> ?<span class="szh-decor/.test(html), 'un <p> ne contient que le décor : ' + html);
});

avecWsl('image décorative au fil du texte : elle reste dans son paragraphe', () => {
  const md = 'Du texte ![](media/x.png){alt=""} et la suite.\n';
  const { html } = compiler('decor-texte', { 'essai.md': md }, ['szh-numerotation.lua']);
  assert.ok(!/szh-decor-seul/.test(html), html);
});

// ── <style> des images décoratives ────────────────────────────────────────────────────
avecWsl('image décorative : son <style> est dans le <head>, pas dans le <body>', () => {
  const md = '---\ntitle: Essai\n---\n\n![](media/x.png){alt=""}\n';
  const { html } = compiler('decor-style', { 'essai.md': md }, ['szh-numerotation.lua'],
    { args: ['-s'] });
  const corps = html.slice(html.indexOf('<body'));
  assert.match(html.slice(0, html.indexOf('</head>')), /\.szh-decor-1\{width:1px;/, html);
  assert.ok(!/<style/.test(corps), 'un <style> reste dans le <body> : ' + corps);
});

// ── Titre des encadrés ────────────────────────────────────────────────────────────────
avecWsl('encadrés : le titre est un paragraphe du texte, « Information » par défaut', () => {
  const md = '::: {.question data-titre="Question ouverte"}\nComment ?\n:::\n\n'
    + '::: {.important}\nUn fait.\n:::\n\n'
    + '::: {.important data-titre="Attention"}\nUn autre.\n:::\n\n'
    + '::: {.question}\nSans titre ?\n:::\n';
  const { html } = compiler('encadres', { 'essai.md': md }, ['szh-encadres.lua']);
  assert.match(html, /<div class="question" data-titre="Question ouverte"> <p class="szh-encadre-titre">Question ouverte<\/p>/, html);
  assert.match(html, /<div class="important"> <p class="szh-encadre-titre">Information<\/p>/, html);
  assert.match(html, /<div class="important" data-titre="Attention"> <p class="szh-encadre-titre">Attention<\/p>/, html);
  assert.match(html, /<div class="question"> <p>Sans titre/, 'une question sans data-titre reçoit un titre : ' + html);
});

avecWsl('encadrés : un chapitre de livre n’en reçoit pas', () => {
  const md = '::: {.important}\nUn fait.\n:::\n';
  const { html } = compiler('encadres-livre', { 'essai.md': md }, ['szh-encadres.lua'],
    { env: { SZH_LIVRE: '1' } });
  assert.ok(!/szh-encadre-titre/.test(html), html);
});

// ── Liens de la bibliographie ─────────────────────────────────────────────────────────
avecWsl('bibliographie : une URL ou un DOI écrit en clair devient un lien', () => {
  const md = 'Selon Dupont (2024).\n\n::: {.szh-biblio src="essai.biblio.md"}\n:::\n';
  const biblio = 'Dupont, A. (2024). Un titre. *Revue, 4*(1), 1–2. https://doi.org/10.99999/x.2024.1\n\n'
    + 'Muller, B. (2023). Autre. Consulté sur https://www.example.org/page.\n\n'
    + 'Weber, C. (2022). Gardé. <https://www.example.org/garde>\n';
  const { html } = compiler('biblio-liens', { 'essai.md': md, 'essai.biblio.md': biblio },
    ['szh-citations.lua']);
  assert.match(html, /<a href="https:\/\/doi\.org\/10\.99999\/x\.2024\.1" class="szh-lien-brut">https:\/\/doi\.org\/10\.99999\/x\.2024\.1<\/a>/, html);
  // Le point final reste hors du lien.
  assert.match(html, /<a href="https:\/\/www\.example\.org\/page" class="szh-lien-brut">https:\/\/www\.example\.org\/page<\/a>\./, html);
  // Un lien déjà écrit garde son aspect de lien (pas de classe szh-lien-brut).
  assert.match(html, /<a href="https:\/\/www\.example\.org\/garde" class="uri">/, html);
});

// Le lien d'une référence a l'aspect du texte dans le PDF ; le §9 le souligne à l'écran.
test('print.css : un lien en clair de la bibliographie a l’aspect du texte', () => {
  const css = fs.readFileSync(path.join(RACINE, 'pipeline', 'styles', 'print.css'), 'utf8');
  const horsEcran = css.slice(0, css.indexOf('9. Écran'));
  assert.match(horsEcran, /\.szh-reference a\.szh-lien-brut \{ color: inherit; text-decoration: none; \}/);
});

// ── Lien ORCID ────────────────────────────────────────────────────────────────────────
avecWsl('ORCID : le nom accessible du lien nomme l’auteur, en fr et en de', () => {
  const fiche = (revue) => '---\nrevue: ' + revue + '\nauthor:\n- prenom: Anne\n  nom: Dupont\n'
    + '  orcid: "0000-0002-1825-0097"\n  orcid-url: https://orcid.org/0000-0002-1825-0097\n---\n\nTexte.\n';
  const fr = compiler('orcid-fr', { 'essai.md': fiche('revue') }, ['szh-auteurs.lua']);
  assert.match(fr.html, /class="szh-orcid"[^>]*aria-label="ORCID de Anne Dupont"/, fr.html);
  const de = compiler('orcid-de', { 'essai.md': fiche('zeitschrift') }, ['szh-auteurs.lua']);
  assert.match(de.html, /class="szh-orcid"[^>]*aria-label="ORCID von Anne Dupont"/, de.html);
});

// Le titre d'une question est lu mais masqué : hors du flux, il ne déplace rien.
test('print.css : le titre d’une .question est masqué visuellement, celui de .important composé', () => {
  const css = fs.readFileSync(path.join(RACINE, 'pipeline', 'styles', 'print.css'), 'utf8');
  const horsEcran = css.slice(0, css.indexOf('9. Écran'));
  assert.match(horsEcran, /\.question > \.szh-encadre-titre \{\s*position: absolute; width: 1px; height: 1px;/);
  assert.match(horsEcran, /\.important > \.szh-encadre-titre \{\s*margin: 0 0 5px;/);
});

// ── Niveaux de titre ──────────────────────────────────────────────────────────────────
avecWsl('niveaux : un saut compacté sans message, plus de cinq rangs signalés', () => {
  const saut = compiler('niveaux-saut', { 'essai.md': '## A\n\n#### B\n\n###### C\n' }, ['szh-niveaux.lua']);
  assert.match(saut.html, /<h2[^>]*>A<\/h2> <h3[^>]*>B<\/h3> <h4[^>]*>C<\/h4>/, saut.html);
  assert.ok(!/\[niveaux\]/.test(saut.stderr), 'un saut corrigé n’est pas un défaut : ' + saut.stderr);
  const profond = compiler('niveaux-profond',
    { 'essai.md': '# 1\n\n## 2\n\n### 3\n\n#### 4\n\n##### 5\n\n###### 6\n' }, ['szh-niveaux.lua']);
  assert.match(profond.stderr, /^\[niveaux\] essai : plus de 5 rangs de titre/m, profond.stderr);
});

// ── Nom des figures ───────────────────────────────────────────────────────────────────
avecWsl('figure à légende : nommée par sa <figcaption> (aria-labelledby)', () => {
  const md = '![Légende de la figure](media/x.png){alt="Description"}\n\n'
    + '![](media/x.png){.szh-hors-figure alt="Autre" copyright="X"}\n';
  const { html } = compiler('figure-nom', { 'essai.md': md },
    ['szh-numerotation.lua', 'szh-legende-avant.lua']);
  const m = html.match(/<figure aria-labelledby="([^"]+)"> <figcaption id="([^"]+)">/);
  assert.ok(m, 'figure sans aria-labelledby vers sa légende : ' + html);
  assert.strictEqual(m[1], m[2]);
  assert.match(html, /<figure class="szh-credit-seul">/,
    'une figure au seul crédit ne doit pas être nommée par ce crédit : ' + html);
});

// ── Feuille d'écran ───────────────────────────────────────────────────────────────────
// La section 9 de print.css est un seul bloc @media screen : rien n'en atteint le PDF.
test('print.css : la section Écran est tout entière sous @media screen', () => {
  const css = fs.readFileSync(path.join(RACINE, 'pipeline', 'styles', 'print.css'), 'utf8');
  const i = css.indexOf('9. Écran');
  assert.ok(i !== -1, 'section 9 introuvable');
  const reste = css.slice(css.indexOf('*/', i) + 2).trim();
  assert.ok(reste.startsWith('@media screen {'), reste.slice(0, 80));
  let prof = 0; let fin = -1;
  for (let k = reste.indexOf('{'); k < reste.length; k++) {
    if (reste[k] === '{') prof++;
    if (reste[k] === '}') { prof--; if (prof === 0) { fin = k; break; } }
  }
  assert.strictEqual(reste.slice(fin + 1).trim(), '', 'des règles suivent le bloc @media screen');
});
