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
  'valeur-hors-liste', 'champ-introuvable', 'texte-tronque', 'personne-nommee'];
// Ces doutes se signalent (cas B) sans bloquer l'acceptation : il n'y a rien à corriger d'office.
const DOUTES_SIGNAL = ['personne-nommee'];
const DECISIONS = ['accepte', 'refuse'];
const MOTIFS_REFUS = ['hors-sujet', 'doublon', 'autre'];
const DOSSIER_DECISIONS = '_Decisions';
const RE_LOT = /^(\d{4}-\d{2}-\d{2})-(\d+)\.jsonl$/;
// Finesse du tri : dix crans par moissonneur et par langue, réglés pour toute une rédaction.
const NB_CRANS = 10;
const DOSSIER_REGLAGES = '_Reglages';
const RE_ID_SUR = /^[A-Za-z0-9_-]{1,64}$/;

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
  if (p.langues !== undefined) {
    return languesValides(p) ? { proposition: p } : { code: 'langues-invalides', cle: p.cle };
  }
  if (kirby.languesDuContrat().indexOf(p.langue) === -1) { return { code: 'langue-inconnue', cle: p.cle }; }
  return { proposition: p };
}

// Une proposition multilingue : `langues` à la place de `langue`, jamais les deux ; chaque
// langue du contrat, une fois ; un titre officiel non vide pour chacune dans `titres`.
function languesValides(p) {
  if (p.langue !== undefined || !Array.isArray(p.langues) || p.langues.length === 0) { return false; }
  if (!p.titres || typeof p.titres !== 'object' || Array.isArray(p.titres)) { return false; }
  const contrat = kirby.languesDuContrat();
  return p.langues.every((l, i) => contrat.indexOf(l) !== -1 && p.langues.indexOf(l) === i
    && typeof p.titres[l] === 'string' && p.titres[l].trim() !== '');
}
function estMultilingue(p) { return !!p && Array.isArray(p.langues); }
// languesDe(p) -> les langues où la proposition se montre.
function languesDe(p) { return estMultilingue(p) ? p.langues.slice() : [p && p.langue]; }
// La proposition telle qu'une vue la voit : pour une ligne multilingue, le titre officiel de
// la langue de la vue devient `valeurs.title`, sa seule source.
function projeter(p, langue) {
  if (!estMultilingue(p)) { return p; }
  return Object.assign({}, p, { valeurs: Object.assign({}, p.valeurs || {}, { title: p.titres[langue] }) });
}

// Les décisions présentes, lues une fois pour toute la liste : cle -> décision.
function decisionsParCle(racineArbreVal) {
  let noms;
  try { noms = fs.readdirSync(cheminDecisions(racineArbreVal)); } catch (e) { return new Map(); }
  const res = new Map();
  for (const nom of noms) {
    if (!/^[0-9a-f]{16}\.txt$/.test(nom)) { continue; }
    const d = lireDecisionFichier(path.join(cheminDecisions(racineArbreVal), nom));
    if (d && empreinteCle(d.cle) + '.txt' === nom) { res.set(d.cle, d); }
  }
  return res;
}
function clesDecidees(racineArbreVal) { return new Set(decisionsParCle(racineArbreVal).keys()); }

// listerPropositions(racine, langue) -> { propositions, avertissements, etats }.
// Pour une même cle, la ligne du lot le plus récent l'emporte, et dans un lot la dernière.
function listerPropositions(racineArbreVal, langue) {
  const lu = lireLots(racineArbreVal);
  const decidees = clesDecidees(racineArbreVal);
  const propositions = [];
  for (const p of lu.parCle.values()) {
    if (decidees.has(p.cle) || languesDe(p).indexOf(langue) === -1) { continue; }
    propositions.push(projeter(p, langue));
  }
  return { propositions: propositions, avertissements: lu.avertissements, etats: lu.etats };
}

// listerRefusees(racine, langue) -> les propositions refusées de cette langue, chacune avec
// son `motif`, pour revenir sur un refus.
function listerRefusees(racineArbreVal, langue) {
  const decisions = decisionsParCle(racineArbreVal);
  const res = [];
  for (const p of lireLots(racineArbreVal).parCle.values()) {
    const d = decisions.get(p.cle);
    if (!d || d.decision !== 'refuse' || languesDe(p).indexOf(langue) === -1) { continue; }
    res.push(Object.assign({}, projeter(p, langue), { motif: d.motif }));
  }
  return res;
}

function lireLots(racineArbreVal) {
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
  return { parCle: parCle, avertissements: avertissements, etats: etats };
}

// ---- Compte de l'arbre --------------------------------------------------------------

// L'empreinte de ce que le compte lit : les dossiers (un lot ou une décision ajoutés les
// changent) et chaque lot. Un stat ne télécharge pas un fichier « en ligne seulement »,
// une lecture si : c'est tout l'intérêt de ce cache sur OneDrive.
function empreinteMoissons(racineArbreVal) {
  const base = cheminMoissons(racineArbreVal);
  const parts = [];
  const noter = (chemin, extra) => {
    try { const s = fs.statSync(chemin); parts.push(chemin + '|' + s.mtimeMs + '|' + s.size + '|' + (extra || '')); }
    catch (e) { parts.push(chemin + '|absent'); }
  };
  let decisions = [];
  try { decisions = fs.readdirSync(path.join(base, DOSSIER_DECISIONS)); } catch (e) { /* aucune décision */ }
  noter(base);
  noter(path.join(base, DOSSIER_DECISIONS), String(decisions.length));
  for (const l of kirby.languesDuContrat()) { noter(cheminReglages(racineArbreVal, l)); }
  for (const m of dossiersMoissonneurs(racineArbreVal)) {
    const dossier = path.join(base, m);
    noter(dossier);
    noter(path.join(dossier, 'etat.json'));
    let noms = [];
    try { noms = fs.readdirSync(dossier); } catch (e) { /* dossier disparu entre-temps */ }
    for (const nom of noms.filter((n) => /\.jsonl$/.test(n)).sort()) { noter(path.join(dossier, nom)); }
  }
  return parts.join('\n');
}

const cacheComptes = new Map();

// compterPropositions(racine, langue) -> { total, aVerifier } : les propositions en attente
// dans cette langue, visibles au réglage partagé (sinon au cran par défaut), dont les cas B.
function compterPropositions(racineArbreVal, langue) {
  const c = compterVisibles(racineArbreVal, langue);
  return { total: c.total, aVerifier: c.aVerifier };
}

// compterVisibles(racine, langue, apercu?) -> { total, aVerifier, masquees } : les
// propositions en attente et visibles dans cette langue, dont les cas B, et celles que la
// finesse masque. `apercu` ({ type: cran }) est le cran que le poste regarde ; sans lui, le
// réglage partagé, sinon le cran par défaut. Rien n'est relu tant que l'empreinte, l'aperçu et le contrat n'ont pas changé.
function compterVisibles(racineArbreVal, langue, apercu) {
  const cle = racineArbreVal + '|' + langue + '|' + JSON.stringify(apercu || {});
  const empreinte = empreinteMoissons(racineArbreVal);
  const contratCourant = kirby.contrat();
  const connu = cacheComptes.get(cle);
  if (connu && connu.empreinte === empreinte && connu.contrat === contratCourant) {
    return { total: connu.total, aVerifier: connu.aVerifier, masquees: connu.masquees };
  }
  const lu = listerPropositions(racineArbreVal, langue);
  const vue = finessePourVue(racineArbreVal, langue, lu.etats, apercu);
  const visibles = lu.propositions.filter((p) => vue.visible(p));
  const aVerifier = visibles.filter((p) => classer(p).cas === 'B').length;
  const res = { total: visibles.length, aVerifier: aVerifier, masquees: lu.propositions.length - visibles.length };
  cacheComptes.set(cle, Object.assign({ empreinte: empreinte, contrat: contratCourant }, res));
  return res;
}

// ---- Ordre de la vue ------------------------------------------------------------------

// ordonner(propositions, langue) -> les mêmes, chacune avec `cas` et `raisons` : les cas B
// en tête, puis l'ordre `tri` du contrat, celui des fiches imprimées.
function ordonner(propositions, langue) {
  const classees = propositions.map((p) => Object.assign({}, p, classer(p)));
  const b = kirby.calculerOrdreFiches(classees.filter((p) => p.cas === 'B'), langue);
  const a = kirby.calculerOrdreFiches(classees.filter((p) => p.cas === 'A'), langue);
  return b.concat(a);
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
    if (DOUTES_SIGNAL.indexOf(d.code) !== -1) { continue; }
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
  const d = {
    cle: cle, decision: decision, motif: String(champs.motif || '').trim(),
    fiche: String(champs.fiche || '').trim(), date: String(champs.date || '').trim()
  };
  // Les titres officiels d'une proposition multilingue : un objet JSON sur une ligne.
  const titres = lireTitres(champs.titres);
  if (titres) { d.titres = titres; }
  return d;
}
function lireTitres(brut) {
  if (brut === undefined || String(brut).trim() === '') { return null; }
  let t;
  try { t = JSON.parse(String(brut)); } catch (e) { return null; }
  if (!t || typeof t !== 'object' || Array.isArray(t)) { return null; }
  const res = {};
  for (const l of Object.keys(t)) { if (typeof t[l] === 'string') { res[l] = t[l]; } }
  return Object.keys(res).length > 0 ? res : null;
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
  if (d.titres) { parties.push('Titres: ' + JSON.stringify(d.titres)); }
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
  if (d.titres && typeof d.titres === 'object') { ecrite.titres = d.titres; }
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
// `langue` (options) est la langue de la vue, celle du numéro ouvert : la fiche y nait. Une
// proposition multilingue doit la porter ; une monolingue garde sa propre langue.
function accepter(racineArbreVal, p, valeurs, options) {
  const o = options || {};
  if (!p || !kirby.typeConnu(p.type)) { return { ok: false, raison: 'type-inconnu' }; }
  const langue = langueVue(p, o.langue);
  if (!langue) { return { ok: false, raison: 'langue-absente' }; }
  // Le formulaire grise déjà le geste ; ceci garde la fiche si un appel le contourne.
  const ecarts = ecartsFormat(p.type, valeurs);
  if (ecarts.length > 0) { return { ok: false, raison: 'valeurs-hors-format', ecarts: ecarts }; }
  const uuid = kirby.genererUuid();
  const decision = { cle: p.cle, decision: 'accepte', fiche: uuid };
  if (estMultilingue(p)) { decision.titres = p.titres; }
  const ecrite = ecrireDecision(racineArbreVal, decision);
  if (!ecrite.ok) { return ecrite; }
  const ausgabeId = o.ausgabeId || '';
  let cree;
  try { cree = kirby.creerFiche(racineArbreVal, langue, p.type, valeurs || {}, ausgabeId, null, null, uuid); }
  catch (e) { return { ok: false, raison: 'fiche-introuvable', uuid: uuid }; }
  if (ausgabeId) { kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId); }
  if (o.proposerAutreRevue) { proposerAutreRevue(racineArbreVal, p, langue, cree.slug, uuid, valeurs || {}); }
  return { ok: true, uuid: uuid, slug: cree.slug };
}

// La langue où la fiche nait : celle de la vue, si la proposition la porte ; sans vue, la
// langue d'une proposition monolingue.
function langueVue(p, langue) {
  if (!langue) { return estMultilingue(p) ? '' : p.langue; }
  return languesDe(p).indexOf(langue) !== -1 ? langue : '';
}

// Un champ `traduire` autre que le titre, rempli : sa traduction ne se devine pas. Pour une
// structure, un sous-champ `traduire` rempli sur une ligne suffit.
function resteATraduire(type, valeurs) {
  return kirby.champsDuType(type).some((c) => {
    if (c.cle === 'title') { return false; }
    if (c.traduire) { return !estVide(valeurs[c.cle]); }
    if (c.saisie !== 'structure' || !Array.isArray(valeurs[c.cle])) { return false; }
    const sous = (c.champs || []).filter((sc) => sc.traduire).map((sc) => sc.cle);
    return valeurs[c.cle].some((l) => l && sous.some((k) => !estVide(l[k])));
  });
}

// La coche « + autre revue ». Pour une proposition multilingue dont seul le titre se traduit,
// le fichier de l'autre langue nait aussitôt, orphelin, avec son titre officiel et les champs
// communs ; sinon, l'autre langue reçoit le statut « à traduire » (jamais les deux : un statut
// posé à côté d'un fichier existant serait ignoré).
function proposerAutreRevue(racineArbreVal, p, langue, slug, uuid, valeurs) {
  for (const autre of kirby.autresLangues(langue)) {
    const titre = estMultilingue(p) && languesDe(p).indexOf(autre) !== -1 ? p.titres[autre] : '';
    if (titre && !resteATraduire(p.type, valeurs)) {
      const t = kirby.traduireDansNumero(racineArbreVal, slug, autre, '');
      if (t.ok) {
        kirby.enregistrerFicheLangue(racineArbreVal, slug, autre, p.type, Object.assign({}, valeurs, { title: titre }));
        continue;
      }
    }
    kirby.ecrireStatutFiche(racineArbreVal, autre, uuid, 'a-traduire');
  }
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
// Pour une proposition multilingue (sa décision garde ses titres), `langue` désigne la vue :
// son fichier part toujours, celui de l'autre langue seulement s'il n'est dans aucun numéro ;
// sinon il reste et `autreGardee` le dit.
function annulerAcceptation(racineArbreVal, cle, langue) {
  const d = lireDecision(racineArbreVal, cle);
  if (!d || d.decision !== 'accepte') { return { ok: false, raison: 'pas-acceptee' }; }
  const fiches = d.fiche ? fichesParUuid(racineArbreVal, d.fiche) : [];
  let aRetirer = fiches;
  let autreGardee = false;
  if (fiches.length > 1) {
    if (!d.titres) { return { ok: false, raison: 'fiche-traduite' }; }
    const vue = fiches.filter((f) => f.langue === langue);
    const autres = fiches.filter((f) => f.langue !== langue);
    if (vue.length === 0) { return { ok: false, raison: 'fiche-traduite' }; }
    autreGardee = autres.some((f) => !!f.ausgabe);
    aRetirer = autreGardee ? vue : fiches;
  }
  for (const f of aRetirer) {
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
  const res = { ok: annule.ok, ficheSupprimee: aRetirer.length > 0 };
  if (autreGardee) { res.autreGardee = true; }
  return res;
}

// ---- Gestes de la vue, en lot -----------------------------------------------------------

function enAttenteParCle(racineArbreVal, langue) {
  return new Map(listerPropositions(racineArbreVal, langue).propositions.map((p) => [p.cle, p]));
}

// Les valeurs saisies dans le détail, réduites aux clés du contrat, par-dessus la proposition.
function valeursSaisies(p, saisies) {
  const res = Object.assign({}, p.valeurs || {});
  for (const c of kirby.champsDuType(p.type)) {
    if (c.saisie === 'fichier' || !Object.prototype.hasOwnProperty.call(saisies, c.cle)) { continue; }
    res[c.cle] = saisies[c.cle];
  }
  return res;
}

// accepterLot(racine, langue, [{ cle, aussi, valeurs?, touches? }], { ausgabeId, depuisDetail })
//   -> { faites: [cle], ignorees: [{ cle, raison }], echecs: [{ cle, raison }] }.
// En lot, une proposition s'accepte telle quelle, et un cas B jamais. Depuis son détail, seule,
// elle s'accepte avec les valeurs saisies si bloquants() ne trouve rien, compte tenu des champs
// touchés. `aussi` vaut pour sa seule proposition.
function accepterLot(racineArbreVal, langue, demandes, options) {
  const o = options || {};
  const attente = enAttenteParCle(racineArbreVal, langue);
  const liste = Array.isArray(demandes) ? demandes : [];
  const res = { faites: [], ignorees: [], echecs: [] };
  for (const d of liste) {
    const p = attente.get(String((d && d.cle) || ''));
    if (!p) { res.ignorees.push({ cle: String((d && d.cle) || ''), raison: 'deja-decidee' }); continue; }
    const seulDepuisDetail = !!o.depuisDetail && liste.length === 1;
    const saisies = seulDepuisDetail && d.valeurs && typeof d.valeurs === 'object' && !Array.isArray(d.valeurs)
      ? valeursSaisies(p, d.valeurs) : null;
    const touches = Array.isArray(d.touches) ? d.touches.map(String) : [];
    const bloque = saisies ? bloquants(p, saisies, touches).length > 0
      : classer(p).cas === 'B' && !(seulDepuisDetail && bloquants(p).length === 0);
    if (bloque) {
      res.ignorees.push({ cle: p.cle, raison: 'a-verifier' });
      continue;
    }
    const r = accepter(racineArbreVal, p, saisies || p.valeurs, { ausgabeId: o.ausgabeId || '', proposerAutreRevue: !!d.aussi, langue: langue });
    if (r.ok) { res.faites.push(p.cle); } else { res.echecs.push({ cle: p.cle, raison: r.raison }); }
  }
  return res;
}

// refuserLot(racine, langue, [cle], motif?) -> { faites, ignorees, echecs }.
function refuserLot(racineArbreVal, langue, cles, motif) {
  const attente = enAttenteParCle(racineArbreVal, langue);
  const res = { faites: [], ignorees: [], echecs: [] };
  for (const cle of (Array.isArray(cles) ? cles : [])) {
    const p = attente.get(String(cle));
    if (!p) { res.ignorees.push({ cle: String(cle), raison: 'deja-decidee' }); continue; }
    const r = refuser(racineArbreVal, p, motif);
    if (r.ok) { res.faites.push(p.cle); } else { res.echecs.push({ cle: p.cle, raison: r.raison }); }
  }
  return res;
}

// annulerLot(racine, [cle], langue?) -> { faites, echecs, fichesSupprimees, autresGardees } :
// `langue` est celle de la vue (voir annulerAcceptation). Chaque décision se
// défait selon sa nature, une acceptation avec la fiche qu'elle a créée.
function annulerLot(racineArbreVal, cles, langue) {
  const res = { faites: [], echecs: [], fichesSupprimees: 0, autresGardees: 0 };
  for (const cle of (Array.isArray(cles) ? cles : [])) {
    const d = lireDecision(racineArbreVal, cle);
    if (!d) { res.echecs.push({ cle: String(cle), raison: 'pas-decidee' }); continue; }
    const r = d.decision === 'accepte' ? annulerAcceptation(racineArbreVal, cle, langue) : annulerDecision(racineArbreVal, cle);
    if (!r.ok) { res.echecs.push({ cle: d.cle, raison: r.raison || 'echec' }); continue; }
    res.faites.push(d.cle);
    if (r.ficheSupprimee) { res.fichesSupprimees++; }
    if (r.autreGardee) { res.autresGardees++; }
  }
  return res;
}

// ficheDoublon(racine, p) -> { valeurs, ausgabe, langue } | null : la fiche que désigne un
// doublon probable, dans la langue de la proposition d'abord.
function ficheDoublon(racineArbreVal, p) {
  const d = p && p.doublon;
  if (!d || !d.slug || !d.uuid || !kirby.typeConnu(p.type)) { return null; }
  const premieres = languesDe(p).filter(Boolean);
  const langues = premieres.concat(kirby.languesDuContrat().filter((l) => premieres.indexOf(l) === -1));
  for (const langue of langues) {
    const f = kirby.lireFicheSlugLangue(racineArbreVal, String(d.slug), langue, p.type);
    if (f && f.uuid === d.uuid) { return { valeurs: f.valeurs, ausgabe: f.ausgabe || '', langue: langue }; }
  }
  return null;
}

// titresOfficielsDeFiche(racine, uuid) -> { fr, de, it? } | null : les titres officiels que garde
// la décision d'une proposition multilingue acceptée, retrouvée par l'Uuid de sa fiche.
function titresOfficielsDeFiche(racineArbreVal, uuid) {
  if (!uuid) { return null; }
  for (const d of decisionsParCle(racineArbreVal).values()) {
    if (d.decision === 'accepte' && d.fiche === uuid && d.titres) { return d.titres; }
  }
  return null;
}

// ---- Fiche introuvable ------------------------------------------------------------------

// lireProposition(racine, cle) -> la proposition de cette cle, décidée ou non, ou null : celle
// dont l'acceptation vient d'échouer n'est plus en attente.
function lireProposition(racineArbreVal, cle) {
  return lireLots(racineArbreVal).parCle.get(String(cle)) || null;
}

// recreerFiche(racine, cle, p, valeurs, { ausgabeId, proposerAutreRevue }) -> { ok, uuid, slug, raison? }.
// La fiche d'une acceptation dont la création vient d'échouer (raison fiche-introuvable),
// avec l'Uuid que porte la décision : jamais une seconde fiche.
function recreerFiche(racineArbreVal, cle, p, valeurs, options) {
  const o = options || {};
  const d = lireDecision(racineArbreVal, cle);
  if (!d || d.decision !== 'accepte' || !d.fiche) { return { ok: false, raison: 'pas-acceptee' }; }
  if (!p || p.cle !== d.cle || !kirby.typeConnu(p.type)) { return { ok: false, raison: 'type-inconnu' }; }
  const langue = langueVue(p, o.langue);
  if (!langue) { return { ok: false, raison: 'langue-absente' }; }
  if (fichesParUuid(racineArbreVal, d.fiche).length > 0) { return { ok: false, raison: 'fiche-presente' }; }
  const v = valeursSaisies(projeter(p, langue), valeurs && typeof valeurs === 'object' ? valeurs : {});
  const ecarts = ecartsFormat(p.type, v);
  if (ecarts.length > 0) { return { ok: false, raison: 'valeurs-hors-format', ecarts: ecarts }; }
  const ausgabeId = o.ausgabeId || '';
  const cree = kirby.creerFiche(racineArbreVal, langue, p.type, v, ausgabeId, null, null, d.fiche);
  if (ausgabeId) { kirby.reordonnerNumero(racineArbreVal, langue, ausgabeId); }
  if (o.proposerAutreRevue) { proposerAutreRevue(racineArbreVal, p, langue, cree.slug, d.fiche, v); }
  return { ok: true, uuid: d.fiche, slug: cree.slug };
}

// ---- Finesse du tri -----------------------------------------------------------------------
//
// Chaque proposition porte un score (pertinence.score) ; chaque moissonneur écrit dans
// etat.json dix seuils par langue (crans). Au cran k, une proposition est visible si son score
// atteint le seuil k. Sans score ou sans crans, elle est visible partout.

function scoreDe(p) {
  const s = p && p.pertinence ? p.pertinence.score : undefined;
  return typeof s === 'number' && isFinite(s) ? s : null;
}

// cransDe(etat, langue) -> les dix crans de la langue, rangés, ou null s'ils manquent ou sont mal formés.
function cransDe(etat, langue) {
  const l = etat && etat.crans && typeof etat.crans === 'object' ? etat.crans[langue] : null;
  if (!Array.isArray(l) || l.length !== NB_CRANS) { return null; }
  if (l.some((c) => !c || typeof c !== 'object')) { return null; }
  const tri = l.slice().sort((a, b) => Number(a.cran) - Number(b.cran));
  for (let i = 0; i < NB_CRANS; i++) {
    if (tri[i].cran !== i + 1 || typeof tri[i].seuil !== 'number' || !isFinite(tri[i].seuil)) { return null; }
  }
  return tri;
}

// cranMax(p, crans) -> 1..10 : le cran le plus haut où la proposition reste visible. Les crans
// sont emboîtés : on monte tant que le score atteint le seuil.
function cranMax(p, crans) {
  const s = scoreDe(p);
  if (!crans || s === null) { return NB_CRANS; }
  let k = 1;
  for (let i = 1; i < crans.length; i++) {
    if (s < crans[i].seuil) { break; }
    k = crans[i].cran;
  }
  return k;
}

function moissonneurDe(p) { return String(p.dossier || p.moissonneur || ''); }

function cheminReglages(racineArbreVal, langue) {
  return path.join(cheminMoissons(racineArbreVal), DOSSIER_REGLAGES, langue + '.json');
}
function cranValide(c) { return Number.isInteger(c) && c >= 1 && c <= NB_CRANS; }
function moissonneurValide(m) { return typeof m === 'string' && RE_ID_SUR.test(m) && m.charAt(0) !== '_'; }

// lireReglages(racine, langue) -> { moissonneur: { type: { cran, par, le } } }. Un fichier
// illisible vaut « pas de réglage » ; une entrée mal formée est ignorée.
function lireReglages(racineArbreVal, langue) {
  let brut;
  try { brut = JSON.parse(fs.readFileSync(cheminReglages(racineArbreVal, langue), 'utf8').replace(/^﻿/, '')); }
  catch (e) { return {}; }
  const res = {};
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) { return res; }
  for (const m of Object.keys(brut)) {
    const parType = brut[m];
    if (!moissonneurValide(m) || !parType || typeof parType !== 'object') { continue; }
    for (const t of Object.keys(parType)) {
      const r = parType[t];
      if (!r || typeof r !== 'object' || !cranValide(r.cran)) { continue; }
      res[m] = res[m] || {};
      res[m][t] = { cran: r.cran, par: String(r.par || ''), le: String(r.le || '') };
    }
  }
  return res;
}

function ecrireTableReglages(racineArbreVal, langue, table) {
  const chemin = cheminReglages(racineArbreVal, langue);
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  ecrireAtomique(chemin, JSON.stringify(table, null, 2) + '\n');
}

// ecrireReglage(racine, langue, moissonneur, type, cran, par) -> { ok, reglage, raison? } : le
// réglage partagé de la rédaction de cette langue, écrit d'un coup.
function ecrireReglage(racineArbreVal, langue, moissonneur, type, cran, par) {
  if (kirby.languesDuContrat().indexOf(langue) === -1 || !moissonneurValide(moissonneur)
    || !kirby.typeConnu(type) || !cranValide(cran)) {
    return { ok: false, raison: 'reglage-invalide' };
  }
  const table = lireReglages(racineArbreVal, langue);
  const reglage = { cran: cran, par: String(par || '—'), le: new Date().toISOString().slice(0, 10) };
  table[moissonneur] = Object.assign({}, table[moissonneur] || {}, { [type]: reglage });
  ecrireTableReglages(racineArbreVal, langue, table);
  return { ok: true, reglage: reglage };
}

// retablirReglage(racine, langue, moissonneur, type, ancien|null) : remet le réglage d'avant
// tel quel, ou le retire.
function retablirReglage(racineArbreVal, langue, moissonneur, type, ancien) {
  if (kirby.languesDuContrat().indexOf(langue) === -1 || !moissonneurValide(moissonneur)) { return { ok: false }; }
  const table = lireReglages(racineArbreVal, langue);
  if (ancien && cranValide(ancien.cran)) {
    table[moissonneur] = Object.assign({}, table[moissonneur] || {},
      { [type]: { cran: ancien.cran, par: String(ancien.par || ''), le: String(ancien.le || '') } });
  } else if (table[moissonneur]) {
    delete table[moissonneur][type];
    if (Object.keys(table[moissonneur]).length === 0) { delete table[moissonneur]; }
  }
  ecrireTableReglages(racineArbreVal, langue, table);
  return { ok: true };
}

// cranDefautDe(etat) -> 1..10 : le cran du moissonneur faute de réglage partagé (cran_defaut),
// 1 s'il manque ou est invalide.
function cranDefautDe(etat) {
  const c = etat && typeof etat === 'object' ? etat.cran_defaut : undefined;
  return cranValide(c) ? c : 1;
}

// finessePourVue(racine, langue, etats, apercu?) -> { crans, reglages, defauts, cranVu(p), visible(p) }.
// Le cran regardé : l'aperçu du poste pour ce type, sinon le réglage partagé, sinon le cran par
// défaut du moissonneur.
function finessePourVue(racineArbreVal, langue, etats, apercu) {
  const crans = {};
  const defauts = {};
  for (const m of Object.keys(etats || {})) {
    crans[m] = cransDe(etats[m], langue);
    defauts[m] = cranDefautDe(etats[m]);
  }
  const reglages = lireReglages(racineArbreVal, langue);
  const ap = apercu && typeof apercu === 'object' ? apercu : {};
  const cranVu = (p) => {
    if (cranValide(ap[p.type])) { return ap[p.type]; }
    const r = (reglages[moissonneurDe(p)] || {})[p.type];
    return r ? r.cran : (defauts[moissonneurDe(p)] || 1);
  };
  return {
    crans: crans, reglages: reglages, defauts: defauts, cranVu: cranVu,
    visible: (p) => cranMax(p, crans[moissonneurDe(p)] || null) >= cranVu(p)
  };
}

// comptesCrans(racine, langue) -> { type: { aCrans, parCran: [{ cran, visibles, masquees }] } } :
// pour chaque type en attente, ce que montrerait chacun des dix crans.
function comptesCrans(racineArbreVal, langue) {
  const lu = listerPropositions(racineArbreVal, langue);
  const crans = {};
  for (const m of Object.keys(lu.etats)) { crans[m] = cransDe(lu.etats[m], langue); }
  const res = {};
  for (const p of lu.propositions) {
    const c = crans[moissonneurDe(p)] || null;
    const t = res[p.type] = res[p.type] || { aCrans: false, maxima: [] };
    if (c) { t.aCrans = true; }
    t.maxima.push(cranMax(p, c));
  }
  for (const type of Object.keys(res)) {
    const maxima = res[type].maxima;
    res[type] = {
      aCrans: res[type].aCrans,
      parCran: Array.from({ length: NB_CRANS }, (x, i) => {
        const v = maxima.filter((k) => k >= i + 1).length;
        return { cran: i + 1, visibles: v, masquees: maxima.length - v };
      })
    };
  }
  return res;
}

// resumeMoissonneurs(racine) -> { moissonneur: { etat, types: [type], categories: [jeton] } } :
// chaque dossier de _Moissons, son état, et ce que ses lots portent, décidés ou non. Pour les
// Réglages de l'Accueil, qui n'ont pas de langue de numéro.
function resumeMoissonneurs(racineArbreVal) {
  const lu = lireLots(racineArbreVal);
  const res = {};
  for (const m of Object.keys(lu.etats)) { res[m] = { etat: lu.etats[m], types: [], categories: [] }; }
  for (const p of lu.parCle.values()) {
    const r = res[moissonneurDe(p)];
    if (!r) { continue; }
    if (r.types.indexOf(p.type) === -1) { r.types.push(p.type); }
    const c = p.pertinence && typeof p.pertinence.categorie === 'string' ? p.pertinence.categorie : '';
    if (c && r.categories.indexOf(c) === -1) { r.categories.push(c); }
  }
  for (const m of Object.keys(res)) { res[m].types.sort(); }
  return res;
}

// lireAuteurDemande(racine, moissonneur, id) -> { par, le, confirme_par, confirme_le } | null :
// l'auteur d'une demande, que le moissonneur ne garde pas, relu dans son fichier.
function lireAuteurDemande(racineArbreVal, moissonneur, id) {
  if (!moissonneurValide(moissonneur) || typeof id !== 'string' || !RE_ID_SUR.test(id)) { return null; }
  let d;
  try { d = JSON.parse(fs.readFileSync(path.join(cheminMoissons(racineArbreVal), moissonneur, 'demandes', id + '.json'), 'utf8').replace(/^﻿/, '')); }
  catch (e) { return null; }
  if (!d || typeof d !== 'object' || d.id !== id) { return null; }
  const s = (v) => String(v === undefined || v === null ? '' : v);
  return { par: s(d.par), le: s(d.le), confirme_par: s(d.confirme_par), confirme_le: s(d.confirme_le) };
}

// ---- Termes : ce que chaque terme ramène, au cran que la vue regarde ----------------------

function termesDe(p) {
  const t = p && p.pertinence && Array.isArray(p.pertinence.termes) ? p.pertinence.termes : [];
  return t.filter((x) => x && typeof x.terme === 'string' && x.terme.trim() !== '');
}
function nombreOuNul(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function cleTerme(x) { return [x.terme, x.langue || '', x.role || ''].join('|'); }

// Les fiches de référence de chaque terme (etat.termes), ou null si le moissonneur n'en écrit pas.
function refsDe(etat) {
  if (!etat || !Array.isArray(etat.termes)) { return null; }
  const res = new Map();
  for (const t of etat.termes) {
    if (!t || typeof t.terme !== 'string') { continue; }
    res.set(cleTerme(t), { ref: nombreOuNul(t.ref), refSeul: nombreOuNul(t.ref_seul) });
  }
  return res;
}

// comptesTermes(racine, langue, apercu?, lu?) -> { moissonneur: { types: { type: cran }, visibles,
// total, rappelSur, approx, termes: [{ terme, langue, role, ramene, seul, approx, ref, refSeul }] } }.
// Chaque proposition est jugée au cran regardé pour son type, sur les crans de son moissonneur.
// « seul » : visible, et ne le serait plus avec note_sans. Sans note_sans, seule une proposition
// à un terme compte, et la ligne porte approx. Un moissonneur sans crans ou sans termes n'y est pas.
function comptesTermes(racineArbreVal, langue, apercu, lu) {
  const l = lu || listerPropositions(racineArbreVal, langue);
  const vue = finessePourVue(racineArbreVal, langue, l.etats, apercu);
  const parM = {};
  for (const p of l.propositions) {
    const m = moissonneurDe(p);
    const crans = vue.crans[m];
    if (!crans) { continue; }
    if (!parM[m]) {
      const e = l.etats[m] || {};
      parM[m] = { types: {}, visibles: 0, total: 0, approx: false, avecTermes: false, refs: refsDe(e), lignes: new Map(),
        rappelSur: nombreOuNul(e.rappel_sur) !== null ? e.rappel_sur : nombreOuNul(crans[0].rappel_sur) };
    }
    const r = parM[m];
    const k = vue.cranVu(p);
    const visible = cranMax(p, crans) >= k;
    const ts = termesDe(p);
    r.types[p.type] = k;
    r.total += 1;
    if (visible) { r.visibles += 1; }
    if (ts.length > 0) { r.avecTermes = true; }
    for (const x of ts) {
      const cle = cleTerme(x);
      let t = r.lignes.get(cle);
      if (!t) {
        const ref = r.refs ? (r.refs.get(cle) || { ref: null, refSeul: null }) : { ref: null, refSeul: null };
        t = { terme: x.terme, langue: String(x.langue || ''), role: String(x.role || ''), ramene: 0, seul: 0, approx: false,
          ref: ref.ref, refSeul: ref.refSeul };
        r.lignes.set(cle, t);
      }
      if (!visible) { continue; }
      t.ramene += 1;
      const sans = nombreOuNul(x.note_sans);
      if (sans !== null) {
        if (cranMax({ pertinence: { score: sans } }, crans) < k) { t.seul += 1; }
      } else {
        t.approx = true;
        r.approx = true;
        if (ts.length === 1) { t.seul += 1; }
      }
    }
  }
  const res = {};
  for (const m of Object.keys(parM)) {
    const r = parM[m];
    if (!r.avecTermes) { continue; }
    const termes = Array.from(r.lignes.values()).sort((a, b) => (b.seul - a.seul) || (b.ramene - a.ramene)
      || a.terme.localeCompare(b.terme, langue));
    res[m] = { types: r.types, visibles: r.visibles, total: r.total, rappelSur: r.rappelSur, approx: r.approx, termes: termes };
  }
  return res;
}

// filtrerSurTerme(propositions, { terme, role?, langue? }) -> celles qui portent ce terme, comparé
// tel quel : un terme n'est jamais une expression régulière.
function porteTerme(p, f) {
  return termesDe(p).some((x) => x.terme === f.terme && (!f.role || x.role === f.role) && (!f.langue || x.langue === f.langue));
}
function filtrerSurTerme(propositions, filtre) {
  const liste = Array.isArray(propositions) ? propositions : [];
  if (!filtre || typeof filtre.terme !== 'string' || filtre.terme === '') { return liste.slice(); }
  return liste.filter((p) => porteTerme(p, filtre));
}

// ---- Demandes sur le lexique ---------------------------------------------------------------
//
// Une demande par fichier, <moissonneur>\demandes\<id>.json, que le cockpit écrit et que le
// moissonneur mesure ; sa réponse arrive dans etat.json (demandes, demandes_ignorees).

const SENS_DEMANDE = ['ajout', 'exclusion', 'retrait'];
const LANGUES_TERME = ['fr', 'de', 'it'];
const STATUTS_DEMANDE = ['en-attente', 'applique', 'applique-partiel', 'refuse-perte', 'refuse-bruit', 'doublon',
  'a-confirmer', 'retrait-en-attente'];
const LONGUEUR_TERME = 60;
// Lettres, espaces, tirets et apostrophes : rien qu'un moissonneur puisse lire comme un motif.
const RE_CARACTERE_INTERDIT = /[^\p{L}\p{M} '’-]/u;
// La même règle, envoyée à la page pour qu'elle signale l'erreur pendant la frappe.
const REGLE_TERME = Object.freeze({ longueur: LONGUEUR_TERME, interdit: RE_CARACTERE_INTERDIT.source });

// validerTerme(t) -> { ok, terme, raison?, caractere? } : le terme normalisé (NFC, sans blancs
// autour), ou la raison du refus.
function validerTerme(brut) {
  const t = String(brut === undefined || brut === null ? '' : brut).normalize('NFC').trim();
  if (t === '') { return { ok: false, raison: 'terme-vide', terme: t }; }
  if (Array.from(t).length > LONGUEUR_TERME) { return { ok: false, raison: 'terme-long', terme: t }; }
  const m = RE_CARACTERE_INTERDIT.exec(t);
  if (m) { return { ok: false, raison: 'terme-caractere', caractere: m[0], terme: t }; }
  if (!/\p{L}/u.test(t)) { return { ok: false, raison: 'terme-caractere', caractere: t.charAt(0), terme: t }; }
  return { ok: true, terme: t };
}
function memeTerme(a, b) { return String(a).normalize('NFC').trim().toLocaleLowerCase() === String(b).normalize('NFC').trim().toLocaleLowerCase(); }

function cheminDemandes(racineArbreVal, moissonneur) { return path.join(cheminMoissons(racineArbreVal), moissonneur, 'demandes'); }
function maintenantIso() { return new Date().toISOString().slice(0, 19) + 'Z'; }
function nouvelIdDemande() {
  const d = new Date().toISOString();
  return d.slice(0, 10).replace(/-/g, '') + '-' + d.slice(11, 19).replace(/:/g, '') + '-' + crypto.randomBytes(4).toString('hex');
}

// Le contenu d'un fichier de demande, réduit à ses champs, ou null s'il n'est pas conforme.
function demandeConforme(d, id) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || d.id !== id) { return null; }
  const v = validerTerme(d.terme);
  if (!v.ok || v.terme !== d.terme || LANGUES_TERME.indexOf(d.langue) === -1 || SENS_DEMANDE.indexOf(d.sens) === -1) { return null; }
  const s = (x) => String(x === undefined || x === null ? '' : x);
  const res = { id: id, terme: d.terme, langue: d.langue, sens: d.sens, par: s(d.par), le: s(d.le) };
  if (d.confirme_par !== undefined) { res.confirme_par = s(d.confirme_par); }
  if (d.confirme_le !== undefined) { res.confirme_le = s(d.confirme_le); }
  return res;
}

function lireFichiersDemandes(racineArbreVal, moissonneur, avertissements) {
  let noms;
  try { noms = fs.readdirSync(cheminDemandes(racineArbreVal, moissonneur)); } catch (e) { return []; }
  const res = [];
  for (const nom of noms.filter((x) => /\.json$/.test(x)).sort()) {
    const id = nom.slice(0, -5);
    if (!RE_ID_SUR.test(id)) { avertissements.push({ code: 'demande-nom-invalide', moissonneur: moissonneur, fichier: nom }); continue; }
    let d = null;
    try { d = demandeConforme(JSON.parse(fs.readFileSync(path.join(cheminDemandes(racineArbreVal, moissonneur), nom), 'utf8').replace(/^﻿/, '')), id); }
    catch (e) { d = null; }
    if (!d) { avertissements.push({ code: 'demande-illisible', moissonneur: moissonneur, fichier: nom }); continue; }
    res.push(d);
  }
  return res;
}

// La réponse du moissonneur à une demande : statut, effet mesuré, fiches perdues.
function reponseDemande(r) {
  const effet = r.effet && typeof r.effet === 'object' ? {
    rappel_avant: nombreOuNul(r.effet.rappel_avant), rappel_apres: nombreOuNul(r.effet.rappel_apres),
    par_mois_avant: nombreOuNul(r.effet.par_mois_avant), par_mois_apres: nombreOuNul(r.effet.par_mois_apres),
    complet: r.effet.complet !== false
  } : null;
  return {
    statut: STATUTS_DEMANDE.indexOf(r.statut) !== -1 ? r.statut : 'en-attente', effet: effet,
    fiches_perdues: Array.isArray(r.fiches_perdues) ? r.fiches_perdues.map(String) : [],
    mesure_le: String(r.mesure_le || '')
  };
}

// listerDemandes(racine, moissonneur) -> { demandes, avertissements } : les fichiers de demande
// (qui, quand, terme, sens), avec la réponse du moissonneur (statut, effet, fiches_perdues,
// mesure_le) ; sans réponse, en attente. Une demande appliquée dont le retrait attend est en
// « retrait-en-attente ». Les plus récentes d'abord.
function listerDemandes(racineArbreVal, moissonneur) {
  const avertissements = [];
  if (!moissonneurValide(moissonneur)) { return { demandes: [], avertissements: avertissements }; }
  const etat = lireEtat(path.join(cheminMoissons(racineArbreVal), moissonneur), moissonneur, avertissements) || {};
  const reponses = new Map();
  for (const r of Array.isArray(etat.demandes) ? etat.demandes : []) {
    if (r && typeof r.id === 'string') { reponses.set(r.id, reponseDemande(r)); }
  }
  for (const x of Array.isArray(etat.demandes_ignorees) ? etat.demandes_ignorees : []) {
    if (x && typeof x === 'object') {
      avertissements.push({ code: 'demande-ignoree', moissonneur: moissonneur, fichier: String(x.fichier || ''), raison: String(x.raison || '') });
    }
  }
  const sansReponse = { statut: 'en-attente', effet: null, fiches_perdues: [], mesure_le: '' };
  const demandes = lireFichiersDemandes(racineArbreVal, moissonneur, avertissements)
    .map((d) => Object.assign({}, d, reponses.get(d.id) || sansReponse));
  for (const d of demandes) {
    if (d.sens === 'retrait' || (d.statut !== 'applique' && d.statut !== 'applique-partiel')) { continue; }
    const retrait = demandes.find((x) => x.sens === 'retrait' && x.statut === 'en-attente' && x.langue === d.langue && memeTerme(x.terme, d.terme));
    if (retrait) { d.statut = 'retrait-en-attente'; d.retrait = retrait.id; }
  }
  demandes.sort((a, b) => (a.le < b.le ? 1 : a.le > b.le ? -1 : (a.id < b.id ? 1 : -1)));
  return { demandes: demandes, avertissements: avertissements };
}

function ecrireFichierDemande(racineArbreVal, moissonneur, d) {
  const chemin = path.join(cheminDemandes(racineArbreVal, moissonneur), d.id + '.json');
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  ecrireAtomique(chemin, JSON.stringify(d, null, 2) + '\n');
}

// ecrireDemande(racine, moissonneur, { terme, langue, sens, par }) -> { ok, demande, raison? }.
// La même demande encore en attente (terme, langue, sens) est refusée : raison « doublon ».
function ecrireDemande(racineArbreVal, moissonneur, demande) {
  const d = demande || {};
  if (!moissonneurValide(moissonneur)) { return { ok: false, raison: 'moissonneur-invalide' }; }
  if (SENS_DEMANDE.indexOf(d.sens) === -1) { return { ok: false, raison: 'sens-invalide' }; }
  if (LANGUES_TERME.indexOf(d.langue) === -1) { return { ok: false, raison: 'langue-invalide' }; }
  const v = validerTerme(d.terme);
  if (!v.ok) { return { ok: false, raison: v.raison, caractere: v.caractere }; }
  const deja = listerDemandes(racineArbreVal, moissonneur).demandes.find((x) => x.statut === 'en-attente'
    && x.sens === d.sens && x.langue === d.langue && memeTerme(x.terme, v.terme));
  if (deja) { return { ok: false, raison: 'doublon', demande: deja }; }
  let id = nouvelIdDemande();
  while (fs.existsSync(path.join(cheminDemandes(racineArbreVal, moissonneur), id + '.json'))) { id = nouvelIdDemande(); }
  const ecrite = { id: id, terme: v.terme, langue: d.langue, sens: d.sens, par: String(d.par || '—'), le: maintenantIso() };
  ecrireFichierDemande(racineArbreVal, moissonneur, ecrite);
  return { ok: true, demande: ecrite };
}

function trouverDemande(racineArbreVal, moissonneur, id) {
  if (!moissonneurValide(moissonneur) || typeof id !== 'string' || !RE_ID_SUR.test(id)) { return null; }
  return listerDemandes(racineArbreVal, moissonneur).demandes.find((x) => x.id === id) || null;
}
function contenuFichier(d) {
  const res = { id: d.id, terme: d.terme, langue: d.langue, sens: d.sens, par: d.par, le: d.le };
  if (d.confirme_par !== undefined) { res.confirme_par = d.confirme_par; }
  if (d.confirme_le !== undefined) { res.confirme_le = d.confirme_le; }
  return res;
}

// confirmerDemande(racine, moissonneur, id, par) -> { ok, demande, raison? } : « Appliquer quand
// même » une demande refusée pour perte, par son seul demandeur, une fois.
function confirmerDemande(racineArbreVal, moissonneur, id, par) {
  const d = trouverDemande(racineArbreVal, moissonneur, id);
  if (!d) { return { ok: false, raison: 'demande-introuvable' }; }
  if (d.statut !== 'refuse-perte' && d.statut !== 'a-confirmer') { return { ok: false, raison: 'pas-refusee' }; }
  const qui = String(par || '');
  if (!qui || qui === '—') { return { ok: false, raison: 'auteur-inconnu' }; }
  if (qui !== d.par) { return { ok: false, raison: 'pas-le-demandeur' }; }
  if (d.confirme_par) { return { ok: false, raison: 'deja-confirmee' }; }
  const ecrite = Object.assign(contenuFichier(d), { confirme_par: qui, confirme_le: maintenantIso() });
  ecrireFichierDemande(racineArbreVal, moissonneur, ecrite);
  return { ok: true, demande: ecrite };
}

// retirerDemande(racine, moissonneur, id, par) -> { ok, action, demande, retrait?, raison? }.
// En attente, refusée ou en doublon : le fichier part (action « supprimee », `demande` garde son
// contenu pour Annuler). Appliquée : une demande de retrait s'écrit (action « retrait »).
function retirerDemande(racineArbreVal, moissonneur, id, par) {
  const d = trouverDemande(racineArbreVal, moissonneur, id);
  if (!d) { return { ok: false, raison: 'demande-introuvable' }; }
  if (d.statut === 'retrait-en-attente') { return { ok: false, raison: 'retrait-deja-demande' }; }
  if (d.statut === 'applique' || d.statut === 'applique-partiel') {
    const r = ecrireDemande(racineArbreVal, moissonneur, { terme: d.terme, langue: d.langue, sens: 'retrait', par: par });
    if (!r.ok) { return r; }
    return { ok: true, action: 'retrait', demande: contenuFichier(d), retrait: r.demande };
  }
  try { fs.unlinkSync(path.join(cheminDemandes(racineArbreVal, moissonneur), d.id + '.json')); }
  catch (e) { return { ok: false, raison: 'demande-introuvable' }; }
  return { ok: true, action: 'supprimee', demande: contenuFichier(d) };
}

// retablirDemande(racine, moissonneur, contenu) -> { ok, raison? } : remet tel quel le fichier
// d'une demande retirée (Annuler). Jamais par-dessus un fichier présent.
function retablirDemande(racineArbreVal, moissonneur, contenu) {
  const id = contenu && typeof contenu.id === 'string' ? contenu.id : '';
  if (!moissonneurValide(moissonneur) || !RE_ID_SUR.test(id)) { return { ok: false, raison: 'demande-invalide' }; }
  const d = demandeConforme(contenu, id);
  if (!d) { return { ok: false, raison: 'demande-invalide' }; }
  if (fs.existsSync(path.join(cheminDemandes(racineArbreVal, moissonneur), id + '.json'))) { return { ok: false, raison: 'demande-presente' }; }
  ecrireFichierDemande(racineArbreVal, moissonneur, d);
  return { ok: true };
}

module.exports = {
  comptesTermes, filtrerSurTerme, validerTerme, listerDemandes, ecrireDemande, confirmerDemande,
  retirerDemande, retablirDemande, SENS_DEMANDE, STATUTS_DEMANDE, LANGUES_TERME, REGLE_TERME,
  FORMAT, FORMAT_ETAT, CODES_DOUTE, DECISIONS, MOTIFS_REFUS, NB_CRANS,
  cransDe, cranMax, cranDefautDe, cheminReglages, lireReglages, ecrireReglage, retablirReglage,
  finessePourVue, comptesCrans, compterVisibles, resumeMoissonneurs, lireAuteurDemande,
  cheminMoissons, cheminDecisions, cheminDecision, empreinteCle,
  listerPropositions, listerRefusees, classer, bloquants, ordonner, compterPropositions,
  lireDecision, ecrireDecision, annulerDecision,
  accepter, refuser, annulerAcceptation,
  accepterLot, refuserLot, annulerLot, ficheDoublon, lireProposition, recreerFiche,
  languesDe, titresOfficielsDeFiche
};
