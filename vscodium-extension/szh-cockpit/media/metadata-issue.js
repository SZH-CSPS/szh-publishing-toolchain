// Page « Métadonnées du numéro » : pose le formulaire SZH.formulaireNumero (_numero.js),
// partagé avec la vue « Articles », et lui transmet les messages.
//
// Protocole avec l'hôte : celui de _numero.js, plus l'annonce « pret ».
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  let recu = false;

  const numero = SZH.formulaireNumero({
    conteneur: document.getElementById('numero'),
    api: vscodeApi,
    txt: TXT,
    etat: document.getElementById('etat'),
    couverture: true
  });
  numero.enregistrement(document.getElementById('enregistrer'));

  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    if (!numero.message(msg)) { console.warn('métadonnées du numéro : type de message inconnu', msg.type); }
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
