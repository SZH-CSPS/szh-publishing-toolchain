// La moisson mensuelle vue du cockpit, sans vscode : ce que _Moissons dit de l'état partagé
// (créneau, compteurs du mois, socle, dernière passe, imports FNS), et l'état d'une passe tiré des
// événements pronto-moisson/1 (moissonneurs/LISEZMOI.md, docs/FORMAT-MOISSONS.md).
'use strict';

const fs = require('fs');
const path = require('path');

// Recopiées de moissonneurs/creneau.py, que le cockpit ne peut pas importer ; un test les compare.
const PERIME_S = 15 * 60;
const ATTENTE_CRENEAU_S = 90;
const MARGE_REQUETES = 120;

const FORMAT_EVENEMENT = 'pronto-moisson/1';
const FORMAT_CRENEAU = 'pronto-creneau/1';
const FORMAT_REQUETES = 'pronto-requetes/1';
const FORMAT_ETAT = 'pronto-etat/1';
const FORMAT_IMPORT_FNS = 'pronto-import-fns/1';
const FORMAT_PASSE = 'pronto-passe/1';
const DOSSIER_CRENEAU = '_Creneau';
const RE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const AVERTISSEMENTS_GARDES = 30;

function lireJson(chemin) {
  try { return JSON.parse(fs.readFileSync(chemin, 'utf8').replace(/^﻿/, '')); } catch (e) { return null; }
}
function lister(dossier) {
  try { return fs.readdirSync(dossier); } catch (e) { return []; }
}
function lireIso(texte) { return typeof texte === 'string' && RE_ISO.test(texte) ? new Date(texte) : null; }
// Un jour AAAA-MM-JJ, à minuit UTC.
function lireJour(texte) { return typeof texte === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(texte) ? new Date(texte + 'T00:00:00Z') : null; }

// partage.normaliser : minuscules sans accents, tout ce qui n'est ni lettre, ni chiffre, ni `.`
// ni `_` devient `-`.
function normaliser(nom) {
  const s = String(nom === undefined || nom === null ? '' : nom).normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '').toLowerCase().trim();
  return s.replace(/[^a-z0-9._]+/g, '-').replace(/^-+|-+$/g, '') || '-';
}
function clePoste(poste, compte) { return normaliser(poste) + '__' + normaliser(compte); }

function moisDe(date) { return date.toISOString().slice(0, 7); }

// Les annonces de créneau encore vivantes : battement de moins de quinze minutes, échéance à venir.
// `expire` : le moment où l'annonce cessera de compter si son poste ne bat plus.
function annoncesVivantes(moissons, maintenant) {
  const dossier = path.join(moissons, DOSSIER_CRENEAU);
  const res = [];
  for (const nom of lister(dossier).filter((n) => n.endsWith('.json')).sort()) {
    const a = lireJson(path.join(dossier, nom));
    if (!a || typeof a !== 'object' || a.format !== FORMAT_CRENEAU) { continue; }
    const battement = lireIso(a.battement);
    const echeance = lireIso(a.echeance);
    if (!battement || !echeance) { continue; }
    if ((maintenant - battement) / 1000 > PERIME_S || maintenant > echeance) { continue; }
    const fin = new Date(Math.min(battement.getTime() + PERIME_S * 1000, echeance.getTime()));
    res.push({ cle: nom.slice(0, -5), poste: String(a.poste || '?'), compte: String(a.compte || '?'),
      debut: lireIso(a.debut), echeance: echeance, expire: fin, declencheur: String(a.declencheur || '') });
  }
  return res.sort((x, y) => (x.debut || 0) - (y.debut || 0));
}

// La somme des compteurs du mois, tous postes ; un compteur illisible ne compte pas.
function sommeMois(moissons, m, mois) {
  const dossier = path.join(moissons, m, '_partage', 'requetes', mois);
  let somme = 0;
  for (const nom of lister(dossier).filter((n) => n.endsWith('.json'))) {
    const c = lireJson(path.join(dossier, nom));
    const n = c && typeof c === 'object' ? c.requetes : null;
    if (Number.isInteger(n) && n >= 0) { somme += n; }
  }
  return somme;
}

// Les dossiers de moissonneurs : ceux de _Moissons qui ne commencent pas par « _ ».
function dossiersMoissonneurs(moissons) {
  return lister(moissons).filter((n) => n.charAt(0) !== '_' && fs.statSync(path.join(moissons, n)).isDirectory()).sort();
}

function soclePresent(moissons, m) {
  return lister(path.join(moissons, m, '_partage')).some((n) => /^socle.*\.json$/.test(n));
}

// La dernière exécution d'un moissonneur, d'après son etat.json.
function derniereExecution(moissons, m) {
  const e = lireJson(path.join(moissons, m, 'etat.json'));
  if (!e || typeof e !== 'object' || e.format !== FORMAT_ETAT) { return null; }
  return { date: lireIso(e.derniere_moisson), lot: typeof e.lot === 'string' ? e.lot : '',
    propositions: Number.isInteger(e.propositions_ecrites) ? e.propositions_ecrites : 0 };
}

// La note de la dernière importation FNS (une par import, un seul écrivain).
function dernierImportFns(moissons) {
  const dossier = path.join(moissons, 'recherche', '_partage', 'imports-fns');
  let dernier = null;
  for (const nom of lister(dossier).filter((n) => n.endsWith('.json'))) {
    const n = lireJson(path.join(dossier, nom));
    if (!n || typeof n !== 'object' || n.format !== FORMAT_IMPORT_FNS) { continue; }
    // `heure` porte l'horodatage complet ; `date` (AAAA-MM-JJ) n'en est que le jour.
    const date = lireIso(n.heure) || lireIso(n.date) || lireJour(n.date);
    if (!date) { continue; }
    if (!dernier || date > dernier.date) {
      const f = n.fichier && typeof n.fichier === 'object' ? n.fichier : {};
      dernier = { date: date, poste: String(n.poste || ''), compte: String(n.compte || ''),
        fichierDate: lireIso(f.mtime), maxCallEnd: typeof f.max_call_end === 'string' ? f.max_call_end : '',
        nouvelles: Number.isInteger(n.nouvelles) ? n.nouvelles : null, lot: typeof n.lot === 'string' ? n.lot : '' };
    }
  }
  return dernier;
}

// Le bilan de la dernière vraie passe d'un moissonneur (`_partage/passes/<mois>/*.json`, pronto-passe/1),
// tous postes confondus ; une passe à blanc n'a rien déposé et ne compte pas.
function dernierePasse(moissons, m) {
  const racine = path.join(moissons, m, '_partage', 'passes');
  let dernier = null;
  for (const mois of lister(racine)) {
    for (const nom of lister(path.join(racine, mois)).filter((n) => n.endsWith('.json'))) {
      const b = lireJson(path.join(racine, mois, nom));
      if (!b || typeof b !== 'object' || b.format !== FORMAT_PASSE || b.a_blanc === true) { continue; }
      const fin = lireIso(b.fin) || lireIso(b.debut);
      if (!fin || (dernier && fin <= dernier.date)) { continue; }
      dernier = { date: fin, poste: String(b.poste || ''), compte: String(b.compte || ''), lot: typeof b.lot === 'string' ? b.lot : '',
        propositions: Number.isInteger(b.propositions) ? b.propositions : 0, code: b.code, horsLigne: b.hors_ligne === true };
    }
  }
  return dernier;
}

// La prochaine échéance d'import FNS, fin mai ou fin novembre, strictement après `depuis`.
function prochaineFns(depuis) {
  const a = depuis.getUTCFullYear();
  const finMai = Date.UTC(a, 4, 31, 23, 59, 59);
  const finNov = Date.UTC(a, 10, 30, 23, 59, 59);
  if (depuis.getTime() < finMai) { return { mois: 5, annee: a }; }
  if (depuis.getTime() < finNov) { return { mois: 11, annee: a }; }
  return { mois: 5, annee: a + 1 };
}

function plafond(budget, somme) { return Math.max(budget - MARGE_REQUETES - somme, 0); }
function epuise(budget, somme) { return Number.isInteger(budget) && somme >= budget - MARGE_REQUETES; }

// La ligne `estimation` d'un moissonneur, ramenée à { requetes, delai_s, budget }.
function lireEstimation(sortie) {
  let res = null;
  for (const ligne of String(sortie || '').split(/\r?\n/)) {
    let o;
    try { o = JSON.parse(ligne); } catch (e) { continue; }
    if (!o || o.type !== 'estimation') { continue; }
    const req = Number.isFinite(o.requetes) ? o.requetes : Number.isFinite(o.requetes_prevues) ? o.requetes_prevues : null;
    res = { requetes: req, delai_s: Number.isFinite(o.delai_s) ? o.delai_s : null,
      budget: Number.isInteger(o.budget) ? o.budget : null };
  }
  return res;
}

// La durée d'une passe, en secondes : l'attente du créneau, puis chaque requête au plus jusqu'au
// plafond du mois, à son délai de politesse. null si une estimation manque. Hors ligne, aucune requête.
function dureeEstimee(estimations, sommes, horsLigne) {
  let s = ATTENTE_CRENEAU_S;
  if (horsLigne) { return s; }
  for (const m of Object.keys(estimations)) {
    const e = estimations[m];
    if (!e || e.requetes === null || e.delai_s === null) { return null; }
    const n = e.budget === null ? e.requetes : Math.min(e.requetes, plafond(e.budget, sommes[m] || 0));
    s += n * e.delai_s;
  }
  return Math.ceil(s);
}

// ---- L'état d'une passe, nourri par ses événements --------------------------------------------

function nouvellePasse(genre) {
  return { genre: genre, phase: 'creneau', ordre: [], lignes: {}, courant: null, avertissements: [],
    creneauRefuse: null, refus: null, fin: null, racineTest: false };
}
function ligneDe(p, m) {
  if (!p.lignes[m]) {
    p.lignes[m] = { etape: '', requetes: 0, budget: null, fraction: 0, reste_s: null, attente: null, lot: null, fin: null };
    if (p.ordre.indexOf(m) === -1) { p.ordre.push(m); }
  }
  return p.lignes[m];
}

// Rend vrai si l'événement est reconnu. Les champs viennent du contrat ; rien n'est recalculé ici.
function appliquer(p, e) {
  if (!e || e.format !== FORMAT_EVENEMENT) { return false; }
  const m = typeof e.moissonneur === 'string' ? e.moissonneur : null;
  if (e.type === 'creneau') {
    if (e.etat === 'refuse') { p.creneauRefuse = { poste: e.poste, compte: e.compte, debut: lireIso(e.debut) }; }
  } else if (e.type === 'debut') {
    p.phase = 'en-cours';
    p.racineTest = e.racine_test === true;
    for (const x of e.moissonneurs || []) {
      const l = ligneDe(p, x);
      const bm = (e.budget_mois || {})[x];
      l.budget = bm && Number.isInteger(bm.plafond) ? bm.plafond : null;
    }
  } else if (e.type === 'etape' && m) {
    Object.assign(ligneDe(p, m), { etape: String(e.etape || ''), requetes: e.requetes, budget: e.budget,
      fraction: e.fraction, reste_s: e.reste_s, attente: null });
    p.courant = m;
  } else if (e.type === 'attente' && m) {
    ligneDe(p, m).attente = { etape: String(e.etape || ''), secondes: e.secondes, motif: e.motif || '' };
    p.courant = m;
  } else if (e.type === 'avertissement') {
    p.avertissements.push({ moissonneur: m, message: String(e.message || '') });
    if (p.avertissements.length > AVERTISSEMENTS_GARDES) { p.avertissements.shift(); }
  } else if (e.type === 'lot' && m) {
    ligneDe(p, m).lot = { chemin: String(e.chemin || ''), propositions: e.propositions };
  } else if (e.type === 'moissonneur_fin' && m) {
    const l = ligneDe(p, m);
    l.fin = { code: e.code, interrompu: e.interrompu, plantage: !!e.plantage,
      echecs: (e.sources_en_echec || []).map((s) => String(s.source)) };
    l.attente = null;
  } else if (e.type === 'fin') {
    p.fin = { code: e.code, duree_s: e.duree_s };
  } else if (e.type === 'refus') {
    p.refus = { raison: String(e.raison || ''), detail: String(e.detail || '') };
  } else { return false; }
  return true;
}

module.exports = {
  PERIME_S, ATTENTE_CRENEAU_S, MARGE_REQUETES, FORMAT_EVENEMENT, FORMAT_IMPORT_FNS,
  normaliser, clePoste, moisDe, annoncesVivantes, sommeMois, dossiersMoissonneurs, soclePresent, derniereExecution, dernierePasse, dernierImportFns,
  prochaineFns, plafond, epuise, lireEstimation, dureeEstimee, nouvellePasse, appliquer
};
