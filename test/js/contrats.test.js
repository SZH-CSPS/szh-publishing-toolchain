// Contrats de l'extension szh-cockpit, testés hors de l'éditeur (modules sans
// require('vscode')). Deux familles : l'aller-retour (analyser puis sérialiser rend la
// source intacte) et la cohérence (une valeur recopiée d'un fichier à l'autre concorde).
//
//   node --test test/js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
const table = require(path.join(COCKPIT, 'lib', 'table-model.js'));
const slug = require(path.join(COCKPIT, 'lib', 'slug.js'));
const profils = require(path.join(COCKPIT, 'lib', 'profil.js'));
const refs = require(path.join(COCKPIT, 'lib', 'references.js'));
const cit = require(path.join(COCKPIT, 'lib', 'citations.js'));
const qualite = require(path.join(COCKPIT, 'lib', 'qualite-image.js'));
const wsl = require(path.join(COCKPIT, 'lib', 'wsl.js'));
const journal = require(path.join(COCKPIT, 'lib', 'journal.js'));
const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const { sourceExtensionEtLib } = require('./hote-factice');

const CHEMIN_EXTENSION = path.join(COCKPIT, 'extension.js');

// lire('…extension.js') rend extension.js suivi des modules de lib/ : une chaîne cherchée
// peut vivre dans l'un ou l'autre. Le contrat qui vérifie l'absence d'un littéral dans
// extension.js (dépôt Word, plus bas) lit le fichier seul.
const lire = (...p) => {
  const chemin = path.join(RACINE, ...p);
  if (chemin === CHEMIN_EXTENSION) { return sourceExtensionEtLib(COCKPIT); }
  return fs.readFileSync(chemin, 'utf8');
};

// Lit un JSON avec commentaires et virgules traînantes (tasks.json, keybindings.json).
function jsonc(src) {
  return JSON.parse(src.replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
    (m) => (m[0] === '"' ? m : '')).replace(/,(\s*[}\]])/g, '$1'));
}

// ---- ausgabe.yaml ----

test('ausgabe.yaml : les commentaires et les clés inconnues survivent', () => {
  const src = '# en-tête\ntitle: "Dossier"\nprofil: article\ninconnue: 3\n';
  const sortie = yaml.serialiserAusgabe(src, { title: 'Autre' });
  assert.match(sortie, /^# en-tête$/m);
  assert.match(sortie, /^profil: article$/m);
  assert.match(sortie, /^inconnue: 3$/m);
  assert.match(sortie, /^title: "Autre"$/m);
});

test('ausgabe.yaml : le BOM et les fins de ligne Windows sont préservés', () => {
  const src = '﻿title: "A"\r\nlang: fr\r\n';
  const sortie = yaml.serialiserAusgabe(src, { title: 'B' });
  assert.ok(sortie.startsWith('﻿'), 'BOM perdu');
  assert.ok(sortie.includes('\r\n'), 'CRLF perdu');
});

test('ausgabe.yaml : une valeur relue est la valeur écrite', () => {
  const src = 'title: "A"\n';
  for (const valeur of ['Sans guillemet', 'Avec "guillemets"', 'Deux : points', '#croisillon']) {
    const relu = yaml.analyserAusgabe(yaml.serialiserAusgabe(src, { title: valeur }));
    assert.strictEqual(relu.title, valeur, 'aller-retour cassé sur : ' + valeur);
  }
});

// Un éditeur Windows ou `Out-File` de PowerShell 5.1 écrit un BOM devant la première clé.
test('ausgabe.yaml : le BOM ne fait pas perdre la première clé à la lecture', () => {
  const relu = yaml.analyserAusgabe('﻿' + 'titre: Livre\nannee: 2020\n');
  assert.strictEqual(relu.titre, 'Livre', 'la première clé après le BOM est tombée en silence');
  assert.strictEqual(relu.annee, '2020');
});

// `impression:` suivi d'une valeur puis de sous-clés indentées : YAML douteux mais valide.
// Le sérialiseur met la sous-clé à jour en place et ne crée pas de second bloc.
test('buch.yaml : un « impression: » à valeur non vide n’est jamais dupliqué', () => {
  const src = 'titre: Livre\nimpression: quelque chose\n  grammage: 90\n  main: 1.2\nlocked: false\n';
  const sortie = yaml.serialiserAusgabe(src, { 'impression.grammage': '150' });
  const occurrences = (sortie.match(/^impression:/gm) || []).length;
  assert.strictEqual(occurrences, 1, 'la clé impression: a été dupliquée : ' + JSON.stringify(sortie));
  assert.match(sortie, /^impression: quelque chose$/m, 'la valeur douteuse d’origine doit être préservée');
  assert.match(sortie, /^\s+grammage: 150$/m, 'la sous-clé demandée n’a pas été mise à jour en place');
  assert.match(sortie, /^\s+main: 1\.2$/m, 'la sous-clé non touchée doit survivre, hors du bloc dupliqué');
  assert.match(sortie, /^locked: false$/m);
});

// ---- Tableaux ----

// Un tableau collé depuis Excel ou Word peut porter des références numériques (&#233;).
test('decoderEntites : les références numériques, décimales et hexadécimales, sont décodées', () => {
  assert.strictEqual(table.decoderEntites('&#233;'), 'é');
  assert.strictEqual(table.decoderEntites('&#xE9;'), 'é');
  assert.strictEqual(table.decoderEntites('&#XE9;'), 'é', 'le X majuscule doit aussi être reconnu');
  assert.strictEqual(table.decoderEntites('Caf&#233; &amp; th&#xe9;'), 'Café & thé');
  // &amp; se décode en dernier : « &amp;#233; » ne devient pas « é ».
  assert.strictEqual(table.decoderEntites('&amp;#233;'), '&#233;');
});

test('tableau : analyser puis sérialiser puis analyser donne le même modèle', () => {
  const html = lire('test', 'articles', 'contenu-long', 'tables', 'table-01.html');
  const un = table.analyserTable(html);
  const deux = table.analyserTable(table.serialiserTable(un));
  assert.deepStrictEqual(deux, un);
});

test('tableau : le texte à caractères réservés fait l’aller-retour', () => {
  const modele = table.analyserTable(
    '<table class="szh-tableau"><tbody><tr><td>a &amp; b &lt;c&gt; "d"</td></tr></tbody></table>');
  const relu = table.analyserTable(table.serialiserTable(modele));
  assert.deepStrictEqual(relu, modele);
});

// Un en-tête sur deux rangées sort en balisage complexe (WCAG H43, RGAA 5.7) : id sur chaque
// en-tête, scope col/colgroup, headers sur chaque cellule. C'est aussi le balisage que
// docx-tables.py écrit à l'import.
test('tableau : deux rangées d’en-tête -> id, scope, headers, et aller-retour stable', () => {
  const base = table.analyserTable('<table><tr><td colspan="3">Identité</td></tr>'
    + '<tr><td>Nom</td><td>Prénom</td><td>ORCID</td></tr>'
    + '<tr><td>a</td><td>b</td><td>c</td></tr></table>');
  const deux = table.appliquerOperationTable('entete', base, { sens: 'lignes', n: 2 });
  const html = table.serialiserTable(deux);
  assert.ok(html.indexOf('<thead>') !== -1, '<thead> absent');
  assert.ok(/<th id="szh-th-r0c0" scope="colgroup" colspan="3">/.test(html),
    'l’en-tête fusionné doit porter id + scope="colgroup" : ' + html);
  assert.ok(/<th id="szh-th-r1c1" scope="col">/.test(html),
    'la 2e rangée d’en-tête doit porter id + scope="col"');
  assert.ok(/<td headers="szh-th-r0c0 szh-th-r1c2">/.test(html),
    'les cellules de données doivent relier leurs deux en-têtes par headers=');
  const relu = table.analyserTable(html);
  assert.strictEqual(relu.attrs.enteteLignes, 2, 'le compte d’en-têtes ne survit pas');
  assert.deepStrictEqual(table.analyserTable(table.serialiserTable(relu)), relu);
});

// Une rangée fusionnée marquée « titre de section » sert d'en-tête aux rangées qui la
// suivent, jusqu'au titre suivant. Elle remplace le titre de groupe du thead ; les en-têtes
// de colonne restent. Le lien passe par headers=, que les lecteurs d'écran suivent exactement.
test('tableau : un titre de section relaie le titre de groupe pour les rangées qui suivent', () => {
  let m = table.analyserTable('<table><tr><td colspan="3">Article 2025</td></tr>'
    + '<tr><td>Titre</td><td>Caractères</td><td>DOI</td></tr>'
    + '<tr><td>t1</td><td>1</td><td>d1</td></tr>'
    + '<tr><td>Article 2026</td><td></td><td></td></tr>'
    + '<tr><td>t2</td><td>2</td><td>d2</td></tr></table>');
  m = table.appliquerOperationTable('entete', m, { sens: 'lignes', n: 2 });
  m = table.appliquerOperationTable('section', m, { r: 3, actif: true });
  const html = table.serialiserTable(m);
  assert.ok(/<th id="szh-th-r3c0" scope="rowgroup" colspan="3">Article 2026<\/th>/.test(html),
    'le titre de section doit sortir en th scope="rowgroup" : ' + html);
  assert.ok(/<td headers="szh-th-r0c0 szh-th-r1c0">t1<\/td>/.test(html),
    'avant la section : titre de groupe du thead + en-tête de colonne');
  assert.ok(/<td headers="szh-th-r1c0 szh-th-r3c0">t2<\/td>/.test(html),
    'après la section : elle remplace le titre de groupe, l’en-tête de colonne reste');
  const relu = table.analyserTable(html);
  assert.deepStrictEqual(relu, m, 'aller-retour instable avec un titre de section');
  // Désactivé : le rôle part, la fusion reste, la rangée redevient des données.
  const sans = table.appliquerOperationTable('section', relu, { r: 3, actif: false });
  assert.ok(/<td headers="[^"]*" colspan="3">Article 2026<\/td>/.test(table.serialiserTable(sans)),
    'sans le rôle, la rangée fusionnée doit redevenir une cellule de données');
});

// Une fusion de 2 colonnes sur 3 marquée titre ne couvre que ses colonnes : la cellule
// restante reste une donnée, la colonne non couverte garde le titre de groupe du thead, et
// la fusion n'est pas étendue.
test('tableau : un titre de section partiel ne couvre que les colonnes de sa fusion', () => {
  let m = table.analyserTable('<table><tr><td colspan="3">Article 2025</td></tr>'
    + '<tr><td>Titre</td><td>Caractères</td><td>DOI</td></tr>'
    + '<tr><td>t1</td><td>1</td><td>d1</td></tr>'
    + '<tr><td colspan="2">Article 2026</td><td>reste</td></tr>'
    + '<tr><td>t2</td><td>2</td><td>d2</td></tr></table>');
  m = table.appliquerOperationTable('entete', m, { sens: 'lignes', n: 2 });
  m = table.appliquerOperationTable('section', m, { r: 3, cMin: 0, cMax: 1, actif: true });
  const html = table.serialiserTable(m);
  assert.ok(/<th id="szh-th-r3c0" scope="rowgroup" colspan="2">Article 2026<\/th>/.test(html),
    'le titre partiel doit garder sa fusion de 2 colonnes : ' + html);
  assert.ok(/<td headers="szh-th-r0c0 szh-th-r1c2">reste<\/td>/.test(html),
    'la cellule restante de la rangée-titre reste une donnée');
  assert.ok(/<td headers="szh-th-r1c0 szh-th-r3c0">t2<\/td>/.test(html),
    'colonne couverte : le titre partiel remplace le titre de groupe du thead');
  assert.ok(/<td headers="szh-th-r0c0 szh-th-r1c2">d2<\/td>/.test(html),
    'colonne non couverte : le titre de groupe du thead reste');
  const relu = table.analyserTable(html);
  assert.deepStrictEqual(relu, m, 'aller-retour instable avec un titre partiel');
});

// Même règle en colonnes : un en-tête de ligne fusionné (rowspan) donne son groupe aux
// rangées qu'il couvre ; le rowspan suffit, sans marqueur.
test('tableau : en-tête de ligne fusionné = groupe, en-tête simple = sa ligne', () => {
  let m = table.analyserTable('<table><tr><td rowspan="2">Groupe A</td><td>L1</td><td>1</td></tr>'
    + '<tr><td>L2</td><td>2</td></tr></table>');
  m = table.appliquerOperationTable('entete', m, { sens: 'colonnes', n: 2 });
  const html = table.serialiserTable(m);
  assert.ok(/<th id="szh-th-r0c0" scope="rowgroup" rowspan="2">Groupe A<\/th>/.test(html),
    'l’en-tête fusionné doit porter scope="rowgroup" : ' + html);
  assert.ok(/<th id="szh-th-r0c1" scope="row">L1<\/th>/.test(html));
  assert.ok(/<td headers="szh-th-r0c0 szh-th-r0c1">1<\/td>/.test(html),
    'la donnée doit relier le groupe ET sa ligne');
  assert.ok(/<td headers="szh-th-r0c0 szh-th-r1c1">2<\/td>/.test(html));
});

// ---- Slug : le miroir du Makefile ----

// Le numéro de tête d'un Word n'entre pas dans le slug ; numeroOrdreArticle() le récupère
// pour ausgabe.yaml.
test('slug d’article : mêmes règles que le Makefile', () => {
  assert.strictEqual(slug.slugifierArticle('4_Titre'), 'titre');
  assert.strictEqual(slug.slugifierArticle('10_Actualité et ressources'),
    'actualite-et-ressources');
  assert.ok(slug.slugifierArticle('9' + '_' + 'x'.repeat(80)).length <= 39,
    'la borne de 39 caractères du Makefile n’est pas tenue');
});

test('numéro d’ordre d’un Word : capté avant de disparaître du slug', () => {
  assert.strictEqual(slug.numeroOrdreArticle('4_Titre'), 4);
  assert.strictEqual(slug.numeroOrdreArticle('12_Titre'), 12);
  assert.strictEqual(slug.numeroOrdreArticle('Titre sans numéro'), null,
    'un titre sans numéro de tête ne doit pas en inventer un');
});

// Un numéro de tête est suivi d'un séparateur explicite `_` ou `-` (« 4_Titre », « 01-… »).
// Un nombre suivi d'une espace fait partie du titre (« 2024 en chiffres »). La distinction
// se fait sur le nom brut, avant slugifier(), qui change l'espace en tiret.
test('slug d’article : un nombre qui fait partie du titre n’est pas amputé', () => {
  assert.strictEqual(slug.slugifierArticle('2024 en chiffres.docx'), '2024-en-chiffres');
  assert.strictEqual(slug.numeroOrdreArticle('2024 en chiffres.docx'), null,
    'aucun séparateur explicite après 2024 : ce n’est pas un numéro d’ordre');
  assert.strictEqual(slug.slugifierArticle('20 minutes chrono.docx'), '20-minutes-chrono');
  assert.strictEqual(slug.numeroOrdreArticle('20 minutes chrono.docx'), null);
  assert.strictEqual(slug.slugifierArticle('3 jours plus tard.docx'), '3-jours-plus-tard');
  assert.strictEqual(slug.numeroOrdreArticle('3 jours plus tard.docx'), null);
  // Un vrai numéro de tête, séparateur tiret plutôt que soulignement, continue de sortir.
  assert.strictEqual(slug.slugifierArticle('12-Titre.docx'), 'titre');
  assert.strictEqual(slug.numeroOrdreArticle('12-Titre.docx'), 12);
});

// Dix Word numérotés de 1 à 10, dont l'ordre alphabétique des titres diffère de l'ordre
// des numéros : le numéro doit passer dans ordre-articles.
test('ordre du rédacteur : le numéro du Word migre vers ordre-articles sans se perdre', () => {
  const mots = [
    '1_Zebre.docx', '2_Alpha.docx', '3_Yak.docx', '4_Bison.docx', '5_Wapiti.docx',
    '6_Chevre.docx', '7_Vache.docx', '8_Dromadaire.docx', '9_Uranus.docx', '10_Elan.docx'
  ];
  const slugs = mots.map(slug.slugifierArticle);
  assert.ok(slugs.every((s) => !/^[0-9]/.test(s)),
    'un slug commence encore par un chiffre : ' + JSON.stringify(slugs));

  // L'ordre que le cockpit écrit dans `ordre-articles` à l'import.
  const ordreInitial = mots
    .map((nom) => ({ slug: slug.slugifierArticle(nom), numero: slug.numeroOrdreArticle(nom) }))
    .sort((a, b) => a.numero - b.numero)
    .map((x) => x.slug);
  assert.deepStrictEqual(ordreInitial,
    ['zebre', 'alpha', 'yak', 'bison', 'wapiti', 'chevre', 'vache', 'dromadaire', 'uranus', 'elan'],
    'l’ordre du rédacteur ne survit pas au retrait du préfixe numérique');

  // Le repli d'extension.js (tri alphabétique des dossiers) doit donner un autre ordre,
  // sans quoi le test ne prouverait rien.
  const parRepliAlphabetique = slugs.slice().sort((a, b) => a.localeCompare(b, 'fr'));
  assert.notDeepStrictEqual(parRepliAlphabetique, ordreInitial,
    'ce contrôle ne prouve rien si le repli alphabétique retombe sur le bon ordre par hasard');
});

// ---- Attributs d’image ----

test('attributs d’image : écrire puis relire rend les mêmes valeurs', () => {
  const md = '![Une légende](media/x.png)\n';
  const ecrit = refs.ecrireAttributsImage(md, 'x.png',
    { legende: 'Une légende', alt: 'Description', altDefini: true,
      copyright: 'SZH', source: 'Rapport 2026' });
  assert.strictEqual(ecrit.n, 1, 'aucune insertion trouvée');
  const relu = refs.lireAttributsImage(ecrit.texte, 'x.png');
  assert.strictEqual(relu.alt, 'Description');
  assert.strictEqual(relu.copyright, 'SZH');
  assert.strictEqual(relu.source, 'Rapport 2026');
  assert.strictEqual(relu.legende, 'Une légende');
});

test('attributs d’image : alt vide reste un choix explicite (image décorative)', () => {
  const ecrit = refs.ecrireAttributsImage('![](media/x.png)\n', 'x.png',
    { alt: '', altDefini: true });
  assert.match(ecrit.texte, /alt=""/);
  assert.strictEqual(refs.lireAttributsImage(ecrit.texte, 'x.png').altDefini, true);
});

test('attributs d’image : « sans légende ni numéro » écrit la classe et vide la légende', () => {
  const ecrit = refs.ecrireAttributsImage('![Une légende](media/x.png)\n', 'x.png',
    { legende: 'Une légende', alt: 'Description', altDefini: true,
      copyright: '© SZH', source: '', horsFigure: true });
  assert.strictEqual(ecrit.n, 1);
  // Légende vide : c'est elle qui empêche implicit_figures de fabriquer une Figure.
  assert.match(ecrit.texte, /^!\[\]\(media\/x\.png\)\{\.szh-hors-figure /);
  const relu = refs.lireAttributsImage(ecrit.texte, 'x.png');
  assert.strictEqual(relu.horsFigure, true);
  assert.strictEqual(relu.legende, '');
  assert.strictEqual(relu.alt, 'Description');
  assert.strictEqual(relu.copyright, '© SZH');
  // Second passage : le même texte, la classe ne se duplique pas.
  const encore = refs.ecrireAttributsImage(ecrit.texte, 'x.png', relu);
  assert.strictEqual(encore.texte, ecrit.texte);
  // Case décochée : la classe part, la légende revient.
  const rendu = refs.ecrireAttributsImage(ecrit.texte, 'x.png',
    Object.assign({}, relu, { horsFigure: false, legende: 'Une légende' }));
  assert.ok(rendu.texte.indexOf('szh-hors-figure') === -1, 'classe restée : ' + rendu.texte);
  assert.strictEqual(refs.lireAttributsImage(rendu.texte, 'x.png').legende, 'Une légende');
});

test('attributs d’image : la classe .szh-hors-figure est celle du filtre du pipeline', () => {
  const lua = lire('pipeline', 'filters', 'szh-numerotation.lua');
  assert.ok(lua.includes("'" + refs.CLASSE_HORS_FIGURE + "'"),
    'szh-numerotation.lua ne connaît pas la classe ' + refs.CLASSE_HORS_FIGURE);
});

// ---- Grilles d’images ----
//
// Une grille est une figure faite de plusieurs images. On éprouve le bloc écrit dans le .md,
// qui doit rester lisible par le filtre ; la légende, qui n'appartient qu'à la première
// image ; et la table des dispositions, recopiée dans le filtre Lua.

const MD_DEUX = [
  'Un paragraphe.',
  '',
  '![Une légende](media/a.png){alt="desc A" copyright="© A"}',
  '',
  'Encore du texte.',
  '',
  '![Légende de B](media/b.png){alt="desc B"}',
  '',
  'Fin.',
  ''
].join('\n');

test('grille : deux images côte à côte, et l’une déménage', () => {
  const pose = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png');
  assert.strictEqual(pose.ok, true, 'grille refusée : ' + pose.motif);
  // b.png était insérée ailleurs : elle est déplacée, pas dupliquée.
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'b.png').n, 1);
  const grilles = refs.lireGrilles(pose.texte);
  assert.strictEqual(grilles.length, 1);
  assert.deepStrictEqual(grilles[0].membres.map((m) => m.relatif), ['a.png', 'b.png']);
  // Elle emporte son texte alternatif et ses crédits, mais pas sa légende : la figure n'a
  // que celle de la première image.
  assert.strictEqual(pose.legendePerdue, true);
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'b.png').alt, 'desc B');
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'b.png').legende, '');
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'a.png').legende, 'Une légende');
});

test('grille : la légende d’une image suivante ne s’écrit jamais', () => {
  const pose = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png');
  // Le formulaire peut envoyer une légende (saisie faite avant le verrouillage de la carte) :
  // c'est l'écriture qui l'écarte.
  const ecrit = refs.ecrireAttributsImage(pose.texte, 'b.png',
    { legende: 'NE DOIT PAS SORTIR', alt: 'desc B', altDefini: true });
  assert.strictEqual(ecrit.texte.indexOf('NE DOIT PAS SORTIR'), -1,
    'la légende d’une suivante a été écrite : ' + ecrit.texte);
  // La première, elle, garde la sienne.
  const tete = refs.ecrireAttributsImage(pose.texte, 'a.png',
    { legende: 'Nouvelle légende', alt: 'desc A', altDefini: true });
  assert.strictEqual(refs.lireAttributsImage(tete.texte, 'a.png').legende, 'Nouvelle légende');
});

test('grille : en sortir rend une figure, la dernière dissout le bloc', () => {
  let md = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png').texte;
  md = md.replace('Fin.', '![](media/c.png){alt="desc C"}\n\nFin.');
  md = refs.poserDansGrille(md, 'a.png', 'c.png').texte;
  assert.strictEqual(refs.lireGrilles(md)[0].membres.length, 3);

  const sortie = refs.retirerDeGrille(md, 'b.png');
  assert.strictEqual(sortie.ok, true);
  assert.strictEqual(refs.lireGrilles(sortie.texte)[0].membres.length, 2);
  // Sortie de la grille, mais pas de l'article : elle reste insérée, seule sur sa ligne.
  assert.strictEqual(refs.lireAttributsImage(sortie.texte, 'b.png').n, 1);
  assert.strictEqual(refs.grilleDeImage(sortie.texte, 'b.png'), null);

  const derniere = refs.retirerDeGrille(sortie.texte, 'c.png');
  assert.strictEqual(refs.lireGrilles(derniere.texte).length, 0, 'le bloc devait se dissoudre');
  for (const nom of ['a.png', 'b.png', 'c.png']) {
    assert.strictEqual(refs.lireAttributsImage(derniere.texte, nom).n, 1,
      nom + ' a disparu de l’article');
  }
});

test('grille : retirer de la figure ôte l’image d’à côté et ne touche à rien d’autre', () => {
  let md = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png').texte;
  md = md.replace('Fin.', '![](media/c.png){alt="desc C"}\n\nFin.');
  md = refs.poserDansGrille(md, 'a.png', 'c.png').texte;
  const avant = refs.lireGrilles(md)[0];
  assert.strictEqual(avant.membres.length, 3);

  // « Retirer de la figure » : l'image quitte la grille et le texte, mais le fichier reste
  // dans l'article pour être réinséré ailleurs.
  const ote = refs.retirerDeGrille(md, 'b.png', { garderDansTexte: false });
  assert.strictEqual(ote.ok, true);
  assert.strictEqual(refs.lireAttributsImage(ote.texte, 'b.png').n, 0,
    '« retirer de la figure » a laissé une insertion derrière lui');
  // L'image d'à côté, la figure et sa légende restent intactes.
  const apres = refs.lireGrilles(ote.texte)[0];
  assert.deepStrictEqual(apres.membres.map((m) => m.relatif), ['a.png', 'c.png']);
  assert.strictEqual(refs.lireAttributsImage(ote.texte, 'a.png').legende, 'Une légende');
  assert.strictEqual(refs.lireAttributsImage(ote.texte, 'c.png').n, 1);

  // Une de plus, et la grille se dissout : ce qui reste redevient une figure ordinaire.
  const derniere = refs.retirerDeGrille(ote.texte, 'c.png', { garderDansTexte: false });
  assert.strictEqual(refs.lireGrilles(derniere.texte).length, 0);
  assert.strictEqual(refs.lireAttributsImage(derniere.texte, 'a.png').n, 1);
  assert.strictEqual(refs.lireAttributsImage(derniere.texte, 'c.png').n, 0);
  assert.strictEqual(refs.lireAttributsImage(derniere.texte, 'a.png').legende, 'Une légende');
});

test('grille : les deux sorties diffèrent par une seule chose, le texte', () => {
  const md = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png').texte
    .replace('Fin.', '![](media/c.png){alt="desc C"}\n\nFin.');
  const trois = refs.poserDansGrille(md, 'a.png', 'c.png').texte;
  const gardee = refs.retirerDeGrille(trois, 'b.png', { garderDansTexte: true });
  const otee = refs.retirerDeGrille(trois, 'b.png', { garderDansTexte: false });
  // Même grille des deux côtés ; seule l'insertion de la sortante fait la différence.
  assert.deepStrictEqual(
    refs.lireGrilles(gardee.texte)[0].membres.map((m) => m.relatif),
    refs.lireGrilles(otee.texte)[0].membres.map((m) => m.relatif));
  assert.strictEqual(refs.lireAttributsImage(gardee.texte, 'b.png').n, 1);
  assert.strictEqual(refs.lireAttributsImage(otee.texte, 'b.png').n, 0);
  // Sans option, l'image reste dans le texte.
  assert.strictEqual(refs.retirerDeGrille(trois, 'b.png').texte, gardee.texte);
});

test('grille : la disposition suit le nombre d’images, et « auto » le reste', () => {
  let md = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png').texte;
  assert.strictEqual(refs.lireGrilles(md)[0].disposition, refs.GRILLE_AUTO);
  md = refs.ecrireDispositionGrille(md, 'a.png', '1-1').texte;
  assert.strictEqual(refs.lireGrilles(md)[0].disposition, '1-1');
  // Une disposition impossible pour ce nombre d'images est refusée net.
  assert.strictEqual(refs.ecrireDispositionGrille(md, 'a.png', '2-2').ok, false);
  // Une image de plus : « 1-1 » ne vaut plus, la grille retombe sur le défaut de trois.
  md = md.replace('Fin.', '![](media/c.png){alt="desc C"}\n\nFin.');
  md = refs.poserDansGrille(md, 'a.png', 'c.png').texte;
  assert.strictEqual(refs.lireGrilles(md)[0].disposition, refs.dispositionParDefaut(3));
});

test('grille : normaliser remet d’aplomb ce qu’une suppression a laissé', () => {
  const md = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png').texte;
  // Ce que fait supprimerAsset : l'insertion part, le bloc reste avec une seule image.
  const ote = refs.retirerImage(md, 'b.png');
  assert.strictEqual(refs.lireGrilles(ote.texte).length, 1, 'le bloc devait survivre au retrait');
  const propre = refs.normaliserGrilles(ote.texte);
  assert.strictEqual(refs.lireGrilles(propre.texte).length, 0, 'grille d’une image non dissoute');
  assert.strictEqual(refs.lireAttributsImage(propre.texte, 'a.png').n, 1);
  // Deuxième passage : rien à faire, et rien de changé.
  assert.strictEqual(refs.normaliserGrilles(propre.texte).texte, propre.texte);
});

test('grille : le mode automatique suit le format des images', () => {
  // Deux panoramas l'un sur l'autre, deux portraits côte à côte.
  assert.strictEqual(refs.dispositionAutomatique(2, [3, 3]), '1-1');
  assert.strictEqual(refs.dispositionAutomatique(2, [0.75, 0.75]), '2');
  assert.strictEqual(refs.dispositionAutomatique(4, [1.5, 1.5, 1.5, 1.5]), '2-2');
  assert.strictEqual(refs.dispositionAutomatique(5, [1.5, 1.5, 1.5, 1.5, 1.5]), '3-2');
  assert.strictEqual(refs.dispositionAutomatique(6, [1.5, 1.5, 1.5, 1.5, 1.5, 1.5]), '3-3');
  // Une mesure manquante : on rend la disposition par défaut.
  assert.strictEqual(refs.dispositionAutomatique(4, [1.5, null, 1.5, 1.5]),
    refs.dispositionParDefaut(4));
  // Hors de la table : rien à proposer, le formulaire n'offre pas de menu.
  assert.strictEqual(refs.dispositionAutomatique(7, [1, 1, 1, 1, 1, 1, 1]), null);
});

test('grille : chaque disposition offerte totalise bien son nombre d’images', () => {
  for (let n = 2; n <= refs.GRILLE_MAX; n++) {
    const codes = refs.dispositionsPossibles(n);
    assert.ok(codes.length > 0, 'aucune disposition pour ' + n + ' images');
    for (const code of codes) {
      const rangees = refs.rangeesDeDisposition(code);
      assert.ok(rangees, 'disposition illisible : ' + code);
      assert.strictEqual(rangees.reduce((a, b) => a + b, 0), n,
        'la disposition « ' + code + ' » ne totalise pas ' + n + ' images');
    }
  }
});

test('grille : la table des dispositions est la même dans le cockpit et dans le filtre', () => {
  // La table est recopiée dans szh-grille.lua. Une divergence ferait proposer au menu une
  // disposition que le rendu ne sait pas composer.
  const lua = lire('pipeline', 'filters', 'szh-grille.lua');
  for (let n = 2; n <= refs.GRILLE_MAX; n++) {
    const attendu = '[' + n + '] = { '
      + refs.dispositionsPossibles(n).map((c) => "'" + c + "'").join(', ') + ' },';
    assert.ok(lua.includes(attendu),
      'szh-grille.lua ne porte pas la même ligne pour ' + n + ' images : ' + attendu);
  }
  assert.ok(lua.includes('local CIBLE = ' + refs.GRILLE_CIBLE),
    'la hauteur visée du mode automatique diffère entre le cockpit et le filtre');
  assert.ok(lua.includes('local MAX = ' + refs.GRILLE_MAX),
    'le plafond d’images par grille diffère entre le cockpit et le filtre');
  assert.ok(lua.includes("local CLASSE = '" + refs.CLASSE_GRILLE + "'"),
    'szh-grille.lua ne connaît pas la classe ' + refs.CLASSE_GRILLE);
  assert.ok(lua.includes("local AUTO = '" + refs.GRILLE_AUTO + "'"),
    'le mot du mode automatique diffère entre le cockpit et le filtre');
});

test('grille : le filtre est branché dans les deux chaînes, avant szh-figure', () => {
  const chaines = require('./chaines-filtres-lire').lireChaines();
  for (const nom of ['CHAINE_ARTICLE', 'CHAINE_APERCU']) {
    const c = chaines[nom];
    assert.ok(c.includes('grille'), 'szh-grille n’est pas branché dans ' + nom);
    assert.ok(c.includes('figure'), 'szh-figure n’est pas branché dans ' + nom);
    assert.ok(c.indexOf('grille') < c.indexOf('figure'),
      'szh-grille doit précéder szh-figure : une grille tombée à une image se dissout en paragraphe');
  }
});

test('grille : partage-filtres.css met en page les rangées que le filtre écrit', () => {
  // Les règles vivent dans partage-filtres.css, commune à la revue et au livre et empilée
  // avant print.css. On lit les deux feuilles dans l'ordre de la pile.
  const css = lire('pipeline', 'styles', 'partage-filtres.css') + lire('pipeline', 'styles', 'print.css');
  for (const regle of ['.szh-grille-rangee', '.szh-grille-case']) {
    assert.ok(css.includes(regle), 'règle absente de partage-filtres.css/print.css : ' + regle);
  }
  // Sans base nulle, le flex-grow écrit par le filtre ne donne plus des hauteurs égales.
  assert.match(css, /\.szh-grille-case\s*\{[^}]*flex-basis:\s*0/,
    'la case de grille n’a plus sa base nulle : la mise en page justifiée tombe');
  // Sur écran étroit, la rangée se défait. La requête reste imbriquée dans un
  // « @media screen » nu : WeasyPrint ne connaît pas les caractéristiques de média et
  // avertirait à chaque article si elle était écrite à plat.
  assert.match(css, /@media screen\s*\{\s*\n\s*@media \(max-width: [^)]+\)\s*\{\s*\n\s*\.szh-grille-rangee\s*\{\s*display:\s*block/,
    'la grille ne se replie pas sur écran étroit, ou sa requête n’est plus imbriquée');
});

// ---- Qualité des images ----

test('qualité : les seuils rangent une image dans le bon degré', () => {
  const v = (famille, l, h, nom) => qualite.qualiteImage(famille, { largeur: l, hauteur: h }, nom || 'x.png');
  assert.strictEqual(v('figure', 800, 600).niveau, 'insuffisant');
  assert.strictEqual(v('figure', 1500, 600).niveau, 'juste');
  assert.strictEqual(v('figure', 2400, 600).niveau, 'ok');
  // Un portrait se juge sur son petit côté, le recadrage y prenant un carré.
  assert.strictEqual(v('portrait', 2000, 300).niveau, 'insuffisant');
  assert.strictEqual(v('portrait', 2000, 600).niveau, 'juste');
  assert.strictEqual(v('portrait', 1200, 1200).niveau, 'ok');
  // Un vectoriel est net à toute taille ; sans dimensions, pas de verdict.
  assert.strictEqual(v('figure', 10, 10, 'logo.svg').niveau, 'vectoriel');
  assert.strictEqual(qualite.qualiteImage('figure', null, 'x.png').niveau, 'inconnu');
  // Famille inconnue : jugée comme une figure plutôt que laissée sans seuils.
  assert.strictEqual(v('inventee', 800, 600).famille, 'figure');
});

test('qualité : aux seuils exacts, le verdict bascule du bon côté', () => {
  const v = (famille, l, h) => qualite.qualiteImage(famille, { largeur: l, hauteur: h }, 'x.png');
  // Portrait, petit côté : 399 en dessous du minimum, 400 dessus ; 999/1000 pour le conseillé.
  assert.strictEqual(v('portrait', 2000, 399).niveau, 'insuffisant');
  assert.strictEqual(v('portrait', 2000, 400).niveau, 'juste');
  assert.strictEqual(v('portrait', 2000, 999).niveau, 'juste');
  assert.strictEqual(v('portrait', 2000, 1000).niveau, 'ok');
  // Figure, largeur : 999/1000 pour le minimum, 1999/2000 pour le conseillé.
  assert.strictEqual(v('figure', 999, 600).niveau, 'insuffisant');
  assert.strictEqual(v('figure', 1000, 600).niveau, 'juste');
  assert.strictEqual(v('figure', 1999, 600).niveau, 'juste');
  assert.strictEqual(v('figure', 2000, 600).niveau, 'ok');
});

test('qualité : l’option « réduit » tait le conseillé, sans toucher le minimum', () => {
  const v = (famille, l, h, nom) =>
    qualite.qualiteImage(famille, { largeur: l, hauteur: h }, nom || 'x.png', { reduit: true });
  // Le palier « conseillé » (niveau juste) devient ok : plus rien à afficher.
  assert.strictEqual(v('figure', 1000, 600).niveau, 'ok');
  assert.strictEqual(v('figure', 1500, 600).niveau, 'ok');
  assert.strictEqual(v('portrait', 2000, 400).niveau, 'ok');
  assert.strictEqual(v('portrait', 2000, 600).niveau, 'ok');
  // Le minimum reste signalé, au pixel près.
  assert.strictEqual(v('figure', 999, 600).niveau, 'insuffisant');
  assert.strictEqual(v('portrait', 2000, 399).niveau, 'insuffisant');
  // Ce qui était déjà ok le reste, vectoriel et inconnu ne bougent pas.
  assert.strictEqual(v('figure', 2400, 600).niveau, 'ok');
  assert.strictEqual(v('figure', 10, 10, 'logo.svg').niveau, 'vectoriel');
  assert.strictEqual(qualite.qualiteImage('figure', null, 'x.png', { reduit: true }).niveau, 'inconnu');
  // Sans option, ou option éteinte : verdict complet.
  assert.strictEqual(qualite.qualiteImage('figure', { largeur: 1500, hauteur: 600 }, 'x.png').niveau, 'juste');
  assert.strictEqual(
    qualite.qualiteImage('portrait', { largeur: 2000, hauteur: 600 }, 'x.png', { reduit: false }).niveau,
    'juste');
});

test('le réglage « réduire les warnings d’impression » est déclaré, traduit et branché', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const prop = pkg.contributes.configuration.properties['szh.reduireWarningsImpression'];
  assert.ok(prop, 'propriété absente du manifeste : szh.reduireWarningsImpression');
  assert.strictEqual(prop.default, false, 'le défaut doit laisser les warnings complets');
  const nls = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.json'));
  const nlsDe = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.de.json'));
  assert.ok('config.reduireWarningsImpression' in nls, 'description française absente');
  assert.ok('config.reduireWarningsImpression' in nlsDe, 'description allemande absente');
  // Le panneau écrit le réglage et les trois appels de l'hôte le transmettent.
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  assert.ok(src.includes("update('reduireWarningsImpression'"),
    'aucune branche d’écriture du réglage dans extension.js');
  assert.strictEqual(
    (src.match(/reduit: reduireWarningsImpressionActif\(\)/g) || []).length, 3,
    'les trois appels à qualiteImage doivent porter l’option');
  const panneau = lire('vscodium-extension', 'szh-cockpit', 'media', 'accueil.js');
  assert.match(panneau, /choix\([^,]+, 'warnings'/, 'groupe absent de l’onglet Paramètres de l’Accueil');
  const hote = lire('vscodium-extension', 'szh-cockpit', 'lib', 'reglages-hote.js');
  assert.ok(hote.includes("msg.cle === 'warnings'"), 'l’hôte ne traite plus le groupe warnings');
});

// Le filtre Lua ne voit pas les réglages de VSCodium : le réglage lui parvient par
// config.json.
test('le réglage « désactiver les liens des références » est déclaré, traduit et branché jusqu’au filtre', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const prop = pkg.contributes.configuration.properties['szh.desactiverLiensReferences'];
  assert.ok(prop, 'propriété absente du manifeste : szh.desactiverLiensReferences');
  assert.strictEqual(prop.default, false, 'le défaut doit laisser les liens actifs');
  const nls = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.json'));
  const nlsDe = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.de.json'));
  assert.ok('config.desactiverLiensReferences' in nls, 'description française absente');
  assert.ok('config.desactiverLiensReferences' in nlsDe, 'description allemande absente');
  const i18n = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  for (const cle of ['regl.liensReferences', 'regl.liensReferences.actifs', 'regl.liensReferences.desactives']) {
    assert.strictEqual((i18n.match(new RegExp("'" + cle.replace(/\./g, '\\.') + "':", 'g')) || []).length, 2,
      'clé i18n absente d’une des deux langues : ' + cle);
  }
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  assert.ok(src.includes("update('desactiverLiensReferences'"),
    'aucune branche d’écriture du réglage VSCodium dans extension.js');
  assert.ok(src.includes('configAvecLiensDesactives(avant, desactiver)'),
    'le réglage n’est pas répercuté dans config.json — le filtre Lua ne le verra jamais');
  const panneau = lire('vscodium-extension', 'szh-cockpit', 'media', 'accueil.js');
  assert.match(panneau, /choix\([^,]+, 'liensReferences'/, 'groupe absent de l’onglet Paramètres de l’Accueil');
  // Le filtre ne coupe que le Link, pas l'ancre.
  const lua = lire('pipeline', 'filters', 'szh-citations.lua');
  assert.match(lua, /cfg\.desactiverLiensReferences/, 'le filtre ne lit pas la clé de config.json');
  // Le Link se fabrique plus tard, sur tout le paragraphe : la garde porte sur la plage qui
  // transporte id_ref.
  assert.match(lua, /if not LIENS_DESACTIVES then\s*\n\s*plages\[#plages \+ 1\] = \{ s = ds, e = de, id_ref = cands\[1\]\.id/,
    'le filtre ne conditionne pas la pose de l’appel sur le réglage');
  // Deux occurrences : la définition du drapeau et cette garde. La pose du Div ancré
  // (pandoc.Attr(f.id, …)) reste inconditionnelle.
  assert.strictEqual((lua.match(/LIENS_DESACTIVES/g) || []).length, 2,
    'LIENS_DESACTIVES ne doit conditionner que la pose du Link, pas l’ancre de la référence');
});

test('qualité : le seuil des portraits n’est pas sous la sortie du pipeline', () => {
  const py = lire('pipeline', 'portraits.py');
  const m = /TAILLE_SORTIE\s*=\s*(\d+)/.exec(py);
  assert.ok(m, 'TAILLE_SORTIE introuvable dans portraits.py');
  assert.strictEqual(qualite.SEUILS.portrait.min, Number(m[1]),
    'sous ce seuil, portraits.py agrandit l’image au lieu de la réduire');
});

test('ordre des images : celui du texte, cibles encodées et sous-dossiers comprises', () => {
  const md = [
    '![Deux](media/Sous/b.PNG)',
    '',
    'texte ![Un](<media/a%20b.png> "titre") au fil du texte',
    '',
    '![Encore](media/Sous/b.png)',
    '![Ailleurs](../autre/c.png)'
  ].join('\n');
  const ordre = refs.ordreImages(md);
  assert.strictEqual(ordre.get('sous/b.png'), 0);
  assert.strictEqual(ordre.get('a b.png'), 1);       // percent-décodée, casse effacée
  assert.strictEqual(ordre.size, 2, 'une cible hors media/ ne compte pas');
});

// ---- Rendu : contraintes que le corpus de test ne couvre pas ----

test('print.css : toute image est contrainte à la colonne, figure ou non', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  // Une image hors numérotation sans crédits n'est pas dans une <figure> : sans règle sur
  // `img`, une image de 2000 px (la largeur conseillée) déborderait de la page.
  assert.match(css, /^img \{[^}]*max-width:\s*100%/m,
    'aucune règle max-width sur `img` : une image hors figure déborde');
});

test('le banc de rendu couvre les cas d’image qui ont deja casse', () => {
  const md = lire('test', 'articles', 'figures', 'figures.md');
  const cas = [
    [/!\[[^\]]+\]\(media\/[^)]+\)\{[^}]*copyright=/, 'figure numérotée avec crédits'],
    [/!\[\]\(media\/[^)]+\)\{\.szh-hors-figure[^}]*copyright=/, 'hors numérotation avec crédits'],
    [/!\[\]\(media\/[^)]+\)\{\.szh-hors-figure(?![^}]*copyright)[^}]*\}/, 'hors numérotation sans crédits'],
    [/!\[\]\(media\/[^)]+\.svg\)\{alt=""\}/, 'vectoriel décoratif']
  ];
  for (const [motif, nom] of cas) {
    assert.match(md, motif, 'cas perdu dans le corpus de rendu : ' + nom);
  }
  // Les fichiers cités doivent exister, sinon le build passe sans image et sans rien dire.
  for (const m of md.matchAll(/\(media\/([^)]+)\)/g)) {
    assert.ok(fs.existsSync(path.join(RACINE, 'test', 'articles', 'figures', 'media', m[1])),
      'média absent du corpus de rendu : ' + m[1]);
  }
});

test('place d’une figure : jamais dans un bloc qui la mangerait', () => {
  const doc = [
    'Un paragraphe sur',                                   // 0
    'deux lignes.',                                        // 1
    '',                                                    // 2
    '- item de liste',                                     // 3
    '',                                                    // 4  (liste aérée)
    '- autre item',                                        // 5
    '',                                                    // 6
    '```',                                                 // 7
    'du code',                                             // 8
    '```',                                                 // 9
    '',                                                    // 10
    '> citation',                                          // 11
    '',                                                    // 12
    '| a | b |',                                           // 13
    '|---|---|',                                           // 14
    '',                                                    // 15
    '::: {.szh-tabelle src="tables/table-01.html"}',        // 16
    ':::',                                                 // 17
    '',                                                    // 18
    '    code indente',                                    // 19
    '',                                                    // 20
    'Fin.'                                                 // 21
  ];
  // Paragraphe ordinaire : à la fin du paragraphe, jamais en son milieu.
  assert.deepStrictEqual(refs.placeFigure(doc, 0), { ligne: 1, colonne: 12 });
  assert.deepStrictEqual(refs.placeFigure(doc, 1), { ligne: 1, colonne: 12 });
  // Ligne vide qui suit un paragraphe : c'est une place.
  assert.deepStrictEqual(refs.placeFigure(doc, 2), { ligne: 2, colonne: 0 });
  assert.deepStrictEqual(refs.placeFigure(doc, 21), { ligne: 21, colonne: 4 });
  // Partout ailleurs, l'appelant doit retomber sur la fin de l'article.
  for (const l of [3, 4, 5, 8, 11, 13, 14, 16, 17, 19]) {
    assert.strictEqual(refs.placeFigure(doc, l), null, 'place acceptée à tort ligne ' + l);
  }
});

test('place d’une figure : la référence est isolée dans son paragraphe', () => {
  const doc = ['Texte.', '', 'Autre texte.'];
  // Fin d'un paragraphe suivi d'une ligne vide : une seule séparation à ajouter devant.
  assert.strictEqual(refs.envelopperFigure(doc, 0, 6, 'REF'), '\n\nREF');
  // Ligne vide entourée de vide : rien à ajouter.
  assert.strictEqual(refs.envelopperFigure(['', '', ''], 1, 0, 'REF'), 'REF');
  // Milieu de ligne : séparé des deux côtés.
  assert.strictEqual(refs.envelopperFigure(doc, 0, 3, 'REF'), '\n\nREF\n\n');
});

test('CMJN : le nombre de composantes se lit même derrière un gros profil ICC', () => {
  const cmyk = require(path.join(COCKPIT, 'lib', 'cmyk.js'));
  // Un JPEG minimal : SOI, un APP2 de la taille voulue, un SOF0 à N composantes, EOI.
  const jpeg = (composantes, remplissage) => {
    const morceaux = [Buffer.from([0xff, 0xd8])];
    // La longueur d'un segment tient sur 16 bits : un gros profil ICC est découpé en
    // plusieurs APP2.
    let reste = remplissage;
    while (reste > 0) {
      const morceau = Math.min(reste, 65000);
      const entete = Buffer.alloc(4);
      entete[0] = 0xff; entete[1] = 0xe2;                    // APP2, comme un profil ICC
      entete.writeUInt16BE(morceau + 2, 2);
      morceaux.push(entete, Buffer.alloc(morceau));
      reste -= morceau;
    }
    const sof = Buffer.alloc(4 + 6);
    sof[0] = 0xff; sof[1] = 0xc0;                            // SOF0
    sof.writeUInt16BE(8, 2);                                 // Lf
    sof[4] = 8;                                              // P
    sof.writeUInt16BE(100, 5);                               // Y
    sof.writeUInt16BE(200, 7);                               // X
    sof[9] = composantes;                                    // Nf
    morceaux.push(sof, Buffer.from([0xff, 0xd9]));
    return Buffer.concat(morceaux);
  };
  const dossier = fs.mkdtempSync(path.join(require('os').tmpdir(), 'szh-cmyk-'));
  try {
    const cas = [[4, 0, true], [3, 0, false], [1, 0, false],
                 [4, 200000, true], [3, 200000, false]];
    for (const [composantes, remplissage, attendu] of cas) {
      const f = path.join(dossier, 'c' + composantes + '-' + remplissage + '.jpg');
      fs.writeFileSync(f, jpeg(composantes, remplissage));
      assert.strictEqual(cmyk.composantesJpeg(f), composantes,
        composantes + ' composantes non lues (remplissage ' + remplissage + ' o)');
      assert.strictEqual(cmyk.estJpegCmyk(f), attendu);
    }
    // Ni un JPEG, ni un fichier : pas de verdict, pas d'exception.
    const faux = path.join(dossier, 'faux.jpg');
    fs.writeFileSync(faux, Buffer.from('pas un jpeg'));
    assert.strictEqual(cmyk.composantesJpeg(faux), 0);
    assert.strictEqual(cmyk.estJpegCmyk(path.join(dossier, 'absent.jpg')), false);
  } finally {
    fs.rmSync(dossier, { recursive: true, force: true });
  }
});

test('CMJN : le convertisseur du pipeline et son appelant se repondent', () => {
  const js = lire('vscodium-extension', 'szh-cockpit', 'lib', 'cmyk.js');
  const py = lire('pipeline', 'cmyk-rgb.py');
  assert.match(js, /cmyk-rgb\.py/, 'lib/cmyk.js ne nomme pas le script du pipeline');
  // Les champs de la ligne JSON que lib/cmyk.js relit.
  for (const champ of ['converti', 'erreur', 'ok']) {
    assert.ok(py.includes("'" + champ + "'"), 'cmyk-rgb.py n’émet pas le champ ' + champ);
  }
  assert.match(js, /=== 4/, 'la détection CMJN ne compare plus le nombre de composantes');
});

// ---- Chaîne d'import des médias ----

test('médias : la webview et l’hôte plafonnent les dépôts pareil', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const medias = lire('vscodium-extension', 'szh-cockpit', 'lib', 'medias.js');
  // Les plafonds viennent de l'hôte (`limites`, construit par limitesMedias()). Un
  // « 1024 * 1024 » écrit dans une webview serait une seconde source.
  for (const nom of ['medias-article.js', '_auteurs.js', 'import-verif.js', 'documentation.js']) {
    const texte = lire('vscodium-extension', 'szh-cockpit', 'media', nom);
    assert.ok(!/\d\s*\*\s*1024\s*\*\s*1024/.test(texte),
      nom + ' porte encore un plafond en octets écrit en dur : il doit venir de l’hôte');
  }
  // limitesMedias() lit lib/medias.js pour l'image et les constantes de l'hôte pour la photo.
  assert.match(medias, /const TAILLE_MAX_IMAGE_IMPORT = /,
    'lib/medias.js ne porte plus le plafond des images, plus rien à envoyer aux webviews');
  assert.match(src, /function limitesMedias\(\)/,
    'l’hôte ne construit plus `limites` depuis un seul endroit');
  assert.match(src, /imageMax: TAILLE_MAX_IMAGE_IMPORT, imageExtensions: EXTENSIONS_IMAGE_IMPORT/,
    'limitesMedias() ne source plus le plafond des images depuis lib/medias.js');
  assert.match(src, /photoMax: TAILLE_MAX_PHOTO, photoExtensions: EXTENSIONS_PHOTO/,
    'limitesMedias() ne source plus le plafond des photos depuis les constantes de l’hôte');
  assert.match(src, /limites: limitesMedias\(\)/,
    'aucun message de chargement n’envoie plus `limites` aux webviews');
});

test('import : la chaîne appelle le rangement des médias, et docx-meta l’alimente', () => {
  const sh = lire('pipeline', 'import-docx.sh');
  assert.match(sh, /export SZH_PHOTOS=/, 'le fichier d’appariement des photos n’est pas exporté');
  assert.match(sh, /import-medias\.py/, 'import-medias.py n’est jamais appelé');
  assert.match(lire('pipeline', 'docx-meta.py'), /getenv\('SZH_PHOTOS'\)/,
    'docx-meta.py n’écrit pas le fichier d’appariement');
});

test('import : les formats de portrait sont les mêmes dans le pipeline et le cockpit', () => {
  const cockpit = /const EXTENSIONS_PHOTO = \[([^\]]*)\]/
    .exec(lire('vscodium-extension', 'szh-cockpit', 'extension.js'));
  const pipeline = /EXTENSIONS_PORTRAIT = \(([^)]*)\)/.exec(lire('pipeline', 'docx-meta.py'));
  assert.ok(cockpit && pipeline, 'liste de formats introuvable d’un côté ou de l’autre');
  const liste = (s) => s.split(',').map((x) => x.trim().replace(/'/g, '')).filter(Boolean).sort();
  assert.deepStrictEqual(liste(pipeline[1]), liste(cockpit[1]),
    'docx-meta.py apparierait une photo que le dépôt du cockpit refuse');
});

test('import : les noms de versions de portrait sont ceux que le cockpit relit', () => {
  const im = lire('pipeline', 'import-medias.py');
  const meta = lire('pipeline', 'docx-meta.py');
  // decomposerPhoto() du cockpit ne reconnaît que ces trois suffixes.
  assert.match(meta, /\.original\.%s/, 'docx-meta.py ne pointe pas l’original');
  for (const forme of ['.original.', '.sans-fond.png', 'portraits/']) {
    assert.ok(im.includes(forme), 'import-medias.py ignore « ' + forme + ' »');
  }
});

// ---- Cohérence entre fichiers ----

test('bandeau DOI : le cockpit dépose dois-calcules.yaml et la maquette le relit', () => {
  // Le DOI est calculé par le cockpit (lib/articles.js), qui l'écrit dans
  // dois-calcules.yaml ; le pipeline le relit pour le template ($if(doi)$). Si un des trois
  // maillons change de nom, le bandeau disparaît sans erreur.
  const ext = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  assert.match(ext, /NOM_DOIS_CALCULES = 'dois-calcules\.yaml'/,
    'le cockpit n’écrit plus le fichier dérivé des DOI');
  assert.match(ext, /ecrireDoisCalcules\(fournisseur\)/,
    'ecrireDoisCalcules n’est plus branché sur le rafraîchissement');
  const lua = lire('pipeline', 'filters', 'szh-maquette.lua');
  assert.ok(lua.includes("'/dois-calcules.yaml'"),
    'szh-maquette.lua ne lit plus le fichier dérivé : le bandeau DOI meurt en silence');
  assert.match(lua, /doi_calcule_du_numero/, 'le repli du bandeau DOI a disparu du filtre');
  const template = lire('pipeline', 'templates', 'szh-article.html');
  assert.ok(template.includes('$if(doi)$'), 'le template n’imprime plus le bandeau DOI');
});

test('la distro WSL est la même dans le code et dans tasks.json', () => {
  const taches = jsonc(lire('vscodium-user', 'tasks.json')).tasks;
  for (const t of taches) {
    const i = t.args.indexOf('-d');
    assert.notStrictEqual(i, -1, 'tâche sans -d : ' + t.label);
    assert.strictEqual(t.args[i + 1], wsl.DISTRO,
      'tâche « ' + t.label + ' » : distro différente de lib/wsl.js');
  }
});

// lib/journal.js attribue chaque ligne de .szh-journal.log à un article. Avec `-j` sans
// `-O` (--output-sync), les lignes de deux articles s'entrelacent et l'avertissement est
// attribué au mauvais article. Le test refuse `-j` sans `-O` partout où make est lancé.
test('aucune compilation parallèle ne part sans --output-sync', () => {
  // Les jetons d'une commande, qu'elle vienne d'un `bash -c` (tasks.json) ou d'un tableau
  // d'arguments (ProcessExecution). Les guillemets simples du source JS sont retirés.
  const jetons = (cmd) => cmd.split(/[\s,]+/).map((t) => t.replace(/'/g, '')).filter(Boolean);
  const parallele = (t) => t === '-j' || (t.startsWith('-j') && /^\d+$/.test(t.slice(2)));
  const synchrone = (t) => t === '-O' || t.startsWith('--output-sync')
    || ['-Otarget', '-Oline', '-Orecurse', '-Onone'].includes(t);

  const commandes = [];
  for (const t of jsonc(lire('vscodium-user', 'tasks.json')).tasks) {
    commandes.push({ ou: 'tasks.json', nom: t.label, jetons: jetons(t.args.join(' ')) });
  }
  // Les invocations du code : un tableau d'arguments qui contient 'make'.
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  let n = 0;
  for (const m of src.matchAll(/\[[^[\]]*'make'[^[\]]*\]/g)) {
    n += 1;
    commandes.push({ ou: 'extension.js', nom: 'invocation #' + n, jetons: jetons(m[0]) });
  }
  assert.ok(n > 0, 'plus aucune invocation de make dans extension.js : le test ne garde rien');

  let vus = 0;
  for (const c of commandes) {
    if (!c.jetons.some(parallele)) { continue; }
    vus += 1;
    assert.ok(c.jetons.some(synchrone),
      c.ou + ' : « ' + c.nom + ' » compile en parallèle sans -O — le journal sortirait '
      + 'entrelacé et lib/journal.js attribuerait les avertissements au mauvais article');
  }
  assert.ok(vus > 0, 'plus aucune tâche ne compile en parallèle : le gain de -j est perdu');
});

// La cible profil-book-sans-fichier du Makefile écrit une phrase que lib/journal.js
// reconnaît pour produire le constat pipeline/profil-differe. Le test fait passer la phrase
// réelle du Makefile dans journal.js.
test('profil-differe : la prose que le Makefile écrit est celle que journal.js reconnaît', () => {
  const makefile = lire('pipeline', 'Makefile');
  const m = /@echo "\[pipeline\] (Ce dossier déclare[^"]*)"/.exec(makefile);
  assert.ok(m, 'la ligne de profil-book-sans-fichier est introuvable dans le Makefile (~L242)');
  const constats = journal.analyserJournal('[pipeline] ' + m[1] + '\n', 'fr');
  assert.ok(constats.some((c) => c.source === 'pipeline' && c.code === 'profil-differe'),
    'lib/journal.js ne reconnaît plus la prose de profil-book-sans-fichier : « ' + m[1] + ' »');
});

// familleCode() (lib/journal.js) reconnaît tout préfixe « <source>-<ton> » ; seule
// l'étiquette de section peut manquer, et la carte s'afficherait sous « ctl.source.pipeline ».
test('SOURCES_CONSTAT (lib/controles-hote.js) connaît typo et metafichier, avec leur clé traduite', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'lib', 'controles-hote.js');
  const i = src.indexOf('const SOURCES_CONSTAT');
  assert.ok(i !== -1, 'SOURCES_CONSTAT introuvable dans lib/controles-hote.js');
  const bloc = src.slice(i, src.indexOf('};', i));
  for (const source of ['typo', 'metafichier']) {
    const m = new RegExp(source + ":\\s*'(ctl\\.source\\.[a-z]+)'").exec(bloc);
    assert.ok(m, 'SOURCES_CONSTAT ne connaît pas la source « ' + source + ' »');
    for (const langue of ['fr', 'de']) {
      const dit = i18n.TL(langue, m[1]);
      assert.ok(dit && dit !== m[1],
        'étiquette de section sans texte ' + langue + ' pour « ' + source + ' » : ' + m[1]);
    }
  }
});

test('les libellés de tâches attendus par le code existent dans tasks.json', () => {
  const labels = jsonc(lire('vscodium-user', 'tasks.json')).tasks.map((t) => t.label);
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  for (const m of src.matchAll(/^const NOM_TACHE_\w+ = '([^']+)';$/gm)) {
    assert.ok(labels.includes(m[1]), 'aucune tâche nommée « ' + m[1] + ' » dans tasks.json');
  }
});

// Le nom de commande doit être l'argument d'un appel d'enregistrement : registerCommand(,
// cmd(, cmdEcriture( ou c( (raccourci de lib/formatting.js et lib/panneaux.js). Chercher le
// littéral n'importe où ne suffit pas : il survit dans des tables de libellés.
test('chaque commande déclarée dans package.json est enregistrée dans le code', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const src = fs.readdirSync(path.join(COCKPIT, 'lib'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(COCKPIT, 'lib', f), 'utf8'))
    .concat([lire('vscodium-extension', 'szh-cockpit', 'extension.js')])
    .join('\n');
  const enregistrees = new Set();
  for (const m of src.matchAll(/\b(?:registerCommand|cmdEcriture|cmd|c)\(\s*'([^']+)'/g)) {
    enregistrees.add(m[1]);
  }
  assert.ok(enregistrees.size > 30,
    'trop peu d’appels d’enregistrement détectés (' + enregistrees.size
    + ') : le motif de repérage a dû se désaccorder de cmd()/cmdEcriture()/registerCommand()');
  for (const c of pkg.contributes.commands) {
    assert.ok(enregistrees.has(c.command),
      'commande déclarée mais jamais enregistrée au voisinage de registerCommand(/cmd(/'
      + 'cmdEcriture( : ' + c.command);
  }
});

test('les raccourcis pointent des commandes qui existent', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const connues = new Set(pkg.contributes.commands.map((c) => c.command));
  for (const k of jsonc(lire('vscodium-user', 'keybindings.json'))) {
    if (k.command && k.command.startsWith('szh.')) {
      assert.ok(connues.has(k.command), 'raccourci vers une commande inconnue : ' + k.command);
    }
  }
});

// ---- Découvrabilité : chaque geste a un bouton, et le raccourci passe par le cockpit ----

test('la barre de titre de la vue offre « Importer des Word » en premier, hors numéro verrouillé', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const e = (pkg.contributes.menus['view/title'] || []).find((x) => x.command === 'szh.importerWord');
  assert.ok(e, 'szh.importerWord absent de view/title : l’import n’a pas de bouton dans la barre');
  assert.strictEqual(e.group, 'navigation@0');
  // \s couvre l'espace insécable que typo-check pose devant « ! », et que VS Code saute.
  assert.strictEqual(e.when.replace(/\s+/g, ' '), 'view == szhCockpitVue && !szh.verrouillee');
});

test('le clic droit d’un article offre « Revenir au texte d’avant » à côté du réimport', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const ctx = pkg.contributes.menus['view/item/context'];
  const reimport = ctx.find((x) => x.command === 'szh.reimporterArticle' && /viewItem == article\b/.test(x.when));
  const annuler = ctx.find((x) => x.command === 'szh.annulerReimport');
  assert.ok(reimport, 'szh.reimporterArticle a quitté le clic droit d’un article');
  assert.ok(annuler, 'szh.annulerReimport absent du clic droit : la confirmation du réimport y renvoie');
  assert.strictEqual(annuler.when.replace(/\s+/g, ' '), reimport.when.replace(/\s+/g, ' '));
  assert.strictEqual(annuler.group, 'reimport@2');
});

test('Ctrl+Alt+I passe par le cockpit, pas par la tâche d’import nue', () => {
  const k = jsonc(lire('vscodium-user', 'keybindings.json')).filter((x) => x.key === 'ctrl+alt+i');
  assert.strictEqual(k.length, 1, 'Ctrl+Alt+I doit avoir exactement une liaison');
  assert.strictEqual(k[0].command, 'szh.convertirEnAttente',
    'Ctrl+Alt+I contourne lancerConversion (ordre du Word, vérification de l’import) : ' + k[0].command);
  assert.strictEqual(k[0].when, 'szh.estRevue || szh.estLivre');
});

test('Ctrl+Alt+L lie un appel à une référence, et à rien d’autre', () => {
  const k = jsonc(lire('vscodium-user', 'keybindings.json')).filter((x) => x.key === 'ctrl+alt+l');
  assert.strictEqual(k.length, 1, 'Ctrl+Alt+L doit avoir exactement une liaison');
  assert.strictEqual(k[0].command, 'szh.lierReference');
  assert.strictEqual(k[0].when, 'editorTextFocus && editorLangId == markdown');
});

// editorActionsLocation vaut « hidden » : une entrée editor/title ne s'affiche nulle part.
test('aucune entrée editor/title morte pour l’aperçu', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  assert.strictEqual(pkg.contributes.configurationDefaults['workbench.editor.editorActionsLocation'], 'hidden');
  const titre = pkg.contributes.menus['editor/title'] || [];
  assert.ok(!titre.some((x) => x.command === 'szh.basculerApercu'),
    'szh.basculerApercu reste dans editor/title, que la barre masquée ne montre jamais');
});

test('l’aperçu se nomme « écran ⇄ PDF », dans la commande, le panneau, la barre et le tutoriel', () => {
  const nls = { fr: JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.json')),
    de: JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.de.json')) };
  const attendu = { fr: 'Aperçu : écran ⇄ PDF', de: 'Vorschau: Bildschirm ⇄ PDF' };
  for (const l of ['fr', 'de']) {
    // typo-check pose une espace fine insécable devant le deux-points français.
    const plat = (s) => String(s).replace(/[  ]/g, ' ');
    assert.strictEqual(plat(nls[l]['cmd.basculerApercu']), attendu[l]);
    assert.strictEqual(plat(i18n.TL(l, 'panneau.basculerApercu')), attendu[l]);
    assert.ok(plat(i18n.TL(l, 'apercu.barre.tooltip')).startsWith(attendu[l]), l + ' : info-bulle');
    assert.ok(plat(nls[l]['tuto.relire.texte']).indexOf('[' + attendu[l] + '](command:szh.basculerApercu)') !== -1,
      l + ' : lien du tutoriel');
    assert.ok(!/HTML ⇄ PDF/.test(nls[l]['cmd.basculerApercu'] + nls[l]['tuto.relire.texte']), l);
  }
});

test('le tutoriel révèle la barre latérale par l’explorateur, et la nomme Pronto', () => {
  for (const f of ['package.nls.json', 'package.nls.de.json']) {
    const texte = JSON.parse(lire('vscodium-extension', 'szh-cockpit', f))['tuto.ouvrir.texte'];
    assert.match(texte, /\]\(command:workbench\.view\.explorer\)/, f);
    assert.ok(texte.indexOf('command:szh.cockpit.rafraichir') === -1, f + ' : le lien ne révèle rien');
    assert.ok(texte.indexOf('Zeitschrift SZH') === -1, f + ' : la barre ne s’appelle plus ainsi');
    assert.match(texte, /\*\*Pronto\*\*/, f);
  }
});

test('« Ajouter une autrice ou un auteur » en fr, l’allemand inchangé', () => {
  assert.strictEqual(i18n.TL('fr', 'fiches.auteur.ajouter'), '➕ Ajouter une autrice ou un auteur');
  assert.strictEqual(i18n.TL('de', 'fiches.auteur.ajouter'), '➕ Autor hinzufügen');
});

// Les boutons « Prendre cette version » / « Garder la mienne » ne vivent que sur les
// repères de marge du diff rapide des copies en conflit (lib/cycle-vie.js).
test('les repères de marge du diff rapide sont visibles, sur le poste comme par défaut', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  assert.strictEqual(pkg.contributes.configurationDefaults['scm.diffDecorations'], 'gutter');
  assert.strictEqual(jsonc(lire('vscodium-user', 'settings.json'))['scm.diffDecorations'], 'gutter');
});

// « Pronto » ouvre une fenêtre vide sur l'Accueil : l'éditeur ne doit pas y rouvrir le
// dernier numéro. Réglage de portée application, que le cockpit pose lui-même.
test('l’éditeur ne rouvre aucune fenêtre au démarrage, sur le poste comme par défaut', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  assert.strictEqual(pkg.contributes.configurationDefaults['window.restoreWindows'], 'none');
  assert.strictEqual(jsonc(lire('vscodium-user', 'settings.json'))['window.restoreWindows'], 'none');
});

test('l’étape d’import du tutoriel se coche aussi par le geste nominal', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const etape = pkg.contributes.walkthroughs[0].steps.find((s) => s.id === 'szh.tuto.word');
  assert.ok(etape.completionEvents.includes('onCommand:szh.importerWord'), JSON.stringify(etape.completionEvents));
  assert.ok(etape.completionEvents.includes('onCommand:szh.convertirEnAttente'));
});

test('les traductions fr et de couvrent les mêmes clés, avec les mêmes repères', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  const debut = src.indexOf('const TEXTES_COCKPIT = {');
  const fin = src.indexOf('\n};', debut);
  // eslint-disable-next-line no-eval
  const textes = eval('(' + src.slice(debut + 'const TEXTES_COCKPIT = '.length, fin + 2) + ')');
  const reperes = (s) => (String(s).match(/\{\d\}/g) || []).sort().join('');
  for (const cle of Object.keys(textes.fr)) {
    assert.ok(cle in textes.de, 'clé sans traduction allemande : ' + cle);
    assert.strictEqual(reperes(textes.de[cle]), reperes(textes.fr[cle]),
      'repères {0} divergents sur : ' + cle);
  }
  assert.strictEqual(Object.keys(textes.de).length, Object.keys(textes.fr).length);
});

// textesTable() (lib/table-hote.js) traduit une liste de clés. Une clé absente d'i18n
// n'échoue pas : T() la rend telle quelle et l'éditeur affiche « table.x ».
test('chaque clé demandée par textesTable existe dans les traductions', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'lib', 'table-hote.js');
  const i = src.indexOf('function textesTable');
  assert.notStrictEqual(i, -1, 'fonction introuvable : textesTable');
  const bloc = src.slice(i, src.indexOf('\n}', i));
  const cles = [...bloc.matchAll(/'(table\.[A-Za-z0-9_.]+)'/g)].map((m) => m[1]);
  assert.ok(cles.length > 50, 'liste de clés introuvable dans textesTable');
  const i18n = lire('vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js');
  const debut = i18n.indexOf('const TEXTES_COCKPIT = {');
  const fin = i18n.indexOf('\n};', debut);
  // eslint-disable-next-line no-eval
  const textes = eval('(' + i18n.slice(debut + 'const TEXTES_COCKPIT = '.length, fin + 2) + ')');
  for (const cle of cles) {
    assert.ok(cle in textes.fr, 'clé demandée par textesTable sans traduction : ' + cle);
  }
});

test('le README de l’extension cite tous ses modules', () => {
  const readme = lire('vscodium-extension', 'szh-cockpit', 'README.md');
  for (const f of fs.readdirSync(path.join(COCKPIT, 'lib')).filter((f) => f.endsWith('.js'))) {
    assert.ok(readme.includes(f), 'module absent du README : lib/' + f);
  }
});

test('la palette du formulaire est celle du pipeline', () => {
  const py = lire('pipeline', 'accent-css.py');
  for (const hex of yaml.HEX_COULEURS) {
    assert.ok(py.toUpperCase().includes(hex.toUpperCase()),
      'couleur du cockpit absente de accent-css.py : ' + hex);
  }
});

// ---- Webviews ----

// Les libellés d'une webview viennent de l'hôte, dans un objet injecté à l'assemblage.
// Une clé oubliée n'échoue pas : le texte s'affiche « undefined ».
test('chaque libellé utilisé par une webview est fourni par l’hôte', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const cles = (nom) => {
    const i = src.indexOf('function ' + nom);
    assert.notStrictEqual(i, -1, 'fonction introuvable : ' + nom);
    const bloc = src.slice(i, src.indexOf('\n}', i));
    return new Set([...bloc.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*TP?\(/g)].map((m) => m[1]));
  };
  // La fiche d'auteur·e est partagée par les trois vues : ses libellés viennent de
  // textesAuteur(), qu'Object.assign ajoute à chaque table.
  // TABLES : entrées qui ne sont pas des textes T(...) mais des tables (intitulés de champs,
  // palette, noms des revues…). Leur contenu est contrôlé par test/js/articles.test.js.
  const TABLES = ['libelles', 'couleurs', 'revues', 'couvertureExtensions', 'couvertureMax'];
  const auteur = cles('textesAuteur');
  const communes = new Set([...cles('textesCarteArticle'), ...auteur]);
  const pages = {
    'metadata-articles': {
      libelles: new Set([...communes, ...cles('htmlApercuMetadonnees')]),
      fragments: ['_commun.js', '_auteurs.js', '_fiches.js']
    },
    'import-verif': {
      libelles: new Set([...communes, ...cles('htmlImportVerif')]),
      fragments: ['_commun.js', '_auteurs.js', '_fiches.js']
    },
    'medias-article': {
      libelles: new Set([...cles('textesMedias'), ...auteur]),
      fragments: ['_commun.js', '_auteurs.js']
    },
    // Les libellés des champs par type (typesConfig, typesRubrique) arrivent dans une table
    // à part. Les champs d'une fiche vivent dans media/_fiche-doc.js, qui lit ses libellés
    // par txt().xxx.
    'documentation': {
      libelles: cles('textesDocumentation'),
      fragments: ['_commun.js', '_fiche-doc.js']
    },
    // Le formulaire du numéro et la vue « Articles » partagent media/_numero.js : ses
    // libellés viennent de textesNumero(), qu'Object.assign ajoute à la table de la vue.
    'metadata-issue': {
      libelles: new Set([...cles('textesNumero'), ...TABLES]),
      fragments: ['_commun.js', '_numero.js']
    },
    'articles': {
      // `estLivre` est un drapeau : la page monte alors le formulaire du livre.
      libelles: new Set([...cles('textesNumero'), ...cles('textesArticles'), ...TABLES, 'estLivre']),
      fragments: ['_commun.js', '_numero.js']
    },
    // Le formulaire du livre partage media/_numero.js ; textesLivre() part de
    // Object.assign(textesNumero(), …), d'où cles('textesNumero').
    // 'licences' n'est pas listée : elle est lue par TXT[champ.optionsDe], que la regex
    // ci-dessous ne voit pas. Le test suivant couvre ce cas.
    'metadata-book': {
      libelles: new Set([...cles('textesNumero'), ...TABLES]),
      fragments: ['_commun.js', '_numero.js']
    }
  };
  for (const page of Object.keys(pages)) {
    const js = pages[page].fragments.concat([page + '.js'])
      .map((f) => fs.readFileSync(path.join(COCKPIT, 'media', f), 'utf8')).join('\n');
    for (const m of js.matchAll(/(?:\bTXT|\btxt\(\))\.([A-Za-z0-9_]+)/g)) {
      assert.ok(pages[page].libelles.has(m[1]),
        'libellé « ' + m[1] +' » utilisé par ' + page + ' mais absent de l’hôte');
    }
  }
});

// Un champ à options dynamiques lit TXT[champ.optionsDe], invisible pour le test
// précédent : chaque `optionsDe` de CHAMPS_LIVRE doit être une clé fournie par textesLivre().
test('formulaire du livre : chaque option dynamique (optionsDe) est fournie par l’hôte', () => {
  const fragment = fs.readFileSync(path.join(COCKPIT, 'media', '_numero.js'), 'utf8');
  const debut = fragment.indexOf('var CHAMPS_LIVRE = [');
  assert.notStrictEqual(debut, -1, 'CHAMPS_LIVRE introuvable dans _numero.js');
  const table = fragment.slice(debut, fragment.indexOf('\n  ];', debut));
  const optionsDe = [...table.matchAll(/optionsDe: '([^']+)'/g)].map((m) => m[1]);
  assert.ok(optionsDe.length > 0,
    'aucun champ à options dynamiques dans CHAMPS_LIVRE : ce contrôle n’a plus de sujet');
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const i = src.indexOf('function textesLivre()');
  assert.notStrictEqual(i, -1, 'textesLivre() introuvable');
  const bloc = src.slice(i, src.indexOf('\n}', i));
  for (const cle of optionsDe) {
    assert.match(bloc, new RegExp('\\b' + cle + ':'),
      'optionsDe « ' + cle + ' » n’est fourni nulle part par textesLivre()');
  }
});

// Le tutoriel est déclaratif : textes dans les deux package.nls, dessins sur le disque,
// liens vers des commandes. Aucune de ces erreurs ne se signale à l'exécution.
test('le tutoriel a ses libellés, ses dessins et des liens qui mènent quelque part', () => {
  const manifeste = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const nls = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.json'));
  const nlsDe = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.de.json'));
  const tuto = (manifeste.contributes.walkthroughs || [])[0];
  assert.ok(tuto, 'aucun tutoriel déclaré');
  assert.ok(tuto.steps.length >= 8, 'tutoriel trop court : ' + tuto.steps.length + ' étapes');
  const commandes = new Set(manifeste.contributes.commands.map((c) => c.command));
  // Une seule commande native admise, nommément : celle qui révèle l'explorateur.
  commandes.add('workbench.view.explorer');
  const cle = (v) => (typeof v === 'string' && v.startsWith('%') ? v.replace(/%/g, '') : null);
  const verifier = (valeur, ou) => {
    const k = cle(valeur);
    if (!k) { return null; }
    assert.ok(k in nls, 'libellé français absent : ' + k + ' (' + ou + ')');
    assert.ok(k in nlsDe, 'libellé allemand absent : ' + k + ' (' + ou + ')');
    return nls[k];
  };
  verifier(tuto.title, 'titre');
  verifier(tuto.description, 'introduction');
  for (const etape of tuto.steps) {
    verifier(etape.title, etape.id);
    verifier(etape.media.altText, etape.id);
    const texte = verifier(etape.description, etape.id) || '';
    for (const m of texte.matchAll(/command:([A-Za-z0-9._]+)/g)) {
      assert.ok(commandes.has(m[1]), 'lien vers une commande inconnue : ' + m[1] + ' (' + etape.id + ')');
    }
    const svg = path.join(COCKPIT, etape.media.svg);
    assert.ok(fs.existsSync(svg), 'dessin absent : ' + etape.media.svg);
    assert.match(fs.readFileSync(svg, 'utf8'), /currentColor/,
      'dessin qui ne suit pas la couleur du thème : ' + etape.media.svg);
    assert.ok((etape.completionEvents || []).length > 0, 'étape sans condition de complétion : ' + etape.id);
  }
  assert.ok(commandes.has('szh.tutoriel'), 'aucune commande n’ouvre le tutoriel');
});

// Les réglages écrivent à chaque changement de choix et ne figurent pas dans la liste.
test('chaque formulaire qui écrit enregistre automatiquement', () => {
  const attendus = ['metadata-articles', 'metadata-issue', 'import-verif', 'medias-article',
    'traduction', 'table-editor', 'articles', 'metadata-book', 'documentation'];
  const partages = {
    'metadata-articles': ['_fiches.js'], 'import-verif': ['_fiches.js'],
    'metadata-issue': ['_numero.js'], 'articles': ['_numero.js'],
    'metadata-book': ['_numero.js']
  };
  for (const page of attendus) {
    const fragments = [page + '.js'].concat(partages[page] || []);
    const js = fragments
      .map((f) => fs.readFileSync(path.join(COCKPIT, 'media', f), 'utf8')).join(' ');
    assert.match(js, /SZH\.autoEnregistrement\(/,
      'formulaire sans enregistrement automatique : ' + page);
  }
});

// Une page sans _design.css perd ses variables CSS sans erreur. Un fragment mal nommé dans
// cssPartage ou jsPartage ne se voit qu'à l'ouverture du panneau.
test('chaque webview reçoit le socle visuel, et ses fragments existent', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const appels = [...src.matchAll(/construireHtml\('([a-z-]+)', nonce, \{([\s\S]{0,700}?)\}\);/g)];
  // Compte en dur, qui tient lieu d'inventaire : une page ajoutée le fait échouer, et c'est
  // le moment de relire les assertions ci-dessous.
  assert.strictEqual(appels.length, 13, 'appels à construireHtml : ' + appels.length);
  for (const [, page, corps] of appels) {
    assert.ok(/cssPartage:\s*\[[^\]]*'_design\.css'/.test(corps), 'page sans le socle : ' + page);
    for (const m of corps.matchAll(/'(_[a-z]+\.(?:css|js))'/g)) {
      assert.ok(fs.existsSync(path.join(COCKPIT, 'media', m[1])), 'fragment absent : media/' + m[1]);
    }
    for (const ext of ['.html', '.css', '.js']) {
      assert.ok(fs.existsSync(path.join(COCKPIT, 'media', page + ext)),
        'fichier de page absent : media/' + page + ext);
    }
  }
});

// Ce que les deux formulaires de métadonnées partagent vit dans media/_fiches.{js,css}.
test('les deux formulaires de métadonnées ne se recopient pas', () => {
  const lignes = (f) => fs.readFileSync(path.join(COCKPIT, 'media', f), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('//'));
  const a = lignes('metadata-articles.js');
  const b = new Set(lignes('import-verif.js'));
  let suite = 0, pire = 0;
  for (const l of a) { suite = b.has(l) ? suite + 1 : 0; pire = Math.max(pire, suite); }
  assert.ok(pire < 10, 'bloc de ' + pire + ' lignes identiques : à remonter dans _fiches.js');
});

// Chaque webview décrit son protocole en commentaire de tête : la table doit citer tous les
// messages échangés.
test('les tables de protocole des webviews sont à jour', () => {
  const pages = {
    'metadata-articles': ['_fiches.js'],
    'import-verif': ['_fiches.js'],
    'traduction': [],
    'medias-article': [],
    'documentation': [],
    'vue-ensemble': [],
    'metadata-issue': ['_numero.js'],
    'articles': ['_numero.js'],
    'metadata-book': ['_numero.js']
  };
  for (const page of Object.keys(pages)) {
    const fichiers = [page + '.js'].concat(pages[page]);
    let code = '', doc = '';
    for (const f of fichiers) {
      const src = fs.readFileSync(path.join(COCKPIT, 'media', f), 'utf8');
      code += src + '\n';
      doc += src.split('\n').filter((l) => l.trim().startsWith('//')).join('\n') + '\n';
    }
    const types = new Set();
    for (const m of code.matchAll(/postMessage\(\s*\{\s*type:\s*'([^']+)'/g)) { types.add(m[1]); }
    for (const m of code.matchAll(/msg\.type === '([^']+)'/g)) { types.add(m[1]); }
    for (const t of types) {
      assert.ok(doc.includes(t), 'message « ' + t + ' » absent de la table de protocole de ' + page);
    }
  }
});

// Depuis la vue Articles, ouvrir un article n'ouvre que le .md, sans aperçu. Vérifié sur la
// source, extension.js ne se chargeant pas hors de l'éditeur : la vue passe l'option, la
// commande la transmet, ouvrirArticle s'arrête au .md. Les autres appelants ouvrent .md,
// compilation et aperçu.
test('vue Articles : « ouvrir » passe sansApercu, et seul ce chemin la porte', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const bloc = (nom) => {
    const i = src.indexOf('function ' + nom + '(');
    assert.notStrictEqual(i, -1, 'fonction introuvable : ' + nom);
    return src.slice(i, src.indexOf('\n}', i));
  };
  // 1. Le gestionnaire du message « ouvrir » de la vue Articles envoie l'option.
  assert.match(bloc('ouvrirVueArticles'),
    /executeCommand\('szh\.ouvrirArticle',[^;]*\{ sansApercu: true \}/,
    'la vue Articles n’envoie pas sansApercu : l’aperçu s’ouvrirait encore');
  // 2. L'enregistrement de la commande transmet le second argument, et accepte les deux
  //    formes d'appel : le slug seul (arbre, vue Articles) et { slug, focus } (actions des
  //    constats, voir lib/constats.js).
  const iCmd = src.indexOf("cmd('szh.ouvrirArticle'");
  assert.notStrictEqual(iCmd, -1, 'szh.ouvrirArticle n’est plus enregistrée');
  const enregistrement = src.slice(iCmd, iCmd + 400);
  assert.match(enregistrement, /ouvrirArticle\(fournisseur,[\s\S]*?opts\)/,
    'szh.ouvrirArticle ne propage pas les options à ouvrirArticle');
  assert.match(enregistrement, /typeof arg === 'object'/,
    'szh.ouvrirArticle n’accepte plus { slug, focus } : le geste d’un constat ne ferait rien');
  // 3. ouvrirArticle honore l'option : après l'ouverture du .md, avant le calcul
  //    d'obsolescence et la compilation.
  const fn = bloc('ouvrirArticle');
  const garde = fn.indexOf('opts.sansApercu');
  assert.notStrictEqual(garde, -1, 'ouvrirArticle ignore sansApercu');
  assert.ok(garde > fn.indexOf("executeCommand('vscode.open'"),
    'la garde sansApercu doit laisser le .md s’ouvrir en colonne 1');
  assert.ok(garde < fn.indexOf('obsolete') && garde < fn.indexOf('lancerBuild'),
    'la garde sansApercu doit précéder l’obsolescence et la compilation');
  // 4. Un seul chemin porte l'option.
  assert.strictEqual((src.match(/sansApercu: true/g) || []).length, 1,
    'sansApercu posé ailleurs que dans la vue Articles');
  assert.doesNotMatch(bloc('ouvrirVueEnsemble'), /sansApercu/,
    'la vue Contrôles ne doit pas changer de comportement');
  assert.doesNotMatch(bloc('ouvrirArticleActifAuDemarrage'), /sansApercu/,
    'l’ouverture au démarrage ne doit pas changer de comportement');
});

test('vue Articles : son ouverture ferme l’aperçu de la colonne 2', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const bloc = (nom) => {
    const i = src.indexOf('function ' + nom + '(');
    assert.notStrictEqual(i, -1, 'fonction introuvable : ' + nom);
    return src.slice(i, src.indexOf('\n}', i));
  };
  // Ouvrir la vue du numéro ferme l'aperçu de l'article quitté, que le panneau soit créé
  // ou seulement révélé.
  const fn = bloc('ouvrirVueArticles');
  const fermeture = fn.indexOf('fermerTousLesApercus()');
  assert.notStrictEqual(fermeture, -1,
    'ouvrirVueArticles ne ferme pas les aperçus : la colonne 2 resterait occupée');
  // panneauUnique révèle le panneau ouvert ou le crée : la fermeture précède donc les deux.
  const fabrique = fn.indexOf('panneauUnique(');
  assert.notStrictEqual(fabrique, -1, 'ouvrirVueArticles ne passe plus par panneauUnique');
  assert.ok(fermeture < fabrique,
    'la fermeture doit précéder le reveal et la création du panneau');
  // Réutilisé, pas recréé : aucun panneau fait main, et celui déjà ouvert reçoit ses valeurs.
  assert.doesNotMatch(fn, /createWebviewPanel|\.reveal\(/,
    'ouvrirVueArticles crée ou révèle encore son panneau à la main');
  assert.match(fn, /if \(!nouveau\) \{ envoyer\(panneau, true\); \}/,
    'la vue déjà ouverte n’est plus rechargée à sa réouverture');
  // Les rafraîchissements en tâche de fond passent par envoyerVue, qui ne ferme rien.
  assert.doesNotMatch(bloc('envoyerVue'), /fermerTousLesApercus/,
    'un rafraîchissement en tâche de fond ne doit pas fermer l’aperçu');
});

// ---- citations : le liage des appels de citation ----

test('citations : la liste de références est découpée comme le fait le filtre Lua', () => {
  const md = [
    'Comme le montrent Ebersold et Detraux (2013), on voit.', '',
    '# Références', '',
    'Ebersold, S., & Detraux, J.-J. (2013). Scolarisation. Alter, 7(2), 102-115.', '',
    'Ricœur, P. (1990). Soi-même comme un autre. Seuil.', '',
    'https://doi.org/10.1234/suite', '',
    'van der Aa, H. (2023). Un titre. Revue.', '',
    'insieme Schweiz (2024). Wahlanleitung. Insieme.', '',
    'Sen, A. (2001). Éthique. PUF.', '',
    'Sen, A. (2001). Autre texte, même année. PUF.'
  ].join('\n');
  const entrees = cit.referencesDuTexte(md);
  // Identifiants relevés sur la sortie de szh-citations.lua : un lien posé à la main doit
  // pointer sur l'ancre que le filtre pose.
  assert.deepStrictEqual(entrees.map((e) => e.id), [
    'ref-ebersold-2013', 'ref-ricoeur-1990', 'ref-van-2023',
    'ref-insieme-2024', 'ref-sen-2001', 'ref-sen-2001-b'
  ]);
  // La ligne d'URL seule est recollée à l'entrée précédente, pas comptée comme une entrée.
  assert.match(entrees[1].texte, /Seuil\. https:/);
});

// Les lexiques de titres de bibliographie (JS et Lua) se comparent en exécutant les deux
// implémentations, dans test/js/ancrages.test.js.

test('citations : une suite d’entrée se reconnaît aux cas qui ont déjà cassé', () => {
  // Le filtre Lua est éprouvé sur les mêmes cas par test/js/ancrages.test.js.
  assert.strictEqual(cit.estContinuation('https://doi.org/10.1234/x'), true);
  assert.strictEqual(cit.estContinuation('mit Behinderungen nach Geschlecht, ohne année'), true);
  assert.strictEqual(cit.estContinuation('van der Aa, H. (2023). Un titre.'), false);
  assert.strictEqual(cit.estContinuation('Übereinkommen über die Rechte, vom 13. Dezember 2006'), false);
  assert.strictEqual(cit.estContinuation('*Bathelt, J. (2019). Adaptive behaviour.'), false);
});

test('citations : lier un appel déjà lié le recible au lieu de l’imbriquer', () => {
  assert.strictEqual(cit.lienVersReference('(Shaw et al., 2023)', 'ref-shaw-2023'),
    '[(Shaw et al., 2023)](#ref-shaw-2023)');
  assert.strictEqual(cit.lienVersReference('[(Shaw et al., 2023)](#ref-vieux)', 'ref-shaw-2023'),
    '[(Shaw et al., 2023)](#ref-shaw-2023)');
});

test('citations : sans sélection, l’appel autour du curseur est retrouvé', () => {
  const l = 'On le voit (Shaw et al., 2023) ici.';
  assert.deepStrictEqual(cit.plageDeLAppel(l, 20), { debut: 11, fin: 30 });
  const dejaLie = 'On le voit [(Shaw, 2023)](#ref-shaw-2023) ici.';
  assert.deepStrictEqual(cit.plageDeLAppel(dejaLie, 20), { debut: 11, fin: 41 });
  assert.strictEqual(cit.plageDeLAppel('Aucune parenthèse ici.', 5), null);
});

test('la chaîne ne passe plus par AnyStyle ni par citeproc', () => {
  const mk = lire('pipeline', 'Makefile');
  const sh = lire('pipeline', 'import-docx.sh');
  for (const [nom, src] of [['Makefile', mk], ['import-docx.sh', sh]]) {
    assert.ok(!/citeproc|anystyle|\.bib\b|apa\.csl/i.test(src),
      nom + ' cite encore la bibliographie BibTeX');
  }
  // Le filtre de liage est dans la chaîne commune (CHAINE_SOCLE), donc dans le rendu et
  // dans l'aperçu.
  const chaines = require('./chaines-filtres-lire').lireChaines();
  assert.ok(chaines.CHAINE_SOCLE.includes('citations'), 'szh-citations a quitté le socle');
  assert.ok(chaines.CHAINE_ARTICLE.includes('citations') && chaines.CHAINE_APERCU.includes('citations'));
  assert.strictEqual((mk.match(/\$\(FILTRES_ARTICLE\)/g) || []).length, 1, 'le rendu ne prend plus FILTRES_ARTICLE');
  assert.strictEqual((mk.match(/\$\(FILTRES_APERCU\)/g) || []).length, 1, 'l’aperçu ne prend plus FILTRES_APERCU');
  assert.ok(!fs.existsSync(path.join(RACINE, 'pipeline', 'filters', 'szh-biblio.lua')));
  assert.ok(!fs.existsSync(path.join(RACINE, 'pipeline', 'csl')));
});

test('print.css : un appel de citation ne se lit pas comme un lien sortant', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  // Aucun lien du corps ne porte de flèche « lien sortant » en ::after.
  assert.doesNotMatch(css, /a\[href\]::after\s*\{[^}]*content:\s*url\(/,
    'une flèche ::after est revenue sur les liens du corps : décision du 09.09.2026 défaite');
  // L'appel de citation « (Bovey, 2022) » se lit comme du texte : couleur héritée, sans
  // soulignement.
  assert.match(css, /a\[href\^="#"\],\s*a\.szh-appel\s*\{\s*\n\s*color:\s*inherit;\s*text-decoration:\s*none;\s*\n\}/);
  // .szh-appel-orphelin vit dans partage-filtres.css, commune au livre.
  const partage = lire('pipeline', 'styles', 'partage-filtres.css');
  assert.match(partage, /\.szh-appel-orphelin \{[^}]*dotted/);
  // La marque des appels non liés ne doit vivre que dans l'aperçu.
  const lua = lire('pipeline', 'filters', 'szh-citations.lua');
  assert.match(lua, /SZH_APERCU/);
  assert.match(lire('pipeline', 'Makefile'), /SZH_APERCU=1 \$\(PANDOC\)/);
});

// Le dossier de dépôt des Word vient du profil (lib/profil.js) : articles-word/ pour la
// revue, chapitres-word/ pour le livre (WORD_DIR de livre.mk). Un nom écrit en dur ferait
// déposer les Word d'un livre là où la chaîne ne les cherche pas.
test('le dépôt Word vient du profil, et aucun nom n’est écrit en dur dans extension.js', () => {
  assert.strictEqual(profils.profilPour('revue').depot, 'articles-word');
  assert.strictEqual(profils.profilPour('livre').depot, 'chapitres-word');

  // Lecture d'extension.js seul : lib/profil.js porte ces littéraux, c'est la source.
  const src = fs.readFileSync(CHEMIN_EXTENSION, 'utf8');
  // Le code seul, sans les commentaires.
  const code = src.split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');

  for (const litteral of ["'articles-word'", '"articles-word"',
    "'chapitres-word'", '"chapitres-word"']) {
    assert.ok(!code.includes(litteral),
      'dépôt Word écrit en dur dans le code d’extension.js : ' + litteral
      + ' — passer par profilCourant().depot, sinon un livre cherche ses Word au mauvais '
      + 'endroit et la conversion ne part jamais.');
  }

  assert.ok(/profilCourant\(\)\.depot/.test(code),
    'aucun appel à profilCourant().depot : le routage du dépôt Word a disparu.');
});

// ---- Échecs de WeasyPrint et métafichiers Windows ----
//
// Une image .emf peut faire tomber WeasyPrint au bout d'une longue compilation. La recette
// doit dire la cause, et l'image doit être remplacée plutôt que bloquer le rendu.

test('PDF : l’échec de la dernière tentative WeasyPrint ne passe plus pour un succès', () => {
  // La cascade tente pdf/ua-1, puis --pdf-tags, puis un PDF nu. Chaque appel doit avoir son
  // code de sortie lu, sinon l'échec ne se voit qu'au « mv: cannot stat » qui suit.
  for (const [nom, chemins] of [['Makefile', ['pipeline', 'Makefile']],
                                ['livre.mk', ['pipeline', 'profils', 'livre.mk']]]) {
    const nus = lire(...chemins).split('\n')
      .filter((l) => l.includes('$(WEASYPRINT)') && !/\bif |\belif |\|\|/.test(l));
    assert.deepStrictEqual(nus, [],
      nom + ' : un appel à WeasyPrint dont personne ne lit le code de sortie. Son échec ne '
      + 'se verrait qu’au « mv: cannot stat » de la ligne suivante.');
  }
});

test('PDF : quand WeasyPrint tombe, la recette dit sa cause au lieu de la taire', () => {
  const livre = lire('pipeline', 'profils', 'livre.mk');
  assert.match(livre, /Journal complet : \$\$jrnl/,
    'l’emplacement du journal WeasyPrint n’est plus indiqué : sans lui, la cause est '
    + 'introuvable une fois la compilation terminée');
  // Le résumé s'arrête à vingt lignes et dit combien il en reste : vingt avertissements
  // anodins peuvent masquer l'exception.
  assert.match(livre, /ligne\(s\) de plus dans/,
    'le journal est tronqué à vingt lignes sans le dire');
});

test('métafichiers Windows : le filtre de substitution est dans les trois chaînes', () => {
  // L'image est remplacée par un placeholder, qui montre où est le trou, et le document se
  // compose jusqu'au bout.
  const chaines = require('./chaines-filtres-lire').lireChaines();
  const nb = (c) => c.filter((f) => f === 'metafichier').length;
  assert.strictEqual(nb(chaines.CHAINE_ARTICLE) + nb(chaines.CHAINE_APERCU), 2,
    'le filtre doit être dans les DEUX chaînes de la revue — le rendu ET l’aperçu : '
    + 'un aperçu qui tomberait sur une image native Word laisserait le rédacteur sans vue');
  assert.strictEqual(nb(chaines.CHAINE_CHAPITRE), 1, 'le filtre a quitté la chaîne des chapitres');
  // Après tabelle-inclure, qui réinjecte les tableaux et leurs images (voir l'en-tête du
  // filtre).
  for (const nom of ['CHAINE_ARTICLE', 'CHAINE_APERCU', 'CHAINE_CHAPITRE']) {
    const src = chaines[nom];
    assert.ok(src.indexOf('tabelle-inclure') < src.indexOf('metafichier'),
      nom + ' : szh-metafichier passe AVANT szh-tabelle-inclure, il ne verrait donc pas '
      + 'une image citée uniquement dans un tableau extrait');
    assert.ok(src.indexOf('metafichier') < src.indexOf('grille'),
      nom + ' : szh-metafichier passe après szh-grille, qui ne verrait plus l’image');
  }
  assert.ok(fs.existsSync(path.join(RACINE, 'pipeline', 'media', 'image-a-remplacer.svg')),
    'le placeholder a disparu du toolkit : le filtre se désactive alors de lui-même');
});

// L'exergue d'un chapitre est muette dans le livre publié comme dans la revue, mais pas dans
// son aperçu, qui sert à la relire.
test('livre : szh-exergue est dans la chaîne du chapitre, à la place de la revue, et hors de l’aperçu', () => {
  const livre = lire('pipeline', 'profils', 'livre.mk');
  const chaines = require('./chaines-filtres-lire').lireChaines();
  const suite = chaines.CHAINE_CHAPITRE;
  assert.ok(suite, 'CHAINE_CHAPITRE introuvable dans filtres.mk');
  const rang = (f) => suite.indexOf(f);
  assert.ok(rang('exergue') !== -1, 'szh-exergue.lua n’est pas dans FILTRES_CHAPITRE');
  assert.ok(rang('cesure') < rang('exergue') && rang('exergue') < rang('notes'),
    'szh-exergue doit venir après szh-cesure et avant szh-notes, comme dans la revue');
  const i = livre.indexOf('\n$(OUT)/$(CH_DIR)/%.apercu.html:');
  const apercu = livre.slice(i, livre.indexOf('\n\n', i + 1));
  assert.doesNotMatch(apercu, /\$\(FILTRES_CHAPITRE\)/,
    'l’aperçu du chapitre reprend la chaîne publiée, exergue muette comprise');
  assert.match(apercu, /\$\(FILTRES_CHAPITRE_APERCU\)/);
  assert.deepStrictEqual(chaines.CHAINE_CHAPITRE_APERCU, suite.filter((f) => f !== 'exergue'),
    'l’aperçu du chapitre n’est plus la chaîne publiée moins szh-exergue');
});

test('métafichiers Windows : les deux extensions se testent SANS alternation Lua', () => {
  // Les motifs Lua n'ont pas d'alternation : '%.(emf|wmf)$' chercherait le texte littéral
  // « (emf|wmf) » et ne trouverait jamais rien.
  const lua = lire('pipeline', 'filters', 'szh-metafichier.lua');
  const table = /local EXTENSIONS = \{([^}]*)\}/.exec(lua);
  assert.ok(table, 'la table des extensions a disparu');
  assert.deepStrictEqual(
    table[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort(),
    ['%.emf$', '%.wmf$'],
    'deux motifs simples et séparés, jamais une alternation');
  // Word écrit parfois .EMF.
  assert.match(lua, /cible:lower\(\)/,
    'la comparaison n’est plus insensible à la casse : un « .EMF » passerait au travers');
});

test('PDF/UA : la porte valide le PDF du LIVRE, pas une liste vide', () => {
  // `verifier-ua` lit PDFS_UA, que livre.mk fixe au PDF du livre. Avec $(PDFS) (les PDF
  // des articles), un dossier de livre n'aurait rien à valider.
  const mk = lire('pipeline', 'Makefile');
  assert.match(mk, /^verifier-ua: \$\$\(PDFS_UA\)$/m,
    'la porte PDF/UA ne passe plus par PDFS_UA en seconde expansion — sans les deux « $ », '
    + 'la liste est figée à la valeur de la revue avant l’inclusion de livre.mk');
  // Le Makefile passe PDFS_UA à verifier-ua.sh, qui la passe à veraPDF : le validateur
  // reçoit la même liste que les prérequis.
  assert.match(mk, /bash "\$\(PIPELINE_DIR\)\/verifier-ua\.sh" "\$\(OUT\)\/\.szh-pdfua\.xml" \$\(PDFS_UA\)/,
    'le validateur reçoit une autre liste que celle des prérequis');
  assert.match(lire('pipeline', 'profils', 'livre.mk'), /^PDFS_UA {4}:= \$\(LIVRE_PDF\)$/m,
    'le profil livre ne dit plus quel PDF valider : la porte retomberait sur une liste vide');
});

test('livre : un dossier de chapitre préfixé « _ » n’est pas imprimé, et il est annoncé', () => {
  const livre = lire('pipeline', 'profils', 'livre.mk');
  assert.match(livre, /TOUS_CHAPITRES := \$\(filter-out _%,/,
    'les pièces de travail redeviennent des chapitres : la page de titre du manuscrit '
    + 'd’origine se réimprimerait en dernier chapitre du livre');
  // La liste des dossiers écartés est une variable make ; le constat est émis en ligne
  // codée par verifie-livre, et non par $(warning), qui se répéterait à chaque sous-make.
  assert.match(livre, /CHAPITRES_ECARTES := \$\(filter _%,\$\(DOSSIERS_CHAPITRES\)\)/,
    'la liste des dossiers écartés (préfixe « _ ») n’est plus calculée : plus rien à annoncer');
  assert.match(livre, /\[livre-avertissement\] chapitre-ecarte \|/,
    'un dossier écarté doit être ANNONCÉ, en ligne codée — un chapitre qui disparaît en '
    + 'silence est pire qu’un chapitre en trop');
  // L'exclusion ne vaut que si la scission pose réellement ce préfixe.
  assert.match(lire('pipeline', 'livre-scinder.py'), /_scission-\{slug_original\}/,
    'livre-scinder.py ne préfixe plus sa pièce de rebut : l’exclusion ne protège plus rien');
});

// ---- Protocole de messages des webviews : une seule table, deux dépôts ----
//
// lib/messages.js (l'hôte) et media/_messages.js (la webview) portent la même table
// SZH.MSG. Ce contrat compare les deux tables ; le chargement de _messages.js dans chaque
// page est vérifié par webviews.test.js et apercu-page.test.js.
test('protocole de messages : SZH.MSG concorde entre lib/messages.js et media/_messages.js', () => {
  const { MSG } = require(path.join(COCKPIT, 'lib', 'messages.js'));
  const src = lire('vscodium-extension', 'szh-cockpit', 'media', '_messages.js');
  const marque = 'SZH.MSG = Object.freeze(';
  const debut = src.indexOf(marque);
  assert.notStrictEqual(debut, -1, 'table SZH.MSG introuvable dans media/_messages.js');
  const fin = src.lastIndexOf(');');
  // eslint-disable-next-line no-eval
  const webview = eval('(' + src.slice(debut + marque.length, fin) + ')');
  assert.deepStrictEqual(Object.keys(webview).sort(), Object.keys(MSG).sort(),
    'les clés de SZH.MSG divergent entre lib/messages.js et media/_messages.js');
  for (const cle of Object.keys(MSG)) {
    assert.strictEqual(webview[cle], MSG[cle], 'valeur SZH.MSG.' + cle + ' divergente');
  }
});

// Côté hôte, un message vers une webview se nomme par MSG.<NOM>. Tout `type: '…'` dans
// extension.js et lib/*-hote.js est refusé, sauf les `type:` qui ne sont pas des messages
// (liste NON_MESSAGES).
test('protocole de messages : aucun littéral type: \'…\' côté hôte (MSG.<NOM> à la place)', () => {
  const NON_MESSAGES = {
    // Définition de tâche VS Code { type: 'szh', cible, slug }, pas un message de webview.
    'extension.js': ["type: 'szh'"],
    // Champ « type » (article, chapitre…) d'une fiche : vide par défaut, c'est une donnée.
    'lib/metadonnees-hote.js': ["type: ''"]
  };
  const fichiers = ['extension.js'].concat(
    fs.readdirSync(path.join(COCKPIT, 'lib')).filter((f) => /-hote\.js$/.test(f)).map((f) => 'lib/' + f));
  const fautes = [];
  for (const f of fichiers) {
    const permis = NON_MESSAGES[f] || [];
    fs.readFileSync(path.join(COCKPIT, f), 'utf8').split('\n').forEach((ligne, i) => {
      if (/^\s*\/\//.test(ligne)) { return; }
      for (const m of ligne.match(/\btype: '[^']*'/g) || []) {
        if (permis.indexOf(m) === -1) { fautes.push(f + ':' + (i + 1) + ' ' + m); }
      }
    });
  }
  assert.deepStrictEqual(fautes, [], 'littéraux type: à remplacer par MSG.<NOM> :\n' + fautes.join('\n'));
});

// Une clause `when` est du code : typo-check ne doit pas y poser d'espace insécable devant
// « ! ».
test('les clauses when de package.json ne portent que des espaces ordinaires', () => {
  const fautes = [];
  lire('vscodium-extension', 'szh-cockpit', 'package.json').split('\n').forEach((l, i) => {
    if (/"(when|enablement)"\s*:/.test(l) && / | /.test(l)) { fautes.push((i + 1) + ': ' + l.trim()); }
  });
  assert.deepStrictEqual(fautes, []);
});
