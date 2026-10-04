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

const { T, TEXTES_COCKPIT } = require('./i18n');
const { MSG } = require('./messages');
const session = require('./session');
const profils = require('./profil');
const { construireHtml } = require('./webviews/util');
const { panneauUnique, revelerPanneau, fermerPanneaux } = require('./webviews/panneau');
const { refuserSiVerrouille } = require('./cycle-vie');
const { fermerTousLesApercus } = require('./apercu');
const { confirmerAbandon } = require('./interaction');
const { langueRevue, ecrireAtomique, serialiserMeta, assurerIdNumero, libelleCourtNumero } = require('./yaml');
const { apercuMedia, BUDGET_APERCUS_MEDIA, nomImageAssaini, TAILLE_MAX_IMAGE_IMPORT } = require('./medias');
const kirby = require('./kirby-contenu');
const dateApercu = require('./date-apercu');
const autreRevue = require('./autre-revue');
const propositions = require('./propositions');
const { moiCoedition } = require('./coedition-hote');
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
// La fiche « D'une revue à l'autre » : la seule qui se préremplit depuis un article de
// l'autre revue. Le contrat n'en dit rien, la page ne connaît aucun nom de type.
const TYPE_REPRISE = 'reprise';

// ---- Rappels vers l'hôte ----------------------------------------------------------
let ctx = {
  focaliserUnite: () => {},
  lireCouleurAccent: () => '',
  limitesMedias: () => ({}),
  revueCourante: () => 'revue',
  nomRevueAffiche: (revue) => String(revue || ''),
  convertirCmykSiBesoin: async () => 0,
  repondreModeTrad: require('./traduction-hote').repondreModeTrad,
  // Le bouton « Aperçu du PDF » (extension.js#apercuOuvertPourSlug/
  // basculerApercuDocumentation/rafraichirApercuDocumentationSiOuvert). Un module non
  // configuré (contrôle isolé) répond « jamais ouvert, rien ne bascule » — sans effet, pas
  // d'exception.
  apercuOuvert: () => false,
  basculerApercu: async () => {},
  rafraichirApercuSiOuvert: async () => {},
  // Le contexte de l'extension : son globalState garde les colonnes de la vue Propositions.
  etatPoste: () => null
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function dossierUnites() {
  return profils.courant().unites.dossier;
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
function typesRessourceConfig(langue, revueJeton) {
  return kirby.typesConnus().map((type) => {
    const champFichier = kirby.champFichierDuType(type);
    return {
      valeur: type,
      // libelleCockpitType : le libellé COURT réservé au cockpit s'il existe (contrat,
      // types[].libelleCourt — « Agenda » plutôt que « Agenda et formation continue » —,
      // Robin), jamais libelleType (le long, imprimé) en dur ici.
      libelleSection: kirby.libelleCockpitType(type, langue),
      libelleAjouter: T('ressource.ajouter.' + type),
      libelleAjouterTip: T('ressource.ajouter.' + type + '.tip'),
      avecImage: !!champFichier,
      champFichier: champFichier,
      // Les deux champs de date imprimés ensemble ([debut, fin] de l'agenda), ou null.
      plage: (kirby.definitionType(type) || {}).plage || null,
      // Le nom de l'autre revue, sur la seule fiche qui se préremplit depuis elle.
      preremplissage: type === TYPE_REPRISE && kirby.autreRevue(revueJeton)
        ? { revue: ctx.nomRevueAffiche(kirby.autreRevue(revueJeton)) } : null,
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
    supprimerNumeroTip: T('ressource.supprimerNumero.tip'),
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
    apercu: T('doc.apercu'), apercuTip: T('doc.apercu.tip'),
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
    archiveEditerTip: T('doc.archive.editer.tip'),
    archiveRepriseOk: T('doc.archive.reprise.ok'), archiveRepriseEchec: T('doc.archive.reprise.echec'),
    archiveApercuTitre: T('doc.archive.apercu.titre'), archiveApercuFermer: T('doc.archive.apercu.fermer'),
    archiveApercuImageChargement: T('doc.archive.apercu.imageChargement'),
    archiveCompteur: T('doc.archive.compteur'),
    // Vue « Publier sur le site web » : notice seule.
    webTitre: T('doc.web.titre'), webAvenir: T('doc.web.avenir'),
    webExplication: T('doc.web.explication'),
    webBouton: T('doc.web.bouton'), webBoutonTip: T('doc.web.bouton.tip'),
    // Aperçu de la date imprimée.
    dateImprime: T('doc.date.imprime'), dateIndisponible: T('doc.date.indisponible'),
    dateIncomplete: T('doc.date.incomplete'), dateModelePartiel: T('doc.date.modelePartiel'),
    dateErreurFormat: T('doc.date.erreur.format'), dateErreurFormatPartiel: T('doc.date.erreur.formatPartiel'),
    dateErreurImpossible: T('doc.date.erreur.impossible'), dateErreurInversee: T('doc.date.erreur.inversee'),
    // Fiche « D'une revue à l'autre » : préremplir depuis un article de l'autre revue.
    autreRevueChoisir: T('doc.autrerevue.choisir'), autreRevueChoisirTip: T('doc.autrerevue.choisir.tip'),
    autreRevueTitre: T('doc.autrerevue.titre'), autreRevueRecherche: T('doc.autrerevue.recherche'),
    autreRevueChargement: T('doc.autrerevue.chargement'), autreRevueVide: T('doc.autrerevue.vide'),
    autreRevueArchive: T('doc.autrerevue.archive'), autreRevueIllisibles: T('doc.autrerevue.illisibles'),
    autreRevueEchec: T('doc.autrerevue.echec'),
    autreRevueRemplacer: T('doc.autrerevue.remplacer'), autreRevueRemplacerOui: T('doc.autrerevue.remplacer.oui'),
    autreRevueAnnuler: T('doc.autrerevue.annuler'), autreRevueFermer: T('doc.autrerevue.fermer'),
    autreRevueRempli: T('doc.autrerevue.rempli'),
    // Vue « Propositions » (media/_propositions.js).
    propVue: T('doc.prop.vue'), propTitreVue: T('doc.prop.titreVue'),
    propOngletTipUn: T('doc.prop.onglet.tip.un'), propOngletTipPlus: T('doc.prop.onglet.tip.plus'),
    propOngletTipAUn: T('doc.prop.onglet.tipA.un'),
    propOngletTipAPlus: T('doc.prop.onglet.tipA.plus'), propDontB: T('doc.prop.dontB'),
    propAVerifier: T('doc.prop.aVerifier'), propRefusee: T('doc.prop.refusee'),
    propColEtat: T('doc.prop.col.etat'), propColTitre: T('doc.prop.col.titre'),
    propColType: T('doc.prop.col.type'), propColPertinence: T('doc.prop.col.pertinence'),
    propColGestes: T('doc.prop.col.gestes'), propCaseTout: T('doc.prop.caseTout'),
    propCaseLigne: T('doc.prop.caseLigne'), propAccepter: T('doc.prop.accepter'),
    propAccepterCourt: T('doc.prop.accepter.court'), propAccepterTip: T('doc.prop.accepter.tip'),
    propGarder: T('doc.prop.garder'), propGarderCourt: T('doc.prop.garder.court'),
    propGarderTip: T('doc.prop.garder.tip'), propRefuser: T('doc.prop.refuser'),
    propRefuserTip: T('doc.prop.refuser.tip'), propMotifsTip: T('doc.prop.motifs.tip'),
    propMotifHorsSujet: T('doc.prop.motif.horsSujet'),
    propMotifDoublon: T('doc.prop.motif.doublon'), propMotifAutre: T('doc.prop.motif.autre'),
    propVerifier: T('doc.prop.verifier'), propVerifierTip: T('doc.prop.verifier.tip'),
    propAussiLabel: T('doc.prop.aussi.label'), propAussiTip: T('doc.prop.aussi.tip'),
    propAussiRetire: T('doc.prop.aussi.retire'), propVerifierDabord: T('doc.prop.verifierDabord'),
    propBloque: T('doc.prop.bloque'), propColonnes: T('doc.prop.colonnes'),
    propColonnesTip: T('doc.prop.colonnes.tip'), propColonneFixe: T('doc.prop.colonneFixe'),
    propRetablir: T('doc.prop.retablir'), propRetablirTip: T('doc.prop.retablir.tip'),
    propSeparateur: T('doc.prop.separateur'), propSeparateurTip: T('doc.prop.separateur.tip'),
    propListe: T('doc.prop.liste'), propListeTip: T('doc.prop.liste.tip'),
    propSuivante: T('doc.prop.suivante'), propSuivanteTip: T('doc.prop.suivante.tip'),
    propFermer: T('doc.prop.fermer'), propRaccourcis: T('doc.prop.raccourcis'),
    propRaccourcisDetail: T('doc.prop.raccourcis.detail'), propReprendre: T('doc.prop.reprendre'),
    propReprendreTip: T('doc.prop.reprendre.tip'), propSelectionUn: T('doc.prop.selection.un'),
    propSelectionPlus: T('doc.prop.selection.plus'),
    propAVerifierDabordUn: T('doc.prop.aVerifierDabord.un'),
    propAVerifierDabordPlus: T('doc.prop.aVerifierDabord.plus'),
    propAVerifierDabordTip: T('doc.prop.aVerifierDabord.tip'),
    propDeselectionner: T('doc.prop.deselectionner'), propAnnuler: T('doc.prop.annuler'),
    propAnnulerTip: T('doc.prop.annuler.tip'), propBAccepte: T('doc.prop.b.accepte'),
    propBGarde: T('doc.prop.b.garde'), propBRefuse: T('doc.prop.b.refuse'),
    propBRefuseMotif: T('doc.prop.b.refuseMotif'), propBLotAccepteUn: T('doc.prop.b.lotAccepte.un'),
    propBLotAcceptePlus: T('doc.prop.b.lotAccepte.plus'),
    propBLotGardeUn: T('doc.prop.b.lotGarde.un'), propBLotGardePlus: T('doc.prop.b.lotGarde.plus'),
    propBLotRefuseUn: T('doc.prop.b.lotRefuse.un'),
    propBLotRefusePlus: T('doc.prop.b.lotRefuse.plus'),
    propBLotRefuseMotifUn: T('doc.prop.b.lotRefuseMotif.un'),
    propBLotRefuseMotifPlus: T('doc.prop.b.lotRefuseMotif.plus'), propBAussi: T('doc.prop.b.aussi'),
    propBLotAussiUn: T('doc.prop.b.lotAussi.un'), propBLotAussiPlus: T('doc.prop.b.lotAussi.plus'),
    propBIgnoreesUn: T('doc.prop.b.ignorees.un'), propBIgnoreesPlus: T('doc.prop.b.ignorees.plus'),
    propBReprise: T('doc.prop.b.reprise'), propBAnnule: T('doc.prop.b.annule'),
    propBEchecUn: T('doc.prop.b.echec.un'), propBEchecPlus: T('doc.prop.b.echec.plus'),
    propVerrou: T('doc.prop.verrou'), propOuvrirSource: T('doc.prop.ouvrirSource'),
    propOuvrirSourceTip: T('doc.prop.ouvrirSource.tip'), propPosition: T('doc.prop.position'),
    propRecolteeLe: T('doc.prop.recolteeLe'), propProposerAussi: T('doc.prop.proposerAussi'),
    propProposerAussiTip: T('doc.prop.proposerAussi.tip'), propDoutes: T('doc.prop.doutes'),
    propDouteDateIllisible: T('doc.prop.doute.dateIllisible'),
    propDouteLangueDevinee: T('doc.prop.doute.langueDevinee'),
    propDouteCorrespondanceIncertaine: T('doc.prop.doute.correspondanceIncertaine'),
    propDouteValeurHorsListe: T('doc.prop.doute.valeurHorsListe'),
    propDouteChampIntrouvable: T('doc.prop.doute.champIntrouvable'),
    propDouteTexteTronque: T('doc.prop.doute.texteTronque'), propDoutePersonneNommee: T('doc.prop.doute.personneNommee'),
    propDouteSuggestion: T('doc.prop.doute.suggestion'), propDouteLu: T('doc.prop.doute.lu'),
    propDouteAbsent: T('doc.prop.doute.absent'), propLangue: T('doc.prop.langue'),
    propValeurs: T('doc.prop.valeurs'), propBrut: T('doc.prop.brut'),
    propBrutCle: T('doc.prop.brut.cle'), propBrutLien: T('doc.prop.brut.lien'),
    propDoublonTitre: T('doc.prop.doublon.titre'), propDoublonTexte: T('doc.prop.doublon.texte'),
    propDoublonIntrouvable: T('doc.prop.doublon.introuvable'),
    propDoublonSansNumero: T('doc.prop.doublon.sansNumero'),
    propDoublonChamp: T('doc.prop.doublon.champ'),
    propDoublonProposition: T('doc.prop.doublon.proposition'),
    propDoublonFiche: T('doc.prop.doublon.fiche'),
    propDoublonDiffere: T('doc.prop.doublon.differe'),
    propDoublonRefuser: T('doc.prop.doublon.refuser'),
    propDoublonRefuserTip: T('doc.prop.doublon.refuser.tip'),
    propRaisonDoute: T('doc.prop.raison.doute'), propRaisonRequis: T('doc.prop.raison.requis'),
    propRaisonFormat: T('doc.prop.raison.format'), propRaisonDoublon: T('doc.prop.raison.doublon'),
    propResumeB: T('doc.prop.resumeB'), propManque: T('doc.prop.manque'),
    propPertinenceRetenu: T('doc.prop.pertinence.retenu'),
    propPertinenceARelire: T('doc.prop.pertinence.aRelire'),
    propFiltrePertinence: T('doc.prop.filtrePertinence'), propToutes: T('doc.prop.toutes'),
    propAfficherRefusees: T('doc.prop.afficherRefusees'), propMoissonUn: T('doc.prop.moisson.un'),
    propMoissonPlus: T('doc.prop.moisson.plus'), propMoissonCourtUn: T('doc.prop.moissonCourt.un'),
    propMoissonCourtPlus: T('doc.prop.moissonCourt.plus'), propEchec: T('doc.prop.echec'),
    propVide: T('doc.prop.vide'), propVideMoissons: T('doc.prop.videMoissons'),
    propVideSans: T('doc.prop.videSans'), propVideAucune: T('doc.prop.videAucune'),
    propChargement: T('doc.prop.chargement'),
    propAppliquer: T('doc.prop.appliquer'), propAppliquerTip: T('doc.prop.appliquer.tip'),
    propChamps: T('doc.prop.champs'), propCouverture: T('doc.prop.couverture'),
    propIntrouvable: T('doc.prop.introuvable'),
    propRecreer: T('doc.prop.recreer'), propRecreerTip: T('doc.prop.recreer.tip'),
    propBRecree: T('doc.prop.b.recree'),
    // La finesse du tri.
    propFinesse: T('doc.prop.finesse'), propFinesseTresLarge: T('doc.prop.finesse.tresLarge'),
    propFinessePlusLarge: T('doc.prop.finesse.plusLarge'), propFinesseNormal: T('doc.prop.finesse.normal'),
    propFinesseStrict: T('doc.prop.finesse.strict'), propFinesseLecture: T('doc.prop.finesse.lecture'),
    propFinesseIdentique: T('doc.prop.finesse.identique'),
    propFinesseVisiblesUn: T('doc.prop.finesse.visibles.un'), propFinesseVisiblesPlus: T('doc.prop.finesse.visibles.plus'),
    propFinesseMasqueesUn: T('doc.prop.finesse.masquees.un'), propFinesseMasqueesPlus: T('doc.prop.finesse.masquees.plus'),
    propFinesseValeur: T('doc.prop.finesse.valeur'), propFinesseValeurIdentique: T('doc.prop.finesse.valeurIdentique'),
    propFinesseVoir: T('doc.prop.finesse.voir'), propFinesseCacher: T('doc.prop.finesse.cacher'),
    propFinesseVoirTip: T('doc.prop.finesse.voir.tip'), propFinesseAide: T('doc.prop.finesse.aide'),
    propFinesseParMois: T('doc.prop.finesse.parMois'), propFinesseRappel: T('doc.prop.finesse.rappel'),
    propFinesseRappelSans: T('doc.prop.finesse.rappelSans'), propFinesseCalcule: T('doc.prop.finesse.calcule'),
    propFinesseCommun: T('doc.prop.finesse.commun'), propFinesseNonCalibree: T('doc.prop.finesse.nonCalibree'), propFinesseRegle: T('doc.prop.finesse.regle'),
    propFinesseRegleAucun: T('doc.prop.finesse.regleAucun'), propFinesseIdentiqueTip: T('doc.prop.finesse.identiqueTip'),
    propFinesseApercu: T('doc.prop.finesse.apercu'), propFinesseGarder: T('doc.prop.finesse.garder'),
    propFinesseGarderTip: T('doc.prop.finesse.garder.tip'), propFinesseGarde: T('doc.prop.finesse.garde'),
    propFinesseMasquee: T('doc.prop.finesse.masquee'), propColCran: T('doc.prop.col.cran'),
    propCranTip: T('doc.prop.cran.tip'), propPourquoi: T('doc.prop.pourquoi'),
    propPourquoiNote: T('doc.prop.pourquoi.note'), propPourquoiSansNote: T('doc.prop.pourquoi.sansNote'),
    propPourquoiCategorie: T('doc.prop.pourquoi.categorie'),
    propRoleAncrage: T('doc.prop.role.ancrage'), propRoleAmbigu: T('doc.prop.role.ambigu'),
    propRoleEcole: T('doc.prop.role.ecole'), propRoleTheme: T('doc.prop.role.theme'),
    propOuTitre: T('doc.prop.ou.titre'), propOuTexte: T('doc.prop.ou.texte'), propOuExtrait: T('doc.prop.ou.extrait'),
    propCategorieTitre: T('doc.prop.categorie.titre'), propCategorieTexteDense: T('doc.prop.categorie.texte-dense'),
    propCategorieSignalFaible: T('doc.prop.categorie.signal-faible'), propCategorieEcole: T('doc.prop.categorie.ecole'),
    propCategorieTheme: T('doc.prop.categorie.theme'), propCategorieTexteLarge: T('doc.prop.categorie.texte-large'),
    propCategorieAutre: T('doc.prop.categorie.autre'),
    // Les propositions multilingues.
    propLanguesTip: T('doc.prop.langues.tip'), propTitreOfficiel: T('doc.prop.titreOfficiel'),
    propAutreGardee: T('doc.prop.b.autreGardee'),
    // L'onglet Termes, Pourquoi cliquable et les demandes sur le lexique.
    propTermesOnglet: T('doc.prop.termes.onglet'), propTermesMoissonneur: T('doc.prop.termes.moissonneur'),
    propTermesComptesAu: T('doc.prop.termes.comptesAu'), propTermesChercher: T('doc.prop.termes.chercher'),
    propTermesRole: T('doc.prop.termes.role'), propTermesLangue: T('doc.prop.termes.langue'),
    propTermesTous: T('doc.prop.termes.tous'), propTermesToutes: T('doc.prop.termes.toutes'),
    propTermesAjouter: T('doc.prop.termes.ajouter'), propTermesColTerme: T('doc.prop.termes.col.terme'),
    propTermesColLangue: T('doc.prop.termes.col.langue'), propTermesColRole: T('doc.prop.termes.col.role'),
    propTermesColRamene: T('doc.prop.termes.col.ramene'), propTermesColSeul: T('doc.prop.termes.col.seul'),
    propTermesColRef: T('doc.prop.termes.col.ref'), propTermesColRefSeul: T('doc.prop.termes.col.refSeul'),
    propTermesColDemande: T('doc.prop.termes.col.demande'), propTermesColGeste: T('doc.prop.termes.col.geste'),
    propTermesTipRamene: T('doc.prop.termes.tip.ramene'), propTermesTipSeul: T('doc.prop.termes.tip.seul'),
    propTermesTipRef: T('doc.prop.termes.tip.ref'), propTermesTipRefSeul: T('doc.prop.termes.tip.refSeul'),
    propTermesTrier: T('doc.prop.termes.trier'), propTermesLignes: T('doc.prop.termes.lignes'),
    propTermesAucun: T('doc.prop.termes.aucun'), propTermesPrecaution1: T('doc.prop.termes.precaution1'),
    propTermesPrecaution2: T('doc.prop.termes.precaution2'), propTermesApprox: T('doc.prop.termes.approx'),
    propTermesApproxTip: T('doc.prop.termes.approxTip'), propTermesVoir: T('doc.prop.termes.voir'),
    propTermesVoirTip: T('doc.prop.termes.voirTip'), propTermesMenu: T('doc.prop.termes.menu'),
    propTermesNePlus: T('doc.prop.termes.nePlus'), propTermesNePlusLabel: T('doc.prop.termes.nePlusLabel'),
    propTermesNePlusRef: T('doc.prop.termes.nePlusRef'), propTermesDemandee: T('doc.prop.termes.demandee'),
    propTermesMesure: T('doc.prop.termes.mesure'), propTermesMesureAu: T('doc.prop.termes.mesureAu'),
    propTermesAvertRefSeulUn: T('doc.prop.termes.avertRefSeul.un'), propTermesAvertRefSeulPlus: T('doc.prop.termes.avertRefSeul.plus'),
    propTermesInfo: T('doc.prop.termes.info'), propTermesDemander: T('doc.prop.termes.demander'),
    propTermesDemanderQuandMeme: T('doc.prop.termes.demanderQuandMeme'),
    propTermesFermer: T('doc.prop.termes.fermer'), propTermesEcrite: T('doc.prop.termes.ecrite'),
    propTermesRefus: T('doc.prop.termes.refus'), propTermesFiltre: T('doc.prop.termes.filtre'),
    propTermesRetirerFiltre: T('doc.prop.termes.retirerFiltre'), propTermesPourquoiAide: T('doc.prop.termes.pourquoiAide'),
    propTermesFormTitre: T('doc.prop.termes.form.titre'), propTermesFormTerme: T('doc.prop.termes.form.terme'),
    propTermesFormLangue: T('doc.prop.termes.form.langue'), propTermesFormSens: T('doc.prop.termes.form.sens'),
    propTermesFormAjout: T('doc.prop.termes.form.ajout'), propTermesFormExclusion: T('doc.prop.termes.form.exclusion'),
    propTermesFormEnvoyer: T('doc.prop.termes.form.envoyer'), propTermesFormAnnuler: T('doc.prop.termes.form.annuler'),
    propTermesFormAide: T('doc.prop.termes.form.aide'), propTermesErrVide: T('doc.prop.termes.err.vide'),
    propTermesErrLong: T('doc.prop.termes.err.long'), propTermesErrCaractere: T('doc.prop.termes.err.caractere'),
    propTermesErrDoublon: T('doc.prop.termes.err.doublon'), propTermesSensAjout: T('doc.prop.termes.sens.ajout'),
    propTermesSensExclusion: T('doc.prop.termes.sens.exclusion'), propTermesSensRetrait: T('doc.prop.termes.sens.retrait'),
    propStEnAttente: T('accueil.regl.moiss.st.en-attente'), propStApplique: T('accueil.regl.moiss.st.applique'),
    propStAppliquePartiel: T('accueil.regl.moiss.st.applique-partiel'), propStRefusePerte: T('accueil.regl.moiss.st.refuse-perte'),
    propStRefuseBruit: T('accueil.regl.moiss.st.refuse-bruit'), propStDoublon: T('accueil.regl.moiss.st.doublon'),
    propStAConfirmer: T('accueil.regl.moiss.st.a-confirmer'), propStRetraitEnAttente: T('accueil.regl.moiss.st.retrait-en-attente'),
    propFinesseDeMoissonneur: T('doc.prop.finesse.deMoissonneur')
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
  // resoudreAncrage rend des séparateurs Windows (normaliserSeparateursAncrage) : hors de
  // Windows (runner Linux de la CI), les remettre en « / » avant d'y joindre quoi que ce soit.
  const base = process.platform === 'win32' ? ancrage.chemin : String(ancrage.chemin).replace(/\\/g, '/');
  return path.join(base, '2_Produkte', rapportErreur.SEGMENT_APPLICATION);
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

// ---- La vue « Propositions » : ce que la page affiche, composé ici ------------------------
//
// Toute la logique (lots, décisions, cas A/B, ordre) vit dans lib/propositions.js ; ces
// fonctions ne font que la mettre en forme pour la page, dans la langue du numéro.

// Le réglage des colonnes de la vue, par type de fiche : propre au poste, jamais partagé.
const CLE_COLONNES_PROPOSITIONS = 'szh.propositions.colonnes';

function libelleMoissonneur(id) {
  const cle = 'doc.prop.moissonneur.' + id;
  return TEXTES_COCKPIT.fr[cle] !== undefined ? T(cle) : id;
}

// Les types de fiche tels que la vue les montre : libellé, colonnes de tri, et les libellés
// des jetons de liste, pour qu'une valeur se lise en clair.
function typesPropositions(langue) {
  return kirby.typesConnus().map((type) => {
    const def = kirby.definitionType(type) || {};
    const champs = kirby.champsDuType(type).map((c) => {
      const x = { cle: c.cle, libelle: c.libelle[langue] || c.libelle.fr, saisie: c.saisie };
      if (c.saisie === 'liste' || c.saisie === 'liste_multiple') {
        x.libelles = {};
        for (const v of kirby.valeursListe(c.liste)) { x.libelles[v.jeton] = v[langue] || v.fr; }
      }
      return x;
    });
    return {
      type: type, libelle: kirby.libelleCockpitType(type, langue),
      tri: (def.tri || ['title']).filter((k) => k !== 'title'),
      categorie: !!kirby.champDuType(type, 'categorie'), champs: champs
    };
  });
}

function etatsPropositions(etats) {
  return Object.keys(etats || {}).map((m) => {
    const e = etats[m] || {};
    return {
      moissonneur: m, libelle: libelleMoissonneur(m), connu: !!etats[m],
      derniere: String(e.derniere_moisson || ''), propositions: Number(e.propositions_ecrites) || 0,
      echecs: (Array.isArray(e.sources_en_echec) ? e.sources_en_echec : [])
        .map((x) => ({ source: String((x && x.source) || ''), raison: String((x && x.raison) || '') }))
    };
  });
}

// L'aperçu de la finesse : le cran que ce poste regarde, par langue et par type de fiche. Propre
// au poste, jamais partagé ; le réglage de la rédaction vit dans _Moissons\_Reglages.
const CLE_FINESSE_APERCU = 'szh.propositions.finesse';

function apercuFinesse(langue) {
  const etatPoste = ctx.etatPoste();
  const table = (etatPoste && etatPoste.globalState.get(CLE_FINESSE_APERCU)) || {};
  return Object.assign({}, table[langue] || {});
}
async function poserApercuFinesse(langue, typeFiche, cran) {
  const etatPoste = ctx.etatPoste();
  if (!etatPoste) { return; }
  const table = Object.assign({}, etatPoste.globalState.get(CLE_FINESSE_APERCU) || {});
  const l = Object.assign({}, table[langue] || {});
  if (cran) { l[typeFiche] = cran; } else { delete l[typeFiche]; }
  table[langue] = l;
  await etatPoste.globalState.update(CLE_FINESSE_APERCU, table);
}

// Qui règle la finesse pour la rédaction : le nom que la co-édition montre déjà aux autres
// postes (réglage szh.nomUtilisateur, sinon la session Windows), « — » à défaut.
function auteurPoste() {
  const nom = String(moiCoedition().utilisateur || '');
  return nom && nom !== 'inconnu' ? nom : '—';
}

// Le compte de l'entrée « Propositions » de l'arbre : ce que la personne voit, l'aperçu du
// poste s'il existe, sinon le réglage partagé.
function compterPropositionsVues(racineArbreVal, langue) {
  return propositions.compterVisibles(racineArbreVal, langue, apercuFinesse(langue));
}

// La finesse de chaque type qui a des crans dans cette langue : les moissonneurs qui le
// nourrissent, leurs crans (ceux du premier, rangé par nom), le réglage partagé et l'aperçu.
function finesseParType(racineArbreVal, langue, lu) {
  const vue = propositions.finessePourVue(racineArbreVal, langue, lu.etats, apercuFinesse(langue));
  const ap = apercuFinesse(langue);
  const res = {};
  for (const p of lu.propositions) {
    const m = p.dossier || p.moissonneur;
    if (!vue.crans[m]) { continue; }
    const f = res[p.type] = res[p.type] || { moissonneurs: [] };
    if (f.moissonneurs.indexOf(m) === -1) { f.moissonneurs.push(m); f.moissonneurs.sort(); }
  }
  // Ce que chaque moissonneur du type apporte : ses crans et son réglage. Une proposition se
  // juge sur ceux de son moissonneur ; le premier, rangé par nom, donne les champs du type.
  const deMoissonneur = (m, type) => {
    const e = lu.etats[m] || {};
    return {
      libelle: libelleMoissonneur(m), crans: vue.crans[m],
      source: String((e.crans_source || {})[langue] || ''),
      calculeLe: String(e.crans_calcules_le || ''),
      calibree: e.note_calibree === true,
      fenetre: e.crans_fenetre && typeof e.crans_fenetre === 'object'
        ? { du: String(e.crans_fenetre.du || ''), au: String(e.crans_fenetre.au || '') } : null,
      reglage: (vue.reglages[m] || {})[type] || null,
      cranDefaut: vue.defauts[m] || 1
    };
  };
  for (const type of Object.keys(res)) {
    const parMoissonneur = {};
    for (const m of res[type].moissonneurs) { parMoissonneur[m] = deMoissonneur(m, type); }
    const premier = parMoissonneur[res[type].moissonneurs[0]];
    Object.assign(res[type], {
      crans: premier.crans, source: premier.source, calculeLe: premier.calculeLe, fenetre: premier.fenetre,
      calibree: premier.calibree,
      reglage: premier.reglage, cranDefaut: premier.cranDefaut,
      apercu: Number.isInteger(ap[type]) ? ap[type] : null,
      parMoissonneur: parMoissonneur
    });
  }
  return { parType: res, vue: vue };
}

// Les comptes par terme de chaque moissonneur à termes, avec ses demandes sur le lexique.
function termesEtDemandes(racineArbreVal, langue, lu) {
  const termes = propositions.comptesTermes(racineArbreVal, langue, apercuFinesse(langue), lu);
  const demandes = {};
  for (const m of Object.keys(termes)) {
    termes[m].libelle = libelleMoissonneur(m);
    demandes[m] = propositions.listerDemandes(racineArbreVal, m).demandes;
  }
  return { termes: termes, demandes: demandes };
}

// Le filtre sur un terme, posé depuis la vue Termes : les cles de l'onglet de son type qui le portent.
function filtreServi(lu, filtre) {
  if (!filtre) { return null; }
  const duType = lu.propositions.filter((p) => p.type === filtre.typeFiche);
  return Object.assign({}, filtre, { cles: propositions.filtrerSurTerme(duType, filtre).map((p) => p.cle) });
}

// donneesPropositions(racineArbreVal, langue, revueJeton, resultat?, connues?, extra?) -> le message
// PROP_DONNEES. `connues` (une Map) retient les propositions servies, par cle. `extra` : { filtre,
// ongletDemande, demandeGeste }, ce que le panneau garde ou vient de faire.
function donneesPropositions(racineArbreVal, langue, revueJeton, resultat, connues, extra) {
  const x = extra || {};
  const lu = propositions.listerPropositions(racineArbreVal, langue);
  const finesse = finesseParType(racineArbreVal, langue, lu);
  const td = termesEtDemandes(racineArbreVal, langue, lu);
  if (connues) {
    connues.clear();
    for (const p of lu.propositions) { connues.set(p.cle, p); }
  }
  const pourVue = (p) => {
    const fiche = p.doublon ? propositions.ficheDoublon(racineArbreVal, p) : null;
    return {
      cle: p.cle, type: p.type, moissonneur: p.moissonneur, dossier: p.dossier || p.moissonneur, recolte: String(p.recolte || ''),
      // Les langues où elle se montre, et les titres officiels d'une proposition multilingue.
      langues: propositions.languesDe(p), titres: p.titres || null,
      source: String(p.cle).split(':')[1] || p.moissonneur,
      valeurs: p.valeurs || {}, doutes: Array.isArray(p.doutes) ? p.doutes : [], brut: p.brut || {},
      pertinence: p.pertinence || null, doublon: p.doublon || null, motif: p.motif || '',
      cas: p.cas, raisons: p.raisons, bloquants: propositions.bloquants(p),
      // Le cran le plus haut où elle reste visible (10 sans crans ou sans note).
      cranMax: propositions.cranMax(p, finesse.vue.crans[p.dossier || p.moissonneur] || null),
      // « Proposer aussi à l'autre revue » : cochée d'office pour la Confédération seule.
      aussi: (p.valeurs || {}).canton === 'CH',
      doublonFiche: fiche ? { valeurs: fiche.valeurs, numero: nomNumeroPour(racineArbreVal, fiche.ausgabe) } : null
    };
  };
  const etatPoste = ctx.etatPoste();
  const autre = kirby.autreRevue(revueJeton);
  const msg = {
    type: MSG.PROP_DONNEES, langue: langue, cible: kirby.autresLangues(langue)[0] || '',
    revueAutre: autre ? ctx.nomRevueAffiche(autre) : '',
    revue: ctx.nomRevueAffiche(revueJeton),
    finesse: finesse.parType,
    types: typesPropositions(langue),
    propositions: propositions.ordonner(lu.propositions, langue).map(pourVue),
    refusees: propositions.ordonner(propositions.listerRefusees(racineArbreVal, langue), langue).map(pourVue),
    etats: etatsPropositions(lu.etats),
    colonnes: (etatPoste && etatPoste.globalState.get(CLE_COLONNES_PROPOSITIONS)) || {},
    termes: td.termes, demandes: td.demandes, filtre: filtreServi(lu, x.filtre || null),
    regleTerme: propositions.REGLE_TERME
  };
  if (resultat) { msg.resultat = resultat; }
  if (x.ongletDemande) { msg.ongletDemande = x.ongletDemande; }
  if (x.demandeGeste) { msg.demandeGeste = x.demandeGeste; }
  return msg;
}

function htmlDocumentation(nonce) {
  return construireHtml('documentation', nonce, {
    cssPartage: ['_design.css', '_propositions.css'], jsPartage: ['_messages.js', '_fiche-doc.js', '_propositions.js'],
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
  const echec = (message) => repondrePanneau(panneau, { type: MSG.IMAGE_ERREUR, id: id, message: message });
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
    type: MSG.IMAGE_DEPOSEE, id: id, image: path.basename(cible).replace(/^[^_]*__/, ''),
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

// `onglet` : posé par les entrées de l'arbre (extension.js#_itemsActualite /
// _itemsDocumentationNumero, commande szh.ouvrirActualite) — l'un de 'numero'/'traductions'/
// 'reservoir'/'archive'/'propositions'. `categorie` n'a de sens que pour 'numero' : 'rubriques' ou l'un des
// types de fiche du contrat (ordreTypes) — une seule catégorie affichée à la fois, jamais un
// sommaire. Les deux sont absents (undefined) pour l'en-tête « ACTUALITÉ » et la commande
// szh.documentation : le formulaire s'ouvre alors sur sa vue par défaut (webview) / celle
// déjà affichée si le panneau vit déjà.
async function ouvrirPageDocumentation(fournisseur, rafraichirTout, onglet, categorie) {
  if (!fournisseur.racine) { return; }
  if (!profils.courant().capacites.documentation) { return; }   // un livre n'a pas de Documentation
  let slug = fournisseur.slugDocumentation();
  if (!slug) {
    if (refuserSiVerrouille()) { return; }
    slug = creerPageDocumentation(fournisseur);
    if (!slug) { return; }
    if (rafraichirTout) { rafraichirTout(); }
  }
  await ouvrirDocumentation(fournisseur, rafraichirTout, slug, onglet, categorie);
}

// Le compte de l'entrée Archive dans l'arbre (extension.js#_itemsActualite) : jamais une
// lecture à part de la bibliothèque de production pour l'arbre — repris du dernier
// ARCHIVE_CHARGER/ARCHIVE_ACTUALISER servi à un panneau, quel qu'il soit. `undefined` tant
// qu'aucun panneau n'a encore chargé cet onglet : l'arbre n'affiche alors aucun badge. Une
// seule variable de module : un numéro ouvert par fenêtre VSCodium, pas de table par racine.
let dernierCompteArchive;

// « Ouvrir Propositions › Termes » vers un panneau déjà ouvert : par slug, de quoi lui pousser
// l'onglet demandé avec ses données (la page ne relaie à la vue que PROP_DONNEES).
const pousseursOnglet = new Map();
// La catégorie « _termes:<moissonneur> » de szh.ouvrirActualite('propositions', …).
function ongletTermesDemande(onglet, categorie) {
  const m = /^_termes(?::(.*))?$/.exec(String(categorie || ''));
  return onglet === 'propositions' && m ? { onglet: '_termes', moissonneur: m[1] || '' } : null;
}
function compteArchiveConnu() { return dernierCompteArchive; }

// Un formulaire par unité, sous viewType 'szhDocumentation' et le slug pour clé
// (lib/webviews/panneau.js).
function fermerPanneauxDocumentationDe(racine, slug) {
  fermerPanneaux('szhDocumentation', (!racine || !slug) ? undefined : slug);
}

async function ouvrirDocumentation(fournisseur, rafraichirTout, slug, onglet, categorie) {
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

  const existant = revelerPanneau({ viewType: 'szhDocumentation', cle: slug });
  if (existant) {
    // Le panneau vit déjà : le premier chargement (charger.vueInitiale) est passé depuis
    // longtemps, la bascule passe donc par ce message dédié — jamais en reconstruisant
    // « charger », qui rejouerait un rechargement complet pour un simple changement de vue.
    if (onglet) { repondrePanneau(existant, { type: MSG.ONGLET_ACTIVER, cle: onglet, categorie: categorie }); }
    const demandeTermes = ongletTermesDemande(onglet, categorie);
    if (demandeTermes && pousseursOnglet.has(slug)) { pousseursOnglet.get(slug)(demandeTermes); }
    return;
  }
  await fermerTousLesApercus();
  const titrePanneau = T('doc.titre.page');
  // Toute image déposée dans cette session et jamais réclamée par une fiche enregistrée
  // (carte retirée avant sauvegarde, panneau fermé sans enregistrer) doit être nettoyée : le
  // dépôt vit hors bibliothèque (os.tmpdir()), mais rien n'empêche qu'il s'accumule.
  const idsImagesEnAttente = new Set();
  // Les gestionnaires ne sont appelés qu'une fois cette fonction finie : ils peuvent lire
  // les fonctions déclarées plus bas.
  const { panneau } = panneauUnique({
    viewType: 'szhDocumentation', cle: slug, titre: titrePanneau, retenir: true,
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlDocumentation,
    surPret: (msg) => traiterPret(msg),
    surMessage: (msg) => traiterMessage(msg),
    surFermeture: () => {
      pousseursOnglet.delete(slug);
      for (const id of idsImagesEnAttente) { kirby.nettoyerImageProvisoire(id); }
      idsImagesEnAttente.clear();
    }
  });
  // Le bouton « Aperçu du PDF » peut se désynchroniser si l'aperçu se ferme à la croix
  // pendant que ce panneau est en arrière-plan (un aperçu fermé ne le dit à personne
  // d'autre que lui-même) : à chaque fois que ce panneau redevient actif, l'état réel est
  // renvoyé — sans ça, rien d'autre ne préviendrait la page.
  panneau.onDidChangeViewState((e) => {
    if (e && e.webviewPanel && e.webviewPanel.active) {
      repondrePanneau(panneau, { type: MSG.APERCU_ETAT, ouvert: ctx.apercuOuvert(racine, slug) });
    }
  });

  // uuid -> slug, pour les fiches DE CE NUMÉRO — reconstruit à chaque charger() : c'est ce
  // qui permet à enregistrer()/retirer() de retrouver le dossier d'une fiche existante sans
  // parcourir toute la bibliothèque à chaque frappe.
  let slugParUuid = new Map();
  // onglet/categorie ne doivent atteindre la page QU'à son tout premier chargement (charger.
  // vueInitiale, lu une fois par media/documentation.js) : un rechargement complet plus
  // tard (RETIRER, TRADUIRE_DANS_NUMERO…) ne doit jamais reposer l'utilisateur sur cette vue,
  // sans quoi « la vue choisie survit à un rechargement complet » (media/documentation.js)
  // ne serait plus vrai pour cette toute première vue.
  let premierPret = true;
  // Les propositions servies à la vue, par cle : le détail les vérifie à chaque saisie sans
  // relire les lots.
  const propositionsConnues = new Map();
  // Le filtre sur un terme tient jusqu'à ce qu'on le retire ; l'onglet Termes demandé part une fois.
  let filtreTerme = null;
  let ongletDemande = ongletTermesDemande(onglet, categorie);
  const donneesProp = (resultat, extra) => {
    const x = Object.assign({ filtre: filtreTerme, ongletDemande: ongletDemande }, extra || {});
    ongletDemande = null;
    return donneesPropositions(racineArbreVal, langue, revueJeton, resultat, propositionsConnues, x);
  };
  pousseursOnglet.set(slug, (demande) => repondrePanneau(panneau, donneesProp(null, { ongletDemande: demande })));

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
      type: MSG.CHARGER, slug: slug,
      ressources: listerRessources(budget),
      rubriques: listerRubriques(),
      typesConfig: typesRessourceConfig(langue, revueJeton),
      typesRubrique: typesRubriqueConfig(revueJeton, langue),
      traductions: listerTraductions(),
      reservoirNumeros: listerReservoirNumeros(),
      reservoir: listerReservoirEntrees(false),
      orphelines: listerMesOrphelines(),
      accent: ctx.lireCouleurAccent(racine),
      i18n: textesDocumentation(),
      limites: ctx.limitesMedias(),
      // L'état du bouton « Aperçu du PDF » : recalculé à CHAQUE chargement (jamais mémorisé
      // ici), pour rester vrai même si l'aperçu a été fermé à la croix entre-temps.
      apercuOuvert: ctx.apercuOuvert(racine, slug)
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

  // Un geste de la vue Propositions : accepter (dans ce numéro ou au réservoir), refuser, ou
  // défaire un geste entier. La vue repart avec le résultat, l'arbre suit.
  async function traiterGesteProposition(msg) {
    const refusVerrou = (geste) => repondrePanneau(panneau,
      donneesProp({ geste: geste, refus: 'verrou', faites: [], ignorees: [], echecs: [] }));
    let resultat;
    let recharger = false;
    if (msg.type === MSG.PROP_ACCEPTER) {
      const dansNumero = !!msg.dansNumero;
      const geste = dansNumero ? 'accepte' : 'garde';
      if (dansNumero && refuserSiVerrouille()) { refusVerrou(geste); return; }
      resultat = Object.assign({ geste: geste }, propositions.accepterLot(racineArbreVal, langue, msg.demandes,
        { ausgabeId: dansNumero ? ausgabeId : '', depuisDetail: !!msg.depuisDetail }));
      recharger = resultat.faites.length > 0;
    } else if (msg.type === MSG.PROP_RECREER) {
      // L'acceptation vient d'échouer à créer la fiche : la recréer dans ce numéro, avec l'Uuid
      // de sa décision. recreerFiche refuse si la fiche existe ou si rien n'est accepté.
      if (refuserSiVerrouille()) { refusVerrou('recree'); return; }
      const cle = String(msg.cle || '');
      const p = propositions.lireProposition(racineArbreVal, cle);
      const r = p && propositions.languesDe(p).indexOf(langue) !== -1
        ? propositions.recreerFiche(racineArbreVal, cle, p, msg.valeurs, { ausgabeId: ausgabeId, langue: langue })
        : { ok: false, raison: 'pas-acceptee' };
      resultat = { geste: 'recree', faites: r.ok ? [cle] : [], ignorees: [], echecs: r.ok ? [] : [{ cle: cle, raison: r.raison }] };
      recharger = r.ok;
    } else if (msg.type === MSG.PROP_REFUSER) {
      const motif = propositions.MOTIFS_REFUS.indexOf(msg.motif) !== -1 ? msg.motif : '';
      resultat = Object.assign({ geste: 'refuse', motif: motif },
        propositions.refuserLot(racineArbreVal, langue, msg.cles, motif));
    } else {
      // Défaire une acceptation retire la fiche créée, peut-être de ce numéro.
      const cles = Array.isArray(msg.cles) ? msg.cles.map(String) : [];
      const acceptation = cles.some((c) => {
        const d = propositions.lireDecision(racineArbreVal, c);
        return d && d.decision === 'accepte';
      });
      if (acceptation && refuserSiVerrouille()) { refusVerrou('annule'); return; }
      resultat = Object.assign({ geste: 'annule' }, propositions.annulerLot(racineArbreVal, cles, langue));
      recharger = resultat.fichesSupprimees > 0;
    }
    if (recharger) { await charger(panneau); }
    repondrePanneau(panneau, donneesProp(resultat));
    if (rafraichirTout) { rafraichirTout(); }
  }

  // Une fiche née d'une proposition multilingue : sa traduction part du titre officiel de
  // cette langue, gardé dans la décision, plutôt que du titre de l'autre langue.
  function prendreTitreOfficiel(slug, uuid) {
    const titres = propositions.titresOfficielsDeFiche(racineArbreVal, uuid);
    if (!titres || !titres[langue]) { return; }
    const f = kirby.lireFicheSlugLangue(racineArbreVal, slug, langue);
    if (!f) { return; }
    kirby.enregistrerFicheLangue(racineArbreVal, slug, langue, f.type, Object.assign({}, f.valeurs, { title: titres[langue] }));
  }

  // Le dernier « Garder » de ce panneau, que « Annuler » défait : { typeFiche, avant, apercu }.
  let dernierGarde = null;
  // Rend le message à renvoyer à la page, ou null pour un message refusé.
  async function traiterFinesse(msg) {
    const typeFiche = String(msg.typeFiche || '');
    if (!kirby.typeConnu(typeFiche)) { return null; }
    const lu = propositions.listerPropositions(racineArbreVal, langue);
    const f = finesseParType(racineArbreVal, langue, lu).parType[typeFiche];
    if (msg.type === MSG.PROP_FINESSE_APERCU) {
      const cran = Number(msg.cran);
      if (!f || !Number.isInteger(cran) || cran < 1 || cran > propositions.NB_CRANS) { return null; }
      // Un aperçu égal au réglage effectif (partagé, sinon cran par défaut) n'est plus un aperçu :
      // le poste suit la rédaction.
      await poserApercuFinesse(langue, typeFiche, cran === (f.reglage ? f.reglage.cran : f.cranDefaut) ? null : cran);
      return donneesProp();
    }
    if (msg.type === MSG.PROP_FINESSE_GARDER) {
      if (!f || f.apercu === null) { return null; }
      const avant = {};
      const par = auteurPoste();
      for (const m of f.moissonneurs) {
        avant[m] = (propositions.lireReglages(racineArbreVal, langue)[m] || {})[typeFiche] || null;
        propositions.ecrireReglage(racineArbreVal, langue, m, typeFiche, f.apercu, par);
      }
      dernierGarde = { typeFiche: typeFiche, avant: avant, apercu: f.apercu };
      await poserApercuFinesse(langue, typeFiche, null);
      return Object.assign(donneesProp(), { finesseGeste: { geste: 'garde', typeFiche: typeFiche, cran: dernierGarde.apercu } });
    }
    if (!dernierGarde || dernierGarde.typeFiche !== typeFiche) { return null; }
    for (const m of Object.keys(dernierGarde.avant)) {
      propositions.retablirReglage(racineArbreVal, langue, m, typeFiche, dernierGarde.avant[m]);
    }
    await poserApercuFinesse(langue, typeFiche, dernierGarde.apercu);
    dernierGarde = null;
    return Object.assign(donneesProp(), { finesseGeste: { geste: 'annule', typeFiche: typeFiche } });
  }

  async function traiterPret(msg) {
    const extra = { requete: msg.requete };
    if (premierPret && onglet) { extra.vueInitiale = { onglet: onglet, categorie: categorie }; }
    premierPret = false;
    await charger(panneau, extra);
  }

  async function traiterMessage(msg) {
    if (msg.type === MSG.MODIFIE) {
      panneau.title = (msg.modifie ? '● ' : '') + titrePanneau;
      return;
    }
    if (msg.type === MSG.ENREGISTRER) {
      const resultat = await enregistrer(msg.ressources, msg.rubriques);
      repondrePanneau(panneau, { type: MSG.ENREGISTRE, auto: !!msg.auto, correspondances: resultat.correspondances });
      if (resultat.total > 0 && !msg.auto) { vscode.window.setStatusBarMessage(T('doc.statut.enregistres', [resultat.total]), 5000); }
      // L'aperçu ouvert (bouton « Aperçu du PDF ») se rafraîchit tout seul — jamais attendu :
      // une compilation ne doit pas retarder la confirmation d'enregistrement. Rien à faire
      // si rien n'a changé (résultat.total === 0), ni si aucun aperçu de CE slug n'est ouvert
      // (ctx.rafraichirApercuSiOuvert le vérifie lui-même).
      if (resultat.total > 0) { ctx.rafraichirApercuSiOuvert(fournisseur, slug).catch(() => { /* signalé côté build */ }); }
      return;
    }
    // Le bouton « Aperçu du PDF » : bascule (ouvre en compilant toujours, ou ferme), puis
    // l'état réel est renvoyé — jamais optimiste côté page, l'ouverture peut échouer
    // (verrou, numéro gelé) sans qu'aucune exception ne remonte ici.
    if (msg.type === MSG.APERCU_BASCULER) {
      await ctx.basculerApercu(fournisseur, slug);
      repondrePanneau(panneau, { type: MSG.APERCU_ETAT, ouvert: ctx.apercuOuvert(racine, slug) });
      return;
    }
    // Retirer une fiche du numéro = la rendre orpheline (Ausgabe vidé) — jamais une
    // suppression. Une rubrique vidée, elle, reste dans le fichier de page : c'est
    // enregistrer() qui la vide, pas ce message (voir le formulaire).
    if (msg.type === MSG.RETIRER) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: MSG.ERREUR, message: T('verrou.refuse') });
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
    // Supprimer pour de bon une carte de « Documentation du numéro », rattachée ou non —
    // geste DISTINCT de RETIRER (qui ne fait que la détacher). N'ôte que le fichier de la
    // langue du numéro ; si l'autre langue existe, elle reste (la confirmation le dit). Une
    // carte jamais enregistrée n'atteint jamais l'hôte (voir supprimerFicheCarte, media/
    // documentation.js) : id est ici toujours un Uuid Kirby réel.
    if (msg.type === MSG.SUPPRIMER_FICHE_NUMERO) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: MSG.ERREUR, message: T('verrou.refuse') });
        return;
      }
      const id = String(msg.id || '');
      if (id === '') { return; }
      const slugCible = slugParUuid.get(id);
      if (!slugCible) { return; }               // déjà partie : rien à faire
      const reponse = await vscode.window.showWarningMessage(
        T('ressource.supprimerNumero.question'), { modal: true }, T('modale.supprimer.bouton'));
      if (reponse !== T('modale.supprimer.bouton')) { return; }
      const r = kirby.supprimerFicheLangue(racineArbreVal, slugCible, langue);
      if (r.ok) {
        kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId);
        vscode.window.setStatusBarMessage(T('ressource.supprimee'), 5000);
        await charger(panneau);
        if (rafraichirTout) { rafraichirTout(); }
      }
      return;
    }
    if (msg.type === MSG.DEPOSER_IMAGE) {
      if (refuserSiVerrouille()) {
        repondrePanneau(panneau, { type: MSG.IMAGE_ERREUR, id: msg.id, message: T('verrou.refuse') });
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
        prendreTitreOfficiel(slugCible, r.uuid);
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
        type: MSG.RESERVOIR, avecIgnorees: !!msg.avecIgnorees,
        entrees: listerReservoirEntrees(!!msg.avecIgnorees)
      });
      return;
    }
    // Onglet Archive : lu à la demande seulement (ARCHIVE_CHARGER — première ouverture de
    // l'onglet — ou ARCHIVE_ACTUALISER — bouton « Actualiser »), jamais à charger(). Pas de
    // garde de verrou : c'est une LECTURE de la bibliothèque de production, jamais du numéro
    // ouvert. Le compte obtenu ici alimente aussi le badge de l'entrée Archive dans l'arbre
    // (compteArchiveConnu, plus bas) — jamais une lecture à part pour l'arbre.
    if (msg.type === MSG.ARCHIVE_CHARGER || msg.type === MSG.ARCHIVE_ACTUALISER) {
      const reponse = construireReponseArchive();
      repondrePanneau(panneau, reponse);
      if (reponse.ok) {
        const change = dernierCompteArchive !== reponse.fiches.length;
        dernierCompteArchive = reponse.fiches.length;
        if (change && rafraichirTout) { rafraichirTout(); }
      }
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
    // Vue « Propositions ». La lecture est demandée par la page, puis renvoyée après chaque
    // geste avec son résultat. Un geste qui crée ou retire une fiche recharge aussi la
    // Documentation du numéro (charger) ; la page enregistre d'abord ses cartes modifiées, que
    // ce rechargement perdrait, et n'envoie le geste qu'à l'accusé.
    if (msg.type === MSG.PROP_CHARGER) {
      repondrePanneau(panneau, donneesProp());
      return;
    }
    // Le détail demande ce qui bloque l'acceptation de sa saisie : la règle reste ici.
    if (msg.type === MSG.PROP_VERIFIER) {
      const cle = String(msg.cle || '');
      // Une proposition qui n'est plus en attente n'a plus que sa fiche à recréer : ses doutes
      // ont été confirmés à l'acceptation, seul le format compte.
      const enAttente = propositionsConnues.get(cle);
      const decision = enAttente ? null : propositions.lireDecision(racineArbreVal, cle);
      const p = enAttente || (decision && decision.decision === 'accepte' ? propositions.lireProposition(racineArbreVal, cle) : null);
      const valeurs = msg.valeurs && typeof msg.valeurs === 'object' && !Array.isArray(msg.valeurs) ? msg.valeurs : {};
      const touches = (Array.isArray(msg.touches) ? msg.touches.map(String) : [])
        .concat(p && !enAttente ? (p.doutes || []).map((d) => String((d && d.champ) || '')) : []);
      repondrePanneau(panneau, { type: MSG.PROP_VERIFIE, cle: cle, jeton: msg.jeton,
        bloquants: p ? propositions.bloquants(p, valeurs, touches) : [{ code: 'deja-decidee', champ: null }] });
      return;
    }
    if (msg.type === MSG.PROP_ACCEPTER || msg.type === MSG.PROP_REFUSER || msg.type === MSG.PROP_ANNULER
      || msg.type === MSG.PROP_RECREER) {
      // La page attend toujours une réponse avant un autre geste : une erreur la lui donne aussi.
      try { await traiterGesteProposition(msg); }
      catch (e) {
        repondrePanneau(panneau, donneesProp(
          { geste: '', faites: [], ignorees: [], echecs: [{ cle: '', raison: String((e && e.message) || e) }] }));
      }
      return;
    }
    if (msg.type === MSG.PROP_COLONNES) {
      const etatPoste = ctx.etatPoste();
      const typeFiche = String(msg.typeFiche || '');
      if (!etatPoste || !kirby.typeConnu(typeFiche)) { return; }
      const table = Object.assign({}, etatPoste.globalState.get(CLE_COLONNES_PROPOSITIONS) || {});
      if (msg.reglage) { table[typeFiche] = msg.reglage; } else { delete table[typeFiche]; }
      await etatPoste.globalState.update(CLE_COLONNES_PROPOSITIONS, table);
      return;
    }
    // La finesse du tri : l'aperçu reste sur ce poste ; « Garder » l'écrit pour la rédaction.
    if (msg.type === MSG.PROP_FINESSE_APERCU || msg.type === MSG.PROP_FINESSE_GARDER
      || msg.type === MSG.PROP_FINESSE_ANNULER) {
      const reponse = await traiterFinesse(msg);
      if (!reponse) { return; }
      repondrePanneau(panneau, reponse);
      if (rafraichirTout) { rafraichirTout(); }
      return;
    }
    // Les termes : un filtre de l'onglet d'un type, gardé par le panneau ; une demande sur le
    // lexique, écrite au nom du poste. La règle et la validation restent dans lib/propositions.js.
    if (msg.type === MSG.PROP_FILTRE_TERME) {
      const typeFiche = String(msg.typeFiche || '');
      const terme = typeof msg.terme === 'string' ? msg.terme : '';
      filtreTerme = terme && kirby.typeConnu(typeFiche)
        ? { typeFiche: typeFiche, terme: terme, role: String(msg.role || ''), langue: String(msg.langue || '') } : null;
      repondrePanneau(panneau, donneesProp());
      return;
    }
    if (msg.type === MSG.PROP_DEMANDE_ECRIRE) {
      const moissonneur = String(msg.moissonneur || '');
      const sens = msg.sens === 'ajout' ? 'ajout' : msg.sens === 'exclusion' ? 'exclusion' : '';
      const r = propositions.ecrireDemande(racineArbreVal, moissonneur,
        { terme: msg.terme, langue: String(msg.langue || ''), sens: sens, par: auteurPoste() });
      const geste = { ok: r.ok, moissonneur: moissonneur, terme: String(msg.terme || ''), langue: String(msg.langue || ''), sens: sens };
      if (!r.ok) { geste.raison = r.raison; if (r.caractere) { geste.caractere = r.caractere; } }
      repondrePanneau(panneau, donneesProp(null, { demandeGeste: geste }));
      return;
    }
    // Le lien vient du lot, jamais de la page : la page ne désigne que la proposition.
    if (msg.type === MSG.PROP_OUVRIR_SOURCE) {
      const cible = String(msg.cle || '');
      const p = propositions.listerPropositions(racineArbreVal, langue).propositions
        .concat(propositions.listerRefusees(racineArbreVal, langue)).find((x) => x.cle === cible);
      const url = p ? String(p.lien_source || '') : '';
      if (/^https?:\/\//i.test(url)) { await vscode.env.openExternal(vscode.Uri.parse(url)); }
      return;
    }
    // L'aperçu de la date imprimée, dans la langue du numéro : une lecture, donc pas de garde
    // de verrou.
    // Les articles de l'autre revue, dans la racine active : une lecture, demandée une fois
    // par panneau, au premier clic.
    if (msg.type === MSG.DOC_AUTREREVUE_CHARGER) {
      let reponse;
      try {
        reponse = Object.assign({ ok: true }, autreRevue.articlesAutreRevue(racineArbreVal, revueJeton, langue));
      } catch (e) {
        reponse = { ok: false, numeros: [], illisibles: 0 };
      }
      repondrePanneau(panneau, Object.assign({ type: MSG.DOC_AUTREREVUE_DONNEES }, reponse));
      return;
    }
    if (msg.type === MSG.DOC_DATE_FORMER) {
      const r = await dateApercu.former({ saisie: msg.saisie, lang: langue, valeurs: msg.valeurs });
      repondrePanneau(panneau, Object.assign({ type: MSG.DOC_DATE_FORMEE, jeton: msg.jeton }, r));
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
  }
}

module.exports = {
  configurer,
  ouvrirDocumentation, ouvrirPageDocumentation, fermerPanneauxDocumentationDe,
  dossierArticleDoc, compteArchiveConnu, compterPropositionsVues,
  // Les fabriques de libellés du formulaire, exposées pour le contrôle. Elles ne sont pas
  // pures — elles lisent la langue et le contrat — et c'est précisément ce qu'il faut
  // éprouver : test/js/actualite.test.js les appelle dans les deux langues et exige que
  // tout diffère.
  _libelles: { textesDocumentation, typesRessourceConfig, typesRubriqueConfig, optionsInstrument }
};
