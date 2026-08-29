// Ce qu'est le dossier qu'on vient d'ouvrir : un numéro de revue, ou un livre.
//
// Le cockpit a longtemps connu un seul objet, « la revue » : un dossier portant
// `ausgabe.yaml`, des articles dans `articles/<slug>/<slug>.md`, un dépôt Word dans
// `articles-word/`. Ces trois faits étaient écrits en toutes lettres à une vingtaine
// d'endroits. Le moteur livre en ajoute trois autres — `buch.yaml`, `chapitres/`,
// `chapitres-word/` — qui ne diffèrent que par leur nom.
//
// Ce module est la table qui les nomme, et rien de plus. Ce n'est pas un cadre à
// greffons : deux profils ne justifient pas une architecture d'extension. C'est une
// table de vérité de six lignes, plus les fonctions qui la lisent, pour que chaque
// hypothèse « revue » du code devienne NOMMÉE et TESTABLE au lieu d'être littérale.
//
// ⚠ Le module est PUR : aucun `require('vscode')`. Il ne fait que du chemin et du
//   `fs.existsSync`, ce qui permet à `node --test` de l'exercer sans hôte. Toute
//   fonction qui aurait besoin de l'API de l'éditeur n'a pas sa place ici.
//
// ⚠ La détection se fait sur la PRÉSENCE DU FICHIER de configuration, jamais sur une
//   clé qu'il contiendrait. C'est la même règle que côté chaîne (`pipeline/Makefile`,
//   `LIVRE_CONFIG := $(wildcard buch.yaml)`), et elle vaut d'être tenue des deux côtés :
//   un livre n'a pas d'`ausgabe.yaml`, il n'a donc aucune clé `profil:` à lire, et les
//   règles de la revue gardent leur littéral sans qu'on y touche.
'use strict';

const fs = require('fs');
const path = require('path');

// La table. `contexte` est la clé que l'extension pose pour VS Code (`setContext`) et que
// les `when` du package.json lisent ; `cible` est la cible make que Ctrl+S déclenche.
const PROFILS = {
  revue: {
    cle: 'revue',
    config: 'ausgabe.yaml',
    unites: { dossier: 'articles', mot: 'article', ordre: 'ordre-articles' },
    depot: 'articles-word',
    sortie: 'out',
    cible: 'all',
    contexte: 'szh.estRevue',
  },
  livre: {
    cle: 'livre',
    config: 'buch.yaml',
    unites: { dossier: 'chapitres', mot: 'chapitre', ordre: 'ordre-chapitres' },
    depot: 'chapitres-word',
    sortie: 'out',
    cible: 'livre',
    contexte: 'szh.estLivre',
  },
};

// ⚠ L'ORDRE COMPTE. Un dossier qui porterait les deux fichiers de configuration est un
//   accident — une revue dans laquelle quelqu'un a déposé un buch.yaml, ou l'inverse. On
//   tranche pour le LIVRE, parce que c'est le cas le plus récent et le plus probablement
//   voulu, et parce que la chaîne tranche déjà dans ce sens (le Makefile teste buch.yaml
//   avant de lire le profil d'ausgabe.yaml). Les deux côtés doivent dire la même chose,
//   sans quoi l'éditeur montrerait des chapitres et la compilation produirait des articles.
const ORDRE_DETECTION = ['livre', 'revue'];

function profilPour(cle) {
  return PROFILS[cle] || null;
}

// Le profil d'un dossier, ou null s'il n'en est pas un. `opts.existe` est injectable pour
// les tests — aucun test ne doit toucher au disque pour vérifier une table.
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
// Rend { racine, profil } ou null — et c'est ce null qui garde la vue latérale masquée
// dans une fenêtre ouverte sur autre chose.
function racineDepuis(dossiers, opts) {
  if (!dossiers || !dossiers.length) { return null; }
  for (const d of dossiers) {
    const chemin = typeof d === 'string' ? d : (d && d.uri && d.uri.fsPath);
    const profil = detecter(chemin, opts);
    if (profil) { return { racine: chemin, profil }; }
  }
  return null;
}

// En remontant depuis un fichier : le dossier de publication qui le contient, ou null.
// Sert à l'ouverture d'un .md par double-clic, et à tout geste qui part d'un chemin
// absolu sans savoir de quelle publication il relève.
// La remontée s'arrête à la racine du volume ; `limite` borne le nombre de crans pour
// qu'un chemin pathologique ne boucle pas.
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

// Tous les chemins d'une unité de texte — un article ou un chapitre — en un seul endroit.
// C'est cette fonction qui remplace les `path.join(racine, 'articles', slug, slug + '.md')`
// semés dans extension.js : le jour où un profil range ses unités ailleurs, il n'y a qu'ici
// à le dire.
function chemins(profil, racine, slug) {
  const p = typeof profil === 'string' ? profilPour(profil) : profil;
  if (!p) { throw new TypeError('profil inconnu'); }
  const base = { racine, config: path.join(racine, p.config),
                 unites: path.join(racine, p.unites.dossier),
                 depot: path.join(racine, p.depot),
                 sortie: path.join(racine, p.sortie) };
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
    // ⚠ Les sorties d'un ARTICLE vivent dans out/<slug>/ ; celles d'un LIVRE sont
    //   communes à tout l'ouvrage et portent le nom du dossier, pas celui du chapitre.
    //   Un chapitre n'a donc pas de PDF à lui — seulement un fragment intermédiaire.
    outUnite: p.cle === 'livre'
      ? path.join(base.sortie, p.unites.dossier, slug + '.frag.html')
      : path.join(base.sortie, slug),
  });
}

// Le nom d'une unité au singulier, dans la langue de l'interface. Sert aux messages :
// « supprimer cet article » / « supprimer ce chapitre ». Les libellés complets restent
// dans lib/i18n.js ; ce qui est ici, c'est la CLÉ à lui demander.
function cleLibelle(profil, suffixe) {
  const p = typeof profil === 'string' ? profilPour(profil) : profil;
  if (!p) { throw new TypeError('profil inconnu'); }
  return 'unite.' + p.unites.mot + (suffixe ? '.' + suffixe : '');
}

// Toutes les clés de contexte, pour les poser d'un coup : celle du profil actif à vrai,
// les autres à faux. Sans le second temps, une fenêtre qui passe d'une revue à un livre
// garderait szh.estRevue vrai et afficherait les deux vues.
function contextes(profil) {
  const actif = profil ? (typeof profil === 'string' ? profilPour(profil) : profil) : null;
  const out = {};
  for (const cle of Object.keys(PROFILS)) {
    out[PROFILS[cle].contexte] = !!(actif && actif.cle === cle);
  }
  return out;
}

module.exports = {
  PROFILS, ORDRE_DETECTION,
  profilPour, detecter, racineDepuis, remonterVers, chemins, cleLibelle, contextes,
};
