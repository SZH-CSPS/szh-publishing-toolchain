// SZH cockpit — slug (reproduit le slug du Makefile). Extrait de extension.js (R6).
'use strict';

// Reproduit le slug du Makefile (cible import) :
//   nom sans extension | iconv ASCII//TRANSLIT | minuscules | [^a-z0-9]+ -> '-' | trim '-'
// En JS sans iconv : on translittère les ligatures françaises courantes puis on
// supprime les diacritiques (NFD). Divergence connue (rare) : un symbole exotique
// qu'iconv//TRANSLIT convertirait en mot précis devient ici un tiret — sans effet
// visible sur des titres d'articles réels (accents et ligatures usuels couverts).
function slugifier(nomFichier) {
  let s = nomFichier.replace(/\.[^.]*$/, '');
  s = s
    .replace(/[œŒ]/g, 'oe').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  s = s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s || 'article';
}

// Longueur maximale d'un slug d'ARTICLE : 39 caractères.
//
// Le slug nomme le DOSSIER *et* son .md homonyme, donc il compte DEUX FOIS dans
// chaque chemin — et deux fois de plus sous out/. Mesuré sur la bibliothèque
// SharePoint de rédaction : sans borne, un titre d'article réel (98 caractères)
// produit des chemins de 340 à 350 caractères, au-delà de la limite Windows de
// 260. La compilation passe (WSL s'en moque) mais la synchronisation OneDrive et
// l'Explorateur trébuchent — le symptôme apparaît donc loin de la cause.
//
// La coupe se fait au DERNIER MOT ENTIER (dernier « - » avant la borne) :
// « …-technologies-peu » passerait pour un bug, « …-technologies » se lit. Repli
// sur la coupe sèche si les 39 premiers caractères ne contiennent aucun tiret. Les
// fragments d'élision d'une lettre laissés en fin de coupe sont retirés à leur tour.
//
// ⚠ NE PAS borner dans `slugifier` : celui-ci nomme aussi les fichiers de
// portraits, dont les noms sont déjà courts et RÉFÉRENCÉS par les fiches
// d'auteur·e·s (champ `photo`) — les tronquer casserait les portraits existants.
const LONGUEUR_MAX_SLUG_ARTICLE = 39;

function bornerSlug(s) {
  if (s.length <= LONGUEUR_MAX_SLUG_ARTICLE) { return s; }
  const coupe = s.slice(0, LONGUEUR_MAX_SLUG_ARTICLE);
  const i = coupe.lastIndexOf('-');
  let court = i > 0 ? coupe.slice(0, i) : coupe;
  // Une élision française devient un segment d'une lettre à la slugification
  // (« d'enseignement » -> « d-enseignement ») : coupée en fin de slug, elle laisse
  // un « -d » orphelin. On le retire — mais seulement s'il reste au moins deux
  // segments, pour ne jamais réduire un slug à son seul numéro d'ordre.
  const sansOrphelin = court.replace(/(-[a-z0-9])+$/, '');
  if (sansOrphelin.indexOf('-') !== -1) { court = sansOrphelin; }
  return court;
}

// Slug d'un ARTICLE (D93) : slugifier, puis complément à DEUX CHIFFRES du nombre de
// tête. Les .docx livrés sont nommés « 4_Titre.docx », « 10_Titre.docx » — le nombre
// donne l'ordre de l'article dans le numéro. Sans complément, le tri alphabétique des
// slugs place « 10- » avant « 4- » et l'ordre éditorial est perdu : on écrit donc
// « 04-titre ». Un nombre de DEUX CHIFFRES OU PLUS est laissé tel quel (« 10-titre »,
// « 2026-bilan ») et un nom qui ne commence pas par un chiffre n'est pas touché.
//
// ⚠ Le Makefile (cible import) applique EXACTEMENT les mêmes règles — complément à
// deux chiffres ET borne de 39 caractères, dans cet ordre : les deux slugs
// doivent rester identiques, sinon le badge « déjà converti » de la barre latérale
// désigne un article qui n'existe pas.
//
// ⚠ NE PAS appliquer ce complément dans `slugifier` : celui-ci nomme aussi les
// fichiers de portraits (slugifier(prenom + '-' + nom)), où un « 0 » de tête n'aurait
// aucun sens.
function slugifierArticle(nomFichier) {
  const s = slugifier(nomFichier);
  // Borne APRÈS le complément (qui ajoute un caractère) : résultat garanti <= 39.
  return bornerSlug(s.replace(/^([0-9])(?![0-9])/, '0$1'));
}

module.exports = { slugifier, slugifierArticle };
