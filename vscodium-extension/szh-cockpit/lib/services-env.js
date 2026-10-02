// Les services en ligne (Shlink, OJS) vus de la chaîne de fabrication : l'adresse et les deux
// clés, copiées en mémoire par l'Accueil (lib/accueil-reglages-hote.js), et les variables
// d'environnement que lib/moteur.js pose sur chaque appel à la WSL. wsl.exe ne transmet une
// variable que si WSLENV la nomme, avec /u pour un passage Windows vers WSL seulement.
// Module pur : ni vscode, ni disque, et une clé n'en sort que dans un env, jamais dans un texte.
'use strict';

// Ordre de WSLENV : celui-ci.
const VARIABLES = Object.freeze([
  ['url', 'SZH_SHLINK_URL'], ['shlinkCle', 'SZH_SHLINK_CLE'], ['ojsCle', 'SZH_OJS_CLE']
]);

let valeurs = { url: '', shlinkCle: '', ojsCle: '' };

function poser(nouvelles) {
  const v = nouvelles || {};
  valeurs = {
    url: String(v.url || '').trim(), shlinkCle: String(v.shlinkCle || '').trim(), ojsCle: String(v.ojsCle || '').trim()
  };
}

// Les variables réglées seulement : une variable vide se transmettrait comme une chaîne
// vide, et un filtre qui teste sa présence s'y tromperait.
function variables() {
  const sortie = {};
  for (const [cle, nom] of VARIABLES) { if (valeurs[cle]) { sortie[nom] = valeurs[cle]; } }
  return sortie;
}

// WSLENV d'après `base`, nos noms ajoutés en /u sans doublon, les autres entrées gardées.
function wslenv(base, noms) {
  const parties = String(base || '').split(':').filter(Boolean);
  const connus = new Set(parties.map((p) => p.split('/')[0]));
  for (const nom of noms) { if (!connus.has(nom)) { parties.push(nom + '/u'); connus.add(nom); } }
  return parties.join(':');
}

// Ce qu'il faut ajouter à un env existant : les variables et WSLENV, ou null si rien n'est réglé.
function ajouts(base) {
  const vars = variables();
  const noms = Object.keys(vars);
  if (noms.length === 0) { return null; }
  return Object.assign({}, vars, { WSLENV: wslenv((base || {}).WSLENV, noms) });
}

// L'environnement complet d'un spawn (copie de `base` plus les ajouts), ou null : l'appelant
// laisse alors l'env par défaut du processus.
function environnement(base) {
  const plus = ajouts(base);
  return plus ? Object.assign({}, base || {}, plus) : null;
}

// Une tâche déclarée dans tasks.json part sans ces variables : on les ajoute à l'env de son
// exécution (fusionné à celui du parent) avant de la lancer. Sans effet si rien n'est réglé.
function dansTache(tache) {
  try {
    const ex = tache && tache.execution;
    if (!ex || !('options' in ex)) { return; }
    const options = ex.options || {};
    const plus = ajouts(Object.assign({}, process.env, options.env));
    if (plus) { ex.options = Object.assign({}, options, { env: Object.assign({}, options.env, plus) }); }
  } catch (e) { /* tâche non modifiable : elle part telle quelle */ }
}

// Pour un journal : les noms posés, jamais les valeurs.
function description() {
  const noms = Object.keys(variables());
  return noms.length ? 'variables WSL posées : ' + noms.join(', ') : 'aucune variable WSL posée';
}

module.exports = { poser, variables, ajouts, environnement, dansTache, description, wslenv, VARIABLES };
