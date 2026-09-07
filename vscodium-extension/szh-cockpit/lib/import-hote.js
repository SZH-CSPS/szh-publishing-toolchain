// Import guidé : conversion des .docx de articles-word/, écriture de l'ordre des
// nouveaux articles, et la compilation qui suit un import réussi. Impur (tâches, disque,
// dialogues) ; les rappels vers l'hôte passent par configurer() plus bas, jamais par require.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T } = require('./i18n');
const session = require('./session');
const profils = require('./profil');
const { slugifierArticle, numeroOrdreArticle } = require('./slug');
const { trierParDoi } = require('./articles');
const { refuserSiVerrouille } = require('./cycle-vie');

// À garder identiques aux labels de vscodium-user/tasks.json, qui les nomme.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  articlesSansDoi: () => [],
  refusCoedition: () => null,
  ecrireClesAusgabe: () => 'lib/import-hote.js non configuré',
  lancerTache: async () => null,
  avertirEchecCompilation: () => {},
  convertirCmykSiBesoin: async () => 0,
  ouvrirImportVerif: async () => {},
  rejouerCompilationsDifferees: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Mêmes calculs que dans extension.js (profilCourant, dossierUnites, cleOrdre,
// cheminConfig), tirés directement de session.profilOuvrage() : ce module n'a pas à les
// recevoir en rappel, lib/profil.js suffit.
function profilCourant() { return session.profilOuvrage() || profils.profilPour('revue'); }
function dossierUnites() { return profilCourant().unites.dossier; }
function cleOrdre() { return profilCourant().unites.ordre; }
function cheminConfig(racine) { return path.join(racine, profilCourant().config); }

// Le nombre de tête de chaque .docx en attente, avant que « make import » ne les supprime —
// la seule fenêtre où ce nombre existe encore (slugifierArticle() ne le porte plus).
// Regroupés par slug de base (avant désambiguïsation d'homonyme, slugifierArticle()) : un
// même titre tronqué à 39 caractères peut être partagé par deux Word différents
// (« … Teil 1 », « … Teil 2 »), chacun avec son propre numéro. La file conserve l'ordre de
// traitement de _docxEnAttente() — le même ordre alphabétique que suit la boucle d'import du
// Makefile — pour que resoudreNumeroOrdre() ci-dessous retrouve le bon numéro même une fois
// le slug suffixé « -2 ».
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

// Un slug nouvellement importé retrouve son numéro de tête par le slug de base qui l'a
// produit : exact s'il n'a pas d'homonyme, sinon en retirant le suffixe « -2 », « -3 »… que
// l'import lui a donné (la boucle de désambiguïsation du Makefile, à l'image de
// slugifierArticleUnique()). null si le Word n'en portait pas — un article sans numéro de
// tête ne doit pas s'en voir inventer un.
function resoudreNumeroOrdre(slug, parBase) {
  const s = String(slug);
  if (parBase.has(s) && parBase.get(s).length > 0) { return parBase.get(s).shift(); }
  const suffixe = s.match(/^(.*)-[0-9]+$/);
  if (suffixe && parBase.has(suffixe[1]) && parBase.get(suffixe[1]).length > 0) {
    return parBase.get(suffixe[1]).shift();
  }
  return null;
}

// Ce câblage est essentiel : sans lui, les articles nouvellement importés retombent sur le
// repli alphabétique de _sousDossiersAvecMd() (ordonnerArticles(), lib/articles.js), qui n'a
// plus aucun rapport avec le numéro que le rédacteur a mis dans le nom de ses Word — l'ordre
// voulu se perdrait en silence. `cleOrdre()` écrit `ordre-articles` ou `ordre-chapitres`
// selon le profil ouvert : le câblage vaut donc pour une revue comme pour un livre.
//
// Les nouveaux articles sont toujours ajoutés en queue de l'ordre déjà établi (`avant`,
// l'ordre effectif au moment où l'import a démarré) : un import n'a pas à décider où glisser
// un article dans un sommaire que la rédaction a déjà arrêté. Entre eux, les numérotés
// viennent d'abord, dans l'ordre du Word ; les autres (Word sans numéro de tête, ou mélange
// des deux) suivent, dans l'ordre où l'import les a rangés — le tri est stable, un nombre
// égal ou absent (null) ne bouscule donc personne.
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
  const modifies = {};
  // La règle du DOI reste respectée dans le fichier lui-même, pas seulement à la lecture —
  // même raison qu'à la case « pas de DOI » : ausgabe.yaml voyage seul sur SharePoint et se
  // relit à la main, il doit dire la même chose que l'écran.
  modifies[cleOrdre()] = trierParDoi(complet, ctx.articlesSansDoi(racine, complet));
  // Geste sans session de saisie : on regarde le bail, on ne le prend pas. Si quelqu'un
  // modifie ausgabe.yaml en ce moment, on laisse l'auto-réparation de listerArticles()
  // (repli alphabétique, à la prochaine lecture) faire l'affaire plutôt que d'entrer en
  // conflit avec cette écriture — l'import a déjà réussi, ce n'est pas à lui d'échouer pour
  // un ordre qui se répare de toute façon.
  if (ctx.refusCoedition(racine, cheminConfig(racine))) { return; }
  ctx.ecrireClesAusgabe(racine, modifies);
}

// Appelée pendant que session.importEnCours() est posé, d'où le drapeau de compilation géré
// ici. Un échec n'annule pas l'import.
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

// Convertit les Word de articles-word/ ; les nouveaux articles sont comptés en comparant
// la liste avant et après, pas en lisant la sortie de la tâche.
async function lancerConversion(fournisseur, rafraichirTout) {
  if (session.importEnCours()) { vscode.window.setStatusBarMessage(T('statut.import.encours'), 3000); return; }
  session.poserImportEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.import'));
  try {
    const avant = new Set(fournisseur.listerArticles());
    // Capté avant le lancement de la tâche : « make import » supprime les .docx convertis,
    // et avec eux le seul endroit où vivait encore le numéro de tête du rédacteur.
    const parBase = numerosOrdreEnAttente(fournisseur);
    const code = await ctx.lancerTache(NOM_TACHE_IMPORT);
    rafraichirTout();
    if (code === null) { return; }               // tâche introuvable, déjà signalé
    if (code !== 0) {
      ctx.avertirEchecCompilation('err.import');
      return;
    }
    const nouveaux = [];
    for (const slug of fournisseur.listerArticles()) { if (!avant.has(slug)) { nouveaux.push(slug); } }
    if (nouveaux.length > 0) {
      // Le numéro du Word migre ici, dans ordre-articles/ordre-chapitres : sans cette
      // écriture, l'ordre voulu par le rédacteur se perd en silence dès le prochain
      // listerArticles() (rafraichirTout() ci-dessous, puis chaque rendu de l'arbre).
      ecrireOrdreNouveauxArticles(fournisseur, avant, nouveaux, parBase);
      // Avant la compilation : un JPEG d'imprimerie converti après coup laisserait
      // l'opérateur inspecter un PDF bâti sur les couleurs d'origine.
      const aConvertir = [];
      for (const slug of nouveaux) {
        const base = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
        for (const relatif of fournisseur._imagesArticle(slug)) { aConvertir.push(path.join(base, relatif)); }
      }
      await ctx.convertirCmykSiBesoin(aConvertir);
      // Avant le dialogue, où « Remplacer » refuserait d'agir pendant une compilation.
      await compilerApresImport();
      rafraichirTout();
      await ctx.ouvrirImportVerif(fournisseur, rafraichirTout, nouveaux);
    } else {
      vscode.window.showInformationMessage(T('info.importes.aucun'));
    }
  } finally {
    statut.dispose();
    session.poserImportEnCours(false);
    // Après le dialogue de vérification (branche nouveaux.length > 0) comme après un
    // échec ou un import qui ne ramène rien (branches ci-dessus, sans compilerApresImport) :
    // dans tous les cas, ce qu'un enregistrement de fiche a vu refuser pendant cette
    // fenêtre repart maintenant.
    ctx.rejouerCompilationsDifferees();
  }
}

// Commun au bouton « Importer des Word » et au glisser-déposer : copie vers
// articles-word/ (chapitres-word/ pour un livre — profilCourant().depot), conflits en
// modale, puis conversion.
async function importerFichiersWord(fournisseur, rafraichirTout, uris) {
  const racine = fournisseur.racine;
  if (!racine || !Array.isArray(uris) || uris.length === 0) { return; }
  const choix = uris;

  const dossierWord = path.join(racine, profilCourant().depot);
  try { fs.mkdirSync(dossierWord, { recursive: true }); } catch (e) { /* existe déjà */ }

  // Plutôt qu'un renommage automatique, qui créerait un article dupliqué au slug suffixé.
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
  filtresImport[T('dial.importer.filtre')] = ['docx'];
  const choix = await vscode.window.showOpenDialog({
    canSelectMany: true,
    filters: filtresImport,
    openLabel: T('dial.importer.bouton'),
    title: T('dial.importer.titre')
  });
  if (!choix || choix.length === 0) { return; }   // dialogue annulé
  await importerFichiersWord(fournisseur, rafraichirTout, choix);
}

// Les .docx déposés sur la vue passent par le circuit d'« Importer des Word ». Le format
// `text/uri-list` donne une URI par ligne, lignes vides et « # » ignorés (RFC 2483).
function controleurDepotVue(fournisseur, rafraichirTout) {
  return {
    dropMimeTypes: ['text/uri-list'],
    dragMimeTypes: [],
    handleDrop: async (cible, dataTransfer) => {
      if (refuserSiVerrouille()) { return; }       // le dépôt écrit, comme le bouton
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
        if (/\.docx$/i.test(uri.fsPath)) { docx.push(uri); }
      }
      if (docx.length > 0) { await importerFichiersWord(fournisseur, rafraichirTout, docx); return; }
      if (fichiers > 0) { vscode.window.showInformationMessage(T('drop.seulement.docx')); }
    }
  };
}

module.exports = {
  configurer,
  numerosOrdreEnAttente, resoudreNumeroOrdre, ecrireOrdreNouveauxArticles,
  compilerApresImport, lancerConversion, importerFichiersWord, importerWord,
  controleurDepotVue
};
