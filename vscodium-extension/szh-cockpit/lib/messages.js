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
  TOUS: 'tous', DOI_MANUEL_CONFIRMER: 'doi-manuel-confirmer', DOI_MANUEL_REPONSE: 'doi-manuel-reponse',
  MOTS_CLES_CONNUS: 'mots-cles-connus', FERMER: 'fermer',
  REMPLACER_IMAGE: 'remplacer-image', IMAGE_REMPLACEE: 'image-remplacee',
  IMAGE_ERREUR: 'image-erreur', IMAGE_ANNULEE: 'image-annulee',

  // Auteur·e·s et photo (_auteurs.js, partagé)
  AUTEURS_CONNUS: 'auteurs-connus', PHOTO_DEPOSER: 'photo-deposer', PHOTO_OUVRIR: 'photo-ouvrir',
  PHOTO_CHOISIR: 'photo-choisir', PHOTO_VERSIONS: 'photo-versions',
  PHOTO_VALEUR: 'photo-valeur', PHOTO_ERREUR: 'photo-erreur',

  // Documentation (rubriques et fiches)
  DEPOSER_IMAGE: 'deposer-image', IMAGE_DEPOSEE: 'image-deposee',
  DETACHER: 'detacher', ENVOYER: 'envoyer', RETIRER: 'retirer',

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
  OUVRIR: 'ouvrir', ACTION: 'action', TACHE: 'tache', SANSDOI: 'sansdoi',
  TACHES_ENREGISTRER: 'taches-enregistrer', TACHES: 'taches',
  COMMANDE: 'commande', AVANCEMENT: 'avancement',

  // Réglages
  REGLER: 'regler', REGLER_OJS: 'reglerOjs', REGLER_BIBLIO: 'reglerBiblio',

  // Traduction
  COPIER: 'copier', DEEPL: 'deepl', LIEN: 'lien', FOCUS: 'focus', COPIE: 'copie',

  // Éditeur de tableau
  OPERATION: 'operation', APERCU_OUVRIR: 'apercu-ouvrir', APERCU_FERMER: 'apercu-fermer',
  RESTAURER: 'restaurer',

  // Aperçu HTML
  BASCULER: 'basculer', REVELE: 'revele', SCROLL_SOURCE: 'scrollSource',
  SCROLL: 'scroll', SURLIGNER: 'surligner'
});

module.exports = { MSG };
