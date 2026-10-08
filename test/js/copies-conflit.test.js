// Détection des copies en conflit déposées par OneDrive ou SharePoint
// (lib/copies-conflit.js et son branchement dans lib/cycle-vie.js).
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

// Le nom reconstitué sert à ouvrir l'original, et la compilation passe par la WSL, où
// « Ausgabe.yaml » et « ausgabe.yaml » sont deux fichiers.
test('estCopieConflit : la casse du marqueur est ignorée, celle du nom conservée', () => {
  const cas = 'AUSGABE-COPIE EN CONFLIT.YAML';
  const verdict = estCopieConflit(cas);
  assert.ok(verdict !== null, 'casse majuscule non reconnue : ' + cas);
  assert.strictEqual(verdict.original, 'AUSGABE.YAML',
    'original mal reconstitué : ' + verdict.original);
  const mixte = estCopieConflit('Ausgabe-Copie en conflit.yaml');
  assert.strictEqual(mixte.original, 'Ausgabe.yaml', 'casse du nom perdue');
});

// « .yaml » seul n'est pas un nom : le comparateur n'aurait rien à ouvrir.
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
  const existe = () => false;
  const verdict = estCopieConflit('ausgabe (1).yaml', existe);
  assert.strictEqual(verdict, null, 'doublon faussement reconnu sans original');
});

test('estCopieConflit : doublon (N) ignoré si pas de fonction existe', () => {
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
  const verdict = estCopieConflit('couverture-copie en conflit.jpg');
  assert.strictEqual(verdict, null, 'image en conflit faussement signalée');
});

// ---- estCopieConflit : temporaires du cockpit ----

test('estCopieConflit : un nom commençant par "~$" est toujours ignoré', () => {
  // Temporaire d'écriture atomique du cockpit.
  const verdict = estCopieConflit('~$ausgabe.yaml');
  assert.strictEqual(verdict, null, 'temporaire cockpit faussement signalé');
});

// ---- chercherCopies : vraie arborescence ----

test('chercherCopies : explore une arborescence et ignore les dossiers interdits', () => {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'copies-conflit-'));

  try {
    fs.writeFileSync(path.join(racine, 'readme-copie en conflit.md'), '');
    fs.writeFileSync(path.join(racine, 'readme.md'), '');

    fs.mkdirSync(path.join(racine, 'articles'));
    fs.mkdirSync(path.join(racine, 'articles', 'essai'));
    fs.writeFileSync(path.join(racine, 'articles', 'essai', 'essai (conflicted copy).yaml'), '');
    fs.writeFileSync(path.join(racine, 'articles', 'essai', 'essai.yaml'), '');

    // Copies à ignorer : dans out/ et .szh-avant-reimport/.
    fs.mkdirSync(path.join(racine, 'out'));
    fs.writeFileSync(path.join(racine, 'out', 'sortie-copie en conflit.html'), '');

    fs.mkdirSync(path.join(racine, '.szh-avant-reimport'));
    fs.writeFileSync(path.join(racine, '.szh-avant-reimport', 'save-copie en conflit.json'), '');

    fs.writeFileSync(path.join(racine, 'config.yaml'), '');

    const copies = chercherCopies(racine);

    assert.strictEqual(copies.length, 2, 'mauvais nombre de copies trouvées : ' + copies.length);

    const chemins = copies.map((c) => c.chemin);
    assert.deepStrictEqual(chemins.slice(), chemins.sort(), 'les copies ne sont pas triées par chemin');

    // Tri par chemin : articles/essai/ passe avant la racine (« a » < « r »).
    assert.ok(copies[0].chemin.includes('articles') && copies[0].chemin.includes('essai'),
      'première copie mal localisée : ' + copies[0].chemin);
    assert.strictEqual(copies[0].nom, 'essai (conflicted copy).yaml', 'nom incorrect');
    assert.strictEqual(copies[0].original, 'essai.yaml', 'original incorrect');
    assert.strictEqual(copies[0].marqueur, 'conflicted copy', 'marqueur incorrect');

    assert.ok(copies[1].chemin.includes('readme-copie en conflit.md'),
      'seconde copie mal identifiée : ' + copies[1].chemin);
    assert.strictEqual(copies[1].nom, 'readme-copie en conflit.md', 'nom incorrect');
    assert.strictEqual(copies[1].original, 'readme.md', 'original incorrect');
    assert.strictEqual(copies[1].marqueur, 'copie en conflit', 'marqueur incorrect');

    const enOut = copies.some((c) => c.chemin.includes('out'));
    const enSauvegarde = copies.some((c) => c.chemin.includes('.szh-avant-reimport'));
    assert.ok(!enOut, 'une copie de « out » n\'aurait pas dû être trouvée');
    assert.ok(!enSauvegarde, 'une copie de « .szh-avant-reimport » n\'aurait pas dû être trouvée');
  } finally {
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
    let courant = racine;
    for (let i = 0; i < 8; i++) {
      courant = path.join(courant, 'niveau' + (i + 1));
      fs.mkdirSync(courant);
      fs.writeFileSync(path.join(courant, 'fichier.yaml'), '');
    }

    // Copie dans le dossier le plus profond, au-delà de la limite.
    fs.writeFileSync(path.join(courant, 'fichier-copie en conflit.yaml'), '');

    const copies = chercherCopies(racine);
    assert.strictEqual(copies.length, 0,
      'une copie au niveau 7 aurait dû être ignorée (limite 6)');
  } finally {
    fs.rmSync(racine, { recursive: true });
  }
});

// ---- Le dossier partagé de l'outil ---------------------------------------------------
//
// « _Systeme » (rapports d'erreur, journaux, suggestions de traduction, inventaire des
// postes) n'appartient à aucun numéro et ne s'ouvre pas à la main : il est balayé à part.

const { chercherCopiesPlat } = require(
  path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'copies-conflit.js')
);

// Un « _Systeme » jetable, tel qu'il existe sous la racine active : plat, un seul niveau de
// sous-dossiers, plus un piège au niveau du dessous.
function dossierSystemeJetable() {
  const racine = fs.mkdtempSync(path.join(os.tmpdir(), 'copies-systeme-'));
  const systeme = path.join(racine, '_Systeme');
  fs.mkdirSync(path.join(systeme, 'rapports'), { recursive: true });
  fs.mkdirSync(path.join(systeme, 'inventaire'), { recursive: true });
  fs.mkdirSync(path.join(systeme, 'journaux', 'trop-profond'), { recursive: true });
  // Deux postes écrivent le même rapport : OneDrive dépose la version perdante à côté.
  fs.writeFileSync(path.join(systeme, 'rapports', '20260915-0800-PC-aaa.json'), '{}');
  fs.writeFileSync(path.join(systeme, 'rapports',
    '20260915-0800-PC-aaa-copie en conflit (RMO-DESK).json'), '{}');
  // À la racine du dossier partagé, et dans un deuxième sous-dossier.
  fs.writeFileSync(path.join(systeme, 'index.json'), '{}');
  fs.writeFileSync(path.join(systeme, 'index (copie en conflit).json'), '{}');
  fs.writeFileSync(path.join(systeme, 'inventaire', 'notes-Konfliktkopie.md'), '');
  // Un niveau de trop : hors de portée du balayage plat.
  fs.writeFileSync(path.join(systeme, 'journaux', 'trop-profond', 'a-copie en conflit.json'), '{}');
  // Temporaire d'écriture atomique, à ignorer.
  fs.writeFileSync(path.join(systeme, 'rapports', '~$20260915-0800-PC-bbb.json.123.ab'), '{}');
  return { racine, systeme };
}

test('chercherCopiesPlat : le dossier partagé et ses sous-dossiers directs, pas un niveau de plus', () => {
  const { racine, systeme } = dossierSystemeJetable();
  try {
    const copies = chercherCopiesPlat(systeme);
    const noms = copies.map((c) => c.nom).sort();
    assert.deepStrictEqual(noms, [
      '20260915-0800-PC-aaa-copie en conflit (RMO-DESK).json',
      'index (copie en conflit).json',
      'notes-Konfliktkopie.md'
    ], 'le balayage plat n’a pas vu ce qu’il fallait : ' + noms.join(' | '));
    assert.ok(!copies.some((c) => c.chemin.includes('trop-profond')),
      'le balayage plat est descendu trop bas : il doit rester bon marché');
    assert.ok(!copies.some((c) => c.nom.startsWith('~$')),
      'un temporaire d’écriture atomique a été pris pour une copie en conflit');
    // L'original est nommé, pour que le comparateur puisse l'ouvrir.
    const rapport = copies.find((c) => c.nom.endsWith('(RMO-DESK).json'));
    assert.strictEqual(rapport.original, '20260915-0800-PC-aaa.json');
    assert.ok(fs.existsSync(rapport.cheminOriginal), 'le chemin de l’original ne mène nulle part');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('chercherCopiesPlat : zéro niveau ne regarde que le dossier lui-même', () => {
  const { racine, systeme } = dossierSystemeJetable();
  try {
    const noms = chercherCopiesPlat(systeme, 0).map((c) => c.nom);
    assert.deepStrictEqual(noms, ['index (copie en conflit).json']);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('chercherCopiesPlat : une racine absente ou vide ne lève pas', () => {
  assert.deepStrictEqual(chercherCopiesPlat(path.join(os.tmpdir(), 'nexiste-pas-du-tout')), []);
  assert.deepStrictEqual(chercherCopiesPlat(''), []);
  assert.deepStrictEqual(chercherCopiesPlat(null), []);
});

// ---- Le branchement dans lib/cycle-vie.js -------------------------------------------
//
// Doublure minimale de « vscode » : rien de ce qui est vérifié ici ne touche à l'interface.
function chargerCycleVie() {
  const Module = require('module');
  const orig = Module._load;
  const rien = { dispose() {} };
  const faux = {
    EventEmitter: class { constructor() { this.event = () => rien; } fire() {} dispose() {} },
    Uri: { file: (p) => ({ fsPath: p, with: () => ({}) }) },
    window: { showWarningMessage: () => Promise.resolve(undefined), setStatusBarMessage: () => {} },
    workspace: { getConfiguration: () => ({ get: () => '' }) },
    scm: { createSourceControl: () => ({ createResourceGroup: () => ({}) }) },
    env: { language: 'fr' },
    commands: { executeCommand: () => Promise.resolve() }
  };
  Module._load = function (r, pp, i) {
    if (r === 'vscode') { return faux; }
    return orig(r, pp, i);
  };
  try {
    return require(path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'cycle-vie.js'));
  } finally { Module._load = orig; }
}

test('cycle-vie : le dossier partagé est DÉRIVÉ de celui des rapports, et il est bien balayé', () => {
  const cycleVie = chargerCycleVie();
  const { racine, systeme } = dossierSystemeJetable();
  const avant = process.env.SZH_RAPPORTS;
  try {
    // SZH_RAPPORTS nomme le dossier des rapports (lib/rapport-erreur.js) ; le dossier
    // partagé est son parent, pour que le nom de l'application ne vive qu'à un endroit.
    process.env.SZH_RAPPORTS = path.join(systeme, 'rapports');
    assert.strictEqual(cycleVie.dossierPartageOutil(), systeme,
      'le dossier partagé n’est pas le parent du dossier des rapports');

    const noms = cycleVie.copiesDuDossierPartage().map((c) => c.nom).sort();
    assert.deepStrictEqual(noms, [
      '20260915-0800-PC-aaa-copie en conflit (RMO-DESK).json',
      'index (copie en conflit).json',
      'notes-Konfliktkopie.md'
    ], 'le dossier partagé n’est pas balayé : ' + noms.join(' | '));
  } finally {
    if (avant === undefined) { delete process.env.SZH_RAPPORTS; } else { process.env.SZH_RAPPORTS = avant; }
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('cycle-vie : sans ancrage ni surcharge, le balayage du dossier partagé ne coûte rien', () => {
  const cycleVie = chargerCycleVie();
  const avant = { SZH_RAPPORTS: process.env.SZH_RAPPORTS, SZH_ANCRAGE: process.env.SZH_ANCRAGE };
  const base = process.env.SZH_BASE;
  const local = process.env.LOCALAPPDATA;
  try {
    // Ni surcharge, ni ancrage, ni config lisible : rien à balayer, et aucune exception
    // qui remonterait jusqu'au rafraîchissement de l'éditeur.
    delete process.env.SZH_RAPPORTS;
    delete process.env.SZH_ANCRAGE;
    process.env.SZH_BASE = path.join(os.tmpdir(), 'szh-base-qui-nexiste-pas');
    process.env.LOCALAPPDATA = path.join(os.tmpdir(), 'szh-local-qui-nexiste-pas');
    assert.strictEqual(cycleVie.dossierPartageOutil(), null);
    assert.deepStrictEqual(cycleVie.copiesDuDossierPartage(), []);
  } finally {
    for (const cle of Object.keys(avant)) {
      if (avant[cle] === undefined) { delete process.env[cle]; } else { process.env[cle] = avant[cle]; }
    }
    if (base === undefined) { delete process.env.SZH_BASE; } else { process.env.SZH_BASE = base; }
    if (local === undefined) { delete process.env.LOCALAPPDATA; } else { process.env.LOCALAPPDATA = local; }
  }
});

test('cycle-vie : les deux appelants ajoutent le dossier partagé à ce qu’ils trouvent', () => {
  // Lecture du source : avertirCopiesConflit et rafraichirConflitsScm alimentent tous deux
  // la vue du contrôle de source ; si l'un oubliait le dossier partagé, ses copies
  // disparaîtraient de la liste au rafraîchissement suivant.
  const source = fs.readFileSync(
    path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'cycle-vie.js'), 'utf8');
  const appels = source.match(/copiesDuDossierPartage()/g) || [];
  assert.ok(appels.length >= 3,
    'lib/cycle-vie.js n’appelle copiesDuDossierPartage() que ' + appels.length + ' fois '
    + '(sa définition, plus les deux balayages)');
  assert.ok(source.indexOf(
    'majConflitsScm(racine, sansCopiesRedondantes(copies.concat(copiesDuDossierPartage())))') !== -1,
    'rafraichirConflitsScm oublie le dossier partagé');
});
