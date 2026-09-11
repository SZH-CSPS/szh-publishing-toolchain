// L'exécution du plan de renumérotation, sur le disque.
//
// La décision vit dans lib/renumerotation.js, qui ne touche à rien ; ici on renomme. Pas de
// `vscode` non plus : ce module ne connaît qu'un chemin de numéro, ce qui permet de
// l'éprouver sur une vraie arborescence (test/js/renumerotation-fs.test.js) plutôt que sur
// une simulation. Les refus d'interface — numéro verrouillé, compilation en cours, onglets
// ouverts — restent à l'appelant, qui seul les connaît.
//
// L'ORDRE DES GESTES, et il n'est pas indifférent :
//   1. les dossiers, en deux passes par un nom temporaire ;
//   2. les fichiers de chaque dossier, une fois celui-ci sous son nom définitif ;
//   3. les documents produits sous l'ancien nom, retirés ;
//   4. l'ordre du numéro, écrit EN DERNIER.
//
// Le 4 est la règle qui compte : écrire ausgabe.yaml avant les renommages laisserait, à la
// moindre interruption, un fichier qui désigne des dossiers inexistants — un numéro que le
// cockpit ne sait plus lire. Écrit en dernier, une interruption laisse au pire des dossiers
// temporaires, que reprendre() sait terminer.
'use strict';

const fs = require('fs');
const path = require('path');
const { planRenumerotation, planReprise, PREFIXE_TEMPO, tige } = require('./renumerotation');
const { serialiserAusgabe, ecrireAtomique } = require('./yaml');
const { CLE_ORDRE } = require('./articles');

function dossierUnites(racine, options) {
  return path.join(racine, (options && options.dossier) || 'articles');
}

function sousDossiers(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) { return []; }
}

// Les articles tels que le plan les attend : leur nom de dossier, et les fichiers posés
// directement dedans. media/ et tables/ sont des dossiers, ils ne comptent pas — ce qu'ils
// contiennent est désigné en chemin relatif depuis le .md et ne bouge donc jamais.
function listerUnites(racine, options) {
  const base = dossierUnites(racine, options);
  return sousDossiers(base).filter((nom) => nom.indexOf(PREFIXE_TEMPO) !== 0).map((nom) => ({
    slug: nom,
    fichiers: fs.readdirSync(path.join(base, nom), { withFileTypes: true })
      .filter((e) => e.isFile()).map((e) => e.name)
  }));
}

// Un lot interrompu se reconnaît à ses dossiers temporaires.
function repriseEnAttente(racine, options) {
  return sousDossiers(dossierUnites(racine, options))
    .some((nom) => nom.indexOf(PREFIXE_TEMPO) === 0);
}

// La part « slug » d'un nom de fichier : tout ce qui précède le premier point. C'est elle
// qui doit suivre le dossier — « 02-inclusion.meta.yaml » sous « 01-inclusion » n'est lu
// par personne.
function partSlug(nom) {
  const i = nom.indexOf('.');
  return i === -1 ? nom : nom.slice(0, i);
}

// Aligne les fichiers d'un dossier sur son nom. La règle vaut pour les deux chemins — le
// renommage normal comme la reprise, qui ignore l'ancien nom du dossier : un fichier suit
// si sa part « slug » a la même tige que le dossier mais pas le même préfixe. Un fichier
// étranger (une note, un Word déposé à la main) n'a pas cette tige et reste tranquille.
function alignerFichiers(base, nom) {
  let renommes = 0;
  const dossier = path.join(base, nom);
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (!entree.isFile()) { continue; }
    const part = partSlug(entree.name);
    if (part === nom || tige(part) !== tige(nom)) { continue; }
    fs.renameSync(path.join(dossier, entree.name),
      path.join(dossier, nom + entree.name.slice(part.length)));
    renommes++;
  }
  return renommes;
}

// Les documents produits sous l'ancien nom : les laisser ferait cohabiter deux PDF pour un
// même article, dont un périmé que l'export pourrait reprendre. Ils se refont à la
// prochaine compilation.
function retirerOut(racine, slug) {
  const out = path.join(racine, 'out', slug);
  try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* rien à retirer */ }
}

function ecrireOrdre(racine, slugs) {
  const chemin = path.join(racine, 'ausgabe.yaml');
  let contenu = '';
  try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
  const modifies = {};
  modifies[CLE_ORDRE] = slugs.join(', ');
  ecrireAtomique(chemin, serialiserAusgabe(contenu, modifies));
}

// Exécute les passes de dossiers, puis aligne les fichiers. -> le nombre de dossiers
// renommés, ou lève sur le premier refus du système de fichiers : un dossier tenu ouvert
// par Windows, une synchronisation en cours. On s'arrête là où ça coince, les temporaires
// restent, et reprendre() saura finir.
function executerPasses(base, passes) {
  let renommes = 0;
  for (const passe of passes) {
    for (const etape of passe) {
      const de = path.join(base, etape.de);
      const vers = path.join(base, etape.vers);
      if (!fs.existsSync(de)) { continue; }         // déjà passé : lot rejoué
      fs.renameSync(de, vers);
      renommes++;
    }
  }
  return renommes;
}

// renumeroter(racine, ordreVoulu) -> { erreur, renommes }
//
// `ordreVoulu` est la liste des slugs dans l'ordre voulu à l'écran, calculée par l'appelant
// avec la fonction qui décide déjà de l'ordre affiché. Rien n'est touché si le plan ne
// trouve rien à faire — pas même ausgabe.yaml, dont la date de modification est lue par la
// co-édition.
function renumeroter(racine, ordreVoulu, options) {
  const base = dossierUnites(racine, options);
  let plan;
  try {
    plan = planRenumerotation(listerUnites(racine, options), ordreVoulu);
  } catch (e) {
    return { erreur: String((e && e.message) || e), renommes: 0 };
  }
  if (!plan.aFaire) { return { erreur: null, renommes: 0 }; }
  try {
    const renommes = executerPasses(base, plan.passes);
    for (const r of plan.renommages) {
      alignerFichiers(base, r.vers);
      retirerOut(racine, r.de);
    }
    ecrireOrdre(racine, plan.renommages.length === 0 ? ordreVoulu
      : ordreVoulu.map((slug, i) => {
        const r = plan.renommages.find((x) => x.de === slug);
        return r ? r.vers : slug;
      }));
    return { erreur: null, renommes: renommes };
  } catch (e) {
    return { erreur: String((e && e.message) || e), renommes: 0 };
  }
}

// reprendre(racine) -> { erreur, renommes }. Termine un lot interrompu : les dossiers
// temporaires portent leur destination, il n'y a qu'à les y conduire, puis à aligner leurs
// fichiers et à réécrire l'ordre — que le lot d'origine n'avait, par construction, pas eu
// le temps d'écrire.
function reprendre(racine, options) {
  const base = dossierUnites(racine, options);
  let plan;
  try {
    plan = planReprise(sousDossiers(base));
  } catch (e) {
    return { erreur: String((e && e.message) || e), renommes: 0 };
  }
  if (!plan.aFaire) { return { erreur: null, renommes: 0 }; }
  try {
    const renommes = executerPasses(base, plan.passes);
    for (const etape of plan.passes[0]) { alignerFichiers(base, etape.vers); }
    // L'ordre, reconstruit depuis les dossiers eux-mêmes : leur préfixe EST le rang, c'est
    // tout l'intérêt de l'avoir écrit dans leur nom temporaire.
    ecrireOrdre(racine, sousDossiers(base).sort());
    return { erreur: null, renommes: renommes };
  } catch (e) {
    return { erreur: String((e && e.message) || e), renommes: 0 };
  }
}

module.exports = { listerUnites, repriseEnAttente, renumeroter, reprendre };
