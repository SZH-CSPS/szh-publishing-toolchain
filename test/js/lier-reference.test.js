// « Lier un appel à une référence » (szh.lierReference) sur une bibliographie détachée.
//
//   node --test test/js
//
// L'import détache la bibliographie dans <slug>.biblio.md ; le .md de l'article ne porte
// que le marqueur ::: {.szh-biblio src="…"}. fmtLierReference() (lib/formatting.js) lit
// donc les références comme lib/export-ojs.js (lecteurReferences) : referencesDuFichier()
// d'abord, referencesDuTexte() seulement si le fichier détaché n'existe pas.
//
// Fichier à part : hote-factice.js n'admet qu'un appel à activerHote() par processus, et
// ancrages.test.js fait déjà le sien.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

process.env.SZH_LANGUE = 'fr';

test('lier une référence : bibliographie détachée, le geste retrouve quand même les entrées',
  async () => {
    const { revueDEssai, activerHote } = require('./hote-factice');
    const revue = revueDEssai();
    const hote = activerHote(revue);
    // L'hôte factice n'attend pas le démarrage asynchrone qui pose la racine.
    hote.arbre().definirRacine(revue);
    // demarrageInitial, que activate() n'attend pas, compile l'article de l'éditeur actif
    // s'il y en a un. Posé trop tôt, le faux éditeur déclencherait une tâche inconnue de
    // l'hôte factice (« err.tache » dans hote.erreurs) : on laisse le démarrage s'épuiser
    // d'abord.
    for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
    // Ce que le démarrage a pu dire (tutoriel…) est oublié : seuls comptent les messages de
    // la commande.
    hote.erreurs.length = 0;
    hote.avertissements.length = 0;

    // Le corps de l'article n'a pas de section de références : seul le fichier détaché
    // <slug>.biblio.md, écrit par revueDEssai() (« Dupont, A. (2024) », « Muller, B.
    // (2023) »), porte les entrées, comme pour un article importé.
    const article = path.join(revue, 'articles', '01-essai', '01-essai.md');
    const md = 'Un texte qui cite (Dupont, 2024) une fois.';
    const debut = md.indexOf('(Dupont, 2024)');
    const fin = debut + '(Dupont, 2024)'.length;

    let remplacement = null;
    hote.stub.window.activeTextEditor = {
      document: {
        uri: { fsPath: article },
        getText: (plage) => (plage ? md.slice(plage.start.character, plage.end.character) : md),
        lineAt: () => ({ text: md })
      },
      // Sélection posée directement sur l'appel, sans citations.plageDeLAppel().
      selection: {
        isEmpty: false,
        start: { line: 0, character: debut }, end: { line: 0, character: fin },
        active: { line: 0, character: debut }
      },
      edit: (f) => {
        f({ replace: (plage, texte) => { remplacement = texte; } });
        return Promise.resolve(true);
      }
    };
    let propose = null;
    hote.stub.window.showQuickPick = (items) => {
      propose = items;
      return Promise.resolve(items[0]);
    };

    await hote.executer('szh.lierReference');

    assert.ok(propose, 'aucun QuickPick proposé : la bibliographie détachée n’a pas été lue');
    // Les deux entrées du fichier détaché, dans l'ordre, avec les identifiants que la
    // compilation posera comme ancres.
    assert.deepStrictEqual(propose.map((i) => i.description),
      ['ref-dupont-2024', 'ref-muller-2023']);
    // Le lien markdown attendu est écrit, vers la première entrée choisie.
    assert.strictEqual(remplacement, '[(Dupont, 2024)](#ref-dupont-2024)');
    // Aucun message d'erreur ni d'information (sans le fichier détaché, ce serait
    // « cit.aucuneref »).
    assert.deepStrictEqual(hote.erreurs, []);
    assert.deepStrictEqual(hote.avertissements, []);
  });
