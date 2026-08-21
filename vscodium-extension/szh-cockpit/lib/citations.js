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
// identifiants exactement comme lui, sinon le lien posé ici pointerait dans le vide. Les
// deux implémentations sont contrôlées par test/js/contrats.test.js.
'use strict';

// ---- identifiants (miroir de plat() et de la dérivation d'id du filtre Lua) ----

// Chaîne comparable : ligatures dépliées, diacritiques retirés, minuscules, et tout ce qui
// n'est pas [a-z0-9] supprimé (et non remplacé par un tiret, contrairement à slug.js).
function aplatir(t) {
  return String(t || '')
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
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

// Nom qui nomme l'identifiant : miroir exact de nom_pour_id() du filtre Lua. Accents et
// ligatures repliés, puis le premier mot de deux lettres au moins. Aucune détection de
// majuscule, pour que les deux langages tombent sur le même identifiant.
function nomPourId(entete) {
  const f = String(entete || '')
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const jetons = f.match(/[a-z0-9]+/g) || [];
  for (let i = 0; i < jetons.length; i++) {
    if (jetons[i].length >= 2) { return jetons[i]; }
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
  aplatir, normaliser, estTitreBib, estContinuation, nomPourId, referencesDuTexte,
  lienVersReference, plageDeLAppel
};
