// Webview « Métadonnées des articles » : une carte par article, un bandeau de filtre
// quand l'hôte n'en envoie qu'une partie. Les cartes et la modale photo viennent de
// SZH.cartesArticles (media/_fiches.js).
//
// Protocole avec l'hôte, en plus de photo-* et de l'enregistrement (voir _fiches.js) :
//   webview -> hôte : pret ; modifie { modifie } ; tous ;
//                     enregistrer { auto, articles } ; rechargement { articles }
//   hôte -> webview : valeurs { articles, types, langue, filtre } ;
//                     demande-rechargement ; enregistre { auto, n } ; erreur { message }
(function () {
  'use strict';
  const TXT = __TXT__;
  const vscodeApi = acquireVsCodeApi();
  const etat = document.getElementById('etat');
  const conteneur = document.getElementById('cartes');
  const bandeauFiltre = document.getElementById('filtre');
  let dernierModifie = false;

  // L'hôte doit savoir si des cartes sont modifiées : c'est lui qui garde le formulaire
  // contre un rechargement. On ne poste qu'aux changements d'état, pas à chaque frappe.
  function signalerModifie() {
    const m = cartes.estModifie();
    if (m === dernierModifie) { return; }
    dernierModifie = m;
    vscodeApi.postMessage({ type: 'modifie', modifie: m });
  }

  const cartes = SZH.cartesArticles({
    conteneur: conteneur,
    api: vscodeApi,
    txt: TXT,
    etat: etat,
    surChangement: signalerModifie
  });

  function rendreFiltre(filtre) {
    bandeauFiltre.textContent = '';
    if (!filtre || !filtre.length) { bandeauFiltre.hidden = true; return; }
    const texte = document.createElement('span');
    texte.textContent = TXT.filtreNote.split('{0}').join(filtre.join(', '));
    bandeauFiltre.appendChild(texte);
    const bouton = document.createElement('button');
    bouton.type = 'button';
    bouton.textContent = TXT.tous;
    bouton.addEventListener('click', function () { vscodeApi.postMessage({ type: 'tous' }); });
    bandeauFiltre.appendChild(bouton);
    bandeauFiltre.hidden = false;
  }

  // L'hôte répond sans renvoyer les valeurs quand l'enregistrement est automatique,
  // pour ne pas re-rendre la page sous les doigts.
  cartes.enregistrement(document.getElementById('enregistrer'));

  window.addEventListener('message', function (e) {
    const msg = e.data || {};
    if (cartes.message(msg)) { return; }
    if (msg.type === 'valeurs') {
      cartes.rendre(msg.articles || [], msg.types || [], msg.langue || 'fr');
      rendreFiltre(msg.filtre || null);
    }
    // L'hôte veut recharger le formulaire alors que des cartes sont modifiées : il lui
    // faut ce qu'elles contiennent pour pouvoir les enregistrer.
    if (msg.type === 'demande-rechargement') {
      vscodeApi.postMessage({ type: 'rechargement', articles: cartes.modifiees() });
    }
  });
  vscodeApi.postMessage({ type: 'pret' });
})();
