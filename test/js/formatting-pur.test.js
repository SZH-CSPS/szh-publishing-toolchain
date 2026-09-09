// lib/formatting-pur.js : la part de lib/formatting.js qui ne référence pas `vscode`,
// extraite pour que lib/medias.js et lib/panneaux.js puissent la réutiliser sans tirer
// tout l'hôte avec elle. Ce fichier ne charge JAMAIS lib/formatting.js par la voie
// vscode-factice : le module doit se charger tel quel, hors de l'éditeur.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');

test('formatting-pur.js se charge sans require("vscode")', () => {
  // Un require('vscode') qui échouerait ferait tomber ce require tout entier : le simple
  // fait d'arriver ici, sans faux vscode posé par un harnais, prouve la pureté du module.
  delete require.cache[require.resolve(path.join(COCKPIT, 'lib', 'formatting-pur.js'))];
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  assert.ok(typeof pur.basculerEnrobage === 'function');
  assert.ok(typeof pur.poserBloc === 'function');
  assert.ok(typeof pur.nomMediaUnique === 'function');
  assert.ok(typeof pur.noteBasPage === 'function');
  assert.ok(Array.isArray(pur.PALETTE_MEF) && pur.PALETTE_MEF.length > 0);
  // La note de bas de page vit dans le groupe « Insérer », juste après la figure : c'est
  // là que szh.panneauEdition et le clic droit la montrent.
  const i = pur.PALETTE_MEF.findIndex((e) => e[1] === 'szh.fmt.noteBasPage');
  assert.notStrictEqual(i, -1, 'szh.fmt.noteBasPage absente de PALETTE_MEF');
  assert.strictEqual(pur.PALETTE_MEF[i - 1][1], 'szh.fmt.figure',
    'la note de bas de page ne suit plus « Insérer une figure »');
});

test('formatting.js réexporte les mêmes fonctions que formatting-pur.js (identité)', () => {
  const { chargerAvecVscodeFactice } = require('./dom-minimal');
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  const fmt = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'formatting.js'));
  // nomMediaUnique n'est pas de ceux-là : formatting.js ne l'a jamais exporté, seul
  // fmtFigure l'appelle en interne — pas un contrat de réexport à garder.
  for (const nom of ['basculerEnrobage', 'basculerSouligne', 'basculerTitre', 'basculerCitation',
    'enroberBloc', 'poserBloc', 'blocAutour', 'squeletteTableau', 'tableauVierge',
    'blocReferenceTable', 'blocSautPage', 'noteBasPage', 'nomTableLibre', 'PALETTE_MEF',
    'CLASSES_BLOCS']) {
    assert.strictEqual(fmt[nom], pur[nom], nom + ' n’est pas la même référence des deux côtés');
  }
});

test('attrBloc échappe l’antislash avant le guillemet (comme citerValeur de references.js)', () => {
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  assert.strictEqual(pur.attrBloc('important', 'Dire "non"'),
    '{.important data-titre="Dire \\"non\\""}');
  // Le cas qui distingue échapper de retirer : un antislash suivi d'un guillemet doit
  // rester lisible sans avaler le guillemet fermant de l'attribut.
  assert.strictEqual(pur.attrBloc('important', 'chemin\\ "cité"'),
    '{.important data-titre="chemin\\\\ \\"cité\\""}');
  assert.strictEqual(pur.attrBloc('important', ''), '{.important}');
});

// Les trois boucles while (fs.existsSync(...)) qui cherchent un nom libre reçoivent une
// borne : sans elle, un dossier pathologique (ou un appelant qui boucle par erreur) tourne
// pour toujours au lieu d'échouer proprement.
test('nomMediaUnique (formatting-pur) refuse de boucler sans fin : borne à 1000, erreur claire', () => {
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nom-media-'));
  fs.writeFileSync(path.join(dossier, 'a.png'), '');
  for (let i = 1; i <= 1000; i++) { fs.writeFileSync(path.join(dossier, 'a-' + i + '.png'), ''); }
  assert.throws(() => pur.nomMediaUnique(dossier, 'a.png'), /1000/,
    'aucune erreur au-delà de 1000 essais : la boucle n’est pas bornée');
});

test('medias.js (nomMediaLibre) est désormais nomMediaUnique de formatting-pur, même borne', () => {
  const medias = require(path.join(COCKPIT, 'lib', 'medias.js'));
  const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));
  assert.strictEqual(medias.nomMediaLibre, pur.nomMediaUnique,
    'medias.js garde une copie au lieu de réutiliser formatting-pur.js');
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nom-media-2-'));
  fs.writeFileSync(path.join(dossier, 'a.png'), '');
  for (let i = 1; i <= 1000; i++) { fs.writeFileSync(path.join(dossier, 'a-' + i + '.png'), ''); }
  assert.throws(() => medias.nomMediaLibre(dossier, 'a.png'), /1000/);
});

test('reserve.js (nomLibre) reçoit la même borne, à 1000 essais', () => {
  const reserve = require(path.join(COCKPIT, 'lib', 'reserve.js'));
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-nom-reserve-'));
  fs.writeFileSync(path.join(dossier, 'a.jpg'), '');
  for (let i = 1; i <= 1000; i++) { fs.writeFileSync(path.join(dossier, 'a-' + i + '.jpg'), ''); }
  assert.throws(() => reserve.nomLibre(dossier, 'a.jpg'), /1000/,
    'aucune erreur au-delà de 1000 essais : la boucle n’est pas bornée');
});

test('panneaux.js importe PALETTE_MEF de formatting-pur.js, pas de formatting.js', () => {
  const src = fs.readFileSync(path.join(COCKPIT, 'lib', 'panneaux.js'), 'utf8');
  assert.match(src, /require\(['"]\.\/formatting-pur['"]\)/,
    'panneaux.js ne charge plus formatting-pur.js pour sa palette');
});

// ---- noteBasPage : l'appel [^n] au curseur, sa définition en fin de document ----
//
// Note en référence, jamais la note inline ^[…] — voir le commentaire de noteBasPage
// (lib/formatting-pur.js) pour les deux raisons (forme rendue par l'import Word, lisibilité
// du paragraphe). Ces tests rejouent ce que fait fmtNoteBasPage : la fonction pure calcule
// une plage de lignes à remplacer, appliquer() (ci-dessous) rejoue ce remplacement sur un
// document en mémoire, comme test/js/formatting.test.js le fait déjà pour poserBloc.

const pur = require(path.join(COCKPIT, 'lib', 'formatting-pur.js'));

// Curseur sans étendue : la forme la plus courante au clavier.
function curseurNote(ligne, col) {
  return { debutLigne: ligne, debutCol: col, finLigne: ligne, finCol: col };
}

// Rejoue noteBasPage sur un document en mémoire, comme editeur.edit(b => b.replace(...))
// le ferait : remplace [ligneDebut, ligneFin] par le texte rendu, rend le document entier
// et la position de curseur annoncée.
function appliquerNote(doc, sel) {
  const lignes = String(doc).split('\n');
  const r = pur.noteBasPage(lignes, sel);
  const texte = lignes.slice(0, r.ligneDebut)
    .concat(r.texte.split('\n'), lignes.slice(r.ligneFin + 1)).join('\n');
  return { texte: texte, curseur: r.curseur };
}

test('document vierge : l’appel devient [^1], la définition suit après une ligne vide', () => {
  const { texte, curseur } = appliquerNote('', curseurNote(0, 0));
  assert.strictEqual(texte, '[^1]\n\n[^1]: ');
  // Le curseur est en fin de la ligne de définition : c'est là qu'on tape la note.
  assert.deepStrictEqual(curseur, { ligne: 2, colonne: '[^1]: '.length });
});

test('[^1] et [^2] déjà présents : le nouvel appel prend [^3]', () => {
  const doc = 'Un texte[^1] avec renvoi.\n\n[^1]: Première note.\n\n' +
    'Un second[^2] renvoi.\n\n[^2]: Seconde note.';
  const { texte } = appliquerNote(doc, curseurNote(4, 'Un second[^2] renvoi.'.length));
  assert.ok(texte.indexOf('renvoi.[^3]') !== -1, 'l’appel [^3] n’a pas été posé au curseur');
  assert.ok(texte.endsWith('\n\n[^3]: '), 'la définition [^3] ne clôt pas le document');
});

test('[^1] et [^3] présents, pas [^2] : le trou est comblé avant d’aller plus loin', () => {
  const doc = 'Un premier renvoi[^1].\n\nUne phrase encore sans renvoi.\n\n' +
    '[^1]: Première note.\n\n[^3]: Troisième note, déjà là.';
  const { texte } = appliquerNote(doc, curseurNote(2, 'Une phrase encore sans renvoi.'.length));
  assert.ok(texte.indexOf('renvoi.[^2]') !== -1, 'le numéro 2, pourtant libre, n’a pas été choisi');
  assert.ok(texte.endsWith('\n\n[^2]: '), 'la définition [^2] ne clôt pas le document');
});

test('la dernière ligne du document n’est pas vide : une ligne vide est ajoutée avant la définition', () => {
  const { texte } = appliquerNote('Dernière phrase.', curseurNote(0, 'Dernière phrase.'.length));
  assert.strictEqual(texte, 'Dernière phrase.[^1]\n\n[^1]: ');
});

test('le document finit déjà par une ligne vide : aucune n’est ajoutée en trop', () => {
  const { texte } = appliquerNote('Para\n\ncible\n', curseurNote(2, 'cible'.length));
  // « cible\n » se découpe en lignes ['Para', '', 'cible', ''] : la dernière est déjà vide.
  assert.strictEqual(texte, 'Para\n\ncible[^1]\n\n[^1]: ');
});

test('une étiquette non numérique ([^note-a]) ne fausse pas le calcul du premier numéro libre', () => {
  const doc = 'Un renvoi nommé[^note-a] et un autre[^1].\n\n' +
    '[^note-a]: Note nommée.\n\n[^1]: Première note.';
  const { texte } = appliquerNote(doc, curseurNote(0, 'Un renvoi nommé[^note-a] et un autre[^1].'.length));
  // [^note-a] existe déjà et [^1] aussi : le premier numéro libre est 2, pas 3.
  assert.ok(texte.indexOf('.[^2]') !== -1, 'le calcul a compté [^note-a] comme un numéro');
  assert.ok(texte.indexOf('[^2]: ') !== -1);
});

test('sélection vide : l’appel se pose exactement au curseur', () => {
  const { texte } = appliquerNote('Avant curseur ici après.', curseurNote(0, 'Avant curseur ici'.length));
  assert.strictEqual(texte, 'Avant curseur ici[^1] après.\n\n[^1]: ');
});

test('sélection non vide : l’appel suit la sélection, le corps n’est ni déplacé ni amputé', () => {
  const doc = 'Une phrase avec un mot important à noter.';
  const debut = doc.indexOf('important');
  const fin = debut + 'important'.length;
  const { texte } = appliquerNote(doc, { debutLigne: 0, debutCol: debut, finLigne: 0, finCol: fin });
  // Le mot sélectionné reste intact et à sa place ; l'appel se pose juste après lui, la
  // suite de la phrase n'est ni coupée ni déplacée.
  assert.strictEqual(texte, 'Une phrase avec un mot important[^1] à noter.\n\n[^1]: ');
  assert.ok(texte.indexOf('important[^1]') !== -1);
  assert.ok(texte.indexOf('à noter.') !== -1, 'la fin de la phrase a disparu');
});

test('sélection non vide sur plusieurs lignes : les lignes qui suivent restent intactes', () => {
  const doc = 'Premier paragraphe avec un passage à citer\nsur deux lignes.\n\nDeuxième paragraphe.';
  const debut = doc.indexOf('passage');
  const finLigne0 = 'Premier paragraphe avec un passage à citer'.length;
  const { texte } = appliquerNote(doc, { debutLigne: 0, debutCol: debut, finLigne: 0, finCol: finLigne0 });
  assert.strictEqual(texte,
    'Premier paragraphe avec un passage à citer[^1]\nsur deux lignes.\n\nDeuxième paragraphe.\n\n[^1]: ');
  // Rien du corps n'a bougé : les deux lignes suivantes et le second paragraphe survivent
  // mot pour mot.
  assert.ok(texte.indexOf('sur deux lignes.') !== -1);
  assert.ok(texte.indexOf('Deuxième paragraphe.') !== -1);
});
