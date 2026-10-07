// Les cantons suisses et la Confédération (code CH), avec leur nom en fr et en de, et une
// liste triée par ordre alphabétique du nom dans chaque langue.
//
// Ce module n'a pas d'appelant dans le cockpit : le formulaire de Documentation lit sa liste
// `canton` dans pipeline/kirby/champs-documentation.json (via lib/kirby-contenu.js), rangée
// dans l'ordre d'impression (Confédération, puis par code).
//
// C'est le code qui est stocké : deux caractères, identiques dans les deux langues.
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

// Le nom complet d'un code, dans la langue demandée. Un code inconnu est rendu tel quel.
function nomCanton(code, langue) {
  const c = String(code === undefined || code === null ? '' : code);
  const trouve = CANTONS.find((x) => x.code === c);
  return trouve ? trouve[langueSaine(langue)] : c;
}

// La liste déroulante : [{ valeur, libelle }], par ordre alphabétique du nom dans la langue
// de l'interface (localeCompare : « Bâle-Campagne » avant « Berne »). Le libellé montre
// aussi le code, qui est ce qui s'imprime.
function optionsCanton(langue) {
  const l = langueSaine(langue);
  return CANTONS.slice()
    .sort((a, b) => a[l].localeCompare(b[l], l, { sensitivity: 'base' }))
    .map((x) => ({ valeur: x.code, libelle: x[l] + ' (' + x.code + ')' }));
}

module.exports = { CANTONS, estCode, nomCanton, optionsCanton };
