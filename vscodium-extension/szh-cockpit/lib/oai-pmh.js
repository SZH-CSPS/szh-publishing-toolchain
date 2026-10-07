// Client HTTP et analyse OAI-PMH communs à lib/auteurs-ojs.js (ojs.szh.ch) et
// lib/mots-cles-edudoc.js (edudoc.ch) : client https qui suit les redirections, lecture
// minimale du XML (resumptionToken, <error>, entités), pliage de chaîne pour comparer deux
// libellés, et repli sur un 503 « Retry after ». Les endpoints, le format des
// enregistrements, la pagination et le cache restent dans chaque moissonneur.
//
// recupererHttps est le seul accès réseau https du cockpit. Quand SZH_RESEAU_INTERDIT est
// posée (par test/js/hote-factice.js) et qu'aucun transport factice n'est fourni, un appel
// réel échoue aussitôt.
'use strict';

const https = require('https');
const { URL } = require('url');

const DELAI_REQUETE_MS = 10000;            // inactivité socket
// Délai total par requête, en plus de l'inactivité : un serveur qui envoie un octet toutes
// les neuf secondes ne déclencherait jamais le délai d'inactivité.
const DELAI_TOTAL_MS = 60000;
// Taille maximale d'une réponse. Une page OAI réelle pèse environ 300 Ko (100 records).
const OCTETS_MAX_REPONSE = 20 * 1024 * 1024;
const REDIRECTIONS_MAX = 3;
// Délais de repli sur un 503 « Retry after » : trois essais, croissants. Les tests les
// remplacent par options.delaisRepliMs.
const DELAIS_REPLI_503 = [1000, 2000, 4000];

// ---- Parseur XML minimal, ciblé OAI-PMH ------------------------------------------
//
// Sans dépendance. Chaque moissonneur extrait ses records avec ses propres expressions
// régulières ; ici, seulement le décodage des entités et CDATA, le resumptionToken et
// l'erreur OAI. Un XML tronqué ou malformé ne lève pas d'exception.

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

// Le resumptionToken d'une réponse, ou '' sur la dernière page (absent ou vide). La
// balise peut porter des attributs sur plusieurs lignes.
function extraireResumptionToken(xml) {
  const m = String(xml === undefined || xml === null ? '' : xml)
    .match(/<resumptionToken(?:\s[^>]*)?>([\s\S]*?)<\/resumptionToken>/);
  if (!m) { return ''; }
  return decoderTexteXml(m[1]).trim();
}

// L'erreur OAI d'une réponse, ou null. noRecordsMatch signifie seulement qu'il n'y a rien
// de neuf.
function erreurOai(xml) {
  const m = String(xml === undefined || xml === null ? '' : xml)
    .match(/<error\s[^>]*\bcode\s*=\s*["']([^"']*)["'][^>]*(?:\/>|>([\s\S]*?)<\/error>)/);
  if (!m) { return null; }
  return { code: m[1], message: decoderTexteXml(m[2] || '').replace(/\s+/g, ' ').trim() };
}

// ---- Pliage de chaîne, pour comparaison --------------------------------------------

// Casse et accents pliés, espaces réduits : « MORAND, Robin » et « Mörand, robin » donnent
// la même clé. Sert aux noms d'auteur·e·s comme aux descripteurs edudoc (alias plierTexte).
function plierNom(texte) {
  let t = String(texte === undefined || texte === null ? '' : texte)
    .toLowerCase().replace(/\s+/g, ' ').trim();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  catch (e) { /* moteur sans normalize : dédup sensible aux accents, sans casser */ }
  return t;
}

// ---- Réseau ------------------------------------------------------------------------

// Une redirection n'est suivie que vers le même hôte, en https. OJS redirige vers son
// préfixe de locale (« /revue/oai » -> « /revue/fr/oai ») ; une redirection vers un autre
// domaine (portail captif, détournement DNS) est refusée.
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

// GET https avec User-Agent. Les redirections sont suivies ici, car https.get s'arrête au
// 302 d'OJS. Trois gardes : redirections vers le même hôte seulement (resoudreRedirection),
// réponse bornée à OCTETS_MAX_REPONSE, délai total en plus du délai d'inactivité.
// `options` sert aux tests : { transport, delaiTotalMs }. Voir l'en-tête pour
// SZH_RESEAU_INTERDIT.
function recupererHttps(url, redirections, options) {
  const o = options || {};
  if (!o.transport && process.env.SZH_RESEAU_INTERDIT) {
    return Promise.reject(new Error(
      'accès réseau réel bloqué en test (SZH_RESEAU_INTERDIT) : ' + url +
      ' — un `recuperer` ou un `transport` factice doit être injecté'));
  }
  const transport = o.transport || ((u, opts, cb) => https.get(u, opts, cb));
  const delaiTotal = o.delaiTotalMs === undefined ? DELAI_TOTAL_MS : o.delaiTotalMs;
  return new Promise((resolve, reject) => {
    let req = null;
    let minuteur = null;
    // Toute issue passe par ici, qui arrête le minuteur du délai total.
    const finir = (fn, valeur) => {
      if (minuteur) { clearTimeout(minuteur); minuteur = null; }
      fn(valeur);
    };
    try {
      req = transport(url, {
        // JSON dans l'Accept : le même client sert aussi l'API ROR, qui répond 406 à un
        // Accept limité au XML.
        headers: {
          'User-Agent': 'SZH-Publishing',
          'Accept': 'text/xml, application/xml, application/json'
        },
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
          // Chaque redirection repart avec son propre délai total.
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
            // Réponse trop grosse : connexion coupée, rien n'est gardé.
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
    // Pas d'unref() : dans un processus au repos, le minuteur pourrait ne jamais se
    // déclencher et la promesse resterait pendante. finir() l'arrête à chaque issue.
    req.on('timeout', () => { req.destroy(new Error('délai dépassé (inactivité) : ' + url)); });
    req.on('error', (e) => { finir(reject, e); });
  });
}

// ---- Repli sur un 503 « Retry after » -----------------------------------------------
//
// Après quelques requêtes rapprochées, edudoc.ch peut répondre « 503 Retry after 1
// seconds », puis répondre normalement à la requête suivante.
function attendre(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// `options` suit recupererHttps (transport, delaiTotalMs), plus `delaisRepliMs` pour les
// tests.
async function recupererAvecRepli(url, options) {
  const o = options || {};
  const delais = Array.isArray(o.delaisRepliMs) ? o.delaisRepliMs : DELAIS_REPLI_503;
  for (let essai = 0; ; essai++) {
    try {
      return await recupererHttps(url, 0, o);
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/^HTTP 503\b/.test(msg) && essai < delais.length) {
        await attendre(delais[essai]);
        continue;
      }
      throw e;
    }
  }
}

module.exports = {
  DELAI_REQUETE_MS, DELAI_TOTAL_MS, OCTETS_MAX_REPONSE, REDIRECTIONS_MAX, DELAIS_REPLI_503,
  decoderTexteXml, extraireResumptionToken, erreurOai, plierNom,
  resoudreRedirection, recupererHttps, recupererAvecRepli
};
