// « Lier un appel à une référence » (szh.lierReference) sur une bibliographie détachée.
//
//   node --test test/js
//
// Pourquoi ce fichier. Depuis que l'import détache la bibliographie dans un fichier
// <slug>.biblio.md, le .md de l'article ne porte plus que le marqueur
// ::: {.szh-biblio src="…"} — les références en sont parties. fmtLierReference()
// (lib/formatting.js) n'appelait que citations.referencesDuTexte(doc.getText()), qui
// cherche les entrées DANS le corps : sur tout article au format courant, elle ne
// trouvait donc plus rien, et la commande répondait « Aucune liste de références
// trouvée » à chaque appel. Le repli reproduit celui, déjà éprouvé, de
// lib/export-ojs.js (lecteurReferences) : referencesDuFichier() d'abord,
// referencesDuTexte() seulement si le fichier détaché n'existe pas.
//
// Dans son propre fichier plutôt que dans test/js/ancrages.test.js : hote-factice.js
// n'admet qu'un seul appel à activerHote() par processus (le crochet de Module._load ne
// se défait pas), et ancrages.test.js en fait déjà un, en dernière position.
// `node --test` donne un processus par fichier, ce qui suffit ici aussi.
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
    // Le démarrage de l'hôte lance sa propre chaîne asynchrone (demarrageInitial, non
    // attendue par activate()) : réveil WSL simulé, puis, SI un éditeur d'article est déjà
    // actif, ouverture et compilation automatiques de cet article. Tant qu'aucun éditeur
    // actif n'est posé, cette chaîne se termine sans rien faire — mais si on pose le faux
    // éditeur AVANT qu'elle ait fini, elle le voit et tente de compiler l'article via une
    // tâche que l'hôte factice ne connaît pas, ce qui produirait un « err.tache » parasite
    // dans hote.erreurs. On la laisse donc d'abord s'épuiser, éditeur actif encore absent.
    for (let i = 0; i < 30; i++) { await new Promise((r) => setImmediate(r)); }
    // Ce que ce démarrage a pu dire (tutoriel, etc.) ne regarde pas ce contrôle : seul ce
    // que la commande elle-même dit compte pour les assertions qui suivent.
    hote.erreurs.length = 0;
    hote.avertissements.length = 0;

    // Le corps de l'article ne porte AUCUNE section de références : seul le fichier
    // détaché <slug>.biblio.md — écrit par revueDEssai(), avec « Dupont, A. (2024) » et
    // « Muller, B. (2023) » — porte les entrées. C'est exactement la forme d'un article
    // importé depuis que la bibliographie est détachée.
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
      // Sélection non vide, directement sur l'appel : pas besoin de passer par
      // citations.plageDeLAppel() pour ce contrôle.
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
    // Les deux entrées du fichier détaché, dans l'ordre, avec leurs identifiants — ceux
    // que la compilation posera comme ancres.
    assert.deepStrictEqual(propose.map((i) => i.description),
      ['ref-dupont-2024', 'ref-muller-2023']);
    // Le geste écrit bien le lien markdown attendu, vers la première entrée choisie.
    assert.strictEqual(remplacement, '[(Dupont, 2024)](#ref-dupont-2024)');
    // Et rien n'est parti dans les messages d'erreur ou d'information : sans le repli, la
    // commande répondait « cit.aucuneref » ici.
    assert.deepStrictEqual(hote.erreurs, []);
    assert.deepStrictEqual(hote.avertissements, []);
  });
