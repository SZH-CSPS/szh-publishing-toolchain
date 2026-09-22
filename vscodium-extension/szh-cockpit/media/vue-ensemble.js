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
//   pret ; action { id, cle } ; ouvrir { cle } ; constat-fermer { empreinte }
// Depuis l'hôte :
//   valeurs { titre, boutons, lignes, accent, i18n, focus? } ; etat { message } ;
//   focaliser { focus }
// où i18n vaut { ouvrir, listeVide, fermerConstat }.
// où un bouton vaut { id, libelle, icone, tip, principal, danger, desactive } et une ligne
// { cle, groupe, titre, meta, pastilles: [{ texte, ton, icone }], notif: { ton, texte },
// messages: [{ ton, texte, action, fermable, empreinte }],
// actions: [{ id, libelle, icone, tip, desactive, danger }], ouvrir }.
//
// `fermable` ne se devine pas ici : c'est l'hôte qui sait qu'un constat est gris, donc
// effaçable, et lui qui retient l'empreinte de ceux qu'on a fermés.
//
// `focus` (un nom de fichier Word, pour l'instant) désigne la carte dont `cle` lui est égal
// (SZH.listeCartes pose [data-cle] à la construction) : amenée à l'écran, marquée quelques
// secondes. Absent, ou sans carte correspondante : rien ne se passe, jamais d'erreur — la
// table (lib/constats.js) vise « word » avec des focus que toutes les cartes ne portent pas
// (le rapport de conversion, par ex., n'a pas de `cle`). Il arrive soit dans la première
// « valeurs » (panneau qui s'ouvre), soit dans un message « focaliser » à part (panneau déjà
// ouvert, dont la liste ne serait pas reconstruite sinon) — voir extension.js, ouvrirVueEnsemble.
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
    onOuvrir: function (cle) { api.postMessage({ type: SZH.MSG.OUVRIR, cle: cle }); },
    onAction: function (cle, id) { api.postMessage({ type: SZH.MSG.ACTION, id: id, cle: cle }); },
    onFermer: function (empreinte) {
      api.postMessage({ type: SZH.MSG.CONSTAT_FERMER, empreinte: empreinte });
    }
  });

  var recu = false;
  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    recu = true;
    // Le panneau était déjà ouvert : l'hôte envoie ce message à part, sans reconstruire la
    // liste (revue F03, boutons de constat qui visent le dépôt Word par nom de fichier).
    if (msg.type === SZH.MSG.FOCALISER) { liste.focaliser(msg.focus); return; }
    if (msg.type !== SZH.MSG.VALEURS) {
      if (msg.type === SZH.MSG.ETAT) { if (ctlEtat) { ctlEtat.textContent = msg.message || ''; } }
      else { console.warn('vue d’ensemble : type de message inconnu', msg.type); }
      return;
    }
    if (msg.i18n) { TXT = msg.i18n; }
    SZH.poserAccent(msg.accent);
    titre.textContent = msg.titre || '';
    ctlEtat = SZH.barreBoutons(barre, msg.boutons || [], function (id) {
      api.postMessage({ type: SZH.MSG.ACTION, id: id });
    });
    liste.rendre(msg.lignes || []);
    // Le panneau vient de s'ouvrir : le focus voyage dans cette toute première « valeurs ».
    if (msg.focus) { liste.focaliser(msg.focus); }
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
