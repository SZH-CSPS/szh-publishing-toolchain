// L'onglet Log de l'Accueil : les journaux de mise à jour, leur fin, l'éditeur, et le
// signalement d'un problème en un seul geste. Sans panneau : lib/accueil-hote.js lui relaie
// les messages de la page.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { MSG } = require('./messages');
const { T, langueCockpit } = require('./i18n');
const journaux = require('./journaux-maj');
const rapportErreur = require('./rapport-erreur');
const { COURRIEL_SUPPORT } = require('./codes-erreur');
const { compiler } = require('./gabarits');
const { normaliserRenduCourriel, uriMailto } = require('./courriel');
const { toolkitPoste } = require('./poste');

// La longueur au-delà de laquelle un client de messagerie tronque un mailto:, comme dans le socle.
const CORPS_MAX = 1500;

let ctx = {
  envoyer: () => {},
  ouvrirEditeur: () => {},
  ouvrirDossier: () => {},
  ouvrirLien: () => {},
  versionEditeur: () => null
};
function configurer(nouveauCtx) { ctx = Object.assign({}, ctx, nouveauCtx); }

// Les journaux envoyés à la page, dans l'ordre de leur rang.
let liste = [];

function dateLisible(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return p2(d.getDate()) + '.' + p2(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
}

// Ce que la page affiche de chaque journal : la date, le verdict et la taille en ko.
function listePage() {
  liste = journaux.journauxMaj();
  return liste.map((j, rang) => ({ rang, date: dateLisible(j.date), verdict: j.verdict, ko: Math.max(1, Math.round(j.taille / 1024)) }));
}
function journalDe(rang) { return Number.isInteger(rang) && rang >= 0 ? liste[rang] || null : null; }

function lire(msg) {
  const j = journalDe(msg.rang);
  if (!j) { return; }
  try {
    const fin = journaux.finJournal(j.chemin);
    ctx.envoyer({ type: MSG.ACCUEIL_JOURNAL_TEXTE, rang: msg.rang, texte: fin.texte, lignes: fin.lignes });
  } catch (e) {
    ctx.envoyer({ type: MSG.ACCUEIL_JOURNAL_TEXTE, rang: msg.rang, erreur: String((e && e.message) || e) });
  }
}

// Le brouillon au support, rendu par le gabarit du socle (windows/mail-templates) ; sans
// gabarit lisible, un brouillon vide à la bonne adresse plutôt que rien.
function brouillonSupport(phrase, journal) {
  const dossier = path.join(toolkitPoste(), 'windows', 'mail-templates');
  const variables = { poste: os.hostname(), etape: T('accueil.journal.signaler.titre'), message: phrase, journal: journal || '' };
  for (const langue of [langueCockpit(), 'fr']) {
    const chemin = path.join(dossier, 'support.' + langue + '.twig');
    let source;
    try { source = fs.readFileSync(chemin, 'utf8'); } catch (e) { continue; }
    try {
      const rendu = normaliserRenduCourriel(compiler(source, path.basename(chemin)).rendre(variables));
      return { destinataire: COURRIEL_SUPPORT, sujet: rendu.sujet, corps: rendu.corps.slice(0, CORPS_MAX) };
    } catch (e) { break; }
  }
  return { destinataire: COURRIEL_SUPPORT, sujet: '', corps: '' };
}

// Un seul geste : le rapport part par la voie du cockpit avec la phrase et le journal
// affiché, puis le dossier des journaux et le brouillon au support s'ouvrent.
function signaler(msg) {
  const phrase = String(msg.phrase || '').trim().slice(0, 300);
  if (!phrase) { return; }
  const j = journalDe(msg.rang);
  const r = rapportErreur.emettreRapport({
    gravite: 'erreur', source: 'lanceur', code: 'LANCEUR-SIGNALEMENT',
    etape: T('accueil.journal.signaler.titre'), message: phrase,
    journal: j ? rapportErreur.lireExtraitFichier(j.chemin) : null,
    langueInterface: langueCockpit(), vscodiumVersion: ctx.versionEditeur()
  });
  const issue = r.ecrit ? 'fait' : (r.enAttente ? 'attente' : 'refuse');
  ctx.ouvrirDossier(journaux.dossierJournaux());
  ctx.ouvrirLien(uriMailto(brouillonSupport(phrase, j && j.chemin)));
  ctx.envoyer({ type: MSG.ACCUEIL_SIGNALE, issue, courriel: true });
}

// Rend vrai si le message est l'un des siens.
function surMessage(msg) {
  if (msg.type === MSG.ACCUEIL_JOURNAL_LIRE) { lire(msg); return true; }
  if (msg.type === MSG.ACCUEIL_JOURNAL_EDITEUR) {
    const j = journalDe(msg.rang);
    if (j) { ctx.ouvrirEditeur(j.chemin); }
    return true;
  }
  if (msg.type === MSG.ACCUEIL_SIGNALER) { signaler(msg); return true; }
  return false;
}

module.exports = { configurer, surMessage, listePage, brouillonSupport, dateLisible };
