// L'Accueil dans l'éditeur : son panneau, ses données, l'ouverture d'un numéro et sa
// création. Il s'ouvre seul dans une fenêtre sans dossier ni onglet.
'use strict';

const vscode = require('vscode');
const path = require('path');
const crypto = require('crypto');

const { T, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const { construireHtml } = require('./webviews/util');
const { panneauUnique } = require('./webviews/panneau');
const inventaire = require('./inventaire');
const nouveau = require('./accueil-nouveau');
const { textesAccueil, LIBELLES_PRODUITS, produitParDefaut, numeroAffiche } = require('./accueil-page');
const { versionInstallee, lancerChoixVersion } = require('./archivage');
const secretariat = require('./accueil-secretariat-hote');
const journal = require('./accueil-journal-hote');
const reglages = require('./accueil-reglages-hote');
const preproc = require('./accueil-preproc-hote');

const VIEW_TYPE = 'szhAccueil';
// Par compte : le dernier numéro ouvert depuis l'Accueil, qu'il propose en premier.
// Valeur gardée du temps du « lanceur » : les postes l'ont déjà écrite.
const CLE_DERNIER = 'szh.lanceur.dernier';

let ctx = {
  repondreModeTrad: require('./traduction-hote').repondreModeTrad,
  rafraichirTout: null,    // posé par extension.js : l'arbre suit un réglage qui change ses libellés
  // Après un openFolder qui n'a pas remplacé la fenêtre : le numéro était ouvert ailleurs.
  delaiFermeture: 1500
};
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

let etatPoste = null;
let panneauActif = null;
// Les dossiers envoyés à la page : elle n'ouvre que ceux-là.
let cheminsConnus = new Set();
let anneesZero = null;
// L'onglet que la prochaine charge de la page doit ouvrir (szh.reglages), consommé par donnees().
let ongletDemande = '';

// Une seule relecture, quand la fenêtre avait un onglet à l'activation, et une seule fermeture
// en attente après un openFolder.
let relecture = null;
let fermeture = null;

function sansDossier() {
  const dossiers = vscode.workspace.workspaceFolders;
  return !dossiers || dossiers.length === 0;
}
function sansOnglet() {
  return ((vscode.window.tabGroups && vscode.window.tabGroups.all) || []).every((g) => !g.tabs || g.tabs.length === 0);
}

function repondre(panneau, message) {
  try { panneau.webview.postMessage(message); } catch (e) { /* panneau fermé */ }
}

function jourLisible(date) {
  if (!date) { return ''; }
  const p2 = (n) => String(n).padStart(2, '0');
  return p2(date.getDate()) + '.' + p2(date.getMonth() + 1) + '.' + date.getFullYear();
}

// Une fois par session : l'année zéro du volume ne change qu'avec le socle.
function anneesDuVolume() {
  if (!anneesZero) {
    anneesZero = nouveau.executer(nouveau.scriptAnnees())
      .then((r) => (r && Number.isInteger(r.revue) ? r : {}));
  }
  return anneesZero;
}

async function donnees() {
  const inv = inventaire.inventaire();
  const zero = await anneesDuVolume();
  const langue = langueCockpit();
  const entree = (livre) => (e) => ({ nom: livre ? e.nom : numeroAffiche(e.nom), titre: e.titre, chemin: e.chemin,
    modifie: jourLisible(e.modifie), verrouillee: e.verrouillee });
  cheminsConnus = new Set();
  const produits = inventaire.ORDRE.map((jeton) => {
    const p = inv.produits[jeton];
    for (const e of p.enCours.concat(p.archives)) { cheminsConnus.add(e.chemin); }
    const livre = jeton === 'livre';
    const fiche = { jeton, libelle: LIBELLES_PRODUITS[jeton], type: livre ? 'livre' : 'numero', racine: p.racineEnCours,
      hors: p.hors, enCours: p.enCours.map(entree(livre)), archives: p.archives.map(entree(livre)) };
    if (zero[jeton]) { fiche.anneeZeroVolume = zero[jeton]; }
    return fiche;
  });
  const choisi = vscode.workspace.getConfiguration('szh').get('produitParDefaut', '');
  const onglet = ongletDemande;
  ongletDemande = '';
  return {
    type: MSG.CHARGER, langue, onglet,
    produit: produitParDefaut(langue, choisi, process.env.SZH_ONGLET, inventaire.ORDRE),
    anneeCourante: new Date().getFullYear(), modeTest: inv.modeTest, ancrageAbsent: inv.ancrageAbsent,
    version: versionInstallee(), exports: path.join(inv.base, 'Exports'), produits,
    dernierOuvert: (etatPoste && etatPoste.globalState.get(CLE_DERNIER)) || '',
    historique: secretariat.historique(), journaux: journal.listePage()
  };
}

async function envoyerDonnees(panneau) {
  repondre(panneau, await donnees());
  repondre(panneau, reglages.messageValeurs());
}

// Le dossier s'ouvre dans cette fenêtre, et devient le dernier ouvert. Un export en cours
// ne survit pas au changement de dossier. Déjà ouvert ailleurs, il ne remplace pas cette
// fenêtre : l'autre passe devant, et celle-ci, restée vide et sans focus, se ferme. Aucune
// API ne dit où un dossier est ouvert ; un rechargement qui traîne garde le focus, et la
// désactivation annule la fermeture.
async function ouvrirDossier(chemin) {
  secretariat.arreter();
  preproc.arreter();
  if (etatPoste) { await etatPoste.globalState.update(CLE_DERNIER, chemin); }
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(chemin), { forceReuseWindow: true });
  if (fermeture) { clearTimeout(fermeture); }
  fermeture = setTimeout(() => {
    fermeture = null;
    const focus = vscode.window.state && vscode.window.state.focused;
    if (sansDossier() && focus === false) { vscode.commands.executeCommand('workbench.action.closeWindow'); }
  }, ctx.delaiFermeture);
  if (fermeture.unref) { fermeture.unref(); }
}

// Le refus du socle, dit dans la langue de l'interface. Les numéros s'écrivent « 2026-03 ».
function texteRefus(r) {
  const v = r || {};
  if (v.refus === 'existe') { return T('accueil.nouveau.refus.existe', [v.nom]); }
  if (v.refus === 'doublon') {
    return T(v.archive ? 'accueil.nouveau.refus.doublon.archive' : 'accueil.nouveau.refus.doublon',
      [v.volume, v.numero, v.nom]);
  }
  if (v.refus === 'reference') { return T('accueil.nouveau.refus.reference', [v.reference, v.titre || v.nom]); }
  if (v.refus === 'delai') { return T('accueil.nouveau.refus.delai'); }
  return String(v.texte || '');
}

async function creer(msg, panneau) {
  const script = nouveau.scriptCreation(msg);
  if (!script) {
    repondre(panneau, { type: MSG.ACCUEIL_CREE, ok: false, texte: T('accueil.nouveau.refus.demande') });
    return;
  }
  const r = await nouveau.executer(script);
  if (r && r.ok && r.chemin) { await ouvrirDossier(r.chemin); return; }
  repondre(panneau, { type: MSG.ACCUEIL_CREE, ok: false, texte: texteRefus(r) });
}

// Les messages du Secrétariat et du Log vont à leur module.
async function surMessage(msg, panneau) {
  if (secretariat.surMessage(msg) || journal.surMessage(msg) || preproc.surMessage(msg)) { return; }
  if (msg.type === MSG.ACCUEIL_ONGLET) { reglages.surOnglet(msg.onglet, (m) => repondre(panneau, m)); return; }
  if (await reglages.surMessage(msg, (m) => repondre(panneau, m))) { return; }
  if (msg.type === MSG.ACCUEIL_OUVRIR) {
    if (cheminsConnus.has(msg.chemin)) { await ouvrirDossier(msg.chemin); }
    return;
  }
  if (msg.type === MSG.ACCUEIL_VERSIONS) {
    const erreur = lancerChoixVersion();
    if (erreur) { vscode.window.showErrorMessage(T('err.version.lancement', [erreur])); }
    return;
  }
  if (msg.type === MSG.ACCUEIL_CREER) { await creer(msg, panneau); }
}

function htmlAccueil(nonce) {
  return construireHtml('accueil', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'], titre: T('accueil.titre'),
    remplacements: { '__TXT__': JSON.stringify(textesAccueil()) }
  });
}

// `onglet` : l'onglet à montrer d'emblée (la commande szh.reglages demande « reglages »).
function ouvrirAccueil(opts) {
  const onglet = (opts && opts.onglet) || '';
  if (onglet) { ongletDemande = onglet; }
  const { panneau, nouveau } = panneauUnique({
    viewType: VIEW_TYPE, titre: T('accueil.titre'), retenir: true,
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlAccueil,
    surPret: (msg, p) => envoyerDonnees(p).then(() => preproc.envoyerEtat()),
    surMessage: (msg, p) => surMessage(msg, p),
    surFermeture: () => { panneauActif = null; secretariat.arreter(); reglages.arreter(); preproc.arreter(); }
  });
  panneauActif = panneau;
  if (!nouveau && onglet) {
    ongletDemande = '';
    repondre(panneau, { type: MSG.ACCUEIL_ALLER, onglet });
  }
  return panneau;
}

// Après un changement de langue : la page se reconstruit dans la nouvelle, sur le même onglet.
function rechargerPage(onglet) {
  if (!panneauActif) { return; }
  ongletDemande = onglet || 'reglages';
  panneauActif.webview.html = htmlAccueil(crypto.randomBytes(16).toString('hex'));
}

// Les deux onglets parlent à la page par le panneau ouvert, et à l'éditeur par ces rappels.
function configurerOnglets() {
  const envoyer = (m) => { if (panneauActif) { repondre(panneauActif, m); } };
  const revelerFichier = (chemin) => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(chemin));
  const ouvrirDossierOs = (chemin) => vscode.env.openExternal(vscode.Uri.file(chemin));
  secretariat.configurer({ envoyer, revelerFichier, ouvrirDossier: ouvrirDossierOs, memoire: etatPoste && etatPoste.globalState,
    numerosConnus: () => cheminsConnus });
  reglages.configurer({ rafraichirTout: (opts) => { if (ctx.rafraichirTout) { ctx.rafraichirTout(opts); } },
    recharger: () => { if (panneauActif) { envoyerDonnees(panneauActif); } },
    rechargerPage: () => rechargerPage('reglages') });
  journal.configurer({ envoyer, ouvrirDossier: ouvrirDossierOs,
    ouvrirEditeur: (chemin) => vscode.window.showTextDocument(vscode.Uri.file(chemin), { preview: false }),
    ouvrirLien: (uri) => vscode.env.openExternal(vscode.Uri.parse(uri)),
    versionEditeur: () => vscode.version || null });
  preproc.configurer({ envoyer, revelerFichier, memoire: etatPoste && etatPoste.globalState,
    formatTravail: () => vscode.workspace.getConfiguration('szh').get('formatTravail', 'docx'),
    ouvrirExterne: (chemin) => vscode.env.openExternal(vscode.Uri.file(chemin)),
    choisirFichier: async (dossier) => {
      const choix = await vscode.window.showOpenDialog({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false,
        defaultUri: dossier ? vscode.Uri.file(dossier) : undefined, filters: { [T('accueil.preproc.filtre')]: ['docx', 'odt'] } });
      return choix && choix[0] ? choix[0].fsPath : null;
    } });
}

// À la désactivation : aucun enfant ne survit à l'éditeur, aucune minuterie ne joue.
function arreter() {
  if (relecture) { clearTimeout(relecture); relecture = null; }
  if (fermeture) { clearTimeout(fermeture); fermeture = null; }
  secretariat.arreter(); reglages.arreter(); preproc.arreter();
}

// À l'activation : la commande, et l'ouverture d'office dans une fenêtre sans dossier ni
// onglet. La mesure la dit fiable dès l'activation ; une relecture à +500 ms couvre un
// onglet qui se fermerait aussitôt.
function demarrer(context) {
  etatPoste = context;
  configurerOnglets();
  reglages.demarrer(context);
  context.subscriptions.push(vscode.commands.registerCommand('szh.accueil', () => ouvrirAccueil()));
  // Le format par défaut change dans les Réglages : l'onglet le reprend aussitôt.
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('szh.formatTravail')) { preproc.envoyerEtat(); }
  }));
  if (!sansDossier()) { return; }
  if (sansOnglet()) { ouvrirAccueil(); return; }
  relecture = setTimeout(() => {
    relecture = null;
    if (sansDossier() && sansOnglet()) { ouvrirAccueil(); }
  }, 500);
  if (relecture.unref) { relecture.unref(); }
}

module.exports = {
  configurer, demarrer, ouvrirAccueil, rechargerPage, donnees, texteRefus, arreter,
  VIEW_TYPE, CLE_DERNIER
};
