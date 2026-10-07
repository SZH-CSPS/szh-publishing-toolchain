// Liage manuel d'un appel de citation à une référence. Le liage automatique se fait à la
// compilation, dans pipeline/filters/szh-citations.lua ; ce module sert aux appels que le
// filtre ne lie pas : nom mal orthographié, parenthèse déséquilibrée, appel ambigu entre
// deux références de même auteur et de même année.
//
// Le rédacteur sélectionne l'appel, choisit la référence, et l'appel devient un lien
// markdown « [(Shaw et al., 2023)](#ref-shaw-2023) », que pandoc rend et que le filtre garde.
//
// referencesDuTexte() doit découper la liste et calculer les identifiants exactement comme
// le filtre, sinon le lien pointe vers une ancre absente. Les tables (repli des lettres
// accentuées, titres de bibliographie) sont donc lues dans le filtre lui-même.
// test/js/ancrages.test.js compare les deux côtés sur la même liste de noms.
'use strict';

const fs = require('fs');
const path = require('path');
const { REVUES, LANGUES_META } = require('./yaml');
const { lireConfigPoste } = require('./archivage');
const { basePoste } = require('./poste');

// Les revues et les langues du titre de bibliographie, dans l'ordre du panneau ; ce sont
// celles des fiches (lib/yaml.js).
const REVUES_BIBLIO = REVUES.map((r) => r.cle);
const LANGUES_BIBLIO = LANGUES_META.slice();

// ---- identifiants : tables lues dans le filtre ----

// Où lire szh-citations.lua, dans cet ordre : le dépôt (développement et tests), puis le
// toolkit installé, qui compile les articles sur un poste de rédaction.
// SZH_FILTRE_CITATIONS impose un fichier, pour les tests.
const FILTRES = [
  path.resolve(__dirname, '..', '..', '..', 'pipeline', 'filters', 'szh-citations.lua'),
  path.join(basePoste(), 'toolkit', 'pipeline', 'filters', 'szh-citations.lua')
];

function emplacements() {
  return process.env.SZH_FILTRE_CITATIONS ? [process.env.SZH_FILTRE_CITATIONS] : FILTRES;
}

// La liste FILTRES, sans la variable d'environnement. Exposée pour que le test vérifie la
// forme des chemins : dans un littéral JavaScript, une contre-oblique simple disparaît
// (« \P » vaut « P »), et le chemin du toolkit deviendrait faux sans erreur.
function emplacementsDuFiltre() { return FILTRES.slice(); }

let tables = null;

// Deux pannes, deux messages :
//   'absent'      : aucun emplacement ne porte le filtre (poste non préparé) ;
//   'discordant'  : le filtre est là, sans les tables attendues : le cockpit et le filtre
//                   ne sont pas de la même version, une mise à jour règle le problème.
// Le détail technique (chemin, nom de table, nombre de jetons) va dans le journal de
// l'hôte ; l'interface affiche le message de `messageCle`.
function erreurRepli(cause, detail) {
  const e = new Error(detail);
  e.szhRepli = cause;
  e.messageCle = cause === 'discordant'
    ? 'cit.toolkit.discordant' : 'cit.toolkit.absent';
  try { console.warn('[citations] ' + detail); } catch (err) { /* hôte sans console */ }
  return e;
}

// Le corps d'un `local NOM = { … }` du filtre : de l'en-tête jusqu'à l'accolade en début de
// ligne. Les données étant indentées, aucune n'est prise pour la fin.
function blocLua(src, nom, chemin) {
  const i = src.indexOf('local ' + nom + ' = {');
  const j = i === -1 ? -1 : src.indexOf('\n}', i);
  if (j === -1) {
    throw erreurRepli('discordant', 'table ' + nom + ' absente de ' + chemin
      + ' : format de filtre incompatible avec ce cockpit.');
  }
  return src.slice(i, j);
}

function chargerTables() {
  if (tables) { return tables; }
  const candidats = emplacements();
  let chemin = null;
  let src = null;
  for (const c of candidats) {
    try {
      src = fs.readFileSync(c, 'utf8');
      chemin = c;
      break;
    } catch (e) { /* emplacement suivant */ }
  }
  if (src === null) {
    throw erreurRepli('absent', 'szh-citations.lua introuvable : ' + candidats.join(' ; '));
  }
  const repli = new Map();
  let nb = 0;
  const blocs = blocLua(src, 'REPLI_BLOCS', chemin);
  const entree = /\{\s*0x([0-9A-Fa-f]+)\s*,\s*\[\[([\s\S]*?)\]\]\s*\}/g;
  let m;
  while ((m = entree.exec(blocs)) !== null) {
    let cp = parseInt(m[1], 16);
    for (const jeton of m[2].split(/\s+/)) {
      if (jeton !== '') {
        if (jeton !== '?') { repli.set(cp, jeton === '-' ? '' : jeton); }
        cp += 1;
        nb += 1;
      }
    }
  }
  // Le latin compte 656 points de code. Sous ce seuil, la table lue est tronquée ou d'un
  // autre format : elle est traitée comme absente.
  if (nb < 600) {
    throw erreurRepli('discordant', 'REPLI_BLOCS de ' + chemin + ' ne porte que ' + nb
      + ' jetons sur 656 attendus.');
  }
  const ignores = [];
  const plage = /\{\s*0x([0-9A-Fa-f]+)\s*,\s*0x([0-9A-Fa-f]+)\s*\}/g;
  const brut = blocLua(src, 'PLAGES_IGNOREES', chemin);
  while ((m = plage.exec(brut)) !== null) {
    ignores.push([parseInt(m[1], 16), parseInt(m[2], 16)]);
  }
  // Le lexique des titres de bibliographie, et les titres que la compilation pose au-dessus
  // de la bibliographie détachée. Un lexique presque vide signale un filtre d'un autre format.
  const titres = (blocLua(src, 'TITRES_BIB', chemin).match(/'([a-z]+)'/g) || [])
    .map((t) => t.slice(1, -1));
  if (titres.length < 10) {
    throw erreurRepli('discordant', 'TITRES_BIB de ' + chemin + ' ne porte que '
      + titres.length + ' titres.');
  }
  const defauts = {};
  const parRevue = /(\w+)\s*=\s*\{([^}]*)\}/g;
  // L'en-tête « local TITRES_BIBLIO_DEFAUT = { » est retiré : sans cela, la première
  // capture serait le nom de la table, et la revue « revue » disparaîtrait.
  const bloc = blocLua(src, 'TITRES_BIBLIO_DEFAUT', chemin);
  const blocTitres = bloc.slice(bloc.indexOf('{') + 1);
  while ((m = parRevue.exec(blocTitres)) !== null) {
    const par = {};
    const parLangue = /(\w+)\s*=\s*\[\[([\s\S]*?)\]\]/g;
    let l;
    while ((l = parLangue.exec(m[2])) !== null) { par[l[1]] = l[2]; }
    defauts[m[1]] = par;
  }
  for (const revue of REVUES_BIBLIO) {
    if (!defauts[revue]) {
      throw erreurRepli('discordant', 'TITRES_BIBLIO_DEFAUT de ' + chemin
        + ' ne dit rien de la revue « ' + revue + ' ».');
    }
  }
  tables = { chemin: chemin, repli: repli, ignores: ignores,
             titres: titres, titresBiblio: defauts };
  return tables;
}

// Oublie les tables en mémoire : un test change de filtre en cours de processus.
function oublierTables() { tables = null; }

// Le fichier d'où viennent les tables, pour un message d'erreur ou un diagnostic.
function cheminDuFiltre() { return chargerTables().chemin; }

const signales = new Map();

// Un caractère hors des tables est retiré et signalé dans le journal de l'hôte, comme le
// filtre l'écrit sur stderr. Une ligne par caractère, pas par occurrence.
function signaler(cp) {
  if (signales.has(cp)) { return; }
  const msg = '[citations] ⚠ caractère sans repli ASCII, retiré des identifiants : « '
    + String.fromCodePoint(cp) + ' » (U+'
    + cp.toString(16).toUpperCase().padStart(4, '0') + ')';
  signales.set(cp, msg);
  try { console.warn(msg); } catch (e) { /* hôte sans console */ }
}

// Les caractères retirés depuis le chargement, pour un test ou un diagnostic.
function caracteresSansRepli() { return Array.from(signales.values()); }

// Replie les lettres accentuées sur leur base ASCII et laisse le reste tel quel : miroir de
// replier() du filtre, sur les mêmes tables.
function replier(t) {
  const t2 = chargerTables();
  let out = '';
  for (const car of String(t == null ? '' : t)) {
    const cp = car.codePointAt(0);
    if (cp < 128) {
      out += car;
      continue;
    }
    const r = t2.repli.get(cp);
    if (r !== undefined) {
      out += r;
      continue;
    }
    let ignore = false;
    for (const [a, b] of t2.ignores) {
      if (cp >= a && cp <= b) { ignore = true; break; }
    }
    if (!ignore) { signaler(cp); }
  }
  return out;
}

// Chaîne comparable : accents repliés, minuscules, et tout ce qui n'est pas [a-z0-9]
// supprimé (et non remplacé par un tiret, contrairement à slug.js). C'est plat() du filtre.
function aplatir(t) {
  return replier(assainir(t)).toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Espaces et tirets spéciaux ramenés à leur forme simple, comme assainir() du filtre.
function assainir(t) {
  return String(t || '')
    .replace(/[   ]/g, ' ')
    .replace(/[‐‑–—]/g, '-');
}

function normaliser(t) {
  return assainir(t).replace(/\s+/g, ' ').trim();
}

// Le lexique des titres de bibliographie, lu dans le filtre.
function titresBib() {
  return chargerTables().titres;
}

// Comparaison exacte, comme est_titre_bib() du filtre : un préfixe ne suffit pas
// (« Literaturhinweise für die Praxis » n'est pas un titre de bibliographie).
function estTitreBib(texte) {
  const p = aplatir(texte);
  return titresBib().indexOf(p) !== -1;
}

// Année d'une référence : la première entre parenthèses. '' pour une référence sans date,
// null si l'on n'en trouve pas.
function anneeDeReference(texte) {
  const m = texte.match(/\((\d{4})([a-z]?)[^)]{0,30}\)/);
  if (m) { return { annee: m[1], suffixe: m[2] || '', debut: m.index }; }
  const sans = texte.match(/\((?:s\.\s?d\.?|o\.\s?J\.?|n\.d\.?|ohne Jahr|sans date)\)/i);
  if (sans) { return { annee: '', suffixe: '', debut: sans.index }; }
  return null;
}

// Le nom qui forme l'identifiant, comme nom_pour_id() du filtre : le premier mot de deux
// lettres au moins, sans détection de majuscule, pour que les deux côtés concordent.
function nomPourId(entete) {
  const jetons = replier(assainir(entete)).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const j of jetons) {
    if (j.length >= 2) { return j; }
  }
  return 'ref';
}

// Vrai si le paragraphe continue l'entrée précédente, comme est_continuation() du filtre :
// une URL seule, ou une ligne qui commence par une minuscule ASCII sans porter d'année.
// Une initiale accentuée, un astérisque, un chiffre ou « insieme Schweiz (2024) » ouvrent
// donc une entrée.
function estContinuation(texte) {
  if (/^(https?:|www\.)/i.test(texte)) { return true; }
  if (!/^[a-z]/.test(texte)) { return false; }
  return !/\b\d{4}\b/.test(texte.slice(0, 130));
}

// Découpe le markdown d'un article : les paragraphes qui suivent le dernier titre de
// bibliographie, groupés en entrées, chacune avec son identifiant.
//
// Lève dès le début si les tables du filtre sont inaccessibles : sans elles, ni le titre
// de bibliographie ni les identifiants ne sont fiables, et le rédacteur choisirait une
// référence pour rien.
function referencesDuTexte(md) {
  const paras = String(md || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let coupe = -1;
  paras.forEach((p, i) => {
    const m = p.match(/^#+\s*(.+)$/);
    if (m && estTitreBib(normaliser(m[1]))) { coupe = i; }
  });
  if (coupe === -1) { return []; }
  return entreesDesParagraphes(paras.slice(coupe + 1));
}

// Des paragraphes de markdown aux entrées identifiées. Sert au fichier de bibliographie
// comme à la bibliographie du corps.
function entreesDesParagraphes(paragraphes) {
  const entrees = [];
  for (const p of paragraphes) {
    const brut = String(p).trim();
    if (!brut) { continue; }
    if (/^#+\s/.test(brut)) { break; }
    // Liens, échappements et italiques retirés pour la lecture ; le fichier n'est pas modifié.
    const texte = normaliser(brut.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[*\\]/g, ''));
    if (!texte) { continue; }
    if (entrees.length > 0 && estContinuation(texte)) {
      entrees[entrees.length - 1].texte += ' ' + texte;
      continue;
    }
    entrees.push({ texte: texte });
  }
  const vus = {};
  entrees.forEach((e) => {
    const an = anneeDeReference(e.texte);
    const nom = nomPourId(an ? e.texte.slice(0, an.debut) : e.texte.slice(0, 120));
    const base = 'ref-' + nom.slice(0, 24) + '-' + (an && an.annee ? an.annee : 'sd');
    if (vus[base]) {
      vus[base] += 1;
      e.id = base + '-' + String.fromCharCode(96 + vus[base]);
    } else {
      vus[base] = 1;
      e.id = base;
    }
  });
  return entrees;
}

// ---- la bibliographie détachée ----
//
// L'import écrit la bibliographie dans un fichier à part : les références seules, sans
// titre, une par paragraphe. Ses paragraphes sont groupés en entrées, comme dans le filtre.

// <slug>.biblio.md, sur le modèle de <slug>.meta.yaml et <slug>.taches.yaml.
function nomFichierBiblio(slug) {
  return String(slug) + '.biblio.md';
}

// dossierUnites : 'articles' pour un numéro, 'chapitres' pour un livre
// (profil.unites.dossier) ; 'articles' par défaut, pour les appelants propres à la revue
// (export OJS, mise en forme).
function cheminBiblio(racine, slug, dossierUnites) {
  return path.join(racine, dossierUnites || 'articles', slug, nomFichierBiblio(slug));
}

// Les entrées du fichier de bibliographie, ou null si l'article n'en a pas : l'appelant
// cherche alors la bibliographie dans le corps.
function referencesDuFichier(racine, slug) {
  let brut;
  try { brut = fs.readFileSync(cheminBiblio(racine, slug), 'utf8'); }
  catch (e) { return null; }
  return entreesDesParagraphes(String(brut).split(/\n\s*\n/));
}

// ---- le titre de la bibliographie : un réglage de poste ----
//
// La compilation pose le titre de la bibliographie dans la langue de l'article. Ces
// intitulés sont un réglage de config.json (clé `biblio`), fusionné clé par clé comme la
// configuration OJS, et modifiable dans les réglages.
//
// Les valeurs par défaut sont lues dans le filtre (voir chargerTables).
function titresBiblioDefaut() {
  return chargerTables().titresBiblio;
}

function texteTitre(v) {
  return String(v === undefined || v === null ? '' : v).replace(/\s+/g, ' ').trim();
}

// Défauts et surcharge du poste, clé par clé. Une clé présente l'emporte même vide : vider
// le champ donne une bibliographie sans titre.
function normaliserConfigBiblio(brut) {
  const defauts = titresBiblioDefaut();
  const src = (brut && typeof brut.biblio === 'object' && brut.biblio) ? brut.biblio : {};
  const poses = (src.titres && typeof src.titres === 'object') ? src.titres : {};
  const titres = {};
  for (const revue of REVUES_BIBLIO) {
    const surcharge = (poses[revue] && typeof poses[revue] === 'object') ? poses[revue] : {};
    const cible = {};
    for (const langue of LANGUES_BIBLIO) {
      cible[langue] = langue in surcharge
        ? texteTitre(surcharge[langue])
        : texteTitre((defauts[revue] || {})[langue]);
    }
    titres[revue] = cible;
  }
  return { titres: titres };
}

// La configuration effective : ce que le panneau affiche, et ce que la compilation emploie.
function configBiblio() {
  return normaliserConfigBiblio(lireConfigPoste());
}

// Pose les intitulés sans toucher au reste de la configuration ; l'appelant écrit le
// résultat avec ecrireConfigPoste.
function configAvecTitresBiblio(cfg, titres) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  const biblio = Object.assign({}, (sortie.biblio && typeof sortie.biblio === 'object')
    ? sortie.biblio : {});
  biblio.titres = normaliserConfigBiblio({ biblio: { titres: titres } }).titres;
  sortie.biblio = biblio;
  return sortie;
}

// Pose desactiverLiensReferences sans toucher au reste de la configuration ; l'appelant
// écrit le résultat avec ecrireConfigPoste. Le filtre szh-citations.lua relit cette clé
// dans le même config.json (lire_config_poste) : c'est par ce fichier que le réglage de
// VSCodium atteint la compilation dans la WSL.
function configAvecLiensDesactives(cfg, desactiver) {
  const sortie = Object.assign({}, (cfg && typeof cfg === 'object') ? cfg : {});
  sortie.desactiverLiensReferences = desactiver === true;
  return sortie;
}

// ---- pose du lien ----

// Le lien markdown à écrire à la place de l'appel. Un appel déjà lié est reciblé plutôt
// que réenrobé.
function lienVersReference(appel, id) {
  const t = String(appel);
  const deja = t.match(/^\[([\s\S]*)\]\(#[^)]*\)$/);
  const texte = deja ? deja[1] : t;
  return '[' + texte + '](#' + id + ')';
}

// Sélection vide : l'appel autour du curseur, c'est-à-dire le lien déjà posé (pour le
// recibler), sinon la parenthèse qui l'entoure.
function plageDeLAppel(ligne, colonne) {
  const l = String(ligne || '');
  const lien = /\[[^\]]*\]\(#[^)]*\)/g;
  let m;
  while ((m = lien.exec(l)) !== null) {
    if (colonne >= m.index && colonne <= m.index + m[0].length) {
      return { debut: m.index, fin: m.index + m[0].length };
    }
  }
  const ouvre = l.lastIndexOf('(', Math.max(0, colonne - 1));
  if (ouvre === -1) { return null; }
  const ferme = l.indexOf(')', ouvre);
  if (ferme === -1 || ferme < colonne - 1) { return null; }
  return { debut: ouvre, fin: ferme + 1 };
}

module.exports = {
  aplatir, replier, normaliser, estTitreBib, estContinuation, nomPourId, referencesDuTexte,
  entreesDesParagraphes, referencesDuFichier, nomFichierBiblio, cheminBiblio,
  titresBiblioDefaut, normaliserConfigBiblio, configBiblio, configAvecTitresBiblio,
  configAvecLiensDesactives,
  REVUES_BIBLIO, LANGUES_BIBLIO,
  lienVersReference, plageDeLAppel, caracteresSansRepli, cheminDuFiltre, oublierTables,
  emplacementsDuFiltre
};
