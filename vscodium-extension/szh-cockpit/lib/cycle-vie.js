// Cycle de vie du numéro : verrou, archivage, désarchivage, avertissement de version, et
// les copies en conflit qu'un synchroniseur a déposées, jusqu'à leur résolution bloc par
// bloc. Impur (webviews, dialogues, disque) ; les rappels vers l'hôte passent par
// configurer() plus bas, jamais par require('../extension').
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T } = require('./i18n');
const session = require('./session');
const profils = require('./profil');
const { appliquerVerrou, verrouPose } = require('./verrou');
const { etatRevue, titreNumero, ecrireAtomique } = require('./yaml');
const {
  versionInstallee, versionsDivergent, lancerArchivage, lancerChoixVersion, tailleDossier
} = require('./archivage');
const { chercherCopies, copieConflitPour, inverserBloc, appliquerBlocs } = require('./copies-conflit');

// Le profil du dossier ouvert, tel que extension.js l'a posé dans session (même source que
// lib/apercu.js, lib/import-hote.js…) : jamais relu ici par un accès disque à soi. Verrou
// et archivage valent pour les deux profils depuis peu — un livre publié se fige et se
// range comme un numéro (windows/archive-revue.ps1 le fait déjà, $estLivre) — mais les
// textes qu'on montre pendant le geste, eux, parlaient tous de « numéro » ou de « revue » ;
// Tcycle() choisit la variante « .livre » d'une clé quand c'est le cas, lib/i18n.js portant
// les deux versions côte à côte.
function profilCourant() { return session.profilOuvrage() || profils.profilPour('revue'); }
function estLivre() { return profilCourant().cle === 'livre'; }
function Tcycle(cle, args) { return T(estLivre() ? cle + '.livre' : cle, args); }

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois, à la fin d'extension.js (module déjà chargé, tables déjà créées).
// Les valeurs par défaut ne servent qu'à ne pas planter un test qui require ce module seul.
let ctx = {
  trouverRacineRevue: () => null,
  refusCoedition: () => null,
  refusCoeditionNumero: () => null,
  rafraichirEmpreinteCoedition: () => {},
  ecrireClesAusgabe: () => 'lib/cycle-vie.js non configuré',
  fermerTousLesApercus: async () => {},
  fermerOngletsSous: async () => {},
  supprimerAvecReprises: async () => null,
  // Une fonction par table de panneaux (medias, documentation, éditeur de tableau) :
  // chacune connaît la forme de ses propres clés (slug, ou chemin de fichier), ce module
  // ne la lui redemande pas.
  fermerPanneauxDe: []
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

function attendre(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// ---- État du numéro : verrou, archive, version du logiciel -----------------------
// L'état vit dans ausgabe.yaml (etatRevue) et non sur le poste. Relu à chaque
// rafraîchissement, il alimente les clés de contexte szh.verrouillee / szh.archivee, la
// barre d'état, le titre de la vue et les gardes de commandes.

function etatCourant() { return session.etatNumero(); }

// Numéro « gelé », archivé ou verrouillé : plus de compilation automatique. L'export à
// la demande reste possible, puisque l'archivage supprime out/.
function compilationAutoCoupee() {
  return session.etatNumero().archivee || session.etatNumero().verrouillee;
}

// ⚠ Exception au verrou, et elle est voulue : l'ordre des articles n'est gelé que par
// l'archivage, pas par le verrou. Un numéro verrouillé a ses textes figés — c'est ce que
// `locked` protège — mais sa séquence peut encore se décider : on verrouille la copie,
// puis on arrête le sommaire. Un numéro archivé, lui, est terminé, et son ordre décide des
// DOI déjà déposés : plus rien ne bouge.
function refuserSiArchivee() {
  if (!session.etatNumero().archivee) { return false; }
  const bouton = T('art.ordre.archive.bouton');
  vscode.window.showWarningMessage(Tcycle('art.ordre.archive'), bouton).then((choix) => {
    if (choix === bouton) { vscode.commands.executeCommand('szh.desarchiver'); }
  });
  return true;
}

// Garde d'écriture : true = refusé, l'appelant sort. Le refus est toujours affiché.
function refuserSiVerrouille() {
  if (!session.etatNumero().verrouillee) { return false; }
  const bouton = Tcycle('verrou.refuse.bouton');
  vscode.window.showWarningMessage(Tcycle('verrou.refuse'), bouton).then((choix) => {
    if (choix === bouton) { vscode.commands.executeCommand('szh.deverrouiller'); }
  });
  return true;
}

// Applique le verrou puis vérifie sur le disque que l'état voulu a bien pris : un
// settings.json illisible pendant l'écriture laisse le verrou dans son état d'avant
// l'appel, jamais celui qu'on visait. session.verrouApplique() doit donc refléter le réel,
// pas le voulu — sinon l'interface promet un état (déverrouillé, par exemple) que le
// disque dément, et une modification resterait possible par mégarde sur un numéro qui se
// croit verrouillé.
function appliquerEtVerifierVerrou(racine, voulu) {
  const erreur = appliquerVerrou(racine, voulu);
  const reel = verrouPose(racine);
  if (erreur || reel !== voulu) {
    vscode.window.showWarningMessage(T('err.verrou.reglages', [erreur || String(reel)]));
  }
  session.poserVerrouApplique(reel);
}

function majEtatNumero(fournisseur, barreEtat) {
  const racine = fournisseur.racine;
  session.poserEtatNumero(racine ? etatRevue(racine)
                      : { verrouillee: false, archivee: false, versionToolkit: '' });
  vscode.commands.executeCommand('setContext', 'szh.verrouillee', session.etatNumero().verrouillee);
  vscode.commands.executeCommand('setContext', 'szh.archivee', session.etatNumero().archivee);
  if (barreEtat) { majBarreEtatNumero(barreEtat); }
  // Le verrou suit le fichier, même édité à la main ou synchronisé par OneDrive.
  if (racine && (session.racineVerrou() !== racine || session.verrouApplique() !== session.etatNumero().verrouillee)) {
    session.poserRacineVerrou(racine);
    appliquerEtVerifierVerrou(racine, session.etatNumero().verrouillee);
  }
}

// Visible seulement sur un numéro gelé ; le clic mène au geste inverse.
function majBarreEtatNumero(barre) {
  if (!session.etatNumero().verrouillee && !session.etatNumero().archivee) { barre.hide(); return; }
  if (session.etatNumero().verrouillee && session.etatNumero().archivee) { barre.text = T('etat.barre.lesdeux'); }
  else if (session.etatNumero().verrouillee) { barre.text = T('etat.barre.verrouillee'); }
  else { barre.text = T('etat.barre.archivee'); }
  barre.command = session.etatNumero().verrouillee ? 'szh.deverrouiller' : 'szh.desarchiver';
  const morceaux = [Tcycle(session.etatNumero().verrouillee ? 'etat.barre.tooltip.verrou' : 'etat.barre.tooltip.archive')];
  if (session.etatNumero().versionToolkit !== '') {
    morceaux.push(T('etat.barre.tooltip.version',
      [session.etatNumero().versionToolkit, versionInstallee() || '?']));
  }
  barre.tooltip = morceaux.join('\n');
  barre.show();
}

function titreVue(racine) {
  const base = titreNumero(racine);
  if (session.etatNumero().verrouillee && session.etatNumero().archivee) { return T('arbre.titre.archiveeVerrouillee', [base]); }
  if (session.etatNumero().verrouillee) { return T('arbre.titre.verrouillee', [base]); }
  if (session.etatNumero().archivee) { return T('arbre.titre.archivee', [base]); }
  return base;
}

function avertirVersionSiDivergente() {
  if (session.divergenceSignalee()) { return; }
  const poste = versionInstallee();
  if (!versionsDivergent(session.etatNumero().versionToolkit, poste)) { return; }
  session.poserDivergenceSignalee(true);
  const bouton = T('version.divergence.bouton');
  vscode.window.showWarningMessage(
    T('version.divergence', [poste, session.etatNumero().versionToolkit]), bouton
  ).then((choix) => {
    if (choix !== bouton) { return; }
    const erreur = lancerChoixVersion();
    if (erreur) { vscode.window.showErrorMessage(T('err.version.lancement', [erreur])); }
  });
}

// ---- Archiver, verrouiller, désarchiver ------------------------------------------
// ausgabe.yaml est écrit d'abord. Le déplacement du dossier est délégué à
// windows/archive-revue.ps1, qui attend la fermeture de la fenêtre : d'où l'ordre
// écrire, nettoyer, lancer, fermer.

function poidsLisible(octets) {
  if (octets <= 0) { return T('modale.archiver.rien'); }
  if (octets < 1024 * 1024) { return Math.max(1, Math.round(octets / 1024)) + ' Ko'; }
  const mo = octets / (1024 * 1024);
  return (mo < 10 ? mo.toFixed(1).replace('.', ',') : String(Math.round(mo))) + ' Mo';
}

// Le dossier ne bouge pas, out/ est conservé : le geste d'un numéro déjà archivé.
// Les formulaires qui écrivent des fichiers sans passer par l'éditeur (gestionnaire des
// médias, éditeur de tableau) : ni le verrou en lecture seule ni la disparition d'un
// article ne les atteignent, il faut les fermer. Chaque table sait fermer les siens —
// voir ctx.fermerPanneauxDe.
function fermerFormulairesEcriture(racine, slug) {
  for (const fermerDe of ctx.fermerPanneauxDe) { fermerDe(racine, slug); }
}

async function verrouillerSeulement(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  // Geler le numéro pendant que quelqu'un y écrit, c'est couper une saisie en cours sur un
  // autre poste. La question porte sur tout le numéro, pas sur un fichier.
  const refusBail = ctx.refusCoeditionNumero(racine);
  if (refusBail) { vscode.window.showWarningMessage(refusBail); return; }
  const choix = await vscode.window.showWarningMessage(
    T('modale.verrouiller.question', [titreNumero(racine)]),
    { modal: true, detail: Tcycle('modale.verrouiller.detail') },
    T('modale.verrouiller.bouton'));
  if (choix !== T('modale.verrouiller.bouton')) { return; }
  const erreur = ctx.ecrireClesAusgabe(racine, { locked: 'true' });
  if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [erreur])); return; }
  fermerFormulairesEcriture(null, null);           // un formulaire ouvert écrit par fs
  rafraichirTout();
  vscode.window.setStatusBarMessage(Tcycle('statut.verrouille'), 4000);
}

async function archiverEtVerrouiller(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Le dossier va être déplacé : personne ne doit être en train d'écrire dedans.
  const refusBail = ctx.refusCoeditionNumero(racine);
  if (refusBail) { vscode.window.showWarningMessage(refusBail); return; }
  // Déjà archivé : il ne reste qu'à reposer le verrou.
  if (session.etatNumero().archivee) {
    if (session.etatNumero().verrouillee) { vscode.window.showInformationMessage(Tcycle('info.deja.archivee')); return; }
    await verrouillerSeulement(fournisseur, rafraichirTout);
    return;
  }
  const dossierOut = path.join(racine, 'out');
  const bouton = T('modale.archiver.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.archiver.question', [titreNumero(racine)]),
    { modal: true, detail: Tcycle('modale.archiver.detail', [poidsLisible(tailleDossier(dossierOut))]) },
    bouton);
  if (choix !== bouton) { return; }
  // La modale reste ouverte le temps que le rédacteur réponde : une compilation a pu
  // démarrer entre-temps. Même refus qu'avant la modale, avant tout effet sur le disque.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }

  // 1. les deux drapeaux seuls : l'étape 2 peut échouer, il faut pouvoir revenir.
  const erreurYaml = ctx.ecrireClesAusgabe(racine, { locked: 'true', archived: 'true' });
  if (erreurYaml) { vscode.window.showErrorMessage(T('err.ecriture', [erreurYaml])); return; }

  // 2. ⚠ fermer les onglets avant de supprimer out/ : un PDF affiché est verrouillé
  //    côté Windows. En cas d'échec on relève les drapeaux, avant tout déplacement.
  await ctx.fermerTousLesApercus();
  await ctx.fermerOngletsSous(dossierOut);
  session.poserApercuCourantUri(null);
  session.poserApercuCourantSlug(null);
  const erreurOut = await ctx.supprimerAvecReprises(dossierOut);
  if (erreurOut) {
    ctx.ecrireClesAusgabe(racine, { locked: 'false', archived: 'false' });
    rafraichirTout();
    vscode.window.showErrorMessage(T('err.out.suppression', [erreurOut]));
    return;
  }

  // 3. la version du logiciel, si le numéro n'en portait pas ; après le point de
  //    non-retour, pour qu'un archivage annulé ne laisse pas d'estampille.
  const poste = versionInstallee();
  if (session.etatNumero().versionToolkit === '' && poste !== '') {
    ctx.ecrireClesAusgabe(racine, { 'version-toolkit': poste });
  }

  // 4. la lecture seule, écrite dans le dossier : elle part avec lui.
  appliquerEtVerifierVerrou(racine, true);
  session.poserRacineVerrou(racine);
  rafraichirTout();

  // 5. le déplacement, puis la fermeture de cette fenêtre (condition du déplacement).
  const erreurScript = lancerArchivage('archiver', racine);
  if (erreurScript) {
    vscode.window.showErrorMessage(Tcycle('err.archivage', [erreurScript]));
    return;                                        // le numéro reste gelé, à sa place
  }
  vscode.window.setStatusBarMessage(T('statut.archivage'), 10000);
  await fermerFenetreApresArchivage();
}

// Retour dans l'arborescence « en cours ». Le verrou n'est pas levé pour autant.
async function desarchiver(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (!session.etatNumero().archivee) { vscode.window.showInformationMessage(Tcycle('info.deja.encours')); return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const bouton = T('modale.desarchiver.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.desarchiver.question', [titreNumero(racine)]),
    { modal: true, detail: Tcycle('modale.desarchiver.detail') }, bouton);
  if (choix !== bouton) { return; }
  // La modale reste ouverte le temps que le rédacteur réponde : une compilation a pu
  // démarrer entre-temps. Même refus qu'avant la modale, avant tout effet sur le disque.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const erreurYaml = ctx.ecrireClesAusgabe(racine, { archived: 'false' });
  if (erreurYaml) { vscode.window.showErrorMessage(T('err.ecriture', [erreurYaml])); return; }
  await ctx.fermerTousLesApercus();
  session.poserApercuCourantUri(null);
  session.poserApercuCourantSlug(null);
  rafraichirTout();
  const erreurScript = lancerArchivage('desarchiver', racine);
  if (erreurScript) { vscode.window.showErrorMessage(Tcycle('err.desarchivage', [erreurScript])); return; }
  vscode.window.setStatusBarMessage(T('statut.desarchivage'), 10000);
  await fermerFenetreApresArchivage();
}

// La fenêtre se ferme après le démarrage du script : tant qu'elle est ouverte, Windows
// refuse de déplacer le dossier.
async function fermerFenetreApresArchivage() {
  await attendre(1200);
  await vscode.commands.executeCommand('workbench.action.closeWindow');
}

async function deverrouiller(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (!session.etatNumero().verrouillee) {
    vscode.window.showInformationMessage(Tcycle('info.deja.deverrouillee'));
    return;
  }
  const bouton = T('modale.deverrouiller.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.deverrouiller.question', [titreNumero(racine)]),
    { modal: true, detail: Tcycle('modale.deverrouiller.detail') }, bouton);
  if (choix !== bouton) { return; }
  const erreur = ctx.ecrireClesAusgabe(racine, { locked: 'false' });
  if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', [erreur])); return; }
  appliquerEtVerifierVerrou(racine, false);
  session.poserRacineVerrou(racine);
  rafraichirTout();
  vscode.window.setStatusBarMessage(Tcycle('statut.deverrouille'), 5000);
}

// ---- Copies en conflit déjà déposées par le synchroniseur ------------------------
//
// Le bail réduit la fenêtre de collision, il ne la ferme pas — il voyage par OneDrive, qui
// met de quelques secondes à quelques minutes. Quand une copie en conflit est quand même
// apparue, elle ne doit pas rester invisible : une version du travail n'est plus dans le
// numéro, et personne ne s'en aperçoit avant de relire le PDF.
//
// Un avertissement par fichier et par session : le rafraîchissement passe ici souvent, et
// répéter la même fenêtre serait vite ignoré. Le bouton ouvre le comparateur natif de
// l'éditeur (vscode.diff) — la copie à gauche, la version du numéro à droite.
let copiesSignalees = new Set();
let dernierBalayageCopies = 0;

// Le délai entre deux balayages du dossier. rafraichirTout passe ici à chaque geste et à
// chaque rafale du système de fichiers ; parcourir tout le numéro à cette cadence coûterait
// plus cher que le service rendu. Une copie en conflit n'est pas une urgence à la seconde.
const DELAI_BALAYAGE_COPIES = 15000;

function oublierCopiesSignalees() { copiesSignalees = new Set(); dernierBalayageCopies = 0; }

function avertirCopiesConflit(racine) {
  if (!racine) { majConflitsScm(null, []); return; }
  const maintenant = Date.now();
  if (maintenant - dernierBalayageCopies < DELAI_BALAYAGE_COPIES) { return; }
  dernierBalayageCopies = maintenant;
  let copies = [];
  try { copies = chercherCopies(racine); } catch (e) { return; }   // jamais bloquant
  // La barre du contrôle de source suit à chaque balayage, avertissement ou pas : c'est elle
  // qui garde la liste sous la main quand la fenêtre a été fermée d'un revers.
  majConflitsScm(racine, copies);
  const nouvelles = copies.filter((c) => !copiesSignalees.has(c.chemin));
  if (nouvelles.length === 0) { return; }
  for (const c of nouvelles) { copiesSignalees.add(c.chemin); }
  const premiere = nouvelles[0];
  const bouton = T('conflit.copie.comparer');
  const message = nouvelles.length === 1
    ? T('conflit.copie', [premiere.nom])
    : T('conflit.copie.plusieurs', [nouvelles.length, premiere.nom]);
  vscode.window.showWarningMessage(message, bouton).then((choix) => {
    if (choix !== bouton) { return; }
    comparerConflit(premiere.cheminOriginal, premiere.chemin);
  });
}

// La copie à gauche, la version du numéro à droite. Le fichier d'origine peut manquer — le
// synchroniseur a pu renommer les deux versions : on ouvre alors la copie seule, plutôt que
// d'échouer sur un comparateur vide.
function comparerConflit(cheminFichier, cheminCopie) {
  const copie = cheminCopie || (cheminFichier ? copieConflitPour(cheminFichier) : null);
  if (!copie) {
    // Rien à comparer. Le fichier visé est peut-être la copie elle-même — le synchroniseur
    // a pu renommer les deux versions : on l'ouvre, plutôt que de se taire.
    if (cheminFichier && fs.existsSync(cheminFichier)) {
      vscode.window.showTextDocument(vscode.Uri.file(cheminFichier));
      return;
    }
    vscode.window.showWarningMessage(T('conflit.copie.absente'));
    return;
  }
  const gauche = vscode.Uri.file(copie);
  if (!cheminFichier || !fs.existsSync(cheminFichier)) {
    vscode.window.showTextDocument(gauche);
    return;
  }
  vscode.commands.executeCommand('vscode.diff', gauche, vscode.Uri.file(cheminFichier),
    T('conflit.copie.titre', [path.basename(copie)]));
}

// ---- Résoudre une copie en conflit au clic, bloc par bloc -------------------------
//
// Comparer deux versions ne suffit pas : il faut pouvoir trancher chaque divergence sans
// recopier à la main. L'éditeur sait déjà le faire, à une condition — qu'on lui dise ce qui
// tient lieu d'original pour un fichier donné. C'est le rôle du « diff rapide »
// (QuickDiffProvider) : dès qu'on déclare la copie en conflit comme original du fichier du
// numéro, chaque divergence reçoit sa marque dans la gouttière, et le clic sur la marque
// ouvre le diff en ligne, dont la barre de titre porte nos deux commandes.
//
// Les deux sens, et ils sont symétriques :
//   « Prendre cette version » écrit le bloc de la copie dans le fichier du numéro ;
//   « Garder la mienne »      écrit le bloc du fichier du numéro dans la copie.
// Dans les deux cas la divergence disparaît. Quand il n'en reste plus une seule, la copie ne
// contient plus rien que le numéro n'ait pas : sa suppression est alors proposée, et le
// conflit est clos sans qu'un octet ait été perdu de vue.
//
// ⚠ Rien de tout cela ne calcule un diff : les blocs arrivent de l'éditeur, en argument des
// commandes (uri du document, tableau des blocs, index du bloc affiché). Le contrat est celui
// du menu « scm/change/title », le même que celui dont Git se sert pour « Stage Change ».
//
// ⚠ Le fournisseur de diff rapide est une propriété d'un SourceControl, seule voie stable de
// l'API. On ne le crée donc que s'il existe une copie en conflit dans le numéro, et on le
// détruit dès qu'il n'en reste plus : sans cette précaution, un poste sans conflit porterait
// à vie une entrée vide dans la barre du contrôle de source.
const SCHEME_CONFLIT = 'szh-conflit';

let scmConflits = null;
let groupeConflits = null;
const changementConflit = new vscode.EventEmitter();

// Le chemin caché dans une URI « szh-conflit ». uri.fsPath serait plus court, mais son
// traitement des lettres de lecteur Windows dépend du schéma « file » : ici on lit le chemin
// tel que Uri.file l'a écrit — « /c:/… » — et on retire la barre de tête. Pas de
// décodage : `path` est déjà la forme décodée, et un « % » de nom de fichier ferait lever
// decodeURIComponent.
function cheminDepuisUriConflit(uri) {
  const brut = String((uri && uri.path) || '');
  return path.normalize(/^\/[A-Za-z]:/.test(brut) ? brut.slice(1) : brut);
}

// Le contenu de la copie, servi en lecture seule : c'est ce que l'éditeur prend pour
// l'original du fichier du numéro, et c'est de lui que naissent les marques de divergence.
const fournisseurContenuConflit = {
  onDidChange: changementConflit.event,
  provideTextDocumentContent(uri) {
    try { return fs.readFileSync(cheminDepuisUriConflit(uri), 'utf8'); }
    catch (e) { return ''; }                       // copie disparue : plus de divergence
  }
};

// Appelé par l'éditeur pour chaque document ouvert : rendre une URI ici, c'est demander les
// marques de gouttière ; ne rien rendre, c'est ne rien décorer.
//
// D'où la garde sur la racine : sans elle, ouvrir un fichier quelconque du disque ferait lire
// son dossier à chaque fois. Un fichier hors du numéro ne nous concerne pas.
let racineConflits = null;

function sousLaRacineConflits(chemin) {
  if (!racineConflits || !chemin) { return false; }
  const rel = path.relative(racineConflits, chemin);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

const fournisseurDiffConflit = {
  provideOriginalResource(uri) {
    if (!uri || uri.scheme !== 'file' || !sousLaRacineConflits(uri.fsPath)) { return undefined; }
    const copie = copieConflitPour(uri.fsPath);
    if (!copie) { return undefined; }
    return vscode.Uri.file(copie).with({ scheme: SCHEME_CONFLIT });
  }
};

// L'état de la barre du contrôle de source suit ce que le balayage a trouvé. Aucune copie :
// tout est démonté, l'entrée disparaît.
function majConflitsScm(racine, copies) {
  // Posée à chaque balayage, même sans copie : elle ne sert qu'à borner le fournisseur de
  // diff rapide au numéro ouvert. Hors revue, elle est nulle et rien n'est décoré.
  racineConflits = racine || null;
  if (!copies || copies.length === 0) {
    if (scmConflits) { scmConflits.dispose(); scmConflits = null; groupeConflits = null; }
    return;
  }
  if (!scmConflits) {
    scmConflits = vscode.scm.createSourceControl(
      'szh.conflits', T('conflit.scm.titre'), vscode.Uri.file(racine));
    scmConflits.quickDiffProvider = fournisseurDiffConflit;
    groupeConflits = scmConflits.createResourceGroup('conflits', T('conflit.scm.groupe'));
  }
  scmConflits.count = copies.length;
  groupeConflits.resourceStates = copies.map((c) => {
    // Le fichier du numéro, ou la copie elle-même quand l'original manque : une entrée qui
    // pointe un fichier absent ne s'ouvrirait pas.
    const cible = fs.existsSync(c.cheminOriginal) ? c.cheminOriginal : c.chemin;
    return {
      resourceUri: vscode.Uri.file(cible),
      decorations: { tooltip: T('conflit.scm.tooltip', [c.nom]) },
      command: {
        command: 'szh.conflit.comparer', title: T('conflit.copie.comparer'),
        arguments: [vscode.Uri.file(cible)]
      }
    };
  });
}

// Le bloc affiché, ou null : le menu passe le tableau entier et l'index de celui qu'on
// regarde, et un clic tardif sur un diff recalculé entre-temps peut sortir du tableau.
function blocVise(blocs, index) {
  if (!Array.isArray(blocs)) { return null; }
  const i = typeof index === 'number' ? index : 0;
  return blocs[i] || null;
}

// Le fichier visé par une commande du menu : celui du document affiché, ou à défaut celui de
// l'éditeur actif — la palette de commandes ne passe aucun argument.
function fichierConflitVise(uri) {
  if (uri && uri.scheme === 'file') { return uri.fsPath; }
  if (uri && uri.scheme === SCHEME_CONFLIT) { return cheminDepuisUriConflit(uri); }
  const actif = vscode.window.activeTextEditor;
  return actif && actif.document && actif.document.uri.scheme === 'file'
    ? actif.document.uri.fsPath : null;
}

// `prendre` : le bloc de la copie entre dans le fichier du numéro. Sinon c'est l'inverse, et
// c'est la copie qui reçoit le bloc du numéro.
async function resoudreBlocConflit(uri, blocs, index, prendre) {
  const chemin = fichierConflitVise(uri);
  const copie = chemin ? copieConflitPour(chemin) : null;
  if (!chemin || !copie) { vscode.window.showWarningMessage(T('conflit.copie.absente')); return; }
  const bloc = blocVise(blocs, index);
  if (!bloc) { return; }
  let doc;
  try { doc = await vscode.workspace.openTextDocument(vscode.Uri.file(chemin)); }
  catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [chemin])); return; }
  const mien = doc.getText();                      // le tampon, pas le disque : une frappe non
  let sien = '';                                   // enregistrée compte comme « ma version »
  try { sien = fs.readFileSync(copie, 'utf8'); }
  catch (e) { vscode.window.showWarningMessage(T('conflit.copie.absente')); return; }

  if (prendre) {
    // Le fichier du numéro change : le verrou du numéro d'abord, le bail de co-édition
    // ensuite — un clic isolé ne garde pas la main, il se contente de vérifier.
    if (refuserSiVerrouille()) { return; }
    const racine = ctx.trouverRacineRevue();
    const refus = ctx.refusCoedition(racine, chemin);
    if (refus) { vscode.window.showWarningMessage(refus); return; }
    const texte = appliquerBlocs(mien, sien, [inverserBloc(bloc)]);
    if (texte === mien) { return; }                // rien à faire, bloc déjà résolu
    // Par l'éditeur et non par fs : le document est ouvert, et le geste doit rester
    // annulable au Ctrl+Z comme n'importe quelle édition.
    try {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), texte);
      if (!(await vscode.workspace.applyEdit(edition))) {
        vscode.window.showErrorMessage(T('err.ecriture', [chemin]));
        return;
      }
      await doc.save();
    } catch (e) {
      vscode.window.showErrorMessage(T('err.ecriture', [String((e && e.message) || e)]));
      return;
    }
    // L'écriture n'est pas passée par le point d'écriture du fichier du numéro : les
    // formulaires ouverts doivent quand même savoir que le disque a bougé de notre fait.
    ctx.rafraichirEmpreinteCoedition(racine, chemin);
    if (texte === sien) { proposerSuppressionCopie(copie); }
    return;
  }

  // L'autre sens. La copie n'est pas un fichier du numéro : aucun bail ne la protège, et
  // elle est de toute façon destinée à disparaître — écriture atomique directe.
  const texte = appliquerBlocs(sien, mien, [bloc]);
  if (texte === sien) { return; }
  try { ecrireAtomique(copie, texte); }
  catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [String((e && e.message) || e)]));
    return;
  }
  // Le contenu « original » a changé : sans cet avis, la gouttière garderait ses marques.
  changementConflit.fire(vscode.Uri.file(copie).with({ scheme: SCHEME_CONFLIT }));
  if (texte === mien) { proposerSuppressionCopie(copie); }
}

// Les deux fichiers disent maintenant la même chose : la copie ne retient plus rien. On le
// dit et on propose de la retirer — jamais sans le demander, effacer un fichier reste un
// geste de l'utilisateur.
function proposerSuppressionCopie(copie) {
  const bouton = T('conflit.copie.supprimer');
  vscode.window.showInformationMessage(T('conflit.copie.identiques', [path.basename(copie)]), bouton)
    .then((choix) => { if (choix === bouton) { supprimerCopieConflit(copie, false); } });
}

// `demander` : la commande explicite passe par une confirmation modale, parce qu'elle peut
// être lancée sur une copie qui contient encore du travail. La suppression proposée après
// convergence, elle, a déjà eu son bouton.
async function supprimerCopieConflit(copie, demander) {
  if (!copie || !fs.existsSync(copie)) { return; }
  if (demander) {
    const bouton = T('conflit.copie.supprimer');
    const choix = await vscode.window.showWarningMessage(
      T('conflit.copie.supprimer.question', [path.basename(copie)]),
      { modal: true, detail: T('conflit.copie.supprimer.detail') }, bouton);
    if (choix !== bouton) { return; }
  }
  try { fs.unlinkSync(copie); }
  catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [String((e && e.message) || e)])); return; }
  // Retirée du jeu des fichiers déjà signalés : si le synchroniseur en dépose une autre plus
  // tard, elle sera annoncée comme une nouvelle.
  copiesSignalees.delete(copie);
  // La copie a disparu : le fournisseur de contenu doit le savoir, sinon la gouttière
  // continuerait de comparer avec ce qui n'existe plus.
  changementConflit.fire(vscode.Uri.file(copie).with({ scheme: SCHEME_CONFLIT }));
  rafraichirConflitsScm();
  vscode.window.setStatusBarMessage(T('conflit.copie.supprimee', [path.basename(copie)]), 4000);
}

// L'état de la barre du contrôle de source, hors balayage : après une suppression, dont
// aucun surveillant de fichiers ne nous avertit — les motifs surveillés ne couvrent pas les
// noms déposés par le synchroniseur. Ne réveille aucun avertissement au passage.
function rafraichirConflitsScm() {
  const racine = ctx.trouverRacineRevue();
  if (!racine) { majConflitsScm(null, []); return; }
  let copies = [];
  try { copies = chercherCopies(racine); } catch (e) { copies = []; }
  majConflitsScm(racine, copies);
}

module.exports = {
  configurer,
  etatCourant, compilationAutoCoupee, refuserSiArchivee, refuserSiVerrouille,
  appliquerEtVerifierVerrou, majEtatNumero, majBarreEtatNumero, titreVue,
  avertirVersionSiDivergente, poidsLisible, fermerFormulairesEcriture,
  verrouillerSeulement, archiverEtVerrouiller, desarchiver, deverrouiller,
  fermerFenetreApresArchivage,
  oublierCopiesSignalees, avertirCopiesConflit, comparerConflit,
  SCHEME_CONFLIT, fournisseurContenuConflit, fournisseurDiffConflit,
  cheminDepuisUriConflit, resoudreBlocConflit, supprimerCopieConflit, rafraichirConflitsScm,
  majConflitsScm
};
