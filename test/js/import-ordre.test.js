// Le numéro de tête d'un Word (« 3_Titre.docx ») décide où l'article se place : il va dans
// `ordre-articles` (`ordre-chapitres` sur un livre), la clé que modifient « Monter » et
// « Descendre ».
//
// Le dossier d'un article importé reçoit un préfixe qui porte son rang dans l'ordre final,
// pas le numéro du Word : ci-dessous, « 1_Alpha.docx » et « 3_Zebre.docx » donnent
// « 02-alpha » et « 03-zebre », deux articles existants les précédant
// (prefixerNouveauxArticles(), lib/import-hote.js).
//
//   node --test test/js/import-ordre.test.js
//
// Le chemin réel de l'import : des .docx numérotés déposés dans articles-word/, la commande
// szh.convertirEnAttente jouée par l'hôte factice, et ordre-articles lu sur le disque.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const LF = String.fromCharCode(10);
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const NOM_IMPORT = 'Importer les articles Word';
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const ext = require(path.join(COCKPIT, 'extension.js'));
const AUSGABE = path.join(REVUE, 'ausgabe.yaml');
const MOTS = path.join(REVUE, 'articles-word');

// revueDEssai() dépose déjà un Word en attente (9_Essai.docx) : on le retire.
fs.rmSync(path.join(MOTS, '9_Essai.docx'), { force: true });

// Ce que « make import » aurait produit pour un .docx donné : un article minimal, sans
// pandoc. lancerConversion() ne compare que les slugs avant et après : un dossier avec un
// .md suffit à faire un article « nouveau ».
function simulerArticleImporte(slug, titre) {
  const dossier = path.join(REVUE, 'articles', slug);
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte importé.' + LF);
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'title:', '  fr: "' + titre + '"', ''].join(LF));
}

test('mise en route : le Word par défaut du fixture est retiré', () => {
  assert.deepStrictEqual(fs.readdirSync(MOTS).filter((n) => n.endsWith('.docx')), []);
});

test('import réel : le numéro de tête du Word migre vers ordre-articles, numérotés et non', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
  try {
    // Trois Word : deux numérotés, déposés dans l'ordre inverse de leur numéro, et un
    // troisième sans numéro de tête.
    fs.writeFileSync(path.join(MOTS, '3_Zebre.docx'), Buffer.alloc(16));
    fs.writeFileSync(path.join(MOTS, '1_Alpha.docx'), Buffer.alloc(16));
    fs.writeFileSync(path.join(MOTS, 'Sans_Numero.docx'), Buffer.alloc(16));

    const promesse = HOTE.executer('szh.convertirEnAttente');
    await tick();   // laisse lancerConversion() capter les .docx puis démarrer la tâche

    // « make import » agit : les .docx disparaissent, les articles apparaissent. Le numéro
    // de tête n'existe plus que dans ce que le cockpit en a capté.
    fs.rmSync(path.join(MOTS, '3_Zebre.docx'));
    fs.rmSync(path.join(MOTS, '1_Alpha.docx'));
    fs.rmSync(path.join(MOTS, 'Sans_Numero.docx'));
    simulerArticleImporte('zebre', 'Zèbre');
    simulerArticleImporte('alpha', 'Alpha');
    simulerArticleImporte('sans-numero', 'Sans numéro');

    await HOTE.finirTache(NOM_IMPORT, 0);
    await tick();
    await HOTE.finirTache(NOM_BUILD, 0);
    await promesse;

    const texte = fs.readFileSync(AUSGABE, 'utf8');
    // alpha (1) avant zebre (3) : le numéro du Word décide. Le Word sans numéro vient à la
    // fin. Chaque dossier
    // reçoit le préfixe de son rang (02, 03, 04, après deux articles existants), pas le
    // numéro du Word.
    assert.match(texte,
      /^ordre-articles: \["01-essai", "02-sans-fiche", "02-alpha", "03-zebre", "04-sans-numero"\]$/m,
      'ordre-articles ne reprend pas le numéro de tête du Word, ou perturbe l’existant : ' + texte);
    assert.ok(fs.existsSync(path.join(REVUE, 'articles', '02-alpha', '02-alpha.md')),
      'le dossier « alpha » n’a pas été préfixé sur son rang');
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('import réel : un second lot s’ajoute en queue sans bousculer l’ordre déjà écrit', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
  try {
    const avant = fs.readFileSync(AUSGABE, 'utf8');
    assert.match(avant,
      /^ordre-articles: \["01-essai", "02-sans-fiche", "02-alpha", "03-zebre", "04-sans-numero"\]$/m,
      'l’ordre du contrôle précédent devrait encore être en place');

    fs.writeFileSync(path.join(MOTS, '9_Omega.docx'), Buffer.alloc(16));

    const promesse = HOTE.executer('szh.convertirEnAttente');
    await tick();
    fs.rmSync(path.join(MOTS, '9_Omega.docx'));
    simulerArticleImporte('omega', 'Oméga');

    await HOTE.finirTache(NOM_IMPORT, 0);
    await tick();
    await HOTE.finirTache(NOM_BUILD, 0);
    await promesse;

    const texte = fs.readFileSync(AUSGABE, 'utf8');
    // Le nouveau prend la dernière place sans rien déplacer, malgré son numéro (9). Cinq
    // articles le précèdent : son dossier prend « 05- ».
    assert.match(texte,
      /^ordre-articles: \["01-essai", "02-sans-fiche", "02-alpha", "03-zebre", "04-sans-numero", "05-omega"\]$/m,
      'un import ultérieur a bousculé l’ordre déjà établi : ' + texte);
    assert.ok(fs.existsSync(path.join(REVUE, 'articles', '05-omega', '05-omega.md')),
      'le dossier « omega » n’a pas été préfixé sur son rang');
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

// ---- La résolution d'un homonyme, en direct : pas besoin de l'hôte pour cette partie ----
//
// Deux Word différents peuvent partager le même slug une fois tronqué à 39 caractères
// (« … Teil 1 », « … Teil 2 ») : l'import leur donne « base » et « base-2 »
// (slugifierArticleUnique, la même boucle que le Makefile). resoudreNumeroOrdre() rend à
// chacun son propre numéro de tête, dans l'ordre de dépôt.
test('B1 : deux Word au même slug de base retrouvent chacun leur propre numéro', () => {
  const fournisseur = { racine: REVUE, _docxEnAttente: () => ['1_Alpha.docx', '2_Alpha.docx', '3_Beta.docx'] };
  const parBase = ext._pur.numerosOrdreEnAttente(fournisseur);
  assert.strictEqual(ext._pur.resoudreNumeroOrdre('alpha', parBase), 1,
    'le premier Word déposé devrait garder le slug de base et son numéro');
  assert.strictEqual(ext._pur.resoudreNumeroOrdre('alpha-2', parBase), 2,
    'l’homonyme suffixé « -2 » devrait retrouver le numéro du SECOND Word, pas le premier');
  assert.strictEqual(ext._pur.resoudreNumeroOrdre('beta', parBase), 3);
  // Un slug qui ne correspond à aucun Word en attente : null, comme un Word sans numéro.
  assert.strictEqual(ext._pur.resoudreNumeroOrdre('inconnu', parBase), null);
});

test('B1 : un Word sans numéro de tête ne fait planter ni le calcul ni le tri', () => {
  const fournisseur = { racine: REVUE, _docxEnAttente: () => ['Titre Libre.docx'] };
  const parBase = ext._pur.numerosOrdreEnAttente(fournisseur);
  assert.strictEqual(ext._pur.resoudreNumeroOrdre('titre-libre', parBase), null);
});
