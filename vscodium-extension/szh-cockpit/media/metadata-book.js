// Page « Méta-données du livre » : le pendant de metadata-issue.js pour buch.yaml. Elle ne
// fait que poser le formulaire partagé SZH.formulaireLivre (media/_numero.js, moteur commun
// aux deux formulaires) et lui passer les messages. L'illustration de couverture et le
// bouton de la 4e de couverture sont des blocs de la table des champs (CHAMPS_LIVRE) ; le
// dos, lui, se calcule à la compilation (docs/ARCHITECTURE-LIVRES.md §3) et s'affiche en
// lecture seule.
//
// Protocole avec l'hôte : celui de _numero.js (voir son en-tête), plus l'annonce « pret ».
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  let recu = false;

  const livre = SZH.formulaireLivre({
    conteneur: document.getElementById('livre'),
    api: vscodeApi,
    txt: TXT,
    etat: document.getElementById('etat')
  });
  livre.enregistrement(document.getElementById('enregistrer'));

  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (!livre.message(msg)) { console.warn('métadonnées du livre : type de message inconnu', msg.type); }
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
