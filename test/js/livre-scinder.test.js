// Contrôles de pipeline/livre-scinder.py, qui découpe un manuscrit en chapitres. Il est
// appelé par la cible `import` de pipeline/Makefile quand un manuscrit a plusieurs titres
// de niveau 1.
//
//   node --test "test/js/*.test.js"
//
// Comme reimport.test.js pour reimporter.py, ce fichier exécute le script : ce qui compte
// est l'état du disque et le code de sortie. Il vérifie que :
//   1. une image citée mais absente laisse le dossier d'origine en place, et l'échec se
//      voit (code de sortie non nul, constat « [scission-avertissement] ») ;
//   2. une scission sans ressource manquante réussit et nettoie la source ;
//   3. la chaîne alimente liminaires/media/, comme les chapitres ;
//   4. le texte de tête d'un chapitre (avant son premier titre de niveau 1) est mis de
//      côté et annoncé ;
//   5. ordre-chapitres se fusionne : les chapitres déjà listés (scission précédente, ordre
//      changé dans le cockpit) restent ;
//   6. relancer la scission sur un manuscrit déjà scindé, ou une coïncidence de nom avec
//      un chapitre existant, s'arrête avant de rien créer ni supprimer ;
//   7. une image référencée en HTML brut (`<img src="…">`, ce que pandoc écrit pour une
//      image à légende) ou par un chemin préfixé « ./ » est copiée vers le nouveau
//      chapitre comme une image markdown ordinaire.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const RACINE = path.resolve(__dirname, '..', '..');
const SCRIPT = path.join(RACINE, 'pipeline', 'livre-scinder.py');

// Python par gardes.js : sans lui, les tests sont déclarés sautés (sansPython), pas verts.
const { python, sansPython } = require('./gardes');

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
  return python([SCRIPT, racine, slug], { encoding: 'utf8', env: env });
}

test('scénario du B329 : une image citée mais absente ne détruit plus le dossier d’origine', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    // media/ existe (comme après import-medias.py) mais ne porte pas l'image citée.
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

test('une scission sans ressource manquante réussit encore et nettoie la source', { skip: sansPython }, () => {

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

test('une pièce liminaire écrite à la main récupère son média depuis le chapitre scindé', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Une section\n\nRien de spécial ici.\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'media', 'logo.png', 'contenu-logo');
    // Une pièce liminaire écrite à la main, qui cite l'image du manuscrit importé sans
    // l'avoir copiée dans liminaires/media/.
    ecrire(racine, 'liminaires', 'impressum.md', '# Impressum\n\n![Logo](media/logo.png)\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, 'ce cas ne doit rien laisser manquer : ' + r.stderr);
    assert.ok(fs.existsSync(path.join(racine, 'liminaires', 'media', 'logo.png')),
      'liminaires/media/ n’est toujours pas alimenté par la chaîne');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('le texte de tête d’un chapitre n’est plus capturé puis jeté en silence', { skip: sansPython }, () => {

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

test('ordre-chapitres se fusionne : un chapitre déjà listé n’est pas effacé par la scission d’un autre', { skip: sansPython }, () => {

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

test('ordre-chapitres en BLOCS (au fer à gauche) se fusionne comme la forme en ligne', { skip: sansPython }, () => {
  // pipeline/profils/livre.mk lit les deux formes (szh-lire-config.lua) : le script doit
  // lire la forme en blocs comme le moteur de compilation.

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml',
      'titre: "Essai"\nordre-chapitres:\n- \'01-avant\'\napres: 1\n');
    ecrire(racine, 'chapitres', '01-avant', '01-avant.md', '# Avant\n\nDéjà là.\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Un premier\n\nTexte.\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, r.stderr);
    const buch = fs.readFileSync(path.join(racine, 'buch.yaml'), 'utf8');
    const ligne = buch.split('\n').find((l) => l.startsWith('ordre-chapitres:'));
    assert.match(ligne, /'01-avant'/,
      'le chapitre déjà listé EN BLOCS a disparu : la lecture ne comprend que la forme en ligne');
    assert.match(ligne, /'01-un-premier'/);
    const avant = ligne.indexOf('01-avant');
    const premier = ligne.indexOf('01-un-premier');
    assert.ok(avant !== -1 && premier !== -1 && avant < premier,
      '« 01-avant » ne précède plus le chapitre de la scission dans ordre-chapitres');
    // apres: 1, à la suite du bloc, doit survivre intact.
    assert.ok(buch.indexOf('apres: 1') !== -1, 'la clé suivant le bloc a été perdue');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('ordre-chapitres : le manuscrit déjà listé sous SON PROPRE nom cède sa place aux ' +
  'chapitres qui en sortent, sans se retrouver ajouté en fin', { skip: sansPython }, () => {
  // « manuscrit » (l'argv[2] de lancer()) figure ici dans ordre-chapitres avant la
  // scission : c'est la branche « remplacement en place » de fusionner_ordre()
  // (slug_remplace in ordre_existant). Un slug de part et d'autre vérifie que le
  // remplacement garde la position.

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: [\'00-avant\', \'manuscrit\', \'99-apres\']\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Un premier\n\nTexte.\n\n# Un second\n\nTexte.\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, r.stderr);
    const buch = fs.readFileSync(path.join(racine, 'buch.yaml'), 'utf8');
    const ligne = buch.split('\n').find((l) => l.startsWith('ordre-chapitres:'));
    // « manuscrit » n'y figure plus : il a été remplacé.
    assert.ok(!/'manuscrit'/.test(ligne),
      'le slug du manuscrit scindé est resté dans ordre-chapitres au lieu d’être remplacé');
    const avant = ligne.indexOf('00-avant');
    const premier = ligne.indexOf('01-un-premier');
    const second = ligne.indexOf('02-un-second');
    const apres = ligne.indexOf('99-apres');
    assert.ok([avant, premier, second, apres].every((i) => i !== -1),
      'un des quatre chapitres attendus manque dans ordre-chapitres : ' + ligne);
    // Les deux nouveaux chapitres prennent la place de « manuscrit », entre 00-avant et
    // 99-apres, et non la fin de la liste.
    assert.ok(avant < premier && premier < second && second < apres,
      'les chapitres issus de la scission n’ont pas pris la place du manuscrit remplacé : ' + ligne);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('idempotence : un chapitre déjà présent au nom visé arrête la scission avant tout dégât', { skip: sansPython }, () => {

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

test('une image référencée en HTML brut, ou par un chemin préfixé « ./ », est copiée comme les autres', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    // Les formes que donne un aller-retour pandoc (md -> docx -> md) : une image sans texte
    // alternatif ressort en markdown ordinaire, préfixée « ./ » ; une image avec texte
    // alternatif ressort en <figure><img src="./media/…">, le writer markdown ne pouvant
    // exprimer autrement un Figure à légende.
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

test('une image citée par un TABLEAU suit le chapitre, comme celles du corps', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    // docx-tables.py sort les tableaux du .md et y laisse une inclusion : les images d'un
    // tableau ne sont que dans le HTML extrait, pas dans le corps. La scission doit les
    // copier aussi.
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Une section\n\nUn tableau suit.\n\n'
      + '::: {.szh-tabelle src="tables/table-05.html"}\n:::\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'tables', 'table-05.html',
      '<table><tr><td><img src="media/fig-73.png" alt="Un schéma" width="266"></td></tr></table>\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'media', 'fig-73.png', 'contenu-image');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0,
      'rien ne manque ici : ni le tableau, ni son image. La scission ne doit pas échouer. '
      + r.stderr);
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', '01-une-section',
      'tables', 'table-05.html')), 'le tableau lui-même n’a pas suivi');
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', '01-une-section',
      'media', 'fig-73.png')),
      'le tableau est arrivé sans son image : le chapitre part avec un trou, et rien ne '
      + 'le dit avant la compilation');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('une image citée par un tableau mais ABSENTE est nommée, et la source survit', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Une section\n\nUn tableau suit.\n\n'
      + '::: {.szh-tabelle src="tables/table-05.html"}\n:::\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'tables', 'table-05.html',
      '<table><tr><td><img src="./media/fig-absente.png" alt="Un schéma"></td></tr></table>\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 1,
      'une image de tableau introuvable doit compter comme une ressource manquante, au '
      + 'même titre qu’une image du corps : ' + r.stderr);
    assert.match(r.stderr, /image-introuvable/,
      'le manque n’est pas nommé : il ne se verrait qu’à la compilation');
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', 'manuscrit')),
      'le dossier d’origine a été détruit alors qu’une image manquait');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un buch.yaml sans ordre-chapitres: reçoit la clé, au lieu de la perdre', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    // Aucune ligne ordre-chapitres: dans ce buch.yaml : un livre qui n'en a pas encore.
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md', '# Un premier\n\nTexte.\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, r.stderr);
    const buch = fs.readFileSync(path.join(racine, 'buch.yaml'), 'utf8');
    const ligne = buch.split('\n').find((l) => l.startsWith('ordre-chapitres:'));
    assert.ok(ligne, 'la clé ordre-chapitres: n’a pas été ajoutée : elle a été jetée');
    assert.match(ligne, /'01-un-premier'/);
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un « # » dans un bloc de code clôturé n’ouvre pas un chapitre supplémentaire', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\nordre-chapitres: []\n');
    // Le bloc de code cite un script qui commence par un commentaire « # » : ce n'est pas
    // un titre de niveau 1, même si le motif de découpe (« ^#\s+ ») le reconnaîtrait hors
    // contexte.
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md',
      '# Un premier\n\nTexte avant le script.\n\n'
      + '```\n# Un faux titre, en commentaire de script\necho "bonjour"\n```\n\n'
      + 'Texte après le script, dans la même section.\n\n'
      + '# Un second\n\nTexte.\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, r.stderr);
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', '01-un-premier', '01-un-premier.md')),
      'le premier chapitre n’a pas été créé');
    assert.ok(fs.existsSync(path.join(racine, 'chapitres', '02-un-second', '02-un-second.md')),
      'le second chapitre n’a pas été créé');
    // Pas de troisième chapitre : le « # » du bloc de code n’a pas scindé une section de plus.
    assert.ok(!fs.existsSync(path.join(racine, 'chapitres', '03-un-faux-titre-en-commentaire-de-script')),
      'le « # » du bloc de code a été pris pour un titre de niveau 1 : un chapitre en trop a été créé');
    const premier = fs.readFileSync(
      path.join(racine, 'chapitres', '01-un-premier', '01-un-premier.md'), 'utf8');
    assert.match(premier, /```\r?\n# Un faux titre, en commentaire de script\r?\necho "bonjour"\r?\n```/,
      'le bloc de code n’a pas suivi intact dans la section « Un premier »');
    assert.match(premier, /Texte après le script, dans la même section\./,
      'le texte qui suit le bloc de code, dans la même section, a disparu ou a changé de chapitre');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});

test('un buch.yaml en CRLF reste en CRLF après la réécriture d’ordre-chapitres', { skip: sansPython }, () => {

  const racine = livreJetable();
  try {
    ecrire(racine, 'buch.yaml', 'titre: "Essai"\r\nordre-chapitres: []\r\n');
    ecrire(racine, 'chapitres', 'manuscrit', 'manuscrit.md', '# Un premier\n\nTexte.\n');

    const r = lancer(racine, 'manuscrit');

    assert.strictEqual(r.status, 0, r.stderr);
    const buch = fs.readFileSync(path.join(racine, 'buch.yaml'), 'utf8');
    const nbLF = (buch.match(/\n/g) || []).length;
    const nbCRLF = (buch.match(/\r\n/g) || []).length;
    assert.strictEqual(nbCRLF, nbLF,
      'la réécriture de buch.yaml a mélangé les fins de ligne : le fichier n’est plus en CRLF pur');
    assert.match(buch, /ordre-chapitres: \[.*\]\r\n/,
      'la ligne ordre-chapitres réécrite n’est plus en CRLF');
  } finally {
    fs.rmSync(racine, { recursive: true, force: true });
  }
});
