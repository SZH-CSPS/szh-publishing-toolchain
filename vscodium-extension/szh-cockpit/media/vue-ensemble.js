// Vue d'ensemble d'une section de la barre latérale : une barre de commandes globales, et
// une liste de lignes. Rien n'est décidé ici — l'hôte envoie les boutons et les lignes, la
// page les pose. Un seul fichier sert donc « Traductions » et « Word en attente ».
//
// Cliquer l'onglet d'une section ouvre cette vue : les commandes globales y ont un bouton
// avec un texte, au lieu des pictogrammes muets que l'arbre alignait dans sa marge.
//
// La barre et les cartes sont construites par SZH.barreBoutons et SZH.listeCartes
// (media/_commun.js), partagées avec la vue « Articles » : une carte a partout les mêmes
// trois étages fixes — la tête et sa mesure, ce qu'il y a à lire, puis « Ouvrir » et l'état.
//
// Protocole. Vers l'hôte :
//   pret ; action { id, cle } ; ouvrir { cle }
// Depuis l'hôte :
//   valeurs { titre, boutons, lignes, accent, i18n } ; etat { message }
// où i18n vaut { ouvrir, listeVide }.
// où un bouton vaut { id, libelle, icone, tip, principal, danger, desactive } et une ligne
// { cle, groupe, titre, meta, pastilles: [{ texte, ton, icone }], notif: { ton, texte },
// actions: [{ id, libelle, icone, tip, desactive, danger }], ouvrir }.
//
// « action » sert aux deux : la barre l'envoie sans `cle`, le bouton d'une carte avec celle
// de sa ligne. C'est l'hôte qui départage, et il n'y a qu'un message à traiter.
(function () {
  'use strict';
  var api = acquireVsCodeApi();
  var TXT = {};
  var titre = document.getElementById('titre');
  var barre = document.getElementById('barre');
  var ctlEtat = null;

  var liste = SZH.listeCartes({
    conteneur: document.getElementById('lignes'),
    textes: function () { return TXT; },
    onOuvrir: function (cle) { api.postMessage({ type: 'ouvrir', cle: cle }); },
    onAction: function (cle, id) { api.postMessage({ type: 'action', id: id, cle: cle }); }
  });

  var recu = false;
  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    recu = true;
    if (msg.type !== 'valeurs') {
      if (msg.type === 'etat' && ctlEtat) { ctlEtat.textContent = msg.message || ''; }
      return;
    }
    if (msg.i18n) { TXT = msg.i18n; }
    SZH.poserAccent(msg.accent);
    titre.textContent = msg.titre || '';
    ctlEtat = SZH.barreBoutons(barre, msg.boutons || [], function (id) {
      api.postMessage({ type: 'action', id: id });
    });
    liste.rendre(msg.lignes || []);
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
