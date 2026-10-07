// Cycle de vie du numéro : verrou, archivage, désarchivage, avertissement de version, et
// les copies en conflit déposées par OneDrive, jusqu'à leur résolution bloc par bloc. Les
// rappels vers l'hôte passent par configurer(), pas par require('../extension').
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');

const { T, TP } = require('./i18n');
const session = require('./session');
const profils = require('./profil');
const { appliquerVerrou, verrouPose } = require('./verrou');
const {
  refusCoedition, refusCoeditionNumero, rafraichirEmpreinteCoedition
} = require('./coedition-hote');
const { etatRevue, titreNumero, ecrireAtomique } = require('./yaml');
const {
  versionInstallee, versionsDivergent, lancerArchivage, lancerChoixVersion, tailleDossier
} = require('./archivage');
const {
  chercherCopies, chercherCopiesPlat, copieConflitPour, estCopieConflit, memeContenu,
  copieRedondante, inverserBloc, appliquerBlocs
} = require('./copies-conflit');
// Seulement pour situer le dossier partagé de l'outil (copiesDuDossierPartage) : ce module
// n'écrit aucun rapport. lib/rapport-erreur.js ne dépend que de fs/path/os, et il est le
// seul endroit qui compose le chemin de l'application.
const { resoudreAncrage, resoudreDossierRapports } = require('./rapport-erreur');
const { imagesIntrouvablesDesUnites } = require('./export-ojs');

// Le profil du dossier ouvert (lib/profil.js#courant). Verrou et archivage valent pour les
// deux profils : les textes passent par TP, qui prend la variante « .livre » d'une clé
// quand elle existe.
function profilCourant() { return profils.courant(); }

// ---- Rappels vers l'hôte ----------------------------------------------------------
// Posés une seule fois, à la fin d'extension.js. Les valeurs par défaut permettent à un
// test de charger ce module seul.
let ctx = {
  trouverRacineRevue: () => null,
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

// Exception voulue au verrou : l'ordre des articles n'est gelé que par l'archivage. Un
// numéro verrouillé a ses textes figés (`locked`), mais son sommaire peut encore se
// décider : on verrouille la copie, puis on arrête le sommaire. Un numéro archivé est
// terminé, et son ordre fixe les DOI déjà déposés.
function refuserSiArchivee() {
  if (!session.etatNumero().archivee) { return false; }
  const bouton = T('art.ordre.archive.bouton');
  vscode.window.showWarningMessage(TP('art.ordre.archive', profilCourant()), bouton).then((choix) => {
    if (choix === bouton) { vscode.commands.executeCommand('szh.desarchiver'); }
  });
  return true;
}

// Garde d'écriture : true = refusé, l'appelant sort. Le refus est toujours affiché.
function refuserSiVerrouille() {
  if (!session.etatNumero().verrouillee) { return false; }
  const bouton = TP('verrou.refuse.bouton', profilCourant());
  vscode.window.showWarningMessage(TP('verrou.refuse', profilCourant()), bouton).then((choix) => {
    if (choix === bouton) { vscode.commands.executeCommand('szh.deverrouiller'); }
  });
  return true;
}

// Applique le verrou puis vérifie sur le disque que l'état voulu a pris : un settings.json
// illisible pendant l'écriture laisse le verrou dans son état d'avant. session.verrouApplique()
// reflète donc l'état réel, pour que l'interface n'annonce pas un numéro déverrouillé ou
// verrouillé à tort.
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

// Visible seulement sur un numéro gelé ; le clic mène à l'action inverse.
function majBarreEtatNumero(barre) {
  if (!session.etatNumero().verrouillee && !session.etatNumero().archivee) { barre.hide(); return; }
  if (session.etatNumero().verrouillee && session.etatNumero().archivee) { barre.text = T('etat.barre.lesdeux'); }
  else if (session.etatNumero().verrouillee) { barre.text = T('etat.barre.verrouillee'); }
  else { barre.text = T('etat.barre.archivee'); }
  barre.command = session.etatNumero().verrouillee ? 'szh.deverrouiller' : 'szh.desarchiver';
  const morceaux = [TP(session.etatNumero().verrouillee ? 'etat.barre.tooltip.verrou' : 'etat.barre.tooltip.archive', profilCourant())];
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

// Les formulaires qui écrivent des fichiers sans passer par l'éditeur (gestionnaire des
// médias, éditeur de tableau) ne sont touchés ni par la lecture seule ni par la disparition
// d'un article : il faut les fermer. Chaque table ferme les siens (ctx.fermerPanneauxDe).
function fermerFormulairesEcriture(racine, slug) {
  for (const fermerDe of ctx.fermerPanneauxDe) { fermerDe(racine, slug); }
}

// Verrouiller sans archiver : le dossier ne bouge pas, out/ est conservé. C'est aussi
// l'action sur un numéro déjà archivé.
async function verrouillerSeulement(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  // Geler le numéro couperait une saisie en cours sur un autre poste : la vérification porte
  // sur tout le numéro.
  const refusBail = refusCoeditionNumero(racine);
  if (refusBail) { vscode.window.showWarningMessage(refusBail); return; }
  const choix = await vscode.window.showWarningMessage(
    T('modale.verrouiller.question', [titreNumero(racine)]),
    { modal: true, detail: TP('modale.verrouiller.detail', profilCourant()) },
    T('modale.verrouiller.bouton'));
  if (choix !== T('modale.verrouiller.bouton')) { return; }
  const erreur = ctx.ecrireClesAusgabe(racine, { locked: 'true' });
  if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', ['ausgabe.yaml', erreur])); return; }
  fermerFormulairesEcriture(null, null);           // un formulaire ouvert écrit par fs
  rafraichirTout();
  vscode.window.setStatusBarMessage(TP('statut.verrouille', profilCourant()), 4000);
}

async function archiverEtVerrouiller(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  // Le dossier va être déplacé : personne ne doit être en train d'écrire dedans.
  const refusBail = refusCoeditionNumero(racine);
  if (refusBail) { vscode.window.showWarningMessage(refusBail); return; }
  // Déjà archivé : il ne reste qu'à reposer le verrou.
  if (session.etatNumero().archivee) {
    if (session.etatNumero().verrouillee) {
      // Les deux drapeaux s'écrivent avant le déplacement (étape 1 ci-dessous) : si le
      // déplacement échoue (fenêtre pas encore fermée, dossier tenu par OneDrive), le numéro
      // reste marqué archivé parmi les numéros en cours. Le script est idempotent (déjà à
      // sa place, il le dit et rouvre le dossier) : le relancer d'ici permet de le ranger.
      const ranger = T('arch.ranger.bouton');
      if (await vscode.window.showInformationMessage(TP('info.deja.archivee', profilCourant()), ranger) !== ranger) { return; }
      const erreurReprise = lancerArchivage('archiver', racine);
      if (erreurReprise) { vscode.window.showErrorMessage(TP('err.archivage', profilCourant(), [erreurReprise])); return; }
      vscode.window.setStatusBarMessage(T('statut.archivage'), 10000);
      await fermerFenetreApresArchivage();
      return;
    }
    await verrouillerSeulement(fournisseur, rafraichirTout);
    return;
  }
  // Une image appelée mais absente sort en cadre vide dans le PDF : ce PDF ne s'archive pas.
  const introuvables = imagesIntrouvablesDesUnites(profils.chemins(profilCourant(), racine).unites);
  if (introuvables.length > 0) {
    const liste = introuvables.map((i) => i.slug + ' : ' + i.image).join(', ');
    vscode.window.showWarningMessage(TP('arch.refus.images', profilCourant(), [liste]));
    return;
  }
  const dossierOut = path.join(racine, 'out');
  const bouton = T('modale.archiver.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.archiver.question', [titreNumero(racine)]),
    { modal: true, detail: TP('modale.archiver.detail', profilCourant(), [poidsLisible(tailleDossier(dossierOut))]) },
    bouton);
  if (choix !== bouton) { return; }
  // Une compilation a pu démarrer pendant que la modale attendait la réponse : même refus
  // qu'avant la modale, avant tout effet sur le disque.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }

  // 1. les deux drapeaux seuls : l'étape 2 peut échouer, il faut pouvoir revenir.
  const erreurYaml = ctx.ecrireClesAusgabe(racine, { locked: 'true', archived: 'true' });
  if (erreurYaml) { vscode.window.showErrorMessage(T('err.ecriture', ['ausgabe.yaml', erreurYaml])); return; }

  // 2. fermer les onglets avant de supprimer out/ : un PDF affiché est verrouillé par
  //    Windows. En cas d'échec, les drapeaux sont relevés avant tout déplacement.
  await ctx.fermerTousLesApercus();
  await ctx.fermerOngletsSous(dossierOut);
  session.poserApercuCourantUri(null);
  session.poserApercuCourantSlug(null);
  // out/ tient l'essentiel du volume. S'il résiste à la suppression, l'archivage continue :
  // archive-revue.ps1 le supprime aussi, une fois cette fenêtre fermée et ses poignées sur
  // les fichiers rendues.
  const erreurOut = await ctx.supprimerAvecReprises(dossierOut);
  if (erreurOut) { vscode.window.showWarningMessage(T('avert.out.suppression', [erreurOut])); }

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
    vscode.window.showErrorMessage(TP('err.archivage', profilCourant(), [erreurScript]));
    return;                                        // le numéro reste gelé, à sa place
  }
  vscode.window.setStatusBarMessage(T('statut.archivage'), 10000);
  await fermerFenetreApresArchivage();
}

// Retour dans l'arborescence « en cours ». Le verrou n'est pas levé pour autant.
async function desarchiver(fournisseur, rafraichirTout) {
  const racine = fournisseur.racine;
  if (!racine) { return; }
  if (!session.etatNumero().archivee) { vscode.window.showInformationMessage(TP('info.deja.encours', profilCourant())); return; }
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const bouton = T('modale.desarchiver.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.desarchiver.question', [titreNumero(racine)]),
    { modal: true, detail: TP('modale.desarchiver.detail', profilCourant()) }, bouton);
  if (choix !== bouton) { return; }
  // Une compilation a pu démarrer pendant que la modale attendait la réponse : même refus
  // qu'avant la modale, avant tout effet sur le disque.
  if (session.buildEnCours() || session.importEnCours()) {
    vscode.window.setStatusBarMessage(T('statut.occupe'), 3000);
    return;
  }
  const erreurYaml = ctx.ecrireClesAusgabe(racine, { archived: 'false' });
  if (erreurYaml) { vscode.window.showErrorMessage(T('err.ecriture', ['ausgabe.yaml', erreurYaml])); return; }
  await ctx.fermerTousLesApercus();
  session.poserApercuCourantUri(null);
  session.poserApercuCourantSlug(null);
  rafraichirTout();
  const erreurScript = lancerArchivage('desarchiver', racine);
  if (erreurScript) { vscode.window.showErrorMessage(TP('err.desarchivage', profilCourant(), [erreurScript])); return; }
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
    vscode.window.showInformationMessage(TP('info.deja.deverrouillee', profilCourant()));
    return;
  }
  const bouton = T('modale.deverrouiller.bouton');
  const choix = await vscode.window.showWarningMessage(
    T('modale.deverrouiller.question', [titreNumero(racine)]),
    { modal: true, detail: TP('modale.deverrouiller.detail', profilCourant()) }, bouton);
  if (choix !== bouton) { return; }
  const erreur = ctx.ecrireClesAusgabe(racine, { locked: 'false' });
  if (erreur) { vscode.window.showErrorMessage(T('err.ecriture', ['ausgabe.yaml', erreur])); return; }
  appliquerEtVerifierVerrou(racine, false);
  session.poserRacineVerrou(racine);
  rafraichirTout();
  vscode.window.setStatusBarMessage(TP('statut.deverrouille', profilCourant()), 5000);
}

// ---- Copies en conflit déjà déposées par OneDrive -------------------------------------
//
// Le bail réduit la fenêtre de collision sans la fermer (il voyage par OneDrive, en
// quelques secondes à quelques minutes). Une copie en conflit apparue malgré tout est
// signalée : une version du travail n'est plus dans le numéro.
//
// Un avertissement par fichier et par session : le rafraîchissement passe souvent ici. Le
// bouton ouvre le comparateur de l'éditeur (vscode.diff), la copie à gauche, la version du
// numéro à droite.
let copiesSignalees = new Set();
let dernierBalayageCopies = 0;

// Le délai entre deux balayages du dossier : rafraichirTout passe ici à chaque action et à
// chaque rafale du système de fichiers, et parcourir tout le numéro à cette cadence
// coûterait trop.
const DELAI_BALAYAGE_COPIES = 15000;

function oublierCopiesSignalees() { copiesSignalees = new Set(); dernierBalayageCopies = 0; }

// ---- Le dossier partagé de l'outil ----------------------------------------------------
//
// OneDrive dépose aussi des copies en conflit dans le dossier que l'outil s'écrit à
// lui-même (`_Systeme` : rapports d'erreur, journaux, suggestions de traduction, inventaire
// des postes), où plusieurs postes écrivent les mêmes fichiers. Une copie y passerait
// inaperçue : elle n'appartient à aucun numéro, et personne n'ouvre ce dossier à la main.
//
// Le dossier est le parent de celui des rapports : le segment du nom de l'application vit
// à un seul endroit (SEGMENT_APPLICATION, lib/rapport-erreur.js). L'ancrage est résolu sans
// balayage de disque ni fenêtre, comme pour l'écriture des rapports.
function dossierPartageOutil() {
  try {
    const rapports = resoudreDossierRapports(resoudreAncrage());
    if (!rapports) { return null; }
    return path.dirname(rapports);
  } catch (e) { return null; }
}

// Le dossier partagé et ses sous-dossiers directs (chercherCopiesPlat) : quelques readdir,
// au même rythme que le balayage du numéro. Une exception rend une liste vide.
function copiesDuDossierPartage() {
  const partage = dossierPartageOutil();
  if (!partage) { return []; }
  try { return chercherCopiesPlat(partage, 1); } catch (e) { return []; }
}

function avertirCopiesConflit(racine) {
  if (!racine) { majConflitsScm(null, []); return; }
  const maintenant = Date.now();
  if (maintenant - dernierBalayageCopies < DELAI_BALAYAGE_COPIES) { return; }
  dernierBalayageCopies = maintenant;
  let copies = [];
  try { copies = chercherCopies(racine); } catch (e) { return; }   // erreur ignorée
  // Le numéro d'abord, le dossier partagé ensuite : une copie dans le numéro ouvert passe
  // avant une copie dans un dossier de service. Chaque liste est triée pour elle-même.
  copies = sansCopiesRedondantes(copies.concat(copiesDuDossierPartage()));
  // La barre du contrôle de source suit chaque balayage : elle garde la liste sous la main
  // quand l'avertissement a été fermé.
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

// La copie à gauche, la version du numéro à droite. Si le fichier d'origine manque
// (OneDrive a pu renommer les deux versions), la copie s'ouvre seule.
function comparerConflit(cheminFichier, cheminCopie) {
  const copie = cheminCopie || (cheminFichier ? copieConflitPour(cheminFichier) : null);
  if (!copie) {
    // Rien à comparer : le fichier visé est peut-être la copie elle-même. On l'ouvre.
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
  return proposerTrancherConflit(cheminFichier, copie);
}

// À côté de la comparaison, trancher tout le fichier d'un coup : garder sa version (la copie
// est supprimée) ou prendre celle de la copie (elle remplace le fichier, puis disparaît).
// Chaque choix demande confirmation ; la résolution bloc par bloc passe par la gouttière.
async function proposerTrancherConflit(chemin, copie) {
  const garder = T('conflit.trancher.garder');
  const prendre = T('conflit.trancher.prendre');
  const choix = await vscode.window.showWarningMessage(
    T('conflit.trancher', [path.basename(chemin)]), garder, prendre);
  if (choix === garder) { await supprimerCopieConflit(copie, true); return; }
  if (choix === prendre) { await prendreCopieConflit(chemin, copie); }
}

async function prendreCopieConflit(chemin, copie) {
  const bouton = T('conflit.trancher.prendre');
  const ok = await vscode.window.showWarningMessage(
    T('conflit.trancher.prendre.question', [path.basename(chemin)]),
    { modal: true, detail: T('conflit.trancher.prendre.detail') }, bouton);
  if (ok !== bouton) { return; }
  // Les mêmes gardes que « Prendre cette version », bloc par bloc.
  if (refuserSiVerrouille()) { return; }
  const racine = ctx.trouverRacineRevue();
  const refus = refusCoedition(racine, chemin);
  if (refus) { vscode.window.showWarningMessage(refus); return; }
  let sien;
  try { sien = fs.readFileSync(copie, 'utf8'); }
  catch (e) { vscode.window.showWarningMessage(T('conflit.copie.absente')); return; }
  try {
    // Par l'éditeur, pour que la modification s'annule au Ctrl+Z.
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(chemin));
    const edition = new vscode.WorkspaceEdit();
    const fin = doc.lineAt(doc.lineCount - 1).range.end;
    edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), sien);
    if (!(await vscode.workspace.applyEdit(edition))) {
      vscode.window.showErrorMessage(T('err.ecriture', [path.basename(chemin), chemin]));
      return;
    }
    await doc.save();
  } catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [path.basename(chemin), String((e && e.message) || e)]));
    return;
  }
  rafraichirEmpreinteCoedition(racine, chemin);
  await supprimerCopieConflit(copie, false);
}

// ---- Résoudre une copie en conflit au clic, bloc par bloc -------------------------
//
// Le « diff rapide » de l'éditeur (QuickDiffProvider) déclare la copie en conflit comme
// original du fichier du numéro : chaque divergence reçoit sa marque dans la gouttière, et
// le clic sur la marque ouvre le diff en ligne, dont la barre de titre porte deux commandes :
//   « Prendre cette version » écrit le bloc de la copie dans le fichier du numéro ;
//   « Garder la mienne »      écrit le bloc du fichier du numéro dans la copie.
// Dans les deux cas la divergence disparaît. Quand il n'en reste aucune, la copie est
// supprimée : rien n'a été perdu. Même chose quand la résolution se fait à la main puis
// s'enregistre (copieResolueEnregistree), ou quand le balayage trouve une copie identique.
//
// Aucun diff n'est calculé ici : les blocs arrivent de l'éditeur, en argument des commandes
// (uri du document, tableau des blocs, index du bloc affiché), selon le contrat du menu
// « scm/change/title », celui dont Git se sert pour « Stage Change ».
//
// Le fournisseur de diff rapide est une propriété d'un SourceControl, seule voie stable de
// l'API. Il n'est créé que s'il existe une copie en conflit dans le numéro, et détruit dès
// qu'il n'en reste plus : un poste sans conflit n'a pas d'entrée vide dans la barre du
// contrôle de source.
const SCHEME_CONFLIT = 'szh-conflit';

let scmConflits = null;
let groupeConflits = null;
const changementConflit = new vscode.EventEmitter();

// Le chemin caché dans une URI « szh-conflit ». uri.fsPath traite les lettres de lecteur
// Windows selon le schéma « file » : on lit donc le chemin tel que Uri.file l'a écrit
// (« /c:/… ») et on retire la barre de tête. Pas de décodage : `path` est déjà décodé, et
// un « % » dans un nom de fichier ferait lever decodeURIComponent.
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

// Appelé par l'éditeur pour chaque document ouvert : rendre une URI demande les marques de
// gouttière, ne rien rendre n'en pose aucune. Un fichier hors du numéro est ignoré, sinon
// ouvrir un fichier quelconque ferait lire son dossier à chaque fois.
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

// Libère le contrôle de source des conflits, créé à la demande : appelée à l'extinction.
function libererScm() {
  if (scmConflits) { scmConflits.dispose(); }
  scmConflits = null;
  groupeConflits = null;
}

// Le bloc affiché, ou null : le menu passe le tableau entier et l'index du bloc regardé, et
// un clic tardif sur un diff recalculé entre-temps peut sortir du tableau.
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
  catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(chemin), chemin])); return; }
  const mien = doc.getText();                      // le tampon, pas le disque : une frappe non
  let sien = '';                                   // enregistrée compte comme « ma version »
  try { sien = fs.readFileSync(copie, 'utf8'); }
  catch (e) { vscode.window.showWarningMessage(T('conflit.copie.absente')); return; }

  if (prendre) {
    // Le fichier du numéro change : le verrou du numéro d'abord, le bail de co-édition
    // ensuite. Un clic isolé vérifie le bail sans en poser.
    if (refuserSiVerrouille()) { return; }
    const racine = ctx.trouverRacineRevue();
    const refus = refusCoedition(racine, chemin);
    if (refus) { vscode.window.showWarningMessage(refus); return; }
    const texte = appliquerBlocs(mien, sien, [inverserBloc(bloc)]);
    if (texte === mien) { return; }                // rien à faire, bloc déjà résolu
    // Par l'éditeur et non par fs : le document est ouvert, et la modification doit rester
    // annulable au Ctrl+Z.
    try {
      const edition = new vscode.WorkspaceEdit();
      const fin = doc.lineAt(doc.lineCount - 1).range.end;
      edition.replace(doc.uri, new vscode.Range(new vscode.Position(0, 0), fin), texte);
      if (!(await vscode.workspace.applyEdit(edition))) {
        vscode.window.showErrorMessage(T('err.ecriture', [path.basename(chemin), chemin]));
        return;
      }
      await doc.save();
    } catch (e) {
      vscode.window.showErrorMessage(T('err.ecriture', [path.basename(chemin), String((e && e.message) || e)]));
      return;
    }
    // L'écriture n'est pas passée par le point d'écriture du fichier du numéro : les
    // formulaires ouverts doivent quand même savoir que le disque a changé.
    rafraichirEmpreinteCoedition(racine, chemin);
    if (memeContenu(texte, sien)) { await supprimerCopieConflit(copie, false); }
    return;
  }

  // L'autre sens. La copie n'est pas un fichier du numéro : aucun bail ne la protège, et elle
  // est destinée à disparaître. Écriture atomique directe.
  const texte = appliquerBlocs(sien, mien, [bloc]);
  if (texte === sien) { return; }
  try { ecrireAtomique(copie, texte); }
  catch (e) {
    vscode.window.showErrorMessage(T('err.ecriture', [path.basename(copie), String((e && e.message) || e)]));
    return;
  }
  // Le contenu « original » a changé : sans cet avis, la gouttière garderait ses marques.
  changementConflit.fire(vscode.Uri.file(copie).with({ scheme: SCHEME_CONFLIT }));
  // Une frappe non enregistrée fait partie de « ma version » : la copie attend alors
  // l'enregistrement (copieResolueEnregistree), pour que fermer sans enregistrer ne perde rien.
  if (memeContenu(texte, mien) && !doc.isDirty) { await supprimerCopieConflit(copie, false); }
}

// Après un enregistrement : si le fichier enregistré et sa copie en conflit ne diffèrent
// plus, la copie est retirée. C'est le chemin d'une résolution faite à la main dans la
// comparaison.
function copieResolueEnregistree(chemin) {
  if (!sousLaRacineConflits(chemin)) { return; }
  const dossier = path.dirname(chemin);
  const verdict = estCopieConflit(path.basename(chemin),
    (voisin) => fs.existsSync(path.join(dossier, voisin)));
  const original = verdict ? path.join(dossier, verdict.original) : chemin;
  const copie = verdict ? chemin : copieConflitPour(chemin);
  if (copie && copieRedondante(original, copie)) { supprimerCopieConflit(copie, false); }
}

// Les copies identiques à leur original sont supprimées sans avertissement : restées sur le
// disque, elles se réannonceraient à chaque ouverture du numéro.
function sansCopiesRedondantes(copies) {
  return copies.filter((c) => {
    if (!copieRedondante(c.cheminOriginal, c.chemin)) { return true; }
    try { fs.unlinkSync(c.chemin); } catch (e) { return true; }
    copieOubliee(c.chemin);
    return false;
  });
}

// `demander` : la commande explicite demande confirmation, car la copie peut contenir encore
// du travail. La suppression après convergence ne perd rien et ne demande rien.
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
  catch (e) { vscode.window.showErrorMessage(T('err.ecriture', [path.basename(copie), String((e && e.message) || e)])); return; }
  copieOubliee(copie);
  rafraichirConflitsScm();
}

// Ce qui suit la suppression d'une copie, hors contrôle de source.
function copieOubliee(copie) {
  // Retirée des fichiers déjà signalés : une nouvelle copie déposée plus tard sera annoncée.
  copiesSignalees.delete(copie);
  // Le fournisseur de contenu doit savoir que la copie a disparu, sinon la gouttière
  // continuerait de comparer avec elle.
  changementConflit.fire(vscode.Uri.file(copie).with({ scheme: SCHEME_CONFLIT }));
  vscode.window.setStatusBarMessage(T('conflit.copie.supprimee', [path.basename(copie)]), 4000);
}

// L'état de la barre du contrôle de source, hors balayage : après une suppression, qu'aucun
// surveillant de fichiers ne signale (les motifs surveillés ne couvrent pas les noms déposés
// par OneDrive). Ne déclenche aucun avertissement.
function rafraichirConflitsScm() {
  const racine = ctx.trouverRacineRevue();
  if (!racine) { majConflitsScm(null, []); return; }
  let copies = [];
  try { copies = chercherCopies(racine); } catch (e) { copies = []; }
  majConflitsScm(racine, sansCopiesRedondantes(copies.concat(copiesDuDossierPartage())));
}

module.exports = {
  configurer,
  etatCourant, compilationAutoCoupee, refuserSiArchivee, refuserSiVerrouille,
  appliquerEtVerifierVerrou, majEtatNumero, majBarreEtatNumero, titreVue,
  avertirVersionSiDivergente, poidsLisible, fermerFormulairesEcriture,
  verrouillerSeulement, archiverEtVerrouiller, desarchiver, deverrouiller,
  fermerFenetreApresArchivage,
  oublierCopiesSignalees, avertirCopiesConflit, comparerConflit,
  dossierPartageOutil, copiesDuDossierPartage,
  SCHEME_CONFLIT, fournisseurContenuConflit, fournisseurDiffConflit,
  cheminDepuisUriConflit, fichierConflitVise, resoudreBlocConflit, supprimerCopieConflit,
  copieResolueEnregistree, rafraichirConflitsScm, majConflitsScm, libererScm
};
