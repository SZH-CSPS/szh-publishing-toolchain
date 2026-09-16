// Le vocabulaire des descripteurs edudoc.ch (thésaurus bilingue DE/FR appliqué à nos deux
// revues), moissonné sur l'interface OAI-PMH publique d'edudoc.ch et gardé dans
// C:\ProgramData\SZH\mots-cles.json. Alimente l'autocomplétion de mots clés (côté webview,
// media/_fiches.js) et l'appariement DE/FR vers l'export edudoc (champ MARC 690, plus bas
// dans ce fichier) : ce module moissonne, dédoublonne, garde — et apparie.
//
// Endpoint https://edudoc.ch/oai2d, instance Invenio/TIND sans authentification. Les deux
// revues y sont des sets dédiés, identifiants exacts (avec espaces, à encodeURIComponent) :
//   "Revue suisse de pédagogie spécialisée"
//   "Schweizerische Zeitschrift für Heilpädagogik"
//
// metadataPrefix=oai_dc ne porte aucun champ sujet. Seul metadataPrefix=marcxml expose le
// champ MARC 690, en paires bilingues répétées : $a = allemand, $b = français.
//
// Différence structurelle avec lib/auteurs-ojs.js (qui vise OJS, pas edudoc) : le marcxml
// d'edudoc préfixe tout son contenu MARC avec le namespace « marc: » —
// <marc:record><marc:datafield tag="690"><marc:subfield code="a">…</marc:subfield></marc:datafield></marc:record>
// — alors qu'OJS ne préfixe pas. Conséquence heureuse : pas de collision de balise <record>
// (le <record> OAI est nu, le <marc:record> MARC est préfixé) là où OJS imbriquait deux
// <record> de même nom. Mais les expressions régulières de ce module doivent tolérer le
// préfixe, faute de quoi elles ne matcheraient simplement rien sur les vraies réponses.
//
// Repli 503 : passé une poignée de requêtes rapprochées, l'instance peut répondre
// « 503 Retry after 1 seconds » puis se rétablir d'elle-même à la requête suivante. D'où
// recupererAvecRepli() dans lib/oai-pmh.js plutôt que dans ce seul module (voir plus bas) —
// lib/auteurs-ojs.js en profite aussi, même si l'instance OJS visée ne l'a pas montré.
//
// Des paires incomplètes existent en pratique (l'allemand ou le français peut manquer) :
// la tolérance n'est pas théorique.
//
// Cache séparé de config.json (qui est réécrit en entier à chaque réglage), forme imposée :
//   { dateFetch: "2026-08-31T12:00:00.000Z" | null, motsCles: [{ de, fr, manque }, …] }
// où `manque` vaut 'de', 'fr' ou null. Écriture atomique (lib/yaml.js).
//
// Rythme : au plus une fois par mois (dateFetch), incrémental (from = date du dernier fetch,
// au jour). Hors ligne = normal : l'échec est silencieux, comme pour les auteur·e·s.
// dateFetch n'avance que si les deux sets ont répondu ; sinon on réessaie, la fusion étant
// idempotente.
//
// SZH_MOTS_CLES_CACHE impose un autre fichier de cache — les tests s'en servent, comme
// SZH_AUTEURS_CACHE pour lib/auteurs-ojs.js : aucun test ne touche C:\ProgramData, et aucun
// ne fait de réseau (le moissonnage prend son `recuperer` en paramètre).
//
// Réutilisation délibérée de lib/oai-pmh.js, module commun avec lib/auteurs-ojs.js : son
// client HTTP (recupererHttps, avec ses gardes — redirections même-hôte, réponse bornée à
// 20 Mo, délai total de 60 s), son repli sur 503 (recupererAvecRepli) et son parseur
// générique OAI-PMH (erreurOai, extraireResumptionToken, decoderTexteXml) ne sont pas
// spécifiques aux auteur·e·s ni à edudoc : ils sont importés tels quels plutôt que réécrits.
// plierNom (casse + accents pliés) est importé de même sous l'alias `plierTexte` — son nom
// trompe, son corps ne fait rien de spécifique à un nom de personne. Seule l'extraction du
// champ 690, la fusion des descripteurs et la pagination avec `set=` sont propres à ce module.
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
// Garde anti-boucle, avec une marge d'un ordre de grandeur au-delà du volume réel d'une revue
// (une vingtaine de pages à 100 notices).
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
// désaccord entre deux moissons (même allemand, français distinct — ce n'est pas théorique :
// « Lernschwierigkeit » a deux traductions concurrentes sur l'instance) donne une seconde
// entrée plutôt qu'un remplacement muet.
//
// parDe/parFr ne pointent chacune que vers la PREMIÈRE entrée rencontrée pour une clé
// donnée (poserSiAbsente-like : jamais réécrites) : après un fork sur désaccord, l'allemand
// du fork reste donc introuvable via parDe, qui désigne toujours l'entrée d'origine. Sans
// garde-fou, un troisième descripteur identique au fork (même allemand ET même français)
// retomberait sur l'entrée d'origine via parDe, redécouvrirait le même désaccord et
// forkerait à nouveau — un fork de plus par répétition, jamais reconnu comme un doublon.
// D'où parPaire : la clé COMBINÉE (allemand plié + français plié) de chaque entrée, qui
// pointe elle vers la bonne entrée quel que soit le nombre de forks déjà accumulés sur le
// même allemand, et qui coupe court avant toute recherche de candidat — un descripteur
// rigoureusement identique à une entrée déjà connue ne doit jamais relancer la logique de
// désaccord/fork, seulement les vrais nouveaux désaccords la déclenchent encore.
function fusionnerMotsCles(existants, nouveaux) {
  const sortie = [];
  const parDe = new Map();     // allemand plié (non vide) -> index dans `sortie`
  const parFr = new Map();     // français plié (non vide) -> index dans `sortie`
  const parPaire = new Map();  // "allemand pliéfrançais plié" -> index dans `sortie`

  const indexer = (i) => {
    const e = sortie[i];
    const kd = plierTexte(e.de);
    const kf = plierTexte(e.fr);
    if (kd !== '' && !parDe.has(kd)) { parDe.set(kd, i); }
    if (kf !== '' && !parFr.has(kf)) { parFr.set(kf, i); }
    const kp = kd + '' + kf;
    if (!parPaire.has(kp)) { parPaire.set(kp, i); }
  };

  const poser = (mc) => {
    const de = String((mc || {}).de || '').trim();
    const fr = String((mc || {}).fr || '').trim();
    if (de === '' && fr === '') { return; }
    const kd = plierTexte(de);
    const kf = plierTexte(fr);

    // Doublon rigoureux (même allemand ET même français, pliés) : rien à ajouter, la
    // première occurrence fait foi — voir le commentaire au-dessus de la fonction.
    if (parPaire.has(kd + '' + kf)) { return; }

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

// ListRecords sur un set, resumptionToken suivis jusqu'au bout. `recuperer` est injecté —
// recupererAvecRepli en vrai, une table de fixtures dans les tests. `from` (YYYY-MM-DD)
// rend le moissonnage incrémental. metadataPrefix et set ne sont portés que par la première
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
//   { fait: true, complet: true, … }             les deux sets ont répondu, dateFetch avancée
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

// ---- Export vers edudoc : apparier les mots-clés d'un article avec le thésaurus -------
//
// keywords.fr et keywords.de d'un article sont chacune triées alphabétiquement de LEUR
// côté dans le .meta.yaml (mesuré sur les numéros réels du poste) : la n-ième entrée
// française n'a donc aucune raison de correspondre à la n-ième allemande. Apparier par
// position produirait un champ 690 faux sans jamais échouer un test naïf, puisque les deux
// listes ont la même longueur. La seule paire fiable est celle que porte le thésaurus
// edudoc lui-même : chaque terme saisi est retrouvé INDÉPENDAMMENT dans l'index, jamais en
// regardant son vis-à-vis dans l'autre langue.
//
// Deuxième écart mesuré : trois mots-clés sur dix portent un qualificatif entre
// parenthèses dans le thésaurus (« Inklusion (SZH) », « accessibilité (na) »…) que le
// rédacteur ne tape jamais. Sans le tolérer, on ne reconnaît qu'un mot-clé sur neuf ; en
// repliant sur la forme sans qualificatif, un sur deux. D'où deux clés par langue et par
// entrée : la forme exacte, et la forme privée de son unique parenthèse finale — jamais une
// parenthèse au milieu du libellé, qui fait partie du terme.
//
// Troisième écart : le .meta.yaml porte l'apostrophe typographique (’, U+2019), le
// thésaurus l'apostrophe droite (', U+0027). plierNom (importé sous plierTexte) plie déjà
// la casse, les accents et les espaces, mais ignore les apostrophes : plierDescripteur lui
// ajoute cette seule normalisation plutôt que de dupliquer le pliage.
//
// Les trois fonctions ci-dessous sont pures : le thésaurus (le tableau motsCles du cache)
// leur est passé en paramètre, jamais lu sur disque — à charge de l'appelant de le tirer
// de lireCacheMotsCles() au préalable.

const RE_QUALIFICATIF_FINAL = /\s*\([^()]*\)\s*$/;   // un seul groupe, en fin de chaîne

// Un libellé de thésaurus ou saisi par un rédacteur, privé de son unique qualificatif final
// (« Inklusion (SZH) » -> « Inklusion »). Un texte sans parenthèse finale ressort inchangé.
function sansQualificatifFinal(texte) {
  return String(texte === undefined || texte === null ? '' : texte).replace(RE_QUALIFICATIF_FINAL, '');
}

// Le pliage de comparaison d'un descripteur : plierTexte (casse, accents, espaces) plus la
// normalisation des trois apostrophes courbes/obliques vers l'apostrophe droite. Tolérant :
// null, undefined ou un nombre rendent une chaîne vide plutôt que de lever.
function plierDescripteur(texte) {
  if (texte === undefined || texte === null || typeof texte === 'number') { return ''; }
  return plierTexte(String(texte).replace(/[’‘ʼ]/g, "'"));
}

// Index opaque motsCles -> Map(clé pliée -> { de, fr }), pour retrouver une entrée du
// thésaurus depuis un libellé saisi dans l'une ou l'autre langue. Deux passes délibérées :
// toutes les clés EXACTES d'abord, puis seulement les clés DÉ-QUALIFIÉES, qui ne remplacent
// jamais une clé exacte déjà posée — sinon « tessin » (libellé exact d'une entrée) se
// ferait voler sa clé par « Tessin (na) » (une autre entrée, dé-qualifiée en « tessin »)
// selon l'ordre d'arrivée, ce qui serait arbitraire. Sur une collision entre deux clés de
// même rang (deux exactes, ou deux dé-qualifiées), la première entrée rencontrée gagne :
// le cache est ordonné par ancienneté de moisson, cet ordre fait foi comme dans
// fusionnerMotsCles. Une clé vide (langue manquante) n'est jamais indexée.
function indexerThesaurus(motsCles) {
  const entrees = (Array.isArray(motsCles) ? motsCles : []).map((mc) => ({
    de: String((mc && mc.de) || '').trim(),
    fr: String((mc && mc.fr) || '').trim()
  }));

  const index = new Map();
  const poserSiAbsente = (cle, entree) => {
    if (cle !== '' && !index.has(cle)) { index.set(cle, entree); }
  };

  for (const e of entrees) {
    poserSiAbsente(plierDescripteur(e.de), e);
    poserSiAbsente(plierDescripteur(e.fr), e);
  }
  for (const e of entrees) {
    poserSiAbsente(plierDescripteur(sansQualificatifFinal(e.de)), e);
    poserSiAbsente(plierDescripteur(sansQualificatifFinal(e.fr)), e);
  }
  return index;
}

// Un terme saisi -> son entrée du thésaurus, ou null. Exact d'abord, dé-qualifié ensuite
// (le terme saisi peut lui-même porter un qualificatif que le thésaurus n'a pas retenu).
function chercherDescripteur(terme, index) {
  const s = String(terme === undefined || terme === null ? '' : terme).trim();
  if (s === '') { return null; }
  const cleExacte = plierDescripteur(s);
  if (cleExacte !== '' && index.has(cleExacte)) { return index.get(cleExacte); }
  const cleDequalifiee = plierDescripteur(sansQualificatifFinal(s));
  if (cleDequalifiee !== '' && index.has(cleDequalifiee)) { return index.get(cleDequalifiee); }
  return null;
}

// fusionnerMotsCles garde délibérément deux entrées distinctes quand deux moissons
// désaccordent sur une traduction (« Lernschwierigkeit » a deux $b concurrents sur
// l'instance réelle, voir le commentaire de fusionnerMotsCles). Un article peut alors
// saisir un terme qui tombe sur l'une des deux entrées côté français et un terme qui tombe
// sur l'autre côté allemand : deux OBJETS distincts du thésaurus, donc invisibles à une
// déduplication par identité. Sans un second passage, le 690 sortirait avec le même $a et
// deux $b contradictoires — un doublon pour tout import de bibliothèque. On fond donc après
// coup les descripteurs déjà collectés dont l'allemand plié OU le français plié coïncide,
// le premier rencontré gagnant — même règle que partout ailleurs dans ce module.
function fusionnerDescripteursApparies(descripteurs) {
  const fondus = [];
  const parDe = new Map();   // allemand plié (non vide) -> index dans `fondus`
  const parFr = new Map();   // français plié (non vide) -> index dans `fondus`
  for (const d of descripteurs) {
    const kd = plierDescripteur(d.de);
    const kf = plierDescripteur(d.fr);
    let i = -1;
    if (kd !== '' && parDe.has(kd)) { i = parDe.get(kd); }
    else if (kf !== '' && parFr.has(kf)) { i = parFr.get(kf); }
    if (i === -1) { i = fondus.length; fondus.push(d); }
    // Les deux clés du descripteur fondu profitent au survivant, y compris celle qui ne l'a
    // pas désigné cette fois : un troisième descripteur peut encore s'y raccrocher par elle.
    if (kd !== '' && !parDe.has(kd)) { parDe.set(kd, i); }
    if (kf !== '' && !parFr.has(kf)) { parFr.set(kf, i); }
  }
  return fondus;
}

// L'appariement proprement dit. listeFr et listeDe sont les mots-clés saisis par le
// rédacteur, dans l'ordre du fichier — jamais mis en correspondance l'un avec l'autre,
// voir l'en-tête de section. Chaque terme est cherché seul ; ce que le thésaurus rend porte
// LA PAIRE, c'est elle qui part à l'export.
//   descripteurs : les entrées trouvées et complètes (de et fr non vides), dédoublonnées
//     par entrée du thésaurus PUIS fondues quand deux entrées distinctes partagent un
//     allemand ou un français (voir fusionnerDescripteursApparies ci-dessus) — sous leur
//     forme canonique edudoc, première apparition, liste française d'abord, puis allemande.
//   nonReconnus : les termes saisis qu'aucune entrée complète n'a captés, dans l'ordre,
//     sans doublon (comparés sur leur forme pliée), dans leur graphie d'origine. Une entrée
//     trouvée mais incomplète (l'autre langue manque au thésaurus) compte comme non
//     reconnue : le champ 690 a besoin de ses deux sous-champs, une moitié de paire n'y a
//     pas sa place.
function apparierDescripteurs(listeFr, listeDe, index) {
  const idx = index instanceof Map ? index : new Map();
  const descripteurs = [];
  const entreesVues = new Set();
  const nonReconnus = [];
  const nonReconnusVus = new Set();

  const traiter = (liste) => {
    for (const terme of Array.isArray(liste) ? liste : []) {
      const s = String(terme === undefined || terme === null ? '' : terme).trim();
      if (s === '') { continue; }
      const trouve = chercherDescripteur(s, idx);
      if (trouve && trouve.de !== '' && trouve.fr !== '') {
        if (!entreesVues.has(trouve)) {
          entreesVues.add(trouve);
          descripteurs.push({ de: trouve.de, fr: trouve.fr });
        }
        continue;
      }
      const cle = plierDescripteur(s);
      if (cle !== '' && !nonReconnusVus.has(cle)) {
        nonReconnusVus.add(cle);
        nonReconnus.push(s);
      }
    }
  };
  traiter(listeFr);
  traiter(listeDe);

  return { descripteurs: fusionnerDescripteursApparies(descripteurs), nonReconnus: nonReconnus };
}

module.exports = {
  ENDPOINT_EDUDOC_DEFAUT, SETS_EDUDOC_DEFAUT, JOURS_FRAICHEUR, PAGES_MAX,
  cheminCacheMotsCles,
  extraireRecordsMotsCles, recordsEnMotsCles, fusionnerMotsCles,
  lireCacheMotsCles, ecrireCacheMotsCles, cacheFraisMotsCles,
  configEdudoc, recupererAvecRepli, moissonnerMotsCles, rafraichirMotsCles,
  plierDescripteur, indexerThesaurus, apparierDescripteurs
};

// ---- Qualificatif de PROVENANCE du thésaurus edudoc, masqué à l'AFFICHAGE (16.09.2026) --
//
// Un descripteur edudoc porte parfois un qualificatif final entre parenthèses qui ne dit
// rien du terme lui-même, seulement d'où il vient dans le thésaurus : « Barrierefreiheit
// (szh) », « inclusion (CSPS) », « plan d'études (na) ». La saisie passe désormais par une
// liste fermée qui insère la forme canonique d'edudoc, qualificatif compris, dans le
// .meta.yaml — et Robin ne veut jamais voir ce qualificatif-là à l'impression : ni sur le
// PDF, ni sur le HTML, ni sur la page publique d'un article sur ojs.szh.ch. Le CSV Edudoc,
// lui, garde la forme canonique complète (lib/secretariat.js, export-templates/edudoc.twig) :
// c'est elle que la bibliothécaire attend, et rien ici n'y touche — le masquage n'a lieu qu'à
// l'AFFICHAGE, jamais dans le .meta.yaml de l'article.
//
// À NE PAS CONFONDRE avec sansQualificatifFinal, plus haut dans ce fichier : celle-ci retire
// N'IMPORTE QUELLE parenthèse finale, pour reconnaître un terme saisi dans le thésaurus (une
// parenthèse de SENS n'y gêne pas l'appariement, elle est juste ignorée le temps de la
// recherche). sansQualificatifDeProvenance fait l'inverse et sert un autre besoin : elle ne
// retire QUE les cinq jetons de provenance de la liste fermée ci-dessous, et laisse intacte
// toute autre parenthèse — « diagnostic (résultat) » et « diagnostic (processus) » sont deux
// concepts différents qui ne doivent jamais se confondre, « procédure d'évaluation
// standardisée (PES) » et « personne en formation (dans la formation professionnelle) »
// portent un acronyme ou une précision qui fait partie du terme. Les deux fonctions
// coexistent donc pour deux besoins différents : reconnaître (large, interne au module) et
// afficher (étroit, public) — ne pas les fusionner sous prétexte qu'elles se ressemblent.
//
// Liste fermée, partagée avec pipeline/filters/szh-maquette.lua (QUALIFICATIFS_PROVENANCE,
// sans_qualificatif_provenance) : le PDF est composé par ce filtre Lua à partir du même
// .meta.yaml, la page OJS par ce module JS (via lib/export-ojs.js) — les deux doivent
// masquer exactement les mêmes jetons, sous peine d'afficher deux choses différentes sans
// que personne ne s'en aperçoive. test/js/mots-cles-grille.test.js lit les deux fichiers et
// échoue si l'une des deux listes bouge sans l'autre.
const QUALIFICATIFS_PROVENANCE = ['na', 'ce', 'szh', 'csps', 'spc'];

// La parenthèse finale ne se retire que si son contenu, espaces ôtés et casse abaissée, est
// EXACTEMENT l'un des cinq jetons ci-dessus — jamais une recherche à l'intérieur du contenu,
// qui ferait par exemple sauter une parenthèse dont le texte contient seulement l'un de ces
// mots au milieu d'autre chose.
const RE_QUALIFICATIF_PROVENANCE_FINAL = /\s*\(([^()]*)\)\s*$/;

// Un libellé de thésaurus (ou déjà apparié pour l'export), privé de son qualificatif de
// provenance s'il en porte un. Un libellé sans parenthèse finale, ou dont la parenthèse
// porte autre chose qu'un des cinq jetons (un sens, un acronyme officiel), ressort inchangé.
function sansQualificatifDeProvenance(texte) {
  const s = String(texte === undefined || texte === null ? '' : texte);
  return s.replace(RE_QUALIFICATIF_PROVENANCE_FINAL, (tout, contenu) =>
    QUALIFICATIFS_PROVENANCE.indexOf(contenu.trim().toLowerCase()) !== -1 ? '' : tout);
}

module.exports.QUALIFICATIFS_PROVENANCE = QUALIFICATIFS_PROVENANCE;
module.exports.sansQualificatifDeProvenance = sansQualificatifDeProvenance;
