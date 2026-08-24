// Page « Méta-données du numéro » : elle ne fait plus que poser le formulaire partagé
// SZH.formulaireNumero (media/_numero.js) et lui passer les messages. Le formulaire
// lui-même — la table des champs, la couverture, l'enregistrement automatique — vit dans
// ce fragment, que la vue « Articles » monte à l'identique : un champ ajouté là apparaît
// ici sans seconde modification.
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
    numero.message(msg);
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
