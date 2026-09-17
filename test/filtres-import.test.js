// Onze filtres Lua branchés en production (pipeline/Makefile, pipeline/profils/livre.mk,
// pipeline/import-docx.sh) qu'aucun test ne faisait tourner sous pandoc avant ce fichier.
// Même patron que test/filtres-pandoc.test.js, qu'il faut lire d'abord : paire
// « préparation » (le défaut existe sans le filtre) + « filtré » (le filtre change la
// forme), comparaisons sur des structures stables plutôt que sur une balise figée, et
// AUCUN saut silencieux — si pandoc manque, les tests ÉCHOUENT.
//
//   node --test test/filtres-import.test.js
//
// Fixtures en ASCII pur : le pandoc 3.9 de Windows (celui de ce poste) plie mal les
// majuscules accentuées, et rien ici ne teste le pliage des accents — inutile de s'y
// exposer. Comme filtres-pandoc.test.js, ce fichier tourne avec le pandoc du PATH, pas
// forcément celui qui compile (3.5 en CI/production) : assertions sur des comptes et des
// motifs stables, jamais un nombre de colonnes ou une balise que le writer pourrait
// formuler autrement d'une version à l'autre.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');

// Même helper que filtres-pandoc.test.js, avec en plus `env` : plusieurs de ces filtres
// (szh-meta, szh-titres, szh-livre-auteurs, szh-notes) lisent une variable d'environnement
// plutôt qu'un fichier de métadonnées pandoc.
function pandoc(entree, options) {
  const o = options || {};
  const args = ['--from=' + (o.de || 'markdown'), '--to=' + (o.vers || 'markdown'), '--wrap=none'];
  if (o.standalone) { args.push('--standalone'); }
  for (const f of (o.filtres || [])) { args.push('--lua-filter=' + path.join(FILTRES, f)); }
  const env = o.env ? Object.assign({}, process.env, o.env) : process.env;
  const r = spawnSync('pandoc', args, { input: entree, encoding: 'utf8', env: env });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  if (r.status !== 0) { throw new Error('pandoc a échoué : ' + r.stderr); }
  return r.stdout;
}

// szh-meta.lua et szh-titres.lua lisent leurs instructions par io.open(chemin), le chemin
// venant d'une variable d'environnement (SZH_META, SZH_TITRES) — jamais par stdin. Un
// dossier jetable par appel, nettoyé même si l'assertion lève.
function instructionsTemporaires(contenu) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-import-'));
  const chemin = path.join(dossier, 'instructions.txt');
  fs.writeFileSync(chemin, contenu, 'utf8');
  return { chemin: chemin, nettoyer: function () { fs.rmSync(dossier, { recursive: true, force: true }); } };
}

// Lance un script par l'interprète Lua embarqué de pandoc (`pandoc lua`), pour lire
// szh-titre-metriques.lua directement : ce fichier ne branche aucune fonction d'élément
// (Meta, Header, …), le passer en --lua-filter ne ferait donc tourner aucun code utile.
function pandocLua(script) {
  const r = spawnSync('pandoc', ['lua', '-e', script], { encoding: 'utf8' });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  if (r.status !== 0) { throw new Error('pandoc lua a échoué : ' + r.stderr); }
  return r.stdout;
}

// ── szh-notes.lua : les notes de bas de page groupées en fin de writer HTML ────────────
// pipeline/Makefile place ce filtre en dernier de la chaîne PDF (--to=html5), jamais en
// EPUB ni sous SZH_APERCU=1 (le filtre s'abstient lui-même dans les deux cas — voir sa
// tête). Sortie observée : un <span class="szh-note"> à la place du renvoi numéroté.
const NOTE_MD = 'Un texte avec un appel[^1].\n\n[^1]: Contenu de la note.\n';

test('notes (préparation) : sans le filtre, la note part en bas de document', () => {
  const html = pandoc(NOTE_MD, { vers: 'html5' });
  assert.match(html, /class="footnotes/, 'pandoc ne groupe plus les notes en fin de document : ' + html);
  assert.ok(!/szh-note/.test(html), 'un span szh-note existe déjà sans le filtre : ' + html);
});

test('notes : le filtre transforme la note en span inline, la section de fin disparaît', () => {
  const html = pandoc(NOTE_MD, { vers: 'html5', filtres: ['szh-notes.lua'] });
  assert.match(html, /<span class="szh-note">Contenu de la note\.<\/span>/, html);
  assert.ok(!/class="footnotes/.test(html), 'la note est toujours groupée en fin de document : ' + html);
});

test('notes : sous SZH_APERCU, le filtre reste inactif — l\'aperçu n\'est pas paginé', () => {
  const html = pandoc(NOTE_MD, { vers: 'html5', filtres: ['szh-notes.lua'], env: { SZH_APERCU: '1' } });
  assert.match(html, /class="footnotes/, 'le filtre agit malgré SZH_APERCU : ' + html);
  assert.ok(!/szh-note/.test(html), html);
});

// Cas limite : une note à deux blocs (deux paragraphes) doit s'aplatir en une seule ligne,
// jointe par une espace — jamais deux <p> dans un <span>, ce que la zone @footnote de
// WeasyPrint ne saurait pas composer.
const NOTE_DEUX_BLOCS = 'Un texte avec un appel[^1].\n\n[^1]: Premiere phrase de la note.\n\n'
  + '    Seconde phrase de la note.\n';

test('notes : une note à deux paragraphes est aplatie en une seule ligne', () => {
  const html = pandoc(NOTE_DEUX_BLOCS, { vers: 'html5', filtres: ['szh-notes.lua'] });
  assert.match(html, /<span class="szh-note">Premiere phrase de la note\. Seconde phrase de la note\.<\/span>/,
    'les deux paragraphes ne sont pas joints par une espace, ou un <p> a survécu : ' + html);
  assert.strictEqual((html.match(/<span class="szh-note">/g) || []).length, 1, html);
});

// ── szh-listes-serrees.lua : une liste lâche perd ses <p> internes (PDF/UA-1 7.2-20) ───
// Branché deux fois dans pipeline/Makefile (PDF et aperçu), toujours avant
// szh-tabelle-inclure. Sortie observée : le nombre de <p> à l'intérieur de la liste.
const LISTE_LACHE = '- Premiere phrase.\n\n  Deuxieme phrase du meme item.\n- Un item simple.\n';

test('listes (préparation) : sans le filtre, une liste lâche imprime un <p> par item', () => {
  const html = pandoc(LISTE_LACHE, { vers: 'html5' });
  assert.strictEqual((html.match(/<p>/g) || []).length, 3,
    'la liste n\'est plus rendue lâche par pandoc, le défaut a changé de forme : ' + html);
});

test('listes : le filtre fusionne les paragraphes de tête, un seul <br> les sépare', () => {
  const html = pandoc(LISTE_LACHE, { vers: 'html5', filtres: ['szh-listes-serrees.lua'] });
  assert.strictEqual((html.match(/<p>/g) || []).length, 0, 'un <p> subsiste dans la liste : ' + html);
  assert.strictEqual((html.match(/<br\s*\/?>/g) || []).length, 1, html);
  assert.match(html, /Premiere phrase\./, html);
  assert.match(html, /Deuxieme phrase du meme item\./, html);
});

// Cas limite : un item « texte + sous-liste ». Le texte de tête perd son <p> comme
// ci-dessus, mais la sous-liste n'est ni fusionnée ni touchée — elle passe déjà la porte
// PDF/UA telle quelle (voir le commentaire de tête du filtre).
const LISTE_MIXTE = '- Texte de tete.\n\n  - Sous-item un.\n  - Sous-item deux.\n';

test('listes : un item « texte + sous-liste », le texte perd son <p>, la sous-liste reste intacte', () => {
  const html = pandoc(LISTE_MIXTE, { vers: 'html5', filtres: ['szh-listes-serrees.lua'] });
  assert.strictEqual((html.match(/<p>/g) || []).length, 0, html);
  assert.match(html, /Sous-item un\./, 'la sous-liste a perdu un item : ' + html);
  assert.match(html, /Sous-item deux\./, html);
  assert.strictEqual((html.match(/<ul>/g) || []).length, 2, 'la sous-liste n\'est plus imbriquée : ' + html);
});

// ── szh-meta.lua : import DOCX, retire du corps ce qui est déjà parti en meta.yaml ─────
// pipeline/import-docx.sh (docx -> markdown) le place en tête de chaîne, avant
// szh-legendes et szh-titres. SZH_META pointe un fichier « LETTRE<TAB>valeur » écrit par
// docx-meta.py. Sortie observée : le texte du corps une fois le filtre passé.
const META_DUP = 'Ligne a retirer.\n\nLigne a retirer.\n\nCorps du texte.\n';

test('méta (préparation) : sans SZH_META, les deux paragraphes dupliqués restent', () => {
  const md = pandoc(META_DUP, { vers: 'markdown' });
  assert.strictEqual((md.match(/Ligne a retirer\./g) || []).length, 2, md);
});

test('méta : une ligne P ne retire qu\'une occurrence, la première — file de consommation', () => {
  const instr = instructionsTemporaires('P\tLigne a retirer.\n');
  try {
    const md = pandoc(META_DUP, { vers: 'markdown', filtres: ['szh-meta.lua'], env: { SZH_META: instr.chemin } });
    assert.strictEqual((md.match(/Ligne a retirer\./g) || []).length, 1,
      'la ligne P devait retirer une seule occurrence, pas les deux ni aucune : ' + md);
    assert.match(md, /Corps du texte\./, md);
  } finally { instr.nettoyer(); }
});

// Cas limite : G<TAB>n retire les n premiers paragraphes-image de la ZONE DE TÊTE
// seulement — une image du corps, après le premier texte réel, n'est jamais touchée.
// ⚠ ENTRÉE NATIVE, PAS MARKDOWN : le lecteur markdown de pandoc 3.9 range un paragraphe
//   ne contenant qu'une image dans un bloc Figure (implicit_figures), que
//   bloc_image_seule() ne reconnaît pas (elle teste Para/Plain). Le lecteur docx, lui,
//   rend un paragraphe-image ordinaire en Para/Plain — la forme que native reproduit ici.
//   Un essai en markdown ne prouverait donc rien de ce que ce filtre voit vraiment.
const META_LOGO_NATIVE = '[ Para [Image ("",[],[]) [Str "logo"] ("logo.png","")]\n'
  + ', Para [Str "Corps",Space,Str "du",Space,Str "texte."]\n'
  + ', Para [Image ("",[],[]) [Str "figure"] ("figure.png","")]\n'
  + ']\n';

test('méta : G retire le logo de tête, jamais une image du corps', () => {
  const instr = instructionsTemporaires('G\t1\n');
  try {
    const md = pandoc(META_LOGO_NATIVE, { de: 'native', vers: 'markdown',
      filtres: ['szh-meta.lua'], env: { SZH_META: instr.chemin } });
    assert.ok(!/logo\.png/.test(md), 'le logo de tête n\'a pas été retiré : ' + md);
    assert.match(md, /figure\.png/, 'une image du corps a été retirée à tort : ' + md);
    assert.match(md, /Corps du texte\./, md);
  } finally { instr.nettoyer(); }
});

// ── szh-titres.lua : import DOCX, promeut un paragraphe en Header ──────────────────────
// pipeline/import-docx.sh, juste après szh-legendes. SZH_TITRES pointe un fichier
// « niveau<TAB>texte » écrit par docx-titres.py (tailles de police perdues par pandoc).
const TITRE_PARA = 'Ceci est un titre de section.\n\nTexte normal qui suit.\n';

test('titres (préparation) : sans SZH_TITRES, le paragraphe reste un paragraphe', () => {
  const md = pandoc(TITRE_PARA, { vers: 'markdown' });
  assert.ok(!/^#/m.test(md), 'un titre existe déjà sans le filtre : ' + md);
});

test('titres : une correspondance promeut le paragraphe au niveau demandé', () => {
  const instr = instructionsTemporaires('2\tCeci est un titre de section.\n');
  try {
    const md = pandoc(TITRE_PARA, { vers: 'markdown', filtres: ['szh-titres.lua'], env: { SZH_TITRES: instr.chemin } });
    assert.match(md, /^## Ceci est un titre de section\.$/m, md);
    assert.match(md, /^Texte normal qui suit\.$/m, 'le paragraphe suivant a été touché : ' + md);
  } finally { instr.nettoyer(); }
});

// Cas limite : un titre saisi en gras dans Word (souvent une entorse au style) doit être
// promu SANS garder le gras — deballer() défait Strong/Emph/Underline/Span.
const TITRE_GRAS = '**Titre en gras**\n\nTexte suivant.\n';

test('titres : un paragraphe en gras est promu sans garder sa mise en forme', () => {
  const instr = instructionsTemporaires('3\tTitre en gras\n');
  try {
    const md = pandoc(TITRE_GRAS, { vers: 'markdown', filtres: ['szh-titres.lua'], env: { SZH_TITRES: instr.chemin } });
    assert.match(md, /^### Titre en gras$/m, 'le titre garde son gras, ou n\'a pas été promu : ' + md);
  } finally { instr.nettoyer(); }
});

// ── szh-tabelle-reference.lua : import DOCX, un tableau devient une référence ──────────
// pipeline/import-docx.sh, après szh-titres. Le rendu réel est fait avant pandoc par
// docx-tables.py ; ce filtre ne pose qu'une référence numérotée, alignée sur son ordre.
const TABLE_SIMPLE = '| A | B |\n|---|---|\n| 1 | 2 |\n';

test('tabelle-reference (préparation) : sans le filtre, aucune référence szh-tabelle', () => {
  const md = pandoc(TABLE_SIMPLE, { vers: 'markdown' });
  assert.ok(!/szh-tabelle/.test(md), md);
});

test('tabelle-reference : un tableau devient une référence vers tables/table-01.html', () => {
  const md = pandoc(TABLE_SIMPLE, { vers: 'markdown', filtres: ['szh-tabelle-reference.lua'] });
  assert.match(md, /src="tables\/table-01\.html"/, md);
});

// Cas limite : deux tableaux de premier niveau, numérotés dans l'ordre du document.
const DEUX_TABLES = TABLE_SIMPLE + '\nTexte entre les deux.\n\n| C | D |\n|---|---|\n| 3 | 4 |\n';

test('tabelle-reference : deux tableaux sont numérotés 01 puis 02, dans l\'ordre', () => {
  const md = pandoc(DEUX_TABLES, { vers: 'markdown', filtres: ['szh-tabelle-reference.lua'] });
  assert.match(md, /table-01\.html/, md);
  assert.match(md, /table-02\.html/, md);
  assert.ok(md.indexOf('table-01.html') < md.indexOf('table-02.html'), 'l\'ordre n\'est pas respecté : ' + md);
});

// ── szh-livre-auteurs.lua : livre seulement, la ligne d'auteur·e·s d'un chapitre ───────
// pipeline/profils/livre.mk, après szh-sections. Décide sur SZH_LIVRE (posée par le
// Makefile livre, jamais par celui de la revue) et sur la clé `ouvrage` de la fiche.
const CHAPITRE_MD = '---\nlang: fr\nouvrage: collectif\nauthor:\n'
  + '  - prenom: "Jean"\n    nom: "Dupont"\n  - prenom: "Marie"\n    nom: "Martin"\n---\n\n'
  + '# Titre du chapitre\n\nTexte du chapitre.\n';

test('livre-auteurs (préparation) : sans SZH_LIVRE, aucune ligne n\'est insérée', () => {
  const html = pandoc(CHAPITRE_MD, { vers: 'html5', filtres: ['szh-livre-auteurs.lua'] });
  assert.ok(!/szh-auteurs/.test(html), 'une ligne d\'auteurs existe déjà sans SZH_LIVRE : ' + html);
});

test('livre-auteurs : sous SZH_LIVRE, un chapitre collectif reçoit sa ligne sous le titre', () => {
  const html = pandoc(CHAPITRE_MD, { vers: 'html5', filtres: ['szh-livre-auteurs.lua'], env: { SZH_LIVRE: '1' } });
  assert.match(html, /<h1[^>]*>Titre du chapitre<\/h1>\s*<p class="szh-auteurs">De Jean Dupont et Marie Martin<\/p>/,
    html);
});

// Cas limite : une monographie ne reçoit jamais la ligne, même avec des auteur·e·s dans
// la fiche — ce sont les auteur·e·s du LIVRE, les répéter à chaque chapitre serait faux.
const CHAPITRE_MONO = CHAPITRE_MD.replace('ouvrage: collectif', 'ouvrage: monographie');

test('livre-auteurs : une monographie ne reçoit jamais de ligne, quels que soient les auteurs', () => {
  const html = pandoc(CHAPITRE_MONO, { vers: 'html5', filtres: ['szh-livre-auteurs.lua'], env: { SZH_LIVRE: '1' } });
  assert.ok(!/szh-auteurs/.test(html), html);
});

// ── szh-tableau-boite.lua : enveloppe chaque tableau pour ne pas le voir couper ────────
// pipeline/Makefile, après szh-numerotation. Corrige un plantage WeasyPrint
// (« Table wrapper without a table ») que le Makefile rattrape en PDF NON balisé, sans
// un mot — voir la tête du filtre. Deux formes à couvrir : un Table pandoc, et un tableau
// déjà réinjecté en RawBlock html (szh-tabelle-inclure).
test('tableau-boite (préparation) : sans le filtre, un <table> n\'est enveloppé de rien', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5' });
  assert.ok(!/szh-tableau-boite/.test(html), html);
});

test('tableau-boite : un tableau markdown est enveloppé dans un <div> dédié', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5', filtres: ['szh-tableau-boite.lua'] });
  assert.match(html, /<div class="szh-tableau-boite">\s*<table>/, html);
});

// Cas limite : un tableau réinjecté en RawBlock (contient « <table ») est enveloppé, un
// RawBlock qui ne fait que MENTIONNER le mot « table » sans balise ne l'est pas.
const RAW_TABLE_ET_TEXTE = '[ RawBlock (Format "html") "<table><tr><td>x</td></tr></table>"\n'
  + ', RawBlock (Format "html") "<p>Ceci mentionne le mot table sans balise.</p>"\n]\n';

test('tableau-boite : un tableau réinjecté est enveloppé, une simple mention du mot ne l\'est pas', () => {
  const html = pandoc(RAW_TABLE_ET_TEXTE, { de: 'native', vers: 'html5', filtres: ['szh-tableau-boite.lua'] });
  assert.strictEqual((html.match(/class="szh-tableau-boite"/g) || []).length, 1,
    'zéro ou plus d\'une enveloppe : ' + html);
  assert.match(html, /<div class="szh-tableau-boite">\s*<table><tr><td>x<\/td><\/tr><\/table>\s*<\/div>/, html);
  assert.match(html, /<p>Ceci mentionne le mot table sans balise\.<\/p>/, html);
});

// ── szh-titre-metriques.lua : la table de largeurs d'avance, chargée par dofile ────────
// Ce fichier ne branche aucune fonction d'élément pandoc (Meta, Header, …) : c'est une
// table de données pure, lue par szh-titre-lignes.lua via dofile — le passer en
// --lua-filter ne ferait tourner aucun code utile (voir pandocLua ci-dessus). Sortie
// observée : le contenu de la table elle-même, par l'interprète Lua de pandoc.
test('titre-metriques : upem, repli et deux avances connues (A, é)', () => {
  const chemin = path.join(FILTRES, 'szh-titre-metriques.lua').replace(/\\/g, '/');
  const sortie = pandocLua('local m = dofile([[' + chemin + ']]); '
    + 'print(m.upem, m.defaut, m.avance[65], m.avance[233])');
  assert.strictEqual(sortie.trim(), '2048\t975\t1173\t1036',
    'la table de métriques ne correspond plus à la police livrée : ' + sortie);
});

// Cas limite : un caractère absent de la table (ici une lettre cyrillique, jamais
// rencontrée dans un titre de la maquette) ne doit RIEN valoir — szh-titre-lignes.lua
// retombe alors sur `defaut`, mais la table elle-même ne doit jamais fabriquer d'entrée.
test('titre-metriques : un caractère hors table ne vaut rien, il n\'est pas inventé', () => {
  const chemin = path.join(FILTRES, 'szh-titre-metriques.lua').replace(/\\/g, '/');
  const sortie = pandocLua('local m = dofile([[' + chemin + ']]); print(m.avance[1040] == nil)');
  assert.strictEqual(sortie.trim(), 'true', sortie);
});

// ── szh-titre-lignes.lua : coupe le titre de couverture en escalier ────────────────────
// pipeline/Makefile, juste après szh-typographie — impératif, voir la tête du filtre :
// les insécables (L2) doivent déjà être posées avant de mesurer. Lit la géométrie réelle
// dans pipeline/styles/socle.css et print.css, et la table de szh-titre-metriques.lua.
// Sortie observée : la clé `titre-lignes` du bloc YAML (writer markdown --standalone).
//
// Le titre du cas nominal est celui cité dans le commentaire de tête du filtre lui-même
// (le défaut qu'il corrige, mesuré sur un vrai numéro) : pas de largeur inventée ici, la
// preuve tient sur le CONTENU reconstitué, jamais sur la position exacte de la coupure —
// qui bougerait si la police, la taille du hero ou les marges de page changeaient.
const BR_TITRE_LIGNE = '`<br class="szh-titre-ligne" />`{=html}';

function docTitre(titre) {
  return '---\nlang: fr\ntitle:\n  fr: "Titre"\ntitre-affiche: "' + titre + '"\n---\n\nCorps.\n';
}

function champYaml(md, cle) {
  const m = md.replace(/\r\n/g, '\n').match(new RegExp('\\n' + cle + ': (.*)\\n'));
  return m ? m[1] : null;
}

test('titre-lignes (préparation) : sans le filtre, jamais de clé titre-lignes', () => {
  const md = pandoc(docTitre('Les personnes en situation de handicap comme partenaires'),
    { vers: 'markdown', standalone: true, filtres: ['szh-typographie.lua'] });
  assert.strictEqual(champYaml(md, 'titre-lignes'), null, md);
});

test('titre-lignes : un titre qui déborde reçoit un escalier, le texte est intact', () => {
  const titre = 'Les personnes en situation de handicap comme partenaires';
  const md = pandoc(docTitre(titre), { vers: 'markdown', standalone: true,
    filtres: ['szh-typographie.lua', 'szh-titre-lignes.lua'] });
  const lignes = champYaml(md, 'titre-lignes');
  assert.ok(lignes, 'aucune clé titre-lignes posée pour un titre connu pour déborder : ' + md);
  const morceaux = lignes.split(BR_TITRE_LIGNE);
  assert.strictEqual(morceaux.length, 2, 'pas exactement une coupure : ' + lignes);
  const reconstitue = morceaux.map((s) => s.trim()).join(' ');
  assert.strictEqual(reconstitue, titre, 'le texte du titre n\'est plus intact : ' + reconstitue);
});

// Cas limite : un titre d'un seul mot ne peut jamais former d'escalier (il faut au moins
// deux groupes insécables) — vrai quelle que soit la géométrie lue, donc indépendant de
// tout changement futur de socle.css/print.css.
test('titre-lignes : un titre d\'un seul mot ne reçoit jamais d\'escalier', () => {
  const md = pandoc(docTitre('Unique'), { vers: 'markdown', standalone: true,
    filtres: ['szh-typographie.lua', 'szh-titre-lignes.lua'] });
  assert.strictEqual(champYaml(md, 'titre-lignes'), null, md);
});

// ── szh-tabelle-scope.lua : scope="col"/"row" sur les <th> (RGAA 5.7) ──────────────────
// pipeline/Makefile, après szh-tabelle-inclure. Les colonnes d'en-tête de RANGÉE
// n'existent pas dans la syntaxe pipe-table de markdown : reproduites en native, comme
// szh-legendes.lua le fait pour une Figure que le markdown ne sait pas écrire à la main.
test('tabelle-scope (préparation) : sans le filtre, un <th> ne porte aucun scope', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5' });
  assert.ok(!/scope=/.test(html), html);
});

test('tabelle-scope : les cellules du thead reçoivent scope="col"', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5', filtres: ['szh-tabelle-scope.lua'] });
  assert.match(html, /<th scope="col">A<\/th>/, html);
  assert.match(html, /<th scope="col">B<\/th>/, html);
});

// Cas limite : une colonne d'en-tête de rangée (row_head_columns > 0, ce que seul un
// lecteur comme docx pose) reçoit scope="row", jamais "col".
const TABLE_ENTETE_RANGEE = '[ Table ("",[],[]) (Caption Nothing [])\n'
  + '  [(AlignDefault,ColWidthDefault),(AlignDefault,ColWidthDefault)]\n'
  + '  (TableHead ("",[],[]) [Row ("",[],[]) ['
  + 'Cell ("",[],[]) AlignDefault (RowSpan 1) (ColSpan 1) [Plain [Str "Entete"]], '
  + 'Cell ("",[],[]) AlignDefault (RowSpan 1) (ColSpan 1) [Plain [Str "B"]]]])\n'
  + '  [TableBody ("",[],[]) (RowHeadColumns 1) []\n'
  + '    [ Row ("",[],[]) [Cell ("",[],[]) AlignDefault (RowSpan 1) (ColSpan 1) [Plain [Str "Ligne1"]], '
  + 'Cell ("",[],[]) AlignDefault (RowSpan 1) (ColSpan 1) [Plain [Str "1"]]]\n'
  + '    ]]\n  (TableFoot ("",[],[]) [])\n]\n';

test('tabelle-scope : une colonne d\'en-tête de rangée reçoit scope="row"', () => {
  const html = pandoc(TABLE_ENTETE_RANGEE, { de: 'native', vers: 'html5', filtres: ['szh-tabelle-scope.lua'] });
  assert.match(html, /<th scope="row">Ligne1<\/th>/, html);
  assert.match(html, /<th scope="col">Entete<\/th>/, 'le thead a perdu son scope="col" : ' + html);
});

// ── szh-galley-docx.lua : nettoie le galley Word de l'export OJS ───────────────────────
// pipeline/Makefile, seul filtre de la recette HTML -> docx (--from=html). Le lecteur
// html ne voit pas le CSS : ce que print.css masque à l'écran/au PDF réapparaîtrait en
// clair dans le Word si ce filtre ne le retirait pas.
const GALLEY_HTML = '<div class="szh-description">Description longue.</div>'
  + '<div class="szh-encadre">Encadre normal.</div><p>Paragraphe normal.</p>';

test('galley-docx (préparation) : sans le filtre, la description technique est présente', () => {
  const md = pandoc(GALLEY_HTML, { de: 'html', vers: 'markdown' });
  assert.match(md, /szh-description/, md);
});

test('galley-docx : la description technique disparaît, le reste du galley survit', () => {
  const md = pandoc(GALLEY_HTML, { de: 'html', vers: 'markdown', filtres: ['szh-galley-docx.lua'] });
  assert.ok(!/szh-description/.test(md), md);
  assert.match(md, /szh-encadre/, 'un bloc normal a été retiré à tort : ' + md);
  assert.match(md, /Paragraphe normal\./, md);
});

// Cas limite : un Div à DEUX classes, dont szh-description, doit disparaître ENTIER — ce
// n'est pas un filtrage attribut par attribut, tout le bloc technique s'en va.
const GALLEY_MIXTE = '<div class="autre szh-description">Cas mixte a retirer.</div>';

test('galley-docx : un Div à deux classes dont szh-description disparaît entièrement', () => {
  const md = pandoc(GALLEY_MIXTE, { de: 'html', vers: 'markdown', filtres: ['szh-galley-docx.lua'] });
  assert.ok(!/Cas mixte a retirer/.test(md), 'le Div mixte a survécu en partie ou en totalité : ' + md);
});
