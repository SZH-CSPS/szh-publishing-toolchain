// Export OJS natif : toute la revue en un seul fichier XML « native » PKP — numéro,
// rubriques, couverture, articles et galleys encodés en base64 — importable par
// Outils > Importer/Exporter > Native XML. La structure, l'ordre des éléments et les
// tics de sérialisation sont calqués sur un export natif réel de l'OJS cible.
//
// Deux revues, une seule instance : la « Revue suisse de pédagogie spécialisée » (locale
// fr) et la « Schweizerische Zeitschrift für Heilpädagogik » (locale de) sont deux revues
// OJS distinctes, avec leurs propres rubriques, leur propre groupe d'auteur et leur propre
// compte de téléversement. OJS apparie tout cela PAR NOM à l'import : un intitulé
// approximatif ne provoque pas d'erreur, il crée un doublon ou range l'article ailleurs.
// D'où la règle de ce module : ce qui n'a pas été relevé sur l'instance reste vide, et un
// champ vide obligatoire arrête l'export au lieu d'envoyer une valeur inventée.
'use strict';

const fs = require('fs');
const path = require('path');
const { analyserAusgabe, analyserMeta, langueDefaut, normaliserLangueArticle,
  licenceArticle, normaliserLicence, listeYamlEnLigne, CLE_SANS_DOI } = require('./yaml');
const { estATraduire, MARQUE_A_TRADUIRE } = require('./traduction');
const { imagesSansAlternative, listerImages } = require('./references');
const { referencesDuTexte, referencesDuFichier } = require('./citations');
const { CONFIG } = require('./archivage');
const { T, TEXTES_COCKPIT } = require('./i18n');

// ---- Configuration de l'OJS cible ---------------------------------------------------
//
// Les valeurs ci-dessous sont celles relevées sur ojs.szh.ch (OJS 3.5.0.4) : elles
// servent de défauts, et le config.json du poste les surcharge, champ par champ (voir
// configOjs()). Ce qui n'a pas pu être relevé reste '' : le panneau « Réglages SZH » le
// montre vide, avec l'endroit où aller le chercher, et l'export refuse de partir plutôt
// que de deviner.
//
// Les deux locales sont celles des deux revues, et non celles d'un article : une revue
// OJS n'a qu'une locale d'interface.
const LOCALES_REVUE = ['fr', 'de'];

// Un champ par revue. `libelle` et `ou` sont des clés i18n : le même couple sert au
// libellé du panneau et au message qui bloque l'export, il n'y a donc qu'un endroit à
// corriger. `requis` : vide, l'export s'arrête.
const CHAMPS_REVUE = [
  { cle: 'genreFichier', requis: true,  libelle: 'ojs.libelle.genre',       ou: 'ojs.ou.genre' },
  { cle: 'groupeAuteur', requis: true,  libelle: 'ojs.libelle.groupe',      ou: 'ojs.ou.groupe' },
  { cle: 'televerseur',  requis: true,  libelle: 'ojs.libelle.televerseur', ou: 'ojs.ou.televerseur' },
  { cle: 'paysAuteur',   requis: false, libelle: 'ojs.libelle.pays',        ou: 'ojs.ou.pays' }
];

// Côté français : valeurs éprouvées par un import réel. Côté allemand : rien n'a été
// relevé — ni le nom du composant de soumission, ni celui du groupe d'auteur, ni le
// compte de téléversement. Le pays n'a été relevé dans aucune des deux revues ; il était
// écrit « CH » en dur jusqu'ici, ce qui affirmait la nationalité de chaque auteur sans
// l'avoir vérifiée. Il part donc vide, et <country> est simplement omis.
const DEFAUTS_REVUE = {
  fr: { genreFichier: "Texte de l'article", groupeAuteur: 'Auteur', televerseur: 'redaction', paysAuteur: '' },
  de: { genreFichier: '', groupeAuteur: '', televerseur: '', paysAuteur: '' }
};

// Rubriques réelles des deux revues, dans l'ordre de la base OJS. À l'import, OJS
// apparie chaque rubrique aux rubriques existantes titre par titre et abréviation par
// abréviation ; `section_ref` d'un article, lui, est résolu sur la seule ABRÉVIATION
// (filterByAbbrevs). D'où deux conséquences :
//   — `cle` n'est qu'un identifiant interne au cockpit, celui que la table des types
//     désigne ; il ne part jamais dans le XML ;
//   — `ref` et `section_ref` portent l'abréviation de la revue visée, pas la clé. C'est
//     ce qui fait qu'un article de Documentation atterrit dans « DK » sur la Zeitschrift
//     et dans « DC » sur la Revue.
//
// Pièges relevés sur l'instance, à ne pas « corriger » : « Ed » en allemand mais « ED »
// en français ; « Tribune Libre » avec une majuscule côté français et « Tribune libre »
// sans côté allemand, le libellé de cette rubrique étant français dans la revue
// allemande. « ART » est du rétro-catalogue de migration, non une rubrique d'usage
// courant, mais elle existe et occupe le seq 2.
//
// `sansResume` : la rubrique n'exige pas de résumé (abstracts_not_required d'OJS).
// `sansDoi`   : la rubrique n'exige pas de DOI. Vérifié pour Documentation ; posé aussi
//               pour le podcast, la langue facile et les annonces, qui ne portent pas
//               d'article scientifique — un DOI y reste accepté s'il y en a un.
// `idInterne` : id de la base OJS, écrit avec advice="ignore" et donc toujours réattribué
//               à l'import. Aucune importance ; il suit la référence pour rester lisible.
// Abréviation et titre vides = jamais relevés : la rubrique « Annonces / Inserate » est
// absente de ListSets bien qu'elle paraisse dans tous les sommaires.
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

// Forme réelle des DOI de la maison, relevée sur ojs.szh.ch : un seul préfixe pour les deux
// revues, la lettre les distinguant, AAAA-NN le numéro dans l'année et SS le compteur dans
// le numéro — « 10.57161/z2026-06-00 ».
//
// Le DOI est un CALCUL, sans mémoire : rien ne le stocke, il se redéduit à tout moment de
// la revue, de l'année, du numéro et du rang de l'article. Le rang est celui de l'article
// parmi ceux qui reçoivent un DOI, compté à partir de zéro : l'éditorial ouvre le numéro et
// porte donc « 00 », ce que pipeline/docx-meta.py reconnaît déjà pour deviner un éditorial.
const PREFIXE_DOI = '10.57161';
const LETTRE_DOI = { fr: 'r', de: 'z' };

// Deux chiffres, comme l'instance les écrit. Au-delà de 99, le nombre s'écrit tel quel
// plutôt que de mentir sur deux chiffres — un numéro à trois chiffres n'existe pas, mais un
// DOI tronqué désignerait un autre article.
function deuxChiffres(n) {
  const v = Math.trunc(Number(n));
  if (!isFinite(v) || v < 0) { return ''; }
  return v < 10 ? '0' + v : String(v);
}

// doiCalcule(locale, annee, numero, rang) -> '10.57161/r2026-03-05', ou '' si l'un des
// morceaux manque : un numéro dont la date n'est pas encore posée n'a pas d'année, et un
// DOI à trous serait pire que pas de DOI. `rang` à -1 (article qui n'en reçoit pas) rend ''
// aussi.
function doiCalcule(locale, annee, numero, rang) {
  const lettre = LETTRE_DOI[String(locale || '').toLowerCase()];
  const an = (String(annee === undefined || annee === null ? '' : annee).match(/\d{4}/) || [''])[0];
  // Les chiffres du numéro, et RIEN quand il n'y en a pas : sans ce test, un numéro sans
  // nombre passerait pour le numéro zéro et fabriquerait « …-00-01 », un DOI qui a l'air
  // juste et qui désigne un numéro qui n'existe pas.
  const chiffres = String(numero === undefined || numero === null ? '' : numero).replace(/\D+/g, '');
  const num = chiffres === '' ? '' : deuxChiffres(chiffres);
  const seq = deuxChiffres(rang);
  if (!lettre || an === '' || num === '' || seq === '') { return ''; }
  return PREFIXE_DOI + '/' + lettre + an + '-' + num + '-' + seq;
}

// Le motif ne sert qu'à signaler un DOI saisi de travers — un « r » sur la Zeitschrift, par
// exemple, qui se publierait sans que rien ne le dise. L'exemple est produit par le
// générateur lui-même : un exemple recopié à la main finirait par mentir sur la forme.
const FORME_DOI = {
  fr: { motif: /^10\.57161\/r\d{4}-\d{2}-\d{2}$/, exemple: doiCalcule('fr', '2026', '3', 5) },
  de: { motif: /^10\.57161\/z\d{4}-\d{2}-\d{2}$/, exemple: doiCalcule('de', '2026', '3', 5) }
};

// Crédits de figure qui ne posent aucune question de licence : la maison elle-même.
// Comparés sur leurs lettres seules, si bien que « © SZH », « (c) csps » et « © SZH/CSPS »
// sont le même crédit. Le nom d'un·e auteur·e de l'article compte aussi pour sien : c'est
// lui ou elle qui a confié l'image à la revue.
const CREDITS_MAISON = ['szh', 'csps'];

// Les galleys sont émis dans cet ordre, et OJS respecte l'ordre d'import : DOCX, HTML,
// PDF, comme le site les affiche.
const FORMATS_GALLEY = [
  { etiquette: 'DOCX', ext: 'docx' },
  { etiquette: 'HTML', ext: 'html' },
  { etiquette: 'PDF', ext: 'pdf' }
];
const NOMS_COUVERTURE = ['couverture.jpg', 'couverture.jpeg', 'couverture.png'];
// Légende que Ctrl+Alt+F et « Insérer dans le texte » posent en attendant la vraie, dans
// les deux langues du cockpit : la reconnaître, c'est pouvoir dire qu'elle a été oubliée.
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

// Lettres et chiffres d'une chaîne, sans accents ni ponctuation : de quoi comparer deux
// crédits écrits à la main. Rien d'autre n'en dépend, et la comparaison reste large
// exprès — c'est un avertissement qu'elle sert, pas un blocage.
function cleCredit(valeur) {
  return String(valeur === undefined || valeur === null ? '' : valeur)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '');
}

// L'URL de licence telle que l'export de référence de la maison l'écrit : sans barre
// finale. La forme canonique de Creative Commons la porte, et c'est elle que lib/yaml.js
// garde et que le gabarit HTML imprime ; l'XML déjà importé dans OJS ne bouge pas pour si
// peu, donc la barre est retirée ici, au seul endroit qui la refuse.
function urlOjs(url) {
  return String(url || '').replace(/\/+$/, '');
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

// Même filtre que la variable SLUGS du Makefile : le tri ASCII des slugs, préfixés 01-,
// 02-…, donne l'ordre éditorial du numéro.
function listerSlugs(racine) {
  const dossier = path.join(racine, 'articles');
  let entrees = [];
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
  catch (e) { return []; }
  return entrees
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(dossier, e.name, e.name + '.md')))
    .map((e) => e.name)
    .sort();
}

// ---- Lecture et écriture de la configuration -----------------------------------------
//
// Support retenu : le config.json du poste, celui que lit lib/archivage.js et que
// partagent les scripts PowerShell. Pourquoi celui-là et non un fichier par numéro : ces
// valeurs décrivent l'INSTANCE OJS (noms de composants, de rôles, de comptes,
// abréviations de rubriques), pas le numéro. Rangées dans le dossier d'un numéro, elles
// partiraient à l'archivage et un numéro rouvert trois ans plus tard réimporterait avec
// les intitulés de 2026 ; rangées dans le poste, elles suivent l'instance, se corrigent
// une fois pour les deux revues, et bootstrap.ps1 a déjà donné au groupe Utilisateurs le
// droit d'y écrire.
//
// SZH_CONFIG_OJS impose un autre fichier : le harnais s'en sert, et une vérification en
// ligne de commande aussi, sans toucher à C:\ProgramData.
function cheminConfigOjs() {
  return texte(process.env.SZH_CONFIG_OJS) || CONFIG;
}

// BOM retiré avant l'analyse, comme dans lib/archivage.js : d'anciens config.json en
// portent un, et JSON.parse le refuse.
function lireConfigPoste() {
  try { return JSON.parse(String(fs.readFileSync(cheminConfigOjs(), 'utf8')).replace(/^\uFEFF/, '')); }
  catch (e) { return null; }
}

function cloner(v) { return JSON.parse(JSON.stringify(v)); }

// Clé de rubrique : identifiant interne, jamais écrit dans le XML. Conservateur, parce
// qu'il sert d'index partout.
function normaliserCleRubrique(valeur) {
  return texte(valeur).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

// Défauts + surcharge du poste, champ par champ. La règle est « la clé présente gagne,
// même vide » : ce que le panneau montre est ce que l'export emploie, et vider un champ
// dans l'interface doit avoir un effet, sinon le défaut reviendrait en douce.
//
// Les rubriques sont fusionnées PAR CLÉ, et une clé inconnue est ajoutée à la suite :
// une configuration qui ne corrige qu'un titre allemand ne perd pas le reste de la
// table, et une rubrique ajoutée dans l'interface survit à une mise à jour du logiciel.
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

// La rubrique d'un type d'article reçoit-elle un DOI ? C'est la table des rubriques qui le
// dit — Documentation, podcast, langue facile et annonces n'en reçoivent pas — et non une
// liste tenue ailleurs : un poste dont la configuration a été corrigée suit la correction.
// Sert aussi à la vue « Articles », qui affiche le DOI calculé sur chaque carte et doit
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
  try {
    const fichier = lireConfigPoste() || {};
    // Normalisée avant d'être écrite : le fichier porte toujours la table complète, et
    // une valeur venue du panneau ne s'y écrit pas telle quelle.
    fichier.ojs = normaliserConfigOjs({ ojs: config });
    fs.writeFileSync(cheminConfigOjs(), JSON.stringify(fichier, null, 2) + '\n', 'utf8');
    return null;
  } catch (e) { return String((e && e.message) || e); }
}

// ---- Collecte et garde-fous ----------------------------------------------------------

// Un manque de configuration ne se corrige pas dans le numéro mais dans les réglages :
// le message nomme le champ, la revue, et l'écran d'OJS où relever la valeur.
function manqueConfig(libelle, locale, ou) {
  return T('ojs.err.config', [libelle, T('ojs.revue.' + locale), ou]);
}

// Les références d'un article, en texte brut, relues au dernier moment.
//
// La source, c'est le FICHIER de bibliographie que l'import a détaché : ce sont les
// références et rien d'autre, sans titre à reconnaître et sans découpage à deviner. Un
// article importé avant que la bibliographie devienne un fichier n'en a pas ; on retombe
// alors sur son .md, et on le dit — c'est un réimport qui le corrige.
//
// referencesDuFichier() et referencesDuTexte() lèvent quand les tables du filtre de
// citations sont inaccessibles (toolkit absent ou plus ancien que le cockpit) : ce n'est pas
// une raison d'arrêter l'export d'un numéro entier, donc on le dit une fois et on continue
// sans <citations>.
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

function collecter(racine, cfg, avertissements) {
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

  // La configuration de la revue visée : sans elle, rien de ce qui suit n'a de sens.
  // Une locale hors des deux revues (un numéro marqué `lang: it`, par exemple) n'a pas
  // de configuration du tout et s'arrête ici.
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
  // Le pays n'est pas obligatoire, mais un « Suisse » saisi à la place de « CH » ne
  // serait pas un pays pour OJS : mieux vaut l'omettre en le disant.
  const pays = texte(revue.paysAuteur);
  if (pays === '') { avertissements.push(T('ojs.avert.pays')); }
  else if (!/^[A-Za-z]{2}$/.test(pays)) {
    avertissements.push(T('ojs.avert.pays.forme', [pays]));
    revue.paysAuteur = '';
  }

  if (!numero.volume) { avertissements.push(T('ojs.avert.volume')); }
  if (!numero.numero) { avertissements.push(T('ojs.avert.numero')); }
  if (!numero.annee) { avertissements.push(T('ojs.avert.annee')); }
  // Un numéro part avec published="1" : sans date de publication, OJS le publie sans
  // date et il faut la ressaisir article par article dans l'interface. Le gabarit livre
  // désormais une date complète ; ce qui manque encore, c'est la vraie.
  if (!numero.datePublication) {
    bloquants.push(T('ojs.err.date', [texte(valeurs.date) || '—']));
  }
  for (const nom of NOMS_COUVERTURE) {
    if (fs.existsSync(path.join(racine, nom))) { numero.couverture = nom; break; }
  }
  if (!numero.couverture) {
    avertissements.push(T('ojs.avert.couverture', [NOMS_COUVERTURE.join(', ')]));
  }

  const slugs = listerSlugs(racine);
  if (slugs.length === 0) {
    throw new Error(T('ojs.err.aucunArticle', [racine]));
  }

  // Les articles dont la rédaction a décidé qu'ils ne portent pas de DOI, cochés sur leur
  // carte dans la vue « Articles ». Une absence VOULUE n'est pas un oubli : elle ne doit
  // pas arrêter l'export, et elle ne doit pas non plus passer sous silence — d'où un
  // avertissement à elle, distinct de celui des rubriques qui n'en reçoivent jamais.
  const sansDoiVoulu = new Set(listeYamlEnLigne(valeurs[CLE_SANS_DOI]));

  const parCle = {};
  for (const r of cfg.rubriques) { parCle[r.cle] = r; }
  const lireReferences = lecteurReferences(racine, avertissements);

  // Une rubrique employée par un article doit avoir son abréviation et son titre dans la
  // langue de la revue : l'abréviation est la seule chose sur laquelle OJS résout
  // `section_ref`, et le titre est requis par le schéma. C'est le cas de « Annonces /
  // Inserate », dont l'abréviation n'a jamais pu être relevée.
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
    const cheminMeta = path.join(racine, 'articles', slug, slug + '.meta.yaml');
    let meta = null;
    try { meta = analyserMeta(fs.readFileSync(cheminMeta, 'utf8')); }
    catch (e) { bloquants.push(prefixe + T('ojs.err.fiche', [slug + '.meta.yaml'])); }

    const article = { slug: slug, meta: meta, rubrique: null, fichiers: [], references: [] };
    if (meta) {
      const rubrique = parCle[cfg.types[texte(meta.type)]] || null;
      if (!rubrique) {
        bloquants.push(prefixe + (meta.type
          ? T('ojs.err.type.inconnu', [texte(meta.type)])
          : T('ojs.err.type.absent')));
      }
      article.rubrique = rubrique;
      if (rubrique) { verifierRubrique(rubrique); }

      // La langue de l'article prime sur celle du numéro : c'est elle qui décide de la
      // maquette, et c'est donc dans elle que le titre et le résumé doivent exister.
      // Le locale de la soumission reste celui de la revue — une revue OJS n'a qu'une
      // locale, et une soumission déclarée dans une autre serait refusée à l'import.
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
      // La marque « TO BE TRANSLATED » tient la place d'un mot-clé non traduit : utile en
      // atelier, désastreuse une fois publiée, et c'est ici le dernier moment pour la
      // signaler.
      for (const l of Object.keys(meta.keywords || {})) {
        const n = (meta.keywords[l] || []).filter((m) => estATraduire(m)).length;
        if (n > 0) {
          avertissements.push(prefixe + T('ojs.avert.motscles.marque',
            [n, l.toUpperCase(), MARQUE_A_TRADUIRE]));
        }
      }
      // Le DOI de la fiche fait foi : c'est lui qui a été déposé chez Crossref, et rien
      // ne le recalcule ici. La vue « Articles » montre, elle, le DOI que le rang de
      // l'article donne — l'ordre de l'export est alphabétique et non celui du numéro, il
      // ne peut donc pas servir de compteur.
      // Un article qui en manque partirait sans identifiant pérenne et sans dépôt
      // Crossref, ce qui ne se répare pas après publication — l'export s'arrête. Trois
      // exceptions : l'absence VOULUE, cochée sur la carte de l'article, et les rubriques
      // qui n'en reçoivent jamais.
      const doi = texte(meta.doi);
      if (doi === '') {
        if (sansDoiVoulu.has(slug)) { avertissements.push(prefixe + T('ojs.avert.doi.voulu')); }
        else if (rubrique && rubrique.sansDoi) { avertissements.push(prefixe + T('ojs.avert.doi.sans')); }
        else { bloquants.push(prefixe + T('ojs.err.doi')); }
      } else if (!FORME_DOI[numero.locale].motif.test(doi)) {
        avertissements.push(prefixe + T('ojs.avert.doi.forme', [doi, FORME_DOI[numero.locale].exemple]));
      }
      // Licence de l'article : CC-BY 4.0 quand la fiche ne dit rien, exactement comme
      // avant que le champ existe. Rien à signaler dans ce cas.
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
    }

    // Accessibilité des images, dernier moment où elle se répare : une image sans texte
    // alternatif ET sans légende part en image décorative, ce que personne n'a forcément
    // décidé. Le formulaire des médias a une case pour le dire explicitement.
    try {
      const texteMd = fs.readFileSync(path.join(racine, 'articles', slug, slug + '.md'), 'utf8');
      const manquantes = imagesSansAlternative(texteMd);
      if (manquantes.length > 0) {
        const noms = manquantes.map((i) => i.relatif || i.cible || '?').join(', ');
        avertissements.push(prefixe + T('ojs.avert.alt', [manquantes.length, noms]));
      }
      // « Légende » est le texte que Ctrl+Alt+F et le bouton « Insérer » posent en attendant
      // la vraie légende : publié tel quel, il s'imprime sous la figure. Les deux langues
      // sont comparées, l'article ayant pu être monté sur un poste en allemand.
      const oubliees = listerImages(texteMd)
        .filter((i) => LEGENDES_PAR_DEFAUT.has(i.legende.trim().toLowerCase()));
      if (oubliees.length > 0) {
        avertissements.push(prefixe + T('ojs.avert.legende',
          [oubliees.length, oubliees.map((i) => i.relatif || i.cible || '?').join(', ')]));
      }
      // Crédit de figure contre licence de l'article : une figure créditée à un tiers,
      // sous une licence Creative Commons qui autorise la reprise, est le cas que la
      // couverture ne sait pas dire — elle annonce CC-BY pour tout l'article, crédit
      // « © Getty » compris. Avertissement et non blocage : « tiers » est une heuristique
      // sur du texte libre, elle se trompe dans les deux sens, et arrêter un export sur
      // elle coûterait plus qu'elle ne rapporte. Le lien entre crédit et licence reste
      // donc à la charge de la rédaction ; ceci le lui rappelle en nommant la figure.
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
      // Les références partent en texte brut, une par ligne, telles que le fichier de
      // bibliographie les porte : la chaîne ne sait pas les structurer et n'essaie pas.
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
  // La configuration d'abord : elle explique souvent le reste, et c'est elle qui décide
  // du bouton que l'hôte propose.
  const tous = bloquantsConfig.concat(bloquants);
  if (tous.length > 0) {
    const e = new Error(T('ojs.bloquants') + '\n- ' + tous.join('\n- '));
    e.szhConfigOjs = bloquantsConfig.length > 0;
    throw e;
  }
  return { numero: numero, articles: articles, revue: revue };
}

// ORCID canonique, mêmes règles que szh-maquette.lua : identifiant nu ou URL complète ->
// https://orcid.org/<ID>, X final en majuscule ; une URL sans identifiant reconnaissable
// est reprise telle quelle ; tout le reste rend '' — pas de balise vide dans le XML, et
// un avertissement le dit.
function orcidCanonique(valeur) {
  const v = texte(valeur);
  if (v === '') { return ''; }
  const m = v.match(/\d{4}-\d{4}-\d{4}-\d{3}[\dxX]/);
  if (m) { return 'https://orcid.org/' + m[0].toUpperCase(); }
  return /^https?:\/\//i.test(v) ? v : '';
}

// ---- Génération -----------------------------------------------------------------------

// -> { chemin, avertissements: string[] }. Écrit
// native-<AAAAMMJJ-HHMMSS>-<volume>-<numero>.xml à la racine de la revue, en écriture
// atomique. Lève une Error listant tous les manques bloquants avant d'écrire quoi que ce
// soit. options.maintenant fixe l'horodatage et options.config impose une configuration,
// ce dont se servent les tests.
function genererExportOjs(racine, options) {
  options = options || {};
  const maintenant = options.maintenant instanceof Date ? options.maintenant : new Date();
  const aujourdHui = formaterDateIso(maintenant);
  const avertissements = [];
  const cfg = options.config ? normaliserConfigOjs({ ojs: options.config }) : configOjs();
  const collecte = collecter(racine, cfg, avertissements);
  const numero = collecte.numero;
  const articles = collecte.articles;
  const revue = collecte.revue;

  // Un seul compteur global, donc des id uniques dans tout le fichier. OJS les
  // ré-attribue tous à l'import ; seuls comptent les renvois internes, qui pointent vers
  // l'avant et sont donc alloués avant l'écriture.
  let prochainId = 1;
  const allouer = () => prochainId++;
  const idNumero = allouer();
  const parRubrique = {};                          // seq de publication PAR rubrique (1, 2, …)
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
      ' published="1" current="1" access_status="1" url_path=""' + SCHEMA + '>\n');
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

    // Une seule langue par rubrique, celle de la revue : OJS apparie les rubriques titre
    // par titre ET langue par langue, et un titre dans une langue que la revue cible
    // n'emploie pas ne correspond à rien — « … est identique à une rubrique existante
    // dans la revue, mais un autre titre de cette rubrique ne correspond à aucun autre
    // titre de rubrique existante ». Les intitulés de l'autre revue restent dans la
    // table, pour l'autre revue.
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
        ' primary_contact_id="' + a.auteurs[0].idAuteur + '" url_path="" seq="' + a.seq + '"' +
        ' access_status="0" date_published="' + numero.datePublication + '"' +
        ' section_ref="' + echapperXml(a.rubrique.abbrev[numero.locale]) + '"' + SCHEMA + '>\n');
      ligne(8, 'id', ' type="internal" advice="ignore"', a.idPublication);
      if (texte(meta.doi)) { ligne(8, 'id', ' type="doi" advice="update"', texte(meta.doi)); }
      for (const l of localesNonVides(meta.title)) { ligne(8, 'title', ' locale="' + l + '"', meta.title[l].trim()); }
      for (const l of localesNonVides(meta.subtitle)) { ligne(8, 'subtitle', ' locale="' + l + '"', meta.subtitle[l].trim()); }
      // Le résumé est une valeur HTML : texte échappé pour le HTML, puis l'ensemble pour
      // le XML. Ce double échappement est celui de la référence.
      for (const l of localesNonVides(meta.resume)) {
        ligne(8, 'abstract', ' locale="' + l + '"', '<p>' + echapperHtml(meta.resume[l].trim()) + '</p>');
      }
      // Licence de l'article, CC-BY 4.0 par défaut. « Droits réservés » n'a pas d'adresse
      // et n'en reçoit pas de fabriquée : l'élément est alors absent, et collecter() l'a
      // dit dans les avertissements.
      const licence = licenceArticle(meta.licence);
      if (licence.url !== '') { ligne(8, 'licenseUrl', '', urlOjs(licence.url)); }
      const nomsAuteurs = a.auteurs
        .map((x) => ((x.prenom || '').trim() + ' ' + (x.nom || '').trim()).trim())
        .join(', ');
      ligne(8, 'copyrightHolder', loc, nomsAuteurs);
      if (numero.annee) { ligne(8, 'copyrightYear', '', numero.annee); }
      for (const l of Object.keys(meta.keywords || {}).sort()) {
        const mots = (meta.keywords[l] || []).map((m) => String(m).trim()).filter((m) => m !== '');
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
        // Ordre imposé par le schéma (type `identity`) : givenname, familyname,
        // affiliation, country, email, url, orcid.
        // givenname est requis par le schéma : un auteur sans prénom y met son nom
        // entier, comme le fait la référence pour « Edition SZH/CSPS ».
        ligne(12, 'givenname', loc, prenom || nom);
        if (prenom && nom) { ligne(12, 'familyname', loc, nom); }
        if ((auteur.affiliation || '').trim()) {
          w('            <affiliation>\n');
          ligne(14, 'name', loc, auteur.affiliation.trim());
          w('            </affiliation>\n');
        }
        if (revue.paysAuteur) { ligne(12, 'country', '', revue.paysAuteur); }
        if (texte(auteur.email)) { ligne(12, 'email', '', texte(auteur.email)); }
        // L'ORCID est saisi dans la fiche et imprimé dans le PDF ; il n'allait pas dans
        // OJS, donc pas non plus dans le dépôt Crossref.
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
      // <citations> vient après les galleys : le schéma en fait le dernier élément d'une
      // publication. Une référence par <citation>, en texte brut — OJS concatène le
      // contenu des enfants ligne par ligne dans citationsRaw.
      if (a.references.length > 0) {
        w('        <citations>\n');
        for (const reference of a.references) { ligne(10, 'citation', '', reference); }
        w('        </citations>\n');
      }
      // <pages> omis : aucun article n'est paginé dans la chaîne.
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
  orcidCanonique, doiCalcule, typeSansDoi, FORME_DOI,
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
