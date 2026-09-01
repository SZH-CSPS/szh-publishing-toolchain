// Contrôles de pipeline/livre-scinder.py : le script a détruit le seul exemplaire du
// media/ d'un chapitre alors que sept images manquaient à l'appel, parce qu'une copie
// ratée ne faisait qu'un avertissement non bloquant sur stderr, suivi d'un rmtree
// inconditionnel de la source. Voir docs/REPRISE-LIVRES.md (31.08) pour le diagnostic
// complet — ce fichier ne le refait pas, il en mesure le correctif.
//
//   node --test "test/js/*.test.js"
//
// Comme reimport.test.js le fait pour reimporter.py, ce fichier EXÉCUTE le script plutôt
// que de lire son source, parce que c'est un état du disque et un code de sortie qui sont
// en jeu, pas seulement un texte :
//   1. le défaut réel — une image citée mais absente ne doit plus faire disparaître le
//      dossier d'origine, et l'échec doit être visible (code de sortie non nul, constat
//      nommé « [scission-avertissement] ») ;
//   2. qu'une scission sans ressource manquante continue de réussir et de nettoyer la
//      source — sans quoi le correctif serait pire que le mal qu'il répare ;
//   3. que la chaîne alimente désormais liminaires/media/, symétriquement aux chapitres ;
//   4. que le texte de tête d'un chapitre (avant son premier titre de niveau 1),
//      auparavant capturé puis jeté en silence, est maintenant mis de côté et annoncé.
//
// Depuis le branchement de la scission dans pipeline/Makefile (cible `import`, appelée
// automatiquement à l'import d'un manuscrit à plusieurs titres de niveau 1) :
//   5. ordre-chapitres se FUSIONNE : les chapitres déjà listés (une scission précédente,
//      un réordonnancement à la main dans le cockpit) ne disparaissent plus derrière les
//      seuls chapitres de CETTE scission — c'était le cas avant ce correctif ;
//   6. l'IDEMPOTENCE : relancer la scission sur un manuscrit déjà scindé — ou une simple
//      coïncidence de nom avec un chapitre existant — s'arrête AVANT de rien créer ni
//      supprimer, plutôt que d'écraser un chapitre déjà retravaillé par la rédaction ;
//   7. une image référencée en HTML brut (`<img src="…">`, ce que pandoc écrit pour une
//      image à légende que le markdown ne peut exprimer) ou par un chemin préfixé « ./ »
//      — les deux formes mesurées sur un vrai aller-retour pandoc, pas supposées — est
//      copiée vers le nouveau chapitre comme n'importe quelle image en markdown ordinaire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const RACINE = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(RACINE, 'pipeline', 'livre-scinder.py');

// python3, puis python. Aucun saut silencieux : un contrôle qui mesure un code de sortie
// et l'état du disque ne doit pas pouvoir passer au vert sans avoir rien lancé.
function interpretePython() {
  for (const commande of ['python3', 'python']) {
    const r = cp.spawnSync(commande, ['--version'], { encoding: 'utf8' });
    if (!r.error && /Python 3/.test(String(r.stdout || '') + String(r.stderr || ''))) {
      return commande;
    }
  }
  return null;
}

const PYTHON = interpretePython();

function livreJetable() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'szh-scinder-'));
}

function ecrire(racine, ...segments) {
  const contenu = segments.pop();
  const chemin = path.join(racine, ...segments);
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  fs.writeFileSync(chemin, contenu);
  return chemin;
}

function lancer(racine, slug) {
  const env = Object.assign({}, process.env, { PYTHONIOENCODING: 'utf-8' });
  return cp.spawnSync(PYTHON, [SCRIPT, racine, slug], { encoding: 'utf8', env: env });
}

test('scénario du B329 : une image citée mais absente ne détruit plus le dossier d’origine', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé (python3, puis python) : ce '
    + 'contrôle mesure un code de sortie et l’état du disque, il ne peut pas être sauté '
    + 'en silence');

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    // media/ existe (comme après import-medias.py) mais ne porte pas l'image citée :
    // exactement la situation du B329, où sept figures manquaient sans qu'on sache
    // pourquoi — parce que la source a été détruite avant qu'on ait pu le regarder.
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Une section\n\nUne image absente.\n\n![img](media/fig-manquante.png)\n');

    const dossierOriginal = path.join(racine, 'chapitres', 'manuscrit');
    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 1,
      'une ressource manquante ne fait plus échouer le script : ' + r.stderr);
    assert.ok(fs.existsSync(dossierOriginal),
      'le dossier d’origine a été détruit alors qu’une image référencée manquait — '
      + 'c’est exactement le défaut constaté le 31.08');
    assert.match(r.stderr, /\[scission-avertissement\] image-introuvable/,
      'l’échec de copie d’une image n’est plus un constat nommé, visible');
    assert.match(r.stderr, /\[scission-avertissement\] source-non-supprimee/,
      'la conservation du dossier d’origine n’est plus annoncée');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une scission sans ressource manquante réussit encore et nettoie la source', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Une section\n\nUne image présente.\n\n![img](media/fig.png)\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'media', 'fig.png', 'contenu-image');

    const dossierOriginal = path.join(racine, 'chapitres', 'manuscrit');
    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0,
      'une scission complète, sans rien de manquant, ne devrait pas échouer : ' + r.stderr);
    assert.ok(!fs.existsSync(dossierOriginal),
      'le garde-fou empêche maintenant aussi la suppression d’une source entièrement recopiée');
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', '01-une-section', 'media', 'fig.png')),
      'l’image n’a pas suivi la section qui la référence');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une pièce liminaire écrite à la main récupère son média depuis le chapitre scindé', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Une section\n\nRien de spécial ici.\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'media', 'logo.png', 'contenu-logo');
    // Écrite à la main, comme impressum-du-livre.md pour le B329 : elle cite l'image du
    // manuscrit importé sans l'avoir copiée dans liminaires/media/ — avant ce correctif,
    // « grep liminaires/media » sur tout pipeline/ ne rendait rien.
    ecrire(racine, 'liminaires', 'impressum.md', '# Impressum\n\n![Logo](media/logo.png)\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, 'ce cas ne doit rien laisser manquer : ' + r.stderr);
    assert.ok(fs.existsSync(path.join(racine, 'liminaires', 'media', 'logo.png')),
      'liminaires/media/ n’est toujours pas alimenté par la chaîne');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le texte de tête d’un chapitre n’est plus capturé puis jeté en silence', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      'Un impressum recopiable, avant tout titre.\n\n# Une section\n\nRien de spécial.\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, r.stderr);
    assert.match(r.stderr, /\[scission-avertissement\] liminaire-texte-non-repris/,
      'le texte de tête disparaît de nouveau sans un mot, comme avant le 31.08');
    const rescape = path.join(racine, 'chapitres', '_scission-manuscrit-liminaire-non-repris.md');
    assert.ok(fs.existsSync(rescape),
      'le texte de tête jeté n’est plus retrouvable nulle part sur le disque');
    assert.match(fs.readFileSync(rescape, 'utf8'), /Un impressum recopiable/);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('ordre-chapitres se fusionne : un chapitre déjà listé n’est pas effacé par la scission d’un autre', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');

  const racine = livreJetable();
  try {
    // « 01-avant » existe déjà et figure déjà dans ordre-chapitres — comme un chapitre
    // écrit à la main, ou issu d’une scission précédente. Rien à voir avec « manuscrit ».
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: [\'01-avant\']\n');
    ecrire(racine, 'chapitres', '01-avant', '01-avant.md', '# Avant\n\nDéjà là.\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Un premier\n\nTexte.\n\n# Un second\n\nTexte.\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, r.stderr);
    const buch = fs.readFileSync(path.join(racine, 'buch.yaml'), 'utf8');
    const ligne = buch.split('\n').find((l) => l.startsWith('ordre-chapitres:'));
    assert.match(ligne, /'01-avant'/,
      'le chapitre déjà listé a disparu d’ordre-chapitres : la scission a écrasé au lieu de fusionner');
    assert.match(ligne, /'01-un-premier'/);
    assert.match(ligne, /'02-un-second'/);
    // Et dans l’ordre : « 01-avant » doit rester en tête, les deux nouveaux à la suite.
    const avant = ligne.indexOf('01-avant');
    const premier = ligne.indexOf('01-un-premier');
    assert.ok(avant !== -1 && premier !== -1 && avant < premier,
      '« 01-avant » ne précède plus les chapitres de la scission dans ordre-chapitres');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('idempotence : un chapitre déjà présent au nom visé arrête la scission avant tout dégât', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');

  const racine = livreJetable();
  try {
    // « 01-un-premier » existe déjà, retravaillé par la rédaction — c’est justement le nom
    // que produirait la scission du manuscrit ci-dessous. Relancer l’import ne doit ni le
    // dupliquer ni l’écraser.
    const texteEditorial = '# Un premier\n\nVersion corrigée par la rédaction, à ne pas perdre.\n';
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    ecrire(racine, 'chapitres', '01-un-premier', '01-un-premier.md', texteEditorial);
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Un premier\n\nTexte du manuscrit, qui entrerait en collision.\n\n# Un second\n\nTexte.\n');

    const dossierOriginal = path.join(racine, 'chapitres', 'manuscrit');
    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 1,
      'une collision de nom avec un chapitre existant ne fait plus échouer la scission : ' + r.stderr);
    assert.match(r.stderr, /\[scission-avertissement\] chapitre-cible-existe/,
      'la collision n’est plus un constat nommé, visible');
    assert.strictEqual(
      fs.readFileSync(path.join(racine, 'chapitres', '01-un-premier', '01-un-premier.md'), 'utf8'),
      texteEditorial,
      'le chapitre déjà là a été écrasé par la scission automatique — exactement ce que l’idempotence doit empêcher');
    assert.ok(fs.existsSync(dossierOriginal),
      'le dossier du manuscrit a été détruit alors que la scission s’est arrêtée avant toute écriture');
    assert.ok(!fs.existsSync(path.join(racine, 'chapitres', '02-un-second')),
      'un second chapitre a été créé alors que la scission doit s’arrêter AVANT de rien créer');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une image référencée en HTML brut, ou par un chemin préfixé « ./ », est copiée comme les autres', () => {
  assert.ok(PYTHON, 'aucun interprète Python 3 trouvé');

  const racine = livreJetable();
  try {
    // Formes mesurées sur un vrai aller-retour pandoc (md -> docx -> md), pas supposées :
    // une image sans texte alternatif ressort en markdown ordinaire mais préfixée « ./ » ;
    // une image AVEC texte alternatif ressort en <figure><img src="./media/…"> parce que
    // le writer markdown ne peut pas exprimer un Figure à légende autrement qu'en HTML.
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Une section\n\n![](./media/fig-un.png)\n\n# Une autre section\n\n'
      + '<figure>\n<img src="./media/fig-deux.png" alt="Une figure" />\n'
      + '<figcaption aria-hidden="true"><p>Une figure</p></figcaption>\n</figure>\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'media', 'fig-un.png', 'contenu-1');
    ecrire(racine, 'chapitres', 'manuscrit', 'media', 'fig-deux.png', 'contenu-2');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0,
      'une image présente, sous une forme réellement produite par pandoc, est comptée manquante : ' + r.stderr);
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', '01-une-section', 'media', 'fig-un.png')),
      'l’image en markdown préfixée « ./ » n’a pas suivi sa section');
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', '02-une-autre-section', 'media', 'fig-deux.png')),
      'l’image en <figure><img src="./…"> n’a pas suivi sa section');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
