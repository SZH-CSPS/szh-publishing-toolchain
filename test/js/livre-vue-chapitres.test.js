// La vue CHAPITRES d'un livre et l'aperçu d'un chapitre seul.
//
//   node --test test/js/livre-vue-chapitres.test.js
//
// Trois gestes qu'une revue n'a pas : le clic sur un chapitre ne compile que ce chapitre
// (make livre-chapitre-pdf CHAPITRE=<slug>, out/chapitres/<slug>.pdf), le clic sur l'en-tête
// CHAPITRES ouvre une vue de cartes lue dans les fiches <slug>.meta.yaml et dans l'ordre de
// buch.yaml, et le formulaire du livre s'atteint depuis l'arbre sans passer par la palette.
// La revue, elle, garde ce qu'elle faisait : ses assertions vivent dans hote.test.js, et
// les deux tables de profil ci-dessous disent qu'elle n'y gagne aucune entrée.
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const COCKPIT = path.resolve(__dirname, '..', '..', 'vscodium-extension', 'szh-cockpit');

// Comme hote-livre.test.js : le script de déplacement du toolkit ne doit pas partir pour de
// vrai, et il se capture au chargement de lib/cycle-vie.js.
const archivage = require(path.join(COCKPIT, 'lib', 'archivage.js'));
archivage.lancerArchivage = () => null;

const profil = require(path.join(COCKPIT, 'lib', 'profil.js'));
const { livreDEssai, activerHote } = require('./hote-factice');

const LIVRE = livreDEssai();
const HOTE = activerHote(LIVRE);
const tick = () => new Promise((r) => setImmediate(r));
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';

// ---- La table de profil ----------------------------------------------------------------

test('vue d’une section : le livre a la sienne pour « chapitres », la revue n’en gagne aucune', () => {
  assert.strictEqual(profil.vueDeSection('livre', 'chapitres'), 'szh.vueChapitres',
    'cliquer CHAPITRES ne mène à aucune vue : l’en-tête ne ferait que se déplier');
  assert.strictEqual(profil.vueDeSection('revue', 'articles'), 'szh.vueArticles');
  assert.strictEqual(profil.vueDeSection('revue', 'chapitres'), null,
    'une revue n’a pas de section « chapitres »');
  assert.strictEqual(profil.vueDeSection('livre', 'articles'), null,
    'un livre n’a pas de section « articles »');
  // Les deux sections communes ne dépendent pas du profil.
  for (const cle of ['revue', 'livre']) {
    assert.strictEqual(profil.vueDeSection(cle, 'word'), 'szh.vueWord');
  }
  assert.strictEqual(profil.vueDeSection('revue', 'traductions'), 'szh.vueTraductions');
  assert.strictEqual(profil.vueDeSection('revue', 'actualite'), null);
});

test('aperçu d’une unité : un chapitre vise sa propre cible et son propre PDF', () => {
  const a = profil.apercuUnite('livre', '/w/mon-livre', '02-suite');
  assert.strictEqual(a.cible, 'livre-chapitre-pdf');
  assert.deepStrictEqual(a.variables, ['CHAPITRE=02-suite']);
  assert.strictEqual(a.pdf, path.join('/w/mon-livre', 'out', 'chapitres', '02-suite.pdf'));
  assert.notStrictEqual(a.pdf, profil.pdfLivre('/w/mon-livre'),
    'le PDF d’un chapitre ne doit plus être celui du livre entier');
  // Le PDF du livre, lui, reste celui que PDF/UA valide.
  assert.strictEqual(profil.chemins('livre', '/w/mon-livre', '02-suite').pdf,
    profil.pdfLivre('/w/mon-livre'));
});

test('aperçu d’une unité : la revue garde son PDF d’article et son build complet', () => {
  const a = profil.apercuUnite('revue', '/w/r', '01-essai');
  assert.strictEqual(a.cible, null, 'une revue n’a pas de cible dédiée : make all, comme avant');
  assert.deepStrictEqual(a.variables, []);
  assert.strictEqual(a.pdf, path.join('/w/r', 'out', '01-essai', '01-essai.pdf'));
});

test('aperçu d’une unité : un slug qui ouvrirait le shell est refusé', () => {
  for (const mauvais of ['a b', 'x;rm -rf', "o'brien", '$(id)', '', '../x']) {
    assert.throws(() => profil.apercuUnite('livre', '/w/l', mauvais), TypeError,
      'le slug « ' + mauvais + ' » serait collé dans une ligne bash');
  }
});

// ---- Le clic sur un chapitre -------------------------------------------------------------

// Pose le PDF d'un chapitre avec une date donnée (secondes depuis 1970).
function poserPdfChapitre(slug, quand) {
  const dossier = path.join(LIVRE, 'out', 'chapitres');
  fs.mkdirSync(dossier, { recursive: true });
  const pdf = path.join(dossier, slug + '.pdf');
  fs.writeFileSync(pdf, '%PDF-1.7\n');
  fs.utimesSync(pdf, quand, quand);
  return pdf;
}

// Remplace executeTask pour noter chaque tâche lancée, le temps d'un geste.
function espionnerTaches() {
  const origine = HOTE.stub.tasks.executeTask;
  const lancees = [];
  HOTE.stub.tasks.executeTask = (t) => { lancees.push(t); return origine(t); };
  return { lancees, rendre: () => { HOTE.stub.tasks.executeTask = origine; } };
}

function ligneDeCommande(tache) {
  return tache && tache.execution ? [tache.execution.process].concat(tache.execution.args).join(' ') : '';
}

test('clic sur un chapitre périmé : ne lance que livre-chapitre-pdf CHAPITRE=<slug>, puis ouvre out/chapitres/<slug>.pdf', async () => {
  fs.rmSync(path.join(LIVRE, 'out'), { recursive: true, force: true });
  const espion = espionnerTaches();
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_TACHE_BUILD }]);
  try {
    const promesse = HOTE.executer('szh.ouvrirArticle', '02-suite');
    await tick(); await tick();
    assert.strictEqual(espion.lancees.length, 1, 'une seule tâche attendue, obtenu ' + espion.lancees.length);
    const tache = espion.lancees[0];
    assert.notStrictEqual(tache.name, NOM_TACHE_BUILD,
      'le clic a relancé « Aperçu / Export PDF » : make all recompile TOUT le livre');
    const ligne = ligneDeCommande(tache);
    assert.ok(ligne.indexOf('livre-chapitre-pdf CHAPITRE=02-suite') !== -1,
      'la commande ne vise pas la cible du chapitre : ' + ligne);
    assert.ok(!/\sall(\s|$)/.test(ligne), 'la commande contient encore la cible all : ' + ligne);
    assert.ok(ligne.indexOf('.szh-journal.log') !== -1,
      'la tâche n’écrit pas le journal que le cockpit relit à la fin');
    assert.strictEqual(tache.definition.type, 'szh',
      'la tâche doit être suivie comme les autres (verrou de compilation, voile « À corriger »)');

    // La chaîne écrit le PDF du chapitre, la tâche se termine.
    poserPdfChapitre('02-suite', Date.now() / 1000 + 60);
    await HOTE.finirTache(tache.name, 0);
    await promesse;
    await tick(); await tick();

    const ouvert = HOTE.ouvertures().map(String);
    const attendu = path.join(LIVRE, 'out', 'chapitres', '02-suite.pdf');
    assert.ok(ouvert.some((o) => o.toLowerCase() === attendu.toLowerCase()),
      'le PDF du chapitre n’a pas été ouvert (' + attendu + ') : ' + ouvert.join(' | '));
    assert.ok(!ouvert.some((o) => /essai-livre\.pdf/i.test(o)),
      'le PDF du livre entier s’est ouvert à la place de celui du chapitre');
  } finally {
    espion.rendre();
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

test('clic sur un chapitre dont le PDF est à jour : aucune tâche', async () => {
  poserPdfChapitre('01-ouverture', Date.now() / 1000 + 120);
  const espion = espionnerTaches();
  try {
    await HOTE.executer('szh.ouvrirArticle', '01-ouverture');
    await tick(); await tick();
    assert.strictEqual(espion.lancees.length, 0,
      'un PDF de chapitre à jour ne doit déclencher aucune compilation : '
      + espion.lancees.map(ligneDeCommande).join(' | '));
    const attendu = path.join(LIVRE, 'out', 'chapitres', '01-ouverture.pdf');
    assert.ok(HOTE.ouvertures().map(String).some((o) => o.toLowerCase() === attendu.toLowerCase()),
      'le PDF à jour du chapitre n’a pas été ouvert');
  } finally { espion.rendre(); }
});

test('clic sur un chapitre dont la fiche est plus récente que le PDF : le chapitre seul est recompilé', async () => {
  poserPdfChapitre('01-ouverture', Date.now() / 1000 - 3600);
  const meta = path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.meta.yaml');
  fs.writeFileSync(meta, 'title:\n  fr: "Ouverture"\n');
  const espion = espionnerTaches();
  HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_TACHE_BUILD }]);
  try {
    const promesse = HOTE.executer('szh.ouvrirArticle', '01-ouverture');
    await tick(); await tick();
    assert.strictEqual(espion.lancees.length, 1);
    assert.ok(ligneDeCommande(espion.lancees[0]).indexOf('CHAPITRE=01-ouverture') !== -1);
    poserPdfChapitre('01-ouverture', Date.now() / 1000 + 120);
    await HOTE.finirTache(espion.lancees[0].name, 0);
    await promesse;
  } finally {
    espion.rendre();
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
  }
});

// ---- Ctrl+S sur un fichier de chapitre ----------------------------------------------------

test('Ctrl+S sur le .md ou la fiche d’un chapitre : la cible du chapitre, jamais make all', async () => {
  for (const nom of ['02-suite.md', '02-suite.meta.yaml']) {
    poserPdfChapitre('02-suite', Date.now() / 1000 - 3600);
    const fichier = path.join(LIVRE, 'chapitres', '02-suite', nom);
    if (!fs.existsSync(fichier)) { fs.writeFileSync(fichier, 'title:\n  fr: "Suite"\n'); }
    const espion = espionnerTaches();
    HOTE.stub.tasks.fetchTasks = () => Promise.resolve([{ name: NOM_TACHE_BUILD }]);
    try {
      HOTE.enregistrerDocument(fichier);
      await tick(); await tick(); await tick();
      assert.strictEqual(espion.lancees.length, 1,
        nom + ' : une tâche attendue, obtenu ' + espion.lancees.length);
      const ligne = ligneDeCommande(espion.lancees[0]);
      assert.ok(ligne.indexOf('livre-chapitre-pdf CHAPITRE=02-suite') !== -1, nom + ' : ' + ligne);
      await HOTE.finirTache(espion.lancees[0].name, 0);
      await tick(); await tick();
    } finally {
      espion.rendre();
      HOTE.stub.tasks.fetchTasks = () => Promise.resolve([]);
    }
  }
});

test('Ctrl+S sur autre chose qu’un fichier de chapitre : le cockpit ne lance rien', async () => {
  const espion = espionnerTaches();
  try {
    HOTE.enregistrerDocument(path.join(LIVRE, 'buch.yaml'));
    HOTE.enregistrerDocument(path.join(LIVRE, 'notes.md'));
    await tick(); await tick(); await tick();
    assert.strictEqual(espion.lancees.length, 0,
      'un fichier hors chapitre a lancé : ' + espion.lancees.map(ligneDeCommande).join(' | '));
  } finally { espion.rendre(); }
});

// ---- L'arbre ---------------------------------------------------------------------------------

test('arbre : cliquer l’en-tête CHAPITRES ouvre la vue des chapitres', async () => {
  const racine = await HOTE.arbre().getChildren();
  const section = racine.find((it) => it.categorie === 'chapitres');
  assert.ok(section, 'pas de section chapitres');
  assert.strictEqual(section.command.command, 'szh.ouvrirSection');
  HOTE.oublierCommandes();
  await HOTE.executer('szh.ouvrirSection', 'chapitres');
  assert.ok(HOTE.commandesJouees().some((c) => c.id === 'szh.vueChapitres'),
    'szh.ouvrirSection n’a pas lancé szh.vueChapitres : ' + JSON.stringify(HOTE.commandesJouees()));
});

test('arbre : une entrée « Métadonnées du livre » en tête ouvre le formulaire du livre', async () => {
  const racine = await HOTE.arbre().getChildren();
  const premier = racine[0];
  assert.strictEqual(premier.contextValue, 'meta-livre',
    'la première entrée de l’arbre n’est pas celle des métadonnées du livre : ' + premier.contextValue);
  assert.strictEqual(premier.command.command, 'szh.metadonnees');
  assert.strictEqual(premier.collapsibleState, 0, 'l’entrée ne doit rien déplier');
  assert.ok(!premier.categorie, 'elle ne compte pas comme une section d’accordéon');
});

test('arbre : une revue n’a pas cette entrée (contrôle de source)', () => {
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  assert.match(src, /profilCourant\(\)\.cle === 'livre'[\s\S]{0,300}_itemMetaLivre/,
    'l’entrée n’est pas réservée au profil livre');
});

// ---- Le chargeur de la vue -------------------------------------------------------------------

test('vue des chapitres : une carte par chapitre, dans l’ordre de buch.yaml, titre lu dans la fiche, sans ausgabe.yaml', async () => {
  fs.writeFileSync(path.join(LIVRE, 'buch.yaml'),
    ['titre: "Essai de livre"', 'ouvrage: monographie', 'lang: fr', 'maquette: normal',
     'format: standard', 'annee: 2026', 'ordre-chapitres: [02-suite, 01-ouverture]', ''].join('\n'));
  fs.writeFileSync(path.join(LIVRE, 'chapitres', '01-ouverture', '01-ouverture.meta.yaml'),
    ['lang: fr', 'title:', '  fr: "Ouverture du livre"', 'subtitle:', '  fr: "Un seuil"', 'resume:',
     '  fr: "Le résumé du premier chapitre."', 'author:', '- prenom: "Anne"', '  nom: "Martin"',
     '  fonction: ""', '  affiliation: "HEP"', '  orcid: ""', ''].join('\n'));
  fs.writeFileSync(path.join(LIVRE, 'chapitres', '02-suite', '02-suite.meta.yaml'),
    ['lang: fr', 'sommaire: non', 'title:', '  fr: "La suite"', ''].join('\n'));
  // Le .md ne porte plus le titre : s'il était lu, ces cartes porteraient « Un titre de chapitre ».
  const ext = require(path.join(COCKPIT, 'extension.js'));
  assert.strictEqual(typeof ext._pur.chargeChapitres, 'function', 'chargeChapitres n’est pas exposée');

  const lus = [];
  const lire = fs.readFileSync;
  fs.readFileSync = function (p, ...reste) { lus.push(String(p)); return lire.call(fs, p, ...reste); };
  let charge;
  try { charge = ext._pur.chargeChapitres(HOTE.arbre()); }
  finally { fs.readFileSync = lire; }

  assert.ok(!lus.some((p) => /ausgabe\.yaml$/.test(p)), 'la vue du livre a lu ausgabe.yaml');
  assert.deepStrictEqual(charge.lignes.map((l) => l.cle), ['02-suite', '01-ouverture'],
    'l’ordre n’est pas celui de ordre-chapitres');

  const texte = (l) => JSON.stringify(l.apercu);
  const ouverture = charge.lignes[1];
  assert.match(ouverture.titre, /Ouverture du livre/, 'le titre n’est pas celui de la fiche : ' + ouverture.titre);
  assert.doesNotMatch(ouverture.titre, /Un titre de chapitre/);
  assert.match(texte(ouverture), /Un seuil/, 'le sous-titre manque');
  assert.match(texte(ouverture), /Anne Martin/, 'les auteurs manquent');
  assert.match(texte(ouverture), /Le résumé du premier chapitre/, 'le résumé manque');
  assert.match(texte(charge.lignes[0]), /La suite/);

  // Hors sommaire : lu de la fiche, par chapitre.
  const hors = (l) => l.apercu.lignes.find((x) => /sommaire/i.test(x.libelle));
  assert.ok(hors(ouverture) && hors(charge.lignes[0]), 'la ligne « hors sommaire » manque');
  assert.notStrictEqual(JSON.stringify(hors(ouverture)), JSON.stringify(hors(charge.lignes[0])),
    'les deux chapitres (l’un hors sommaire) affichent la même chose');

  // Pas de DOI ni de rang DOI, pas de case « pas de DOI », pas de tâches de revue.
  for (const l of charge.lignes) {
    assert.ok(!/DOI/i.test(JSON.stringify(l.apercu)), 'une carte de chapitre parle de DOI');
    assert.strictEqual(l.sansDoi, undefined, 'case « pas de DOI » sur un chapitre');
  }
  // Les trois boutons du livre.
  const ids = charge.boutons.map((b) => b.id);
  for (const id of ['livre-compiler', 'livre-pdf', 'livre-couverture']) {
    assert.ok(ids.indexOf(id) !== -1, 'bouton « ' + id + ' » absent : ' + ids.join(', '));
  }
  assert.strictEqual(charge.livre, true, 'la page ne sait pas qu’elle montre un livre');
});

test('vue des chapitres : les boutons mènent à la compilation du livre, au PDF du livre, à la couverture', async () => {
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  assert.match(src, /'livre-compiler'/);
  assert.match(src, /'livre-pdf'/);
  assert.match(src, /'livre-couverture'/);
});

// ---- Le manifeste ------------------------------------------------------------------------------

test('package.json : szh.vueChapitres existe, réservée au livre, avec son entrée de menu sur l’en-tête', () => {
  const pkg = require(path.join(COCKPIT, 'package.json'));
  const c = pkg.contributes;
  assert.ok(c.commands.some((x) => x.command === 'szh.vueChapitres'), 'commande non déclarée');
  const palette = c.menus.commandPalette.find((x) => x.command === 'szh.vueChapitres');
  assert.ok(palette && palette.when === 'szh.estLivre', 'la palette doit la réserver au livre');
  const ctx = c.menus['view/item/context'].find((x) => x.command === 'szh.vueChapitres');
  assert.ok(ctx && /section-chapitres/.test(ctx.when), 'pas de clic droit sur l’en-tête CHAPITRES');
  // La vue des articles reste réservée à la revue.
  const art = c.menus.commandPalette.find((x) => x.command === 'szh.vueArticles');
  assert.strictEqual(art.when, 'szh.estRevue');
});

// Le formulaire du livre monté dans la vue : il vient de lib/metadonnees-hote.js (lot D1).
// Tant que ses trois fonctions n'y sont pas exportées, la page ne peut pas s'ouvrir ; ce
// contrôle le dit au lieu de laisser une erreur obscure au premier clic.
test('vue des chapitres : le formulaire du livre est monté (SZH.formulaireLivre) et les fonctions de l’hôte sont exportées', () => {
  const hote = require(path.join(COCKPIT, 'lib', 'metadonnees-hote.js'));
  for (const nom of ['chargeLivre', 'messageLivre', 'textesLivre']) {
    assert.strictEqual(typeof hote[nom], 'function',
      'lib/metadonnees-hote.js doit exporter ' + nom + ' (elle sert la vue CHAPITRES)');
  }
  const js = fs.readFileSync(path.join(COCKPIT, 'media', 'articles.js'), 'utf8');
  assert.match(js, /SZH\.formulaireLivre\b/, 'media/articles.js ne monte pas le formulaire du livre');
  assert.match(js, /SZH\.formulaireNumero\b/,'le formulaire du numéro a disparu de la vue des articles');
});

// La page réelle, dans le DOM minimal, avec les textes et les données que l'hôte lui envoie
// pour un livre. Dépend des trois exports ci-dessus : sans eux l'hôte ne peut pas ouvrir la vue.
test('vue des chapitres (page) : formulaire du livre, intitulés du livre, une carte par chapitre sans DOI', async () => {
  const { ouvrir } = require('./dom-minimal');
  await HOTE.executer('szh.vueChapitres');
  const p = HOTE.panneauDeType('szhVueArticles');
  assert.ok(p, 'la vue des chapitres ne s’est pas ouverte');
  const m = String(p.html).match(/TXT = (\{[^\n]*\});/);
  assert.ok(m, 'la page ne reçoit pas sa table de textes');
  const txt = JSON.parse(m[1]);
  assert.strictEqual(txt.estLivre, true);

  await p._recepteur({ type: 'pret' });
  const valeurs = p.messages.filter((x) => x.type === 'valeurs').pop();
  assert.ok(valeurs && valeurs.lignes.length === 2, 'une carte par chapitre attendue');
  assert.ok(valeurs.valeurs && valeurs.valeurs.titre !== undefined,
    'les valeurs de buch.yaml (formulaire du livre) ne partent pas avec la vue');

  const page = ouvrir({
    racine: path.resolve(__dirname, '..', '..'), page: 'articles',
    cssPartage: ['_design.css', '_liste.css', '_numero.css', '_auteurs.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_numero.js'], txt: txt
  });
  page.envoyer(valeurs);
  const cles = [];
  const visiter = (e) => { if (e.dataset && e.dataset.cle !== undefined) { cles.push(e.dataset.cle); } (e.enfants || []).forEach(visiter); };
  visiter(page.parId.numero);
  assert.ok(cles.indexOf('maquette') !== -1 && cles.indexOf('ouvrage') !== -1,
    'le formulaire monté n’est pas celui du livre : ' + cles.join(', '));
  // Les intitulés du gabarit prennent leur variante .livre (lib/i18n.js, TP).
  const { TP } = require(path.join(COCKPIT, 'lib', 'i18n.js'));
  const { construireHtml } = require(path.join(COCKPIT, 'lib', 'webviews', 'util.js'));
  const html = construireHtml('articles', 'n', {});
  assert.ok(html.includes('>' + TP('art.liste.section', 'livre') + '<'), 'intitulé de la liste sans sa variante livre');
  assert.ok(html.includes('>' + TP('art.numero.section', 'livre') + '<'), 'intitulé du formulaire sans sa variante livre');
  assert.doesNotMatch(html, /du numéro</);
  assert.strictEqual(page.compter('.szh-carte'), 2);
  assert.strictEqual(page.compter('.apercu-doi'), 0, 'case « pas de DOI » sur un chapitre');
});

test('panneau Commande d’un livre : l’entrée du formulaire dit « Métadonnées du livre »', async () => {
  const original = HOTE.stub.window.showQuickPick;
  let items = null;
  HOTE.stub.window.showQuickPick = (its) => { items = its; return Promise.resolve(undefined); };
  try { await HOTE.executer('szh.panneauCommande'); } finally { HOTE.stub.window.showQuickPick = original; }
  const meta = (items || []).find((it) => it.commande === 'szh.metadonnees');
  assert.ok(meta, 'l’entrée szh.metadonnees manque du panneau Commande');
  assert.match(String(meta.label), /Métadonnées du livre/);
  assert.doesNotMatch(String(meta.label), /numéro/i);
});

test('vue des chapitres : dépôt d’illustration et 4e de couverture sont relayés et attendus, les auteurs connus envoyés', () => {
  const src = fs.readFileSync(path.join(COCKPIT, 'extension.js'), 'utf8');
  assert.match(src, /await metadonneesHote\.messageLivre\(/);
  assert.match(src, /if \(livre\) \{ envoyerAuteursConnus\(panneau, racine\); \}/);
  const fiches = fs.readFileSync(path.join(COCKPIT, 'media', '_fiches.js'), 'utf8');
  assert.match(fiches, /CAP\.titreEnLignes === true && textes\[c\]\[0\] !== 'resume' && TXT\.brAide/,
    'l’aide « // » manque sous titre et sous-titre d’un chapitre');
  const pkg = require(path.join(COCKPIT, 'package.json'));
  assert.ok(!pkg.contributes.configurationDefaults['triggerTaskOnSave.tasks']['Aperçu / Export PDF'].includes('**/*.md'));
});
