// Page « Métadonnées du livre » (buch.yaml) : pose le formulaire SZH.formulaireLivre
// (_numero.js) et lui transmet les messages. Le dos de couverture se calcule à la
// compilation (docs/ARCHITECTURE-LIVRES.md) et s'affiche en lecture seule.
//
// Protocole avec l'hôte : celui de _numero.js, plus l'annonce « pret ».
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
