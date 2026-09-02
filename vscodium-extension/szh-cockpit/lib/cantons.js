// Les cantons suisses, et la Confédération — la liste fermée du champ `canton` d'une fiche
// d'intervention parlementaire (lib/ressources.js, TYPES.intervention).
//
// Demande de Robin (02.09.2026) : « Canton = liste déroulante, par ordre alphabétique, nom
// complet + abréviation entre parenthèses ; le rendu met juste l'abréviation. » D'où le
// partage des rôles :
//
//   ce qui s'AFFICHE dans le formulaire  « Bâle-Campagne (BL) »   <- optionsCanton()
//   ce qui s'ÉCRIT dans le .md           canton="BL"
//   ce qui s'IMPRIME dans le PDF         BL                       <- szh-ressource.lua, tel quel
//
// C'est le CODE qui est stocké, jamais le nom : deux caractères stables, identiques dans
// les deux langues, que le filtre Lua n'a donc aucune table à traduire pour imprimer — il
// écrit l'attribut tel qu'il le lit, et ce fichier n'a pas de jumeau côté pipeline.
//
// Conséquence sur le TRI des fiches d'intervention, qui se rangent par canton
// (lib/ressources.js, CLE_TRI) : elles se rangent donc par CODE — AG, AI, AR, BE, BL, BS,
// CH, FR, GE… C'est l'ordre officiel des cantons, celui de tous les documents fédéraux, et
// il ne dépend pas de la langue ; l'ordre alphabétique demandé pour la liste déroulante,
// lui, ne vaut que pour la SAISIE, où l'on cherche « Genève » et non « GE ».
//
// La Confédération (code CH) est dans la liste et ce n'est pas une erreur : la rubrique des
// interventions parlementaires relève aussi bien les motions et postulats fédéraux que les
// objets cantonaux, et sans cette entrée une motion du Conseil national n'aurait pas de
// case où aller.
'use strict';

// Noms officiels, dans les deux langues de publication. `code` est la forme imprimée.
const CANTONS = [
  { code: 'CH', fr: 'Confédération', de: 'Bund' },
  { code: 'AG', fr: 'Argovie', de: 'Aargau' },
  { code: 'AI', fr: 'Appenzell Rhodes-Intérieures', de: 'Appenzell Innerrhoden' },
  { code: 'AR', fr: 'Appenzell Rhodes-Extérieures', de: 'Appenzell Ausserrhoden' },
  { code: 'BE', fr: 'Berne', de: 'Bern' },
  { code: 'BL', fr: 'Bâle-Campagne', de: 'Basel-Landschaft' },
  { code: 'BS', fr: 'Bâle-Ville', de: 'Basel-Stadt' },
  { code: 'FR', fr: 'Fribourg', de: 'Freiburg' },
  { code: 'GE', fr: 'Genève', de: 'Genf' },
  { code: 'GL', fr: 'Glaris', de: 'Glarus' },
  { code: 'GR', fr: 'Grisons', de: 'Graubünden' },
  { code: 'JU', fr: 'Jura', de: 'Jura' },
  { code: 'LU', fr: 'Lucerne', de: 'Luzern' },
  { code: 'NE', fr: 'Neuchâtel', de: 'Neuchâtel' },
  { code: 'NW', fr: 'Nidwald', de: 'Nidwalden' },
  { code: 'OW', fr: 'Obwald', de: 'Obwalden' },
  { code: 'SG', fr: 'Saint-Gall', de: 'St. Gallen' },
  { code: 'SH', fr: 'Schaffhouse', de: 'Schaffhausen' },
  { code: 'SO', fr: 'Soleure', de: 'Solothurn' },
  { code: 'SZ', fr: 'Schwytz', de: 'Schwyz' },
  { code: 'TG', fr: 'Thurgovie', de: 'Thurgau' },
  { code: 'TI', fr: 'Tessin', de: 'Tessin' },
  { code: 'UR', fr: 'Uri', de: 'Uri' },
  { code: 'VD', fr: 'Vaud', de: 'Waadt' },
  { code: 'VS', fr: 'Valais', de: 'Wallis' },
  { code: 'ZG', fr: 'Zoug', de: 'Zug' },
  { code: 'ZH', fr: 'Zurich', de: 'Zürich' }
];

function langueSaine(langue) {
  const l = String(langue === undefined || langue === null ? '' : langue).slice(0, 2).toLowerCase();
  return l === 'de' ? 'de' : 'fr';
}

function estCode(code) {
  const c = String(code === undefined || code === null ? '' : code);
  return CANTONS.some((x) => x.code === c);
}

// Le nom complet d'un code, dans la langue demandée. Un code inconnu se rend tel quel
// plutôt que vide : une valeur saisie à la main avant cette liste reste lisible.
function nomCanton(code, langue) {
  const c = String(code === undefined || code === null ? '' : code);
  const trouve = CANTONS.find((x) => x.code === c);
  return trouve ? trouve[langueSaine(langue)] : c;
}

// La liste déroulante, prête pour le formulaire : [{ valeur, libelle }], rangée par ordre
// alphabétique du NOM dans la langue de l'interface — « Bâle-Campagne » avant « Berne », ce
// qu'un tri par octets ne ferait pas. Le libellé porte le nom ET le code, parce que c'est le
// code qui s'imprimera : le rédacteur doit le voir au moment où il choisit.
function optionsCanton(langue) {
  const l = langueSaine(langue);
  return CANTONS.slice()
    .sort((a, b) => a[l].localeCompare(b[l], l, { sensitivity: 'base' }))
    .map((x) => ({ valeur: x.code, libelle: x[l] + ' (' + x.code + ')' }));
}

module.exports = { CANTONS, estCode, nomCanton, optionsCanton };
