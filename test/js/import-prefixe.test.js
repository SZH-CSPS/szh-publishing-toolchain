// Le préfixe que l'import pose sur le dossier d'un article nouvellement créé.
//
//   node --test test/js/import-prefixe.test.js
//
// L'import crée le dossier sans préfixe ; prefixerNouveauxArticles() (lib/import-hote.js)
// lui donne celui de son rang, celui que l'écran affiche. Ce fichier vérifie que :
//   - le premier article d'un numéro vide reçoit « 00 » (même règle que prefixeOrdre(),
//     lib/articles.js) ;
//   - les articles déjà là sans préfixe (dossiers posés à la main, par exemple) ne sont pas
//     touchés : seuls les dossiers créés par cet import sont préfixés ;
//   - le .md et la .meta.yaml suivent le dossier renommé (alignerFichiers(),
//     lib/renumerotation-fs.js) ;
//   - si le nom visé est occupé, la recherche monte au numéro libre suivant. L'article ne
//     reste sans préfixe que si la recherche dépasse MAX_RECHERCHE_RANG_LIBRE
//     (lib/import-hote.js) ;
//   - un article sous un dossier préfixé reste reconnu « déjà converti » par _articleExiste
//     (extension.js), qui compare par tige().
//
// Comme import-ordre.test.js et import-hote.test.js : un seul hôte factice pour tout le
// fichier, l'état du disque modifié entre les contrôles.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const LF = String.fromCharCode(10);
const NOM_IMPORT = 'Importer les articles Word';
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);
const MOTS = path.join(REVUE, 'articles-word');
const ARTICLES = path.join(REVUE, 'articles');

// Ce que « make import » aurait produit pour un .docx donné : un article minimal, sans
// pandoc (même fixture que import-hote.test.js). lancerConversion() ne compare que les
// slugs avant et après : un dossier avec un .md suffit à faire un article « nouveau ».
function simulerArticleImporte(slug, titre) {
  const dossier = path.join(ARTICLES, slug);
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte importé.' + LF);
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'title:', '  fr: "' + titre + '"', ''].join(LF));
}

// Même chose, avec une bibliographie détachée comme la laisse szh-biblio-detacher.lua : le
// fichier <slug>.biblio.md à côté, et le marqueur
// « ::: {.szh-biblio src="<slug>.biblio.md"} » dans le .md, à la place de la liste.
function simulerArticleImporteAvecBiblio(slug, titre) {
  const dossier = path.join(ARTICLES, slug);
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.biblio.md'), 'Dupont, A. (2024). Un titre.' + LF);
  fs.writeFileSync(path.join(dossier, slug + '.md'),
    ['Texte importé.', '', '::: {.szh-biblio src="' + slug + '.biblio.md"}', ':::', ''].join(LF));
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'title:', '  fr: "' + titre + '"', ''].join(LF));
}

function ausgabe() {
  return fs.readFileSync(path.join(REVUE, 'ausgabe.yaml'), 'utf8');
}

function marqueurSrc(slug) {
  const texte = fs.readFileSync(path.join(ARTICLES, slug, slug + '.md'), 'utf8');
  const m = texte.match(/\.szh-biblio\b[^}]*\bsrc="([^"]*)"/);
  return m ? m[1] : null;
}

// Dépose un .docx, laisse lancerConversion() démarrer la tâche, simule ce que « make
// import » aurait produit (dossier sans préfixe), et laisse l'import se terminer.
// `simuler`, si fourni, remplace simulerArticleImporte().
async function importer(fichierWord, slugSimule, titre, simuler) {
  fs.writeFileSync(path.join(MOTS, fichierWord), Buffer.alloc(16));
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
  try {
    const promesse = HOTE.executer('szh.convertirEnAttente');
    await tick();
    fs.rmSync(path.join(MOTS, fichierWord));
    (simuler || simulerArticleImporte)(slugSimule, titre);
    await HOTE.finirTache(NOM_IMPORT, 0);
    await tick();
    await HOTE.finirTache(NOM_BUILD, 0);
    await promesse;
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
}

test('mise en route : le numéro de ce contrôle démarre sans aucun article', () => {
  // Vide le numéro de revueDEssai() (deux articles et un Word en attente).
  fs.rmSync(path.join(MOTS, '9_Essai.docx'), { force: true });
  fs.rmSync(path.join(ARTICLES, '01-essai'), { recursive: true, force: true });
  fs.rmSync(path.join(ARTICLES, '02-sans-fiche'), { recursive: true, force: true });
  assert.deepStrictEqual(fs.readdirSync(ARTICLES), [],
    'le numéro de ce contrôle doit démarrer vide, sinon les rangs qui suivent ne se lisent plus');
});

test('numéro vide : les trois premiers articles importés prennent 00, 01, 02', async () => {
  await importer('Un.docx', 'un', 'Un');
  await importer('Deux.docx', 'deux', 'Deux');
  await importer('Trois.docx', 'trois', 'Trois');

  assert.deepStrictEqual(fs.readdirSync(ARTICLES).sort(), ['00-un', '01-deux', '02-trois'],
    'le premier article importé sur un numéro vide ne porte pas « 00 »');
  assert.match(ausgabe(), /ordre-articles: \["00-un", "01-deux", "02-trois"\]/,
    'ausgabe.yaml ne porte pas les NOUVEAUX noms, préfixés');
  // Le .md et la fiche suivent le dossier renommé : le Makefile exige que le .md porte le
  // nom de son dossier.
  for (const slug of ['00-un', '01-deux', '02-trois']) {
    assert.ok(fs.existsSync(path.join(ARTICLES, slug, slug + '.md')),
      'le .md n’a pas suivi le dossier renommé (' + slug + ')');
    assert.ok(fs.existsSync(path.join(ARTICLES, slug, slug + '.meta.yaml')),
      'la fiche n’a pas suivi le dossier renommé (' + slug + ')');
  }
});

test('un article rangé sous un dossier préfixé reste reconnu « déjà converti »', () => {
  // « 00-un » vient du contrôle précédent. Un Word de même titre (slug « un ») est reconnu
  // grâce à la comparaison par tige() de _articleExiste, sans doublon à côté.
  const fournisseur = HOTE.arbre();
  assert.strictEqual(fournisseur._articleExiste('un'), true,
    'un article rangé sous « 00-un » n’est pas reconnu pour le slug nu « un »');
  assert.strictEqual(fournisseur._articleExiste('inconnu'), false,
    '_articleExiste ne doit pas dire « oui » à un slug qui n’existe nulle part');
});

test('des articles déjà présents et non préfixés ne sont jamais renommés par un import', async () => {
  // Un numéro dont les dossiers n'ont pas de préfixe, par exemple créés à la main.
  fs.rmSync(ARTICLES, { recursive: true, force: true });
  simulerArticleImporte('alpha', 'Alpha');
  simulerArticleImporte('beta', 'Beta');
  simulerArticleImporte('gamma', 'Gamma');
  assert.deepStrictEqual(fs.readdirSync(ARTICLES).sort(), ['alpha', 'beta', 'gamma'], 'décor du test');

  await importer('Delta.docx', 'delta', 'Delta');

  // Le nouveau prend le rang 3 ; les trois anciens gardent leur nom. Les réaligner revient
  // à « Terminer » (lib/renumerotation-fs.js).
  assert.deepStrictEqual(fs.readdirSync(ARTICLES).sort(), ['03-delta', 'alpha', 'beta', 'gamma'],
    'un article déjà présent, sans préfixe, a été touché par l’import');
  assert.ok(fs.existsSync(path.join(ARTICLES, 'alpha', 'alpha.md')), 'alpha a été renommé ou vidé');
  assert.ok(fs.existsSync(path.join(ARTICLES, 'beta', 'beta.md')), 'beta a été renommé ou vidé');
  assert.ok(fs.existsSync(path.join(ARTICLES, 'gamma', 'gamma.md')), 'gamma a été renommé ou vidé');
  assert.match(ausgabe(), /ordre-articles: \["alpha", "beta", "gamma", "03-delta"\]/,
    'l’ordre écrit ne nomme pas les dossiers tels qu’ils sont réellement sur le disque');
});

test('un nom cible déjà pris fait prendre le prochain numéro libre, sans bouger les dossiers existants', async () => {
  // Le rang que « zeta » viserait (après alpha, beta, gamma, 03-delta) est occupé par un
  // dossier sans .md, préparé à la main. listerArticles() ne le voit pas, mais
  // fs.existsSync() le trouve : prefixerNouveauxArticles() cherche plus loin.
  fs.mkdirSync(path.join(ARTICLES, '04-zeta'), { recursive: true });
  fs.writeFileSync(path.join(ARTICLES, '04-zeta', 'notes.txt'), 'réservé' + LF);

  const avantErreurs = HOTE.erreurs.length;
  const dossiersAvant = fs.readdirSync(ARTICLES).sort();
  await importer('Zeta.docx', 'zeta', 'Zeta');

  // L'article prend le numéro libre suivant, « 05-zeta ».
  assert.ok(fs.existsSync(path.join(ARTICLES, '05-zeta', '05-zeta.md')),
    'l’article n’a pas pris le prochain numéro libre au-delà du rang occupé');
  assert.ok(!fs.existsSync(path.join(ARTICLES, 'zeta')),
    'l’article est resté sans préfixe alors qu’un numéro libre existait plus loin');
  // Les dossiers déjà en place, dont celui qui occupait le rang visé, n'ont pas bougé.
  assert.ok(fs.existsSync(path.join(ARTICLES, '04-zeta', 'notes.txt')),
    'le dossier qui occupait le nom cible a été touché : il n’avait pas à l’être');
  for (const slug of dossiersAvant) {
    assert.ok(fs.existsSync(path.join(ARTICLES, slug)),
      'un dossier déjà présent a été déplacé par la recherche du numéro libre : ' + slug);
  }
  assert.strictEqual(HOTE.erreurs.length, avantErreurs,
    'la recherche du numéro libre a fait sortir une erreur alors que l’import doit continuer');
  assert.match(ausgabe(), /"05-zeta"/, 'l’ordre du numéro ne nomme pas le dossier réellement créé');
});

// Un article importé avec une bibliographie : alignerFichiers(), appelé par
// prefixerNouveauxArticles(), renomme aussi le fichier de bibliographie et met à jour le
// marqueur du .md. Les autres chemins sont dans test/js/renumerotation-fs.test.js.
test('import : le marqueur de bibliographie suit le préfixage à l’import', async () => {
  fs.rmSync(ARTICLES, { recursive: true, force: true });
  await importer('Eta.docx', 'eta', 'Eta', simulerArticleImporteAvecBiblio);
  assert.deepStrictEqual(fs.readdirSync(ARTICLES), ['00-eta'],
    'décor du test : le premier article importé doit prendre « 00 »');
  assert.ok(fs.existsSync(path.join(ARTICLES, '00-eta', '00-eta.biblio.md')),
    'le fichier de bibliographie n’a pas suivi le préfixage');
  assert.strictEqual(marqueurSrc('00-eta'), '00-eta.biblio.md',
    'le marqueur désigne encore « eta.biblio.md » : la bibliographie ne se résoudrait '
    + 'plus à la compilation');
});
