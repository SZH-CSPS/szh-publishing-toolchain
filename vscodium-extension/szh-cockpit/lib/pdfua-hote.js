// Validation PDF/UA en arrière-plan, après chaque compilation réussie.
//
// Lance le validateur du pipeline (pipeline/verifier-ua.sh) après chaque compilation
// réussie, sans bloquer, et pose un badge dans la barre d'état pour l'article ouvert (ou
// le livre) : conforme, non conforme, en cours, ou panne d'outillage. Un cache par
// empreinte du PDF (lib/coedition.js#empreinte) évite de revalider un PDF inchangé.
// Les rappels vers l'hôte passent par configurer() ; les tests injectent un
// `lancerValidateur` factice.
//
// Cache : <racine>/.szh-pdfua.json
//   { version: 1, verdicts: { <cle>: { empreinte, verdict, regles, details, date } } }
// `details` : les règles en échec (journal.js#verdictsPdfUa) ; `cle` : slug de l'article,
// ou 'livre' pour l'ouvrage entier. Un fichier illisible ou absent repart vide.
// « en-cours » et « outillage » restent en mémoire : une panne d'outillage n'est pas un
// verdict, et la compilation suivante doit pouvoir réessayer.
//
// Un seul travail à la fois par racine : une demande reçue pendant un travail est rejouée
// à sa fin. Si une compilation démarre pendant la validation (signalerDebutBuild()), le
// résultat est jeté, car le PDF a pu changer ; la compilation suivante replanifiera.
'use strict';

const fs = require('fs');
const path = require('path');
const vscode = require('vscode');

const moteur = require('./moteur');
const profils = require('./profil');
const coedition = require('./coedition');
const { ecrireAtomique } = require('./yaml');
const { verdictsPdfUa } = require('./journal');

const NOM_CACHE = '.szh-pdfua.json';

// Même source que MAKEFILE_WSL d'extension.js : lib/moteur.js.
const MAKEFILE_WSL = moteur.toolkitMoteur('pipeline', 'Makefile');
const VERIFIER_UA_WSL = path.posix.dirname(MAKEFILE_WSL) + '/verifier-ua.sh';

// Large : le premier appel attend le réveil de la distro, et veraPDF est lent sur un PDF
// illustré.
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
// -> Promise<{ lignes: [texte...], code, erreur }>. Ne rejette jamais : verdict, panne et
// délai dépassé se lisent dans le retour.
function lancerValidateurDefaut(racine, pdfsRelatifs) {
  const argv = ['bash', VERIFIER_UA_WSL, '-'].concat(pdfsRelatifs);
  return moteur.reveiller().then(() => new Promise((resolve) => {
    let proc;
    try {
      proc = moteur.executer(argv, { cwd: racine, stdio: ['ignore', 'pipe', 'ignore'] });
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
// verdicts : le contenu du cache disque. transitoire : les états « outillage » du dernier
// travail. enCours : les clés en cours de validation. enVol/rejouer : la file à un seul
// travail.
const etatsParRacine = new Map();

function etatRacine(racine) {
  let st = etatsParRacine.get(racine);
  if (!st) {
    st = { verdicts: chargerVerdicts(racine), transitoire: new Map(), enCours: new Set(),
           enVol: false, rejouer: false, nouveautes: new Map() };
    etatsParRacine.set(racine, st);
  }
  return st;
}

// Incrémenté à chaque compilation démarrée : le travail en cours sait ainsi que le PDF a
// pu changer.
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
  // Retire les clés d'articles qui n'existent plus (renommés hors du cockpit, par exemple).
  if (elaguerAbsents(racine, st)) { sauvegarderVerdicts(racine, st.verdicts); }
  const items = [];
  for (const { cle, chemin } of listerCles(racine)) {
    const emp = coedition.empreinte(chemin);
    if (!emp) { continue; }                          // PDF absent : rien à valider
    const enCache = st.verdicts[cle];
    // Déjà jugé et inchangé. Un verdict non conforme sans `details` est rejugé, pour
    // nommer ses règles.
    if (enCache && enCache.empreinte === emp
        && (enCache.verdict !== 'non-conforme' || enCache.details)) { continue; }
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
    if (buildDemarrePendant) { continue; }            // jeté : le PDF a pu changer
    if (coedition.empreinte(it.chemin) !== it.empreinte) { continue; }   // jeté : a changé
    if (panneGlobale) { st.transitoire.set(it.cle, { verdict: 'outillage', regles: 0, date: '' }); continue; }
    const trouve = verdicts.find((v) => path.basename(String(v.fichier || '')) === path.basename(it.chemin));
    if (!trouve) { st.transitoire.set(it.cle, { verdict: 'outillage', regles: 0, date: '' }); continue; }
    const ajoutees = reglesAjoutees(st.verdicts[it.cle], trouve);
    if (ajoutees > 0) {
      st.nouveautes.set(it.cle, { cle: it.cle, empreinte: it.empreinte,
        points: ((trouve.details || {}).fr || []).length || trouve.regles || ajoutees });
    }
    st.verdicts[it.cle] = {
      empreinte: it.empreinte, verdict: trouve.verdict, regles: trouve.regles || 0,
      details: trouve.details || { fr: [], de: [] }, date: new Date().toISOString()
    };
  }
  sauvegarderVerdicts(racine, st.verdicts);
  avertirChangement();
}

// Le nombre de règles en échec que `nouveau` ajoute à `ancien`, le verdict qu'il remplace.
// Une règle se reconnaît à son repère ISO (son titre contient aussi le compte et les pages).
function idsRegles(v) {
  if (!v || v.verdict !== 'non-conforme') { return null; }
  return new Set(((v.details || {}).fr || []).map((r) => String(r.repere || r.regle || '')));
}

function reglesAjoutees(ancien, nouveau) {
  const neufs = idsRegles(nouveau);
  if (!neufs) { return 0; }
  const vieux = idsRegles(ancien);
  // Un verdict sans règles lisibles n'est neuf que s'il remplace un PDF conforme.
  if (neufs.size === 0) { return vieux ? 0 : (nouveau.regles || 0); }
  if (!vieux) { return neufs.size; }
  let n = 0;
  for (const id of neufs) { if (!vieux.has(id)) { n++; } }
  return n;
}

// prendreNouveautes(racine) -> [{ cle, empreinte, points }] : les PDF dont la dernière
// validation a ajouté des règles en échec, depuis le dernier appel. La liste se vide à la
// lecture : chaque verdict ne s'annonce qu'une fois.
function prendreNouveautes(racine) {
  if (!racine || !etatsParRacine.has(racine)) { return []; }
  const st = etatsParRacine.get(racine);
  const liste = Array.from(st.nouveautes.values());
  st.nouveautes.clear();
  return liste;
}

// planifier(racine) : à appeler après une compilation réussie. Sans effet si le réglage est
// désactivé ou si rien n'a changé depuis la dernière validation.
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
// regles, date }. `cle` : un slug d'article, ou 'livre'. La racine vient de ctx.racine().
//
// Réglage désactivé -> toujours « inconnu », même si un ancien verdict est en cache.
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
// mémoire. Réglage désactivé -> rien. L'export garde son propre contrôle (verifier-ua),
// indépendant de ce réglage.
//
// Chaque règle en échec suit son verdict, en constat « pdfua/regle » dans la langue du
// cockpit (repli sur le français).
function constats(racine, langue) {
  if (!racine || !reglageActif()) { return []; }
  const st = etatRacine(racine);
  // L'empreinte actuelle de chaque PDF : un verdict qui porte sur une autre version du
  // fichier n'est pas montré.
  //
  // Une clé absente de listerCles() ne désigne plus d'article (renommé, supprimé, ou livre
  // rouvert en revue) : son verdict n'est pas montré, même avant purgerAbsents().
  const actuels = {};
  for (const item of listerCles(racine)) { actuels[item.cle] = item.chemin; }
  const out = [];
  for (const cle of Object.keys(st.verdicts)) {
    const v = st.verdicts[cle];
    if (v.verdict !== 'non-conforme') { continue; }
    if (actuels[cle] === undefined) { continue; }
    if (coedition.empreinte(actuels[cle]) !== v.empreinte) { continue; }
    const slug = cle === 'livre' ? '' : cle;
    const details = v.details || {};
    const liste = (langue === 'de' && (details.de || []).length) ? details.de : (details.fr || []);
    // Le résumé « N règle(s) ne sont pas respectées » ne sort que si aucune règle n'est
    // détaillée (voir journal.js#sansResumePdfUaRedondant). Il garde alors l'article dans
    // « À corriger ».
    if (liste.length === 0) {
      out.push({ source: 'pdfua', code: 'non-conforme', ton: 'danger', slug: slug,
                 cle: 'ctl.pdfua.nonconforme', args: [String(v.regles || 0)], brut: '' });
    }
    for (const r of liste) {
      out.push({ source: 'pdfua', code: 'regle', ton: 'danger', slug: slug, cle: '', args: [],
                 champs: { regle: String(r.regle || ''), explication: String(r.explication || ''),
                           repere: String(r.repere || '') },
                 brut: String(r.regle || '') });
    }
  }
  for (const cle of st.transitoire.keys()) {
    const v = st.transitoire.get(cle);
    if (v.verdict !== 'outillage') { continue; }
    if (actuels[cle] === undefined) { continue; }    // même raison que plus haut
    out.push({ source: 'pdfua', code: 'outillage', ton: 'attention', slug: '',
               cle: 'ctl.pdfua.outillage', args: [], brut: '' });
  }
  return out;
}

// purgerAbsents(racine) -> true si le cache a changé. À appeler après un renommage ou une
// suppression de dossiers (extension.js, alignerDossiersSurOrdre) : les verdicts, pannes et
// validations en cours d'une clé que listerCles() ne connaît plus sont retirés.
//
// Un verdict dont l'empreinte est celle du PDF d'un article actuel sans verdict à jour
// passe sous ce nom : c'est le même fichier, déplacé. Sinon il est oublié, et la prochaine
// compilation jugera le nouveau PDF.
//
// Une liste vide ne purge rien : c'est le plus souvent un fournisseur pas encore chargé.
function purgerAbsents(racine) {
  if (!racine) { return false; }
  const change = elaguerAbsents(racine, etatRacine(racine));
  if (change) {
    sauvegarderVerdicts(racine, etatRacine(racine).verdicts);
    avertirChangement();
  }
  return change;
}

// Le travail de purgerAbsents(), sans écriture ni avertissement (unTravail() écrit
// lui-même). -> true si quelque chose a été retiré ou migré.
function elaguerAbsents(racine, st) {
  const cles = listerCles(racine);
  if (cles.length === 0) { return false; }
  const actuels = new Map(cles.map((it) => [it.cle, it.chemin]));
  const empreintes = new Map();
  const empreinteDe = (cle) => {
    if (!empreintes.has(cle)) { empreintes.set(cle, coedition.empreinte(actuels.get(cle))); }
    return empreintes.get(cle);
  };
  let change = false;
  for (const cle of Object.keys(st.verdicts)) {
    if (actuels.has(cle)) { continue; }
    const v = st.verdicts[cle];
    delete st.verdicts[cle];
    change = true;
    if (!v || !v.empreinte) { continue; }
    for (const cible of actuels.keys()) {
      const deja = st.verdicts[cible];
      const emp = empreinteDe(cible);
      if (!emp || emp !== v.empreinte) { continue; }
      if (deja && deja.empreinte === emp) { continue; }     // déjà jugé sous son nom
      st.verdicts[cible] = v;
      break;
    }
  }
  for (const cle of Array.from(st.transitoire.keys())) {
    if (!actuels.has(cle)) { st.transitoire.delete(cle); change = true; }
  }
  for (const cle of Array.from(st.enCours)) {
    if (!actuels.has(cle)) { st.enCours.delete(cle); change = true; }
  }
  return change;
}

// enCours(racine, cle) -> true tant qu'une validation tourne pour cette clé (un slug, ou
// 'livre'), ou pour n'importe laquelle quand `cle` est vide. L'hôte s'en sert pour lever
// le voile « Analyse en cours… » de « À corriger », le verdict PDF/UA arrivant après le
// journal.
function enCours(racine, cle) {
  if (!racine || !etatsParRacine.has(racine)) { return false; }
  const st = etatsParRacine.get(racine);
  return cle ? st.enCours.has(cle) : st.enCours.size > 0;
}

module.exports = { configurer, planifier, etat, constats, signalerDebutBuild, reglageActif,
                   purgerAbsents, enCours, prendreNouveautes };
