// Les réglages de l'éditeur que la maison impose à tous les postes — thème, confort de
// rédaction, masquage de fichiers, compilation à la sauvegarde… — et le seul endroit qui
// sache les lire.
//
// ⚠ Le défaut que ce module répare, et qui a coûté cher. Jusqu'ici la mise à jour du poste
// recopiait `vscodium-user/settings.json` PAR-DESSUS les réglages de l'éditeur, fichier
// entier, à chaque fois. Tout ce que le rédacteur avait choisi dans « Réglages SZH » —
// thème, zoom, taille de police, langue de l'interface, mode d'aperçu — disparaissait donc
// à chaque mise à jour, sans un mot. Le formulaire de réglages existait, et la mise à jour
// le défaisait.
//
// La réparation tient en deux idées.
//
//   1. Les valeurs de la maison ne sont plus des réglages d'utilisateur mais des DÉFAUTS,
//      déclarés par l'extension (`contributes.configurationDefaults` de package.json). Un
//      défaut ne vit pas dans le fichier du rédacteur : il est en dessous. Ce que le
//      rédacteur choisit passe donc devant, et rien n'a plus besoin d'écraser son fichier.
//
//   2. L'éditeur REFUSE certains défauts, et en silence. Son point d'extension filtre sur la
//      portée de chaque réglage : ceux de portée « application » (mesuré sur VSCodium 1.121 :
//      update.mode, extensions.autoUpdate, extensions.autoCheckUpdates, window.commandCenter,
//      window.menuBarVisibility) sont retirés de la contribution avec un simple avertissement.
//      Le cockpit les pose donc lui-même, par l'API de configuration — qui, elle, fait une
//      retouche chirurgicale du fichier : commentaires et clés voisines conservés.
//
// Le partage entre les deux n'est PAS écrit en dur : il se mesure au démarrage
// (`clesRefusees`), en relisant le défaut effectif de chaque clé. Une clé qu'une version
// future de l'éditeur cesserait d'accepter serait donc rattrapée toute seule, sans qu'une
// liste ait à être tenue à jour.
//
// Et ce que le cockpit pose lui-même, il ne le repose pas à chaque démarrage : seulement
// quand la valeur voulue a CHANGÉ depuis la dernière fois (empreinte du gabarit). Sans cette
// garde, un rédacteur qui a délibérément changé un de ces réglages se le verrait réimposer à
// chaque ouverture, ce qui serait le défaut de départ sous une autre forme.
//
// ⚠ Source unique : `vscodium-user/settings.json`, du dépôt. C'est le fichier commenté, celui
// où l'on décide. `contributes.configurationDefaults` de package.json doit en être la copie
// exacte — test/js/reglages-flotte.test.js le refuse autrement, et affiche le bloc à recopier.
'use strict';

// JSON avec commentaires : le gabarit en porte, et beaucoup — ils disent pourquoi chaque
// réglage est là. Le dépouilleur saute d'abord les chaînes, sans quoi une valeur contenant
// « // » (une adresse Internet) serait tronquée. Même fonction que celle des tests.
function analyserJsonc(source) {
  const sansCommentaires = String(source === undefined || source === null ? '' : source)
    .replace(/"(?:[^"\\]|\\.)*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
  return JSON.parse(sansCommentaires.replace(/,(\s*[}\]])/g, '$1'));
}

// Une empreinte stable des valeurs voulues : elle change quand une valeur change, et pas
// quand un commentaire ou l'ordre des clés change. C'est elle qui décide s'il y a quelque
// chose à reposer, et elle est comparée à celle mémorisée au dernier passage.
function empreinteReglages(table) {
  const cles = Object.keys(table || {}).sort();
  const canon = cles.map((c) => c + '=' + JSON.stringify(table[c])).join('\n');
  let h = 5381;
  for (let i = 0; i < canon.length; i++) { h = ((h * 33) ^ canon.charCodeAt(i)) >>> 0; }
  return cles.length + '-' + h.toString(16);
}

// Les clés dont le défaut effectif de l'éditeur ne vaut PAS ce que la maison veut : celles
// que la contribution n'a pas prises. `defautDe(cle)` rend le défaut effectif — c'est
// `inspect(cle).defaultValue` côté hôte, passé en argument pour que ce module reste pur.
function clesRefusees(table, defautDe) {
  const refusees = [];
  for (const cle of Object.keys(table || {})) {
    let effectif;
    try { effectif = defautDe(cle); } catch (e) { effectif = undefined; }
    if (!memeValeur(effectif, table[cle])) { refusees.push(cle); }
  }
  return refusees;
}

// Égalité de valeurs de configuration : scalaires, tableaux, objets plats ou imbriqués.
// JSON.stringify ne suffit pas — l'ordre des clés d'un objet compte pour lui et non pour
// nous, et `files.exclude` en porte une douzaine.
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
