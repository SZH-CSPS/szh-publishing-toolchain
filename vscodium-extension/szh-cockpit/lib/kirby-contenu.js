// Lit et écrit la Documentation (« Actualité et ressources » / « News & Ressourcen »), en
// deux parties :
//
//   1. La page du numéro (documentation.<lang>.txt, dans le dossier de l'article
//      articles/NN-<slug>/) : Title, Uuid et les rubriques de prose libre.
//   2. La bibliothèque partagée (<racine-arbre>\_NewsUndActu\Fiches\<dossier-du-type>\<slug>\) :
//      un dossier par type (`types[].dossier` du contrat), un dossier par fiche, un fichier
//      <type>.<lang>.txt par langue. Le slug n'est unique qu'à l'intérieur du dossier de son
//      type. Le champ système Ausgabe (id du numéro, ausgabe.yaml) rattache la fiche à un
//      numéro ; Ordre donne son rang d'impression, recalculé à chaque enregistrement.
//
// Format : docs/FORMAT-DOCUMENTATION-KIRBY.md. Les champs, types, listes et libellés viennent
// de pipeline/kirby/champs-documentation.json, chargé ici.
//
// Module sans require('vscode') : l'hôte (lib/documentation-hote.js) parle à la webview et
// refuse un numéro verrouillé.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { slugifier } = require('./slug');
const { ecrireAtomique, idNumero } = require('./yaml');
const { basePoste } = require('./poste');

// ---- Chargement du contrat : dépôt d'abord, puis toolkit/ ; SZH_CHAMPS_DOCUMENTATION prime
const EMPLACEMENTS = [
  path.resolve(__dirname, '..', '..', '..', 'pipeline', 'kirby', 'champs-documentation.json'),
  path.join(basePoste(), 'toolkit', 'pipeline', 'kirby', 'champs-documentation.json')
];

function emplacements() {
  return process.env.SZH_CHAMPS_DOCUMENTATION ? [process.env.SZH_CHAMPS_DOCUMENTATION] : EMPLACEMENTS;
}

let cache = null;

function chargerContrat() {
  if (cache) { return cache; }
  const candidats = emplacements();
  let src = null, chemin = null;
  for (const c of candidats) {
    try { src = fs.readFileSync(c, 'utf8'); chemin = c; break; }
    catch (e) { /* emplacement suivant */ }
  }
  if (src === null) {
    throw new Error('champs-documentation.json introuvable : ' + candidats.join(' ; '));
  }
  let json;
  try { json = JSON.parse(src); }
  catch (e) { throw new Error('champs-documentation.json invalide (' + chemin + ') : ' + e.message); }
  cache = { json: json, chemin: chemin };
  return cache;
}

function oublierContrat() { cache = null; }
function cheminDuContrat() { return chargerContrat().chemin; }
function contrat() { return chargerContrat().json; }

// ---- Accès au contrat ----------------------------------------------------------------

function typeConnu(type) { return !!(contrat().types || {})[String(type || '')]; }
function typesConnus() {
  const c = contrat();
  return (c.ordreTypes || Object.keys(c.types || {})).slice();
}
function definitionType(type) { return (contrat().types || {})[type] || null; }
function champsDuType(type) {
  const def = definitionType(type);
  return def ? def.champs.slice() : [];
}
function champDuType(type, cle) {
  return champsDuType(type).find((c) => c.cle === cle) || null;
}
function libelleType(type, langue) {
  const def = definitionType(type);
  if (!def) { return type; }
  return def.libelle[langue] || def.libelle.fr || type;
}
// Libellé court du cockpit (arbre, formulaire) : types[].libelleCourt s'il existe
// (« Agenda » pour « Agenda et formation continue »), sinon libelleType().
function libelleCockpitType(type, langue) {
  const def = definitionType(type);
  if (def && def.libelleCourt) { return def.libelleCourt[langue] || def.libelleCourt.fr || libelleType(type, langue); }
  return libelleType(type, langue);
}
function libelleLienType(type, langue, titre) {
  const def = definitionType(type);
  if (!def || !def.libelleLien) { return String(titre || ''); }
  const gabarit = def.libelleLien[langue] || def.libelleLien.fr || '{titre}';
  return gabarit.replace('{titre}', String(titre || ''));
}
function champFichierDuType(type) {
  const c = champsDuType(type).find((x) => x.saisie === 'fichier');
  return c ? c.cle : null;
}
function rubriquesDuContrat() { return (contrat().rubriques || []).slice(); }
function rubriquesPourRevue(revue) {
  return rubriquesDuContrat().filter((r) => (r.revues || []).indexOf(revue) !== -1);
}
function valeursListe(nom) { return ((contrat().listes || {})[nom] || []).slice(); }
function languesDuContrat() {
  const l = contrat().langues;
  return (Array.isArray(l) && l.length > 0) ? l.slice() : ['fr', 'de'];
}
// Les langues du contrat autres que celle donnée.
function autresLangues(langue) { return languesDuContrat().filter((l) => l !== langue); }

// ---- Validation des dates -------------------------------------------------------------
const RE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RE_DATE_PARTIELLE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const RE_ANNEE = /^\d{4}$/;
function dateValide(v) { return RE_DATE.test(String(v === undefined || v === null ? '' : v)); }
function datePartielleValide(v) { return RE_DATE_PARTIELLE.test(String(v === undefined || v === null ? '' : v)); }
function anneeValide(v) { return RE_ANNEE.test(String(v === undefined || v === null ? '' : v)); }

// ---- `quand` : un champ n'est visible / requis que si une condition est remplie -------
function quandSatisfait(quand, valeurs) {
  if (!quand) { return true; }
  const v = valeurs || {};
  return Object.keys(quand).every((cle) => String(v[cle] || '') === String(quand[cle]));
}

// ---- Champ `derive` : recalculé à chaque écriture, jamais lu depuis le disque ---------
function valeurDerive(champ, valeurs) {
  const table = contrat()[champ.table] || {};
  const source = (valeurs || {})[champ.depuis];
  const entree = table[source];
  if (!entree || entree[champ.cle] === undefined) { return ''; }
  return String(entree[champ.cle]);
}
function curiaDepuis(categorie) {
  const entree = (contrat().instruments || {})[categorie];
  return entree ? entree.curia : null;
}

// ---- Instruments : ordre du menu, canton d'abord --------------------------------------
function ordreInstruments(canton) {
  const instruments = contrat().instruments || {};
  const jetons = Object.keys(instruments);
  if (!canton) { return jetons.slice(); }
  const avec = jetons.filter((j) => (instruments[j].cantons || []).indexOf(canton) !== -1);
  const sans = jetons.filter((j) => (instruments[j].cantons || []).indexOf(canton) === -1);
  return avec.concat(sans);
}
function instrumentEstLocal(jeton) {
  const e = (contrat().instruments || {})[jeton];
  return !!(e && e.local);
}
function cantonsInstrument(jeton) {
  const e = (contrat().instruments || {})[jeton];
  return e ? (e.cantons || []).slice() : [];
}

// ---- Complétude d'une fiche : les champs `requis`, `quand` pris en compte -------------
function champsManquants(type, valeurs) {
  if (!typeConnu(type)) { return ['?']; }
  const v = valeurs || {};
  const manquants = [];
  for (const c of champsDuType(type)) {
    if (!c.requis) { continue; }
    if (c.quand && !quandSatisfait(c.quand, v)) { continue; }
    const val = v[c.cle];
    const vide = (c.saisie === 'structure' || c.saisie === 'liste_multiple')
      ? !(Array.isArray(val) && val.length > 0)
      : String(val === undefined || val === null ? '' : val).trim() === '';
    if (vide) { manquants.push(c.cle); }
  }
  return manquants;
}
function ficheComplete(type, valeurs) { return champsManquants(type, valeurs).length === 0; }

function ficheEcrivable(type, valeurs) {
  if (!typeConnu(type)) { return false; }
  const v = valeurs || {};
  return champsDuType(type).some((c) => {
    if (c.saisie === 'derive') { return false; }
    const val = v[c.cle];
    if (c.saisie === 'structure' || c.saisie === 'liste_multiple') { return Array.isArray(val) && val.length > 0; }
    return String(val === undefined || val === null ? '' : val).trim() !== '';
  });
}

// ---- Identifiant : 16 caractères [A-Za-z0-9], posé une fois pour toutes --------------
const ALPHABET_UUID = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function genererUuid() {
  const octets = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) { s += ALPHABET_UUID[octets[i] % ALPHABET_UUID.length]; }
  return s;
}

// ---- Le fichier .txt Kirby : parseur et sérialiseur génériques -----------------------

function separateur() { return (contrat().kirby || {}).separateur || '----'; }
function nomChampUuid() { return (contrat().kirby || {}).champUuid || 'uuid'; }
function nomFichierContenu(template, langue) {
  const gabarit = (contrat().kirby || {}).fichierContenu || '{template}.{langue}.txt';
  return gabarit.replace('{template}', template).replace('{langue}', langue);
}

// Vrai si le nom est celui du fichier de page, dans l'une des langues
// (lib/renumerotation-fs.js). Ce nom est fixe, alors que <slug>.meta.yaml suit le nom du
// dossier.
function estFichierPageDocumentation(nomFichier) {
  const c = contrat();
  const template = (c.kirby || {}).pageDocumentation || 'documentation';
  const langues = languesDuContrat();
  return langues.some((langue) => nomFichierContenu(template, langue) === String(nomFichier || ''));
}

function echapperSeparateur(valeur, sep) {
  return String(valeur).split('\n').map((l) => (l === sep ? '\\' + sep : l)).join('\n');
}
function deechapperSeparateur(valeur, sep) {
  return String(valeur).split('\n').map((l) => (l === '\\' + sep ? sep : l)).join('\n');
}

function capitaliserNomKirby(cle) {
  const s = String(cle);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// lireTxt(texteBrut) -> { title, uuid, champs: { cle-minuscule: valeur } }
function lireTxt(texteBrut) {
  const sep = separateur();
  let texte = String(texteBrut === undefined || texteBrut === null ? '' : texteBrut).replace(/\r\n/g, '\n');
  texte = texte.replace(/\n$/, '');
  const morceaux = texte === '' ? [] : texte.split('\n\n' + sep + '\n\n');
  const champs = {};
  let title = '', uuid = '';
  const cleUuid = nomChampUuid();
  for (const morceau of morceaux) {
    if (morceau.trim() === '') { continue; }
    const iNL = morceau.indexOf('\n');
    const ligne1 = iNL === -1 ? morceau : morceau.slice(0, iNL);
    const reste = iNL === -1 ? null : morceau.slice(iNL + 1);
    const m = ligne1.match(/^([A-Za-z0-9_]+):[ \t]?(.*)$/);
    if (!m) { continue; }
    const cle = m[1].toLowerCase();
    const premiereLigne = m[2];
    let valeur;
    if (reste === null) {
      valeur = premiereLigne;
    } else if (premiereLigne.trim() === '') {
      valeur = reste.charAt(0) === '\n' ? reste.slice(1) : reste;
    } else {
      valeur = premiereLigne + '\n' + reste;
    }
    valeur = deechapperSeparateur(valeur, sep);
    if (cle === 'title') { title = valeur; continue; }
    if (cle === cleUuid) { uuid = valeur; continue; }
    champs[cle] = valeur;
  }
  return { title: title, uuid: uuid, champs: champs };
}

// ecrireTxt({ title, uuid, champs: [{ cle, valeurBrute, forcerMultiligne }] }) -> texte
function ecrireTxt(donnees) {
  const sep = separateur();
  const d = donnees || {};
  const parties = [
    ligneChamp('Title', d.title || '', sep, false),
    ligneChamp(capitaliserNomKirby(nomChampUuid()), d.uuid || '', sep, false)
  ];
  for (const c of (d.champs || [])) {
    parties.push(ligneChamp(capitaliserNomKirby(c.cle), c.valeurBrute, sep, !!c.forcerMultiligne));
  }
  return parties.join('\n\n' + sep + '\n\n') + '\n';
}
function ligneChamp(nomAffiche, valeur, sep, forcerMultiligne) {
  const echappe = echapperSeparateur(String(valeur === undefined || valeur === null ? '' : valeur), sep);
  if (forcerMultiligne || echappe.indexOf('\n') !== -1) { return nomAffiche + ':\n\n' + echappe; }
  return nomAffiche + ': ' + echappe;
}

// ---- Listes YAML : `structure` (suivi) et `fichier` (couverture) ---------------------

function citerYaml(v) {
  return '"' + String(v === undefined || v === null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function devaleurYaml(brut) {
  const t = String(brut === undefined || brut === null ? '' : brut).trim();
  if (t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (t.length >= 2 && t.charAt(0) === "'" && t.charAt(t.length - 1) === "'") {
    return t.slice(1, -1).replace(/''/g, "'");
  }
  return t;
}

const CLES_SUIVI = ['date', 'genre', 'libelle', 'lien'];
function ecrireListeStructure(entrees) {
  const utiles = (Array.isArray(entrees) ? entrees : [])
    .filter((e) => e && CLES_SUIVI.some((c) => String(e[c] || '').trim() !== ''));
  if (utiles.length === 0) { return ''; }
  const lignes = [];
  for (const e of utiles) {
    lignes.push('-');
    for (const c of CLES_SUIVI) {
      const v = String(e[c] || '').trim();
      if (v !== '') { lignes.push('  ' + c + ': ' + citerYaml(v)); }
    }
  }
  return lignes.join('\n');
}
function lireListeStructure(brut) {
  const lignes = String(brut === undefined || brut === null ? '' : brut).replace(/\r\n/g, '\n').split('\n');
  const entrees = [];
  let courante = null;
  for (const ligne of lignes) {
    if (/^\s*-\s*$/.test(ligne)) { courante = { date: '', genre: '', libelle: '', lien: '' }; entrees.push(courante); continue; }
    const m = ligne.match(/^\s+([A-Za-z]+):\s*(.*)$/);
    if (m && courante) {
      const cle = m[1].toLowerCase();
      if (CLES_SUIVI.indexOf(cle) !== -1) { courante[cle] = devaleurYaml(m[2]); }
    }
  }
  return entrees.filter((e) => CLES_SUIVI.some((c) => e[c] !== ''));
}

// ---- `liste_multiple` (genre et pays d'un film) : « jeton1, jeton2 » ------------------
//
// Séparateur virgule-espace, comme le champ multiselect de Kirby ; ordre de saisie, sans
// doublon. Champ commun aux deux langues, recopié par fusionnerChampsCommuns().
function ecrireListeMultiple(jetons) {
  const vus = new Set();
  const utiles = [];
  for (const j of (Array.isArray(jetons) ? jetons : [])) {
    const v = String(j === undefined || j === null ? '' : j).trim();
    if (v === '' || vus.has(v)) { continue; }
    vus.add(v);
    utiles.push(v);
  }
  return utiles.join(', ');
}
function lireListeMultiple(brut) {
  const vus = new Set();
  const utiles = [];
  for (const j of String(brut === undefined || brut === null ? '' : brut).split(',')) {
    const v = j.trim();
    if (v === '' || vus.has(v)) { continue; }
    vus.add(v);
    utiles.push(v);
  }
  return utiles;
}

function ecrireFichierUnique(nom) {
  const n = String(nom === undefined || nom === null ? '' : nom).trim();
  return n === '' ? '' : '- ' + n;
}
function lireFichierUnique(brut) {
  const lignes = String(brut === undefined || brut === null ? '' : brut).replace(/\r\n/g, '\n').split('\n');
  for (const ligne of lignes) {
    const m = ligne.match(/^\s*-\s*(.+)$/);
    if (m) { return devaleurYaml(m[1].trim()); }
  }
  return '';
}

// ---- Une fiche : valeurs <-> champs bruts, selon le type ------------------------------

// Prépare les champs d'un type pour ecrireTxt() : dans l'ordre du JSON, `title` excepté.
function champsPourEcriture(type, valeurs) {
  const v = valeurs || {};
  const sortie = [];
  for (const c of champsDuType(type)) {
    if (c.cle === 'title') { continue; }
    let brute, forcerMultiligne = false;
    if (c.saisie === 'derive') { brute = valeurDerive(c, v); }
    else if (c.saisie === 'structure') { brute = ecrireListeStructure(v[c.cle]); forcerMultiligne = brute !== ''; }
    else if (c.saisie === 'fichier') { brute = ecrireFichierUnique(v[c.cle]); forcerMultiligne = brute !== ''; }
    else if (c.saisie === 'liste_multiple') { brute = ecrireListeMultiple(v[c.cle]); }
    else { brute = String(v[c.cle] === undefined || v[c.cle] === null ? '' : v[c.cle]).trim(); }
    if (brute === '') { continue; }
    sortie.push({ cle: c.cle, valeurBrute: brute, forcerMultiligne: forcerMultiligne });
  }
  return sortie;
}

// Les champs système (champsSysteme du contrat), non saisis, écrits après Uuid :
// - Ausgabe, toujours écrit, vide pour une fiche orpheline ;
// - Ordre, pour une fiche rattachée à un numéro ;
// - Origine, l'Uuid de la fiche archivée reprise par « Reprendre dans ce numéro ». Il n'est
//   pas relu du disque : l'appelant doit le repasser à chaque écriture pour le conserver.
function champsSystemePourEcriture(ausgabeId, ordre, origine) {
  const sortie = [{ cle: 'ausgabe', valeurBrute: String(ausgabeId === undefined || ausgabeId === null ? '' : ausgabeId), forcerMultiligne: false }];
  if (ordre !== undefined && ordre !== null && String(ordre).trim() !== '') {
    sortie.push({ cle: 'ordre', valeurBrute: String(ordre), forcerMultiligne: false });
  }
  if (origine !== undefined && origine !== null && String(origine).trim() !== '') {
    sortie.push({ cle: 'origine', valeurBrute: String(origine), forcerMultiligne: false });
  }
  return sortie;
}

// Les valeurs d'une fiche depuis le résultat de lireTxt(). Seuls les champs du type sont
// repris : les champs système restent hors des valeurs.
function valeursDepuisChamps(type, title, champsBruts) {
  const v = { title: String(title || '') };
  const bruts = champsBruts || {};
  for (const c of champsDuType(type)) {
    if (c.cle === 'title' || c.saisie === 'derive') { continue; }
    if (c.saisie === 'structure') { v[c.cle] = lireListeStructure(bruts[c.cle] || ''); }
    else if (c.saisie === 'fichier') { v[c.cle] = lireFichierUnique(bruts[c.cle] || ''); }
    else if (c.saisie === 'liste_multiple') { v[c.cle] = lireListeMultiple(bruts[c.cle] || ''); }
    else { v[c.cle] = bruts[c.cle] !== undefined ? bruts[c.cle] : ''; }
  }
  for (const c of champsDuType(type)) {
    if (c.saisie === 'derive') { v[c.cle] = valeurDerive(c, v); }
  }
  return v;
}

// Recopie dans l'autre langue les champs communs : ni `traduire`, ni `title`, ni `derive`
// (recalculé). Dans une structure (`suivi`), les sous-champs communs se recopient ligne à
// ligne, par rang ; les sous-champs `traduire` de la cible restent les siens.
function fusionnerChampsCommuns(type, valeursSource, valeursCibleExistantes) {
  const src = valeursSource || {};
  const cible = Object.assign({}, valeursCibleExistantes || {});
  for (const c of champsDuType(type)) {
    if (c.cle === 'title' || c.traduire || c.saisie === 'derive') { continue; }
    if (c.saisie === 'structure') {
      const lignesSrc = Array.isArray(src[c.cle]) ? src[c.cle] : [];
      const lignesCible = Array.isArray(cible[c.cle]) ? cible[c.cle] : [];
      const clesCommunes = (c.champs || []).filter((sc) => !sc.traduire).map((sc) => sc.cle);
      cible[c.cle] = lignesSrc.map((ligne, i) => {
        const ligneCible = Object.assign({}, lignesCible[i] || {});
        for (const cleSC of clesCommunes) { ligneCible[cleSC] = ligne[cleSC]; }
        return ligneCible;
      });
      continue;
    }
    cible[c.cle] = src[c.cle];
  }
  return cible;
}

// ---- Ordre d'impression des fiches -----------------------------------------------------
//
// Une seule suite 1..N par numéro et par langue : types dans l'ordre `ordreTypes`, puis à
// l'intérieur d'un type selon `tri`.
function valeurTri(fiche, cle) {
  if (cle === 'title') { return String((fiche.valeurs || {}).title || ''); }
  return String((fiche.valeurs || {})[cle] || '');
}
function comparerFichesMemeType(a, b, type, langue) {
  const def = definitionType(type);
  const tri = (def && def.tri) || ['title'];
  const triPremier = (def && def.triPremier) || {};
  for (const cle of tri) {
    const va = valeurTri(a, cle), vb = valeurTri(b, cle);
    if (Object.prototype.hasOwnProperty.call(triPremier, cle)) {
      const pa = va === triPremier[cle] ? 0 : 1, pb = vb === triPremier[cle] ? 0 : 1;
      if (pa !== pb) { return pa - pb; }
    }
    const champ = champDuType(type, cle);
    if (champ && champ.saisie === 'liste') {
      const liste = valeursListe(champ.liste);
      const ia = liste.findIndex((x) => x.jeton === va), ib = liste.findIndex((x) => x.jeton === vb);
      const ra = ia === -1 ? liste.length : ia, rb = ib === -1 ? liste.length : ib;
      if (ra !== rb) { return ra - rb; }
      continue;
    }
    const d = va.localeCompare(vb, langue || 'fr', { sensitivity: 'base', numeric: true });
    if (d !== 0) { return d; }
  }
  return 0;
}
// calculerOrdreFiches([{ type, valeurs, … }], langue) -> les mêmes objets, triés.
function calculerOrdreFiches(fiches, langue) {
  const ordreTypes = typesConnus();
  const parType = new Map();
  for (const t of ordreTypes) { parType.set(t, []); }
  for (const f of (fiches || [])) {
    if (!parType.has(f.type)) { parType.set(f.type, []); }
    parType.get(f.type).push(f);
  }
  const cles = ordreTypes.concat(Array.from(parType.keys()).filter((t) => ordreTypes.indexOf(t) === -1));
  const resultat = [];
  for (const t of cles) {
    const groupe = (parType.get(t) || []).slice();
    if (typeConnu(t)) { groupe.sort((a, b) => comparerFichesMemeType(a, b, t, langue)); }
    resultat.push(...groupe);
  }
  return resultat;
}

// ---- Slug d'une fiche : posé à la création, jamais renommé ---------------------------
const LONGUEUR_MAX_SLUG_FICHE = 48;
function bornerSlugFiche(s) {
  if (s.length <= LONGUEUR_MAX_SLUG_FICHE) { return s; }
  const coupe = s.slice(0, LONGUEUR_MAX_SLUG_FICHE);
  const i = coupe.lastIndexOf('-');
  return i > 0 ? coupe.slice(0, i) : coupe;
}
function slugifierFiche(titre) {
  const s = bornerSlugFiche(slugifier(String(titre || '').replace(/\./g, ' ')));
  return s || 'fiche';
}
function slugFicheUnique(titre, pris) {
  const jeu = pris || new Set();
  const base = slugifierFiche(titre);
  if (!jeu.has(base)) { return base; }
  for (let n = 2; n <= 999; n++) {
    const suffixe = '-' + n;
    let tronc = base;
    if (tronc.length + suffixe.length > LONGUEUR_MAX_SLUG_FICHE) {
      tronc = tronc.slice(0, LONGUEUR_MAX_SLUG_FICHE - suffixe.length).replace(/-+$/, '');
    }
    const candidat = tronc + suffixe;
    if (!jeu.has(candidat)) { return candidat; }
  }
  return base + '-' + Date.now();
}

// ---- Racine de l'arbre, et jeton de revue -> nom de dossier ---------------------------
//
// La bibliothèque vit à la racine de l'arbre, à côté de `Revue`, `Zeitschrift` et
// `_Archive`, car un numéro est archivé, renommé, voire supprimé en fin de cycle.
const DOSSIERS_REVUE = { revue: 'Revue', zeitschrift: 'Zeitschrift' };
const DOSSIERS_PRODUIT = ['revue', 'zeitschrift', 'books'];
const DOSSIER_ARCHIVE = '_archive';
const REVUES = Object.keys(DOSSIERS_REVUE);
const NOM_BIBLIOTHEQUE = '_NewsUndActu';

function nomDe(chemin) { return path.basename(chemin).trim().toLowerCase(); }

// Formes reconnues par le nom des dossiers :
//   <racine>\Revue\2026-01            -> racine = son parent
//   <racine>\_Archive\Revue\2020-05   -> racine = le parent de `_Archive`
//   autre chose                        -> le parent du numéro
function racineArbre(racineNumero) {
  const numero = path.resolve(String(racineNumero === undefined || racineNumero === null ? '' : racineNumero));
  const produit = path.dirname(numero);
  if (produit === numero) { return numero; }
  if (DOSSIERS_PRODUIT.indexOf(nomDe(produit)) === -1) { return produit; }
  const dessus = path.dirname(produit);
  if (dessus === produit) { return produit; }
  if (nomDe(dessus) === DOSSIER_ARCHIVE) { return path.dirname(dessus); }
  return dessus;
}
function autreRevue(revue) {
  const r = String(revue === undefined || revue === null ? '' : revue).toLowerCase();
  if (r === 'revue') { return 'zeitschrift'; }
  if (r === 'zeitschrift') { return 'revue'; }
  return null;
}
function dossierRevue(revue) {
  const r = String(revue === undefined || revue === null ? '' : revue).trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DOSSIERS_REVUE, r) ? DOSSIERS_REVUE[r] : '';
}
function cheminBibliotheque(racineArbreVal) { return path.join(racineArbreVal, NOM_BIBLIOTHEQUE, 'Fiches'); }
function cheminStatutsRacine(racineArbreVal) { return path.join(racineArbreVal, NOM_BIBLIOTHEQUE, '_Statuts'); }

// ---- Un dossier par type sous Fiches\ (types[].dossier du contrat) -------------------
//
// Ce module est le seul à en dériver un chemin.
function dossierDuType(type) {
  const def = definitionType(type);
  return def ? def.dossier : null;
}
// L'ensemble des noms de dossier attendus directement sous Fiches\, dérivé du contrat.
function dossiersAttendus() {
  const set = new Set();
  for (const t of typesConnus()) {
    const d = dossierDuType(t);
    if (d) { set.add(d); }
  }
  return set;
}
function cheminDossierType(racineArbreVal, type) {
  const d = dossierDuType(type);
  return d ? path.join(cheminBibliotheque(racineArbreVal), d) : null;
}
function cheminFiche(racineArbreVal, type, slug) {
  const dt = cheminDossierType(racineArbreVal, type);
  return dt ? path.join(dt, slug) : null;
}

// Une anomalie de rangement (sous-dossier inconnu, fiche sous le dossier d'un autre type)
// va dans la console de l'hôte, sans exception. Le try/catch couvre un hôte sans console.
function avertir(message) {
  try { console.warn('[kirby-contenu] ' + message); } catch (e) { /* hôte sans console */ }
}
function signalerErreur(message) {
  try { console.error('[kirby-contenu] ' + message); } catch (e) { /* hôte sans console */ }
}

// listerNumeros(racineArbreVal) -> [{ id, revue, nom, chemin, archive }], pour les deux
// revues, en cours et archivés. `id` vaut '' pour un numéro sans ausgabe.yaml lisible ou
// sans id encore posé.
function listerNumeros(racineArbreVal) {
  const res = [];
  for (const revue of REVUES) {
    const nomDossier = DOSSIERS_REVUE[revue];
    for (const archive of [false, true]) {
      const base = archive
        ? path.join(racineArbreVal, '_Archive', nomDossier)
        : path.join(racineArbreVal, nomDossier);
      let entrees;
      try { entrees = fs.readdirSync(base, { withFileTypes: true }); } catch (e) { continue; }
      for (const e of entrees) {
        if (!e.isDirectory()) { continue; }
        const chemin = path.join(base, e.name);
        res.push({ id: idNumero(chemin), revue: revue, nom: e.name, chemin: chemin, archive: archive });
      }
    }
  }
  return res;
}
// idsEnDouble(racineArbreVal) -> [[{ id, revue, nom, chemin, archive }, …], …] — un tableau
// par id porté par plus d'un numéro. Sert à avertir, sans refuser, à l'ouverture d'un
// numéro dont l'id se retrouve ailleurs dans l'arbre.
function idsEnDouble(racineArbreVal) {
  const parId = {};
  for (const n of listerNumeros(racineArbreVal)) {
    if (!n.id) { continue; }
    (parId[n.id] = parId[n.id] || []).push(n);
  }
  return Object.keys(parId).map((id) => parId[id]).filter((l) => l.length > 1);
}

// ---- La bibliothèque : lire, écrire, lister une fiche par (type, slug) + langue -------

// Le fichier <typeAttendu>.<langue>.txt d'un dossier de fiche, ou null. Un fichier d'un
// autre type connu est rangé au mauvais endroit : signalé en erreur et ignoré. Un fichier
// de type inconnu n'est pas une fiche : ignoré sans message.
function ficheDeDossierSlug(cheminSlug, langue, typeAttendu) {
  let fichiers;
  try { fichiers = fs.readdirSync(cheminSlug); } catch (e) { return null; }
  const suffixe = '.' + langue + '.txt';
  let trouve = null;
  for (const nom of fichiers) {
    if (nom.slice(-suffixe.length) !== suffixe) { continue; }
    const type = nom.slice(0, nom.length - suffixe.length).toLowerCase();
    if (!typeConnu(type)) { continue; }
    if (type !== typeAttendu) {
      signalerErreur('fichier ' + nom + ' rangé sous le dossier du type « ' + typeAttendu
        + ' » (' + cheminSlug + ') : ignoré, jamais lu.');
      continue;
    }
    trouve = { type: type, nomFichier: nom };
  }
  return trouve;
}

// listerSlugsBibliotheque(racineArbreVal) -> [{ type, slug }, …] : parcourt Fiches\<dossier>\*
// pour chaque type connu du contrat. Un sous-dossier de Fiches\ qui n'est le dossier d'aucun
// type est ignoré, avec un avertissement.
function listerSlugsBibliotheque(racineArbreVal) {
  const racineFiches = cheminBibliotheque(racineArbreVal);
  let entreesRacine;
  try { entreesRacine = fs.readdirSync(racineFiches, { withFileTypes: true }); }
  catch (e) { return []; }
  const attendus = dossiersAttendus();
  const typeDuDossier = new Map();
  for (const t of typesConnus()) {
    const d = dossierDuType(t);
    if (d) { typeDuDossier.set(d, t); }
  }
  const res = [];
  for (const e of entreesRacine) {
    if (!e.isDirectory()) { continue; }
    if (!attendus.has(e.name)) {
      avertir('sous-dossier inconnu du contrat sous Fiches\\ : « ' + e.name + ' » — ignoré.');
      continue;
    }
    const type = typeDuDossier.get(e.name);
    let sousEntrees;
    try { sousEntrees = fs.readdirSync(path.join(racineFiches, e.name), { withFileTypes: true }); }
    catch (err) { continue; }
    for (const se of sousEntrees) {
      if (se.isDirectory()) { res.push({ type: type, slug: se.name }); }
    }
  }
  return res;
}
// Les slugs déjà pris dans le dossier d'un type : creerFiche() évite les collisions dans ce
// seul dossier, deux types pouvant partager un slug.
function ensembleSlugsExistantsPourType(racineArbreVal, type) {
  const chemin = cheminDossierType(racineArbreVal, type);
  if (!chemin) { return new Set(); }
  let entrees;
  try { entrees = fs.readdirSync(chemin, { withFileTypes: true }); } catch (e) { return new Set(); }
  return new Set(entrees.filter((e) => e.isDirectory()).map((e) => e.name));
}

// lireFicheSlugLangue(racineArbreVal, slug, langue, type?) -> { slug, uuid, type, ausgabe,
// ordre, origine, valeurs } | null. `ordre` est un entier, ou null si la fiche n'a pas de
// rang. Avec `type`, seul le dossier de ce type est lu. Sans `type`, tous les dossiers de
// type sont parcourus (à réserver aux actions ponctuelles) ; si le slug existe sous
// plusieurs types, le premier est retenu, avec un avertissement.
function lireFicheSlugLangue(racineArbreVal, slug, langue, type) {
  const typesACherche = type ? [type] : typesConnus();
  const trouvees = [];
  for (const t of typesACherche) {
    const cheminSlug = cheminFiche(racineArbreVal, t, slug);
    if (!cheminSlug) { continue; }
    const info = ficheDeDossierSlug(cheminSlug, langue, t);
    if (!info) { continue; }
    let brut;
    try { brut = fs.readFileSync(path.join(cheminSlug, info.nomFichier), 'utf8'); }
    catch (e) { continue; }
    const { title, uuid, champs } = lireTxt(brut);
    const ausgabe = String(champs.ausgabe || '');
    const ordreBrut = champs.ordre;
    const ordre = (ordreBrut !== undefined && String(ordreBrut).trim() !== '') ? parseInt(ordreBrut, 10) : null;
    const origine = String(champs.origine || '');
    trouvees.push({
      slug: slug, uuid: uuid, type: t, ausgabe: ausgabe,
      ordre: (Number.isFinite(ordre) ? ordre : null), origine: origine,
      valeurs: valeursDepuisChamps(t, title, champs)
    });
  }
  if (trouvees.length > 1) {
    avertir('le slug « ' + slug + '.' + langue + ' » existe dans plusieurs dossiers de type ('
      + trouvees.map((f) => f.type).join(', ') + ') : le premier est retenu.');
  }
  return trouvees[0] || null;
}
// trouverSlugParUuid(racineArbreVal, langue, uuid) -> comme lireFicheSlugLangue, en
// cherchant le slug par Uuid. Parcourt toute la bibliothèque : à réserver aux actions
// ponctuelles (statuts, réservoir), pas à l'affichage d'une liste.
function trouverSlugParUuid(racineArbreVal, langue, uuid) {
  for (const { type, slug } of listerSlugsBibliotheque(racineArbreVal)) {
    const f = lireFicheSlugLangue(racineArbreVal, slug, langue, type);
    if (f && f.uuid === uuid) { return slug; }
  }
  return null;
}

// installerImage(cheminDossier, cheminSource) -> le nom écrit. Retire le préfixe « <id>__ »
// du dépôt provisoire ; un nom déjà pris reçoit un suffixe -2, -3…
function installerImage(cheminDossier, cheminSource) {
  fs.mkdirSync(cheminDossier, { recursive: true });
  const brut = path.basename(cheminSource).replace(/^[^_]*__/, '');
  const point = brut.lastIndexOf('.');
  const radical = point === -1 ? brut : brut.slice(0, point);
  const ext = point === -1 ? '' : brut.slice(point);
  let nom = brut, i = 1;
  while (fs.existsSync(path.join(cheminDossier, nom))) { i++; nom = radical + '-' + i + ext; }
  fs.copyFileSync(cheminSource, path.join(cheminDossier, nom));
  return nom;
}

// Écrit le fichier <type>.<langue>.txt d'un slug, et supprime tout autre fichier de cette
// langue dans le dossier. Le dossier n'est jamais renommé.
function ecrireFicheSlugLangue(racineArbreVal, slug, langue, type, uuid, valeurs, ausgabeId, ordre, imageSource, origine) {
  const cheminSlug = cheminFiche(racineArbreVal, type, slug);
  fs.mkdirSync(cheminSlug, { recursive: true });
  const v = Object.assign({}, valeurs);
  if (imageSource) {
    const cle = champFichierDuType(type);
    if (cle) { v[cle] = installerImage(cheminSlug, imageSource); }
  }
  const nomVoulu = nomFichierContenu(type, langue);
  let fichiers;
  try { fichiers = fs.readdirSync(cheminSlug); } catch (e) { fichiers = []; }
  const suffixe = '.' + langue + '.txt';
  for (const nom of fichiers) {
    if (nom.slice(-suffixe.length) === suffixe && nom !== nomVoulu) {
      try { fs.unlinkSync(path.join(cheminSlug, nom)); } catch (e) { /* déjà parti */ }
    }
  }
  const champs = champsSystemePourEcriture(ausgabeId, ordre, origine).concat(champsPourEcriture(type, v));
  const texte = ecrireTxt({ title: String(v.title || ''), uuid: uuid, champs: champs });
  ecrireAtomique(path.join(cheminSlug, nomVoulu), texte);
}

// creerFiche(racineArbreVal, langue, type, valeurs, ausgabeId, imageSource?, origine?) ->
// { uuid, slug }. Uuid et slug sont posés ici et ne changent plus. `origine` : Uuid de la
// fiche archivée reprise (reprendreDansNumero). `uuidImpose` : Uuid tiré d'avance par
// l'acceptation d'une proposition, déjà écrit dans sa décision (lib/propositions.js).
function creerFiche(racineArbreVal, langue, type, valeurs, ausgabeId, imageSource, origine, uuidImpose) {
  if (!typeConnu(type)) { throw new Error('creerFiche : type de fiche inconnu « ' + type + ' ».'); }
  if (uuidImpose !== undefined && uuidImpose !== null && !/^[A-Za-z0-9]{16}$/.test(String(uuidImpose))) {
    throw new Error('creerFiche : uuid imposé mal formé « ' + uuidImpose + ' ».');
  }
  const uuid = (uuidImpose === undefined || uuidImpose === null) ? genererUuid() : String(uuidImpose);
  const slug = slugFicheUnique((valeurs || {}).title || '', ensembleSlugsExistantsPourType(racineArbreVal, type));
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, type, uuid, valeurs, ausgabeId, null, imageSource, origine);
  return { uuid: uuid, slug: slug };
}

// enregistrerFicheLangue(racineArbreVal, slug, langue, type, valeurs, imageSource?) ->
// { ok, uuid, raison? }. Réécrit le fichier de cette langue en gardant Ausgabe, Ordre et
// Origine, puis recopie les champs communs dans les autres langues existantes. Le type d'une
// fiche ne change pas : un slug trouvé sous un autre type rend
// raison: 'changement-de-type-refuse', distinct d'une fiche introuvable.
function enregistrerFicheLangue(racineArbreVal, slug, langue, type, valeurs, imageSource) {
  const existante = lireFicheSlugLangue(racineArbreVal, slug, langue, type);
  if (!existante) {
    const ailleurs = lireFicheSlugLangue(racineArbreVal, slug, langue);
    if (ailleurs && ailleurs.type !== type) {
      signalerErreur('enregistrerFicheLangue : changement de type refusé pour « ' + slug
        + ' » (' + ailleurs.type + ' -> ' + type + ').');
      return { ok: false, raison: 'changement-de-type-refuse' };
    }
    return { ok: false };
  }
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, type, existante.uuid, valeurs, existante.ausgabe, existante.ordre, imageSource, existante.origine);
  for (const autre of autresLangues(langue)) {
    const ficheAutre = lireFicheSlugLangue(racineArbreVal, slug, autre, type);
    if (!ficheAutre) { continue; }
    const fusion = fusionnerChampsCommuns(type, valeurs, ficheAutre.valeurs);
    ecrireFicheSlugLangue(racineArbreVal, slug, autre, type, ficheAutre.uuid, fusion, ficheAutre.ausgabe, ficheAutre.ordre, null, ficheAutre.origine);
  }
  return { ok: true, uuid: existante.uuid };
}

// detacherFiche(racineArbreVal, slug, langue) -> { ok } : rend la fiche orpheline (Ausgabe
// vidé). Chaque fichier de langue a son propre rattachement : l'autre langue est inchangée.
function detacherFiche(racineArbreVal, slug, langue) {
  const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (!f) { return { ok: false }; }
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, f.type, f.uuid, f.valeurs, '', null, null, f.origine);
  return { ok: true, ausgabeAvant: f.ausgabe };
}

// tirerDansNumero(racineArbreVal, slug, langue, ausgabeIdCible) -> { ok } : rattache une
// orpheline de cette langue au numéro donné.
function tirerDansNumero(racineArbreVal, slug, langue, ausgabeIdCible) {
  const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (!f) { return { ok: false }; }
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, f.type, f.uuid, f.valeurs, ausgabeIdCible, null, null, f.origine);
  return { ok: true };
}

// reprendreDansNumero(racineSourceVal, racineCibleVal, langueCible, type, slugSource,
// ausgabeIdCible) -> { ok, uuid, slug, raison? } : « Reprendre dans ce numéro », onglet
// Archive (documentation-hote.js). racineSourceVal est la bibliothèque de production, même
// en mode test ; racineCibleVal celle du numéro ouvert. Crée une fiche neuve (nouvel Uuid,
// via creerFiche) dont `origine` garde l'Uuid de la source, qui n'est pas modifiée. Les
// valeurs viennent de la langue cible de la source si elle existe, sinon d'une autre
// langue. L'image est copiée ; si elle manque sur le disque (synchronisation partielle), le
// champ est vidé plutôt que de pointer vers un fichier absent.
function reprendreDansNumero(racineSourceVal, racineCibleVal, langueCible, type, slugSource, ausgabeIdCible) {
  if (!typeConnu(type)) { return { ok: false, raison: 'type-inconnu' }; }
  let source = lireFicheSlugLangue(racineSourceVal, slugSource, langueCible, type);
  if (!source) {
    for (const l of autresLangues(langueCible)) {
      source = lireFicheSlugLangue(racineSourceVal, slugSource, l, type);
      if (source) { break; }
    }
  }
  if (!source) { return { ok: false, raison: 'source-absente' }; }
  const valeurs = Object.assign({}, source.valeurs);
  let imageSource = null;
  const cleFichier = champFichierDuType(type);
  if (cleFichier && valeurs[cleFichier]) {
    const cheminSource = path.join(cheminFiche(racineSourceVal, type, slugSource), valeurs[cleFichier]);
    if (fs.existsSync(cheminSource)) { imageSource = cheminSource; }
    else { delete valeurs[cleFichier]; }
  }
  const cree = creerFiche(racineCibleVal, langueCible, type, valeurs, ausgabeIdCible, imageSource, source.uuid);
  return { ok: true, uuid: cree.uuid, slug: cree.slug };
}

// traduireDansNumero(racineArbreVal, slug, langueCible, ausgabeIdCible) -> { ok, uuid } :
// crée le fichier de la langue cible, prérempli avec toutes les valeurs de l'autre langue
// (point de départ de la traduction), même Uuid, rattaché au numéro cible. Efface le statut
// de traduction. Refuse si la langue cible existe déjà.
function traduireDansNumero(racineArbreVal, slug, langueCible, ausgabeIdCible) {
  if (lireFicheSlugLangue(racineArbreVal, slug, langueCible)) { return { ok: false, raison: 'existe-deja' }; }
  let source = null;
  for (const l of autresLangues(langueCible)) {
    source = lireFicheSlugLangue(racineArbreVal, slug, l);
    if (source) { break; }
  }
  if (!source) { return { ok: false, raison: 'source-absente' }; }
  ecrireFicheSlugLangue(racineArbreVal, slug, langueCible, source.type, source.uuid,
    Object.assign({}, source.valeurs), ausgabeIdCible, null, null, source.origine);
  effacerStatutFiche(racineArbreVal, langueCible, source.uuid);
  return { ok: true, uuid: source.uuid };
}

// supprimerFicheLangue(racineArbreVal, slug, langue) -> { ok, autreLangueRestante } : ôte le
// fichier de cette langue, et le dossier entier (image comprise) s'il n'en reste aucune.
// Aucune condition de rattachement : supprimerFicheOrpheline() la restreint aux orphelines,
// le message SUPPRIMER_FICHE_NUMERO (documentation-hote.js) l'applique à une fiche du numéro.
function supprimerFicheLangue(racineArbreVal, slug, langue) {
  const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (!f) { return { ok: false }; }
  const cheminSlug = cheminFiche(racineArbreVal, f.type, slug);
  const nomFichier = nomFichierContenu(f.type, langue);
  try { fs.unlinkSync(path.join(cheminSlug, nomFichier)); } catch (e) { return { ok: false }; }
  let reste;
  try { reste = fs.readdirSync(cheminSlug); } catch (e) { reste = []; }
  const autreLangueRestante = reste.some((n) => /\.[a-z]{2}\.txt$/i.test(n));
  if (!autreLangueRestante) {
    try { fs.rmSync(cheminSlug, { recursive: true, force: true }); } catch (e) { /* déjà parti */ }
  }
  return { ok: true, autreLangueRestante: autreLangueRestante };
}

// supprimerFicheOrpheline(racineArbreVal, slug, langue) -> { ok } : idem, mais refuse une
// fiche rattachée (raison: 'rattachee'). Sert à « Mes orphelines ».
function supprimerFicheOrpheline(racineArbreVal, slug, langue) {
  const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (!f) { return { ok: false }; }
  if (f.ausgabe) { return { ok: false, raison: 'rattachee' }; }
  return supprimerFicheLangue(racineArbreVal, slug, langue);
}

// reordonnerNumero(racineArbreVal, langue, ausgabeId) -> { total } : recalcule le champ
// Ordre de toutes les fiches de ce numéro et cette langue, écrit seulement celles dont le
// rang a changé.
function reordonnerNumero(racineArbreVal, langue, ausgabeId) {
  if (!ausgabeId) { return { total: 0 }; }
  const fiches = listerSlugsBibliotheque(racineArbreVal)
    .map(({ type, slug }) => lireFicheSlugLangue(racineArbreVal, slug, langue, type))
    .filter((f) => f && f.ausgabe === ausgabeId);
  const ordonnees = calculerOrdreFiches(fiches, langue);
  let total = 0;
  ordonnees.forEach((f, i) => {
    const rang = i + 1;
    if (f.ordre !== rang) {
      ecrireFicheSlugLangue(racineArbreVal, f.slug, langue, f.type, f.uuid, f.valeurs, f.ausgabe, rang, null, f.origine);
      total++;
    }
  });
  return { total: total };
}

// listerFichesNumero(racineArbreVal, langue, ausgabeId) -> les fiches rattachées à ce
// numéro dans cette langue, triées par leur champ Ordre (à jour si reordonnerNumero() a
// suivi le dernier enregistrement).
function listerFichesNumero(racineArbreVal, langue, ausgabeId) {
  if (!ausgabeId) { return []; }
  const fiches = listerSlugsBibliotheque(racineArbreVal)
    .map(({ type, slug }) => lireFicheSlugLangue(racineArbreVal, slug, langue, type))
    .filter((f) => f && f.ausgabe === ausgabeId);
  fiches.sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  return fiches;
}

// listerOrphelines(racineArbreVal, langue) -> les fiches de cette langue sans numéro.
function listerOrphelines(racineArbreVal, langue) {
  return listerSlugsBibliotheque(racineArbreVal)
    .map(({ type, slug }) => lireFicheSlugLangue(racineArbreVal, slug, langue, type))
    .filter((f) => f && !f.ausgabe);
}

// ---- L'onglet Archive : toute la bibliothèque, toutes langues, tous numéros ----------
//
// listerBibliothequeComplete(racineArbreVal) -> [{ type, slug, parLangue: { fr: fiche|null,
// de: fiche|null } }, …], une entrée par (type, slug). `fiche` est le résultat de
// lireFicheSlugLangue, ou null si la langue manque. Lit des centaines de fichiers sur
// OneDrive : à appeler sur action explicite (bouton, ouverture de l'onglet), pas à chaque
// rendu du formulaire.
function listerBibliothequeComplete(racineArbreVal) {
  const langues = languesDuContrat();
  return listerSlugsBibliotheque(racineArbreVal).map(({ type, slug }) => {
    const parLangue = {};
    for (const l of langues) { parLangue[l] = lireFicheSlugLangue(racineArbreVal, slug, l, type); }
    return { type: type, slug: slug, parLangue: parLangue };
  });
}

// ---- Statuts de traduction : _NewsUndActu\_Statuts\<langue>\<uuid>.txt ----------------
//
// Format propre, sans Title ni Uuid :
//   Statut: a-traduire        (ou : ignore)
//   ----
//   Date: 2026-09-23
function cheminStatutFichier(racineArbreVal, langueCible, uuid) {
  return path.join(cheminStatutsRacine(racineArbreVal), langueCible, uuid + '.txt');
}
function ecrireStatutFiche(racineArbreVal, langueCible, uuid, statut) {
  const chemin = cheminStatutFichier(racineArbreVal, langueCible, uuid);
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  const texte = 'Statut: ' + String(statut) + '\n\n----\n\nDate: ' + new Date().toISOString().slice(0, 10) + '\n';
  ecrireAtomique(chemin, texte);
}
function lireStatutFiche(racineArbreVal, langueCible, uuid) {
  let brut;
  try { brut = fs.readFileSync(cheminStatutFichier(racineArbreVal, langueCible, uuid), 'utf8'); }
  catch (e) { return null; }
  const mStatut = brut.match(/^Statut:\s?(.*)$/mi);
  const mDate = brut.match(/^Date:\s?(.*)$/mi);
  const statut = mStatut ? mStatut[1].trim() : '';
  if (!statut) { return null; }
  return { statut: statut, date: mDate ? mDate[1].trim() : '' };
}
function effacerStatutFiche(racineArbreVal, langueCible, uuid) {
  try { fs.unlinkSync(cheminStatutFichier(racineArbreVal, langueCible, uuid)); return true; }
  catch (e) { return false; }
}

// ---- Les deux vues du réservoir ---------------------------------------------------------

// listerTraductionsATraire(racineArbreVal, langueCible) -> fiches d'une autre langue,
// rattachées ou non, sans fichier dans la langue cible, au statut a-traduire.
function listerTraductionsATraire(racineArbreVal, langueCible) {
  const res = [];
  for (const { type, slug } of listerSlugsBibliotheque(racineArbreVal)) {
    if (lireFicheSlugLangue(racineArbreVal, slug, langueCible, type)) { continue; }
    for (const l of autresLangues(langueCible)) {
      const source = lireFicheSlugLangue(racineArbreVal, slug, l, type);
      if (!source) { continue; }
      const statut = lireStatutFiche(racineArbreVal, langueCible, source.uuid);
      if (statut && statut.statut === 'a-traduire') {
        res.push({
          slug: slug, uuid: source.uuid, type: source.type, titreSource: source.valeurs.title,
          langueSource: l, ausgabeSource: source.ausgabe
        });
      }
      break;
    }
  }
  return res;
}

// listerReservoir(racineArbreVal, langueCible, { avecIgnorees }) -> fiches d'une autre
// langue rattachées à un numéro, sans fichier dans la langue cible et sans statut. Avec
// avecIgnorees (interrupteur « afficher les ignorées »), seulement celles au statut ignore.
function listerReservoir(racineArbreVal, langueCible, options) {
  const avecIgnorees = !!(options && options.avecIgnorees);
  const res = [];
  for (const { type, slug } of listerSlugsBibliotheque(racineArbreVal)) {
    if (lireFicheSlugLangue(racineArbreVal, slug, langueCible, type)) { continue; }
    for (const l of autresLangues(langueCible)) {
      const source = lireFicheSlugLangue(racineArbreVal, slug, l, type);
      if (!source || !source.ausgabe) { continue; }
      const statut = lireStatutFiche(racineArbreVal, langueCible, source.uuid);
      const estATraire = !!(statut && statut.statut === 'a-traduire');
      const estIgnoree = !!(statut && statut.statut === 'ignore');
      if (estATraire) { continue; }
      if (avecIgnorees !== estIgnoree) { continue; }
      res.push({
        slug: slug, uuid: source.uuid, type: source.type, titreSource: source.valeurs.title,
        langueSource: l, ausgabeSource: source.ausgabe, ignoree: estIgnoree
      });
      break;
    }
  }
  return res;
}

// ---- Dépôt provisoire d'une image, avant que la fiche existe -------------------------
//
// Dans os.tmpdir(), propre au poste et non synchronisé, pour ne rien laisser traîner dans
// Fiches\. `id` est l'identifiant de la carte dans la webview : la fiche n'a pas encore
// d'Uuid.
function dossierDepotImages() { return path.join(os.tmpdir(), 'szh-cockpit-depot-fiches'); }
function nettoyerImageProvisoire(id) {
  const dossier = dossierDepotImages();
  let noms;
  try { noms = fs.readdirSync(dossier); } catch (e) { return; }
  const prefixe = String(id) + '__';
  for (const n of noms) { if (n.indexOf(prefixe) === 0) { try { fs.unlinkSync(path.join(dossier, n)); } catch (e) { /* déjà parti */ } } }
}
function deposerImageProvisoire(id, nomFichier, donnees) {
  const dossier = dossierDepotImages();
  fs.mkdirSync(dossier, { recursive: true });
  nettoyerImageProvisoire(id);
  const cible = path.join(dossier, String(id) + '__' + nomFichier);
  fs.writeFileSync(cible, donnees);
  return cible;
}
function imageProvisoire(id) {
  const dossier = dossierDepotImages();
  let noms;
  try { noms = fs.readdirSync(dossier); } catch (e) { return null; }
  const prefixe = String(id) + '__';
  const trouve = noms.find((n) => n.indexOf(prefixe) === 0);
  return trouve ? path.join(dossier, trouve) : null;
}

// ---- La page (documentation.<lang>.txt) : titre, uuid, rubriques ---------------------
// Elle vit dans le dossier de l'article du numéro (dossierArticle).

function lirePage(dossierArticle, langue) {
  const nomFichier = nomFichierContenu((contrat().kirby || {}).pageDocumentation || 'documentation', langue);
  let brut;
  try { brut = fs.readFileSync(path.join(dossierArticle, nomFichier), 'utf8'); }
  catch (e) { return { title: '', uuid: '', rubriques: {} }; }
  const { title, uuid, champs } = lireTxt(brut);
  const rubriques = {};
  for (const r of rubriquesDuContrat()) { rubriques[r.cle] = champs[r.cle] || ''; }
  return { title: title, uuid: uuid, rubriques: rubriques };
}
function ecrirePage(dossierArticle, langue, donnees) {
  const d = donnees || {};
  const nomFichier = nomFichierContenu((contrat().kirby || {}).pageDocumentation || 'documentation', langue);
  const uuid = d.uuid || genererUuid();
  const champsAEcrire = [];
  for (const r of rubriquesDuContrat()) {
    const val = String(((d.rubriques || {})[r.cle]) || '').trim();
    if (val !== '') { champsAEcrire.push({ cle: r.cle, valeurBrute: val, forcerMultiligne: true }); }
  }
  const texte = ecrireTxt({ title: String(d.title || ''), uuid: uuid, champs: champsAEcrire });
  ecrireAtomique(path.join(dossierArticle, nomFichier), texte);
  return { uuid: uuid };
}

// lireDocumentation : la page du numéro (rubriques) et ses fiches rattachées (bibliothèque),
// pour l'ouverture du formulaire en un seul appel.
function lireDocumentation(dossierArticle, racineArbreVal, langue, ausgabeId) {
  return { page: lirePage(dossierArticle, langue), fiches: listerFichesNumero(racineArbreVal, langue, ausgabeId) };
}

module.exports = {
  // Contrat
  chargerContrat, oublierContrat, cheminDuContrat, contrat,
  typeConnu, typesConnus, definitionType, champsDuType, champDuType, libelleType, libelleCockpitType, libelleLienType,
  champFichierDuType, rubriquesDuContrat, rubriquesPourRevue, valeursListe,
  languesDuContrat, autresLangues,
  // Validation
  dateValide, datePartielleValide, anneeValide, quandSatisfait,
  // Dérivés
  valeurDerive, curiaDepuis, ordreInstruments, instrumentEstLocal, cantonsInstrument,
  // Complétude
  champsManquants, ficheComplete, ficheEcrivable,
  // Identifiant
  genererUuid,
  // Fichier .txt Kirby (bas niveau, pour les tests d'aller-retour)
  lireTxt, ecrireTxt, separateur,
  ecrireListeStructure, lireListeStructure, ecrireFichierUnique, lireFichierUnique,
  ecrireListeMultiple, lireListeMultiple,
  champsPourEcriture, valeursDepuisChamps, fusionnerChampsCommuns,
  // Ordre
  calculerOrdreFiches, slugifierFiche, slugFicheUnique,
  nomFichierContenu, estFichierPageDocumentation,
  // Racine de l'arbre, revues, numéros
  DOSSIERS_REVUE, DOSSIERS_PRODUIT, DOSSIER_ARCHIVE, REVUES, NOM_BIBLIOTHEQUE,
  racineArbre, autreRevue, dossierRevue, cheminBibliotheque, cheminStatutsRacine,
  listerNumeros, idsEnDouble,
  // Un dossier par type sous Fiches\ (types[].dossier du contrat)
  dossierDuType, cheminDossierType, cheminFiche,
  // La bibliothèque : une fiche par (type, slug) + langue
  listerSlugsBibliotheque, lireFicheSlugLangue, trouverSlugParUuid,
  creerFiche, enregistrerFicheLangue, detacherFiche, tirerDansNumero, traduireDansNumero,
  reprendreDansNumero,
  supprimerFicheOrpheline, supprimerFicheLangue, reordonnerNumero, listerFichesNumero, listerOrphelines,
  listerBibliothequeComplete,
  installerImage,
  // Statuts de traduction
  ecrireStatutFiche, lireStatutFiche, effacerStatutFiche,
  listerTraductionsATraire, listerReservoir,
  // Image d'une fiche : dépôt provisoire avant qu'elle existe (hors bibliothèque)
  deposerImageProvisoire, imageProvisoire, nettoyerImageProvisoire, dossierDepotImages,
  // La page (rubriques du numéro)
  lirePage, ecrirePage, lireDocumentation
};
