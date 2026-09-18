// « Quoi de neuf » : ce que la mise à jour a changé, dans la langue de l'interface. Une page
// qui se lit et rien d'autre — aucun bouton, aucune écriture, aucun retour vers l'hôte que
// l'annonce d'être prête. C'est voulu : elle s'ouvre toute seule après une mise à jour, et
// une page qui s'ouvre seule ne doit rien pouvoir déclencher.
//
// Le texte n'est jamais du HTML : il vient de nouveautes.json, livré avec le toolkit, et il
// est posé par textContent. Une note mal écrite ne peut donc pas poser de balise ici.
//
// Protocole. Vers l'hôte : pret. Depuis l'hôte :
//   valeurs { titre, version, notes, i18n }
// où une note vaut { medium, titre, points: [texte] } et i18n { rien }.
(function () {
  'use strict';
  var api = acquireVsCodeApi();
  var titre = document.getElementById('titre');
  var version = document.getElementById('version');
  var notes = document.getElementById('notes');
  var rien = document.getElementById('rien');

  function rendreNote(note) {
    var bloc = document.createElement('section');
    bloc.className = 'szh-note';

    var h2 = document.createElement('h2');
    h2.textContent = note.titre || '';
    if (note.medium) {
      var medium = document.createElement('span');
      medium.className = 'szh-medium';
      medium.textContent = note.medium;
      h2.appendChild(medium);
    }
    bloc.appendChild(h2);

    var ul = document.createElement('ul');
    (note.points || []).forEach(function (point) {
      var li = document.createElement('li');
      li.textContent = point;
      ul.appendChild(li);
    });
    bloc.appendChild(ul);
    return bloc;
  }

  var recu = false;
  window.addEventListener('message', function (ev) {
    var msg = ev.data || {};
    recu = true;
    if (msg.type !== SZH.MSG.VALEURS) {
      console.warn('nouveautés : type de message inconnu', msg.type);
      return;
    }
    // Pas de couleur d'accent : elle est celle d'un numéro, et cette page n'en concerne
    // aucun — elle parle du logiciel, pas du document ouvert.
    titre.textContent = msg.titre || '';
    version.textContent = msg.version || '';
    notes.textContent = '';
    var liste = msg.notes || [];
    liste.forEach(function (note) { notes.appendChild(rendreNote(note)); });
    // Rien à montrer : la page s'ouvre quand même si on la demande au panneau de commande,
    // et elle doit alors dire pourquoi elle est vide plutôt que rester blanche.
    rien.textContent = (msg.i18n && msg.i18n.rien) || '';
    rien.hidden = liste.length > 0;
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
