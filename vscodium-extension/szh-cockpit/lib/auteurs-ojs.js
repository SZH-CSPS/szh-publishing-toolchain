// La liste des auteur·e·s publiés des deux revues, moissonnée sur l'interface OAI-PMH
// publique d'ojs.szh.ch et gardée dans C:\ProgramData\SZH\auteurs.json. Elle alimente
// l'autocomplétion de la modale d'auteur·e (media/_auteurs.js).
//
// Formats OAI supportés : oai_dc (noms seulement), marcxml (ajoute affiliations et ROR).
//
// Endpoints de l'instance (OJS 3.5). Ils portent le préfixe de locale vers lequel OJS
// redirige (302), car le module https natif ne suit pas les redirections :
//   https://ojs.szh.ch/index.php/revue/fr/oai        Revue suisse de pédagogie spécialisée
//   https://ojs.szh.ch/index.php/zeitschrift/de/oai  Schweizerische Zeitschrift für Heilpädagogik
// Surchargeables par config.json, clé `oai` : soit une liste d'URL, soit
// { "oai": { "endpoints": ["…", "…"] } }.
//
// Le cache est un fichier à part, car config.json est réécrit en entier à chaque réglage.
// Forme v2 :
//   { "version": 2, "dateFetch": "2026-08-25T12:00:00.000Z", "dateCorpus": null,
//     "ror": { "01swzsf04": { "fr": "…", "de": "…", "en": "…" } },
//     "vus": { "<chemin>": timestamp }, "auteurs": [...] }
// v1 migre vers v2 en mettant dateFetch à null (moissonnage complet demandé).
//
// Rythme : au plus une fois par mois (dateFetch), en incrémental (from = date du dernier
// moissonnage). Hors ligne, l'échec est silencieux. dateFetch n'avance que si les deux
// revues ont répondu ; sinon le moissonnage se refait, la fusion étant idempotente. Un
// échec ROR n'empêche pas dateFetch d'avancer : les libellés seront repris plus tard.
//
// SZH_AUTEURS_CACHE impose un autre fichier de cache, pour les tests. Le moissonnage et ROR
// reçoivent leur fonction `recuperer` en paramètre : les tests ne font pas de réseau.
//
// Le client https, le parseur XML minimal et plierNom viennent de lib/oai-pmh.js, partagé
// avec lib/mots-cles-edudoc.js, et sont réexportés ici.
'use strict';

const fs = require('fs');
const path = require('path');
const { ecrireAtomique } = require('./yaml');
const { BASE_SZH, lireConfigPoste } = require('./archivage');
const {
  DELAI_TOTAL_MS, OCTETS_MAX_REPONSE,
  decoderTexteXml, extraireResumptionToken, erreurOai, plierNom,
  resoudreRedirection, recupererHttps, recupererAvecRepli
} = require('./oai-pmh');

const { urlJournal } = require('./ojs-adresses');

const ENDPOINTS_OAI_DEFAUT = [
  urlJournal('fr') + '/fr/oai',
  urlJournal('de') + '/de/oai'
];

const JOURS_FRAICHEUR = 30;                // « une fois par mois »
// Plafond de pages suivies par resumptionToken, contre une boucle. L'instance a environ
// 350 records par revue, 100 par page.
const PAGES_MAX = 100;

function cheminCacheAuteurs() {
  const impose = String(process.env.SZH_AUTEURS_CACHE || '').trim();
  return impose !== '' ? impose : path.join(BASE_SZH, 'auteurs.json');
}

// ---- Parseur, spécifique OJS -------------------------------------------------------
//
// Lit le format propre à OJS : datestamp, statut deleted, auteurs. Un XML tronqué ou
// hostile rend moins de records, sans exception.

// Les records d'une réponse ListRecords oai_dc : [{ datestamp, deleted, creators: [texte] }].
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

// Les records d'une réponse ListRecords marcxml :
//   [{ datestamp, deleted, auteurs: [{ nomComplet, affiliations: [texte] }] }]
// Datafields 100/700/720 dans l'ordre du document. Les sous-champs portent code="…" ou
// label="…" selon le gabarit OJS : les deux sont lus.
//
// `$u` (affiliation) est répétable, et des auteurs en ont plusieurs. Les affiliations
// restent une liste : recollées, elles ne seraient ni un ROR ni un texte lisible.
// recordsEnAuteurs choisit laquelle garder.
function extraireRecordsMarc(xml) {
  const records = [];
  const source = String(xml === undefined || xml === null ? '' : xml);
  for (const bloc of source.matchAll(/<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/g)) {
    const corps = bloc[1];
    const deleted = /<header[^>]*\bstatus\s*=\s*["']deleted["']/.test(corps);
    const date = corps.match(/<datestamp(?:\s[^>]*)?>([\s\S]*?)<\/datestamp>/);
    const auteurs = [];
    // Datafields 100 (auteur principal), 700 (auteur secondaire), 720 (autres contributeurs).
    for (const field of corps.matchAll(/<datafield\s+tag\s*=\s*["'](100|700|720)["'][^>]*>([\s\S]*?)<\/datafield>/g)) {
      const noms = [];
      const affiliations = [];
      for (const sf of field[2].matchAll(/<subfield\s+(?:code|label)\s*=\s*["']([au])["'][^>]*>([\s\S]*?)<\/subfield>/g)) {
        const valeur = decoderTexteXml(sf[2]).replace(/\s+/g, ' ').trim();
        if (sf[1] === 'a') { noms.push(valeur); }
        else if (sf[1] === 'u' && valeur !== '') { affiliations.push(valeur); }
      }
      if (noms.length > 0 || affiliations.length > 0) {
        // Le gabarit OJS met un seul $a par personne ; le premier est retenu.
        auteurs.push({ nomComplet: noms[0] || '', affiliations: affiliations });
      }
    }
    records.push({
      datestamp: date ? decoderTexteXml(date[1]).trim() : '',
      deleted: deleted,
      auteurs: auteurs
    });
  }
  return records;
}

// ---- Normalisation et déduplication ----------------------------------------------

// « Nom, Prénom », la forme qu'OJS écrit dans dc:creator. Sans virgule, tout va dans `nom`
// et le prénom reste vide : couper au dernier mot se tromperait sur les particules et les
// noms composés (« Wood de Wilde », « von Arx »).
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

// Clé de déduplication : nom|prénom, casse et accents pliés.
function cleAuteur(auteur) {
  return plierNom((auteur || {}).nom) + '|' + plierNom((auteur || {}).prenom);
}

// Les records d'un moissonnage aplatis en entrées d'auteurs. Le format se lit sur le
// record : `auteurs` (marcxml, noms et affiliations) ou `creators` (oai_dc, noms seuls).
// Les records deleted sont ignorés ; le cache ne supprime rien.
function recordsEnAuteurs(records) {
  const auteurs = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || r.deleted) { continue; }
    if (Array.isArray(r.auteurs)) {
      for (const a of r.auteurs) {
        const n = normaliserCreator((a || {}).nomComplet || '');
        if (!n) { continue; }
        const entree = {
          prenom: n.prenom,
          nom: n.nom,
          affiliation: '',
          ror: '',
          datePublication: String(r.datestamp || ''),
          source: 'oai'
        };
        // La fiche n'a qu'une affiliation : on garde la première, dans l'ordre d'OJS.
        for (const brute of (a || {}).affiliations || []) {
          const id = rorCanonique(brute);
          if (id !== '') { entree.ror = id; } else { entree.affiliation = brute; }
          break;
        }
        auteurs.push(entree);
      }
    } else {
      // oai_dc : le nom seul, le format n'expose pas l'affiliation.
      for (const brut of Array.isArray(r.creators) ? r.creators : []) {
        const n = normaliserCreator(brut);
        if (n) { auteurs.push({ prenom: n.prenom, nom: n.nom, datePublication: String(r.datestamp || ''), source: 'oai' }); }
      }
    }
  }
  return auteurs;
}

// ---- ROR (Affiliation institutionnelle) -----------------------------------------------

// Rend la forme « https://ror.org/<id> » en minuscules d'une URL ROR ou d'un identifiant
// nu, ou '' si la valeur n'est pas un ROR. L'identifiant nu doit être accepté : idRor()
// repasse par ici avec une valeur déjà réduite. Même règle que rorCanonique() de
// lib/export-ojs.js.
function rorCanonique(valeur) {
  const s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  const m = s.match(/^(?:https?:\/\/)?(?:ror\.org\/)?(0[0-9a-hj-km-np-tv-z]{6}[0-9]{2})$/i);
  return m ? 'https://ror.org/' + m[1].toLowerCase() : '';
}

// L'identifiant nu d'un ROR (« 01swzsf04 »), depuis une URL ou depuis lui-même ; '' si la
// valeur n'est pas un ROR. C'est la clé de `cache.ror`, et ce que l'API ROR attend dans
// son chemin.
function idRor(valeur) {
  const canon = rorCanonique(valeur);
  return canon === '' ? '' : canon.slice('https://ror.org/'.length);
}

// resoudreRor : au plus 4 requêtes simultanées vers l'API ROR, et 5 minutes au total, pour
// qu'un poste hors ligne ne fasse pas tourner le rafraîchissement sans fin.
const CONCURRENCE_ROR = 4;
const DELAI_ROR_MS = 5 * 60 * 1000;

// Demande à l'API ROR les libellés des identifiants inconnus. `ids` : URL ou identifiants
// nus ; `connus` : ids déjà résolus. Un id qui échoue (404, réseau, JSON illisible) n'est pas
// mis en cache et sera retenté au prochain rafraîchissement. `recuperer`, `opts.horloge` et
// `opts.delaiMs` se remplacent dans les tests.
// Rend { <id>: { fr: "…", de: "…", en: "…" }, … }, les succès seuls. Ne lève pas.
async function resoudreRor(recuperer, ids, connus, opts) {
  const o = opts || {};
  const horloge = o.horloge || Date.now;
  const delaiMs = o.delaiMs === undefined ? DELAI_ROR_MS : o.delaiMs;
  const debut = horloge();
  // `connus` est soit un Set d'ids, soit la table cache.ror elle-même.
  const dejaVu = (id) => {
    if (!connus) { return false; }
    if (typeof connus.has === 'function') { return connus.has(id); }
    return Object.prototype.hasOwnProperty.call(connus, id);
  };
  const aTraiter = [];
  for (const id of Array.isArray(ids) ? ids : []) {
    // L'API ROR attend l'identifiant nu ; une URL y donnerait un 404.
    const idStr = idRor(id);
    if (idStr === '' || dejaVu(idStr) || aTraiter.indexOf(idStr) !== -1) { continue; }
    aTraiter.push(idStr);
  }
  const resultat = {};
  let echecs = 0;
  let indexSuivant = 0;
  async function resoudreUn(idStr) {
    try {
      const url = 'https://api.ror.org/v2/organizations/' + encodeURIComponent(idStr);
      const rep = await recuperer(url);
      const json = JSON.parse(String(rep === undefined || rep === null ? '' : rep));
      if (json && typeof json === 'object' && Array.isArray(json.names)) {
        // `en` reçoit le libellé d'affichage de ROR (ror_display), quelle que soit sa langue
        // déclarée. C'est le repli quand une institution n'a ni libellé fr ni libellé de.
        const libelles = { fr: '', de: '', en: '' };
        for (const n of json.names) {
          if (!n || typeof n !== 'object' || !n.value) { continue; }
          const types = Array.isArray(n.types) ? n.types : [];
          if (types.indexOf('ror_display') !== -1) { libelles.en = String(n.value); }
          if (types.indexOf('label') === -1) { continue; }
          if (n.lang === 'fr') { libelles.fr = String(n.value); }
          else if (n.lang === 'de') { libelles.de = String(n.value); }
        }
        resultat[idStr] = libelles;
      } else {
        echecs++;
      }
    } catch (e) { echecs++; }
  }
  // CONCURRENCE_ROR travailleurs piochent dans la même file ; chacun s'arrête quand la file
  // est vide ou que le délai est dépassé.
  async function travailleur() {
    while (indexSuivant < aTraiter.length) {
      if (horloge() - debut > delaiMs) { return; }
      const idStr = aTraiter[indexSuivant++];
      await resoudreUn(idStr);
    }
  }
  const equipe = [];
  for (let i = 0; i < Math.min(CONCURRENCE_ROR, aTraiter.length); i++) { equipe.push(travailleur()); }
  await Promise.all(equipe);
  // Un échec isolé reste silencieux ; un échec complet (hors ligne, API indisponible)
  // écrit une seule ligne dans la console.
  if (aTraiter.length > 0 && Object.keys(resultat).length === 0) {
    console.warn('[auteurs-ojs] résolution ROR : ' + aTraiter.length
      + ' institution(s) demandée(s), aucune résolue (' + echecs + ' échec(s)/reste(nt) hors délai).');
  }
  return resultat;
}

// Fusion incrémentale : les nouveaux venus s'ajoutent, rien n'est supprimé. Clé : cleAuteur().
// Champs d'enrichissement (affiliation, ror, fonction, email, orcid) :
// - source 'corpus' et valeur non vide : écrase ;
// - source 'oai' : remplit seulement un champ vide ;
// - une valeur vide n'écrase pas une valeur remplie.
// Une entrée touchée par le corpus passe en source 'corpus'.
function fusionnerAuteurs(existants, nouveaux) {
  const parCle = new Map();
  const sortie = [];
  const poser = (a, provenance) => {
    const prenom = String((a || {}).prenom || '').trim();
    const nom = String((a || {}).nom || '').trim();
    if (prenom === '' && nom === '') { return; }
    const entree = {
      prenom: prenom,
      nom: nom,
      affiliation: String((a || {}).affiliation || '').trim(),
      ror: String((a || {}).ror || '').trim(),
      fonction: String((a || {}).fonction || '').trim(),
      email: String((a || {}).email || '').trim(),
      orcid: String((a || {}).orcid || '').trim(),
      datePublication: String((a || {}).datePublication || ''),
      source: String(provenance || 'oai')
    };
    const cle = cleAuteur(entree);
    const connue = parCle.get(cle);
    if (!connue) {
      parCle.set(cle, entree);
      sortie.push(entree);
      return;
    }
    // Nom et prénom : ceux de la publication la plus récente.
    if (entree.datePublication > connue.datePublication) {
      connue.prenom = entree.prenom;
      connue.nom = entree.nom;
      connue.datePublication = entree.datePublication;
    }
    const enrichir = (champ) => {
      const nouveau = entree[champ];
      const existant = connue[champ];
      if (provenance === 'corpus' && nouveau !== '') {
        connue[champ] = nouveau;
        connue.source = 'corpus';
      } else if (provenance === 'oai' && nouveau !== '' && existant === '') {
        connue[champ] = nouveau;
      }
    };
    enrichir('affiliation');
    enrichir('ror');
    enrichir('fonction');
    enrichir('email');
    enrichir('orcid');
  };
  for (const a of Array.isArray(existants) ? existants : []) { poser(a, (a || {}).source || 'oai'); }
  for (const a of Array.isArray(nouveaux) ? nouveaux : []) { poser(a, (a || {}).source || 'oai'); }
  return sortie;
}

// ---- Cache C:\ProgramData\SZH\auteurs.json ----------------------------------------

function cacheVide() {
  return {
    version: 2,
    dateFetch: null,
    dateCorpus: null,
    ror: {},
    vus: {},
    auteurs: []
  };
}

// Lecture tolérante : fichier absent, JSON corrompu ou forme inattendue rendent le cache
// vide ; le BOM est retiré. Migration v1 → v2 : dateFetch repasse à null pour forcer un
// moissonnage complet (le v1 n'avait pas les affiliations), dateCorpus, ror et vus
// partent vides.
function lireCache() {
  let brut;
  try {
    brut = JSON.parse(String(fs.readFileSync(cheminCacheAuteurs(), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (e) { return cacheVide(); }
  if (!brut || typeof brut !== 'object') { return cacheVide(); }
  if ((brut.version || 1) === 1) {
    return {
      version: 2,
      dateFetch: null,
      dateCorpus: null,
      ror: {},
      vus: {},
      auteurs: fusionnerAuteurs(Array.isArray(brut.auteurs) ? brut.auteurs : [], [])
    };
  }
  return {
    version: 2,
    dateFetch: typeof brut.dateFetch === 'string' && brut.dateFetch !== '' ? brut.dateFetch : null,
    dateCorpus: typeof brut.dateCorpus === 'string' && brut.dateCorpus !== '' ? brut.dateCorpus : null,
    ror: (brut.ror && typeof brut.ror === 'object') ? brut.ror : {},
    vus: (brut.vus && typeof brut.vus === 'object') ? brut.vus : {},
    auteurs: Array.isArray(brut.auteurs) ? brut.auteurs : []
  };
}

function ecrireCache(cache) {
  try {
    const c = cache && typeof cache === 'object' ? cache : cacheVide();
    fs.mkdirSync(path.dirname(cheminCacheAuteurs()), { recursive: true });
    ecrireAtomique(cheminCacheAuteurs(), JSON.stringify({
      version: 2,
      dateFetch: typeof c.dateFetch === 'string' ? c.dateFetch : null,
      dateCorpus: typeof c.dateCorpus === 'string' ? c.dateCorpus : null,
      ror: (c.ror && typeof c.ror === 'object') ? c.ror : {},
      vus: (c.vus && typeof c.vus === 'object') ? c.vus : {},
      auteurs: Array.isArray(c.auteurs) ? c.auteurs : []
    }, null, 2) + '\n');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// Vrai si dateFetch a moins de JOURS_FRAICHEUR jours. Une dateFetch dans le futur (horloge
// repassée en arrière) compte comme périmée.
function cacheFrais(cache, maintenant) {
  if (!cache || !cache.dateFetch) { return false; }
  const t = Date.parse(cache.dateFetch);
  if (!isFinite(t)) { return false; }
  const age = (maintenant === undefined ? Date.now() : maintenant) - t;
  return age >= 0 && age < JOURS_FRAICHEUR * 24 * 3600 * 1000;
}

// ---- Endpoints -------------------------------------------------------------------

// Les endpoints de config.json, ou ceux par défaut. Seules les URL https sont gardées.
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

// ListRecords sur un endpoint, en suivant les resumptionToken. `recuperer` vaut
// recupererAvecRepli en production, une table de fixtures dans les tests. `from`
// (AAAA-MM-JJ) rend le moissonnage incrémental. `prefixe` : format des métadonnées
// (marcxml par défaut, pour les affiliations). Un token déjà vu ou PAGES_MAX pages
// atteintes lèvent une erreur.
async function moissonner(recuperer, base, from, prefixe) {
  const records = [];
  const jonction = base.indexOf('?') === -1 ? '?' : '&';
  const fmt = String(prefixe === undefined || prefixe === null ? 'marcxml' : prefixe).toLowerCase();
  let url = base + jonction + 'verb=ListRecords&metadataPrefix=' + encodeURIComponent(fmt) +
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
    const extraire = fmt === 'marcxml' ? extraireRecordsMarc : extraireRecords;
    for (const r of extraire(xml)) { records.push(r); }
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
// Appelé en tâche de fond à l'activation de l'extension. Ne lève que sur une erreur de
// programmation ; sinon rend :
//   { fait: false, raison: 'frais', … }          cache de moins d'un mois, aucun appel
//   { fait: true, complet: true, … }             les deux revues ont répondu, dateFetch avancée
//   { fait: true, complet: false, erreur, … }    au moins une revue n'a pas répondu : ce qui
//                                                a répondu est fusionné, dateFetch inchangée
// `opts` sert aux tests : { maintenant, recuperer, forcer, config }.
async function rafraichir(opts) {
  const o = opts || {};
  const maintenant = o.maintenant === undefined ? Date.now() : o.maintenant;
  const cache = lireCache();
  if (!o.forcer && cacheFrais(cache, maintenant)) {
    return { fait: false, raison: 'frais', dateFetch: cache.dateFetch, nombre: cache.auteurs.length };
  }
  // recupererAvecRepli réessaie après un 503 « Retry after », que certains serveurs
  // OAI-PMH renvoient.
  const recuperer = o.recuperer || recupererAvecRepli;
  const from = cache.dateFetch ? String(cache.dateFetch).slice(0, 10) : null;
  const endpoints = endpointsOai(o.config === undefined ? lireConfigPoste() : o.config);
  let auteurs = cache.auteurs;
  let complet = true;
  let derniereErreur = null;
  const rorIds = new Set();
  for (const base of endpoints) {
    try {
      const records = await moissonner(recuperer, base, from, 'marcxml');
      const nouveaux = recordsEnAuteurs(records);
      // Les ROR encore sans libellé, par identifiant nu (voir idRor).
      for (const a of nouveaux) {
        const id = idRor(a.ror);
        if (id !== '' && !cache.ror[id]) { rorIds.add(id); }
      }
      auteurs = fusionnerAuteurs(auteurs, nouveaux);
    } catch (e) {
      complet = false;
      derniereErreur = String((e && e.message) || e);
    }
  }
  // Un échec ROR n'empêche pas dateFetch d'avancer.
  let rorResolu = {};
  if (rorIds.size > 0) {
    try {
      rorResolu = await resoudreRor(recuperer, Array.from(rorIds), new Set(Object.keys(cache.ror)));
    } catch (e) { /* retenté au prochain rafraîchissement */ }
  }
  // Hors ligne, sans rien de neuf : le fichier n'est pas réécrit.
  const inchange = !complet && JSON.stringify(auteurs) === JSON.stringify(cache.auteurs);
  const rorNouveau = Object.assign({}, cache.ror, rorResolu);
  const neuf = {
    version: 2,
    dateFetch: complet ? new Date(maintenant).toISOString() : cache.dateFetch,
    dateCorpus: cache.dateCorpus,
    ror: rorNouveau,
    vus: cache.vus,
    auteurs: auteurs
  };
  const erreurEcriture = inchange ? null : ecrireCache(neuf);
  return {
    fait: true, complet: complet && !erreurEcriture,
    erreur: derniereErreur || erreurEcriture || null,
    dateFetch: neuf.dateFetch, nombre: auteurs.length,
    nombreRor: Object.keys(rorNouveau).length,
    // Les ROR que l'API n'a pas résolus : si tous échouent, la résolution est cassée.
    rorRates: rorIds.size - Object.keys(rorResolu).length
  };
}

module.exports = {
  ENDPOINTS_OAI_DEFAUT, JOURS_FRAICHEUR, OCTETS_MAX_REPONSE, DELAI_TOTAL_MS,
  cheminCacheAuteurs,
  decoderTexteXml, extraireRecords, extraireRecordsMarc, extraireResumptionToken, erreurOai,
  normaliserCreator, plierNom, cleAuteur, rorCanonique, idRor, resoudreRor, recordsEnAuteurs, fusionnerAuteurs,
  lireCache, ecrireCache, cacheFrais,
  endpointsOai, resoudreRedirection, recupererHttps, recupererAvecRepli, moissonner, rafraichir
};
