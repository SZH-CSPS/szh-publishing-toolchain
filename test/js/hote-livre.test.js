// Le cockpit ouvert sur un LIVRE : ce qu'il montre, et ce qu'il ne montre pas.
//
//   node --test test/js/hote-livre.test.js
//
// L'extension est réellement activée (hote-factice.js intercepte `require('vscode')`), sur
// un dossier qui porte un buch.yaml. On ne vérifie ici que ce qui DIFFÈRE d'un numéro —
// le reste de la mécanique est indifférent au profil, et hote.test.js le dit déjà pour la
// revue. Vérifier deux fois la même chose ne prouve rien de plus.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Neutralise le script de déplacement AVANT toute activation : lib/cycle-vie.js le prend
// par déstructuration au chargement du module (`const { …, lancerArchivage } =
// require('./archivage')`), donc un monkeypatch posé après coup ne changerait rien à ce
// qu'il a déjà capturé — d'où ce require ici, avant activerHote() plus bas. Le vrai
// toolkit est installé sur ce poste (C:\ProgramData\SZH\toolkit\windows\archive-revue.ps1) :
// sans cette neutralisation, verrouiller ou archiver le livre d'essai lancerait pour de
// vrai wscript.exe sur ce dossier temporaire.
const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
archivage.lancerArchivage = () => null;

const { livreDEssai, activerHote } = require('./hote-factice');

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);

// langueRevue (lib/yaml.js) est un module pur : pas besoin de l'hôte factice, un dossier
// suffit. Test isolé, sur son propre dossier temporaire — jamais LIVRE, partagé par tout
// le fichier.
test('livre : langueRevue lit le fichier du profil (buch.yaml), pas ausgabe.yaml en dur', () => {
  const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
  const livre = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-livre-langue-'));
  fs.writeFileSync(path.join(livre, 'buch.yaml'), 'titre: "Essai"\nlang: de\n');
  assert.strictEqual(yaml.langueRevue(livre), 'de',
    'un livre « lang: de » doit donner « de », pas le repli français d’un ausgabe.yaml absent');
});

// Le défaut que ce contrôle prévient : la vue latérale était gardée par `szh.estRevue` et
// ne s'affichait tout simplement pas sur un livre — dossier ouvert, aucun cockpit.
test('livre : les deux clés de contexte sont posées, et elles s’excluent', () => {
  const ctx = HOTE.contexte ? HOTE.contexte() : null;
  if (!ctx) { return; }   // l'hôte factice ne les expose pas partout : on ne casse pas pour ça
  assert.strictEqual(ctx['szh.estLivre'], true, 'szh.estLivre n’est pas posé sur un livre');
  assert.strictEqual(ctx['szh.estRevue'], false,
    'szh.estRevue reste vrai sur un livre : les deux vues s’afficheraient ensemble');
});

// ⚠ PAS de section « Traductions » pour un livre, et ce n'est pas un détail d'affichage.
// Une revue paraît en deux langues et chaque article a sa version jumelle ; un livre est
// écrit dans une langue, et sa traduction est un AUTRE livre, avec son ISBN. La section
// était construite inconditionnellement — c'est cette ligne-là qu'il a fallu rendre
// conditionnelle, pas seulement les chemins de fichiers.
test('livre : l’arbre montre Chapitres et Word, jamais Traductions', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre, 'aucun fournisseur d’arbre enregistré');
  const racine = await arbre.getChildren();
  const categories = racine.map((it) => it.categorie);
  assert.deepStrictEqual(categories, ['chapitres', 'word'],
    'sections attendues pour un livre : chapitres puis word — obtenu ' + categories.join(', '));
});

test('livre : la section des unités s’appelle « chapitres », pas « articles »', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const section = racine[0];
  assert.strictEqual(section.contextValue, 'section-chapitres');
  assert.match(String(section.label), /CHAPITRES/i,
    'le titre de section ne dit pas « chapitres » : ' + section.label);
});

// L'accordéon s'ouvrait sur la clé « articles », codée en dur au constructeur. Sur un
// livre, cette catégorie n'existe pas : rien ne se dépliait, et l'arbre s'ouvrait fermé.
test('livre : la section des chapitres est dépliée à l’ouverture', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  assert.strictEqual(racine[0].collapsibleState, 2,
    'la section des chapitres n’est pas dépliée (2 = Expanded)');
});

test('livre : les chapitres du dossier sont listés', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(racine[0]);
  const slugs = enfants.map((it) => it.slug).filter(Boolean);
  assert.deepStrictEqual(slugs.sort(), ['01-ouverture', '02-suite'],
    'les chapitres ne sont pas lus dans chapitres/ — obtenu ' + slugs.join(', '));
});

// Le chemin d'un chapitre doit être chapitres/<slug>/<slug>.md et non articles/… : c'est
// la jointure que dossierUnites() a remplacée, et celle dont dépendent tous les gestes.
// L'élément de l'arbre porte l'URI du .md dans `resourceUri` ; la commande, elle, ne reçoit
// que le slug — ce qui a d'abord fait échouer ce contrôle, et c'est le contrôle qui avait
// tort, pas l'arbre.
test('livre : un chapitre pointe sur chapitres/<slug>/<slug>.md', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(racine[0]);
  const premier = enfants.find((it) => it.slug === '01-ouverture');
  assert.ok(premier, 'le chapitre 01-ouverture n’est pas dans l’arbre');
  const cible = String((premier.resourceUri && premier.resourceUri.fsPath) || '');
  assert.ok(cible, 'le chapitre ne porte aucun fichier');
  assert.ok(cible.indexOf(path.join('chapitres', '01-ouverture', '01-ouverture.md')) !== -1,
    'le chapitre ne pointe pas dans chapitres/ : ' + cible);
  assert.ok(cible.indexOf(path.sep + 'articles' + path.sep) === -1,
    'le chapitre pointe encore dans articles/ : ' + cible);
});

// ⚠ Le défaut que ce contrôle prévient est MUET. Le surveillant de fichiers était posé sur
//   `articles/**`, `articles-word/*` et `ausgabe.yaml` : sur un livre, trois chemins qui
//   n'existent pas. Aucune erreur, aucun avertissement — simplement un arbre qui ne se
//   rafraîchit jamais de lui-même. Un chapitre importé n'apparaissait qu'après réouverture
//   de la fenêtre, ce qui se lit comme « l'import n'a rien fait ».
// Les surveillants sont posés par majContexte(), APRÈS le réveil de la machine WSL : ils
// n'existent donc pas encore quand activerHote() rend la main. On attend leur pose plutôt
// que de sortir sans rien vérifier — un contrôle qui s'abstient tout seul ne protège rien.
test('livre : le surveillant de fichiers regarde chapitres/ et buch.yaml', async () => {
  for (let i = 0; i < 60 && !HOTE.motifsSurveilles().length; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  const motifs = HOTE.motifsSurveilles();
  assert.ok(motifs.length, 'aucun surveillant n’a été installé : le contrôle ne prouve rien');
  assert.ok(motifs.indexOf('chapitres/**') !== -1,
    'chapitres/ n’est pas surveillé : ' + motifs.join(', '));
  assert.ok(motifs.indexOf('chapitres-word/*') !== -1,
    'le dépôt Word du livre n’est pas surveillé : ' + motifs.join(', '));
  assert.ok(motifs.indexOf('buch.yaml') !== -1,
    'buch.yaml n’est pas surveillé : ' + motifs.join(', '));
  assert.ok(motifs.indexOf('articles/**') === -1 && motifs.indexOf('ausgabe.yaml') === -1,
    'le livre surveille encore des chemins de revue : ' + motifs.join(', '));
});

// Le déplacement d'un chapitre, de bout en bout : le geste, puis ce que le disque en garde.
// C'est le contrôle qui prouve toute la chaîne d'un coup — cheminConfig écrit dans
// buch.yaml et non dans un ausgabe.yaml parasite, cleOrdre() nomme `ordre-chapitres`, et
// analyserAusgabe ne filtre plus cette clé. Chacune de ces trois pièces manquait, et
// aucune ne se serait plainte.
test('livre : descendre un chapitre écrit ordre-chapitres dans buch.yaml', async () => {
  const fs = require('fs');
  const avant = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  assert.ok(avant.indexOf('ordre-chapitres') !== -1, 'le livre d’essai n’a pas la clé');

  await HOTE.executer('szh.descendreUnite', { slug: '01-ouverture' });

  const apres = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  const ligne = apres.split(/\r?\n/).find((l) => l.indexOf('ordre-chapitres:') === 0);
  assert.ok(ligne, 'ordre-chapitres a disparu de buch.yaml');
  assert.ok(ligne.indexOf('02-suite') < ligne.indexOf('01-ouverture'),
    'le chapitre n’a pas été descendu : ' + ligne);
  // ⚠ Le défaut le plus coûteux serait celui-ci : écrire l'ordre à côté, dans un fichier de
  //   revue que le moteur livre ne lit pas. Le dossier porterait alors les deux
  //   configurations, et profil.js comme le Makefile le prendraient pour ambigu.
  assert.ok(!fs.existsSync(path.join(LIVRE, 'ausgabe.yaml')),
    'un ausgabe.yaml parasite a été créé dans un livre');
});

// cheminBiblio() codait « articles » en dur : sur un livre, le fichier était cherché sous
// articles/<slug>/ au lieu de chapitres/<slug>/, et l'entrée n'apparaissait jamais — le
// même contrôle que côté revue (biblio.test.js), rejoué ici sur un chapitre.
test('livre : la bibliographie d’un chapitre apparaît sous lui dans l’arbre', async () => {
  const fs = require('fs');
  const dossier = path.join(LIVRE, 'chapitres', '01-ouverture');
  fs.writeFileSync(path.join(dossier, '01-ouverture.biblio.md'),
    ['Dupont, A. (2024). *Un titre*. SZH.', ''].join('\n'));

  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(racine[0]);
  const chapitre = enfants.find((it) => it.slug === '01-ouverture');
  assert.ok(chapitre, 'le chapitre 01-ouverture n’est pas dans l’arbre');

  const petitsEnfants = await arbre.getChildren(chapitre);
  const biblio = petitsEnfants.find((it) => it.contextValue === 'biblio');
  assert.ok(biblio, 'aucune entrée de bibliographie sous le chapitre : '
    + petitsEnfants.map((e) => e.contextValue).join(', '));
  assert.strictEqual(biblio.label, '01-ouverture.biblio.md');
});

// ---- Aperçu d'un chapitre : le bon fichier, et une seule compilation au plus --------
//
// lib/profil.js#chemins() pointait outUnite d'un chapitre vers .frag.html — un fichier
// intermédiaire, jamais celui qu'ouvrirArticle lit. ouvrirArticle calculait en plus son
// propre chemin littéral, à la forme d'un ARTICLE (out/<slug>/<slug>.apercu.html), qui
// n'existe jamais pour un chapitre : l'aperçu semblait donc toujours absent, même une fois
// réellement compilé, et une seconde compilation repartait chaque fois pour rien.
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

test('livre : un chapitre déjà compilé ouvre son aperçu sans lancer aucune tâche', async () => {
  const dossierOut = path.join(LIVRE, 'out', 'chapitres');
  fs.mkdirSync(dossierOut, { recursive: true });
  const apercu = path.join(dossierOut, '01-ouverture.apercu.html');
  fs.writeFileSync(apercu, '<html><body>chapitre déjà composé</body></html>');
  // Plus récent que le .md : ouvrirArticle ne doit rien trouver d’obsolète.
  const futur = (Date.now() + 60000) / 1000;
  fs.utimesSync(apercu, futur, futur);

  const origExecute = HOTE.stub.tasks.executeTask;
  let appels = 0;
  HOTE.stub.tasks.executeTask = (t) => { appels++; return origExecute(t); };
  try {
    await HOTE.executer('szh.ouvrirArticle', '01-ouverture');
    assert.strictEqual(appels, 0,
      'un aperçu de chapitre déjà présent et à jour ne doit lancer aucune tâche');
    const panneau = HOTE.panneauDeType('szhApercuHtml');
    assert.ok(panneau, 'l’aperçu HTML du chapitre ne s’est pas ouvert');
    assert.ok(String(panneau.html).indexOf('chapitre déjà composé') !== -1,
      'le panneau ne montre pas out/chapitres/01-ouverture.apercu.html, le bon fichier '
      + 'pour un chapitre');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
  }
});

test('livre : un chapitre sans aperçu ne lance qu’UNE tâche', async () => {
  const dossierOut = path.join(LIVRE, 'out', 'chapitres');
  fs.rmSync(path.join(LIVRE, 'out'), { recursive: true, force: true });   // rien compilé

  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_TACHE_BUILD }]);
  const origExecute = HOTE.stub.tasks.executeTask;
  let appels = 0;
  HOTE.stub.tasks.executeTask = (t) => {
    appels++;
    // Ce qu'une vraie compilation écrirait : le fichier que lib/profil.js#chemins attend
    // maintenant pour un CHAPITRE (out/chapitres/<slug>.apercu.html) — jamais le chemin de
    // revue (out/<slug>/<slug>.apercu.html) que ouvrirArticle cherchait avant ce lot, et
    // qui n'existe pour aucun chapitre.
    fs.mkdirSync(dossierOut, { recursive: true });
    fs.writeFileSync(path.join(dossierOut, '02-suite.apercu.html'), '<html><body>build</body></html>');
    return origExecute(t);
  };
  try {
    const promesse = HOTE.executer('szh.ouvrirArticle', '02-suite');
    await tick(); await tick();
    await HOTE.finirTache(NOM_TACHE_BUILD, 0);
    await promesse;
    await tick(); await tick();
    assert.strictEqual(appels, 1,
      'un aperçu absent doit déclencher UNE compilation, jamais deux — celle que la '
      + 'compilation vient d’écrire doit être vue, pas cherchée au mauvais endroit');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

// ---- Quatre tâches sans équivalent côté revue (point 4) -----------------------------

const NOM_TACHE_LIVRE_IMPRIMEUR = 'Livre : PDF imprimeur';

test('livre : la commande « imprimeur » lance la tâche du bon nom', async () => {
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_TACHE_LIVRE_IMPRIMEUR }]);
  const origExecute = HOTE.stub.tasks.executeTask;
  let nomLance = null;
  HOTE.stub.tasks.executeTask = (t) => { nomLance = t && t.name; return origExecute(t); };
  try {
    const promesse = HOTE.executer('szh.livreImprimeur');
    await tick(); await tick();
    await HOTE.finirTache(NOM_TACHE_LIVRE_IMPRIMEUR, 0);
    await promesse;
    assert.strictEqual(nomLance, NOM_TACHE_LIVRE_IMPRIMEUR,
      'szh.livreImprimeur ne lance pas la tâche « ' + NOM_TACHE_LIVRE_IMPRIMEUR
      + ' » de vscodium-user/tasks.json');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

// ---- Cycle de vie (archiver/verrouiller/désarchiver) exposé pour un livre -----------
//
// windows/archive-revue.ps1 sait archiver un livre depuis un moment ($estLivre, les textes
// arch.*.livre) ; c'était le cockpit qui retirait les trois commandes du panneau Export sur
// un livre (REVUE_SEULEMENT, lib/panneaux.js). Les deux contrôles qui suivent prouvent le
// chemin complet côté cockpit : le panneau les offre, avec des libellés qui parlent du
// livre et non de la revue, et la commande écrit vraiment locked/archived dans buch.yaml.
test('livre : le panneau Export offre archiver/verrouiller avec des libellés de livre', async () => {
  const original = HOTE.stub.window.showQuickPick;
  let items = null;
  HOTE.stub.window.showQuickPick = (its) => { items = its; return Promise.resolve(undefined); };
  try {
    await HOTE.executer('szh.panneauExport');
  } finally {
    HOTE.stub.window.showQuickPick = original;
  }
  assert.ok(items, 'le panneau Export ne s’est pas ouvert (aucun QuickPick affiché)');

  const archiver = items.find((it) => it.commande === 'szh.archiverVerrouiller');
  assert.ok(archiver, 'szh.archiverVerrouiller n’apparaît pas dans le panneau Export d’un livre');
  assert.match(String(archiver.label), /livre/i,
    'le libellé d’archivage parle encore de « revue »/« numéro » : ' + archiver.label);
  assert.doesNotMatch(String(archiver.label), /revue/i,
    'le libellé d’archivage dit encore « revue » sur un livre : ' + archiver.label);

  // Les séparateurs n’ont pas de champ `commande` (itemsDepuisEntrees, lib/panneaux.js) :
  // celui du cycle de vie se retrouve par son texte plutôt que par son `kind`.
  const cycle = items.find((it) => !it.commande && /cycle de vie/i.test(String(it.label)));
  assert.ok(cycle, 'aucun séparateur « Cycle de vie » dans le panneau Export');
  assert.match(String(cycle.label), /livre/i,
    'le séparateur du cycle de vie parle encore du numéro : ' + cycle.label);

  // szh.deverrouiller/szh.desarchiver n’ont pas de raison d’apparaître sur un livre qui
  // n’est ni verrouillé ni archivé — même logique que pour une revue, pas un défaut du lot.
  assert.ok(!items.some((it) => it.commande === 'szh.deverrouiller'),
    'szh.deverrouiller apparaît alors que le livre d’essai n’est pas verrouillé');
  assert.ok(!items.some((it) => it.commande === 'szh.desarchiver'),
    'szh.desarchiver apparaît alors que le livre d’essai n’est pas archivé');
});

test('livre : archiverVerrouiller écrit locked et archived dans buch.yaml', async () => {
  const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
  const cheminBuch = path.join(LIVRE, 'buch.yaml');
  const avant = yaml.etatRevue(LIVRE);
  assert.strictEqual(avant.verrouillee, false, 'le livre d’essai ne devrait pas déjà être verrouillé');
  assert.strictEqual(avant.archivee, false, 'le livre d’essai ne devrait pas déjà être archivé');

  try {
    // Le libellé exact du bouton (fr, langue par défaut du faux hôte) : modale.archiver.bouton.
    HOTE.repondreModale('Archiver et verrouiller');
    await HOTE.executer('szh.archiverVerrouiller');

    const brut = fs.readFileSync(cheminBuch, 'utf8');
    assert.match(brut, /locked:\s*"?true"?/, 'locked: true n’a pas été écrit dans buch.yaml : ' + brut);
    assert.match(brut, /archived:\s*"?true"?/, 'archived: true n’a pas été écrit dans buch.yaml : ' + brut);
    const apres = yaml.etatRevue(LIVRE);
    assert.strictEqual(apres.verrouillee, true, 'szh.verrouillee ne remonte pas verrouillé après archiverVerrouiller');
    assert.strictEqual(apres.archivee, true, 'szh.archivee ne remonte pas archivé après archiverVerrouiller');
    assert.ok(!fs.existsSync(path.join(LIVRE, 'ausgabe.yaml')),
      'un ausgabe.yaml parasite est apparu dans un livre archivé');
  } finally {
    // Remet le livre d’essai à son état de départ : d’autres tests de ce fichier — ou
    // ajoutés après celui-ci — comptent sur un livre ni verrouillé ni archivé.
    HOTE.repondreModale('Désarchiver');
    await HOTE.executer('szh.desarchiver');
    HOTE.repondreModale('Déverrouiller');
    await HOTE.executer('szh.deverrouiller');
    const restaure = yaml.etatRevue(LIVRE);
    assert.strictEqual(restaure.verrouillee, false, 'le nettoyage du test n’a pas déverrouillé le livre');
    assert.strictEqual(restaure.archivee, false, 'le nettoyage du test n’a pas désarchivé le livre');
  }
});
