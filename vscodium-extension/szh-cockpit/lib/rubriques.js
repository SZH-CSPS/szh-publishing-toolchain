// Rubriques de texte riche d'un article — les blocs de prose de la Documentation
// (« Actualité et ressources » / « News & Ressourcen ») que rien ne force à isoler en
// champs : listes bibliographiques, listes de liens, brèves d'actualité. Là où
// lib/ressources.js découpe une fiche en champs structurés, une rubrique n'a qu'un seul
// champ — son contenu — et c'est le sens même de ce module : ne rien lui imposer d'autre.
//
// Une rubrique par type et pas davantage, depuis le 02.09.2026 : le formulaire
// (media/documentation.js) n'offre plus d'« Ajouter un bloc », il présente le bloc unique de
// chaque type, toujours éditable, et le vider l'ôte du .md. Rien n'a changé ICI pour autant
// — ce module lit et écrit un bloc par identifiant, sans jamais compter combien il y en a
// d'un type donné : un .md écrit à la main qui en porterait deux se lit encore, et ses deux
// blocs se rendent encore. C'est une règle de formulaire, pas une règle de format.
//
// Le bloc, tel que le formulaire l'écrit et tel que pipeline/filters/szh-rubrique.lua le
// relit :
//
//   ::: {#b1a2b3c4 .szh-rubrique type="dossier-references"}
//   Barreyre, J. (2019). *Les personnes en situation de handicap complexe*. Alter, 13-3,
//   207-217.
//
//   Bürli, A. (2024). **Inklusion weltweit**. Edition SZH/CSPS.
//   :::
//
// `type=` est un jeton d'une liste fermée (TYPES_RUBRIQUE) : le titre imprimé n'est JAMAIS
// écrit dans le .md, il se déduit du type et de la langue de l'article au rendu — même
// parti que le libellé de lien d'une fiche de ressource (voir l'en-tête de
// lib/ressources.js). Un titre corrigé plus tard suit sans ressaisie.
//
// Le contenu est du markdown ordinaire, laissé tel quel : pandoc le parse nativement, donc
// tous les filtres qui tournent avant (typographie, notes…) le traitent déjà. C'est la
// différence de fond avec une fiche de ressource, dont le descriptif est un champ de
// formulaire parmi d'autres : ici, le contenu EST la rubrique, et rien n'y est retouché
// au-delà des lignes vides de tête et de queue qui l'isolent du bloc — ni les italiques, ni
// le gras, ni les liens, ni les listes, ni les lignes vides intérieures qui séparent des
// paragraphes. Un aller-retour lireRubriques() -> blocRubrique() doit rendre le contenu au
// caractère près.
//
// Identité d'une rubrique : un identifiant pandoc (#b…) posé par le formulaire à la
// création, jamais recalculé côté pur. Une rubrique qui en est dépourvue — bloc écrit à la
// main — reçoit ici un identifiant de repli dérivé de sa position, valable pour la durée
// d'une seule lecture : de quoi fonctionner dans un aller-retour charger/enregistrer, pas
// au-delà. Le panneau (extension.js) ne connaît lui aussi que des identifiants : jamais un
// index de tableau, qui se décale au moindre ajout ou retrait ailleurs dans le document.
//
// Cohabitation : un .szh-rubrique et un .szh-ressource vivent côte à côte dans le même
// article. Ce module ne reconnaît que la classe .szh-rubrique — un bloc .szh-ressource lui
// est invisible, comme n'importe quel autre fenced div qui ne porte pas sa classe.
//
// Un type= inconnu ne casse rien : le bloc se lit et s'écrit comme n'importe quel autre,
// avec son jeton tel quel dans `type` (dégradation propre — c'est szh-rubrique.lua qui, lui,
// n'aura pas de titre à imprimer pour un jeton qu'il ne connaît pas).
//
// ⚠ Table recopiée dans pipeline/filters/szh-rubrique.lua (table TITRES) : ce module n'a
// besoin que des JETONS (TYPES_RUBRIQUE), jamais de leurs titres fr/de, qui vivent dans la
// table Lua d'un côté et dans lib/i18n.js de l'autre (libellés d'interface, hors périmètre
// de ce module). Aucun libellé français ou allemand n'a sa place ici.
'use strict';

const { RE_DIV_OUVERTURE, fermetureDeDiv, scannerAttributs } = require('./references');

const CLASSE = 'szh-rubrique';

// Ordre = ordre d'affichage dans le formulaire (voir §1 de la spec).
// ⚠ Recopié dans pipeline/filters/szh-rubrique.lua (table TITRES) : un test refuse que les
// deux divergent, comme test/js/ressources.test.js le fait pour lib/ressources.js /
// szh-ressource.lua.
//
// L'agenda a QUITTÉ cette liste le 02.09.2026, sur demande de Robin : « Agenda et formation
// doit devenir un champ structuré (date / plage de date / type d'événement…) ». C'est
// désormais un type de FICHE (lib/ressources.js, TYPES.agenda), avec sa date de début, sa
// date de fin, son lieu et son organisateur — et donc un agenda qui se range tout seul par
// ordre chronologique, ce qu'un bloc de prose ne pouvait pas faire.
const TYPES_RUBRIQUE = [
  'dossier-references',
  'dossier-liens',
  'tour-horizon',
  'ressources',
  'podcasts'
];

function typeValide(type) {
  return TYPES_RUBRIQUE.indexOf(String(type === undefined || type === null ? '' : type)) !== -1;
}
function typesConnus() { return TYPES_RUBRIQUE.slice(); }

// Une rubrique est complète dès que son contenu n'est pas vide : le titre est déduit du
// type au rendu (voir l'en-tête du fichier), il n'y a donc aucun autre champ à exiger. Un
// type inconnu ne peut jamais être complet, même rempli — même parti que
// champsManquants() de lib/ressources.js pour un type inconnu : mieux vaut le dire que
// faire semblant qu'une fiche d'un type que le formulaire ne propose plus est utilisable.
function champsManquants(type, contenu) {
  if (!typeValide(type)) { return ['contenu']; }
  const c = String(contenu === undefined || contenu === null ? '' : contenu).trim();
  return c === '' ? ['contenu'] : [];
}
function rubriqueComplete(type, contenu) { return champsManquants(type, contenu).length === 0; }

// Valeur -> attribut cité, comme lib/references.js et lib/ressources.js (non exportée
// là-bas non plus : une simple citation, dupliquée plutôt qu'empruntée à un module qui ne
// l'expose pas).
function citerValeur(v) {
  return '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Le contenu, débarrassé de ses lignes vides de tête et de queue — et de rien d'autre : ni
// les lignes vides intérieures, ni les espaces ou tabulations internes, ni le moindre
// caractère de mise en forme markdown. C'est le point le plus important du module (voir
// l'en-tête) : un aller-retour lecture/écriture doit rendre le même texte au caractère
// près.
function normaliserContenu(contenu) {
  const texte = String(contenu === undefined || contenu === null ? '' : contenu).replace(/\r\n/g, '\n');
  const lignes = texte.split('\n');
  while (lignes.length > 0 && lignes[0].trim() === '') { lignes.shift(); }
  while (lignes.length > 0 && lignes[lignes.length - 1].trim() === '') { lignes.pop(); }
  return lignes;
}

// lireRubriques(texte) -> [ { id, ouverture, fermeture, type, contenu } ]
// `id` vient de l'identifiant pandoc du bloc (#…) ; à défaut, un repli dérivé de la
// position — voir l'en-tête du fichier. `contenu` est toujours une chaîne (jamais
// undefined), pour que le formulaire n'ait rien à deviner.
function lireRubriques(texte) {
  const lignes = String(texte === undefined || texte === null ? '' : texte).split('\n');
  const res = [];
  for (let i = 0; i < lignes.length; i++) {
    const ouverture = RE_DIV_OUVERTURE.exec(lignes[i]);
    if (!ouverture) { continue; }
    const jetons = scannerAttributs(ouverture[1]);
    const estRubrique = jetons.some((j) => !j.paire && j.brut === '.' + CLASSE);
    if (!estRubrique) { continue; }
    const fin = fermetureDeDiv(lignes, i);
    if (fin === -1) { continue; }                   // bloc laissé ouvert : on n'y touche pas

    let id = null;
    const attrs = {};
    for (const j of jetons) {
      if (j.paire) { attrs[j.cle.toLowerCase()] = j.valeur; continue; }
      if (id === null && /^#./.test(j.brut)) { id = j.brut.slice(1); }
    }
    const type = String(attrs.type || '');

    const corps = lignes.slice(i + 1, fin);
    while (corps.length > 0 && corps[0].trim() === '') { corps.shift(); }
    while (corps.length > 0 && corps[corps.length - 1].trim() === '') { corps.pop(); }

    res.push({ id: id || ('pos' + i), ouverture: i, fermeture: fin, type: type, contenu: corps.join('\n') });
    i = fin;
  }
  return res;
}

// Le bloc entier, prêt à être inséré tel quel dans le texte (sans les lignes vides qui
// l'isolent : c'est à l'appelant de les poser, comme blocRessource() de lib/ressources.js).
function blocRubrique(id, type, contenu) {
  const jetons = [];
  if (id) { jetons.push('#' + String(id)); }
  jetons.push('.' + CLASSE);
  jetons.push('type=' + citerValeur(type));
  const lignes = ['::: {' + jetons.join(' ') + '}'];
  const corps = normaliserContenu(contenu);
  if (corps.length > 0) { lignes.push(''); lignes.push(...corps); }
  lignes.push(':::');
  return lignes.join('\n');
}

// Isole un bloc de lignes par un blanc de chaque côté, sans en ajouter un qui existerait
// déjà — même règle que dans lib/ressources.js et lib/references.js (insererIsole, non
// exportée là-bas).
function inserer(lignes, ou, bloc) {
  const avant = (ou > 0 && (lignes[ou - 1] || '').trim() !== '') ? [''] : [];
  const apres = (ou < lignes.length && (lignes[ou] || '').trim() !== '') ? [''] : [];
  lignes.splice(ou, 0, ...avant, ...bloc, ...apres);
}

// ajouterRubrique(texte, id, type, contenu) -> texte
// Ajoute une rubrique neuve, juste après la dernière rubrique déjà présente, ou en fin de
// document s'il n'y en a aucune — même règle que ajouterRessource().
function ajouterRubrique(texte, id, type, contenu) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const lignes = src.split('\n');
  const existantes = lireRubriques(src);
  const ou = existantes.length > 0
    ? existantes[existantes.length - 1].fermeture + 1
    : lignes.length;
  inserer(lignes, ou, blocRubrique(id, type, contenu).split('\n'));
  return lignes.join('\n');
}

// ecrireRubrique(texte, id, type, contenu) -> { texte, ok }
// Remplace en place la rubrique `id`. `ok` est faux si elle a disparu du .md depuis le
// chargement (bloc supprimé à la main entre-temps) : l'appelant décide alors quoi en dire.
function ecrireRubrique(texte, id, type, contenu) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const trouvee = lireRubriques(src).find((r) => r.id === String(id));
  if (!trouvee) { return { texte: src, ok: false }; }
  const lignes = src.split('\n');
  lignes.splice(trouvee.ouverture, trouvee.fermeture - trouvee.ouverture + 1,
    ...blocRubrique(id, type, contenu).split('\n'));
  return { texte: lignes.join('\n'), ok: true };
}

// retirerRubrique(texte, id) -> { texte, ok }
// Ôte le bloc entier. Même parti que retirerRessource() : le texte se nettoie, aucun autre
// effet de bord (une rubrique n'a ni image ni fichier associé sur le disque).
function retirerRubrique(texte, id) {
  const src = String(texte === undefined || texte === null ? '' : texte);
  const trouvee = lireRubriques(src).find((r) => r.id === String(id));
  if (!trouvee) { return { texte: src, ok: false }; }
  const lignes = src.split('\n');
  lignes.splice(trouvee.ouverture, trouvee.fermeture - trouvee.ouverture + 1);
  // Un blanc de chaque côté de la coupe : n'en garder qu'un, comme un paragraphe retiré.
  if (trouvee.ouverture > 0 && trouvee.ouverture < lignes.length
      && lignes[trouvee.ouverture - 1].trim() === '' && lignes[trouvee.ouverture].trim() === '') {
    lignes.splice(trouvee.ouverture, 1);
  }
  return { texte: lignes.join('\n'), ok: true };
}

module.exports = {
  TYPES_RUBRIQUE,
  typeValide, typesConnus,
  lireRubriques, blocRubrique, ajouterRubrique, ecrireRubrique, retirerRubrique,
  rubriqueComplete, champsManquants
};
