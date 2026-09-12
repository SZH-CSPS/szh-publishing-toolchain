// Les deux gestes qui touchent au disque et qu'un verrou Windows faisait dérailler.
//
//   node --test test/js/archivage-suppression.test.js
//
// Mesuré le 12.09.2026 sur le poste de Robin, sur deux numéros réels :
//   - 2027-03 : l'archivage s'est annulé parce que `out/` refusait de disparaître, alors
//     que windows/archive-revue.ps1 le supprime lui-même après la fermeture de la fenêtre ;
//   - 2027-01 : le déplacement n'a pas abouti, et le numéro est resté marqué archivé parmi
//     les numéros en cours, sans qu'aucun geste du cockpit ne sache plus le ranger.
// Et un troisième, plus ancien : supprimer un article laissait un trou dans la
// numérotation des dossiers (01, 03, 04), que « Changer l'ordre » seul refermait.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// ⚠ AVANT toute activation : lib/cycle-vie.js prend lancerArchivage par déstructuration au
// chargement du module, un monkeypatch posé après coup ne changerait donc rien à ce qu'il a
// déjà capturé. Le vrai toolkit est installé sur le poste de développement : sans cette
// neutralisation, archiver le numéro d'essai lancerait pour de bon wscript.exe dessus.
const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
const lancements = [];
archivage.lancerArchivage = (action) => { lancements.push(action); return null; };

const { T } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
const { revueDEssai, activerHote } = require('./hote-factice');

const REVUE = revueDEssai();
const HOTE = activerHote(REVUE);

const ARTICLES = path.join(REVUE, 'articles');

function poserArticle(slug) {
  fs.mkdirSync(path.join(ARTICLES, slug), { recursive: true });
  fs.writeFileSync(path.join(ARTICLES, slug, slug + '.md'), 'Texte.\n');
}

function dossiers() {
  return fs.readdirSync(ARTICLES, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

function ausgabe() {
  return fs.readFileSync(path.join(REVUE, 'ausgabe.yaml'), 'utf8');
}

// ---- Supprimer un article referme le rang ---------------------------------------

test('suppression : les dossiers restants sont renumérotés, fichiers compris', async () => {
  poserArticle('03-troisieme');
  poserArticle('04-quatrieme');
  assert.deepStrictEqual(dossiers(),
    ['01-essai', '02-sans-fiche', '03-troisieme', '04-quatrieme'], 'décor du test');

  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await HOTE.executer('szh.supprimerArticle', { slug: '02-sans-fiche' });

  assert.deepStrictEqual(dossiers(), ['01-essai', '02-troisieme', '03-quatrieme'],
    'le trou laissé par l’article supprimé n’a pas été refermé');
  // Le fichier suit son dossier : « 03-troisieme.md » sous « 02-troisieme » n'est lu par
  // personne — ni par le Makefile, ni par l'arbre du cockpit.
  assert.ok(fs.existsSync(path.join(ARTICLES, '02-troisieme', '02-troisieme.md')),
    'le .md est resté sous son ancien nom');
  assert.ok(!fs.existsSync(path.join(ARTICLES, '02-troisieme', '03-troisieme.md')),
    'l’ancien .md traîne encore dans le dossier renommé');
  assert.match(ausgabe(), /ordre-articles: \["01-essai", "02-troisieme", "03-quatrieme"\]/,
    'l’ordre du numéro ne nomme pas les dossiers tels qu’ils sont sur le disque');
});

test('suppression : le dernier rang ne renomme rien, et le dit simplement', async () => {
  const avant = HOTE.statuts.length;
  HOTE.repondreModale(T('modale.supprimer.bouton'));
  await HOTE.executer('szh.supprimerArticle', { slug: '03-quatrieme' });

  assert.deepStrictEqual(dossiers(), ['01-essai', '02-troisieme'],
    'la suppression du dernier article a bougé ses voisins');
  const dits = HOTE.statuts.slice(avant).join(' | ');
  assert.match(dits, /03-quatrieme/, 'la suppression n’a rien dit dans la barre d’état');
  assert.ok(dits.indexOf('renumérot') === -1,
    'aucun dossier n’a été renommé, il ne faut pas l’annoncer : ' + dits);
});

// ---- Archiver malgré un out/ qui résiste -----------------------------------------

test('archivage : un out/ qui refuse de partir n’annule plus le geste', async () => {
  fs.mkdirSync(path.join(REVUE, 'out'), { recursive: true });
  fs.writeFileSync(path.join(REVUE, 'out', 'a.pdf'), 'PDF');
  // Le verrou Windows, tel que le rédacteur l'a rencontré : EPERM sur le DOSSIER out/.
  // Simulé au niveau du rappel plutôt qu'en faisant vraiment échouer fs, pour ne pas
  // attendre les dix secondes de reprises de lib/supprimer.js.
  // Requis ici et non en tête : lib/cycle-vie.js demande « vscode », que hote-factice.js
  // n'intercepte qu'une fois chargé.
  require(path.join(COCKPIT, 'lib', 'cycle-vie.js'))
    .configurer({ supprimerAvecReprises: async () => 'EPERM, operation not permitted' });

  const avantErreurs = HOTE.erreurs.length;
  const avantLancements = lancements.length;
  HOTE.repondreModale(T('modale.archiver.bouton'));
  await HOTE.executer('szh.archiverVerrouiller');

  assert.match(ausgabe(), /archived:\s*true/,
    'les drapeaux ont été relevés : l’archivage s’est annulé pour son accessoire');
  assert.match(ausgabe(), /locked:\s*true/, 'le verrou n’a pas été posé');
  assert.strictEqual(lancements.length, avantLancements + 1,
    'le script de déplacement n’a pas été lancé');
  assert.deepStrictEqual(HOTE.erreurs.slice(avantErreurs), [],
    'un out/ qui résiste ne doit pas produire de message bloquant');
  // Et le rédacteur est prévenu, sans qu'on lui demande un geste inutile : le script
  // supprimera out/ lui-même, une fois la fenêtre fermée.
  const dits = HOTE.avertissements.join(' | ');
  assert.match(dits, /documents produits/,
    'rien n’a été dit sur les documents produits restés en place : ' + dits);
});

// ---- Rattraper un numéro marqué archivé mais resté sur place ----------------------

test('archivage : un numéro marqué archivé mais non déplacé peut être rangé', async () => {
  // L'état dans lequel 2027-01 s'est retrouvé : les deux drapeaux sont écrits AVANT le
  // déplacement, celui-ci a échoué, et le test précédent laisse exactement cet état.
  const avantLancements = lancements.length;
  let questionPosee = '';
  const original = HOTE.stub.window.showInformationMessage;
  HOTE.stub.window.showInformationMessage = (m, ...boutons) => {
    questionPosee = String(m);
    return Promise.resolve(boutons.map(String)[0]);   // le rédacteur clique le bouton
  };
  try {
    await HOTE.executer('szh.archiverVerrouiller');
  } finally {
    HOTE.stub.window.showInformationMessage = original;
  }

  assert.match(questionPosee, /déjà archiv/,
    'le cockpit n’a pas reconnu un numéro déjà marqué archivé : ' + questionPosee);
  assert.strictEqual(lancements.length, avantLancements + 1,
    'le déplacement n’a pas été relancé : le numéro reste bloqué où il est');
});

test('archivage : sans clic sur le bouton, rien n’est relancé', async () => {
  const avantLancements = lancements.length;
  // showInformationMessage rend undefined par défaut, c'est-à-dire « message ignoré ».
  await HOTE.executer('szh.archiverVerrouiller');
  assert.strictEqual(lancements.length, avantLancements,
    'le déplacement a été relancé sans que personne l’ait demandé');
});
