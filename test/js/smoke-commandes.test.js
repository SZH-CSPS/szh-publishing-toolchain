// Smoke test S2 : chaque commande du manifeste s'exécute sans « command not found » ni
// exception non gérée.
//
//   node --test test/js/smoke-commandes.test.js
//
// Pourquoi : contrats.test.js vérifie que chaque commande de package.json est enregistrée
// (une comparaison de listes), mais rien ne l'appelle jamais. Une commande enregistrée qui
// lève au premier geste — une variable mal fermée, un accesseur qui n'existe plus dans la
// branche qu'aucun test unitaire n'emprunte — ne se verrait dans aucun des deux mondes. Ici
// chaque id est réellement exécuté via HOTE.executer(), sur l'hôte factice activé pour de
// vrai (test/js/hote-factice.js, lot 0). Une famille d'exceptions documentée plus bas
// (COMPILENT_VIA_TACHE) : à lire avant de la tenir pour un oubli.
//
// Ce que chaque commande reçoit, et pourquoi :
//   - la plupart : AUCUN argument. Les dialogues (showWarningMessage, showOpenDialog,
//     showQuickPick…) rendent tous « Annuler » par défaut dans l'hôte factice — c'est
//     précisément ce qui protège ce smoke test d'un geste destructeur (supprimer un
//     article, désarchiver un numéro) : la commande s'arrête à la modale, elle ne lève pas.
//   - les commandes qui exigent un article choisi dans l'arbre (fiche, traduction, médias,
//     table…) reçoivent { slug: '01-essai' }, l'article de revueDEssai() : sans lui, la
//     plupart s'arrêteraient à « article introuvable » sans avoir rien exercé de plus.
//   - szh.editerTable et szh.supprimerTable reçoivent en plus cheminAsset, le tableau du
//     même article (copié par revueDEssai() sous tables/table-01.html).
//   - szh.conflit.comparer et szh.conflit.supprimerCopie reçoivent l'URI du fichier du
//     numéro (ausgabe.yaml), avec une vraie copie en conflit posée à côté sur le disque —
//     comme le fait test/js/conflits-hote.test.js (poserCopie()) : sans cette copie,
//     fichierConflitVise(uri) resterait exercée, mais pas copieConflitPour() en aval.
//   - szh.exporterArticle et szh.envoyerAuteur reçoivent un slug qui n'existe PAS dans la
//     revue d'essai, par exception délibérée : les deux sont les seules commandes de tout
//     le cockpit qui, un slug d'article valide en main, sautent directement une vraie
//     tâche de compilation (lancerTacheObjet -> vscode.tasks.executeTask) SANS dialogue de
//     confirmation entre les deux — contrairement à « Réimporter », « Supprimer »,
//     « Archiver »… qui s'arrêtent tous à une modale annulée par défaut. L'hôte factice
//     résout executeTask() immédiatement mais n'émet jamais la fin de tâche tant qu'un
//     test ne l'appelle pas (HOTE.finirTache) : leur donner un article résoudrait la tâche
//     jamais — le smoke test entier resterait accroché jusqu'au timeout. C'est exactement
//     la famille de piège que la revue de l'infrastructure de test a nommée (« 3 sondes qui
//     font bloquer la suite au lieu de la faire échouer, attentes sans borne dans l'hôte
//     factice »). Un slug ABSENT (plutôt qu'aucun argument) est volontaire : cibleTraduction()
//     retomberait sinon sur session.apercuCourantSlug(), que d'AUTRES commandes du même
//     balayage (métadonnées, médias, traduction…) posent en effet de bord sur '01-essai' —
//     un slug absent mais explicite coupe court à ce repli, quel que soit l'ordre du
//     balayage. Constaté une fois avec AUCUN argument : le balayage restait accroché sur
//     szh.envoyerAuteur après qu'une commande précédente avait laissé '01-essai' en aperçu
//     courant.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const RACINE = path.resolve(__dirname, '..', '..');
const PACKAGE = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'package.json'));

// Les commandes qui prennent un article choisi dans l'arbre : { slug } suffit, c'est la
// forme que cibleTraduction() (extension.js) et les gardes `item.slug` comprennent toutes
// les deux. Absentes de cette liste : les commandes sans paramètre (elles agissent sur
// l'éditeur actif ou sur tout le numéro) et les deux exceptions de tâche documentées
// au-dessus.
const AVEC_SLUG = new Set([
  'szh.metadonneesArticle', 'szh.traduction', 'szh.envoyerTraduction',
  'szh.mediasArticle', 'szh.apercuBiblio', 'szh.voirPdfArticle',
  'szh.monterUnite', 'szh.descendreUnite',
  'szh.supprimerArticle', 'szh.reimporterArticle', 'szh.annulerReimport'
]);

// szh.editerTable / szh.supprimerTable visent un asset précis, pas un article entier :
// cheminAsset construit une fois que la revue d'essai existe (voir plus bas).
const AVEC_TABLE = new Set(['szh.editerTable', 'szh.supprimerTable']);

// szh.conflit.comparer et szh.conflit.supprimerCopie visent le fichier du numéro : l'URI de
// ausgabe.yaml, avec une copie en conflit posée à côté (voir plus bas). supprimerCopie passe
// par la même modale annulée par défaut que les autres gestes destructeurs : la copie n'est
// donc jamais effacée par ce smoke test.
const AVEC_URI_CONFLIT = new Set(['szh.conflit.comparer', 'szh.conflit.supprimerCopie']);

// Documenté au-dessus : ces deux-là reçoivent un slug qui n'existe pas, pour ne jamais
// atteindre une tâche qui ne finirait jamais dans ce harnais.
const SLUG_ABSENT_VOLONTAIRE = new Set(['szh.exporterArticle', 'szh.envoyerAuteur']);

// ---- Une exception documentée, pas un défaut de CE lot -------------------------------
//
// Trou de HARNAIS, pas de commande : ces huit passent par lancerTache(), qui lit
// vscode.tasks.fetchTasks() pour trouver une tâche par son nom — et l'hôte factice
// (test/js/hote-factice.js) la rend toujours vide, aucun test du dépôt n'y posant de
// tâche nommée. lancerTache() affiche alors T('err.tache') (« … réglage de l'éditeur qui
// manque… ») : sur un vrai poste, vscodium-user/tasks.json fournit ces tâches, l'erreur
// ne s'y produit pas. Attendu ici, pas un défaut de la commande elle-même.
const ERREUR_TACHE_ABSENTE = 'réglage de l’éditeur qui manque sur ce poste';
const COMPILENT_VIA_TACHE = new Set([
  'szh.convertirEnAttente', 'szh.toutExporter', 'szh.exporterXml',
  'szh.livreImprimeur', 'szh.livreCouverture', 'szh.livreEpub', 'szh.livreWeb',
  'szh.traduction'                          // ouvrirTraduction -> ouvrirArticle -> lancerTache
]);

// Même trou de harnais pour la pagination : elle lit l'état du numéro par la WSL
// (lib/pagination-hote.js). Sur un runner sans WSL, réel ou simulé, elle affiche son échec
// de lecture, ce qui est la bonne réponse de la commande.
const ERREUR_SANS_WSL = 'La pagination n’a pas pu être rafraîchie';
const LISENT_PAR_WSL = new Set(['szh.rafraichirPagination']);

test('smoke S2 : chaque commande du manifeste s’exécute sans lever', async () => {
  const revue = revueDEssai();
  const hote = activerHote(revue);
  await demarrageSeTait(hote);          // le démarrage ne doit déjà rien avoir crié

  const idsManifeste = PACKAGE.contributes.commands.map((c) => c.command);
  assert.ok(idsManifeste.length > 30, 'le manifeste semble vide : le contrôle ne prouverait rien');

  const enregistrees = new Set(hote.commandes());
  const manquantes = idsManifeste.filter((id) => !enregistrees.has(id));
  assert.deepStrictEqual(manquantes, [],
    'des commandes du manifeste ne sont enregistrées par aucun registerCommand');

  const cheminTable = path.join(revue, 'articles', '01-essai', 'tables', 'table-01.html');
  const item = { slug: '01-essai' };
  const itemTable = { slug: '01-essai', cheminAsset: cheminTable };
  const itemAbsent = { slug: 'inexistant-smoke' };

  // La copie en conflit du fichier du numéro, posée comme le fait poserCopie() dans
  // test/js/conflits-hote.test.js : sans elle, copieConflitPour() ne trouverait rien.
  const cheminAusgabe = path.join(revue, 'ausgabe.yaml');
  const cheminCopieConflit = path.join(revue, 'ausgabe-Copie en conflit.yaml');
  fs.writeFileSync(cheminCopieConflit,
    fs.readFileSync(cheminAusgabe, 'utf8').replace('title: "Essai"', 'title: "Essai (autre poste)"'));
  const uriAusgabe = hote.stub.Uri.file(cheminAusgabe);

  const echecs = [];
  for (const id of idsManifeste) {
    hote.erreurs.length = 0;
    let args = [];
    if (AVEC_TABLE.has(id)) { args = [itemTable]; }
    else if (AVEC_SLUG.has(id)) { args = [item]; }
    else if (AVEC_URI_CONFLIT.has(id)) { args = [uriAusgabe]; }
    else if (SLUG_ABSENT_VOLONTAIRE.has(id)) { args = [itemAbsent]; }
    let exception = null;
    try {
      await hote.executer(id, ...args);
    } catch (e) {
      exception = e;
    }

    if (exception) {
      echecs.push(id + ' a levé : ' + (exception && exception.message || exception));
      continue;
    }
    if (hote.erreurs.length > 0) {
      const inattendues = COMPILENT_VIA_TACHE.has(id)
        ? hote.erreurs.filter((m) => m.indexOf(ERREUR_TACHE_ABSENTE) === -1)
        : LISENT_PAR_WSL.has(id)
          ? hote.erreurs.filter((m) => m.indexOf(ERREUR_SANS_WSL) === -1)
          : hote.erreurs.slice();
      if (inattendues.length > 0) {
        echecs.push(id + ' a laissé une erreur affichée : ' + inattendues.join(' | '));
      }
    }
  }

  assert.deepStrictEqual(echecs, [],
    'commandes en échec :\n' + echecs.join('\n'));
});
