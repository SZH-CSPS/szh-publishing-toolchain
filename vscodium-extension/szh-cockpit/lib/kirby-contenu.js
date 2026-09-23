// Lecture et écriture de l'arborescence Kirby de la Documentation d'un numéro
// (« Actualité et ressources » / « News & Ressourcen ») : documentation.<lang>.txt à la
// racine de l'article, un dossier <n>_<slug>/ par fiche, chacun avec son <type>.<lang>.txt
// et son image éventuelle. Remplace lib/ressources.js et lib/rubriques.js — l'ancien format
// (blocs ::: dans le .md) n'est plus lu ni écrit nulle part.
//
// Source de vérité des champs : pipeline/kirby/champs-documentation.json (chargé ici,
// jamais recopié). Aucune table de types, de listes ou de libellés ne vit dans ce fichier :
// tout vient du contrat, comme docs/FORMAT-DOCUMENTATION-KIRBY.md le décrit.
//
// ⚠ Pur, comme lib/citations.js et lib/reserve.js : aucun require('vscode'). L'hôte
// (lib/documentation-hote.js) fait les allers-retours avec la webview et refuse un numéro
// verrouillé ; ce module ne fait que lire et écrire des fichiers.
//
// ---- Le fichier .txt d'une fiche ou de la page --------------------------------------
//
// Écrit Title puis Uuid puis les champs du type dans l'ordre du JSON, séparés par une
// ligne « ---- » isolée par un blanc de chaque côté (lireTxt/ecrireTxt, symétriques au
// caractère près pour un aller-retour). Un champ vide ne s'écrit pas.
//
// ---- Sécurité du renommage des dossiers de fiches ------------------------------------
//
// Même parti que lib/renumerotation.js pour les dossiers d'article : un dossier qui doit
// changer de nom passe par un temporaire qui PORTE sa destination
// (« ~kirby-tmp-<destination> ») avant de la rejoindre. reordonnerFiches() est donc
// idempotente — la rappeler après une interruption termine le lot là où il s'est arrêté,
// sans qu'il faille une fonction de reprise séparée : les fiches se relisent par leur
// contenu (le nom du dossier ne compte pour rien), et le plan recalculé est le même.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { slugifier } = require('./slug');
const { ecrireAtomique } = require('./yaml');
const { basePoste } = require('./chemins-poste');

// ---- Chargement du contrat : dépôt d'abord, puis toolkit/ -------------------------
// Même disposition que lib/citations.js (FILTRES, emplacements()) : le dépôt pour le
// développement et les tests, le toolkit installé pour un poste de rédaction.
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

// Relâche le contrat mémoïsé : un test change d'emplacement en cours de processus.
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
// Les instruments dont `cantons` porte le canton choisi viennent en tête, dans l'ordre du
// JSON ; les autres suivent, même ordre. Le libellé (canton entre parenthèses pour un
// instrument `local`) est composé par l'appelant, qui seul connaît la langue et
// lib/cantons.js — ce module ne rend que l'ordre des jetons.
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
    const vide = c.saisie === 'structure'
      ? !(Array.isArray(val) && val.length > 0)
      : String(val === undefined || val === null ? '' : val).trim() === '';
    if (vide) { manquants.push(c.cle); }
  }
  return manquants;
}
function ficheComplete(type, valeurs) { return champsManquants(type, valeurs).length === 0; }

// Ce qui suffit pour écrire une fiche : au moins un champ non vide (même incomplète —
// c'est la pastille du formulaire qui dit ce qui manque, pas un refus d'écrire).
function ficheEcrivable(type, valeurs) {
  if (!typeConnu(type)) { return false; }
  const v = valeurs || {};
  return champsDuType(type).some((c) => {
    if (c.saisie === 'derive') { return false; }          // jamais saisi
    const val = v[c.cle];
    if (c.saisie === 'structure') { return Array.isArray(val) && val.length > 0; }
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
function nomDossierFiche(n, slug) {
  const gabarit = (contrat().kirby || {}).prefixeOrdre || '{n}_{slug}';
  return gabarit.replace('{n}', String(n)).replace('{slug}', slug);
}

// Une ligne de valeur qui vaut exactement le séparateur s'échappe d'un antislash — et
// seulement celle-là, jamais une ligne qui le contiendrait au milieu d'autre chose.
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
// `champs` ne porte ni title ni uuid, extraits à part comme le veut le format (toujours en
// tête du fichier). Une ligne d'ouverture illisible (hors a-z0-9_ suivi de ':') est
// ignorée : mieux vaut perdre un champ trafiqué que faire échouer toute la lecture.
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
// `champs` doit déjà être dans l'ordre voulu, sans title ni uuid — voir champsPourEcriture
// plus bas, qui les prépare depuis le contrat.
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
// Dévalorise un scalaire YAML tel que le Panel de Kirby peut l'écrire : entre guillemets
// doubles (échappés), entre apostrophes (doublées), ou nu.
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

// Prépare les champs d'un type pour ecrireTxt() : dans l'ordre du JSON, `title` excepté
// (déjà écrit à part), un champ vide non écrit, `derive` toujours recalculé.
function champsPourEcriture(type, valeurs) {
  const v = valeurs || {};
  const sortie = [];
  for (const c of champsDuType(type)) {
    if (c.cle === 'title') { continue; }
    let brute, forcerMultiligne = false;
    if (c.saisie === 'derive') { brute = valeurDerive(c, v); }
    else if (c.saisie === 'structure') { brute = ecrireListeStructure(v[c.cle]); forcerMultiligne = brute !== ''; }
    else if (c.saisie === 'fichier') { brute = ecrireFichierUnique(v[c.cle]); forcerMultiligne = brute !== ''; }
    else { brute = String(v[c.cle] === undefined || v[c.cle] === null ? '' : v[c.cle]).trim(); }
    if (brute === '') { continue; }
    sortie.push({ cle: c.cle, valeurBrute: brute, forcerMultiligne: forcerMultiligne });
  }
  return sortie;
}

// Les valeurs d'une fiche depuis ce que lireTxt() a rendu (title à part, `champs` bruts).
function valeursDepuisChamps(type, title, champsBruts) {
  const v = { title: String(title || '') };
  const bruts = champsBruts || {};
  for (const c of champsDuType(type)) {
    if (c.cle === 'title' || c.saisie === 'derive') { continue; }
    if (c.saisie === 'structure') { v[c.cle] = lireListeStructure(bruts[c.cle] || ''); }
    else if (c.saisie === 'fichier') { v[c.cle] = lireFichierUnique(bruts[c.cle] || ''); }
    else { v[c.cle] = bruts[c.cle] !== undefined ? bruts[c.cle] : ''; }
  }
  for (const c of champsDuType(type)) {
    if (c.saisie === 'derive') { v[c.cle] = valeurDerive(c, v); }
  }
  return v;
}

// ---- Ordre d'impression des fiches, et nom de leur dossier ---------------------------
//
// Une seule suite 1..N : types dans l'ordre `ordreTypes`, puis à l'intérieur d'un type
// selon `tri` — `triPremier` fait passer une valeur donnée en tête sans égard à l'ordre
// alphabétique, un champ `liste` se compare par la position de son jeton dans la liste
// (ce qui donne « portée » dans l'ordre déclaré, pas alphabétique), tout le reste se
// compare en toutes lettres dans la langue de l'article.
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
// calculerOrdreFiches([{ type, valeurs }], langue) -> les mêmes fiches, dans l'ordre voulu.
function calculerOrdreFiches(fiches, langue) {
  const ordreTypes = typesConnus();
  const parType = new Map();
  for (const t of ordreTypes) { parType.set(t, []); }
  for (const f of (fiches || [])) {
    if (!parType.has(f.type)) { parType.set(f.type, []); }   // type inconnu : groupé à part, en fin
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

// Slug d'une fiche : translittération + minuscules + tirets (lib/slug.js), les points
// neutralisés en amont — slugifier() les prend pour une extension de fichier, ce qu'un
// titre de fiche n'a jamais (voir lib/reserve.js, segmentAssaini, même piège).
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
// Suffixe -2, -3… pour deux fiches de même titre, dans le même lot de dossiers.
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

// calculerNoms(fiches, langue) -> fiches ordonnées, chacune avec `position` (1..N) et
// `dossierVoulu` (« <n>_<slug> »). Pur — ne touche à rien, comme planRenumerotation().
function calculerNoms(fiches, langue) {
  const ordonnees = calculerOrdreFiches(fiches, langue);
  const pris = new Set();
  return ordonnees.map((f, i) => {
    const n = i + 1;
    const slug = slugFicheUnique((f.valeurs || {}).title || '', pris);
    pris.add(slug);
    return Object.assign({}, f, { position: n, dossierVoulu: nomDossierFiche(n, slug) });
  });
}

// ---- Lecture de l'arborescence sur le disque ------------------------------------------

const NOM_DEPOT_IMAGES = '.depot-images';   // images déposées avant qu'une fiche neuve existe
const PREFIXE_TEMPO = '~kirby-tmp-';
const PREFIXE_NOUVEAU = '~kirby-nouveau-';

// Un dossier porte une fiche s'il contient exactement un fichier <type>.<langue>.txt dont
// le type est connu du contrat. Tout le reste (dossier étranger, fiche d'une autre langue —
// qui n'existe jamais dans cette arborescence, voir l'en-tête du fichier) est ignoré.
function ficheDeDossier(dossierArticle, nomDossier, langue) {
  const chemin = path.join(dossierArticle, nomDossier);
  let stat; try { stat = fs.statSync(chemin); } catch (e) { return null; }
  if (!stat.isDirectory()) { return null; }
  let fichiers; try { fichiers = fs.readdirSync(chemin); } catch (e) { return null; }
  const suffixe = '.' + langue + '.txt';
  for (const nom of fichiers) {
    if (nom.slice(-suffixe.length) !== suffixe) { continue; }
    const type = nom.slice(0, nom.length - suffixe.length).toLowerCase();
    if (!typeConnu(type)) { continue; }
    return { type: type, nomFichier: nom };
  }
  return null;
}
function listerDossiersFiches(dossierArticle, langue) {
  let entrees; try { entrees = fs.readdirSync(dossierArticle, { withFileTypes: true }); } catch (e) { return []; }
  const res = [];
  for (const e of entrees) {
    if (!e.isDirectory() || e.name === NOM_DEPOT_IMAGES) { continue; }
    const info = ficheDeDossier(dossierArticle, e.name, langue);
    if (info) { res.push({ dossier: e.name, type: info.type, nomFichier: info.nomFichier }); }
  }
  return res;
}
function lireFicheDepuisDossier(dossierArticle, entree) {
  let brut;
  try { brut = fs.readFileSync(path.join(dossierArticle, entree.dossier, entree.nomFichier), 'utf8'); }
  catch (e) { return null; }
  const { title, uuid, champs } = lireTxt(brut);
  return { uuid: uuid, type: entree.type, dossier: entree.dossier, valeurs: valeursDepuisChamps(entree.type, title, champs) };
}

// listerFiches(dossierArticle, langue) -> [{ uuid, type, dossier, valeurs }], dans l'ordre
// actuel des dossiers sur le disque (celui du dernier reordonnerFiches).
function listerFiches(dossierArticle, langue) {
  return listerDossiersFiches(dossierArticle, langue)
    .map((e) => lireFicheDepuisDossier(dossierArticle, e))
    .filter(Boolean)
    .sort((a, b) => a.dossier.localeCompare(b.dossier, 'fr', { numeric: true }));
}
// lireFicheAutonome(cheminDossier, langue) -> { uuid, type, dossier, valeurs } | null
// Comme listerFiches(), mais pour un seul dossier de fiche désigné par son chemin absolu —
// une fiche de réserve (lib/reserve.js), hors de toute Documentation d'article.
function lireFicheAutonome(cheminDossier, langue) {
  const parent = path.dirname(cheminDossier);
  const nom = path.basename(cheminDossier);
  const info = ficheDeDossier(parent, nom, langue);
  if (!info) { return null; }
  return lireFicheDepuisDossier(parent, { dossier: nom, type: info.type, nomFichier: info.nomFichier });
}
function trouverDossierParUuid(dossierArticle, langue, uuid) {
  return listerDossiersFiches(dossierArticle, langue).find((e) => {
    let brut;
    try { brut = fs.readFileSync(path.join(dossierArticle, e.dossier, e.nomFichier), 'utf8'); }
    catch (err) { return false; }
    return lireTxt(brut).uuid === uuid;
  }) || null;
}

// ---- Image d'une fiche : dépôt provisoire avant qu'elle existe, installation ---------
//
// Une image peut être déposée dans le formulaire avant que la fiche n'ait de dossier (elle
// n'existe encore que dans la webview). `id` est l'identifiant que la webview donne à sa
// carte, propre à cette session de formulaire — jamais l'uuid Kirby, que la fiche neuve
// n'a pas encore au moment du dépôt.
function dossierDepot(dossierArticle) { return path.join(dossierArticle, NOM_DEPOT_IMAGES); }
function nettoyerImageProvisoire(dossierArticle, id) {
  const dossier = dossierDepot(dossierArticle);
  let noms; try { noms = fs.readdirSync(dossier); } catch (e) { return; }
  const prefixe = String(id) + '__';
  for (const n of noms) { if (n.indexOf(prefixe) === 0) { try { fs.unlinkSync(path.join(dossier, n)); } catch (e) { /* déjà parti */ } } }
}
function deposerImageProvisoire(dossierArticle, id, nomFichier, donnees) {
  const dossier = dossierDepot(dossierArticle);
  fs.mkdirSync(dossier, { recursive: true });
  nettoyerImageProvisoire(dossierArticle, id);
  const cible = path.join(dossier, String(id) + '__' + nomFichier);
  fs.writeFileSync(cible, donnees);
  return cible;
}
function imageProvisoire(dossierArticle, id) {
  const dossier = dossierDepot(dossierArticle);
  let noms; try { noms = fs.readdirSync(dossier); } catch (e) { return null; }
  const prefixe = String(id) + '__';
  const trouve = noms.find((n) => n.indexOf(prefixe) === 0);
  return trouve ? path.join(dossier, trouve) : null;
}
// Copie `cheminSource` dans `cheminDossier` sous un nom libre (jamais un remplacement —
// même parti que l'ancien lib/ressources.js). Rend le nom écrit.
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

// ---- Écriture d'une fiche --------------------------------------------------------------

function ecrireFicheDansDossier(cheminDossier, langue, type, uuid, valeurs, imageSource) {
  fs.mkdirSync(cheminDossier, { recursive: true });
  const v = Object.assign({}, valeurs);
  if (imageSource) {
    const cle = champFichierDuType(type);
    if (cle) { v[cle] = installerImage(cheminDossier, imageSource); }
  }
  const texte = ecrireTxt({ title: String(v.title || ''), uuid: uuid, champs: champsPourEcriture(type, v) });
  ecrireAtomique(path.join(cheminDossier, nomFichierContenu(type, langue)), texte);
}

// ajouterFiche(dossierArticle, langue, type, valeurs, imageSource?) -> { uuid, dossier }
// Le dossier prend un nom provisoire (« ~kirby-nouveau-<uuid> ») : c'est
// reordonnerFiches() qui lui donnera son nom définitif, dans le même geste que toutes les
// autres fiches — une seule fonction qui sait calculer un nom de dossier de fiche.
function ajouterFiche(dossierArticle, langue, type, valeurs, imageSource) {
  if (!typeConnu(type)) { throw new Error('ajouterFiche : type de fiche inconnu « ' + type + ' ».'); }
  const uuid = genererUuid();
  const dossier = PREFIXE_NOUVEAU + uuid;
  ecrireFicheDansDossier(path.join(dossierArticle, dossier), langue, type, uuid, valeurs, imageSource);
  return { uuid: uuid, dossier: dossier };
}

// ecrireFiche(dossierArticle, langue, uuid, type, valeurs, imageSource?) -> { ok }
// Réécrit en place, sans renommer le dossier — un titre changé déplace la fiche dans
// l'ordre d'impression, mais c'est reordonnerFiches() qui le traduit en renommage, une
// seule fois pour tout le lot.
function ecrireFiche(dossierArticle, langue, uuid, type, valeurs, imageSource) {
  const entree = trouverDossierParUuid(dossierArticle, langue, uuid);
  if (!entree) { return { ok: false }; }
  const cheminDossier = path.join(dossierArticle, entree.dossier);
  if (entree.type !== type) {
    try { fs.unlinkSync(path.join(cheminDossier, entree.nomFichier)); } catch (e) { /* absent */ }
  }
  ecrireFicheDansDossier(cheminDossier, langue, type, uuid, valeurs, imageSource);
  return { ok: true };
}

// retirerFiche(dossierArticle, langue, uuid) -> { ok }
// Ôte le dossier entier, image comprise — à la différence de l'ancien retirerRessource()
// (lib/ressources.js), qui laissait l'image orpheline dans un media/ partagé : ici l'image
// n'appartient qu'à cette fiche, rien d'autre n'en dépend.
function retirerFiche(dossierArticle, langue, uuid) {
  const entree = trouverDossierParUuid(dossierArticle, langue, uuid);
  if (!entree) { return { ok: false }; }
  try { fs.rmSync(path.join(dossierArticle, entree.dossier), { recursive: true, force: true }); }
  catch (e) { return { ok: false }; }
  return { ok: true };
}

// reordonnerFiches(dossierArticle, langue) -> { renommes }
// Idempotente (voir l'en-tête du fichier) : un dossier déjà à son nom voulu, ou déjà passé
// par le temporaire, n'est pas retouché.
function reordonnerFiches(dossierArticle, langue) {
  const existantes = listerFiches(dossierArticle, langue);
  if (existantes.length === 0) { return { renommes: 0 }; }
  const voulues = calculerNoms(existantes, langue);
  const aRenommer = voulues.filter((f) => f.dossier !== f.dossierVoulu);
  let renommes = 0;

  // Passe 1 : chaque dossier qui doit bouger part vers un temporaire qui porte sa
  // destination — sauf s'il y est déjà (reprise après interruption).
  for (const f of aRenommer) {
    const nomTempo = PREFIXE_TEMPO + f.dossierVoulu;
    if (f.dossier === nomTempo) { continue; }              // déjà à l'étape intermédiaire
    const de = path.join(dossierArticle, f.dossier);
    const tempo = path.join(dossierArticle, nomTempo);
    if (!fs.existsSync(de) || fs.existsSync(tempo)) { continue; }
    fs.renameSync(de, tempo);
    renommes++;
  }
  // Passe 2 : chaque temporaire rejoint son nom définitif.
  for (const f of aRenommer) {
    const tempo = path.join(dossierArticle, PREFIXE_TEMPO + f.dossierVoulu);
    const vers = path.join(dossierArticle, f.dossierVoulu);
    if (!fs.existsSync(tempo) || fs.existsSync(vers)) { continue; }
    fs.renameSync(tempo, vers);
    renommes++;
  }
  return { renommes: renommes };
}

// ---- La page (documentation.<lang>.txt) : titre, uuid, rubriques ---------------------

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

// ---- Toute la Documentation d'un coup, pour l'ouverture du formulaire ------------------
function lireDocumentation(dossierArticle, langue) {
  return { page: lirePage(dossierArticle, langue), fiches: listerFiches(dossierArticle, langue) };
}

module.exports = {
  // Contrat
  chargerContrat, oublierContrat, cheminDuContrat, contrat,
  typeConnu, typesConnus, definitionType, champsDuType, champDuType, libelleType, libelleLienType,
  champFichierDuType, rubriquesDuContrat, rubriquesPourRevue, valeursListe,
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
  champsPourEcriture, valeursDepuisChamps,
  // Ordre et nom de dossier
  calculerOrdreFiches, calculerNoms, slugifierFiche, slugFicheUnique, nomDossierFiche,
  // Arborescence sur le disque
  listerFiches, lireFicheAutonome, trouverDossierParUuid,
  ajouterFiche, ecrireFiche, retirerFiche, reordonnerFiches,
  lirePage, ecrirePage, lireDocumentation,
  // Image d'une fiche
  deposerImageProvisoire, imageProvisoire, nettoyerImageProvisoire, installerImage,
  PREFIXE_TEMPO, PREFIXE_NOUVEAU, NOM_DEPOT_IMAGES
};
