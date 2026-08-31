// lib/medias.js : ce que l'extraction hors d'extension.js rend enfin testable seul —
// dimensions d'image lues dans les en-têtes, noms de fichiers sûrs, versions d'un
// portrait, et détection des doublons dans media/. Aucune de ces fonctions ne dépendait
// de vscode ni de l'état du module hôte ; avant l'extraction, seul un hôte activé de bout
// en bout (test/js/hote.test.js) ou une webview rendue (test/js/webviews.test.js) les
// exerçait, et jamais sur leurs cas limites.
//
//   node --test "test/js/*.test.js"
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const medias = require(path.join(COCKPIT, 'lib', 'medias.js'));

// ---- Dimensions lues dans les en-têtes ---------------------------------------------

test('dimensions : PNG, lues dans IHDR', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const buf = Buffer.alloc(24);
    buf.writeUInt32BE(0x89504e47, 0);   // signature PNG
    buf.write('IHDR', 12, 'latin1');
    buf.writeUInt32BE(640, 16);         // largeur
    buf.writeUInt32BE(480, 20);         // hauteur
    const f = path.join(dossier, 'x.png');
    fs.writeFileSync(f, buf);
    assert.deepStrictEqual(medias.lireDimensionsImage(f), { largeur: 640, hauteur: 480 });
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('dimensions : GIF89a', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const buf = Buffer.alloc(10);
    buf.write('GIF89a', 0, 'latin1');
    buf.writeUInt16LE(100, 6);   // largeur
    buf.writeUInt16LE(50, 8);    // hauteur
    const f = path.join(dossier, 'x.gif');
    fs.writeFileSync(f, buf);
    assert.deepStrictEqual(medias.lireDimensionsImage(f), { largeur: 100, hauteur: 50 });
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('dimensions : JPEG, le marqueur SOF0 est retrouvé', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const buf = Buffer.alloc(14);
    buf[0] = 0xff; buf[1] = 0xd8;               // SOI
    buf[2] = 0xff; buf[3] = 0xc0;               // SOF0
    buf.writeUInt16BE(8, 4);                    // Lf (valeur non contrôlée)
    buf[6] = 8;                                 // précision
    buf.writeUInt16BE(200, 7);                  // hauteur (Y)
    buf.writeUInt16BE(400, 9);                  // largeur (X)
    buf[11] = 3;                                // Nf
    buf[12] = 0xff; buf[13] = 0xd9;             // EOI
    const f = path.join(dossier, 'x.jpg');
    fs.writeFileSync(f, buf);
    assert.deepStrictEqual(medias.lireDimensionsImage(f), { largeur: 400, hauteur: 200 });
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('dimensions : WEBP, les trois formes de bloc (VP8X, VP8L, VP8)', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const riff = (bloc, remplir) => {
      const buf = Buffer.alloc(30);
      buf.write('RIFF', 0, 'latin1');
      buf.write('WEBP', 8, 'latin1');
      buf.write(bloc, 12, 'latin1');
      remplir(buf);
      return buf;
    };
    const vp8x = riff('VP8X', (buf) => {
      buf.writeUIntLE(799, 24, 3);   // largeur - 1
      buf.writeUIntLE(599, 27, 3);   // hauteur - 1
    });
    const vp8l = riff('VP8L', (buf) => {
      const bits = (1199 & 0x3fff) | ((799 & 0x3fff) << 14);
      buf.writeUInt32LE(bits, 21);
    });
    const vp8 = riff('VP8 ', (buf) => {
      buf[23] = 0x9d; buf[24] = 0x01; buf[25] = 0x2a;   // code de démarrage VP8
      buf.writeUInt16LE(320, 26);
      buf.writeUInt16LE(240, 28);
    });
    const cas = [
      [vp8x, { largeur: 800, hauteur: 600 }],
      [vp8l, { largeur: 1200, hauteur: 800 }],
      [vp8, { largeur: 320, hauteur: 240 }]
    ];
    let i = 0;
    for (const [buf, attendu] of cas) {
      const f = path.join(dossier, 'x' + (i++) + '.webp');
      fs.writeFileSync(f, buf);
      assert.deepStrictEqual(medias.lireDimensionsImage(f), attendu);
    }
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('dimensions : SVG, via les attributs puis via viewBox', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const f1 = path.join(dossier, 'a.svg');
    fs.writeFileSync(f1, '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect/></svg>');
    assert.deepStrictEqual(medias.lireDimensionsImage(f1), { largeur: 120, hauteur: 80 });
    const f2 = path.join(dossier, 'b.svg');
    fs.writeFileSync(f2, '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150"><rect/></svg>');
    assert.deepStrictEqual(medias.lireDimensionsImage(f2), { largeur: 300, hauteur: 150 });
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('dimensions : fichier absent ou illisible -> null, jamais d’exception', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    assert.strictEqual(medias.lireDimensionsImage(path.join(dossier, 'absent.png')), null);
    const f = path.join(dossier, 'brouille.jpg');
    fs.writeFileSync(f, 'ceci n’est pas une image');
    assert.strictEqual(medias.lireDimensionsImage(f), null);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

// ---- Description « L × H · poids » -------------------------------------------------

test('decrireImage : dimensions et poids, en Ko puis en Mo avec virgule française', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const buf = Buffer.alloc(2000);
    buf.writeUInt32BE(0x89504e47, 0);
    buf.write('IHDR', 12, 'latin1');
    buf.writeUInt32BE(10, 16);
    buf.writeUInt32BE(20, 20);
    const f = path.join(dossier, 'x.png');
    fs.writeFileSync(f, buf);
    assert.strictEqual(medias.decrireImage(f), '10 × 20 · 2 Ko');

    const gros = path.join(dossier, 'gros.bin');
    fs.writeFileSync(gros, Buffer.alloc(1572864));   // 1,5 Mo, dimensions illisibles
    assert.strictEqual(medias.decrireImage(gros), '1,5 Mo');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('decrireImage : fichier absent -> chaîne vide', () => {
  assert.strictEqual(medias.decrireImage(path.join(os.tmpdir(), 'szh-medias-absent-xyz.png')), '');
});

// ---- Format logique -----------------------------------------------------------------

test('formatImage : jpg et jpeg sont le même format', () => {
  assert.strictEqual(medias.formatImage('photo.JPEG'), 'jpg');
  assert.strictEqual(medias.formatImage('photo.jpg'), 'jpg');
  assert.strictEqual(medias.formatImage('photo.PNG'), 'png');
});

// ---- Noms de fichiers sûrs ----------------------------------------------------------

test('nomImageAssaini : accents, espaces et parenthèses passent par slugifier', () => {
  assert.strictEqual(medias.nomImageAssaini("Fête d'été (1).PNG"), 'fete-d-ete-1.png');
});

test('nomImageAssaini : seul le dernier segment du chemin survit, jpeg devient jpg', () => {
  assert.strictEqual(
    medias.nomImageAssaini('C:\\Users\\x\\Mon Dossier\\image test.jpeg'), 'image-test.jpg');
});

test('nomImageAssaini : une extension hors liste est refusée', () => {
  assert.strictEqual(medias.nomImageAssaini('document.pdf'), null);
  assert.strictEqual(medias.nomImageAssaini('sans-extension'), null);
});

test('nomMediaLibre : ajoute un suffixe numérique tant que le nom est pris', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    assert.strictEqual(medias.nomMediaLibre(dossier, 'a.png'), 'a.png');
    fs.writeFileSync(path.join(dossier, 'a.png'), '');
    assert.strictEqual(medias.nomMediaLibre(dossier, 'a.png'), 'a-1.png');
    fs.writeFileSync(path.join(dossier, 'a-1.png'), '');
    assert.strictEqual(medias.nomMediaLibre(dossier, 'a.png'), 'a-2.png');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('relatifImageValide : segments sûrs et extension d’image, rien d’autre', () => {
  for (const bon of ['photo.png', 'sous-dossier/photo.JPG', 'a.gif', 'a.svg']) {
    assert.strictEqual(medias.relatifImageValide(bon), true, bon);
  }
  const mauvais = [
    '', undefined, null, '../x.png', 'a/../b.png', 'a/./b.png', 'a//b.png',
    'C:\\x.png', '~$temp.png', 'photo.pdf', 'photo', 'a\r\nb.png', 'x'.repeat(301) + '.png'
  ];
  for (const m of mauvais) {
    assert.strictEqual(medias.relatifImageValide(m), false, String(m));
  }
});

// ---- Photos d'auteur·e·s -------------------------------------------------------------

test('assainirCheminPhoto : un seul segment sous portraits/, sans remontée', () => {
  assert.strictEqual(medias.assainirCheminPhoto('portraits/anne.sans-fond.png'),
    'portraits/anne.sans-fond.png');
  for (const mauvais of ['', 'autre/x.png', 'portraits/../x.png', 'portraits\\x.png',
    'portraits/', 'portraits/..', 'x'.repeat(301)]) {
    assert.strictEqual(medias.assainirCheminPhoto(mauvais), '', mauvais);
  }
});

test('decomposerPhoto : une base, trois suffixes reconnus', () => {
  assert.deepStrictEqual(medias.decomposerPhoto('portraits/anne.original.jpg'),
    { base: 'anne', version: 'original' });
  assert.deepStrictEqual(medias.decomposerPhoto('anne.avec-fond.png'),
    { base: 'anne', version: 'avec-fond' });
  assert.deepStrictEqual(medias.decomposerPhoto('anne.sans-fond.png'),
    { base: 'anne', version: 'sans-fond' });
  assert.strictEqual(medias.decomposerPhoto('anne.png'), null);
  assert.strictEqual(medias.decomposerPhoto(''), null);
});

test('baseAuteurValide : alphabet sûr, premier caractère alphanumérique', () => {
  for (const bon of ['anne-dupont', 'a.b_c-3', 'X9']) {
    assert.strictEqual(medias.baseAuteurValide(bon), true, bon);
  }
  for (const mauvais of ['', '-anne', '.anne', '../x', 'a/b', 'a b']) {
    assert.strictEqual(medias.baseAuteurValide(mauvais), false, mauvais);
  }
});

test('dataUriImage : base64 du fichier, mime selon l’extension, null si illisible', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const contenu = Buffer.from([1, 2, 3, 4, 5]);
    const f = path.join(dossier, 'x.png');
    fs.writeFileSync(f, contenu);
    assert.strictEqual(medias.dataUriImage(f), 'data:image/png;base64,' + contenu.toString('base64'));
    const jpg = path.join(dossier, 'y.jpg');
    fs.writeFileSync(jpg, contenu);
    assert.strictEqual(medias.dataUriImage(jpg), 'data:image/jpeg;base64,' + contenu.toString('base64'));
    // Extension inconnue : repli sur image/png plutôt qu'une exception.
    const bmp = path.join(dossier, 'z.bmp');
    fs.writeFileSync(bmp, contenu);
    assert.strictEqual(medias.dataUriImage(bmp), 'data:image/png;base64,' + contenu.toString('base64'));
    assert.strictEqual(medias.dataUriImage(path.join(dossier, 'absent.png')), null);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('trouverOriginal : trouve le fichier .original.<ext>, ignore un dépôt temporaire', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    assert.strictEqual(medias.trouverOriginal(dossier, 'anne'), null);
    fs.writeFileSync(path.join(dossier, '~$anne.original.jpg'), 'en cours de dépôt');
    assert.strictEqual(medias.trouverOriginal(dossier, 'anne'), null,
      'un fichier temporaire ~$ ne doit pas être pris pour l’original');
    fs.writeFileSync(path.join(dossier, 'anne.original.jpg'), 'photo');
    assert.strictEqual(medias.trouverOriginal(dossier, 'anne'), 'anne.original.jpg');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('versionsPhoto : les trois versions en data: URI, absentes -> null chacune', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    assert.deepStrictEqual(medias.versionsPhoto(dossier, 'anne'),
      { original: null, avecFond: null, sansFond: null });
    fs.writeFileSync(path.join(dossier, 'anne.original.jpg'), Buffer.from([1]));
    fs.writeFileSync(path.join(dossier, 'anne.avec-fond.png'), Buffer.from([2]));
    fs.writeFileSync(path.join(dossier, 'anne.sans-fond.png'), Buffer.from([3]));
    const v = medias.versionsPhoto(dossier, 'anne');
    assert.strictEqual(v.original, medias.dataUriImage(path.join(dossier, 'anne.original.jpg')));
    assert.strictEqual(v.avecFond, medias.dataUriImage(path.join(dossier, 'anne.avec-fond.png')));
    assert.strictEqual(v.sansFond, medias.dataUriImage(path.join(dossier, 'anne.sans-fond.png')));
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

// ---- Aperçu sous budget --------------------------------------------------------------

test('apercuMedia : décrémente le budget partagé, refuse sans le consommer si trop juste', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const contenu = Buffer.alloc(100);
    const f = path.join(dossier, 'x.gif');
    fs.writeFileSync(f, contenu);
    const budget = { reste: 150 };
    assert.strictEqual(medias.apercuMedia(f, budget), 'data:image/gif;base64,' + contenu.toString('base64'));
    assert.strictEqual(budget.reste, 50);

    const f2 = path.join(dossier, 'y.gif');
    fs.writeFileSync(f2, Buffer.alloc(100));
    assert.strictEqual(medias.apercuMedia(f2, budget), null, 'budget épuisé : pas d’aperçu');
    assert.strictEqual(budget.reste, 50, 'un refus ne doit pas décrémenter le budget');
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('apercuMedia : sans budget, et extension non reconnue -> null', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    const f = path.join(dossier, 'x.gif');
    fs.writeFileSync(f, Buffer.from([9, 9]));
    assert.match(medias.apercuMedia(f), /^data:image\/gif;base64,/);
    const inconnu = path.join(dossier, 'x.tiff');
    fs.writeFileSync(inconnu, Buffer.from([9, 9]));
    assert.strictEqual(medias.apercuMedia(inconnu), null);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

// ---- Doublons dans media/ -------------------------------------------------------------

test('empreintesPartagees : ne calcule le hachage que pour les tailles partagées par au moins deux fichiers', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-medias-'));
  try {
    fs.writeFileSync(path.join(dossier, 'a.png'), Buffer.alloc(10, 1));   // même contenu
    fs.writeFileSync(path.join(dossier, 'b.png'), Buffer.alloc(10, 1));   // que a.png
    fs.writeFileSync(path.join(dossier, 'c.png'), Buffer.alloc(10, 2));   // même taille, autre contenu
    fs.writeFileSync(path.join(dossier, 'd.png'), Buffer.alloc(20, 3));   // taille unique
    const empreintes = medias.empreintesPartagees(dossier, ['a.png', 'b.png', 'c.png', 'd.png']);
    // a et b partagent leur taille ET leur contenu : même empreinte, donc doublons.
    assert.strictEqual(empreintes.get('a.png'), empreintes.get('b.png'));
    // c partage la taille de a/b mais pas le contenu : présent, mais une empreinte différente.
    assert.ok(empreintes.has('c.png'));
    assert.notStrictEqual(empreintes.get('c.png'), empreintes.get('a.png'));
    // d est seul à sa taille : jamais haché, absent de la table.
    assert.strictEqual(empreintes.has('d.png'), false);
  } finally { fs.rmSync(dossier, { recursive: true, force: true }); }
});

test('empreinteFichier et tailleFichier : -1 et null sur un fichier absent, jamais d’exception', () => {
  const absent = path.join(os.tmpdir(), 'szh-medias-absent-xyz.png');
  assert.strictEqual(medias.tailleFichier(absent), -1);
  assert.strictEqual(medias.empreinteFichier(absent), null);
});

// ---- Contrat du module ----------------------------------------------------------------

test('medias.js : les constantes de plafond attendues par extension.js sont exportées', () => {
  assert.ok(Array.isArray(medias.EXTENSIONS_IMAGE_IMPORT) && medias.EXTENSIONS_IMAGE_IMPORT.length > 0);
  assert.ok(medias.TAILLE_MAX_IMAGE_IMPORT > 0);
  assert.ok(medias.BUDGET_APERCUS_MEDIA > 0);
});
