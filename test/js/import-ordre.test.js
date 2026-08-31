// B1 (26.08.2026, demande de Robin) : le numéro de tête d'un Word ne nomme plus le dossier
// — il ne survivait pas à un déplacement dans l'ordre (lib/slug.js). Il migre à la place
// vers `ordre-articles` (ou `ordre-chapitres` sur un livre), la même clé que « Monter » /
// « Descendre » modifient déjà.
//
//   node --test test/js/import-ordre.test.js
//
// Un test « ordre du rédacteur » existait déjà dans contrats.test.js, mais il n'éprouvait
// que numeroOrdreArticle() et un tri fait à la main — jamais le chemin réel de l'import. Ce
// fichier ferme cet écart : des .docx numérotés déposés dans articles-word/, l'import joué
// par la commande réelle (szh.convertirEnAttente) via l'hôte factice, et ordre-articles lu
// sur le disque à l'arrivée. C'est la seule preuve qui compte : sans le câblage dans
// lancerConversion() (extension.js), ce contrôle échoue même si numeroOrdreArticle() est
// juste, puisque rien n'appelait cette fonction avant.
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

// Le fixture de revueDEssai() dépose déjà un Word en attente (9_Essai.docx, pour les
// contrôles de l'arbre) : on le retire pour garder la main sur le dépôt de ce contrôle.
fs.rmSync(path.join(MOTS, '9_Essai.docx'), { force: true });

// Ce que « make import » aurait produit pour un .docx donné : un article minimal, sans
// passer par la vraie chaîne pandoc — hors de portée d'un contrôle Node. lancerConversion()
// ne regarde que la liste des slugs avant/après (voir son commentaire dans extension.js) :
// un dossier avec un .md suffit à le faire apparaître comme « nouveau ».
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
    // Trois Word : deux numérotés dans un ordre qui contredit l'alphabet des titres (« zebre »
    // devrait passer APRÈS « alpha » si on suit le numéro, alors que l'alphabet des slugs
    // les rangerait avant), et un troisième sans numéro de tête.
    fs.writeFileSync(path.join(MOTS, '3_Zebre.docx'), Buffer.alloc(16));
    fs.writeFileSync(path.join(MOTS, '1_Alpha.docx'), Buffer.alloc(16));
    fs.writeFileSync(path.join(MOTS, 'Sans_Numero.docx'), Buffer.alloc(16));

    const promesse = HOTE.executer('szh.convertirEnAttente');
    await tick();   // laisse lancerConversion() capter les .docx puis démarrer la tâche

    // Le moment où « make import » aurait agi : les .docx disparaissent, les articles
    // apparaissent. C'est APRÈS ce point que le numéro de tête n'existe plus nulle part
    // ailleurs que dans ce que le cockpit en a déjà capté.
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
    // alpha (1) avant zebre (3) : l'ordre du Word l'emporte sur l'ordre alphabétique des
    // slugs, qui les aurait rangés zebre avant alpha (repli de _sousDossiersAvecMd). Le Word
    // sans numéro de tête suit, à la fin — il n'a pas de rang à faire valoir.
    assert.match(texte, /^ordre-articles: \["01-essai", "02-sans-fiche", "alpha", "zebre", "sans-numero"\]$/m,
      'ordre-articles ne reprend pas le numéro de tête du Word, ou perturbe l’existant : ' + texte);
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('import réel : un second lot s’ajoute en queue sans bousculer l’ordre déjà écrit', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
  try {
    const avant = fs.readFileSync(AUSGABE, 'utf8');
    assert.match(avant, /^ordre-articles: \["01-essai", "02-sans-fiche", "alpha", "zebre", "sans-numero"\]$/m,
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
    // Le nouveau prend la queue, et RIEN d'autre ne bouge — ni son numéro (9) ni le fait
    // qu'il vient après un article sans DOI ne lui donnent le droit de se glisser plus tôt.
    assert.match(texte,
      /^ordre-articles: \["01-essai", "02-sans-fiche", "alpha", "zebre", "sans-numero", "omega"\]$/m,
      'un import ultérieur a bousculé l’ordre déjà établi : ' + texte);
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

// ---- La résolution d'un homonyme, en direct : pas besoin de l'hôte pour cette partie ----
//
// Deux Word différents peuvent partager le même slug de base une fois tronqué à 39
// caractères (« … Teil 1 », « … Teil 2 ») : l'import leur donne alors « base » et
// « base-2 » (slugifierArticleUnique, la même boucle que le Makefile). Chacun garde
// pourtant son PROPRE numéro de tête, et resoudreNumeroOrdre() doit les rendre dans l'ordre
// où ils ont été déposés (FIFO), pas les confondre.
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
