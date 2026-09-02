// Contrôles des contrats de l'extension szh-cockpit, sans dépendance ni build.
//
//   node --test test/js
//
// Ne couvre que les modules chargeables hors de l'éditeur, ceux qui n'appellent pas
// require('vscode'). Deux familles de contrôle : l'aller-retour, où analyser puis
// sérialiser doit rendre la source intacte ; et la cohérence, où une valeur recopiée d'un
// fichier à l'autre doit concorder avec sa source.
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

const lire = (...p) => fs.readFileSync(path.join(RACINE, ...p), 'utf8');

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

// Défaut réel (01.09.2026) : la ligne qui suit immédiatement le BOM ne matchait pas la
// regex de clé — son premier caractère n'étant plus alphanumérique — et la première clé du
// fichier se lisait comme absente, en silence. serialiserAusgabe() retire le BOM depuis
// toujours (test ci-dessus, « le BOM … sont préservés ») ; analyserAusgabe() ne le faisait
// pas : un ausgabe.yaml ou buch.yaml enregistré par un éditeur Windows ou par `Out-File` de
// PowerShell 5.1 perdait ainsi sa première clé.
test('ausgabe.yaml : le BOM ne fait pas perdre la première clé à la lecture', () => {
  const relu = yaml.analyserAusgabe('﻿' + 'titre: Livre\nannee: 2020\n');
  assert.strictEqual(relu.titre, 'Livre', 'la première clé après le BOM est tombée en silence');
  assert.strictEqual(relu.annee, '2020');
});

// Défaut réel (01.09.2026) : un `impression:` portant une valeur non vide (YAML douteux,
// mais pas invalide) n'ouvrait pas de bloc côté sérialiseur — les sous-lignes indentées
// restaient orphelines, et une sous-clé à écrire tombait dans la branche « bloc absent »,
// qui en créait un SECOND en fin de fichier. Le fichier sortait avec deux clés top-level
// `impression:`, l'ancienne gardant ses données orphelines : le contrat du sérialiseur est
// que ce qu'il ne connaît pas traverse intact, jamais dupliqué en silence.
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

// Un en-tête sur DEUX rangées (une fusion au-dessus d'une rangée de titres, comme le
// tableau des auteurs des imports Word) doit sortir en balisage complexe — id sur chaque
// en-tête, scope col/colgroup, headers sur chaque cellule de données (WCAG H43, RGAA 5.7) —
// et l'aller-retour doit conserver le compte. C'est le balisage que docx-tables.py écrit
// à l'import : l'éditeur ne doit pas dire autre chose.
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

// Titres de section (en-têtes intermédiaires), règle actée avec Robin (26.08.2026) :
// une rangée fusionnée pleine largeur marquée « titre de section » donne son en-tête aux
// rangées qui la suivent, jusqu'au prochain titre ; elle REMPLACE alors le titre de
// groupe du thead, les en-têtes simples (une cellule par colonne) restant — exprimé en
// headers= (WCAG H43, RGAA 5.7), seul lien que les lecteurs d'écran suivent exactement.
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

// Titre de section PARTIEL (précision de Robin, 26.08.2026, sur capture) : une fusion de
// 2 colonnes sur 3 marquée titre ne couvre QUE ses colonnes — la cellule restante de sa
// rangée reste une donnée, et la colonne non couverte garde le titre de groupe du thead.
// La fusion existante n'est PAS étendue à toute la rangée par l'opération.
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

// Le sens transposé de la même règle : un en-tête de ligne FUSIONNÉ (rowspan, colonne de
// gauche) donne son groupe aux rangées qu'il couvre, l'en-tête simple de la 2e colonne
// donne sa ligne — la géométrie du rowspan fait le « jusqu'où », pas de marqueur à poser.
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

// B1 (26.08.2026, demande de Robin) : le numéro de tête d'un Word ne nomme plus le
// dossier — il ne survivait pas à un déplacement dans l'ordre. Le slug ne le porte plus
// du tout ; numeroOrdreArticle() ci-dessous est ce qui le récupère pour ausgabe.yaml.
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

// Régression du 31.08.2026 au 01.09.2026 : `^[0-9]+-` appliqué APRÈS slugifier() ne peut
// plus distinguer un vrai numéro de tête (séparateur explicite `_` ou `-`, comme
// « 4_Titre » ou le « 01-… » que chapitres-word/LISEZ-MOI.txt et articles-word/LISEZ-MOI.txt
// donnent comme convention) d'un nombre qui fait partie du titre lui-même et que slugifier()
// a fait suivre d'un tiret à la place de son espace d'origine. « 2024 en chiffres » perdait
// son 2024, ET numeroOrdreArticle() le prenait pour un numéro d'ordre, rangeant l'article en
// 2024ᵉ position.
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

// ⚠ Cette distinction (séparateur explicite `_`/`-` vs espace du titre) n'existe qu'ici :
// pipeline/Makefile applique encore, sans condition, `sed -E 's/^[0-9]+-//'` (~L547) au slug
// déjà collapsé — où l'espace de « 2024 en chiffres » est devenu le même tiret que le
// séparateur de « 4_Titre ». Un import en CLI pur (make import, hors cockpit) ampute donc
// encore un titre commençant par un nombre légitime ; voir le repère laissé dans le Makefile
// (~L486, commentaire de synchronisation) pour la correction à y reporter : tester le nom
// BRUT, avant la translittération/minuscule/collapse-en-tirets (Makefile ~L543-546), avec
// un motif du type `case "$$slug" in [0-9]*[_-]*) a_un_numero=1;; esac`, et n'appliquer le
// sed de retrait qu'à cette condition — exactement ce qu'aUnNumeroDeTete() fait côté JS.

// Le point de conception de B1 : retirer le préfixe sans rien faire d'autre perdrait en
// silence l'ordre que le rédacteur a mis dans la numérotation de ses Word. Dix fichiers,
// numérotés 1 à 10 (donc un au-delà de 9, le cas qui motivait jadis le complément à deux
// chiffres) et dont les titres, triés alphabétiquement, donneraient un tout autre ordre.
test('ordre du rédacteur : le numéro du Word migre vers ordre-articles sans se perdre', () => {
  const mots = [
    '1_Zebre.docx', '2_Alpha.docx', '3_Yak.docx', '4_Bison.docx', '5_Wapiti.docx',
    '6_Chevre.docx', '7_Vache.docx', '8_Dromadaire.docx', '9_Uranus.docx', '10_Elan.docx'
  ];
  const slugs = mots.map(slug.slugifierArticle);
  // Le slug ne porte plus aucune trace du numéro : c'est tout le sens de B1.
  assert.ok(slugs.every((s) => !/^[0-9]/.test(s)),
    'un slug commence encore par un chiffre : ' + JSON.stringify(slugs));

  // Ce que le cockpit doit écrire dans `ordre-articles` à l'import : le numéro reste
  // capté par numeroOrdreArticle(), et permet de reconstituer l'ordre voulu.
  const ordreInitial = mots
    .map((nom) => ({ slug: slug.slugifierArticle(nom), numero: slug.numeroOrdreArticle(nom) }))
    .sort((a, b) => a.numero - b.numero)
    .map((x) => x.slug);
  assert.deepStrictEqual(ordreInitial,
    ['zebre', 'alpha', 'yak', 'bison', 'wapiti', 'chevre', 'vache', 'dromadaire', 'uranus', 'elan'],
    'l’ordre du rédacteur ne survit pas au retrait du préfixe numérique');

  // Le repli qui reste dans extension.js une fois le préfixe retiré — un tri alphabétique
  // des noms de dossier — donnerait un tout autre ordre : la preuve que cet ordre n'est
  // plus, par accident, le bon, et que le numéro doit vraiment être écrit dans
  // ordre-articles avant que ce repli ne s'applique.
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
// Une grille est une figure faite de plusieurs images. Trois choses peuvent casser sans
// bruit, et ce sont celles-ci qu'on éprouve : le bloc écrit dans le .md, qui doit rester
// relisible par le filtre ; la légende, qui n'appartient qu'à la première image ; et la
// table des dispositions, recopiée dans le filtre Lua parce que Lua et JS ne partagent
// rien — une divergence donnerait un menu qui propose ce que le rendu ne sait pas faire.

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
  // b.png était insérée ailleurs : elle est DÉPLACÉE, pas dupliquée.
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'b.png').n, 1);
  const grilles = refs.lireGrilles(pose.texte);
  assert.strictEqual(grilles.length, 1);
  assert.deepStrictEqual(grilles[0].membres.map((m) => m.relatif), ['a.png', 'b.png']);
  // Elle emporte son texte alternatif et ses crédits, jamais sa légende : la figure n'en
  // porte qu'une, celle de son ancre.
  assert.strictEqual(pose.legendePerdue, true);
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'b.png').alt, 'desc B');
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'b.png').legende, '');
  assert.strictEqual(refs.lireAttributsImage(pose.texte, 'a.png').legende, 'Une légende');
});

test('grille : la légende d’une image suivante ne s’écrit jamais', () => {
  const pose = refs.poserDansGrille(MD_DEUX, 'a.png', 'b.png');
  // Le formulaire peut envoyer n'importe quoi — une saisie faite avant que la carte ne
  // soit verrouillée, par exemple : c'est l'écriture qui tranche.
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

  // « Retirer de la figure » : l'image quitte la grille ET le texte. Le fichier, lui,
  // reste dans l'article — sa carte doit pouvoir le réinsérer ailleurs.
  const ote = refs.retirerDeGrille(md, 'b.png', { garderDansTexte: false });
  assert.strictEqual(ote.ok, true);
  assert.strictEqual(refs.lireAttributsImage(ote.texte, 'b.png').n, 0,
    '« retirer de la figure » a laissé une insertion derrière lui');
  // Ce à quoi il ne doit PAS toucher : l'image d'à côté, la figure, sa légende.
  const apres = refs.lireGrilles(ote.texte)[0];
  assert.deepStrictEqual(apres.membres.map((m) => m.relatif), ['a.png', 'c.png']);
  assert.strictEqual(refs.lireAttributsImage(ote.texte, 'a.png').legende, 'Une légende');
  assert.strictEqual(refs.lireAttributsImage(ote.texte, 'c.png').n, 1);

  // Une de plus, et la grille se dissout : ce qui reste redevient une figure ordinaire,
  // toujours dans l'article.
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
  // Le défaut, sans option, est le geste doux : on ne retire rien du texte sans le dire.
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
  // Deux panoramas l'un sur l'autre — côte à côte ils feraient un bandeau ; deux portraits
  // côte à côte. C'est la seule règle du mode, et c'est celle qu'on éprouve.
  assert.strictEqual(refs.dispositionAutomatique(2, [3, 3]), '1-1');
  assert.strictEqual(refs.dispositionAutomatique(2, [0.75, 0.75]), '2');
  assert.strictEqual(refs.dispositionAutomatique(4, [1.5, 1.5, 1.5, 1.5]), '2-2');
  assert.strictEqual(refs.dispositionAutomatique(5, [1.5, 1.5, 1.5, 1.5, 1.5]), '3-2');
  assert.strictEqual(refs.dispositionAutomatique(6, [1.5, 1.5, 1.5, 1.5, 1.5, 1.5]), '3-3');
  // Une seule mesure manquante et le calcul ne veut plus rien dire : on rend le repli.
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
  // Lua et JS ne partagent rien : la table est recopiée dans szh-grille.lua. Une
  // divergence donnerait un menu proposant ce que le rendu ne sait pas composer — et
  // personne ne le verrait avant l'impression.
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
  const makefile = lire('pipeline', 'Makefile');
  const lignes = makefile.split('\n');
  const rang = (nom) => lignes.reduce((acc, l, i) => (l.includes('filters/' + nom) ? acc.concat(i) : acc), []);
  const grille = rang('szh-grille.lua');
  const figure = rang('szh-figure.lua');
  assert.strictEqual(grille.length, 2, 'szh-grille n’est pas branché dans les deux chaînes');
  assert.strictEqual(figure.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.ok(grille[i] < figure[i],
      'szh-grille doit précéder szh-figure : une grille tombée à une image se dissout en paragraphe');
  }
});

test('grille : print.css met en page les rangées que le filtre écrit', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  for (const regle of ['.szh-grille-rangee', '.szh-grille-case']) {
    assert.ok(css.includes(regle), 'règle absente de print.css : ' + regle);
  }
  // La base nulle est ce qui fait la mise en page justifiée : sans elle, le flex-grow
  // écrit par le filtre ne donne plus des hauteurs égales, mais des largeurs au hasard.
  assert.match(css, /\.szh-grille-case\s*\{[^}]*flex-basis:\s*0/,
    'la case de grille n’a plus sa base nulle : la mise en page justifiée tombe');
  // Écran étroit : la rangée se défait. La requête est imbriquée dans un « @media screen »
  // nu — WeasyPrint 69 ne connaît pas les caractéristiques de média et hurlerait à chaque
  // article si elle était écrite à plat. Le contrôle porte sur cette forme-là, la remettre
  // à plat étant la correction « évidente » que quelqu'un fera un jour.
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
  // Sans option, ou option éteinte : comportement historique — les appels existants ne
  // changent pas de verdict.
  assert.strictEqual(qualite.qualiteImage('figure', { largeur: 1500, hauteur: 600 }, 'x.png').niveau, 'juste');
  assert.strictEqual(
    qualite.qualiteImage('portrait', { largeur: 2000, hauteur: 600 }, 'x.png', { reduit: false }).niveau,
    'juste');
});

// Le réglage qui porte cette option : déclaré au manifeste (défaut prudent : warnings
// complets), décrit en français et en allemand, lu et écrit par le panneau des réglages.
test('le réglage « réduire les warnings d’impression » est déclaré, traduit et branché', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const prop = pkg.contributes.configuration.properties['szh.reduireWarningsImpression'];
  assert.ok(prop, 'propriété absente du manifeste : szh.reduireWarningsImpression');
  assert.strictEqual(prop.default, false, 'le défaut doit laisser les warnings complets');
  const nls = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.json'));
  const nlsDe = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.de.json'));
  assert.ok('config.reduireWarningsImpression' in nls, 'description française absente');
  assert.ok('config.reduireWarningsImpression' in nlsDe, 'description allemande absente');
  // Le panneau des réglages lit et écrit ce réglage, et les trois verdicts de l'hôte
  // portent l'option — sans quoi le réglage existerait sans effet, panne muette.
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  assert.ok(src.includes("update('reduireWarningsImpression'"),
    'aucune branche d’écriture du réglage dans extension.js');
  assert.strictEqual(
    (src.match(/reduit: reduireWarningsImpressionActif\(\)/g) || []).length, 3,
    'les trois appels à qualiteImage doivent porter l’option');
  const panneau = lire('vscodium-extension', 'szh-cockpit', 'media', 'settings.js');
  assert.ok(panneau.includes("cle: 'warnings'"), 'groupe absent du panneau des réglages');
});

// Même contrat que ci-dessus, pour l'option qui coupe le lien entre appel et référence — avec
// en plus le relais vers le filtre Lua, qui ne partage aucune mémoire avec VSCodium : seul
// config.json, monté depuis WSL, porte la décision jusqu'à la compilation.
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
  const panneau = lire('vscodium-extension', 'szh-cockpit', 'media', 'settings.js');
  assert.ok(panneau.includes("cle: 'liensReferences'"), 'groupe absent du panneau des réglages');
  // Le filtre lit la même clé, dans le même fichier, et ne coupe que le Link — pas l'ancre.
  const lua = lire('pipeline', 'filters', 'szh-citations.lua');
  assert.match(lua, /cfg\.desactiverLiensReferences/, 'le filtre ne lit pas la clé de config.json');
  // `faire` (qui fabrique le Link) n'est plus posé ici même : depuis la flèche retour, savoir
  // si CETTE occurrence est la première de sa référence exige de voir tout le paragraphe —
  // seul id_ref voyage dans la plage, et c'est ce que la garde doit encore conditionner.
  assert.match(lua, /if not LIENS_DESACTIVES then\s*\n\s*plages\[#plages \+ 1\] = \{ s = ds, e = de, id_ref = cands\[1\]\.id/,
    'le filtre ne conditionne pas la pose de l’appel sur le réglage');
  // Une seule garde dans tout le fichier : la définition du drapeau, puis ce test — jamais
  // près de la pose du Div ancré (pandoc.Attr(f.id, …)), qui doit rester inconditionnelle.
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
  // Une image « hors numérotation » sans crédits n'est pas dans une <figure> : sans une
  // règle sur `img`, un fichier de 2000 px — la largeur que lib/qualite-image.js
  // conseille — déborderait de la page A4.
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
    // La longueur d'un segment tient sur 16 bits : un profil ICC volumineux est découpé en
    // plusieurs APP2, exactement comme le fait une chaîne d'imprimerie.
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
  // Le plafond des images est extrait dans lib/medias.js ; celui des photos reste dans
  // extension.js, avec la modale d'auteur·e qui est le seul dépôt de portrait.
  const medias = lire('vscodium-extension', 'szh-cockpit', 'lib', 'medias.js');
  const webview = lire('vscodium-extension', 'szh-cockpit', 'media', 'medias-article.js');
  const auteurs = lire('vscodium-extension', 'szh-cockpit', 'media', '_auteurs.js');
  const nombre = (re, texte) => {
    const m = re.exec(texte);
    assert.ok(m, 'valeur introuvable : ' + re);
    // « 50 * 1024 * 1024 » -> octets, sans eval.
    return m[1].split('*').map((x) => Number(x.trim())).reduce((a, b) => a * b, 1);
  };
  assert.strictEqual(nombre(/maxi: ([\d *]+),[^}]*'png', 'jpg', 'jpeg', 'gif'/, webview),
    nombre(/const TAILLE_MAX_IMAGE_IMPORT = ([\d *]+);/, medias),
    'plafond des images : la webview et l’hôte divergent');
  assert.strictEqual(nombre(/var TAILLE_MAX_PHOTO = ([\d *]+);/, auteurs),
    nombre(/const TAILLE_MAX_PHOTO = ([\d *]+);/, src),
    'plafond des portraits : la webview et l’hôte divergent');
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
  // Le DOI ne se saisit plus et l'import ne l'écrit plus : sans ce relais, le template
  // ($if(doi)$) n'imprimerait plus jamais de bandeau sur un nouvel article, pendant que
  // l'export OJS en déclarerait un. Le calcul vit dans le cockpit (lib/articles.js, un
  // seul rang) ; le pipeline ne fait que lire le fichier dérivé. Trois maillons, un nom :
  // s'ils divergent, le bandeau meurt en silence — d'où ce contrat.
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

test('les libellés de tâches attendus par le code existent dans tasks.json', () => {
  const labels = jsonc(lire('vscodium-user', 'tasks.json')).tasks.map((t) => t.label);
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  for (const m of src.matchAll(/^const NOM_TACHE_\w+ = '([^']+)';$/gm)) {
    assert.ok(labels.includes(m[1]), 'aucune tâche nommée « ' + m[1] + ' » dans tasks.json');
  }
});

test('chaque commande déclarée dans package.json est enregistrée dans le code', () => {
  const pkg = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const src = fs.readdirSync(path.join(COCKPIT, 'lib'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(COCKPIT, 'lib', f), 'utf8'))
    .concat([lire('vscodium-extension', 'szh-cockpit', 'extension.js')])
    .join('\n');
  for (const c of pkg.contributes.commands) {
    assert.ok(src.includes("'" + c.command + "'"),
      'commande déclarée mais jamais citée : ' + c.command);
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

// textesTable() (extension.js) traduit une liste de clés, et non des littéraux
// `nom: T(...)` que le contrôle des webviews sait lire. Une clé absente d'i18n n'échoue
// pas : T() la rend telle quelle, et l'éditeur de tableau affiche « table.x » — c'est
// arrivé avec table.alt.aide, demandée pendant des mois sans jamais être traduite.
test('chaque clé demandée par textesTable existe dans les traductions', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
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
    return new Set([...bloc.matchAll(/([A-Za-z][A-Za-z0-9]*)\s*:\s*T\(/g)].map((m) => m[1]));
  };
  // La fiche d'auteur·e est partagée par les trois vues : ses libellés viennent de
  // textesAuteur(), qu'Object.assign ajoute à chaque table.
  // Trois entrees de textesNumero() et textesArticles() ne sont pas des textes mais des
  // tables : `libelles` porte les intitules des champs indexes par cle i18n, `couleurs` la
  // palette du numero, `revues` le nom des deux revues. L'extraction ci-dessus ne voit que
  // les `nom: T(...)`, d'ou cette liste ; leur contenu est controle par
  // test/js/articles.test.js, qui compare la table de champs du fragment aux cles envoyees.
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
    // Les libellés des champs par type (typesConfig, typesRubrique) ne passent pas par
    // TXT.xxx — ils arrivent dans une table à part, comme `libelles` de textesNumero() plus
    // bas — d'où leur absence de cette liste, qui ne surveille que les TXT.xxx littéraux du
    // script. La page porte les DEUX familles depuis le 02.09.2026 (fiches et rubriques),
    // donc une seule fonction hôte pour les deux séries de libellés.
    'documentation': {
      libelles: cles('textesDocumentation'),
      fragments: ['_commun.js']
    },
    // Le formulaire du numero et la vue « Articles » partagent media/_numero.js : ses
    // libelles viennent de textesNumero(), qu'Object.assign ajoute a la table de la vue.
    'metadata-issue': {
      libelles: new Set([...cles('textesNumero'), ...TABLES]),
      fragments: ['_commun.js', '_numero.js']
    },
    'articles': {
      libelles: new Set([...cles('textesNumero'), ...cles('textesArticles'), ...TABLES]),
      fragments: ['_commun.js', '_numero.js']
    },
    // Le formulaire du livre réutilise le même fragment que celui du numéro (media/_numero.js,
    // moteur commun SZH.formulaireLivre/formulaireNumero) : les mêmes propriétés « table »
    // sont donc référencées sans condition dans son code, même si opts.couverture:false n'en
    // affiche aucune. textesLivre() les fournit via Object.assign(textesNumero(), …) plutôt
    // que par des appels T() littéraux, d'où le recours à cles('textesNumero') ici : c'est
    // exactement ce que la valeur de retour de textesLivre() contient.
    // ⚠ PAS de 'licences' ici, même si textesLivre() la fournit : le champ licence de
    // CHAMPS_LIVRE la lit en TXT[champ.optionsDe] (notation crochet, clé calculée), que la
    // regex ci-dessous (\bTXT\.(...)\b) ne voit jamais. Ajouter 'licences' à la liste ne
    // protégerait donc rien — un faux gardien est pire qu'aucun ; le test qui suit couvre
    // réellement ce mécanisme.
    'metadata-book': {
      libelles: new Set([...cles('textesNumero'), ...TABLES]),
      fragments: ['_commun.js', '_numero.js']
    }
  };
  for (const page of Object.keys(pages)) {
    const js = pages[page].fragments.concat([page + '.js'])
      .map((f) => fs.readFileSync(path.join(COCKPIT, 'media', f), 'utf8')).join('\n');
    for (const m of js.matchAll(/\bTXT\.([A-Za-z0-9_]+)/g)) {
      assert.ok(pages[page].libelles.has(m[1]),
        'libellé « ' + m[1] +' » utilisé par ' + page + ' mais absent de l’hôte');
    }
  }
});

// Le pendant du contrôle ci-dessus pour la notation crochet : un champ à options
// dynamiques (`optionsDe`, media/_numero.js) lit TXT[champ.optionsDe] au lieu de TXT.xxx, et
// la regex du contrôle précédent ne l'y verra jamais. Plutôt que de deviner une clé calculée
// à l'exécution — ce qu'une regex ne peut pas faire de façon fiable pour TXT[cle] ou
// TXT[prefixe + '...'], qui apparaissent ailleurs dans les webviews avec une clé qui varie
// par appel — ce contrôle prend le seul chemin qui reste vrai : chaque `optionsDe` déclaré
// dans la table doit être une clé que la fonction hôte fournit réellement, sur le même
// modèle que le contrôle « chaque intitulé de la table est fourni par l’hôte »
// (test/js/articles.test.js) pour `libelle`.
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

// Le tutoriel est déclaratif : ses titres et ses textes vivent dans les deux package.nls,
// ses dessins sur le disque, et ses liens pointent des commandes. Une clé oubliée
// s'affiche « %tuto.x% » dans la page d'accueil, un dessin absent laisse un cadre vide, et
// un lien mort ne fait rien — trois pannes muettes.
test('le tutoriel a ses libellés, ses dessins et des liens qui mènent quelque part', () => {
  const manifeste = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.json'));
  const nls = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.json'));
  const nlsDe = JSON.parse(lire('vscodium-extension', 'szh-cockpit', 'package.nls.de.json'));
  const tuto = (manifeste.contributes.walkthroughs || [])[0];
  assert.ok(tuto, 'aucun tutoriel déclaré');
  assert.ok(tuto.steps.length >= 8, 'tutoriel trop court : ' + tuto.steps.length + ' étapes');
  const commandes = new Set(manifeste.contributes.commands.map((c) => c.command));
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
    // Une étape qui ne se coche jamais reste éternellement « à faire ».
    assert.ok((etape.completionEvents || []).length > 0, 'étape sans condition de complétion : ' + etape.id);
  }
  assert.ok(commandes.has('szh.tutoriel'), 'aucune commande n’ouvre le tutoriel');
});

// Un formulaire qui écrit doit enregistrer tout seul : personne ne pense à cliquer un
// bouton avant de fermer un panneau, et le travail perdu ne se voit qu'après. Deux
// exceptions, explicites : les réglages écrivent à chaque changement de choix, et la vue
// d'ensemble n'a rien à saisir.
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

// Le socle visuel est posé page par page par l'hôte. Une page qui l'oublie perd tous ses
// jetons d'un coup : ses règles se réduisent à des valeurs vides, sans aucune erreur. Et un
// fragment mal nommé dans cssPartage ou jsPartage ne se voit qu'à l'ouverture du panneau,
// où le readFileSync de construireHtml lève.
test('chaque webview reçoit le socle visuel, et ses fragments existent', () => {
  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  const appels = [...src.matchAll(/construireHtml\('([a-z-]+)', nonce, \{([\s\S]{0,700}?)\}\);/g)];
  assert.strictEqual(appels.length, 11, 'appels à construireHtml : ' + appels.length);
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

// Les deux formulaires de métadonnées ont longtemps été deux copies. Ce qu'ils partagent
// vit désormais dans media/_fiches.{js,css} : ce contrôle empêche la copie de revenir.
test('les deux formulaires de métadonnées ne se recopient pas', () => {
  const lignes = (f) => fs.readFileSync(path.join(COCKPIT, 'media', f), 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('//'));
  const a = lignes('metadata-articles.js');
  const b = new Set(lignes('import-verif.js'));
  let suite = 0, pire = 0;
  for (const l of a) { suite = b.has(l) ? suite + 1 : 0; pire = Math.max(pire, suite); }
  assert.ok(pire < 10, 'bloc de ' + pire + ' lignes identiques : à remonter dans _fiches.js');
});

// Chaque webview décrit son protocole en tête de fichier. Une table qui ment est pire
// qu'une table absente : on vérifie qu'elle cite tous les messages échangés.
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

// Ouvrir un article depuis la vue d'ensemble Articles n'ouvre que le .md — décision du
// 25.08.2026 : de là, on vient lire ou corriger le texte, pas mettre en page. Trois
// maillons, vérifiés sur la source faute de pouvoir charger extension.js hors de
// l'éditeur : la vue passe l'option, l'enregistrement de la commande la transmet, et
// ouvrirArticle s'arrête au .md quand elle est posée. Les autres appelants (arbre,
// Contrôles, démarrage) ne la passent pas : comportement historique conservé.
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
  // 2. L'enregistrement de la commande transmet le second argument, sinon l'option se
  //    perdrait entre executeCommand et la fonction.
  assert.match(src,
    /cmd\('szh\.ouvrirArticle', \(slug, opts\) => ouvrirArticle\(fournisseur, slug, opts\)\)/,
    'szh.ouvrirArticle ne propage pas les options à ouvrirArticle');
  // 3. ouvrirArticle honore l'option : après l'ouverture du .md, avant le calcul
  //    d'obsolescence et la compilation.
  const fn = bloc('ouvrirArticle');
  const garde = fn.indexOf('opts.sansApercu');
  assert.notStrictEqual(garde, -1, 'ouvrirArticle ignore sansApercu');
  assert.ok(garde > fn.indexOf("executeCommand('vscode.open'"),
    'la garde sansApercu doit laisser le .md s’ouvrir en colonne 1');
  assert.ok(garde < fn.indexOf('obsolete') && garde < fn.indexOf('lancerBuild'),
    'la garde sansApercu doit précéder l’obsolescence et la compilation');
  // 4. Un seul chemin porte l'option : l'arbre, la vue Contrôles et le démarrage gardent
  //    le comportement historique (md + compilation + aperçu).
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
  // Décision de Robin (26.08.2026) : embrasser le numéro ferme l'article quitté. La
  // fermeture doit précéder le reveal ET la création du panneau — les deux chemins —
  // sinon la vue déjà ouverte garderait l'aperçu à côté.
  const fn = bloc('ouvrirVueArticles');
  const fermeture = fn.indexOf('fermerTousLesApercus()');
  assert.notStrictEqual(fermeture, -1,
    'ouvrirVueArticles ne ferme pas les aperçus : la colonne 2 resterait occupée');
  assert.ok(fermeture < fn.indexOf('.reveal(') && fermeture < fn.indexOf('createWebviewPanel'),
    'la fermeture doit précéder le reveal et la création du panneau');
  // Les rafraîchissements en tâche de fond (fin de compilation) passent par envoyerVue,
  // qui ne doit jamais fermer quoi que ce soit sous les yeux du rédacteur.
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
  // Identifiants relevés sur la sortie de pipeline/filters/szh-citations.lua : les deux
  // implémentations doivent tomber sur les mêmes, sinon un lien posé à la main pointerait
  // dans le vide.
  assert.deepStrictEqual(entrees.map((e) => e.id), [
    'ref-ebersold-2013', 'ref-ricoeur-1990', 'ref-van-2023',
    'ref-insieme-2024', 'ref-sen-2001', 'ref-sen-2001-b'
  ]);
  // La ligne d'URL seule est recollée à l'entrée précédente, pas comptée comme une entrée.
  assert.match(entrees[1].texte, /Seuil\. https:/);
});

// Les deux lexiques de titres de bibliographie étaient comparés ici, expression régulière
// contre expression régulière sur les deux textes source. Deux listes identiques ne disent
// rien de deux résultats identiques : le repli des accents divergeait juste à côté, sans
// qu'aucun contrôle bronche. La comparaison se fait désormais en exécutant les deux
// implémentations, dans test/js/ancrages.test.js.

test('citations : une suite d’entrée se reconnaît aux cas qui ont déjà cassé', () => {
  // Les cas qui faisaient recoller 100 références du corpus à la précédente. Le filtre Lua
  // répond-il pareil ? test/js/ancrages.test.js le lui demande, il ne le lit pas.
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
  // Le filtre de liage, lui, doit être appelé par les deux rendus.
  assert.strictEqual((mk.match(/--lua-filter="\$\(PIPELINE_DIR\)\/filters\/szh-citations\.lua"/g) || []).length, 2);
  assert.ok(!fs.existsSync(path.join(RACINE, 'pipeline', 'filters', 'szh-biblio.lua')));
  assert.ok(!fs.existsSync(path.join(RACINE, 'pipeline', 'csl')));
});

test('print.css : un appel de citation ne se lit pas comme un lien sortant', () => {
  const css = lire('pipeline', 'styles', 'print.css');
  assert.match(css, /a\[href\^="#"\]::after,\s*a\.szh-appel::after \{ content: none; \}/);
  assert.match(css, /\.szh-appel-orphelin \{[^}]*dotted/);
  // La marque des appels non liés ne doit vivre que dans l'aperçu.
  const lua = lire('pipeline', 'filters', 'szh-citations.lua');
  assert.match(lua, /SZH_APERCU/);
  assert.match(lire('pipeline', 'Makefile'), /SZH_APERCU=1 \$\(PANDOC\)/);
});

// Le dépôt Word suit le PROFIL, jamais un nom écrit en dur. Défaut trouvé en production le
// 01.09.2026 : sur un livre, le cockpit déposait et listait dans articles-word/ pendant que
// la chaîne ne regardait que chapitres-word/ (pipeline/Makefile WORD_DIR, surchargé par
// pipeline/profils/livre.mk). Le Word s'affichait « en attente » pour toujours, le bouton
// « Convertir » ne produisait rien, et RIEN ne le disait. lib/profil.js nommait pourtant
// correctement les deux dépôts depuis le début — il n'était simplement pas branché ici.
test('le dépôt Word vient du profil, et aucun nom n’est écrit en dur dans extension.js', () => {
  assert.strictEqual(profils.profilPour('revue').depot, 'articles-word');
  assert.strictEqual(profils.profilPour('livre').depot, 'chapitres-word');

  const src = lire('vscodium-extension', 'szh-cockpit', 'extension.js');
  // Le code seul : un nom de dossier cité dans un commentaire est légitime et documente.
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

  // Et le routage doit être réellement utilisé, pas seulement le littéral retiré.
  assert.ok(/profilCourant\(\)\.depot/.test(code),
    'aucun appel à profilCourant().depot : le routage du dépôt Word a disparu.');
});

// ---- Ce qui a tué le livre 2026-B399-VN_FALC, le 01.09.2026 ----------------------------
//
// Une seule image au format métafichier Windows (.emf) suffisait à faire tomber une
// compilation de dix minutes, et le seul message visible était « mv: cannot stat ». Trois
// défauts se tenaient l'un derrière l'autre ; les trois sont ici sous contrôle.

test('PDF : l’échec de la dernière tentative WeasyPrint ne passe plus pour un succès', () => {
  // La cascade de repli tentait pdf/ua-1, puis --pdf-tags, puis un PDF nu — et ce dernier
  // appel, lui, n'était pas testé. Quand il tombait, la recette continuait jusqu'au `mv`
  // du fichier temporaire, qui échouait sur un fichier jamais écrit. Le rédacteur lisait
  // « mv: cannot stat », qui ne nomme ni la cause ni le fichier fautif.
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
  // Le digest de succès s'arrête à vingt lignes. Une troncature qui ne se dit pas se lit
  // comme un journal complet — ici, vingt avertissements anodins masquaient l'exception.
  assert.match(livre, /ligne\(s\) de plus dans/,
    'le journal est tronqué à vingt lignes sans le dire');
});

test('métafichiers Windows : le filtre de substitution est dans les trois chaînes', () => {
  // Décidé avec Robin le 02.09.2026 : substituer, pas refuser. Une compilation qui
  // s'arrête ne dit pas OÙ est le trou ; un placeholder à la place de l'image le montre,
  // à sa place, et le document se compose jusqu'au bout.
  const mk = lire('pipeline', 'Makefile');
  const livre = lire('pipeline', 'profils', 'livre.mk');
  const nb = (src) => (src.match(/szh-metafichier\.lua/g) || []).length;
  assert.strictEqual(nb(mk), 2,
    'le filtre doit être dans les DEUX chaînes de la revue — le rendu ET l’aperçu : '
    + 'un aperçu qui tomberait sur une image native Word laisserait le rédacteur sans vue');
  assert.strictEqual(nb(livre), 1, 'le filtre a quitté la chaîne des chapitres');
  // La position n'est pas indifférente : voir l'en-tête du filtre. Après tabelle-inclure,
  // sans quoi les images des tableaux extraits ne sont pas encore là.
  for (const [nom, src] of [['Makefile', mk], ['livre.mk', livre]]) {
    assert.ok(src.indexOf('szh-tabelle-inclure.lua') < src.indexOf('szh-metafichier.lua'),
      nom + ' : szh-metafichier passe AVANT szh-tabelle-inclure, il ne verrait donc pas '
      + 'une image citée uniquement dans un tableau extrait');
    assert.ok(src.indexOf('szh-metafichier.lua') < src.indexOf('szh-grille.lua'),
      nom + ' : szh-metafichier passe après szh-grille, qui ne verrait plus l’image');
  }
  assert.ok(fs.existsSync(path.join(RACINE, 'pipeline', 'media', 'image-a-remplacer.svg')),
    'le placeholder a disparu du toolkit : le filtre se désactive alors de lui-même');
});

test('métafichiers Windows : les deux extensions se testent SANS alternation Lua', () => {
  // Le piège maison : les motifs Lua n'ont pas de « | ». '%.(emf|wmf)$' matcherait le
  // texte littéral « (emf|wmf) » et ne trouverait jamais rien — le filtre se tairait
  // toujours, comme szh-legende-avant.lua l'a fait pendant des mois (défaut A9).
  const lua = lire('pipeline', 'filters', 'szh-metafichier.lua');
  const table = /local EXTENSIONS = \{([^}]*)\}/.exec(lua);
  assert.ok(table, 'la table des extensions a disparu');
  assert.deepStrictEqual(
    table[1].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean).sort(),
    ['%.emf$', '%.wmf$'],
    'deux motifs simples et séparés, jamais une alternation');
  // Et la casse ne doit pas décider : Word écrit parfois .EMF.
  assert.match(lua, /cible:lower\(\)/,
    'la comparaison n’est plus insensible à la casse : un « .EMF » passerait au travers');
});

test('PDF/UA : la porte valide le PDF du LIVRE, pas une liste vide', () => {
  // Jusqu'au 02.09.2026 `verifier-ua` lisait $(PDFS), c'est-à-dire les PDF des articles :
  // dans un dossier de livre, où il n'y a pas d'articles/, elle sortait « Aucun PDF à
  // valider » et l'ouvrage n'était JAMAIS validé. Le commentaire de livre.mk affirmait
  // pourtant le contraire.
  const mk = lire('pipeline', 'Makefile');
  assert.match(mk, /^verifier-ua: \$\$\(PDFS_UA\)$/m,
    'la porte PDF/UA ne passe plus par PDFS_UA en seconde expansion — sans les deux « $ », '
    + 'la liste est figée à la valeur de la revue avant l’inclusion de livre.mk');
  assert.match(mk, /--flavour ua1 --format xml \$\(PDFS_UA\)/,
    'le validateur reçoit une autre liste que celle des prérequis');
  assert.match(lire('pipeline', 'profils', 'livre.mk'), /^PDFS_UA {4}:= \$\(LIVRE_PDF\)$/m,
    'le profil livre ne dit plus quel PDF valider : la porte retomberait sur une liste vide');
});

test('livre : un dossier de chapitre préfixé « _ » n’est pas imprimé, et il est annoncé', () => {
  const livre = lire('pipeline', 'profils', 'livre.mk');
  assert.match(livre, /TOUS_CHAPITRES := \$\(filter-out _%,/,
    'les pièces de travail redeviennent des chapitres : la page de titre du manuscrit '
    + 'd’origine se réimprimerait en dernier chapitre du livre');
  assert.match(livre, /\$\(foreach c,\$\(filter _%,\$\(DOSSIERS_CHAPITRES\)\)/,
    'un dossier écarté doit être ANNONCÉ — un chapitre qui disparaît en silence est pire '
    + 'qu’un chapitre en trop');
  // L'exclusion ne vaut que si la scission pose réellement ce préfixe.
  assert.match(lire('pipeline', 'livre-scinder.py'), /_scission-\{slug_original\}/,
    'livre-scinder.py ne préfixe plus sa pièce de rebut : l’exclusion ne protège plus rien');
});
