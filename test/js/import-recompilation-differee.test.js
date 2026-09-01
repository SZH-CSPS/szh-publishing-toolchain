// Revue adversariale (sept. 2026) : compilerPuisAfficher() décline en silence sous
// `importEnCours` (garde ligne ~2564, partagée avec `buildEnCours`) — mais rien ne
// rattrapait ensuite ce refus quand l'import ne ramenait aucun article. compilerApresImport()
// n'est appelée que dans la branche `nouveaux.length > 0` de lancerConversion() : un
// enregistrement de fiche PENDANT un import qui échoue ou qui ne convertit aucun Word
// laissait donc l'aperçu et le PDF de l'article édité périmés, sans aucun message, jusqu'à
// ce que quelqu'un rouvre cet article à la main.
//
// Le correctif (compilerPuisAfficher, lancerConversion, executerReimport dans extension.js) :
// un refus dû à importEnCours mémorise son slug dans compilationsDifferees, rejoué par
// rejouerCompilationsDifferees() dès que le drapeau retombe — quel que soit le résultat de
// l'import. Ce fichier rejoue le geste complet via l'hôte factice : import qui ne ramène
// rien, enregistrement d'une fiche PENDANT cette fenêtre, puis contrôle qu'une compilation
// finit bien par partir.
//
//   node --test test/js/import-recompilation-differee.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote } = require('./hote-factice');

const NOM_IMPORT = 'Importer les articles Word';
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const ext = require(path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'extension.js'));

HOTE.arbre().definirRacine(REVUE);

test('mise en route : le démarrage se tait', async () => {
  for (let i = 0; i < 30; i++) { await tick(); }
  HOTE.erreurs.length = 0;
  HOTE.avertissements.length = 0;
});

test('un enregistrement de fiche pendant un import qui ne ramène rien finit par recompiler',
  async () => {
    // Le Word en attente du fixture (9_Essai.docx) reste en place : « make import » tourne,
    // rend 0, mais ne fait apparaître AUCUN nouvel article — le cas courant que le défaut
    // visait (échec de conversion ou rien à convertir), et le seul où lancerConversion()
    // n'appelle jamais compilerApresImport().
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_IMPORT }, { name: NOM_BUILD }]);
    const origExecute = HOTE.stub.tasks.executeTask;
    let appelsBuild = 0;
    HOTE.stub.tasks.executeTask = (t) => {
      if (t && t.name === NOM_BUILD) { appelsBuild++; }
      return origExecute(t);
    };
    try {
      const promesseImport = HOTE.executer('szh.convertirEnAttente');
      // Laisse lancerConversion() capter la liste « avant », puis lancer et attendre la
      // tâche d'import — sans quoi importEnCours ne serait pas encore posé.
      await tick(); await tick();

      // Pendant cette fenêtre : l'utilisateur enregistre la fiche d'un article existant,
      // SANS RAPPORT avec l'import — le geste rapporté.
      await HOTE.executer('szh.metadonneesArticle', { slug: '01-essai' });
      const panneau = HOTE.panneauDeType('szhApercuMetadonnees');
      assert.ok(panneau && panneau._recepteur,
        'le formulaire des métadonnées ne s’est pas ouvert pendant l’import');
      await panneau._recepteur({
        type: 'enregistrer', auto: false,
        articles: { '01-essai': { type: 'article', title: { fr: 'Titre pendant import' } } }
      });
      await tick();

      // La fiche s'écrit bien sur le disque — ce n'est pas ce que le défaut cassait.
      const meta = fs.readFileSync(
        path.join(REVUE, 'articles', '01-essai', '01-essai.meta.yaml'), 'utf8');
      assert.ok(meta.indexOf('Titre pendant import') !== -1,
        'la fiche n’a pas été enregistrée sur le disque pendant l’import');

      // Mais pas de compilation lancée tout de suite : compilerPuisAfficher a décliné sous
      // importEnCours (jamais deux compilations à la fois pendant un import).
      assert.strictEqual(appelsBuild, 0,
        'une compilation est partie pendant l’import : ce n’est pas le scénario visé');

      // L'import se termine : code 0, mais 0 article nouveau (nouveaux.length === 0) —
      // la branche qui, avant le correctif, n'appelait jamais compilerApresImport().
      await HOTE.finirTache(NOM_IMPORT, 0);
      await promesseImport;
      await tick(); await tick();

      // LE CONTRÔLE DÉCISIF : la compilation refusée doit être rejouée. Sans le correctif,
      // appelsBuild reste à 0 pour toujours et l'aperçu/PDF de 01-essai restent périmés en
      // silence, jusqu'à ce que quelqu'un rouvre l'article à la main.
      assert.strictEqual(appelsBuild, 1,
        'la compilation déclinée pendant l’import n’a jamais été rejouée : la fiche '
        + 'enregistrée reste périmée en silence — le défaut de la revue adversariale');

      await HOTE.finirTache(NOM_BUILD, 0);
      await tick();
      assert.strictEqual(appelsBuild, 1, 'un seul rejeu attendu pour un seul slug différé');
    } finally {
      HOTE.stub.tasks.executeTask = origExecute;
      HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    }
  });

// ---- Témoin : sans fenêtre d'import, rien n'est différé, la compilation part tout de suite -
//
// Preuve que le contrôle précédent est bien discriminant : hors de toute fenêtre d'import,
// le même geste (enregistrer une fiche) recompile IMMÉDIATEMENT, sans attendre un rejeu.
test('témoin : hors import, l’enregistrement recompile tout de suite, sans rejeu différé',
  async () => {
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_BUILD }]);
    const origExecute = HOTE.stub.tasks.executeTask;
    let appelsBuild = 0;
    HOTE.stub.tasks.executeTask = (t) => { appelsBuild++; return origExecute(t); };
    try {
      const panneau = HOTE.panneauDeType('szhApercuMetadonnees');
      assert.ok(panneau && panneau._recepteur, 'le formulaire des métadonnées a disparu');
      await panneau._recepteur({
        type: 'enregistrer', auto: false,
        articles: { '01-essai': { type: 'article', title: { fr: 'Titre hors import' } } }
      });
      await tick();

      assert.strictEqual(appelsBuild, 1,
        'hors import, l’enregistrement devrait recompiler tout de suite — sinon le contrôle '
        + 'précédent ne prouve pas ce qu’il prétend');

      await HOTE.finirTache(NOM_BUILD, 0);
      await tick();
    } finally {
      HOTE.stub.tasks.executeTask = origExecute;
      HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    }
  });
