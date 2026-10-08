// Smoke test : chaque commande du manifeste s'exécute sans « command not found » ni exception
// non gérée.
//
//   node --test test/js/smoke-commandes.test.js
//
// contrats.test.js vérifie que chaque commande de package.json est enregistrée, sans
// l'appeler. Une commande qui lève au premier geste (variable mal fermée, accesseur disparu
// dans une branche qu'aucun test unitaire n'emprunte) ne se verrait pas. Ici chaque id est
// exécuté par HOTE.executer(), sur l'hôte factice activé (test/js/hote-factice.js). Les
// exceptions attendues sont décrites plus bas (ERREUR_TACHE_ABSENTE, ERREUR_SANS_WSL).
//
// Ce que chaque commande reçoit :
//   - la plupart : aucun argument. Les dialogues (showWarningMessage, showOpenDialog,
//     showQuickPick…) rendent « Annuler » par défaut dans l'hôte factice : une commande
//     destructrice (supprimer un article, désarchiver un numéro) s'arrête à la modale.
//   - les commandes qui exigent un article choisi dans l'arbre (fiche, traduction, médias,
//     table…) reçoivent { slug: '01-essai' }, l'article de revueDEssai() ; sans lui, la
//     plupart s'arrêteraient à « article introuvable ».
//   - szh.editerTable et szh.supprimerTable reçoivent en plus cheminAsset, le tableau du même
//     article (copié par revueDEssai() sous tables/table-01.html).
//   - szh.conflit.comparer et szh.conflit.supprimerCopie reçoivent l'URI du fichier du numéro
//     (ausgabe.yaml), avec une vraie copie en conflit posée à côté, comme poserCopie() dans
//     test/js/conflits-hote.test.js : sans elle, copieConflitPour() ne serait pas exercée.
//   - szh.exporterArticle et szh.envoyerAuteur reçoivent un slug absent de la revue d'essai.
//     Avec un slug valide, ces deux commandes lancent une tâche de compilation
//     (lancerTacheObjet -> vscode.tasks.executeTask) sans modale de confirmation. L'hôte
//     factice n'émet la fin de tâche que sur HOTE.finirTache : le smoke test resterait
//     accroché jusqu'au timeout. Le slug absent doit être explicite : sans argument,
//     cibleTraduction() retomberait sur session.apercuCourantSlug(), que d'autres commandes
//     du balayage (métadonnées, médias, traduction…) posent sur '01-essai'.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { revueDEssai, activerHote, demarrageSeTait } = require('./hote-factice');

const RACINE = path.resolve(__dirname, '..', '..');
const PACKAGE = require(path.join(RACINE, 'vscodium-extension', 'szh-cockpit', 'package.json'));

// Les commandes qui prennent un article choisi dans l'arbre : { slug } suffit, c'est la forme
// que comprennent cibleTraduction() (extension.js) et les gardes `item.slug`. N'y figurent ni
// les commandes sans paramètre (qui agissent sur l'éditeur actif ou sur tout le numéro), ni
// les deux exceptions de tâche décrites plus haut.
const AVEC_SLUG = new Set([
  'szh.metadonneesArticle', 'szh.traduction', 'szh.envoyerTraduction',
  'szh.mediasArticle', 'szh.apercuBiblio', 'szh.voirPdfArticle',
  'szh.supprimerArticle', 'szh.reimporterArticle', 'szh.annulerReimport'
]);

// szh.editerTable / szh.supprimerTable visent un asset précis : cheminAsset est construit une
// fois la revue d'essai créée (voir plus bas).
const AVEC_TABLE = new Set(['szh.editerTable', 'szh.supprimerTable']);

// szh.conflit.comparer et szh.conflit.supprimerCopie visent le fichier du numéro : l'URI de
// ausgabe.yaml, avec une copie en conflit posée à côté. supprimerCopie s'arrête à la modale
// annulée par défaut : la copie n'est pas effacée.
const AVEC_URI_CONFLIT = new Set(['szh.conflit.comparer', 'szh.conflit.supprimerCopie']);

// Voir l'en-tête : ces deux commandes reçoivent un slug absent, pour ne pas lancer une tâche
// qui ne finirait jamais dans ce harnais.
const SLUG_ABSENT_VOLONTAIRE = new Set(['szh.exporterArticle', 'szh.envoyerAuteur']);

// ---- Erreurs attendues dans ce harnais -----------------------------------------------
//
// Ces commandes passent par lancerTache(), qui cherche une tâche par son nom dans
// vscode.tasks.fetchTasks(). L'hôte factice (test/js/hote-factice.js) rend une liste vide :
// lancerTache() affiche alors T('err.tache') (« … réglage de l'éditeur qui manque… »). Sur un
// vrai poste, vscodium-user/tasks.json fournit ces tâches.
const ERREUR_TACHE_ABSENTE = 'réglage de l’éditeur qui manque sur ce poste';
const COMPILENT_VIA_TACHE = new Set([
  'szh.convertirEnAttente', 'szh.toutExporter', 'szh.exporterXml',
  'szh.livreImprimeur', 'szh.livreCouverture', 'szh.livreEpub', 'szh.livreWeb',
  'szh.traduction'                          // ouvrirTraduction -> ouvrirArticle -> lancerTache
]);

// La pagination lit l'état du numéro par la WSL (lib/pagination-hote.js). Sur un runner sans
// WSL, réel ou simulé, elle affiche son échec de lecture, ce qui est la bonne réponse.
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

  // La copie en conflit du fichier du numéro, posée comme poserCopie() dans
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

// Trois commandes retirées du manifeste : aucun menu ni aucune vue ne les appelait. L'ordre
// se change par la vue (deplacerUnite, mode « Changer l'ordre »).
const RETIREES = ['szh.monterUnite', 'szh.descendreUnite', 'szh.traductionsToutPret'];

test('les commandes retirées ne reviennent ni au manifeste, ni aux libellés, ni à l’hôte', () => {
  const cockpit = path.join(RACINE, 'vscodium-extension', 'szh-cockpit');
  const declarees = PACKAGE.contributes.commands.map((c) => c.command);
  const palette = (PACKAGE.contributes.menus.commandPalette || []).map((m) => m.command);
  const source = fs.readFileSync(path.join(cockpit, 'extension.js'), 'utf8');
  for (const id of RETIREES) {
    assert.ok(declarees.indexOf(id) === -1, id + ' est encore déclarée');
    assert.ok(palette.indexOf(id) === -1, id + ' est encore dans la palette');
    assert.ok(source.indexOf('\'' + id + '\'') === -1, id + ' est encore enregistrée');
    for (const nls of ['package.nls.json', 'package.nls.de.json']) {
      const cles = Object.keys(JSON.parse(fs.readFileSync(path.join(cockpit, nls), 'utf8')));
      assert.ok(cles.indexOf('cmd.' + id.slice(4)) === -1, 'cmd.' + id.slice(4) + ' reste dans ' + nls);
    }
  }
});
