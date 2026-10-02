// Ce que l'hôte du lanceur envoie à sa page (media/lanceur.js) et que l'aperçu hors éditeur
// rejoue : les libellés, le nom de chaque produit et le produit ouvert d'office.
'use strict';

const { T, TP } = require('./i18n');
const profils = require('./profil');

// Les libellés de la page, injectés dans __TXT__. Trois d'entre eux ont une variante « .livre », choisie
// d'après le produit ouvert dans la fenêtre : un livre ne parle ni d'article ni de numéro.
function textesLanceur() {
  return {
    ongletsAria: T('lanceur.onglets'),
    ongletProduits: T('lanceur.onglet.produits'), ongletNouveau: T('lanceur.onglet.nouveau'),
    ongletPreproc: T('lanceur.preproc'), ongletSecretariat: T('lanceur.secretariat'),
    ongletReglages: T('lanceur.reglages'), ongletJournal: T('lanceur.journal'),
    avenir: T('lanceur.avenir'), annuler: T('lanceur.annuler'), modeTest: T('lanceur.modetest'),

    prodChoix: T('lanceur.produits.choix'), prodEnCours: T('lanceur.produits.encours'),
    prodArchives: T('lanceur.produits.archives'), prodArchivesVide: T('lanceur.produits.archives.vide'),
    prodVide: T('lanceur.produits.vide'), prodCreer: T('lanceur.produits.creer'),
    prodDernier: T('lanceur.produits.dernier'), prodVerrouille: T('lanceur.produits.verrouille'),
    prodModifie: T('lanceur.produits.modifie'), prodAstuce: T('lanceur.produits.astuce'),
    prodOuvrir: T('lanceur.produits.ouvrir'), prodDans: T('lanceur.produits.dans'),
    prodVersion: T('lanceur.produits.version'), prodVersionInconnue: T('lanceur.produits.version.inconnue'),
    prodVersions: T('lanceur.produits.versions'), ancrageAbsent: T('lanceur.produits.ancrage'),
    prodHorsUn: T('lanceur.produits.hors.un'), prodHorsPlus: T('lanceur.produits.hors.plus'),

    nvAnnee: T('lanceur.nouveau.annee'), nvNumero: T('lanceur.nouveau.numero'),
    nvNumeroHors: T('lanceur.nouveau.numero.hors'), nvVolume: T('lanceur.nouveau.volume'),
    nvVolumeLibelle: T('lanceur.nouveau.volume.libelle'), nvVolumeManuel: T('lanceur.nouveau.volume.manuel'),
    nvVolumeAuto: T('lanceur.nouveau.volume.auto'), nvDossier: T('lanceur.nouveau.dossier'),
    nvOu: T('lanceur.nouveau.ou'), nvExiste: T('lanceur.nouveau.existe'),
    nvTitre: T('lanceur.nouveau.titre'), nvReference: T('lanceur.nouveau.reference'),
    nvReferencePrise: T('lanceur.nouveau.reference.prise'), nvType: T('lanceur.nouveau.type'),
    nvTypeMono: T('lanceur.nouveau.type.mono'), nvTypeCollectif: T('lanceur.nouveau.type.collectif'),
    nvMaquette: T('lanceur.nouveau.maquette'), nvMaquetteNormal: T('lanceur.nouveau.maquette.normal'),
    nvMaquetteFalc: T('lanceur.nouveau.maquette.falc'), nvFormat: T('lanceur.nouveau.format'),
    nvFormatStandard: T('lanceur.nouveau.format.standard'), nvFormatA4: T('lanceur.nouveau.format.a4'),
    nvCreer: T('lanceur.nouveau.creer'), nvRefus: T('lanceur.nouveau.refus'),

    ppIntro: T('lanceur.preproc.intro'), ppDeposer: T('lanceur.preproc.deposer'), ppOu: T('lanceur.preproc.ou'),
    ppChoisir: T('lanceur.preproc.choisir'), ppDossier: T('lanceur.preproc.dossier'),
    ppSortie: T('lanceur.preproc.sortie'), ppOptions: T('lanceur.preproc.options'),
    ppFormat: T('lanceur.preproc.format'), ppFormatDocx: T('lanceur.preproc.format.docx'),
    ppFormatOdt: T('lanceur.preproc.format.odt'), ppCompteurs: T('lanceur.preproc.compteurs'),
    ppDepotChemin: T('lanceur.preproc.depot.chemin'), ppDepotFormat: T('lanceur.preproc.depot.format'),
    ppEnCours: T('lanceur.preproc.encours'), ppEnCoursProduit: T('lanceur.preproc.encours.produit'),
    ppEtape: T('lanceur.preproc.etape'),
    ppEtapePreparation: T('lanceur.preproc.etape.preparation'), ppEtapeLecture: T('lanceur.preproc.etape.lecture'),
    ppEtapeEntete: T('lanceur.preproc.etape.entete'), ppEtapeIdentifiants: T('lanceur.preproc.etape.identifiants'),
    ppEtapeTitres: T('lanceur.preproc.etape.titres'), ppEtapeFormatage: T('lanceur.preproc.etape.formatage'),
    ppEtapeTypographie: T('lanceur.preproc.etape.typographie'), ppEtapeRegles: T('lanceur.preproc.etape.regles'),
    ppEtapeBibliographie: T('lanceur.preproc.etape.bibliographie'), ppEtapeEcriture: T('lanceur.preproc.etape.ecriture'),
    ppEtapeAnnotation: T('lanceur.preproc.etape.annotation'), ppEtapeRapport: T('lanceur.preproc.etape.rapport'),
    ppInterrompre: T('lanceur.preproc.interrompre'), ppReussi: T('lanceur.preproc.reussi'),
    ppReussiAlertes: T('lanceur.preproc.reussi.alertes'), ppRapportOuvert: T('lanceur.preproc.rapport.ouvert'),
    ppAucuneAlerte: T('lanceur.preproc.alertes.aucune'),
    ppErreursUn: T('lanceur.preproc.erreurs.un'), ppErreursPlus: T('lanceur.preproc.erreurs.plus'),
    ppAvertissementsUn: T('lanceur.preproc.avertissements.un'),
    ppAvertissementsPlus: T('lanceur.preproc.avertissements.plus'),
    ppSuggestionsUn: T('lanceur.preproc.suggestions.un'), ppSuggestionsPlus: T('lanceur.preproc.suggestions.plus'),
    ppOuvrirDocument: T('lanceur.preproc.ouvrir.document'), ppOuvrirRapport: T('lanceur.preproc.ouvrir.rapport'),
    ppAfficher: T('lanceur.preproc.afficher'), ppRefus: T('lanceur.preproc.refus'),
    ppEchec: T('lanceur.preproc.echec'), ppInterrompu: T('lanceur.preproc.interrompu'),

    secNewsletter: T('lanceur.secretariat.newsletter'), secNewsletterAide: T('lanceur.secretariat.newsletter.aide'),
    secMetadonnees: T('lanceur.secretariat.metadonnees'), secMetadonneesAide: T('lanceur.secretariat.metadonnees.aide'),
    secEdudoc: T('lanceur.secretariat.edudoc'), secEdudocAide: T('lanceur.secretariat.edudoc.aide'),
    secCaracteres: T('lanceur.secretariat.caracteres'), secCaracteresAide: T('lanceur.secretariat.caracteres.aide'),
    secTrimestriels: T('lanceur.secretariat.trimestriels'), secNumero: T('lanceur.secretariat.numero'),
    secOption: T('lanceur.secretariat.option'), secCreer: T('lanceur.secretariat.creer'),
    secControler: T('lanceur.secretariat.controler'), secExporter: T('lanceur.secretariat.exporter'),
    secModifier: T('lanceur.secretariat.modifier'), secCasesLegende: T('lanceur.secretariat.cases'),
    secNumeroCourt: T('lanceur.secretariat.numero.court'), secDejaExporte: T('lanceur.secretariat.deja'),
    secAnneePlus: T('lanceur.secretariat.annee.plus'), secFinCourse: T('lanceur.secretariat.fincourse'),
    secChargement: T('lanceur.secretariat.chargement'), secChargementEchec: T('lanceur.secretariat.chargement.echec'),
    secReessayer: T('lanceur.secretariat.reessayer'), secAucunEnLigne: T('lanceur.secretariat.aucun'),
    secToutExporte: T('lanceur.secretariat.tout'), secRienChoisi: T('lanceur.secretariat.rien'),
    secResumeNonExportesUn: T('lanceur.secretariat.resume.nonexportes.un'),
    secResumeNonExportesPlus: T('lanceur.secretariat.resume.nonexportes.plus'),
    secResumeAnneeUn: T('lanceur.secretariat.resume.annee.un'),
    secResumeAnneePlus: T('lanceur.secretariat.resume.annee.plus'),
    secResumeChoisisUn: T('lanceur.secretariat.resume.choisis.un'),
    secResumeChoisisPlus: T('lanceur.secretariat.resume.choisis.plus'),
    secDossier: T('lanceur.secretariat.dossier'), secInterrompre: T('lanceur.secretariat.interrompre'),
    secReussiNewsletter: T('lanceur.secretariat.reussi.newsletter'),
    secReussiMetadonnees: T('lanceur.secretariat.reussi.metadonnees'),
    secReussiEdudoc: T('lanceur.secretariat.reussi.edudoc'),
    secReussiCaracteres: T('lanceur.secretariat.reussi.caracteres'),
    secAfficherUn: T('lanceur.secretariat.afficher.un'), secAfficherPlus: T('lanceur.secretariat.afficher.plus'),
    secEchec: T('lanceur.secretariat.echec'), secEchecInconnu: T('lanceur.secretariat.echec.inconnu'),
    secInterrompu: T('lanceur.secretariat.interrompu'), secDetails: T('lanceur.secretariat.details'),

    jrnListe: T('lanceur.journal.liste'), jrnVide: T('lanceur.journal.vide'),
    jrnTaille: T('lanceur.journal.taille'),
    jrnOk: T('lanceur.journal.ok'), jrnEchec: T('lanceur.journal.echec'), jrnInconnu: T('lanceur.journal.inconnu'),
    jrnIllisible: T('lanceur.journal.illisible'), jrnLecture: T('lanceur.journal.lecture'),
    jrnExtrait: T('lanceur.journal.extrait'), jrnEditeur: T('lanceur.journal.editeur'),
    jrnSignaler: T('lanceur.journal.signaler'), jrnSignalerTitre: T('lanceur.journal.signaler.titre'),
    jrnSignalerQuoi: T('lanceur.journal.signaler.quoi'), jrnSignalerAide: T('lanceur.journal.signaler.aide'),
    jrnSignalerEnvoyer: T('lanceur.journal.signaler.envoyer'),
    jrnSignalerFait: T('lanceur.journal.signaler.fait'),
    jrnSignalerAttente: T('lanceur.journal.signaler.attente'),
    jrnSignalerRefuse: T('lanceur.journal.signaler.refuse'),
    jrnCourriel: T('lanceur.journal.courriel'),

    // Paramètres : les libellés de la page des réglages. Ceux qui portent un « _ » reprennent une clé
    // « regl.* » d'avant la fusion, sans la renommer.
    rgAffichage: T('lanceur.regl.affichage'), rgRedaction: T('lanceur.regl.redaction'),
    rgPoste: T('lanceur.regl.poste'), rgServices: T('lanceur.regl.services'),
    rgTraduction: T('lanceur.regl.traduction'), rgLangue: T('regl.langue'),
    rgLangueAide: T('lanceur.regl.langue.aide'), regl_theme: T('regl.theme'),
    regl_themeSysteme: T('regl.theme.systeme'), regl_themeClair: T('regl.theme.clair'),
    regl_themeSombre: T('regl.theme.sombre'), regl_zoom: T('regl.zoom'),
    regl_zoomNormal: T('regl.zoom.normal'), regl_zoomGrand: T('regl.zoom.grand'),
    regl_zoomTresGrand: T('regl.zoom.tresgrand'), rgPolice: TP('lanceur.regl.police', profils.courant()),
    rgPoliceAide: T('lanceur.regl.police.aide'), regl_apercu: T('regl.apercu'),
    regl_apercuHtml: T('regl.apercu.html'), regl_apercuPdf: T('regl.apercu.pdf'),
    rgAssets: TP('lanceur.regl.assets', profils.courant()), regl_warnings: T('regl.warnings'),
    regl_warningsComplets: T('regl.warnings.complets'), regl_warningsReduits: T('regl.warnings.reduits'),
    regl_cmyk: T('regl.cmyk'), rgOui: T('lanceur.regl.oui'), rgNon: T('lanceur.regl.non'),
    rgLiens: T('lanceur.regl.liens'), rgLiensAide: T('lanceur.regl.liens.aide'),
    rgFormat: T('lanceur.regl.format'), rgFormatAide: T('lanceur.regl.format.aide'),
    rgFormatDocx: T('lanceur.regl.format.docx'), rgFormatOdt: T('lanceur.regl.format.odt'),
    rgLiensActifs: T('lanceur.regl.liens.actifs'), rgLiensDesactives: T('lanceur.regl.liens.desactives'),
    rgProduit: T('lanceur.regl.produit'), rgProduitAide: T('lanceur.regl.produit.aide'),
    rgProduitAuto: T('lanceur.regl.produit.auto'), rgMaj: T('lanceur.regl.maj'),
    rgMajAide: T('lanceur.regl.maj.aide'), rgMajFenetre: T('lanceur.regl.maj.fenetre'),
    rgMajSilence: T('lanceur.regl.maj.silence'), rgDev: T('lanceur.regl.dev'),
    rgDevAide: TP('lanceur.regl.dev.aide', profils.courant()), rgActive: T('lanceur.regl.active'),
    rgDesactive: T('lanceur.regl.desactive'), rgPortee: T('lanceur.regl.portee'),
    rgShlinkUrl: T('lanceur.regl.shlink.url'), rgShlinkUrlAide: T('lanceur.regl.shlink.url.aide'),
    rgShlinkCle: T('lanceur.regl.shlink.cle'), rgOjsCle: T('lanceur.regl.ojs.cle'),
    rgOjsCleAide: T('lanceur.regl.ojs.cle.aide'), rgCoffre: T('lanceur.regl.coffre'),
    rgDefinie: T('lanceur.regl.definie'), rgAbsente: T('lanceur.regl.absente'),
    rgEnregistrer: T('lanceur.regl.enregistrer'), rgEffacer: T('lanceur.regl.effacer'),
    regl_verifTrad: T('regl.verifTrad'), rgVerifAide: T('lanceur.regl.verif.aide'),
    rgModeTrad: T('lanceur.regl.trad'), rgModeTradAide: T('lanceur.regl.trad.aide'),
    regl_suggInterfaceTitre: T('regl.suggInterface.titre'),
    regl_suggInterfaceOuvrir: T('regl.suggInterface.ouvrir'), rgSuggAucune: T('lanceur.regl.sugg.aucune'),
    rgSuggUn: T('lanceur.regl.sugg.un'), rgSuggPlus: T('lanceur.regl.sugg.plus'),
    regl_exportLangueTitre: T('regl.exportLangue.titre'), regl_exportLangue: T('regl.exportLangue'),
    rgFichierLangueAide: T('lanceur.regl.fichier.aide'), regl_protegesTitre: T('regl.proteges.titre'),
    rgVerrouilles: T('lanceur.regl.prot.verrouilles'), rgDeverrouilles: T('lanceur.regl.prot.deverrouilles'),
    regl_protegesDeverrouiller: T('regl.proteges.deverrouiller'),
    regl_protegesTelecharger: T('regl.proteges.telecharger'),
    regl_protegesTelechargerTip: T('regl.proteges.telecharger.tip'),
    regl_protegesVerrouille: T('regl.proteges.verrouille'), regl_auteursTitre: T('regl.auteurs.titre'),
    auteursMaj: T('regl.auteurs.maj'), auteursJamais: T('regl.auteurs.jamais'),
    auteursCorpus: T('regl.auteurs.corpus'), auteursCorpusJamais: T('regl.auteurs.corpus.jamais'),
    ojsTitre: T('ojs.titre'), ojsIntro: T('ojs.intro'), rgOjsResume: T('lanceur.regl.ojs.resume'),
    ojsRevues: T('ojs.revues'), ojsVide: T('ojs.vide'), ojsRubriques: T('ojs.rubriques'),
    ojsRubriquesAide: T('ojs.rubriques.aide'), ojsColCle: T('ojs.col.cle'), ojsColAbbrev: T('ojs.col.abbrev'),
    ojsColTitre: T('ojs.col.titre'), ojsColResume: T('ojs.col.resume'), ojsColDoi: T('ojs.col.doi'),
    ojsAjouter: T('ojs.ajouter'), ojsCleNouvelle: T('ojs.cle.nouvelle'), ojsTypes: T('ojs.types'),
    ojsTypesAide: T('ojs.types.aide'), biblioTitre: T('biblio.titre'), biblioIntro: T('biblio.intro'),
    biblioColLangue: T('biblio.col.langue'), biblioVide: T('biblio.vide'),
    artTachesTitre: T('art.taches.titre'), artTachesAide: T('art.taches.aide'), tachesFr: T('art.taches.fr'),
    tachesDe: T('art.taches.de'), tachesAjouter: T('art.taches.ajouter'),
    tachesRetirer: T('art.taches.retirer'), rgTachesResumeUn: T('lanceur.regl.taches.resume.un'),
    rgTachesResumePlus: T('lanceur.regl.taches.resume.plus')
  };
}

// Le nom de chaque produit sur ses boutons : un nom propre, le même dans les deux langues.
const LIBELLES_PRODUITS = { revue: 'Revue', zeitschrift: 'Zeitschrift', livre: 'Book' };

// Le produit ouvert d'office, comme Get-SzhOngletDefaut : la langue désigne la Revue ou la
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

module.exports = { textesLanceur, LIBELLES_PRODUITS, produitParDefaut, numeroAffiche };
