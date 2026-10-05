// Ce que l'hôte de l'Accueil envoie à sa page (media/accueil.js) et que l'aperçu hors éditeur
// rejoue : les libellés, le nom de chaque produit et le produit ouvert d'office.
'use strict';

const { T, TP } = require('./i18n');
const profils = require('./profil');

// Les libellés de la page, injectés dans __TXT__. Trois d'entre eux ont une variante « .livre », choisie
// d'après le produit ouvert dans la fenêtre : un livre ne parle ni d'article ni de numéro.
function textesAccueil() {
  return {
    ongletsAria: T('accueil.onglets'),
    ongletProduits: T('accueil.onglet.produits'), ongletNouveau: T('accueil.onglet.nouveau'),
    ongletPreproc: T('accueil.preproc'), ongletSecretariat: T('accueil.secretariat'),
    ongletReglages: T('accueil.reglages'), ongletJournal: T('accueil.journal'),
    annuler: T('accueil.annuler'), modeTest: T('accueil.modetest'),

    prodChoix: T('accueil.produits.choix'), prodEnCours: T('accueil.produits.encours'),
    prodArchives: T('accueil.produits.archives'), prodArchivesVide: T('accueil.produits.archives.vide'),
    prodVide: T('accueil.produits.vide'), prodCreer: T('accueil.produits.creer'),
    prodDernier: T('accueil.produits.dernier'), prodVerrouille: T('accueil.produits.verrouille'),
    prodModifie: T('accueil.produits.modifie'), prodAstuce: T('accueil.produits.astuce'),
    prodOuvrir: T('accueil.produits.ouvrir'), prodDans: T('accueil.produits.dans'),
    prodVersion: T('accueil.produits.version'), prodVersionInconnue: T('accueil.produits.version.inconnue'),
    prodVersions: T('accueil.produits.versions'), ancrageAbsent: T('accueil.produits.ancrage'),
    prodHorsUn: T('accueil.produits.hors.un'), prodHorsPlus: T('accueil.produits.hors.plus'),

    nvAnnee: T('accueil.nouveau.annee'), nvNumero: T('accueil.nouveau.numero'),
    nvNumeroHors: T('accueil.nouveau.numero.hors'), nvVolume: T('accueil.nouveau.volume'),
    nvVolumeLibelle: T('accueil.nouveau.volume.libelle'), nvVolumeManuel: T('accueil.nouveau.volume.manuel'),
    nvVolumeAuto: T('accueil.nouveau.volume.auto'), nvDossier: T('accueil.nouveau.dossier'),
    nvOu: T('accueil.nouveau.ou'), nvExiste: T('accueil.nouveau.existe'),
    nvTitre: T('accueil.nouveau.titre'), nvReference: T('accueil.nouveau.reference'),
    nvReferencePrise: T('accueil.nouveau.reference.prise'), nvType: T('accueil.nouveau.type'),
    nvTypeMono: T('accueil.nouveau.type.mono'), nvTypeCollectif: T('accueil.nouveau.type.collectif'),
    nvMaquette: T('accueil.nouveau.maquette'), nvMaquetteNormal: T('accueil.nouveau.maquette.normal'),
    nvMaquetteFalc: T('accueil.nouveau.maquette.falc'), nvFormat: T('accueil.nouveau.format'),
    nvFormatStandard: T('accueil.nouveau.format.standard'), nvFormatA4: T('accueil.nouveau.format.a4'),
    nvCreer: T('accueil.nouveau.creer'), nvRefus: T('accueil.nouveau.refus'),

    ppIntro: T('accueil.preproc.intro'), ppDeposer: T('accueil.preproc.deposer'), ppOu: T('accueil.preproc.ou'),
    ppChoisir: T('accueil.preproc.choisir'), ppOptions: T('accueil.preproc.options'),
    ppFormat: T('accueil.preproc.format'), ppFormatDocx: T('accueil.preproc.format.docx'),
    ppFormatOdt: T('accueil.preproc.format.odt'), ppCompteurs: T('accueil.preproc.compteurs'),
    ppDepotFormat: T('accueil.preproc.depot.format'), ppDepotTaille: T('accueil.preproc.depot.taille'),
    ppEnCours: T('accueil.preproc.encours'), ppEnCoursProduit: T('accueil.preproc.encours.produit'),
    ppEtape: T('accueil.preproc.etape'),
    ppEtapePreparation: T('accueil.preproc.etape.preparation'), ppEtapeLecture: T('accueil.preproc.etape.lecture'),
    ppEtapeEntete: T('accueil.preproc.etape.entete'), ppEtapeIdentifiants: T('accueil.preproc.etape.identifiants'),
    ppEtapeTitres: T('accueil.preproc.etape.titres'), ppEtapeFormatage: T('accueil.preproc.etape.formatage'),
    ppEtapeTypographie: T('accueil.preproc.etape.typographie'), ppEtapeRegles: T('accueil.preproc.etape.regles'),
    ppEtapeBibliographie: T('accueil.preproc.etape.bibliographie'), ppEtapeEcriture: T('accueil.preproc.etape.ecriture'),
    ppEtapeAnnotation: T('accueil.preproc.etape.annotation'), ppEtapeRapport: T('accueil.preproc.etape.rapport'),
    ppInterrompre: T('accueil.preproc.interrompre'), ppReussi: T('accueil.preproc.reussi'),
    ppReussiAlertes: T('accueil.preproc.reussi.alertes'), ppRapportOuvert: T('accueil.preproc.rapport.ouvert'),
    ppAucuneAlerte: T('accueil.preproc.alertes.aucune'),
    ppErreursUn: T('accueil.preproc.erreurs.un'), ppErreursPlus: T('accueil.preproc.erreurs.plus'),
    ppAvertissementsUn: T('accueil.preproc.avertissements.un'),
    ppAvertissementsPlus: T('accueil.preproc.avertissements.plus'),
    ppSuggestionsUn: T('accueil.preproc.suggestions.un'), ppSuggestionsPlus: T('accueil.preproc.suggestions.plus'),
    ppOuvrirDocument: T('accueil.preproc.ouvrir.document'), ppOuvrirRapport: T('accueil.preproc.ouvrir.rapport'),
    ppAfficher: T('accueil.preproc.afficher'), ppRefus: T('accueil.preproc.refus'),
    ppEchec: T('accueil.preproc.echec'), ppInterrompu: T('accueil.preproc.interrompu'),

    secNewsletter: T('accueil.secretariat.newsletter'), secNewsletterAide: T('accueil.secretariat.newsletter.aide'),
    secMetadonnees: T('accueil.secretariat.metadonnees'), secMetadonneesAide: T('accueil.secretariat.metadonnees.aide'),
    secEdudoc: T('accueil.secretariat.edudoc'), secEdudocAide: T('accueil.secretariat.edudoc.aide'),
    secCaracteres: T('accueil.secretariat.caracteres'), secCaracteresAide: T('accueil.secretariat.caracteres.aide'),
    secTrimestriels: T('accueil.secretariat.trimestriels'), secNumero: T('accueil.secretariat.numero'),
    secOption: T('accueil.secretariat.option'), secCreer: T('accueil.secretariat.creer'),
    secControler: T('accueil.secretariat.controler'), secExporter: T('accueil.secretariat.exporter'),
    secModifier: T('accueil.secretariat.modifier'), secCasesLegende: T('accueil.secretariat.cases'),
    secNumeroCourt: T('accueil.secretariat.numero.court'), secDejaExporte: T('accueil.secretariat.deja'),
    secAnneePlus: T('accueil.secretariat.annee.plus'), secFinCourse: T('accueil.secretariat.fincourse'),
    secChargement: T('accueil.secretariat.chargement'), secChargementEchec: T('accueil.secretariat.chargement.echec'),
    secReessayer: T('accueil.secretariat.reessayer'), secAucunEnLigne: T('accueil.secretariat.aucun'),
    secToutExporte: T('accueil.secretariat.tout'), secRienChoisi: T('accueil.secretariat.rien'),
    secResumeNonExportesUn: T('accueil.secretariat.resume.nonexportes.un'),
    secResumeNonExportesPlus: T('accueil.secretariat.resume.nonexportes.plus'),
    secResumeAnneeUn: T('accueil.secretariat.resume.annee.un'),
    secResumeAnneePlus: T('accueil.secretariat.resume.annee.plus'),
    secResumeChoisisUn: T('accueil.secretariat.resume.choisis.un'),
    secResumeChoisisPlus: T('accueil.secretariat.resume.choisis.plus'),
    secDossier: T('accueil.secretariat.dossier'), secInterrompre: T('accueil.secretariat.interrompre'),
    secReussiNewsletter: T('accueil.secretariat.reussi.newsletter'),
    secReussiMetadonnees: T('accueil.secretariat.reussi.metadonnees'),
    secReussiEdudoc: T('accueil.secretariat.reussi.edudoc'),
    secReussiCaracteres: T('accueil.secretariat.reussi.caracteres'),
    secAfficherUn: T('accueil.secretariat.afficher.un'), secAfficherPlus: T('accueil.secretariat.afficher.plus'),
    secEchec: T('accueil.secretariat.echec'), secEchecInconnu: T('accueil.secretariat.echec.inconnu'),
    secInterrompu: T('accueil.secretariat.interrompu'), secDetails: T('accueil.secretariat.details'),

    jrnListe: T('accueil.journal.liste'), jrnVide: T('accueil.journal.vide'),
    jrnTaille: T('accueil.journal.taille'),
    jrnOk: T('accueil.journal.ok'), jrnEchec: T('accueil.journal.echec'), jrnInconnu: T('accueil.journal.inconnu'),
    jrnIllisible: T('accueil.journal.illisible'), jrnLecture: T('accueil.journal.lecture'),
    jrnExtrait: T('accueil.journal.extrait'), jrnEditeur: T('accueil.journal.editeur'),
    jrnSignaler: T('accueil.journal.signaler'), jrnSignalerTitre: T('accueil.journal.signaler.titre'),
    jrnSignalerQuoi: T('accueil.journal.signaler.quoi'), jrnSignalerAide: T('accueil.journal.signaler.aide'),
    jrnSignalerEnvoyer: T('accueil.journal.signaler.envoyer'),
    jrnSignalerFait: T('accueil.journal.signaler.fait'),
    jrnSignalerAttente: T('accueil.journal.signaler.attente'),
    jrnSignalerRefuse: T('accueil.journal.signaler.refuse'),
    jrnCourriel: T('accueil.journal.courriel'),

    // Paramètres : les libellés de la page des réglages. Ceux qui portent un « _ » reprennent une clé
    // « regl.* » d'avant la fusion, sans la renommer.
    rgAffichage: T('accueil.regl.affichage'), rgRedaction: T('accueil.regl.redaction'),
    rgPoste: T('accueil.regl.poste'), rgServices: T('accueil.regl.services'),
    rgTraduction: T('accueil.regl.traduction'), rgLangue: T('regl.langue'),
    rgLangueAide: T('accueil.regl.langue.aide'), regl_theme: T('regl.theme'),
    regl_themeSysteme: T('regl.theme.systeme'), regl_themeClair: T('regl.theme.clair'),
    regl_themeSombre: T('regl.theme.sombre'), regl_zoom: T('regl.zoom'),
    regl_zoomNormal: T('regl.zoom.normal'), regl_zoomGrand: T('regl.zoom.grand'),
    regl_zoomTresGrand: T('regl.zoom.tresgrand'), rgPolice: TP('accueil.regl.police', profils.courant()),
    rgPoliceAide: T('accueil.regl.police.aide'), regl_apercu: T('regl.apercu'),
    regl_apercuHtml: T('regl.apercu.html'), regl_apercuPdf: T('regl.apercu.pdf'),
    rgAssets: TP('accueil.regl.assets', profils.courant()), regl_warnings: T('regl.warnings'),
    regl_warningsComplets: T('regl.warnings.complets'), regl_warningsReduits: T('regl.warnings.reduits'),
    regl_cmyk: T('regl.cmyk'), rgOui: T('accueil.regl.oui'), rgNon: T('accueil.regl.non'),
    rgLiens: T('accueil.regl.liens'), rgLiensAide: T('accueil.regl.liens.aide'),
    rgFormat: T('accueil.regl.format'), rgFormatAide: T('accueil.regl.format.aide'),
    rgFormatDocx: T('accueil.regl.format.docx'), rgFormatOdt: T('accueil.regl.format.odt'),
    rgLiensActifs: T('accueil.regl.liens.actifs'), rgLiensDesactives: T('accueil.regl.liens.desactives'),
    rgProduit: T('accueil.regl.produit'), rgProduitAide: T('accueil.regl.produit.aide'),
    rgProduitAuto: T('accueil.regl.produit.auto'), rgMaj: T('accueil.regl.maj'),
    rgMajAide: T('accueil.regl.maj.aide'), rgMajFenetre: T('accueil.regl.maj.fenetre'),
    rgMajSilence: T('accueil.regl.maj.silence'), rgDev: T('accueil.regl.dev'),
    rgDevAide: TP('accueil.regl.dev.aide', profils.courant()), rgActive: T('accueil.regl.active'),
    rgDesactive: T('accueil.regl.desactive'), rgPortee: T('accueil.regl.portee'),
    rgShlinkUrl: T('accueil.regl.shlink.url'), rgShlinkUrlAide: T('accueil.regl.shlink.url.aide'),
    rgShlinkCle: T('accueil.regl.shlink.cle'), rgOjsCle: T('accueil.regl.ojs.cle'),
    rgOjsCleAide: T('accueil.regl.ojs.cle.aide'), rgCoffre: T('accueil.regl.coffre'),
    rgDefinie: T('accueil.regl.definie'), rgAbsente: T('accueil.regl.absente'),
    rgEnregistrer: T('accueil.regl.enregistrer'), rgEffacer: T('accueil.regl.effacer'),
    rgMistralCle: T('accueil.regl.mistral.cle'), rgMistralCleAide: T('accueil.regl.mistral.cle.aide'),
    rgMistralTester: T('accueil.regl.mistral.tester'), rgMistralSupprimer: T('accueil.regl.mistral.supprimer'),
    rgMistralModele: T('accueil.regl.mistral.modele'), rgMistralModeleAide: T('accueil.regl.mistral.modele.aide'),
    rgRsTitre: T('accueil.regl.resumes.titre'), rgRsAide: T('accueil.regl.resumes.aide'), rgRsCompteUn: T('accueil.regl.resumes.compte.un'),
    rgRsComptePlus: T('accueil.regl.resumes.compte.plus'), rgRsAucune: T('accueil.regl.resumes.aucune'), rgRsRevueFr: T('accueil.regl.resumes.revue.fr'),
    rgRsRevueDe: T('accueil.regl.resumes.revue.de'), rgRsLancer: T('accueil.regl.resumes.lancer'), rgRsArreter: T('accueil.regl.resumes.arreter'),
    rgRsProgression: T('accueil.regl.resumes.progression'), rgRsArret: T('accueil.regl.resumes.arret'), rgRsSansCle: T('accueil.regl.resumes.sansCle'),
    regl_verifTrad: T('regl.verifTrad'), rgVerifAide: T('accueil.regl.verif.aide'),
    rgModeTrad: T('accueil.regl.trad'), rgModeTradAide: T('accueil.regl.trad.aide'),
    regl_suggInterfaceTitre: T('regl.suggInterface.titre'),
    regl_suggInterfaceOuvrir: T('regl.suggInterface.ouvrir'), rgSuggAucune: T('accueil.regl.sugg.aucune'),
    rgSuggUn: T('accueil.regl.sugg.un'), rgSuggPlus: T('accueil.regl.sugg.plus'),
    regl_exportLangueTitre: T('regl.exportLangue.titre'), regl_exportLangue: T('regl.exportLangue'),
    rgFichierLangueAide: T('accueil.regl.fichier.aide'), regl_protegesTitre: T('regl.proteges.titre'),
    rgVerrouilles: T('accueil.regl.prot.verrouilles'), rgDeverrouilles: T('accueil.regl.prot.deverrouilles'),
    regl_protegesDeverrouiller: T('regl.proteges.deverrouiller'),
    regl_protegesTelecharger: T('regl.proteges.telecharger'),
    regl_protegesTelechargerTip: T('regl.proteges.telecharger.tip'),
    regl_protegesVerrouille: T('regl.proteges.verrouille'), regl_auteursTitre: T('regl.auteurs.titre'),
    auteursMaj: T('regl.auteurs.maj'), auteursJamais: T('regl.auteurs.jamais'),
    auteursCorpus: T('regl.auteurs.corpus'), auteursCorpusJamais: T('regl.auteurs.corpus.jamais'),
    ojsTitre: T('ojs.titre'), ojsIntro: T('ojs.intro'), rgOjsResume: T('accueil.regl.ojs.resume'),
    ojsRevues: T('ojs.revues'), ojsVide: T('ojs.vide'), ojsRubriques: T('ojs.rubriques'),
    ojsRubriquesAide: T('ojs.rubriques.aide'), ojsColCle: T('ojs.col.cle'), ojsColAbbrev: T('ojs.col.abbrev'),
    ojsColTitre: T('ojs.col.titre'), ojsColResume: T('ojs.col.resume'), ojsColDoi: T('ojs.col.doi'),
    ojsAjouter: T('ojs.ajouter'), ojsCleNouvelle: T('ojs.cle.nouvelle'), ojsTypes: T('ojs.types'),
    ojsTypesAide: T('ojs.types.aide'), biblioTitre: T('biblio.titre'), biblioIntro: T('biblio.intro'),
    biblioColLangue: T('biblio.col.langue'), biblioVide: T('biblio.vide'),
    artTachesTitre: T('art.taches.titre'), artTachesAide: T('art.taches.aide'), tachesFr: T('art.taches.fr'),
    tachesDe: T('art.taches.de'), tachesAjouter: T('art.taches.ajouter'),
    tachesRetirer: T('art.taches.retirer'), rgTachesResumeUn: T('accueil.regl.taches.resume.un'),
    rgTachesResumePlus: T('accueil.regl.taches.resume.plus')
  };
}

// Le nom de chaque produit sur ses boutons : un nom propre, le même dans les deux langues.
const LIBELLES_PRODUITS = { revue: 'Revue', zeitschrift: 'Zeitschrift', livre: 'Book' };

// Le produit ouvert d'office : la langue désigne la Revue ou la
// Zeitschrift, le choix du compte l'emporte, et SZH_ONGLET, l'essai, a le dernier mot. Le
// livre n'est jamais désigné par la langue.
function produitParDefaut(langue, choisi, essai, jetons) {
  const connus = jetons || ['revue', 'zeitschrift', 'livre'];
  let produit = langue === 'fr' ? 'revue' : 'zeitschrift';
  for (const v of [choisi, essai]) {
    const c = String(v || '').trim().toLowerCase();
    if (connus.indexOf(c) !== -1) { produit = c; }
  }
  return connus.indexOf(produit) !== -1 ? produit : (connus[0] || '');
}

// Un numéro s'écrit « 2026-03 », numéro sur deux chiffres, même quand son dossier dit « 2026-3 ».
function numeroAffiche(nom) {
  const m = /^(\d{4})[-/](\d{1,2})$/.exec(String(nom || ''));
  return m ? m[1] + '-' + m[2].padStart(2, '0') : String(nom || '');
}

module.exports = { textesAccueil, LIBELLES_PRODUITS, produitParDefaut, numeroAffiche };
