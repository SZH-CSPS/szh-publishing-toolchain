// Le lanceur dans l'éditeur : son panneau, ses données, l'ouverture d'un numéro et sa
// création. Il ne s'ouvre seul que sous la porte SZH_ACCUEIL=1 et sans dossier ouvert.
'use strict';

const vscode = require('vscode');
const path = require('path');

const { T, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const { construireHtml } = require('./webviews/util');
const { panneauUnique } = require('./webviews/panneau');
const inventaire = require('./inventaire');
const nouveau = require('./lanceur-nouveau');
const { textesLanceur, LIBELLES_PRODUITS, produitParDefaut, numeroAffiche } = require('./lanceur-page');
const { versionInstallee, lancerChoixVersion } = require('./archivage');
const { lireEtatUtilisateur } = require('./rapport-erreur');
const secretariat = require('./lanceur-secretariat-hote');
const journal = require('./lanceur-journal-hote');

const VIEW_TYPE = 'szhLanceur';
const CONTEXTE_ACTIF = 'szh.lanceur.actif';
// Par compte : le dernier numéro ouvert depuis le lanceur, qu'il propose en premier.
const CLE_DERNIER = 'szh.lanceur.dernier';

let ctx = {
  repondreModeTrad: require('./traduction-hote').repondreModeTrad
};
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

let etatPoste = null;
let panneauActif = null;
// Les dossiers envoyés à la page : elle n'ouvre que ceux-là.
let cheminsConnus = new Set();
let anneesZero = null;

function porteOuverte() { return process.env.SZH_ACCUEIL === '1'; }
function sansDossier() {
  const dossiers = vscode.workspace.workspaceFolders;
  return !dossiers || dossiers.length === 0;
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
  const choisi = (lireEtatUtilisateur() || {}).ongletDefaut;
  return {
    type: MSG.CHARGER, langue,
    produit: produitParDefaut(langue, choisi, process.env.SZH_ONGLET, inventaire.ORDRE),
    anneeCourante: new Date().getFullYear(), modeTest: inv.modeTest, ancrageAbsent: inv.ancrageAbsent,
    version: versionInstallee(), exports: path.join(inv.base, 'Exports'), produits,
    dernierOuvert: (etatPoste && etatPoste.globalState.get(CLE_DERNIER)) || '',
    historique: secretariat.historique(), journaux: journal.listePage()
  };
}

async function envoyerDonnees(panneau) {
  repondre(panneau, await donnees());
}

// Le dossier s'ouvre dans cette fenêtre, et devient le dernier ouvert. Un export en cours
// ne survit pas au changement de dossier.
async function ouvrirDossier(chemin) {
  secretariat.arreter();
  if (etatPoste) { await etatPoste.globalState.update(CLE_DERNIER, chemin); }
  await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(chemin), { forceReuseWindow: true });
}

// Le refus du socle, dit dans la langue de l'interface. Les numéros s'écrivent « 2026-03 ».
function texteRefus(r) {
  const v = r || {};
  if (v.refus === 'existe') { return T('lanceur.nouveau.refus.existe', [v.nom]); }
  if (v.refus === 'doublon') {
    return T(v.archive ? 'lanceur.nouveau.refus.doublon.archive' : 'lanceur.nouveau.refus.doublon',
      [v.volume, v.numero, v.nom]);
  }
  if (v.refus === 'reference') { return T('lanceur.nouveau.refus.reference', [v.reference, v.titre || v.nom]); }
  if (v.refus === 'delai') { return T('lanceur.nouveau.refus.delai'); }
  return String(v.texte || '');
}

async function creer(msg, panneau) {
  const script = nouveau.scriptCreation(msg);
  if (!script) {
    repondre(panneau, { type: MSG.LANCEUR_CREE, ok: false, texte: T('lanceur.nouveau.refus.demande') });
    return;
  }
  const r = await nouveau.executer(script);
  if (r && r.ok && r.chemin) { await ouvrirDossier(r.chemin); return; }
  repondre(panneau, { type: MSG.LANCEUR_CREE, ok: false, texte: texteRefus(r) });
}

// Les messages du Secrétariat et du Log vont à leur module.
async function surMessage(msg, panneau) {
  if (secretariat.surMessage(msg) || journal.surMessage(msg)) { return; }
  if (msg.type === MSG.LANCEUR_OUVRIR) {
    if (cheminsConnus.has(msg.chemin)) { await ouvrirDossier(msg.chemin); }
    return;
  }
  if (msg.type === MSG.LANCEUR_VERSIONS) {
    const erreur = lancerChoixVersion();
    if (erreur) { vscode.window.showErrorMessage(T('err.version.lancement', [erreur])); }
    return;
  }
  if (msg.type === MSG.LANCEUR_CREER) { await creer(msg, panneau); }
}

function htmlLanceur(nonce) {
  return construireHtml('lanceur', nonce, {
    cssPartage: ['_design.css'], jsPartage: ['_messages.js'], titre: T('arbre.titre.defaut'),
    remplacements: { '__TXT__': JSON.stringify(textesLanceur()) }
  });
}

function ouvrirLanceur() {
  const { panneau } = panneauUnique({
    viewType: VIEW_TYPE, titre: T('arbre.titre.defaut'), retenir: true,
    modeTrad: (panneau, msg) => ctx.repondreModeTrad(panneau, msg),
    html: htmlLanceur,
    surPret: (msg, p) => envoyerDonnees(p),
    surMessage: (msg, p) => surMessage(msg, p),
    surFermeture: () => { panneauActif = null; secretariat.arreter(); }
  });
  panneauActif = panneau;
  return panneau;
}

// Les deux onglets parlent à la page par le panneau ouvert, et à l'éditeur par ces rappels.
function configurerOnglets() {
  const envoyer = (m) => { if (panneauActif) { repondre(panneauActif, m); } };
  const revelerFichier = (chemin) => vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(chemin));
  const ouvrirDossierOs = (chemin) => vscode.env.openExternal(vscode.Uri.file(chemin));
  secretariat.configurer({ envoyer, revelerFichier, ouvrirDossier: ouvrirDossierOs, memoire: etatPoste && etatPoste.globalState,
    numerosConnus: () => cheminsConnus });
  journal.configurer({ envoyer, ouvrirDossier: ouvrirDossierOs,
    ouvrirEditeur: (chemin) => vscode.window.showTextDocument(vscode.Uri.file(chemin), { preview: false }),
    ouvrirLien: (uri) => vscode.env.openExternal(vscode.Uri.parse(uri)),
    versionEditeur: () => vscode.version || null });
}

// À la désactivation : aucun enfant ne survit à l'éditeur.
function arreter() { secretariat.arreter(); }

// À l'activation : la clé de contexte de la porte, la commande, et l'ouverture d'office
// quand la porte est ouverte sur une fenêtre sans dossier.
function demarrer(context) {
  etatPoste = context;
  configurerOnglets();
  const actif = porteOuverte();
  vscode.commands.executeCommand('setContext', CONTEXTE_ACTIF, actif);
  context.subscriptions.push(vscode.commands.registerCommand('szh.lanceur', () => ouvrirLanceur()));
  if (actif && sansDossier()) { ouvrirLanceur(); }
}

module.exports = {
  configurer, demarrer, ouvrirLanceur, donnees, texteRefus, arreter,
  VIEW_TYPE, CONTEXTE_ACTIF, CLE_DERNIER
};
