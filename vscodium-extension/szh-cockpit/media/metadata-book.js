// Page « Méta-données du livre » : le pendant de metadata-issue.js pour buch.yaml. Elle ne
// fait que poser le formulaire partagé SZH.formulaireLivre (media/_numero.js, moteur commun
// aux deux formulaires) et lui passer les messages — aucune couverture image ici, le dos de
// l'ouvrage se calcule à la compilation à partir du grammage et du nombre de pages réel
// (docs/ARCHITECTURE-LIVRES.md §3), il n'y a rien à déposer depuis ce formulaire.
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
    etat: document.getElementById('etat'),
    couverture: false
  });
  livre.enregistrement(document.getElementById('enregistrer'));

  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    recu = true;
    livre.message(msg);
  });
  SZH.annoncerPret(vscodeApi, function () { return recu; });
})();
