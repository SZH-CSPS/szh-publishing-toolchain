// Extension « Revue SZH » : la barre latérale du cockpit dans l'Explorateur de VSCodium
// (articles, Word en attente, traductions) et les commandes associées. La vue n'apparaît
// que si le dossier ouvert est une publication — un numéro de revue (ausgabe.yaml) ou un
// livre (buch.yaml) : lib/profil.js dit lequel, et pose la clé de contexte qui va avec.
//
// Sans build : les require sont résolus à l'exécution, donc lib/ et media/ doivent
// rester empaquetés (voir .vscodeignore). Ici, activate/deactivate, le câblage des
// commandes et l'agrégat _pur exposé aux tests. Une webview ne reçoit aucune donnée dans
// son HTML : tout arrive par postMessage, et les libellés y sont des marqueurs
// %%SZH:cle%% résolus par T().
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

// Les clés de contexte du profil — szh.estRevue, szh.estLivre — ne sont plus nommées
// ici : elles vivent dans la table de lib/profil.js, avec le reste de ce qui
// distingue un numéro d'un livre, et se posent toutes ensemble (voir majContexte).
// L'état du numéro en clés de contexte : c'est ce que lisent les `when` de package.json.
const CLE_VERROUILLEE = 'szh.verrouillee';
const CLE_ARCHIVEE = 'szh.archivee';
const ID_VUE = 'szhCockpitVue';
// À garder identiques aux labels de vscodium-user/tasks.json, qui les nomme.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const CLE_TUTORIEL_VU = 'szh.tutoriel.propose';   // invitation au tutoriel : une seule fois
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const NOM_TACHE_EXPORT = 'Tout exporter';
const NOM_TACHE_DOCX = 'Galleys DOCX (OJS)';
// Les quatre sorties du livre (pipeline/profils/livre.mk), sans équivalent côté revue.
const NOM_TACHE_LIVRE_IMPRIMEUR = 'Livre : PDF imprimeur';
const NOM_TACHE_LIVRE_COUVERTURE = 'Livre : couverture';
const NOM_TACHE_LIVRE_EPUB = 'Livre : EPUB';
const NOM_TACHE_LIVRE_WEB = 'Livre : HTML web';
// À garder alignés avec vscodium-user/tasks.json, lib/wsl.js et lib/portraits.js.
const DISTRO_WSL = 'SZH-Publishing';
const MAKEFILE_WSL = '/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile';
// Le réimport d'un article corrigé. Seul maillon que le cockpit appelle sans passer par
// une tâche : il rend une ligne JSON qu'il faut lire, et une tâche n'en rapporte rien.
const REIMPORTER_WSL = '/mnt/c/ProgramData/SZH/toolkit/pipeline/reimporter.py';

// ---- i18n du cockpit -> lib/i18n.js ----------------------------------------------
const { TEXTES_COCKPIT, T, langueCockpit, oublierLanguePoste } = require('./lib/i18n');
// ---- Protocole de messages hôte <-> webviews -> lib/messages.js -----------------
const { MSG } = require('./lib/messages');
// ---- Sérialiseurs YAML -> lib/yaml.js --------------------------------------------
const {
  CLES_METADONNEES, COULEURS_NUMERO, HEX_COULEURS, normaliserRevue, estVraiYaml,
  TYPES_ARTICLE, TYPES_DOSSIER, TYPES_HORS, LIBELLES_TYPES, GROUPES_TYPES, LANGUES_META, CHAMPS_AUTEUR,
  analyserAusgabe, serialiserAusgabe, ecrireAtomique,
  separerFrontmatter, analyserFrontmatter, serialiserFrontmatter,
  analyserMeta, serialiserMeta, langueRevue, langueDefaut, titreNumero, etatRevue, normaliserLangueArticle,
  LICENCE_DEFAUT, LICENCES_ARTICLE, normaliserLicence, REVUES
} = require('./lib/yaml');
// ---- Bibliographie et appels de citation -> lib/citations.js ---------------------
const {
  configBiblio, configAvecTitresBiblio, configAvecLiensDesactives, nomFichierBiblio, cheminBiblio,
  REVUES_BIBLIO, LANGUES_BIBLIO
} = require('./lib/citations');
// ---- Poste et traduction -> lib/archivage.js ; cycle de vie -> lib/cycle-vie.js --
const {
  // versionsDivergent n'est plus appelée ici (voir lib/cycle-vie.js) mais reste exposée
  // par module.exports._pur, qui la veut en liaison de module — pas seulement ré-exportée.
  versionsDivergent,
  lireModeDeveloppeur, ecrireModeDeveloppeur, lireConfigPoste, ecrireConfigPoste,
  configAvecLangue, CONFIG_POSTE
} = require('./lib/archivage');
// ---- Rapports d'erreur automatiques -> lib/rapport-erreur.js ---------------------
// Toute la logique (résolution passive de l'ancrage, masquage, anti-inondation, file
// d'attente, écriture) vit dans ce module, testable hors éditeur ; ici, seulement deux
// accroches (COMPIL-ECHEC dans relireJournal(), COCKPIT-EXCEPTION ci-dessous) et le
// vidage de la file au démarrage — voir docs/RAPPORTS-ERREUR.md.
const rapportErreur = require('./lib/rapport-erreur');
// ---- Réglages protégés de la chaîne -> lib/reglages-proteges.js -------------------
const proteges = require('./lib/reglages-proteges');
// ---- Réglages de la maison -> lib/reglages-flotte.js -----------------------------
const { empreinteReglages, clesRefusees } = require('./lib/reglages-flotte');
// ---- Auteur·e·s connus : OJS (OAI-PMH) et les numéros du poste --------------------
// Deux sources, un seul cache. OJS donne les noms et l'affiliation ; la fonction et
// l'e-mail n'existent nulle part dans son interface publique et ne viennent que des
// fiches meta.yaml des numéros, où la rédaction les a saisis.
const {
  lireCache: lireCacheAuteursPublies, rafraichir: rafraichirCacheAuteursPublies
} = require('./lib/auteurs-ojs');
const { rafraichirCorpus: rafraichirCorpusAuteurs } = require('./lib/auteurs-corpus');
// ---- Mots-clés connus : le vocabulaire edudoc.ch (OAI-PMH) -----------------------
// Deuxième source moissonnée, séparée des auteur·e·s : cache différent
// (mots-cles.json), et un rythme d'activation propre à CE cockpit — voir
// rafraichirMotsClesEnFond — indépendant du repli mensuel interne au module.
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
  fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule, tableauDepuisHtmlBureautique,
  PRESETS_ORDRE
} = require('./lib/table-model');
// ---- Assemblage des webviews -> lib/webviews/util.js -----------------------------
const { construireHtml } = require('./lib/webviews/util');
// ---- Ce qu'est le dossier ouvert -> lib/profil.js --------------------------------
// Numéro de revue ou livre : la table qui le dit, et les chemins qui en découlent.
const profils = require('./lib/profil');
// ---- Modules impératifs -> lib/{slug,wsl,formatting}.js --------------------------
const { slugifier, slugifierArticle } = require('./lib/slug');
const { demarrerDormeurWsl, arreterDormeurWsl, reveillerWsl, cheminWsl } = require('./lib/wsl');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, nomTableLibre,
  enregistrerCommandesMiseEnForme
} = require('./lib/formatting');
// ---- Liens profonds « szh:// » -> lib/liens.js (le verrou lui-même est dans -------
// lib/cycle-vie.js, qui require lib/verrou.js directement) ------------------------
const { construireLienTraduction, consommerIntention } = require('./lib/liens');
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
  cheminDepuisUriConflit, resoudreBlocConflit, supprimerCopieConflit, rafraichirConflitsScm
} = cycleVie;
// Les rappels vers l'hôte que lib/cycle-vie.js ne peut pas connaître par require (voir son
// en-tête) : posés une seule fois, ici. Toutes les fonctions visées sont des déclarations de
// fonction — hoisted — même celles définies plus bas dans ce fichier.
cycleVie.configurer({
  trouverRacineRevue: () => trouverRacineRevue(),
  refusCoedition: (racine, chemin) => refusCoedition(racine, chemin),
  refusCoeditionNumero: (racine) => refusCoeditionNumero(racine),
  rafraichirEmpreinteCoedition: (racine, chemin) => rafraichirEmpreinteCoedition(racine, chemin),
  ecrireClesAusgabe: (racine, modifies) => ecrireClesAusgabe(racine, modifies),
  fermerTousLesApercus: () => fermerTousLesApercus(),
  fermerOngletsSous: (dossier) => fermerOngletsSous(dossier),
  supprimerAvecReprises: (chemin) => supprimerAvecReprises(chemin),
  fermerPanneauxDe: [
    (racine, slug) => fermerPanneauxMediasDe(racine, slug),
    (racine, slug) => fermerPanneauxDocumentationDe(racine, slug),
    (racine, slug) => fermerPanneauxTableDe(racine, slug)
  ]
});
// ---- Aperçu commutable HTML / PDF -> lib/apercu.js -------------------------------
const apercuLib = require('./lib/apercu');
const {
  lireProfil, modeApercu, lignePos, plagePos, positionMot, jetonSource,
  editeurArticleCourant, revelerLigneSource, pousserDefilementVersApercu,
  pousserSurlignageVersApercu, injecterApercu, revelerPos,
  fermerApercuCourant, fermerApercuHtml, fermerTousLesApercus, echapperTexte,
  ouvrirApercuHtml, rechargerApercuHtmlSiChange, basculerApercu, cheminApercuHtml
} = apercuLib;
apercuLib.configurer({
  fermerOnglets: (predicat) => fermerOnglets(predicat),
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
  refusCoedition: (racine, chemin) => refusCoedition(racine, chemin),
  ecrireClesAusgabe: (racine, modifies) => ecrireClesAusgabe(racine, modifies),
  lancerTache: (nomTache) => lancerTache(nomTache),
  avertirEchecCompilation: (cle, args) => avertirEchecCompilation(cle, args),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins),
  ouvrirImportVerif: (fournisseur, rafraichirTout, nouveaux) =>
    ouvrirImportVerif(fournisseur, rafraichirTout, nouveaux),
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
  limitesMedias, BUDGET_VIGNETTES, vignetteAuteur, envoyerAuteursConnus, envoyerMotsClesConnus,
  rafraichirMotsClesConnusEnFond, rafraichirAuteursPubliesEnFond,
  deposerPhotoAuteur, ouvrirVersionsPhoto, choisirPhotoAuteur, signalerFichesPerimees,
  confirmerDoiManuel
} = metadonneesHote;
metadonneesHote.configurer({
  ecrireClesAusgabe: (racine, modifies) => ecrireClesAusgabe(racine, modifies),
  mainCoedition: (panneau, racine, chemin, opts) => mainCoedition(panneau, racine, chemin, opts),
  ecrireSousMain: (panneau, racine, chemin, ecrire) => ecrireSousMain(panneau, racine, chemin, ecrire),
  annoncerMain: (panneau, racine, chemin) => annoncerMain(panneau, racine, chemin),
  noterLectureCoedition: (panneau, racine, chemin) => noterLectureCoedition(panneau, racine, chemin),
  rafraichirEmpreinteCoedition: (racine, chemin) => rafraichirEmpreinteCoedition(racine, chemin),
  libererCoedition: (panneau) => libererCoedition(panneau),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  permuterStatutsTraduction: (racine, slug, avant, apres) =>
    permuterStatutsTraduction(racine, slug, avant, apres),
  relancerCompilation: (fournisseur, slug, opts) => relancerCompilation(fournisseur, slug, opts),
  focaliserUnite: (fournisseur, slug) => focaliserUnite(fournisseur, slug),
  slugDepuisChemin: (racine, chemin) => slugDepuisChemin(racine, chemin),
  articlesSansDoi: (racine, slugs) => articlesSansDoi(racine, slugs)
});
// ---- Gestionnaire des médias d'un article -> lib/medias-hote.js -------------------
const mediasHote = require('./lib/medias-hote');
const { ouvrirGestionMedias, fermerPanneauxMediasDe } = mediasHote;
mediasHote.configurer({
  focaliserUnite: (fournisseur, slug) => focaliserUnite(fournisseur, slug),
  slugDepuisChemin: (racine, chemin) => slugDepuisChemin(racine, chemin),
  ouvrirArticle: (fournisseur, slug) => ouvrirArticle(fournisseur, slug),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  envoyerAuteursConnus: (panneau, racine) => envoyerAuteursConnus(panneau, racine),
  textesAuteur: () => textesAuteur(),
  limitesMedias: () => limitesMedias(),
  nettoyerCarte: (brut) => nettoyerCarte(brut),
  signalerFichesPerimees: () => signalerFichesPerimees(),
  remplacerFichierImage: (fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options) =>
    remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options),
  supprimerAsset: (fournisseur, rafraichirTout, item, estTable) =>
    supprimerAsset(fournisseur, rafraichirTout, item, estTable),
  deposerPhotoAuteur: (fournisseur, panneau, msg) => deposerPhotoAuteur(fournisseur, panneau, msg),
  ouvrirVersionsPhoto: (fournisseur, panneau, msg) => ouvrirVersionsPhoto(fournisseur, panneau, msg),
  choisirPhotoAuteur: (fournisseur, panneau, msg) => choisirPhotoAuteur(fournisseur, panneau, msg),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins)
});
// ---- La Documentation d'un numéro -> lib/documentation-hote.js -------------------
const documentationHote = require('./lib/documentation-hote');
const { ouvrirDocumentation, ouvrirPageDocumentation, fermerPanneauxDocumentationDe } = documentationHote;
documentationHote.configurer({
  focaliserUnite: (fournisseur, slug) => focaliserUnite(fournisseur, slug),
  slugDepuisChemin: (racine, chemin) => slugDepuisChemin(racine, chemin),
  ouvrirArticle: (fournisseur, slug) => ouvrirArticle(fournisseur, slug),
  lireCouleurAccent: (racine) => lireCouleurAccent(racine),
  limitesMedias: () => limitesMedias(),
  // Partagés avec la réserve de fiches, restée dans ce fichier (hors magasin, dans le
  // dossier parent, commune aux deux revues).
  revueCourante: (racine) => revueCourante(racine),
  nomRevueAffiche: (revue) => nomRevueAffiche(revue),
  deposerFicheEnReserve: (racine, slug, fiche, vers, aTraduire) =>
    deposerFicheEnReserve(racine, slug, fiche, vers, aTraduire),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins)
});
// ---- Co-édition d'un même numéro -> lib/coedition.js, lib/copies-conflit.js -------
// ⚠ Rien à voir avec le verrou de lib/verrou.js juste au-dessus, qui gèle un numéro entier
// en lecture seule. Ici : un bail de deux minutes posé sur un fichier pendant qu'un
// formulaire le modifie, et l'avertissement quand le synchroniseur a déjà dédoublé un
// fichier du numéro.
const coedition = require('./lib/coedition');
// (les autres exports de lib/copies-conflit.js sont requis directement par lib/cycle-vie.js)
const { copieConflitPour } = require('./lib/copies-conflit');
// ---- Garde d'interaction -> lib/interaction.js ------------------------------------
// Un QuickPick de VS Code se ferme dès que le focus bouge ; la fin d'une compilation
// (réassignation du HTML de l'aperçu, notification des contrôles) ne doit pas interrompre
// le geste en cours. sousGarde enveloppe les choix, differer retient ce qui volerait le
// focus et le rejoue à la fermeture. Instance partagée avec panneaux.js et formatting.js.
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
// ---- Fiches de « ressources » d'un article (livre, film, …) -> lib/ressources.js -------
const ressourcesLib = require('./lib/ressources');

// ---- Réserve de fiches, et échanges entre les deux revues -> lib/reserve.js -----------
const reserveLib = require('./lib/reserve');

// ---- Rubriques de texte riche d'un article de Documentation -> lib/rubriques.js --------
// L'autre moitié de la Documentation : là où une « ressource » est une fiche à champs, une
// « rubrique » est un bloc de prose titré (liste bibliographique, liste de liens, brève).
// Deux familles de blocs, deux modules, mais un seul formulaire (media/documentation.js)
// qui les affiche ensemble.
const rubriquesLib = require('./lib/rubriques');

// ---- Les cantons, liste fermée du champ `canton` d'une intervention -> lib/cantons.js --
const cantonsLib = require('./lib/cantons');
const { traiterPortraits } = require('./lib/portraits');
// ---- Journal de compilation -> lib/journal.js ------------------------------------
const {
  analyserJournal, phraseConstat, resumeJournal, slugsCompiles, citationsParArticle,
  constatsReimport, tonResultatReimport
} = require('./lib/journal');
// ---- JPEG CMJN -> RVB -> lib/cmyk.js ---------------------------------------------
const { convertirCmykEnRgb, estJpegCmyk } = require('./lib/cmyk');
// ---- Seuils de qualité des images -> lib/qualite-image.js ------------------------
const { qualiteImage } = require('./lib/qualite-image');
// ---- Médias d'un article : dimensions, noms sûrs, portraits, doublons -> lib/medias.js
const {
  EXTENSIONS_IMAGE_IMPORT, TAILLE_MAX_IMAGE_IMPORT,
  lireDimensionsImage, decrireImage, formatImage,
  nomImageAssaini, nomMediaLibre, relatifImageValide,
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
  CLE_SANS_DOI, ordonnerArticles, deplacerArticle, prefixeOrdre, titreFiche,
  libelleArticle, analyserSansDoi, basculerSansDoi, trierParDoi, refusDeplacement,
  rangDoi, resumeImages,
  REVUES_TACHES, tachesRevue, tachesConfig, configAvecTaches, libelleTache,
  vueArticlesConfig, configAvecVueArticles,
  analyserTachesFaites, serialiserTachesFaites, resumeTaches, basculerTache,
  NOMS_COUVERTURE, EXTENSIONS_COUVERTURE, nomCouverture, MAX_COUVERTURE
} = require('./lib/articles');

const VUE_PDF = 'pdf.preview';
const EXT_PDF = 'tomoki1207.pdf';

// Premier dossier du workspace qui est une publication, ou null : la vue reste masquée.
//
// La reconnaissance elle-même est dans lib/profil.js, qui sait dire ce que le dossier est
// — un numéro de revue (ausgabe.yaml, articles/) ou un livre (buch.yaml, chapitres/) — et
// où sont ses fichiers. Ici on n'en garde que deux choses : le chemin, que tout le reste du
// fichier attend sous forme de chaîne, et le profil, mémorisé pour les gestes qui doivent
// savoir de quoi ils parlent.
//
// ⚠ Ne pas confondre avec `session.profilRevue()` / `lireProfil` plus bas : celui-là est la clé
//   `profil:` d'ausgabe.yaml, qui décide du mode d'aperçu d'un numéro. Deux notions, deux
//   noms, et le voisinage est malheureux — mais renommer la seconde toucherait le contrat
//   exporté que les tests lisent.

function trouverRacineRevue() {
  const trouve = profilOuvrage_detecter();
  return trouve ? trouve.racine : null;
}

function profilOuvrage_detecter() {
  const trouve = profils.racineDepuis(vscode.workspace.workspaceFolders);
  session.poserProfilOuvrage(trouve ? trouve.profil : null);
  return trouve;
}

// Le profil du dossier ouvert, ou celui de la revue par défaut : les gestes écrits avant
// le moteur livre continuent de se comporter comme avant tant qu'aucun livre n'est ouvert.
function profilCourant() { return session.profilOuvrage() || profils.profilPour('revue'); }

// Le dossier des unités de texte du profil actif : « articles » pour un numéro,
// « chapitres » pour un livre. C'est la seule façon d'écrire ce chemin dans l'arbre.
// ⚠ Il en reste une trentaine d'autres, hors de l'arbre — médias, réimport, marqueur de
//   fichier ouvert, éditeur de tableau. Elles passeront par ici à leur tour ; tant qu'elles
//   n'y sont pas, un livre navigue mais tous ses gestes ne le suivent pas encore.
function dossierUnites() { return profilCourant().unites.dossier; }

// Le titre de la section, dans la langue de l'interface : « ARTICLES » ou « CHAPITRES ».
function cleArbreUnites() { return 'arbre.' + profilCourant().unites.dossier; }

// La catégorie de la section des unités : elle sert de clé d'accordéon ET de valeur de
// contexte pour les menus de package.json. Deux profils, deux catégories, pour qu'un
// `when` puisse les distinguer.
function categorieUnites() { return profilCourant().unites.dossier; }

// ---- Cycle de vie du numéro : verrou, archive, version du logiciel -> lib/cycle-vie.js
// etatCourant, compilationAutoCoupee, refuserSiArchivee, refuserSiVerrouille et le reste
// du cycle de vie sont importés plus haut ; seuls restent ici les utilitaires de chemin
// que d'autres zones lisent aussi (cheminConfig, cleOrdre, ecrireClesAusgabe).

// Le fichier de configuration du dossier ouvert : ausgabe.yaml pour un numéro, buch.yaml
// pour un livre. Tout ce qui lit ou écrit la configuration passe par ici — écrire le nom
// en dur reviendrait, sur un livre, à créer un ausgabe.yaml parasite qui rendrait le
// dossier ambigu pour le cockpit ET pour le Makefile.
function cheminConfig(racine) { return path.join(racine, profilCourant().config); }

// La clé qui porte l'ordre des unités : `ordre-articles` dans ausgabe.yaml,
// `ordre-chapitres` dans buch.yaml. Même forme, même lecteur, même réparation — seul le
// nom change, et il vient de la table des profils plutôt que d'un littéral.
function cleOrdre() { return profilCourant().unites.ordre; }

// Le sérialiseur du formulaire préserve les lignes non gérées. null si tout est écrit.
function ecrireClesAusgabe(racine, modifies) {
  const chemin = cheminConfig(racine);
  try {
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
    ecrireAtomique(chemin, serialiserAusgabe(contenu, modifies));
    // Point de passage unique d'ausgabe.yaml : c'est ici que les formulaires ouverts
    // apprennent que le fichier a bougé de notre fait — un bouton de l'arbre, une commande
    // — et non de celui d'un autre poste. Sans ça, le prochain enregistrement d'un
    // formulaire endormi crierait au conflit sans raison. Voir « Co-édition ».
    rafraichirEmpreinteCoedition(racine, chemin);
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// appliquerEtVerifierVerrou, majEtatNumero, majBarreEtatNumero, titreVue et
// avertirVersionSiDivergente vivent dans lib/cycle-vie.js (voir le require plus haut).

// szh.replierAssetsAutres (défaut true) : au clic, les assets de l'article se déplient
// et ceux des autres se replient.
// Réglage szh.convertirCmyk, coché par défaut : un JPEG CMJN ne s'affiche correctement ni
// dans un navigateur ni dans WeasyPrint, et le défaut ne se voit qu'au PDF. La conversion
// reste débranchable, la chaîne de portraits n'étant pas disponible partout.
function convertirCmykActif() {
  try { return vscode.workspace.getConfiguration('szh').get('convertirCmyk', true) !== false; }
  catch (e) { return true; }
}

// Réglage szh.reduireWarningsImpression, décoché par défaut : activé, le palier
// « conseillé » des avertissements de résolution se tait — seule une image sous le
// minimum reste signalée. Le CMJN n'est pas concerné.
function reduireWarningsImpressionActif() {
  try { return vscode.workspace.getConfiguration('szh').get('reduireWarningsImpression', false) === true; }
  catch (e) { return false; }
}

// Réglage szh.desactiverLiensReferences, décoché par défaut : activé, la compilation ne pose
// plus le lien entre un appel de citation et sa référence — les liens posés à la main restent
// tels quels, et l'action « Lier un appel à une référence » du cockpit reste disponible. Lu
// ici pour l'affichage du panneau ; la valeur qui compte pour la compilation est celle
// répercutée dans config.json (voir la branche « liensReferences » d'ouvrirReglages), seul
// pont vers pipeline/filters/szh-citations.lua, qui tourne dans WSL sans rien connaître des
// réglages de VSCodium.
function desactiverLiensReferencesActif() {
  try { return vscode.workspace.getConfiguration('szh').get('desactiverLiensReferences', false) === true; }
  catch (e) { return false; }
}

// Convertit en RVB les JPEG CMJN de la liste. Silencieux quand il n'y a rien à faire ;
// un échec est signalé mais ne bloque rien, le fichier restant lisible tel quel.
// -> Promise<nombre de fichiers convertis>
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

function replierAssetsAutres() {
  try { return vscode.workspace.getConfiguration('szh').get('replierAssetsAutres', true) !== false; }
  catch (e) { return true; }                       // configuration indisponible
}

// Le type d'article qui peuple la section « Actualité » plutôt que « Articles ». C'est le
// même jeton que TYPES_HORS de lib/yaml.js et que la table des rubriques OJS de
// lib/export-ojs.js (rubrique DC/DK) : la Documentation n'est pas un nouveau modèle de
// données, c'est le type qui existait déjà, simplement présenté à part. Un article de
// Documentation reste un `articles/<slug>/` ordinaire, il garde son rang dans le numéro, sa
// fiche, ses traductions et son export — seule sa place dans l'arbre change.
const TYPE_ACTUALITE = 'documentation';

// Le nom de dossier de la page de Documentation, quand le cockpit la crée lui-même. Une
// seule par numéro : la Documentation est une page — « Actualité et ressources » /
// « News & Ressourcen » — et non une famille d'articles. Un numéro qui en porterait déjà
// une sous un autre nom (page importée d'un Word, dossier créé à la main) garde le sien :
// c'est le type de la fiche qui la désigne, jamais son nom de dossier.
const SLUG_DOCUMENTATION = 'documentation';

// La vue d'ensemble de chaque section : rouverte par le clic sur l'en-tête (en plus de
// l'accordéon) et par le dépliage au chevron — mais jamais par les dépliages programmés,
// un clic d'article ne doit pas ramener la vue Articles par-dessus le texte (décision B).
// « Actualité » n'y figure pas, comme « chapitres » : elle n'a pas de vue d'ensemble, le
// clic sur son en-tête ne fait donc que jouer l'accordéon.
const VUE_SECTION = {
  articles: 'szh.vueArticles', traductions: 'szh.vueTraductions', word: 'szh.vueWord'
};

// Une couleur par en-tête de section : le TreeView natif n'offre ni gras ni taille de
// police, ce sont donc les majuscules du libellé et la couleur de l'icône qui rendent les
// trois sections repérables. Bleu et vert sont ceux des états de traduction
// (COULEURS_STATUT) ; pour « Word en attente », l'ambre d'avertissement de l'éditeur
// plutôt que « charts.orange », trop clair sur fond blanc — même choix que COULEURS_STATUT.
const COULEURS_SECTION = {
  articles: 'charts.blue',
  // Un livre nomme ses unités « chapitres » : sans cette entrée, la section sortirait sans
  // couleur, seule de son espèce dans l'arbre.
  chapitres: 'charts.blue',
  // ⚠ Une couleur par section, jamais deux fois la même sur un même arbre : test/js/hote.test.js
  //   le vérifie. Le violet est le seul des `charts.*` encore libre après le bleu des
  //   articles et le vert des traductions.
  actualite: 'charts.purple',
  traductions: 'charts.green',
  word: 'editorWarning.foreground'
};

// L'icône d'un article dans l'arbre : son avancement, en trois états lisibles d'un coup
// d'œil. Le langage visuel est celui des états de traduction (iconeStatut) : cercle vide =
// rien de commencé, plein et bleu = en cours, coche verte = tout est fait. Un article sans
// tâches configurées reste au cercle vide : il n'a rien à raconter.
function iconeAvancement(avance) {
  if (avance.total > 0 && avance.faites >= avance.total) {
    return new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('charts.green'));
  }
  if (avance.total > 0 && avance.faites > 0) {
    return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('charts.blue'));
  }
  return new vscode.ThemeIcon('circle-large-outline');
}

// ---- Co-édition : deux postes sur le même numéro ---------------------------------
//
// lib/coedition.js pose le bail et sait le lire ; ici vit ce qu'il ne peut pas savoir :
// quel panneau tient quel fichier, ce que ce fichier valait quand le formulaire l'a
// chargé, et comment le refus s'affiche.
//
// ⚠ L'ordre des gardes ne change jamais : le verrou du numéro d'abord — refuserSiVerrouille
// ou session.etatNumero().verrouillee, qui parlent d'un numéro gelé —, le bail de co-édition ensuite.
// Un numéro gelé refuse déjà tout, il n'a aucune co-édition à raconter.
//
// Le refus part dans la zone d'état du formulaire, jamais en fenêtre : l'enregistrement est
// automatique toutes les trois secondes, et une fenêtre à cette cadence serait pire que le
// refus lui-même. Même choix, et même raison, que le refus du numéro verrouillé.


// Qui nous sommes pour les autres postes : le réglage szh.nomUtilisateur, sinon le nom de
// session Windows. Relu au changement de réglage (oublierIdentiteCoedition).
function moiCoedition() {
  if (session.identiteCoedition()) { return session.identiteCoedition(); }
  let nom = '';
  try { nom = String(vscode.workspace.getConfiguration('szh').get('nomUtilisateur', '') || ''); }
  catch (e) { /* configuration indisponible */ }
  session.poserIdentiteCoedition(coedition.identite(nom));
  return session.identiteCoedition();
}

function oublierIdentiteCoedition() { session.poserIdentiteCoedition(null); }

// panneau -> Map(clé du fichier -> { racine, chemin, activite, empreinte }).
//
// Une Map et non une WeakMap : après une écriture, l'empreinte doit être remise à jour dans
// tous les panneaux qui suivent le fichier, ce qui demande de pouvoir les parcourir. D'où
// libererCoedition(), appelé par le onDidDispose de chaque panneau concerné — sans lui, un
// panneau fermé resterait retenu ici.
const suivisCoedition = new Map();

function suiviCoedition(panneau) {
  if (!panneau) { return null; }
  let suivi = suivisCoedition.get(panneau);
  if (!suivi) { suivi = new Map(); suivisCoedition.set(panneau, suivi); }
  return suivi;
}

// Le formulaire vient de lire le fichier : ce qu'il montre est ce que le disque dit, et le
// compteur d'inactivité repart. À appeler à chaque fois qu'un panneau charge des valeurs.
// `quand` : l'instant de la lecture, pour qu'un test puisse antidater une saisie sans
// attendre cinq minutes ; l'hôte ne le passe jamais.
function noterLectureCoedition(panneau, racine, chemin, quand) {
  const suivi = suiviCoedition(panneau);
  const clef = racine && chemin ? coedition.clefFichier(racine, chemin) : null;
  if (!suivi || !clef) { return; }
  suivi.set(clef, {
    racine: racine, chemin: chemin,
    activite: quand === undefined ? Date.now() : quand,
    empreinte: coedition.empreinte(chemin)
  });
}

// Après une écriture réussie : tous les suivis de ce fichier repartent de l'empreinte du
// disque. C'est ce qui évite de crier au conflit quand c'est nous qui avons écrit — un
// « Monter » dans l'arbre, une commande, un autre panneau du même poste : tous touchent
// ausgabe.yaml sans passer par le formulaire qui l'affiche.
function rafraichirEmpreinteCoedition(racine, chemin) {
  const clef = racine && chemin ? coedition.clefFichier(racine, chemin) : null;
  if (!clef) { return; }
  const fraiche = coedition.empreinte(chemin);
  for (const suivi of suivisCoedition.values()) {
    const etat = suivi.get(clef);
    if (etat) { etat.empreinte = fraiche; }
  }
}

// Demande la main sur un fichier pour ce panneau, et la garde le temps du bail.
//
// -> null quand la main est à nous, sinon { code, message } :
//    'pris'   un autre poste modifie le fichier ; rien ne doit être écrit
//    'perime' notre saisie a dormi plus de cinq minutes ET le fichier a changé entre-temps.
//             Le formulaire montre donc autre chose que le disque : il faut le recharger et
//             refaire la saisie. Si le fichier n'a pas changé, la main est simplement
//             reprise et l'écriture passe — faire refaire une saisie que personne n'a
//             contredite serait une punition sans objet.
//
// `opts.ecriture` : une écriture suit. C'est le seul cas où l'inactivité est vérifiée ;
// à l'ouverture d'un formulaire, il n'y a encore rien à écraser.
function mainCoedition(panneau, racine, chemin, opts) {
  const o = opts || {};
  const clef = racine && chemin ? coedition.clefFichier(racine, chemin) : null;
  if (!clef) { return null; }                      // hors numéro : rien à protéger
  const maintenant = Date.now();
  const suivi = suiviCoedition(panneau);
  const etat = suivi ? suivi.get(clef) : null;
  const pose = coedition.poser(racine, chemin, moiCoedition(), maintenant);
  if (!pose.ok) {
    return { code: 'pris', titulaire: pose.titulaire.utilisateur,
             message: T('coedition.pris', [pose.titulaire.utilisateur]) };
  }
  if (o.ecriture && etat && maintenant - etat.activite > coedition.INACTIVITE_MS
      && coedition.empreinte(chemin) !== etat.empreinte) {
    return { code: 'perime', titulaire: '', message: T('coedition.perime') };
  }
  if (suivi) {
    suivi.set(clef, {
      racine: racine, chemin: chemin, activite: maintenant,
      empreinte: etat ? etat.empreinte : coedition.empreinte(chemin)
    });
  }
  return null;
}

// Le geste complet d'un formulaire : la main, l'écriture, puis l'empreinte remise à jour.
// `ecrire` rend null en cas de succès, sinon son message d'échec brut.
// -> null, ou { code, message } prêt à partir dans la zone d'état ; `code` vaut 'echec'
//    quand c'est l'écriture elle-même qui a échoué, et 'perime' quand le formulaire doit
//    être rechargé.
function ecrireSousMain(panneau, racine, chemin, ecrire) {
  const refus = mainCoedition(panneau, racine, chemin, { ecriture: true });
  if (refus) { return refus; }
  const erreur = ecrire();
  if (erreur) { return { code: 'echec', message: T('err.ecriture', [path.basename(chemin), erreur]) }; }
  rafraichirEmpreinteCoedition(racine, chemin);
  return null;
}

// Bail posé à l'ouverture d'un formulaire dédié à un fichier : l'ouvrir, c'est venir le
// modifier. Le refus s'affiche sans empêcher l'ouverture — on voit les valeurs, on est
// seulement prévenu que l'enregistrement ne passera pas. Rien n'est posé sur les vues
// multi-articles : y ouvrir une vue d'ensemble prendrait la main sur tout le numéro, et une
// consultation gèlerait le travail des autres. Là, le bail se prend fiche par fiche, à la
// première écriture.
function annoncerMain(panneau, racine, chemin) {
  const refus = mainCoedition(panneau, racine, chemin, {});
  if (refus) { repondrePanneau(panneau, { type: 'erreur', message: refus.message }); }
  return refus;
}

// Les gestes sans session de saisie — déplacer un article, cocher « pas de DOI », geler le
// numéro : ils regardent le bail, ils n'en posent pas. Un clic isolé n'a pas de main à
// garder, et prendre un bail pour trois millisecondes ne protégerait personne.
// -> null quand la voie est libre, sinon le message à afficher.
function refusCoedition(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const titulaire = coedition.titulaireAutre(racine, chemin, moiCoedition());
  return titulaire ? T('coedition.geste.pris', [titulaire.utilisateur]) : null;
}

// Même garde, pour un geste qui touche tout le numéro (archiver, verrouiller) : personne ne
// doit être en train d'y écrire.
function refusCoeditionNumero(racine) {
  if (!racine) { return null; }
  const titulaires = coedition.titulairesDuNumero(racine, moiCoedition());
  return titulaires.length > 0 ? T('coedition.geste.pris', [titulaires[0].utilisateur]) : null;
}

// Panneau fermé : les baux sont rendus tout de suite, sans attendre les deux minutes. Un
// fichier qu'un autre panneau du même poste suit encore n'est pas rendu : deux fenêtres de
// la même personne partagent un seul fichier de bail.
function libererCoedition(panneau) {
  const suivi = suivisCoedition.get(panneau);
  if (!suivi) { return; }
  suivisCoedition.delete(panneau);
  for (const [clef, etat] of suivi) {
    let ailleurs = false;
    for (const autre of suivisCoedition.values()) {
      if (autre.has(clef)) { ailleurs = true; break; }
    }
    if (!ailleurs) { coedition.rendre(etat.racine, etat.chemin, moiCoedition()); }
  }
}

// ---- Copies en conflit et leur résolution bloc à bloc -> lib/cycle-vie.js --------
// avertirCopiesConflit, oublierCopiesSignalees, comparerConflit, resoudreBlocConflit,
// SCHEME_CONFLIT, fournisseurDiffConflit, cheminDepuisUriConflit, rafraichirConflitsScm,
// supprimerCopieConflit : tous importés plus haut.

// ---- Ordre du numéro, nom des articles, tâches, couverture ----------------------
//
// L'ordre des articles vit dans ausgabe.yaml (clé `ordre-articles`, lib/articles.js) et
// non dans les noms de dossier : déplacer un article ne renomme ni le dossier ni son .md,
// donc out/ reste valable et les liens du numéro tiennent. Il est relu à chaque appel —
// ausgabe.yaml fait quinze lignes — et réparé de ce que le disque dit, mais jamais réécrit
// au passage : réécrire à chaque rafraîchissement de l'arbre réveillerait le surveillant de
// fichiers en boucle. La clé n'est écrite que par un geste de l'utilisateur.

// ⚠ La clé suit le profil autant que le fichier : `ordre-articles` dans ausgabe.yaml,
//   `ordre-chapitres` dans buch.yaml. Lire la première sur un livre rendrait toujours la
//   chaîne vide, et l'arbre retomberait sur l'ordre alphabétique des dossiers — un ordre
//   plausible, donc un défaut qui ne se voit pas.
function valeurOrdreArticles(racine) {
  try {
    const cle = profilCourant().unites.ordre;
    return analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8'))[cle] || '';
  } catch (e) { return ''; }
}

// Les articles que la rédaction a cochés « pas de DOI ». Ils vivent dans le fichier du
// numéro, à côté de l'ordre, et c'est cette liste qui les range en fin de numéro : le rang
// décide du DOI, donc l'un ne peut pas se lire sans l'autre.
function slugsSansDoiVoulu(racine) {
  try {
    return analyserSansDoi(
      analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'))[CLE_SANS_DOI] || '');
  } catch (e) { return []; }
}

// Le jeu complet de ceux qui ne reçoivent pas de DOI : la case cochée, et la rubrique qui
// n'en reçoit jamais — Documentation sur l'instance réelle. Le second se lit dans le type
// de la fiche, d'où une lecture par article.
//
// C'est ce jeu, et lui seul, qui décide du compteur du DOI : le compteur ne compte que les
// porteurs, si bien qu'il reste contigu — 00, 01, 02… — quoi qu'on fasse des autres.
//
// `opts.types`  slug -> type déjà lu, pour ne pas relire les fiches que l'appelant a en main
// `opts.voulus` la liste des cases cochées à employer, au lieu de celle du fichier : c'est
//               ce qui permet de calculer le jeu d'après une bascule, avant de l'écrire.
function articlesSansDoi(racine, slugs, opts) {
  // ⚠ Un livre n'a pas de DOI par chapitre. Le DOI est une adresse d'article dans un
  //   numéro : l'ouvrage en reçoit un pour lui seul, pas un par chapitre. Rendre un jeu
  //   vide n'est donc pas une précaution, c'est la vérité du modèle — et c'est ce qui évite
  //   que refusDeplacement() invente une « frontière DOI » au milieu d'un sommaire de
  //   livre, refusant un déplacement avec un message qui ne voudrait rien dire.
  if (profilCourant().cle === 'livre') { return new Set(); }
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
    return normaliserRevue(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).revue);
  } catch (e) { return ''; }
}

// Le nom d'un article dans l'interface : « 03 · Titre », le titre venant de sa fiche. Sans
// fiche ou sans titre, le slug reprend sa place : l'article doit rester visible et
// repérable, jamais disparaître.
function nomArticle(racine, slug, index, langue) {
  return libelleArticle(index, slug, titreFiche(lireMetaArticle(racine, slug), langue));
}

// ---- Tâches d'un article : le sidecar <slug>.taches.yaml ------------------------
// Même partage que le suivi de traduction juste à côté : les intitulés sont un réglage de
// revue (config.json), l'état coché part avec l'article et n'est ni publié ni exporté.
function cheminTaches(racine, slug) {
  return path.join(racine, dossierUnites(), slug, slug + '.taches.yaml');
}

function lireTachesArticle(racine, slug) {
  try { return analyserTachesFaites(fs.readFileSync(cheminTaches(racine, slug), 'utf8')); }
  catch (e) { return analyserTachesFaites(''); }
}

// Supprimé quand il ne reste rien à retenir : un article dont on décoche tout ne laisse pas
// de résidu dans son dossier.
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

// ---- Couverture du numéro, et formulaire des métadonnées du numéro -> lib/metadonnees-hote.js

class FournisseurRevue {
  constructor() {
    this.racine = null;
    this.slugDeploye = null;       // article dont les assets sont dépliés
    // ⚠ Posé à null, et non à « articles » : la catégorie dépend du profil, qui n'est
    //   pas encore connu à la construction. definirRacine() l'ouvre ensuite.
    this.sectionDeployee = null;   // l'accordéon : la seule section ouverte, ou null
    this._changement = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._changement.event;
  }

  definirRacine(racine) {
    this.racine = racine;
    // La section des unités s'ouvre par défaut — « Articles » ou « Chapitres » selon
    // le profil, qui est arrêté au moment où la racine est posée.
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

  // L'accordéon des sections : une seule dépliée à la fois. La section active ne se
  // replie jamais par le clic sur son titre — seul le chevron replie (l'état null,
  // tout fermé, n'existe que par lui). true si l'état a changé — même contrat que
  // definirDeploye.
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
      // L'ordre suit le travail : les articles du numéro, leurs traductions, puis ce qui
      // attend encore d'y entrer. Une seule section dépliée à la fois (sectionDeployee) :
      // les compteurs en description disent le reste sans déplier.
      // ⚠ Pas de section « Traductions » pour un livre, et ce n'est pas un oubli. Une revue
      //   paraît en deux langues et chaque article a sa version jumelle ; un livre est écrit
      //   dans une langue, celle de son `lang:`, et sa traduction est un autre livre, avec
      //   son ISBN.
      const sections = [
        this._section(categorieUnites(), T(cleArbreUnites()), 'book', undefined)
      ];
      // ⚠ Pas de section « Actualité » pour un livre, pour la même raison que les
      //   traductions : la Documentation est une rubrique de revue (« Actualité et
      //   ressources » / « News & Ressourcen »), elle n'a pas d'équivalent dans un ouvrage.
      if (profilCourant().cle === 'revue') {
        // Le badge compte les blocs de la page de Documentation — ses fiches et ses
        // rubriques réunies — et non les articles : il n'y en a qu'un, et il ne se liste
        // plus dans l'arbre.
        const a = compterBlocsDocumentation(this.racine, this.slugDocumentation());
        sections.push(this._section('actualite', T('arbre.actualite'), 'megaphone',
          a > 0 ? '(' + a + ')' : undefined));
      }
      if (profilCourant().cle === 'revue') {
        sections.push(this._section('traductions', T('arbre.traductions'), 'globe',
          t.total > 0 ? '(' + t.finalises + '/' + t.total + ')' : undefined));
      }
      sections.push(
        this._section('word', T('arbre.word'), 'inbox', n > 0 ? '(' + n + ')' : undefined));
      // En dernier, sous « Word en attente » : ce n'est pas une étape du travail mais son
      // contrôle, et c'est là qu'on revient quand quelque chose cloche.
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

  // reveal() exige de savoir remonter d'un élément vers la racine. Seuls les articles sont
  // révélés (resélection après reconstruction — voir ouvrirArticle) : leur parent est
  // l'en-tête de leur section, tout le reste répond racine.
  //
  // ⚠ Un article de Documentation porte le même contextValue `article` que les autres — et
  //   c'est voulu : il garde ainsi, sans une ligne de package.json, tous les menus et tous
  //   les boutons inline d'un article (métadonnées, médias, ressources, réimport…). Le prix
  //   à payer est ici : le parent ne peut plus être déduit du seul contextValue, il faut
  //   relire le type. Sans cela, reveal() déplierait ARTICLES pour un article qui vit dans
  //   ACTUALITÉ, et l'accordéon refermerait la section sous les yeux du rédacteur.
  getParent(element) {
    if (!element || element.categorie) { return null; }
    if (element.contextValue === 'article') {
      return this.sectionDeSlug(element.slug);
    }
    return null;
  }

  // L'en-tête de la section où vit ce slug : « Actualité » pour un article de Documentation
  // d'une revue, la section des unités sinon. Un slug inconnu répond la section des unités,
  // qui est le cas ordinaire.
  sectionDeSlug(slug) {
    if (profilCourant().cle === 'revue' && this.estActualite(slug)) {
      return this._section('actualite', T('arbre.actualite'), 'megaphone', undefined);
    }
    return this._section(categorieUnites(), T(cleArbreUnites()), 'book', undefined);
  }

  // La catégorie d'accordéon à déplier pour ce slug — pendant de sectionDeSlug(), pour les
  // appelants qui n'ont besoin que du nom (focaliserUnite).
  categorieDeSlug(slug) {
    return (profilCourant().cle === 'revue' && this.estActualite(slug))
      ? 'actualite' : categorieUnites();
  }

  estActualite(slug) {
    if (!this.racine || !slug) { return false; }
    return lireMetaArticle(this.racine, slug).type === TYPE_ACTUALITE;
  }

  // Les unités du numéro réparties entre les deux sections, chacune avec son rang global.
  // Le rang est celui du numéro entier et non celui de la sous-liste : un article de
  // Documentation reste « 09 · … » dans la section Actualité, comme il l'est au sommaire et
  // dans le PDF. Filtrer sans garder le rang aurait renuméroté les deux sections à partir
  // de 01, et deux articles différents auraient porté le même numéro dans l'arbre.
  _repartirUnites() {
    if (!this.racine) { return { unites: [], actualite: [] }; }
    const revue = profilCourant().cle === 'revue';
    const unites = [], actualite = [];
    this.listerArticles().forEach((slug, index) => {
      const entree = { slug: slug, index: index };
      if (revue && this.estActualite(slug)) { actualite.push(entree); }
      else { unites.push(entree); }
    });
    return { unites: unites, actualite: actualite };
  }

  // L'élément d'un article, reconstruit à l'état courant : reveal() le retrouve par son id.
  // La page de Documentation n'en a pas — elle ne se liste plus dans l'arbre — et c'est
  // sans conséquence : reselectionnerArticle() ne fait rien d'un élément absent, et rien ne
  // reste à sélectionner puisque rien ne s'affiche.
  elementArticle(slug) {
    return this._itemsArticles().find((it) => it.slug === slug) || null;
  }

  // Cliquer l'en-tête déplie sa section — et replie les autres, c'est l'accordéon — et
  // ouvre sa vue d'ensemble (szh.ouvrirSection). L'en-tête déjà déplié ne se replie pas :
  // le clic n'ouvre alors que la vue, le repli passe par le chevron. Le clic droit est
  // l'autre chemin vers la même vue ; l'en-tête ne porte pas de bouton pour ça.
  _section(categorie, libelle, icone, description) {
    const ouverte = this.sectionDeployee === categorie;
    const it = new vscode.TreeItem(libelle, ouverte
      ? vscode.TreeItemCollapsibleState.Expanded
      : vscode.TreeItemCollapsibleState.Collapsed);
    it.categorie = categorie;
    // VS Code mémorise le pli d'un élément qu'il reconnaît et ignore alors le
    // collapsibleState renvoyé : l'id porte donc l'état voulu — quand il change,
    // l'élément est recréé et l'état s'applique. Même astuce que les articles dépliés.
    it.id = 'section:' + categorie + ':' + (ouverte ? 'ouvert' : 'ferme');
    it.iconPath = new vscode.ThemeIcon(icone, COULEURS_SECTION[categorie]
      ? new vscode.ThemeColor(COULEURS_SECTION[categorie]) : undefined);
    it.contextValue = 'section-' + categorie;   // 'section-articles', 'section-word'…
    if (description) { it.description = description; }
    it.command = { command: 'szh.ouvrirSection', title: libelle, arguments: [categorie] };
    return it;
  }

  // Article = dossier articles/<slug>/ avec le .md homonyme, comme dans le Makefile.
  // L'ordre est celui du numéro (ausgabe.yaml) et non celui des noms de dossier ; le
  // libellé est le titre de la fiche précédé de son rang à deux chiffres, et le slug passe
  // en description — c'est le nom du dossier, ce n'est pas le nom de l'article.
  _itemsArticles() {
    return this._itemsUnites(this._repartirUnites().unites,
      'arbre.vide.' + profilCourant().unites.dossier);
  }

  // La section « Actualité » : la réserve, et rien d'autre.
  //
  // La page de Documentation ne s'y liste plus : cliquer l'en-tête ouvre directement le
  // formulaire de la page, qui se crée au besoin (ouvrirPageDocumentation). Un article de
  // plus dans l'arbre, dont le .md ne s'ouvre jamais à la main, n'aurait donné qu'un détour.
  //
  // La réserve, elle, reste : c'est le magasin de fiches partagé entre les numéros et entre
  // les deux revues, et il faut pouvoir l'ouvrir avant même que la page qui recevra ses
  // fiches n'existe.
  _itemsActualite() {
    return [this._itemReserve()];
  }

  // Le slug de la page de Documentation du numéro : la première unité de type
  // `documentation` dans l'ordre du sommaire, ou null s'il n'y en a pas encore.
  slugDocumentation() {
    const entrees = this._repartirUnites().actualite;
    return entrees.length > 0 ? entrees[0].slug : null;
  }

  // Le raccourci vers « À corriger », sous « Word en attente » : la vue vivait derrière un
  // compteur de barre d'état que personne ne regarde et une entrée du panneau Commande.
  // Une ligne de l'arbre, elle, est là en permanence — et son icône dit d'un coup d'oeil
  // s'il y a un blocage (rouge), un point à vérifier (ambre), ou rien (gris).
  _itemControles() {
    const r = resumeJournal(constatsCourants(this.racine));
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

  _itemReserve() {
    const n = compterReserve(this.racine);
    const it = new vscode.TreeItem(T('arbre.reserve'), vscode.TreeItemCollapsibleState.None);
    it.id = 'reserve';
    it.contextValue = 'reserve';
    it.iconPath = new vscode.ThemeIcon('archive');
    if (n > 0) { it.description = '(' + n + ')'; }
    it.tooltip = T('arbre.reserve.tooltip');
    it.command = { command: 'szh.reserve', title: T('arbre.reserve'), arguments: [] };
    return it;
  }

  // `entrees` = [{ slug, index }], le rang étant celui du numéro entier (_repartirUnites).
  _itemsUnites(entrees, cleVide) {
    const base = path.join(this.racine, dossierUnites());
    if (entrees.length === 0) { return [this._vide(T(cleVide))]; }
    const auto = replierAssetsAutres();
    const langue = langueRevue(this.racine);
    const taches = tachesDuNumero(this.racine);
    return entrees.map((entree) => {
      const slug = entree.slug, index = entree.index;
      const md = vscode.Uri.file(path.join(base, slug, slug + '.md'));
      // Seuls les tableaux se déplient sous l'article : les images se gèrent dans le
      // formulaire « Médias de cet article », qui les montre avec leurs légendes, leurs
      // crédits et leur verdict de qualité.
      // Ce qui rend un article dépliable : ses tableaux, ou sa bibliographie. Compter les
      // seuls tableaux laissait l'entrée de bibliographie inatteignable sur un article qui
      // n'a pas de tableau — c'est-à-dire sur la plupart.
      const aDesAssets = this._tablesArticle(slug).length > 0
        || fs.existsSync(cheminBiblio(this.racine, slug, dossierUnites()));
      const deploye = auto && aDesAssets && slug === this.slugDeploye;
      const nom = nomArticle(this.racine, slug, index, langue);
      const it = new vscode.TreeItem(nom, !aDesAssets
        ? vscode.TreeItemCollapsibleState.None
        : (deploye ? vscode.TreeItemCollapsibleState.Expanded
                   : vscode.TreeItemCollapsibleState.Collapsed));
      // VS Code mémorise l'état plié/déplié d'un élément qu'il reconnaît et ignore alors
      // le collapsibleState renvoyé : quand le réglage pilote le dépliage, l'`id` porte
      // l'état voulu, il change, l'élément est recréé. Sans le réglage, id stable :
      // l'utilisateur décide. Un id dans tous les cas — reveal() retrouve l'élément par lui.
      it.id = auto && aDesAssets
        ? 'article:' + slug + ':' + (deploye ? 'ouvert' : 'ferme')
        : 'article:' + slug;
      it.slug = slug;                   // lu par les actions de l'arbre
      it.resourceUri = md;              // décorations du thème (git, problèmes)
      // Le slug d'abord : c'est par lui qu'on retrouve le dossier. L'avancement des tâches
      // se lit à côté, sans avoir à ouvrir la vue.
      const avance = avancementTaches(this.racine, slug, taches);
      it.description = avance.total > 0
        ? slug + ' · ' + T('art.taches.avancement', [avance.faites, avance.total])
        : slug;
      // L'icône redit l'avancement en couleur : elle prime sur l'icône de fichier du
      // thème, qui était la même pour tous les articles et ne distinguait rien.
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
    const base = path.join(this.racine, dossierUnites(), slug, 'media');
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
    const base = path.join(this.racine, dossierUnites(), slug, 'tables');
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile() && /\.html?$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  // Ce que l'article porte à part de son texte : ses tableaux, et sa bibliographie. Aucune
  // description sur ces entrées — ni poids, ni compteur : la colonne reste vide, et ce qui
  // s'y affichera un jour aura donc du sens.
  _itemsTables(slug) {
    const baseTables = path.join(this.racine, dossierUnites(), slug, 'tables');
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

  // La bibliographie, éditable comme un tableau — mais en texte : c'est de la prose, une
  // référence par paragraphe, que le rédacteur colle depuis Zotero ou depuis un autre
  // article. Un éditeur structuré se battrait contre ce geste-là ; le texte est la bonne
  // surface, et c'est déjà celle de l'article.
  //
  // Colonne 1, comme le .md : « Beside » est relatif à la vue active et empile les colonnes,
  // et la colonne 2 appartient à l'aperçu. L'onglet s'ouvre donc à côté de l'article, pas à
  // sa place, et sans chasser l'aperçu.
  //
  // Pas de fichier : pas d'entrée. Un article sans bibliographie n'a rien à montrer — une
  // entrée morte ferait croire à une liste vide, ce qui n'est pas la même chose.
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
      command: 'vscode.open', title: T('arbre.biblio'),
      arguments: [vscode.Uri.file(chemin), { viewColumn: vscode.ViewColumn.One }]
    };
    return it;
  }

  // articles-word/*.docx (chapitres-word/ pour un livre) à la racine du dossier, donc
  // sans _convertis/ — le nom du dépôt suit le profil actif (lib/profil.js).
  _itemsWord() {
    const noms = this._docxEnAttente(path.join(this.racine, profilCourant().depot));
    if (noms.length === 0) { return [this._vide(T('arbre.vide.word'))]; }
    return noms.map((nom) => {
      const it = new vscode.TreeItem(nom, vscode.TreeItemCollapsibleState.None);
      it.contextValue = 'word';
      // « 4_Titre.docx » -> « titre » : le numéro de tête est retiré du slug, même
      // règle que la cible d'import du Makefile — voir lib/slug.js:slugifierArticle().
      if (this._articleExiste(slugifierArticle(nom))) {
        // Le .md cible existe déjà : l'import l'ignorera, il n'écrase rien. C'est le
        // redépôt d'un Word corrigé, et le clic droit doit mener au geste qui le publie —
        // d'où un contextValue à part, et le nom du fichier porté par l'item.
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
    const slugs = this.listerArticles();
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.traductions'))]; }
    const source = langueRevue(this.racine);
    return slugs.map((slug, index) => {
      const etat = etatTraduction(this.racine, slug, source);
      const rien = etat.lignes.length === 0;
      // Le même nom que dans la section « Articles » : un article se reconnaît partout à
      // son titre et à son rang, jamais à son slug tronqué. La fiche vient d'etatTraduction,
      // qui l'a déjà lue.
      const it = new vscode.TreeItem(
        libelleArticle(index, slug, titreFiche(etat.meta, source)), rien
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
    for (const slug of this._sousDossiersAvecMd(path.join(this.racine, dossierUnites()))) {
      const r = etatTraduction(this.racine, slug, source).resume;
      total += r.total;
      finalises += r.finalises;
    }
    return { total: total, finalises: finalises };
  }

  // L'ordre du numéro, réparé de ce que le disque dit : un article ajouté à la main
  // apparaît à la fin, un article effacé quitte l'ordre, et rien n'est réécrit au passage.
  //
  // Puis la règle du DOI par-dessus : les articles qui n'en reçoivent pas passent à la fin,
  // pour que le numéro d'ordre du DOI suive l'ordre de lecture. Le tri est appliqué ici,
  // sur l'unique source d'ordre du cockpit, et non dans la vue : l'arbre, les vues et les
  // boutons de déplacement doivent tous voir le même sommaire, sans quoi un article
  // porterait deux rangs selon l'endroit où on le regarde.
  listerArticles() {
    if (!this.racine) { return []; }
    const slugs = this._sousDossiersAvecMd(path.join(this.racine, dossierUnites()));
    return ordonnerArticles(valeurOrdreArticles(this.racine), slugs,
      articlesSansDoi(this.racine, slugs)).slugs;
  }

  _articleExiste(slug) {
    try { return fs.statSync(path.join(this.racine, dossierUnites(), slug, slug + '.md')).isFile(); }
    catch (e) { return false; }
  }

  _sousDossiersAvecMd(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((slug) => {
        try { return fs.statSync(path.join(base, slug, slug + '.md')).isFile(); }
        catch (e) { return false; }
      })
      .sort((a, b) => a.localeCompare(b, 'fr'));
  }

  _docxEnAttente(base) {
    let entrees;
    try { entrees = fs.readdirSync(base, { withFileTypes: true }); }
    catch (e) { return []; }
    return entrees
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.docx'))
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
// Un chapitre s'aperçoit comme un article, dans la colonne de droite. Le livre, lui, n'a de
// sens qu'entier : la pagination, les ouvertures sur belle page, le sommaire et ses numéros
// de page n'existent qu'une fois tous les chapitres assemblés. C'est donc le PDF composé
// qu'on ouvre — le même fichier qui part chez l'imprimeur, pas une approximation.
//
// ⚠ Si le PDF n'a jamais été compilé, on le dit et on propose de compiler, plutôt que
//   d'ouvrir un onglet vide : « rien ne s'est passé » est le pire des retours.
async function ouvrirApercuLivre(fournisseur) {
  const racine = fournisseur && fournisseur.racine;
  if (!racine) { return; }
  const nom = path.basename(racine);
  const pdf = path.join(racine, 'out', nom + '.pdf');
  if (!fs.existsSync(pdf)) {
    const compiler = T('livre.apercu.compiler');
    const choix = await vscode.window.showInformationMessage(
      T('livre.apercu.absent'), compiler);
    if (choix === compiler) { await lancerBuild(); }
    return;
  }
  await ouvrirApercuPdf(vscode.Uri.file(pdf));
}

// Ferme les onglets dont l'entrée satisfait le prédicat ; les `TabInput` sont typés en
// canard, d'où les gardes chez les appelants.
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
//
// Fermer l'aperçu, les formulaires et les onglets ne suffit pas toujours : OneDrive en
// pleine synchronisation, l'indexeur ou le lecteur de PDF gardent la poignée quelques
// secondes de plus, et l'effacement échoue sur un EPERM alors que plus rien ne s'y
// oppose vraiment. On insiste donc, comme archive-revue.ps1 le fait pour le déplacement
// du numéro, plutôt que de renvoyer à un geste qui passerait tout seul dix secondes
// plus tard. Les autres codes (chemin introuvable, disque plein) ne s'arrangeront pas
// avec le temps : ils ressortent tout de suite.
const VERROUS_PASSAGERS = new Set(['EPERM', 'EACCES', 'EBUSY', 'ENOTEMPTY']);
const REPRISES_SUPPRESSION = [200, 500, 1000, 2000, 2000, 2000, 2000];   // ~10 s en tout

function attendre(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// -> null quand le chemin est parti (ou n'existait déjà plus), sinon le message du
// dernier échec, prêt à être montré.
async function supprimerAvecReprises(chemin) {
  for (let essai = 0; ; essai++) {
    try {
      fs.rmSync(chemin, { recursive: true, force: true });
      return null;
    } catch (e) {
      if (essai >= REPRISES_SUPPRESSION.length || !VERROUS_PASSAGERS.has(e.code)) {
        return String((e && e.message) || e);
      }
      // Dix secondes d'attente muette passeraient pour un blocage.
      vscode.window.setStatusBarMessage(
        T('statut.suppression.reprise', [path.basename(chemin)]), 3000);
      await attendre(REPRISES_SUPPRESSION[essai]);
    }
  }
}

// Dernier filet, silencieux : le verrou d'un synchroniseur tombe parfois bien après le
// geste. On revient une minute plus tard sur ce qui a résisté, sans un mot — le message
// d'erreur est déjà parti, et il n'y a rien à faire de cette seconde chance. Sans elle,
// un article à moitié effacé n'a plus d'entrée dans l'arbre (il n'a plus de .md) : ni
// son dossier ni ses documents produits ne sont plus atteignables par aucun geste.
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

// Nombre de tâches suivies (build/export/import/docx, ou tâche « szh ») actuellement en
// vol, du point de vue des trois gestionnaires globaux posés dans activate(). Ctrl+S et
// triggerTaskOnSave ne passent par aucune fonction du cockpit : sans ce compteur, la fin
// d'une tâche suivie remettrait session.buildEnCours() à faux même si une autre tâche suivie tourne
// encore. Les fonctions du cockpit qui posent session.buildEnCours() elles-mêmes autour d'un
// lancerTache (toutExporter, exporterArticle…) restent inchangées : ce compteur ne fait
// que rendre les trois gestionnaires globaux cohérents entre eux.

// Au-delà de ce délai, une tâche lancée par le cockpit est considérée comme perdue
// (interrompue, wsl.exe absent) : mieux vaut rendre la main que laisser session.buildEnCours()
// bloqué jusqu'au rechargement de la fenêtre.
const DELAI_GARDE_TACHE = 30 * 60 * 1000;   // 30 minutes

// Attend la fin d'une exécution précise (celle rendue par executeTask()) et résout avec
// son code de sortie. Deux replis, pour ne jamais rester en attente indéfiniment :
//   - onDidEndTask, si onDidEndTaskProcess ne vient jamais (résout null, sans code connu) ;
//   - le délai de garde ci-dessus, qui résout null sans laisser d'autre trace.
// Les trois abonnements sont détruits dans tous les cas de sortie.
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
  const execution = await vscode.tasks.executeTask(tache);
  return await attendreFinTache(execution);
}

function lancerBuild() { return lancerTache(NOM_TACHE_BUILD); }

// Une tâche s'est terminée en échec. Si le journal porte un point bloquant, la vue des
// contrôles vient de le nommer et de dire quoi faire : ce message-ci n'ajouterait rien et
// masquerait le précis par le vague. Il ne sort donc que sur un échec muet.
function avertirEchecCompilation(cle, args) {
  if (resumeJournal(dernierJournal.constats).bloquants > 0) { return; }
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
    // La maquette lit dois-calcules.yaml pendant la compilation, et il n'est plus réécrit à
    // chaque rafraîchissement : recompiler tout est le bon moment pour s'assurer qu'il est
    // là et à jour. L'écriture ne se fait qu'au changement.
    ecrireDoisCalcules(fournisseur);
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
    const resultat = genererExportOjs(racine);     // synchrone, quelques secondes
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
    // Les points bloquants deviennent des cartes dans « À corriger » : la notification
    // n'a plus à les porter tous, elle dit combien et où les lire. Ce qui ne vient pas de
    // la collecte (une panne, un disque) garde son message en clair, faute de liste.
    const liste = (e && e.szhBloquants) || [];
    if (liste.length > 0) {
      poserConstatsExport(racine, liste, (e && e.szhBloquantsConfig) || 0);
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

// ---- Sorties du livre (imprimeur, couverture, EPUB, HTML web) --------------------
// Quatre cibles make sans équivalent côté revue (pipeline/profils/livre.mk), chacune sa
// propre tâche utilisateur (vscodium-user/tasks.json) : pas d'import, pas de clean, juste
// la sortie demandée. Refusée pendant une autre compilation, comme le reste de la chaîne.
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

const CLES_LIVRE_IMPRIMEUR = { statut: 'livre.imprimeur.statut', fait: 'livre.imprimeur.fait', err: 'livre.imprimeur.err' };
const CLES_LIVRE_COUVERTURE = { statut: 'livre.couverture.statut', fait: 'livre.couverture.fait', err: 'livre.couverture.err' };
const CLES_LIVRE_EPUB = { statut: 'livre.epub.statut', fait: 'livre.epub.fait', err: 'livre.epub.err' };
const CLES_LIVRE_WEB = { statut: 'livre.web.statut', fait: 'livre.web.fait', err: 'livre.web.err' };

// ---- Export d'un seul article ----------------------------------------------------
// Sur un numéro gelé, seul ce geste régénère un document. La tâche vise le PDF et
// l'aperçu HTML, sans clean ni import, qui supprimerait le .docx source.
// `-j2 -O` comme les tâches de vscodium-user/tasks.json, et ici même sur un seul article :
// les deux cibles ne dépendent pas l'une de l'autre — le .pdf descend du .html, l'aperçu est
// une passe pandoc séparée. Sans `-j`, la seconde attendait la fin de la première alors que
// le poste a deux cœurs à donner (%UserProfile%\.wslconfig, `processors=2`).
// `-O` va avec `-j` : voir tasks.json pour ce qu'un journal entrelacé coûterait à lib/journal.js.
function tacheMakeArticle(racine, slug) {
  const cibles = ['out/' + slug + '/' + slug + '.pdf', 'out/' + slug + '/' + slug + '.apercu.html'];
  const execution = new vscode.ProcessExecution('wsl.exe',
    ['-d', DISTRO_WSL, '--cd', racine, '--', 'make', '-j2', '-O', '-f', MAKEFILE_WSL].concat(cibles));
  const tache = new vscode.Task(
    { type: 'szh', cible: 'article', slug: slug }, vscode.TaskScope.Workspace,
    T('tache.exportArticle') + ' — ' + slug, 'SZH', execution, []);
  tache.presentationOptions = {
    reveal: vscode.TaskRevealKind.Silent, showReuseMessage: false,
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
}

// ---- Archiver, verrouiller, désarchiver -> lib/cycle-vie.js ---------------------
// poidsLisible, fermerFormulairesEcriture, verrouillerSeulement, archiverEtVerrouiller,
// desarchiver, deverrouiller : tous importés plus haut.

// ---- Clic sur un article = aperçu direct -----------------------------------------


// ---- Aperçu commutable HTML / PDF -> lib/apercu.js -----------------------------
// fermerApercuCourant, lireProfil, modeApercu, editeurArticleCourant, le défilement
// synchroniseur, injecterApercu, ouvrirApercuHtml, rechargerApercuHtmlSiChange,
// basculerApercu, fermerApercuHtml, fermerTousLesApercus : tous importés plus haut.


// Slug de l'article d'un chemin, ou null : un article est un
// <racine>/articles/<slug>/<slug>.md. Même test que szh-apercu.
function slugDepuisChemin(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const parties = path.relative(racine, chemin).split(path.sep);
  if (parties.length !== 3 || parties[0] !== dossierUnites()) { return null; }
  return parties[2] === parties[1] + '.md' ? parties[1] : null;
}

// ---- Le marqueur de l'article ouvert ---------------------------------------------
//
// La sélection native de l'arbre pâlit dès que le focus retourne à l'éditeur — donc
// immédiatement. Le point marque, lui, le .md de l'article auquel appartient le fichier
// actif (texte, mais aussi bibliographie ou tableau) : il survit aux reconstructions de
// l'arbre, colore la ligne (resourceUri) et l'onglet. Il s'éteint quand le fichier actif
// sort des articles ; il reste quand le focus va à un aperçu ou à un panneau (plus
// d'éditeur actif) : l'article, lui, est toujours là.
let vueArbre = null;                     // la TreeView, posée par activate()
let uriArticleOuvert = null;             // le .md marqué, ou null
const changementDecoration = new vscode.EventEmitter();

// Slug du dossier d'article qui contient `chemin` — plus large que slugDepuisChemin :
// la bibliographie et les tableaux disent aussi « on travaille sur cet article ».
function slugArticleContenant(racine, chemin) {
  if (!racine || !chemin) { return null; }
  const parties = path.relative(racine, chemin).split(path.sep);
  if (parties.length < 3 || parties[0] !== dossierUnites()) { return null; }
  const slug = parties[1];
  try {
    return fs.statSync(path.join(racine, dossierUnites(), slug, slug + '.md')).isFile()
      ? slug : null;
  } catch (e) { return null; }
}

function majArticleOuvert(fournisseur, chemin) {
  const slug = slugArticleContenant(fournisseur.racine, chemin);
  const uri = slug
    ? vscode.Uri.file(path.join(fournisseur.racine, dossierUnites(), slug, slug + '.md'))
    : null;
  const avant = uriArticleOuvert;
  if ((avant && avant.fsPath) === (uri && uri.fsPath)) { return; }
  uriArticleOuvert = uri;
  // Les deux fichiers changent d'état : l'ancien perd son point, le nouveau le gagne.
  const touches = [avant, uri].filter(Boolean);
  if (touches.length > 0) { changementDecoration.fire(touches); }
  majBadgePdfUa(fournisseur);
}

// La reconstruction de l'arbre remplace l'élément sélectionné (son id encode l'état
// déplié) et la sélection s'éteignait — le « premier clic qui ne tient pas ». On
// resélectionne l'élément recréé, sans focus (le rédacteur écrit) et sans rouvrir une
// barre latérale masquée.
function reselectionnerArticle(fournisseur, slug) {
  if (!vueArbre || !vueArbre.visible) { return; }
  const element = fournisseur.elementArticle(slug);
  if (!element) { return; }
  Promise.resolve(vueArbre.reveal(element, { select: true, focus: false }))
    .catch(() => { /* arbre en pleine reconstruction : la sélection suivra au prochain clic */ });
}

// Le clic sur l'édition des métadonnées ou des médias d'une unité — article ou chapitre —
// donne le focus à l'arbre, comme le suivi de ouvrirArticle (déplie ses assets, ouvre la
// section qui la contient, la resélectionne), mais sans ouvrir son .md ni
// son aperçu : ces deux formulaires pleine page ferment déjà l'aperçu de leur côté, et
// ouvrir le texte par-dessus leur webview n'aurait pas de sens. Pas de focus clavier non
// plus : le formulaire qui vient de s'ouvrir garde la main.
function focaliserUnite(fournisseur, slug) {
  let arbreChange = fournisseur.definirDeploye(slug);
  // La section à déplier est celle où l'article vit : ACTUALITÉ pour une page de
  // Documentation, la section des unités sinon. Déplier ARTICLES aurait refermé ACTUALITÉ
  // (l'accordéon n'ouvre qu'une section) juste après un clic dedans.
  arbreChange = fournisseur.definirSectionDeployee(fournisseur.categorieDeSlug(slug)) || arbreChange;
  if (arbreChange) { fournisseur.rafraichir(); }
  reselectionnerArticle(fournisseur, slug);
}

// Au démarrage, si l'éditeur actif est déjà un article, enchaîner ce que fait un clic
// dans la barre latérale. Ici et non dans le lanceur PowerShell : un make lancé depuis
// Windows concurrencerait `triggerTaskOnSave`, et le Makefile n'a pas de verrou.
async function ouvrirArticleActifAuDemarrage(fournisseur) {
  const editeur = vscode.window.activeTextEditor;
  if (!editeur) { return; }
  const slug = slugDepuisChemin(fournisseur.racine, editeur.document.uri.fsPath);
  if (!slug) { return; }                            // pas un article : ne rien forcer
  try { await ouvrirArticle(fournisseur, slug); }
  catch (e) { /* au démarrage, ne pas bloquer l'ouverture de la revue */ }
}

// .md en colonne 1 ; compilation incrémentale si l'aperçu du mode courant est absent ou
// plus vieux que ses sources ; aperçu en colonne 2, à la place du précédent. Une
// compilation en échec ne montre pas d'aperçu périmé, `opts.sansTexte` laisse la
// colonne 1 au panneau qui l'occupe, et `opts.sansApercu` s'arrête au .md : ni aperçu,
// ni compilation (vue d'ensemble Articles — voir le commentaire plus bas).
async function ouvrirArticle(fournisseur, slug, opts) {
  const racine = fournisseur.racine;
  if (!racine || typeof slug !== 'string' || slug === '') { return; }
  const md = path.join(racine, dossierUnites(), slug, slug + '.md');
  // Avant l'ouverture du .md et la compilation, pour que l'arbre suive le clic : les
  // assets de l'article se déplient, la section « Articles » s'ouvre (accordéon), et
  // l'élément — recréé par la reconstruction, son id encode l'état — est resélectionné.
  // `sansTexte` (suivi de traduction en colonne 1) laisse l'arbre en paix : le rédacteur
  // travaille dans une autre section. Le point de l'article ouvert suit dans tous les cas.
  const suivreArbre = !(opts && opts.sansTexte);
  let arbreChange = fournisseur.definirDeploye(slug);
  if (suivreArbre) { arbreChange = fournisseur.definirSectionDeployee(categorieUnites()) || arbreChange; }
  if (arbreChange) { fournisseur.rafraichir(); }
  if (suivreArbre) { reselectionnerArticle(fournisseur, slug); }
  majArticleOuvert(fournisseur, md);
  // Un livre n'a qu'un PDF, celui du volume entier — jamais un par chapitre (lib/profil.js).
  const pdf = vscode.Uri.file(profilCourant().cle === 'livre'
    ? profils.pdfLivre(racine)
    : path.join(racine, 'out', slug, slug + '.pdf'));
  const modeCourant = modeApercu();
  // Un PDF à jour ne dit rien du HTML d'aperçu : on juge celui du mode courant.
  const apercuAttendu = modeCourant === 'html' ? cheminApercuHtml(racine, slug) : pdf.fsPath;

  if (!(opts && opts.sansTexte)) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md), { viewColumn: vscode.ViewColumn.One });
  }

  // Depuis la vue d'ensemble Articles, on vient lire ou corriger le texte, pas mettre en
  // page — le .md suffit, pas d'aperçu en colonne 2.
  // La compilation d'obsolescence est sautée aussi : compiler pour un aperçu qu'on
  // n'affiche pas surprendrait (barre d'état « compilation de… », journal relu en fin de
  // tâche), et rien d'autre n'en dépend ici — l'enregistrement du .md recompile de toute
  // façon via triggerTaskOnSave. Un panneau d'aperçu déjà ouvert continue, lui, de se
  // rafraîchir par le watcher out/** (rechargerApercuHtmlSiChange) — comportement voulu.
  if (opts && opts.sansApercu) { return; }

  // Obsolète = plus ancien que le .md, un tableau extrait ou la fiche .meta.yaml ; même
  // graphe de dépendances que la règle HTML du Makefile.
  let obsolete = true;
  try {
    let mSource = fs.statSync(md).mtimeMs;
    const dossierTables = path.join(racine, dossierUnites(), slug, 'tables');
    let tables = [];
    try { tables = fs.readdirSync(dossierTables); } catch (e) { /* pas de tableaux */ }
    for (const t of tables) {
      if (!/\.html?$/i.test(t)) { continue; }
      try { mSource = Math.max(mSource, fs.statSync(path.join(dossierTables, t)).mtimeMs); }
      catch (e) { /* fichier disparu entre-temps */ }
    }
    try { mSource = Math.max(mSource, fs.statSync(cheminMeta(racine, slug)).mtimeMs); }
    catch (e) { /* pas de fiche */ }
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
    try {
      const code = await lancerBuild();
      if (code === null) { return; }               // tâche introuvable, déjà signalé
      if (code !== 0) {
        avertirEchecCompilation('err.build');
        return;
      }
    } finally {
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
// `opts.sansAffichage` : la compilation part, mais son résultat ne rouvre aucun aperçu —
// pour l'enregistrement des métadonnées, qui doit recompiler en tâche de fond sans jamais
// rouvrir ce que focaliserUnite vient de fermer (aperçu HTML ou PDF).
function relancerCompilation(fournisseur, slug, opts) {
  compilerPuisAfficher(fournisseur, slug, opts).catch(() => { /* signalé côté build */ });
}

// L'aperçu manque encore : une seule passe est relancée en tâche de fond, sans boucler.
// Chemin unique de compilation d'un article : ouvrirArticle (aperçu périmé ou manquant) et
// l'enregistrement des métadonnées passent tous deux par ici, sous la même garde
// `session.buildEnCours()` — jamais deux compilations à la fois, quel que soit le déclencheur.
async function compilerPuisAfficher(fournisseur, slug, opts) {
  if (session.buildEnCours() || session.importEnCours()) {
    // Un refus dû à l'import ne doit jamais s'escamoter en silence (enregistrer une fiche
    // pendant un import qui ne ramène finalement rien laisserait l'aperçu et le PDF périmés
    // sans qu'aucune compilation ne reparte) : on garde de quoi rejouer l'appel tel quel,
    // rejoué par rejouerCompilationsDifferees() dès qu'session.importEnCours() retombe. Un refus dû à
    // session.buildEnCours() seul n'est pas concerné : une compilation est déjà en vol pour ce numéro,
    // celle-ci lui succédera naturellement au prochain déclenchement (ouvrirArticle, l'enregistrement des métadonnées…).
    if (session.importEnCours()) { compilationsDifferees.set(slug, { fournisseur: fournisseur, opts: opts }); }
    return;
  }
  if (compilationAutoCoupee()) { return; }         // pas de compilation implicite

  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.build.de', [slug]));
  let code = null;
  try {
    code = await lancerBuild();
  } finally {
    statut.dispose();
    session.poserBuildEnCours(false);
  }
  if (code === null) { return; }                   // tâche introuvable, déjà signalé
  if (code !== 0) { avertirEchecCompilation('err.build'); return; }
  // Rien à afficher : un formulaire pleine page (métadonnées) occupe l'écran et l'aperçu
  // a été fermé exprès — le rouvrir ici volerait le focus que focaliserUnite vient de
  // donner à l'arbre. Ni webview.html réassigné ni panneau PDF rouvert : la garde
  // d'interaction (differer, lib/interaction.js) n'a donc rien à protéger sur ce chemin.
  if (opts && opts.sansAffichage) { return; }
  if (session.apercuCourantSlug() !== slug || !fournisseur.racine) { return; }   // article changé entre-temps
  if (modeApercu() === 'html') {
    if (session.panneauApercuHtml()) { ouvrirApercuHtml(fournisseur, slug); }
    return;
  }
  // Un livre n'a qu'un PDF, celui du volume entier — jamais un par chapitre.
  const pdf = vscode.Uri.file(profilCourant().cle === 'livre'
    ? profils.pdfLivre(fournisseur.racine)
    : path.join(fournisseur.racine, 'out', slug, slug + '.pdf'));
  if (!fs.existsSync(pdf.fsPath)) { return; }
  await fermerApercuCourant(pdf);
  await ouvrirApercuPdf(pdf);
  session.poserApercuCourantUri(pdf);
}

// ---- Import guidé ----------------------------------------------------------------


// Slugs refusés par compilerPuisAfficher pendant qu'session.importEnCours() était posé (import guidé
// OU réimport, executerReimport() plus bas — même drapeau, même trou) : une seule entrée par
// slug, la dernière demande gagne — trois enregistrements pendant l'import ne doivent
// rejouer qu'une compilation par article, comme le fait déjà session.buildEnCours() pour deux fiches
// enregistrées d'un coup (voir le commentaire de compilerPuisAfficher).
const compilationsDifferees = new Map();

// Rejoue, en tâche de fond, les compilations que compilerPuisAfficher a dû décliner pendant
// la fenêtre session.importEnCours() — à appeler juste après avoir reposé ce drapeau à false, quel
// qu'ait été le résultat de l'import (échec, zéro article ramené, ou succès) : c'est
// précisément le cas « zéro article » qui ne passe par aucun autre chemin de recompilation
// (compilerApresImport() n'est appelée que si nouveaux.length > 0, plus bas). Un travail
// refusé doit être rejoué, jamais juste tu.
function rejouerCompilationsDifferees() {
  if (compilationsDifferees.size === 0) { return; }
  const aRejouer = Array.from(compilationsDifferees.entries());
  compilationsDifferees.clear();
  for (const [slug, args] of aRejouer) { relancerCompilation(args.fournisseur, slug, args.opts); }
}

// ---- Import guidé -> lib/import-hote.js -----------------------------------------
// compilerApresImport, numerosOrdreEnAttente, resoudreNumeroOrdre,
// ecrireOrdreNouveauxArticles, lancerConversion, importerFichiersWord, importerWord,
// controleurDepotVue : tous importés plus haut.


// ---- Réimporter un article corrigé ----------------------------------------------
//
// L'auteur renvoie son Word corrigé. Jusqu'ici il fallait renommer le fichier, réimporter,
// puis recopier à la main la fiche, les portraits et les traductions du doublon vers
// l'original — et le message de l'import promettait un bouton qui n'existait pas.
//
// pipeline/reimporter.py fait tout le travail, et il est le seul à le faire : rien de sa
// logique n'est redit ici. Ce qui vit ici, et rien d'autre :
//
//   * la confirmation, parce que le geste remplace le travail de quelqu'un ;
//   * la lecture de sa réponse — une ligne JSON — et le ton qui va avec ;
//   * la recompilation de l'article, sans laquelle l'aperçu et le PDF montreraient encore
//     l'ancien texte ;
//   * le retour en arrière, atteignable d'un clic.
//
// C'est aussi le seul maillon que le cockpit lance sans passer par une tâche : une tâche
// ne rapporte que son code de retour, et il faut ici lire la réponse.

// Large : le premier appel paie le réveil de la machine du pipeline, et la conversion d'un
// Word illustré prend son temps. Au-delà, on rend la main plutôt que de laisser le
// rédacteur devant une barre d'état qui ne bouge plus.
const REIMPORT_DELAI = 600000;

// -> Promise<{ json, code, erreur }>. `json` est la ligne de résultat, ou null : un appel
// mal formé et une machine absente n'en produisent pas, et l'appelant le dit autrement.
// Ne rejette jamais : les cinq issues se lisent dans le retour, pas dans une exception.
function lancerReimporter(racine, args) {
  const argv = ['-d', DISTRO_WSL, '--cd', racine, '--', 'python3', REIMPORTER_WSL]
    .concat(args || []);
  return reveillerWsl().then(() => new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cheminWsl(), argv,
        { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
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
      // Une seule ligne JSON, et elle est la dernière : tout le reste part sur la sortie
      // d'erreur, que l'on ne lit pas — elle va déjà dans le journal d'import.
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

// L'article dont la fiche dit venir de ce document Word. '' si aucun, ou si plusieurs :
// deviner à la place du rédacteur est exactement ce que le script refuse de faire.
function articleDuWord(fournisseur, nom) {
  const cherche = String(nom || '').toLowerCase();
  const trouves = [];
  for (const slug of fournisseur.listerArticles()) {
    const source = String(lireMetaArticle(fournisseur.racine, slug).source || '').toLowerCase();
    if (source !== '' && source === cherche) { trouves.push(slug); }
  }
  return trouves.length === 1 ? trouves[0] : '';
}

// Le rédacteur désigne l'article. C'est la sortie des deux cas où le script refuse de
// choisir : plusieurs articles disent venir du même Word, ou aucun ne dit d'où il vient.
// L'article dont le nom de dossier correspond au fichier est proposé en tête — c'est le
// plus probable, et ce n'est qu'une proposition.
async function choisirArticleReimport(fournisseur, nom) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const slugs = fournisseur.listerArticles();
  const probable = slugifierArticle(nom);
  const rang = (slug) => (slug === probable ? 0 : 1);
  const items = slugs.slice()
    .sort((a, b) => rang(a) - rang(b) || slugs.indexOf(a) - slugs.indexOf(b))
    .map((slug) => ({
      label: libelleArticle(slugs.indexOf(slug), slug, titreFiche(lireMetaArticle(racine, slug), langue)),
      description: slug, slug: slug
    }));
  if (items.length === 0) { return ''; }
  const choix = await sousGarde(() => vscode.window.showQuickPick(items, {
    title: T('reimport.choisirArticle.titre', [nom]),
    placeHolder: T('reimport.choisirArticle')
  }));
  return choix ? String(choix.slug) : '';
}

// Le rédacteur désigne le Word. Sortie du refus « la fiche ne dit pas d'où vient cet
// article » et de « son document n'attend pas sous ce nom ».
async function choisirWordReimport(fournisseur, slug) {
  const noms = fournisseur._docxEnAttente(path.join(fournisseur.racine, profilCourant().depot));
  if (noms.length === 0) { return ''; }
  const choix = await sousGarde(() => vscode.window.showQuickPick(noms, {
    title: T('reimport.choisirWord.titre', [slug]),
    placeHolder: T('reimport.choisirWord')
  }));
  return choix ? String(choix) : '';
}

// La confirmation. Elle nomme ce qui est remplacé et ce qui est conservé, dans cet ordre,
// et dit que le retour en arrière existe : c'est précisément ce que le rédacteur craint de
// perdre, et un « Êtes-vous sûr ? » ne l'aurait pas renseigné.
async function confirmerReimport(slug) {
  const bouton = T('modale.reimport.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.reimport.question', [slug]),
    { modal: true, detail: T('modale.reimport.detail') }, bouton);
  return choix === bouton;
}

// Le texte de l'article a changé : son PDF et son aperçu montrent encore l'ancien. La même
// tâche que « Exporter cet article », pour qu'il n'y ait qu'une façon de compiler un article.
async function compilerApresReimport(racine, slug) {
  if (session.buildEnCours()) { return; }
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('statut.exportArticle', [slug]));
  try { await lancerTacheObjet(tacheMakeArticle(racine, slug)); }
  catch (e) { /* la compilation ratée se dit par les contrôles, le réimport a eu lieu */ }
  finally { statut.dispose(); session.poserBuildEnCours(false); }
}

// Le geste, du début à la fin. `cible` vaut { slug } depuis un article, { word } depuis la
// vue « Word en attente ».
async function reimporterArticle(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Une conversion ou une compilation en cours lit articles/ et articles-word/ : les
  // remplacer sous ses pieds laisserait un article à moitié écrit.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const word = (cible && typeof cible === 'object' && cible.word) ? String(cible.word) : '';
  let slug = word === '' ? (cibleTraduction(fournisseur, cible).slug || '') : articleDuWord(fournisseur, word);
  if (word !== '' && slug === '') { slug = await choisirArticleReimport(fournisseur, word); }
  if (slug === '') { return; }                     // dialogue annulé : rien n'a été touché
  if (fournisseur.listerArticles().indexOf(slug) === -1) {
    vscode.window.showInformationMessage(T('err.article.introuvable'));
    return;
  }
  if (!await confirmerReimport(slug)) { return; }
  // Les deux arguments ensemble quand le fichier est désigné : c'est l'appariement forcé,
  // le seul moyen de corriger un article dont le nom de fichier a changé depuis l'import.
  const args = ['--article', slug].concat(word === '' ? [] : ['--word', word]);
  await executerReimport(fournisseur, rafraichirTout, slug, args, false);
}

// Le filet de sécurité. Il refuse proprement quand aucun état d'avant n'est gardé, et ce
// refus est un message, pas une erreur : rien n'a été touché.
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

// Lancer, ranger la réponse là où la vue d'ensemble et la barre d'état la trouvent,
// recompiler si le texte a changé, puis le dire une fois.
async function executerReimport(fournisseur, rafraichirTout, slug, args, annulation) {
  const racine = fournisseur.racine;
  session.poserImportEnCours(true);
  const statut = vscode.window.setStatusBarMessage(
    T(annulation ? 'statut.reimport.annule' : 'statut.reimport', [slug]));
  let r;
  try { r = await lancerReimporter(racine, args); }
  // Même drapeau, même trou que lancerConversion() : un enregistrement de fiche pendant un
  // réimport doit aussi retrouver sa compilation à la sortie.
  finally { statut.dispose(); session.poserImportEnCours(false); rejouerCompilationsDifferees(); }
  // Les formulaires de cet article montrent des tableaux et des images qui viennent d'être
  // remplacés : les laisser ouverts, c'est laisser écrire par-dessus.
  const reussi = !!(r.json && r.json.resultat === 'reussi');
  if (reussi) { fermerFormulairesEcriture(racine, slug); }
  const constats = r.json ? constatsReimport(r.json, slug) : [];
  poserConstatsReimport(racine, constats);
  rafraichirTout();
  const ouverte = panneauxVue.get('controles');
  if (ouverte) { envoyerVue(ouverte, fournisseur, 'controles'); }
  if (reussi) {
    await compilerApresReimport(racine, slug);
    rafraichirTout();
  }
  await annoncerReimport(fournisseur, rafraichirTout, r, slug, annulation, constats);
  if (reussi) { await ouvrirArticle(fournisseur, slug); }
}

// Les cinq issues, chacune avec son ton. Le ton vient de lib/journal.js, jamais d'ici :
// c'est là que la règle se lit, et un refus n'y est pas rouge.
async function annoncerReimport(fournisseur, rafraichirTout, r, slug, annulation, constats) {
  if (!r.json) {
    // Appel mal formé, machine du pipeline absente, délai dépassé : aucune ligne de
    // réponse. Un bug d'appel ou un poste mal préparé, jamais un article abîmé.
    vscode.window.showErrorMessage(T('reimport.injoignable'));
    return;
  }
  const langue = langueCockpit();
  // Le meme gabarit que la liste « A corriger » : deux voix pour un meme constat, c'est
  // exactement ce que ce lot est venu supprimer.
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
    // Réussi sans un mot à dire : une information, et le retour en arrière sous la main.
    if (constats.length === 0) {
      const choix = await vscode.window.showInformationMessage(T('reimport.reussi', [slug]), revenir);
      if (choix === revenir) { await annulerReimport(fournisseur, rafraichirTout, { slug: slug }); }
      return;
    }
    // Réussi, mais le remplacement a coûté quelque chose : le ton de l'avertissement, pas
    // celui de l'échec. Le document est en place et publiable.
    const choix = await vscode.window.showWarningMessage(
      T('reimport.reussi.avert', [slug, constats.length]), voir, revenir);
    if (choix === voir) { await ouvrirControles(); }
    if (choix === revenir) { await annulerReimport(fournisseur, rafraichirTout, { slug: slug }); }
    return;
  }

  // « Rien à faire » : le Word n'apportait rien. Ni échec ni avertissement — un fait.
  if (ton === 'info') {
    vscode.window.showInformationMessage(T('reimport.rien', [slug]));
    return;
  }

  // Refusé : rien n'a été touché, et il y a un geste à faire. Le message est celui du
  // refus lui-même, qui porte ce geste ; quand ce geste est « désignez le fichier Word »,
  // le bouton le fait sur place.
  if (ton === 'attention') {
    const codes = Array.isArray(r.json.avertissements) ? r.json.avertissements : [];
    const manqueLeWord = codes.indexOf('reimport-sans-word') !== -1
      || codes.indexOf('reimport-fiche-sans-source') !== -1;
    const boutons = manqueLeWord ? [T('reimport.choisirWord'), voir] : [voir];
    const choix = await vscode.window.showWarningMessage(
      premiere || T('reimport.refuse', [slug]), ...boutons);
    if (choix === voir) { await ouvrirControles(); }
    if (choix === T('reimport.choisirWord')) {
      const nom = await choisirWordReimport(fournisseur, slug);
      if (nom === '') { return; }
      if (!await confirmerReimport(slug)) { return; }
      await executerReimport(fournisseur, rafraichirTout, slug,
        ['--article', slug, '--word', nom], false);
    }
    return;
  }

  // Échoué : l'article est intact, et son Word attend toujours. Celui-là est rouge.
  const choix = await vscode.window.showErrorMessage(
    premiere || T('reimport.echec', [slug]), voir);
  if (choix === voir) { await ouvrirControles(); }
}

// ---- Assets : dimensions sans dépendance (lib/medias.js), et « Remplacer » -------

// Écrase une image de media/ en gardant son nom, pour que les liens du .md restent
// valides. Seul chemin d'écriture d'une image : le gestionnaire des médias et la
// vérification de l'import y passent tous les deux, avec la même confirmation modale et
// les mêmes contrôles de format et de poids. Le fichier arrive en base64 depuis une
// webview, jamais par une boîte de dialogue de l'hôte.
// -> { etat: 'ok' | 'annule' | 'erreur', message }
// `options.offrirACote` ajoute au dialogue une troisième issue : ne rien écraser et poser
// la nouvelle image à côté de l'ancienne, dans une même figure. C'est la sortie de secours
// du geste le plus destructeur du formulaire — on dépose un fichier sur la mauvaise carte,
// et il ne reste rien de l'ancienne. Le gestionnaire des médias la propose ; la
// vérification d'import, qui n'a pas de figure sous la main, ne la propose pas.
// -> { etat: 'ok' | 'annule' | 'erreur' | 'a-cote', message }
async function remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif, nomFichier, donneesBase64, options) {
  const echec = (message) => ({ etat: 'erreur', message: message });
  if (!fournisseur.racine) { return echec(T('err.remplacement', ['?'])); }
  if (!new Set(fournisseur.listerArticles()).has(String(slug || ''))) { return { etat: 'annule' }; }
  if (!relatifImageValide(relatif)) { return { etat: 'annule' }; }
  if (session.buildEnCours() || session.importEnCours()) { return echec(T('statut.occupe')); }
  const cible = path.join(fournisseur.racine, dossierUnites(), slug, 'media', relatif);
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
  // Deux issues offertes, plus l'« Annuler » que la boîte modale pose elle-même : le
  // rédacteur a donc toujours les trois réponses sous les yeux.
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

// Écrase tables/table-NN.html en gardant le nom, pour que la référence reste valide.
// Supprime une image ou un tableau, référence comprise : effacer le seul fichier
// laisserait un lien mort. Le texte passe par un WorkspaceEdit, donc annulable. Rend vrai
// quand le fichier est parti, ce que le gestionnaire des médias attend pour retirer sa
// carte.
async function supprimerAsset(fournisseur, rafraichirTout, item, estTable) {
  const racine = fournisseur.racine;
  if (!racine || !item || !item.cheminAsset || !item.slug) { return false; }
  // Comme « Remplacer » : pas de suppression pendant que make lit le dossier.
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
    : path.relative(path.join(racine, dossierUnites(), slug, 'media'), cible).replace(/\\/g, '/');

  const reponse = await vscode.window.showWarningMessage(
    T(estTable ? 'modale.supprimerTable.question' : 'modale.supprimerAsset.question', [nom]),
    { modal: true, detail: T(estTable ? 'modale.supprimerTable.detail' : 'modale.supprimerAsset.detail', [slug]) },
    T('modale.supprimer.bouton')
  );
  if (reponse !== T('modale.supprimer.bouton')) { return false; }   // annulé : rien n'est touché

  // L'ordre compte : référence retirée du tampon, fichier effacé, puis .md enregistré —
  // l'enregistrement compile, et pandoc lirait sinon un média en cours de suppression.
  let retirees = 0;
  let doc = null;
  const md = path.join(racine, dossierUnites(), slug, slug + '.md');
  try {
    doc = await vscode.workspace.openTextDocument(md);
    const resultat = estTable
      ? retirerTable(doc.getText(), relatif)
      : retirerImage(doc.getText(), relatif);
    if (resultat.n > 0) {
      // L'image supprimée pouvait être dans une grille : le bloc reste, avec une image de
      // moins et une disposition qui ne lui correspond plus. On le remet d'aplomb ici, seul
      // point par lequel toutes les suppressions passent — l'arbre comme le formulaire.
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

  // Le laisser à l'écran ferait réécrire un tableau qui vient d'être supprimé. Le
  // gestionnaire des médias, lui, n'est pas lié à un fichier : il retire sa carte.
  const ouvert = estTable ? panneauxTable.get(cible) : null;
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

// Casse ignorée comme sous Windows ; un onglet sur un fichier supprimé ferait fantôme.
async function fermerOngletsSous(dossier) {
  const prefixe = (dossier + path.sep).toLowerCase();
  await fermerOnglets((e) => e && e.uri && e.uri.fsPath &&
    e.uri.fsPath.toLowerCase().indexOf(prefixe) === 0);
}

async function fermerOngletDuFichier(chemin) {
  const vise = String(chemin).toLowerCase();
  await fermerOnglets((e) => e && e.uri && e.uri.fsPath && e.uri.fsPath.toLowerCase() === vise);
}

// Confirmation modale nommant l'article, jamais de suppression silencieuse.
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
  // La modale reste ouverte le temps que le rédacteur réponde : une compilation a pu
  // démarrer entre-temps. Même refus qu'avant la modale, avant tout effet sur le disque.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const dossierArticle = path.join(racine, dossierUnites(), slug);
  const dossierSortie = path.join(racine, 'out', slug);
  // Tout ce qui tient un fichier de l'article est fermé d'abord ; ces fermetures avalent
  // leurs propres échecs, seul l'effacement dira si elles ont suffi.
  if (session.apercuCourantSlug() === slug) { fermerApercuHtml(); session.poserApercuCourantSlug(null); }
  fermerFormulairesEcriture(racine, slug);
  await fermerOngletsSous(dossierArticle);
  await fermerOngletsSous(dossierSortie);
  // Les deux dossiers sont effacés indépendamment : un article encore tenu ne doit pas
  // laisser derrière lui les documents produits, qui pèsent le plus lourd.
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
  vscode.window.setStatusBarMessage(T('statut.supprime', [slug]), 3000);
}

// ---- Formulaire des livres, et fiches de tous les articles -> lib/metadonnees-hote.js ---

// ---- Suivi de traduction ---------------------------------------------------------
// Panneau szhTraduction en colonne 1, aperçu en colonne 2. Deux fichiers, deux rôles,
// détaillés dans l'en-tête de lib/traduction.js : les textes traduits vont dans
// <slug>.meta.yaml, publié, l'état d'atelier dans <slug>.traduction.yaml, qui ne l'est pas.

const ICONES_STATUT = {
  'pas-pret': 'circle-large-outline',
  'pret-traduction': 'arrow-right',
  'pret-relecture': 'eye',
  'finalise': 'pass-filled'
};
// « charts.orange » est trop clair sur fond blanc : l'ambre d'avertissement de l'éditeur
// est fait pour se voir sur les deux fonds, et c'est déjà celui des encadrés de qualité.
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
  return path.join(racine, dossierUnites(), slug, slug + '.traduction.yaml');
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

// « Titre et sous-titre (DE) » quand les deux existent, sinon « Titre (DE) ».
function libelleGroupe(groupe) {
  let nom;
  if (groupe.groupe === 'titre') {
    nom = groupe.champs.length > 1
      ? T('trad.champ.titre.duo')
      : T('trad.champ.' + groupe.champs[0]);
  } else {
    nom = T('trad.champ.' + groupe.champs[0]);
  }
  return T('trad.champ.libelle', [nom, groupe.langue.toUpperCase()]);
}

// « traduit » ou « à traduire », sauf pour les mots-clés : « 2/4 traduits ».
function etatRemplissageGroupe(groupe) {
  if (groupe.groupe === 'motscles') {
    const l = groupe.lignes[0];
    return T('trad.avancement', [l.remplies, l.total]);
  }
  return groupe.rempli ? T('trad.traduit') : T('trad.atraduire');
}

// Au changement de langue d'un article, le formulaire (webview) permute les contenus des
// champs multilingues entre l'ancienne et la nouvelle langue. Les statuts du sidecar
// <slug>.traduction.yaml sont indexés champ×langue : ils font le même échange, pour
// continuer à désigner le texte qu'ils qualifiaient. Un statut qui atterrit sur la langue
// source du suivi devient dormant — et revient tel quel si on re-permute.
// Limite assumée : plusieurs changements de langue avant le même enregistrement ne
// laissent voir à l'hôte que les deux langues extrêmes ; l'enregistrement automatique
// (quelques secondes après le geste) rend le cas marginal.
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

// Écrit le sidecar, ou le supprime s'il ne reste rien à retenir. Écrit par le panneau
// « Traductions », par les campagnes de statut, et par la permutation ci-dessus.
function ecrireSuiviTraduction(racine, slug, suivi) {
  const chemin = cheminTraduction(racine, slug);
  const contenu = serialiserTraduction(suivi);
  if (contenu === '') {
    try { if (fs.existsSync(chemin)) { fs.unlinkSync(chemin); } } catch (e) { /* déjà parti */ }
    return;
  }
  ecrireAtomique(chemin, contenu);
}

// Lance la campagne : n'avance que les champs « pas prêt », pour ne pas faire reculer un
// champ déjà en relecture ou finalisé.
// Poser un état sur tous les blocs de tous les articles du numéro. `seulementPasPret`
// restreint aux blocs qui n'ont pas commencé — c'est ce que veut la commande de la palette,
// « rendre prêt tout ce qui ne l'est pas encore », et ce que ne veut pas un bouton de la
// vue d'ensemble : trois boutons côte à côte doivent se comporter pareil, sinon l'un d'eux
// semble ne rien faire. L'appelant fait confirmer quand il écrit partout.
// -> nombre de blocs touchés.
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
  rafraichirPanneauTraduction(fournisseur);        // le panneau ouvert suit le bouton
  return n;
}

// La commande de la palette : « prêt pour traduction » sur tout ce qui ne l'est pas encore.
// Elle ne défait donc rien, et n'a pas à être confirmée.
function marquerToutPretTraduction(fournisseur, rafraichirTout) {
  const n = marquerToutStatutRevue(fournisseur, rafraichirTout, 'pret-traduction', true);
  vscode.window.setStatusBarMessage(n > 0 ? T('trad.toutpret.fait', [n]) : T('trad.toutpret.rien'), 5000);
}

// ---- Vues d'ensemble de section ------------------------------------------------
// Cliquer l'onglet d'une section de la barre latérale ouvre une page : les commandes
// globales y ont un bouton avec un texte, au lieu des pictogrammes muets que l'arbre
// alignait dans sa marge. La webview est la même pour toutes les sections
// (media/vue-ensemble.*) : elle ne fait que poser ce que l'hôte lui envoie.

const panneauxVue = new Map();       // type -> panneau, un seul par section

function htmlVueEnsemble(nonce, titre) {
  return construireHtml('vue-ensemble', nonce, {
    cssPartage: ['_design.css', '_liste.css'], jsPartage: ['_messages.js'], titre: titre
  });
}

function textesVueEnsemble() {
  return { ouvrir: T('vue.ouvrir'), listeVide: T('vue.rien') };
}

// Ton et pictogramme d'un état d'atelier, les mêmes que dans l'arbre : bleu ce qui est
// lancé, orange ce qui attend un regard, vert ce qui est clos, rien quand rien n'a commencé.
const PASTILLE_STATUT = {
  'pas-pret': { ton: '', icone: 'cercle' },
  'pret-traduction': { ton: 'info', icone: 'fleche' },
  'pret-relecture': { ton: 'attention', icone: 'oeil' },
  finalise: { ton: 'ok', icone: 'ok' }
};

// Un article par ligne : son avancement, son état, et la question posée s'il y en a une.
function vueTraductions(fournisseur) {
  const racine = fournisseur.racine;
  const source = langueRevue(racine);
  const lignes = [];
  const slugs = fournisseur.listerArticles();
  for (let index = 0; index < slugs.length; index++) {
    const slug = slugs[index];
    const etat = etatTraduction(racine, slug, source);
    // Le titre de l'article, et son slug juste à côté : le même nom que partout ailleurs.
    // La fiche vient d'etatTraduction, qui l'a déjà lue.
    const nom = libelleArticle(index, slug, titreFiche(etat.meta, source));
    if (etat.lignes.length === 0) {
      lignes.push({ cle: slug, titre: nom, meta: T('trad.rien.court'), pastilles: [], ouvrir: false });
      continue;
    }
    const r = etat.resume;
    // Des états mêlés dans un même article : le plus prudent des deux mondes, l'attention.
    const past = r.melange
      ? { ton: 'attention', icone: 'attention' }
      : (PASTILLE_STATUT[r.statut] || { ton: '', icone: 'cercle' });
    lignes.push({
      cle: slug, titre: nom,
      meta: slug + ' · ' + T('trad.avancement', [r.remplis, r.total]),
      pastilles: [{
        texte: r.melange ? T('trad.statut.melange') : T('trad.statut.' + r.statut),
        ton: past.ton, icone: past.icone
      }],
      notif: etat.suivi.commentaire !== ''
        ? { ton: 'info', texte: etat.suivi.commentaire } : null,
      ouvrir: true
    });
  }
  return {
    titre: T('trad.titre'),
    boutons: [
      { id: 'tout-traduction', libelle: T('trad.court.traduction'), icone: 'fleche', tip: T('trad.vue.tout.tip') },
      { id: 'tout-relecture', libelle: T('trad.court.relecture'), icone: 'oeil', tip: T('trad.vue.tout.tip') },
      { id: 'tout-finalise', libelle: T('trad.court.finalise'), icone: 'ok', tip: T('trad.vue.tout.tip') },
      { id: 'envoyer', libelle: T('trad.envoyer'), icone: 'traduction', tip: T('trad.envoyer.tooltip') }
    ],
    lignes: lignes
  };
}

// Ce qui attend d'être converti, et ce que la dernière conversion a dit — ses échecs
// surtout, qui ne vivaient que dans le terminal de la tâche.
function vueWord(fournisseur) {
  const racine = fournisseur.racine;
  const lignes = [];
  for (const entree of lireRapportImport(racine)) {
    lignes.push({
      cle: '', groupe: T('word.vue.rapport'), titre: entree.nom,
      pastilles: [{ texte: entree.libelle, ton: entree.ton, icone: entree.icone }],
      notif: entree.ligne === '' ? null : { ton: entree.ton === '' ? 'info' : entree.ton, texte: entree.ligne },
      ouvrir: false
    });
  }
  const noms = fournisseur._docxEnAttente(path.join(racine, profilCourant().depot));
  for (const nom of noms) {
    const slug = slugifierArticle(nom);
    const deja = fournisseur._articleExiste(slug);
    lignes.push({
      // Le nom du fichier est la clé : c'est lui que « Réimporter cet article » reçoit.
      cle: nom, groupe: T('word.vue.attente'), titre: nom, meta: slug,
      pastilles: deja
        ? [{ texte: T('arbre.deja.badge'), ton: 'attention', icone: 'attention' }]
        : [{ texte: T('word.vue.attente.badge'), ton: 'info', icone: 'fleche' }],
      notif: deja ? { ton: 'attention', texte: T('arbre.deja.tooltip') } : null,
      // Le geste que le message du redépôt nomme, à l'endroit où le rédacteur se trouve
      // quand il vient de déposer le Word corrigé. Sur un fichier dont aucun article
      // n'existe encore, il n'y a rien à réimporter : c'est la conversion qu'il faut.
      actions: deja
        ? [{ id: 'reimporter', libelle: T('cmd.reimporter.court'), icone: 'fleche',
             tip: T('cmd.reimporter.tip') }]
        : [],
      ouvrir: false
    });
  }
  return {
    titre: T('word.vue.titre'),
    boutons: [
      { id: 'convertir', libelle: T('word.vue.convertir'), icone: 'fleche', principal: true },
      { id: 'vider', libelle: T('word.vue.vider'), icone: 'poubelle', danger: true,
        desactive: noms.length === 0, tip: T('word.vue.vider.tip') }
    ],
    lignes: lignes
  };
}

// Le rapport de la dernière conversion, écrit par la cible `import` du Makefile.
//
// Les lignes « [import-avertissement] » ne passent pas par ici : elles portent un code
// stable et deux langues, et lib/journal.js sait déjà en faire une phrase. Sans cette
// dérivation, la règle « toute ligne contenant ⚠ est un échec » ci-dessous les laissait
// filer en « converti » et affichait la ligne brute, deux langues comprises, comme titre
// de carte.
function lireRapportImport(racine) {
  let texte = '';
  try { texte = fs.readFileSync(path.join(racine, profilCourant().depot, '.import.log'), 'utf8'); }
  catch (e) { return []; }
  const langue = langueCockpit();
  const avertissements = new Map();
  for (const c of analyserJournal(texte, langue)) {
    if (c.source !== 'import' || c.code === 'echec' || c.code === 'restes') { continue; }
    avertissements.set(c.code + ' ' + c.slug, c);
  }
  const entrees = [];
  for (const c of avertissements.values()) {
    entrees.push({
      nom: c.slug === '' ? T('ctl.numero') : T('ctl.article', [c.slug]),
      ligne: tableConstats.phrase(c, langue),
      libelle: T(c.ton === 'danger' ? 'ctl.badge.bloquant' : 'ctl.badge.avert'),
      ton: c.ton, icone: c.ton
    });
  }
  for (const brute of texte.split(/\r?\n/)) {
    if (brute.indexOf('[import-avertissement]') === 0) { continue; }
    const ligne = brute.replace(/^\[import\]\s*/, '').trim();
    if (ligne === '') { continue; }
    let ton = 'ok';
    let icone = 'ok';
    let libelle = T('word.rapport.converti');
    // Les motifs tolèrent l'absence d'accent : le rapport vient d'un shell, dont la locale
    // n'est pas garantie.
    // Le bilan d'abord : il compte les échecs, et se ferait classer comme l'un d'eux. Le
    // motif est ancré en début de ligne : un fichier « Dossier terminé 2026.docx » ne doit
    // pas voir son échec se déguiser en bilan.
    if (/^termin[ée]/i.test(ligne)) { ton = ''; icone = 'info'; libelle = T('word.rapport.bilan'); }
    else if (ligne.indexOf('⚠') !== -1 || /[ée]chec/i.test(ligne)) { ton = 'danger'; icone = 'danger'; libelle = T('word.rapport.echec'); }
    else if (/d[ée]j[àa] converti|ignor/i.test(ligne)) { ton = 'attention'; icone = 'attention'; libelle = T('word.rapport.ignore'); }
    // Le nom du fichier en tête de ligne, la phrase en dessous : c'est par le fichier
    // qu'on cherche, et la phrase est ce qu'il faut lire quand ça a raté.
    // Les .docx livrés portent presque toujours des espaces : on prend tout ce qui suit le
    // deux-points jusqu'à l'extension, sans quoi le titre de la carte serait un fragment.
    const m = ligne.match(/:\s*(.+?\.docx)/i);
    entrees.push({ nom: m ? m[1] : ligne, ligne: m ? ligne : '', libelle: libelle, ton: ton, icone: icone });
  }
  return entrees;
}

// ---- Contrôles de la compilation ------------------------------------------------
//
// La chaîne repère une dizaine de choses à chaque compilation, et tout partait sur la
// sortie d'erreur d'un terminal que `reveal: silent` n'ouvre jamais. Les tâches écrivent
// désormais leur sortie dans <numéro>/.szh-journal.log (vscodium-user/tasks.json), et
// lib/journal.js la traduit en constats. Ici : les relire à la fin de chaque tâche, les
// dire une fois, et les garder à portée de clic.
//
// Rien de neuf à l'écran : la vue est la vue d'ensemble des autres sections
// (media/vue-ensemble.*, SZH.listeCartes), l'avis est une notification de l'éditeur, et
// le compteur est un article de la barre d'état, comme la bascule d'aperçu.
//
// La validation PDF/UA en arrière-plan (lib/pdfua-hote.js) vit à part de tout ceci — elle
// ne passe pas par une tâche — mais son état rejoint les mêmes compteur et vue : voir
// pdfuaHote.constats() plus bas, et le badge posé par article (majBadgePdfUa).
const pdfuaHote = require('./lib/pdfua-hote');
// La table des constats : ce qu'un defaut ferme, ou on va le corriger, comment il s'ecrit.
const tableConstats = require('./lib/constats');
// L'alignement des dossiers d'article sur leur rang affiché : le plan et son exécution.
const renumerotation = require('./lib/renumerotation-fs');

const JOURNAL_TACHE = '.szh-journal.log';

// Le dernier journal lu, par racine de numéro : la barre d'état et la vue le relisent sans
// recompiler, et rouvrir la vue ne perd pas ce qui a été dit.
//
// `reimport` est à part, et doit l'être : le réimport ne passe pas par une tâche, ses
// constats ne sont donc pas dans .szh-journal.log, et la recompilation qui le suit
// aussitôt les effacerait s'ils étaient mêlés à ceux de la chaîne. Ils passent devant —
// c'est le geste que le rédacteur vient de faire.
let dernierJournal = { racine: null, constats: [], code: 0, reimport: [], export: [] };

// Le mode « Changer l'ordre » : { racine, slugs } pendant qu'on réordonne, null sinon.
//
// Renommer un dossier à chaque clic sur « Monter » ferait autant d'occasions de tomber sur
// un fichier ouvert ou une synchronisation OneDrive en cours. On accumule donc l'ordre voulu
// ici, sans rien écrire, et « Terminer » exécute le lot d'un coup. L'état vit dans l'hôte et
// non dans la page : un rafraîchissement de la vue ne doit pas le perdre.
let modeOrdre = null;

function ordreEnCours(racine) {
  return (modeOrdre && modeOrdre.racine === racine) ? modeOrdre.slugs : null;
}

// Ce que la vue et la barre d'état ont à montrer, les deux listes réunies. pdfua.constats()
// s'ajoute toujours : la validation PDF/UA tourne hors tâche, ses verdicts en cache ne
// vivent pas dans .szh-journal.log (lib/pdfua-hote.js).
function constatsCourants(racine) {
  const base = dernierJournal.racine !== racine
    ? lireJournalTache(racine)
    : dernierJournal.export.concat(dernierJournal.reimport, dernierJournal.constats);
  return base.concat(pdfuaHote.constats(racine));
}

// Les points qui ont fait refuser le dernier export, un par carte. Ils partaient
// concaténés dans le message d'une seule notification, avec des puces et des retours à la
// ligne que VSCodium écrase : le plus grave de l'application était son message le moins
// lisible, et rien n'en restait une fois la notification disparue. Ils vivent donc dans la
// liste « À corriger » jusqu'au prochain export — réussi, il les efface.
//
// Le lieu n'est pas dans la table des constats : il dépend de la raison. Les points de
// configuration ouvrent la liste (szhBloquantsConfig en donne le compte) et mènent aux
// réglages ; les autres nomment leur article en tête de phrase et mènent à sa fiche.
function constatsExport(liste, nConfig) {
  return (liste || []).map((brut, i) => {
    const m = String(brut).match(/^articles\/([^\s:]+)\s*:\s*([\s\S]*)$/);
    const slug = m ? m[1] : '';
    return { source: 'export', code: 'refus', ton: 'danger', cle: '', args: [],
             champs: { raison: m ? m[2] : String(brut) }, slug: slug,
             lieu: i < nConfig ? 'reglages' : (slug === '' ? '' : 'fiche'),
             brut: String(brut) };
  });
}

function poserConstatsExport(racine, liste, nConfig) {
  if (dernierJournal.racine !== racine) {
    dernierJournal = { racine: racine, constats: lireJournalTache(racine), code: 0,
                       reimport: [], export: [] };
  }
  dernierJournal.export = constatsExport(liste, nConfig || 0);
  majBarreControles();
}

// Les constats du dernier réimport, posés ou effacés. Un nouveau réimport remplace ceux
// du précédent : deux jeux d'avertissements sur le même article se contrediraient.
function poserConstatsReimport(racine, constats) {
  if (dernierJournal.racine !== racine) {
    dernierJournal = { racine: racine, constats: lireJournalTache(racine), code: 0,
                       reimport: [], export: [] };
  }
  dernierJournal.reimport = constats || [];
  majBarreControles();
}

function lireJournalTache(racine) {
  if (!racine) { return []; }
  let texte = '';
  try { texte = fs.readFileSync(path.join(racine, JOURNAL_TACHE), 'utf8'); }
  catch (e) { return []; }                           // aucune compilation depuis l'ouverture
  return analyserJournal(texte, langueCockpit());
}

// Le texte brut du dernier journal, pour savoir quels articles la compilation a traversés.
function texteJournalTache(racine) {
  if (!racine) { return ''; }
  try { return fs.readFileSync(path.join(racine, JOURNAL_TACHE), 'utf8'); }
  catch (e) { return ''; }
}

// Les constats du dernier passage, PLUS ceux des articles que ce passage n'a pas touchés.
//
// `make` est incrémental et la tâche réécrit le journal : enregistrer un seul article donne
// un journal qui ne parle que de lui. On remplaçait pourtant tous les constats par les
// siens, et ceux des autres articles disparaissaient de la liste comme du compteur, alors
// que leurs défauts tenaient toujours. La liste mentait par omission, et dans le sens
// rassurant — celui qui laisse publier.
//
// Ne sont donc jetés que les constats des articles recompilés (slugsCompiles) : un défaut
// corrigé s'en va au passage suivant sur SON article, un défaut qu'on n'a pas retouché
// reste. Les constats du numéro entier (slug vide) sont toujours remplacés : ils parlent de
// l'ensemble, et l'ensemble vient d'être recompilé.
// Un article est « traversé » s'il a sa ligne de pandoc, MAIS AUSSI si le nouveau journal
// parle de lui : une porte qui ferme avant pandoc — un titre vide, un dossier à espaces —
// écrit son constat sans qu'aucune compilation n'ait eu lieu. Sans ce second cas, l'ancien
// constat du même article restait à côté du neuf, et le même défaut se comptait deux fois.
function fusionnerConstats(racine, neufs) {
  if (dernierJournal.racine !== racine) { return neufs; }
  const traverses = slugsCompiles(texteJournalTache(racine));
  for (const c of neufs) { if (c.slug !== '') { traverses.add(c.slug); } }
  const gardes = dernierJournal.constats.filter(
    (c) => c.slug !== '' && !traverses.has(c.slug));
  return gardes.concat(neufs);
}

// Ton d'une pastille et son pictogramme : les mêmes trois tons que partout ailleurs dans
// le cockpit, pour qu'un avertissement se reconnaisse sans être lu.
const PASTILLE_CONSTAT = {
  danger: { badge: 'ctl.badge.bloquant', groupe: 'ctl.groupe.bloquant', icone: 'danger' },
  attention: { badge: 'ctl.badge.avert', groupe: 'ctl.groupe.avert', icone: 'attention' },
  info: { badge: 'ctl.badge.info', groupe: 'ctl.groupe.info', icone: 'info' }
};

const SOURCES_CONSTAT = {
  citations: 'ctl.source.citations', import: 'ctl.source.import', meta: 'ctl.source.meta',
  pdfua: 'ctl.source.pdfua', pipeline: 'ctl.source.pipeline', rendu: 'ctl.source.rendu',
  // pipeline/livre-scinder.py, appelé depuis la cible `import` du Makefile pour un livre :
  // ses constats « [scission-avertissement] » arrivent ici sans code à ajouter (familleCode()
  // de lib/journal.js reconnaît déjà tout préfixe « <source>-<ton> » générique) — seule cette
  // étiquette manquait, sans quoi la carte se serait affichée sous « ctl.source.pipeline ».
  scission: 'ctl.source.scission',
  // szh-numerotation.lua : la seule image sans texte alternatif ni légende (« figure-sans-
  // alt »), déjà montrée dans l'encadré « lecteur d'écran » de l'aperçu.
  numerotation: 'ctl.source.numerotation'
};

// Une carte par constat : l'article concerné en tête, la nature du contrôle en mesure, la
// phrase dans le corps, le ton en pastille. Les bloquants d'abord — l'ordre de lecture est
// celui des gestes à faire.
// Ce dont lib/constats.js a besoin pour décider si une barrière est vraiment fermée. La
// validation PDF/UA est un réglage : là où elle est éteinte, une image muette ne fait plus
// échouer de PDF, et la couleur doit retomber avec elle.
function contexteConstats() {
  return { pdfua: pdfuaHote.reglageActif() };
}

// Les trois destinations qui parlent d'un article : un constat peut nommer un Word qui
// n'est jamais devenu un article, et un bouton qui ouvrirait le vide serait pire que rien.
const LIEUX_ARTICLE = new Set(['article', 'fiche', 'medias']);

// Le bouton d'un constat, ou aucun. L'identifiant porte la destination ET l'objet à
// atteindre — « medias:fig-01.png » — parce que la page renvoie l'identifiant tel quel :
// l'hôte n'a ainsi pas à retrouver de quel constat venait le clic, ce qui serait ambigu dès
// que deux défauts du même article visent le même formulaire.
function actionsConstat(constat, connus) {
  const cible = tableConstats.cible(constat);
  if (!cible) { return []; }
  if (LIEUX_ARTICLE.has(cible.lieu) && !(cible.slug !== '' && connus.has(cible.slug))) {
    return [];
  }
  const lieu = tableConstats.LIEUX[cible.lieu];
  return [{ id: cible.lieu + (cible.focus === '' ? '' : ':' + cible.focus),
            libelle: T(lieu.libelle), icone: lieu.icone, tip: T(lieu.tip) }];
}

function vueControles(fournisseur) {
  const racine = fournisseur.racine;
  const constats = constatsCourants(racine);
  const langue = langueCockpit();
  const connus = new Set(fournisseur.listerArticles());
  const contexte = contexteConstats();
  const lignes = [];
  for (const gravite of ['bloquant', 'avert', 'info']) {
    for (const c of constats) {
      if (tableConstats.gravite(c, contexte) !== gravite) { continue; }
      const ton = tableConstats.ton(c, contexte);
      const past = PASTILLE_CONSTAT[ton] || PASTILLE_CONSTAT.info;
      // « Ouvrir » n'a de sens que sur un article qui existe encore : un constat peut
      // nommer un Word qui n'est jamais devenu un article.
      const ouvrable = c.slug !== '' && connus.has(c.slug);
      const detail = tableConstats.detail(c, langue);
      lignes.push({
        cle: ouvrable ? c.slug : '',
        groupe: T(past.groupe),
        titre: c.slug === '' ? T('ctl.numero') : T('ctl.article', [c.slug]),
        meta: T(SOURCES_CONSTAT[c.source] || 'ctl.source.pipeline'),
        notif: { ton: ton,
                 texte: tableConstats.phrase(c, langue)
                   + (detail === '' ? '' : ' ' + detail) },
        pastilles: [{ texte: T(past.badge), ton: ton === 'info' ? '' : ton, icone: past.icone }],
        ouvrir: ouvrable,
        actions: actionsConstat(c, connus)
      });
    }
  }
  return {
    titre: T('ctl.titre'),
    boutons: [
      { id: 'recompiler', libelle: T('ctl.recompiler'), icone: 'fleche', principal: true,
        tip: T('ctl.recompiler.tip') }
    ],
    lignes: lignes
  };
}

// La barre d'état : le seul endroit qui reste visible quand la notification a disparu.
// Rien à afficher quand rien n'a été relevé — un compteur à zéro est du bruit.
let barreControles = null;

function majBarreControles() {
  if (!barreControles) { return; }
  // pdfuaHote.constats() s'ajoute : un PDF non conforme compte comme un bloquant, ici
  // comme à l'export — c'est la même règle, elle arrive juste une minute après le Ctrl+S
  // au lieu du jour de l'export.
  const constats = dernierJournal.reimport.concat(dernierJournal.constats)
    .concat(pdfuaHote.constats(dernierJournal.racine));
  const r = resumeJournal(constats);
  if (r.bloquants > 0) { barreControles.text = T('ctl.barre.bloquant', [r.bloquants]); }
  else if (r.avertissements > 0) { barreControles.text = T('ctl.barre.avert', [r.avertissements]); }
  else { barreControles.hide(); return; }
  barreControles.tooltip = T('ctl.barre.tooltip');
  barreControles.show();
}

// ---- Le badge PDF/UA de l'article ouvert (ou du livre) ---------------------------
//
// Conforme, non conforme, en cours de validation, ou panne d'outillage — jamais montré
// tant que rien n'est connu (pas d'article ouvert, ou verdict encore « inconnu »). L'état
// vient de lib/pdfua-hote.js ; ce module ne fait ici que le traduire pour la barre.
let barrePdfUa = null;

// La clé d'état à demander à pdfuaHote.etat() pour l'article actuellement marqué ouvert :
// 'livre' en profil livre (le PDF de l'ouvrage, pas d'un chapitre en particulier), sinon le
// slug de l'article que majArticleOuvert a marqué — ou null si aucun n'est ouvert.
function cleBadgePdfUa(fournisseur) {
  if (!fournisseur.racine) { return null; }
  if (profilCourant().cle === 'livre') { return 'livre'; }
  return uriArticleOuvert ? slugArticleContenant(fournisseur.racine, uriArticleOuvert.fsPath) : null;
}

function majBadgePdfUa(fournisseur) {
  if (!barrePdfUa) { return; }
  const cle = cleBadgePdfUa(fournisseur);
  const e = cle ? pdfuaHote.etat(cle) : { verdict: 'inconnu', regles: 0, date: '' };
  barrePdfUa.backgroundColor = undefined;
  if (e.verdict === 'conforme') {
    barrePdfUa.text = '$(verified) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.conforme', [e.date ? new Date(e.date).toLocaleString() : '']);
  } else if (e.verdict === 'non-conforme') {
    barrePdfUa.text = '$(error) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.nonconforme', [e.regles]);
    barrePdfUa.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (e.verdict === 'en-cours') {
    barrePdfUa.text = '$(sync~spin) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.encours');
  } else if (e.verdict === 'outillage') {
    barrePdfUa.text = '$(question) PDF/UA';
    barrePdfUa.tooltip = T('pdfua.badge.outillage');
  } else {
    barrePdfUa.hide();
    return;
  }
  barrePdfUa.show();
}

// Ce qu'un changement d'état côté pdfuaHote (verdict mis en cache, validation démarrée ou
// terminée, réglage changé) doit rafraîchir : le badge, le compteur, et la vue Contrôles
// si elle est ouverte — même trio que relireJournal() plus bas.
function rafraichirPdfUa(fournisseur) {
  majBadgePdfUa(fournisseur);
  majBarreControles();
  const ouverte = panneauxVue.get('controles');
  if (ouverte) { envoyerVue(ouverte, fournisseur, 'controles'); }
}

// Fin d'une tâche de la chaîne : on relit le journal, on met le compteur à jour, et on le
// dit une fois. Le code de sortie sépare les deux tons du message : « la compilation s'est
// arrêtée » n'est vrai que s'il est non nul, et un PDF sorti sans son image n'est pas un
// arrêt même s'il n'est pas publiable.
async function relireJournal(fournisseur, code) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const constats = lireJournalTache(racine);
  // Ce que le dernier réimport a signalé survit à la compilation qui le suit : un tableau
  // en conflit reste vrai après un Ctrl+S, et la chaîne ne le connaît pas.
  const reimport = dernierJournal.racine === racine ? dernierJournal.reimport : [];
  // Les refus du dernier export survivent à la compilation : ils restent vrais tant que
  // l'export n'a pas été relancé, et la chaîne ne les connaît pas.
  const refusExport = dernierJournal.racine === racine ? dernierJournal.export : [];
  dernierJournal = { racine: racine, constats: fusionnerConstats(racine, constats),
                     code: code, reimport: reimport, export: refusExport };
  // Rapport automatique (lib/rapport-erreur.js) : une compilation qui s'arrête avec un code
  // de sortie non nul est une panne de la chaîne (COMPIL-ECHEC), pas un simple constat de
  // contenu — les constats (tableau-sans-entête, figure-sans-alt…) ne déclenchent JAMAIS de
  // rapport à eux seuls (décision actée du lot ; les noyer dans le dossier partagé le
  // rendrait inutile) : ils ne partent qu'en contexte, ici, quand un rapport part pour une
  // autre raison. `code === 0` (les Ctrl+S qui réussissent, l'immense majorité) ne passe
  // jamais par ici : aucun coût pour le chemin le plus fréquent.
  if (code !== 0) {
    try {
      rapportErreur.emettreRapport({
        gravite: 'erreur', source: 'chaine', code: 'COMPIL-ECHEC',
        message: 'La compilation a rendu le code de sortie ' + code + '.',
        produit: rapportErreur.produitDepuisRacine(racine, profilCourant().cle),
        journal: rapportErreur.lireExtraitFichier(path.join(racine, JOURNAL_TACHE)),
        constats: constats,
        langueInterface: langueCockpit(), vscodiumVersion: vscode.version || null
      });
    } catch (e) { /* D5 : un rapport ne doit jamais faire échouer ni ralentir la compilation */ }
  }
  majBarreControles();
  const ouverte = panneauxVue.get('controles');
  if (ouverte) { envoyerVue(ouverte, fournisseur, 'controles'); }
  const r = resumeJournal(constats);
  if (r.bloquants === 0 && r.avertissements === 0) { return; }
  const notifier = async () => {
    const bouton = T('ctl.notif.bouton');
    const ouvrir = () => vscode.commands.executeCommand('szh.vueControles');
    if (r.bloquants > 0) {
      const cle = code === 0 ? 'ctl.notif.bloquant' : 'ctl.notif.arret';
      const choix = await vscode.window.showErrorMessage(T(cle, [r.bloquants]), bouton);
      if (choix === bouton) { await ouvrir(); }
      return;
    }
    // Non bloquant : un avertissement, pas un échec. Le ton de la notification le dit, et
    // c'est tout ce que le rédacteur en verra s'il ne clique pas.
    const choix = await vscode.window.showWarningMessage(
      T('ctl.notif.avert', [r.avertissements]), bouton);
    if (choix === bouton) { await ouvrir(); }
  };
  // La notification attend qu'un QuickPick ouvert se ferme : la fin d'une compilation ne
  // doit pas interrompre le geste en cours. La barre d'état et la vue, inoffensives pour
  // le focus, ont déjà été mises à jour plus haut. Si plusieurs compilations finissent
  // pendant le geste, seul le dernier avis part — les précédents sont périmés.
  differer('notif-journal', () => {
    notifier().catch(() => { /* un avis raté ne casse pas la compilation */ });
  });
}

const VUES = {
  traductions: { charge: vueTraductions, id: 'szhVueTraductions' },
  word: { charge: vueWord, id: 'szhVueWord' },
  controles: { charge: vueControles, id: 'szhVueControles' }
};

// Hors de ouvrirVueEnsemble : la fin d'une compilation doit pouvoir rafraîchir une vue
// déjà ouverte sans repasser par la commande, qui la révélerait sous les yeux du rédacteur.
function envoyerVue(panneau, fournisseur, type) {
  const charge = VUES[type].charge(fournisseur);
  repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, charge, {
    accent: lireCouleurAccent(fournisseur.racine), i18n: textesVueEnsemble()
  }));
  panneau.title = charge.titre;
}

async function ouvrirVueEnsemble(fournisseur, rafraichirTout, type) {
  if (!fournisseur.racine || !VUES[type]) { return; }
  const def = VUES[type];
  const envoyer = (panneau) => envoyerVue(panneau, fournisseur, type);
  const ouvert = panneauxVue.get(type);
  if (ouvert) { ouvert.reveal(vscode.ViewColumn.One); envoyer(ouvert); return; }
  const charge = def.charge(fournisseur);
  const panneau = vscode.window.createWebviewPanel(
    def.id, charge.titre, vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauxVue.set(type, panneau);
  panneau.onDidDispose(() => { if (panneauxVue.get(type) === panneau) { panneauxVue.delete(type); } });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) { envoyer(panneau); return; }
    if (msg.type === MSG.OUVRIR) {
      // Par la commande, et non par la fonction : c'est cmdEcriture qui porte la garde du
      // verrou. Ouvrir en direct laissait écrire un numéro verrouillé, l'enregistrement
      // automatique du panneau de traduction s'en chargeant trois secondes plus tard.
      if (type === 'traductions') {
        await vscode.commands.executeCommand('szh.traduction', { slug: String(msg.cle || '') });
      }
      if (type === 'controles') {
        await vscode.commands.executeCommand('szh.ouvrirArticle', String(msg.cle || ''));
      }
      return;
    }
    if (msg.type !== MSG.ACTION) {
      console.warn('vue d’ensemble : type de message inconnu', msg.type);
      return;
    }
    // L'état part après le re-rendu : « valeurs » reconstruit la barre, et donc efface la
    // zone d'état. Une commande déléguée qui lève ne doit pas laisser la vue périmée.
    let dit = null;
    try {
      dit = await actionVue(fournisseur, rafraichirTout, type, String(msg.id || ''),
        String(msg.cle || ''));
    }
    catch (e) { dit = T('err.commande', [e && e.message ? e.message : String(e)]); }
    if (panneauxVue.get(type) !== panneau) { return; }
    envoyer(panneau);
    if (dit) { repondrePanneau(panneau, { type: 'etat', message: dit }); }
  });
  panneau.webview.html = htmlVueEnsemble(crypto.randomBytes(16).toString('hex'), charge.titre);
}

// Le bouton d'un constat : « <lieu>:<objet> », tel que actionsConstat l'a formé et que la
// page l'a renvoyé. Une seule fonction pour les huit destinations — c'est tout ce qui
// remplace le `if` en dur qui ne servait qu'à un code sur cinquante-cinq.
//
// `focus` dit à la page visée ce qu'elle doit amener à l'écran : le formulaire des médias
// déplie l'image nommée et pose le curseur là où il y a quelque chose à écrire ; les
// commandes qui ne savent pas encore le lire l'ignorent sans rien casser.
async function ouvrirCible(id, cle) {
  const sep = id.indexOf(':');
  const lieu = sep === -1 ? id : id.slice(0, sep);
  const focus = sep === -1 ? '' : id.slice(sep + 1);
  const entree = tableConstats.LIEUX[lieu];
  if (!entree) { return; }
  await vscode.commands.executeCommand(entree.commande, { slug: String(cle || ''), focus: focus });
}

// Les commandes globales d'une section. Celles qui écrivent partout sont confirmées : un
// clic ne doit pas repasser tout un numéro en relecture par surprise.
// -> le message à afficher dans la barre, ou null.
// `cle` est vide pour les commandes de la barre, et porte la ligne pour un bouton de carte.
async function actionVue(fournisseur, rafraichirTout, type, id, cle) {
  if (type === 'traductions') {
    if (id === 'envoyer') { await vscode.commands.executeCommand('szh.envoyerTraduction'); return null; }
    const statuts = { 'tout-traduction': 'pret-traduction', 'tout-relecture': 'pret-relecture', 'tout-finalise': 'finalise' };
    const statut = statuts[id];
    if (!statut) { return null; }
    if (refuserSiVerrouille()) { return null; }
    // Les trois écrivent partout, y compris à rebours du flux : on confirme les trois.
    const bouton = T('vue.confirmer');
    const choix = await vscode.window.showWarningMessage(
      T('trad.vue.tout.question', [T('trad.statut.' + statut)]),
      { modal: true, detail: T('trad.vue.tout.detail') }, bouton);
    if (choix !== bouton) { return null; }
    return T('vue.faits', [marquerToutStatutRevue(fournisseur, rafraichirTout, statut, false)]);
  }
  if (type === 'controles') {
    // Recompiler refait tous les contrôles : c'est le seul geste global de cette vue, le
    // reste se corrige article par article.
    if (id === 'recompiler') { await vscode.commands.executeCommand('szh.toutExporter'); }
    else { await ouvrirCible(id, cle); }
    return null;
  }
  if (type === 'word') {
    if (id === 'convertir') { await vscode.commands.executeCommand('szh.convertirEnAttente'); return null; }
    // Le bouton d'une carte : le Word corrigé d'un article qui existe déjà.
    if (id === 'reimporter' && cle) {
      await vscode.commands.executeCommand('szh.reimporterArticle', { word: cle });
      return null;
    }
    if (id !== 'vider') { return null; }
    if (refuserSiVerrouille()) { return null; }
    // Une conversion en cours parcourt ce dossier : lui retirer ses fichiers sous les pieds
    // fait échouer l'import et efface l'article a moitié écrit.
    if (session.buildEnCours() || session.importEnCours()) { return T('statut.occupe'); }
    const dossierWord = path.join(fournisseur.racine, profilCourant().depot);
    const noms = fournisseur._docxEnAttente(dossierWord);
    if (noms.length === 0) { return null; }
    const bouton = T('word.vue.vider.bouton');
    const choix = await vscode.window.showWarningMessage(
      T('word.vue.vider.question', [noms.length]),
      { modal: true, detail: T('word.vue.vider.detail') }, bouton);
    if (choix !== bouton) { return null; }
    const erreurs = [];
    for (const nom of noms) {
      try { fs.unlinkSync(path.join(dossierWord, nom)); }
      catch (e) { erreurs.push(nom); }
    }
    if (erreurs.length > 0) { vscode.window.showErrorMessage(T('word.vue.vider.erreur', [erreurs.join(', ')])); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('word.vue.vide', [noms.length - erreurs.length]);
  }
  return null;
}

// ---- Vue « Articles » -----------------------------------------------------------
//
// La vue qui monte un numéro : l'ordre des articles, l'avancement de chacun, et les
// métadonnées du numéro au même endroit, parce qu'on les regarde ensemble. Elle a sa page
// (media/articles.*) parce qu'elle porte un formulaire, mais rien n'y est recopié : ses
// cartes et sa barre sont celles des autres vues d'ensemble (SZH.listeCartes,
// SZH.barreBoutons) et son formulaire du numéro est celui de la page « Méta-données du
// numéro » (SZH.formulaireNumero).

let panneauVueArticles = null;

function textesArticles() {
  return Object.assign(textesNumero(), {
    // « Ouvrir l'article » et non « Ouvrir » : sur cette vue, la carte EST un article, et
    // le bouton se lit aussi bien dans la barre de titre que dans le pied. `vue.ouvrir`
    // reste « Ouvrir » pour « Traductions » et « Word en attente », où la carte est un bloc
    // de traduction ou un fichier.
    ouvrir: T('art.ouvrir'),
    ouvrirTip: T('art.ouvrir.tip'),
    // `listeVide` et non `rien` : `rien` est déjà « Aucune modification » dans la table du
    // formulaire du numéro, que cette table étend.
    listeVide: T('art.vue.rien'),
    tachesTitre: T('art.taches.titre'),
    // Le titre compact de l'encadré des tâches, sur chaque carte — à ne pas
    // confondre avec tachesTitre ci-dessus, celui de la modale de réglage des intitulés.
    tachesEntete: T('art.taches.entete'),
    tachesAide: T('art.taches.aide'),
    tachesFr: T('art.taches.fr'),
    tachesDe: T('art.taches.de'),
    tachesAjouter: T('art.taches.ajouter'),
    tachesRetirer: T('art.taches.retirer'),
    tachesEnregistrer: T('form.enregistrer'),
    tachesEnregistrees: T('art.taches.enregistrees'),
    tachesFermer: T('art.taches.fermer'),
    // Les deux titres des groupes de constats, dans l'encadré « À faire » de la carte :
    // ce qui mérite un regard, puis ce qui arrêtera la publication.
    constatsAttention: T('art.constats.attention'),
    constatsDanger: T('art.constats.danger'),
    // Le bouton qui replie l'aperçu des métadonnées d'une carte. Deux libellés, parce
    // qu'il dit le geste à venir et non l'état courant.
    metaVoir: T('art.meta.voir'),
    metaCacher: T('art.meta.cacher'),
    metaBasculeTip: T('art.meta.basculer.tip'),
    // La case « pas de DOI » : le seul texte que la page écrit elle-même. Les intitulés et
    // les valeurs de l'aperçu, eux, arrivent tout faits dans chaque ligne — c'est l'hôte qui
    // sait dire une licence ou une rubrique.
    doiCase: T('art.doi.case'),
    doiCaseTip: T('art.doi.case.tip'),
    revues: { revue: T('meta.revue.revue'), zeitschrift: T('meta.revue.zeitschrift') }
  });
}

function htmlArticles(nonce) {
  return construireHtml('articles', nonce, {
    cssPartage: ['_design.css', '_liste.css', '_numero.css'], jsPartage: ['_messages.js', '_numero.js'],
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'",
    titre: T('art.vue.titre'), remplacements: { '__TXT__': JSON.stringify(textesArticles()) }
  });
}

// Plus aucune pastille dans le pied d'une carte d'article — ni compteur d'images, ni
// avancement des tâches.
//
// Le compteur d'images redisait en abrégé ce que l'encadré « À faire » écrit déjà en
// toutes lettres : « ⚠ 1 image(s) » dans le pied, juste sous « 1 image(s) apportent une
// information et n'ont pas de texte alternatif ». Le même reproche montré deux fois se
// compte deux fois à la lecture, et l'abrégé ne disait pas ce qui manquait. Ce qui manque
// se lit donc dans les constats (constatsCarte), et l'avancement des tâches dans
// l'entête « À faire » (resumeTachesLigne), à côté des cases qu'il résume.
//
// Rien n'est perdu au passage : le nombre total d'images n'était un reproche que par
// accident, quand il portait le ton « attention » d'un manque décrit en dessous.

// Le résumé de l'avancement des tâches d'une carte, pour l'entête « À faire » :
// -> { texte, toutes } ou null quand la revue ne définit aucune tâche — l'entête ne
// montre alors pas de compteur, il n'y a rien à compter.
function resumeTachesLigne(avance) {
  if (!avance || avance.total === 0) { return null; }
  return {
    texte: avance.toutes ? T('art.taches.toutes') : T('art.taches.avancement', [avance.faites, avance.total]),
    toutes: !!avance.toutes
  };
}

// ---- L'aperçu des métadonnées, sur la carte --------------------------------------
//
// Non éditable, et c'est tout l'intérêt : on regarde une carte d'article vingt fois pour
// une fois qu'on la corrige, et un formulaire ouvert est un formulaire où l'on efface par
// mégarde. Les deux boutons du pied mènent aux formulaires qui, eux, écrivent.
//
// « Le plus compact possible mais lisible » : une ligne par champ, un badge de langue au
// lieu d'un intitulé répété, et les textes longs coupés. Ce qui est coupé est décidé ici et
// non deviné : le résumé et les mots-clés sont les deux seuls champs dont la longueur n'a
// pas de limite, et les seuls vraiment tronqués.
const APERCU_COURT = 90;      // titre, sous-titre : un titre de la revue tient là-dedans
const APERCU_LONG = 130;      // résumé, mots-clés : de quoi reconnaître, pas de quoi relire

function couperApercu(texte, limite) {
  const t = String(texte === undefined || texte === null ? '' : texte).replace(/\s+/g, ' ').trim();
  return t.length <= limite ? t : t.slice(0, limite - 1).replace(/\s+\S*$/, '') + '…';
}

// Une ligne « un intitulé, une valeur par langue ». Seules les langues où quelque chose est
// écrit paraissent : un article monolingue ne montre pas deux lignes vides.
//
// `langues` restreint la ligne à ce qui doit se lire — la seule langue de l'article quand
// « Cacher les traductions » est en service. Une restriction d'AFFICHAGE, et rien d'autre :
// les textes des autres langues sont toujours là, dans la fiche, et l'article s'exporte
// avec eux.
function ligneApercuLangues(libelle, map, limite, langues) {
  const valeurs = [];
  for (const l of (langues || LANGUES_META)) {
    const t = couperApercu((map || {})[l], limite);
    if (t !== '') { valeurs.push({ marque: l.toUpperCase(), texte: t }); }
  }
  return { libelle: libelle, valeurs: valeurs };
}

// Les mots-clés : une ligne par langue, la liste mise à plat. Le séparateur est celui des
// listes du cockpit.
function ligneApercuMotsCles(meta, langues) {
  const plat = {};
  for (const l of LANGUES_META) {
    const liste = ((meta.keywords || {})[l] || []).map((x) => String(x).trim()).filter((x) => x !== '');
    if (liste.length > 0) { plat[l] = liste.join(' · '); }
  }
  return ligneApercuLangues(T('trad.champ.keywords'), plat, APERCU_LONG, langues);
}

// Les auteur·e·s : l'identité d'abord, puis ce qui la situe, puis en badges ce que la fiche
// porte déjà — l'ORCID, l'adresse, la photo. Les valeurs elles-mêmes ne sont pas affichées :
// une adresse d'auteur·e n'a rien à faire dans un aperçu qui reste ouvert à l'écran.
function ligneApercuAuteurs(meta) {
  const valeurs = [];
  for (const a of (meta.author || [])) {
    const identite = [a.prenom, a.nom].map((x) => String(x || '').trim()).filter((x) => x !== '');
    const situe = [a.fonction, a.affiliation].map((x) => String(x || '').trim()).filter((x) => x !== '');
    const marques = [];
    if (String(a.orcid || '').trim() !== '') { marques.push(T('art.apercu.orcid')); }
    if (String(a.email || '').trim() !== '') { marques.push(T('art.apercu.courriel')); }
    if (String(a.photo || '').trim() !== '') { marques.push(T('art.apercu.photo')); }
    valeurs.push({
      marque: '',
      // Le prénom et le nom font UN nom, séparés d'une espace ; ce qui situe la personne
      // vient après, derrière le point médian des listes du cockpit.
      texte: couperApercu([identite.join(' ')].concat(situe).filter((x) => x !== '').join(' · '),
        APERCU_LONG),
      marques: marques
    });
  }
  return { libelle: T('fiches.auteurs'), valeurs: valeurs };
}

// Le nom court de la licence : « CC-BY 4.0 ». La table de lib/yaml.js le porte déjà, sauf
// pour « droits réservés », qui n'a pas de nom imprimable — d'où la seule exception.
function nomCourtLicence(valeur) {
  const cle = normaliserLicence(valeur) || LICENCE_DEFAUT;
  if (cle === 'droits-reserves') { return T('art.apercu.licence.reservee'); }
  for (const l of LICENCES_ARTICLE) { if (l.cle === cle) { return l.nom; } }
  return '';
}

// Année du numéro : celle de la date de publication si elle y est, sinon celle du nom du
// dossier (« 2027-03 »). Même repli que le titre de la vue : la date est vide jusqu'à la
// parution, et sans ce repli le DOI d'un numéro en préparation serait incalculable tout du
// long — c'est-à-dire pendant tout le temps où il sert.
function anneeNumero(racine, valeurs) {
  const annee = (String((valeurs || {}).date || '').match(/\d{4}/) || [''])[0];
  if (annee !== '') { return annee; }
  return (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
}

// La ligne DOI de l'aperçu, et ce qu'il faut dire à côté. -> { ligne, constats }
//
// Le DOI est un calcul : le rang de l'article parmi ceux qui en portent un, compté à partir
// de zéro, d'où l'éditorial en « 00 ». Rien ne le stocke — sauf l'échappatoire : un doi
// resté sur la fiche y a été défini à la main (case « Définir manuellement le DOI » du
// formulaire des métadonnées), et c'est lui qui part vers OJS à la place du calculé.
// La carte affiche ce qui part : le manuel quand il existe, étiqueté « manuel » pour que
// la provenance se voie d'un coup d'œil, le calculé sinon, étiqueté « calculé » comme
// avant. La divergence entre les deux reste un constat : elle ne se devine pas.
// FORME_DOI (motif + exemple par revue) vient de l'import de tête de lib/export-ojs
// (doiCalcule et consorts) : pas de second require ici.

function apercuDoi(locale, annee, numeroRevue, rang, doiFiche, voulu) {
  const fiche = String(doiFiche || '').trim();
  const constats = [];
  if (rang === -1) {
    // Un DOI manuel sur un article qui n'en reçoit pas : rien ne part, la ligne dit
    // « aucun » — c'est ce qui part — et le constat dit le doi resté sur la fiche.
    if (fiche !== '') { constats.push({ ton: 'attention', texte: T('art.doi.fiche.inutile', [fiche]) }); }
    return {
      ligne: { marque: '', texte: T(voulu ? 'art.doi.aucun.voulu' : 'art.doi.aucun.rubrique') },
      constats: constats
    };
  }
  const calcule = doiCalcule(locale, annee, numeroRevue, rang);
  if (fiche !== '') {
    // Le manuel s'affiche tel quel, calculable ou non — incalculable n'étouffe rien, le
    // manuel partira dès que le numéro sera complet. La divergence ne se dit que quand il
    // y a deux valeurs à comparer — et c'est alors seulement qu'il faut départager les deux
    // causes, miroir exact de la logique de l'export (voir FORME_DOI, export-ojs.js ~152) :
    // une forme étrangère à la revue n'a jamais pu être déposée telle quelle, une forme de
    // la maison a pu l'être pour de bon.
    if (calcule !== '' && fiche !== calcule) {
      const forme = FORME_DOI[locale];
      constats.push({ ton: 'attention', texte: (forme && !forme.motif.test(fiche))
        ? T('art.doi.forme', [forme.exemple])
        : T('art.doi.fiche.autre', [fiche, calcule]) });
    }
    return { ligne: { marque: '', texte: fiche, marques: [T('art.doi.manuel')] },
             constats: constats };
  }
  if (calcule === '') {
    return { ligne: { marque: '', texte: T('art.doi.incalculable'), ton: 'attention' },
             constats: constats };
  }
  return { ligne: { marque: '', texte: calcule, marques: [T('art.doi.calcule')] },
           constats: constats };
}

// Ce que les images de l'article disent sans qu'on ouvre leur gestionnaire. La lecture est
// la sienne — lireAttributsImage, celle de lib/references.js, et la liste de fichiers de
// media/ — ce qui laisse dehors les photos des autrices et auteurs, rangées dans portraits/.
function resumeImagesArticle(fournisseur, slug) {
  const md = path.join(fournisseur.racine, dossierUnites(), slug, slug + '.md');
  let texte = '';
  try { texte = fs.readFileSync(md, 'utf8'); } catch (e) { return resumeImages([]); }
  return resumeImages(fournisseur._imagesArticle(slug).map((relatif) => {
    const v = lireAttributsImage(texte, relatif);
    return { relatif: relatif, legende: v.legende, alt: v.alt,
             altDefini: v.altDefini, horsFigure: v.horsFigure };
  }));
}

// Ce que la carte doit signaler, en toutes lettres et dans son encadré « À faire » —
// jamais dans une infobulle : les images incomplètes, puis l'état des références relevé à
// la dernière compilation.
//
// Le ton ne se décide plus ici : il vient de lib/constats.js, comme dans la liste
// « À corriger ». Ces constats-là forçaient tous « attention », et une image muette
// paraissait donc bénigne sur la carte au moment même où elle arrêtait l'export deux
// écrans plus loin.
//
// La carte résume, la liste détaille : ici un constat par FAMILLE de défaut avec son
// compte entre parenthèses, là-bas un constat par image et par appel, chacun avec son
// bouton. Les deux partagent l'intitulé — « Figure sans texte alternatif » — pour qu'on
// reconnaisse le même défaut d'un écran à l'autre. Et aucun bouton sur ces constats-ci :
// le pied de la carte porte déjà « Éditer les médias » et « Éditer les métadonnées », qui
// mènent exactement là où ces défauts se corrigent.
function constatsCarte(images, citations, contexte) {
  const constats = [];
  const langue = langueCockpit();
  const ajouter = (code, compte) => {
    if (compte <= 0) { return; }
    const brut = { source: 'cockpit', code: code, slug: '', champs: {}, args: [] };
    constats.push({ ton: tableConstats.ton(brut, contexte),
                    texte: tableConstats.phrase(brut, langue) + ' (' + compte + ')' });
  };
  ajouter('image-sans-alt', images.sansAlt);
  ajouter('image-sans-legende', images.sansLegende);
  const c = citations || null;
  if (c) {
    // Les trois codes de citations sont ceux de la chaîne : même table, même intitulé, même
    // ton que dans la liste — seul le compte remplace l'appel fautif, qu'une carte n'a pas
    // à énumérer.
    for (const code of ['appel-sans-reference', 'appel-ambigu', 'reference-orpheline']) {
      if (c[code] > 0) {
        const brut = { source: 'citations', code: code, slug: '', champs: {}, args: [] };
        constats.push({ ton: tableConstats.ton(brut, contexte),
                        texte: tableConstats.phrase(brut, langue) + ' (' + c[code] + ')' });
      }
    }
  }
  return constats;
}

// L'aperçu complet d'un article : neuf lignes, dans l'ordre où on les lit — ce que
// l'article est, ce qu'il dit, qui l'a écrit, sous quelles conditions il paraît.
//
// `langueSeule` — le code de la langue de l'article, ou '' — réduit les quatre lignes
// bilingues (titre, sous-titre, résumé, mots-clés) à cette seule langue : c'est le bouton
// « Cacher les traductions » de la vue. Les cinq autres lignes n'ont pas de langue et ne
// bougent pas. Rien n'est perdu ni modifié : l'autre langue est toujours dans la fiche, et
// le bouton la remontre.
function apercuArticle(meta, langue, doi, langueSeule) {
  const type = String(meta.type || '').trim();
  const langueArticle = normaliserLangueArticle(meta.lang);
  const vide = T('art.apercu.vide');
  // Une langue hors des trois de la revue, ou aucune, ne restreint rien : mieux vaut
  // montrer les quatre lignes en entier que les vider en silence.
  const langues = LANGUES_META.indexOf(langueSeule) !== -1 ? [langueSeule] : LANGUES_META;
  const seule = (libelle, texte) => ({
    libelle: libelle,
    valeurs: [{ marque: '', texte: String(texte || '') !== '' ? String(texte) : vide }]
  });
  return {
    lignes: [
      seule(T('art.apercu.type'), (LIBELLES_TYPES[type] || {})[langue] || type),
      seule(T('art.apercu.langue'),
        langueArticle === '' ? T('art.apercu.langue.numero') : T('meta.langue.' + langueArticle)),
      ligneApercuLangues(T('trad.champ.title'), meta.title, APERCU_COURT, langues),
      ligneApercuLangues(T('trad.champ.subtitle'), meta.subtitle, APERCU_COURT, langues),
      ligneApercuLangues(T('trad.champ.resume'), meta.resume, APERCU_LONG, langues),
      ligneApercuMotsCles(meta, langues),
      ligneApercuAuteurs(meta),
      seule(T('art.apercu.licence'), nomCourtLicence(meta.licence)),
      { libelle: T('art.apercu.doi'), valeurs: [doi] }
    ].map((l) => (l.valeurs.length > 0 ? l : { libelle: l.libelle, valeurs: [{ marque: '', texte: vide }] }))
  };
}

// Une carte par article, dans l'ordre du numéro : son nom, son slug, l'aperçu complet de
// ses métadonnées, ses tâches cochables, ce qui lui manque, et de quoi le déplacer d'un
// cran. Tout se lit sans rien ouvrir ; les deux boutons du pied mènent aux formulaires qui
// écrivent, et sont les seuls à écrire.
function chargeArticles(fournisseur) {
  const racine = fournisseur.racine;
  const langue = langueRevue(racine);
  const interface_ = langueCockpit();
  // Les cartes tirent leur ton de la même table que la liste « À corriger » : il faut donc
  // le même contexte, celui qui dit si la validation PDF/UA tourne sur ce poste.
  const contexte = contexteConstats();
  // La configuration du poste, lue une fois : elle porte les intitulés des tâches ET les
  // deux interrupteurs d'affichage de la vue.
  const configPoste = lireConfigPoste();
  // Ce que les interrupteurs cachent n'est pas envoyé du tout — pas envoyé puis masqué en
  // CSS : une carte sans tâches et sans traductions est vraiment plus courte, et le message
  // qui la porte aussi.
  const vue = vueArticlesConfig(configPoste);
  const taches = tachesDuNumero(racine);
  // Dans le mode « Changer l'ordre », l'ordre affiché est celui qu'on est en train de
  // composer : rien n'a encore été écrit, ni dans ausgabe.yaml ni sur le disque.
  const enOrdre = ordreEnCours(racine);
  const slugs = enOrdre || fournisseur.listerArticles();
  let valeurs = {};
  try { valeurs = analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')); }
  catch (e) { /* illisible : le DOI sera dit incalculable, ce qui est vrai */ }
  const locale = langueDefaut(valeurs);
  const annee = anneeNumero(racine, valeurs);
  const numeroRevue = String(valeurs.numero || '').trim();
  // Les fiches sont lues une fois : elles servent au titre, à l'aperçu, et au verdict
  // « cette rubrique ne reçoit pas de DOI » qui décide de l'ordre.
  const metas = {};
  const types = {};
  for (const slug of slugs) {
    metas[slug] = lireMetaArticle(racine, slug);
    types[slug] = metas[slug].type;
  }
  // Deux jeux, et la nuance compte pour la case : `voulus` est ce que la rédaction a
  // coché, `sansDoi` y ajoute les rubriques qui n'en reçoivent jamais. Une case cochée par
  // la rubrique se montre verrouillée, puisque la décocher ne changerait rien.
  const voulus = new Set(slugsSansDoiVoulu(racine));
  const sansDoi = articlesSansDoi(racine, slugs, { types: types, voulus: [...voulus] });
  const citations = citationsParArticle(constatsCourants(racine));
  // Le DOI EFFECTIF de chaque article — sa fiche si elle n'est pas vide, sinon le calculé,
  // exactement ce que collecter() envoie à l'export (lib/export-ojs.js) — calculé pour tous
  // les articles avant la boucle qui construit les cartes : un doublon se voit des DEUX
  // côtés, et le second article de la paire n'a pas encore sa carte quand le premier
  // construit la sienne.
  const effectifs = {};
  for (const slug of slugs) {
    const fiche = String((metas[slug] && metas[slug].doi) || '').trim();
    effectifs[slug] = fiche !== ''
      ? fiche : doiCalcule(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi));
  }
  const parDoiEffectif = {};
  for (const slug of slugs) {
    const v = effectifs[slug];
    if (!v) { continue; }
    if (!parDoiEffectif[v]) { parDoiEffectif[v] = []; }
    parDoiEffectif[v].push(slug);
  }
  const lignes = slugs.map((slug, index) => {
    const meta = metas[slug];
    const titre = titreFiche(meta, langue);
    const faites = lireTachesArticle(racine, slug).faites;
    const avance = resumeTaches(taches, faites);
    const images = resumeImagesArticle(fournisseur, slug);
    const doi = apercuDoi(locale, annee, numeroRevue, rangDoi(slugs, slug, sansDoi),
      meta.doi, voulus.has(slug));
    const constats = doi.constats.concat(constatsCarte(images, citations.get(slug), contexte));
    // Un DOI qui désigne aussi un autre article : les deux cartes le disent, chacune
    // nommant l'autre.
    const autresMemeDoi = (parDoiEffectif[effectifs[slug]] || []).filter((s) => s !== slug);
    // Bloquant, et c'est l'export qui le dit : deux articles au même DOI comptent parmi
    // ses `bloquants` (lib/export-ojs.js, ojs.err.doi.double), rien ne part du tout.
    if (autresMemeDoi.length > 0) {
      constats.push({ ton: 'danger', texte: T('art.doi.double', [autresMemeDoi[0]]) });
    }
    // Un article sans titre reste dans la liste, et la carte dit pourquoi elle montre un
    // slug : la compilation refusera de partir sur cet article, et il faut le savoir ici.
    // Bloquant aussi, et le message le dit déjà : sans titre dans sa fiche, la compilation
    // de cet article refuse de partir.
    if (titre === '') { constats.unshift({ ton: 'danger', texte: T('art.sansfiche') }); }
    return {
      cle: slug,
      titre: libelleArticle(index, slug, titre),
      // Plus de `meta: slug` : le slug redisait dans l'entête ce que le titre numéroté
      // vient de dire. Il reste l'identifiant technique de l'article — la carte le
      // porte encore en infobulle du titre, côté webview (media/articles.js), à partir de
      // `cle` ci-dessus, qui vaut toujours ce même slug.
      // Pas de bouton « Ouvrir » posé par le composant : il le mettrait en tête du pied,
      // alors qu'il ferme la série des gestes de la carte. Il est ajouté en dernier dans
      // `actions` ci-dessous, avec la flèche de l'entête.
      ouvrir: false,
      // La langue de l'article, ou celle du numéro quand la fiche n'en déclare pas : c'est
      // exactement le repli que la compilation applique, donc la langue dans laquelle
      // l'article paraîtra.
      apercu: apercuArticle(meta, interface_, doi.ligne,
        vue.cacherTraductions ? (normaliserLangueArticle(meta.lang) || langue) : ''),
      constats: constats,
      // La case « pas de DOI ». Verrouillée quand c'est la rubrique qui décide : cocher ou
      // décocher n'y changerait rien, et un interrupteur sans effet est un mensonge.
      sansDoi: {
        coche: sansDoi.has(slug),
        verrouille: !voulus.has(slug) && sansDoi.has(slug)
      },
      // L'avancement de ses tâches, pour l'entête « À faire » de la carte — jamais en
      // pastille du pied, qui n'en porte plus aucune (voir le bloc au-dessus de
      // resumeTachesLigne).
      tachesResume: resumeTachesLigne(avance),
      // L'ordre du pied suit celui du travail : on déplace l'article dans le numéro, on
      // remplit ses formulaires, on l'envoie à son auteur, et on l'ouvre — « Ouvrir »
      // ferme donc la série au lieu de l'ouvrir. C'est le geste qu'on fait après avoir lu
      // la carte, pas avant.
      //
      // Dans le mode « Changer l'ordre », les deux flèches seules : ouvrir un formulaire
      // sur un dossier qui est sur le point d'être renommé n'a pas de sens.
      actions: enOrdre ? [
        { id: 'monter', libelle: T('art.monter'), icone: 'haut', tip: T('art.monter.tip'),
          desactive: index === 0 },
        { id: 'descendre', libelle: T('art.descendre'), icone: 'bas', tip: T('art.descendre.tip'),
          desactive: index === slugs.length - 1 }
      ] : [
        // Aux bords de son bloc, et non de la liste : un article sans DOI ne remonte pas
        // au-dessus de ceux qui en portent un, sinon la numérotation cesserait de suivre
        // l'ordre de lecture. Le bouton refuse là où l'hôte refuserait de toute façon.
        { id: 'monter', libelle: T('art.monter'), icone: 'haut', tip: T('art.monter.tip'),
          desactive: refusDeplacement(slugs, slug, -1, sansDoi) !== '' },
        { id: 'descendre', libelle: T('art.descendre'), icone: 'bas', tip: T('art.descendre.tip'),
          desactive: refusDeplacement(slugs, slug, 1, sansDoi) !== '' },
        // Les deux formulaires, ouverts sur cet article. Le pied de carte est le seul
        // endroit d'où l'on écrit : l'aperçu au-dessus ne se modifie pas.
        { id: 'metadonnees', libelle: T('art.meta.editer'), icone: 'info',
          tip: T('art.meta.editer.tip') },
        { id: 'medias', libelle: T('art.medias.editer'), icone: 'camera',
          tip: T('art.medias.editer.tip') },
        { id: 'envoyer', libelle: T('art.envoyer'), icone: 'traduction', tip: T('art.envoyer.tip') },
        // Le même geste que la flèche de l'entête, même libellé et même icône : sur une
        // carte dépliée, le pied est à un écran de distance du titre.
        { id: 'ouvrir', libelle: T('art.ouvrir'), icone: 'fleche', tip: T('art.ouvrir.tip') }
      ],
      taches: vue.cacherTaches ? [] : taches.map((t) => ({
        id: t.id, libelle: libelleTache(t, interface_), faite: faites.indexOf(t.id) !== -1
      }))
    };
  });
  return {
    titre: T('art.vue.titre'),
    boutons: [
      { id: 'importer', libelle: T('art.importer'), icone: 'fleche', principal: true },
      { id: 'taches', libelle: T('art.taches.reglage'), icone: 'ok', tip: T('art.taches.reglage.tip') },
      // Les trois interrupteurs d'affichage. Le libellé dit le geste à venir, jamais l'état
      // courant : un bouton « Cacher les tâches » sur une liste déjà sans tâches se lirait
      // comme une case cochée, et personne ne saurait plus comment les faire revenir.
      { id: 'cacher-taches', icone: 'oeil',
        libelle: T(vue.cacherTaches ? 'art.taches.afficher' : 'art.taches.cacher'),
        tip: T(vue.cacherTaches ? 'art.taches.afficher.tip' : 'art.taches.cacher.tip') },
      { id: 'cacher-traductions', icone: 'oeil',
        libelle: T(vue.cacherTraductions ? 'art.trad.afficher' : 'art.trad.cacher'),
        tip: T(vue.cacherTraductions ? 'art.trad.afficher.tip' : 'art.trad.cacher.tip') },
      { id: 'cacher-meta', icone: 'oeil',
        libelle: T(vue.cacherMeta ? 'art.meta.voir' : 'art.meta.cacher'),
        tip: T(vue.cacherMeta ? 'art.meta.voir.tip' : 'art.meta.cacher.tip') }
    ].concat(enOrdre
      // Dans le mode, la barre ne propose plus que d'en sortir : par le haut ou par le bas.
      ? [{ id: 'ordre-terminer', libelle: T('art.ordre.terminer'), icone: 'ok', principal: true,
           tip: T('art.ordre.terminer.tip') },
         { id: 'ordre-annuler', libelle: T('art.ordre.annuler'), icone: 'fermer',
           tip: T('art.ordre.annuler.tip') }]
      : [{ id: 'ordre', libelle: T('art.ordre.mode'), icone: 'liste',
           tip: T('art.ordre.mode.tip') }]),
    // La page gèle ce qui n'a pas de sens pendant qu'on réordonne.
    ordre: !!enOrdre,
    // L'aperçu part toujours, même replié : contrairement aux tâches, que l'interrupteur
    // vide pour de bon, celui-ci ne fait que décider l'état de départ des cartes. Le
    // chevron de chaque carte reste donc capable d'en déplier une seule, sans aller-retour
    // avec l'hôte.
    metaRepliees: vue.cacherMeta,
    lignes: lignes,
    taches: tachesConfig(configPoste),
    revue: revueNumero(racine)
  };
}

// Les seuls types que actionArticle (ci-dessous) sait traiter : la vue Articles s'en sert
// pour reconnaître un message inconnu avant de l'appeler, plutôt que de laisser un type
// jamais vu retomber sur « rien à faire » et recharger toute la liste pour rien.
const TYPES_ACTION_ARTICLE = [MSG.COMMANDE, MSG.TACHE, MSG.TACHES_ENREGISTRER, MSG.SANSDOI, MSG.ACTION];

// Les gestes de la vue. -> le message à afficher dans la barre, ou null.
async function actionArticle(fournisseur, rafraichirTout, msg) {
  const racine = fournisseur.racine;
  if (msg.type === MSG.COMMANDE) {
    if (msg.id === 'importer') { await vscode.commands.executeCommand('szh.convertirEnAttente'); }
    // Les trois interrupteurs d'affichage. Réglage de poste et non de numéro — ce qu'on
    // choisit de lire ne dépend pas du numéro ouvert — donc le verrou du numéro ne s'y
    // applique pas, pas plus qu'au réglage des tâches juste en dessous.
    // Le mode « Changer l'ordre ». Entrer et sortir n'écrit rien ; seul « Terminer »
    // renomme, et d'un seul lot.
    if (msg.id === 'ordre') {
      if (refuserSiVerrouille()) { return null; }
      modeOrdre = { racine: racine, slugs: fournisseur.listerArticles() };
      return null;
    }
    if (msg.id === 'ordre-annuler') { modeOrdre = null; return null; }
    if (msg.id === 'ordre-terminer') {
      const voulu = ordreEnCours(racine);
      modeOrdre = null;
      if (!voulu) { return null; }
      const r = renumerotation.renumeroter(racine, voulu, { dossier: dossierUnites() });
      if (r.erreur) { return T('art.ordre.echec', [r.erreur]); }
      // Les constats nomment les anciens slugs : ils sont périmés pour les articles
      // renommés, et la prochaine compilation les reposera sous leur nouveau nom.
      if (r.renommes > 0 && dernierJournal.racine === racine) {
        dernierJournal.constats = [];
        majBarreControles();
      }
      if (rafraichirTout) { rafraichirTout(); }
      return r.renommes === 0 ? null : T('art.ordre.fait', [r.renommes]);
    }
    const bascules = {
      'cacher-taches': 'cacherTaches',
      'cacher-traductions': 'cacherTraductions',
      'cacher-meta': 'cacherMeta'
    };
    const cle = bascules[String(msg.id || '')];
    if (cle) {
      const avant = lireConfigPoste();
      // Illisible n'est pas absent : on n'écrase pas ce qu'on n'a pas su lire, sans quoi
      // l'emplacement des revues et la configuration OJS partiraient avec.
      if (avant === null && fs.existsSync(CONFIG_POSTE)) { return T('err.ecriture', [path.basename(CONFIG_POSTE), CONFIG_POSTE]); }
      const etat = vueArticlesConfig(avant);
      const erreur = ecrireConfigPoste(configAvecVueArticles(avant, cle, !etat[cle]));
      if (erreur) { return T('err.ecriture', [path.basename(CONFIG_POSTE), erreur]); }
      return null;                                 // la vue se repose, les cartes suivent
    }
    return null;
  }
  if (msg.type === MSG.TACHE) {
    if (refuserSiVerrouille()) { return null; }
    const slug = String(msg.cle || '');
    if (fournisseur.listerArticles().indexOf(slug) === -1) { return null; }
    const taches = tachesDuNumero(racine);
    const suivi = lireTachesArticle(racine, slug);
    const faites = basculerTache(suivi.faites, String(msg.id || ''), !!msg.cochee, taches);
    try { ecrireTachesArticle(racine, slug, { faites: faites, _inconnues: suivi._inconnues }); }
    catch (e) { return T('err.ecriture', [slug + '.taches.yaml', String((e && e.message) || e)]); }
    if (rafraichirTout) { rafraichirTout(); }      // l'arbre porte le même avancement
    const avance = resumeTaches(taches, faites);
    return { dit: T('art.taches.avancement', [avance.faites, avance.total]),
             avancement: { cle: slug,
                           // Le compteur de l'entête « À faire » suit la case cochée sans
                           // reconstruire la carte : reposer la liste entière ferait perdre
                           // au clavier le focus de la case qu'il vient d'utiliser. Plus de
                           // pastille à renvoyer avec lui, donc plus de relecture des images
                           // de l'article à chaque case cochée.
                           tachesResume: resumeTachesLigne(avance) } };
  }
  if (msg.type === MSG.TACHES_ENREGISTRER) {
    const revue = String(msg.revue || '');
    if (REVUES_TACHES.indexOf(revue) === -1) { return null; }
    // Réglage de poste, pas de numéro : le verrou du numéro ne s'y applique pas.
    const avant = lireConfigPoste();
    // Illisible — JSON malformé, fichier tenu par la synchro — n'est pas la même chose
    // qu'absent : on n'écrase pas ce qu'on n'a pas su lire, sans quoi l'emplacement des
    // revues et la configuration OJS partiraient avec.
    if (avant === null && fs.existsSync(CONFIG_POSTE)) {
      return T('err.ecriture', [path.basename(CONFIG_POSTE), CONFIG_POSTE]);
    }
    const cfg = configAvecTaches(avant, revue, Array.isArray(msg.taches) ? msg.taches : []);
    const erreur = ecrireConfigPoste(cfg);
    if (erreur) { return T('err.ecriture', [path.basename(CONFIG_POSTE), erreur]); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('art.taches.enregistrees');
  }
  // La case « pas de DOI » d'un article. Elle décide de deux choses d'un seul coup : que
  // l'article ne reçoit pas de DOI, et qu'il passe en fin de numéro — donc l'ordre est
  // réécrit avec elle, sinon le fichier dirait une chose et l'écran une autre.
  //
  // C'est l'ordre du numéro qu'elle touche : elle suit donc la même règle que les boutons
  // de déplacement, refusée sur un numéro archivé et acceptée sur un numéro verrouillé.
  if (msg.type === MSG.SANSDOI) {
    if (refuserSiArchivee()) { return null; }
    const slug = String(msg.cle || '');
    const slugs = fournisseur.listerArticles();
    if (slugs.indexOf(slug) === -1) { return null; }
    const voulus = basculerSansDoi(slugsSansDoiVoulu(racine), slug, !!msg.coche, slugs);
    const modifies = {};
    modifies[CLE_SANS_DOI] = voulus;
    // L'ordre part avec. listerArticles() applique déjà la règle à la lecture, mais le
    // fichier doit finir par dire la même chose que l'écran : il se relit à la main, et il
    // voyage seul sur SharePoint.
    modifies[cleOrdre()] = trierParDoi(slugs, articlesSansDoi(racine, slugs, { voulus: voulus }));
    // Un clic isolé ne garde pas de main : il regarde le bail de co-édition et s'abstient
    // si quelqu'un modifie ausgabe.yaml en ce moment.
    const refusBail = refusCoedition(racine, cheminConfig(racine));
    if (refusBail) { return refusBail; }
    const erreur = ecrireClesAusgabe(racine, modifies);
    if (erreur) { return T('err.ecriture', ['ausgabe.yaml', erreur]); }
    if (rafraichirTout) { rafraichirTout(); }
    return T('art.doi.enregistre', [voulus.length]);
  }
  if (msg.type !== MSG.ACTION) { return null; }
  const slug = String(msg.cle || '');
  if (msg.id === 'envoyer') {
    await envoyerAuteur(fournisseur, { slug: slug });
    return null;
  }
  // Les deux formulaires de l'article, ouverts par leur commande et non par leur fonction :
  // ce sont celles-là qui savent quel panneau réutiliser, et elles portent déjà le refus du
  // verrou. Rien n'est réécrit ici.
  if (msg.id === 'metadonnees') {
    await vscode.commands.executeCommand('szh.metadonneesArticle', { slug: slug });
    return null;
  }
  if (msg.id === 'medias') {
    await vscode.commands.executeCommand('szh.mediasArticle', { slug: slug });
    return null;
  }
  if (msg.id !== 'monter' && msg.id !== 'descendre') { return null; }
  // Dans le mode, le déplacement ne vit qu'en mémoire : ni ausgabe.yaml ni le disque ne
  // bougent avant « Terminer ».
  const enOrdre = ordreEnCours(fournisseur.racine);
  if (enOrdre) {
    modeOrdre.slugs = deplacerArticle(enOrdre, slug, msg.id === 'monter' ? -1 : 1);
    return null;
  }
  return deplacerUnite(fournisseur, slug, msg.id === 'monter' ? -1 : 1, rafraichirTout);
}

// Ce que deplacerUnite() a répondu, dans la barre d'état. null veut dire « rien à dire » :
// on ne le transforme pas en message vide, qui clignoterait pour rien.
function messageDeplacement(message) {
  if (message) { vscode.window.setStatusBarMessage(message, 4000); }
}

// Déplacer une unité d'un cran dans le sommaire — un article dans son numéro, un chapitre
// dans son livre. Partagée par la vue en cartes et par le menu contextuel de l'arbre :
// deux chemins qui écriraient chacun leur ordre finiraient par ne plus dire la même chose.
// Rend le message à afficher, ou null quand il n'y a rien à dire — être au bout de la
// liste ne se signale pas, c'est une évidence à l'écran.
function deplacerUnite(fournisseur, slug, delta, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return null; }
  // ⚠ refuserSiArchivee() et non refuserSiVerrouille() : voir la garde elle-même. Un
  // numéro verrouillé a ses textes figés, mais son sommaire peut encore se décider.
  if (refuserSiArchivee()) { return null; }
  const slugs = fournisseur.listerArticles();
  if (slugs.indexOf(slug) === -1) { return null; }
  // La règle du tri passe avant le déplacement : franchir la frontière DOI / sans DOI se
  // refuse en le disant. Sur un livre le jeu est vide — un chapitre n'a pas de DOI — et la
  // frontière n'existe donc pas.
  const refus = refusDeplacement(slugs, slug, delta, articlesSansDoi(racine, slugs));
  if (refus === 'frontiere') { return T('art.ordre.frontiere'); }
  if (refus !== '') { return null; }
  const nouveau = deplacerArticle(slugs, slug, delta);
  if (nouveau.join(' ') === slugs.join(' ')) { return null; }   // déjà au bord
  // La liste entière part dans le fichier de configuration : une liste partielle laisserait
  // les autres unités à réparer au prochain rendu.
  const modifies = {};
  modifies[cleOrdre()] = nouveau;
  const refusBail = refusCoedition(racine, cheminConfig(racine));
  if (refusBail) { return refusBail; }             // quelqu'un modifie le fichier en ce moment
  const erreur = ecrireClesAusgabe(racine, modifies);
  if (erreur) { return T('err.ecriture', ['ausgabe.yaml', erreur]); }
  if (rafraichirTout) { rafraichirTout(); }
  return T('art.ordre.enregistre', [prefixeOrdre(nouveau.indexOf(slug))]);
}

// Panneau singleton, comme les autres vues : rouvrir la commande révèle celui qui existe,
// valeurs relues du disque.
async function ouvrirVueArticles(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Ouvrir la vue d'ensemble ferme l'aperçu de la colonne 2 (HTML ou PDF) — on vient
  // embrasser le numéro, l'article quitté n'a plus à occuper l'écran. Même geste que
  // la vue Métadonnées. Les rafraîchissements en
  // tâche de fond passent par envoyerVue, pas par ici : ils ne ferment rien.
  await fermerTousLesApercus();
  const envoyer = (panneau, avecCouverture) => {
    const charge = chargeArticles(fournisseur);
    repondrePanneau(panneau, Object.assign({ type: 'valeurs' }, charge,
      chargeNumero(racine, avecCouverture), { accent: lireCouleurAccent(racine) }));
    panneau.title = charge.titre;
    noterLectureCoedition(panneau, racine, cheminConfig(racine));
  };
  if (panneauVueArticles) {
    panneauVueArticles.reveal(vscode.ViewColumn.One);
    envoyer(panneauVueArticles, true);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhVueArticles', T('art.vue.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauVueArticles = panneau;
  panneau.onDidDispose(() => {
    libererCoedition(panneau);
    if (panneauVueArticles === panneau) { panneauVueArticles = null; }
  });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) { envoyer(panneau, true); return; }
    // Le formulaire du numéro d'abord : c'est le même code que la page « Méta-données du
    // numéro », et il répond lui-même au panneau. Aucun bail n'est posé à l'ouverture de
    // cette vue — elle se consulte, et geler ausgabe.yaml pour une consultation bloquerait
    // les autres ; il se prend à la première écriture, dans messageNumero.
    if (messageNumero(panneau, racine, msg, rafraichirTout,
      () => envoyer(panneau, false))) { return; }
    if (msg.type === MSG.OUVRIR) {
      // Par la commande, pour rester sur le point d'entrée unique. sansApercu : depuis la
      // vue d'ensemble, on vient lire ou corriger le texte, pas mettre en page ; seul le
      // .md s'ouvre, sans compilation ni aperçu.
      await vscode.commands.executeCommand('szh.ouvrirArticle', String(msg.cle || ''),
        { sansApercu: true });
      return;
    }
    // Un type inconnu ne doit pas tomber dans actionArticle : celui-ci répondrait null, et
    // envoyer(panneau) plus bas rechargerait la liste entière pour un message qu'elle ne
    // connaît pas, alors qu'elle n'a rien à en faire.
    if (TYPES_ACTION_ARTICLE.indexOf(msg.type) === -1) {
      console.warn('vue Articles : type de message inconnu', msg.type);
      return;
    }
    // L'état part après le re-rendu : « valeurs » reconstruit la barre, et donc efface la
    // zone d'état.
    let dit = null;
    let avancement = null;
    try {
      const reponse = await actionArticle(fournisseur, rafraichirTout, msg);
      // Cocher une tâche rend un avancement, les autres gestes une phrase.
      if (reponse && typeof reponse === 'object') { dit = reponse.dit; avancement = reponse.avancement; }
      else { dit = reponse; }
    } catch (e) { dit = T('err.commande', [e && e.message ? e.message : String(e)]); }
    if (panneauVueArticles !== panneau) { return; }
    // Une case cochée ne fait reposer que sa pastille : « valeurs » reconstruirait la liste
    // entière, et le focus clavier quitterait la case qu'on vient d'utiliser. Dans un outil
    // dont le sujet est l'accessibilité, cela compte.
    if (avancement) { repondrePanneau(panneau, Object.assign({ type: 'avancement' }, avancement)); }
    else { envoyer(panneau); }
    if (msg.type === MSG.TACHES_ENREGISTRER) {
      repondrePanneau(panneau, { type: 'taches', taches: tachesConfig(lireConfigPoste()) });
    }
    if (dit) { repondrePanneau(panneau, { type: 'etat', message: dit }); }
  });
  panneau.webview.html = htmlArticles(crypto.randomBytes(16).toString('hex'));
}

// ---- « Envoyer à l'auteur » -----------------------------------------------------
//
// Compiler le PDF de l'article, ouvrir un brouillon adressé, et mettre la pièce jointe à un
// collage près.
//
// Trois voies ont été éprouvées sur ce poste (Windows 11 ; le nouvel Outlook est le
// gestionnaire de `mailto:`, Outlook classique est associé aux .eml) :
//
//   1. un .eml déposé sur le disque puis ouvert. Il porte destinataire, sujet, corps et
//      pièce jointe, et « X-Unsent: 1 » ouvre bien un brouillon modifiable — vérifié. Mais
//      .eml n'a aucun gestionnaire choisi : Windows affiche « Sélectionnez une application
//      pour ouvrir ce fichier .eml » et propose les deux Outlook. Le rédacteur doit
//      deviner ; le nouveau ne sait pas ouvrir un .eml, l'ancien démarre à froid en
//      cinquante secondes avec ses compléments et ses rappels, dans un client qui n'est pas
//      celui où il travaille. Écartée : elle réussit ou échoue selon le poste.
//   2. `mailto:`. Le nouvel Outlook ouvre un brouillon complet — destinataire résolu,
//      sujet et corps accentués intacts, paragraphes conservés. Sûre, et sans pièce jointe :
//      un mailto: n'en porte pas.
//   3. le presse-papiers. `Set-Clipboard -LiteralPath` pose le PDF au format CF_HDROP, et
//      un seul Ctrl+V dans le brouillon l'attache — vérifié dans le nouvel Outlook. Le
//      corps ne peut pas voyager sur le même presse-papiers : quand les deux formats y
//      sont, Outlook prend le fichier et le texte est perdu.
//
// Retenue : la 2 pour le brouillon, la 3 pour la pièce jointe. La notification dit au
// rédacteur qu'il n'a qu'à coller, et propose le dossier du PDF en dernier recours, pour le
// poste où le presse-papiers serait refusé. Le corps de l'e-mail, lui, ne porte aucune
// consigne interne : il part tel quel à l'auteur.

// Le PDF au presse-papiers comme fichier, ce que vscode.env.clipboard ne sait pas faire :
// il n'écrit que du texte. Le chemin passe par l'environnement et non par la ligne de
// commande — aucune citation à échapper, donc aucun chemin à guillemets ou à apostrophe qui
// casse. -> true si PowerShell est sorti sans erreur.
function copierFichierPressePapiers(chemin) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn('powershell.exe',
        ['-NoProfile', '-NonInteractive', '-STA', '-Command',
         'Set-Clipboard -LiteralPath $env:SZH_PIECE_JOINTE'],
        { stdio: 'ignore', windowsHide: true,
          env: Object.assign({}, process.env, { SZH_PIECE_JOINTE: chemin }) });
    } catch (e) { resolve(false); return; }
    // Un PowerShell qui ne rend jamais la main ne doit pas bloquer le brouillon ; et le
    // minuteur de garde est levé dès qu'il répond, sinon il tiendrait l'hôte d'extensions
    // éveillé quinze secondes de plus pour rien.
    let minuteur = null;
    let fini = false;
    const rendre = (ok) => {
      if (fini) { return; }
      fini = true;
      if (minuteur) { clearTimeout(minuteur); minuteur = null; }
      resolve(ok);
    };
    proc.on('error', () => rendre(false));
    proc.on('exit', (code) => rendre(code === 0));
    minuteur = setTimeout(() => rendre(false), 15000);
  });
}

// Adresses, brouillons et gabarits d'e-mail : lib/courriel.js (mail-templates/*.twig).
// adressesAuteurs, brouillonAuteur, brouillonTraduction, uriMailto restent des noms de ce
// module — rien ne change ni pour les appels ci-dessous ni pour _pur.
const {
  adressesAuteurs, brouillonAuteur, brouillonTraduction, uriMailto
} = require('./lib/courriel');

async function envoyerAuteur(fournisseur, cible) {
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
  // Le PDF d'abord : c'est lui qu'on envoie, et il doit être celui du texte d'aujourd'hui.
  session.poserBuildEnCours(true);
  const statut = vscode.window.setStatusBarMessage(T('art.envoi.compilation', [slug]));
  let code = null;
  try { code = await lancerTacheObjet(tacheMakeArticle(racine, slug)); }
  finally { statut.dispose(); session.poserBuildEnCours(false); }
  const pdf = path.join(racine, 'out', slug, slug + '.pdf');
  // Compilation en échec : un PDF resté de la fois d'avant ne doit pas partir pour la
  // version du jour. Mieux vaut ne rien préparer que d'envoyer un document périmé.
  if (code !== 0 || !fs.existsSync(pdf)) {
    vscode.window.showErrorMessage(T('art.envoi.pdf.absent', [slug]));
    return;
  }

  const meta = lireMetaArticle(racine, slug);
  const langueArticle = normaliserLangueArticle(meta.lang) || langueRevue(racine);
  const adresses = adressesAuteurs(meta);
  const titreArticle = titreFiche(meta, langueArticle) || slug;
  const nomsAuteurs = (meta.author || [])
    .map((a) => [a.prenom, a.nom].map((x) => String(x || '').trim()).filter((x) => x !== '').join(' '))
    .filter((x) => x !== '');
  const brouillon = brouillonAuteur(langueArticle, adresses, titreArticle, titreNumero(racine), nomsAuteurs);
  if (adresses.length === 0) { vscode.window.showWarningMessage(T('art.envoi.sansmail', [slug])); }

  const copie = await copierFichierPressePapiers(pdf);
  const uri = vscode.Uri.file(pdf);
  try {
    await vscode.env.openExternal(vscode.Uri.parse(uriMailto(brouillon)));
  } catch (e) {
    // Aucun client de messagerie, ou refus de l'hôte : le PDF est au presse-papiers, et le
    // dossier reste la porte de sortie.
    const bouton = T('art.envoi.dossier');
    const choix = await vscode.window.showWarningMessage(T('art.envoi.mail.echec', [pdf]), bouton);
    if (choix === bouton) { await revelerDansExplorateur(uri); }
    return;
  }
  const bouton = T('art.envoi.dossier');
  const message = copie ? T('art.envoi.pret') : T('art.envoi.presse.echec');
  const choix = await vscode.window.showInformationMessage(message, bouton);
  if (choix === bouton) { await revelerDansExplorateur(uri); }
}

// Le dossier du PDF, fichier sélectionné. La commande de l'éditeur d'abord ; à défaut, le
// dossier ouvert par l'hôte — un poste sans intégration Explorateur ne doit pas rester sans
// pièce jointe.
async function revelerDansExplorateur(uri) {
  try { await vscode.commands.executeCommand('revealFileInOS', uri); return; }
  catch (e) { /* pas d'intégration Explorateur */ }
  try { await vscode.env.openExternal(vscode.Uri.file(path.dirname(uri.fsPath))); }
  catch (e) { /* rien de plus à tenter */ }
}

function textesTraduction() {
  return {
    source: T('trad.source'), sourceVide: T('trad.source.vide'), cible: T('trad.cible'),
    copier: T('trad.copier'), copie: T('trad.copie'), statut: T('trad.statut'),
    traduit: T('trad.traduit'), atraduire: T('trad.atraduire'),
    courtTraduction: T('trad.court.traduction'), courtRelecture: T('trad.court.relecture'),
    courtFinalise: T('trad.court.finalise'), toutTip: T('trad.tout.tip'),
    rien: T('trad.rien'), aucuneModif: T('form.rien'), enregistre: T('trad.enregistre'),
    // `commentaire` et son aide sont resolus a l'assemblage de la page
    // (%%SZH:cle%% dans media/traduction.html) : ils ne passent pas par cette table.
    commentaire: T('trad.commentaire'),
    deepl: T('trad.deepl'), deeplTip: T('trad.deepl.tooltip'),
    envoyer: T('trad.envoyer'), envoyerTip: T('trad.envoyer.tooltip'),
    motCle: T('trad.motcle'), motCleSansEquiv: T('trad.motcle.sansequivalent'),
    motsClesAide: T('trad.motscles.aide'),
    // Placeholder d'un mot-clé vide : la même clé que la fiche des métadonnées, jamais
    // la sentinelle anglaise écrite dans le YAML.
    motCleATraduire: T('mc.aTraduire')
  };
}

function htmlTraduction(nonce) {
  return construireHtml('traduction', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    titre: T('trad.titre'),
    remplacements: { '__TXT__': JSON.stringify(textesTraduction()) }
  });
}

let panneauTraduction = null;
let slugTraduction = null;
let traductionModifiee = false;
let rechargementTraduction = null;

// Libellés résolus côté hôte : la webview ne connaît pas la langue d'interface.
function groupesPourWebview(etat) {
  return etat.groupes.map((groupe) => ({
    cle: groupe.cle, groupe: groupe.groupe, langue: groupe.langue,
    langueSource: etat.source,
    libelle: libelleGroupe(groupe),
    remplissage: etatRemplissageGroupe(groupe),
    rempli: groupe.rempli,
    statut: groupe.statut,
    champs: groupe.lignes.map((ligne) => ({
      champ: ligne.champ,
      libelle: T('trad.champ.' + ligne.champ),
      source: ligne.source,
      cible: ligne.cible,
      paires: ligne.paires || null,
      multiligne: ligne.champ === 'resume'
    }))
  }));
}

function envoyerValeursTraduction(panneau, fournisseur, slug, focus) {
  const etat = etatTraduction(fournisseur.racine, slug);
  repondrePanneau(panneau, {
    type: 'valeurs',
    slug: slug,
    langueSource: etat.source,
    groupes: groupesPourWebview(etat),
    commentaire: etat.suivi.commentaire,
    statuts: STATUTS.map((s) => ({ valeur: s, libelle: T('trad.statut.' + s) })),
    focus: focus || null
  });
  traductionModifiee = false;                      // les cartes viennent d'être reconstruites
  // Les deux fichiers que ce panneau écrit, et ce qu'ils valaient à cet instant.
  noterLectureCoedition(panneau, fournisseur.racine, cheminMeta(fournisseur.racine, slug));
  noterLectureCoedition(panneau, fournisseur.racine, cheminTraduction(fournisseur.racine, slug));
}

// Le panneau suit ce qui vient d'être écrit ailleurs — sauf s'il porte une saisie non
// enregistrée : le re-rendu la jetterait sans un mot, et remettrait son témoin de
// modification à zéro. On le dit alors, et l'utilisateur tranche.
function rafraichirPanneauTraduction(fournisseur) {
  if (!panneauTraduction || !slugTraduction || !fournisseur.racine) { return; }
  if (fournisseur.listerArticles().indexOf(slugTraduction) === -1) { return; }
  if (traductionModifiee) { vscode.window.showWarningMessage(T('trad.perimee')); return; }
  envoyerValeursTraduction(panneauTraduction, fournisseur, slugTraduction, null);
}

// Enregistre ce que renvoie le panneau ; les textes passent par ecrireCartesArticles,
// qui relit la fiche et n'écrase donc pas une modification enregistrée ailleurs.
// metaChangee, dans le retour, pilote la recompilation de l'aperçu.
// `panneau` : le bail de co-édition sur les deux fichiers écrits ici — la fiche et le
// sidecar du suivi.
function enregistrerTraduction(fournisseur, msg, panneau) {
  const racine = fournisseur.racine;
  const slug = String((msg && msg.slug) || '');
  if (!racine || fournisseur.listerArticles().indexOf(slug) === -1) {
    return { ok: false, message: T('err.ecriture', [slug + '.trad.yaml', slug]) };
  }
  const source = langueRevue(racine);
  const meta = lireMetaArticle(racine, slug);
  delete meta._inconnues;                          // ecrireCartesArticles les relit du disque
  const suivi = lireSuiviTraduction(racine, slug);
  const statuts = Object.assign({}, suivi.statuts);
  let metaChangee = false;
  for (const groupe of (Array.isArray(msg.groupes) ? msg.groupes : [])) {
    const langue = String((groupe && groupe.langue) || '');
    // Pas la langue du numéro : ce panneau ne touche pas au texte source.
    if (LANGUES_META.indexOf(langue) === -1 || langue === source) { continue; }
    const s = statutValide(groupe.statut);
    for (const brut of (Array.isArray(groupe.champs) ? groupe.champs : [])) {
      const champ = String((brut && brut.champ) || '');
      if (CHAMPS_TRADUISIBLES.indexOf(champ) === -1) { continue; }
      // Sur chaque clé du groupe : le sidecar reste lisible sans notion de groupe.
      if (s) { statuts[cleChamp(champ, langue)] = s; }
      const avant = texteChamp(meta, champ, langue);
      let valeur;
      if (champ === 'keywords') {
        // alignerMotsCles tient la place des cases vides, ici du côté qui écrit.
        valeur = alignerMotsCles(brut.paires, listeChamp(meta, 'keywords', source).length);
      } else {
        valeur = valeurChamp(champ, brut.texte);
      }
      meta[champ] = meta[champ] || {};
      meta[champ][langue] = valeur;
      if (texteChamp(meta, champ, langue) !== avant) { metaChangee = true; }
    }
  }
  const res = ecrireCartesArticles(fournisseur, { [slug]: meta }, [slug], panneau);
  const refusCartes = messageCartes(res);
  if (refusCartes) { return { ok: false, message: refusCartes, recharger: res.recharger }; }
  const commentaire = String(msg.commentaire === undefined || msg.commentaire === null ? '' : msg.commentaire)
    .replace(/\r\n?/g, '\n').slice(0, 4000);
  // Le sidecar du suivi a son propre bail : c'est un autre fichier, et la fiche vient
  // d'être écrite — s'arrêter ici laisserait les deux désaccordés, mais écrire par-dessus
  // la saisie de quelqu'un d'autre serait pire, et le message dit lequel des deux manque.
  const refusSuivi = ecrireSousMain(panneau, racine, cheminTraduction(racine, slug), () => {
    try {
      ecrireSuiviTraduction(racine, slug, {
        statuts: statuts, commentaire: commentaire, _inconnues: suivi._inconnues
      });
      return null;
    } catch (e) { return String((e && e.message) || e); }
  });
  if (refusSuivi) {
    return { ok: false, message: refusSuivi.message, recharger: refusSuivi.code === 'perime' };
  }
  return { ok: true, metaChangee: metaChangee };
}

// Le traducteur web accepte le texte dans le fragment de l'URL,
// https://www.deepl.com/translator#<source>/<cible>/<texte>, ouverte par le navigateur.
// Sans clé d'API, le retour se fait au copier-coller.
const LONGUEUR_MAX_DEEPL = 4000;                   // au-delà, les navigateurs tronquent

function ouvrirDeepl(panneau, msg) {
  const texte = String((msg && msg.texte) || '').trim();
  const de = LANGUES_META.indexOf(String(msg.source || '')) !== -1 ? msg.source : 'fr';
  const vers = LANGUES_META.indexOf(String(msg.cible || '')) !== -1 ? msg.cible : 'de';
  if (texte === '') { return; }
  if (texte.length > LONGUEUR_MAX_DEEPL) {
    repondrePanneau(panneau, { type: 'erreur', message: T('trad.deepl.troplong') });
    return;
  }
  const url = 'https://www.deepl.com/translator#' + de + '/' + vers + '/' + encodeURIComponent(texte);
  vscode.env.openExternal(vscode.Uri.parse(url));
}

// L'argument de l'arbre ({slug[, cle]} ou slug), sinon le .md actif, sinon l'aperçu.
function cibleTraduction(fournisseur, cible) {
  if (typeof cible === 'string' && cible !== '') { return { slug: cible, cle: null }; }
  if (cible && cible.slug) { return { slug: String(cible.slug), cle: cible.cle ? String(cible.cle) : null }; }
  const ed = vscode.window.activeTextEditor;
  const actif = ed ? slugDepuisChemin(fournisseur.racine, ed.document.uri.fsPath) : null;
  return { slug: actif || session.apercuCourantSlug() || null, cle: null };
}

// ---- « Envoyer pour traduction » : lien szh:// et e-mail -------------------------
// Le bouton fabrique un lien szh://traduction/<produit>/<numero>[/<article>]
// (lib/liens.js) qui ouvre le bon numéro sur le suivi de traduction, et le met dans le
// presse-papiers comme dans un brouillon d'e-mail. Le lien ne porte pas de chemin :
// c'est le lanceur qui retrouve le dossier sur le poste.

// Le brouillon, et le seul chemin : un `mailto:` en texte brut. Le corps d'un mailto
// n'accepte pas de HTML, le lien szh:// y arrive donc inerte — c'est le prix du retrait du
// composant COM d'Outlook, qui ne parlait qu'à l'ancien client. D'où deux compensations :
// le lien est seul sur sa ligne dans le corps, sélectionnable d'un double-clic, et le
// texte dit au destinataire quoi en faire. L'adresse n'est pas encodée : sa forme est
// vérifiée par adresseMailTraduction, qui n'en laisse passer aucun caractère réservé.
// brouillonTraduction et uriMailto : lib/courriel.js (require en tête de la section
// « Envoyer à l'auteur », plus haut dans ce fichier) ; les gabarits de mail-templates/
// nomment la revue et le sens de la traduction.

function ouvrirBrouillonMail(brouillon) {
  return vscode.env.openExternal(vscode.Uri.parse(uriMailto(brouillon)));
}

async function envoyerPourTraduction(fournisseur, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const vise = cibleTraduction(fournisseur, cible);   // sinon le lien vise le numéro
  const slug = (vise.slug && fournisseur.listerArticles().indexOf(vise.slug) !== -1) ? vise.slug : '';
  let produit = '';
  try {
    produit = normaliserRevue(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).revue);
  } catch (e) { produit = ''; }
  const lien = construireLienTraduction(produit, path.basename(racine), slug);
  if (lien === '') {
    vscode.window.showWarningMessage(T('trad.lien.impossible'));
    return;
  }
  try { await vscode.env.clipboard.writeText(lien); } catch (e) { /* presse-papiers refusé */ }

  const quoi = slug === '' ? titreNumero(racine) : titreNumero(racine) + ' — ' + slug;
  const brouillon = brouillonTraduction(produit, quoi, lien);
  try {
    await ouvrirBrouillonMail(brouillon);
    vscode.window.setStatusBarMessage(T('trad.lien.copie', [lien]), 8000);
  } catch (e) {
    // Aucun client de messagerie, ou refus de l'hôte : le lien est déjà au presse-papiers,
    // et le bouton laisse une seconde chance au brouillon.
    const bouton = T('trad.lien.mail');
    const choix = await vscode.window.showInformationMessage(T('trad.lien.copie.seul', [lien]), bouton);
    // Second échec : rien à ajouter, la notification a déjà dit l'essentiel. Mais il faut
    // l'attendre et l'avaler, sans quoi c'est un rejet non capturé de l'hôte d'extensions.
    if (choix === bouton) {
      try { await ouvrirBrouillonMail(brouillon); } catch (err) { /* déjà signalé */ }
    }
  }
}

// Atterrissage d'un lien reçu : le lanceur a déposé une intention à usage unique,
// consommée ici une fois l'arbre prêt ; celle qui vise une autre revue est laissée à une
// autre fenêtre. Ne lève pas : un lien ne doit pas bloquer l'ouverture.
async function honorerIntention(fournisseur, rafraichirTout) {
  try {
    const racine = fournisseur.racine;
    if (!racine) { return; }
    const intention = consommerIntention(racine);
    if (!intention || intention.vue !== 'traduction') { return; }
    const cible = (intention.article !== '' && fournisseur.listerArticles().indexOf(intention.article) !== -1)
      ? { slug: intention.article } : undefined;
    await ouvrirTraduction(fournisseur, rafraichirTout, cible);
    vscode.window.setStatusBarMessage(T('intention.ouverte'), 6000);
  } catch (e) { /* jamais bloquant */ }
}

// Formulaire en colonne 1, aperçu de l'article en colonne 2, ouvert sans le .md.
async function ouvrirTraduction(fournisseur, rafraichirTout, cible) {
  if (!fournisseur.racine) { return; }
  const vise = cibleTraduction(fournisseur, cible);
  if (!vise.slug || fournisseur.listerArticles().indexOf(vise.slug) === -1) {
    vscode.window.setStatusBarMessage(T('trad.horsarticle'), 4000);
    return;
  }
  const montrerApercu = (slug) => {
    // Une erreur de compilation est déjà signalée par ouvrirArticle.
    ouvrirArticle(fournisseur, slug, { sansTexte: true }).catch(() => { /* déjà signalé */ });
  };
  if (panneauTraduction) {
    panneauTraduction.reveal(vscode.ViewColumn.One);
    if (vise.slug === slugTraduction) {
      if (vise.cle) { repondrePanneau(panneauTraduction, { type: 'focus', cle: vise.cle }); }
      montrerApercu(vise.slug);
      return;
    }
    if (traductionModifiee) {
      // Le panneau porte un ● : le changement d'article se joue à la réponse.
      rechargementTraduction = vise;
      repondrePanneau(panneauTraduction, { type: 'demande-rechargement' });
      return;
    }
    slugTraduction = vise.slug;
    panneauTraduction.title = T('trad.titre.un', [vise.slug]);
    envoyerValeursTraduction(panneauTraduction, fournisseur, vise.slug, vise.cle);
    montrerApercu(vise.slug);
    return;
  }
  slugTraduction = vise.slug;
  traductionModifiee = false;
  rechargementTraduction = null;
  const panneau = vscode.window.createWebviewPanel(
    'szhTraduction', T('trad.titre.un', [vise.slug]), vscode.ViewColumn.One,
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
  );
  panneauTraduction = panneau;
  let focusInitial = vise.cle;
  panneau.onDidDispose(() => {
    libererCoedition(panneau);
    if (panneauTraduction === panneau) {
      panneauTraduction = null; slugTraduction = null;
      traductionModifiee = false; rechargementTraduction = null;
    }
  });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) {
      envoyerValeursTraduction(panneau, fournisseur, slugTraduction, focusInitial);
      focusInitial = null;
      return;
    }
    if (msg.type === MSG.MODIFIE) { traductionModifiee = !!msg.modifie; return; }
    if (msg.type === MSG.COPIER) {
      await vscode.env.clipboard.writeText(String(msg.texte || ''));
      repondrePanneau(panneau, { type: 'copie' });
      return;
    }
    if (msg.type === MSG.DEEPL) { ouvrirDeepl(panneau, msg); return; }
    if (msg.type === MSG.LIEN) { envoyerPourTraduction(fournisseur, { slug: slugTraduction }); return; }
    if (msg.type === MSG.RECHARGEMENT) {
      const attente = rechargementTraduction;
      rechargementTraduction = null;
      if (!attente) { return; }                    // réponse tardive : abandonné
      const choix = await confirmerAbandon(T('trad.recharger.question'));
      if (choix === 'annuler') { return; }         // Annuler : on reste sur l'article
      if (choix === 'enregistrer') {
        const res = enregistrerTraduction(fournisseur, msg, panneau);
        if (!res.ok) { repondrePanneau(panneau, { type: 'erreur', message: res.message }); return; }
        vscode.window.setStatusBarMessage(T('statut.traduction', [msg.slug]), 3000);
        if (rafraichirTout) { rafraichirTout(); }
      }
      slugTraduction = attente.slug;
      panneau.title = T('trad.titre.un', [attente.slug]);
      envoyerValeursTraduction(panneau, fournisseur, attente.slug, attente.cle);
      montrerApercu(attente.slug);
      return;
    }
    if (msg.type !== MSG.ENREGISTRER) {
      console.warn('traduction : type de message inconnu', msg.type);
      return;
    }
    const res = enregistrerTraduction(fournisseur, msg, panneau);
    if (!res.ok) {
      repondrePanneau(panneau, { type: 'erreur', message: res.message });
      // Périmé : ce que le panneau montre n'est plus ce que les fichiers contiennent.
      if (res.recharger) { envoyerValeursTraduction(panneau, fournisseur, slugTraduction, null); }
      return;
    }
    repondrePanneau(panneau, { type: 'enregistre', auto: !!msg.auto });
    traductionModifiee = false;
    if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.traduction', [slugTraduction]), 3000); }
    if (rafraichirTout) { rafraichirTout(); }
    // Un enregistrement automatique ne renvoie rien : le re-rendu perdrait le curseur.
    if (!msg.auto) { envoyerValeursTraduction(panneau, fournisseur, slugTraduction, null); }
    // La fiche est une dépendance de compilation ; jamais en pleine frappe.
    if (res.metaChangee && !msg.auto) { montrerApercu(slugTraduction); }
  });
  panneau.webview.html = htmlTraduction(crypto.randomBytes(16).toString('hex'));
  montrerApercu(vise.slug);
}

// ---- Photos, auteur·e·s connus et fiches de tous les articles -> lib/metadonnees-hote.js
// postMessage tolérant : le panneau peut être fermé pendant le traitement WSL.
function repondrePanneau(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

// ---- Dialogue « Vérification de l'import » ---------------------------------------
// Ouvert à la fin de lancerConversion dès qu'un nouvel article est apparu. Une section
// par article : la carte de métadonnées du formulaire des fiches, avec des badges
// « détecté » ou « à compléter » ; les photos d'auteur·e·s ; et les images de
// articles/<slug>/media/, à remplacer par leur original en gardant leur nom.

let panneauImportVerif = null;
let slugsImportVerif = [];                         // slugs de la dernière conversion

function htmlImportVerif(nonce) {
  const txt = JSON.stringify(Object.assign(textesCarteArticle(), {
    badgeDetecte: T('importv.badge.detecte'), badgeAcompleter: T('importv.badge.acompleter'),
    vides: T('importv.vides'), videsZero: T('importv.vides.zero'),
    sectionImages: T('importv.section.images'),
    imagesAucune: T('importv.images.aucune'), imageDeposer: T('importv.image.deposer'),
    imageRemplacee: T('importv.image.remplacee'),
    errImageTropVolumineuse: T('importv.err.tropvolumineux'),
    errImageFormat: T('importv.err.format')
  }));
  return construireHtml('import-verif', nonce, {
    cssPartage: ['_design.css', '_auteurs.css', '_fiches.css'],
    jsPartage: ['_messages.js', '_auteurs.js', '_fiches.js'],
    titre: T('importv.titre'),
    remplacements: { '__TXT__': txt },
    csp: "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'nonce-" + nonce + "'"
  });
}

// Articles de la dernière conversion, slugs revalidés.
function lireArticlesImport(fournisseur) {
  const budgetVignettes = { reste: BUDGET_VIGNETTES };
  const connus = new Set(fournisseur.listerArticles());
  const dois = doisCalculesArticles(fournisseur);
  const articles = [];
  for (const slug of slugsImportVerif) {
    if (!connus.has(slug)) { continue; }
    migrerFrontmatterVersMeta(fournisseur.racine, slug);
    let valeurs = analyserMeta('');                 // forme de la carte vide
    try {
      valeurs = analyserMeta(fs.readFileSync(cheminMeta(fournisseur.racine, slug), 'utf8'));
    } catch (e) { /* pas encore de fiche : carte vide, tout « à compléter » */ }
    delete valeurs._inconnues;                     // la webview n'a pas à les voir
    const base = path.join(fournisseur.racine, dossierUnites(), slug, 'media');
    const images = fournisseur._imagesArticle(slug).map((relatif) => ({
      relatif: relatif,
      description: decrireImage(path.join(base, relatif))   // « L × H · poids »
    }));
    articles.push({
      slug: slug, valeurs: valeurs, images: images, doiCalcule: dois[slug] || '',
      apercusAuteurs: (valeurs.author || [])
        .map((a) => vignetteAuteur(fournisseur.racine, slug, a.photo, budgetVignettes))
    });
  }
  return articles;
}

// `extra` porte le jeton de la course pret/valeurs : `{ requete }` en réponse à
// « pret », `{ rechargement: true }` pour un rechargement forcé (fiche périmée).
function envoyerValeursImportVerif(panneau, fournisseur, extra) {
  const langue = langueRevue(fournisseur.racine);
  repondrePanneau(panneau, Object.assign({
    type: 'valeurs',
    articles: lireArticlesImport(fournisseur),
    langue: langue,
    accent: lireCouleurAccent(fournisseur.racine),
    types: typesTraduits(langue),
    licences: licencesTraduites(), licenceDefaut: LICENCE_DEFAUT,
    // Le plafond des originaux d'image (section « Originaux des images ») et celui des
    // photos d'auteur·e·s (modale partagée) : plus aucun littéral côté webview.
    limites: limitesMedias()
  }, extra || {}));
  envoyerAuteursConnus(panneau, fournisseur.racine);
  envoyerMotsClesConnus(panneau);
}

// Le remplacement lui-même est celui du gestionnaire des médias ; ici, seul l'aller-retour
// avec la webview change. Une annulation est signalée, qui réactive la zone de dépôt.
async function remplacerImageImport(fournisseur, rafraichirTout, panneau, msg) {
  const slug = String(msg.slug || '');
  const relatif = String(msg.relatif || '');
  const res = await remplacerFichierImage(fournisseur, rafraichirTout, slug, relatif,
    msg.nomFichier, msg.donneesBase64);
  if (res.etat === 'annule') {
    repondrePanneau(panneau, { type: 'image-annulee', slug: slug, relatif: relatif });
    return;
  }
  if (res.etat === 'erreur') {
    repondrePanneau(panneau, { type: 'image-erreur', slug: slug, relatif: relatif, message: res.message });
    return;
  }
  repondrePanneau(panneau, {
    type: 'image-remplacee', slug: slug, relatif: relatif,
    description: decrireImage(path.join(fournisseur.racine, dossierUnites(), slug, 'media', relatif))
  });
}

async function ouvrirImportVerif(fournisseur, rafraichirTout, slugs) {
  if (!fournisseur.racine || !Array.isArray(slugs) || slugs.length === 0) { return; }
  slugsImportVerif = slugs.slice();
  await fermerTousLesApercus();
  if (panneauImportVerif) {
    panneauImportVerif.reveal(vscode.ViewColumn.One);
    envoyerValeursImportVerif(panneauImportVerif, fournisseur);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhImportVerif', T('importv.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauImportVerif = panneau;
  panneau.onDidDispose(() => {
    libererCoedition(panneau);
    if (panneauImportVerif === panneau) { panneauImportVerif = null; }
  });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) { envoyerValeursImportVerif(panneau, fournisseur, { requete: msg.requete }); return; }
    if (msg.type === MSG.PHOTO_DEPOSER) { await deposerPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_OUVRIR) { ouvrirVersionsPhoto(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.PHOTO_CHOISIR) { choisirPhotoAuteur(fournisseur, panneau, msg); return; }
    if (msg.type === MSG.DOI_MANUEL_CONFIRMER) { await confirmerDoiManuel(panneau, msg); return; }
    if (msg.type === MSG.REMPLACER_IMAGE) { await remplacerImageImport(fournisseur, rafraichirTout, panneau, msg); return; }
    if (msg.type === MSG.FERMER) {
      // Seul chemin de fermeture contrôlable : la croix de l'onglet est hors de portée.
      if (msg.modifie) {
        const choix = await confirmerAbandon(T('importv.quitter.question'));
        if (choix === 'annuler') { return; }                       // Annuler : on reste
        if (choix === 'enregistrer') {
          const res = ecrireCartesArticles(fournisseur, msg.articles, slugsImportVerif, panneau);
          const refusCartes = messageCartes(res);
          if (refusCartes) {
            repondrePanneau(panneau, { type: 'erreur', message: refusCartes });
            return;                                                // échec : on reste
          }
          vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000);
          if (rafraichirTout) { rafraichirTout(); }
        }
      }
      panneau.dispose();
      return;
    }
    if (msg.type !== MSG.ENREGISTRER) {
      console.warn('vérification de l’import (hôte) : type de message inconnu', msg.type);
      return;
    }
    if (!msg.articles) { return; }
    const res = ecrireCartesArticles(fournisseur, msg.articles, slugsImportVerif, panneau);
    const refusCartes = messageCartes(res);
    if (refusCartes) {
      repondrePanneau(panneau, { type: 'erreur', message: refusCartes });
    } else {
      repondrePanneau(panneau, { type: 'enregistre', n: res.n, auto: !!msg.auto });
      if (!msg.auto) { vscode.window.setStatusBarMessage(T('statut.fiches', [res.n]), 3000); }
    }
    if (rafraichirTout) { rafraichirTout(); }
    // Pas de re-rendu sur un enregistrement automatique : le curseur serait perdu. Une
    // fiche périmée l'exige quand même — voir le formulaire des fiches.
    if (!msg.auto || res.recharger) {
      envoyerValeursImportVerif(panneau, fournisseur, res.recharger ? { rechargement: true } : undefined);
    }
  });
  panneau.webview.html = htmlImportVerif(crypto.randomBytes(16).toString('hex'));
}

// ---- Réglages « SZH » ------------------------------------------------------------
// Formulaire webview qui écrit au niveau utilisateur par getConfiguration().update(…,
// Global). Le choix français/allemand pilote les chaînes du cockpit (szh.langue) et la
// locale native (argv.json, effective au redémarrage, et qui suppose le pack de langue).

function REGL_TEXTES() {
  return JSON.stringify(REGL_LIBELLES());
}

function REGL_LIBELLES() {
  return {
  theme: T('regl.theme'),
  themeSysteme: T('regl.theme.systeme'), themeClair: T('regl.theme.clair'), themeSombre: T('regl.theme.sombre'),
  zoom: T('regl.zoom'),
  zoomNormal: T('regl.zoom.normal'), zoomGrand: T('regl.zoom.grand'), zoomTresGrand: T('regl.zoom.tresgrand'),
  policeMd: T('regl.policemd'),
  apercu: T('regl.apercu'),
  apercuHtml: T('regl.apercu.html'), apercuPdf: T('regl.apercu.pdf'),
  assets: T('regl.assets'), assetsOui: T('regl.assets.oui'), assetsNon: T('regl.assets.non'),
  cmyk: T('regl.cmyk'), cmykOui: T('regl.cmyk.oui'), cmykNon: T('regl.cmyk.non'),
  warnings: T('regl.warnings'),
  warningsComplets: T('regl.warnings.complets'), warningsReduits: T('regl.warnings.reduits'),
  liensReferences: T('regl.liensReferences'),
  liensReferencesActifs: T('regl.liensReferences.actifs'),
  liensReferencesDesactives: T('regl.liensReferences.desactives'),
  langue: T('regl.langue'),
  protegesTitre: T('regl.proteges.titre'),
  protegesVerrouille: T('regl.proteges.verrouille'),
  protegesDeverrouiller: T('regl.proteges.deverrouiller'),
  protegesTelecharger: T('regl.proteges.telecharger'),
  protegesTelechargerTip: T('regl.proteges.telecharger.tip'),
  dev: T('regl.dev'), devOui: T('regl.dev.oui'), devNon: T('regl.dev.non'),
  auteursMaj: T('regl.auteurs.maj'), auteursJamais: T('regl.auteurs.jamais'),
  auteursCorpus: T('regl.auteurs.corpus'), auteursCorpusJamais: T('regl.auteurs.corpus.jamais'),
  ojsRevues: T('ojs.revues'), ojsVide: T('ojs.vide'),
  ojsRubriques: T('ojs.rubriques'), ojsRubriquesAide: T('ojs.rubriques.aide'),
  ojsColCle: T('ojs.col.cle'), ojsColAbbrev: T('ojs.col.abbrev'), ojsColTitre: T('ojs.col.titre'),
  ojsColResume: T('ojs.col.resume'), ojsColDoi: T('ojs.col.doi'),
  ojsAjouter: T('ojs.ajouter'), ojsCleNouvelle: T('ojs.cle.nouvelle'),
  ojsTypes: T('ojs.types'), ojsTypesAide: T('ojs.types.aide'),
  biblioTitre: T('biblio.titre'), biblioColLangue: T('biblio.col.langue'),
  biblioVide: T('biblio.vide')
  };
}

// Ce que le panneau doit connaître du titre de la bibliographie : les intitulés effectifs,
// les deux revues et les trois langues, avec leur nom lisible. Les listes viennent de
// lib/citations.js et de lib/yaml.js — le panneau n'en recopie aucune, et les valeurs par
// défaut vivent dans le filtre de composition, seul endroit où elles existent.
function donneesBiblio() {
  return {
    titres: configBiblio().titres,
    revues: REVUES_BIBLIO.map((cle) => ({
      cle: cle,
      libelle: T('ojs.revue.' + (REVUES.find((r) => r.cle === cle) || {}).langue)
    })),
    langues: LANGUES_BIBLIO.map((cle) => ({ cle: cle, libelle: T('meta.langue.' + cle) }))
  };
}

// L'état de la liste des auteur·e·s publiés, pour le groupe informatif des réglages :
// quand elle a été mise à jour, combien de noms elle porte. Rien ne se règle là — le
// rafraîchissement se fait seul, à l'activation (rafraichirAuteursPubliesEnFond).
function resumeAuteursPublies() {
  try {
    const cache = lireCacheAuteursPublies();
    return {
      dateFetch: cache.dateFetch,                  // dernier moissonnage OJS
      dateCorpus: cache.dateCorpus || null,        // dernier balayage des numéros du poste
      nombre: cache.auteurs.length,
      nombreRor: Object.keys(cache.ror || {}).length
    };
  } catch (e) { return { dateFetch: null, dateCorpus: null, nombre: 0, nombreRor: 0 }; }
}

// Ce que le panneau doit connaître de l'export OJS : la configuration effective, la liste
// des champs par revue avec le libellé et l'endroit où relever la valeur, et les types
// d'article. Les listes viennent de lib/export-ojs.js et de lib/yaml.js — le panneau n'en
// recopie aucune.
function donneesOjs() {
  const langue = langueCockpit();
  const revues = {};
  for (const loc of LOCALES_REVUE) { revues[loc] = T('ojs.revue.' + loc); }
  return {
    config: configOjs(),
    locales: LOCALES_REVUE,
    revues: revues,
    // Les clés des rubriques livrées ne se renomment pas : une clé changée laisserait
    // l'ancienne en place et le type d'article pointerait dans le vide.
    clesDefaut: RUBRIQUES_DEFAUT.map((r) => r.cle),
    champs: CHAMPS_REVUE.map((c) => ({
      cle: c.cle, requis: c.requis, libelle: T(c.libelle), ou: T(c.ou)
    })),
    typesArticle: TYPES_ARTICLE.map((t) => ({
      valeur: t, libelle: (LIBELLES_TYPES[t] || {})[langue] || t
    }))
  };
}

function htmlReglages(nonce) {
  return construireHtml('settings', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'],
    titre: T('regl.titre'), remplacements: { '__TXT__': REGL_TEXTES() }
  });
}

// Par expression régulière : argv.json accepte des commentaires, qu'un JSON.parse
// perdrait.
function ecrireLocaleArgv(langue) {
  try {
    const dossier = path.join(process.env.APPDATA || '', 'VSCodium');
    const chemin = path.join(dossier, 'argv.json');
    let contenu = '';
    try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { contenu = '{\n}\n'; }
    if (/"locale"\s*:\s*"[^"]*"/.test(contenu)) {
      contenu = contenu.replace(/"locale"\s*:\s*"[^"]*"/, '"locale": "' + langue + '"');
    } else {
      const pos = contenu.lastIndexOf('}');
      if (pos === -1) {
        contenu = '{\n\t"locale": "' + langue + '"\n}\n';
      } else {
        const avant = contenu.slice(0, pos).replace(/\s*$/, '');
        const virgule = /[{,]\s*$/.test(avant) ? '' : ',';
        contenu = avant + virgule + '\n\t"locale": "' + langue + '"\n' + contenu.slice(pos);
      }
    }
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(chemin, contenu, 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

// La langue d'affichage de VSCodium, réduite aux deux que nous connaissons. '' quand un
// pack de langue n'est pas installé — l'anglais des postes d'ici — auquel cas il n'y a rien
// à comparer : c'est l'état normal d'une rédaction francophone, dont les menus sont en
// anglais et les formulaires en français.
function langueEditeur() {
  const brut = String((vscode.env && vscode.env.language) || '').toLowerCase();
  if (brut.indexOf('de') === 0) { return 'de'; }
  if (brut.indexOf('fr') === 0) { return 'fr'; }
  return '';
}

// Le mot à poser sous le choix de la langue quand les menus de VSCodium et les textes du
// cockpit ne parlent pas la même langue. Deux mécanismes indépendants les décident (voir
// l'en-tête de lib/i18n.js), et rien ne les oblige à s'accorder : un réglage posé à la
// main, une variable d'essai restée dans l'environnement, un choix effacé par une mise à
// jour, et l'écran se retrouve à moitié dans chaque langue. -> '' quand tout va bien.
function avertissementLangue() {
  const cockpit = langueCockpit();
  const editeur = langueEditeur();
  if (editeur === '' || editeur === cockpit) { return ''; }
  return T('regl.langue.discordance', [T('meta.langue.' + cockpit), T('meta.langue.' + editeur)]);
}

// ---- Les réglages protégés : relais, état, et fichier à transmettre --------------
//
// Le fichier déployé par la mise à jour est la référence ; config.json est ce que le poste
// emploie, et le seul que la chaîne de compilation sache lire. Le relais recopie l'un dans
// l'autre — mais SEULEMENT quand la référence a changé, jamais à chaque démarrage : une
// modification faite ici après un déverrouillage doit tenir jusqu'à la prochaine mise à
// jour, et un relais à chaque ouverture l'effacerait le lendemain matin.
const CLE_EMPREINTE_PROTEGES = 'szh.reglagesProteges.empreinte';

async function relayerReglagesProteges(context) {
  const reference = proteges.lireReglagesProteges();
  if (!reference) { return; }                      // absent ou illisible : on ne relaie rien
  const blocs = proteges.blocsProteges(reference);
  if (Object.keys(blocs).length === 0) { return; } // rien à imposer : le poste garde le sien
  const empreinte = empreinteReglages(blocs);
  if (context.globalState.get(CLE_EMPREINTE_PROTEGES) === empreinte) { return; }
  const avant = lireConfigPoste();
  // Illisible n'est pas absent : on n'écrase pas ce qu'on n'a pas su lire, sans quoi
  // l'emplacement des revues et les tâches partiraient avec.
  if (avant === null && fs.existsSync(CONFIG_POSTE)) { return; }
  const erreur = ecrireConfigPoste(proteges.configAvecProteges(avant, blocs));
  if (erreur) { console.warn('réglages protégés non relayés : ' + erreur); return; }
  await context.globalState.update(CLE_EMPREINTE_PROTEGES, empreinte);
}

// L'état des réglages protégés, tel que le formulaire en a besoin : verrouillés ou non, et
// la liste des blocs où ce poste s'écarte de la version déployée. Le déverrouillage ne vit
// que le temps du panneau ouvert — il se redemande à chaque fois, et c'est voulu : c'est un
// geste d'exception, pas un mode dans lequel on s'installe.
let protegesDeverrouilles = false;

function etatProteges() {
  const ecarts = proteges.divergences(lireConfigPoste(), proteges.lireReglagesProteges());
  return {
    deverrouille: protegesDeverrouilles,
    divergences: ecarts,
    avertissement: ecarts.length > 0
      ? T('regl.proteges.diverge', [ecarts.map((b) => T('regl.proteges.bloc.' + b)).join(', ')])
      : ''
  };
}

// « Télécharger les réglages protégés » : l'état courant du poste, au format du fichier
// déployé, à transmettre à l'administrateur. Offert même verrouillé — lire et transmettre
// ne modifie rien, et c'est justement ce qu'on demande à quelqu'un qui signale un problème.
async function telechargerReglagesProteges() {
  const contenu = proteges.fichierATelecharger(lireConfigPoste(), T('regl.proteges.lisezmoi'));
  let cible;
  try {
    cible = await vscode.window.showSaveDialog({
      saveLabel: T('regl.proteges.telecharger'),
      defaultUri: vscode.Uri.file(path.join(
        process.env.USERPROFILE || process.env.HOME || '', 'Desktop', proteges.NOM_FICHIER))
    });
  } catch (e) { cible = null; }
  if (!cible) { return null; }                     // annulé : rien à dire
  try {
    ecrireAtomique(cible.fsPath, contenu);
    return T('regl.proteges.telecharge', [path.basename(cible.fsPath)]);
  } catch (e) {
    return T('err.ecriture', [path.basename(cible.fsPath), String((e && e.message) || e)]);
  }
}

function lireReglagesActuels() {
  const cfg = vscode.workspace.getConfiguration();
  const autoDetect = cfg.get('window.autoDetectColorScheme', false) === true;
  const theme = String(cfg.get('workbench.colorTheme', '') || '');
  const etatTheme = autoDetect ? 'systeme'
    : (theme.toLowerCase().indexOf('light') !== -1 ? 'clair' : 'sombre');
  const zoom = Number(cfg.get('window.zoomLevel', 0)) || 0;
  let policeMd = 16;
  try {
    policeMd = Number(vscode.workspace.getConfiguration('editor', { languageId: 'markdown' }).get('fontSize', 16)) || 16;
  } catch (e) { /* valeur par défaut : 16 */ }
  // La valeur écrite, et non modeApercu(), qui force « html » sur un profil sans PDF.
  let apercu = 'html';
  try {
    apercu = String(vscode.workspace.getConfiguration('szh').get('apercuMode', 'html') || 'html') === 'pdf' ? 'pdf' : 'html';
  } catch (e) { /* valeur par défaut : html */ }
  return {
    theme: etatTheme, zoom: String(zoom), policeMd: String(policeMd), apercu: apercu,
    assets: replierAssetsAutres() ? 'oui' : 'non',
    cmyk: convertirCmykActif() ? 'oui' : 'non',
    warnings: reduireWarningsImpressionActif() ? 'reduits' : 'complets',
    liensReferences: desactiverLiensReferencesActif() ? 'desactives' : 'actifs',
    langue: langueCockpit(),
    // Dans config.json : ses consommateurs sont les scripts PowerShell.
    dev: lireModeDeveloppeur() ? 'oui' : 'non'
  };
}

let panneauReglages = null;

function ouvrirReglages(rafraichirTout) {
  if (panneauReglages) {
    panneauReglages.reveal(vscode.ViewColumn.One);
    panneauReglages.webview.postMessage(
      { type: 'valeurs', valeurs: lireReglagesActuels(), ojs: donneesOjs(),
        biblio: donneesBiblio(), auteursOjs: resumeAuteursPublies(),
        avertLangue: avertissementLangue(), proteges: etatProteges() });
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhReglages', T('regl.titre'), vscode.ViewColumn.One,
    { enableScripts: true, localResourceRoots: [] }
  );
  panneauReglages = panneau;
  panneau.onDidDispose(() => { if (panneauReglages === panneau) { panneauReglages = null; } });
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) {
      panneau.webview.postMessage(
        { type: 'valeurs', valeurs: lireReglagesActuels(), ojs: donneesOjs(),
        biblio: donneesBiblio(), auteursOjs: resumeAuteursPublies(),
        avertLangue: avertissementLangue(), proteges: etatProteges() });
      return;
    }
    // ---- Les réglages protégés ----
    //
    // Déverrouiller n'est pas un réglage mais un geste, et il se redemande à chaque
    // ouverture du panneau : c'est une exception, pas un mode dans lequel on s'installe.
    // La question modale est posée ICI et non dans la page : une webview ne peut pas
    // bloquer, et un avertissement qu'on peut ignorer d'un clic à côté n'avertit personne.
    if (msg.type === MSG.DEVERROUILLER) {
      if (!msg.valeur) {
        protegesDeverrouilles = false;
        repondrePanneau(panneau, Object.assign({ type: MSG.PROTEGES }, etatProteges()));
        return;
      }
      const continuer = await vscode.window.showWarningMessage(
        T('regl.proteges.question'),
        { modal: true, detail: T('regl.proteges.detail') },
        T('regl.proteges.confirmer'));
      protegesDeverrouilles = continuer === T('regl.proteges.confirmer');
      repondrePanneau(panneau, Object.assign({ type: MSG.PROTEGES }, etatProteges()));
      return;
    }
    if (msg.type === MSG.TELECHARGER_PROTEGES) {
      const dit = await telechargerReglagesProteges();
      if (dit) { vscode.window.showInformationMessage(dit); }
      return;
    }
    // Verrouillé, ces deux blocs ne s'écrivent pas. Le formulaire les grise déjà et
    // n'enverrait rien, mais un message qui arriverait quand même — page restée ouverte
    // pendant un reverrouillage, envoi automatique en vol — ne doit pas passer.
    if ((msg.type === MSG.REGLER_OJS || msg.type === MSG.REGLER_BIBLIO) && !protegesDeverrouilles) {
      repondrePanneau(panneau, {
        type: 'erreur', bloc: msg.type === MSG.REGLER_OJS ? 'ojs' : 'biblio',
        message: T('regl.proteges.refus')
      });
      return;
    }
    // La configuration de l'export OJS va dans config.json, comme le mode développeur :
    // ce sont des réglages de poste, partagés avec les scripts PowerShell.
    if (msg.type === MSG.REGLER_OJS) {
      const erreur = ecrireConfigOjs(msg.ojs || {});
      if (erreur) {
        const message = T('ojs.err.ecriture', [erreur]);
        vscode.window.showErrorMessage(message);
        // Sinon l'auto-enregistrement du panneau (enVol) reste bloqué : plus rien ne
        // s'enregistre jamais après le premier échec.
        repondrePanneau(panneau, { type: 'erreur', bloc: 'ojs', message: message });
      } else {
        repondrePanneau(panneau, { type: 'enregistre', bloc: 'ojs' });
        // Le poste vient peut-être de s'écarter de la version déployée : le bandeau
        // doit le dire tout de suite, pas au prochain rechargement du panneau.
        repondrePanneau(panneau, Object.assign({ type: MSG.PROTEGES }, etatProteges()));
      }
      return;
    }
    // Le titre de la bibliographie, dans le même config.json et par les mêmes deux
    // fonctions. Illisible n'est pas absent : on n'écrase pas un fichier qu'on n'a pas su
    // lire, sans quoi l'emplacement des revues et la configuration OJS partiraient avec.
    if (msg.type === MSG.REGLER_BIBLIO) {
      const avant = lireConfigPoste();
      if (avant === null && fs.existsSync(CONFIG_POSTE)) {
        const message = T('err.ecriture', [path.basename(CONFIG_POSTE), CONFIG_POSTE]);
        vscode.window.showErrorMessage(message);
        repondrePanneau(panneau, { type: 'erreur', bloc: 'biblio', message: message });
        return;
      }
      const erreur = ecrireConfigPoste(configAvecTitresBiblio(avant, msg.titres || {}));
      if (erreur) {
        const message = T('err.ecriture', [path.basename(CONFIG_POSTE), erreur]);
        vscode.window.showErrorMessage(message);
        repondrePanneau(panneau, { type: 'erreur', bloc: 'biblio', message: message });
      } else {
        repondrePanneau(panneau, { type: 'enregistre', bloc: 'biblio' });
        // Le poste vient peut-être de s'écarter de la version déployée : le bandeau
        // doit le dire tout de suite, pas au prochain rechargement du panneau.
        repondrePanneau(panneau, Object.assign({ type: MSG.PROTEGES }, etatProteges()));
      }
      return;
    }
    if (msg.type !== MSG.REGLER) {
      console.warn('réglages : type de message inconnu', msg.type);
      return;
    }
    const Global = vscode.ConfigurationTarget.Global;
    const cfg = vscode.workspace.getConfiguration();
    try {
      if (msg.cle === 'theme') {
        if (msg.valeur === 'systeme') {
          await cfg.update('workbench.preferredLightColorTheme', 'Default Light Modern', Global);
          await cfg.update('workbench.preferredDarkColorTheme', 'Default Dark Modern', Global);
          await cfg.update('window.autoDetectColorScheme', true, Global);
        } else {
          await cfg.update('window.autoDetectColorScheme', false, Global);
          await cfg.update('workbench.colorTheme',
            msg.valeur === 'clair' ? 'Default Light Modern' : 'Default Dark Modern', Global);
        }
      } else if (msg.cle === 'zoom') {
        await cfg.update('window.zoomLevel', Number(msg.valeur) || 0, Global);
      } else if (msg.cle === 'policeMd') {
        // Limité à [markdown] : la taille d'affichage, pas le contenu.
        await vscode.workspace.getConfiguration('editor', { languageId: 'markdown' })
          .update('fontSize', Number(msg.valeur) || 16, Global, true);
      } else if (msg.cle === 'apercu') {
        // Même réglage szh.apercuMode que la bascule Ctrl+Alt+P et la barre d'état.
        await vscode.workspace.getConfiguration('szh')
          .update('apercuMode', msg.valeur === 'pdf' ? 'pdf' : 'html', Global);
        if (rafraichirTout) { rafraichirTout(); } // la barre d'état « Aperçu : … » suit
      } else if (msg.cle === 'assets') {
        // Les identités d'article changent avec le réglage : l'arbre doit suivre.
        await vscode.workspace.getConfiguration('szh')
          .update('replierAssetsAutres', msg.valeur !== 'non', vscode.ConfigurationTarget.Global);
        if (rafraichirTout) { rafraichirTout(); }
      } else if (msg.cle === 'cmyk') {
        await vscode.workspace.getConfiguration('szh')
          .update('convertirCmyk', msg.valeur !== 'non', Global);
      } else if (msg.cle === 'warnings') {
        // Le verdict recalculé arrive au prochain rendu du gestionnaire des médias.
        await vscode.workspace.getConfiguration('szh')
          .update('reduireWarningsImpression', msg.valeur === 'reduits', Global);
      } else if (msg.cle === 'liensReferences') {
        // Deux écritures : le réglage VSCodium, pour le panneau et la palette de commandes ;
        // et config.json, seul fichier que pipeline/filters/szh-citations.lua peut lire
        // depuis WSL — même relais que le titre de la bibliographie, juste en dessous. Une
        // config illisible n'est pas écrasée : elle emporterait l'emplacement des revues et
        // la configuration OJS avec elle.
        const desactiver = msg.valeur === 'desactives';
        await vscode.workspace.getConfiguration('szh')
          .update('desactiverLiensReferences', desactiver, Global);
        const avant = lireConfigPoste();
        if (avant === null && fs.existsSync(CONFIG_POSTE)) {
          vscode.window.showErrorMessage(T('err.ecriture', [path.basename(CONFIG_POSTE), CONFIG_POSTE]));
        } else {
          const erreur = ecrireConfigPoste(configAvecLiensDesactives(avant, desactiver));
          if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(CONFIG_POSTE), erreur])); }
        }
      } else if (msg.cle === 'dev') {
        // bootstrap.ps1 donne au groupe Utilisateurs le droit d'écrire ce fichier.
        const erreur = ecrireModeDeveloppeur(msg.valeur !== 'non');
        if (erreur) { vscode.window.showErrorMessage(T('err.dev.ecriture', [erreur])); }
        vscode.commands.executeCommand('szh.cockpit.rafraichir');   // le badge « test » suit
      } else if (msg.cle === 'langue') {
        const langue = msg.valeur === 'de' ? 'de' : 'fr';
        await vscode.workspace.getConfiguration('szh').update('langue', langue, Global);
        // Deux écritures, comme pour les liens des références juste au-dessus — et pour une
        // raison de plus : la mise à jour du poste réécrit entièrement les réglages de
        // l'éditeur, et le choix de la langue partait avec eux. Le second exemplaire vit
        // hors de leur portée, et c'est lui que le cockpit relit sur un poste remis à jour.
        const avantLangue = lireConfigPoste();
        if (avantLangue === null && fs.existsSync(CONFIG_POSTE)) {
          vscode.window.showErrorMessage(T('err.ecriture', [path.basename(CONFIG_POSTE), CONFIG_POSTE]));
        } else {
          const erreur = ecrireConfigPoste(configAvecLangue(avantLangue, langue));
          if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(CONFIG_POSTE), erreur])); }
        }
        oublierLanguePoste();                      // le fichier vient de changer sous nous
        ecrireLocaleArgv(langue);                  // langue native : au prochain démarrage
        vscode.window.showInformationMessage(T('info.redemarrer'));
        if (rafraichirTout) { rafraichirTout(); }  // libellés de l'arbre tout de suite
      }
    } catch (e) {
      vscode.window.showErrorMessage(T('err.ecriture', ['settings.json', e.message]));
    }
  });
  panneau.webview.html = htmlReglages(crypto.randomBytes(16).toString('hex'));
}

// ---- Éditeur de tableau (webview) ------------------------------------------------
// Un tableau est un <table class="szh-tableau"> autonome dans
// articles/<slug>/tables/table-NN.html : style porté par des attributs data-* sur <table>
// et <tr>, en-têtes par <th scope>, inline simple dans les cellules. Parseur et
// sérialiseur, purs, dans lib/table-model.js.

// Couleur annuelle du fichier de config du profil courant (ausgabe.yaml ou buch.yaml) pour
// l'aperçu ; '' fait retomber sur le gris.
function lireCouleurAccent(racine) {
  try {
    const c = String(analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8')).couleur || '').toUpperCase();
    return HEX_COULEURS.indexOf(c) !== -1 ? c : '';
  } catch (e) { return ''; }
}

// Teintes lues dans out/.szh-accent.css, écrit par accent-css.py, et jamais recalculées :
// l'éditeur doit montrer les hex que WeasyPrint appliquera.
function lireTeintesAccent(racine) {
  const jetons = { clair: null, fonce: null, filet: null };
  try {
    const css = fs.readFileSync(path.join(racine, 'out', '.szh-accent.css'), 'utf8');
    const lire = (nom) => {
      const m = css.match(new RegExp(nom + '\\s*:\\s*(#[0-9A-Fa-f]{3,6})'));
      return m ? m[1] : null;
    };
    jetons.clair = lire('--szh-accent-clair');
    jetons.fonce = lire('--szh-accent-fonce');
    jetons.filet = lire('--c-annual-ui');
  } catch (e) { /* jamais compilé : gris neutres */ }
  return jetons;
}

function textesTable() {
  const cles = [
    'table.enregistrer', 'table.fusionner', 'table.scinder',
    'table.grpApercu', 'table.apercuVoir', 'table.apercuCacher',
    'table.preset.academique',
    'table.preset.entetenegatif',
    'table.preset.entetecouleur',
    'table.preset.entetegris',
    'table.preset.lignesalternees',
    'table.preset.colonnesalternees',
    'table.preset.synthese',
    'table.preset.matrice',
    'table.tip.apercuVoir', 'table.tip.apercuCacher',
    'table.rien', 'table.fusionImpossible', 'table.enregistre',
    'table.ctx.ligneAvant', 'table.ctx.ligneApres', 'table.ctx.ligneSuppr',
    'table.ctx.colAvant', 'table.ctx.colApres', 'table.ctx.colSuppr',
    'table.entete', 'table.entete.lignes', 'table.entete.colonnes', 'table.enteteRetirer',
    'table.sectionTitre', 'table.sectionTitreRetirer',
    'table.legende', 'table.legende.indice',
    'table.alt', 'table.alt.indice', 'table.alt.aide',
    'table.copyright', 'table.copyright.indice', 'table.source', 'table.source.indice',
    'table.zone.styles', 'table.zone.preset',
    'table.zone.entetes', 'table.entetesLignes', 'table.entetesColonnes', 'table.entetes.aucun',
    'table.total', 'table.gras',
    'table.fond.aucun', 'table.fond.negatif', 'table.fond.couleur', 'table.fond.gris',
    'table.zone.tableau', 'table.bordureHaute', 'table.bordureBasse',
    'table.zebreCol', 'table.zebreLig',
    'table.zebre.aucun', 'table.zebre.paires', 'table.zebre.impaires', 'table.zebre.entetes',
    'table.grpEdition', 'table.annuler', 'table.retablir', 'table.vider', 'table.effacerForme',
    'table.retour', 'table.nonEnregistre',
    'table.tip.annuler', 'table.tip.retablir', 'table.tip.vider', 'table.tip.effacerForme',
    'table.tip.retour', 'table.tip.enregistrer',
    'table.section.a11y', 'table.coller',
    'table.ctx.alignGauche', 'table.ctx.alignCentre', 'table.ctx.alignDroite',
    'table.plusLigne', 'table.plusColonne', 'table.tirerReordonner', 'table.deplacementImpossible',
    'table.suppr.question', 'table.suppr.detail', 'table.suppr.bouton',
    'table.tip.entete', 'table.tip.enteteRetirer'
  ];
  const o = {};
  for (const c of cles) { o[c.slice('table.'.length)] = T(c); }
  return o;
}

// Le contenu du tableau n'est pas injecté dans le HTML : le modèle arrive par
// postMessage et la grille est construite en DOM, sans innerHTML.
function htmlEditeurTable(nonce) {
  // media/table-editor.{html,css,js} ; les libellés arrivent par postMessage.
  return construireHtml('table-editor', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'], titre: T('table.titre', [''])
  });
}

let panneauxTable = new Map();   // fsPath -> WebviewPanel (un éditeur par fichier)

// Rappel donné à lib/cycle-vie.js (fermerFormulairesEcriture) : lui seul connaît la forme
// de ses clés (un chemin de fichier, ici, pas un slug). `slug` absent ou `racine` absente
// -> tout fermer (verrouillage du numéro).
function fermerPanneauxTableDe(racine, slug) {
  const tout = !racine || !slug;
  const dossier = tout ? null : path.join(racine, dossierUnites(), slug) + path.sep;
  for (const [cle, panneau] of Array.from(panneauxTable.entries())) {
    if (!tout && String(cle).indexOf(dossier) !== 0) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    panneauxTable.delete(cle);
  }
}

async function ouvrirEditeurTable(fournisseur, item) {
  if (!fournisseur.racine || !item || !item.cheminAsset) { return; }
  const chemin = item.cheminAsset;
  const nom = path.basename(chemin);
  const slugArticle = item.slug || session.apercuCourantSlug();
  // L'éditeur a besoin de largeur ; « Voir dans l'aperçu » le rouvre à la demande.
  await fermerTousLesApercus();
  const existant = panneauxTable.get(chemin);
  if (existant) {
    existant.reveal(vscode.ViewColumn.One);
    annoncerMain(existant, fournisseur.racine, chemin);
    return;
  }
  const panneau = vscode.window.createWebviewPanel(
    'szhEditeurTable', T('table.titre', [nom]), vscode.ViewColumn.One,
    // Saisie longue : la webview garde son état masquée, plutôt que de repartir à vide.
    { enableScripts: true, localResourceRoots: [], retainContextWhenHidden: true }
  );
  panneauxTable.set(chemin, panneau);
  panneau.onDidDispose(() => {
    libererCoedition(panneau);
    if (panneauxTable.get(chemin) === panneau) { panneauxTable.delete(chemin); }
  });
  const charger = () => {
    let html = '';
    try { html = fs.readFileSync(chemin, 'utf8'); } catch (e) { html = '<table><tr><td></td></tr></table>'; }
    noterLectureCoedition(panneau, fournisseur.racine, chemin);
    const modele = analyserTable(html);
    panneau.webview.postMessage({
      type: 'charger', modele: modele, disposition: disposition(modele),
      accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE,
      i18n: textesTable()
    });
  };
  // La webview ne demande confirmation que pour supprimer une ligne ou colonne non vide.
  const appliquer = async (msg) => {
    if (msg.confirmer) {
      const choix = await vscode.window.showWarningMessage(
        T('table.suppr.question'), { modal: true, detail: T('table.suppr.detail') }, T('table.suppr.bouton'));
      if (choix !== T('table.suppr.bouton')) { return; }
    }
    const res = appliquerOperationTable(String(msg.nom || ''), msg.modele, msg.args);
    if (res && res.erreur) { panneau.webview.postMessage({ type: 'erreur', message: T(res.erreur) }); return; }
    panneau.webview.postMessage({ type: 'charger', modele: res, disposition: disposition(res),
      accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE });
  };
  // -> null quand le tableau est écrit, sinon { code, message } : le bail de co-édition
  //    tenu par un autre poste, une saisie périmée, ou l'échec de l'écriture elle-même.
  const enregistrer = (modele, auto) => {
    const refus = ecrireSousMain(panneau, fournisseur.racine, chemin, () => {
      try { ecrireAtomique(chemin, serialiserTable(normaliserModele(modele))); return null; }
      catch (e) { return String((e && e.message) || e); }
    });
    if (refus) { return refus; }
    // L'enregistrement automatique reste silencieux.
    if (!auto) { vscode.window.setStatusBarMessage(T('statut.table.enregistree', [nom]), 5000); }
    return null;
  };
  panneau.webview.onDidReceiveMessage(async (msg) => {
    if (!msg) { return; }
    if (msg.type === MSG.PRET) {
      charger();
      // Un éditeur de tableau ne s'ouvre pas pour lire : le bail se prend tout de suite.
      annoncerMain(panneau, fournisseur.racine, chemin);
      return;
    }
    if (msg.type === MSG.OPERATION) { await appliquer(msg); return; }
    if (msg.type === MSG.RESTAURER) {
      // La pile d'annulation vit dans la webview ; l'hôte calcule la disposition.
      const m = normaliserModele(msg.modele);
      panneau.webview.postMessage({ type: 'charger', modele: m, disposition: disposition(m),
        accent: lireCouleurAccent(fournisseur.racine), teintes: lireTeintesAccent(fournisseur.racine),
      presets: PRESETS_ORDRE });
      return;
    }
    if (msg.type === MSG.APERCU_OUVRIR) {
      // Cherche dans le .md la ligne de la référence ::: {.szh-tabelle src="…"}. Le
      // tableau inclus étant un bloc HTML brut, sans position source, la webview peut
      // n'avoir rien à surligner.
      if (!slugArticle) { return; }
      ouvrirApercuHtml(fournisseur, slugArticle);
      const md = path.join(fournisseur.racine, dossierUnites(), slugArticle, slugArticle + '.md');
      let ligne = 0;
      try {
        const lignes = fs.readFileSync(md, 'utf8').split(/\r?\n/);
        for (let i = 0; i < lignes.length; i++) {
          if (lignes[i].indexOf(nom) !== -1 && lignes[i].indexOf('szh-tabelle') !== -1) { ligne = i + 1; break; }
        }
      } catch (e) { /* .md illisible : l'aperçu est rouvert, cela suffit */ }
      if (ligne > 0) {
        // La webview vient d'être créée, son script n'écoute pas encore.
        setTimeout(() => {
          if (!session.panneauApercuHtml()) { return; }
          try { session.panneauApercuHtml().webview.postMessage({ type: 'surligner', ligne: ligne, mot: '' }); }
          catch (e) { /* aperçu refermé entre-temps */ }
        }, 400);
      }
      return;
    }
    if (msg.type === MSG.APERCU_FERMER) { fermerApercuHtml(); return; }
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + T('table.titre', [nom]);
      return;
    }
    if (msg.type === MSG.RETOUR_ARTICLE) {
      // Garde « non enregistré » sur un chemin de fermeture que l'on contrôle.
      if (msg.modifie) {
        const choix = await confirmerAbandon(T('table.quitter.question', [nom]));
        if (choix === 'annuler') { return; }                       // Annuler : on reste
        if (choix === 'enregistrer') {
          const refus = enregistrer(msg.modele);
          if (refus) { panneau.webview.postMessage({ type: 'erreur', message: refus.message }); return; }
        }
      }
      if (item.slug) { await ouvrirArticle(fournisseur, item.slug); }
      panneau.dispose();
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const refus = enregistrer(msg.modele, !!msg.auto);
      if (refus) {
        panneau.webview.postMessage({ type: 'erreur', message: refus.message });
        // Périmé : la grille à l'écran n'est plus celle du fichier, elle repart du disque.
        if (refus.code === 'perime') { charger(); }
        return;
      }
      panneau.webview.postMessage({ type: 'enregistre', auto: !!msg.auto });
      return;
    }
    console.warn('éditeur de tableau : type de message inconnu', msg.type);
  });
  panneau.webview.html = htmlEditeurTable(crypto.randomBytes(16).toString('hex'));
}

// Le nombre de blocs de la page de Documentation : ses fiches et ses rubriques réunies —
// ce que le badge de l'en-tête « ACTUALITÉ » annonce. Une lecture de fichier par
// reconstruction de l'arbre, comme la fiche de métadonnées de chaque article l'est déjà.
function compterBlocsDocumentation(racine, slug) {
  if (!racine || !slug) { return 0; }
  let texte;
  try { texte = fs.readFileSync(path.join(racine, dossierUnites(), slug, slug + '.md'), 'utf8'); }
  catch (e) { return 0; }                          // page absente ou illisible : rien à dire
  return ressourcesLib.lireRessources(texte).length + rubriquesLib.lireRubriques(texte).length;
}

// ---- Réserve de fiches : mettre de côté, et échanger entre les deux revues -------
//
// Deux besoins qui n'en font qu'un magasin. « Mettre en réserve » sort une fiche du numéro
// courant sans la perdre — elle attend un numéro qui aura la place, ou le bon dossier
// thématique. « Envoyer à l'autre revue » en dépose une copie dans la réserve de la revue
// sœur, marquée à traduire : c'est le canal par lequel un livre relevé côté français arrive
// côté allemand, et réciproquement.
//
// La réserve vit hors du numéro (lib/reserve.js, cheminReserve) : dans le dossier parent,
// donc dans OneDrive, donc partagée par l'équipe et survivant au bouclage d'un numéro.
//
// Pourquoi une liste à choisir (QuickPick) et pas un formulaire de plus : on ne saisit rien
// dans une réserve, on y prend ou on y jette. Un panneau webview aurait ajouté trois
// fichiers de media/ pour reproduire une liste que l'éditeur sait déjà afficher, avec sa
// recherche incrémentale par-dessus le marché.

// Le jeton de revue du numéro ouvert. Repli sur 'revue' plutôt que sur rien : la réserve
// doit rester utilisable même sur un numéro dont ausgabe.yaml n'a pas encore de `revue:`.
function revueCourante(racine) {
  const jeton = revueNumero(racine);
  return reserveLib.REVUES.indexOf(jeton) !== -1 ? jeton : 'revue';
}

function nomRevueAffiche(revue) {
  return T('reserve.nom.' + (reserveLib.REVUES.indexOf(revue) !== -1 ? revue : 'revue'));
}

// Le compte affiché sur l'entrée « Réserve » de l'arbre : celui de la revue ouverte, la
// seule dans laquelle on puisse insérer. Jamais une exception : une réserve illisible se
// compte zéro, elle ne doit pas empêcher l'arbre de s'afficher.
function compterReserve(racine) {
  if (!racine) { return 0; }
  try { return reserveLib.lister(racine, revueCourante(racine)).length; }
  catch (e) { return 0; }
}

// Le texte exact du bloc d'une fiche, tel qu'il est écrit dans le .md. Régénéré par
// blocRessource() plutôt que découpé dans le fichier : la fiche part alors dans la réserve
// sous la forme normalisée que le formulaire aurait écrite, et non avec les espaces d'une
// saisie à la main — c'est cette même forme que lireRessources() saura relire à l'insertion.
function blocDeFiche(fiche) {
  return ressourcesLib.blocRessource(fiche.id, fiche.type, fiche.valeurs);
}

// Dépose une fiche de l'article `slug` dans une réserve. `vers` est le jeton de revue visée,
// `aTraduire` dit si la copie attend une traduction. Rend true si le dépôt a eu lieu.
function deposerFicheEnReserve(racine, slug, fiche, vers, aTraduire) {
  const media = path.join(racine, dossierUnites(), slug, 'media');
  const image = (fiche.valeurs.image && relatifImageValide(fiche.valeurs.image))
    ? { source: path.join(media, fiche.valeurs.image), nom: path.basename(fiche.valeurs.image) }
    : null;
  const charge = {
    origine: revueCourante(racine),
    numeroOrigine: titreNumero(racine) || '',
    aTraduire: !!aTraduire,
    deposeLe: new Date().toISOString().slice(0, 10),
    type: fiche.type,
    titre: fiche.valeurs.titre || '',
    bloc: blocDeFiche(fiche)
  };
  if (image && fs.existsSync(image.source)) { charge.image = image; }
  try {
    reserveLib.deposer(racine, vers, charge);
    return true;
  } catch (e) {
    vscode.window.showErrorMessage(T('reserve.err.ecriture', [e.message]));
    return false;
  }
}

// Insère une fiche prise en réserve dans un article ouvert. L'image, si la fiche en porte
// une, est copiée de la réserve vers articles/<slug>/media/ sous un nom libre, et le chemin
// est réécrit en conséquence : une fiche insérée doit être une fiche autonome de l'article,
// pas un renvoi vers un dossier partagé qu'un collègue peut vider.
async function insererFicheDeReserve(fournisseur, rafraichirTout, entree) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const ed = vscode.window.activeTextEditor;
  let slug = ed ? slugDepuisChemin(racine, ed.document.uri.fsPath) : null;
  if (!slug) { slug = session.apercuCourantSlug(); }
  if (!slug || !new Set(fournisseur.listerArticles()).has(slug)) {
    vscode.window.setStatusBarMessage(T('reserve.inserer.horsarticle'), 5000);
    return;
  }
  const fiches = ressourcesLib.lireRessources(entree.fiche.bloc);
  if (fiches.length === 0) { return; }              // fichier trafiqué : rien d'exploitable
  const fiche = fiches[0];
  const valeurs = Object.assign({}, fiche.valeurs);

  if (valeurs.image) {
    // La réserve range l'image dans un media/ à côté du .md, comme un article (voir
    // lib/reserve.js) : c'est ce qui fait que lireRessources() a su la relire ci-dessus.
    const source = path.join(path.dirname(entree.chemin), 'media', path.basename(valeurs.image));
    const dossier = path.join(racine, dossierUnites(), slug, 'media');
    try {
      fs.mkdirSync(dossier, { recursive: true });
      const nom = nomMediaLibre(dossier, path.basename(valeurs.image));
      fs.copyFileSync(source, path.join(dossier, nom));
      valeurs.image = nom;
    } catch (e) {
      // L'image manque ou n'a pas pu être copiée : la fiche s'insère sans elle plutôt que
      // pas du tout, et le rendu s'en accommode (szh-ressource.lua ne présume aucune image).
      valeurs.image = '';
    }
  }

  const md = path.join(racine, dossierUnites(), slug, slug + '.md');
  let doc;
  try { doc = await vscode.workspace.openTextDocument(md); }
  catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(md), e.message])); return; }
  const texte = ressourcesLib.ajouterRessource(doc.getText(), fiche.id, fiche.type, valeurs);
  try {
    const edition = new vscode.WorkspaceEdit();
    const fin = doc.lineAt(doc.lineCount - 1).range.end;
    edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), texte);
    if (!(await vscode.workspace.applyEdit(edition))) { return; }
    await doc.save();
  } catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(md), e.message])); return; }

  reserveLib.retirer(entree.chemin);                // prise en réserve = sortie de réserve
  vscode.window.setStatusBarMessage(T('reserve.insere'), 5000);
  if (rafraichirTout) { rafraichirTout(); }
}

// La réserve de la revue ouverte, à choisir puis à traiter. Deux temps, et non des boutons
// par ligne : le second QuickPick nomme l'action en toutes lettres, ce qui évite de
// supprimer une fiche d'un clic mal placé.
async function ouvrirReserve(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  const revue = revueCourante(racine);
  const entrees = reserveLib.lister(racine, revue);
  if (entrees.length === 0) {
    vscode.window.showInformationMessage(T('reserve.vide'));
    return;
  }
  const items = entrees.map((e) => {
    const f = e.fiche;
    const fiches = ressourcesLib.lireRessources(f.bloc);
    const titre = (fiches.length > 0 && fiches[0].valeurs.titre) || e.nom;
    const detail = [
      f.aTraduire ? T('reserve.atraduire') : null,
      f.origine ? T('reserve.origine', [nomRevueAffiche(f.origine), f.numeroOrigine || '?']) : null,
      f.deposeLe ? T('reserve.depose.le', [f.deposeLe]) : null
    ].filter(Boolean).join(' · ');
    return {
      label: (f.aTraduire ? '$(globe) ' : '$(archive) ') + titre,
      description: fiches.length > 0 ? fiches[0].type : '',
      detail: detail,
      entree: e
    };
  });
  // ⚠ sousGarde, comme tout choix de ce fichier : sans elle, la fin d'une compilation
  //   (l'aperçu qui se recharge, l'avis de journal) referme le QuickPick sous les doigts du
  //   rédacteur. Contrat vérifié à la lecture de la source par test/js/interaction.test.js.
  const choix = await sousGarde(() => vscode.window.showQuickPick(items, {
    title: T('reserve.titre'),
    placeHolder: T('reserve.compte', [entrees.length]),
    matchOnDetail: true
  }));
  if (!choix) { return; }
  const ACTION_INSERER = T('reserve.inserer');
  const ACTION_SUPPRIMER = T('reserve.supprimer');
  const action = await sousGarde(() => vscode.window.showQuickPick(
    [{ label: ACTION_INSERER, detail: T('reserve.inserer.tip') },
     { label: ACTION_SUPPRIMER, detail: T('reserve.supprimer.tip') }],
    { title: choix.label, placeHolder: T('reserve.titre') }));
  if (!action) { return; }
  if (action.label === ACTION_INSERER) {
    if (refuserSiVerrouille()) { return; }
    await insererFicheDeReserve(fournisseur, rafraichirTout, choix.entree);
    return;
  }
  const sur = await vscode.window.showWarningMessage(
    T('reserve.supprimer.question'), { modal: true, detail: choix.label },
    T('reserve.supprimer'));
  if (sur !== T('reserve.supprimer')) { return; }
  reserveLib.retirer(choix.entree.chemin);
  vscode.window.setStatusBarMessage(T('reserve.supprime'), 5000);
  if (rafraichirTout) { rafraichirTout(); }
}

// ---- Les réglages de la maison, posés sans écraser ceux du rédacteur -------------
//
// Le gabarit `vscodium-user/settings.json` est déclaré en DÉFAUTS d'extension
// (contributes.configurationDefaults, recopie exacte du gabarit — voir
// lib/reglages-flotte.js et test/js/reglages-flotte.test.js). Un défaut vit sous le fichier
// du rédacteur au lieu de le remplacer : la mise à jour du poste n'a donc plus à réécrire
// ses réglages, et ce qu'il a choisi ne disparaît plus.
//
// Reste ce que l'éditeur REFUSE en défaut d'extension — les réglages de portée
// « application », qu'il retire de la contribution avec un simple avertissement. Ceux-là,
// on les pose ici, par l'API de configuration, qui fait une retouche chirurgicale du
// fichier. Lesquels ? On ne le devine pas, on le mesure : la portée d'un réglage peut
// changer d'une version de l'éditeur à l'autre, et une liste écrite en dur vieillirait sans
// prévenir.
//
// ⚠ Une seule fois par valeur voulue, jamais à chaque démarrage : l'empreinte du gabarit est
//   mémorisée, et tant qu'elle ne bouge pas on ne touche à rien. Sans cette garde, un
//   rédacteur qui aurait délibérément changé un de ces réglages se le verrait réimposer à
//   chaque ouverture — le défaut de départ sous une autre forme.
const DEFAUTS_MAISON = (require('./package.json').contributes || {}).configurationDefaults || {};
const CLE_EMPREINTE_REGLAGES = 'szh.reglagesMaison.empreinte';

// Les surcharges par langue (« [markdown] ») ne passent pas par la sonde : le point
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
      // Un réglage que l'éditeur refuse aussi par l'API : on le dit et on continue. Le
      // poste vaut mieux avec cinquante réglages sur cinquante et un qu'avec aucun.
      console.warn('réglage de la maison non posé : ' + cle + ' — ' + ((e && e.message) || e));
    }
  }
  // L'empreinte est mémorisée même en cas d'échec partiel : réessayer à chaque démarrage ne
  // réparerait rien et réécrirait le fichier du rédacteur sans fin.
  await context.globalState.update(CLE_EMPREINTE_REGLAGES, empreinte);
  return aPoser;
}

function activate(context) {
  // Rien n'attend ce travail : il ne conditionne aucune commande, et le faire attendre
  // retarderait l'ouverture de la barre latérale.
  poserReglagesMaison(context).catch((e) => {
    console.warn('réglages de la maison : ' + ((e && e.message) || e));
  });
  // Et les réglages protégés déployés par la mise à jour, recopiés là où la chaîne de
  // compilation les lit — seulement s'ils ont changé depuis la dernière fois.
  relayerReglagesProteges(context).catch((e) => {
    console.warn('réglages protégés : ' + ((e && e.message) || e));
  });
  const fournisseur = new FournisseurRevue();

  // Rapports d'erreur automatiques (lib/rapport-erreur.js) : la file mise de côté la
  // dernière fois que le dossier SharePoint était injoignable part maintenant que
  // l'extension redémarre — un échec la laisse en place pour la prochaine activation
  // (§4.4).
  //
  // ⚠ Pas d'écouteur global sur l'exception non rattrapée du processus ici, et ce n'est
  // pas un oubli : ce processus est l'hôte d'extensions de VSCodium, PARTAGÉ avec toutes
  // les autres extensions. Y poser un tel écouteur supprime le comportement par défaut de
  // Node pour TOUT le processus (sans lui, Node journalise et termine ; avec lui, s'il ne
  // relance rien, le processus continue dans un état potentiellement corrompu) — un
  // changement global, hors périmètre d'un lot qui ne parle que de rapports d'erreur —, et
  // attraperait aussi bien les exceptions des AUTRES extensions, qui se retrouveraient
  // signalées comme des pannes SZH dans le dossier partagé. signalerExceptionCockpit()
  // (juste en dessous) n'est donc appelée que depuis nos propres frontières : l'enveloppe
  // posée sur cmd()/cmdEcriture(), là où toute commande szh.* est enregistrée — une
  // exception qui en sort est certainement la nôtre, jamais celle d'une autre extension.
  rapportErreur.viderFileAttente();
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
    } catch (e) { /* D5 : un gestionnaire d'exception ne doit jamais lui-même en lever */ }
  }

  const vue = vscode.window.createTreeView(ID_VUE, {
    treeDataProvider: fournisseur,
    showCollapseAll: false,
    // rafraichirTout est défini plus bas, d'où l'indirection.
    dragAndDropController: controleurDepotVue(fournisseur, () => rafraichirTout())
  });
  context.subscriptions.push(vue);
  vueArbre = vue;                                  // reselectionnerArticle passe par elle

  // Le chevron reste un geste valable : déplier un en-tête par lui replie les autres —
  // l'accordéon tient — et ouvre la même vue d'ensemble que le clic sur le titre ; le
  // replier libère tout, sans reconstruction (l'écran est déjà juste) et sans rien
  // ouvrir. Seuls les en-têtes portent `categorie` : les articles dépliés sur leurs
  // assets passent ici sans effet. Le garde-fou est le changement d'état : un dépliage
  // programmé (clic d'article -> reveal, reconstruction d'un en-tête déjà ouvert) arrive
  // ici avec sectionDeployee déjà posé et n'ouvre donc rien — décision B préservée.
  context.subscriptions.push(
    vue.onDidExpandElement((e) => {
      if (!e || !e.element || !e.element.categorie) { return; }
      const categorie = e.element.categorie;
      if (fournisseur.definirSectionDeployee(categorie)) {
        fournisseur.rafraichir();
        if (VUE_SECTION[categorie]) { vscode.commands.executeCommand(VUE_SECTION[categorie]); }
      }
    }),
    vue.onDidCollapseElement((e) => {
      if (!e || !e.element || !e.element.categorie) { return; }
      if (fournisseur.sectionDeployee === e.element.categorie) { fournisseur.sectionDeployee = null; }
    })
  );

  // Le point de l'article ouvert (majArticleOuvert) : posé sur le .md, il colore sa ligne
  // de l'arbre (resourceUri) et son onglet. `list.highlightForeground` est la couleur que
  // le thème réserve à l'élément qui compte dans une liste.
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
  context.subscriptions.push({ dispose: arreterDormeurWsl });   // pas de dormeur orphelin

  const barreApercu = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  barreApercu.command = 'szh.basculerApercu';
  context.subscriptions.push(barreApercu);

  // N'apparaît que sur un numéro gelé, et passe avant l'aperçu : c'est ce qui explique
  // pourquoi l'éditeur ne répond plus aux frappes.
  // Le compteur des contrôles : à gauche de la bascule d'aperçu, masqué quand la dernière
  // compilation n'a rien relevé.
  barreControles = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 40);
  barreControles.command = 'szh.vueControles';
  context.subscriptions.push(barreControles);

  // Le badge PDF/UA de l'article ouvert : entre le compteur des contrôles et la bascule
  // d'aperçu. Masqué tant qu'aucun article n'est ouvert ou que rien n'est connu (majBadgePdfUa).
  barrePdfUa = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 45);
  barrePdfUa.command = 'szh.vueControles';
  context.subscriptions.push(barrePdfUa);

  const barreEtat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
  context.subscriptions.push(barreEtat);

  // Le badge « Dossier de test » : un poste qui pointe sur l'arborescence de test le dit
  // dans la barre d'état, en couleur — la décision test/production reste ouverte, ce badge
  // ne fait qu'annoncer. Couleur posée une fois pour toutes : elle ne varie pas, seule la
  // visibilité change.
  const barreModeTest = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 70);
  barreModeTest.command = 'szh.reglages';
  barreModeTest.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  context.subscriptions.push(barreModeTest);

  const majBarreApercu = () => {
    barreApercu.text = T(modeApercu() === 'html' ? 'apercu.barre.html' : 'apercu.barre.pdf');
    barreApercu.tooltip = T('apercu.barre.tooltip');
    if (fournisseur.racine) { barreApercu.show(); } else { barreApercu.hide(); }
  };

  // lireModeDeveloppeur() (déjà importé de lib/archivage.js) vaut exactement
  // lireEmplacementRevues() === EMPLACEMENT_TEST : pas de nouvel import nécessaire ici.
  const majBarreModeTest = () => {
    if (fournisseur.racine && lireModeDeveloppeur()) {
      barreModeTest.text = '$(beaker) ' + T('etat.barre.test');
      barreModeTest.tooltip = T(lireConfigPoste() ? 'etat.barre.test.tooltip' : 'etat.barre.test.defaut');
      barreModeTest.show();
    } else {
      barreModeTest.hide();
    }
  };

  // getChildren recalcule le compte des Word, le titre suit le numéro, et l'aperçu HTML
  // est rechargé si sa sortie a été régénérée.
  // `opts.derive: false` : ce rafraîchissement ne vient pas d'un geste fait sur ce poste.
  // C'est le surveillant de fichiers qui l'a déclenché, donc la livraison par OneDrive du
  // travail d'un autre poste — et dans ce cas le fichier dérivé des DOI n'est pas réécrit.
  // Sans cette distinction, chaque poste réécrivait dois-calcules.yaml en réaction au
  // changement de l'autre, les deux dans la même fenêtre de synchronisation : c'est
  // exactement ce qui fabriquait des copies en conflit sur ce fichier.
  const rafraichirTout = (opts) => {
    // Avant tout le reste : le titre de la vue et les boutons de l'arbre en dépendent.
    majEtatNumero(fournisseur, barreEtat);
    fournisseur.rafraichir();
    if (!opts || opts.derive !== false) { ecrireDoisCalcules(fournisseur); }
    vue.title = fournisseur.racine ? titreVue(fournisseur.racine) : T('arbre.titre.defaut');
    majBarreApercu();
    rechargerApercuHtmlSiChange(fournisseur);
    // Une copie en conflit déjà déposée par le synchroniseur ne doit pas rester muette.
    avertirCopiesConflit(fournisseur.racine);
  };

  // Regroupe les rafales du système de fichiers : OneDrive en émet plusieurs.
  let minuteur = null;
  const rafraichirBientot = () => {
    if (minuteur) { clearTimeout(minuteur); }
    // derive: false — voir rafraichirTout. Un changement arrivé par le système de fichiers
    // n'est pas un geste de ce poste : on relit, on n'écrit rien de dérivé.
    minuteur = setTimeout(() => { minuteur = null; rafraichirTout({ derive: false }); }, 300);
  };

  const reinstallerWatchers = (racine) => {
    for (const w of watchers) { w.dispose(); }
    watchers = [];
    if (!racine) { return; }
    // Unités de texte, Word déposés, sorties, et le fichier de configuration dont dépend le
    // titre de la vue. Les motifs suivent le profil : sur un livre, surveiller `articles/**`
    // et `ausgabe.yaml` revenait à surveiller trois chemins qui n'existent pas — l'arbre ne
    // se rafraîchissait alors jamais tout seul, et il fallait rouvrir la fenêtre pour voir
    // un chapitre importé. Le profil est posé juste avant, par trouverRacineRevue().
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
    // Le point de l'article ouvert appartient à la revue : recalculé sur la nouvelle
    // racine, il s'éteint si le fichier actif n'est plus un de ses articles.
    const editeurActif = vscode.window.activeTextEditor;
    majArticleOuvert(fournisseur,
      editeurActif && editeurActif.document ? editeurActif.document.uri.fsPath : null);
    session.poserDivergenceSignalee(false);                    // un avertissement par revue ouverte
    // Les constats appartiennent au numéro qui les a produits : changer de numéro les
    // périme, sinon le compteur de la barre d'état parlerait du précédent et un échec de
    // compilation ici se ferait taire par un bloquant venu d'ailleurs. On relit le journal
    // du nouveau numéro sans rien annoncer : ce que la dernière compilation avait relevé
    // est encore vrai à l'ouverture, mais ce n'est pas une nouvelle.
    if (dernierJournal.racine !== racine) {
      // `reimport` compris : les cinq autres affectations le posent, et lireControles le
      // concatène sans le tester. L'oublier ici suffisait à faire taire tous les constats.
      dernierJournal = { racine: racine, constats: lireJournalTache(racine), code: 0,
                         reimport: [], export: [] };
    }
    majBarreControles();
    majBarreModeTest();
    session.poserProfilRevue(lireProfil(racine));            // pilote le mode d'aperçu
    // Les deux clés se posent à chaque rafraîchissement, celle du profil actif à vrai et
    // l'autre à faux. Ne poser que la première laisserait szh.estRevue vrai après le
    // passage à un livre, et les deux vues latérales s'afficheraient ensemble.
    const cles = profils.contextes(session.profilOuvrage());
    for (const nom of Object.keys(cles)) {
      vscode.commands.executeCommand('setContext', nom, !!racine && cles[nom]);
    }
    reinstallerWatchers(racine);
    if (racine) { demarrerDormeurWsl(); } else { arreterDormeurWsl(); }
    // Les copies en conflit du numéro précédent ne sont plus les nôtres, et les baux
    // laissés par une session tuée finissent par partir : un ménage par revue ouverte, pas
    // un de plus — le dossier .szh-edition ne contient qu'un fichier par (fichier, personne).
    oublierCopiesSignalees();
    if (racine) { try { coedition.purger(racine); } catch (e) { /* jamais bloquant */ } }
    rafraichirTout();
  };

  // `cmd` pour ce qui lit, `cmdEcriture` pour ce qui modifie le numéro et se voit refusé
  // quand il est verrouillé : la liste montre ce que le verrou protège. Les deux passent
  // par envelopperCommande() : toute commande szh.* qui lève, ou dont la promesse rendue
  // se rejette, est certainement UNE DES NÔTRES (jamais celle d'une autre extension,
  // contrairement à un écouteur global) — signalée en COCKPIT-EXCEPTION puis RELANCÉE À
  // L'IDENTIQUE, pour ne rien changer à ce que VSCodium affiche déjà de son côté.
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
    // Le nom montré aux autres postes est retenu une fois : le changer doit valoir tout de
    // suite, sans redémarrer l'éditeur.
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
    // « Garder la mienne » n'écrit que dans la copie, un fichier que personne ne lit et qui
    // est destiné à disparaître : elle reste donc offerte même sur un numéro gelé, comme la
    // suppression de la copie — retirer ce qu'un synchroniseur a laissé n'est pas modifier
    // le numéro.
    cmd('szh.conflit.garder',
      (uri, blocs, index) => resoudreBlocConflit(uri, blocs, index, false)),
    cmd('szh.conflit.supprimerCopie', (uri) => {
      const chemin = fichierConflitVise(uri);
      return supprimerCopieConflit(chemin ? copieConflitPour(chemin) : null, true);
    }),
    // Le SourceControl est créé à la demande : il faut quand même le défaire à l'extinction.
    { dispose: () => { if (scmConflits) { scmConflits.dispose(); scmConflits = null; } } },
    cmdEcriture('szh.metadonnees', () => ouvrirMetadonnees(fournisseur, rafraichirTout)),
    cmdEcriture('szh.apercuMetadonnees', () => ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null)),
    // Le même formulaire, filtré sur un article.
    cmdEcriture('szh.metadonneesArticle', (item) => ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.traduction', (item) => ouvrirTraduction(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.traductionsToutPret', () => marquerToutPretTraduction(fournisseur, rafraichirTout)),
    // Le tutoriel : neuf étapes dans la page d'accueil de l'éditeur, cochées à mesure que
    // les commandes correspondantes sont jouées. C'est le seul « calque » qu'une extension
    // puisse poser par-dessus l'interface — un webview vit dans son cadre et ne peut pas
    // dessiner sur la barre latérale ni sur les onglets.
    vscode.commands.registerCommand('szh.tutoriel', () => vscode.commands.executeCommand(
      'workbench.action.openWalkthrough', 'szh-csps.szh-cockpit#szhDemarrage', false)),
    vscode.commands.registerCommand('szh.vueTraductions',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'traductions')),
    cmd('szh.vueArticles', () => ouvrirVueArticles(fournisseur, rafraichirTout)),
    cmd('szh.envoyerAuteur', (item) => envoyerAuteur(fournisseur, item)),
    // Monter et descendre depuis l'arbre. ⚠ `cmd` et non `cmdEcriture` : un numéro
    // verrouillé a ses textes figés mais son sommaire peut encore se décider, et
    // deplacerUnite() porte déjà le refus qui convient — celui de l'archivage.
    // Le message part dans la barre d'état : un déplacement d'un cran ne mérite pas une
    // notification à fermer, et l'arbre montre déjà le résultat.
    cmd('szh.monterUnite', (item) => messageDeplacement(
      deplacerUnite(fournisseur, item && item.slug, -1, rafraichirTout))),
    cmd('szh.descendreUnite', (item) => messageDeplacement(
      deplacerUnite(fournisseur, item && item.slug, 1, rafraichirTout))),
    vscode.commands.registerCommand('szh.vueWord',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'word')),
    vscode.commands.registerCommand('szh.vueControles',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'controles')),
    // Fabriquer un lien ne modifie rien : disponible même sur un numéro verrouillé.
    cmd('szh.envoyerTraduction', (item) => envoyerPourTraduction(fournisseur, item)),
    cmd('szh.reglages', () => ouvrirReglages(rafraichirTout)),
    cmd('szh.basculerApercu', () => basculerApercu(fournisseur, majBarreApercu)),
    cmd('szh.apercuLivre', () => ouvrirApercuLivre(fournisseur)),
    cmdEcriture('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    cmdEcriture('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    // Les exports restent ouverts sur un numéro gelé, dont l'archivage a supprimé out/.
    cmd('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    cmd('szh.exporterXml', () => exporterXml(fournisseur, rafraichirTout)),
    cmd('szh.exporterArticle', (item) => exporterArticle(fournisseur, rafraichirTout, item)),
    // Les quatre sorties du livre : sans objet sur une revue, la commande palette les
    // garde hors du when szh.estLivre (package.json).
    cmd('szh.livreImprimeur', () => exporterLivre(NOM_TACHE_LIVRE_IMPRIMEUR, CLES_LIVRE_IMPRIMEUR)),
    cmd('szh.livreCouverture', () => exporterLivre(NOM_TACHE_LIVRE_COUVERTURE, CLES_LIVRE_COUVERTURE)),
    cmd('szh.livreEpub', () => exporterLivre(NOM_TACHE_LIVRE_EPUB, CLES_LIVRE_EPUB)),
    cmd('szh.livreWeb', () => exporterLivre(NOM_TACHE_LIVRE_WEB, CLES_LIVRE_WEB)),
    // Ces gestes posent et lèvent le verrou : ils restent hors de cmdEcriture.
    cmd('szh.archiverVerrouiller', () => archiverEtVerrouiller(fournisseur, rafraichirTout)),
    cmd('szh.deverrouiller', () => deverrouiller(fournisseur, rafraichirTout)),
    cmd('szh.desarchiver', () => desarchiver(fournisseur, rafraichirTout)),
    // Le second argument transmet les options (sansApercu depuis la vue Articles) ; les
    // appelants historiques (arbre, Contrôles, démarrage) n'en passent pas : rien ne change.
    cmd('szh.ouvrirArticle', (slug, opts) => ouvrirArticle(fournisseur, slug, opts)),
    // Le clic sur un en-tête de section : sa section se déplie, les autres se replient,
    // et la vue d'ensemble correspondante s'ouvre — le geste d'avant l'accordéon,
    // conservé. Un en-tête déjà déplié reste déplié : le clic n'ouvre alors que la vue.
    cmd('szh.ouvrirSection', (categorie) => {
      if (fournisseur.definirSectionDeployee(categorie)) { fournisseur.rafraichir(); }
      // « ACTUALITÉ » n'a pas de vue d'ensemble : son en-tête ouvre directement le
      // formulaire de la page de Documentation. C'est le seul en-tête de section qui ouvre
      // un formulaire plutôt qu'une liste, et c'est voulu — il n'y a qu'une page de
      // Documentation par numéro, une liste d'un seul élément n'aurait été qu'un détour.
      // La promesse est rendue : sans cela, un appelant qui attend szh.ouvrirSection
      // reprendrait la main avant que le formulaire ne soit ouvert.
      if (categorie === 'actualite') { return vscode.commands.executeCommand('szh.documentation'); }
      if (VUE_SECTION[categorie]) { vscode.commands.executeCommand(VUE_SECTION[categorie]); }
    }),
    cmdEcriture('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    // Le Word corrigé d'un article déjà publié, et le retour en arrière. Les deux
    // remplacent le texte : refusés sur un numéro verrouillé, comme la suppression.
    cmdEcriture('szh.reimporterArticle', (item) => reimporterArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.annulerReimport', (item) => annulerReimport(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.supprimerTable', (item) => supprimerAsset(fournisseur, rafraichirTout, item, true)),
    cmdEcriture('szh.editerTable', (item) => ouvrirEditeurTable(fournisseur, item)),
    // Le formulaire des médias de l'article : légendes, crédits, qualité, remplacement.
    cmdEcriture('szh.mediasArticle', (item) => ouvrirGestionMedias(fournisseur, rafraichirTout, item)),
    // La Documentation : les fiches de l'article (livres, films, interventions, agenda) et,
    // sur une page de Documentation seulement, ses rubriques de texte riche. Un seul
    // formulaire — d'où une seule commande, celle qui existait déjà.
    cmdEcriture('szh.ressourcesArticle', (item) => ouvrirDocumentation(fournisseur, rafraichirTout, item)),
    // La page de Documentation du numéro, créée au besoin. Volontairement hors cmdEcriture :
    // la relire sur un numéro verrouillé doit rester possible, seule sa création est refusée
    // (voir ouvrirPageDocumentation).
    cmd('szh.documentation', () => ouvrirPageDocumentation(fournisseur, rafraichirTout)),
    // La réserve : le magasin de fiches hors numéro, et le canal d'échange avec la revue
    // sœur (lib/reserve.js). Commande d'écriture : insérer et supprimer y touchent au disque.
    cmdEcriture('szh.reserve', () => ouvrirReserve(fournisseur, rafraichirTout)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte),
    // L'avertissement part au démarrage d'une tâche : Ctrl+S, le chemin le plus fréquent,
    // ne passe pas par les fonctions du cockpit.
    vscode.tasks.onDidStartTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      const nomsSuivis = [NOM_TACHE_BUILD, NOM_TACHE_EXPORT, NOM_TACHE_IMPORT, NOM_TACHE_DOCX,
        NOM_TACHE_LIVRE_IMPRIMEUR, NOM_TACHE_LIVRE_COUVERTURE, NOM_TACHE_LIVRE_EPUB, NOM_TACHE_LIVRE_WEB];
      const estNotre = (tache.definition && tache.definition.type === 'szh');
      if (nomsSuivis.indexOf(tache.name) === -1 && !estNotre) { return; }
      // Ctrl+S / triggerTaskOnSave ne passe par aucune fonction du cockpit : sans ce
      // compteur, les gardes qui lisent session.buildEnCours() (archivage, suppression…) restent
      // inopérantes sur ce chemin, pourtant le plus fréquent.
      session.poserTachesSuiviesEnVol(session.tachesSuiviesEnVol() + 1);
      session.poserBuildEnCours(true);
      // Une compilation démarre : un travail de validation PDF/UA déjà en vol juge peut-être
      // un PDF sur le point de changer — pdfuaHote jettera son résultat à son retour.
      pdfuaHote.signalerDebutBuild();
      avertirVersionSiDivergente();
    }),
    // Et à la fin : ce que la chaîne a relevé. Même raison de passer par l'événement
    // plutôt que par lancerTache() — Ctrl+S, le chemin le plus fréquent, ne passe par
    // aucune fonction du cockpit, et c'est justement là que les avertissements naissent.
    // Le compteur ne redescend pas ici : onDidEndTaskProcess ne se déclenche pas pour une
    // tâche interrompue avant le spawn (wsl.exe absent), et c'est justement le cas que la
    // garde ci-dessous doit couvrir. Seul le code de sortie vit ici.
    vscode.tasks.onDidEndTaskProcess((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      const nomsSuivis = [NOM_TACHE_BUILD, NOM_TACHE_EXPORT, NOM_TACHE_IMPORT, NOM_TACHE_DOCX,
        NOM_TACHE_LIVRE_IMPRIMEUR, NOM_TACHE_LIVRE_COUVERTURE, NOM_TACHE_LIVRE_EPUB, NOM_TACHE_LIVRE_WEB];
      const estNotre = (tache.definition && tache.definition.type === 'szh');
      if (nomsSuivis.indexOf(tache.name) === -1 && !estNotre) { return; }
      const code = e.exitCode === undefined ? 0 : e.exitCode;
      relireJournal(fournisseur, code)
        // Seulement si la compilation a réussi : un PDF sorti d'une compilation en échec
        // n'est pas forcément celui qu'on croit — voir pipeline/Makefile, verifier-ua n'est
        // d'ailleurs jamais appelée par `all`.
        .then(() => { if (code === 0) { pdfuaHote.planifier(fournisseur.racine); } })
        .catch(() => { /* un avis raté ne casse pas la compilation */ });
    }),
    // Se déclenche pour toute fin de tâche, avec ou sans processus : c'est ici, et
    // seulement ici, que le compteur redescend, pour couvrir aussi la tâche interrompue
    // avant le spawn, que onDidEndTaskProcess ne voit jamais. Une tâche normale émet les
    // deux événements ; ne décrémenter que sur celui-ci évite de compter deux fois.
    vscode.tasks.onDidEndTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      const nomsSuivis = [NOM_TACHE_BUILD, NOM_TACHE_EXPORT, NOM_TACHE_IMPORT, NOM_TACHE_DOCX,
        NOM_TACHE_LIVRE_IMPRIMEUR, NOM_TACHE_LIVRE_COUVERTURE, NOM_TACHE_LIVRE_EPUB, NOM_TACHE_LIVRE_WEB];
      const estNotre = (tache.definition && tache.definition.type === 'szh');
      if (nomsSuivis.indexOf(tache.name) === -1 && !estNotre) { return; }
      session.poserTachesSuiviesEnVol(Math.max(0, session.tachesSuiviesEnVol() - 1));
      if (session.tachesSuiviesEnVol() === 0) { session.poserBuildEnCours(false); }
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
    refuser: () => { refuserSiVerrouille(); }
  });

  // Les trois panneaux de la barre ; celui d'export s'adapte à l'état du numéro.
  // Le profil est injecté avec l'état : les panneaux retirent d'eux-mêmes ce qu'un
  // livre n'a pas — OJS, suivi de traduction, cycle de vie d'un numéro.
  enregistrerPanneaux(context, {
    etat: etatCourant,
    profil: () => profilCourant().cle
  });

  // Réveil de la machine WSL puis chargement de l'arbre, derrière un indicateur de
  // progression pour ne pas laisser une fenêtre qui semble figée.
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
          await reveillerWsl();                    // démarrage à froid de la machine
          progress.report({ message: T('demarrage.revue') });
          majContexte();                           // racine, contexte, watchers, dormeur, arbre
          await ouvrirArticleActifAuDemarrage(fournisseur);
          await honorerIntention(fournisseur, rafraichirTout); // un lien szh:// reçu
        });
    } finally { barre.dispose(); }
    proposerTutoriel(context);
  };
  // La liste des auteur·e·s publiés (OAI-PMH public d'ojs.szh.ch) se rafraîchit en tâche
  // de fond, au plus une fois par semaine — sans bloquer l'activation, et sans un mot en
  // cas d'échec réseau : hors ligne est un état normal du poste.
  rafraichirAuteursPubliesEnFond();
  // Même politique de fond, cache distinct : voir rafraichirMotsClesConnusEnFond.
  rafraichirMotsClesConnusEnFond();
  // ---- Validation PDF/UA en arrière-plan -> lib/pdfua-hote.js ----------------------
  // Avant demarrageInitial() : ouvrirArticleActifAuDemarrage() y marque déjà un article
  // ouvert (majArticleOuvert), qui demande aussitôt le badge — ctx doit être prêt.
  pdfuaHote.configurer({
    listerArticles: () => fournisseur.listerArticles(),
    profilOuvrage: () => session.profilOuvrage(),
    racine: () => fournisseur.racine,
    surChangement: () => rafraichirPdfUa(fournisseur)
  });
  demarrageInitial();
}

// Une seule fois, et seulement sur un numéro ouvert : la page d'accueil de l'éditeur est
// désactivée par nos réglages, et la barre d'activités masquée — sans cette invitation,
// le tutoriel n'existerait que pour qui pense à le chercher.
async function proposerTutoriel(context) {
  try {
    if (context.globalState.get(CLE_TUTORIEL_VU)) { return; }
    await context.globalState.update(CLE_TUTORIEL_VU, true);
    const ouvrir = T('tuto.invite.bouton');
    const choix = await vscode.window.showInformationMessage(T('tuto.invite'), ouvrir);
    if (choix === ouvrir) { await vscode.commands.executeCommand('szh.tutoriel'); }
  } catch (e) { /* invitation ratée : la commande et l'icône restent */ }
}

function deactivate() { arreterDormeurWsl(); }

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
    ordonnerArticles, deplacerArticle, prefixeOrdre, libelleArticle, titreFiche,
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
    // Pas pures — elles lisent et écrivent le numéro — mais exposées pour le même
    // contrôle : le fichier dérivé des DOI doit pouvoir s'éprouver sans hôte complet.
    doisCalculesArticles, ecrireDoisCalcules, permuterStatutsTraduction,
    // La co-édition : le bail vit dans lib/coedition.js, mais c'est ici que se décide ce
    // qu'un formulaire a le droit d'écrire. Un « panneau » n'est pour elles qu'une clé,
    // n'importe quel objet fait l'affaire dans un test.
    mainCoedition, ecrireSousMain, refusCoedition, refusCoeditionNumero,
    noterLectureCoedition, rafraichirEmpreinteCoedition, libererCoedition,
    ecrireCartesArticles, messageCartes, moiCoedition,
    // Le focus de l'arbre sur une unité, et le chemin unique de compilation —
    // session.buildEnCours(), session.apercuCourantSlug() et session.panneauApercuHtml()
    // restent des variables de module, donc lus sur l'hôte réellement activé, pas
    // rejouables à froid.
    focaliserUnite, relancerCompilation, compilerPuisAfficher, relancerCompilationCartes,
    rejouerCompilationsDifferees,
    avertirCopiesConflit, oublierCopiesSignalees, ecrireClesAusgabe,
    // Le numéro de tête du Word migré vers ordre-articles/ordre-chapitres à l'import.
    // Pas pures (la dernière lit et écrit le numéro), exposées pour le même contrôle.
    numerosOrdreEnAttente, resoudreNumeroOrdre, ecrireOrdreNouveauxArticles,
    // La résolution d'une copie en conflit : le fournisseur de diff rapide qui la donne pour
    // « original », et les deux sens de résolution.
    SCHEME_CONFLIT, fournisseurDiffConflit, cheminDepuisUriConflit,
    resoudreBlocConflit, comparerConflit, supprimerCopieConflit, rafraichirConflitsScm,
    TEXTES_COCKPIT
  }
};
