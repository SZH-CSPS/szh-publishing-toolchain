// Validation PDF/UA en arrière-plan, après chaque compilation réussie.
//
// Le pipeline sait déjà valider un PDF (pipeline/verifier-ua.sh) mais seulement à l'export
// (`docx`, `tout-exporter`) : le verdict arrive le jour où le numéro part chez l'imprimeur,
// jamais après un simple Ctrl+S. Ce module lance le même validateur juste après une
// compilation qui a réussi, sans bloquer la rédaction, et pose un badge dans la barre
// d'état pour l'article ouvert (ou le livre) : conforme, non conforme, en cours, ou panne
// d'outillage. Un cache par empreinte du PDF (lib/coedition.js#empreinte) évite de
// revalider ce qui n'a pas changé — la plupart des Ctrl+S ne touchent pas le PDF d'un
// article qu'on n'a pas ouvert.
//
// ⚠ Impur (spawn WSL, disque, réglages VS Code) : les rappels vers l'hôte passent par
// configurer(), comme lib/cycle-vie.js et les autres modules « -hote.js ». Les tests
// injectent un `lancerValidateur` factice — child_process.spawn n'est pas simulé par le
// harnais, tout lancement réel doit passer par ce point d'entrée.
//
// ── Le cache, par racine ────────────────────────────────────────────────────────────
// <racine>/.szh-pdfua.json : { version: 1, verdicts: { <cle>: { empreinte, verdict,
// regles, date } } }, `cle` = slug de l'article pour une revue, 'livre' pour l'ouvrage
// entier. Chargé au premier accès à une racine donnée, réécrit après chaque travail de
// validation. Un fichier illisible ou absent repart vide — jamais une raison de bloquer.
//
// Deux états ne sont PAS mis en cache, donc jamais écrits sur le disque :
//   - « en-cours » : le fichier est en cours de validation (mémoire seulement) ;
//   - « outillage » : le validateur n'a pas pu rendre de verdict cette fois-ci (mémoire
//     seulement) — une panne d'outillage n'est pas un verdict, elle ne doit pas empêcher
//     la prochaine compilation réussie de retenter.
//
// ── Un seul travail en vol par racine ────────────────────────────────────────────────
// planifier() met en file : si un travail tourne déjà pour cette racine, la demande est
// fusionnée (un drapeau « rejouer ») et rejouée dès que le travail en cours se termine —
// jamais deux validations concurrentes du même numéro.
//
// ── Le piège d'une compilation qui démarre pendant la validation ───────────────────
// Le validateur WSL peut prendre plusieurs secondes ; rien n'empêche le rédacteur de
// recompiler entre-temps. Si une tâche démarre pendant le travail (signalerDebutBuild(),
// compteur de génération), le résultat est jeté à son retour : le PDF qu'on vient de
// juger n'est peut-être plus celui sur le disque. La compilation suivante replanifiera.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const vscode = require('vscode');

const wsl = require('./wsl');
const profils = require('./profil');
const coedition = require('./coedition');
const { ecrireAtomique } = require('./yaml');
const { verdictsPdfUa } = require('./journal');

const NOM_CACHE = '.szh-pdfua.json';

// ⚠ Doit correspondre au Makefile réel du toolkit déployé (voir extension.js, même
// littéral) : ce module ne peut pas l'importer sans dépendre d'extension.js lui-même.
const MAKEFILE_WSL = '/mnt/c/ProgramData/SZH/toolkit/pipeline/Makefile';
const VERIFIER_UA_WSL = path.posix.dirname(MAKEFILE_WSL) + '/verifier-ua.sh';

// Large, comme lancerReimporter() (extension.js) : le premier appel paie le réveil de la
// distro, et un PDF illustré prend son temps chez veraPDF.
const DELAI_VALIDATION = 600000;

// ---- Rappels vers l'hôte -----------------------------------------------------------
let ctx = {
  lancerValidateur: lancerValidateurDefaut,
  listerArticles: () => [],
  profilOuvrage: () => null,
  racine: () => null,
  surChangement: () => {}
};

function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// ---- Le réglage : szh.controlePdfUa, activé par défaut -----------------------------
function reglageActif() {
  try { return vscode.workspace.getConfiguration('szh').get('controlePdfUa', true) !== false; }
  catch (e) { return true; }
}

// ---- Lancement réel du validateur, dans la distro WSL du pipeline ------------------
// -> Promise<{ lignes: [texte...], code, erreur }>. Ne rejette jamais : les trois issues
// (verdict, panne, délai) se lisent dans le retour, jamais dans une exception — même
// contrat que lancerReimporter() (extension.js).
function lancerValidateurDefaut(racine, pdfsRelatifs) {
  const argv = ['-d', wsl.DISTRO, '--cd', racine, '--', 'bash', VERIFIER_UA_WSL, '-']
    .concat(pdfsRelatifs);
  return wsl.reveillerWsl().then(() => new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(wsl.cheminWsl(), argv, { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
      resolve({ lignes: [], code: null, erreur: String((e && e.message) || e) });
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
      finir({ lignes: [], code: null, erreur: 'delai' });
    }, DELAI_VALIDATION);
    if (proc.stdout) { proc.stdout.on('data', (d) => morceaux.push(d)); }
    proc.on('error', (e) => finir({ lignes: [], code: null, erreur: String((e && e.message) || e) }));
    proc.on('close', (code) => {
      const texte = Buffer.concat(morceaux).toString('utf8');
      finir({ lignes: texte.split(/\r?\n/), code: code, erreur: null });
    });
  }));
}

// ---- Le cache disque, par racine ----------------------------------------------------
function cheminCache(racine) { return path.join(racine, NOM_CACHE); }

function chargerVerdicts(racine) {
  try {
    const brut = JSON.parse(fs.readFileSync(cheminCache(racine), 'utf8'));
    if (brut && typeof brut === 'object' && brut.verdicts && typeof brut.verdicts === 'object') {
      return Object.assign({}, brut.verdicts);
    }
  } catch (e) { /* illisible ou absent : on repart vide */ }
  return {};
}

function sauvegarderVerdicts(racine, verdicts) {
  try {
    ecrireAtomique(cheminCache(racine), JSON.stringify({ version: 1, verdicts: verdicts }, null, 2) + '\n');
  } catch (e) { /* écriture ratée : la revalidation suivante retentera */ }
}

// ---- L'état en mémoire, par racine ---------------------------------------------------
// verdicts : ce qui est sur le disque (chargé au premier accès). transitoire : les états
// « outillage » du travail le plus récent, jamais persistés. enCours : les clés en cours
// de validation. enVol/rejouer : la file à un seul travail décrite en tête de fichier.
const etatsParRacine = new Map();

function etatRacine(racine) {
  let st = etatsParRacine.get(racine);
  if (!st) {
    st = { verdicts: chargerVerdicts(racine), transitoire: new Map(), enCours: new Set(),
           enVol: false, rejouer: false };
    etatsParRacine.set(racine, st);
  }
  return st;
}

// Le compteur de génération : incrémenté à chaque tâche de compilation démarrée, pour que
// le travail en cours sache qu'une compilation a peut-être changé le PDF qu'il juge.
let generation = 0;
function signalerDebutBuild() { generation++; }

function avertirChangement() {
  try { ctx.surChangement(); } catch (e) { /* un rafraîchissement raté ne casse rien */ }
}

// ---- Les PDF à connaître pour une racine, avec la clé de cache de chacun -----------
function listerCles(racine) {
  const profil = ctx.profilOuvrage() || profils.profilPour('revue');
  if (profil.cle === 'livre') {
    return [{ cle: 'livre', chemin: profils.chemins(profil, racine).pdf }];
  }
  return (ctx.listerArticles() || []).map((slug) => ({
    cle: slug, chemin: profils.chemins(profil, racine, slug).pdf
  }));
}

function cheminRelatif(racine, chemin) {
  return path.relative(racine, chemin).split(path.sep).join('/');
}

// ---- Un travail de validation : les fichiers dont l'empreinte a changé -------------
async function unTravail(racine, st) {
  const items = [];
  for (const { cle, chemin } of listerCles(racine)) {
    const emp = coedition.empreinte(chemin);
    if (!emp) { continue; }                          // PDF absent : rien à valider
    const enCache = st.verdicts[cle];
    if (enCache && enCache.empreinte === emp) { continue; }   // déjà jugé, rien n'a changé
    items.push({ cle: cle, chemin: chemin, empreinte: emp });
  }
  if (items.length === 0) { return; }

  for (const it of items) { st.enCours.add(it.cle); st.transitoire.delete(it.cle); }
  avertirChangement();

  const generationAvant = generation;
  const relatifs = items.map((it) => cheminRelatif(racine, it.chemin));
  let resultat;
  try { resultat = await ctx.lancerValidateur(racine, relatifs); }
  catch (e) { resultat = { lignes: [], code: null, erreur: String((e && e.message) || e) }; }
  const texte = Array.isArray(resultat && resultat.lignes) ? resultat.lignes.join('\n') : '';
  const verdicts = verdictsPdfUa(texte);
  const panneGlobale = !resultat || resultat.code === 2 || verdicts.outillage === true;
  const buildDemarrePendant = generation !== generationAvant;

  for (const it of items) {
    st.enCours.delete(it.cle);
    if (buildDemarrePendant) { continue; }            // jeté : PDF peut-être déjà périmé
    if (coedition.empreinte(it.chemin) !== it.empreinte) { continue; }   // jeté : a changé
    if (panneGlobale) { st.transitoire.set(it.cle, { verdict: 'outillage', regles: 0, date: '' }); continue; }
    const trouve = verdicts.find((v) => path.basename(String(v.fichier || '')) === path.basename(it.chemin));
    if (!trouve) { st.transitoire.set(it.cle, { verdict: 'outillage', regles: 0, date: '' }); continue; }
    st.verdicts[it.cle] = {
      empreinte: it.empreinte, verdict: trouve.verdict, regles: trouve.regles || 0,
      date: new Date().toISOString()
    };
  }
  sauvegarderVerdicts(racine, st.verdicts);
  avertirChangement();
}

// planifier(racine) : à appeler après une compilation réussie. Ne fait rien si le réglage
// est désactivé. Sans effet si rien n'a changé depuis la dernière validation.
async function planifier(racine) {
  if (!racine) { return; }
  if (!reglageActif()) { return; }
  const st = etatRacine(racine);
  if (st.enVol) { st.rejouer = true; return; }
  st.enVol = true;
  try {
    let continuer = true;
    while (continuer) {
      st.rejouer = false;
      await unTravail(racine, st);
      continuer = st.rejouer;
    }
  } finally {
    st.enVol = false;
  }
}

// etat(cle) -> { verdict: 'conforme'|'non-conforme'|'outillage'|'en-cours'|'inconnu',
// regles, date }. `cle` : un slug d'article, ou 'livre'. Lit la racine courante via
// ctx.racine() — c'est l'hôte qui la connaît (fournisseur.racine).
//
// Réglage désactivé -> toujours « inconnu », même si un verdict d'avant dort encore sur
// le disque : le badge doit se taire quand on a choisi de ne plus valider, pas répéter un
// verdict qui n'est peut-être plus vrai depuis.
function etat(cle) {
  if (!reglageActif()) { return { verdict: 'inconnu', regles: 0, date: '' }; }
  const racine = ctx.racine();
  if (!racine || !cle) { return { verdict: 'inconnu', regles: 0, date: '' }; }
  const st = etatRacine(racine);
  if (st.enCours.has(cle)) { return { verdict: 'en-cours', regles: 0, date: '' }; }
  if (st.transitoire.has(cle)) { return Object.assign({}, st.transitoire.get(cle)); }
  const v = st.verdicts[cle];
  if (!v) { return { verdict: 'inconnu', regles: 0, date: '' }; }
  return { verdict: v.verdict, regles: v.regles || 0, date: v.date || '' };
}

// constats(racine) -> constats au format de lib/journal.js, pour la vue « Contrôles » et
// son compteur : un par PDF non conforme en cache, plus un par panne d'outillage en
// mémoire (jamais mis en cache, donc jamais dans `verdicts`). Réglage désactivé -> rien :
// même raison que etat() ci-dessus, un verdict d'avant qu'on ne vérifie plus ne doit pas
// continuer à compter comme bloquant. L'export garde son propre contrôle (verifier-ua),
// indépendant de ce réglage.
function constats(racine) {
  if (!racine || !reglageActif()) { return []; }
  const st = etatRacine(racine);
  // Le PDF actuel de chaque clé, pour écarter un verdict que le fichier a dépassé depuis
  // (une panne d'outillage ou une compilation plus récente n'a pas encore pu le remplacer
  // en cache) : mieux vaut ne rien dire qu'accuser un PDF qui n'est plus celui sur le disque.
  const actuels = {};
  for (const item of listerCles(racine)) { actuels[item.cle] = item.chemin; }
  const out = [];
  for (const cle of Object.keys(st.verdicts)) {
    const v = st.verdicts[cle];
    if (v.verdict !== 'non-conforme') { continue; }
    if (actuels[cle] !== undefined && coedition.empreinte(actuels[cle]) !== v.empreinte) { continue; }
    out.push({ source: 'pdfua', code: 'non-conforme', ton: 'danger',
               slug: cle === 'livre' ? '' : cle,
               cle: 'ctl.pdfua.nonconforme', args: [String(v.regles || 0)], brut: '' });
  }
  for (const cle of st.transitoire.keys()) {
    const v = st.transitoire.get(cle);
    if (v.verdict !== 'outillage') { continue; }
    out.push({ source: 'pdfua', code: 'outillage', ton: 'attention', slug: '',
               cle: 'ctl.pdfua.outillage', args: [], brut: '' });
  }
  return out;
}

module.exports = { configurer, planifier, etat, constats, signalerDebutBuild };
