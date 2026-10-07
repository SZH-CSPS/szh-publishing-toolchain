// Types des messages échangés entre l'hôte et les webviews. Le fichier est sans dépendance
// pour être recopié dans media/_messages.js (SZH.MSG, côté navigateur) ; contrats.test.js
// vérifie que les deux tables sont identiques.
'use strict';

const MSG = Object.freeze({
  // Commun à toutes les pages
  PRET: 'pret', MODIFIE: 'modifie', VALEURS: 'valeurs',
  ENREGISTRER: 'enregistrer', ENREGISTRE: 'enregistre', ERREUR: 'erreur',
  CHARGER: 'charger', RETOUR_ARTICLE: 'retourArticle',
  RECHARGEMENT: 'rechargement', DEMANDE_RECHARGEMENT: 'demande-rechargement', ETAT: 'etat',

  // Métadonnées des articles / Vérification de l'import (_fiches.js)
  // MARKDOWN : la page demande d'afficher ou de masquer le texte de l'article à côté de sa
  // fiche ; l'hôte répond par le même type avec l'état obtenu (l'onglet a pu être fermé à
  // la croix).
  TOUS: 'tous', MARKDOWN: 'markdown',
  // VERIF_META : la feuille A4 de vérification (une page par article). La page enregistre
  // d'abord, puis l'hôte génère depuis le disque : la feuille et l'empreinte de son pied de
  // page correspondent ainsi au fichier.
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
  // RETIRER : détache une fiche du numéro (Ausgabe vidé) sans l'effacer.
  // SUPPRIMER : efface une fiche déjà détachée.
  // SUPPRIMER_FICHE_NUMERO : efface une fiche rattachée, depuis sa carte dans
  // « Documentation du numéro ». Seul le fichier de la langue du numéro disparaît
  // (kirby.supprimerFicheLangue). L'hôte demande confirmation dans ces deux cas.
  RETIRER: 'retirer', SUPPRIMER: 'supprimer', SUPPRIMER_FICHE_NUMERO: 'supprimerFicheNumero',
  // Traductions à faire et Réservoir (docs/FORMAT-DOCUMENTATION-KIRBY.md) : actions sur une
  // fiche de l'autre langue, désignée par son Uuid (le même pour la source et sa traduction).
  TRADUIRE_DANS_NUMERO: 'traduireDansNumero', TIRER_DANS_NUMERO: 'tirerDansNumero',
  MARQUER_A_TRADUIRE: 'marquerATraduire', IGNORER_TRADUCTION: 'ignorerTraduction',
  ANNULER_DECISION: 'annulerDecisionTraduction', RESERVOIR_FILTRE: 'reservoirFiltre',
  // RESERVOIR : contenu de l'onglet Réservoir, envoyé par l'hôte.
  RESERVOIR: 'reservoir',
  // Onglet Archive : toute la bibliothèque de production. Elle compte des centaines de
  // fiches sur OneDrive, d'où une lecture à la première ouverture de l'onglet seulement
  // (ARCHIVE_CHARGER). ARCHIVE_ACTUALISER relit ; ARCHIVE_IMAGE demande l'image d'une seule
  // fiche ; ARCHIVE_REPRENDRE reprend dans ce numéro une fiche désignée par (type, slug).
  ARCHIVE_CHARGER: 'archiveCharger', ARCHIVE_ACTUALISER: 'archiveActualiser',
  ARCHIVE_DONNEES: 'archiveDonnees',
  ARCHIVE_IMAGE: 'archiveImage', ARCHIVE_IMAGE_DONNEE: 'archiveImageDonnee',
  ARCHIVE_REPRENDRE: 'archiveReprendre', ARCHIVE_REPRISE: 'archiveReprise',
  // ONGLET_ACTIVER : l'arbre (section Actualité) bascule un panneau déjà ouvert sur une
  // autre vue. À l'ouverture, la vue voulue passe par « charger » (vueInitiale).
  ONGLET_ACTIVER: 'ongletActiver',
  // Bouton « Aperçu du PDF » : la page demande d'ouvrir ou de fermer, l'hôte répond avec
  // l'état obtenu.
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
  // ANALYSE : le voile « Analyse en cours… » de « À corriger », pendant une compilation et
  // sa validation PDF/UA ({ actif, cle, texte } ; cle vide = toute la liste). Le même état
  // figure aussi dans « valeurs » (champ `analyse`).
  ANALYSE: 'analyse',
  TACHES_ENREGISTRER: 'taches-enregistrer', TACHES: 'taches',
  COMMANDE: 'commande', AVANCEMENT: 'avancement',

  // Réglages
  REGLER: 'regler', REGLER_OJS: 'reglerOjs', REGLER_BIBLIO: 'reglerBiblio',
  // Réglages protégés : déverrouillage, et export du fichier à transmettre à
  // l'administrateur.
  DEVERROUILLER: 'deverrouiller', PROTEGES: 'proteges', TELECHARGER_PROTEGES: 'telecharger-proteges',
  // Exporte les libellés de l'interface, fr et de côte à côte, pour relecture. Modifier ce
  // fichier ne change pas l'interface.
  EXPORTER_LANGUE: 'exporterLangue',
  // Ouvre dans l'explorateur le dossier des suggestions sur les textes de l'interface.
  SUGGESTIONS_INTERFACE: 'suggestionsInterface',

  // Traduction
  COPIER: 'copier', DEEPL: 'deepl', LIEN: 'lien', FOCUS: 'focus', COPIE: 'copie',
  // Vérificateur de traduction : la pastille d'un champ traduisible ouvre le formulaire de
  // suggestion, qui ne modifie pas le champ.
  SUGGERER_TRADUCTION: 'suggererTraduction',
  // Mode « Trad » : l'hôte répond par le même type avec l'index des libellés. Dans ce
  // mode, un clic envoie SUGGERER_INTERFACE avec le texte cliqué et ses clés candidates.
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

  // Accueil (media/accueil.js). ACCUEIL_ONGLET : l'onglet que la page vient d'ouvrir.
  // Produits et Nouveau : ouvrir une entrée, afficher ses versions, créer une entrée.
  ACCUEIL_ONGLET: 'accueilOnglet', ACCUEIL_OUVRIR: 'accueilOuvrir', ACCUEIL_VERSIONS: 'accueilVersions',
  ACCUEIL_CREER: 'accueilCreer', ACCUEIL_CREE: 'accueilCree',
  // Préprocessing : choisir ou déposer un manuscrit, interrompre, ouvrir le document, le
  // rapport ou leur dossier ; l'hôte envoie ses réglages, le début, chaque étape et l'issue.
  ACCUEIL_PREPROC_CHOISIR: 'accueilPreprocChoisir', ACCUEIL_PREPROC_DEPOSER: 'accueilPreprocDeposer',
  ACCUEIL_PREPROC_INTERROMPRE: 'accueilPreprocInterrompre', ACCUEIL_PREPROC_OUVRIR: 'accueilPreprocOuvrir',
  ACCUEIL_PREPROC_ETAT: 'accueilPreprocEtat', ACCUEIL_PREPROC_DEBUT: 'accueilPreprocDebut',
  ACCUEIL_PREPROC_ETAPE: 'accueilPreprocEtape', ACCUEIL_PREPROC_FIN: 'accueilPreprocFin',
  // Secrétariat : la page demande une tâche ou les numéros publiés ; l'hôte envoie le
  // début, chaque ligne JSON de secretariat-cli.js, puis l'issue, avec la commande.
  ACCUEIL_EXPORTER: 'accueilExporter', ACCUEIL_OJS_CHARGER: 'accueilOjsCharger',
  ACCUEIL_INTERROMPRE: 'accueilInterrompre', ACCUEIL_AFFICHER: 'accueilAfficher',
  ACCUEIL_DEBUT: 'accueilDebut', ACCUEIL_LIGNE: 'accueilLigne', ACCUEIL_FIN: 'accueilFin',
  // Log : lire la fin d'un journal, l'ouvrir en entier, signaler un problème.
  ACCUEIL_JOURNAL_LIRE: 'accueilJournalLire', ACCUEIL_JOURNAL_TEXTE: 'accueilJournalTexte',
  ACCUEIL_JOURNAL_EDITEUR: 'accueilJournalEditeur',
  ACCUEIL_SIGNALER: 'accueilSignaler', ACCUEIL_SIGNALE: 'accueilSignale',
  // Paramètres : ACCUEIL_SERVICE pose ou efface l'adresse ou la clé d'un service en ligne ;
  // ACCUEIL_ALLER fait ouvrir un onglet par l'hôte (szh.reglages). Le reste passe par REGLER.
  ACCUEIL_SERVICE: 'accueilService', ACCUEIL_ALLER: 'accueilAller',

  // Documentation, aperçu de la date imprimée : la page envoie { jeton, saisie, valeurs },
  // l'hôte répond { jeton, ok, forme, erreur, indisponible } (lib/date-apercu.js).
  DOC_DATE_FORMER: 'docDateFormer', DOC_DATE_FORMEE: 'docDateFormee',
  // Documentation, fiche « D'une revue à l'autre » : la page demande, une fois par panneau,
  // les articles de l'autre revue ; l'hôte répond { ok, numeros, illisibles } (lib/autre-revue.js).
  DOC_AUTREREVUE_CHARGER: 'docAutreRevueCharger', DOC_AUTREREVUE_DONNEES: 'docAutreRevueDonnees',
  // Documentation, vue « Propositions » (lib/propositions.js). L'hôte envoie PROP_DONNEES
  // en réponse à PROP_CHARGER et après chaque action. Les actions : accepter { demandes: [{ cle, aussi, valeurs?, touches? }], dansNumero,
  // depuisDetail }, refuser { cles, motif }, annuler { cles }. PROP_COLONNES range le réglage
  // des colonnes d'un type ({ typeFiche, reglage }) dans le globalState du poste.
  PROP_CHARGER: 'propCharger', PROP_DONNEES: 'propDonnees',
  PROP_ACCEPTER: 'propAccepter', PROP_REFUSER: 'propRefuser', PROP_ANNULER: 'propAnnuler',
  PROP_COLONNES: 'propColonnes', PROP_OUVRIR_SOURCE: 'propOuvrirSource',
  // Détail d'une proposition : PROP_VERIFIER { cle, jeton, valeurs, touches } -> PROP_VERIFIE { cle, jeton,
  // bloquants } ; PROP_RECREER { cle, valeurs } recrée la fiche d'une acceptée introuvable.
  PROP_VERIFIER: 'propVerifier', PROP_VERIFIE: 'propVerifie', PROP_RECREER: 'propRecreer',
  // Finesse du tri : PROP_FINESSE_APERCU { typeFiche, cran } essaie un cran sur ce poste
  // (globalState) ; PROP_FINESSE_GARDER { typeFiche } en fait le réglage partagé de la
  // rédaction ; PROP_FINESSE_ANNULER { typeFiche } défait le dernier « Garder ». ACCUEIL_FINESSE { moissonneur, typeFiche,
  // langue, cran } règle le partagé depuis les Paramètres de l'Accueil.
  PROP_FINESSE_APERCU: 'propFinesseApercu', PROP_FINESSE_GARDER: 'propFinesseGarder',
  PROP_FINESSE_ANNULER: 'propFinesseAnnuler', ACCUEIL_FINESSE: 'accueilFinesse',
  // Termes : PROP_FILTRE_TERME { typeFiche, terme, role, langue } filtre l'onglet du type sur un
  // terme (terme vide : retire le filtre) ; PROP_DEMANDE_ECRIRE { moissonneur, terme, langue, sens }
  // écrit une demande sur le lexique. Les comptes par terme voyagent dans PROP_DONNEES (termes).
  // Paramètres de l'Accueil : ACCUEIL_DEMANDE_CONFIRMER et ACCUEIL_DEMANDE_RETIRER { moissonneur,
  // id }, ACCUEIL_DEMANDE_ANNULER défait le dernier retrait, ACCUEIL_OUVRIR_TERMES { moissonneur }.
  PROP_FILTRE_TERME: 'propFiltreTerme', PROP_DEMANDE_ECRIRE: 'propDemandeEcrire',
  ACCUEIL_DEMANDE_CONFIRMER: 'accueilDemandeConfirmer', ACCUEIL_DEMANDE_RETIRER: 'accueilDemandeRetirer',
  ACCUEIL_DEMANDE_ANNULER: 'accueilDemandeAnnuler', ACCUEIL_OUVRIR_TERMES: 'accueilOuvrirTermes',
  // Raccourcir les résumés (lib/resumes-hote.js) : ACCUEIL_MISTRAL_CLE { valeur } pose ou efface la
  // clé, ACCUEIL_MISTRAL_TESTER, ACCUEIL_MISTRAL_MODELE { valeur }, ACCUEIL_RESUMES_LANCER et
  // ACCUEIL_RESUMES_ARRETER ; l'hôte répond par ACCUEIL_RESUMES_ETAT, jamais avec la clé.
  ACCUEIL_MISTRAL_CLE: 'accueilMistralCle', ACCUEIL_MISTRAL_TESTER: 'accueilMistralTester',
  ACCUEIL_MISTRAL_MODELE: 'accueilMistralModele', ACCUEIL_RESUMES_LANCER: 'accueilResumesLancer',
  ACCUEIL_RESUMES_ARRETER: 'accueilResumesArreter', ACCUEIL_RESUMES_ETAT: 'accueilResumesEtat',
  // Moisson mensuelle et données FNS (lib/moisson-hote.js) : ACCUEIL_MOISSON_PREPARER estime la durée,
  // ACCUEIL_FNS_CHOISIR ouvre le sélecteur de fichier dans l'hôte, ACCUEIL_MOISSON_LANCER confirme l'un
  // ou l'autre, ACCUEIL_MOISSON_ANNULER y renonce, ACCUEIL_MOISSON_ARRETER demande l'arrêt ;
  // ACCUEIL_FNS_LIEN ouvre data.snf.ch et ACCUEIL_MOISSON_PROPOSITIONS la vue Propositions. L'hôte
  // répond par ACCUEIL_MOISSON_ETAT.
  ACCUEIL_MOISSON_PREPARER: 'accueilMoissonPreparer', ACCUEIL_MOISSON_LANCER: 'accueilMoissonLancer',
  ACCUEIL_MOISSON_ANNULER: 'accueilMoissonAnnuler', ACCUEIL_MOISSON_ARRETER: 'accueilMoissonArreter',
  ACCUEIL_MOISSON_PROPOSITIONS: 'accueilMoissonPropositions', ACCUEIL_MOISSON_ETAT: 'accueilMoissonEtat',
  ACCUEIL_FNS_CHOISIR: 'accueilFnsChoisir', ACCUEIL_FNS_LIEN: 'accueilFnsLien'
});

module.exports = { MSG };
