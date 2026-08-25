// Les blocs ::: posés par le panneau d'édition (Ctrl+Alt+W/H/Q) : sauts de ligne et
// remplacement.
//
//   node --test "test/js/*.test.js"
//
// Le défaut gardé ici est double. D'abord, enroberBloc collait le bloc à ses voisins :
// un « fenced div » pandoc doit commencer en colonne 0 et être séparé du paragraphe
// voisin par une ligne vide, sinon pandoc le lit comme du texte courant et le PDF
// affiche trois-points-deux-points en clair. Ensuite, réappliquer la commande dans un
// bloc existant IMBRIQUAIT un second bloc dans le premier — deux cadres l'un dans
// l'autre au rendu — au lieu de mettre à jour la classe et le titre. poserBloc porte
// maintenant les deux règles ; ces tests la prennent comme l'éditeur le ferait, en
// rejouant son remplacement de lignes entières sur un document en mémoire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { chargerAvecVscodeFactice } = require('./dom-minimal');

const RACINE = path.resolve(__dirname, '..', '..');
const COCKPIT = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
const fmt = chargerAvecVscodeFactice(path.join(COCKPIT, 'lib', 'formatting.js'));
const refs = require(path.join(COCKPIT, 'lib', 'references.js'));

// Rejoue ce que fait appliquerBlocClasse : poserBloc sur les lignes du document, puis le
// remplacement de la plage de lignes entières par le texte rendu. Rend le document
// obtenu et la position de curseur annoncée, pour enchaîner une seconde application.
function appliquer(doc, sel, classe, titre) {
  const lignes = String(doc).split('\n');
  const r = fmt.poserBloc(lignes, sel, classe, titre);
  const texte = lignes.slice(0, r.ligneDebut)
    .concat(r.texte.split('\n'), lignes.slice(r.ligneFin + 1)).join('\n');
  return { texte: texte, curseur: r.curseur };
}

// Curseur sans étendue : la forme la plus courante au clavier.
function curseur(ligne, col) {
  return { debutLigne: ligne, debutCol: col, finLigne: ligne, finCol: col };
}

// Compte les lignes ::: du document : deux par bloc, jamais plus — c'est l'imbrication
// qui en mettrait quatre.
function lignesDiv(texte) {
  return texte.split('\n').filter((l) => /^\s*:::/.test(l)).length;
}

// ---- Insertion : les lignes vides nécessaires, et seulement elles ----

test('insertion en milieu de ligne : la ligne est coupée, le bloc démarre en colonne 0', () => {
  const doc = 'Un début de phrase qui continue.';
  const de = doc.indexOf('qui');
  const { texte } = appliquer(doc,
    { debutLigne: 0, debutCol: de, finLigne: 0, finCol: de + 3 }, 'highlight', '');
  // Les restes de la ligne coupée sont gardés, débarrassés des espaces de coupe, et
  // séparés du bloc par une ligne vide de chaque côté.
  assert.strictEqual(texte,
    'Un début de phrase\n\n::: {.highlight}\nqui\n:::\n\ncontinue.');
});

test('insertion en tête de document : pas de ligne vide contre le bord', () => {
  const { texte, curseur: c } = appliquer('Premier paragraphe.', curseur(0, 0), 'question', '');
  assert.strictEqual(texte, '::: {.question}\n\n:::\n\nPremier paragraphe.');
  // Le curseur est posé sur la ligne de contenu vide : on y tape la question.
  assert.deepStrictEqual(c, { ligne: 1, colonne: 0 });
});

test('insertion collée à un paragraphe : la ligne vide manquante est ajoutée', () => {
  const { texte } = appliquer('Para\nmis en avant',
    { debutLigne: 1, debutCol: 0, finLigne: 1, finCol: 'mis en avant'.length }, 'highlight', '');
  assert.strictEqual(texte, 'Para\n\n::: {.highlight}\nmis en avant\n:::');
});

test('des lignes vides déjà là ne sont pas doublées', () => {
  const { texte } = appliquer('Para\n\ncible\n\nSuite',
    { debutLigne: 2, debutCol: 0, finLigne: 2, finCol: 5 }, 'highlight', '');
  assert.strictEqual(texte, 'Para\n\n::: {.highlight}\ncible\n:::\n\nSuite');
});

test('les lignes vides excédentaires sont réduites à une seule', () => {
  const { texte } = appliquer('Para\n\n\n\ncible\n\n\nSuite',
    { debutLigne: 4, debutCol: 0, finLigne: 4, finCol: 5 }, 'highlight', '');
  assert.strictEqual(texte, 'Para\n\n::: {.highlight}\ncible\n:::\n\nSuite');
});

test('insertion en fin de document : rien n’est ajouté sous le bloc', () => {
  const { texte } = appliquer('Para', curseur(0, 4), 'highlight', '');
  assert.strictEqual(texte, 'Para\n\n::: {.highlight}\n\n:::');
});

test('une sélection multiligne devient le contenu du bloc, d’un seul tenant', () => {
  const doc = 'Avant.\n\nDeux lignes\nà encadrer.\n\nAprès.';
  const { texte } = appliquer(doc,
    { debutLigne: 2, debutCol: 0, finLigne: 3, finCol: 'à encadrer.'.length }, 'question', '');
  assert.strictEqual(texte,
    'Avant.\n\n::: {.question}\nDeux lignes\nà encadrer.\n:::\n\nAprès.');
});

test('le titre du bloc important part dans data-titre, guillemets ôtés', () => {
  const { texte } = appliquer('cible',
    { debutLigne: 0, debutCol: 0, finLigne: 0, finCol: 5 }, 'important', 'Dire "non"');
  assert.strictEqual(texte, '::: {.important data-titre="Dire non"}\ncible\n:::');
});

// ---- Réapplication : mise à jour du markup, jamais d'imbrication ----

test('réappliquer la même classe dans le bloc ne change rien (idempotent)', () => {
  const doc = 'Para\n\n::: {.highlight}\ncible\n:::\n\nSuite';
  const { texte } = appliquer(doc, curseur(3, 2), 'highlight', '');
  assert.strictEqual(texte, doc);
  assert.strictEqual(lignesDiv(texte), 2, 'un seul bloc attendu');
});

test('deux frappes de suite via le curseur rendu ne font qu’un bloc', () => {
  // Le scénario d'acceptation : Ctrl+Alt+W deux fois sur le même texte. La première
  // frappe pose le bloc et met le curseur DANS le bloc ; la seconde retombe donc dans
  // le remplacement, pas dans une insertion sous le bloc.
  const un = appliquer('Para\n\ncible\n\nSuite',
    { debutLigne: 2, debutCol: 0, finLigne: 2, finCol: 5 }, 'important', 'Note');
  const deux = appliquer(un.texte, curseur(un.curseur.ligne, un.curseur.colonne), 'important', 'Note');
  assert.strictEqual(deux.texte, un.texte);
  assert.strictEqual(lignesDiv(deux.texte), 2, 'la seconde frappe a empilé un bloc');
});

test('appliquer une autre classe remplace le markup, le contenu reste', () => {
  const doc = 'Para\n\n::: {.important data-titre="Note"}\ncontenu sur deux\nlignes\n:::\n\nSuite';
  const { texte } = appliquer(doc, curseur(4, 3), 'highlight', '');
  assert.strictEqual(texte, 'Para\n\n::: {.highlight}\ncontenu sur deux\nlignes\n:::\n\nSuite');
});

test('le remplacement peut poser un titre sur un bloc qui n’en avait pas', () => {
  const doc = '::: {.highlight}\ncontenu\n:::';
  const { texte } = appliquer(doc, curseur(1, 0), 'important', 'Attention');
  assert.strictEqual(texte, '::: {.important data-titre="Attention"}\ncontenu\n:::');
});

test('le curseur sur l’ouverture ou la fermeture compte comme « dans le bloc »', () => {
  const doc = '::: {.question}\ncontenu\n:::';
  for (const ligne of [0, 2]) {
    const { texte } = appliquer(doc, curseur(ligne, 1), 'highlight', '');
    assert.strictEqual(texte, '::: {.highlight}\ncontenu\n:::', 'ligne ' + ligne);
  }
});

test('le remplacement normalise aussi les lignes vides autour du bloc', () => {
  // Un bloc collé à ses voisins — hérité d'une insertion d'avant la correction, ou d'un
  // collage — ressort séparé ; des vides accumulées ressortent réduites.
  const colle = 'Para\n::: {.important}\nx\n:::\nSuite';
  assert.strictEqual(appliquer(colle, curseur(2, 0), 'highlight', '').texte,
    'Para\n\n::: {.highlight}\nx\n:::\n\nSuite');
  const aere = 'Para\n\n\n::: {.important}\nx\n:::\n\n\n\nSuite';
  assert.strictEqual(appliquer(aere, curseur(4, 0), 'highlight', '').texte,
    'Para\n\n::: {.highlight}\nx\n:::\n\nSuite');
});

test('sous un bloc clos, on insère : le bloc du dessus n’est pas réécrit', () => {
  const doc = '::: {.important}\nx\n:::\n\nParagraphe.';
  const { texte } = appliquer(doc,
    { debutLigne: 4, debutCol: 0, finLigne: 4, finCol: 'Paragraphe.'.length }, 'highlight', '');
  assert.strictEqual(texte,
    '::: {.important}\nx\n:::\n\n::: {.highlight}\nParagraphe.\n:::');
});

test('dans un div étranger (.szh-tabelle), le bloc se pose après, la référence survit', () => {
  // Réécrire l'ouverture d'une référence de tableau perdrait son src= et le tableau
  // disparaîtrait du rendu sans un mot ; imbriquer casserait la résolution du filtre.
  // Ni l'un ni l'autre : le nouveau bloc, vide, se pose sous la fermeture.
  const doc = 'Para\n\n::: {.szh-tabelle src="tables/table-01.html"}\n:::\n\nSuite';
  const { texte } = appliquer(doc, curseur(2, 5), 'highlight', '');
  assert.strictEqual(texte,
    'Para\n\n::: {.szh-tabelle src="tables/table-01.html"}\n:::\n\n::: {.highlight}\n\n:::\n\nSuite');
});

test('un bloc jamais refermé n’est pas réécrit : on ne sait pas où il finit', () => {
  const doc = 'texte\n\n::: {.important}\ncontenu';
  const { texte } = appliquer(doc, curseur(3, 7), 'highlight', '');
  assert.ok(texte.indexOf('::: {.important}') !== -1,
    'l’ouverture d’un bloc non fermé a été réécrite');
});

// ---- Ce qui ne doit pas bouger autour ----

test('enroberBloc garde sa forme : extension.js et les anciens appels la réexportent', () => {
  assert.strictEqual(fmt.enroberBloc('t', 'highlight', ''), '::: {.highlight}\nt\n:::');
  assert.strictEqual(fmt.enroberBloc('t', 'important', 'Note'),
    '::: {.important data-titre="Note"}\nt\n:::');
});

test('blocReferenceTable et blocSautPage gardent leur contrat de lignes vides', () => {
  assert.strictEqual(fmt.blocReferenceTable('table-01.html', 'Para', ''),
    '\n\n::: {.szh-tabelle src="tables/table-01.html"}\n:::');
  assert.strictEqual(fmt.blocSautPage('', 'Suite'), '::: {.szh-saut}\n:::\n\n');
});

test('retirerTable retire toujours son bloc : la factorisation des regex n’a rien changé', () => {
  // Les regex d'ouverture et de fermeture vivent maintenant dans references.js et sont
  // partagées avec formatting.js : ce test garde le comportement du côté « retrait ».
  const doc = 'Para\n\n::: {.szh-tabelle src="tables/table-01.html"}\n:::\n\nSuite';
  const r = refs.retirerTable(doc, 'table-01.html');
  assert.strictEqual(r.n, 1);
  assert.strictEqual(r.texte, 'Para\n\nSuite');
});
