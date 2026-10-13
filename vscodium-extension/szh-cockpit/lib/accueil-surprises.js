// Ce que l'Accueil montre en marge du travail : la Prontogenda tirée de
// calendrier.csv, et les libellés des jeux de media/_jeux.js.
'use strict';

const { T } = require('./i18n');
const calendrier = require('./calendrier');

// L'encadré du calendrier, tel que la page l'affiche. Un fichier illisible donne un encadré
// vide, et ses erreurs vont à la console.
function calendrierDeLaSemaine(maintenant, langue) {
  const { entrees, erreurs } = calendrier.lire();
  for (const e of erreurs) { console.warn('calendrier.csv, ligne ' + e.ligne + ' : ' + e.motif); }
  return {
    titre: T('calendrier.titre'), aujourdhui: T('calendrier.aujourdhui'),
    evenements: calendrier.semaine(entrees, maintenant, langue)
  };
}

// Injectés dans __TXT_JEUX__.
function textesJeux() {
  return {
    casse: T('jeu.casse'), serpent: T('jeu.serpent'), pong: T('jeu.pong'),
    aideCasse: T('jeu.aide.casse'), aideSerpent: T('jeu.aide.serpent'), aidePong: T('jeu.aide.pong'),
    pret: T('jeu.pret'), score: T('jeu.score'), vies: T('jeu.vies'), pongScore: T('jeu.pong.score'),
    perdu: T('jeu.perdu'), gagne: T('jeu.gagne'), fermer: T('jeu.fermer')
  };
}

module.exports = { calendrierDeLaSemaine, textesJeux };
