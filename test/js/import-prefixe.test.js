// Le préfixe que l'import pose sur le dossier d'un article nouvellement créé.
//
//   node --test test/js/import-prefixe.test.js
//
// Depuis 3e05e78 (31.08.2026), l'import ne préfixe plus les dossiers ; depuis 029dbb9
// (11.09.2026), « Terminer » et la suppression les réalignent sur leur rang, mais rien ne
// préfixait le dossier qu'un import venait de créer — il restait nu (« inclusion ») alors
// que l'écran affiche déjà un rang pour lui. lib/import-hote.js:prefixerNouveauxArticles()
// ferme cet écart, et ce fichier en éprouve les garanties, une par une :
//   - un numéro qui n'a encore aucun article numérote son premier « 00 » (même règle que
//     prefixeOrdre(), lib/articles.js — voir test/js/renumerotation.test.js pour le disque
//     une fois « Terminer » passé, et ce fichier pour l'import qui crée le dossier) ;
//   - un numéro qui compte déjà des articles NON préfixés (chaîne d'avant 3e05e78, ou
//     dossier posé à la main) ne les touche jamais : seuls les dossiers CRÉÉS par cet
//     import sont candidats au préfixe ;
//   - le .md et la .meta.yaml suivent le dossier renommé — alignerFichiers()
//     (lib/renumerotation-fs.js) réutilisée, pas recopiée ;
//   - un nom cible déjà occupé fait monter la recherche au numéro libre suivant, plutôt que
//     de laisser l'article sans préfixe : un article nu ne se retrouve pas dans
//     l'Explorateur, exactement le problème que ce préfixe corrige. Le repli sans préfixe
//     ne reste que pour le cas absurde où la recherche est allée trop loin sans en trouver
//     un (voir MAX_RECHERCHE_RANG_LIBRE, lib/import-hote.js) ;
//   - un article rangé sous un dossier préfixé reste reconnu « déjà converti » par
//     _articleExiste (extension.js), qui compare par tige() et non par égalité stricte.
//
// Même façon de faire que import-ordre.test.js et import-hote.test.js : un seul hôte
// factice pour tout le fichier, l'état du disque manipulé entre les contrôles.
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
// passer par la vraie chaîne pandoc — même fixture que import-hote.test.js et
// import-ordre.test.js. lancerConversion() ne regarde que la liste des slugs avant/après,
// un dossier avec un .md suffit à le faire apparaître comme « nouveau ».
function simulerArticleImporte(slug, titre) {
  const dossier = path.join(ARTICLES, slug);
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte importé.' + LF);
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'title:', '  fr: "' + titre + '"', ''].join(LF));
}

// Même chose, mais avec une bibliographie détachée — la forme que laisse
// szh-biblio-detacher.lua : le fichier <slug>.biblio.md à côté, et le marqueur
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
// import » aurait produit sous le nom NU (jamais préfixé — ce n'est pas son rôle), et
// laisse l'import se terminer. `simuler`, si fourni, remplace simulerArticleImporte() —
// utilisé pour éprouver un article importé avec une bibliographie détachée.
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
  // Le fixture de revueDEssai() pose deux articles et un Word en attente, pour les
  // contrôles de l'arbre — sans rapport avec ce fichier, qui a besoin d'un numéro vide.
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
  // Le .md et la fiche suivent le dossier renommé — le Makefile exige que le .md porte
  // le nom de son dossier, et personne ne lit une fiche sous un autre nom que la sienne.
  for (const slug of ['00-un', '01-deux', '02-trois']) {
    assert.ok(fs.existsSync(path.join(ARTICLES, slug, slug + '.md')),
      'le .md n’a pas suivi le dossier renommé (' + slug + ')');
    assert.ok(fs.existsSync(path.join(ARTICLES, slug, slug + '.meta.yaml')),
      'la fiche n’a pas suivi le dossier renommé (' + slug + ')');
  }
});

test('un article rangé sous un dossier préfixé reste reconnu « déjà converti »', () => {
  // « 00-un » vient d'être créé par le contrôle précédent. Un Word qui redonnerait le
  // même titre (slug nu « un ») doit être reconnu : sans la comparaison par tige(),
  // _articleExiste ne verrait qu'un slug « un » qui n'existe pas, et un second import
  // créerait un doublon à côté de « 00-un ».
  const fournisseur = HOTE.arbre();
  assert.strictEqual(fournisseur._articleExiste('un'), true,
    'un article rangé sous « 00-un » n’est pas reconnu pour le slug nu « un »');
  assert.strictEqual(fournisseur._articleExiste('inconnu'), false,
    '_articleExiste ne doit pas dire « oui » à un slug qui n’existe nulle part');
});

test('des articles déjà présents et non préfixés ne sont jamais renommés par un import', async () => {
  // Un numéro « à plat », comme la chaîne les produisait avant que le cockpit ne
  // préfixe (3e05e78) — ou trois dossiers créés à la main.
  fs.rmSync(ARTICLES, { recursive: true, force: true });
  simulerArticleImporte('alpha', 'Alpha');
  simulerArticleImporte('beta', 'Beta');
  simulerArticleImporte('gamma', 'Gamma');
  assert.deepStrictEqual(fs.readdirSync(ARTICLES).sort(), ['alpha', 'beta', 'gamma'], 'décor du test');

  await importer('Delta.docx', 'delta', 'Delta');

  // Le nouveau prend le rang 3 (trois articles le précèdent dans l'ordre) ; les trois
  // anciens gardent EXACTEMENT leur nom — ce n'est pas à un import de les réaligner en
  // silence, ce geste-là appartient à « Terminer » (lib/renumerotation-fs.js), sur
  // demande explicite.
  assert.deepStrictEqual(fs.readdirSync(ARTICLES).sort(), ['03-delta', 'alpha', 'beta', 'gamma'],
    'un article déjà présent, sans préfixe, a été touché par l’import');
  assert.ok(fs.existsSync(path.join(ARTICLES, 'alpha', 'alpha.md')), 'alpha a été renommé ou vidé');
  assert.ok(fs.existsSync(path.join(ARTICLES, 'beta', 'beta.md')), 'beta a été renommé ou vidé');
  assert.ok(fs.existsSync(path.join(ARTICLES, 'gamma', 'gamma.md')), 'gamma a été renommé ou vidé');
  assert.match(ausgabe(), /ordre-articles: \["alpha", "beta", "gamma", "03-delta"\]/,
    'l’ordre écrit ne nomme pas les dossiers tels qu’ils sont réellement sur le disque');
});

test('un nom cible déjà pris fait prendre le prochain numéro libre, sans bouger les dossiers existants', async () => {
  // Le rang que « zeta » viserait (quatre articles le précèdent désormais : alpha, beta,
  // gamma, 03-delta) est déjà occupé par un dossier posé à la main, sans .md — un dossier
  // préparé à l'avance par la rédaction, par exemple. listerArticles() ne le voit pas
  // (pas de .md), mais fs.existsSync() le trouve : c'est exactement le cas où
  // prefixerNouveauxArticles() doit chercher plus loin plutôt que d'écraser ou de planter.
  fs.mkdirSync(path.join(ARTICLES, '04-zeta'), { recursive: true });
  fs.writeFileSync(path.join(ARTICLES, '04-zeta', 'notes.txt'), 'réservé' + LF);

  const avantErreurs = HOTE.erreurs.length;
  const dossiersAvant = fs.readdirSync(ARTICLES).sort();
  await importer('Zeta.docx', 'zeta', 'Zeta');

  // L'article a grimpé au numéro libre suivant — « 05-zeta » — plutôt que de rester nu :
  // un article sans préfixe ne se retrouverait pas dans l'Explorateur.
  assert.ok(fs.existsSync(path.join(ARTICLES, '05-zeta', '05-zeta.md')),
    'l’article n’a pas pris le prochain numéro libre au-delà du rang occupé');
  assert.ok(!fs.existsSync(path.join(ARTICLES, 'zeta')),
    'l’article est resté sans préfixe alors qu’un numéro libre existait plus loin');
  // Le dossier qui occupait le rang visé, et tous les dossiers déjà en place, n'ont pas
  // été touchés par cette recherche.
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

// Troisième chemin du défaut constaté sur le poste du propriétaire (les deux autres sont
// dans test/js/renumerotation-fs.test.js) : un article importé avec une bibliographie est
// préfixé par prefixerNouveauxArticles(), qui appelle déjà alignerFichiers() pour le .md
// et la fiche — le marqueur doit suivre par le même appel, sans geste séparé ici.
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
