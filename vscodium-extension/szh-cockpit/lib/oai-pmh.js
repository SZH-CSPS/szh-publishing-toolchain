// Client HTTP et parseur OAI-PMH communs aux deux moissonneurs du cockpit : lib/auteurs-ojs.js
// (auteur·e·s publiés, ojs.szh.ch) et lib/mots-cles-edudoc.js (descripteurs bilingues,
// edudoc.ch). Extrait le 01.09.2026 : lib/mots-cles-edudoc.js importait ce qui suit
// directement depuis lib/auteurs-ojs.js, qui n'a pourtant pas vocation à servir de
// bibliothèque à son voisin — deux agents l'ont signalé indépendamment. Ce que les deux
// moissonneurs partagent vraiment vit ici : le client https qui suit les redirections
// OAI-PMH, le parseur XML minimal (resumptionToken, <error>, entités), le pliage de chaîne
// pour comparer deux libellés, et le repli sur un 503 « Retry after » — constaté sur
// edudoc.ch le 31.08.2026, et qu'ojs.szh.ch pourrait très bien montrer un jour lui aussi.
//
// Ce qui N'EST PAS ici, parce que propre à chaque instance : les endpoints et les sets, le
// format des enregistrements (dc:creator / marcxml $u côté OJS, champ MARC 690 côté
// edudoc), la boucle de pagination elle-même (l'URL et l'extracteur de records diffèrent
// d'un moissonneur à l'autre), la forme du cache et les règles de fusion — tout cela reste
// dans le moissonneur qui le connaît.
//
// Point de passage UNIQUE vers un vrai socket https dans tout le cockpit : recupererHttps.
// La garde SZH_RESEAU_INTERDIT vit ici, à cet unique endroit, pour couvrir d'un seul geste
// les deux moissonneurs actuels et tout futur module qui s'y brancherait. Elle ne se
// déclenche que si AUCUN transport factice n'est fourni — un test qui injecte le sien pour
// éprouver recupererHttps elle-même (redirections, taille, délais) n'est pas concerné,
// puisqu'il ne touche jamais le réseau. `test/js/hote-factice.js` pose cette variable pour
// tous les tests qui activent l'extension : un appel réel échoue alors tout de suite, fort
// et clair, au lieu de partir en silence vers ojs.szh.ch ou edudoc.ch.
'use strict';

const https = require('https');
const { URL } = require('url');

const DELAI_REQUETE_MS = 10000;            // inactivité socket
// Délai TOTAL par requête, en plus de l'inactivité : un serveur qui égoutte un octet
// toutes les neuf secondes ne déclenche jamais le timeout socket et retiendrait la
// requête indéfiniment.
const DELAI_TOTAL_MS = 60000;
// Borne dure sur la taille d'une réponse : une page OAI réelle pèse ~300 Ko (100 records).
// Au-delà de 20 Mo, ce n'est plus une réponse OAI mais un robinet ouvert — on coupe.
const OCTETS_MAX_REPONSE = 20 * 1024 * 1024;
const REDIRECTIONS_MAX = 3;
// Délais de repli sur un 503 « Retry after » (voir l'en-tête ci-dessus) : trois essais,
// croissants. Overridable par les tests (options.delaisRepliMs) pour ne pas attendre 7 s
// par cas.
const DELAIS_REPLI_503 = [1000, 2000, 4000];

// ---- Parseur XML minimal, ciblé OAI-PMH ------------------------------------------
//
// Pas de dépendance : chaque moissonneur n'en tire que ce qu'il lit lui-même (records,
// dc:creator ou champ 690, resumptionToken, <error>) via ses propres expressions
// régulières — seuls le décodage d'entités/CDATA, le resumptionToken et l'erreur OAI sont
// assez génériques pour vivre ici. Tolérant : un XML tronqué ou hostile rend simplement
// moins de records, jamais une exception.

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

// Le resumptionToken d'une réponse : '' quand il n'y en a pas, ou qu'il est vide —
// les deux veulent dire « dernière page ». OJS l'écrit avec des attributs sur plusieurs
// lignes (expirationDate, completeListSize, cursor) ; edudoc.ch aussi.
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

// ---- Pliage de chaîne, pour comparaison --------------------------------------------

// Casse et accents pliés, espaces réduits : « MORAND, Robin » et « Mörand, robin »
// tombent sur la même clé. Sert à dédupliquer aussi bien un nom d'auteur·e
// (lib/auteurs-ojs.js) qu'un libellé de descripteur edudoc (lib/mots-cles-edudoc.js, sous
// l'alias plierTexte) : le corps ne fait rien de spécifique à un nom de personne.
function plierNom(texte) {
  let t = String(texte === undefined || texte === null ? '' : texte)
    .toLowerCase().replace(/\s+/g, ' ').trim();
  try { t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  catch (e) { /* moteur sans normalize : dédup sensible aux accents, sans casser */ }
  return t;
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
//
// Point de passage UNIQUE vers un vrai socket https dans tout le cockpit — voir l'en-tête
// du fichier pour la garde SZH_RESEAU_INTERDIT posée juste ici.
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
    // Toute issue passe par ici : le minuteur du délai total ne survit jamais à la requête.
    const finir = (fn, valeur) => {
      if (minuteur) { clearTimeout(minuteur); minuteur = null; }
      fn(valeur);
    };
    try {
      req = transport(url, {
        // JSON compris dans l'Accept : le même transport sert l'OAI, qui rend du XML, et
        // l'API ROR, qui rend du JSON et répondait 406 à un Accept purement XML. Aucun test
        // ne pouvait le voir — ils injectent tous un `recuperer` factice — et les 45
        // institutions restaient sans libellé, en silence.
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

// ---- Repli sur un 503 « Retry after » -----------------------------------------------
//
// Constaté en conditions réelles sur edudoc.ch le 31.08.2026, au milieu d'un moissonnage
// complet des deux sets — passé une poignée de requêtes rapprochées, l'instance répond
// « 503 Retry after 1 seconds » puis se rétablit d'elle-même à la requête suivante.
// ojs.szh.ch n'a pas montré cette tolérance en un an d'usage, mais rien ne garantit qu'elle
// ne se comporte pas un jour de même : le repli vit ici plutôt que dans un seul des deux
// moissonneurs.
function attendre(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// `options` suit recupererHttps (transport, delaiTotalMs) ; `delaisRepliMs` s'y ajoute pour
// les tests, qui n'ont aucune raison d'attendre 1 à 4 secondes par cas.
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
