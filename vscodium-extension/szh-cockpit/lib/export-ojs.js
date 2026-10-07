// Export OJS natif : tout le numéro en un fichier XML « native » PKP (numéro, rubriques,
// couverture, articles, galleys en base64), à importer par Outils > Importer/Exporter >
// Native XML. Structure, ordre des éléments et forme de sérialisation suivent un export
// natif réel de l'OJS cible.
//
// La Revue (locale fr) et la Zeitschrift (locale de) sont deux revues distinctes de la même
// instance OJS, chacune avec ses rubriques, son groupe d'auteur et son compte de
// téléversement. OJS les apparie par nom à l'import : un intitulé approximatif crée un
// doublon ou range l'article ailleurs, sans erreur. Une valeur non relevée sur l'instance
// reste donc vide, et un champ obligatoire vide arrête l'export.
'use strict';

const fs = require('fs');
const path = require('path');
const { analyserAusgabe, analyserMeta, langueDefaut, normaliserLangueArticle,
  licenceArticle, normaliserLicence } = require('./yaml');
// L'ordre du numéro et le rang viennent de lib/articles.js, comme pour l'arbre et les
// cartes : un rang recalculé ici pourrait donner un DOI publié différent du DOI affiché.
const { CLE_ORDRE, CLE_SANS_DOI, analyserSansDoi, ordonnerArticles,
  rangDoi } = require('./articles');
const { estATraduire, MARQUE_A_TRADUIRE } = require('./traduction');
const { imagesSansAlternative, listerImages } = require('./references');
const { referencesDuTexte, referencesDuFichier } = require('./citations');
const archivage = require('./archivage');
const adresses = require('./ojs-adresses');
const { T, TEXTES_COCKPIT } = require('./i18n');
// Retire des mots-clés publiés le qualificatif de provenance edudoc (« (szh) », « (na) »…),
// comme szh-maquette.lua pour le PDF (voir sansQualificatifDeProvenance dans
// mots-cles-edudoc.js). plierDescripteur (casse, accents, apostrophes) sert ici au
// dédoublonnage.
const { sansQualificatifDeProvenance, plierDescripteur } = require('./mots-cles-edudoc');

// ---- Configuration de l'OJS cible ---------------------------------------------------
//
// Valeurs relevées sur ojs.szh.ch (OJS 3.5.0.4). Ce sont des défauts : le config.json du
// poste les surcharge champ par champ (configOjs()). Une valeur non relevée vaut '' : le
// panneau « Réglages SZH » la montre vide avec l'endroit où la trouver, et l'export refuse
// de partir.
//
// Les deux locales sont celles des deux revues : une revue OJS n'a qu'une locale.
const LOCALES_REVUE = ['fr', 'de'];

// Un champ par revue. `libelle` et `ou` sont des clés i18n, communes au panneau et au
// message qui bloque l'export. `requis` : vide, l'export s'arrête.
const CHAMPS_REVUE = [
  { cle: 'genreFichier', requis: true,  libelle: 'ojs.libelle.genre',       ou: 'ojs.ou.genre' },
  { cle: 'groupeAuteur', requis: true,  libelle: 'ojs.libelle.groupe',      ou: 'ojs.ou.groupe' },
  { cle: 'televerseur',  requis: true,  libelle: 'ojs.libelle.televerseur', ou: 'ojs.ou.televerseur' },
  { cle: 'paysAuteur',   requis: false, libelle: 'ojs.libelle.pays',        ou: 'ojs.ou.pays' }
];

// Côté français, valeurs vérifiées par un import réel. Côté allemand, rien n'est encore
// relevé. Le pays n'est relevé pour aucune des deux revues : il reste vide et <country>
// est omis.
const DEFAUTS_REVUE = {
  fr: { genreFichier: "Texte de l'article", groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: '' },
  de: { genreFichier: '', groupeAuteur: '', televerseur: '', paysAuteur: '' }
};

// Rubriques des deux revues, dans l'ordre de la base OJS. À l'import, OJS apparie chaque
// rubrique par titre et par abréviation, et résout le `section_ref` d'un article par la
// seule abréviation (filterByAbbrevs). Donc :
//   - `cle` est un identifiant interne au cockpit, absent du XML ;
//   - `ref` et `section_ref` portent l'abréviation de la revue visée : un article de
//     Documentation va dans « DK » sur la Zeitschrift et dans « DC » sur la Revue.
//
// Graphies réelles de l'instance, à garder telles quelles : « Ed » en allemand mais « ED »
// en français ; « Tribune Libre » côté français, « Tribune libre » côté allemand (titre
// français dans la revue allemande). « ART » vient de la migration, mais existe et occupe
// le seq 2.
//
// `sansResume` : la rubrique n'exige pas de résumé (abstracts_not_required d'OJS).
// `sansDoi`   : la rubrique n'exige pas de DOI (un DOI y reste accepté). Vérifié pour
//               Documentation ; posé aussi pour le podcast, la langue facile et les
//               annonces, qui ne sont pas des articles scientifiques.
// `idInterne` : id de la base OJS, écrit avec advice="ignore" et réattribué à l'import ;
//               présent pour la lisibilité.
// Abréviation et titre vides : valeurs pas encore relevées. « Annonces / Inserate »
// n'apparaît pas dans ListSets, bien qu'elle figure dans tous les sommaires.
const RUBRIQUES_DEFAUT = [
  { cle: 'ED',      seq: 1, sansResume: 1, sansDoi: 0, idInterne: 16,
    abbrev: { fr: 'ED',  de: 'Ed' },          titre: { fr: 'Éditorial',          de: 'Editorial' } },
  { cle: 'ART',     seq: 2, sansResume: 0, sansDoi: 0, idInterne: 17,
    abbrev: { fr: 'ART', de: 'ART' },         titre: { fr: 'Articles',           de: 'Artikel' } },
  { cle: 'DT',      seq: 3, sansResume: 0, sansDoi: 0, idInterne: 5,
    abbrev: { fr: 'DT',  de: 'TS' },          titre: { fr: 'Dossier thématique', de: 'Themenschwerpunkt' } },
  { cle: 'VA',      seq: 4, sansResume: 0, sansDoi: 0, idInterne: 8,
    abbrev: { fr: 'VA',  de: 'FB' },          titre: { fr: 'Varia',              de: 'Freie Beiträge' } },
  { cle: 'TL',      seq: 5, sansResume: 1, sansDoi: 0, idInterne: 15,
    abbrev: { fr: 'TL',  de: 'TL' },          titre: { fr: 'Tribune Libre',      de: 'Tribune libre' } },
  { cle: 'DC',      seq: 6, sansResume: 1, sansDoi: 1, idInterne: 14,
    abbrev: { fr: 'DC',  de: 'DK' },          titre: { fr: 'Documentation',      de: 'Dokumentation' } },
  { cle: 'PODCAST', seq: 7, sansResume: 1, sansDoi: 1, idInterne: 0,
    abbrev: { fr: '',    de: 'SZH-Podcast' }, titre: { fr: '',                   de: 'SZH-Podcast' } },
  { cle: 'LS',      seq: 8, sansResume: 1, sansDoi: 1, idInterne: 0,
    abbrev: { fr: '',    de: 'LS' },          titre: { fr: '',                   de: 'Leichte Sprache' } },
  { cle: 'AN',      seq: 9, sansResume: 1, sansDoi: 1, idInterne: 0,
    abbrev: { fr: '',    de: '' },            titre: { fr: 'Annonces',           de: 'Inserate' } }
];

// Type d'article (fiche <slug>.meta.yaml) -> clé de rubrique. Il n'existe sur l'instance
// ni « Entretien » ni « Interview » : une interview part dans le dossier thématique.
const TYPES_DEFAUT = {
  editorial: 'ED', article: 'DT', interview: 'DT',
  varia: 'VA', 'tribune-libre': 'TL', documentation: 'DC'
};

// Forme des DOI de la maison sur ojs.szh.ch : un préfixe commun, une lettre par revue,
// AAAA-NN pour le numéro dans l'année, SS pour le rang dans le numéro
// (« 10.57161/z2026-06-00 »).
//
// Le DOI n'est pas stocké : il se recalcule de la revue, de l'année, du numéro et du rang.
// Le rang compte, à partir de zéro, les articles qui reçoivent un DOI : l'éditorial porte
// « 00 », ce dont pipeline/docx-meta.py se sert pour reconnaître un éditorial.
const PREFIXE_DOI = '10.57161';
const LETTRE_DOI = { fr: 'r', de: 'z' };

// Deux chiffres, comme l'instance. Au-delà de 99, le nombre s'écrit entier : tronqué, il
// désignerait un autre article.
function deuxChiffres(n) {
  const v = Math.trunc(Number(n));
  if (!isFinite(v) || v < 0) { return ''; }
  return v < 10 ? '0' + v : String(v);
}

// Rend '10.57161/r2026-03-05', ou '' s'il manque un élément (numéro sans année, rang -1
// d'un article sans DOI) : un DOI incomplet serait pire que pas de DOI.
function doiCalcule(locale, annee, numero, rang) {
  const lettre = LETTRE_DOI[String(locale || '').toLowerCase()];
  const an = (String(annee === undefined || annee === null ? '' : annee).match(/\d{4}/) || [''])[0];
  // Un numéro sans chiffres rend '' : pris pour zéro, il donnerait « …-00-01 », un DOI
  // plausible pour un numéro qui n'existe pas.
  const chiffres = String(numero === undefined || numero === null ? '' : numero).replace(/\D+/g, '');
  const num = chiffres === '' ? '' : deuxChiffres(chiffres);
  const seq = deuxChiffres(rang);
  if (!lettre || an === '' || num === '' || seq === '') { return ''; }
  return PREFIXE_DOI + '/' + lettre + an + '-' + num + '-' + seq;
}

// Forme des DOI de la maison, par revue. Le DOI exporté est calculé ; ce motif sert à
// juger un DOI saisi à la main qui diverge : de la forme maison, il a pu être réellement
// déposé ; d'une autre forme (un « r » sur la Zeitschrift), jamais. L'exemple est produit
// par doiCalcule() pour rester exact.
const FORME_DOI = {
  fr: { motif: /^10\.57161\/r\d{4}-\d{2}-\d{2}$/, exemple: doiCalcule('fr', '2026', '3', 5) },
  de: { motif: /^10\.57161\/z\d{4}-\d{2}-\d{2}$/, exemple: doiCalcule('de', '2026', '3', 5) }
};

// Crédits de figure qui appartiennent à la maison, comparés sur leurs seules lettres
// (« © SZH », « (c) csps » et « © SZH/CSPS » sont le même). Le nom d'un·e auteur·e de
// l'article compte aussi comme crédit maison.
const CREDITS_MAISON = ['szh', 'csps'];

// Les galleys sont émis dans cet ordre, et OJS respecte l'ordre d'import : DOCX, HTML,
// PDF, comme le site les affiche.
const FORMATS_GALLEY = [
  { etiquette: 'DOCX', ext: 'docx' },
  { etiquette: 'HTML', ext: 'html' },
  { etiquette: 'PDF', ext: 'pdf' }
];
const NOMS_COUVERTURE = ['couverture.jpg', 'couverture.jpeg', 'couverture.png'];
// Légende provisoire que posent Ctrl+Alt+F et « Insérer dans le texte », dans les deux
// langues : la reconnaître permet de signaler un oubli.
const LEGENDES_PAR_DEFAUT = new Set(Object.keys(TEXTES_COCKPIT)
  .map((l) => String(TEXTES_COCKPIT[l]['fmt.figure.legende'] || '').trim().toLowerCase())
  .filter((v) => v !== ''));

// Tic d'OJS : chaque conteneur redéclare l'espace de noms xsi et le schéma.
const XSI = ' xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const SCHEMA = ' xsi:schemaLocation="http://pkp.sfu.ca native.xsd"';

// ---- Aides -------------------------------------------------------------------------

function echapperXml(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function echapperHtml(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function texte(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim();
}

function formaterDateIso(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

function formaterHorodatage(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return '' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) +
    '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
}

// Lettres et chiffres d'une chaîne, sans accents ni ponctuation, pour comparer des crédits
// saisis à la main. Comparaison volontairement large : elle ne sert qu'à un avertissement.
function cleCredit(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// URL de licence sans barre finale, comme dans les exports déjà importés dans OJS.
// lib/yaml.js et le gabarit HTML gardent la forme canonique Creative Commons, avec la barre.
function urlOjs(url) {
  return String(url || '').replace(/\/+$/, '');
}

// ---- Images introuvables -------------------------------------------------------------
//
// Une image appelée par le texte mais absente du disque est remplacée par un cadre au
// rendu (szh-image-introuvable.lua), et le PDF sort quand même. L'export et l'archivage
// refusent. Images vérifiées : celles du .md et des tableaux inclus, locales seulement
// (ni URL ni data:).

// Le fichier existe-t-il, sans égard à la casse ? listerImages() rend des cibles en
// minuscules, et la WSL lit /mnt/c sans casse, comme Windows.
function existeSansCasse(base, relatif) {
  if (path.isAbsolute(relatif)) { return fs.existsSync(relatif); }
  let courant = base;
  for (const segment of relatif.split('/').filter((s) => s !== '' && s !== '.')) {
    if (segment === '..') { courant = path.dirname(courant); continue; }
    let noms;
    try { noms = fs.readdirSync(courant); } catch (e) { return false; }
    const trouve = noms.find((n) => n.toLowerCase() === segment.toLowerCase());
    if (!trouve) { return false; }
    courant = path.join(courant, trouve);
  }
  return courant !== base;
}

function cibleLocale(cible) {
  const c = String(cible || '').trim();
  return c !== '' && !(/^[a-z][a-z0-9+.-]*:/i.test(c) && !/^[a-z]:[\\/]/i.test(c));
}

// dossier d'une unité + son texte -> chemins des images appelées et absentes, sans doublon.
function imagesIntrouvables(dossier, texteMd) {
  const cibles = listerImages(texteMd).map((i) => i.cible);
  const reTable = /\{[^}]*\.szh-tabelle\b[^}]*\bsrc="([^"]+)"[^}]*\}/g;
  let m;
  while ((m = reTable.exec(String(texteMd || ''))) !== null) {
    let html = '';
    try { html = fs.readFileSync(path.join(dossier, m[1]), 'utf8'); } catch (e) { continue; }
    const reImg = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
    let i;
    while ((i = reImg.exec(html)) !== null) { cibles.push(i[1] !== undefined ? i[1] : i[2]); }
  }
  const vues = new Set();
  const manquantes = [];
  for (const brute of cibles) {
    const cible = String(brute).replace(/\\/g, '/');
    if (!cibleLocale(cible) || vues.has(cible.toLowerCase())) { continue; }
    vues.add(cible.toLowerCase());
    let decodee = cible;
    try { decodee = decodeURIComponent(cible); } catch (e) { /* tel quel */ }
    if (!existeSansCasse(dossier, cible) && !existeSansCasse(dossier, decodee)) { manquantes.push(cible); }
  }
  return manquantes;
}

// Dossier des unités (articles/ ou chapitres/) -> [{ slug, image }], dans l'ordre des dossiers.
function imagesIntrouvablesDesUnites(dossierUnites) {
  let slugs = [];
  try {
    slugs = fs.readdirSync(dossierUnites, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name).sort();
  } catch (e) { return []; }
  const res = [];
  for (const slug of slugs) {
    const dossier = path.join(dossierUnites, slug);
    let texteMd;
    try { texteMd = fs.readFileSync(path.join(dossier, slug + '.md'), 'utf8'); } catch (e) { continue; }
    for (const image of imagesIntrouvables(dossier, texteMd)) { res.push({ slug: slug, image: image }); }
  }
  return res;
}

// slug -> « 12 » ou « 12-17 », pour chaque article de pagination.articles qui a un départ
// et un nombre de pages. {} si le numéro n'a jamais été paginé : aucun <pages> ne sort.
// Une pagination périmée est refusée plus tôt, par collecter().
function intervallesPages(pagination) {
  const carte = {};
  if (!pagination || !pagination.enregistre) { return carte; }
  for (const a of (pagination.articles || [])) {
    const depart = a && a.depart;
    const pages = a && a.pages;
    if (depart === null || depart === undefined || pages === null || pages === undefined) { continue; }
    const debut = Number(depart);
    const n = Number(pages);
    if (!Number.isFinite(debut) || !Number.isFinite(n) || n < 1) { continue; }
    const fin = debut + n - 1;
    // Trait d'union ASCII (U+002D) : OJS garde <pages> comme une chaîne, que son export
    // Crossref et les balises citation_firstpage / citation_lastpage de Google Scholar
    // découpent.
    carte[a.slug] = fin > debut ? (debut + '-' + fin) : String(debut);
  }
  return carte;
}

function localesNonVides(map) {
  return Object.keys(map || {})
    .filter((l) => String(map[l] || '').trim() !== '')
    .sort();
}

function morceauNomFichier(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur).trim()
    .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || '0';
}

// Articles présents sur le disque : un dossier qui contient le .md du même nom (comme
// SLUGS du Makefile), ou un dossier sans .md dont la fiche porte `type: documentation`
// (Documentation Kirby ; le Makefile la reconnaît à documentation.<lang>.txt, voir
// DOC_SLUGS).
//
// Ce n'est pas l'ordre du numéro, qui vit dans ses métadonnées : la liste sert d'entrée à
// ordonnerArticles(). Le tri, le même que celui de l'arbre, place de façon stable les
// articles qui ne figurent pas encore dans l'ordre.
function listerSlugs(racine) {
  const dossier = path.join(racine, 'articles');
  let entrees = [];
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
  catch (e) { return []; }
  return entrees
    .filter((e) => {
      if (!e.isDirectory()) { return false; }
      if (fs.existsSync(path.join(dossier, e.name, e.name + '.md'))) { return true; }
      let type = '';
      try { type = analyserMeta(fs.readFileSync(path.join(dossier, e.name, e.name + '.meta.yaml'), 'utf8')).type; }
      catch (err) { return false; }
      return type === 'documentation';
    })
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

// ---- Lecture et écriture de la configuration -----------------------------------------
//
// La configuration OJS vit dans le config.json du poste, lu et écrit par lib/archivage.js
// (écriture atomique, chemin remplaçable par SZH_CONFIG_OJS). Elle décrit l'instance
// (composants, rôles, comptes, abréviations), pas le numéro : rangée dans un numéro, elle
// partirait à l'archivage, et un numéro rouvert plus tard reprendrait des intitulés
// périmés. bootstrap.ps1 donne au groupe Utilisateurs le droit d'écrire ce fichier.
const cheminConfigOjs = archivage.cheminConfigPoste;
const lireConfigPoste = archivage.lireConfigPoste;

function cloner(v) { return JSON.parse(JSON.stringify(v)); }

// Clé de rubrique : identifiant interne, absent du XML. Restreinte à des caractères sûrs,
// car elle sert d'index partout.
function normaliserCleRubrique(valeur) {
  return texte(valeur).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

// Défauts + surcharge du poste, champ par champ. Une clé présente gagne, même vide : vider
// un champ dans le panneau doit avoir un effet.
//
// Les rubriques fusionnent par clé ; une clé inconnue s'ajoute à la suite. Une surcharge
// partielle garde ainsi le reste de la table, et une rubrique ajoutée dans le panneau
// survit à une mise à jour.
function normaliserConfigOjs(brut) {
  const src = (brut && typeof brut.ojs === 'object' && brut.ojs) ? brut.ojs : {};

  const revues = {};
  const parRevue = (src.revues && typeof src.revues === 'object') ? src.revues : {};
  for (const loc of LOCALES_REVUE) {
    const surcharge = (parRevue[loc] && typeof parRevue[loc] === 'object') ? parRevue[loc] : {};
    const cible = {};
    for (const champ of CHAMPS_REVUE) {
      cible[champ.cle] = champ.cle in surcharge
        ? texte(surcharge[champ.cle])
        : DEFAUTS_REVUE[loc][champ.cle];
    }
    revues[loc] = cible;
  }

  const rubriques = cloner(RUBRIQUES_DEFAUT);
  const rang = {};
  rubriques.forEach((r, i) => { rang[r.cle] = i; });
  let seqMax = rubriques.reduce((m, r) => Math.max(m, r.seq), 0);
  for (const brute of (Array.isArray(src.rubriques) ? src.rubriques : [])) {
    const cle = normaliserCleRubrique(brute && brute.cle);
    if (cle === '') { continue; }
    if (rang[cle] === undefined) {
      seqMax += 1;
      rubriques.push({
        cle: cle, seq: seqMax, sansResume: 1, sansDoi: 1, idInterne: 0,
        abbrev: { fr: '', de: '' }, titre: { fr: '', de: '' }
      });
      rang[cle] = rubriques.length - 1;
    }
    const cible = rubriques[rang[cle]];
    for (const clef of ['abbrev', 'titre']) {
      const map = (brute && typeof brute[clef] === 'object' && brute[clef]) || {};
      for (const loc of LOCALES_REVUE) {
        if (loc in map) { cible[clef][loc] = texte(map[loc]); }
      }
    }
    for (const drapeau of ['sansResume', 'sansDoi']) {
      if (brute && drapeau in brute) { cible[drapeau] = brute[drapeau] ? 1 : 0; }
    }
    if (brute && 'seq' in brute) {
      const n = Number(brute.seq);
      if (Number.isFinite(n) && n > 0) { cible.seq = Math.floor(n); }
    }
  }

  const types = Object.assign({}, TYPES_DEFAUT);
  const surchargeTypes = (src.types && typeof src.types === 'object') ? src.types : {};
  for (const type of Object.keys(surchargeTypes)) {
    const cle = normaliserCleRubrique(surchargeTypes[type]);
    if (cle !== '' && rang[cle] !== undefined) { types[type] = cle; }
  }

  return { revues: revues, rubriques: rubriques, types: types };
}

// La configuration effective : ce que le panneau affiche et ce que l'export emploie.
function configOjs() {
  return normaliserConfigOjs(lireConfigPoste());
}

// La rubrique de ce type d'article reçoit-elle un DOI ? La réponse vient de la table des
// rubriques, configuration du poste comprise. La vue « Articles » s'en sert aussi, pour
// annoncer la même absence que l'export.
function typeSansDoi(cfg, type) {
  const c = cfg || configOjs();
  const cle = (c.types || {})[texte(type)];
  for (const r of (c.rubriques || [])) { if (r.cle === cle) { return !!r.sansDoi; } }
  return false;
}

// Écrit la configuration venue du panneau sous la clé `ojs` de config.json, sans toucher
// au reste du fichier (devMode, mailsTraduction…). Rend null, ou le message de l'échec.
function ecrireConfigOjs(config) {
  // Lecture-modification-écriture atomique par lib/archivage.js : les autres blocs de
  // config.json, écrits entre-temps par d'autres appelants, sont conservés.
  return archivage.ecrireConfigPoste((fichier) => {
    const sortie = Object.assign({}, fichier);
    // Normalisée avant écriture : le fichier porte toujours la table complète.
    sortie.ojs = normaliserConfigOjs({ ojs: config });
    return sortie;
  });
}

// ---- Collecte et garde-fous ----------------------------------------------------------

// Un manque de configuration ne se corrige pas dans le numéro mais dans les réglages :
// le message nomme le champ, la revue, et l'écran d'OJS où relever la valeur.
function manqueConfig(libelle, locale, ou) {
  return T('ojs.err.config', [libelle, T('ojs.revue.' + locale), ou]);
}

// Rend une fonction qui lit les références d'un article, en texte brut.
//
// La source est le fichier de bibliographie détaché à l'import. Un article qui n'en a pas
// (importé avant l'existence de ce fichier) retombe sur son .md, avec un avertissement :
// un réimport corrige.
//
// referencesDuFichier() et referencesDuTexte() lèvent si les tables du filtre de citations
// manquent (toolkit absent ou plus ancien que le cockpit). L'export continue alors sans
// <citations>, avec un seul avertissement.
function lecteurReferences(racine, avertissements) {
  let panne = null;                                // message déjà signalé, ou null
  return function (slug, md, prefixe, exigees) {
    if (panne !== null) { return []; }
    let entrees = [];
    try {
      entrees = referencesDuFichier(racine, slug);
      if (entrees === null) {
        entrees = referencesDuTexte(md);
        if (entrees.length > 0) {
          avertissements.push(prefixe + T('ojs.avert.citations.corps'));
        }
      }
    } catch (e) {
      panne = T(e && e.messageCle ? e.messageCle : 'cit.toolkit.absent');
      avertissements.push(T('ojs.avert.citations.tables', [panne]));
      return [];
    }
    const liste = entrees.map((e) => texte(e.texte)).filter((t) => t !== '');
    if (liste.length === 0 && exigees) { avertissements.push(prefixe + T('ojs.avert.citations.aucune')); }
    return liste;
  };
}

function collecter(racine, cfg, avertissements, pagination) {
  let brut;
  try { brut = fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'); }
  catch (e) { throw new Error(T('ojs.err.ausgabe', [racine])); }
  const valeurs = analyserAusgabe(brut);

  const numero = {
    locale: langueDefaut(valeurs),                 // jeton de revue, puis lang:, puis fr
    titre: texte(valeurs.title),
    volume: texte(valeurs.volume),
    numero: texte(valeurs.numero),
    annee: (String(valeurs.date || '').match(/\d{4}/) || [''])[0],
    datePublication: (texte(valeurs.date).match(/^(\d{4}-\d{2}-\d{2})$/) || [])[1] || '',
    couverture: null
  };

  const bloquants = [];
  const bloquantsConfig = [];      // ce qui se corrige dans les réglages, pas dans le numéro

  // Pagination : un numéro jamais paginé part sans contrôle. Un numéro paginé dont des
  // folios ne suivent plus le sommaire est refusé, car son <pages> serait faux chez Crossref
  // et Google Scholar. C'est un défaut du numéro, donc il va dans `bloquants`.
  if (pagination && pagination.enregistre &&
      Array.isArray(pagination.perimes) && pagination.perimes.length > 0) {
    bloquants.push(T('ojs.err.pagination.perimee', [pagination.perimes.join(', ')]));
  }

  // Configuration de la revue visée. Une locale hors des deux revues (par exemple
  // `lang: it`) n'en a pas et arrête l'export.
  const revue = cfg.revues[numero.locale] || null;
  if (!revue) {
    throw new Error(T('ojs.err.locale', [numero.locale, LOCALES_REVUE.join(', ')]));
  }
  for (const champ of CHAMPS_REVUE) {
    const valeur = texte(revue[champ.cle]);
    if (valeur === '' && champ.requis) {
      bloquantsConfig.push(manqueConfig(T(champ.libelle), numero.locale, T(champ.ou)));
    }
  }
  // Pays facultatif, mais un « Suisse » saisi à la place de « CH » n'est pas un code pays
  // pour OJS : il est omis, avec un avertissement.
  const pays = texte(revue.paysAuteur);
  if (pays === '') { avertissements.push(T('ojs.avert.pays')); }
  else if (!/^[A-Za-z]{2}$/.test(pays)) {
    avertissements.push(T('ojs.avert.pays.forme', [pays]));
    revue.paysAuteur = '';
  }

  if (!numero.volume) { avertissements.push(T('ojs.avert.volume')); }
  if (!numero.numero) { avertissements.push(T('ojs.avert.numero')); }
  if (!numero.annee) { avertissements.push(T('ojs.avert.annee')); }
  // Le numéro part avec published="1" : sans date de publication complète, OJS le publie
  // sans date, et il faut la ressaisir article par article.
  if (!numero.datePublication) {
    bloquants.push(T('ojs.err.date', [texte(valeurs.date) || '–']));
  }
  for (const nom of NOMS_COUVERTURE) {
    if (fs.existsSync(path.join(racine, nom))) { numero.couverture = nom; break; }
  }
  if (!numero.couverture) {
    avertissements.push(T('ojs.avert.couverture', [NOMS_COUVERTURE.join(', ')]));
  }

  const slugsDisque = listerSlugs(racine);
  if (slugsDisque.length === 0) {
    throw new Error(T('ojs.err.aucunArticle', [racine]));
  }

  const parCle = {};
  for (const r of cfg.rubriques) { parCle[r.cle] = r; }

  // Les fiches sont lues une fois, en premier : le type donne la rubrique, la rubrique dit
  // si l'article reçoit un DOI, et cela fixe sa place dans le numéro. Une fiche illisible
  // n'a pas de type ; son manque est signalé plus bas avec ceux de l'article.
  const fiches = {};
  for (const slug of slugsDisque) {
    const cheminMeta = path.join(racine, 'articles', slug, slug + '.meta.yaml');
    try { fiches[slug] = analyserMeta(fs.readFileSync(cheminMeta, 'utf8')); }
    catch (e) { fiches[slug] = null; }
  }

  // Articles cochés « sans DOI » dans la vue « Articles ». L'export ne s'arrête pas, mais
  // l'absence est signalée par un avertissement propre, distinct des rubriques sans DOI.
  //
  // `sansDoi` réunit les cases cochées et les rubriques sans DOI. Il décide seul du rang,
  // et se compose comme dans la vue « Articles ».
  const sansDoiVoulu = new Set(analyserSansDoi(valeurs[CLE_SANS_DOI]));
  const sansDoi = new Set(sansDoiVoulu);
  for (const slug of slugsDisque) {
    if (sansDoi.has(slug)) { continue; }
    if (typeSansDoi(cfg, fiches[slug] && fiches[slug].type)) { sansDoi.add(slug); }
  }

  // Ordre du numéro, et non tri des dossiers : il donne le rang, et le rang le DOI. Même
  // fonction et même `sansDoi` que l'arbre et les cartes, pour qu'un article ait partout le
  // même rang. Un article ajouté à la main va à la fin, un article effacé quitte l'ordre ;
  // rien n'est réécrit, l'export ne modifie pas le numéro.
  const slugs = ordonnerArticles(valeurs[CLE_ORDRE], slugsDisque, sansDoi).slugs;

  // Sans année ou sans numéro, aucun DOI n'est calculable, et un article publié sans DOI ne
  // se répare pas. Le refus porte sur le numéro, et seulement s'il a au moins un article
  // qui doit recevoir un DOI.
  const porteurs = slugs.filter((s) => !sansDoi.has(s));
  if (porteurs.length > 0 && doiCalcule(numero.locale, numero.annee, numero.numero, 0) === '') {
    bloquants.push(T('ojs.err.doi.incalculable'));
  }

  const lireReferences = lecteurReferences(racine, avertissements);

  // Une rubrique employée doit avoir abréviation et titre dans la langue de la revue : OJS
  // résout `section_ref` par l'abréviation, et le schéma exige le titre. « Annonces /
  // Inserate » n'a pas encore d'abréviation relevée.
  const rubriquesVues = {};
  const verifierRubrique = (r) => {
    if (rubriquesVues[r.cle]) { return; }
    rubriquesVues[r.cle] = true;
    const nom = texte(r.titre[numero.locale]) || texte(r.titre[LOCALES_REVUE[0]]) || r.cle;
    if (texte(r.abbrev[numero.locale]) === '') {
      bloquantsConfig.push(manqueConfig(T('ojs.libelle.abbrevDe', [nom]), numero.locale, T('ojs.ou.rubriques')));
    }
    if (texte(r.titre[numero.locale]) === '') {
      bloquantsConfig.push(manqueConfig(T('ojs.libelle.titreDe', [r.cle]), numero.locale, T('ojs.ou.rubriques')));
    }
  };
  const articles = [];
  for (const slug of slugs) {
    const prefixe = 'articles/' + slug + ' : ';
    const meta = fiches[slug];
    if (!meta) { bloquants.push(prefixe + T('ojs.err.fiche', [slug + '.meta.yaml'])); }

    const article = { slug: slug, meta: meta, rubrique: null, doi: '', fichiers: [], references: [] };
    if (meta) {
      const rubrique = parCle[cfg.types[texte(meta.type)]] || null;
      if (!rubrique) {
        bloquants.push(prefixe + (meta.type
          ? T('ojs.err.type.inconnu', [texte(meta.type)])
          : T('ojs.err.type.absent')));
      }
      article.rubrique = rubrique;
      if (rubrique) { verifierRubrique(rubrique); }

      // Le titre et le résumé doivent exister dans la langue de l'article, qui décide de la
      // maquette. La soumission garde la locale de la revue : OJS refuserait une autre locale
      // à l'import.
      const langue = normaliserLangueArticle(meta.lang) || numero.locale;
      if (langue !== numero.locale) {
        avertissements.push(prefixe + T('ojs.avert.langue', [langue.toUpperCase(), numero.locale.toUpperCase()]));
      }
      if (localesNonVides(meta.title).length === 0) { bloquants.push(prefixe + T('ojs.err.titre.aucun')); }
      else if (texte((meta.title || {})[langue]) === '') {
        bloquants.push(prefixe + T('ojs.err.titre.langue', [langue.toUpperCase()]));
      }
      // Auteurs exploitables : au moins un prénom ou un nom. Une simple affiliation ne
      // fait pas un auteur OJS, givenname étant requis par le schéma.
      article.auteurs = (meta.author || []).filter((a) => (a.prenom || '').trim() !== '' || (a.nom || '').trim() !== '');
      if (article.auteurs.length === 0) { bloquants.push(prefixe + T('ojs.err.auteur.aucun')); }
      if (localesNonVides(meta.subtitle).length === 0) { avertissements.push(prefixe + T('ojs.avert.soustitre')); }
      // Le résumé n'est exigé que là où OJS l'exige : un éditorial, une tribune libre ou
      // une page de documentation part sans, un article du dossier non.
      const exigeResume = !!(rubrique && !rubrique.sansResume);
      if (texte((meta.resume || {})[langue]) === '') {
        if (exigeResume) { bloquants.push(prefixe + T('ojs.err.resume.langue', [langue.toUpperCase()])); }
        else if (localesNonVides(meta.resume).length === 0) { avertissements.push(prefixe + T('ojs.avert.resume')); }
      }
      if (Object.keys(meta.keywords || {}).every((l) => !(meta.keywords[l] || []).length)) {
        avertissements.push(prefixe + T('ojs.avert.motscles'));
      }
      // La marque « TO BE TRANSLATED » remplace un mot-clé non traduit : à signaler avant
      // publication.
      for (const l of Object.keys(meta.keywords || {})) {
        const n = (meta.keywords[l] || []).filter((m) => estATraduire(m)).length;
        if (n > 0) {
          avertissements.push(prefixe + T('ojs.avert.motscles.marque',
            [n, l.toUpperCase(), MARQUE_A_TRADUIRE]));
        }
      }
      // Le DOI exporté est calculé : le rang de l'article parmi ceux qui en reçoivent, comme sur
      // sa carte. Exception : un doi présent sur la fiche y a été saisi à la main (case
      // « Définir manuellement le DOI ») et remplace le calculé ; une divergence est signalée
      // avec les deux valeurs. Pas de DOI dans deux cas : la case « sans DOI » de l'article et
      // une rubrique sans DOI.
      const rang = rangDoi(slugs, slug, sansDoi);
      const doiFiche = texte(meta.doi);
      const doiRang = doiCalcule(numero.locale, numero.annee, numero.numero, rang);
      article.doi = doiRang;
      if (rang === -1) {
        avertissements.push(prefixe + T(sansDoiVoulu.has(slug) ? 'ojs.avert.doi.voulu' : 'ojs.avert.doi.sans'));
        if (doiFiche !== '') { avertissements.push(prefixe + T('ojs.avert.doi.inutile', [doiFiche])); }
      } else if (doiFiche !== '') {
        article.doi = doiFiche;
        if (doiRang !== '' && doiFiche !== doiRang) {
          // Deux diagnostics : un DOI de la forme maison a pu être déposé (celui d'un article paru
          // ne se change pas, le saisir à la main est correct) ; un DOI d'une autre forme est une
          // erreur de saisie.
          avertissements.push(prefixe + T(FORME_DOI[numero.locale].motif.test(doiFiche)
            ? 'ojs.avert.doi.divergent' : 'ojs.avert.doi.forme', [doiFiche, doiRang]));
        }
      }
      // Licence : CC-BY 4.0 si la fiche ne dit rien, sans avertissement.
      if (normaliserLicence(meta.licence) === 'droits-reserves') {
        avertissements.push(prefixe + T('ojs.avert.licence.reserves'));
      }
      const sansEmail = article.auteurs.filter((a) => !texte(a.email)).length;
      if (sansEmail > 0) { avertissements.push(prefixe + T('ojs.avert.email', [sansEmail])); }
      const orcidsTordus = article.auteurs
        .filter((a) => texte(a.orcid) !== '' && orcidCanonique(a.orcid) === '')
        .map((a) => texte(a.orcid));
      if (orcidsTordus.length > 0) {
        avertissements.push(prefixe + T('ojs.avert.orcid', [orcidsTordus.join(', ')]));
      }
      const rorsTordus = article.auteurs
        .filter((a) => texte(a.ror) !== '' && rorCanonique(a.ror) === '')
        .map((a) => texte(a.ror));
      if (rorsTordus.length > 0) {
        avertissements.push(prefixe + T('ojs.avert.ror', [rorsTordus.join(', ')]));
      }
      const rorsSansNom = article.auteurs
        .filter((a) => texte(a.ror) !== '' && rorCanonique(a.ror) !== '' && !texte(a.affiliation))
        .map((a) => rorCanonique(a.ror));
      if (rorsSansNom.length > 0) {
        avertissements.push(prefixe + T('ojs.avert.rorSansNom', [rorsSansNom.join(', ')]));
      }
    }

    // Une image sans texte alternatif ni légende part comme décorative, ce que personne n'a
    // peut-être décidé. Le formulaire des médias permet de le déclarer.
    try {
      const texteMd = fs.readFileSync(path.join(racine, 'articles', slug, slug + '.md'), 'utf8');
      for (const image of imagesIntrouvables(path.join(racine, 'articles', slug), texteMd)) {
        bloquants.push(prefixe + T('ojs.err.image.introuvable', [image]));
      }
      const manquantes = imagesSansAlternative(texteMd);
      if (manquantes.length > 0) {
        const noms = manquantes.map((i) => i.relatif || i.cible || '?').join(', ');
        avertissements.push(prefixe + T('ojs.avert.alt', [manquantes.length, noms]));
      }
      // « Légende » est le texte provisoire de Ctrl+Alt+F et « Insérer » ; publié, il
      // s'imprime sous la figure. Les deux langues sont testées : l'article a pu être monté sur
      // un poste en allemand.
      const oubliees = listerImages(texteMd)
        .filter((i) => LEGENDES_PAR_DEFAUT.has(i.legende.trim().toLowerCase()));
      if (oubliees.length > 0) {
        avertissements.push(prefixe + T('ojs.avert.legende',
          [oubliees.length, oubliees.map((i) => i.relatif || i.cible || '?').join(', ')]));
      }
      // Crédit tiers sous licence Creative Commons : la licence annonce CC-BY pour tout
      // l'article, y compris une figure « © Getty ». Simple avertissement, qui nomme la
      // figure : repérer un tiers dans du texte libre est une heuristique qui se trompe dans
      // les deux sens.
      const licence = licenceArticle(meta && meta.licence);
      if (licence.url !== '') {
        const siens = (((meta && meta.author) || [])
          .map((a) => cleCredit(a && a.nom)).filter((c) => c.length >= 3))
          .concat(CREDITS_MAISON);
        const tierces = listerImages(texteMd).filter((i) => {
          const c = cleCredit(i.copyright);
          return c !== '' && !siens.some((m) => c.indexOf(m) !== -1);
        });
        if (tierces.length > 0) {
          const noms = tierces
            .map((i) => (i.relatif || i.cible || '?') + ' (' + i.copyright.trim() + ')')
            .join(', ');
          avertissements.push(prefixe + T('ojs.avert.licence.figure',
            [licence.nom, tierces.length, noms]));
        }
      }
      // Références en texte brut, une par ligne, telles que le fichier de bibliographie les
      // porte.
      article.references = lireReferences(slug, texteMd, prefixe,
        !!(article.rubrique && !article.rubrique.sansResume));
    } catch (e) { /* .md illisible : les galleys manquants le diront déjà */ }

    for (const format of FORMATS_GALLEY) {
      const chemin = path.join(racine, 'out', slug, slug + '.' + format.ext);
      if (!fs.existsSync(chemin)) {
        bloquants.push(prefixe + T(format.ext === 'docx' ? 'ojs.err.galley.docx' : 'ojs.err.galley',
          ['out/' + slug + '/' + slug + '.' + format.ext]));
      }
      article.fichiers.push({ etiquette: format.etiquette, ext: format.ext, chemin: chemin });
    }
    articles.push(article);
  }
  // Adresses fixées par Pronto (url_path), pour que la newsletter puisse lier avant la
  // publication : le numéro et chaque article sans DOI (les autres ont l'adresse de leur
  // DOI). Calcul partagé avec la newsletter (lib/ojs-adresses.js).
  numero.urlPath = adresses.cheminNumero(numero.annee, numero.numero);
  const cheminsSansDoi = adresses.cheminsArticlesSansDoi(adresses.cleNumero(numero.annee, numero.numero),
    slugs.filter((s) => rangDoi(slugs, s, sansDoi) === -1));
  for (const a of articles) { a.urlPath = cheminsSansDoi[a.slug] || ''; }
  // Un DOI ne peut désigner deux articles : OJS n'en garderait qu'un. La comparaison porte
  // sur le DOI qui part (calculé ou manuel) ; une chaîne vide n'est pas un doublon.
  const vuDoi = {};
  for (const a of articles) {
    if (!a.doi) { continue; }
    const autre = vuDoi[a.doi];
    if (autre) { bloquants.push(T('ojs.err.doi.double', [autre, a.slug, a.doi])); }
    else { vuDoi[a.doi] = a.slug; }
  }
  // La configuration d'abord : elle explique souvent le reste, et c'est elle qui décide
  // du bouton que l'hôte propose.
  const tous = bloquantsConfig.concat(bloquants);
  if (tous.length > 0) {
    const e = new Error(T('ojs.bloquants') + '\n- ' + tous.join('\n- '));
    e.szhConfigOjs = bloquantsConfig.length > 0;
    // La liste des points, en plus du texte : l'hôte en fait une carte par point dans
    // « À corriger », chacune avec son bouton.
    e.szhBloquants = tous;
    // Les points de configuration viennent en tête : leur compte suffit à l'hôte pour savoir
    // lesquels mènent aux réglages plutôt qu'à une fiche d'article.
    e.szhBloquantsConfig = bloquantsConfig.length;
    throw e;
  }
  return { numero: numero, articles: articles, revue: revue };
}

// ORCID canonique, mêmes règles que szh-maquette.lua : identifiant nu ou URL ->
// https://orcid.org/<ID>, X final en majuscule. Une URL sans identifiant reconnaissable
// est gardée telle quelle. Sinon '' : pas de balise vide, et un avertissement.
function orcidCanonique(valeur) {
  const v = texte(valeur);
  if (v === '') { return ''; }
  const m = v.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dxX]/);
  if (m) { return 'https://orcid.org/' + m[0].toUpperCase(); }
  return /^https?:\/\//i.test(v) ? v : '';
}

// ROR canonique : identifiant nu ou URL -> https://ror.org/<id> en minuscules ; sinon ''
// (pas de balise vide, et un avertissement). Un ROR est 0, six caractères Crockford
// (sans i, l, o, u), puis deux chiffres.
//
// La valeur entière doit être un ROR. Contrairement à l'ORCID, un ROR ressemble à
// n'importe quels neuf caractères : le chercher dans une phrase ferait passer
// « Université de Genève 012345678 » pour valide et publierait une mauvaise institution,
// sans avertissement.
function rorCanonique(valeur) {
  const v = texte(valeur);
  if (v === '') { return ''; }
  const m = v.match(/^(?:https?:\/\/)?(?:ror\.org\/)?(0[0-9a-hj-km-np-tv-z]{6}[0-9]{2})$/i);
  return m ? 'https://ror.org/' + m[1].toLowerCase() : '';
}

// ---- Génération -----------------------------------------------------------------------

// Rend { chemin, avertissements }. Écrit native-<AAAAMMJJ-HHMMSS>-<volume>-<numero>.xml à
// la racine de la revue, de façon atomique. Lève une Error qui liste tous les manques
// bloquants avant d'écrire. options.maintenant (horodatage) et options.config
// (configuration imposée) servent aux tests.
function genererExportOjs(racine, options) {
  options = options || {};
  const maintenant = options.maintenant instanceof Date ? options.maintenant : new Date();
  const aujourdHui = formaterDateIso(maintenant);
  const avertissements = [];
  const cfg = options.config ? normaliserConfigOjs({ ojs: options.config }) : configOjs();
  const collecte = collecter(racine, cfg, avertissements, options.pagination || null);
  const numero = collecte.numero;
  const articles = collecte.articles;
  const revue = collecte.revue;
  // slug -> intervalle de pages ; {} si le numéro n'a jamais été paginé.
  const cartePages = intervallesPages(options.pagination || null);

  // Un seul compteur, donc des id uniques dans le fichier. OJS les réattribue à l'import ;
  // seuls comptent les renvois internes, qui pointent vers l'avant : tout est alloué avant
  // l'écriture.
  let prochainId = 1;
  const allouer = () => prochainId++;
  const idNumero = allouer();
  const parRubrique = {};                          // seq de publication par rubrique (1, 2, …)
  for (const a of articles) {
    a.idArticle = allouer();
    for (const f of a.fichiers) { f.idSubmission = allouer(); f.idFichier = allouer(); }
    a.idPublication = allouer();
    for (const auteur of a.auteurs) { auteur.idAuteur = allouer(); }
    a.galleys = a.fichiers.map((f) => ({ id: allouer(), etiquette: f.etiquette, refSubmission: f.idSubmission }));
    parRubrique[a.rubrique.cle] = (parRubrique[a.rubrique.cle] || 0) + 1;
    a.seq = parRubrique[a.rubrique.cle];
  }

  // Écriture par morceaux : seuls le plus gros asset encodé en base64 et le tampon
  // tiennent la mémoire en même temps.
  const nomSortie = 'native-' + formaterHorodatage(maintenant) + '-' +
    morceauNomFichier(numero.volume) + '-' + morceauNomFichier(numero.numero) + '.xml';
  const chemin = path.join(racine, nomSortie);
  const tmp = path.join(racine, '~$' + nomSortie); // préfixe ignoré par OneDrive, comme le PDF du Makefile
  const fd = fs.openSync(tmp, 'w');
  const tampon = [];
  let enAttente = 0;
  const vider = () => {
    if (tampon.length > 0) { fs.writeSync(fd, tampon.join('')); tampon.length = 0; enAttente = 0; }
  };
  const w = (texteAEcrire) => {
    tampon.push(texteAEcrire);
    enAttente += texteAEcrire.length;
    if (enAttente >= 1 << 20) { vider(); }
  };
  const ligne = (retrait, balise, attributs, contenu) => {
    w(' '.repeat(retrait) + '<' + balise + attributs + '>' + echapperXml(contenu) + '</' + balise + '>\n');
  };

  try {
    w('<?xml version="1.0" encoding="utf-8"?>\n');
    w('<issue xmlns="http://pkp.sfu.ca"' + XSI +
      ' published="1" current="1" access_status="1" url_path="' + echapperXml(numero.urlPath) + '"' + SCHEMA + '>\n');
    ligne(2, 'id', ' type="internal" advice="ignore"', idNumero);
    // <description> omise : le chapô du numéro ne vit pas dans ausgabe.yaml.
    w('  <issue_identification>\n');
    if (numero.volume) { ligne(4, 'volume', '', numero.volume); }
    if (numero.numero) { ligne(4, 'number', '', numero.numero); }
    if (numero.annee) { ligne(4, 'year', '', numero.annee); }
    if (numero.titre) { ligne(4, 'title', ' locale="' + numero.locale + '"', numero.titre); }
    w('  </issue_identification>\n');
    ligne(2, 'date_published', '', numero.datePublication);
    ligne(2, 'last_modified', '', numero.datePublication);

    // Une seule langue par rubrique, celle de la revue : OJS apparie les rubriques titre par
    // titre et langue par langue, et un titre dans une langue que la revue n'emploie pas fait
    // échouer l'import (« … un autre titre de cette rubrique ne correspond à aucun autre
    // titre de rubrique existante »).
    const utilisees = Object.keys(parRubrique)
      .map((cle) => articles.find((a) => a.rubrique.cle === cle).rubrique)
      .sort((a, b) => a.seq - b.seq);
    w('  <sections>\n');
    for (const s of utilisees) {
      w('    <section ref="' + echapperXml(s.abbrev[numero.locale]) + '" seq="' + s.seq +
        '" editor_restricted="0" meta_indexed="1"' +
        ' meta_reviewed="0" abstracts_not_required="' + (s.sansResume ? 1 : 0) + '" hide_title="0" hide_author="0"' +
        ' abstract_word_count="0">\n');
      if (s.idInterne) { ligne(6, 'id', ' type="internal" advice="ignore"', s.idInterne); }
      ligne(6, 'abbrev', ' locale="' + numero.locale + '"', s.abbrev[numero.locale]);
      ligne(6, 'title', ' locale="' + numero.locale + '"', s.titre[numero.locale]);
      w('    </section>\n');
    }
    w('  </sections>\n');

    if (numero.couverture) {
      const cheminCouverture = path.join(racine, numero.couverture);
      w('  <covers>\n');
      w('    <cover locale="' + numero.locale + '">\n');
      ligne(6, 'cover_image', '', numero.couverture);
      ligne(6, 'cover_image_alt_text', '', numero.titre || T('ojs.couverture.alt'));
      w('      <embed encoding="base64">');
      w(fs.readFileSync(cheminCouverture).toString('base64'));  // une seule ligne, comme la référence
      w('</embed>\n');
      w('    </cover>\n');
      w('  </covers>\n');
    }

    w('  <issue_galleys' + XSI + SCHEMA + '/>\n');
    w('  <articles' + XSI + SCHEMA + '>\n');

    for (const a of articles) {
      const meta = a.meta;
      const loc = ' locale="' + numero.locale + '"';
      w('    <article' + XSI + loc + ' date_submitted="' + aujourdHui + '" status="3"' +
        ' submission_progress="" current_publication_id="' + a.idPublication + '" stage="production">\n');
      ligne(6, 'id', ' type="internal" advice="ignore"', a.idArticle);

      for (const f of a.fichiers) {
        const octets = fs.readFileSync(f.chemin);
        w('      <submission_file' + XSI + ' id="' + f.idSubmission + '" created_at="' + aujourdHui + '"' +
          ' file_id="' + f.idFichier + '" stage="proof" updated_at="' + aujourdHui + '" viewable="false"' +
          ' genre="' + echapperXml(revue.genreFichier) + '" uploader="' + echapperXml(revue.televerseur) + '"' + SCHEMA + '>\n');
        ligne(8, 'name', loc, a.slug + '.' + f.ext);
        w('        <file id="' + f.idFichier + '" filesize="' + octets.length + '" extension="' + f.ext + '">\n');
        w('          <embed encoding="base64">');
        w(octets.toString('base64'));              // une seule ligne, comme la référence
        w('</embed>\n');
        w('        </file>\n');
        w('      </submission_file>\n');
        vider();                                   // le base64 ne s'accumule pas dans le tampon
      }

      w('      <publication' + XSI + ' version="1" status="3"' +
        ' primary_contact_id="' + a.auteurs[0].idAuteur + '" url_path="' + echapperXml(a.urlPath) + '" seq="' + a.seq + '"' +
        ' access_status="0" date_published="' + numero.datePublication + '"' +
        ' section_ref="' + echapperXml(a.rubrique.abbrev[numero.locale]) + '"' + SCHEMA + '>\n');
      ligne(8, 'id', ' type="internal" advice="ignore"', a.idPublication);
      // DOI décidé par collecter(), ou aucune balise : OJS prendrait une balise vide pour un
      // identifiant.
      if (a.doi) { ligne(8, 'id', ' type="doi" advice="update"', a.doi); }
      for (const l of localesNonVides(meta.title)) { ligne(8, 'title', ' locale="' + l + '"', meta.title[l].trim()); }
      for (const l of localesNonVides(meta.subtitle)) { ligne(8, 'subtitle', ' locale="' + l + '"', meta.subtitle[l].trim()); }
      // Le résumé est une valeur HTML : texte échappé pour le HTML, puis l'ensemble pour
      // le XML. Ce double échappement est celui de la référence.
      for (const l of localesNonVides(meta.resume)) {
        ligne(8, 'abstract', ' locale="' + l + '"', '<p>' + echapperHtml(meta.resume[l].trim()) + '</p>');
      }
      // Licence, CC-BY 4.0 par défaut. « Droits réservés » n'a pas d'URL : l'élément est
      // absent (collecter() l'a signalé).
      const licence = licenceArticle(meta.licence);
      if (licence.url !== '') { ligne(8, 'licenseUrl', '', urlOjs(licence.url)); }
      const nomsAuteurs = a.auteurs
        .map((x) => ((x.prenom || '').trim() + ' ' + (x.nom || '').trim()).trim())
        .join(', ');
      ligne(8, 'copyrightHolder', loc, nomsAuteurs);
      if (numero.annee) { ligne(8, 'copyrightYear', '', numero.annee); }
      for (const l of Object.keys(meta.keywords || {}).sort()) {
        // Le qualificatif de provenance est retiré avant le dédoublonnage, comme côté Lua :
        // « prévention » et « prévention (na) » ne donnent qu'un <keyword>.
        const vus = new Set();
        const mots = [];
        for (const brut of (meta.keywords[l] || [])) {
          const s = String(brut).trim();
          if (s === '') { continue; }
          const affiche = sansQualificatifDeProvenance(s).trim();
          // Un mot-clé réduit à son qualificatif (« (na) » saisi seul) devient vide : il est
          // écarté, comme côté Lua, plutôt que d'écrire un <name> vide qu'un validateur refuserait.
          if (affiche === '') { continue; }
          const cle = plierDescripteur(affiche);
          if (vus.has(cle)) { continue; }        // le premier rencontré fait foi
          vus.add(cle);
          mots.push(affiche);
        }
        if (mots.length === 0) { continue; }
        w('        <keywords locale="' + l + '">\n');
        for (const mot of mots) {
          w('          <keyword>\n');
          ligne(12, 'name', '', mot);
          w('          </keyword>\n');
        }
        w('        </keywords>\n');
      }

      w('        <authors' + XSI + SCHEMA + '>\n');
      a.auteurs.forEach((auteur, i) => {
        const prenom = (auteur.prenom || '').trim();
        const nom = (auteur.nom || '').trim();
        w('          <author include_in_browse="true" user_group_ref="' + echapperXml(revue.groupeAuteur) + '"' +
          ' seq="' + i + '" id="' + auteur.idAuteur + '">\n');
        // Ordre imposé par le schéma (type `identity`) : givenname, familyname, affiliation ou
        // rorAffiliation, country, email, url, orcid. givenname est requis : un auteur sans
        // prénom y met son nom entier, comme la référence pour « Edition SZH/CSPS ».
        ligne(12, 'givenname', loc, prenom || nom);
        if (prenom && nom) { ligne(12, 'familyname', loc, nom); }
        const ror = rorCanonique(auteur.ror);
        const aff = (auteur.affiliation || '').trim();
        if (ror && aff) {
          // ROR reconnaissable + affiliation : rorAffiliation
          w('            <rorAffiliation>\n');
          ligne(14, 'ror', '', ror);
          ligne(14, 'name', loc, aff);
          w('            </rorAffiliation>\n');
        } else if (aff) {
          // Affiliation seule
          w('            <affiliation>\n');
          ligne(14, 'name', loc, aff);
          w('            </affiliation>\n');
        }
        // ROR reconnaissable sans affiliation : rien (et avertissement dans collecter)
        if (revue.paysAuteur) { ligne(12, 'country', '', revue.paysAuteur); }
        if (texte(auteur.email)) { ligne(12, 'email', '', texte(auteur.email)); }
        // L'ORCID part aussi dans OJS, et donc dans le dépôt Crossref.
        const orcid = orcidCanonique(auteur.orcid);
        if (orcid) { ligne(12, 'orcid', '', orcid); }
        w('          </author>\n');
      });
      w('        </authors>\n');

      for (const g of a.galleys) {
        w('        <article_galley' + XSI + loc + ' approved="false"' + SCHEMA + '>\n');
        ligne(10, 'id', ' type="internal" advice="ignore"', g.id);
        ligne(10, 'name', loc, g.etiquette);
        ligne(10, 'seq', '', 0);
        w('          <submission_file_ref id="' + g.refSubmission + '"/>\n');
        w('        </article_galley>\n');
      }
      // <citations> suit les galleys. Une référence par <citation>, en texte brut : OJS
      // concatène les enfants ligne par ligne dans citationsRaw.
      if (a.references.length > 0) {
        w('        <citations>\n');
        for (const reference of a.references) { ligne(10, 'citation', '', reference); }
        w('        </citations>\n');
      }
      // <pages> vient après <citations> (ou le dernier </article_galley>), juste avant
      // </publication> : native.xsd étend la séquence de pkp-native.xsd (… authors ->
      // article_galley -> citations) par la sienne (issue_identification -> pages -> covers ->
      // issueId), qui vient donc après. Omis si le numéro n'a pas été paginé ou si l'article
      // n'a pas d'intervalle.
      if (cartePages[a.slug]) { ligne(8, 'pages', '', cartePages[a.slug]); }
      w('      </publication>\n');
      w('    </article>\n');
    }

    w('  </articles>\n');
    w('</issue>\n');
    vider();
    fs.closeSync(fd);
    fs.renameSync(tmp, chemin);
  } catch (e) {
    try { fs.closeSync(fd); } catch (e2) { /* déjà fermé */ }
    try { fs.unlinkSync(tmp); } catch (e2) { /* jamais écrit */ }
    throw e;
  }
  return { chemin: chemin, avertissements: avertissements };
}

module.exports = {
  genererExportOjs, configOjs, ecrireConfigOjs, normaliserConfigOjs, cheminConfigOjs,
  orcidCanonique, rorCanonique, doiCalcule, typeSansDoi, FORME_DOI,
  imagesIntrouvables, imagesIntrouvablesDesUnites,
  CHAMPS_REVUE, LOCALES_REVUE, RUBRIQUES_DEFAUT, TYPES_DEFAUT
};

if (require.main === module) {
  const racine = process.argv[2];
  if (!racine) {
    console.error('Usage : node lib/export-ojs.js <cheminRevue>');
    process.exit(2);
  }
  try {
    const resultat = genererExportOjs(racine);
    console.log(resultat.chemin);
    for (const a of resultat.avertissements) { console.log('avertissement : ' + a); }
  } catch (e) {
    console.error(String((e && e.message) || e));
    process.exit(1);
  }
}
