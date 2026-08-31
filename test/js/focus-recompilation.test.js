// Lot G2 : deux gestes du cockpit — A1 (le focus suit le clic sur l'édition des
// métadonnées ou des médias d'un article, aperçu fermé) et A3 (leur enregistrement relance
// la compilation de l'article, en tâche de fond, sans rouvrir l'aperçu qu'A1 vient de
// fermer). Le pendant livre (chapitres) est dans focus-recompilation-livre.test.js —
// activerHote() n'admet qu'un appel par processus.
//
//   node --test test/js/focus-recompilation.test.js
//
// Les trois acquis du projet que ce lot réutilise, plutôt que réinvente, et que ces
// contrôles vérifient :
//   - ouvrirArticle(fournisseur, slug, opts) et son opts.sansApercu existaient déjà ; A1
//     ajoute le focus de l'arbre à DEUX formulaires pleine page qui n'en avaient pas
//     besoin jusqu'ici (focaliserUnite, extension.js) — sans jamais ouvrir leur .md ni
//     leur aperçu, à la différence de ouvrirArticle.
//   - un seul chemin de compilation (compilerPuisAfficher / relancerCompilation), sous la
//     garde buildEnCours : A3 s'y raccroche au lieu d'en ouvrir un second — deux fiches
//     enregistrées d'un coup ne doivent relancer qu'UNE compilation.
//   - la garde d'interaction (lib/interaction.js) protège la fin d'une compilation contre
//     le vol de focus. A3 multiplie les déclenchements ; le contrôle décisif ici est que
//     compilerPuisAfficher(opts.sansAffichage) ne touche AUCUN panneau — il n'y a donc
//     rien à protéger sur ce chemin, ce que les deux derniers contrôles opposent.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const ext = require(path.join(COCKPIT, 'extension.js'));

// L'hôte factice n'attend pas le démarrage asynchrone qui pose la racine (majContexte,
// dans demarrageInitial, non attendu par activate() — voir lier-reference.test.js) : on la
// pose nous-mêmes, puis on laisse les micro-tâches de ce démarrage s'épuiser avant d'agir.
// Aucun éditeur actif n'est posé : cette chaîne se termine sans rien tenter.
HOTE.arbre().definirRacine(REVUE);

test('mise en route : le démarrage se tait', async () => {
  for (let i = 0; i < 30; i++) { await tick(); }
  HOTE.erreurs.length = 0;
  HOTE.avertissements.length = 0;
});

// ---- A1 : le focus suit le clic, dans les deux formulaires --------------------------

test('A1 : « Métadonnées » d’un article focalise l’arbre, aperçu fermé', async () => {
  const avant = HOTE.revelations.length;
  await HOTE.executer('szh.metadonneesArticle', { slug: '01-essai' });

  const revele = HOTE.revelations.slice(avant).pop();
  assert.ok(revele, 'aucun reveal() de l’arbre : le clic n’a pas focalisé l’article');
  assert.strictEqual(revele.element.slug, '01-essai');
  // Sans focus clavier : le formulaire qui vient de s’ouvrir garde la main (A1, comme le
  // suivi de ouvrirArticle).
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
    // Rouvre le panneau (singleton) déjà créé par le contrôle précédent : son canal de
    // messages est ce que la webview utiliserait pour un vrai « Enregistrer ».
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
// A1 ferme l'aperçu avant d'ouvrir les formulaires ; s'il en restait un ouvert (bascule
// faite entre-temps, ou tout futur appelant qui oublierait de fermer), A3 ne doit RIEN lui
// faire : ni webview.html réassigné, ni panneau recréé. Les deux contrôles qui suivent
// prouvent le comportement dans les deux sens — avec, puis sans, sansAffichage.

test('compilerPuisAfficher(sansAffichage) : compile mais ne réassigne pas l’aperçu ouvert',
  async () => {
    const fournisseur = HOTE.arbre();
    const outDir = path.join(REVUE, 'out', '01-essai');
    fs.mkdirSync(outDir, { recursive: true });
    const apercu = path.join(outDir, '01-essai.apercu.html');
    fs.writeFileSync(apercu, '<html><body>ancien</body></html>');
    // Plus récent que le .md et la fiche : ouvrirArticle n’a alors rien à compiler, et
    // ouvre l’aperçu directement — le bruit d’une compilation ratée (fetchTasks vide par
    // défaut) ne pollue pas ce contrôle.
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
