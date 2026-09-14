// Fichier de langue du cockpit : tous les libellés de l'interface, français et allemand
// côte à côte, dans un seul JSON qu'on peut envoyer à quelqu'un qui relit.
//
// Ce que ce module garde, et ce qu'il ne fait pas. Le fichier produit est une COPIE : il
// se lit, s'annote, se corrige dans un tableur ou un éditeur de texte, et rien de tout
// cela ne change l'interface. La reprise des corrections est un geste humain, plus tard,
// dans lib/i18n.js et dans les package.nls*.json. C'est le pendant, pour l'interface
// elle-même, de lib/suggestion-traduction.js, qui propose sans écrire pour les textes des
// articles.
//
// ⚠ Une clé qui manque dans une langue sort quand même, avec `null` en face. Escamoter le
//   trou serait le pire service à rendre à qui relit : c'est justement le trou qu'on
//   voudrait lui voir signaler, et une entrée absente ne se remarque pas.
//
// ⚠ Les valeurs partent TELLES QUELLES — apostrophes typographiques, espaces insécables,
//   guillemets, marqueurs {0}. Une normalisation quelconque ferait relire un texte que
//   personne ne voit à l'écran, et les corrections reviendraient sur une autre chaîne que
//   celle affichée.
//
// Deux sources, parce que les libellés du cockpit viennent de deux mécanismes
// indépendants : `cockpit` pour TEXTES_COCKPIT (lib/i18n.js), que T() résout selon la
// langue du cockpit, et `commandes` pour les package.nls*.json, que VSCodium résout selon
// SA propre langue d'affichage. Les deux se voient à l'écran ; n'en exporter qu'une
// laisserait la moitié des titres de commandes et le tutoriel hors de la relecture.
//
// Module pur : ni vscode, ni fs, ni disque. Les tables, la version et les deux phrases
// d'avertissement lui sont passées par l'appelant.
'use strict';

// La version du format, écrite dans chaque fichier : un relecteur doit pouvoir dire à
// quelle grammaire il a affaire sans la deviner.
const SCHEMA = 'szh-langue/1';
const EXTENSION = 'szh-cockpit';

// Les deux langues de l'interface. Il n'y a pas de table anglaise, et ce n'est pas un
// oubli : le cockpit ne s'affiche qu'en français et en allemand.
const LANGUES = ['fr', 'de'];

// Les deux mécanismes de libellés, dans l'ordre où ils sortent. Voir l'en-tête.
const SOURCES = ['cockpit', 'commandes'];

// Le nom proposé à l'enregistrement. La version y est, pour qu'un fichier relu six mois
// plus tard se raccroche à ce qui était affiché ce jour-là.
function nomFichier(version) {
  const v = String(version === undefined || version === null ? '' : version).trim();
  return 'langue-' + EXTENSION + (v === '' ? '' : '-' + v) + '.json';
}

function p2(n) { return String(n).padStart(2, '0'); }

// ISO 8601 AVEC fuseau, en heure locale — même forme que lib/suggestion-traduction.js et
// pour la même raison : un horodatage nu se relit à une heure près selon le lecteur.
function horodatageIso(date) {
  const d = date instanceof Date ? date : new Date();
  const dec = -d.getTimezoneOffset();
  const abs = Math.abs(dec);
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) +
    'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) +
    (dec >= 0 ? '+' : '-') + p2(Math.floor(abs / 60)) + ':' + p2(abs % 60);
}

// Comparaison par unités de code, jamais localeCompare : l'ordre doit être le même sur
// tous les postes et d'une version de Node à l'autre, pour que deux exports successifs se
// comparent ligne à ligne au lieu de se réordonner tout seuls.
function avant(a, b) {
  if (a === b) { return 0; }
  return a < b ? -1 : 1;
}

function table(valeurs) {
  return valeurs && typeof valeurs === 'object' ? valeurs : {};
}

// Toutes les clés des deux langues, réunies. L'union, et pas l'une des deux : une clé
// ajoutée d'un seul côté est exactement ce qu'on veut voir sortir.
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

// Les entrées d'une source, triées par clé. `null` dit « cette langue ne porte pas cette
// clé » ; une valeur vide, elle, est une vraie valeur et sort telle quelle.
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

// L'objet à sérialiser. `options` :
//   cockpit   { fr, de }  TEXTES_COCKPIT
//   commandes { fr, de }  package.nls.json et package.nls.de.json
//   version   la version du package.json
//   lire      { fr, de }  la phrase d'avertissement, dans chaque langue
//   date      pour les tests ; à défaut, maintenant
//
// L'ordre des clés est celui du format : un fichier se lit de haut en bas sans sauter.
function construire(options) {
  const o = options || {};
  const lire = o.lire && typeof o.lire === 'object' ? o.lire : {};
  const sources = { cockpit: o.cockpit, commandes: o.commandes };
  let entrees = [];
  for (const source of SOURCES) { entrees = entrees.concat(entreesSource(source, sources[source])); }
  // Le tri final redit ce que la construction faisait déjà. Ce n'est pas un doublon
  // inutile : c'est lui qui tient la promesse « trié par source puis par clé », et une
  // source ajoutée plus tard, dans le désordre, n'y échappera pas.
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

// Indenté à deux espaces et terminé par un saut de ligne : le fichier s'ouvre dans un
// éditeur de texte et se compare d'un export à l'autre avec un outil de diff ordinaire.
function serialiser(objet) {
  return JSON.stringify(objet, null, 2) + '\n';
}

module.exports = {
  SCHEMA, EXTENSION, LANGUES, SOURCES,
  nomFichier, horodatageIso, clesReunies, entreesSource, construire, serialiser
};
