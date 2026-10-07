// L'exécution du plan de renumérotation, sur le disque.
//
// Le plan vient de lib/renumerotation.js ; ce module renomme. Sans `vscode`, il se teste
// sur une vraie arborescence (test/js/renumerotation-fs.test.js). Les refus liés à
// l'interface (numéro verrouillé, compilation en cours, onglets ouverts) restent à
// l'appelant.
//
// Ordre des opérations :
//   1. les dossiers, en deux passes par un nom temporaire ;
//   2. les fichiers de chaque dossier, une fois celui-ci sous son nom définitif ;
//   3. les documents produits sous l'ancien nom, retirés ;
//   4. l'ordre du numéro, écrit en dernier.
//
// Écrit avant, l'ordre d'ausgabe.yaml désignerait des dossiers inexistants si le lot
// s'interrompait. Écrit en dernier, une interruption ne laisse que des dossiers
// temporaires, que reprendre() sait terminer.
'use strict';

const fs = require('fs');
const path = require('path');
const { planRenumerotation, planReprise, PREFIXE_TEMPO, tige } = require('./renumerotation');
const { serialiserAusgabe, ecrireAtomique } = require('./yaml');
const { CLE_ORDRE } = require('./articles');
const { nomFichierBiblio } = require('./citations');
const kirby = require('./kirby-contenu');

// Le contrat Kirby peut manquer (poste pas à jour, dépôt de test sans pipeline/kirby/) :
// une erreur de chargement ne doit pas empêcher de renuméroter un numéro sans
// Documentation. Seul appelant : estFichierPage.
function estFichierPage(nomFichier) {
  try { return kirby.estFichierPageDocumentation(nomFichier); }
  catch (e) { return false; }
}

function dossierUnites(racine, options) {
  return path.join(racine, (options && options.dossier) || 'articles');
}

function sousDossiers(base) {
  try {
    return fs.readdirSync(base, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (e) { return []; }
}

// Les articles tels que le plan les attend : nom de dossier et fichiers posés directement
// dedans. media/ et tables/ ne comptent pas : leur contenu est désigné en chemin relatif
// depuis le .md.
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

// La part « slug » d'un nom de fichier, avant le premier point. Elle doit suivre le nom du
// dossier : « 02-inclusion.meta.yaml » sous « 01-inclusion » ne serait pas lu.
function partSlug(nom) {
  const i = nom.indexOf('.');
  return i === -1 ? nom : nom.slice(0, i);
}

// Aligne les fichiers d'un dossier sur son nom, pour un renommage comme pour une reprise
// (qui ignore l'ancien nom) : un fichier suit si sa part « slug » a la même tige que le
// dossier mais un autre préfixe. Un fichier étranger (une note, un Word déposé à la main)
// n'a pas cette tige et reste tel quel.
//
// Le fichier de page d'une Documentation Kirby (documentation.<lang>.txt,
// lib/kirby-contenu.js) est exclu : son nom est fixe, mais dans un dossier nommé
// « documentation » (SLUG_DOCUMENTATION), sa tige coïncide et il serait renommé à tort.
//
// Le marqueur de bibliographie, qui nomme un fichier dans le texte du .md, est traité à
// part : voir reecrireMarqueurBiblio().
function alignerFichiers(base, nom) {
  let renommes = 0;
  const dossier = path.join(base, nom);
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (!entree.isFile()) { continue; }
    if (estFichierPage(entree.name)) { continue; }
    const part = partSlug(entree.name);
    if (part === nom || tige(part) !== tige(nom)) { continue; }
    fs.renameSync(path.join(dossier, entree.name),
      path.join(dossier, nom + entree.name.slice(part.length)));
    renommes++;
  }
  reparerMarqueurApresAlignement(dossier, nom);
  return renommes;
}

// ---- Marqueur de bibliographie ------------------------------------------------------
//
// L'import laisse dans le .md, à la place de la bibliographie détachée, le marqueur
// « ::: {.szh-biblio src="<slug>.biblio.md"} » (pipeline/filters/szh-biblio-detacher.lua).
// Le fichier <slug>.biblio.md est renommé avec les autres, mais le src= qui le nomme est du
// texte dans le .md : il faut le réécrire, sinon szh-citations.lua ne trouve plus la
// bibliographie.
//
// L'attribut d'un Div pandoc tient sur une ligne : le motif cherche `src="…"` sans
// franchir de retour à la ligne, et ne capture que la valeur. Le reste du texte, où le slug
// peut apparaître, n'est pas touché.
const MARQUEUR_BIBLIO_RE = /(\{[^{}\r\n]*\.szh-biblio\b[^{}\r\n]*\bsrc=")([^"]*)(")/;

// Réécrit, dans le .md à `cheminMd`, le src= du marqueur .szh-biblio pour qu'il nomme
// `versNom`. Rend true si le fichier a été réécrit. Sans marqueur, ou avec un marqueur
// déjà juste, rien n'est écrit : la co-édition lit la date de modification du .md.
function reecrireMarqueurBiblio(cheminMd, versNom) {
  let texte;
  try { texte = fs.readFileSync(cheminMd, 'utf8'); } catch (e) { return false; }
  const m = MARQUEUR_BIBLIO_RE.exec(texte);
  if (!m || m[2] === versNom) { return false; }
  const neuf = texte.slice(0, m.index) + m[1] + versNom + m[3]
    + texte.slice(m.index + m[0].length);
  ecrireAtomique(cheminMd, neuf);
  return true;
}

// Après l'alignement d'un dossier sur `nom`, réécrit son marqueur sur
// nomFichierBiblio(nom) s'il désigne encore l'ancien fichier. Rien à faire si ce fichier
// n'existe pas (dossier sans bibliographie).
function reparerMarqueurApresAlignement(dossier, nom) {
  const md = path.join(dossier, nom + '.md');
  const bib = nomFichierBiblio(nom);
  if (!fs.existsSync(md) || !fs.existsSync(path.join(dossier, bib))) { return; }
  reecrireMarqueurBiblio(md, bib);
}

// ---- Réparation des marqueurs périmés ----------------------------------------------
//
// Répare les marqueurs déjà faux sur le disque, hors de tout renommage : si le marqueur
// d'un article désigne un fichier absent et que le dossier contient exactement un
// `*.biblio.md`, c'est lui. Avec zéro ou plusieurs candidats, rien n'est changé, et
// szh-citations.lua signale « biblio-introuvable » à la compilation.
//
// Appelée par lancerBuild() (extension.js), par où passe toute compilation lancée depuis
// le cockpit.
function reparerMarqueursOrphelins(racine, options) {
  const base = dossierUnites(racine, options);
  let repares = 0;
  for (const nom of sousDossiers(base)) {
    if (nom.indexOf(PREFIXE_TEMPO) === 0) { continue; }     // lot en cours
    const dossier = path.join(base, nom);
    let texte;
    try { texte = fs.readFileSync(path.join(dossier, nom + '.md'), 'utf8'); }
    catch (e) { continue; }
    const m = MARQUEUR_BIBLIO_RE.exec(texte);
    if (!m) { continue; }                                  // pas de bibliographie détachée
    const nomme = m[2];
    if (nomme !== '' && fs.existsSync(path.join(dossier, nomme))) { continue; }   // marqueur sain
    let candidats;
    try {
      candidats = fs.readdirSync(dossier, { withFileTypes: true })
        .filter((e) => e.isFile() && /\.biblio\.md$/i.test(e.name)).map((e) => e.name);
    } catch (e) { continue; }
    if (candidats.length !== 1) { continue; }                // zéro ou plusieurs : on ne devine pas
    if (reecrireMarqueurBiblio(path.join(dossier, nom + '.md'), candidats[0])) { repares++; }
  }
  return repares;
}

// Retire les documents produits sous l'ancien nom, pour qu'un PDF périmé ne soit pas repris
// par l'export. La compilation suivante les refait.
function retirerOut(racine, slug) {
  const out = path.join(racine, 'out', slug);
  try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* rien à retirer */ }
}

// `options.config` nomme le fichier (ausgabe.yaml par défaut, buch.yaml pour un livre) et
// `options.cle` la clé de l'ordre (CLE_ORDRE par défaut, `ordre-chapitres` pour un livre).
// L'appelant les tire de profilCourant() (lib/profil.js) ; par défaut, ceux d'une revue.
function ecrireOrdre(racine, slugs, options) {
  const nomFichier = (options && options.config) || 'ausgabe.yaml';
  const cle = (options && options.cle) || CLE_ORDRE;
  const chemin = path.join(racine, nomFichier);
  let contenu = '';
  try { contenu = fs.readFileSync(chemin, 'utf8'); } catch (e) { /* absent : recréé plat */ }
  const modifies = {};
  modifies[cle] = slugs.join(', ');
  ecrireAtomique(chemin, serialiserAusgabe(contenu, modifies));
}

// Exécute les passes de dossiers, puis aligne les fichiers. -> le nombre de dossiers
// renommés. Lève au premier refus du système de fichiers (dossier ouvert par Windows,
// synchronisation en cours) : les temporaires restent, et reprendre() saura finir.
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
// `ordreVoulu` est la liste des slugs dans l'ordre affiché, calculée par l'appelant. Si le
// plan ne trouve rien à faire, rien n'est écrit, pas même ausgabe.yaml (la co-édition lit
// sa date de modification).
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
      }), options);
    return { erreur: null, renommes: renommes };
  } catch (e) {
    return { erreur: String((e && e.message) || e), renommes: 0 };
  }
}

// reprendre(racine) -> { erreur, renommes }. Termine un lot interrompu : les dossiers
// temporaires portent leur destination ; on les y renomme, on aligne leurs fichiers et on
// écrit l'ordre.
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
    // L'ordre se reconstruit depuis les préfixes des dossiers, qui sont leur rang.
    ecrireOrdre(racine, sousDossiers(base).sort(), options);
    return { erreur: null, renommes: renommes };
  } catch (e) {
    return { erreur: String((e && e.message) || e), renommes: 0 };
  }
}

// alignerFichiers sert aussi à lib/import-hote.js, qui préfixe les dossiers créés à
// l'import ; elle répare au passage le marqueur de bibliographie.
// reparerMarqueursOrphelins sert à lancerBuild() (extension.js).
module.exports = {
  listerUnites, repriseEnAttente, renumeroter, reprendre, alignerFichiers,
  reparerMarqueursOrphelins
};
