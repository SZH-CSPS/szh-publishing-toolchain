// La table des types de messages échangés entre l'hôte et les webviews, côté navigateur :
// SZH.MSG. Même contenu que lib/messages.js (contrats.test.js vérifie qu'elles ne
// divergent pas), pour que l'hôte et la page nomment le même protocole au lieu de se fier
// chacun à ses propres littéraux. Posé par construireHtml (lib/webviews/util.js) dans le
// jsPartage des onze pages, avant leur propre script — SZH.MSG existe donc avant la
// première ligne de chaque page. Douzième surface : l'aperçu HTML, qui enrobe le HTML de
// pandoc au lieu d'un gabarit de media/ et n'emprunte donc pas construireHtml ; c'est
// scriptApercu (lib/apercu.js) qui pose ce fichier devant media/apercu.js. Ce fichier
// suppose seulement que `SZH` existe : c'est à qui l'injecte de le déclarer. La table
// n'existe plus qu'ici et dans lib/messages.js : _commun.js n'en garde aucune copie.
SZH.MSG = Object.freeze({
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
  RETIRER: 'retirer', SUPPRIMER: 'supprimer', SUPPRIMER_FICHE_NUMERO: 'supprimerFicheNumero',
  // Traductions à faire / Réservoir (docs/FORMAT-DOCUMENTATION-KIRBY.md) : gestes posés sur
  // une fiche de l'AUTRE langue, désignée par son Uuid — celui du fichier source, partagé
  // avec le fichier traduit une fois qu'il existe.
  TRADUIRE_DANS_NUMERO: 'traduireDansNumero', TIRER_DANS_NUMERO: 'tirerDansNumero',
  MARQUER_A_TRADUIRE: 'marquerATraduire', IGNORER_TRADUCTION: 'ignorerTraduction',
  ANNULER_DECISION: 'annulerDecisionTraduction', RESERVOIR_FILTRE: 'reservoirFiltre',
  // Onglet Archive : TOUTE la bibliothèque de production, lue à la demande.
  ARCHIVE_CHARGER: 'archiveCharger', ARCHIVE_ACTUALISER: 'archiveActualiser',
  ARCHIVE_DONNEES: 'archiveDonnees',
  ARCHIVE_IMAGE: 'archiveImage', ARCHIVE_IMAGE_DONNEE: 'archiveImageDonnee',
  ARCHIVE_REPRENDRE: 'archiveReprendre', ARCHIVE_REPRISE: 'archiveReprise',
  // ONGLET_ACTIVER : l'arbre demande de basculer un panneau DÉJÀ OUVERT sur une autre vue.
  ONGLET_ACTIVER: 'ongletActiver',
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

  // Aperçu HTML
  BASCULER: 'basculer', REVELE: 'revele', SCROLL_SOURCE: 'scrollSource',
  SCROLL: 'scroll', SURLIGNER: 'surligner'
});
