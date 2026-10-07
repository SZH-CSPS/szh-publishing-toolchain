// Les résumés générés des propositions : la requête à Mistral, la garde de fidélité et le
// magasin _Moissons\_Resumes\<langue>\<empreinte>.json (docs/FORMAT-PROPOSITIONS.md).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const kirby = require('./kirby-contenu');
const propositions = require('./propositions');
const { ecrireAtomique } = require('./yaml');

const FORMAT = 'pronto-resume/1';
const DOSSIER = '_Resumes';
const CHEMIN_PROMPTS = path.join(__dirname, '..', 'prompts', 'resume-descriptif.json');
// Ce que coûte un appel hors du texte source : la sortie et la marge du gabarit, en jetons.
const JETONS_SORTIE = 300;
const CARACTERES_PAR_JETON = 3.5;
// La marque que le moissonneur du parlement pose au bout d'un texte déposé coupé (moissonneurs/parlement/texte.py).
const SUITE_COUPEE = '[…]';

let promptsCache = null;
function prompts() {
  if (!promptsCache) { promptsCache = JSON.parse(fs.readFileSync(CHEMIN_PROMPTS, 'utf8')); }
  return promptsCache;
}

// ---- Emplacements ----------------------------------------------------------------------

function cheminResumes(racineArbreVal, langue) {
  return path.join(propositions.cheminMoissons(racineArbreVal), DOSSIER, langue);
}
function cheminResume(racineArbreVal, langue, cle) {
  return path.join(cheminResumes(racineArbreVal, langue), propositions.empreinteCle(cle) + '.json');
}
function empreinteTexte(texte) { return crypto.createHash('sha256').update(String(texte), 'utf8').digest('hex'); }

// ---- La source ---------------------------------------------------------------------------

// sourceDe(p, P?) -> { texte, mode, tronquee } ou null. Un descriptif de recherche se raccourcit
// s'il dépasse la borne haute ; une intervention n'a pas de descriptif, le résumé naît de son
// texte déposé (`texte_depose`, champ facultatif du lot), plafonné.
function sourceDe(p, P) {
  const g = P || prompts();
  const t = p && g.types[p.type];
  if (!t) { return null; }
  let texte = '';
  if (t.source === 'descriptif') {
    texte = String(((p.valeurs || {}).descriptif) || '').trim();
    if (texte.length <= t.max) { return null; }
  } else if (t.source === 'texte_depose') {
    texte = typeof p.texte_depose === 'string' ? p.texte_depose.trim() : '';
    if (texte === '') { return null; }
  } else { return null; }
  const coupe = texte.length > g.plafond_source;
  // « […] » en fin de texte déposé : le moissonneur l'a déjà coupé à son plafond.
  const tronquee = coupe || (t.source === 'texte_depose' && texte.endsWith(SUITE_COUPEE));
  return { texte: coupe ? texte.slice(0, g.plafond_source) : texte, mode: t.mode, tronquee: tronquee };
}

// L'exécutif d'une intervention, par le corps de sa cle (`parlement:openparldata:<corps>:…`) :
// CHE est la Confédération, deux lettres un canton ; une commune (un nombre) n'en a pas.
function executifDe(p, langue, P) {
  const corps = String((p && p.cle) || '').split(':')[2] || '';
  const code = corps === 'CHE' ? 'CH' : /^[A-Z]{2}$/.test(corps) ? corps : '';
  const e = code ? (P.executifs || {})[code] : null;
  return e && e[langue] ? e[langue] : '';
}

// La fiche telle qu'elle s'imprime à côté du descriptif : le modèle ne la répète pas.
function ficheDe(p, langue, P) {
  const v = p.valeurs || {};
  const f = {};
  for (const k of ['title', 'canton', 'numero', 'date', 'institutions', 'debut', 'fin']) {
    if (typeof v[k] === 'string' && v[k].trim() !== '') { f[k] = v[k]; }
  }
  if (p.titres && p.titres[langue]) { f.title = p.titres[langue]; }
  if (v.categorie) {
    const l = kirby.valeursListe('instrument').find((x) => x.jeton === v.categorie);
    if (l) { f.instrument = l[langue] || l.fr; }
  }
  if (p.type === 'intervention') {
    const e = executifDe(p, langue, P);
    if (e) { f.executif = e; }
  }
  return f;
}

function remplir(gabarit, valeurs) {
  return String(gabarit).replace(/\{([a-z]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(valeurs, k) ? String(valeurs[k]) : m));
}

// construireRequete(p, langue, P?) -> { messages, type, source, fiche } ou null.
// Rien d'autre que les textes publics d'une proposition (OpenParlData, sites des hautes écoles,
// FNS) ne part chez Mistral : son descriptif ou son texte déposé, et les valeurs de sa fiche.
// Cette fonction ne lit que la proposition, jamais un manuscrit.
function construireRequete(p, langue, P) {
  const g = P || prompts();
  const source = sourceDe(p, g);
  if (!source || !g.systeme[langue]) { return null; }
  const t = g.types[p.type];
  const fiche = ficheDe(p, langue, g);
  const systeme = remplir(g.systeme[langue], { mots: t.mots[langue] }) + '\n\n' + t.consigne[langue];
  const utilisateur = remplir(g.utilisateur[langue], { fiche: JSON.stringify(fiche), source: source.texte });
  return {
    messages: [{ role: 'system', content: systeme }, { role: 'user', content: utilisateur }],
    type: t, source: source, fiche: fiche, langue: langue
  };
}

// Une seule ligne de texte brut : ni saut de ligne, ni guillemets autour de la réponse.
function nettoyer(texte) {
  let s = String(texte || '').replace(/\s*\n+\s*/g, ' ').trim();
  const paires = [['«', '»'], ['"', '"'], ['„', '“'], ['“', '”']];
  for (const [a, b] of paires) {
    if (s.startsWith(a) && s.endsWith(b) && s.length > 2) { s = s.slice(a.length, s.length - b.length).trim(); }
  }
  return s;
}

// ---- La garde de fidélité -----------------------------------------------------------------

// Un nombre, ses milliers séparés ou non (745 000, 745'000), et ses décimales. Lu comme un tout :
// « 20 » n'est pas dans « 2020 ».
const RE_NOMBRE = /\d+(?:[   '’]\d{3})*(?:[.,]\d+)*/g;
function normaliserNombre(s) {
  const sans = s.replace(/[   '’]/g, '').replace(/,/g, '.');
  return sans.split('.').map((x) => x.replace(/^0+(?=\d)/, '')).join('.');
}
// nombresDe(texte) -> les nombres d'un texte, normalisés.
function nombresDe(texte) { return (String(texte || '').match(RE_NOMBRE) || []).map(normaliserNombre); }
// L'ensemble des nombres admis : chaque nombre de la source, chacune de ses parties (le jour, le
// mois et l'année d'une date, les groupes d'un millier), et ses milliers à l'anglaise ou à
// l'allemande (745,000 et 745.000 valent 745 000).
function nombresAdmis(texte) {
  const res = new Set();
  for (const brut of (String(texte || '').match(RE_NOMBRE) || [])) {
    res.add(normaliserNombre(brut));
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(brut)) { res.add(normaliserNombre(brut.replace(/[.,]/g, ''))); }
    for (const part of brut.split(/[   '’.,]/)) { if (part) { res.add(normaliserNombre(part)); } }
  }
  return res;
}
// nombresHorsSource(sortie, source) -> les nombres de la sortie que la source n'a pas.
function nombresHorsSource(sortie, source) {
  const admis = nombresAdmis(source);
  const vus = new Set();
  return nombresDe(sortie).filter((n) => {
    if (admis.has(n) || vus.has(n)) { return false; }
    vus.add(n);
    return true;
  });
}

// Les doutes d'un résumé : un nombre absent de la source ou de la fiche, une longueur hors de la
// plage, une source coupée au plafond.
function doutesDe(texte, req) {
  const doutes = [];
  const reference = req.source.texte + '\n' + JSON.stringify(req.fiche);
  for (const n of nombresHorsSource(texte, reference)) { doutes.push({ code: 'nombre-hors-source', detail: n }); }
  if (tropLong(texte, req.type, req.langue) || texte.length < req.type.min) {
    doutes.push({ code: 'longueur-hors-plage', detail: String(texte.length) });
  }
  if (req.source.tronquee) { doutes.push({ code: 'source-tronquee', detail: String(req.source.texte.length) }); }
  return doutes;
}

// ---- La génération ------------------------------------------------------------------------

function nbMots(texte) { return String(texte).trim().split(/\s+/).filter(Boolean).length; }
// Trop long : au-delà de la borne haute en caractères, ou du nombre de mots permis.
function tropLong(texte, type, langue) {
  const mots = (type.mots_max || {})[langue];
  return texte.length > type.max || (Number.isInteger(mots) && nbMots(texte) > mots);
}
const RELANCES_MAX = 2;

// resumer(p, langue, { client, modele, poste, P? }) -> le résumé, prêt à écrire. Deux relances au
// plus quand un jet est trop long ; au-delà, le doute de longueur le dit.
async function resumer(p, langue, options) {
  const o = options || {};
  const g = o.P || prompts();
  const req = construireRequete(p, langue, g);
  if (!req) { return null; }
  const corps = (messages) => ({ model: o.modele, messages: messages, temperature: g.temperature, max_tokens: g.max_tokens });
  let r = await o.client.chat(corps(req.messages));
  let texte = nettoyer(r.texte);
  let jetons = r.jetons;
  let relance = false;
  let messages = req.messages;
  for (let i = 0; i < RELANCES_MAX && tropLong(texte, req.type, langue); i++) {
    messages = messages.concat([{ role: 'assistant', content: texte },
      { role: 'user', content: remplir(g.relance[langue], { n: texte.length, max: req.type.max }) }]);
    r = await o.client.chat(corps(messages));
    texte = nettoyer(r.texte);
    jetons += r.jetons;
    relance = true;
  }
  return {
    format: FORMAT, cle: p.cle, langue: langue, texte: texte, modele: o.modele, prompt: g.version,
    date: new Date().toISOString().slice(0, 19) + 'Z', poste: String(o.poste || ''),
    source_empreinte: empreinteTexte(req.source.texte), source_car: req.source.texte.length,
    mode: req.source.mode, relance: relance, jetons: jetons, doutes: doutesDe(texte, req)
  };
}

// ---- Le magasin -----------------------------------------------------------------------------

function resumeConforme(r) {
  return !!r && typeof r === 'object' && r.format === FORMAT && typeof r.cle === 'string'
    && typeof r.texte === 'string' && r.texte.trim() !== '' && typeof r.source_empreinte === 'string';
}
// Un fichier par proposition et par langue, écrit d'un coup ; une régénération l'écrase.
function ecrireResume(racineArbreVal, resume) {
  fs.mkdirSync(cheminResumes(racineArbreVal, resume.langue), { recursive: true });
  ecrireAtomique(cheminResume(racineArbreVal, resume.langue, resume.cle), JSON.stringify(resume, null, 1) + '\n');
}
function lireResume(racineArbreVal, langue, cle) {
  let r;
  try { r = JSON.parse(fs.readFileSync(cheminResume(racineArbreVal, langue, cle), 'utf8').replace(/^﻿/, '')); }
  catch (e) { return null; }
  return resumeConforme(r) && r.cle === cle ? r : null;
}
// Un résumé vaut tant que sa source n'a pas changé et qu'il tient dans la plage actuelle ; sinon il
// est périmé et se régénère (une plage resserrée refait donc les résumés trop longs).
function resumeValide(p, langue, resume, P) {
  if (!resumeConforme(resume) || resume.cle !== p.cle) { return false; }
  const g = P || prompts();
  const s = sourceDe(p, g);
  if (!s || resume.source_empreinte !== empreinteTexte(s.texte)) { return false; }
  return !tropLong(resume.texte, g.types[p.type], langue);
}

// resumesValides(racine, langue, propositions) -> Map cle -> résumé. Le dossier se lit une fois,
// et seuls les fichiers des propositions données sont ouverts.
function resumesValides(racineArbreVal, langue, liste) {
  const res = new Map();
  let noms;
  try { noms = new Set(fs.readdirSync(cheminResumes(racineArbreVal, langue))); } catch (e) { return res; }
  const P = prompts();
  for (const p of liste || []) {
    if (!noms.has(propositions.empreinteCle(p.cle) + '.json')) { continue; }
    const r = lireResume(racineArbreVal, langue, p.cle);
    if (r && resumeValide(p, langue, r, P)) { res.set(p.cle, r); }
  }
  return res;
}

// candidats(racine, langue) -> { liste: [p], parType: { type: n }, jetons } : les propositions en
// attente de cette langue qui ont une source à résumer et pas de résumé valide.
function candidats(racineArbreVal, langue) {
  const P = prompts();
  const lu = propositions.listerPropositions(racineArbreVal, langue).propositions.filter((p) => !!sourceDe(p, P));
  const valides = resumesValides(racineArbreVal, langue, lu);
  const liste = lu.filter((p) => !valides.has(p.cle));
  const parType = {};
  let jetons = 0;
  for (const p of liste) {
    parType[p.type] = (parType[p.type] || 0) + 1;
    jetons += estimerJetons(p, langue, P);
  }
  return { liste: liste, parType: parType, jetons: jetons };
}
// L'estimation d'un appel : la requête entière en caractères, plus la sortie.
function estimerJetons(p, langue, P) {
  const req = construireRequete(p, langue, P || prompts());
  if (!req) { return 0; }
  const car = req.messages.reduce((n, m) => n + m.content.length, 0);
  return Math.ceil(car / CARACTERES_PAR_JETON) + JETONS_SORTIE;
}

module.exports = {
  FORMAT, DOSSIER, prompts, cheminResumes, cheminResume, empreinteTexte, sourceDe, ficheDe, executifDe,
  construireRequete, nettoyer, nombresDe, nombresHorsSource, doutesDe, resumer,
  ecrireResume, lireResume, resumeValide, resumesValides, candidats, estimerJetons
};
