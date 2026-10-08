// Deux comportements du cockpit :
//   - A1 : un clic sur l'édition des métadonnées ou des médias d'un article focalise
//     l'arbre sur lui (focaliserUnite, extension.js) et ferme l'aperçu, sans ouvrir le .md ;
//   - A3 : l'enregistrement de ces formulaires relance la compilation de l'article en tâche
//     de fond, sans rouvrir l'aperçu.
// Le pendant livre est dans focus-recompilation-livre.test.js : activerHote() n'admet qu'un
// appel par processus.
//
// A3 passe par le chemin de compilation unique (compilerPuisAfficher / relancerCompilation),
// sous la garde buildEnCours : deux fiches enregistrées d'un coup ne relancent qu'une
// compilation. compilerPuisAfficher(opts.sansAffichage) ne touche aucun panneau, ce
// qu'opposent les deux contrôles du milieu.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const ext = require(path.join(COCKPIT, 'extension.js'));

// activate() n'attend pas le démarrage asynchrone qui pose la racine (majContexte, dans
// demarrageInitial) : on la pose nous-mêmes, puis on laisse ses micro-tâches s'épuiser.
// Sans éditeur actif, ce démarrage se termine sans rien tenter.
HOTE.arbre().definirRacine(REVUE);

test('mise en route : le démarrage se tait', async () => {
  await demarrageSeTait(HOTE);
});

// ---- A1 : le focus suit le clic, dans les deux formulaires --------------------------

test('A1 : « Métadonnées » d’un article focalise l’arbre, aperçu fermé', async () => {
  const avant = HOTE.revelations.length;
  await HOTE.executer('szh.metadonneesArticle', { slug: '01-essai' });

  const revele = HOTE.revelations.slice(avant).pop();
  assert.ok(revele, 'aucun reveal() de l’arbre : le clic n’a pas focalisé l’article');
  assert.strictEqual(revele.element.slug, '01-essai');
  // Sans focus clavier : le formulaire qui vient de s’ouvrir le garde.
  assert.deepStrictEqual(revele.options, { select: true, focus: false });

  assert.ok(HOTE.panneauDeType('szhApercuMetadonnees'),
    'le formulaire des métadonnées ne s’est pas ouvert');
  assert.ok(!HOTE.panneauDeType('szhApercuHtml'),
    'l’aperçu est resté ouvert : A1 doit le fermer');
});

test('A1 : « Médias » d’un article focalise l’arbre, aperçu fermé', async () => {
  const avant = HOTE.revelations.length;
  await HOTE.executer('szh.mediasArticle', { slug: '01-essai' });

  const revele = HOTE.revelations.slice(avant).pop();
  assert.ok(revele, 'aucun reveal() de l’arbre : le clic n’a pas focalisé l’article');
  assert.strictEqual(revele.element.slug, '01-essai');
  assert.deepStrictEqual(revele.options, { select: true, focus: false });

  assert.ok(HOTE.panneauDeType('szhMedias'), 'le formulaire des médias ne s’est pas ouvert');
  assert.ok(!HOTE.panneauDeType('szhApercuHtml'),
    'l’aperçu est resté ouvert : A1 doit le fermer');
});

// ---- A3 : l’enregistrement relance la compilation, en tâche de fond -----------------

test('A3 : enregistrer une fiche relance la compilation, sans rouvrir l’aperçu', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD }]);
  const origExecute = HOTE.stub.tasks.executeTask;
  let appels = 0;
  HOTE.stub.tasks.executeTask = (t) => { appels++; return origExecute(t); };
  try {
    // Rouvre le panneau (unique) créé par le contrôle précédent : la webview passe par son
    // canal de messages pour « Enregistrer ».
    await HOTE.executer('szh.metadonneesArticle', { slug: '01-essai' });
    const panneau = HOTE.panneauDeType('szhApercuMetadonnees');
    assert.ok(panneau && panneau._recepteur,
      'le formulaire des métadonnées n’a pas de canal de messages');

    await panneau._recepteur({
      type: 'enregistrer', auto: false,
      articles: { '01-essai': { type: 'article', title: { fr: 'Titre modifié' } } }
    });
    await tick();

    assert.strictEqual(appels, 1, 'la compilation n’est pas repartie après l’enregistrement');
    assert.ok(HOTE.statutsDits('01-essai').length > 0,
      'la barre d’état ne dit pas la compilation en cours pour 01-essai');
    assert.ok(!HOTE.panneauDeType('szhApercuHtml'),
      'l’aperçu s’est rouvert avant même la fin de la compilation');

    await HOTE.finirTache(NOM_BUILD, 0);
    await tick();
    assert.ok(!HOTE.panneauDeType('szhApercuHtml'),
      'l’aperçu s’est rouvert à la fin de la compilation : A1 et A3 ne se combinent pas');

    const meta = fs.readFileSync(
      path.join(REVUE, 'articles', '01-essai', '01-essai.meta.yaml'), 'utf8');
    assert.ok(meta.indexOf('Titre modifié') !== -1, 'la fiche n’a pas été enregistrée sur le disque');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('A3 : deux fiches écrites d’un coup ne relancent qu’UNE compilation (garde buildEnCours)',
  async () => {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD }]);
    const origExecute = HOTE.stub.tasks.executeTask;
    let appels = 0;
    HOTE.stub.tasks.executeTask = (t) => { appels++; return origExecute(t); };
    try {
      const fournisseur = HOTE.arbre();
      const res = ext._pur.ecrireCartesArticles(fournisseur,
        { '01-essai': { type: 'article' }, '02-sans-fiche': { type: 'article' } }, null, {});
      assert.deepStrictEqual(res.ecrits.slice().sort(), ['01-essai', '02-sans-fiche'],
        'ecrireCartesArticles ne rend pas les slugs réellement écrits (res.ecrits)');

      ext._pur.relancerCompilationCartes(fournisseur, res);
      await tick();
      assert.strictEqual(appels, 1,
        'deux fiches écrites dans le même geste ont relancé deux compilations au lieu d’une '
        + '— un seul chemin de compilation, sous une seule garde (buildEnCours)');

      await HOTE.finirTache(NOM_BUILD, 0);
      await tick();
    } finally {
      HOTE.stub.tasks.executeTask = origExecute;
      HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    }
  });

// ---- Le chemin unique de compilation : sansAffichage ne touche à aucun panneau ------
//
// A1 ferme l'aperçu avant d'ouvrir les formulaires. Si un aperçu restait ouvert, A3 n'y
// touche pas : ni webview.html réassigné, ni panneau recréé. Les deux contrôles suivants
// comparent avec et sans sansAffichage.

test('compilerPuisAfficher(sansAffichage) : compile mais ne réassigne pas l’aperçu ouvert',
  async () => {
    const fournisseur = HOTE.arbre();
    const outDir = path.join(REVUE, 'out', '01-essai');
    fs.mkdirSync(outDir, { recursive: true });
    const apercu = path.join(outDir, '01-essai.apercu.html');
    fs.writeFileSync(apercu, '<html><body>ancien</body></html>');
    // Plus récent que le .md et la fiche : ouvrirArticle n’a rien à compiler et ouvre
    // l’aperçu directement (fetchTasks est vide par défaut).
    const futur = (Date.now() + 60000) / 1000;
    fs.utimesSync(apercu, futur, futur);

    await HOTE.executer('szh.ouvrirArticle', '01-essai');
    const panneau = HOTE.panneauDeType('szhApercuHtml');
    assert.ok(panneau, 'l’aperçu HTML ne s’est pas ouvert');
    const htmlAvant = panneau.html;

    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD }]);
    const origExecute = HOTE.stub.tasks.executeTask;
    try {
      const promesse = ext._pur.compilerPuisAfficher(fournisseur, '01-essai', { sansAffichage: true });
      await tick(); await tick();
      await HOTE.finirTache(NOM_BUILD, 0);
      await promesse;

      assert.strictEqual(HOTE.panneauDeType('szhApercuHtml'), panneau,
        'un nouveau panneau d’aperçu est apparu malgré sansAffichage');
      assert.strictEqual(panneau.html, htmlAvant,
        'le contenu de l’aperçu a été réassigné malgré sansAffichage : le focus aurait bougé');
    } finally {
      HOTE.stub.tasks.executeTask = origExecute;
      HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    }
  });

test('témoin : sans sansAffichage, la même compilation réassigne l’aperçu — '
  + 'le contrôle précédent est donc probant', async () => {
  const fournisseur = HOTE.arbre();
  const panneau = HOTE.panneauDeType('szhApercuHtml');
  assert.ok(panneau, 'l’aperçu HTML n’est plus là pour ce témoin');
  const htmlAvant = panneau.html;

  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD }]);
  const origExecute = HOTE.stub.tasks.executeTask;
  try {
    const promesse = ext._pur.compilerPuisAfficher(fournisseur, '01-essai');
    await tick(); await tick();
    await HOTE.finirTache(NOM_BUILD, 0);
    await promesse;

    assert.notStrictEqual(panneau.html, htmlAvant,
      'sans sansAffichage, la fin de la compilation devrait réassigner l’aperçu (nonce neuf) '
      + '— sinon le contrôle précédent ne prouverait rien');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

// ---- A1 bis : focaliser, c'est aussi désigner ------------------------------------------
//
// Ces deux formulaires n'ouvrent pas de .md, mais ils font de l'article l'« article
// courant » : Ctrl+Alt+P, la barre d'état et la compilation le visent ensuite.

const session = require(path.join(COCKPIT, 'lib', 'session.js'));

test('A1 bis : « Métadonnées » désigne l’article, sans rien afficher', async () => {
  session.poserApercuCourantSlug('02-sans-fiche');
  const panneauxAvant = HOTE.panneaux.length;
  await HOTE.executer('szh.metadonneesArticle', { slug: '01-essai' });
  assert.strictEqual(session.apercuCourantSlug(), '01-essai',
    'l’aperçu parlerait encore de l’article précédent');
  // Aucun aperçu n'est créé. On compte les panneaux créés pendant l'appel : panneauDeType()
  // rend aussi ceux des contrôles précédents.
  const nes = HOTE.panneaux.slice(panneauxAvant).map((x) => x.type);
  assert.deepStrictEqual(nes.filter((t) => t === 'szhApercuHtml'), [],
    'un aperçu s’est ouvert : la désignation doit rester muette');
});

test('A1 bis : « Médias » désigne l’article de la même façon', async () => {
  session.poserApercuCourantSlug('02-sans-fiche');
  await HOTE.executer('szh.mediasArticle', { slug: '01-essai' });
  assert.strictEqual(session.apercuCourantSlug(), '01-essai');
});

// ---- « Markdown » : le texte de l'article à droite de sa fiche -------------------------
//
// L'état de l'interrupteur se relit dans les onglets plutôt qu'en mémoire, car un onglet se
// ferme aussi à la croix. La page ne décide de rien.

test('Markdown : le texte s’ouvre en colonne 2, la fiche garde la main', async () => {
  await HOTE.executer('szh.metadonneesArticle', { slug: '01-essai' });
  const p = HOTE.panneauDeType('szhApercuMetadonnees');
  assert.ok(p, 'le formulaire des métadonnées ne s’est pas ouvert');
  HOTE.poserOnglets([]);
  HOTE.oublierCommandes();
  p.messages.length = 0;

  await p._recepteur({ type: 'markdown', slug: '01-essai' });

  const ouverture = HOTE.commandesJouees().find((c) => c.id === 'vscode.open');
  assert.ok(ouverture, 'le texte de l’article n’a pas été ouvert');
  assert.strictEqual(ouverture.args[0].fsPath,
    path.join(REVUE, 'articles', '01-essai', '01-essai.md'));
  assert.strictEqual(ouverture.args[1].viewColumn, 2, 'le texte doit s’ouvrir À DROITE de la fiche');
  assert.strictEqual(ouverture.args[1].preserveFocus, true,
    'le curseur a quitté la fiche : on y saisissait un champ');
  const reponse = p.messages.filter((m) => m.type === 'markdown').pop();
  assert.ok(reponse && reponse.visible === true, 'la page n’a pas appris que le texte est là');
});

test('Markdown : le second appui referme, et l’état vient des onglets', async () => {
  const p = HOTE.panneauDeType('szhApercuMetadonnees');
  // L'onglet existe : c'est lui que l'hôte relit, et non un drapeau.
  HOTE.poserOnglets([{ uri: { fsPath: path.join(REVUE, 'articles', '01-essai', '01-essai.md') } }]);
  HOTE.oublierFermetures();
  HOTE.oublierCommandes();
  p.messages.length = 0;

  await p._recepteur({ type: 'markdown', slug: '01-essai' });

  assert.strictEqual(HOTE.fermetures().length, 1, 'l’onglet n’a pas été fermé');
  assert.ok(!HOTE.commandesJouees().some((c) => c.id === 'vscode.open'),
    'le texte a été rouvert au lieu d’être refermé');
  const reponse = p.messages.filter((m) => m.type === 'markdown').pop();
  assert.strictEqual(reponse.visible, false);
  HOTE.poserOnglets([]);
});

test('Markdown : hors article, rien ne s’ouvre et le bouton reste éteint', async () => {
  const p = HOTE.panneauDeType('szhApercuMetadonnees');
  // Quand la fiche est filtrée sur un article, un slug inconnu retombe sur lui : le refus
  // ne se voit qu'en vue complète.
  await p._recepteur({ type: 'tous' });
  HOTE.poserOnglets([]);
  HOTE.oublierCommandes();
  p.messages.length = 0;

  await p._recepteur({ type: 'markdown', slug: 'article-qui-n-existe-pas' });

  const reponse = p.messages.filter((m) => m.type === 'markdown').pop();
  assert.strictEqual(reponse.visible, false);
  assert.ok(reponse.message, 'aucune explication : le clic aurait l’air cassé');
});
