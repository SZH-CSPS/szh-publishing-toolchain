// Teste sous pandoc des filtres Lua de l'import, du livre et du galley (pipeline/Makefile,
// pipeline/profils/livre.mk, pipeline/import-docx.sh). Même patron que
// test/filtres-pandoc.test.js, à lire d'abord : une paire « préparation » (le défaut
// existe sans le filtre) et « filtré » (le filtre change la forme), des comparaisons sur
// des structures stables plutôt que sur une balise exacte. Sans pandoc, les tests échouent.
//
//   node --test test/filtres-import.test.js
//
// Données en ASCII : le pandoc 3.9 de Windows plie mal les majuscules accentuées. Le
// fichier tourne avec le pandoc du PATH, pas forcément celui de la WSL qui compile : les
// assertions portent sur des comptes et des motifs stables, pas sur une balise ou un
// nombre de colonnes qui varie d'une version à l'autre.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { spawnSync } = require('child_process');

const RACINE = path.resolve(__dirname, '..');
const FILTRES = path.join(RACINE, 'pipeline', 'filters');

// Même fonction que dans filtres-pandoc.test.js, plus `env` : szh-meta, szh-titres,
// szh-livre-auteurs et szh-notes lisent une variable d'environnement.
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

// szh-meta.lua et szh-titres.lua lisent leurs instructions dans un fichier dont le chemin
// est dans SZH_META ou SZH_TITRES. Un dossier jetable par appel, nettoyé même en cas
// d'échec.
function instructionsTemporaires(contenu) {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-import-'));
  const chemin = path.join(dossier, 'instructions.txt');
  fs.writeFileSync(chemin, contenu, 'utf8');
  return { chemin: chemin, nettoyer: function () { fs.rmSync(dossier, { recursive: true, force: true }); } };
}

// Lance un script par l'interprète Lua de pandoc (`pandoc lua`), pour lire
// szh-titre-metriques.lua : c'est une table de données, pas un filtre.
function pandocLua(script) {
  const r = spawnSync('pandoc', ['lua', '-e', script], { encoding: 'utf8' });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  if (r.status !== 0) { throw new Error('pandoc lua a échoué : ' + r.stderr); }
  return r.stdout;
}

// ── szh-notes.lua : les notes de bas de page groupées en fin de writer HTML ────────────
// Dernier filtre de la chaîne PDF (--to=html5) ; inactif en EPUB et sous SZH_APERCU=1.
// Sortie observée : un <span class="szh-note"> à la place du renvoi numéroté.
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

// Cas limite : une note de deux paragraphes devient une seule ligne, jointe par une
// espace. La zone @footnote de WeasyPrint ne sait pas composer deux <p> dans un <span>.
const NOTE_DEUX_BLOCS = 'Un texte avec un appel[^1].\n\n[^1]: Premiere phrase de la note.\n\n'
  + '    Seconde phrase de la note.\n';

test('notes : une note à deux paragraphes est aplatie en une seule ligne', () => {
  const html = pandoc(NOTE_DEUX_BLOCS, { vers: 'html5', filtres: ['szh-notes.lua'] });
  assert.match(html, /<span class="szh-note">Premiere phrase de la note\. Seconde phrase de la note\.<\/span>/,
    'les deux paragraphes ne sont pas joints par une espace, ou un <p> a survécu : ' + html);
  assert.strictEqual((html.match(/<span class="szh-note">/g) || []).length, 1, html);
});

// ── szh-listes-serrees.lua : une liste qui reprend à « 7. » garde son rang ──────────────
// WeasyPrint ignore l'attribut start d'un <ol> : la liste porte son rang dans une boîte
// enveloppe (.szh-liste-rang, --szh-rang), que partage-filtres.css lit en counter-reset.
const LISTE_REPRISE = 'Texte.\n\n7. Sieben\n8. Acht\n';

test('listes : une liste qui commence à 7 est enveloppée avec son rang de départ', () => {
  const html = pandoc(LISTE_REPRISE, { vers: 'html5', filtres: ['szh-listes-serrees.lua'] });
  assert.match(html, /<div class="szh-liste-rang" style="--szh-rang: 6">\s*<ol start="7"/, html);
});

test('listes : une liste qui commence à 1 reste nue', () => {
  const html = pandoc('1. Eins\n2. Zwei\n', { vers: 'html5', filtres: ['szh-listes-serrees.lua'] });
  assert.doesNotMatch(html, /szh-liste-rang/, html);
});

// ── szh-listes-serrees.lua : une liste lâche perd ses <p> internes (PDF/UA-1 7.2-20) ───
// Dans les chaînes PDF et aperçu, avant szh-tabelle-inclure. Sortie observée : le nombre
// de <p> dans la liste.
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

// Cas limite : un item « texte + sous-liste ». Le texte perd son <p>, la sous-liste reste
// intacte (elle est déjà conforme PDF/UA).
const LISTE_MIXTE = '- Texte de tete.\n\n  - Sous-item un.\n  - Sous-item deux.\n';

test('listes : un item « texte + sous-liste », le texte perd son <p>, la sous-liste reste intacte', () => {
  const html = pandoc(LISTE_MIXTE, { vers: 'html5', filtres: ['szh-listes-serrees.lua'] });
  assert.strictEqual((html.match(/<p>/g) || []).length, 0, html);
  assert.match(html, /Sous-item un\./, 'la sous-liste a perdu un item : ' + html);
  assert.match(html, /Sous-item deux\./, html);
  assert.strictEqual((html.match(/<ul>/g) || []).length, 2, 'la sous-liste n\'est plus imbriquée : ' + html);
});

// ── szh-meta.lua : import DOCX, retire du corps ce qui est déjà parti en meta.yaml ─────
// En tête de la chaîne d'import (pipeline/import-docx.sh), avant szh-legendes et
// szh-titres. SZH_META désigne un fichier « LETTRE<TAB>valeur » écrit par docx-meta.py.
// Sortie observée : le texte du corps après le filtre.
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

// Cas limite : G<TAB>n retire les n premiers paragraphes-image de la zone de tête
// seulement ; une image du corps, après le premier texte, reste.
// Entrée en format native : le lecteur markdown met une image seule dans un bloc Figure,
// alors que le lecteur docx de la vraie chaîne rend un Para, la forme que teste
// bloc_image_seule().
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

// ── szh-legendes.lua : les champs d'un bloc du gabarit Pronto ──────────────────────────
// Dans pipeline/import-docx.sh, juste après szh-meta.lua. Une ligne FI de $SZH_META donne,
// pour une image, ce qui a été tapé sous « Légende : », « Texte alternatif : »,
// « Crédit : » et « Source : ». Sans ce filtre, ces quatre paragraphes s'imprimeraient au
// milieu de l'article et le texte alternatif serait perdu.
//
// Entrée en format native, comme pour le logo ci-dessus : para_image() reconnaît le Para
// que rend le lecteur docx.
const FIGURE_NATIVE = '[ Para [Image ("",[],[]) [] ("media/image1.png","")]\n'
  + ', Para [Str "Corps",Space,Str "du",Space,Str "texte."]\n'
  + ']\n';

test('legendes (préparation) : sans ligne FI, l\'image reste nue', () => {
  const md = pandoc(FIGURE_NATIVE, { de: 'native', vers: 'markdown', filtres: ['szh-legendes.lua'] });
  assert.ok(!/copyright=/.test(md), 'un crédit est apparu sans instruction : ' + md);
  assert.match(md, /!\[\]\(media\/image1\.png\)/, md);
});

test('legendes : une ligne FI pose légende, texte alternatif, crédit et source sur l\'image', () => {
  // Deux noms séparés par « | » : une image vectorielle en porte deux dans le .docx (l'aperçu
  // PNG et le SVG qu'écrit pandoc). L'un ou l'autre suffit.
  const instr = instructionsTemporaires(
    'FI\tmedia-inconnue.png|image1.png\tUne legende\tUn texte alternatif\t(c) X\tArchives Y\n');
  try {
    const md = pandoc(FIGURE_NATIVE, { de: 'native', vers: 'markdown',
      filtres: ['szh-legendes.lua'], env: { SZH_META: instr.chemin } });
    assert.match(md, /!\[Une legende\]/, 'la légende n\'est pas devenue celle de l\'image : ' + md);
    assert.match(md, /alt="Un texte alternatif"/, 'le texte alternatif n\'est pas posé : ' + md);
    assert.match(md, /copyright="\(c\) X"/, 'le crédit n\'est pas posé : ' + md);
    assert.match(md, /source="Archives Y"/, 'la source n\'est pas posée : ' + md);
    assert.match(md, /Corps du texte\./, 'le corps a été abîmé : ' + md);
  } finally { instr.nettoyer(); }
});

test('legendes : une ligne FI l\'emporte sur un voisin en gras, qui ne vole plus la légende', () => {
  // Quand les champs du gabarit sont remplis, la règle du voisinage ne s'applique pas :
  // sinon un intertitre en gras juste au-dessus de la figure deviendrait sa légende.
  const avecVoisin = '[ Para [Strong [Str "Un",Space,Str "intertitre",Space,Str "en",Space,Str "gras"]]\n'
    + ', Para [Image ("",[],[]) [] ("media/image1.png","")]\n'
    + ']\n';
  const instr = instructionsTemporaires('FI\timage1.png\tUne legende\t\t\t\n');
  try {
    const md = pandoc(avecVoisin, { de: 'native', vers: 'markdown',
      filtres: ['szh-legendes.lua'], env: { SZH_META: instr.chemin } });
    assert.match(md, /!\[Une legende\]/, 'la légende du gabarit devait l\'emporter : ' + md);
    assert.match(md, /intertitre en gras/, 'le voisin en gras a été mangé : ' + md);
  } finally { instr.nettoyer(); }
});

// ── szh-legendes.lua : les groupes d'images ──────────────────────────────────────────────
// Un en-tête de figure suivi de plusieurs images forme une seule figure, le groupe
// `.szh-grille` que crée « Ajouter une image à côté » dans le formulaire Médias. Trois
// formes dans le Word : (a) deux images dans le même paragraphe, (b) plusieurs paragraphes
// d'images à la suite, (c) un tableau de mise en page qui ne porte que des images (ligne
// FG, szh-meta.lua puis szh-legendes.lua). Les clés ne quittent le corps qu'une fois leurs
// valeurs posées ; sinon elles restent, avec un avertissement.

const refsCockpit = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'lib',
  'references.js'));

function pandocAvecErreurs(entree, options) {
  const o = options || {};
  const args = ['--from=' + (o.de || 'native'), '--to=markdown', '--wrap=none'];
  for (const f of (o.filtres || [])) { args.push('--lua-filter=' + path.join(FILTRES, f)); }
  const r = spawnSync('pandoc', args, { input: entree, encoding: 'utf8',
    env: Object.assign({}, process.env, o.env || {}) });
  if (r.error) { throw new Error('pandoc introuvable : ' + r.error.message); }
  if (r.status !== 0) { throw new Error('pandoc a échoué : ' + r.stderr); }
  return { md: r.stdout, err: r.stderr };
}

const CLES_NATIVES = ', Para [Str "Legende",Space,Str ":",Space,Str "Deux",Space,Str "vues"]\n'
  + ', Para [Str "Texte",Space,Str "alternatif",Space,Str ":",Space,Str "Vue",Space,Str "nord"]\n'
  + ', Para [Str "Credit",Space,Str ":",Space,Str "(c)",Space,Str "X"]\n';
const IMG_A = 'Image ("",[],[]) [Str "descr",Space,Str "A"] ("media/image1.png","")';
const IMG_B = 'Image ("",[],[]) [Str "descr",Space,Str "B"] ("media/image2.png","")';
// Source puis note, vides, avant les clés : le champ note est toujours présent.
const QUEUE_CLES = '\t\tLegende : Deux vues\tTexte alternatif : Vue nord\tCredit : (c) X';
const FI_GROUPE = 'FI\timage1.png;image2.png\tDeux vues\tVue nord\t(c) X\t' + QUEUE_CLES + '\n';

// Les membres de la grille lus comme le fait le formulaire Médias : le groupe importé
// s'édite comme un groupe créé dans le cockpit.
function grillesDuCockpit(md) {
  return refsCockpit.lireGrilles(md.replace(/\r\n/g, '\n'));
}

test('legendes (a) : deux images dans un paragraphe -> UN groupe, légende, alt et crédit posés, clés retirées', () => {
  const doc = '[ Para [Str "Avant."]\n' + CLES_NATIVES
    + ', Para [' + IMG_A + ',Space,' + IMG_B + ']\n, Para [Str "Apres."]\n]\n';
  const instr = instructionsTemporaires(FI_GROUPE);
  try {
    const { md, err } = pandocAvecErreurs(doc, { filtres: ['szh-legendes.lua'],
      env: { SZH_META: instr.chemin } });
    const grilles = grillesDuCockpit(md);
    assert.strictEqual(grilles.length, 1, 'aucun groupe, ou plusieurs : ' + md);
    assert.deepStrictEqual(grilles[0].membres.map((m) => m.relatif), ['image1.png', 'image2.png'],
      'le formulaire Médias ne relirait pas les deux images du groupe : ' + md);
    assert.strictEqual(grilles[0].disposition, '2', 'deux images côte à côte dans le Word : ' + md);
    const lignes = md.split(/\r?\n/).filter((l) => /!\[/.test(l));
    assert.strictEqual(lignes.length, 2, 'une image par ligne, sans ligne vide : ' + md);
    assert.match(lignes[0], /^\s*!\[Deux vues\]\(media\/image1\.png\)\{[^}]*alt="Vue nord"/, md);
    assert.match(lignes[1], /^\s*!\[\]\(media\/image2\.png\)\{[^}]*alt="descr B"/,
      'la seconde image garde la description Word, sans légende propre : ' + md);
    assert.strictEqual((md.match(/copyright="\(c\) X"/g) || []).length, 2,
      'le crédit doit suivre chaque image du groupe : ' + md);
    assert.ok(!/Legende :|Texte alternatif :|Credit :/.test(md), 'une clé est restée : ' + md);
    assert.match(md, /Avant\./, md);
    assert.match(md, /Apres\./, md);
    assert.ok(!/bloc-valeur-non-reprise/.test(err), 'un bloc posé ne doit pas avertir : ' + err);
  } finally { instr.nettoyer(); }
});

test('legendes : la note d’un bloc figure se pose sur l’image, et sur la PREMIÈRE seulement d’un groupe', () => {
  const doc = '[ Para [Str "Avant."]\n' + CLES_NATIVES
    + ', Para [' + IMG_A + ',Space,' + IMG_B + ']\n, Para [Str "Apres."]\n]\n';
  // Champs : k, légende, alt, copyright, source, note, puis les clés.
  const instr = instructionsTemporaires(
    'FI\timage1.png;image2.png\tDeux vues\tVue nord\t(c) X\tArchives\tDonnees 2025.' + QUEUE_CLES.slice(1) + '\n');
  try {
    const { md, err } = pandocAvecErreurs(doc, { filtres: ['szh-legendes.lua'],
      env: { SZH_META: instr.chemin } });
    const lignes = md.split(/\r?\n/).filter((l) => /!\[/.test(l));
    assert.strictEqual(lignes.length, 2, md);
    assert.match(lignes[0], /note="Donnees 2025\."/, 'la note manque sur la 1re image : ' + md);
    assert.ok(!/note=/.test(lignes[1]), 'la note est recopiée sur la 2e image : ' + md);
    assert.strictEqual((md.match(/source="Archives"/g) || []).length, 2,
      'la source doit rester sur chaque image : ' + md);
    assert.ok(!/Legende :/.test(md), 'une clé est restée : ' + md);
    assert.ok(!/bloc-valeur-non-reprise/.test(err), err);
  } finally { instr.nettoyer(); }
});

test('legendes : la note d’une figure simple, et le champ note vide ne pose rien', () => {
  const instr = instructionsTemporaires(
    'FI\timage1.png\tUne legende\tUn alt\t(c) X\tArchives\tUne note.\n');
  const vide = instructionsTemporaires('FI\timage1.png\tUne legende\tUn alt\t(c) X\tArchives\t\n');
  try {
    const avec = pandoc(FIGURE_NATIVE, { de: 'native', vers: 'markdown',
      filtres: ['szh-legendes.lua'], env: { SZH_META: instr.chemin } });
    assert.match(avec, /note="Une note\."/, avec);
    const sans = pandoc(FIGURE_NATIVE, { de: 'native', vers: 'markdown',
      filtres: ['szh-legendes.lua'], env: { SZH_META: vide.chemin } });
    assert.ok(!/note=/.test(sans), 'un note="" est apparu : ' + sans);
    assert.match(sans, /source="Archives"/, sans);
  } finally { instr.nettoyer(); vide.nettoyer(); }
});

test('legendes : sans légende, une note ou un copyright font une image hors numérotation', () => {
  const instr = instructionsTemporaires('FI\timage1.png\t\tUn alt\t\t\tUne note seule.\n');
  const rien = instructionsTemporaires('FI\timage1.png\t\tUn alt\t\t\t\n');
  try {
    const avec = pandoc(FIGURE_NATIVE, { de: 'native', vers: 'markdown',
      filtres: ['szh-legendes.lua'], env: { SZH_META: instr.chemin } });
    assert.match(avec, /szh-hors-figure/, 'la note sans légende se perdrait au rendu : ' + avec);
    assert.match(avec, /note="Une note seule\."/, avec);
    const sans = pandoc(FIGURE_NATIVE, { de: 'native', vers: 'markdown',
      filtres: ['szh-legendes.lua'], env: { SZH_META: rien.chemin } });
    assert.ok(!/szh-hors-figure/.test(sans), 'rien à porter : la classe ne doit pas être posée : ' + sans);
  } finally { instr.nettoyer(); rien.nettoyer(); }
});

test('legendes (b) : deux paragraphes d’images à la suite -> UN groupe, côte à côte (« 2 », jamais « 1-1 »)', () => {
  const doc = '[' + CLES_NATIVES.slice(1) + ', Para [' + IMG_A + ']\n, Para [' + IMG_B + ']\n]\n';
  const instr = instructionsTemporaires(FI_GROUPE);
  try {
    const { md } = pandocAvecErreurs(doc, { filtres: ['szh-legendes.lua'],
      env: { SZH_META: instr.chemin } });
    const grilles = grillesDuCockpit(md);
    assert.strictEqual(grilles.length, 1, md);
    assert.strictEqual(grilles[0].membres.length, 2, md);
    assert.strictEqual(grilles[0].disposition, '2',
      'décision de Robin : deux images côte à côte, une seule rangée : ' + md);
    assert.strictEqual((md.match(/!\[Deux vues\]/g) || []).length, 1,
      'une seule légende pour le groupe : ' + md);
  } finally { instr.nettoyer(); }
});

test('legendes (b) : trois paragraphes d’une image -> « 3 » ; deux paragraphes de deux images gardent leurs rangées (« 2-2 »)', () => {
  const IMG = (n) => 'Image ("",[],[]) [] ("media/image' + n + '.png","")';
  const trois = '[' + CLES_NATIVES.slice(1) + [1, 2, 3].map((n) => ', Para [' + IMG(n) + ']\n').join('') + ']\n';
  const i3 = instructionsTemporaires('FI\timage1.png;image2.png;image3.png\tDeux vues\t\t\t\t' + QUEUE_CLES + '\n');
  try {
    const { md } = pandocAvecErreurs(trois, { filtres: ['szh-legendes.lua'], env: { SZH_META: i3.chemin } });
    assert.strictEqual(grillesDuCockpit(md)[0].disposition, '3', md);
  } finally { i3.nettoyer(); }
  const deuxDeux = '[' + CLES_NATIVES.slice(1) + ', Para [' + IMG(1) + ',Space,' + IMG(2) + ']\n'
    + ', Para [' + IMG(3) + ',Space,' + IMG(4) + ']\n]\n';
  const i4 = instructionsTemporaires('FI\timage1.png;image2.png;image3.png;image4.png\tDeux vues\t\t\t\t' + QUEUE_CLES + '\n');
  try {
    const { md } = pandocAvecErreurs(deuxDeux, { filtres: ['szh-legendes.lua'], env: { SZH_META: i4.chemin } });
    assert.strictEqual(grillesDuCockpit(md)[0].disposition, '2-2', md);
  } finally { i4.nettoyer(); }
});

test('legendes (c) : un tableau de mise en page d’images (FG) devient un groupe, jamais un « Tableau N »', () => {
  const cellule = (img) => '(Cell ("",[],[]) AlignDefault (RowSpan 1) (ColSpan 1) [Plain [' + img + ']])';
  const table = 'Table ("",[],[]) (Caption Nothing []) [(AlignDefault,ColWidthDefault),'
    + '(AlignDefault,ColWidthDefault)] (TableHead ("",[],[]) []) '
    + '[TableBody ("",[],[]) (RowHeadColumns 0) [] [Row ("",[],[]) [' + cellule(IMG_A) + ','
    + cellule(IMG_B) + ']]] (TableFoot ("",[],[]) [])';
  const doc = '[' + CLES_NATIVES.slice(1) + ', ' + table + '\n, Para [Str "Apres."]\n]\n';
  const instr = instructionsTemporaires('FG\t1\tDeux vues\tVue nord\t(c) X\t' + QUEUE_CLES + '\n');
  try {
    const { md } = pandocAvecErreurs(doc, { filtres: ['szh-meta.lua', 'szh-legendes.lua'],
      env: { SZH_META: instr.chemin } });
    assert.ok(!/^\|/m.test(md) && !/szh-tableau/.test(md), 'le tableau a survécu : ' + md);
    const grilles = grillesDuCockpit(md);
    assert.strictEqual(grilles.length, 1, md);
    assert.deepStrictEqual(grilles[0].membres.map((m) => m.relatif), ['image1.png', 'image2.png'], md);
    assert.strictEqual(grilles[0].disposition, '2', 'un tableau 1×2 = côte à côte : ' + md);
    assert.match(md, /!\[Deux vues\]\(media\/image1\.png\)\{[^}]*alt="Vue nord"/, md);
    assert.ok(!/Legende :/.test(md), 'la clé est restée : ' + md);
  } finally { instr.nettoyer(); }
});

test('legendes : un bloc qu’on ne sait pas poser GARDE ses clés dans le texte, et le dit', () => {
  // Cas inattendu : l'image du bloc est dans une phrase. Les clés restent dans le corps,
  // pour que légende, texte alternatif et crédit ne se perdent pas.
  const doc = '[' + CLES_NATIVES.slice(1)
    + ', Para [Str "Voir",Space,' + IMG_A + ',Space,Str "ci-contre."]\n]\n';
  const instr = instructionsTemporaires('FI\timage1.png\tDeux vues\tVue nord\t(c) X\t' + QUEUE_CLES + '\n');
  try {
    const { md, err } = pandocAvecErreurs(doc, { filtres: ['szh-meta.lua', 'szh-legendes.lua'],
      env: { SZH_META: instr.chemin, SZH_SLUG: 'essai' } });
    assert.match(md, /Legende : Deux vues/, 'la légende a disparu : ' + md);
    assert.match(md, /Texte alternatif : Vue nord/, 'le texte alternatif a disparu : ' + md);
    assert.match(md, /Credit : \(c\) X/, 'le crédit a disparu : ' + md);
    assert.match(err, /\[import-avertissement\] bloc-valeur-non-reprise \| article « essai » \| valeur « Deux vues »/,
      'la perte évitée doit être dite, sous un code que le cockpit reconnaît : ' + err);
  } finally { instr.nettoyer(); }
});

test('legendes : deux blocs aux clés identiques (« Source : » vide) retirent chacun LES LEURS', () => {
  // Les clés sont retirées juste devant leur propre contenu, image ou tableau. Retirées
  // par texte, le « Source : » vide de la figure précédente partirait à la place de celui
  // du tableau.
  const source = ', Para [Str "Source",Space,Str ":"]\n';
  const cellule = '(Cell ("",[],[]) AlignDefault (RowSpan 1) (ColSpan 1) [Plain [Str "A1"]])';
  const table = 'Table ("",[],[]) (Caption Nothing []) [(AlignDefault,ColWidthDefault)] '
    + '(TableHead ("",[],[]) []) [TableBody ("",[],[]) (RowHeadColumns 0) [] [Row ("",[],[]) ['
    + cellule + ']]] (TableFoot ("",[],[]) [])';
  const doc = '[' + CLES_NATIVES.slice(1) + source + ', Para [' + IMG_A + ']\n'
    + ', Para [Str "Legende",Space,Str ":",Space,Str "Un",Space,Str "tableau"]\n' + source
    + ', ' + table + '\n, Para [Str "Fin."]\n]\n';
  const instr = instructionsTemporaires(
    'FI\timage1.png\tDeux vues\tVue nord\t(c) X\t' + QUEUE_CLES + '\tSource :\n'
    + 'FT\t1\tUn tableau\t\t\t\t\tLegende : Un tableau\tSource :\n');
  try {
    const { md, err } = pandocAvecErreurs(doc, { filtres: ['szh-meta.lua', 'szh-legendes.lua'],
      env: { SZH_META: instr.chemin } });
    assert.ok(!/Source :/.test(md), 'un « Source : » est resté imprimé : ' + md);
    assert.ok(!/Legende :/.test(md), 'une clé est restée : ' + md);
    assert.match(md, /A1/, 'le tableau a disparu : ' + md);
    assert.match(md, /Fin\./, md);
    assert.ok(!/bloc-valeur-non-reprise/.test(err), err);
  } finally { instr.nettoyer(); }
});

test('legendes : la table des dispositions recopiée reste celle du cockpit', () => {
  const src = fs.readFileSync(path.join(FILTRES, 'szh-legendes.lua'), 'utf8');
  const bloc = src.slice(src.indexOf('local DISPOSITIONS = {'), src.indexOf('}\n\n', src.indexOf('local DISPOSITIONS = {')));
  const lu = {};
  for (const m of bloc.matchAll(/\[(\d)\]\s*=\s*\{([^}]*)\}/g)) {
    lu[m[1]] = [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  }
  assert.deepStrictEqual(lu, Object.fromEntries(Object.entries(refsCockpit.DISPOSITIONS)
    .map(([k, v]) => [k, v.slice()])), 'szh-legendes.lua et lib/references.js divergent');
});

// ── szh-titres.lua : import DOCX, promeut un paragraphe en Header ──────────────────────
// Dans pipeline/import-docx.sh, juste après szh-legendes. SZH_TITRES désigne un fichier
// « niveau<TAB>texte » écrit par docx-titres.py (d'après les tailles de police, que
// pandoc perd).
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

// Cas limite : un titre saisi en gras dans Word est promu sans le gras (deballer() retire
// Strong/Emph/Underline/Span).
const TITRE_GRAS = '**Titre en gras**\n\nTexte suivant.\n';

test('titres : un paragraphe en gras est promu sans garder sa mise en forme', () => {
  const instr = instructionsTemporaires('3\tTitre en gras\n');
  try {
    const md = pandoc(TITRE_GRAS, { vers: 'markdown', filtres: ['szh-titres.lua'], env: { SZH_TITRES: instr.chemin } });
    assert.match(md, /^### Titre en gras$/m, 'le titre garde son gras, ou n\'a pas été promu : ' + md);
  } finally { instr.nettoyer(); }
});

// ── szh-tabelle-reference.lua : import DOCX, un tableau devient une référence ──────────
// Dans pipeline/import-docx.sh, après szh-titres. Le tableau est rendu avant pandoc par
// docx-tables.py ; ce filtre pose une référence numérotée dans le même ordre.
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
// Dans pipeline/profils/livre.mk, après szh-sections. Agit selon SZH_LIVRE (posée pour
// le livre seulement) et la clé `ouvrage` de la fiche.
const CHAPITRE_MD = '---\nlang: fr\nouvrage: collectif\nauthor:\n'
  + '  - prenom: "Jean"\n    nom: "Dupont"\n  - prenom: "Marie"\n    nom: "Martin"\n---\n\n'
  + '# Titre du chapitre\n\nTexte du chapitre.\n';

test('livre-auteurs (préparation) : sans SZH_LIVRE, aucune ligne n\'est insérée', () => {
  const html = pandoc(CHAPITRE_MD, { vers: 'html5', filtres: ['szh-livre-auteurs.lua'] });
  assert.ok(!/szh-auteurs/.test(html), 'une ligne d\'auteurs existe déjà sans SZH_LIVRE : ' + html);
});

// La place de la ligne se règle par `auteurs-chapitre` (bloc mise-en-page de buch.yaml) :
// « dessous » la pose sous le titre, le défaut « dessus » avant lui, dans le DOM.
const CHAPITRE_DESSOUS = CHAPITRE_MD.replace('ouvrage: collectif\n',
  'ouvrage: collectif\nmise-en-page:\n  auteurs-chapitre: dessous\n');

test('livre-auteurs : sous SZH_LIVRE, un chapitre collectif reçoit sa ligne sous le titre', () => {
  const html = pandoc(CHAPITRE_DESSOUS, { vers: 'html5', filtres: ['szh-livre-auteurs.lua'], env: { SZH_LIVRE: '1' } });
  assert.match(html, /<h1[^>]*>Titre du chapitre<\/h1>\s*<p class="szh-auteurs">De Jean Dupont et Marie Martin<\/p>/,
    html);
});

test('livre-auteurs : sans réglage, la ligne d’un chapitre collectif précède son titre', () => {
  const html = pandoc(CHAPITRE_MD, { vers: 'html5', filtres: ['szh-livre-auteurs.lua'], env: { SZH_LIVRE: '1' } });
  assert.match(html, /<p class="szh-auteurs">De Jean Dupont et Marie Martin<\/p>\s*<h1[^>]*>Titre du chapitre<\/h1>/,
    html);
});

// Cas limite : une monographie ne reçoit pas la ligne, même avec des auteur·e·s dans la
// fiche : ce sont ceux du livre entier.
const CHAPITRE_MONO = CHAPITRE_MD.replace('ouvrage: collectif', 'ouvrage: monographie');

test('livre-auteurs : une monographie ne reçoit jamais de ligne, quels que soient les auteurs', () => {
  const html = pandoc(CHAPITRE_MONO, { vers: 'html5', filtres: ['szh-livre-auteurs.lua'], env: { SZH_LIVRE: '1' } });
  assert.ok(!/szh-auteurs/.test(html), html);
});

// ── szh-tableau-boite.lua : enveloppe chaque tableau pour ne pas le voir couper ────────
// Après szh-numerotation. Évite un plantage de WeasyPrint (« Table wrapper without a
// table ») après lequel le Makefile produit un PDF non balisé. Deux formes : un Table
// pandoc, et un tableau inséré en RawBlock html par szh-tabelle-inclure.
test('tableau-boite (préparation) : sans le filtre, un <table> n\'est enveloppé de rien', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5' });
  assert.ok(!/szh-tableau-boite/.test(html), html);
});

test('tableau-boite : un tableau markdown est enveloppé dans un <div> dédié', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5', filtres: ['szh-tableau-boite.lua'] });
  assert.match(html, /<div class="szh-tableau-boite">\s*<table>/, html);
});

// Cas limite : un RawBlock qui contient « <table » est enveloppé, un RawBlock qui contient
// seulement le mot « table » ne l'est pas.
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
// Table de données lue par szh-titre-lignes.lua (dofile), pas un filtre : on la lit par
// pandocLua. Sortie observée : le contenu de la table.
test('titre-metriques : upem, repli et deux avances connues (A, é)', () => {
  const chemin = path.join(FILTRES, 'szh-titre-metriques.lua').replace(/\\/g, '/');
  const sortie = pandocLua('local m = dofile([[' + chemin + ']]); '
    + 'print(m.upem, m.defaut, m.avance[65], m.avance[233])');
  assert.strictEqual(sortie.trim(), '2048\t975\t1173\t1036',
    'la table de métriques ne correspond plus à la police livrée : ' + sortie);
});

// Cas limite : un caractère absent de la table (ici une lettre cyrillique) n'a pas
// d'entrée ; szh-titre-lignes.lua prend alors `defaut`.
test('titre-metriques : un caractère hors table ne vaut rien, il n\'est pas inventé', () => {
  const chemin = path.join(FILTRES, 'szh-titre-metriques.lua').replace(/\\/g, '/');
  const sortie = pandocLua('local m = dofile([[' + chemin + ']]); print(m.avance[1040] == nil)');
  assert.strictEqual(sortie.trim(), 'true', sortie);
});

// ── szh-titre-lignes.lua : coupe le titre de couverture en escalier ────────────────────
// Juste après szh-typographie, qui doit avoir posé les insécables (L2) avant la mesure.
// Lit la géométrie dans pipeline/styles/socle.css et print.css, et la table de
// szh-titre-metriques.lua. Sortie observée : la clé `titre-lignes` du bloc YAML (writer
// markdown --standalone).
//
// Le titre du cas nominal est celui de l'en-tête du filtre. On vérifie le contenu
// reconstitué, pas la position de la coupure, qui changerait avec la police, la taille du
// hero ou les marges.
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
  // Le signet du PDF lit le titre à plat (data-signet), où le <br> ne colle aucun mot.
  const signet = champYaml(md, 'titre-signet');
  assert.ok(signet && signet.includes(titre), 'titre-signet absent ou pas à plat : ' + signet);
});

// Cas limite : un titre d'un seul mot ne forme pas d'escalier (il faut au moins deux
// groupes insécables), quelle que soit la géométrie.
test('titre-lignes : un titre d\'un seul mot ne reçoit jamais d\'escalier', () => {
  const md = pandoc(docTitre('Unique'), { vers: 'markdown', standalone: true,
    filtres: ['szh-typographie.lua', 'szh-titre-lignes.lua'] });
  assert.strictEqual(champYaml(md, 'titre-lignes'), null, md);
});

// ── szh-tabelle-scope.lua : scope="col"/"row" sur les <th> (RGAA 5.7) ──────────────────
// Après szh-tabelle-inclure. Les colonnes d'en-tête de rangée n'existent pas dans les
// pipe tables de markdown : elles sont écrites en format native.
test('tabelle-scope (préparation) : sans le filtre, un <th> ne porte aucun scope', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5' });
  assert.ok(!/scope=/.test(html), html);
});

test('tabelle-scope : les cellules du thead reçoivent scope="col"', () => {
  const html = pandoc(TABLE_SIMPLE, { vers: 'html5', filtres: ['szh-tabelle-scope.lua'] });
  assert.match(html, /<th scope="col">A<\/th>/, html);
  assert.match(html, /<th scope="col">B<\/th>/, html);
});

// Cas limite : une colonne d'en-tête de rangée (row_head_columns > 0, posé par le lecteur
// docx) reçoit scope="row".
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
// Seul filtre de la recette HTML -> docx (--from=html). Le lecteur html ignore le CSS :
// ce filtre retire ce que print.css masque, qui réapparaîtrait sinon dans le Word.
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

// Cas limite : un Div à deux classes, dont szh-description, disparaît en entier.
const GALLEY_MIXTE = '<div class="autre szh-description">Cas mixte a retirer.</div>';

test('galley-docx : un Div à deux classes dont szh-description disparaît entièrement', () => {
  const md = pandoc(GALLEY_MIXTE, { de: 'html', vers: 'markdown', filtres: ['szh-galley-docx.lua'] });
  assert.ok(!/Cas mixte a retirer/.test(md), 'le Div mixte a survécu en partie ou en totalité : ' + md);
});

// Notes du galley : szh-notes.lua pose chaque note en <span class="szh-note"> à l'endroit
// de l'appel (float: footnote). Le filtre en refait une Note, que le writer docx écrit en
// note de bas de page Word ; sinon son texte resterait dans la phrase.
const GALLEY_NOTE = '<p>Texte<span class="szh-note">Note <em>en italique</em> et '
  + '<a href="https://www.szh.ch">un lien</a>.</span> suite.</p>'
  + '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>Cellule<span class="szh-note">'
  + 'Note de cellule.</span></td></tr></tbody></table>';

test('galley-docx : une note szh-note redevient une Note, a sa place, sans residu', () => {
  const natif = pandoc(GALLEY_NOTE, { de: 'html', vers: 'native', filtres: ['szh-galley-docx.lua'] });
  assert.strictEqual((natif.match(/\bNote\b\s*\[/g) || []).length, 2, natif);
  assert.ok(!/szh-note/.test(natif), 'un Span szh-note a survecu : ' + natif);
  assert.match(natif, /Emph/, 'l\'italique de la note est perdu : ' + natif);
  assert.match(natif, /Link/, 'le lien de la note est perdu : ' + natif);
  // La phrase continue après l'appel, sans le texte de la note.
  const md = pandoc(GALLEY_NOTE, { de: 'html', vers: 'markdown', filtres: ['szh-galley-docx.lua'] });
  assert.match(md, /Texte\[\^1\] suite\./, md);
});

// Figures du galley : une image alt="" est un décor, posé en fond CSS d'un
// span.szh-decor-N que pandoc ne voit pas. Une figure légendée n'est pas un décor : le
// galley lui rend son image, décrite par sa légende. Un décor sans légende reste absent.
// Le filtre lit les fonds dans le fichier HTML : l'entrée passe donc par un fichier.
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const GALLEY_FIGURES = '<figure><figcaption><span class="szh-numero">Figure 1 -</span> Eleves'
  + '<span class="szh-note">Note de legende.</span></figcaption>'
  + '<span class="szh-decor szh-decor-1" role="presentation"><span></span></span></figure>'
  + '<p><span class="szh-decor szh-decor-2" role="presentation"><span></span></span></p>'
  + '<style>\n.szh-decor-1>span{padding-top:50%;background-image:url(' + PIXEL + ')}\n'
  + '.szh-decor-2>span{padding-top:50%;background-image:url(' + PIXEL + ')}\n</style>';

test('galley-docx : une figure legendee retrouve son image, decrite par sa legende ; un decor reste absent', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-galley-'));
  try {
    const chemin = path.join(dossier, 'article.html');
    fs.writeFileSync(chemin, GALLEY_FIGURES, 'utf8');
    const r = spawnSync('pandoc', [chemin, '--from=html', '--to=native',
      '--lua-filter=' + path.join(FILTRES, 'szh-galley-docx.lua')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const images = r.stdout.match(/Image/g) || [];
    assert.strictEqual(images.length, 1, 'une seule image attendue (la figure legendee) : ' + r.stdout);
    assert.match(r.stdout, /Str "Figure 1 - Eleves"/, 'description = legende sans la note : ' + r.stdout);
    assert.match(r.stdout, /data:image\/png;base64/, r.stdout);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});
