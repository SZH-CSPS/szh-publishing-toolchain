// La Documentation d'un numéro : rubriques (propres au numéro) et fiches (bibliothèque
// partagée _NewsUndActu\Fiches\, lib/kirby-contenu.js) dans un seul formulaire, plus les
// deux vues qui font vivre la bibliothèque entre les deux revues : « Traductions à faire »
// et « Réservoir » (docs/FORMAT-DOCUMENTATION-KIRBY.md). Remplace l'ancien rangement des
// fiches dans le numéro et lib/reserve.js, supprimés — aucune rétrocompatibilité.
//
// Moteur générique — une section par type de kirby.typesConnus() et une rubrique par
// kirby.rubriquesPourRevue() — plutôt qu'un formulaire par type : les champs viennent du
// contrat (pipeline/kirby/champs-documentation.json), ce fichier ne fait que les lire et
// composer leurs libellés dans la langue de l'interface.
//
// Ce que la webview fait seule : ajouter une fiche, la retirer du DOM, taper dans ses
// champs, plier et déplier. Ce qui touche le disque : enregistrer (par lot), retirer une
// fiche du numéro (elle redevient orpheline), la supprimer pour de bon si elle l'était déjà,
// déposer une image de couverture, traduire/tirer une fiche dans ce numéro, et les décisions
// du réservoir (à traduire / ignorer / annuler).
//
// ⚠ compterBlocsDocumentation() reste dans extension.js : le fournisseur d'arbre (classe
// FournisseurRevue) l'appelle pour le badge de la section « ACTUALITÉ ».
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { T } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { refuserSiVerrouille } = require('./cycle-vie');
const { fermerTousLesApercus } = require('./apercu');
const { confirmerAbandon } = require('./interaction');
const { langueRevue, ecrireAtomique, serialiserMeta, assurerIdNumero, libelleCourtNumero } = require('./yaml');
const { apercuMedia, BUDGET_APERCUS_MEDIA, nomImageAssaini, TAILLE_MAX_IMAGE_IMPORT } = require('./medias');
const kirby = require('./kirby-contenu');
// Résolution de l'ancrage SharePoint : l'onglet Archive lit TOUJOURS la bibliothèque de
// PRODUCTION, même quand le numéro ouvert est en mode test (docs/EMPLACEMENTS.md, §1).
// Aucun chemin de production en dur ici : SEGMENT_APPLICATION est le seul endroit JavaScript
// qui porte le nom du dossier de l'application (lib/rapport-erreur.js) ; racineProduction()
// ci-dessous en dérive de la même façon que resoudreDossierRapports(), sans le segment
// `_Systeme\rapports` propre aux rapports d'erreur.
const rapportErreur = require('./rapport-erreur');

// Doivent rester alignées avec les constantes du même nom dans extension.js (le type de
// fiche de la page de Documentation, et le slug qu'elle prend par défaut).
const TYPE_ACTUALITE = 'documentation';
const SLUG_DOCUMENTATION = 'documentation';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  focaliserUnite: () => {},
  lireCouleurAccent: () => '',
  limitesMedias: () => ({}),
  revueCourante: () => 'revue',
  nomRevueAffiche: (revue) => String(revue || ''),
  convertirCmykSiBesoin: async () => 0,
  repondreModeTrad: () => false
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function dossierUnites() {
  return (session.profilOuvrage() || profils.profilPour('revue')).unites.dossier;
}
function cheminMeta(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.meta.yaml');
}
function dossierArticleDoc(racine, slug) { return path.join(racine, dossierUnites(), slug); }

function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// ---- Libellés composés depuis le contrat -------------------------------------------

function optionsInstrument(canton, langue) {
  return kirby.ordreInstruments(canton).map((jeton) => {
    const libelle = ((kirby.valeursListe('instrument').find((x) => x.jeton === jeton) || {})[langue]) || jeton;
    const suffixe = kirby.instrumentEstLocal(jeton) ? ' (' + kirby.cantonsInstrument(jeton).join(', ') + ')' : '';
    return { valeur: jeton, libelle: libelle + suffixe };
  });
}
function tableInstrumentsParCanton(langue) {
  const table = { '': optionsInstrument('', langue) };
  for (const c of kirby.valeursListe('canton')) { table[c.jeton] = optionsInstrument(c.jeton, langue); }
  return table;
}
function optionsListe(nomListe, langue) {
  return kirby.valeursListe(nomListe).map((v) => ({ valeur: v.jeton, libelle: v[langue] || v.fr }));
}
function configChamp(champ, langue) {
  const c = {
    cle: champ.cle, libelle: champ.libelle[langue] || champ.libelle.fr, saisie: champ.saisie,
    requis: !!champ.requis
  };
  if (champ.quand) { c.quand = champ.quand; }
  if (champ.saisie === 'liste') {
    c.options = optionsListe(champ.liste, langue);
    if (champ.liste === 'instrument') { c.dependDe = 'canton'; c.optionsParCanton = tableInstrumentsParCanton(langue); }
  }
  if (champ.saisie === 'liste_multiple') {
    // Triées par nom (Robin) — jamais l'ordre du JSON, qui pour `pays` n'a aucun sens
    // éditorial (250 codes ISO). Locale-aware : « Ile-de-France » et « Île-de-France »
    // voisinent, comme partout ailleurs dans ce formulaire (calculerOrdreFiches).
    c.options = optionsListe(champ.liste, langue)
      .sort((a, b) => a.libelle.localeCompare(b.libelle, langue, { sensitivity: 'base', numeric: true }));
  }
  if (champ.saisie === 'structure') {
    c.structureChamps = champ.champs.map((sc) => configChamp(sc, langue));
  }
  if (champ.saisie === 'fichier') { c.extensions = champ.extensions || []; }
  if (champ.saisie === 'derive') {
    c.depuis = champ.depuis;
    c.table = {};
    const source = champDuTypeParCle(langue, champ.depuis);
    if (source && source.saisie === 'liste') {
      for (const opt of optionsListe(source.liste, langue)) { c.table[opt.valeur] = kirby.valeurDerive(champ, { [champ.depuis]: opt.valeur }); }
    }
  }
  return c;
}
function champDuTypeParCle(langue, cle) {
  for (const type of kirby.typesConnus()) {
    const c = kirby.champDuType(type, cle);
    if (c) { return c; }
  }
  return null;
}
function typesRessourceConfig(langue) {
  return kirby.typesConnus().map((type) => {
    const champFichier = kirby.champFichierDuType(type);
    return {
      valeur: type,
      libelleSection: kirby.libelleType(type, langue),
      libelleAjouter: T('ressource.ajouter.' + type),
      libelleAjouterTip: T('ressource.ajouter.' + type + '.tip'),
      avecImage: !!champFichier,
      champFichier: champFichier,
      champs: kirby.champsDuType(type).map((c) => configChamp(c, langue))
    };
  });
}
function typesRubriqueConfig(revueJeton, langue) {
  return kirby.rubriquesPourRevue(revueJeton).map((r) => ({ valeur: r.cle, libelleSection: r.titre[langue] || r.titre.fr }));
}

// Tous les libellés du formulaire de Documentation qui ne sont pas des noms de champ.
//
// ⚠ Une clé oubliée ici ne casse rien : la page affiche « undefined » à sa place. C'est
//   test/js/contrats.test.js qui l'attrape.
function textesDocumentation() {
  return {
    choisirFichier: T('medias.choisirFichier'),
    imageAbsente: T('ressource.image.absente'), imageDeposee: T('ressource.image.deposee'),
    errFormat: T('medias.err.format'), errTropVolumineuse: T('medias.err.tropvolumineux'),
    retirerTip: T('ressource.retirer.tip'),
    supprimerTip: T('ressource.supprimer.tip'),
    sansTitre: T('ressource.sansTitre'),
    manque: T('ressource.manque'),
    optionVide: T('ressource.option.vide'),
    badgeIncomplet: T('doc.badge.incomplet'), badgeVide: T('doc.badge.vide'),
    sommaire: T('doc.sommaire'),
    groupeRubriques: T('doc.groupe.rubriques'), groupeFiches: T('doc.groupe.fiches'),
    viderTip: T('rubrique.vider.tip'),
    champContenu: T('rubrique.champ.contenu'),
    champContenuIndice: T('rubrique.champ.contenu.indice'),
    gras: T('rubrique.gras'), grasTip: T('rubrique.gras.tip'),
    italique: T('rubrique.italique'), italiqueTip: T('rubrique.italique.tip'),
    lien: T('rubrique.lien'), lienTip: T('rubrique.lien.tip'),
    liste: T('rubrique.liste'), listeTip: T('rubrique.liste.tip'),
    ajouterLigne: T('doc.suivi.ajouter'), ajouterLigneTip: T('doc.suivi.ajouter.tip'),
    retirerLigneTip: T('doc.suivi.retirer.tip'),
    listeMultipleRecherche: T('doc.listeMultiple.recherche'),
    listeMultipleAucunResultat: T('doc.listeMultiple.aucunResultat'),
    listeMultipleRetirerTip: T('doc.listeMultiple.retirer.tip'),
    enregistrer: T('img.enregistrer'), enregistrerTip: T('doc.enregistrer.tip'),
    enregistre: T('doc.enregistre'), nonEnregistre: T('img.nonEnregistre'),
    rienAEcrire: T('doc.rienAEcrire'),
    retour: T('img.retour'), retourTip: T('doc.retour.tip'),
    // Traductions à faire / Réservoir / Mes orphelines
    ongletTraductions: T('doc.onglet.traductions'), ongletReservoir: T('doc.onglet.reservoir'),
    ongletNumero: T('doc.onglet.numero'),
    traductionsVide: T('doc.traductions.vide'),
    traduireDansNumero: T('doc.traductions.traduire'), traduireDansNumeroTip: T('doc.traductions.traduire.tip'),
    reservoirFiltre: T('doc.reservoir.filtre'), reservoirFiltreTous: T('doc.reservoir.filtre.tous'),
    reservoirVide: T('doc.reservoir.vide'),
    reservoirATraduire: T('doc.reservoir.atraduire'), reservoirATraduireTip: T('doc.reservoir.atraduire.tip'),
    reservoirIgnorer: T('doc.reservoir.ignorer'), reservoirIgnorerTip: T('doc.reservoir.ignorer.tip'),
    reservoirAfficherIgnorees: T('doc.reservoir.afficherIgnorees'),
    reservoirToutSelectionner: T('doc.reservoir.toutSelectionner'),
    reservoirAnnuler: T('doc.reservoir.annuler'), reservoirAnnulerTip: T('doc.reservoir.annuler.tip'),
    orphelinesTitre: T('doc.orphelines.titre'), orphelinesVide: T('doc.orphelines.vide'),
    tirerDansNumero: T('doc.orphelines.tirer'), tirerDansNumeroTip: T('doc.orphelines.tirer.tip'),
    // Onglet Archive : toute la bibliothèque de production, lecture seule.
    ongletArchive: T('doc.onglet.archive'),
    archiveChargement: T('doc.archive.chargement'),
    archiveActualiser: T('doc.archive.actualiser'), archiveActualiserTip: T('doc.archive.actualiser.tip'),
    archiveAncrageIntrouvable: T('doc.archive.ancrageIntrouvable'),
    archiveVide: T('doc.archive.vide'),
    archiveRechercheIndice: T('doc.archive.rechercheIndice'),
    archiveFiltreType: T('doc.archive.filtre.type'), archiveFiltreTypeTous: T('doc.archive.filtre.typeTous'),
    archiveFiltreRevue: T('doc.archive.filtre.revue'), archiveFiltreRevueToutes: T('doc.archive.filtre.revueToutes'),
    archiveFiltreNumero: T('doc.archive.filtre.numero'), archiveFiltreNumeroTous: T('doc.archive.filtre.numeroTous'),
    archiveFiltreAnnee: T('doc.archive.filtre.annee'), archiveFiltreAnneeToutes: T('doc.archive.filtre.anneeToutes'),
    archiveAucunResultat: T('doc.archive.aucunResultat'),
    archiveSansNumero: T('doc.archive.sansNumero'),
    archiveReprendre: T('doc.archive.reprendre'), archiveReprendreTip: T('doc.archive.reprendre.tip'),
    archiveRepriseOk: T('doc.archive.reprise.ok'), archiveRepriseEchec: T('doc.archive.reprise.echec'),
    archiveApercuTitre: T('doc.archive.apercu.titre'), archiveApercuFermer: T('doc.archive.apercu.fermer'),
    archiveApercuImageChargement: T('doc.archive.apercu.imageChargement'),
    archiveCompteur: T('doc.archive.compteur')
  };
}

// ---- L'onglet Archive : bibliothèque de PRODUCTION, toujours — même en mode test ------
//
// racineProduction() : dérivée de l'ancrage SharePoint résolu (rapport-erreur.js#resoudreAncrage,
// LE SEUL module qui sait le trouver sans jamais balayer le disque ni ouvrir de fenêtre —
// exactement ce qu'il faut ici, un panneau webview n'a pas de quoi montrer un sélecteur de
// dossier). `null` si l'ancrage n'est pas résolu : l'appelant journalise dans l’onglet, rien
// d'autre (docs/EMPLACEMENTS.md, §1 et §8). AUCUN segment de chemin en dur ici :
// rapportErreur.SEGMENT_APPLICATION est le seul endroit JavaScript qui porte le nom du
// dossier de production.
function racineProduction() {
  const ancrage = rapportErreur.resoudreAncrage();
  if (!ancrage || !ancrage.trouve) { return null; }
  return path.join(ancrage.chemin, '2_Produkte', rapportErreur.SEGMENT_APPLICATION);
}

// indexNumerosProduction(racineProductionVal) -> { <id>: { label, revue, annee } } — résout
// l'id Ausgabe d'une fiche en un libellé lisible (« Revue 2025/1 »), en lisant les
// ausgabe.yaml des numéros en cours ET archivés de la racine de PRODUCTION (kirby.listerNumeros
// couvre déjà les deux). `annee` extraite du libellé (premier groupe de 4 chiffres), pour le
// filtre par année de l'onglet Archive.
function indexNumerosProduction(racineProductionVal) {
  const index = {};
  for (const n of kirby.listerNumeros(racineProductionVal)) {
    if (!n.id) { continue; }
    const label = libelleCourtNumero(n.chemin) || n.nom;
    const annee = (label.match(/\d{4}/) || [''])[0];
    index[n.id] = { label: label, revue: n.revue, annee: annee };
  }
  return index;
}

// Un id inconnu de l'index (numéro renommé, déplacé hors de l'arbre, ou dossier copié à la
// main sans id retrouvé) s'affiche par son id tel quel — jamais masqué, jamais une ligne
// vide (docs/FORMAT-DOCUMENTATION-KIRBY.md, esprit des avertissements de kirby-contenu.js).
function libelleNumeroIndexe(index, id) {
  const e = index[id];
  return e ? Object.assign({ id: id }, e) : { id: id, label: id, revue: '', annee: '' };
}

// Le texte plein cherché par la recherche de l'onglet Archive : titre, descriptif et les
// quelques champs « auteur/lieu » qui existent selon le type — jamais les champs système, ni
// les listes fermées (canton, catégorie…), qui ont leur propre filtre.
const CHAMPS_RECHERCHE_ARCHIVE = ['title', 'descriptif', 'auteurs', 'institutions', 'realisateur', 'organisateur', 'lieu', 'editeur', 'distributeur'];
function texteRechercheArchive(valeursParLangue) {
  const morceaux = [];
  for (const l of Object.keys(valeursParLangue)) {
    const v = valeursParLangue[l];
    if (!v) { continue; }
    for (const cle of CHAMPS_RECHERCHE_ARCHIVE) { if (v[cle]) { morceaux.push(String(v[cle])); } }
  }
  return morceaux.join(' ').toLowerCase();
}

// Un enregistrement de kirby.listerBibliothequeComplete() -> une ligne pour l'onglet Archive :
// titre dans chaque langue présente, valeurs complètes de chaque langue (texte seulement —
// l'image, plus lourde, est demandée à part au clic, voir ARCHIVE_IMAGE plus bas), et les
// numéros de rattachement lisibles, un par langue rattachée.
function ligneArchive(enregistrement, index) {
  const langues = kirby.languesDuContrat();
  const titres = {}, valeurs = {}, numeros = [];
  const presentes = [];
  for (const l of langues) {
    const f = enregistrement.parLangue[l];
    if (f) {
      presentes.push(l);
      titres[l] = f.valeurs.title || '';
      valeurs[l] = f.valeurs;
      if (f.ausgabe) { numeros.push(Object.assign({ langue: l }, libelleNumeroIndexe(index, f.ausgabe))); }
    } else {
      titres[l] = '';
      valeurs[l] = null;
    }
  }
  return {
    type: enregistrement.type, slug: enregistrement.slug,
    langues: presentes, titres: titres, valeurs: valeurs, numeros: numeros,
    recherche: texteRechercheArchive(valeurs)
  };
}

// construireReponseArchive() -> le message ARCHIVE_DONNEES envoyé sur demande (jamais à
// l'ouverture du panneau) — lit la bibliothèque de production UNE fois, ici, et rien d'autre
// ne la relit tant que la page ne redemande pas ARCHIVE_CHARGER/ARCHIVE_ACTUALISER.
function construireReponseArchive() {
  const racineProductionVal = racineProduction();
  if (!racineProductionVal) {
    return { type: MSG.ARCHIVE_DONNEES, ok: false, message: T('doc.archive.ancrageIntrouvable') };
  }
  const index = indexNumerosProduction(racineProductionVal);
  const fiches = kirby.listerBibliothequeComplete(racineProductionVal).map((e) => ligneArchive(e, index));
  return { type: MSG.ARCHIVE_DONNEES, ok: true, fiches: fiches };
}

function htmlDocumentation(nonce) {
  return construireHtml('documentation', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    titre: T('doc.titre', ['']),
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Le nom du numéro (nom de dossier) qui porte cet id, dans l'arbre — pour afficher « de la
// Zeitschrift, numéro 2026-01 » sans faire porter ce calcul à kirby-contenu.js (pur, mais
// sans notion d'affichage).
function nomNumeroPour(racineArbreVal, ausgabeId) {
  if (!ausgabeId) { return ''; }
  const trouve = kirby.listerNumeros(racineArbreVal).find((n) => n.id === ausgabeId);
  return trouve ? trouve.nom : '';
}

// La liste d'Uuid d'un geste de décision du réservoir : `uuids` (sélection multiple, la
// barre d'actions en lot) prime sur `uuid` (bouton d'une seule ligne) — jamais les deux à la
// fois côté webview, mais peu importe si c'était le cas : ce n'est pas un cumul.
function uuidsDuMessage(msg) {
  if (Array.isArray(msg.uuids)) { return msg.uuids.map((u) => String(u || '')).filter((u) => u !== ''); }
  const seul = String(msg.uuid || '');
  return seul === '' ? [] : [seul];
}

// Dépose l'image d'une fiche AVANT qu'elle n'ait de dossier (elle n'existe encore que dans
// la webview) : mise de côté hors bibliothèque (kirby.deposerImageProvisoire, os.tmpdir()),
// installée dans le dossier de la fiche au moment où enregistrer() l'écrit.
async function deposerImageRessource(panneau, idsImagesEnAttente, msg) {
  const id = String(msg.id || '');
  const echec = (message) => repondrePanneau(panneau, { type: 'image-erreur', id: id, message: message });
  if (session.buildEnCours() || session.importEnCours()) { echec(T('statut.occupe')); return; }
  const nom = nomImageAssaini(msg.nomFichier);
  if (!nom) { echec(T('importv.err.format')); return; }
  const donnees = Buffer.from(String(msg.donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { echec(T('importv.err.format')); return; }
  if (donnees.length > TAILLE_MAX_IMAGE_IMPORT) { echec(T('importv.err.tropvolumineux')); return; }
  let cible;
  try { cible = kirby.deposerImageProvisoire(id, nom, donnees); }
  catch (e) { echec(T('err.copie', [nom, e.message])); return; }
  idsImagesEnAttente.add(id);
  await ctx.convertirCmykSiBesoin([cible]);       // un JPEG d'imprimerie ne s'affiche pas
  repondrePanneau(panneau, {
    type: 'image-deposee', id: id, image: path.basename(cible).replace(/^[^_]*__/, ''),
    apercu: apercuMedia(cible, { reste: BUDGET_APERCUS_MEDIA })
  });
}

// Crée la page de Documentation du numéro : son dossier, sa fiche de métadonnées de type
// « documentation » et son documentation.<lang>.txt (les rubriques naissent vides). Aucune
// fiche : elles vivent toutes dans la bibliothèque partagée. Rend le slug, ou null si
// l'écriture a échoué.
function creerPageDocumentation(fournisseur) {
  const racine = fournisseur.racine;
  const base = path.join(racine, dossierUnites());
  let slug = SLUG_DOCUMENTATION;
  let n = 2;
  while (fs.existsSync(path.join(base, slug))) { slug = SLUG_DOCUMENTATION + '-' + n; n++; }
  const langue = langueRevue(racine);
  const titre = {};
  titre[langue] = T('doc.titre.page');
  try {
    fs.mkdirSync(path.join(base, slug), { recursive: true });
    ecrireAtomique(cheminMeta(racine, slug), serialiserMeta({
      type: TYPE_ACTUALITE, lang: langue, doi: '',
      title: titre, subtitle: {}, keywords: {}, author: []
    }));
    kirby.ecrirePage(path.join(base, slug), langue, { title: titre[langue], rubriques: {} });
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [slug, e.message]));
    return null;
  }
  vscode.window.setStatusBarMessage(T('doc.creee'), 5000);
  return slug;
}

async function ouvrirPageDocumentation(fournisseur, rafraichirTout) {
  if (!fournisseur.racine) { return; }
  const profil = session.profilOuvrage() || profils.profilPour('revue');
  if (profil.cle !== 'revue') { return; }      // un livre n'a pas de Documentation
  let slug = fournisseur.slugDocumentation();
  if (!slug) {
    if (refuserSiVerrouille()) { return; }
    slug = creerPageDocumentation(fournisseur);
    if (!slug) { return; }
    if (rafraichirTout) { rafraichirTout(); }
  }
  await ouvrirDocumentation(fournisseur, rafraichirTout, slug);
}

let panneauxDocumentation = new Map();   // slug -> WebviewPanel (un formulaire par unité)

function fermerPanneauxDocumentationDe(racine, slug) {
  const tout = !racine || !slug;
  for (const [cle, panneau] of Array.from(panneauxDocumentation.entries())) {
    if (!tout && cle !== slug) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    panneauxDocumentation.delete(cle);
  }
}

async function ouvrirDocumentation(fournisseur, rafraichirTout, slug) {
  if (!fournisseur.racine || !slug) { return; }
  const racine = fournisseur.racine;
  if (!new Set(fournisseur.listerArticles()).has(slug)) {
    vscode.window.setStatusBarMessage(T('ressource.horsarticle'), 4000);
    return;
  }
  ctx.focaliserUnite(fournisseur, slug);
  const dossierArticle = dossierArticleDoc(racine, slug);
  const langue = langueRevue(racine);
  const revueJeton = ctx.revueCourante(racine);
  const racineArbreVal = kirby.racineArbre(racine);
  // L'id est normalement déjà posé — extension.js#majContexte le fait à l'ouverture du
  // numéro, avec l'avertissement de doublon. assurerIdNumero() est idempotente : filet de
  // sécurité si ce formulaire s'ouvrait avant tout passage par majContexte.
  const ausgabeId = assurerIdNumero(racine);

  const existant = panneauxDocumentation.get(slug);
  if (existant) { existant.reveal(vscode.ViewColumn.One); return; }
  await fermerTousLesApercus();
  const titrePanneau = T('doc.titre.page');
  const panneau = vscode.window.createWebviewPanel(
    'szhDocumentation', titrePanneau, vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
  );
  panneauxDocumentation.set(slug, panneau);
  // Toute image déposée dans cette session et jamais réclamée par une fiche enregistrée
  // (carte retirée avant sauvegarde, panneau fermé sans enregistrer) doit être nettoyée : le
  // dépôt vit hors bibliothèque (os.tmpdir()), mais rien n'empêche qu'il s'accumule.
  const idsImagesEnAttente = new Set();
  panneau.onDidDispose(() => {
    if (panneauxDocumentation.get(slug) === panneau) { panneauxDocumentation.delete(slug); }
    for (const id of idsImagesEnAttente) { kirby.nettoyerImageProvisoire(id); }
    idsImagesEnAttente.clear();
  });

  // uuid -> slug, pour les fiches DE CE NUMÉRO — reconstruit à chaque charger() : c'est ce
  // qui permet à enregistrer()/retirer() de retrouver le dossier d'une fiche existante sans
  // parcourir toute la bibliothèque à chaque frappe.
  let slugParUuid = new Map();

  function listerRessources(budget) {
    const fiches = kirby.listerFichesNumero(racineArbreVal, langue, ausgabeId);
    slugParUuid = new Map(fiches.map((f) => [f.uuid, f.slug]));
    return fiches.map((f) => {
      const cle = kirby.champFichierDuType(f.type);
      const nomImage = cle ? f.valeurs[cle] : '';
      const apercu = nomImage
        ? apercuMedia(path.join(kirby.cheminFiche(racineArbreVal, f.type, f.slug), nomImage), budget) : null;
      return { id: f.uuid, type: f.type, valeurs: f.valeurs, apercu: apercu };
    });
  }
  function listerRubriques() {
    const page = kirby.lirePage(dossierArticle, langue);
    return kirby.rubriquesPourRevue(revueJeton).map((r) =>
      ({ id: r.cle, type: r.cle, contenu: page.rubriques[r.cle] || '' }));
  }
  function listerTraductions() {
    return kirby.listerTraductionsATraire(racineArbreVal, langue).map((t) => ({
      slug: t.slug, type: t.type, typeLibelle: kirby.libelleType(t.type, langue), titre: t.titreSource,
      origine: T('doc.origine.numero', [ctx.nomRevueAffiche(t.langueSource === 'de' ? 'zeitschrift' : 'revue'),
        nomNumeroPour(racineArbreVal, t.ausgabeSource)])
    }));
  }
  function listerReservoirNumeros() {
    const autre = kirby.autreRevue(revueJeton) || 'zeitschrift';
    return kirby.listerNumeros(racineArbreVal).filter((n) => n.revue === autre && n.id)
      .map((n) => ({ id: n.id, nom: n.nom + (n.archive ? ' ' + T('doc.reservoir.archive') : '') }));
  }
  function listerReservoirEntrees(avecIgnorees) {
    return kirby.listerReservoir(racineArbreVal, langue, { avecIgnorees: !!avecIgnorees }).map((r) => ({
      slug: r.slug, uuid: r.uuid, type: r.type, typeLibelle: kirby.libelleType(r.type, langue),
      titre: r.titreSource, ausgabeSource: r.ausgabeSource, ignoree: !!r.ignoree
    }));
  }
  function listerMesOrphelines() {
    return kirby.listerOrphelines(racineArbreVal, langue).map((f) => ({
      slug: f.slug, uuid: f.uuid, type: f.type, typeLibelle: kirby.libelleType(f.type, langue), titre: f.valeurs.title
    }));
  }

  async function charger(vers, extra) {
    const budget = { reste: BUDGET_APERCUS_MEDIA };
    repondrePanneau(vers, Object.assign({
      type: 'charger', slug: slug,
      ressources: listerRessources(budget),
      rubriques: listerRubriques(),
      typesConfig: typesRessourceConfig(langue),
      typesRubrique: typesRubriqueConfig(revueJeton, langue),
      traductions: listerTraductions(),
      reservoirNumeros: listerReservoirNumeros(),
      reservoir: listerReservoirEntrees(false),
      orphelines: listerMesOrphelines(),
      accent: ctx.lireCouleurAccent(racine),
      i18n: textesDocumentation(),
      limites: ctx.limitesMedias()
    }, extra || {}));
  }

  // Écrit ce que la webview envoie : les fiches, puis les rubriques (si la page en porte).
  const enregistrer = async (liste, listeRubriques) => {
    let total = 0;
    const correspondances = [];
    listerRessources({ reste: 0 });   // reconstruit slugParUuid sans calculer d'aperçus
    for (const r of (Array.isArray(liste) ? liste : [])) {
      const id = String((r && r.id) || '');
      const type = String((r && r.type) || '');
      if (id === '' || !kirby.typeConnu(type)) { continue; }
      const valeurs = Object.assign({}, (r && r.valeurs) || {});
      const slugExistant = slugParUuid.get(id) || null;
      if (!slugExistant && !kirby.ficheEcrivable(type, valeurs)) { continue; }
      const imageSource = kirby.imageProvisoire(id);
      try {
        if (slugExistant) {
          kirby.enregistrerFicheLangue(racineArbreVal, slugExistant, langue, type, valeurs, imageSource);
        } else {
          const cree = kirby.creerFiche(racineArbreVal, langue, type, valeurs, ausgabeId, imageSource);
          correspondances.push({ avant: id, apres: cree.uuid });
          slugParUuid.set(cree.uuid, cree.slug);
        }
      } finally {
        if (imageSource) { idsImagesEnAttente.delete(id); kirby.nettoyerImageProvisoire(id); }
      }
      total++;
    }
    // Les fiches se rangent d'elles-mêmes — une seule fois, après la boucle.
    if (total > 0) { kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId); }

    // Les rubriques ensuite, sans tri d'aucune sorte — leur ordre est un choix éditorial.
    if (Array.isArray(listeRubriques) && listeRubriques.length > 0) {
      const pageActuelle = kirby.lirePage(dossierArticle, langue);
      const rubriques = Object.assign({}, pageActuelle.rubriques);
      let touche = false;
      for (const r of listeRubriques) {
        const cle = String((r && r.id) || (r && r.type) || '');
        if (cle === '' || !kirby.rubriquesDuContrat().some((x) => x.cle === cle)) { continue; }
        const contenu = String((r && r.contenu) !== undefined && r.contenu !== null ? r.contenu : '');
        if (rubriques[cle] !== contenu) { touche = true; }
        rubriques[cle] = contenu;
      }
      if (touche) {
        kirby.ecrirePage(dossierArticle, langue,
          { title: pageActuelle.title, uuid: pageActuelle.uuid, rubriques: rubriques });
        total++;
      }
    }
    if (total > 0 && rafraichirTout) { rafraichirTout(); }
    return { total: total, correspondances: correspondances };
  };

  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (ctx.repondreModeTrad(panneau, msg)) { return; }
    if (msg.type === MSG.PRET) { await charger(panneau, { requete: msg.requete }); return; }
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + titrePanneau;
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const resultat = await enregistrer(msg.ressources, msg.rubriques);
      repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto, correspondances: resultat.correspondances });
      if (resultat.total > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('doc.statut.enregistres', [resultat.total]), 5000); }
      return;
    }
    // Retirer une fiche du numéro = la rendre orpheline (Ausgabe vidé) — jamais une
    // suppression. Une rubrique vidée, elle, reste dans le fichier de page : c'est
    // enregistrer() qui la vide, pas ce message (voir le formulaire).
    if (msg.type === MSG.RETIRER) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: 'erreur', message: T('verrou.refuse') });
        return;
      }
      const id = String(msg.id || '');
      if (id === '' || msg.famille !== 'fiche') { return; }
      const slugCible = slugParUuid.get(id);
      if (!slugCible) { return; }               // déjà partie : rien à faire
      kirby.detacherFiche(racineArbreVal, slugCible, langue);
      kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId);
      if (rafraichirTout) { rafraichirTout(); }
      return;
    }
    // Supprimer pour de bon : seulement une fiche déjà orpheline (« Mes orphelines »),
    // avec confirmation — supprimerFicheOrpheline() refuse elle-même une fiche rattachée.
    if (msg.type === MSG.SUPPRIMER) {
      if (refuserSiVerrouille()) { return; }
      const slugCible = String(msg.slug || '');
      if (slugCible === '') { return; }
      const reponse = await vscode.window.showWarningMessage(
        T('ressource.supprimer.question'), { modal: true }, T('modale.supprimer.bouton'));
      if (reponse !== T('modale.supprimer.bouton')) { return; }
      const r = kirby.supprimerFicheOrpheline(racineArbreVal, slugCible, langue);
      if (r.ok) {
        vscode.window.setStatusBarMessage(T('ressource.supprimee'), 5000);
        await charger(panneau);
      }
      return;
    }
    if (msg.type === MSG.DEPOSER_IMAGE) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: 'image-erreur', id: msg.id, message: T('verrou.refuse') });
        return;
      }
      await deposerImageRessource(panneau, idsImagesEnAttente, msg);
      return;
    }
    // Traduire une fiche du réservoir/traductions-à-faire dans CE numéro : crée le fichier
    // de ma langue, pré-rempli depuis l'autre langue, Ausgabe = ce numéro.
    if (msg.type === MSG.TRADUIRE_DANS_NUMERO) {
      if (refuserSiVerrouille()) { return; }
      const slugCible = String(msg.slug || '');
      if (slugCible === '') { return; }
      const r = kirby.traduireDansNumero(racineArbreVal, slugCible, langue, ausgabeId);
      if (r.ok) {
        kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId);
        await charger(panneau);
        if (rafraichirTout) { rafraichirTout(); }
      }
      return;
    }
    // Tirer une de mes orphelines dans ce numéro.
    if (msg.type === MSG.TIRER_DANS_NUMERO) {
      if (refuserSiVerrouille()) { return; }
      const slugCible = String(msg.slug || '');
      if (slugCible === '') { return; }
      const r = kirby.tirerDansNumero(racineArbreVal, slugCible, langue, ausgabeId);
      if (r.ok) {
        kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId);
        await charger(panneau);
        if (rafraichirTout) { rafraichirTout(); }
      }
      return;
    }
    // Décisions du réservoir : ne touchent jamais à ce numéro (statuts hors bibliothèque de
    // fiches), donc pas de garde de verrou — c'est un tri personnel, indépendant du numéro
    // ouvert. `uuids` (sélection multiple) ou `uuid` (bouton d'une seule ligne) : dans les
    // deux cas, un seul passage d'écriture puis un seul rechargement — jamais un message par
    // fiche, jamais un rechargement par fiche.
    if (msg.type === MSG.MARQUER_A_TRADUIRE || msg.type === MSG.IGNORER_TRADUCTION || msg.type === MSG.ANNULER_DECISION) {
      const uuids = uuidsDuMessage(msg);
      if (uuids.length === 0) { return; }
      for (const uuid of uuids) {
        if (msg.type === MSG.MARQUER_A_TRADUIRE) { kirby.ecrireStatutFiche(racineArbreVal, langue, uuid, 'a-traduire'); }
        else if (msg.type === MSG.IGNORER_TRADUCTION) { kirby.ecrireStatutFiche(racineArbreVal, langue, uuid, 'ignore'); }
        else { kirby.effacerStatutFiche(racineArbreVal, langue, uuid); }
      }
      await charger(panneau);
      return;
    }
    // L'interrupteur « afficher les ignorées » : une réponse ciblée, pas un rechargement
    // complet — la sélection de numéros du filtre, côté webview, n'a pas à être reconstruite.
    if (msg.type === MSG.RESERVOIR_FILTRE) {
      repondrePanneau(panneau, {
        type: 'reservoir', avecIgnorees: !!msg.avecIgnorees,
        entrees: listerReservoirEntrees(!!msg.avecIgnorees)
      });
      return;
    }
    // Onglet Archive : lu à la demande seulement (ARCHIVE_CHARGER — première ouverture de
    // l'onglet — ou ARCHIVE_ACTUALISER — bouton « Actualiser »), jamais à charger(). Pas de
    // garde de verrou : c'est une LECTURE de la bibliothèque de production, jamais du numéro
    // ouvert.
    if (msg.type === MSG.ARCHIVE_CHARGER || msg.type === MSG.ARCHIVE_ACTUALISER) {
      repondrePanneau(panneau, construireReponseArchive());
      return;
    }
    // L'image d'une fiche archivée, demandée à part (au clic sur l'aperçu) : jamais en bloc
    // avec ARCHIVE_DONNEES, qui porterait alors une image par fiche pour des centaines de
    // fiches à chaque ouverture de l'onglet.
    if (msg.type === MSG.ARCHIVE_IMAGE) {
      const ficheType = String(msg.ficheType || '');
      const slugCible = String(msg.slug || '');
      if (ficheType === '' || slugCible === '') { return; }
      const racineProductionVal = racineProduction();
      let apercu = null;
      if (racineProductionVal) {
        const cleFichier = kirby.champFichierDuType(ficheType);
        let nomImage = '';
        if (cleFichier) {
          for (const l of kirby.languesDuContrat()) {
            const f = kirby.lireFicheSlugLangue(racineProductionVal, slugCible, l, ficheType);
            if (f && f.valeurs[cleFichier]) { nomImage = f.valeurs[cleFichier]; break; }
          }
        }
        if (nomImage) {
          const cheminImage = path.join(kirby.cheminFiche(racineProductionVal, ficheType, slugCible), nomImage);
          apercu = apercuMedia(cheminImage, { reste: BUDGET_APERCUS_MEDIA });
        }
      }
      repondrePanneau(panneau, { type: MSG.ARCHIVE_IMAGE_DONNEE, ficheType: ficheType, slug: slugCible, apercu: apercu });
      return;
    }
    // « Reprendre dans ce numéro » : crée une fiche NEUVE (nouvel Uuid, nouveau dossier)
    // dans la bibliothèque ACTIVE (racineArbreVal — celle du numéro ouvert, test ou
    // production), rattachée à CE numéro, avec `origine` = Uuid de la fiche archivée. La
    // fiche archivée (bibliothèque de production) n'est jamais modifiée.
    if (msg.type === MSG.ARCHIVE_REPRENDRE) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: MSG.ARCHIVE_REPRISE, ok: false, message: T('verrou.refuse') });
        return;
      }
      const ficheType = String(msg.ficheType || '');
      const slugSource = String(msg.slug || '');
      if (ficheType === '' || slugSource === '') { return; }
      const racineProductionVal = racineProduction();
      if (!racineProductionVal) {
        repondrePanneau(panneau, { type: MSG.ARCHIVE_REPRISE, ok: false, message: T('doc.archive.ancrageIntrouvable') });
        return;
      }
      const r = kirby.reprendreDansNumero(racineProductionVal, racineArbreVal, langue, ficheType, slugSource, ausgabeId);
      if (r.ok) {
        kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId);
        await charger(panneau);
        repondrePanneau(panneau, { type: MSG.ARCHIVE_REPRISE, ok: true });
        if (rafraichirTout) { rafraichirTout(); }
      } else {
        repondrePanneau(panneau, { type: MSG.ARCHIVE_REPRISE, ok: false, message: T('doc.archive.reprise.echec') });
      }
      return;
    }
    if (msg.type === MSG.RETOUR_ARTICLE) {
      if (msg.modifie) {
        const choix = await confirmerAbandon(T('doc.quitter.page'));
        if (choix === 'annuler') { return; }          // Annuler : on reste
        if (choix === 'enregistrer') { await enregistrer(msg.ressources, msg.rubriques); }
      }
      // La page de Documentation n'a pas de texte à relire : son arborescence n'est qu'un
      // magasin de rubriques, jamais ouverte à la main — le panneau se ferme sur l'arbre.
      panneau.dispose();
      if (rafraichirTout) { rafraichirTout(); }
      return;
    }
    console.warn('documentation : type de message inconnu', msg.type);
  });
  panneau.webview.html = htmlDocumentation(crypto.randomBytes(16).toString('hex'));
}

module.exports = {
  configurer,
  ouvrirDocumentation, ouvrirPageDocumentation, fermerPanneauxDocumentationDe,
  dossierArticleDoc,
  // Les fabriques de libellés du formulaire, exposées pour le contrôle. Elles ne sont pas
  // pures — elles lisent la langue et le contrat — et c'est précisément ce qu'il faut
  // éprouver : test/js/actualite.test.js les appelle dans les deux langues et exige que
  // tout diffère.
  _libelles: { textesDocumentation, typesRessourceConfig, typesRubriqueConfig, optionsInstrument }
};
