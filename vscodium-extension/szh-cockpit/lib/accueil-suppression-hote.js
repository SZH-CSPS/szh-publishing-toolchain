// Suppression d'un numéro en cours de la Revue ou de la Zeitschrift, depuis l'onglet Produits
// de l'Accueil. La page prépare, puis confirme ; l'hôte revérifie tout à la confirmation et
// ne se fie à rien de ce que la page envoie. Sans panneau : lib/accueil-hote.js lui relaie
// les messages de la page.
'use strict';

const fs = require('fs');
const path = require('path');

const { MSG } = require('./messages');
const { T } = require('./i18n');
const { etatRevue, analyserAusgabe } = require('./yaml');
const { verrouPose } = require('./verrou');
const profils = require('./profil');
const inventaire = require('./inventaire');
const session = require('./session');
const { refusCoeditionNumero } = require('./coedition-hote');
const { supprimerArbre } = require('./supprimer');
const { basePoste } = require('./poste');

// Le mot qui complète « with great power comes great ________ ».
const MOT_ATTENDU = 'responsibilities';
// Délai minimal entre la préparation et la confirmation.
const DELAI_MS = 10000;
// Les produits dont un numéro en cours peut se supprimer.
const PRODUITS = ['revue', 'zeitschrift'];

let ctx = {
  envoyer: () => {},
  // Les dossiers ouverts dans cette fenêtre.
  dossiersOuverts: () => [],
  // Relit l'inventaire et le renvoie à la page.
  rafraichir: () => {},
  maintenant: () => Date.now(),
  // Attentes entre deux essais de suppression (lib/supprimer.js) ; les tests les raccourcissent.
  attentes: undefined
};
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// La préparation en cours : { chemin, instant }, ou null.
let preparation = null;
// Vrai pendant une suppression : une seconde confirmation est refusée.
let suppressionEnCours = false;

function memeChemin(a, b) {
  const n = (c) => path.resolve(String(c || ''));
  return process.platform === 'win32' ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
}

// Vrai si le chemin est, à l'instant, un numéro en cours de la Revue ou de la Zeitschrift.
// La comparaison est exacte : la page renvoie le chemin que l'inventaire lui a donné.
function estNumeroEnCours(chemin) {
  if (typeof chemin !== 'string' || chemin === '') { return false; }
  const inv = inventaire.inventaire();
  return PRODUITS.some((jeton) => {
    const p = inv.produits[jeton];
    return !!p && p.enCours.some((e) => e.chemin === chemin);
  });
}

// Les dossiers d'articles du numéro.
function compterArticles(racine) {
  try {
    return fs.readdirSync(path.join(racine, 'articles'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.')).length;
  } catch (e) { return 0; }
}

// -> null quand le numéro peut être supprimé, sinon le message du refus. Même liste à la
// préparation et à la confirmation.
function refus(chemin) {
  if (!estNumeroEnCours(chemin)) { return T('accueil.supprimer.refus.inconnu'); }
  const profil = profils.detecter(chemin);
  if (!profil || profil.cle !== 'revue' || !fs.existsSync(path.join(chemin, 'ausgabe.yaml'))) {
    return T('accueil.supprimer.refus.inconnu');
  }
  if (etatRevue(chemin).verrouillee || verrouPose(chemin)) { return T('accueil.supprimer.refus.verrou'); }
  if (session.buildEnCours() || session.importEnCours()) { return T('statut.occupe'); }
  if ((ctx.dossiersOuverts() || []).some((d) => memeChemin(d, chemin))) { return T('accueil.supprimer.refus.ouvert'); }
  return refusCoeditionNumero(chemin);
}

// Ajoute une ligne au journal du mois du poste, au format de Write-SzhLog
// (windows/szh-common.ps1). Ne lève pas.
function journaliser(message) {
  try {
    const d = new Date(ctx.maintenant());
    const p2 = (n) => String(n).padStart(2, '0');
    const mois = d.getFullYear() + '-' + p2(d.getMonth() + 1);
    const horodatage = mois + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
    const dossier = path.join(basePoste(), 'logs');
    fs.mkdirSync(dossier, { recursive: true });
    fs.appendFileSync(path.join(dossier, 'szh-' + mois + '.log'), horodatage + '  ' + message + '\r\n', 'utf8');
  } catch (e) { /* journal injoignable : la suppression a eu lieu ou non, la page le dit */ }
}

// Le numéro tel que la liste de l'Accueil le montre (nom du dossier, « 2026-03 »), et son
// titre (`title:` d'ausgabe.yaml) ou ''.
function numeroCourt(racine) { return path.basename(racine); }
function titreSeul(racine) {
  try { return String(analyserAusgabe(fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8')).title || '').trim(); }
  catch (e) { return ''; }
}

// Première étape : vérifier, compter, noter l'instant. La page n'ouvre sa fenêtre de
// confirmation que sur cette réponse.
function preparer(chemin) {
  preparation = null;
  const motif = suppressionEnCours ? T('statut.occupe') : refus(chemin);
  if (motif) {
    ctx.envoyer({ type: MSG.ACCUEIL_SUPPRIMER_PRET, ok: false, texte: motif });
    return;
  }
  preparation = { chemin, instant: ctx.maintenant() };
  ctx.envoyer({ type: MSG.ACCUEIL_SUPPRIMER_PRET, ok: true, chemin,
    numero: numeroCourt(chemin), titre: titreSeul(chemin),
    articles: compterArticles(chemin), mot: MOT_ATTENDU, secondes: DELAI_MS / 1000 });
}

// -> null quand la confirmation est recevable, sinon le message du refus.
function refusConfirmation(chemin, mot) {
  if (suppressionEnCours) { return T('statut.occupe'); }
  if (!preparation || typeof chemin !== 'string' || chemin !== preparation.chemin) {
    return T('accueil.supprimer.refus.preparation');
  }
  if (String(mot === undefined || mot === null ? '' : mot).trim().toLowerCase() !== MOT_ATTENDU) {
    return T('accueil.supprimer.refus.mot');
  }
  if (ctx.maintenant() - preparation.instant < DELAI_MS) {
    return T('accueil.supprimer.refus.delai', [DELAI_MS / 1000]);
  }
  return refus(chemin);
}

// Seconde étape. Un refus laisse la préparation en place : la page peut corriger et
// reconfirmer. Une suppression tentée, réussie ou non, la consomme.
async function confirmer(chemin, mot) {
  const motif = refusConfirmation(chemin, mot);
  if (motif) {
    ctx.envoyer({ type: MSG.ACCUEIL_SUPPRIMER_FIN, ok: false, refus: true, texte: motif });
    return;
  }
  preparation = null;
  suppressionEnCours = true;
  const numero = numeroCourt(chemin);
  const articles = compterArticles(chemin);
  let erreur;
  try {
    erreur = await supprimerArbre(chemin, { attentes: ctx.attentes });
  } finally { suppressionEnCours = false; }
  if (erreur && fs.existsSync(chemin)) {
    journaliser('suppression-numero ERREUR : ' + chemin + ' : ' + erreur);
    ctx.envoyer({ type: MSG.ACCUEIL_SUPPRIMER_FIN, ok: false, texte: T('accueil.supprimer.echec', [chemin, erreur]) });
  } else {
    journaliser('suppression-numero OK : ' + chemin + ' (' + articles + ' article(s))');
    ctx.envoyer({ type: MSG.ACCUEIL_SUPPRIMER_FIN, ok: true, texte: T('accueil.supprimer.ok', [numero]) });
  }
  ctx.rafraichir();
}

// -> vrai si le message était pour ce module. La confirmation rend une promesse, que l'hôte
// n'attend pas : la page reçoit l'issue par message, une exception comprise.
function surMessage(msg) {
  if (msg.type === MSG.ACCUEIL_SUPPRIMER_PREPARER) { preparer(msg.chemin); return true; }
  if (msg.type === MSG.ACCUEIL_SUPPRIMER_CONFIRMER) {
    return confirmer(msg.chemin, msg.mot)
      .catch((e) => ctx.envoyer({ type: MSG.ACCUEIL_SUPPRIMER_FIN, ok: false, texte: String((e && e.message) || e) }))
      .then(() => true);
  }
  return false;
}

// Oublie la préparation, à la fermeture du panneau.
function arreter() { preparation = null; }

module.exports = { configurer, surMessage, preparer, confirmer, arreter, refus, compterArticles,
  MOT_ATTENDU, DELAI_MS };
