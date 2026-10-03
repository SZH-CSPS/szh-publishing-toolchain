// Propositions des moissonneurs : lecture des lots, cas A/B, décisions et acceptation.
// Le format est dans docs/FORMAT-PROPOSITIONS.md ; seul kirby-contenu.js écrit une fiche.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const kirby = require('./kirby-contenu');
const { ecrireAtomique } = require('./yaml');

const FORMAT = 'pronto-proposition/1';
const FORMAT_ETAT = 'pronto-etat/1';
const CODES_DOUTE = ['date-illisible', 'langue-devinee', 'correspondance-incertaine',
  'valeur-hors-liste', 'champ-introuvable', 'texte-tronque'];
const DECISIONS = ['accepte', 'refuse'];
const MOTIFS_REFUS = ['hors-sujet', 'doublon', 'autre'];
const DOSSIER_DECISIONS = '_Decisions';
const RE_LOT = /^(\d{4}-\d{2}-\d{2})-(\d+)\.jsonl$/;

// ---- Emplacements ------------------------------------------------------------------

function cheminMoissons(racineArbreVal) { return path.join(racineArbreVal, kirby.NOM_BIBLIOTHEQUE, '_Moissons'); }
function cheminDecisions(racineArbreVal) { return path.join(cheminMoissons(racineArbreVal), DOSSIER_DECISIONS); }
// Une cle contient des « : », interdits dans un nom de fichier Windows : d'où l'empreinte.
function empreinteCle(cle) {
  return crypto.createHash('sha256').update(String(cle), 'utf8').digest('hex').slice(0, 16);
}
function cheminDecision(racineArbreVal, cle) {
  return path.join(cheminDecisions(racineArbreVal), empreinteCle(cle) + '.txt');
}

// ---- Lots --------------------------------------------------------------------------

// Rang d'un lot d'après son nom : la date, puis le numéro du jour, comparé en nombre.
function comparerLots(a, b) {
  const ma = RE_LOT.exec(a), mb = RE_LOT.exec(b);
  if (ma[1] !== mb[1]) { return ma[1] < mb[1] ? -1 : 1; }
  return parseInt(ma[2], 10) - parseInt(mb[2], 10);
}

function dossiersMoissonneurs(racineArbreVal) {
  let entrees;
  try { entrees = fs.readdirSync(cheminMoissons(racineArbreVal), { withFileTypes: true }); }
  catch (e) { return []; }
  return entrees.filter((e) => e.isDirectory() && e.name.charAt(0) !== '_').map((e) => e.name).sort();
}

function lireEtat(dossier, moissonneur, avertissements) {
  let brut;
  try { brut = fs.readFileSync(path.join(dossier, 'etat.json'), 'utf8'); }
  catch (e) { return null; }
  try {
    const etat = JSON.parse(brut.replace(/^﻿/, ''));
    if (!etat || typeof etat !== 'object' || etat.format !== FORMAT_ETAT) {
      avertissements.push({ code: 'etat-format-inconnu', moissonneur: moissonneur });
      return null;
    }
    return etat;
  } catch (e) {
    avertissements.push({ code: 'etat-illisible', moissonneur: moissonneur });
    return null;
  }
}

// Une ligne de lot -> la proposition, ou le code de l'avertissement qui l'écarte.
function verifierLigne(texte) {
  let p;
  try { p = JSON.parse(texte); } catch (e) { return { code: 'ligne-illisible' }; }
  if (!p || typeof p !== 'object' || Array.isArray(p)) { return { code: 'ligne-illisible' }; }
  if (p.format !== FORMAT) { return { code: 'format-inconnu' }; }
  if (typeof p.cle !== 'string' || p.cle.trim() === '' || /[\r\n]/.test(p.cle)) { return { code: 'cle-absente' }; }
  if (!kirby.typeConnu(p.type)) { return { code: 'type-inconnu', cle: p.cle }; }
  if (kirby.languesDuContrat().indexOf(p.langue) === -1) { return { code: 'langue-inconnue', cle: p.cle }; }
  return { proposition: p };
}

// Les clés des décisions présentes, lues une fois pour toute la liste.
function clesDecidees(racineArbreVal) {
  let noms;
  try { noms = fs.readdirSync(cheminDecisions(racineArbreVal)); } catch (e) { return new Set(); }
  const res = new Set();
  for (const nom of noms) {
    if (!/^[0-9a-f]{16}\.txt$/.test(nom)) { continue; }
    const d = lireDecisionFichier(path.join(cheminDecisions(racineArbreVal), nom));
    if (d && empreinteCle(d.cle) + '.txt' === nom) { res.add(d.cle); }
  }
  return res;
}

// listerPropositions(racine, langue) -> { propositions, avertissements, etats }.
// Pour une même cle, la ligne du lot le plus récent l'emporte, et dans un lot la dernière.
function listerPropositions(racineArbreVal, langue) {
  const avertissements = [];
  const etats = {};
  const parCle = new Map();
  for (const moissonneur of dossiersMoissonneurs(racineArbreVal)) {
    const dossier = path.join(cheminMoissons(racineArbreVal), moissonneur);
    etats[moissonneur] = lireEtat(dossier, moissonneur, avertissements);
    let noms;
    try { noms = fs.readdirSync(dossier); } catch (e) { continue; }
    const lots = [];
    for (const nom of noms) {
      if (!/\.jsonl$/.test(nom)) { continue; }
      if (!RE_LOT.test(nom)) { avertissements.push({ code: 'lot-mal-nomme', moissonneur: moissonneur, lot: nom }); continue; }
      lots.push(nom);
    }
    lots.sort(comparerLots);
    for (const lot of lots) {
      let brut;
      try { brut = fs.readFileSync(path.join(dossier, lot), 'utf8'); }
      catch (e) { avertissements.push({ code: 'lot-illisible', moissonneur: moissonneur, lot: lot }); continue; }
      const lignes = brut.replace(/^﻿/, '').split(/\r?\n/);
      lignes.forEach((texte, i) => {
        if (texte.trim() === '') { return; }
        const r = verifierLigne(texte);
        if (!r.proposition) {
          const avert = { code: r.code, moissonneur: moissonneur, lot: lot, ligne: i + 1 };
          if (r.cle) { avert.cle = r.cle; }
          avertissements.push(avert);
          return;
        }
        parCle.set(r.proposition.cle, Object.assign({}, r.proposition, { lot: lot, dossier: moissonneur }));
      });
    }
  }
  const decidees = clesDecidees(racineArbreVal);
  const propositions = [];
  for (const p of parCle.values()) {
    if (decidees.has(p.cle) || p.langue !== langue) { continue; }
    propositions.push(p);
  }
  return { propositions: propositions, avertissements: avertissements, etats: etats };
}

// ---- Revalidation contre le contrat -------------------------------------------------

function estVide(v) {
  if (v === undefined || v === null) { return true; }
  if (Array.isArray(v)) { return v.length === 0; }
  return String(v).trim() === '';
}

// Le code d'écart d'une valeur non vide par rapport à la saisie de son champ, ou null.
function ecartValeur(champ, v) {
  if (estVide(v)) { return null; }
  switch (champ.saisie) {
    case 'date': return kirby.dateValide(v) ? null : 'date-hors-format';
    case 'date_partielle': return kirby.datePartielleValide(v) ? null : 'date-hors-format';
    case 'annee': return kirby.anneeValide(v) ? null : 'date-hors-format';
    case 'liste': {
      if (typeof v !== 'string') { return 'valeur-mal-formee'; }
      return jetonsDe(champ.liste).has(v) ? null : 'jeton-hors-liste';
    }
    case 'liste_multiple': {
      if (!Array.isArray(v)) { return 'valeur-mal-formee'; }
      const jetons = jetonsDe(champ.liste);
      return v.every((j) => jetons.has(j)) ? null : 'jeton-hors-liste';
    }
    case 'structure': {
      if (!Array.isArray(v)) { return 'valeur-mal-formee'; }
      for (const ligne of v) {
        if (!ligne || typeof ligne !== 'object') { return 'valeur-mal-formee'; }
        for (const sc of (champ.champs || [])) {
          const e = ecartValeur(sc, ligne[sc.cle]);
          if (e) { return e; }
        }
      }
      return null;
    }
    default: return null;
  }
}
function jetonsDe(nomListe) { return new Set(kirby.valeursListe(nomListe).map((x) => x.jeton)); }

// Les écarts de format de valeurs : [{ code, champ }], requis vides à part.
function ecartsFormat(type, valeurs) {
  const v = valeurs || {};
  const res = [];
  for (const c of kirby.champsDuType(type)) {
    if (c.saisie === 'derive') { continue; }
    const code = ecartValeur(c, v[c.cle]);
    if (code) { res.push({ code: code, champ: c.cle }); }
  }
  return res;
}

function doutesDe(p) { return Array.isArray(p && p.doutes) ? p.doutes.filter((d) => d && typeof d === 'object') : []; }

// classer(p) -> { cas: 'A'|'B', raisons: [{ code, champ }] }.
function classer(p) {
  if (!p || !kirby.typeConnu(p.type)) { return { cas: 'B', raisons: [{ code: 'type-inconnu', champ: null }] }; }
  const raisons = [];
  for (const d of doutesDe(p)) { raisons.push({ code: 'doute', champ: d.champ === undefined ? null : d.champ }); }
  for (const champ of kirby.champsManquants(p.type, p.valeurs || {})) { raisons.push({ code: 'requis-vide', champ: champ }); }
  raisons.push(...ecartsFormat(p.type, p.valeurs));
  if (p.doublon) { raisons.push({ code: 'doublon', champ: null }); }
  return { cas: raisons.length > 0 ? 'B' : 'A', raisons: raisons };
}

// bloquants(p, valeursSaisies, champsTouches) -> [{ code, champ }] : ce qui interdit
// l'acceptation. Un requis vide se laisse accepter ; un doute posé sur autre chose qu'un
// champ du type (la langue) n'a rien à toucher dans le formulaire et ne bloque pas.
function bloquants(p, valeursSaisies, champsTouches) {
  if (!p || !kirby.typeConnu(p.type)) { return [{ code: 'type-inconnu', champ: null }]; }
  const touches = new Set(champsTouches || []);
  const clesType = new Set(kirby.champsDuType(p.type).map((c) => c.cle));
  const res = [];
  const vus = new Set();
  for (const d of doutesDe(p)) {
    if (!clesType.has(d.champ) || touches.has(d.champ) || vus.has(d.champ)) { continue; }
    vus.add(d.champ);
    res.push({ code: 'doute-non-touche', champ: d.champ });
  }
  res.push(...ecartsFormat(p.type, valeursSaisies === undefined ? p.valeurs : valeursSaisies));
  return res;
}

// ---- Décisions ------------------------------------------------------------------------

function lireDecisionFichier(chemin) {
  let brut;
  try { brut = fs.readFileSync(chemin, 'utf8'); } catch (e) { return null; }
  const champs = kirby.lireTxt(brut).champs;
  const cle = String(champs.cle || '').trim();
  const decision = String(champs.decision || '').trim();
  if (!cle || DECISIONS.indexOf(decision) === -1) { return null; }
  return {
    cle: cle, decision: decision, motif: String(champs.motif || '').trim(),
    fiche: String(champs.fiche || '').trim(), date: String(champs.date || '').trim()
  };
}

// lireDecision(racine, cle) -> { cle, decision, motif, fiche, date } | null.
function lireDecision(racineArbreVal, cle) {
  const d = lireDecisionFichier(cheminDecision(racineArbreVal, cle));
  return d && d.cle === String(cle) ? d : null;
}

function texteDecision(d) {
  const parties = ['Cle: ' + d.cle, 'Decision: ' + d.decision];
  if (d.motif) { parties.push('Motif: ' + d.motif); }
  if (d.fiche) { parties.push('Fiche: ' + d.fiche); }
  parties.push('Date: ' + d.date);
  return parties.join('\n\n----\n\n') + '\n';
}

// ecrireDecision(racine, { cle, decision, motif?, fiche? }) -> { ok, decision, raison? }.
// Une décision présente n'est jamais écrasée : on l'annule d'abord.
function ecrireDecision(racineArbreVal, decision) {
  const d = decision || {};
  const cle = String(d.cle || '');
  const motif = String(d.motif || '');
  if (!cle.trim() || /[\r\n]/.test(cle) || DECISIONS.indexOf(d.decision) === -1) {
    return { ok: false, raison: 'decision-invalide' };
  }
  if (motif && (d.decision !== 'refuse' || MOTIFS_REFUS.indexOf(motif) === -1)) {
    return { ok: false, raison: 'motif-inconnu' };
  }
  const chemin = cheminDecision(racineArbreVal, cle);
  if (fs.existsSync(chemin)) {
    return { ok: false, raison: 'deja-decidee', decision: lireDecisionFichier(chemin) };
  }
  const ecrite = {
    cle: cle, decision: d.decision, motif: motif, fiche: String(d.fiche || ''),
    date: new Date().toISOString().slice(0, 10)
  };
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  ecrireAtomique(chemin, texteDecision(ecrite));
  return { ok: true, decision: ecrite };
}

function annulerDecision(racineArbreVal, cle) {
  try { fs.unlinkSync(cheminDecision(racineArbreVal, cle)); return { ok: true }; }
  catch (e) { return { ok: false }; }
}

// ---- Gestes ---------------------------------------------------------------------------

// accepter(racine, p, valeurs, { ausgabeId, proposerAutreRevue }) -> { ok, uuid, slug, raison? }.
// La décision est écrite avant la fiche, avec l'Uuid de celle-ci : une création qui
// échoue laisse une décision qui désigne une fiche introuvable, jamais deux fiches.
function accepter(racineArbreVal, p, valeurs, options) {
  const o = options || {};
  if (!p || !kirby.typeConnu(p.type)) { return { ok: false, raison: 'type-inconnu' }; }
  // Le formulaire grise déjà le geste ; ceci garde la fiche si un appel le contourne.
  const ecarts = ecartsFormat(p.type, valeurs);
  if (ecarts.length > 0) { return { ok: false, raison: 'valeurs-hors-format', ecarts: ecarts }; }
  const uuid = kirby.genererUuid();
  const ecrite = ecrireDecision(racineArbreVal, { cle: p.cle, decision: 'accepte', fiche: uuid });
  if (!ecrite.ok) { return ecrite; }
  const ausgabeId = o.ausgabeId || '';
  let cree;
  try { cree = kirby.creerFiche(racineArbreVal, p.langue, p.type, valeurs || {}, ausgabeId, null, null, uuid); }
  catch (e) { return { ok: false, raison: 'fiche-introuvable', uuid: uuid }; }
  if (ausgabeId) { kirby.reordonnerNumero(racineArbreVal, p.langue, ausgabeId); }
  if (o.proposerAutreRevue) {
    for (const autre of kirby.autresLangues(p.langue)) { kirby.ecrireStatutFiche(racineArbreVal, autre, uuid, 'a-traduire'); }
  }
  return { ok: true, uuid: uuid, slug: cree.slug };
}

// refuser(racine, p, motif?) -> { ok, decision, raison? }.
function refuser(racineArbreVal, p, motif) {
  return ecrireDecision(racineArbreVal, { cle: (p || {}).cle, decision: 'refuse', motif: motif || '' });
}

// La fiche d'un Uuid, toutes langues : [{ type, slug, langue, ausgabe }].
function fichesParUuid(racineArbreVal, uuid) {
  const res = [];
  for (const { type, slug } of kirby.listerSlugsBibliotheque(racineArbreVal)) {
    for (const langue of kirby.languesDuContrat()) {
      const f = kirby.lireFicheSlugLangue(racineArbreVal, slug, langue, type);
      if (f && f.uuid === uuid) { res.push({ type: type, slug: slug, langue: langue, ausgabe: f.ausgabe }); }
    }
  }
  return res;
}

// annulerAcceptation(racine, cle) -> { ok, ficheSupprimee, raison? } : la fiche créée, puis
// le statut de l'autre langue, puis la décision. La suppression vise (type, slug) : le
// même slug peut exister sous un autre type, que supprimerFicheLangue pourrait viser.
function annulerAcceptation(racineArbreVal, cle) {
  const d = lireDecision(racineArbreVal, cle);
  if (!d || d.decision !== 'accepte') { return { ok: false, raison: 'pas-acceptee' }; }
  const fiches = d.fiche ? fichesParUuid(racineArbreVal, d.fiche) : [];
  if (fiches.length > 1) { return { ok: false, raison: 'fiche-traduite' }; }
  const f = fiches[0];
  if (f) {
    const dossier = kirby.cheminFiche(racineArbreVal, f.type, f.slug);
    fs.unlinkSync(path.join(dossier, kirby.nomFichierContenu(f.type, f.langue)));
    let reste;
    try { reste = fs.readdirSync(dossier); } catch (e) { reste = []; }
    if (!reste.some((n) => /\.[a-z]{2}\.txt$/i.test(n))) { fs.rmSync(dossier, { recursive: true, force: true }); }
    if (f.ausgabe) { kirby.reordonnerNumero(racineArbreVal, f.langue, f.ausgabe); }
    for (const autre of kirby.autresLangues(f.langue)) {
      const statut = kirby.lireStatutFiche(racineArbreVal, autre, d.fiche);
      if (statut && statut.statut === 'a-traduire') { kirby.effacerStatutFiche(racineArbreVal, autre, d.fiche); }
    }
  }
  const annule = annulerDecision(racineArbreVal, cle);
  return { ok: annule.ok, ficheSupprimee: !!f };
}

module.exports = {
  FORMAT, FORMAT_ETAT, CODES_DOUTE, DECISIONS, MOTIFS_REFUS,
  cheminMoissons, cheminDecisions, cheminDecision, empreinteCle,
  listerPropositions, classer, bloquants,
  lireDecision, ecrireDecision, annulerDecision,
  accepter, refuser, annulerAcceptation
};
