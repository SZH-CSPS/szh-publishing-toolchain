// Les descripteurs du thésaurus edudoc.ch (bilingue DE/FR), moissonnés par OAI-PMH et gardés
// dans C:\ProgramData\SZH\mots-cles.json. Ils servent à l'autocomplétion des mots-clés
// (media/_fiches.js) et à l'appariement DE/FR de l'export edudoc (champ MARC 690).
//
// Source : https://edudoc.ch/oai2d, sans authentification. Chaque revue est un set, dont
// l'identifiant contient des espaces (à passer par encodeURIComponent) :
//   "Revue suisse de pédagogie spécialisée"
//   "Schweizerische Zeitschrift für Heilpädagogik"
// Seul metadataPrefix=marcxml expose le champ 690 (oai_dc n'a pas de sujet) : des paires
// répétées, $a = allemand, $b = français. L'allemand ou le français peut manquer.
// Les balises MARC portent le préfixe « marc: » (<marc:datafield tag="690">…), que les
// expressions régulières doivent tolérer.
//
// Format du cache, distinct de config.json, écrit de façon atomique (lib/yaml.js) :
//   { dateFetch: "2026-08-31T12:00:00.000Z" | null, motsCles: [{ de, fr, manque }, …] }
// où `manque` vaut 'de', 'fr' ou null.
//
// Rafraîchi au plus une fois par mois, de façon incrémentale (from = jour du dernier
// moissonnage). Un échec réseau est silencieux. dateFetch n'avance que si les deux sets ont
// répondu ; la fusion étant idempotente, on peut réessayer.
//
// SZH_MOTS_CLES_CACHE désigne un autre fichier de cache (pour les tests). Le moissonnage
// reçoit sa fonction `recuperer` en paramètre, ce qui permet de tester sans réseau.
//
// Le client HTTP, le repli sur les 503 « Retry after » d'edudoc et l'analyse OAI-PMH
// viennent de lib/oai-pmh.js ; plierNom est importé sous le nom `plierTexte`, car il plie
// n'importe quel texte.
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

const JOURS_FRAICHEUR = 30;
// Garde contre une boucle de pagination, dix fois au-dessus du volume réel d'une revue (une
// vingtaine de pages de 100 notices).
const PAGES_MAX = 500;

function cheminCacheMotsCles() {
  const impose = String(process.env.SZH_MOTS_CLES_CACHE || '').trim();
  return impose !== '' ? impose : path.join(BASE_SZH, 'mots-cles.json');
}

// ---- Extraction MARC 690 -----------------------------------------------------------
//
// Un XML tronqué ou malformé rend moins de records, sans exception. `(?:[\w.-]+:)?`
// accepte le préfixe « marc: » sans l'exiger.

// Les records d'une réponse ListRecords marcxml : [{ datestamp, deleted, descripteurs }],
// descripteurs = [{ de, fr, manque }]. `manque` signale un $a ou un $b absent.
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
      // Un champ 690 n'a qu'un $a et un $b ; on prend le premier de chaque.
      let vuA = false;
      let vuB = false;
      for (const sf of field[1].matchAll(
        /<(?:[\w.-]+:)?subfield\s+code\s*=\s*["']([ab])["'][^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?subfield>/g
      )) {
        const valeur = decoderTexteXml(sf[2]).replace(/\s+/g, ' ').trim();
        if (sf[1] === 'a' && !vuA) { de = valeur; vuA = true; }
        else if (sf[1] === 'b' && !vuB) { fr = valeur; vuB = true; }
      }
      if (de === '' && fr === '') { continue; }
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

// Les records d'un moissonnage aplatis en descripteurs. Les records supprimés sont ignorés :
// le cache ne perd jamais d'entrée.
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
// Rapprochement par la forme pliée (casse et accents) de l'allemand ou du français : l'un
// des deux suffit à retrouver une entrée, et une paire incomplète peut ainsi être complétée
// plus tard. Une valeur remplie n'est jamais écrasée : deux traductions différentes du même
// terme (« Lernschwierigkeit » en a deux) donnent deux entrées.
//
// parDe et parFr désignent la première entrée vue pour une clé. Une seconde entrée née d'un
// désaccord y est donc introuvable ; parPaire (allemand et français pliés) la retrouve, pour
// qu'un descripteur déjà connu ne crée pas une nouvelle entrée à chaque répétition.
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

    // Même allemand et même français : déjà connu.
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
    // Aucun candidat, ou désaccord : nouvelle entrée.
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

// Fichier absent, JSON corrompu, BOM ou forme inattendue : rend le cache vide.
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

// Frais = moins d'un mois. Une dateFetch dans le futur (horloge reculée) compte comme
// périmée, ce qui la corrige au prochain moissonnage.
function cacheFraisMotsCles(cache, maintenant) {
  if (!cache || !cache.dateFetch) { return false; }
  const t = Date.parse(cache.dateFetch);
  if (!isFinite(t)) { return false; }
  const age = (maintenant === undefined ? Date.now() : maintenant) - t;
  return age >= 0 && age < JOURS_FRAICHEUR * 24 * 3600 * 1000;
}

// ---- Config (surcharge de l'endpoint / des sets) -------------------------------------
//
// Reçoit la config en paramètre. Comme endpointsOai() de lib/auteurs-ojs.js, refuse un
// endpoint en http.
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


// ---- Moissonnage ----------------------------------------------------------------------

// ListRecords sur un set, en suivant les resumptionToken jusqu'au bout. `recuperer` vaut
// recupererAvecRepli, ou des fixtures dans les tests. `from` (YYYY-MM-DD) rend le
// moissonnage incrémental. metadataPrefix et set ne vont que dans la première requête :
// OAI-PMH interdit de les répéter avec un resumptionToken.
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
      if (erreur.code === 'noRecordsMatch') { return records; }   // rien de neuf
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
  // Aucun set n'a répondu : le fichier reste tel quel.
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
// keywords.fr et keywords.de sont triées chacune de son côté dans le .meta.yaml : la n-ième
// entrée française ne correspond pas à la n-ième allemande. Chaque terme saisi est donc
// cherché seul dans le thésaurus, qui donne la paire.
//
// Le thésaurus ajoute souvent un qualificatif entre parenthèses (« Inklusion (SZH) »,
// « accessibilité (na) ») que la saisie n'a pas. Chaque entrée a donc deux clés par langue :
// la forme exacte, et la forme sans sa parenthèse finale. Une parenthèse au milieu du
// libellé fait partie du terme.
//
// Le .meta.yaml porte l'apostrophe typographique (’, U+2019), le thésaurus l'apostrophe
// droite (', U+0027) : plierDescripteur ajoute cette normalisation à plierTexte.
//
// Les fonctions ci-dessous reçoivent le thésaurus (motsCles du cache) en paramètre.

const RE_QUALIFICATIF_FINAL = /\s*\([^()]*\)\s*$/;   // un seul groupe, en fin de chaîne

// Un libellé de thésaurus ou saisi par un rédacteur, privé de son unique qualificatif final
// (« Inklusion (SZH) » -> « Inklusion »). Un texte sans parenthèse finale ressort inchangé.
function sansQualificatifFinal(texte) {
  return String(texte === undefined || texte === null ? '' : texte).replace(RE_QUALIFICATIF_FINAL, '');
}

// Forme de comparaison d'un descripteur : plierTexte (casse, accents, espaces), et les
// apostrophes courbes ramenées à l'apostrophe droite. null, undefined ou un nombre rendent
// une chaîne vide.
function plierDescripteur(texte) {
  if (texte === undefined || texte === null || typeof texte === 'number') { return ''; }
  return plierTexte(String(texte).replace(/[’‘ʼ]/g, "'"));
}

// Index motsCles -> Map(clé pliée -> { de, fr }), pour retrouver une entrée depuis un
// libellé saisi dans l'une ou l'autre langue. Les clés exactes sont posées d'abord, puis les
// clés sans qualificatif, qui ne remplacent pas une clé exacte : « tessin » reste à
// l'entrée « tessin » et non à « Tessin (na) ». Entre deux clés de même rang, la première
// entrée du cache l'emporte. Une clé vide n'est pas indexée.
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

// Le thésaurus peut avoir deux entrées pour un même terme (voir fusionnerMotsCles). Un
// article peut alors toucher l'une par le français et l'autre par l'allemand, et le 690
// sortirait avec le même $a et deux $b. On fusionne donc les descripteurs dont l'allemand ou
// le français plié coïncide ; le premier rencontré l'emporte.
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
    // Les deux clés du descripteur fusionné pointent vers le survivant, pour qu'un troisième
    // descripteur puisse s'y rattacher par l'une ou l'autre.
    if (kd !== '' && !parDe.has(kd)) { parDe.set(kd, i); }
    if (kf !== '' && !parFr.has(kf)) { parFr.set(kf, i); }
  }
  return fondus;
}

// L'appariement. listeFr et listeDe sont les mots-clés saisis, dans l'ordre du fichier.
// Chaque terme est cherché seul ; la paire rendue par le thésaurus part à l'export. Rend :
//   descripteurs : les entrées trouvées et complètes (de et fr non vides), sans doublon puis
//     fusionnées (fusionnerDescripteursApparies), sous leur forme edudoc, dans l'ordre
//     d'apparition, liste française d'abord ;
//   nonReconnus : les termes saisis sans entrée complète, dans l'ordre, sans doublon, dans
//     leur graphie d'origine. Une entrée sans l'autre langue compte comme non reconnue, le
//     champ 690 exigeant ses deux sous-champs.
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

// ---- Qualificatif de provenance, masqué à l'affichage ----------------------------------
//
// Certains descripteurs edudoc finissent par un qualificatif qui dit d'où ils viennent dans
// le thésaurus : « Barrierefreiheit (szh) », « plan d'études (na) ». Le .meta.yaml garde la
// forme complète, comme le CSV Edudoc (lib/secretariat.js, export-templates/edudoc.twig) ;
// le PDF, le HTML et la page OJS l'affichent sans ce qualificatif.
//
// sansQualificatifFinal (plus haut) retire n'importe quelle parenthèse finale, pour
// rechercher un terme. sansQualificatifDeProvenance ne retire que les cinq qualificatifs
// ci-dessous : « diagnostic (résultat) » et « diagnostic (processus) » sont deux termes
// distincts, et « procédure d'évaluation standardisée (PES) » garde son acronyme.
//
// Liste partagée avec pipeline/filters/szh-maquette.lua (QUALIFICATIFS_PROVENANCE,
// sans_qualificatif_provenance), qui compose le PDF ; test/js/mots-cles-grille.test.js
// vérifie que les deux listes sont identiques.
const QUALIFICATIFS_PROVENANCE = ['na', 'ce', 'szh', 'csps', 'spc'];

// La parenthèse finale n'est retirée que si son contenu, sans espaces de bord et en
// minuscules, est exactement l'un des cinq qualificatifs.
const RE_QUALIFICATIF_PROVENANCE_FINAL = /\s*\(([^()]*)\)\s*$/;

// Un libellé du thésaurus privé de son qualificatif de provenance. Tout autre libellé
// ressort inchangé.
function sansQualificatifDeProvenance(texte) {
  const s = String(texte === undefined || texte === null ? '' : texte);
  return s.replace(RE_QUALIFICATIF_PROVENANCE_FINAL, (tout, contenu) =>
    QUALIFICATIFS_PROVENANCE.indexOf(contenu.trim().toLowerCase()) !== -1 ? '' : tout);
}

module.exports.QUALIFICATIFS_PROVENANCE = QUALIFICATIFS_PROVENANCE;
module.exports.sansQualificatifDeProvenance = sansQualificatifDeProvenance;
