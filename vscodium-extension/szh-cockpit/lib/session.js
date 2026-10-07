// État de session du cockpit : ce qu'une fenêtre VSCodium retient tant qu'elle tourne, et
// qui n'appartient à aucun fichier du numéro. Module pur : des variables et leurs accesseurs.
//
// Ces variables sont lues ou écrites par plusieurs zones de lib/ (par exemple, archiver un
// numéro ferme l'aperçu en cours, et les gestionnaires de tâches d'activate() voient le
// buildEnCours posé par l'import). Les garder ici évite des copies désynchronisées.
// reinitialiser() remet tout à l'état de départ, pour les tests.
'use strict';

// ---- Profil du dossier ouvert -----------------------------------------------------
// Le profil détecté par lib/profil.js (numéro de revue ou livre), lu par profilCourant().
let profilOuvrage = null;

// ---- Cycle de vie du numéro --------------------------------------------------------
// etatNumero vient d'ausgabe.yaml (etatRevue, lib/yaml.js). verrouApplique et racineVerrou
// évitent de réécrire settings.json à chaque rafraîchissement. divergenceSignalee limite
// l'avertissement de version à une fois par fenêtre.
let etatNumero = { verrouillee: false, archivee: false, versionToolkit: '' };
let verrouApplique = null;
let racineVerrou = null;
let divergenceSignalee = false;

// ---- Co-édition : notre identité pour les autres postes ---------------------------
let identiteCoedition = null;

// ---- Compilation et import --------------------------------------------------------
// buildEnCours et importEnCours empêchent deux compilations simultanées, quel que soit le
// déclencheur (clic sur un article, fiche enregistrée, import, Ctrl+S).
// tachesSuiviesEnVol compte les tâches suivies par les gestionnaires d'activate().
let buildEnCours = false;
let importEnCours = false;
let tachesSuiviesEnVol = 0;

// ---- Aperçu commutable HTML / PDF --------------------------------------------------
// L'article montré en colonne 2 (HTML ou PDF) et le panneau de l'aperçu HTML.
// profilRevue est la clé `profil:` d'ausgabe.yaml (ce que le numéro produit) ; à ne pas
// confondre avec profilOuvrage (numéro ou livre).
let apercuCourantUri = null;
let apercuCourantSlug = null;
let panneauApercuHtml = null;
let apercuHtmlMtime = 0;
let profilRevue = 'article';

// Défilement synchronisé éditeur <-> aperçu. defilementProgrammatiqueHote fait ignorer
// l'événement que provoque une ligne révélée par l'extension elle-même ; les minuteurs
// regroupent les rafales de défilement et de curseur.
let defilementProgrammatiqueHote = false;
let minuteurHoteVersApercu = null;
let minuteurHoteRelache = null;
let minuteurHoteSurlignage = null;

function reinitialiser() {
  profilOuvrage = null;
  etatNumero = { verrouillee: false, archivee: false, versionToolkit: '' };
  verrouApplique = null;
  racineVerrou = null;
  divergenceSignalee = false;
  identiteCoedition = null;
  buildEnCours = false;
  importEnCours = false;
  tachesSuiviesEnVol = 0;
  apercuCourantUri = null;
  apercuCourantSlug = null;
  panneauApercuHtml = null;
  apercuHtmlMtime = 0;
  profilRevue = 'article';
  defilementProgrammatiqueHote = false;
  minuteurHoteVersApercu = null;
  minuteurHoteRelache = null;
  minuteurHoteSurlignage = null;
}

module.exports = {
  reinitialiser,
  profilOuvrage: () => profilOuvrage,
  poserProfilOuvrage: (v) => { profilOuvrage = v; },
  etatNumero: () => etatNumero,
  poserEtatNumero: (v) => { etatNumero = v; },
  verrouApplique: () => verrouApplique,
  poserVerrouApplique: (v) => { verrouApplique = v; },
  racineVerrou: () => racineVerrou,
  poserRacineVerrou: (v) => { racineVerrou = v; },
  divergenceSignalee: () => divergenceSignalee,
  poserDivergenceSignalee: (v) => { divergenceSignalee = v; },
  identiteCoedition: () => identiteCoedition,
  poserIdentiteCoedition: (v) => { identiteCoedition = v; },
  buildEnCours: () => buildEnCours,
  poserBuildEnCours: (v) => { buildEnCours = v; },
  importEnCours: () => importEnCours,
  poserImportEnCours: (v) => { importEnCours = v; },
  tachesSuiviesEnVol: () => tachesSuiviesEnVol,
  poserTachesSuiviesEnVol: (v) => { tachesSuiviesEnVol = v; },
  apercuCourantUri: () => apercuCourantUri,
  poserApercuCourantUri: (v) => { apercuCourantUri = v; },
  apercuCourantSlug: () => apercuCourantSlug,
  poserApercuCourantSlug: (v) => { apercuCourantSlug = v; },
  panneauApercuHtml: () => panneauApercuHtml,
  poserPanneauApercuHtml: (v) => { panneauApercuHtml = v; },
  apercuHtmlMtime: () => apercuHtmlMtime,
  poserApercuHtmlMtime: (v) => { apercuHtmlMtime = v; },
  profilRevue: () => profilRevue,
  poserProfilRevue: (v) => { profilRevue = v; },
  defilementProgrammatiqueHote: () => defilementProgrammatiqueHote,
  poserDefilementProgrammatiqueHote: (v) => { defilementProgrammatiqueHote = v; },
  minuteurHoteVersApercu: () => minuteurHoteVersApercu,
  poserMinuteurHoteVersApercu: (v) => { minuteurHoteVersApercu = v; },
  minuteurHoteRelache: () => minuteurHoteRelache,
  poserMinuteurHoteRelache: (v) => { minuteurHoteRelache = v; },
  minuteurHoteSurlignage: () => minuteurHoteSurlignage,
  poserMinuteurHoteSurlignage: (v) => { minuteurHoteSurlignage = v; }
};
