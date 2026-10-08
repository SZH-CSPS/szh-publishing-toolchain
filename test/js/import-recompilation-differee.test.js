// Pendant un import (`importEnCours`), compilerPuisAfficher() ne compile pas : le slug va
// dans compilationsDifferees, et rejouerCompilationsDifferees() le compile dès la fin de
// l'import, quel qu'en soit le résultat. compilerApresImport() ne joue que si l'import a
// ramené un article ; le rejeu couvre l'import qui ne ramène rien.
//
// Le geste complet, via l'hôte factice : un import qui ne ramène rien, l'enregistrement
// d'une fiche pendant ce temps, puis une compilation qui finit par partir.
//
//   node --test test/js/import-recompilation-differee.test.js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const NOM_IMPORT = 'Importer les articles Word';
const NOM_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);
const ext = require(path.join(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit', 'extension.js'));

HOTE.arbre().definirRacine(REVUE);

test('mise en route : le démarrage se tait', async () => {
  await demarrageSeTait(HOTE);
});

test('un enregistrement de fiche pendant un import qui ne ramène rien finit par recompiler',
  async () => {
    // Le Word en attente du fixture (9_Essai.docx) reste en place : « make import » rend 0
    // sans nouvel article, et lancerConversion() n'appelle pas compilerApresImport().
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

      // Pendant l'import, la fiche d'un article existant, sans rapport avec l'import, est
      // enregistrée.
      await HOTE.executer('szh.metadonneesArticle', { slug: '01-essai' });
      const panneau = HOTE.panneauDeType('szhApercuMetadonnees');
      assert.ok(panneau && panneau._recepteur,
        'le formulaire des métadonnées ne s’est pas ouvert pendant l’import');
      await panneau._recepteur({
        type: 'enregistrer', auto: false,
        articles: { '01-essai': { type: 'article', title: { fr: 'Titre pendant import' } } }
      });
      await tick();

      // La fiche est écrite sur le disque.
      const meta = fs.readFileSync(
        path.join(REVUE, 'articles', '01-essai', '01-essai.meta.yaml'), 'utf8');
      assert.ok(meta.indexOf('Titre pendant import') !== -1,
        'la fiche n’a pas été enregistrée sur le disque pendant l’import');

      // Aucune compilation tout de suite : compilerPuisAfficher attend la fin de l'import.
      assert.strictEqual(appelsBuild, 0,
        'une compilation est partie pendant l’import : ce n’est pas le scénario visé');

      // L'import se termine : code 0, aucun article nouveau.
      await HOTE.finirTache(NOM_IMPORT, 0);
      await promesseImport;
      await tick(); await tick();

      // La compilation différée est rejouée.
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
// Hors import, le même geste recompile immédiatement : le contrôle précédent mesure bien
// le différé.
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
