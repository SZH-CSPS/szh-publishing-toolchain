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

// Slug d'un ARTICLE (D93) : slugifier, puis complément à DEUX CHIFFRES du nombre de
// tête. Les .docx livrés sont nommés « 4_Titre.docx », « 10_Titre.docx » — le nombre
// donne l'ordre de l'article dans le numéro. Sans complément, le tri alphabétique des
// slugs place « 10- » avant « 4- » et l'ordre éditorial est perdu : on écrit donc
// « 04-titre ». Un nombre de DEUX CHIFFRES OU PLUS est laissé tel quel (« 10-titre »,
// « 2026-bilan ») et un nom qui ne commence pas par un chiffre n'est pas touché.
//
// ⚠ Le Makefile (cible import) applique EXACTEMENT la même règle : les deux slugs
// doivent rester identiques, sinon le badge « déjà converti » de la barre latérale
// désigne un article qui n'existe pas.
//
// ⚠ NE PAS appliquer ce complément dans `slugifier` : celui-ci nomme aussi les
// fichiers de portraits (slugifier(prenom + '-' + nom)), où un « 0 » de tête n'aurait
// aucun sens.
function slugifierArticle(nomFichier) {
  const s = slugifier(nomFichier);
  return s.replace(/^([0-9])(?![0-9])/, '0$1');
}

module.exports = { slugifier, slugifierArticle };
