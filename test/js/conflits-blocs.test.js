// Tests des fonctions de résolution de blocs en conflit.
//
// Chaque scénario teste un aspect différent : remplacement, insertion, suppression,
// combinaisons de blocs, symétrie, fins de ligne, etc.
//
// Exécution : depuis la racine du dépôt,
//   node --test test/js/conflits-blocs.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  decouperLignes, assemblerLignes, inverserBloc, appliquerBlocs, copieConflitPour
} = require(
  path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'copies-conflit.js')
);

// ---- appliquerBlocs : scénarios de base ----

test('un bloc remplacé', () => {
  const original = 'a\nb\nc\n';
  const modifie = 'a\nB\nc\n';
  const bloc = { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 };
  const resultat = appliquerBlocs(original, modifie, [bloc]);
  assert.strictEqual(resultat, 'a\nB\nc\n', 'bloc remplacé : résultat incorrect');
});

test('une insertion', () => {
  const original = 'a\nb\n';
  const modifie = 'a\nb\nc\n';
  const bloc = { originalStartLineNumber: 2, originalEndLineNumber: 0, modifiedStartLineNumber: 3, modifiedEndLineNumber: 3 };
  const resultat = appliquerBlocs(original, modifie, [bloc]);
  assert.strictEqual(resultat, 'a\nb\nc\n', 'insertion : résultat incorrect');
});

test('une suppression', () => {
  const original = 'a\nb\nc\n';
  const modifie = 'a\nc\n';
  const bloc = { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 1, modifiedEndLineNumber: 0 };
  const resultat = appliquerBlocs(original, modifie, [bloc]);
  assert.strictEqual(resultat, 'a\nc\n', 'suppression : résultat incorrect');
});

test('deux blocs d\'un seul coup', () => {
  const original = 'a\nb\nc\nd\n';
  const modifie = 'A\nb\nc\nD\n';
  const blocs = [
    { originalStartLineNumber: 1, originalEndLineNumber: 1, modifiedStartLineNumber: 1, modifiedEndLineNumber: 1 },
    { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 4 }
  ];
  const resultat = appliquerBlocs(original, modifie, blocs);
  assert.strictEqual(resultat, 'A\nb\nc\nD\n', 'deux blocs : résultat incorrect');
});

test('un seul bloc parmi deux', () => {
  const original = 'a\nb\nc\nd\n';
  const modifie = 'A\nb\nc\nD\n';
  const blocs = [
    { originalStartLineNumber: 4, originalEndLineNumber: 4, modifiedStartLineNumber: 4, modifiedEndLineNumber: 4 }
  ];
  const resultat = appliquerBlocs(original, modifie, blocs);
  assert.strictEqual(resultat, 'a\nb\nc\nD\n', 'un seul bloc : résultat incorrect');
});

// ---- appliquerBlocs : insertion en fin de fichier (deux cas) ----

test('une insertion en toute fin de fichier : cas 1 (remplacement)', () => {
  const original = 'a\n';
  const modifie = 'a\nb\n';
  const bloc = { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 3 };
  const resultat = appliquerBlocs(original, modifie, [bloc]);
  assert.strictEqual(resultat, 'a\nb\n', 'insertion fin fichier cas 1 : résultat incorrect');
});

test('une insertion en toute fin de fichier : cas 2 (insertion)', () => {
  const original = 'a\n';
  const modifie = 'a\nb\n';
  const bloc = { originalStartLineNumber: 1, originalEndLineNumber: 0, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 };
  const resultat = appliquerBlocs(original, modifie, [bloc]);
  assert.strictEqual(resultat, 'a\nb\n', 'insertion fin fichier cas 2 : résultat incorrect');
});

// ---- appliquerBlocs : aucun bloc ----

test('aucun bloc', () => {
  const original = 'a\nb\nc\n';
  const resultat1 = appliquerBlocs(original, '', []);
  assert.strictEqual(resultat1, 'a\nb\nc\n', 'blocs vide : résultat incorrect');

  const resultat2 = appliquerBlocs(original, '', null);
  assert.strictEqual(resultat2, 'a\nb\nc\n', 'blocs null : résultat incorrect');
});

// ---- appliquerBlocs : symétrie ----

test('les deux sens sont symétriques', () => {
  const original = 'a\nb\nc\n';
  const modifie = 'a\nB\nc\n';
  const bloc = { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 };

  // Sens 1 : appliquer le bloc au texte original pour obtenir le modifié
  const resultat1 = appliquerBlocs(original, modifie, [bloc]);
  assert.strictEqual(resultat1, 'a\nB\nc\n', 'sens 1 : résultat incorrect');

  // Sens 2 : appliquer le bloc inversé au texte modifié pour retrouver l'original
  const blocInverse = inverserBloc(bloc);
  const resultat2 = appliquerBlocs(modifie, original, [blocInverse]);
  assert.strictEqual(resultat2, 'a\nb\nc\n', 'sens 2 (symétrie) : résultat incorrect');
});

// ---- inverserBloc ----

test('inverserBloc deux fois rend le bloc de départ', () => {
  const bloc = { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 5, modifiedEndLineNumber: 6 };
  const doublementInverse = inverserBloc(inverserBloc(bloc));
  assert.deepStrictEqual(doublementInverse, bloc, 'double inversion : bloc différent');
});

test('inverserBloc sur une insertion', () => {
  const blocInsertion = { originalStartLineNumber: 2, originalEndLineNumber: 0, modifiedStartLineNumber: 3, modifiedEndLineNumber: 3 };
  const inverse = inverserBloc(blocInsertion);
  // Une insertion devient une suppression
  assert.strictEqual(inverse.originalStartLineNumber, 3, 'insertion inversée : originalStartLineNumber incorrect');
  assert.strictEqual(inverse.originalEndLineNumber, 3, 'insertion inversée : originalEndLineNumber incorrect');
  assert.strictEqual(inverse.modifiedStartLineNumber, 2, 'insertion inversée : modifiedStartLineNumber incorrect');
  assert.strictEqual(inverse.modifiedEndLineNumber, 0, 'insertion inversée : modifiedEndLineNumber incorrect');
});

// ---- appliquerBlocs : fins de ligne Windows ----

test('les fins de ligne Windows sont conservées', () => {
  const original = 'a\r\nb\r\nc\r\n';
  const modifie = 'a\r\nB\r\nc\r\n';
  const bloc = { originalStartLineNumber: 2, originalEndLineNumber: 2, modifiedStartLineNumber: 2, modifiedEndLineNumber: 2 };
  const resultat = appliquerBlocs(original, modifie, [bloc]);
  assert.strictEqual(resultat, 'a\r\nB\r\nc\r\n', 'fins de ligne Windows : résultat incorrect');
});

// ---- decouperLignes et assemblerLignes ----

test('decouperLignes garde la ligne vide finale', () => {
  const texte = 'a\nb\n';
  const doc = decouperLignes(texte);
  assert.deepStrictEqual(doc.lignes, ['a', 'b', ''], 'lignes mal découpées : nombre ou contenu incorrect');

  const reassemble = assemblerLignes(doc);
  assert.strictEqual(reassemble, 'a\nb\n', 'réassemblage incorrect');
});

test('decouperLignes avec fins de ligne Windows', () => {
  const texte = 'a\r\nb\r\nc\r\n';
  const doc = decouperLignes(texte);
  assert.deepStrictEqual(doc.lignes, ['a', 'b', 'c', ''], 'lignes mal découpées avec \\r\\n');
  assert.strictEqual(doc.eol, '\r\n', 'type de fin de ligne mal détecté');

  const reassemble = assemblerLignes(doc);
  assert.strictEqual(reassemble, 'a\r\nb\r\nc\r\n', 'réassemblage avec \\r\\n incorrect');
});

// ---- copieConflitPour ----

test('copieConflitPour trouve la copie voisine, et rien d\'autre', () => {
  const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'conflits-blocs-'));

  try {
    // Crée les fichiers
    const cheminOriginal = path.join(dossier, 'ausgabe.yaml');
    const cheminCopie = path.join(dossier, 'ausgabe-Copie en conflit.yaml');
    const cheminAutre = path.join(dossier, 'autre.yaml');

    fs.writeFileSync(cheminOriginal, '');
    fs.writeFileSync(cheminCopie, '');
    fs.writeFileSync(cheminAutre, '');

    // copieConflitPour du fichier original doit retourner le chemin absolu de la copie
    const resultatCopie = copieConflitPour(cheminOriginal);
    assert.strictEqual(resultatCopie, cheminCopie, 'copieConflitPour n\'a pas trouvé la copie voisine');

    // copieConflitPour sur le fichier autre doit retourner null (pas de copie)
    const resultatAutre = copieConflitPour(cheminAutre);
    assert.strictEqual(resultatAutre, null, 'copieConflitPour a trouvé une copie pour autre.yaml');
  } finally {
    fs.rmSync(dossier, { recursive: true });
  }
});

test('copieConflitPour sur un chemin inexistant retourne null sans lever', () => {
  const cheminInexistant = path.join(os.tmpdir(), 'chemin-qui-nexiste-pas-' + Math.random(), 'fichier.yaml');
  let levee = false;
  try {
    const resultat = copieConflitPour(cheminInexistant);
    assert.strictEqual(resultat, null, 'copieConflitPour n\'a pas retourné null pour un chemin inexistant');
  } catch (e) {
    levee = true;
  }
  assert.strictEqual(levee, false, 'copieConflitPour a levé une exception pour un chemin inexistant');
});
