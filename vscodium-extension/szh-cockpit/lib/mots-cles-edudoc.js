// Le vocabulaire des descripteurs edudoc.ch (thésaurus bilingue DE/FR appliqué à nos deux
// revues), moissonné sur l'interface OAI-PMH PUBLIQUE d'edudoc.ch et gardé dans
// C:\ProgramData\SZH\mots-cles.json. Alimentera plus tard l'autocomplétion de mots clés
// (lot suivant, hors périmètre ici : ce module ne fait QUE moissonner, dédoublonner, garder).
//
// Endpoint et sets relevés le 31.08.2026 par ListSets sur https://edudoc.ch/oai2d — instance
// Invenio/TIND, sans authentification :
//   verb=Identify, verb=ListSets, verb=ListRecords tous vérifiés en direct.
// Les deux revues y sont des sets dédiés, identifiants EXACTS (avec espaces, à
// encodeURIComponent) :
//   "Revue suisse de pédagogie spécialisée"
//   "Schweizerische Zeitschrift für Heilpädagogik"
//
// metadataPrefix=oai_dc ne porte AUCUN champ sujet — vérifié dans l'enquête préalable.
// Seul metadataPrefix=marcxml expose le champ MARC 690, en paires bilingues répétées :
// $a = allemand, $b = français. Exemple réel : $a Sonderpädagogik / $b pédagogie spécialisée.
//
// Différence structurelle avec lib/auteurs-ojs.js (qui vise OJS, pas edudoc) : le marcxml
// d'edudoc préfixe TOUT son contenu MARC avec le namespace « marc: » —
// <marc:record><marc:datafield tag="690"><marc:subfield code="a">…</marc:subfield></marc:datafield></marc:record>
// — alors qu'OJS ne préfixe pas. Conséquence heureuse : pas de collision de balise <record>
// (le <record> OAI est nu, le <marc:record> MARC est préfixé) là où OJS imbriquait deux
// <record> de même nom. Mais les expressions régulières de ce module DOIVENT tolérer le
// préfixe, faute de quoi elles ne matcheraient simplement rien sur les vraies réponses.
//
// Repli 503 : constaté en conditions réelles le 31.08.2026, au milieu d'un moissonnage complet
// des deux sets — passé une poignée de requêtes rapprochées, l'instance (Apache derrière un
// pare-feu applicatif, à en juger par la CSP qui cite awswaf.com) répond
// « 503 Retry after 1 seconds » puis se rétablit d'elle-même à la requête suivante.
// lib/auteurs-ojs.js n'a pas eu besoin de cette tolérance jusqu'ici : l'instance OJS visée ne
// l'a jamais montrée en un an d'usage — mais rien ne garantit qu'elle ne s'y mette pas un
// jour. D'où recupererAvecRepli() dans lib/oai-pmh.js plutôt que dans ce seul module (voir
// plus bas) : signalé indépendamment par deux agents comme le repli le plus propre.
//
// Volume réellement moissonné le 31.08.2026 (moissonnage complet, sans from) : 456 notices
// pour la Revue, 2385 pour la Zeitschrift, soit 2841 notices, 10975 paires 690 brutes,
// 925 descripteurs distincts après dédoublonnage casse/accents. 10 paires incomplètes
// rencontrées sur les 10975 (2 sans allemand, 8 sans français) : la tolérance n'est pas
// théorique.
//
// Cache SÉPARÉ de config.json (qui est réécrit en entier à chaque réglage), forme imposée :
//   { dateFetch: "2026-08-31T12:00:00.000Z" | null, motsCles: [{ de, fr, manque }, …] }
// où `manque` vaut 'de', 'fr' ou null. Écriture atomique (lib/yaml.js).
//
// Rythme : au plus une fois par mois (dateFetch), incrémental (from = date du dernier fetch,
// au jour). Hors ligne = normal : l'échec est silencieux, comme pour les auteur·e·s.
// dateFetch n'avance que si les DEUX sets ont répondu ; sinon on réessaie, la fusion étant
// idempotente.
//
// SZH_MOTS_CLES_CACHE impose un autre fichier de cache — les tests s'en servent, comme
// SZH_AUTEURS_CACHE pour lib/auteurs-ojs.js : aucun test ne touche C:\ProgramData, et aucun
// ne fait de réseau (le moissonnage prend son `recuperer` en paramètre).
//
// Réutilisation délibérée de lib/oai-pmh.js, module commun avec lib/auteurs-ojs.js (extrait
// le 01.09.2026) : son client HTTP (recupererHttps, avec ses gardes — redirections
// même-hôte, réponse bornée à 20 Mo, délai total de 60 s), son repli sur 503
// (recupererAvecRepli) et son parseur générique OAI-PMH (erreurOai, extraireResumptionToken,
// decoderTexteXml) ne sont pas spécifiques aux auteur·e·s ni à edudoc : ils sont importés
// tels quels plutôt que réécrits. plierNom (casse + accents pliés) est importé de même sous
// l'alias `plierTexte` — son nom trompe, son corps ne fait rien de spécifique à un nom de
// personne. Seule l'extraction du champ 690, la fusion des descripteurs et la pagination
// avec `set=` sont propres à ce module.
'use strict';

const fs = require('fs');
const path = require('path');
const { ecrireAtomique } = require('./yaml');
const { BASE_SZH } = require('./archivage');
const {
  decoderTexteXml, erreurOai, extraireResumptionToken, recupererAvecRepli,
  plierNom: plierTexte
} = require('./oai-pmh');

const ENDPOINT_EDUDOC_DEFAUT = 'https://edudoc.ch/oai2d';
const SETS_EDUDOC_DEFAUT = [
  'Revue suisse de pédagogie spécialisée',
  'Schweizerische Zeitschrift für Heilpädagogik'
];

const JOURS_FRAICHEUR = 30;                // « une fois par mois », comme les auteur·e·s.
// La Zeitschrift a demandé 24 pages à 100 notices pour 2385 notices, le 31.08.2026 : la
// garde anti-boucle laisse une marge d'un ordre de grandeur au-delà de l'observé.
const PAGES_MAX = 500;

function cheminCacheMotsCles() {
  const impose = String(process.env.SZH_MOTS_CLES_CACHE || '').trim();
  return impose !== '' ? impose : path.join(BASE_SZH, 'mots-cles.json');
}

// ---- Extraction MARC 690 -----------------------------------------------------------
//
// Tolérant, comme le parseur de lib/auteurs-ojs.js : un XML tronqué ou hostile rend
// simplement moins de records, jamais une exception. `(?:[\w.-]+:)?` avale le préfixe
// « marc: » sans l'imposer — au cas où une future réponse edudoc en serait dépourvue.

// Les records d'une réponse ListRecords marcxml : [{ datestamp, deleted, descripteurs }],
// descripteurs = [{ de, fr, manque }]. `manque` signale un $a ou un $b absent — jamais
// rejeté en silence, voir recordsEnMotsCles et fusionnerMotsCles.
function extraireRecordsMotsCles(xml) {
  const records = [];
  const source = String(xml === undefined || xml === null ? '' : xml);
  for (const bloc of source.matchAll(/<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/g)) {
    const corps = bloc[1];
    const deleted = /<header[^>]*\bstatus\s*=\s*["']deleted["']/.test(corps);
    const date = corps.match(/<datestamp(?:\s[^>]*)?>([\s\S]*?)<\/datestamp>/);
    const descripteurs = [];
    for (const field of corps.matchAll(
      /<(?:[\w.-]+:)?datafield\s+tag\s*=\s*["']690["'][^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?datafield>/g
    )) {
      let de = '';
      let fr = '';
      // Un seul $a et un seul $b par champ 690 dans tout ce qui a été observé sur
      // l'instance (contrairement au $u répétable d'OJS) : le premier de chaque fait foi.
      let vuA = false;
      let vuB = false;
      for (const sf of field[1].matchAll(
        /<(?:[\w.-]+:)?subfield\s+code\s*=\s*["']([ab])["'][^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?subfield>/g
      )) {
        const valeur = decoderTexteXml(sf[2]).replace(/\s+/g, ' ').trim();
        if (sf[1] === 'a' && !vuA) { de = valeur; vuA = true; }
        else if (sf[1] === 'b' && !vuB) { fr = valeur; vuB = true; }
      }
      if (de === '' && fr === '') { continue; }              // rien à garder
      descripteurs.push({ de: de, fr: fr, manque: de === '' ? 'de' : (fr === '' ? 'fr' : null) });
    }
    records.push({
      datestamp: date ? decoderTexteXml(date[1]).trim() : '',
      deleted: deleted,
      descripteurs: descripteurs
    });
  }
  return records;
}

// Les records d'un moissonnage aplatis en descripteurs. Records deleted ignorés — jamais de
// suppression côté cache, comme pour les auteur·e·s.
function recordsEnMotsCles(records) {
  const sortie = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || r.deleted) { continue; }
    for (const d of Array.isArray(r.descripteurs) ? r.descripteurs : []) { sortie.push(d); }
  }
  return sortie;
}

// ---- Déduplication et fusion --------------------------------------------------------
//
// Clé de rapprochement : forme pliée (casse et accents) de l'allemand OU du français —
// l'un ou l'autre suffit à retrouver une entrée déjà connue, ce qui permet à une paire
// incomplète de compléter plus tard une entrée déjà entrevue (ou l'inverse). Jamais de
// suppression, jamais d'écrasement d'une valeur remplie par une autre différente : un vrai
// désaccord entre deux moissons (même allemand, français distinct — RENCONTRÉ RÉELLEMENT :
// « Lernschwierigkeit » a deux traductions concurrentes sur l'instance) donne une SECONDE
// entrée plutôt qu'un remplacement muet.
function fusionnerMotsCles(existants, nouveaux) {
  const sortie = [];
  const parDe = new Map();   // allemand plié (non vide) -> index dans `sortie`
  const parFr = new Map();   // français plié (non vide) -> index dans `sortie`

  const indexer = (i) => {
    const e = sortie[i];
    const kd = plierTexte(e.de);
    const kf = plierTexte(e.fr);
    if (kd !== '' && !parDe.has(kd)) { parDe.set(kd, i); }
    if (kf !== '' && !parFr.has(kf)) { parFr.set(kf, i); }
  };

  const poser = (mc) => {
    const de = String((mc || {}).de || '').trim();
    const fr = String((mc || {}).fr || '').trim();
    if (de === '' && fr === '') { return; }
    const kd = plierTexte(de);
    const kf = plierTexte(fr);
    let i = -1;
    if (kd !== '' && parDe.has(kd)) { i = parDe.get(kd); }
    else if (kf !== '' && parFr.has(kf)) { i = parFr.get(kf); }

    if (i !== -1) {
      const existant = sortie[i];
      // Allemand : on comble un manque, on ne compare que si l'existant est déjà rempli.
      if (existant.de === '' && de !== '') { existant.de = de; }
      else if (de !== '' && kd !== '' && plierTexte(existant.de) !== kd) { i = -1; }
      if (i !== -1) {
        // Français : même règle.
        if (existant.fr === '' && fr !== '') { existant.fr = fr; }
        else if (fr !== '' && kf !== '' && plierTexte(existant.fr) !== kf) { i = -1; }
      }
      if (i !== -1) {
        existant.manque = existant.de === '' ? 'de' : (existant.fr === '' ? 'fr' : null);
        indexer(i);
        return;
      }
    }
    // Aucun candidat, ou désaccord détecté ci-dessus : nouvelle entrée, rien n'est effacé.
    const entree = { de: de, fr: fr, manque: de === '' ? 'de' : (fr === '' ? 'fr' : null) };
    sortie.push(entree);
    indexer(sortie.length - 1);
  };

  for (const mc of Array.isArray(existants) ? existants : []) { poser(mc); }
  for (const mc of Array.isArray(nouveaux) ? nouveaux : []) { poser(mc); }
  return sortie;
}

// ---- Cache C:\ProgramData\SZH\mots-cles.json ----------------------------------------

function cacheVideMotsCles() {
  return { dateFetch: null, motsCles: [] };
}

// Lecture tolérante : fichier absent, JSON corrompu, BOM, forme inattendue — tout retombe
// sur le cache vide, jamais une exception.
function lireCacheMotsCles() {
  let brut;
  try {
    brut = JSON.parse(String(fs.readFileSync(cheminCacheMotsCles(), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (e) { return cacheVideMotsCles(); }
  if (!brut || typeof brut !== 'object') { return cacheVideMotsCles(); }
  return {
    dateFetch: typeof brut.dateFetch === 'string' && brut.dateFetch !== '' ? brut.dateFetch : null,
    motsCles: Array.isArray(brut.motsCles) ? brut.motsCles : []
  };
}

function ecrireCacheMotsCles(cache) {
  try {
    const c = cache && typeof cache === 'object' ? cache : cacheVideMotsCles();
    fs.mkdirSync(path.dirname(cheminCacheMotsCles()), { recursive: true });
    ecrireAtomique(cheminCacheMotsCles(), JSON.stringify({
      dateFetch: typeof c.dateFetch === 'string' ? c.dateFetch : null,
      motsCles: Array.isArray(c.motsCles) ? c.motsCles : []
    }, null, 2) + '\n');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Frais = moins d'un mois. Une dateFetch dans le futur (horloge repassée en arrière) compte
// comme périmée : le cache se répare tout seul au prochain moissonnage.
function cacheFraisMotsCles(cache, maintenant) {
  if (!cache || !cache.dateFetch) { return false; }
  const t = Date.parse(cache.dateFetch);
  if (!isFinite(t)) { return false; }
  const age = (maintenant === undefined ? Date.now() : maintenant) - t;
  return age >= 0 && age < JOURS_FRAICHEUR * 24 * 3600 * 1000;
}

// ---- Config (surcharge de l'endpoint / des sets) -------------------------------------
//
// Pure — la config lui est passée — pour être éprouvable sans lire C:\ProgramData. Comme
// endpointsOai() dans lib/auteurs-ojs.js : un endpoint http en clair est refusé.
function configEdudoc(cfg) {
  const brut = cfg && cfg.edudoc;
  const endpointBrut = brut && typeof brut === 'object' ? String(brut.endpoint || '').trim() : '';
  const endpoint = /^https:\/\//i.test(endpointBrut) ? endpointBrut : ENDPOINT_EDUDOC_DEFAUT;
  const setsBruts = brut && typeof brut === 'object' && Array.isArray(brut.sets) ? brut.sets : null;
  const sets = setsBruts && setsBruts.length > 0
    ? setsBruts.map((s) => String(s === undefined || s === null ? '' : s)).filter((s) => s !== '')
    : null;
  return { endpoint: endpoint, sets: (sets && sets.length > 0) ? sets : SETS_EDUDOC_DEFAUT.slice() };
}

// recupererAvecRepli (repli sur le 503 « Retry after » d'edudoc.ch) vit dans lib/oai-pmh.js,
// importé plus haut : voir l'en-tête du fichier.

// ---- Moissonnage ----------------------------------------------------------------------

// ListRecords sur UN set, resumptionToken suivis jusqu'au bout. `recuperer` est injecté —
// recupererAvecRepli en vrai, une table de fixtures dans les tests. `from` (YYYY-MM-DD)
// rend le moissonnage incrémental. metadataPrefix et set ne sont portés QUE par la première
// requête — OAI-PMH interdit de les répéter avec un resumptionToken.
async function moissonnerMotsCles(recuperer, endpoint, setSpec, from) {
  const records = [];
  const jonction = endpoint.indexOf('?') === -1 ? '?' : '&';
  let url = endpoint + jonction + 'verb=ListRecords&metadataPrefix=marcxml&set=' +
    encodeURIComponent(setSpec) + (from ? '&from=' + encodeURIComponent(from) : '');
  const tokensVus = new Set();
  for (let page = 0; page < PAGES_MAX; page++) {
    const xml = await recuperer(url);
    const erreur = erreurOai(xml);
    if (erreur) {
      if (erreur.code === 'noRecordsMatch') { return records; }   // rien de neuf : normal
      throw new Error('OAI ' + erreur.code + ' sur ' + endpoint + ' (set ' + setSpec + ')' +
        (erreur.message ? ' : ' + erreur.message : ''));
    }
    for (const r of extraireRecordsMotsCles(xml)) { records.push(r); }
    const token = extraireResumptionToken(xml);
    if (token === '') { return records; }
    if (tokensVus.has(token)) {
      throw new Error('resumptionToken répété sur ' + endpoint + ' (set ' + setSpec + ')');
    }
    tokensVus.add(token);
    url = endpoint + jonction + 'verb=ListRecords&resumptionToken=' + encodeURIComponent(token);
  }
  throw new Error('pagination OAI interrompue après ' + PAGES_MAX + ' pages sur ' + endpoint +
    ' (set ' + setSpec + ')');
}

// ---- Rafraîchissement -----------------------------------------------------------------
//
// Même contrat que rafraichir() de lib/auteurs-ojs.js :
//   { fait: false, raison: 'frais', … }          cache de moins d'un mois, aucun appel
//   { fait: true, complet: true, … }             les DEUX sets ont répondu, dateFetch avancée
//   { fait: true, complet: false, erreur, … }    au moins un set muet : fusionné quand même,
//                                                dateFetch inchangée, on réessaiera
// `opts` réservé aux tests : { maintenant, recuperer, forcer, config }.
async function rafraichirMotsCles(opts) {
  const o = opts || {};
  const maintenant = o.maintenant === undefined ? Date.now() : o.maintenant;
  const cache = lireCacheMotsCles();
  if (!o.forcer && cacheFraisMotsCles(cache, maintenant)) {
    return { fait: false, raison: 'frais', dateFetch: cache.dateFetch, nombre: cache.motsCles.length };
  }
  const recuperer = o.recuperer || recupererAvecRepli;
  const from = cache.dateFetch ? String(cache.dateFetch).slice(0, 10) : null;
  const { endpoint, sets } = configEdudoc(o.config === undefined ? {} : o.config);
  let motsCles = cache.motsCles;
  let complet = true;
  let derniereErreur = null;
  for (const setSpec of sets) {
    try {
      const records = await moissonnerMotsCles(recuperer, endpoint, setSpec, from);
      motsCles = fusionnerMotsCles(motsCles, recordsEnMotsCles(records));
    } catch (e) {
      complet = false;
      derniereErreur = String((e && e.message) || e);
    }
  }
  // Hors ligne complet : rien de neuf et rien à réécrire — le fichier reste tel quel.
  const inchange = !complet && JSON.stringify(motsCles) === JSON.stringify(cache.motsCles);
  const neuf = {
    dateFetch: complet ? new Date(maintenant).toISOString() : cache.dateFetch,
    motsCles: motsCles
  };
  const erreurEcriture = inchange ? null : ecrireCacheMotsCles(neuf);
  return {
    fait: true, complet: complet && !erreurEcriture,
    erreur: derniereErreur || erreurEcriture || null,
    dateFetch: neuf.dateFetch, nombre: motsCles.length
  };
}

module.exports = {
  ENDPOINT_EDUDOC_DEFAUT, SETS_EDUDOC_DEFAUT, JOURS_FRAICHEUR, PAGES_MAX,
  cheminCacheMotsCles,
  extraireRecordsMotsCles, recordsEnMotsCles, fusionnerMotsCles,
  lireCacheMotsCles, ecrireCacheMotsCles, cacheFraisMotsCles,
  configEdudoc, recupererAvecRepli, moissonnerMotsCles, rafraichirMotsCles
};
