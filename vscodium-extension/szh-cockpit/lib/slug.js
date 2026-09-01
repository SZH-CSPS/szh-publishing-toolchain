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
// ⚠ Ni cette borne ni le retrait du numéro de tête ci-dessous ne doivent entrer dans
// `slugifier` : il nomme aussi les fichiers de portraits, référencés par le champ `photo`
// des fiches.
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

// Un numéro de tête ne se reconnaît qu'à un séparateur EXPLICITE — soulignement ou tiret —
// collé au nombre : « 4_Titre », « 12-Titre », « 01-… » (chapitres-word/LISEZ-MOI.txt et
// articles-word/LISEZ-MOI.txt donnent tous deux cette forme comme convention de rangement).
// Un nombre suivi d'un ESPACE fait partie du titre lui-même : « 2024 en chiffres »,
// « 20 minutes chrono », « 3 jours plus tard ». Regression corrigée du 31.08.2026 au
// 01.09.2026 : une regex `^[0-9]+-` appliquée APRÈS slugifier() ne peut plus distinguer les
// deux cas, l'espace du titre étant déjà devenu un tiret comme le soulignement du
// séparateur. Il faut donc juger sur le nom BRUT, avant cette perte d'information — d'où
// `aUnNumeroDeTete` ci-dessous, appliqué au nom sans extension, jamais au slug déjà collapsé.
function aUnNumeroDeTete(nomFichier) {
  return /^[0-9]+[_-]/.test(String(nomFichier).replace(/\.[^.]*$/, ''));
}

// Le numéro de tête du Word, s'il y en a un : « 4_Titre.docx » vaut 4, « 12-Titre.docx »
// vaut 12. Ce nombre donnait autrefois l'ordre dans le numéro par le tri alphabétique du
// nom de dossier (d'où le complément à deux chiffres qui vivait ici) ; depuis que ce
// nommage n'est plus imposé aux nouveaux articles (B1), il migre vers la clé
// `ordre-articles` de ausgabe.yaml — la même que « Monter »/« Descendre » modifient déjà,
// et qui ne ment jamais sur l'ordre voulu par le rédacteur. Rend null si le nom ne
// commence pas par un nombre suivi d'un séparateur explicite (voir aUnNumeroDeTete
// ci-dessus) : « 2024 en chiffres.docx » n'a pas de numéro de tête, 2024 fait partie du
// titre, et le prendre pour un ordre rangerait l'article en 2024ᵉ position.
//
// ⚠ Câblage restant hors de ce périmètre : rien n'appelle encore cette fonction à l'import
// pour écrire l'ordre initial dans `ordre-articles`. Voir le repère laissé dans
// extension.js (fonction lancerConversion, bloc `nouveaux`) pour brancher ce nombre au
// moment où un nouvel article apparaît.
function numeroOrdreArticle(nomFichier) {
  if (!aUnNumeroDeTete(nomFichier)) { return null; }
  const m = slugifier(nomFichier).match(/^([0-9]+)-/);
  return m ? parseInt(m[1], 10) : null;
}

// Slug d'un article : slugifier, puis retrait du numéro de tête, s'il y en a un — jugé sur
// le nom BRUT (aUnNumeroDeTete), jamais sur le slug déjà collapsé, où l'espace d'un titre
// commençant par un nombre et le séparateur d'un vrai numéro de tête sont devenus le même
// tiret. Les .docx livrés numérotés sont nommés « 4_Titre.docx », et ce nombre ne nomme
// plus le dossier (B1, demande de Robin : les numéros de dossier ne survivent pas à un
// déplacement dans l'ordre) — voir numeroOrdreArticle() ci-dessus pour ce qu'il devient.
//
// La cible « import » du Makefile applique les mêmes règles dans le même ordre, retrait
// puis borne : si les deux slugs divergent, le badge « déjà converti » de la barre
// latérale désigne un article qui n'existe pas. ⚠ Au 01.09.2026, le Makefile n'a PAS encore
// ce garde-fou (sed -E 's/^[0-9]+-//' inconditionnel, pipeline/Makefile:547) : un import en
// CLI pur ampute donc encore un titre numérique de tête — voir le repère laissé dans le
// Makefile lui-même (~L486) pour la modification à y reporter.
function slugifierArticle(nomFichier) {
  const s = slugifier(nomFichier);
  return bornerSlug(aUnNumeroDeTete(nomFichier) ? s.replace(/^[0-9]+-/, '') : s);
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
  slugifier, slugifierArticle, slugifierArticleUnique, numeroOrdreArticle,
  LONGUEUR_MAX_SLUG_ARTICLE, MAX_HOMONYMES
};
