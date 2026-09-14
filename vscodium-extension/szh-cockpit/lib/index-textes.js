// Retrouver la CLÉ i18n d'un texte lu à l'écran : l'index du mode « Trad ».
//
// Le problème. Une webview ne reçoit que des chaînes : `T('regl.titre')` est résolu par
// l'hôte à l'assemblage de la page, et la clé est perdue en route. Le mode « Trad » rend
// un clic sur un libellé de l'interface ; pour que la suggestion serve à quelque chose,
// elle doit dire DE QUELLE clé on parle — sinon un mainteneur relit un texte qu'il devra
// retrouver à la main dans 1266 libellés.
//
// La réponse : un index à l'envers, construit depuis la table de la langue courante
// (TEXTES_COCKPIT de lib/i18n.js), qui rend les clés candidates d'un texte affiché.
//
// Trois cas, mesurés sur les textes réels :
//   * le texte est celui d'un libellé, mot pour mot -> une clé, la bonne ;
//   * le libellé porte un TROU ({0}, {1}…) et l'écran montre le texte rempli — « Volume 44 »
//     pour « Volume {0} » : il faut alors reconnaître le MOTIF ;
//   * deux libellés différents portent le même texte (« Titre », « Annuler »…) -> plusieurs
//     candidates, que seul l'humain devant le formulaire peut départager.
// Et un quatrième, qui n'est pas un échec : rien ne correspond. Le formulaire s'ouvre quand
// même sur le texte littéral — une suggestion sur un texte non identifié vaut mieux que
// rien, et c'est justement là qu'un mainteneur veut regarder.
//
// ⚠ Un motif dont la part fixe est trop courte attrape n'importe quoi : « {0} : {1} »
//   reconnaîtrait toute ligne à deux points. MIN_FIXE est le garde-fou ; sous ce seuil, le
//   libellé n'entre pas dans l'index du tout — sa forme littérale ne s'affiche jamais.
//
// Module PUR : ni fs, ni vscode, ni DOM. La table lui est passée, l'index en sort, et
// c'est l'appelant qui décide quand le construire et à qui l'envoyer. C'est ce qui le rend
// éprouvable sans ouvrir une seule fenêtre.
'use strict';

// Le nombre de caractères FIXES qu'un motif doit porter pour entrer dans l'index. Compté
// sur les morceaux littéraux réunis, espaces et ponctuation compris : c'est ce qui reste
// pour reconnaître le libellé quand les trous sont remplis par n'importe quoi.
const MIN_FIXE = 8;

// Un trou de gabarit, tel que T() le remplace : {0}, {1}…
const RE_TROU = /\{\d+\}/;
const RE_TROU_G = /\{\d+\}/g;

// Les espaces que le HTML et la typographie maison font varier entre la table et l'écran :
// insécable, insécable fine, espace fine, retours à la ligne de l'indentation du gabarit.
// Comparer sans les réduire ferait manquer presque tous les libellés du cockpit, qui
// portent des insécables avant « : » et dans les guillemets.
const RE_ESPACES = /[\s   ]+/g;

function normaliser(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(RE_ESPACES, ' ').trim();
}

// Les morceaux littéraux d'un gabarit, dans l'ordre, trous retirés. « Volume {0} de {1} »
// -> ['Volume ', ' de ', '']. Le premier morceau est le début du texte, le dernier sa fin ;
// un morceau vide dit qu'un trou touche ce bord.
function morceaux(valeur) {
  return normaliser(valeur).split(RE_TROU_G);
}

function longueurFixe(parts) {
  let n = 0;
  for (const p of parts) { n += p.length; }
  return n;
}

// Le texte affiché correspond-il au motif ? Chaque trou doit valoir AU MOINS un caractère :
// sans cela « Volume {0} » reconnaîtrait « Volume », qui est un autre libellé.
function motifColle(parts, texte) {
  if (!parts || parts.length < 2) { return false; }
  const debut = parts[0];
  if (texte.slice(0, debut.length) !== debut) { return false; }
  let pos = debut.length;
  for (let i = 1; i < parts.length - 1; i++) {
    // Le trou qui précède ce morceau vaut au moins un caractère : on cherche à partir de
    // pos + 1.
    const j = texte.indexOf(parts[i], pos + 1);
    if (j === -1) { return false; }
    pos = j + parts[i].length;
  }
  const fin = parts[parts.length - 1];
  if (fin !== '' && texte.slice(texte.length - fin.length) !== fin) { return false; }
  // Le dernier trou aussi doit valoir quelque chose.
  return texte.length - fin.length > pos;
}

// L'index d'une table { clé: texte } -> { exact, motifs }.
//
//   exact   { texte normalisé: [clés] }, plusieurs clés quand deux libellés se ressemblent
//   motifs  [{ cle, parts, fixe }], du plus spécifique au moins spécifique
//
// Sans prototype (Object.create(null)) : un libellé qui vaudrait « constructor » ou
// « toString » ne doit pas rendre une fonction héritée en guise de liste de clés.
//
// Rien que des données : l'index part tel quel dans un postMessage, qui ne sait sérialiser
// ni RegExp ni Map. C'est pourquoi un motif garde ses morceaux, et non une expression.
function construireIndex(table) {
  const t = table && typeof table === 'object' ? table : {};
  const exact = Object.create(null);
  const motifs = [];
  for (const cle of Object.keys(t)) {
    const valeur = t[cle];
    if (typeof valeur !== 'string') { continue; }
    const texte = normaliser(valeur);
    if (texte === '') { continue; }
    if (RE_TROU.test(texte)) {
      const parts = morceaux(texte);
      const fixe = longueurFixe(parts);
      // Trop peu de fixe : le motif attraperait n'importe quoi. Le libellé sort de l'index,
      // sa forme littérale ne s'affichant jamais telle quelle.
      if (fixe < MIN_FIXE) { continue; }
      motifs.push({ cle: cle, parts: parts, fixe: fixe });
      continue;
    }
    if (!exact[texte]) { exact[texte] = []; }
    exact[texte].push(cle);
  }
  // Le plus de fixe d'abord : entre deux motifs qui collent, le plus précis se présente en
  // tête. À égalité, la clé, pour que deux constructions rendent le même ordre.
  motifs.sort((a, b) => (b.fixe - a.fixe) || (a.cle < b.cle ? -1 : (a.cle > b.cle ? 1 : 0)));
  return { exact: exact, motifs: motifs };
}

// Les clés candidates d'un texte lu à l'écran, de la plus sûre à la moins sûre. Liste vide
// quand rien ne correspond : ce n'est pas une erreur, c'est le quatrième cas.
//
// L'exact l'emporte toujours sur le motif : un texte qui EST un libellé n'a pas à être
// proposé comme le remplissage d'un autre.
function trouverCles(index, texte) {
  const i = index && typeof index === 'object' ? index : {};
  const t = normaliser(texte);
  if (t === '') { return []; }
  const exact = i.exact || {};
  if (Object.prototype.hasOwnProperty.call(exact, t)) { return exact[t].slice(); }
  const sortie = [];
  for (const motif of (i.motifs || [])) {
    if (motifColle(motif.parts, t)) { sortie.push(motif.cle); }
  }
  return sortie;
}

module.exports = {
  MIN_FIXE, normaliser, morceaux, longueurFixe, motifColle,
  construireIndex, trouverCles
};
