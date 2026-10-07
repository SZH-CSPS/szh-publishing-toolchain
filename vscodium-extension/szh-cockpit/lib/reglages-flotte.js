// Les réglages de l'éditeur communs à tous les postes (thème, confort de rédaction,
// masquage de fichiers, compilation à la sauvegarde…).
//
// Ce sont des défauts déclarés par l'extension (`contributes.configurationDefaults` de
// package.json) : ce que la personne choisit dans ses réglages passe devant, et la mise à
// jour n'a pas à réécrire son fichier.
//
// VSCodium ignore, avec un simple avertissement, les défauts de portée « application »
// (update.mode, extensions.autoUpdate, extensions.autoCheckUpdates, window.commandCenter,
// window.menuBarVisibility, sur VSCodium 1.121). Le cockpit les pose donc lui-même par
// l'API de configuration, qui garde commentaires et clés voisines. Ces clés ne sont pas
// listées : `clesRefusees` les trouve au démarrage en relisant le défaut effectif.
//
// Ces clés ne sont reposées que si la valeur voulue a changé depuis la dernière fois
// (empreinte du gabarit), pour respecter un choix fait ensuite par la personne.
//
// Source : `vscodium-user/settings.json` du dépôt, commenté.
// `contributes.configurationDefaults` doit en être la copie exacte ;
// test/js/reglages-flotte.test.js le vérifie et affiche le bloc à recopier.
'use strict';

// JSON avec commentaires. Les chaînes sont sautées d'abord, sinon une valeur contenant
// « // » (une adresse Internet) serait tronquée.
function analyserJsonc(source) {
  const sansCommentaires = String(source === undefined || source === null ? '' : source)
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
  return JSON.parse(sansCommentaires.replace(/,(\s*[}\]])/g, '$1'));
}

// Empreinte des valeurs voulues, insensible aux commentaires et à l'ordre des clés. Elle
// est comparée à celle du dernier passage pour savoir s'il faut reposer les valeurs.
function empreinteReglages(table) {
  const cles = Object.keys(table || {}).sort();
  const canon = cles.map((c) => c + '=' + JSON.stringify(table[c])).join('\n');
  let h = 5381;
  for (let i = 0; i < canon.length; i++) { h = ((h * 33) ^ canon.charCodeAt(i)) >>> 0; }
  return cles.length + '-' + h.toString(16);
}

// Les clés dont le défaut effectif diffère de la valeur voulue : celles que l'éditeur a
// refusées. `defautDe(cle)` rend le défaut effectif (`inspect(cle).defaultValue` côté
// hôte).
function clesRefusees(table, defautDe) {
  const refusees = [];
  for (const cle of Object.keys(table || {})) {
    let effectif;
    try { effectif = defautDe(cle); } catch (e) { effectif = undefined; }
    if (!memeValeur(effectif, table[cle])) { refusees.push(cle); }
  }
  return refusees;
}

// Égalité de valeurs de configuration, insensible à l'ordre des clés (contrairement à
// JSON.stringify).
function memeValeur(a, b) {
  if (a === b) { return true; }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') { return false; }
  if (Array.isArray(a) !== Array.isArray(b)) { return false; }
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => memeValeur(v, b[i]));
  }
  const ca = Object.keys(a).sort();
  const cb = Object.keys(b).sort();
  if (ca.length !== cb.length || ca.some((c, i) => c !== cb[i])) { return false; }
  return ca.every((c) => memeValeur(a[c], b[c]));
}

module.exports = { analyserJsonc, empreinteReglages, clesRefusees, memeValeur };
