// La réserve de fiches : le magasin HORS NUMÉRO où l'on met de côté une fiche structurée
// (livre, film, intervention, recherche, revue-soeur — lib/ressources.js) et le canal par
// lequel une fiche part vers l'autre revue pour traduction (cahier des charges, §4).
//
// Deux gestes, une seule mécanique d'écriture :
//   « Détacher »            -> le bloc quitte l'article, atterrit dans LA RÉSERVE DE LA
//                               revue courante, a-traduire: false (rien à traduire : la
//                               fiche reste dans sa langue d'origine, simplement rangée).
//   « Envoyer à l'autre revue » -> le bloc RESTE dans l'article, une COPIE atterrit dans la
//                               réserve de l'AUTRE revue, a-traduire: true.
// Ce module ne sait pas lequel des deux gestes est en cours : il ne fait qu'écrire, lister
// et retirer un fichier de réserve. La différence entre les deux (a-traduire, quelle
// réserve) est un choix de l'appelant, posé dans le `fiche` qu'il passe à deposer().
//
// ⚠ FRONTIÈRE : ce module ne modifie JAMAIS le .md d'un article. Retirer le bloc de
// l'article (le geste « détacher ») est le travail de lib/ressources.js
// (retirerRessource), appelé ailleurs, avant ou après l'appel à deposer() selon ce que
// l'appelant a décidé. Séparer les deux garde chaque module à une seule responsabilité :
// celui-ci ignore tout du format d'un article, l'autre ignore tout de la réserve.
//
// ⚠ PUR, comme lib/profil.js et lib/slug.js : aucun require('vscode'). Seuls fs et path
// portent ses écritures, et lib/slug.js son assainisseur de noms de fichier (voir
// nomFichierFiche) — c'est ce qui rend le tout exerçable par `node --test` sans hôte.
'use strict';

const fs = require('fs');
const path = require('path');
const { slugifier } = require('./slug');

// Le dossier qui porte toutes les réserves, à la racine du parent du numéro (voir
// cheminReserve). Un seul nom, jamais recopié en dur ailleurs dans ce fichier.
const NOM_DOSSIER = '_reserve';

// Les deux seuls jetons de revue que le cockpit connaît (lib/liens.js: PRODUITS,
// lib/yaml.js: REVUES, lib/archivage.js: MAILS_TRADUCTION portent déjà ces deux mots).
// Redéclarés ici plutôt qu'importés : ce module n'a que fs et path en dépendance, et ces
// deux chaînes ne bougent pas assez souvent pour valoir une dépendance croisée de plus.
const REVUES = ['revue', 'zeitschrift'];

// L'autre revue, pour « Envoyer vers l'autre revue » : une Zeitschrift envoie vers la
// Revue et réciproquement. Une valeur qui n'est ni l'une ni l'autre — jeton corrompu,
// numéro sans revue déclarée — rend null : à l'appelant de refuser le geste plutôt que
// d'écrire dans un dossier au nom inventé.
function autreRevue(revue) {
  const r = String(revue === undefined || revue === null ? '' : revue).toLowerCase();
  if (r === 'revue') { return 'zeitschrift'; }
  if (r === 'zeitschrift') { return 'revue'; }
  return null;
}

// cheminReserve(racineNumero, revue) -> chemin absolu du dossier de réserve de cette revue.
//
// Posée au niveau du PARENT du numéro, jamais dans le numéro lui-même : un numéro est
// archivé, renommé, voire supprimé en fin de cycle (lib/archivage.js), alors qu'une fiche
// mise de côté doit lui survivre. Le parent est aussi le niveau où vivent les dossiers de
// numéro voisins dans l'arborescence SharePoint/OneDrive commune aux deux rédactions :
// une fiche déposée ici est donc déjà partagée entre collègues, sans geste de plus.
//
// N'existe pas forcément sur le disque : voir deposer() (qui la crée) et lister() (qui ne
// la crée jamais).
function cheminReserve(racineNumero, revue) {
  const parent = path.dirname(path.resolve(String(racineNumero === undefined || racineNumero === null ? '' : racineNumero)));
  return path.join(parent, NOM_DOSSIER, String(revue === undefined || revue === null ? '' : revue));
}

// ---- Frontmatter d'une fiche de réserve -------------------------------------------
//
// Les quatre clés du §4, DANS CET ORDRE — origine, numero-origine, a-traduire, depose-le
// — devant le bloc tel qu'il vivait dans l'article. `origine` et `a-traduire` s'écrivent
// nus (un jeton, un booléen : rien à échapper) ; `numero-origine` et `depose-le` entre
// guillemets, comme le reste du dépôt écrit ses valeurs de chaîne (voir citerValeur dans
// lib/ressources.js) — un numéro de type « R2026-2 » ou une date ISO n'ont besoin de rien
// de plus qu'un antislash et un guillemet échappés.
function citerYaml(v) {
  return '"' + String(v === undefined || v === null ? '' : v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// serialiserFiche({ origine, numeroOrigine, aTraduire, deposeLe, bloc }) -> texte
//
// ⚠ Le texte produit se termine par EXACTEMENT UN retour à la ligne après le bloc, quel
// que soit son propre contenu (qu'il se termine déjà par un retour à la ligne ou non).
// C'est ce qui rend l'aller-retour avec analyserFiche fidèle au caractère près : celle-ci
// n'a qu'à ôter le DERNIER retour à la ligne du texte pour retrouver le bloc tel qu'il
// a été donné ici, sans jamais avoir à deviner s'il en portait déjà un.
function serialiserFiche(fiche) {
  const f = fiche || {};
  const origine = String(f.origine === undefined || f.origine === null ? '' : f.origine);
  const aTraduire = !!f.aTraduire;
  const numeroOrigine = String(f.numeroOrigine === undefined || f.numeroOrigine === null ? '' : f.numeroOrigine);
  const deposeLe = String(f.deposeLe === undefined || f.deposeLe === null ? '' : f.deposeLe);
  const bloc = String(f.bloc === undefined || f.bloc === null ? '' : f.bloc);
  const entete = [
    '---',
    'origine: ' + origine,
    'numero-origine: ' + citerYaml(numeroOrigine),
    'a-traduire: ' + (aTraduire ? 'true' : 'false'),
    'depose-le: ' + citerYaml(deposeLe),
    '---'
  ].join('\n');
  return entete + '\n' + bloc + '\n';
}

// Une valeur de frontmatter -> chaîne nue : ôte les guillemets d'une valeur citée (et
// dé-échappe \" et \\, symétrique de citerYaml), sinon rend le jeton tel quel (cas
// `origine: revue`, jamais cité). Absente -> chaîne vide, jamais undefined : une fiche de
// réserve n'a rien à deviner de plus que ce que le formulaire lui demandera.
function devaleurYaml(brut) {
  const t = String(brut === undefined || brut === null ? '' : brut).trim();
  if (t.length >= 2 && t.charAt(0) === '"' && t.charAt(t.length - 1) === '"') {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return t;
}
function devaleurBooleenne(brut) { return devaleurYaml(brut).toLowerCase() === 'true'; }

// analyserFiche(texte) -> { origine, numeroOrigine, aTraduire, deposeLe, bloc }
//
// TOLÉRANT, à dessein : une réserve n'est pas un format d'échange machine, c'est un
// dossier qu'un collègue peut ouvrir, corriger ou vider à la main. Trois dégradations
// couvertes, chacune rendant quand même un objet exploitable :
//   * pas de frontmatter du tout (fichier composé à la main) -> les quatre clés
//     retombent sur leur valeur de repli, `bloc` reçoit alors TOUT le texte ;
//   * frontmatter jamais refermé (un « --- » de tête oublié de sa paire) -> même repli,
//     par prudence : mieux vaut montrer tout le texte que d'en perdre un bout en
//     devinant une fermeture qui n'existe pas ;
//   * clés inconnues ou en trop dans le frontmatter -> ignorées, les quatre attendues
//     sont lues où qu'elles soient parmi les lignes.
//
// ⚠ Le bloc peut lui-même contenir une ligne qui vaut exactement « --- » (un bloc de
// ressource écrit à la main avec une note bibliographique en trois tirets, par exemple) :
// ça ne perturbe pas la lecture, puisqu'on s'arrête à la PREMIÈRE ligne « --- » rencontrée
// après l'ouverture — nécessairement la fermeture posée par serialiserFiche, jamais une
// occurrence plus loin dans le bloc, qu'on n'a pas encore atteinte à ce moment du scan.
function analyserFiche(texte) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const repli = { origine: '', numeroOrigine: '', aTraduire: false, deposeLe: '', bloc: src };

  const finLigne1 = src.indexOf('\n');
  if (finLigne1 === -1) { return repli; }
  let ligne1 = src.slice(0, finLigne1);
  if (ligne1.charAt(ligne1.length - 1) === '\r') { ligne1 = ligne1.slice(0, -1); }
  if (ligne1.trim() !== '---') { return repli; }

  const paires = {};
  let position = finLigne1 + 1;
  while (position <= src.length) {
    const finLigne = src.indexOf('\n', position);
    const brute = finLigne === -1 ? src.length : finLigne;
    let ligne = src.slice(position, brute);
    if (ligne.charAt(ligne.length - 1) === '\r') { ligne = ligne.slice(0, -1); }
    if (ligne.trim() === '---') {
      let reste = finLigne === -1 ? '' : src.slice(finLigne + 1);
      // Le seul retour à la ligne que serialiserFiche ajoute après le bloc : on l'ôte
      // pour retrouver le bloc au caractère près (voir le commentaire de serialiserFiche).
      if (reste.charAt(reste.length - 1) === '\n') { reste = reste.slice(0, -1); }
      return {
        origine: devaleurYaml(paires['origine']),
        numeroOrigine: devaleurYaml(paires['numero-origine']),
        aTraduire: devaleurBooleenne(paires['a-traduire']),
        deposeLe: devaleurYaml(paires['depose-le']),
        bloc: reste
      };
    }
    const cle = ligne.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (cle) { paires[cle[1]] = cle[2]; }
    if (finLigne === -1) { break; }              // jamais refermé : on retombe sur repli
    position = finLigne + 1;
  }
  return repli;
}

// ---- Nom de fichier d'une fiche déposée -------------------------------------------

// Un segment de nom de fichier sûr et non vide, à partir d'un texte quelconque (type ou
// titre) : réutilise l'assainisseur de lib/slug.js — translittération, minuscules,
// non-alphanumérique -> tiret — plutôt que d'en écrire un second dans ce module.
//
// ⚠ slugifier() est taillée pour un nom de FICHIER : elle ampute tout ce qui suit le
// DERNIER point, croyant lire une extension (« Titre.docx » -> « Titre »). Un titre de
// fiche n'en a pas, et un point qu'il porterait légitimement (« Dr. Strangelove », des
// points de suspension) serait pris à tort pour une extension et perdu. On neutralise
// donc les points en amont — ils deviennent un tiret comme n'importe quel autre séparateur,
// au lieu de déclencher l'amputation.
function segmentAssaini(valeur) {
  return slugifier(String(valeur === undefined || valeur === null ? '' : valeur).replace(/\./g, ' '));
}

function pad(n, largeur) { return String(n).padStart(largeur, '0'); }

// Horodatage compact, à la milliseconde, dont l'ordre alphabétique EST l'ordre
// chronologique (largeurs fixes, du plus au moins significatif) : c'est lui qui porte
// toute l'unicité du nom de fichier (voir nomFichierFiche) et tout le tri de lister().
function horodatage(quand) {
  const d = (quand instanceof Date && !isNaN(quand.getTime())) ? quand : new Date();
  return pad(d.getFullYear(), 4) + pad(d.getMonth() + 1, 2) + pad(d.getDate(), 2) + '-' +
    pad(d.getHours(), 2) + pad(d.getMinutes(), 2) + pad(d.getSeconds(), 2) + pad(d.getMilliseconds(), 3);
}

// nomFichierFiche(type, titre, quand) -> nom de fichier .md
//
// Horodatage de tête (tri = chronologie, voir horodatage()), puis type et titre assainis :
// deux dépôts du même livre le même jour ne s'écrasent pas tant qu'ils n'arrivent pas à la
// MÊME milliseconde — en pratique jamais pour un geste humain (« Détacher », « Envoyer »),
// chacun un clic distinct. deposer() n'écrit de toute façon jamais par-dessus un fichier
// existant (voir son commentaire) : une collision, aussi improbable soit-elle, lève plutôt
// que d'effacer une fiche déjà en réserve.
function nomFichierFiche(type, titre, quand) {
  return horodatage(quand) + '-' + segmentAssaini(type) + '-' + segmentAssaini(titre) + '.md';
}

// ---- Image d'une fiche déposée -----------------------------------------------------

// Le nom voulu pour la copie, ramené à un simple nom de fichier — jamais un chemin : une
// image dont le nom voulu porterait des séparateurs (chemin recopié tel quel par
// mégarde par l'appelant) ne doit pas pouvoir viser un dossier hors de la réserve.
// Vide ou absent -> repli sur l'extension de la source, pour ne jamais écrire un fichier
// sans nom.
function nomImageVoulu(image) {
  const brut = path.basename(String((image && image.nom) || '').replace(/\\/g, '/')).trim();
  if (brut !== '') { return brut; }
  const ext = path.extname(String((image && image.source) || '')) || '.jpg';
  return 'image' + ext;
}

// Le premier nom libre dans `dossier`, en partant de `nom` : même règle que
// nomMediaLibre() de lib/medias.js, dupliquée ici plutôt qu'importée — ce module n'a que
// fs, path et lib/slug.js en dépendance (voir l'en-tête), et ces cinq lignes ne valent pas
// une dépendance de plus vers un module que rien d'autre ici n'utilise.
function nomLibre(dossier, nom) {
  const point = nom.lastIndexOf('.');
  const base = point === -1 ? nom : nom.slice(0, point);
  const ext = point === -1 ? '' : nom.slice(point);
  let candidat = nom;
  let i = 1;
  while (fs.existsSync(path.join(dossier, candidat))) { candidat = base + '-' + i + ext; i++; }
  return candidat;
}

// Le bloc d'une fiche écrit son image en `media/xxx.jpg` (lib/ressources.js,
// blocRessource) parce que dans un article, l'image vit dans le sous-dossier media/ à
// côté du .md. La réserve REPRODUIT ce sous-dossier — `_reserve/<revue>/media/` — et le
// bloc garde donc son préfixe `media/`.
//
// ⚠ Ce n'est pas un détail d'esthétique, c'est une condition de relecture. lireRessources()
//   (lib/ressources.js) ne reconnaît une image QUE si sa cible commence par `media/` :
//   toute autre forme retombe dans le descriptif. Une réserve qui aurait posé l'image à
//   plat, à côté du .md, aurait donc rendu ses propres blocs illisibles par le module même
//   qui les a écrits — la fiche revenait sans son image et avec une ligne `![](…)` collée
//   dans son texte. Constaté sur un aller-retour réel, pas déduit.
//   Seul le NOM de fichier est donc réécrit ici, et seulement s'il a changé (nomLibre).
const RE_IMAGE_MEDIA = /(!\[[^\]]*\]\()media\/([^()\s]+)((?:\s+"[^"]*")?\)(?:\{[^}]*\})?)/;
function reecrireImageDuBloc(bloc, nomImageFinal) {
  const src = String(bloc === undefined || bloc === null ? '' : bloc);
  if (!RE_IMAGE_MEDIA.test(src)) { return src; }
  return src.replace(RE_IMAGE_MEDIA, '$1media/' + nomImageFinal + '$3');
}

// ---- Écrire, lister, retirer --------------------------------------------------------

// deposer(racineNumero, revue, fiche) -> { chemin }
//
// `fiche` porte les quatre champs de serialiserFiche (origine, numeroOrigine, aTraduire,
// deposeLe, bloc), plus `type` et `titre` (pour nommer le fichier — voir
// nomFichierFiche), plus deux champs optionnels :
//   * `quand` : Date de l'horodatage du nom de fichier ; à défaut, l'instant présent ;
//   * `image` : { source, nom } — voir plus bas.
//
// Crée l'arborescence de la réserve À LA DEMANDE (mkdirSync récursif) : c'est la seule
// des deux fonctions qui touchent le disque à le faire, lister() ne la crée jamais (voir
// son commentaire) — sans quoi consulter une réserve vide en créerait une.
//
// N'écrase JAMAIS un fichier existant (drapeau 'wx') : une collision de nom, aussi
// improbable soit-elle (voir nomFichierFiche), doit lever plutôt qu'effacer une fiche déjà
// déposée par quelqu'un d'autre — cette réserve est un dossier OneDrive partagé.
//
// Pourquoi une COPIE de l'image, jamais un déplacement : ce module ne sait pas, et n'a
// pas à savoir, si l'appelant est en train de « détacher » (le bloc quitte l'article :
// l'image d'origine pourrait, ou non, être nettoyée par l'appelant) ou d'« envoyer vers
// l'autre revue » (le bloc RESTE dans l'article, avec sa propre image intacte dans
// articles/<slug>/media/ — la lui retirer casserait l'article resté en place). Le seul
// choix qui marche dans les deux cas sans que ce module ait à les distinguer est de ne
// jamais toucher au fichier source. Même parti que retirerRessource() dans
// lib/ressources.js : le texte peut changer, le disque ne perd rien tout seul.
function deposer(racineNumero, revue, fiche) {
  const f = fiche || {};
  const dossier = cheminReserve(racineNumero, revue);
  fs.mkdirSync(dossier, { recursive: true });

  const quand = (f.quand instanceof Date && !isNaN(f.quand.getTime())) ? f.quand : new Date();
  const nom = nomFichierFiche(f.type, f.titre, quand);
  const chemin = path.join(dossier, nom);

  let bloc = f.bloc;
  if (f.image && f.image.source) {
    // media/ à côté du .md, comme dans un article : voir reecrireImageDuBloc().
    const dossierMedia = path.join(dossier, 'media');
    fs.mkdirSync(dossierMedia, { recursive: true });
    const voulu = nomImageVoulu(f.image);
    const nomImageFinal = nomLibre(dossierMedia, voulu);
    fs.copyFileSync(f.image.source, path.join(dossierMedia, nomImageFinal));
    bloc = reecrireImageDuBloc(bloc, nomImageFinal);
  }

  fs.writeFileSync(chemin, serialiserFiche(Object.assign({}, f, { bloc })),
    { encoding: 'utf8', flag: 'wx' });
  return { chemin };
}

// lister(racineNumero, revue) -> [{ chemin, nom, fiche }], du plus récent au plus ancien.
//
// Un dossier absent rend [] : ce n'est PAS une erreur — une réserve qui n'a encore jamais
// reçu de dépôt n'existe simplement pas encore sur le disque (voir deposer(), seule à la
// créer). Un dossier illisible pour toute autre raison se comporte de même : la réserve
// est un outil de confort, jamais un chemin qui doit pouvoir faire échouer l'ouverture
// du numéro.
//
// Le tri se fait sur le NOM de fichier, pas sur `fiche.deposeLe` : nomFichierFiche()
// commence par un horodatage à la milliseconde (voir son commentaire), donc l'ordre
// alphabétique déjà DESCENDANT du nom est l'ordre chronologique inverse voulu — nul besoin
// de reparser une date, y compris pour un fichier dont le frontmatter aurait été trafiqué.
function lister(racineNumero, revue) {
  const dossier = cheminReserve(racineNumero, revue);
  let entrees;
  try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); }
  catch (e) { return []; }

  const res = entrees
    .filter((e) => e.isFile() && /\.md$/i.test(e.name))
    .map((e) => {
      const chemin = path.join(dossier, e.name);
      let texte = '';
      try { texte = fs.readFileSync(chemin, 'utf8'); } catch (err) { /* disparu entre-temps */ }
      return { chemin: chemin, nom: e.name, fiche: analyserFiche(texte) };
    });
  res.sort((a, b) => (a.nom < b.nom ? 1 : a.nom > b.nom ? -1 : 0));
  return res;
}

// retirer(chemin) -> booléen
//
// Ôte le SEUL fichier .md donné — jamais une image voisine qu'il référencerait : même
// parti que retirerRessource() dans lib/ressources.js, qui ne supprime pas non plus le
// fichier de couverture d'une fiche qu'elle retire du texte. `retirer` ne reçoit d'ailleurs
// qu'un chemin, pas une fiche : il ne pourrait pas deviner le nom de l'image même s'il le
// voulait. Faux si le fichier n'existe déjà plus (ou jamais existé) : un second clic sur
// « Retirer » ne doit pas lever.
function retirer(chemin) {
  try { fs.unlinkSync(chemin); return true; }
  catch (e) { return false; }
}

module.exports = {
  NOM_DOSSIER, REVUES,
  autreRevue, cheminReserve,
  serialiserFiche, analyserFiche,
  nomFichierFiche,
  deposer, lister, retirer
};
