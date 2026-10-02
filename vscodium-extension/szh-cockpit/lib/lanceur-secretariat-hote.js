// L'onglet Secrétariat du lanceur : les numéros publiés et les quatre exports, lancés par
// outils/secretariat-cli.js, et l'historique Edudoc et Caractères du compte. Sans panneau :
// lib/lanceur-hote.js lui relaie les messages de la page.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { MSG } = require('./messages');
const { langueCockpit } = require('./i18n');
const inventaire = require('./inventaire');
const { cheminCacheMotsCles } = require('./mots-cles-edudoc');
const { numeroAffiche } = require('./lanceur-page');

const OJS = 'numeros-ojs';
// Le dossier de chaque export, sous <racine active>\Exports.
const SOUS_DOSSIERS = {
  newsletter: 'Newsletter', edudoc: 'Edudoc', caracteres: 'Caractères par article',
  metadonnees: 'Contrôle des métadonnées'
};
const REVUES = ['revue', 'zeitschrift'];
// Par compte : { edudoc: { <revue>: { <clé>: <date> } }, caracteres: … }.
const CLE_HISTORIQUE = 'szh.lanceur.historique';
const HISTORISES = ['edudoc', 'caracteres'];

let ctx = {
  envoyer: () => {},
  revelerFichier: () => {},
  ouvrirDossier: () => {},
  memoire: null,
  numerosConnus: () => new Set(),
  racineExports: () => path.join(inventaire.inventaire().base, 'Exports'),
  cli: path.join(__dirname, '..', 'outils', 'secretariat-cli.js'),
  node: process.execPath
};
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Deux enfants au plus : le chargement des numéros publiés, et une tâche.
const enfants = { ojs: null, tache: null };
let tache = null;
// Le fichier des numéros publiés de chaque revue, que l'export Edudoc ou Caractères relit.
const caches = {};

function jour(date) {
  const p2 = (n) => String(n).padStart(2, '0');
  return p2(date.getDate()) + '.' + p2(date.getMonth() + 1) + '.' + date.getFullYear();
}
function dossierExport(commande) { return path.join(ctx.racineExports(), SOUS_DOSSIERS[commande]); }
function cacheDe(revue) {
  if (!caches[revue]) { caches[revue] = path.join(os.tmpdir(), 'szh-lanceur-' + process.pid + '-' + revue + '.json'); }
  return caches[revue];
}
function supprimer(chemin) { try { fs.rmSync(chemin, { force: true }); } catch (e) { /* déjà parti */ } }

// Lance une commande du CLI et relaie chacune de ses lignes JSON. Rend { ok, texte, annule,
// fichiers } à la fin du processus, et ne rejette jamais.
function executer(place, commande, args, surLigne) {
  return new Promise((resolve) => {
    const suivi = { commande, annule: false, proc: null };
    let fin = null;
    let reste = '';
    const erreurs = [];
    const fichiers = [];
    let fini = false;
    const finir = (v) => {
      if (fini) { return; }
      fini = true;
      if (enfants[place] === suivi) { enfants[place] = null; }
      resolve(Object.assign({ fichiers }, v));
    };
    const traiter = (ligne) => {
      if (!ligne.trim()) { return; }
      let o;
      try { o = JSON.parse(ligne); } catch (e) { return; }
      if (!o || typeof o !== 'object') { return; }
      if (o.t === 'fin') { fin = o; }
      if (o.t === 'fichier' && o.chemin) { fichiers.push(String(o.chemin)); }
      surLigne(o);
    };
    try {
      suivi.proc = spawn(ctx.node, [ctx.cli, commande].concat(args, ['--langue', langueCockpit()]), {
        env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1' }),
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) { finir({ ok: false, texte: String((e && e.message) || e) }); return; }
    enfants[place] = suivi;
    suivi.proc.stdout.setEncoding('utf8');
    suivi.proc.stdout.on('data', (d) => {
      const lignes = (reste + d).split(/\r?\n/);
      reste = lignes.pop();
      lignes.forEach(traiter);
    });
    suivi.proc.stderr.on('data', (d) => erreurs.push(d));
    suivi.proc.on('error', (e) => finir({ ok: false, annule: suivi.annule, texte: String((e && e.message) || e) }));
    suivi.proc.on('close', (code) => {
      if (reste) { traiter(reste); }
      if (suivi.annule) { finir({ ok: false, annule: true, texte: '' }); return; }
      if (fin) { finir({ ok: !!fin.ok && code === 0, texte: String(fin.texte || '') }); return; }
      finir({ ok: false, texte: Buffer.concat(erreurs).toString('utf8').trim().split(/\r?\n/)[0] || '' });
    });
  });
}

function tuer(place) {
  const e = enfants[place];
  if (!e) { return; }
  e.annule = true;
  try { e.proc.kill(); } catch (err) { /* déjà fini */ }
}

// Tue les deux enfants et oublie les numéros chargés : à la fermeture du panneau, à
// l'ouverture d'un dossier et à la désactivation, rien ne doit survivre au lanceur.
function arreter() {
  if (tache) { tache.annule = true; }
  tuer('ojs');
  tuer('tache');
  for (const revue of Object.keys(caches)) { supprimer(caches[revue]); delete caches[revue]; }
}

function historique() {
  const h = ctx.memoire && ctx.memoire.get(CLE_HISTORIQUE);
  return h && typeof h === 'object' ? h : {};
}
async function retenir(commande, revue, cles, date) {
  if (!ctx.memoire || HISTORISES.indexOf(commande) === -1) { return; }
  const h = JSON.parse(JSON.stringify(historique()));
  const parRevue = (h[commande] = h[commande] || {});
  const numeros = (parRevue[revue] = parRevue[revue] || {});
  for (const c of cles) { numeros[c] = date; }
  await ctx.memoire.update(CLE_HISTORIQUE, h);
}

async function chargerOjs(msg) {
  const revue = String(msg.revue || '');
  const annee = Number(msg.depuisAnnee);
  if (enfants.ojs || REVUES.indexOf(revue) === -1 || !(annee >= 1000 && annee <= 9999)) { return; }
  ctx.envoyer({ type: MSG.LANCEUR_DEBUT, commande: OJS });
  const r = await executer('ojs', OJS, ['--revue', revue, '--cache', cacheDe(revue), '--depuis-annee', String(annee)],
    (ligne) => ctx.envoyer({ type: MSG.LANCEUR_LIGNE, commande: OJS, ligne }));
  ctx.envoyer({ type: MSG.LANCEUR_FIN, commande: OJS, ok: r.ok, texte: r.texte, annule: !!r.annule });
}

// La demande de la page en arguments du CLI, ou null si elle est mal formée. Un numéro local
// n'est accepté que si la page l'a reçu de l'hôte.
function demande(msg) {
  const commande = String(msg.commande || '');
  const revue = String(msg.revue || '');
  if (!SOUS_DOSSIERS[commande] || REVUES.indexOf(revue) === -1) { return null; }
  if (commande === 'newsletter' || commande === 'metadonnees') {
    const chemin = String(((msg.numeros || [])[0]) || '');
    if (!ctx.numerosConnus().has(chemin)) { return null; }
    // Un sous-dossier par numéro : ses fichiers portent les mêmes noms d'un numéro à l'autre.
    const sortie = path.join(dossierExport(commande), numeroAffiche(path.basename(chemin)));
    return { commande, revue, chemin, sortie };
  }
  const cles = (Array.isArray(msg.cles) ? msg.cles : []).map(String).filter((c) => /^\d{4}-\d{2}$/.test(c));
  if (!cles.length) { return null; }
  return { commande, revue, cles, sortie: dossierExport(commande) };
}

// Les mots-clés d'Edudoc : les numéros du poste de la revue, en cours et archivés, et le
// thésaurus que lit aussi le panneau des fiches.
function sourcesMotsCles(revue) {
  const produit = inventaire.inventaire().produits[revue];
  const numeros = produit ? produit.enCours.concat(produit.archives) : [];
  return numeros.reduce((args, n) => args.concat(['--numero', n.chemin]), []).concat(['--mots-cles', cheminCacheMotsCles()]);
}

// Le contrôle des métadonnées charge d'abord les numéros publiés depuis l'année du numéro,
// dans un fichier à lui.
async function etapes(d, relayer) {
  if (d.commande === 'newsletter') {
    return executer('tache', d.commande, ['--numero', d.chemin, '--sortie', d.sortie], relayer);
  }
  if (d.commande === 'metadonnees') {
    const cache = path.join(os.tmpdir(), 'szh-lanceur-' + process.pid + '-metadonnees.json');
    try {
      const annee = /^(\d{4})-/.exec(path.basename(d.chemin));
      const args = ['--revue', d.revue, '--cache', cache].concat(annee ? ['--depuis-annee', annee[1]] : []);
      const charge = await executer('tache', OJS, args, relayer);
      if (!charge.ok || tache.annule) { return Object.assign(charge, { annule: charge.annule || tache.annule }); }
      return await executer('tache', d.commande, ['--numero', d.chemin, '--cache', cache, '--sortie', d.sortie], relayer);
    } finally { supprimer(cache); }
  }
  const args = ['--cache', cacheDe(d.revue), '--numeros', d.cles.join(','), '--sortie', d.sortie];
  return executer('tache', d.commande, d.commande === 'edudoc' ? args.concat(sourcesMotsCles(d.revue)) : args, relayer);
}

async function exporter(msg) {
  if (tache) { return; }
  const d = demande(msg);
  if (!d) { return; }
  tache = { commande: d.commande, annule: false };
  try {
    try { fs.mkdirSync(d.sortie, { recursive: true }); } catch (e) { /* le CLI le dira */ }
    ctx.envoyer({ type: MSG.LANCEUR_DEBUT, commande: d.commande });
    const r = await etapes(d, (ligne) => ctx.envoyer({ type: MSG.LANCEUR_LIGNE, commande: d.commande, ligne }));
    const date = jour(new Date());
    if (r.ok) { await retenir(d.commande, d.revue, d.cles || [], date); }
    ctx.envoyer({ type: MSG.LANCEUR_FIN, commande: d.commande, ok: r.ok, texte: r.texte, annule: !!r.annule,
      dossier: d.sortie, date });
    // Le fichier produit s'ouvre dans l'Explorateur ; plusieurs fichiers, leur dossier.
    if (r.ok && r.fichiers.length === 1) { ctx.revelerFichier(r.fichiers[0]); }
    else if (r.ok && r.fichiers.length > 1) { ctx.ouvrirDossier(d.sortie); }
  } finally { tache = null; }
}

function interrompre(msg) {
  if (!tache || tache.commande !== msg.commande) { return; }
  tache.annule = true;
  tuer('tache');
}

// « Afficher le fichier » ne montre que ce qui est sous le dossier des exports.
function afficher(msg) {
  const chemin = path.resolve(String(msg.chemin || ''));
  const relatif = path.relative(ctx.racineExports(), chemin);
  if (!msg.chemin || relatif.startsWith('..') || path.isAbsolute(relatif)) { return; }
  let stat = null;
  try { stat = fs.statSync(chemin); } catch (e) { return; }
  if (stat.isDirectory()) { ctx.ouvrirDossier(chemin); } else { ctx.revelerFichier(chemin); }
}

// Rend vrai si le message est l'un des siens.
function surMessage(msg) {
  if (msg.type === MSG.LANCEUR_OJS_CHARGER) { chargerOjs(msg); return true; }
  if (msg.type === MSG.LANCEUR_EXPORTER) { exporter(msg); return true; }
  if (msg.type === MSG.LANCEUR_INTERROMPRE) { interrompre(msg); return true; }
  if (msg.type === MSG.LANCEUR_AFFICHER) { afficher(msg); return true; }
  return false;
}

function enCours() { return { ojs: !!enfants.ojs, tache: !!enfants.tache }; }

module.exports = {
  configurer, surMessage, arreter, historique, enCours,
  chargerOjs, exporter, SOUS_DOSSIERS, CLE_HISTORIQUE
};
