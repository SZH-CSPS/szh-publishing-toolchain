// L'import guidé par la commande, vu de l'hôte : import-ordre.test.js éprouve déjà le
// calcul de l'ordre (ordre-articles) une fois l'import fait, mais aucun test ne suivait le
// CIRCUIT complet — le dépôt d'un .docx (bouton ou glisser-déposer), la tâche d'import
// lancée par la commande, et ce que sa fin déclenche : le rafraîchissement de l'arbre et
// l'ouverture de la vérification d'import. Écrit AVANT tout déplacement de code vers
// lib/import-hote.js : ce fichier doit rester vert, sans y toucher, une fois le
// découpage fait.
//
//   node --test test/js/import-hote.test.js
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

test('mise en route : le démarrage se tait', async () => {
  for (let i = 0; i < 30; i++) { await tick(); }
  HOTE.erreurs.length = 0;
  HOTE.avertissements.length = 0;
  // Le fixture de revueDEssai() dépose déjà un Word en attente (9_Essai.docx, pour les
  // contrôles de l'arbre) : on le retire pour garder la main sur le dépôt de ce fichier.
  fs.rmSync(path.join(MOTS, '9_Essai.docx'), { force: true });
});

// Ce que « make import » aurait produit pour un .docx donné : un article minimal, sans
// passer par la vraie chaîne pandoc — hors de portée d'un contrôle Node. lancerConversion()
// ne regarde que la liste des slugs avant/après (voir son commentaire dans extension.js) :
// un dossier avec un .md suffit à le faire apparaître comme « nouveau ». Même fixture que
// import-ordre.test.js.
function simulerArticleImporte(slug, titre) {
  const dossier = path.join(REVUE, 'articles', slug);
  fs.mkdirSync(path.join(dossier, 'media'), { recursive: true });
  fs.writeFileSync(path.join(dossier, slug + '.md'), 'Texte importé.' + LF);
  fs.writeFileSync(path.join(dossier, slug + '.meta.yaml'),
    ['type: article', 'title:', '  fr: "' + titre + '"', ''].join(LF));
}

// ---- Circuit complet : commande d'import -> tâche -> rafraîchissement + vérification ----

test('lancer l’import : la commande démarre bien LA tâche d’import nommée', async () => {
  fs.writeFileSync(path.join(MOTS, '5_Nouveau.docx'), Buffer.alloc(16));
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
  const origExecute = HOTE.stub.tasks.executeTask;
  const lancees = [];
  HOTE.stub.tasks.executeTask = (t) => { lancees.push(t.name); return origExecute(t); };
  try {
    const promesse = HOTE.executer('szh.convertirEnAttente');
    await tick(); await tick();

    assert.deepStrictEqual(lancees, [NOM_IMPORT],
      'la commande d’import doit démarrer LA tâche d’import, et elle seule, pour l’instant');
    assert.ok(HOTE.statutsDits('import').length > 0 || HOTE.statutsDits('Import').length > 0,
      'la barre d’état ne dit rien pendant l’import');

    // « make import » aurait converti le .docx et l'aurait supprimé du dépôt.
    fs.rmSync(path.join(MOTS, '5_Nouveau.docx'));
    simulerArticleImporte('nouveau', 'Article nouveau');

    await HOTE.finirTache(NOM_IMPORT, 0);
    await tick();

    // La compilation qui suit un import ayant ramené du neuf (compilerApresImport).
    assert.deepStrictEqual(lancees, [NOM_IMPORT, NOM_BUILD],
      'un import qui ramène un nouvel article doit enchaîner sur la tâche de compilation');
    await HOTE.finirTache(NOM_BUILD, 0);
    await promesse;

    // Rafraîchi : le nouvel article est maintenant listé par l'arbre.
    assert.ok(HOTE.arbre().listerArticles().indexOf('nouveau') !== -1,
      'l’arbre n’a pas été rafraîchi après l’import : le nouvel article est invisible');

    // Et la vérification d'import s'est ouverte, puisqu'il y avait un nouvel article.
    const panneau = HOTE.panneauDeType('szhImportVerif');
    assert.ok(panneau, 'la vérification d’import ne s’est pas ouverte après un import fructueux');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('la vérification d’import montre le nouvel article, avec son titre', async () => {
  const panneau = HOTE.panneauDeType('szhImportVerif');
  assert.ok(panneau && panneau._recepteur, 'la vérification d’import n’a pas de canal de messages');
  await panneau._recepteur({ type: 'pret' });
  const valeurs = panneau.messages.slice().reverse().find((m) => m.type === 'valeurs');
  assert.ok(valeurs, 'aucun message « valeurs » envoyé à la vérification d’import');
  const article = valeurs.articles.find((a) => a.slug === 'nouveau');
  assert.ok(article, 'l’article importé n’apparaît pas dans la vérification d’import');
  assert.strictEqual(article.valeurs.title && article.valeurs.title.fr, 'Article nouveau');
});

// ---- Un import qui ne ramène rien n’ouvre pas la vérification, mais rafraîchit quand même ----

test('un import qui ne ramène aucun article ne rouvre pas la vérification d’import', async () => {
  // Fermer celle du contrôle précédent : sinon sa seule présence (singleton, jamais
  // recréé) ne prouverait rien sur CE geste-ci.
  const avant = HOTE.panneauDeType('szhImportVerif');
  let ferme = false;
  const disposeOrigine = avant.dispose.bind(avant);
  avant.dispose = () => { ferme = true; disposeOrigine(); };
  avant.dispose();
  assert.ok(ferme);

  fs.writeFileSync(path.join(MOTS, '6_Vide.docx'), Buffer.alloc(16));
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }]);
  try {
    const promesse = HOTE.executer('szh.convertirEnAttente');
    await tick(); await tick();
    // « make import » échoue à convertir ce Word-ci : rien de neuf, le fichier reste.
    await HOTE.finirTache(NOM_IMPORT, 0);
    await promesse;

    assert.ok(!HOTE.panneauDeType('szhImportVerif') || HOTE.panneauDeType('szhImportVerif') === avant,
      'aucun nouveau panneau de vérification d’import ne devrait apparaître sans article neuf');
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    fs.rmSync(path.join(MOTS, '6_Vide.docx'), { force: true });
  }
});

// ---- Le dépôt par glisser-déposer sur l'arbre (controleurDepotVue) --------------------

function fauxDataTransferDocx(chemins) {
  const lignes = chemins.map((c) => 'file://' + c).join('\r\n');
  return { get: (type) => (type === 'text/uri-list' ? { asString: () => Promise.resolve(lignes) } : null) };
}

test('glisser un .docx sur l’arbre le copie dans le dépôt Word puis lance l’import', async () => {
  const controleur = HOTE.controleurDepot();
  assert.ok(controleur && typeof controleur.handleDrop === 'function',
    'aucun dragAndDropController posé sur la TreeView (controleurDepotVue)');
  assert.deepStrictEqual(controleur.dropMimeTypes, ['text/uri-list']);

  const source = path.join(REVUE, 'Depose_a_la_main.docx');
  fs.writeFileSync(source, Buffer.alloc(16));

  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }]);
  try {
    const promesse = controleur.handleDrop(null, fauxDataTransferDocx([source]));
    await tick(); await tick();

    assert.ok(fs.existsSync(path.join(MOTS, 'Depose_a_la_main.docx')),
      'le .docx glissé n’a pas été copié dans le dépôt Word (articles-word/)');

    await HOTE.finirTache(NOM_IMPORT, 0);
    await promesse;
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    fs.rmSync(source, { force: true });
  }
});

test('glisser un fichier qui n’est pas un .docx ne déclenche aucun import', async () => {
  const controleur = HOTE.controleurDepot();
  const source = path.join(REVUE, 'notice.pdf');
  fs.writeFileSync(source, Buffer.alloc(8));
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }]);
  const origExecute = HOTE.stub.tasks.executeTask;
  let appels = 0;
  HOTE.stub.tasks.executeTask = (t) => { appels++; return origExecute(t); };
  try {
    await controleur.handleDrop(null, fauxDataTransferDocx([source]));
    await tick();
    assert.strictEqual(appels, 0, 'un fichier non-.docx a quand même déclenché une tâche d’import');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    fs.rmSync(source, { force: true });
  }
});
