// Pagination continue du numéro, côté cockpit : lecture de l'état (pipeline/pagination.py
// via `make etat-pagination`), rafraîchissement (`make rafraichir-pagination`), et les
// constats qu'un numéro périmé pose dans « À corriger ».
//
// La pagination se fait au bouclage, par un bouton (szh.rafraichirPagination). Ce module ne
// lance pas de compilation de lui-même. Les rappels vers l'hôte passent par configurer() ;
// les tests injectent un `lancer` factice.
//
// `etat-pagination` ne compile ni n'écrit rien : on lit sa sortie standard.
// `rafraichir-pagination` est une vraie compilation : elle écrit dans le même journal que
// tasks.json (`… 2>&1 | tee .szh-journal.log`), que le cockpit relit ensuite.
//
// ORDRE est interpolé dans une ligne shell : chaque slug est donc vérifié (FORME_SLUG de
// lib/articles.js) avant tout lancement.
'use strict';

const fs = require('fs');
const path = require('path');

const moteur = require('./moteur');
const { FORME_SLUG } = require('./articles');

const NOM_ETAT = '.szh-pagination.json';
// Même journal que JOURNAL_TACHE (extension.js) et tasks.json.
const NOM_JOURNAL = '.szh-journal.log';

const SCHEMA = 'szh-pagination/1';

// Même source que MAKEFILE_WSL de lib/pdfua-hote.js : lib/moteur.js.
const MAKEFILE_WSL = moteur.toolkitMoteur('pipeline', 'Makefile');

// Large : pagination.py appelle `make pdf` avant et après le recalcul, soit deux
// compilations du numéro.
const DELAI_MAKE = 600000;

// ---- Rappels vers l'hôte -----------------------------------------------------------
let ctx = { lancer: lancerDefaut };
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// ---- Lancement réel, dans la distro WSL du pipeline --------------------------------
// -> Promise<{ texte, code, erreur }>. Ne rejette jamais : sortie, panne et délai dépassé
// se lisent dans le retour.
function lancerDefaut(racine, argv) {
  return moteur.reveiller().then(() => new Promise((resolve) => {
    let proc;
    try {
      proc = moteur.executer(argv, { cwd: racine, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      resolve({ texte: '', code: null, erreur: String((e && e.message) || e) });
      return;
    }
    const morceaux = [];
    let fini = false;
    let minuteur = null;
    const finir = (r) => {
      if (fini) { return; }
      fini = true;
      if (minuteur) { clearTimeout(minuteur); }
      resolve(r);
    };
    minuteur = setTimeout(() => {
      try { proc.kill(); } catch (e) { /* déjà mort */ }
      finir({ texte: Buffer.concat(morceaux).toString('utf8'), code: null, erreur: 'delai' });
    }, DELAI_MAKE);
    if (proc.stdout) { proc.stdout.on('data', (d) => morceaux.push(d)); }
    proc.on('error', (e) => finir({ texte: Buffer.concat(morceaux).toString('utf8'), code: null,
                                     erreur: String((e && e.message) || e) }));
    proc.on('close', (code) => finir({ texte: Buffer.concat(morceaux).toString('utf8'), code: code, erreur: null }));
  }));
}

// ---- Sécurité : la forme de chaque slug avant toute interpolation shell -----------
// -> '' si l'ordre est sûr, sinon le message d'erreur.
function ordreInvalide(ordre) {
  const liste = Array.isArray(ordre) ? ordre : [];
  for (const s of liste) {
    if (typeof s !== 'string' || !FORME_SLUG.test(s)) {
      return 'ordre de pagination invalide : « ' + String(s) + ' » n’a pas la forme d’un slug.';
    }
  }
  return '';
}

// ---- La ligne JSON au milieu d'une sortie mêlée ------------------------------------
// Seule compte une ligne qui commence par `{"schema"` avec le bon schéma : la sortie peut
// contenir le JSON d'un autre outil (pdf-ua, par exemple).
function extraireEtat(texte) {
  const lignes = String(texte || '').split(/\r?\n/);
  for (const brute of lignes) {
    const ligne = brute.trim();
    if (ligne.indexOf('{"schema"') !== 0) { continue; }
    let obj;
    try { obj = JSON.parse(ligne); } catch (e) { continue; }
    if (obj && obj.schema === SCHEMA) { return obj; }
  }
  return null;
}

// ---- etat-pagination : lecture seule ---------------------------------------------
// -> Promise<etat>, rejetée en cas d'ordre invalide, de panne de lancement, de code non
// nul ou d'absence de ligne JSON reconnue : l'appelant distingue ainsi « rien à signaler »
// de « vérification impossible », notamment avant un export OJS.
function lireEtat(racine, ordre) {
  const erreur = ordreInvalide(ordre);
  if (erreur) { return Promise.reject(new Error(erreur)); }
  const liste = Array.isArray(ordre) ? ordre : [];
  const argv = ['make', '-f', MAKEFILE_WSL, 'etat-pagination', 'ORDRE=' + liste.join(',')];
  return ctx.lancer(racine, argv).then((r) => {
    if (r.erreur) { throw new Error('etat-pagination : ' + r.erreur); }
    if (r.code !== 0) { throw new Error('etat-pagination a rendu le code ' + r.code + '.'); }
    const etat = extraireEtat(r.texte);
    if (!etat) { throw new Error('etat-pagination : aucune ligne JSON reconnue dans la sortie.'); }
    return etat;
  });
}

// ---- rafraichir-pagination : une vraie compilation, journalisée comme tasks.json -----
// -> Promise<{ code, etat }>, rejetée seulement sur un ordre invalide. `etat` vaut `null`
// si aucune ligne JSON n'a été lue (compilation arrêtée avant pagination.py) : `code`, non
// nul, porte alors la panne. Les constats se lisent ensuite dans .szh-journal.log, par
// relireJournal().
function rafraichir(racine, ordre) {
  const erreur = ordreInvalide(ordre);
  if (erreur) { return Promise.reject(new Error(erreur)); }
  const liste = Array.isArray(ordre) ? ordre : [];
  const commande = "set -o pipefail; make -f '" + MAKEFILE_WSL + "' rafraichir-pagination "
    + 'ORDRE=' + liste.join(',') + ' 2>&1 | tee ' + NOM_JOURNAL;
  const argv = ['bash', '-c', commande];
  return ctx.lancer(racine, argv).then((r) => ({
    code: r.erreur ? null : r.code,
    etat: extraireEtat(r.texte)
  }));
}

// ---- Constats « À corriger » -------------------------------------------------------
// Un par slug périmé, dans l'ordre rendu par pagination.py : le premier article qui
// diverge, puis tous ceux qui le suivent (calculer_perimes). Aucun tant que le numéro n'a
// jamais été paginé.
function constatsPagination(etat) {
  if (!etat || !etat.enregistre) { return []; }
  const perimes = Array.isArray(etat.perimes) ? etat.perimes : [];
  return perimes.map((slug) => ({
    source: 'pagination', code: 'perimee', slug: slug, ton: 'attention',
    cle: '', args: [], champs: { article: slug }
  }));
}

// ---- Le compte de PDF qui seront recompilés ----------------------------------------
// Jamais paginé (enregistreSurDisque absent ou sans articles) -> tous. Sinon, un article
// compte s'il manque à l'enregistrement ou si sa première page a changé ; un décalage se
// propage donc à tous les articles suivants (comme calculer_perimes de pagination.py).
function aRecompiler(etat, enregistreSurDisque) {
  const articles = (etat && Array.isArray(etat.articles)) ? etat.articles : [];
  const enregistres = (enregistreSurDisque && Array.isArray(enregistreSurDisque.articles))
    ? enregistreSurDisque.articles : null;
  if (!enregistres || enregistres.length === 0) { return articles.length; }
  const departs = new Map();
  for (const a of enregistres) { departs.set(String(a && a.slug), a && a.depart); }
  let n = 0;
  for (const a of articles) {
    const slug = String(a && a.slug);
    if (!departs.has(slug) || departs.get(slug) !== a.depart) { n++; }
  }
  return n;
}

// ---- L'état enregistré sur le disque, pour aRecompiler() ---------------------------
// .szh-pagination.json est dans le dossier du numéro, hors de out/, pour survivre à
// `make clean` et à l'archivage (voir PAGINATION_ETAT dans pipeline/Makefile). Illisible ou
// absent -> null, que aRecompiler() lit comme « rien d'enregistré ».
function lireRegistre(racine) {
  try {
    const brut = JSON.parse(fs.readFileSync(path.join(racine, NOM_ETAT), 'utf8'));
    return (brut && typeof brut === 'object') ? brut : null;
  } catch (e) {
    return null;
  }
}

// -> true si le numéro a déjà été paginé. Sinon, relireJournal() (extension.js) ne lance
// aucun appel WSL en tâche de fond.
function estPagine(racine) {
  try { return fs.existsSync(path.join(racine, NOM_ETAT)); } catch (e) { return false; }
}

module.exports = {
  configurer, lireEtat, rafraichir, constatsPagination, aRecompiler, lireRegistre, estPagine,
  extraireEtat, NOM_ETAT
};
