// Le profil du dossier ouvert : un numéro de revue (`ausgabe.yaml`, `articles/`,
// `articles-word/`) ou un livre (`buch.yaml`, `chapitres/`, `chapitres-word/`). PROFILS
// est la table qui nomme ces différences et les capacités de chaque profil.
//
// Sans `require('vscode')`, pour être testé par `node --test`.
//
// Le profil se reconnaît à la présence du fichier de configuration, comme dans
// `pipeline/Makefile` (`LIVRE_CONFIG := $(wildcard buch.yaml)`).
'use strict';

const fs = require('fs');
const path = require('path');
// Seul état lu : le profil posé par l'extension.
const session = require('./session');

// `contexte` est la clé posée par `setContext` et lue par les `when` du package.json ;
// `cible` est la cible make lancée par Ctrl+S. `capacites` dit quelles fonctions existent
// dans le profil : chacune devient le contexte `szh.peut.<nom>` (contextes()), lu par les
// `when`, les panneaux, l'arbre et les webviews. Les deux profils ont les mêmes clés.
const PROFILS = {
  revue: {
    cle: 'revue',
    config: 'ausgabe.yaml',
    unites: { dossier: 'articles', mot: 'article', ordre: 'ordre-articles', vue: 'szh.vueArticles' },
    depot: 'articles-word',
    sortie: 'out',
    cible: 'all',
    contexte: 'szh.estRevue',
    capacites: {
      doi: true,            // DOI par unité, calculé d'après le rang
      ojs: true,            // export XML vers OJS
      traductions: true,    // version jumelle de chaque unité, section « Traductions »
      documentation: true,  // rubrique Documentation, section « Actualité »
      pagination: true,     // folios continus du numéro
      reimport: true,       // réimport d'un Word sur une unité existante
      envoiAuteur: true,    // envoi de la version finale aux auteur·e·s
      pdfArticle: true,     // PDF propre à chaque unité, à exporter ou à voir
      vueFiches: true,      // page « Métadonnées des articles »
      typeArticle: true,    // type de l'unité dans sa fiche
      licence: true,        // licence par unité
      motsCles: true,       // mots-clés edudoc par unité
      tutoriel: true,       // parcours de démarrage
      horsSommaire: false,  // case « hors sommaire » d'une unité
      titreEnLignes: false, // « // » d'un titre montré en lignes
      sortiesLivre: false,  // imprimeur, couverture, EPUB, web et aperçu du livre entier
      paletteLivre: false,  // en-tête FALC et code QR dans la mise en forme
    },
  },
  livre: {
    cle: 'livre',
    config: 'buch.yaml',
    unites: { dossier: 'chapitres', mot: 'chapitre', ordre: 'ordre-chapitres', vue: 'szh.vueChapitres' },
    depot: 'chapitres-word',
    sortie: 'out',
    cible: 'livre',
    contexte: 'szh.estLivre',
    capacites: {
      doi: false, ojs: false, traductions: false, documentation: false, pagination: false,
      reimport: false, envoiAuteur: false, pdfArticle: false, vueFiches: false,
      typeArticle: false, licence: false, motsCles: false, tutoriel: false,
      horsSommaire: true, titreEnLignes: true, sortiesLivre: true, paletteLivre: true,
    },
  },
};

// Préfixe des clés de contexte des capacités : `szh.peut.doi`, `szh.peut.ojs`…
const PREFIXE_CAPACITE = 'szh.peut.';

// L'ordre compte : un dossier qui porte les deux fichiers est un livre, comme pour le
// Makefile, qui teste buch.yaml avant ausgabe.yaml.
const ORDRE_DETECTION = ['livre', 'revue'];

function profilPour(cle) {
  return PROFILS[cle] || null;
}

// Le profil d'un dossier, ou null s'il n'en est pas un. `opts.existe` remplace l'accès au
// disque dans les tests.
function detecter(dossier, opts) {
  if (!dossier) { return null; }
  const existe = (opts && opts.existe) || fs.existsSync;
  for (const cle of ORDRE_DETECTION) {
    const p = PROFILS[cle];
    try {
      if (existe(path.join(dossier, p.config))) { return p; }
    } catch (e) { /* dossier illisible : on essaie le suivant */ }
  }
  return null;
}

// Le premier dossier du workspace qui est une publication, avec son profil.
// Rend { racine, profil } ou null ; null masque la vue latérale.
function racineDepuis(dossiers, opts) {
  if (!dossiers || !dossiers.length) { return null; }
  for (const d of dossiers) {
    const chemin = typeof d === 'string' ? d : (d && d.uri && d.uri.fsPath);
    const profil = detecter(chemin, opts);
    if (profil) { return { racine: chemin, profil }; }
  }
  return null;
}

// Le dossier de publication qui contient un fichier, en remontant, ou null. Sert par
// exemple à l'ouverture d'un .md par double-clic. La remontée s'arrête à la racine du
// volume ; `limite` borne le nombre de niveaux.
function remonterVers(fichier, opts, limite) {
  let courant = fichier ? path.dirname(fichier) : null;
  let restant = typeof limite === 'number' ? limite : 40;
  while (courant && restant-- > 0) {
    const profil = detecter(courant, opts);
    if (profil) { return { racine: courant, profil }; }
    const parent = path.dirname(courant);
    if (parent === courant) { break; }
    courant = parent;
  }
  return null;
}

// Tous les chemins d'une unité de texte (article ou chapitre).
function chemins(profil, racine, slug) {
  const p = typeof profil === 'string' ? profilPour(profil) : profil;
  if (!p) { throw new TypeError('profil inconnu'); }
  const base = { racine, config: path.join(racine, p.config),
                 unites: path.join(racine, p.unites.dossier),
                 depot: path.join(racine, p.depot),
                 sortie: path.join(racine, p.sortie) };
  // Le PDF que valide le contrôle PDF/UA : pour un livre, celui de l'ouvrage entier, connu
  // même sans slug (chemins('livre', racine)).
  if (p.cle === 'livre') { base.pdf = pdfLivre(racine); }
  if (!slug) { return base; }
  const dossier = path.join(base.unites, slug);
  return Object.assign(base, {
    dossier,
    md:      path.join(dossier, slug + '.md'),
    meta:    path.join(dossier, slug + '.meta.yaml'),
    taches:  path.join(dossier, slug + '.taches.yaml'),
    biblio:  path.join(dossier, slug + '.biblio.md'),
    media:   path.join(dossier, 'media'),
    tables:  path.join(dossier, 'tables'),
    portraits: path.join(dossier, 'portraits'),
    // Les sorties d'un article sont dans out/<slug>/. Celles d'un livre sont communes à
    // l'ouvrage et portent le nom du dossier ; un chapitre n'a que son aperçu HTML
    // (out/chapitres/<slug>.apercu.html, APERCUS_CHAPITRES dans livre.mk). Le PDF du livre
    // vient de pdfLivre().
    outUnite: p.cle === 'livre'
      ? path.join(base.sortie, p.unites.dossier, slug + '.apercu.html')
      : path.join(base.sortie, slug),
    // Le PDF d'un article de revue : out/<slug>/<slug>.pdf. Pour un livre, il est déjà
    // dans `base`.
    pdf: p.cle === 'livre' ? base.pdf : path.join(base.sortie, slug, slug + '.pdf'),
  });
}

// Le PDF numérique du livre entier (LIVRE_PDF de livre.mk : out/<NOM_LIVRE>.pdf, du nom du
// dossier), celui que valide PDF/UA. Le PDF imprimeur (fond perdu, traits de coupe) a sa
// propre cible make.
function pdfLivre(racine) {
  return path.join(racine, 'out', path.basename(racine) + '.pdf');
}

// La vue d'ensemble ouverte par un clic sur l'en-tête d'une section, ou null si la section
// n'en a pas (« Actualité ») ou n'existe pas dans ce profil. La section des unités ouvre la
// vue de son profil ; « traductions » et « Word en attente » sont communes.
const VUES_COMMUNES = { traductions: 'szh.vueTraductions', word: 'szh.vueWord' };

function vueDeSection(profil, categorie) {
  const p = typeof profil === 'string' ? profilPour(profil) : profil;
  if (!p) { throw new TypeError('profil inconnu'); }
  if (categorie === p.unites.dossier) { return p.unites.vue; }
  return VUES_COMMUNES[categorie] || null;
}

// Ce qu'un clic sur une unité fait compiler, et le PDF qu'il ouvre. Un chapitre a sa
// cible (livre-chapitre-pdf, out/chapitres/<slug>.pdf), pour ne pas recompiler tout le
// livre. Un article de revue a son PDF dans out/<slug>/ et la cible null : l'appelant lance
// alors la tâche « Aperçu / Export PDF ».
//
// Le slug d'un chapitre entre dans une ligne bash (CHAPITRE=<slug>) : il est refusé s'il
// contient autre chose que lettres, chiffres, point, tiret et tiret bas.
const SLUG_SUR = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

function apercuUnite(profil, racine, slug) {
  const p = typeof profil === 'string' ? profilPour(profil) : profil;
  if (!p) { throw new TypeError('profil inconnu'); }
  if (p.cle === 'livre') {
    if (typeof slug !== 'string' || !SLUG_SUR.test(slug) || slug.indexOf('..') !== -1) {
      throw new TypeError('slug de chapitre refusé : ' + slug);
    }
    return { cible: 'livre-chapitre-pdf', variables: ['CHAPITRE=' + slug],
             pdf: path.join(racine, p.sortie, p.unites.dossier, slug + '.pdf') };
  }
  return { cible: null, variables: [], pdf: path.join(racine, p.sortie, slug, slug + '.pdf') };
}

// La clé i18n du nom d'une unité au singulier (« supprimer cet article » / « ce
// chapitre ») ; les libellés sont dans lib/i18n.js.
function cleLibelle(profil, suffixe) {
  const p = typeof profil === 'string' ? profilPour(profil) : profil;
  if (!p) { throw new TypeError('profil inconnu'); }
  return 'unite.' + p.unites.mot + (suffixe ? '.' + suffixe : '');
}

// Toutes les clés de contexte : celle du profil actif à vrai, les autres à faux, pour
// qu'une fenêtre qui passe d'une revue à un livre ne garde pas szh.estRevue.
function contextes(profil) {
  const actif = profil ? (typeof profil === 'string' ? profilPour(profil) : profil) : null;
  const out = {};
  for (const cle of Object.keys(PROFILS)) {
    out[PROFILS[cle].contexte] = !!(actif && actif.cle === cle);
  }
  for (const c of Object.keys(PROFILS.revue.capacites)) {
    out[PREFIXE_CAPACITE + c] = !!(actif && actif.capacites[c]);
  }
  return out;
}

// Le profil du dossier ouvert, posé par l'extension dans lib/session.js ; « revue » par
// défaut.
function courant() {
  return session.profilOuvrage() || PROFILS.revue;
}

module.exports = {
  PROFILS, ORDRE_DETECTION, PREFIXE_CAPACITE,
  profilPour, detecter, racineDepuis, remonterVers, chemins, pdfLivre, cleLibelle, contextes,
  vueDeSection, apercuUnite, courant,
};
