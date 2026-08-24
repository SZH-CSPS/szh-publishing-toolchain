// Fabrique les slugs (noms de dossier et de fichier) des articles et des portraits.
'use strict';

// Reproduit le slug de la cible « import » du Makefile :
//   nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
// Faute d'iconv en JS, on translittère les ligatures françaises à la main puis on
// retire les diacritiques via NFD. Divergence connue : un symbole exotique
// qu'iconv//TRANSLIT rendrait par un mot devient ici un tiret.
function slugifier(nomFichier) {
  let s = nomFichier.replace(/\.[^.]*$/, '');
  s = s
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'article';
}

// Longueur maximale d'un slug d'article. Le slug nomme le dossier et son .md homonyme :
// il compte deux fois par chemin, et deux fois de plus sous out/. Sans borne, un titre
// long donne des chemins de plus de 340 caractères, au delà de la limite Windows de 260 ;
// la compilation passe, mais la synchronisation OneDrive et l'Explorateur trébuchent.
//
// ⚠ Ni cette borne ni le complément à deux chiffres ne doivent entrer dans `slugifier` :
// il nomme aussi les fichiers de portraits, référencés par le champ `photo` des fiches.
const LONGUEUR_MAX_SLUG_ARTICLE = 39;

// Coupe au dernier mot entier plutôt qu'au caractère près : « …-technologies-peu »
// passerait pour un bug.
function bornerSlug(s) {
  if (s.length <= LONGUEUR_MAX_SLUG_ARTICLE) { return s; }
  const coupe = s.slice(0, LONGUEUR_MAX_SLUG_ARTICLE);
  const i = coupe.lastIndexOf('-');
  let court = i > 0 ? coupe.slice(0, i) : coupe;
  // Une élision devient un segment d'une lettre (« d'enseignement » ->
  // « d-enseignement ») et laisse un « -d » orphelin en fin de coupe. On ne le
  // retire que s'il reste deux segments, pour ne pas réduire le slug au numéro d'ordre.
  const sansOrphelin = court.replace(/(-[a-z0-9])+$/, '');
  if (sansOrphelin.indexOf('-') !== -1) { court = sansOrphelin; }
  return court;
}

// Slug d'un article : slugifier, puis complément à deux chiffres du nombre de tête. Les
// .docx livrés sont nommés « 4_Titre.docx » et ce nombre donne l'ordre dans le numéro ;
// sans complément, le tri alphabétique placerait « 10- » avant « 4- ».
//
// La cible « import » du Makefile applique les mêmes règles dans le même ordre,
// complément puis borne : si les deux slugs divergent, le badge « déjà converti » de la
// barre latérale désigne un article qui n'existe pas.
function slugifierArticle(nomFichier) {
  const s = slugifier(nomFichier);
  // Borne après le complément, qui ajoute un caractère : résultat garanti <= 39.
  return bornerSlug(s.replace(/^([0-9])(?![0-9])/, '0$1'));
}

// Nombre maximal d'homonymes désambiguïsés pour un même slug. Au-delà, l'appelant doit
// refuser l'import plutôt que d'inventer un nom : 99 articles au titre identique dans un
// numéro, c'est une erreur de dépôt, pas un cas à servir.
const MAX_HOMONYMES = 99;

// Deux Word aux titres proches donnent le même slug une fois borné à 39 caractères :
// « Inklusive Bildung in der Sekundarstufe I - Teil 1 » et « … Teil 2 » se réduisent tous
// deux à « inklusive-bildung-in-der-sekundarstufe ». Les articles en plusieurs parties
// étant courants, le second reçoit ici un suffixe « -2 », le troisième « -3 », etc.
//
// La place du suffixe est prise sur la fin du slug au caractère près, et non au mot entier
// comme bornerSlug : le « -2 » dit déjà que le nom est coupé, et garder
// « …-sekundarstuf-2 » plutôt que « …-in-der-2 » laisse la famille reconnaissable dans
// l'explorateur de fichiers.
//
// `slugsPris` énumère les slugs déjà occupés (côté Makefile : les articles/<slug>/<slug>.md
// existants). Rend null si les 99 tentatives sont épuisées.
//
// La cible « import » du Makefile applique exactement la même boucle : si les deux
// divergent, le badge « déjà converti » de la barre latérale désigne un article qui
// n'existe pas.
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
  slugifier, slugifierArticle, slugifierArticleUnique,
  LONGUEUR_MAX_SLUG_ARTICLE, MAX_HOMONYMES
};
