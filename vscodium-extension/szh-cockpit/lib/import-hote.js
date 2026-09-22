// Import guidé : conversion des .docx de articles-word/, écriture de l'ordre des
// nouveaux articles, et la compilation qui suit un import réussi. Impur (tâches, disque,
// dialogues) ; les rappels vers l'hôte passent par configurer() plus bas, jamais par require.
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T, langueCockpit } = require('./i18n');
const { phrasesBlocMalForme } = require('./journal');
const session = require('./session');
const profils = require('./profil');
const { slugifierArticle, numeroOrdreArticle } = require('./slug');
const { trierParDoi, prefixeOrdre } = require('./articles');
const { tige } = require('./renumerotation');
const { alignerFichiers } = require('./renumerotation-fs');
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

// Le rang qui décide du préfixe d'un dossier nouvellement importé est celui de l'ordre
// ÉCRAN final (ordreFinal ci-dessous, calculé par ecrireOrdreNouveauxArticles avant tout
// renommage) — jamais le nombre de tête du Word. Ce nombre ne fait que placer l'article
// dans cet ordre ; une fois la place décidée, seul le rang compte, exactement comme
// Monter/Descendre ne connaît que le rang (lib/renumerotation.js:nomVoulu()). Confondre les
// deux referait le bug que ce module corrige ailleurs : un dossier qui ne porte plus le
// nombre que l'écran affiche.
//
// Seuls les dossiers de `nouveaux` sont touchés : un article déjà présent, même sans
// préfixe, reste tel quel — ce n'est pas à un import de réaligner tout le numéro en
// silence, ce geste-là appartient à « Terminer » (lib/renumerotation-fs.js), sur demande
// explicite. Un numéro peut donc mélanger des dossiers préfixés et non préfixés : assumé.
//
// Un nom cible déjà occupé (par un dossier antérieur au même nom, préfixé ou pas) ne laisse
// PAS l'article sans préfixe : un article sans préfixe est un article qu'on ne retrouve
// pas dans l'Explorateur, exactement le problème que ce préfixe corrige. On monte donc
// d'un rang à la fois au-delà de celui calculé, jusqu'au premier nom libre — l'article se
// pose en fin de chaîne plutôt que de rester nu. Borné tout de même : un numéro compte au
// plus quelques dizaines d'articles, et une occupation de tous les rangs jusque-là ne peut
// arriver que par accident (un script qui boucle, un dossier recréé en masse) — le seul cas
// où l'on revient au repli sans préfixe, en dernier recours, jamais en fonctionnement normal.
const MAX_RECHERCHE_RANG_LIBRE = 999;

// -> Map ancien slug -> nouveau slug, pour les seuls dossiers effectivement renommés.
function prefixerNouveauxArticles(racine, ordreFinal, nouveaux) {
  const base = path.join(racine, dossierUnites());
  const aNouveau = new Set(nouveaux);
  const renommes = new Map();
  ordreFinal.forEach((slug, rang) => {
    if (!aNouveau.has(slug)) { return; }             // article déjà présent : jamais touché
    let cible = prefixeOrdre(rang) + '-' + tige(slug);
    if (cible === slug) { return; }
    let r = rang;
    while (fs.existsSync(path.join(base, cible))) {
      r++;
      if (r - rang > MAX_RECHERCHE_RANG_LIBRE) { return; }   // cas absurde : reste sans préfixe
      cible = prefixeOrdre(r) + '-' + tige(slug);
    }
    fs.renameSync(path.join(base, slug), path.join(base, cible));
    // Même règle que renumeroter() : le .md, la fiche et les sidecars suivent le dossier,
    // sans quoi le Makefile ne retrouve plus le .md sous le nom qu'il exige.
    alignerFichiers(base, cible);
    renommes.set(slug, cible);
  });
  return renommes;
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
//
// -> Map ancien slug -> nouveau slug (voir prefixerNouveauxArticles) : l'appelant en a
// besoin pour parler du bon dossier une fois l'écriture faite (conversion CMYK, vérification
// d'import) — ces slugs-là ont changé sous ses pieds.
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
  // La règle du DOI reste respectée dans le fichier lui-même, pas seulement à la lecture —
  // même raison qu'à la case « pas de DOI » : ausgabe.yaml voyage seul sur SharePoint et se
  // relit à la main, il doit dire la même chose que l'écran. C'est cet ordre, après le tri
  // DOI, qui fixe le rang de chacun : le renommage ci-dessous ne fait que le nommer, il ne
  // le recalcule pas.
  const ordreFinal = trierParDoi(complet, ctx.articlesSansDoi(racine, complet));
  // Les dossiers d'abord, l'ordre ensuite — jamais l'inverse : une interruption entre les
  // deux laisserait sinon ausgabe.yaml désigner un dossier qui n'existe pas encore sous ce
  // nom, exactement le risque que renumeroter() évite par la même règle
  // (lib/renumerotation-fs.js).
  const renommes = prefixerNouveauxArticles(racine, ordreFinal, nouveaux);
  const modifies = {};
  modifies[cleOrdre()] = ordreFinal.map((slug) => renommes.get(slug) || slug);
  // Geste sans session de saisie : on regarde le bail, on ne le prend pas. Si quelqu'un
  // modifie ausgabe.yaml en ce moment, on laisse l'auto-réparation de listerArticles()
  // (repli alphabétique, à la prochaine lecture) faire l'affaire plutôt que d'entrer en
  // conflit avec cette écriture — l'import a déjà réussi, ce n'est pas à lui d'échouer pour
  // un ordre qui se répare de toute façon. Les dossiers, eux, restent renommés dans tous les
  // cas : l'auto-réparation les retrouvera sous leur nom définitif, jamais sous l'ancien.
  if (ctx.refusCoedition(racine, cheminConfig(racine))) { return renommes; }
  ctx.ecrireClesAusgabe(racine, modifies);
  return renommes;
}

// ---- Le garde-fou du gabarit : une boîte de dialogue, pas une ligne de plus ------------
//
// `bloc-mal-forme` se lève quand un tableau porte les étiquettes d'une figure ou d'un tableau
// (« Légende : », « Texte alternatif : », « Crédit : », « Source : ») sans en avoir la forme.
// Ce qui suit n'est PAS cosmétique : ce tableau s'imprimera tel quel, sa légende ne sera ni
// numérotée ni reprise comme texte alternatif, et il n'y a qu'un seul endroit où le réparer —
// le document Word, qu'il faut rouvrir. Un avertissement qu'on lit trois jours plus tard, dans
// un panneau, ne fait rouvrir aucun Word : d'où la modale.
//
// Le message vient du pipeline (`brut`), déjà écrit dans la langue du cockpit et déjà porteur
// des trois repères qui permettent de retrouver le tableau : sa page quand Word a repaginé, son
// rang, et sa légende. Il se dégrade proprement sans pagination — c'est mesuré côté pipeline,
// et c'est pour ça qu'on ne le reformule pas ici.

// La lecture du disque, et rien d'autre : le tri des constats vit dans lib/journal.js
// (phrasesBlocMalForme), pur et exerçable sans vscode.
function blocsMalFormes(racine, depot) {
  let texte = '';
  try { texte = fs.readFileSync(path.join(racine, depot, '.import.log'), 'utf8'); }
  catch (e) { return []; }
  return phrasesBlocMalForme(texte, langueCockpit());
}

async function avertirBlocsMalFormes(racine) {
  const phrases = blocsMalFormes(racine, profilCourant().depot);
  if (phrases.length === 0) { return; }
  // `detail` porte les phrases : le titre d'une modale VS Code est tronqué, et c'est dans le
  // détail que tient le repérage (page, rang, légende) sans lequel on cherche à l'aveugle.
  await vscode.window.showWarningMessage(
    T('modale.bloc-mal-forme.titre', [String(phrases.length)]),
    { modal: true, detail: phrases.join('\n\n') },
    T('modale.bloc-mal-forme.bouton')
  );
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
      // listerArticles() (rafraichirTout() ci-dessous, puis chaque rendu de l'arbre). Cette
      // même écriture préfixe aussi les dossiers créés par cet import (prefixerNouveauxArticles) :
      // `nouveaux` porte encore les anciens noms après l'appel, d'où le remplacement qui
      // suit — tout ce qui parle d'un de ces articles après ce point doit parler du dossier
      // qui existe réellement sur le disque, pas de celui que « make import » avait posé.
      const renommes = ecrireOrdreNouveauxArticles(fournisseur, avant, nouveaux, parBase);
      for (let i = 0; i < nouveaux.length; i++) { nouveaux[i] = renommes.get(nouveaux[i]) || nouveaux[i]; }
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
      // Avant le dialogue de vérification : celui-ci fait relire l'article, et il vaut mieux
      // savoir AVANT de le relire qu'un de ses tableaux n'a pas été lu comme une figure.
      await avertirBlocsMalFormes(fournisseur.racine);
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
  numerosOrdreEnAttente, resoudreNumeroOrdre, prefixerNouveauxArticles, ecrireOrdreNouveauxArticles,
  compilerApresImport, lancerConversion, importerFichiersWord, importerWord,
  blocsMalFormes, avertirBlocsMalFormes,
  controleurDepotVue
};
