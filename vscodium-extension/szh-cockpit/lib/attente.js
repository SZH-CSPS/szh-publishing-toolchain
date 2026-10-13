// Les phrases d'attente des opérations longues (clés « attente.phrase.* » de lib/i18n.js),
// et le message de barre d'état qui les fait défiler.
'use strict';

const { T, TEXTES_COCKPIT } = require('./i18n');

const PREFIXE = 'attente.phrase.';
// Une opération courte ne montre que son message : la première phrase vient après DELAI.
const DELAI = 5000;
const PERIODE = 4000;

function clesPhrases() {
  return Object.keys(TEXTES_COCKPIT.fr).filter((c) => c.startsWith(PREFIXE)).sort();
}

function phraseAuHasard(hasard) {
  const cles = clesPhrases();
  return T(cles[Math.floor((hasard || Math.random)() * cles.length) % cles.length]);
}

// Les phrases dans un ordre mélangé : aucune ne revient avant que toutes soient passées.
function melange(hasard) {
  const cles = clesPhrases();
  for (let i = cles.length - 1; i > 0; i--) {
    const j = Math.floor((hasard || Math.random)() * (i + 1));
    [cles[i], cles[j]] = [cles[j], cles[i]];
  }
  return cles;
}

// Affiche `texte` dans la barre d'état ; si l'opération dure, une phrase d'attente s'y
// ajoute et change à chaque période. Rend un objet à dispose(), comme setStatusBarMessage.
function messageAttente(fenetre, texte, opts) {
  const o = Object.assign({ delai: DELAI, periode: PERIODE }, opts);
  let courant = fenetre.setStatusBarMessage(texte);
  let ordre = [];
  let intervalle = null;
  const suivante = () => {
    if (!ordre.length) { ordre = melange(o.hasard); }
    const phrase = T(ordre.shift());
    courant.dispose();
    courant = fenetre.setStatusBarMessage(texte + ' ' + phrase);
  };
  const depart = setTimeout(() => {
    suivante();
    intervalle = setInterval(suivante, o.periode);
    if (intervalle.unref) { intervalle.unref(); }
  }, o.delai);
  if (depart.unref) { depart.unref(); }
  return {
    dispose() {
      clearTimeout(depart);
      if (intervalle) { clearInterval(intervalle); }
      courant.dispose();
    }
  };
}

module.exports = { clesPhrases, phraseAuHasard, messageAttente, DELAI, PERIODE };
