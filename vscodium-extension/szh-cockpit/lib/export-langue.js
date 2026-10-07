// Exporte tous les libellés de l'interface du cockpit, français et allemand côte à côte,
// dans un JSON à faire relire. Le fichier est une copie : le corriger ne change pas
// l'interface ; les corrections se reportent à la main dans lib/i18n.js et les
// package.nls*.json.
//
// Une clé absente d'une langue sort quand même, avec `null` en face, pour que le trou se
// voie. Les valeurs sortent telles quelles (apostrophes, espaces insécables, marqueurs {0}),
// pour que la relecture porte sur la chaîne affichée.
//
// Deux sources : `cockpit` pour TEXTES_COCKPIT (lib/i18n.js), résolu selon la langue du
// cockpit, et `commandes` pour les package.nls*.json, résolus selon la langue de VSCodium.
//
// Module pur, sans vscode ni disque : l'appelant fournit les tables, la version et les
// phrases d'avertissement.
'use strict';

// Version du format, écrite dans chaque fichier.
const SCHEMA = 'szh-langue/1';
const EXTENSION = 'szh-cockpit';

// Le cockpit s'affiche en français et en allemand seulement.
const LANGUES = ['fr', 'de'];

// Ordre de sortie des deux sources.
const SOURCES = ['cockpit', 'commandes'];

// Nom proposé à l'enregistrement, avec la version, pour rattacher le fichier à
// l'interface de ce jour-là.
function nomFichier(version) {
  const v = String(version === undefined || version === null ? '' : version).trim();
  return 'langue-' + EXTENSION + (v === '' ? '' : '-' + v) + '.json';
}

function p2(n) { return String(n).padStart(2, '0'); }

// ISO 8601 en heure locale avec fuseau, comme lib/suggestion-traduction.js.
function horodatageIso(date) {
  const d = date instanceof Date ? date : new Date();
  const dec = -d.getTimezoneOffset();
  const abs = Math.abs(dec);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
    (dec >= 0 ? '+' : '-') + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60);
}

// Compare par unités de code et non par localeCompare : l'ordre reste le même d'un poste
// et d'une version de Node à l'autre, et deux exports se comparent ligne à ligne.
function avant(a, b) {
  if (a === b) { return 0; }
  return a < b ? -1 : 1;
}

function table(valeurs) {
  return valeurs && typeof valeurs === 'object' ? valeurs : {};
}

// Union des clés des deux langues, triée.
function clesReunies(paire) {
  const vues = Object.create(null);
  const cles = [];
  for (const langue of LANGUES) {
    for (const cle of Object.keys(table(paire[langue]))) {
      if (!vues[cle]) { vues[cle] = true; cles.push(cle); }
    }
  }
  return cles.sort(avant);
}

// Entrées d'une source, triées par clé. `null` : la langue n'a pas cette clé ; une chaîne
// vide est une vraie valeur.
function entreesSource(source, paire) {
  const p = paire && typeof paire === 'object' ? paire : {};
  return clesReunies(p).map((cle) => {
    const entree = { source: source, cle: cle };
    for (const langue of LANGUES) {
      const t = table(p[langue]);
      entree[langue] = Object.prototype.hasOwnProperty.call(t, cle) ? t[cle] : null;
    }
    return entree;
  });
}

// Construit l'objet à sérialiser, clés dans l'ordre du format. `options` :
//   cockpit   { fr, de }  TEXTES_COCKPIT
//   commandes { fr, de }  package.nls.json et package.nls.de.json
//   version   la version du package.json
//   lire      { fr, de }  la phrase d'avertissement dans chaque langue
//   date      pour les tests ; par défaut, maintenant
function construire(options) {
  const o = options || {};
  const lire = o.lire && typeof o.lire === 'object' ? o.lire : {};
  const sources = { cockpit: o.cockpit, commandes: o.commandes };
  let entrees = [];
  for (const source of SOURCES) { entrees = entrees.concat(entreesSource(source, sources[source])); }
  // Tri final par source puis par clé, valable aussi pour une source ajoutée plus tard.
  entrees.sort((a, b) => avant(a.source, b.source) || avant(a.cle, b.cle));
  return {
    schema: SCHEMA,
    _lire: {
      fr: String(lire.fr === undefined || lire.fr === null ? '' : lire.fr),
      de: String(lire.de === undefined || lire.de === null ? '' : lire.de)
    },
    genere: horodatageIso(o.date),
    extension: EXTENSION,
    version: String(o.version === undefined || o.version === null ? '' : o.version),
    langues: LANGUES.slice(),
    entrees: entrees
  };
}

// Indenté à deux espaces, saut de ligne final : lisible dans un éditeur, comparable par diff.
function serialiser(objet) {
  return JSON.stringify(objet, null, 2) + '\n';
}

module.exports = {
  SCHEMA, EXTENSION, LANGUES, SOURCES,
  nomFichier, horodatageIso, clesReunies, entreesSource, construire, serialiser
};
