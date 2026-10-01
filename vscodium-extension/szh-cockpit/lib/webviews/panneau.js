// La fabrique des panneaux webview du cockpit : un seul panneau par viewType et par clé,
// révélé s'il existe déjà, oublié à sa fermeture, et un seul gestionnaire de messages qui
// passe d'abord le mode « Trad », puis la poignée de main PRET, puis le reste.
//
// Ce qui reste à l'appelant : ce qu'il fait d'un panneau déjà ouvert (renvoyer ses valeurs,
// le focaliser…), ce qui précède la création (fermer les aperçus), et ses messages.
'use strict';

const crypto = require('crypto');
const vscode = require('vscode');
const { MSG } = require('../messages');

// viewType -> Map(clé -> panneau), pour les panneaux sans garde extérieure.
const ouverts = new Map();

// Où vit le panneau courant : par défaut ici ; sinon une Map de l'appelant (clé -> panneau)
// ou une variable qu'il expose par { lire, poser }, comme celles de lib/session.js.
function stockDe(viewType, garde) {
  if (garde && typeof garde.lire === 'function') {
    return {
      get: () => garde.lire() || null,
      set: (cle, p) => garde.poser(p),
      delete: () => garde.poser(null)
    };
  }
  let table = garde;
  if (!table) {
    table = ouverts.get(viewType);
    if (!table) { table = new Map(); ouverts.set(viewType, table); }
  }
  return {
    get: (cle) => table.get(cle) || null,
    set: (cle, p) => table.set(cle, p),
    delete: (cle) => table.delete(cle)
  };
}

function reveler(panneau, colonne) {
  if (colonne && typeof colonne === 'object') { panneau.reveal(colonne.viewColumn, colonne.preserveFocus); }
  else { panneau.reveal(colonne); }
}

function colonneDe(opts) {
  return opts.colonne === undefined ? vscode.ViewColumn.One : opts.colonne;
}

// Le panneau ouvert pour (viewType, clé), sans le révéler ; null s'il n'y en a pas.
function panneauCourant(viewType, cle, garde) {
  return stockDe(viewType, garde).get(cle === undefined ? '' : cle);
}

// Révèle le panneau ouvert et le rend, ou rend null : pour l'appelant qui a quelque chose à
// faire avant de créer le panneau (fermer les aperçus, remettre son état à zéro).
function revelerPanneau(opts) {
  const existant = panneauCourant(opts.viewType, opts.cle, opts.garde);
  if (existant) { reveler(existant, colonneDe(opts)); }
  return existant;
}

// Options : viewType, cle (défaut ''), titre, colonne (une ViewColumn ou
// { viewColumn, preserveFocus }), retenir (retainContextWhenHidden), garde, modeTrad
// (repondreModeTrad de l'hôte ; omis pour les panneaux qui ne détournent pas leurs clics),
// html (nonce -> document), surPret(msg, panneau), surMessage(msg, panneau),
// surFermeture(panneau, courant), courant faux si un autre panneau l'avait déjà remplacé
// dans la garde. Rend { panneau, nouveau } : un panneau déjà ouvert est révélé et
// ses options de création sont ignorées.
function panneauUnique(opts) {
  const cle = opts.cle === undefined ? '' : opts.cle;
  const stock = stockDe(opts.viewType, opts.garde);
  const colonne = colonneDe(opts);
  const existant = stock.get(cle);
  if (existant) {
    reveler(existant, colonne);
    return { panneau: existant, nouveau: false };
  }
  const options = { enableScripts: true, localResourceRoots: [] };
  if (opts.retenir) { options.retainContextWhenHidden = true; }
  const panneau = vscode.window.createWebviewPanel(opts.viewType, opts.titre, colonne, options);
  stock.set(cle, panneau);
  panneau.onDidDispose(() => {
    const courant = stock.get(cle) === panneau;
    if (courant) { stock.delete(cle); }
    if (opts.surFermeture) { opts.surFermeture(panneau, courant); }
  });
  // La promesse d'un gestionnaire est rendue telle quelle : le faux hôte des tests l'attend.
  panneau.webview.onDidReceiveMessage((msg) => {
    if (!msg) { return undefined; }
    if (opts.modeTrad && opts.modeTrad(panneau, msg)) { return undefined; }
    if (msg.type === MSG.PRET && opts.surPret) { return opts.surPret(msg, panneau); }
    return opts.surMessage ? opts.surMessage(msg, panneau) : undefined;
  });
  if (opts.html) { panneau.webview.html = opts.html(crypto.randomBytes(16).toString('hex')); }
  return { panneau, nouveau: true };
}

// Les panneaux ouverts d'un viewType, en [clé, panneau].
function panneauxOuverts(viewType) {
  return Array.from((ouverts.get(viewType) || new Map()).entries());
}

// Ferme le panneau de cette clé, ou tous ceux du viewType sans clé.
function fermerPanneaux(viewType, cle) {
  for (const [c, panneau] of panneauxOuverts(viewType)) {
    if (cle !== undefined && c !== cle) { continue; }
    try { panneau.dispose(); } catch (e) { /* déjà fermé */ }
    const table = ouverts.get(viewType);
    if (table && table.get(c) === panneau) { table.delete(c); }
  }
}

module.exports = { panneauUnique, panneauCourant, revelerPanneau, panneauxOuverts, fermerPanneaux };
