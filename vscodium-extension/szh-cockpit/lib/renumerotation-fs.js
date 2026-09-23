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
const { nomFichierBiblio } = require('./citations');
const kirby = require('./kirby-contenu');

// Un numéro sans Documentation n'a pas forcément le contrat déployé (poste pas encore mis
// à jour, dépôt de test sans pipeline/kirby/) : une exception à son chargement ne doit pas
// empêcher de renuméroter un numéro qui n'en a pas besoin — voir estFichierPage ci-dessous,
// seul appelant.
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
//
// ⚠ Le fichier de page d'une Documentation Kirby (documentation.<lang>.txt,
// lib/kirby-contenu.js) échappe à cette règle et doit être exclu EXPLICITEMENT : son nom
// est fixe, jamais celui du dossier — mais quand ce dossier s'appelle lui-même
// « documentation » (le nom par défaut, SLUG_DOCUMENTATION côté cockpit), sa tige coïncide
// avec celle du fichier de page, et la règle générale le prendrait pour un sidecar. Vérifié
// par un renommage réel qui le transformait en « 02-documentation.fr.txt » — un fichier que
// plus personne ne sait relire. Les dossiers de fiches (<n>_<slug>/) ne courent pas ce
// risque : ce sont des DOSSIERS, et la boucle ci-dessous ne touche qu'aux FICHIERS.
//
// Une fois les FICHIERS alignés, reste le marqueur — voir reecrireMarqueurBiblio()
// ci-dessous et le commentaire d'en-tête de lib/renumerotation.js (« CE QUI NE BOUGE
// PAS ») : lui seul désigne un sidecar par son nom, à l'intérieur du .md.
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

// ---- le marqueur de bibliographie, qui désigne son fichier par un nom portant le slug --
//
// alignerFichiers() ci-dessus renomme les FICHIERS d'un dossier ; il n'ouvre jamais aucun
// fichier pour regarder ce qu'il y a dedans. Un seul contenu échappe donc à la règle : le
// marqueur que l'import laisse dans le .md à la place de la bibliographie détachée
// (« ::: {.szh-biblio src="<slug>.biblio.md"} », pipeline/filters/szh-biblio-detacher.lua).
// <slug>.biblio.md suit comme n'importe quel sidecar — mais le src= qui le NOMME est du
// texte à l'intérieur du .md, pas un chemin relatif comme media/ ou tables/ (ceux-là ne
// portent jamais le slug). Sans ce qui suit, la bibliographie d'un article renommé désigne
// un fichier qui n'existe plus : szh-citations.lua la dit introuvable à la compilation,
// alors qu'elle est juste à côté, sous son nouveau nom.
//
// L'attribut d'un Div pandoc tient toujours sur une seule ligne, jamais coupé en cours de
// route : chercher `src="…"` sans franchir de retour à la ligne suffit à trouver LE
// marqueur, et évite de confondre avec un texte qui y ressemblerait ailleurs dans le
// corps — un extrait cité, une URL. Le motif ne capture QUE la valeur de l'attribut : on
// ne réécrit jamais le corps de l'article, où le slug peut très bien réapparaître, dans
// une légende ou un lien.
const MARQUEUR_BIBLIO_RE = /(\{[^{}\r\n]*\.szh-biblio\b[^{}\r\n]*\bsrc=")([^"]*)(")/;

// Réécrit, dans le .md à `cheminMd`, le src= du marqueur .szh-biblio pour qu'il nomme
// `versNom`. Rend true si le fichier a été réécrit. Deux gardes contre l'écriture
// inutile — pas de marqueur, ou marqueur déjà juste — sans quoi la date de modification du
// .md changerait pour rien à chaque renumérotation, alors que la co-édition la lit.
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

// Le marqueur d'un dossier qui vient d'être aligné sur `nom` : s'il désigne encore
// l'ancien fichier, il est réécrit sur nomFichierBiblio(nom) — celui-là existe forcément
// déjà sous ce nom, la boucle d'alignerFichiers() vient juste de l'y amener. On vérifie
// quand même son existence : un dossier sans bibliographie n'a ni marqueur ni fichier, et
// il n'y a alors rien à réparer, ni à inventer.
function reparerMarqueurApresAlignement(dossier, nom) {
  const md = path.join(dossier, nom + '.md');
  const bib = nomFichierBiblio(nom);
  if (!fs.existsSync(md) || !fs.existsSync(path.join(dossier, bib))) { return; }
  reecrireMarqueurBiblio(md, bib);
}

// ---- guérison des marqueurs déjà périmés, sans aucun renommage en cours ---------------
//
// Ce que reparerMarqueurApresAlignement() fait ci-dessus n'empêche qu'un NOUVEAU marqueur
// se périme ; il ne répare pas ceux qu'un numéro entier porte déjà sur le disque —
// importés, ou renumérotés, avant ce correctif. Cette fonction-là les guérit sans qu'on
// ait à toucher au numéro : si le marqueur d'un article désigne un fichier absent, et
// qu'il existe À CÔTÉ, dans le même dossier, exactement UN fichier `*.biblio.md`, c'est
// forcément lui. Zéro ou plusieurs candidats : on ne devine pas, et le constat existant
// (« biblio-introuvable », szh-citations.lua) continue de le dire à la compilation,
// exactement comme avant ce module.
//
// Où l'appeler, et pourquoi pas ailleurs : lancerBuild() (extension.js), le chemin unique
// de toute compilation déclenchée depuis le cockpit — pas reimporter.py --reprise, qui
// répare un tout autre accident (une bascule de réimport interrompue) et n'a jamais
// regardé le contenu d'un .md ; les mêler ferait porter à --reprise une responsabilité
// qui n'est pas la sienne, pour un défaut qu'il ne cause pas. Pas non plus le constat
// « biblio-inconnue » de lib/constats.js : il ne répare rien, il dit qu'on ne peut pas
// savoir si une bibliographie a été retouchée depuis l'import — une question différente,
// qui suppose déjà un marqueur qui se résout.
function reparerMarqueursOrphelins(racine, options) {
  const base = dossierUnites(racine, options);
  let repares = 0;
  for (const nom of sousDossiers(base)) {
    if (nom.indexOf(PREFIXE_TEMPO) === 0) { continue; }     // lot en cours : pas son tour
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

// Les documents produits sous l'ancien nom : les laisser ferait cohabiter deux PDF pour un
// même article, dont un périmé que l'export pourrait reprendre. Ils se refont à la
// prochaine compilation.
function retirerOut(racine, slug) {
  const out = path.join(racine, 'out', slug);
  try { fs.rmSync(out, { recursive: true, force: true }); } catch (e) { /* rien à retirer */ }
}

// `options.config` nomme le fichier (ausgabe.yaml par défaut, buch.yaml pour un livre) et
// `options.cle` la clé qui y porte l'ordre (CLE_ORDRE par défaut, `ordre-chapitres` pour un
// livre) — mêmes noms que la table de profils (lib/profil.js), que ce module ne peut pas
// importer sans dépendre de vscode par transitivité. L'appelant (extension.js) les tire de
// profilCourant() ; à défaut, le comportement d'une revue reste inchangé.
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
      }), options);
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
    ecrireOrdre(racine, sousDossiers(base).sort(), options);
    return { erreur: null, renommes: renommes };
  } catch (e) {
    return { erreur: String((e && e.message) || e), renommes: 0 };
  }
}

// alignerFichiers est exportée pour lib/import-hote.js : l'import préfixe les dossiers
// nouvellement créés (voir ce module), et un dossier renommé doit voir ses fichiers suivre
// exactement comme ici — recopier la boucle aurait fait vivre la même règle à deux endroits,
// avec le risque qu'ils divergent au prochain sidecar ajouté à la chaîne. Le marqueur de
// bibliographie suit avec elle (reparerMarqueurApresAlignement), pour que les trois
// appelants — « Terminer », la reprise d'un lot interrompu, et le préfixage à l'import —
// en profitent sans le réécrire trois fois. reparerMarqueursOrphelins est exportée pour
// extension.js (lancerBuild) : voir son commentaire ci-dessus.
module.exports = {
  listerUnites, repriseEnAttente, renumeroter, reprendre, alignerFichiers,
  reparerMarqueursOrphelins
};
