// Import des Word (.docx et .odt) du dépôt articles-word/ : conversion, préfixe et ordre
// des nouveaux articles, compilation qui suit. Les rappels vers l'hôte passent par
// configurer().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T, TP, langueCockpit } = require('./i18n');
const { phrasesBlocMalForme } = require('./journal');
const session = require('./session');
const profils = require('./profil');
const { slugifierArticle, numeroOrdreArticle } = require('./slug');
const { trierParDoi, prefixeOrdre, titreFiche } = require('./articles');
const { analyserMeta, langueRevue } = require('./yaml');
const { tige } = require('./renumerotation');
const { alignerFichiers } = require('./renumerotation-fs');
const { refuserSiVerrouille } = require('./cycle-vie');
const { refusCoedition } = require('./coedition-hote');
const { ouvrirImportVerif } = require('./import-verif-hote');

// Identiques aux labels de vscodium-user/tasks.json.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  articlesSansDoi: () => [],
  ecrireClesAusgabe: () => 'lib/import-hote.js non configuré',
  lancerTache: async () => null,
  avertirEchecCompilation: () => {},
  convertirCmykSiBesoin: async () => 0,
  rejouerCompilationsDifferees: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function profilCourant() { return profils.courant(); }
function dossierUnites() { return profilCourant().unites.dossier; }
function cleOrdre() { return profilCourant().unites.ordre; }
function cheminConfig(racine) { return path.join(racine, profilCourant().config); }

// Le numéro de tête du nom de chaque Word en attente, à lire avant que « make import »
// supprime les Word (le slug ne le porte pas). -> Map slug de base -> file de numéros.
// Deux Word peuvent donner le même slug de base (titre tronqué à 39 caractères) ; la file
// suit l'ordre alphabétique de la boucle d'import du Makefile, ce qui permet à
// resoudreNumeroOrdre() d'attribuer le bon numéro au slug suffixé « -2 ».
function numerosOrdreEnAttente(fournisseur) {
  const noms = fournisseur._docxEnAttente(path.join(fournisseur.racine, profilCourant().depot));
  const parBase = new Map();
  for (const nom of noms) {
    const base = slugifierArticle(nom);
    if (!parBase.has(base)) { parBase.set(base, []); }
    parBase.get(base).push(numeroOrdreArticle(nom));
  }
  return parBase;
}

// Numéro de tête d'un slug importé, retrouvé par son slug de base (le slug lui-même, ou
// sans le suffixe « -2 », « -3 »… ajouté par le Makefile). null si le Word n'en avait pas.
function resoudreNumeroOrdre(slug, parBase) {
  const s = String(slug);
  if (parBase.has(s) && parBase.get(s).length > 0) { return parBase.get(s).shift(); }
  const suffixe = s.match(/^(.*)-[0-9]+$/);
  if (suffixe && parBase.has(suffixe[1]) && parBase.get(suffixe[1]).length > 0) {
    return parBase.get(suffixe[1]).shift();
  }
  return null;
}

// Préfixe les dossiers des nouveaux articles par leur rang dans `ordreFinal` (l'ordre
// affiché), comme Monter/Descendre (nomVoulu(), lib/renumerotation.js). Le numéro de tête
// du Word ne sert qu'à placer l'article dans cet ordre.
//
// Les articles déjà présents ne sont pas renommés : réaligner tout le numéro est le rôle
// de « Terminer » (lib/renumerotation-fs.js). Un numéro peut donc mêler dossiers préfixés
// et non préfixés.
//
// Si le nom visé est pris, on essaie les rangs suivants jusqu'au premier nom libre. Au-delà
// de MAX_RECHERCHE_RANG_LIBRE essais, le dossier garde son nom sans préfixe.
const MAX_RECHERCHE_RANG_LIBRE = 999;

// -> Map ancien slug -> nouveau slug, pour les dossiers renommés.
function prefixerNouveauxArticles(racine, ordreFinal, nouveaux) {
  const base = path.join(racine, dossierUnites());
  const aNouveau = new Set(nouveaux);
  const renommes = new Map();
  ordreFinal.forEach((slug, rang) => {
    if (!aNouveau.has(slug)) { return; }
    let cible = prefixeOrdre(rang) + '-' + tige(slug);
    if (cible === slug) { return; }
    let r = rang;
    while (fs.existsSync(path.join(base, cible))) {
      r++;
      if (r - rang > MAX_RECHERCHE_RANG_LIBRE) { return; }
      cible = prefixeOrdre(r) + '-' + tige(slug);
    }
    fs.renameSync(path.join(base, slug), path.join(base, cible));
    // Le .md, la fiche et les fichiers annexes prennent le nom du dossier, que le
    // Makefile exige (comme dans renumeroter()).
    alignerFichiers(base, cible);
    renommes.set(slug, cible);
  });
  return renommes;
}

// Écrit l'ordre des articles (`ordre-articles` ou `ordre-chapitres` selon le profil) avec
// les nouveaux en queue de l'ordre existant `avant`. Sans cette écriture, ils seraient
// rangés par ordre alphabétique et le numéro mis dans le nom des Word serait perdu.
// Entre eux, les articles numérotés viennent d'abord, par numéro ; les autres suivent dans
// l'ordre de l'import (tri stable).
//
// -> Map ancien slug -> nouveau slug (prefixerNouveauxArticles), dont l'appelant a besoin
// pour la suite (conversion CMJN, vérification d'import).
function ecrireOrdreNouveauxArticles(fournisseur, avant, nouveaux, parBase) {
  const racine = fournisseur.racine;
  const numeroDe = new Map();
  for (const slug of nouveaux) { numeroDe.set(slug, resoudreNumeroOrdre(slug, parBase)); }
  const tries = nouveaux.slice().sort((a, b) => {
    const na = numeroDe.get(a), nb = numeroDe.get(b);
    if (na === null && nb === null) { return 0; }
    if (na === null) { return 1; }
    if (nb === null) { return -1; }
    return na - nb;
  });
  const complet = Array.from(avant).concat(tries);
  // Le tri DOI s'applique aussi dans le fichier : ausgabe.yaml se relit à la main et doit
  // montrer l'ordre de l'écran. Cet ordre fixe le rang, donc le préfixe, de chacun.
  const ordreFinal = trierParDoi(complet, ctx.articlesSansDoi(racine, complet));
  // Les dossiers d'abord, l'ordre ensuite : une interruption entre les deux ne laisse pas
  // ausgabe.yaml nommer un dossier inexistant (même règle que renumeroter()).
  const renommes = prefixerNouveauxArticles(racine, ordreFinal, nouveaux);
  const modifies = {};
  modifies[cleOrdre()] = ordreFinal.map((slug) => renommes.get(slug) || slug);
  // On vérifie le bail de co-édition sans le prendre. Si quelqu'un d'autre modifie
  // ausgabe.yaml, l'ordre n'est pas écrit : listerArticles() le réparera à la prochaine
  // lecture (repli alphabétique), avec les dossiers déjà renommés.
  if (refusCoedition(racine, cheminConfig(racine))) { return renommes; }
  ctx.ecrireClesAusgabe(racine, modifies);
  return renommes;
}

// ---- Bloc mal formé du gabarit : une boîte de dialogue ---------------------------------
//
// `bloc-mal-forme` signale un tableau qui porte les étiquettes d'une figure ou d'un tableau
// (« Légende : », « Texte alternatif : », « Copyright : », « Source : », « Note : ») sans
// en avoir la forme. Il s'imprimerait tel quel, sans numéro ni texte alternatif, et seul le
// Word peut être corrigé : d'où une modale plutôt qu'une ligne de journal.
//
// Le message vient du pipeline, dans la langue du cockpit, avec la page (si Word l'a
// calculée), le rang et la légende du tableau ; il est affiché tel quel.

// Lit .import.log ; le tri des messages est fait par phrasesBlocMalForme (lib/journal.js).
function blocsMalFormes(racine, depot) {
  let texte = '';
  try { texte = fs.readFileSync(path.join(racine, depot, '.import.log'), 'utf8'); }
  catch (e) { return []; }
  return phrasesBlocMalForme(texte, langueCockpit());
}

async function avertirBlocsMalFormes(racine) {
  const phrases = blocsMalFormes(racine, profilCourant().depot);
  if (phrases.length === 0) { return; }
  // Les phrases vont dans `detail` : le titre d'une modale VS Code est tronqué.
  await vscode.window.showWarningMessage(
    T('modale.bloc-mal-forme.titre', [String(phrases.length)]),
    { modal: true, detail: phrases.join('\n\n') },
    T('modale.bloc-mal-forme.bouton')
  );
}

// Appelée pendant que session.importEnCours() est posé ; gère donc elle-même le drapeau de
// compilation. Un échec n'annule pas l'import.
async function compilerApresImport() {
  if (session.buildEnCours()) { return; }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.build.import'));
  try {
    const code = await ctx.lancerTache(NOM_TACHE_BUILD);
    if (code !== null && code !== 0) { ctx.avertirEchecCompilation('err.build'); }
  } finally {
    statut.dispose();
    session.poserBuildEnCours(false);
  }
}

// Les Word du dépôt dont l'article existe déjà (des versions corrigées, que l'import
// ignore), comme le badge « déjà converti » de la vue Word.
// -> [{ word, slug }], slug étant le dossier réel (préfixé ou non).
function wordsCorrigesEnAttente(fournisseur) {
  const articles = fournisseur.listerArticles();
  const trouves = [];
  for (const nom of fournisseur._docxEnAttente(path.join(fournisseur.racine, profilCourant().depot))) {
    const base = slugifierArticle(nom);
    if (!fournisseur._articleExiste(base)) { continue; }
    const slug = articles.find((s) => tige(s) === tige(base));
    if (slug) { trouves.push({ word: nom, slug: slug }); }
  }
  return trouves;
}

// Rien de neuf : un Word corrigé se propose au réimport, plusieurs renvoient à la vue Word.
// Appelée hors du drapeau d'import, que le réimport refuserait.
async function annoncerAucunNouveau(fournisseur) {
  const corriges = wordsCorrigesEnAttente(fournisseur);
  if (corriges.length === 1) {
    const bouton = T('cmd.reimporter.court');
    const choix = await vscode.window.showInformationMessage(
      T('info.importes.corrige', [corriges[0].slug]), bouton);
    if (choix === bouton) { await vscode.commands.executeCommand('szh.reimporterArticle', corriges[0]); }
    return;
  }
  if (corriges.length > 1) {
    const bouton = T('info.importes.reimporterPlusieurs');
    const choix = await vscode.window.showInformationMessage(T('info.importes.aucun'), bouton);
    if (choix === bouton) { await vscode.commands.executeCommand('szh.vueWord'); }
    return;
  }
  vscode.window.showInformationMessage(T('info.importes.aucun'));
}

// Suite d'un import qui a ramené des articles, pour l'import guidé comme pour une tâche
// lancée hors du cockpit. `dejaCompile` : la tâche a déjà compilé (`make all`) ; on ne
// recompile que si un dossier a été renommé ou une image convertie. Remplace dans
// `nouveaux` les slugs renommés par leur nouveau nom.
async function finirImport(fournisseur, rafraichirTout, avant, nouveaux, parBase, dejaCompile) {
  const renommes = ecrireOrdreNouveauxArticles(fournisseur, avant, nouveaux, parBase);
  for (let i = 0; i < nouveaux.length; i++) { nouveaux[i] = renommes.get(nouveaux[i]) || nouveaux[i]; }
  // Retire ce que `make all` a compilé sous l'ancien nom, que l'export pourrait reprendre
  // (comme renumeroter()).
  if (dejaCompile) {
    const sortie = profils.chemins(profilCourant(), fournisseur.racine).sortie;
    for (const ancien of renommes.keys()) {
      try { fs.rmSync(path.join(sortie, ancien), { recursive: true, force: true }); } catch (e) { /* rien à retirer */ }
    }
  }
  // Conversion CMJN avant la compilation, pour que le PDF ait les couleurs converties.
  const aConvertir = [];
  for (const slug of nouveaux) {
    const base = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
    for (const relatif of fournisseur._imagesArticle(slug)) { aConvertir.push(path.join(base, relatif)); }
  }
  const convertis = await ctx.convertirCmykSiBesoin(aConvertir);
  // Avant le dialogue de vérification, dont « Remplacer » refuse d'agir pendant une
  // compilation.
  if (!dejaCompile || renommes.size > 0 || convertis > 0) { await compilerApresImport(); }
  rafraichirTout();
  // Avant le dialogue de vérification, pour qu'on sache avant de relire l'article qu'un
  // tableau n'a pas été reconnu.
  await avertirBlocsMalFormes(fournisseur.racine);
  await ouvrirImportVerif(fournisseur, rafraichirTout, nouveaux);
}

// ---- Word renommé : version corrigée d'un article, ou nouvel article ? ---------------
//
// Le Makefile reconnaît un Word corrigé par son nom ou par la fiche (`source:`) ; renommé
// par l'auteur, il deviendrait un doublon. On pose donc la question pour tout Word dont le
// slug ne nomme aucun article mais dont la tige prolonge celle d'un article, ou l'inverse
// (comparaison de préfixe seulement). -> [{ word, slug }]
function wordsRessemblants(fournisseur) {
  const racine = fournisseur.racine;
  const articles = fournisseur.listerArticles();
  const sources = new Set();
  for (const slug of articles) {
    const s = String(lireMeta(racine, slug).source || '').toLowerCase();
    if (s !== '') { sources.add(s); }
  }
  const trouves = [];
  for (const nom of fournisseur._docxEnAttente(path.join(racine, profilCourant().depot))) {
    const base = slugifierArticle(nom);
    if (fournisseur._articleExiste(base) || sources.has(nom.toLowerCase())) { continue; }
    let proche = '';
    for (const slug of articles) {
      const t = tige(slug);
      if (!base.startsWith(t) && !t.startsWith(base)) { continue; }
      if (proche === '' || t.length > tige(proche).length) { proche = slug; }
    }
    if (proche !== '') { trouves.push({ word: nom, slug: proche }); }
  }
  return trouves;
}

function lireMeta(racine, slug) {
  try { return analyserMeta(fs.readFileSync(profils.chemins(profilCourant(), racine, slug).meta, 'utf8')); }
  catch (e) { return analyserMeta(''); }
}

// Une modale par Word ressemblant. -> { corriges: [{ word, slug }], ecartes: [nom] }.
// Un Word déclaré corrigé, ou dont la question est annulée, n'est pas converti.
async function demanderRessemblances(fournisseur) {
  const corriges = [];
  const ecartes = [];
  const langue = langueRevue(fournisseur.racine);
  const profil = profilCourant();
  for (const r of wordsRessemblants(fournisseur)) {
    const titre = titreFiche(lireMeta(fournisseur.racine, r.slug), langue) || r.slug;
    const corrige = TP('modale.ressemble.corrige', profil);
    const nouveau = TP('modale.ressemble.nouveau', profil);
    const rep = await vscode.window.showWarningMessage(
      TP('modale.ressemble.question', profil, [titre]),
      { modal: true, detail: T('modale.ressemble.detail', [r.word]) }, corrige, nouveau);
    if (rep === nouveau) { continue; }
    ecartes.push(r.word);
    if (rep === corrige) { corriges.push(r); }
  }
  return { corriges, ecartes };
}

// Pendant la conversion, les Word écartés attendent dans ce sous-dossier du dépôt, que le
// Makefile ne parcourt pas. Ils sont remis en place à la fin, ou au début de la
// conversion suivante si la fenêtre a été fermée entre-temps.
const DOSSIER_ECARTES = '.szh-ecartes';

function ecarterWords(depot, noms) {
  if (noms.length === 0) { return; }
  const cache = path.join(depot, DOSSIER_ECARTES);
  fs.mkdirSync(cache, { recursive: true });
  for (const nom of noms) { fs.renameSync(path.join(depot, nom), path.join(cache, nom)); }
}

function remettreWords(depot) {
  const cache = path.join(depot, DOSSIER_ECARTES);
  let noms;
  try { noms = fs.readdirSync(cache); } catch (e) { return; }
  for (const nom of noms) {
    // Un Word du même nom déposé entre-temps l'emporte ; l'ancien reste dans le cache.
    if (fs.existsSync(path.join(depot, nom))) { continue; }
    try { fs.renameSync(path.join(cache, nom), path.join(depot, nom)); } catch (e) { /* réessayé la fois suivante */ }
  }
  try { fs.rmdirSync(cache); } catch (e) { /* pas vide : voir ci-dessus */ }
}

// ---- Import fait par une tâche hors du cockpit -----------------------------------------
//
// `make all` (Ctrl+S, Ctrl+E) et la tâche d'import (au démarrage, Ctrl+Alt+I) importent
// les Word du dépôt sans passer par lancerConversion. Au début d'une telle tâche, on note
// la liste des articles et les numéros des Word ; à la fin de la dernière tâche en cours,
// les articles apparus reçoivent la même suite que l'import guidé. Rien n'est noté pendant
// un import guidé, dont les tâches passent aussi par ici.
let importExterne = null;

function noterDebutTache(fournisseur, nomTache) {
  if (nomTache !== NOM_TACHE_IMPORT && nomTache !== NOM_TACHE_BUILD) { return; }
  if (session.importEnCours() || !fournisseur.racine) { return; }
  if (importExterne) {
    if (nomTache === NOM_TACHE_IMPORT) { importExterne.dejaCompile = false; }
    return;
  }
  const parBase = numerosOrdreEnAttente(fournisseur);
  if (parBase.size === 0) { return; }              // aucun Word en attente
  importExterne = {
    racine: fournisseur.racine, avant: new Set(fournisseur.listerArticles()), parBase: parBase,
    dejaCompile: nomTache === NOM_TACHE_BUILD, echec: false
  };
}

function noterFinProcessus(code) {
  if (importExterne && code !== 0) { importExterne.echec = true; }
}

async function finirImportExterne(fournisseur, rafraichirTout) {
  const e = importExterne;
  if (!e || session.tachesSuiviesEnVol() > 0) { return; }
  importExterne = null;
  // Après une tâche en échec, l'ordre et les dossiers restent tels quels.
  if (e.echec || session.importEnCours() || e.racine !== fournisseur.racine) { return; }
  if (session.etatNumero().verrouillee) { return; }
  const nouveaux = fournisseur.listerArticles().filter((s) => !e.avant.has(s));
  if (nouveaux.length === 0) { return; }
  session.poserImportEnCours(true);
  try { await finirImport(fournisseur, rafraichirTout, e.avant, nouveaux, e.parBase, e.dejaCompile); }
  finally {
    session.poserImportEnCours(false);
    ctx.rejouerCompilationsDifferees();
  }
}

// La tâche d'import, puis la suite si elle a ramené des articles. -> ce qu'il reste à
// annoncer une fois le drapeau d'import levé, ou null.
async function convertirDepot(fournisseur, rafraichirTout, depot, annoncer) {
  const avant = new Set(fournisseur.listerArticles());
  // Lu avant la tâche : « make import » supprime les Word convertis, et leur numéro de tête
  // avec eux.
  const parBase = numerosOrdreEnAttente(fournisseur);
  const code = await ctx.lancerTache(NOM_TACHE_IMPORT);
  remettreWords(depot);
  rafraichirTout();
  if (code === null) { return null; }            // tâche introuvable, déjà signalée
  if (code !== 0) {
    ctx.avertirEchecCompilation('err.import');
    return null;
  }
  const nouveaux = [];
  for (const slug of fournisseur.listerArticles()) { if (!avant.has(slug)) { nouveaux.push(slug); } }
  if (nouveaux.length > 0) {
    await finirImport(fournisseur, rafraichirTout, avant, nouveaux, parBase, false);
    return null;
  }
  return annoncer ? () => annoncerAucunNouveau(fournisseur) : null;
}

// Convertit les Word de articles-word/. Les nouveaux articles se trouvent en comparant la
// liste des articles avant et après la tâche.
async function lancerConversion(fournisseur, rafraichirTout) {
  if (session.importEnCours()) { vscode.window.setStatusBarMessage(T('statut.import.encours'), 3000); return; }
  session.poserImportEnCours(true);
  importExterne = null;                            // cet import fait sa suite lui-même
  const statut = vscode.window.setStatusBarMessage(T('statut.import'));
  const depot = path.join(fournisseur.racine, profilCourant().depot);
  let apresImport = null;
  let corriges = [];
  try {
    remettreWords(depot);
    const choix = await demanderRessemblances(fournisseur);
    corriges = choix.corriges;
    ecarterWords(depot, choix.ecartes);
    if (choix.ecartes.length > 0 && fournisseur._docxEnAttente(depot).length === 0) {
      rafraichirTout();                            // plus rien à convertir
    } else {
      apresImport = await convertirDepot(fournisseur, rafraichirTout, depot, corriges.length === 0);
    }
  } finally {
    remettreWords(depot);
    statut.dispose();
    session.poserImportEnCours(false);
    // Dans tous les cas, les compilations refusées pendant l'import (enregistrement d'une
    // fiche, par exemple) repartent maintenant.
    ctx.rejouerCompilationsDifferees();
  }
  // Sans attendre la réponse à la notification, pour ne pas bloquer ce qui a lancé
  // l'import. Les erreurs sont signalées par envelopperCommande (extension.js). Le
  // réimport refuse de partir pendant un import : il vient donc après, un Word à la fois.
  if (apresImport) { apresImport().catch(() => {}); }
  if (corriges.length > 0) {
    (async () => {
      for (const c of corriges) { await vscode.commands.executeCommand('szh.reimporterArticle', c); }
    })().catch(() => {});
  }
}

// Commun au bouton « Importer des Word » et au glisser-déposer : copie dans le dépôt
// (articles-word/, ou chapitres-word/ pour un livre), conflits de nom en modale, puis
// conversion.
async function importerFichiersWord(fournisseur, rafraichirTout, uris) {
  const racine = fournisseur.racine;
  if (!racine || !Array.isArray(uris) || uris.length === 0) { return; }
  const choix = uris;

  const dossierWord = path.join(racine, profilCourant().depot);
  try { fs.mkdirSync(dossierWord, { recursive: true }); } catch (e) { /* existe déjà */ }

  // On demande plutôt que de renommer : un nom suffixé créerait un article en double.
  const conflits = choix.filter((u) => fs.existsSync(path.join(dossierWord, path.basename(u.fsPath))));
  let remplacer = true;
  if (conflits.length > 0) {
    const noms = conflits.map((u) => path.basename(u.fsPath)).join(', ');
    const rep = await vscode.window.showWarningMessage(
      T('modale.conflit.question', [noms]),
      { modal: true },
      T('modale.remplacer.bouton'), T('modale.conflit.ignorer')
    );
    if (rep === undefined) { return; }             // annulé
    remplacer = (rep === T('modale.remplacer.bouton'));
  }

  let copies = 0;
  for (const u of choix) {
    const dest = path.join(dossierWord, path.basename(u.fsPath));
    if (fs.existsSync(dest) && !remplacer) { continue; }
    try { fs.copyFileSync(u.fsPath, dest); copies++; }
    catch (e) { vscode.window.showErrorMessage(T('err.copie', [path.basename(u.fsPath), e.message])); }
  }
  if (copies === 0) { rafraichirTout(); return; }

  await lancerConversion(fournisseur, rafraichirTout);
}

async function importerWord(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  const filtresImport = {};
  filtresImport[T('dial.importer.filtre')] = ['docx', 'odt'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: filtresImport,
    openLabel: T('dial.importer.bouton'),
    title: T('dial.importer.titre')
  });
  if (!choix || choix.length === 0) { return; }   // dialogue annulé
  await importerFichiersWord(fournisseur, rafraichirTout, choix);
}

// Les .docx et .odt déposés sur la vue passent par le circuit d'« Importer des Word ». Le
// format `text/uri-list` donne une URI par ligne, lignes vides et « # » ignorés (RFC 2483).
function controleurDepotVue(fournisseur, rafraichirTout) {
  return {
    dropMimeTypes: ['text/uri-list'],
    dragMimeTypes: [],
    handleDrop: async (cible, dataTransfer) => {
      if (refuserSiVerrouille()) { return; }
      const item = dataTransfer.get('text/uri-list');
      if (!item) { return; }
      const brut = await item.asString();
      const docx = [];
      let fichiers = 0;
      for (const ligne of String(brut || '').split(/\r?\n/)) {
        const nette = ligne.trim();
        if (nette === '' || nette.charAt(0) === '#') { continue; }
        let uri = null;
        try { uri = vscode.Uri.parse(nette); } catch (e) { continue; }
        if (!uri || uri.scheme !== 'file') { continue; }
        fichiers++;
        if (/\.(docx|odt)$/i.test(uri.fsPath)) { docx.push(uri); }
      }
      if (docx.length > 0) { await importerFichiersWord(fournisseur, rafraichirTout, docx); return; }
      if (fichiers > 0) { vscode.window.showInformationMessage(T('drop.seulement.docx')); }
    }
  };
}

module.exports = {
  configurer,
  numerosOrdreEnAttente, resoudreNumeroOrdre, prefixerNouveauxArticles, ecrireOrdreNouveauxArticles,
  compilerApresImport, lancerConversion, importerFichiersWord, importerWord,
  blocsMalFormes, avertirBlocsMalFormes, wordsRessemblants,
  noterDebutTache, noterFinProcessus, finirImportExterne,
  controleurDepotVue
};
