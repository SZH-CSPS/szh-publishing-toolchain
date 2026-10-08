// L'import guidé par la commande, vu de l'hôte, sur tout son circuit : le dépôt d'un .docx
// (bouton ou glisser-déposer), la tâche d'import lancée par la commande, puis le
// rafraîchissement de l'arbre et l'ouverture de la vérification d'import. Le calcul de
// l'ordre est vérifié par import-ordre.test.js.
//
//   node --test test/js/import-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const LF = String.fromCharCode(10);
const NOM_IMPORT = 'Importer les articles Word';
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
HOTE.arbre().definirRacine(REVUE);
const MOTS = path.join(REVUE, 'articles-word');

test('mise en route : le démarrage se tait', async () => {
  await demarrageSeTait(HOTE);
  // revueDEssai() dépose déjà un Word en attente (9_Essai.docx) : on le retire.
  fs.rmSync(path.join(MOTS, '9_Essai.docx'), { force: true });
});

// Ce que « make import » aurait produit pour un .docx donné : un article minimal, sans
// pandoc. lancerConversion() ne compare que les slugs avant et après : un dossier avec un
// .md suffit à faire un article « nouveau ». Même fixture que import-ordre.test.js.
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

    // L'arbre liste le nouvel article sous « 02-nouveau » : le dossier reçoit le préfixe de
    // son rang dans l'ordre, après 01-essai et 02-sans-fiche (prefixerNouveauxArticles,
    // lib/import-hote.js).
    assert.ok(HOTE.arbre().listerArticles().indexOf('02-nouveau') !== -1,
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
  // Le slug porte le préfixe pris à l'import : la vérification parle du dossier réel.
  const article = valeurs.articles.find((a) => a.slug === '02-nouveau');
  assert.ok(article, 'l’article importé n’apparaît pas dans la vérification d’import');
  assert.strictEqual(article.valeurs.title && article.valeurs.title.fr, 'Article nouveau');
});

// ---- Un import qui ne ramène rien n’ouvre pas la vérification, mais rafraîchit quand même ----

test('un import qui ne ramène aucun article ne rouvre pas la vérification d’import', async () => {
  // Ferme celle du contrôle précédent : le panneau est un singleton, sa présence ne
  // prouverait rien sur ce geste-ci.
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

test('glisser un .odt sur l’arbre le copie dans le dépôt Word puis lance l’import', async () => {
  // Un .odt suit le même circuit qu'un .docx (import-docx.sh le convertit à la volée,
  // voir pipeline/conversion_odt.py).
  const controleur = HOTE.controleurDepot();
  const source = path.join(REVUE, 'Depose_a_la_main.odt');
  fs.writeFileSync(source, Buffer.alloc(16));

  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }]);
  try {
    const promesse = controleur.handleDrop(null, fauxDataTransferDocx([source]));
    await tick(); await tick();

    assert.ok(fs.existsSync(path.join(MOTS, 'Depose_a_la_main.odt')),
      'le .odt glissé n’a pas été copié dans le dépôt Word (articles-word/)');

    await HOTE.finirTache(NOM_IMPORT, 0);
    await promesse;
  } finally {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    fs.rmSync(source, { force: true });
  }
});

test('un .odt en attente apparaît dans la liste « Word » de l’arbre', async () => {
  // _docxEnAttente() (extension.js) voit aussi les .odt d'articles-word/.
  const source = path.join(MOTS, 'Depose-arbre.odt');
  fs.writeFileSync(source, Buffer.alloc(16));
  try {
    const arbre = HOTE.arbre();
    const racine = await arbre.getChildren();
    const sectionWord = racine.find((it) => it.contextValue === 'section-word');
    assert.ok(sectionWord, 'section Word introuvable dans l’arbre');
    const items = await arbre.getChildren(sectionWord);
    assert.ok(items.some((it) => it.label === 'Depose-arbre.odt'),
      'le .odt déposé dans articles-word/ n’apparaît pas dans la liste « Word en attente »');
  } finally {
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

// ---- Le redépôt d'un Word dont l'article existe : l'import l'ignore, le réimport le prend ----

const { T } = require(path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'lib', 'i18n.js'));

// Lance l'import, le termine sans rien ramener, et rend ce que showInformationMessage a dit.
async function importerSansNouveau(reponse) {
  const infos = [];
  const origine = HOTE.stub.window.showInformationMessage;
  HOTE.stub.window.showInformationMessage = (m, ...boutons) => {
    infos.push({ message: m, boutons: boutons.map(String) });
    return Promise.resolve(reponse);
  };
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }]);
  HOTE.oublierCommandes();
  try {
    const promesse = HOTE.executer('szh.convertirEnAttente');
    await tick(); await tick();
    await HOTE.finirTache(NOM_IMPORT, 0);
    await promesse;
    for (let i = 0; i < 5; i++) { await tick(); }
  } finally {
    HOTE.stub.window.showInformationMessage = origine;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
  return infos;
}

test('redépôt d’un Word dont l’article existe : « Réimporter » mène au réimport de cet article', async () => {
  const word = path.join(MOTS, '1_Essai.docx');
  fs.writeFileSync(word, Buffer.alloc(16));
  HOTE.modales.length = 0;
  try {
    const infos = await importerSansNouveau(T('cmd.reimporter.court'));
    assert.deepStrictEqual(infos, [{ message: T('info.importes.corrige', ['01-essai']),
      boutons: [T('cmd.reimporter.court')] }]);
    const jouees = HOTE.commandesJouees().filter((c) => c.id === 'szh.reimporterArticle');
    assert.deepStrictEqual(jouees.map((c) => c.args),
      [[{ word: '1_Essai.docx', slug: '01-essai' }]],
      'le bouton doit lancer le réimport de cet article avec ce Word');
    // Jusqu'à la confirmation : le drapeau d'import est bien retombé avant le réimport.
    assert.deepStrictEqual(HOTE.modales.map((m) => m.message),
      [T('modale.reimport.question', ['01-essai'])]);
  } finally {
    fs.rmSync(word, { force: true });
  }
});

test('plusieurs Word redéposés : le message d’avant, et « Réimporter… » ouvre la vue Word', async () => {
  const mots = [path.join(MOTS, '1_Essai.docx'), path.join(MOTS, '3_Nouveau.docx')];
  for (const m of mots) { fs.writeFileSync(m, Buffer.alloc(16)); }
  try {
    const infos = await importerSansNouveau(T('info.importes.reimporterPlusieurs'));
    assert.deepStrictEqual(infos, [{ message: T('info.importes.aucun'),
      boutons: [T('info.importes.reimporterPlusieurs')] }]);
    assert.ok(HOTE.commandesJouees().some((c) => c.id === 'szh.vueWord'),
      '« Réimporter… » doit ouvrir la vue Word');
  } finally {
    for (const m of mots) { fs.rmSync(m, { force: true }); }
  }
});
