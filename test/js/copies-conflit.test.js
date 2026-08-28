// Tests de la détection des copies en conflit (OneDrive/SharePoint).
//
// Chaque marqueur texte de conflit doit être reconnu, les doublons numérotés
// testés avec et sans l'original à côté, et une vraie arborescence explorée pour
// vérifier l'ordre stable et l'ignorance des dossiers interdits.
//
// Exécution : depuis la racine du dépôt,
//   node --test test/js/copies-conflit.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { MARQUEURS, EXTENSIONS, estCopieConflit, chercherCopies } = require(
  path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'copies-conflit.js')
);

// ---- estCopieConflit : marqueurs textuels ----

test('estCopieConflit : chaque marqueur textuel est reconnu', () => {
  const casDeTest = [
    { nom: 'ausgabe-Copie en conflit.yaml', attendu: 'ausgabe.yaml' },
    { nom: 'ausgabe (copie en conflit).yaml', attendu: 'ausgabe.yaml' },
    { nom: 'essai (conflicted copy 2026-08-28).md', attendu: 'essai.md' },
    { nom: 'ausgabe-Konfliktkopie 2.yaml', attendu: 'ausgabe.yaml' },
    { nom: 'doc (copia in conflitto).json', attendu: 'doc.json' },
    { nom: 'archivo (copia en conflicto).bib', attendu: 'archivo.bib' }
  ];

  for (const cas of casDeTest) {
    const verdict = estCopieConflit(cas.nom);
    assert.ok(verdict !== null, 'pas reconnu : ' + cas.nom);
    assert.strictEqual(verdict.original, cas.attendu,
      'mauvais original pour ' + cas.nom + ' : obtenu ' + verdict.original);
    assert.ok(MARQUEURS.some((m) => m.toLowerCase() === verdict.marqueur),
      'marqueur invalide pour ' + cas.nom + ' : ' + verdict.marqueur);
  }
});

// ---- estCopieConflit : casse ignorée ----

// La casse du MARQUEUR est ignorée à la reconnaissance, mais celle du NOM est conservée
// dans l'original reconstitué : ce nom sert à ouvrir le fichier d'origine, et la
// compilation passe par WSL, où « Ausgabe.yaml » et « ausgabe.yaml » sont deux fichiers.
test('estCopieConflit : la casse du marqueur est ignorée, celle du nom conservée', () => {
  const cas = 'AUSGABE-COPIE EN CONFLIT.YAML';
  const verdict = estCopieConflit(cas);
  assert.ok(verdict !== null, 'casse majuscule non reconnue : ' + cas);
  assert.strictEqual(verdict.original, 'AUSGABE.YAML',
    'original mal reconstitué : ' + verdict.original);
  const mixte = estCopieConflit('Ausgabe-Copie en conflit.yaml');
  assert.strictEqual(mixte.original, 'Ausgabe.yaml', 'casse du nom perdue');
});

// Un nom qui ne porte QUE le marqueur ne laisse aucun fichier d'origine devant lui :
// « .yaml » n'est pas un nom, et le comparateur n'aurait rien à ouvrir.
test('estCopieConflit : un nom réduit au marqueur ne désigne aucun original', () => {
  assert.strictEqual(estCopieConflit('copie en conflit.yaml'), null,
    'un nom sans rien devant le marqueur a produit un original');
  assert.strictEqual(estCopieConflit('-Konfliktkopie.yaml'), null,
    'un nom sans rien devant le marqueur a produit un original');
});

// ---- estCopieConflit : doublons numérotés ----

test('estCopieConflit : doublon (N) détecté quand l\'original existe', () => {
  const existe = (nom) => nom === 'ausgabe.yaml';
  const verdict = estCopieConflit('ausgabe (1).yaml', existe);
  assert.ok(verdict !== null, 'doublon non reconnu avec original existant');
  assert.strictEqual(verdict.original, 'ausgabe.yaml', 'mauvais original pour doublon');
  assert.strictEqual(verdict.marqueur, 'doublon', 'marqueur devrait être "doublon"');
});

test('estCopieConflit : doublon (N) ignoré quand l\'original n\'existe pas', () => {
  const existe = () => false;  // L'original n'existe jamais.
  const verdict = estCopieConflit('ausgabe (1).yaml', existe);
  assert.strictEqual(verdict, null, 'doublon faussement reconnu sans original');
});

test('estCopieConflit : doublon (N) ignoré si pas de fonction existe', () => {
  // Pas d'argument `existe`, équivalent à "aucun voisin n'existe".
  const verdict = estCopieConflit('ausgabe (1).yaml');
  assert.strictEqual(verdict, null, 'doublon faussement reconnu sans vérification');
});

// ---- estCopieConflit : cas normaux ----

test('estCopieConflit : un fichier normal n\'est jamais signalé', () => {
  const casNormaux = [
    'ausgabe.yaml',
    'essai.meta.yaml',
    '01-exemple.md',
    'readme.html',
    'data.json'
  ];
  for (const nom of casNormaux) {
    const verdict = estCopieConflit(nom);
    assert.strictEqual(verdict, null, 'faux positif : ' + nom);
  }
});

// ---- estCopieConflit : extensions ignorées ----

test('estCopieConflit : une extension hors liste est ignorée', () => {
  // Une image en conflit : le marqueur est présent, mais l'extension n'est pas surveillée.
  const verdict = estCopieConflit('couverture-copie en conflit.jpg');
  assert.strictEqual(verdict, null, 'image en conflit faussement signalée');
});

// ---- estCopieConflit : temporaires du cockpit ----

test('estCopieConflit : un nom commençant par "~$" est toujours ignoré', () => {
  // Temporaire d'écriture atomique du cockpit, jamais une copie en conflit.
  const verdict = estCopieConflit('~$ausgabe.yaml');
  assert.strictEqual(verdict, null, 'temporaire cockpit faussement signalé');
});

// ---- chercherCopies : vraie arborescence ----

test('chercherCopies : explore une arborescence et ignore les dossiers interdits', () => {
  // Crée une structure temporaire avec copies à différents niveaux.
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'copies-conflit-'));

  try {
    // Racine : une copie en conflit.
    fs.writeFileSync(path.join(racine, 'readme-copie en conflit.md'), '');
    fs.writeFileSync(path.join(racine, 'readme.md'), '');

    // Sous-dossier articles/<slug>/ : une copie en conflit.
    fs.mkdirSync(path.join(racine, 'articles'));
    fs.mkdirSync(path.join(racine, 'articles', 'essai'));
    fs.writeFileSync(path.join(racine, 'articles', 'essai', 'essai (conflicted copy).yaml'), '');
    fs.writeFileSync(path.join(racine, 'articles', 'essai', 'essai.yaml'), '');

    // Dossier 'out' : une copie en conflit qui DOIT être ignorée.
    fs.mkdirSync(path.join(racine, 'out'));
    fs.writeFileSync(path.join(racine, 'out', 'sortie-copie en conflit.html'), '');

    // Dossier '.szh-avant-reimport' : une copie en conflit qui DOIT être ignorée.
    fs.mkdirSync(path.join(racine, '.szh-avant-reimport'));
    fs.writeFileSync(path.join(racine, '.szh-avant-reimport', 'save-copie en conflit.json'), '');

    // Fichier normal (sans conflit).
    fs.writeFileSync(path.join(racine, 'config.yaml'), '');

    // Lance la recherche.
    const copies = chercherCopies(racine);

    // Doit trouver exactement 2 copies : une à la racine, une dans articles/essai/.
    assert.strictEqual(copies.length, 2, 'mauvais nombre de copies trouvées : ' + copies.length);

    // Vérifie qu'elles sont bien triées par chemin.
    const chemins = copies.map((c) => c.chemin);
    assert.deepStrictEqual(chemins.slice(), chemins.sort(), 'les copies ne sont pas triées par chemin');

    // La première doit être dans articles/essai/ (tri lexicographique : 'a' < 'r').
    assert.ok(copies[0].chemin.includes('articles') && copies[0].chemin.includes('essai'),
      'première copie mal localisée : ' + copies[0].chemin);
    assert.strictEqual(copies[0].nom, 'essai (conflicted copy).yaml', 'nom incorrect');
    assert.strictEqual(copies[0].original, 'essai.yaml', 'original incorrect');
    assert.strictEqual(copies[0].marqueur, 'conflicted copy', 'marqueur incorrect');

    // La seconde doit être à la racine.
    assert.ok(copies[1].chemin.includes('readme-copie en conflit.md'),
      'seconde copie mal identifiée : ' + copies[1].chemin);
    assert.strictEqual(copies[1].nom, 'readme-copie en conflit.md', 'nom incorrect');
    assert.strictEqual(copies[1].original, 'readme.md', 'original incorrect');
    assert.strictEqual(copies[1].marqueur, 'copie en conflit', 'marqueur incorrect');

    // Vérifie que les copies dans 'out' et '.szh-avant-reimport' sont absentes.
    const enOut = copies.some((c) => c.chemin.includes('out'));
    const enSauvegarde = copies.some((c) => c.chemin.includes('.szh-avant-reimport'));
    assert.ok(!enOut, 'une copie de « out » n\'aurait pas dû être trouvée');
    assert.ok(!enSauvegarde, 'une copie de « .szh-avant-reimport » n\'aurait pas dû être trouvée');
  } finally {
    // Nettoie.
    fs.rmSync(racine, { recursive: true });
  }
});

// ---- chercherCopies : robustesse ----

test('chercherCopies : rend un tableau vide sur une racine inexistante', () => {
  const copies = chercherCopies('/chemin/qui/nexiste/pas');
  assert.ok(Array.isArray(copies), 'le retour n\'est pas un tableau');
  assert.strictEqual(copies.length, 0, 'tableau non vide sur racine inexistante');
});

test('chercherCopies : limite la profondeur à 6 niveaux', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'copies-conflit-profondeur-'));

  try {
    // Crée une arborescence profonde.
    let courant = racine;
    for (let i = 0; i < 8; i++) {
      courant = path.join(courant, 'niveau' + (i + 1));
      fs.mkdirSync(courant);
      fs.writeFileSync(path.join(courant, 'fichier.yaml'), '');
    }

    // Ajoute une copie au niveau 7 (hors limite).
    fs.writeFileSync(path.join(courant, 'fichier-copie en conflit.yaml'), '');

    // Lance la recherche : ne doit pas le trouver (limite à 6).
    const copies = chercherCopies(racine);
    assert.strictEqual(copies.length, 0,
      'une copie au niveau 7 aurait dû être ignorée (limite 6)');
  } finally {
    fs.rmSync(racine, { recursive: true });
  }
});
