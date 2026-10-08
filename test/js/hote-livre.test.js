// Le cockpit ouvert sur un livre : ce qu'il montre, et ce qu'il ne montre pas.
//
//   node --test test/js/hote-livre.test.js
//
// L'extension est réellement activée (hote-factice.js), sur un dossier qui porte un
// buch.yaml. Seul ce qui diffère d'un numéro est vérifié ici ; le reste est dans
// hote.test.js.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Neutralise le script de déplacement avant toute activation : lib/cycle-vie.js capture
// lancerArchivage par déstructuration au chargement. Sans cela, verrouiller ou archiver le
// livre d'essai lancerait le vrai archive-revue.ps1 du poste.
const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
archivage.lancerArchivage = () => null;

const { livreDEssai, activerHote } = require('./hote-factice');

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);
// La section des chapitres : la première entrée de l'arbre est « Métadonnées du livre ».
const sectionChapitres = (racine) => racine.find((it) => it.categorie === 'chapitres');

// langueRevue (lib/yaml.js) est un module pur : un dossier temporaire à part suffit, sans
// toucher à LIVRE, partagé par tout le fichier.
test('livre : langueRevue lit le fichier du profil (buch.yaml), pas ausgabe.yaml en dur', () => {
  const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
  const livre = fs.mkdtempSync(path.join(os.tmpdir(), 'szh-livre-langue-'));
  fs.writeFileSync(path.join(livre, 'buch.yaml'), 'titre: "Essai"\nlang: de\n');
  assert.strictEqual(yaml.langueRevue(livre), 'de',
    'un livre « lang: de » doit donner « de », pas le repli français d’un ausgabe.yaml absent');
});

// La vue latérale doit s'afficher sur un livre, pas seulement sur une revue.
test('livre : les deux clés de contexte sont posées, et elles s’excluent', () => {
  const ctx = HOTE.contexte();
  assert.strictEqual(ctx['szh.estLivre'], true, 'szh.estLivre n’est pas posé sur un livre');
  assert.strictEqual(ctx['szh.estRevue'], false,
    'szh.estRevue reste vrai sur un livre : les deux vues s’afficheraient ensemble');
});

test('livre : chaque capacité de la table est posée en szh.peut.*, à la valeur du livre', () => {
  const ctx = HOTE.contexte();
  const { PROFILS } = require(path.join(COCKPIT, 'lib', 'profil.js'));
  for (const [c, v] of Object.entries(PROFILS.livre.capacites)) {
    assert.strictEqual(ctx['szh.peut.' + c], v, 'szh.peut.' + c + ' mal posé sur un livre');
  }
});

// Pas de section « Traductions » pour un livre : un livre est écrit dans une langue, et sa
// traduction est un autre livre, avec son ISBN.
test('livre : l’arbre montre Chapitres et Word, jamais Traductions', async () => {
  const arbre = HOTE.arbre();
  assert.ok(arbre, 'aucun fournisseur d’arbre enregistré');
  const racine = await arbre.getChildren();
  // Le raccourci « À corriger » n'est pas une section d'accordéon : il n'a pas de catégorie.
  const categories = racine.filter((it) => it.categorie).map((it) => it.categorie);
  assert.deepStrictEqual(categories, ['chapitres', 'word'],
    'sections attendues pour un livre : chapitres puis word — obtenu ' + categories.join(', '));
});

test('livre : la section des unités s’appelle « chapitres », pas « articles »', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const section = sectionChapitres(racine);
  assert.strictEqual(section.contextValue, 'section-chapitres');
  assert.match(String(section.label), /CHAPITRES/i,
    'le titre de section ne dit pas « chapitres » : ' + section.label);
});

// Sur un livre, l'accordéon s'ouvre sur les chapitres, la catégorie « articles » n'existant
// pas.
test('livre : la section des chapitres est dépliée à l’ouverture', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  assert.strictEqual(sectionChapitres(racine).collapsibleState, 2,
    'la section des chapitres n’est pas dépliée (2 = Expanded)');
});

test('livre : les chapitres du dossier sont listés', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(sectionChapitres(racine));
  const slugs = enfants.map((it) => it.slug).filter(Boolean);
  assert.deepStrictEqual(slugs.sort(), ['01-ouverture', '02-suite'],
    'les chapitres ne sont pas lus dans chapitres/ — obtenu ' + slugs.join(', '));
});

// Le chemin d'un chapitre est chapitres/<slug>/<slug>.md (dossierUnites()). L'élément de
// l'arbre porte l'URI du .md dans `resourceUri` ; la commande ne reçoit que le slug.
test('livre : un chapitre pointe sur chapitres/<slug>/<slug>.md', async () => {
  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(sectionChapitres(racine));
  const premier = enfants.find((it) => it.slug === '01-ouverture');
  assert.ok(premier, 'le chapitre 01-ouverture n’est pas dans l’arbre');
  const cible = String((premier.resourceUri && premier.resourceUri.fsPath) || '');
  assert.ok(cible, 'le chapitre ne porte aucun fichier');
  assert.ok(cible.indexOf(path.join('chapitres', '01-ouverture', '01-ouverture.md')) !== -1,
    'le chapitre ne pointe pas dans chapitres/ : ' + cible);
  assert.ok(cible.indexOf(path.sep + 'articles' + path.sep) === -1,
    'le chapitre pointe encore dans articles/ : ' + cible);
});

// Sur un livre, les surveillants de fichiers portent sur les chemins du livre. Surveiller
// un chemin absent ne lève aucune erreur : l'arbre ne se rafraîchirait simplement plus.
// Les surveillants sont posés par majContexte(), après le réveil de la WSL, donc après le
// retour d'activerHote() : le test attend leur pose.
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

// Le déplacement d'un chapitre, de bout en bout : cheminConfig écrit dans buch.yaml,
// cleOrdre() nomme `ordre-chapitres`, et analyserAusgabe garde cette clé.
test('livre : descendre un chapitre écrit ordre-chapitres dans buch.yaml', async () => {
  const fs = require('fs');
  const avant = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  assert.ok(avant.indexOf('ordre-chapitres') !== -1, 'le livre d’essai n’a pas la clé');

  // Le chemin que prend la vue des chapitres (bouton Descendre de la carte).
  const { deplacerUnite } = require(path.join(COCKPIT, 'lib', 'vue-articles-hote.js'));
  const message = deplacerUnite(HOTE.arbre(), '01-ouverture', 1, null);
  assert.ok(message, 'le déplacement n’a rien dit : rien n’a été écrit');

  const apres = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  const ligne = apres.split(/\r?\n/).find((l) => l.indexOf('ordre-chapitres:') === 0);
  assert.ok(ligne, 'ordre-chapitres a disparu de buch.yaml');
  assert.ok(ligne.indexOf('02-suite') < ligne.indexOf('01-ouverture'),
    'le chapitre n’a pas été descendu : ' + ligne);
  // Aucun ausgabe.yaml ne doit apparaître : avec les deux configurations, profil.js et le
  // Makefile tiendraient le dossier pour ambigu.
  assert.ok(!fs.existsSync(path.join(LIVRE, 'ausgabe.yaml')),
    'un ausgabe.yaml parasite a été créé dans un livre');
});

// Un chapitre n'a pas de DOI : ni le calcul, ni le fichier dérivé que szh-maquette.lua lit
// pour le bandeau DOI d'une revue.
test('livre : doisCalculesArticles ne calcule rien, ecrireDoisCalcules n’écrit rien', () => {
  const fs = require('fs');
  const ext = require(path.join(COCKPIT, 'extension.js'));
  const fournisseur = { racine: LIVRE, listerArticles: () => ['01-ouverture', '02-suite'] };

  assert.deepStrictEqual(ext._pur.doisCalculesArticles(fournisseur), {},
    'doisCalculesArticles calcule des DOI pour un livre');

  const chemin = path.join(LIVRE, 'dois-calcules.yaml');
  ext._pur.ecrireDoisCalcules(fournisseur);
  assert.ok(!fs.existsSync(chemin), 'dois-calcules.yaml a été écrit pour un livre');
});

// Le formulaire d'un chapitre n'a pas de champs type/licence/doi/keywords
// (media/_fiches.js) : la webview les renvoie vides. Si la fiche porte ces clés,
// l'enregistrement les garde (ecrireCartesArticles, lib/metadonnees-hote.js).
test('livre : sauvegarder une fiche de chapitre ne vide ni n’efface type/licence/doi/keywords hérités', async () => {
  const fs = require('fs');
  const fichierMeta = path.join(LIVRE, 'chapitres', '02-suite', '02-suite.meta.yaml');
  fs.writeFileSync(fichierMeta, [
    'type: article', 'lang: fr', 'licence: droits-reserves', 'doi: "10.57161/heritee"',
    'title:', '  fr: "Suite"', 'keywords:', '  fr:', '  - "inclusion"', ''
  ].join('\n'));

  await HOTE.arbre().getChildren();
  await HOTE.executer('szh.apercuMetadonnees');
  const p = HOTE.panneauDeType('szhApercuMetadonnees');
  await p._recepteur({ type: 'pret' });

  // Ce que collecter() renvoie pour une carte de chapitre : les quatre champs absents du
  // formulaire, à leur valeur par défaut (voir sommaire-chapitre.test.js).
  await p._recepteur({
    type: 'enregistrer', auto: true,
    articles: {
      '02-suite': {
        type: '', lang: 'fr', licence: '', doi: '', horsSommaire: false,
        title: { fr: 'Suite modifiée' }, subtitle: {}, resume: {}, keywords: {}, author: []
      }
    }
  });

  const yaml = require(path.join(COCKPIT, 'lib', 'yaml.js'));
  const apres = yaml.analyserMeta(fs.readFileSync(fichierMeta, 'utf8'));
  assert.strictEqual(apres.type, 'article', 'le type hérité a été effacé par l’enregistrement');
  assert.strictEqual(apres.licence, 'droits-reserves', 'la licence héritée a été effacée');
  assert.strictEqual(apres.doi, '10.57161/heritee', 'le DOI hérité a été effacé');
  assert.deepStrictEqual(apres.keywords, { fr: ['inclusion'] }, 'les mots-clés hérités ont été effacés');
  // Le reste de l'enregistrement a bien eu lieu.
  assert.strictEqual(apres.title.fr, 'Suite modifiée', 'le titre modifié n’a pas été écrit');

  // L’enregistrement relance la compilation du chapitre ; on termine la tâche, sinon le
  // verrou de compilation resterait posé pour les tests suivants.
  await new Promise((r) => setImmediate(r));
  await HOTE.finirTache('Aperçu du chapitre — 02-suite', 0);
});

// La bibliographie d'un chapitre se cherche sous chapitres/<slug>/ (même contrôle que
// biblio.test.js côté revue).
test('livre : la bibliographie d’un chapitre apparaît sous lui dans l’arbre', async () => {
  const fs = require('fs');
  const dossier = path.join(LIVRE, 'chapitres', '01-ouverture');
  fs.writeFileSync(path.join(dossier, '01-ouverture.biblio.md'),
    ['Dupont, A. (2024). *Un titre*. SZH.', ''].join('\n'));

  const arbre = HOTE.arbre();
  const racine = await arbre.getChildren();
  const enfants = await arbre.getChildren(sectionChapitres(racine));
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
// ouvrirArticle doit trouver l'aperçu du chapitre au chemin que donne chemins()
// (lib/profil.js), sans relancer de compilation quand il est à jour.
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const tick = () => new Promise((r) => setImmediate(r));

test('livre : un chapitre déjà compilé ouvre son PDF sans lancer aucune tâche', async () => {
  const dossierOut = path.join(LIVRE, 'out', 'chapitres');
  fs.mkdirSync(dossierOut, { recursive: true });
  const pdf = path.join(dossierOut, '01-ouverture.pdf');
  fs.writeFileSync(pdf, '%PDF-1.7\n');
  // Plus récent que le .md : ouvrirArticle ne doit rien trouver d’obsolète.
  const futur = (Date.now() + 60000) / 1000;
  fs.utimesSync(pdf, futur, futur);

  const origExecute = HOTE.stub.tasks.executeTask;
  let appels = 0;
  HOTE.stub.tasks.executeTask = (t) => { appels++; return origExecute(t); };
  try {
    await HOTE.executer('szh.ouvrirArticle', '01-ouverture');
    assert.strictEqual(appels, 0,
      'un PDF de chapitre déjà présent et à jour ne doit lancer aucune tâche');
    assert.ok(HOTE.ouvertures().map(String).some((o) => o.toLowerCase() === pdf.toLowerCase()),
      'le PDF out/chapitres/01-ouverture.pdf, le bon fichier pour un chapitre, ne s’est pas ouvert');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
  }
});

test('livre : un chapitre sans PDF ne lance qu’UNE tâche, celle du chapitre', async () => {
  const dossierOut = path.join(LIVRE, 'out', 'chapitres');
  fs.rmSync(path.join(LIVRE, 'out'), { recursive: true, force: true });   // rien compilé

  const origExecute = HOTE.stub.tasks.executeTask;
  let appels = 0;
  let nomTache = null;
  HOTE.stub.tasks.executeTask = (t) => {
    appels++;
    nomTache = t && t.name;
    // Ce qu’une vraie compilation écrirait : le PDF du chapitre, et lui seul.
    fs.mkdirSync(dossierOut, { recursive: true });
    fs.writeFileSync(path.join(dossierOut, '02-suite.pdf'), '%PDF-1.7\n');
    return origExecute(t);
  };
  try {
    const promesse = HOTE.executer('szh.ouvrirArticle', '02-suite');
    await tick(); await tick();
    await HOTE.finirTache(nomTache, 0);
    await promesse;
    await tick(); await tick();
    assert.strictEqual(appels, 1,
      'un PDF absent doit déclencher UNE compilation, jamais deux — celle que la '
      + 'compilation vient d’écrire doit être vue, pas cherchée au mauvais endroit');
    assert.notStrictEqual(nomTache, NOM_TACHE_BUILD, 'le livre entier a été recompilé');
  } finally {
    HOTE.stub.tasks.executeTask = origExecute;
  }
});

// ---- Quatre tâches sans équivalent côté revue ----------------------------------------

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

// ---- Réglages : quatre blocs propres à une revue/Zeitschrift, absents pour un livre ---
//
// Pas d'OJS pour un livre : ni auteur·e·s publiés, ni bibliographie par revue, ni tâches
// par article, ni export OJS. L'Accueil (lib/accueil-reglages-hote.js) n'envoie pas ces
// quatre clés, et l'onglet Paramètres (media/accueil.js) masque un bloc dont la clé manque.
test('livre : le panneau Réglages n’envoie ni ojs, ni biblio, ni taches, ni auteursOjs', async () => {
  await HOTE.executer('szh.reglages');
  const p = HOTE.panneauDeType('szhAccueil');
  assert.ok(p, 'Accueil absent (szh.reglages) pour un livre');
  await p._recepteur({ type: 'pret' });
  const valeurs = p.messages.filter((m) => m.type === 'valeurs').pop();
  assert.ok(valeurs, 'aucun message de valeurs envoyé au panneau des réglages');
  assert.strictEqual(valeurs.ojs, undefined, 'le bloc export OJS est envoyé pour un livre');
  assert.strictEqual(valeurs.biblio, undefined, 'le bloc bibliographie est envoyé pour un livre');
  assert.strictEqual(valeurs.taches, undefined, 'le bloc tâches par article est envoyé pour un livre');
  assert.strictEqual(valeurs.auteursOjs, undefined, 'le bloc auteur·e·s publiés est envoyé pour un livre');
  // Les réglages génériques restent envoyés : ce n'est pas un panneau vide.
  assert.ok(valeurs.valeurs, 'les réglages génériques ont disparu pour un livre');
  assert.ok(valeurs.proteges, 'l’état des réglages protégés a disparu pour un livre');
  assert.ok(valeurs.suggInterface !== undefined && valeurs.avertLangue !== undefined,
    'les champs communs de l’Accueil (suggestions, langue) ont disparu pour un livre');
});

// ---- Le walkthrough de démarrage : aucun tutoriel pour un livre ----------------------
//
// Le `when` du walkthrough (package.json) ne filtre que la page « Get Started » :
// `workbench.action.openWalkthrough` ouvre l'éditeur sans lire de contexte.
// proposerTutoriel() (extension.js) porte donc sa propre garde de profil.
test('livre : proposerTutoriel n’invite jamais (le tutoriel n’a pas de sens pour un livre)', async () => {
  const ext = require(path.join(COCKPIT, 'extension.js'));
  let invitations = 0;
  const original = HOTE.stub.window.showInformationMessage;
  HOTE.stub.window.showInformationMessage = () => { invitations++; return Promise.resolve(undefined); };
  let consomme = false;
  const contexte = { globalState: {
    get: () => undefined, update: () => { consomme = true; return Promise.resolve(); }
  } };
  try {
    await ext._pur.proposerTutoriel(contexte);
    assert.strictEqual(invitations, 0, 'l’invitation au tutoriel s’est affichée pour un livre');
    // Le drapeau « vu » reste libre : une revue ouverte plus tard recevra l’invitation.
    assert.strictEqual(consomme, false,
      'le drapeau « tutoriel vu » a été posé pour un livre : une revue ouverte ensuite ne serait plus invitée');
  } finally {
    HOTE.stub.window.showInformationMessage = original;
  }
});

// ---- Cycle de vie (archiver/verrouiller/désarchiver) exposé pour un livre -----------
//
// windows/archive-revue.ps1 sait archiver un livre. Le panneau Export offre les commandes,
// avec des libellés qui parlent du livre, et la commande écrit locked/archived dans
// buch.yaml.
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

  // szh.deverrouiller/szh.desarchiver n’apparaissent pas : le livre n’est ni verrouillé ni
  // archivé.
  assert.ok(!items.some((it) => it.commande === 'szh.deverrouiller'),
    'szh.deverrouiller apparaît alors que le livre d’essai n’est pas verrouillé');
  assert.ok(!items.some((it) => it.commande === 'szh.desarchiver'),
    'szh.desarchiver apparaît alors que le livre d’essai n’est pas archivé');
});

// Les panneaux retirent ce que la palette réserve à une capacité absente du livre
// (szh.peut.* de commandPalette, lib/panneaux.js).
test('livre : les panneaux n’offrent aucune commande réservée à une capacité de la revue', async () => {
  const { PROFILS } = require(path.join(COCKPIT, 'lib', 'profil.js'));
  const pkg = require(path.join(COCKPIT, 'package.json'));
  const interdites = pkg.contributes.menus.commandPalette
    .filter((e) => /^szh\.peut\.(\w+)$/.test(e.when || '')
      && PROFILS.livre.capacites[e.when.slice('szh.peut.'.length)] === false)
    .map((e) => e.command);
  assert.ok(interdites.includes('szh.traduction') && interdites.includes('szh.exporterXml'));
  const original = HOTE.stub.window.showQuickPick;
  const vus = [];
  HOTE.stub.window.showQuickPick = (its) => { vus.push(...its); return Promise.resolve(undefined); };
  try {
    await HOTE.executer('szh.panneauCommande');
    await HOTE.executer('szh.panneauExport');
  } finally {
    HOTE.stub.window.showQuickPick = original;
  }
  assert.ok(vus.length > 0, 'aucun panneau ouvert');
  for (const it of vus) {
    assert.ok(!interdites.includes(it.commande), it.commande + ' offerte dans un panneau de livre');
  }
  assert.ok(vus.some((it) => it.commande === 'szh.livreEpub'), 'les sorties du livre manquent au panneau Export');
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

// « Changer l'ordre » / « Terminer » passe par un autre chemin que « Monter » /
// « Descendre » : alignerDossiersSurOrdre() (extension.js) appelle lib/renumerotation-fs.js,
// qui renomme les dossiers et écrit l'ordre. Sur un livre, l'ordre va dans buch.yaml.
//
// Ce test reste le dernier du fichier : il renomme les dossiers du livre d'essai
// (01-ouverture/02-suite -> 00-.../01-...), dont dépendent les tests précédents.
test('livre : « Terminer » renomme les dossiers et écrit ordre-chapitres dans buch.yaml', async () => {
  const fs = require('fs');
  const derniereCharge = (p) => p.messages.filter((m) => m.type === 'valeurs').pop();
  await HOTE.executer('szh.vueArticles');
  const p = HOTE.panneauDeType('szhVueArticles');
  await p._recepteur({ type: 'pret' });
  const avant = derniereCharge(p).lignes.map((l) => l.cle);
  assert.ok(avant.length >= 2, 'le livre d’essai n’a pas deux chapitres à échanger');

  await p._recepteur({ type: 'commande', id: 'ordre' });
  await p._recepteur({ type: 'action', cle: avant[1], id: 'monter' });
  await p._recepteur({ type: 'commande', id: 'ordre-terminer' });

  // Après « Terminer », les dossiers portent le rang qu'ils affichaient (même contrôle
  // que dans articles.test.js).
  const apres = derniereCharge(p).lignes.map((l) => l.cle);
  assert.deepStrictEqual(fs.readdirSync(path.join(LIVRE, 'chapitres')).sort(), apres.slice().sort(),
    'le disque et l’écran ne disent pas la même chose après « Terminer »');

  const buch = fs.readFileSync(path.join(LIVRE, 'buch.yaml'), 'utf8');
  const ligne = buch.split(/\r?\n/).find((l) => l.indexOf('ordre-chapitres:') === 0);
  assert.ok(ligne, 'ordre-chapitres a disparu de buch.yaml après « Terminer »');
  apres.forEach((slug) => assert.ok(ligne.indexOf(slug) !== -1,
    'le chapitre « ' + slug + '» manque dans ordre-chapitres : ' + ligne));
  // ecrireOrdre() (lib/renumerotation-fs.js) ne doit pas créer d'ausgabe.yaml.
  assert.ok(!fs.existsSync(path.join(LIVRE, 'ausgabe.yaml')),
    'un ausgabe.yaml parasite a été créé par « Terminer » dans un livre');
});
