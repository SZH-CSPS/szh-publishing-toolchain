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

// ---- Slug : le miroir du Makefile ----

test('slug d’article : mêmes règles que le Makefile', () => {
  assert.strictEqual(slug.slugifierArticle('4_Titre'), '04-titre');
  assert.strictEqual(slug.slugifierArticle('10_Actualité et ressources'),
    '10-actualite-et-ressources');
  assert.ok(slug.slugifierArticle('9' + '_' + 'x'.repeat(80)).length <= 39,
    'la borne de 39 caractères du Makefile n’est pas tenue');
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
  const webview = lire('vscodium-extension', 'szh-cockpit', 'media', 'medias-article.js');
  // Le plafond des photos vit avec la modale d'auteur·e, qui est le seul dépôt de portrait.
  const auteurs = lire('vscodium-extension', 'szh-cockpit', 'media', '_auteurs.js');
  const nombre = (re, texte) => {
    const m = re.exec(texte);
    assert.ok(m, 'valeur introuvable : ' + re);
    // « 50 * 1024 * 1024 » -> octets, sans eval.
    return m[1].split('*').map((x) => Number(x.trim())).reduce((a, b) => a * b, 1);
  };
  assert.strictEqual(nombre(/maxi: ([\d *]+),[^}]*'png', 'jpg', 'jpeg', 'gif'/, webview),
    nombre(/const TAILLE_MAX_IMAGE_IMPORT = ([\d *]+);/, src),
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
    // Le formulaire du numero et la vue « Articles » partagent media/_numero.js : ses
    // libelles viennent de textesNumero(), qu'Object.assign ajoute a la table de la vue.
    'metadata-issue': {
      libelles: new Set([...cles('textesNumero'), ...TABLES]),
      fragments: ['_commun.js', '_numero.js']
    },
    'articles': {
      libelles: new Set([...cles('textesNumero'), ...cles('textesArticles'), ...TABLES]),
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
    'traduction', 'table-editor', 'articles'];
  const partages = {
    'metadata-articles': ['_fiches.js'], 'import-verif': ['_fiches.js'],
    'metadata-issue': ['_numero.js'], 'articles': ['_numero.js']
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
  assert.strictEqual(appels.length, 9, 'appels à construireHtml : ' + appels.length);
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
    'vue-ensemble': [],
    'metadata-issue': ['_numero.js'],
    'articles': ['_numero.js']
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
