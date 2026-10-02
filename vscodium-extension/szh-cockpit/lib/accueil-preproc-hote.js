// L'onglet Préprocessing de l'Accueil : le nettoyeur de manuscrit (pipeline/manuscrit-nettoyer.py),
// lancé dans le moteur comme par l'onglet WinForms, son rapport HTML et ses compteurs. Sans
// panneau : lib/accueil-hote.js lui relaie les messages de la page.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const { MSG } = require('./messages');
const { T, langueCockpit } = require('./i18n');
const moteur = require('./moteur');
const { compiler } = require('./gabarits');
const compteurs = require('./compteurs');
const rapportErreur = require('./rapport-erreur');
const { COURRIEL_SUPPORT } = require('./codes-erreur');
const { construireVueRapportManuscrit } = require('../outils/rendre-gabarit');

const PRODUITS = ['revue', 'zeitschrift'];
const FORMATS = ['docx', 'odt'];
// Un fichier glissé depuis l'Explorateur n'apporte pas son chemin à la page : le dépôt reste fermé.
const DEPOT = false;
// Par compte : le dossier du dernier manuscrit choisi, où la boîte de choix se rouvre.
// Valeur gardée du temps du « lanceur » : les postes l'ont déjà écrite.
const CLE_DOSSIER = 'szh.lanceur.preproc.dossier';
const GABARIT = path.join(__dirname, '..', 'export-templates', 'rapport-manuscrit.twig');
// Les étapes de la page, dans l'ordre, et celle où tombe chaque étape de la CLI (ETAPES).
const LIBELLES = {
  preparation: 'accueil.preproc.etape.preparation', lecture: 'accueil.preproc.etape.lecture',
  entete: 'accueil.preproc.etape.entete', identifiants: 'accueil.preproc.etape.identifiants',
  titres: 'accueil.preproc.etape.titres', formatage: 'accueil.preproc.etape.formatage',
  typographie: 'accueil.preproc.etape.typographie', regles: 'accueil.preproc.etape.regles',
  bibliographie: 'accueil.preproc.etape.bibliographie', ecriture: 'accueil.preproc.etape.ecriture',
  annotation: 'accueil.preproc.etape.annotation', rapport: 'accueil.preproc.etape.rapport'
};
const ORDRE = Object.keys(LIBELLES);
const VERS_PAGE = {
  'controle-entree': 'lecture', 'conversion-odt': 'lecture', lecture: 'lecture', gabarit: 'lecture', noms: 'lecture',
  entete: 'entete', identifiants: 'identifiants', titres: 'titres', formatage: 'formatage',
  typographie: 'typographie', regles: 'regles', vale: 'regles', bibliographie: 'bibliographie',
  ecriture: 'ecriture', 'controle-perte': 'ecriture', annotation: 'annotation', 'conversion-sortie': 'annotation',
  rapport: 'rapport'
};
const RE_ETAPE = /^\[manuscrit-nettoyer\] etape ([a-z0-9-]+)\s*$/;

let ctx = {
  envoyer: () => {},
  choisirFichier: () => Promise.resolve(null),
  ouvrirExterne: () => Promise.resolve(false),
  revelerFichier: () => {},
  formatTravail: () => 'docx',
  memoire: null,
  lancer: (argv, options) => moteur.executer(argv, options),
  cli: null,
  versMoteur: (chemin) => moteur.versMoteur(chemin),
  compter: (champs) => compteurs.ecrireCompteurs(champs),
  signaler: (champs) => rapportErreur.emettreRapport(champs)
};
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Le passage en cours, et ce que le dernier a écrit : la page n'en reçoit que les noms.
let passage = null;
let derniers = null;
// Une seule boîte de choix ouverte à la fois.
let enChoix = false;

function cheminCli() { return ctx.cli || moteur.toolkitMoteur('pipeline', 'manuscrit-nettoyer.py'); }
function produitParDefaut() { return langueCockpit() === 'de' ? 'zeitschrift' : 'revue'; }
function formatParDefaut() {
  const f = ctx.formatTravail();
  return FORMATS.indexOf(f) === -1 ? 'docx' : f;
}
function dossierDepart() {
  const d = ctx.memoire && ctx.memoire.get(CLE_DOSSIER);
  try { return typeof d === 'string' && d && fs.statSync(d).isDirectory() ? d : ''; } catch (e) { return ''; }
}
function supprimer(chemin) { try { fs.rmSync(chemin, { force: true }); } catch (e) { /* déjà parti */ } }

// Le produit suit la langue et le format suit szh.formatTravail : la page ne retient rien
// d'un passage à l'autre.
function etat() {
  return { type: MSG.ACCUEIL_PREPROC_ETAT, produit: produitParDefaut(), format: formatParDefaut(),
    dossier: dossierDepart(), depot: DEPOT };
}
function envoyerEtat() { if (!passage) { ctx.envoyer(etat()); } }

// Une étape n'est dite à la page que si elle suit la dernière dite.
function relayer(p, etape) {
  const rang = ORDRE.indexOf(etape);
  if (rang <= p.rang) { return; }
  p.rang = rang;
  ctx.envoyer({ type: MSG.ACCUEIL_PREPROC_ETAPE, etape });
}

function lireStats(sortie) {
  const lignes = String(sortie || '').split(/\r?\n/).filter((l) => l.trim());
  try {
    const o = JSON.parse(lignes[lignes.length - 1]);
    return o && typeof o === 'object' ? o : null;
  } catch (e) { return null; }
}

// La CLI dans le moteur : la progression sur stderr, une seule ligne JSON sur stdout à la
// fin. Rend { code, stats, annule, lancement } et ne rejette jamais.
function executer(p, argv) {
  return new Promise((resolve) => {
    let sortie = '';
    let reste = '';
    let fini = false;
    const finir = (v) => {
      if (fini) { return; }
      fini = true;
      resolve(Object.assign({ annule: p.annule, stats: lireStats(sortie) }, v));
    };
    const ligne = (l) => {
      const m = RE_ETAPE.exec(l);
      if (m && VERS_PAGE[m[1]]) { relayer(p, VERS_PAGE[m[1]]); }
    };
    try {
      p.proc = ctx.lancer(argv, { cwd: p.dossier, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) { finir({ code: null, lancement: true }); return; }
    p.proc.stdout.setEncoding('utf8');
    p.proc.stdout.on('data', (d) => { sortie += d; });
    p.proc.stderr.setEncoding('utf8');
    p.proc.stderr.on('data', (d) => {
      const lignes = (reste + d).split(/\r?\n/);
      reste = lignes.pop();
      lignes.forEach(ligne);
    });
    p.proc.on('error', () => finir({ code: null, lancement: true }));
    p.proc.on('close', (code) => {
      if (reste) { ligne(reste); }
      finir({ code });
    });
  });
}

// Le rapport HTML à côté du manuscrit, par le moteur de gabarits et la vue que prépare
// outils/rendre-gabarit.js pour l'onglet WinForms. Rend son chemin, ou '' s'il n'a pu s'écrire.
function rendreRapport(p, stats, json) {
  try {
    const rapport = stats.refus ? stats : JSON.parse(fs.readFileSync(json, 'utf8'));
    const source = fs.readFileSync(GABARIT, 'utf8').replace(/^﻿/, '');
    const blocs = compiler(source, path.basename(GABARIT))
      .rendre({ produit: p.produit, rapport, vue: construireVueRapportManuscrit(rapport) });
    const cible = path.join(p.dossier, path.parse(p.chemin).name + '-rapport.html');
    fs.writeFileSync(cible, String(blocs.contenu || ''), 'utf8');
    return cible;
  } catch (e) {
    p.echecRapport = (e && e.constructor && e.constructor.name) || 'Error';
    return '';
  }
}

function libelleEtape(etapeCli) {
  const e = VERS_PAGE[etapeCli];
  return e ? T(LIBELLES[e]) : '';
}

// Le refus dit dans la langue de l'interface ; un code inconnu garde la phrase de la CLI.
function texteRefus(s) {
  const code = String(s.code_refus || '');
  if (code === 'fichier-verrou') { return T('accueil.preproc.refus.verrou'); }
  if (code === 'extension-inconnue') { return T('accueil.preproc.depot.format'); }
  if (code === 'conversion-impossible') { return T('accueil.preproc.refus.conversion'); }
  if (code === 'lecture-impossible') { return T('accueil.preproc.refus.lecture'); }
  if (code === 'perte-de-contenu') { return T('accueil.preproc.refus.perte', [COURRIEL_SUPPORT]); }
  if (code === 'suivi-modifications') {
    if (s.sortie_nettoyeur) { return T('accueil.preproc.refus.sortie'); }
    const n = Number(s.revisions) || 0;
    return n === 1 ? T('accueil.preproc.refus.suivi.un') : T('accueil.preproc.refus.suivi.plus', [n]);
  }
  return String(s.message || '');
}

// L'issue du passage, comme l'onglet WinForms la tranche : code 0, ou code 1 avec des
// alertes error, est un nettoyage réussi ; un refus a son rapport ; le reste est un échec.
function conclure(p, r, json) {
  const s = r.stats;
  if (r.annule) { return { issue: 'interrompu' }; }
  if (r.lancement) { return { issue: 'echec', texte: T('accueil.preproc.echec.moteur') }; }
  if (s && s.plantage) {
    const libelle = libelleEtape(s.etape);
    return { issue: 'echec', texte: libelle ? T('accueil.preproc.echec.etape', [libelle, COURRIEL_SUPPORT])
      : T('accueil.preproc.echec.inconnu', [COURRIEL_SUPPORT]) };
  }
  if (s && s.refus) { return { issue: 'refus', texte: texteRefus(s), rapport: rendreRapport(p, s, json) }; }
  const alertes = !!s && r.code === 1 && Number(s.alertes_error) > 0;
  if (s && (r.code === 0 || alertes)) {
    return {
      issue: alertes ? 'alertes' : 'ok', rapport: rendreRapport(p, s, json),
      document: s.sortie ? path.join(p.dossier, path.basename(String(s.sortie))) : '',
      alertes: { erreurs: Number(s.alertes_error) || 0, avertissements: Number(s.alertes_warning) || 0,
        suggestions: Number(s.alertes_suggestion) || 0 }
    };
  }
  return { issue: 'echec', texte: T('accueil.preproc.echec.inconnu', [COURRIEL_SUPPORT]) };
}

function empreinte(chemin) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(chemin)).digest('hex').slice(0, 12); } catch (e) { return ''; }
}
const motif = (v, re, defaut) => (re.test(String(v || '')) ? String(v) : defaut);

// Les compteurs du passage et, pour un défaut du logiciel seulement, un NETTOYEUR-ECHEC :
// jamais un texte, un nom de fichier ni un chemin. Les refus attendus et l'interruption
// n'en font aucun.
function constats(p, r, fin) {
  const s = r.stats;
  try {
    let mesures = s && s.compteurs && s.compteurs.mesures;
    let id = (s && s.compteurs && s.compteurs.passage) || '';
    if (!mesures && (fin.issue === 'interrompu' || fin.issue === 'echec')) {
      mesures = { ['issue.' + (fin.issue === 'interrompu' ? 'interrompu' : 'plantage')]: 1, ['produit.' + p.produit]: 1 };
      id = empreinte(p.chemin);
    }
    if (mesures) { ctx.compter({ source: 'nettoyeur', passage: id, mesures }); }
  } catch (e) { /* un compteur est un confort */ }
  try {
    const envoyer = (etape, contenu) => ctx.signaler({
      gravite: 'erreur', source: 'lanceur', code: 'NETTOYEUR-ECHEC', etape: 'nettoyeur : ' + etape,
      message: JSON.stringify(contenu), produit: { type: p.produit }, langueInterface: langueCockpit()
    });
    const code = Number.isInteger(r.code) ? { code_sortie: r.code } : {};
    if (p.echecRapport) {
      envoyer('rendu-rapport', { echec: 'rendu-rapport', type: motif(p.echecRapport, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Error') });
    }
    if (fin.issue === 'interrompu') { return; }
    if (r.lancement) { envoyer('preparation', { echec: 'preparation', phase: 'lancement' }); return; }
    if (s && s.plantage) {
      const etape = motif(s.etape, /^[a-z0-9-]{1,40}$/, 'inconnue');
      envoyer(etape, Object.assign({ plantage: true, type: motif(s.type, /^[A-Za-z_][A-Za-z0-9_]{0,63}$/, 'Exception'),
        lieu: motif(s.lieu, /^([A-Za-z0-9_.-]{1,80}\.py:\d{1,6}|inconnu)$/, 'inconnu'), etape }, code));
      return;
    }
    if (s && s.refus) {
      const etape = { 'lecture-impossible': 'lecture', 'perte-de-contenu': 'controle-perte' }[s.code_refus];
      if (etape) { envoyer(etape, Object.assign({ refus: motif(s.code_refus, /^[a-z][a-z0-9-]{1,40}$/, 'inconnu') }, code)); }
      return;
    }
    if (fin.issue === 'echec') { envoyer('sortie-inattendue', code); }
  } catch (e) { /* jamais vers l'interface */ }
}

// Nettoie un manuscrit : le document et le rapport s'écrivent à côté de lui, le rapport
// s'ouvre dans le navigateur, puis la page reçoit l'issue.
async function nettoyer(chemin, produit, format) {
  const p = passage = { annule: false, proc: null, rang: -1, chemin, produit, dossier: path.dirname(chemin) };
  derniers = null;
  const nom = path.basename(chemin);
  const json = path.join(os.tmpdir(), 'szh-rapport-manuscrit-' + crypto.randomBytes(8).toString('hex') + '.json');
  let fin;
  try {
    ctx.envoyer({ type: MSG.ACCUEIL_PREPROC_DEBUT, nom, produit, format });
    relayer(p, 'preparation');
    // Le dossier du manuscrit passe à --cd, que wsl.exe traduit lui-même : le nom reste relatif.
    const r = await executer(p, ['python3', cheminCli(), './' + nom, '--produit', produit, '--sortie', '.',
      '--rapport', ctx.versMoteur(json), '--format', format, '--etapes']);
    fin = conclure(p, r, json);
    constats(p, r, fin);
  } finally {
    supprimer(json);
    passage = null;
  }
  derniers = { document: fin.document || '', rapport: fin.rapport || '' };
  let ouvert = false;
  if (fin.rapport) { try { ouvert = !!(await ctx.ouvrirExterne(fin.rapport)); } catch (e) { ouvert = false; } }
  ctx.envoyer({ type: MSG.ACCUEIL_PREPROC_FIN, issue: fin.issue, texte: fin.texte || '',
    document: fin.document ? path.basename(fin.document) : '', rapport: !!fin.rapport, rapportOuvert: ouvert,
    alertes: fin.alertes || null });
  envoyerEtat();
}

// La boîte de choix part du dossier du dernier manuscrit, et le nettoyage suit le choix.
async function choisir(msg) {
  const produit = String(msg.produit || '');
  const format = String(msg.format || '');
  if (passage || enChoix || PRODUITS.indexOf(produit) === -1 || FORMATS.indexOf(format) === -1) { return; }
  let chemin;
  enChoix = true;
  try { chemin = await ctx.choisirFichier(dossierDepart()); } finally { enChoix = false; }
  if (!chemin || passage) { return; }
  if (ctx.memoire) { await ctx.memoire.update(CLE_DOSSIER, path.dirname(chemin)); }
  await nettoyer(chemin, produit, format);
}

// Tue le nettoyeur en cours : Interrompre, la fermeture du panneau, l'ouverture d'un dossier
// et la désactivation. Tuer wsl.exe tue aussi le Python qu'il porte (mesuré).
function arreter() {
  if (!passage) { return; }
  passage.annule = true;
  try { if (passage.proc) { passage.proc.kill(); } } catch (e) { /* déjà fini */ }
}

function ouvrir(msg) {
  if (!derniers) { return; }
  const quoi = String(msg.quoi || '');
  if (quoi === 'document' && derniers.document) { ctx.ouvrirExterne(derniers.document); }
  if (quoi === 'rapport' && derniers.rapport) { ctx.ouvrirExterne(derniers.rapport); }
  if (quoi === 'dossier' && (derniers.document || derniers.rapport)) { ctx.revelerFichier(derniers.document || derniers.rapport); }
}

// Rend vrai si le message est l'un des siens. Le dépôt, fermé, n'est pas traité.
function surMessage(msg) {
  if (msg.type === MSG.ACCUEIL_PREPROC_CHOISIR) { choisir(msg); return true; }
  if (msg.type === MSG.ACCUEIL_PREPROC_INTERROMPRE) { arreter(); return true; }
  if (msg.type === MSG.ACCUEIL_PREPROC_OUVRIR) { ouvrir(msg); return true; }
  if (msg.type === MSG.ACCUEIL_PREPROC_DEPOSER) { return true; }
  return false;
}

function enCours() { return !!passage; }

module.exports = {
  configurer, surMessage, arreter, envoyerEtat, etat, enCours, choisir, nettoyer,
  CLE_DOSSIER, DEPOT, VERS_PAGE
};
