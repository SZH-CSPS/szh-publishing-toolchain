// Ce que l'hôte du lanceur envoie à sa page (media/lanceur.js) et que l'aperçu hors éditeur
// rejoue : les libellés, le nom de chaque produit et le produit ouvert d'office.
'use strict';

const { T } = require('./i18n');

// Les libellés de la page, injectés dans __TXT__.
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
    jrnCourriel: T('lanceur.journal.courriel')
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
