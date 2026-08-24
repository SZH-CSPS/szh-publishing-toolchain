// Liage manuel d'un appel de citation à une référence. Le liage automatique se fait à la
// compilation, dans pipeline/filters/szh-citations.lua ; ce module ne sert qu'aux appels
// que le filtre laisse de côté — un nom mal orthographié dans le texte, une parenthèse
// déséquilibrée, un appel ambigu entre deux références de même auteur et de même année.
//
// Le rédacteur sélectionne l'appel dans le texte, choisit la référence dans la liste, et
// l'appel devient un lien markdown « [(Shaw et al., 2023)](#ref-shaw-2023) » — que pandoc
// rend nativement et que le filtre respecte tel quel.
//
// ⚠ Contrat avec le filtre Lua : referencesDuTexte() doit découper la liste et calculer les
// identifiants exactement comme lui, sinon le lien posé ici pointerait dans le vide. Le repli
// des lettres accentuées n'est donc pas recopié ici : il est lu dans le filtre lui-même.
// test/js/ancrages.test.js exécute les deux côtés sur la même liste de noms et compare.
'use strict';

const fs = require('fs');
const path = require('path');

// ---- identifiants : le repli des lettres est lu dans le filtre, pas recopié ici ----

// Le filtre du pipeline porte les tables de repli, et il est seul à les porter : elles sont
// relues ici. Une table courte d'un côté et normalize('NFD') de l'autre, c'étaient deux
// identifiants — « Zieliński » donnait « zielinski » au cockpit et « zieliski » à la
// compilation, et le lien posé par « Lier à une référence » désignait une ancre que le PDF
// n'a jamais portée. Le rédacteur n'en voyait rien : un lien mort ne se signale pas.
//
// Deux emplacements, dans cet ordre : le dépôt (développement et tests), puis le toolkit
// installé — celui qui compilera vraiment l'article, donc celui dont les identifiants font
// loi sur un poste de rédaction. SZH_FILTRE_CITATIONS impose un fichier, ce dont le test
// se sert pour éprouver un filtre d'un autre format sans toucher à l'installation.
//
// Mêmes chemins que lib/archivage.js et windows/szh-common.ps1.
const FILTRES = [
  path.resolve(__dirname, '..', '..', '..', 'pipeline', 'filters', 'szh-citations.lua'),
  path.join('C:\\ProgramData\\SZH', 'toolkit', 'pipeline', 'filters', 'szh-citations.lua')
];

function emplacements() {
  return process.env.SZH_FILTRE_CITATIONS ? [process.env.SZH_FILTRE_CITATIONS] : FILTRES;
}

// La liste telle qu'elle est écrite, sans l'override d'environnement. Exposée pour que le
// test en vérifie la forme : un chemin Windows dont les contre-obliques ne sont pas doublées
// reste une chaîne JavaScript valide, mais « C:\ProgramData\SZH » y perd ses séparateurs
// — \P et \S ne sont pas des échappements reconnus — et vaut « C:ProgramDataSZH ». La faute
// est invisible à la lecture, et elle ne se voit nulle part tant que le dépôt répond en
// premier : sur un poste de rédaction, où l'extension vit sous .vscode-oss, c'est pourtant
// le seul emplacement qui mène quelque part.
function emplacementsDuFiltre() { return FILTRES.slice(); }

let tables = null;

// Deux pannes, deux causes, deux messages. Les confondre, c'était dire au rédacteur qu'une
// table Lua manquait alors que ses deux moitiés de logiciel n'allaient simplement pas
// ensemble : le format des tables a changé une fois, il changera encore.
//
//   'absent'      : aucun emplacement ne porte le filtre — poste non préparé.
//   'discordant'  : le filtre est là, mais sans les tables attendues. Le cockpit et l'outil
//                   de composition ne sont pas de la même version — et rien ici ne dit
//                   lequel des deux est en avance, ni n'a besoin de le dire : la mise à
//                   jour règle les deux sens.
//
// Le détail technique — chemin, nom de table, compte de jetons — part dans le journal de
// l'hôte. Il n'a rien à faire dans une boîte de dialogue, et tout à faire dans un rapport
// de panne.
function erreurRepli(cause, detail) {
  const e = new Error(detail);
  e.szhRepli = cause;
  e.messageCle = cause === 'discordant'
    ? 'cit.toolkit.discordant' : 'cit.toolkit.absent';
  try { console.warn('[citations] ' + detail); } catch (err) { /* hôte sans console */ }
  return e;
}

// Le corps d'un `local NOM = { … }` du filtre : de l'en-tête jusqu'à l'accolade en début de
// ligne. Les données du filtre sont toutes indentées, aucune n'est prise pour la fin.
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
  // Le latin fait 656 points de code à lui seul. Sous ce seuil, la table lue est tronquée
  // ou d'un format qu'on ne comprend plus : même conclusion qu'une table absente, plutôt
  // que des ancres que la compilation ne posera pas.
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
  tables = { chemin: chemin, repli: repli, ignores: ignores };
  return tables;
}

// Relâche les tables mémoïsées : le test change de filtre en cours de processus.
function oublierTables() { tables = null; }

// Le fichier d'où viennent les tables, pour un message d'erreur ou un diagnostic.
function cheminDuFiltre() { return chargerTables().chemin; }

const signales = new Map();

// Un caractère hors des tables est retiré, jamais avalé : il part dans le journal de l'hôte,
// comme le filtre l'écrit sur stderr à la compilation. Une ligne par caractère, pas une par
// occurrence.
function signaler(cp) {
  if (signales.has(cp)) { return; }
  const msg = '[citations] ⚠ caractère sans repli ASCII, retiré des identifiants : « '
    + String.fromCodePoint(cp) + ' » (U+'
    + cp.toString(16).toUpperCase().padStart(4, '0') + ')';
  signales.set(cp, msg);
  try { console.warn(msg); } catch (e) { /* hôte sans console */ }
}

// Ce que le repli a laissé tomber depuis le chargement, pour un test ou un diagnostic.
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

const TITRES_BIB = [
  'literatur', 'literaturverzeichnis', 'literaturangaben', 'literaturhinweise',
  'bibliografie', 'bibliografia', 'bibliographie', 'bibliography',
  'reference', 'references', 'referenzen', 'quellen', 'quellenverzeichnis',
  'ouvragescites', 'zitierteliteratur', 'verwendeteliteratur', 'weiterfuhrendeliteratur'
];

function estTitreBib(texte) {
  const p = aplatir(texte);
  return TITRES_BIB.some((t) => p === t || p.startsWith(t));
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

// Nom qui nomme l'identifiant : même calcul que nom_pour_id() du filtre, sur la même table
// de repli. Le premier mot de deux lettres au moins, sans aucune détection de majuscule —
// c'est ce qui permet aux deux langages de tomber sur le même identifiant.
function nomPourId(entete) {
  const jetons = replier(assainir(entete)).toLowerCase().match(/[a-z0-9]+/g) || [];
  for (const j of jetons) {
    if (j.length >= 2) { return j; }
  }
  return 'ref';
}

// Une entrée commence-t-elle ici, ou continue-t-elle la précédente ? Même règle que
// est_continuation() du filtre Lua, et pour la même raison : une suite est une ligne d'URL
// seule, ou une ligne qui commence par une minuscule ASCII sans porter d'année. Une
// initiale accentuée, un astérisque, un chiffre ou « insieme Schweiz (2024) » ouvrent donc
// une entrée.
function estContinuation(texte) {
  if (/^(https?:|www\.)/i.test(texte)) { return true; }
  if (!/^[a-z]/.test(texte)) { return false; }
  return !/\b\d{4}\b/.test(texte.slice(0, 130));
}

// Découpe le markdown d'un article : les paragraphes qui suivent le dernier titre de
// bibliographie, groupés en entrées, chacune avec son identifiant.
//
// Lève si les tables de repli sont inaccessibles, et dès la première ligne : reconnaître
// « Références » comme titre de bibliographie en a besoin autant que calculer un
// identifiant. Rien à sauver ici, donc échouer tôt : lister des références pour échouer
// ensuite au moment de poser l'ancre ferait perdre son choix au rédacteur, et lui offrir
// des identifiants calculés sans la table reviendrait à lui proposer des ancres mortes.
function referencesDuTexte(md) {
  const paras = String(md || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let coupe = -1;
  paras.forEach((p, i) => {
    const m = p.match(/^#+\s*(.+)$/);
    if (m && estTitreBib(normaliser(m[1]))) { coupe = i; }
  });
  if (coupe === -1) { return []; }
  const entrees = [];
  for (let i = coupe + 1; i < paras.length; i++) {
    const brut = paras[i];
    if (/^#+\s/.test(brut)) { break; }
    // Le .md porte des échappements et des italiques : on les retire pour lire, jamais
    // pour écrire.
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

// ---- pose du lien ----

// Le lien markdown à écrire à la place de l'appel. Un appel déjà lié est reciblé plutôt
// que réenrobé.
function lienVersReference(appel, id) {
  const t = String(appel);
  const deja = t.match(/^\[([\s\S]*)\]\(#[^)]*\)$/);
  const texte = deja ? deja[1] : t;
  return '[' + texte + '](#' + id + ')';
}

// Sélection vide : on prend l'appel autour du curseur, c'est-à-dire la parenthèse qui
// l'entoure — ou le lien déjà posé, pour permettre de le recibler.
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
  lienVersReference, plageDeLAppel, caracteresSansRepli, cheminDuFiltre, oublierTables,
  emplacementsDuFiltre
};
