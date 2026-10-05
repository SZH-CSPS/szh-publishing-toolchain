// La table des types de messages échangés entre l'hôte et les webviews : données pures,
// sans dépendance, pour que ce fichier se charge aussi bien ici (CommonJS) que copié dans
// media/_messages.js (SZH.MSG, chargé dans le navigateur). contrats.test.js vérifie que les
// deux tables restent identiques, mêmes clés et mêmes valeurs.
//
// Les valeurs ne doivent jamais changer sans changer aussi les chaînes que extension.js
// envoie et compare : ce fichier ne fait que nommer ce qui existe déjà, il ne le redéfinit
// pas.
'use strict';

const MSG = Object.freeze({
  // Commun à toutes les pages
  PRET: 'pret', MODIFIE: 'modifie', VALEURS: 'valeurs',
  ENREGISTRER: 'enregistrer', ENREGISTRE: 'enregistre', ERREUR: 'erreur',
  CHARGER: 'charger', RETOUR_ARTICLE: 'retourArticle',
  RECHARGEMENT: 'rechargement', DEMANDE_RECHARGEMENT: 'demande-rechargement', ETAT: 'etat',

  // Métadonnées des articles / Vérification de l'import (_fiches.js)
  // MARKDOWN : la page demande la bascule du texte de l'article à côté de sa fiche,
  // l'hôte répond par le même type et l'état OBTENU — un onglet se ferme aussi à la croix.
  TOUS: 'tous', MARKDOWN: 'markdown',
  // VERIF_META : la feuille A4 à imprimer (une page par article). La page enregistre
  // d'abord ce qui est modifié, puis l'hôte génère depuis le DISQUE — la feuille et le
  // fichier disent ainsi la même chose, ce que son empreinte en pied de page engage.
  VERIF_META: 'verif-meta',
  DOI_MANUEL_CONFIRMER: 'doi-manuel-confirmer', DOI_MANUEL_REPONSE: 'doi-manuel-reponse',
  MOTS_CLES_CONNUS: 'mots-cles-connus', FERMER: 'fermer',
  REMPLACER_IMAGE: 'remplacer-image', IMAGE_REMPLACEE: 'image-remplacee',
  IMAGE_ERREUR: 'image-erreur', IMAGE_ANNULEE: 'image-annulee',

  // Auteur·e·s et photo (_auteurs.js, partagé)
  AUTEURS_CONNUS: 'auteurs-connus', PHOTO_DEPOSER: 'photo-deposer', PHOTO_OUVRIR: 'photo-ouvrir',
  PHOTO_CHOISIR: 'photo-choisir', PHOTO_VERSIONS: 'photo-versions',
  PHOTO_VALEUR: 'photo-valeur', PHOTO_ERREUR: 'photo-erreur',

  // Documentation (rubriques et fiches de la bibliothèque partagée)
  DEPOSER_IMAGE: 'deposer-image', IMAGE_DEPOSEE: 'image-deposee',
  // RETIRER : rend une fiche du numéro orpheline (Ausgabe vidé) — ne l'efface plus.
  // SUPPRIMER : efface pour de bon une fiche déjà orpheline (confirmation côté hôte).
  // SUPPRIMER_FICHE_NUMERO : efface pour de bon une fiche RATTACHÉE, depuis sa carte dans
  // « Documentation du numéro » (23.09.2026) — geste distinct de RETIRER, qui ne fait que la
  // détacher. N'ôte que le fichier de la langue du numéro ; l'autre langue, si elle existe,
  // reste (confirmation côté hôte, kirby.supprimerFicheLangue).
  RETIRER: 'retirer', SUPPRIMER: 'supprimer', SUPPRIMER_FICHE_NUMERO: 'supprimerFicheNumero',
  // Traductions à faire / Réservoir (docs/FORMAT-DOCUMENTATION-KIRBY.md) : gestes posés sur
  // une fiche de l'AUTRE langue, désignée par son Uuid — celui du fichier source, partagé
  // avec le fichier traduit une fois qu'il existe.
  TRADUIRE_DANS_NUMERO: 'traduireDansNumero', TIRER_DANS_NUMERO: 'tirerDansNumero',
  MARQUER_A_TRADUIRE: 'marquerATraduire', IGNORER_TRADUCTION: 'ignorerTraduction',
  ANNULER_DECISION: 'annulerDecisionTraduction', RESERVOIR_FILTRE: 'reservoirFiltre',
  // RESERVOIR : la réponse de l'hôte avec le contenu de l'onglet Réservoir.
  RESERVOIR: 'reservoir',
  // Onglet Archive : TOUTE la bibliothèque de production, lue à la demande (jamais à
  // l'ouverture du panneau — des centaines de fiches sur OneDrive). ARCHIVE_CHARGER : la
  // page le demande la première fois qu'on ouvre l'onglet ; ARCHIVE_ACTUALISER : le bouton
  // « Actualiser » force une relecture. ARCHIVE_IMAGE : l'aperçu d'une fiche cliquée demande
  // son image à part (jamais en bloc avec la liste). ARCHIVE_REPRENDRE : « Reprendre dans ce
  // numéro », désignée par (type, slug) dans la bibliothèque de PRODUCTION.
  ARCHIVE_CHARGER: 'archiveCharger', ARCHIVE_ACTUALISER: 'archiveActualiser',
  ARCHIVE_DONNEES: 'archiveDonnees',
  ARCHIVE_IMAGE: 'archiveImage', ARCHIVE_IMAGE_DONNEE: 'archiveImageDonnee',
  ARCHIVE_REPRENDRE: 'archiveReprendre', ARCHIVE_REPRISE: 'archiveReprise',
  // ONGLET_ACTIVER : l'arbre (les entrées de la section ACTUALITÉ) demande de basculer un
  // panneau DÉJÀ OUVERT sur une autre vue — le premier chargement, lui, porte la vue visée
  // directement dans « charger » (vueInitiale), jamais par ce message.
  ONGLET_ACTIVER: 'ongletActiver',
  // Le bouton « Aperçu du PDF » de la barre (23.09.2026) : la page demande la bascule
  // (ouvrir/fermer), l'hôte répond par le même type l'état OBTENU — comme MODE_TRAD.
  APERCU_BASCULER: 'apercuBasculer', APERCU_ETAT: 'apercuEtat',

  // Gestionnaire des médias
  AUTEUR_ENREGISTRER: 'auteur-enregistrer', AUTEUR_ENREGISTRE: 'auteur-enregistre',
  AUTEUR_ERREUR: 'auteur-erreur', AJOUTER_A_COTE: 'ajouter-a-cote', REMPLACER: 'remplacer',
  GRILLE_AJOUTER: 'grille-ajouter', GRILLE_DISPOSITION: 'grille-disposition',
  GRILLE_RETIRER: 'grille-retirer', INSERER: 'inserer', FOCALISER: 'focaliser',
  MEDIA_REMPLACE: 'media-remplace', MEDIA_ERREUR: 'media-erreur',
  MEDIA_ANNULEE: 'media-annulee', MEDIA_RETIRE: 'media-retire',

  // Métadonnées du numéro et du livre (_numero.js)
  COUVERTURE_DEPOSER: 'couverture-deposer', COUVERTURE: 'couverture',

  // Vues d'ensemble et « Articles »
  // CONSTAT_FERMER : la croix d'un constat « Pour information ». La page envoie l'empreinte
  // du message, l'hôte la retient et ne le renvoie plus tant que sa phrase ne change pas.
  OUVRIR: 'ouvrir', ACTION: 'action', TACHE: 'tache', SANSDOI: 'sansdoi',
  CONSTAT_FERMER: 'constat-fermer',
  // ANALYSE : le voile « Analyse en cours… » de « À corriger », posé et levé par l'hôte
  // pendant une compilation et sa validation PDF/UA ({ actif, cle, texte } ; cle vide =
  // toute la liste). Le même état voyage aussi dans « valeurs » (champ `analyse`).
  ANALYSE: 'analyse',
  TACHES_ENREGISTRER: 'taches-enregistrer', TACHES: 'taches',
  COMMANDE: 'commande', AVANCEMENT: 'avancement',

  // Réglages
  REGLER: 'regler', REGLER_OJS: 'reglerOjs', REGLER_BIBLIO: 'reglerBiblio',
  // Réglages protégés : le déverrouillage demandé par la page, et l'export du fichier
  // à transmettre à l'administrateur.
  DEVERROUILLER: 'deverrouiller', PROTEGES: 'proteges', TELECHARGER_PROTEGES: 'telecharger-proteges',
  // Le fichier de langue de l'interface : une copie des libellés, fr et de côte à côte,
  // pour relecture. Il ne relit rien — corriger le fichier ne change pas l'interface.
  EXPORTER_LANGUE: 'exporterLangue',
  // Le dossier des suggestions sur les textes de l'outil, révélé dans l'explorateur : sans
  // ce bouton, elles seraient écrites et jamais relues.
  SUGGESTIONS_INTERFACE: 'suggestionsInterface',

  // Traduction
  COPIER: 'copier', DEEPL: 'deepl', LIEN: 'lien', FOCUS: 'focus', COPIE: 'copie',
  // Vérificateur de traduction : la pastille d'un champ traduisible demande le
  // formulaire de suggestion. Elle ne modifie rien — c'est une proposition.
  SUGGERER_TRADUCTION: 'suggererTraduction',
  // Mode « Trad » : la page demande l'état du mode, l'hôte répond par le même type et
  // joint l'index des libellés ; le clic détourné repart en SUGGERER_INTERFACE avec le
  // texte lu à l'écran et ses clés candidates.
  MODE_TRAD: 'modeTrad', SUGGERER_INTERFACE: 'suggererInterface',

  // Éditeur de tableau
  OPERATION: 'operation', APERCU_OUVRIR: 'apercu-ouvrir', APERCU_FERMER: 'apercu-fermer',
  RESTAURER: 'restaurer',
  // Image d'une cellule : la page demande le sélecteur de fichier ({ action: 'inserer' |
  // 'remplacer', li, ci, n }), l'hôte répond par le src écrit dans media/ et son aperçu.
  TABLE_IMAGE_CHOISIR: 'table-image-choisir', TABLE_IMAGE_CHOISIE: 'table-image-choisie',

  // Aperçu HTML
  BASCULER: 'basculer', REVELE: 'revele', SCROLL_SOURCE: 'scrollSource',
  SCROLL: 'scroll', SURLIGNER: 'surligner',

  // Accueil (media/accueil.js). ONGLET : l'onglet que la page vient d'ouvrir.
  // Produits et Nouveau : ouvrir une entrée, la fenêtre des versions, créer une entrée et
  // le refus éventuel de l'hôte.
  ACCUEIL_ONGLET: 'accueilOnglet', ACCUEIL_OUVRIR: 'accueilOuvrir', ACCUEIL_VERSIONS: 'accueilVersions',
  ACCUEIL_CREER: 'accueilCreer', ACCUEIL_CREE: 'accueilCree',
  // Préprocessing : choisir ou déposer un manuscrit, interrompre, ouvrir le document, le
  // rapport ou leur dossier ; l'hôte envoie ses réglages, le début, chaque étape et l'issue.
  ACCUEIL_PREPROC_CHOISIR: 'accueilPreprocChoisir', ACCUEIL_PREPROC_DEPOSER: 'accueilPreprocDeposer',
  ACCUEIL_PREPROC_INTERROMPRE: 'accueilPreprocInterrompre', ACCUEIL_PREPROC_OUVRIR: 'accueilPreprocOuvrir',
  ACCUEIL_PREPROC_ETAT: 'accueilPreprocEtat', ACCUEIL_PREPROC_DEBUT: 'accueilPreprocDebut',
  ACCUEIL_PREPROC_ETAPE: 'accueilPreprocEtape', ACCUEIL_PREPROC_FIN: 'accueilPreprocFin',
  // Secrétariat : la page demande une tâche ou le chargement des numéros publiés ; l'hôte
  // annonce le début, relaie chaque ligne JSON de secretariat-cli.js telle quelle, puis
  // l'issue, chaque fois avec la commande concernée.
  ACCUEIL_EXPORTER: 'accueilExporter', ACCUEIL_OJS_CHARGER: 'accueilOjsCharger',
  ACCUEIL_INTERROMPRE: 'accueilInterrompre', ACCUEIL_AFFICHER: 'accueilAfficher',
  ACCUEIL_DEBUT: 'accueilDebut', ACCUEIL_LIGNE: 'accueilLigne', ACCUEIL_FIN: 'accueilFin',
  // Log : lire la fin d'un journal, l'ouvrir en entier, signaler un problème.
  ACCUEIL_JOURNAL_LIRE: 'accueilJournalLire', ACCUEIL_JOURNAL_TEXTE: 'accueilJournalTexte',
  ACCUEIL_JOURNAL_EDITEUR: 'accueilJournalEditeur',
  ACCUEIL_SIGNALER: 'accueilSignaler', ACCUEIL_SIGNALE: 'accueilSignale',
  // Paramètres : un service en ligne (adresse ou clé) à poser ou à effacer, et l'ordre de l'hôte
  // d'ouvrir un onglet (szh.reglages). Les autres réglages passent par REGLER.
  ACCUEIL_SERVICE: 'accueilService', ACCUEIL_ALLER: 'accueilAller',

  // Documentation, aperçu de la date imprimée : la page envoie { jeton, saisie, valeurs },
  // l'hôte répond { jeton, ok, forme, erreur, indisponible } (lib/date-apercu.js).
  DOC_DATE_FORMER: 'docDateFormer', DOC_DATE_FORMEE: 'docDateFormee',
  // Documentation, fiche « D'une revue à l'autre » : la page demande, une fois par panneau,
  // les articles de l'autre revue ; l'hôte répond { ok, numeros, illisibles } (lib/autre-revue.js).
  DOC_AUTREREVUE_CHARGER: 'docAutreRevueCharger', DOC_AUTREREVUE_DONNEES: 'docAutreRevueDonnees',
  // Documentation, vue « Propositions » (lib/propositions.js). La page demande les données
  // (PROP_CHARGER) ; l'hôte les rend, et les renvoie après chaque geste avec son résultat
  // (PROP_DONNEES). Les gestes : accepter { demandes: [{ cle, aussi, valeurs?, touches? }], dansNumero,
  // depuisDetail }, refuser { cles, motif }, annuler { cles }. PROP_COLONNES range le réglage
  // des colonnes d'un type ({ typeFiche, reglage }) dans le globalState du poste.
  PROP_CHARGER: 'propCharger', PROP_DONNEES: 'propDonnees',
  PROP_ACCEPTER: 'propAccepter', PROP_REFUSER: 'propRefuser', PROP_ANNULER: 'propAnnuler',
  PROP_COLONNES: 'propColonnes', PROP_OUVRIR_SOURCE: 'propOuvrirSource',
  // Le détail : PROP_VERIFIER { cle, jeton, valeurs, touches } -> PROP_VERIFIE { cle, jeton,
  // bloquants } ; PROP_RECREER { cle, valeurs } recrée la fiche d'une acceptée introuvable.
  PROP_VERIFIER: 'propVerifier', PROP_VERIFIE: 'propVerifie', PROP_RECREER: 'propRecreer',
  // La finesse du tri : PROP_FINESSE_APERCU { typeFiche, cran } range le cran que ce poste regarde
  // (globalState) ; PROP_FINESSE_GARDER { typeFiche } en fait le réglage partagé de la rédaction,
  // que PROP_FINESSE_ANNULER { typeFiche } rétablit. ACCUEIL_FINESSE { moissonneur, typeFiche,
  // langue, cran } règle le partagé depuis les Paramètres de l'Accueil.
  PROP_FINESSE_APERCU: 'propFinesseApercu', PROP_FINESSE_GARDER: 'propFinesseGarder',
  PROP_FINESSE_ANNULER: 'propFinesseAnnuler', ACCUEIL_FINESSE: 'accueilFinesse',
  // Les termes : PROP_FILTRE_TERME { typeFiche, terme, role, langue } filtre l'onglet du type sur un
  // terme (terme vide : retire le filtre) ; PROP_DEMANDE_ECRIRE { moissonneur, terme, langue, sens }
  // écrit une demande sur le lexique. Les comptes par terme voyagent dans PROP_DONNEES (termes).
  // Les Paramètres de l'Accueil : ACCUEIL_DEMANDE_CONFIRMER et ACCUEIL_DEMANDE_RETIRER { moissonneur,
  // id }, ACCUEIL_DEMANDE_ANNULER défait le dernier retrait, ACCUEIL_OUVRIR_TERMES { moissonneur }.
  PROP_FILTRE_TERME: 'propFiltreTerme', PROP_DEMANDE_ECRIRE: 'propDemandeEcrire',
  ACCUEIL_DEMANDE_CONFIRMER: 'accueilDemandeConfirmer', ACCUEIL_DEMANDE_RETIRER: 'accueilDemandeRetirer',
  ACCUEIL_DEMANDE_ANNULER: 'accueilDemandeAnnuler', ACCUEIL_OUVRIR_TERMES: 'accueilOuvrirTermes',
  // Raccourcir les résumés (lib/resumes-hote.js) : ACCUEIL_MISTRAL_CLE { valeur } pose ou efface la
  // clé, ACCUEIL_MISTRAL_TESTER, ACCUEIL_MISTRAL_MODELE { valeur }, ACCUEIL_RESUMES_LANCER et
  // ACCUEIL_RESUMES_ARRETER ; l'hôte répond par ACCUEIL_RESUMES_ETAT, jamais avec la clé.
  ACCUEIL_MISTRAL_CLE: 'accueilMistralCle', ACCUEIL_MISTRAL_TESTER: 'accueilMistralTester',
  ACCUEIL_MISTRAL_MODELE: 'accueilMistralModele', ACCUEIL_RESUMES_LANCER: 'accueilResumesLancer',
  ACCUEIL_RESUMES_ARRETER: 'accueilResumesArreter', ACCUEIL_RESUMES_ETAT: 'accueilResumesEtat'
});

module.exports = { MSG };
