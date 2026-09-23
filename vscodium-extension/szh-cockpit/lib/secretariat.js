// Les quatre exports du secrétariat : newsletter (local), edudoc et caractères (OAI-PMH),
// métadonnées (comparaison local/OJS). Module pur, sans `require('vscode')` — appelé par
// outils/secretariat-cli.js, la seule porte d'entrée en ligne de commande.
//
// Tout ce qui touche l'OAI-PMH (client https, parseur XML générique, garde
// SZH_RESEAU_INTERDIT) vient de lib/oai-pmh.js ; ce fichier n'ajoute que ce qui est propre
// à l'export du secrétariat — les enregistrements oai_dc complets (titre, résumé,
// mots-clés, source, galleys), que lib/auteurs-ojs.js n'extrait pas (il ne lit que les
// noms d'auteur·e·s, en marcxml). lib/export-ojs.js fournit le calcul du DOI et la table
// des rubriques ; lib/articles.js l'ordre des articles et le rang du DOI ; lib/yaml.js la
// lecture des fiches. Rien de tout cela n'est réécrit ici.
//
// Chaque export passe par un gabarit Twig (lib/gabarits.js), lu directement dans
// export-templates/ de l'extension — jamais copié sur le poste. Un gabarit se modifie dans
// le dépôt, part dans le VSIX, arrive par la mise à jour normale ; une copie locale figerait
// une version périmée qu'aucune mise à jour ne rattraperait.
'use strict';

const fs = require('fs');
const path = require('path');

const gabaritsMoteur = require('./gabarits');
const oaiPmh = require('./oai-pmh');
const auteursOjs = require('./auteurs-ojs');   // normaliserCreator : « Nom, Prénom » -> {nom, prenom}
const yaml = require('./yaml');
const articlesLib = require('./articles');     // ordre, rang du DOI, sans-DOI
const exportOjs = require('./export-ojs');     // doiCalcule, typeSansDoi, RUBRIQUES_DEFAUT, configOjs
// lireCacheMotsCles, indexerThesaurus, apparierDescripteurs : thésaurus edudoc (mots-clés
// MARC 690) pour la commande « edudoc » — voir la section dédiée plus bas.
const motsClesEdudoc = require('./mots-cles-edudoc');

// ---- Petites aides communes ----------------------------------------------------------

function txt(v) { return String(v === undefined || v === null ? '' : v).trim(); }

// Deux chiffres, comme les DOI et les clés de numéro les portent partout ailleurs dans le
// cockpit (doiCalcule, lib/export-ojs.js). Recopié plutôt qu'importé : la fonction de
// lib/export-ojs.js n'est pas exportée, et ce module n'a pas le droit d'y toucher.
function deuxChiffres(valeur) {
  const chiffres = String(valeur === undefined || valeur === null ? '' : valeur).replace(/\D+/g, '');
  if (chiffres === '') { return ''; }
  return chiffres.length === 1 ? '0' + chiffres : chiffres;
}

function formaterDateIso(d) {
  const p2 = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
}

// « Prénom Nom, Prénom Nom et Prénom Nom » (fr) / « … und … » (de) — signature d'un
// article, dans les deux styles utilisés par la maison (newsletter et Edudoc emploient la
// même forme). `auteurs` : tableau d'objets portant au moins prenom/nom.
function formerSignature(auteurs, locale) {
  const noms = (Array.isArray(auteurs) ? auteurs : [])
    .map((a) => (txt(a && a.prenom) + ' ' + txt(a && a.nom)).trim())
    .filter((s) => s !== '');
  if (noms.length === 0) { return ''; }
  if (noms.length === 1) { return noms[0]; }
  const jonction = locale === 'de' ? ' und ' : ' et ';
  return noms.slice(0, -1).join(', ') + jonction + noms[noms.length - 1];
}

// Titre affiché : le titre de la langue demandée, suivi du sous-titre s'il existe,
// séparés par « . » — règle posée pour la newsletter, réutilisée partout où un titre
// complet est affiché en une ligne.
function combinerTitre(titreParLangue, sousTitreParLangue, langue) {
  const t = txt((titreParLangue || {})[langue]);
  if (t === '') { return ''; }
  const s = txt((sousTitreParLangue || {})[langue]);
  return s !== '' ? t + '. ' + s : t;
}

// Un auteur de fiche (7 champs, lib/yaml.js CHAMPS_AUTEUR) enrichi des deux formes
// assemblées dont les gabarits ont besoin.
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

// Les articles que le disque porte : un dossier articles/<slug>/ contenant <slug>.md, ou —
// depuis que la Documentation est une arborescence Kirby, sans .md — dont la fiche porte
// `type: documentation`. Recopie de la fonction privée (non exportée) listerSlugs de
// lib/export-ojs.js — ce module n'a pas le droit de modifier ce fichier pour l'exporter ;
// les deux copies doivent donc rester identiques.
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

// LA source des gabarits — livrés avec l'extension, jamais recopiés ailleurs. `--gabarits`
// (secretariat-cli.js) peut la remplacer, pour la mise au point ou les tests ; en usage
// normal c'est toujours ce dossier qui est lu.
function dossierGabaritsSource() { return path.join(__dirname, '..', 'export-templates'); }

// Les neuf gabarits attendus dans dossierGabaritsSource() — utile aux tests, qui vérifient
// qu'aucun ne manque, sans les nommer une seconde fois en dur.
const NOMS_GABARITS_DEFAUT = [
  'newsletter-editorial.twig', 'newsletter-dossier-thematique.twig', 'newsletter-varia.twig',
  'newsletter-tribune-libre.twig', 'newsletter-documentation.twig', 'newsletter-auteurs.twig',
  'edudoc.twig', 'caracteres.twig', 'metadonnees.twig'
];

function chargerGabarit(dossier, nomFichier) {
  const chemin = path.join(dossier, nomFichier);
  let source;
  try { source = fs.readFileSync(chemin, 'utf8'); }
  catch (e) { throw new Error('gabarit introuvable : ' + chemin); }
  return gabaritsMoteur.compiler(source, nomFichier);
}

// Un CSV suisse : BOM UTF-8 en tête, fins de ligne CRLF. Le gabarit, lui, écrit son texte
// en \n comme n'importe quel fichier — c'est ce point de passage unique qui le rend
// ouvrable proprement dans l'Excel d'un poste Windows.
function versCsvFinal(texte) {
  return '\uFEFF' + String(texte || '').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

// ---- Lecture d'un numéro local (ausgabe.yaml + fiches) --------------------------------
//
// Même règle de rang/DOI que lib/export-ojs.js (collecter()), rejouée ici avec les mêmes
// briques (doiCalcule, typeSansDoi, ordonnerArticles, rangDoi) : un DOI annoncé par la
// newsletter doit être celui que l'export OJS déposera pour de bon.

function collecterNumeroLocal(racine, emettre) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  let brut;
  try { brut = fs.readFileSync(path.join(racine, 'ausgabe.yaml'), 'utf8'); }
  catch (e) { throw new Error('ausgabe.yaml introuvable ou illisible : ' + racine); }
  const valeurs = yaml.analyserAusgabe(brut);

  const locale = yaml.langueDefaut(valeurs);
  const autreLocale = locale === 'de' ? 'fr' : 'de';
  // L'année du numéro : celle de `date:` si elle y est, sinon celle du nom du dossier
  // (« 2027-03 » -> « 2027 »). `date:` est la date de PUBLICATION, vide jusqu'à la
  // parution — et une newsletter se prépare justement avant, donc `date:` y est presque
  // toujours vide. Sans ce repli, l'année manque, le DOI ne se calcule plus (doiCalcule
  // rend '' sans année) et l'article sort sans lien. Même règle, pour les mêmes raisons,
  // dans lib/metadonnees-hote.js (anneeNumero) et lib/yaml.js (titreNumero) — toute future
  // correction de cette règle doit toucher les trois endroits à la fois.
  let annee = (String(valeurs.date || '').match(/\d{4}/) || [''])[0];
  if (annee === '') {
    annee = (String(path.basename(racine)).match(/^(\d{4})-\d/) || ['', ''])[1];
  }
  const numeroTxt = txt(valeurs.numero);
  const volume = txt(valeurs.volume);
  const titreNumero = txt(valeurs.title);
  const revueCle = yaml.normaliserRevue(valeurs.revue) || (locale === 'de' ? 'zeitschrift' : 'revue');

  const cfg = exportOjs.configOjs();
  const parCle = {};
  for (const r of cfg.rubriques) { parCle[r.cle] = r; }

  const slugsDisque = listerSlugsLocaux(racine);
  const fiches = {};
  for (const slug of slugsDisque) {
    try { fiches[slug] = yaml.analyserMeta(fs.readFileSync(path.join(racine, 'articles', slug, slug + '.meta.yaml'), 'utf8')); }
    catch (e) { fiches[slug] = null; emit({ t: 'avert', texte: 'articles/' + slug + ' : fiche illisible, article ignoré' }); }
  }
  const slugsAvecFiche = slugsDisque.filter((s) => fiches[s]);

  const sansDoiVoulu = new Set(articlesLib.analyserSansDoi(valeurs[articlesLib.CLE_SANS_DOI]));
  const sansDoi = new Set(sansDoiVoulu);
  for (const slug of slugsAvecFiche) {
    if (sansDoi.has(slug)) { continue; }
    if (exportOjs.typeSansDoi(cfg, fiches[slug].type)) { sansDoi.add(slug); }
  }
  const slugs = articlesLib.ordonnerArticles(valeurs[articlesLib.CLE_ORDRE], slugsAvecFiche, sansDoi).slugs;

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
  }
  return {
    numero: {
      cle: annee + '-' + deuxChiffres(numeroTxt), revue: revueCle, locale: locale,
      annee: annee, numero: numeroTxt, volume: volume, titre: titreNumero,
      // Le libellé affiché (rapports, messages) : « R2027-03 | Titre » — même fonction que
      // le cockpit lui-même (lib/yaml.js), avec le même repli d'année ; pas de chaîne
      // reconstruite à la main ici.
      libelle: yaml.titreNumero(racine)
    },
    articles: articles
  };
}

// ---- newsletter : cinq .txt (un par rubrique) + auteurs.csv ---------------------------

const SECTIONS_NEWSLETTER = [
  { cle: 'ED', fichier: 'editorial.txt', gabarit: 'newsletter-editorial.twig' },
  { cle: 'DT', fichier: 'dossier-thematique.txt', gabarit: 'newsletter-dossier-thematique.twig' },
  { cle: 'VA', fichier: 'varia.txt', gabarit: 'newsletter-varia.twig' },
  { cle: 'TL', fichier: 'tribune-libre.txt', gabarit: 'newsletter-tribune-libre.twig' },
  { cle: 'DC', fichier: 'documentation.txt', gabarit: 'newsletter-documentation.twig' }
];

// Une ligne par auteur·e du numéro, triée par ordre des articles puis alphabétique du nom
// dans l'article — l'ordre que Mailchimp doit suivre pour recouper avec les signatures.
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
  if (!o.racineNumero) { throw new Error('--numero est requis'); }
  if (!o.dossierSortie) { throw new Error('--sortie est requis'); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();

  emit({ t: 'etape', texte: 'lecture du numéro local...' });
  const { numero, articles } = collecterNumeroLocal(o.racineNumero, emit);
  fs.mkdirSync(o.dossierSortie, { recursive: true });

  // Total connu d'avance : les cinq rubriques, plus auteurs.csv — qu'un fichier soit
  // produit ou sauté (rubrique vide), c'est un pas de progression franchi.
  const totalNewsletter = SECTIONS_NEWSLETTER.length + 1;
  let faitNewsletter = 0;

  const fichiers = [];
  for (const section of SECTIONS_NEWSLETTER) {
    const articlesSection = articles.filter((a) => a.rubriqueCle === section.cle);
    if (articlesSection.length === 0) {
      emit({ t: 'etape', texte: section.fichier + ' : aucun article dans cette rubrique, fichier non produit' });
      faitNewsletter++;
      emit({ t: 'progres', fait: faitNewsletter, total: totalNewsletter });
      continue;
    }
    for (const a of articlesSection) {
      if (!a.doi) { emit({ t: 'avert', texte: a.slug + ' : pas de DOI, le titre sort sans lien' }); }
    }
    const premier = articlesSection[0];
    const sectionCtx = {
      cle: section.cle,
      titre: numero.locale === 'de' ? premier.rubriqueTitreDe : premier.rubriqueTitreFr
    };
    const gabarit = chargerGabarit(dossierGabarits, section.gabarit);
    const blocs = gabarit.rendre({ numero: numero, section: sectionCtx, articles: articlesSection });
    const chemin = path.join(o.dossierSortie, section.fichier);
    fs.writeFileSync(chemin, blocs.contenu || '', 'utf8');
    fichiers.push(chemin);
    emit({ t: 'fichier', chemin: chemin, nom: section.fichier });
    faitNewsletter++;
    emit({ t: 'progres', fait: faitNewsletter, total: totalNewsletter });
  }

  const auteursLignes = construireAuteursNewsletter(articles);
  const gabaritAuteurs = chargerGabarit(dossierGabarits, 'newsletter-auteurs.twig');
  const blocsAuteurs = gabaritAuteurs.rendre({ auteurs: auteursLignes, numero: numero });
  const cheminAuteurs = path.join(o.dossierSortie, 'auteurs.csv');
  fs.writeFileSync(cheminAuteurs, versCsvFinal(blocsAuteurs.contenu || ''));
  fichiers.push(cheminAuteurs);
  emit({ t: 'fichier', chemin: cheminAuteurs, nom: 'auteurs.csv' });
  faitNewsletter++;
  emit({ t: 'progres', fait: faitNewsletter, total: totalNewsletter });

  return { ok: true, texte: fichiers.length + ' fichier(s) produit(s) pour ' + numero.libelle + '.' };
}

// ---- Moisson OAI-PMH (oai_dc), spécifique au secrétariat ------------------------------
//
// lib/auteurs-ojs.js moissonne aussi l'OAI, mais en marcxml et pour les seuls noms
// d'auteur·e·s (extraireRecords/extraireRecordsMarc). Le secrétariat a besoin de
// l'enregistrement oai_dc complet — titre, résumé, mots-clés, source, galleys — qu'aucune
// des deux fonctions de lib/auteurs-ojs.js ne rend : sa boucle de pagination est donc
// réécrite ici, avec les mêmes briques génériques que moissonner() (erreurOai,
// extraireResumptionToken, recupererAvecRepli, garde anti-boucle sur le resumptionToken).

const BASES_OAI = {
  revue: 'https://ojs.szh.ch/index.php/revue/oai',
  zeitschrift: 'https://ojs.szh.ch/index.php/zeitschrift/oai'
};
// ~350 notices par revue sur l'instance (voir lib/auteurs-ojs.js) ; large marge.
const PAGES_MAX_OAI_DC = 200;

// Les balises répétées d'un fragment XML, dans l'ordre du document, avec leur xml:lang le
// cas échéant — dc:title, dc:subject, dc:description, dc:creator, dc:identifier,
// dc:source, dc:relation, dc:format s'extraient tous de la même façon.
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

// dc:source, tolérant : « …; Bd. 16 Nr. 03 (2023): Titre ; 27-32 » (de) ou
// « …; Vol. 16 No 03 (2023): Titre; 27-32 » (fr). L'année et les pages manquent parfois
// (numéros récents) : rien n'est supposé, tout ce qui ne matche pas reste vide.
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

// Un enregistrement OAI (oai_dc) décodé en article riche. `revueCle` ('revue'|'zeitschrift')
// vient de l'endpoint interrogé : les deux revues partagent le même serveur, seule l'URL
// distingue le jeu de résultats.
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

  // Galleys : dc:relation et dc:format répétés dans le même ordre (voir l'en-tête du
  // fichier). Un mime-type absent ou inattendu n'écrase jamais un format déjà trouvé.
  const galleys = { pdf: '', html: '', docx: '' };
  relations.forEach((url, i) => {
    const fmt = String(formats[i] || '').toLowerCase();
    if (fmt.indexOf('pdf') !== -1) { galleys.pdf = galleys.pdf || url; }
    else if (fmt.indexOf('html') !== -1) { galleys.html = galleys.html || url; }
    else if (fmt.indexOf('wordprocessingml') !== -1) { galleys.docx = galleys.docx || url; }
  });

  const auteurs = creatorsBruts.map((c) => auteursOjs.normaliserCreator(c)).filter((a) => a);

  // Le DOI de la maison porte tout : lettre de revue, année, numéro, rang — c'est la
  // source de vérité pour grouper les articles en numéros (voir l'en-tête « Les données »
  // du mandat). dc:source ne sert plus alors qu'au volume et aux pages.
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

// Pagination OAI-PMH pour un `verb=ListRecords&metadataPrefix=oai_dc` — même garde
// anti-boucle (jeton déjà vu, plafond de pages) que moissonner() de lib/auteurs-ojs.js.
//
// `depuisAnnee` (AAAA ou null) : ojs.szh.ch honore `&from=AAAA-MM-JJ` sur ListRecords
// (vérifié en direct le 15.09.2026 ; granularité annoncée YYYY-MM-DDThh:mm:ssZ,
// earliestDatestamp 2022-12-22). Il n'est posé que sur cette PREMIÈRE requête : la norme
// OAI-PMH veut qu'une page suivante ne porte QUE le resumptionToken (il encode déjà toute
// la requête d'origine côté serveur) — le lui répéter fait rejeter la requête.
async function moissonnerOaiDc(recuperer, base, emettre, depuisAnnee) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const blocs = [];
  let url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'verb=ListRecords&metadataPrefix=oai_dc' +
    (depuisAnnee ? '&from=' + depuisAnnee + '-01-01' : '');
  const tokensVus = new Set();
  for (let page = 0; page < PAGES_MAX_OAI_DC; page++) {
    // L'étape AVANT la requête : c'est pendant les ~4,6 s d'attente réseau, pas après, que
    // l'utilisateur a besoin de voir que ça vit (mesuré en vrai le 15.09.2026).
    emit({ t: 'etape', texte: 'page ' + (page + 1) + ' : interrogation de l’OAI-PMH...' });
    const xml = await recuperer(url);
    const erreur = oaiPmh.erreurOai(xml);
    if (erreur) {
      if (erreur.code === 'noRecordsMatch') { return blocs; }
      throw new Error('OAI ' + erreur.code + (erreur.message ? ' : ' + erreur.message : '') + ' sur ' + base);
    }
    for (const bloc of extraireBlocsRecord(xml)) { blocs.push(bloc); }
    emit({ t: 'etape', texte: blocs.length + ' notice(s) OAI récupérée(s)...' });
    // total: 0 = inconnu — ojs.szh.ch n'envoie pas completeListSize sur resumptionToken
    // (constaté le 15.09.2026, seul expirationDate y figure) : rien à rapporter `fait` à.
    emit({ t: 'progres', fait: page + 1, total: 0 });
    const token = oaiPmh.extraireResumptionToken(xml);
    if (token === '') { return blocs; }
    if (tokensVus.has(token)) { throw new Error('resumptionToken répété sur ' + base); }
    tokensVus.add(token);
    url = base + (base.indexOf('?') === -1 ? '?' : '&') + 'verb=ListRecords&resumptionToken=' + encodeURIComponent(token);
  }
  throw new Error('pagination OAI interrompue après ' + PAGES_MAX_OAI_DC + ' pages sur ' + base);
}

// Regroupe des articles décodés en numéros, par clé "<année>-<numéro>" — d'abord par DOI,
// à défaut par dc:source (voir decoderRecordOai). Un article sans l'un ni l'autre est
// signalé et écarté : il n'y a rien à en faire de fiable.
function grouperNumeros(articles, emettre) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const table = {};
  for (const art of articles) {
    if (!art.cleNumero) {
      emit({ t: 'avert', texte: (art.identifiant || '?') + ' : numéro introuvable (ni DOI ni dc:source exploitables), article ignoré' });
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
// Un fichier séparé par exécution, choisi par l'appelant (--cache) : plusieurs revues
// peuvent y coexister, chacune sous ses propres clés — une même clé "<année>-<numéro>"
// existe potentiellement dans les deux revues (numéros parallèles fr/de), avec des
// articles différents : la clé porte donc une LISTE de numéros, pas un numéro seul.

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
  const revue = String(o.revue || '').toLowerCase();
  if (!BASES_OAI[revue]) { throw new Error("--revue doit valoir 'revue' ou 'zeitschrift' (reçu : " + (o.revue || '') + ')'); }
  if (!o.cheminCache) { throw new Error('--cache est requis'); }
  const recuperer = o.recuperer || oaiPmh.recupererAvecRepli;

  // null = moisson complète, comportement inchangé (voir moissonnerOaiDc). Sinon l'année
  // demandée, telle quelle : elle part dans l'URL (&from=<anneePlancher>-01-01) ET sert au
  // filtre ci-dessous à écarter ce qu'elle a ramené de trop ancien.
  const anneePlancher = o.depuisAnnee ? String(o.depuisAnnee) : null;
  if (anneePlancher !== null && !/^\d{4}$/.test(anneePlancher)) {
    throw new Error('--depuis-annee attend une année à quatre chiffres (reçu : ' + anneePlancher + ')');
  }

  emit({ t: 'etape', texte: 'connexion à l’OAI-PMH de ' + revue + (anneePlancher ? ', à partir de ' + anneePlancher : '') + '...' });
  const blocs = await moissonnerOaiDc(recuperer, BASES_OAI[revue], emit, anneePlancher);
  const articles = blocs.map((c) => decoderRecordOai(c, revue)).filter((a) => a && !a.supprime);
  const numerosMap = grouperNumeros(articles, emit);

  // `from` filtre le DATESTAMP (dernière modification), pas la date de parution : un numéro
  // plus ancien que anneePlancher peut donc quand même traverser le filtre si un seul de ses
  // articles a été retouché après le <anneePlancher>-01-01 demandé — incomplet par
  // construction, ses autres articles (non modifiés depuis) restant hors de la fenêtre.
  // Constaté en vrai le 15.09.2026 : from=2026-01-01 sur la revue ramène r2025-04 avec
  // 1 article sur 9 (un article de 2025 retouché en 2026). Coché tel quel par l'utilisateur,
  // ce numéro produirait un export amputé sans rien dire : on l'écarte donc entièrement
  // plutôt que de le laisser paraître complet.
  if (anneePlancher) {
    for (const cle of Object.keys(numerosMap)) {
      if (parseInt(numerosMap[cle].annee, 10) < parseInt(anneePlancher, 10)) {
        emit({ t: 'avert', texte: cle + ' : numéro plus ancien que ' + anneePlancher
          + ', remonté en partie seulement ; chargez aussi ' + numerosMap[cle].annee + ' pour l’avoir en entier.' });
        delete numerosMap[cle];
      }
    }
  }

  const cache = lireCacheNumeros(o.cheminCache);
  // Ne remplace que les numéros de LA revue moissonnée ; l'autre revue, déjà en cache,
  // reste intacte — numeros-ojs est appelé une fois par revue. Pas de fusion incrémentale
  // non plus entre deux moissons de la même revue, même avec --depuis-annee : remonter d'une
  // année se fait en relançant avec --depuis-annee diminué de 1, qui ramène de lui-même un
  // SUR-ensemble complet (from=2026-01-01 ne perd aucun article des numéros 2026, vérifié en
  // vrai) — fusionner ferait cohabiter des numéros venus de deux fenêtres différentes.
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
    ok: true, texte: articles.length + ' notice(s), ' + listeTriee.length + ' numéro(s) trouvé(s) pour ' + revue + '.',
    anneePlancher: anneePlancher
  };
}

// ---- edudoc : CSV, entièrement d'après l'OAI ------------------------------------------
//
// Colonnes reprises de tmp/export et secretariat/OJS_Export_Edudoc.py (create_excel,
// populate_excel_list) : voir le gabarit edudoc.twig pour le détail champ par champ.

const REVUES_EDUDOC = {
  revue: { id: '207536', titre: 'Revue suisse de pédagogie spécialisée', langueMarc: 'fre' },
  zeitschrift: { id: '202299', titre: 'Schweizerische Zeitschrift für Heilpädagogik', langueMarc: 'ger' }
};

function selectionnerNumeros(cache, cles, emettre) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const trouves = [];
  for (const cle of cles) {
    const liste = cache.numeros[cle];
    if (!liste || liste.length === 0) { emit({ t: 'avert', texte: 'numéro ' + cle + ' introuvable dans le cache, ignoré' }); continue; }
    for (const n of liste) { trouves.push(n); }
  }
  return trouves;
}

// ---- Mots-clés edudoc (MARC 690) : joints par DOI depuis les numéros locaux -----------
//
// Décision de Robin : la source des mots-clés edudoc est le .meta.yaml de l'article dans le
// numéro local, jamais l'OAI (mesuré : l'OAI ne porte pas un meilleur appariement, et le
// local est la vérité éditoriale, disponible avant publication). On réutilise donc
// collecterNumeroLocal — déjà écrit pour commandeMetadonnees — plutôt que de relire les
// fiches à sa façon, et on joint par DOI, exactement la clé de comparerArticle/comparerNumero.

// Les articles de un ou plusieurs numéros locaux, mis à plat et indexés par DOI. Deux
// racines ne sont pas censées porter le même DOI (double dépôt du même numéro, numéro et
// son archive...) mais si ça arrive c'est une erreur de manipulation, pas un cas normal —
// mieux vaut le dire que l'écraser en silence. Tranché : le DERNIER rencontré gagne (ordre
// des --numero sur la ligne de commande), comportement inchangé, juste rendu visible.
function indexerArticlesLocauxParDoi(racines, emettre) {
  const emit = typeof emettre === 'function' ? emettre : () => {};
  const parDoi = {};
  const racineParDoi = {};
  for (const racine of racines) {
    const { articles } = collecterNumeroLocal(racine, emettre);
    for (const art of articles) {
      if (!art.doi) { continue; }
      if (parDoi[art.doi]) {
        emit({
          t: 'avert',
          texte: art.doi + ' : porté par plusieurs numéros locaux (' + racineParDoi[art.doi] + ' et ' + racine +
            '), le dernier rencontré est retenu pour les mots-clés'
        });
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
  if (!o.cheminCache) { throw new Error('--cache est requis'); }
  if (!Array.isArray(o.cles) || o.cles.length === 0) { throw new Error('--numeros est requis'); }
  if (!o.dossierSortie) { throw new Error('--sortie est requis'); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();

  const cache = lireCacheNumeros(o.cheminCache);
  const numeros = selectionnerNumeros(cache, o.cles, emit);
  if (numeros.length === 0) { throw new Error('aucun numéro à exporter (cache vide ou clés inconnues)'); }

  // Mots-clés 690 : seulement si --numero (racines locales) a été fourni au moins une fois —
  // sans lui, aucun article local à joindre par DOI, le CSV sort exactement comme avant
  // (aucune colonne 690). L'index du thésaurus se construit UNE SEULE FOIS pour tout
  // l'export, jamais par article : c'est lui qui coûte (lecture du cache moissonné), pas
  // l'appariement. `opts.motsClesConnus` permet aux tests d'injecter le thésaurus plutôt
  // que de lire C:\ProgramData, comme `opts.recuperer` l'évite déjà pour le réseau ailleurs
  // dans ce fichier.
  const racinesLocales = (Array.isArray(o.racinesNumeros) ? o.racinesNumeros : []).filter(Boolean);
  let articlesLocauxParDoi = {};
  let indexThesaurus = null;
  let totalDescripteurs = 0;
  // Dédoublonnée sur la forme pliée (casse, accents, apostrophes — plierDescripteur de
  // lib/mots-cles-edudoc.js) : un même terme saisi par plusieurs articles (« différenciation »,
  // « compétences »...) ne doit compter, ni s'afficher, qu'une fois. Sans cela, sur un export
  // de plusieurs numéros, les 20 places affichées se feraient manger par la répétition d'un
  // seul terme — un bilan que Robin ne pourrait plus lire pour savoir quoi demander à edudoc.
  // Première graphie rencontrée gardée, comme partout ailleurs dans ces deux modules.
  const motsClesNonReconnus = [];
  const motsClesNonReconnusVus = new Set();
  if (racinesLocales.length > 0) {
    emit({ t: 'etape', texte: 'lecture des numéros locaux pour les mots-clés edudoc...' });
    articlesLocauxParDoi = indexerArticlesLocauxParDoi(racinesLocales, emit);
    const motsClesConnus = Array.isArray(o.motsClesConnus) ? o.motsClesConnus : motsClesEdudoc.lireCacheMotsCles().motsCles;
    indexThesaurus = motsClesEdudoc.indexerThesaurus(motsClesConnus);
  }

  // Total connu d'avance : un numéro résolu du cache = un pas de progression, qu'il porte
  // beaucoup ou peu d'articles — c'est le numéro qui est l'unité de travail ici.
  const totalEdudoc = numeros.length;
  const lignes = [];
  for (let i = 0; i < numeros.length; i++) {
    const numero = numeros[i];
    emit({ t: 'etape', texte: 'numéro ' + numero.cle + ' (' + (i + 1) + '/' + totalEdudoc + ')...' });
    for (const art of numero.articles) {
      if (!art.doi) { emit({ t: 'avert', texte: (art.identifiant || '?') + ' : sans DOI, ignoré pour Edudoc' }); continue; }
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
          emit({ t: 'avert', texte: art.doi + ' : aucun article local ne porte ce DOI, exporté sans mots-clés' });
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

  // 690__a-N / 690__b-N (allemand / français) : même façon de faire que les auteur·e·s
  // ci-dessus — l'hôte calcule le maximum rencontré sur tout l'export et complète à droite,
  // le gabarit ne fait que dérouler (le moteur de gabarits ne sait pas faire d'arithmétique).
  // Groupe placé à la fin, après les colonnes d'auteur·e·s, comme le veut la convention du
  // fichier pour les groupes de largeur variable.
  const maxDescripteurs = lignes.reduce((m, l) => Math.max(m, l.descripteurs.length), 0);
  const enTetesDescripteurs = [];
  for (let i = 1; i <= maxDescripteurs; i++) { enTetesDescripteurs.push('690__a-' + i); enTetesDescripteurs.push('690__b-' + i); }
  for (const l of lignes) { while (l.descripteurs.length < maxDescripteurs) { l.descripteurs.push({ de: '', fr: '' }); } }

  fs.mkdirSync(o.dossierSortie, { recursive: true });
  const gabarit = chargerGabarit(dossierGabarits, 'edudoc.twig');
  const blocs = gabarit.rendre({
    articles: lignes, enTetesAuteurs: enTetesAuteurs, enTetesDescripteurs: enTetesDescripteurs,
    dateExport: formaterDateIso(new Date())
  });
  const chemin = path.join(o.dossierSortie, 'edudoc.csv');
  fs.writeFileSync(chemin, versCsvFinal(blocs.contenu || ''));
  emit({ t: 'fichier', chemin: chemin, nom: 'edudoc.csv' });

  // Bilan chiffré des mots-clés : Robin a choisi de n'exporter QUE les descripteurs du
  // thésaurus, jamais une forme tapée à la main — il doit voir ce qui reste sur le quai
  // plutôt que de le découvrir chez la bibliothécaire.
  if (indexThesaurus) {
    emit({ t: 'etape', texte: totalDescripteurs + ' descripteur(s) 690 exporté(s).' });
    if (motsClesNonReconnus.length > 0) {
      const AFFICHES_MAX = 20;
      const liste = motsClesNonReconnus.slice(0, AFFICHES_MAX).join(', ');
      const reste = motsClesNonReconnus.length > AFFICHES_MAX
        ? ' (+' + (motsClesNonReconnus.length - AFFICHES_MAX) + ' autre(s))' : '';
      emit({
        t: 'avert',
        texte: motsClesNonReconnus.length + ' mot(s)-clé(s) distinct(s) saisi(s) non reconnu(s) par le ' +
          'thésaurus edudoc (chaque terme compté une seule fois, même saisi par plusieurs articles), ' +
          'exporté(s) nulle part : ' + liste + reste
      });
    }
  }

  return { ok: true, texte: lignes.length + ' article(s) exporté(s) vers Edudoc.' };
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
  if (!o.cheminCache) { throw new Error('--cache est requis'); }
  if (!Array.isArray(o.cles) || o.cles.length === 0) { throw new Error('--numeros est requis'); }
  if (!o.dossierSortie) { throw new Error('--sortie est requis'); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();
  const recuperer = o.recuperer || oaiPmh.recupererAvecRepli;

  const cache = lireCacheNumeros(o.cheminCache);
  const numeros = selectionnerNumeros(cache, o.cles, emit);
  if (numeros.length === 0) { throw new Error('aucun numéro à traiter (cache vide ou clés inconnues)'); }

  // Total connu d'avance, tous numéros confondus : seuls les articles qui portent une
  // galley HTML seront effectivement téléchargés — un article sans galley n'entre jamais
  // dans le compte (il n'est jamais tenté).
  const totalCaracteres = numeros.reduce((n, numero) => n + numero.articles.filter((a) => a.galleys.html).length, 0);
  let faitCaracteres = 0;

  const lignes = [];
  for (const numero of numeros) {
    for (const art of numero.articles) {
      const titre = art.titres[art.locale] || Object.values(art.titres)[0] || art.identifiant;
      if (!art.galleys.html) { emit({ t: 'avert', texte: titre + ' : pas de galley HTML, ignoré' }); continue; }
      emit({ t: 'etape', texte: 'téléchargement : ' + titre + '...' });
      let caracteres;
      try {
        const html = await recuperer(art.galleys.html);
        caracteres = compterCaracteresHtml(html);
      } catch (e) {
        emit({ t: 'avert', texte: titre + ' : échec du téléchargement (' + String((e && e.message) || e) + ')' });
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
  const gabarit = chargerGabarit(dossierGabarits, 'caracteres.twig');
  const blocs = gabarit.rendre({ articles: lignes });
  const chemin = path.join(o.dossierSortie, 'caracteres.csv');
  fs.writeFileSync(chemin, versCsvFinal(blocs.contenu || ''));
  emit({ t: 'fichier', chemin: chemin, nom: 'caracteres.csv' });

  return { ok: true, texte: lignes.length + ' article(s) compté(s).' };
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

// Auteurs : « Nom, Prénom » en minuscules, comparés en ENSEMBLE et en ORDRE — l'ordre des
// auteurs est éditorial, il compte autant que leur présence.
function comparerAuteurs(localAuteurs, oaiAuteurs) {
  const cle = (a) => (txt(a && a.nom) + ', ' + txt(a && a.prenom)).toLowerCase();
  const nomsLocal = (localAuteurs || []).map(cle);
  const nomsOai = (oaiAuteurs || []).map(cle);
  const memeEnsemble = JSON.stringify(nomsLocal.slice().sort()) === JSON.stringify(nomsOai.slice().sort());
  const memeOrdre = JSON.stringify(nomsLocal) === JSON.stringify(nomsOai);
  return { memeEnsemble: memeEnsemble, memeOrdre: memeOrdre, local: nomsLocal, oai: nomsOai };
}

// ⚠ L'OAI moissonné ici est en oai_dc (voir « Les données » du mandat) : ce format ne
// porte pas l'affiliation des auteur·e·s (seul marcxml le ferait, cf. lib/auteurs-ojs.js).
// La comparaison des affiliations demandée par le mandat n'est donc PAS vérifiable par ce
// chemin — le rapport le dit explicitement plutôt que de laisser croire à une concordance.
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
  const racines = (Array.isArray(o.racinesNumeros) ? o.racinesNumeros : [o.racinesNumeros]).filter(Boolean);
  if (racines.length === 0) { throw new Error('--numero est requis (une ou plusieurs fois)'); }
  if (!o.cheminCache) { throw new Error('--cache est requis'); }
  if (!o.dossierSortie) { throw new Error('--sortie est requis'); }
  const dossierGabarits = o.dossierGabarits || dossierGabaritsSource();

  const cache = lireCacheNumeros(o.cheminCache);
  const totalMetadonnees = racines.length;
  const rapports = [];
  for (let i = 0; i < racines.length; i++) {
    const racine = racines[i];
    emit({ t: 'etape', texte: 'lecture locale : ' + racine + ' (' + (i + 1) + '/' + totalMetadonnees + ')...' });
    const local = collecterNumeroLocal(racine, emit);
    const liste = cache.numeros[local.numero.cle] || [];
    const oaiNumero = liste.find((n) => n.revue === local.numero.revue) || liste[0] || null;
    if (!oaiNumero) { emit({ t: 'avert', texte: local.numero.cle + ' : aucune correspondance dans le cache OAI' }); }
    rapports.push(comparerNumero(local, oaiNumero));
    emit({ t: 'progres', fait: i + 1, total: totalMetadonnees });
  }

  fs.mkdirSync(o.dossierSortie, { recursive: true });
  const gabarit = chargerGabarit(dossierGabarits, 'metadonnees.twig');
  const blocs = gabarit.rendre({ rapports: rapports, dateComparaison: formaterDateIso(new Date()) });
  const chemin = path.join(o.dossierSortie, 'metadonnees.txt');
  fs.writeFileSync(chemin, blocs.contenu || '', 'utf8');
  emit({ t: 'fichier', chemin: chemin, nom: 'metadonnees.txt' });

  return { ok: true, texte: rapports.length + ' numéro(s) comparé(s).' };
}

module.exports = {
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
