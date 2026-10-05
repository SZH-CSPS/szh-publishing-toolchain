// « Raccourcir les résumés », dans Paramètres de l'Accueil : la clé d'API Mistral du poste
// (SecretStorage), son test, le modèle, et le traitement des propositions en attente.
'use strict';

const vscode = require('vscode');
const os = require('os');
const fs = require('fs');

const { T, langueCockpit } = require('./i18n');
const { MSG } = require('./messages');
const mistral = require('./mistral');
const resumes = require('./resumes');
const propositions = require('./propositions');
const archivage = require('./archivage');
const inventaire = require('./inventaire');

// La clé vit dans le coffre de l'éditeur, propre au poste : jamais dans un fichier, jamais
// envoyée à une page, jamais dans l'environnement de la chaîne.
const CLE_COFFRE = 'szh.mistralCle';
const RE_MODELE = /^[a-z0-9][a-z0-9._-]{1,63}$/;
// Après tant d'échecs de suite, la passe s'arrête : le service ne répond plus.
const ECHECS_DE_SUITE = 3;
// Une erreur qui vaut pour toutes les propositions arrête la passe.
const ERREURS_FATALES = ['cle-refusee', 'quota-nul', 'quota'];

let ctx = {
  envoyer: () => {},
  racineMoissons: () => inventaire.baseRevuesPour(archivage.lireEmplacementRevues()),
  langue: () => langueCockpit(),
  poste: () => { try { return os.hostname(); } catch (e) { return ''; } },
  // Le client : remplaçable par un faux serveur dans les tests.
  creerClient: (cle) => mistral.creerClient({ cle: cle })
};
function configurer(n) { ctx = Object.assign({}, ctx, n); }

let secrets = null;
let cleDefinie = false;
let dernierTest = null;
let passe = null;          // { arreter, fait, total, echecs, jetons }
let dernierBilan = null;
let derniereFin = Promise.resolve();

function modele() {
  const v = String(vscode.workspace.getConfiguration('szh').get('mistralModele', '') || '').trim();
  return v || resumes.prompts().modele;
}

async function lireCle() {
  try { return secrets ? String((await secrets.get(CLE_COFFRE)) || '') : ''; } catch (e) { return ''; }
}
async function relireCle() { cleDefinie = (await lireCle()) !== ''; }

function texteErreur(e) {
  const code = e && e.code ? e.code : 'reseau';
  const cle = 'resumes.err.' + code;
  const t = T(cle, [e && e.statut ? e.statut : '']);
  return t === cle ? T('resumes.err.reseau') : t;
}

// L'état que la page affiche : la clé seulement « définie » ou non.
function etat() {
  const langue = ctx.langue() === 'de' ? 'de' : 'fr';
  let c = { liste: [], parType: {}, jetons: 0 };
  // Sans _Moissons à la racine active, la section ne se montre pas.
  let disponible = false;
  try {
    const racine = ctx.racineMoissons();
    disponible = fs.existsSync(propositions.cheminMoissons(racine));
    // Pendant la passe, le compte de départ suffit : chaque pas ne relit pas tous les lots.
    if (disponible) { c = passe && passe.compte ? passe.compte : resumes.candidats(racine, langue); }
  } catch (e) { disponible = false; }
  return {
    type: MSG.ACCUEIL_RESUMES_ETAT, cle: cleDefinie, modele: modele(), modeleDefaut: resumes.prompts().modele,
    prompt: resumes.prompts().version, langue: langue, disponible: disponible,
    candidats: c.liste.length, parType: c.parType, jetons: c.jetons,
    enCours: passe ? { fait: passe.fait, total: passe.total, echecs: passe.echecs, jetons: passe.jetons, arret: passe.arreter } : null,
    bilan: dernierBilan, test: dernierTest
  };
}
function envoyerEtat() { ctx.envoyer(etat()); }

async function poserCle(valeur) {
  const v = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  dernierTest = null;
  try {
    if (!secrets) { dernierTest = { ok: false, texte: T('accueil.regl.coffre.absent') }; return; }
    if (v === '') { await secrets.delete(CLE_COFFRE); } else { await secrets.store(CLE_COFFRE, v); }
  } catch (e) {
    // Le message du coffre peut citer la valeur : on ne le recopie pas.
    dernierTest = { ok: false, texte: T('accueil.regl.coffre.echec') };
  }
  await relireCle();
}

// GET /v1/models : la clé ouvre-t-elle l'API, et le modèle réglé en fait-il partie ?
async function testerCle() {
  const cle = await lireCle();
  if (!cle) { dernierTest = { ok: false, texte: T('resumes.err.cle-absente') }; return; }
  try {
    const ids = await ctx.creerClient(cle).modeles();
    const m = modele();
    dernierTest = ids.indexOf(m) !== -1
      ? { ok: true, texte: T('resumes.test.ok', [ids.length, m]) }
      : { ok: false, texte: T('resumes.test.sansModele', [ids.length, m]) };
  } catch (e) { dernierTest = { ok: false, texte: texteErreur(e) }; }
}

async function reglerModele(valeur) {
  const v = String(valeur || '').trim();
  if (v !== '' && !RE_MODELE.test(v)) { dernierTest = { ok: false, texte: T('resumes.modele.invalide') }; return; }
  await vscode.workspace.getConfiguration('szh').update('mistralModele', v === '' ? undefined : v, vscode.ConfigurationTarget.Global);
}

// La passe : une proposition après l'autre, un fichier écrit après chacune, l'état envoyé à
// chaque pas. Arrêter finit la proposition en cours.
async function lancer() {
  if (passe) { return; }
  const cle = await lireCle();
  dernierBilan = null;
  if (!cle) { dernierBilan = { ok: false, texte: T('resumes.err.cle-absente') }; return; }
  const racine = ctx.racineMoissons();
  const langue = ctx.langue() === 'de' ? 'de' : 'fr';
  let compte;
  try { compte = resumes.candidats(racine, langue); }
  catch (e) { dernierBilan = { ok: false, texte: T('resumes.err.lecture') }; return; }
  const client = ctx.creerClient(cle);
  const m = modele();
  const liste = compte.liste;
  passe = { arreter: false, fait: 0, total: liste.length, echecs: 0, jetons: 0, compte: compte };
  envoyerEtat();
  let deSuite = 0;
  let fatale = null;
  try {
    for (const p of liste) {
      if (passe.arreter) { break; }
      try {
        const r = await resumes.resumer(p, langue, { client: client, modele: m, poste: ctx.poste() });
        if (r) { resumes.ecrireResume(racine, r); passe.jetons += r.jetons; }
        deSuite = 0;
      } catch (e) {
        passe.echecs++;
        deSuite++;
        if (ERREURS_FATALES.indexOf(e && e.code) !== -1 || deSuite >= ECHECS_DE_SUITE) { fatale = e; }
      }
      passe.fait++;
      envoyerEtat();
      if (fatale) { break; }
    }
  } finally {
    const p = passe;
    passe = null;
    const texte = fatale ? texteErreur(fatale)
      : T(p.arreter ? 'resumes.bilan.arrete' : 'resumes.bilan.fini', [p.fait - p.echecs, p.total, p.jetons]);
    dernierBilan = { ok: !fatale && p.echecs === 0, texte: texte, echecs: p.echecs };
  }
}

// Rend vrai quand le message est celui de cette zone. La passe tourne sans bloquer la page.
async function surMessage(msg) {
  if (msg.type === MSG.ACCUEIL_MISTRAL_CLE) { await poserCle(msg.valeur); envoyerEtat(); return true; }
  if (msg.type === MSG.ACCUEIL_MISTRAL_TESTER) { await testerCle(); envoyerEtat(); return true; }
  if (msg.type === MSG.ACCUEIL_MISTRAL_MODELE) { await reglerModele(msg.valeur); envoyerEtat(); return true; }
  if (msg.type === MSG.ACCUEIL_RESUMES_ARRETER) { if (passe) { passe.arreter = true; } envoyerEtat(); return true; }
  if (msg.type === MSG.ACCUEIL_RESUMES_LANCER) {
    derniereFin = lancer().then(envoyerEtat, envoyerEtat);
    return true;
  }
  return false;
}

// La fin de la dernière passe lancée, pour qui doit l'attendre.
function finPasse() { return derniereFin; }

function arreter() { if (passe) { passe.arreter = true; } }

function demarrer(context) {
  secrets = (context && context.secrets) || null;
  try {
    if (secrets && secrets.onDidChange) { context.subscriptions.push(secrets.onDidChange(() => { relireCle().catch(() => {}); })); }
  } catch (e) { /* hôte sans cet évènement */ }
  relireCle().catch(() => {});
}

module.exports = { configurer, demarrer, arreter, surMessage, envoyerEtat, etat, finPasse, CLE_COFFRE };
