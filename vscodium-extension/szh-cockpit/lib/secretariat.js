// Les quatre exports du secrétariat : newsletter (local), edudoc et caractères (OAI-PMH),
// métadonnées (comparaison local/OJS). Module pur, appelé par outils/secretariat-cli.js.
//
// L'OAI-PMH (client https, parseur XML, garde SZH_RESEAU_INTERDIT) vient de lib/oai-pmh.js.
// Ce fichier lit en plus les enregistrements oai_dc complets (titre, résumé, mots-clés,
// source, galleys). Il s'appuie sur lib/export-ojs.js (DOI, rubriques), lib/articles.js
// (ordre, rang du DOI) et lib/yaml.js (fiches).
//
// Chaque export passe par un gabarit Twig (lib/gabarits.js), lu dans export-templates/ de
// l'extension, sans copie sur le poste : un gabarit modifié arrive avec la mise à jour.
'use strict';

const fs = require('fs');
const path = require('path');

const gabaritsMoteur = require('./gabarits');
const oaiPmh = require('./oai-pmh');
const auteursOjs = require('./auteurs-ojs');   // normaliserCreator : « Nom, Prénom » -> {nom, prenom}
const yaml = require('./yaml');
const articlesLib = require('./articles');     // ordre, rang du DOI, sans-DOI
const exportOjs = require('./export-ojs');     // doiCalcule, typeSansDoi, RUBRIQUES_DEFAUT, configOjs
const adresses = require('./ojs-adresses');   // base d'OJS et chemins fixés par l'export OJS
const { urlJournal } = adresses;
// Thésaurus edudoc (mots-clés MARC 690) pour la commande « edudoc ».
const motsClesEdudoc = require('./mots-cles-edudoc');
const { TL, TEXTES_COCKPIT } = require('./i18n');
const { numeroAffiche, LIBELLES_PRODUITS } = require('./accueil-page');

// ---- Petites aides communes ----------------------------------------------------------

function txt(v) { return String(v === undefined || v === null ? '' : v).trim(); }

// La langue des textes : celle de l'interface, reçue par --langue ; à défaut le français.
function langueDe(o) {
  const l = String((o && o.langue) || '').trim().toLowerCase();
  return TEXTES_COCKPIT[l] ? l : 'fr';
}
function dire(langue, cle, args) { return TL(langue, 'secretariat.' + cle, args); }
// Un vrai pluriel, le nombre en {0}. Zéro prend la forme .aucun quand elle existe, sinon le
// singulier en français et le pluriel en allemand.
function compter(langue, cle, n, args) {
  const base = 'secretariat.' + cle;
  let forme = n === 1 || (n === 0 && langue === 'fr') ? '.un' : '.plus';
  if (n === 0 && TEXTES_COCKPIT.fr[base + '.aucun'] !== undefined) { forme = '.aucun'; }
  return TL(langue, base + forme, [n].concat(args || []));
}
function nomRevue(revue) { return LIBELLES_PRODUITS[revue] || LIBELLES_PRODUITS.revue; }
function nomDossierNumero(racine) { return numeroAffiche(path.basename(String(racine || ''))); }

// Deux chiffres, comme dans les DOI et les clés de numéro. Copie de la fonction privée de
// lib/export-ojs.js.
function deuxChiffres(valeur) {
  const chiffres = String(valeur === undefined || valeur === null ? '' : valeur).replace(/\D+/g, '');
  if (chiffres === '') { return ''; }
  return chiffres.length === 1 ? '0' + chiffres : chiffres;
}

function formaterDateIso(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

// Signature d'un article : « Prénom Nom, Prénom Nom et Prénom Nom » (fr), « … und … »
// (de), pour la newsletter et Edudoc. `auteurs` : objets portant au moins prenom/nom.
function formerSignature(auteurs, locale) {
  const noms = (Array.isArray(auteurs) ? auteurs : [])
    .map((a) => (txt(a && a.prenom) + ' ' + txt(a && a.nom)).trim())
    .filter((s) => s !== '');
  if (noms.length === 0) { return ''; }
  if (noms.length === 1) { return noms[0]; }
  const jonction = locale === 'de' ? ' und ' : ' et ';
  return noms.slice(0, -1).join(', ') + jonction + noms[noms.length - 1];
}

// Titre complet en une ligne : le titre dans la langue demandée, puis « . » et le
// sous-titre s'il existe.
function combinerTitre(titreParLangue, sousTitreParLangue, langue) {
  const t = txt((titreParLangue || {})[langue]);
  if (t === '') { return ''; }
  const s = txt((sousTitreParLangue || {})[langue]);
  return s !== '' ? t + '. ' + s : t;
}

// Un auteur de fiche (CHAMPS_AUTEUR de lib/yaml.js), avec les deux formes de nom dont les
// gabarits ont besoin.
function auteurComplet(a) {
  const prenom = txt(a && a.prenom);
  const nom = txt(a && a.nom);
  return {
    prenom: prenom, nom: nom, fonction: txt(a && a.fonction), affiliation: txt(a && a.affiliation),
    orcid: txt(a && a.orcid), email: txt(a && a.email), photo: txt(a && a.photo),
    nomComplet: (prenom + ' ' + nom).trim(),
    nomInverse: nom && prenom ? nom + ', ' + prenom : (nom || prenom)
  };
}

// Les articles du numéro : les dossiers articles/<slug>/ qui contiennent <slug>.md, ou
// dont la fiche porte `type: documentation` (la Documentation, arborescence Kirby, n'a
// pas de .md). Copie de la fonction privée listerSlugs de lib/export-ojs.js : les deux
// doivent rester identiques.
function listerSlugsLocaux(racine) {
  const dossier = path.join(racine, 'articles');
  let entrees = [];
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
  catch (e) { return []; }
  return entrees
    .filter((e) => {
      if (!e.isDirectory()) { return false; }
      if (fs.existsSync(path.join(dossier, e.name, e.name + '.md'))) { return true; }
      let type = '';
      try { type = yaml.analyserMeta(fs.readFileSync(path.join(dossier, e.name, e.name + '.meta.yaml'), 'utf8')).type; }
      catch (err) { return false; }
      return type === 'documentation';
    })
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'fr'));
}

// ---- Dossier des gabarits --------------------------------------------------------------

// Le dossier des gabarits livrés avec l'extension. `--gabarits` (secretariat-cli.js) le
// remplace pour la mise au point et les tests.
function dossierGabaritsSource() { return path.join(__dirname, '..', 'export-templates'); }

// Les gabarits attendus dans dossierGabaritsSource(), vérifiés par les tests.
const NOMS_GABARITS_DEFAUT = [
  'newsletter-intro.twig', 'newsletter-editorial.twig', 'newsletter-dossier-thematique.twig', 'newsletter-varia.twig',
  'newsletter-tribune-libre.twig', 'newsletter-documentation.twig', 'newsletter-auteurs.twig',
  'edudoc.twig', 'caracteres.twig', 'metadonnees.twig'
];

function chargerGabarit(dossier, nomFichier, langue) {
  const chemin = path.join(dossier, nomFichier);
  let source;
  try { source = fs.readFileSync(chemin, 'utf8'); }
  catch (e) { throw new Error(dire(langueDe({ langue }), 'modele.absent', [chemin])); }
  return gabaritsMoteur.compiler(source, nomFichier);
}

// CSV pour l'Excel d'un poste Windows : BOM UTF-8 et fins de ligne CRLF. Le gabarit écrit
// en \n ; la conversion se fait ici.
function versCsvFinal(texte) {
  return '\uFEFF' + String(texte || '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

// ---- Lecture d'un numéro local (ausgabe.yaml + fiches) --------------------------------
//
// Même règle de rang et de DOI que collecter() de lib/export-ojs.js, avec les mêmes
// fonctions : le DOI annoncé par la newsletter est celui que l'export OJS déposera.

function collecterNumeroLocal(racine, emettre, langueTextes) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const L = langueDe({ langue: langueTextes });
  let brut;
  try { brut = fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'); }
  catch (e) { throw new Error(dire(L, 'numero.illisible', [nomDossierNumero(racine)])); }
  const valeurs = yaml.analyserAusgabe(brut);

  const locale = yaml.langueDefaut(valeurs);
  const autreLocale = locale === 'de' ? 'fr' : 'de';
  // L'année du numéro : celle de `date:`, sinon celle du nom du dossier (« 2027-03 » ->
  // « 2027 »). `date:` est la date de parution, encore vide quand on prépare la
  // newsletter ; sans année, doiCalcule rend ''. Même règle dans lib/metadonnees-hote.js
  // (anneeNumero) et lib/yaml.js (titreNumero) : les trois vont ensemble.
  let annee = (String(valeurs.date || '').match(/\d{4}/) || [''])[0];
  if (annee === '') {
    annee = (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
  }
  const numeroTxt = txt(valeurs.numero);
  const volume = txt(valeurs.volume);
  const titreNumero = txt(valeurs.title);
  // ausgabe.yaml ne porte le titre du numéro que dans la langue du numéro.
  const titreParLangue = { fr: '', de: '' };
  if (titreParLangue[locale] !== undefined) { titreParLangue[locale] = titreNumero; }
  const revueCle = yaml.normaliserRevue(valeurs.revue) || (locale === 'de' ? 'zeitschrift' : 'revue');

  const cfg = exportOjs.configOjs();
  const parCle = {};
  for (const r of cfg.rubriques) { parCle[r.cle] = r; }

  const slugsDisque = listerSlugsLocaux(racine);
  const fiches = {};
  for (const slug of slugsDisque) {
    try { fiches[slug] = yaml.analyserMeta(fs.readFileSync(path.join(racine, 'articles', slug, slug + '.meta.yaml'), 'utf8')); }
    catch (e) { fiches[slug] = null; emit({ t: 'avert', texte: dire(L, 'fiche.illisible', [slug]) }); }
  }
  const slugsAvecFiche = slugsDisque.filter((s) => fiches[s]);

  const sansDoiVoulu = new Set(articlesLib.analyserSansDoi(valeurs[articlesLib.CLE_SANS_DOI]));
  const sansDoi = new Set(sansDoiVoulu);
  for (const slug of slugsAvecFiche) {
    if (sansDoi.has(slug)) { continue; }
    if (exportOjs.typeSansDoi(cfg, fiches[slug].type)) { sansDoi.add(slug); }
  }
  const slugs = articlesLib.ordonnerArticles(valeurs[articlesLib.CLE_ORDRE], slugsAvecFiche, sansDoi).slugs;

  // Les chemins OJS des articles sans DOI : les mêmes que ceux de l'export OJS.
  const cleOjs = adresses.cleNumero(annee, numeroTxt);
  const cheminsSansDoi = adresses.cheminsArticlesSansDoi(cleOjs,
    slugs.filter((s) => articlesLib.rangDoi(slugs, s, sansDoi) === -1));

  const articles = [];
  for (const slug of slugs) {
    const meta = fiches[slug];
    const rubriqueCle = cfg.types[txt(meta.type)] || '';
    const rubrique = parCle[rubriqueCle] || null;
    const rang = articlesLib.rangDoi(slugs, slug, sansDoi);
    const doiCalc = exportOjs.doiCalcule(locale, annee, numeroTxt, rang);
    const doiFiche = txt(meta.doi);
    const doi = rang === -1 ? '' : (doiFiche || doiCalc);
    const auteurs = (meta.author || []).filter((a) => txt(a.prenom) !== '' || txt(a.nom) !== '');
    const titreLoc = combinerTitre(meta.title, meta.subtitle, locale);
    const titreAutre = txt((meta.title || {})[autreLocale]) !== '' ? combinerTitre(meta.title, meta.subtitle, autreLocale) : '';
    articles.push({
      slug: slug, rang: rang, type: txt(meta.type),
      rubriqueCle: rubriqueCle,
      rubriqueTitreFr: rubrique ? txt(rubrique.titre.fr) : '',
      rubriqueTitreDe: rubrique ? txt(rubrique.titre.de) : '',
      doi: doi, urlDoi: doi ? 'https://doi.org/' + doi : '',
      urlOjs: rang === -1 ? adresses.urlArticle(locale, cheminsSansDoi[slug]) : '',
      langue: yaml.normaliserLangueArticle(meta.lang) || locale,
      licenceNom: yaml.licenceArticle(meta.licence).nom,
      licenceUrl: yaml.licenceArticle(meta.licence).url,
      titreFr: combinerTitre(meta.title, meta.subtitle, 'fr'),
      titreDe: combinerTitre(meta.title, meta.subtitle, 'de'),
      titre: titreLoc, titreAutreLangue: titreAutre,
      resumeFr: txt((meta.resume || {}).fr), resumeDe: txt((meta.resume || {}).de),
      motsClesFr: (meta.keywords || {}).fr || [], motsClesDe: (meta.keywords || {}).de || [],
      signatureFr: formerSignature(auteurs, 'fr'), signatureDe: formerSignature(auteurs, 'de'),
      signature: formerSignature(auteurs, locale),
      auteurs: auteurs.map(auteurComplet)
    });
    const dernier = articles[articles.length - 1];
    dernier.lien = dernier.urlDoi || dernier.urlOjs;
  }
  return {
    numero: {
      cle: annee + '-' + deuxChiffres(numeroTxt), revue: revueCle, locale: locale,
      annee: annee, numero: numeroTxt, volume: volume, titre: titreNumero,
      // « 03/2026 », comme l'écrit la newsletter ; vide dès que l'un des deux manque.
      numeroAnnee: cleOjs ? cleOjs.slice(5) + '/' + annee : '',
      // Le titre du numéro dans chaque langue : '' pour la langue que ausgabe.yaml ne porte pas.
      titreFr: titreParLangue.fr, titreDe: titreParLangue.de,
      // Page du numéro sur OJS, à l'adresse que l'export OJS lui fixe ('' si calcul impossible).
      url: adresses.urlNumero(locale, adresses.cheminNumero(annee, numeroTxt)),
      // Le libellé affiché (rapports, messages) : « R2027-03 | Titre », par la fonction de
      // lib/yaml.js.
      libelle: yaml.titreNumero(racine)
    },
    articles: articles
  };
}

// ---- newsletter : l'introduction, cinq .txt (un par rubrique) et auteurs.csv ---------------------------

// L'ordre de la newsletter, le même pour les deux revues ; le préfixe numérique le garde
// dans le dossier. L'introduction (0-intro.txt) vient avant les rubriques.
const FICHIER_INTRO = '0-intro.txt';
const SECTIONS_NEWSLETTER = [
  { cle: 'ED', fichier: '1-editorial.txt', gabarit: 'newsletter-editorial.twig' },
  { cle: 'DT', fichier: '2-dossier-thematique.txt', gabarit: 'newsletter-dossier-thematique.twig' },
  { cle: 'VA', fichier: '3-varia.txt', gabarit: 'newsletter-varia.twig' },
  { cle: 'TL', fichier: '4-tribune-libre.txt', gabarit: 'newsletter-tribune-libre.twig' },
  { cle: 'DC', fichier: '5-documentation.txt', gabarit: 'newsletter-documentation.twig' }
];

// Une ligne par auteur·e du numéro, dans l'ordre des articles puis par nom : le même ordre
// que les signatures dans Mailchimp.
function construireAuteursNewsletter(articles) {
  const lignes = [];
  for (const article of articles) {
    const tries = article.auteurs.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
    for (const a of tries) {
      lignes.push({
        nom: a.nom, prenom: a.prenom, fonction: a.fonction, affiliation: a.affiliation,
        orcid: a.orcid, email: a.email, titreArticle: article.titre,
        rang: article.rang >= 0 ? String(article.rang) : '', doi: article.doi
      });
    }
  }
  return lignes;
}

async function commandeNewsletter(opts) {
  const o = opts || {};
  const emit = typeof o.emettre === 'function' ? o.emettre : () => {};
  const L = langueDe(o);
  if (!o.racineNumero) { throw new Error(dire(L, 'option.requise', ['--numero'])); }
  if (!o.dossierSortie) { throw new Error(dire(L, 'option.requise', ['--sortie'])); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();

  emit({ t: 'etape', texte: dire(L, 'numero.lecture', [nomDossierNumero(o.racineNumero)]) });
  const { numero, articles } = collecterNumeroLocal(o.racineNumero, emit, L);
  fs.mkdirSync(o.dossierSortie, { recursive: true });
  // Le nom de chaque rubrique dans la langue de l'interface, même quand elle est vide.
  const titresRubriques = {};
  for (const r of exportOjs.configOjs().rubriques) { titresRubriques[r.cle] = txt((r.titre || {})[L]) || txt((r.titre || {}).fr); }

  // Total de progression : l'introduction, les cinq rubriques et auteurs.csv. Une rubrique
  // vide sautée compte aussi comme un pas.
  const totalNewsletter = SECTIONS_NEWSLETTER.length + 2;
  let faitNewsletter = 0;

  const fichiers = [];

  emit({ t: 'etape', texte: dire(L, 'newsletter.intro') });
  if (numero.url === '') { emit({ t: 'avert', texte: dire(L, 'newsletter.intro.sanslien') }); }
  if (numero.titre === '') { emit({ t: 'avert', texte: dire(L, 'newsletter.intro.titreaucun') }); }
  else {
    const manquante = numero.titreFr === '' ? 'fr' : numero.titreDe === '' ? 'de' : '';
    if (manquante !== '') { emit({ t: 'avert', texte: dire(L, 'newsletter.intro.titre.' + manquante) }); }
  }
  const cheminIntro = path.join(o.dossierSortie, FICHIER_INTRO);
  fs.writeFileSync(cheminIntro, chargerGabarit(dossierGabarits, 'newsletter-intro.twig', L).rendre({ numero: numero }).contenu || '', 'utf8');
  fichiers.push(cheminIntro);
  emit({ t: 'fichier', chemin: cheminIntro, nom: FICHIER_INTRO });
  faitNewsletter++;
  emit({ t: 'progres', fait: faitNewsletter, total: totalNewsletter });
  for (const section of SECTIONS_NEWSLETTER) {
    const articlesSection = articles.filter((a) => a.rubriqueCle === section.cle);
    const nomRubrique = titresRubriques[section.cle] || section.fichier;
    emit({ t: 'etape', texte: compter(L, 'newsletter.rubrique', articlesSection.length, [nomRubrique]) });
    if (articlesSection.length === 0) {
      faitNewsletter++;
      emit({ t: 'progres', fait: faitNewsletter, total: totalNewsletter });
      continue;
    }
    for (const a of articlesSection) {
      if (!a.lien) { emit({ t: 'avert', texte: dire(L, 'newsletter.sansdoi', [a.slug]) }); }
    }
    const premier = articlesSection[0];
    const sectionCtx = {
      cle: section.cle,
      titre: numero.locale === 'de' ? premier.rubriqueTitreDe : premier.rubriqueTitreFr
    };
    const gabarit = chargerGabarit(dossierGabarits, section.gabarit, L);
    const blocs = gabarit.rendre({ numero: numero, section: sectionCtx, articles: articlesSection });
    const chemin = path.join(o.dossierSortie, section.fichier);
    fs.writeFileSync(chemin, blocs.contenu || '', 'utf8');
    fichiers.push(chemin);
    emit({ t: 'fichier', chemin: chemin, nom: section.fichier });
    faitNewsletter++;
    emit({ t: 'progres', fait: faitNewsletter, total: totalNewsletter });
  }

  const auteursLignes = construireAuteursNewsletter(articles);
  const personnes = new Set(auteursLignes.map((a) => (a.nom + '\u0000' + a.prenom).toLowerCase()));
  emit({ t: 'etape', texte: compter(L, 'newsletter.auteurs', personnes.size) });
  const gabaritAuteurs = chargerGabarit(dossierGabarits, 'newsletter-auteurs.twig', L);
  const blocsAuteurs = gabaritAuteurs.rendre({ auteurs: auteursLignes, numero: numero });
  const cheminAuteurs = path.join(o.dossierSortie, 'auteurs.csv');
  fs.writeFileSync(cheminAuteurs, versCsvFinal(blocsAuteurs.contenu || ''));
  fichiers.push(cheminAuteurs);
  emit({ t: 'fichier', chemin: cheminAuteurs, nom: 'auteurs.csv' });
  faitNewsletter++;
  emit({ t: 'progres', fait: faitNewsletter, total: totalNewsletter });

  return { ok: true, texte: compter(L, 'newsletter.fin', fichiers.length, [numero.cle]) };
}

// ---- Moisson OAI-PMH (oai_dc), spécifique au secrétariat ------------------------------
//
// lib/auteurs-ojs.js moissonne l'OAI en marcxml, pour les seuls noms d'auteur·e·s. Le
// secrétariat a besoin de l'enregistrement oai_dc complet : la pagination est donc refaite
// ici, avec les mêmes fonctions (erreurOai, extraireResumptionToken, recupererAvecRepli) et
// la même garde contre un resumptionToken qui boucle.

const BASES_OAI = {
  revue: urlJournal('fr') + '/oai',
  zeitschrift: urlJournal('de') + '/oai'
};
// Environ 350 notices par revue sur l'instance ; large marge.
const PAGES_MAX_OAI_DC = 200;

// Les balises répétées d'un fragment XML (dc:title, dc:subject, dc:creator…), dans
// l'ordre du document, avec leur xml:lang s'il y en a un.
function extraireBalisesRepetees(xmlFragment, balise) {
  const echappee = balise.replace(':', '\\:');
  const re = new RegExp('<' + echappee + '((?:\\s[^>]*)?)(?:/>|>([\\s\\S]*?)<\\/' + echappee + '>)', 'g');
  const sortie = [];
  for (const m of String(xmlFragment || '').matchAll(re)) {
    const attrs = m[1] || '';
    const mLang = attrs.match(/xml:lang\s*=\s*["']([^"']+)["']/i);
    sortie.push({ lang: mLang ? mLang[1].toLowerCase().slice(0, 2) : '', texte: oaiPmh.decoderTexteXml(m[2] || '').trim() });
  }
  return sortie;
}

function extraireBlocsRecord(xml) {
  const blocs = [];
  for (const m of String(xml || '').matchAll(/<record(?:\s[^>]*)?>([\s\S]*?)<\/record>/g)) { blocs.push(m[1]); }
  return blocs;
}

// dc:source : « …; Bd. 16 Nr. 03 (2023): Titre ; 27-32 » (de) ou
// « …; Vol. 16 No 03 (2023): Titre; 27-32 » (fr). L'année et les pages manquent parfois
// (numéros récents) : ce qui n'est pas reconnu reste vide.
function analyserSourceOjs(texte) {
  const s = String(texte || '');
  const m = s.match(/(?:Bd\.|Vol\.)\s*(\d+)\s*,?\s*(?:Nr\.|No\.?)\s*(\d+)\s*(?:\((\d{4})\))?\s*:\s*(.*)$/);
  if (!m) { return null; }
  let reste = String(m[4] || '').trim();
  let pages = '';
  const posPv = reste.lastIndexOf(';');
  if (posPv !== -1) {
    const queue = reste.slice(posPv + 1).trim();
    if (/^[0-9][0-9\u2013\u2014-]*$/.test(queue)) { pages = queue; reste = reste.slice(0, posPv).trim(); }
  }
  return { volume: m[1], numero: m[2], annee: m[3] || '', titre: reste, pages: pages };
}

// Un enregistrement oai_dc décodé en article. `revueCle` ('revue'|'zeitschrift') vient de
// l'adresse interrogée : les deux revues sont sur le même serveur.
function decoderRecordOai(corpsRecord, revueCle) {
  const mHeader = corpsRecord.match(/<header(?:\s[^>]*)?>([\s\S]*?)<\/header>/);
  const header = mHeader ? mHeader[1] : corpsRecord.match(/<header(?:\s[^>]*)?\/>/) ? '' : corpsRecord;
  const supprime = /<header[^>]*\bstatus\s*=\s*["']deleted["']/.test(corpsRecord);
  const mId = header.match(/<identifier(?:\s[^>]*)?>([\s\S]*?)<\/identifier>/);
  const identifiant = mId ? oaiPmh.decoderTexteXml(mId[1]).trim() : '';
  if (supprime) { return { supprime: true, identifiant: identifiant }; }

  const setSpecs = [];
  for (const m of header.matchAll(/<setSpec(?:\s[^>]*)?>([\s\S]*?)<\/setSpec>/g)) { setSpecs.push(oaiPmh.decoderTexteXml(m[1]).trim()); }
  let rubriqueCle = '';
  for (const s of setSpecs) {
    const i = s.indexOf(':');
    if (i !== -1) { rubriqueCle = s.slice(i + 1); break; }
  }

  const mMeta = corpsRecord.match(/<metadata(?:\s[^>]*)?>([\s\S]*?)<\/metadata>/);
  const meta = mMeta ? mMeta[1] : '';

  const titres = {};
  for (const t of extraireBalisesRepetees(meta, 'dc:title')) { if (t.lang && !titres[t.lang]) { titres[t.lang] = t.texte; } }
  const sujets = {};
  for (const s of extraireBalisesRepetees(meta, 'dc:subject')) {
    const l = s.lang || '';
    (sujets[l] = sujets[l] || []).push(s.texte);
  }
  const descriptions = {};
  for (const d of extraireBalisesRepetees(meta, 'dc:description')) { if (d.lang && !descriptions[d.lang]) { descriptions[d.lang] = d.texte; } }
  const creatorsBruts = extraireBalisesRepetees(meta, 'dc:creator').map((c) => c.texte);
  const identifiersDc = extraireBalisesRepetees(meta, 'dc:identifier').map((c) => c.texte);
  const sourcesDc = extraireBalisesRepetees(meta, 'dc:source').map((c) => c.texte);
  const relations = extraireBalisesRepetees(meta, 'dc:relation').map((c) => c.texte);
  const formats = extraireBalisesRepetees(meta, 'dc:format').map((c) => c.texte);
  const dates = extraireBalisesRepetees(meta, 'dc:date').map((c) => c.texte);

  // DOI et URL de page parmi les dc:identifier (l'ordre entre les deux n'est pas garanti).
  let doi = '';
  let urlPage = '';
  for (const v of identifiersDc) {
    const nu = v.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
    if (/^10\.\d{4,9}\//.test(nu)) { doi = nu; }
    else if (/^https?:\/\//i.test(v)) { urlPage = v; }
  }

  // dc:source : l'ISSN d'un côté, la forme allemande ou française de l'autre.
  let issn = '';
  let source = null;
  for (const s of sourcesDc) {
    const mIssn = s.match(/\b(\d{4}-\d{3}[\dXx])\b/);
    if (mIssn && issn === '') { issn = mIssn[1]; }
    const parsed = analyserSourceOjs(s);
    if (parsed && !source) { source = parsed; }
  }

  // Galleys : dc:relation et dc:format se répètent dans le même ordre. Un type MIME absent
  // ou inattendu n'écrase pas un format déjà trouvé.
  const galleys = { pdf: '', html: '', docx: '' };
  relations.forEach((url, i) => {
    const fmt = String(formats[i] || '').toLowerCase();
    if (fmt.indexOf('pdf') !== -1) { galleys.pdf = galleys.pdf || url; }
    else if (fmt.indexOf('html') !== -1) { galleys.html = galleys.html || url; }
    else if (fmt.indexOf('wordprocessingml') !== -1) { galleys.docx = galleys.docx || url; }
  });

  const auteurs = creatorsBruts.map((c) => auteursOjs.normaliserCreator(c)).filter((a) => a);

  // Le DOI de la maison porte la revue, l'année, le numéro et le rang : il sert à grouper
  // les articles en numéros. dc:source ne sert alors qu'au volume et aux pages.
  const mDoi = doi.match(/^10\.57161\/([rz])(\d{4})-(\d{2})-(\d{2})$/);
  let annee = (source && source.annee) || '';
  let numero = source ? deuxChiffres(source.numero) : '';
  let rang = null;
  let cleNumero = null;
  let revueLettre = '';
  if (mDoi) {
    revueLettre = mDoi[1];
    annee = mDoi[2]; numero = mDoi[3]; rang = parseInt(mDoi[4], 10);
    cleNumero = annee + '-' + numero;
  } else if (annee && numero) {
    cleNumero = annee + '-' + numero;
  }
  const locale = revueLettre === 'z' ? 'de' : (revueLettre === 'r' ? 'fr' : (revueCle === 'zeitschrift' ? 'de' : 'fr'));

  return {
    supprime: false, identifiant: identifiant, rubriqueCle: rubriqueCle, revue: revueCle, locale: locale,
    doi: doi, urlDoi: doi ? 'https://doi.org/' + doi : '', urlPage: urlPage,
    titres: titres, sujets: sujets, descriptions: descriptions,
    auteurs: auteurs, auteursBruts: creatorsBruts,
    dateOai: dates[0] || '', issn: issn,
    volume: (source && source.volume) || '', numero: numero, annee: annee,
    titreNumero: (source && source.titre) || '', pages: (source && source.pages) || '',
    rang: rang, cleNumero: cleNumero, galleys: galleys
  };
}

// Pagination OAI-PMH de `verb=ListRecords&metadataPrefix=oai_dc`, avec la même garde
// contre les boucles (jeton déjà vu, plafond de pages) que moissonner() de lib/auteurs-ojs.js.
//
// `depuisAnnee` (AAAA ou null) devient `&from=AAAA-01-01` sur la première requête
// seulement : selon la norme OAI-PMH, les pages suivantes ne portent que le
// resumptionToken, et le serveur rejette une requête qui répète `from`.
async function moissonnerOaiDc(recuperer, base, emettre, depuisAnnee, langue, revue) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const L = langueDe({ langue });
  const site = nomRevue(revue);
  const blocs = [];
  let url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'verb=ListRecords&metadataPrefix=oai_dc' +
    (depuisAnnee ? '&from=' + depuisAnnee + '-01-01' : '');
  const tokensVus = new Set();
  for (let page = 0; page < PAGES_MAX_OAI_DC; page++) {
    // L'étape est annoncée avant la requête, pour que l'attente réseau (plusieurs
    // secondes) se voie.
    emit({ t: 'etape', texte: dire(L, 'ojs.page', [page + 1]) });
    let xml;
    try { xml = await recuperer(url); }
    catch (e) { throw new Error(dire(L, 'ojs.injoignable', [site, String((e && e.message) || e)])); }
    const erreur = oaiPmh.erreurOai(xml);
    if (erreur) {
      if (erreur.code === 'noRecordsMatch') { return blocs; }
      throw new Error(dire(L, 'ojs.refus', [site, erreur.code + (erreur.message ? ' : ' + erreur.message : '')]));
    }
    for (const bloc of extraireBlocsRecord(xml)) { blocs.push(bloc); }
    emit({ t: 'etape', texte: compter(L, 'ojs.articles', blocs.length) });
    // total: 0 = inconnu : ojs.szh.ch n'envoie pas completeListSize avec le resumptionToken.
    emit({ t: 'progres', fait: page + 1, total: 0 });
    const token = oaiPmh.extraireResumptionToken(xml);
    if (token === '') { return blocs; }
    if (tokensVus.has(token)) { throw new Error(dire(L, 'ojs.boucle', [site])); }
    tokensVus.add(token);
    url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'verb=ListRecords&resumptionToken=' + encodeURIComponent(token);
  }
  throw new Error(dire(L, 'ojs.pages', [site, PAGES_MAX_OAI_DC]));
}

// Regroupe des articles décodés en numéros, par clé "<année>-<numéro>" tirée du DOI, sinon
// de dc:source. Un article sans l'un ni l'autre est signalé et écarté.
function grouperNumeros(articles, emettre, langue) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const L = langueDe({ langue });
  const table = {};
  for (const art of articles) {
    if (!art.cleNumero) {
      emit({ t: 'avert', texte: dire(L, 'ojs.orphelin', [art.identifiant || '?']) });
      continue;
    }
    if (!table[art.cleNumero]) {
      table[art.cleNumero] = {
        cle: art.cleNumero, revue: art.revue, locale: art.locale,
        annee: art.annee || '', numero: art.numero || '', volume: art.volume || '',
        titre: art.titreNumero || '', issn: art.issn || '', articles: []
      };
    }
    const n = table[art.cleNumero];
    if (!n.volume && art.volume) { n.volume = art.volume; }
    if (!n.titre && art.titreNumero) { n.titre = art.titreNumero; }
    if (!n.issn && art.issn) { n.issn = art.issn; }
    n.articles.push(art);
  }
  for (const cle of Object.keys(table)) {
    table[cle].articles.sort((a, b) => (a.rang === null ? 999 : a.rang) - (b.rang === null ? 999 : b.rang));
  }
  return table;
}

// ---- Cache C:\...\<f.json> des numéros moissonnés (--cache) ---------------------------
//
// Fichier choisi par l'appelant (--cache), où les deux revues coexistent. Une même clé
// "<année>-<numéro>" existe dans les deux revues (numéros parallèles fr/de) : chaque clé
// porte donc une liste de numéros.

function lireCacheNumeros(chemin) {
  try {
    const brut = JSON.parse(String(fs.readFileSync(chemin, 'utf8')).replace(/^\uFEFF/, ''));
    if (brut && typeof brut === 'object' && brut.numeros && typeof brut.numeros === 'object') {
      return { version: 1, dateRecolte: typeof brut.dateRecolte === 'string' ? brut.dateRecolte : null, numeros: brut.numeros };
    }
  } catch (e) { /* absent ou illisible : cache vide */ }
  return { version: 1, dateRecolte: null, numeros: {} };
}

function ecrireCacheNumeros(chemin, cache) {
  fs.mkdirSync(path.dirname(chemin), { recursive: true });
  yaml.ecrireAtomique(chemin, JSON.stringify(cache, null, 2) + '\n');
}

async function commandeNumerosOjs(opts) {
  const o = opts || {};
  const emit = typeof o.emettre === 'function' ? o.emettre : () => {};
  const L = langueDe(o);
  const revue = String(o.revue || '').toLowerCase();
  if (!BASES_OAI[revue]) { throw new Error(dire(L, 'option.revue', [o.revue || ''])); }
  if (!o.cheminCache) { throw new Error(dire(L, 'option.requise', ['--cache'])); }
  const recuperer = o.recuperer || oaiPmh.recupererAvecRepli;

  // null = moisson complète. Sinon l'année demandée : elle part dans l'URL
  // (&from=<anneePlancher>-01-01) et sert au filtre ci-dessous.
  const anneePlancher = o.depuisAnnee ? String(o.depuisAnnee) : null;
  if (anneePlancher !== null && !/^\d{4}$/.test(anneePlancher)) {
    throw new Error(dire(L, 'option.annee', [anneePlancher]));
  }

  emit({ t: 'etape', texte: anneePlancher ? dire(L, 'ojs.recherche', [nomRevue(revue), anneePlancher])
    : dire(L, 'ojs.recherche.tout', [nomRevue(revue)]) });
  const blocs = await moissonnerOaiDc(recuperer, BASES_OAI[revue], emit, anneePlancher, L, revue);
  const articles = blocs.map((c) => decoderRecordOai(c, revue)).filter((a) => a && !a.supprime);
  const numerosMap = grouperNumeros(articles, emit, L);

  // `from` filtre sur la date de dernière modification, pas sur la parution : un numéro
  // plus ancien arrive avec ses seuls articles retouchés depuis (par exemple 1 article sur
  // 9). Il serait exporté incomplet : on l'écarte entièrement.
  if (anneePlancher) {
    for (const cle of Object.keys(numerosMap)) {
      if (parseInt(numerosMap[cle].annee, 10) < parseInt(anneePlancher, 10)) {
        emit({ t: 'avert', texte: dire(L, 'ojs.partiel', [cle, numerosMap[cle].annee]) });
        delete numerosMap[cle];
      }
    }
  }

  const cache = lireCacheNumeros(o.cheminCache);
  // Remplace les numéros de la revue moissonnée et garde l'autre revue (numeros-ojs est
  // appelé une fois par revue). Deux moissons de la même revue ne fusionnent pas : pour
  // remonter d'une année, on relance avec --depuis-annee diminué de 1.
  for (const cle of Object.keys(cache.numeros)) {
    cache.numeros[cle] = cache.numeros[cle].filter((n) => n.revue !== revue);
    if (cache.numeros[cle].length === 0) { delete cache.numeros[cle]; }
  }
  for (const cle of Object.keys(numerosMap)) {
    cache.numeros[cle] = (cache.numeros[cle] || []).concat([numerosMap[cle]]);
  }
  cache.dateRecolte = new Date().toISOString();
  ecrireCacheNumeros(o.cheminCache, cache);

  const listeTriee = Object.keys(numerosMap).map((c) => numerosMap[c])
    .sort((a, b) => (b.annee + '-' + b.numero).localeCompare(a.annee + '-' + a.numero));
  for (const n of listeTriee) {
    emit({ t: 'numero', cle: n.cle, libelle: n.titre || n.cle, annee: n.annee, numero: n.numero, volume: n.volume });
  }
  return {
    ok: true, texte: compter(L, 'ojs.fin', listeTriee.length),
    anneePlancher: anneePlancher
  };
}

// ---- edudoc : CSV, entièrement d'après l'OAI ------------------------------------------
//
// Le détail des colonnes, champ par champ, est dans le gabarit edudoc.twig.

const REVUES_EDUDOC = {
  revue: { id: '207536', titre: 'Revue suisse de pédagogie spécialisée', langueMarc: 'fre' },
  zeitschrift: { id: '202299', titre: 'Schweizerische Zeitschrift für Heilpädagogik', langueMarc: 'ger' }
};

function selectionnerNumeros(cache, cles, emettre, langue) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const L = langueDe({ langue });
  const trouves = [];
  for (const cle of cles) {
    const liste = cache.numeros[cle];
    if (!liste || liste.length === 0) { emit({ t: 'avert', texte: dire(L, 'introuvable', [cle]) }); continue; }
    for (const n of liste) { trouves.push(n); }
  }
  return trouves;
}

// ---- Mots-clés edudoc (MARC 690) : joints par DOI depuis les numéros locaux -----------
//
// Les mots-clés edudoc viennent du .meta.yaml de l'article dans le numéro local, disponible
// avant publication. Les fiches sont lues par collecterNumeroLocal et jointes par DOI, comme
// dans comparerArticle/comparerNumero.

// Les articles d'un ou plusieurs numéros locaux, indexés par DOI. Un DOI présent dans deux
// racines (numéro et son archive, par exemple) est signalé ; le dernier rencontré, dans
// l'ordre des --numero, l'emporte.
function indexerArticlesLocauxParDoi(racines, emettre, langue) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const L = langueDe({ langue });
  const parDoi = {};
  const racineParDoi = {};
  for (const racine of racines) {
    const { articles } = collecterNumeroLocal(racine, emettre, L);
    for (const art of articles) {
      if (!art.doi) { continue; }
      if (parDoi[art.doi]) {
        emit({ t: 'avert', texte: dire(L, 'edudoc.doublon', [art.doi, racineParDoi[art.doi], racine]) });
      }
      parDoi[art.doi] = art;
      racineParDoi[art.doi] = racine;
    }
  }
  return parDoi;
}

function construireLigneEdudoc(numero, art) {
  const infos = REVUES_EDUDOC[numero.revue] || REVUES_EDUDOC.revue;
  const titre = art.titres[art.locale] || Object.values(art.titres)[0] || '';
  const resume = art.descriptions[art.locale] || Object.values(art.descriptions)[0] || '';
  const urlPdf = (art.galleys.pdf || '').replace(/\/view(\/|$)/i, '/download$1');
  return {
    langueMarc: infos.langueMarc, titre: titre, signature: formerSignature(art.auteurs, art.locale),
    annee: numero.annee, volume: numero.volume, numero: numero.numero, pages: art.pages || '',
    resume: resume, revueId: infos.id, revueTitre: infos.titre,
    urlDoi: art.urlDoi, urlPdfTelechargement: urlPdf,
    auteursInverses: art.auteursBruts.slice(), doi: art.doi
  };
}

async function commandeEdudoc(opts) {
  const o = opts || {};
  const emit = typeof o.emettre === 'function' ? o.emettre : () => {};
  const L = langueDe(o);
  if (!o.cheminCache) { throw new Error(dire(L, 'option.requise', ['--cache'])); }
  if (!Array.isArray(o.cles) || o.cles.length === 0) { throw new Error(dire(L, 'option.requise', ['--numeros'])); }
  if (!o.dossierSortie) { throw new Error(dire(L, 'option.requise', ['--sortie'])); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();

  const cache = lireCacheNumeros(o.cheminCache);
  const numeros = selectionnerNumeros(cache, o.cles, emit, L);
  if (numeros.length === 0) { throw new Error(dire(L, 'aucun.trouve')); }

  // Mots-clés 690 : seulement avec au moins un --numero ; sans numéro local, le CSV n'a pas
  // de colonne 690. L'index du thésaurus (lecture du cache moissonné, coûteuse) se construit
  // une fois pour tout l'export. `opts.motsClesConnus` permet aux tests d'injecter le
  // thésaurus au lieu de lire C:\ProgramData.
  const racinesLocales = (Array.isArray(o.racinesNumeros) ? o.racinesNumeros : []).filter(Boolean);
  let articlesLocauxParDoi = {};
  let indexThesaurus = null;
  let totalDescripteurs = 0;
  // Dédoublonnée sur la forme pliée (casse, accents, apostrophes : plierDescripteur de
  // lib/mots-cles-edudoc.js), pour qu'un terme répété n'occupe pas les 20 places affichées.
  // La première graphie rencontrée est gardée.
  const motsClesNonReconnus = [];
  const motsClesNonReconnusVus = new Set();
  if (racinesLocales.length > 0) {
    const motsClesConnus = Array.isArray(o.motsClesConnus) ? o.motsClesConnus : motsClesEdudoc.lireCacheMotsCles().motsCles;
    // Sans thésaurus, aucun mot-clé ne serait reconnu : l'export part sans 690, et le dit une fois.
    if (motsClesConnus.length === 0) {
      emit({ t: 'avert', texte: dire(L, 'edudoc.sanscache') });
    } else {
      emit({ t: 'etape', texte: dire(L, 'edudoc.motscles') });
      articlesLocauxParDoi = indexerArticlesLocauxParDoi(racinesLocales, emit, L);
      indexThesaurus = motsClesEdudoc.indexerThesaurus(motsClesConnus);
    }
  }

  // Progression : un pas par numéro lu dans le cache.
  const totalEdudoc = numeros.length;
  const lignes = [];
  for (let i = 0; i < numeros.length; i++) {
    const numero = numeros[i];
    emit({ t: 'etape', texte: dire(L, 'edudoc.numero', [numero.cle, i + 1, totalEdudoc]) });
    for (const art of numero.articles) {
      if (!art.doi) { emit({ t: 'avert', texte: dire(L, 'edudoc.sansdoi', [art.identifiant || '?']) }); continue; }
      const ligne = construireLigneEdudoc(numero, art);
      ligne.descripteurs = [];
      if (indexThesaurus) {
        const local = articlesLocauxParDoi[art.doi];
        if (local) {
          const appariement = motsClesEdudoc.apparierDescripteurs(local.motsClesFr, local.motsClesDe, indexThesaurus);
          ligne.descripteurs = appariement.descripteurs;
          totalDescripteurs += appariement.descripteurs.length;
          for (const terme of appariement.nonReconnus) {
            const cle = motsClesEdudoc.plierDescripteur(terme);
            if (cle === '' || motsClesNonReconnusVus.has(cle)) { continue; }
            motsClesNonReconnusVus.add(cle);
            motsClesNonReconnus.push(terme);
          }
        } else {
          emit({ t: 'avert', texte: dire(L, 'edudoc.sanslocal', [art.doi]) });
        }
      }
      lignes.push(ligne);
    }
    emit({ t: 'progres', fait: i + 1, total: totalEdudoc });
  }
  lignes.sort((a, b) => (String(a.volume) + '-' + String(a.numero)).localeCompare(String(b.volume) + '-' + String(b.numero)) || a.doi.localeCompare(b.doi));

  const maxAuteurs = lignes.reduce((m, l) => Math.max(m, l.auteursInverses.length), 1);
  const enTetesAuteurs = [];
  for (let i = 1; i <= maxAuteurs; i++) { enTetesAuteurs.push('7001_a-' + i); }
  for (const l of lignes) { while (l.auteursInverses.length < maxAuteurs) { l.auteursInverses.push(''); } }

  // 690__a-N / 690__b-N (allemand / français), comme pour les auteur·e·s : le nombre de
  // colonnes est le maximum de l'export, calculé ici car le gabarit ne sait pas compter.
  // Groupe placé à la fin, après les colonnes d'auteur·e·s.
  const maxDescripteurs = lignes.reduce((m, l) => Math.max(m, l.descripteurs.length), 0);
  const enTetesDescripteurs = [];
  for (let i = 1; i <= maxDescripteurs; i++) { enTetesDescripteurs.push('690__a-' + i); enTetesDescripteurs.push('690__b-' + i); }
  for (const l of lignes) { while (l.descripteurs.length < maxDescripteurs) { l.descripteurs.push({ de: '', fr: '' }); } }

  fs.mkdirSync(o.dossierSortie, { recursive: true });
  const gabarit = chargerGabarit(dossierGabarits, 'edudoc.twig', L);
  const blocs = gabarit.rendre({
    articles: lignes, enTetesAuteurs: enTetesAuteurs, enTetesDescripteurs: enTetesDescripteurs,
    dateExport: formaterDateIso(new Date())
  });
  const chemin = path.join(o.dossierSortie, 'edudoc.csv');
  fs.writeFileSync(chemin, versCsvFinal(blocs.contenu || ''));
  emit({ t: 'fichier', chemin: chemin, nom: 'edudoc.csv' });

  // Bilan des mots-clés : seuls les descripteurs du thésaurus sont exportés ; le bilan
  // montre ceux qui restent hors du CSV.
  if (indexThesaurus) {
    emit({ t: 'etape', texte: compter(L, 'edudoc.descripteurs', totalDescripteurs) });
    if (motsClesNonReconnus.length > 0) {
      const AFFICHES_MAX = 20;
      let liste = motsClesNonReconnus.slice(0, AFFICHES_MAX).join(', ');
      if (motsClesNonReconnus.length > AFFICHES_MAX) {
        liste = compter(L, 'edudoc.inconnus.reste', motsClesNonReconnus.length - AFFICHES_MAX, [liste]);
      }
      emit({ t: 'avert', texte: compter(L, 'edudoc.inconnus', motsClesNonReconnus.length, [liste]) });
    }
  }

  return { ok: true, texte: compter(L, 'edudoc.fin', lignes.length) };
}

// ---- caractères : télécharge la galley HTML, compte le texte visible ------------------

function compterCaracteresHtml(html) {
  let s = String(html || '');
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/gi, ' ');
  s = oaiPmh.decoderTexteXml(s);
  s = s.replace(/\s+/g, ' ').trim();
  return s.length;
}

async function commandeCaracteres(opts) {
  const o = opts || {};
  const emit = typeof o.emettre === 'function' ? o.emettre : () => {};
  const L = langueDe(o);
  if (!o.cheminCache) { throw new Error(dire(L, 'option.requise', ['--cache'])); }
  if (!Array.isArray(o.cles) || o.cles.length === 0) { throw new Error(dire(L, 'option.requise', ['--numeros'])); }
  if (!o.dossierSortie) { throw new Error(dire(L, 'option.requise', ['--sortie'])); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();
  const recuperer = o.recuperer || oaiPmh.recupererAvecRepli;

  const cache = lireCacheNumeros(o.cheminCache);
  const numeros = selectionnerNumeros(cache, o.cles, emit, L);
  if (numeros.length === 0) { throw new Error(dire(L, 'aucun.trouve')); }

  // Total de progression, tous numéros confondus : les articles qui ont une galley HTML.
  const totalCaracteres = numeros.reduce((n, numero) => n + numero.articles.filter((a) => a.galleys.html).length, 0);
  let faitCaracteres = 0;

  const lignes = [];
  for (const numero of numeros) {
    for (const art of numero.articles) {
      const titre = art.titres[art.locale] || Object.values(art.titres)[0] || art.identifiant;
      if (!art.galleys.html) { emit({ t: 'avert', texte: dire(L, 'caracteres.sanshtml', [titre]) }); continue; }
      emit({ t: 'etape', texte: dire(L, 'caracteres.lecture', [titre]) });
      let caracteres;
      try {
        const html = await recuperer(art.galleys.html);
        caracteres = compterCaracteresHtml(html);
      } catch (e) {
        emit({ t: 'avert', texte: dire(L, 'caracteres.echec', [titre, String((e && e.message) || e)]) });
        faitCaracteres++;
        emit({ t: 'progres', fait: faitCaracteres, total: totalCaracteres });
        continue;
      }
      lignes.push({
        identifiant: art.identifiant, titre: titre, auteurs: art.auteursBruts.join(' ; '),
        caracteres: String(caracteres), doi: art.doi, volume: numero.volume, numero: numero.numero,
        titreNumero: numero.titre, annee: numero.annee,
        motsCles: (art.sujets[art.locale] || Object.values(art.sujets)[0] || []).join(', ')
      });
      faitCaracteres++;
      emit({ t: 'progres', fait: faitCaracteres, total: totalCaracteres });
    }
  }

  fs.mkdirSync(o.dossierSortie, { recursive: true });
  const gabarit = chargerGabarit(dossierGabarits, 'caracteres.twig', L);
  const blocs = gabarit.rendre({ articles: lignes });
  const chemin = path.join(o.dossierSortie, 'caracteres.csv');
  fs.writeFileSync(chemin, versCsvFinal(blocs.contenu || ''));
  emit({ t: 'fichier', chemin: chemin, nom: 'caracteres.csv' });

  return { ok: true, texte: compter(L, 'caracteres.fin', lignes.length) };
}

// ---- métadonnées : comparaison locale <-> OJS ------------------------------------------

// Comparaison de deux listes de mots-clés, insensible à l'ordre et à la casse.
function comparerListes(localListe, oaiListe) {
  const a = new Set((localListe || []).map((x) => txt(x).toLowerCase()));
  const b = new Set((oaiListe || []).map((x) => txt(x).toLowerCase()));
  const manqueLocal = Array.from(b).filter((x) => !a.has(x));
  const manqueOai = Array.from(a).filter((x) => !b.has(x));
  return { concorde: manqueLocal.length === 0 && manqueOai.length === 0, manqueLocal: manqueLocal, manqueOai: manqueOai };
}

// Auteurs : « Nom, Prénom » en minuscules, comparés dans l'ordre, qui est éditorial.
function comparerAuteurs(localAuteurs, oaiAuteurs) {
  const cle = (a) => (txt(a && a.nom) + ', ' + txt(a && a.prenom)).toLowerCase();
  const nomsLocal = (localAuteurs || []).map(cle);
  const nomsOai = (oaiAuteurs || []).map(cle);
  const memeEnsemble = JSON.stringify(nomsLocal.slice().sort()) === JSON.stringify(nomsOai.slice().sort());
  const memeOrdre = JSON.stringify(nomsLocal) === JSON.stringify(nomsOai);
  return { memeEnsemble: memeEnsemble, memeOrdre: memeOrdre, local: nomsLocal, oai: nomsOai };
}

// oai_dc ne porte pas l'affiliation des auteur·e·s : elle n'est pas comparée, et le
// rapport le dit.
const NOTE_AFFILIATION_NON_VERIFIABLE = "affiliations : non vérifiable — l'OAI oai_dc ne porte pas l'affiliation des auteur·e·s (seul marcxml le ferait)";

function comparerArticle(artLocal, articlesOaiParDoi) {
  if (!artLocal.doi) {
    return { slug: artLocal.slug, doi: '', statut: 'localSansDoi', divergences: [], concordances: [] };
  }
  const oai = articlesOaiParDoi[artLocal.doi];
  if (!oai) {
    return { slug: artLocal.slug, doi: artLocal.doi, statut: 'absentOai', divergences: [], concordances: [] };
  }
  const divergences = [];
  const concordances = [];
  const cmp = (nom, vl, vo) => {
    if (txt(vl) === txt(vo)) { concordances.push(nom); } else { divergences.push({ champ: nom, local: txt(vl), oai: txt(vo) }); }
  };
  cmp('titre fr', artLocal.titreFr, oai.titres.fr || '');
  cmp('titre de', artLocal.titreDe, oai.titres.de || '');
  cmp('résumé fr', artLocal.resumeFr, oai.descriptions.fr || '');
  cmp('résumé de', artLocal.resumeDe, oai.descriptions.de || '');
  const mcFr = comparerListes(artLocal.motsClesFr, oai.sujets.fr || []);
  if (mcFr.concorde) { concordances.push('mots-clés fr'); }
  else { divergences.push({ champ: 'mots-clés fr', local: artLocal.motsClesFr.join(', '), oai: (oai.sujets.fr || []).join(', ') }); }
  const mcDe = comparerListes(artLocal.motsClesDe, oai.sujets.de || []);
  if (mcDe.concorde) { concordances.push('mots-clés de'); }
  else { divergences.push({ champ: 'mots-clés de', local: artLocal.motsClesDe.join(', '), oai: (oai.sujets.de || []).join(', ') }); }
  const auteursCmp = comparerAuteurs(artLocal.auteurs, oai.auteurs);
  if (auteursCmp.memeOrdre) { concordances.push('auteurs (liste et ordre)'); }
  else if (auteursCmp.memeEnsemble) { divergences.push({ champ: 'auteurs (ordre)', local: auteursCmp.local.join(' / '), oai: auteursCmp.oai.join(' / ') }); }
  else { divergences.push({ champ: 'auteurs (liste)', local: auteursCmp.local.join(' / '), oai: auteursCmp.oai.join(' / ') }); }
  return {
    slug: artLocal.slug, doi: artLocal.doi, statut: divergences.length > 0 ? 'divergent' : 'concorde',
    divergences: divergences, concordances: concordances, noteAffiliation: NOTE_AFFILIATION_NON_VERIFIABLE
  };
}

function comparerNumero(local, oaiNumero) {
  const parDoiOai = {};
  for (const a of (oaiNumero ? oaiNumero.articles : [])) { if (a.doi) { parDoiOai[a.doi] = a; } }
  const doisLocalVus = new Set();
  const articles = local.articles.map((artLocal) => {
    if (artLocal.doi) { doisLocalVus.add(artLocal.doi); }
    return comparerArticle(artLocal, parDoiOai);
  });
  const oaiSansLocal = [];
  for (const a of (oaiNumero ? oaiNumero.articles : [])) {
    if (a.doi && !doisLocalVus.has(a.doi)) {
      oaiSansLocal.push({ doi: a.doi, titre: a.titres[a.locale] || Object.values(a.titres)[0] || a.identifiant });
    }
  }
  return { cle: local.numero.cle, titreLocal: local.numero.libelle, trouveDansOai: !!oaiNumero, articles: articles, oaiSansLocal: oaiSansLocal };
}

async function commandeMetadonnees(opts) {
  const o = opts || {};
  const emit = typeof o.emettre === 'function' ? o.emettre : () => {};
  const L = langueDe(o);
  const racines = (Array.isArray(o.racinesNumeros) ? o.racinesNumeros : [o.racinesNumeros]).filter(Boolean);
  if (racines.length === 0) { throw new Error(dire(L, 'option.requise', ['--numero'])); }
  if (!o.cheminCache) { throw new Error(dire(L, 'option.requise', ['--cache'])); }
  if (!o.dossierSortie) { throw new Error(dire(L, 'option.requise', ['--sortie'])); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();

  const cache = lireCacheNumeros(o.cheminCache);
  const totalMetadonnees = racines.length;
  const rapports = [];
  for (let i = 0; i < racines.length; i++) {
    const racine = racines[i];
    emit({ t: 'etape', texte: totalMetadonnees === 1 ? dire(L, 'numero.lecture', [nomDossierNumero(racine)])
      : dire(L, 'numero.lecture.rang', [nomDossierNumero(racine), i + 1, totalMetadonnees]) });
    const local = collecterNumeroLocal(racine, emit, L);
    emit({ t: 'etape', texte: dire(L, 'metadonnees.comparaison', [nomRevue(local.numero.revue)]) });
    const liste = cache.numeros[local.numero.cle] || [];
    const oaiNumero = liste.find((n) => n.revue === local.numero.revue) || liste[0] || null;
    if (!oaiNumero) { emit({ t: 'avert', texte: dire(L, 'metadonnees.absent', [local.numero.cle]) }); }
    rapports.push(comparerNumero(local, oaiNumero));
    emit({ t: 'progres', fait: i + 1, total: totalMetadonnees });
  }

  fs.mkdirSync(o.dossierSortie, { recursive: true });
  const gabarit = chargerGabarit(dossierGabarits, 'metadonnees.twig', L);
  const blocs = gabarit.rendre({ rapports: rapports, dateComparaison: formaterDateIso(new Date()) });
  const chemin = path.join(o.dossierSortie, 'metadonnees.txt');
  fs.writeFileSync(chemin, blocs.contenu || '', 'utf8');
  emit({ t: 'fichier', chemin: chemin, nom: 'metadonnees.txt' });

  // Le bilan ne compte que les numéros trouvés en ligne ; les autres ont leur avertissement.
  const compares = rapports.filter((r) => r.trouveDansOai);
  if (!compares.length) { return { ok: true, texte: '' }; }
  const aRevoir = compares.reduce((n, r) => n + r.articles.filter((a) => a.statut === 'divergent' || a.statut === 'absentOai').length
    + r.oaiSansLocal.length, 0);
  return { ok: true, texte: compter(L, 'metadonnees.fin', aRevoir) };
}

module.exports = {
  // langue des textes
  langueDe, dire, compter,
  // dossier des gabarits
  dossierGabaritsSource, NOMS_GABARITS_DEFAUT, chargerGabarit,
  versCsvFinal,
  // aides pures, éprouvables isolément
  formerSignature, combinerTitre, auteurComplet, listerSlugsLocaux, deuxChiffres,
  analyserSourceOjs, decoderRecordOai, extraireBlocsRecord, extraireBalisesRepetees,
  grouperNumeros, compterCaracteresHtml, comparerListes, comparerAuteurs,
  // lecture locale
  collecterNumeroLocal, construireAuteursNewsletter, SECTIONS_NEWSLETTER,
  // cache des numéros OAI
  lireCacheNumeros, ecrireCacheNumeros, selectionnerNumeros, REVUES_EDUDOC, BASES_OAI,
  // les quatre commandes
  commandeNumerosOjs, commandeNewsletter, commandeEdudoc, commandeCaracteres, commandeMetadonnees
};
