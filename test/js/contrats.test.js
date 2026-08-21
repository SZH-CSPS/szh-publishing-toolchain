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
  const nombre = (re, texte) => {
    const m = re.exec(texte);
    assert.ok(m, 'valeur introuvable : ' + re);
    // « 50 * 1024 * 1024 » -> octets, sans eval.
    return m[1].split('*').map((x) => Number(x.trim())).reduce((a, b) => a * b, 1);
  };
  assert.strictEqual(nombre(/maxi: ([\d *]+),[^}]*'png', 'jpg', 'jpeg', 'gif'/, webview),
    nombre(/const TAILLE_MAX_IMAGE_IMPORT = ([\d *]+);/, src),
    'plafond des images : la webview et l’hôte divergent');
  assert.strictEqual(nombre(/maxi: ([\d *]+),[^}]*'png', 'jpg', 'jpeg', 'webp'/, webview),
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
  const communes = cles('textesCarteArticle');
  const pages = {
    'metadata-articles': {
      libelles: new Set([...communes, ...cles('htmlApercuMetadonnees')]),
      fragments: ['_commun.js', '_fiches.js']
    },
    'import-verif': {
      libelles: new Set([...communes, ...cles('htmlImportVerif')]),
      fragments: ['_commun.js', '_fiches.js']
    },
    'medias-article': { libelles: cles('textesMedias'), fragments: ['_commun.js'] }
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
    'medias-article': []
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

test('citations : le lexique des titres de bibliographie est le même que celui du filtre', () => {
  const js = require(path.join(COCKPIT, 'lib', 'citations.js'));
  const lua = lire('pipeline', 'filters', 'szh-citations.lua');
  const bloc = lua.match(/local TITRES_BIB = \{([\s\S]*?)\}/);
  assert.ok(bloc, 'TITRES_BIB introuvable dans szh-citations.lua');
  const duLua = (bloc[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)).sort();
  // Le lexique JS n'est pas exporté : on le relit dans la source, comme pour le Lua.
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'citations.js'), 'utf8');
  const blocJs = src.match(/const TITRES_BIB = \[([\s\S]*?)\]/);
  const duJs = (blocJs[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)).sort();
  assert.deepStrictEqual(duJs, duLua);
  assert.ok(js.estTitreBib('Literaturverzeichnis') && js.estTitreBib('Références bibliographiques'));
});

test('citations : une suite d’entrée se reconnaît à la même règle des deux côtés', () => {
  // Les trois cas qui faisaient recoller 100 références du corpus à la précédente.
  assert.strictEqual(cit.estContinuation('https://doi.org/10.1234/x'), true);
  assert.strictEqual(cit.estContinuation('mit Behinderungen nach Geschlecht, ohne année'), true);
  assert.strictEqual(cit.estContinuation('van der Aa, H. (2023). Un titre.'), false);
  assert.strictEqual(cit.estContinuation('Übereinkommen über die Rechte, vom 13. Dezember 2006'), false);
  assert.strictEqual(cit.estContinuation('*Bathelt, J. (2019). Adaptive behaviour.'), false);
  const lua = lire('pipeline', 'filters', 'szh-citations.lua');
  assert.match(lua, /c >= 97 and c <= 122/, 'le filtre doit tester la minuscule ASCII');
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
