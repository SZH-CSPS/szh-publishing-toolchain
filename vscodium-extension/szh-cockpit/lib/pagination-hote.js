// Pagination continue du numéro, côté cockpit : lecture de l'état (pipeline/pagination.py
// via `make etat-pagination`), rafraîchissement à la demande (`make rafraichir-pagination`),
// et les constats qu'un numéro périmé pose dans « À corriger ».
//
// On ne pagine QU'AU BOUCLAGE, par un bouton manuel (szh.rafraichirPagination,
// extension.js) : ce module ne lance jamais lui-même une compilation, il expose seulement
// les deux appels make et les fonctions pures qui en tirent un constat ou un compte.
//
// ⚠ Impur (spawn WSL, disque) : sur le modèle de lib/pdfua-hote.js, les rappels vers l'hôte
// passent par configurer(). Les tests injectent un `lancer` factice — child_process.spawn
// n'est pas simulé par le harnais, tout lancement réel doit passer par ce point d'entrée.
//
// ── Deux formes d'appel, et pourquoi elles diffèrent ────────────────────────────────
// `etat-pagination` ne compile rien et n'écrit rien : un appel `make` nu suffit, capté sur
// la sortie standard du processus WSL. `rafraichir-pagination` est une VRAIE compilation
// (elle peut refaire plusieurs PDF) : elle passe par le même journal que tasks.json
// (`… 2>&1 | tee .szh-journal.log`), pour que la relecture du journal qui suit un
// rafraîchissement voie exactement ce que cette compilation-là vient de dire — jamais un
// texte reconstruit à côté.
//
// ── Sécurité : ORDRE est interpolé dans une ligne shell ─────────────────────────────
// Chaque slug de l'ordre doit avoir la forme d'un slug (lib/articles.js, FORME_SLUG) AVANT
// d'entrer dans la commande — un slug vient du disque, on ne l'interpole jamais sans
// vérification dans un `bash -c`. Le refus se fait avant tout lancement de processus.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const wsl = require('./wsl');
const { toolkitWsl } = require('./chemins-poste');
const { FORME_SLUG } = require('./articles');

const NOM_ETAT = '.szh-pagination.json';
// Même nom que JOURNAL_TACHE (extension.js) et tasks.json : une seule notion de « dernier
// journal de compilation » dans tout le cockpit.
const NOM_JOURNAL = '.szh-journal.log';

const SCHEMA = 'szh-pagination/1';

// Même source que MAKEFILE_WSL de lib/pdfua-hote.js : lib/chemins-poste.js.
const MAKEFILE_WSL = toolkitWsl('pipeline', 'Makefile');

// Large, comme DELAI_VALIDATION de lib/pdfua-hote.js : un numéro de plusieurs articles
// recompile deux fois (pagination.py appelle `make pdf` avant et après le recalcul).
const DELAI_MAKE = 600000;

// ---- Rappels vers l'hôte -----------------------------------------------------------
let ctx = { lancer: lancerDefaut };
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// ---- Lancement réel, dans la distro WSL du pipeline --------------------------------
// -> Promise<{ texte, code, erreur }>. Ne rejette jamais : comme lancerValidateurDefaut()
// de lib/pdfua-hote.js, les trois issues (sortie, panne, délai) se lisent dans le retour.
function lancerDefaut(racine, argv) {
  return wsl.reveillerWsl().then(() => new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(wsl.cheminWsl(), argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
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
// -> '' si l'ordre est sûr, sinon le message d'erreur. N'appelle jamais ctx.lancer.
function ordreInvalide(ordre) {
  const liste = Array.isArray(ordre) ? ordre : [];
  for (const s of liste) {
    if (typeof s !== 'string' || !FORME_SLUG.test(s)) {
      return 'ordre de pagination invalide : « ' + String(s) + ' » n’a pas la forme d’un slug.';
    }
  }
  return '';
}

function argvBase(racine) {
  return ['-d', wsl.DISTRO, '--cd', racine, '--'];
}

// ---- La ligne JSON au milieu d'une sortie mêlée ------------------------------------
// Pure : aucune ligne qui ne commence pas EXACTEMENT par `{"schema"`, ni dont le schéma
// diffère, ne compte — un JSON d'un autre outil (pdf-ua, par exemple) ne doit jamais être
// pris pour un état de pagination.
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

// ---- etat-pagination : lecture seule, ne compile ni n'écrit rien ------------------
// -> Promise<etat>, rejetée en cas d'ordre invalide, de panne de lancement, de code non
// nul, ou d'absence de ligne JSON reconnue. Contrairement à lancerDefaut(), qui ne
// rejette jamais, cette fonction-ci REJETTE : l'appelant (extension.js) doit pouvoir
// distinguer « rien à signaler » de « je n'ai pas pu vérifier », et ne jamais confondre
// les deux — en particulier avant un export OJS.
function lireEtat(racine, ordre) {
  const erreur = ordreInvalide(ordre);
  if (erreur) { return Promise.reject(new Error(erreur)); }
  const liste = Array.isArray(ordre) ? ordre : [];
  const argv = argvBase(racine).concat(['make', '-f', MAKEFILE_WSL, 'etat-pagination',
    'ORDRE=' + liste.join(',')]);
  return ctx.lancer(racine, argv).then((r) => {
    if (r.erreur) { throw new Error('etat-pagination : ' + r.erreur); }
    if (r.code !== 0) { throw new Error('etat-pagination a rendu le code ' + r.code + '.'); }
    const etat = extraireEtat(r.texte);
    if (!etat) { throw new Error('etat-pagination : aucune ligne JSON reconnue dans la sortie.'); }
    return etat;
  });
}

// ---- rafraichir-pagination : une vraie compilation, journalisée comme tasks.json -----
// -> Promise<{ code, etat }>, jamais rejetée sauf ordre invalide (refusé avant tout
// lancement, comme lireEtat()). `etat` est `null` si aucune ligne JSON n'a pu être lue
// (compilation arrêtée avant l'appel à pagination.py, par exemple) : c'est alors `code`,
// non nul, qui porte la panne — l'appelant affiche pagination.echec dans ce cas.
// Le journal (.szh-journal.log) est la seule source relue ensuite par relireJournal() :
// cette fonction ne fait que le produire, jamais son propre résumé des constats.
function rafraichir(racine, ordre) {
  const erreur = ordreInvalide(ordre);
  if (erreur) { return Promise.reject(new Error(erreur)); }
  const liste = Array.isArray(ordre) ? ordre : [];
  const commande = "set -o pipefail; make -f '" + MAKEFILE_WSL + "' rafraichir-pagination "
    + 'ORDRE=' + liste.join(',') + ' 2>&1 | tee ' + NOM_JOURNAL;
  const argv = argvBase(racine).concat(['bash', '-c', commande]);
  return ctx.lancer(racine, argv).then((r) => ({
    code: r.erreur ? null : r.code,
    etat: extraireEtat(r.texte)
  }));
}

// ---- Constats « À corriger » -------------------------------------------------------
// Un par slug périmé, dans l'ordre où pagination.py les rend — lui d'abord, du premier
// article qui diverge, et tous ceux qui le suivent (voir pipeline/pagination.py,
// calculer_perimes). Rien tant que le numéro n'a jamais été paginé : on n'a rien promis à
// personne, et un numéro non enregistré ne doit jamais afficher d'avertissement.
function constatsPagination(etat) {
  if (!etat || !etat.enregistre) { return []; }
  const perimes = Array.isArray(etat.perimes) ? etat.perimes : [];
  return perimes.map((slug) => ({
    source: 'pagination', code: 'perimee', slug: slug, ton: 'attention',
    cle: '', args: [], champs: { article: slug }
  }));
}

// ---- Le compte de PDF qui seront recompilés ----------------------------------------
// Jamais paginé (enregistreSurDisque absent, ou sans articles) -> tous. Sinon, un article
// compte s'il n'est pas dans l'enregistrement ou si son départ calculé a bougé — et comme
// le départ d'un article est le cumul des pages qui le précèdent, un seul article décalé
// entraîne mécaniquement tous les suivants dans ce compte, sans qu'il faille l'écrire à
// part (voir pipeline/pagination.py, calculer_perimes, même raisonnement).
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
// .szh-pagination.json vit dans le dossier du numéro, jamais sous out/ : il survit à
// `make clean` comme à l'archivage (voir pipeline/Makefile, en-tête sur PAGINATION_ETAT).
// Illisible ou absent -> null, jamais une raison de bloquer : aRecompiler() le lit comme
// « rien d'enregistré ».
function lireRegistre(racine) {
  try {
    const brut = JSON.parse(fs.readFileSync(path.join(racine, NOM_ETAT), 'utf8'));
    return (brut && typeof brut === 'object') ? brut : null;
  } catch (e) {
    return null;
  }
}

// -> true si le numéro a déjà été paginé au moins une fois. Tant que c'est faux, aucun
// appel WSL ne doit être tenté en tâche de fond (extension.js, relireJournal()) : le
// contrôle ne doit rien coûter avant le bouclage.
function estPagine(racine) {
  try { return fs.existsSync(path.join(racine, NOM_ETAT)); } catch (e) { return false; }
}

module.exports = {
  configurer, lireEtat, rafraichir, constatsPagination, aRecompiler, lireRegistre, estPagine,
  extraireEtat, NOM_ETAT
};
