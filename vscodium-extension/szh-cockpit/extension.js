// Extension « Pronto » : la barre latérale du cockpit dans l'Explorateur de VSCodium
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

// Les clés de contexte du profil — szh.estRevue, szh.estLivre — ne sont plus nommées
// ici : elles vivent dans la table de lib/profil.js, avec le reste de ce qui
// distingue un numéro d'un livre, et se posent toutes ensemble (voir majContexte).
// L'état du numéro en clés de contexte : c'est ce que lisent les `when` de package.json.
const CLE_VERROUILLEE = 'szh.verrouillee';
const CLE_ARCHIVEE = 'szh.archivee';
const ID_VUE = 'szhCockpitVue';
// À garder identiques aux labels de vscodium-user/tasks.json, qui les nomme.
const NOM_TACHE_IMPORT = 'Importer les articles Word';
const NOM_TACHE_BUILD = 'Aperçu / Export PDF';
const NOM_TACHE_EXPORT = 'Tout exporter';
const NOM_TACHE_DOCX = 'Galleys DOCX (OJS)';
// Les quatre sorties du livre (pipeline/profils/livre.mk), sans équivalent côté revue.
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
// Le réimport d'un article corrigé. Seul maillon que le cockpit appelle sans passer par
// une tâche : il rend une ligne JSON qu'il faut lire, et une tâche n'en rapporte rien.
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
  // versionsDivergent n'est plus appelée ici (voir lib/cycle-vie.js) mais reste exposée
  // par module.exports._pur, qui la veut en liaison de module — pas seulement ré-exportée.
  versionsDivergent,
  // ecrireModeDeveloppeur n'est pas appelée ici : l'écriture se fait depuis l'onglet
  // Paramètres de l'Accueil (lib/accueil-reglages-hote.js).
  lireModeDeveloppeur, lireConfigPoste, ecrireConfigPoste,
  configAvecLangue, CONFIG_POSTE,
  // Vérificateur de traduction : un réglage du poste et non de l'éditeur, pour que trois
  // panneaux le lisent et qu'il survive à la mise à jour du poste.
  lireVerifTraduction, ecrireVerifTraduction,
  // Mode « Trad » : jumeau du précédent pour les textes de l'outil, dans le même fichier et
  // pour la même raison — plusieurs panneaux le lisent, et il doit survivre à la mise à
  // jour du poste.
  lireModeTrad, ecrireModeTrad
} = require('./lib/archivage');
// ---- Suggestions de traduction -> lib/suggestion-traduction.js -------------------
// Le dossier traduction/ d'un numéro : une proposition par fichier, et rien de publié.
const suggestionTraduction = require('./lib/suggestion-traduction');
// ---- Index des libellés de l'interface -> lib/index-textes.js --------------------
// Retrouver la clé i18n d'un texte lu à l'écran. C'est ce que le mode « Trad » envoie aux
// panneaux, et seulement quand il est allumé.
const indexTextes = require('./lib/index-textes');
// ---- Rapports d'erreur automatiques -> lib/rapport-erreur.js ---------------------
// Toute la logique (résolution passive de l'ancrage, masquage, anti-inondation, file
// d'attente, écriture) vit dans ce module, testable hors éditeur ; ici, seulement deux
// accroches (COMPIL-ECHEC dans relireJournal(), COCKPIT-EXCEPTION ci-dessous) et le
// vidage de la file au démarrage — voir docs/RAPPORTS-ERREUR.md.
const rapportErreur = require('./lib/rapport-erreur');
// ---- Compteurs d'usage de l'import -> lib/compteurs.js ----------------------------
// Des entiers et des noms de mesures, jamais un mot du manuscrit (docs/RAPPORTS-ERREUR.md,
// « Les compteurs ne sont pas des rapports »). Trois accroches : la fin d'une tâche
// (relireJournal), la fin d'un réimport réussi, et le vidage de la file au démarrage.
const compteurs = require('./lib/compteurs');
// ---- Réglages protégés de la chaîne -> lib/reglages-proteges.js -------------------
const proteges = require('./lib/reglages-proteges');
// ---- Fichier de langue de l'interface -> lib/export-langue.js ---------------------
const exportLangue = require('./lib/export-langue');
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
  fragmentCfHtml, nettoyerHtmlBureautique, nettoyerContenuCellule, tableauDepuisHtmlBureautique
} = require('./lib/table-model');
// Recompilation après un enregistrement fait hors de l'éditeur de texte (médias, tableaux)
// -> lib/relance-compilation.js
const relanceCompilation = require('./lib/relance-compilation');
// ---- « Quoi de neuf » -> lib/nouveautes.js ---------------------------------------
// Les notes livrées avec le toolkit, et la décision de ce qu'il y a à montrer.
const nouveautes = require('./lib/nouveautes');
// ---- Ce qu'est le dossier ouvert -> lib/profil.js --------------------------------
// Numéro de revue ou livre : la table qui le dit, et les chemins qui en découlent.
const profils = require('./lib/profil');
// ---- Modules impératifs -> lib/{slug,formatting}.js ------------------------------
const { slugifier, slugifierArticle } = require('./lib/slug');
// tige() ignore le préfixe « NN- » d'un dossier : depuis que l'import en pose un
// (lib/import-hote.js), le slug qu'un Word laisse deviner (slugifierArticle) et le nom
// du dossier qui le porte (« 00-inclusion ») ne sont plus la même chaîne. Comparer sans
// cette fonction referait le doublon que « déjà converti » existe pour éviter.
const { tige } = require('./lib/renumerotation');
const {
  basculerEnrobage, basculerSouligne, basculerTitre, basculerCitation,
  enroberBloc, squeletteTableau, tableauVierge, blocReferenceTable, nomTableLibre,
  enregistrerCommandesMiseEnForme
} = require('./lib/formatting');
// ---- Liens profonds « szh:// » -> lib/liens.js (le verrou lui-même est dans -------
// lib/cycle-vie.js, qui require lib/verrou.js directement) ------------------------
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
  rafraichirConflitsScm
} = cycleVie;
// Les rappels vers l'hôte que lib/cycle-vie.js ne peut pas connaître par require (voir son
// en-tête) : posés une seule fois, ici. Toutes les fonctions visées sont des déclarations de
// fonction — hoisted — même celles définies plus bas dans ce fichier.
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
  // « Markdown » : le texte de l'article à droite de sa fiche. Les onglets se lisent et se
  // ferment ici, comme pour l'aperçu — aucun module de lib/ ne touche à tabGroups.
  ongletOuvert: (predicat) => ongletOuvert(predicat),
  fermerOnglets: (predicat) => fermerOnglets(predicat),
  slugDepuisChemin: (racine, chemin) => slugDepuisChemin(racine, chemin),
  articlesSansDoi: (racine, slugs) => articlesSansDoi(racine, slugs),
  // Le vérificateur de traduction : le réglage se lit ici, et la pastille du formulaire des
  // fiches ouvre le panneau de suggestion, qui vit ici aussi.
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
  // Le jeton de revue du numéro ouvert, et son nom affiché — pour les libellés du
  // réservoir (« numéro de l'autre revue »).
  revueCourante: (racine) => revueCourante(racine),
  nomRevueAffiche: (revue) => nomRevueAffiche(revue),
  convertirCmykSiBesoin: (chemins) => convertirCmykSiBesoin(chemins),
  // Le bouton « Aperçu du PDF » de son formulaire (23.09.2026) : bascule, état, et
  // rafraîchissement après « Enregistrer » — voir apercuOuvertPourSlug/
  // basculerApercuDocumentation/rafraichirApercuDocumentationSiOuvert plus bas.
  apercuOuvert: (racine, slug) => apercuOuvertPourSlug(racine, slug),
  basculerApercu: (fournisseur, slug) => basculerApercuDocumentation(fournisseur, slug),
  rafraichirApercuSiOuvert: (fournisseur, slug) => rafraichirApercuDocumentationSiOuvert(fournisseur, slug)
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
// ---- Arborescence Kirby de la Documentation (fiches et rubriques) -> lib/kirby-contenu.js
// Un seul module pour les deux familles de blocs — une fiche à champs (livre, film,
// intervention…) et une rubrique de prose (références du dossier, tour d'horizon…) — qui
// vivent toutes deux dans documentation.<lang>.txt et les dossiers de fiches. Remplace
// lib/ressources.js et lib/rubriques.js.
const kirbyLib = require('./lib/kirby-contenu');
const propositionsLib = require('./lib/propositions');
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

// Le profil du dossier ouvert, revue par défaut (lib/profil.js#courant).
function profilCourant() { return profils.courant(); }

// Le dossier des unités de texte du profil actif : « articles » pour un numéro,
// « chapitres » pour un livre. Les chemins d'une unité passent par profils.chemins().
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
// répercutée dans config.json (voir la branche « liensReferences » de traiterMessage, lib/reglages-hote.js), seul
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
// clic sur son en-tête ne fait donc que jouer l'accordéon. La vue de la section des unités
// vient de la table de profil (lib/profil.js) : « articles » pour un numéro, « chapitres »
// pour un livre.
function vueDeSection(categorie) { return profils.vueDeSection(profilCourant(), categorie); }

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

// ---- Co-édition : deux postes sur le même numéro -> lib/coedition-hote.js ----------
const coeditionHote = require('./lib/coedition-hote');
const {
  moiCoedition, oublierIdentiteCoedition, mainCoedition, ecrireSousMain, annoncerMain,
  noterLectureCoedition, rafraichirEmpreinteCoedition, refusCoedition, refusCoeditionNumero,
  libererCoedition
} = coeditionHote;

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
      analyserAusgabe(fs.readFileSync(cheminConfig(racine), 'utf8'))[CLE_SANS_DOI] || '');
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

// Le nom d'un article dans l'interface : « 03 · Titre », le titre venant de sa fiche. Sans
// fiche ou sans titre, le slug reprend sa place : l'article doit rester visible et
// repérable, jamais disparaître. Le numéro vient du dossier — c'est l'état du disque que
// l'arbre montre, jamais un rang qui n'existe pas dessus.
function nomArticle(racine, slug, langue) {
  return libelleArticle(prefixeDossier(slug), slug, titreFiche(lireMetaArticle(racine, slug), langue));
}

// ---- Tâches d'un article : le sidecar <slug>.taches.yaml ------------------------
// Même partage que le suivi de traduction juste à côté : les intitulés sont un réglage de
// revue (config.json), l'état coché part avec l'article et n'est ni publié ni exporté.
function cheminTaches(racine, slug) {
  return profils.chemins(profilCourant(), racine, slug).taches;
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
      // Un livre ouvre son formulaire (titre, responsables, maquette, impression) depuis
      // l'arbre, en tête : sans cette entrée il fallait la palette. Une revue n'a pas
      // d'équivalent, ses métadonnées de numéro vivent dans la vue ARTICLES.
      const sections = profilCourant().cle === 'livre' ? [this._itemMetaLivre()] : [];
      sections.push(this._section(categorieUnites(), T(cleArbreUnites()), 'book', undefined));
      // ⚠ Pas de section « Actualité » pour un livre, pour la même raison que les
      //   traductions : la Documentation est une rubrique de revue (« Actualité et
      //   ressources » / « News & Ressourcen »), elle n'a pas d'équivalent dans un ouvrage.
      const cap = profilCourant().capacites;
      if (cap.documentation) {
        // Le badge compte les blocs de la page de Documentation — ses fiches et ses
        // rubriques réunies — et non les articles : il n'y en a qu'un, et il ne se liste
        // plus dans l'arbre.
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
    if (profilCourant().capacites.documentation && this.estActualite(slug)) {
      return this._section('actualite', T('arbre.actualite'), 'megaphone', undefined);
    }
    return this._section(categorieUnites(), T(cleArbreUnites()), 'book', undefined);
  }

  // La catégorie d'accordéon à déplier pour ce slug — pendant de sectionDeSlug(), pour les
  // appelants qui n'ont besoin que du nom (focaliserUnite).
  categorieDeSlug(slug) {
    return (profilCourant().capacites.documentation && this.estActualite(slug))
      ? 'actualite' : categorieUnites();
  }

  estActualite(slug) {
    if (!this.racine || !slug) { return false; }
    return lireMetaArticle(this.racine, slug).type === TYPE_ACTUALITE;
  }

  // Les unités du numéro réparties entre les deux sections (Documentation dans
  // « Actualité », le reste dans « Articles »), sans toucher à leur ordre relatif — c'est
  // déjà celui du numéro. Ne portait autrefois qu'un rang global, pour que le numéro
  // affiché ne se remette pas à 01 dans chaque section ; ce rang a quitté l'affichage
  // (nomArticle() lit désormais le dossier, pas ce rang), et `entree` ne porte donc plus
  // que le slug.
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
  // L'ordre de l'arbre est celui du numéro (ausgabe.yaml) ; le numéro AFFICHÉ devant le
  // titre, lui, vient du nom du dossier (prefixeDossier(), lib/articles.js) et non plus de
  // ce rang — les deux divergent depuis que seuls les dossiers importés ou réalignés par
  // « Changer l'ordre » en portent un. Le slug passe en description — c'est le nom du
  // dossier, ce n'est pas le nom de l'article.
  _itemsArticles() {
    return this._itemsUnites(this._repartirUnites().unites,
      'arbre.vide.' + profilCourant().unites.dossier);
  }

  // La section « Actualité » ne liste plus la page de Documentation elle-même — les fiches
  // vivent toutes dans la bibliothèque partagée (_NewsUndActu\Fiches\), plus dans une réserve
  // accrochée à l'arbre du numéro — mais des raccourcis vers ses vues (Robin, 23.09.2026,
  // révisé le même jour : toute la navigation passe désormais par l'arbre, la page n'a plus
  // de barre d'onglets de vues ; les catégories de la Documentation du numéro sont une barre
  // du formulaire, 24.09.2026). Ordre : « Documentation du numéro », « Traductions à faire », « Réservoir », « Archive », puis
  // « Publier sur le site web » grisée (pas encore livré — sans commande, donc jamais
  // cliquable). Cliquer une entrée ouvre le formulaire DIRECTEMENT sur cette vue
  // (ouvrirPageDocumentation, qui crée la page au besoin) ; si le panneau est déjà ouvert, il
  // se met au premier plan et bascule dessus — voir documentation-hote.js#ouvrirDocumentation.
  //
  // Les compteurs reprennent EXACTEMENT les fonctions des badges d'onglet du formulaire
  // (kirby-contenu.js : listerTraductionsATraire, listerReservoir + listerOrphelines) —
  // calcul léger, sur l'arbre local. L'Archive n'a PAS de compteur tant qu'aucun panneau n'a
  // encore lu la bibliothèque de PRODUCTION (documentation-hote.js#compteArchiveConnu) :
  // l'arbre ne doit jamais payer cet aller-retour OneDrive lui-même, seulement reprendre le
  // dernier chiffre connu.
  _itemsActualite() {
    if (!this.racine) { return []; }
    const racineArbreVal = kirbyLib.racineArbre(this.racine);
    const langue = langueRevue(this.racine);
    const nTraductions = kirbyLib.listerTraductionsATraire(racineArbreVal, langue).length;
    const nReservoir = kirbyLib.listerReservoir(racineArbreVal, langue, { avecIgnorees: false }).length
      + kirbyLib.listerOrphelines(racineArbreVal, langue).length;
    const nBlocs = compterBlocsDocumentation(this.racine, this.slugDocumentation());
    const nArchive = documentationHote.compteArchiveConnu();
    // Les propositions des moissonneurs : un compte en cache (lib/propositions.js), relu
    // seulement quand un lot ou une décision change.
    let prop = { total: 0, aVerifier: 0 };
    try { prop = propositionsLib.compterPropositions(racineArbreVal, langue); }
    catch (e) { console.warn('propositions : compte impossible — ' + ((e && e.message) || e)); }
    const nProp = prop.total === 1 ? '.un' : '.plus';
    const tipProp = prop.total === 0 ? T('arbre.actualite.propositions.tipVide')
      : prop.aVerifier ? T('arbre.actualite.propositions.tip' + nProp, [prop.total, prop.aVerifier])
        : T('arbre.actualite.propositions.tipA' + nProp, [prop.total]);
    const entrees = [
      { cle: 'numero', libelle: T('doc.onglet.numero'), icone: 'book', compte: nBlocs,
        tip: T('arbre.actualite.numero.tip') },
      // Juste après le numéro : c'est là qu'arrive le neuf. L'icône d'avertissement dit
      // qu'il y a des cas à vérifier, l'infobulle combien.
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
    // « Publier sur le site web » : pas encore livré, elle ouvre la vue « web » de la
    // Documentation, qui le dit.
    const publier = new vscode.TreeItem(T('arbre.actualite.publier'), vscode.TreeItemCollapsibleState.None);
    publier.id = 'actualite:publier';
    publier.contextValue = 'actualite-entree';
    publier.iconPath = new vscode.ThemeIcon('cloud-upload');
    publier.tooltip = T('arbre.actualite.publier.tip');
    publier.command = { command: 'szh.ouvrirActualite', title: T('arbre.actualite.publier'), arguments: ['web'] };
    items.push(publier);
    return items;
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

  // L'entrée « Métadonnées du livre » : une feuille, ni section ni unité (pas de `categorie`,
  // l'accordéon l'ignore), qui ouvre le formulaire de buch.yaml.
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
      // Seuls les tableaux se déplient sous l'article : les images se gèrent dans le
      // formulaire « Médias de cet article », qui les montre avec leurs légendes, leurs
      // crédits et leur verdict de qualité.
      // Ce qui rend un article dépliable : ses tableaux, ou sa bibliographie. Compter les
      // seuls tableaux laissait l'entrée de bibliographie inatteignable sur un article qui
      // n'a pas de tableau — c'est-à-dire sur la plupart.
      const aDesAssets = this._tablesArticle(slug).length > 0
        || fs.existsSync(cheminBiblio(this.racine, slug, dossierUnites()));
      const deploye = auto && aDesAssets && slug === this.slugDeploye;
      const nom = nomArticle(this.racine, slug, langue);
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

  // Ce que l'article porte à part de son texte : ses tableaux, et sa bibliographie. Aucune
  // description sur ces entrées — ni poids, ni compteur : la colonne reste vide, et ce qui
  // s'y affichera un jour aura donc du sens.
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

  // La bibliographie, éditable comme un tableau — mais en texte : c'est de la prose, une
  // référence par paragraphe, que le rédacteur colle depuis Zotero ou depuis un autre
  // article. Un éditeur structuré se battrait contre ce geste-là ; le texte est la bonne
  // surface, et c'est déjà celle de l'article.
  //
  // Colonne 1, comme le .md, et son RENDU en colonne 2 : une référence se relit mise en
  // forme, et rien d'autre ne la montre — la compilation du numéro entier pour vérifier une
  // italique serait hors de proportion. L'aperçu de l'article libère donc la colonne 2 le
  // temps qu'on est dans la bibliographie, et Ctrl+Alt+P bascule ce rendu-là
  // (basculerApercu, lib/apercu.js).
  //
  // Pas de fichier : pas d'entrée. Depuis que l'import crée toujours <slug>.biblio.md —
  // vide s'il le faut, voir szh-biblio-detacher.lua — un article importé désormais montre
  // toujours cette entrée, prête à recevoir une bibliographie écrite après coup ; seul un
  // article importé AVANT ce correctif, jamais rétroactivement complété, en reste privé.
  // Le test reste sur l'existence, jamais sur le contenu : une entrée morte pour un
  // fichier absent ferait croire à une liste vide, ce qui n'est pas la même chose — et un
  // fichier vide n'a besoin d'aucun geste à part pour apparaître ici.
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
    const slugs = this.slugsTraduisibles();
    if (slugs.length === 0) { return [this._vide(T('arbre.vide.traductions'))]; }
    const source = langueRevue(this.racine);
    return slugs.map((slug) => {
      const etat = etatTraduction(this.racine, slug, source);
      const rien = etat.lignes.length === 0;
      // Le même nom que dans la section « Articles » : un article se reconnaît partout à
      // son titre et à son numéro de dossier, jamais à son slug tronqué. La fiche vient
      // d'etatTraduction, qui l'a déjà lue.
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

  // Les articles bilingues suivis champ par champ dans « Traductions » — jamais la page de
  // Documentation, qui n'en fait pas partie : chaque revue l'écrit dans sa propre langue
  // par sa propre arborescence Kirby (Pronto), il n'y a pas de champ à synchroniser entre
  // deux `lang:`. `listerArticles()` la compte pourtant comme une unité du numéro depuis
  // qu'elle n'a plus de <slug>.md (_estUniteValide) : il faut donc l'exclure ici à part.
  slugsTraduisibles() {
    return this.listerArticles().filter((slug) => !this.estActualite(slug));
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
    const slugs = this._sousDossiersAvecMd(profils.chemins(profilCourant(), this.racine).unites);
    return ordonnerArticles(valeurOrdreArticles(this.racine), slugs,
      articlesSansDoi(this.racine, slugs)).slugs;
  }

  // Le slug donné vient d'un nom de fichier Word (slugifierArticle) : il n'a jamais de
  // préfixe « NN- », qu'il vienne d'un article ancien ou d'un import récent (voir
  // lib/import-hote.js, qui pose ce préfixe sur les dossiers qu'il crée). Se contenter du
  // nom exact laisserait donc « déjà converti » aveugle dès qu'un article vit sous
  // « 00-inclusion » — d'où la comparaison par tige(), qui ignore ce préfixe des deux côtés.
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

  // Une unité du numéro : un article ordinaire, dont le .md existe — ou la page de
  // Documentation, qui n'en a plus (arborescence Kirby, lib/kirby-contenu.js) et se
  // reconnaît à sa fiche de métadonnées (type: documentation). Sans ce second cas, la page
  // disparaîtrait de listerArticles() dès sa création, et avec elle tout ce qui en dépend :
  // le badge, slugDocumentation(), l'export, le secrétariat…
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
    if (choix === compiler) { await lancerBuild(racine); }
    return;
  }
  await ouvrirApercuPdf(vscode.Uri.file(pdf));
}

// Un onglet dont l'entrée satisfait le prédicat est-il ouvert ? Même parcours et même
// typage canard que fermerOnglets juste en dessous. Sert aux interrupteurs qui commandent
// un ONGLET et non une webview : leur état ne peut pas se tenir en mémoire, puisqu'un
// onglet se ferme aussi à la croix, sans que rien ne nous le dise.
function ongletOuvert(predicat) {
  for (const groupe of vscode.window.tabGroups.all) {
    for (const onglet of groupe.tabs) {
      if (predicat(onglet.input)) { return true; }
    }
  }
  return false;
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
// La patience et le retrait de l'attribut « lecture seule » vivent dans lib/supprimer.js,
// qui explique le pourquoi de chacun ; il n'y a ici que le mot dit au rédacteur pendant
// qu'on insiste.
const { supprimerArbre } = require('./lib/supprimer');

function attendre(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// -> null quand le chemin est parti (ou n'existait déjà plus), sinon le message du
// dernier échec, prêt à être montré.
function supprimerAvecReprises(chemin) {
  return supprimerArbre(chemin, {
    // Dix secondes d'attente muette passeraient pour un blocage.
    surReprise: (nom) => vscode.window.setStatusBarMessage(
      T('statut.suppression.reprise', [nom]), 3000)
  });
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
    // Un garde-fou ne doit jamais retenir le processus : une tâche que personne ne termine
    // (l'hôte factice des tests, un wsl.exe absent) garderait sinon l'hôte en vie 30 minutes.
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

// Guérit un marqueur .szh-biblio périmé avant de compiler (lib/renumerotation-fs.js,
// reparerMarqueursOrphelins) — ici, et dans toutExporter()/exporterXml() plus bas, parce
// que ce sont les trois chemins par lesquels le cockpit déclenche une vraie compilation,
// comme reimporter.py --reprise l'est côté pipeline (appelé à chaque `make all`, dans la
// cible `import`, avant que szh-citations.lua ne lise le marqueur). Jamais bloquant : une
// exception ici ne doit pas empêcher de compiler ce qui compilait déjà, et un article que
// la fonction ne peut pas trancher (zéro ou plusieurs *.biblio.md) reste tel quel — la
// compilation le dira, comme avant ce correctif.
function reparerBibliosAvantCompilation(racine) {
  if (!racine) { return; }
  try { renumerotation.reparerMarqueursOrphelins(racine, { dossier: dossierUnites() }); }
  catch (e) { /* non bloquant, voir ci-dessus */ }
}

function lancerBuild(racine) {
  reparerBibliosAvantCompilation(racine);
  return lancerTache(NOM_TACHE_BUILD);
}

// La compilation que le clic (ou l'enregistrement) d'UNE unité déclenche. Une revue
// recompile son numéro (make all), comme avant. Un livre ne compile que le chapitre
// (livre-chapitre-pdf CHAPITRE=<slug>, out/chapitres/<slug>.pdf) : le volume entier ne se
// recompile que depuis la vue CHAPITRES ou l'aperçu du livre.
function lancerBuildUnite(racine, slug) {
  if (profilCourant().cle !== 'livre' || !slug) { return lancerBuild(racine); }
  reparerBibliosAvantCompilation(racine);
  return lancerTacheObjet(tacheChapitrePdf(racine, slug));
}

// Même mécanisme que les tâches de vscodium-user/tasks.json : bash -c, `set -o pipefail` et
// `tee .szh-journal.log` pour que le cockpit relise le journal à la fin (relireJournal), `-j2
// -O` comme elles. Construite ici et non déclarée dans tasks.json, comme tacheMakeArticle :
// une tâche utilisateur ne reçoit pas de paramètre, et la cible a besoin du slug. Le type
// `szh` la fait suivre par les mêmes gardes que les autres (verrou de compilation, voile).
// Le slug est contrôlé par profils.apercuUnite : il finit dans une ligne bash.
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

// Le mode d'aperçu d'une unité. Un chapitre s'aperçoit toujours en PDF, le sien : son
// aperçu HTML n'existe qu'après une compilation du livre entier, ce que le clic ne fait plus.
function modeApercuUnite() { return profilCourant().cle === 'livre' ? 'pdf' : modeApercu(); }

// Le PDF qu'ouvre le clic sur une unité : out/<slug>/<slug>.pdf pour un article,
// out/chapitres/<slug>.pdf pour un chapitre (lib/profil.js).
function pdfApercuUnite(racine, slug) {
  return profils.apercuUnite(profilCourant(), racine, slug).pdf;
}

// Une tâche s'est terminée en échec. Si le journal porte un point bloquant, la vue des
// contrôles vient de le nommer et de dire quoi faire : ce message-ci n'ajouterait rien et
// masquerait le précis par le vague. Il ne sort donc que sur un échec muet.
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
    // La maquette lit dois-calcules.yaml pendant la compilation, et il n'est plus réécrit à
    // chaque rafraîchissement : recompiler tout est le bon moment pour s'assurer qu'il est
    // là et à jour. L'écriture ne se fait qu'au changement.
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
    // Pagination continue : si le numéro a déjà été paginé, on relit l'état avant
    // d'exporter — jamais l'ancien, potentiellement dépassé par la compilation qui vient
    // de tourner. Un numéro jamais paginé exporte comme avant, sans option. Si l'état ne
    // peut pas être vérifié (distro endormie, make en échec), on n'exporte PAS : on
    // n'envoie jamais à OJS une pagination qu'on n'a pas pu vérifier — le refus pour
    // pagination PÉRIMÉE, lui, arrive tout seul plus bas par le `catch` existant
    // (e.szhBloquants -> poserConstatsExport), lib/export-ojs.js portant déjà cette porte.
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
    // Les points bloquants deviennent des cartes dans « À corriger » : la notification
    // n'a plus à les porter tous, elle dit combien et où les lire. Ce qui ne vient pas de
    // la collecte (une panne, un disque) garde son message en clair, faute de liste.
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
// On ne pagine QU'AU BOUCLAGE, par ce bouton manuel : jamais automatiquement. L'ordre
// passé à la chaîne est TOUJOURS fournisseur.listerArticles() — voir l'en-tête de
// pipeline/Makefile sur ORDRE, et pourquoi la chaîne ne peut pas le reconstituer seule.
async function rafraichirPagination(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Un numéro gelé garde les folios déjà publiés : son sommaire est clos, rien à recalculer.
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
  // Modale : l'action recompile des PDF, une notification dans un coin se manque.
  const choix = await vscode.window.showWarningMessage(
    T('pagination.confirmer', [etat.articles.length, etat.total, nARecompiler]),
    { modal: true }, bouton);
  if (choix !== bouton) { return; }

  session.poserBuildEnCours(true);
  try {
    const resultat = await paginationHote.rafraichir(racine, ordre);
    // Relecture exactement comme la fin d'une compilation ordinaire : rafraichir-pagination
    // en est une vraie, journalisée dans .szh-journal.log comme tasks.json.
    await controlesHote.relireJournal(fournisseur, resultat.code === null ? 1 : resultat.code);
    rafraichirTout();
    // Les constats de pagination retrouvés ici remplacent ceux que relireJournal() vient de
    // relire en arrière-plan : normalement vides, puisqu'on sort d'un rafraîchissement.
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

// « Compiler le livre » (vue CHAPITRES) : la tâche par défaut, make all, qui recompose le volume.
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
// Sur un numéro gelé, seul ce geste régénère un document. Sur un numéro vivant, il refait
// un article à la demande sans attendre un enregistrement ni lancer le numéro entier — le
// panneau Export l'offre dans les deux cas (lib/panneaux.js). La tâche vise le PDF et
// l'aperçu HTML, sans clean ni import, qui supprimerait le Word source (.docx ou .odt).
// `-j2 -O` comme les tâches de vscodium-user/tasks.json, et ici même sur un seul article :
// les deux cibles ne dépendent pas l'une de l'autre — le .pdf descend du .html, l'aperçu est
// une passe pandoc séparée. Sans `-j`, la seconde attendait la fin de la première alors que
// le poste a deux cœurs à donner (%UserProfile%\.wslconfig, `processors=2`).
// `-O` va avec `-j` : voir tasks.json pour ce qu'un journal entrelacé coûterait à lib/journal.js.
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

  // Puis le dossier de sortie, PDF sélectionné. On vient de demander un document : le
  // geste n'est fini que quand on l'a sous la main — pour le joindre à un courriel, le
  // déposer sur OJS, l'envoyer à l'imprimeur. Le retrouver à la main dans out/<slug>/
  // était le seul bout du chemin qui restait à la charge du rédacteur.
  // En dernier, et à dessein : revelerDansExplorateur() donne le focus à l'Explorateur,
  // ce qui recouvrirait l'éditeur qu'ouvrirArticle vient de mettre en place.
  // Seulement après une compilation réussie : le `return` du code non nul plus haut sort
  // de la fonction, un export en échec n'ouvre donc aucune fenêtre — ouvrir un dossier
  // vide, ou pire un PDF de la veille, ferait croire que ça a marché.
  await revelerDansExplorateur(vscode.Uri.file(path.join(racine, 'out', slug, slug + '.pdf')));
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
//
// Focaliser, c'est aussi DÉSIGNER l'article : le cockpit n'a qu'une notion d'« article
// courant », et elle vivait jusqu'ici dans le seul .md ouvert. Un formulaire pleine page
// n'en ouvre aucun — Ctrl+Alt+P, la barre d'état et la compilation ne savaient donc plus
// de quel article on parle, ou pire, parlaient encore du précédent. Les deux marqueurs
// suivent donc le clic : le point de l'article ouvert (majArticleOuvert, qui tient aussi
// le badge PDF/UA) et l'article visé en colonne 2 (apercuCourantSlug). Rien ne s'affiche
// pour autant : ouvrirApercuHtml et ouvrirApercuPdf ne sont pas appelés, et
// rechargerApercuHtmlSiChange s'abstient tant qu'aucun panneau d'aperçu n'existe.
function focaliserUnite(fournisseur, slug) {
  let arbreChange = fournisseur.definirDeploye(slug);
  // La section à déplier est celle où l'article vit : ACTUALITÉ pour une page de
  // Documentation, la section des unités sinon. Déplier ARTICLES aurait refermé ACTUALITÉ
  // (l'accordéon n'ouvre qu'une section) juste après un clic dedans.
  arbreChange = fournisseur.definirSectionDeployee(fournisseur.categorieDeSlug(slug)) || arbreChange;
  if (arbreChange) { fournisseur.rafraichir(); }
  reselectionnerArticle(fournisseur, slug);
  designerUniteCourante(fournisseur, slug);
}

// La bibliographie d'un article : son texte en colonne 1, son rendu en colonne 2. Appelée
// par l'entrée de l'arbre, et par la palette — sans item, c'est celle de l'article courant.
//
// L'article est désigné au passage : on travaille sur lui, même si son texte n'est pas à
// l'écran. Sans ça, la compilation et la barre d'état parleraient encore du précédent.
async function ouvrirBibliographie(fournisseur, item) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Même cascade que les deux formulaires : l'item de l'arbre, le .md actif, puis l'article
  // en aperçu. Sans item, c'est la palette qui appelle, et il faut bien viser quelque chose.
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

// L'unité dont parlent l'aperçu, la barre d'état et le badge PDF/UA — sans rien ouvrir.
// Séparée de focaliserUnite() parce qu'elle vaut pour tout geste qui vise un article sans
// afficher son texte : les deux formulaires, et l'aperçu de sa bibliographie.
function designerUniteCourante(fournisseur, slug) {
  if (!fournisseur.racine || !slug) { return; }
  const md = profils.chemins(profilCourant(), fournisseur.racine, slug).md;
  // Rien à désigner sans texte : la Documentation appelle focaliserUnite() avec des pages
  // qui n'ont pas toutes de .md, et l'aperçu se mettrait alors à viser un article qui
  // n'existe pas — sans que rien ne s'affiche pour le dire.
  try { if (!fs.statSync(md).isFile()) { return; } } catch (e) { return; }
  majArticleOuvert(fournisseur, md);
  session.poserApercuCourantSlug(slug);
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

// Combien de temps le surlignage reste visible avant de s'effacer de lui-même.
const DUREE_SURLIGNAGE_FOCUS = 3000;

// Deux chemins pour le même fichier : la casse de la lettre de lecteur et des dossiers
// varie selon qui a construit le chemin (Uri.fsPath la baisse, path.join la garde).
function memeFichier(a, b) {
  return path.normalize(String(a || '')).toLowerCase() === path.normalize(String(b || '')).toLowerCase();
}

// L'éditeur de `chemin`, ouvert et au premier plan en colonne 1. showTextDocument, et non
// visibleTextEditors : c'est la seule API qui RENDE l'éditeur. `vscode.open` rend la main
// avant que l'hôte d'extension ait appris l'existence du nouvel éditeur — visibleTextEditors
// et activeTextEditor décrivaient encore l'écran d'avant (la vue « À corriger » au premier
// plan, sans aucun éditeur de texte), surlignerFocus ne trouvait rien et se taisait : c'est
// pourquoi la flèche ouvrait l'article sans jamais rien sélectionner. Le .md déjà ouvert
// dans un AUTRE groupe tombait dans le même trou : la sélection partait sur l'éditeur de la
// colonne 2, celui qu'on ne regardait pas.
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

// Retrouve le passage désigné par `focus` dans le .md qu'on vient d'ouvrir, le SÉLECTIONNE,
// l'amène à l'écran et le surligne quelques secondes. La recherche (lib/reperage-focus.js)
// absorbe la normalisation que le filtre Lua a fait subir au texte du constat, l'emphase
// Markdown qu'il a aplatie et l'ellipse d'une troncature. Pas trouvé dans le texte, on
// cherche dans la bibliographie détachée (<slug>.biblio.md, voisine du .md) : une
// « référence jamais citée » n'est plus dans le texte depuis que l'import la met à part.
// Pas trouvé du tout, rien ne se passe : jamais de faux surlignage, jamais de message
// d'erreur pour si peu. -> true quand un passage a été sélectionné.
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
    // Couleurs du thème, jamais en dur : une teinte fixe serait illisible dans l'autre thème.
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

// .md en colonne 1 ; compilation incrémentale si l'aperçu du mode courant est absent ou
// plus vieux que ses sources ; aperçu en colonne 2, à la place du précédent. Une
// compilation en échec ne montre pas d'aperçu périmé, `opts.sansTexte` laisse la
// colonne 1 au panneau qui l'occupe, et `opts.sansApercu` s'arrête au .md : ni aperçu,
// ni compilation (vue d'ensemble Articles — voir le commentaire plus bas).
async function ouvrirArticle(fournisseur, slug, opts) {
  const racine = fournisseur.racine;
  if (!racine || typeof slug !== 'string' || slug === '') { return; }
  const md = profils.chemins(profilCourant(), racine, slug).md;
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
  // Un chapitre a son PDF à lui, composé seul (lib/profil.js, apercuUnite) ; le volume
  // entier s'ouvre par szh.apercuLivre.
  const pdf = vscode.Uri.file(pdfApercuUnite(racine, slug));
  const modeCourant = modeApercuUnite();
  // Un PDF à jour ne dit rien du HTML d'aperçu : on juge celui du mode courant.
  const apercuAttendu = modeCourant === 'html' ? cheminApercuHtml(racine, slug) : pdf.fsPath;

  if (!(opts && opts.sansTexte)) {
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(md), { viewColumn: vscode.ViewColumn.One });
    // Le bouton « Vers l'article » d'un constat vise un passage précis (lib/constats.js,
    // focusChamp) : le retrouver et le montrer, sinon le rédacteur ouvre le bon fichier sans
    // savoir où regarder. Attendu : l'aperçu qui s'ouvre ensuite en colonne 2 ne doit pas
    // passer devant l'éditeur avant que la sélection soit posée.
    if (opts && opts.focus) { await surlignerFocus(md, opts.focus); }
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
    // La bibliographie d'un chapitre entre dans son PDF : un chapitre se compile seul, rien
    // d'autre ne la relève. Une revue garde son graphe d'avant.
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
// `opts.sansAffichage` : la compilation part, mais son résultat ne rouvre aucun aperçu —
// pour l'enregistrement des métadonnées, qui doit recompiler en tâche de fond sans jamais
// rouvrir ce que focaliserUnite vient de fermer (aperçu HTML ou PDF).
function relancerCompilation(fournisseur, slug, opts) {
  compilerPuisAfficher(fournisseur, slug, opts).catch(() => { /* signalé côté build */ });
}

// Les démarrages de la tâche qui recompile l'article (build, ou export complet), comptés
// dans onDidStartTask — Ctrl+S et triggerTaskOnSave compris, puisqu'ils ne passent par
// aucune fonction du cockpit. La relance différée ci-dessous s'en sert pour savoir si une
// compilation partie depuis un enregistrement l'a déjà couvert (lib/relance-compilation.js).
let demarragesBuild = 0;

// Les enregistrements du formulaire « Médias de l'article » (lib/medias-hote.js) et de
// l'éditeur de tableaux (ouvrirEditeurTable) : ils écrivent hors de l'éditeur de texte, et
// relancent donc eux-mêmes la compilation de l'article — même chemin, même garde et même
// discrétion (sansAffichage) que l'enregistrement des métadonnées, mais après un anti-rebond
// de 2,5 s : l'éditeur de tableaux enregistre à chaque modification. Numéro verrouillé ou
// archivé : rien (compilationAutoCoupee). Un livre suit le même chemin que ses métadonnées :
// le slug est celui du chapitre, lancerBuild compile le volume.
const relanceDifferee = relanceCompilation.creerRelanceDifferee({
  relancer: (fournisseur, slug) => relancerCompilation(fournisseur, slug, { sansAffichage: true }),
  coupee: () => compilationAutoCoupee(),
  occupe: () => session.buildEnCours(),
  demarrages: () => demarragesBuild
});

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
  // L'article compilé, pour que le voile de « À corriger » ne couvre que sa carte : c'est
  // le démarrage de la tâche (onDidStartTask) qui le pose. Retiré dans tous les cas — une
  // tâche introuvable ne démarre jamais, et l'annonce ne doit pas échoir au Ctrl+S suivant.
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
  // Rien à afficher : un formulaire pleine page (métadonnées) occupe l'écran et l'aperçu
  // a été fermé exprès — le rouvrir ici volerait le focus que focaliserUnite vient de
  // donner à l'arbre. Ni webview.html réassigné ni panneau PDF rouvert : la garde
  // d'interaction (differer, lib/interaction.js) n'a donc rien à protéger sur ce chemin.
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

// ---- Aperçu de la page de Documentation (bouton dédié « Aperçu du PDF » de son formulaire,
// documentation-hote.js/media/documentation.js, 23.09.2026) --------------------------------
//
// Même mécanisme que celui d'un article (ouvrirApercuHtml/ouvrirApercuPdf/compilerPuisAfficher,
// session.apercuCourantSlug) — mais la Documentation n'a pas de .md source à comparer à un
// aperçu existant : elle dépend de toute la bibliothèque de fiches partagée, un graphe trop
// large à surveiller ici. Plutôt que deviner une obsolescence, ouvrir recompile TOUJOURS
// (compilerPuisAfficher, la même garde session.buildEnCours()/importEnCours() qu'ailleurs) —
// son slug est déjà celui de toute unité Documentation (SLUG_DOCUMENTATION, kirby-contenu.js
// et le Makefile la compilent comme n'importe quel article, via out/<slug>/…).
//
// « Ouvert pour CE slug » : une question posée à l'état RÉEL (session.panneauApercuHtml()/
// apercuCourantSlug() en HTML — déjà tenus à jour par le onDidDispose de ouvrirApercuHtml ;
// ongletOuvert() sur le tabGroups réel en PDF) plutôt qu'une variable à soi : un aperçu se
// ferme aussi à la croix, et documentation-hote.js n'a pas d'autre moyen de le savoir.
function apercuOuvertPourSlug(racine, slug) {
  if (!racine || !slug) { return false; }
  if (modeApercu() === 'html') {
    return !!session.panneauApercuHtml() && session.apercuCourantSlug() === slug;
  }
  const pdf = path.join(racine, 'out', slug, slug + '.pdf').toLowerCase();
  return ongletOuvert((e) => e && e.uri && String(e.uri.fsPath || '').toLowerCase() === pdf);
}

// L'ouverture recompile elle-même (lancerBuild), comme la branche « obsolète » de
// ouvrirArticle — PAS via compilerPuisAfficher : cette dernière n'affiche que si un panneau
// existe DÉJÀ (elle sert à rafraîchir un aperçu déjà ouvert, jamais à en ouvrir un premier),
// ce qui serait toujours faux ici au premier clic.
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
    // Une compilation tourne déjà pour autre chose : montrer ce qui existe en attendant,
    // comme ouvrirArticle sur ce même cas.
    if (modeApercu() === 'html') {
      if (session.apercuCourantUri()) { await fermerApercuCourant(null); }
      ouvrirApercuHtml(fournisseur, slug, true);
    }
    return;
  }
  if (compilationAutoCoupee()) {
    // Numéro gelé : rien ne se compile, on montre ce qui existe déjà — comme ouvrirArticle.
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

// Après « Enregistrer » sur la Documentation : si son aperçu est déjà ouvert, il se
// rafraîchit tout seul — même chemin que ci-dessus à l'ouverture, via le garde-fou déjà posé
// dans compilerPuisAfficher (n'affiche que si session.apercuCourantSlug() vaut encore ce slug
// à la fin de la compilation : un aperçu fermé ou changé entre-temps ne rouvre pas tout seul).
async function rafraichirApercuDocumentationSiOuvert(fournisseur, slug) {
  if (!apercuOuvertPourSlug(fournisseur.racine, slug)) { return; }
  await compilerPuisAfficher(fournisseur, slug);
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
// plus probable, et ce n'est qu'une proposition. La comparaison se fait par tige() : le
// nom deviné (slugifierArticle) n'a jamais de préfixe, mais le dossier peut en porter un
// depuis que l'import en pose (lib/import-hote.js) — sans cet oubli, un article rangé sous
// « 00-inclusion » ne se proposerait jamais en tête pour le Word « inclusion.docx ».
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

// Le rédacteur désigne le Word. Sortie du refus « la fiche ne dit pas d'où vient cet
// article » et de « son document n'attend pas sous ce nom ». Rien n'attend : on dit où
// déposer le Word, car le copier ici passerait par l'import, qui le convertirait en article.
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

// Vrai quand la chaîne refuserait faute de Word : la fiche n'en nomme aucun
// (reimport-fiche-sans-source), ou celui qu'elle nomme n'attend pas dans le dépôt
// (reimport-sans-word). Même comparaison sans casse que reimporter.py.
function wordDeLaFicheAbsent(fournisseur, slug) {
  const source = String(lireMetaArticle(fournisseur.racine, slug).source || '').toLowerCase();
  if (source === '') { return true; }
  const noms = fournisseur._docxEnAttente(path.join(fournisseur.racine, profilCourant().depot));
  return !noms.some((n) => n.toLowerCase() === source);
}

// Le geste, du début à la fin. `cible` vaut { slug } depuis un article, { word } depuis la
// vue « Word en attente », { word, slug } quand l'appariement est déjà fait.
async function reimporterArticle(fournisseur, rafraichirTout, cible) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  // Une conversion ou une compilation en cours lit articles/ et articles-word/ : les
  // remplacer sous ses pieds laisserait un article à moitié écrit.
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
  // Le Word se choisit avant la confirmation : celle-ci porte alors sur un Word connu, et
  // le refus de la chaîne n'oblige pas à confirmer une seconde fois.
  if (word === '' && wordDeLaFicheAbsent(fournisseur, slug)) {
    word = await choisirWordReimport(fournisseur, slug);
    if (word === '') { return; }
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
    const manqueLeWord = !annulation && (codes.indexOf('reimport-sans-word') !== -1
      || codes.indexOf('reimport-fiche-sans-source') !== -1);
    const boutons = manqueLeWord ? [T('reimport.choisirWord'), voir] : [voir];
    const choix = await vscode.window.showWarningMessage(
      premiere || T('reimport.refuse', [slug]), ...boutons);
    if (choix === voir) { await ouvrirControles(); }
    if (choix === T('reimport.choisirWord')) {
      const nom = await choisirWordReimport(fournisseur, slug);
      if (nom === '') { return; }
      // Le remplacement de cet article vient d'être confirmé, et le refus n'a rien touché :
      // le redemander ferait deux confirmations pour un seul geste.
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
    : path.relative(profils.chemins(profilCourant(), racine, slug).media, cible).replace(/\\/g, '/');

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
  const md = profils.chemins(profilCourant(), racine, slug).md;
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
  const ouvert = estTable ? tableHote.panneauTableOuvert(cible) : null;
  // Sa fermeture ferait partir la recompilation encore en attente (relanceDifferee.vider)
  // pendant que le fichier s'efface : elle tombe, l'enregistrement du .md plus bas relance.
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
  const dossierArticle = profils.chemins(profilCourant(), racine, slug).dossier;
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
  // Le dossier parti laisse un trou dans la numérotation – 01, 03, 04 – et les numéros des
  // dossiers cesseraient de suivre la liste dès la première suppression. On referme le rang
  // tout de suite, par le même lot en deux passes que « Changer l'ordre » : l'article est
  // déjà supprimé, un renommage qui coince ne remet donc rien en cause, il se reprend.
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
// restreint aux blocs qui n'ont pas commencé, ce que ne veut pas un bouton de la
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
// brouillonTraduction et uriMailto servent à « Envoyer pour traduction » ci-dessous ; les
// quatre restent exposés par _pur.
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
  // Le suivi de traduction d'un article : sa fiche, son sidecar, et l'état qu'ils donnent.
  etatTraduction: (racine, slug, source) => etatTraduction(racine, slug, source),
  cheminTraduction: (racine, slug) => cheminTraduction(racine, slug),
  lireMetaArticle: (racine, slug) => lireMetaArticle(racine, slug),
  lireSuiviTraduction: (racine, slug) => lireSuiviTraduction(racine, slug),
  ecrireSuiviTraduction: (racine, slug, suivi) => ecrireSuiviTraduction(racine, slug, suivi)
});

// ---- Photos, auteur·e·s connus et fiches de tous les articles -> lib/metadonnees-hote.js
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

// Le nombre de blocs de la page de Documentation : ses fiches rattachées (bibliothèque
// partagée) et ses rubriques non vides réunies — ce que le badge de l'en-tête « ACTUALITÉ »
// annonce. Lecture seule : l'id du numéro se pose à l'ouverture du numéro (majContexte,
// poserIdNumeroEtAvertirDoublon), jamais ici — un numéro dont ausgabe.yaml serait illisible
// compte simplement 0 fiche plutôt que de lever.
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
// « Traductions à faire » / « Réservoir » (lib/documentation-hote.js) ont besoin de savoir
// quelle revue est ouverte pour nommer l'AUTRE (kirby.autreRevue) et filtrer ses numéros.

// Le jeton de revue du numéro ouvert. Repli sur 'revue' plutôt que sur rien.
function revueCourante(racine) {
  const jeton = revueNumero(racine);
  return kirbyLib.REVUES.indexOf(jeton) !== -1 ? jeton : 'revue';
}

function nomRevueAffiche(revue) {
  return kirbyLib.dossierRevue(revue) || kirbyLib.DOSSIERS_REVUE.revue;
}

// Pose l'id du numéro (ausgabe.yaml#id) s'il n'en a pas encore, et avertit (jamais un refus)
// si cet id se retrouve sur un autre dossier de l'arbre — un id posé une fois, jamais
// recalculé, ne devrait normalement jamais se répéter, sauf un dossier de numéro copié à la
// main. Appelée à l'ouverture du numéro (majContexte) : le pipeline refuse de compiler une
// Documentation sans id, l'id doit donc exister avant le premier Ctrl+S, pas seulement à
// l'ouverture du formulaire.
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
  // Le contexte, pour lib/controles-hote.js : les constats fermés et les slugs retirés
  // s'écrivent dans son globalState.
  controlesHote.configurer({ etatPoste: () => context });
  documentationHote.configurer({ etatPoste: () => context });
  // Rien n'attend ce travail : il ne conditionne aucune commande, et le faire attendre
  // retarderait l'ouverture de la barre latérale.
  poserReglagesMaison(context).catch((e) => {
    console.warn('réglages de la maison : ' + ((e && e.message) || e));
  });
  // Et les réglages protégés déployés par la mise à jour, recopiés là où la chaîne de
  // compilation les lit — seulement s'ils ont changé depuis la dernière fois.
  reglagesHote.relayerReglagesProteges(context).catch((e) => {
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
        const vueSection = vueDeSection(categorie);
        if (vueSection) { vscode.commands.executeCommand(vueSection); }
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

  // N'apparaît que sur un numéro gelé, et passe avant l'aperçu : c'est ce qui explique
  // pourquoi l'éditeur ne répond plus aux frappes.
  // Le compteur des contrôles et le badge PDF/UA de l'article ouvert, à gauche de la
  // bascule d'aperçu : masqués tant qu'il n'y a rien à dire.
  controlesHote.installerBarres(context, fournisseur);

  const barreEtat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 60);
  context.subscriptions.push(barreEtat);

  // Le badge « Dossier de test » : un poste qui pointe sur l'arborescence de test le dit
  // dans la barre d'état, en couleur — la décision test/production reste ouverte, ce badge
  // ne fait qu'annoncer. Couleur posée une fois pour toutes : elle ne varie pas, seule la
  // visibilité change.
  // Un clic mène à l'onglet Paramètres de l'Accueil, où se règle le mode développeur.
  const barreModeTest = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 70);
  barreModeTest.command = 'szh.reglages';
  barreModeTest.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  context.subscriptions.push(barreModeTest);

  const majBarreApercu = () => {
    barreApercu.text = T(modeApercu() === 'html' ? 'apercu.barre.html' : 'apercu.barre.pdf');
    barreApercu.tooltip = T('apercu.barre.tooltip');
    if (fournisseur.racine) { barreApercu.show(); } else { barreApercu.hide(); }
    // Point de passage unique à chaque changement d'article ou de mode : dit au Makefile
    // quel aperçu sortir en premier du lot.
    noterApercuPrioritaire(fournisseur.racine);
  };

  // lireModeDeveloppeur() (déjà importé de lib/archivage.js) vaut exactement
  // lireEmplacementRevues() === EMPLACEMENT_TEST : pas de nouvel import nécessaire ici.
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
    // compilation ici se ferait taire par un bloquant venu d'ailleurs.
    controlesHote.ouvrirNumero(racine, fournisseur);
    controlesHote.majBarreControles();
    majBarreModeTest();
    session.poserProfilRevue(lireProfil(racine));            // pilote le mode d'aperçu
    // L'id du numéro (ausgabe.yaml#id) : posé ici, à l'ouverture du numéro — pas seulement à
    // l'ouverture du formulaire de Documentation — parce que le pipeline refuse désormais de
    // compiler une Documentation sans id. Un livre n'a pas de Documentation (buch.yaml n'a
    // pas besoin de cette clé) : on ne la pose que sur une revue.
    if (racine && profilCourant().capacites.documentation) { poserIdNumeroEtAvertirDoublon(racine); }
    // Les clés de profil et de capacité (szh.peut.*) se posent toutes à chaque
    // rafraîchissement, à vrai ou à faux. Ne poser que les vraies laisserait szh.estRevue
    // vrai après le passage à un livre, et les deux vues latérales s'afficheraient ensemble.
    const cles = profils.contextes(session.profilOuvrage());
    for (const nom of Object.keys(cles)) {
      vscode.commands.executeCommand('setContext', nom, !!racine && cles[nom]);
    }
    reinstallerWatchers(racine);
    if (racine) { moteur.demarrerDormeur(); } else { moteur.arreterDormeur(); }
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
    { dispose: () => cycleVie.libererScm() },
    // `item` porte { slug, focus } quand la commande vient d'un bouton de constat (voir
    // ouvrirCible) : le slug ne sert à rien ici (un seul numéro), mais focus nomme un champ
    // du formulaire — lu par ouvrirMetadonnees, qui le fait suivre jusqu'à la webview.
    cmdEcriture('szh.metadonnees', (item) => ouvrirMetadonnees(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.apercuMetadonnees', () => ouvrirApercuMetadonnees(fournisseur, rafraichirTout, null)),
    // Le même formulaire, filtré sur un article.
    cmdEcriture('szh.metadonneesArticle', (item) => ouvrirMetadonneesArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.traduction', (item) => traductionHote.ouvrirTraduction(fournisseur, rafraichirTout, item)),
    // Le tutoriel : neuf étapes dans la page d'accueil de l'éditeur, cochées à mesure que
    // les commandes correspondantes sont jouées. C'est le seul « calque » qu'une extension
    // puisse poser par-dessus l'interface — un webview vit dans son cadre et ne peut pas
    // dessiner sur la barre latérale ni sur les onglets.
    vscode.commands.registerCommand('szh.tutoriel', () => vscode.commands.executeCommand(
      'workbench.action.openWalkthrough', 'szh-csps.szh-cockpit#szhDemarrage', false)),
    // « Quoi de neuf » : la fenêtre s’ouvre seule après une mise à jour qui change de
    // medium, mais elle doit rester atteignable ensuite — sans quoi une note refusée d’un
    // clic serait perdue pour toujours. Demandée à la main, elle montre la note du medium
    // installé, jamais tout l’historique.
    vscode.commands.registerCommand('szh.nouveautes',
      () => montrerNouveautes(nouveautes.mediumInstalle())),
    vscode.commands.registerCommand('szh.vueTraductions',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'traductions')),
    cmd('szh.vueArticles', () => ouvrirVueArticles(fournisseur, rafraichirTout)),
    // Même page que ARTICLES, en variante livre (ouvrirVueArticles décide par le profil).
    cmd('szh.vueChapitres', () => ouvrirVueArticles(fournisseur, rafraichirTout)),
    cmd('szh.envoyerAuteur', (item) => envoyerAuteur(fournisseur, item)),
    // Rien n'est écrit : `cmd`, pas `cmdEcriture`, et pas de garde szh.verrouillee dans le
    // `when` du menu (package.json) — voir voirPdfArticle ci-dessus. C'est aussi la
    // destination de pipeline/pdf-verrouille (lieu « pdf », lib/constats.js) : `item` porte
    // déjà { slug, focus } sans rien y changer — cibleTraduction (ci-dessous) lit cible.slug.
    cmd('szh.voirPdfArticle', (item) => voirPdfArticle(fournisseur, item)),
    // `item` ({ slug, focus }) porte le contrat des boutons de constat (revue F03) : focus,
    // un nom de fichier Word, amène désormais sa carte à l'écran et la marque quelques
    // secondes (SZH.listeCartes.focaliser, media/_commun.js, media/vue-ensemble.js) — un
    // [data-cle] additif, posé seulement quand une ligne en porte un, laisse « Traductions »
    // et « Contrôles » inchangées : rien n'y appelle jamais ouvrirVueEnsemble avec un focus.
    vscode.commands.registerCommand('szh.vueWord',
      (item) => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'word', item)),
    vscode.commands.registerCommand('szh.vueControles',
      () => ouvrirVueEnsemble(fournisseur, rafraichirTout, 'controles')),
    // Fabriquer un lien ne modifie rien : disponible même sur un numéro verrouillé.
    cmd('szh.envoyerTraduction', (item) => traductionHote.envoyerPourTraduction(fournisseur, item)),
    // Aucun constat de constats.js ne vise « reglages » avec un focus utile (vérifié dans
    // TABLE) : `item` est accepté pour honorer le contrat, rien de plus n'est câblé.
    cmd('szh.reglages', (item) => accueilHote.ouvrirAccueil({ onglet: 'reglages' })),
    // basculerApercu (lib/apercu.js) est un INTERRUPTEUR sur l'article actif/en aperçu, pas
    // un « ouvrir l'aperçu de tel article », et ne prend même pas de slug — lui donner ce
    // sens demanderait de refaire son ciblage. `item` est accepté sans y toucher.
    // pipeline/pdf-verrouille ne vise plus « apercu » : il vise désormais « pdf »
    // (szh.voirPdfArticle, ci-dessus), qui SAIT viser un article précis (revue F03,
    // 22.09.2026 — voir lib/constats.js, LIEUX.pdf).
    cmd('szh.basculerApercu', (item) => basculerApercu(fournisseur, majBarreApercu)),
    // La bibliographie d'un article : son texte à gauche, son rendu à droite. Lecture
    // seule du côté du cockpit — rien n'est écrit ici — donc `cmd` et non `cmdEcriture` :
    // un numéro verrouillé se relit.
    cmd('szh.apercuBiblio', (item) => ouvrirBibliographie(fournisseur, item)),
    cmd('szh.apercuLivre', () => ouvrirApercuLivre(fournisseur)),
    cmdEcriture('szh.importerWord', () => importerWord(fournisseur, rafraichirTout)),
    cmdEcriture('szh.convertirEnAttente', () => lancerConversion(fournisseur, rafraichirTout)),
    // Les exports restent ouverts sur un numéro gelé, dont l'archivage a supprimé out/.
    cmd('szh.toutExporter', () => toutExporter(fournisseur, rafraichirTout)),
    cmd('szh.exporterXml', () => exporterXml(fournisseur, rafraichirTout)),
    cmd('szh.rafraichirPagination', () => rafraichirPagination(fournisseur, rafraichirTout)),
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
    // Deux formes d'appel arrivent ici, et c'est voulu : l'arbre et les vues d'ensemble
    // passent le slug tout court, les boutons de constat passent { slug, focus } — le
    // contrat que lib/constats.js écrit en tête de sa table des destinations. La seconde
    // repartait sans un mot (ouvrirArticle exige `typeof slug === 'string'`), et le bouton
    // « Vers l'article » des Contrôles ne faisait rien du tout. On normalise donc ici,
    // au bord, plutôt que d'obliger chaque appelant à connaître l'autre — et `focus` passe
    // maintenant avec le reste : ouvrirArticle s'en sert pour surligner le passage visé.
    cmd('szh.ouvrirArticle', (arg, opts) => {
      const objet = arg !== null && typeof arg === 'object';
      return ouvrirArticle(fournisseur, objet ? String(arg.slug || '') : arg,
        objet ? { focus: String(arg.focus || '') } : opts);
    }),
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
      const vueSection = vueDeSection(categorie);
      if (vueSection) { vscode.commands.executeCommand(vueSection); }
    }),
    cmdEcriture('szh.supprimerArticle', (item) => supprimerArticle(fournisseur, rafraichirTout, item)),
    // Le Word corrigé d'un article déjà publié, et le retour en arrière. Les deux
    // remplacent le texte : refusés sur un numéro verrouillé, comme la suppression.
    cmdEcriture('szh.reimporterArticle', (item) => reimporterArticle(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.annulerReimport', (item) => annulerReimport(fournisseur, rafraichirTout, item)),
    cmdEcriture('szh.supprimerTable', (item) => supprimerAsset(fournisseur, rafraichirTout, item, true)),
    cmdEcriture('szh.editerTable', (item) => tableHote.ouvrirEditeurTable(fournisseur, item)),
    // Le formulaire des médias de l'article : légendes, crédits, qualité, remplacement.
    cmdEcriture('szh.mediasArticle', (item) => ouvrirGestionMedias(fournisseur, rafraichirTout, item)),
    // La page de Documentation du numéro, créée au besoin. Volontairement hors cmdEcriture :
    // la relire sur un numéro verrouillé doit rester possible, seule sa création est refusée
    // (voir ouvrirPageDocumentation).
    // Comme « reglages » : aucun constat ne vise « documentation » avec un focus utile.
    cmd('szh.documentation', (item) => ouvrirPageDocumentation(fournisseur, rafraichirTout)),
    // Les raccourcis de la section ACTUALITÉ (_itemsActualite) :
    // même formulaire, ouvert directement sur la vue visée — jamais une commande de palette,
    // elle ne porte pas d'entrée package.json (comme szh.ouvrirSection, dont elle est la
    // variante ciblée). `categorie` ne compte que pour l'onglet 'numero'.
    cmd('szh.ouvrirActualite', (onglet, categorie) => ouvrirPageDocumentation(
      fournisseur, rafraichirTout, String(onglet || ''), categorie ? String(categorie) : undefined)),
    vscode.workspace.onDidChangeWorkspaceFolders(majContexte),
    // L'article d'un Ctrl+S, retenu pour le voile de « À corriger » : la tâche que
    // triggerTaskOnSave lance juste après ne dit pas ce qu'elle recompile.
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!doc || !doc.uri || !doc.uri.fsPath) { return; }
      controlesHote.retenirEnregistrement(fournisseur, doc.uri.fsPath);
      controlesHote.compilerChapitreEnregistre(fournisseur, doc.uri.fsPath);
    }),
    // L'avertissement part au démarrage d'une tâche : Ctrl+S, le chemin le plus fréquent,
    // ne passe pas par les fonctions du cockpit.
    vscode.tasks.onDidStartTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      if (!estTacheSuivie(tache)) { return; }
      // Ctrl+S / triggerTaskOnSave ne passe par aucune fonction du cockpit : sans ce
      // compteur, les gardes qui lisent session.buildEnCours() (archivage, suppression…) restent
      // inopérantes sur ce chemin, pourtant le plus fréquent.
      session.poserTachesSuiviesEnVol(session.tachesSuiviesEnVol() + 1);
      session.poserBuildEnCours(true);
      // Un import fait par cette tâche finira comme l'import guidé (lib/import-hote.js).
      importHote.noterDebutTache(fournisseur, tache.name);
      // Une compilation de tout le numéro part : elle couvre les enregistrements déjà faits
      // (relanceDifferee). Pas l'export d'UN article (tacheMakeArticle) : il ne compile que lui.
      if (tache.name === NOM_TACHE_BUILD || tache.name === NOM_TACHE_EXPORT) { demarragesBuild++; }
      // Une compilation démarre : un travail de validation PDF/UA déjà en vol juge peut-être
      // un PDF sur le point de changer — pdfuaHote jettera son résultat à son retour.
      pdfuaHote.signalerDebutBuild();
      // Le voile de « À corriger » : l'article annoncé par le cockpit ou tout juste
      // enregistré — jamais toute la liste.
      controlesHote.debuterAnalyse(fournisseur, controlesHote.slugDeLaTache());
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
      if (!estTacheSuivie(tache)) { return; }
      const code = e.exitCode === undefined ? 0 : e.exitCode;
      importHote.noterFinProcessus(code);
      // Le processus a rendu son code : c'est à ce chemin-ci, et non à onDidEndTask, de
      // lever le voile — il attend le journal, puis la validation PDF/UA.
      controlesHote.noterProcessFini();
      controlesHote.relireJournal(fournisseur, code)
        // Seulement si la compilation a réussi : un PDF sorti d'une compilation en échec
        // n'est pas forcément celui qu'on croit — voir pipeline/Makefile, verifier-ua n'est
        // d'ailleurs jamais appelée par `all`.
        // planifier() pose ses clés « en cours » avant sa première attente : le voile, levé
        // juste après, sait donc déjà s'il doit encore attendre la validation.
        .then(() => { if (code === 0) { pdfuaHote.planifier(fournisseur.racine); } })
        .catch(() => { /* un avis raté ne casse pas la compilation */ })
        .then(() => { controlesHote.marquerJournalRelu(fournisseur); });
    }),
    // Se déclenche pour toute fin de tâche, avec ou sans processus : c'est ici, et
    // seulement ici, que le compteur redescend, pour couvrir aussi la tâche interrompue
    // avant le spawn, que onDidEndTaskProcess ne voit jamais. Une tâche normale émet les
    // deux événements ; ne décrémenter que sur celui-ci évite de compter deux fois.
    vscode.tasks.onDidEndTask((e) => {
      if (!fournisseur.racine || !e || !e.execution || !e.execution.task) { return; }
      const tache = e.execution.task;
      if (!estTacheSuivie(tache)) { return; }
      session.poserTachesSuiviesEnVol(Math.max(0, session.tachesSuiviesEnVol() - 1));
      if (session.tachesSuiviesEnVol() === 0) { session.poserBuildEnCours(false); }
      // Une tâche finie sans processus (annulée, wsl.exe absent) : aucun journal ne sera
      // relu, rien n'a changé sous le voile — il tombe tout de suite.
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
    // Le groupe « Livre » de la palette (en-tête FALC, code QR) ne s'ajoute que pour un
    // livre — même source que enregistrerPanneaux ci-dessous.
    profil: () => profilCourant().cle
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
    // Pas pures — elles lisent et écrivent le numéro — mais exposées pour le même
    // contrôle : le fichier dérivé des DOI doit pouvoir s'éprouver sans hôte complet.
    doisCalculesArticles, ecrireDoisCalcules, permuterStatutsTraduction,
    // La co-édition (lib/coedition-hote.js) : ce qu'un formulaire a le droit d'écrire. Un
    // « panneau » n'est pour elles qu'une clé, n'importe quel objet fait l'affaire.
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
    TEXTES_COCKPIT,
    // Pas pure (montre une modale, lit/écrit context.globalState) — exposée pour prouver
    // que l'invitation ne s'affiche jamais sur un livre, sans rejouer une activation
    // complète (voir son commentaire : le `when` du walkthrough ne suffit pas seul).
    proposerTutoriel
  }
};
