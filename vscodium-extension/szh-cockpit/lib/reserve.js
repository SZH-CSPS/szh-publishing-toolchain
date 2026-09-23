// La réserve de fiches : le magasin hors numéro où l'on met de côté une fiche de la
// Documentation (livre, film, intervention, recherche… — pipeline/kirby/champs-
// documentation.json) et le canal par lequel une fiche part vers l'autre revue pour
// traduction (cahier des charges, §4).
//
// Depuis que la Documentation est une arborescence Kirby (lib/kirby-contenu.js), une fiche
// est un DOSSIER — son <type>.<langue>.txt et son image éventuelle, ensemble — et non plus
// un seul bloc de texte. La réserve range donc des dossiers, un par fiche déposée, sous
// _reserve/<revue>/<horodatage>-<type>-<slug>/ :
//   - le contenu de la fiche, copié tel quel (voir deposer()) ;
//   - un sidecar `_origine.txt` qui porte les quatre clés du §4 (origine, numéro-origine,
//     à-traduire, déposé-le) — la fiche elle-même n'en sait rien, ce sidecar est propre à
//     la réserve.
//
// Deux gestes, une seule mécanique de dépôt :
//   « Détacher »                -> le dossier quitte l'article, atterrit dans la réserve de
//                                   la revue courante, a-traduire: false, même langue.
//   « Envoyer à l'autre revue » -> le dossier reste dans l'article, une COPIE atterrit dans
//                                   la réserve de l'autre revue, a-traduire: true, avec un
//                                   Uuid neuf et son fichier de contenu renommé
//                                   <type>.<autre-langue>.txt — le texte n'est PAS traduit
//                                   (ni les jetons de liste, ni la prose), seul le fichier
//                                   qui le porte change de nom pour se ranger dans l'arbre
//                                   de l'autre revue.
// Ce module ne sait pas lequel des deux gestes est en cours : il ne fait que copier,
// lister et retirer un dossier de réserve. La différence entre les deux (langue cible,
// à-traduire) est un choix de l'appelant.
//
// ⚠ Frontière : ce module ne modifie jamais l'arborescence d'un article. Retirer la fiche
// de l'article (le geste « détacher ») est le travail de lib/kirby-contenu.js
// (retirerFiche), appelé ailleurs, avant ou après l'appel à deposer() selon ce que
// l'appelant a décidé.
//
// ⚠ Pur, comme lib/kirby-contenu.js et lib/profil.js : aucun require('vscode').
'use strict';

const fs = require('fs');
const path = require('path');
const { slugifier } = require('./slug');
const kirby = require('./kirby-contenu');

// Le dossier qui porte toutes les réserves, à la racine du parent du numéro (voir
// cheminReserve). Un seul nom, jamais recopié en dur ailleurs dans ce fichier.
const NOM_DOSSIER = '_reserve';

// Le sidecar d'origine, à l'intérieur du dossier de chaque fiche déposée — propre à la
// réserve, jamais copié dans un article.
const NOM_SIDECAR = '_origine.txt';

// Les deux seuls jetons de revue que le cockpit connaît (lib/liens.js: PRODUITS,
// lib/yaml.js: REVUES, lib/archivage.js: MAILS_TRADUCTION portent déjà ces deux mots).
const REVUES = ['revue', 'zeitschrift'];
const LANGUE_DE_REVUE = { revue: 'fr', zeitschrift: 'de' };

// L'autre revue, pour « Envoyer vers l'autre revue » : une Zeitschrift envoie vers la
// Revue et réciproquement. Une valeur qui n'est ni l'une ni l'autre rend null : à
// l'appelant de refuser le geste plutôt que d'écrire dans un dossier au nom inventé.
function autreRevue(revue) {
  const r = String(revue === undefined || revue === null ? '' : revue).toLowerCase();
  if (r === 'revue') { return 'zeitschrift'; }
  if (r === 'zeitschrift') { return 'revue'; }
  return null;
}

// cheminReserve(racineNumero, revue) -> chemin absolu du dossier de réserve de cette revue.
// Posée au niveau du parent du numéro — voir l'en-tête de lib/documentation-hote.js pour
// pourquoi : un numéro est archivé, renommé, voire supprimé en fin de cycle, alors qu'une
// fiche mise de côté doit lui survivre.
function cheminReserve(racineNumero, revue) {
  const parent = path.dirname(path.resolve(String(racineNumero === undefined || racineNumero === null ? '' : racineNumero)));
  return path.join(parent, NOM_DOSSIER, String(revue === undefined || revue === null ? '' : revue));
}

// ---- Sidecar d'origine ------------------------------------------------------------
//
// Même forme clé:valeur que serialiserFiche() portait autrefois en frontmatter d'un bloc
// unique — sans le bloc, puisque le contenu de la fiche vit maintenant dans son propre
// <type>.<langue>.txt, à côté.
function citerYaml(v) {
  return '"' + String(v === undefined || v === null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}
function serialiserOrigine(o) {
  const f = o || {};
  return [
    'origine: ' + String(f.origine === undefined || f.origine === null ? '' : f.origine),
    'numero-origine: ' + citerYaml(f.numeroOrigine),
    'a-traduire: ' + (f.aTraduire ? 'true' : 'false'),
    'depose-le: ' + citerYaml(f.deposeLe)
  ].join('\n') + '\n';
}
function devaleurYaml(brut) {
  const t = String(brut === undefined || brut === null ? '' : brut).trim();
  if (t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}
function analyserOrigine(texte) {
  const repli = { origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '' };
  const src = String(texte === undefined || texte === null ? '' : texte);
  const paires = {};
  for (const ligne of src.split('\n')) {
    const m = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) { paires[m[1]] = m[2]; }
  }
  return {
    origine: devaleurYaml(paires['origine']) || repli.origine,
    numeroOrigine: devaleurYaml(paires['numero-origine']) || repli.numeroOrigine,
    aTraduire: devaleurYaml(paires['a-traduire']).toLowerCase() === 'true',
    deposeLe: devaleurYaml(paires['depose-le']) || repli.deposeLe
  };
}

// ---- Nom du dossier d'une fiche déposée -------------------------------------------
function segmentAssaini(valeur) {
  return slugifier(String(valeur === undefined || valeur === null ? '' : valeur).replace(/\./g, ' '));
}
function pad(n, largeur) { return String(n).padStart(largeur, '0'); }
// Horodatage compact, à la milliseconde, dont l'ordre alphabétique est l'ordre
// chronologique : c'est lui qui porte toute l'unicité du nom de dossier et tout le tri de
// lister().
function horodatage(quand) {
  const d = (quand instanceof Date && !isNaN(quand.getTime())) ? quand : new Date();
  return pad(d.getFullYear(), 4) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + '-' +
    pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2) + pad(d.getMilliseconds(), 3);
}
// nomDossierFiche(type, titre, quand) -> nom de dossier, sans extension (une fiche est un
// dossier, plus un fichier .md).
function nomDossierFiche(type, titre, quand) {
  return horodatage(quand) + '-' + segmentAssaini(type) + '-' + segmentAssaini(titre);
}

// ---- Écrire, lister, retirer --------------------------------------------------------

// deposer(racineNumero, revue, fiche) -> { chemin }
//
// `fiche` porte :
//   * `dossierSource` : le dossier réel de la fiche dans l'article (kirby-contenu.js,
//     entrée `.dossier` de listerFiches()) — copié tel quel (contenu ET image) ;
//   * `type`, `titre` : pour nommer le dossier de réserve (voir nomDossierFiche) ;
//   * `langueSource` : la langue du fichier <type>.<langue>.txt à l'intérieur de
//     `dossierSource` ;
//   * `langueCible` (facultative, = langueSource par défaut) : si elle diffère, le fichier
//     de contenu copié est renommé <type>.<langueCible>.txt — c'est tout ce que
//     « Envoyer à l'autre revue » change au contenu lui-même ;
//   * `origine`, `numeroOrigine`, `aTraduire`, `deposeLe` : le sidecar (voir plus haut) ;
//   * `quand` (facultative) : Date de l'horodatage du nom de dossier.
//
// Un Uuid neuf est toujours posé dans la copie — une fiche de réserve n'est jamais le même
// enregistrement Kirby que celui resté (ou non) dans l'article d'origine, même quand le
// geste est « Détacher » et qu'aucune fiche ne reste en place : reprise en réserve, puis
// réinsertion, doit pouvoir se faire sans jamais risquer deux pages du même Uuid.
//
// Crée l'arborescence de la réserve à la demande (mkdirSync récursif) : c'est la seule des
// trois fonctions qui touchent le disque à le faire, lister() ne la crée jamais.
function deposer(racineNumero, revue, fiche) {
  const f = fiche || {};
  const racineReserve = cheminReserve(racineNumero, revue);
  fs.mkdirSync(racineReserve, { recursive: true });

  const quand = (f.quand instanceof Date && !isNaN(f.quand.getTime())) ? f.quand : new Date();
  const nom = nomDossierFiche(f.type, f.titre, quand);
  const chemin = path.join(racineReserve, nom);
  if (fs.existsSync(chemin)) {
    throw new Error('deposer : « ' + nom + ' » existe déjà dans la réserve.');
  }
  fs.cpSync(f.dossierSource, chemin, { recursive: true });

  const langueSource = f.langueSource;
  const langueCible = f.langueCible || langueSource;
  const nomAncien = f.type + '.' + langueSource + '.txt';
  const nomNeuf = f.type + '.' + langueCible + '.txt';
  const cheminTxt = path.join(chemin, nomAncien);
  let brut = '';
  try { brut = fs.readFileSync(cheminTxt, 'utf8'); } catch (e) { /* copie incomplète : rien à réécrire */ }
  if (brut !== '') {
    const relu = kirby.lireTxt(brut);
    const texteNeuf = kirby.ecrireTxt({
      title: relu.title, uuid: kirby.genererUuid(),
      champs: Object.keys(relu.champs).map((cle) => ({ cle: cle, valeurBrute: relu.champs[cle], forcerMultiligne: relu.champs[cle].indexOf('\n') !== -1 }))
    });
    if (nomNeuf !== nomAncien) { try { fs.unlinkSync(cheminTxt); } catch (e) { /* absent */ } }
    fs.writeFileSync(path.join(chemin, nomNeuf), texteNeuf, 'utf8');
  }

  fs.writeFileSync(path.join(chemin, NOM_SIDECAR), serialiserOrigine({
    origine: f.origine, numeroOrigine: f.numeroOrigine, aTraduire: f.aTraduire, deposeLe: f.deposeLe
  }), 'utf8');

  return { chemin: chemin };
}

// lister(racineNumero, revue) -> [{ chemin, nom, fiche }], du plus récent au plus ancien.
// `fiche` = { origine, numeroOrigine, aTraduire, deposeLe, type, titre, langue, uuid,
// dossier }, lu depuis le sidecar et le <type>.<langue>.txt qu'il contient.
//
// Un dossier absent rend [] : ce n'est pas une erreur — une réserve qui n'a encore jamais
// reçu de dépôt n'existe simplement pas encore sur le disque.
function lister(racineNumero, revue) {
  const racineReserve = cheminReserve(racineNumero, revue);
  let entrees;
  try { entrees = fs.readdirSync(racineReserve, { withFileTypes: true }); }
  catch (e) { return []; }

  const res = entrees
    .filter((e) => e.isDirectory())
    .map((e) => {
      const chemin = path.join(racineReserve, e.name);
      let origine = { origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '' };
      try { origine = analyserOrigine(fs.readFileSync(path.join(chemin, NOM_SIDECAR), 'utf8')); }
      catch (err) { /* sidecar absent : replis */ }
      let type = '', langue = '', titre = '', uuid = '';
      try {
        const fichiers = fs.readdirSync(chemin);
        const txt = fichiers.find((n) => /\.[a-z]{2}\.txt$/.test(n));
        if (txt) {
          const m = txt.match(/^(.+)\.([a-z]{2})\.txt$/);
          type = m[1]; langue = m[2];
          const relu = kirby.lireTxt(fs.readFileSync(path.join(chemin, txt), 'utf8'));
          titre = relu.title; uuid = relu.uuid;
        }
      } catch (err) { /* dossier trafiqué : les champs restent vides */ }
      return { chemin: chemin, nom: e.name, fiche: Object.assign({}, origine, { type, langue, titre, uuid }) };
    });
  res.sort((a, b) => (a.nom < b.nom ? 1 : a.nom > b.nom ? -1 : 0));
  return res;
}

// retirer(chemin) -> booléen. Ôte le dossier entier — contenu et image. Faux si le dossier
// n'existe déjà plus : un second clic sur « Retirer » ne doit pas lever.
function retirer(chemin) {
  try {
    if (!fs.existsSync(chemin)) { return false; }
    fs.rmSync(chemin, { recursive: true, force: true });
    return true;
  } catch (e) { return false; }
}

module.exports = {
  NOM_DOSSIER, NOM_SIDECAR, REVUES, LANGUE_DE_REVUE,
  autreRevue, cheminReserve,
  serialiserOrigine, analyserOrigine,
  nomDossierFiche,
  deposer, lister, retirer
};
