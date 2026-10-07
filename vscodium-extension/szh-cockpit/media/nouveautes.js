// « Quoi de neuf » : ce que la mise à jour a changé, dans la langue de l'interface. La page
// s'ouvre seule après une mise à jour : elle ne contient donc aucun bouton et n'écrit rien.
// Le texte vient de nouveautes.json et passe par textContent, jamais par du HTML.
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
    // Pas de couleur d'accent : la page ne concerne aucun numéro.
    titre.textContent = msg.titre || '';
    version.textContent = msg.version || '';
    notes.textContent = '';
    var liste = msg.notes || [];
    liste.forEach(function (note) { notes.appendChild(rendreNote(note)); });
    // Sans note (page ouverte depuis le panneau de commande), un message dit pourquoi.
    rien.textContent = (msg.i18n && msg.i18n.rien) || '';
    rien.hidden = liste.length > 0;
  });
  SZH.annoncerPret(api, function () { return recu; });
})();
