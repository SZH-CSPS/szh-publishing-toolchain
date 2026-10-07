// Garde d'interaction. Un QuickPick ou une InputBox de VS Code se ferme dès que le focus
// bouge, et réassigner le HTML d'un webview (rafraîchissement de l'aperçu après une
// compilation) suffit à le faire bouger. Ce module compte les interactions ouvertes et
// retient, tant qu'il y en a, les actions qui voleraient le focus ; elles sont rejouées à
// la fermeture de la dernière. C'est l'appelant qui décide ce qui doit attendre.
//
// Le module ne requiert rien en tête, pour que test/js/interaction.test.js le charge seul.
// confirmerAbandon requiert donc vscode et i18n dans la fonction.
'use strict';

function creerGarde() {
  // Compteur et non booléen : les gardes s'imbriquent (QuickPick puis InputBox, sous-choix).
  let ouvertes = 0;
  // Une action par clé, la dernière gagne : trois compilations donnent un seul rafraîchissement.
  const differees = new Map();

  function vider() {
    // La table est vidée avant d'exécuter, pour qu'une action qui re-diffère ne boucle pas.
    const actions = Array.from(differees.values());
    differees.clear();
    for (const action of actions) {
      // vider() tourne dans le finally de sousGarde : une exception y remplacerait le
      // résultat de l'interaction.
      try { action(); } catch (e) { /* l'action différée échoue seule */ }
    }
  }

  // Enveloppe un showQuickPick/showInputBox : tant que fn n'a pas rendu la main, ce qui
  // passe par differer() attend. Rend ce que fn rend, exceptions comprises.
  async function sousGarde(fn) {
    ouvertes++;
    try {
      return await fn();
    } finally {
      ouvertes--;
      if (ouvertes === 0) { vider(); }
    }
  }

  // Exécute fn tout de suite si aucune interaction n'est ouverte, sinon à la fermeture.
  function differer(cle, fn) {
    if (ouvertes === 0) { fn(); return; }
    differees.set(String(cle), fn);
  }

  function interactionEnCours() { return ouvertes > 0; }

  return { sousGarde, differer, interactionEnCours };
}

// Instance partagée par tout le cockpit (via le cache de require). creerGarde est exporté
// pour les tests, qui veulent un compteur vierge.
const garde = creerGarde();

// Modale commune « modifications non enregistrées », posée quand on quitte un formulaire
// sans Ctrl+S. Seule la question change. Rend 'enregistrer', 'quitter' ou 'annuler'.
async function confirmerAbandon(question) {
  const vscode = require('vscode');
  const { T } = require('./i18n');
  const choix = await vscode.window.showWarningMessage(
    question, { modal: true, detail: T('table.quitter.detail') },
    T('form.enregistrer'), T('table.quitter.sansEnregistrer'));
  if (choix === T('form.enregistrer')) { return 'enregistrer'; }
  if (choix === T('table.quitter.sansEnregistrer')) { return 'quitter'; }
  return 'annuler';                        // Échap ou modale fermée
}

module.exports = {
  creerGarde,
  sousGarde: garde.sousGarde,
  differer: garde.differer,
  interactionEnCours: garde.interactionEnCours,
  confirmerAbandon
};
