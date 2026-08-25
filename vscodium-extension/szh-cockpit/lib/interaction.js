// Garde d'interaction : un QuickPick ou une InputBox de VS Code se ferme dès que le focus
// bouge — et réassigner le HTML d'un webview, comme le fait le rafraîchissement de
// l'aperçu à la fin d'une compilation, suffit à le faire bouger. Le rédacteur qui a ouvert
// un panneau (Ctrl+Alt+A/S/D, choix de titre…) perdait donc son geste dès qu'un PDF
// sortait. Ce module compte les interactions ouvertes et retient, pendant qu'il y en a,
// les actions qui voleraient le focus ; elles sont rejouées à la fermeture de la dernière.
//
// Volontairement pur — aucun require, pas de vscode : la logique se teste telle quelle
// (test/js/interaction.test.js), et c'est le point d'appel qui décide ce qui mérite
// d'attendre. Les mises à jour de barre d'état, inoffensives pour le focus, ne passent
// pas par ici.
'use strict';

function creerGarde() {
  // Compteur plutôt que booléen : « Autre titre… » enchaîne un QuickPick puis une
  // InputBox sous une même garde englobante, et un panneau peut ouvrir un sous-choix.
  let ouvertes = 0;
  // Une seule action par clé — la dernière gagne : trois compilations pendant un choix de
  // titre ne doivent produire qu'un rafraîchissement, pas trois.
  const differees = new Map();

  function vider() {
    // On vide la table avant d'exécuter : une action qui re-diffère (sans interaction
    // ouverte, differer exécute sur-le-champ) ne doit pas tourner en boucle sur elle-même.
    const actions = Array.from(differees.values());
    differees.clear();
    for (const action of actions) {
      // Un rafraîchissement qui rate ne doit pas avaler le choix que le rédacteur vient
      // de faire : sousGarde rend ce choix depuis un finally, où une exception ici le
      // remplacerait.
      try { action(); } catch (e) { /* l'action différée échoue seule */ }
    }
  }

  // Enveloppe un showQuickPick/showInputBox : tant que fn n'a pas rendu la main, tout ce
  // qui passe par differer() attend. Rend ce que fn rend, exceptions comprises — le
  // compteur, lui, redescend quoi qu'il arrive.
  async function sousGarde(fn) {
    ouvertes++;
    try {
      return await fn();
    } finally {
      ouvertes--;
      if (ouvertes === 0) { vider(); }
    }
  }

  // Exécute fn tout de suite si aucune interaction n'est ouverte, sinon la range pour la
  // fermeture. La fin d'une compilation ne doit pas interrompre le geste en cours — mais
  // dès que le geste est fini, l'aperçu et les avis rattrapent leur retard.
  function differer(cle, fn) {
    if (ouvertes === 0) { fn(); return; }
    differees.set(String(cle), fn);
  }

  function interactionEnCours() { return ouvertes > 0; }

  return { sousGarde, differer, interactionEnCours };
}

// L'instance partagée du cockpit : panneaux.js, formatting.js et extension.js doivent
// compter les mêmes interactions — le cache de require s'en charge. creerGarde reste
// exporté pour les tests, qui veulent un compteur vierge à chaque cas.
const garde = creerGarde();

module.exports = {
  creerGarde,
  sousGarde: garde.sousGarde,
  differer: garde.differer,
  interactionEnCours: garde.interactionEnCours
};
