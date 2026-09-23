// Lecture et écriture de la Documentation (« Actualité et ressources » / « News &
// Ressourcen ») : deux familles de contenu bien séparées.
//
//   1. La PAGE du numéro (documentation.<lang>.txt, à la racine de l'article
//      articles/NN-<slug>/) : Title, Uuid, et les quatre rubriques de prose libre
//      (dossier_references…). Ne contient plus aucune fiche — voir lirePage/ecrirePage.
//   2. La BIBLIOTHÈQUE partagée (<racine-arbre>\_NewsUndActu\Fiches\<slug>\) : un dossier
//      par fiche, un fichier <type>.<lang>.txt par langue qui l'a écrite, jamais renommé.
//      Le rattachement à un numéro se fait par le champ système Ausgabe (l'id du numéro,
//      ausgabe.yaml) et l'ordre d'impression par le champ système Ordre, recalculé à
//      chaque enregistrement — voir docs/FORMAT-DOCUMENTATION-KIRBY.md, la seule source de
//      vérité du format.
//
// Source de vérité des CHAMPS : pipeline/kirby/champs-documentation.json (chargé ici,
// jamais recopié). Aucune table de types, de listes ou de libellés ne vit dans ce fichier.
//
// Aucune rétrocompatibilité : l'ancien rangement (une fiche par dossier <n>_<slug>/ SOUS
// l'article, renommé à chaque réordonnancement) et la réserve hors numéro (lib/reserve.js,
// supprimé) ne sont plus lus ni écrits nulle part.
//
// ⚠ Pur, comme lib/citations.js : aucun require('vscode'). L'hôte (lib/documentation-hote.js)
// fait les allers-retours avec la webview et refuse un numéro verrouillé ; ce module ne fait
// que lire et écrire des fichiers.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { slugifier } = require('./slug');
const { ecrireAtomique, idNumero } = require('./yaml');
const { basePoste } = require('./chemins-poste');

// ---- Chargement du contrat : dépôt d'abord, puis toolkit/ -------------------------
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
// L'autre (ou les autres) langue(s) que celle donnée — aujourd'hui toujours une seule,
// mais rien ici ne suppose qu'il n'y en ait que deux.
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
    const vide = c.saisie === 'structure'
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

// Le nom du fichier de page, quelle que soit sa langue. Sert à ceux qui doivent le
// reconnaître sans connaître la langue de l'article (lib/renumerotation-fs.js) : ce fichier
// porte un nom FIXE, jamais celui du dossier — à la différence d'une fiche de métadonnées
// (<slug>.meta.yaml), qui suit toujours le nom de son dossier.
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
    else { brute = String(v[c.cle] === undefined || v[c.cle] === null ? '' : v[c.cle]).trim(); }
    if (brute === '') { continue; }
    sortie.push({ cle: c.cle, valeurBrute: brute, forcerMultiligne: forcerMultiligne });
  }
  return sortie;
}

// Les champs SYSTÈME (Ausgabe, Ordre — pipeline/kirby/champs-documentation.json,
// champsSysteme) : jamais saisis, écrits juste après Uuid et avant les champs du type.
// Ausgabe s'écrit TOUJOURS, même vide (c'est ce qui marque une orpheline) ; Ordre
// n'existe que pour une fiche rattachée à un numéro.
function champsSystemePourEcriture(ausgabeId, ordre) {
  const sortie = [{ cle: 'ausgabe', valeurBrute: String(ausgabeId === undefined || ausgabeId === null ? '' : ausgabeId), forcerMultiligne: false }];
  if (ordre !== undefined && ordre !== null && String(ordre).trim() !== '') {
    sortie.push({ cle: 'ordre', valeurBrute: String(ordre), forcerMultiligne: false });
  }
  return sortie;
}

// Les valeurs d'une fiche depuis ce que lireTxt() a rendu (title à part, `champs` bruts).
// Les champs système (ausgabe, ordre) ne figurent jamais dans les valeurs d'une fiche :
// extraisChampsSysteme() les prend à part avant d'appeler cette fonction.
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

// Champs communs recopiés d'une langue à l'autre à l'enregistrement (docs/FORMAT-
// DOCUMENTATION-KIRBY.md) : tout ce qui n'est pas `traduire` dans le contrat, `title`
// excepté (déjà `traduire`) et `derive` excepté (recalculé, jamais copié). Pour `suivi`
// (structure) : les sous-champs communs (date, genre, lien) se recopient par RANG, le
// libellé (`traduire`) de la cible reste le sien.
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
// calculerOrdreFiches([{ type, valeurs, … }], langue) -> les mêmes fiches (mêmes objets),
// dans l'ordre voulu — tout champ supplémentaire porté par une fiche (slug, uuid…) survit.
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

// ---- Slug d'une fiche : posé UNE fois à la création, jamais renommé ensuite -----------
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
// Repris de l'esprit de l'ancien lib/reserve.js (racineArbre, DOSSIERS_REVUE), pour la même
// raison : la bibliothèque partagée vit à la racine de l'arbre (`Revue`, `Zeitschrift`,
// `_Archive`, `_NewsUndActu` comme voisins), jamais dans le numéro lui-même, qui est
// archivé, renommé, voire supprimé en fin de cycle.
const DOSSIERS_REVUE = { revue: 'Revue', zeitschrift: 'Zeitschrift' };
const DOSSIERS_PRODUIT = ['revue', 'zeitschrift', 'books'];
const DOSSIER_ARCHIVE = '_archive';
const REVUES = Object.keys(DOSSIERS_REVUE);
const NOM_BIBLIOTHEQUE = '_NewsUndActu';

function nomDe(chemin) { return path.basename(chemin).trim().toLowerCase(); }

// Deux formes reconnues par NOM (jamais un compte de crans) :
//   <racine>\Revue\2026-01            -> racine = son parent
//   <racine>\_Archive\Revue\2020-05   -> racine = le parent de `_Archive`
//   n'importe quoi d'autre             -> le parent du numéro, dégradé
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
// par id porté par plus d'un numéro. Sert à l'avertissement (jamais un refus) posé à
// l'ouverture d'un numéro dont l'id se retrouve ailleurs sur l'arbre.
function idsEnDouble(racineArbreVal) {
  const parId = {};
  for (const n of listerNumeros(racineArbreVal)) {
    if (!n.id) { continue; }
    (parId[n.id] = parId[n.id] || []).push(n);
  }
  return Object.keys(parId).map((id) => parId[id]).filter((l) => l.length > 1);
}

// ---- La bibliothèque : lire, écrire, lister une fiche par slug + langue --------------

// Un dossier de la bibliothèque porte un fichier de langue s'il contient exactement un
// <type>.<langue>.txt dont le type est connu du contrat.
function ficheDeDossierSlug(cheminSlug, langue) {
  let fichiers;
  try { fichiers = fs.readdirSync(cheminSlug); } catch (e) { return null; }
  const suffixe = '.' + langue + '.txt';
  for (const nom of fichiers) {
    if (nom.slice(-suffixe.length) !== suffixe) { continue; }
    const type = nom.slice(0, nom.length - suffixe.length).toLowerCase();
    if (!typeConnu(type)) { continue; }
    return { type: type, nomFichier: nom };
  }
  return null;
}
function listerSlugsBibliotheque(racineArbreVal) {
  let entrees;
  try { entrees = fs.readdirSync(cheminBibliotheque(racineArbreVal), { withFileTypes: true }); }
  catch (e) { return []; }
  return entrees.filter((e) => e.isDirectory()).map((e) => e.name);
}
function ensembleSlugsExistants(racineArbreVal) { return new Set(listerSlugsBibliotheque(racineArbreVal)); }

// lireFicheSlugLangue(racineArbreVal, slug, langue) -> { slug, uuid, type, ausgabe, ordre,
// valeurs } | null. `ordre` est un entier ou null (fiche orpheline, ou jamais ordonnée).
function lireFicheSlugLangue(racineArbreVal, slug, langue) {
  const cheminSlug = path.join(cheminBibliotheque(racineArbreVal), slug);
  const info = ficheDeDossierSlug(cheminSlug, langue);
  if (!info) { return null; }
  let brut;
  try { brut = fs.readFileSync(path.join(cheminSlug, info.nomFichier), 'utf8'); }
  catch (e) { return null; }
  const { title, uuid, champs } = lireTxt(brut);
  const ausgabe = String(champs.ausgabe || '');
  const ordreBrut = champs.ordre;
  const ordre = (ordreBrut !== undefined && String(ordreBrut).trim() !== '') ? parseInt(ordreBrut, 10) : null;
  return { slug: slug, uuid: uuid, type: info.type, ausgabe: ausgabe, ordre: (Number.isFinite(ordre) ? ordre : null), valeurs: valeursDepuisChamps(info.type, title, champs) };
}
// lireFicheParUuid(racineArbreVal, langue, uuid) -> comme lireFicheSlugLangue, en
// cherchant le slug par Uuid. Coûteux (parcourt toute la bibliothèque) : réservé aux gestes
// ponctuels (statuts, réservoir), jamais à un rendu de liste.
function trouverSlugParUuid(racineArbreVal, langue, uuid) {
  for (const slug of listerSlugsBibliotheque(racineArbreVal)) {
    const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
    if (f && f.uuid === uuid) { return slug; }
  }
  return null;
}

// installerImage(cheminDossier, cheminSource) -> le nom écrit, jamais un remplacement.
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

// ecrireFicheSlugLangue : écrit (ou réécrit) le fichier <type>.<langue>.txt d'un slug —
// jamais de renommage de dossier, jamais de renommage de fichier hors changement de type
// (qui ne devrait jamais arriver en pratique : le type d'une fiche est fixé à sa création).
function ecrireFicheSlugLangue(racineArbreVal, slug, langue, type, uuid, valeurs, ausgabeId, ordre, imageSource) {
  const cheminSlug = path.join(cheminBibliotheque(racineArbreVal), slug);
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
  const champs = champsSystemePourEcriture(ausgabeId, ordre).concat(champsPourEcriture(type, v));
  const texte = ecrireTxt({ title: String(v.title || ''), uuid: uuid, champs: champs });
  ecrireAtomique(path.join(cheminSlug, nomVoulu), texte);
}

// creerFiche(racineArbreVal, langue, type, valeurs, ausgabeId, imageSource?) -> { uuid, slug }
// Une fiche neuve : Uuid et slug posés ici, une fois pour toutes.
function creerFiche(racineArbreVal, langue, type, valeurs, ausgabeId, imageSource) {
  if (!typeConnu(type)) { throw new Error('creerFiche : type de fiche inconnu « ' + type + ' ».'); }
  const uuid = genererUuid();
  const slug = slugFicheUnique((valeurs || {}).title || '', ensembleSlugsExistants(racineArbreVal));
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, type, uuid, valeurs, ausgabeId, null, imageSource);
  return { uuid: uuid, slug: slug };
}

// enregistrerFicheLangue(racineArbreVal, slug, langue, type, valeurs, imageSource?) ->
// { ok, uuid }. Réécrit le fichier de SA langue (Ausgabe et Ordre préservés — c'est
// reordonnerNumero() qui les change), puis recopie les champs communs dans le fichier de
// l'autre langue s'il existe déjà.
function enregistrerFicheLangue(racineArbreVal, slug, langue, type, valeurs, imageSource) {
  const existante = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (!existante) { return { ok: false }; }
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, type, existante.uuid, valeurs, existante.ausgabe, existante.ordre, imageSource);
  for (const autre of autresLangues(langue)) {
    const ficheAutre = lireFicheSlugLangue(racineArbreVal, slug, autre);
    if (!ficheAutre) { continue; }
    const fusion = fusionnerChampsCommuns(type, valeurs, ficheAutre.valeurs);
    ecrireFicheSlugLangue(racineArbreVal, slug, autre, type, ficheAutre.uuid, fusion, ficheAutre.ausgabe, ficheAutre.ordre, null);
  }
  return { ok: true, uuid: existante.uuid };
}

// detacherFiche(racineArbreVal, slug, langue) -> { ok } : rend la fiche orpheline (Ausgabe
// vidé). Ne touche jamais à l'autre langue — l'attachement est propre à chaque fichier de
// langue (docs/FORMAT-DOCUMENTATION-KIRBY.md).
function detacherFiche(racineArbreVal, slug, langue) {
  const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (!f) { return { ok: false }; }
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, f.type, f.uuid, f.valeurs, '', null, null);
  return { ok: true, ausgabeAvant: f.ausgabe };
}

// tirerDansNumero(racineArbreVal, slug, langue, ausgabeIdCible) -> { ok } : rattache une
// orpheline de MA langue au numéro courant.
function tirerDansNumero(racineArbreVal, slug, langue, ausgabeIdCible) {
  const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (!f) { return { ok: false }; }
  ecrireFicheSlugLangue(racineArbreVal, slug, langue, f.type, f.uuid, f.valeurs, ausgabeIdCible, null, null);
  return { ok: true };
}

// traduireDansNumero(racineArbreVal, slug, langueCible, ausgabeIdCible) -> { ok, uuid } :
// crée le fichier de la langue cible, pré-rempli depuis l'autre langue (champs communs
// recopiés, champs `traduire` repris tels quels — un point de départ, pas une traduction),
// même Uuid, Ausgabe = le numéro cible. Refuse si la langue cible existe déjà.
function traduireDansNumero(racineArbreVal, slug, langueCible, ausgabeIdCible) {
  if (lireFicheSlugLangue(racineArbreVal, slug, langueCible)) { return { ok: false, raison: 'existe-deja' }; }
  let source = null;
  for (const l of autresLangues(langueCible)) {
    source = lireFicheSlugLangue(racineArbreVal, slug, l);
    if (source) { break; }
  }
  if (!source) { return { ok: false, raison: 'source-absente' }; }
  ecrireFicheSlugLangue(racineArbreVal, slug, langueCible, source.type, source.uuid,
    Object.assign({}, source.valeurs), ausgabeIdCible, null, null);
  effacerStatutFiche(racineArbreVal, langueCible, source.uuid);
  return { ok: true, uuid: source.uuid };
}

// supprimerFicheOrpheline(racineArbreVal, slug, langue) -> { ok } : ôte le fichier de SA
// langue ; le dossier entier (image comprise) s'il n'en reste aucun. Refuse sur une fiche
// encore rattachée — la suppression n'est possible que pour une orpheline.
function supprimerFicheOrpheline(racineArbreVal, slug, langue) {
  const cheminSlug = path.join(cheminBibliotheque(racineArbreVal), slug);
  const info = ficheDeDossierSlug(cheminSlug, langue);
  if (!info) { return { ok: false }; }
  const f = lireFicheSlugLangue(racineArbreVal, slug, langue);
  if (f && f.ausgabe) { return { ok: false, raison: 'rattachee' }; }
  try { fs.unlinkSync(path.join(cheminSlug, info.nomFichier)); } catch (e) { return { ok: false }; }
  let reste;
  try { reste = fs.readdirSync(cheminSlug); } catch (e) { reste = []; }
  const autreLangueRestante = reste.some((n) => /\.[a-z]{2}\.txt$/i.test(n));
  if (!autreLangueRestante) {
    try { fs.rmSync(cheminSlug, { recursive: true, force: true }); } catch (e) { /* déjà parti */ }
  }
  return { ok: true };
}

// reordonnerNumero(racineArbreVal, langue, ausgabeId) -> { total } : recalcule le champ
// Ordre de toutes les fiches de ce numéro et cette langue, écrit seulement celles dont le
// rang a changé.
function reordonnerNumero(racineArbreVal, langue, ausgabeId) {
  if (!ausgabeId) { return { total: 0 }; }
  const fiches = listerSlugsBibliotheque(racineArbreVal)
    .map((slug) => lireFicheSlugLangue(racineArbreVal, slug, langue))
    .filter((f) => f && f.ausgabe === ausgabeId);
  const ordonnees = calculerOrdreFiches(fiches, langue);
  let total = 0;
  ordonnees.forEach((f, i) => {
    const rang = i + 1;
    if (f.ordre !== rang) {
      ecrireFicheSlugLangue(racineArbreVal, f.slug, langue, f.type, f.uuid, f.valeurs, f.ausgabe, rang, null);
      total++;
    }
  });
  return { total: total };
}

// listerFichesNumero(racineArbreVal, langue, ausgabeId) -> les fiches rattachées à ce
// numéro dans cette langue, triées par leur champ Ordre (déjà à jour si reordonnerNumero()
// a été appelée après le dernier enregistrement, ce qu'impose ce module à chaque écriture).
function listerFichesNumero(racineArbreVal, langue, ausgabeId) {
  if (!ausgabeId) { return []; }
  const fiches = listerSlugsBibliotheque(racineArbreVal)
    .map((slug) => lireFicheSlugLangue(racineArbreVal, slug, langue))
    .filter((f) => f && f.ausgabe === ausgabeId);
  fiches.sort((a, b) => (a.ordre || 0) - (b.ordre || 0));
  return fiches;
}

// listerOrphelines(racineArbreVal, langue) -> mes fiches (cette langue) sans numéro.
function listerOrphelines(racineArbreVal, langue) {
  return listerSlugsBibliotheque(racineArbreVal)
    .map((slug) => lireFicheSlugLangue(racineArbreVal, slug, langue))
    .filter((f) => f && !f.ausgabe);
}

// ---- Statuts de traduction : _NewsUndActu\_Statuts\<langue>\<uuid>.txt ----------------
//
// Format minimal, DIFFÉRENT de celui d'une fiche (pas de Title/Uuid en tête) :
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

// listerTraductionsATraire(racineArbreVal, langueCible) -> fiches de l'autre langue,
// rattachées ou non, sans fichier de MA langue, statut = a-traduire.
function listerTraductionsATraire(racineArbreVal, langueCible) {
  const res = [];
  for (const slug of listerSlugsBibliotheque(racineArbreVal)) {
    if (lireFicheSlugLangue(racineArbreVal, slug, langueCible)) { continue; }
    for (const l of autresLangues(langueCible)) {
      const source = lireFicheSlugLangue(racineArbreVal, slug, l);
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

// listerReservoir(racineArbreVal, langueCible, { avecIgnorees }) -> fiches de l'autre
// langue rattachées à un numéro, sans fichier de MA langue, sans décision (ou, si
// avecIgnorees, celles qu'on a ignorées — jamais les deux en même temps : c'est
// l'interrupteur « afficher les ignorées » qui bascule).
function listerReservoir(racineArbreVal, langueCible, options) {
  const avecIgnorees = !!(options && options.avecIgnorees);
  const res = [];
  for (const slug of listerSlugsBibliotheque(racineArbreVal)) {
    if (lireFicheSlugLangue(racineArbreVal, slug, langueCible)) { continue; }
    for (const l of autresLangues(langueCible)) {
      const source = lireFicheSlugLangue(racineArbreVal, slug, l);
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

// ---- Dépôt provisoire d'une image, AVANT que la fiche n'existe -----------------------
//
// Hors de la bibliothèque partagée (docs/FORMAT-DOCUMENTATION-KIRBY.md : « pas de dossier
// temporaire qui traîne dans Fiches\ ») : os.tmpdir(), propre au poste, jamais synchronisé.
// `id` est l'identifiant que la webview donne à sa carte pour cette session de formulaire —
// jamais l'Uuid Kirby, que la fiche neuve n'a pas encore au moment du dépôt.
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
// Inchangée : reste dans l'article du numéro (dossierArticle), jamais dans la bibliothèque.

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
  typeConnu, typesConnus, definitionType, champsDuType, champDuType, libelleType, libelleLienType,
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
  champsPourEcriture, valeursDepuisChamps, fusionnerChampsCommuns,
  // Ordre
  calculerOrdreFiches, slugifierFiche, slugFicheUnique,
  nomFichierContenu, estFichierPageDocumentation,
  // Racine de l'arbre, revues, numéros
  DOSSIERS_REVUE, DOSSIERS_PRODUIT, DOSSIER_ARCHIVE, REVUES, NOM_BIBLIOTHEQUE,
  racineArbre, autreRevue, dossierRevue, cheminBibliotheque, cheminStatutsRacine,
  listerNumeros, idsEnDouble,
  // La bibliothèque : une fiche par slug + langue
  listerSlugsBibliotheque, lireFicheSlugLangue, trouverSlugParUuid,
  creerFiche, enregistrerFicheLangue, detacherFiche, tirerDansNumero, traduireDansNumero,
  supprimerFicheOrpheline, reordonnerNumero, listerFichesNumero, listerOrphelines,
  installerImage,
  // Statuts de traduction
  ecrireStatutFiche, lireStatutFiche, effacerStatutFiche,
  listerTraductionsATraire, listerReservoir,
  // Image d'une fiche : dépôt provisoire avant qu'elle existe (hors bibliothèque)
  deposerImageProvisoire, imageProvisoire, nettoyerImageProvisoire, dossierDepotImages,
  // La page (rubriques du numéro)
  lirePage, ecrirePage, lireDocumentation
};
