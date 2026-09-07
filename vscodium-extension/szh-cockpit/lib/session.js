// L'état de session du cockpit : ce qu'une fenêtre VSCodium retient tant qu'elle tourne,
// et qui n'a sa place dans aucun fichier du numéro. Module pur (pas de require('vscode')) :
// une poignée de variables et leurs accesseurs, rien d'autre.
//
// Pourquoi ce module. Le découpage d'extension.js sépare le cycle de vie du numéro
// (verrou, archivage), l'aperçu commutable HTML/PDF et l'import guidé en autant de
// fichiers de lib/ — mais plusieurs de ces zones lisent ou écrivent la même variable :
// un numéro qu'on archive doit fermer l'aperçu en cours (apercuCourantUri), et les deux
// gestionnaires de tâches globaux posés dans activate() (onDidStartTask,
// onDidEndTaskProcess) doivent voir le buildEnCours qu'une compilation d'import a posé.
// Sans un point commun, chaque module extrait aurait fini par garder sa propre copie de
// ces drapeaux, désynchronisée du reste. `reinitialiser()` remet tout à son état de
// départ ; les tests l'appellent quand ils ont besoin de rejouer un scénario à froid
// (aucun harnais actuel n'active l'extension deux fois dans le même processus, mais un
// module qui expose son état doit pouvoir se remettre à zéro).
'use strict';

// ---- Profil du dossier ouvert -----------------------------------------------------
// Le profil détecté par lib/profil.js (numéro de revue ou livre) : lu par profilCourant()
// et tout ce qui en découle (dossierUnites, cheminConfig, cleOrdre…), dans extension.js
// comme dans les modules qui en reçoivent le résultat par callback.
let profilOuvrage = null;

// ---- Cycle de vie du numéro --------------------------------------------------------
// etatNumero vient d'ausgabe.yaml (etatRevue, lib/yaml.js) ; verrouApplique et
// racineVerrou évitent de réécrire settings.json à chaque rafraîchissement ;
// divergenceSignalee tient l'avertissement de version à un coup par fenêtre.
let etatNumero = { verrouillee: false, archivee: false, versionToolkit: '' };
let verrouApplique = null;
let racineVerrou = null;
let divergenceSignalee = false;

// ---- Co-édition : qui nous sommes pour les autres postes --------------------------
let identiteCoedition = null;

// ---- Compilation et import : un seul chemin, une seule garde, deux déclencheurs ---
// buildEnCours et importEnCours protègent le même verrou logique (jamais deux
// compilations à la fois) depuis des points d'entrée différents — le clic sur un
// article, l'enregistrement d'une fiche, l'import guidé, les tâches lancées hors du
// cockpit (Ctrl+S). tachesSuiviesEnVol compte les tâches suivies par les gestionnaires
// globaux d'activate(), pour que Ctrl+S et une commande du cockpit restent cohérents.
let buildEnCours = false;
let importEnCours = false;
let tachesSuiviesEnVol = 0;

// ---- Aperçu commutable HTML / PDF --------------------------------------------------
// L'article actuellement montré en colonne 2 (HTML ou PDF), et le panneau webview de
// l'aperçu HTML quand ce mode est actif. profilRevue est la clé `profil:` d'ausgabe.yaml
// (ce qu'un numéro produit), à ne pas confondre avec profilOuvrage ci-dessus (numéro ou
// livre) — deux notions dont le voisinage de nom est malheureux, gardé tel quel : le
// second est un contrat exporté que les tests lisent.
let apercuCourantUri = null;
let apercuCourantSlug = null;
let panneauApercuHtml = null;
let apercuHtmlMtime = 0;
let profilRevue = 'article';

// Défilement synchronisé éditeur <-> aperçu : la garde anti-boucle (l'extension révèle
// elle-même une ligne, l'événement de visibilité qui en découle doit être ignoré) et les
// trois minuteurs qui regroupent les rafales de scroll/curseur.
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
