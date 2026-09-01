// La liste des auteur·e·s publiés des deux revues, moissonnée sur l'interface OAI-PMH
// PUBLIQUE d'ojs.szh.ch et gardée dans C:\ProgramData\SZH\auteurs.json. Elle alimente
// l'autocomplétion de la modale d'auteur·e (media/_auteurs.js).
//
// Formats OAI supportés : oai_dc (avant : noms seulement), marcxml (ajout : affiliations + ROR).
// Décision du 29.08.2026 : passage à marcxml pour enrichir les affiliations.
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
// config.json est réécrit en entier à chaque réglage. Forme v2 :
//   { "version": 2, "dateFetch": "2026-08-25T12:00:00.000Z", "dateCorpus": null,
//     "ror": { "01swzsf04": { "fr": "…", "de": "…", "en": "…" } },
//     "vus": { "<chemin>": timestamp }, "auteurs": [...] }
// v1 migre vers v2 en mettant dateFetch à null (moissonnage complet demandé).
//
// Rythme : au plus une fois par mois (dateFetch), incrémental (from = date du dernier fetch).
// Hors ligne = normal : l'échec est silencieux. dateFetch n'avance que si les DEUX revues
// ont répondu : sinon on réessaie, la fusion étant idempotente. Échec ROR n'empêche pas
// dateFetch d'avancer — les libellés se rattraperont.
//
// SZH_AUTEURS_CACHE impose un autre fichier de cache : les harnais de test s'en servent,
// comme SZH_CONFIG_OJS pour lib/export-ojs.js — aucun test ne touche C:\ProgramData, et
// aucun ne fait de réseau (le moissonnage et ROR prennent leur `recuperer` en paramètre).
//
// Client https, parseur XML minimal (resumptionToken, <error>, entités) et pliage de
// chaîne : lib/oai-pmh.js, module commun avec lib/mots-cles-edudoc.js (extrait le
// 01.09.2026). Réexportés ici sous les mêmes noms qu'avant l'extraction, pour ne rien
// changer aux appelants ni aux tests de ce module.
'use strict';

const fs = require('fs');
const path = require('path');
const { ecrireAtomique } = require('./yaml');
const { BASE_SZH, lireConfigPoste } = require('./archivage');
const {
  DELAI_TOTAL_MS, OCTETS_MAX_REPONSE,
  decoderTexteXml, extraireResumptionToken, erreurOai, plierNom,
  resoudreRedirection, recupererHttps
} = require('./oai-pmh');

const ENDPOINTS_OAI_DEFAUT = [
  'https://ojs.szh.ch/index.php/revue/fr/oai',
  'https://ojs.szh.ch/index.php/zeitschrift/de/oai'
];

const JOURS_FRAICHEUR = 30;                // « une fois par mois »
// Garde anti-boucle du suivi des resumptionToken. L'instance porte ~350 records par revue
// et 100 par page : cent pages laissent un ordre de grandeur de marge.
const PAGES_MAX = 100;

function cheminCacheAuteurs() {
  const impose = String(process.env.SZH_AUTEURS_CACHE || '').trim();
  return impose !== '' ? impose : path.join(BASE_SZH, 'auteurs.json');
}

// ---- Parseur, spécifique OJS -------------------------------------------------------
//
// decoderTexteXml, extraireResumptionToken et erreurOai sont génériques OAI-PMH : voir
// lib/oai-pmh.js. Ici, seulement ce qui lit le format propre à OJS — datestamp, statut
// deleted, dc:creator. Tolérant, comme le reste du parseur : un XML tronqué ou hostile
// rend simplement moins de records, jamais une exception.

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
// Tolère code="…" ET label="…" sur les sous-champs (incohérence du gabarit OJS).
// Datafields 100/700/720 dans l'ordre du document.
//
// `$u` est RÉPÉTABLE, et l'instance s'en sert : trois auteur·e·s des deux revues portent
// deux ou trois affiliations. Les recoller en une chaîne fabriquerait des valeurs comme
// « https://ror.org/A https://ror.org/B », qu'aucun des deux camps ne reconnaîtrait — ni
// ROR, ni texte lisible — et l'affiliation serait perdue en silence. La liste reste donc
// une liste ; c'est recordsEnAuteurs qui décide quoi en garder.
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
      // Sous-champs : tolère code="a" ou label="a" (attribut sur plusieurs lignes).
      for (const sf of field[2].matchAll(/<subfield\s+(?:code|label)\s*=\s*["']([au])["'][^>]*>([\s\S]*?)<\/subfield>/g)) {
        const valeur = decoderTexteXml(sf[2]).replace(/\s+/g, ' ').trim();
        if (sf[1] === 'a') { noms.push(valeur); }
        else if (sf[1] === 'u' && valeur !== '') { affiliations.push(valeur); }
      }
      if (noms.length > 0 || affiliations.length > 0) {
        // Un seul $a par personne dans le gabarit OJS ; le premier fait foi.
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

// plierNom (casse + accents pliés) vit dans lib/oai-pmh.js, importé plus haut : générique,
// pas spécifique à un nom de personne.
function cleAuteur(auteur) {
  return plierNom((auteur || {}).nom) + '|' + plierNom((auteur || {}).prenom);
}

// Les records d'un moissonnage aplatis en entrées d'auteur·e·s OAI-PMH.
// Format oai_dc : records[].creators (noms seulement).
// Format marcxml : records[].auteurs (noms + affiliations).
// Records deleted ignorés — jamais de suppression côté cache.
// Le format se lit sur le record lui-même — `auteurs` pour marcxml, `creators` pour
// oai_dc — plutôt que sur un argument. Un argument oublié par un appelant rendrait zéro
// auteur sans lever quoi que ce soit : le cache resterait vide et personne ne saurait
// pourquoi. La forme du record, elle, ne peut pas mentir.
function recordsEnAuteurs(records) {
  const auteurs = [];
  for (const r of Array.isArray(records) ? records : []) {
    if (!r || r.deleted) { continue; }
    if (Array.isArray(r.auteurs)) {
      // Auteurs depuis les datafields 100/700/720.
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
        // La fiche ne porte qu’une affiliation : d’un auteur qui en déclare plusieurs,
        // on garde la PREMIÈRE — l’ordre d’OJS est celui de l’auteur, et c’est une
        // suggestion, que le rédacteur corrige d’une frappe.
        for (const brute of (a || {}).affiliations || []) {
          const id = rorCanonique(brute);
          if (id !== '') { entree.ror = id; } else { entree.affiliation = brute; }
          break;
        }
        auteurs.push(entree);
      }
    } else {
      // oai_dc : le nom, et rien d’autre — le format n’expose pas l’affiliation.
      for (const brut of Array.isArray(r.creators) ? r.creators : []) {
        const n = normaliserCreator(brut);
        if (n) { auteurs.push({ prenom: n.prenom, nom: n.nom, datePublication: String(r.datestamp || ''), source: 'oai' }); }
      }
    }
  }
  return auteurs;
}

// ---- ROR (Affiliation institutionnelle) -----------------------------------------------

// Valide une URL ROR et rend la forme canonique « https://ror.org/<id> » en minuscules.
// Rend '' si ce n'en est pas un.
// L'URL et l'identifiant nu entrent tous les deux, et rendent la même forme canonique.
// Accepter le nu n'est pas un confort : idRor() repasse par ici sur une valeur qu'il a
// lui-même réduite à l'identifiant, et un canonique qui n'accepterait que l'URL renverrait
// alors '' — annulant le premier passage, et laissant les 45 institutions sans libellé.
// Même règle que rorCanonique() de lib/export-ojs.js, qui lit le champ saisi à la main.
function rorCanonique(valeur) {
  const s = String(valeur === undefined || valeur === null ? '' : valeur).trim();
  const m = s.match(/^(?:https?:\/\/)?(?:ror\.org\/)?(0[0-9a-hj-km-np-tv-z]{6}[0-9]{2})$/i);
  return m ? 'https://ror.org/' + m[1].toLowerCase() : '';
}

// L'identifiant NU d'un ROR — « 01swzsf04 » — depuis une URL ou depuis lui-même ; '' si la
// valeur n'est pas un ROR. C'est la clé de la table `cache.ror`, et le seul morceau que
// l'API ROR accepte dans son chemin.
function idRor(valeur) {
  const canon = rorCanonique(valeur);
  return canon === '' ? '' : canon.slice('https://ror.org/'.length);
}

// Résout les IDs ROR inconnus auprès de l'API ROR, range les libellés dans le cache.
// `recuperer` est injecté (comme dans `moissonner`) pour que les tests ne fassent aucun réseau.
// Les ids sont ceux du cache.ror (forme canonique). `connus` = Set des ids DÉJÀ en cache.
// Un id qui échoue (404, réseau, JSON illisible) est SAUTÉ — on ne le met pas en cache,
// il sera retenté le mois suivant.
// Rend { <id>: { fr: "…", de: "…", en: "…" }, … } — seuls les succès sont présents.
// Ne lève jamais.
async function resoudreRor(recuperer, ids, connus) {
  // `connus` est tantôt le Set des ids déjà résolus, tantôt la table cache.ror elle-même :
  // les deux appelants sont légitimes, et se tromper d'un des deux ferait soit une
  // exception, soit 45 requêtes inutiles tous les mois.
  const dejaVu = (id) => {
    if (!connus) { return false; }
    if (typeof connus.has === 'function') { return connus.has(id); }
    return Object.prototype.hasOwnProperty.call(connus, id);
  };
  const resultat = {};
  for (const id of Array.isArray(ids) ? ids : []) {
    // URL ou identifiant nu : les deux entrent, l'identifiant nu seul sort. Passer une URL
    // à l'API donnerait un 404 pour les 45 institutions d'un coup, sans un mot — et la
    // table resterait vide sans que rien ne signale pourquoi.
    const idStr = idRor(id);
    if (idStr === '' || dejaVu(idStr)) { continue; }
    try {
      const url = 'https://api.ror.org/v2/organizations/' + encodeURIComponent(idStr);
      const rep = await recuperer(url);
      const json = JSON.parse(String(rep === undefined || rep === null ? '' : rep));
      if (json && typeof json === 'object' && Array.isArray(json.names)) {
        // `en` est le libellé d'AFFICHAGE de ROR, quelle que soit sa langue déclarée : il
        // porte « lang: "en" » sur l'instance, et exiger lang absent le manquerait à tous
        // les coups. C'est le seul repli quand une institution n'a ni libellé français ni
        // libellé allemand — sans lui, l'affiliation sortirait vide.
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
      }
    } catch (e) { /* silencieux : on réessaiera le mois prochain */ }
  }
  return resultat;
}

// Fusion incrémentale : les nouveaux venus s'ajoutent. Clé = nom|prénom pliés.
// Règles sur les champs d'enrichissement (affiliation, ror, fonction, email, orcid) :
// - source 'corpus' et valeur non vide → écrase toujours ;
// - source 'oai' → remplit seulement si l'existant est vide ;
// - valeur vide n'écrase jamais une valeur remplie.
// Source = 'corpus' dès qu'une entrée corpus touche l'existant.
// Jamais de suppression.
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
    // Mise à jour : nom et prénom par la date la plus récente.
    if (entree.datePublication > connue.datePublication) {
      connue.prenom = entree.prenom;
      connue.nom = entree.nom;
      connue.datePublication = entree.datePublication;
    }
    // Enrichissements : règles de précédence.
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

// Lecture tolérante : fichier absent, JSON corrompu, BOM, forme inattendue — tout retombe
// sur le cache vide. Migration v1 → v2 : dateFetch repasse à null, dateCorpus/ror/vus
// partent vides (sinon le moissonnage incrémental oublierait 95 % des affiliations).
function lireCache() {
  let brut;
  try {
    brut = JSON.parse(String(fs.readFileSync(cheminCacheAuteurs(), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (e) { return cacheVide(); }
  if (!brut || typeof brut !== 'object') { return cacheVide(); }
  // Migration v1 → v2.
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
  // v2 : préserve dateCorpus, ror, vus tels quels.
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

// resoudreRedirection et recupererHttps (client https, gardes réseau, garde
// SZH_RESEAU_INTERDIT) vivent dans lib/oai-pmh.js, importés plus haut.

// ListRecords sur un endpoint, resumptionToken suivis jusqu'au bout. `recuperer`
// est injecté — recupererHttps en vrai, une table de fixtures dans les tests. `from` au
// format YYYY-MM-DD rend le moissonnage incrémental. `prefixe` = format métadonnées
// (défaut : marcxml pour les affiliations). Deux gardes anti-infini : token déjà vu, plafond de pages.
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
// Ce que l'activation de l'extension appelle en tâche de fond. Rend toujours une valeur,
// ne lève jamais vers l'appelant autre chose qu'une panne de programmation :
//   { fait: false, raison: 'frais', … }          cache de moins d'un mois, aucun appel
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
  const rorIds = new Set();
  for (const base of endpoints) {
    try {
      const records = await moissonner(recuperer, base, from, 'marcxml');
      const nouveaux = recordsEnAuteurs(records);
      // Les ROR encore sans libellé. La table est indexée par l'identifiant NU, pas par
      // l'URL : c'est ce que l'API ROR attend dans son chemin, et ce que le cockpit relit
      // pour afficher l'affiliation.
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
  // Résout les ROR inconnus. Échec ROR n'empêche pas dateFetch d'avancer.
  let rorResolu = {};
  if (rorIds.size > 0) {
    try {
      rorResolu = await resoudreRor(recuperer, Array.from(rorIds), new Set(Object.keys(cache.ror)));
    } catch (e) { /* silencieux : on réessaiera le mois prochain */ }
  }
  // Hors ligne complet : rien de neuf et rien à réécrire — le fichier reste tel quel.
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
    // Les ROR rencontrés que l’API n’a pas rendus : zéro sur zéro est le cas normal,
    // mais 45 sur 45 veut dire que la résolution est cassée — et sans ce compte, une
    // table vide ressemblerait à « rien de neuf ».
    rorRates: rorIds.size - Object.keys(rorResolu).length
  };
}

module.exports = {
  ENDPOINTS_OAI_DEFAUT, JOURS_FRAICHEUR, OCTETS_MAX_REPONSE, DELAI_TOTAL_MS,
  cheminCacheAuteurs,
  decoderTexteXml, extraireRecords, extraireRecordsMarc, extraireResumptionToken, erreurOai,
  normaliserCreator, plierNom, cleAuteur, rorCanonique, idRor, resoudreRor, recordsEnAuteurs, fusionnerAuteurs,
  lireCache, ecrireCache, cacheFrais,
  endpointsOai, resoudreRedirection, recupererHttps, moissonner, rafraichir
};
