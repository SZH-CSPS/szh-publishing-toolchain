// Client de l'API Mistral, sans dépendance. La clé ne figure que dans l'en-tête
// Authorization, ni dans les erreurs ni dans les journaux.
'use strict';

const https = require('https');
const http = require('http');

const BASE = 'https://api.mistral.ai';
const ESSAIS = 4;
const DELAI_MAX_MS = 60000;
const DELAI_REQUETE_MS = 120000;

// code : cle-refusee (401, 403), quota-nul (429 d'un modèle fermé à cette clé), quota (429
// après les essais), http (autre statut), reseau, reponse (corps illisible).
class ErreurMistral extends Error {
  constructor(code, statut) {
    super('mistral : ' + code + (statut ? ' (' + statut + ')' : ''));
    this.code = code;
    this.statut = statut || 0;
  }
}

// http n'est permis que vers la machine elle-même (le faux serveur des tests), pour que la
// clé ne circule pas en clair.
function transportPour(url) {
  if (url.protocol === 'https:') { return https; }
  if (url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')) { return http; }
  throw new ErreurMistral('reseau');
}

function envoyer(base, cle, methode, chemin, corps, delaiRequete) {
  const url = new URL(chemin, base);
  const transport = transportPour(url);
  const donnees = corps === undefined ? null : Buffer.from(JSON.stringify(corps), 'utf8');
  const entetes = { Authorization: 'Bearer ' + cle, Accept: 'application/json' };
  if (donnees) { entetes['Content-Type'] = 'application/json'; entetes['Content-Length'] = donnees.length; }
  return new Promise((resoudre, rejeter) => {
    const req = transport.request(url, { method: methode, headers: entetes, timeout: delaiRequete }, (rep) => {
      const morceaux = [];
      rep.on('data', (m) => morceaux.push(m));
      rep.on('end', () => resoudre({ statut: rep.statusCode, entetes: rep.headers, corps: Buffer.concat(morceaux).toString('utf8') }));
      rep.on('error', () => rejeter(new ErreurMistral('reseau')));
    });
    req.on('timeout', () => { req.destroy(); });
    req.on('error', () => rejeter(new ErreurMistral('reseau')));
    if (donnees) { req.write(donnees); }
    req.end();
  });
}

// L'attente avant un nouvel essai sur un 429 : Retry-After s'il est donné, sinon 2, 4, 8 s.
function delaiApres429(entetes, essai) {
  const ra = Number(entetes && entetes['retry-after']);
  const ms = isFinite(ra) && ra >= 0 ? ra * 1000 : 2000 * Math.pow(2, essai);
  return Math.min(ms, DELAI_MAX_MS);
}

// creerClient({ cle, base?, essais?, attendre? }) -> { chat(corps), modeles() }.
// `attendre(ms)` est remplaçable pour que les tests ne dorment pas.
function creerClient(options) {
  const o = options || {};
  const cle = String(o.cle || '');
  const base = o.base || BASE;
  const essais = o.essais || ESSAIS;
  const delaiRequete = o.delaiRequete || DELAI_REQUETE_MS;
  const attendre = o.attendre || ((ms) => new Promise((r) => setTimeout(r, ms)));
  if (!cle) { throw new ErreurMistral('cle-refusee'); }

  async function appeler(methode, chemin, corps) {
    for (let essai = 0; ; essai++) {
      const r = await envoyer(base, cle, methode, chemin, corps, delaiRequete);
      if (r.statut === 401 || r.statut === 403) { throw new ErreurMistral('cle-refusee', r.statut); }
      if (r.statut === 429) {
        // Une limite à zéro ne se lève pas en attendant : le modèle est fermé à cette clé.
        if (String((r.entetes || {})['x-ratelimit-limit-req-minute']) === '0') { throw new ErreurMistral('quota-nul', 429); }
        if (essai + 1 >= essais) { throw new ErreurMistral('quota', 429); }
        await attendre(delaiApres429(r.entetes, essai));
        continue;
      }
      if (r.statut < 200 || r.statut >= 300) { throw new ErreurMistral('http', r.statut); }
      try { return JSON.parse(r.corps); } catch (e) { throw new ErreurMistral('reponse', r.statut); }
    }
  }

  return {
    // chat(corps) -> { texte, jetons } ; corps est celui de /v1/chat/completions.
    async chat(corps) {
      const d = await appeler('POST', '/v1/chat/completions', corps);
      const choix = d && Array.isArray(d.choices) ? d.choices[0] : null;
      const texte = choix && choix.message && typeof choix.message.content === 'string' ? choix.message.content : null;
      if (texte === null) { throw new ErreurMistral('reponse'); }
      const u = (d && d.usage) || {};
      return { texte: texte, jetons: Number(u.total_tokens) || 0 };
    },
    // modeles() -> les identifiants que la clé voit (GET /v1/models).
    async modeles() {
      const d = await appeler('GET', '/v1/models');
      const liste = d && Array.isArray(d.data) ? d.data : [];
      return liste.map((m) => String((m && m.id) || '')).filter(Boolean);
    }
  };
}

module.exports = { creerClient, ErreurMistral, delaiApres429, BASE };
