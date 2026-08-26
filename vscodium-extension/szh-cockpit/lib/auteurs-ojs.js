// La liste des auteur·e·s publiés des deux revues, moissonnée sur l'interface OAI-PMH
// PUBLIQUE d'ojs.szh.ch et gardée dans C:\ProgramData\SZH\auteurs.json. Elle alimente
// l'autocomplétion de la modale d'auteur·e (media/_auteurs.js).
//
// Pourquoi OAI-PMH et pas l'API OJS : pas de credentials sur les postes. La contrepartie
// est assumée (décision du 25.08.2026) : oai_dc n'expose que dc:creator — des NOMS, ni
// email, ni fonction, ni lieu de travail. L'autocomplétion ne préremplit donc que
// prénom + nom. Une clé API OJS pourrait enrichir plus tard.
//
// Endpoints relevés sur l'instance (OJS 3.5.0.4, verbe Identify, 25.08.2026) — le préfixe
// de locale est celui de la redirection 302 qu'OJS impose, et le module https natif ne
// suit pas les redirections tout seul :
//   https://ojs.szh.ch/index.php/revue/fr/oai        Revue suisse de pédagogie spécialisée
//   https://ojs.szh.ch/index.php/zeitschrift/de/oai  Schweizerische Zeitschrift für Heilpädagogik
// Surchargeables par config.json, clé `oai` : soit une liste d'URL, soit
// { "oai": { "endpoints": ["…", "…"] } }.
//
// Le cache est un fichier SÉPARÉ de config.json — modèle state.json — parce que
// config.json est réécrit en entier à chaque réglage : une liste de plusieurs centaines de
// noms n'a rien à y faire. Écriture atomique (OneDrive n'y passe pas, mais la règle du
// dépôt est la même partout). Forme :
//   { "version": 1, "dateFetch": "2026-08-25T12:00:00.000Z",
//     "auteurs": [{ "prenom": "…", "nom": "…", "datePublication": "…" }] }
//
// Rythme : au plus un moissonnage par semaine, incrémental (from = date du dernier fetch).
// Hors ligne = normal : l'échec est silencieux pour le rédacteur, seule une trace console
// reste (posée par l'appelant, extension.js). dateFetch n'avance que si les DEUX revues
// ont répondu : sinon on réessaie à l'activation suivante, la fusion étant idempotente.
//
// SZH_AUTEURS_CACHE impose un autre fichier de cache : les harnais de test s'en servent,
// comme SZH_CONFIG_OJS pour lib/export-ojs.js — aucun test ne touche C:\ProgramData, et
// aucun ne fait de réseau (le moissonnage prend son `recuperer` en paramètre).
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { URL } = require('url');
const { ecrireAtomique } = require('./yaml');
const { BASE_SZH, lireConfigPoste } = require('./archivage');

const ENDPOINTS_OAI_DEFAUT = [
  'https://ojs.szh.ch/index.php/revue/fr/oai',
  'https://ojs.szh.ch/index.php/zeitschrift/de/oai'
];

const JOURS_FRAICHEUR = 7;                 // « au plus une fois par semaine »
const DELAI_REQUETE_MS = 10000;            // inactivité socket
// Délai TOTAL par requête, en plus de l'inactivité : un serveur qui égoutte un octet
// toutes les neuf secondes ne déclenche jamais le timeout socket et retiendrait la
// requête indéfiniment.
const DELAI_TOTAL_MS = 60000;
// Borne dure sur la taille d'une réponse : une page OAI réelle pèse ~300 Ko (100 records).
// Au-delà de 20 Mo, ce n'est plus une réponse OAI mais un robinet ouvert — on coupe.
const OCTETS_MAX_REPONSE = 20 * 1024 * 1024;
const REDIRECTIONS_MAX = 3;
// Garde anti-boucle du suivi des resumptionToken. L'instance porte ~350 records par revue
// et 100 par page : cent pages laissent un ordre de grandeur de marge.
const PAGES_MAX = 100;

function cheminCacheAuteurs() {
  const impose = String(process.env.SZH_AUTEURS_CACHE || '').trim();
  return impose !== '' ? impose : path.join(BASE_SZH, 'auteurs.json');
}

// ---- Parseur XML minimal, ciblé OAI-PMH ------------------------------------------
//
// Pas de dépendance : on n'extrait que ce que le moissonnage lit — datestamp, statut
// deleted, dc:creator, resumptionToken, <error>. Tolérant : CDATA, entités, espaces,
// attributs inattendus ; un XML tronqué ou hostile rend simplement moins de records,
// jamais une exception.

function decoderTexteXml(brut) {
  let t = String(brut === undefined || brut === null ? '' : brut);
  t = t.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  t = t.replace(/&#x([0-9a-fA-F]+);/g, (m, h) => {
    const code = parseInt(h, 16);
    return isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : '';
  });
  t = t.replace(/&#(\d+);/g, (m, d) => {
    const code = parseInt(d, 10);
    return isFinite(code) && code > 0 && code <= 0x10FFFF ? String.fromCodePoint(code) : '';
  });
  // &amp; en dernier : « &amp;#65; » doit rendre « &#65; », pas « A ».
  return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

// Les records d'une réponse ListRecords : [{ datestamp, deleted, creators: [texte] }].
function extraireRecords(xml) {
  const records = [];
  const source = String(xml === undefined || xml === null ? '' : xml);
  for (const bloc of source.matchAll(/<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/g)) {
    const corps = bloc[1];
    const deleted = /<header[^>]*\bstatus\s*=\s*["']deleted["']/.test(corps);
    const date = corps.match(/<datestamp(?:\s[^>]*)?>([\s\S]*?)<\/datestamp>/);
    const creators = [];
    for (const c of corps.matchAll(/<dc:creator(?:\s[^>]*)?>([\s\S]*?)<\/dc:creator>/g)) {
      creators.push(decoderTexteXml(c[1]).replace(/\s+/g, ' ').trim());
    }
    records.push({
      datestamp: date ? decoderTexteXml(date[1]).trim() : '',
      deleted: deleted,
      creators: creators
    });
  }
  return records;
}

// Le resumptionToken d'une réponse : '' quand il n'y en a pas, ou qu'il est vide —
// les deux veulent dire « dernière page ». OJS l'écrit avec des attributs sur plusieurs
// lignes (expirationDate, completeListSize, cursor).
function extraireResumptionToken(xml) {
  const m = String(xml === undefined || xml === null ? '' : xml)
    .match(/<resumptionToken(?:\s[^>]*)?>([\s\S]*?)<\/resumptionToken>/);
  if (!m) { return ''; }
  return decoderTexteXml(m[1]).trim();
}

// L'erreur OAI d'une réponse, ou null. noRecordsMatch n'est pas une panne : c'est la
// réponse normale d'un moissonnage incrémental qui n'a rien de neuf.
function erreurOai(xml) {
  const m = String(xml === undefined || xml === null ? '' : xml)
    .match(/<error\s[^>]*\bcode\s*=\s*["']([^"']*)["'][^>]*(?:\/>|>([\s\S]*?)<\/error>)/);
  if (!m) { return null; }
  return { code: m[1], message: decoderTexteXml(m[2] || '').replace(/\s+/g, ' ').trim() };
}

// ---- Normalisation et déduplication ----------------------------------------------

// « Nom, Prénom » — la forme qu'OJS écrit dans dc:creator. Sans virgule, deviner
// « dernier mot = nom » se tromperait sur les particules et les noms composés
// (« Wood de Wilde », « von Arx ») : tout part dans `nom`, prénom vide — assumé et
// suffisant pour une suggestion qu'on peut corriger d'une frappe.
function normaliserCreator(brut) {
  const plein = String(brut === undefined || brut === null ? '' : brut)
    .replace(/\s+/g, ' ').trim();
  if (plein === '') { return null; }
  const virgule = plein.indexOf(',');
  if (virgule === -1) { return { prenom: '', nom: plein }; }
  const nom = plein.slice(0, virgule).trim();
  const prenom = plein.slice(virgule + 1).trim();
  if (nom === '' && prenom === '') { return null; }
  return { prenom: prenom, nom: nom };
}

// Casse et accents pliés, espaces réduits : « MORAND, Robin » et « Mörand, robin »
// tombent sur la même clé.
function plierNom(texte) {
  let t = String(texte === undefined || texte === null ? '' : texte)
    .toLowerCase().replace(/\s+/g, ' ').trim();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  catch (e) { /* moteur sans normalize : dédup sensible aux accents, sans casser */ }
  return t;
}

function cleAuteur(auteur) {
  return plierNom((auteur || {}).nom) + '|' + plierNom((auteur || {}).prenom);
}

// Les records d'un moissonnage aplatis en entrées d'auteur·e·s. Les records deleted sont
// ignorés — jamais de suppression côté cache, un nom publié un jour reste proposé.
function recordsEnAuteurs(records) {
  const auteurs = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || r.deleted) { continue; }
    for (const brut of Array.isArray(r.creators) ? r.creators : []) {
      const n = normaliserCreator(brut);
      if (n) { auteurs.push({ prenom: n.prenom, nom: n.nom, datePublication: String(r.datestamp || '') }); }
    }
  }
  return auteurs;
}

// Fusion incrémentale : les nouveaux venus s'ajoutent ; une clé déjà connue dont
// l'occurrence porte un datestamp plus récent met à jour la date ET la graphie du nom
// (règle actée : « conserver la plus récente » s'applique au nom). Jamais de suppression.
// Les datestamps OAI sont ISO 8601 : la comparaison textuelle suffit, et une date vide
// perd toujours.
function fusionnerAuteurs(existants, nouveaux) {
  const parCle = new Map();
  const sortie = [];
  const poser = (a) => {
    const entree = {
      prenom: String((a || {}).prenom || '').trim(),
      nom: String((a || {}).nom || '').trim(),
      datePublication: String((a || {}).datePublication || '')
    };
    if (entree.prenom === '' && entree.nom === '') { return; }
    const cle = cleAuteur(entree);
    const connue = parCle.get(cle);
    if (!connue) {
      parCle.set(cle, entree);
      sortie.push(entree);
      return;
    }
    if (entree.datePublication > connue.datePublication) {
      connue.prenom = entree.prenom;
      connue.nom = entree.nom;
      connue.datePublication = entree.datePublication;
    }
  };
  for (const a of Array.isArray(existants) ? existants : []) { poser(a); }
  for (const a of Array.isArray(nouveaux) ? nouveaux : []) { poser(a); }
  return sortie;
}

// ---- Cache C:\ProgramData\SZH\auteurs.json ----------------------------------------

function cacheVide() {
  return { version: 1, dateFetch: null, auteurs: [] };
}

// Lecture tolérante : fichier absent, JSON corrompu, BOM, forme inattendue — tout retombe
// sur le cache vide, l'autocomplétion n'a alors rien à proposer et le prochain moissonnage
// repart de zéro.
function lireCache() {
  let brut;
  try {
    brut = JSON.parse(String(fs.readFileSync(cheminCacheAuteurs(), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (e) { return cacheVide(); }
  if (!brut || typeof brut !== 'object' || !Array.isArray(brut.auteurs)) { return cacheVide(); }
  return {
    version: 1,
    dateFetch: typeof brut.dateFetch === 'string' && brut.dateFetch !== '' ? brut.dateFetch : null,
    // La fusion re-déduplique et écarte les entrées sans nom : un cache retouché à la
    // main ne casse rien.
    auteurs: fusionnerAuteurs(brut.auteurs, [])
  };
}

function ecrireCache(cache) {
  try {
    const c = cache && typeof cache === 'object' ? cache : cacheVide();
    fs.mkdirSync(path.dirname(cheminCacheAuteurs()), { recursive: true });
    ecrireAtomique(cheminCacheAuteurs(), JSON.stringify({
      version: 1,
      dateFetch: typeof c.dateFetch === 'string' ? c.dateFetch : null,
      auteurs: Array.isArray(c.auteurs) ? c.auteurs : []
    }, null, 2) + '\n');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Frais = moins de sept jours. Une dateFetch dans le futur (horloge repassée en arrière)
// compte comme périmée : le cache se répare tout seul au prochain moissonnage.
function cacheFrais(cache, maintenant) {
  if (!cache || !cache.dateFetch) { return false; }
  const t = Date.parse(cache.dateFetch);
  if (!isFinite(t)) { return false; }
  const age = (maintenant === undefined ? Date.now() : maintenant) - t;
  return age >= 0 && age < JOURS_FRAICHEUR * 24 * 3600 * 1000;
}

// ---- Endpoints -------------------------------------------------------------------

// Pure — la config lui est passée — pour être éprouvable sans lire C:\ProgramData.
// N'accepte que du https : un endpoint http recopié de travers retomberait en clair.
function endpointsOai(cfg) {
  const brut = cfg && cfg.oai;
  const liste = Array.isArray(brut) ? brut
    : (brut && typeof brut === 'object' && Array.isArray(brut.endpoints) ? brut.endpoints : null);
  if (!liste) { return ENDPOINTS_OAI_DEFAUT.slice(); }
  const propres = liste
    .map((u) => String(u === undefined || u === null ? '' : u).trim())
    .filter((u) => /^https:\/\//i.test(u));
  return propres.length > 0 ? propres : ENDPOINTS_OAI_DEFAUT.slice();
}

// ---- Réseau ------------------------------------------------------------------------

// Une redirection n'est suivie que vers le MÊME hôte, en https : OJS ne redirige que vers
// son préfixe de locale (« /revue/oai » -> « /revue/fr/oai »). Une 3xx vers un domaine
// tiers — proxy captif, détournement DNS — est refusée net : nos requêtes suivantes n'ont
// rien à aller y porter. Pure, pour être éprouvable sans réseau.
function resoudreRedirection(urlCourante, location) {
  let depart;
  let cible;
  try { depart = new URL(urlCourante); }
  catch (e) { throw new Error('URL illisible : ' + urlCourante); }
  try { cible = new URL(location, depart); }
  catch (e) { throw new Error('redirection illisible depuis ' + urlCourante); }
  if (cible.hostname !== depart.hostname) {
    throw new Error('redirection hors hôte refusée : ' + depart.hostname + ' -> ' + cible.hostname);
  }
  if (cible.protocol !== 'https:') {
    throw new Error('redirection hors https refusée : ' + cible.protocol + '//' + cible.hostname);
  }
  return cible.toString();
}

// GET https natif : User-Agent posé, et les redirections suivies à la main — OJS répond
// 302 vers l'URL à préfixe de locale, et https.get s'arrêterait là. Trois gardes contre un
// serveur détourné ou malade : redirections même-hôte seulement (resoudreRedirection),
// réponse bornée à OCTETS_MAX_REPONSE, et délai TOTAL par requête en plus du timeout
// d'inactivité. `options` est réservé aux tests : { transport, delaiTotalMs } — le
// transport factice y rejoue les trois pannes sans réseau ni attente réelle.
function recupererHttps(url, redirections, options) {
  const o = options || {};
  const transport = o.transport || ((u, opts, cb) => https.get(u, opts, cb));
  const delaiTotal = o.delaiTotalMs === undefined ? DELAI_TOTAL_MS : o.delaiTotalMs;
  return new Promise((resolve, reject) => {
    let req = null;
    let minuteur = null;
    // Toute issue passe par ici : le minuteur du délai total ne survit jamais à la requête.
    const finir = (fn, valeur) => {
      if (minuteur) { clearTimeout(minuteur); minuteur = null; }
      fn(valeur);
    };
    try {
      req = transport(url, {
        headers: { 'User-Agent': 'SZH-Publishing', 'Accept': 'text/xml, application/xml' },
        timeout: DELAI_REQUETE_MS
      }, (res) => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if ((redirections || 0) >= REDIRECTIONS_MAX) {
            finir(reject, new Error('trop de redirections : ' + url));
            return;
          }
          let suivante;
          try { suivante = resoudreRedirection(url, res.headers.location); }
          catch (e) { finir(reject, e); return; }
          // Chaque saut repart avec son propre délai total : les options suivent.
          finir(resolve, recupererHttps(suivante, (redirections || 0) + 1, options));
          return;
        }
        if (code !== 200) {
          res.resume();
          finir(reject, new Error('HTTP ' + code + ' : ' + url));
          return;
        }
        const morceaux = [];
        let total = 0;
        res.on('data', (m) => {
          total += m.length;
          if (total > OCTETS_MAX_REPONSE) {
            // Réponse démesurée : on coupe la connexion, on ne garde rien.
            finir(reject, new Error('réponse trop volumineuse (plus de ' +
              OCTETS_MAX_REPONSE + ' octets) : ' + url));
            try { req.destroy(); } catch (e) { /* déjà fermée */ }
            return;
          }
          morceaux.push(m);
        });
        res.on('end', () => { finir(resolve, Buffer.concat(morceaux).toString('utf8')); });
        res.on('error', (e) => { finir(reject, e); });
      });
    } catch (e) { finir(reject, e); return; }
    minuteur = setTimeout(() => {
      minuteur = null;
      reject(new Error('délai total dépassé (' + delaiTotal + ' ms) : ' + url));
      try { req.destroy(); } catch (e) { /* déjà fermée */ }
    }, delaiTotal);
    // Pas d'unref() ici : un minuteur qui ne retient pas la boucle d'événements peut ne
    // jamais tirer dans un processus au repos, et la promesse resterait pendante à vie.
    // Il est nettoyé par finir() à chaque issue — il ne retient donc jamais plus que la
    // requête en cours.
    req.on('timeout', () => { req.destroy(new Error('délai dépassé (inactivité) : ' + url)); });
    req.on('error', (e) => { finir(reject, e); });
  });
}

// ListRecords oai_dc sur un endpoint, resumptionToken suivis jusqu'au bout. `recuperer`
// est injecté — recupererHttps en vrai, une table de fixtures dans les tests. `from` au
// format YYYY-MM-DD rend le moissonnage incrémental. Deux gardes anti-infini : un token
// déjà vu, et un plafond de pages.
async function moissonner(recuperer, base, from) {
  const records = [];
  const jonction = base.indexOf('?') === -1 ? '?' : '&';
  let url = base + jonction + 'verb=ListRecords&metadataPrefix=oai_dc' +
    (from ? '&from=' + encodeURIComponent(from) : '');
  const tokensVus = new Set();
  for (let page = 0; page < PAGES_MAX; page++) {
    const xml = await recuperer(url);
    const erreur = erreurOai(xml);
    if (erreur) {
      if (erreur.code === 'noRecordsMatch') { return records; }   // rien de neuf : normal
      throw new Error('OAI ' + erreur.code + ' sur ' + base +
        (erreur.message ? ' : ' + erreur.message : ''));
    }
    for (const r of extraireRecords(xml)) { records.push(r); }
    const token = extraireResumptionToken(xml);
    if (token === '') { return records; }
    if (tokensVus.has(token)) { throw new Error('resumptionToken répété sur ' + base); }
    tokensVus.add(token);
    url = base + jonction + 'verb=ListRecords&resumptionToken=' + encodeURIComponent(token);
  }
  throw new Error('pagination OAI interrompue après ' + PAGES_MAX + ' pages sur ' + base);
}

// ---- Rafraîchissement --------------------------------------------------------------
//
// Ce que l'activation de l'extension appelle en tâche de fond. Rend toujours une valeur,
// ne lève jamais vers l'appelant autre chose qu'une panne de programmation :
//   { fait: false, raison: 'frais', … }          cache de moins de sept jours, aucun appel
//   { fait: true, complet: true, … }             les deux revues ont répondu, dateFetch avancée
//   { fait: true, complet: false, erreur, … }    au moins une revue muette (hors ligne ?) :
//                                                ce qui a répondu est fusionné, dateFetch
//                                                inchangée, on réessaiera
// `opts` est réservé aux tests : { maintenant, recuperer, forcer, config }.
async function rafraichir(opts) {
  const o = opts || {};
  const maintenant = o.maintenant === undefined ? Date.now() : o.maintenant;
  const cache = lireCache();
  if (!o.forcer && cacheFrais(cache, maintenant)) {
    return { fait: false, raison: 'frais', dateFetch: cache.dateFetch, nombre: cache.auteurs.length };
  }
  const recuperer = o.recuperer || recupererHttps;
  const from = cache.dateFetch ? String(cache.dateFetch).slice(0, 10) : null;
  const endpoints = endpointsOai(o.config === undefined ? lireConfigPoste() : o.config);
  let auteurs = cache.auteurs;
  let complet = true;
  let derniereErreur = null;
  for (const base of endpoints) {
    try {
      const records = await moissonner(recuperer, base, from);
      auteurs = fusionnerAuteurs(auteurs, recordsEnAuteurs(records));
    } catch (e) {
      complet = false;
      derniereErreur = String((e && e.message) || e);
    }
  }
  // Hors ligne complet : rien de neuf et rien à réécrire — le fichier reste tel quel.
  const inchange = !complet && JSON.stringify(auteurs) === JSON.stringify(cache.auteurs);
  const neuf = {
    version: 1,
    dateFetch: complet ? new Date(maintenant).toISOString() : cache.dateFetch,
    auteurs: auteurs
  };
  const erreurEcriture = inchange ? null : ecrireCache(neuf);
  return {
    fait: true, complet: complet && !erreurEcriture,
    erreur: derniereErreur || erreurEcriture || null,
    dateFetch: neuf.dateFetch, nombre: auteurs.length
  };
}

module.exports = {
  ENDPOINTS_OAI_DEFAUT, JOURS_FRAICHEUR, OCTETS_MAX_REPONSE, DELAI_TOTAL_MS,
  cheminCacheAuteurs,
  decoderTexteXml, extraireRecords, extraireResumptionToken, erreurOai,
  normaliserCreator, plierNom, cleAuteur, recordsEnAuteurs, fusionnerAuteurs,
  lireCache, ecrireCache, cacheFrais,
  endpointsOai, resoudreRedirection, recupererHttps, moissonner, rafraichir
};
