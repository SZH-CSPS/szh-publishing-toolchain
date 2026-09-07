// L'aperçu commutable HTML / PDF, vu de l'hôte : jusqu'ici seule la recompilation
// (focus-recompilation.test.js) et le rendu du fragment (webviews.test.js) étaient
// éprouvés — jamais le panneau lui-même, sa bascule, ni le défilement synchronisé entre
// l'éditeur et l'aperçu. Écrit AVANT tout déplacement de code vers lib/apercu.js : ce
// fichier doit rester vert, sans y toucher, une fois le découpage fait.
//
//   node --test test/js/apercu-hote.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const COCKPIT = path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');
const i18n = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
// Comme focus-recompilation.test.js : l'hôte factice n'attend pas le démarrage
// asynchrone qui pose la racine (majContexte, dans demarrageInitial) ; on la pose nous-
// mêmes pour agir tout de suite, puis on laisse les micro-tâches du démarrage s'épuiser.
HOTE.arbre().definirRacine(REVUE);

test('mise en route : le démarrage se tait', async () => {
  for (let i = 0; i < 30; i++) { await tick(); }
  HOTE.erreurs.length = 0;
  HOTE.avertissements.length = 0;
});

// Dépose un aperçu HTML déjà compilé, daté dans le futur : ouvrirArticle ne le juge pas
// obsolète et l'affiche directement, sans passer par une tâche de compilation — ce que ce
// fichier n'a pas à éprouver, focus-recompilation.test.js le fait déjà.
function ecrireApercuCompile(slug, corps) {
  const dossier = path.join(REVUE, 'out', slug);
  fs.mkdirSync(dossier, { recursive: true });
  const fichier = path.join(dossier, slug + '.apercu.html');
  fs.writeFileSync(fichier, '<!DOCTYPE html><html><head></head><body>' + corps + '</body></html>');
  const futur = (Date.now() + 60000) / 1000;
  fs.utimesSync(fichier, futur, futur);
  return fichier;
}

// Un éditeur minimal sur le .md d'un article, tel que editeurArticleCourant() le
// retrouve dans vscode.window.visibleTextEditors : seuls les champs lus par
// revelerLigneSource / pousserSurlignageVersApercu sont modélisés.
function fauxEditeurArticle(slug, lignes) {
  const md = path.join(REVUE, 'articles', slug, slug + '.md');
  const appels = [];
  const editeur = {
    document: {
      uri: HOTE.stub.Uri.file(md),
      lineCount: lignes.length,
      lineAt: (i) => ({ text: lignes[i] || '' })
    },
    selection: { active: new HOTE.stub.Position(0, 0) },
    revealRange: (range, kind) => { appels.push({ range: range, kind: kind }); }
  };
  return { editeur: editeur, appels: appels };
}

// ---- Ouverture de l'aperçu HTML : CSP et bandeau ------------------------------------

test('ouvrir un article dont l’aperçu est déjà compilé crée un panneau HTML avec la CSP et le bandeau', async () => {
  ecrireApercuCompile('01-essai', '<p>Contenu compilé</p>');
  await HOTE.executer('szh.ouvrirArticle', '01-essai');

  const panneau = HOTE.panneauDeType('szhApercuHtml');
  assert.ok(panneau, 'le panneau d’aperçu HTML ne s’est pas ouvert');
  assert.match(panneau.html, /font-src data:/,
    'la CSP injectée n’autorise pas les polices en data: — WeasyPrint/Pandoc en émettent');
  assert.ok(panneau.html.indexOf(i18n.TEXTES_COCKPIT.fr['apercu.bandeau']) !== -1,
    'le bandeau de l’aperçu (« cliquer un passage… ») est absent du HTML injecté');
  assert.ok(panneau.html.indexOf('Contenu compilé') !== -1,
    'le contenu compilé par pandoc n’est pas passé dans le panneau');
});

// ---- Bascule HTML <-> PDF -----------------------------------------------------------

test('basculer vers PDF ferme le panneau d’aperçu HTML', async () => {
  const panneauHtml = HOTE.panneauDeType('szhApercuHtml');
  assert.ok(panneauHtml, 'témoin manquant : le contrôle précédent n’a pas laissé de panneau ouvert');
  let ferme = false;
  const disposeOrigine = panneauHtml.dispose.bind(panneauHtml);
  panneauHtml.dispose = () => { ferme = true; disposeOrigine(); };

  await HOTE.executer('szh.basculerApercu');

  assert.ok(ferme, 'basculerApercu (html -> pdf) n’a pas fermé le panneau d’aperçu HTML');
});

test('rebasculer vers HTML rouvre un panneau (nouvel objet, l’ancien restait fermé)', async () => {
  await HOTE.executer('szh.basculerApercu');   // pdf -> html : apercuMode a été persisté
  const panneau = HOTE.panneauDeType('szhApercuHtml');
  assert.ok(panneau, 'rebasculer en HTML n’a pas rouvert de panneau');
  assert.ok(panneau.html.indexOf('Contenu compilé') !== -1,
    'le panneau rouvert ne montre pas le contenu compilé de 01-essai');
});

// ---- Défilement synchronisé : aperçu -> hôte (scrollSource) -------------------------

test('un message « scrollSource » de l’aperçu révèle la bonne ligne dans l’éditeur', async () => {
  const { editeur, appels } = fauxEditeurArticle('01-essai', ['a', 'b', 'c', 'd', 'e', 'f']);
  HOTE.stub.window.visibleTextEditors.push(editeur);
  try {
    const panneau = HOTE.panneauDeType('szhApercuHtml');
    assert.ok(panneau && panneau._recepteur, 'le panneau d’aperçu HTML n’a pas de canal de messages');

    await panneau._recepteur({ type: 'scrollSource', ligne: 5 });   // 1-based

    assert.strictEqual(appels.length, 1, 'revealRange n’a pas été appelé une fois');
    assert.strictEqual(appels[0].range.start.line, 4, 'la ligne révélée n’est pas la bonne (0-based)');
    assert.strictEqual(appels[0].kind, HOTE.stub.TextEditorRevealType.AtTop);
  } finally {
    HOTE.stub.window.visibleTextEditors.length = 0;
    // revelerLigneSource pose defilementProgrammatiqueHote (garde anti-boucle) pour 200ms :
    // les contrôles suivants, sur le sens inverse, ne doivent pas hériter de cette garde.
    await attendre(220);
  }
});

// ---- Défilement synchronisé : hôte -> aperçu (scroll), et surlignage ---------------

test('faire défiler l’éditeur pousse un message « scroll » à l’aperçu', async () => {
  const { editeur } = fauxEditeurArticle('01-essai', ['a', 'b', 'c']);
  HOTE.stub.window.visibleTextEditors.push(editeur);
  try {
    const panneau = HOTE.panneauDeType('szhApercuHtml');
    const avant = panneau.messages.length;

    HOTE.changerRangesVisibles(editeur, 7);   // 0-based
    await attendre(80);   // pousserDefilementVersApercu regroupe derrière un setTimeout(35)

    const recus = panneau.messages.slice(avant);
    assert.ok(recus.some((m) => m.type === 'scroll' && m.ligne === 8),
      'aucun message « scroll » (ligne 1-based 8) n’a été poussé vers l’aperçu : '
      + JSON.stringify(recus));
  } finally {
    HOTE.stub.window.visibleTextEditors.length = 0;
  }
});

test('déplacer le curseur pousse un message « surligner » (mot et ligne) à l’aperçu', async () => {
  const { editeur } = fauxEditeurArticle('01-essai', ['un deux trois']);
  editeur.selection = { active: new HOTE.stub.Position(0, 4) };   // sur « deux »
  HOTE.stub.window.visibleTextEditors.push(editeur);
  try {
    const panneau = HOTE.panneauDeType('szhApercuHtml');
    const avant = panneau.messages.length;

    HOTE.changerSelectionEditeur(editeur);
    await attendre(100);   // pousserSurlignageVersApercu regroupe derrière un setTimeout(60)

    const recus = panneau.messages.slice(avant);
    const surlignage = recus.find((m) => m.type === 'surligner');
    assert.ok(surlignage, 'aucun message « surligner » n’a été poussé vers l’aperçu : '
      + JSON.stringify(recus));
    assert.strictEqual(surlignage.ligne, 1, 'la ligne surlignée n’est pas la bonne (1-based)');
    assert.strictEqual(surlignage.mot, 'deux', 'le mot sous le curseur n’est pas le bon');
  } finally {
    HOTE.stub.window.visibleTextEditors.length = 0;
  }
});

// ---- Article sans aperçu compilé : page « indisponible », une seule relance --------

test('un article jamais compilé affiche la page « indisponible » et ne relance qu’UNE compilation',
  async () => {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD }]);
    const origExecute = HOTE.stub.tasks.executeTask;
    let appels = 0;
    HOTE.stub.tasks.executeTask = (t) => { appels++; return origExecute(t); };
    try {
      // 02-sans-fiche (fixture de revueDEssai()) n'a ni fiche ni out/ : jamais compilé.
      const promesse = HOTE.executer('szh.ouvrirArticle', '02-sans-fiche');
      await tick(); await tick();
      await HOTE.finirTache(NOM_BUILD, 0);   // la première compilation (obsolète -> lancerBuild)
      await promesse;

      const panneau = HOTE.panneauDeType('szhApercuHtml');
      assert.ok(panneau, 'le panneau d’aperçu HTML ne s’est pas ouvert');
      assert.ok(panneau.html.indexOf(i18n.TEXTES_COCKPIT.fr['apercu.indisponible']) !== -1,
        'la page « aperçu indisponible » ne s’affiche pas quand rien n’a jamais été compilé');
      assert.ok(panneau.html.indexOf(i18n.TEXTES_COCKPIT.fr['apercu.encours']) !== -1,
        'la page devrait dire qu’une compilation est en cours (enAttente)');

      // relancerCompilation() (appelée une fois par ouvrirArticle, faute d’aperçu prêt)
      // lance une SECONDE tâche, en tâche de fond : on la laisse aller à son terme sans
      // qu’une troisième ne reparte toute seule derrière.
      await tick(); await tick();
      assert.strictEqual(appels, 2,
        'ouvrirArticle doit lancer deux compilations au plus (celle du corps, puis la '
        + 'relance faute d’aperçu prêt) : ' + appels + ' appel(s) de tâche');
      await HOTE.finirTache(NOM_BUILD, 0);
      await tick(); await tick();
      assert.strictEqual(appels, 2,
        'une troisième compilation est repartie toute seule après la relance unique');
    } finally {
      HOTE.stub.tasks.executeTask = origExecute;
      HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    }
  });
