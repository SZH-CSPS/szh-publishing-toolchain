// Seuils de qualité des images, et verdict rendu au gestionnaire des médias. Les dimensions
// sont lues ailleurs (lireDimensionsImage).
//
// D'où viennent les nombres. Largeur de composition : print.css pose @page size A4 avec
// 72 px de marge à gauche et à droite, soit 794 - 144 = 650 px CSS ≈ 6,77 pouces ≈ 17,2 cm.
// Une image en pleine largeur y est ramenée par `figure img { max-width: 100% }` : sa
// largeur en pixels décide donc de sa résolution d'impression.
//   2000 px sur 6,77 po ≈ 300 ppp -> qualité d'impression visée, et 2x sur un écran
//                                    standard : c'est le conseillé.
//   1000 px sur 6,77 po ≈ 150 ppp -> plancher ; en dessous, le flou se voit à
//                                    l'impression comme sur un écran HiDPI.
// Portraits : pipeline/portraits.py sort du 400 x 400 (TAILLE_SORTIE) pour un affichage
// de 28 mm de côté (print.css, .szh-auteur-photo), soit ~360 ppp à l'impression et près de
// 4x sur un écran standard. Mais le script recadre autour du visage : le carré vaut environ
// 2,5 fois la hauteur du visage (FACE_PERCENT = 40). D'où :
//   400 px sur le petit côté  -> plancher : en dessous, le recadrage agrandit ;
//   1000 px sur le petit côté -> conseillé : un 400 x 400 net sans agrandissement.
//
// Le verdict porte sur le fichier source : une image trop petite ne se rattrape pas en aval.
'use strict';

// Deux familles, deux usages : « figure » pour une image du texte, affichable en pleine
// largeur ; « portrait » pour une photo d'autrice ou d'auteur, réduite à une vignette.
const SEUILS = {
  figure: { min: 1000, conseille: 2000 },
  portrait: { min: 400, conseille: 1000 }
};

// Les vectoriels n'ont pas de résolution : un SVG est net à toute taille.
function estVectoriel(nom) {
  return /\.svg$/i.test(String(nom || ''));
}

// -> { famille, niveau, mesure, min, conseille }
//   niveau = 'vectoriel' | 'inconnu' | 'insuffisant' | 'juste' | 'ok'
//   mesure = le nombre de pixels comparé aux seuils, ou null
// La famille choisit le libellé de l'encadré.
// Une figure se juge sur sa largeur, qui remplit la colonne ; un portrait sur son petit
// côté, le recadrage prenant un carré.
// `options.reduit` (réglage « réduire les warnings d'impression ») : le palier
// « conseillé » disparaît ; seule une image sous le minimum est signalée.
function qualiteImage(famille, dimensions, nom, options) {
  const cle = SEUILS[famille] ? famille : 'figure';
  const seuils = SEUILS[cle];
  const res = { famille: cle, niveau: 'inconnu', mesure: null, min: seuils.min, conseille: seuils.conseille };
  if (estVectoriel(nom)) { res.niveau = 'vectoriel'; return res; }
  const l = dimensions ? Number(dimensions.largeur) : 0;
  const h = dimensions ? Number(dimensions.hauteur) : 0;
  if (!(l > 0) || !(h > 0)) { return res; }        // dimensions illisibles : pas de verdict
  res.mesure = cle === 'portrait' ? Math.min(l, h) : l;
  const reduit = !!(options && options.reduit);
  if (res.mesure < seuils.min) { res.niveau = 'insuffisant'; }
  else if (res.mesure < seuils.conseille) { res.niveau = reduit ? 'ok' : 'juste'; }
  else { res.niveau = 'ok'; }
  return res;
}

module.exports = { SEUILS, qualiteImage, estVectoriel };
