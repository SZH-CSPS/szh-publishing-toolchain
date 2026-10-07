// Fabrique les slugs (noms de dossier et de fichier) des articles et des portraits.
'use strict';

// Reproduit le slug de la cible « import » du Makefile :
//   nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
// Sans iconv en JS, les ligatures sont translittérées à la main et les diacritiques
// retirés par NFD. Écart connu : un symbole qu'iconv rendrait par un mot devient un tiret.
function slugifier(nomFichier) {
  let s = nomFichier.replace(/\.[^.]*$/, '');
  s = s
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'article';
}

// Longueur maximale d'un slug d'article. Le slug nomme le dossier et son .md, et revient
// encore sous out/ : sans borne, un titre long dépasse la limite Windows de 260 caractères
// par chemin, et OneDrive comme l'Explorateur échouent.
//
// La borne et le retrait du numéro de tête restent hors de `slugifier`, qui nomme aussi
// les portraits référencés par le champ `photo` des fiches.
const LONGUEUR_MAX_SLUG_ARTICLE = 39;

// Coupe au dernier mot entier : un mot tronqué (« …-technologies-peu ») passerait pour un bug.
function bornerSlug(s) {
  if (s.length <= LONGUEUR_MAX_SLUG_ARTICLE) { return s; }
  const coupe = s.slice(0, LONGUEUR_MAX_SLUG_ARTICLE);
  const i = coupe.lastIndexOf('-');
  let court = i > 0 ? coupe.slice(0, i) : coupe;
  // Une élision (« d'enseignement » -> « d-enseignement ») peut laisser un « -d » en fin
  // de coupe. On le retire s'il reste au moins deux segments.
  const sansOrphelin = court.replace(/(-[a-z0-9])+$/, '');
  if (sansOrphelin.indexOf('-') !== -1) { court = sansOrphelin; }
  return court;
}

// Un numéro de tête est un nombre suivi d'un soulignement ou d'un tiret : « 4_Titre »,
// « 12-Titre » (convention des LISEZ-MOI.txt de articles-word/ et chapitres-word/). Suivi
// d'une espace, le nombre fait partie du titre (« 2024 en chiffres »). Le test se fait sur
// le nom brut : dans le slug, espace et séparateur sont devenus le même tiret.
function aUnNumeroDeTete(nomFichier) {
  return /^[0-9]+[_-]/.test(String(nomFichier).replace(/\.[^.]*$/, ''));
}

// Le numéro de tête du Word (« 4_Titre.docx » -> 4), ou null s'il n'y en a pas.
// lib/import-hote.js s'en sert pour placer le nouvel article dans `ordre-articles`
// d'ausgabe.yaml.
function numeroOrdreArticle(nomFichier) {
  if (!aUnNumeroDeTete(nomFichier)) { return null; }
  const m = slugifier(nomFichier).match(/^([0-9]+)-/);
  return m ? parseInt(m[1], 10) : null;
}

// Slug d'un article : slugifier, retrait du numéro de tête s'il y en a un, puis borne.
// Le préfixe à deux chiffres que reçoit ensuite le dossier est son rang dans le numéro
// (prefixerNouveauxArticles() de lib/import-hote.js), pas le numéro de tête du Word.
//
// La cible « import » du Makefile applique les mêmes règles dans le même ordre : si les
// deux slugs divergent, le badge « déjà converti » désigne un article qui n'existe pas.
function slugifierArticle(nomFichier) {
  const s = slugifier(nomFichier);
  return bornerSlug(aUnNumeroDeTete(nomFichier) ? s.replace(/^[0-9]+-/, '') : s);
}

// Nombre maximal d'homonymes pour un même slug. Au-delà, l'appelant refuse l'import.
const MAX_HOMONYMES = 99;

// Deux Word aux titres proches peuvent donner le même slug une fois borné (« … Teil 1 » et
// « … Teil 2 »). Le deuxième reçoit « -2 », le troisième « -3 », etc.
//
// La place du suffixe se prend au caractère près, pas au mot entier comme dans bornerSlug :
// « …-sekundarstuf-2 » reste plus reconnaissable que « …-in-der-2 ».
//
// `slugsPris` : les slugs déjà occupés. Rend null après 99 tentatives. La cible « import »
// du Makefile applique la même boucle.
function slugifierArticleUnique(nomFichier, slugsPris) {
  const pris = new Set(slugsPris || []);
  const base = slugifierArticle(nomFichier);
  if (!pris.has(base)) { return base; }
  for (let n = 2; n <= MAX_HOMONYMES; n++) {
    const suffixe = '-' + n;
    let tronc = base;
    if (tronc.length + suffixe.length > LONGUEUR_MAX_SLUG_ARTICLE) {
      tronc = tronc.slice(0, LONGUEUR_MAX_SLUG_ARTICLE - suffixe.length).replace(/-+$/, '');
    }
    const candidat = tronc + suffixe;
    if (!pris.has(candidat)) { return candidat; }
  }
  return null;
}

module.exports = {
  slugifier, slugifierArticle, slugifierArticleUnique, numeroOrdreArticle,
  LONGUEUR_MAX_SLUG_ARTICLE, MAX_HOMONYMES
};
