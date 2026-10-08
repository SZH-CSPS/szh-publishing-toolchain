// Extension « Pronto » : la vue du cockpit dans l'Explorateur de VSCodium (articles, Word
// en attente, traductions) et ses commandes. La vue s'affiche quand le dossier ouvert est
// un numéro de revue (ausgabe.yaml) ou un livre (buch.yaml), selon lib/profil.js.
//
// Ce fichier câble les zones de lib/ : activate/deactivate, l'enregistrement des commandes
// et l'objet _pur exposé aux tests. Il n'y a pas de build : lib/ et media/ doivent rester
// dans le paquet (voir .vscodeignore). Le HTML d'une webview ne contient aucune donnée :
// tout arrive par postMessage, et les libellés %%SZH:cle%% sont résolus par T().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// État du numéro en clés de contexte, lues par les `when` de package.json. Les clés du
// profil (szh.estRevue, szh.estLivre) sont dans lib/profil.js (voir majContexte).
const CLE_VERROUILLEE = 'szh.verrouillee';
const CLE_ARCHIVEE = 'szh.archivee';
const ID_VUE = 'szhCockpitVue';
// Identiques aux labels de vscodium-user/tasks.json.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const NOM_TACHE_EXPORT = 'Tout exporter';
const NOM_TACHE_DOCX = 'Galleys DOCX (OJS)';
// Les quatre sorties propres au livre (pipeline/profils/livre.mk).
const NOM_TACHE_LIVRE_IMPRIMEUR = 'Livre : PDF imprimeur';
const NOM_TACHE_LIVRE_COUVERTURE = 'Livre : couverture';
const NOM_TACHE_LIVRE_EPUB = 'Livre : EPUB';
const NOM_TACHE_LIVRE_WEB = 'Livre : HTML web';
// Les tâches dont le cockpit suit le départ et la fin, plus toute tâche de type « szh ».
const TACHES_SUIVIES = [NOM_TACHE_BUILD, NOM_TACHE_EXPORT, NOM_TACHE_IMPORT, NOM_TACHE_DOCX,
  NOM_TACHE_LIVRE_IMPRIMEUR, NOM_TACHE_LIVRE_COUVERTURE, NOM_TACHE_LIVRE_EPUB, NOM_TACHE_LIVRE_WEB];
function estTacheSuivie(tache) {
  return TACHES_SUIVIES.indexOf(tache.name) !== -1 || !!(tache.definition && tache.definition.type === 'szh');
}
// ---- Le moteur de la chaîne et ses chemins -> lib/moteur.js -----------------------
const moteur = require('./lib/moteur');
const servicesEnv = require('./lib/services-env');

const MAKEFILE_WSL = moteur.toolkitMoteur('pipeline', 'Makefile');
// Réimport d'un article corrigé. Le cockpit l'appelle directement, sans tâche, parce qu'il
// doit lire la ligne JSON que le script rend.
const REIMPORTER_WSL = moteur.toolkitMoteur('pipeline', 'reimporter.py');

// ---- i18n du cockpit -> lib/i18n.js ----------------------------------------------
const { TEXTES_COCKPIT, T, TL, TP, langueCockpit, oublierLanguePoste } = require('./lib/i18n');
// ---- Protocole de messages hôte <-> webviews -> lib/messages.js -----------------
const { MSG } = require('./lib/messages');
// ---- Sérialiseurs YAML -> lib/yaml.js --------------------------------------------
const {
  CLES_METADONNEES, COULEURS_NUMERO, HEX_COULEURS, normaliserRevue, estVraiYaml,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, serialiserAusgabe, ecrireAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, langueDefaut, titreNumero, etatRevue, normaliserLangueArticle,
  LICENCE_DEFAUT, LICENCES_ARTICLE, normaliserLicence, REVUES, idNumero, assurerIdNumero
} = require('./lib/yaml');
// ---- Bibliographie et appels de citation -> lib/citations.js ---------------------
const {
  configBiblio, configAvecTitresBiblio, configAvecLiensDesactives, nomFichierBiblio, cheminBiblio,
  REVUES_BIBLIO, LANGUES_BIBLIO
} = require('./lib/citations');
// Retrouver dans un .md le passage qu'un focus de constat désigne (bouton « Vers l'article »).
const { trouverPlageFocus, focusDeRepli } = require('./lib/reperage-focus');
// ---- Poste et traduction -> lib/archivage.js ; cycle de vie -> lib/cycle-vie.js --
const {
  // Seulement exposée par _pur.
  versionsDivergent,
  lireModeDeveloppeur, lireConfigPoste, ecrireConfigPoste,
  configAvecLangue, CONFIG_POSTE,
  // Vérificateur de traduction et mode « Trad » : des réglages du poste, lus par plusieurs
  // panneaux et conservés à la mise à jour du poste.
  lireVerifTraduction, ecrireVerifTraduction,
  lireModeTrad, ecrireModeTrad
} = require('./lib/archivage');
// ---- Suggestions de traduction -> lib/suggestion-traduction.js -------------------
// Le dossier traduction/ d'un numéro : une proposition par fichier, rien n'est publié.
const suggestionTraduction = require('./lib/suggestion-traduction');
// ---- Index des libellés de l'interface -> lib/index-textes.js --------------------
// Retrouve la clé i18n d'un texte affiché ; le mode « Trad » l'envoie aux panneaux.
const indexTextes = require('./lib/index-textes');
// ---- Rapports d'erreur automatiques -> lib/rapport-erreur.js ---------------------
// La logique est dans le module. Ici, deux points d'appel (COMPIL-ECHEC dans
// relireJournal(), COCKPIT-EXCEPTION plus bas) et le vidage de la file au démarrage.
// Voir docs/RAPPORTS-ERREUR.md.
const rapportErreur = require('./lib/rapport-erreur');
// ---- Compteurs d'usage de l'import -> lib/compteurs.js ----------------------------
// Des entiers et des noms de mesures, sans aucun mot du manuscrit (docs/RAPPORTS-ERREUR.md).
// Trois points d'appel : la fin d'une tâche (relireJournal), la fin d'un réimport réussi
// et le vidage de la file au démarrage.
const compteurs = require('./lib/compteurs');
// ---- Réglages protégés de la chaîne -> lib/reglages-proteges.js -------------------
const proteges = require('./lib/reglages-proteges');
// ---- Fichier de langue de l'interface -> lib/export-langue.js ---------------------
const exportLangue = require('./lib/export-langue');
// ---- Réglages de la maison -> lib/reglages-flotte.js -----------------------------
const { empreinteReglages, clesRefusees } = require('./lib/reglages-flotte');
// ---- Auteur·e·s connus : OJS (OAI-PMH) et les numéros du poste --------------------
// Deux sources, un seul cache. OJS donne les noms et l'affiliation ; la fonction et
// l'e-mail, absents de son interface publique, viennent des fiches meta.yaml des numéros.
const {
  lireCache: lireCacheAuteursPublies, rafraichir: rafraichirCacheAuteursPublies
} = require('./lib/auteurs-ojs');
const { rafraichirCorpus: rafraichirCorpusAuteurs } = require('./lib/auteurs-corpus');
// ---- Mots-clés connus : le vocabulaire edudoc.ch (OAI-PMH) -----------------------
// Cache propre (mots-cles.json), rafraîchi à un rythme décidé par le cockpit
// (voir rafraichirMotsClesEnFond), indépendant du repli mensuel du module.
const {
  lireCacheMotsCles, rafraichirMotsCles
} = require('./lib/mots-cles-edudoc');
// ---- Modèle de tableau -> lib/table-model.js -------------------------------------
const {
  analyserTable, serialiserTable, disposition, matriceOccupation,
  etendreGrille, compacterGrille, normaliserModele, finaliserModele, canoniserInline,
  ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
  fusionner, scinder, viderCellules, alignerCellules,
  deplacerLigne, deplacerColonne,
  tableauDepuisTsv, collerDans, appliquerOperationTable,
  fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule, tableauDepuisHtmlBureautique
} = require('./lib/table-model');
// Recompilation après un enregistrement fait hors de l'éditeur de texte (médias, tableaux)
// -> lib/relance-compilation.js
const relanceCompilation = require('./lib/relance-compilation');
// ---- « Quoi de neuf » -> lib/nouveautes.js ---------------------------------------
// Les notes livrées avec le toolkit, et ce qu'il faut en montrer.
const nouveautes = require('./lib/nouveautes');
// ---- Ce qu'est le dossier ouvert -> lib/profil.js --------------------------------
// Numéro de revue ou livre : la table qui le dit, et les chemins qui en découlent.
const profils = require('./lib/profil');
// ---- Modules impératifs -> lib/{slug,formatting}.js ------------------------------
const { slugifier, slugifierArticle } = require('./lib/slug');
// tige() ignore le préfixe « NN- » d'un dossier : le slug tiré d'un Word (« inclusion »)
// et le dossier importé (« 00-inclusion ») se comparent par elle, sans quoi un Word déjà
// converti ne serait pas reconnu.
const { tige } = require('./lib/renumerotation');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, nomTableLibre,
  enregistrerCommandesMiseEnForme
} = require('./lib/formatting');
// ---- Liens profonds « szh:// » -> lib/liens.js ------------------------------------
const { construireLienTraduction, consommerIntention } = require('./lib/liens');
// Les mêmes liens reçus en vscodium:// par l'éditeur -> lib/uri-hote.js.
const uriHote = require('./lib/uri-hote');
const { enregistrerPanneaux } = require('./lib/panneaux');
// ---- État de session partagé entre les zones -> lib/session.js -------------------
const session = require('./lib/session');
// ---- Cycle de vie du numéro et copies en conflit -> lib/cycle-vie.js -------------
const cycleVie = require('./lib/cycle-vie');
const {
  etatCourant, compilationAutoCoupee, refuserSiArchivee, refuserSiVerrouille,
  appliquerEtVerifierVerrou, majEtatNumero, majBarreEtatNumero, titreVue,
  avertirVersionSiDivergente, poidsLisible, fermerFormulairesEcriture,
  verrouillerSeulement, archiverEtVerrouiller, desarchiver, deverrouiller,
  oublierCopiesSignalees, avertirCopiesConflit, comparerConflit,
  SCHEME_CONFLIT, fournisseurContenuConflit, fournisseurDiffConflit,
  cheminDepuisUriConflit, fichierConflitVise, resoudreBlocConflit, supprimerCopieConflit,
  copieResolueEnregistree, rafraichirConflitsScm
} = cycleVie;
// Rappels vers ce fichier, que lib/cycle-vie.js ne peut pas requérir. Les fonctions visées
// sont des déclarations, donc utilisables même si elles sont définies plus bas.
cycleVie.configurer({
  trouverRacineRevue: () => trouverRacineRevue(),
  ecrireClesAusgabe: (racine, modifies) => ecrireClesAusgabe(racine, modifies),
  fermerTousLesApercus: () => fermerTousLesApercus(),
  fermerOngletsSous: (dossier) => fermerOngletsSous(dossier),
  supprimerAvecReprises: (chemin) => supprimerAvecReprises(chemin),
  fermerPanneauxDe: [
    (racine, slug) => fermerPanneauxMediasDe(racine, slug),
    (racine, slug) => fermerPanneauxDocumentationDe(racine, slug),
    (racine, slug) => tableHote.fermerPanneauxTableDe(racine, slug)
  ]
});
// ---- Aperçu commutable HTML / PDF -> lib/apercu.js -------------------------------
const apercuLib = require('./lib/apercu');
const {
  lireProfil, modeApercu, lignePos, plagePos, positionMot, jetonSource,
  editeurArticleCourant, revelerLigneSource, pousserDefilementVersApercu,
  pousserSurlignageVersApercu, injecterApercu, revelerPos,
  fermerApercuCourant, fermerApercuHtml, fermerTousLesApercus, echapperTexte,
  ouvrirApercuBiblio,
  ouvrirApercuHtml, rechargerApercuHtmlSiChange, basculerApercu, cheminApercuHtml,
  noterApercuPrioritaire
} = apercuLib;
apercuLib.configurer({
  fermerOnglets: (predicat) => fermerOnglets(predicat),
  ongletOuvert: (predicat) => ongletOuvert(predicat),
  ouvrirApercuPdf: (uri) => ouvrirApercuPdf(uri)
});
// ---- Import guidé -> lib/import-hote.js ------------------------------------------
const importHote = require('./lib/import-hote');
const {
  numerosOrdreEnAttente, resoudreNumeroOrdre, ecrireOrdreNouveauxArticles,
  compilerApresImport, lancerConversion, importerFichiersWord, importerWord,
  controleurDepotVue
} = importHote;
importHote.configurer({
  articlesSansDoi: (racine, slugs, opts) => articlesSansDoi(racine, slugs, opts),
  ecrireClesAusgabe: (racine, modifies) => ecrireClesAusgabe(racine, modifies),
  lancerTache: (nomTache) => lancerTache(nomTache),
  avertirEchecCompilation: (cle, args) => avertirEchecCompilation(cle, args),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins),
  rejouerCompilationsDifferees: () => rejouerCompilationsDifferees()
});
// ---- Formulaires de métadonnées (numéro, livre, fiches de tous les articles) -----
// -> lib/metadonnees-hote.js
const metadonneesHote = require('./lib/metadonnees-hote');
const {
  textesNumero, chargeNumero, messageNumero,
  cheminMeta, migrerFrontmatterVersMeta, doisCalculesArticles, ecrireDoisCalcules,
  nettoyerCarte, ecrireCartesArticles, messageCartes, relancerCompilationCartes,
  textesCarteArticle, textesAuteur, licencesTraduites, typesTraduits,
  ouvrirMetadonnees, ouvrirApercuMetadonnees, ouvrirMetadonneesArticle,
  imprimerFeuilleVerifTous,
  limitesMedias, BUDGET_VIGNETTES, vignetteAuteur, envoyerAuteursConnus, envoyerMotsClesConnus,
  rafraichirMotsClesConnusEnFond, rafraichirAuteursPubliesEnFond,
  deposerPhotoAuteur, ouvrirVersionsPhoto, choisirPhotoAuteur, signalerFichesPerimees,
  confirmerDoiManuel
} = metadonneesHote;
metadonneesHote.configurer({
  ecrireClesAusgabe: (racine, modifies) => ecrireClesAusgabe(racine, modifies),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  permuterStatutsTraduction: (racine, slug, avant, apres) =>
    permuterStatutsTraduction(racine, slug, avant, apres),
  relancerCompilation: (fournisseur, slug, opts) => relancerCompilation(fournisseur, slug, opts),
  focaliserUnite: (fournisseur, slug) => focaliserUnite(fournisseur, slug),
  // Bouton « Markdown » : le texte de l'article à droite de sa fiche. Les onglets
  // (tabGroups) se lisent et se ferment dans ce fichier seulement.
  ongletOuvert: (predicat) => ongletOuvert(predicat),
  fermerOnglets: (predicat) => fermerOnglets(predicat),
  slugDepuisChemin: (racine, chemin) => slugDepuisChemin(racine, chemin),
  articlesSansDoi: (racine, slugs) => articlesSansDoi(racine, slugs),
  // Vérificateur de traduction : son réglage, et le panneau de suggestion qu'ouvre la
  // pastille du formulaire des fiches.
  lireVerifTraduction: () => lireVerifTraduction(),
  ouvrirSuggestionTraduction: (fournisseur, msg) => ouvrirSuggestionTraduction(fournisseur, msg)
});
// ---- Gestionnaire des médias d'un article -> lib/medias-hote.js -------------------
const mediasHote = require('./lib/medias-hote');
const { ouvrirGestionMedias, fermerPanneauxMediasDe } = mediasHote;
mediasHote.configurer({
  focaliserUnite: (fournisseur, slug) => focaliserUnite(fournisseur, slug),
  slugDepuisChemin: (racine, chemin) => slugDepuisChemin(racine, chemin),
  ouvrirArticle: (fournisseur, slug) => ouvrirArticle(fournisseur, slug),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  remplacerFichierImage: (fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options) =>
    remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options),
  supprimerAsset: (fournisseur, rafraichirTout, item, estTable) =>
    supprimerAsset(fournisseur, rafraichirTout, item, estTable),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins),
  // Un enregistrement a changé ce que la compilation de l'article lit (voir relanceDifferee).
  demanderCompilation: (fournisseur, slug) => relanceDifferee.demander(fournisseur, slug),
  viderCompilation: (slug) => relanceDifferee.vider(slug)
});
// ---- La Documentation d'un numéro -> lib/documentation-hote.js -------------------
const documentationHote = require('./lib/documentation-hote');
const { ouvrirDocumentation, ouvrirPageDocumentation, fermerPanneauxDocumentationDe } = documentationHote;
documentationHote.configurer({
  focaliserUnite: (fournisseur, slug) => focaliserUnite(fournisseur, slug),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  limitesMedias: () => limitesMedias(),
  // La revue du numéro ouvert et son nom affiché, pour les libellés du réservoir
  // (« numéro de l'autre revue »).
  revueCourante: (racine) => revueCourante(racine),
  nomRevueAffiche: (revue) => nomRevueAffiche(revue),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins),
  // Bouton « Aperçu du PDF » du formulaire : état, bascule, et rafraîchissement après
  // « Enregistrer ».
  apercuOuvert: (racine, slug) => apercuOuvertPourSlug(racine, slug),
  basculerApercu: (fournisseur, slug) => basculerApercuDocumentation(fournisseur, slug),
  rafraichirApercuSiOuvert: (fournisseur, slug) => rafraichirApercuDocumentationSiOuvert(fournisseur, slug)
});
// ---- Co-édition d'un même numéro -> lib/coedition.js, lib/copies-conflit.js -------
// Un bail de deux minutes posé sur un fichier pendant qu'un formulaire le modifie, et
// l'avertissement quand le synchroniseur a dédoublé un fichier du numéro. Sans rapport avec
// le verrou de lib/verrou.js, qui gèle un numéro entier.
const coedition = require('./lib/coedition');
const { copieConflitPour } = require('./lib/copies-conflit');
// ---- Garde d'interaction -> lib/interaction.js ------------------------------------
// Un QuickPick se ferme dès que le focus bouge. Pour qu'une fin de compilation (aperçu
// rechargé, notification des contrôles) ne le ferme pas, sousGarde enveloppe les choix et
// differer retient ce qui volerait le focus jusqu'à leur fermeture. Instance partagée avec
// panneaux.js et formatting.js.
const { sousGarde, differer, confirmerAbandon } = require('./lib/interaction');
const {
  genererExportOjs, configOjs, ecrireConfigOjs, doiCalcule, typeSansDoi,
  CHAMPS_REVUE, LOCALES_REVUE, RUBRIQUES_DEFAUT, FORME_DOI
} = require('./lib/export-ojs');
const {
  retirerImage, retirerTable, ordreImages, lireAttributsImage, ecrireAttributsImage,
  placeFigure, envelopperFigure, imagesSansAlternative,
  GRILLE_AUTO, GRILLE_MAX, lireGrilles, grilleDeImage, dispositionsPossibles,
  dispositionAutomatique, poserDansGrille, retirerDeGrille, ecrireDispositionGrille,
  normaliserGrilles
} = require('./lib/references');
// ---- Arborescence Kirby de la Documentation (fiches et rubriques) -> lib/kirby-contenu.js
// Les fiches à champs (livre, film, intervention…) et les rubriques de prose (références
// du dossier, tour d'horizon…), dans documentation.<lang>.txt et les dossiers de fiches.
const kirbyLib = require('./lib/kirby-contenu');
const { traiterPortraits } = require('./lib/portraits');
// ---- Journal de compilation -> lib/journal.js ------------------------------------
const {
  analyserJournal, phraseConstat, resumeJournal, slugsCompiles, citationsParArticle,
  constatsReimport, tonResultatReimport, sansResumePdfUaRedondant
} = require('./lib/journal');
// ---- JPEG CMJN -> RVB -> lib/cmyk.js ---------------------------------------------
const { convertirCmykEnRgb, estJpegCmyk } = require('./lib/cmyk');
// ---- Seuils de qualité des images -> lib/qualite-image.js ------------------------
const { qualiteImage } = require('./lib/qualite-image');
// ---- Médias d'un article : dimensions, noms sûrs, portraits, doublons -> lib/medias.js
const {
  EXTENSIONS_IMAGE_IMPORT, TAILLE_MAX_IMAGE_IMPORT,
  lireDimensionsImage, decrireImage, formatImage,
  nomImageAssaini, relatifImageValide,
  assainirCheminPhoto, decomposerPhoto, baseAuteurValide,
  dataUriImage, trouverOriginal, versionsPhoto,
  BUDGET_APERCUS_MEDIA, apercuMedia,
  empreinteFichier, tailleFichier, empreintesPartagees
} = require('./lib/medias');
// ---- Suivi de traduction -> lib/traduction.js ------------------------------------
const {
  CHAMPS_TRADUISIBLES, STATUTS, STATUT_DEFAUT,
  cleChamp, statutValide, analyserTraduction, serialiserTraduction,
  texteChamp, listeChamp, valeurChamp, alignerMotsCles, estATraduire, MARQUE_A_TRADUIRE,
  lignesTraduction, groupesTraduction, resumeTraduction
} = require('./lib/traduction');
// ---- Ordre, noms et tâches des articles -> lib/articles.js ---------------------
const {
  CLE_SANS_DOI, ordonnerArticles, deplacerArticle, prefixeOrdre, prefixeDossier, titreFiche,
  libelleArticle, analyserSansDoi, basculerSansDoi, trierParDoi, refusDeplacement,
  rangDoi, resumeImages,
  REVUES_TACHES, CLE_TACHES, MAX_TACHES, tachesRevue, tachesConfig, configAvecTaches, libelleTache,
  vueArticlesConfig, configAvecVueArticles,
  analyserTachesFaites, serialiserTachesFaites, resumeTaches, basculerTache,
  NOMS_COUVERTURE, EXTENSIONS_COUVERTURE, nomCouverture, MAX_COUVERTURE
} = require('./lib/articles');

const VUE_PDF = 'pdf.preview';
const EXT_PDF = 'tomoki1207.pdf';

// Chemin du premier dossier du workspace qui est une publication, ou null (la vue reste
// masquée). La reconnaissance est faite par lib/profil.js ; le profil trouvé est mémorisé
// dans la session.
//
// À distinguer de `session.profilRevue()` / `lireProfil` : la clé `profil:` d'ausgabe.yaml,
// qui choisit le mode d'aperçu d'un numéro.

function trouverRacineRevue() {
  const trouve = profilOuvrage_detecter();
  return trouve ? trouve.racine : null;
}

function profilOuvrage_detecter() {
  const trouve = profils.racineDepuis(vscode.workspace.workspaceFolders);
  session.poserProfilOuvrage(trouve ? trouve.profil : null);
  return trouve;
}

// Le profil du dossier ouvert, revue par défaut (lib/profil.js#courant).
function profilCourant() { return profils.courant(); }

// Dossier des unités de texte : « articles » pour un numéro, « chapitres » pour un livre.
function dossierUnites() { return profilCourant().unites.dossier; }

// Clé i18n du titre de la section : « ARTICLES » ou « CHAPITRES ».
function cleArbreUnites() { return 'arbre.' + profilCourant().unites.dossier; }

// Catégorie de la section des unités : clé de l'accordéon et valeur de contexte des menus
// de package.json, distincte par profil pour qu'un `when` les distingue.
function categorieUnites() { return profilCourant().unites.dossier; }

// ---- Utilitaires de chemin partagés par plusieurs zones ---------------------------
// Le reste du cycle de vie (verrou, archive, version) est dans lib/cycle-vie.js.

// Fichier de configuration du dossier ouvert : ausgabe.yaml (numéro) ou buch.yaml (livre).
// Toute lecture ou écriture de la configuration passe par ici : un ausgabe.yaml écrit dans
// un livre rendrait le dossier ambigu pour le cockpit et pour le Makefile.
function cheminConfig(racine) { return path.join(racine, profilCourant().config); }

// Clé de l'ordre des unités : `ordre-articles` (ausgabe.yaml) ou `ordre-chapitres` (buch.yaml).
function cleOrdre() { return profilCourant().unites.ordre; }

// Écrit les clés modifiées en gardant les lignes que le sérialiseur ne gère pas.
// Rend null si tout est écrit, sinon le message d'erreur.
function ecrireClesAusgabe(racine, modifies) {
  const chemin = cheminConfig(racine);
  try {
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
    ecrireAtomique(chemin, serialiserAusgabe(contenu, modifies));
    // Les formulaires ouverts apprennent que ce poste a modifié le fichier : sans cela,
    // leur prochain enregistrement signalerait un faux conflit de co-édition.
    rafraichirEmpreinteCoedition(racine, chemin);
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Réglage szh.convertirCmyk, coché par défaut : un JPEG CMJN s'affiche mal dans un
// navigateur comme dans WeasyPrint, et le défaut ne se voit qu'au PDF. Il se décoche là où
// la chaîne de portraits manque.
function convertirCmykActif() {
  try { return vscode.workspace.getConfiguration('szh').get('convertirCmyk', true) !== false; }
  catch (e) { return true; }
}

// Réglage szh.reduireWarningsImpression, décoché par défaut : coché, seule une image sous
// la résolution minimale est signalée (le palier « conseillé » se tait). Le CMJN reste
// signalé.
function reduireWarningsImpressionActif() {
  try { return vscode.workspace.getConfiguration('szh').get('reduireWarningsImpression', false) === true; }
  catch (e) { return false; }
}

// Réglage szh.desactiverLiensReferences, décoché par défaut : coché, la compilation ne lie
// plus un appel de citation à sa référence (les liens posés à la main restent). Lu ici pour
// l'affichage du panneau. La compilation, elle, lit la copie de ce réglage dans config.json
// (écrite par lib/reglages-hote.js) : szh-citations.lua tourne dans la WSL et ne voit pas
// les réglages de VSCodium.
function desactiverLiensReferencesActif() {
  try { return vscode.workspace.getConfiguration('szh').get('desactiverLiensReferences', false) === true; }
  catch (e) { return false; }
}

// Convertit en RVB les JPEG CMJN de la liste et rend le nombre de fichiers convertis. Un
// échec est signalé sans bloquer : le fichier reste utilisable tel quel.
async function convertirCmykSiBesoin(chemins) {
  if (!convertirCmykActif()) { return 0; }
  const candidats = (Array.isArray(chemins) ? chemins : []).filter((c) => c && estJpegCmyk(c));
  if (candidats.length === 0) { return 0; }
  let resultats;
  try {
    resultats = await convertirCmykEnRgb({ chemins: candidats });
  } catch (e) {
    vscode.window.showWarningMessage(T(e && e.wsl ? 'cmyk.err.wsl' : 'cmyk.err', [e.message]));
    return 0;
  }
  const convertis = resultats.filter((r) => r && r.converti);
  const rates = resultats.filter((r) => r && !r.ok);
  if (rates.length > 0) {
    vscode.window.showWarningMessage(T('cmyk.err', [String(rates[0].erreur || '?')]));
  }
  if (convertis.length > 0) {
    vscode.window.setStatusBarMessage(T('cmyk.statut', [convertis.length]), 5000);
  }
  return convertis.length;
}

// Réglage szh.replierAssetsAutres (défaut true) : au clic, les assets de l'article se
// déplient et ceux des autres se replient.
function replierAssetsAutres() {
  try { return vscode.workspace.getConfiguration('szh').get('replierAssetsAutres', true) !== false; }
  catch (e) { return true; }                       // configuration indisponible
}

// Type d'article affiché dans la section « Actualité » plutôt que « Articles » (même valeur
// que TYPES_HORS de lib/yaml.js et la rubrique DC/DK de lib/export-ojs.js). Un article de
// Documentation reste un `articles/<slug>/` ordinaire, avec son rang, sa fiche, ses
// traductions et son export : seule sa place dans l'arbre change.
const TYPE_ACTUALITE = 'documentation';

// Dossier de la page de Documentation quand le cockpit la crée. Il y en a une par numéro.
// C'est le type de la fiche qui la désigne : une page existante garde son nom de dossier.
const SLUG_DOCUMENTATION = 'documentation';

// Vue d'ensemble d'une section, rouverte par le clic sur l'en-tête et par le chevron, mais
// pas par un dépliage programmé : un clic d'article ne doit pas ramener la vue par-dessus
// le texte. « Actualité » et « chapitres » n'ont pas de vue d'ensemble : le clic ne fait
// que jouer l'accordéon.
function vueDeSection(categorie) { return profils.vueDeSection(profilCourant(), categorie); }

// Une couleur d'icône par en-tête de section : le TreeView n'offre ni gras ni taille de
// police. Bleu et vert reprennent les états de traduction (COULEURS_STATUT) ; « Word en
// attente » prend l'ambre de l'éditeur, « charts.orange » étant trop clair sur fond blanc.
const COULEURS_SECTION = {
  articles: 'charts.blue',
  chapitres: 'charts.blue',
  // Les sections d'un même arbre ont des couleurs distinctes (test/js/hote.test.js).
  actualite: 'charts.purple',
  traductions: 'charts.green',
  word: 'editorWarning.foreground'
};

// Icône d'avancement d'un article, sur le modèle des états de traduction : cercle vide =
// rien de fait (ou aucune tâche configurée), cercle bleu plein = en cours, coche verte =
// tout est fait.
function iconeAvancement(avance) {
  if (avance.total > 0 && avance.faites >= avance.total) {
    return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
  }
  if (avance.total > 0 && avance.faites > 0) {
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
  }
  return new vscode.ThemeIcon('circle-large-outline');
}

// ---- Co-édition : deux postes sur le même numéro -> lib/coedition-hote.js ----------
const coeditionHote = require('./lib/coedition-hote');
const {
  moiCoedition, oublierIdentiteCoedition, mainCoedition, ecrireSousMain, annoncerMain,
  noterLectureCoedition, rafraichirEmpreinteCoedition, refusCoedition, refusCoeditionNumero,
  libererCoedition
} = coeditionHote;

// ---- Ordre du numéro, nom des articles, tâches, couverture ----------------------
//
// L'ordre des articles est dans le fichier de configuration (clé `ordre-articles` ou
// `ordre-chapitres`, lib/articles.js) : déplacer un article ne renomme ni son dossier ni son
// .md, et out/ reste valable. L'ordre est relu à chaque appel et réparé d'après le disque,
// mais n'est écrit que par une action de l'utilisateur : l'écrire à chaque rafraîchissement
// de l'arbre relancerait le surveillant de fichiers en boucle.

// Valeur brute de la clé d'ordre du profil.
function valeurOrdreArticles(racine) {
  try {
    const cle = profilCourant().unites.ordre;
    return analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8'))[cle] || '';
  } catch (e) { return ''; }
}

// Articles cochés « pas de DOI », lus dans le fichier du numéro à côté de l'ordre. Ils
// sont rangés en fin de numéro, car le rang décide du DOI.
function slugsSansDoiVoulu(racine) {
  try {
    return analyserSansDoi(
      analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8'))[CLE_SANS_DOI] || '');
  } catch (e) { return []; }
}

// Ensemble des articles sans DOI : ceux cochés « pas de DOI » et ceux d'une rubrique qui
// n'en reçoit pas (Documentation), lue dans le type de chaque fiche. Le compteur du DOI ne
// compte que les autres, et reste ainsi contigu (00, 01, 02…).
//
// `opts.types`  slug -> type déjà lu, pour ne pas relire les fiches
// `opts.voulus` cases cochées à employer à la place de celles du fichier, pour calculer
//               l'effet d'une bascule avant de l'écrire
function articlesSansDoi(racine, slugs, opts) {
  // Un livre reçoit un DOI pour l'ouvrage, pas par chapitre : l'ensemble est vide, et
  // refusDeplacement() ne voit aucune frontière DOI dans un sommaire de livre.
  if (!profilCourant().capacites.doi) { return new Set(); }
  const o = opts || {};
  const jeu = new Set(o.voulus || slugsSansDoiVoulu(racine));
  if (!slugs || slugs.length === 0) { return jeu; }
  const cfg = configOjs();
  for (const slug of (slugs || [])) {
    if (jeu.has(slug)) { continue; }
    const type = (o.types && o.types[slug] !== undefined)
      ? o.types[slug]
      : lireMetaArticle(racine, slug).type;
    if (typeSansDoi(cfg, type)) { jeu.add(slug); }
  }
  return jeu;
}

// Jeton de revue du numéro, ou '' : il choisit le jeu de tâches et la langue de l'e-mail.
function revueNumero(racine) {
  try {
    return normaliserRevue(analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8')).revue);
  } catch (e) { return ''; }
}

// Nom d'un article dans l'interface : « 03 · Titre ». Le numéro vient du préfixe du
// dossier, le titre de la fiche ; sans titre, le slug le remplace.
function nomArticle(racine, slug, langue) {
  return libelleArticle(prefixeDossier(slug), slug, titreFiche(lireMetaArticle(racine, slug), langue));
}

// ---- Tâches d'un article : le sidecar <slug>.taches.yaml ------------------------
// Les intitulés des tâches sont un réglage de revue (config.json) ; l'état coché est rangé
// avec l'article et n'est ni publié ni exporté.
function cheminTaches(racine, slug) {
  return profils.chemins(profilCourant(), racine, slug).taches;
}

function lireTachesArticle(racine, slug) {
  try { return analyserTachesFaites(fs.readFileSync(cheminTaches(racine, slug), 'utf8')); }
  catch (e) { return analyserTachesFaites(''); }
}

// Le fichier est supprimé quand plus rien n'est coché.
function ecrireTachesArticle(racine, slug, valeurs) {
  const chemin = cheminTaches(racine, slug);
  const contenu = serialiserTachesFaites(valeurs);
  if (contenu === '') {
    try { if (fs.existsSync(chemin)) { fs.unlinkSync(chemin); } } catch (e) { /* déjà parti */ }
    return;
  }
  ecrireAtomique(chemin, contenu);
}

function tachesDuNumero(racine) {
  return tachesRevue(lireConfigPoste(), revueNumero(racine));
}

function avancementTaches(racine, slug, taches) {
  return resumeTaches(taches, lireTachesArticle(racine, slug).faites);
}

// ---- L'arbre du cockpit -----------------------------------------------------------

class FournisseurRevue {
  constructor() {
    this.racine = null;
    this.slugDeploye = null;       // article dont les assets sont dépliés
    // La catégorie dépend du profil, inconnu à la construction : definirRacine() la pose.
    this.sectionDeployee = null;   // l'accordéon : la seule section ouverte, ou null
    this._changement = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changement.event;
  }

  definirRacine(racine) {
    this.racine = racine;
    // La section des unités (« Articles » ou « Chapitres ») s'ouvre par défaut.
    if (this.sectionDeployee === null && racine) { this.sectionDeployee = categorieUnites(); }
  }
  rafraichir() { this._changement.fire(); }

  // true si l'état a changé : recliquer le même article ne reconstruit pas la vue.
  definirDeploye(slug) {
    const cible = replierAssetsAutres() ? (slug || null) : null;
    if (this.slugDeploye === cible) { return false; }
    this.slugDeploye = cible;
    return true;
  }

  // Accordéon : une seule section dépliée. Le clic sur le titre de la section active ne la
  // replie pas ; seul le chevron mène à l'état null (tout fermé). true si l'état a changé.
  definirSectionDeployee(categorie) {
    if (this.sectionDeployee === categorie) { return false; }
    this.sectionDeployee = categorie;
    return true;
  }

  getTreeItem(element) { return element; }

  getChildren(element) {
    if (!this.racine) { return []; }
    if (!element) {
      const n = this.compterWord();   // le badge de conteneur ne s'affiche pas ici
      const t = this.compterTraductions();
      // Les sections suivent le travail : les articles, l'actualité, les traductions, puis
      // les Word en attente. Les compteurs en description renseignent sans déplier.
      // Un livre n'a ni « Actualité » ni « Traductions » (sa traduction est un autre livre,
      // avec son ISBN) ; il a en tête l'entrée de son formulaire de métadonnées. Celles d'un
      // numéro s'ouvrent depuis la vue Articles.
      const sections = profilCourant().cle === 'livre' ? [this._itemMetaLivre()] : [];
      sections.push(this._section(categorieUnites(), T(cleArbreUnites()), 'book', undefined));
      const cap = profilCourant().capacites;
      if (cap.documentation) {
        // Le badge compte les blocs (fiches et rubriques) de la page de Documentation.
        const a = compterBlocsDocumentation(this.racine, this.slugDocumentation());
        sections.push(this._section('actualite', T('arbre.actualite'), 'megaphone',
          a > 0 ? '(' + a + ')' : undefined));
      }
      if (cap.traductions) {
        sections.push(this._section('traductions', T('arbre.traductions'), 'globe',
          t.total > 0 ? '(' + t.finalises + '/' + t.total + ')' : undefined));
      }
      sections.push(
        this._section('word', T('arbre.word'), 'inbox', n > 0 ? '(' + n + ')' : undefined));
      // Les Contrôles en dernier : ce n'est pas une étape du travail mais sa vérification.
      sections.push(this._itemControles());
      return sections;
    }
    if (element.categorie === categorieUnites()) { return this._itemsArticles(); }
    if (element.categorie === 'actualite') { return this._itemsActualite(); }
    if (element.categorie === 'word') { return this._itemsWord(); }
    if (element.categorie === 'traductions') { return this._itemsTraductions(); }
    if (element.contextValue === 'article') { return this._itemsTables(element.slug); }
    if (element.contextValue === 'traduction-article') { return this._itemsChampsTraduction(element.slug); }
    return [];
  }

  // Requis par reveal(). Seuls les articles sont révélés (voir ouvrirArticle) : leur parent
  // est l'en-tête de leur section, tout le reste a pour parent la racine.
  //
  // Un article de Documentation a le contextValue `article`, pour garder les menus et
  // boutons d'un article. Sa section se déduit donc de son type : sinon reveal() déplierait
  // « Articles » au lieu d'« Actualité ».
  getParent(element) {
    if (!element || element.categorie) { return null; }
    if (element.contextValue === 'article') {
      return this.sectionDeSlug(element.slug);
    }
    return null;
  }

  // En-tête de la section du slug : « Actualité » pour un article de Documentation, la
  // section des unités sinon (y compris pour un slug inconnu).
  sectionDeSlug(slug) {
    if (profilCourant().capacites.documentation && this.estActualite(slug)) {
      return this._section('actualite', T('arbre.actualite'), 'megaphone', undefined);
    }
    return this._section(categorieUnites(), T(cleArbreUnites()), 'book', undefined);
  }

  // Catégorie d'accordéon du slug : la même décision que sectionDeSlug(), sans l'élément.
  categorieDeSlug(slug) {
    return (profilCourant().capacites.documentation && this.estActualite(slug))
      ? 'actualite' : categorieUnites();
  }

  estActualite(slug) {
    if (!this.racine || !slug) { return false; }
    return lireMetaArticle(this.racine, slug).type === TYPE_ACTUALITE;
  }

  // Répartit les unités entre « Actualité » (Documentation) et la section des unités, dans
  // l'ordre du numéro. Chaque entrée vaut { slug }.
  _repartirUnites() {
    if (!this.racine) { return { unites: [], actualite: [] }; }
    const documentation = profilCourant().capacites.documentation;
    const unites = [], actualite = [];
    this.listerArticles().forEach((slug) => {
      const entree = { slug: slug };
      if (documentation && this.estActualite(slug)) { actualite.push(entree); }
      else { unites.push(entree); }
    });
    return { unites: unites, actualite: actualite };
  }

  // Élément d'un article à l'état courant, que reveal() retrouve par son id. null pour la
  // page de Documentation, qui n'est pas listée dans l'arbre.
  elementArticle(slug) {
    return this._itemsArticles().find((it) => it.slug === slug) || null;
  }

  // En-tête de section. Le clic déplie la section, replie les autres et ouvre sa vue
  // d'ensemble (szh.ouvrirSection) ; sur la section déjà dépliée, il n'ouvre que la vue.
  // Le menu contextuel mène à la même vue.
  _section(categorie, libelle, icone, description) {
    const ouverte = this.sectionDeployee === categorie;
    const it = new vscode.TreeItem(libelle, ouverte
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    it.categorie = categorie;
    // VS Code mémorise le pli d'un élément qu'il reconnaît et ignore alors le
    // collapsibleState renvoyé : l'id porte donc l'état voulu, pour que l'élément soit
    // recréé quand il change.
    it.id = 'section:' + categorie + ':' + (ouverte ? 'ouvert' : 'ferme');
    it.iconPath = new vscode.ThemeIcon(icone, COULEURS_SECTION[categorie]
      ? new vscode.ThemeColor(COULEURS_SECTION[categorie]) : undefined);
    it.contextValue = 'section-' + categorie;   // 'section-articles', 'section-word'…
    if (description) { it.description = description; }
    it.command = { command: 'szh.ouvrirSection', title: libelle, arguments: [categorie] };
    return it;
  }

  // Article = dossier articles/<slug>/ avec le .md homonyme, comme dans le Makefile.
  // L'ordre de l'arbre est celui du numéro ; le numéro affiché devant le titre vient du
  // préfixe du dossier (prefixeDossier(), lib/articles.js), qui peut en différer.
  _itemsArticles() {
    return this._itemsUnites(this._repartirUnites().unites,
      'arbre.vide.' + profilCourant().unites.dossier);
  }

  // La section « Actualité » liste des raccourcis vers les vues de la Documentation (les
  // fiches sont dans la bibliothèque partagée _NewsUndActu\Fiches\) : « Documentation du
  // numéro », « Propositions », « Traductions à faire », « Réservoir », « Archive », puis
  // « Publier sur le site web ». Une entrée ouvre le formulaire sur sa vue
  // (ouvrirPageDocumentation crée la page au besoin) ; un panneau déjà ouvert passe au
  // premier plan et bascule sur la vue.
  //
  // Les compteurs sont ceux des badges du formulaire (kirby-contenu.js), calculés sur
  // l'arbre local. L'Archive reprend le dernier compte connu
  // (documentation-hote.js#compteArchiveConnu) : l'arbre ne lit pas lui-même la
  // bibliothèque de production, sur OneDrive. Sans lecture préalable, pas de compteur.
  _itemsActualite() {
    if (!this.racine) { return []; }
    const racineArbreVal = kirbyLib.racineArbre(this.racine);
    const langue = langueRevue(this.racine);
    const nTraductions = kirbyLib.listerTraductionsATraire(racineArbreVal, langue).length;
    const nReservoir = kirbyLib.listerReservoir(racineArbreVal, langue, { avecIgnorees: false }).length
      + kirbyLib.listerOrphelines(racineArbreVal, langue).length;
    const nBlocs = compterBlocsDocumentation(this.racine, this.slugDocumentation());
    const nArchive = documentationHote.compteArchiveConnu();
    // Propositions des moissonneurs : un compte en cache (lib/propositions.js), recalculé
    // quand un lot, une décision ou la finesse change. Il compte ce que la personne voit :
    // selon l'aperçu de ce poste, sinon selon le réglage de la rédaction.
    let prop = { total: 0, aVerifier: 0, masquees: 0 };
    try { prop = documentationHote.compterPropositionsVues(racineArbreVal, langue); }
    catch (e) { console.warn('propositions : compte impossible — ' + ((e && e.message) || e)); }
    const nProp = prop.total === 1 ? '.un' : '.plus';
    const tipProp = (prop.total === 0 ? T('arbre.actualite.propositions.tipVide')
      : prop.aVerifier ? T('arbre.actualite.propositions.tip' + nProp, [prop.total, prop.aVerifier])
        : T('arbre.actualite.propositions.tipA' + nProp, [prop.total]))
      + (prop.masquees > 0 ? ' · ' + T('arbre.actualite.propositions.masquees' + (prop.masquees === 1 ? '.un' : '.plus'), [prop.masquees]) : '');
    const entrees = [
      { cle: 'numero', libelle: T('doc.onglet.numero'), icone: 'book', compte: nBlocs,
        tip: T('arbre.actualite.numero.tip') },
      // L'icône d'avertissement signale des cas à vérifier ; l'infobulle dit combien.
      { cle: 'propositions', libelle: T('doc.prop.vue'), icone: prop.aVerifier ? 'warning' : 'lightbulb',
        couleur: prop.aVerifier ? 'list.warningForeground' : undefined, compte: prop.total, tip: tipProp },
      { cle: 'traductions', libelle: T('doc.onglet.traductions'), icone: 'globe',
        compte: nTraductions, tip: T('arbre.actualite.traductions.tip') },
      { cle: 'reservoir', libelle: T('doc.onglet.reservoir'), icone: 'inbox',
        compte: nReservoir, tip: T('arbre.actualite.reservoir.tip') },
      { cle: 'archive', libelle: T('doc.onglet.archive'), icone: 'archive',
        compte: nArchive, tip: T('arbre.actualite.archive.tip') }
    ];
    const items = entrees.map((e) => {
      const it = new vscode.TreeItem(e.libelle, e.enfants
        ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
      it.id = 'actualite:' + e.cle;
      if (e.enfants) { it.categorie = e.enfants; }
      it.contextValue = 'actualite-entree';
      it.iconPath = e.couleur ? new vscode.ThemeIcon(e.icone, new vscode.ThemeColor(e.couleur)) : new vscode.ThemeIcon(e.icone);
      if (typeof e.compte === 'number' && e.compte > 0) { it.description = '(' + e.compte + ')'; }
      it.tooltip = e.tip;
      it.command = { command: 'szh.ouvrirActualite', title: e.libelle,
        arguments: e.cle === 'numero' ? ['numero', 'rubriques'] : [e.cle] };
      return it;
    });
    // « Publier sur le site web » ouvre la vue « web » de la Documentation, qui annonce que
    // la fonction n'est pas encore disponible.
    const publier = new vscode.TreeItem(T('arbre.actualite.publier'), vscode.TreeItemCollapsibleState.None);
    publier.id = 'actualite:publier';
    publier.contextValue = 'actualite-entree';
    publier.iconPath = new vscode.ThemeIcon('cloud-upload');
    publier.tooltip = T('arbre.actualite.publier.tip');
    publier.command = { command: 'szh.ouvrirActualite', title: T('arbre.actualite.publier'), arguments: ['web'] };
    items.push(publier);
    return items;
  }

  // Slug de la page de Documentation : la première unité de type `documentation` dans
  // l'ordre du sommaire, ou null.
  slugDocumentation() {
    const entrees = this._repartirUnites().actualite;
    return entrees.length > 0 ? entrees[0].slug : null;
  }

  // Entrée « Contrôles », sous « Word en attente ». Son icône signale un blocage (rouge),
  // un point à vérifier (ambre) ou rien (gris).
  _itemControles() {
    // Regroupés et comptés comme la vue et la barre d'état.
    const r = resumeJournal(
      controlesHote.constatsPourControles(this, controlesHote.constatsCourants(this.racine)),
      controlesHote.contexteConstats());
    const it = new vscode.TreeItem(T('arbre.controles'), vscode.TreeItemCollapsibleState.None);
    it.id = 'controles';
    it.contextValue = 'controles';
    if (r.bloquants > 0) {
      it.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
      it.description = '(' + r.bloquants + ')';
    } else if (r.avertissements > 0) {
      it.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      it.description = '(' + r.avertissements + ')';
    } else {
      it.iconPath = new vscode.ThemeIcon('checklist');
      it.description = T('arbre.controles.rien');
    }
    it.tooltip = T('arbre.controles.tooltip');
    it.command = { command: 'szh.vueControles', title: T('arbre.controles'), arguments: [] };
    return it;
  }

  // Entrée « Métadonnées du livre », qui ouvre le formulaire de buch.yaml. Sans `categorie`,
  // l'accordéon l'ignore.
  _itemMetaLivre() {
    const it = new vscode.TreeItem(T('arbre.metaLivre'), vscode.TreeItemCollapsibleState.None);
    it.id = 'meta-livre';
    it.contextValue = 'meta-livre';
    it.iconPath = new vscode.ThemeIcon('info');
    it.tooltip = T('arbre.metaLivre.tip');
    it.command = { command: 'szh.metadonnees', title: T('arbre.metaLivre'), arguments: [] };
    return it;
  }

  // `entrees` = [{ slug }] (_repartirUnites).
  _itemsUnites(entrees, cleVide) {
    const base = profils.chemins(profilCourant(), this.racine).unites;
    if (entrees.length === 0) { return [this._vide(T(cleVide))]; }
    const auto = replierAssetsAutres();
    const langue = langueRevue(this.racine);
    const taches = tachesDuNumero(this.racine);
    return entrees.map((entree) => {
      const slug = entree.slug;
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      // Sous l'article se déplient ses tableaux et sa bibliographie. Les images se gèrent
      // dans le formulaire « Médias de cet article ».
      const aDesAssets = this._tablesArticle(slug).length > 0
        || fs.existsSync(cheminBiblio(this.racine, slug, dossierUnites()));
      const deploye = auto && aDesAssets && slug === this.slugDeploye;
      const nom = nomArticle(this.racine, slug, langue);
      const it = new vscode.TreeItem(nom, !aDesAssets
        ? vscode.TreeItemCollapsibleState.None
        : (deploye ? vscode.TreeItemCollapsibleState.Expanded
                   : vscode.TreeItemCollapsibleState.Collapsed));
      // Quand le réglage pilote le dépliage, l'id porte l'état voulu (voir _section) ;
      // sinon il est stable et l'utilisateur décide. reveal() retrouve l'élément par son id.
      it.id = auto && aDesAssets
        ? 'article:' + slug + ':' + (deploye ? 'ouvert' : 'ferme')
        : 'article:' + slug;
      it.slug = slug;                   // lu par les actions de l'arbre
      it.resourceUri = md;              // décorations du thème (git, problèmes)
      // Description : le slug (nom du dossier), puis l'avancement des tâches.
      const avance = avancementTaches(this.racine, slug, taches);
      it.description = avance.total > 0
        ? slug + ' · ' + T('art.taches.avancement', [avance.faites, avance.total])
        : slug;
      it.iconPath = iconeAvancement(avance);
      it.tooltip = T('art.arbre.tooltip', [nom, slug, md.fsPath]);
      it.contextValue = 'article';      // pilote les boutons inline (menus view/item/context)
      // Le clic fait tout : .md en colonne 1, compilation si besoin, aperçu en colonne 2.
      it.command = {
        command: 'szh.ouvrirArticle', title: 'Ouvrir l’article',
        arguments: [slug]
      };
      return it;
    });
  }

  // articles/<slug>/media/, récursif ; chemins relatifs à media/, triés.
  _imagesArticle(slug) {
    const base = profils.chemins(profilCourant(), this.racine, slug).media;
    const resultats = [];
    const parcourir = (dossier, prefixe) => {
      let entrees;
      try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
      catch (e) { return; }
      for (const e of entrees) {
        if (e.isDirectory()) { parcourir(path.join(dossier, e.name), prefixe + e.name + '/'); }
        else if (e.isFile() && e.name.indexOf('~$') !== 0
                 && /\.(png|jpe?g|gif|svg)$/i.test(e.name)) { resultats.push(prefixe + e.name); }
      }
    };
    parcourir(base, '');
    return resultats.sort((a, b) => a.localeCompare(b, 'fr'));
  }

  _tablesArticle(slug) {
    const base = profils.chemins(profilCourant(), this.racine, slug).tables;
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Les entrées sous un article : ses tableaux, puis sa bibliographie.
  _itemsTables(slug) {
    const baseTables = profils.chemins(profilCourant(), this.racine, slug).tables;
    const tables = this._tablesArticle(slug).map((nom) => {
      const chemin = path.join(baseTables, nom);
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cheminAsset = chemin;
      it.iconPath = new vscode.ThemeIcon('table');
      it.contextValue = 'table';
      it.tooltip = T('arbre.table.tooltip', [chemin]);
      // L'éditeur plutôt que le HTML brut, qui reste accessible depuis l'Explorateur.
      it.command = {
        command: 'szh.editerTable', title: 'Ouvrir l’éditeur de tableau',
        arguments: [it]
      };
      return it;
    });
    const biblio = this._itemBiblio(slug);
    return biblio ? tables.concat([biblio]) : tables;
  }

  // La bibliographie, une référence par paragraphe, s'édite en texte (on la colle depuis
  // Zotero ou un autre article). Le .md s'ouvre en colonne 1 et son rendu en colonne 2, à
  // la place de l'aperçu de l'article ; Ctrl+Alt+P bascule ce rendu (basculerApercu,
  // lib/apercu.js).
  //
  // L'entrée existe dès que <slug>.biblio.md existe, même vide : l'import le crée toujours
  // (szh-biblio-detacher.lua). Sans fichier, pas d'entrée.
  _itemBiblio(slug) {
    const chemin = cheminBiblio(this.racine, slug, dossierUnites());
    if (!fs.existsSync(chemin)) { return null; }
    const it = new vscode.TreeItem(nomFichierBiblio(slug), vscode.TreeItemCollapsibleState.None);
    it.slug = slug;
    it.cheminAsset = chemin;
    it.iconPath = new vscode.ThemeIcon('book');
    it.contextValue = 'biblio';
    it.tooltip = T('arbre.biblio.tip');
    it.command = {
      command: 'szh.apercuBiblio', title: T('arbre.biblio'), arguments: [it]
    };
    return it;
  }

  // articles-word/*.docx et *.odt (chapitres-word/ pour un livre) à la racine du dossier,
  // donc sans _convertis/ — le nom du dépôt suit le profil actif (lib/profil.js).
  _itemsWord() {
    const noms = this._docxEnAttente(path.join(this.racine, profilCourant().depot));
    if (noms.length === 0) { return [this._vide(T('arbre.vide.word'))]; }
    return noms.map((nom) => {
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.contextValue = 'word';
      // « 4_Titre.docx » -> « titre », comme la cible d'import du Makefile
      // (lib/slug.js:slugifierArticle()).
      if (this._articleExiste(slugifierArticle(nom))) {
        // L'article existe déjà : l'import ignorera ce Word, qui est une version corrigée.
        // Un contextValue à part donne au menu contextuel l'action de réimport.
        it.contextValue = 'word-deja';
        it.word = nom;
        it.iconPath = new vscode.ThemeIcon('warning');
        it.description = T('arbre.deja.badge');
        it.tooltip = T('arbre.deja.tooltip');
      } else {
        it.iconPath = new vscode.ThemeIcon('file');
        it.tooltip = T('arbre.word.tooltip', [nom]);
      }
      return it;
    });
  }

  // Un article par ligne, dépliable sur ses champs bilingues ; « 💬 » signale une
  // question posée à l'équipe de traduction.
  _itemsTraductions() {
    const slugs = this.slugsTraduisibles();
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.traductions'))]; }
    const source = langueRevue(this.racine);
    return slugs.map((slug) => {
      const etat = etatTraduction(this.racine, slug, source);
      const rien = etat.lignes.length === 0;
      // Même nom que dans la section « Articles » ; la fiche vient d'etatTraduction.
      const it = new vscode.TreeItem(
        libelleArticle(prefixeDossier(slug), slug, titreFiche(etat.meta, source)), rien
        ? vscode.TreeItemCollapsibleState.None
        : vscode.TreeItemCollapsibleState.Collapsed);
      it.slug = slug;
      it.contextValue = 'traduction-article';
      it.iconPath = rien ? new vscode.ThemeIcon('dash') : iconeStatut(etat.resume.statut);
      const morceaux = rien
        ? [T('trad.rien.court')]
        : [T('trad.avancement', [etat.resume.remplis, etat.resume.total]),
           etat.resume.melange ? T('trad.statut.melange') : T('trad.statut.' + etat.resume.statut)];
      if (etat.suivi.commentaire !== '') { morceaux.push('💬'); }
      it.description = morceaux.join(' · ');
      it.tooltip = T('trad.article.tooltip', [slug]);
      it.command = { command: 'szh.traduction', title: 'Suivi de traduction', arguments: [{ slug: slug }] };
      return it;
    });
  }

  // Une ligne par champ bilingue : « Titre (DE) », remplissage, statut d'atelier.
  _itemsChampsTraduction(slug) {
    const etat = etatTraduction(this.racine, slug);
    return etat.groupes.map((groupe) => {
      const nom = libelleGroupe(groupe);
      const rempli = etatRemplissageGroupe(groupe);
      const statut = T('trad.statut.' + groupe.statut);
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.slug = slug;
      it.cleTraduction = groupe.cle;
      it.contextValue = 'traduction-champ';
      it.iconPath = iconeStatut(groupe.statut);
      it.description = rempli + ' · ' + statut;
      it.tooltip = T('trad.champ.tooltip', [nom, rempli, statut]);
      // Le focus va sur ce bloc du panneau.
      it.command = {
        command: 'szh.traduction', title: 'Suivi de traduction',
        arguments: [{ slug: slug, cle: groupe.cle }]
      };
      return it;
    });
  }

  _vide(texte) {
    const it = new vscode.TreeItem(texte, vscode.TreeItemCollapsibleState.None);
    it.iconPath = new vscode.ThemeIcon('info');
    it.contextValue = 'vide';
    return it;
  }

  compterWord() {
    if (!this.racine) { return 0; }
    return this._docxEnAttente(path.join(this.racine, profilCourant().depot)).length;
  }

  compterTraductions() {
    if (!this.racine) { return { total: 0, finalises: 0 }; }
    const source = langueRevue(this.racine);
    let total = 0, finalises = 0;
    for (const slug of this.slugsTraduisibles()) {
      const r = etatTraduction(this.racine, slug, source).resume;
      total += r.total;
      finalises += r.finalises;
    }
    return { total: total, finalises: finalises };
  }

  // Articles suivis champ par champ dans « Traductions ». La page de Documentation en est
  // exclue : chaque revue l'écrit dans sa langue, sans champ à synchroniser.
  slugsTraduisibles() {
    return this.listerArticles().filter((slug) => !this.estActualite(slug));
  }

  // Ordre du numéro, réparé d'après le disque sans être réécrit : un article ajouté à la main
  // va à la fin, un article effacé disparaît. Les articles sans DOI passent ensuite à la fin,
  // pour que le numéro du DOI suive l'ordre de lecture. C'est la seule source d'ordre du
  // cockpit : l'arbre, les vues et les boutons de déplacement voient le même sommaire.
  listerArticles() {
    if (!this.racine) { return []; }
    const slugs = this._sousDossiersAvecMd(profils.chemins(profilCourant(), this.racine).unites);
    return ordonnerArticles(valeurOrdreArticles(this.racine), slugs,
      articlesSansDoi(this.racine, slugs)).slugs;
  }

  // Le slug vient d'un nom de fichier Word et n'a pas de préfixe « NN- », alors que l'import
  // en pose un sur les dossiers (« 00-inclusion ») : la comparaison passe donc par tige().
  _articleExiste(slug) {
    const base = profils.chemins(profilCourant(), this.racine).unites;
    try { if (fs.statSync(path.join(base, slug, slug + '.md')).isFile()) { return true; } }
    catch (e) { /* pas sous ce nom exact : peut-être préfixé, voir ci-dessous */ }
    return this._sousDossiersAvecMd(base).some((dossier) => tige(dossier) === tige(slug));
  }

  _sousDossiersAvecMd(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((slug) => this._estUniteValide(base, slug))
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Une unité du numéro : un dossier avec son .md, ou la page de Documentation, qui n'a pas
  // de .md (arborescence Kirby, lib/kirby-contenu.js) et se reconnaît au type de sa fiche.
  _estUniteValide(base, slug) {
    try { if (fs.statSync(path.join(base, slug, slug + '.md')).isFile()) { return true; } }
    catch (e) { /* pas de .md : peut-être la Documentation */ }
    return lireMetaArticle(this.racine, slug).type === TYPE_ACTUALITE;
  }

  _docxEnAttente(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile()
        && (e.name.toLowerCase().endsWith('.docx') || e.name.toLowerCase().endsWith('.odt')))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }
}

// ---- Ouverture du PDF, calquée sur szh-apercu ------------------------------------

// pdf.preview est mono-instance : openWith révèle l'onglet existant au lieu de le
// dupliquer, et ramène donc devant un PDF déjà ouvert.
async function ouvrirApercuPdf(uri) {
  if (vscode.extensions.getExtension(EXT_PDF)) {
    // Colonne 2 fixe : « Beside » est relatif à la vue active et empile des colonnes.
    await vscode.commands.executeCommand('vscode.openWith', uri, VUE_PDF, {
      viewColumn: vscode.ViewColumn.Two,
      preserveFocus: true
    });
  } else {
    vscode.window.showInformationMessage(T('info.pdf.externe'));   // hôte de développement
    await vscode.env.openExternal(uri);
  }
}

// ---- Aperçu du livre entier -> le PDF composé ------------------------------------
// La pagination, les belles pages et le sommaire n'existent qu'une fois les chapitres
// assemblés : l'aperçu du livre est donc le PDF composé, celui de l'imprimeur. S'il n'a
// jamais été compilé, un message propose de le compiler.
async function ouvrirApercuLivre(fournisseur) {
  const racine = fournisseur && fournisseur.racine;
  if (!racine) { return; }
  const nom = path.basename(racine);
  const pdf = path.join(racine, 'out', nom + '.pdf');
  if (!fs.existsSync(pdf)) {
    const compiler = T('livre.apercu.compiler');
    const choix = await vscode.window.showInformationMessage(
      T('livre.apercu.absent'), compiler);
    if (choix === compiler) { await lancerBuild(racine); }
    return;
  }
  await ouvrirApercuPdf(vscode.Uri.file(pdf));
}

// Vrai si un onglet dont l'entrée satisfait le prédicat est ouvert. Les interrupteurs qui
// commandent un onglet s'en servent : un onglet se ferme à la croix sans prévenir, son état
// ne peut pas se tenir en mémoire.
function ongletOuvert(predicat) {
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      if (predicat(onglet.input)) { return true; }
    }
  }
  return false;
}

// Ferme les onglets dont l'entrée satisfait le prédicat. Les `TabInput` n'ont pas de type
// commun : les prédicats vérifient eux-mêmes les propriétés qu'ils lisent.
async function fermerOnglets(predicat) {
  const aFermer = [];
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      if (predicat(onglet.input)) { aFermer.push(onglet); }
    }
  }
  if (aFermer.length === 0) { return; }
  try { await vscode.window.tabGroups.close(aFermer); } catch (e) { /* déjà fermé */ }
}

// ---- Effacer un dossier que Windows tient encore ---------------------------------
// Les reprises et le retrait de l'attribut « lecture seule » sont dans lib/supprimer.js ;
// ici, seulement le message affiché pendant les reprises.
const { supprimerArbre } = require('./lib/supprimer');

function attendre(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// Rend null quand le chemin n'existe plus, sinon le message du dernier échec.
function supprimerAvecReprises(chemin) {
  return supprimerArbre(chemin, {
    // Sans message, dix secondes d'attente passeraient pour un blocage.
    surReprise: (nom) => vscode.window.setStatusBarMessage(
      T('statut.suppression.reprise', [nom]), 3000)
  });
}

// Dernière tentative, silencieuse, une minute plus tard : le verrou d'un synchroniseur
// tombe parfois bien après la suppression. Un article à moitié effacé n'a plus de .md, donc
// plus d'entrée dans l'arbre, et ses restes ne seraient plus atteignables depuis le cockpit.
const DELAI_DERNIERE_CHANCE = 60000;

function reprendrePlusTard(chemins, rafraichirTout) {
  const restants = chemins.filter((c) => c);
  if (restants.length === 0) { return; }
  const minuteur = setTimeout(() => {
    let efface = false;
    for (const chemin of restants) {
      if (!fs.existsSync(chemin)) { continue; }
      try { fs.rmSync(chemin, { recursive: true, force: true }); efface = true; }
      catch (e) { /* toujours tenu : on n'insiste plus */ }
    }
    if (efface && rafraichirTout) { rafraichirTout(); }
  }, DELAI_DERNIERE_CHANCE);
  // Un minuteur en attente retiendrait l'hôte d'extensions à la fermeture.
  if (minuteur.unref) { minuteur.unref(); }
}

// ---- Tâche de compilation : réutilise la tâche utilisateur, écoute sa fin --------

// Au-delà de ce délai, une tâche lancée par le cockpit est tenue pour perdue (interrompue,
// wsl.exe absent), pour que session.buildEnCours() ne reste pas bloqué jusqu'au
// rechargement de la fenêtre.
const DELAI_GARDE_TACHE = 30 * 60 * 1000;   // 30 minutes

// Attend la fin d'une exécution rendue par executeTask() et résout avec son code de sortie,
// ou avec null si seul onDidEndTask arrive ou si le délai de garde expire.
function attendreFinTache(execution) {
  return new Promise((resolve) => {
    let fini = false;
    const terminer = (valeur) => {
      if (fini) { return; }
      fini = true;
      aboProcess.dispose();
      aboTache.dispose();
      clearTimeout(minuteur);
      resolve(valeur);
    };
    const aboProcess = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution === execution) { terminer(e.exitCode); }
    });
    const aboTache = vscode.tasks.onDidEndTask((e) => {
      if (e.execution === execution) { terminer(null); }
    });
    const minuteur = setTimeout(() => { terminer(null); }, DELAI_GARDE_TACHE);
    // Le minuteur ne retient pas le processus : une tâche jamais terminée (hôte factice des
    // tests, wsl.exe absent) garderait sinon l'hôte en vie 30 minutes.
    if (minuteur.unref) { minuteur.unref(); }
  });
}

// Résout avec le code de sortie de la tâche, ou null si son label est introuvable.
async function lancerTache(nomTache) {
  const taches = await vscode.tasks.fetchTasks();
  const tache = taches.find((t) => t.name === nomTache);
  if (!tache) {
    vscode.window.showErrorMessage(T('err.tache'));
    return null;
  }
  servicesEnv.dansTache(tache);
  const execution = await vscode.tasks.executeTask(tache);
  return await attendreFinTache(execution);
}

// Répare les marqueurs .szh-biblio périmés avant une compilation lancée par le cockpit
// (lancerBuild, toutExporter, exporterXml), comme reimporter.py --reprise le fait dans la
// cible `import` du Makefile. Non bloquant : un article ambigu (zéro ou plusieurs
// *.biblio.md) reste tel quel, et la compilation le signalera.
function reparerBibliosAvantCompilation(racine) {
  if (!racine) { return; }
  try { renumerotation.reparerMarqueursOrphelins(racine, { dossier: dossierUnites() }); }
  catch (e) { /* non bloquant, voir ci-dessus */ }
}

function lancerBuild(racine) {
  reparerBibliosAvantCompilation(racine);
  return lancerTache(NOM_TACHE_BUILD);
}

// Compilation déclenchée par le clic ou l'enregistrement d'une unité. Une revue recompile
// le numéro (make all). Un livre ne compile que le chapitre (livre-chapitre-pdf
// CHAPITRE=<slug>) ; le volume se compile depuis la vue Chapitres ou l'aperçu du livre.
function lancerBuildUnite(racine, slug) {
  if (profilCourant().cle !== 'livre' || !slug) { return lancerBuild(racine); }
  reparerBibliosAvantCompilation(racine);
  return lancerTacheObjet(tacheChapitrePdf(racine, slug));
}

// Tâche construite comme celles de vscodium-user/tasks.json (bash -c, `set -o pipefail`,
// `tee .szh-journal.log` relu par relireJournal, `-j2 -O`). Elle n'est pas dans tasks.json
// parce qu'elle a besoin du slug. Le type `szh` la fait suivre comme les autres. Le slug,
// placé dans une ligne bash, est contrôlé par profils.apercuUnite.
function tacheChapitrePdf(racine, slug) {
  const a = profils.apercuUnite(profilCourant(), racine, slug);
  const make = ['make', '-j2', '-O', '-f', "'" + MAKEFILE_WSL + "'", a.cible]
    .concat(a.variables).join(' ');
  const ligne = moteur.ligneTache(
    ['bash', '-c', 'set -o pipefail; ' + make + ' 2>&1 | tee .szh-journal.log'], { cwd: racine });
  const execution = new vscode.ProcessExecution(ligne.commande, ligne.args, ligne.options);
  const tache = new vscode.Task(
    { type: 'szh', cible: 'chapitre', slug: slug }, vscode.TaskScope.Workspace,
    T('tache.chapitrePdf') + ' — ' + slug, 'SZH', execution, []);
  tache.presentationOptions = {
    reveal: vscode.TaskRevealKind.Never, showReuseMessage: false,
    clear: true, panel: vscode.TaskPanelKind.Shared
  };
  return tache;
}

// Mode d'aperçu d'une unité. Un chapitre s'aperçoit toujours en PDF : son aperçu HTML
// n'existe qu'après une compilation du livre entier, que le clic ne lance pas.
function modeApercuUnite() { return profilCourant().cle === 'livre' ? 'pdf' : modeApercu(); }

// Le PDF qu'ouvre le clic sur une unité : out/<slug>/<slug>.pdf pour un article,
// out/chapitres/<slug>.pdf pour un chapitre (lib/profil.js).
function pdfApercuUnite(racine, slug) {
  return profils.apercuUnite(profilCourant(), racine, slug).pdf;
}

// Signale l'échec d'une tâche, seulement si le journal ne porte aucun point bloquant :
// sinon la vue des contrôles le nomme déjà, avec ce qu'il faut faire.
function avertirEchecCompilation(cle, args) {
  if (resumeJournal(controlesHote.constatsPoses('chaine')).bloquants > 0) { return; }
  vscode.window.showErrorMessage(T(cle, args || []));
}

// Recompilation forcée de toute la revue. Les aperçus sous out/ sont fermés d'abord :
// le clean supprime out/, et un PDF affiché est verrouillé côté Windows.
async function toutExporter(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.export'));
  try {
    await fermerOngletsSous(path.join(racine, 'out'));
    session.poserApercuCourantUri(null);                       // tous les aperçus viennent d'être fermés
    // La maquette lit dois-calcules.yaml : on s'assure qu'il est à jour (écrit seulement
    // s'il change).
    ecrireDoisCalcules(fournisseur);
    reparerBibliosAvantCompilation(racine);
    const code = await lancerTache(NOM_TACHE_EXPORT);
    rafraichirTout();
    if (code === null) { return; }                 // tâche introuvable, déjà signalé
    if (code !== 0) {
      avertirEchecCompilation('err.export');
      return;
    }
    const n = fournisseur.listerArticles().length;
    vscode.window.showInformationMessage(n > 1 ? T('info.exportes', [n]) : T('info.exportes.un'));
  } finally {
    statut.dispose();
    session.poserBuildEnCours(false);
  }
}

// Recompilation, galleys DOCX, puis XML natif à la racine ; les manques bloquants
// arrivent en une erreur listée par lib/export-ojs.js.
async function exporterXml(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('exportOjs.statut'));
  try {
    await fermerOngletsSous(path.join(racine, 'out'));
    session.poserApercuCourantUri(null);                       // « Tout exporter » fait un clean
    reparerBibliosAvantCompilation(racine);
    let code = await lancerTache(NOM_TACHE_EXPORT);
    rafraichirTout();
    if (code === null) { return; }                 // tâche introuvable, déjà signalé
    if (code !== 0) {
      avertirEchecCompilation('err.export');
      return;
    }
    code = await lancerTache(NOM_TACHE_DOCX);
    if (code === null) { return; }
    if (code !== 0) {
      vscode.window.showErrorMessage(T('exportOjs.erreurDocx'));
      return;
    }
    // Pagination continue : pour un numéro déjà paginé, l'état est relu après la
    // compilation qui vient de tourner. S'il ne peut pas être lu (WSL endormie, make en
    // échec), l'export s'arrête. Une pagination périmée est refusée par lib/export-ojs.js
    // (e.szhBloquants, traité plus bas).
    let optionsPagination = {};
    if (paginationHote.estPagine(racine)) {
      let etatPagination;
      try {
        etatPagination = await paginationHote.lireEtat(racine, fournisseur.listerArticles());
      } catch (e) {
        vscode.window.showErrorMessage(T('pagination.echec'));
        return;
      }
      optionsPagination = { pagination: etatPagination };
    }
    const resultat = genererExportOjs(racine, optionsPagination);     // synchrone, quelques secondes
    const message = T('exportOjs.fini', [path.basename(resultat.chemin)]);
    if (resultat.avertissements.length > 0) {
      const bouton = T('exportOjs.voirAvertissements');
      const choix = await vscode.window.showInformationMessage(
        message + ' — ' + T('exportOjs.nAvertissements', [resultat.avertissements.length]), bouton
      );
      if (choix === bouton) {
        const doc = await vscode.workspace.openTextDocument({
          content: resultat.avertissements.join('\n'), language: 'plaintext'
        });
        await vscode.window.showTextDocument(doc, { preview: true });
      }
    } else {
      vscode.window.showInformationMessage(message);
    }
  } catch (e) {
    // Les points bloquants deviennent des cartes dans « À corriger » ; la notification dit
    // combien et où les lire. Une autre erreur (panne, disque) garde son message.
    const liste = (e && e.szhBloquants) || [];
    if (liste.length > 0) {
      controlesHote.poserConstatsExport(racine, liste, (e && e.szhBloquantsConfig) || 0);
      const bouton = T('ctl.notif.bouton');
      const choix = await vscode.window.showErrorMessage(
        T('exportOjs.refus', [liste.length]), bouton);
      if (choix === bouton) { await vscode.commands.executeCommand('szh.vueControles'); }
    } else {
      vscode.window.showErrorMessage(T('exportOjs.erreur', [String((e && e.message) || e)]));
    }
  } finally {
    statut.dispose();
    session.poserBuildEnCours(false);
  }
}

// ---- Pagination continue du numéro (lib/pagination-hote.js) ---------------------
// La pagination se fait au bouclage, par ce bouton. L'ordre passé à la chaîne est celui de
// fournisseur.listerArticles(), que la chaîne ne sait pas reconstituer seule (voir ORDRE
// dans l'en-tête de pipeline/Makefile).
async function rafraichirPagination(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Un numéro gelé garde ses folios.
  if (session.etatNumero().verrouillee || session.etatNumero().archivee) {
    vscode.window.showWarningMessage(T('pagination.gele'));
    return;
  }
  const ordre = fournisseur.listerArticles();
  let etat;
  try {
    etat = await paginationHote.lireEtat(racine, ordre);
  } catch (e) {
    vscode.window.showErrorMessage(T('pagination.echec'));
    return;
  }
  if (Array.isArray(etat.inconnus) && etat.inconnus.length > 0) {
    vscode.window.showWarningMessage(T('pagination.trous', [etat.inconnus.join(', ')]));
    return;
  }
  const nARecompiler = paginationHote.aRecompiler(etat, paginationHote.lireRegistre(racine));
  if (etat.enregistre && (!Array.isArray(etat.perimes) || etat.perimes.length === 0) && nARecompiler === 0) {
    vscode.window.showInformationMessage(T('pagination.dejaajour', [etat.total]));
    return;
  }
  const bouton = T('pagination.confirmer.bouton');
  // Modale : l'action recompile des PDF.
  const choix = await vscode.window.showWarningMessage(
    T('pagination.confirmer', [etat.articles.length, etat.total, nARecompiler]),
    { modal: true }, bouton);
  if (choix !== bouton) { return; }

  session.poserBuildEnCours(true);
  try {
    const resultat = await paginationHote.rafraichir(racine, ordre);
    // rafraichir-pagination est une compilation journalisée dans .szh-journal.log : son
    // journal se relit comme celui des tâches.
    await controlesHote.relireJournal(fournisseur, resultat.code === null ? 1 : resultat.code);
    rafraichirTout();
    // Remplace les constats de pagination relus par relireJournal() (normalement vides).
    controlesHote.poserConstats(racine, 'pagination', paginationHote.constatsPagination(resultat.etat));
    if (resultat.code === 0) {
      const total = resultat.etat ? resultat.etat.total : etat.total;
      vscode.window.showInformationMessage(T('pagination.fait', [total]));
    } else {
      vscode.window.showErrorMessage(T('pagination.echec'));
    }
  } finally {
    session.poserBuildEnCours(false);
  }
}

// ---- Sorties du livre (imprimeur, couverture, EPUB, HTML web) --------------------
// Quatre cibles make propres au livre (pipeline/profils/livre.mk), chacune avec sa tâche
// dans vscodium-user/tasks.json : ni import ni clean, seulement la sortie demandée.
// Refusée pendant une autre compilation.
async function exporterLivre(nomTache, cles) {
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T(cles.statut));
  try {
    const code = await lancerTache(nomTache);
    if (code === null) { return; }                 // tâche introuvable, déjà signalé
    if (code !== 0) { avertirEchecCompilation(cles.err); return; }
    vscode.window.setStatusBarMessage(T(cles.fait), 5000);
  } finally {
    statut.dispose();
    session.poserBuildEnCours(false);
  }
}

// « Compiler le livre » (vue Chapitres) : la tâche par défaut, make all, qui recompose le volume.
async function compilerLivre(fournisseur) {
  if (!fournisseur.racine) { return; }
  reparerBibliosAvantCompilation(fournisseur.racine);
  await exporterLivre(NOM_TACHE_BUILD, CLES_LIVRE_COMPILER);
}

const CLES_LIVRE_IMPRIMEUR = { statut: 'livre.imprimeur.statut', fait: 'livre.imprimeur.fait', err: 'livre.imprimeur.err' };
const CLES_LIVRE_COMPILER = { statut: 'livre.compiler.statut', fait: 'livre.compiler.fait', err: 'livre.compiler.err' };
const CLES_LIVRE_COUVERTURE = { statut: 'livre.couverture.statut', fait: 'livre.couverture.fait', err: 'livre.couverture.err' };
const CLES_LIVRE_EPUB = { statut: 'livre.epub.statut', fait: 'livre.epub.fait', err: 'livre.epub.err' };
const CLES_LIVRE_WEB = { statut: 'livre.web.statut', fait: 'livre.web.fait', err: 'livre.web.err' };

// ---- Export d'un seul article ----------------------------------------------------
// Recompile un seul article, depuis le panneau Export (lib/panneaux.js). C'est la seule
// façon de régénérer un document sur un numéro gelé. La tâche vise le PDF et l'aperçu
// HTML, sans clean ni import (l'import supprimerait le Word source).
// `-j2` : les deux cibles sont indépendantes et la WSL a deux cœurs
// (%UserProfile%\.wslconfig, `processors=2`). `-O` garde le journal lisible par
// lib/journal.js (voir tasks.json).
function tacheMakeArticle(racine, slug) {
  const cibles = ['out/' + slug + '/' + slug + '.pdf', 'out/' + slug + '/' + slug + '.apercu.html'];
  const ligne = moteur.ligneTache(
    ['make', '-j2', '-O', '-f', MAKEFILE_WSL].concat(cibles), { cwd: racine });
  const execution = new vscode.ProcessExecution(ligne.commande, ligne.args, ligne.options);
  const tache = new vscode.Task(
    { type: 'szh', cible: 'article', slug: slug }, vscode.TaskScope.Workspace,
    T('tache.exportArticle') + ' — ' + slug, 'SZH', execution, []);
  tache.presentationOptions = {
    reveal: vscode.TaskRevealKind.Never, showReuseMessage: false,
    clear: true, panel: vscode.TaskPanelKind.Shared
  };
  return tache;
}

async function lancerTacheObjet(tache) {
  const execution = await vscode.tasks.executeTask(tache);
  return await attendreFinTache(execution);
}

// Sans argument, l'article visé est celui du .md actif, à défaut celui en aperçu.
async function exporterArticle(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const slug = cibleTraduction(fournisseur, cible).slug;
  if (!slug || fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.exportArticle', [slug]));
  try {
    const code = await lancerTacheObjet(tacheMakeArticle(racine, slug));
    rafraichirTout();
    if (code !== 0) {
      avertirEchecCompilation('err.exportArticle', [slug]);
      return;
    }
    vscode.window.setStatusBarMessage(T('info.exportArticle', [slug]), 4000);
  } finally {
    statut.dispose();
    session.poserBuildEnCours(false);
  }
  await ouvrirArticle(fournisseur, slug);   // montre le document régénéré

  // Puis le dossier de sortie, PDF sélectionné, pour joindre ou déposer le document.
  // En dernier, car l'Explorateur prend le focus. Un export en échec est sorti plus haut :
  // aucun dossier ne s'ouvre, qui montrerait un PDF ancien.
  await revelerDansExplorateur(vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf')));
}

// ---- Article ouvert --------------------------------------------------------------

// Slug de l'article d'un chemin <racine>/articles/<slug>/<slug>.md, ou null.
function slugDepuisChemin(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const parties = path.relative(racine, chemin).split(path.sep);
  if (parties.length !== 3 || parties[0] !== dossierUnites()) { return null; }
  return parties[2] === parties[1] + '.md' ? parties[1] : null;
}

// ---- Le marqueur de l'article ouvert ---------------------------------------------
//
// La sélection de l'arbre pâlit dès que le focus revient à l'éditeur. Un point marque donc
// le .md de l'article auquel appartient le fichier actif (texte, bibliographie ou tableau) ;
// il colore la ligne (resourceUri) et l'onglet, et survit aux reconstructions de l'arbre.
// Il s'éteint quand le fichier actif sort des articles, et reste quand le focus passe à un
// aperçu ou à un panneau.
let vueArbre = null;                     // la TreeView, posée par activate()
let uriArticleOuvert = null;             // le .md marqué, ou null
const changementDecoration = new vscode.EventEmitter();

// Slug du dossier d'article qui contient `chemin`, à n'importe quelle profondeur
// (bibliographie, tableaux), contrairement à slugDepuisChemin.
function slugArticleContenant(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const parties = path.relative(racine, chemin).split(path.sep);
  if (parties.length < 3 || parties[0] !== dossierUnites()) { return null; }
  const slug = parties[1];
  try {
    return fs.statSync(profils.chemins(profilCourant(), racine, slug).md).isFile()
      ? slug : null;
  } catch (e) { return null; }
}

function majArticleOuvert(fournisseur, chemin) {
  const slug = slugArticleContenant(fournisseur.racine, chemin);
  const uri = slug
    ? vscode.Uri.file(profils.chemins(profilCourant(), fournisseur.racine, slug).md)
    : null;
  const avant = uriArticleOuvert;
  if ((avant && avant.fsPath) === (uri && uri.fsPath)) { return; }
  uriArticleOuvert = uri;
  // Les deux fichiers changent d'état : l'ancien perd son point, le nouveau le gagne.
  const touches = [avant, uri].filter(Boolean);
  if (touches.length > 0) { changementDecoration.fire(touches); }
  controlesHote.majBadgePdfUa(fournisseur);
}

// La reconstruction de l'arbre remplace l'élément sélectionné (son id encode l'état
// déplié), ce qui perd la sélection. On resélectionne l'élément recréé, sans prendre le
// focus et sans rouvrir une barre latérale masquée.
function reselectionnerArticle(fournisseur, slug) {
  if (!vueArbre || !vueArbre.visible) { return; }
  const element = fournisseur.elementArticle(slug);
  if (!element) { return; }
  Promise.resolve(vueArbre.reveal(element, { select: true, focus: false }))
    .catch(() => { /* arbre en pleine reconstruction : la sélection suivra au prochain clic */ });
}

// Met une unité en avant dans l'arbre quand s'ouvre son formulaire de métadonnées ou de
// médias : déplie ses assets et sa section, la resélectionne, sans ouvrir son .md ni son
// aperçu (ces formulaires pleine page ferment l'aperçu) et sans prendre le focus clavier.
// L'unité devient aussi l'article courant (voir designerUniteCourante), dont parlent
// Ctrl+Alt+P, la barre d'état et la compilation.
function focaliserUnite(fournisseur, slug) {
  let arbreChange = fournisseur.definirDeploye(slug);
  // La section de l'article : « Actualité » pour une page de Documentation.
  arbreChange = fournisseur.definirSectionDeployee(fournisseur.categorieDeSlug(slug)) || arbreChange;
  if (arbreChange) { fournisseur.rafraichir(); }
  reselectionnerArticle(fournisseur, slug);
  designerUniteCourante(fournisseur, slug);
}

// Ouvre la bibliographie d'un article : son texte en colonne 1, son rendu en colonne 2.
// L'article devient l'article courant.
async function ouvrirBibliographie(fournisseur, item) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // L'item de l'arbre, sinon (depuis la palette) le .md actif, puis l'article en aperçu.
  let slug = (item && item.slug) ? String(item.slug) : '';
  if (!slug) { slug = String(cibleTraduction(fournisseur, null).slug || ''); }
  if (!slug) { vscode.window.setStatusBarMessage(T('fiches.horsarticle'), 4000); return; }
  const chemin = cheminBiblio(racine, slug, dossierUnites());
  if (!fs.existsSync(chemin)) {
    vscode.window.setStatusBarMessage(T('biblio.aucune', [slug]), 4000);
    return;
  }
  designerUniteCourante(fournisseur, slug);
  await ouvrirApercuBiblio(vscode.Uri.file(chemin));
}

// Fait de l'unité l'article courant (point de l'arbre, badge PDF/UA, article visé par
// l'aperçu) sans rien ouvrir. Sert aux actions qui visent un article sans afficher son
// texte : les formulaires et l'aperçu de la bibliographie.
function designerUniteCourante(fournisseur, slug) {
  if (!fournisseur.racine || !slug) { return; }
  const md = profils.chemins(profilCourant(), fournisseur.racine, slug).md;
  // Sans .md (page de Documentation), rien n'est désigné.
  try { if (!fs.statSync(md).isFile()) { return; } } catch (e) { return; }
  majArticleOuvert(fournisseur, md);
  session.poserApercuCourantSlug(slug);
}

// Au démarrage, si l'éditeur actif est un article, fait ce que fait un clic dans l'arbre.
// Ce n'est pas le lanceur PowerShell qui s'en charge : un make lancé depuis Windows
// concurrencerait `triggerTaskOnSave`, et le Makefile n'a pas de verrou.
async function ouvrirArticleActifAuDemarrage(fournisseur) {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const slug = slugDepuisChemin(fournisseur.racine, editeur.document.uri.fsPath);
  if (!slug) { return; }                            // pas un article : ne rien forcer
  try { await ouvrirArticle(fournisseur, slug); }
  catch (e) { /* au démarrage, ne pas bloquer l'ouverture de la revue */ }
}

// Combien de temps le surlignage reste visible avant de s'effacer de lui-même.
const DUREE_SURLIGNAGE_FOCUS = 3000;

// Compare deux chemins sans la casse : Uri.fsPath baisse la lettre de lecteur, path.join
// la garde.
function memeFichier(a, b) {
  return path.normalize(String(a || '')).toLowerCase() === path.normalize(String(b || '')).toLowerCase();
}

// Ouvre `chemin` au premier plan en colonne 1 et rend son éditeur. showTextDocument est la
// seule API qui rend l'éditeur : après `vscode.open`, visibleTextEditors et
// activeTextEditor décrivent encore l'écran d'avant. Forcer la colonne 1 évite de
// sélectionner dans une copie du .md ouverte dans un autre groupe.
async function editeurDe(chemin) {
  try {
    const ed = await vscode.window.showTextDocument(vscode.Uri.file(chemin),
      { viewColumn: vscode.ViewColumn.One, preserveFocus: false });
    if (ed && ed.document && ed.document.uri && memeFichier(ed.document.uri.fsPath, chemin)
        && typeof ed.document.getText === 'function') { return ed; }
  } catch (e) { /* fichier disparu : on retombe sur ce qui est à l'écran */ }
  const vus = [vscode.window.activeTextEditor].concat(vscode.window.visibleTextEditors || []);
  return vus.find((e) => e && e.document && e.document.uri
    && memeFichier(e.document.uri.fsPath, chemin)) || null;
}

// Retrouve dans le .md le passage désigné par `focus`, le sélectionne, l'amène à l'écran et
// le surligne quelques secondes. La recherche (lib/reperage-focus.js) tolère la
// normalisation du texte par le filtre Lua, l'emphase aplatie et l'ellipse d'une
// troncature. À défaut, elle cherche dans <slug>.biblio.md (cas d'une référence jamais
// citée). Introuvable, rien ne se passe. Rend true si un passage a été sélectionné.
async function surlignerFocus(md, focus) {
  try {
    let editeur = await editeurDe(md);
    let plage = editeur ? trouverPlageFocus(editeur.document.getText(), focus) : null;
    if (!plage) {
      const biblio = md.replace(/\.md$/i, '.biblio.md');
      let texte = '';
      try { texte = fs.readFileSync(biblio, 'utf8'); } catch (e) { texte = ''; }
      if (texte !== '' && trouverPlageFocus(texte, focus)) {
        editeur = await editeurDe(biblio);
        plage = editeur ? trouverPlageFocus(editeur.document.getText(), focus) : null;
      }
    }
    if (!editeur || !plage) { return false; }
    const debut = editeur.document.positionAt(plage.debut);
    const fin = editeur.document.positionAt(plage.fin);
    const zone = new vscode.Range(debut, fin);
    editeur.selection = new vscode.Selection(debut, fin);
    editeur.revealRange(zone, vscode.TextEditorRevealType.InCenter);
    // Couleurs du thème : une teinte fixe serait illisible dans l'autre thème.
    const decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
      border: '1px solid', borderColor: new vscode.ThemeColor('editor.findMatchBorder'),
      overviewRulerColor: new vscode.ThemeColor('editor.findMatchBorder'),
      overviewRulerLane: vscode.OverviewRulerLane.Center
    });
    editeur.setDecorations(decoration, [zone]);
    setTimeout(() => { try { decoration.dispose(); } catch (e) { /* éditeur déjà fermé */ } },
      DUREE_SURLIGNAGE_FOCUS);
    return true;
  } catch (e) { return false; /* un focus qui échoue n'empêche pas d'avoir ouvert l'article */ }
}

// Ouvre un article : .md en colonne 1, compilation si l'aperçu du mode courant manque ou
// est plus vieux que ses sources, aperçu en colonne 2 à la place du précédent. Une
// compilation en échec n'affiche pas d'aperçu périmé.
// `opts.sansTexte`  laisse la colonne 1 au panneau qui l'occupe, et l'arbre tel quel
// `opts.sansApercu` s'arrête au .md, sans aperçu ni compilation
// `opts.focus`      passage à sélectionner dans le .md (voir surlignerFocus)
async function ouvrirArticle(fournisseur, slug, opts) {
  const racine = fournisseur.racine;
  if (!racine || typeof slug !== 'string' || slug === '') { return; }
  const md = profils.chemins(profilCourant(), racine, slug).md;
  // L'arbre suit le clic avant l'ouverture : assets dépliés, section ouverte, élément
  // resélectionné. Le point de l'article ouvert suit dans tous les cas.
  const suivreArbre = !(opts && opts.sansTexte);
  let arbreChange = fournisseur.definirDeploye(slug);
  if (suivreArbre) { arbreChange = fournisseur.definirSectionDeployee(categorieUnites()) || arbreChange; }
  if (arbreChange) { fournisseur.rafraichir(); }
  if (suivreArbre) { reselectionnerArticle(fournisseur, slug); }
  majArticleOuvert(fournisseur, md);
  // Un chapitre a son propre PDF (lib/profil.js, apercuUnite) ; le volume s'ouvre par
  // szh.apercuLivre.
  const pdf = vscode.Uri.file(pdfApercuUnite(racine, slug));
  const modeCourant = modeApercuUnite();
  // L'obsolescence se juge sur la sortie du mode courant.
  const apercuAttendu = modeCourant === 'html' ? cheminApercuHtml(racine, slug) : pdf.fsPath;

  if (!(opts && opts.sansTexte)) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md), { viewColumn: vscode.ViewColumn.One });
    // Passage visé par le bouton « Vers l'article » d'un constat (lib/constats.js,
    // focusChamp). Attendu avant d'ouvrir l'aperçu, qui sinon passerait devant l'éditeur.
    if (opts && opts.focus) { await surlignerFocus(md, opts.focus); }
  }

  // Depuis la vue d'ensemble Articles, on vient lire ou corriger le texte : ni aperçu ni
  // compilation (l'enregistrement du .md recompile par triggerTaskOnSave). Un aperçu déjà
  // ouvert se rafraîchit toujours par le watcher out/**.
  if (opts && opts.sansApercu) { return; }

  // Obsolète = plus ancien que le .md, un tableau extrait ou la fiche .meta.yaml, comme la
  // règle HTML du Makefile.
  let obsolete = true;
  try {
    let mSource = fs.statSync(md).mtimeMs;
    const dossierTables = profils.chemins(profilCourant(), racine, slug).tables;
    let tables = [];
    try { tables = fs.readdirSync(dossierTables); } catch (e) { /* pas de tableaux */ }
    for (const t of tables) {
      if (!/\.html?$/i.test(t)) { continue; }
      try { mSource = Math.max(mSource, fs.statSync(path.join(dossierTables, t)).mtimeMs); }
      catch (e) { /* fichier disparu entre-temps */ }
    }
    try { mSource = Math.max(mSource, fs.statSync(cheminMeta(racine, slug)).mtimeMs); }
    catch (e) { /* pas de fiche */ }
    // Pour un chapitre, compilé seul, la bibliographie compte aussi.
    if (profilCourant().cle === 'livre') {
      try { mSource = Math.max(mSource, fs.statSync(profils.chemins(profilCourant(), racine, slug).biblio).mtimeMs); }
      catch (e) { /* pas de bibliographie */ }
    }
    obsolete = fs.statSync(apercuAttendu).mtimeMs < mSource;
  } catch (e) { obsolete = true; }                 // aperçu ou .md illisible : on compile

  // Sur un numéro gelé, cliquer un article ne compile pas : on montre ce qui existe.
  if (compilationAutoCoupee()) { obsolete = false; }

  if (obsolete && session.buildEnCours()) {
    // Une compilation tourne déjà : le rafraîchissement de out/** remplacera le message
    // d'attente par le rendu.
    vscode.window.setStatusBarMessage(T('statut.build.encours') + ' ' + T('apercu.encours'), 5000);
    if (modeCourant === 'html') {
      if (session.apercuCourantUri()) { await fermerApercuCourant(null); }
      ouvrirApercuHtml(fournisseur, slug, true);
    }
    return;
  }
  if (obsolete) {
    session.poserBuildEnCours(true);
    const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
    controlesHote.annoncerAnalyse(slug);                         // voir compilerPuisAfficher
    try {
      const code = await lancerBuildUnite(racine, slug);
      if (code === null) { return; }               // tâche introuvable, déjà signalé
      if (code !== 0) {
        avertirEchecCompilation('err.build');
        return;
      }
    } finally {
      controlesHote.annoncerAnalyse(null);
      statut.dispose();
      session.poserBuildEnCours(false);
    }
  }
  if (modeCourant === 'html') {
    if (session.apercuCourantUri()) { await fermerApercuCourant(null); }  // onglet PDF d'une bascule passée
    const pret = fs.existsSync(apercuAttendu);
    ouvrirApercuHtml(fournisseur, slug, !pret && !compilationAutoCoupee());
    if (!pret && !compilationAutoCoupee()) { relancerCompilation(fournisseur, slug); }
    return;
  }
  fermerApercuHtml();                              // webview HTML d'une bascule passée
  if (!fs.existsSync(pdf.fsPath)) {
    const gele = compilationAutoCoupee();   // le message renvoie alors à l'export
    vscode.window.showErrorMessage(T('err.pdf.introuvable', [slug]) + ' '
      + T(gele ? 'apercu.gele' : 'apercu.encours'));
    session.poserApercuCourantSlug(slug);                      // l'article visé en colonne 2
    if (!gele) { relancerCompilation(fournisseur, slug); }       // relance, puis affiche
    return;
  }
  await fermerApercuCourant(pdf);                  // l'aperçu de l'article précédent
  await ouvrirApercuPdf(pdf);                      // mono-instance : révèle si déjà là
  session.poserApercuCourantUri(pdf);
  session.poserApercuCourantSlug(slug);
}

// Lance compilerPuisAfficher sans l'attendre ; le catch évite un rejet non capturé.
// `opts.sansAffichage` : compile sans rouvrir d'aperçu (enregistrement des métadonnées,
// dont le formulaire a fermé l'aperçu).
function relancerCompilation(fournisseur, slug, opts) {
  compilerPuisAfficher(fournisseur, slug, opts).catch(() => { /* signalé côté build */ });
}

// Démarrages de la tâche de compilation (build ou export complet), comptés dans
// onDidStartTask, y compris ceux de triggerTaskOnSave. La relance différée s'en sert pour
// savoir si une compilation partie entre-temps l'a déjà couverte (lib/relance-compilation.js).
let demarragesBuild = 0;

// Le formulaire « Médias de l'article » (lib/medias-hote.js) et l'éditeur de tableaux
// écrivent hors de l'éditeur de texte : ils relancent eux-mêmes la compilation, comme
// l'enregistrement des métadonnées (sansAffichage), après un anti-rebond de 2,5 s car
// l'éditeur de tableaux enregistre à chaque modification. Rien sur un numéro gelé.
const relanceDifferee = relanceCompilation.creerRelanceDifferee({
  relancer: (fournisseur, slug) => relancerCompilation(fournisseur, slug, { sansAffichage: true }),
  coupee: () => compilationAutoCoupee(),
  occupe: () => session.buildEnCours(),
  demarrages: () => demarragesBuild
});

// Compile un article en tâche de fond (une seule passe), puis rafraîchit son aperçu s'il
// est toujours affiché. Les compilations implicites d'un article passent par ici, sous la
// garde session.buildEnCours() : jamais deux à la fois.
async function compilerPuisAfficher(fournisseur, slug, opts) {
  if (session.buildEnCours() || session.importEnCours()) {
    // Refusé pendant un import : l'appel est gardé et rejoué à la fin de l'import
    // (rejouerCompilationsDifferees), même si l'import n'a rien ramené. Refusé pendant une
    // compilation : celle-ci est abandonnée, la suivante la couvrira.
    if (session.importEnCours()) { compilationsDifferees.set(slug, { fournisseur: fournisseur, opts: opts }); }
    return;
  }
  if (compilationAutoCoupee()) { return; }         // pas de compilation implicite

  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
  let code = null;
  // Annonce l'article compilé, pour que le voile de « À corriger » ne couvre que sa carte
  // (posé au démarrage de la tâche). Retirée dans tous les cas, pour ne pas s'appliquer au
  // Ctrl+S suivant si la tâche n'a pas démarré.
  controlesHote.annoncerAnalyse(slug);
  try {
    code = await lancerBuildUnite(fournisseur.racine, slug);
  } finally {
    controlesHote.annoncerAnalyse(null);
    statut.dispose();
    session.poserBuildEnCours(false);
  }
  if (code === null) { return; }                   // tâche introuvable, déjà signalé
  if (code !== 0) { avertirEchecCompilation('err.build'); return; }
  // Un formulaire pleine page occupe l'écran : l'aperçu reste fermé.
  if (opts && opts.sansAffichage) { return; }
  if (session.apercuCourantSlug() !== slug || !fournisseur.racine) { return; }   // article changé entre-temps
  if (modeApercuUnite() === 'html') {
    if (session.panneauApercuHtml()) { ouvrirApercuHtml(fournisseur, slug); }
    return;
  }
  const pdf = vscode.Uri.file(pdfApercuUnite(fournisseur.racine, slug));
  if (!fs.existsSync(pdf.fsPath)) { return; }
  await fermerApercuCourant(pdf);
  await ouvrirApercuPdf(pdf);
  session.poserApercuCourantUri(pdf);
}

// ---- Aperçu de la page de Documentation (bouton « Aperçu du PDF » de son formulaire) ---
//
// Même mécanisme que pour un article, mais l'ouverture recompile toujours : la page dépend
// de toute la bibliothèque de fiches partagée, et son obsolescence ne se juge pas sur un
// .md. Le Makefile la compile comme un article, dans out/<slug>/.
//
// L'état « ouvert pour ce slug » se lit sur l'état réel (panneau HTML de la session, ou
// onglets ouverts en PDF) : un aperçu se ferme aussi à la croix.
function apercuOuvertPourSlug(racine, slug) {
  if (!racine || !slug) { return false; }
  if (modeApercu() === 'html') {
    return !!session.panneauApercuHtml() && session.apercuCourantSlug() === slug;
  }
  const pdf = path.join(racine, 'out', slug, slug + '.pdf').toLowerCase();
  return ongletOuvert((e) => e && e.uri && String(e.uri.fsPath || '').toLowerCase() === pdf);
}

// Ouvre ou ferme l'aperçu. L'ouverture compile elle-même (lancerBuild) : compilerPuisAfficher
// ne fait que rafraîchir un aperçu déjà ouvert.
async function basculerApercuDocumentation(fournisseur, slug) {
  const racine = fournisseur.racine;
  if (!racine || !slug) { return; }
  if (apercuOuvertPourSlug(racine, slug)) {
    if (modeApercu() === 'html') {
      fermerApercuHtml();
      if (session.apercuCourantSlug() === slug) { session.poserApercuCourantSlug(null); }
    } else {
      await fermerApercuCourant(null);
    }
    return;
  }
  session.poserApercuCourantSlug(slug);
  if (session.buildEnCours() || session.importEnCours()) {
    // Une compilation tourne déjà : on montre ce qui existe en attendant.
    if (modeApercu() === 'html') {
      if (session.apercuCourantUri()) { await fermerApercuCourant(null); }
      ouvrirApercuHtml(fournisseur, slug, true);
    }
    return;
  }
  if (compilationAutoCoupee()) {
    // Numéro gelé : rien ne se compile, on montre ce qui existe.
    if (modeApercu() === 'html') { ouvrirApercuHtml(fournisseur, slug); }
    else {
      const pdf = vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf'));
      if (fs.existsSync(pdf.fsPath)) { await ouvrirApercuPdf(pdf); session.poserApercuCourantUri(pdf); }
    }
    return;
  }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
  let code = null;
  try {
    code = await lancerBuild(racine);
  } finally {
    statut.dispose();
    session.poserBuildEnCours(false);
  }
  if (code === null) { return; }                 // tâche introuvable, déjà signalé
  if (code !== 0) { avertirEchecCompilation('err.build'); return; }
  if (session.apercuCourantSlug() !== slug) { return; }   // fermé/changé pendant la compilation
  if (modeApercu() === 'html') {
    if (session.apercuCourantUri()) { await fermerApercuCourant(null); }
    ouvrirApercuHtml(fournisseur, slug);
    return;
  }
  const pdf = vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf'));
  if (!fs.existsSync(pdf.fsPath)) { return; }
  fermerApercuHtml();
  await fermerApercuCourant(pdf);
  await ouvrirApercuPdf(pdf);
  session.poserApercuCourantUri(pdf);
}

// Après « Enregistrer » sur la Documentation, recompile et rafraîchit son aperçu s'il est
// ouvert. Un aperçu fermé ou changé pendant la compilation ne se rouvre pas.
async function rafraichirApercuDocumentationSiOuvert(fournisseur, slug) {
  if (!apercuOuvertPourSlug(fournisseur.racine, slug)) { return; }
  await compilerPuisAfficher(fournisseur, slug);
}

// ---- Compilations refusées pendant un import ------------------------------------

// Slugs refusés par compilerPuisAfficher pendant un import ou un réimport. Une entrée par
// slug, la dernière demande l'emporte : une seule compilation rejouée par article.
const compilationsDifferees = new Map();

// Rejoue en tâche de fond les compilations refusées pendant l'import. À appeler dès que
// session.importEnCours() repasse à false, quel que soit le résultat : un import qui n'a
// ramené aucun article ne passe par aucun autre chemin de recompilation.
function rejouerCompilationsDifferees() {
  if (compilationsDifferees.size === 0) { return; }
  const aRejouer = Array.from(compilationsDifferees.entries());
  compilationsDifferees.clear();
  for (const [slug, args] of aRejouer) { relancerCompilation(args.fournisseur, slug, args.opts); }
}

// ---- Réimporter un article corrigé ----------------------------------------------
//
// L'auteur renvoie son Word corrigé. pipeline/reimporter.py fait tout le travail. Ici :
//   * la confirmation, car le réimport remplace le texte en place ;
//   * la lecture de sa réponse (une ligne JSON) et le ton du message ;
//   * la recompilation de l'article ;
//   * l'annulation, à un clic.
// Le script est lancé directement, sans tâche, pour pouvoir lire sa réponse.

// Délai large : le premier appel réveille la WSL, et la conversion d'un Word illustré
// prend du temps. Au-delà, le cockpit rend la main.
const REIMPORT_DELAI = 600000;

// Rend une Promise<{ json, code, erreur }>, sans jamais rejeter. `json` est la ligne de
// résultat, ou null (appel mal formé, WSL absente, délai dépassé).
function lancerReimporter(racine, args) {
  const argv = ['python3', REIMPORTER_WSL].concat(args || []);
  return moteur.reveiller().then(() => new Promise((resolve) => {
    let proc;
    try {
      proc = moteur.executer(argv, { cwd: racine, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      resolve({ json: null, code: null, erreur: String((e && e.message) || e) });
      return;
    }
    const morceaux = [];
    let fini = false;
    let minuteur = null;
    const finir = (r) => {
      if (fini) { return; }
      fini = true;
      if (minuteur) { clearTimeout(minuteur); }
      resolve(r);
    };
    minuteur = setTimeout(() => {
      try { proc.kill(); } catch (e) { /* déjà mort */ }
      finir({ json: null, code: null, erreur: 'delai' });
    }, REIMPORT_DELAI);
    if (proc.stdout) { proc.stdout.on('data', (d) => morceaux.push(d)); }
    proc.on('error', (e) => finir({ json: null, code: null, erreur: String((e && e.message) || e) }));
    proc.on('close', (code) => {
      // Le script écrit une seule ligne JSON sur stdout ; le reste va sur stderr, déjà
      // recopié dans le journal d'import.
      let json = null;
      for (const ligne of Buffer.concat(morceaux).toString('utf8').split(/\r?\n/)) {
        const nette = ligne.trim();
        if (nette.charAt(0) !== '{') { continue; }
        try {
          const objet = JSON.parse(nette);
          if (objet && typeof objet === 'object' && typeof objet.resultat === 'string') { json = objet; }
        } catch (e) { /* ligne non JSON : ignorée */ }
      }
      finir({ json: json, code: code, erreur: null });
    });
  }));
}

// L'article dont la fiche nomme ce document Word comme source. '' si aucun ou plusieurs :
// le choix revient alors au rédacteur, comme dans reimporter.py.
function articleDuWord(fournisseur, nom) {
  const cherche = String(nom || '').toLowerCase();
  const trouves = [];
  for (const slug of fournisseur.listerArticles()) {
    const source = String(lireMetaArticle(fournisseur.racine, slug).source || '').toLowerCase();
    if (source !== '' && source === cherche) { trouves.push(slug); }
  }
  return trouves.length === 1 ? trouves[0] : '';
}

// Le rédacteur désigne l'article, quand plusieurs fiches ou aucune ne nomment ce Word.
// L'article dont le dossier correspond au nom du fichier est proposé en tête ; la
// comparaison passe par tige(), le dossier pouvant porter un préfixe « NN- ».
async function choisirArticleReimport(fournisseur, nom) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const slugs = fournisseur.listerArticles();
  const probable = slugifierArticle(nom);
  const rang = (slug) => (tige(slug) === probable ? 0 : 1);
  const items = slugs.slice()
    .sort((a, b) => rang(a) - rang(b) || slugs.indexOf(a) - slugs.indexOf(b))
    .map((slug) => ({
      label: libelleArticle(prefixeDossier(slug), slug, titreFiche(lireMetaArticle(racine, slug), langue)),
      description: slug, slug: slug
    }));
  if (items.length === 0) { return ''; }
  const choix = await sousGarde(() => vscode.window.showQuickPick(items, {
    title: T('reimport.choisirArticle.titre', [nom]),
    placeHolder: T('reimport.choisirArticle')
  }));
  return choix ? String(choix.slug) : '';
}

// Le rédacteur désigne le Word, quand la fiche n'en nomme pas ou que celui qu'elle nomme
// n'est pas dans le dépôt. Si aucun Word n'attend, un message dit où le déposer.
async function choisirWordReimport(fournisseur, slug) {
  const noms = fournisseur._docxEnAttente(path.join(fournisseur.racine, profilCourant().depot));
  if (noms.length === 0) {
    vscode.window.showInformationMessage(T('reimport.deposerWord'));
    return '';
  }
  const choix = await sousGarde(() => vscode.window.showQuickPick(noms, {
    title: T('reimport.choisirWord.titre', [slug]),
    placeHolder: T('reimport.choisirWord')
  }));
  return choix ? String(choix) : '';
}

// Confirmation : elle nomme ce qui est remplacé, ce qui est conservé, et dit que
// l'annulation est possible.
async function confirmerReimport(slug) {
  const bouton = T('modale.reimport.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.reimport.question', [slug]),
    { modal: true, detail: T('modale.reimport.detail') }, bouton);
  return choix === bouton;
}

// Recompile l'article réimporté, par la même tâche que « Exporter cet article ».
async function compilerApresReimport(racine, slug) {
  if (session.buildEnCours()) { return; }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.exportArticle', [slug]));
  try { await lancerTacheObjet(tacheMakeArticle(racine, slug)); }
  catch (e) { /* la compilation ratée se dit par les contrôles, le réimport a eu lieu */ }
  finally { statut.dispose(); session.poserBuildEnCours(false); }
}

// Vrai quand la chaîne refuserait faute de Word : la fiche n'en nomme aucun
// (reimport-fiche-sans-source), ou celui qu'elle nomme n'attend pas dans le dépôt
// (reimport-sans-word). Même comparaison sans casse que reimporter.py.
function wordDeLaFicheAbsent(fournisseur, slug) {
  const source = String(lireMetaArticle(fournisseur.racine, slug).source || '').toLowerCase();
  if (source === '') { return true; }
  const noms = fournisseur._docxEnAttente(path.join(fournisseur.racine, profilCourant().depot));
  return !noms.some((n) => n.toLowerCase() === source);
}

// Réimport complet. `cible` vaut { slug } depuis un article, { word } depuis la section
// « Word en attente », { word, slug } quand l'appariement est déjà fait.
async function reimporterArticle(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Une conversion ou une compilation en cours lit articles/ et articles-word/.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  let word = (cible && typeof cible === 'object' && cible.word) ? String(cible.word) : '';
  let slug = word === '' ? (cibleTraduction(fournisseur, cible).slug || '')
    : (cible.slug ? String(cible.slug) : articleDuWord(fournisseur, word));
  if (word !== '' && slug === '') { slug = await choisirArticleReimport(fournisseur, word); }
  if (slug === '') { return; }                     // dialogue annulé : rien n'a été touché
  if (fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  // Le Word se choisit avant la confirmation, qui porte ainsi sur un Word connu.
  if (word === '' && wordDeLaFicheAbsent(fournisseur, slug)) {
    word = await choisirWordReimport(fournisseur, slug);
    if (word === '') { return; }
  }
  if (!await confirmerReimport(slug)) { return; }
  // --article et --word ensemble forcent l'appariement : c'est ainsi qu'on réimporte un
  // article dont le nom de fichier a changé depuis l'import.
  const args = ['--article', slug].concat(word === '' ? [] : ['--word', word]);
  await executerReimport(fournisseur, rafraichirTout, slug, args, false);
}

// Annule le dernier réimport. Sans état antérieur gardé, le script refuse et rien n'est
// touché.
async function annulerReimport(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const slug = cibleTraduction(fournisseur, cible).slug || '';
  if (slug === '' || fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  const bouton = T('modale.annulerReimport.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.annulerReimport.question', [slug]),
    { modal: true, detail: T('modale.annulerReimport.detail') }, bouton);
  if (choix !== bouton) { return; }
  await executerReimport(fournisseur, rafraichirTout, slug, ['--annuler', '--article', slug], true);
}

// Lance le script, pose ses constats (vue d'ensemble, barre d'état), recompile si le texte
// a changé, puis affiche un seul message.
async function executerReimport(fournisseur, rafraichirTout, slug, args, annulation) {
  const racine = fournisseur.racine;
  session.poserImportEnCours(true);
  const statut = vscode.window.setStatusBarMessage(
    T(annulation ? 'statut.reimport.annule' : 'statut.reimport', [slug]));
  let r;
  try { r = await lancerReimporter(racine, args); }
  // Comme après un import, les compilations refusées pendant le réimport sont rejouées.
  finally { statut.dispose(); session.poserImportEnCours(false); rejouerCompilationsDifferees(); }
  // Les formulaires de l'article montrent des tableaux et des images remplacés : ils se
  // ferment, pour qu'aucun n'écrive par-dessus.
  const reussi = !!(r.json && r.json.resultat === 'reussi');
  if (reussi) { fermerFormulairesEcriture(racine, slug); }
  // Le réimport ne passe pas par le journal : ses codes d'avertissement sont comptés ici.
  if (reussi && !annulation) { try { compteurs.enregistrerReimport(r.json); } catch (e) { /* idem */ } }
  const constats = r.json ? constatsReimport(r.json, slug) : [];
  controlesHote.poserConstats(racine, 'reimport', constats);
  rafraichirTout();
  vueEnsembleHote.rafraichirVueOuverte(fournisseur, 'controles');
  if (reussi) {
    await compilerApresReimport(racine, slug);
    rafraichirTout();
  }
  await annoncerReimport(fournisseur, rafraichirTout, r, slug, annulation, constats);
  if (reussi) { await ouvrirArticle(fournisseur, slug); }
}

// Un message par issue du réimport, avec le ton fixé par lib/journal.js (un refus n'y est
// pas une erreur).
async function annoncerReimport(fournisseur, rafraichirTout, r, slug, annulation, constats) {
  if (!r.json) {
    // Aucune réponse (appel mal formé, WSL absente, délai dépassé) : l'article est intact.
    vscode.window.showErrorMessage(T('reimport.injoignable'));
    return;
  }
  const langue = langueCockpit();
  // La phrase du premier constat, formulée comme dans la liste « À corriger ».
  const premiere = constats.length > 0 ? tableConstats.phrase(constats[0], langue) : '';
  const voir = T('ctl.notif.bouton');
  const revenir = T('modale.annulerReimport.bouton');
  const ouvrirControles = () => vscode.commands.executeCommand('szh.vueControles');
  const ton = tonResultatReimport(r.json);

  if (ton === 'ok') {
    if (annulation) {
      vscode.window.showInformationMessage(T('reimport.annule', [slug]));
      return;
    }
    // Réussi sans constat : une information, avec le bouton d'annulation.
    if (constats.length === 0) {
      const choix = await vscode.window.showInformationMessage(T('reimport.reussi', [slug]), revenir);
      if (choix === revenir) { await annulerReimport(fournisseur, rafraichirTout, { slug: slug }); }
      return;
    }
    // Réussi avec des constats : un avertissement. Le document est en place et publiable.
    const choix = await vscode.window.showWarningMessage(
      T('reimport.reussi.avert', [slug, constats.length]), voir, revenir);
    if (choix === voir) { await ouvrirControles(); }
    if (choix === revenir) { await annulerReimport(fournisseur, rafraichirTout, { slug: slug }); }
    return;
  }

  // « Rien à faire » : le Word n'apportait aucun changement.
  if (ton === 'info') {
    vscode.window.showInformationMessage(T('reimport.rien', [slug]));
    return;
  }

  // Refusé : rien n'a été touché. Le message du refus dit quoi faire ; s'il faut désigner
  // le fichier Word, un bouton le permet sur place.
  if (ton === 'attention') {
    const codes = Array.isArray(r.json.avertissements) ? r.json.avertissements : [];
    const manqueLeWord = !annulation && (codes.indexOf('reimport-sans-word') !== -1
      || codes.indexOf('reimport-fiche-sans-source') !== -1);
    const boutons = manqueLeWord ? [T('reimport.choisirWord'), voir] : [voir];
    const choix = await vscode.window.showWarningMessage(
      premiere || T('reimport.refuse', [slug]), ...boutons);
    if (choix === voir) { await ouvrirControles(); }
    if (choix === T('reimport.choisirWord')) {
      const nom = await choisirWordReimport(fournisseur, slug);
      if (nom === '') { return; }
      // Le remplacement a déjà été confirmé : pas de seconde confirmation.
      await executerReimport(fournisseur, rafraichirTout, slug,
        ['--article', slug, '--word', nom], false);
    }
    return;
  }

  // Échec : l'article est intact et son Word attend toujours.
  const choix = await vscode.window.showErrorMessage(
    premiere || T('reimport.echec', [slug]), voir);
  if (choix === voir) { await ouvrirControles(); }
}

// ---- Assets : dimensions sans dépendance (lib/medias.js), et « Remplacer » -------

// Écrase une image de media/ en gardant son nom, pour que les liens du .md restent
// valides. Le gestionnaire des médias et la vérification de l'import passent tous deux par
// ici (même confirmation, mêmes contrôles de format et de poids). Le fichier arrive en
// base64 depuis une webview.
// `options.offrirACote` ajoute une issue au dialogue : poser la nouvelle image à côté de
// l'ancienne, dans la même figure, au lieu de l'écraser (utile après un dépôt sur la
// mauvaise carte). Seul le gestionnaire des médias la propose.
// -> { etat: 'ok' | 'annule' | 'erreur' | 'a-cote', message }
async function remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options) {
  const echec = (message) => ({ etat: 'erreur', message: message });
  if (!fournisseur.racine) { return echec(T('err.remplacement', ['?'])); }
  if (!new Set(fournisseur.listerArticles()).has(String(slug || ''))) { return { etat: 'annule' }; }
  if (!relatifImageValide(relatif)) { return { etat: 'annule' }; }
  if (session.buildEnCours() || session.importEnCours()) { return echec(T('statut.occupe')); }
  const cible = path.join(profils.chemins(profilCourant(), fournisseur.racine, slug).media, relatif);
  let existe = false;
  try { existe = fs.statSync(cible).isFile(); } catch (e) { existe = false; }
  if (!existe) { return echec(T('err.remplacement', [relatif])); }   // disparu entre-temps
  const nomCible = path.basename(cible);
  const nomSource = String(nomFichier || '');
  const ext = (nomSource.match(/\.([A-Za-z0-9]+)$/) || ['', ''])[1].toLowerCase();
  if (EXTENSIONS_IMAGE_IMPORT.indexOf(ext) === -1) { return echec(T('importv.err.format')); }
  const donnees = Buffer.from(String(donneesBase64 || ''), 'base64');
  if (donnees.length === 0) { return echec(T('importv.err.format')); }
  if (donnees.length > TAILLE_MAX_IMAGE_IMPORT) { return echec(T('importv.err.tropvolumineux')); }
  // Confirmation modale, renforcée si le format du fichier déposé diffère.
  const offrirACote = !!(options && options.offrirACote);
  let detail = T('modale.remplacer.detail.image', [nomCible]);
  if (formatImage(nomSource) !== formatImage(nomCible)) {
    detail = T('modale.remplacer.detail.format', [formatImage(nomSource), formatImage(nomCible)]) + detail;
  }
  if (offrirACote) { detail += T('modale.remplacer.detail.acote'); }
  // La boîte modale ajoute elle-même « Annuler ».
  const boutons = [T('modale.remplacer.bouton')];
  if (offrirACote) { boutons.push(T('modale.remplacer.bouton.acote')); }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.remplacer.question', [nomCible, nomSource]),
    { modal: true, detail: detail },
    ...boutons
  );
  if (offrirACote && reponse === T('modale.remplacer.bouton.acote')) { return { etat: 'a-cote' }; }
  if (reponse !== T('modale.remplacer.bouton')) { return { etat: 'annule' }; }
  try {
    const tmp = path.join(path.dirname(cible), '~$' + nomCible);
    try {
      fs.writeFileSync(tmp, donnees);
      fs.renameSync(tmp, cible);                   // même nom : liens du .md intacts
    } finally {
      try { if (fs.existsSync(tmp)) { fs.unlinkSync(tmp); } } catch (e) { /* déjà renommé */ }
    }
  } catch (e) {
    return echec(T('err.remplacement', [e.message]));
  }
  await convertirCmykSiBesoin([cible]);           // un JPEG d'imprimerie ne s'affiche pas
  vscode.window.setStatusBarMessage(T('statut.image.remplacee', [nomCible]), 5000);
  if (rafraichirTout) { rafraichirTout(); }        // met « L × H · poids » à jour
  return { etat: 'ok' };
}

// Supprime une image ou un tableau avec sa référence dans le .md, par un WorkspaceEdit
// (donc annulable). Rend vrai quand le fichier est parti : le gestionnaire des médias
// retire alors sa carte.
async function supprimerAsset(fournisseur, rafraichirTout, item, estTable) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.cheminAsset || !item.slug) { return false; }
  // Pas de suppression pendant que make lit le dossier.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return false;
  }
  const slug = item.slug;
  const cible = item.cheminAsset;
  const nom = path.basename(cible);
  // Relatif à media/ pour une image, nom simple pour un tableau.
  const relatif = estTable
    ? nom
    : path.relative(profils.chemins(profilCourant(), racine, slug).media, cible).replace(/\\/g, '/');

  const reponse = await vscode.window.showWarningMessage(
    T(estTable ? 'modale.supprimerTable.question' : 'modale.supprimerAsset.question', [nom]),
    { modal: true, detail: T(estTable ? 'modale.supprimerTable.detail' : 'modale.supprimerAsset.detail', [slug]) },
    T('modale.supprimer.bouton')
  );
  if (reponse !== T('modale.supprimer.bouton')) { return false; }   // annulé : rien n'est touché

  // Ordre : référence retirée du tampon, fichier effacé, puis .md enregistré. Enregistrer
  // lance la compilation, qui ne doit pas lire un média en cours de suppression.
  let retirees = 0;
  let doc = null;
  const md = profils.chemins(profilCourant(), racine, slug).md;
  try {
    doc = await vscode.workspace.openTextDocument(md);
    const resultat = estTable
      ? retirerTable(doc.getText(), relatif)
      : retirerImage(doc.getText(), relatif);
    if (resultat.n > 0) {
      // Si l'image était dans une grille, la disposition de la grille est recalculée.
      const propre = estTable ? resultat : normaliserGrilles(resultat.texte);
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), propre.texte);
      if (await vscode.workspace.applyEdit(edition)) { retirees = resultat.n; }
    }
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [path.basename(md), e.message]));
    return false;
  }

  // L'éditeur du tableau supprimé se ferme, sinon il le réécrirait.
  const ouvert = estTable ? tableHote.panneauTableOuvert(cible) : null;
  // Sa fermeture lancerait la recompilation en attente pendant l'effacement : elle est
  // abandonnée, l'enregistrement du .md plus bas en relance une.
  if (ouvert) { relanceDifferee.abandonner(slug); }
  if (ouvert) { try { ouvert.dispose(); } catch (e) { /* déjà fermé */ } }
  await fermerOngletDuFichier(cible);
  const echec = await supprimerAvecReprises(cible);
  if (echec) {
    vscode.window.showErrorMessage(T('err.suppression', [nom, echec]));
    rafraichirTout();
    return false;                                  // .md non enregistré : état cohérent
  }
  if (retirees > 0 && doc) {
    try { await doc.save(); }                      // déclenche la recompilation
    catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(md), e.message])); }
  }
  vscode.window.setStatusBarMessage(
    retirees > 0
      ? T(estTable ? 'statut.table.supprimee' : 'statut.asset.supprime', [nom, retirees])
      : T(estTable ? 'statut.table.supprimee.sansref' : 'statut.asset.supprime.sansref', [nom]),
    5000
  );
  rafraichirTout();
  return true;
}

// ---- Suppression d'un article ----------------------------------------------------

// Ferme les onglets des fichiers sous `dossier`, sans tenir compte de la casse (Windows).
async function fermerOngletsSous(dossier) {
  const prefixe = (dossier + path.sep).toLowerCase();
  await fermerOnglets((e) => e && e.uri && e.uri.fsPath &&
    e.uri.fsPath.toLowerCase().indexOf(prefixe) === 0);
}

async function fermerOngletDuFichier(chemin) {
  const vise = String(chemin).toLowerCase();
  await fermerOnglets((e) => e && e.uri && e.uri.fsPath && e.uri.fsPath.toLowerCase() === vise);
}

// Supprime un article après une confirmation modale qui le nomme.
async function supprimerArticle(fournisseur, rafraichirTout, item) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.slug) { return; }
  const slug = item.slug;
  // Sinon make recréerait out/<slug>, ou lirait un dossier à moitié effacé.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const reponse = await vscode.window.showWarningMessage(
    T('modale.supprimer.question', [slug]),
    { modal: true, detail: T('modale.supprimer.detail', [slug]) },
    T('modale.supprimer.bouton')
  );
  if (reponse !== T('modale.supprimer.bouton')) { return; }   // annulé : rien n'est touché
  // Une compilation a pu démarrer pendant que la modale était ouverte.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const dossierArticle = profils.chemins(profilCourant(), racine, slug).dossier;
  const dossierSortie = path.join(racine, 'out', slug);
  // Ferme d'abord tout ce qui tient un fichier de l'article ; un échec de fermeture se
  // verra à l'effacement.
  if (session.apercuCourantSlug() === slug) { fermerApercuHtml(); session.poserApercuCourantSlug(null); }
  fermerFormulairesEcriture(racine, slug);
  await fermerOngletsSous(dossierArticle);
  await fermerOngletsSous(dossierSortie);
  // Les deux dossiers s'effacent indépendamment : out/<slug>, le plus lourd, part même si
  // le dossier de l'article est encore tenu.
  const echecArticle = await supprimerAvecReprises(dossierArticle);
  const echecSortie = await supprimerAvecReprises(dossierSortie);
  rafraichirTout();
  const echec = echecArticle || echecSortie;
  if (echec) {
    reprendrePlusTard([echecArticle ? dossierArticle : null, echecSortie ? dossierSortie : null],
      rafraichirTout);
    vscode.window.showErrorMessage(T('err.suppression.article', [slug, echec]));
    return;
  }
  // Referme le trou dans la numérotation des dossiers (01, 03, 04), par le même renommage
  // en deux passes que « Changer l'ordre ». Un renommage qui échoue se reprend plus tard.
  const rangs = controlesHote.alignerDossiersSurOrdre(racine, fournisseur.listerArticles());
  rafraichirTout();
  if (rangs.erreur) {
    vscode.window.showWarningMessage(T('art.suppr.renumerote.echec', [rangs.erreur]));
    return;
  }
  vscode.window.setStatusBarMessage(
    rangs.renommes === 0 ? T('statut.supprime', [slug])
      : T('statut.supprime.renumerote', [slug, rangs.renommes]), 3000);
}

// ---- Suivi de traduction ---------------------------------------------------------
// Panneau szhTraduction en colonne 1, aperçu en colonne 2. Les textes traduits vont dans
// <slug>.meta.yaml (publié), l'état d'avancement dans <slug>.traduction.yaml (non publié) ;
// voir l'en-tête de lib/traduction.js.

const ICONES_STATUT = {
  'pas-pret': 'circle-large-outline',
  'pret-traduction': 'arrow-right',
  'pret-relecture': 'eye',
  'finalise': 'pass-filled'
};
// L'ambre d'avertissement de l'éditeur plutôt que « charts.orange », trop clair sur fond
// blanc.
const COULEURS_STATUT = {
  'pret-traduction': 'charts.blue',
  'pret-relecture': 'editorWarning.foreground',
  'finalise': 'charts.green'
};

function iconeStatut(statut) {
  const couleur = COULEURS_STATUT[statut];
  return new vscode.ThemeIcon(ICONES_STATUT[statut] || ICONES_STATUT[STATUT_DEFAUT],
    couleur ? new vscode.ThemeColor(couleur) : undefined);
}

function cheminTraduction(racine, slug) {
  return path.join(profils.chemins(profilCourant(), racine, slug).dossier, slug + '.traduction.yaml');
}

function lireMetaArticle(racine, slug) {
  try { return analyserMeta(fs.readFileSync(cheminMeta(racine, slug), 'utf8')); }
  catch (e) { return analyserMeta(''); }           // pas encore de fiche : tout vide
}

function lireSuiviTraduction(racine, slug) {
  try { return analyserTraduction(fs.readFileSync(cheminTraduction(racine, slug), 'utf8')); }
  catch (e) { return analyserTraduction(''); }
}

// `source` est passée par les boucles pour ne pas relire ausgabe.yaml à chaque article.
function etatTraduction(racine, slug, source) {
  const langue = source || langueRevue(racine);
  const meta = lireMetaArticle(racine, slug);
  const suivi = lireSuiviTraduction(racine, slug);
  const lignes = lignesTraduction(meta, suivi.statuts, langue);
  const groupes = groupesTraduction(lignes);
  return {
    meta: meta, suivi: suivi, lignes: lignes, groupes: groupes,
    source: langue, resume: resumeTraduction(groupes)
  };
}

// Au changement de langue d'un article, le formulaire permute les champs multilingues
// entre l'ancienne et la nouvelle langue. Les statuts de <slug>.traduction.yaml, indexés
// par champ et langue, sont permutés de même pour suivre leur texte. Un statut placé sur la
// langue source reste en sommeil et revient à la permutation inverse.
// Limite : plusieurs changements de langue avant un même enregistrement ne transmettent que
// la première et la dernière langue (l'enregistrement automatique rend le cas rare).
function permuterStatutsTraduction(racine, slug, avant, apres) {
  if (!avant || !apres || avant === apres) { return; }
  const suivi = lireSuiviTraduction(racine, slug);
  const statuts = suivi.statuts || {};
  let change = false;
  for (const champ of CHAMPS_TRADUISIBLES) {
    const cleAvant = cleChamp(champ, avant);
    const cleApres = cleChamp(champ, apres);
    const a = statuts[cleAvant];
    const b = statuts[cleApres];
    if (a === b) { continue; }
    change = true;
    if (b === undefined) { delete statuts[cleAvant]; } else { statuts[cleAvant] = b; }
    if (a === undefined) { delete statuts[cleApres]; } else { statuts[cleApres] = a; }
  }
  if (!change) { return; }                         // rien à échanger : fichier intact
  ecrireSuiviTraduction(racine, slug, suivi);
}

// Écrit <slug>.traduction.yaml, ou le supprime s'il est vide.
function ecrireSuiviTraduction(racine, slug, suivi) {
  const chemin = cheminTraduction(racine, slug);
  const contenu = serialiserTraduction(suivi);
  if (contenu === '') {
    try { if (fs.existsSync(chemin)) { fs.unlinkSync(chemin); } } catch (e) { /* déjà parti */ }
    return;
  }
  ecrireAtomique(chemin, contenu);
}

// Pose un statut sur tous les blocs de tous les articles du numéro et rend le nombre de
// blocs modifiés. `seulementPasPret` se limite aux blocs « pas prêt », pour ne pas faire
// reculer un champ en relecture ou finalisé. L'appelant fait confirmer.
function marquerToutStatutRevue(fournisseur, rafraichirTout, statut, seulementPasPret) {
  if (!fournisseur.racine) { return 0; }
  const racine = fournisseur.racine;
  const source = langueRevue(racine);
  const erreurs = [];
  let n = 0;
  for (const slug of fournisseur.listerArticles()) {
    const etat = etatTraduction(racine, slug, source);
    const statuts = Object.assign({}, etat.suivi.statuts);
    let change = false;
    for (const ligne of etat.lignes) {
      if (seulementPasPret && ligne.statut !== STATUT_DEFAUT) { continue; }
      if (ligne.statut === statut) { continue; }
      statuts[ligne.cle] = statut;
      change = true;
      n++;
    }
    if (!change) { continue; }
    try {
      ecrireSuiviTraduction(racine, slug, {
        statuts: statuts, commentaire: etat.suivi.commentaire, _inconnues: etat.suivi._inconnues
      });
    } catch (e) { erreurs.push(slug + ' (' + e.message + ')'); }
  }
  if (erreurs.length > 0) {
    vscode.window.showErrorMessage(T('err.ecriture', [erreurs.join(', '), erreurs.length]));
  }
  if (rafraichirTout) { rafraichirTout(); }
  traductionHote.rafraichirPanneauTraduction(fournisseur);   // le panneau ouvert suit le bouton
  return n;
}

// ---- Vues d'ensemble de section -> lib/vue-ensemble-hote.js ----------------------
const vueEnsembleHote = require('./lib/vue-ensemble-hote');
const { ouvrirVueEnsemble } = vueEnsembleHote;
vueEnsembleHote.configurer({
  etatTraduction: (racine, slug, source) => etatTraduction(racine, slug, source),
  marquerToutStatutRevue: (fournisseur, rafraichirTout, statut, seulementPasPret) =>
    marquerToutStatutRevue(fournisseur, rafraichirTout, statut, seulementPasPret),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine)
});

// ---- Contrôles de la compilation -> lib/controles-hote.js -----------------------
// Constats par source, vue « À corriger », compteur et badge PDF/UA de la barre d'état, voile
// « Analyse en cours… ». Les quatre modules suivants servent aussi ailleurs dans ce fichier.
const controlesHote = require('./lib/controles-hote');
const pdfuaHote = require('./lib/pdfua-hote');
const paginationHote = require('./lib/pagination-hote');
const tableConstats = require('./lib/constats');
const renumerotation = require('./lib/renumerotation-fs');
controlesHote.configurer({
  articleOuvert: () => uriArticleOuvert,
  slugArticleContenant: (racine, chemin) => slugArticleContenant(racine, chemin),
  relancerCompilation: (fournisseur, slug) => relancerCompilation(fournisseur, slug),
  // Par l'hôte et non par require : lib/vue-ensemble-hote.js requiert déjà ce module.
  rafraichirVueControles: (fournisseur) => vueEnsembleHote.rafraichirVueOuverte(fournisseur, 'controles'),
  pousserAnalyseControles: (message) => vueEnsembleHote.envoyerAVueOuverte('controles', message)
});

// Mode « Changer l'ordre » : { racine, slugs } pendant qu'on réordonne, null sinon.
// L'ordre voulu s'accumule ici sans rien écrire, et « Terminer » renomme les dossiers en
// une fois : un renommage par clic risquerait chaque fois un fichier ouvert ou une
// synchronisation OneDrive en cours. L'état est tenu par l'hôte pour survivre à un
// rafraîchissement de la vue.
let modeOrdre = null;

function ordreEnCours(racine) {
  return (modeOrdre && modeOrdre.racine === racine) ? modeOrdre.slugs : null;
}

// ---- Vue « Articles », « Envoyer à l'auteur » -> lib/vue-articles-hote.js ----------
const vueArticlesHote = require('./lib/vue-articles-hote');
const {
  ouvrirVueArticles, chargeChapitres,
  envoyerAuteur, voirPdfArticle, revelerDansExplorateur
} = vueArticlesHote;
vueArticlesHote.configurer({
  ordreEnCours: (racine) => ordreEnCours(racine),
  poserModeOrdre: (etat) => { modeOrdre = etat; },
  alignerDossiersSurOrdre: (racine, voulu) => controlesHote.alignerDossiersSurOrdre(racine, voulu),
  articlesSansDoi: (racine, slugs, opts) => articlesSansDoi(racine, slugs, opts),
  slugsSansDoiVoulu: (racine) => slugsSansDoiVoulu(racine),
  tachesDuNumero: (racine) => tachesDuNumero(racine),
  lireTachesArticle: (racine, slug) => lireTachesArticle(racine, slug),
  ecrireTachesArticle: (racine, slug, valeurs) => ecrireTachesArticle(racine, slug, valeurs),
  lireMetaArticle: (racine, slug) => lireMetaArticle(racine, slug),
  compilerLivre: (fournisseur) => compilerLivre(fournisseur),
  tacheMakeArticle: (racine, slug) => tacheMakeArticle(racine, slug),
  lancerTacheObjet: (tache) => lancerTacheObjet(tache),
  constatsCourants: (racine) => controlesHote.constatsCourants(racine),
  contexteConstats: () => controlesHote.contexteConstats(),
  ecrireClesAusgabe: (racine, modifies) => ecrireClesAusgabe(racine, modifies),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine)
});

// Adresses, brouillons et gabarits d'e-mail : lib/courriel.js (mail-templates/*.twig).
// Seulement exposés par _pur.
const {
  adressesAuteurs, brouillonAuteur, brouillonTraduction, uriMailto
} = require('./lib/courriel');

// ---- Traduction : envoi, panneau « Traductions », mode « Trad », suggestion -> lib/traduction-hote.js
const traductionHote = require('./lib/traduction-hote');
const {
  repondreModeTrad, ouvrirSuggestionTraduction, diffuserModeTrad, compterSuggestionsInterface,
  cibleTraduction, libelleGroupe, etatRemplissageGroupe
} = traductionHote;
traductionHote.configurer({
  ouvrirArticle: (fournisseur, slug, opts) => ouvrirArticle(fournisseur, slug, opts),
  slugDepuisChemin: (racine, chemin) => slugDepuisChemin(racine, chemin),
  revueNumero: (racine) => revueNumero(racine),
  // Suivi de traduction d'un article : sa fiche, son .traduction.yaml et l'état qui en découle.
  etatTraduction: (racine, slug, source) => etatTraduction(racine, slug, source),
  cheminTraduction: (racine, slug) => cheminTraduction(racine, slug),
  lireMetaArticle: (racine, slug) => lireMetaArticle(racine, slug),
  lireSuiviTraduction: (racine, slug) => lireSuiviTraduction(racine, slug),
  ecrireSuiviTraduction: (racine, slug, suivi) => ecrireSuiviTraduction(racine, slug, suivi)
});

// postMessage tolérant : le panneau peut être fermé pendant le traitement WSL.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// ---- Dialogue « Vérification de l'import » -> lib/import-verif-hote.js ------------
const importVerifHote = require('./lib/import-verif-hote');
importVerifHote.configurer({
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  remplacerFichierImage: (fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options) =>
    remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options)
});

// ---- Réglages « SZH » et réglages protégés -> lib/reglages-hote.js ---------------
const reglagesHote = require('./lib/reglages-hote');
reglagesHote.configurer({
  repondrePanneau, revelerDansExplorateur, diffuserModeTrad, compterSuggestionsInterface,
  replierAssetsAutres, convertirCmykActif, reduireWarningsImpressionActif,
  desactiverLiensReferencesActif
});

// ---- Éditeur de tableau -> lib/table-hote.js -------------------------------------
const tableHote = require('./lib/table-hote');
tableHote.configurer({
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  ouvrirArticle: (fournisseur, slug) => ouvrirArticle(fournisseur, slug),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins),
  repondreModeTrad: (panneau, msg) => repondreModeTrad(panneau, msg),
  demanderCompilation: (fournisseur, slug) => relanceDifferee.demander(fournisseur, slug),
  viderCompilation: (slug) => relanceDifferee.vider(slug)
});

// Couleur annuelle du fichier de config du profil courant (ausgabe.yaml ou buch.yaml) pour
// l'aperçu ; '' fait retomber sur le gris.
function lireCouleurAccent(racine) {
  try {
    const c = String(analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8')).couleur || '').toUpperCase();
    return HEX_COULEURS.indexOf(c) !== -1 ? c : '';
  } catch (e) { return ''; }
}

// Nombre de blocs de la page de Documentation (fiches rattachées dans la bibliothèque
// partagée et rubriques non vides), affiché dans le badge de « Actualité ». Lecture seule :
// sans id de numéro, les fiches comptent 0 (l'id est posé à l'ouverture du numéro).
function compterBlocsDocumentation(racine, slug) {
  if (!racine || !slug) { return 0; }
  const dossierArticle = profils.chemins(profilCourant(), racine, slug).dossier;
  const langue = langueRevue(racine);
  const ausgabeId = idNumero(racine);
  const fiches = ausgabeId
    ? kirbyLib.listerFichesNumero(kirbyLib.racineArbre(racine), langue, ausgabeId).length : 0;
  const page = kirbyLib.lirePage(dossierArticle, langue);
  const rubriques = Object.keys(page.rubriques || {}).filter((cle) => String(page.rubriques[cle] || '').trim() !== '').length;
  return fiches + rubriques;
}

// ---- Revue courante, pour les libellés du réservoir de la Documentation ----------
//
// « Traductions à faire » et « Réservoir » (lib/documentation-hote.js) doivent savoir
// quelle revue est ouverte pour nommer l'autre (kirby.autreRevue) et filtrer ses numéros.

// Revue du numéro ouvert, 'revue' par défaut.
function revueCourante(racine) {
  const jeton = revueNumero(racine);
  return kirbyLib.REVUES.indexOf(jeton) !== -1 ? jeton : 'revue';
}

function nomRevueAffiche(revue) {
  return kirbyLib.dossierRevue(revue) || kirbyLib.DOSSIERS_REVUE.revue;
}

// Pose l'id du numéro (ausgabe.yaml#id) s'il manque, et avertit si un autre dossier de
// l'arbre porte le même id (numéro copié à la main). Appelée à l'ouverture du numéro
// (majContexte) : la chaîne refuse de compiler une Documentation sans id, qui doit donc
// exister avant le premier Ctrl+S.
function poserIdNumeroEtAvertirDoublon(racine) {
  const id = assurerIdNumero(racine);
  if (!id) { return; }
  const racineArbreVal = kirbyLib.racineArbre(racine);
  const groupe = kirbyLib.idsEnDouble(racineArbreVal).find((g) => g.some((n) => n.id === id));
  if (!groupe) { return; }
  const racineAbs = path.resolve(racine);
  const autres = groupe.filter((n) => path.resolve(n.chemin) !== racineAbs).map((n) => n.nom);
  if (autres.length === 0) { return; }
  vscode.window.showWarningMessage(T('doc.id.double', [autres.join(', ')]));
}

// ---- Les réglages de la maison, posés sans écraser ceux du rédacteur -------------
//
// Le gabarit `vscodium-user/settings.json` est déclaré en défauts d'extension
// (contributes.configurationDefaults, copie exacte du gabarit : voir lib/reglages-flotte.js
// et test/js/reglages-flotte.test.js). Un défaut s'applique sous les réglages du rédacteur
// sans les remplacer.
//
// L'éditeur refuse en défaut d'extension les réglages de portée « application » (avec un
// simple avertissement). Ceux-là sont posés ici par l'API de configuration. La liste est
// mesurée à chaque fois, car la portée d'un réglage peut changer d'une version à l'autre.
//
// Ils ne sont posés qu'une fois par version du gabarit (empreinte mémorisée) : un réglage
// que le rédacteur a changé ensuite n'est pas réimposé à chaque démarrage.
const DEFAUTS_MAISON = (require('./package.json').contributes || {}).configurationDefaults || {};
const CLE_EMPREINTE_REGLAGES = 'szh.reglagesMaison.empreinte';

// Les surcharges par langue (« [markdown] ») sont écartées de la mesure : le point
// d'extension les accepte toujours, et inspect() ne les lit pas comme une clé ordinaire.
function clesMesurables(table) {
  const sortie = {};
  for (const cle of Object.keys(table)) { if (!/^\[.+\]$/.test(cle)) { sortie[cle] = table[cle]; } }
  return sortie;
}

async function poserReglagesMaison(context) {
  const empreinte = empreinteReglages(DEFAUTS_MAISON);
  if (context.globalState.get(CLE_EMPREINTE_REGLAGES) === empreinte) { return []; }
  const cfg = vscode.workspace.getConfiguration();
  const aPoser = clesRefusees(clesMesurables(DEFAUTS_MAISON), (cle) => {
    const vu = cfg.inspect(cle);
    return vu ? vu.defaultValue : undefined;
  });
  for (const cle of aPoser) {
    try { await cfg.update(cle, DEFAUTS_MAISON[cle], vscode.ConfigurationTarget.Global); }
    catch (e) {
      // Réglage refusé aussi par l'API : on le journalise et on passe au suivant.
      console.warn('réglage de la maison non posé : ' + cle + ' — ' + ((e && e.message) || e));
    }
  }
  // Empreinte mémorisée même après un échec partiel : réessayer à chaque démarrage ne
  // réparerait rien et réécrirait sans fin le fichier du rédacteur.
  await context.globalState.update(CLE_EMPREINTE_REGLAGES, empreinte);
  return aPoser;
}

function activate(context) {
  // Le contexte : controles-hote et documentation-hote écrivent dans son globalState.
  controlesHote.configurer({ etatPoste: () => context });
  documentationHote.configurer({ etatPoste: () => context });
  // Pas attendu : aucune commande n'en dépend, et l'attendre retarderait la barre latérale.
  poserReglagesMaison(context).catch((e) => {
    console.warn('réglages de la maison : ' + ((e && e.message) || e));
  });
  // Les réglages protégés déployés par la mise à jour sont recopiés là où la chaîne les
  // lit, s'ils ont changé.
  reglagesHote.relayerReglagesProteges(context).catch((e) => {
    console.warn('réglages protégés : ' + ((e && e.message) || e));
  });
  const fournisseur = new FournisseurRevue();

  // Rapports d'erreur et compteurs restés en file (dossier SharePoint injoignable lors du
  // dernier envoi) : envoyés maintenant ; un échec les laisse pour l'activation suivante.
  //
  // Pas d'écouteur global d'exceptions non rattrapées : l'hôte d'extensions est partagé
  // avec les autres extensions. Un tel écouteur changerait le comportement de Node pour
  // tout le processus et attraperait les exceptions des autres extensions.
  // signalerExceptionCockpit() n'est appelée que par l'enveloppe des commandes szh.*
  // (cmd/cmdEcriture), d'où ne sortent que nos exceptions.
  rapportErreur.viderFileAttente();
  compteurs.viderFileCompteurs();
  function signalerExceptionCockpit(err, etape) {
    try {
      rapportErreur.emettreRapport({
        gravite: 'erreur', source: 'cockpit', code: 'COCKPIT-EXCEPTION',
        etape: etape || null,
        message: String((err && err.message) || err || ''),
        pile: (err && err.stack) ? String(err.stack) : null,
        produit: rapportErreur.produitDepuisRacine(fournisseur.racine, profilCourant().cle),
        langueInterface: langueCockpit(), vscodiumVersion: vscode.version || null
      });
    } catch (e) { /* un gestionnaire d'exception ne doit pas lui-même en lever */ }
  }

  const vue = vscode.window.createTreeView(ID_VUE, {
    treeDataProvider: fournisseur,
    showCollapseAll: false,
    // rafraichirTout est défini plus bas, d'où l'indirection.
    dragAndDropController: controleurDepotVue(fournisseur, () => rafraichirTout())
  });
  context.subscriptions.push(vue);
  vueArbre = vue;                                  // reselectionnerArticle passe par elle

  // Le chevron : déplier un en-tête replie les autres et ouvre sa vue d'ensemble, comme le
  // clic sur le titre ; le replier ferme tout, sans reconstruction. Seuls les en-têtes
  // portent `categorie`. Un dépliage programmé (reveal, reconstruction) trouve
  // sectionDeployee déjà posée et n'ouvre donc pas la vue.
  context.subscriptions.push(
    vue.onDidExpandElement((e) => {
      if (!e || !e.element || !e.element.categorie) { return; }
      const categorie = e.element.categorie;
      if (fournisseur.definirSectionDeployee(categorie)) {
        fournisseur.rafraichir();
        const vueSection = vueDeSection(categorie);
        if (vueSection) { vscode.commands.executeCommand(vueSection); }
      }
    }),
    vue.onDidCollapseElement((e) => {
      if (!e || !e.element || !e.element.categorie) { return; }
      if (fournisseur.sectionDeployee === e.element.categorie) { fournisseur.sectionDeployee = null; }
    })
  );

  // Le point de l'article ouvert (majArticleOuvert), posé sur le .md : il colore sa ligne
  // de l'arbre (resourceUri) et son onglet.
  context.subscriptions.push(vscode.window.registerFileDecorationProvider({
    onDidChangeFileDecorations: changementDecoration.event,
    provideFileDecoration: (uri) =>
      (uriArticleOuvert && uri && uri.fsPath === uriArticleOuvert.fsPath)
        ? { badge: '●', color: new vscode.ThemeColor('list.highlightForeground'),
            tooltip: T('arbre.ouvert.tooltip') }
        : undefined
  }));
  context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editeur) => {
    // Pas d'éditeur actif = focus sur un aperçu ou un panneau : l'article reste ouvert.
    if (!editeur || !editeur.document) { return; }
    majArticleOuvert(fournisseur, editeur.document.uri.fsPath);
  }));

  let watchers = [];
  context.subscriptions.push({ dispose: () => { for (const w of watchers) { w.dispose(); } } });
  context.subscriptions.push({ dispose: moteur.arreterDormeur });   // pas de dormeur orphelin

  // Un lien vscodium:// vers ce dossier ouvre sa vue ici ; vers un autre, il part au lanceur Windows.
  uriHote.configurer({
    racine: () => fournisseur.racine, idDossier: idNumero,
    ouvrirTraduction: (article) => traductionHote.ouvrirTraduction(fournisseur, rafraichirTout,
      (article && fournisseur.listerArticles().indexOf(article) !== -1) ? { slug: article } : undefined),
    signalerRefus: () => vscode.window.showWarningMessage(T('uri.refuse'))
  });
  context.subscriptions.push(vscode.window.registerUriHandler(uriHote.gestionnaire));

  const barreApercu = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  barreApercu.command = 'szh.basculerApercu';
  context.subscriptions.push(barreApercu);

  // Le compteur des contrôles et le badge PDF/UA de l'article ouvert, à gauche de la
  // bascule d'aperçu, masqués quand ils n'ont rien à signaler.
  controlesHote.installerBarres(context, fournisseur);

  // État du numéro gelé, affiché seulement dans ce cas et avant l'aperçu : il explique
  // pourquoi l'éditeur ne répond plus aux frappes.
  const barreEtat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
  context.subscriptions.push(barreEtat);

  // Badge « Dossier de test », en couleur, quand le poste pointe sur l'arborescence de
  // test. Un clic ouvre l'onglet Paramètres de l'Accueil, où se règle le mode développeur.
  const barreModeTest = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 70);
  barreModeTest.command = 'szh.reglages';
  barreModeTest.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  context.subscriptions.push(barreModeTest);

  const majBarreApercu = () => {
    barreApercu.text = T(modeApercu() === 'html' ? 'apercu.barre.html' : 'apercu.barre.pdf');
    barreApercu.tooltip = T('apercu.barre.tooltip');
    if (fournisseur.racine) { barreApercu.show(); } else { barreApercu.hide(); }
    // Appelé à chaque changement d'article ou de mode : dit au Makefile quel aperçu
    // produire en premier.
    noterApercuPrioritaire(fournisseur.racine);
  };

  // lireModeDeveloppeur() vaut lireEmplacementRevues() === EMPLACEMENT_TEST.
  const majBarreModeTest = () => {
    if (fournisseur.racine && lireModeDeveloppeur()) {
      barreModeTest.text = '$(beaker) ' + T('etat.barre.test');
      barreModeTest.tooltip = T(lireConfigPoste() ? 'etat.barre.test.tooltip' : 'etat.barre.test.defaut')
        + ' ' + T('etat.barre.test.parametres');
      barreModeTest.show();
    } else {
      barreModeTest.hide();
    }
  };

  // Rafraîchit l'arbre, le titre de la vue, la barre d'état et l'aperçu HTML (rechargé si
  // sa sortie a été régénérée).
  // `opts.derive: false` : le rafraîchissement vient du surveillant de fichiers, souvent du
  // travail d'un autre poste livré par OneDrive. dois-calcules.yaml n'est alors pas
  // réécrit : deux postes qui le réécrivent l'un après l'autre créent des copies en conflit.
  const rafraichirTout = (opts) => {
    // Avant tout le reste : le titre de la vue et les boutons de l'arbre en dépendent.
    majEtatNumero(fournisseur, barreEtat);
    fournisseur.rafraichir();
    if (!opts || opts.derive !== false) { ecrireDoisCalcules(fournisseur); }
    vue.title = fournisseur.racine ? titreVue(fournisseur.racine) : T('arbre.titre.defaut');
    majBarreApercu();
    rechargerApercuHtmlSiChange(fournisseur);
    // Signale les copies en conflit déposées par le synchroniseur.
    avertirCopiesConflit(fournisseur.racine);
    // Un Word retiré du dépôt emporte les messages de son import refusé : compteur et vues
    // ouvertes suivent.
    controlesHote.majBarreControles();
    vueEnsembleHote.rafraichirVueOuverte(fournisseur, 'controles');
    vueEnsembleHote.rafraichirVueOuverte(fournisseur, 'word');
  };

  // Regroupe les rafales du système de fichiers : OneDrive en émet plusieurs.
  let minuteur = null;
  const rafraichirBientot = () => {
    if (minuteur) { clearTimeout(minuteur); }
    // derive: false, voir rafraichirTout.
    minuteur = setTimeout(() => { minuteur = null; rafraichirTout({ derive: false }); }, 300);
  };

  const reinstallerWatchers = (racine) => {
    for (const w of watchers) { w.dispose(); }
    watchers = [];
    if (!racine) { return; }
    // Unités de texte (`articles/**` ou `chapitres/**`), Word déposés, sorties et fichier de
    // configuration (titre de la vue), selon le profil posé par trouverRacineRevue().
    const p = profilCourant();
    for (const motif of [p.unites.dossier + '/**', p.depot + '/*', p.sortie + '/**', p.config]) {
      const w = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(racine, motif));
      w.onDidCreate(rafraichirBientot);
      w.onDidChange(rafraichirBientot);
      w.onDidDelete(rafraichirBientot);
      watchers.push(w);
    }
  };

  const majContexte = () => {
    const racine = trouverRacineRevue();
    fournisseur.definirRacine(racine);
    // Le point de l'article ouvert est recalculé sur la nouvelle racine.
    const editeurActif = vscode.window.activeTextEditor;
    majArticleOuvert(fournisseur,
      editeurActif && editeurActif.document ? editeurActif.document.uri.fsPath : null);
    session.poserDivergenceSignalee(false);                    // un avertissement par revue ouverte
    // Les constats appartiennent à leur numéro : changer de numéro les remplace.
    controlesHote.ouvrirNumero(racine, fournisseur);
    controlesHote.majBarreControles();
    majBarreModeTest();
    session.poserProfilRevue(lireProfil(racine));            // pilote le mode d'aperçu
    // L'id du numéro (ausgabe.yaml#id), requis pour compiler une Documentation. Un livre
    // n'en a pas besoin.
    if (racine && profilCourant().capacites.documentation) { poserIdNumeroEtAvertirDoublon(racine); }
    // Toutes les clés de profil et de capacité (szh.peut.*) sont posées, à vrai ou à faux :
    // sinon szh.estRevue resterait vrai après le passage à un livre.
    const cles = profils.contextes(session.profilOuvrage());
    for (const nom of Object.keys(cles)) {
      vscode.commands.executeCommand('setContext', nom, !!racine && cles[nom]);
    }
    reinstallerWatchers(racine);
    if (racine) { moteur.demarrerDormeur(); } else { moteur.arreterDormeur(); }
    // À chaque ouverture de numéro : oubli des copies en conflit signalées pour le
    // précédent, et purge des baux de co-édition laissés par une session interrompue.
    oublierCopiesSignalees();
    if (racine) { try { coedition.purger(racine); } catch (e) { /* jamais bloquant */ } }
    rafraichirTout();
  };

  // `cmd` pour ce qui lit, `cmdEcriture` pour ce qui modifie le numéro (refusé sur un
  // numéro verrouillé). Les deux passent par envelopperCommande() : une exception ou une
  // promesse rejetée est signalée en COCKPIT-EXCEPTION, puis relancée telle quelle pour que
  // VSCodium l'affiche comme d'habitude.
  const envelopperCommande = (fn) => function (...args) {
    let resultat;
    try { resultat = fn.apply(null, args); }
    catch (err) { signalerExceptionCockpit(err, 'commande'); throw err; }
    if (resultat && typeof resultat.then === 'function') {
      return resultat.catch((err) => { signalerExceptionCockpit(err, 'commande'); throw err; });
    }
    return resultat;
  };
  const cmd = (id, fn) => vscode.commands.registerCommand(id, envelopperCommande(fn));
  const cmdEcriture = (id, fn) => vscode.commands.registerCommand(id, envelopperCommande(function () {
    if (refuserSiVerrouille()) { return undefined; }
    return fn.apply(null, arguments);
  }));

  context.subscriptions.push(
    cmd('szh.cockpit.rafraichir', majContexte),
    // Le nom montré aux autres postes est mis en cache : un changement le vide.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('szh.nomUtilisateur')) { oublierIdentiteCoedition(); }
    }),
    // ---- Copies en conflit : comparer, trancher bloc par bloc, refermer ----
    // Le contenu de la copie servi sous « szh-conflit », et les deux commandes que
    // l'éditeur pose dans la barre du diff en ligne (menu scm/change/title de package.json).
    vscode.workspace.registerTextDocumentContentProvider(SCHEME_CONFLIT, fournisseurContenuConflit),
    cmd('szh.conflit.comparer', (uri) => comparerConflit(fichierConflitVise(uri))),
    // « Prendre cette version » écrit dans le fichier du numéro : garde du numéro gelé.
    cmdEcriture('szh.conflit.prendre',
      (uri, blocs, index) => resoudreBlocConflit(uri, blocs, index, true)),
    // « Garder la mienne » et la suppression de la copie n'écrivent que dans la copie, qui
    // ne fait pas partie du numéro : permises même sur un numéro gelé.
    cmd('szh.conflit.garder',
      (uri, blocs, index) => resoudreBlocConflit(uri, blocs, index, false)),
    cmd('szh.conflit.supprimerCopie', (uri) => {
      const chemin = fichierConflitVise(uri);
      return supprimerCopieConflit(chemin ? copieConflitPour(chemin) : null, true);
    }),
    // Le SourceControl est créé à la demande : il faut quand même le défaire à l'extinction.
    { dispose: () => cycleVie.libererScm() },
    // Depuis un bouton de constat, `item` vaut { slug, focus } : focus nomme le champ du
    // formulaire à mettre en avant.
    cmdEcriture('szh.metadonnees', (item) => ouvrirMetadonnees(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.apercuMetadonnees', () => ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null)),
    // Le même formulaire, filtré sur un article.
    cmdEcriture('szh.metadonneesArticle', (item) => ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.traduction', (item) => traductionHote.ouvrirTraduction(fournisseur, rafraichirTout, item)),
    // Le tutoriel : un walkthrough de l'éditeur, dont les étapes se cochent quand les
    // commandes correspondantes sont jouées.
    vscode.commands.registerCommand('szh.tutoriel', () => vscode.commands.executeCommand(
      'workbench.action.openWalkthrough', 'szh-csps.szh-cockpit#szhDemarrage', false)),
    // « Quoi de neuf » : s'ouvre seule après une mise à jour de medium, et à la demande
    // ici. Elle montre la note du medium installé.
    vscode.commands.registerCommand('szh.nouveautes',
      () => montrerNouveautes(nouveautes.mediumInstalle())),
    vscode.commands.registerCommand('szh.vueTraductions',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'traductions')),
    cmd('szh.vueArticles', () => ouvrirVueArticles(fournisseur, rafraichirTout)),
    // Même page que la vue Articles ; ouvrirVueArticles choisit la variante selon le profil.
    cmd('szh.vueChapitres', () => ouvrirVueArticles(fournisseur, rafraichirTout)),
    cmd('szh.envoyerAuteur', (item) => envoyerAuteur(fournisseur, item)),
    // Lecture seule, donc permis sur un numéro verrouillé. C'est aussi la destination du
    // constat pipeline/pdf-verrouille (lieu « pdf », lib/constats.js) : `item` vaut alors
    // { slug, focus }.
    cmd('szh.voirPdfArticle', (item) => voirPdfArticle(fournisseur, item)),
    // `item` vaut { slug, focus } depuis un bouton de constat : focus, un nom de fichier
    // Word, amène sa carte à l'écran et la met en évidence quelques secondes
    // (SZH.listeCartes.focaliser, media/_commun.js).
    vscode.commands.registerCommand('szh.vueWord',
      (item) => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'word', item)),
    vscode.commands.registerCommand('szh.vueControles',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'controles')),
    // Fabriquer un lien ne modifie rien : disponible même sur un numéro verrouillé.
    cmd('szh.envoyerTraduction', (item) => traductionHote.envoyerPourTraduction(fournisseur, item)),
    // `item` est accepté (contrat des boutons de constat) mais inutilisé : aucun constat ne
    // vise un champ des réglages.
    cmd('szh.reglages', (item) => accueilHote.ouvrirAccueil({ onglet: 'reglages' })),
    // basculerApercu (lib/apercu.js) agit sur l'article actif ou en aperçu ; `item` est
    // accepté mais inutilisé.
    cmd('szh.basculerApercu', (item) => basculerApercu(fournisseur, majBarreApercu)),
    // La bibliographie : texte à gauche, rendu à droite. Lecture seule, donc permis sur un
    // numéro verrouillé.
    cmd('szh.apercuBiblio', (item) => ouvrirBibliographie(fournisseur, item)),
    cmd('szh.apercuLivre', () => ouvrirApercuLivre(fournisseur)),
    cmdEcriture('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    cmdEcriture('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    // Les exports restent ouverts sur un numéro gelé, dont l'archivage a supprimé out/.
    cmd('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    cmd('szh.exporterXml', () => exporterXml(fournisseur, rafraichirTout)),
    cmd('szh.rafraichirPagination', () => rafraichirPagination(fournisseur, rafraichirTout)),
    cmd('szh.exporterArticle', (item) => exporterArticle(fournisseur, rafraichirTout, item)),
    // Les quatre sorties du livre, visibles dans la palette sous `when` szh.estLivre
    // (package.json).
    cmd('szh.livreImprimeur', () => exporterLivre(NOM_TACHE_LIVRE_IMPRIMEUR, CLES_LIVRE_IMPRIMEUR)),
    cmd('szh.livreCouverture', () => exporterLivre(NOM_TACHE_LIVRE_COUVERTURE, CLES_LIVRE_COUVERTURE)),
    cmd('szh.livreEpub', () => exporterLivre(NOM_TACHE_LIVRE_EPUB, CLES_LIVRE_EPUB)),
    cmd('szh.livreWeb', () => exporterLivre(NOM_TACHE_LIVRE_WEB, CLES_LIVRE_WEB)),
    // Ces commandes posent et lèvent le verrou : elles ne passent pas par cmdEcriture.
    cmd('szh.archiverVerrouiller', () => archiverEtVerrouiller(fournisseur, rafraichirTout)),
    cmd('szh.deverrouiller', () => deverrouiller(fournisseur, rafraichirTout)),
    cmd('szh.desarchiver', () => desarchiver(fournisseur, rafraichirTout)),
    // Deux formes d'appel : le slug seul, avec des options en second argument (arbre, vues
    // d'ensemble, sansApercu depuis la vue Articles), ou { slug, focus } depuis un bouton
    // de constat (contrat de lib/constats.js). Les deux sont ramenées à ouvrirArticle(slug,
    // opts), focus servant à surligner le passage visé.
    cmd('szh.ouvrirArticle', (arg, opts) => {
      const objet = arg !== null && typeof arg === 'object';
      return ouvrirArticle(fournisseur, objet ? String(arg.slug || '') : arg,
        objet ? { focus: String(arg.focus || '') } : opts);
    }),
    // Clic sur un en-tête de section : la section se déplie, les autres se replient, et sa
    // vue d'ensemble s'ouvre. Sur un en-tête déjà déplié, seule la vue s'ouvre.
    cmd('szh.ouvrirSection', (categorie) => {
      if (fournisseur.definirSectionDeployee(categorie)) { fournisseur.rafraichir(); }
      // « Actualité » ouvre le formulaire de la page de Documentation (une seule par
      // numéro). La promesse est rendue pour qu'un appelant puisse attendre l'ouverture.
      if (categorie === 'actualite') { return vscode.commands.executeCommand('szh.documentation'); }
      const vueSection = vueDeSection(categorie);
      if (vueSection) { vscode.commands.executeCommand(vueSection); }
    }),
    cmdEcriture('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    // Réimport d'un Word corrigé et son annulation : ils remplacent le texte.
    cmdEcriture('szh.reimporterArticle', (item) => reimporterArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.annulerReimport', (item) => annulerReimport(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.supprimerTable', (item) => supprimerAsset(fournisseur, rafraichirTout, item, true)),
    cmdEcriture('szh.editerTable', (item) => tableHote.ouvrirEditeurTable(fournisseur, item)),
    // Le formulaire des médias de l'article : légendes, crédits, qualité, remplacement.
    cmdEcriture('szh.mediasArticle', (item) => ouvrirGestionMedias(fournisseur, rafraichirTout, item)),
    // La page de Documentation, créée au besoin. Hors cmdEcriture : elle se relit sur un
    // numéro verrouillé, seule sa création y est refusée (voir ouvrirPageDocumentation).
    // `item` est accepté mais inutilisé.
    cmd('szh.documentation', (item) => ouvrirPageDocumentation(fournisseur, rafraichirTout)),
    // Les raccourcis de la section « Actualité » (_itemsActualite) : le même formulaire,
    // ouvert sur la vue visée. Pas dans la palette (aucune entrée dans package.json).
    // `categorie` ne sert que pour l'onglet 'numero'.
    cmd('szh.ouvrirActualite', (onglet, categorie) => ouvrirPageDocumentation(
      fournisseur, rafraichirTout, String(onglet || ''), categorie ? String(categorie) : undefined)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte),
    // L'article d'un Ctrl+S est retenu pour le voile de « À corriger » : la tâche que
    // triggerTaskOnSave lance ensuite ne dit pas ce qu'elle recompile.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!doc || !doc.uri || !doc.uri.fsPath) { return; }
      controlesHote.retenirEnregistrement(fournisseur, doc.uri.fsPath);
      controlesHote.compilerChapitreEnregistre(fournisseur, doc.uri.fsPath);
      // Une copie en conflit résolue à la main disparaît à l'enregistrement.
      copieResolueEnregistree(doc.uri.fsPath);
    }),
    // Suivi des tâches au démarrage : les tâches de Ctrl+S (triggerTaskOnSave), les plus
    // fréquentes, ne passent par aucune fonction du cockpit.
    vscode.tasks.onDidStartTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      if (!estTacheSuivie(tache)) { return; }
      // Compteur des tâches suivies en cours : session.buildEnCours() reste vrai tant qu'il
      // en reste une, pour que les gardes (archivage, suppression…) valent aussi sur ce chemin.
      session.poserTachesSuiviesEnVol(session.tachesSuiviesEnVol() + 1);
      session.poserBuildEnCours(true);
      // Un import fait par cette tâche finira comme l'import guidé (lib/import-hote.js).
      importHote.noterDebutTache(fournisseur, tache.name);
      // Une compilation du numéro couvre les enregistrements déjà faits (relanceDifferee) ;
      // l'export d'un seul article (tacheMakeArticle) n'est pas compté.
      if (tache.name === NOM_TACHE_BUILD || tache.name === NOM_TACHE_EXPORT) { demarragesBuild++; }
      // Une validation PDF/UA en cours juge peut-être un PDF qui va changer : son résultat
      // sera ignoré.
      pdfuaHote.signalerDebutBuild();
      // Le voile de « À corriger » couvre l'article annoncé par le cockpit ou tout juste
      // enregistré, pas toute la liste.
      controlesHote.debuterAnalyse(fournisseur, controlesHote.slugDeLaTache());
      avertirVersionSiDivergente();
    }),
    // À la fin du processus : relecture du journal (ce que la chaîne a relevé), pour toutes
    // les tâches suivies, Ctrl+S compris. Le compteur redescend dans onDidEndTask, seul
    // émis pour une tâche interrompue avant le lancement du processus (wsl.exe absent).
    vscode.tasks.onDidEndTaskProcess((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      if (!estTacheSuivie(tache)) { return; }
      const code = e.exitCode === undefined ? 0 : e.exitCode;
      importHote.noterFinProcessus(code);
      // C'est ce chemin qui lève le voile, après le journal puis la validation PDF/UA.
      controlesHote.noterProcessFini();
      controlesHote.relireJournal(fournisseur, code)
        // Validation PDF/UA seulement après une compilation réussie : le PDF d'une
        // compilation en échec n'est pas fiable. planifier() pose ses clés « en cours »
        // avant sa première attente : le voile sait donc s'il doit encore attendre.
        .then(() => { if (code === 0) { pdfuaHote.planifier(fournisseur.racine); } })
        .catch(() => { /* un avis raté ne casse pas la compilation */ })
        .then(() => { controlesHote.marquerJournalRelu(fournisseur); });
    }),
    // Émis pour toute fin de tâche, avec ou sans processus : le compteur ne redescend
    // qu'ici, pour ne pas compter deux fois une tâche qui émet les deux événements.
    vscode.tasks.onDidEndTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      if (!estTacheSuivie(tache)) { return; }
      session.poserTachesSuiviesEnVol(Math.max(0, session.tachesSuiviesEnVol() - 1));
      if (session.tachesSuiviesEnVol() === 0) { session.poserBuildEnCours(false); }
      // Tâche finie sans processus (annulée, wsl.exe absent) : aucun journal à relire, le
      // voile tombe tout de suite.
      if (session.tachesSuiviesEnVol() === 0 && !controlesHote.processFini()) { controlesHote.terminerAnalyse(fournisseur); }
      // Après le compteur : la suite d'un import externe attend la dernière tâche en vol.
      importHote.finirImportExterne(fournisseur, rafraichirTout).catch(() => { /* l'import a eu lieu */ });
    }),
    // Éditeur -> aperçu ; ignoré si l'événement vient de notre révélation de ligne.
    vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (!session.panneauApercuHtml() || modeApercu() !== 'html' || session.defilementProgrammatiqueHote()) { return; }
      if (!e.visibleRanges || !e.visibleRanges.length) { return; }
      const ed = editeurArticleCourant(fournisseur);
      if (!ed || e.textEditor !== ed) { return; }
      pousserDefilementVersApercu(e.visibleRanges[0].start.line);
    }),
    // Sens inverse : le curseur dans le .md surligne le bloc et le mot dans l'aperçu.
    vscode.window.onDidChangeTextEditorSelection((e) => {
      if (!session.panneauApercuHtml() || modeApercu() !== 'html') { return; }
      const ed = editeurArticleCourant(fournisseur);
      if (!ed || e.textEditor !== ed) { return; }
      pousserSurlignageVersApercu(fournisseur);
    })
  );

  // Contexte injecté dans lib/formatting.js : le collage de tableau (Ctrl+Alt+V) doit
  // savoir s'il est dans un article, et rafraîchir l'arbre.
  enregistrerCommandesMiseEnForme(context, {
    racine: () => fournisseur.racine,
    slugDepuisChemin: slugDepuisChemin,
    rafraichirTout: rafraichirTout,
    // Une image choisie à la main peut aussi sortir d'une chaîne d'imprimerie.
    convertirCmyk: (chemins) => convertirCmykSiBesoin(chemins),
    // Toute la mise en forme écrit dans le texte : refusée sur un numéro gelé.
    verrouillee: () => etatCourant().verrouillee,
    refuser: () => { refuserSiVerrouille(); },
    // Le groupe « Livre » de la palette (en-tête FALC, code QR) n'existe que pour un livre.
    profil: () => profilCourant().cle
  });

  // Les trois panneaux de la barre ; celui d'export s'adapte à l'état du numéro. Selon le
  // profil, les panneaux retirent ce qu'un livre n'a pas (OJS, traduction, cycle de vie).
  enregistrerPanneaux(context, {
    etat: etatCourant,
    profil: () => profilCourant().cle
  });

  // Réveil de la WSL puis chargement de l'arbre, sous un indicateur de progression.
  const demarrageInitial = async () => {
    if (!trouverRacineRevue()) { majContexte(); return; }
    const barre = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    barre.text = '$(sync~spin) ' + T('demarrage.barre');
    barre.tooltip = T('demarrage.titre');
    barre.show();
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: T('demarrage.titre'), cancellable: false },
        async (progress) => {
          progress.report({ message: T('demarrage.env') });
          await moteur.reveiller();                // démarrage à froid de la machine
          progress.report({ message: T('demarrage.revue') });
          majContexte();                           // racine, contexte, watchers, dormeur, arbre
          await ouvrirArticleActifAuDemarrage(fournisseur);
          await traductionHote.honorerIntention(fournisseur, rafraichirTout); // un lien szh:// reçu
        });
    } finally { barre.dispose(); }
    proposerTutoriel(context);
    proposerNouveautes(context);
  };
  // Les auteur·e·s publiés (OAI-PMH public d'ojs.szh.ch) se rafraîchissent en tâche de
  // fond, au plus une fois par semaine, sans bloquer l'activation. Un échec réseau est
  // silencieux : le poste peut être hors ligne.
  rafraichirAuteursPubliesEnFond();
  // De même pour les mots-clés, avec leur propre cache.
  rafraichirMotsClesConnusEnFond();
  // ---- Validation PDF/UA en arrière-plan -> lib/pdfua-hote.js ----------------------
  // Avant demarrageInitial() : ouvrirArticleActifAuDemarrage() peut marquer un article
  // ouvert, qui demande aussitôt le badge PDF/UA.
  pdfuaHote.configurer({
    listerArticles: () => fournisseur.listerArticles(),
    profilOuvrage: () => session.profilOuvrage(),
    racine: () => fournisseur.racine,
    surChangement: () => controlesHote.rafraichirPdfUa(fournisseur)
  });
  accueilHote.configurer({ rafraichirTout });
  accueilHote.demarrer(context);   // l'Accueil -> lib/accueil-hote.js
  demarrageInitial();
}

// ---- Invitation au tutoriel et « Quoi de neuf » -> lib/bienvenue-hote.js -----------
const { proposerTutoriel, proposerNouveautes, montrerNouveautes } = require('./lib/bienvenue-hote');
const accueilHote = require('./lib/accueil-hote');

function deactivate() { moteur.arreterDormeur(); accueilHote.arreter(); }

// `_pur` : les fonctions pures, exposées aux harnais de test.
module.exports = {
  activate, deactivate,
  _pur: {
    titreNumero, slugDepuisChemin, lireProfil,
    separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
    analyserMeta, serialiserMeta, lignePos, plagePos, positionMot, jetonSource,
    analyserAusgabe, serialiserAusgabe,
    nettoyerCarte, assainirCheminPhoto, decomposerPhoto, relatifImageValide,
    analyserTraduction, serialiserTraduction, lignesTraduction, resumeTraduction,
    versionsDivergent, poidsLisible, construireLienTraduction,
    brouillonTraduction, uriMailto, brouillonAuteur, adressesAuteurs,
    ordonnerArticles, deplacerArticle, prefixeOrdre, libelleArticle, titreFiche, chargeChapitres,
    tachesRevue, tachesConfig, configAvecTaches, libelleTache, resumeTaches, basculerTache,
    analyserTachesFaites, serialiserTachesFaites, nomCouverture,
    texteChamp, valeurChamp,
    retirerImage, retirerTable, lireAttributsImage, ecrireAttributsImage,
    basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
    enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, nomTableLibre,
    slugifier, slugifierArticle,
    analyserTable, serialiserTable, disposition,
    matriceOccupation, etendreGrille, compacterGrille,
    normaliserModele, finaliserModele, canoniserInline,
    ajouterLigne, supprimerLigne, ajouterColonne, supprimerColonne,
    fusionner, scinder, viderCellules, alignerCellules,
    deplacerLigne, deplacerColonne,
    tableauDepuisTsv, collerDans, appliquerOperationTable,
    fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule, tableauDepuisHtmlBureautique,
    // Les suivantes ne sont pas pures (elles lisent et écrivent le numéro) : exposées pour
    // être testées sans hôte complet.
    doisCalculesArticles, ecrireDoisCalcules, permuterStatutsTraduction,
    // Co-édition (lib/coedition-hote.js) : ce qu'un formulaire a le droit d'écrire. Le
    // « panneau » n'y sert que de clé : n'importe quel objet convient.
    mainCoedition, ecrireSousMain, refusCoedition, refusCoeditionNumero,
    noterLectureCoedition, rafraichirEmpreinteCoedition, libererCoedition,
    ecrireCartesArticles, messageCartes, moiCoedition,
    // Focus de l'arbre et compilation d'un article. Elles lisent l'état de lib/session.js,
    // celui de l'hôte réellement activé.
    focaliserUnite, relancerCompilation, compilerPuisAfficher, relancerCompilationCartes,
    rejouerCompilationsDifferees,
    avertirCopiesConflit, oublierCopiesSignalees, ecrireClesAusgabe,
    // Numéro de tête du Word reporté dans ordre-articles/ordre-chapitres à l'import.
    numerosOrdreEnAttente, resoudreNumeroOrdre, ecrireOrdreNouveauxArticles,
    // Copies en conflit : le fournisseur de diff qui présente la copie comme « original »,
    // et les deux sens de résolution.
    SCHEME_CONFLIT, fournisseurDiffConflit, cheminDepuisUriConflit,
    resoudreBlocConflit, comparerConflit, supprimerCopieConflit, rafraichirConflitsScm,
    TEXTES_COCKPIT,
    // Montre une modale et lit context.globalState : exposée pour vérifier que
    // l'invitation ne s'affiche pas sur un livre (le `when` du walkthrough ne suffit pas).
    proposerTutoriel
  }
};
